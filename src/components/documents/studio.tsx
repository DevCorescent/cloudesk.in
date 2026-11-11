"use client";

// The AI document studio (/documents/studio): describe a document in a
// sentence — or pick one of ~95 kinds — answer the few questions the AI still
// needs, and get a finished, reviewed document: its clauses checked against
// the standard, the laws behind it, stamp duty and signing guidance, and the
// blanks left to fill. It's saved in Documents to edit, download, share in
// Chat, email or send for signature, and the AI revises it on request.
// One thing on screen at a time: describe, then details, then the result.
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, Download, FileSignature, FileText, IndianRupee, Landmark, Loader2, Mail, Megaphone, PenLine, Scale, Search, Sparkles, Stamp, Users, Wand2, Workflow, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { useModule } from "@/components/shell/module-frame";
import { Menu, useToast } from "@/components/ui/overlays";
import { Button, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { CATEGORIES, DOC_KINDS, kindById, OPTIONS, type CategoryId, type DocKind, type Question, type Review, type StudioOptions } from "@/lib/documents/studio";
import type { DocsMeta } from "./drive/drive-app";

const CAT_ICON: Record<CategoryId, LucideIcon> = { legal: Scale, people: Users, sales: IndianRupee, corporate: Landmark, operations: Workflow, letters: Mail, marketing: Megaphone };
const catOf = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)!;
const QUICK = ["nda-mutual", "service-agreement", "offer-letter", "appointment", "quotation", "demand-notice", "board-resolution", "lease"];

export type Plan = { kind: string; title: string; summary: string; questions: Question[]; answers: Record<string, string>; business: { name: string; state: string } };
export type Made = { file: { id: string; title: string }; kind: string; review: Review };
type Step = { at: "start" } | { at: "ask"; plan: Plan } | { at: "making"; plan: Plan } | { at: "done"; plan: Plan; made: Made };
const STEPS = ["Describe", "Details", "Drafting", "Review"] as const;
const AT = { start: 0, ask: 1, making: 2, done: 3 } as const;

export function StudioPage() {
  const { orgId, meta } = useModule<DocsMeta>();
  const base = `/api/v1/orgs/${orgId}/documents`;
  const [step, setStep] = useState<Step>({ at: "start" });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const top = useRef<HTMLDivElement>(null);
  // Each step opens at the top of the page.
  useEffect(() => top.current?.scrollIntoView({ block: "start" }), [step.at]);

  const start = async (kindId?: string) => {
    if (!kindId && prompt.trim().length < 6) return setError("Describe the document first.");
    setBusy(kindId ?? "prompt");
    setError("");
    try {
      const plan = await api<Plan>(`${base}/studio/plan`, { method: "POST", body: { prompt: prompt.trim(), ...(kindId ? { kindId } : {}) } });
      setStep({ at: "ask", plan });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!meta.me.write) return <Notice tone="accent" title="Drafting needs edit access">Ask an admin if you need it.</Notice>;
  const at = AT[step.at];
  return (
    <div ref={top} className="mx-auto grid w-full max-w-[880px] scroll-mt-24 gap-6">
      <div className="grid gap-2" aria-label={`Step ${at + 1} of 4: ${STEPS[at]}`}>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => <span key={s} className={cx("h-[3px] flex-1 rounded-full transition-colors duration-500", i <= at ? "bg-fg" : "bg-fg/10")} />)}
        </div>
        <p className="text-[11.5px] font-medium tracking-[0.08em] text-subtle uppercase">{STEPS[at]} <span className="text-fg/25">·</span> {at + 1}/4</p>
      </div>
      {step.at === "ask" || step.at === "making" ? (
        <Ask plan={step.plan} prompt={prompt} base={base} onBack={() => setStep({ at: "start" })} onMaking={() => setStep({ at: "making", plan: step.plan })} onMade={(made) => setStep({ at: "done", plan: step.plan, made })} onFailed={() => setStep({ at: "ask", plan: step.plan })} />
      ) : step.at === "done" ? (
        <Done made={step.made} base={base} onAnother={() => (setPrompt(""), setStep({ at: "start" }))} />
      ) : (
        <Start prompt={prompt} setPrompt={setPrompt} busy={busy} error={error} onStart={start} />
      )}
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex rounded-[10px] bg-fg/[0.05] p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={cx("h-8 rounded-[8px] px-3.5 text-[13px] font-medium transition-colors", value === o.value ? "bg-[var(--surface-solid)] text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── 1. Describe, or browse the library ──────────────────────────────────────

function Start({ prompt, setPrompt, busy, error, onStart }: { prompt: string; setPrompt: (v: string) => void; busy: string | null; error: string; onStart: (kindId?: string) => void }) {
  const [mode, setMode] = useState<"describe" | "library">("describe");
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">New document</h1>
        <Seg value={mode} onChange={setMode} options={[{ value: "describe", label: "Describe" }, { value: "library", label: "Library" }]} />
      </div>
      {mode === "describe" ? (
        <div className="grid gap-4">
          <form
            className="overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)] transition-[border-color,box-shadow] focus-within:border-fg/30 focus-within:shadow-[0_0_0_4px_rgb(0_0_0/0.04)]"
            onSubmit={(e) => {
              e.preventDefault();
              onStart();
            }}
          >
            <Textarea
              aria-label="Describe the document"
              rows={4}
              value={prompt}
              maxLength={4000}
              autoFocus
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Mutual NDA with Infosys Limited for 2 years, courts in Mumbai…"
              className="!min-h-[120px] resize-none !rounded-none border-0 bg-transparent px-4 pt-4 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
              style={{ outline: "none" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onStart();
                }
              }}
            />
            <div className="flex items-center justify-end gap-3 px-3 pb-3">
              {error && <p role="alert" className="mr-auto pl-1 text-[12.5px] text-danger">{error}</p>}
              <Button type="submit" variant="primary" loading={busy === "prompt"} disabled={!prompt.trim()} icon={<Wand2 className="size-4" />}>Continue</Button>
            </div>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((id) => kindById(id)).filter((k): k is DocKind => !!k).map((k) => (
              <button key={k.id} type="button" disabled={!!busy} onClick={() => onStart(k.id)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] text-fg/75 transition-colors hover:border-fg/25 hover:text-fg disabled:opacity-50">
                {busy === k.id && <Loader2 className="size-3.5 animate-spin" />}
                {k.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Library busy={busy} onPick={(id) => onStart(id)} />
      )}
    </div>
  );
}

/** The catalogue to choose from; `compact` (inside a chat) keeps it short and scrolling. */
export function Library({ busy, onPick, compact }: { busy: string | null; onPick: (id: string) => void; compact?: boolean }) {
  const [cat, setCat] = useState<CategoryId>("legal");
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return DOC_KINDS.filter((k) => (words.length ? true : k.category === cat) && words.every((w) => `${k.name} ${k.line} ${k.keywords ?? ""}`.toLowerCase().includes(w)));
  }, [cat, q]);
  return (
    <div className="grid gap-3">
      <label className="flex h-10 items-center gap-2 rounded-[12px] border border-border bg-[var(--surface-solid)] px-3 text-muted transition-colors focus-within:border-fg/30">
        <Search className="size-4 shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${DOC_KINDS.length} documents`} aria-label="Search documents" className="min-w-0 flex-1 bg-transparent text-[14px] text-fg placeholder:text-subtle" style={{ outline: "none" }} />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-subtle hover:text-fg"><X className="size-4" /></button>}
      </label>
      {!q && (
        <div className={cx("flex gap-1 overflow-x-auto [scrollbar-width:none]", compact ? "" : "-mx-4 px-4 sm:mx-0 sm:flex-wrap sm:px-0")}>
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)} className={cx("h-8 shrink-0 rounded-full px-3 text-[12.5px] whitespace-nowrap transition-colors", cat === c.id ? "bg-fg font-medium text-bg" : "text-muted hover:bg-fg/[0.05] hover:text-fg")}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {list.length ? (
        <ul className={cx("divide-y divide-border rounded-[14px] border border-border bg-[var(--surface-solid)]", compact ? "max-h-[320px] overflow-y-auto overscroll-contain" : "overflow-hidden")}>
          {list.map((k) => {
            const c = catOf(k.category);
            const Icon = CAT_ICON[c.id];
            return (
              <li key={k.id}>
                <button type="button" disabled={!!busy} onClick={() => onPick(k.id)} className="group flex w-full min-w-0 items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-fg/[0.03] disabled:opacity-60">
                  {busy === k.id ? <Loader2 className="size-4 shrink-0 animate-spin text-subtle" /> : <Icon className="size-4 shrink-0 text-subtle" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{k.name}</span>
                    <span className="block truncate text-[12px] text-muted">{k.line}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-10 text-center text-[13px] text-muted">No match. Describe it instead.</p>
      )}
    </div>
  );
}

// ── 2. Details ──────────────────────────────────────────────────────────────

/** The details step; `compact` (inside a chat) drops the page heading and keeps the Draft bar in place. */
export function Ask({ plan, prompt, base, onBack, onMaking, onMade, onFailed, compact, backLabel = "Back" }: { plan: Plan; prompt: string; base: string; onBack: () => void; onMaking: () => void; onMade: (m: Made) => void; onFailed: () => void; compact?: boolean; backLabel?: string }) {
  const kind = kindById(plan.kind)!;
  const [answers, setAnswers] = useState<Record<string, string>>(plan.answers);
  const [title, setTitle] = useState(plan.title);
  const [opts, setOpts] = useState<StudioOptions>({ language: "English", tone: kind.category === "letters" ? "Friendly professional" : "Formal", detail: "Standard", favour: "Favour us", state: plan.business.state });
  const [root, setRoot] = useState<"mine" | "team">("mine");
  const [error, setError] = useState("");
  const filled = plan.questions.filter((x) => answers[x.key]?.trim()).length;
  // Drafting shows here, so a failed draft comes back to the answers as they were.
  const [drafting, setDrafting] = useState(false);
  const make = async () => {
    setError("");
    setDrafting(true);
    onMaking();
    try {
      onMade(await api<Made>(`${base}/studio/generate`, { method: "POST", body: { kindId: kind.id, prompt, answers, options: opts, title, root } }));
    } catch (e) {
      onFailed();
      setError(errorMessage(e));
    } finally {
      setDrafting(false);
    }
  };
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  if (drafting) return <Making plan={{ ...plan, title }} compact={compact} />;
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label={backLabel} title={backLabel} className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-fg/[0.05] hover:text-fg"><ArrowLeft className="size-4" /></button>
        <div className="min-w-0">
          {compact ? <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">{kind.name}</p> : <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{kind.name}</h1>}
        </div>
      </div>

      <section className="grid gap-4 rounded-[16px] border border-border bg-[var(--surface-solid)] p-4 sm:p-5">
        <Field label="Title">{(a) => <Input {...a} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          {plan.questions.map((x) => (
            <div key={x.key} className={x.type === "long" ? "sm:col-span-2" : undefined}>
              <Field label={`${x.label}${x.required ? " *" : ""}`}>
                {(a) =>
                  x.type === "long" ? (
                    <Textarea {...a} rows={2} value={answers[x.key] ?? ""} placeholder={x.placeholder} onChange={(e) => set(x.key, e.target.value)} />
                  ) : x.type === "select" && x.options?.length ? (
                    <Select {...a} value={answers[x.key] ?? ""} onChange={(e) => set(x.key, e.target.value)}>
                      <option value="">Choose…</option>
                      {x.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input {...a} type={x.type === "date" ? "date" : x.type === "email" ? "email" : "text"} inputMode={x.type === "money" || x.type === "number" ? "decimal" : undefined} value={answers[x.key] ?? ""} placeholder={x.placeholder ?? (x.type === "money" ? "₹" : undefined)} onChange={(e) => set(x.key, e.target.value)} />
                  )
                }
              </Field>
            </div>
          ))}
        </div>
      </section>

      <details className="group rounded-[16px] border border-border bg-[var(--surface-solid)]">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="text-[13.5px] font-medium">Options</span>
          <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted">{opts.language} · {opts.tone} · {opts.detail}{kind.form === "contract" ? ` · ${opts.favour}` : ""}</span>
          <ChevronDown className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border p-4 sm:grid-cols-3 sm:p-5">
          <Opt label="Language" value={opts.language} options={OPTIONS.language} onChange={(v) => setOpts({ ...opts, language: v as StudioOptions["language"] })} />
          <Opt label="Tone" value={opts.tone} options={OPTIONS.tone} onChange={(v) => setOpts({ ...opts, tone: v as StudioOptions["tone"] })} />
          <Opt label="Length" value={opts.detail} options={OPTIONS.detail} onChange={(v) => setOpts({ ...opts, detail: v as StudioOptions["detail"] })} />
          {kind.form === "contract" && <Opt label="Terms favour" value={opts.favour} options={OPTIONS.favour} onChange={(v) => setOpts({ ...opts, favour: v as StudioOptions["favour"] })} />}
          <Field label="State">{(a) => <Input {...a} value={opts.state} maxLength={60} placeholder="Maharashtra" onChange={(e) => setOpts({ ...opts, state: e.target.value })} />}</Field>
          <Opt label="Save to" value={root === "mine" ? "My documents" : "Team documents"} options={["My documents", "Team documents"]} onChange={(v) => setRoot(v === "Team documents" ? "team" : "mine")} />
        </div>
      </details>

      {error && <Notice tone="danger" title="Couldn't draft it">{error}</Notice>}

      <div className={compact ? undefined : "sticky bottom-[calc(var(--dock,0px)+12px)] z-10"}>
        <div className="flex items-center gap-3 rounded-[14px] border border-border bg-[var(--surface-solid)]/95 p-2 pl-4 shadow-[0_10px_30px_-14px_rgb(0_0_0/0.3)] backdrop-blur">
          <span className="min-w-0 flex-1 text-[12.5px] text-muted tabular-nums">{filled}/{plan.questions.length} filled</span>
          <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={() => void make()}>Draft</Button>
        </div>
      </div>
    </div>
  );
}

function Opt({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      {(a) => (
        <Select {...a} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      )}
    </Field>
  );
}

// ── 3. Drafting ─────────────────────────────────────────────────────────────

const STAGES = ["Reading the details", "Drafting clauses", "Checking the law", "Laying it out", "Reviewing"];

export function Making({ plan, compact }: { plan: Plan; compact?: boolean }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAt((x) => Math.min(x + 1, STAGES.length - 1)), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cx("mx-auto grid w-full max-w-sm justify-items-center gap-5 text-center", compact ? "py-6" : "py-16")} role="status" aria-live="polite">
      <span className="grid size-12 place-items-center rounded-[14px] bg-fg text-bg"><FileText className="size-5" /></span>
      <div className="grid gap-1">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-balance">{plan.title}</h1>
        <p className="flex items-center justify-center gap-1.5 text-[13px] text-muted"><Loader2 className="size-3.5 animate-spin" /> {STAGES[at]}…</p>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-fg/10"><div className="h-full rounded-full bg-fg transition-[width] duration-[6000ms] ease-linear" style={{ width: `${Math.min(92, ((at + 1) / STAGES.length) * 100)}%` }} /></div>
    </div>
  );
}

// ── 4. Result ───────────────────────────────────────────────────────────────

const REFINES = ["Stricter in our favour", "Add non-solicitation", "Shorter", "Simpler language", "In Hindi", "Add payment schedule"];
type Pane = "doc" | "checks" | "guide" | "revise";

/** The finished document: actions, then one view at a time. `compact` sizes it for a chat; `onAnother` shows a back arrow. */
export function Done({ made, base, onAnother, compact }: { made: Made; base: string; onAnother?: () => void; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [html, setHtml] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [ask, setAsk] = useState("");
  const [refining, setRefining] = useState(false);
  const [signing, setSigning] = useState(false);
  const [changes, setChanges] = useState<string[]>([]);
  const [pane, setPane] = useState<Pane>("doc");
  const id = made.file.id;
  const exportUrl = (format: "pdf" | "docx" | "html") => `${base}/docs/${id}/export?format=${format}`;
  useEffect(() => {
    let live = true;
    fetch(exportUrl("html"), { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("preview"))))
      .then((t) => live && setHtml(t))
      .catch(() => live && setHtml(""));
    return () => {
      live = false;
    };
    // The preview reloads after each revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rev]);
  const refine = async (instruction: string) => {
    if (instruction.trim().length < 3) return;
    setRefining(true);
    try {
      const r = await api<{ changes: string[] }>(`${base}/docs/${id}/refine`, { method: "POST", body: { instruction } });
      setChanges(r.changes);
      setAsk("");
      setHtml(null);
      setRev((x) => x + 1);
      setPane("doc");
      toast({ tone: "success", title: "Revised" });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    } finally {
      setRefining(false);
    }
  };
  const sign = async () => {
    setSigning(true);
    try {
      const r = await api<{ fileId: string }>(`${base}/docs/${id}/pdf`, { method: "POST", body: {} });
      router.push(`/documents/file/${r.fileId}?sign=1`);
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      setSigning(false);
    }
  };
  const r = made.review;
  const covered = r.clauses.filter((c) => c.included).length;
  const score = r.clauses.length ? Math.round((covered / r.clauses.length) * 100) : null;
  const kind = kindById(made.kind);
  const fileName = `${made.file.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Document"}.pdf`;
  const signable = !!kind && ["contract", "form", "letter", "notice"].includes(kind.form);
  const attention = r.fill.length + r.warnings.length;
  const btn = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-[var(--surface-solid)] px-3 text-[13px] font-medium transition-colors hover:bg-fg/[0.04]";
  const TABS: { id: Pane; label: string; badge?: number }[] = [
    { id: "doc", label: "Document" },
    { id: "checks", label: score === null ? "Checks" : `Checks · ${score}%` },
    { id: "guide", label: "Guidance", badge: attention || undefined },
    { id: "revise", label: "Revise" },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        {onAnother && <button type="button" onClick={onAnother} aria-label="New document" title="New document" className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-fg/[0.05] hover:text-fg"><ArrowLeft className="size-4" /></button>}
        {compact ? <p className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{made.file.title}</p> : <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-[-0.02em]">{made.file.title}</h1>}
        <span className="hidden shrink-0 items-center gap-1 text-[12px] text-muted sm:inline-flex"><Check className="size-3.5 text-emerald-600" /> Saved</span>
      </div>

      <div className={cx("flex items-center gap-2 overflow-x-auto [scrollbar-width:none]", compact ? "flex-wrap" : "-mx-4 px-4 sm:mx-0 sm:px-0")}>
        <Link href={`/documents/d/${id}`} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-fg px-3.5 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90"><PenLine className="size-4" /> Edit</Link>
        <Menu
          label="Download"
          align="start"
          trigger={(p) => <button {...p} type="button" className={btn}><Download className="size-4" /> Download <ChevronDown className="size-3.5 text-subtle" /></button>}
          items={[
            { label: "PDF", icon: <FileText />, onSelect: () => window.location.assign(exportUrl("pdf")) },
            { label: "Word (.docx)", icon: <FileText />, onSelect: () => window.location.assign(exportUrl("docx")) },
          ]}
        />
        <span className="shrink-0"><ShareToChatButton card={{ kind: "document", id, title: made.file.title, sub: kind?.name, link: `/documents/d/${id}`, module: "Documents" }} /></span>
        <span className="shrink-0"><EmailButton subject={made.file.title} body={`Please find attached the ${kind?.name.toLowerCase() ?? "document"}.`} attachments={[{ url: exportUrl("pdf"), filename: fileName }]} title={made.file.title} /></span>
        {signable && <button type="button" disabled={signing} onClick={() => void sign()} className={cx(btn, "disabled:opacity-60")}>{signing ? <Loader2 className="size-4 animate-spin" /> : <FileSignature className="size-4" />} Sign</button>}
      </div>

      <div role="tablist" aria-label="Views" className={cx("flex overflow-x-auto border-b border-border [scrollbar-width:none]", !compact && "-mx-4 px-4 sm:mx-0 sm:px-0")}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={pane === t.id} onClick={() => setPane(t.id)} className={cx("relative inline-flex h-10 shrink-0 items-center gap-1.5 px-3 text-[13px] transition-colors first:pl-0 sm:first:pl-3", pane === t.id ? "font-semibold text-fg" : "text-muted hover:text-fg")}>
            {t.label}
            {t.badge ? <span className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-amber-500/15 px-1 text-[10.5px] font-semibold text-amber-700 tabular-nums dark:text-amber-300">{t.badge}</span> : null}
            {pane === t.id && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-fg first:inset-x-0" aria-hidden />}
          </button>
        ))}
      </div>

      {pane === "doc" && (
        <div className={cx("rounded-[16px] bg-fg/[0.035]", compact ? "p-2" : "p-2 sm:p-5")}>
          <div className="mx-auto max-w-[800px] overflow-hidden rounded-[4px] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.06),0_16px_40px_-24px_rgb(0_0_0/0.3)] ring-1 ring-black/5">
            {html === null ? (
              <div className="grid h-[65vh] place-items-center text-neutral-400"><Loader2 className="size-5 animate-spin" /></div>
            ) : html ? (
              <iframe title="Document preview" sandbox="" srcDoc={html} className={cx("block w-full bg-white", compact ? "h-[min(62vh,560px)]" : "h-[calc(100dvh-var(--bar,64px)-var(--dock,0px)-250px)] min-h-[420px]")} />
            ) : (
              <div className="grid h-60 place-items-center p-6 text-center text-[13px] text-neutral-500">Preview unavailable. Open the document to read it.</div>
            )}
          </div>
        </div>
      )}

      {pane === "checks" && (
        <div className="grid gap-4">
          {r.clauses.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-[var(--surface-solid)]">
              {r.clauses.map((c) => (
                <li key={c.name} className="flex items-start gap-2.5 px-3.5 py-2.5 text-[13px]">
                  {c.included ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                  <span className="min-w-0 flex-1">{c.name}</span>
                  {c.note && <span className="max-w-[40%] shrink-0 truncate text-right text-[12px] text-subtle max-sm:hidden">{c.note}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No fixed clause list for this document.</p>
          )}
          {r.laws.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {r.laws.map((l) => <span key={l} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] text-muted"><Scale className="size-3" /> {l}</span>)}
            </div>
          )}
        </div>
      )}

      {pane === "guide" && (
        <div className="grid gap-2.5">
          {r.fill.length > 0 && (
            <Row icon={<PenLine className="size-4 text-amber-600" />} title="To fill">
              <div className="flex flex-wrap gap-1">{r.fill.map((f) => <span key={f} className="rounded-[6px] bg-fg/[0.05] px-1.5 py-0.5 font-mono text-[11.5px]">{f}</span>)}</div>
            </Row>
          )}
          {r.warnings.length > 0 && (
            <Row icon={<AlertTriangle className="size-4 text-amber-600" />} title="Check">
              <ul className="grid list-disc gap-1 pl-4">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Row>
          )}
          {r.stamp && <Row icon={<Stamp className="size-4 text-subtle" />} title="Stamp duty">{r.stamp}</Row>}
          {r.signing && <Row icon={<FileSignature className="size-4 text-subtle" />} title="Signing">{r.signing}</Row>}
          <p className="pt-1 text-[11.5px] text-subtle">AI draft — have a lawyer or CA review before use.</p>
        </div>
      )}

      {pane === "revise" && (
        <div className="grid gap-3">
          <form className="overflow-hidden rounded-[14px] border border-border bg-[var(--surface-solid)] transition-colors focus-within:border-fg/30" onSubmit={(e) => { e.preventDefault(); void refine(ask); }}>
            <Textarea aria-label="What should change" rows={3} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Make the term 3 years with a 6-month lock-in…" className="resize-none !rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0" style={{ outline: "none" }} />
            <div className="flex justify-end px-2.5 pb-2.5">
              <Button type="submit" variant="primary" size="sm" loading={refining} disabled={ask.trim().length < 3} icon={<Sparkles className="size-3.5" />}>Revise</Button>
            </div>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {REFINES.map((x) => <button key={x} type="button" disabled={refining} onClick={() => void refine(x)} className="h-8 rounded-full border border-border px-3 text-[12.5px] text-fg/75 transition-colors hover:border-fg/25 hover:text-fg disabled:opacity-50">{x}</button>)}
          </div>
          {changes.length > 0 && <ul className="grid list-disc gap-0.5 pl-4 text-[12.5px] text-muted">{changes.map((c) => <li key={c}>{c}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

function Row({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 rounded-[14px] border border-border bg-[var(--surface-solid)] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
      <span className="pt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="mb-1 font-medium text-fg">{title}</p>
        {children}
      </div>
    </div>
  );
}
