"use client";

// The public page of a business ID: the card, then what you can do with it —
// save it to your contacts, share it on, see the QR code, or send your own
// details back to its owner.
import { Check, Contact, Copy, QrCode, Send, Share2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Wordmark } from "@/components/brand";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";
import type { BusinessCardData, BusinessCardStyle } from "@/db/schema";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { CardFace } from "./card-face";

type Card = { slug: string; url: string; workspace: string; exchange: boolean; data: BusinessCardData; style: Required<BusinessCardStyle>; qr: string } | null;

export function PublicCard({ card }: { card: Card }) {
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", note: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (!card) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-4 text-center">
        <div>
          <h1 className="text-lg font-semibold">This business ID isn&apos;t available</h1>
          <p className="mt-1 text-sm text-muted">It may have been switched off or the link changed.</p>
        </div>
      </main>
    );
  }
  const first = (card.data.name ?? "").split(/\s+/)[0] || "them";
  const share = async () => {
    const data = { title: card.data.name, text: [card.data.name, card.data.title, card.data.company].filter(Boolean).join(" · "), url: card.url };
    try {
      if (navigator.share) return void (await navigator.share(data));
    } catch {
      return;
    }
    await copy();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", card.url);
    }
  };
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api(`/api/v1/cards/${card.slug}`, { method: "POST", body: form });
      setSent(true);
    } catch (e) {
      setErrors(e instanceof ApiClientError ? { ...e.fieldErrors(), ...(Object.keys(e.fieldErrors()).length ? {} : { form: [e.message] }) } : { form: [errorMessage(e)] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-bg px-4 pb-16 pt-[max(2.5rem,env(safe-area-inset-top))]" style={{ background: `radial-gradient(90% 50% at 50% 0%, ${card.style.accent}22, transparent 70%)` }}>
      <div className="mx-auto grid w-full max-w-[620px] justify-items-center gap-5">
        <CardFace data={card.data} style={card.style} interactive />

        <div className="grid w-full max-w-[380px] grid-cols-3 gap-2" style={card.style.shape === "landscape" ? { maxWidth: 620 } : undefined}>
          <a href={`/id/${card.slug}/vcf`} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-fg text-[14px] font-medium text-bg">
            <Contact className="size-4" /> Save
          </a>
          <button type="button" onClick={() => void share()} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-[14px] font-medium">
            {copied ? <Check className="size-4" /> : <Share2 className="size-4" />} {copied ? "Copied" : "Share"}
          </button>
          <button type="button" onClick={() => setQr(!qr)} aria-expanded={qr} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-[14px] font-medium">
            <QrCode className="size-4" /> QR
          </button>
        </div>

        {qr && (
          <div className="grid w-full max-w-[380px] justify-items-center gap-3 rounded-3xl border border-border bg-surface p-5">
            <span className="block size-56 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: card.qr.replace("<svg ", '<svg width="100%" height="100%" ') }} />
            <p className="text-center text-[13px] text-muted">Point a phone camera here to open {first}&apos;s card</p>
            <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg">
              <Copy className="size-3.5" /> {card.url.replace(/^https?:\/\//, "")}
            </button>
          </div>
        )}

        {card.exchange && (
          <section className="w-full max-w-[380px] rounded-3xl border border-border bg-surface p-5" style={card.style.shape === "landscape" ? { maxWidth: 620 } : undefined}>
            {sent ? (
              <div className="flex items-start gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-emerald-500/12 text-emerald-600"><Check className="size-4" /></span>
                <div>
                  <p className="text-[14px] font-medium">Sent to {first}</p>
                  <p className="text-[13px] text-muted">They&apos;ll get your details and can reach you back.</p>
                </div>
              </div>
            ) : !open ? (
              <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 text-left">
                <span className="grid size-9 place-items-center rounded-full" style={{ background: `${card.style.accent}1f`, color: card.style.accent }}><Send className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">Send {first} your details</span>
                  <span className="block text-[13px] text-muted">Swap cards in one tap — no app needed</span>
                </span>
              </button>
            ) : (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="flex items-center">
                  <p className="flex-1 text-[14px] font-medium">Send {first} your details</p>
                  <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-muted hover:text-fg"><X className="size-4" /></button>
                </div>
                <Field label="Your name" error={errors.name?.[0]}>{(p) => <Input {...p} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
                <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                  <Field label="Email" error={errors.email?.[0]}>{(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
                  <Field label="Phone" error={errors.phone?.[0]}>{(p) => <Input {...p} type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}</Field>
                </div>
                <Field label="Company">{(p) => <Input {...p} autoComplete="organization" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />}</Field>
                <Field label="Note (optional)">{(p) => <Textarea {...p} rows={2} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Where you met, what you'd like to talk about" />}</Field>
                <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                {errors.form && <p className="text-[13px] text-red-600">{errors.form[0]}</p>}
                <Button variant="primary" type="submit" loading={busy}>Send</Button>
              </form>
            )}
          </section>
        )}

        <Link href="/" className="mt-2 inline-flex items-center gap-2 text-[12px] text-subtle hover:text-muted">
          Business ID by <Wordmark className="text-[13px] text-muted" />
        </Link>
      </div>
    </main>
  );
}
