"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Mail, MailCheck, Search, ShoppingCart, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, ErrorState, Field, Input, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { OrderBadges, storeApi, SubHeader, Table, td, useMoney, useStoreCtx, useStoreQuery } from "./shared";

type Customer = { id: string; email: string; name: string; phone: string; acceptsMarketing: boolean; createdAt: string; orders: number; spent: number; lastOrderAt: string | null };

export function CustomersView() {
  const { base, projectId } = useStoreCtx();
  const money = useMoney();
  const [q, setQ] = useState("");
  const list = useStoreQuery<{ customers: Customer[]; total: number }>(`customers?${new URLSearchParams({ q })}`);
  return (
    <div>
      <SubHeader
        title="Customers"
        description="Everyone who has ordered from your store, sorted by how much they have spent."
        actions={
          <ButtonLink href={storeApi(projectId, "customers/export")} external icon={<Download className="size-3.5" />}>
            Export CSV
          </ButtonLink>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
        <Input aria-label="Search customers" className="pl-8" placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isPending ? (
        <Skeleton className="h-72" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <Table head={["Customer", "Orders", "Total spent", "Last order", "Email updates"]} empty={list.data.customers.length === 0 && <EmptyState icon={<Users className="size-5" />} title={q ? "No matching customers" : "No customers yet"} description={q ? undefined : "Customers are added automatically when they place an order."} />}>
          {list.data.customers.map((c) => (
            <tr key={c.id} className="hover:bg-surface-2/60">
              <td className={`${td} max-w-[260px]`}>
                <Link href={`${base}/customers/${c.id}`} className="block truncate font-medium hover:underline">
                  {c.name || c.email}
                </Link>
                <p className="truncate text-xs text-muted">{c.email}</p>
              </td>
              <td className={`${td} tabular-nums`}>{c.orders}</td>
              <td className={`${td} font-medium tabular-nums`}>{money(c.spent)}</td>
              <td className={`${td} text-muted`}>{c.lastOrderAt ? timeAgo(c.lastOrderAt) : "—"}</td>
              <td className={td}>{c.acceptsMarketing ? <Badge tone="success">Subscribed</Badge> : <span className="text-xs text-muted">No</span>}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

type CustomerDetailT = {
  customer: Customer;
  orders: { id: string; number: number; total: number; financialStatus: string; fulfillmentStatus: string; cancelledAt: string | null; createdAt: string; address: { line1: string; city: string; region: string; postalCode: string; country: string } }[];
};

export function CustomerDetail({ id }: { id: string }) {
  const { base, store } = useStoreCtx();
  const money = useMoney();
  const q = useStoreQuery<CustomerDetailT>(`customers/${id}`);
  if (q.isPending) return <Skeleton className="h-80" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { customer: c, orders } = q.data;
  const live = orders.filter((o) => !o.cancelledAt);
  const spent = live.reduce((a, o) => a + o.total, 0);
  const last = orders[0]?.address;
  return (
    <div>
      <SubHeader back={{ href: `${base}/customers`, label: "Customers" }} title={c.name || c.email} description={`Customer since ${dateTime(c.createdAt).split(",")[0]}`} />
      <div className="grid-cols-2 mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted">Total spent</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{money(spent)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Orders</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{live.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Average order</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{live.length ? money(Math.round(spent / live.length)) : "—"}</p>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Table head={["Order", "Date", "Status", "Total"]}>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className={td}>
                <Link href={`${base}/orders/${o.id}`} className="font-medium hover:underline">
                  {store.orderPrefix}
                  {o.number}
                </Link>
              </td>
              <td className={`${td} text-muted`}>{timeAgo(o.createdAt)}</td>
              <td className={td}>
                <OrderBadges financial={o.financialStatus} fulfillment={o.fulfillmentStatus} cancelled={o.cancelledAt} />
              </td>
              <td className={`${td} text-right tabular-nums`}>{money(o.total)}</td>
            </tr>
          ))}
        </Table>
        <Card className="h-fit p-4 text-[13px]">
          <h2 className="text-xs font-medium text-muted">Contact</h2>
          <a href={`mailto:${c.email}`} className="mt-1.5 block truncate text-accent hover:underline">
            {c.email}
          </a>
          {c.phone && (
            <a href={`tel:${c.phone}`} className="block text-muted hover:text-fg">
              {c.phone}
            </a>
          )}
          <p className="mt-2">{c.acceptsMarketing ? <Badge tone="success">Agreed to email updates</Badge> : <Badge>No marketing emails</Badge>}</p>
          {last && (
            <>
              <h2 className="mt-4 text-xs font-medium text-muted">Last delivery address</h2>
              <address className="mt-1.5 not-italic">
                {last.line1}
                <br />
                {last.city}, {last.region} {last.postalCode}
                <br />
                {last.country}
              </address>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

type Abandoned = { id: string; email: string; consent: boolean; whatsapp: boolean; whatsappRemindedAt: string | null; updatedAt: string; recoveryEmailedAt: string | null; items: { title: string; quantity: number }[]; value: number; currency: string };

export function AbandonedView() {
  const { projectId, liveUrl } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useStoreQuery<{ carts: Abandoned[] }>("abandoned");
  const remind = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `abandoned/${id}`), { method: "POST", body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "abandoned"] });
      toast({ tone: "success", title: "Reminder sent" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not send", description: errorMessage(e) }),
  });
  const waRemind = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `abandoned/${id}/whatsapp`), { method: "POST", body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "abandoned"] });
      toast({ tone: "success", title: "WhatsApp reminder sent" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not send", description: errorMessage(e) }),
  });
  const total = list.data?.carts.reduce((a, c) => a + c.value, 0) ?? 0;
  return (
    <div>
      <SubHeader title="Abandoned carts" description="Shoppers who entered their email at checkout but did not finish, in the last 30 days." />
      <RecoveryPanel />
      {list.data && list.data.carts.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-xs text-muted">Carts left behind</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{list.data.carts.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Value left in carts</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{money(total)}</p>
          </Card>
        </div>
      )}
      {list.isPending ? (
        <Skeleton className="h-60" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <Table head={["Shopper", "Cart", "Value", "Left", ""]} empty={list.data.carts.length === 0 && <EmptyState icon={<ShoppingCart className="size-5" />} title="No abandoned carts" description="Carts appear here an hour after a shopper stops at checkout." />}>
          {list.data.carts.map((c) => (
            <tr key={c.id}>
              <td className={`${td} max-w-[220px] truncate`}>{c.email}</td>
              <td className={`${td} max-w-[280px] truncate text-muted`}>{c.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}</td>
              <td className={`${td} tabular-nums`}>{money(c.value)}</td>
              <td className={`${td} text-muted`}>{timeAgo(c.updatedAt)}</td>
              <td className={`${td} text-right whitespace-nowrap`}>
                {c.whatsapp && !c.whatsappRemindedAt && (
                  <Button size="sm" variant="ghost" className="mr-1" loading={waRemind.isPending && waRemind.variables === c.id} disabled={!liveUrl} onClick={() => waRemind.mutate(c.id)}>
                    WhatsApp
                  </Button>
                )}
                {c.recoveryEmailedAt ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <MailCheck className="size-3.5" aria-hidden /> Sent {timeAgo(c.recoveryEmailedAt)}
                  </span>
                ) : c.consent ? (
                  <Button size="sm" icon={<Mail className="size-3.5" />} loading={remind.isPending && remind.variables === c.id} disabled={!liveUrl} onClick={() => remind.mutate(c.id)}>
                    Send reminder
                  </Button>
                ) : (
                  <span className="text-xs text-muted" title="Only shoppers who agreed to emails can be contacted">
                    No email consent
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

type Member = { id: string; email: string; name: string; orderId: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };

/** People with access to members-only pages. */
export function MembersView() {
  const { projectId, base } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ members: Member[] }>("members");
  const [form, setForm] = useState({ email: "", name: "", days: "" });
  const add = useMutation({
    mutationFn: () => api(storeApi(projectId, "members"), { method: "POST", body: { email: form.email, name: form.name, days: form.days ? Number(form.days) : null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "members"] });
      setForm({ email: "", name: "", days: "" });
      toast({ tone: "success", title: "Member added" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not add", description: errorMessage(e) }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `members/${id}/revoke`), { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", projectId, "members"] }),
    onError: (e) => toast({ tone: "error", title: "Could not revoke", description: errorMessage(e) }),
  });
  const status = (m: Member) => (m.revokedAt ? { label: "Revoked", tone: "neutral" as const } : m.expiresAt && new Date(m.expiresAt).getTime() < q.dataUpdatedAt ? { label: "Expired", tone: "neutral" as const } : { label: "Active", tone: "success" as const });
  return (
    <div>
      <SubHeader title="Members" description="People who can open your members-only pages. Memberships are added when someone buys a membership product, or by you here." />
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.email) add.mutate();
        }}
      >
        <Input aria-label="Email" type="email" placeholder="member@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-60" required />
        <Input aria-label="Name" placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-44" />
        <Input aria-label="Days of access" type="number" min={1} placeholder="Days (blank = lifetime)" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} className="w-48" />
        <Button type="submit" variant="primary" loading={add.isPending}>
          Add member
        </Button>
      </form>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Table head={["Member", "Access until", "Source", "Status", ""]} empty={q.data.members.length === 0 && <EmptyState icon={<Users className="size-5" />} title="No members yet" description="Mark pages as “Members only” in the builder, then sell a membership product or add people here." />}>
          {q.data.members.map((m) => {
            const s = status(m);
            return (
              <tr key={m.id}>
                <td className={td}>
                  <p className="font-medium">{m.name || m.email}</p>
                  {m.name && <p className="text-xs text-muted">{m.email}</p>}
                </td>
                <td className={`${td} text-muted`}>{m.expiresAt ? dateTime(m.expiresAt).split(",")[0] : "Lifetime"}</td>
                <td className={td}>
                  {m.orderId ? (
                    <Link href={`${base}/orders/${m.orderId}`} className="text-accent hover:underline">
                      Order
                    </Link>
                  ) : (
                    <span className="text-muted">Added manually</span>
                  )}
                </td>
                <td className={td}>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </td>
                <td className={`${td} text-right`}>
                  {!m.revokedAt && (
                    <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === m.id} onClick={() => revoke.mutate(m.id)}>
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

type Recovery = {
  settings: { enabled: boolean; delayHours: number; email: boolean; whatsapp: boolean; discountCode: string };
  ready: { email: boolean; whatsapp: boolean; published: boolean };
  stats: { sent: number; cameBack: number; orders: number; revenue: number };
};

/** Automatic recovery: settings, readiness and what it has brought back. */
function RecoveryPanel() {
  const { projectId, can } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<Recovery>("recovery");
  const [draft, setDraft] = useState<Recovery["settings"] | null>(null);
  const save = useMutation({
    mutationFn: (s: Recovery["settings"]) => api<Recovery>(storeApi(projectId, "recovery"), { method: "PUT", body: s }),
    onSuccess: (r) => {
      qc.setQueryData(["store", projectId, "recovery"], r);
      setDraft(null);
      toast({ tone: "success", title: r.settings.enabled ? "Automatic recovery is on" : "Saved" });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) }),
  });
  if (!q.data) return <Skeleton className="mb-4 h-40" />;
  const s = draft ?? q.data.settings;
  const set = (patch: Partial<Recovery["settings"]>) => setDraft({ ...s, ...patch });
  const { stats, ready } = q.data;
  const editable = can("store:manage");
  return (
    <Card className="tint-card tint-lavender mb-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-[var(--t-ink)]" /> Automatic recovery</p>
          <p className="mt-1 text-[13px] text-muted">A while after a shopper leaves, we send one friendly reminder with a link that restores their cart on any device — optionally with a discount. Only shoppers who agreed to hear from you are contacted, and never twice.</p>
        </div>
        <Switch checked={s.enabled} disabled={!editable} onChange={(v) => save.mutate({ ...s, enabled: v })} label={s.enabled ? "On" : "Off"} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Reminders sent", stats.sent], ["Came back", stats.cameBack], ["Recovered orders", stats.orders], ["Recovered revenue", money(stats.revenue)]].map(([l, v]) => (
          <div key={l as string} className="rounded-[14px] bg-[var(--surface-solid)]/70 p-3 ring-1 ring-fg/[0.05]">
            <p className="text-[11.5px] text-muted">{l} · 30 days</p>
            <p className="mt-0.5 text-[18px] font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {editable && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Send after">{(a) => <Select {...a} value={s.delayHours} onChange={(e) => set({ delayHours: Number(e.target.value) })}>{[1, 3, 6, 12, 24].map((h) => <option key={h} value={h}>{h === 1 ? "1 hour" : `${h} hours`}</option>)}</Select>}</Field>
          <Field label="Discount code (optional)" hint="Applied automatically through the link.">{(a) => <Input {...a} value={s.discountCode} placeholder="COMEBACK10" onChange={(e) => set({ discountCode: e.target.value.toUpperCase() })} maxLength={40} />}</Field>
          <div className="grid content-end gap-2 pb-1 text-[13px]">
            <span className="flex items-center gap-2.5"><Switch checked={s.email} onChange={(v) => set({ email: v })} label="Send by email" /> Email</span>
            <span className={cx("flex items-center gap-2.5", !ready.whatsapp && "text-muted")}><Switch checked={s.whatsapp} disabled={!ready.whatsapp && !s.whatsapp} onChange={(v) => set({ whatsapp: v })} label="Send on WhatsApp" /> {ready.whatsapp ? "WhatsApp" : "WhatsApp (connect first)"}</span>
          </div>
          <div className="flex items-end justify-end">
            <Button variant="primary" disabled={!draft} loading={save.isPending} onClick={() => save.mutate(s)}>Save</Button>
          </div>
        </div>
      )}
      {(!ready.published || !ready.email) && (
        <ul className={cx("mt-3 grid gap-1 text-[12px]", "text-warning")}>
          {!ready.published && <li>• Publish your store first — reminders link to your live store, so none are sent until it&apos;s published.</li>}
          {!ready.email && <li>• Email delivery isn&apos;t set up on this server, so reminder emails are saved to the outbox rather than sent.</li>}
        </ul>
      )}
    </Card>
  );
}
