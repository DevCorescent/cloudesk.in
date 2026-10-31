import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import { financialYear, validateGstin } from "@/lib/store/gst";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
/** A syntactically valid GSTIN for tests: the check digit that validates. */
const gstinFor = (first14: string) => [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => first14 + c).find((g) => validateGstin(g).ok)!;

async function post(handler: (r: Request, c: { params: Promise<{ projectId: string }> }) => Promise<Response>, fields: Record<string, string>, c = "") {
  const f = new FormData();
  f.set("_base", "/s/acme/gst");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await handler(new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN, ...(c ? { cookie: c } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
  return { location: decodeURIComponent(res.headers.get("location") ?? ""), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? c };
}

async function buy(variant: string, qty: number, addr: { region: string; postalCode: string }, extra: Record<string, string> = {}) {
  const a = await post(cartRoute.POST, { action: "add", variant, qty: String(qty) });
  const d = await post(checkoutRoute.POST, { step: "details", email: "b@example.com", phone: "9876543210", name: "Buyer", line1: "1 Road", line2: "", city: "City", country: "IN", ...addr, ...extra }, a.cookie);
  if (d.location.includes("err=")) return { error: d.location };
  const rate = (await store("GET", "shipping")).json.zones[0].rates.find((r: { kind: string }) => r.kind === "flat").id;
  const placed = await post(checkoutRoute.POST, { step: "place", rate, payment: "cod" }, a.cookie);
  const n = Number(/\/order\/(\d+)/.exec(placed.location)?.[1]);
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, n)));
  return { o };
}

beforeAll(async () => {
  await resetDb();
  const r = await call(signup.POST, { method: "POST", body: { name: "G", email: "g@example.com", password: "correct-horse-42" } });
  cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: m.json.organizations[0].id }, body: { templateId: "blank", name: "Gst" } })).json.project.id;
  await store("POST", "setup", { name: "Mumbai Threads", country: "IN", region: "Maharashtra" });
});

afterAll(async () => {
  await closeDb();
});

describe("GST", () => {
  it("validates the store GSTIN and product HSN codes", async () => {
    const taxes = (await store("GET", "taxes")).json;
    expect((await store("PUT", "taxes", { ...taxes, taxId: "27AAPFU0939F1ZW" })).status).toBe(422);
    const ok = await store("PUT", "taxes", { ...taxes, taxId: "27aapfu0939f1zv" });
    expect(ok.json.taxId).toBe("27AAPFU0939F1ZV");
    expect((await store("POST", "products", { title: "Bad", hsn: "12", variants: [{ options: {}, price: 100 }] })).status).toBe(422);
  });

  it("puts B2B buyers, HSN codes, the right GST split and sequential invoice numbers on invoices", async () => {
    const shirt = (await store("POST", "products", { title: "Cotton shirt", status: "active", hsn: "6205", taxBps: 500, variants: [{ options: {}, price: 105000, stock: 50 }] })).json.product.variants[0].id;
    const bad = await buy(shirt, 1, { region: "Karnataka", postalCode: "560001" }, { gstin: "29ABCDE1234F1Z0" });
    expect(bad.error).toContain("GSTIN");
    const buyerGstin = gstinFor("29ABCDE1234F1Z");
    const b2b = (await buy(shirt, 2, { region: "Karnataka", postalCode: "560001" }, { gstin: buyerGstin.toLowerCase(), businessName: "Bengaluru Retail Pvt Ltd" })).o!;
    const local = (await buy(shirt, 1, { region: "Maharashtra", postalCode: "400001" })).o!;
    expect(b2b).toMatchObject({ buyerGstin, buyerBusinessName: "Bengaluru Retail Pvt Ltd", invoiceNumber: null });

    // COD orders are invoiced when the cash is collected (delivered).
    for (const o of [b2b, local]) for (const status of ["shipped", "delivered"]) await store("POST", `orders/${o.id}`, { action: "fulfill", status, notify: false });
    const fy = financialYear(new Date());
    const [i1] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, b2b.id));
    const [i2] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, local.id));
    expect([i1.invoiceNumber, i2.invoiceNumber]).toEqual([`INV/${fy}/0001`, `INV/${fy}/0002`]);

    const inter = (await store("GET", `orders/${b2b.id}/invoice`)).text;
    expect(inter).toContain("Tax invoice");
    expect(inter).toContain(`Invoice no. INV/${fy}/0001`);
    expect(inter).toContain(`GSTIN: ${buyerGstin}`);
    expect(inter).toContain("GSTIN: 27AAPFU0939F1ZV");
    expect(inter).toContain("Place of supply: Karnataka (29)");
    expect(inter).toContain(">6205<");
    expect(inter).toContain(">IGST<");
    expect(inter).toContain("Rupees");
    const intra = (await store("GET", `orders/${local.id}/invoice`)).text;
    expect(intra).toContain(">CGST<");
    expect(intra).toContain(">SGST<");
  });

  it("summarises the month like GSTR-1 and exports CSVs", async () => {
    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const r = await store("GET", `gst?month=${month}`);
    expect(r.status).toBe(200);
    expect(r.json.invoices).toBe(2);
    expect(r.json.b2b).toHaveLength(1);
    expect(r.json.b2b[0]).toMatchObject({ placeOfSupply: "29-Karnataka", invoice: expect.stringContaining("/0001") });
    expect(r.json.b2b[0].igst).toBeGreaterThan(0);
    expect(r.json.b2b[0].cgst).toBe(0);
    expect(r.json.b2cs.find((x: { placeOfSupply: string }) => x.placeOfSupply === "27-Maharashtra").cgst).toBeGreaterThan(0);
    const shirtRow = r.json.hsn.find((h: { hsn: string }) => h.hsn === "6205");
    expect(shirtRow.quantity).toBe(3);
    // Every rupee of the invoices is accounted for.
    const orders = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.projectId, projectId));
    const invoiced = orders.filter((o) => o.invoiceNumber).reduce((a, o) => a + o.total, 0);
    expect(r.json.totals.total).toBe(invoiced);

    const csv = await store("GET", `gst/csv?month=${month}&section=b2b`);
    expect(csv.text.split("\n")[0]).toBe("GSTIN of recipient,Receiver name,Invoice number,Invoice date,Invoice value,Place of supply,Taxable value,IGST,CGST,SGST");
    expect((await store("GET", `gst?month=2026-13`)).status).toBe(422);

    await store("POST", `orders/${orders.find((o) => o.buyerGstin)!.id}`, { action: "refund", amount: 50000, reason: "Return" });
    const after = await store("GET", `gst?month=${month}`);
    expect(after.json.creditNotes).toHaveLength(1);
    expect(after.json.creditNotes[0].amount).toBe(50000);
  });
});
