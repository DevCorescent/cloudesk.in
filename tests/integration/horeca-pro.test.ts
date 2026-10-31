import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as outletsRoute from "@/app/api/v1/orgs/[orgId]/horeca/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as api from "@/app/api/v1/projects/[projectId]/horeca/[[...slug]]/route";
import * as qr from "@/app/t/[token]/route";
import * as reserve from "@/app/r/[token]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let orgId = "";
let projectId = "";
const h = (method: string, path: string, body?: unknown, pid = projectId) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${pid}/horeca/${path}`, params: { projectId: pid, slug: path.split("?")[0].split("/").filter(Boolean) } });
const ids: Record<string, string> = {};
const tables: Record<string, { id: string; token: string }> = {};
let manager = "";
let waiter = "";
let managerTicket = "";

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Nisha", email: "nisha.pro@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Spice Route" } })).json.project.id;
  await h("PUT", "venue", { name: "Spice Route", kind: "restaurant", taxBps: 500, serviceChargeBps: 0, settings: { loyalty: { enabled: true, pointsPer100: 10, pointValue: 100, minRedeem: 10 } } });
  const area = (await h("POST", "areas", { name: "Main" })).json.area;
  for (const t of (await h("POST", "tables/bulk", { areaId: area.id, prefix: "T", count: 4 })).json.tables) tables[t.name] = t;
  const cat = (await h("POST", "categories", { name: "Mains" })).json.category;
  const drinks = (await h("POST", "categories", { name: "Drinks", station: "bar" })).json.category;
  ids.cat = cat.id;
  ids.drinks = drinks.id;
  // Kitchen stock: paneer by the kilo.
  ids.paneer = (await h("POST", "stock-items", { name: "Paneer", unit: "g", packSize: 1000, costPerPack: 40000, reorderAt: 500 })).json.item.id;
  ids.dish = (await h("POST", "menu-items", { categoryId: cat.id, name: "Paneer tikka", price: 30000, recipe: [{ stockItemId: ids.paneer, qty: 150 }] })).json.item.id;
  ids.naan = (await h("POST", "menu-items", { categoryId: cat.id, name: "Naan", price: 5000 })).json.item.id;
  ids.lime = (await h("POST", "menu-items", { categoryId: drinks.id, name: "Fresh lime soda", price: 10000 })).json.item.id;
});
afterAll(closeDb);

describe("Cloudesk for Horeca — Pro", () => {
  it("buys stock from a supplier, and the dish's recipe comes out of stock when it's fired", async () => {
    const sup = (await h("POST", "suppliers", { name: "Fresh Dairy Co", phone: "9820000000" })).json.supplier;
    const p = await h("POST", "purchases", { supplierId: sup.id, invoiceNo: "FD-101", date: "2026-10-23", lines: [{ stockItemId: ids.paneer, packs: 2, cost: 76000 }] });
    expect(p.status).toBe(200);
    let stock = (await h("GET", "stock")).json;
    let paneer = stock.items.find((i: { id: string }) => i.id === ids.paneer);
    expect(paneer.stock).toBe(2000);
    expect(paneer.costPerPack).toBe(38000); // latest price paid
    // Food cost: 150 g at ₹380/kg = ₹57 on a ₹300 dish = 19%.
    const fc = (await h("GET", "food-cost")).json.items.find((i: { id: string }) => i.id === ids.dish);
    expect(fc).toMatchObject({ cost: 5700, pct: 19 });

    const o = (await h("POST", "orders", { tableId: tables.T1.id, covers: 3, guestName: "Rohan", guestPhone: "+91 98200 11223", lines: [{ itemId: ids.dish, qty: 2 }, { itemId: ids.naan, qty: 3 }] })).json;
    ids.order = o.order.id;
    expect(o.order.covers).toBe(3);
    expect(o.guest).toMatchObject({ phone: "9820011223", name: "Rohan" });
    stock = (await h("GET", "stock")).json;
    paneer = stock.items.find((i: { id: string }) => i.id === ids.paneer);
    expect(paneer.stock).toBe(1700);
    // Wastage and a count with variance.
    await h("POST", "stock-moves", { stockItemId: ids.paneer, kind: "wastage", qty: 100, note: "Spoiled" });
    const count = (await h("POST", "stock-counts", { lines: [{ stockItemId: ids.paneer, counted: 1550 }] })).json.count;
    expect(count.lines[0]).toMatchObject({ expected: 1600, counted: 1550, variance: -50, value: -1900 });
  });

  it("asks a manager's PIN once staff exist, and logs who did what", async () => {
    manager = (await h("POST", "staff", { name: "Meera", role: "manager", pin: "4321" })).json.staff.id;
    waiter = (await h("POST", "staff", { name: "Arjun", role: "waiter", pin: "1111" })).json.staff.id;
    expect((await h("POST", "staff", { name: "No pin" })).status).toBe(422);
    expect((await h("POST", "unlock", { staffId: waiter, pin: "0000" })).status).toBe(403);
    expect((await h("POST", "unlock", { staffId: waiter, pin: "1111" })).json.staff.name).toBe("Arjun");
    managerTicket = (await h("POST", "unlock", { staffId: manager, pin: "4321" })).json.staff.ticket;

    const view = (await h("GET", `orders/${ids.order}`)).json;
    const naan = view.items.find((i: { name: string }) => i.name === "Naan");
    // A waiter can't cancel a fired item alone…
    const denied = await h("POST", `items/${naan.id}/status`, { status: "void", staffId: waiter, reason: "Guest changed mind" });
    expect(denied.status).toBe(403);
    expect(denied.json.error.details.approval).toEqual(["required"]);
    expect((await h("POST", `items/${naan.id}/status`, { status: "void", staffId: waiter, approvalPin: "9999", reason: "x" })).status).toBe(403);
    // …but can with the manager's PIN.
    expect((await h("POST", `items/${naan.id}/status`, { status: "void", staffId: waiter, approvalPin: "4321", reason: "Guest changed mind" })).status).toBe(200);
    // Comp, by the manager herself: no extra PIN — once she has unlocked the till (her id alone isn't enough).
    const dish = view.items.find((i: { name: string }) => i.name === "Paneer tikka");
    expect((await h("POST", `items/${dish.id}/comp`, { comp: true, staffId: manager, reason: "Birthday" })).status).toBe(403);
    expect((await h("POST", `items/${dish.id}/comp`, { comp: true, staffId: manager, staffTicket: `${manager}.${Date.now() + 3600_000}.forged`, reason: "Birthday" })).status).toBe(403);
    const comped = (await h("POST", `items/${dish.id}/comp`, { comp: true, staffId: manager, staffTicket: managerTicket, reason: "Birthday" })).json;
    expect(comped.totals).toMatchObject({ subtotal: 0, comps: 60000 });
    await h("POST", `items/${dish.id}/comp`, { comp: false, staffId: manager, staffTicket: managerTicket });
    const events = (await h("GET", "events")).json.events;
    expect(events.find((e: { kind: string }) => e.kind === "void")).toMatchObject({ staffName: "Arjun", approvedBy: "Meera", amount: 15000, detail: "3 × Naan — Guest changed mind" });
    expect(events.find((e: { kind: string }) => e.kind === "comp")).toMatchObject({ approvedBy: "Meera", amount: 60000 });
  });

  it("needs approval for discounts above the limit", async () => {
    // Subtotal ₹600 (2 × tikka). 15% limit: ₹60 is fine, ₹120 isn't without a manager.
    expect((await h("POST", `orders/${ids.order}/bill`, { discount: 6000, staffId: waiter })).status).toBe(200);
    expect((await h("POST", `orders/${ids.order}/bill`, { discount: 12000, staffId: waiter })).status).toBe(403);
    const ok = (await h("POST", `orders/${ids.order}/bill`, { discount: 12000, staffId: waiter, approvalPin: "4321", discountReason: "Regular" })).json;
    expect(ok.totals).toMatchObject({ subtotal: 60000, discount: 12000, tax: 2400, total: 50400 });
  });

  it("runs the till: float, pay-out with approval, cash payments and a Z report with the variance", async () => {
    expect((await h("POST", "shift/open", { openingFloat: 200000, staffId: manager })).status).toBe(200);
    expect((await h("POST", "shift/open", { openingFloat: 0 })).status).toBe(409);
    expect((await h("POST", "shift/cash", { kind: "pay_out", amount: 50000, reason: "Vegetables", staffId: waiter })).status).toBe(403);
    await h("POST", "shift/cash", { kind: "pay_out", amount: 50000, reason: "Vegetables", staffId: manager, staffTicket: managerTicket });
    await h("POST", "shift/cash", { kind: "pay_in", amount: 10000, reason: "Change", staffId: waiter });
    // Loyalty: earn on this bill, spend on the next.
    const paid = (await h("POST", `orders/${ids.order}/pay`, { method: "cash", amount: 50400, staffId: waiter })).json;
    expect(paid.order.status).toBe("paid");
    expect(paid.order.pointsEarned).toBe(50); // ₹504 → 5 × 10 points
    const shift = (await h("GET", "shift")).json.shift;
    expect(shift).toMatchObject({ takings: 50400, bills: 1, payIn: 10000, payOut: 50000, expectedCash: 200000 + 50400 + 10000 - 50000 });
    const closed = (await h("POST", "shift/close", { countedCash: 210000, staffId: manager })).json.shift;
    expect(closed.variance).toBe(210000 - 210400);
    expect(closed.shift.status).toBe("closed");
  });

  it("redeems points and links the visit to the guest", async () => {
    const o = (await h("POST", "orders", { source: "takeaway", guestPhone: "9820011223", lines: [{ itemId: ids.lime, qty: 1 }] })).json;
    expect(o.guest.points).toBe(50);
    // ₹105 total; ₹50 in points, the rest by UPI.
    expect((await h("POST", `orders/${o.order.id}/pay`, { method: "points", amount: 5050 })).status).toBe(422); // whole points only
    await h("POST", `orders/${o.order.id}/pay`, { method: "points", amount: 5000 });
    const done = (await h("POST", `orders/${o.order.id}/pay`, { method: "upi", amount: 5500 })).json;
    expect(done.order.status).toBe("paid");
    const guest = (await h("GET", `guests/${o.guest.id}`)).json.guest;
    expect(guest).toMatchObject({ visits: 2, points: 0 + 0 }); // 50 − 50 redeemed; ₹55 paid earns nothing below ₹100
    expect((await h("GET", "guests?q=98200")).json.guests).toHaveLength(1);
  });

  it("transfers, merges and splits checks", async () => {
    const a = (await h("POST", "orders", { tableId: tables.T2.id, lines: [{ itemId: ids.naan, qty: 2 }, { itemId: ids.lime, qty: 1 }] })).json.order;
    const b = (await h("POST", "orders", { tableId: tables.T3.id, covers: 2, lines: [{ itemId: ids.naan, qty: 1 }] })).json.order;
    expect((await h("POST", `orders/${a.id}/transfer`, { tableId: tables.T3.id })).status).toBe(409);
    const moved = (await h("POST", `orders/${a.id}/transfer`, { tableId: tables.T4.id })).json;
    expect(moved.table.name).toBe("T4");
    const merged = (await h("POST", `orders/${a.id}/merge`, { fromOrderId: b.id })).json;
    expect(merged.items.filter((i: { status: string }) => i.status !== "void")).toHaveLength(3);
    expect(merged.order.covers).toBe(2);
    expect((await h("GET", `orders/${b.id}`)).json.order.status).toBe("cancelled");
    const lime = merged.items.find((i: { name: string }) => i.name === "Fresh lime soda");
    const split = (await h("POST", `orders/${a.id}/split`, { itemIds: [lime.id] })).json;
    expect(split.to.items).toHaveLength(1);
    expect(split.to.table.name).toBe("T4");
    expect((await h("GET", `tables/${tables.T4.id}/checks`)).json.checks).toHaveLength(2);
    const floor = (await h("GET", "floor")).json;
    expect(floor.tables.find((t: { name: string }) => t.name === "T4").checks).toBe(2);
  });

  it("takes delivery orders with a fee", async () => {
    expect((await h("POST", "orders", { source: "delivery", lines: [{ itemId: ids.naan, qty: 1 }] })).status).toBe(422);
    const v = (await h("GET", "venue")).json.venue;
    await h("PUT", "venue", { ...v, settings: { ...v.settings, pos: { ...v.settings.pos, deliveryFee: 4000 } } });
    const o = (await h("POST", "orders", { source: "delivery", guestName: "Kabir", guestPhone: "9811122233", deliveryAddress: "12 Hill Road, Bandra", lines: [{ itemId: ids.naan, qty: 2 }] })).json;
    // ₹100 food + ₹40 delivery + 5% GST on both = ₹147.
    expect(o.totals).toMatchObject({ subtotal: 10000, delivery: 4000, tax: 700, total: 14700 });
  });

  it("charges service only to dine-in, not takeaway or delivery", async () => {
    const v = (await h("GET", "venue")).json.venue;
    await h("PUT", "venue", { ...v, serviceChargeBps: 1000 });
    const away = (await h("POST", "orders", { source: "takeaway", lines: [{ itemId: ids.naan, qty: 2 }] })).json;
    expect(away.totals.service).toBe(0);
    const table = (await h("GET", "tables")).json.tables.find((t: { name: string }) => t.name === "T3");
    const dine = (await h("POST", "orders", { tableId: table.id, lines: [{ itemId: ids.naan, qty: 2 }] })).json;
    expect(dine.totals.service).toBe(1000);
    await h("PUT", "venue", { ...v });
  });

  it("applies a happy hour to items ordered in its window", async () => {
    const v = (await h("GET", "venue")).json.venue;
    await h("PUT", "venue", { ...v, settings: { ...v.settings, pricing: { rules: [{ id: "hh", name: "Happy hour", pct: 20, days: [], from: "", to: "", categoryIds: [ids.drinks] }] } } });
    const o = (await h("POST", "orders", { source: "takeaway", lines: [{ itemId: ids.lime, qty: 1 }, { itemId: ids.naan, qty: 1 }] })).json;
    const lime = o.items.find((i: { name: string }) => i.name === "Fresh lime soda");
    expect(lime.unitPrice).toBe(8000);
    expect(lime.modifiers).toEqual([{ group: "Offer", name: "Happy hour −20%", price: -2000 }]);
    expect(o.items.find((i: { name: string }) => i.name === "Naan").unitPrice).toBe(5000);
    await h("PUT", "venue", { ...v, settings: { ...v.settings, pricing: { rules: [] } } });
  });

  it("books, seats and completes reservations — and guests can request one online", async () => {
    // Soon, but still today in India — the floor shows upcoming bookings and the list is per day.
    const leftToday = 1440 - ((Date.now() / 60_000 + 330) % 1440);
    const at = new Date(Date.now() + Math.max(1, Math.min(30, leftToday - 2)) * 60_000).toISOString();
    const r = (await h("POST", "reservations", { guestName: "Ishita", guestPhone: "9876543210", partySize: 4, at, tableId: tables.T1.id })).json.reservation;
    expect((await h("POST", "reservations", { guestName: "Clash", partySize: 2, at, tableId: tables.T1.id })).status).toBe(409);
    expect((await h("GET", "floor")).json.tables.find((t: { name: string }) => t.name === "T1").reservation).toMatchObject({ guestName: "Ishita", partySize: 4 });
    const seated = (await h("POST", `reservations/${r.id}/status`, { status: "seated" })).json.reservation;
    expect(seated.status).toBe("seated");
    const order = (await h("GET", `orders/${seated.orderId}`)).json;
    expect(order.order).toMatchObject({ covers: 4, guestName: "Ishita" });
    expect((await h("POST", `reservations/${r.id}/status`, { status: "cancelled" })).status).toBe(409);
    // Waitlist
    await h("POST", "reservations", { kind: "waitlist", guestName: "Walk-in Sharma", partySize: 2, at: new Date().toISOString() });
    const day = (await h("GET", "reservations")).json;
    expect(day.waitlist).toHaveLength(1);
    expect(day.stats.covers).toBe(6);

    // Online request (form post, India time).
    const token = (await h("GET", "venue")).json.venue.token;
    const local = new Date(Date.now() + 5.5 * 3600_000 + 86_400_000).toISOString().slice(0, 11) + "19:30";
    const f = new FormData();
    for (const [k, v] of Object.entries({ guestName: "Online Guest", guestPhone: "9000011111", partySize: "3", at: local, notes: "Window seat" })) f.set(k, v);
    const res = await reserve.POST(new Request(`${ORIGIN}/r/${token}`, { method: "POST", headers: { origin: ORIGIN }, body: f }), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Request received");
    const [row] = await db.select().from(schema.horecaReservations).where(eq(schema.horecaReservations.guestName, "Online Guest"));
    expect(row).toMatchObject({ source: "online", status: "booked", partySize: 3 });
  });

  it("collects feedback after a QR table pays, and reports the day", async () => {
    const o = (await h("POST", "orders", { tableId: tables.T3.id, lines: [{ itemId: ids.naan, qty: 1 }] })).json;
    await h("POST", `orders/${o.order.id}/pay`, { method: "card", amount: o.totals.due });
    const status = await (await qr.GET(new Request(`${ORIGIN}/t/${tables.T3.token}?status=1`), { params: Promise.resolve({ token: tables.T3.token }) })).json();
    expect(status.feedback).toMatchObject({ number: o.order.number });
    const post = await qr.POST(new Request(`${ORIGIN}/t/${tables.T3.token}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ action: "feedback", rating: 5, comment: "Lovely naan" }) }), { params: Promise.resolve({ token: tables.T3.token }) });
    expect(post.status).toBe(200);
    expect((await h("GET", "feedback")).json).toMatchObject({ average: 5 });

    const rep = (await h("GET", "reports")).json;
    expect(rep.totals.bills).toBeGreaterThanOrEqual(3);
    expect(rep.totals.total).toBe(Object.values(rep.methods as Record<string, number>).reduce((a, v) => a + v, 0));
    expect(rep.totals.cgst + rep.totals.sgst).toBe(rep.totals.tax);
    expect(rep.gst.find((g: { rate: number }) => g.rate === 500)).toBeTruthy();
    expect(rep.eventTotals.find((e: { kind: string }) => e.kind === "void").count).toBeGreaterThanOrEqual(1);
    expect(rep.feedback).toMatchObject({ count: 1, average: 5 });
    expect(rep.staff.find((s: { name: string }) => s.name === "Not recorded")).toBeTruthy();
  });

  it("lists outlets across the workspace and copies a menu between them", async () => {
    const second = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Spice Route Juhu" } })).json.project.id;
    await h("PUT", "venue", { name: "Spice Route Juhu", kind: "restaurant" }, second);
    const copied = (await h("POST", "menu/copy", { fromProjectId: projectId }, second)).json;
    expect(copied).toMatchObject({ categories: 2, items: 3 });
    const m = (await h("GET", "menu", undefined, second)).json;
    expect(m.items.every((i: { recipe: unknown[] }) => i.recipe.length === 0)).toBe(true);
    const out = (await call(outletsRoute.GET, { cookie, params: { orgId } })).json;
    expect(out.outlets.map((o: { name: string }) => o.name)).toEqual(["Spice Route", "Spice Route Juhu"]);
    expect(out.totals.sales).toBe(out.outlets[0].sales);
  });
});
