// Fulfilling orders. A delivery challan takes the goods out of a location
// (through the stock engine) and counts them as delivered; a return brings
// them back (unless written off) and makes a credit note for what was billed.
// Invoicing turns what's due into a draft invoice in the order's books — its
// lines aren't linked to stock items, so the invoice doesn't take stock out a
// second time. Which invoice billed what is kept, so a voided invoice or
// credit note frees the quantities again.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DocInput, Line } from "@/lib/invoicing/model";
import { partySchema } from "@/lib/invoicing/model";
import { deliverySchema, q3, returnSchema, toInvoice, type OrderLine } from "@/lib/sales/model";
import { ApiError, notFound } from "../http/errors";
import { getSettings as invSettings } from "../inventory/access";
import { ensureDefaultWarehouse } from "../inventory/items";
import { allocate, getItem, getWarehouse, move } from "../inventory/stock";
import { invoiceBooks } from "../org/org";
import { createDoc, getSettings as invoiceSettings } from "../invoicing/service";
import { audit } from "../services/audit";
import { check, nextNumber, requirePart, requireWrite, todayIst, type Scope } from "./access";
import { getOrder, refreshStatus } from "./orders";
import { termsFor } from "./pricing";
import { needSerials, serialsIn, serialsOut, syncOrderReservations } from "../inventory/warehouse";

const LIVE = ["confirmed", "partial", "delivered"];

async function warehouseFor(s: Scope, asked: string | null, order: { warehouseId: string | null }) {
  const id = asked ?? order.warehouseId ?? s.settings.defaultWarehouseId;
  if (id) return getWarehouse(s.orgId, id);
  await ensureDefaultWarehouse(s.orgId);
  const [w] = await db.select().from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.isDefault, true)));
  if (!w) throw new ApiError("conflict", "Pick the location to deliver from");
  return w;
}

const docHref = async (orgId: string, ownerId: string, id: string, type = "invoices") => {
  const kind = (await invoiceBooks(orgId)).find((b) => b.id === ownerId)?.kind;
  return kind === "project" ? `/projects/${ownerId}/invoicing/${type}/${id}` : `/finance/${ownerId}/${type}/${id}`;
};

// ── Deliveries ──────────────────────────────────────────────────────────────

export async function deliveries(s: Scope) {
  return db
    .select({ d: schema.salesDeliveries, order: schema.salesOrders.number, client: schema.salesOrders.clientName })
    .from(schema.salesDeliveries)
    .innerJoin(schema.salesOrders, eq(schema.salesOrders.id, schema.salesDeliveries.orderId))
    .where(eq(schema.salesDeliveries.orgId, s.orgId))
    .orderBy(sql`${schema.salesDeliveries.date} desc`, sql`${schema.salesDeliveries.createdAt} desc`)
    .limit(300)
    .then((r) => r.map((x) => ({ ...x.d, orderNumber: x.order, client: x.client })));
}

export async function deliver(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "delivery");
  if (!s.has("inventory")) throw new ApiError("conflict", "Switch on Inventory to deliver from stock");
  const v = check(deliverySchema, raw);
  const o = await getOrder(s.orgId, v.orderId);
  if (!LIVE.includes(o.status)) throw new ApiError("conflict", o.status === "pending_approval" ? "This order is waiting for approval" : "Only a confirmed order can be delivered");
  const wh = await warehouseFor(s, v.warehouseId, o);
  const lines = o.lines.map((l) => ({ ...l }));
  const out: { lineId: string; itemId: string; name: string; qty: number; batch: string; binId: string | null; serials: string[] }[] = [];
  for (const d of v.lines) {
    const l = lines.find((x) => x.id === d.lineId);
    if (!l) throw new ApiError("validation_failed", "That line isn't on this order");
    if (!l.itemId) throw new ApiError("validation_failed", `${l.name} isn't a stock item — it's invoiced, not delivered`);
    if (d.qty > q3(l.qty - l.delivered) + 0.0005) throw new ApiError("validation_failed", `Only ${q3(l.qty - l.delivered)} of ${l.name} is left to deliver`);
    l.delivered = q3(l.delivered + d.qty);
    needSerials(await getItem(s.orgId, l.itemId), d.qty, d.serials);
    out.push({ lineId: l.id, itemId: l.itemId, name: l.name, qty: d.qty, batch: d.batch, binId: d.binId, serials: d.serials });
  }
  const number = await nextNumber(s.orgId, "challan", s.settings.challanPrefix);
  const settings = await invSettings(s.orgId);
  const made = await db.transaction(async (tx) => {
    const [dc] = await tx.insert(schema.salesDeliveries).values({ orgId: s.orgId, number, orderId: o.id, date: v.date, warehouseId: wh.id, lines: out.map((x) => ({ lineId: x.lineId, itemId: x.itemId, name: x.name, qty: x.qty, batch: x.batch, ...(x.serials.length ? { serials: x.serials } : {}) })), vehicleNo: v.vehicleNo, transporter: v.transporter, notes: v.notes, createdBy: s.userId }).returning();
    for (const x of out) {
      const item = await getItem(s.orgId, x.itemId, tx);
      // From the bin it was picked from, or batches earliest expiry first.
      const parts = x.binId ? [{ batch: x.batch, qty: x.qty }] : await allocate(tx, item, wh, x.qty, x.batch);
      for (const part of parts) await move(tx, { orgId: s.orgId, userId: s.userId, settings }, { item, warehouse: wh, qty: -part.qty, kind: "issue", batch: part.batch, refType: "sales_delivery", refId: dc.id, refNo: number, note: `${o.number} · ${o.clientName}`, binId: x.binId });
      if (item.trackSerials) await serialsOut(tx, s.orgId, item.id, wh.id, x.serials, "delivered", { type: "sales_delivery", id: dc.id, no: number });
    }
    return dc;
  });
  await refreshStatus(o.id, lines);
  await syncOrderReservations(s.orgId, o.id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.delivered", targetType: "sales_order", targetId: o.id, metadata: { challan: number, lines: out.length } });
  return made;
}

/** Proof of delivery: who received it, when. */
export async function markDelivered(s: Scope, id: string, receivedBy: string) {
  requireWrite(s);
  const [d] = await db.select().from(schema.salesDeliveries).where(and(eq(schema.salesDeliveries.id, id), eq(schema.salesDeliveries.orgId, s.orgId)));
  if (!d) throw notFound("Delivery");
  if (d.status !== "dispatched") throw new ApiError("conflict", `This challan is ${d.status}`);
  const [r] = await db.update(schema.salesDeliveries).set({ status: "delivered", deliveredAt: new Date(), receivedBy: receivedBy.trim().slice(0, 120) }).where(eq(schema.salesDeliveries.id, id)).returning();
  return r;
}

/** Undo a challan that never left: stock goes back and it no longer counts as delivered. */
export async function cancelDelivery(s: Scope, id: string) {
  requireWrite(s);
  const [d] = await db.select().from(schema.salesDeliveries).where(and(eq(schema.salesDeliveries.id, id), eq(schema.salesDeliveries.orgId, s.orgId)));
  if (!d) throw notFound("Delivery");
  if (d.status !== "dispatched") throw new ApiError("conflict", d.status === "delivered" ? "It was delivered — record a return instead" : "Already cancelled");
  const o = await getOrder(s.orgId, d.orderId);
  const lines = o.lines.map((l) => ({ ...l }));
  for (const x of d.lines) {
    const l = lines.find((y) => y.id === x.lineId);
    if (!l) continue;
    l.delivered = q3(l.delivered - x.qty);
    if (s.settings.invoiceOn === "delivery" && l.invoiced > l.delivered - l.returned + 0.0005) throw new ApiError("conflict", `${l.name} from this challan is already invoiced — void that invoice first`);
  }
  const settings = { ...(await invSettings(s.orgId)), blockNegative: false };
  await db.transaction(async (tx) => {
    const moves = await tx.select().from(schema.invMoves).where(and(eq(schema.invMoves.orgId, s.orgId), eq(schema.invMoves.refType, "sales_delivery"), eq(schema.invMoves.refId, id)));
    const wh = await getWarehouse(s.orgId, d.warehouseId, tx);
    for (const m of moves) await move(tx, { orgId: s.orgId, userId: s.userId, settings }, { item: await getItem(s.orgId, m.itemId, tx), warehouse: wh, qty: -Number(m.qty), kind: "return", batch: m.batch, refType: "sales_delivery", refId: id, refNo: d.number, note: "Challan cancelled" });
    for (const x of d.lines as { itemId: string; serials?: string[] }[]) if (x.serials?.length) await serialsIn(tx, s.orgId, x.itemId, d.warehouseId, x.serials, { type: "sales_delivery", id: d.id, no: `${d.number} (cancelled)` }, true);
    await tx.update(schema.salesDeliveries).set({ status: "cancelled" }).where(eq(schema.salesDeliveries.id, id));
  });
  await refreshStatus(o.id, lines);
  await syncOrderReservations(s.orgId, o.id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.delivery_cancelled", targetType: "sales_order", targetId: o.id, metadata: { challan: d.number } });
}

// ── Invoicing ───────────────────────────────────────────────────────────────

/** Each order line's invoiced quantity, from its live invoices less issued credit notes. */
export async function recomputeInvoiced(orgId: string, orderIds?: string[]) {
  const links = await db.select().from(schema.salesOrderInvoices).where(and(eq(schema.salesOrderInvoices.orgId, orgId), orderIds ? inArray(schema.salesOrderInvoices.orderId, orderIds) : undefined));
  const ids = [...new Set(links.map((l) => l.orderId))];
  if (!ids.length) return 0;
  const docs = new Map((await db.select({ id: schema.invoiceDocuments.id, type: schema.invoiceDocuments.type, status: schema.invoiceDocuments.status }).from(schema.invoiceDocuments).where(inArray(schema.invoiceDocuments.id, [...new Set(links.map((l) => l.invoiceId))]))).map((d) => [d.id, d]));
  let changed = 0;
  for (const id of ids) {
    const [o] = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, id));
    if (!o) continue;
    const sum = new Map<string, number>();
    for (const l of links.filter((x) => x.orderId === id)) {
      const d = docs.get(l.invoiceId);
      // Gone or void: frees the quantities. Credit notes count once issued; invoices (even drafts) hold them.
      if (!d || d.status === "void" || (d.type === "credit_note" && d.status === "draft")) continue;
      for (const x of l.lines) sum.set(x.lineId, q3((sum.get(x.lineId) ?? 0) + x.qty));
    }
    const lines = o.lines.map((l) => ({ ...l, invoiced: Math.max(0, sum.get(l.id) ?? 0) }));
    if (lines.some((l, i) => l.invoiced !== o.lines[i].invoiced)) {
      await refreshStatus(o.id, lines);
      changed++;
    }
  }
  return changed;
}

/** For the invoicing screens after a void or delete: the workspace owning the books. */
export async function recomputeInvoicedFor(ownerId: string) {
  const rows = (await db.execute(sql`select coalesce(p.org_id, b.org_id) as org_id from invoice_owners o left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where o.id = ${ownerId}`)) as unknown as { rows: { org_id: string }[] };
  if (rows.rows[0]?.org_id) await recomputeInvoiced(rows.rows[0].org_id);
}

function docLines(lines: { line: OrderLine; qty: number }[]): Line[] {
  return lines.map((x, i) => ({ id: `s${i + 1}`, itemId: null, name: x.line.name, description: "", hsn: x.line.hsn, quantity: x.qty, unit: x.line.unit, rate: x.line.rate, discount: x.line.discountPct ? { kind: "percent", value: x.line.discountPct } : null, taxBps: x.line.taxBps }));
}

async function partyFor(o: { ownerId: string; clientId: string }) {
  const [c] = await db.select().from(schema.invoiceClients).where(and(eq(schema.invoiceClients.id, o.clientId), eq(schema.invoiceClients.projectId, o.ownerId)));
  if (!c) throw new ApiError("conflict", "The order's customer is no longer in its books");
  return { client: c, party: partySchema.parse({ name: c.name, company: c.company, email: c.email, phone: c.phone, gstin: c.gstin, billing: c.billing, shipping: c.shipping }) };
}

/** A draft invoice for what's due on the order. */
export async function invoiceOrder(s: Scope, id: string) {
  requireWrite(s);
  await recomputeInvoiced(s.orgId, [id]);
  const o = await getOrder(s.orgId, id);
  if (!LIVE.includes(o.status) && o.status !== "closed") throw new ApiError("conflict", o.status === "pending_approval" ? "This order is waiting for approval" : "Only a confirmed order can be invoiced");
  const due = toInvoice(o.lines, s.settings.invoiceOn);
  if (!due.length) throw new ApiError("conflict", s.settings.invoiceOn === "delivery" && o.lines.some((l) => l.itemId && l.delivered < l.qty) ? "Nothing delivered is left to invoice — deliver it first" : "Everything on this order is invoiced");
  const { client, party } = await partyFor(o);
  const settings = await invoiceSettings(o.ownerId);
  const t = await termsFor(s.orgId, o.clientId);
  const issueDate = todayIst();
  const days = t?.paymentTermsDays ?? settings.dueDays;
  const input: DocInput = {
    type: "invoice",
    clientId: client.id,
    client: party,
    issueDate,
    dueDate: new Date(Date.parse(`${issueDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10),
    currency: "INR",
    lines: docLines(due),
    adjustments: { discount: null, charges: [], roundOff: true },
    taxMode: settings.taxMode,
    inclusive: false,
    placeOfSupply: o.placeOfSupply || party.billing.state,
    title: "",
    reference: o.reference || o.number,
    notes: settings.notes,
    terms: settings.terms,
    footer: "",
    customFields: [{ label: "Sales order", value: o.number }],
    templateId: null,
    recurring: null,
    number: "",
  };
  const doc = await createDoc(o.ownerId, s.userId, input);
  await db.insert(schema.salesOrderInvoices).values({ orgId: s.orgId, orderId: o.id, invoiceId: doc.id, lines: due.map((x) => ({ lineId: x.line.id, qty: x.qty })) });
  await recomputeInvoiced(s.orgId, [o.id]);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.order_invoiced", targetType: "sales_order", targetId: o.id, metadata: { number: o.number, invoiceId: doc.id, total: doc.total } });
  return { invoice: { id: doc.id, total: doc.total, href: await docHref(s.orgId, o.ownerId, doc.id) } };
}

// ── Returns ─────────────────────────────────────────────────────────────────

export async function salesReturns(s: Scope) {
  return db
    .select({ r: schema.salesReturns, order: schema.salesOrders.number, client: schema.salesOrders.clientName })
    .from(schema.salesReturns)
    .innerJoin(schema.salesOrders, eq(schema.salesOrders.id, schema.salesReturns.orderId))
    .where(eq(schema.salesReturns.orgId, s.orgId))
    .orderBy(sql`${schema.salesReturns.date} desc`)
    .limit(300)
    .then((r) => r.map((x) => ({ ...x.r, orderNumber: x.order, client: x.client })));
}

export async function recordReturn(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "delivery");
  const v = check(returnSchema, raw);
  await recomputeInvoiced(s.orgId, [v.orderId]);
  const o = await getOrder(s.orgId, v.orderId);
  const lines = o.lines.map((l) => ({ ...l }));
  const out: { lineId: string; itemId: string | null; name: string; qty: number; reason: string; restock: boolean; serials: string[] }[] = [];
  const credit: { line: OrderLine; qty: number }[] = [];
  for (const r of v.lines) {
    const l = lines.find((x) => x.id === r.lineId);
    if (!l) throw new ApiError("validation_failed", "That line isn't on this order");
    const can = l.itemId ? q3(l.delivered - l.returned) : q3(l.invoiced);
    if (r.qty > can + 0.0005) throw new ApiError("validation_failed", `Only ${can} of ${l.name} can come back`);
    // Credit what was billed for these goods: the part of the return beyond what's delivered but not yet invoiced.
    const unbilled = l.itemId ? Math.max(0, q3(l.delivered - l.returned - l.invoiced)) : 0;
    const creditQty = Math.min(r.qty, Math.max(0, q3(r.qty - unbilled)), l.invoiced);
    if (v.creditNote && creditQty > 0) credit.push({ line: l, qty: q3(creditQty) });
    if (l.itemId) l.returned = q3(l.returned + r.qty);
    if (l.itemId && r.restock) needSerials(await getItem(s.orgId, l.itemId), r.qty, r.serials);
    out.push({ lineId: l.id, itemId: l.itemId, name: l.name, qty: r.qty, reason: r.reason, restock: !!l.itemId && r.restock, serials: r.serials });
  }
  const restock = out.filter((x) => x.restock);
  const wh = restock.length ? await warehouseFor(s, v.warehouseId, o) : null;
  const number = await nextNumber(s.orgId, "return", s.settings.returnPrefix);
  const settings = await invSettings(s.orgId);
  const made = await db.transaction(async (tx) => {
    const [ret] = await tx.insert(schema.salesReturns).values({ orgId: s.orgId, number, orderId: o.id, date: v.date, warehouseId: wh?.id ?? null, lines: out, notes: v.notes, createdBy: s.userId }).returning();
    for (const x of restock) {
      const item = await getItem(s.orgId, x.itemId!, tx);
      await move(tx, { orgId: s.orgId, userId: s.userId, settings }, { item, warehouse: wh!, qty: x.qty, kind: "return", refType: "sales_return", refId: ret.id, refNo: number, note: `${o.number} · ${x.reason}` });
      if (item.trackSerials) await serialsIn(tx, s.orgId, item.id, wh!.id, x.serials, { type: "sales_return", id: ret.id, no: number }, true);
    }
    return ret;
  });
  await refreshStatus(o.id, lines);
  let creditNote: { id: string; href: string } | null = null;
  if (credit.length) {
    const { client, party } = await partyFor(o);
    const settings2 = await invoiceSettings(o.ownerId);
    const doc = await createDoc(o.ownerId, s.userId, { type: "credit_note", clientId: client.id, client: party, issueDate: v.date, dueDate: null, currency: "INR", lines: docLines(credit), adjustments: { discount: null, charges: [], roundOff: true }, taxMode: settings2.taxMode, inclusive: false, placeOfSupply: o.placeOfSupply || party.billing.state, title: "", reference: o.number, notes: `Goods returned: ${number}`, terms: "", footer: "", customFields: [{ label: "Sales return", value: number }], templateId: null, recurring: null, number: "" });
    await db.insert(schema.salesOrderInvoices).values({ orgId: s.orgId, orderId: o.id, invoiceId: doc.id, lines: credit.map((x) => ({ lineId: x.line.id, qty: -x.qty })) });
    await db.update(schema.salesReturns).set({ creditNoteId: doc.id }).where(eq(schema.salesReturns.id, made.id));
    creditNote = { id: doc.id, href: await docHref(s.orgId, o.ownerId, doc.id, "credit-notes") };
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.returned", targetType: "sales_order", targetId: o.id, metadata: { number, lines: out.length, creditNote: creditNote?.id ?? null } });
  return { return: made, creditNote };
}
