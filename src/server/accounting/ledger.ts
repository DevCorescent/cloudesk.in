// The ledger: accounts, journals and balances. Every journal — typed in by
// hand or posted from another module — is checked here: it balances, uses
// this workspace's accounts, and isn't dated inside a locked period.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, schema } from "@/db";
import { accountSchema, balanced, journalSchema, natural, type PostLine } from "@/lib/accounting/model";
import { ApiError, notFound } from "../http/errors";
import { gate } from "../approvals/engine";
import { ensureDefaultCompany, getCompany } from "../org/org";
import { assertPeriodOpen } from "./periods";
import { audit } from "../services/audit";
import { check, nextNumber, requireManage, requireWrite, type Scope } from "./access";
import { contains } from "../security/like";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;

// ─── Accounts ───

export async function accounts(orgId: string) {
  return db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId)).orderBy(asc(schema.accAccounts.code));
}

/** System account ids by key ("sales", "ar", "cgst_out"…). */
export async function accountKeys(orgId: string, exec: Exec = db) {
  const rows = await exec.select({ id: schema.accAccounts.id, key: schema.accAccounts.systemKey }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), sql`${schema.accAccounts.systemKey} is not null`));
  return new Map(rows.map((r) => [r.key!, r.id]));
}

export async function saveAccount(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const b = check(accountSchema, raw);
  try {
    if (id) {
      const [cur] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, id)));
      if (!cur) throw notFound("Account");
      // The type decides which side of the books it's on; it can't move once used.
      if (cur.type !== b.type) {
        const [used] = await db.select({ id: schema.accLines.id }).from(schema.accLines).where(eq(schema.accLines.accountId, id)).limit(1);
        if (used) throw new ApiError("conflict", "This account has entries, so its type can't change");
      }
      if (cur.systemKey && !b.active) throw new ApiError("conflict", "Cloudesk posts to this account, so it can't be switched off");
      const [r] = await db.update(schema.accAccounts).set(b).where(eq(schema.accAccounts.id, id)).returning();
      return r;
    }
    const [r] = await db.insert(schema.accAccounts).values({ ...b, orgId: s.orgId }).returning();
    return r;
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505" || (e as { code?: string }).code === "23505") throw new ApiError("conflict", "Another account already has that code");
    throw e;
  }
}

export async function deleteAccount(s: Scope, id: string) {
  requireManage(s);
  const [cur] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, id)));
  if (!cur) throw notFound("Account");
  if (cur.systemKey) throw new ApiError("conflict", "Cloudesk posts to this account, so it can't be deleted");
  const [used] = await db.select({ id: schema.accLines.id }).from(schema.accLines).where(eq(schema.accLines.accountId, id)).limit(1);
  if (used) throw new ApiError("conflict", "This account has entries — switch it off instead");
  await db.delete(schema.accAccounts).where(eq(schema.accAccounts.id, id));
}

// ─── Journals ───

export function assertOpen(s: Pick<Scope, "settings">, date: string, what = "This") {
  if (s.settings.lockDate && date <= s.settings.lockDate) throw new ApiError("conflict", `${what} is dated in a locked period (up to ${s.settings.lockDate}). Unlock it in Settings to change it.`);
}

export type JournalInput = { date: string; narration: string; sourceType: string; sourceId?: string | null; sourceRef?: string; party?: string; lines: PostLine[]; hash?: string; companyId?: string | null };

/** Write a balanced journal. Lines name accounts by id or by system key. */
export async function postJournal(tx: Tx, s: Pick<Scope, "orgId" | "userId" | "settings">, j: JournalInput, keys?: Map<string, string>) {
  const lines = j.lines.filter((l) => l.debit || l.credit);
  if (!balanced(lines)) throw new ApiError("validation_failed", `Debits and credits must be equal and more than zero (${j.sourceRef || j.narration || "journal"})`);
  const k = keys ?? (await accountKeys(s.orgId, tx));
  const resolved = lines.map((l) => {
    const accountId = l.accountId ?? (l.key ? k.get(l.key) : undefined);
    if (!accountId) throw new ApiError("conflict", `The account for “${l.key}” is missing from the chart of accounts`);
    return { ...l, accountId };
  });
  const ids = [...new Set(resolved.map((l) => l.accountId))];
  const own = await tx.select({ id: schema.accAccounts.id }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), inArray(schema.accAccounts.id, ids)));
  if (own.length !== ids.length) throw new ApiError("validation_failed", "Use accounts from this workspace");
  // Dimensions must be this workspace's own cost centres and branches.
  const units = [...new Set(resolved.map((l) => l.costCentreId).filter((x): x is string => !!x))];
  if (units.length && (await tx.select({ id: schema.orgUnits.id }).from(schema.orgUnits).where(and(eq(schema.orgUnits.orgId, s.orgId), inArray(schema.orgUnits.id, units)))).length !== units.length) throw new ApiError("validation_failed", "Use cost centres from this workspace");
  const brs = [...new Set(resolved.map((l) => l.branchId).filter((x): x is string => !!x))];
  if (brs.length && (await tx.select({ id: schema.orgBranches.id }).from(schema.orgBranches).where(and(eq(schema.orgBranches.orgId, s.orgId), inArray(schema.orgBranches.id, brs)))).length !== brs.length) throw new ApiError("validation_failed", "Use branches from this workspace");
  const partners = [...new Set(resolved.map((l) => l.partnerCompanyId).filter((x): x is string => !!x))];
  if (partners.length && (await tx.select({ id: schema.orgCompanies.id }).from(schema.orgCompanies).where(and(eq(schema.orgCompanies.orgId, s.orgId), inArray(schema.orgCompanies.id, partners)))).length !== partners.length) throw new ApiError("validation_failed", "Use companies from this workspace");
  // Same account, side and dimensions on several lines are merged, so journals stay short.
  const merged = new Map<string, { accountId: string; debit: number; credit: number; description: string; costCentreId: string | null; branchId: string | null; partnerCompanyId: string | null }>();
  for (const l of resolved) {
    const side = l.debit ? "d" : "c";
    const k = `${l.accountId}|${side}|${l.description ?? ""}|${l.costCentreId ?? ""}|${l.branchId ?? ""}|${l.partnerCompanyId ?? ""}`;
    const m = merged.get(k) ?? { accountId: l.accountId, debit: 0, credit: 0, description: l.description ?? "", costCentreId: l.costCentreId ?? null, branchId: l.branchId ?? null, partnerCompanyId: l.partnerCompanyId ?? null };
    m.debit += l.debit;
    m.credit += l.credit;
    merged.set(k, m);
  }
  const total = resolved.reduce((a, l) => a + l.debit, 0);
  const number = j.sourceType === "manual" || j.sourceType === "opening" || j.sourceType === "bank" ? await nextNumber(s.orgId, "journal", s.settings.journalPrefix) : j.sourceRef || j.sourceType;
  const companyId = j.companyId ?? (await ensureDefaultCompany(s.orgId)).id;
  if (partners.includes(companyId)) throw new ApiError("validation_failed", "An intercompany line names another company, not the journal's own");
  const [jr] = await tx
    .insert(schema.accJournals)
    .values({ orgId: s.orgId, number, date: j.date, narration: j.narration, sourceType: j.sourceType, sourceId: j.sourceId ?? null, sourceRef: j.sourceRef ?? "", party: j.party ?? "", total, hash: j.hash ?? "", createdBy: s.userId || null, companyId })
    .returning();
  await tx.insert(schema.accLines).values([...merged.values()].map((l) => ({ ...l, orgId: s.orgId, journalId: jr.id })));
  return jr;
}

export async function createJournal(s: Scope, raw: unknown) {
  requireWrite(s);
  const b = check(journalSchema, raw);
  assertOpen(s, b.date, "This journal");
  for (const l of b.lines) if (l.debit && l.credit) throw new ApiError("validation_failed", "Each line is either a debit or a credit");
  if (!balanced(b.lines)) throw new ApiError("validation_failed", "Debits and credits must be equal and more than zero");
  b.companyId = await companyFor(s, b.companyId);
  await assertPeriodOpen(s.orgId, b.companyId, b.date, "This journal");
  // A journal waiting for approval doesn't exist in the books yet: the request carries it.
  const total = b.lines.reduce((a, l) => a + l.debit, 0);
  const g = await gate(s.orgId, { kind: "acc.journal", refId: randomUUID(), label: `Journal · ${b.narration || b.date}`, amount: total, requesterId: s.userId, link: "/accounts/journals", payload: b });
  if (g.status === "pending") return { journal: null, approval: g.request!.id };
  return { journal: await postManual(s, b), approval: null };
}

/** The company an entry is for: the one asked for (if the member may use it), or the default. */
async function companyFor(s: Pick<Scope, "orgId"> & { access?: Scope["access"] }, companyId: string | null) {
  const id = companyId ? (await getCompany(s.orgId, companyId)).id : (await ensureDefaultCompany(s.orgId)).id;
  if (s.access?.companies?.length && !s.access.companies.includes(id)) throw new ApiError("forbidden", "You can't post to that company");
  return id;
}

async function postManual(s: Pick<Scope, "orgId" | "userId" | "settings">, b: z.infer<typeof journalSchema>) {
  const j = await db.transaction((tx) => postJournal(tx, s, { date: b.date, narration: b.narration, sourceType: b.opening ? "opening" : "manual", lines: b.lines, companyId: b.companyId }));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.journal_created", targetType: "acc_journal", targetId: j.id, metadata: { number: j.number, total: j.total } });
  return j;
}

/** After approval: post the journal the request carried, as the person who asked for it. */
export async function journalApproved(orgId: string, requesterId: string | null, payload: unknown) {
  const { systemScope } = await import("./access");
  const s = { ...(await systemScope(orgId)), userId: requesterId ?? "" };
  const b = check(journalSchema, payload);
  assertOpen(s, b.date, "This journal");
  await assertPeriodOpen(orgId, b.companyId, b.date, "This journal");
  return postManual(s, b);
}

/** Only journals typed in here can be deleted; posted ones follow their source. */
export async function deleteJournal(s: Scope, id: string) {
  requireWrite(s);
  const [j] = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, s.orgId), eq(schema.accJournals.id, id)));
  if (!j) throw notFound("Journal");
  if (!["manual", "opening", "bank"].includes(j.sourceType)) throw new ApiError("conflict", "This entry comes from another part of Cloudesk — change or cancel it there");
  assertOpen(s, String(j.date), "This journal");
  await assertPeriodOpen(s.orgId, j.companyId, String(j.date), "This journal");
  const [rec] = await db.select({ id: schema.accLines.id }).from(schema.accLines).where(and(eq(schema.accLines.journalId, id), sql`${schema.accLines.reconciledAt} is not null`)).limit(1);
  if (rec) throw new ApiError("conflict", "A line of this journal is matched to a bank statement — unmatch it first");
  await db.update(schema.accBankLines).set({ status: "unmatched", lineId: null }).where(sql`${schema.accBankLines.lineId} in (select id from acc_lines where journal_id = ${id})`);
  await db.delete(schema.accJournals).where(eq(schema.accJournals.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.journal_deleted", targetType: "acc_journal", targetId: id, metadata: { number: j.number } });
}

export async function journals(s: Scope, opts: { from?: string; to?: string; type?: string; q?: string; accountId?: string; companyId?: string; costCentreId?: string; branchId?: string } = {}) {
  const dim = dimOf(s, opts);
  const rows = await db
    .select()
    .from(schema.accJournals)
    .where(
      and(
        eq(schema.accJournals.orgId, s.orgId),
        opts.from ? gte(schema.accJournals.date, opts.from) : undefined,
        opts.to ? lte(schema.accJournals.date, opts.to) : undefined,
        opts.type ? eq(schema.accJournals.sourceType, opts.type) : undefined,
        opts.q ? sql`(${schema.accJournals.narration} ilike ${contains(opts.q)} or ${schema.accJournals.party} ilike ${contains(opts.q)} or ${schema.accJournals.sourceRef} ilike ${contains(opts.q)} or ${schema.accJournals.number} ilike ${contains(opts.q)})` : undefined,
        opts.accountId ? sql`exists (select 1 from acc_lines l where l.journal_id = ${schema.accJournals.id} and l.account_id = ${opts.accountId})` : undefined,
        dim.companies ? inArray(schema.accJournals.companyId, dim.companies) : undefined,
        dim.costCentreId ? sql`exists (select 1 from acc_lines l where l.journal_id = ${schema.accJournals.id} and l.cost_centre_id = ${dim.costCentreId})` : undefined,
        dim.branchId ? sql`exists (select 1 from acc_lines l where l.journal_id = ${schema.accJournals.id} and l.branch_id = ${dim.branchId})` : undefined,
      ),
    )
    .orderBy(desc(schema.accJournals.date), desc(schema.accJournals.createdAt))
    .limit(500);
  const lines = rows.length ? await db.select().from(schema.accLines).where(inArray(schema.accLines.journalId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.journalId === r.id) }));
}

// ─── Balances ───

/** Which part of the books: some companies (null: all), one cost centre, one branch. */
export type Dim = { companies: string[] | null; costCentreId: string | null; branchId: string | null };
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** The slice of the books a request asks for, kept within the companies the member may see. */
export function dimOf(s: Pick<Scope, "access">, q: { companyId?: string; costCentreId?: string; branchId?: string }): Dim {
  const allowed = s.access?.companies?.length ? s.access.companies : null;
  let companies = isId(q.companyId) ? [q.companyId] : allowed;
  if (allowed && companies) companies = companies.filter((c) => allowed.includes(c));
  if (allowed && companies && !companies.length) throw new ApiError("forbidden", "You can't see that company's books");
  return { companies, costCentreId: isId(q.costCentreId) ? q.costCentreId : null, branchId: isId(q.branchId) ? q.branchId : (s.access?.branches?.length === 1 ? s.access.branches[0] : null) };
}

const dimWhere = (d?: Dim) => [d?.companies ? inArray(schema.accJournals.companyId, d.companies) : undefined, d?.costCentreId ? eq(schema.accLines.costCentreId, d.costCentreId) : undefined, d?.branchId ? eq(schema.accLines.branchId, d.branchId) : undefined];

/** Debit and credit totals per account, for a date range (or up to a date), within a slice of the books. */
export async function balances(orgId: string, opts: { from?: string; to?: string; dim?: Dim } = {}) {
  const rows = await db
    .select({ accountId: schema.accLines.accountId, debit: sql<number>`coalesce(sum(${schema.accLines.debit}),0)::bigint`, credit: sql<number>`coalesce(sum(${schema.accLines.credit}),0)::bigint` })
    .from(schema.accLines)
    .innerJoin(schema.accJournals, eq(schema.accJournals.id, schema.accLines.journalId))
    .where(and(eq(schema.accLines.orgId, orgId), opts.from ? gte(schema.accJournals.date, opts.from) : undefined, opts.to ? lte(schema.accJournals.date, opts.to) : undefined, ...dimWhere(opts.dim)))
    .groupBy(schema.accLines.accountId);
  return new Map(rows.map((r) => [r.accountId, { debit: Number(r.debit), credit: Number(r.credit) }]));
}

/** One account's entries with a running balance. */
export async function ledger(s: Scope, accountId: string, opts: { from?: string; to?: string; companyId?: string; costCentreId?: string; branchId?: string } = {}) {
  const [acc] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, accountId)));
  if (!acc) throw notFound("Account");
  const dim = dimOf(s, opts);
  const before = opts.from ? (await balances(s.orgId, { to: prevDay(opts.from), dim })).get(accountId) : undefined;
  const opening = before ? natural(acc.type, before.debit, before.credit) : 0;
  const rows = await db
    .select({ l: schema.accLines, j: schema.accJournals })
    .from(schema.accLines)
    .innerJoin(schema.accJournals, eq(schema.accJournals.id, schema.accLines.journalId))
    .where(and(eq(schema.accLines.accountId, accountId), opts.from ? gte(schema.accJournals.date, opts.from) : undefined, opts.to ? lte(schema.accJournals.date, opts.to) : undefined, ...dimWhere(dim)))
    .orderBy(asc(schema.accJournals.date), asc(schema.accJournals.createdAt))
    .limit(2000);
  let run = opening;
  const entries = rows.map(({ l, j }) => {
    run += natural(acc.type, l.debit, l.credit);
    return { id: l.id, journalId: j.id, date: String(j.date), number: j.number, sourceType: j.sourceType, sourceRef: j.sourceRef, party: j.party, narration: j.narration || l.description, debit: l.debit, credit: l.credit, balance: run, reconciled: !!l.reconciledAt };
  });
  return { account: acc, opening, closing: run, entries };
}

export const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
