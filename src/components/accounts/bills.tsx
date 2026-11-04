"use client";

// Bills and expenses: what you owe suppliers (including bills made from goods
// received in Inventory) and what you spend, with GST and payments.
import { Ban, Plus, Receipt, ScanText, Trash2, Wallet, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { errorMessage } from "@/lib/client/api";
import type { BillDraft } from "@/lib/accounting/extract";
import { ConfirmDialog, Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { billTotals } from "@/lib/accounting/model";
import { TDS_SECTIONS } from "@/lib/accounting/tds";
import { inrOf } from "@/lib/accounting/fx";
import { formatMoney, minorDigits, parseMoney } from "@/lib/store/money";
import { AccountOptions, Empty, Section, StatusPill, accApi, accName, fmt, inr, short, toPaise, todayIst, useAcc, useAccAction, useAccQuery } from "./shared";
import { ApprovalPanel } from "@/components/approvals/card";

type Bill = { id: string; number: string; supplierId: string | null; supplierName: string; billNo: string; date: string; dueDate: string | null; lines: { accountId: string; description: string; amount: number; gstRate: number }[]; itc: boolean; interState: boolean; subtotal: number; tax: number; total: number; amountPaid: number; status: string; receiptId: string | null; pendingPayment: unknown; companyId: string | null; branchId: string | null; notes: string; due: number; overdue: boolean; kind: "bill" | "debit_note"; againstBillId: string | null; tdsSection: string; tdsRate: number; tdsAmount: number; credited: number; currency: string; fxRate: string | null; fxTotal: number | null };
type Suggestion = { section: string; rate: number; amount: number; why: string; pan: string; panValid?: boolean };

export function BillsView() {
  const { meta, go, orgId } = useAcc();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [tab, setTab] = useState<"open" | "paid" | "all">("open");
  const [q, setQ] = useState("");
  const [making, setMaking] = useState<null | "bill" | "expense">(params.get("new") === "expense" ? "expense" : null);
  // A bill read from a PDF or photo, waiting in the form for the person to check and save.
  const [read, setRead] = useState<{ draft: BillDraft; warnings: string[]; portalInvoice?: string } | null>(null);
  // Booking an invoice a supplier sent through the portal: its draft opens in the form.
  const portalInvoice = params.get("portalInvoice");
  const fromPortal = useQuery({ queryKey: ["portal", orgId, "draft", portalInvoice], queryFn: () => api<{ draft: BillDraft; warnings: string[] }>(`/api/v1/orgs/${orgId}/portal/submissions/${portalInvoice}/draft${meta.aiConnected ? "?ai=1" : ""}`), enabled: !!portalInvoice, retry: false, staleTime: Infinity });
  const [seen, setSeen] = useState<string | null>(null);
  if (portalInvoice && fromPortal.data && seen !== portalInvoice) {
    setSeen(portalInvoice);
    setRead({ ...fromPortal.data, portalInvoice });
  }
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const readBill = async (file: File) => {
    setReading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(accApi(orgId, "bills-extract"), { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "The bill couldn't be read");
      setRead(json);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const list = useAccQuery<{ bills: Bill[] }>(`bills?${new URLSearchParams(Object.entries({ status: tab === "all" ? "" : tab, q }).filter(([, v]) => v))}`, { keepPrevious: true });
  const bills = list.data?.bills;
  const owed = (bills ?? []).filter((b) => ["open", "partial"].includes(b.status)).reduce((a, b) => a + b.due, 0);
  return (
    <div>
      <PageHeader
        title="Bills & expenses"
        description={tab === "open" && bills ? `${short(owed)} owed on ${bills.length} bill${bills.length === 1 ? "" : "s"}` : "What you owe suppliers, and what you spend."}
        actions={
          meta.me.write && (
            <div className="flex flex-wrap gap-2">
              <ImportButton target={target("accounts.bills")} onImport={(rows) => api(accApi(orgId, "bills/import"), { method: "POST", body: { rows } })} onDone={() => qc.invalidateQueries({ queryKey: ["acc", orgId] })} />
              <ExportMenu name="bills" rows={bills} columns={[{ key: "number", label: "Number" }, { key: "supplierName", label: "Supplier" }, { key: "billNo", label: "Bill no" }, { key: "date", label: "Date" }, { key: "dueDate", label: "Due" }, { key: "subtotal", label: "Before GST", money: true }, { key: "tax", label: "GST", money: true }, { key: "total", label: "Total", money: true }, { key: "amountPaid", label: "Paid", money: true }, { key: "due", label: "To pay", money: true }, { key: "status", label: "Status" }]} />
              {meta.aiConnected && (
                <>
                  <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" aria-label="Bill to read" onChange={(e) => e.target.files?.[0] && readBill(e.target.files[0])} />
                  <Button size="sm" icon={<ScanText className="size-3.5" />} loading={reading} onClick={() => fileRef.current?.click()}>
                    Read a bill
                  </Button>
                </>
              )}
              <Button size="sm" icon={<Wallet className="size-3.5" />} onClick={() => setMaking("expense")}>
                Record an expense
              </Button>
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setMaking("bill")}>
                New bill
              </Button>
            </div>
          )
        }
      />
      {fromPortal.isError && <div className="mb-4"><Notice tone="warning" title="That supplier invoice can't be booked">{errorMessage(fromPortal.error)}</Notice></div>}
      {portalInvoice && fromPortal.isLoading && <div className="mb-4"><Notice title="Reading the supplier's invoice…" /></div>}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "open", label: "To pay" }, { value: "paid", label: "Paid" }, { value: "all", label: "All" }]} />
        <Input aria-label="Search bills" className="!w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Supplier or bill number" />
      </div>
      {!bills ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !bills.length ? (
        <EmptyState icon={<Receipt />} title={tab === "open" ? "Nothing to pay" : "No bills yet"} description="Add a supplier's bill to track what you owe, or record an expense you've already paid. Goods received in Inventory become bills by themselves." />
      ) : (
        <div className={cx("overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm", list.isFetching && "opacity-80")}>
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Bill</th>
                <th className="px-4 py-2.5 font-medium">Due</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
                <th className="px-4 py-2.5 text-right font-medium">To pay</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bills.map((b) => (
                <tr key={b.id} onClick={() => go(`bills/${b.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <b className="font-medium">{b.supplierName}</b>
                    <span className="block text-[12px] text-muted">{b.kind === "debit_note" ? "Debit note" : b.receiptId ? "From goods received" : b.lines.map((l) => accName(meta, l.accountId)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {b.billNo || b.number}
                    <span className="block text-[12px] text-muted">{fmt(b.date)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{b.dueDate ? fmt(b.dueDate, { day: "numeric", month: "short" }) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(b.total)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{b.due ? inr(b.due) : "—"}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={b.overdue ? "overdue" : b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {making && <BillDialog expense={making === "expense"} onClose={() => setMaking(null)} onSaved={(id) => go(`bills/${id}`)} />}
      {read && <BillDialog prefill={read.draft} warnings={read.warnings} onClose={() => setRead(null)} onSaved={async (id) => {
        if (read.portalInvoice) await api(`/api/v1/orgs/${orgId}/portal/submissions/${read.portalInvoice}/billed`, { method: "POST", body: { billId: id } }).catch((e) => toast({ tone: "error", title: errorMessage(e) }));
        go(`bills/${id}`);
      }} />}
    </div>
  );
}

type Draft = { accountId: string; description: string; amount: string; gstRate: number; costCentreId?: string };

export function BillDialog({ expense, init, against, prefill, warnings, onClose, onSaved }: { expense?: boolean; init?: Bill; against?: Bill; prefill?: BillDraft; warnings?: string[]; onClose: () => void; onSaved?: (id: string) => void }) {
  const { meta } = useAcc();
  const note = !!against || init?.kind === "debit_note";
  const read = prefill && { supplierId: prefill.supplierId, supplierName: prefill.supplierName, billNo: prefill.billNo, notes: prefill.supplierGstin && !prefill.supplierId ? `Supplier GSTIN ${prefill.supplierGstin}` : "", itc: true, interState: prefill.interState, companyId: null, branchId: null, lines: prefill.lines.map((l) => ({ ...l, accountId: l.accountId ?? "" })) };
  const src = init ?? (against && { ...against, billNo: "", notes: "", lines: against.lines.map((l) => ({ ...l, amount: 0 })) }) ?? read;
  const cash = meta.accounts.find((a) => a.systemKey === "cash")?.id ?? "";
  const [f, setF] = useState({
    supplierId: src?.supplierId ?? "",
    supplierName: src?.supplierName ?? "",
    billNo: src?.billNo ?? "",
    date: init ? String(init.date) : (prefill?.date ?? todayIst()),
    dueDate: init?.dueDate && !note ? String(init.dueDate) : (prefill?.dueDate ?? ""),
    itc: src?.itc ?? true,
    interState: src?.interState ?? false,
    notes: src?.notes ?? "",
    paidFrom: meta.settings.defaultBankId ?? cash,
    reference: "",
    companyId: src?.companyId ?? "",
    branchId: src?.branchId ?? "",
    // A foreign bill is edited in its own currency.
    currency: init?.currency ?? prefill?.currency ?? "INR",
    fxRate: init?.fxRate ? String(Number(init.fxRate)) : "",
    lines: (src?.lines.map((l) => {
      const amt = init && init.currency !== "INR" ? ((l as { fxAmount?: number }).fxAmount ?? 0) / 10 ** minorDigits(init.currency) : l.amount / 100;
      return { accountId: l.accountId, description: l.description, amount: amt ? String(amt) : "", gstRate: l.gstRate, costCentreId: (l as { costCentreId?: string | null }).costCentreId ?? "" };
    }) ?? [{ accountId: "", description: "", amount: "", gstRate: 18, costCentreId: "" }]) as Draft[],
  });
  const foreign = f.currency !== "INR";
  const minor = (v: string) => (foreign ? (parseMoney(v, f.currency) ?? 0) : toPaise(v));
  const money = (n: number) => (foreign ? formatMoney(n, f.currency) : inr(n));
  const t = billTotals(f.lines.map((l) => ({ amount: minor(l.amount), gstRate: l.gstRate })), f.interState);
  // TDS: the section follows the supplier and the amount the suggestion, until changed by hand.
  const [tds, setTds] = useState<{ section: string | null; amount: string | null }>({ section: init ? init.tdsSection : null, amount: init?.tdsSection ? String(init.tdsAmount / 100) : null });
  const withTds = !expense && !note && !foreign;
  const sug = useAccQuery<Suggestion>(withTds && (f.supplierId || tds.section) && t.subtotal ? `tds-suggest?${new URLSearchParams({ supplierId: f.supplierId, section: tds.section ?? "", amount: String(t.subtotal), date: f.date })}` : null, { keepPrevious: true });
  const section = withTds ? (tds.section ?? sug.data?.section ?? "") : "";
  const tdsAmount = !section ? null : tds.amount !== null ? toPaise(tds.amount) : sug.data && sug.data.section === section ? sug.data.amount : null;
  const body = { supplierId: f.supplierId || null, supplierName: f.supplierName, billNo: f.billNo, date: f.date, dueDate: f.dueDate || null, itc: f.itc, interState: f.interState, notes: f.notes, companyId: f.companyId || null, branchId: f.branchId || null, lines: f.lines.filter((l) => l.accountId && minor(l.amount)).map((l) => ({ accountId: l.accountId, description: l.description, amount: minor(l.amount), gstRate: l.gstRate, costCentreId: l.costCentreId || null })), currency: f.currency, fxRate: foreign && Number(f.fxRate) > 0 ? Number(f.fxRate) : null, ...(note ? { kind: "debit_note", againstBillId: against?.id ?? init?.againstBillId } : withTds ? { tdsSection: section, tdsAmount } : {}) };
  const save = useAccAction<void, { bill: { id: string } }>(() => (expense ? { path: "expenses", body: { ...body, paidFrom: f.paidFrom, reference: f.reference } } : { path: init ? `bills/${init.id}` : "bills", method: init ? "PUT" : "POST", body }), { success: expense ? "Expense recorded" : note ? "Debit note saved" : init ? "Bill saved" : "Bill added", onDone: (r) => (onClose(), onSaved?.(r.bill.id)) });
  const set = (i: number, p: Partial<Draft>) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const pickSupplier = (id: string) => {
    const sup = meta.suppliers.find((s) => s.id === id);
    setF({ ...f, supplierId: id, supplierName: sup?.name ?? f.supplierName, interState: !!sup?.state && !!meta.settings.state && sup.state !== meta.settings.state });
  };
  // Wait for the suggestion so a bill under the threshold isn't charged TDS by default.
  const ok = (f.supplierId || f.supplierName.trim()) && body.lines.length && (!expense || f.paidFrom) && (!section || tdsAmount !== null);
  return (
    <Dialog open onClose={onClose} size="lg" title={expense ? "Record an expense" : init ? `Edit ${init.number}` : note ? `Debit note against ${against?.number}` : prefill ? "Check the bill that was read" : "New bill"} description={expense ? "Something you've already paid for — it's recorded and paid in one go." : note ? "For goods sent back or an overcharge. It reduces what you owe on the bill, and the GST credit taken." : prefill ? "Read from the file by AI. Check each field against the bill — nothing is saved until you press Save bill." : "A supplier's bill you'll pay later."} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>{expense ? "Record expense" : note ? "Save debit note" : "Save bill"}</Button></>}>
      <div className="grid gap-4">
        {!!warnings?.length && (
          <Notice tone="warning" title="Check these">
            <ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={expense ? "Paid to" : "Supplier"}>
            {(a) => (
              <>
                <Input {...a} list="acc-suppliers" value={f.supplierName} disabled={note} onChange={(e) => {
                  const match = meta.suppliers.find((s) => s.name === e.target.value);
                  if (match) pickSupplier(match.id);
                  else setF({ ...f, supplierName: e.target.value, supplierId: "" });
                }} placeholder={expense ? "Airtel" : "Sunrise Properties"} maxLength={120} />
                <datalist id="acc-suppliers">
                  {meta.suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label={note ? "Their credit note no." : "Their bill / invoice no."}>{(a) => <Input {...a} value={f.billNo} onChange={(e) => setF({ ...f, billNo: e.target.value })} maxLength={60} />}</Field>
          {meta.companies.length > 1 && (
            <Field label="Company">
              {(a) => (
                <Select {...a} value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value, branchId: "" })}>
                  <option value="">{meta.companies.find((c) => c.isDefault)?.name} (default)</option>
                  {meta.companies.filter((c) => !c.isDefault && c.active).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {meta.branches.length > 0 && (
            <Field label="Branch">
              {(a) => (
                <Select {...a} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value, companyId: meta.branches.find((b) => b.id === e.target.value)?.companyId ?? f.companyId })}>
                  <option value="">None</option>
                  {meta.branches.filter((b) => b.active && (!f.companyId || b.companyId === f.companyId)).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          {!note && meta.currencies.length > 0 && (
            <Field label="Currency" hint={foreign ? undefined : "Bills from abroad can be entered in their own currency."}>
              {(a) => (
                <Select {...a} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value, interState: e.target.value !== "INR" ? false : f.interState })}>
                  <option value="INR">INR · Indian rupee</option>
                  {meta.currencies.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} · {c.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {foreign && <Field label={`Rate (₹ per ${f.currency})`} hint="Left empty, the workspace rate on the bill's date is used.">{(a) => <Input {...a} inputMode="decimal" value={f.fxRate} onChange={(e) => setF({ ...f, fxRate: e.target.value.replace(/[^\d.]/g, "") })} placeholder="workspace rate" />}</Field>}
          {expense ? (
            <Field label="Paid from">
              {(a) => (
                <Select {...a} value={f.paidFrom} onChange={(e) => setF({ ...f, paidFrom: e.target.value })}>
                  <AccountOptions accounts={meta.accounts} filter={(x) => x.subtype === "bank" || x.subtype === "cash"} />
                </Select>
              )}
            </Field>
          ) : note ? null : (
            <Field label="Due">{(a) => <Input {...a} type="date" value={f.dueDate} min={f.date} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
          )}
        </div>
        <FormLines className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-muted">
            <tr>
              <th className="py-1 font-medium">For</th>
              <th className="py-1 font-medium">Note</th>
              <th className="w-28 py-1 font-medium">Amount ({foreign ? f.currency : "₹"})</th>
              <th className="w-24 py-1 font-medium">GST</th>
              {meta.units.length > 0 && <th className="w-28 py-1 font-medium">Cost centre</th>}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {f.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <Select aria-label={`Account ${i + 1}`} value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
                    <option value="">Choose…</option>
                    <AccountOptions accounts={meta.accounts} filter={(x) => x.type === "expense" || ["inventory", "fixed", "current"].includes(x.subtype)} />
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label={`Note ${i + 1}`} value={l.description} onChange={(e) => set(i, { description: e.target.value })} maxLength={200} />
                </td>
                <td className="py-1 pr-2">
                  <Input aria-label={`Amount ${i + 1}`} inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="before GST" />
                </td>
                <td className="py-1 pr-2">
                  <Select aria-label={`GST ${i + 1}`} value={String(l.gstRate)} onChange={(e) => set(i, { gstRate: Number(e.target.value) })}>
                    {[0, 5, 12, 18, 28].map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </Select>
                </td>
                {meta.units.length > 0 && (
                  <td className="py-1 pr-2">
                    <Select aria-label={`Cost centre ${i + 1}`} value={l.costCentreId ?? ""} onChange={(e) => set(i, { costCentreId: e.target.value })}>
                      <option value="">—</option>
                      {meta.units.filter((u) => u.active).map((u) => (
                        <option key={u.id} value={u.id}>{u.code}</option>
                      ))}
                    </Select>
                  </td>
                )}
                <td>{f.lines.length > 1 && <Button size="sm" variant="ghost" aria-label="Remove line" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />}</td>
              </tr>
            ))}
          </tbody>
        </FormLines>
        <button type="button" className="justify-self-start text-[12.5px] font-medium text-muted hover:text-fg" onClick={() => setF({ ...f, lines: [...f.lines, { accountId: "", description: "", amount: "", gstRate: 18 }] })}>
          + Add a line
        </button>
        <div className="grid gap-3 rounded-[14px] bg-surface-2/60 p-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="grid gap-2 text-[13px]">
            <label className="flex items-center gap-2">
              <Switch checked={f.itc} onChange={(v) => setF({ ...f, itc: v })} label="Claim input credit" /> Claim the GST as input credit
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={f.interState} onChange={(v) => setF({ ...f, interState: v })} label="From another state" /> From another state (IGST)
            </label>
          </div>
          <dl className="grid gap-1 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted">Before GST</dt>
              <dd className="tabular-nums">{money(t.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{f.interState ? "IGST" : "CGST + SGST"}</dt>
              <dd className="tabular-nums">{money(t.tax)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(t.total)}</dd>
            </div>
            {foreign && Number(f.fxRate) > 0 && (
              <div className="flex justify-between text-muted">
                <dt>In rupees</dt>
                <dd className="tabular-nums">≈ {inr(inrOf(t.total, f.currency, Number(f.fxRate)))}</dd>
              </div>
            )}
            {section && tdsAmount !== null && (
              <>
                <div className="flex justify-between">
                  <dt className="text-muted">Less TDS</dt>
                  <dd className="tabular-nums">−{inr(tdsAmount)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>To pay them</dt>
                  <dd className="tabular-nums">{inr(t.total - tdsAmount)}</dd>
                </div>
              </>
            )}
          </dl>
        </div>
        {withTds && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="TDS section" hint={f.supplierId ? undefined : "Pick a saved supplier to use their PAN and year so far."}>
              {(a) => (
                <Select {...a} value={section} onChange={(e) => setTds({ section: e.target.value, amount: null })}>
                  <option value="">No TDS</option>
                  {Object.entries(TDS_SECTIONS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </Select>
              )}
            </Field>
            {section && (
              <Field label="TDS to deduct (₹)" hint={tds.amount === null && sug.data?.section === section ? [sug.data.rate ? `${sug.data.rate}%` : "", sug.data.why].filter(Boolean).join(" · ") || "Suggested" : "Changed by hand"}>
                {(a) => <Input {...a} inputMode="decimal" value={tds.amount ?? (tdsAmount !== null ? String(tdsAmount / 100) : "")} onChange={(e) => setTds({ section, amount: e.target.value })} placeholder={sug.isFetching ? "Working it out…" : ""} />}
              </Field>
            )}
          </div>
        )}
        {!expense && <Field label={note ? "Why" : "Notes"}>{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />}</Field>}
      </div>
    </Dialog>
  );
}

type Detail = { bill: Bill; payments: { id: string; accountId: string; account: string; amount: number; date: string; reference: string; fxAmount: number | null; fxDiff: number }[]; receipt: { id: string; number: string } | null; split: { igst: number; cgst: number; sgst: number }; debitNotes: { id: string; number: string; date: string; total: number; status: string }[]; against: { id: string; number: string; billNo: string } | null };

export function BillPage({ id }: { id: string }) {
  const { meta, go } = useAcc();
  const q = useAccQuery<Detail>(`bills/${id}`);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const del = useAccAction<string>((pid) => ({ path: `bills/${id}/payments/${pid}`, method: "DELETE" }), { success: "Payment removed" });
  const voidIt = useAccAction(() => ({ path: `bills/${id}/void` }), { success: "Bill voided", onDone: () => (setVoiding(false), go("bills")) });
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { bill: b, payments, receipt, split, debitNotes, against } = q.data;
  const isNote = b.kind === "debit_note";
  const due = b.due;
  const ready = !["pending_approval", "rejected"].includes(b.status);
  return (
    <div>
      <Link href="/accounts/bills" className="mb-2 inline-flex text-[13px] text-muted hover:text-fg">
        ← Bills & expenses
      </Link>
      <PageHeader
        title={isNote ? `Debit note · ${b.supplierName}` : b.supplierName}
        description={`${b.billNo ? `${isNote ? "Their credit note" : "Bill"} ${b.billNo} · ` : ""}${b.number} · ${fmt(b.date)}${b.dueDate ? ` · due ${fmt(b.dueDate)}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={b.overdue ? "overdue" : b.status} />
            {meta.me.write && b.status !== "void" && (
              <>
                {!b.receiptId && !b.amountPaid && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
                {!isNote && due > 0 && ready && !b.receiptId && <Button size="sm" onClick={() => setCrediting(true)}>Debit note</Button>}
                {!isNote && due > 0 && ready && <Button size="sm" variant="primary" icon={<Wallet className="size-3.5" />} onClick={() => setPaying(true)}>Pay</Button>}
                {!b.receiptId && !b.amountPaid && <Button size="sm" variant="ghost" aria-label="Void bill" icon={<Ban className="size-4" />} onClick={() => setVoiding(true)} />}
              </>
            )}
          </div>
        }
      />
      <div className="mb-4 empty:hidden">
        <ApprovalPanel kind={b.pendingPayment ? "acc.expense" : "acc.bill"} refId={b.id} />
      </div>
      {against && (
        <div className="mb-4">
          <Notice title={`Against ${against.number}${against.billNo ? ` (${against.billNo})` : ""}`}>
            It takes {inr(b.total)} off what you owe on <Link href={`/accounts/bills/${against.id}`} className="font-medium underline">that bill</Link>, and the GST on it comes off your input credit.
          </Notice>
        </div>
      )}
      {b.status === "rejected" && <div className="mb-4"><Notice tone="danger" title="Sent back">Change the bill to send it for approval again, or void it.</Notice></div>}
      {receipt && (
        <div className="mb-4">
          <Notice title="Made from goods received">
            This bill was created from {receipt.number} in Inventory, and follows it. Pay it here.
          </Notice>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <Section title="What it's for">
          <table className="w-full text-[13px]">
            <tbody>
              {b.lines.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2">
                    <Link href={`/accounts/accounts/${l.accountId}`} className="font-medium hover:underline">
                      {accName(meta, l.accountId)}
                    </Link>
                    {l.description && <span className="block text-[12px] text-muted">{l.description}</span>}
                  </td>
                  <td className="py-2 text-right text-muted">{l.gstRate}% GST</td>
                  <td className="py-2 text-right tabular-nums">{inr(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.notes && <p className="mt-3 text-[12.5px] whitespace-pre-line text-muted">{b.notes}</p>}
        </Section>
        <div className="grid content-start gap-5">
          <Section title="Total">
            <dl className="grid gap-1.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted">Before GST</dt>
                <dd className="tabular-nums">{inr(b.subtotal)}</dd>
              </div>
              {b.interState ? (
                <div className="flex justify-between">
                  <dt className="text-muted">IGST</dt>
                  <dd className="tabular-nums">{inr(split.igst)}</dd>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted">CGST</dt>
                    <dd className="tabular-nums">{inr(split.cgst)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">SGST</dt>
                    <dd className="tabular-nums">{inr(split.sgst)}</dd>
                  </div>
                </>
              )}
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-[15px] font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{inr(b.total)}</span>
              </div>
              {!isNote && (
                <>
                  {b.tdsAmount > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted">TDS {b.tdsSection} at {b.tdsRate}%</dt>
                      <dd className="tabular-nums">−{inr(b.tdsAmount)}</dd>
                    </div>
                  )}
                  {b.credited > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted">Debit notes</dt>
                      <dd className="tabular-nums">−{inr(b.credited)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted">Paid</dt>
                    <dd className="tabular-nums">{inr(b.amountPaid)}</dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt>To pay</dt>
                    <dd className="tabular-nums">{inr(due)}</dd>
                  </div>
                </>
              )}
            </dl>
            {b.tdsAmount > 0 && <p className="mt-2 text-[11.5px] text-muted">The TDS is owed to the government — deposit it from Accounts → TDS.</p>}
            <p className="mt-2 text-[11.5px] text-muted">{b.itc ? "GST is claimed as input credit." : "GST isn't claimed — it's part of the cost."}</p>
            {b.currency !== "INR" && b.fxTotal !== null && <p className="mt-1 text-[11.5px] text-muted">{formatMoney(b.fxTotal, b.currency)} at ₹{Number(b.fxRate)} — the rupee amounts above are at that rate.</p>}
          </Section>
          {debitNotes.length > 0 && (
            <Section title="Debit notes">
              <ul className="divide-y divide-border text-[13px]">
                {debitNotes.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/accounts/bills/${d.id}`} className="font-medium hover:underline">{d.number}<span className="block text-[12px] font-normal text-muted">{fmt(d.date)}</span></Link>
                    <span className="flex items-center gap-2 tabular-nums">{inr(d.total)}{["pending_approval", "rejected", "void"].includes(d.status) && <StatusPill status={d.status} />}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {!isNote && <Section title="Payments">
            {!payments.length ? (
              <Empty>Nothing paid yet.</Empty>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {inr(p.amount)} <span className="text-muted">· {p.account}</span>
                      <span className="block text-[12px] text-muted">
                        {fmt(p.date)}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                    </span>
                    {meta.me.write && <Button size="sm" variant="ghost" aria-label="Remove payment" icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(p.id)} />}
                  </li>
                ))}
              </ul>
            )}
          </Section>}
        </div>
      </div>
      {crediting && <BillDialog against={b} onClose={() => setCrediting(false)} onSaved={(nid) => go(`bills/${nid}`)} />}
      {paying && <PayDialog id={id} due={due} foreign={b.currency !== "INR" ? { currency: b.currency, rate: Number(b.fxRate), left: (b.fxTotal ?? 0) - payments.reduce((a, p) => a + (p.fxAmount ?? 0), 0) } : null} onClose={() => setPaying(false)} />}
      {editing && <BillDialog init={b} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} onConfirm={() => voidIt.mutate(undefined)} loading={voidIt.isPending} destructive title={`Void ${b.number}?`} description="It comes out of the books and what you owe. It stays listed as void." confirmLabel="Void bill" />
    </div>
  );
}

function PayDialog({ id, due, foreign, onClose }: { id: string; due: number; foreign: { currency: string; rate: number; left: number } | null; onClose: () => void }) {
  const { meta } = useAcc();
  const [f, setF] = useState({ accountId: meta.settings.defaultBankId ?? "", amount: String(due / 100), date: todayIst(), reference: "", fx: foreign ? String(foreign.left / 10 ** minorDigits(foreign.currency)) : "" });
  const fxAmount = foreign ? (parseMoney(f.fx, foreign.currency) ?? 0) : null;
  const pay = useAccAction(() => ({ path: `bills/${id}/payments`, body: { accountId: f.accountId, date: f.date, reference: f.reference, amount: toPaise(f.amount), fxAmount } }), { success: "Payment recorded", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Pay this bill" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={pay.isPending} disabled={!f.accountId || !toPaise(f.amount)} onClick={() => pay.mutate(undefined)}>Record payment</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From">
          {(a) => (
            <Select {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
              <AccountOptions accounts={meta.accounts} filter={(x) => x.subtype === "bank" || x.subtype === "cash"} />
            </Select>
          )}
        </Field>
        {foreign && <Field label={`Paid (${foreign.currency})`} hint={`${formatMoney(foreign.left, foreign.currency)} still due`}>{(a) => <Input {...a} inputMode="decimal" value={f.fx} onChange={(e) => setF({ ...f, fx: e.target.value })} />}</Field>}
        <Field label={foreign ? "Rupees debited (₹)" : "Amount (₹)"} hint={foreign ? "What the bank took, charges included" : undefined}>{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Reference">{(a) => <Input {...a} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} placeholder="UTR or cheque no." />}</Field>
      </div>
      {foreign && fxAmount !== null && fxAmount > 0 && toPaise(f.amount) > 0 && <FxNote settles={fxAmount >= foreign.left ? due : Math.min(due, inrOf(fxAmount, foreign.currency, foreign.rate))} paid={toPaise(f.amount)} />}
    </Dialog>
  );
}

/** What a foreign payment settles at the bill's rate, and the exchange difference. */
function FxNote({ settles, paid }: { settles: number; paid: number }) {
  const diff = paid - settles;
  return <p className="mt-3 text-[12.5px] text-muted">Settles {inr(settles)} at the bill&apos;s rate{diff ? ` · ${inr(Math.abs(diff))} exchange ${diff > 0 ? "loss" : "gain"}` : ""}.</p>;
}
