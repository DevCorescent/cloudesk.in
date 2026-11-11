"use client";

// The AI document studio (/documents/studio): describe a document in a
// sentence — or pick one of ~90 kinds — answer the few questions the AI still
// needs, and get a finished, reviewed document: its clauses checked against
// the standard, the laws behind it, stamp duty and signing guidance, and the
// blanks left to fill. It's saved in Documents to edit, download, share in
// Chat, email or send for signature, and the AI revises it on request.
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpenCheck, Check, CircleDashed, Download, FileSignature, FileText, IndianRupee, Landmark, Loader2, Mail, Megaphone, PenLine, Scale, Search, Sparkles, Stamp, Users, Wand2, Workflow, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ShareToChatButton } from "@/components/chat/share";
import { EmailButton } from "@/components/mail/compose-provider";
import { useModule } from "@/components/shell/module-frame";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { CATEGORIES, DOC_KINDS, kindById, OPTIONS, type CategoryId, type Question, type Review, type StudioOptions } from "@/lib/documents/studio";
import type { DocsMeta } from "./drive/drive-app";

const CAT_ICON: Record<CategoryId, LucideIcon> = { legal: Scale, people: Users, sales: IndianRupee, corporate: Landmark, operations: Workflow, letters: Mail, marketing: Megaphone };
const EXAMPLES = [
  "Mutual NDA with Infosys Limited for 2 years, courts in Bengaluru",
  "Offer letter for Riya Sen as Senior Designer, ₹9,00,000 CTC, joining 1 December",
  "Legal notice to Sharma Traders for ₹2,40,000 unpaid since August",
  "Commercial lease for our Andheri office, ₹1,20,000 rent, 5 years with 3-year lock-in",
  "POSH policy for a 40-person company",
  "Board resolution to open a current account with HDFC Bank",
];

type Plan = { kind: string; title: string; summary: string; questions: Question[]; answers: Record<string, string>; business: { name: string; state: string } };
type Made = { file: { id: string; title: string }; kind: string; review: Review };
type Step = { at: "start" } | { at: "ask"; plan: Plan } | { at: "making"; plan: Plan } | { at: "done"; plan: Plan; made: Made };

export function StudioPage() {
  const { orgId, meta } = useModule<DocsMeta>();
  const base = `/api/v1/orgs/${orgId}/documents`;
  const [step, setStep] = useState<Step>({ at: "start" });
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async (kindId?: string) => {
    if (!kindId && prompt.trim().length < 6) return setError("Describe the document in a sentence, or pick one below.");
    setBusy(true);
    setError("");
    try {
      const plan = await api<Plan>(`${base}/studio/plan`, { method: "POST", body: { prompt: prompt.trim(), ...(kindId ? { kindId } : {}) } });
      setStep({ at: "ask", plan });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!meta.me.write) return <Notice tone="accent" title="Making documents needs edit access">Your role can read documents but not create them. Ask an admin if you need to.</Notice>;
  if (step.at === "ask") return <Ask plan={step.plan} prompt={prompt} base={base} onBack={() => setStep({ at: "start" })} onMaking={() => setStep({ at: "making", plan: step.plan })} onMade={(made) => setStep({ at: "done", plan: step.plan, made })} onFailed={() => setStep({ at: "ask", plan: step.plan })} />;
  if (step.at === "making") return <Making plan={step.plan} />;
  if (step.at === "done") return <Done made={step.made} plan={step.plan} base={base} onAnother={() => (setPrompt(""), setStep({ at: "start" }))} />;
  return <Start prompt={prompt} setPrompt={setPrompt} busy={busy} error={error} onStart={start} />;
}

// ── 1. Describe or pick ─────────────────────────────────────────────────────

function Start({ prompt, setPrompt, busy, error, onStart }: { prompt: string; setPrompt: (v: string) => void; busy: boolean; error: string; onStart: (kindId?: string) => void }) {
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const [q, setQ] = useState("");
  const kinds = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return DOC_KINDS.filter((k) => (cat === "all" || k.category === cat) && words.every((w) => `${k.name} ${k.line} ${k.keywords ?? ""}`.toLowerCase().includes(w)));
  }, [cat, q]);
  return (
    <div className="grid gap-6">
      <section className="studio-hero relative overflow-hidden rounded-[26px] border border-border p-5 sm:p-8">
        <div className="relative grid max-w-3xl gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--surface-solid)] px-3 py-1 text-[12px] font-semibold text-violet-700 shadow-sm ring-1 ring-violet-500/20 dark:text-violet-300"><Sparkles className="size-3.5" /> AI document studio</span>
          <h1 className="text-[26px] leading-[1.15] font-semibold tracking-[-0.03em] text-balance sm:text-[34px]">Any business document, drafted to a legal standard in minutes.</h1>
          <p className="max-w-2xl text-[14px] text-muted sm:text-[15px]">Describe it in a sentence. The AI asks only what it still needs, drafts it with the clauses and Indian laws it should carry, checks itself, and saves it ready to edit, sign or send.</p>
          <form
            className="grid gap-2 rounded-[20px] bg-[var(--surface-solid)] p-2 shadow-[0_12px_40px_-18px_rgb(0_0_0/0.35)] ring-1 ring-border"
            onSubmit={(e) => {
              e.preventDefault();
              onStart();
            }}
          >
            <Textarea aria-label="Describe the document" rows={3} value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A service agreement with Lumen Studio for monthly social media management at ₹60,000 a month, 1 year" className="!min-h-[84px] resize-none border-0 bg-transparent text-[15px] shadow-none focus-visible:ring-0" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onStart(); } }} />
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
              <span className="text-[12px] text-subtle">Names, amounts, dates and places help — anything missing, it&apos;ll ask.</span>
              <Button type="submit" variant="primary" loading={busy} icon={<Wand2 className="size-4" />}>Create document</Button>
            </div>
          </form>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => setPrompt(x)} className="rounded-full bg-[var(--surface-solid)]/80 px-3 py-1.5 text-left text-[12.5px] text-muted ring-1 ring-border transition-colors hover:text-fg hover:ring-fg/25">{x}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Or start from a document type</h2>
            <p className="text-[13px] text-muted">{DOC_KINDS.length} kinds across {CATEGORIES.length} categories, each with its required clauses and laws.</p>
          </div>
          <label className="flex h-10 w-full items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-muted sm:w-72">
            <Search className="size-4 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents" aria-label="Search document types" className="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-subtle" />
          </label>
        </div>
        <div role="tablist" aria-label="Categories" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          <CatChip on={cat === "all"} onClick={() => setCat("all")} label="All" count={DOC_KINDS.length} />
          {CATEGORIES.map((c) => {
            const Icon = CAT_ICON[c.id];
            return <CatChip key={c.id} on={cat === c.id} onClick={() => setCat(c.id)} label={c.name} icon={<Icon className="size-3.5" />} count={DOC_KINDS.filter((k) => k.category === c.id).length} />;
          })}
        </div>
        {kinds.length ? (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {kinds.map((k) => {
              const c = CATEGORIES.find((x) => x.id === k.category)!;
              const Icon = CAT_ICON[c.id];
              return (
                <li key={k.id} className="min-w-0">
                  <button type="button" disabled={busy} onClick={() => onStart(k.id)} className="group flex h-full w-full min-w-0 items-start gap-3 rounded-[18px] border border-border bg-surface p-3.5 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-fg/20 hover:shadow-[0_10px_30px_-16px_rgb(0_0_0/0.3)] disabled:opacity-60">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px]" style={{ background: `color-mix(in srgb, ${c.tone} 13%, transparent)`, color: c.tone }}><Icon className="size-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{k.name}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{k.line}</span>
                      {(k.clauses.length > 0 || k.laws.length > 0) && (
                        <span className="mt-2 flex flex-wrap gap-1 text-[11px] text-subtle">
                          {k.clauses.length > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5">{k.clauses.length} clauses</span>}
                          {k.laws.length > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5">{k.laws.length} laws</span>}
                        </span>
                      )}
                    </span>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-[18px] border border-dashed border-border p-8 text-center text-[13px] text-muted">Nothing called “{q}”. Describe it above instead — the AI handles documents beyond this list too.</p>
        )}
      </section>
    </div>
  );
}

function CatChip({ on, onClick, label, icon, count }: { on: boolean; onClick: () => void; label: string; icon?: React.ReactNode; count: number }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={cx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors", on ? "bg-fg text-bg" : "bg-surface text-fg/75 ring-1 ring-border hover:text-fg")}>
      {icon}
      {label}
      <span className={cx("text-[11.5px] tabular-nums", on ? "text-bg/70" : "text-subtle")}>{count}</span>
    </button>
  );
}

// ── 2. Questions ────────────────────────────────────────────────────────────

function Ask({ plan, prompt, base, onBack, onMaking, onMade, onFailed }: { plan: Plan; prompt: string; base: string; onBack: () => void; onMaking: () => void; onMade: (m: Made) => void; onFailed: () => void }) {
  const kind = kindById(plan.kind)!;
  const cat = CATEGORIES.find((c) => c.id === kind.category)!;
  const [answers, setAnswers] = useState<Record<string, string>>(plan.answers);
  const [title, setTitle] = useState(plan.title);
  const [opts, setOpts] = useState<StudioOptions>({ language: "English", tone: kind.category === "letters" ? "Friendly professional" : "Formal", detail: "Standard", favour: "Favour us", state: plan.business.state });
  const [root, setRoot] = useState<"mine" | "team">("mine");
  const [error, setError] = useState("");
  const missing = plan.questions.filter((x) => x.required && !answers[x.key]?.trim());
  const filled = plan.questions.filter((x) => answers[x.key]?.trim()).length;
  const make = async () => {
    setError("");
    onMaking();
    try {
      onMade(await api<Made>(`${base}/studio/generate`, { method: "POST", body: { kindId: kind.id, prompt, answers, options: opts, title, root } }));
    } catch (e) {
      onFailed();
      setError(errorMessage(e));
    }
  };
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Start again</button>
      <header className="flex items-start gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${cat.tone} 14%, transparent)`, color: cat.tone }}>{(() => { const Icon = CAT_ICON[cat.id]; return <Icon className="size-5" />; })()}</span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-[0.1em] text-subtle uppercase">{cat.name}</p>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] sm:text-[26px]">{kind.name}</h1>
          {plan.summary && <p className="mt-1 text-[13.5px] text-muted">{plan.summary}</p>}
        </div>
      </header>

      <section className="grid gap-4 rounded-[22px] border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">A few details</h2>
          <span className="text-[12px] text-muted">{filled} of {plan.questions.length} filled from your request · leave any blank to get a {"{{placeholder}}"}</span>
        </div>
        <Field label="Document title">{(a) => <Input {...a} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {plan.questions.map((x) => (
            <div key={x.key} className={x.type === "long" ? "sm:col-span-2" : undefined}>
              <Field label={`${x.label}${x.required ? " *" : ""}`} hint={x.help}>
                {(a) =>
                  x.type === "long" ? (
                    <Textarea {...a} rows={3} value={answers[x.key] ?? ""} placeholder={x.placeholder} onChange={(e) => set(x.key, e.target.value)} />
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

      <section className="grid gap-4 rounded-[22px] border border-border bg-surface p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold">How it should read</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Opt label="Language" value={opts.language} options={OPTIONS.language} onChange={(v) => setOpts({ ...opts, language: v as StudioOptions["language"] })} />
          <Opt label="Tone" value={opts.tone} options={OPTIONS.tone} onChange={(v) => setOpts({ ...opts, tone: v as StudioOptions["tone"] })} />
          <Opt label="Length" value={opts.detail} options={OPTIONS.detail} onChange={(v) => setOpts({ ...opts, detail: v as StudioOptions["detail"] })} />
          {kind.form === "contract" && <Opt label="Terms that favour" value={opts.favour} options={OPTIONS.favour} onChange={(v) => setOpts({ ...opts, favour: v as StudioOptions["favour"] })} />}
          <Field label="State (stamp duty, courts)">{(a) => <Input {...a} value={opts.state} maxLength={60} placeholder="Maharashtra" onChange={(e) => setOpts({ ...opts, state: e.target.value })} />}</Field>
          <Opt label="Save to" value={root === "mine" ? "My documents" : "Team documents"} options={["My documents", "Team documents"]} onChange={(v) => setRoot(v === "Team documents" ? "team" : "mine")} />
        </div>
      </section>

      {kind.laws.length > 0 && (
        <p className="flex items-start gap-2 text-[12.5px] text-muted"><BookOpenCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> Drafted against {kind.laws.slice(0, 4).join("; ")}{kind.laws.length > 4 ? ` and ${kind.laws.length - 4} more` : ""}{kind.clauses.length ? `, with ${kind.clauses.length} required clauses checked afterwards` : ""}.</p>
      )}
      {error && <Notice tone="danger" title="That didn't work">{error}</Notice>}
      <div className="sticky bottom-[calc(var(--dock,0px)+12px)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-border bg-[var(--surface-solid)]/95 p-3 shadow-[0_12px_40px_-18px_rgb(0_0_0/0.4)] backdrop-blur">
        <span className="text-[12.5px] text-muted">{missing.length ? `Still needed: ${missing.map((x) => x.label).join(", ")} — or leave it as a placeholder.` : "Everything needed is here."}</span>
        <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={() => void make()} className="max-sm:w-full">Draft the document</Button>
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

const STAGES = ["Reading your answers and business details", "Drafting the clauses", "Checking it against the law", "Laying it out as a document", "Reviewing what's covered"];

function Making({ plan }: { plan: Plan }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAt((x) => Math.min(x + 1, STAGES.length - 1)), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mx-auto grid w-full max-w-lg justify-items-center gap-6 py-16 text-center" role="status" aria-live="polite">
      <span className="studio-orb grid size-20 place-items-center rounded-full text-white"><FileText className="size-8" /></span>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Drafting “{plan.title}”</h1>
        <p className="mt-1 text-[13.5px] text-muted">A thorough draft takes a minute or two.</p>
      </div>
      <ol className="grid w-full gap-2 text-left">
        {STAGES.map((s, i) => (
          <li key={s} className={cx("flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-[13.5px] transition-colors", i < at ? "text-muted" : i === at ? "bg-surface font-medium ring-1 ring-border" : "text-subtle")}>
            {i < at ? <Check className="size-4 text-emerald-600" /> : i === at ? <Loader2 className="size-4 animate-spin text-violet-600" /> : <CircleDashed className="size-4" />}
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── 4. The document, its review, and what to do with it ─────────────────────

const REFINES = ["Make it stricter in our favour", "Add a non-solicitation clause", "Shorten it to the essentials", "Make the language simpler", "Translate it into Hindi", "Add a payment schedule annexure"];

function Done({ made, plan, base, onAnother }: { made: Made; plan: Plan; base: string; onAnother: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [html, setHtml] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [ask, setAsk] = useState("");
  const [refining, setRefining] = useState(false);
  const [signing, setSigning] = useState(false);
  const [changes, setChanges] = useState<string[]>([]);
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
      toast({ tone: "success", title: "Revised", description: "The earlier text is kept in the document's versions." });
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
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onAnother} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Make another</button>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[26px]">{made.file.title}</h1>
          <p className="mt-1 text-[13px] text-muted">{kind?.name} · saved in Documents{plan.business.name ? ` · for ${plan.business.name}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:w-full">
          <Link href={`/documents/d/${id}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg max-sm:flex-1 max-sm:justify-center"><PenLine className="size-4" /> Open and edit</Link>
          <a href={exportUrl("pdf")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium hover:bg-surface-2"><Download className="size-4" /> PDF</a>
          <a href={exportUrl("docx")} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium hover:bg-surface-2"><Download className="size-4" /> Word</a>
          <ShareToChatButton card={{ kind: "document", id, title: made.file.title, sub: kind?.name, link: `/documents/d/${id}`, module: "Documents" }} />
          <EmailButton subject={made.file.title} body={`Please find attached the ${kind?.name.toLowerCase() ?? "document"}.`} attachments={[{ url: exportUrl("pdf"), filename: `${made.file.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Document"}.pdf` }]} title={made.file.title} />
          {kind && ["contract", "form", "letter"].includes(kind.form) && <Button size="sm" icon={<FileSignature className="size-3.5" />} loading={signing} onClick={() => void sign()}>Send for signature</Button>}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 self-start overflow-hidden rounded-[22px] border border-border bg-white shadow-[0_20px_60px_-30px_rgb(0_0_0/0.35)] xl:sticky xl:top-[calc(var(--bar,64px)+16px)]">
          {html === null ? (
            <div className="grid h-[70vh] place-items-center text-[13px] text-neutral-500"><Loader2 className="size-5 animate-spin" /></div>
          ) : html ? (
            <iframe title="Document preview" sandbox="" srcDoc={html} className="block h-[70vh] w-full bg-white xl:h-[calc(100dvh-var(--bar,64px)-48px)]" />
          ) : (
            <div className="grid h-60 place-items-center p-6 text-center text-[13px] text-neutral-500">The preview didn&apos;t load — open the document to read it.</div>
          )}
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-[20px] border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <span className={cx("grid size-12 shrink-0 place-items-center rounded-full text-[15px] font-bold tabular-nums", score === null ? "bg-surface-2" : score >= 90 ? "bg-success-soft text-success" : score >= 70 ? "bg-warning/15 text-warning" : "bg-danger-soft text-danger")}>{score === null ? "—" : `${score}%`}</span>
              <div className="min-w-0">
                <h2 className="text-[14.5px] font-semibold">Standard check</h2>
                <p className="text-[12.5px] text-muted">{r.clauses.length ? `${covered} of ${r.clauses.length} required clauses covered` : "No fixed clauses for this kind"}</p>
              </div>
            </div>
            {r.clauses.length > 0 && (
              <ul className="mt-3 grid max-h-64 gap-1 overflow-y-auto pr-1">
                {r.clauses.map((c) => (
                  <li key={c.name} className="flex items-start gap-2 text-[12.5px]" title={c.note}>
                    {c.included ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />}
                    <span className={cx("min-w-0", !c.included && "font-medium")}>{c.name}{c.note && <span className="block text-[11.5px] text-subtle">{c.note}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {r.laws.length > 0 && (
            <section className="rounded-[20px] border border-border bg-surface p-4">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Scale className="size-4 text-indigo-600" /> Laws it follows</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">{r.laws.map((l) => <Badge key={l}>{l}</Badge>)}</div>
            </section>
          )}
          {(r.stamp || r.signing) && (
            <section className="grid gap-3 rounded-[20px] border border-border bg-surface p-4 text-[12.5px]">
              {r.stamp && <p><b className="flex items-center gap-1.5 text-[13.5px] font-semibold"><Stamp className="size-4 text-amber-600" /> Stamp duty and registration</b><span className="mt-1 block text-muted">{r.stamp}</span></p>}
              {r.signing && <p><b className="flex items-center gap-1.5 text-[13.5px] font-semibold"><FileSignature className="size-4 text-violet-600" /> Signing</b><span className="mt-1 block text-muted">{r.signing}</span></p>}
            </section>
          )}
          {(r.fill.length > 0 || r.warnings.length > 0) && (
            <section className="grid gap-3 rounded-[20px] border border-amber-500/25 bg-amber-500/[0.06] p-4 text-[12.5px]">
              {r.fill.length > 0 && (
                <div>
                  <b className="text-[13.5px] font-semibold">Fill these in ({r.fill.length})</b>
                  <div className="mt-1.5 flex flex-wrap gap-1">{r.fill.map((f) => <span key={f} className="rounded-full bg-[var(--surface-solid)] px-2 py-0.5 font-mono text-[11.5px] ring-1 ring-amber-500/25">{`{{${f}}}`}</span>)}</div>
                </div>
              )}
              {r.warnings.length > 0 && (
                <div>
                  <b className="text-[13.5px] font-semibold">Check before you use it</b>
                  <ul className="mt-1.5 grid list-disc gap-1 pl-4 text-muted">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
            </section>
          )}
          <section className="rounded-[20px] border border-border bg-surface p-4">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles className="size-4 text-violet-600" /> Ask for changes</h2>
            <form className="mt-2.5 grid gap-2" onSubmit={(e) => { e.preventDefault(); void refine(ask); }}>
              <Textarea aria-label="What to change" rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Make the term 3 years and add a 6-month lock-in" />
              <Button type="submit" variant="primary" size="sm" loading={refining} disabled={ask.trim().length < 3} className="justify-self-end">Revise</Button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REFINES.map((x) => <button key={x} type="button" disabled={refining} onClick={() => void refine(x)} className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-fg disabled:opacity-50">{x}</button>)}
            </div>
            {changes.length > 0 && <ul className="mt-3 grid list-disc gap-0.5 pl-4 text-[12px] text-muted">{changes.map((c) => <li key={c}>{c}</li>)}</ul>}
          </section>
          <p className="text-[11.5px] leading-relaxed text-subtle">Drafted by AI to a professional standard. For contracts, notices and anything with legal or tax consequences, have a qualified lawyer or CA review it before you sign or send.</p>
        </aside>
      </div>
    </div>
  );
}
