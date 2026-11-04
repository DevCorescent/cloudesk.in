"use client";

// The books: the accounting home, the day book (every journal) with manual
// journals, the chart of accounts, one account's ledger, and settings.
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Lock, Pencil, Plus, RefreshCcw, Trash2, Upload, X } from "lucide-react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { SmartImport } from "@/components/import/smart-import";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import Link from "next/link";
import { Fragment, useState } from "react";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
import { Button, Field, Input, PageHeader, Select, Skeleton, Switch, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { ACCOUNT_TYPES, SUBTYPES } from "@/lib/accounting/model";
import { TDS_SECTIONS } from "@/lib/accounting/tds";
import { SliceBar, useSliceQs, AccountOptions, Empty, SOURCE_LABEL, Section, Stat, accApi, accName, fmt, inr, short, toPaise, todayIst, useAcc, useAccAction, useAccQuery, type Account } from "./shared";
import { PendingOfKind } from "@/components/approvals/card";

type Home = {
  money: { id: string; name: string; subtype: string; balance: number }[];
  cashAndBank: number;
  receivable: number;
  receivableLate: number;
  payable: number;
  payableLate: number;
  month: { income: number; expenses: number; net: number };
  year: { label: string; income: number; expenses: number; net: number };
  gst: { output: number; input: number; net: number };
  trend: { month: string; income: number; expenses: number }[];
  syncedAt: string | null;
  notes: { source: string; ref: string; why: string }[];
};

export function HomeView() {
  const { go, meta } = useAcc();
  const q = useAccQuery<Home>("home");
  const sync = useAccAction<void, { added: number; changed: number; removed: number }>(() => ({ path: "sync" }), { success: (r) => (r.added || r.changed || r.removed ? `Books updated: ${r.added} added, ${r.changed} changed, ${r.removed} removed` : "Everything was already up to date") });
  const d = q.data;
  const max = Math.max(1, ...(d?.trend ?? []).flatMap((t) => [t.income, t.expenses]));
  return (
    <div>
      <PageHeader
        title="Accounts"
        description={d?.syncedAt ? `Posted from your invoices, sales, purchases and payroll · updated ${new Date(d.syncedAt).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}` : "Posted from your invoices, sales, purchases and payroll."}
        actions={
          <div className="flex gap-2">
            {meta.me.write && (
              <Button size="sm" icon={<RefreshCcw className="size-3.5" />} loading={sync.isPending} onClick={() => sync.mutate()}>
                Update now
              </Button>
            )}
            {meta.me.write && meta.parts.bills && (
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => go("bills?new=expense")}>
                Record an expense
              </Button>
            )}
          </div>
        }
      />
      {!d ? (
        <Skeleton className="h-[60vh] rounded-[24px]" />
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Cash and bank" value={short(d.cashAndBank)} sub={`${d.money.length} account${d.money.length === 1 ? "" : "s"}`} onClick={() => go(meta.parts.banking ? "bank" : "accounts")} />
            <Stat label="Customers owe you" value={short(d.receivable)} sub={d.receivableLate ? `${short(d.receivableLate)} overdue` : "nothing overdue"} tone={d.receivableLate ? "warn" : undefined} onClick={() => go("reports/aging")} />
            <Stat label="You owe suppliers" value={short(d.payable)} sub={d.payableLate ? `${short(d.payableLate)} overdue` : "nothing overdue"} tone={d.payableLate ? "warn" : undefined} onClick={() => go(meta.parts.bills ? "bills" : "reports/aging")} />
            <Stat label={`Profit, ${d.year.label}`} value={short(d.year.net)} sub={`${short(d.year.income)} income · ${short(d.year.expenses)} costs`} tone={d.year.net >= 0 ? "good" : "warn"} onClick={() => go("reports/profit-loss")} />
          </div>
          {d.notes.length > 0 && (
            <Section title={`Not posted · ${d.notes.length}`}>
              <ul className="grid gap-1.5 text-[13px]">
                {d.notes.slice(0, 6).map((n, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span>
                      <b className="font-medium">
                        {n.source} {n.ref}
                      </b>{" "}
                      <span className="text-muted">— {n.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] [&>*]:min-w-0">
            <Section title="Income and costs, last six months" action={<Link href="/accounts/reports/profit-loss" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">Profit &amp; loss <ArrowRight className="size-3.5" /></Link>}>
              {!d.trend.length ? (
                <Empty>Nothing posted yet. Issue an invoice, record a bill or run payroll and it shows here.</Empty>
              ) : (
                <>
                  <div className="flex h-44 items-end gap-3 border-b border-border">
                    {d.trend.map((t) => (
                      <div key={t.month} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1" title={`${t.month}: ${inr(t.income)} income, ${inr(t.expenses)} costs`}>
                        <span className="w-full max-w-[22px] rounded-t-[4px] bg-[var(--chart)]" style={{ height: `${t.income ? Math.max(2, (t.income / max) * 100) : 0}%` }} />
                        <span className="w-full max-w-[22px] rounded-t-[4px] bg-[var(--chart-soft)]" style={{ height: `${t.expenses ? Math.max(2, (t.expenses / max) * 100) : 0}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 flex gap-3">
                    {d.trend.map((t) => (
                      <span key={t.month} className="min-w-0 flex-1 text-center text-[10.5px] text-subtle">
                        {new Date(`${t.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 flex gap-4 text-[11.5px] text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[var(--chart)]" /> Income
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[var(--chart-soft)]" /> Costs
                    </span>
                  </p>
                </>
              )}
            </Section>
            <div className="grid content-start gap-5">
              <Section title="This month">
                <dl className="grid gap-1.5 text-[13px]">
                  <Row label="Income">{inr(d.month.income)}</Row>
                  <Row label="Costs">{inr(d.month.expenses)}</Row>
                  <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
                    <span>{d.month.net >= 0 ? "Profit" : "Loss"}</span>
                    <span className={cx("tabular-nums", d.month.net < 0 && "text-danger")}>{inr(Math.abs(d.month.net))}</span>
                  </div>
                </dl>
              </Section>
              <Section title="Money" action={meta.parts.banking ? <Link href="/accounts/bank" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">Banking <ArrowRight className="size-3.5" /></Link> : undefined}>
                <ul className="grid gap-1.5 text-[13px]">
                  {d.money.map((m) => (
                    <li key={m.id}>
                      <Link href={`/accounts/accounts/${m.id}`} className="flex justify-between gap-3 hover:opacity-80">
                        <span>{m.name}</span>
                        <b className="tabular-nums">{inr(m.balance)}</b>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
              {meta.parts.gst && (
                <Section title="GST position" action={<Link href="/accounts/gst/gstr3b" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-fg">GSTR-3B <ArrowRight className="size-3.5" /></Link>}>
                  <dl className="grid gap-1.5 text-[13px]">
                    <Row label="Collected on sales">{inr(d.gst.output)}</Row>
                    <Row label="Input credit on purchases">{inr(d.gst.input)}</Row>
                    <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
                      <span>{d.gst.net >= 0 ? "To pay" : "Credit to carry"}</span>
                      <span className="tabular-nums">{inr(Math.abs(d.gst.net))}</span>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11.5px] text-muted">From the ledger, all time. Payments of GST you record against the tax accounts bring it down.</p>
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

type Journal = { id: string; number: string; date: string; narration: string; sourceType: string; sourceRef: string; party: string; total: number; lines: { id: string; accountId: string; debit: number; credit: number; description: string }[] };

export function JournalsView() {
  const { meta } = useAcc();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState(meta.fy.from);
  const [to, setTo] = useState(todayIst());
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Journal | null>(null);
  const qs = new URLSearchParams(Object.entries({ q, type, from, to }).filter(([, v]) => v)).toString();
  const slice = useSliceQs();
  const list = useAccQuery<{ journals: Journal[] }>(`journals?${qs}${slice}`, { keepPrevious: true });
  const del = useAccAction<string>((id) => ({ path: `journals/${id}`, method: "DELETE" }), { success: "Journal deleted", onDone: () => setDeleting(null) });
  return (
    <div>
      <PageHeader
        title="Day book"
        description="Every entry in the books — posted from Cloudesk or written here."
        actions={
          <div className="flex gap-2">
            <ExportMenu
              name="day-book"
              rows={list.data?.journals.flatMap((j) => j.lines.map((l) => ({ date: j.date, number: j.number, kind: SOURCE_LABEL[j.sourceType] ?? j.sourceType, narration: j.narration, party: j.party, account: accName(meta, l.accountId), code: meta.accounts.find((a) => a.id === l.accountId)?.code ?? "", debit: l.debit, credit: l.credit })))}
              columns={[{ key: "date", label: "Date" }, { key: "number", label: "Number" }, { key: "kind", label: "Kind" }, { key: "narration", label: "Narration" }, { key: "party", label: "Party" }, { key: "code", label: "Account code" }, { key: "account", label: "Account" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }]}
            />
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>New journal</Button>}
          </div>
        }
      />
      <PendingOfKind kind="acc.journal" title="Journals waiting for approval" />
      <SliceBar />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search" className="min-w-[200px] flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, party or narration" />
        <Select aria-label="Kind" className="!w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Input aria-label="From" type="date" className="!w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label="To" type="date" className="!w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {!list.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !list.data.journals.length ? (
        <Empty>No entries in this range.</Empty>
      ) : (
        <div className={cx("overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm", list.isFetching && "opacity-80")}>
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Entry</th>
                <th className="px-4 py-2.5 font-medium">Kind</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.journals.map((j) => (
                <Fragment key={j.id}>
                  <tr onClick={() => setOpen(open === j.id ? null : j.id)} className="cursor-pointer hover:bg-surface-2">
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{fmt(j.date, { day: "numeric", month: "short" })}</td>
                    <td className="px-4 py-2.5">
                      <b className="font-medium">{j.narration || j.number}</b>
                      <span className="block text-[12px] text-muted">{[j.number !== j.sourceRef ? j.number : "", j.party].filter(Boolean).join(" · ") || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{SOURCE_LABEL[j.sourceType] ?? j.sourceType}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr(j.total)}</td>
                  </tr>
                  {open === j.id && (
                    <tr className="bg-surface-2/50">
                      <td />
                      <td colSpan={3} className="px-4 py-2">
                        <table className="w-full text-[12.5px]">
                          <tbody>
                            {j.lines.map((l) => (
                              <tr key={l.id}>
                                <td className={cx("py-1", l.credit && "pl-6")}>
                                  <Link href={`/accounts/accounts/${l.accountId}`} className="hover:underline">
                                    {accName(meta, l.accountId)}
                                  </Link>
                                  {l.description && <span className="text-muted"> · {l.description}</span>}
                                </td>
                                <td className="w-28 py-1 text-right tabular-nums">{l.debit ? inr(l.debit) : ""}</td>
                                <td className="w-28 py-1 text-right tabular-nums">{l.credit ? inr(l.credit) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {meta.me.write && ["manual", "opening", "bank"].includes(j.sourceType) && (
                          <button type="button" onClick={() => setDeleting(j)} className="mt-1 text-[12px] font-medium text-danger">
                            Delete this journal
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <JournalDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} loading={del.isPending} destructive title={`Delete ${deleting?.number}?`} description="It comes out of the books and every report." confirmLabel="Delete" />
    </div>
  );
}

function JournalDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useAcc();
  const [f, setF] = useState({ date: todayIst(), narration: "", opening: false, companyId: "", lines: [{ accountId: "", debit: "", credit: "", costCentreId: "" }, { accountId: "", debit: "", credit: "", costCentreId: "" }] });
  const dr = f.lines.reduce((a, l) => a + toPaise(l.debit), 0);
  const cr = f.lines.reduce((a, l) => a + toPaise(l.credit), 0);
  const save = useAccAction(() => ({ path: "journals", body: { date: f.date, narration: f.narration, opening: f.opening, companyId: f.companyId || null, lines: f.lines.filter((l) => l.accountId && (toPaise(l.debit) || toPaise(l.credit))).map((l) => ({ accountId: l.accountId, debit: toPaise(l.debit), credit: toPaise(l.credit), costCentreId: l.costCentreId || null })) } }), { success: (r: { journal: unknown }) => (r.journal ? "Journal saved" : "Sent for approval — it's posted once approved"), onDone: onClose });
  const set = (i: number, p: Partial<(typeof f.lines)[number]>) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  return (
    <Dialog open onClose={onClose} size="lg" title="New journal" description="Debits on one side, credits on the other — they must be equal." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={dr !== cr || !dr} onClick={() => save.mutate(undefined)}>Save journal</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
          <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Narration">{(a) => <Input {...a} value={f.narration} onChange={(e) => setF({ ...f, narration: e.target.value })} maxLength={500} placeholder="Owner put money into the business" />}</Field>
          {meta.companies.length > 1 && (
            <Field label="Company" className="sm:col-span-2">
              {(a) => (
                <Select {...a} value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
                  <option value="">{meta.companies.find((c) => c.isDefault)?.name} (default)</option>
                  {meta.companies.filter((c) => !c.isDefault && c.active).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <FormLines className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-muted">
            <tr>
              <th className="py-1 font-medium">Account</th>
              <th className="w-32 py-1 font-medium">Debit (₹)</th>
              <th className="w-32 py-1 font-medium">Credit (₹)</th>
              {meta.units.length > 0 && <th className="w-36 py-1 font-medium">Cost centre</th>}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {f.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <Select aria-label={`Account ${i + 1}`} value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
                    <option value="">Choose…</option>
                    <AccountOptions accounts={meta.accounts} />
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label={`Debit ${i + 1}`} inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: "" })} />
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label={`Credit ${i + 1}`} inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: "" })} />
                </td>
                {meta.units.length > 0 && (
                  <td className="py-1 pr-2">
                    <Select aria-label={`Cost centre ${i + 1}`} value={l.costCentreId} onChange={(e) => set(i, { costCentreId: e.target.value })}>
                      <option value="">—</option>
                      {meta.units.filter((u) => u.active).map((u) => (
                        <option key={u.id} value={u.id}>{u.code}</option>
                      ))}
                    </Select>
                  </td>
                )}
                <td>{f.lines.length > 2 && <Button size="sm" variant="ghost" aria-label="Remove line" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-1.5">
                <button type="button" className="text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setF({ ...f, lines: [...f.lines, { accountId: "", debit: "", credit: "", costCentreId: "" }] })}>
                  + Add a line
                </button>
              </td>
              <td className="py-1.5 tabular-nums">{inr(dr)}</td>
              <td className="py-1.5 tabular-nums">{inr(cr)}</td>
              <td />
            </tr>
          </tfoot>
        </FormLines>
        {dr !== cr && <p className="text-[12.5px] text-warning">Off by {inr(Math.abs(dr - cr))}.</p>}
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={f.opening} onChange={(v) => setF({ ...f, opening: v })} label="Opening balance" /> This is an opening balance (moving from another system)
        </label>
      </div>
    </Dialog>
  );
}

type Row = Account & { balance?: number };

export function AccountsView() {
  const { meta, orgId } = useAcc();
  const qc = useQueryClient();
  const [opening, setOpening] = useState(false);
  const tb = useAccQuery<{ lines: { id: string; balance: number }[] }>("reports/trial-balance");
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const bal = new Map((tb.data?.lines ?? []).map((l) => [l.id, l.balance]));
  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        description="Where every rupee is recorded. Click an account to see its ledger."
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.me.manage && <ImportButton label="Import chart" target={target("accounts.accounts")} onImport={(rows, mode) => api(accApi(orgId, "accounts/import"), { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["acc", orgId] })} />}
            {meta.me.write && (
              <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => setOpening(true)}>
                Opening balances
              </Button>
            )}
            <ExportMenu name="chart-of-accounts" rows={meta.accounts.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }))} columns={[{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "type", label: "Type" }, { key: "subtype", label: "Kind" }, { key: "balance", label: "Balance", money: true }, { key: "description", label: "Description" }]} />
            {meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ type: "expense", subtype: "other" })}>New account</Button>}
          </div>
        }
      />
      <div className="grid gap-5">
        {ACCOUNT_TYPES.map((t) => {
          const list: Row[] = meta.accounts.filter((a) => a.type === t.id);
          return (
            <Section key={t.id} title={t.label}>
              <ul className="divide-y divide-border">
                {list.map((a) => (
                  <li key={a.id} className={cx("flex items-center justify-between gap-3 py-2 text-[13.5px]", !a.active && "opacity-50")}>
                    <Link href={`/accounts/accounts/${a.id}`} className="min-w-0 flex-1 hover:opacity-80">
                      <span className="mr-2 font-mono text-[12px] text-muted">{a.code}</span>
                      <span className="font-medium">{a.name}</span>
                      {a.systemKey && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-muted">Used by Cloudesk</span>}
                      {a.description && <span className="block truncate text-[12px] text-muted">{a.description}</span>}
                    </Link>
                    <b className="tabular-nums">{bal.has(a.id) ? inr(bal.get(a.id)!) : "—"}</b>
                    {meta.me.manage && <Button size="sm" variant="ghost" aria-label={`Edit ${a.name}`} icon={<Pencil className="size-3.5" />} onClick={() => setEditing(a)} />}
                  </li>
                ))}
              </ul>
            </Section>
          );
        })}
      </div>
      {editing && <AccountDialog init={editing} onClose={() => setEditing(null)} />}
      {opening && <OpeningImport onClose={() => setOpening(false)} />}
    </div>
  );
}

/** Opening balances from another system: one balanced journal on the date they're as of. */
function OpeningImport({ onClose }: { onClose: () => void }) {
  const { orgId, meta } = useAcc();
  const qc = useQueryClient();
  const [date, setDate] = useState(meta.fy.from);
  return (
    <SmartImport
      target={target("accounts.opening")}
      onClose={onClose}
      onImport={(rows) => api(accApi(orgId, "opening/import"), { method: "POST", body: { rows, date } })}
      onDone={() => qc.invalidateQueries({ queryKey: ["acc", orgId] })}
      extra={
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface-2/60 px-3 py-2 text-[13px]">
          <span>Balances as of</span>
          <Input aria-label="Balances as of" type="date" className="!w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="text-muted">Accounts are found by code or name. Any difference between debits and credits goes to “Opening balance adjustments”.</span>
        </div>
      }
    />
  );
}

function AccountDialog({ init, onClose }: { init: Partial<Account>; onClose: () => void }) {
  const [f, setF] = useState({ code: init.code ?? "", name: init.name ?? "", type: init.type ?? "expense", subtype: init.subtype ?? "other", description: init.description ?? "", active: init.active ?? true, bankName: init.bank?.bankName ?? "", last4: init.bank?.last4 ?? "", ifsc: init.bank?.ifsc ?? "" });
  const save = useAccAction(() => ({ path: init.id ? `accounts/${init.id}` : "accounts", method: init.id ? "PUT" : "POST", body: { code: f.code, name: f.name, type: f.type, subtype: f.subtype, description: f.description, active: f.active, bank: f.subtype === "bank" ? { bankName: f.bankName, last4: f.last4, ifsc: f.ifsc } : null } }), { success: "Account saved", onDone: onClose });
  const del = useAccAction(() => ({ path: `accounts/${init.id}`, method: "DELETE" }), { success: "Account deleted", onDone: onClose });
  return (
    <Dialog
      open
      onClose={onClose}
      title={init.id ? `Edit ${init.name}` : "New account"}
      footer={
        <>
          {init.id && !init.systemKey && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-4" />} loading={del.isPending} onClick={() => del.mutate(undefined)}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate(undefined)}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code">{(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={12} placeholder="5310" />}</Field>
        <Field label="Name">{(a) => <Input {...a} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Courier charges" />}</Field>
        <Field label="Type">
          {(a) => (
            <Select {...a} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label.replace(/s$/, "")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Kind">
          {(a) => (
            <Select {...a} value={f.subtype} onChange={(e) => setF({ ...f, subtype: e.target.value })}>
              {SUBTYPES.map((t) => (
                <option key={t} value={t}>
                  {{ bank: "Bank account", cash: "Cash", receivable: "Receivable", payable: "Payable", tax_in: "Input tax", tax_out: "Output tax", inventory: "Inventory", fixed: "Fixed asset", current: "Current", other: "Other" }[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {f.subtype === "bank" && (
          <>
            <Field label="Bank">{(a) => <Input {...a} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} maxLength={60} placeholder="HDFC Bank" />}</Field>
            <Field label="Account — last 4 digits" hint="Only the last four are kept.">{(a) => <Input {...a} inputMode="numeric" value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} />}</Field>
          </>
        )}
        <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} />}</Field>
        {init.id && !init.systemKey && (
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Account in use" /> In use
          </label>
        )}
      </div>
    </Dialog>
  );
}

type Ledger = { account: Account; opening: number; closing: number; entries: { id: string; journalId: string; date: string; number: string; sourceType: string; sourceRef: string; party: string; narration: string; debit: number; credit: number; balance: number; reconciled: boolean }[] };

export function LedgerView({ id }: { id: string }) {
  const { meta } = useAcc();
  const [from, setFrom] = useState(meta.fy.from);
  const [to, setTo] = useState(todayIst());
  const slice = useSliceQs();
  const q = useAccQuery<Ledger>(`ledger/${id}?from=${from}&to=${to}${slice}`, { keepPrevious: true });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { account: a, entries } = q.data;
  return (
    <div>
      <Link href="/accounts/accounts" className="mb-2 inline-flex text-[13px] text-muted hover:text-fg">
        ← Chart of accounts
      </Link>
      <PageHeader
        title={a.name}
        description={`${a.code} · ${ACCOUNT_TYPES.find((t) => t.id === a.type)?.label.replace(/s$/, "")}${a.bank?.bankName ? ` · ${a.bank.bankName}${a.bank.last4 ? ` ••${a.bank.last4}` : ""}` : ""}`}
        actions={
          <div className="flex gap-2">
            <ExportMenu name={`ledger-${a.code}`} rows={entries} columns={[{ key: "date", label: "Date" }, { key: "number", label: "Number" }, { key: "narration", label: "Narration" }, { key: "party", label: "Party" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }, { key: "balance", label: "Balance", money: true }]} />
            <Input aria-label="From" type="date" className="!w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input aria-label="To" type="date" className="!w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        }
      />
      <SliceBar />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Opening" value={inr(q.data.opening)} sub={fmt(from)} />
        <Stat label="In" value={inr(entries.reduce((x, e) => x + (["asset", "expense"].includes(a.type) ? e.debit : e.credit), 0))} />
        <Stat label="Out" value={inr(entries.reduce((x, e) => x + (["asset", "expense"].includes(a.type) ? e.credit : e.debit), 0))} />
        <Stat label="Closing" value={inr(q.data.closing)} sub={fmt(to)} />
      </div>
      {!entries.length ? (
        <Empty>No entries in this range.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Entry</th>
                <th className="px-4 py-2.5 text-right font-medium">Debit</th>
                <th className="px-4 py-2.5 text-right font-medium">Credit</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-muted">{fmt(e.date, { day: "numeric", month: "short" })}</td>
                  <td className="px-4 py-2">
                    {e.narration}
                    <span className="block text-[11.5px] text-muted">
                      {[SOURCE_LABEL[e.sourceType], e.party, e.reconciled ? "matched to bank" : ""].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.debit ? inr(e.debit) : ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.credit ? inr(e.credit) : ""}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{inr(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const { meta } = useAcc();
  const s = meta.settings;
  const [f, setF] = useState({ ...s, lockDate: s.lockDate ?? "" });
  const [confirmLock, setConfirmLock] = useState(false);
  const save = useAccAction(() => ({ path: "settings", method: "PUT", body: { ...f, lockDate: f.lockDate || null } }), { success: "Settings saved", onDone: () => setConfirmLock(false) });
  const banks = meta.accounts.filter((a) => a.subtype === "bank" && a.active);
  const tightening = !!f.lockDate && f.lockDate !== (s.lockDate ?? "");
  return (
    <div>
      <PageHeader title="Accounting settings" description="Your business for GST, the financial year, locking and what posts by itself." />
      {meta.me.manage && <ClosedMonths />}
      <div className="grid max-w-3xl gap-5">
        <Section title="Business">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="GSTIN">{(a) => <Input {...a} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} />}</Field>
            <Field label="State code" hint="Like MH.">{(a) => <Input {...a} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} maxLength={2} />}</Field>
            <Field label="Financial year starts">
              {(a) => (
                <Select {...a} value={String(f.fyStartMonth)} onChange={(e) => setF({ ...f, fyStartMonth: Number(e.target.value) })}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {new Date(Date.UTC(2026, i, 1)).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Section>
        <Section title="TDS">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="TAN" hint="For TDS returns and challans.">{(a) => <Input {...a} value={f.tds.tan} onChange={(e) => setF({ ...f, tds: { ...f.tds, tan: e.target.value.toUpperCase() } })} maxLength={10} placeholder="ABCD12345E" />}</Field>
          </div>
          <table className="mt-4 w-full text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr>
                <th className="py-1 font-medium">Section</th>
                <th className="w-28 py-1 font-medium">Company %</th>
                <th className="w-28 py-1 font-medium">Others %</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(TDS_SECTIONS).map(([k, sec]) => {
                const o = f.tds.rates[k];
                const setRate = (who: "company" | "other", v: string) => {
                  const rates = { ...f.tds.rates };
                  const next = { ...(o ?? sec.rate), [who]: Number(v) || 0 };
                  if (v === "" || (next.company === sec.rate.company && next.other === sec.rate.other)) delete rates[k];
                  else rates[k] = next;
                  setF({ ...f, tds: { ...f.tds, rates } });
                };
                return (
                  <tr key={k}>
                    <td className="py-1 pr-2">{sec.label}</td>
                    <td className="py-1 pr-2"><Input aria-label={`${sec.label} company rate`} type="number" step="0.01" min={0} max={40} value={o ? String(o.company) : ""} placeholder={String(sec.rate.company)} onChange={(e) => setRate("company", e.target.value)} /></td>
                    <td className="py-1"><Input aria-label={`${sec.label} other rate`} type="number" step="0.01" min={0} max={40} value={o ? String(o.other) : ""} placeholder={String(sec.rate.other)} onChange={(e) => setRate("other", e.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[12.5px] text-muted">Rates and thresholds are as of FY 2025-26 and change with each budget. Leave a box empty to use the rate shown; check current rates with your chartered accountant.</p>
        </Section>
        <Section title="Lock the books">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Locked up to and including">{(a) => <Input {...a} type="date" value={f.lockDate} onChange={(e) => setF({ ...f, lockDate: e.target.value })} className="!w-48" />}</Field>
            {f.lockDate && (
              <Button size="sm" variant="ghost" onClick={() => setF({ ...f, lockDate: "" })}>
                Unlock
              </Button>
            )}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" /> Once a period is filed or audited, lock it: nothing dated on or before this can be added, changed or removed — here or by documents elsewhere in Cloudesk.
          </p>
        </Section>
        <Section title="Posting from the rest of Cloudesk">
          <ul className="grid gap-2">
            {(
              [
                ["invoices", "Invoices, credit notes and payments"],
                ["store", "Online store, counter (POS) and restaurant sales and refunds"],
                ["inventory", "Goods received (as bills) and stock adjustments"],
                ["payroll", "Payroll runs, salary payments and claims"],
              ] as const
            ).map(([k, label]) => (
              <li key={k} className="flex items-center justify-between gap-3 text-[13px]">
                {label}
                <Switch checked={f.autoPost[k]} onChange={(v) => setF({ ...f, autoPost: { ...f.autoPost, [k]: v } })} label={`Post ${label}`} />
              </li>
            ))}
          </ul>
          <Field label="Payments go to" className="mt-4" hint="Non-cash payments land here unless something says otherwise.">
            {(a) => (
              <Select {...a} value={f.defaultBankId ?? ""} onChange={(e) => setF({ ...f, defaultBankId: e.target.value || null })}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Section>
        <div>
          <Button variant="primary" loading={save.isPending} onClick={() => (tightening ? setConfirmLock(true) : save.mutate(undefined))}>
            Save settings
          </Button>
        </div>
      </div>
      <ConfirmDialog open={confirmLock} onClose={() => setConfirmLock(false)} onConfirm={() => save.mutate(undefined)} loading={save.isPending} title={`Lock the books up to ${fmt(f.lockDate)}?`} description="Entries on or before that date can't be added, changed or removed until you unlock. Changes to old invoices or bills will be listed as not posted." confirmLabel="Lock" />
    </div>
  );
}


type Period = { id: string; companyId: string | null; month: string; closedAt: string; note: string };
/** Close months so nothing in them changes — for one company or all of them — and reopen when needed. */
function ClosedMonths() {
  const { meta } = useAcc();
  const q = useAccQuery<{ periods: Period[] }>("periods");
  const [month, setMonth] = useState(() => new Date(Date.now() + 5.5 * 3600_000 - 28 * 86400_000).toISOString().slice(0, 7));
  const [companyId, setCompanyId] = useState("");
  const close = useAccAction(() => ({ path: "periods/close", body: { month, companyId: companyId || null } }), { success: `${month} closed` });
  const reopen = useAccAction<string>((id) => ({ path: `periods/${id}`, method: "DELETE" }), { success: "Reopened" });
  const name = (id: string | null) => (id ? (meta.companies.find((c) => c.id === id)?.name ?? "A company") : "All companies");
  const list = [...(q.data?.periods ?? [])].sort((a, b) => b.month.localeCompare(a.month));
  return (
    <Section title="Closed months" className="mb-5">
      <p className="mb-3 text-[12.5px] text-muted">A closed month takes no new entries and no changes — from people or from automatic posting — until it&apos;s reopened. Close a month once its books are checked.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Month">{(a) => <Input {...a} type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-44" />}</Field>
        {meta.companies.length > 1 && (
          <Field label="For">
            {(a) => (
              <Select {...a} value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="!w-56">
                <option value="">All companies</option>
                {meta.companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Button size="sm" variant="primary" loading={close.isPending} disabled={!month} onClick={() => close.mutate(undefined)}>Close month</Button>
      </div>
      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-border text-[13px]">
          {list.slice(0, 24).map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <b className="w-24 font-medium tabular-nums">{p.month}</b>
              <span className="min-w-0 flex-1 text-muted">{name(p.companyId)}{p.note ? ` · ${p.note}` : ""}</span>
              <Button size="sm" variant="ghost" onClick={() => reopen.mutate(p.id)}>Reopen</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
