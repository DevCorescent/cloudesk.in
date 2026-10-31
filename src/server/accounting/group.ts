// A group of companies in one workspace: intercompany entries (posted in both
// companies, each side tagged with the other), the intercompany position
// between every pair, and consolidated statements that add the companies up
// and eliminate what they owe and charge each other.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { natural, type PostLine } from "@/lib/accounting/model";
import { ApiError, notFound } from "../http/errors";
import { getCompany } from "../org/org";
import { audit } from "../services/audit";
import { check, nextNumber, requireManage, requireWrite, type Scope } from "./access";
import { assertPeriodOpen } from "./periods";
import { sync } from "./sync";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const icSchema = z.object({
  date: day,
  fromCompanyId: z.uuid(),
  toCompanyId: z.uuid(),
  amount: z.number().int().min(1, "Enter an amount").max(1e13),
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  narration: z.string().trim().max(300).default(""),
});

/** The companies a member may work with (all, unless their access names some). */
function allowedCompany(s: Scope, id: string) {
  if (s.access?.companies?.length && !s.access.companies.includes(id)) throw new ApiError("forbidden", "You can't post to that company");
}

export async function intercompany(s: Scope) {
  const rows = await db.select().from(schema.accIntercompany).where(eq(schema.accIntercompany.orgId, s.orgId)).orderBy(desc(schema.accIntercompany.date), desc(schema.accIntercompany.createdAt)).limit(300);
  const allowed = s.access?.companies?.length ? s.access.companies : null;
  return allowed ? rows.filter((r) => allowed.includes(r.fromCompanyId) || allowed.includes(r.toCompanyId)) : rows;
}

export async function addIntercompany(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(icSchema, raw);
  if (v.fromCompanyId === v.toCompanyId) throw new ApiError("validation_failed", "Pick two different companies", { toCompanyId: ["Same company"] });
  await getCompany(s.orgId, v.fromCompanyId);
  await getCompany(s.orgId, v.toCompanyId);
  allowedCompany(s, v.fromCompanyId);
  allowedCompany(s, v.toCompanyId);
  const accs = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), sql`${schema.accAccounts.id} in (${v.fromAccountId}, ${v.toAccountId})`));
  if (accs.length !== new Set([v.fromAccountId, v.toAccountId]).size) throw new ApiError("validation_failed", "Use accounts from this workspace");
  if (accs.some((a) => a.systemKey === "ic_receivable" || a.systemKey === "ic_payable")) throw new ApiError("validation_failed", "Pick the other side of the entry — the group accounts are added by themselves");
  await assertPeriodOpen(s.orgId, v.fromCompanyId, v.date, "This entry");
  await assertPeriodOpen(s.orgId, v.toCompanyId, v.date, "This entry");
  const number = await nextNumber(s.orgId, "intercompany", "IC-");
  const [r] = await db.insert(schema.accIntercompany).values({ ...v, number, orgId: s.orgId, createdBy: s.userId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.intercompany_created", targetType: "acc_intercompany", targetId: r.id, metadata: { number, amount: v.amount } });
  await sync(s);
  return r;
}

export async function deleteIntercompany(s: Scope, id: string) {
  requireManage(s);
  const [r] = await db.select().from(schema.accIntercompany).where(and(eq(schema.accIntercompany.id, id), eq(schema.accIntercompany.orgId, s.orgId)));
  if (!r) throw notFound("Intercompany entry");
  await assertPeriodOpen(s.orgId, r.fromCompanyId, String(r.date), "This entry");
  await assertPeriodOpen(s.orgId, r.toCompanyId, String(r.date), "This entry");
  await db.delete(schema.accIntercompany).where(eq(schema.accIntercompany.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.intercompany_deleted", targetType: "acc_intercompany", targetId: id, metadata: { number: r.number } });
  await sync(s);
}

/** For the sync: each entry is two journals, one per company, tagged with the other. */
export async function intercompanyWants(orgId: string) {
  const rows = await db.select().from(schema.accIntercompany).where(eq(schema.accIntercompany.orgId, orgId));
  if (!rows.length) return [];
  const names = new Map((await db.select({ id: schema.orgCompanies.id, name: schema.orgCompanies.name }).from(schema.orgCompanies).where(eq(schema.orgCompanies.orgId, orgId))).map((c) => [c.id, c.name]));
  const types = new Map((await db.select({ id: schema.accAccounts.id, type: schema.accAccounts.type }).from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).map((a) => [a.id, a.type]));
  return rows.flatMap((r) => {
    // A recharge (income in one, a cost in the other) is internal too, so both sides are tagged and eliminated;
    // money paid out or received is real and isn't.
    const recharge = types.get(r.fromAccountId) === "income";
    const from: PostLine[] = [{ key: "ic_receivable", debit: r.amount, credit: 0, partnerCompanyId: r.toCompanyId }, { accountId: r.fromAccountId, debit: 0, credit: r.amount, partnerCompanyId: recharge ? r.toCompanyId : null }];
    const to: PostLine[] = [{ accountId: r.toAccountId, debit: r.amount, credit: 0, partnerCompanyId: recharge ? r.fromCompanyId : null }, { key: "ic_payable", debit: 0, credit: r.amount, partnerCompanyId: r.fromCompanyId }];
    const base = { sourceType: "intercompany", date: String(r.date), sourceRef: r.number };
    return [
      { ...base, sourceId: `${r.id}:from`, narration: `${r.narration || "Intercompany"} · to ${names.get(r.toCompanyId) ?? "group company"}`, party: names.get(r.toCompanyId) ?? "", lines: from, companyId: r.fromCompanyId },
      { ...base, sourceId: `${r.id}:to`, narration: `${r.narration || "Intercompany"} · from ${names.get(r.fromCompanyId) ?? "group company"}`, party: names.get(r.fromCompanyId) ?? "", lines: to, companyId: r.toCompanyId },
    ];
  });
}

type Row = { company_id: string; account_id: string; partner: string | null; debit: number; credit: number };

/**
 * Consolidated trial balance for a set of companies: balance sheet accounts up
 * to `to`, income and expenses from `from` to `to`. Lines tagged with a partner
 * inside the set are eliminated. Pairs show each company's net position with
 * the other, which should mirror.
 */
export async function consolidation(s: Scope, q: { from?: string; to?: string; companies?: string }) {
  const all = await db.select().from(schema.orgCompanies).where(and(eq(schema.orgCompanies.orgId, s.orgId), eq(schema.orgCompanies.active, true)));
  const asked = q.companies ? q.companies.split(",").filter((x) => all.some((c) => c.id === x)) : all.map((c) => c.id);
  const allowed = s.access?.companies?.length ? s.access.companies : null;
  if (allowed && asked.some((c) => !allowed.includes(c))) throw new ApiError("forbidden", "You can't see some of those companies' books");
  const set = asked.length ? asked : all.map((c) => c.id);
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : new Date().toISOString().slice(0, 10);
  const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : `${Number(to.slice(5, 7)) >= s.settings.fyStartMonth ? to.slice(0, 4) : Number(to.slice(0, 4)) - 1}-${String(s.settings.fyStartMonth).padStart(2, "0")}-01`;
  const accounts = await db.select().from(schema.accAccounts).where(eq(schema.accAccounts.orgId, s.orgId));
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const ids = sql.join(set.map((c) => sql`${c}`), sql`, `);
  const res = (await db.execute(sql`
    select j.company_id, l.account_id, l.partner_company_id as partner, sum(l.debit)::bigint as debit, sum(l.credit)::bigint as credit
    from acc_lines l join acc_journals j on j.id = l.journal_id join acc_accounts a on a.id = l.account_id
    where l.org_id = ${s.orgId} and j.company_id in (${ids}) and j.date <= ${to}
      and (a.type in ('asset','liability','equity') or j.date >= ${from})
    group by 1, 2, 3`)) as unknown as { rows: Row[] };
  const rows = new Map<string, { by: Record<string, number>; elim: number }>();
  const pairs = new Map<string, number>();
  for (const x of res.rows) {
    const t = type.get(x.account_id) ?? "asset";
    const n = natural(t, Number(x.debit), Number(x.credit));
    const row = rows.get(x.account_id) ?? { by: {}, elim: 0 };
    row.by[x.company_id] = (row.by[x.company_id] ?? 0) + n;
    if (x.partner && set.includes(x.partner)) {
      row.elim -= n;
      // What the partner owes this company (positive) or is owed (negative), from the balance sheet lines.
      if (!["income", "expense"].includes(t)) {
        const k = `${x.company_id}|${x.partner}`;
        pairs.set(k, (pairs.get(k) ?? 0) + Number(x.debit) - Number(x.credit));
      }
    }
    rows.set(x.account_id, row);
  }
  const order = { asset: 0, liability: 1, equity: 2, income: 3, expense: 4 } as Record<string, number>;
  const lines = accounts
    .filter((a) => rows.has(a.id))
    .map((a) => {
      const r = rows.get(a.id)!;
      const sum = Object.values(r.by).reduce((x, y) => x + y, 0);
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, by: r.by, eliminated: r.elim, consolidated: sum + r.elim };
    })
    .filter((l) => l.consolidated || Object.values(l.by).some(Boolean))
    .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.code.localeCompare(b.code));
  const total = (t: string, f: (l: (typeof lines)[number]) => number) => lines.filter((l) => l.type === t).reduce((a, l) => a + f(l), 0);
  const profit = (f: (l: (typeof lines)[number]) => number) => total("income", f) - total("expense", f);
  const companies = all.filter((c) => set.includes(c.id)).map((c) => ({ id: c.id, name: c.name }));
  const seen = new Set<string>();
  const pairList = [];
  for (const a of set)
    for (const b of set) {
      if (a === b || seen.has(`${b}|${a}`)) continue;
      seen.add(`${a}|${b}`);
      const ab = pairs.get(`${a}|${b}`) ?? 0;
      const ba = pairs.get(`${b}|${a}`) ?? 0;
      if (ab || ba) pairList.push({ a, b, aSays: ab, bSays: ba, difference: ab + ba });
    }
  return {
    from,
    to,
    companies,
    lines,
    profit: { ...Object.fromEntries(companies.map((c) => [c.id, profit((l) => l.by[c.id] ?? 0)])), eliminated: profit((l) => l.eliminated), consolidated: profit((l) => l.consolidated) },
    pairs: pairList,
    balanced: pairList.every((p) => p.difference === 0),
  };
}
