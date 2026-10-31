"use client";

// Payroll: monthly runs (check, adjust, finalise, pay, export), the payslip,
// and expense claims.
import { AlertTriangle, ArrowLeft, Banknote, Check, Download, FileText, Pause, Play, Plus, Printer, Receipt, RefreshCw, Trash2, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu } from "@/components/import/buttons";
import { ConfirmDialog, Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";
import { CLAIM_CATEGORIES, mileageAmount, policyCheck } from "@/lib/hr/model";
import { isOn } from "@/lib/workspace/modules";
import { Avatar, Empty, Section, Stat, StatusPill, fmt, fromPaise, hrApi, inr, monthLabel, toPaise, todayIst, useHr, useHrAction, useHrQuery } from "./shared";
import { ApprovalPanel } from "@/components/approvals/card";

type Line = { code: string; label: string; amount: number };
type SlipData = { days: { inMonth: number; employed: number; lop: number; paid: number }; earnings: Line[]; deductions: Line[]; reimbursements: Line[]; employer: Line[]; gross: number; deductionsTotal: number; net: number; cost: number };
type Adj = { label: string; amount: number; kind: "earning" | "deduction" | "reimbursement"; claimId?: string };
type Slip = { id: string; employeeId: string; name: string; empNo: string; designation: string; data: SlipData; adjustments: Adj[]; gross: number; deductions: number; net: number; hold: boolean; bankReady: boolean };
type Run = { id: string; month: string; status: string; totals: Record<string, number>; finalisedAt: string | null; paidAt: string | null; createdAt: string };

export function PayrollView() {
  const { go } = useHr();
  const q = useHrQuery<{ runs: Run[] }>("payroll");
  const now = todayIst().slice(0, 7);
  const [month, setMonth] = useState(now);
  const create = useHrAction<void, { run: Run }>(() => ({ path: "payroll", body: { month } }), { success: "Payroll worked out — check it, then finalise", onDone: (r) => go(`payroll/${r.run.id}`) });
  return (
    <div>
      <PageHeader title="Payroll" description="Each month: salaries from CTC, loss of pay from attendance and unpaid leave, PF, ESI, professional tax and an income-tax estimate, plus bonuses and approved claims." />
      <Section title="Run payroll" className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Month">{(a) => <Input {...a} type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-48" />}</Field>
          <Button variant="primary" icon={<Wallet className="size-4" />} loading={create.isPending} disabled={!month} onClick={() => create.mutate()}>
            Work out {month ? monthLabel(month) : ""}
          </Button>
        </div>
        <p className="mt-3 text-[12px] text-muted">Nothing is paid or sent until you finalise. Income tax is an estimate under the new regime — check with your accountant before filing.</p>
      </Section>
      {!q.data ? (
        <Skeleton className="h-40 rounded-[20px]" />
      ) : !q.data.runs.length ? (
        <EmptyState icon={<Wallet />} title="No payroll runs yet" description="Set each person's CTC on their profile, then work out a month above." />
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Month</th>
                <th className="px-4 py-2.5 text-right font-medium">People</th>
                <th className="px-4 py-2.5 text-right font-medium">Gross</th>
                <th className="px-4 py-2.5 text-right font-medium">Net pay</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost to company</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.runs.map((r) => (
                <tr key={r.id} onClick={() => go(`payroll/${r.id}`)} className="cursor-pointer hover:bg-surface-2">
                  <td className="px-4 py-2.5 font-medium">{monthLabel(r.month)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.totals.employees ?? 0}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.totals.gross)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{inr(r.totals.net)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.totals.cost)}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RunPage({ id }: { id: string }) {
  const { orgId, go } = useHr();
  const q = useHrQuery<{ run: Run; slips: Slip[] }>(`payroll/${id}`);
  const [adjusting, setAdjusting] = useState<Slip | null>(null);
  const [finalising, setFinalising] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const recalc = useHrAction(() => ({ path: `payroll/${id}/recalc` }), { success: "Recalculated with the latest attendance, leave and salaries" });
  const finalise = useHrAction<void, { approval?: string }>(() => ({ path: `payroll/${id}/finalise` }), { success: (r) => (r.approval ? "Sent for approval — it's finalised when approved" : "Finalised — payslips are now visible to everyone"), onDone: () => setFinalising(false) });
  const paid = useHrAction(() => ({ path: `payroll/${id}/paid` }), { success: "Marked as paid" });
  const hold = useHrAction<{ employeeId: string; hold: boolean }>((b) => ({ path: `payroll/${id}/slips/${b.employeeId}`, method: "PUT", body: { hold: b.hold } }), { success: "Updated" });
  const del = useHrAction(() => ({ path: `payroll/${id}`, method: "DELETE" }), { success: "Draft deleted", onDone: () => go("payroll") });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { run, slips } = q.data;
  const t = run.totals;
  const draft = run.status === "draft";
  const noBank = slips.filter((s) => !s.bankReady && !s.hold && s.net > 0).length;
  return (
    <div>
      <Link href="/hr/payroll" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> Payroll
      </Link>
      <PageHeader
        title={`Payroll · ${monthLabel(run.month)}`}
        description={draft ? "A draft — check each person, add bonuses or deductions, then finalise." : run.status === "finalised" ? `Finalised ${fmt(run.finalisedAt?.slice(0, 10))}. Pay salaries from the bank file, then mark it paid.` : `Paid ${fmt(run.paidAt?.slice(0, 10))}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <StatusPill status={run.status} />
            {draft ? (
              <>
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={recalc.isPending} onClick={() => recalc.mutate()}>
                  Recalculate
                </Button>
                <Button size="sm" variant="ghost" aria-label="Delete draft" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} />
                <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={() => setFinalising(true)}>
                  Finalise
                </Button>
              </>
            ) : (
              <>
                <a href={hrApi(orgId, `payroll/${id}/bank`)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
                  <Banknote className="size-3.5" /> Bank file
                </a>
                {run.status === "finalised" && (
                  <Button size="sm" variant="primary" loading={paid.isPending} onClick={() => paid.mutate()}>
                    Mark as paid
                  </Button>
                )}
              </>
            )}
            <a href={hrApi(orgId, `payroll/${id}/register`)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
              <Download className="size-3.5" /> Register
            </a>
          </div>
        }
      />
      <div className="mb-4 empty:hidden">
        <ApprovalPanel kind="hr.payroll" refId={run.id} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net pay" value={inr(t.net)} sub={`${t.employees} people${t.held ? ` · ${t.held} on hold` : ""}`} />
        <Stat label="Gross" value={inr(t.gross)} sub={`${inr(t.deductions)} deducted`} />
        <Stat label="Cost to company" value={inr(t.cost)} sub="gross + employer PF and ESI" />
        <Stat label="Reimbursements" value={inr(t.reimbursements)} sub="approved claims" />
      </div>
      {noBank > 0 && (
        <div className="mb-4">
          <Notice tone="warning">{noBank} {noBank === 1 ? "person has" : "people have"} no bank account or IFSC — they&apos;ll be missing from the bank file until it&apos;s added.</Notice>
        </div>
      )}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="border-b border-border text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 text-right font-medium">Paid days</th>
                <th className="px-3 py-2.5 text-right font-medium">Gross</th>
                <th className="px-3 py-2.5 text-right font-medium">Deductions</th>
                <th className="px-3 py-2.5 text-right font-medium">Net pay</th>
                <th className="w-40 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {slips.map((s) => (
                <tr key={s.id} className={cx(s.hold && "opacity-50")}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={s.name} size={28} />
                      <span className="min-w-0">
                        <b className="block truncate font-medium">{s.name}</b>
                        <span className="block truncate text-[11.5px] text-muted">
                          {s.empNo} · {s.designation || "—"}
                          {s.adjustments.length ? ` · ${s.adjustments.length} extra` : ""}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {s.data.days.paid}/{s.data.days.inMonth}
                    {s.data.days.lop > 0 && <span className="block text-[11px] text-danger">{s.data.days.lop} LOP</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{inr(s.gross)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">{inr(s.deductions)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{inr(s.net)}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex justify-end gap-1">
                      <Link href={`/hr/payslips/${s.id}`} aria-label={`Payslip for ${s.name}`} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
                        <FileText className="size-4" />
                      </Link>
                      {draft && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setAdjusting(s)}>
                            Adjust
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={s.hold ? "Release" : "Hold"} title={s.hold ? "Release" : "Hold this salary"} icon={s.hold ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} onClick={() => hold.mutate({ employeeId: s.employeeId, hold: !s.hold })} />
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Section title="To pay the government" className="self-start 2xl:max-w-none">
          <dl className="grid gap-2 text-[13px]">
            {[
              ["PF (employee 12%)", t.pf],
              ["PF (employer 12%)", t.epf],
              ["ESI (employee 0.75%)", t.esi],
              ["ESI (employer 3.25%)", t.eesi],
              ["Professional tax", t.pt],
              ["TDS (estimate)", t.tds],
            ].map(([l, v]) => (
              <div key={l as string} className="flex justify-between gap-2">
                <dt className="text-muted">{l}</dt>
                <dd className="font-medium tabular-nums">{inr(v as number)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11.5px] text-subtle">Totals to deposit for this month. File the PF ECR, ESI and TDS returns on their portals.</p>
        </Section>
      </div>
      {adjusting && <AdjustDialog runId={id} slip={adjusting} onClose={() => setAdjusting(null)} />}
      <ConfirmDialog open={finalising} onClose={() => setFinalising(false)} onConfirm={() => finalise.mutate()} loading={finalise.isPending} title={`Finalise ${monthLabel(run.month)}?`} description={`Payslips become visible to everyone and the ${slips.filter((s) => s.adjustments.some((a) => a.claimId)).length ? "included claims are marked paid" : "numbers are locked"}. You'll get the bank file next.`} confirmLabel="Finalise" />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title="Delete this draft?" description="Claims in it go back to waiting for the next run." confirmLabel="Delete" />
    </div>
  );
}

function AdjustDialog({ runId, slip, onClose }: { runId: string; slip: Slip; onClose: () => void }) {
  const claims = slip.adjustments.filter((a) => a.claimId);
  const [rows, setRows] = useState(slip.adjustments.filter((a) => !a.claimId).map((a) => ({ ...a, amountText: fromPaise(a.amount) })));
  const save = useHrAction(() => ({ path: `payroll/${runId}/slips/${slip.employeeId}`, method: "PUT", body: { adjustments: rows.filter((r) => r.label.trim() && toPaise(r.amountText) > 0).map((r) => ({ label: r.label, kind: r.kind, amount: toPaise(r.amountText) })) } }), { success: "Payslip updated", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={`Extras for ${slip.name}`} description="One-off lines for this month only: bonus, arrears, incentive, advance recovery…" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-2">
        {claims.map((c) => (
          <p key={c.claimId} className="rounded-[12px] bg-surface-2 px-3 py-2 text-[13px]">
            {c.label} · {inr(c.amount)} <span className="text-muted">(approved claim — paid with salary)</span>
          </p>
        ))}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_150px_120px_32px] gap-2">
            <Input aria-label="What" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Diwali bonus" maxLength={60} />
            <Select aria-label="Kind" value={r.kind} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value as Adj["kind"] } : x)))}>
              <option value="earning">Add (taxable)</option>
              <option value="reimbursement">Reimburse</option>
              <option value="deduction">Deduct</option>
            </Select>
            <Input aria-label="Amount (₹)" inputMode="decimal" value={r.amountText} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amountText: e.target.value } : x)))} placeholder="₹" />
            <Button size="sm" variant="ghost" aria-label="Remove" icon={<X className="size-4" />} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" variant="ghost" className="justify-self-start" icon={<Plus className="size-3.5" />} onClick={() => setRows([...rows, { label: "", kind: "earning", amount: 0, amountText: "" }])}>
          Add a line
        </Button>
      </div>
    </Dialog>
  );
}

type PayslipView = { payslip: { id: string; data: SlipData; hold: boolean }; month: string; status: string; company: { name: string; address: string }; employee: { name: string; empNo: string; designation: string; department: string; joinDate: string; pan: string; uan: string; bank: string; account: string } };

export function PayslipPage({ id }: { id: string }) {
  const { meta } = useHr();
  const q = useHrQuery<PayslipView>(`payslips/${id}`);
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const { payslip: p, month, company, employee: e, status } = q.data;
  const d = p.data;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={meta.me.payroll ? `/hr/payroll` : "/hr/me"} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>
      <article className="rounded-[24px] border border-border bg-white p-8 text-[#18181b] shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b border-[#e4e4e7] pb-4">
          <div>
            <h1 className="text-[20px] font-semibold">{company.name}</h1>
            {company.address && <p className="mt-0.5 max-w-sm text-[12px] whitespace-pre-wrap text-[#71717a]">{company.address}</p>}
          </div>
          <div className="text-right">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-[#71717a] uppercase">Payslip</p>
            <p className="text-[16px] font-semibold">{monthLabel(month)}</p>
            {status === "draft" && <p className="text-[11px] font-semibold text-[#b45309]">DRAFT</p>}
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 border-b border-[#e4e4e7] py-4 text-[12.5px] sm:grid-cols-3">
          {[
            ["Name", e.name],
            ["Employee no", e.empNo],
            ["Designation", e.designation || "—"],
            ["Department", e.department || "—"],
            ["Joined", fmt(String(e.joinDate))],
            ["PAN", e.pan || "—"],
            ["UAN", e.uan || "—"],
            ["Bank", [e.bank, e.account].filter(Boolean).join(" ") || "—"],
            ["Paid days", `${d.days.paid} of ${d.days.inMonth}${d.days.lop ? ` (${d.days.lop} LOP)` : ""}`],
          ].map(([l, v]) => (
            <div key={l}>
              <dt className="text-[#71717a]">{l}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-6 py-4 sm:grid-cols-2">
          <SlipTable title="Earnings" lines={d.earnings} total={d.gross} totalLabel="Gross earnings" />
          <SlipTable title="Deductions" lines={d.deductions} total={d.deductionsTotal} totalLabel="Total deductions" />
        </div>
        {d.reimbursements.length > 0 && <SlipTable title="Reimbursements" lines={d.reimbursements} total={d.reimbursements.reduce((a, l) => a + l.amount, 0)} totalLabel="Total reimbursed" />}
        <div className="mt-4 flex items-center justify-between rounded-[14px] bg-[#f4f4f5] px-4 py-3">
          <span className="text-[13px] font-semibold">Net pay</span>
          <span className="text-[22px] font-semibold tabular-nums">{inr(d.net)}</span>
        </div>
        {d.employer.length > 0 && <p className="mt-3 text-[11.5px] text-[#71717a]">Your employer also contributes {d.employer.map((l) => `${l.label} ${inr(l.amount)}`).join(", ")}.</p>}
        <p className="mt-4 text-[10.5px] text-[#a1a1aa]">Computer-generated payslip; no signature needed. Income tax deducted is an estimate under the new tax regime.</p>
      </article>
    </div>
  );
}

function SlipTable({ title, lines, total, totalLabel }: { title: string; lines: Line[]; total: number; totalLabel: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-[#71717a] uppercase">{title}</p>
      <table className="w-full text-[13px]">
        <tbody>
          {lines.map((l) => (
            <tr key={l.code}>
              <td className="py-1">{l.label}</td>
              <td className="py-1 text-right tabular-nums">{inr(l.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-[#e4e4e7] font-semibold">
            <td className="pt-1.5">{totalLabel}</td>
            <td className="pt-1.5 text-right tabular-nums">{inr(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Claims ───

export type Claim = { id: string; employeeId: string; name: string; kind: string; category: string; amount: number; date: string; description: string; receiptUrl: string; status: string; payrollRunId: string | null; tripId: string | null; paidBy: string; km: number | null; flags: { code: string; message: string }[]; justification: string; decisionNote: string; canDecide: boolean };

export function ClaimsView() {
  const { meta } = useHr();
  const approver = meta.me.payroll || meta.me.isManager || meta.me.manage;
  const [tab, setTab] = useState<"approve" | "all" | "mine">(approver ? "approve" : "mine");
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader
        title="Expense claims"
        description="Travel, food, fuel and other expenses. Approved claims are paid with the next salary."
        actions={meta.me.employeeId ? <Button size="sm" variant="primary" icon={<Receipt className="size-4" />} onClick={() => setAdding(true)}>New claim</Button> : undefined}
      />
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[...(approver ? [{ value: "approve" as const, label: "To approve" }, { value: "all" as const, label: "All claims" }] : []), ...(meta.me.employeeId ? [{ value: "mine" as const, label: "Mine" }] : [])]} />
      {tab === "approve" && <ClaimList status="pending" />}
      {tab === "all" && <ClaimList />}
      {tab === "mine" && <ClaimList mine />}
      {adding && <ClaimDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

export function ClaimList({ status, mine, compact }: { status?: string; mine?: boolean; compact?: boolean }) {
  const { meta } = useHr();
  const q = useHrQuery<{ claims: Claim[] }>(`claims?${new URLSearchParams({ ...(status ? { status } : {}), ...(mine ? { mine: "1" } : {}) })}`);
  const act = useHrAction<{ id: string; action: string }>((b) => ({ path: `claims/${b.id}/decide`, body: { action: b.action } }), { success: "Done" });
  if (!q.data) return <Skeleton className="h-32 rounded-[20px]" />;
  if (!q.data.claims.length) return <Empty>{status === "pending" ? "No claims waiting." : "No claims yet."}</Empty>;
  return (
    <>
    {!compact && (
      <div className="mb-2 flex justify-end">
        <ExportMenu name="claims" columns={[{ key: "name", label: "Person" }, { key: "date", label: "Date" }, { key: "kind", label: "Kind" }, { key: "category", label: "Category" }, { key: "description", label: "Description" }, { key: "amount", label: "Amount", money: true }, { key: "km", label: "Km" }, { key: "paidBy", label: "Paid by" }, { key: "policy", label: "Policy" }, { key: "justification", label: "Reason given" }, { key: "status", label: "Status" }, { key: "receiptUrl", label: "Receipt" }]} rows={q.data.claims.map((c) => ({ ...c, km: c.km ?? "", policy: c.flags.map((x) => x.message).join("; ") }))} />
      </div>
    )}
    <ul className={cx("divide-y divide-border", !compact && "rounded-[20px] border border-border bg-surface px-4 shadow-sm")}>
      {q.data.claims.slice(0, compact ? 6 : 300).map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
          {!compact && <Avatar name={c.name} size={32} />}
          <span className="min-w-0 flex-1">
            {!compact && <b className="block text-[13.5px]">{c.name}</b>}
            <span className="text-[12.5px] text-muted">
              <b className="font-medium text-fg/80">{c.category}</b> · {fmt(c.date, { day: "numeric", month: "short" })}
              {c.description && ` · ${c.description}`}
              {c.km ? ` · ${c.km} km` : ""}
              {c.receiptUrl && (
                <a href={c.receiptUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                  receipt
                </a>
              )}
              {c.paidBy === "company" && <span className="ml-1.5 text-[11.5px] font-semibold text-accent">Company card</span>}
              {c.tripId && <Link href={`/hr/trips/${c.tripId}`} className="ml-1.5 text-[11.5px] font-semibold underline">Trip</Link>}
            </span>
            {c.flags.length > 0 && (
              <span className="mt-0.5 flex items-start gap-1 text-[12px] text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{c.flags.map((x) => x.message).join(". ")}{c.justification ? <span className="text-muted"> — “{c.justification}”</span> : null}</span>
              </span>
            )}
          </span>
          <b className="tabular-nums">{inr(c.amount)}</b>
          <StatusPill status={c.status} />
          {c.canDecide && (
            <span className="flex gap-1.5">
              <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => act.mutate({ id: c.id, action: "approve" })}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" aria-label="Reject" icon={<X className="size-4" />} onClick={() => act.mutate({ id: c.id, action: "reject" })} />
            </span>
          )}
          {meta.me.payroll && c.status === "approved" && !c.payrollRunId && !c.tripId && !compact && (
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: c.id, action: "paid" })}>
              Paid separately
            </Button>
          )}
        </li>
      ))}
    </ul>
    </>
  );
}

/** Open projects to put a claim on, when Projects is switched on and the member can see it. */
function useProjects() {
  const { org } = useSession();
  const on = isOn(org.modules, "work");
  return useQuery({ queryKey: ["work", org.id, "projects?status=open"], queryFn: () => api<{ projects: { id: string; code: string; name: string }[] }>(`/api/v1/orgs/${org.id}/work/projects?status=open`), enabled: on, retry: false }).data?.projects ?? [];
}

/** A new claim: an expense or mileage, on a trip or for a company-card spend, checked against the policy as it's typed. */
export function ClaimDialog({ onClose, tripId, projectId, txn }: { onClose: () => void; tripId?: string; projectId?: string | null; txn?: { id: string; amount: number; date: string; merchant: string } }) {
  const { meta } = useHr();
  const projects = useProjects();
  const policy = meta.settings.expenses;
  const [f, setF] = useState({ kind: "expense" as "expense" | "mileage", category: txn ? "Travel" : CLAIM_CATEGORIES[0], amount: txn ? String(txn.amount / 100) : "", km: "", vehicle: "car" as "car" | "bike", date: txn?.date ?? todayIst(), description: txn?.merchant ?? "", receiptUrl: "", projectId: projectId ?? "", billable: false, justification: "" });
  const amount = f.kind === "mileage" ? mileageAmount(Number(f.km) || 0, f.vehicle, policy) : toPaise(f.amount);
  const flags = f.kind === "expense" && amount ? policyCheck({ category: f.category, amount, receiptUrl: f.receiptUrl }, policy) : [];
  const body = { kind: f.kind, category: f.category, amount, date: f.date, description: f.description, receiptUrl: f.receiptUrl, km: f.kind === "mileage" ? Number(f.km) : null, vehicle: f.kind === "mileage" ? f.vehicle : null, tripId: tripId ?? null, projectId: f.projectId || null, billable: !!f.projectId && f.billable, justification: f.justification };
  const save = useHrAction(() => ({ path: txn ? `card-txns/${txn.id}/explain` : "claims", body }), { success: "Claim sent for approval", onDone: onClose });
  const categories = CLAIM_CATEGORIES.filter((c) => c !== "Mileage" && c !== "Per diem");
  return (
    <Dialog open onClose={onClose} title={txn ? `Explain ${inr(txn.amount)} at ${txn.merchant || "the card"}` : "New expense claim"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={amount < 100 || (flags.length > 0 && !f.justification.trim())} onClick={() => save.mutate()}>Send</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!txn && (
          <Field label="Kind">
            {(a) => (
              <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "expense" | "mileage" })}>
                <option value="expense">An expense</option>
                <option value="mileage" disabled={!policy.mileage.car && !policy.mileage.bike}>Mileage{!policy.mileage.car && !policy.mileage.bike ? " (no rates set)" : ""}</option>
              </Select>
            )}
          </Field>
        )}
        {f.kind === "expense" ? (
          <>
            <Field label="Category">{(a) => <Select {...a} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
            {!txn && <Field label="Amount (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus />}</Field>}
          </>
        ) : (
          <>
            <Field label="Vehicle">{(a) => <Select {...a} value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value as "car" | "bike" })}>{policy.mileage.car > 0 && <option value="car">Car · {inr(policy.mileage.car)}/km</option>}{policy.mileage.bike > 0 && <option value="bike">Two-wheeler · {inr(policy.mileage.bike)}/km</option>}</Select>}</Field>
            <Field label="Kilometres" hint={amount ? `Comes to ${inr(amount)}` : undefined}>{(a) => <Input {...a} inputMode="decimal" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />}</Field>
          </>
        )}
        {!txn && <Field label="Date">{(a) => <Input {...a} type="date" value={f.date} max={todayIst()} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>}
        <Field label="Receipt link (optional)" hint="A photo or PDF in Drive, Dropbox…">{(a) => <Input {...a} type="url" value={f.receiptUrl} onChange={(e) => setF({ ...f, receiptUrl: e.target.value })} placeholder="https://" />}</Field>
        <Field label="What was it for?" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} />}</Field>
        {projects.length > 0 && (
          <Field label="Project (optional)">{(a) => <Select {...a} value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select>}</Field>
        )}
        {f.projectId && <div className="flex items-end pb-2"><Switch checked={f.billable} onChange={(v) => setF({ ...f, billable: v })} label="Bill it to the client" /></div>}
        {flags.length > 0 && (
          <div className="grid gap-2 sm:col-span-2">
            <Notice tone="warning" title="Outside the expense policy">{flags.map((x) => x.message).join(". ")}.{policy.blockOverLimit && flags.some((x) => x.code !== "no_receipt") ? " Claims over a limit aren't accepted." : ""}</Notice>
            <Field label="Why?">{(a) => <Textarea {...a} rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} maxLength={1000} />}</Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
