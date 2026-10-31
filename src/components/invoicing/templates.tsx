"use client";

// Templates: the owner's designs, eight ready-made ones, uploading the
// invoice they use today to match it, and a studio to change every detail.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Columns2, FileUp, ImagePlus, Loader2, Plus, Sparkles, Star, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, ErrorState, Input, Select, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { FONTS, LAYOUTS, templateConfigSchema, type DocType, type InvoiceSettings, type TemplateConfig } from "@/lib/invoicing/model";
import { renderDocument } from "@/lib/invoicing/render";
import { sampleDoc } from "@/lib/invoicing/sample";
import { SubHeader } from "../store/shared";
import { colorsFromImageUrl } from "../builder/media";
import { invApi, useFitZoom, useInv, type Boot, type Template } from "./shared";

function thumb(config: TemplateConfig, boot: Boot, type: DocType = "invoice", zoom: number) {
  const doc = { ...sampleDoc(boot.settings, boot.today), type };
  return renderDocument({ doc, settings: boot.settings, template: config, zoom }).html;
}

function Thumb({ config, boot, label, onClick, active, badge, actions }: { config: TemplateConfig; boot: Boot; label: string; onClick?: () => void; active?: boolean; badge?: ReactNode; actions?: ReactNode }) {
  const [box, zoom] = useFitZoom(config.paper);
  const html = useMemo(() => (zoom ? thumb(config, boot, "invoice", zoom) : ""), [config, boot, zoom]);
  return (
    <div className={cx("glass-card lx-card group overflow-hidden rounded-[18px]", active && "ring-2 ring-fg/80")}>
      <button ref={box} type="button" onClick={onClick} className="relative block h-[300px] w-full overflow-hidden bg-[#e9e9ee] text-left" aria-label={`Open ${label}`}>
        <iframe title={label} srcDoc={html} tabIndex={-1} className="pointer-events-none absolute inset-0 h-full w-full border-0" />
      </button>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
        {badge}
        {actions}
      </div>
    </div>
  );
}

export function TemplatesView() {
  const { projectId, apiBase, base, boot } = useInv();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [upload, setUpload] = useState(false);
  const add = useMutation({
    mutationFn: (from: string) => api<{ template: Template }>(invApi(apiBase, "templates"), { method: "POST", body: { name: boot.prebuilt.find((p) => p.id === from)!.name, from } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      router.push(`${base}/templates/${r.template.id}`);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't add the design", description: errorMessage(e) }),
  });
  const def = boot.settings.defaultTemplateId ?? boot.templates[0]?.id;
  return (
    <div>
      <SubHeader
        title="Templates"
        description="How your invoices, quotations and credit notes look on paper and on screen. Every detail can be changed."
        actions={<Button variant="primary" icon={<Upload className="size-3.5" />} onClick={() => setUpload(true)}>Upload your invoice</Button>}
      />
      <button type="button" onClick={() => setUpload(true)} className="glass-card mb-6 flex w-full items-center gap-4 rounded-[var(--radius-xl)] border border-dashed border-border-strong p-5 text-left transition-colors hover:bg-surface-2/60">
        <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-fg text-bg"><FileUp className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Already have an invoice format you like?</span>
          <span className="block text-[13px] text-muted">Upload a photo, scan or PDF of it. {boot.ai ? "We'll read its layout, colours, columns, wording and your business and bank details, and build a matching template for you to check." : "We'll keep it beside the editor so you can match it exactly. (Connect an AI provider in Settings → AI providers to have it read automatically.)"}</span>
        </span>
      </button>

      <h2 className="mb-3 text-[13px] font-semibold">Your templates</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {boot.templates.map((t) => (
          <Thumb key={t.id} config={t.config} boot={boot} label={t.name} onClick={() => router.push(`${base}/templates/${t.id}`)} active={t.id === def} badge={t.id === def ? <Badge tone="accent">Default</Badge> : t.source === "uploaded" ? <Badge>From your file</Badge> : null} />
        ))}
      </div>

      <h2 className="mb-1 text-[13px] font-semibold">Professional designs</h2>
      <p className="mb-3 text-[12px] text-muted">Add one to your templates, then make it yours — colours, fonts, columns, wording, everything.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {boot.prebuilt.map((p) => (
          <Thumb
            key={p.id}
            config={p.config}
            boot={boot}
            label={p.name}
            onClick={() => add.mutate(p.id)}
            actions={
              <Button size="sm" icon={add.isPending && add.variables === p.id ? <Loader2 className="size-3.5 lx-spin" /> : <Plus className="size-3.5" />} onClick={() => add.mutate(p.id)} disabled={add.isPending}>
                Use
              </Button>
            }
          />
        ))}
      </div>
      {upload && <UploadDialog onClose={() => setUpload(false)} />}
    </div>
  );
}

type ReadResult = { template: Template; ai: boolean; suggestions: null | { business: Record<string, string>; payment: Record<string, string>; terms?: string; notes?: string; numbering?: { prefix: string; yearly: boolean; pad: number }; currency?: string }; extracted: null | { uncertain: string[]; layout: string } };

function UploadDialog({ onClose }: { onClose: () => void }) {
  const { projectId, apiBase, base, boot } = useInv();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [apply, setApply] = useState({ business: true, payment: true, terms: true, numbering: true });
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(f.type) && !f.name.toLowerCase().endsWith(".pdf")) return toast({ tone: "error", title: "Use a PNG, JPEG, WebP or PDF" });
    if (f.size > 5 * 1024 * 1024) return toast({ tone: "error", title: "That file is over 5 MB", description: "Export a smaller image or a single-page PDF." });
    setFile(f);
  };
  const read = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set("file", file!);
      const res = await fetch(invApi(apiBase, "templates/read"), { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "Couldn't read the file");
      return j as ReadResult;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      setResult(r);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't read it", description: errorMessage(e) }),
  });
  const finish = useMutation({
    mutationFn: async () => {
      const sug = result?.suggestions;
      if (sug && (apply.business || apply.payment || apply.terms || apply.numbering)) {
        const s = boot.settings;
        const b = sug.business;
        const next: InvoiceSettings = {
          ...s,
          business: apply.business ? { ...s.business, name: b.name ?? s.business.name, legalName: b.legalName ?? s.business.legalName, phone: b.phone ?? s.business.phone, email: b.email ?? s.business.email, website: b.website ?? s.business.website, gstin: b.gstin ?? s.business.gstin, pan: b.pan ?? s.business.pan, address: { ...s.business.address, line1: b.addressLine1 ?? s.business.address.line1, line2: b.addressLine2 ?? s.business.address.line2, city: b.city ?? s.business.address.city, state: b.state ?? s.business.address.state, postalCode: b.postalCode ?? s.business.address.postalCode } } : s.business,
          payment: apply.payment ? { ...s.payment, ...sug.payment } : s.payment,
          terms: apply.terms && sug.terms ? sug.terms : s.terms,
          notes: apply.terms && sug.notes ? sug.notes : s.notes,
          numbering: apply.numbering && sug.numbering ? { ...s.numbering, invoice: { ...s.numbering.invoice, ...sug.numbering } } : s.numbering,
        };
        await api(invApi(apiBase, "settings"), { method: "PUT", body: next });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      router.push(`${base}/templates/${result!.template.id}?compare=1`);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save your details", description: errorMessage(e) }),
  });
  const sug = result?.suggestions;
  const count = (o: Record<string, string> | undefined) => Object.keys(o ?? {}).length;
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={result ? (result.ai ? "Here's what we read" : "Saved for matching") : "Upload your current invoice"}
      description={result ? undefined : "A clear photo, scan or PDF of one invoice. Your customer's details on it are ignored."}
      footer={
        result ? (
          <Button variant="primary" loading={finish.isPending} onClick={() => finish.mutate()}>
            Open in the studio
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={read.isPending ? undefined : <Sparkles className="size-3.5" />} loading={read.isPending} disabled={!file} onClick={() => read.mutate()}>
              {boot.ai ? (read.isPending ? "Reading your invoice…" : "Read and match it") : "Upload"}
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          onClick={() => input.current?.click()}
          className={cx("grid cursor-pointer place-items-center gap-2 rounded-[18px] border-2 border-dashed p-10 text-center transition-colors", drag ? "border-accent bg-accent/5" : "border-border-strong hover:bg-surface-2/60")}
        >
          <FileUp className="size-7 text-muted" />
          <p className="text-[14px] font-medium">{file ? file.name : "Drop your invoice here, or click to choose"}</p>
          <p className="text-[12px] text-muted">{file ? `${(file.size / 1024).toFixed(0)} KB` : "PNG, JPEG, WebP or PDF · up to 5 MB"}</p>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          {read.isPending && <p className="mt-2 text-[12px] text-muted">This can take up to a minute for a detailed PDF.</p>}
        </div>
      ) : !result.ai ? (
        <div className="grid gap-3 text-[13px]">
          <p>We&apos;ve saved <b>{result.template.name}</b> starting from the Classic design, with your file kept beside the editor so you can match colours, columns and wording by eye.</p>
          <p className="rounded-[12px] bg-surface-2 p-3 text-[12px] text-muted">Reading the layout automatically needs an AI provider. Add an Anthropic key in Settings → AI providers and upload again to have it filled in for you.</p>
        </div>
      ) : (
        <div className="grid gap-3 text-[13px]">
          <p className="flex items-center gap-2"><Check className="size-4 text-success" /> A <b>{result.extracted?.layout}</b>-style template with your colours, columns and wording is ready to check.</p>
          {sug && (count(sug.business) > 0 || count(sug.payment) > 0 || sug.terms || sug.numbering) && (
            <div className="grid gap-2 rounded-[14px] border border-border p-3">
              <p className="text-[12px] font-medium text-muted">Also found on your invoice — use these in your settings?</p>
              {count(sug.business) > 0 && <Toggle checked={apply.business} onChange={(v) => setApply({ ...apply, business: v })} label="Business details" sub={[sug.business.name, sug.business.gstin, sug.business.city].filter(Boolean).join(" · ")} />}
              {count(sug.payment) > 0 && <Toggle checked={apply.payment} onChange={(v) => setApply({ ...apply, payment: v })} label="Bank & UPI details" sub={[sug.payment.bankName, sug.payment.accountNumber && `A/c …${sug.payment.accountNumber.slice(-4)}`, sug.payment.upiId].filter(Boolean).join(" · ")} />}
              {(sug.terms || sug.notes) && <Toggle checked={apply.terms} onChange={(v) => setApply({ ...apply, terms: v })} label="Terms & notes" sub={(sug.terms ?? sug.notes ?? "").slice(0, 80)} />}
              {sug.numbering && <Toggle checked={apply.numbering} onChange={(v) => setApply({ ...apply, numbering: v })} label="Invoice numbering" sub={`${sug.numbering.prefix || "(no prefix)"}${sug.numbering.yearly ? "/YYYY-YY/" : "-"}${"0".repeat(sug.numbering.pad - 1)}1`} />}
            </div>
          )}
          {!!result.extracted?.uncertain.length && (
            <div className="rounded-[12px] bg-warning/10 p-3 text-[12px]">
              <p className="font-medium">Worth checking</p>
              <ul className="mt-1 list-disc pl-4">{result.extracted.uncertain.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
          )}
          <p className="text-[12px] text-muted">Read by AI — compare it with your file in the studio before using it.</p>
        </div>
      )}
    </Dialog>
  );
}

function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="min-w-0"><span className="block font-medium">{label}</span>{sub && <span className="block truncate text-[12px] text-muted">{sub}</span>}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

// ── Studio ──────────────────────────────────────────────────────────────────

const LAYOUT_LABEL: Record<(typeof LAYOUTS)[number], string> = { classic: "Classic", modern: "Modern", minimal: "Minimal", band: "Colour band", elegant: "Elegant", compact: "GST compact", corporate: "Corporate", creative: "Creative" };
const FONT_LABEL: Record<(typeof FONTS)[number], string> = { sans: "System sans", serif: "Serif", humanist: "Humanist", geometric: "Geometric", mono: "Monospace" };
const SHOW_LABEL: Record<keyof TemplateConfig["show"], string> = { businessGstin: "Your GSTIN & PAN", clientGstin: "Client GSTIN", clientContact: "Client phone & email", shipTo: "Ship-to address", placeOfSupply: "Place of supply", amountInWords: "Amount in words", taxSummary: "HSN tax summary", bankDetails: "Bank details", upiQr: "UPI pay QR code", signature: "Signature block", notes: "Notes", terms: "Terms & conditions", paidStamp: "PAID stamp" };
const COL_LABEL: Record<keyof TemplateConfig["table"]["columns"], string> = { sn: "#", hsn: "HSN/SAC", quantity: "Quantity", unit: "Unit", rate: "Rate", discount: "Discount", tax: "Tax %", amount: "Amount" };
const LABEL_NAMES: Record<keyof TemplateConfig["labels"], string> = { invoice: "Invoice title", quote: "Quotation title", proforma: "Proforma title", credit_note: "Credit note title", billTo: "Bill to", shipTo: "Ship to", number: "Number", date: "Date", dueDate: "Due date", validUntil: "Valid until", item: "Item column", hsn: "HSN column", quantity: "Qty column", rate: "Rate column", discount: "Discount column", tax: "Tax column", amount: "Amount column", subtotal: "Subtotal", total: "Total", balance: "Balance due", notes: "Notes heading", terms: "Terms heading", signatory: "Signatory" };
const SWATCHES = ["#111111", "#1f2937", "#1d4ed8", "#4f46e5", "#0f766e", "#15803d", "#b45309", "#c2410c", "#be123c", "#7c4a1e"];

export function TemplateStudio({ id }: { id: string }) {
  const { boot } = useInv();
  const t = boot.templates.find((x) => x.id === id);
  if (!t) return <ErrorState title="Template not found" message="It may have been deleted." />;
  return <Studio key={t.id + t.updatedAt} t={t} />;
}

function Studio({ t }: { t: Template }) {
  const { projectId, apiBase, base, boot } = useInv();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(t.name);
  const [c, setC] = useState<TemplateConfig>(() => templateConfigSchema.parse(t.config));
  const [docType, setDocType] = useState<DocType>("invoice");
  const [compare, setCompare] = useState(() => t.hasReference && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("compare"));
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [refColors, setRefColors] = useState<string[]>([]);
  const [del, setDel] = useState(false);
  const dirty = name !== t.name || JSON.stringify(c) !== JSON.stringify(templateConfigSchema.parse(t.config));
  const isDefault = (boot.settings.defaultTemplateId ?? boot.templates[0]?.id) === t.id;
  const set = (patch: Partial<TemplateConfig>) => setC((x) => ({ ...x, ...patch }));

  // The uploaded file is fetched once into a blob URL (works for images and PDFs).
  useEffect(() => {
    if (!t.hasReference || !compare || refUrl) return;
    let url = "";
    void fetch(invApi(apiBase, `templates/${t.id}/reference`), { credentials: "same-origin" })
      .then((r) => r.blob())
      .then(async (b) => {
        url = URL.createObjectURL(b);
        setRefUrl(url);
        if (b.type.startsWith("image/")) setRefColors(((await colorsFromImageUrl(url).catch(() => [])) as { hex: string }[]).map((x) => x.hex).slice(0, 6));
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [t.hasReference, t.id, compare, refUrl, apiBase]);

  const [previewBox, zoom] = useFitZoom(c.paper);
  const html = useMemo(() => (zoom ? renderDocument({ doc: { ...sampleDoc(boot.settings, boot.today), type: docType, dueDate: docType === "credit_note" ? null : sampleDoc(boot.settings, boot.today).dueDate }, settings: boot.settings, template: c, zoom }).html : ""), [c, boot, docType, zoom]);

  const save = useMutation({
    mutationFn: () => api(invApi(apiBase, `templates/${t.id}`), { method: "PUT", body: { name, config: c } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      toast({ tone: "success", title: "Template saved", description: "New and edited documents using it will look like this." });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) }),
  });
  const makeDefault = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      await api(invApi(apiBase, "settings"), { method: "PUT", body: { ...boot.settings, defaultTemplateId: t.id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      toast({ tone: "success", title: `${name} is now your default` });
    },
  });
  const remove = useMutation({
    mutationFn: () => api(invApi(apiBase, `templates/${t.id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      router.push(`${base}/templates`);
    },
    onError: (e) => {
      setDel(false);
      toast({ tone: "error", title: "Couldn't delete", description: errorMessage(e) });
    },
  });
  const uploadSig = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch(invApi(apiBase, "upload"), { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "Upload failed");
      return j.asset.url as string;
    },
    onSuccess: (url) => set({ signature: { ...c.signature, image: url } }),
    onError: (e) => toast({ tone: "error", title: "Couldn't upload", description: errorMessage(e) }),
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href={`${base}/templates`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-4" /> Templates</Link>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="!h-9 max-w-64 text-[15px] font-semibold" aria-label="Template name" />
        {isDefault && <Badge tone="accent">Default</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          {t.hasReference && <Button size="sm" variant={compare ? "secondary" : "ghost"} icon={<Columns2 className="size-3.5" />} onClick={() => setCompare(!compare)}>{compare ? "Hide your invoice" : "Compare with your invoice"}</Button>}
          {!isDefault && <Button size="sm" variant="ghost" icon={<Star className="size-3.5" />} loading={makeDefault.isPending} onClick={() => makeDefault.mutate()}>Make default</Button>}
          {!isDefault && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(true)} aria-label="Delete template" />}
          <Button size="sm" variant="primary" loading={save.isPending} disabled={!dirty || !name.trim()} onClick={() => save.mutate()}>{dirty ? "Save template" : "Saved"}</Button>
        </div>
      </div>

      <div className={cx("grid gap-5", compare ? "xl:grid-cols-[320px_minmax(0,1fr)_minmax(0,1fr)]" : "xl:grid-cols-[340px_minmax(0,1fr)]")}>
        <div className="grid content-start gap-3 xl:max-h-[calc(100vh-150px)] xl:overflow-y-auto xl:pr-1">
          <Group title="Design">
            <div className="grid grid-cols-2 gap-1.5">
              {LAYOUTS.map((l) => (
                <button key={l} type="button" onClick={() => set({ layout: l })} aria-pressed={c.layout === l} className={cx("h-8 rounded-[10px] border text-[12px] font-medium transition-colors", c.layout === l ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>{LAYOUT_LABEL[l]}</button>
              ))}
            </div>
          </Group>
          <Group title="Colours">
            {refColors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] bg-surface-2/70 p-2 text-[11px]">
                <span className="text-muted">From your invoice:</span>
                {refColors.map((h) => <button key={h} type="button" title={`Use ${h} as the accent`} onClick={() => set({ colors: { ...c.colors, accent: h } })} className="size-6 rounded-full ring-1 ring-black/10" style={{ background: h }} />)}
              </div>
            )}
            {(["accent", "ink", "muted", "tableHeader"] as const).map((k) => (
              <label key={k} className="flex items-center justify-between gap-2 text-[13px]">
                <span>{{ accent: "Accent (titles, bands)", ink: "Text", muted: "Secondary text", tableHeader: "Table header fill" }[k]}</span>
                <span className="flex items-center gap-1.5">
                  <Input value={c.colors[k]} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set({ colors: { ...c.colors, [k]: e.target.value } })} className="!h-7 w-20 font-mono text-[11px]" aria-label={`${k} hex`} />
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c.colors[k]) ? c.colors[k] : "#000000"} onChange={(e) => set({ colors: { ...c.colors, [k]: e.target.value } })} className="size-7 cursor-pointer rounded border border-border" aria-label={`${k} colour`} />
                </span>
              </label>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((h) => <button key={h} type="button" aria-label={`Accent ${h}`} onClick={() => set({ colors: { ...c.colors, accent: h } })} className={cx("size-6 rounded-full ring-1 ring-black/10", c.colors.accent === h && "ring-2 ring-fg ring-offset-2 ring-offset-bg")} style={{ background: h }} />)}
            </div>
          </Group>
          <Group title="Type & paper">
            <Select value={c.font} onChange={(e) => set({ font: e.target.value as TemplateConfig["font"] })} aria-label="Font">
              {FONTS.map((f) => <option key={f} value={f}>{FONT_LABEL[f]}</option>)}
            </Select>
            <Range label="Text size" value={c.fontSize} min={8} max={13} step={0.5} unit="pt" onChange={(v) => set({ fontSize: v })} />
            <Segmented label="Paper" value={c.paper} onChange={(v) => set({ paper: v })} options={[{ value: "A4", label: "A4" }, { value: "Letter", label: "Letter" }, { value: "A5", label: "A5" }]} />
            <Range label="Margins" value={c.margin} min={6} max={30} step={1} unit="mm" onChange={(v) => set({ margin: v })} />
          </Group>
          <Group title="Logo">
            <Segmented label="Logo position" value={c.logo.position} onChange={(v) => set({ logo: { ...c.logo, position: v } })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }, { value: "none", label: "Hide" }]} />
            <Range label="Logo height" value={c.logo.height} min={8} max={40} step={1} unit="mm" onChange={(v) => set({ logo: { ...c.logo, height: v } })} />
            {!boot.settings.business.logo && <Link href={`${base}/settings`} className="text-[12px] text-accent">Add your logo in Settings →</Link>}
          </Group>
          <Group title="Item table">
            <Segmented label="Table style" value={c.table.style} onChange={(v) => set({ table: { ...c.table, style: v } })} options={[{ value: "lines", label: "Lines" }, { value: "striped", label: "Striped" }, { value: "boxed", label: "Boxed" }, { value: "minimal", label: "Minimal" }]} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {(Object.keys(COL_LABEL) as (keyof TemplateConfig["table"]["columns"])[]).map((k) => (
                <label key={k} className="flex items-center justify-between gap-2 text-[12px]">{COL_LABEL[k]}<Switch checked={c.table.columns[k]} onChange={(v) => set({ table: { ...c.table, columns: { ...c.table.columns, [k]: v } } })} label={`Show ${COL_LABEL[k]} column`} /></label>
              ))}
            </div>
          </Group>
          <Group title="Show on the document">
            <div className="grid gap-1.5">
              {(Object.keys(SHOW_LABEL) as (keyof TemplateConfig["show"])[]).map((k) => (
                <label key={k} className="flex items-center justify-between gap-2 text-[12px]">{SHOW_LABEL[k]}<Switch checked={c.show[k]} onChange={(v) => set({ show: { ...c.show, [k]: v } })} label={SHOW_LABEL[k]} /></label>
              ))}
            </div>
          </Group>
          <Group title="Wording">
            <p className="text-[11px] text-muted">Rename anything — e.g. “Tax Invoice” → “Bill of Supply”, “Rate” → “Price”.</p>
            <div className="grid gap-1.5">
              {(Object.keys(LABEL_NAMES) as (keyof TemplateConfig["labels"])[]).map((k) => (
                <label key={k} className="grid grid-cols-[110px_1fr] items-center gap-2 text-[12px]">
                  <span className="text-muted">{LABEL_NAMES[k]}</span>
                  <Input value={c.labels[k]} onChange={(e) => set({ labels: { ...c.labels, [k]: e.target.value.slice(0, 40) } })} className="!h-7 text-[12px]" />
                </label>
              ))}
            </div>
          </Group>
          <Group title="Signature & footer">
            <div className="flex items-center gap-3">
              {c.signature.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- uploaded signature
                <img src={c.signature.image} alt="Signature" className="h-10 max-w-32 rounded bg-white object-contain p-1" />
              ) : (
                <span className="grid h-10 w-24 place-items-center rounded border border-dashed border-border text-[11px] text-muted">No image</span>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-surface-2">
                {uploadSig.isPending ? <Loader2 className="size-3.5 lx-spin" /> : <ImagePlus className="size-3.5" />} {c.signature.image ? "Replace" : "Upload signature / stamp"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadSig.mutate(e.target.files[0])} />
              </label>
              {c.signature.image && <button type="button" className="text-[12px] text-muted hover:text-danger" onClick={() => set({ signature: { ...c.signature, image: "" } })}>Remove</button>}
            </div>
            <Input value={c.signature.name} onChange={(e) => set({ signature: { ...c.signature, name: e.target.value } })} placeholder={`For ${boot.settings.business.name || "your business"}`} aria-label="Signatory name" />
            <Textarea rows={2} value={c.footerText} onChange={(e) => set({ footerText: e.target.value })} placeholder="Footer, e.g. “Subject to Mumbai jurisdiction · This is a computer-generated invoice”" aria-label="Footer text" />
          </Group>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <Segmented label="Preview as" value={docType} onChange={setDocType} options={[{ value: "invoice", label: "Invoice" }, { value: "quote", label: "Quotation" }, { value: "credit_note", label: "Credit note" }]} />
            <span className="text-[12px] text-muted">Sample data · your business details</span>
          </div>
          <div ref={previewBox}>
            <iframe title="Template preview" srcDoc={html} className="h-[calc(100vh-190px)] min-h-[560px] w-full rounded-[var(--radius-xl)] border border-border bg-[#e9e9ee]" />
          </div>
        </div>

        {compare && (
          <div className="min-w-0">
            <p className="mb-2 flex h-8 items-center text-[12px] text-muted">Your invoice · {t.referenceName}</p>
            <div className="h-[calc(100vh-190px)] min-h-[560px] overflow-auto rounded-[var(--radius-xl)] border border-border bg-[#e9e9ee]">
              {!refUrl ? (
                <div className="grid h-full place-items-center"><Loader2 className="size-5 lx-spin text-muted" /></div>
              ) : t.referenceMime === "application/pdf" ? (
                <iframe title="Your invoice" src={refUrl} className="h-full w-full border-0" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- the owner's own upload
                <img src={refUrl} alt="Your uploaded invoice" className="mx-auto w-full max-w-full bg-white" />
              )}
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} destructive title={`Delete ${t.name}?`} description="Documents that used it switch to your default template." confirmLabel="Delete" />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass-card grid gap-2.5 rounded-[16px] p-3.5">
      <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1 text-[12px]">
      <span className="flex justify-between"><span>{label}</span><span className="text-muted tabular-nums">{value}{unit}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--accent)]" />
    </label>
  );
}
