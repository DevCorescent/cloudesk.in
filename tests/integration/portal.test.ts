import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as booksRoute from "@/app/api/v1/finance/books/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import * as adminApi from "@/app/api/v1/orgs/[orgId]/portal/[[...slug]]/route";
import * as hdApi from "@/app/api/v1/orgs/[orgId]/helpdesk/[[...slug]]/route";
import * as portalApi from "@/app/api/v1/portal/[slug]/[[...rest]]/route";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Customers and suppliers signing in by a one-time emailed link (unknown
// addresses get the same answer, links work once), customers seeing only
// their own invoices, orders and tickets, suppliers quoting RFQs,
// acknowledging and dispatching orders and sending invoices the team books —
// and losing access the moment they're blocked or signed out.
let orgId = "";
let slug = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const R = (mod: unknown, base: string, params: (p: string) => Record<string, unknown>) => (method: string, path: string, body?: unknown, cookie = C.owner) => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `${base}/${path}`, params: params(path) as never });
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
let B: ReturnType<typeof R>, I: ReturnType<typeof R>, A: ReturnType<typeof R>, H: ReturnType<typeof R>;
const P = (method: string, path: string, body?: unknown, cookie?: string) => call((portalApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/portal/${slug}/${path}`, params: { slug, rest: seg(path) } });
const lastLink = async (to: string) => {
  const m = (await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, to))).filter((x) => x.subject.startsWith("Your sign-in link")).at(-1);
  return m ? /[?&]t=([\w-]+)/.exec(m.body)![1] : null;
};
async function signInAs(email: string, kind: "customer" | "supplier") {
  await P("POST", "link", { email, kind });
  const token = await lastLink(email);
  const r = await P("POST", "signin", { token });
  expect(r.status).toBe(200);
  return /cd_portal_\w+=[^;]+/.exec(r.headers.get("set-cookie")!)![0];
}

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Pooja Portal", email: "pooja.portal@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  slug = (await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)))[0].slug;
  B = R(booksRoute, "/api/v1/finance/books", (p) => ({ slug: seg(p) }));
  I = R(invApi, `/api/v1/orgs/${orgId}/inventory`, (p) => ({ orgId, slug: seg(p) }));
  A = R(adminApi, `/api/v1/orgs/${orgId}/portal`, (p) => ({ orgId, slug: seg(p) }));
  H = R(hdApi, `/api/v1/orgs/${orgId}/helpdesk`, (p) => ({ orgId, slug: seg(p) }));
  const book = (await B("POST", "", { orgId, name: "Main" })).json.book.id;
  const client = (who: string, email: string) => B("POST", `${book}/clients`, { name: who, company: "", email, billing: { line1: "", line2: "", city: "", state: "Maharashtra", postalCode: "", country: "IN" }, notes: "" });
  ids.meera = (await client("Meera", "meera@lumen.example")).json.client.id;
  ids.other = (await client("Other Co", "other@co.example")).json.client.id;
  const doc = (clientId: string, rate: number, d: string, due: string) => ({ type: "invoice", clientId, client: { name: "x", company: "", billing: { line1: "", line2: "", city: "", state: "Maharashtra", postalCode: "", country: "IN" } }, issueDate: d, dueDate: due, currency: "INR", taxMode: "none", lines: [{ id: "a", name: "Work", quantity: 1, rate, taxBps: 0 }] });
  ids.inv1 = (await B("POST", `${book}/documents`, { document: doc(ids.meera, 100000_00, "2026-08-01", "2026-08-15"), issue: true })).json.document.id;
  await B("POST", `${book}/documents/${ids.inv1}/payments`, { amount: 40000_00, method: "upi", paidOn: "2026-08-10" });
  await B("POST", `${book}/documents`, { document: doc(ids.meera, 25000_00, "2026-10-20", "2099-01-01"), issue: true });
  await B("POST", `${book}/documents`, { document: doc(ids.other, 99000_00, "2026-10-20", "2099-01-01"), issue: true });
  await I("GET", "meta");
  ids.wh = (await I("GET", "warehouses")).json.warehouses[0].id;
  ids.apex = (await I("POST", "suppliers", { name: "Apex Packaging", email: "sales@apex.example", state: "KA" })).json.supplier.id;
  ids.bharat = (await I("POST", "suppliers", { name: "Bharat Boxes", email: "hello@bharat.example", state: "KA" })).json.supplier.id;
  ids.box = (await I("POST", "items", { name: "Carton 12x12", sku: "CTN-12", unit: "pcs", gstRate: 18 })).json.item.id;
});
afterAll(closeDb);

describe("signing in", () => {
  it("emails a one-time link only to known addresses, saying the same thing either way", async () => {
    expect((await P("GET", "info")).json).toMatchObject({ customers: true, suppliers: true });
    expect((await P("POST", "link", { email: "nobody@else.example", kind: "customer" })).json).toEqual({ sent: true });
    expect(await lastLink("nobody@else.example")).toBeNull();
    expect((await P("POST", "link", { email: "Meera@Lumen.example", kind: "customer" })).json).toEqual({ sent: true });
    const token = (await lastLink("meera@lumen.example"))!;
    const r = await P("POST", "signin", { token });
    expect(r.json).toEqual({ kind: "customer", email: "meera@lumen.example" });
    C.meera = /cd_portal_customer=[^;]+/.exec(r.headers.get("set-cookie")!)![0];
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax/);
    // Links work once.
    expect((await P("POST", "signin", { token })).status).toBe(401);
    expect((await P("GET", "c/home")).status).toBe(401);
    // A customer session isn't a supplier one.
    expect((await P("GET", "s/home", undefined, C.meera.replace("customer", "supplier"))).status).toBe(401);
    // Only hashes are stored.
    const [s] = await db.select().from(schema.portalSessions).where(eq(schema.portalSessions.email, "meera@lumen.example"));
    expect(C.meera).not.toContain(s.tokenHash);
  });
});

describe("the customer portal", () => {
  it("shows only their own invoices, what's owed and overdue, and their payments", async () => {
    const home = (await P("GET", "c/home", undefined, C.meera)).json;
    expect(home).toMatchObject({ outstanding: 85000_00, overdue: 60000_00 });
    const inv = (await P("GET", "c/invoices", undefined, C.meera)).json.invoices;
    expect(inv.map((i: { total: number }) => i.total).sort()).toEqual([100000_00, 25000_00].sort());
    expect(inv.find((i: { total: number }) => i.total === 100000_00)).toMatchObject({ balance: 60000_00, status: "overdue" });
    expect(inv[0].url).toMatch(/\/doc\//);
    expect((await P("GET", "c/payments", undefined, C.meera)).json.payments).toMatchObject([{ amount: 40000_00, method: "upi" }]);
  });

  it("raises a ticket that lands in the Helpdesk, and lists it", async () => {
    await H("GET", "meta");
    const r = (await P("POST", "c/tickets", { subject: "Need GST copy", body: "Please send a GST copy of the August invoice." }, C.meera)).json.ticket;
    expect(r.number).toBe("HD-0001");
    const [t] = await db.select().from(schema.hdTickets).where(eq(schema.hdTickets.id, r.id));
    expect(t).toMatchObject({ channel: "portal", customerName: "Meera", customerEmail: "meera@lumen.example" });
    expect((await P("GET", "c/tickets", undefined, C.meera)).json.tickets.map((x: { number: string }) => x.number)).toEqual(["HD-0001"]);
  });

  it("closes sections the workspace switches off, and signs out", async () => {
    await A("PUT", "settings", { customers: { enabled: true, invoices: true, orders: true, tickets: false, welcome: "Hi!" } });
    expect((await P("GET", "c/tickets", undefined, C.meera)).status).toBe(403);
    expect((await P("GET", "c/home", undefined, C.meera)).json).toMatchObject({ welcome: "Hi!", sections: { tickets: false } });
    await P("POST", "signout/customer", undefined, C.meera);
    expect((await P("GET", "c/home", undefined, C.meera)).status).toBe(401);
  });
});

describe("the supplier portal", () => {
  it("quotes an RFQ the supplier was asked on — and only that one", async () => {
    C.apex = await signInAs("sales@apex.example", "supplier");
    const mine = (await I("POST", "rfqs", { title: "Cartons", warehouseId: ids.wh, lines: [{ itemId: ids.box, qty: 1000 }], supplierIds: [ids.apex] })).json.rfq;
    const notMine = (await I("POST", "rfqs", { title: "Other", warehouseId: ids.wh, lines: [{ itemId: ids.box, qty: 5 }], supplierIds: [ids.bharat] })).json.rfq;
    const list = (await P("GET", "s/rfqs", undefined, C.apex)).json.rfqs;
    expect(list.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    expect(list[0].lines[0]).toMatchObject({ name: "Carton 12x12", qty: 1000, unit: "pcs" });
    expect((await P("POST", `s/rfqs/${notMine.id}/quote`, { lines: [{ itemId: ids.box, rate: 20 }] }, C.apex)).status).toBe(404);
    expect((await P("POST", `s/rfqs/${mine.id}/quote`, { lines: [{ itemId: ids.wh, rate: 20 }] }, C.apex)).status).toBe(422);
    expect((await P("POST", `s/rfqs/${mine.id}/quote`, { lines: [{ itemId: ids.box, rate: 21.5, gstRate: 18, leadDays: 5 }], terms: "Ex-works" }, C.apex)).status).toBe(200);
    const [q] = await db.select().from(schema.invRfqQuotes).where(and(eq(schema.invRfqQuotes.rfqId, mine.id), eq(schema.invRfqQuotes.supplierId, ids.apex)));
    expect(q.lines[0]).toMatchObject({ rate: 2150, leadDays: 5 });
    const n = await db.select().from(schema.notifications).where(eq(schema.notifications.kind, "portal.supplier"));
    expect(n.map((x) => x.title)).toContain(`Apex Packaging quoted on ${mine.number}`);
  });

  it("acknowledges and dispatches a sent order, which the email points to", async () => {
    const po = (await I("POST", "orders", { supplierId: ids.apex, warehouseId: ids.wh, orderDate: "2026-10-20", lines: [{ itemId: ids.box, qty: 100, rate: 2150, gstRate: 18 }] })).json.order;
    ids.po = po.id;
    expect((await P("GET", "s/orders", undefined, C.apex)).json.orders).toHaveLength(0);
    await I("POST", `orders/${po.id}/send`, { email: true });
    const [o] = (await P("GET", "s/orders", undefined, C.apex)).json.orders;
    expect(o).toMatchObject({ number: po.number, stage: "Awaiting your acknowledgement", canRespond: true });
    expect((await P("POST", `s/orders/${po.id}/ack`, { promisedDate: "2026-10-01" }, C.apex)).status).toBe(422);
    await P("POST", `s/orders/${po.id}/ack`, { promisedDate: "2026-10-28", note: "Will ship in 2 lots" }, C.apex);
    await P("POST", `s/orders/${po.id}/dispatch`, { date: "2026-10-26", reference: "LR-55102", carrier: "VRL" }, C.apex);
    const [row] = await db.select().from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.id, po.id));
    expect(row.supplierAck).toMatchObject({ promisedDate: "2026-10-28", by: "sales@apex.example" });
    expect(row.dispatches[0]).toMatchObject({ reference: "LR-55102", carrier: "VRL" });
    expect((await P("GET", "s/orders", undefined, C.apex)).json.orders[0].stage).toBe("Dispatched");
  });

  it("sends an invoice the team turns into a bill, or returns with a reason", async () => {
    const send = async (meta: object, file?: Buffer) => {
      const form = new FormData();
      form.set("meta", JSON.stringify(meta));
      if (file) form.set("file", new File([new Uint8Array(file)], "inv.pdf"));
      const res = await portalApi.POST(new Request(`${ORIGIN}/api/v1/portal/${slug}/s/invoices`, { method: "POST", headers: { cookie: C.apex, origin: ORIGIN }, body: form }), { params: Promise.resolve({ slug, rest: ["s", "invoices"] }) });
      return { status: res.status, json: await res.json() };
    };
    expect((await send({ invoiceNo: "AP/77", date: "2026-10-27", amount: 2537 }, Buffer.from("not a pdf"))).status).toBe(422);
    const ok = await send({ invoiceNo: "AP/77", date: "2026-10-27", amount: 2537, poId: ids.po }, Buffer.from("%PDF-1.4\n%%EOF"));
    expect(ok.status).toBe(200);
    expect((await send({ invoiceNo: "ap/77", date: "2026-10-27", amount: 1 })).status).toBe(409);
    const list = (await A("GET", "submissions")).json.invoices;
    expect(list[0]).toMatchObject({ invoiceNo: "AP/77", amount: 2537_00, supplier: "Apex Packaging", filename: "inv.pdf" });
    const file = await A("GET", `submissions/${ok.json.invoice.id}/file`);
    expect(file.headers.get("content-disposition")).toContain("attachment");
    // Without AI, the draft is what they typed, with a warning.
    const d = (await A("GET", `submissions/${ok.json.invoice.id}/draft`)).json;
    expect(d.draft).toMatchObject({ supplierId: ids.apex, billNo: "AP/77", lines: [{ amount: 2537_00, gstRate: 0 }] });
    expect(d.warnings[0]).toMatch(/only a total/);
    // Returned with a reason: emailed, and a corrected invoice with the same number can follow.
    await A("POST", `submissions/${ok.json.invoice.id}/reject`, { reason: "Please show GST separately" });
    const mails = (await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "sales@apex.example"))).filter((m) => m.subject.startsWith("Invoice AP/77 was returned"));
    expect(mails[0].body).toContain("Please show GST separately");
    const again = await send({ invoiceNo: "AP/77", date: "2026-10-27", amount: 2537 });
    expect(again.status).toBe(200);
    expect((await P("GET", "s/invoices", undefined, C.apex)).json.invoices.map((x: { status: string }) => x.status).sort()).toEqual(["rejected", "submitted"]);
    // Booked: linked to a bill of that supplier only.
    const acc = (await call((await import("@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route")).GET, { cookie: C.owner, path: `/api/v1/orgs/${orgId}/accounts/meta`, params: { orgId, slug: ["meta"] } })).json;
    const exp = acc.accounts.find((a: { code: string }) => a.code === "5260").id;
    const accApi = await import("@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route");
    const bill = (await call(accApi.POST, { method: "POST", cookie: C.owner, body: { supplierId: ids.apex, billNo: "AP/77", date: "2026-10-27", lines: [{ accountId: exp, amount: 2150_00, gstRate: 18 }] }, path: `/api/v1/orgs/${orgId}/accounts/bills`, params: { orgId, slug: ["bills"] } })).json.bill;
    expect((await A("POST", `submissions/${again.json.invoice.id}/billed`, { billId: bill.id })).status).toBe(200);
    expect((await P("GET", "s/bills", undefined, C.apex)).json.bills).toMatchObject([{ billNo: "AP/77", total: 2537_00, due: 2537_00 }]);
  });

  it("shuts a blocked supplier out at once, and the team can sign people out", async () => {
    const sessions = (await A("GET", "sessions")).json.sessions;
    expect(sessions.map((x: { email: string }) => x.email)).toContain("sales@apex.example");
    await db.update(schema.invSuppliers).set({ approval: "blocked" }).where(eq(schema.invSuppliers.id, ids.apex));
    expect((await P("GET", "s/home", undefined, C.apex)).status).toBe(403);
    await db.update(schema.invSuppliers).set({ approval: "approved" }).where(eq(schema.invSuppliers.id, ids.apex));
    const s = sessions.find((x: { email: string }) => x.email === "sales@apex.example");
    await A("DELETE", `sessions/${s.id}`);
    expect((await P("GET", "s/home", undefined, C.apex)).status).toBe(401);
    // The team can send a link — and hears when the address isn't known.
    expect((await A("POST", "invite", { email: "hello@bharat.example", kind: "supplier" })).status).toBe(200);
    expect((await A("POST", "invite", { email: "x@y.example", kind: "supplier" })).status).toBe(422);
  });
});
