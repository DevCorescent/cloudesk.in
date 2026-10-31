// What the business pays out: TDS deducted on bills and deposited with the
// government, and payment runs — bills picked to pay together, approved, then
// paid from one account with a bank upload file.
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { NOT_POSTED, type PostLine } from "@/lib/accounting/model";
import { TDS_SECTIONS, isPan, suggest, tdsQuarter, type Deductee } from "@/lib/accounting/tds";
import { gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { ensureDefaultCompany } from "../org/org";
import { audit } from "../services/audit";
import { check, nextNumber, requireManage, requireWrite, todayIst, type Scope } from "./access";
import { owed, payBill } from "./bills";
import { assertPeriodOpen } from "./periods";
import { sync } from "./sync";

const fyStart = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};

/** A suggested deduction for a bill being written, from the supplier's year so far. */
export async function tdsSuggestion(s: Scope, q: { supplierId?: string; section?: string; amount?: string; date?: string }) {
  const amount = Math.round(Number(q.amount) || 0);
  const day = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayIst();
  const sup = q.supplierId ? (await db.select().from(schema.invSuppliers).where(and(eq(schema.invSuppliers.id, q.supplierId), eq(schema.invSuppliers.orgId, s.orgId))))[0] : null;
  const section = q.section || sup?.tdsSection || "";
  if (!section) return { section: "", rate: 0, amount: 0, why: "No TDS section", pan: sup?.pan ?? "" };
  const [{ before }] = sup
    ? await db.select({ before: sql<number>`coalesce(sum(${schema.accBills.subtotal}),0)::bigint` }).from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), eq(schema.accBills.supplierId, sup.id), eq(schema.accBills.kind, "bill"), eq(schema.accBills.tdsSection, section), notInArray(schema.accBills.status, NOT_POSTED), sql`${schema.accBills.date} between ${fyStart(day)} and ${day}`))
    : [{ before: 0 }];
  const r = suggest(section, { deductee: (sup?.deductee as Deductee) ?? "other", pan: sup?.pan ?? "", amount, yearBefore: Number(before), overrides: s.settings.tds.rates });
  return { section, ...r, yearBefore: Number(before), pan: sup?.pan ?? "", panValid: isPan(sup?.pan ?? "") };
}

const depositSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), section: z.string().min(1).max(20), amount: z.number().int().min(1).max(1e13), accountId: z.uuid(), challanNo: z.string().trim().max(20).default(""), bsrCode: z.string().trim().max(10).default(""), companyId: z.uuid().nullable().default(null) });

export async function addDeposit(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(depositSchema, raw);
  if (!TDS_SECTIONS[v.section]) throw new ApiError("validation_failed", "Pick a TDS section", { section: ["Unknown section"] });
  const [acc] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, v.accountId)));
  if (!acc || !["bank", "cash"].includes(acc.subtype)) throw new ApiError("validation_failed", "Pay from a bank or cash account");
  const companyId = v.companyId ?? (await ensureDefaultCompany(s.orgId)).id;
  await assertPeriodOpen(s.orgId, companyId, v.date, "This deposit");
  const [r] = await db.insert(schema.accTdsDeposits).values({ ...v, companyId, orgId: s.orgId, quarter: tdsQuarter(v.date), createdBy: s.userId }).returning();
  await sync(s);
  return r;
}

export async function deleteDeposit(s: Scope, id: string) {
  requireManage(s);
  const [d] = await db.select().from(schema.accTdsDeposits).where(and(eq(schema.accTdsDeposits.id, id), eq(schema.accTdsDeposits.orgId, s.orgId)));
  if (!d) throw notFound("Deposit");
  await assertPeriodOpen(s.orgId, d.companyId, String(d.date), "This deposit");
  await db.delete(schema.accTdsDeposits).where(eq(schema.accTdsDeposits.id, id));
  await sync(s);
}

/** For the sync: deposits move TDS owed out of the bank. */
export async function depositWants(orgId: string, defaultCompany: string) {
  const rows = await db.select().from(schema.accTdsDeposits).where(eq(schema.accTdsDeposits.orgId, orgId));
  return rows.map((d) => ({ sourceType: "tds_deposit", sourceId: d.id, date: String(d.date), narration: `TDS deposited · ${d.section}${d.challanNo ? ` · challan ${d.challanNo}` : ""}`, sourceRef: d.challanNo || "TDS", party: "Income Tax Department", lines: [{ key: "tds_payable", debit: d.amount, credit: 0 }, { accountId: d.accountId, debit: 0, credit: d.amount }] as PostLine[], companyId: d.companyId ?? defaultCompany }));
}

/** A quarter's TDS: what was deducted (by section and supplier) and deposited, with a 26Q-style list. */
export async function tdsReport(s: Scope, quarter?: string) {
  const q = quarter && /^\d{4}-\d{2} Q[1-4]$/.test(quarter) ? quarter : tdsQuarter(todayIst());
  const start = Number(q.slice(0, 4));
  const n = Number(q.slice(-1));
  const months = [[4, 6], [7, 9], [10, 12], [1, 3]][n - 1];
  const year = n === 4 ? start + 1 : start;
  const from = `${year}-${String(months[0]).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, months[1], 0)).toISOString().slice(0, 10);
  const bills = await db
    .select({ b: schema.accBills, pan: schema.invSuppliers.pan, deductee: schema.invSuppliers.deductee })
    .from(schema.accBills)
    .leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.accBills.supplierId))
    .where(and(eq(schema.accBills.orgId, s.orgId), eq(schema.accBills.kind, "bill"), sql`${schema.accBills.tdsAmount} > 0`, notInArray(schema.accBills.status, NOT_POSTED), sql`${schema.accBills.date} between ${from} and ${to}`))
    .orderBy(asc(schema.accBills.date));
  const deposits = await db.select().from(schema.accTdsDeposits).where(and(eq(schema.accTdsDeposits.orgId, s.orgId), eq(schema.accTdsDeposits.quarter, q))).orderBy(asc(schema.accTdsDeposits.date));
  const sections = [...new Set([...bills.map((x) => x.b.tdsSection), ...deposits.map((d) => d.section)])].map((sec) => {
    const deducted = bills.filter((x) => x.b.tdsSection === sec).reduce((a, x) => a + x.b.tdsAmount, 0);
    const deposited = deposits.filter((d) => d.section === sec).reduce((a, d) => a + d.amount, 0);
    return { section: sec, label: TDS_SECTIONS[sec]?.label ?? sec, deducted, deposited, due: deducted - deposited };
  });
  return {
    quarter: q,
    from,
    to,
    tan: s.settings.tds.tan,
    sections,
    entries: bills.map(({ b, pan, deductee }) => ({ id: b.id, number: b.number, date: String(b.date), supplier: b.supplierName, pan: pan ?? "", panValid: isPan(pan ?? ""), deductee: deductee ?? "other", section: b.tdsSection, rate: b.tdsRate, base: b.subtotal, tds: b.tdsAmount })),
    deposits,
  };
}

// ── Payment runs ────────────────────────────────────────────────────────────

const runSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), accountId: z.uuid(), items: z.array(z.object({ billId: z.uuid(), amount: z.number().int().min(1) })).min(1, "Pick at least one bill").max(500), note: z.string().trim().max(300).default("") });

async function getRun(s: Scope, id: string) {
  const [r] = await db.select().from(schema.accPaymentRuns).where(and(eq(schema.accPaymentRuns.id, id), eq(schema.accPaymentRuns.orgId, s.orgId)));
  if (!r) throw notFound("Payment run");
  return r;
}

export async function runs(s: Scope) {
  return db.select().from(schema.accPaymentRuns).where(eq(schema.accPaymentRuns.orgId, s.orgId)).orderBy(desc(schema.accPaymentRuns.createdAt)).limit(100);
}

export async function runDetail(s: Scope, id: string) {
  const r = await getRun(s, id);
  const bills = r.items.length ? await db.select({ b: schema.accBills, bank: schema.invSuppliers.bank }).from(schema.accBills).leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.accBills.supplierId)).where(inArray(schema.accBills.id, r.items.map((i) => i.billId))) : [];
  return { run: r, lines: r.items.map((i) => {
    const x = bills.find((b) => b.b.id === i.billId);
    const bank = (x?.bank ?? {}) as { name?: string; account?: string; ifsc?: string };
    return { ...i, number: x?.b.number ?? "", supplier: x?.b.supplierName ?? "", billNo: x?.b.billNo ?? "", owed: x ? owed(x.b) : 0, bankReady: !!(bank.account && bank.ifsc) };
  }) };
}

async function checkItems(s: Scope, items: { billId: string; amount: number }[]) {
  const bills = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), inArray(schema.accBills.id, items.map((i) => i.billId))));
  if (bills.length !== new Set(items.map((i) => i.billId)).size) throw new ApiError("validation_failed", "Use bills from this workspace");
  for (const i of items) {
    const b = bills.find((x) => x.id === i.billId)!;
    if (b.kind !== "bill" || !["open", "partial"].includes(b.status)) throw new ApiError("validation_failed", `${b.number} isn't open for payment`);
    if (b.currency !== "INR") throw new ApiError("validation_failed", `${b.number} is in ${b.currency} — pay it on its own with the rupees the bank charged`);
    if (i.amount > owed(b)) throw new ApiError("validation_failed", `Only ${(owed(b) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })} is due on ${b.number}`);
  }
}

export async function saveRun(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(runSchema, raw);
  const [acc] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, v.accountId)));
  if (!acc || !["bank", "cash"].includes(acc.subtype)) throw new ApiError("validation_failed", "Pay from a bank or cash account");
  await checkItems(s, v.items);
  const total = v.items.reduce((a, i) => a + i.amount, 0);
  if (id) {
    const cur = await getRun(s, id);
    if (!["draft"].includes(cur.status)) throw new ApiError("conflict", "Only a draft run can change");
    const [r] = await db.update(schema.accPaymentRuns).set({ ...v, total }).where(eq(schema.accPaymentRuns.id, id)).returning();
    return r;
  }
  const number = await nextNumber(s.orgId, "payment_run", "PR-");
  const [r] = await db.insert(schema.accPaymentRuns).values({ ...v, total, number, orgId: s.orgId, createdBy: s.userId }).returning();
  return r;
}

/** Send the run for approval (or approve it straight away when no rule applies). */
export async function submitRun(s: Scope, id: string) {
  requireWrite(s);
  const r = await getRun(s, id);
  if (r.status !== "draft") throw new ApiError("conflict", "This run was already sent");
  await checkItems(s, r.items);
  const g = await gate(s.orgId, { kind: "acc.payment_run", refId: r.id, label: `${r.number} · ${r.items.length} bills`, amount: r.total, requesterId: s.userId, link: `/accounts/payments/${r.id}` });
  const status = g.status === "pending" ? "pending_approval" : "approved";
  await db.update(schema.accPaymentRuns).set({ status }).where(eq(schema.accPaymentRuns.id, id));
  return { status };
}

export async function runApproved(orgId: string, id: string) {
  await db.update(schema.accPaymentRuns).set({ status: "approved" }).where(and(eq(schema.accPaymentRuns.id, id), eq(schema.accPaymentRuns.orgId, orgId), eq(schema.accPaymentRuns.status, "pending_approval")));
}
export async function runRejected(orgId: string, id: string) {
  await db.update(schema.accPaymentRuns).set({ status: "draft" }).where(and(eq(schema.accPaymentRuns.id, id), eq(schema.accPaymentRuns.orgId, orgId), eq(schema.accPaymentRuns.status, "pending_approval")));
}

/** Record the payments once the bank has made them. */
export async function payRun(s: Scope, id: string) {
  requireWrite(s);
  const r = await getRun(s, id);
  if (r.status !== "approved") throw new ApiError("conflict", r.status === "pending_approval" ? "This run is waiting for approval" : `This run is ${r.status}`);
  await checkItems(s, r.items);
  for (const i of r.items) await payBill(s, i.billId, { accountId: r.accountId, amount: i.amount, date: String(r.date), reference: r.number });
  await db.update(schema.accPaymentRuns).set({ status: "paid", paidAt: new Date() }).where(eq(schema.accPaymentRuns.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.payment_run_paid", targetType: "acc_payment_run", targetId: id, metadata: { number: r.number, total: r.total, bills: r.items.length } });
  return getRun(s, id);
}

export async function cancelRun(s: Scope, id: string) {
  requireWrite(s);
  const r = await getRun(s, id);
  if (r.status === "paid") throw new ApiError("conflict", "A paid run can't be cancelled — remove the payments from each bill instead");
  await db.update(schema.accPaymentRuns).set({ status: "cancelled" }).where(eq(schema.accPaymentRuns.id, id));
  const { cancelFor } = await import("../approvals/engine");
  await cancelFor(s.orgId, "acc.payment_run", id, s.userId, "The run was cancelled");
}

/** A CSV for the bank's bulk upload: who to pay, their account and IFSC, and the amount. */
export async function runBankFile(s: Scope, id: string) {
  const d = await runDetail(s, id);
  if (!["approved", "paid"].includes(d.run.status)) throw new ApiError("conflict", "Only an approved run has a bank file");
  const sups = await db.select({ name: schema.invSuppliers.name, bank: schema.invSuppliers.bank, b: schema.accBills.id }).from(schema.accBills).leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.accBills.supplierId)).where(inArray(schema.accBills.id, d.run.items.map((i) => i.billId)));
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return /^[=+\-@]/.test(t) ? `'${t}` : /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = d.lines.map((l) => {
    const sup = sups.find((x) => x.b === l.billId);
    const bank = (sup?.bank ?? {}) as { name?: string; account?: string; ifsc?: string };
    return [bank.name || l.supplier, bank.account ?? "", bank.ifsc ?? "", (l.amount / 100).toFixed(2), `${d.run.number} ${l.number}${l.billNo ? ` ${l.billNo}` : ""}`];
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.payment_run_file", targetType: "acc_payment_run", targetId: id, metadata: { number: d.run.number } });
  return "﻿" + [["Beneficiary name", "Account number", "IFSC", "Amount", "Reference"], ...rows].map((r) => r.map(cell).join(",")).join("\n");
}


// ── Petty cash ──────────────────────────────────────────────────────────────

const countSchema = z.object({ accountId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), counted: z.number().int().min(0).max(1e12), note: z.string().trim().max(200).default("") });

/**
 * Count a cash box: the difference from what the books say goes to "Cash
 * short or over", as a journal (which follows any approval rule for journals).
 */
export async function countCash(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(countSchema, raw);
  const [acc] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, v.accountId)));
  if (!acc || acc.subtype !== "cash") throw new ApiError("validation_failed", "Pick a cash account");
  const res = (await db.execute(sql`select coalesce(sum(l.debit - l.credit), 0)::bigint as bal from acc_lines l join acc_journals j on j.id = l.journal_id where l.account_id = ${v.accountId} and j.date <= ${v.date}`)) as unknown as { rows: { bal: number }[] };
  const book = Number(res.rows[0]?.bal ?? 0);
  const diff = v.counted - book;
  if (!diff) return { book, counted: v.counted, difference: 0, journal: null };
  const { createJournal } = await import("./ledger");
  const over = await db.select({ id: schema.accAccounts.id }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.systemKey, "cash_over_short")));
  if (!over[0]) throw new ApiError("conflict", "The “Cash short or over” account is missing from the chart");
  const lines = diff > 0 ? [{ accountId: v.accountId, debit: diff, credit: 0 }, { accountId: over[0].id, debit: 0, credit: diff }] : [{ accountId: over[0].id, debit: -diff, credit: 0 }, { accountId: v.accountId, debit: 0, credit: -diff }];
  const j = await createJournal(s, { date: v.date, narration: `Cash count: ${diff > 0 ? "over" : "short"} by ₹${(Math.abs(diff) / 100).toFixed(2)}${v.note ? ` — ${v.note}` : ""}`, lines });
  return { book, counted: v.counted, difference: diff, ...j };
}
