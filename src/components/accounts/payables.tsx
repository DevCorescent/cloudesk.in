"use client";

// Money in and out beyond single bills: receipts spread over a customer's
// invoices (with advances), payment runs (pick bills, approve, bank file,
// pay), TDS deducted and deposited, and counting a cash box.
import { ArrowLeft, Download, HandCoins, Plus, Send, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApprovalPanel } from "@/components/approvals/card";
import { ExportMenu } from "@/components/import/buttons";
import { ConfirmDialog, Dialog, Segmented } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { TDS_SECTIONS, tdsQuarter } from "@/lib/accounting/tds";
import { AccountOptions, Empty, Section, Stat, StatusPill, accApi, accName, fmt, fromPaise, inr, short, toPaise, todayIst, useAcc, useAccAction, useAccQuery } from "./shared";

const payable = (a: { subtype: string }) => a.subtype === "bank" || a.subtype === "cash";

// ── Receipts ────────────────────────────────────────────────────────────────

type Allocation = { documentId: string; number: string; amount: number; paymentId: string };
type Receipt = { id: string; number: string; ownerId: string; clientId: string; clientName: string; date: string; amount: number; accountId: string; reference: string; advance: number; advanceUsed: number; allocations: Allocation[] };
type OpenInvoice = { id: string; number: string; issue_date: string; due_date: string | null; total: number; paid: number; owed: number };
type ReceiptMeta = { books: { id: string; name: string }[]; clients: { id: string; ownerId: string; name: string; company: string }[] };

export function ReceiptsView() {
  const { meta } = useAcc();
  const q = useAccQuery<{ receipts: Receipt[]; advances: (Receipt & { left: number })[] }>("receipts");
  const [adding, setAdding] = useState(false);
  const [using, setUsing] = useState<(Receipt & { left: number }) | null>(null);
  const [removing, setRemoving] = useState<Receipt | null>(null);
  const del = useAccAction<string>((id) => ({ path: `receipts/${id}`, method: "DELETE" }), { success: "Receipt removed", onDone: () => setRemoving(null) });
  const rows = q.data?.receipts ?? [];
  const adv = q.data?.advances ?? [];
  return (
    <div>
      <PageHeader title="Money received" description="One transfer that covers several invoices, or more than is owed. It's spread over the customer's invoices, and what's left is kept as an advance." actions={<div className="flex gap-2"><ExportMenu name="receipts" rows={rows.map((r) => ({ ...r, account: accName(meta, r.accountId), against: r.allocations.map((a) => a.number).join(" "), advanceLeft: r.advance - r.advanceUsed }))} columns={[{ key: "number", label: "Number" }, { key: "date", label: "Date" }, { key: "clientName", label: "Customer" }, { key: "account", label: "Into" }, { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", money: true }, { key: "against", label: "Invoices" }, { key: "advance", label: "Advance", money: true }, { key: "advanceLeft", label: "Advance left", money: true }]} />{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Record a receipt</Button>}</div>} />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !rows.length ? (
        <EmptyState icon={<HandCoins />} title="No receipts yet" description="When a customer pays, record it here: pick their invoicing books and the account it came into. Payments recorded on an invoice itself still work as before." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Record a receipt</Button> : undefined} />
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Received" value={short(rows.reduce((a, r) => a + r.amount, 0))} sub={`${rows.length} receipt${rows.length === 1 ? "" : "s"}`} />
            <Stat label="Advances unused" value={short(adv.reduce((a, r) => a + r.left, 0))} sub={adv.length ? `${new Set(adv.map((r) => r.clientId)).size} customer(s)` : "None"} />
          </div>
          {adv.length > 0 && (
            <Section title="Advances to use">
              <ul className="divide-y divide-border text-[13px]">
                {adv.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <b className="font-medium">{r.clientName}</b>
                      <span className="block text-[12px] text-muted">{r.number} · {fmt(r.date)} · {inr(r.advance)} advance</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <b className="tabular-nums">{inr(r.left)} left</b>
                      {meta.me.write && <Button size="sm" onClick={() => setUsing(r)}>Use</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Receipts">
            <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="text-left text-[12px] text-muted">
                  <tr>
                    <th className="py-2 font-medium">Customer</th>
                    <th className="py-2 font-medium">Into</th>
                    <th className="py-2 font-medium">Against</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="py-2 text-right font-medium">Advance</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2"><b className="font-medium">{r.clientName}</b><span className="block text-[12px] text-muted">{r.number} · {fmt(r.date)}{r.reference ? ` · ${r.reference}` : ""}</span></td>
                      <td className="py-2 text-muted">{accName(meta, r.accountId)}</td>
                      <td className="py-2 text-[12.5px]">{r.allocations.length ? r.allocations.map((a) => `${a.number} ${inr(a.amount)}`).join(", ") : "—"}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{inr(r.amount)}</td>
                      <td className="py-2 text-right tabular-nums">{r.advance ? `${inr(r.advance - r.advanceUsed)} of ${inr(r.advance)}` : "—"}</td>
                      <td>{meta.me.manage && <Button size="sm" variant="ghost" aria-label={`Remove ${r.number}`} icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(r)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
      {adding && <ReceiveDialog onClose={() => setAdding(false)} />}
      {using && <UseAdvanceDialog r={using} onClose={() => setUsing(null)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && del.mutate(removing.id)} loading={del.isPending} destructive title={`Remove ${removing?.number}?`} description="Its payments come off the invoices (they'll show as unpaid again) and its advance goes. The bank line stays to match again." confirmLabel="Remove receipt" />
    </div>
  );
}

function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const { meta } = useAcc();
  const m = useAccQuery<ReceiptMeta>("receipt-meta");
  const [f, setF] = useState({ ownerId: "", clientId: "", date: todayIst(), amount: "", accountId: meta.settings.defaultBankId ?? "", reference: "" });
  const [mode, setMode] = useState<"oldest" | "choose">("oldest");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const ownerId = f.ownerId || (m.data?.books.length === 1 ? m.data.books[0].id : "");
  const clients = (m.data?.clients ?? []).filter((c) => c.ownerId === ownerId);
  const open = useAccQuery<{ invoices: OpenInvoice[] }>(ownerId && f.clientId ? `receipts-for?ownerId=${ownerId}&clientId=${f.clientId}` : null);
  const invoices = open.data?.invoices ?? [];
  const amount = toPaise(f.amount);
  // Oldest due first, the way the server does it.
  let left = amount;
  const plan = mode === "oldest" ? invoices.map((i) => { const a = Math.min(left, i.owed); left -= a; return { documentId: i.id, amount: a }; }).filter((p) => p.amount) : invoices.map((i) => ({ documentId: i.id, amount: toPaise(picked[i.id] ?? "") })).filter((p) => p.amount);
  const allocated = plan.reduce((a, p) => a + p.amount, 0);
  const over = plan.some((p) => p.amount > (invoices.find((i) => i.id === p.documentId)?.owed ?? 0));
  const save = useAccAction(() => ({ path: "receipts", body: { ...f, ownerId, amount, allocations: mode === "choose" ? plan : [] } }), { success: "Receipt recorded", onDone: onClose });
  const ok = ownerId && f.clientId && amount > 0 && f.accountId && allocated <= amount && !over;
  return (
    <Dialog open onClose={onClose} size="lg" title="Record a receipt" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!ok} onClick={() => save.mutate(undefined)}>Record receipt</Button></>}>
      {m.data && !m.data.books.length ? (
        <Notice title="No invoicing books">Receipts are spread over invoices from Invoicing. Set up invoicing books first.</Notice>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {(m.data?.books.length ?? 0) > 1 && (
              <Field label="Invoicing books">
                {(a) => (
                  <Select {...a} value={ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value, clientId: "" })}>
                    <option value="">Choose…</option>
                    {m.data!.books.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="From customer">
              {(a) => (
                <Select {...a} value={f.clientId} disabled={!ownerId} onChange={(e) => (setF({ ...f, clientId: e.target.value }), setPicked({}))}>
                  <option value="">Choose…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.company || c.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Amount (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
            <Field label="Came into">
              {(a) => (
                <Select {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
                  <option value="">Choose…</option>
                  <AccountOptions accounts={meta.accounts} filter={payable} />
                </Select>
              )}
            </Field>
            <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
            <Field label="Reference">{(a) => <Input {...a} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={120} placeholder="UTR or cheque no." />}</Field>
          </div>
          {f.clientId && (
            <div className="rounded-[14px] border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-medium">Unpaid invoices</p>
                <Segmented label="How to spread it" value={mode} onChange={setMode} options={[{ value: "oldest", label: "Oldest due first" }, { value: "choose", label: "Choose" }]} />
              </div>
              {!open.data ? (
                <Skeleton className="h-16 rounded-[10px]" />
              ) : !invoices.length ? (
                <p className="text-[12.5px] text-muted">Nothing unpaid in rupees — all of it is kept as an advance.</p>
              ) : (
                <table className="w-full text-[13px]">
                  <tbody className="divide-y divide-border">
                    {invoices.map((i) => {
                      const p = plan.find((x) => x.documentId === i.id)?.amount ?? 0;
                      return (
                        <tr key={i.id}>
                          <td className="py-1.5">{i.number}<span className="block text-[12px] text-muted">{i.due_date ? `due ${fmt(i.due_date)}` : fmt(i.issue_date)}</span></td>
                          <td className="py-1.5 text-right text-muted tabular-nums">{inr(i.owed)} owed</td>
                          <td className="w-32 py-1.5 pl-3 text-right tabular-nums">
                            {mode === "oldest" ? (p ? inr(p) : "—") : <Input aria-label={`Amount for ${i.number}`} inputMode="decimal" value={picked[i.id] ?? ""} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.value })} placeholder={fromPaise(i.owed)} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <dl className="mt-3 grid gap-1 border-t border-border pt-2 text-[13px]">
                <div className="flex justify-between"><dt className="text-muted">Against invoices</dt><dd className="tabular-nums">{inr(allocated)}</dd></div>
                <div className={cx("flex justify-between font-semibold", allocated > amount && "text-danger")}><dt>{allocated > amount ? "More than received" : "Kept as an advance"}</dt><dd className="tabular-nums">{inr(Math.abs(amount - allocated))}</dd></div>
              </dl>
              {over && <p className="mt-1 text-[12px] text-danger">An amount is more than what&apos;s owed on that invoice.</p>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function UseAdvanceDialog({ r, onClose }: { r: Receipt & { left: number }; onClose: () => void }) {
  const open = useAccQuery<{ invoices: OpenInvoice[] }>(`receipts-for?ownerId=${r.ownerId}&clientId=${r.clientId}`);
  const [f, setF] = useState({ documentId: "", amount: "", date: todayIst() });
  const inv = open.data?.invoices.find((i) => i.id === f.documentId);
  const apply = useAccAction(() => ({ path: `receipts/${r.id}/apply`, body: { ...f, amount: toPaise(f.amount) } }), { success: "Advance used", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Use ${r.clientName}'s advance`} description={`${inr(r.left)} left from ${r.number}.`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={apply.isPending} disabled={!inv || !toPaise(f.amount)} onClick={() => apply.mutate(undefined)}>Use advance</Button></>}>
      {open.data && !open.data.invoices.length ? (
        <Empty>{r.clientName} has no unpaid invoices to use it on.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Against invoice" className="sm:col-span-2">
            {(a) => (
              <Select {...a} value={f.documentId} onChange={(e) => {
                const i = open.data?.invoices.find((x) => x.id === e.target.value);
                setF({ ...f, documentId: e.target.value, amount: i ? fromPaise(Math.min(i.owed, r.left)) : "" });
              }}>
                <option value="">Choose…</option>
                {open.data?.invoices.map((i) => (
                  <option key={i.id} value={i.id}>{i.number} · {inr(i.owed)} owed</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Amount (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        </div>
      )}
    </Dialog>
  );
}

// ── Payment runs ────────────────────────────────────────────────────────────

type Run = { id: string; number: string; date: string; accountId: string; items: { billId: string; amount: number }[]; total: number; status: string; note: string; paidAt: string | null };
type RunLine = { billId: string; amount: number; number: string; supplier: string; billNo: string; owed: number; bankReady: boolean };
type OpenBill = { id: string; number: string; supplierName: string; billNo: string; dueDate: string | null; status: string; kind: string; due: number; overdue: boolean };

export function PaymentRunsView() {
  const { meta, go } = useAcc();
  const q = useAccQuery<{ runs: Run[] }>("payments");
  const [adding, setAdding] = useState(false);
  const rows = q.data?.runs ?? [];
  return (
    <div>
      <PageHeader title="Payment runs" description="Pick the bills to pay together, get them approved, upload the file to your bank, then mark them paid." actions={<div className="flex gap-2"><ExportMenu name="payment-runs" rows={rows.map((r) => ({ ...r, account: accName(meta, r.accountId), bills: r.items.length }))} columns={[{ key: "number", label: "Number" }, { key: "date", label: "Date" }, { key: "account", label: "From" }, { key: "bills", label: "Bills" }, { key: "total", label: "Total", money: true }, { key: "status", label: "Status" }, { key: "note", label: "Note" }]} />{meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>New run</Button>}</div>} />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !rows.length ? (
        <EmptyState icon={<Send />} title="No payment runs yet" description="Paying many suppliers at once? Start a run from the bills that are due." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>New run</Button> : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[600px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Run</th>
                <th className="px-4 py-2.5 font-medium">From</th>
                <th className="px-4 py-2.5 text-right font-medium">Bills</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => go(`payments/${r.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5"><b className="font-medium">{r.number}</b><span className="block text-[12px] text-muted">{fmt(r.date)}{r.note ? ` · ${r.note}` : ""}</span></td>
                  <td className="px-4 py-2.5 text-muted">{accName(meta, r.accountId)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.items.length}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{inr(r.total)}</td>
                  <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <RunDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function RunDialog({ init, onClose }: { init?: Run; onClose: () => void }) {
  const { meta, go } = useAcc();
  const bills = useAccQuery<{ bills: OpenBill[] }>("bills?status=open");
  const [f, setF] = useState({ date: init?.date ?? todayIst(), accountId: init?.accountId ?? meta.settings.defaultBankId ?? "", note: init?.note ?? "" });
  const [items, setItems] = useState<Record<string, string>>(Object.fromEntries((init?.items ?? []).map((i) => [i.billId, fromPaise(i.amount)])));
  const list = (bills.data?.bills ?? []).filter((b) => b.kind === "bill" && b.due > 0).sort((a, b) => String(a.dueDate ?? "9").localeCompare(String(b.dueDate ?? "9")));
  const chosen = Object.entries(items).map(([billId, v]) => ({ billId, amount: toPaise(v) })).filter((i) => i.amount);
  const total = chosen.reduce((a, i) => a + i.amount, 0);
  const save = useAccAction<void, { run: Run }>(() => ({ path: init ? `payments/${init.id}` : "payments", method: init ? "PUT" : "POST", body: { ...f, items: chosen } }), { success: init ? "Run saved" : "Run started", onDone: (r) => (onClose(), !init && go(`payments/${r.run.id}`)) });
  const toggle = (b: OpenBill) => setItems((x) => {
    const n = { ...x };
    if (b.id in n) delete n[b.id];
    else n[b.id] = fromPaise(b.due);
    return n;
  });
  return (
    <Dialog open onClose={onClose} size="lg" title={init ? `Edit ${init.number}` : "New payment run"} footer={<><span className="mr-auto text-[13px] font-semibold tabular-nums">{chosen.length} bill{chosen.length === 1 ? "" : "s"} · {inr(total)}</span><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!chosen.length || !f.accountId} onClick={() => save.mutate()}>Save run</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Pay from">
            {(a) => (
              <Select {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
                <option value="">Choose…</option>
                <AccountOptions accounts={meta.accounts} filter={payable} />
              </Select>
            )}
          </Field>
          <Field label="Pay on">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Note">{(a) => <Input {...a} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} placeholder="Month-end suppliers" />}</Field>
        </div>
        {!bills.data ? (
          <Skeleton className="h-40 rounded-[14px]" />
        ) : !list.length ? (
          <Empty>No bills are due. Bills waiting for approval join once approved.</Empty>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-[14px] border border-border">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-border">
                {list.map((b) => {
                  const on = b.id in items;
                  return (
                    <tr key={b.id} className={cx(on && "bg-surface-2/60")}>
                      <td className="w-8 py-2 pl-3"><input type="checkbox" aria-label={`Pay ${b.number}`} checked={on} onChange={() => toggle(b)} className="size-4 accent-current" /></td>
                      <td className="py-2"><b className="font-medium">{b.supplierName}</b><span className="block text-[12px] text-muted">{b.billNo || b.number}{b.dueDate ? ` · due ${fmt(b.dueDate, { day: "numeric", month: "short" })}` : ""}{b.overdue ? " · overdue" : ""}</span></td>
                      <td className="py-2 text-right text-muted tabular-nums">{inr(b.due)}</td>
                      <td className="w-32 py-2 pr-3 pl-3">{on && <Input aria-label={`Amount for ${b.number}`} inputMode="decimal" value={items[b.id]} onChange={(e) => setItems({ ...items, [b.id]: e.target.value })} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function RunPage({ id }: { id: string }) {
  const { meta, orgId, go } = useAcc();
  const q = useAccQuery<{ run: Run; lines: RunLine[] }>(`payments/${id}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const submit = useAccAction<void, { status: string }>(() => ({ path: `payments/${id}/submit` }), { success: (r) => (r.status === "approved" ? "Approved — no approval rule applies" : "Sent for approval") });
  const pay = useAccAction(() => ({ path: `payments/${id}/pay` }), { success: "Bills marked paid", onDone: () => setPaying(false) });
  const cancel = useAccAction(() => ({ path: `payments/${id}/cancel` }), { success: "Run cancelled", onDone: () => (setCancelling(false), go("payments")) });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { run: r, lines } = q.data;
  const missingBank = lines.filter((l) => !l.bankReady);
  return (
    <div>
      <Link href="/accounts/payments" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Payment runs</Link>
      <PageHeader
        title={r.number}
        description={`${lines.length} bill${lines.length === 1 ? "" : "s"} · ${inr(r.total)} from ${accName(meta, r.accountId)} on ${fmt(r.date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={r.status} />
            {meta.me.write && r.status === "draft" && (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
                <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={submit.isPending} onClick={() => submit.mutate()}>Send for approval</Button>
              </>
            )}
            {["approved", "paid"].includes(r.status) && <a href={accApi(orgId, `payments/${id}/file`)} download className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> Bank file</a>}
            {meta.me.write && r.status === "approved" && <Button size="sm" variant="primary" icon={<Wallet className="size-3.5" />} onClick={() => setPaying(true)}>Mark paid</Button>}
            {meta.me.write && !["paid", "cancelled"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>Cancel run</Button>}
          </div>
        }
      />
      <div className="mb-4 empty:hidden"><ApprovalPanel kind="acc.payment_run" refId={r.id} /></div>
      {missingBank.length > 0 && r.status !== "paid" && <div className="mb-4"><Notice tone="warning" title={`${missingBank.length} supplier${missingBank.length === 1 ? "" : "s"} without bank details`}>Add their account number and IFSC in Inventory → Suppliers, or the bank file will have empty cells for them.</Notice></div>}
      <Section title="Bills in this run">
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-muted">
            <tr>
              <th className="py-1.5 font-medium">Supplier</th>
              <th className="py-1.5 font-medium">Bill</th>
              <th className="py-1.5 text-right font-medium">{r.status === "paid" ? "" : "Still owed"}</th>
              <th className="py-1.5 text-right font-medium">Paying</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => (
              <tr key={l.billId}>
                <td className="py-2">{l.supplier}{!l.bankReady && <span className="block text-[12px] text-warning">No bank details</span>}</td>
                <td className="py-2"><Link href={`/accounts/bills/${l.billId}`} className="hover:underline">{l.billNo || l.number}</Link></td>
                <td className="py-2 text-right text-muted tabular-nums">{r.status === "paid" ? "" : inr(l.owed)}</td>
                <td className="py-2 text-right font-medium tabular-nums">{inr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <p className="mt-3 text-[12px] text-muted">Cloudesk doesn&apos;t send money. Upload the bank file in your bank&apos;s bulk payment screen, and mark the run paid once the bank has made the payments.</p>
      {editing && <RunDialog init={r} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={paying} onClose={() => setPaying(false)} onConfirm={() => pay.mutate(undefined)} loading={pay.isPending} title={`Mark ${r.number} paid?`} description={`${lines.length} payment${lines.length === 1 ? "" : "s"} of ${inr(r.total)} are recorded from ${accName(meta, r.accountId)} on ${fmt(r.date)}. Only do this once the bank has paid them.`} confirmLabel="Mark paid" />
      <ConfirmDialog open={cancelling} onClose={() => setCancelling(false)} onConfirm={() => cancel.mutate(undefined)} loading={cancel.isPending} destructive title={`Cancel ${r.number}?`} description="The bills stay unpaid, and any approval waiting on it is withdrawn." confirmLabel="Cancel run" />
    </div>
  );
}

// ── TDS ─────────────────────────────────────────────────────────────────────

type TdsReport = {
  quarter: string;
  from: string;
  to: string;
  tan: string;
  sections: { section: string; label: string; deducted: number; deposited: number; due: number }[];
  entries: { id: string; number: string; date: string; supplier: string; pan: string; panValid: boolean; deductee: string; section: string; rate: number; base: number; tds: number }[];
  deposits: { id: string; date: string; section: string; amount: number; accountId: string; challanNo: string; bsrCode: string }[];
};

/** This quarter and the seven before it. */
function quarters() {
  const out: string[] = [];
  let d = todayIst();
  for (let i = 0; i < 8; i++) {
    out.push(tdsQuarter(d));
    const [y, m] = d.split("-").map(Number);
    const back = new Date(Date.UTC(y, m - 1 - 3, 1));
    d = back.toISOString().slice(0, 10);
  }
  return [...new Set(out)];
}

export function TdsView() {
  const { meta, orgId } = useAcc();
  const [quarter, setQuarter] = useState(() => tdsQuarter(todayIst()));
  const q = useAccQuery<TdsReport>(`tds?quarter=${encodeURIComponent(quarter)}`, { keepPrevious: true });
  const [depositing, setDepositing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const del = useAccAction<string>((id) => ({ path: `tds-deposits/${id}`, method: "DELETE" }), { success: "Deposit removed", onDone: () => setRemoving(null) });
  const d = q.data;
  const noPan = d?.entries.filter((e) => !e.panValid) ?? [];
  return (
    <div>
      <PageHeader
        title="TDS"
        description={`Tax deducted from suppliers' bills, and what's been deposited.${meta.settings.tds.tan ? ` TAN ${meta.settings.tds.tan}.` : ""} Cloudesk doesn't file returns — use this to prepare them.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Quarter" className="!w-auto" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              {quarters().map((x) => (
                <option key={x} value={x}>FY {x}</option>
              ))}
            </Select>
            <a href={accApi(orgId, `tds-export?quarter=${encodeURIComponent(quarter)}`)} download className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> Deductions CSV</a>
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setDepositing("")}>Record deposit</Button>}
          </div>
        }
      />
      {!meta.settings.tds.tan && meta.me.manage && <div className="mb-4"><Notice title="Add your TAN">It goes on challans and returns. Add it in Accounts → Settings → TDS.</Notice></div>}
      {!d ? (
        <Skeleton className="h-80 rounded-[20px]" />
      ) : (
        <div className={cx("grid gap-5", q.isFetching && "opacity-80")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Deducted" value={short(d.sections.reduce((a, x) => a + x.deducted, 0))} sub={`${fmt(d.from, { day: "numeric", month: "short" })} – ${fmt(d.to)}`} />
            <Stat label="Deposited" value={short(d.sections.reduce((a, x) => a + x.deposited, 0))} />
            <Stat label="Still to deposit" value={short(d.sections.reduce((a, x) => a + Math.max(0, x.due), 0))} sub="Due by the 7th of the next month" />
          </div>
          {noPan.length > 0 && <Notice tone="warning" title={`${noPan.length} deduction${noPan.length === 1 ? "" : "s"} without a valid PAN`}>These were charged at least 20%. Add the supplier&apos;s PAN in Inventory → Suppliers for future bills.</Notice>}
          <Section title="By section">
            {!d.sections.length ? (
              <Empty>No TDS this quarter.</Empty>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-right text-[12px] text-muted">
                  <tr>
                    <th className="py-1.5 text-left font-medium">Section</th>
                    <th className="py-1.5 font-medium">Deducted</th>
                    <th className="py-1.5 font-medium">Deposited</th>
                    <th className="py-1.5 font-medium">To deposit</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-right tabular-nums">
                  {d.sections.map((x) => (
                    <tr key={x.section}>
                      <td className="py-2 text-left">{x.label}</td>
                      <td className="py-2">{inr(x.deducted)}</td>
                      <td className="py-2">{inr(x.deposited)}</td>
                      <td className={cx("py-2 font-semibold", x.due > 0 && "text-warning")}>{inr(x.due)}</td>
                      <td className="py-2">{meta.me.write && x.due > 0 && <Button size="sm" onClick={() => setDepositing(x.section)}>Deposit</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          <Section title="Deductions">
            {!d.entries.length ? (
              <Empty>No bills with TDS this quarter.</Empty>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead className="text-left text-[12px] text-muted">
                    <tr>
                      <th className="py-1.5 font-medium">Supplier</th>
                      <th className="py-1.5 font-medium">PAN</th>
                      <th className="py-1.5 font-medium">Section</th>
                      <th className="py-1.5 text-right font-medium">Paid / credited</th>
                      <th className="py-1.5 text-right font-medium">Rate</th>
                      <th className="py-1.5 text-right font-medium">TDS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.entries.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2"><Link href={`/accounts/bills/${e.id}`} className="font-medium hover:underline">{e.supplier}</Link><span className="block text-[12px] text-muted">{e.number} · {fmt(e.date)}</span></td>
                        <td className={cx("py-2 font-mono text-[12px]", !e.panValid && "text-danger")}>{e.pan || "No PAN"}</td>
                        <td className="py-2">{e.section}</td>
                        <td className="py-2 text-right tabular-nums">{inr(e.base)}</td>
                        <td className="py-2 text-right tabular-nums">{e.rate}%</td>
                        <td className="py-2 text-right font-medium tabular-nums">{inr(e.tds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title="Deposits">
            {!d.deposits.length ? (
              <Empty>Nothing deposited for this quarter yet.</Empty>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {d.deposits.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{inr(x.amount)} <span className="text-muted">· {x.section} · from {accName(meta, x.accountId)}</span><span className="block text-[12px] text-muted">{fmt(x.date)}{x.challanNo ? ` · challan ${x.challanNo}` : ""}{x.bsrCode ? ` · BSR ${x.bsrCode}` : ""}</span></span>
                    {meta.me.manage && <Button size="sm" variant="ghost" aria-label="Remove deposit" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(x.id)} />}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
      {depositing !== null && <DepositDialog section={depositing} due={d?.sections.find((x) => x.section === depositing)?.due ?? 0} onClose={() => setDepositing(null)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && del.mutate(removing)} loading={del.isPending} destructive title="Remove this deposit?" description="Its posting comes out of the books, and the TDS shows as still to deposit." confirmLabel="Remove" />
    </div>
  );
}

function DepositDialog({ section, due, onClose }: { section: string; due: number; onClose: () => void }) {
  const { meta } = useAcc();
  const [f, setF] = useState({ section: section || Object.keys(TDS_SECTIONS)[0], amount: fromPaise(due), date: todayIst(), accountId: meta.settings.defaultBankId ?? "", challanNo: "", bsrCode: "" });
  const save = useAccAction(() => ({ path: "tds-deposits", body: { ...f, amount: toPaise(f.amount) } }), { success: "Deposit recorded", onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Record a TDS deposit" description="Tax you've paid to the government (challan ITNS 281). It clears TDS owed in the books." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!toPaise(f.amount) || !f.accountId} onClick={() => save.mutate(undefined)}>Record deposit</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Section">
          {(a) => (
            <Select {...a} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>
              {Object.entries(TDS_SECTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Amount (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Paid from">
          {(a) => (
            <Select {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
              <option value="">Choose…</option>
              <AccountOptions accounts={meta.accounts} filter={payable} />
            </Select>
          )}
        </Field>
        <Field label="Paid on">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Challan no.">{(a) => <Input {...a} value={f.challanNo} onChange={(e) => setF({ ...f, challanNo: e.target.value })} maxLength={20} />}</Field>
        <Field label="BSR code">{(a) => <Input {...a} value={f.bsrCode} onChange={(e) => setF({ ...f, bsrCode: e.target.value })} maxLength={10} />}</Field>
      </div>
    </Dialog>
  );
}

// ── Petty cash ──────────────────────────────────────────────────────────────

export function CashCountDialog({ account, onClose }: { account: { id: string; name: string; balance: number }; onClose: () => void }) {
  const [f, setF] = useState({ counted: fromPaise(account.balance), date: todayIst(), note: "" });
  const diff = toPaise(f.counted) - account.balance;
  const save = useAccAction<void, { difference: number }>(() => ({ path: "cash-count", body: { accountId: account.id, date: f.date, counted: toPaise(f.counted), note: f.note } }), { success: (r) => (!r.difference ? "Counted — it matches the books" : `Counted — ${inr(Math.abs(r.difference))} ${r.difference > 0 ? "over" : "short"} posted`), onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Count ${account.name}`} description={`The books say ${inr(account.balance)} today. Any difference posts to “Cash short or over”.`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save count</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cash in the box (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.counted} onChange={(e) => setF({ ...f, counted: e.target.value })} />}</Field>
        <Field label="Counted on" hint="The books are compared as of this day.">{(a) => <Input {...a} type="date" value={f.date} max={todayIst()} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Note" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} />}</Field>
      </div>
      {f.date === todayIst() && diff !== 0 && <p className={cx("mt-3 text-[13px] font-medium", diff < 0 ? "text-danger" : "text-success")}>{inr(Math.abs(diff))} {diff < 0 ? "short" : "over"}</p>}
    </Dialog>
  );
}
