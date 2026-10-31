// Construction contracts: the bill of quantities (imported from the tender's
// Excel, or typed), the measurement book, running-account bills prepared from
// measurements up to a date (then submitted and certified — measurements in
// a bill are then fixed), money received against bills, as mobilisation
// advance or as retention released, and the site diary. Certified bills post
// to Accounts: contract revenue and GST, against receivables, retention held,
// advance recovered and the client's TDS.
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { boqItemSchema, contractSchema, diarySchema, mbQty, measureSchema, paymentSchema, progress, raBill } from "@/lib/construction/model";
import { target } from "@/lib/import/targets";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { runImport, str } from "../import/run";
import { audit } from "../services/audit";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; has: (m: ModuleId) => boolean };
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const K = schema.conContracts;
const Q = schema.conBoq;
const M = schema.conMeasurements;
const B = schema.conBills;
const Pm = schema.conPayments;
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "con:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "construction")) throw new ApiError("forbidden", "Switch on Construction in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "con:write"), manage: can(role, "con:manage"), has: (id) => visibleTo(visible, id) };
}
const requireWrite = (s: Scope) => {
  if (!s.write) throw new ApiError("forbidden", "Your role can see contracts, but not record work");
};
const requireManage = (s: Scope) => {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
};

async function contract(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Contract");
  const [c] = await db.select().from(K).where(and(eq(K.id, id), eq(K.orgId, s.orgId)));
  if (!c) throw notFound("Contract");
  return c;
}

// ── Contracts and BOQ ───────────────────────────────────────────────────────

export async function contracts(s: Scope) {
  const rows = await db.select({ c: K, boq: sql<number>`(select coalesce(sum(round(q.qty * q.rate)), 0)::bigint from con_boq q where q.contract_id = "con_contracts"."id")`, certified: sql<number>`(select coalesce(sum(b.gross), 0)::bigint from con_bills b where b.contract_id = "con_contracts"."id" and b.status in ('certified','paid'))`, receivable: sql<number>`(select coalesce(sum(b.net - b.received), 0)::bigint from con_bills b where b.contract_id = "con_contracts"."id" and b.status = 'certified')` }).from(K).where(eq(K.orgId, s.orgId)).orderBy(desc(K.createdAt));
  return rows.map(({ c, boq, certified, receivable }) => ({ ...c, boqValue: Number(boq), certified: Number(certified), receivable: Number(receivable), progress: progress(Number(certified), Number(boq)) }));
}

export async function saveContract(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(contractSchema, raw);
  if (id) {
    const c = await contract(s, id);
    const [billed] = await db.select({ id: B.id }).from(B).where(and(eq(B.contractId, c.id), sql`${B.status} <> 'draft'`)).limit(1);
    // Terms that change what a bill is worth stay as they were once a bill is out.
    if (billed && (v.retentionPct !== c.retentionPct || v.advancePct !== c.advancePct || v.gstRate !== c.gstRate || v.tdsPct !== c.tdsPct || v.interState !== c.interState)) throw new ApiError("conflict", "Bills have been submitted on these terms — they can't change now");
    return (await db.update(K).set(v).where(eq(K.id, c.id)).returning())[0];
  }
  return (await db.insert(K).values({ ...v, orgId: s.orgId }).returning())[0];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export async function boq(s: Scope, contractId: string) {
  const c = await contract(s, contractId);
  const items = await db.select().from(Q).where(eq(Q.contractId, c.id)).orderBy(asc(Q.position), asc(Q.code));
  const measured = await db.select({ itemId: M.itemId, qty: sql<number>`round(sum(${M.qty})::numeric, 3)::float` }).from(M).where(eq(M.contractId, c.id)).groupBy(M.itemId);
  const billed = await billedQty(c.id);
  // Quantities are stored as 4-byte floats; show them to three decimals, not their float noise.
  return items.map((i) => ({ ...i, qty: r3(i.qty), amount: Math.round(i.qty * i.rate), measured: measured.find((m) => m.itemId === i.id)?.qty ?? 0, billed: billed[i.id] ?? 0 }));
}

export async function saveItem(s: Scope, contractId: string, id: string | null, raw: unknown) {
  requireManage(s);
  const c = await contract(s, contractId);
  const v = check(boqItemSchema, raw);
  const [dup] = await db.select({ id: Q.id }).from(Q).where(and(eq(Q.contractId, c.id), eq(Q.code, v.code)));
  if (dup && dup.id !== id) throw new ApiError("conflict", `Item ${v.code} is already in the BOQ`);
  if (id) {
    const [r] = await db.update(Q).set(v).where(and(eq(Q.id, id), eq(Q.contractId, c.id))).returning();
    if (!r) throw notFound("BOQ item");
    return r;
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(Q).where(eq(Q.contractId, c.id));
  return (await db.insert(Q).values({ ...v, orgId: s.orgId, contractId: c.id, position: n + 1 }).returning())[0];
}

export async function importBoq(s: Scope, contractId: string, raw: unknown) {
  requireManage(s);
  const c = await contract(s, contractId);
  return runImport(target("construction.boq"), raw, async (v, mode) => {
    const code = str(v.code).trim();
    const [found] = await db.select({ id: Q.id }).from(Q).where(and(eq(Q.contractId, c.id), eq(Q.code, code)));
    if (found && mode === "skip") return "skipped";
    await saveItem(s, c.id, found?.id ?? null, { code, description: str(v.description), unit: str(v.unit), qty: Number(v.qty), rate: Number(v.rate) });
    return found ? "updated" : "created";
  });
}

// ── Measurement book ────────────────────────────────────────────────────────

export async function measurements(s: Scope, contractId: string) {
  const c = await contract(s, contractId);
  return db.select({ m: M, code: Q.code, unit: Q.unit, by: schema.users.name }).from(M).innerJoin(Q, eq(Q.id, M.itemId)).leftJoin(schema.users, eq(schema.users.id, M.recordedBy)).where(eq(M.contractId, c.id)).orderBy(desc(M.date), desc(M.createdAt)).then((r) => r.map(({ m, ...x }) => ({ ...m, ...x })));
}

export async function measure(s: Scope, contractId: string, raw: unknown) {
  requireWrite(s);
  const c = await contract(s, contractId);
  if (c.status !== "active") throw new ApiError("conflict", "This contract isn't active");
  const v = check(measureSchema, raw);
  const [item] = await db.select().from(Q).where(and(eq(Q.id, v.itemId), eq(Q.contractId, c.id)));
  if (!item) throw new ApiError("validation_failed", "That item isn't in this contract's BOQ");
  if (v.date > todayIst()) throw new ApiError("validation_failed", "A measurement can't be in the future");
  const qty = mbQty(v);
  if (!qty) throw new ApiError("validation_failed", "This measurement comes to nothing — check the numbers and dimensions");
  return (await db.insert(M).values({ ...v, qty, orgId: s.orgId, contractId: c.id, recordedBy: s.userId }).returning())[0];
}

export async function checkMeasurement(s: Scope, id: string) {
  requireManage(s);
  const [r] = await db.update(M).set({ checkedBy: s.userId }).where(and(eq(M.id, id), eq(M.orgId, s.orgId))).returning();
  if (!r) throw notFound("Measurement");
  return r;
}

export async function deleteMeasurement(s: Scope, id: string) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Measurement");
  const [m] = await db.select().from(M).where(and(eq(M.id, id), eq(M.orgId, s.orgId)));
  if (!m) throw notFound("Measurement");
  if (m.billId) throw new ApiError("conflict", "This measurement is in an RA bill — record a deduction instead");
  await db.delete(M).where(eq(M.id, m.id));
}

// ── RA bills ────────────────────────────────────────────────────────────────

async function billedQty(contractId: string, exceptBill?: string) {
  const bills = await db.select({ lines: B.lines, id: B.id }).from(B).where(eq(B.contractId, contractId));
  const out: Record<string, number> = {};
  for (const b of bills) if (b.id !== exceptBill) for (const l of b.lines) out[l.itemId] = Math.round(((out[l.itemId] ?? 0) + l.qty) * 1000) / 1000;
  return out;
}

async function advanceLeft(contractId: string, exceptBill?: string) {
  const [got] = await db.select({ n: sql<number>`coalesce(sum(${Pm.amount}), 0)::bigint` }).from(Pm).where(and(eq(Pm.contractId, contractId), eq(Pm.kind, "advance")));
  const [rec] = await db.select({ n: sql<number>`coalesce(sum(${B.advance}), 0)::bigint` }).from(B).where(and(eq(B.contractId, contractId), exceptBill ? sql`${B.id} <> ${exceptBill}` : sql`true`));
  return Number(got.n) - Number(rec.n);
}

/** Prepare the next RA bill from measurements up to a date; only one draft at a time. */
export async function prepareBill(s: Scope, contractId: string, raw: unknown) {
  requireWrite(s);
  const c = await contract(s, contractId);
  const { upTo } = check(z.object({ upTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), raw);
  if (upTo > todayIst()) throw new ApiError("validation_failed", "Bill up to today at the latest");
  const [draft] = await db.select({ id: B.id }).from(B).where(and(eq(B.contractId, c.id), eq(B.status, "draft")));
  if (draft) throw new ApiError("conflict", "There's already a draft bill — finish or delete it first");
  const items = await db.select().from(Q).where(eq(Q.contractId, c.id)).orderBy(asc(Q.position));
  const toDate = Object.fromEntries((await db.select({ itemId: M.itemId, qty: sql<number>`round(sum(${M.qty})::numeric, 3)::float` }).from(M).where(and(eq(M.contractId, c.id), lte(M.date, upTo))).groupBy(M.itemId)).map((r) => [r.itemId, r.qty]));
  const r = raBill(items, toDate, await billedQty(c.id), c, await advanceLeft(c.id));
  if (!r.lines.length) throw new ApiError("conflict", "No new work measured since the last bill");
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${B.seq}), 0)::int` }).from(B).where(eq(B.contractId, c.id));
  const [bill] = await db.insert(B).values({ orgId: s.orgId, contractId: c.id, seq: n + 1, upTo, lines: r.lines, gross: r.gross, retention: r.retention, advance: r.advance, gst: r.gst, tds: r.tds, net: r.net, createdBy: s.userId }).returning();
  await db.update(M).set({ billId: bill.id }).where(and(eq(M.contractId, c.id), lte(M.date, upTo), isNull(M.billId)));
  return bill;
}

export async function deleteDraft(s: Scope, billId: string) {
  requireWrite(s);
  const b = await bill(s, billId);
  if (b.status !== "draft") throw new ApiError("conflict", "Only a draft can be deleted");
  await db.update(M).set({ billId: null }).where(eq(M.billId, b.id));
  await db.delete(B).where(eq(B.id, b.id));
}

async function bill(s: Scope, id: string) {
  if (!isId(id)) throw notFound("RA bill");
  const [b] = await db.select().from(B).where(and(eq(B.id, id), eq(B.orgId, s.orgId)));
  if (!b) throw notFound("RA bill");
  return b;
}

export async function bills(s: Scope, contractId: string) {
  const c = await contract(s, contractId);
  return db.select().from(B).where(eq(B.contractId, c.id)).orderBy(desc(B.seq));
}

/** Submit a draft to the client, or record their certification (with the amount they certified, if less). */
export async function advanceBill(s: Scope, id: string, raw: unknown) {
  const b = await bill(s, id);
  const v = check(z.object({ to: z.enum(["submitted", "certified"]), certifiedGross: z.number().int().min(0).nullable().default(null), clientRef: z.string().trim().max(80).default(""), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) }), raw);
  if (v.to === "submitted") {
    requireWrite(s);
    if (b.status !== "draft") throw new ApiError("conflict", "Only a draft can be submitted");
    return (await db.update(B).set({ status: "submitted" }).where(eq(B.id, b.id)).returning())[0];
  }
  requireManage(s);
  if (b.status !== "submitted") throw new ApiError("conflict", "Submit the bill before recording its certification");
  const c = await contract(s, b.contractId);
  // A lower certified figure scales every deduction the same way (the client cut quantities or rates).
  let patch = {};
  if (v.certifiedGross !== null && v.certifiedGross !== b.gross) {
    if (v.certifiedGross > b.gross) throw new ApiError("validation_failed", "The certified amount can't be more than what was billed");
    const gross = v.certifiedGross;
    const retention = Math.round((gross * c.retentionPct) / 100);
    const advance = Math.min(await advanceLeft(c.id, b.id), Math.round((gross * c.advancePct) / 100));
    const gst = Math.round((gross * c.gstRate) / 100);
    const tds = Math.round((gross * c.tdsPct) / 100);
    patch = { gross, retention, advance, gst, tds, net: gross + gst - retention - advance - tds };
  }
  const [r] = await db.update(B).set({ ...patch, status: "certified", certifiedOn: v.date ?? todayIst(), clientRef: v.clientRef }).where(eq(B.id, b.id)).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "construction.bill_certified", targetType: "con_bill", targetId: b.id, metadata: { contract: c.name, seq: b.seq, gross: r.gross, net: r.net } });
  return r;
}

// ── Money received ──────────────────────────────────────────────────────────

export async function payments(s: Scope, contractId: string) {
  const c = await contract(s, contractId);
  return db.select().from(Pm).where(eq(Pm.contractId, c.id)).orderBy(desc(Pm.date));
}

export async function receive(s: Scope, contractId: string, raw: unknown) {
  requireManage(s);
  const c = await contract(s, contractId);
  const v = check(paymentSchema, raw);
  if (v.date > todayIst()) throw new ApiError("validation_failed", "Can't be in the future");
  if (v.accountId) {
    const [a] = await db.select({ subtype: schema.accAccounts.subtype }).from(schema.accAccounts).where(and(eq(schema.accAccounts.id, v.accountId), eq(schema.accAccounts.orgId, s.orgId)));
    if (!a || !["cash", "bank"].includes(a.subtype ?? "")) throw new ApiError("validation_failed", "Pick a cash or bank account");
  }
  if (v.kind === "bill") {
    if (!v.billId) throw new ApiError("validation_failed", "Pick the RA bill it's for");
    const b = await bill(s, v.billId);
    if (b.contractId !== c.id || b.status !== "certified") throw new ApiError("conflict", "Money is received against certified bills only");
    if (v.amount > b.net - b.received) throw new ApiError("validation_failed", "That's more than is due on the bill");
    const received = b.received + v.amount;
    await db.update(B).set({ received, status: received >= b.net ? "paid" : "certified" }).where(eq(B.id, b.id));
  }
  if (v.kind === "retention") {
    const [held] = await db.select({ n: sql<number>`coalesce(sum(${B.retention}), 0)::bigint` }).from(B).where(and(eq(B.contractId, c.id), sql`${B.status} in ('certified','paid')`));
    const [back] = await db.select({ n: sql<number>`coalesce(sum(${Pm.amount}), 0)::bigint` }).from(Pm).where(and(eq(Pm.contractId, c.id), eq(Pm.kind, "retention")));
    if (v.amount > Number(held.n) - Number(back.n)) throw new ApiError("validation_failed", "That's more retention than the client holds");
  }
  return (await db.insert(Pm).values({ ...v, billId: v.kind === "bill" ? v.billId : null, orgId: s.orgId, contractId: c.id, createdBy: s.userId }).returning())[0];
}

// ── Site diary ──────────────────────────────────────────────────────────────

export async function diary(s: Scope, contractId: string) {
  const c = await contract(s, contractId);
  return db.select({ d: schema.conDiary, by: schema.users.name }).from(schema.conDiary).leftJoin(schema.users, eq(schema.users.id, schema.conDiary.by)).where(eq(schema.conDiary.contractId, c.id)).orderBy(desc(schema.conDiary.date)).limit(200).then((r) => r.map(({ d, by }) => ({ ...d, byName: by })));
}

export async function writeDiary(s: Scope, contractId: string, raw: unknown) {
  requireWrite(s);
  const c = await contract(s, contractId);
  const v = check(diarySchema, raw);
  if (v.date > todayIst()) throw new ApiError("validation_failed", "A diary entry can't be for a future day");
  const [r] = await db.insert(schema.conDiary).values({ ...v, orgId: s.orgId, contractId: c.id, by: s.userId }).onConflictDoUpdate({ target: [schema.conDiary.contractId, schema.conDiary.date], set: { weather: v.weather, labour: v.labour, work: v.work, hindrances: v.hindrances, visitors: v.visitors, by: s.userId } }).returning();
  return r;
}

export async function contractDetail(s: Scope, id: string) {
  const c = (await contracts(s)).find((x) => x.id === id);
  if (!c) throw notFound("Contract");
  return { contract: c, advanceLeft: await advanceLeft(id) };
}

// ── Accounts ────────────────────────────────────────────────────────────────

/** Certified bills (revenue and GST against receivables, retention, advance recovered and TDS) and money received. */
export async function constructionWants(orgId: string) {
  const rows = await db.select({ b: B, c: K }).from(B).innerJoin(K, eq(K.id, B.contractId)).where(and(eq(B.orgId, orgId), sql`${B.status} in ('certified','paid')`));
  const pays = await db.select({ p: Pm, c: K }).from(Pm).innerJoin(K, eq(K.id, Pm.contractId)).where(eq(Pm.orgId, orgId));
  const out: { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: { key?: string; accountId?: string; debit: number; credit: number }[] }[] = [];
  for (const { b, c } of rows) {
    const cg = c.interState ? 0 : Math.floor(b.gst / 2);
    out.push({
      sourceType: "ra_bill",
      sourceId: b.id,
      date: String(b.certifiedOn ?? b.upTo),
      narration: `RA-${b.seq} certified — ${c.name}`,
      sourceRef: `RA-${b.seq}${b.clientRef ? ` (${b.clientRef})` : ""}`,
      party: c.client,
      lines: [
        { key: "ar", debit: b.net, credit: 0 },
        { key: "retention_receivable", debit: b.retention, credit: 0 },
        { key: "customer_advances", debit: b.advance, credit: 0 },
        { key: "tds_receivable", debit: b.tds, credit: 0 },
        { key: "contract_revenue", debit: 0, credit: b.gross },
        ...(c.interState ? [{ key: "igst_out", debit: 0, credit: b.gst }] : [{ key: "cgst_out", debit: 0, credit: cg }, { key: "sgst_out", debit: 0, credit: b.gst - cg }]),
      ],
    });
  }
  for (const { p, c } of pays) {
    const against = p.kind === "advance" ? "customer_advances" : p.kind === "retention" ? "retention_receivable" : "ar";
    out.push({ sourceType: "contract_receipt", sourceId: p.id, date: String(p.date), narration: `${p.kind === "advance" ? "Mobilisation advance" : p.kind === "retention" ? "Retention released" : "Received"} — ${c.name}`, sourceRef: p.reference || c.workOrderNo || c.name, party: c.client, lines: [{ ...(p.accountId ? { accountId: p.accountId } : { key: "bank" }), debit: p.amount, credit: 0 }, { key: against, debit: 0, credit: p.amount }] });
  }
  return out;
}
