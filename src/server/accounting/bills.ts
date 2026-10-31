// Bills and expenses: what you owe suppliers, and what you spend. A bill is
// posted to its expense (or inventory) accounts with input GST when it can be
// claimed; paying it moves money out of a bank or cash account. An expense is
// a bill paid on the spot. Posting happens through the sync, like everything
// else that comes from a document.
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { billSchema, billTotals, paymentSchema } from "@/lib/accounting/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { check, nextNumber, requirePart, requireWrite, todayIst, type Scope } from "./access";
import { assertOpen } from "./ledger";
import { NOT_POSTED } from "@/lib/accounting/model";
import { TDS_SECTIONS, rateFor, type Deductee } from "@/lib/accounting/tds";
import { assertPeriodOpen } from "./periods";
import { ensureDefaultCompany, getBranch, getCompany, getUnit, rateFor as fxRateFor } from "../org/org";
import { inrOf } from "@/lib/accounting/fx";
import { minorDigits } from "@/lib/store/money";
import type { z } from "zod";
import { sync } from "./sync";
import { cancelFor, gate } from "../approvals/engine";
import { emit } from "../hub/core";
import { contains } from "../security/like";

type Bill = typeof schema.accBills.$inferSelect;
const label = (b: Bill) => `${b.number} · ${b.supplierName}${b.billNo ? ` (${b.billNo})` : ""}`;

/**
 * Send a bill (or expense) through approval when a policy applies. Until it's
 * approved it stays out of the books and can't be paid.
 */
async function approvalFor(s: Scope, b: Bill, kind: "acc.bill" | "acc.expense") {
  const g = await gate(s.orgId, { kind, refId: b.id, label: label(b), amount: b.total, requesterId: s.userId || b.createdBy, link: `/accounts/bills/${b.id}` });
  if (g.status === "pending" && b.status !== "pending_approval") {
    const [r] = await db.update(schema.accBills).set({ status: "pending_approval" }).where(eq(schema.accBills.id, b.id)).returning();
    return r;
  }
  if (g.status !== "pending" && (b.status === "pending_approval" || b.status === "rejected")) {
    const [r] = await db.update(schema.accBills).set({ status: "open" }).where(eq(schema.accBills.id, b.id)).returning();
    return r;
  }
  return b;
}

async function get(orgId: string, id: string) {
  const [b] = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, orgId), eq(schema.accBills.id, id)));
  if (!b) throw notFound("Bill");
  return b;
}

async function checkAccounts(orgId: string, ids: string[], kinds: string[] | null) {
  const rows = await db.select({ id: schema.accAccounts.id, type: schema.accAccounts.type, subtype: schema.accAccounts.subtype }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), inArray(schema.accAccounts.id, [...new Set(ids)])));
  if (rows.length !== new Set(ids).size) throw new ApiError("validation_failed", "Use accounts from this workspace");
  if (kinds && rows.some((r) => !kinds.includes(r.subtype))) throw new ApiError("validation_failed", "Pay from a bank or cash account");
  return rows;
}

export async function listBills(s: Scope, opts: { status?: string; q?: string } = {}) {
  const today = todayIst();
  const rows = await db
    .select()
    .from(schema.accBills)
    .where(and(eq(schema.accBills.orgId, s.orgId), opts.status === "open" ? sql`${schema.accBills.status} in ('open','partial')` : opts.status ? eq(schema.accBills.status, opts.status) : undefined, opts.q ? sql`(${schema.accBills.supplierName} ilike ${contains(opts.q)} or ${schema.accBills.billNo} ilike ${contains(opts.q)} or ${schema.accBills.number} ilike ${contains(opts.q)})` : undefined))
    .orderBy(desc(schema.accBills.date), desc(schema.accBills.createdAt))
    .limit(500);
  return rows.map((b) => ({ ...b, due: b.kind === "debit_note" ? 0 : owed(b), overdue: b.kind === "bill" && ["open", "partial"].includes(b.status) && !!b.dueDate && String(b.dueDate) < today }));
}

export async function billDetail(s: Scope, id: string) {
  const b = await get(s.orgId, id);
  const payments = await db.select({ p: schema.accBillPayments, account: schema.accAccounts.name }).from(schema.accBillPayments).innerJoin(schema.accAccounts, eq(schema.accAccounts.id, schema.accBillPayments.accountId)).where(eq(schema.accBillPayments.billId, id));
  const receipt = b.receiptId ? (await db.select({ id: schema.invReceipts.id, number: schema.invReceipts.number }).from(schema.invReceipts).where(eq(schema.invReceipts.id, b.receiptId)))[0] ?? null : null;
  // A bill lists its debit notes; a debit note links back to its bill.
  const debitNotes = b.kind === "bill" ? await db.select({ id: schema.accBills.id, number: schema.accBills.number, date: schema.accBills.date, total: schema.accBills.total, status: schema.accBills.status }).from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), eq(schema.accBills.againstBillId, id), eq(schema.accBills.kind, "debit_note"))) : [];
  const against = b.againstBillId ? (await db.select({ id: schema.accBills.id, number: schema.accBills.number, billNo: schema.accBills.billNo }).from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), eq(schema.accBills.id, b.againstBillId))))[0] ?? null : null;
  return { bill: { ...b, due: b.kind === "debit_note" ? 0 : owed(b) }, payments: payments.map((x) => ({ ...x.p, account: x.account })), receipt, split: billTotals(b.lines, b.interState).split, debitNotes, against };
}

async function supplierName(orgId: string, supplierId: string | null, name: string) {
  if (!supplierId) {
    if (!name.trim()) throw new ApiError("validation_failed", "Name the supplier or pick one");
    return name.trim();
  }
  const [sup] = await db.select({ name: schema.invSuppliers.name }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, orgId), eq(schema.invSuppliers.id, supplierId)));
  if (!sup) throw new ApiError("validation_failed", "Pick a supplier from this workspace");
  return sup.name;
}

export async function saveBill(s: Scope, id: string | null, raw: unknown, kind: "acc.bill" | "acc.expense" = "acc.bill") {
  requireWrite(s);
  requirePart(s, "bills");
  const b = check(billSchema, raw);
  assertOpen(s, b.date, "This bill");
  // Company and branch: a branch decides its company; otherwise the one asked for, or the default.
  if (b.branchId) b.companyId = (await getBranch(s.orgId, b.branchId)).companyId;
  b.companyId = b.companyId ? (await getCompany(s.orgId, b.companyId)).id : (await ensureDefaultCompany(s.orgId)).id;
  if (s.access?.companies?.length && !s.access.companies.includes(b.companyId)) throw new ApiError("forbidden", "You can't enter bills for that company");
  await assertPeriodOpen(s.orgId, b.companyId, b.date, "This bill");
  const units = [...new Set(b.lines.map((l) => l.costCentreId).filter((x): x is string => !!x))];
  for (const u of units) await getUnit(s.orgId, u);
  await checkAccounts(s.orgId, b.lines.map((l) => l.accountId), null);
  const name = await supplierName(s.orgId, b.supplierId, b.supplierName);
  // In another currency: each line is converted at the bill's rate, and the bill keeps its own total.
  let fx: { rate: number; total: number } | null = null;
  if (b.currency !== "INR") {
    if (b.kind === "debit_note") throw new ApiError("validation_failed", "Debit notes are in rupees");
    if (b.tdsSection) throw new ApiError("validation_failed", "TDS on payments abroad (section 195) isn't worked out here — record the bill without it", { tdsSection: ["Not for foreign bills"] });
    const rate = b.fxRate ?? (await fxRateFor(s.orgId, b.currency, b.date));
    if (!rate) throw new ApiError("validation_failed", `Enter the exchange rate — there's no ${b.currency} rate on or before ${b.date}`, { fxRate: ["Enter a rate"] });
    fx = { rate, total: billTotals(b.lines, b.interState).total };
    b.lines = b.lines.map((l) => ({ ...l, fxAmount: l.amount, amount: inrOf(l.amount, b.currency, rate) }));
  }
  const t = billTotals(b.lines, b.interState);
  // A debit note sits against one of the same supplier's bills, and can't exceed what's still owed on it.
  let against: Bill | null = null;
  if (b.kind === "debit_note") {
    if (!b.againstBillId) throw new ApiError("validation_failed", "Pick the bill this debit note is against", { againstBillId: ["Pick a bill"] });
    against = await get(s.orgId, b.againstBillId);
    if (against.kind !== "bill" || NOT_POSTED.includes(against.status)) throw new ApiError("validation_failed", "A debit note goes against a posted bill");
    if (against.currency !== "INR") throw new ApiError("validation_failed", "Debit notes against bills in another currency aren't supported — record a payment difference instead");
    if ((against.supplierId ?? against.supplierName) !== (b.supplierId ?? name)) throw new ApiError("validation_failed", "The debit note and the bill must be from the same supplier");
    const left = owed(against) + (id ? (await get(s.orgId, id)).total : 0);
    if (t.total > left) throw new ApiError("validation_failed", `Only ${rupees(left)} is still owed on ${against.number}`);
    b.tdsSection = "";
  } else b.againstBillId = null;
  // TDS: the section's rate (for the supplier's PAN and type) on the amount before GST, unless an amount is given.
  let tdsRate = 0;
  let tdsAmount = 0;
  if (b.tdsSection) {
    if (!TDS_SECTIONS[b.tdsSection]) throw new ApiError("validation_failed", "Pick a TDS section from the list", { tdsSection: ["Unknown section"] });
    const sup = b.supplierId ? (await db.select().from(schema.invSuppliers).where(eq(schema.invSuppliers.id, b.supplierId)))[0] : null;
    tdsRate = rateFor(b.tdsSection, (sup?.deductee as Deductee) ?? "other", sup?.pan ?? "", s.settings.tds.rates) ?? 0;
    tdsAmount = b.tdsAmount ?? Math.round((t.subtotal * tdsRate) / 100);
    if (tdsAmount > t.subtotal) throw new ApiError("validation_failed", "TDS can't be more than the bill before GST", { tdsAmount: ["Too much"] });
  }
  const values = { ...b, tdsAmount, tdsRate, supplierName: name, subtotal: t.subtotal, tax: t.tax, total: t.total, fxRate: fx ? String(fx.rate) : null, fxTotal: fx?.total ?? null };
  if (id) {
    const cur = await get(s.orgId, id);
    if (cur.receiptId) throw new ApiError("conflict", "This bill was made from goods received — change the receipt in Inventory");
    if (cur.status === "void") throw new ApiError("conflict", "This bill is void");
    if (cur.kind !== b.kind) throw new ApiError("conflict", "A bill can't become a debit note, or the other way round");
    if (cur.currency !== b.currency && cur.amountPaid) throw new ApiError("conflict", "Remove its payments before changing the currency");
    assertOpen(s, String(cur.date), "This bill");
    if (t.total - tdsAmount < cur.amountPaid + cur.credited) throw new ApiError("conflict", "The total can't be less than what's already been paid or credited");
    const waiting = cur.status === "pending_approval" || cur.status === "rejected";
    const [r] = await db.update(schema.accBills).set(values).where(eq(schema.accBills.id, id)).returning();
    await refreshPaid(id);
    if (cur.againstBillId) await refreshPaid(cur.againstBillId);
    if (against) await refreshPaid(against.id);
    // A bill waiting or sent back goes (back) through approval; a posted bill only if it grew and nothing is paid yet.
    const recheck = b.kind === "bill" && (waiting || (t.total > cur.total && !cur.amountPaid));
    const out = recheck ? await approvalFor(s, r, cur.pendingPayment ? "acc.expense" : "acc.bill") : r;
    await sync(s);
    return out;
  }
  const number = await (b.kind === "debit_note" ? nextNumber(s.orgId, "debit_note", "DN-") : nextNumber(s.orgId, "bill", s.settings.billPrefix));
  const [made] = await db.insert(schema.accBills).values({ ...values, orgId: s.orgId, number, createdBy: s.userId || null }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: b.kind === "debit_note" ? "accounts.debit_note_created" : "accounts.bill_created", targetType: "acc_bill", targetId: made.id, metadata: { number, total: made.total, tds: tdsAmount } });
  const r = b.kind === "bill" ? await approvalFor(s, made, kind) : made;
  if (b.kind === "bill") await emit(s.orgId, "accounts.bill.created", { id: made.id, number: made.number, supplierId: made.supplierId, supplierName: made.supplierName, billNo: made.billNo, totalPaise: made.total, date: String(made.date) });
  if (against) await refreshPaid(against.id);
  await sync(s);
  return r;
}

const rupees = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" });
/** What's still to pay on a bill: its total less TDS kept back, debit notes and payments. */
export const owed = (b: Pick<Bill, "total" | "tdsAmount" | "credited" | "amountPaid">) => Math.max(0, b.total - b.tdsAmount - b.credited - b.amountPaid);

/** Paid in full just now? Tell subscribers. */
async function paidEvent(billId: string, before: string) {
  const [b] = await db.select().from(schema.accBills).where(eq(schema.accBills.id, billId));
  if (b && b.status === "paid" && before !== "paid") await emit(b.orgId, "accounts.bill.paid", { id: b.id, number: b.number, supplierId: b.supplierId, supplierName: b.supplierName, totalPaise: b.total });
}

async function refreshPaid(billId: string) {
  const [{ paid }] = await db.select({ paid: sql<number>`coalesce(sum(${schema.accBillPayments.amount}),0)::bigint` }).from(schema.accBillPayments).where(eq(schema.accBillPayments.billId, billId));
  const [{ credited }] = await db.select({ credited: sql<number>`coalesce(sum(${schema.accBills.total}),0)::bigint` }).from(schema.accBills).where(and(eq(schema.accBills.againstBillId, billId), eq(schema.accBills.kind, "debit_note"), notInArray(schema.accBills.status, NOT_POSTED)));
  const b = (await db.select().from(schema.accBills).where(eq(schema.accBills.id, billId)))[0];
  const p = Number(paid);
  const c = Number(credited);
  // A bill is settled once payments, debit notes and the TDS kept back cover it; a debit note is settled when made.
  const settled = b.kind === "debit_note" ? b.total : p + c + b.tdsAmount;
  const status = NOT_POSTED.includes(b.status) ? b.status : settled >= b.total ? "paid" : p + c > 0 ? "partial" : "open";
  await db.update(schema.accBills).set({ amountPaid: p, credited: c, status }).where(eq(schema.accBills.id, billId));
}

export async function payBill(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const b = await get(s.orgId, id);
  if (b.status === "void") throw new ApiError("conflict", "This bill is void");
  if (b.status === "pending_approval") throw new ApiError("conflict", "This bill is waiting for approval and can't be paid yet");
  if (b.status === "rejected") throw new ApiError("conflict", "This bill was sent back — change it to send it again, or void it");
  const p = check(paymentSchema, raw);
  assertOpen(s, p.date, "This payment");
  await assertPeriodOpen(s.orgId, b.companyId, p.date, "This payment");
  await checkAccounts(s.orgId, [p.accountId], ["bank", "cash"]);
  if (b.kind === "debit_note") throw new ApiError("conflict", "A debit note isn't paid — it reduces what you owe on its bill");
  if (b.currency !== "INR") return payForeign(s, b, p);
  if (p.amount > owed(b)) throw new ApiError("validation_failed", `Only ${rupees(owed(b))} is still due`);
  const [r] = await db.insert(schema.accBillPayments).values({ ...p, fxAmount: null, orgId: s.orgId, billId: id }).returning();
  await refreshPaid(id);
  await paidEvent(id, b.status);
  await sync(s);
  return r;
}

/**
 * Paying a foreign bill: `fxAmount` in its currency settles its share at the
 * bill's rate; the rupees actually paid (`amount`) differ by the exchange gain
 * or loss. Paying the last of it settles exactly what's left in rupees.
 */
async function payForeign(s: Scope, b: Bill, p: z.infer<typeof paymentSchema>) {
  if (!p.fxAmount) throw new ApiError("validation_failed", `Enter the amount paid in ${b.currency}`, { fxAmount: ["Enter an amount"] });
  const paid = await db.select({ fx: schema.accBillPayments.fxAmount }).from(schema.accBillPayments).where(eq(schema.accBillPayments.billId, b.id));
  const leftFx = (b.fxTotal ?? 0) - paid.reduce((a, x) => a + Number(x.fx ?? 0), 0);
  if (p.fxAmount > leftFx) throw new ApiError("validation_failed", `Only ${b.currency} ${(leftFx / 10 ** minorDigits(b.currency)).toFixed(minorDigits(b.currency))} is still due`);
  const settles = p.fxAmount === leftFx ? owed(b) : Math.min(owed(b), inrOf(p.fxAmount, b.currency, Number(b.fxRate)));
  const [r] = await db.insert(schema.accBillPayments).values({ accountId: p.accountId, date: p.date, reference: p.reference, amount: settles, fxAmount: p.fxAmount, fxDiff: p.amount - settles, orgId: s.orgId, billId: b.id }).returning();
  await refreshPaid(b.id);
  await paidEvent(b.id, b.status);
  await sync(s);
  return r;
}

export async function deletePayment(s: Scope, billId: string, paymentId: string) {
  requireWrite(s);
  await get(s.orgId, billId);
  const [p] = await db.select().from(schema.accBillPayments).where(and(eq(schema.accBillPayments.id, paymentId), eq(schema.accBillPayments.billId, billId)));
  if (!p) throw notFound("Payment");
  assertOpen(s, String(p.date), "This payment");
  await db.delete(schema.accBillPayments).where(eq(schema.accBillPayments.id, paymentId));
  await refreshPaid(billId);
  await sync(s);
}

export async function voidBill(s: Scope, id: string) {
  requireWrite(s);
  const b = await get(s.orgId, id);
  assertOpen(s, String(b.date), "This bill");
  if (b.amountPaid) throw new ApiError("conflict", "Remove its payments before voiding it");
  if (b.receiptId) throw new ApiError("conflict", "This bill was made from goods received in Inventory and follows it");
  if (b.credited) throw new ApiError("conflict", "Void its debit notes before voiding the bill");
  await db.update(schema.accBills).set({ status: "void", pendingPayment: null }).where(eq(schema.accBills.id, id));
  // A debit note voided gives its amount back to the bill.
  if (b.againstBillId) await refreshPaid(b.againstBillId);
  await cancelFor(s.orgId, b.pendingPayment ? "acc.expense" : "acc.bill", id, s.userId, "The bill was voided");
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.bill_voided", targetType: "acc_bill", targetId: id, metadata: { number: b.number } });
  await sync(s);
}

/** An expense: a bill paid in full on the same day from one account. */
export async function recordExpense(s: Scope, raw: unknown) {
  const body = raw as { paidFrom?: string; reference?: string };
  if (!body.paidFrom) throw new ApiError("validation_failed", "Pick the account you paid from");
  await checkAccounts(s.orgId, [body.paidFrom], ["bank", "cash"]);
  const bill = await saveBill(s, null, raw, "acc.expense");
  // In another currency, paid in full at the bill's rate (no difference on the day).
  const payment = { accountId: body.paidFrom, amount: owed(bill), date: String(bill.date), reference: body.reference ?? "", fxAmount: bill.currency !== "INR" ? bill.fxTotal : null };
  // Waiting for approval: the payment is kept and recorded once it's approved.
  if (bill.status === "pending_approval") {
    await db.update(schema.accBills).set({ pendingPayment: payment }).where(eq(schema.accBills.id, bill.id));
    return get(s.orgId, bill.id);
  }
  await payBill(s, bill.id, payment);
  return get(s.orgId, bill.id);
}

/** After approval: the bill goes into the books, and an expense's payment is recorded. */
export async function billApproved(orgId: string, billId: string) {
  const { systemScope } = await import("./access");
  const s = await systemScope(orgId);
  const b = await get(orgId, billId);
  if (b.status !== "pending_approval") return;
  await db.update(schema.accBills).set({ status: "open" }).where(eq(schema.accBills.id, billId));
  const p = b.pendingPayment as { accountId: string; amount: number; date: string; reference: string } | null;
  if (p) {
    await db.insert(schema.accBillPayments).values({ ...p, amount: Math.min(p.amount, owed(b)), orgId, billId });
    await db.update(schema.accBills).set({ pendingPayment: null }).where(eq(schema.accBills.id, billId));
    await refreshPaid(billId);
  }
  await sync(s);
}

export async function billRejected(orgId: string, billId: string) {
  await db.update(schema.accBills).set({ status: "rejected" }).where(and(eq(schema.accBills.id, billId), eq(schema.accBills.orgId, orgId), eq(schema.accBills.status, "pending_approval")));
}
