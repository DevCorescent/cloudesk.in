// Reports from the ledger: trial balance, profit and loss, balance sheet,
// receivables and payables by age, and the accounting home.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { financialYear, natural } from "@/lib/accounting/model";
import { todayIst, type Scope } from "./access";
import { accounts, balances, prevDay, type Dim } from "./ledger";
import { owed } from "./bills";

type Acc = Awaited<ReturnType<typeof accounts>>[number];
const row = (a: Acc, b: { debit: number; credit: number } | undefined) => ({ id: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, debit: b?.debit ?? 0, credit: b?.credit ?? 0, balance: natural(a.type, b?.debit ?? 0, b?.credit ?? 0) });

export async function trialBalance(s: Scope, asOf = todayIst(), dim?: Dim) {
  const [accs, bal] = await Promise.all([accounts(s.orgId), balances(s.orgId, { to: asOf, dim })]);
  const rows = accs.map((a) => row(a, bal.get(a.id))).filter((r) => r.debit || r.credit);
  // Each account shows on the side its balance falls.
  const lines = rows.map((r) => ({ ...r, dr: Math.max(0, r.debit - r.credit), cr: Math.max(0, r.credit - r.debit) }));
  return { asOf, lines, totalDr: lines.reduce((a, l) => a + l.dr, 0), totalCr: lines.reduce((a, l) => a + l.cr, 0) };
}

export async function profitAndLoss(s: Scope, from: string, to: string, dim?: Dim) {
  const [accs, bal] = await Promise.all([accounts(s.orgId), balances(s.orgId, { from, to, dim })]);
  const income = accs.filter((a) => a.type === "income").map((a) => row(a, bal.get(a.id))).filter((r) => r.balance);
  const expenses = accs.filter((a) => a.type === "expense").map((a) => row(a, bal.get(a.id))).filter((r) => r.balance);
  const totalIncome = income.reduce((a, r) => a + r.balance, 0);
  const cogs = expenses.filter((r) => ["5000", "5010"].includes(r.code) || r.name === "Cost of goods sold").reduce((a, r) => a + r.balance, 0);
  const totalExpenses = expenses.reduce((a, r) => a + r.balance, 0);
  return { from, to, income, expenses, totalIncome, grossProfit: totalIncome - cogs, totalExpenses, net: totalIncome - totalExpenses };
}

/** Assets = liabilities + equity, with this year's profit and earlier years' retained in equity. */
export async function balanceSheet(s: Scope, asOf = todayIst(), dim?: Dim) {
  const fy = financialYear(asOf, s.settings.fyStartMonth);
  const [accs, bal, before] = await Promise.all([accounts(s.orgId), balances(s.orgId, { to: asOf, dim }), balances(s.orgId, { to: prevDay(fy.from), dim })]);
  const of = (t: string) => accs.filter((a) => a.type === t).map((a) => row(a, bal.get(a.id))).filter((r) => r.balance);
  const assets = of("asset");
  const liabilities = of("liability");
  const equity = of("equity");
  const pl = (b: typeof bal) => accs.filter((a) => a.type === "income" || a.type === "expense").reduce((sum, a) => sum + (a.type === "income" ? 1 : -1) * natural(a.type, b.get(a.id)?.debit ?? 0, b.get(a.id)?.credit ?? 0), 0);
  const retained = pl(before);
  const thisYear = pl(bal) - retained;
  const totalAssets = assets.reduce((a, r) => a + r.balance, 0);
  const totalLiabilities = liabilities.reduce((a, r) => a + r.balance, 0);
  const totalEquity = equity.reduce((a, r) => a + r.balance, 0) + retained + thisYear;
  return { asOf, fy: fy.label, assets, liabilities, equity, retained, thisYear, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

const BUCKETS = ["Not due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;
const bucket = (due: string | null, today: string) => {
  if (!due || due >= today) return 0;
  const d = (Date.parse(today) - Date.parse(due)) / 86400_000;
  return d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
};

/** What customers owe (from invoices) and what you owe (from bills), by how late it is. */
export async function aging(s: Scope) {
  const today = todayIst();
  const inv = ((await db.execute(sql`
    select d.id, d.number, d.due_date::text as due, d.issue_date::text as date, d.total - d.amount_paid as due_amount, coalesce(d.client->>'company', d.client->>'name', '') as party
    from invoice_documents d join invoice_owners o on o.id = d.project_id
    left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
    where coalesce(p.org_id, b.org_id) = ${s.orgId} and d.type = 'invoice' and d.status in ('sent','viewed','partial') and d.currency = 'INR' and d.total > d.amount_paid`)) as unknown as { rows: { id: string; number: string; due: string | null; date: string; due_amount: number; party: string }[] }).rows;
  const bills = await db.select().from(schema.accBills).where(and(eq(schema.accBills.orgId, s.orgId), inArray(schema.accBills.status, ["open", "partial"])));
  const group = (items: { party: string; amount: number; due: string | null }[]) => {
    const m = new Map<string, number[]>();
    for (const i of items) {
      const b = m.get(i.party || "—") ?? [0, 0, 0, 0, 0];
      b[bucket(i.due, today)] += i.amount;
      m.set(i.party || "—", b);
    }
    const rows = [...m.entries()].map(([party, b]) => ({ party, buckets: b, total: b.reduce((x, y) => x + y, 0) })).sort((a, b) => b.total - a.total);
    const totals = [0, 1, 2, 3, 4].map((i) => rows.reduce((a, r) => a + r.buckets[i], 0));
    return { rows, totals, total: totals.reduce((a, b) => a + b, 0) };
  };
  return {
    buckets: BUCKETS,
    receivables: { ...group(inv.map((i) => ({ party: i.party, amount: Number(i.due_amount), due: i.due }))), documents: inv.map((i) => ({ id: i.id, number: i.number, party: i.party, date: i.date, due: i.due, amount: Number(i.due_amount), late: bucket(i.due, today) > 0 })) },
    payables: { ...group(bills.map((b) => ({ party: b.supplierName, amount: owed(b), due: b.dueDate ? String(b.dueDate) : null }))), documents: bills.map((b) => ({ id: b.id, number: b.number, party: b.supplierName, date: String(b.date), due: b.dueDate ? String(b.dueDate) : null, amount: owed(b), late: bucket(b.dueDate ? String(b.dueDate) : null, today) > 0 })) },
  };
}

export async function home(s: Scope) {
  const today = todayIst();
  const month = today.slice(0, 7);
  const fy = financialYear(today, s.settings.fyStartMonth);
  const [accs, bal, mtd, ytd, ag, settings] = await Promise.all([
    accounts(s.orgId),
    balances(s.orgId),
    profitAndLoss(s, `${month}-01`, today),
    profitAndLoss(s, fy.from, today),
    aging(s),
    db.select({ syncedAt: schema.accSettings.syncedAt, notes: schema.accSettings.syncNotes }).from(schema.accSettings).where(eq(schema.accSettings.orgId, s.orgId)),
  ]);
  const money = accs.filter((a) => a.subtype === "bank" || a.subtype === "cash" || a.systemKey === "clearing").map((a) => row(a, bal.get(a.id)));
  const keyBal = (k: string) => {
    const a = accs.find((x) => x.systemKey === k);
    return a ? natural(a.type, bal.get(a.id)?.debit ?? 0, bal.get(a.id)?.credit ?? 0) : 0;
  };
  // GST position: output tax collected less input credit, as of today.
  const output = keyBal("cgst_out") + keyBal("sgst_out") + keyBal("igst_out");
  const input = keyBal("cgst_in") + keyBal("sgst_in") + keyBal("igst_in");
  // Monthly income and expenses for the last six months.
  const trend = ((await db.execute(sql`
    select to_char(j.date, 'YYYY-MM') as month,
      sum(case when a.type = 'income' then l.credit - l.debit else 0 end)::bigint as income,
      sum(case when a.type = 'expense' then l.debit - l.credit else 0 end)::bigint as expenses
    from acc_lines l join acc_journals j on j.id = l.journal_id join acc_accounts a on a.id = l.account_id
    where l.org_id = ${s.orgId} and j.date >= (date_trunc('month', ${today}::date) - interval '5 months')
    group by 1 order by 1`)) as unknown as { rows: { month: string; income: number; expenses: number }[] }).rows.map((r) => ({ month: r.month, income: Number(r.income), expenses: Number(r.expenses) }));
  return {
    money,
    cashAndBank: money.reduce((a, m) => a + m.balance, 0),
    receivable: ag.receivables.total,
    receivableLate: ag.receivables.total - ag.receivables.totals[0],
    payable: ag.payables.total,
    payableLate: ag.payables.total - ag.payables.totals[0],
    month: { income: mtd.totalIncome, expenses: mtd.totalExpenses, net: mtd.net },
    year: { label: fy.label, income: ytd.totalIncome, expenses: ytd.totalExpenses, net: ytd.net },
    gst: { output, input, net: output - input },
    trend,
    syncedAt: settings[0]?.syncedAt ?? null,
    notes: settings[0]?.notes ?? [],
  };
}
