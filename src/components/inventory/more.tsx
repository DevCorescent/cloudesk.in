"use client";

// The rest of Inventory: transfers between locations, counts, suppliers,
// reports and settings (locations and how the module behaves).
import { ArrowLeftRight, ArrowRight, Download, Pencil, Plus, Store, Trash2, Truck, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ExportMenu, ImportButton } from "@/components/import/buttons";
import { api } from "@/lib/client/api";
import { target } from "@/lib/import/targets";
import { TDS_SECTIONS } from "@/lib/accounting/tds";
import { OnboardingDialog, RatesDialog } from "./procurement";
import { useState } from "react";
import { ConfirmDialog, Dialog, Tabs } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { Delta, Empty, MOVE_LABEL, Section, Stat, StatusPill, fmtQty, inr, invApi, short, useInv, useInvAction, useInvQuery, when, whName, type Item, type Warehouse } from "./shared";
import { CustomFieldsCard } from "@/components/custom/fields-card";

// ─── Transfers ───

type Transfer = { id: string; number: string; fromId: string; toId: string; status: string; lines: { itemId: string; qty: number; batch: string }[]; notes: string; createdAt: string; sentAt: string | null; receivedAt: string | null };

export function TransfersView() {
  const { meta } = useInv();
  const q = useInvQuery<{ transfers: Transfer[] }>("transfers");
  const items = useInvQuery<{ items: Item[] }>("items?filter=all");
  const [open, setOpen] = useState(false);
  const act = useInvAction<{ id: string; k: string }>(({ id, k }) => ({ path: `transfers/${id}/${k}` }), { success: "Done" });
  const name = new Map((items.data?.items ?? []).map((i) => [i.id, i]));
  return (
    <div>
      <PageHeader title="Transfers" description="Stock leaves one location when it's sent and arrives at the other when it's received." actions={meta.me.write && meta.warehouses.length > 1 && <Button size="sm" variant="primary" icon={<ArrowLeftRight className="size-3.5" />} onClick={() => setOpen(true)}>New transfer</Button>} />
      {meta.warehouses.length < 2 && <div className="mb-4"><Notice title="One location so far">Add another location in Settings to move stock between them.</Notice></div>}
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !q.data.transfers.length ? (
        <Empty>No transfers yet.</Empty>
      ) : (
        <ul className="grid gap-3">
          {q.data.transfers.map((t) => (
            <li key={t.id} className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[14px]">
                  <b className="font-semibold">{t.number}</b>
                  <span className="text-muted">{whName(meta, t.fromId)}</span>
                  <ArrowRight className="size-3.5 text-subtle" />
                  <span className="text-muted">{whName(meta, t.toId)}</span>
                  <StatusPill status={t.status} />
                </span>
                {meta.me.write && (
                  <span className="flex gap-2">
                    {t.status === "draft" && <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate({ id: t.id, k: "send" })}>Send</Button>}
                    {t.status === "in_transit" && <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate({ id: t.id, k: "receive" })}>Mark received</Button>}
                    {(t.status === "draft" || t.status === "in_transit") && <Button size="sm" variant="ghost" aria-label={`Cancel ${t.number}`} icon={<X className="size-4" />} onClick={() => act.mutate({ id: t.id, k: "cancel" })} />}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted">
                {t.lines.map((l) => `${name.get(l.itemId)?.name ?? "Item"} × ${fmtQty(l.qty, name.get(l.itemId)?.unit)}${l.batch ? ` (${l.batch})` : ""}`).join(" · ")}
              </p>
              <p className="mt-1 text-[11.5px] text-subtle">
                Made {when(t.createdAt)}
                {t.sentAt ? ` · sent ${when(t.sentAt)}` : ""}
                {t.receivedAt ? ` · received ${when(t.receivedAt)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {open && <TransferDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

export function TransferDialog({ itemId, onClose }: { itemId?: string; onClose: () => void }) {
  const { meta } = useInv();
  const items = useInvQuery<{ items: Item[] }>("items");
  const def = meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "";
  const [f, setF] = useState({ fromId: def, toId: meta.warehouses.find((w) => w.id !== def)?.id ?? "", notes: "", send: true, lines: itemId ? [{ itemId, qty: "" }] : ([] as { itemId: string; qty: string }[]) });
  const create = useInvAction<void, { transfer: { id: string } }>(() => ({ path: "transfers", body: { fromId: f.fromId, toId: f.toId, notes: f.notes, lines: f.lines.filter((l) => Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) } }));
  const send = useInvAction<string>((id) => ({ path: `transfers/${id}/send` }), { success: "Sent — it's on its way", onDone: onClose });
  const byId = new Map((items.data?.items ?? []).map((i) => [i.id, i]));
  const go = () => create.mutate(undefined, { onSuccess: (r) => (f.send ? send.mutate(r.transfer.id) : onClose()) });
  return (
    <Dialog open onClose={onClose} size="lg" title="Move stock" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending || send.isPending} disabled={!f.fromId || !f.toId || f.fromId === f.toId || !f.lines.some((l) => Number(l.qty) > 0)} onClick={go}>{f.send ? "Send now" : "Save as draft"}</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From">
            {(a) => (
              <Select {...a} value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })}>
                {meta.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="To">
            {(a) => (
              <Select {...a} value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })}>
                {meta.warehouses.filter((w) => w.id !== f.fromId).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <ul className="grid gap-2">
          {f.lines.map((l, i) => {
            const it = byId.get(l.itemId);
            const here = it?.byLocation[f.fromId] ?? 0;
            return (
              <li key={l.itemId} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2 text-[13px]">
                <span className="truncate">
                  <b className="font-medium">{it?.name}</b> <span className="text-muted">· {fmtQty(here, it?.unit)} here</span>
                </span>
                <Input aria-label={`Quantity of ${it?.name}`} inputMode="decimal" value={l.qty} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
                <Button size="sm" variant="ghost" aria-label="Remove" icon={<X className="size-3.5" />} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })} />
              </li>
            );
          })}
        </ul>
        <Select aria-label="Add an item" value="" onChange={(e) => e.target.value && setF({ ...f, lines: [...f.lines, { itemId: e.target.value, qty: "" }] })}>
          <option value="">+ Add an item…</option>
          {(items.data?.items ?? []).filter((i) => (i.byLocation[f.fromId] ?? 0) > 0 && !f.lines.some((l) => l.itemId === i.id)).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} — {fmtQty(i.byLocation[f.fromId] ?? 0, i.unit)}
            </option>
          ))}
        </Select>
        <p className="text-[12px] text-muted">Batched items go oldest-expiry first.</p>
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={f.send} onChange={(v) => setF({ ...f, send: v })} label="Send now" /> Send now (otherwise it&apos;s saved as a draft)
        </label>
        <Field label="Note (optional)">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />}</Field>
      </div>
    </Dialog>
  );
}

// ─── Counts & adjustments ───

type Count = { id: string; warehouse: string; by: string | null; lines: { itemId: string; batch: string; expected: number; counted: number }[]; varianceValue: number; note: string; createdAt: string };

export function CountsView() {
  const { meta } = useInv();
  const [tab, setTab] = useState<"count" | "history" | "moves">("count");
  const [warehouseId, setWarehouse] = useState(meta.warehouses.find((w) => w.isDefault)?.id ?? meta.warehouses[0]?.id ?? "");
  const items = useInvQuery<{ items: Item[] }>(`items?warehouseId=${warehouseId}`);
  const history = useInvQuery<{ counts: Count[] }>(tab === "history" ? "counts" : null);
  const moves = useInvQuery<{ moves: { id: string; item: string; unit: string; warehouse: string; qty: number; kind: string; refNo: string; note: string; by: string | null; createdAt: string }[] }>(tab === "moves" ? "movements" : null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const rows = (items.data?.items ?? []).filter((i) => !i.trackBatches);
  const entered = rows.filter((r) => counted[r.id] !== undefined && counted[r.id] !== "");
  const diffValue = entered.reduce((a, r) => a + Math.round((Number(counted[r.id]) - r.onHand) * r.avgCost), 0);
  const submit = useInvAction(() => ({ path: "counts", body: { warehouseId, note, lines: entered.map((r) => ({ itemId: r.id, counted: Number(counted[r.id]) })) } }), { success: "Count saved — stock now matches", onDone: () => (setCounted({}), setNote(""), setConfirm(false)) });
  return (
    <div>
      <PageHeader title="Counts & adjustments" description="Count what's on the shelf; differences are adjusted and valued. Single adjustments are on each item's page." />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: "count", label: "Count a location" }, { value: "history", label: "Past counts" }, { value: "moves", label: "All movement" }]} />
      {tab === "count" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select aria-label="Location" className="!w-auto" value={warehouseId} onChange={(e) => (setWarehouse(e.target.value), setCounted({}))}>
              {meta.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <span className="text-[12.5px] text-muted">Leave an item blank to skip it. Batched items are counted from their own page.</span>
          </div>
          {!items.data ? (
            <Skeleton className="h-60 rounded-[20px]" />
          ) : !rows.length ? (
            <Empty>No items to count here.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
              <FormLines className="w-full min-w-[620px] text-[13.5px]">
                <thead className="border-b border-border text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 text-right font-medium">Expected</th>
                    <th className="w-36 px-4 py-2.5 font-medium">Counted</th>
                    <th className="px-4 py-2.5 text-right font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const c = counted[r.id];
                    const diff = c !== undefined && c !== "" ? Number(c) - r.onHand : null;
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2">
                          <b className="font-medium">{r.name}</b>
                          <span className="block text-[12px] text-muted">{r.sku || r.unit}</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.onHand, r.unit)}</td>
                        <td className="px-4 py-2">
                          <Input aria-label={`Counted ${r.name}`} inputMode="decimal" value={c ?? ""} onChange={(e) => setCounted({ ...counted, [r.id]: e.target.value })} />
                        </td>
                        <td className="px-4 py-2 text-right">{diff === null ? <span className="text-subtle">—</span> : <Delta qty={Number(diff.toFixed(3))} unit={r.unit} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </FormLines>
            </div>
          )}
          {meta.me.write && entered.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <Input aria-label="Count note" className="!w-64" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. Month-end count" maxLength={300} />
              <span className={cx("text-[13px]", diffValue < 0 ? "text-danger" : diffValue > 0 ? "text-success" : "text-muted")}>
                {entered.length} counted · {diffValue === 0 ? "no difference" : `${diffValue > 0 ? "+" : "−"}${inr(Math.abs(diffValue))}`}
              </span>
              <Button variant="primary" onClick={() => setConfirm(true)}>
                Save count
              </Button>
            </div>
          )}
          <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => submit.mutate(undefined)} loading={submit.isPending} title="Save this count?" description={`Stock for ${entered.length} item${entered.length === 1 ? "" : "s"} at ${whName(meta, warehouseId)} will be set to what you counted. The difference is ${diffValue === 0 ? "nothing" : `${diffValue > 0 ? "+" : "−"}${inr(Math.abs(diffValue))} at average cost`}.`} confirmLabel="Save count" />
        </>
      )}
      {tab === "history" &&
        (!history.data ? (
          <Skeleton className="h-60 rounded-[20px]" />
        ) : !history.data.counts.length ? (
          <Empty>No counts yet.</Empty>
        ) : (
          <ul className="grid gap-2">
            {history.data.counts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface px-4 py-3 text-[13px]">
                <span>
                  <b className="font-semibold">{c.warehouse}</b> <span className="text-muted">· {c.lines.length} items · {when(c.createdAt)}{c.by ? ` · ${c.by}` : ""}</span>
                  {c.note && <span className="block text-[12px] text-muted">{c.note}</span>}
                </span>
                <b className={cx("tabular-nums", c.varianceValue < 0 ? "text-danger" : c.varianceValue > 0 ? "text-success" : "text-muted")}>{c.varianceValue === 0 ? "No difference" : `${c.varianceValue > 0 ? "+" : "−"}${inr(Math.abs(c.varianceValue))}`}</b>
              </li>
            ))}
          </ul>
        ))}
      {tab === "moves" &&
        (!moves.data ? (
          <Skeleton className="h-60 rounded-[20px]" />
        ) : !moves.data.moves.length ? (
          <Empty>No movement yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-sm">
            <table className="w-full min-w-[680px] text-[13px]">
              <thead className="border-b border-border text-left text-[12px] text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">What</th>
                  <th className="px-4 py-2.5 font-medium">Where</th>
                  <th className="px-4 py-2.5 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {moves.data.moves.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-muted">{when(m.createdAt)}</td>
                    <td className="px-4 py-2 font-medium">{m.item}</td>
                    <td className="px-4 py-2">
                      {MOVE_LABEL[m.kind] ?? m.kind}
                      <span className="block text-[11.5px] text-muted">{[m.refNo, m.note, m.by].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="px-4 py-2 text-muted">{m.warehouse}</td>
                    <td className="px-4 py-2 text-right">
                      <Delta qty={m.qty} unit={m.unit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

// ─── Suppliers ───

type Supplier = { id: string; name: string; contactName: string; email: string; phone: string; gstin: string; state: string; address: string; paymentTermsDays: number; leadTimeDays: number; notes: string; active: boolean; openOrders: number; spent: number; approval: "pending" | "approved" | "blocked"; checklist: Record<string, boolean>; pan: string; tdsSection: string; deductee: "company" | "other"; bank: { name?: string; account?: string; ifsc?: string } | null; pendingBank?: { account?: string; ifsc?: string; at: string } | null };

export function SuppliersView() {
  const { meta, go, orgId } = useInv();
  const qc = useQueryClient();
  const q = useInvQuery<{ suppliers: Supplier[] }>("suppliers");
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [onboarding, setOnboarding] = useState<Supplier | null>(null);
  const [rates, setRates] = useState<Supplier | null>(null);
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Who you buy from: contacts, GSTIN, payment terms and how long they take."
        actions={
          <div className="flex flex-wrap gap-2">
            {meta.me.write && <ImportButton target={target("inventory.suppliers")} onImport={(rows, mode) => api(invApi(orgId, "suppliers/import"), { method: "POST", body: { rows, mode } })} onDone={() => qc.invalidateQueries({ queryKey: ["inv", orgId] })} />}
            <ExportMenu name="suppliers" rows={q.data?.suppliers} columns={[{ key: "name", label: "Name" }, { key: "contactName", label: "Contact person" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "gstin", label: "GSTIN" }, { key: "state", label: "State" }, { key: "address", label: "Address" }, { key: "paymentTermsDays", label: "Credit days" }, { key: "leadTimeDays", label: "Lead time (days)" }, { key: "spent", label: "Received in total", money: true }]} />
            {meta.me.write && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({})}>New supplier</Button>}
          </div>
        }
      />
      {!q.data ? (
        <Skeleton className="h-60 rounded-[20px]" />
      ) : !q.data.suppliers.length ? (
        <EmptyState icon={<Truck />} title="No suppliers yet" description="Add the people you buy from to raise purchase orders." action={meta.me.write ? <Button size="sm" variant="primary" onClick={() => setEditing({})}>Add a supplier</Button> : undefined} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {q.data.suppliers.map((s) => (
            <li key={s.id} className={cx("rounded-[18px] border border-border bg-surface p-4 shadow-sm", !s.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <b className="text-[14.5px] font-semibold">{s.name}</b>
                  <span className="block text-[12.5px] text-muted">{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "No contact details"}</span>
                  <span className="block text-[12px] text-subtle">{[s.gstin && `GSTIN ${s.gstin}`, s.state, `${s.paymentTermsDays}-day terms`, `${s.leadTimeDays}-day lead time`].filter(Boolean).join(" · ")}</span>
                  {s.pendingBank && <span className="mt-1 inline-block rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] font-medium">New bank details (account ending {(s.pendingBank.account ?? "").slice(-4)}) waiting for approval</span>}
                </span>
                {meta.me.write && <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} icon={<Pencil className="size-3.5" />} onClick={() => setEditing(s)} />}
              </div>
              <div className="mt-3 flex items-center gap-4 text-[12.5px]">
                <span>
                  <b className="tabular-nums">{short(s.spent)}</b> <span className="text-muted">received in total</span>
                </span>
                <button type="button" onClick={() => go("orders")} className="text-muted hover:text-fg">
                  {s.openOrders} open order{s.openOrders === 1 ? "" : "s"}
                </button>
                {meta.parts.procurement && (
                  <>
                    <button type="button" onClick={() => setOnboarding(s)} className={cx("font-medium", s.approval === "approved" ? "text-success" : s.approval === "blocked" ? "text-danger" : "text-warning")}>{s.approval === "approved" ? "Approved" : s.approval === "blocked" ? "Blocked" : "Not approved"}</button>
                    <button type="button" onClick={() => setRates(s)} className="text-muted hover:text-fg">Agreed rates</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <SupplierDialog init={editing} onClose={() => setEditing(null)} />}
      {onboarding && (meta.me.manage ? <OnboardingDialog supplier={onboarding} onClose={() => setOnboarding(null)} /> : null)}
      {rates && <RatesDialog supplier={rates} onClose={() => setRates(null)} />}
    </div>
  );
}

function SupplierDialog({ init, onClose }: { init: Partial<Supplier>; onClose: () => void }) {
  const { meta } = useInv();
  const [f, setF] = useState({ name: init.name ?? "", contactName: init.contactName ?? "", email: init.email ?? "", phone: init.phone ?? "", gstin: init.gstin ?? "", state: init.state ?? "", address: init.address ?? "", paymentTermsDays: String(init.paymentTermsDays ?? 30), leadTimeDays: String(init.leadTimeDays ?? 7), notes: init.notes ?? "", active: init.active ?? true, pan: init.pan ?? "", tdsSection: init.tdsSection ?? "", deductee: init.deductee ?? "other", bankName: init.bank?.name ?? "", bankAccount: init.bank?.account ?? "", ifsc: init.bank?.ifsc ?? "" });
  const { bankName, bankAccount, ifsc, ...rest } = f;
  const save = useInvAction(() => ({ path: init.id ? `suppliers/${init.id}` : "suppliers", method: init.id ? "PUT" : "POST", body: { ...rest, paymentTermsDays: Number(f.paymentTermsDays) || 0, leadTimeDays: Number(f.leadTimeDays) || 0, bank: { name: bankName, account: bankAccount, ifsc } } }), { success: (r: { supplier?: { bankPendingApproval?: boolean } }) => (r.supplier?.bankPendingApproval ? "Saved — the new bank details wait for approval and aren't used until then" : "Saved"), onDone: onClose });
  const del = useInvAction(() => ({ path: `suppliers/${init.id}`, method: "DELETE" }), { success: "Supplier deleted", onDone: onClose });
  // The first two characters of a GSTIN are the state code.
  const fromGstin = (g: string) => setF({ ...f, gstin: g.toUpperCase(), state: f.state || STATE_BY_GST[g.slice(0, 2)] || "" });
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={init.id ? `Edit ${init.name}` : "New supplier"}
      footer={
        <>
          {init.id && meta.me.manage && <Button variant="ghost" className="mr-auto" icon={<Trash2 className="size-4" />} loading={del.isPending} onClick={() => del.mutate(undefined)}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} placeholder="Sharma Traders" />}</Field>
        <Field label="Contact person">{(a) => <Input {...a} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} maxLength={120} />}</Field>
        <Field label="Phone">{(a) => <Input {...a} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} />}</Field>
        <Field label="Email" hint="Purchase orders are emailed here.">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="GSTIN">{(a) => <Input {...a} value={f.gstin} onChange={(e) => fromGstin(e.target.value)} maxLength={15} />}</Field>
        <Field label="State code" hint="Two letters, like MH. Decides CGST + SGST vs IGST.">{(a) => <Input {...a} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} maxLength={2} />}</Field>
        <Field label="Address">{(a) => <Input {...a} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={400} />}</Field>
        <Field label="Pays in (days)">{(a) => <Input {...a} inputMode="numeric" value={f.paymentTermsDays} onChange={(e) => setF({ ...f, paymentTermsDays: e.target.value.replace(/\D/g, "") })} />}</Field>
        <Field label="Delivers in (days)">{(a) => <Input {...a} inputMode="numeric" value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: e.target.value.replace(/\D/g, "") })} />}</Field>
        <p className="pt-2 text-[12px] font-semibold tracking-[0.12em] text-subtle uppercase sm:col-span-2">Tax and bank (for Accounts)</p>
        <Field label="PAN" hint="Without a valid PAN, TDS is at least 20%.">{(a) => <Input {...a} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} maxLength={10} placeholder="ABCDE1234F" />}</Field>
        <Field label="TDS section" hint="Suggested on their bills.">
          {(a) => (
            <Select {...a} value={f.tdsSection} onChange={(e) => setF({ ...f, tdsSection: e.target.value })}>
              <option value="">No TDS</option>
              {Object.entries(TDS_SECTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="They are">
          {(a) => (
            <Select {...a} value={f.deductee} onChange={(e) => setF({ ...f, deductee: e.target.value as "company" | "other" })}>
              <option value="other">An individual, HUF or firm</option>
              <option value="company">A company</option>
            </Select>
          )}
        </Field>
        <Field label="Account holder">{(a) => <Input {...a} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} maxLength={120} />}</Field>
        <Field label="Bank account no.">{(a) => <Input {...a} inputMode="numeric" value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value.replace(/\D/g, "") })} maxLength={20} />}</Field>
        <Field label="IFSC">{(a) => <Input {...a} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} maxLength={11} placeholder="HDFC0001234" />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />}</Field>
        {init.id && (
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Supplier in use" /> In use
          </label>
        )}
      </div>
      {init.id && <CustomFieldsCard entity="inventory.supplier" id={init.id} className="mt-4" />}
    </Dialog>
  );
}

/** GST state code (first two digits of a GSTIN) → two-letter state. */
const STATE_BY_GST: Record<string, string> = { "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR", "11": "SK", "12": "AR", "13": "NL", "14": "MN", "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH", "21": "OD", "22": "CG", "23": "MP", "24": "GJ", "26": "DN", "27": "MH", "29": "KA", "30": "GA", "31": "LD", "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AP", "38": "LA" };

// ─── Reports ───

type Reports = {
  totalValue: number;
  valuation: { id: string; name: string; sku: string; unit: string; category: string; onHand: number; avgCost: number; value: number }[];
  byCategory: { name: string; value: number }[];
  dead: { id: string; name: string; unit: string; onHand: number; value: number }[];
  inbound: { month: string; received: number; value: number }[];
  suppliers: { supplier: string; total: number; receipts: number }[];
};

export function ReportsView() {
  const { orgId } = useInv();
  const q = useInvQuery<Reports>("reports");
  const d = q.data;
  if (!d) return <Skeleton className="h-[70vh] rounded-[24px]" />;
  const maxCat = Math.max(1, ...d.byCategory.map((c) => c.value));
  const maxIn = Math.max(1, ...d.inbound.map((c) => c.value));
  return (
    <div>
      <PageHeader title="Inventory reports" description="What your stock is worth, what you've bought and what isn't moving." actions={<a href={invApi(orgId, "items/export")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> Stock CSV</a>} />
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Stock value" value={short(d.totalValue)} sub="at weighted average cost" />
          <Stat label="Items in stock" value={d.valuation.filter((v) => v.onHand > 0).length} sub={`of ${d.valuation.length} active`} />
          <Stat label="Not moving" value={d.dead.length} sub={d.dead.length ? `${short(d.dead.reduce((a, x) => a + x.value, 0))} sitting for 90+ days` : "everything moved in 90 days"} tone={d.dead.length ? "warn" : undefined} />
          <Stat label="Bought this year" value={short(d.suppliers.reduce((a, s) => a + s.total, 0))} sub={`${d.suppliers.reduce((a, s) => a + s.receipts, 0)} deliveries`} />
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Value by category">
            {!d.byCategory.length ? (
              <Empty>No stock with a cost yet.</Empty>
            ) : (
              <ul className="grid gap-2">
                {d.byCategory.map((c) => (
                  <li key={c.name} title={`${c.name}: ${inr(c.value)}`} className="grid grid-cols-[130px_minmax(0,1fr)_80px] items-center gap-3 text-[12.5px]">
                    <span className="truncate text-muted">{c.name}</span>
                    <span className="h-4 overflow-hidden rounded-[5px] bg-surface-2">
                      <span className="block h-full rounded-r-[4px] bg-[var(--chart)]" style={{ width: `${(c.value / maxCat) * 100}%` }} />
                    </span>
                    <b className="text-right tabular-nums">{short(c.value)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Received by month">
            {!d.inbound.length ? (
              <Empty>Nothing received yet.</Empty>
            ) : (
              <div className="flex h-40 items-end gap-1.5 border-b border-border">
                {d.inbound.map((m) => (
                  <div key={m.month} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${m.month}: ${inr(m.value)}`}>
                    <span className="w-full max-w-[36px] rounded-t-[4px] bg-[var(--chart)]" style={{ height: `${Math.max(2, (m.value / maxIn) * 100)}%` }} />
                    <span className="absolute -bottom-5 text-[10.5px] text-subtle">{new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <Section title="Top suppliers (12 months)">
            {!d.suppliers.length ? (
              <Empty>No deliveries yet.</Empty>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {d.suppliers.map((s) => (
                  <li key={s.supplier} className="flex justify-between gap-3 py-2">
                    <span>
                      {s.supplier} <span className="text-muted">· {s.receipts} {s.receipts === 1 ? "delivery" : "deliveries"}</span>
                    </span>
                    <b className="tabular-nums">{inr(s.total)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Not moving for 90 days">
            {!d.dead.length ? (
              <Empty>Everything in stock has moved in the last 90 days.</Empty>
            ) : (
              <ul className="divide-y divide-border text-[13px]">
                {d.dead.slice(0, 10).map((x) => (
                  <li key={x.id} className="flex justify-between gap-3 py-2">
                    <Link href={`/inventory/items/${x.id}`} className="hover:underline">
                      {x.name} <span className="text-muted">· {fmtQty(x.onHand, x.unit)}</span>
                    </Link>
                    <b className="tabular-nums">{inr(x.value)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <Section title="Valuation">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-[13px]">
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Item</th>
                  <th className="py-1.5 font-medium">Category</th>
                  <th className="py-1.5 text-right font-medium">On hand</th>
                  <th className="py-1.5 text-right font-medium">Avg cost</th>
                  <th className="py-1.5 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {d.valuation.slice(0, 50).map((v) => (
                  <tr key={v.id} className="border-t border-border">
                    <td className="py-1.5">
                      <Link href={`/inventory/items/${v.id}`} className="hover:underline">
                        {v.name}
                      </Link>
                    </td>
                    <td className="py-1.5 text-muted">{v.category || "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtQty(v.onHand, v.unit)}</td>
                    <td className="py-1.5 text-right tabular-nums">{inr(v.avgCost)}</td>
                    <td className="py-1.5 text-right tabular-nums">{inr(v.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Settings ───

export function SettingsView() {
  const { meta } = useInv();
  const [f, setF] = useState({ ...meta.settings, expiryWarnDays: String(meta.settings.expiryWarnDays) });
  const [editing, setEditing] = useState<Partial<Warehouse> | null>(null);
  const [removing, setRemoving] = useState<Warehouse | null>(null);
  const save = useInvAction(() => ({ path: "settings", method: "PUT", body: { ...f, expiryWarnDays: Number(f.expiryWarnDays) || 30 } }), { success: "Settings saved" });
  const del = useInvAction<string>((id) => ({ path: `warehouses/${id}`, method: "DELETE" }), { success: "Location deleted", onDone: () => setRemoving(null) });
  return (
    <div>
      <PageHeader title="Inventory settings" description="Your locations, and how stock and purchasing behave." />
      <div className="grid max-w-3xl gap-5">
        <Section title="Locations" action={meta.parts.locations || meta.warehouses.length === 0 ? <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setEditing({})}>Add</Button> : undefined}>
          <ul className="divide-y divide-border">
            {meta.warehouses.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="min-w-0">
                  <b className="flex items-center gap-1.5 font-semibold">
                    {w.projectId && <Store className="size-3.5 text-muted" />}
                    {w.name}
                    {w.isDefault && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-muted">Default</span>}
                    {!w.active && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-muted">Off</span>}
                  </b>
                  <span className="text-[12px] text-muted">{[w.code, w.state, w.projectId ? "The store's own shelf — its stock is what the shop sells" : w.address].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${w.name}`} icon={<Pencil className="size-3.5" />} onClick={() => setEditing(w)} />
                  <Button size="sm" variant="ghost" aria-label={`Delete ${w.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(w)} />
                </span>
              </li>
            ))}
          </ul>
          {!meta.parts.locations && <p className="mt-2 text-[12px] text-muted">More locations and transfers are switched off in Settings → Features.</p>}
        </Section>
        <Section title="Valuation, counting and buying">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Value stock in reports by">
              {(a) => (
                <Select {...a} value={f.valuation} onChange={(e) => setF({ ...f, valuation: e.target.value as typeof f.valuation })}>
                  <option value="average">Weighted average cost</option>
                  <option value="fifo">First in, first out (FIFO)</option>
                </Select>
              )}
            </Field>
            <Field label="Count A / B / C items every (days)">
              {(a) => (
                <span className="grid grid-cols-3 gap-2">
                  {(["A", "B", "C"] as const).map((c) => <Input key={c} {...(c === "A" ? a : {})} aria-label={`Count ${c} items every`} inputMode="numeric" value={String(f.countEvery[c])} onChange={(e) => setF({ ...f, countEvery: { ...f.countEvery, [c]: Number(e.target.value.replace(/\D/g, "")) || 1 } })} />)}
                </span>
              )}
            </Field>
            {meta.parts.procurement && (
              <>
                <Field label="Over a purchase budget">
                  {(a) => (
                    <Select {...a} value={f.budgetCheck} onChange={(e) => setF({ ...f, budgetCheck: e.target.value as typeof f.budgetCheck })}>
                      <option value="warn">Warn on the order</option>
                      <option value="block">Refuse the order</option>
                      <option value="off">Don&apos;t check</option>
                    </Select>
                  )}
                </Field>
                <Field label="3-way match tolerance (%)">{(a) => <Input {...a} inputMode="decimal" value={String(f.matchTolerancePct)} onChange={(e) => setF({ ...f, matchTolerancePct: Number(e.target.value) || 0 })} />}</Field>
                <label className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2/60 px-3 py-2.5 text-[13px] sm:col-span-2">
                  <span>
                    <b className="block font-medium">Only buy from approved suppliers</b>
                    <span className="text-muted">New suppliers wait for onboarding before they can get orders.</span>
                  </span>
                  <Switch checked={f.requireApprovedSupplier} onChange={(v) => setF({ ...f, requireApprovedSupplier: v })} label="Only approved suppliers" />
                </label>
              </>
            )}
          </div>
        </Section>
        <Section title="Stock">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-2/60 px-3 py-2.5 text-[13px] sm:col-span-2">
              <span>
                <b className="block font-medium">Don&apos;t let stock go below zero</b>
                <span className="text-muted">Transfers and adjustments for more than is on hand are refused.</span>
              </span>
              <Switch checked={f.blockNegative} onChange={(v) => setF({ ...f, blockNegative: v })} label="Block negative stock" />
            </label>
            {meta.parts.batches && <Field label="Warn about expiry (days before)">{(a) => <Input {...a} inputMode="numeric" value={f.expiryWarnDays} onChange={(e) => setF({ ...f, expiryWarnDays: e.target.value.replace(/\D/g, "") })} />}</Field>}
          </div>
        </Section>
        {meta.parts.purchasing && (
          <Section title="Documents">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Purchase order prefix">{(a) => <Input {...a} value={f.poPrefix} onChange={(e) => setF({ ...f, poPrefix: e.target.value })} maxLength={8} />}</Field>
              <Field label="Goods received prefix">{(a) => <Input {...a} value={f.grnPrefix} onChange={(e) => setF({ ...f, grnPrefix: e.target.value })} maxLength={8} />}</Field>
              <Field label="Transfer prefix">{(a) => <Input {...a} value={f.transferPrefix} onChange={(e) => setF({ ...f, transferPrefix: e.target.value })} maxLength={8} />}</Field>
              <Field label="Terms printed on purchase orders" className="sm:col-span-3">{(a) => <Textarea {...a} rows={3} value={f.poTerms} onChange={(e) => setF({ ...f, poTerms: e.target.value })} maxLength={2000} />}</Field>
            </div>
          </Section>
        )}
        <div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Save settings
          </Button>
        </div>
      </div>
      {editing && <WarehouseDialog init={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && del.mutate(removing.id)} loading={del.isPending} destructive title={`Delete ${removing?.name}?`} description="Only a location without any stock history can be deleted; otherwise switch it off." confirmLabel="Delete" />
    </div>
  );
}

function WarehouseDialog({ init, onClose }: { init: Partial<Warehouse>; onClose: () => void }) {
  const { meta } = useInv();
  const [f, setF] = useState({ name: init.name ?? "", code: init.code ?? "", address: init.address ?? "", state: init.state ?? "", projectId: init.projectId ?? "", isDefault: init.isDefault ?? false, active: init.active ?? true });
  const save = useInvAction(() => ({ path: init.id ? `warehouses/${init.id}` : "warehouses", method: init.id ? "PUT" : "POST", body: { ...f, projectId: f.projectId || null } }), { success: "Location saved", onDone: onClose });
  const stores = meta.stores.filter((s) => !s.linked || s.id === init.projectId);
  return (
    <Dialog open onClose={onClose} title={init.id ? `Edit ${init.name}` : "New location"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">{(a) => <Input {...a} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Pune branch" />}</Field>
        <Field label="Short code">{(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={12} placeholder="PUN" />}</Field>
        <Field label="State code" hint="Like MH — for GST on purchases.">{(a) => <Input {...a} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} maxLength={2} />}</Field>
        <Field label="Address" className="sm:col-span-2">{(a) => <Input {...a} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={400} />}</Field>
        {stores.length > 0 && (
          <Field label="This is a store's shelf" className="sm:col-span-2" hint="Its quantities become the store's own stock for linked items.">
            {(a) => (
              <Select {...a} value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
                <option value="">No — a store room or warehouse</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={f.isDefault} onChange={(v) => setF({ ...f, isDefault: v })} label="Default location" /> Default
        </label>
        {init.id && (
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Location in use" /> In use
          </label>
        )}
      </div>
    </Dialog>
  );
}

