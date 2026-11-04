"use client";

// A workspace's portal as its customers and suppliers see it: signing in with
// a one-time emailed link, then — for customers — what they owe, invoices,
// payments, orders and support; for suppliers — RFQs to quote, orders to
// acknowledge and dispatch, and their invoices and bills.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Tabs } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, Notice, Select, Skeleton, Textarea, cx, FormLines } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

type Kind = "customer" | "supplier";
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function PortalPage({ slug }: { slug: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const kind: Kind = params.get("kind") === "supplier" ? "supplier" : "customer";
  const token = params.get("t");
  const base = `/api/v1/portal/${slug}`;
  const area = kind === "customer" ? "c" : "s";
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["portal", slug, "info"], queryFn: () => api<{ name: string; customers: boolean; suppliers: boolean }>(`${base}/info`), retry: false });
  const [signInError, setSignInError] = useState("");
  const used = useRef(false);
  useEffect(() => {
    if (!token || used.current) return;
    used.current = true;
    api(`${base}/signin`, { method: "POST", body: { token } })
      .then(() => qc.invalidateQueries({ queryKey: ["portal", slug] }))
      .catch((e) => setSignInError(errorMessage(e)))
      .finally(() => router.replace(`/portal/${slug}?kind=${kind}`));
  }, [token, base, kind, slug, router, qc]);
  const me = useQuery({ queryKey: ["portal", slug, area, "me"], queryFn: () => api<{ email: string; name: string }>(`${base}/${area}/me`), retry: false, enabled: !token });
  if (info.isError) return <Shell><Notice tone="danger" title="This portal isn't available">Check the address, or ask the business for a new link.</Notice></Shell>;
  if (!info.data || token || me.isLoading) return <Shell><Skeleton className="h-60 rounded-[20px]" /></Shell>;
  const open = kind === "customer" ? info.data.customers : info.data.suppliers;
  if (!open) return <Shell><Notice tone="warning" title="This portal is closed">{info.data.name} hasn&apos;t opened its {kind} portal.</Notice></Shell>;
  if (!me.data) return <Shell><SignIn base={base} kind={kind} name={info.data.name} other={kind === "customer" ? info.data.suppliers : info.data.customers} slug={slug} error={signInError} /></Shell>;
  const signOut = async () => {
    await api(`${base}/signout/${kind}`, { method: "POST" }).catch(() => {});
    qc.removeQueries({ queryKey: ["portal", slug, area] });
    await me.refetch();
  };
  return (
    <Shell wide>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.14em] text-subtle uppercase">{kind === "customer" ? "Customer portal" : "Supplier portal"}</p>
          <h1 className="text-2xl font-semibold">{info.data.name}</h1>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted">{me.data.email}<Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={signOut}>Sign out</Button></div>
      </header>
      {kind === "customer" ? <Customer base={`${base}/c`} slug={slug} /> : <Supplier base={`${base}/s`} slug={slug} />}
    </Shell>
  );
}

function SignIn({ base, kind, name, other, slug, error }: { base: string; kind: Kind; name: string; other: boolean; slug: string; error: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({ mutationFn: () => api(`${base}/link`, { method: "POST", body: { email, kind } }), onSuccess: () => setSent(true) });
  return (
    <div className="mx-auto max-w-md space-y-4 pt-10">
      <p className="text-[12px] font-semibold tracking-[0.14em] text-subtle uppercase">{kind === "customer" ? "Customer portal" : "Supplier portal"}</p>
      <h1 className="text-2xl font-semibold">{name}</h1>
      {error && <Notice tone="danger">{error}</Notice>}
      {sent ? (
        <Notice tone="success" title="Check your email">If {email} is an address {name} has for you, a sign-in link is on its way. It works once, for 30 minutes.</Notice>
      ) : (
        <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), send.mutate())}>
          <p className="text-[14px] text-muted">{kind === "customer" ? "See your invoices, orders and support requests." : "Quote RFQs, follow your purchase orders and send invoices."} Enter the email {name} has for you and we&apos;ll send a sign-in link.</p>
          <Field label="Email">{(a) => <Input {...a} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          {send.isError && <Notice tone="danger">{errorMessage(send.error)}</Notice>}
          <Button type="submit" variant="primary" loading={send.isPending} disabled={!email}>Email me a link</Button>
        </form>
      )}
      {other && <p className="text-[13px] text-muted"><a className="underline" href={`/portal/${slug}?kind=${kind === "customer" ? "supplier" : "customer"}`}>{kind === "customer" ? "Are you a supplier?" : "Are you a customer?"}</a></p>}
    </div>
  );
}

function usePortalQuery<T>(slug: string, base: string, path: string) {
  return useQuery({ queryKey: ["portal", slug, base.endsWith("/c") ? "c" : "s", path], queryFn: () => api<T>(`${base}/${path}`), retry: false });
}

function usePost(slug: string, area: "c" | "s") {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const post = async (url: string, body: unknown, done?: () => void) => {
    setBusy(true);
    setError("");
    try {
      await api(url, { method: "POST", body });
      await qc.invalidateQueries({ queryKey: ["portal", slug, area] });
      done?.();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { post, error, busy, setError };
}

const Card = ({ label, value, tone }: { label: string; value: string; tone?: "danger" }) => (
  <div className="rounded-[18px] border border-border bg-surface p-4"><p className="text-[12px] text-muted">{label}</p><p className={cx("mt-1 text-xl font-semibold tabular-nums", tone === "danger" && "text-danger")}>{value}</p></div>
);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "accent"> = { paid: "success", overdue: "danger", "part paid": "warning", due: "accent", void: "neutral", issued: "neutral" };

// ── Customers ───────────────────────────────────────────────────────────────

type CHome = { welcome: string; sections: { invoices: boolean; orders: boolean; tickets: boolean }; outstanding: number; overdue: number; openInvoices: Inv[]; openOrders: Order[]; openTickets: Ticket[] };
type Inv = { id: string; type: string; number: string; date: string; dueDate: string | null; currency: string; total: number; amountPaid: number; balance: number; status: string; url: string };
type Order = { id: string; number: string; date: string; expectedDate: string | null; status: string; total: number; lines: { name: string; qty: number; unit: string; delivered: number }[]; deliveries: { number: string; date: string; status: string; tracking: string | null }[] };
type Ticket = { id: string; number: string; subject: string; status: string; createdAt: string; url: string };

function Customer({ base, slug }: { base: string; slug: string }) {
  const home = usePortalQuery<CHome>(slug, base, "home");
  const [tab, setTab] = useState("home");
  if (!home.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const s = home.data.sections;
  const tabs = [{ value: "home", label: "Overview" }, ...(s.invoices ? [{ value: "invoices", label: "Invoices" }, { value: "payments", label: "Payments" }] : []), ...(s.orders ? [{ value: "orders", label: "Orders" }] : []), ...(s.tickets ? [{ value: "tickets", label: "Support" }] : [])];
  return (
    <div className="space-y-5">
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "home" && (
        <div className="space-y-5">
          {home.data.welcome && <Notice>{home.data.welcome}</Notice>}
          {s.invoices && <div className="grid gap-3 sm:grid-cols-2"><Card label="You owe" value={inr(home.data.outstanding)} /><Card label="Overdue" value={inr(home.data.overdue)} tone={home.data.overdue ? "danger" : undefined} /></div>}
          {s.invoices && <section><h2 className="mb-2 text-[15px] font-semibold">To pay</h2>{home.data.openInvoices.length ? <InvoiceTable rows={home.data.openInvoices} /> : <Empty>Nothing to pay. Thank you!</Empty>}</section>}
          {s.orders && !!home.data.openOrders.length && <section><h2 className="mb-2 text-[15px] font-semibold">Orders on the way</h2><Orders rows={home.data.openOrders} /></section>}
          {s.tickets && !!home.data.openTickets.length && <section><h2 className="mb-2 text-[15px] font-semibold">Open requests</h2><TicketList rows={home.data.openTickets} /></section>}
        </div>
      )}
      {tab === "invoices" && <InvoicesTab slug={slug} base={base} />}
      {tab === "payments" && <PaymentsTab slug={slug} base={base} />}
      {tab === "orders" && <OrdersTab slug={slug} base={base} />}
      {tab === "tickets" && <TicketsTab slug={slug} base={base} />}
    </div>
  );
}

function InvoiceTable({ rows }: { rows: Inv[] }) {
  return (
    <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
      <table className="w-full min-w-[560px] text-[13.5px]">
        <thead className="border-b border-border text-left text-[12px] text-muted"><tr><th className="px-4 py-2 font-medium">Invoice</th><th className="px-4 py-2 font-medium">Due</th><th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-right font-medium">To pay</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((i) => (
            <tr key={i.id}>
              <td className="px-4 py-2"><a href={i.url} target="_blank" rel="noreferrer" className="font-medium underline">{i.number}</a>{i.type === "credit_note" && <span className="ml-1 text-muted">(credit note)</span>}<span className="block text-[12px] text-muted">{date(i.date)}</span></td>
              <td className="px-4 py-2">{date(i.dueDate)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{i.currency === "INR" ? inr(i.total) : `${i.currency} ${(i.total / 100).toFixed(2)}`}</td>
              <td className="px-4 py-2 text-right font-medium tabular-nums">{i.balance ? inr(i.balance) : "—"}</td>
              <td className="px-4 py-2"><Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTab({ slug, base }: { slug: string; base: string }) {
  const q = usePortalQuery<{ invoices: Inv[] }>(slug, base, "invoices");
  if (!q.data) return <Skeleton className="h-40 rounded-[20px]" />;
  return q.data.invoices.length ? <><p className="text-[13px] text-muted">Open an invoice to see it in full, download it, and find how to pay.</p><InvoiceTable rows={q.data.invoices} /></> : <Empty>No invoices yet.</Empty>;
}

function PaymentsTab({ slug, base }: { slug: string; base: string }) {
  const q = usePortalQuery<{ payments: { id: string; amount: number; method: string; paidOn: string; invoice: string }[] }>(slug, base, "payments");
  if (!q.data) return <Skeleton className="h-40 rounded-[20px]" />;
  if (!q.data.payments.length) return <Empty>No payments recorded yet.</Empty>;
  return <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{q.data.payments.map((p) => <li key={p.id} className="flex justify-between px-4 py-2.5 text-[13.5px]"><span>{date(p.paidOn)} · {p.invoice} · {p.method.toUpperCase()}</span><b className="font-medium tabular-nums">{inr(p.amount)}</b></li>)}</ul>;
}

function Orders({ rows }: { rows: Order[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((o) => (
        <li key={o.id} className="rounded-[20px] border border-border bg-surface p-4 text-[13.5px]">
          <div className="flex flex-wrap justify-between gap-2"><b className="font-medium">{o.number} · {date(o.date)}</b><span className="flex items-center gap-2"><Badge>{o.status}</Badge><span className="tabular-nums">{inr(o.total)}</span></span></div>
          <ul className="mt-2 text-muted">{o.lines.map((l, i) => <li key={i}>{l.name} — {l.delivered}/{l.qty} {l.unit} delivered</li>)}</ul>
          {!!o.deliveries.length && <ul className="mt-2 space-y-1">{o.deliveries.map((d) => <li key={d.number}>Delivery {d.number} · {date(d.date)} · {d.status}{d.tracking && <> · <a className="underline" href={d.tracking} target="_blank" rel="noreferrer">Track</a></>}</li>)}</ul>}
        </li>
      ))}
    </ul>
  );
}

function OrdersTab({ slug, base }: { slug: string; base: string }) {
  const q = usePortalQuery<{ orders: Order[] }>(slug, base, "orders");
  if (!q.data) return <Skeleton className="h-40 rounded-[20px]" />;
  return q.data.orders.length ? <Orders rows={q.data.orders} /> : <Empty>No orders yet.</Empty>;
}

function TicketList({ rows }: { rows: Ticket[] }) {
  return <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{rows.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]"><a className="min-w-0 truncate underline" href={t.url}>{t.number} · {t.subject}</a><Badge tone={t.status === "resolved" || t.status === "closed" ? "success" : "accent"}>{t.status.replace("_", " ")}</Badge></li>)}</ul>;
}

function TicketsTab({ slug, base }: { slug: string; base: string }) {
  const q = usePortalQuery<{ tickets: Ticket[] }>(slug, base, "tickets");
  const [f, setF] = useState({ subject: "", body: "" });
  const [done, setDone] = useState("");
  const { post, error, busy } = usePost(slug, "c");
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold">Ask for help</h2>
        {done && <Notice tone="success">Request {done} sent — we&apos;ve emailed you a copy.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Subject">{(a) => <Input {...a} value={f.subject} maxLength={200} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
        <Field label="Details">{(a) => <Textarea {...a} rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <Button variant="primary" loading={busy} disabled={!f.subject.trim() || !f.body.trim()} onClick={async () => { const subject = f.subject; if (await post(`${base}/tickets`, f, () => setF({ subject: "", body: "" }))) setDone(subject); }}>Send request</Button>
      </section>
      {!q.data ? <Skeleton className="h-40 rounded-[20px]" /> : q.data.tickets.length ? <TicketList rows={q.data.tickets} /> : <Empty>No requests yet.</Empty>}
    </div>
  );
}

// ── Suppliers ───────────────────────────────────────────────────────────────

type SHome = { supplier: { name: string; gstin: string }; welcome: string; sections: { rfqs: boolean; orders: boolean; invoices: boolean }; toQuote: number; toAcknowledge: number; openOrders: number; due: number };
type Rfq = { id: string; number: string; dueDate: string | null; notes: string; lines: { itemId: string; qty: number; name: string; unit: string; sku: string }[]; quote: { lines: { itemId: string; rate: number; gstRate: number; leadDays: number }[]; validTill: string | null; terms: string } | null };
type Po = { id: string; number: string; orderDate: string; expectedDate: string | null; status: string; stage: string; deliverTo: string; total: number; lines: { name: string; unit: string; qty: number; rate: number; gstRate: number; received: number }[]; ack: { promisedDate: string | null; note: string } | null; dispatches: { id: string; date: string; reference: string; carrier: string }[]; canRespond: boolean };

function Supplier({ base, slug }: { base: string; slug: string }) {
  const home = usePortalQuery<SHome>(slug, base, "home");
  const [tab, setTab] = useState("home");
  if (!home.data) return <Skeleton className="h-60 rounded-[20px]" />;
  const s = home.data.sections;
  const h = home.data;
  const tabs = [{ value: "home", label: "Overview" }, ...(s.rfqs ? [{ value: "rfqs", label: `RFQs${h.toQuote ? ` · ${h.toQuote}` : ""}` }] : []), ...(s.orders ? [{ value: "orders", label: "Purchase orders" }] : []), ...(s.invoices ? [{ value: "invoices", label: "Invoices & payments" }] : [])];
  return (
    <div className="space-y-5">
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "home" && (
        <div className="space-y-4">
          <p className="text-[14px]">Signed in for <b className="font-medium">{h.supplier.name}</b>{h.supplier.gstin && ` (${h.supplier.gstin})`}</p>
          {h.welcome && <Notice>{h.welcome}</Notice>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {s.rfqs && <Card label="RFQs to quote" value={String(h.toQuote)} />}
            {s.orders && <Card label="Orders to acknowledge" value={String(h.toAcknowledge)} />}
            {s.orders && <Card label="Open orders" value={String(h.openOrders)} />}
            {s.invoices && <Card label="Still to be paid to you" value={inr(h.due)} />}
          </div>
        </div>
      )}
      {tab === "rfqs" && <RfqsTab slug={slug} base={base} />}
      {tab === "orders" && <PosTab slug={slug} base={base} />}
      {tab === "invoices" && <SupplierInvoicesTab slug={slug} base={base} />}
    </div>
  );
}

function RfqsTab({ slug, base }: { slug: string; base: string }) {
  const q = usePortalQuery<{ rfqs: Rfq[] }>(slug, base, "rfqs");
  if (!q.data) return <Skeleton className="h-40 rounded-[20px]" />;
  if (!q.data.rfqs.length) return <Empty>No open requests for quotation.</Empty>;
  return <div className="space-y-4">{q.data.rfqs.map((r) => <RfqCard key={r.id} r={r} slug={slug} base={base} />)}</div>;
}

function RfqCard({ r, slug, base }: { r: Rfq; slug: string; base: string }) {
  const { post, error, busy } = usePost(slug, "s");
  const [lines, setLines] = useState(r.lines.map((l) => { const q = r.quote?.lines.find((x) => x.itemId === l.itemId); return { itemId: l.itemId, rate: q ? String(q.rate / 100) : "", gstRate: q?.gstRate ?? 18, leadDays: q?.leadDays ?? 7 }; }));
  const [validTill, setValidTill] = useState(r.quote?.validTill ?? "");
  const [terms, setTerms] = useState(r.quote?.terms ?? "");
  const [ok, setOk] = useState(false);
  const set = (i: number, p: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const quoted = lines.filter((l) => l.rate !== "" && Number(l.rate) >= 0);
  return (
    <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-[15px] font-semibold">{r.number}</h2><span className="text-[13px] text-muted">{r.dueDate ? `Quote by ${date(r.dueDate)}` : ""}{r.quote && <Badge tone="success">Quoted</Badge>}</span></div>
      {r.notes && <p className="text-[13px] text-muted">{r.notes}</p>}
      <div className="overflow-x-auto">
        <FormLines className="w-full min-w-[560px] text-[13px]">
          <thead className="text-left text-muted"><tr><th className="py-1 font-medium">Item</th><th className="py-1 font-medium">Qty</th><th className="py-1 font-medium">Rate per unit (₹, before GST)</th><th className="py-1 font-medium">GST %</th><th className="py-1 font-medium">Days to deliver</th></tr></thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={l.itemId}>
                <td className="py-1 pr-2">{l.name}{l.sku && <span className="text-muted"> · {l.sku}</span>}</td>
                <td className="py-1 pr-2 tabular-nums">{l.qty} {l.unit}</td>
                <td className="py-1 pr-2"><Input aria-label={`Rate for ${l.name}`} type="number" min={0} step="0.01" value={lines[i].rate} onChange={(e) => set(i, { rate: e.target.value })} /></td>
                <td className="py-1 pr-2"><Select aria-label={`GST for ${l.name}`} value={lines[i].gstRate} onChange={(e) => set(i, { gstRate: Number(e.target.value) })}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</Select></td>
                <td className="py-1"><Input aria-label={`Days for ${l.name}`} type="number" min={0} value={lines[i].leadDays} onChange={(e) => set(i, { leadDays: Number(e.target.value) })} /></td>
              </tr>
            ))}
          </tbody>
        </FormLines>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Valid till">{(a) => <Input {...a} type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} />}</Field>
        <Field label="Terms">{(a) => <Input {...a} value={terms} maxLength={1000} onChange={(e) => setTerms(e.target.value)} placeholder="Payment, freight, packing…" />}</Field>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {ok && <Notice tone="success">Quote sent.</Notice>}
      <Button variant="primary" loading={busy} disabled={!quoted.length} onClick={() => post(`${base}/rfqs/${r.id}/quote`, { lines: quoted.map((l) => ({ ...l, rate: Number(l.rate) })), validTill: validTill || null, terms }, () => setOk(true))}>{r.quote ? "Update quote" : "Send quote"}</Button>
    </section>
  );
}

function PosTab({ slug, base }: { slug: string; base: string }) {
  const q = usePortalQuery<{ orders: Po[] }>(slug, base, "orders");
  if (!q.data) return <Skeleton className="h-40 rounded-[20px]" />;
  if (!q.data.orders.length) return <Empty>No purchase orders yet.</Empty>;
  return <div className="space-y-4">{q.data.orders.map((p) => <PoCard key={p.id} p={p} slug={slug} base={base} />)}</div>;
}

function PoCard({ p, slug, base }: { p: Po; slug: string; base: string }) {
  const { post, error, busy } = usePost(slug, "s");
  const [ack, setAck] = useState({ promisedDate: p.ack?.promisedDate ?? p.expectedDate ?? "", note: p.ack?.note ?? "" });
  const [disp, setDisp] = useState({ date: todayIst(), reference: "", carrier: "", note: "" });
  return (
    <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5 text-[13.5px]">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-[15px] font-semibold">{p.number} · {date(p.orderDate)}</h2><span className="flex items-center gap-2"><Badge tone={p.stage.startsWith("Awaiting") ? "warning" : "neutral"}>{p.stage}</Badge><b className="font-medium tabular-nums">{inr(p.total)}</b></span></div>
      <p className="text-muted">Deliver to {p.deliverTo}{p.expectedDate ? ` by ${date(p.expectedDate)}` : ""}</p>
      <ul>{p.lines.map((l, i) => <li key={i}>{l.name} — {l.qty} {l.unit} at {inr(l.rate)} + {l.gstRate}% GST{l.received ? ` · ${l.received} received` : ""}</li>)}</ul>
      {!!p.dispatches.length && <ul className="text-muted">{p.dispatches.map((d) => <li key={d.id}>Dispatched {date(d.date)} · {d.reference}{d.carrier ? ` (${d.carrier})` : ""}</li>)}</ul>}
      {error && <Notice tone="danger">{error}</Notice>}
      {p.canRespond && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-[16px] bg-surface-2 p-3">
            <p className="font-medium">{p.ack ? "Update your acknowledgement" : "Acknowledge this order"}</p>
            <Field label="We'll deliver by">{(a) => <Input {...a} type="date" value={ack.promisedDate} onChange={(e) => setAck({ ...ack, promisedDate: e.target.value })} />}</Field>
            <Field label="Note">{(a) => <Input {...a} value={ack.note} onChange={(e) => setAck({ ...ack, note: e.target.value })} />}</Field>
            <Button size="sm" variant="primary" loading={busy} onClick={() => post(`${base}/orders/${p.id}/ack`, { promisedDate: ack.promisedDate || null, note: ack.note })}>Acknowledge</Button>
          </div>
          <div className="space-y-2 rounded-[16px] bg-surface-2 p-3">
            <p className="font-medium">Tell us what you&apos;ve dispatched</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Dispatch date">{(a) => <Input {...a} type="date" value={disp.date} onChange={(e) => setDisp({ ...disp, date: e.target.value })} />}</Field>
              <Field label="LR / AWB / challan no.">{(a) => <Input {...a} value={disp.reference} onChange={(e) => setDisp({ ...disp, reference: e.target.value })} />}</Field>
            </div>
            <Field label="Transporter">{(a) => <Input {...a} value={disp.carrier} onChange={(e) => setDisp({ ...disp, carrier: e.target.value })} />}</Field>
            <Button size="sm" variant="primary" loading={busy} disabled={!disp.reference.trim()} onClick={() => post(`${base}/orders/${p.id}/dispatch`, disp, () => setDisp({ date: todayIst(), reference: "", carrier: "", note: "" }))}>Add dispatch</Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SupplierInvoicesTab({ slug, base }: { slug: string; base: string }) {
  const qc = useQueryClient();
  const bills = usePortalQuery<{ bills: { id: string; billNo: string; date: string; dueDate: string | null; total: number; tds: number; paid: number; due: number; status: string }[] }>(slug, base, "bills");
  const subs = usePortalQuery<{ invoices: { id: string; invoiceNo: string; date: string; amount: number; status: string; reason: string }[] }>(slug, base, "invoices");
  const orders = usePortalQuery<{ orders: Po[] }>(slug, base, "orders");
  const [f, setF] = useState({ invoiceNo: "", date: todayIst(), amount: "", poId: "", note: "" });
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("meta", JSON.stringify({ invoiceNo: f.invoiceNo, date: f.date, amount: Number(f.amount), poId: f.poId || null, note: f.note }));
      const picked = file.current?.files?.[0];
      if (picked) form.set("file", picked);
      const res = await fetch(`${base}/invoices`, { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Couldn't send it");
      setOk(f.invoiceNo);
      setF({ invoiceNo: "", date: todayIst(), amount: "", poId: "", note: "" });
      if (file.current) file.current.value = "";
      await qc.invalidateQueries({ queryKey: ["portal", slug, "s"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-[20px] border border-border bg-surface p-5">
        <h2 className="text-[15px] font-semibold">Send an invoice</h2>
        {ok && <Notice tone="success">Invoice {ok} sent. We&apos;ll book it and you&apos;ll see it below once we do.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Invoice number">{(a) => <Input {...a} value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} />}</Field>
          <Field label="Invoice date">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Total with GST (₹)">{(a) => <Input {...a} type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Against purchase order">{(a) => <Select {...a} value={f.poId} onChange={(e) => setF({ ...f, poId: e.target.value })}><option value="">None</option>{orders.data?.orders.map((p) => <option key={p.id} value={p.id}>{p.number}</option>)}</Select>}</Field>
          <Field label="Note" className="sm:col-span-2">{(a) => <Input {...a} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        </div>
        <label className="block text-[13px]">Invoice file (PDF or photo, up to 10 MB) <input ref={file} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="mt-1 block text-[13px]" /></label>
        <Button variant="primary" loading={busy} disabled={!f.invoiceNo.trim() || !Number(f.amount)} onClick={submit}>Send invoice</Button>
      </section>
      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Invoices you sent</h2>
        {!subs.data ? <Skeleton className="h-24 rounded-[20px]" /> : subs.data.invoices.length ? <ul className="divide-y divide-border rounded-[20px] border border-border bg-surface">{subs.data.invoices.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-[13.5px]"><span>{s.invoiceNo} · {date(s.date)} · {inr(s.amount)}{s.reason && <span className="block text-[12px] text-danger">Returned: {s.reason}</span>}</span><Badge tone={s.status === "billed" ? "success" : s.status === "rejected" ? "danger" : "accent"}>{s.status === "billed" ? "Booked" : s.status === "rejected" ? "Returned" : "Received"}</Badge></li>)}</ul> : <Empty>None yet.</Empty>}
      </section>
      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Your bills with us</h2>
        {!bills.data ? <Skeleton className="h-24 rounded-[20px]" /> : bills.data.bills.length ? (
          <div className="overflow-x-auto rounded-[20px] border border-border bg-surface">
            <table className="w-full min-w-[560px] text-[13.5px]">
              <thead className="border-b border-border text-left text-[12px] text-muted"><tr><th className="px-4 py-2 font-medium">Bill</th><th className="px-4 py-2 font-medium">Due</th><th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-right font-medium">TDS</th><th className="px-4 py-2 text-right font-medium">Paid</th><th className="px-4 py-2 text-right font-medium">To be paid</th></tr></thead>
              <tbody className="divide-y divide-border">{bills.data.bills.map((b) => <tr key={b.id}><td className="px-4 py-2">{b.billNo}<span className="block text-[12px] text-muted">{date(b.date)}</span></td><td className="px-4 py-2">{date(b.dueDate)}</td><td className="px-4 py-2 text-right tabular-nums">{inr(b.total)}</td><td className="px-4 py-2 text-right tabular-nums">{b.tds ? inr(b.tds) : "—"}</td><td className="px-4 py-2 text-right tabular-nums">{inr(b.paid)}</td><td className="px-4 py-2 text-right font-medium tabular-nums">{b.due ? inr(b.due) : "—"}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <Empty>No bills yet.</Empty>}
      </section>
    </div>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <main className={cx("mx-auto min-h-screen bg-bg px-4 py-10 sm:px-6", wide ? "max-w-5xl" : "max-w-2xl")}>{children}</main>;
}
