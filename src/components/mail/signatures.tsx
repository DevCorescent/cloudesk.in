"use client";

// Signatures: your saved signatures (each a design + your details), which one
// every mailbox uses for new mail and for replies, and the editor — pick a
// ready-made design, fill in your details once, upload a logo or photo, and
// see it live exactly as recipients will. The composer's picker lives here too.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ImagePlus, PenLine, Plus, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ConfirmDialog, Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Button, Field, IconButton, Input, Select, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { MetaOut, SignatureOut, SignaturesOut } from "@/lib/mail/api";
import { ACCENTS, DESIGNS, signatureFields, signatureHtml, type DesignId, type SignatureFields } from "@/lib/mail/signature";
import { mailKey, useMailApi } from "./shared";

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

export function useSignatures() {
  const { orgId, call } = useMailApi();
  return useQuery({ queryKey: mailKey(orgId, "signatures"), queryFn: () => call<SignaturesOut>("signatures"), staleTime: 60_000 });
}

/** The signature exactly as it will be sent (our renderer escapes every value and allows only https links). */
export function SignaturePreview({ design, fields, className }: { design: DesignId; fields: SignatureFields; className?: string }) {
  const html = useMemo(() => signatureHtml(design, fields, origin()), [design, fields]);
  // Built by signatureHtml from escaped values and https-only links.
  // Images keep their own sizes, as in mail apps (the app's CSS would otherwise shrink them in narrow cells).
  return <div className={cx("overflow-x-auto text-left [&_img]:max-w-none", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Turns stored fields into valid ones for the preview, even half-filled. */
const previewable = (f: Partial<SignatureFields>): SignatureFields => {
  const ok = signatureFields.safeParse(f);
  if (ok.success) return ok.data;
  const clean: Record<string, unknown> = { ...f, name: f.name?.trim() || "Your name" };
  for (const issue of signatureFields.safeParse(clean).error?.issues ?? []) delete clean[String(issue.path[0])];
  return signatureFields.parse({ ...clean, name: clean.name || "Your name" });
};

// ── Settings tab ────────────────────────────────────────────────────────────

export function SignatureSettings({ meta }: { meta: MetaOut }) {
  const { orgId, call } = useMailApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useSignatures();
  const [edit, setEdit] = useState<{ id: string | null; name: string; design: DesignId; fields: Partial<SignatureFields> } | null>(null);
  const [remove, setRemove] = useState<SignatureOut | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: mailKey(orgId, "signatures") });
  const mine = meta.accounts.find((a) => a.mine) ?? meta.accounts[0];
  const starter: Partial<SignatureFields> = { name: meta.me.name, email: mine?.address ?? meta.me.email, accent: ACCENTS[0] };

  const setDefault = async (accountId: string, patch: { newId?: string | null; replyId?: string | null }) => {
    const cur = q.data?.defaults[accountId] ?? { newId: null, replyId: null };
    try {
      await call("signatures/defaults", "PUT", { accountId, ...cur, ...patch });
      void reload();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };
  const copyHtml = async (s: SignatureOut) => {
    try {
      const html = signatureHtml(s.design, s.fields, origin());
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([html], { type: "text/plain" }) })]);
      toast({ tone: "success", title: "Copied", description: "Paste it into the signature settings of Gmail, Outlook or Apple Mail." });
    } catch {
      toast({ tone: "error", title: "Your browser blocked copying" });
    }
  };

  if (q.isError) return <p className="text-[13px] text-danger">{errorMessage(q.error)}</p>;
  if (!q.data) return <Skeleton className="h-48" />;
  const sigs = q.data.signatures;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-[13.5px] text-muted">Designed signatures that look right in every mail app. Pick one per mailbox, and change it on any email.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ id: null, name: sigs.length ? "Signature" : "Work", design: "corporate", fields: starter })}>New signature</Button>
      </div>

      {!sigs.length ? (
        <div className="rounded-[20px] border border-border bg-surface p-5">
          <p className="text-[14px] font-semibold">Start from a design</p>
          <p className="mt-0.5 text-[12.5px] text-muted">Each one is filled in with your details — pick one and finish it in a minute.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DESIGNS.map((d) => (
              <button key={d.id} type="button" onClick={() => setEdit({ id: null, name: d.name, design: d.id, fields: { ...starter, ...SAMPLE } })} className="group overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)] text-left transition-shadow hover:shadow-[0_10px_30px_-16px_rgb(0_0_0/0.35)]">
                <div className="pointer-events-none h-[132px] overflow-hidden bg-white p-4"><div className="w-[143%] origin-top-left scale-[0.7]"><SignaturePreview design={d.id} fields={previewable({ ...starter, ...SAMPLE })} /></div></div>
                <div className="border-t border-border px-3.5 py-2.5"><p className="text-[13px] font-semibold">{d.name}</p><p className="truncate text-[12px] text-muted">{d.line}</p></div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {sigs.map((s) => (
              <div key={s.id} className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-surface">
                <div className="flex items-center gap-2 px-4 pt-3.5">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{s.name}<span className="ml-2 text-[12px] font-normal text-muted">{DESIGNS.find((d) => d.id === s.design)?.name}</span></p>
                  <IconButton size="sm" label="Copy as HTML (for other mail apps)" icon={<Copy className="size-3.5" />} onClick={() => void copyHtml(s)} />
                  <IconButton size="sm" label="Edit" icon={<PenLine className="size-3.5" />} onClick={() => setEdit({ id: s.id, name: s.name, design: s.design, fields: s.fields })} />
                  <IconButton size="sm" label="Delete" icon={<Trash2 className="size-3.5" />} onClick={() => setRemove(s)} />
                </div>
                <div className="m-3 flex-1 rounded-[14px] bg-white p-4 ring-1 ring-black/5"><SignaturePreview design={s.design} fields={s.fields} /></div>
              </div>
            ))}
          </div>

          <div className="rounded-[20px] border border-border bg-surface">
            <div className="px-4 pt-4 pb-2">
              <p className="text-[14px] font-semibold">Defaults by mailbox</p>
              <p className="text-[12.5px] text-muted">Used automatically — you can switch on any email before sending.</p>
            </div>
            <div className="divide-y divide-border">
              {meta.accounts.map((a) => {
                const d = q.data!.defaults[a.id];
                const pick = (value: string | null | undefined, onChange: (v: string | null) => void, label: string) => (
                  <Select aria-label={`${label} for ${a.address}`} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="!h-8 !text-[13px]">
                    <option value="">No signature</option>
                    {sigs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                );
                return (
                  <div key={a.id} className="grid items-center gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium"><span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} /><span className="truncate">{a.name}</span><span className="hidden truncate font-normal text-muted md:inline">{a.address}</span></span>
                    <label className="grid gap-0.5 text-[11.5px] text-muted">New mail{pick(d ? d.newId : sigs[0]?.id, (v) => void setDefault(a.id, { newId: v }), "New mail")}</label>
                    <label className="grid gap-0.5 text-[11.5px] text-muted">Replies &amp; forwards{pick(d ? d.replyId : sigs[0]?.id, (v) => void setDefault(a.id, { replyId: v }), "Replies")}</label>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {edit && <SignatureEditor initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      {remove && (
        <ConfirmDialog
          open
          destructive
          title={`Delete “${remove.name}”?`}
          description="Mailboxes using it will send without a signature until you pick another."
          confirmLabel="Delete"
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            try {
              await call(`signatures/${remove.id}`, "DELETE");
              void reload();
            } catch (e) {
              toast({ tone: "error", title: errorMessage(e) });
            }
            setRemove(null);
          }}
        />
      )}
    </div>
  );
}

/** Example extras so the design gallery shows what each design can do. */
const SAMPLE: Partial<SignatureFields> = { title: "Head of Partnerships", company: "Saffron & Sage", phone: "+91 98200 12345", website: "https://example.com", address: "12 MG Road, Bengaluru 560001", linkedin: "https://linkedin.com", ctaLabel: "Book a meeting", ctaUrl: "https://example.com/book" };

// ── Editor ──────────────────────────────────────────────────────────────────

function SignatureEditor({ initial, onClose, onSaved }: { initial: { id: string | null; name: string; design: DesignId; fields: Partial<SignatureFields> }; onClose: () => void; onSaved: () => void }) {
  const { call } = useMailApi();
  const toast = useToast();
  const [name, setName] = useState(initial.name);
  const [design, setDesign] = useState<DesignId>(initial.design);
  const [f, setF] = useState<Partial<SignatureFields>>(() => (initial.id ? initial.fields : Object.fromEntries(Object.entries(initial.fields).filter(([k]) => !(k in SAMPLE)))));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "photo" | null>(null);
  const parsed = signatureFields.safeParse(f);
  const errors = Object.fromEntries((parsed.error?.issues ?? []).map((i) => [String(i.path[0]), i.message])) as Record<string, string>;
  const preview = previewable(f);
  const set = (k: keyof SignatureFields, v: string) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: keyof SignatureFields, label: string, placeholder = "", hint?: string) => (
    <Field label={label} hint={hint} error={(f[k] as string | undefined) ? errors[k] : k === "name" ? errors[k] : undefined}>{(p) => <Input {...p} value={(f[k] as string | undefined) ?? ""} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />}</Field>
  );

  const upload = async (kind: "logo" | "photo", file: File) => {
    if (file.size > 1024 * 1024) return toast({ tone: "error", title: "Use an image under 1 MB", description: "A logo around 300 px wide is plenty." });
    setUploading(kind);
    try {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const r = await call<{ url: string }>("signatures/image", "POST", { data });
      set(kind, r.url);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setUploading(null);
    }
  };
  const save = async () => {
    if (!parsed.success) return toast({ tone: "error", title: parsed.error.issues[0]?.message ?? "Check the details" });
    setBusy(true);
    try {
      await call(initial.id ? `signatures/${initial.id}` : "signatures", initial.id ? "PUT" : "POST", { name, design, fields: parsed.data });
      toast({ tone: "success", title: "Signature saved" });
      onSaved();
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="2xl" title={initial.id ? "Edit signature" : "New signature"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save signature</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="grid content-start gap-5">
          <Field label="Signature name" hint="Only you see this — e.g. “Formal”, “Short reply”">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Section title="You">
            <div className="grid gap-3 sm:grid-cols-2">
              {text("name", "Full name")}
              {text("title", "Job title", "Head of Sales")}
              {text("department", "Department", "Retail partnerships")}
              {text("company", "Company", "Saffron & Sage Pvt Ltd")}
            </div>
          </Section>
          <Section title="Contact">
            <div className="grid gap-3 sm:grid-cols-2">
              {text("phone", "Phone", "+91 80 4000 1234")}
              {text("mobile", "Mobile", "+91 98200 12345")}
              {text("email", "Email")}
              {text("website", "Website", "https://yourcompany.com")}
            </div>
            {text("address", "Address", "12 MG Road, Bengaluru 560001")}
          </Section>
          <Section title="Brand">
            <div className="grid gap-3 sm:grid-cols-2">
              <ImageField label="Logo" value={f.logo ?? ""} busy={uploading === "logo"} error={f.logo ? errors.logo : undefined} onUpload={(file) => void upload("logo", file)} onClear={() => set("logo", "")} />
              <ImageField label="Photo" value={f.photo ?? ""} busy={uploading === "photo"} error={f.photo ? errors.photo : undefined} round onUpload={(file) => void upload("photo", file)} onClear={() => set("photo", "")} />
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Brand colour</p>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENTS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={f.accent === c} onClick={() => set("accent", c)} className={cx("grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-[var(--bg)]", f.accent === c && "ring-2 ring-fg")} style={{ background: c }}>{f.accent === c && <Check className="size-3.5 text-white" />}</button>)}
                <label className="ml-1 flex items-center gap-1.5 text-[12.5px] text-muted">Custom <input type="color" aria-label="Custom colour" value={f.accent ?? "#0b5cad"} onChange={(e) => set("accent", e.target.value)} className="size-7 cursor-pointer rounded-full border border-border bg-transparent p-0" /></label>
              </div>
            </div>
            {text("tagline", "Tagline", "Handcrafted homeware since 2012")}
          </Section>
          <Section title="Social" collapsed={!f.linkedin && !f.twitter && !f.instagram && !f.facebook && !f.youtube}>
            <div className="grid gap-3 sm:grid-cols-2">
              {text("linkedin", "LinkedIn", "https://linkedin.com/in/…")}
              {text("twitter", "X (Twitter)", "https://x.com/…")}
              {text("instagram", "Instagram", "https://instagram.com/…")}
              {text("facebook", "Facebook", "https://facebook.com/…")}
              {text("youtube", "YouTube", "https://youtube.com/@…")}
            </div>
          </Section>
          <Section title="Button and legal note" collapsed={!f.ctaUrl && !f.disclaimer}>
            <div className="grid gap-3 sm:grid-cols-2">
              {text("ctaLabel", "Button text", "Book a meeting", "Shown by the “Call to action” design")}
              {text("ctaUrl", "Button link", "https://cal.com/you")}
            </div>
            <Field label="Disclaimer" hint="Small print under the signature">{(p) => <Textarea {...p} rows={3} value={f.disclaimer ?? ""} onChange={(e) => set("disclaimer", e.target.value)} placeholder="This email and any attachments are confidential and intended only for the addressee…" />}</Field>
          </Section>
        </div>

        {/* On phones the design and preview come first; on wide screens they sit beside the form. */}
        <div className="order-first grid content-start gap-4 lg:sticky lg:top-0 lg:order-none">
          <div>
            <p className="mb-2 text-[13px] font-medium">Design</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DESIGNS.map((d) => (
                <button key={d.id} type="button" aria-pressed={design === d.id} onClick={() => setDesign(d.id)} className={cx("overflow-hidden rounded-[12px] border text-left transition-colors", design === d.id ? "border-sky-500 ring-2 ring-sky-500/30" : "border-border hover:border-fg/25")}>
                  <div className="pointer-events-none h-[64px] overflow-hidden bg-white p-2"><div className="w-[238%] origin-top-left scale-[0.42]"><SignaturePreview design={d.id} fields={preview} /></div></div>
                  <p className="truncate border-t border-border px-2 py-1.5 text-[11.5px] font-medium">{d.name}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 flex items-center justify-between text-[13px] font-medium">Preview <span className="text-[11.5px] font-normal text-muted">As recipients see it</span></p>
            <div className="overflow-hidden rounded-[16px] border border-border bg-white">
              <div className="border-b border-black/5 px-4 py-2.5 text-[12px] text-[#6e6e73]">Hi Anika,<br /><br />Thanks for your order — it ships tomorrow.</div>
              <div className="p-4"><SignaturePreview design={design} fields={preview} /></div>
            </div>
            <p className="mt-2 text-[11.5px] text-muted">{DESIGNS.find((d) => d.id === design)?.line}. Built with tables and inline styles, so it looks the same in Gmail, Outlook and Apple Mail.</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Section({ title, children, collapsed }: { title: string; children: React.ReactNode; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="grid gap-3 rounded-[16px] border border-border p-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center justify-between text-left text-[12px] font-semibold tracking-[0.08em] text-subtle uppercase">
        {title} <ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && children}
    </section>
  );
}

function ImageField({ label, value, busy, error, round, onUpload, onClear }: { label: string; value: string; busy: boolean; error?: string; round?: boolean; onUpload: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-1.5">
      <p className="text-[13px] font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <span className={cx("grid size-12 shrink-0 place-items-center overflow-hidden border border-border bg-white", round ? "rounded-full" : "rounded-[10px]")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded signature image */}
          {value ? <img src={value} alt="" className={cx("size-full", round ? "object-cover" : "object-contain p-1")} /> : <ImagePlus className="size-4 text-subtle" />}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" loading={busy} onClick={() => input.current?.click()}>{value ? "Replace" : "Upload"}</Button>
          {value && <IconButton size="sm" label={`Remove ${label.toLowerCase()}`} icon={<X className="size-3.5" />} onClick={onClear} />}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file); e.target.value = ""; }} />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// ── Composer picker ─────────────────────────────────────────────────────────

/** "Signature: Formal ▾" in the composer; null means none. */
export function SignaturePicker({ signatures, value, onChange }: { signatures: SignatureOut[]; value: string | null; onChange: (id: string | null) => void }) {
  const current = signatures.find((s) => s.id === value);
  return (
    <Menu
      label="Signature"
      align="start"
      trigger={(p) => (
        <Button {...p} size="sm" variant="ghost" icon={<PenLine className="size-3.5" />}>
          <span className="max-w-[120px] truncate">{current ? current.name : "No signature"}</span> <ChevronDown className="size-3" />
        </Button>
      )}
      items={[
        ...signatures.map((s) => ({ label: `${s.id === value ? "✓ " : ""}${s.name}`, onSelect: () => onChange(s.id) })),
        { label: `${value === null ? "✓ " : ""}No signature`, onSelect: () => onChange(null) },
        "separator" as const,
        { label: "Manage signatures…", onSelect: () => window.open("/mail/settings?tab=signatures", "_blank", "noopener") },
      ]}
    />
  );
}
