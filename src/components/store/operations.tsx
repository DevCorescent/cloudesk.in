"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Gift, PackageOpen, Plus, RefreshCw, Truck, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, Notice, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { MoneyInput, Panel, storeApi, SubHeader, Table, td, useMoney, useStoreCtx, useStoreQuery } from "./shared";

// ─── Gift cards ──────────────────────────────────────────────────────────────

type GiftCard = { id: string; code: string; initialValue: number; balance: number; currency: string; recipientEmail: string; note: string; expiresAt: string | null; disabled: boolean; createdAt: string };

export function GiftCardsView() {
  const { can } = useStoreCtx();
  const money = useMoney();
  const q = useStoreQuery<{ giftCards: GiftCard[] }>("giftcards");
  const [issue, setIssue] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const outstanding = q.data?.giftCards.filter((g) => !g.disabled).reduce((a, g) => a + g.balance, 0) ?? 0;
  const state = (g: GiftCard) => (g.disabled ? { label: "Disabled", tone: "neutral" as const } : g.expiresAt && new Date(g.expiresAt).getTime() < q.dataUpdatedAt ? { label: "Expired", tone: "neutral" as const } : g.balance <= 0 ? { label: "Used up", tone: "neutral" as const } : { label: "Active", tone: "success" as const });
  return (
    <div>
      <SubHeader
        title="Gift cards"
        description="Issue gift cards for gifts, store credit or apologies. Customers enter the code in their cart; any unused balance stays on the card."
        actions={can("store:refund") && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setIssue(true)}>Issue gift card</Button>}
      />
      {q.data && q.data.giftCards.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-xs text-muted">Cards issued</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{q.data.giftCards.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Unspent balance (owed to customers)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{money(outstanding)}</p>
          </Card>
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Table head={["Code", "Balance", "Recipient", "Status", "Issued"]} empty={q.data.giftCards.length === 0 && <EmptyState icon={<Gift className="size-5" />} title="No gift cards yet" description="Issue one to a customer as a gift, store credit or goodwill gesture." />}>
          {q.data.giftCards.map((g) => {
            const s = state(g);
            return (
              <tr key={g.id} className="hover:bg-surface-2/60">
                <td className={td}>
                  <button type="button" className="font-mono font-medium hover:underline" onClick={() => setDetail(g.id)}>
                    {g.code}
                  </button>
                </td>
                <td className={`${td} tabular-nums`}>
                  {money(g.balance)} <span className="text-muted">of {money(g.initialValue)}</span>
                </td>
                <td className={`${td} max-w-[220px] truncate text-muted`}>{g.recipientEmail || "—"}</td>
                <td className={td}>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </td>
                <td className={`${td} text-muted`}>{timeAgo(g.createdAt)}</td>
              </tr>
            );
          })}
        </Table>
      )}
      {issue && <IssueDialog onClose={() => setIssue(false)} />}
      {detail && <GiftCardDialog id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function IssueDialog({ onClose }: { onClose: () => void }) {
  const { projectId, store } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ value: (store.currency === "INR" ? 100000 : 5000) as number | null, recipientEmail: "", note: "", code: "", expiresAt: "", sendEmail: true });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = useMutation({
    mutationFn: () => api<{ giftCard: GiftCard }>(storeApi(projectId, "giftcards"), { method: "POST", body: { value: f.value, recipientEmail: f.recipientEmail, note: f.note, code: f.code || undefined, expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null, sendEmail: f.sendEmail && !!f.recipientEmail } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "giftcards"] });
      toast({ tone: "success", title: `Gift card ${r.giftCard.code} issued`, description: f.sendEmail && f.recipientEmail ? `Emailed to ${f.recipientEmail}` : undefined });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast({ tone: "error", title: "Could not issue the gift card", description: errorMessage(e) });
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Issue a gift card"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} disabled={!f.value} onClick={() => run.mutate()}>
            Issue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Value" error={errors.value?.[0]}>{(a) => <MoneyInput {...a} value={f.value} onChange={(v) => setF({ ...f, value: v })} currency={store.currency} />}</Field>
        <Field label="Recipient email (optional)">{(a) => <Input {...a} type="email" value={f.recipientEmail} onChange={(e) => setF({ ...f, recipientEmail: e.target.value })} />}</Field>
        {f.recipientEmail && (
          <label className="flex items-center justify-between gap-3 text-[13px]">
            Email the code to the recipient
            <Switch checked={f.sendEmail} onChange={(v) => setF({ ...f, sendEmail: v })} label="Email the code" />
          </label>
        )}
        <Field label="Message (optional)" hint="Included in the email.">{(a) => <Textarea {...a} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Custom code (optional)" hint="Blank generates a secure code." error={errors.code?.[0]}>
            {(a) => <Input {...a} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} maxLength={32} className="font-mono" />}
          </Field>
          <Field label="Expires (optional)">{(a) => <Input {...a} type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}

function GiftCardDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { projectId, base, can } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ card: GiftCard; txns: { id: string; amount: number; reason: string; createdAt: string; orderId: string | null; orderNumber: number | null }[] }>(`giftcards/${id}`);
  const toggle = useMutation({
    mutationFn: (disabled: boolean) => api(storeApi(projectId, `giftcards/${id}`), { method: "PUT", body: { disabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", projectId] }),
    onError: (e) => toast({ tone: "error", title: "Could not update", description: errorMessage(e) }),
  });
  return (
    <Dialog open onClose={onClose} title={q.data ? `Gift card ${q.data.card.code}` : "Gift card"}>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="rounded-[var(--radius-sm)] bg-surface-2 px-2 py-1 font-mono text-sm">{q.data.card.code}</code>
            <IconButton size="sm" label="Copy code" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(q.data.card.code).then(() => toast({ tone: "success", title: "Copied" }))} />
          </div>
          <p className="text-2xl font-semibold tabular-nums">
            {money(q.data.card.balance)} <span className="text-sm font-normal text-muted">left of {money(q.data.card.initialValue)}</span>
          </p>
          {q.data.card.expiresAt && <p className="text-xs text-muted">Expires {dateTime(q.data.card.expiresAt)}</p>}
          {can("store:refund") && (
            <label className="flex items-center justify-between gap-3 text-[13px]">
              Can be used at checkout
              <Switch checked={!q.data.card.disabled} onChange={(v) => toggle.mutate(!v)} label="Card enabled" />
            </label>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted">History</p>
            <ul className="divide-y divide-border text-[13px]">
              {q.data.txns.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {t.orderId ? (
                      <Link href={`${base}/orders/${t.orderId}`} className="hover:underline" onClick={onClose}>
                        {t.reason}
                      </Link>
                    ) : (
                      t.reason
                    )}
                    <span className="block text-xs text-subtle">{timeAgo(t.createdAt)}</span>
                  </span>
                  <span className={`font-medium tabular-nums ${t.amount > 0 ? "text-success" : ""}`}>
                    {t.amount > 0 ? "+" : "−"}
                    {money(Math.abs(t.amount))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ─── Returns ─────────────────────────────────────────────────────────────────

type ReturnRow = { ret: { id: string; orderId: string; status: string; reason: string; details: string; items: { title: string; variantTitle: string; quantity: number }[]; resolution: string; createdAt: string }; number: number; email: string; total: number; paymentMethod: string };
const RETURN_TONE: Record<string, "warning" | "accent" | "neutral" | "success" | "danger"> = { requested: "warning", approved: "accent", received: "accent", refunded: "success", rejected: "neutral" };
const RETURN_LABEL: Record<string, string> = { requested: "Requested", approved: "Approved — awaiting items", received: "Items received", refunded: "Refunded", rejected: "Declined" };

export function ReturnsView() {
  const { projectId, base, store, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"requested" | "approved" | "received" | "all">("requested");
  const q = useStoreQuery<{ returns: ReturnRow[] }>(`returns${status === "all" ? "" : `?status=${status}`}`);
  const [act, setAct] = useState<{ row: ReturnRow; to: "approved" | "rejected" | "received" | "refunded" } | null>(null);
  const [resolution, setResolution] = useState("");
  const [restock, setRestock] = useState(true);
  const run = useMutation({
    mutationFn: () => api(storeApi(projectId, `returns/${act!.row.ret.id}`), { method: "PUT", body: { status: act!.to, resolution: resolution.trim() || undefined, restock } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: "Return updated", description: act?.to === "received" ? "Now refund the customer from the order page." : undefined });
      setAct(null);
      setResolution("");
    },
    onError: (e) => toast({ tone: "error", title: "Could not update the return", description: errorMessage(e) }),
  });
  return (
    <div>
      <SubHeader
        title="Returns"
        description="Return requests customers send from their order page. Approve, receive the items back, then refund from the order."
        actions={<Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "requested", label: "New" }, { value: "approved", label: "Approved" }, { value: "received", label: "Received" }, { value: "all", label: "All" }]} />}
      />
      {q.isPending ? (
        <Skeleton className="h-60" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.data.returns.length === 0 ? (
        <Card>
          <EmptyState icon={<Undo2 className="size-5" />} title={status === "requested" ? "No new return requests" : "Nothing here"} description="Customers can request a return within your return window (Store settings) once an order has shipped." />
        </Card>
      ) : (
        <ul className="space-y-3">
          {q.data.returns.map((r) => (
            <li key={r.ret.id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`${base}/orders/${r.ret.orderId}`} className="text-sm font-semibold hover:underline">
                      Order {store.orderPrefix}
                      {r.number}
                    </Link>
                    <Badge tone={RETURN_TONE[r.ret.status]}>{RETURN_LABEL[r.ret.status] ?? r.ret.status}</Badge>
                    <span className="text-xs text-muted">{timeAgo(r.ret.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{r.email}</p>
                  <ul className="mt-2 text-[13px]">
                    {r.ret.items.map((i, n) => (
                      <li key={n}>
                        {i.quantity} × {i.title}
                        {i.variantTitle && i.variantTitle !== "Default" && <span className="text-muted"> · {i.variantTitle}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[13px]">
                    <span className="font-medium">{r.ret.reason}</span>
                    {r.ret.details && <span className="text-muted"> — {r.ret.details}</span>}
                  </p>
                  {r.ret.resolution && <p className="mt-1 text-xs text-muted">Your reply: {r.ret.resolution}</p>}
                </div>
                {can("store:orders") && (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {r.ret.status === "requested" && (
                      <>
                        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => setAct({ row: r, to: "approved" })}>
                          Approve
                        </Button>
                        <Button size="sm" icon={<X className="size-3.5" />} onClick={() => setAct({ row: r, to: "rejected" })}>
                          Decline
                        </Button>
                      </>
                    )}
                    {r.ret.status === "approved" && (
                      <Button size="sm" variant="primary" icon={<PackageOpen className="size-3.5" />} onClick={() => setAct({ row: r, to: "received" })}>
                        Items received
                      </Button>
                    )}
                    {r.ret.status === "received" && (
                      <>
                        <Link href={`${base}/orders/${r.ret.orderId}`} className="inline-flex h-7 items-center rounded-[var(--radius-sm)] bg-fg px-2.5 text-[13px] font-medium text-bg">
                          Refund on order
                        </Link>
                        <Button size="sm" onClick={() => setAct({ row: r, to: "refunded" })}>
                          Mark refunded
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!act}
        onClose={() => setAct(null)}
        title={act ? { approved: "Approve this return", rejected: "Decline this return", received: "Items received", refunded: "Mark as refunded" }[act.to] : ""}
        description={act?.to === "approved" ? "The customer is emailed your message, so include how and where to send the items." : act?.to === "rejected" ? "The customer is emailed your reason." : act?.to === "refunded" ? "Use this after you have issued the refund on the order." : undefined}
        size="sm"
        footer={
          <>
            <Button onClick={() => setAct(null)}>Cancel</Button>
            <Button variant={act?.to === "rejected" ? "danger" : "primary"} loading={run.isPending} onClick={() => run.mutate()}>
              Confirm
            </Button>
          </>
        }
      >
        {act && act.to !== "refunded" && (
          <div className="space-y-4">
            {act.to !== "received" && (
              <Field label={act.to === "approved" ? "Message to the customer" : "Reason (sent to the customer)"}>
                {(a) => <Textarea {...a} rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={1000} placeholder={act.to === "approved" ? "Please pack the items securely and send them to: …" : ""} />}
              </Field>
            )}
            {act.to === "received" && (
              <label className="flex items-center justify-between gap-3 text-[13px]">
                Put the items back in stock
                <Switch checked={restock} onChange={setRestock} label="Restock" />
              </label>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ─── Shiprocket ──────────────────────────────────────────────────────────────

type Shiprocket = { enabled: boolean; status: string; lastError: string | null; settings: { pickupLocation?: string; lengthCm?: number; breadthCm?: number; heightCm?: number; defaultWeightGrams?: number }; email: string; hasPassword: boolean };

export function ShiprocketPanel() {
  const { projectId, store, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ shiprocket: Shiprocket }>("integrations/shiprocket");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ email: string; password: string; pickupLocation: string; lengthCm: number; breadthCm: number; heightCm: number; defaultWeightGrams: number } | null>(null);
  const editable = can("secrets:manage");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ shiprocket: Shiprocket }>(storeApi(projectId, "integrations/shiprocket"), { method: "PUT", body }),
    onSuccess: (_r, body) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: body.email || body.password ? "Shiprocket connected" : "Saved" });
      setOpen(false);
    },
    onError: (e) => toast({ tone: "error", title: "Could not save Shiprocket", description: errorMessage(e) }),
  });
  if (store.country !== "IN") return null;
  if (q.isPending) return <Skeleton className="h-28" />;
  if (q.isError) return null;
  const s = q.data.shiprocket;
  const connected = s.status === "connected";
  const form = f ?? { email: "", password: "", pickupLocation: s.settings.pickupLocation ?? "Primary", lengthCm: s.settings.lengthCm ?? 20, breadthCm: s.settings.breadthCm ?? 15, heightCm: s.settings.heightCm ?? 10, defaultWeightGrams: s.settings.defaultWeightGrams ?? 500 };
  const num = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...form, [k]: Math.max(1, Number(e.target.value) || 1) });
  return (
    <Panel
      className="mb-4"
      title="Shiprocket — book couriers automatically"
      description="Create shipments, get the cheapest available courier, print labels and request pickup from the order page. Tracking updates sync back to your orders."
      actions={
        <>
          {connected ? <Badge tone="success">Connected</Badge> : <Badge>Not connected</Badge>}
          {editable && <Button size="sm" onClick={() => setOpen(!open)}>{connected ? "Settings" : "Connect"}</Button>}
          <Switch checked={s.enabled} disabled={!editable || !connected || save.isPending} onChange={(v) => save.mutate({ enabled: v })} label="Use Shiprocket" />
        </>
      }
    >
      {!open ? (
        <p className="text-[13px] text-muted">
          {connected ? `Signed in as ${s.email}. Pickup location: ${s.settings.pickupLocation ?? "not set"}.` : "Create an API user in Shiprocket (Settings → API → Configure) and enter its email and password here."}
          {s.lastError && <span className="block text-danger">{s.lastError}</span>}
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ enabled: s.enabled, email: form.email || undefined, password: form.password || undefined, settings: { pickupLocation: form.pickupLocation, lengthCm: form.lengthCm, breadthCm: form.breadthCm, heightCm: form.heightCm, defaultWeightGrams: form.defaultWeightGrams } });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API user email" hint={connected ? `Saved: ${s.email} — leave blank to keep` : undefined}>{(a) => <Input {...a} type="email" autoComplete="off" value={form.email} onChange={(e) => setF({ ...form, email: e.target.value })} />}</Field>
            <Field label="API user password" hint={s.hasPassword ? "Saved — leave blank to keep" : undefined}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setF({ ...form, password: e.target.value })} />}</Field>
          </div>
          <Field label="Pickup location name" hint="Exactly as it appears in Shiprocket → Settings → Pickup addresses.">{(a) => <Input {...a} value={form.pickupLocation} onChange={(e) => setF({ ...form, pickupLocation: e.target.value })} maxLength={80} />}</Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Default package</p>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Input aria-label="Length cm" type="number" className="w-20" value={form.lengthCm} onChange={num("lengthCm")} />×
              <Input aria-label="Breadth cm" type="number" className="w-20" value={form.breadthCm} onChange={num("breadthCm")} />×
              <Input aria-label="Height cm" type="number" className="w-20" value={form.heightCm} onChange={num("heightCm")} />
              <span className="text-muted">cm,</span>
              <Input aria-label="Weight grams" type="number" className="w-24" value={form.defaultWeightGrams} onChange={num("defaultWeightGrams")} />
              <span className="text-muted">grams</span>
            </div>
          </div>
          <p className="text-xs text-muted">Credentials are checked with Shiprocket before saving and stored encrypted. Bookings are charged to your Shiprocket wallet.</p>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

type ShipmentInfo = { provider: string; awb?: string; courier?: string; labelUrl?: string; status?: string; pickupScheduled?: boolean; syncedAt?: string } | null;

/** Courier booking controls on the order page. */
export function ShipmentCard({ orderId, shipment, eligible, onUpdated }: { orderId: string; shipment: ShipmentInfo; eligible: boolean; onUpdated: (data: unknown) => void }) {
  const { projectId, can } = useStoreCtx();
  const toast = useToast();
  const q = useStoreQuery<{ shiprocket: Shiprocket }>("integrations/shiprocket");
  const run = useMutation({
    mutationFn: (action: "ship-book" | "ship-sync") => api(storeApi(projectId, `orders/${orderId}/${action}`), { method: "POST", body: {} }),
    onSuccess: (data, action) => {
      onUpdated(data);
      toast({ tone: "success", title: action === "ship-book" ? "Courier booked" : "Tracking updated" });
    },
    onError: (e) => toast({ tone: "error", title: "Shiprocket", description: errorMessage(e) }),
  });
  const enabled = q.data?.shiprocket.enabled;
  if (!shipment?.awb && (!enabled || !eligible || !can("store:orders"))) return null;
  return (
    <Card className="p-4 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted">Courier (Shiprocket)</h2>
        <Truck className="size-4 text-subtle" aria-hidden />
      </div>
      {shipment?.awb ? (
        <>
          <p className="mt-1.5 font-medium">{shipment.courier}</p>
          <p className="font-mono text-xs">AWB {shipment.awb}</p>
          {shipment.status && <p className="mt-1 text-xs text-muted">Status: {shipment.status}{shipment.syncedAt ? ` · checked ${timeAgo(shipment.syncedAt)}` : ""}</p>}
          {!shipment.pickupScheduled && <Notice tone="warning">Pickup was not requested automatically. Request it in Shiprocket.</Notice>}
          <div className="mt-3 flex flex-wrap gap-2">
            {shipment.labelUrl && (
              <a href={shipment.labelUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-2.5 text-[13px] hover:bg-surface-2">
                Shipping label <ExternalLink className="size-3" />
              </a>
            )}
            {enabled && (
              <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={run.isPending} onClick={() => run.mutate("ship-sync")}>
                Update tracking
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-muted">Book the cheapest available courier, generate the label and request pickup in one step.</p>
          <Button className="mt-3" size="sm" variant="primary" icon={<Truck className="size-3.5" />} loading={run.isPending} onClick={() => run.mutate("ship-book")}>
            Book courier
          </Button>
        </>
      )}
    </Card>
  );
}

// ─── Shipping labels (EasyPost, Shippo) ──────────────────────────────────────

type LabelProviderInfo = { provider: "easypost" | "shippo"; enabled: boolean; status: string; lastError: string | null; settings: { lengthCm: number; widthCm: number; heightCm: number; defaultWeightGrams: number; contentsType: string }; testMode: boolean | null; webhookUrl: string | null };
const LABEL_NAMES = { easypost: "EasyPost", shippo: "Shippo" };

/** Connect EasyPost or Shippo to buy labels from worldwide carriers. */
export function LabelProvidersPanel() {
  const { projectId, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ providers: LabelProviderInfo[] }>("integrations/labels");
  const [editing, setEditing] = useState<LabelProviderInfo | null>(null);
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const editable = can("secrets:manage");
  const save = useMutation({
    mutationFn: ({ p, body }: { p: string; body: Record<string, unknown> }) => api(storeApi(projectId, `integrations/${p}`), { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: "Saved" });
      setEditing(null);
      setKey("");
      setSecret("");
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
  if (!q.data) return null;
  return (
    <Panel className="mb-4" title="Shipping labels — worldwide carriers" description="Compare USPS, UPS, FedEx, DHL and more, buy a label from the order page, and get tracking updates automatically. Customs forms are filled from the order for international parcels.">
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data.providers.map((p) => (
          <div key={p.provider} className="rounded-[var(--radius-lg)] border border-border p-3.5 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{LABEL_NAMES[p.provider]}</span>
              {p.status === "connected" ? (
                <span className="flex items-center gap-2">
                  {p.testMode && <Badge tone="warning">Test key</Badge>}
                  <Switch label={`Use ${LABEL_NAMES[p.provider]}`} checked={p.enabled} disabled={!editable} onChange={(v) => save.mutate({ p: p.provider, body: { enabled: v } })} />
                </span>
              ) : (
                <Badge>Not connected</Badge>
              )}
            </div>
            {p.lastError && <p className="mt-1 text-xs text-danger">{p.lastError}</p>}
            {p.webhookUrl && (
              <p className="mt-2 text-xs text-muted">
                Tracking webhook: <code className="break-all font-mono text-[11px]">{p.webhookUrl}</code>
              </p>
            )}
            {editable && (
              <Button size="sm" className="mt-3" onClick={() => setEditing(p)}>
                {p.status === "connected" ? "Settings" : "Connect"}
              </Button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={`${LABEL_NAMES[editing.provider]} settings`}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ p: editing.provider, body: { enabled: true, ...(key ? { apiKey: key } : {}), ...(secret ? { webhookSecret: secret } : {}), settings: editing.settings } })}>
                Save
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <Field label="API key" hint={editing.provider === "easypost" ? "Dashboard → API Keys (test keys start with EZTK)." : "Settings → API (test tokens start with shippo_test_)."}>
              {(a) => <Input {...a} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={editing.status === "connected" ? "•••••• saved — leave empty to keep" : ""} autoComplete="off" />}
            </Field>
            {editing.provider === "easypost" && <Field label="Webhook secret (optional)" hint="Set the same secret on the EasyPost webhook to sign tracking updates.">{(a) => <Input {...a} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />}</Field>}
            <div className="grid grid-cols-4 gap-2">
              {(["lengthCm", "widthCm", "heightCm", "defaultWeightGrams"] as const).map((k) => (
                <Field key={k} label={{ lengthCm: "Length cm", widthCm: "Width cm", heightCm: "Height cm", defaultWeightGrams: "Weight g" }[k]}>
                  {(a) => <Input {...a} type="number" min={1} value={editing.settings[k]} onChange={(e) => setEditing({ ...editing, settings: { ...editing.settings, [k]: Math.max(1, Number(e.target.value) || 1) } })} />}
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted">Labels use your business address from Store settings as the return address.</p>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

type LabelShipmentInfo = { provider: string; rates?: { id: string; carrier: string; service: string; amount: number; currency: string; days: number | null }[]; carrier?: string; service?: string; trackingCode?: string; trackingUrl?: string; labelUrl?: string; cost?: number; costCurrency?: string; status?: string } | null;

/** Rates and label buying on the order page. */
export function LabelCard({ orderId, shipment, eligible, onUpdated }: { orderId: string; shipment: LabelShipmentInfo; eligible: boolean; onUpdated: (data: unknown) => void }) {
  const { projectId, can } = useStoreCtx();
  const toast = useToast();
  const q = useStoreQuery<{ providers: LabelProviderInfo[] }>("integrations/labels");
  const [rates, setRates] = useState<LabelShipmentInfo>(shipment?.rates ? shipment : null);
  const ready = q.data?.providers.filter((p) => p.enabled && p.status === "connected") ?? [];
  const getRates = useMutation({
    mutationFn: (provider: string) => api<{ shipment: LabelShipmentInfo }>(storeApi(projectId, `orders/${orderId}/label-rates`), { method: "POST", body: { provider } }),
    onSuccess: (r) => setRates(r.shipment),
    onError: (e) => toast({ tone: "error", title: "Could not get rates", description: errorMessage(e) }),
  });
  const buy = useMutation({
    mutationFn: (rateId: string) => api(storeApi(projectId, `orders/${orderId}/label-buy`), { method: "POST", body: { rateId } }),
    onSuccess: (data) => {
      onUpdated(data);
      setRates(null);
      toast({ tone: "success", title: "Label bought", description: "The order is marked shipped and the customer was emailed." });
    },
    onError: (e) => toast({ tone: "error", title: "Could not buy the label", description: errorMessage(e) }),
  });
  const fmt = (n: number, c: string) => new Intl.NumberFormat("en", { style: "currency", currency: c }).format(n / 100);
  const bought = shipment && ["easypost", "shippo"].includes(shipment.provider) && shipment.labelUrl;
  if (!bought && (!ready.length || !eligible || !can("store:orders"))) return null;
  return (
    <Card className="p-4 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted">Shipping label</h2>
        <Truck className="size-4 text-subtle" aria-hidden />
      </div>
      {bought ? (
        <>
          <p className="mt-1.5 font-medium">
            {shipment!.carrier} {shipment!.service}
          </p>
          <p className="font-mono text-xs">{shipment!.trackingCode}</p>
          {shipment!.status && <p className="mt-1 text-xs text-muted">Status: {shipment!.status.replace(/_/g, " ")}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={shipment!.labelUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-3 hover:bg-surface-2">
              Print label <ExternalLink className="size-3" />
            </a>
            {shipment!.trackingUrl && (
              <a href={shipment!.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-3 hover:bg-surface-2">
                Tracking <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </>
      ) : rates?.rates?.length ? (
        <ul className="mt-2 grid gap-1.5">
          {rates.rates.slice(0, 8).map((r) => (
            <li key={r.id}>
              <button disabled={buy.isPending} onClick={() => buy.mutate(r.id)} className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-2.5 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50">
                <span>
                  <span className="font-medium">{r.carrier}</span> <span className="text-muted">{r.service}</span>
                  {r.days !== null && <span className="block text-xs text-subtle">{r.days} {r.days === 1 ? "day" : "days"}</span>}
                </span>
                <span className="font-medium tabular-nums">{fmt(r.amount, r.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {ready.map((p) => (
            <Button key={p.provider} size="sm" loading={getRates.isPending && getRates.variables === p.provider} onClick={() => getRates.mutate(p.provider)}>
              Get {LABEL_NAMES[p.provider]} rates
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Customer subscriptions ──────────────────────────────────────────────────

type StoreSubscription = { id: string; email: string; title: string; amount: number; currency: string; interval: string; intervalCount: number; provider: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; renewals: number; createdAt: string };

export function SubscriptionsView() {
  const { projectId, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ subscriptions: StoreSubscription[] }>("subscriptions");
  const [cancelling, setCancelling] = useState<StoreSubscription | null>(null);
  const cancel = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `subscriptions/${id}/cancel`), { method: "POST", body: {} }),
    onSuccess: () => {
      setCancelling(null);
      qc.invalidateQueries({ queryKey: ["store", projectId, "subscriptions"] });
      toast({ tone: "success", title: "Subscription cancelled", description: "It ends after the current period." });
    },
    onError: (e) => toast({ tone: "error", title: "Could not cancel", description: errorMessage(e) }),
  });
  const fmt = (n: number, c: string) => new Intl.NumberFormat(c === "INR" ? "en-IN" : "en-US", { style: "currency", currency: c }).format(n / (c === "JPY" ? 1 : 100));
  const every = (i: string, n: number) => (n === 1 ? `/${i}` : ` every ${n} ${i}s`);
  const active = (q.data?.subscriptions ?? []).filter((s) => s.status === "active" && !s.cancelAtPeriodEnd);
  return (
    <div>
      <SubHeader title="Subscriptions" description="Recurring orders from subscription products. Each paid renewal creates a new order to fulfil; customers can cancel from their order page." />
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="mb-3 text-[13px] text-muted">{active.length} active</p>
          <Table head={["Customer", "Product", "Price", "Status", "Renews", "Renewals", ""]} empty={q.data.subscriptions.length === 0 ? <EmptyState title="No subscriptions yet" description="Turn on “Sold as a subscription” on a product to start selling recurring orders." /> : undefined}>
            {q.data.subscriptions.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.email}</td>
                <td className={td}>{s.title}</td>
                <td className={`${td} tabular-nums`}>
                  {fmt(s.amount, s.currency)}
                  <span className="text-muted">{every(s.interval, s.intervalCount)}</span>
                </td>
                <td className={td}>{s.status === "active" && s.cancelAtPeriodEnd ? <Badge tone="warning">Ending</Badge> : <Badge tone={s.status === "active" ? "success" : s.status === "past_due" ? "warning" : "neutral"}>{s.status.replace("_", " ")}</Badge>}</td>
                <td className={`${td} text-muted`}>{s.currentPeriodEnd ? dateTime(s.currentPeriodEnd) : "—"}</td>
                <td className={`${td} tabular-nums`}>{s.renewals}</td>
                <td className={`${td} text-right`}>
                  {can("store:orders") && s.status !== "canceled" && !s.cancelAtPeriodEnd && (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(s)}>
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <Dialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        size="sm"
        title="Cancel this subscription?"
        description={`${cancelling?.email} keeps it until the end of the period they've paid for. No further renewals are charged.`}
        footer={
          <>
            <Button onClick={() => setCancelling(null)}>Keep it</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancelling && cancel.mutate(cancelling.id)}>
              Cancel subscription
            </Button>
          </>
        }
      />
    </div>
  );
}
