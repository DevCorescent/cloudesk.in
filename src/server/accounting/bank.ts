// Banking: bank and cash accounts with their balances, statements imported
// from a CSV, and reconciliation — each statement line matched to an entry in
// the books, or turned into one (bank charges, interest, a payment not yet
// recorded), or ignored.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { natural, parseStatement } from "@/lib/accounting/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { check, requirePart, requireWrite, type Scope } from "./access";
import { assertOpen, balances, postJournal } from "./ledger";

async function bankAccount(orgId: string, id: string) {
  const [a] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), eq(schema.accAccounts.id, id)));
  if (!a || !["bank", "cash"].includes(a.subtype)) throw notFound("Bank account");
  return a;
}

/** Bank and cash accounts with their book balance and what's waiting to be matched. */
export async function bankAccounts(s: Scope) {
  const accs = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), inArray(schema.accAccounts.subtype, ["bank", "cash"]))).orderBy(asc(schema.accAccounts.code));
  const bal = await balances(s.orgId);
  const pending = await db.select({ accountId: schema.accBankLines.accountId, n: sql<number>`count(*)::int`, last: sql<string>`max(${schema.accBankLines.date})::text` }).from(schema.accBankLines).where(and(eq(schema.accBankLines.orgId, s.orgId), eq(schema.accBankLines.status, "unmatched"))).groupBy(schema.accBankLines.accountId);
  return accs.map((a) => {
    const b = bal.get(a.id) ?? { debit: 0, credit: 0 };
    const p = pending.find((x) => x.accountId === a.id);
    return { ...a, balance: natural(a.type, b.debit, b.credit), unmatched: p?.n ?? 0 };
  });
}

/** Import a statement CSV. Lines already imported (same date, amount, description and reference) are skipped. */
export async function importStatement(s: Scope, accountId: string, csv: string) {
  requireWrite(s);
  requirePart(s, "banking");
  if (csv.length > 2_000_000) throw new ApiError("validation_failed", "That file is too large — split it by month");
  const { lines, problem } = parseStatement(csv);
  if (problem) throw new ApiError("validation_failed", problem);
  return addStatementLines(s, accountId, lines);
}

/** Add statement lines (from a CSV or the smart importer), skip ones already here, and match what's clear. */
export async function addStatementLines(s: Scope, accountId: string, lines: { date: string; description: string; reference: string; amount: number }[]) {
  requireWrite(s);
  requirePart(s, "banking");
  const acc = await bankAccount(s.orgId, accountId);
  // Two identical transactions on one day are kept apart by their order in the file.
  const seen = new Map<string, number>();
  const rows = lines.map((l) => {
    const base = `${l.date}|${l.amount}|${l.description}|${l.reference}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { orgId: s.orgId, accountId: acc.id, ...l, fingerprint: createHash("sha1").update(`${base}|${n}`).digest("hex") };
  });
  const inserted = rows.length ? await db.insert(schema.accBankLines).values(rows).onConflictDoNothing().returning({ id: schema.accBankLines.id }) : [];
  const auto = await autoMatch(s, acc.id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.statement_imported", targetType: "acc_account", targetId: acc.id, metadata: { lines: rows.length, added: inserted.length, matched: auto } });
  return { read: rows.length, added: inserted.length, skipped: rows.length - inserted.length, matched: auto };
}

type Candidate = { lineId: string; journalId: string; date: string; amount: number; number: string; narration: string; party: string; sourceRef: string };

/** Book entries on this account not yet matched, as signed amounts (money in positive). */
async function openEntries(orgId: string, accountId: string): Promise<Candidate[]> {
  const rows = await db
    .select({ l: schema.accLines, j: schema.accJournals })
    .from(schema.accLines)
    .innerJoin(schema.accJournals, eq(schema.accJournals.id, schema.accLines.journalId))
    .where(and(eq(schema.accLines.orgId, orgId), eq(schema.accLines.accountId, accountId), isNull(schema.accLines.reconciledAt)))
    .orderBy(asc(schema.accJournals.date));
  return rows.map(({ l, j }) => ({ lineId: l.id, journalId: j.id, date: String(j.date), amount: l.debit - l.credit, number: j.number, narration: j.narration, party: j.party, sourceRef: j.sourceRef }));
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;

/** Lines with exactly one book entry of the same amount within 5 days are matched for you. */
async function autoMatch(s: Scope, accountId: string) {
  const lines = await db.select().from(schema.accBankLines).where(and(eq(schema.accBankLines.accountId, accountId), eq(schema.accBankLines.status, "unmatched")));
  let open = await openEntries(s.orgId, accountId);
  let matched = 0;
  for (const bl of lines) {
    const hits = open.filter((c) => c.amount === bl.amount && days(c.date, String(bl.date)) <= 5);
    if (hits.length !== 1) continue;
    await link(bl.id, hits[0].lineId);
    open = open.filter((c) => c.lineId !== hits[0].lineId);
    matched++;
  }
  return matched;
}

async function link(bankLineId: string, lineId: string) {
  await db.transaction(async (tx) => {
    await tx.update(schema.accBankLines).set({ status: "matched", lineId }).where(eq(schema.accBankLines.id, bankLineId));
    await tx.update(schema.accLines).set({ reconciledAt: new Date() }).where(eq(schema.accLines.id, lineId));
  });
}

/** The reconciliation screen: statement lines, with suggestions for the unmatched ones. */
export async function reconcileView(s: Scope, accountId: string, status = "unmatched") {
  const acc = await bankAccount(s.orgId, accountId);
  const lines = await db.select().from(schema.accBankLines).where(and(eq(schema.accBankLines.accountId, acc.id), status === "all" ? undefined : eq(schema.accBankLines.status, status))).orderBy(desc(schema.accBankLines.date)).limit(500);
  const open = await openEntries(s.orgId, acc.id);
  const matchedTo = lines.filter((l) => l.lineId).length ? await db.select({ id: schema.accLines.id, number: schema.accJournals.number, narration: schema.accJournals.narration }).from(schema.accLines).innerJoin(schema.accJournals, eq(schema.accJournals.id, schema.accLines.journalId)).where(inArray(schema.accLines.id, lines.filter((l) => l.lineId).map((l) => l.lineId!))) : [];
  const [{ statementBalance }] = await db.select({ statementBalance: sql<number>`coalesce(sum(${schema.accBankLines.amount}),0)::bigint` }).from(schema.accBankLines).where(and(eq(schema.accBankLines.accountId, acc.id), sql`${schema.accBankLines.status} <> 'ignored'`));
  return {
    account: acc,
    lines: lines.map((l) => ({
      ...l,
      matchedTo: matchedTo.find((m) => m.id === l.lineId) ?? null,
      suggestions: l.status === "unmatched" ? open.filter((c) => c.amount === l.amount).sort((a, b) => days(a.date, String(l.date)) - days(b.date, String(l.date))).slice(0, 3) : [],
    })),
    unmatchedBook: open.length,
    statementTotal: Number(statementBalance),
  };
}

export async function matchLine(s: Scope, bankLineId: string, lineId: string) {
  requireWrite(s);
  const [bl] = await db.select().from(schema.accBankLines).where(and(eq(schema.accBankLines.orgId, s.orgId), eq(schema.accBankLines.id, bankLineId)));
  if (!bl) throw notFound("Statement line");
  if (bl.status !== "unmatched") throw new ApiError("conflict", "This line is already dealt with");
  const [l] = await db.select().from(schema.accLines).where(and(eq(schema.accLines.orgId, s.orgId), eq(schema.accLines.id, lineId)));
  if (!l || l.accountId !== bl.accountId) throw new ApiError("validation_failed", "Pick an entry on the same account");
  if (l.reconciledAt) throw new ApiError("conflict", "That entry is already matched");
  if (l.debit - l.credit !== bl.amount) throw new ApiError("validation_failed", "The amounts don't match");
  await link(bl.id, l.id);
}

export async function unmatchLine(s: Scope, bankLineId: string) {
  requireWrite(s);
  const [bl] = await db.select().from(schema.accBankLines).where(and(eq(schema.accBankLines.orgId, s.orgId), eq(schema.accBankLines.id, bankLineId)));
  if (!bl) throw notFound("Statement line");
  await db.transaction(async (tx) => {
    if (bl.lineId) await tx.update(schema.accLines).set({ reconciledAt: null }).where(eq(schema.accLines.id, bl.lineId));
    await tx.update(schema.accBankLines).set({ status: "unmatched", lineId: null }).where(eq(schema.accBankLines.id, bl.id));
  });
}

export async function ignoreLine(s: Scope, bankLineId: string, ignore: boolean) {
  requireWrite(s);
  const [bl] = await db.select().from(schema.accBankLines).where(and(eq(schema.accBankLines.orgId, s.orgId), eq(schema.accBankLines.id, bankLineId)));
  if (!bl) throw notFound("Statement line");
  if (bl.status === "matched") throw new ApiError("conflict", "Unmatch it first");
  await db.update(schema.accBankLines).set({ status: ignore ? "ignored" : "unmatched" }).where(eq(schema.accBankLines.id, bl.id));
}

/** A statement line with no entry in the books: post one against the account you pick, already matched. */
export async function createFromLine(s: Scope, bankLineId: string, raw: unknown) {
  requireWrite(s);
  const b = check(z.object({ accountId: z.uuid(), narration: z.string().trim().max(300).default("") }), raw);
  const [bl] = await db.select().from(schema.accBankLines).where(and(eq(schema.accBankLines.orgId, s.orgId), eq(schema.accBankLines.id, bankLineId)));
  if (!bl) throw notFound("Statement line");
  if (bl.status !== "unmatched") throw new ApiError("conflict", "This line is already dealt with");
  if (b.accountId === bl.accountId) throw new ApiError("validation_failed", "Pick the other side of the entry, not the bank account itself");
  assertOpen(s, String(bl.date), "This statement line");
  const amt = Math.abs(bl.amount);
  const into = bl.amount > 0;
  const j = await db.transaction(async (tx) => {
    const jr = await postJournal(tx, s, {
      date: String(bl.date),
      narration: b.narration || bl.description,
      sourceType: "bank",
      sourceRef: bl.reference,
      lines: [
        { accountId: bl.accountId, debit: into ? amt : 0, credit: into ? 0 : amt, description: bl.description },
        { accountId: b.accountId, debit: into ? 0 : amt, credit: into ? amt : 0, description: bl.description },
      ],
    });
    const [line] = await tx.select({ id: schema.accLines.id }).from(schema.accLines).where(and(eq(schema.accLines.journalId, jr.id), eq(schema.accLines.accountId, bl.accountId)));
    await tx.update(schema.accLines).set({ reconciledAt: new Date() }).where(eq(schema.accLines.id, line.id));
    await tx.update(schema.accBankLines).set({ status: "matched", lineId: line.id }).where(eq(schema.accBankLines.id, bl.id));
    return jr;
  });
  return j;
}
