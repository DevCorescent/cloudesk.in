// What a signed-in supplier sees and does: the open RFQs they were asked to
// quote (and quoting them), their purchase orders (acknowledging with a
// promised date, telling us what's been dispatched), their bills and what's
// still to be paid, and sending an invoice for the accounts team to book.
// Each response is noted for whoever raised the RFQ or PO.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { sniffFile } from "@/lib/documents/model";
import { ackSchema, dispatchSchema, invoiceSchema, MAX_INVOICE_BYTES, poStage, quoteSchema } from "@/lib/portal/model";
import { isOn } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { check } from "../helpdesk/access";
import { notify } from "../notify/notify";
import { supplierFor, type Visitor } from "./auth";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const R = schema.invRfqs;
const PO = schema.invPurchaseOrders;

async function me(v: Visitor) {
  const s = await supplierFor(v.orgId, v.email);
  if (!s) throw new ApiError("forbidden", "This portal isn't open to you any more");
  return s;
}
function requireSection(on: boolean) {
  if (!on) throw new ApiError("forbidden", "That part of the portal is switched off");
}
const inventoryOn = (v: Visitor) => isOn(v.modules, "inventory");

async function itemNames(ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; unit: string; sku: string }>();
  const rows = await db.select({ id: schema.invItems.id, name: schema.invItems.name, unit: schema.invItems.unit, sku: schema.invItems.sku }).from(schema.invItems).where(inArray(schema.invItems.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

async function tell(v: Visitor, to: (string | null)[], supplier: string, what: string, link: string) {
  // Whoever raised it, or the workspace's owners and admins.
  let ids = to.filter((x): x is string => !!x);
  if (!ids.length) ids = (await db.select({ id: schema.memberships.userId, role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.orgId, v.orgId))).filter((m) => can(m.role as Role, "inventory:manage")).map((m) => m.id);
  await notify(v.orgId, ids, { kind: "portal.supplier", title: `${supplier} ${what}`, link, values: { supplier, what, link } }).catch(() => {});
}

// ── RFQs ────────────────────────────────────────────────────────────────────

export async function rfqs(v: Visitor) {
  requireSection(v.settings.suppliers.rfqs && inventoryOn(v));
  const s = await me(v);
  const rows = await db.select().from(R).where(and(eq(R.orgId, v.orgId), eq(R.status, "open"), sql`${R.supplierIds} @> ${JSON.stringify([s.id])}::jsonb`)).orderBy(desc(R.createdAt));
  const quotes = rows.length ? await db.select().from(schema.invRfqQuotes).where(and(inArray(schema.invRfqQuotes.rfqId, rows.map((r) => r.id)), eq(schema.invRfqQuotes.supplierId, s.id))) : [];
  const names = await itemNames([...new Set(rows.flatMap((r) => r.lines.map((l) => l.itemId)))]);
  return rows.map((r) => {
    const q = quotes.find((x) => x.rfqId === r.id);
    return { id: r.id, number: r.number, dueDate: r.dueDate ? String(r.dueDate) : null, notes: r.notes, lines: r.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, ...(names.get(l.itemId) ?? { name: "Item", unit: "", sku: "" }) })), quote: q ? { lines: q.lines, validTill: q.validTill ? String(q.validTill) : null, terms: q.terms } : null };
  });
}

/** Quote (or re-quote) an open RFQ: rates in rupees, for items on it. */
export async function quote(v: Visitor, rfqId: string, raw: unknown) {
  requireSection(v.settings.suppliers.rfqs && inventoryOn(v));
  const s = await me(v);
  if (!isId(rfqId)) throw notFound("RFQ");
  const [r] = await db.select().from(R).where(and(eq(R.id, rfqId), eq(R.orgId, v.orgId)));
  if (!r || !r.supplierIds.includes(s.id)) throw notFound("RFQ");
  if (r.status !== "open") throw new ApiError("conflict", "This RFQ is closed");
  const x = check(quoteSchema, raw);
  for (const l of x.lines) if (!r.lines.some((y) => y.itemId === l.itemId)) throw new ApiError("validation_failed", "Quote only the items asked for");
  if (new Set(x.lines.map((l) => l.itemId)).size !== x.lines.length) throw new ApiError("validation_failed", "Each item once, please");
  const lines = x.lines.map((l) => ({ ...l, rate: Math.round(l.rate * 100) }));
  const [q] = await db.insert(schema.invRfqQuotes).values({ rfqId, supplierId: s.id, lines, validTill: x.validTill, terms: x.terms }).onConflictDoUpdate({ target: [schema.invRfqQuotes.rfqId, schema.invRfqQuotes.supplierId], set: { lines, validTill: x.validTill, terms: x.terms } }).returning();
  await tell(v, [r.createdBy], s.name, `quoted on ${r.number}`, `/inventory/rfqs/${r.id}`);
  return q;
}

// ── Purchase orders ─────────────────────────────────────────────────────────

export async function orders(v: Visitor) {
  requireSection(v.settings.suppliers.orders && inventoryOn(v));
  const s = await me(v);
  const rows = await db.select().from(PO).where(and(eq(PO.orgId, v.orgId), eq(PO.supplierId, s.id), inArray(PO.status, ["sent", "partial", "received", "closed", "cancelled"]))).orderBy(desc(PO.orderDate)).limit(300);
  const names = await itemNames([...new Set(rows.flatMap((r) => r.lines.map((l) => l.itemId)))]);
  const whs = rows.length ? await db.select({ id: schema.invWarehouses.id, name: schema.invWarehouses.name }).from(schema.invWarehouses).where(inArray(schema.invWarehouses.id, [...new Set(rows.map((r) => r.warehouseId))])) : [];
  return rows.map((p) => ({ id: p.id, number: p.number, orderDate: String(p.orderDate), expectedDate: p.expectedDate ? String(p.expectedDate) : null, status: p.status, stage: poStage(p), deliverTo: whs.find((w) => w.id === p.warehouseId)?.name ?? "", total: p.total, lines: p.lines.map((l) => ({ ...(names.get(l.itemId) ?? { name: "Item", unit: "", sku: "" }), qty: l.qty, rate: l.rate, gstRate: l.gstRate, received: l.received })), ack: p.supplierAck, dispatches: p.dispatches, canRespond: p.status === "sent" || p.status === "partial" }));
}

async function myPo(v: Visitor, id: string) {
  const s = await me(v);
  if (!isId(id)) throw notFound("Purchase order");
  const [p] = await db.select().from(PO).where(and(eq(PO.id, id), eq(PO.orgId, v.orgId), eq(PO.supplierId, s.id)));
  if (!p || p.status === "draft") throw notFound("Purchase order");
  if (p.status !== "sent" && p.status !== "partial") throw new ApiError("conflict", "This order is no longer open");
  return { s, p };
}

export async function acknowledge(v: Visitor, id: string, raw: unknown) {
  requireSection(v.settings.suppliers.orders && inventoryOn(v));
  const { s, p } = await myPo(v, id);
  const x = check(ackSchema, raw);
  if (x.promisedDate && x.promisedDate < String(p.orderDate)) throw new ApiError("validation_failed", "The promised date is before the order date");
  await db.update(PO).set({ supplierAck: { at: new Date().toISOString(), by: v.email, promisedDate: x.promisedDate, note: x.note }, updatedAt: new Date() }).where(eq(PO.id, p.id));
  await tell(v, [p.createdBy], s.name, `acknowledged ${p.number}${x.promisedDate ? `, promising ${x.promisedDate}` : ""}`, `/inventory/orders/${p.id}`);
  return { ok: true };
}

export async function dispatch(v: Visitor, id: string, raw: unknown) {
  requireSection(v.settings.suppliers.orders && inventoryOn(v));
  const { s, p } = await myPo(v, id);
  const x = check(dispatchSchema, raw);
  if (p.dispatches.length >= 50) throw new ApiError("conflict", "That's a lot of dispatches on one order — contact the buyer");
  const entry = { id: randomUUID(), at: new Date().toISOString(), by: v.email, ...x };
  await db.update(PO).set({ dispatches: [...p.dispatches, entry], supplierAck: p.supplierAck ?? { at: entry.at, by: v.email, promisedDate: null, note: "" }, updatedAt: new Date() }).where(eq(PO.id, p.id));
  await tell(v, [p.createdBy], s.name, `dispatched against ${p.number} (${x.reference})`, `/inventory/orders/${p.id}`);
  return entry;
}

// ── Bills and invoices ──────────────────────────────────────────────────────

export async function bills(v: Visitor) {
  requireSection(v.settings.suppliers.invoices && isOn(v.modules, "accounting"));
  const s = await me(v);
  const B = schema.accBills;
  const rows = await db.select().from(B).where(and(eq(B.orgId, v.orgId), eq(B.supplierId, s.id), eq(B.kind, "bill"), sql`${B.status} not in ('void','rejected','pending_approval')`)).orderBy(desc(B.date)).limit(300);
  return rows.map((b) => ({ id: b.id, billNo: b.billNo || b.number, date: String(b.date), dueDate: b.dueDate ? String(b.dueDate) : null, total: b.total, tds: b.tdsAmount, paid: b.amountPaid, due: Math.max(0, b.total - b.tdsAmount - b.credited - b.amountPaid), status: b.status }));
}

export async function submissions(v: Visitor) {
  requireSection(v.settings.suppliers.invoices);
  const s = await me(v);
  const I = schema.portalInvoices;
  return db.select({ id: I.id, invoiceNo: I.invoiceNo, date: I.date, amount: I.amount, status: I.status, reason: I.reason, filename: I.filename, createdAt: I.createdAt }).from(I).where(and(eq(I.orgId, v.orgId), eq(I.supplierId, s.id))).orderBy(desc(I.createdAt)).limit(200);
}

/** Send an invoice (with its PDF or photo) for the accounts team to book. */
export async function submitInvoice(v: Visitor, meta: unknown, file: { name: string; bytes: Buffer } | null) {
  requireSection(v.settings.suppliers.invoices);
  const s = await me(v);
  const x = check(invoiceSchema, meta);
  let kind: { mime: string } | null = null;
  if (file) {
    if (file.bytes.length > MAX_INVOICE_BYTES) throw new ApiError("payload_too_large", "Invoices are limited to 10 MB");
    kind = sniffFile(file.bytes, file.name);
    if (!kind || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(kind.mime)) throw new ApiError("validation_failed", "Attach the invoice as a PDF, JPG, PNG or WebP", { file: ["Unsupported file"] });
  }
  if (x.poId) {
    const [p] = await db.select({ id: PO.id }).from(PO).where(and(eq(PO.id, x.poId), eq(PO.orgId, v.orgId), eq(PO.supplierId, s.id)));
    if (!p) throw new ApiError("validation_failed", "That purchase order isn't yours", { poId: ["Unknown order"] });
  }
  const [dup] = await db.select({ id: schema.portalInvoices.id }).from(schema.portalInvoices).where(and(eq(schema.portalInvoices.orgId, v.orgId), eq(schema.portalInvoices.supplierId, s.id), sql`upper(${schema.portalInvoices.invoiceNo}) = ${x.invoiceNo.toUpperCase()}`, sql`${schema.portalInvoices.status} <> 'rejected'`));
  if (dup) throw new ApiError("conflict", `You've already sent invoice ${x.invoiceNo}`);
  const [row] = await db.insert(schema.portalInvoices).values({ orgId: v.orgId, supplierId: s.id, poId: x.poId, invoiceNo: x.invoiceNo, date: x.date, amount: Math.round(x.amount * 100), note: x.note, filename: file?.name.slice(0, 200) ?? "", mime: kind?.mime ?? "", bytes: file?.bytes ?? null, submittedBy: v.email }).returning({ id: schema.portalInvoices.id });
  const managers = (await db.select({ id: schema.memberships.userId, role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.orgId, v.orgId))).filter((m) => can(m.role as Role, "accounts:write")).map((m) => m.id);
  await tell(v, managers, s.name, `sent invoice ${x.invoiceNo} for ₹${x.amount.toLocaleString("en-IN")}`, "/portals/invoices");
  return { id: row.id };
}

export async function home(v: Visitor) {
  const s = await me(v);
  const st = v.settings.suppliers;
  const rq = st.rfqs && inventoryOn(v) ? await rfqs(v) : [];
  const po = st.orders && inventoryOn(v) ? await orders(v) : [];
  const bl = st.invoices && isOn(v.modules, "accounting") ? await bills(v) : [];
  return {
    supplier: { name: s.name, gstin: s.gstin },
    welcome: st.welcome,
    sections: { rfqs: st.rfqs && inventoryOn(v), orders: st.orders && inventoryOn(v), invoices: st.invoices },
    toQuote: rq.filter((r) => !r.quote).length,
    toAcknowledge: po.filter((p) => p.status === "sent" && !p.ack).length,
    openOrders: po.filter((p) => p.canRespond).length,
    due: bl.reduce((n, b) => n + b.due, 0),
  };
}
