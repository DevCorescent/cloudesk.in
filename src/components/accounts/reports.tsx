"use client";

// Reports (profit and loss, balance sheet, trial balance, who owes what) and
// GST returns (GSTR-1 and GSTR-3B summaries, e-invoice and e-way bill files).
import { Download, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu } from "@/components/import/buttons";
import { Tabs } from "@/components/ui/overlays";
import { Input, Notice, PageHeader, Skeleton, cx } from "@/components/ui/primitives";
import { EinvoiceView } from "./group";
import { SliceBar, useSliceQs, Empty, Section, Stat, accApi, fmt, inr, short, todayIst, useAcc, useAccQuery } from "./shared";
import { CashFlow, Forecast } from "./finance";

type Line = { id: string; code: string; name: string; balance: number; dr?: number; cr?: number };
const TABS = [
  { value: "profit-loss", label: "Profit & loss" },
  { value: "balance-sheet", label: "Balance sheet" },
  { value: "trial-balance", label: "Trial balance" },
  { value: "cash-flow", label: "Cash flow" },
  { value: "forecast", label: "Cash forecast" },
  { value: "aging", label: "Who owes what" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function ReportsView({ tab: initial }: { tab?: string }) {
  const { go } = useAcc();
  const tab = (TABS.some((t) => t.value === initial) ? initial : "profit-loss") as Tab;
  return (
    <div>
      <PageHeader
        title="Reports"
        description="From your ledger — everything Cloudesk posted and every journal you wrote."
        actions={
          <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2 print:hidden">
            <Printer className="size-3.5" /> Print
          </button>
        }
      />
      <Tabs value={tab} onChange={(v) => go(`reports/${v}`)} className="mb-5 print:hidden" tabs={TABS.map((t) => ({ value: t.value, label: t.label }))} />
      {tab !== "aging" && tab !== "forecast" && <SliceBar />}
      {tab === "profit-loss" && <ProfitLoss />}
      {tab === "balance-sheet" && <BalanceSheet />}
      {tab === "trial-balance" && <TrialBalance />}
      {tab === "aging" && <Aging />}
      {tab === "cash-flow" && <CashFlow />}
      {tab === "forecast" && <Forecast />}
    </div>
  );
}

function LineList({ lines, total, label }: { lines: Line[]; total: number; label: string }) {
  return (
    <div>
      <ul className="divide-y divide-border text-[13px]">
        {lines.map((l) => (
          <li key={l.id}>
            <Link href={`/accounts/accounts/${l.id}`} className="flex justify-between gap-3 py-1.5 hover:opacity-80">
              <span>
                <span className="mr-2 font-mono text-[11.5px] text-subtle">{l.code}</span>
                {l.name}
              </span>
              <span className="tabular-nums">{l.balance < 0 ? `(${inr(-l.balance)})` : inr(l.balance)}</span>
            </Link>
          </li>
        ))}
        {!lines.length && <li className="py-1.5 text-muted">Nothing yet.</li>}
      </ul>
      <div className="mt-1 flex justify-between border-t border-border pt-2 text-[13.5px] font-semibold">
        <span>{label}</span>
        <span className="tabular-nums">{inr(total)}</span>
      </div>
    </div>
  );
}

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      <Input aria-label="From" type="date" className="!w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
      <span className="text-muted">to</span>
      <Input aria-label="To" type="date" className="!w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

function ProfitLoss() {
  const { meta } = useAcc();
  const [from, setFrom] = useState(meta.fy.from);
  const [to, setTo] = useState(todayIst());
  const slice = useSliceQs();
  const q = useAccQuery<{ income: Line[]; expenses: Line[]; totalIncome: number; totalExpenses: number; grossProfit: number; net: number }>(`reports/profit-loss?from=${from}&to=${to}${slice}`, { keepPrevious: true });
  const d = q.data;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <ExportMenu name={`profit-and-loss-${from}-to-${to}`} rows={d ? [...d.income.map((l) => ({ ...l, group: "Income" })), { group: "Income", name: "Total income", balance: d.totalIncome }, ...d.expenses.map((l) => ({ ...l, group: "Expenses" })), { group: "Expenses", name: "Total expenses", balance: d.totalExpenses }, { group: "", name: d.net >= 0 ? "Net profit" : "Net loss", balance: d.net }] : undefined} columns={[{ key: "group", label: "Section" }, { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "balance", label: "Amount", money: true }]} />
      </div>
      {!d ? (
        <Skeleton className="h-80 rounded-[20px]" />
      ) : (
        <div className={cx("grid gap-5", q.isFetching && "opacity-80")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Income" value={short(d.totalIncome)} />
            <Stat label="Gross profit" value={short(d.grossProfit)} sub="after cost of goods and purchases" />
            <Stat label="All costs" value={short(d.totalExpenses)} />
            <Stat label={d.net >= 0 ? "Net profit" : "Net loss"} value={short(Math.abs(d.net))} tone={d.net >= 0 ? "good" : "warn"} sub={d.totalIncome ? `${Math.round((d.net / d.totalIncome) * 100)}% of income` : undefined} />
          </div>
          <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
            <Section title="Income">
              <LineList lines={d.income} total={d.totalIncome} label="Total income" />
            </Section>
            <Section title="Expenses">
              <LineList lines={d.expenses} total={d.totalExpenses} label="Total expenses" />
            </Section>
          </div>
          <p className="text-[12px] text-muted">
            {fmt(from)} to {fmt(to)}. Sales returns and credit notes show as negative income.
          </p>
        </div>
      )}
    </>
  );
}

function BalanceSheet() {
  const [asOf, setAsOf] = useState(todayIst());
  const slice = useSliceQs();
  const q = useAccQuery<{ fy: string; assets: Line[]; liabilities: Line[]; equity: Line[]; retained: number; thisYear: number; totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean }>(`reports/balance-sheet?asOf=${asOf}${slice}`, { keepPrevious: true });
  const d = q.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-[13px] text-muted">As on</span>
        <Input aria-label="As on" type="date" className="!w-auto" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <span className="ml-auto">
          <ExportMenu name={`balance-sheet-${asOf}`} rows={d ? [...d.assets.map((l) => ({ ...l, group: "Assets" })), ...d.liabilities.map((l) => ({ ...l, group: "Liabilities" })), ...d.equity.map((l) => ({ ...l, group: "Equity" })), { group: "Equity", name: "Profit from earlier years", balance: d.retained }, { group: "Equity", name: `Profit this year (${d.fy})`, balance: d.thisYear }] : undefined} columns={[{ key: "group", label: "Section" }, { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "balance", label: "Amount", money: true }]} />
        </span>
      </div>
      {!d ? (
        <Skeleton className="h-80 rounded-[20px]" />
      ) : (
        <div className={cx("grid gap-5", q.isFetching && "opacity-80")}>
          {!d.balanced && <Notice tone="danger" title="Doesn't balance">Assets don&apos;t equal liabilities and equity — something was posted on one side only. Check the trial balance.</Notice>}
          <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
            <Section title="What the business has">
              <LineList lines={d.assets} total={d.totalAssets} label="Total assets" />
            </Section>
            <div className="grid content-start gap-5">
              <Section title="What it owes">
                <LineList lines={d.liabilities} total={d.totalLiabilities} label="Total liabilities" />
              </Section>
              <Section title="Owner's equity">
                <LineList
                  lines={[...d.equity, { id: "retained", code: "", name: "Profit from earlier years", balance: d.retained }, { id: "year", code: "", name: `Profit this year (${d.fy})`, balance: d.thisYear }].filter((l) => l.balance)}
                  total={d.totalEquity}
                  label="Total equity"
                />
              </Section>
              <div className="flex justify-between rounded-[16px] bg-surface-2 px-4 py-3 text-[14px] font-semibold">
                <span>Liabilities + equity</span>
                <span className="tabular-nums">{inr(d.totalLiabilities + d.totalEquity)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TrialBalance() {
  const [asOf, setAsOf] = useState(todayIst());
  const slice = useSliceQs();
  const q = useAccQuery<{ lines: (Line & { dr: number; cr: number })[]; totalDr: number; totalCr: number }>(`reports/trial-balance?asOf=${asOf}${slice}`, { keepPrevious: true });
  const d = q.data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-[13px] text-muted">As on</span>
        <Input aria-label="As on" type="date" className="!w-auto" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <span className="ml-auto">
          <ExportMenu name={`trial-balance-${asOf}`} rows={d?.lines} columns={[{ key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "dr", label: "Debit", money: true }, { key: "cr", label: "Credit", money: true }]} />
        </span>
      </div>
      {!d ? (
        <Skeleton className="h-80 rounded-[20px]" />
      ) : (
        <Section title={d.totalDr === d.totalCr ? "Debits equal credits" : "Out of balance"}>
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="py-1.5 font-medium">Account</th>
                <th className="py-1.5 text-right font-medium">Debit</th>
                <th className="py-1.5 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-1.5">
                    <Link href={`/accounts/accounts/${l.id}`} className="hover:underline">
                      <span className="mr-2 font-mono text-[11.5px] text-subtle">{l.code}</span>
                      {l.name}
                    </Link>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{l.dr ? inr(l.dr) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.cr ? inr(l.cr) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-right tabular-nums">{inr(d.totalDr)}</td>
                <td className="py-2 text-right tabular-nums">{inr(d.totalCr)}</td>
              </tr>
            </tfoot>
          </table>
        </Section>
      )}
    </>
  );
}

type AgingSide = { rows: { party: string; buckets: number[]; total: number }[]; totals: number[]; total: number; documents: { id: string; number: string; party: string; date: string; due: string | null; amount: number; late: boolean }[] };

function Aging() {
  const q = useAccQuery<{ buckets: string[]; receivables: AgingSide; payables: AgingSide }>("reports/aging");
  const d = q.data;
  if (!d) return <Skeleton className="h-80 rounded-[20px]" />;
  const table = (side: AgingSide) =>
    !side.rows.length ? (
      <Empty>Nothing outstanding.</Empty>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="text-left text-[12px] text-muted">
            <tr>
              <th className="py-1.5 font-medium">Who</th>
              {d.buckets.map((b) => (
                <th key={b} className="py-1.5 text-right font-medium">
                  {b}
                </th>
              ))}
              <th className="py-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {side.rows.map((r) => (
              <tr key={r.party} className="border-t border-border">
                <td className="py-1.5 font-medium">{r.party}</td>
                {r.buckets.map((b, i) => (
                  <td key={i} className={cx("py-1.5 text-right tabular-nums", i > 0 && b && "text-danger")}>
                    {b ? inr(b) : ""}
                  </td>
                ))}
                <td className="py-1.5 text-right font-semibold tabular-nums">{inr(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2">Total</td>
              {side.totals.map((t, i) => (
                <td key={i} className="py-2 text-right tabular-nums">
                  {t ? inr(t) : ""}
                </td>
              ))}
              <td className="py-2 text-right tabular-nums">{inr(side.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  const flat = [...d.receivables.documents.map((x) => ({ ...x, side: "Customer owes you" })), ...d.payables.documents.map((x) => ({ ...x, side: "You owe supplier" }))];
  return (
    <div className="grid gap-5">
      <div className="flex justify-end print:hidden">
        <ExportMenu name="who-owes-what" rows={flat} columns={[{ key: "side", label: "Side" }, { key: "party", label: "Party" }, { key: "number", label: "Document" }, { key: "date", label: "Date" }, { key: "due", label: "Due" }, { key: "amount", label: "Outstanding", money: true }, { key: "late", label: "Overdue", format: (v) => (v ? "yes" : "no") }]} />
      </div>
      <Section title={`Customers owe you · ${inr(d.receivables.total)}`}>{table(d.receivables)}</Section>
      <Section title={`You owe suppliers · ${inr(d.payables.total)}`}>{table(d.payables)}</Section>
    </div>
  );
}

// ─── GST ───

type Amounts = { taxable: number; igst: number; cgst: number; sgst: number };
type G1 = { gstin: string; totals: Amounts; b2b: (Amounts & { gstin: string; name: string; invoice: string; date: string; value: number; placeOfSupply: string; source: string })[]; b2cl: (Amounts & { invoice: string; value: number; placeOfSupply: string })[]; b2cs: (Amounts & { placeOfSupply: string; rate: number })[]; cdn: (Amounts & { note: string; name: string; value: number })[]; hsn: (Amounts & { hsn: string; rate: number })[]; sources: string[]; notes: string[] };
type G3 = { outward: Amounts; itc: Amounts; ineligible: number; bills: number; payable: { igst: number; cgst: number; sgst: number; total: number }; carryForward: { igst: number; cgst: number; sgst: number; total: number }; notes: string[] };

export function GstView({ tab: initial }: { tab?: string }) {
  const { go, orgId, meta } = useAcc();
  const tab = initial === "gstr3b" ? "gstr3b" : initial === "einvoice" ? "einvoice" : "gstr1";
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const g1 = useAccQuery<G1>(tab === "gstr1" ? `gst/gstr1?month=${month}` : null, { keepPrevious: true });
  const g3 = useAccQuery<G3>(tab === "gstr3b" ? `gst/gstr3b?month=${month}` : null, { keepPrevious: true });
  const sum = (a: Amounts) => a.igst + a.cgst + a.sgst;
  const exp = (section: string) => accApi(orgId, `gst/gstr1/export?month=${month}&section=${section}`);
  return (
    <div>
      <PageHeader title="GST returns" description={`Working summaries to file from${meta.settings.gstin ? ` · GSTIN ${meta.settings.gstin}` : ""}. Cloudesk doesn't file with the GST portal.`} actions={tab !== "einvoice" && <Input aria-label="Month" type="month" className="!w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />} />
      <Tabs value={tab} onChange={(v) => go(`gst/${v}`)} className="mb-5" tabs={[{ value: "gstr1", label: "GSTR-1 · sales" }, { value: "gstr3b", label: "GSTR-3B · tax to pay" }, { value: "einvoice", label: "E-invoices & e-way bills" }]} />
      {tab === "einvoice" && <EinvoiceView />}
      {tab === "gstr1" &&
        (!g1.data ? (
          <Skeleton className="h-80 rounded-[20px]" />
        ) : (
          <div className={cx("grid gap-5", g1.isFetching && "opacity-80")}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Taxable value" value={short(g1.data.totals.taxable)} />
              <Stat label="IGST" value={short(g1.data.totals.igst)} />
              <Stat label="CGST + SGST" value={short(g1.data.totals.cgst + g1.data.totals.sgst)} />
              <Stat label="Invoices to businesses" value={g1.data.b2b.length} sub="with a GSTIN (B2B)" />
            </div>
            <Section title="To businesses (B2B)" action={<Export href={exp("b2b")} />}>
              {!g1.data.b2b.length ? (
                <Empty>No invoices to a GSTIN this month.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[13px]">
                    <thead className="text-left text-[12px] text-muted">
                      <tr>
                        <th className="py-1.5 font-medium">GSTIN</th>
                        <th className="py-1.5 font-medium">Invoice</th>
                        <th className="py-1.5 font-medium">Place of supply</th>
                        <th className="py-1.5 text-right font-medium">Taxable</th>
                        <th className="py-1.5 text-right font-medium">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g1.data.b2b.map((r) => (
                        <tr key={`${r.invoice}-${r.source}`} className="border-t border-border">
                          <td className="py-1.5">
                            <span className="font-mono text-[12px]">{r.gstin}</span>
                            <span className="block text-[11.5px] text-muted">{r.name}</span>
                          </td>
                          <td className="py-1.5">
                            {r.invoice}
                            <span className="block text-[11.5px] text-muted">
                              {fmt(r.date, { day: "numeric", month: "short" })} · {r.source}
                            </span>
                          </td>
                          <td className="py-1.5 text-muted">{r.placeOfSupply}</td>
                          <td className="py-1.5 text-right tabular-nums">{inr(r.taxable)}</td>
                          <td className="py-1.5 text-right tabular-nums">{inr(sum(r))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
            <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
              <Section title="To consumers (B2CS)" action={<Export href={exp("b2cs")} />}>
                {!g1.data.b2cs.length ? (
                  <Empty>None this month.</Empty>
                ) : (
                  <ul className="divide-y divide-border text-[13px]">
                    {g1.data.b2cs.map((r) => (
                      <li key={`${r.placeOfSupply}-${r.rate}`} className="flex justify-between gap-3 py-1.5">
                        <span>
                          {r.placeOfSupply} <span className="text-muted">· {r.rate / 100}%</span>
                        </span>
                        <span className="tabular-nums">
                          {inr(r.taxable)} <span className="text-muted">+ {inr(sum(r))}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {g1.data.b2cl.length > 0 && <p className="mt-2 text-[12px] text-muted">{g1.data.b2cl.length} large inter-state invoice(s) to consumers are listed separately (B2CL) in the export.</p>}
              </Section>
              <Section title="By HSN" action={<Export href={exp("hsn")} />}>
                {!g1.data.hsn.length ? (
                  <Empty>None this month.</Empty>
                ) : (
                  <ul className="divide-y divide-border text-[13px]">
                    {g1.data.hsn.map((r) => (
                      <li key={`${r.hsn}-${r.rate}`} className="flex justify-between gap-3 py-1.5">
                        <span>
                          <span className="font-mono text-[12px]">{r.hsn}</span> <span className="text-muted">· {r.rate / 100}%</span>
                        </span>
                        <span className="tabular-nums">
                          {inr(r.taxable)} <span className="text-muted">+ {inr(sum(r))}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            {g1.data.cdn.length > 0 && (
              <Section title="Credit notes and refunds" action={<Export href={exp("cdn")} />}>
                <ul className="divide-y divide-border text-[13px]">
                  {g1.data.cdn.map((r, i) => (
                    <li key={i} className="flex justify-between gap-3 py-1.5">
                      <span>
                        {r.note} <span className="text-muted">· {r.name || "consumer"}</span>
                      </span>
                      <span className="tabular-nums">−{inr(r.taxable + sum(r))}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Notes items={[...g1.data.sources, ...g1.data.notes]} />
          </div>
        ))}
      {tab === "gstr3b" &&
        (!g3.data ? (
          <Skeleton className="h-80 rounded-[20px]" />
        ) : (
          <div className={cx("grid gap-5", g3.isFetching && "opacity-80")}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Tax on sales" value={short(sum(g3.data.outward))} sub={`on ${short(g3.data.outward.taxable)} taxable`} />
              <Stat label="Input credit" value={short(sum(g3.data.itc))} sub={`${g3.data.bills} bill${g3.data.bills === 1 ? "" : "s"} this month`} />
              <Stat label="To pay in cash" value={short(g3.data.payable.total)} tone={g3.data.payable.total ? "warn" : "good"} />
              <Stat label="Credit carried forward" value={short(g3.data.carryForward.total)} />
            </div>
            <Section title="Head by head">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-muted">
                  <tr>
                    <th className="py-1.5 font-medium" />
                    <th className="py-1.5 text-right font-medium">IGST</th>
                    <th className="py-1.5 text-right font-medium">CGST</th>
                    <th className="py-1.5 text-right font-medium">SGST</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["3.1 Tax on outward supplies", g3.data.outward],
                      ["4 Input credit available", g3.data.itc],
                      ["Pay in cash", g3.data.payable],
                      ["Credit carried forward", g3.data.carryForward],
                    ] as const
                  ).map(([label, a]) => (
                    <tr key={label} className="border-t border-border">
                      <td className="py-2 font-medium">{label}</td>
                      <td className="py-2 text-right tabular-nums">{inr(a.igst)}</td>
                      <td className="py-2 text-right tabular-nums">{inr(a.cgst)}</td>
                      <td className="py-2 text-right tabular-nums">{inr(a.sgst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g3.data.ineligible > 0 && <p className="mt-2 text-[12px] text-muted">{inr(g3.data.ineligible)} of GST on bills marked “no input credit” isn&apos;t claimed.</p>}
            </Section>
            <Notes items={g3.data.notes} />
          </div>
        ))}
    </div>
  );
}

function Export({ href }: { href: string }) {
  return (
    <a href={href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">
      <Download className="size-3.5" /> CSV
    </a>
  );
}

function Notes({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-1 text-[12px] text-muted">
      {items.map((n) => (
        <li key={n}>• {n}</li>
      ))}
    </ul>
  );
}
