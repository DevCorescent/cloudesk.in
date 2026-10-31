// Things worth a second look in the books, found by fixed rules (no AI, so
// the same data always gives the same answers): a supplier bill entered
// twice, a bill far above what that supplier usually charges, and an expense
// account running well ahead of its recent months.
export type Finding = { kind: "duplicate_bill" | "large_bill" | "expense_spike"; title: string; detail: string; link: string; amount: number };
export type BillRow = { id: string; number: string; supplier: string; billNo: string; total: number; date: string };

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
// "SP/0042" and "sp-42" are the same bill number: case, punctuation and leading zeros don't count.
const normNo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|[A-Z])0+(?=\d)/g, "$1");
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The same supplier's bill entered twice: the same bill number, or the same total within 3 days. */
export function duplicateBills(bills: BillRow[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const sorted = [...bills].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (key(a.supplier) !== key(b.supplier) || !key(a.supplier)) continue;
      const sameNo = !!normNo(a.billNo) && normNo(a.billNo) === normNo(b.billNo);
      const sameAmount = a.total === b.total && a.total > 0 && days(a.date, b.date) <= 3;
      if (!sameNo && !sameAmount) continue;
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push({ kind: "duplicate_bill", title: `Possible duplicate bill from ${b.supplier}`, detail: sameNo ? `${b.number} has the same supplier bill number (${b.billNo}) as ${a.number}.` : `${b.number} is for the same amount (${inr(b.total)}) as ${a.number}, ${days(a.date, b.date)} day(s) apart.`, link: `/accounts/bills/${b.id}`, amount: b.total });
    }
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Recent bills (on or after `since`) more than `factor` times the supplier's usual, judged on at least `minHistory` earlier bills. */
export function largeBills(bills: BillRow[], since: string, factor = 3, minHistory = 4): Finding[] {
  const out: Finding[] = [];
  for (const b of bills) {
    if (b.date < since) continue;
    const before = bills.filter((x) => x.id !== b.id && key(x.supplier) === key(b.supplier) && x.date < b.date).map((x) => x.total);
    if (before.length < minHistory) continue;
    const usual = median(before);
    if (usual > 0 && b.total > factor * usual) out.push({ kind: "large_bill", title: `Unusually large bill from ${b.supplier}`, detail: `${b.number} is ${inr(b.total)}; their bills are usually around ${inr(usual)} (${(b.total / usual).toFixed(1)}×).`, link: `/accounts/bills/${b.id}`, amount: b.total });
  }
  return out;
}

/** Expense accounts whose spend this month (so far) is over `factor` times their average over the months before, and at least `minExtra` more. */
export function expenseSpikes(rows: { accountId: string; name: string; month: string; amount: number }[], thisMonth: string, factor = 2, minExtra = 10_000_00): Finding[] {
  const by = new Map<string, { name: string; now: number; before: number[] }>();
  for (const r of rows) {
    const e = by.get(r.accountId) ?? { name: r.name, now: 0, before: [] };
    if (r.month === thisMonth) e.now += r.amount;
    else if (r.month < thisMonth) e.before.push(r.amount);
    by.set(r.accountId, e);
  }
  const out: Finding[] = [];
  for (const [id, e] of by) {
    if (!e.before.length) continue;
    const avg = e.before.reduce((n, x) => n + x, 0) / e.before.length;
    if (e.now > factor * avg && e.now - avg >= minExtra) out.push({ kind: "expense_spike", title: `${e.name} is running high`, detail: `${inr(e.now)} so far this month against an average of ${inr(avg)} over the ${e.before.length} month(s) before.`, link: `/accounts/accounts/${id}`, amount: e.now });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
