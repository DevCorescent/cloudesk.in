// Fixed assets, repeating and spread journals, budgets, and the reports that
// come from them (cash flow, budget against actual, cash forecast).
//
// The register doesn't post an asset's purchase — that's the bill or journal
// it was bought on — only its depreciation, month by month, and its disposal.
// Depreciation, repeating journals and spreads are posted by the same sync as
// everything else, so they're never doubled and follow edits.
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addMonths, assetSchema, budgetSchema, cashFlow, depreciation, disposal, disposeSchema, lastDay, monthOf, occurrences, scheduleSchema, spread } from "@/lib/accounting/finance";
import { natural, type PostLine } from "@/lib/accounting/model";
import { fiscalYear } from "@/lib/org/model";
import { ApiError, notFound } from "../http/errors";
import { ensureDefaultCompany, getBranch, getCompany, getUnit } from "../org/org";
import { audit } from "../services/audit";
import { check, requireManage, requireWrite, todayIst, type Scope } from "./access";
import { accounts, balances, dimOf, type Dim } from "./ledger";
import { assertPeriodOpen } from "./periods";
import { sync } from "./sync";
import { owed } from "./bills";

const thisMonth = () => todayIst().slice(0, 7);

async function account(orgId: string, id: string, what: string, types?: string[]) {
  const [a] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), eq(schema.accAccounts.id, id)));
  if (!a) throw new ApiError("validation_failed", `Pick ${what} from your chart of accounts`);
  if (types && !types.includes(a.subtype) && !types.includes(a.type)) throw new ApiError("validation_failed", `That isn't ${what}`);
  return a;
}

// ── Fixed assets ────────────────────────────────────────────────────────────

async function nextAssetCode(orgId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.accAssets).where(eq(schema.accAssets.orgId, orgId));
  for (let i = n + 1; ; i++) {
    const code = `FA-${String(i).padStart(4, "0")}`;
    const [clash] = await db.select({ id: schema.accAssets.id }).from(schema.accAssets).where(and(eq(schema.accAssets.orgId, orgId), eq(schema.accAssets.code, code)));
    if (!clash) return code;
  }
}

export async function assets(s: Scope) {
  const rows = await db.select().from(schema.accAssets).where(eq(schema.accAssets.orgId, s.orgId)).orderBy(asc(schema.accAssets.code));
  const upTo = thisMonth();
  return rows
    .filter((a) => !s.access?.companies?.length || !a.companyId || s.access.companies.includes(a.companyId))
    .map((a) => {
      const sch = depreciation({ ...a, disposedOn: a.disposedOn ? String(a.disposedOn) : null, inUseDate: String(a.inUseDate) }, upTo);
      const accumulated = sch.filter((r) => r.month < upTo || (a.disposedOn && r.month === monthOf(String(a.disposedOn)))).at(-1)?.accumulated ?? 0;
      return { ...a, accumulated, bookValue: a.status === "disposed" ? 0 : a.cost - accumulated };
    });
}

export async function assetDetail(s: Scope, id: string) {
  const a = await getAsset(s, id);
  const end = addMonths(monthOf(String(a.inUseDate)), a.lifeMonths + 1);
  const schedule = depreciation({ ...a, inUseDate: String(a.inUseDate), disposedOn: a.disposedOn ? String(a.disposedOn) : null }, end > thisMonth() ? end : thisMonth());
  const posted = await db.select({ sourceId: schema.accJournals.sourceId }).from(schema.accJournals).where(and(eq(schema.accJournals.orgId, s.orgId), eq(schema.accJournals.sourceType, "depreciation"), sql`${schema.accJournals.sourceId} like ${a.id + ":%"}`));
  const done = new Set(posted.map((p) => p.sourceId!.split(":")[1]));
  const dispMonth = a.disposedOn ? monthOf(String(a.disposedOn)) : null;
  const accumulated = schedule.filter((r) => r.month < thisMonth() || r.month === dispMonth).at(-1)?.accumulated ?? 0;
  return { asset: { ...a, accumulated, bookValue: a.status === "disposed" ? 0 : a.cost - accumulated }, schedule: schedule.map((r) => ({ ...r, posted: done.has(r.month) })) };
}

async function getAsset(s: Scope, id: string) {
  const [a] = await db.select().from(schema.accAssets).where(and(eq(schema.accAssets.orgId, s.orgId), eq(schema.accAssets.id, id)));
  if (!a) throw notFound("Asset");
  return a;
}

export async function saveAsset(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(assetSchema, raw);
  await account(s.orgId, v.assetAccountId, "a fixed-asset account", ["fixed"]);
  if (v.inUseDate < v.purchaseDate) throw new ApiError("validation_failed", "It can't be in use before it was bought", { inUseDate: ["Before the purchase date"] });
  if (v.residual >= v.cost) throw new ApiError("validation_failed", "The residual value must be less than the cost", { residual: ["Too high"] });
  if (v.method === "wdv" && !v.rate) throw new ApiError("validation_failed", "Give the yearly rate for written-down value", { rate: ["Enter a rate"] });
  if (v.branchId) v.companyId = (await getBranch(s.orgId, v.branchId)).companyId;
  v.companyId = v.companyId ? (await getCompany(s.orgId, v.companyId)).id : (await ensureDefaultCompany(s.orgId)).id;
  if (v.costCentreId) await getUnit(s.orgId, v.costCentreId);
  if (id) {
    const cur = await getAsset(s, id);
    if (cur.status === "disposed") throw new ApiError("conflict", "This asset has been disposed of; undo that first to change it");
    const [r] = await db.update(schema.accAssets).set({ ...v, code: v.code || cur.code }).where(eq(schema.accAssets.id, id)).returning();
    await sync(s);
    return r;
  }
  const code = v.code || (await nextAssetCode(s.orgId));
  const [clash] = await db.select({ id: schema.accAssets.id }).from(schema.accAssets).where(and(eq(schema.accAssets.orgId, s.orgId), eq(schema.accAssets.code, code)));
  if (clash) throw new ApiError("conflict", `${code} is already used`, { code: ["Already used"] });
  const [r] = await db.insert(schema.accAssets).values({ ...v, code, orgId: s.orgId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.asset_added", targetType: "acc_asset", targetId: r.id, metadata: { code, cost: v.cost } });
  await sync(s);
  return r;
}

export async function disposeAsset(s: Scope, id: string, raw: unknown) {
  requireManage(s);
  const a = await getAsset(s, id);
  if (a.status === "disposed") throw new ApiError("conflict", "Already disposed of");
  const v = check(disposeSchema, raw);
  if (v.date < String(a.inUseDate)) throw new ApiError("validation_failed", "That's before it went into use");
  if (v.amount && !v.accountId) throw new ApiError("validation_failed", "Pick the account the money went into", { accountId: ["Pick an account"] });
  if (v.accountId) await account(s.orgId, v.accountId, "a bank or cash account", ["bank", "cash"]);
  await assertPeriodOpen(s.orgId, a.companyId, v.date, "This disposal");
  await db.update(schema.accAssets).set({ status: "disposed", disposedOn: v.date, disposalAmount: v.amount, disposalAccountId: v.accountId }).where(eq(schema.accAssets.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.asset_disposed", targetType: "acc_asset", targetId: id, metadata: { date: v.date, amount: v.amount } });
  await sync(s);
  const d = disposal({ ...a, inUseDate: String(a.inUseDate), disposedOn: v.date }, v.amount);
  return { ...d, asset: await getAsset(s, id) };
}

export async function undoDisposal(s: Scope, id: string) {
  requireManage(s);
  const a = await getAsset(s, id);
  if (a.status !== "disposed") throw new ApiError("conflict", "It hasn't been disposed of");
  await assertPeriodOpen(s.orgId, a.companyId, String(a.disposedOn), "This disposal");
  await db.update(schema.accAssets).set({ status: "active", disposedOn: null, disposalAmount: null, disposalAccountId: null }).where(eq(schema.accAssets.id, id));
  await sync(s);
}

export async function deleteAsset(s: Scope, id: string) {
  requireManage(s);
  const a = await getAsset(s, id);
  const [locked] = await db.select({ id: schema.accJournals.id }).from(schema.accJournals).where(and(eq(schema.accJournals.orgId, s.orgId), inArray(schema.accJournals.sourceType, ["depreciation", "asset_disposal"]), sql`${schema.accJournals.sourceId} like ${a.id + "%"}`, s.settings.lockDate ? lte(schema.accJournals.date, s.settings.lockDate) : sql`false`)).limit(1);
  if (locked) throw new ApiError("conflict", "Depreciation on this asset is in a locked period — dispose of it instead");
  await db.delete(schema.accAssets).where(eq(schema.accAssets.id, id));
  await sync(s);
}

/** What the sync should post for assets: each completed month's depreciation, and disposals. */
export async function assetWants(orgId: string, defaultCompany: string) {
  const rows = await db.select().from(schema.accAssets).where(eq(schema.accAssets.orgId, orgId));
  const upTo = thisMonth();
  const out: { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: PostLine[]; companyId: string; branchId: string | null }[] = [];
  for (const a of rows) {
    const asset = { ...a, inUseDate: String(a.inUseDate), disposedOn: a.disposedOn ? String(a.disposedOn) : null };
    const dispMonth = asset.disposedOn ? monthOf(asset.disposedOn) : null;
    for (const r of depreciation(asset, upTo)) {
      // Completed months only, and the month it was disposed of.
      if (!(r.month < upTo || r.month === dispMonth)) continue;
      out.push({ sourceType: "depreciation", sourceId: `${a.id}:${r.month}`, date: r.month === dispMonth ? asset.disposedOn! : lastDay(r.month), narration: `Depreciation · ${a.code} ${a.name}`, sourceRef: a.code, party: "", lines: [{ key: "depreciation", debit: r.amount, credit: 0, costCentreId: a.costCentreId }, { key: "acc_dep", debit: 0, credit: r.amount }], companyId: a.companyId ?? defaultCompany, branchId: a.branchId });
    }
    if (a.status === "disposed" && asset.disposedOn) {
      const d = disposal({ ...asset, disposedOn: asset.disposedOn }, Number(a.disposalAmount ?? 0));
      const lines: PostLine[] = [{ key: "acc_dep", debit: d.accumulated, credit: 0 }, { accountId: a.assetAccountId, debit: 0, credit: a.cost }];
      if (a.disposalAmount && a.disposalAccountId) lines.push({ accountId: a.disposalAccountId, debit: Number(a.disposalAmount), credit: 0 });
      if (d.gain > 0) lines.push({ key: "asset_gain", debit: 0, credit: d.gain });
      if (d.gain < 0) lines.push({ key: "asset_gain", debit: -d.gain, credit: 0 });
      out.push({ sourceType: "asset_disposal", sourceId: a.id, date: asset.disposedOn, narration: `Disposed of ${a.code} ${a.name}`, sourceRef: a.code, party: "", lines, companyId: a.companyId ?? defaultCompany, branchId: a.branchId });
    }
  }
  return out;
}

// ── Repeating and spread journals ───────────────────────────────────────────

export async function schedules(s: Scope) {
  return db.select().from(schema.accSchedules).where(eq(schema.accSchedules.orgId, s.orgId)).orderBy(desc(schema.accSchedules.active), asc(schema.accSchedules.name));
}

export async function saveSchedule(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(scheduleSchema, raw);
  const companyId = v.companyId ? (await getCompany(s.orgId, v.companyId)).id : (await ensureDefaultCompany(s.orgId)).id;
  let values: Partial<typeof schema.accSchedules.$inferInsert>;
  if (v.kind === "recurring") {
    const dr = v.lines.reduce((n, l) => n + l.debit, 0);
    const cr = v.lines.reduce((n, l) => n + l.credit, 0);
    if (dr !== cr || !dr || v.lines.some((l) => l.debit && l.credit)) throw new ApiError("validation_failed", "Debits and credits must be equal, and each line one or the other");
    for (const l of v.lines) await account(s.orgId, l.accountId, "an account");
    if (v.endDate && v.endDate < v.startDate) throw new ApiError("validation_failed", "It ends before it starts", { endDate: ["Before the start"] });
    values = { kind: "recurring", name: v.name, lines: v.lines, every: v.every, startDate: v.startDate, endDate: v.endDate, autoReverse: v.autoReverse, companyId, active: v.active };
  } else {
    await account(s.orgId, v.fromAccountId, "the account it was paid into (prepaid)");
    await account(s.orgId, v.toAccountId, "the account it's spread to");
    if (v.costCentreId) await getUnit(s.orgId, v.costCentreId);
    values = { kind: "spread", name: v.name, total: v.total, months: v.months, startDate: v.startDate, fromAccountId: v.fromAccountId, toAccountId: v.toAccountId, costCentreId: v.costCentreId, companyId, active: v.active };
  }
  if (id) {
    const [r] = await db.update(schema.accSchedules).set(values).where(and(eq(schema.accSchedules.id, id), eq(schema.accSchedules.orgId, s.orgId))).returning();
    if (!r) throw notFound("Schedule");
    await sync(s);
    return r;
  }
  const [r] = await db.insert(schema.accSchedules).values({ ...(values as typeof schema.accSchedules.$inferInsert), orgId: s.orgId, createdBy: s.userId }).returning();
  await sync(s);
  return r;
}

/** Stop a schedule from today: what's posted stays; nothing new is posted. */
export async function stopSchedule(s: Scope, id: string) {
  requireWrite(s);
  const [r] = await db.update(schema.accSchedules).set({ active: false, endDate: todayIst() }).where(and(eq(schema.accSchedules.id, id), eq(schema.accSchedules.orgId, s.orgId))).returning();
  if (!r) throw notFound("Schedule");
  await sync(s);
  return r;
}

export async function deleteSchedule(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.accSchedules).where(and(eq(schema.accSchedules.id, id), eq(schema.accSchedules.orgId, s.orgId)));
  await sync(s);
}

export async function scheduleWants(orgId: string, defaultCompany: string) {
  const rows = await db.select().from(schema.accSchedules).where(eq(schema.accSchedules.orgId, orgId));
  const today = todayIst();
  const out: { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: PostLine[]; companyId: string }[] = [];
  for (const sc of rows) {
    const companyId = sc.companyId ?? defaultCompany;
    const upTo = sc.endDate && String(sc.endDate) < today ? String(sc.endDate) : today;
    if (sc.kind === "recurring") {
      const step = sc.every === "quarter" ? 3 : sc.every === "year" ? 12 : 1;
      for (const d of occurrences({ startDate: String(sc.startDate), endDate: sc.endDate ? String(sc.endDate) : null, every: sc.every as "month" }, upTo)) {
        const lines = sc.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description ?? "", costCentreId: l.costCentreId ?? null }));
        out.push({ sourceType: "recurring", sourceId: `${sc.id}:${d}`, date: d, narration: sc.name, sourceRef: sc.name, party: "", lines, companyId });
        if (sc.autoReverse) {
          const back = `${addMonths(monthOf(d), step)}-01`;
          if (back <= today) out.push({ sourceType: "recurring_reversal", sourceId: `${sc.id}:${d}`, date: back, narration: `Reversal: ${sc.name}`, sourceRef: sc.name, party: "", lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })), companyId });
        }
      }
    } else {
      for (const p of spread(Number(sc.total), sc.months, String(sc.startDate))) {
        if (p.date > upTo) continue;
        out.push({ sourceType: "spread", sourceId: `${sc.id}:${p.month}`, date: p.date, narration: sc.name, sourceRef: sc.name, party: "", lines: [{ accountId: sc.toAccountId!, debit: p.amount, credit: 0, costCentreId: sc.costCentreId }, { accountId: sc.fromAccountId!, debit: 0, credit: p.amount }], companyId });
      }
    }
  }
  return out;
}

// ── Budgets ─────────────────────────────────────────────────────────────────

export async function budgets(s: Scope) {
  return db.select().from(schema.accBudgets).where(eq(schema.accBudgets.orgId, s.orgId)).orderBy(desc(schema.accBudgets.year), asc(schema.accBudgets.name));
}

export async function saveBudget(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(budgetSchema, raw);
  if (v.companyId) await getCompany(s.orgId, v.companyId);
  if (v.costCentreId) await getUnit(s.orgId, v.costCentreId);
  const ids = Object.keys(v.amounts);
  if (ids.length) {
    const own = await db.select({ id: schema.accAccounts.id }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), inArray(schema.accAccounts.id, ids)));
    if (own.length !== ids.length) throw new ApiError("validation_failed", "Use accounts from this workspace");
  }
  const year = fiscalYear(`${v.year.slice(0, 4)}-${String(s.settings.fyStartMonth).padStart(2, "0")}-01`, s.settings.fyStartMonth).label;
  const values = { ...v, year, updatedAt: new Date() };
  if (id) {
    const [r] = await db.update(schema.accBudgets).set(values).where(and(eq(schema.accBudgets.id, id), eq(schema.accBudgets.orgId, s.orgId))).returning();
    if (!r) throw notFound("Budget");
    return r;
  }
  const [r] = await db.insert(schema.accBudgets).values({ ...values, orgId: s.orgId }).returning();
  return r;
}

export async function deleteBudget(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.accBudgets).where(and(eq(schema.accBudgets.id, id), eq(schema.accBudgets.orgId, s.orgId)));
}

/** Budget against actual, by account and month, for the budget's company and cost centre. */
export async function budgetVsActual(s: Scope, id: string) {
  const [b] = await db.select().from(schema.accBudgets).where(and(eq(schema.accBudgets.id, id), eq(schema.accBudgets.orgId, s.orgId)));
  if (!b) throw notFound("Budget");
  const fy = fiscalYear(`${b.year.slice(0, 4)}-${String(s.settings.fyStartMonth).padStart(2, "0")}-01`, s.settings.fyStartMonth);
  const dim: Dim = { ...dimOf(s, { companyId: b.companyId ?? undefined }), costCentreId: b.costCentreId };
  const accs = await accounts(s.orgId);
  const monthly = await Promise.all(fy.months.map((m) => balances(s.orgId, { from: `${m}-01`, to: lastDay(m), dim })));
  const ids = new Set([...Object.keys(b.amounts), ...accs.filter((a) => a.type === "income" || a.type === "expense").map((a) => a.id).filter((aid) => monthly.some((mb) => mb.has(aid)))]);
  const today = todayIst();
  const rows = accs
    .filter((a) => ids.has(a.id))
    .map((a) => {
      const months = fy.months.map((m, i) => {
        const bal = monthly[i].get(a.id);
        const actual = bal ? natural(a.type, bal.debit, bal.credit) : 0;
        const budget = b.amounts[a.id]?.[m] ?? 0;
        return { month: m, budget, actual, past: lastDay(m) <= today };
      });
      const ytd = months.filter((x) => x.past || x.month === today.slice(0, 7));
      const budget = ytd.reduce((n, x) => n + x.budget, 0);
      const actual = ytd.reduce((n, x) => n + x.actual, 0);
      // Over budget means more cost, or less income, than planned.
      const variance = a.type === "income" ? actual - budget : budget - actual;
      return { id: a.id, code: a.code, name: a.name, type: a.type, months, ytdBudget: budget, ytdActual: actual, variance, yearBudget: months.reduce((n, x) => n + x.budget, 0) };
    });
  return { budget: b, months: fy.months, rows };
}

// ── Reports ─────────────────────────────────────────────────────────────────

/** Signed (debit-positive) balances per account up to a date. */
async function signed(orgId: string, to: string, dim?: Dim) {
  const b = await balances(orgId, { to, dim });
  return new Map([...b.entries()].map(([k, v]) => [k, v.debit - v.credit]));
}

export async function cashFlowReport(s: Scope, from: string, to: string, dim?: Dim) {
  const accs = await accounts(s.orgId);
  const before = new Date(Date.parse(`${from}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const [opening, closing] = await Promise.all([signed(s.orgId, before, dim), signed(s.orgId, to, dim)]);
  return { from, to, ...cashFlow(accs, opening, closing) };
}

/**
 * The next weeks' cash: bank and cash today, plus what customers owe by when
 * it's due (overdue counted in the first week), less bills due and the next
 * payroll (last month's net pay, at month end), and repeating journals that
 * touch bank or cash. An estimate from what's recorded — not a promise.
 */
export async function forecast(s: Scope, weeks = 13) {
  const today = todayIst();
  const accs = await accounts(s.orgId);
  const cashIds = new Set(accs.filter((a) => a.subtype === "cash" || a.subtype === "bank").map((a) => a.id));
  const bal = await signed(s.orgId, today);
  const opening = [...cashIds].reduce((n, id) => n + (bal.get(id) ?? 0), 0);
  const start = new Date(`${today}T00:00:00Z`);
  const weekOf = (d: string) => Math.max(0, Math.floor((Date.parse(`${d}T00:00:00Z`) - start.getTime()) / (7 * 86400_000)));
  const buckets = Array.from({ length: weeks }, (_, i) => ({ week: new Date(start.getTime() + i * 7 * 86400_000).toISOString().slice(0, 10), inflow: 0, outflow: 0, items: [] as string[] }));
  const add = (d: string | null, amount: number, label: string) => {
    const w = weekOf(d ?? today);
    if (w >= weeks || !amount) return;
    if (amount > 0) buckets[w].inflow += amount;
    else buckets[w].outflow -= amount;
    if (buckets[w].items.length < 6) buckets[w].items.push(label);
  };
  const inv = (await db.execute(sql`
    select d.number, coalesce(d.due_date, d.issue_date)::text as due, d.total - d.amount_paid as owed, coalesce(d.client->>'company', d.client->>'name', '') as party
    from invoice_documents d join invoice_owners o on o.id = d.project_id left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
    where coalesce(p.org_id, b.org_id) = ${s.orgId} and d.type = 'invoice' and d.status in ('sent','viewed','partial') and d.currency = 'INR' and d.total > d.amount_paid`)) as unknown as { rows: { number: string; due: string; owed: number; party: string }[] };
  for (const r of inv.rows) add(r.due, Number(r.owed), `${r.number} from ${r.party}`);
  const bills = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), inArray(schema.accBills.status, ["open", "partial"])));
  for (const b of bills) add(b.dueDate ? String(b.dueDate) : String(b.date), -owed(b), `${b.number} to ${b.supplierName}`);
  const [lastRun] = await db.select().from(schema.hrPayrollRuns).where(and(eq(schema.hrPayrollRuns.orgId, s.orgId), inArray(schema.hrPayrollRuns.status, ["finalised", "paid"]))).orderBy(desc(schema.hrPayrollRuns.month)).limit(1);
  if (lastRun) {
    const net = Number((lastRun.totals as { net?: number }).net ?? 0);
    for (let i = 0; i < 4; i++) {
      const m = addMonths(today.slice(0, 7), i);
      if (m > lastRun.month) add(lastDay(m), -net, `Payroll ${m} (estimate)`);
    }
  }
  const sch = await db.select().from(schema.accSchedules).where(and(eq(schema.accSchedules.orgId, s.orgId), eq(schema.accSchedules.active, true), eq(schema.accSchedules.kind, "recurring")));
  const horizon = new Date(start.getTime() + weeks * 7 * 86400_000).toISOString().slice(0, 10);
  for (const sc of sch) {
    const cash = sc.lines.filter((l) => cashIds.has(l.accountId)).reduce((n, l) => n + l.debit - l.credit, 0);
    if (!cash) continue;
    for (const d of occurrences({ startDate: String(sc.startDate), endDate: sc.endDate ? String(sc.endDate) : null, every: sc.every as "month" }, horizon)) if (d > today) add(d, cash, sc.name);
  }
  let running = opening;
  return { opening, weeks: buckets.map((b) => ((running += b.inflow - b.outflow), { ...b, closing: running })) };
}
