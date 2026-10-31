"use client";

// Create or edit an invoice, quotation, proforma or credit note, with a live
// preview of the real printed document beside the form.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, BookmarkPlus, Eye, Plus, Repeat, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Button, ErrorState, Input, Select, Skeleton, Switch, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { addDays, DOC_LABEL, docInputSchema, emptyAddress, templateConfigSchema, type Adjustments, type DocInput, type DocType, type Line, type Party } from "@/lib/invoicing/model";
import { renderDocument } from "@/lib/invoicing/render";
import { prebuilt } from "@/lib/invoicing/templates";
import { computeDocTotals, isIntraState, lineGross } from "@/lib/invoicing/totals";
import { GST_STATES, validateGstin } from "@/lib/store/gst";
import { CURRENCIES } from "@/lib/store/money";
import { MoneyInput } from "../store/shared";
import { invApi, money, newLineId, TYPE_PATH, useFitZoom, useInv, useInvQuery, type Client, type DocDetail, type Item } from "./shared";

const STATES = Object.values(GST_STATES).sort();
const GST_RATES = [0, 25, 300, 500, 1200, 1800, 2800];
const pctLabel = (bps: number) => `${(bps / 100).toString()}%`;

type Draft = DocInput;

function blankLine(taxBps: number): Line {
  return { id: newLineId(), itemId: null, name: "", description: "", hsn: "", quantity: 1, unit: "", rate: 0, discount: null, taxBps };
}

export function DocEditor({ type, id }: { type: DocType; id?: string }) {
  const { projectId, base, boot } = useInv();
  const existing = useInvQuery<DocDetail>(`documents/${id}`, { enabled: !!id });
  if (id && existing.isError) return <ErrorState message={errorMessage(existing.error)} onRetry={() => existing.refetch()} />;
  if (id && !existing.data) return <Skeleton className="h-[70vh]" />;
  const s = boot.settings;
  const due = type === "quote" ? addDays(boot.today, s.quoteValidDays) : type === "invoice" || type === "proforma" ? addDays(boot.today, s.dueDays) : null;
  const d = existing.data?.document;
  const initial: Draft = d
    ? { type, clientId: d.clientId, client: d.client, issueDate: d.issueDate.slice(0, 10), dueDate: d.dueDate?.slice(0, 10) ?? null, currency: d.currency, lines: d.lines, adjustments: d.adjustments, taxMode: d.taxMode, inclusive: d.inclusive, placeOfSupply: d.placeOfSupply, title: d.title, reference: d.reference, notes: d.notes, terms: d.terms, footer: d.footer, customFields: d.customFields, templateId: d.templateId, recurring: d.recurring, number: d.number }
    : {
        type,
        clientId: null,
        client: { name: "", company: "", email: "", phone: "", gstin: "", billing: { ...emptyAddress(), country: s.business.address.country || "IN" }, shipping: null },
        issueDate: boot.today,
        dueDate: due,
        currency: s.currency,
        lines: [blankLine(s.taxMode === "none" ? 0 : s.defaultTaxBps)],
        adjustments: { discount: null, charges: [], roundOff: true },
        taxMode: s.taxMode,
        inclusive: s.inclusive,
        placeOfSupply: "",
        title: "",
        reference: "",
        notes: s.notes,
        terms: type === "credit_note" ? "" : s.terms,
        footer: "",
        customFields: [],
        templateId: s.defaultTemplateId,
        recurring: null,
        number: "",
      };
  return <Editor key={id ?? "new"} id={id} initial={initial} issued={!!d && d.status !== "draft"} existingNumber={d?.number ?? ""} backHref={id ? `${base}/${TYPE_PATH[type]}/${id}` : `${base}/${TYPE_PATH[type]}`} projectId={projectId} />;
}

function Editor({ id, initial, issued, existingNumber, backHref, projectId }: { id?: string; initial: Draft; issued: boolean; existingNumber: string; backHref: string; projectId: string }) {
  const { base, boot, apiBase } = useInv();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [doc, setDoc] = useState<Draft>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [saveClient, setSaveClient] = useState(!initial.clientId);
  const set = (patch: Partial<Draft>) => setDoc((d) => ({ ...d, ...patch }));
  const s = boot.settings;
  const type = doc.type;

  // Arriving from a client's page pre-selects them.
  const clients = useInvQuery<{ clients: Client[] }>("clients");
  const presetClient = params.get("client");
  const [presetDone, setPresetDone] = useState(false);
  if (!presetDone && presetClient && clients.data) {
    setPresetDone(true);
    const c = clients.data.clients.find((x) => x.id === presetClient);
    if (c) setDoc((d) => ({ ...d, clientId: c.id, client: partyOf(c), placeOfSupply: c.billing.state }));
  }

  const template = useMemo(() => {
    const t = boot.templates.find((x) => x.id === doc.templateId) ?? boot.templates.find((x) => x.id === s.defaultTemplateId) ?? boot.templates[0];
    return t ? templateConfigSchema.parse(t.config) : prebuilt("classic")!.config;
  }, [doc.templateId, boot.templates, s.defaultTemplateId]);
  const intraState = isIntraState(s.business.address.state, doc.placeOfSupply || doc.client.billing.state);
  const totals = computeDocTotals({ lines: doc.lines, adjustments: doc.adjustments, taxMode: doc.taxMode, inclusive: doc.inclusive, intraState, currency: doc.currency, taxLabel: s.taxLabel });
  const nextNumber = useMemo(() => {
    const n = s.numbering[type];
    const fy = (() => {
      const dt = new Date(`${doc.issueDate}T12:00:00Z`);
      const y = dt.getUTCMonth() >= 3 ? dt.getUTCFullYear() : dt.getUTCFullYear() - 1;
      return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    })();
    const seq = String(n.next).padStart(n.pad, "0");
    return n.yearly ? [n.prefix, fy, seq].filter(Boolean).join("/") : n.prefix ? `${n.prefix}-${seq}` : seq;
  }, [s.numbering, type, doc.issueDate]);

  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const parsed = docInputSchema.safeParse(doc);
      if (!parsed.success) throw Object.assign(new Error("Check the highlighted details"), { issues: [...new Set(parsed.error.issues.map((i) => i.message))] });
      let input = parsed.data;
      if (saveClient && !input.clientId && input.client.name) {
        const c = await api<{ client: Client }>(invApi(apiBase, "clients"), { method: "POST", body: { ...input.client, notes: "" } });
        input = { ...input, clientId: c.client.id };
        qc.invalidateQueries({ queryKey: ["invoicing", projectId, "clients"] });
      }
      if (id) {
        const r = await api<DocDetail>(invApi(apiBase, `documents/${id}`), { method: "PUT", body: { document: input } });
        if (issue && r.document.status === "draft") return api<DocDetail>(invApi(apiBase, `documents/${id}/issue`), { method: "POST" });
        return r;
      }
      return api<DocDetail>(invApi(apiBase, "documents"), { method: "POST", body: { document: input, issue } });
    },
    onSuccess: (r, issue) => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId] });
      toast({ tone: "success", title: issue ? `${DOC_LABEL[type]} ${r.document.number} is ready` : id ? "Saved" : "Draft saved", description: issue ? "Share it by link, email, WhatsApp or PDF." : undefined });
      router.push(`${base}/${TYPE_PATH[type]}/${r.document.id}`);
    },
    onError: (e) => {
      const issues = (e as { issues?: string[] }).issues;
      if (issues) setProblems(issues);
      else {
        setProblems([]);
        toast({ tone: "error", title: "Couldn't save", description: errorMessage(e) });
      }
    },
  });

  // ⌘/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save.mutate(issued);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [previewBox, zoom] = useFitZoom(template.paper);
  const previewHtml = useMemo(
    () =>
      zoom === 0 ? "" : renderDocument({
        doc: { ...doc, number: issued ? doc.number || existingNumber : doc.number || "", status: issued ? "sent" : "draft", amountPaid: 0, client: { ...doc.client, name: doc.client.name || "Client name" }, lines: doc.lines.map((l) => ({ ...l, name: l.name || "Item" })) },
        settings: s,
        template,
        zoom,
      }).html,
    [doc, s, template, issued, existingNumber, zoom],
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href={backHref} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Back
        </Link>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{id ? `Edit ${DOC_LABEL[type].toLowerCase()} ${existingNumber}` : `New ${DOC_LABEL[type].toLowerCase()}`}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select aria-label="Template" value={doc.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value || null })} className="!h-8 !w-auto text-[13px]">
            <option value="">Default template</option>
            {boot.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Button size="sm" variant="ghost" className="xl:hidden" icon={<Eye className="size-3.5" />} onClick={() => setShowPreview(!showPreview)}>
            Preview
          </Button>
          {!issued && (
            <Button size="sm" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>
              Save draft
            </Button>
          )}
          <Button size="sm" variant="primary" loading={save.isPending && (save.variables === true || issued)} onClick={() => save.mutate(true)}>
            {issued ? "Save changes" : type === "quote" ? "Save & issue quotation" : `Save & issue ${DOC_LABEL[type].toLowerCase()}`}
          </Button>
        </div>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="mb-4 rounded-[14px] border border-danger/30 bg-danger/5 px-4 py-3 text-[13px]">
          <p className="font-semibold text-danger">Please fix these first</p>
          <ul className="mt-1 list-disc pl-5 text-muted">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]">
        <div className="min-w-0 space-y-4">
          <ClientSection doc={doc} set={set} clients={clients.data?.clients ?? []} saveClient={saveClient} setSaveClient={setSaveClient} showErrors={problems.length > 0} />

          <section className="glass-card grid gap-3 rounded-[var(--radius-xl)] p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Labeled label={`${DOC_LABEL[type]} number`} hint={issued ? undefined : `Leave empty to use ${nextNumber}`}>
              <Input value={doc.number} onChange={(e) => set({ number: e.target.value.trim() })} placeholder={issued ? existingNumber : nextNumber} className="font-mono text-[13px]" />
            </Labeled>
            <Labeled label="Issue date">
              <Input type="date" value={doc.issueDate} onChange={(e) => set({ issueDate: e.target.value })} />
            </Labeled>
            {type !== "credit_note" && (
              <Labeled label={type === "quote" ? "Valid until" : "Due date"}>
                <Input type="date" value={doc.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} />
                <div className="mt-1 flex flex-wrap gap-1">
                  {(type === "quote" ? [7, 15, 30] : [0, 7, 15, 30, 45]).map((n) => (
                    <button key={n} type="button" onClick={() => set({ dueDate: addDays(doc.issueDate, n) })} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted hover:text-fg">
                      {n === 0 ? "On receipt" : `${n} days`}
                    </button>
                  ))}
                </div>
              </Labeled>
            )}
            <Labeled label="Client PO / reference">
              <Input value={doc.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="PO-1234" />
            </Labeled>
            {doc.taxMode === "gst" && (
              <Labeled label="Place of supply" hint={doc.taxMode === "gst" ? (intraState ? "Same state: CGST + SGST" : "Other state: IGST") : undefined}>
                <Select value={doc.placeOfSupply || doc.client.billing.state} onChange={(e) => set({ placeOfSupply: e.target.value })}>
                  <option value="">Choose a state</option>
                  {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                </Select>
              </Labeled>
            )}
            <Labeled label="Currency">
              <Select value={doc.currency} onChange={(e) => set({ currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
              </Select>
            </Labeled>
          </section>

          <LinesSection doc={doc} set={set} totals={totals} projectId={projectId} showErrors={problems.length > 0} />
          <TotalsSection doc={doc} set={set} totals={totals} intraState={intraState} />

          <section className="glass-card grid gap-3 rounded-[var(--radius-xl)] p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="Notes to the client">
                <Textarea rows={3} value={doc.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Thank you for your business!" />
              </Labeled>
              <Labeled label="Terms & conditions">
                <Textarea rows={3} value={doc.terms} onChange={(e) => set({ terms: e.target.value })} />
              </Labeled>
            </div>
            <Labeled label="Document title" hint={`Leave empty to use “${template.labels[type]}” from the template`}>
              <Input value={doc.title} onChange={(e) => set({ title: e.target.value })} placeholder={template.labels[type]} />
            </Labeled>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-muted">Extra fields</p>
              <div className="grid gap-2">
                {doc.customFields.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={f.label} onChange={(e) => set({ customFields: doc.customFields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label (e.g. Vehicle no.)" className="w-44" aria-label="Field label" />
                    <Input value={f.value} onChange={(e) => set({ customFields: doc.customFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder="Value" aria-label="Field value" />
                    <Button size="sm" variant="ghost" aria-label="Remove field" icon={<X className="size-3.5" />} onClick={() => set({ customFields: doc.customFields.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                {doc.customFields.length < 12 && (
                  <button type="button" onClick={() => set({ customFields: [...doc.customFields, { label: "", value: "" }] })} className="inline-flex w-fit items-center gap-1 text-[13px] text-accent">
                    <Plus className="size-3.5" /> Add a field (PO date, vehicle no., project…)
                  </button>
                )}
              </div>
            </div>
          </section>

          {type === "invoice" && <RecurringSection doc={doc} set={set} today={boot.today} />}
        </div>

        <div className={cx("min-w-0 xl:block", showPreview ? "block" : "hidden")}>
          <div className="xl:sticky xl:top-20">
            <p className="mb-2 flex items-center justify-between text-[12px] text-muted">
              <span>Live preview · {boot.templates.find((t) => t.id === doc.templateId)?.name ?? "default template"}</span>
              <span className="tabular-nums">{money(totals.total, doc.currency)}</span>
            </p>
            <div ref={previewBox}>
              <iframe title="Document preview" srcDoc={previewHtml} className="h-[calc(100vh-150px)] min-h-[520px] w-full rounded-[var(--radius-xl)] border border-border bg-[#e9e9ee]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const partyOf = (c: Client): Party => ({ name: c.name, company: c.company, email: c.email, phone: c.phone, gstin: c.gstin, billing: c.billing, shipping: c.shipping });

function Labeled({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("grid content-start gap-1", className)}>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}

function ClientSection({ doc, set, clients, saveClient, setSaveClient, showErrors }: { doc: Draft; set: (p: Partial<Draft>) => void; clients: Client[]; saveClient: boolean; setSaveClient: (v: boolean) => void; showErrors: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const c = doc.client;
  const setC = (patch: Partial<Party>) => set({ client: { ...c, ...patch } });
  const setAddr = (k: "billing" | "shipping", patch: Partial<Party["billing"]>) => setC({ [k]: { ...(c[k] ?? emptyAddress()), ...patch } } as Partial<Party>);
  const gst = c.gstin ? validateGstin(c.gstin) : null;
  const matches = clients.filter((x) => !query || `${x.name} ${x.company} ${x.email}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  const pick = (x: Client) => {
    set({ clientId: x.id, client: partyOf(x), placeOfSupply: x.billing.state });
    setOpen(false);
    setQuery("");
  };
  return (
    <section className="glass-card rounded-[var(--radius-xl)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Bill to</h2>
        <div className="relative w-full sm:w-72">
          <Input value={query} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} placeholder={clients.length ? `Choose from ${clients.length} saved client${clients.length === 1 ? "" : "s"}` : "No saved clients yet"} className="!h-8 text-[13px]" aria-label="Find a saved client" />
          {open && matches.length > 0 && (
            <ul className="glass-strong absolute right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-[12px] p-1 shadow-lg" role="listbox">
              {matches.map((x) => (
                <li key={x.id}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(x)} className="flex w-full flex-col rounded-[9px] px-3 py-2 text-left hover:bg-surface-2">
                    <span className="text-[13px] font-medium">{x.company || x.name}</span>
                    <span className="text-[11px] text-muted">{[x.company ? x.name : "", x.email, x.billing.city].filter(Boolean).join(" · ")}{x.balance ? ` · ${money(x.balance, doc.currency)} due` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="Contact name *">
          <Input value={c.name} onChange={(e) => setC({ name: e.target.value })} placeholder="Ananya Iyer" aria-invalid={showErrors && !c.name.trim()} />
        </Labeled>
        <Labeled label="Company">
          <Input value={c.company} onChange={(e) => setC({ company: e.target.value })} placeholder="Lotus Hospitality Pvt Ltd" />
        </Labeled>
        <Labeled label="Email" hint="Used to send the invoice and reminders">
          <Input type="email" value={c.email} onChange={(e) => setC({ email: e.target.value.trim() })} />
        </Labeled>
        <Labeled label="Phone / WhatsApp">
          <Input inputMode="tel" value={c.phone} onChange={(e) => setC({ phone: e.target.value })} />
        </Labeled>
        {doc.taxMode === "gst" && (
          <Labeled label="GSTIN" hint={gst ? (gst.ok ? `Valid · ${gst.state}` : gst.reason) : "For a B2B tax invoice"}>
            <Input
              value={c.gstin}
              onChange={(e) => {
                const g = e.target.value.toUpperCase().slice(0, 15);
                const v = validateGstin(g);
                set({ client: { ...c, gstin: g, billing: v.ok && !c.billing.state ? { ...c.billing, state: v.state } : c.billing }, ...(v.ok && !doc.placeOfSupply ? { placeOfSupply: v.state } : {}) });
              }}
              className="font-mono text-[13px]"
              aria-invalid={!!gst && !gst.ok}
            />
          </Labeled>
        )}
        <Labeled label="Address" className="sm:col-span-2">
          <Input value={c.billing.line1} onChange={(e) => setAddr("billing", { line1: e.target.value })} placeholder="Street, building" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input value={c.billing.line2} onChange={(e) => setAddr("billing", { line2: e.target.value })} placeholder="Area" aria-label="Address line 2" />
            <Input value={c.billing.city} onChange={(e) => setAddr("billing", { city: e.target.value })} placeholder="City" aria-label="City" />
            {doc.taxMode === "gst" ? (
              <Select value={c.billing.state} onChange={(e) => setAddr("billing", { state: e.target.value })} aria-label="State">
                <option value="">State</option>
                {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </Select>
            ) : (
              <Input value={c.billing.state} onChange={(e) => setAddr("billing", { state: e.target.value })} placeholder="State / region" aria-label="State" />
            )}
            <Input value={c.billing.postalCode} onChange={(e) => setAddr("billing", { postalCode: e.target.value })} placeholder="PIN / ZIP" aria-label="Postal code" />
          </div>
        </Labeled>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <label className="flex items-center gap-2">
          <Switch checked={!!c.shipping} onChange={(v) => setC({ shipping: v ? { ...c.billing } : null })} label="Ship to a different address" />
          Ship to a different address
        </label>
        {!doc.clientId && c.name && (
          <label className="flex items-center gap-2">
            <Switch checked={saveClient} onChange={setSaveClient} label="Save to clients" />
            Save to my clients
          </label>
        )}
        {doc.clientId && (
          <button type="button" onClick={() => set({ clientId: null })} className="text-[12px] text-muted hover:text-fg">
            Saved client · use as a one-off instead
          </button>
        )}
      </div>
      {c.shipping && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Input value={c.shipping.line1} onChange={(e) => setAddr("shipping", { line1: e.target.value })} placeholder="Ship to: street" className="col-span-2 sm:col-span-4" aria-label="Shipping street" />
          <Input value={c.shipping.line2} onChange={(e) => setAddr("shipping", { line2: e.target.value })} placeholder="Area" aria-label="Shipping area" />
          <Input value={c.shipping.city} onChange={(e) => setAddr("shipping", { city: e.target.value })} placeholder="City" aria-label="Shipping city" />
          <Input value={c.shipping.state} onChange={(e) => setAddr("shipping", { state: e.target.value })} placeholder="State" aria-label="Shipping state" />
          <Input value={c.shipping.postalCode} onChange={(e) => setAddr("shipping", { postalCode: e.target.value })} placeholder="PIN / ZIP" aria-label="Shipping postal code" />
        </div>
      )}
    </section>
  );
}

type Suggestion = { key: string; name: string; description: string; hsn: string; unit: string; rate: number; taxBps: number; itemId: string | null; source: string };

function LinesSection({ doc, set, totals, projectId, showErrors }: { doc: Draft; set: (p: Partial<Draft>) => void; totals: ReturnType<typeof computeDocTotals>; projectId: string; showErrors: boolean }) {
  const { boot, apiBase } = useInv();
  const toast = useToast();
  const qc = useQueryClient();
  const items = useInvQuery<{ items: Item[] }>("items");
  // Store products, when these are a project's books with a store this person can see.
  const store = useQuery({ queryKey: ["store", projectId, "pos"], queryFn: () => api<{ products: { title: string; taxBps: number; variants: { id: string; title: string; price: number; sku: string }[] }[] }>(`/api/v1/projects/${projectId}/store/pos`), retry: false, enabled: boot.scope.kind === "project" });
  const suggestions: Suggestion[] = useMemo(
    () => [
      ...(items.data?.items ?? []).map((i) => ({ key: i.id, name: i.name, description: i.description, hsn: i.hsn, unit: i.unit, rate: i.rate, taxBps: i.taxBps, itemId: i.id, source: "Saved item" })),
      ...(store.data?.products ?? []).flatMap((p) => p.variants.map((v) => ({ key: v.id, name: v.title === "Default" ? p.title : `${p.title} — ${v.title}`, description: "", hsn: "", unit: "pcs", rate: v.price, taxBps: p.taxBps, itemId: null, source: "Store product" }))),
    ],
    [items.data, store.data],
  );
  const gst = doc.taxMode === "gst";
  const showTax = doc.taxMode !== "none";
  const setLine = (i: number, patch: Partial<Line>) => set({ lines: doc.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...doc.lines];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    set({ lines: next });
  };
  const saveItem = useMutation({
    mutationFn: (l: Line) => api<{ item: Item }>(invApi(apiBase, "items"), { method: "POST", body: { name: l.name, description: l.description, hsn: l.hsn, unit: l.unit, rate: l.rate, taxBps: l.taxBps } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["invoicing", projectId, "items"] });
      toast({ tone: "success", title: `Saved “${r.item.name}”`, description: "Pick it next time by typing its name." });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save the item", description: errorMessage(e) }),
  });
  return (
    <section className="glass-card rounded-[var(--radius-xl)] p-4">
      <h2 className="mb-3 text-[13px] font-semibold">Items</h2>
      <div className="grid gap-3">
        {doc.lines.map((l, i) => (
          <LineRow
            key={l.id}
            line={l}
            index={i}
            count={doc.lines.length}
            currency={doc.currency}
            gst={gst}
            showTax={showTax}
            amount={doc.inclusive ? totals.lines[i]?.amount : totals.lines[i]?.taxable}
            suggestions={suggestions}
            onChange={(p) => setLine(i, p)}
            onRemove={() => set({ lines: doc.lines.filter((_, j) => j !== i) })}
            onMove={(d) => move(i, d)}
            onSave={() => saveItem.mutate(l)}
            showErrors={showErrors}
          />
        ))}
      </div>
      <button type="button" onClick={() => set({ lines: [...doc.lines, blankLine(doc.taxMode === "none" ? 0 : boot.settings.defaultTaxBps)] })} className="mt-3 inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2">
        <Plus className="size-3.5" /> Add line
      </button>
    </section>
  );
}

function LineRow({ line: l, index, count, currency, gst, showTax, amount, suggestions, onChange, onRemove, onMove, onSave, showErrors }: { line: Line; index: number; count: number; currency: string; gst: boolean; showTax: boolean; amount: number | undefined; suggestions: Suggestion[]; onChange: (p: Partial<Line>) => void; onRemove: () => void; onMove: (d: -1 | 1) => void; onSave: () => void; showErrors: boolean }) {
  const [focus, setFocus] = useState(false);
  const [desc, setDesc] = useState(!!l.description);
  const ref = useRef<HTMLDivElement>(null);
  const q = l.name.trim().toLowerCase();
  const matches = focus && q ? suggestions.filter((s) => s.name.toLowerCase().includes(q) && s.name.toLowerCase() !== q).slice(0, 6) : [];
  const customRate = !GST_RATES.includes(l.taxBps);
  return (
    <div ref={ref} className="rounded-[14px] border border-border bg-bg/50 p-3">
      <div className="grid gap-2">
        <div className="relative">
          <Input value={l.name} onChange={(e) => onChange({ name: e.target.value, itemId: null })} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder={`Item ${index + 1} — type to search saved items`} aria-label={`Item ${index + 1} name`} aria-invalid={showErrors && !l.name.trim()} />
          {matches.length > 0 && (
            <ul className="glass-strong absolute right-0 left-0 z-20 mt-1 rounded-[12px] p-1 shadow-lg">
              {matches.map((s) => (
                <li key={s.key}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ name: s.name, description: s.description, hsn: s.hsn, unit: s.unit, rate: s.rate, taxBps: s.taxBps, itemId: s.itemId }); setDesc(!!s.description); setFocus(false); }} className="flex w-full items-center justify-between gap-3 rounded-[9px] px-3 py-1.5 text-left text-[13px] hover:bg-surface-2">
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="shrink-0 text-[11px] text-muted">{money(s.rate, currency)} · {s.source}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[72px_80px_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[84px_96px_150px_minmax(0,1fr)]">
        <Input inputMode="decimal" value={String(l.quantity)} onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, "")); if (Number.isFinite(v)) onChange({ quantity: Math.min(1_000_000, Math.round(v * 1000) / 1000) }); }} aria-label={`Item ${index + 1} quantity`} className="text-right tabular-nums" />
        <Input value={l.unit} onChange={(e) => onChange({ unit: e.target.value.slice(0, 20) })} placeholder="unit" aria-label={`Item ${index + 1} unit`} />
        <MoneyInput value={l.rate} onChange={(v) => onChange({ rate: v ?? 0 })} currency={currency} placeholder="Rate" aria-label={`Item ${index + 1} rate`} />
        <p className="flex items-center justify-end text-[13px] font-semibold tabular-nums">{money(amount ?? lineGross(l), currency)}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        {gst && <span className="w-24"><Input value={l.hsn} onChange={(e) => onChange({ hsn: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="HSN/SAC" aria-label={`Item ${index + 1} HSN or SAC code`} className="!h-7 font-mono text-[12px]" aria-invalid={!!l.hsn && ![4, 6, 8].includes(l.hsn.length)} /></span>}
        {showTax && (
          <span className="flex items-center gap-1">
            <span className="text-muted">{gst ? "GST" : "Tax"}</span>
            <Select value={customRate ? "custom" : String(l.taxBps)} onChange={(e) => onChange({ taxBps: e.target.value === "custom" ? l.taxBps : Number(e.target.value) })} className="!h-7 !w-auto text-[12px]" aria-label="Tax rate">
              {GST_RATES.map((r) => <option key={r} value={r}>{pctLabel(r)}</option>)}
              <option value="custom">Other…</option>
            </Select>
            {customRate && <span className="w-16"><Input inputMode="decimal" value={String(l.taxBps / 100)} onChange={(e) => onChange({ taxBps: Math.round(Math.min(100, Number(e.target.value) || 0) * 100) })} className="!h-7 text-[12px]" aria-label="Tax %" /></span>}
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="text-muted">Discount</span>
          <span className="w-16"><Input inputMode="decimal" value={l.discount ? String(l.discount.kind === "percent" ? l.discount.value : l.discount.value / 100) : ""} onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, "")); onChange({ discount: v > 0 ? { kind: l.discount?.kind ?? "percent", value: (l.discount?.kind ?? "percent") === "percent" ? Math.min(100, v) : Math.round(v * 100) } : null }); }} placeholder="0" className="!h-7 text-[12px]" aria-label="Line discount" /></span>
          <Select value={l.discount?.kind ?? "percent"} onChange={(e) => l.discount && onChange({ discount: { kind: e.target.value as "percent" | "amount", value: 0 } })} className="!h-7 !w-auto text-[12px]" aria-label="Discount type">
            <option value="percent">%</option>
            <option value="amount">{currency}</option>
          </Select>
        </span>
        {!desc && (
          <button type="button" onClick={() => setDesc(true)} className="text-accent">+ Description</button>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          {l.name && !l.itemId && <button type="button" onClick={onSave} title="Save as a reusable item" aria-label="Save as a reusable item" className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><BookmarkPlus className="size-3.5" /></button>}
          {index > 0 && <button type="button" onClick={() => onMove(-1)} aria-label="Move up" className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><ArrowUp className="size-3.5" /></button>}
          {index < count - 1 && <button type="button" onClick={() => onMove(1)} aria-label="Move down" className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><ArrowDown className="size-3.5" /></button>}
          {count > 1 && <button type="button" onClick={onRemove} aria-label="Remove line" className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-danger"><Trash2 className="size-3.5" /></button>}
        </span>
      </div>
      {desc && <Textarea rows={2} value={l.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Details shown under the item" className="mt-2 text-[13px]" aria-label="Description" />}
    </div>
  );
}

function TotalsSection({ doc, set, totals, intraState }: { doc: Draft; set: (p: Partial<Draft>) => void; totals: ReturnType<typeof computeDocTotals>; intraState: boolean }) {
  const { boot } = useInv();
  const adj = doc.adjustments;
  const setAdj = (p: Partial<Adjustments>) => set({ adjustments: { ...adj, ...p } });
  const m = (n: number) => money(n, doc.currency);
  return (
    <section className="glass-card grid gap-4 rounded-[var(--radius-xl)] p-4 md:grid-cols-[1fr_300px]">
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <Labeled label="Tax">
            <Select value={doc.taxMode} onChange={(e) => set({ taxMode: e.target.value as Draft["taxMode"] })} className="!h-8 !w-auto text-[13px]">
              <option value="gst">GST (India)</option>
              <option value="simple">{boot.settings.taxLabel || "Tax"} (VAT / sales tax)</option>
              <option value="none">No tax</option>
            </Select>
          </Labeled>
          {doc.taxMode !== "none" && (
            <label className="flex items-center gap-2 pt-4">
              <Switch checked={doc.inclusive} onChange={(v) => set({ inclusive: v })} label="Prices include tax" />
              Prices include tax
            </label>
          )}
          <label className="flex items-center gap-2 pt-4">
            <Switch checked={adj.roundOff} onChange={(v) => setAdj({ roundOff: v })} label="Round off the total" />
            Round off
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">Discount on the whole {DOC_LABEL[doc.type].toLowerCase()}</span>
          <span className="w-20"><Input inputMode="decimal" value={adj.discount ? String(adj.discount.kind === "percent" ? adj.discount.value : adj.discount.value / 100) : ""} onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, "")); const kind = adj.discount?.kind ?? "percent"; setAdj({ discount: v > 0 ? { kind, value: kind === "percent" ? Math.min(100, v) : Math.round(v * 100) } : null }); }} placeholder="0" className="!h-8" aria-label="Document discount" /></span>
          <Select value={adj.discount?.kind ?? "percent"} onChange={(e) => adj.discount && setAdj({ discount: { kind: e.target.value as "percent" | "amount", value: 0 } })} className="!h-8 !w-auto" aria-label="Document discount type">
            <option value="percent">%</option>
            <option value="amount">{doc.currency}</option>
          </Select>
        </div>
        <div className="grid gap-2">
          {adj.charges.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-40"><Input value={c.label} onChange={(e) => setAdj({ charges: adj.charges.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Shipping, packing…" className="!h-8" aria-label="Charge name" /></span>
              <div className="w-32"><MoneyInput value={c.amount} onChange={(v) => setAdj({ charges: adj.charges.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)) })} currency={doc.currency} aria-label="Charge amount" /></div>
              {doc.taxMode !== "none" && (
                <Select value={String(c.taxBps)} onChange={(e) => setAdj({ charges: adj.charges.map((x, j) => (j === i ? { ...x, taxBps: Number(e.target.value) } : x)) })} className="!h-8 !w-auto" aria-label="Charge tax">
                  {GST_RATES.map((r) => <option key={r} value={r}>{pctLabel(r)}</option>)}
                </Select>
              )}
              <Button size="sm" variant="ghost" aria-label="Remove charge" icon={<X className="size-3.5" />} onClick={() => setAdj({ charges: adj.charges.filter((_, j) => j !== i) })} />
            </div>
          ))}
          {adj.charges.length < 6 && (
            <button type="button" onClick={() => setAdj({ charges: [...adj.charges, { label: "Shipping", amount: 0, taxBps: doc.taxMode === "none" ? 0 : boot.settings.defaultTaxBps }] })} className="inline-flex w-fit items-center gap-1 text-[13px] text-accent">
              <Plus className="size-3.5" /> Add a charge (shipping, packing, installation…)
            </button>
          )}
        </div>
      </div>
      <dl className="grid content-start gap-1 rounded-[14px] bg-surface-2/60 p-4 text-[13px]">
        <Row k="Subtotal" v={m(totals.subtotal)} />
        {totals.discount > 0 && <Row k="Discounts" v={`− ${m(totals.discount)}`} />}
        {adj.charges.map((c, i) => <Row key={i} k={c.label || "Charge"} v={m(c.amount)} />)}
        {totals.taxes.map((t) => <Row key={t.label} k={`${t.label}${doc.inclusive ? " (incl.)" : ""}`} v={m(t.amount)} />)}
        {totals.roundOff !== 0 && <Row k="Round off" v={`${totals.roundOff > 0 ? "+" : "−"} ${m(Math.abs(totals.roundOff))}`} />}
        <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2 text-[18px] font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(totals.total)}</dd></div>
        {doc.taxMode === "gst" && totals.tax > 0 && <p className="text-[11px] text-muted">{intraState ? "Same state as you: split into CGST and SGST." : "Different state: charged as IGST."}</p>}
      </dl>
    </section>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>
);

function RecurringSection({ doc, set, today }: { doc: Draft; set: (p: Partial<Draft>) => void; today: string }) {
  const r = doc.recurring;
  return (
    <section className="glass-card rounded-[var(--radius-xl)] p-4">
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Repeat className="size-4" /> Repeat this invoice
          <span className="font-normal text-muted">— retainers, rent, subscriptions</span>
        </span>
        <Switch checked={!!r} onChange={(v) => set({ recurring: v ? { every: "month", nextRun: addDays(doc.issueDate, 30) > today ? addDays(doc.issueDate, 30) : today, endsOn: null, autoSend: true } : null })} label="Repeat this invoice" />
      </label>
      {r && (
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Labeled label="Every">
            <Select value={r.every} onChange={(e) => set({ recurring: { ...r, every: e.target.value as typeof r.every } })}>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </Select>
          </Labeled>
          <Labeled label="Next invoice on">
            <Input type="date" value={r.nextRun} min={today} onChange={(e) => set({ recurring: { ...r, nextRun: e.target.value } })} />
          </Labeled>
          <Labeled label="Stop after" hint="Leave empty to keep going">
            <Input type="date" value={r.endsOn ?? ""} onChange={(e) => set({ recurring: { ...r, endsOn: e.target.value || null } })} />
          </Labeled>
          <label className="flex items-center gap-2 pt-5 text-[13px]">
            <Switch checked={r.autoSend} onChange={(v) => set({ recurring: { ...r, autoSend: v } })} label="Email it automatically" />
            Email it automatically
          </label>
          <p className="text-[12px] text-muted sm:col-span-4">Each copy is issued with the next number in your series{r.autoSend ? " and emailed to the client" : ""}. The schedule runs on the server, hourly.</p>
        </div>
      )}
    </section>
  );
}
