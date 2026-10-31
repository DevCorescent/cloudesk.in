// Procurement on top of purchasing: requisitions (asked for, approved, turned
// into purchase orders or an RFQ), RFQs with quotes compared and awarded,
// agreed supplier rates, supplier onboarding, returns to suppliers (stock out,
// with a debit note on the bill), the 3-way match, supplier performance and
// purchase budgets by category.
import { supplierPortalUrl } from "../portal/auth";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { awardSchema, compareQuotes, onboardingSchema, purchaseBudgetSchema, purchaseTotals, q3, quoteSchema, requisitionSchema, rfqSchema, supplierRateSchema, supplierReturnSchema, supplierScore, threeWay, isInterState } from "@/lib/inventory/model";
import { isOn } from "@/lib/workspace/modules";
import { cancelFor, gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { mailProvider, sendMail } from "../services/mail";
import { check, requireManage, requirePart, requireWarehouseAccess, requireWrite, todayIst, type Scope } from "./access";
import { committed, savePo } from "./purchasing";
import { needSerials, serialsOut } from "./warehouse";
import { allocate, getItem, getWarehouse, move } from "./stock";

/** The next number in a procurement series (REQ-0001, RFQ-0001, RTV-0001). */
async function nextNumber(orgId: string, kind: "requisition" | "rfq" | "return", prefix: string) {
  await db.insert(schema.invSettings).values({ orgId }).onConflictDoNothing();
  const rows = (await db.execute(sql`update inv_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(4, "0")}`;
}

async function items(orgId: string, ids: string[]) {
  const rows = ids.length ? await db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), inArray(schema.invItems.id, [...new Set(ids)]))) : [];
  if (rows.length !== new Set(ids).size) throw new ApiError("validation_failed", "Some items aren't in this workspace");
  return new Map(rows.map((r) => [r.id, r]));
}

async function suppliersIn(orgId: string, ids: string[]) {
  const rows = ids.length ? await db.select().from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, orgId), inArray(schema.invSuppliers.id, [...new Set(ids)]))) : [];
  if (rows.length !== new Set(ids).size) throw new ApiError("validation_failed", "Pick suppliers from this workspace");
  return new Map(rows.map((r) => [r.id, r]));
}

// ── Requisitions ────────────────────────────────────────────────────────────

async function getReq(orgId: string, id: string) {
  const [r] = await db.select().from(schema.invRequisitions).where(and(eq(schema.invRequisitions.id, id), eq(schema.invRequisitions.orgId, orgId)));
  if (!r) throw notFound("Requisition");
  return r;
}

export async function requisitions(s: Scope, q: { status?: string } = {}) {
  const rows = await db.select({ r: schema.invRequisitions, by: schema.users.name }).from(schema.invRequisitions).leftJoin(schema.users, eq(schema.users.id, schema.invRequisitions.requestedBy)).where(and(eq(schema.invRequisitions.orgId, s.orgId), q.status ? eq(schema.invRequisitions.status, q.status) : undefined)).orderBy(desc(schema.invRequisitions.createdAt)).limit(300);
  return rows.map((x) => ({ ...x.r, requestedByName: x.by ?? "" }));
}

export async function saveRequisition(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "purchasing");
  requirePart(s, "procurement");
  const v = check(requisitionSchema, raw);
  requireWarehouseAccess(s, v.warehouseId);
  await getWarehouse(s.orgId, v.warehouseId);
  const its = await items(s.orgId, v.lines.map((l) => l.itemId));
  // Without an estimate, the item's average cost.
  const lines = v.lines.map((l) => ({ ...l, estRate: l.estRate || its.get(l.itemId)!.avgCost }));
  const total = lines.reduce((a, l) => a + Math.round(l.qty * l.estRate), 0);
  if (id) {
    const cur = await getReq(s.orgId, id);
    if (!["draft", "rejected"].includes(cur.status)) throw new ApiError("conflict", "Only a draft or sent-back requisition can change");
    const [r] = await db.update(schema.invRequisitions).set({ ...v, lines, total, status: "draft", updatedAt: new Date() }).where(eq(schema.invRequisitions.id, id)).returning();
    return r;
  }
  const number = await nextNumber(s.orgId, "requisition", s.settings.requisitionPrefix);
  const [r] = await db.insert(schema.invRequisitions).values({ ...v, lines, total, number, orgId: s.orgId, requestedBy: s.userId }).returning();
  return r;
}

/** Ask for approval: through a rule for requisitions, or approved at once when none applies. */
export async function submitRequisition(s: Scope, id: string) {
  requireWrite(s);
  const r = await getReq(s.orgId, id);
  if (!["draft", "rejected"].includes(r.status)) throw new ApiError("conflict", "This requisition was already sent");
  const g = await gate(s.orgId, { kind: "inv.requisition", refId: r.id, label: `${r.number}${r.reason ? ` · ${r.reason.slice(0, 60)}` : ""}`, amount: r.total, requesterId: s.userId, link: `/inventory/requisitions/${r.id}` });
  const status = g.status === "pending" ? "pending_approval" : "approved";
  await db.update(schema.invRequisitions).set({ status, updatedAt: new Date() }).where(eq(schema.invRequisitions.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.requisition_submitted", targetType: "inv_requisition", targetId: id, metadata: { number: r.number, status } });
  return { status };
}

export async function requisitionDecided(orgId: string, id: string, approved: boolean) {
  await db.update(schema.invRequisitions).set({ status: approved ? "approved" : "rejected", updatedAt: new Date() }).where(and(eq(schema.invRequisitions.id, id), eq(schema.invRequisitions.orgId, orgId), eq(schema.invRequisitions.status, "pending_approval")));
}

export async function cancelRequisition(s: Scope, id: string) {
  requireWrite(s);
  const r = await getReq(s.orgId, id);
  if (["ordered", "cancelled"].includes(r.status)) throw new ApiError("conflict", `This requisition is ${r.status}`);
  if (r.status === "pending_approval") await cancelFor(s.orgId, "inv.requisition", id, s.userId, "The requisition was cancelled");
  await db.update(schema.invRequisitions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.invRequisitions.id, id));
}

/**
 * Turn an approved requisition into draft purchase orders: one per supplier,
 * each item going to the supplier picked for it, else its usual supplier.
 */
export async function requisitionToPos(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const r = await getReq(s.orgId, id);
  if (r.status !== "approved") throw new ApiError("conflict", r.status === "pending_approval" ? "This requisition is waiting for approval" : "Only an approved requisition can be ordered");
  const picks = ((raw as { suppliers?: Record<string, string> })?.suppliers ?? {}) as Record<string, string>;
  const its = await items(s.orgId, r.lines.map((l) => l.itemId));
  const groups = new Map<string, typeof r.lines>();
  for (const l of r.lines) {
    const sup = picks[l.itemId] || its.get(l.itemId)!.supplierId;
    if (!sup) throw new ApiError("validation_failed", `Pick a supplier for ${its.get(l.itemId)!.name}`);
    groups.set(sup, [...(groups.get(sup) ?? []), l]);
  }
  await suppliersIn(s.orgId, [...groups.keys()]);
  const made: string[] = [];
  for (const [supplierId, lines] of groups) {
    const po = await savePo(s, null, { supplierId, warehouseId: r.warehouseId, orderDate: todayIst(), expectedDate: r.neededBy ? String(r.neededBy) : null, notes: `From ${r.number}`, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.estRate, gstRate: its.get(l.itemId)!.gstRate })) });
    made.push(po.id);
  }
  await db.update(schema.invRequisitions).set({ status: "ordered", poIds: made, updatedAt: new Date() }).where(eq(schema.invRequisitions.id, id));
  return { poIds: made };
}

// ── RFQs ────────────────────────────────────────────────────────────────────

async function getRfq(orgId: string, id: string) {
  const [r] = await db.select().from(schema.invRfqs).where(and(eq(schema.invRfqs.id, id), eq(schema.invRfqs.orgId, orgId)));
  if (!r) throw notFound("RFQ");
  return r;
}

export async function rfqs(s: Scope) {
  const rows = await db.select().from(schema.invRfqs).where(eq(schema.invRfqs.orgId, s.orgId)).orderBy(desc(schema.invRfqs.createdAt)).limit(200);
  const counts = rows.length ? await db.select({ rfqId: schema.invRfqQuotes.rfqId, n: sql<number>`count(*)::int` }).from(schema.invRfqQuotes).where(inArray(schema.invRfqQuotes.rfqId, rows.map((r) => r.id))).groupBy(schema.invRfqQuotes.rfqId) : [];
  return rows.map((r) => ({ ...r, quotes: counts.find((c) => c.rfqId === r.id)?.n ?? 0 }));
}

export async function rfqDetail(s: Scope, id: string) {
  const r = await getRfq(s.orgId, id);
  const quotes = await db.select().from(schema.invRfqQuotes).where(eq(schema.invRfqQuotes.rfqId, id)).orderBy(asc(schema.invRfqQuotes.createdAt));
  const sups = await db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name, email: schema.invSuppliers.email }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, s.orgId), inArray(schema.invSuppliers.id, r.supplierIds.length ? r.supplierIds : [r.id])));
  const its = r.lines.length ? await db.select({ id: schema.invItems.id, name: schema.invItems.name, unit: schema.invItems.unit }).from(schema.invItems).where(inArray(schema.invItems.id, r.lines.map((l) => l.itemId))) : [];
  return { rfq: r, quotes, suppliers: sups, items: its, comparison: compareQuotes(r.lines, quotes) };
}

export async function saveRfq(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "purchasing");
  requirePart(s, "procurement");
  const v = check(rfqSchema, raw);
  await getWarehouse(s.orgId, v.warehouseId);
  await items(s.orgId, v.lines.map((l) => l.itemId));
  const sups = await suppliersIn(s.orgId, v.supplierIds);
  for (const sp of sups.values()) if (sp.approval === "blocked") throw new ApiError("validation_failed", `${sp.name} is blocked`);
  const number = await nextNumber(s.orgId, "rfq", s.settings.rfqPrefix);
  const [r] = await db.insert(schema.invRfqs).values({ orgId: s.orgId, number, title: v.title, warehouseId: v.warehouseId, dueDate: v.dueDate, lines: v.lines, supplierIds: [...new Set(v.supplierIds)], notes: v.notes, createdBy: s.userId }).returning();
  if (v.requisitionId) {
    const req = await getReq(s.orgId, v.requisitionId);
    if (req.status !== "approved") throw new ApiError("conflict", "Only an approved requisition can go out for quotes");
    await db.update(schema.invRequisitions).set({ rfqId: r.id, status: "ordered", updatedAt: new Date() }).where(eq(schema.invRequisitions.id, req.id));
  }
  return r;
}

/** Email the request to each supplier with an address (when a mail service is set up). */
export async function sendRfq(s: Scope, id: string) {
  requireWrite(s);
  const d = await rfqDetail(s, id);
  if (d.rfq.status !== "open") throw new ApiError("conflict", "This RFQ is closed");
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  const names = new Map(d.items.map((i) => [i.id, i]));
  let emailed = 0;
  const portal = await supplierPortalUrl(s.orgId);
  if (mailProvider() !== "outbox")
    for (const sp of d.suppliers.filter((x) => x.email)) {
      await sendMail({ to: sp.email, subject: `Request for quotation ${d.rfq.number} from ${org?.name ?? ""}`, fromName: org?.name ?? "", body: [`Hello ${sp.name},`, "", `Please quote your best rates${d.rfq.dueDate ? ` by ${d.rfq.dueDate}` : ""} for:`, "", ...d.rfq.lines.map((l) => `• ${names.get(l.itemId)?.name ?? "Item"} — ${l.qty} ${names.get(l.itemId)?.unit ?? ""}`), "", "Include GST rate and delivery time for each.", portal ? `\nYou can quote online at ${portal} (sign in with this email address).` : "", d.rfq.notes ? `\n${d.rfq.notes}` : "", "", `— ${org?.name ?? ""}`].join("\n") });
      emailed++;
    }
  await db.update(schema.invRfqs).set({ sentAt: new Date() }).where(eq(schema.invRfqs.id, id));
  return { emailed, of: d.suppliers.length, reason: mailProvider() === "outbox" ? "No mail service is set up — share the RFQ yourself" : null };
}

/** Record (or replace) a supplier's quote. */
export async function saveQuote(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const r = await getRfq(s.orgId, id);
  if (r.status !== "open") throw new ApiError("conflict", "This RFQ is closed");
  const v = check(quoteSchema, raw);
  if (!r.supplierIds.includes(v.supplierId)) throw new ApiError("validation_failed", "That supplier wasn't asked on this RFQ");
  for (const l of v.lines) if (!r.lines.some((x) => x.itemId === l.itemId)) throw new ApiError("validation_failed", "Quote only the items on the RFQ");
  const [q] = await db.insert(schema.invRfqQuotes).values({ ...v, rfqId: id }).onConflictDoUpdate({ target: [schema.invRfqQuotes.rfqId, schema.invRfqQuotes.supplierId], set: { lines: v.lines, validTill: v.validTill, terms: v.terms } }).returning();
  return q;
}

/** Award each item to a supplier: draft purchase orders at the quoted rates, one per supplier. */
export async function awardRfq(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const d = await rfqDetail(s, id);
  if (d.rfq.status !== "open") throw new ApiError("conflict", "This RFQ is closed");
  const v = check(awardSchema, raw);
  const groups = new Map<string, { itemId: string; qty: number; rate: number; gstRate: number }[]>();
  for (const a of v.award) {
    const line = d.rfq.lines.find((l) => l.itemId === a.itemId);
    const q = d.quotes.find((x) => x.supplierId === a.supplierId)?.lines.find((l) => l.itemId === a.itemId);
    if (!line) throw new ApiError("validation_failed", "Award only items on the RFQ");
    if (!q || !q.rate) throw new ApiError("validation_failed", "That supplier didn't quote for this item");
    groups.set(a.supplierId, [...(groups.get(a.supplierId) ?? []), { itemId: a.itemId, qty: line.qty, rate: q.rate, gstRate: q.gstRate }]);
  }
  const poIds: string[] = [];
  for (const [supplierId, lines] of groups) poIds.push((await savePo(s, null, { supplierId, warehouseId: d.rfq.warehouseId, orderDate: v.orderDate, expectedDate: v.expectedDate, notes: `Awarded from ${d.rfq.number}`, lines })).id);
  await db.update(schema.invRfqs).set({ status: "awarded", award: v.award, poIds }).where(eq(schema.invRfqs.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.rfq_awarded", targetType: "inv_rfq", targetId: id, metadata: { number: d.rfq.number, pos: poIds.length } });
  return { poIds };
}

export async function cancelRfq(s: Scope, id: string) {
  requireWrite(s);
  const r = await getRfq(s.orgId, id);
  if (r.status !== "open") throw new ApiError("conflict", "This RFQ is closed");
  await db.update(schema.invRfqs).set({ status: "cancelled" }).where(eq(schema.invRfqs.id, id));
}

// ── Supplier rates and onboarding ───────────────────────────────────────────

export async function supplierRates(s: Scope, supplierId?: string) {
  return db
    .select({ r: schema.invSupplierRates, item: schema.invItems.name, supplier: schema.invSuppliers.name })
    .from(schema.invSupplierRates)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.invSupplierRates.itemId))
    .innerJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.invSupplierRates.supplierId))
    .where(and(eq(schema.invSupplierRates.orgId, s.orgId), supplierId ? eq(schema.invSupplierRates.supplierId, supplierId) : undefined))
    .orderBy(asc(schema.invSuppliers.name), asc(schema.invItems.name))
    .then((rows) => rows.map((x) => ({ ...x.r, item: x.item, supplier: x.supplier })));
}

export async function saveSupplierRate(s: Scope, raw: unknown) {
  requireManage(s);
  requirePart(s, "purchasing");
  requirePart(s, "procurement");
  const v = check(supplierRateSchema, raw);
  if (v.validFrom && v.validTo && v.validTo < v.validFrom) throw new ApiError("validation_failed", "It can't end before it starts");
  await suppliersIn(s.orgId, [v.supplierId]);
  await items(s.orgId, [v.itemId]);
  const [r] = await db.insert(schema.invSupplierRates).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

export async function deleteSupplierRate(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.invSupplierRates).where(and(eq(schema.invSupplierRates.id, id), eq(schema.invSupplierRates.orgId, s.orgId)));
}

export async function setOnboarding(s: Scope, supplierId: string, raw: unknown) {
  requireManage(s);
  const v = check(onboardingSchema, raw);
  const [sup] = await db.select().from(schema.invSuppliers).where(and(eq(schema.invSuppliers.id, supplierId), eq(schema.invSuppliers.orgId, s.orgId)));
  if (!sup) throw notFound("Supplier");
  if (v.approval === "approved" && (!v.checklist.gst && sup.gstin) && !v.checklist.pan) throw new ApiError("validation_failed", "Check their GST certificate or PAN before approving");
  const [r] = await db.update(schema.invSuppliers).set({ approval: v.approval, checklist: v.checklist, approvedBy: v.approval === "approved" ? s.userId : sup.approvedBy, approvedAt: v.approval === "approved" ? new Date() : sup.approvedAt }).where(eq(schema.invSuppliers.id, supplierId)).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.supplier_onboarding", targetType: "inv_supplier", targetId: supplierId, metadata: { from: sup.approval, to: v.approval, note: v.note } });
  return r;
}

// ── Returns to suppliers ────────────────────────────────────────────────────

export async function supplierReturns(s: Scope) {
  return db
    .select({ r: schema.invSupplierReturns, supplier: schema.invSuppliers.name })
    .from(schema.invSupplierReturns)
    .innerJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.invSupplierReturns.supplierId))
    .where(eq(schema.invSupplierReturns.orgId, s.orgId))
    .orderBy(desc(schema.invSupplierReturns.date))
    .limit(300)
    .then((rows) => rows.map((x) => ({ ...x.r, supplier: x.supplier })));
}

/**
 * Send goods back: stock leaves the location, and — when the receipt they came
 * on has a bill in Accounts — a debit note takes them off what's owed.
 */
export async function returnToSupplier(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "purchasing");
  requirePart(s, "procurement");
  const v = check(supplierReturnSchema, raw);
  requireWarehouseAccess(s, v.warehouseId);
  const sups = await suppliersIn(s.orgId, [v.supplierId]);
  const sup = sups.get(v.supplierId)!;
  const wh = await getWarehouse(s.orgId, v.warehouseId);
  const its = await items(s.orgId, v.lines.map((l) => l.itemId));
  if (v.receiptId) {
    const [rc] = await db.select().from(schema.invReceipts).where(and(eq(schema.invReceipts.id, v.receiptId), eq(schema.invReceipts.orgId, s.orgId)));
    if (!rc) throw new ApiError("validation_failed", "That receipt isn't in this workspace");
    if (rc.supplierId !== v.supplierId) throw new ApiError("validation_failed", "That receipt is from another supplier");
    const before = await db.select().from(schema.invSupplierReturns).where(eq(schema.invSupplierReturns.receiptId, rc.id));
    for (const l of v.lines) {
      const got = rc.lines.filter((x) => x.itemId === l.itemId).reduce((a, x) => a + x.qty, 0);
      const back = before.reduce((a, r) => a + r.lines.filter((x) => x.itemId === l.itemId).reduce((b, x) => b + x.qty, 0), 0);
      if (l.qty > q3(got - back) + 0.0005) throw new ApiError("validation_failed", `Only ${q3(got - back)} of ${its.get(l.itemId)!.name} from ${rc.number} can go back`);
    }
  }
  for (const l of v.lines) needSerials(its.get(l.itemId)!, l.qty, l.serials);
  const t = purchaseTotals(v.lines, isInterState(sup.state, wh.state));
  const number = await nextNumber(s.orgId, "return", s.settings.returnPrefix);
  const made = await db.transaction(async (tx) => {
    const [r] = await tx.insert(schema.invSupplierReturns).values({ orgId: s.orgId, number, supplierId: v.supplierId, receiptId: v.receiptId, warehouseId: wh.id, date: v.date, lines: v.lines, subtotal: t.subtotal, tax: t.tax, total: t.total, notes: v.notes, createdBy: s.userId }).returning();
    for (const l of v.lines) {
      const item = await getItem(s.orgId, l.itemId, tx);
      // From a named bin (a quarantined lot), or batches earliest expiry first.
      const parts = l.binId ? [{ batch: l.batch, qty: l.qty }] : await allocate(tx, item, wh, l.qty, l.batch);
      for (const part of parts) await move(tx, s, { item, warehouse: wh, qty: -part.qty, kind: "issue", batch: part.batch, unitCost: l.rate, refType: "supplier_return", refId: r.id, refNo: number, note: `Back to ${sup.name}${l.reason ? ` · ${l.reason}` : ""}`, binId: l.binId });
      if (item.trackSerials) await serialsOut(tx, s.orgId, item.id, wh.id, l.serials, "returned_to_supplier", { type: "supplier_return", id: r.id, no: number });
    }
    return r;
  });
  let debitNote: { id: string; number: string } | null = null;
  let note: string | null = null;
  if (v.debitNote && v.receiptId) {
    const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
    const [bill] = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), eq(schema.accBills.receiptId, v.receiptId)));
    if (!isOn(org?.modules, "accounting")) note = "Accounting is off — no debit note was made";
    else if (!bill) note = "The receipt has no bill yet — make the debit note once it's billed";
    else {
      try {
        const { systemScope } = await import("../accounting/access");
        const { saveBill } = await import("../accounting/bills");
        const acc = { ...(await systemScope(s.orgId)), userId: s.userId };
        const byRate = new Map<number, number>();
        for (const l of v.lines) byRate.set(l.gstRate, (byRate.get(l.gstRate) ?? 0) + Math.round(l.qty * l.rate));
        const dn = await saveBill(acc, null, { kind: "debit_note", againstBillId: bill.id, supplierId: v.supplierId, billNo: number, date: v.date, itc: bill.itc, interState: bill.interState, companyId: bill.companyId, branchId: bill.branchId, notes: `Goods returned: ${number}`, lines: [...byRate.entries()].map(([gstRate, amount]) => ({ accountId: bill.lines[0]?.accountId, description: `Returned ${number}`, amount, gstRate })) });
        await db.update(schema.invSupplierReturns).set({ debitNoteId: dn.id }).where(eq(schema.invSupplierReturns.id, made.id));
        debitNote = { id: dn.id, number: dn.number };
      } catch (e) {
        note = `No debit note: ${e instanceof Error ? e.message : "couldn't make it"}`;
      }
    }
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.returned_to_supplier", targetType: "inv_supplier_return", targetId: made.id, metadata: { number, total: made.total, debitNote: debitNote?.number ?? null } });
  return { return: made, debitNote, note };
}

// ── Match, performance and budgets ──────────────────────────────────────────

/** Every sent purchase order's 3-way match: ordered, received (accepted) and billed. */
export async function matches(s: Scope) {
  const pos = await db.select({ po: schema.invPurchaseOrders, supplier: schema.invSuppliers.name }).from(schema.invPurchaseOrders).innerJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.invPurchaseOrders.supplierId)).where(and(eq(schema.invPurchaseOrders.orgId, s.orgId), inArray(schema.invPurchaseOrders.status, ["sent", "partial", "received", "closed"]))).orderBy(desc(schema.invPurchaseOrders.orderDate)).limit(300);
  if (!pos.length) return [];
  const recs = await db.select().from(schema.invReceipts).where(and(eq(schema.invReceipts.orgId, s.orgId), inArray(schema.invReceipts.poId, pos.map((p) => p.po.id))));
  const bills = recs.length ? await db.select({ receiptId: schema.accBills.receiptId, subtotal: schema.accBills.subtotal, status: schema.accBills.status, id: schema.accBills.id, number: schema.accBills.number }).from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), inArray(schema.accBills.receiptId, recs.map((r) => r.id)))) : [];
  return pos.map(({ po, supplier }) => {
    const mine = recs.filter((r) => r.poId === po.id);
    const m = threeWay(po, mine.map((r) => {
      const b = bills.find((x) => x.receiptId === r.id && x.status !== "void");
      return { lines: r.lines, subtotal: r.subtotal, billed: b ? b.subtotal : null };
    }), s.settings.matchTolerancePct);
    return { id: po.id, number: po.number, supplier, orderDate: po.orderDate, poStatus: po.status, ...m, receipts: mine.map((r) => ({ id: r.id, number: r.number, bill: bills.find((b) => b.receiptId === r.id) ?? null })) };
  });
}

export async function performance(s: Scope) {
  const rows = (await db.execute(sql`
    select r.supplier_id, s.name, r.date::text as received, p.order_date::text as ordered, p.expected_date::text as expected,
      (select coalesce(sum((l->>'qty')::numeric), 0) from jsonb_array_elements(r.lines) l)::float as accepted,
      (select coalesce(sum(coalesce((l->>'rejected')::numeric, 0)), 0) from jsonb_array_elements(r.lines) l)::float as rejected,
      r.subtotal
    from inv_receipts r join inv_suppliers s on s.id = r.supplier_id left join inv_purchase_orders p on p.id = r.po_id
    where r.org_id = ${s.orgId} and r.date >= (now() at time zone 'Asia/Kolkata')::date - 365`)) as unknown as { rows: { supplier_id: string; name: string; received: string; ordered: string | null; expected: string | null; accepted: number; rejected: number; subtotal: number }[] };
  const returns = await db.select({ supplierId: schema.invSupplierReturns.supplierId, total: sql<number>`sum(${schema.invSupplierReturns.subtotal})::bigint` }).from(schema.invSupplierReturns).where(eq(schema.invSupplierReturns.orgId, s.orgId)).groupBy(schema.invSupplierReturns.supplierId);
  const by = new Map<string, typeof rows.rows>();
  for (const r of rows.rows) by.set(r.supplier_id, [...(by.get(r.supplier_id) ?? []), r]);
  return [...by.entries()]
    .map(([id, rs]) => ({ supplierId: id, name: rs[0].name, purchased: rs.reduce((a, r) => a + Number(r.subtotal), 0), returned: Number(returns.find((x) => x.supplierId === id)?.total ?? 0), ...supplierScore(rs.filter((r) => r.ordered).map((r) => ({ expected: r.expected, ordered: r.ordered!, received: r.received, accepted: r.accepted, rejected: r.rejected })).concat(rs.filter((r) => !r.ordered).map((r) => ({ expected: null, ordered: r.received, received: r.received, accepted: r.accepted, rejected: r.rejected })))) }))
    .sort((a, b) => b.purchased - a.purchased);
}

export async function budgets(s: Scope, month?: string) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : todayIst().slice(0, 7);
  const [rows, used] = await Promise.all([db.select().from(schema.invPurchaseBudgets).where(and(eq(schema.invPurchaseBudgets.orgId, s.orgId), eq(schema.invPurchaseBudgets.month, m))).orderBy(asc(schema.invPurchaseBudgets.category)), committed(s.orgId, m)]);
  return { month: m, budgets: rows.map((b) => ({ ...b, used: used.get(b.category) ?? 0 })), unbudgeted: [...used.entries()].filter(([c]) => !rows.some((b) => b.category === c)).map(([category, amount]) => ({ category, amount })) };
}

export async function setBudget(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(purchaseBudgetSchema, raw);
  if (!v.amount) {
    await db.delete(schema.invPurchaseBudgets).where(and(eq(schema.invPurchaseBudgets.orgId, s.orgId), eq(schema.invPurchaseBudgets.category, v.category), eq(schema.invPurchaseBudgets.month, v.month)));
    return null;
  }
  const [r] = await db.insert(schema.invPurchaseBudgets).values({ ...v, orgId: s.orgId }).onConflictDoUpdate({ target: [schema.invPurchaseBudgets.orgId, schema.invPurchaseBudgets.category, schema.invPurchaseBudgets.month], set: { amount: v.amount } }).returning();
  return r;
}
