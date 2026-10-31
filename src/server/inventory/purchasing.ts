// Purchasing: purchase orders to suppliers, goods received (against an order
// or on their own), and what to reorder. Receiving is what changes stock and
// the items' average cost; orders only promise it.
import { supplierPortalUrl } from "../portal/auth";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { contractRate, isInterState, poSchema, purchaseTotals, q3, receiptSchema, suggestedOrder, weightedAverage } from "@/lib/inventory/model";
import { ApiError, notFound } from "../http/errors";
import { cancelFor, gate } from "../approvals/engine";
import { audit } from "../services/audit";
import { appUrl, mailProvider, sendMail } from "../services/mail";
import { check, nextNumber, requirePart, requireWarehouseAccess, requireWrite, todayIst, type Scope } from "./access";
import { balances, getWarehouse, move, onOrder, reserved, totals } from "./stock";
import { needSerials, serialsIn } from "./warehouse";
import { emit } from "../hub/core";

type PO = typeof schema.invPurchaseOrders.$inferSelect;

async function supplier(orgId: string, id: string) {
  const [s] = await db.select().from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, orgId), eq(schema.invSuppliers.id, id)));
  if (!s) throw new ApiError("validation_failed", "Pick a supplier from this workspace");
  return s;
}

async function itemsById(orgId: string, ids: string[]) {
  const rows = ids.length ? await db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), inArray(schema.invItems.id, [...new Set(ids)]))) : [];
  if (rows.length !== new Set(ids).size) throw new ApiError("validation_failed", "Some items aren't in this workspace");
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getPo(orgId: string, id: string) {
  const [p] = await db.select().from(schema.invPurchaseOrders).where(and(eq(schema.invPurchaseOrders.orgId, orgId), eq(schema.invPurchaseOrders.id, id)));
  if (!p) throw notFound("Purchase order");
  return p;
}

export async function listPos(s: Scope, opts: { status?: string; supplierId?: string } = {}) {
  const rows = await db
    .select({ po: schema.invPurchaseOrders, supplier: schema.invSuppliers.name, warehouse: schema.invWarehouses.name })
    .from(schema.invPurchaseOrders)
    .innerJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.invPurchaseOrders.supplierId))
    .innerJoin(schema.invWarehouses, eq(schema.invWarehouses.id, schema.invPurchaseOrders.warehouseId))
    .where(
      and(
        eq(schema.invPurchaseOrders.orgId, s.orgId),
        opts.status === "open" ? inArray(schema.invPurchaseOrders.status, ["draft", "sent", "partial"]) : opts.status ? eq(schema.invPurchaseOrders.status, opts.status) : undefined,
        opts.supplierId ? eq(schema.invPurchaseOrders.supplierId, opts.supplierId) : undefined,
      ),
    )
    .orderBy(desc(schema.invPurchaseOrders.createdAt))
    .limit(300);
  const today = todayIst();
  return rows.map((r) => ({ ...r.po, supplier: r.supplier, warehouse: r.warehouse, late: ["sent", "partial"].includes(r.po.status) && !!r.po.expectedDate && String(r.po.expectedDate) < today }));
}

export async function poDetail(s: Scope, id: string) {
  const po = await getPo(s.orgId, id);
  const [sup, wh, items, receipts, org] = await Promise.all([
    supplier(s.orgId, po.supplierId),
    getWarehouse(s.orgId, po.warehouseId),
    po.lines.length ? db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku, unit: schema.invItems.unit, hsn: schema.invItems.hsn }).from(schema.invItems).where(inArray(schema.invItems.id, po.lines.map((l) => l.itemId))) : [],
    db.select().from(schema.invReceipts).where(eq(schema.invReceipts.poId, id)).orderBy(asc(schema.invReceipts.createdAt)),
    db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId)),
  ]);
  const t = purchaseTotals(po.lines, po.interState);
  return { po, supplier: sup, warehouse: wh, items, receipts, split: t.split, rows: t.rows, company: org[0]?.name ?? "", terms: s.settings.poTerms, warnings: await poWarnings(s, po, items) };
}

/** Prices above the supplier's agreed rate, and categories this order takes over their month's budget. */
async function poWarnings(s: Scope, po: PO, items: { id: string; name: string }[]) {
  const out: string[] = [];
  const day = String(po.orderDate);
  const rates = await db.select().from(schema.invSupplierRates).where(and(eq(schema.invSupplierRates.orgId, s.orgId), eq(schema.invSupplierRates.supplierId, po.supplierId)));
  const R = rates.map((r) => ({ ...r, minQty: Number(r.minQty), validFrom: r.validFrom ? String(r.validFrom) : null, validTo: r.validTo ? String(r.validTo) : null }));
  for (const l of po.lines) {
    const agreed = contractRate(R, l.itemId, l.qty, day);
    if (agreed !== null && l.rate > agreed) out.push(`${items.find((i) => i.id === l.itemId)?.name ?? "An item"} is at ₹${(l.rate / 100).toFixed(2)}, above the agreed ₹${(agreed / 100).toFixed(2)}`);
  }
  if (s.settings.budgetCheck !== "off") {
    const month = day.slice(0, 7);
    const budgets = await db.select().from(schema.invPurchaseBudgets).where(and(eq(schema.invPurchaseBudgets.orgId, s.orgId), eq(schema.invPurchaseBudgets.month, month)));
    if (budgets.length) {
      const used = await committed(s.orgId, month);
      for (const b of budgets) if ((used.get(b.category) ?? 0) > b.amount) out.push(`${b.category || "Uncategorised"} purchases in ${month} are ₹${Math.round((used.get(b.category) ?? 0) / 100).toLocaleString("en-IN")}, over the ₹${Math.round(b.amount / 100).toLocaleString("en-IN")} budget`);
    }
  }
  return out;
}

function priced(lines: PO["lines"], interState: boolean) {
  const t = purchaseTotals(lines, interState);
  return { subtotal: t.subtotal, tax: t.tax, total: t.total };
}

export async function savePo(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const b = check(poSchema, raw);
  requireWarehouseAccess(s, b.warehouseId);
  const [sup, wh] = await Promise.all([supplier(s.orgId, b.supplierId), getWarehouse(s.orgId, b.warehouseId)]);
  const items = await itemsById(s.orgId, b.lines.map((l) => l.itemId));
  assertSupplierOk(s, sup);
  await budgetCheck(s, id, b.orderDate, b.lines.map((l) => ({ category: items.get(l.itemId)!.category, amount: Math.round(l.qty * l.rate) })));
  const interState = isInterState(sup.state, wh.state);
  if (id) {
    const cur = await getPo(s.orgId, id);
    if (!["draft", "sent", "partial"].includes(cur.status)) throw new ApiError("conflict", `A ${cur.status} order can't be changed`);
    if (cur.status !== "draft" && cur.supplierId !== b.supplierId) throw new ApiError("conflict", "The supplier can't change once the order is sent");
    // Keep what's been received; a line can't drop below it.
    const lines = b.lines.map((l) => ({ ...l, received: cur.lines.find((x) => x.itemId === l.itemId)?.received ?? 0 }));
    for (const old of cur.lines) {
      const now = lines.find((l) => l.itemId === old.itemId);
      if (old.received > 0 && (!now || now.qty < old.received)) throw new ApiError("conflict", "A line can't go below what's already been received");
    }
    const [r] = await db.update(schema.invPurchaseOrders).set({ ...b, lines, interState, ...priced(lines, interState), updatedAt: new Date() }).where(eq(schema.invPurchaseOrders.id, id)).returning();
    return r;
  }
  const number = await nextNumber(s.orgId, "po", s.settings.poPrefix);
  const lines = b.lines.map((l) => ({ ...l, received: 0 }));
  const [r] = await db.insert(schema.invPurchaseOrders).values({ ...b, orgId: s.orgId, number, lines, interState, ...priced(lines, interState), createdBy: s.userId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.po_created", targetType: "inv_po", targetId: r.id, metadata: { number, total: r.total } });
  return r;
}

/**
 * Mark an order sent, and email it to the supplier when there's an address and
 * a mail service. Without one it's marked sent and the screen says it wasn't emailed.
 */
export async function sendPo(s: Scope, id: string, opts: { email?: boolean } = {}) {
  requireWrite(s);
  const d = await poDetail(s, id);
  assertSupplierOk(s, d.supplier);
  if (!["draft", "sent"].includes(d.po.status)) throw new ApiError("conflict", `A ${d.po.status} order can't be sent`);
  // An order that needs approval waits for it; it's sent once approved.
  const g = await poGate(s, d.po);
  if (g.status === "pending") return { emailed: false, pendingApproval: true, approval: g.request!.id, reason: `Waiting for approval (${g.request!.policyName}). Send it once it's approved.`, printUrl: null };
  let emailed = false;
  if (opts.email !== false && d.supplier.email && mailProvider() !== "outbox") {
    const names = new Map(d.items.map((i) => [i.id, i]));
    const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const portal = await supplierPortalUrl(s.orgId);
    const body = [
      `Hello ${d.supplier.contactName || d.supplier.name},`,
      "",
      `Please supply the following against purchase order ${d.po.number}${d.po.expectedDate ? `, by ${d.po.expectedDate}` : ""}:`,
      "",
      ...d.po.lines.map((l) => `• ${names.get(l.itemId)?.name ?? "Item"} — ${l.qty} ${names.get(l.itemId)?.unit ?? ""} × ${rupees(l.rate)} (+${l.gstRate}% GST)`),
      "",
      `Total including GST: ${rupees(d.po.total)}`,
      `Deliver to: ${d.warehouse.name}${d.warehouse.address ? `, ${d.warehouse.address}` : ""}`,
      "",
      d.terms,
      "",
      ...(portal ? [`Acknowledge this order, tell us what you've dispatched and send your invoice at ${portal} (sign in with this email address).`, ""] : []),
      `— ${d.company}`,
    ].join("\n");
    await sendMail({ to: d.supplier.email, subject: `Purchase order ${d.po.number} from ${d.company}`, body, fromName: d.company });
    emailed = true;
  }
  await db.update(schema.invPurchaseOrders).set({ status: d.po.status === "draft" ? "sent" : d.po.status, sentAt: new Date(), updatedAt: new Date() }).where(eq(schema.invPurchaseOrders.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.po_sent", targetType: "inv_po", targetId: id, metadata: { emailed, to: emailed ? d.supplier.email : null } });
  await emit(s.orgId, "inventory.po.sent", { id, number: d.po.number, supplierId: d.supplier.id, supplierName: d.supplier.name, totalPaise: d.po.total, emailed });
  return { emailed, reason: emailed ? null : !d.supplier.email ? "The supplier has no email address" : "No mail service is set up for this workspace", printUrl: appUrl(`/inventory/orders/${id}/print`) };
}

type Po = typeof schema.invPurchaseOrders.$inferSelect;
type Supplier = typeof schema.invSuppliers.$inferSelect;

/** Blocked suppliers can't be ordered from; when the workspace asks for it, only approved ones can. */
function assertSupplierOk(s: Scope, sup: Supplier) {
  if (sup.approval === "blocked") throw new ApiError("conflict", `${sup.name} is blocked — no new orders`);
  if (s.settings.requireApprovedSupplier && sup.approval !== "approved") throw new ApiError("conflict", `${sup.name} isn't approved yet — finish their onboarding in Suppliers`);
}

/** Purchases of a category in a month against its budget (before GST; cancelled orders don't count). */
export async function committed(orgId: string, month: string, exceptPo?: string | null) {
  const rows = (await db.execute(sql`
    select coalesce(i.category, '') as category, sum(round((l->>'qty')::numeric * (l->>'rate')::numeric))::bigint as amount
    from inv_purchase_orders p cross join lateral jsonb_array_elements(p.lines) l left join inv_items i on i.id = (l->>'itemId')::uuid
    where p.org_id = ${orgId} and p.status <> 'cancelled' and to_char(p.order_date, 'YYYY-MM') = ${month} ${exceptPo ? sql`and p.id <> ${exceptPo}` : sql``}
    group by 1`)) as unknown as { rows: { category: string; amount: number }[] };
  return new Map(rows.rows.map((r) => [r.category, Number(r.amount)]));
}

async function budgetCheck(s: Scope, poId: string | null, orderDate: string, lines: { category: string; amount: number }[]) {
  if (s.settings.budgetCheck === "off") return;
  const month = orderDate.slice(0, 7);
  const budgets = await db.select().from(schema.invPurchaseBudgets).where(and(eq(schema.invPurchaseBudgets.orgId, s.orgId), eq(schema.invPurchaseBudgets.month, month)));
  if (!budgets.length) return;
  const used = await committed(s.orgId, month, poId);
  for (const b of budgets) {
    const adding = lines.filter((l) => l.category === b.category).reduce((a, l) => a + l.amount, 0);
    if (!adding) continue;
    const total = (used.get(b.category) ?? 0) + adding;
    if (total > b.amount && s.settings.budgetCheck === "block") throw new ApiError("conflict", `This takes ${b.category || "uncategorised"} purchases in ${month} to ₹${Math.round(total / 100).toLocaleString("en-IN")} against a budget of ₹${Math.round(b.amount / 100).toLocaleString("en-IN")}`);
  }
}
async function poGate(s: Scope, po: Po) {
  const [sup] = await db.select({ name: schema.invSuppliers.name }).from(schema.invSuppliers).where(eq(schema.invSuppliers.id, po.supplierId));
  return gate(s.orgId, { kind: "inv.po", refId: po.id, label: `${po.number} · ${sup?.name ?? "Supplier"}`, amount: po.total, requesterId: s.userId || po.createdBy, link: `/inventory/orders/${po.id}` });
}

export async function cancelPo(s: Scope, id: string) {
  requireWrite(s);
  const po = await getPo(s.orgId, id);
  if (po.lines.some((l) => l.received > 0)) throw new ApiError("conflict", "Part of this order has been received — close it instead");
  if (!["draft", "sent"].includes(po.status)) throw new ApiError("conflict", `A ${po.status} order can't be cancelled`);
  await db.update(schema.invPurchaseOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.invPurchaseOrders.id, id));
  await cancelFor(s.orgId, "inv.po", id, s.userId, "The order was cancelled");
}

/** Stop waiting for the rest of a part-received order. */
export async function closePo(s: Scope, id: string) {
  requireWrite(s);
  const po = await getPo(s.orgId, id);
  if (po.status !== "partial") throw new ApiError("conflict", "Only a part-received order can be closed");
  await db.update(schema.invPurchaseOrders).set({ status: "closed", updatedAt: new Date() }).where(eq(schema.invPurchaseOrders.id, id));
}

export async function deletePo(s: Scope, id: string) {
  requireWrite(s);
  const po = await getPo(s.orgId, id);
  if (po.status !== "draft") throw new ApiError("conflict", "Only a draft can be deleted — cancel a sent order instead");
  await db.delete(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.id, id));
  await cancelFor(s.orgId, "inv.po", id, s.userId, "The order was deleted");
}

// ─── Goods received ───

/**
 * Receive goods: stock goes up at the location, each item's average cost is
 * re-worked with what was paid, and an order's lines count what's arrived.
 * More than was ordered isn't accepted against an order.
 */
export async function receive(s: Scope, raw: unknown) {
  requireWrite(s);
  const b = check(receiptSchema, raw);
  const po = b.poId ? await getPo(s.orgId, b.poId) : null;
  if (po && !["sent", "partial", "draft"].includes(po.status)) throw new ApiError("conflict", `This order is ${po.status}`);
  if (po && b.warehouseId !== po.warehouseId) throw new ApiError("validation_failed", "Receive into the location the order is for");
  if (po?.status === "draft" && (await poGate(s, po)).status === "pending") throw new ApiError("conflict", "This order is waiting for approval — goods can be received against it once it's approved");
  const supplierId = po?.supplierId ?? b.supplierId;
  if (supplierId) await supplier(s.orgId, supplierId);
  const items = await itemsById(s.orgId, b.lines.map((l) => l.itemId));
  if (b.lines.some((l) => l.batch || l.expiry)) requirePart(s, "batches");
  for (const l of b.lines) {
    const it = items.get(l.itemId)!;
    if (it.trackBatches && !l.batch) throw new ApiError("validation_failed", `${it.name} is tracked by batch — enter a batch number`, { [`lines`]: ["Batch needed"] });
    needSerials(it, q3(l.qty - l.rejected), l.serials);
  }
  for (const l of b.lines) if (l.rejected > l.qty + 0.0005) throw new ApiError("validation_failed", `More of ${items.get(l.itemId)!.name} was rejected than arrived`);
  // What passed inspection goes into stock and onto the order; what was rejected is only recorded.
  const accepted = b.lines.map((l) => ({ ...l, qty: q3(l.qty - l.rejected) }));
  if (!accepted.some((l) => l.qty > 0) && !b.lines.some((l) => l.rejected > 0)) throw new ApiError("validation_failed", "Nothing was received");
  const lines = po
    ? (() => {
        const left = new Map(po.lines.map((l) => [l.itemId, q3(l.qty - l.received)]));
        return accepted.map((l) => {
          if (!left.has(l.itemId)) throw new ApiError("validation_failed", `${items.get(l.itemId)!.name} isn't on ${po.number}`);
          const room = left.get(l.itemId)!;
          if (l.qty > room + 0.0005) throw new ApiError("validation_failed", `Only ${room} more of ${items.get(l.itemId)!.name} is due on ${po.number}`);
          left.set(l.itemId, q3(room - l.qty));
          const pl = po.lines.find((x) => x.itemId === l.itemId)!;
          return { ...l, rate: l.rate || pl.rate, gstRate: l.gstRate || pl.gstRate };
        });
      })()
    : accepted;
  requireWarehouseAccess(s, b.warehouseId);
  const wh = await getWarehouse(s.orgId, b.warehouseId);
  const sup = supplierId ? await supplier(s.orgId, supplierId) : null;
  const t = purchaseTotals(lines, isInterState(sup?.state ?? "", wh.state));
  const number = await nextNumber(s.orgId, "grn", s.settings.grnPrefix);
  const onHandBefore = totals(await balances(s.orgId, { itemIds: [...items.keys()] }));
  const grn = await db.transaction(async (tx) => {
    const [r] = await tx.insert(schema.invReceipts).values({ orgId: s.orgId, number, poId: po?.id ?? null, supplierId, warehouseId: wh.id, date: b.date, supplierInvoice: b.supplierInvoice, lines, subtotal: t.subtotal, tax: t.tax, total: t.total, notes: b.notes, createdBy: s.userId }).returning();
    const running = new Map(onHandBefore);
    for (const l of lines) {
      if (!l.qty) continue;
      const it = items.get(l.itemId)!;
      const before = running.get(it.id) ?? 0;
      const avg = weightedAverage(before, it.avgCost, l.qty, l.rate);
      await move(tx, s, { item: it, warehouse: wh, qty: l.qty, kind: "receive", batch: l.batch, expiry: l.expiry, unitCost: l.rate, refType: "receipt", refId: r.id, refNo: number, binId: l.binId });
      if (it.trackSerials) await serialsIn(tx, s.orgId, it.id, wh.id, l.serials, { type: "receipt", id: r.id, no: number });
      await tx.update(schema.invItems).set({ avgCost: avg, updatedAt: new Date() }).where(eq(schema.invItems.id, it.id));
      items.set(it.id, { ...it, avgCost: avg });
      running.set(it.id, q3(before + l.qty));
    }
    if (po) {
      const got = new Map<string, number>();
      for (const l of lines) got.set(l.itemId, q3((got.get(l.itemId) ?? 0) + l.qty));
      const poLines = po.lines.map((l) => ({ ...l, received: q3(l.received + (got.get(l.itemId) ?? 0)) }));
      const done = poLines.every((l) => l.received + 0.0005 >= l.qty);
      await tx.update(schema.invPurchaseOrders).set({ lines: poLines, status: done ? "received" : "partial", updatedAt: new Date() }).where(eq(schema.invPurchaseOrders.id, po.id));
    }
    return r;
  });
  await emit(s.orgId, "inventory.goods.received", { id: grn.id, number, poId: po?.id ?? null, poNumber: po?.number ?? null, supplierId: grn.supplierId, totalPaise: grn.total });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.received", targetType: "inv_receipt", targetId: grn.id, metadata: { number, po: po?.number ?? null, total: grn.total, rejected: lines.filter((l) => l.rejected).length } });
  // Items with an inspection plan for goods received get an inspection waiting.
  const { queueInspections } = await import("../quality/core");
  await queueInspections(s.orgId, "receipt", { type: "receipt", id: grn.id, no: number }, lines.filter((l) => l.qty > 0).map((l) => ({ itemId: l.itemId, qty: l.qty, warehouseId: wh.id, batch: l.batch, binId: l.binId, supplierId: supplierId ?? null })));
  return grn;
}

export async function receipts(s: Scope) {
  return db
    .select({ r: schema.invReceipts, supplier: schema.invSuppliers.name, warehouse: schema.invWarehouses.name, po: schema.invPurchaseOrders.number })
    .from(schema.invReceipts)
    .leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.invReceipts.supplierId))
    .innerJoin(schema.invWarehouses, eq(schema.invWarehouses.id, schema.invReceipts.warehouseId))
    .leftJoin(schema.invPurchaseOrders, eq(schema.invPurchaseOrders.id, schema.invReceipts.poId))
    .where(eq(schema.invReceipts.orgId, s.orgId))
    .orderBy(desc(schema.invReceipts.createdAt))
    .limit(200)
    .then((rows) => rows.map((x) => ({ ...x.r, supplier: x.supplier, warehouse: x.warehouse, poNumber: x.po })));
}

// ─── Reorder ───

/** Items at or below their reorder level once what's on order is counted, grouped by supplier. */
export async function reorderList(s: Scope) {
  const items = await db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), eq(schema.invItems.active, true), sql`(${schema.invItems.reorderLevel} > 0 or ${schema.invItems.safetyStock} > 0)`));
  const [bal, ordered, sups, held] = await Promise.all([balances(s.orgId, { itemIds: items.map((i) => i.id) }), onOrder(s.orgId), db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name, leadTimeDays: schema.invSuppliers.leadTimeDays }).from(schema.invSuppliers).where(eq(schema.invSuppliers.orgId, s.orgId)), reserved(s.orgId)]);
  const tot = totals(bal);
  // What's promised to orders isn't there to sell again: reorder on what's free, keeping the safety stock.
  const rows = items
    .map((it) => {
      const onHand = tot.get(it.id) ?? 0;
      const free = q3(onHand - (held.get(it.id) ?? 0));
      const oo = ordered.get(it.id) ?? 0;
      return { id: it.id, name: it.name, sku: it.sku, unit: it.unit, onHand, reserved: held.get(it.id) ?? 0, onOrder: oo, reorderLevel: it.reorderLevel, safetyStock: it.safetyStock, suggest: suggestedOrder(free, oo, it.reorderLevel, it.reorderQty, it.safetyStock), rate: it.avgCost, gstRate: it.gstRate, supplierId: it.supplierId, free };
    })
    .filter((r) => r.free <= r.reorderLevel + r.safetyStock);
  return { rows, suppliers: sups };
}

const reorderSchema = z.object({
  warehouseId: z.uuid(),
  lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().gt(0), supplierId: z.uuid().nullable() })).min(1, "Pick at least one item").max(500),
});

/** One draft order per supplier for the chosen lines; lines without a supplier are left out and listed. */
export async function draftFromReorder(s: Scope, raw: unknown) {
  requireWrite(s);
  const b = check(reorderSchema, raw);
  const items = await itemsById(s.orgId, b.lines.map((l) => l.itemId));
  const bySupplier = new Map<string, typeof b.lines>();
  const skipped: string[] = [];
  for (const l of b.lines) {
    const sup = l.supplierId ?? items.get(l.itemId)!.supplierId;
    if (!sup) skipped.push(items.get(l.itemId)!.name);
    else bySupplier.set(sup, [...(bySupplier.get(sup) ?? []), l]);
  }
  const made = [];
  for (const [supplierId, lines] of bySupplier) {
    made.push(await savePo(s, null, { supplierId, warehouseId: b.warehouseId, orderDate: todayIst(), lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: items.get(l.itemId)!.avgCost, gstRate: items.get(l.itemId)!.gstRate })) }));
  }
  return { orders: made.map((p) => ({ id: p.id, number: p.number })), skipped };
}
