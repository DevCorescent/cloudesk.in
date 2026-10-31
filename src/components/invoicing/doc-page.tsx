"use client";

// A single document: how it looks, what happened to it, and everything you
// can do with it — share, record payments, convert, credit, duplicate, void.
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, Copy, CreditCard, ExternalLink, FileOutput, Files, Link2, Mail, MessageCircle, MessageSquareText, Pencil, Printer, QrCode, Receipt, Send, Share2, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog, Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Badge, Button, ErrorState, Input, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { DOC_LABEL, PAY_METHOD_LABEL, PICKABLE_PAY_METHODS, type PAY_METHODS } from "@/lib/invoicing/model";
import { qrSvg } from "@/lib/store/barcode";
import { MoneyInput } from "../store/shared";
import { docHtml, fmtDate, invApi, money, templateOf, useFitZoom, StatusBadge, TYPE_PATH, useInv, useInvQuery, type DocDetail } from "./shared";

export function DocPage({ id }: { id: string }) {
  const { projectId, apiBase, base, boot } = useInv();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useInvQuery<DocDetail>(`documents/${id}`);
  const [share, setShare] = useState(false);
  const [pay, setPay] = useState(false);
  const [confirm, setConfirm] = useState<null | "void" | "delete">(null);
  const [voidReason, setVoidReason] = useState("");
  const [box, zoom] = useFitZoom(q.data ? templateOf(boot, q.data.document.templateId).paper : "A4");
  const refresh = (r?: DocDetail) => {
    if (r) qc.setQueryData(["invoicing", projectId, `documents/${id}`], r);
    qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
  };
  const act = useMutation({
    mutationFn: ({ path, body, method = "POST" }: { path: string; body?: unknown; method?: string }) => api<DocDetail & { ok?: boolean }>(invApi(apiBase, `documents/${id}${path ? `/${path}` : ""}`), { method, body }),
    onError: (e) => toast({ tone: "error", title: "That didn't work", description: errorMessage(e) }),
  });
  const run = (path: string, body: unknown, after: (r: DocDetail) => void) => act.mutate({ path, body }, { onSuccess: after });

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh]" />;
  const { document: d, payments, events, source, children } = q.data;
  const html = zoom ? docHtml(d, boot, zoom) : "";
  const list = `${base}/${TYPE_PATH[d.type]}`;
  const isDraft = d.status === "draft";
  const isVoid = d.status === "void";
  const canPay = (d.type === "invoice" || d.type === "proforma") && !isDraft && !isVoid && d.balance > 0;
  const go = (r: DocDetail) => router.push(`${base}/${TYPE_PATH[r.document.type]}/${r.document.id}`);

  const more: Parameters<typeof Menu>[0]["items"] = [
    { label: "Duplicate", icon: <Files className="size-4" />, onSelect: () => run("duplicate", undefined, (r) => { refresh(); toast({ tone: "success", title: "Copied to a new draft" }); go(r); }) },
    ...(d.type === "quote" && !isDraft && !["declined", "void", "converted"].includes(d.status)
      ? [{ label: "Convert to proforma invoice", icon: <FileOutput className="size-4" />, onSelect: () => run("convert", { to: "proforma" }, (r) => { refresh(); go(r); }) }]
      : []),
    ...(d.type === "invoice" && !isDraft && !isVoid ? [{ label: "Issue a credit note", icon: <Undo2 className="size-4" />, onSelect: () => run("credit-note", undefined, (r) => { refresh(); toast({ tone: "success", title: "Credit note drafted", description: "Adjust the lines to what you're crediting, then issue it." }); go(r); }) }] : []),
    "separator" as const,
    ...(isDraft ? [{ label: "Delete draft", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirm("delete") }] : []),
    ...(!isDraft && !isVoid && boot.canVoid ? [{ label: "Void…", icon: <Ban className="size-4" />, danger: true, disabled: d.amountPaid > 0, onSelect: () => setConfirm("void") }] : []),
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href={list} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {DOC_LABEL[d.type]}s
        </Link>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{d.number || `Draft ${DOC_LABEL[d.type].toLowerCase()}`}</h1>
        <StatusBadge status={d.displayStatus} />
        {d.recurring && <Badge>Repeats {d.recurring.every}ly · next {fmtDate(d.recurring.nextRun)}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!isVoid && (
            <Link href={`${list}/${d.id}/edit`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
              <Pencil className="size-3.5" /> Edit
            </Link>
          )}
          <a href={`${invApi(apiBase, `documents/${d.id}/render`)}?print=1`} target="_blank" rel="noopener" onClick={() => !isDraft && act.mutate({ path: "shared", body: { via: "print" } }, { onSuccess: refresh })} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
            <Printer className="size-3.5" /> PDF / Print
          </a>
          {!isDraft && (
            <ShareToChatButton card={{ kind: "invoices", id: d.id, title: `${DOC_LABEL[d.type]} ${d.number}`, sub: `${d.client.company || d.client.name} · ${money(d.total, d.currency)}`, link: typeof window === "undefined" ? "" : window.location.pathname, module: DOC_LABEL[d.type], fields: [{ label: "Status", value: d.displayStatus }, { label: "Due", value: d.dueDate ? fmtDate(d.dueDate) : "" }, { label: "Balance", value: money(d.balance, d.currency) }] }} />
          )}
          {!isDraft && !isVoid && (
            <EmailButton
              to={[{ email: d.client.email, name: d.client.name || d.client.company }]}
              label="Email"
              attachments={[{ url: invApi(apiBase, `documents/${d.id}/pdf`), filename: `${DOC_LABEL[d.type]} ${d.number}.pdf`.replace(/[^\w .-]+/g, "-") }]}
              title={`Email ${DOC_LABEL[d.type].toLowerCase()} ${d.number}`}
              subject={`${DOC_LABEL[d.type]} ${d.number}${d.client.company || d.client.name ? ` for ${d.client.company || d.client.name}` : ""}`}
              body={`Hi {{first_name}},\n\nPlease find attached ${DOC_LABEL[d.type].toLowerCase()} ${d.number} for ${money(d.type === "invoice" || d.type === "proforma" ? d.balance : d.total, d.currency)}${d.dueDate ? ` (${d.type === "quote" ? "valid until" : "due"} ${fmtDate(d.dueDate)})` : ""}.${d.shareUrl ? `\n\nView, download or pay it here: ${d.shareUrl}` : ""}\n\nThank you,\n{{my_name}}`}
            />
          )}
          {canPay && (
            <Button size="sm" icon={<CreditCard className="size-3.5" />} onClick={() => setPay(true)}>
              Record payment
            </Button>
          )}
          {d.type === "quote" && ["accepted", "sent", "viewed"].includes(d.status) && (
            <Button size="sm" icon={<Receipt className="size-3.5" />} loading={act.isPending} onClick={() => run("convert", { to: "invoice" }, (r) => { refresh(); toast({ tone: "success", title: "Invoice drafted from the quotation" }); go(r); })}>
              Convert to invoice
            </Button>
          )}
          {isDraft ? (
            <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={act.isPending} onClick={() => run("issue", undefined, (r) => { refresh(r); toast({ tone: "success", title: `${DOC_LABEL[d.type]} ${r.document.number} issued` }); })}>
              Issue
            </Button>
          ) : null}
          {!isVoid && (
            <Button size="sm" variant={isDraft ? "secondary" : "primary"} icon={<Share2 className="size-3.5" />} onClick={() => setShare(true)}>
              Share
            </Button>
          )}
          <Menu label="More actions" items={more} trigger={(p) => <Button size="sm" variant="ghost" {...p}>More</Button>} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div ref={box} className="min-w-0">
          <iframe title={`${DOC_LABEL[d.type]} ${d.number}`} srcDoc={html} className="h-[calc(100vh-160px)] min-h-[560px] w-full rounded-[var(--radius-xl)] border border-border bg-[#e9e9ee]" />
        </div>
        <div className="grid content-start gap-4">
          <section className="glass-card rounded-[var(--radius-xl)] p-4">
            <p className="text-[12px] text-muted">{d.type === "invoice" || d.type === "proforma" ? "Balance due" : "Total"}</p>
            <p className="text-[28px] font-semibold tracking-tight tabular-nums">{money(d.type === "invoice" || d.type === "proforma" ? d.balance : d.total, d.currency)}</p>
            <dl className="mt-2 grid gap-1 text-[13px]">
              <Fact k="Client" v={d.client.company || d.client.name} />
              <Fact k="Total" v={money(d.total, d.currency)} />
              {d.amountPaid > 0 && <Fact k="Paid" v={money(d.amountPaid, d.currency)} />}
              <Fact k="Issued" v={fmtDate(d.issueDate)} />
              {d.currency !== "INR" && !isDraft && (d.type === "invoice" || d.type === "credit_note") && <Fact k="Rate for the books" v={<FxRate key={d.fxRate ?? ""} detail={q.data} onSaved={refresh} />} />}
              {d.dueDate && <Fact k={d.type === "quote" ? "Valid until" : "Due"} v={fmtDate(d.dueDate)} />}
              <Fact k="Opened by client" v={d.viewedAt ? `${timeAgo(d.viewedAt)}${d.viewCount > 1 ? ` · ${d.viewCount} views` : ""}` : "Not yet"} />
              {d.decidedBy && <Fact k={d.status === "declined" ? "Declined by" : "Accepted by"} v={`${d.decidedBy}${d.decisionNote ? ` — “${d.decisionNote}”` : ""}`} />}
              {source && <Fact k="From" v={<Link className="underline" href={`${base}/${TYPE_PATH[source.type]}/${source.id}`}>{DOC_LABEL[source.type]} {source.number}</Link>} />}
              {children.map((c) => <Fact key={c.id} k={DOC_LABEL[c.type]} v={<Link className="underline" href={`${base}/${TYPE_PATH[c.type]}/${c.id}`}>{c.number || "Draft"}</Link>} />)}
            </dl>
          </section>

          {(payments.length > 0 || canPay) && (
            <section className="glass-card rounded-[var(--radius-xl)] p-4">
              <h2 className="mb-2 text-[13px] font-semibold">Payments</h2>
              {!payments.length && <p className="text-[13px] text-muted">None recorded yet.</p>}
              <ul className="grid gap-1.5">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium tabular-nums">{money(p.amount, d.currency)}</span> <span className="text-muted">· {PAY_METHOD_LABEL[p.method as keyof typeof PAY_METHOD_LABEL] ?? p.method} · {fmtDate(p.paidOn)}</span>
                      {p.inrAmount !== null && <span className="block text-[11px] text-subtle">{money(p.inrAmount, "INR")} received</span>}
                      {p.reference && <span className="block truncate text-[11px] text-subtle">Ref {p.reference}</span>}
                    </span>
                    {boot.canVoid && (
                      <button type="button" aria-label="Remove payment" onClick={() => act.mutate({ path: `payments/${p.id}`, method: "DELETE" }, { onSuccess: (r) => { refresh(r); toast({ tone: "success", title: "Payment removed" }); } })} className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canPay && <Button size="sm" className="mt-3 w-full" onClick={() => setPay(true)}>Record a payment</Button>}
            </section>
          )}

          <section className="glass-card rounded-[var(--radius-xl)] p-4">
            <h2 className="mb-2 text-[13px] font-semibold">Activity</h2>
            <ol className="grid gap-2">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2 text-[12px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                  <span className="min-w-0 flex-1">{e.message}<span className="block text-subtle">{timeAgo(e.createdAt)}</span></span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {share && <ShareDialog detail={q.data} onClose={() => setShare(false)} onChange={refresh} />}
      {pay && <PaymentDialog detail={q.data} onClose={() => setPay(false)} onSaved={(r) => { refresh(r); setPay(false); }} />}
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        destructive
        title="Delete this draft?"
        description="Drafts have no number yet, so deleting leaves no gap in your numbering. This can't be undone."
        confirmLabel="Delete draft"
        loading={act.isPending}
        onConfirm={() => act.mutate({ path: "", method: "DELETE" }, { onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoicing", projectId] }); router.push(list); } })}
      />
      <Dialog
        open={confirm === "void"}
        onClose={() => setConfirm(null)}
        size="sm"
        title={`Void ${d.number}?`}
        description="The number stays used (so your records have no gaps), the document shows VOID, and it no longer counts in reports. This can't be undone."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" loading={act.isPending} onClick={() => run("void", { reason: voidReason }, (r) => { refresh(r); setConfirm(null); toast({ tone: "success", title: `${d.number} voided` }); })}>
              Void
            </Button>
          </>
        }
      >
        <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (optional, kept in the history)" aria-label="Reason" />
      </Dialog>
    </div>
  );
}

const Fact = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex justify-between gap-3">
    <dt className="shrink-0 text-muted">{k}</dt>
    <dd className="min-w-0 truncate text-right">{v}</dd>
  </div>
);

function PaymentDialog({ detail, onClose, onSaved }: { detail: DocDetail; onClose: () => void; onSaved: (r: DocDetail) => void }) {
  const { apiBase, boot } = useInv();
  const d = detail.document;
  const toast = useToast();
  const [p, setP] = useState({ amount: d.balance as number | null, method: "bank" as (typeof PAY_METHODS)[number], paidOn: boot.today, reference: "", note: "", inrAmount: null as number | null });
  const save = useMutation({
    mutationFn: () => api<DocDetail>(invApi(apiBase, `documents/${d.id}/payments`), { method: "POST", body: { ...p, amount: p.amount ?? 0 } }),
    onSuccess: (r) => {
      toast({ tone: "success", title: r.document.balance ? `Recorded — ${money(r.document.balance, d.currency)} still due` : `${d.number} is fully paid` });
      onSaved(r);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't record it", description: errorMessage(e) }),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Record a payment"
      description={`${money(d.balance, d.currency)} due on ${d.number}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!p.amount || p.amount > d.balance} onClick={() => save.mutate()}>
            Record {p.amount ? money(p.amount, d.currency) : ""}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-[12px] font-medium text-muted">
          Amount received
          <MoneyInput value={p.amount} onChange={(v) => setP({ ...p, amount: v })} currency={d.currency} />
          {p.amount !== null && p.amount > d.balance && <span className="text-danger">More than the balance due</span>}
        </label>
        {d.currency !== "INR" && (
          <label className="grid gap-1 text-[12px] font-medium text-muted">
            Rupees received (for the books)
            <MoneyInput value={p.inrAmount} onChange={(v) => setP({ ...p, inrAmount: v })} currency="INR" />
            <span className="font-normal text-subtle">What reached your bank. Left empty, Accounts uses the exchange rate on the day; the difference from the invoice&apos;s rate is an exchange gain or loss.</span>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-[12px] font-medium text-muted">
            Method
            <Select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value as typeof p.method })}>
              {PICKABLE_PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-[12px] font-medium text-muted">
            Date
            <Input type="date" value={p.paidOn} onChange={(e) => setP({ ...p, paidOn: e.target.value })} />
          </label>
        </div>
        <label className="grid gap-1 text-[12px] font-medium text-muted">
          Reference (UTR, cheque no.)
          <Input value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} />
        </label>
        <label className="grid gap-1 text-[12px] font-medium text-muted">
          Note
          <Input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} />
        </label>
      </div>
    </Dialog>
  );
}

/** The rate a foreign-currency document is posted at in Accounts: set here, or the workspace's rate on its date. */
function FxRate({ detail, onSaved }: { detail: DocDetail; onSaved: (r: DocDetail) => void }) {
  const { apiBase } = useInv();
  const toast = useToast();
  const d = detail.document;
  const [v, setV] = useState(d.fxRate ? String(Number(d.fxRate)) : "");
  const save = useMutation({
    mutationFn: () => api<DocDetail>(invApi(apiBase, `documents/${d.id}/fx-rate`), { method: "POST", body: { rate: v.trim() ? Number(v) : null } }),
    onSuccess: (r) => (toast({ tone: "success", title: v.trim() ? "Rate saved" : "Using the workspace rate" }), onSaved(r)),
    onError: (e) => toast({ tone: "error", title: "Couldn't save the rate", description: errorMessage(e) }),
  });
  const changed = v !== (d.fxRate ? String(Number(d.fxRate)) : "");
  return (
    <span className="flex items-center justify-end gap-1">
      ₹<input aria-label={`Rupees per ${d.currency}`} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} placeholder="workspace rate" className="w-24 rounded-[8px] border border-border bg-surface px-1.5 py-0.5 text-right text-[12.5px]" />
      {changed && <button type="button" onClick={() => save.mutate()} disabled={save.isPending || (!!v.trim() && !(Number(v) > 0))} className="text-[12px] font-medium underline">Save</button>}
    </span>
  );
}

type Tab = "link" | "email" | "whatsapp" | "sms" | "more";

function ShareDialog({ detail, onClose, onChange }: { detail: DocDetail; onClose: () => void; onChange: (r?: DocDetail) => void }) {
  const { apiBase, boot } = useInv();
  const toast = useToast();
  const d = detail.document;
  const overdue = d.displayStatus === "overdue" || d.displayStatus === "partial";
  const [tab, setTab] = useState<Tab>("link");
  const msg = useInvQuery<{ subject: string; message: string; whatsapp: string }>(`documents/${d.id}/message${overdue ? "?reminder=1" : ""}`);
  const [email, setEmail] = useState<{ to: string; subject: string; message: string } | null>(null);
  const [attachPdf, setAttachPdf] = useState(true);
  const [phone, setPhone] = useState(d.client.phone);
  const [copied, setCopied] = useState(false);
  const e = email ?? (msg.data ? { to: d.client.email, subject: msg.data.subject, message: msg.data.message } : null);
  const text = msg.data ? `${msg.data.whatsapp}${d.shareUrl}` : d.shareUrl;
  const digits = phone.replace(/[^\d]/g, "");
  const intl = digits.length === 10 && boot.settings.business.address.country === "IN" ? `91${digits}` : digits;
  const qr = useMemo(() => qrSvg(d.shareUrl, { margin: 2, label: "QR code for the document link" }), [d.shareUrl]);

  const note = useMutation({ mutationFn: (via: string) => api<DocDetail>(invApi(apiBase, `documents/${d.id}/shared`), { method: "POST", body: { via } }), onSuccess: (r) => onChange(r) });
  const send = useMutation({
    mutationFn: () => api<DocDetail & { delivered: boolean }>(invApi(apiBase, `documents/${d.id}/${overdue ? "remind" : "send"}`), { method: "POST", body: { ...e, attachPdf } }),
    onSuccess: (r) => {
      onChange(r);
      toast(r.delivered ? { tone: "success", title: `Emailed to ${e!.to}` } : { tone: "info", title: "Recorded, not delivered", description: "Email delivery isn't set up on this server, so the message was saved to the outbox only. Share the link another way for now." });
      if (r.delivered) onClose();
    },
    onError: (err) => toast({ tone: "error", title: "Couldn't send", description: errorMessage(err) }),
  });

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "link", label: "Link & QR", icon: <Link2 className="size-3.5" /> },
    { id: "email", label: "Email", icon: <Mail className="size-3.5" /> },
    { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="size-3.5" /> },
    { id: "sms", label: "SMS", icon: <MessageSquareText className="size-3.5" /> },
    { id: "more", label: "PDF & more", icon: <Share2 className="size-3.5" /> },
  ];
  return (
    <Dialog open onClose={onClose} size="lg" title={`Share ${DOC_LABEL[d.type].toLowerCase()} ${d.number || ""}`.trim()} description={d.status === "draft" ? "Sharing issues the draft first, so it gets its number." : "Your client sees it exactly as it prints, and can download a PDF" + (d.type === "quote" ? " and accept it online." : boot.settings.payment.upiId && d.currency === "INR" ? " and pay by UPI." : ".")}>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px]", tab === t.id ? "bg-fg font-medium text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "link" && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="grid min-w-0 grid-cols-1 content-start gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border p-1 pl-4">
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{d.shareUrl}</span>
              <Button size="sm" variant="primary" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(d.shareUrl).then(() => { setCopied(true); note.mutate("link"); })}>
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <a href={d.shareUrl} target="_blank" rel="noopener" className="inline-flex w-fit items-center gap-1 text-[13px] text-accent">
              Open what your client sees <ExternalLink className="size-3.5" />
            </a>
            <p className="text-[12px] text-muted">Anyone with the link can view this document; it isn&apos;t listed anywhere or indexed by search engines. You&apos;ll see when it&apos;s opened.</p>
          </div>
          <div className="grid justify-items-center gap-1">
            <span className="w-40 rounded-xl bg-white p-1 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <span className="text-[11px] text-muted">Scan to open on a phone</span>
          </div>
        </div>
      )}

      {tab === "email" && (
        <div className="grid gap-3">
          {!boot.mailConfigured && <p className="rounded-[12px] bg-warning/10 px-3 py-2 text-[12px]">Email delivery isn&apos;t set up on this server, so messages are saved to the outbox but not sent. Use the link, WhatsApp or SMS meanwhile.</p>}
          {!e ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <Input type="email" value={e.to} onChange={(x) => setEmail({ ...e, to: x.target.value })} placeholder="client@example.com" aria-label="To" />
              <Input value={e.subject} onChange={(x) => setEmail({ ...e, subject: x.target.value })} aria-label="Subject" />
              <Textarea rows={7} value={e.message} onChange={(x) => setEmail({ ...e, message: x.target.value })} aria-label="Message" />
              <label className="flex items-center gap-2 text-[13px]"><Switch label="Attach the PDF" checked={attachPdf} onChange={setAttachPdf} /> Attach the PDF</label>
              <p className="text-[12px] text-muted">The link to the {DOC_LABEL[d.type].toLowerCase()} is added at the end{boot.settings.business.email ? `; replies go to ${boot.settings.business.email}` : ""}.</p>
              <Button variant="primary" icon={<Send className="size-3.5" />} loading={send.isPending} disabled={!/^\S+@\S+\.\S+$/.test(e.to)} onClick={() => send.mutate()}>
                {overdue ? "Send reminder" : "Send email"}
              </Button>
            </>
          )}
        </div>
      )}

      {(tab === "whatsapp" || tab === "sms") && (
        <div className="grid gap-3">
          <Input inputMode="tel" value={phone} onChange={(x) => setPhone(x.target.value)} placeholder="Client's mobile number" aria-label="Phone number" />
          <Textarea rows={6} readOnly value={text} aria-label="Message" className="text-[13px]" />
          {tab === "whatsapp" ? (
            <a
              href={`https://wa.me/${intl}?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noopener"
              onClick={() => note.mutate("whatsapp")}
              className={cx("inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 text-[14px] font-semibold text-white", !intl && "pointer-events-none opacity-50")}
            >
              <MessageCircle className="size-4" /> Open WhatsApp
            </a>
          ) : (
            <a href={`sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(text)}`} onClick={() => note.mutate("sms")} className={cx("inline-flex h-10 items-center justify-center gap-2 rounded-full bg-fg px-5 text-[14px] font-semibold text-bg", !digits && "pointer-events-none opacity-50")}>
              <MessageSquareText className="size-4" /> Open messages
            </a>
          )}
          <p className="text-[12px] text-muted">{tab === "whatsapp" ? "Opens WhatsApp (app or web) with the message ready — you press send." : "Opens your phone's messages app with the text ready. Works on phones; on a computer it may do nothing."}</p>
        </div>
      )}

      {tab === "more" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <ShareTile icon={<FileOutput className="size-4" />} title="Download PDF" sub="A PDF file of the document, ready to attach anywhere" href={`${invApi(apiBase, `documents/${d.id}/pdf`)}?download=1`} onClick={() => note.mutate("print")} />
          <ShareTile icon={<Printer className="size-4" />} title="Print" sub="Opens the designed page and the print dialog" href={`${invApi(apiBase, `documents/${d.id}/render`)}?print=1`} onClick={() => note.mutate("print")} />
          <ShareTile icon={<Share2 className="size-4" />} title="Share to another app" sub="Your device's share sheet (phones, Safari, Edge)" onClick={async () => { if (navigator.share) { await navigator.share({ title: `${DOC_LABEL[d.type]} ${d.number}`, text: msg.data?.whatsapp ?? "", url: d.shareUrl }).then(() => note.mutate("share")).catch(() => {}); } else toast({ tone: "info", title: "Not available in this browser", description: "Copy the link instead." }); }} />
          <ShareTile icon={<QrCode className="size-4" />} title="Show a QR code" sub="For the counter: the client scans to open it" onClick={() => { setTab("link"); note.mutate("qr"); }} />
          <ShareTile icon={<Mail className="size-4" />} title="Your own email app" sub="Opens a new email with the link" href={`mailto:${encodeURIComponent(d.client.email)}?subject=${encodeURIComponent(msg.data?.subject ?? "")}&body=${encodeURIComponent(text)}`} onClick={() => note.mutate("share")} />
        </div>
      )}
    </Dialog>
  );
}

function ShareTile({ icon, title, sub, href, onClick }: { icon: ReactNode; title: string; sub: string; href?: string; onClick?: () => void }) {
  const cls = "flex items-start gap-3 rounded-[14px] border border-border p-3 text-left hover:bg-surface-2";
  const inner = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">{icon}</span>
      <span>
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-[12px] text-muted">{sub}</span>
      </span>
    </>
  );
  return href ? <a href={href} target="_blank" rel="noopener" onClick={onClick} className={cls}>{inner}</a> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}
