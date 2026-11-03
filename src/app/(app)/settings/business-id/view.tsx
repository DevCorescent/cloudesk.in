"use client";

// Your virtual business ID: made for you from your account, HR record and the
// workspace; edit what it says and how it looks (unless the company's
// template fixes that), and share it — link, QR code, contact file, WhatsApp,
// email signature. Owners and admins also set the company template and see
// everyone's cards.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Contact, Copy, Download, ExternalLink, Eye, EyeOff, Lock, Mail, MessageCircle, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { CardFace } from "@/components/cards/card-face";
import { useSession } from "@/components/shell/session-context";
import { Segmented, Tabs, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import type { BusinessCardData, BusinessCardStyle } from "@/db/schema";
import { ACCENTS, DEFAULT_STYLE, DESIGNS, effective, FIELDS, signatureHtml, type Template } from "@/lib/cards/model";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";

type CardOut = { id: string; slug: string; url: string; data: BusinessCardData; style: BusinessCardStyle; hidden: string[]; published: boolean; exchange: boolean; views: number; saves: number; updatedAt: string; qr: string };
type Me = { card: CardOut; template: Template | null; exchanges: { id: string; name: string; email: string; phone: string; company: string; note: string; at: string }[] };
type Draft = Pick<CardOut, "data" | "style" | "hidden" | "published" | "exchange" | "slug">;
type Team = { members: { userId: string; name: string; role: string; card: { slug: string; url: string; title: string; published: boolean; views: number; saves: number } | null }[] };

const SAMPLE: BusinessCardData = { name: "Your name", title: "Your title", phone: "+91 98220 00000", email: "you@company.com" };

/** Picks a design, an accent and a shape. */
function DesignPicker({ style, onChange }: { style: BusinessCardStyle; onChange: (s: BusinessCardStyle) => void }) {
  const s = { ...DEFAULT_STYLE, ...style };
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {DESIGNS.map((d) => (
          <button key={d.id} type="button" onClick={() => onChange({ ...style, design: d.id })} aria-pressed={s.design === d.id} title={d.note} className={`grid gap-1.5 rounded-[14px] border p-2 text-left text-[12px] transition-colors ${s.design === d.id ? "border-fg" : "border-border hover:border-fg/30"}`}>
            <span
              aria-hidden
              className="block h-12 rounded-[9px]"
              style={
                d.id === "bold"
                  ? { background: s.accent }
                  : d.id === "night"
                    ? { background: `radial-gradient(90% 90% at 90% 0%, ${s.accent}88, transparent 60%), #111116` }
                    : d.id === "band"
                      ? { background: `linear-gradient(${s.accent} 0 40%, #fff 40%)`, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }
                      : { background: "#fff", boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.08)${d.id === "classic" ? `, inset 4px 0 0 ${s.accent}` : ""}` }
              }
            />
            <span className="font-medium">{d.label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ACCENTS.map((c) => (
          <button key={c} type="button" aria-label={`Accent ${c}`} aria-pressed={s.accent.toLowerCase() === c} onClick={() => onChange({ ...style, accent: c })} className={`size-7 rounded-full ring-offset-2 ring-offset-[var(--surface-solid)] ${s.accent.toLowerCase() === c ? "ring-2 ring-fg" : ""}`} style={{ background: c }} />
        ))}
        <label className="relative inline-flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border text-[11px] text-muted" title="Your own colour">
          +
          <input type="color" value={s.accent} onChange={(e) => onChange({ ...style, accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Your own colour" />
        </label>
      </div>
      <Segmented label="Shape" value={s.shape as "portrait" | "landscape"} onChange={(v) => onChange({ ...style, shape: v })} options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
    </div>
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MyCard({ base, me }: { base: string; me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = me.template;
  const init = (c: CardOut): Draft => ({ data: c.data, style: c.style, hidden: c.hidden, published: c.published, exchange: c.exchange, slug: c.slug });
  const [d, setD] = useState<Draft>(init(me.card));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [copied, setCopied] = useState("");
  const dirty = JSON.stringify(d) !== JSON.stringify(init(me.card));
  const view = useMemo(() => effective(d, t), [d, t]);
  const set = (k: keyof BusinessCardData, v: string) => setD({ ...d, data: { ...d.data, [k]: v } });
  const toggle = (k: string) => setD({ ...d, hidden: d.hidden.includes(k) ? d.hidden.filter((x) => x !== k) : [...d.hidden, k] });
  const fixed = (k: keyof BusinessCardData) => !!t?.lockCompany && t.data[k] !== undefined && t.data[k] !== "";

  const save = useMutation({
    mutationFn: () => api<{ card: CardOut }>(`${base}/me`, { method: "PATCH", body: { data: d.data, ...(t?.lockStyle ? {} : { style: d.style }), hidden: d.hidden, published: d.published, exchange: d.exchange, slug: d.slug } }),
    onSuccess: () => {
      setErrors({});
      void qc.invalidateQueries({ queryKey: ["card", base] });
      toast({ tone: "success", title: "Business ID saved" });
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast({ tone: "error", title: errorMessage(e) });
    },
  });
  const refresh = useMutation({
    mutationFn: () => api(`${base}/me/refresh`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["card", base] }),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const copy = async (what: string, text: string, html?: string) => {
    try {
      if (html && typeof ClipboardItem !== "undefined") await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      else await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      toast({ tone: "error", title: "Couldn't copy — select it and copy instead" });
    }
  };
  const url = me.card.url;
  const line = [view.data.name, [view.data.title, view.data.company].filter(Boolean).join(" at ")].filter(Boolean).join(" · ");
  const fieldRow = (f: (typeof FIELDS)[number]) => {
    const lockedHere = !!f.company && fixed(f.id);
    const hidden = d.hidden.includes(f.id);
    const value = lockedHere ? String(t!.data[f.id] ?? "") : String(d.data[f.id] ?? "");
    return (
      <div key={f.id} className={`flex items-start gap-2 ${f.long ? "sm:col-span-2" : ""}`}>
        <Field label={f.label} error={errors[`data.${f.id}`]?.[0] ?? errors[f.id]?.[0]} className="min-w-0 flex-1" hint={lockedHere ? <span className="inline-flex items-center gap-1"><Lock className="size-3" /> Set by your company</span> : undefined}>
          {(p) => (f.long ? <Textarea {...p} rows={f.id === "bio" ? 3 : 2} value={value} disabled={lockedHere} maxLength={f.id === "bio" ? 500 : 300} onChange={(e) => set(f.id, e.target.value)} /> : <Input {...p} value={value} disabled={lockedHere} type={f.id === "email" ? "email" : f.id === "phone" || f.id === "whatsapp" ? "tel" : "text"} onChange={(e) => set(f.id, e.target.value)} />)}
        </Field>
        <button type="button" onClick={() => toggle(f.id)} aria-pressed={hidden} aria-label={hidden ? `Show ${f.label} on the card` : `Hide ${f.label} from the card`} title={hidden ? "Hidden from your card" : "Shown on your card"} className="mt-[26px] grid size-9 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-fg">
          {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  };
  const links = d.data.links ?? [];
  return (
    <div className="grid gap-6">
      <div className={`grid items-start gap-4 ${view.style.shape === "landscape" ? "" : "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"}`}>
        <div className={`flex justify-center rounded-[22px] bg-surface-2 p-5 ${view.style.shape === "landscape" ? "" : "xl:sticky xl:top-20"}`}>
          <CardFace data={view.data} style={view.style} />
        </div>
        <div className="grid min-w-0 gap-4">
        <Card className="p-4">
            <div className="flex items-center gap-3">
              <span className="block size-24 shrink-0 rounded-xl bg-white p-1.5" dangerouslySetInnerHTML={{ __html: me.card.qr.replace("<svg ", '<svg width="100%" height="100%" ') }} />
              <div className="grid min-w-0 gap-1.5">
                <p className="truncate text-[13px] font-medium">{url.replace(/^https?:\/\//, "")}</p>
                <p className="text-[12px] text-muted">{me.card.views} {me.card.views === 1 ? "view" : "views"} · {me.card.saves} saved to contacts</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" icon={copied === "link" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void copy("link", url)}>{copied === "link" ? "Copied" : "Copy link"}</Button>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[12px] font-medium hover:bg-surface-2"><ExternalLink className="size-3.5" /> Open</a>
                </div>
              </div>
            </div>
            {dirty && <p className="mt-3 text-[12px] text-amber-700 dark:text-amber-300">Save to update what people see.</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(`${line}\n${url}`)}`} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-border text-[12.5px] font-medium hover:bg-surface-2"><MessageCircle className="size-3.5" /> WhatsApp</a>
              <a href={`mailto:?subject=${encodeURIComponent(`${view.data.name ?? ""}'s business ID`)}&body=${encodeURIComponent(`${line}\n\n${url}`)}`} className="flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-border text-[12.5px] font-medium hover:bg-surface-2"><Mail className="size-3.5" /> Email</a>
              <a href={`/id/${me.card.slug}/vcf`} className="flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-border text-[12.5px] font-medium hover:bg-surface-2"><Contact className="size-3.5" /> Contact file</a>
              <button type="button" onClick={() => download(`${me.card.slug}-qr.svg`, me.card.qr, "image/svg+xml")} className="flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-border text-[12.5px] font-medium hover:bg-surface-2"><Download className="size-3.5" /> QR code</button>
              <button type="button" onClick={() => void copy("sig", [view.data.name, [view.data.title, view.data.company].filter(Boolean).join(" · "), url].filter(Boolean).join("\n"), signatureHtml(view.data, url, view.style.accent))} className="col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-[11px] border border-border text-[12.5px] font-medium hover:bg-surface-2">
                {copied === "sig" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied === "sig" ? "Signature copied — paste it into your mail app" : "Copy as email signature"}
              </button>
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="text-[13px] font-semibold">Details people sent you</h3>
            {me.exchanges.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-muted">When someone opens your card and taps “Send your details”, they show up here and in your CRM.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {me.exchanges.map((x) => (
                  <li key={x.id} className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px]">
                    <div className="flex items-center gap-2"><span className="flex-1 font-medium">{x.name}{x.company ? <span className="font-normal text-muted"> · {x.company}</span> : null}</span><span className="text-[11px] text-subtle">{timeAgo(x.at)}</span></div>
                    <div className="text-muted">{[x.email, x.phone].filter(Boolean).join(" · ")}</div>
                    {x.note && <div className="mt-0.5">“{x.note}”</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
              </div>
      </div>
      <div className="grid min-w-0 content-start gap-6">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold">You</h2>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={refresh.isPending} onClick={() => refresh.mutate()} title="Fill in again from your account and HR record">Refill from profile</Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{FIELDS.filter((f) => !f.company).map(fieldRow)}</div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Company</h2>
          {t?.lockCompany && <p className="mt-1 text-[12.5px] text-muted">Your company fills in its own details; you can still hide them from your card.</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{FIELDS.filter((f) => f.company).map(fieldRow)}</div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Buttons</h2>
          <p className="mt-1 text-[12.5px] text-muted">Your portfolio, a booking page, LinkedIn — up to six.</p>
          <div className="mt-3 grid gap-2">
            {links.map((l, k) => (
              <div key={k} className="flex items-center gap-2">
                <div className="w-40 shrink-0"><Input aria-label="Label" value={l.label} maxLength={40} placeholder="Label" onChange={(e) => setD({ ...d, data: { ...d.data, links: links.map((x, i) => (i === k ? { ...x, label: e.target.value } : x)) } })} /></div>
                <div className="min-w-0 flex-1"><Input aria-label="Link" value={l.url} placeholder="example.com/you" onChange={(e) => setD({ ...d, data: { ...d.data, links: links.map((x, i) => (i === k ? { ...x, url: e.target.value } : x)) } })} /></div>
                <button type="button" aria-label="Remove" onClick={() => setD({ ...d, data: { ...d.data, links: links.filter((_, i) => i !== k) } })} className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-fg"><Trash2 className="size-4" /></button>
              </div>
            ))}
            {errors["data.links"]?.[0] && <p className="text-[12px] text-red-600">{errors["data.links"][0]}</p>}
            {links.length < 6 && <div><Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setD({ ...d, data: { ...d.data, links: [...links, { label: "", url: "" }] } })}>Add a button</Button></div>}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Design</h2>
          <div className="mt-3">{t?.lockStyle ? <Notice tone="neutral" title="Your company's design">Everyone in this workspace uses the same design, set by an owner or admin.</Notice> : <DesignPicker style={d.style} onChange={(style) => setD({ ...d, style })} />}</div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Sharing</h2>
          <div className="mt-3 grid gap-4">
            <Field label="Your link" error={errors.slug?.[0]} hint="Letters, digits and dashes">
              {(p) => (
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-[13px] text-muted">{url.replace(/^https?:\/\//, "").replace(/\/id\/.*$/, "")}/id/</span>
                  <Input {...p} value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} maxLength={40} />
                </div>
              )}
            </Field>
            <label className="flex items-center gap-2 text-[13px]"><Switch label="Card is on" checked={d.published} onChange={(v) => setD({ ...d, published: v })} /><span>The link shows your card <span className="text-muted">(switch off to hide it)</span></span></label>
            <label className="flex items-center gap-2 text-[13px]"><Switch label="Swap details" checked={d.exchange} onChange={(v) => setD({ ...d, exchange: v })} /><span>People who open it can send you their details <span className="text-muted">(they also go to your CRM)</span></span></label>
          </div>
        </Card>
        {dirty && (
          <div className="sticky bottom-3 z-10 flex items-center justify-end gap-2 rounded-2xl border border-border bg-surface/95 p-2 shadow-lg backdrop-blur">
            <span className="mr-auto pl-2 text-[12.5px] text-muted">Unsaved changes</span>
            <Button onClick={() => setD(init(me.card))}>Undo</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </div>
        )}
      </div>

    </div>
  );
}

function CompanyTemplate({ base, t }: { base: string; t: Template | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<Template>(t ?? { data: {}, style: {}, lockStyle: false, lockCompany: true });
  const save = useMutation({
    mutationFn: () => api(`${base}/template`, { method: "PUT", body: { data: { company: v.data.company ?? "", tagline: v.data.tagline ?? "", website: v.data.website ?? "", address: v.data.address ?? "" }, style: v.style, lockStyle: v.lockStyle, lockCompany: v.lockCompany } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["card", base] });
      toast({ tone: "success", title: "Template saved", description: "Everyone's card follows it now." });
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const preview = effective({ data: SAMPLE, style: {}, hidden: [] }, { ...v, lockStyle: true });
  return (
    <div className="grid gap-6">
      <div className="grid min-w-0 content-start gap-6">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Your company on every card</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {FIELDS.filter((f) => f.company).map((f) => (
              <Field key={f.id} label={f.label} className={f.long ? "sm:col-span-2" : undefined}>{(p) => (f.long ? <Textarea {...p} rows={2} value={String(v.data[f.id] ?? "")} onChange={(e) => setV({ ...v, data: { ...v.data, [f.id]: e.target.value } })} /> : <Input {...p} value={String(v.data[f.id] ?? "")} onChange={(e) => setV({ ...v, data: { ...v.data, [f.id]: e.target.value } })} />)}</Field>
            ))}
            <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><Switch label="Lock company details" checked={v.lockCompany} onChange={(x) => setV({ ...v, lockCompany: x })} /> Members can&apos;t change these</label>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">House design</h2>
          <div className="mt-3 grid gap-4">
            <DesignPicker style={v.style} onChange={(style) => setV({ ...v, style })} />
            <label className="flex items-center gap-2 text-[13px]"><Switch label="Lock design" checked={v.lockStyle} onChange={(x) => setV({ ...v, lockStyle: x })} /> Everyone uses this design (members can&apos;t pick their own)</label>
          </div>
        </Card>
        <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save template</Button></div>
      </div>
      <div className="order-first flex justify-center rounded-[22px] bg-surface-2 p-5"><CardFace data={preview.data} style={preview.style} /></div>
    </div>
  );
}

function TeamCards({ base }: { base: string }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["card", base, "all"], queryFn: () => api<Team>(`${base}/all`) });
  const gen = useMutation({
    mutationFn: () => api<{ made: number }>(`${base}/generate`, { method: "POST" }),
    onSuccess: (r) => {
      void q.refetch();
      toast({ tone: "success", title: r.made ? `Made ${r.made} business ${r.made === 1 ? "ID" : "IDs"}` : "Everyone already has one" });
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-60" />;
  const missing = q.data.members.filter((m) => !m.card).length;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Everyone&apos;s business IDs</h2>
        {missing > 0 && <Button size="sm" variant="primary" icon={<Users className="size-3.5" />} loading={gen.isPending} onClick={() => gen.mutate()}>Make cards for {missing} {missing === 1 ? "person" : "people"}</Button>}
      </div>
      <ul className="mt-3 divide-y divide-border">
        {q.data.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{m.name}</span>
              <span className="block truncate text-[12px] text-muted">{m.card ? m.card.title || m.role : "No card yet"}</span>
            </span>
            {m.card && (
              <>
                {!m.card.published && <Badge tone="warning">Off</Badge>}
                <span className="hidden text-[12px] text-muted sm:inline">{m.card.views} views · {m.card.saves} saves</span>
                <a href={m.card.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[12px] font-medium hover:bg-surface-2"><ExternalLink className="size-3.5" /> Open</a>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function BusinessIdView() {
  const { org } = useSession();
  const base = `/api/v1/orgs/${org.id}/cards`;
  const manage = ["owner", "admin"].includes(org.role);
  const [tab, setTab] = useState<"mine" | "template" | "team">("mine");
  const q = useQuery({ queryKey: ["card", base], queryFn: () => api<Me>(`${base}/me`) });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-[15px] font-semibold">Business ID</h2>
        <p className="text-[13px] text-muted">Your digital business card for {org.name}: share it as a link or QR code, and people can save you to their phone in one tap — or send you their details back.</p>
      </div>
      {manage && <Tabs value={tab} onChange={setTab} tabs={[{ value: "mine", label: "My business ID" }, { value: "template", label: "Company template" }, { value: "team", label: "Team" }]} />}
      {/* A fresh editor whenever the saved card changes, so the draft starts from it. */}
      {tab === "mine" && <MyCard key={q.data.card.updatedAt} base={base} me={q.data} />}
      {tab === "template" && manage && <CompanyTemplate base={base} t={q.data.template} />}
      {tab === "team" && manage && <TeamCards base={base} />}
    </div>
  );
}
