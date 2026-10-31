"use client";

// Fixed assets (register, depreciation schedule, disposal), repeating and
// spread journals, budgets against actual, and the cash flow statement and
// cash forecast.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { ConfirmDialog, Dialog } from "@/components/ui/overlays";
import { Badge, Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { ASSET_METHODS, METHOD_LABEL, addMonths } from "@/lib/accounting/finance";
import { target } from "@/lib/import/targets";
import { AccountOptions, Empty, Section, Stat, accApi, accName, fmt, fromPaise, inr, short, toPaise, todayIst, useAcc, useAccAction, useAccQuery, useSliceQs } from "./shared";

// ── Fixed assets ────────────────────────────────────────────────────────────

type Asset = { id: string; code: string; name: string; category: string; assetAccountId: string; purchaseDate: string; inUseDate: string; cost: number; residual: number; method: (typeof ASSET_METHODS)[number]; lifeMonths: number; rate: number; status: "active" | "disposed"; disposedOn: string | null; disposalAmount: number | null; companyId: string | null; branchId: string | null; costCentreId: string | null; serial: string; location: string; notes: string; accumulated: number; bookValue: number };

export function AssetsView() {
  const { meta, orgId } = useAcc();
  const qc = useQueryClient();
  const q = useAccQuery<{ assets: Asset[] }>("assets");
  const [adding, setAdding] = useState(false);
  const rows = q.data?.assets ?? [];
  const active = rows.filter((a) => a.status === "active");
  return (
    <div>
      <PageHeader
        title="Fixed assets"
        description="What the business owns for the long run, and its depreciation — posted every month by itself."
        actions={
          <div className="flex gap-2">
            <ExportMenu name="fixed-assets" columns={[{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "inUseDate", label: "In use from" }, { key: "cost", label: "Cost", money: true }, { key: "accumulated", label: "Depreciation to date", money: true }, { key: "bookValue", label: "Book value", money: true }, { key: "method", label: "Method" }, { key: "status", label: "Status" }]} rows={rows} />
            {meta.me.write && <ImportButton target={target("accounts.assets")} onImport={(r, mode) => api(accApi(orgId, "assets/import"), { method: "POST", body: { rows: r, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["acc", orgId] })} />}
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Asset</Button>}
          </div>
        }
      />
      {!q.data ? (
        <Skeleton className="h-[50vh] rounded-[24px]" />
      ) : !rows.length ? (
        <EmptyState title="No fixed assets yet" description="Computers, vehicles, furniture, machines. Record what you paid on a bill as usual, then add the asset here so its depreciation posts every month." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add an asset</Button> : undefined} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Cost" value={short(active.reduce((n, a) => n + a.cost, 0))} sub={`${active.length} in use`} />
            <Stat label="Depreciation to date" value={short(active.reduce((n, a) => n + a.accumulated, 0))} />
            <Stat label="Book value" value={short(active.reduce((n, a) => n + a.bookValue, 0))} />
          </div>
          <Section title="Register">
            <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="text-right text-[12px] text-muted">
                    <th className="py-2 text-left font-medium">Asset</th>
                    <th className="py-2 text-left font-medium">Method</th>
                    <th className="py-2 font-medium">Cost</th>
                    <th className="py-2 font-medium">Depreciation</th>
                    <th className="py-2 font-medium">Book value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-right tabular-nums">
                  {rows.map((a) => (
                    <tr key={a.id} className={cx(a.status === "disposed" && "text-muted")}>
                      <td className="py-2 text-left"><Link href={`/accounts/assets/${a.id}`} className="font-medium hover:underline">{a.code} · {a.name}</Link><span className="block text-[12px] text-muted">{a.category || "—"} · in use {fmt(a.inUseDate)}{a.status === "disposed" ? ` · disposed ${fmt(a.disposedOn)}` : ""}</span></td>
                      <td className="py-2 text-left text-[12.5px]">{METHOD_LABEL[a.method]}{a.method === "slm" ? ` · ${Math.round(a.lifeMonths / 12 * 10) / 10} yrs` : a.method === "wdv" ? ` · ${a.rate}%` : ""}</td>
                      <td className="py-2">{inr(a.cost)}</td>
                      <td className="py-2">{inr(a.accumulated)}</td>
                      <td className="py-2 font-semibold">{a.status === "disposed" ? "—" : inr(a.bookValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <p className="mt-3 text-[12px] text-muted">The register posts depreciation and disposals only. An asset&apos;s cost is posted by the bill or journal it was bought on — for assets you had before Cloudesk, post their cost as an opening balance.</p>
        </>
      )}
      {adding && <AssetDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AssetDialog({ init, onClose }: { init?: Asset; onClose: () => void }) {
  const { meta, go } = useAcc();
  const fixed = meta.accounts.find((a) => a.systemKey === "fixed_assets")?.id ?? "";
  const [f, setF] = useState({ name: init?.name ?? "", code: init?.code ?? "", category: init?.category ?? "", assetAccountId: init?.assetAccountId ?? fixed, purchaseDate: init?.purchaseDate ?? todayIst(), inUseDate: init?.inUseDate ?? todayIst(), cost: fromPaise(init?.cost), residual: fromPaise(init?.residual), method: init?.method ?? "slm", lifeYears: init ? String(init.lifeMonths / 12) : "5", rate: init?.rate ? String(init.rate) : "", companyId: init?.companyId ?? "", branchId: init?.branchId ?? "", costCentreId: init?.costCentreId ?? "", serial: init?.serial ?? "", location: init?.location ?? "", notes: init?.notes ?? "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = useAccAction<void, { asset: { id: string } }>(() => ({ path: init ? `assets/${init.id}` : "assets", method: init ? "PUT" : "POST", body: { ...f, cost: toPaise(f.cost), residual: toPaise(f.residual), lifeMonths: Math.max(1, Math.round(Number(f.lifeYears || 0) * 12)), rate: Number(f.rate) || 0, companyId: f.companyId || null, branchId: f.branchId || null, costCentreId: f.costCentreId || null } }), { success: init ? "Asset saved" : "Asset added — depreciation is posting", onDone: (r) => (onClose(), !init && go(`assets/${r.asset.id}`)) });
  return (
    <Dialog open onClose={onClose} size="lg" title={init ? `Edit ${init.code}` : "New fixed asset"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !toPaise(f.cost)} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(a) => <Input {...a} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="MacBook Pro 14" />}</Field>
        <Field label="Category">{(a) => <Input {...a} value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="Computers" />}</Field>
        <Field label="Account">
          {(a) => (
            <Select {...a} value={f.assetAccountId} onChange={(e) => set({ assetAccountId: e.target.value })}>
              <AccountOptions accounts={meta.accounts} filter={(x) => x.subtype === "fixed" && x.systemKey !== "acc_dep"} />
            </Select>
          )}
        </Field>
        <Field label="Cost (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} />}</Field>
        <Field label="Bought on">{(a) => <Input {...a} type="date" value={f.purchaseDate} onChange={(e) => set({ purchaseDate: e.target.value, inUseDate: f.inUseDate < e.target.value ? e.target.value : f.inUseDate })} />}</Field>
        <Field label="In use from" hint="Depreciation starts this day">{(a) => <Input {...a} type="date" value={f.inUseDate} min={f.purchaseDate} onChange={(e) => set({ inUseDate: e.target.value })} />}</Field>
        <Field label="Method">
          {(a) => (
            <Select {...a} value={f.method} onChange={(e) => set({ method: e.target.value as Asset["method"] })}>
              {ASSET_METHODS.map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </Select>
          )}
        </Field>
        {f.method === "slm" && <Field label="Useful life (years)">{(a) => <Input {...a} inputMode="decimal" value={f.lifeYears} onChange={(e) => set({ lifeYears: e.target.value })} />}</Field>}
        {f.method === "wdv" && <Field label="Yearly rate (%)" hint="e.g. 40% for computers under the Companies Act">{(a) => <Input {...a} inputMode="decimal" value={f.rate} onChange={(e) => set({ rate: e.target.value })} />}</Field>}
        {f.method === "none" && <div />}
        <Field label="Residual value (₹)" hint="What it'll be worth at the end">{(a) => <Input {...a} inputMode="decimal" value={f.residual} onChange={(e) => set({ residual: e.target.value })} />}</Field>
        {meta.units.length > 0 && (
          <Field label="Cost centre">
            {(a) => (
              <Select {...a} value={f.costCentreId} onChange={(e) => set({ costCentreId: e.target.value })}>
                <option value="">—</option>
                {meta.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {meta.branches.length > 0 && (
          <Field label="Branch">
            {(a) => (
              <Select {...a} value={f.branchId} onChange={(e) => set({ branchId: e.target.value })}>
                <option value="">—</option>
                {meta.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Serial no.">{(a) => <Input {...a} value={f.serial} onChange={(e) => set({ serial: e.target.value })} />}</Field>
        <Field label="Kept at">{(a) => <Input {...a} value={f.location} onChange={(e) => set({ location: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function AssetPage({ id }: { id: string }) {
  const { meta, go } = useAcc();
  const q = useAccQuery<{ asset: Asset; schedule: { month: string; amount: number; accumulated: number; bookValue: number; posted: boolean }[] }>(`assets/${id}`);
  const [editing, setEditing] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const undo = useAccAction(() => ({ path: `assets/${id}/undispose` }), { success: "Disposal undone" });
  const del = useAccAction(() => ({ path: `assets/${id}`, method: "DELETE" }), { success: "Asset deleted", onDone: () => go("assets") });
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const { asset: a, schedule } = q.data;
  const thisYear = schedule.filter((r) => r.month >= meta.fy.from.slice(0, 7) && r.month <= meta.fy.to.slice(0, 7));
  return (
    <div>
      <Link href="/accounts/assets" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Fixed assets</Link>
      <PageHeader
        title={`${a.code} · ${a.name}`}
        description={`${METHOD_LABEL[a.method]} · ${accName(meta, a.assetAccountId)} · in use from ${fmt(a.inUseDate)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {a.status === "disposed" ? <Badge>Disposed {fmt(a.disposedOn)}</Badge> : <Badge tone="success">In use</Badge>}
            {meta.me.write && a.status === "active" && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
            {meta.me.manage && a.status === "active" && <Button size="sm" onClick={() => setDisposing(true)}>Sell or scrap</Button>}
            {meta.me.manage && a.status === "disposed" && <Button size="sm" loading={undo.isPending} onClick={() => undo.mutate(undefined)}>Undo disposal</Button>}
            {meta.me.manage && <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>Delete</Button>}
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cost" value={inr(a.cost)} sub={`bought ${fmt(a.purchaseDate)}`} />
        <Stat label="Depreciation to date" value={inr(a.accumulated)} />
        <Stat label="Book value" value={a.status === "disposed" ? "—" : inr(a.bookValue)} />
        <Stat label={`FY ${meta.fy.label}`} value={inr(thisYear.reduce((n, r) => n + r.amount, 0))} sub="depreciation for the year" />
      </div>
      <Section title="Depreciation schedule">
        {!schedule.length ? (
          <Empty>This asset isn&apos;t depreciated.</Empty>
        ) : (
          <div className="-mx-4 max-h-[480px] overflow-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-right text-[12px] text-muted">
                  <th className="py-2 text-left font-medium">Month</th>
                  <th className="py-2 font-medium">Depreciation</th>
                  <th className="py-2 font-medium">To date</th>
                  <th className="py-2 font-medium">Book value</th>
                  <th className="py-2 font-medium">In the books</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-right tabular-nums">
                {schedule.map((r) => (
                  <tr key={r.month}>
                    <td className="py-1.5 text-left">{fmt(`${r.month}-01`, { month: "short", year: "numeric" })}</td>
                    <td className="py-1.5">{inr(r.amount)}</td>
                    <td className="py-1.5">{inr(r.accumulated)}</td>
                    <td className="py-1.5">{inr(r.bookValue)}</td>
                    <td className={cx("py-1.5 text-[12px]", r.posted ? "text-success" : "text-muted")}>{r.posted ? "Posted" : "Later"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {editing && <AssetDialog init={a} onClose={() => setEditing(false)} />}
      {disposing && <DisposeDialog a={a} onClose={() => setDisposing(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title={`Delete ${a.code}?`} description="Its depreciation entries are removed from the books too. To keep the history, sell or scrap it instead." confirmLabel="Delete" destructive loading={del.isPending} onConfirm={() => del.mutate(undefined)} />
    </div>
  );
}

function DisposeDialog({ a, onClose }: { a: Asset; onClose: () => void }) {
  const { meta } = useAcc();
  const [f, setF] = useState({ date: todayIst(), amount: "", accountId: meta.settings.defaultBankId ?? "" });
  const go = useAccAction<void, { gain: number; bookValue: number }>(() => ({ path: `assets/${a.id}/dispose`, body: { date: f.date, amount: toPaise(f.amount), accountId: toPaise(f.amount) ? f.accountId || null : null } }), { success: (r) => (r.gain >= 0 ? `Disposed of — a gain of ${inr(r.gain)}` : `Disposed of — a loss of ${inr(-r.gain)}`), onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`Sell or scrap ${a.code}`} description="Depreciation runs to this day; its cost and depreciation leave the books, and any difference from what you got is a gain or loss." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} onClick={() => go.mutate()}>Dispose of it</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">{(x) => <Input {...x} type="date" value={f.date} min={a.inUseDate} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Sold for (₹)" hint="Leave blank if scrapped">{(x) => <Input {...x} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        {toPaise(f.amount) > 0 && (
          <Field label="Money went into" className="sm:col-span-2">
            {(x) => (
              <Select {...x} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
                <option value="">Pick an account</option>
                <AccountOptions accounts={meta.accounts} filter={(c) => c.subtype === "bank" || c.subtype === "cash"} />
              </Select>
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

// ── Repeating and spread journals ───────────────────────────────────────────

type Schedule = { id: string; kind: "recurring" | "spread"; name: string; lines: { accountId: string; debit: number; credit: number }[]; every: string; startDate: string; endDate: string | null; autoReverse: boolean; total: number; months: number; fromAccountId: string | null; toAccountId: string | null; active: boolean };

export function SchedulesView() {
  const { meta } = useAcc();
  const q = useAccQuery<{ schedules: Schedule[] }>("schedules");
  const [adding, setAdding] = useState<"recurring" | "spread" | null>(null);
  const stop = useAccAction<string>((id) => ({ path: `schedules/${id}/stop` }), { success: "Stopped — what's posted stays" });
  return (
    <div>
      <PageHeader
        title="Repeating & spread"
        description="Journals that post themselves: the same entry every month (accruals that reverse next month), or a payment spread over the months it covers."
        actions={
          meta.me.write && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setAdding("spread")}>Spread a payment</Button>
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding("recurring")}>Repeating journal</Button>
            </div>
          )
        }
      />
      {!q.data ? (
        <Skeleton className="h-[40vh] rounded-[24px]" />
      ) : !q.data.schedules.length ? (
        <EmptyState title="Nothing repeats yet" description="Accrue rent or power each month end (reversed on the 1st), or spread a year's insurance or software paid up front over twelve months." />
      ) : (
        <ul className="grid gap-2">
          {q.data.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-surface p-3.5 text-[13px] shadow-sm">
              <span className="min-w-0 flex-1">
                <b className="flex items-center gap-2 font-semibold">{s.name}{!s.active && <Badge>Stopped</Badge>}</b>
                <span className="text-[12px] text-muted">
                  {s.kind === "recurring"
                    ? `Every ${s.every} from ${fmt(s.startDate)}${s.endDate ? ` to ${fmt(s.endDate)}` : ""} · ${inr(s.lines.reduce((n, l) => n + l.debit, 0))}${s.autoReverse ? " · reverses next period" : ""}`
                    : `${inr(s.total)} over ${s.months} months from ${fmt(s.startDate, { month: "short", year: "numeric" })} · ${accName(meta, s.fromAccountId)} → ${accName(meta, s.toAccountId)}`}
                </span>
              </span>
              {s.active && meta.me.write && <Button size="sm" variant="ghost" icon={<Square className="size-3.5" />} onClick={() => stop.mutate(s.id)}>Stop</Button>}
            </li>
          ))}
        </ul>
      )}
      {adding && <ScheduleDialog kind={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function ScheduleDialog({ kind, onClose }: { kind: "recurring" | "spread"; onClose: () => void }) {
  const { meta } = useAcc();
  const [f, setF] = useState({ name: "", every: "month", startDate: todayIst(), endDate: "", autoReverse: true, debitAccount: "", creditAccount: meta.accounts.find((a) => a.systemKey === "accrued")?.id ?? "", amount: "", total: "", months: "12", fromAccountId: meta.accounts.find((a) => a.systemKey === "prepaid")?.id ?? "", toAccountId: "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const body =
    kind === "recurring"
      ? { kind, name: f.name, every: f.every, startDate: f.startDate, endDate: f.endDate || null, autoReverse: f.autoReverse, lines: [{ accountId: f.debitAccount, debit: toPaise(f.amount), credit: 0 }, { accountId: f.creditAccount, debit: 0, credit: toPaise(f.amount) }] }
      : { kind, name: f.name, total: toPaise(f.total), months: Number(f.months), startDate: f.startDate, fromAccountId: f.fromAccountId, toAccountId: f.toAccountId };
  const save = useAccAction(() => ({ path: "schedules", body }), { success: "Saved — entries due so far are posted", onDone: onClose });
  const ok = f.name.trim() && (kind === "recurring" ? f.debitAccount && f.creditAccount && toPaise(f.amount) : f.fromAccountId && f.toAccountId && toPaise(f.total) && Number(f.months) > 0);
  return (
    <Dialog open onClose={onClose} size="lg" title={kind === "recurring" ? "Repeating journal" : "Spread a payment"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={kind === "recurring" ? "Rent accrual" : "Annual insurance"} />}</Field>
        {kind === "recurring" ? (
          <>
            <Field label="Debit">{(a) => <Select {...a} value={f.debitAccount} onChange={(e) => set({ debitAccount: e.target.value })}><option value="">Choose…</option><AccountOptions accounts={meta.accounts} /></Select>}</Field>
            <Field label="Credit">{(a) => <Select {...a} value={f.creditAccount} onChange={(e) => set({ creditAccount: e.target.value })}><option value="">Choose…</option><AccountOptions accounts={meta.accounts} /></Select>}</Field>
            <Field label="Amount (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />}</Field>
            <Field label="Every">{(a) => <Select {...a} value={f.every} onChange={(e) => set({ every: e.target.value })}><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></Select>}</Field>
            <Field label="First date" hint="Then the same day each period">{(a) => <Input {...a} type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />}</Field>
            <Field label="Last date" hint="Optional">{(a) => <Input {...a} type="date" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} />}</Field>
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" checked={f.autoReverse} onChange={(e) => set({ autoReverse: e.target.checked })} className="accent-[var(--accent)]" /> Reverse it on the 1st of the next period (for accruals)</label>
          </>
        ) : (
          <>
            <Field label="Total (₹)">{(a) => <Input {...a} inputMode="decimal" value={f.total} onChange={(e) => set({ total: e.target.value })} />}</Field>
            <Field label="Over (months)">{(a) => <Input {...a} type="number" min={1} max={120} value={f.months} onChange={(e) => set({ months: e.target.value })} />}</Field>
            <Field label="First month">{(a) => <Input {...a} type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />}</Field>
            <div className="text-[12px] text-muted sm:pt-7">{Number(f.months) > 0 && toPaise(f.total) ? `${inr(Math.floor(toPaise(f.total) / Number(f.months)))} a month until ${fmt(`${addMonths(f.startDate.slice(0, 7), Number(f.months) - 1)}-01`, { month: "short", year: "numeric" })}` : ""}</div>
            <Field label="Paid into (prepaid)">{(a) => <Select {...a} value={f.fromAccountId} onChange={(e) => set({ fromAccountId: e.target.value })}><AccountOptions accounts={meta.accounts} /></Select>}</Field>
            <Field label="Spread to">{(a) => <Select {...a} value={f.toAccountId} onChange={(e) => set({ toAccountId: e.target.value })}><option value="">Choose…</option><AccountOptions accounts={meta.accounts} filter={(x) => x.type === "expense"} /></Select>}</Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Budgets ─────────────────────────────────────────────────────────────────

type Budget = { id: string; name: string; year: string; companyId: string | null; costCentreId: string | null; amounts: Record<string, Record<string, number>> };
type Vs = { budget: Budget; months: string[]; rows: { id: string; code: string; name: string; type: string; months: { month: string; budget: number; actual: number; past: boolean }[]; ytdBudget: number; ytdActual: number; variance: number; yearBudget: number }[] };

export function BudgetsView({ id }: { id?: string }) {
  const { meta } = useAcc();
  const q = useAccQuery<{ budgets: Budget[] }>("budgets");
  const [editing, setEditing] = useState<Budget | "new" | null>(null);
  if (id) return <BudgetPage id={id} onEdit={(b) => setEditing(b)} editing={editing} close={() => setEditing(null)} />;
  return (
    <div>
      <PageHeader title="Budgets" description="Plan income and costs by month, then see how the year is going against the plan." actions={meta.me.manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Budget</Button>} />
      {!q.data ? (
        <Skeleton className="h-40 rounded-[24px]" />
      ) : !q.data.budgets.length ? (
        <EmptyState title="No budgets yet" description="A plan for the year — for the whole business, one company, or one cost centre." />
      ) : (
        <ul className="grid gap-2">
          {q.data.budgets.map((b) => (
            <li key={b.id}>
              <Link href={`/accounts/budgets/${b.id}`} className="flex items-center gap-3 rounded-[16px] border border-border bg-surface p-3.5 text-[13px] shadow-sm hover:bg-surface-2/50">
                <span className="min-w-0 flex-1"><b className="font-semibold">{b.name}</b><span className="block text-[12px] text-muted">FY {b.year}{b.companyId ? ` · ${meta.companies.find((c) => c.id === b.companyId)?.name}` : ""}{b.costCentreId ? ` · ${meta.units.find((u) => u.id === b.costCentreId)?.code}` : ""} · {Object.keys(b.amounts).length} accounts</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {editing && <BudgetDialog init={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BudgetPage({ id, onEdit, editing, close }: { id: string; onEdit: (b: Budget) => void; editing: Budget | "new" | null; close: () => void }) {
  const { meta } = useAcc();
  const q = useAccQuery<Vs>(`budgets/${id}`);
  if (!q.data) return <Skeleton className="h-[60vh] rounded-[24px]" />;
  const d = q.data;
  const income = d.rows.filter((r) => r.type === "income");
  const costs = d.rows.filter((r) => r.type !== "income");
  const sum = (rows: Vs["rows"], k: "ytdBudget" | "ytdActual") => rows.reduce((n, r) => n + r[k], 0);
  return (
    <div>
      <Link href="/accounts/budgets" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Budgets</Link>
      <PageHeader title={d.budget.name} description={`FY ${d.budget.year} · year to date against the plan`} actions={meta.me.manage && <Button size="sm" onClick={() => onEdit(d.budget)}>Edit amounts</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Income so far" value={short(sum(income, "ytdActual"))} sub={`plan ${short(sum(income, "ytdBudget"))}`} tone={sum(income, "ytdActual") >= sum(income, "ytdBudget") ? "good" : "warn"} />
        <Stat label="Costs so far" value={short(sum(costs, "ytdActual"))} sub={`plan ${short(sum(costs, "ytdBudget"))}`} tone={sum(costs, "ytdActual") <= sum(costs, "ytdBudget") ? "good" : "warn"} />
        <Stat label="Profit so far" value={short(sum(income, "ytdActual") - sum(costs, "ytdActual"))} sub={`plan ${short(sum(income, "ytdBudget") - sum(costs, "ytdBudget"))}`} />
        <Stat label="Year's plan" value={short(income.reduce((n, r) => n + r.yearBudget, 0) - costs.reduce((n, r) => n + r.yearBudget, 0))} sub="profit" />
      </div>
      <Section title="By account">
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-right text-[12px] text-muted">
                <th className="py-2 text-left font-medium">Account</th>
                <th className="py-2 font-medium">Plan so far</th>
                <th className="py-2 font-medium">Actual</th>
                <th className="py-2 font-medium">Better / worse</th>
                <th className="py-2 font-medium">Year&apos;s plan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-right tabular-nums">
              {[...income, ...costs].map((r) => (
                <tr key={r.id}>
                  <td className="py-2 text-left">{r.code} · {r.name}</td>
                  <td className="py-2">{inr(r.ytdBudget)}</td>
                  <td className="py-2">{inr(r.ytdActual)}</td>
                  <td className={cx("py-2 font-semibold", r.variance < 0 ? "text-danger" : r.variance > 0 ? "text-success" : "")}>{r.variance > 0 ? "+" : ""}{inr(r.variance)}</td>
                  <td className="py-2 text-muted">{inr(r.yearBudget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {editing && editing !== "new" && <BudgetDialog init={editing} onClose={close} />}
    </div>
  );
}

function BudgetDialog({ init, onClose }: { init?: Budget; onClose: () => void }) {
  const { meta } = useAcc();
  const start = Number(meta.fy.from.slice(0, 4));
  const [f, setF] = useState({ name: init?.name ?? `Plan FY ${meta.fy.label}`, year: init?.year ?? meta.fy.label, companyId: init?.companyId ?? "", costCentreId: init?.costCentreId ?? "" });
  // Amounts as a monthly figure per account (same every month); per-month detail can be imported later.
  const fyStart = `${(init?.year ?? meta.fy.label).slice(0, 4)}-${String(meta.settings.fyStartMonth).padStart(2, "0")}`;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(fyStart, i));
  const [monthly, setMonthly] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(init?.amounts ?? {}).map(([id, m]) => [id, fromPaise(Math.round(Object.values(m).reduce((a, b) => a + b, 0) / 12))])));
  const pl = meta.accounts.filter((a) => a.type === "income" || a.type === "expense");
  const save = useAccAction(() => ({ path: init ? `budgets/${init.id}` : "budgets", method: init ? "PUT" : "POST", body: { ...f, companyId: f.companyId || null, costCentreId: f.costCentreId || null, amounts: Object.fromEntries(Object.entries(monthly).filter(([, v]) => toPaise(v)).map(([id, v]) => [id, Object.fromEntries(months.map((m) => [m, toPaise(v)]))])) } }), { success: "Budget saved", onDone: onClose });
  return (
    <Dialog open onClose={onClose} size="xl" title={init ? `Edit ${init.name}` : "New budget"} description="A monthly amount for each account you want to plan; leave the rest blank." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Year">
          {(a) => (
            <Select {...a} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} disabled={!!init}>
              {[start - 1, start, start + 1].map((y) => {
                const label = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
                return <option key={y} value={label}>FY {label}</option>;
              })}
            </Select>
          )}
        </Field>
        {meta.units.length > 0 ? (
          <Field label="Cost centre">
            {(a) => (
              <Select {...a} value={f.costCentreId} onChange={(e) => setF({ ...f, costCentreId: e.target.value })}>
                <option value="">All</option>
                {meta.units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </Select>
            )}
          </Field>
        ) : <div />}
      </div>
      <table className="mt-4 w-full text-[13px]">
        <tbody className="divide-y divide-border">
          {pl.map((a) => (
            <tr key={a.id}>
              <td className="py-1.5">{a.code} · {a.name} <span className="text-[11.5px] text-muted">{a.type === "income" ? "income" : ""}</span></td>
              <td className="w-40 py-1.5"><Input aria-label={`${a.name} each month`} inputMode="decimal" value={monthly[a.id] ?? ""} onChange={(e) => setMonthly({ ...monthly, [a.id]: e.target.value })} placeholder="₹ a month" className="h-8" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {meta.companies.length > 1 && <Notice title="Tip">Pick a company in the report filters to compare a company&apos;s own budget.</Notice>}
    </Dialog>
  );
}

// ── Cash flow and forecast ──────────────────────────────────────────────────

function Row({ label, amount, strong, indent }: { label: string; amount: number; strong?: boolean; indent?: boolean }) {
  return (
    <tr className={cx(strong && "font-semibold")}>
      <td className={cx("py-1.5", indent && "pl-4 text-muted")}>{label}</td>
      <td className={cx("py-1.5 text-right tabular-nums", amount < 0 && "text-danger")}>{inr(amount)}</td>
    </tr>
  );
}

type CF = { from: string; to: string; profit: number; nonCash: { id: string; name: string; amount: number }[]; working: { id: string; name: string; amount: number }[]; operating: number; investing: { id: string; name: string; amount: number }[]; investingTotal: number; financing: { id: string; name: string; amount: number }[]; financingTotal: number; net: number; cashOpen: number; cashClose: number; difference: number };

export function CashFlow() {
  const { meta } = useAcc();
  const [from, setFrom] = useState(meta.fy.from);
  const [to, setTo] = useState(todayIst());
  const slice = useSliceQs();
  const q = useAccQuery<CF>(`reports/cash-flow?from=${from}&to=${to}${slice}`, { keepPrevious: true });
  const d = q.data;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 !w-40" />
        <span className="text-muted">to</span>
        <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 !w-40" />
      </div>
      {!d ? (
        <Skeleton className="h-80 rounded-[24px]" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <Section title="Cash flow statement">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-border">
                <Row label="Profit for the period" amount={d.profit} />
                {d.nonCash.map((l) => <Row key={l.id} label={`Add back: ${l.name}`} amount={l.amount} indent />)}
                {d.working.map((l) => <Row key={l.id} label={`Change in ${l.name}`} amount={l.amount} indent />)}
                <Row label="Cash from operations" amount={d.operating} strong />
                {d.investing.map((l) => <Row key={l.id} label={l.name} amount={l.amount} indent />)}
                <Row label="Cash from investing" amount={d.investingTotal} strong />
                {d.financing.map((l) => <Row key={l.id} label={l.name} amount={l.amount} indent />)}
                <Row label="Cash from financing" amount={d.financingTotal} strong />
                <Row label="Net change in cash" amount={d.net} strong />
              </tbody>
            </table>
            {d.difference !== 0 && <p className="mt-3 text-[12.5px] text-warning">Off by {inr(d.difference)} from the bank and cash balances — check for entries posted straight between cash and equity or tax accounts.</p>}
          </Section>
          <Section title="Cash and bank">
            <div className="grid gap-3">
              <Stat label="At the start" value={short(d.cashOpen)} />
              <Stat label="At the end" value={short(d.cashClose)} sub={`${d.cashClose >= d.cashOpen ? "up" : "down"} ${short(Math.abs(d.cashClose - d.cashOpen))}`} tone={d.cashClose >= d.cashOpen ? "good" : "warn"} />
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

type Fc = { opening: number; weeks: { week: string; inflow: number; outflow: number; closing: number; items: string[] }[] };
export function Forecast() {
  const q = useAccQuery<Fc>("reports/forecast?weeks=13");
  const d = q.data;
  if (!d) return <Skeleton className="h-80 rounded-[24px]" />;
  const max = Math.max(1, ...d.weeks.map((w) => Math.abs(w.closing)));
  return (
    <div className="grid gap-5">
      <Notice title="An estimate from what's recorded">Cash and bank today, plus what customers owe by due date (overdue in the first week), less bills due, the next payrolls at last month&apos;s net pay, and repeating journals that touch the bank. It doesn&apos;t know about sales you haven&apos;t invoiced yet.</Notice>
      <Section title="Next 13 weeks">
        <div className="mb-3 flex h-40 items-end gap-1.5" role="img" aria-label="Cash at the end of each week">
          {d.weeks.map((w) => (
            <div key={w.week} title={`Week of ${fmt(w.week, { day: "numeric", month: "short" })}: ${inr(w.closing)}`} className="flex h-full flex-1 flex-col items-center justify-end">
              <span className={cx("block w-1/2 rounded-t-[4px]", w.closing < 0 ? "bg-danger" : "bg-accent")} style={{ height: `${Math.max(2, (Math.abs(w.closing) / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-right text-[12px] text-muted">
              <th className="py-2 text-left font-medium">Week of</th>
              <th className="py-2 font-medium">Coming in</th>
              <th className="py-2 font-medium">Going out</th>
              <th className="py-2 font-medium">Cash at the end</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-right tabular-nums">
            <tr className="text-muted"><td className="py-1.5 text-left">Today</td><td /><td /><td className="py-1.5">{inr(d.opening)}</td></tr>
            {d.weeks.map((w) => (
              <tr key={w.week} title={w.items.join("\n")}>
                <td className="py-1.5 text-left">{fmt(w.week, { day: "numeric", month: "short" })}</td>
                <td className="py-1.5 text-success">{w.inflow ? inr(w.inflow) : "—"}</td>
                <td className="py-1.5 text-danger">{w.outflow ? inr(w.outflow) : "—"}</td>
                <td className={cx("py-1.5 font-semibold", w.closing < 0 && "text-danger")}>{inr(w.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
