"use client";

// Onboarding's middle: a few quick questions (pre-answered from the industry
// and the description) with the plan updating beside them, then the plan
// itself — recommended features with the reasons for each, anything else one
// search away, and the parts of each feature to leave out.
import clsx from "clsx";
import {
  BadgeIndianRupee, BedDouble, Boxes, Briefcase, CalendarCheck, Check, ChevronDown, Factory, FileSignature, FileText, Globe, Headphones, KanbanSquare, Landmark, LogIn, Mail,
  MessageCircle, Plus, ReceiptText, Search, Sparkles, Store, Target, Truck, User, Users, UsersRound, UtensilsCrossed, Wallet, Wrench, X, Building2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { QUESTION_IDS, QUESTIONS, type Profile, type QuestionId, type Recommendation } from "@/lib/onboarding/recommend";
import { MODULE_GROUPS, moduleById, MODULES, type ModuleId, type PartsOff } from "@/lib/workspace/modules";

const ICON: Record<string, React.ReactNode> = {
  online: <Globe />, counter: <Store />, tables: <UtensilsCrossed />, rooms: <BedDouble />, bookings: <CalendarCheck />, invoices: <ReceiptText />, contracts: <Briefcase />,
  solo: <User />, small: <Users />, medium: <UsersRound />, large: <Building2 />,
  stock: <Boxes />, production: <Factory />, assets: <Wrench />, delivery: <Truck />, projects: <KanbanSquare />, documents: <FileSignature />,
  accounts: <Landmark />, payroll: <BadgeIndianRupee />, expenses: <Wallet />,
  leads: <Target />, support: <Headphones />, marketing: <Mail />, portal: <LogIn />, chat: <MessageCircle />,
};
const optIcon = (q: QuestionId, id: string) => (q === "money" && id === "invoices" ? <FileText /> : ICON[id]);

const isOn = (p: Profile, q: QuestionId, id: string) => (q === "team" ? p.team === id : (p[q] as string[]).includes(id));

/** Step 2: the questions, with the plan forming beside them. */
export function Questions(p: { profile: Profile; onChange: (p: Profile) => void; rec: Recommendation; heard: string[]; industryLabel: string; aside: React.ReactNode }) {
  const toggle = (q: QuestionId, id: string) => {
    if (q === "team") return p.onChange({ ...p.profile, team: p.profile.team === id ? null : (id as Profile["team"]) });
    const list = p.profile[q] as string[];
    p.onChange({ ...p.profile, [q]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="grid gap-5">
        {p.heard.length > 0 && (
          <p className="p-in flex flex-wrap items-center gap-1.5 text-[13px] text-fg/60">
            <Sparkles className="size-3.5 text-[var(--p-lavender-ink)]" /> From what you wrote, we&apos;ve already ticked:
            {p.heard.map((h) => <span key={h} className="rounded-full bg-[var(--p-lavender)] px-2 py-0.5 text-[12px] font-medium text-[var(--p-lavender-ink)]">{h}</span>)}
          </p>
        )}
        {QUESTION_IDS.map((q, qi) => {
          const Q = QUESTIONS[q];
          return (
            <fieldset key={q} className="p-glass p-in rounded-[24px] p-4 sm:p-5" style={{ animationDelay: `${80 + qi * 70}ms` }}>
              <legend className="sr-only">{Q.title}</legend>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-[16px] font-semibold tracking-[-0.01em]">
                  <span className="mr-2 text-fg/35 tabular-nums">{qi + 1}</span>
                  {Q.title}
                </h2>
                <span className="text-[12.5px] text-fg/45">{Q.sub}</span>
              </div>
              <div className={clsx("grid gap-2", q === "team" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3")}>
                {Q.options.map((o) => {
                  const on = isOn(p.profile, q, o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={Q.multi ? "checkbox" : "radio"}
                      aria-checked={on}
                      onClick={() => toggle(q, o.id)}
                      className={clsx(
                        "group relative flex items-start gap-3 rounded-[16px] border p-3 text-left transition-all duration-300 ease-[cubic-bezier(.16,1,.3,1)] [&_svg]:size-[18px]",
                        on ? "border-transparent bg-fg text-bg shadow-[0_14px_30px_-18px_rgb(20_10_40/0.7)]" : "border-fg/[0.08] bg-[var(--surface-solid)] hover:-translate-y-0.5 hover:border-fg/20",
                        q === "team" && "flex-col gap-2",
                      )}
                    >
                      <span className={clsx("grid size-9 shrink-0 place-items-center rounded-[11px] transition-colors", on ? "bg-white/15 text-bg" : "bg-fg/[0.05] text-fg/70")}>{optIcon(q, o.id)}</span>
                      <span className="min-w-0 flex-1">
                        <b className="block text-[14px] leading-tight font-semibold">{o.label}</b>
                        <span className={clsx("mt-0.5 block text-[12px] leading-snug", on ? "text-bg/65" : "text-fg/50")}>{o.hint}</span>
                      </span>
                      <span className={clsx("absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full transition-all duration-300", on ? "scale-100 bg-bg text-fg" : "scale-75 opacity-0")}>
                        <Check className="!size-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
      <aside className="hidden lg:sticky lg:top-24 lg:block">{p.aside}</aside>
    </div>
  );
}

/** The plan forming as answers change: what's in it, and why. */
export function PlanSummary({ rec, title = "Your plan so far" }: { rec: Recommendation; title?: string }) {
  return (
    <div className="p-glass overflow-hidden rounded-[26px]">
      <div className="flex items-center justify-between gap-3 border-b border-fg/[0.06] px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-fg/45 uppercase">{title}</p>
          <p className="text-[22px] font-semibold tracking-[-0.03em] tabular-nums">
            <span key={rec.modules.length} className="ob-chip inline-block">{rec.modules.length}</span> feature{rec.modules.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className="grid size-11 place-items-center rounded-[14px] bg-[var(--p-lavender)] text-[var(--p-lavender-ink)]">
          <Sparkles className="size-5" />
        </span>
      </div>
      {!rec.modules.length ? (
        <p className="px-5 py-10 text-center text-[13px] text-fg/50">Answer a question and your plan appears here.</p>
      ) : (
        <ul className="max-h-[calc(100dvh-260px)] divide-y divide-fg/[0.05] overflow-y-auto">
          {rec.modules.map((id) => {
            const m = moduleById(id)!;
            return (
              <li key={id} className={clsx(`tint-${m.tint}`, "ob-chip flex items-start gap-3 px-5 py-3")}>
                <span className="tint-chip grid size-8 shrink-0 place-items-center rounded-[10px]">
                  <ModuleGlyph id={id} className="size-4" />
                </span>
                <span className="min-w-0">
                  <b className="block text-[13.5px] leading-tight font-semibold">{m.name}</b>
                  <span className="mt-0.5 block text-[12px] leading-snug text-fg/55">{rec.why[id]?.[0]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Step 3: the plan — recommended features first, then everything else. */
export function Plan(p: { rec: Recommendation; modules: ModuleId[]; partsOff: PartsOff; onToggle: (id: ModuleId) => void; onPart: (id: ModuleId, part: string, on: boolean) => void; onReset: () => void; changed: boolean; aside: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ModuleId | null>(null);
  const [browse, setBrowse] = useState(false);
  const recommended = p.rec.modules;
  const added = p.modules.filter((m) => !recommended.includes(m));
  const others = useMemo(() => {
    const t = q.trim().toLowerCase();
    return MODULES.filter((m) => !recommended.includes(m.id) && (!t || `${m.name} ${m.short} ${m.adds.join(" ")}`.toLowerCase().includes(t)));
  }, [q, recommended]);
  const card = (id: ModuleId, reason: string | undefined, i: number) => {
    const m = moduleById(id)!;
    const on = p.modules.includes(id);
    const parts = m.parts ?? [];
    const offCount = (p.partsOff[id] ?? []).length;
    return (
      <li key={id} className={clsx(`tint-${m.tint}`, "p-in overflow-hidden rounded-[20px] border transition-all duration-300", on ? "border-[color-mix(in_srgb,var(--t-ink)_35%,transparent)] bg-[var(--surface-solid)] shadow-[0_16px_34px_-26px_rgb(30_20_60/0.6)]" : "border-fg/[0.07] bg-[var(--surface-solid)]/60 opacity-70")} style={{ animationDelay: `${60 + i * 35}ms` }}>
        <div className="flex items-start gap-3 p-3.5">
          <span className={clsx("grid size-10 shrink-0 place-items-center rounded-[13px] transition-all", on ? "tint-chip" : "bg-fg/[0.05] text-fg/40")}>
            <ModuleGlyph id={id} className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[14.5px] leading-tight font-semibold">{m.name}</b>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-fg/55">{m.short}</span>
            {reason && (
              <span className="mt-1.5 inline-flex items-start gap-1 rounded-[8px] px-2 py-0.5 text-[11.5px] leading-snug font-medium" style={{ background: "var(--t)", color: "var(--t-ink)" }}>
                <Sparkles className="mt-[3px] size-3 shrink-0" /> {reason}
              </span>
            )}
          </span>
          <button type="button" role="switch" aria-checked={on} aria-label={m.name} onClick={() => p.onToggle(id)} className={clsx("relative h-6 w-10 shrink-0 rounded-full transition-colors duration-300", on ? "bg-[var(--t-ink)]" : "bg-fg/15")}>
            <span className={clsx("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-300", on && "translate-x-4")} />
          </button>
        </div>
        {on && parts.length > 0 && (
          <div className="border-t border-fg/[0.06]">
            <button type="button" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)} className="flex w-full items-center justify-between px-3.5 py-2 text-[12.5px] text-fg/55 hover:text-fg">
              <span>{parts.length - offCount} of {parts.length} parts on{offCount ? "" : " — tap to leave some out"}</span>
              <ChevronDown className={clsx("size-3.5 transition-transform", open === id && "rotate-180")} />
            </button>
            {open === id && (
              <div className="flex flex-wrap gap-1.5 px-3.5 pb-3" role="group" aria-label={`Parts of ${m.name}`}>
                {parts.map((part) => {
                  const partOn = !p.partsOff[id]?.includes(part.id);
                  return (
                    <button key={part.id} type="button" aria-pressed={partOn} title={part.short} onClick={() => p.onPart(id, part.id, !partOn)} className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors", partOn ? "text-white" : "bg-fg/[0.05] text-fg/45 line-through")} style={partOn ? { background: "var(--t-ink)" } : undefined}>
                      {partOn && <Check className="size-3" />}
                      {part.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="grid gap-6">
        <section className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-fg/50 uppercase">Recommended for you · {recommended.length}</h2>
            {p.changed && <button type="button" onClick={p.onReset} className="text-[13px] text-fg/50 hover:text-fg">Back to the recommendation</button>}
          </div>
          {recommended.length ? (
            <ul className="grid gap-2.5 md:grid-cols-2">{recommended.map((id, i) => card(id, p.rec.why[id]?.[0], i))}</ul>
          ) : (
            <p className="rounded-[20px] border border-dashed border-fg/15 p-6 text-center text-[13px] text-fg/50">Nothing recommended yet — go back and answer a question, or add features below.</p>
          )}
        </section>
        {added.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-[13px] font-semibold tracking-[0.12em] text-fg/50 uppercase">Added by you · {added.length}</h2>
            <ul className="grid gap-2.5 md:grid-cols-2">{added.map((id, i) => card(id, undefined, i))}</ul>
          </section>
        )}
        <section className="grid gap-3">
          <button type="button" aria-expanded={browse} onClick={() => setBrowse(!browse)} className="p-glass flex items-center justify-between gap-3 rounded-[18px] px-4 py-3.5 text-left">
            <span className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-[11px] bg-fg/[0.06]"><Plus className="size-4" /></span>
              <span>
                <b className="block text-[14.5px] font-semibold">Add something else</b>
                <span className="block text-[12.5px] text-fg/50">{MODULES.length - recommended.length} more features — search or browse by area</span>
              </span>
            </span>
            <ChevronDown className={clsx("size-4 text-fg/50 transition-transform", browse && "rotate-180")} />
          </button>
          {browse && (
            <div className="grid gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg/35" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — payroll, GST, QR menu, e-sign…" aria-label="Search features" className="p-input !pl-10" />
                {q && <button type="button" aria-label="Clear" onClick={() => setQ("")} className="absolute top-1/2 right-3 -translate-y-1/2 text-fg/40 hover:text-fg"><X className="size-4" /></button>}
              </div>
              {MODULE_GROUPS.map((g) => {
                const list = others.filter((m) => m.group === g.id);
                if (!list.length) return null;
                return (
                  <div key={g.id} className="grid gap-2">
                    <p className="px-1 text-[11.5px] font-semibold tracking-[0.12em] text-fg/45 uppercase">{g.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {list.map((m) => {
                        const on = p.modules.includes(m.id);
                        return (
                          <button key={m.id} type="button" aria-pressed={on} title={m.short} onClick={() => p.onToggle(m.id)} className={clsx(`tint-${m.tint}`, "inline-flex items-center gap-2 rounded-full border py-1.5 pr-3 pl-1.5 text-[13px] font-medium transition-all", on ? "border-transparent text-white" : "border-fg/10 bg-[var(--surface-solid)] hover:border-fg/25")} style={on ? { background: "var(--t-ink)" } : undefined}>
                            <span className={clsx("grid size-6 place-items-center rounded-full", on ? "bg-white/20" : "tint-chip")}>
                              {on ? <Check className="size-3.5" /> : <ModuleGlyph id={m.id} className="size-3.5" />}
                            </span>
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {!others.length && <p className="text-center text-[13px] text-fg/50">Nothing matches “{q}”.</p>}
            </div>
          )}
        </section>
      </div>
      <aside className="hidden lg:sticky lg:top-24 lg:block">{p.aside}</aside>
    </div>
  );
}
