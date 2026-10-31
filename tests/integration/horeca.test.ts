import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as api from "@/app/api/v1/projects/[projectId]/horeca/[[...slug]]/route";
import * as qr from "@/app/t/[token]/route";
import * as valetGuest from "@/app/v/[token]/route";
import * as valetBook from "@/app/v/book/[token]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
const h = (method: string, path: string, body?: unknown) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/horeca/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const menuPage = (token: string) => qr.GET(new Request(`${ORIGIN}/t/${token}`), { params: Promise.resolve({ token }) });
const guest = (token: string, body: unknown) => qr.POST(new Request(`${ORIGIN}/t/${token}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const ids: Record<string, string> = {};
let t1 = { id: "", token: "" };

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Kabir", email: "kabir@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Saffron House" } })).json.project.id;
});
afterAll(closeDb);

describe("Cloudesk for Horeca", () => {
  it("sets up a venue, its floor and its menu", async () => {
    expect((await h("GET", "floor")).status).toBe(409); // not set up yet
    const v = await h("PUT", "venue", { name: "Saffron House", kind: "hotel", taxBps: 500, serviceChargeBps: 1000, settings: { qr: { accent: "#b4532a", allowNotes: true }, valet: { slots: 20 } } });
    expect(v.status).toBe(200);
    expect(v.json.venue.settings.qr.mode).toBe("order");
    const area = (await h("POST", "areas", { name: "Garden" })).json.area;
    const tables = (await h("POST", "tables/bulk", { areaId: area.id, prefix: "T", count: 4, seats: 4 })).json.tables;
    expect(tables.map((t: { name: string }) => t.name)).toEqual(["T1", "T2", "T3", "T4"]);
    t1 = tables[0];
    const mains = (await h("POST", "categories", { name: "Mains", station: "kitchen" })).json.category;
    const bar = (await h("POST", "categories", { name: "Cocktails", station: "bar" })).json.category;
    const breakfast = (await h("POST", "categories", { name: "Breakfast", availableFrom: "00:00", availableTo: "00:01" })).json.category;
    const size = (await h("POST", "modifiers", { name: "Portion", minSelect: 1, maxSelect: 1, options: [{ id: "half", name: "Half", price: 0 }, { id: "full", name: "Full", price: 15000 }] })).json.group;
    const extra = (await h("POST", "modifiers", { name: "Extras", minSelect: 0, maxSelect: 2, options: [{ id: "butter", name: "Extra butter", price: 4000 }, { id: "naan", name: "Butter naan", price: 6000 }] })).json.group;
    ids.paneer = (await h("POST", "menu-items", { categoryId: mains.id, name: "Paneer tikka", price: 32000, diet: "veg", spice: 2, tags: ["Bestseller"], modifierGroupIds: [size.id, extra.id] })).json.item.id;
    ids.soldout = (await h("POST", "menu-items", { categoryId: mains.id, name: "Mutton biryani", price: 42000, diet: "nonveg", available: false })).json.item.id;
    ids.poha = (await h("POST", "menu-items", { categoryId: breakfast.id, name: "Poha", price: 15000 })).json.item.id;
    const rum = (await h("POST", "bar-items", { name: "Old Monk", category: "rum", bottleMl: 750, costPerBottle: 60000, reorderMl: 750 })).json.item;
    ids.rum = rum.id;
    expect((await h("POST", "menu-items", { categoryId: bar.id, name: "Rum & cola", price: 35000, barItemId: rum.id })).status).toBe(422); // pour size needed
    ids.cola = (await h("POST", "menu-items", { categoryId: bar.id, name: "Rum & cola", price: 35000, diet: "none", barItemId: rum.id, pourMl: 60 })).json.item.id;
    await h("POST", "bar-moves", { barItemId: rum.id, kind: "purchase", bottles: 2 });
    expect((await h("GET", "bar")).json.items[0].stockMl).toBe(1500);
  });

  it("serves a QR menu that guests order from, with add-on rules", async () => {
    const page = await menuPage(t1.token);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toMatch(/script-src 'sha256-/);
    const html = await page.text();
    expect(html).toContain("Paneer tikka");
    expect(html).toContain("SOLD OUT");
    expect(html).toContain("not right now"); // breakfast window
    // Required portion missing; sold-out item; outside its hours.
    expect((await guest(t1.token, { action: "order", lines: [{ itemId: ids.paneer, qty: 1 }] })).status).toBe(422);
    expect((await guest(t1.token, { action: "order", lines: [{ itemId: ids.soldout, qty: 1 }] })).status).toBe(422);
    expect((await guest(t1.token, { action: "order", lines: [{ itemId: ids.poha, qty: 1 }] })).status).toBe(422);
    const ok = await guest(t1.token, { action: "order", lines: [{ itemId: ids.paneer, qty: 2, options: ["full", "butter"], notes: "less spicy" }, { itemId: ids.cola, qty: 2 }] });
    expect(ok.status).toBe(200);
    // Drinks pour from the bottle as soon as they're fired.
    expect((await h("GET", "bar")).json.items[0].stockMl).toBe(1500 - 120);
    const status = await (await qr.GET(new Request(`${ORIGIN}/t/${t1.token}?status=1`), { params: Promise.resolve({ token: t1.token }) })).json();
    expect(status.order.items).toHaveLength(2);
    expect(status.order.items[0].status).toBe("new");
    // (320 + 150 + 40) × 2 + 350 × 2 = 1,720 before charges.
    expect(status.order.totals.subtotal).toBe(172000);
  });

  it("splits tickets by station on the kitchen display, and the floor shows the table", async () => {
    const k = (await h("GET", "kitchen")).json.tickets;
    expect(k.map((t: { station: string }) => t.station).sort()).toEqual(["bar", "kitchen"]);
    const kitchen = k.find((t: { station: string }) => t.station === "kitchen");
    expect(kitchen.table).toBe("T1");
    expect(kitchen.items[0].notes).toBe("less spicy");
    await h("POST", "kot", { orderId: kitchen.orderId, kotNo: kitchen.kotNo, status: "ready" });
    const floor = (await h("GET", "floor")).json;
    const t = floor.tables.find((x: { name: string }) => x.name === "T1");
    expect(t.order.ready).toBe(1);
    expect(t.order.cooking).toBe(1);
    ids.order = t.order.id;
  });

  it("bills with service charge and GST, takes split payments, and voids put drinks back", async () => {
    await guest(t1.token, { action: "request", kind: "bill" });
    expect((await h("GET", "floor")).json.tables.find((x: { name: string }) => x.name === "T1").requests[0].kind).toBe("bill");
    const view = (await h("GET", `orders/${ids.order}`)).json;
    const drink = view.items.find((i: { name: string }) => i.name === "Rum & cola");
    await h("POST", `items/${drink.id}/status`, { status: "void" });
    expect((await h("GET", "bar")).json.items[0].stockMl).toBe(1500); // back on the shelf
    const billed = (await h("POST", `orders/${ids.order}/bill`, { discount: 10200 })).json;
    // Food 1,020 − 102 discount = 918; service 10% = 91.80; GST 5% on both = 50.49; 1,060.29 rounds to 1,060.
    expect(billed.totals).toMatchObject({ subtotal: 102000, discount: 10200, service: 9180, tax: 5049, roundOff: -29, total: 106000 });
    expect((await h("GET", "floor")).json.tables.find((x: { name: string }) => x.name === "T1").requests).toHaveLength(0);
    expect((await h("POST", `orders/${ids.order}/pay`, { method: "cash", amount: 200000 })).status).toBe(422); // more than due
    await h("POST", `orders/${ids.order}/pay`, { method: "upi", amount: 60000 });
    const paid = (await h("POST", `orders/${ids.order}/pay`, { method: "cash", amount: 46000 })).json;
    expect(paid.order.status).toBe("paid");
    const today = (await h("GET", "today")).json;
    expect(today).toMatchObject({ sales: 106000, orders: 1 });
    expect(today.methods).toEqual({ upi: 60000, cash: 46000 });
  });

  it("asks a waiter to confirm QR orders when approval is on", async () => {
    const v = (await h("GET", "venue")).json.venue;
    await h("PUT", "venue", { ...v, settings: { ...v.settings, qr: { ...v.settings.qr, approval: "staff", askName: true } } });
    const t2 = (await h("GET", "tables")).json.tables.find((t: { name: string }) => t.name === "T2");
    expect((await guest(t2.token, { action: "order", lines: [{ itemId: ids.cola, qty: 1 }] })).status).toBe(422); // name required
    await guest(t2.token, { action: "order", name: "Ria", lines: [{ itemId: ids.cola, qty: 1 }] });
    expect((await h("GET", "bar")).json.items[0].stockMl).toBe(1500); // not poured until confirmed
    const order = (await h("GET", "floor")).json.tables.find((x: { name: string }) => x.name === "T2").order;
    expect(order.pending).toBe(1);
    await h("POST", `orders/${order.id}/approve`);
    expect((await h("GET", "bar")).json.items[0].stockMl).toBe(1440);
  });

  it("books rooms without double-booking, and charges room service to the folio", async () => {
    const type = (await h("POST", "room-types", { name: "Deluxe", rate: 650000, maxGuests: 2, amenities: ["Wi-Fi", "Breakfast"] })).json.type;
    const room = (await h("POST", "rooms", { typeId: type.id, number: "101", floor: "1" })).json.room;
    expect((await h("POST", "rooms", { typeId: type.id, number: "101" })).status).toBe(422);
    const today = istToday();
    const b = (await h("POST", "bookings", { roomId: room.id, guestName: "Ananya Iyer", guestPhone: "98450 11111", checkIn: today, checkOut: plusDays(today, 2) })).json.booking;
    expect(b.rate).toBe(650000);
    expect((await h("POST", "bookings", { roomId: room.id, guestName: "Clash", checkIn: plusDays(today, 1), checkOut: plusDays(today, 3) })).status).toBe(409);
    expect((await h("POST", "bookings", { roomId: room.id, guestName: "Next", checkIn: plusDays(today, 2), checkOut: plusDays(today, 4) })).status).toBe(200); // back-to-back is fine
    await h("POST", `bookings/${b.id}/action`, { action: "check_in" });
    // In-room dining from the room's own QR, charged to the room.
    const roomQr = (await h("GET", "tables")).json.tables.find((t: { name: string }) => t.name === "Room 101");
    const v = (await h("GET", "venue")).json.venue;
    await h("PUT", "venue", { ...v, settings: { ...v.settings, qr: { ...v.settings.qr, approval: "auto", askName: false } } });
    await guest(roomQr.token, { action: "order", lines: [{ itemId: ids.paneer, qty: 1, options: ["half"] }] });
    const order = (await h("GET", "floor")).json.tables.find((x: { name: string }) => x.name === "Room 101").order;
    const due = (await h("GET", `orders/${order.id}`)).json.totals.due;
    expect((await h("POST", `orders/${order.id}/pay`, { method: "room", amount: due })).json.order.status).toBe("paid");
    const folio = (await h("GET", `bookings/${b.id}`)).json.folio;
    expect(folio).toMatchObject({ nights: 2, room: 1300000, roomTax: 156000, extras: due });
    expect((await h("POST", `bookings/${b.id}/action`, { action: "check_out" })).status).toBe(409); // still due
    await h("POST", `bookings/${b.id}/payments`, { method: "card", amount: folio.due });
    const out = (await h("POST", `bookings/${b.id}/action`, { action: "check_out" })).json;
    expect(out.booking.status).toBe("checked_out");
    expect(out.room.housekeeping).toBe("dirty");
    const cal = (await h("GET", `calendar?from=${today}&days=14`)).json;
    expect(cal.bookings).toHaveLength(2);
    expect(cal.stats.dirty).toBe(1);
  });

  it("counts bar stock and reports the variance", async () => {
    const before = (await h("GET", "bar")).json.items[0];
    const count = (await h("POST", "bar-counts", { lines: [{ barItemId: ids.rum, countedMl: before.stockMl - 90 }], note: "Sunday close" })).json.count;
    expect(count.lines[0].varianceMl).toBe(-90);
    expect(count.totalValue).toBe(-7200); // 90 ml at ₹800 a litre
    expect((await h("GET", "bar")).json.items[0].stockMl).toBe(before.stockMl - 90);
    expect((await h("POST", "bar-moves", { barItemId: ids.rum, kind: "wastage", ml: 100000 })).status).toBe(422); // more than in stock
  });

  it("runs valet: tickets, guest requests and pre-bookings", async () => {
    const t = (await h("POST", "valet", { plate: "ka01ab1234", car: "White City", slot: "B4", guestName: "Rohan" })).json.ticket;
    expect(t).toMatchObject({ status: "parked", plate: "KA01AB1234", ticket: 1 });
    const page = await (await valetGuest.GET(new Request(`${ORIGIN}/v/${t.token}`), { params: Promise.resolve({ token: t.token }) })).text();
    expect(page).toContain("Bring my car");
    const req = await valetGuest.POST(new Request(`${ORIGIN}/v/${t.token}`, { method: "POST", headers: { origin: ORIGIN } }), { params: Promise.resolve({ token: t.token }) });
    expect(req.headers.get("location")).toContain("m=requested");
    expect((await h("POST", `valet/${t.id}/status`, { status: "parked" })).status).toBe(409); // requested → parked isn't a thing
    await h("POST", `valet/${t.id}/status`, { status: "ready" });
    expect((await h("POST", `valet/${t.id}/status`, { status: "delivered" })).json.ticket.status).toBe("delivered");
    const venueToken = (await h("GET", "venue")).json.venue.token;
    const f = new FormData();
    f.set("guestName", "Meera");
    f.set("guestPhone", "98450 22222");
    f.set("plate", "mh02cd5678");
    f.set("expectedAt", new Date(Date.now() + 2 * 3600_000 + 5.5 * 3600_000).toISOString().slice(0, 16));
    const booked = await valetBook.POST(new Request(`${ORIGIN}/v/book/${venueToken}`, { method: "POST", headers: { origin: ORIGIN }, body: f }), { params: Promise.resolve({ token: venueToken }) });
    expect(booked.status).toBe(303);
    const board = (await h("GET", "valet")).json;
    expect(board.stats).toMatchObject({ booked: 1, parked: 0, slots: 20 });
    const pre = board.tickets.find((x: { status: string }) => x.status === "booked");
    expect((await h("POST", `valet/${pre.id}/status`, { status: "parked", slot: "A1" })).json.ticket).toMatchObject({ status: "parked", slot: "A1", plate: "MH02CD5678" });
  });
});
