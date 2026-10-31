"use client";

// The team's side of the portals: the addresses to share, what customers and
// suppliers see, sending someone a sign-in link, who's signed in (and signing
// them out), and the invoices suppliers sent — download, book as a bill, or
// return with a reason.
import { Copy, DoorOpen, FileText, LogOut, Receipt, Send, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ModuleFrame, useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import { ConfirmDialog, Dialog, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, PageHeader, Select, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import type { PortalSettings } from "@/lib/portal/model";

type Meta = { me: { manage: boolean; books: boolean }; settings: PortalSettings; parts: { customers: boolean; suppliers: boolean }; urls: { customers: string; suppliers: string }; toBook: number };
type Sub = { id: string; invoiceNo: string; date: string; amount: number; note: string; filename: string; status: string; reason: string; billId: string | null; submittedBy: string; createdAt: string; supplier: string; po: string | null };

const usePortal = () => useModule<Meta>();
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function PortalsApp({ path }: { path: string[] }) {
  const [section = ""] = path;
  return (
    <ModuleFrame<Meta>
      api="portal"
      base="portals"
      title="Portals"
      icon={<DoorOpen />}
      section={section}
      nav={(m) => [
        { id: "", label: "Overview", icon: <DoorOpen /> },
        { id: "invoices", label: `Supplier invoices${m.toBook ? ` · ${m.toBook}` : ""}`, icon: <Receipt />, hidden: !m.parts.suppliers },
        { id: "sessions", label: "Signed in", icon: <Users /> },
        { id: "settings", label: "What they see", icon: <Settings />, hidden: !m.me.manage },
      ]}
      render={() => (section === "invoices" ? <InvoicesView /> : section === "sessions" ? <SessionsView /> : section === "settings" ? <SettingsView /> : <Overview />)}
    />
  );
}

function Overview() {
  const { meta } = usePortal();
  const toast = useToast();
  const [invite, setInvite] = useState({ email: "", kind: "customer" as "customer" | "supplier" });
  const send = useModuleAction<void>(() => ({ path: "invite", body: invite }), { success: "Sign-in link sent", onDone: () => setInvite({ ...invite, email: "" }) });
  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => toast({ tone: "success", title: "Copied" }));
  return (
    <div className="space-y-5">
      <PageHeader title="Customer & supplier portals" description="Customers and suppliers sign in with the email you have for them — a one-time link, no password. Each sees only their own records." />
      <div className="grid gap-4 md:grid-cols-2">
        {(["customers", "suppliers"] as const).map((k) => (
          <section key={k} className="space-y-2 rounded-[20px] border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">{k === "customers" ? "Customer portal" : "Supplier portal"} {!meta.parts[k] || !meta.settings[k].enabled ? <Badge>Off</Badge> : <Badge tone="success">On</Badge>}</h2>
            <p className="text-[13px] text-muted">{k === "customers" ? "Their invoices (with your payment details), payments, sales orders with delivery tracking, and support tickets." : "RFQs to quote, purchase orders to acknowledge and dispatch, their bills and payments, and sending you invoices."}</p>
            <div className="flex gap-2"><Input readOnly aria-label={`${k} portal address`} value={meta.urls[k]} /><Button icon={<Copy className="size-3.5" />} onClick={() => copy(meta.urls[k])}>Copy</Button></div>
          </section>
        ))}
      </div>
      <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold">Send someone their sign-in link</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Email" className="min-w-64 flex-1">{(a) => <Input {...a} type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />}</Field>
          <Field label="As a">{(a) => <Select {...a} value={invite.kind} onChange={(e) => setInvite({ ...invite, kind: e.target.value as "customer" | "supplier" })}><option value="customer">Customer</option><option value="supplier">Supplier</option></Select>}</Field>
          <Button variant="primary" icon={<Send className="size-3.5" />} loading={send.isPending} disabled={!invite.email} onClick={() => send.mutate()}>Send link</Button>
        </div>
        <p className="text-[12.5px] text-muted">Customers are known by the email on their invoices, their CRM contact or a ticket; suppliers by the email on the supplier (and not blocked).</p>
      </section>
    </div>
  );
}

function SessionsView() {
  const { meta } = usePortal();
  const q = useModuleQuery<{ sessions: { id: string; kind: string; email: string; createdAt: string; lastSeenAt: string }[] }>("sessions");
  const [out, setOut] = useState<string | null>(null);
  const revoke = useModuleAction<string>((id) => ({ path: `sessions/${id}`, method: "DELETE" }), { success: "Signed out", onDone: () => setOut(null) });
  return (
    <div className="space-y-4">
      <PageHeader title="Signed in" description="Everyone with an active portal session. Sessions last 30 days." />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.sessions.length ? <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">Nobody is signed in.</p> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
              <span><b className="font-medium">{s.email}</b> <Badge>{s.kind}</Badge><span className="block text-[12px] text-muted">Signed in {when(s.createdAt)} · last seen {when(s.lastSeenAt)}</span></span>
              {meta.me.manage && <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => setOut(s.id)}>Sign out</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!out} onClose={() => setOut(null)} onConfirm={() => out && revoke.mutate(out)} loading={revoke.isPending} destructive title="Sign this person out?" description="They'll need a new link to sign in again." confirmLabel="Sign out" />
    </div>
  );
}

function InvoicesView() {
  const { meta, orgId } = usePortal();
  const [status, setStatus] = useState<"submitted" | "billed" | "rejected">("submitted");
  const q = useModuleQuery<{ invoices: Sub[] }>(`submissions?status=${status}`, { keepPrevious: true });
  const [returning, setReturning] = useState<Sub | null>(null);
  const [reason, setReason] = useState("");
  const reject = useModuleAction<void>(() => ({ path: `submissions/${returning?.id}/reject`, body: { reason } }), { success: "Returned to the supplier", onDone: () => (setReturning(null), setReason("")) });
  return (
    <div className="space-y-4">
      <PageHeader title="Supplier invoices" description="Invoices suppliers sent through the portal. Book each as a bill (it's read from the file by AI when a provider is connected) or return it with a reason." />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: "submitted", label: "To book" }, { value: "billed", label: "Booked" }, { value: "rejected", label: "Returned" }]} />
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : !q.data.invoices.length ? <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">Nothing here.</p> : (
        <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">
          {q.data.invoices.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
              <span className="min-w-0">
                <b className="font-medium">{s.supplier}</b> · {s.invoiceNo} · {inr(s.amount)}
                <span className="block text-[12px] text-muted">Dated {s.date}{s.po ? ` · against ${s.po}` : ""} · sent {when(s.createdAt)} by {s.submittedBy}{s.note ? ` · “${s.note}”` : ""}{s.reason ? ` · returned: ${s.reason}` : ""}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                {s.filename && <a className="inline-flex items-center gap-1 text-[13px] font-medium underline" href={`/api/v1/orgs/${orgId}/portal/submissions/${s.id}/file`}><FileText className="size-3.5" />{s.filename}</a>}
                {s.billId && <Link className="text-[13px] font-medium underline" href={`/accounts/bills/${s.billId}`}>Open bill</Link>}
                {s.status === "submitted" && meta.me.books && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setReturning(s)}>Return</Button>
                    <Link href={`/accounts/bills?portalInvoice=${s.id}`} className="inline-flex h-7 items-center rounded-full bg-fg px-3 text-[12.5px] font-medium text-bg">Book as a bill</Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {returning && (
        <Dialog open onClose={() => setReturning(null)} title={`Return ${returning.invoiceNo}?`} description="The supplier is emailed your reason and can send a corrected invoice." footer={<><Button onClick={() => setReturning(null)}>Cancel</Button><Button variant="primary" loading={reject.isPending} disabled={!reason.trim()} onClick={() => reject.mutate()}>Return it</Button></>}>
          <Field label="Reason">{(a) => <Textarea {...a} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </Dialog>
      )}
    </div>
  );
}

function SettingsView() {
  const { meta } = usePortal();
  const [f, setF] = useState<PortalSettings>(meta.settings);
  const save = useModuleAction<void>(() => ({ path: "settings", method: "PUT", body: f }), { success: "Saved" });
  const row = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-[13.5px]"><Switch checked={on} onChange={set} label={label} /> {label}</label>
  );
  const c = f.customers;
  const s = f.suppliers;
  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="What they see" />
      <section className="space-y-2.5 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold">Customers</h2>
        {row("Customers can sign in", c.enabled, (v) => setF({ ...f, customers: { ...c, enabled: v } }))}
        {row("Invoices and payments", c.invoices, (v) => setF({ ...f, customers: { ...c, invoices: v } }))}
        {row("Sales orders and deliveries", c.orders, (v) => setF({ ...f, customers: { ...c, orders: v } }))}
        {row("Support tickets", c.tickets, (v) => setF({ ...f, customers: { ...c, tickets: v } }))}
        <Field label="Welcome message">{(a) => <Textarea {...a} rows={2} value={c.welcome} onChange={(e) => setF({ ...f, customers: { ...c, welcome: e.target.value } })} />}</Field>
      </section>
      <section className="space-y-2.5 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold">Suppliers</h2>
        {row("Suppliers can sign in", s.enabled, (v) => setF({ ...f, suppliers: { ...s, enabled: v } }))}
        {row("RFQs to quote", s.rfqs, (v) => setF({ ...f, suppliers: { ...s, rfqs: v } }))}
        {row("Purchase orders (acknowledge and dispatch)", s.orders, (v) => setF({ ...f, suppliers: { ...s, orders: v } }))}
        {row("Bills, payments and sending invoices", s.invoices, (v) => setF({ ...f, suppliers: { ...s, invoices: v } }))}
        <Field label="Welcome message">{(a) => <Textarea {...a} rows={2} value={s.welcome} onChange={(e) => setF({ ...f, suppliers: { ...s, welcome: e.target.value } })} />}</Field>
      </section>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}
