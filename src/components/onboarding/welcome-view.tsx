"use client";

// First-run onboarding, about two minutes: welcome → the business (name, a
// line about it, the industry) → a few quick questions, pre-answered from the
// industry and the line, with the plan forming beside them → the plan:
// recommended features with the reason for each, anything else a search away
// → the workspace set up for real → ready. Only the chosen features appear in
// the dashboard; the rest can be switched on any time in Settings → Features.
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, Clock, Eye, LayoutDashboard, Loader2, PanelsTopLeft, Rocket, Sparkles, Wand2, X } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogoMark, Wordmark } from "@/components/brand";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { useSession } from "@/components/shell/session-context";
import { api, errorMessage } from "@/lib/client/api";
import { profileFor, recommend, type Profile } from "@/lib/onboarding/recommend";
import { suggestIndustry } from "@/lib/onboarding/suggest";
import { CORE, goalsFor, industryById, INDUSTRIES, MODULE_GROUPS, moduleById, MODULES, neededBy, photoUrl, SETUP_LABEL, withRequirements, type Industry, type IndustryId, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { Plan, PlanSummary, Questions } from "./steps";

type Screen = "welcome" | "business" | "questions" | "plan" | "build" | "ready";
const STEPS: { screen: Screen; label: string }[] = [
  { screen: "business", label: "Your business" },
  { screen: "questions", label: "Quick questions" },
  { screen: "plan", label: "Your plan" },
  { screen: "build", label: "Set up" },
];

const save = (body: Record<string, unknown>) => api("/api/v1/auth/onboarding", { method: "PUT", body }).catch(() => null);

export { suggestIndustry } from "@/lib/onboarding/suggest";

export function WelcomeView() {
  const { user, org } = useSession();
  const router = useRouter();
  const first = user.name.split(" ")[0] || "there";
  const canManage = org.role === "owner" || org.role === "admin";
  const [screen, setScreen] = useState<Screen>("welcome");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  // Arriving from a business page (/for/…) pre-picks that industry.
  const params = useSearchParams();
  const [picked, setPicked] = useState<IndustryId | null>(() => industryById(params.get("industry"))?.id ?? null);
  const suggested = useMemo(() => suggestIndustry(`${name} ${brief}`), [name, brief]);
  const industryId = picked ?? suggested;
  const industry = industryById(industryId);
  // The answers follow the industry and the description until changed by hand.
  const derived = useMemo(() => profileFor(industryId, brief), [industryId, brief]);
  const [answers, setAnswers] = useState<Profile | null>(null);
  const profile = answers ?? derived.profile;
  const rec = useMemo(() => recommend(profile, industryId), [profile, industryId]);
  const [chosen, setChosen] = useState<ModuleId[] | null>(null);
  const modules = chosen ?? rec.modules;
  const [partsOff, setPartsOff] = useState<PartsOff>({});
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const stepIdx = STEPS.findIndex((x) => x.screen === (screen === "ready" ? "build" : screen));
  const go = (s: Screen) => {
    setScreen(s);
    setSheet(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const pickIndustry = (id: IndustryId) => {
    setPicked(id);
    setAnswers(null);
    setChosen(null);
  };
  const skip = async () => {
    await save({ complete: true });
    router.push("/home");
  };
  const toggle = (id: ModuleId) => setChosen(modules.includes(id) ? modules.filter((m) => m !== id && !neededBy(id, modules).includes(m)) : withRequirements([...modules, id]));
  const changed = !!chosen && (chosen.length !== rec.modules.length || chosen.some((m) => !rec.modules.includes(m)));
  const businessReady = name.trim().length >= 2 && !!industry;
  const footer =
    screen === "business"
      ? { back: () => go("welcome"), next: () => (void save({ name: name.trim(), brief: brief.trim() || undefined }), go("questions")), label: "Continue", disabled: !businessReady, note: !name.trim() ? "Add your business name" : !industry ? "Pick the closest industry" : `${industry.label} · ${rec.modules.length} features so far` }
      : screen === "questions"
        ? { back: () => go("business"), next: () => (setChosen(null), go("plan")), label: "See my plan", disabled: false, note: `${rec.modules.length} feature${rec.modules.length === 1 ? "" : "s"} in your plan` }
        : screen === "plan"
          ? { back: () => go("questions"), next: () => go("build"), label: "Set up my workspace", disabled: !modules.length, note: `${modules.length} feature${modules.length === 1 ? "" : "s"} · change any time in Settings → Features` }
          : null;

  return (
    <div className="pastel relative min-h-dvh overflow-x-clip">
      <div className="p-aurora" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <header className="sticky top-0 z-30 border-b border-fg/[0.05] bg-[color-mix(in_srgb,var(--p-canvas)_72%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-8">
          <Wordmark className="text-[22px]" />
          {screen !== "welcome" && (
            <StepProgress labels={STEPS.map((x) => x.label)} index={stepIdx} finished={screen === "ready"} />
          )}
          {screen !== "build" && screen !== "ready" ? (
            <button type="button" onClick={() => void skip()} className="text-[13px] text-fg/50 transition-colors hover:text-fg">
              Skip setup
            </button>
          ) : (
            <span className="w-16" />
          )}
        </div>
        {screen !== "welcome" && (
          <div className="h-0.5 bg-fg/[0.05] md:hidden" aria-hidden>
            <div className="h-full bg-gradient-to-r from-[#FF5A5F] to-[#FDBA5A] transition-[width] duration-700" style={{ width: `${((Math.max(stepIdx, 0) + (screen === "ready" ? 1 : 0.5)) / STEPS.length) * 100}%` }} />
          </div>
        )}
      </header>

      <main className={clsx("relative z-10 mx-auto max-w-[1320px] px-4 sm:px-8", footer ? "pt-8 pb-32 sm:pt-10" : "flex min-h-[calc(100dvh-4rem)] flex-col justify-center py-10")}>
        {screen === "welcome" && <Welcome eyebrow={`Welcome, ${first}`} onStart={() => go("business")} />}
        {screen === "business" && (
          <Business name={name} setName={setName} brief={brief} setBrief={setBrief} industryId={industryId} suggested={!picked && !!suggested} onPick={pickIndustry} heard={derived.heard} />
        )}
        {screen === "questions" && industry && (
          <>
            <Heading eyebrow={`Step 2 of 4 · ${industry.label}`} title="A few quick questions" sub="We've pre-answered them for a business like yours. Tap to change anything — your plan updates as you go." />
            <div className="mt-8">
              <Questions profile={profile} onChange={setAnswers} rec={rec} heard={derived.heard} industryLabel={industry.label} aside={<PlanSummary rec={rec} />} />
            </div>
          </>
        )}
        {screen === "plan" && industry && (
          <>
            <Heading eyebrow="Step 3 of 4 · Your plan" title={`${name.trim() || "Your"}'s workspace`} sub="Here's what we recommend, and why. Switch anything off, leave out parts you won't use, or add more." />
            <div className="mt-8">
              <Plan
                rec={rec}
                modules={modules}
                partsOff={partsOff}
                onToggle={toggle}
                onPart={(id, part, on) => setPartsOff((p) => ({ ...p, [id]: on ? (p[id] ?? []).filter((x) => x !== part) : [...(p[id] ?? []), part] }))}
                onReset={() => (setChosen(null), setPartsOff({}))}
                changed={changed}
                aside={<PlanAside name={name.trim()} industry={industry} modules={modules} />}
              />
            </div>
          </>
        )}
        {screen === "build" && industry && (
          <Build
            name={name.trim()}
            brief={brief.trim()}
            industry={industry}
            modules={modules}
            partsOff={partsOff}
            canManage={canManage}
            orgId={org.id}
            onDone={(pid) => {
              setProjectId(pid);
              go("ready");
              router.refresh();
            }}
            onBack={() => go("plan")}
          />
        )}
        {screen === "ready" && industry && <Ready name={name.trim()} industry={industry} modules={modules} projectId={projectId} />}
      </main>

      {footer && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-fg/[0.06] bg-[color-mix(in_srgb,var(--p-canvas)_80%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-3 sm:px-8">
            <button type="button" onClick={footer.back} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] text-fg/55 transition-colors hover:text-fg">
              <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back</span>
            </button>
            <p className={clsx("min-w-0 flex-1 truncate text-[13px] text-fg/55", (screen === "questions" || screen === "plan") && "max-lg:invisible")} aria-live="polite">{footer.note}</p>
            {(screen === "questions" || screen === "plan") && (
              <button type="button" onClick={() => setSheet(true)} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium ring-1 ring-fg/10 lg:hidden">
                <Eye className="size-4" /> {screen === "plan" ? modules.length : rec.modules.length} · Preview
              </button>
            )}
            <button type="button" disabled={footer.disabled} onClick={footer.next} className="p-cta lx-sheen inline-flex items-center gap-2 px-5 sm:px-7">
              {screen === "plan" ? <Wand2 className="size-4" /> : null}
              {footer.label} {screen !== "plan" && <ArrowRight className="size-4" />}
            </button>
          </div>
        </div>
      )}

      {sheet && industry && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Preview">
          <button type="button" aria-label="Close preview" className="absolute inset-0 bg-black/30 backdrop-blur-[3px]" onClick={() => setSheet(false)} />
          <div className="ob-sheet absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto rounded-t-[28px] bg-[var(--p-canvas)] p-4 pb-8 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="mx-auto h-1 w-10 rounded-full bg-fg/15" />
              <button type="button" onClick={() => setSheet(false)} aria-label="Close" className="absolute top-4 right-4 grid size-8 place-items-center rounded-full bg-fg/[0.06]">
                <X className="size-4" />
              </button>
            </div>
            {screen === "questions" ? <PlanSummary rec={rec} /> : <PlanAside name={name.trim()} industry={industry} modules={modules} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** The steps across the top: done, now and next. */
export function StepProgress({ labels, index, finished }: { labels: string[]; index: number; finished?: boolean }) {
  return (
    <ol className="hidden items-center gap-1 md:flex" aria-label="Progress">
      {labels.map((label, i) => {
        const state = i < index || finished ? "done" : i === index ? "now" : "next";
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && <span className={clsx("h-px w-5 transition-colors duration-700 lg:w-8", state === "next" ? "bg-fg/15" : "bg-fg/50")} />}
            <span aria-current={state === "now" ? "step" : undefined} className={clsx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-all duration-500", state === "now" ? "bg-fg text-bg shadow-sm" : state === "done" ? "text-fg/70" : "text-fg/35")}>
              <span className={clsx("grid size-4 place-items-center rounded-full text-[10px] tabular-nums", state === "now" ? "bg-bg/20" : state === "done" ? "bg-[var(--p-mint)] text-[var(--p-mint-ink)]" : "bg-fg/[0.07]")}>{state === "done" ? <Check className="size-2.5" /> : i + 1}</span>
              <span className={clsx(labels.length > 4 && state !== "now" && "hidden xl:inline")}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function PlanAside({ name, industry, modules }: { name: string; industry: Industry; modules: ModuleId[] }) {
  return (
    <div className="grid gap-3">
      <DashPreview name={name} industry={industry} modules={modules} />
      <div className="p-glass flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[18px] px-4 py-3 text-[12px] text-fg/60">
        <b className="font-semibold text-fg/75">Always included:</b>
        {CORE.map((c) => (
          <span key={c} className="inline-flex items-center gap-1">
            <Check className="size-3 text-[var(--p-mint-ink)]" />
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Welcome ─────────────────────────────────────────────────────────────────

const WELCOME_STEPS: [string, string, string][] = [
  ["Your business", "Name, a line about it, your industry", "20 sec"],
  ["Quick questions", "Already answered for you — just check", "40 sec"],
  ["Your plan", "What we recommend, and why", "30 sec"],
  ["Set up", "Done for you, live", "15 sec"],
];

export function Welcome({ eyebrow, onStart, steps = WELCOME_STEPS, time = "About 2 minutes" }: { eyebrow: string; onStart: () => void; steps?: [string, string, string][]; time?: string }) {
  return (
    <section className="ob-screen grid items-center gap-12 lg:grid-cols-[1fr_1.05fr]">
      <div className="grid gap-7 text-center max-sm:gap-5 lg:text-left">
        <p className="p-in inline-flex items-center justify-center gap-2 text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase lg:justify-start">
          <span className="size-1.5 rounded-full bg-[#FF5A5F]" /> {eyebrow}
        </p>
        <h1 className="p-in text-[clamp(2.4rem,5.6vw,4.4rem)] leading-[0.98] font-semibold tracking-[-0.045em] text-balance max-sm:text-[34px] max-sm:leading-[1.04]" style={{ animationDelay: "100ms" }}>
          Your business software, <span className="bg-gradient-to-r from-[#FF5A5F] to-[#e8962a] bg-clip-text text-transparent">ready in minutes.</span>
        </h1>
        <p className="p-in mx-auto max-w-xs text-[15px] leading-snug text-fg/55 sm:hidden" style={{ animationDelay: "180ms" }}>
          A few taps about your business. We set up exactly what you need.
        </p>
        <p className="p-in mx-auto max-w-lg text-[17px] leading-relaxed text-fg/60 max-sm:hidden lg:mx-0" style={{ animationDelay: "180ms" }}>
          Tell us how your business works. We&apos;ll recommend exactly the tools you need — billing, stock, payroll, bookings, accounts — explain why, and set them up for you. Nothing you don&apos;t need.
        </p>
        <ol className="p-in mx-auto grid w-full max-w-md gap-2 lg:mx-0" style={{ animationDelay: "260ms" }}>
          {steps.map(([t, s, took], i) => (
            <li key={t} className="p-glass flex items-center gap-3 rounded-[16px] px-4 py-2.5 text-left max-sm:rounded-[14px] max-sm:py-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-[12px] font-semibold text-bg max-sm:size-6 max-sm:text-[11px]">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <b className="block text-[14px] font-semibold">{t}</b>
                <span className="block text-[12.5px] text-fg/55 max-sm:hidden">{s}</span>
              </span>
              <span className="text-[12px] text-fg/45 tabular-nums">{took}</span>
            </li>
          ))}
        </ol>
        <div className="p-in flex flex-wrap items-center justify-center gap-4 max-sm:flex-col max-sm:gap-3 lg:justify-start" style={{ animationDelay: "340ms" }}>
          <button type="button" autoFocus onClick={onStart} className="p-cta lx-sheen inline-flex items-center justify-center gap-2 px-8 max-sm:w-full">
            Let&apos;s begin <ArrowRight className="size-4" />
          </button>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-fg/50">
            <Clock className="size-3.5" /> {time}
          </span>
        </div>
      </div>
      <FeatureOrbit />
    </section>
  );
}

/** One tile per spot around the dashboard — a spread of what's inside. Spots are
 *  [side, inset %, top %, tilt]: tiles on the right are anchored from the right
 *  so long names never run off the edge. */
const ORBIT: [ModuleId, "l" | "r", number, number, number][] = [
  ["store", "l", 2, 10, -6], ["invoicing", "r", 2, 3, 5], ["mail", "l", 36, -1, 3], ["bi", "r", 0, 29, -4], ["chat", "l", -4, 40, -5],
  ["hr", "r", 4, 55, 6], ["crm", "l", 0, 66, 4], ["inventory", "r", 6, 80, -6], ["bookings", "l", 10, 91, 4], ["calendar", "r", 38, 95, -3],
];

/** Feature tiles drifting around a dashboard that fills itself in. */
function FeatureOrbit() {
  return (
    <div className="relative mx-auto aspect-[1.1] w-full max-w-[560px] max-sm:hidden" aria-hidden>
      <div className="ob-piece absolute inset-[16%] overflow-hidden rounded-[26px] bg-[var(--surface-solid)] shadow-[0_40px_90px_-40px_rgb(40_20_80/0.5)] ring-1 ring-fg/[0.06]" style={{ ["--dur" as string]: "9s", ["--lift" as string]: "-6px" }}>
        <div className="flex h-7 items-center gap-1.5 border-b border-fg/[0.06] px-3">
          <i className="size-2 rounded-full bg-[#ff5f57]" />
          <i className="size-2 rounded-full bg-[#febc2e]" />
          <i className="size-2 rounded-full bg-[#28c840]" />
        </div>
        <div className="grid h-[calc(100%-1.75rem)] grid-cols-[30%_1fr]">
          <div className="grid content-start gap-1.5 border-r border-fg/[0.06] p-2.5">
            {MODULES.slice(0, 7).map((m, i) => (
              <span key={m.id} className={clsx(`tint-${m.tint}`, "ob-badge flex items-center gap-1.5 rounded-[8px] px-1.5 py-1")} style={{ animationDelay: `${600 + i * 160}ms` }}>
                <span className="tint-chip grid size-4 place-items-center rounded-[5px]">
                  <ModuleGlyph id={m.id} className="size-2.5" />
                </span>
                <span className="h-1.5 flex-1 rounded-full bg-fg/10" />
              </span>
            ))}
          </div>
          <div className="grid content-start gap-2 p-2.5">
            <span className="ob-badge h-12 rounded-[12px] bg-[var(--p-lavender)]" style={{ animationDelay: "500ms" }} />
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="ob-badge grid h-14 content-end gap-1 rounded-[12px] bg-fg/[0.04] p-2" style={{ animationDelay: `${900 + i * 180}ms` }}>
                  <span className="flex h-6 items-end gap-0.5">
                    {[40, 65, 50, 85, 70].map((h, j) => (
                      <i key={j} className="w-1.5 origin-bottom rounded-sm" style={{ height: `${h}%`, background: ["var(--p-peach-ink)", "var(--p-mint-ink)", "var(--p-sky-ink)", "var(--p-lavender-ink)"][i], opacity: 0.6, animation: `mk-bar 0.8s ${1.2 + i * 0.18 + j * 0.06}s cubic-bezier(.2,.8,.2,1) both` }} />
                    ))}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {ORBIT.map(([id, side, x, y, rot], i) => {
        const m = moduleById(id)!;
        return (
          <span
            key={m.id}
            className={clsx(`tint-${m.tint}`, "ob-piece absolute flex items-center gap-2 rounded-[16px] bg-[var(--surface-solid)] p-1.5 sm:px-2.5 sm:py-2 text-[12px] font-semibold whitespace-nowrap shadow-[0_18px_40px_-20px_rgb(40_20_80/0.45)] ring-1 ring-fg/[0.06]")}
            style={{ [side === "l" ? "left" : "right"]: `${x}%`, top: `${y}%`, animationDelay: `${i * 90}ms`, ["--rot" as string]: `${rot}deg`, ["--dur" as string]: `${6 + (i % 4)}s`, ["--float-delay" as string]: `${1 + (i % 3) * 0.4}s` }}
          >
            <span className="tint-chip grid size-7 place-items-center rounded-[10px]">
              <ModuleGlyph id={m.id} className="size-3.5" />
            </span>
            <span className="hidden sm:inline">{m.name}</span>
          </span>
        );
      })}
    </div>
  );
}

// ─── The business ────────────────────────────────────────────────────────────

export function Business(p: { name: string; setName: (v: string) => void; brief: string; setBrief: (v: string) => void; industryId: IndustryId | null; suggested: boolean; onPick: (id: IndustryId) => void; heard: string[]; eyebrow?: string }) {
  return (
    <section className="ob-screen grid gap-8 max-sm:gap-4">
      <Heading eyebrow={p.eyebrow ?? "Step 1 of 4 · Your business"} title="Tell us about your business" sub="A line about what you do helps us recommend the right tools — we'll show you what we picked up." />
      <div className="grid items-start gap-6 max-sm:gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:gap-8">
        <div className="p-glass p-in grid gap-5 rounded-[28px] p-5 max-sm:gap-3 max-sm:rounded-[22px] max-sm:p-3.5 sm:p-6 lg:sticky lg:top-24" style={{ animationDelay: "100ms" }}>
          <label className="grid gap-2 max-sm:gap-1.5">
            <span className="text-[12.5px] font-semibold text-fg/60">Business name</span>
            <input
              autoFocus
              value={p.name}
              maxLength={60}
              onChange={(e) => p.setName(e.target.value)}
              placeholder="Saffron House"
              className="h-14 rounded-[16px] border border-fg/10 bg-[var(--surface-solid)] px-4 text-[20px] font-semibold max-sm:h-12 max-sm:rounded-[14px] max-sm:text-[17px] tracking-tight outline-none transition-[border,box-shadow] placeholder:text-fg/25 focus:border-fg/40 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--fg)_8%,transparent)]"
            />
          </label>
          <label className="grid gap-2 max-sm:gap-1.5">
            <span className="flex items-baseline justify-between text-[12.5px] font-semibold text-fg/60">
              What do you do? <span className="font-normal text-fg/40">optional, but it helps</span>
            </span>
            <textarea
              value={p.brief}
              maxLength={240}
              rows={3}
              onChange={(e) => p.setBrief(e.target.value)}
              placeholder="e.g. A bakery in Pune with a shop and online orders, 12 staff, we deliver across the city"
              className="resize-none rounded-[16px] border border-fg/10 bg-[var(--surface-solid)] px-4 py-3 text-[15px] leading-relaxed max-sm:h-[68px] max-sm:rounded-[14px] max-sm:py-2.5 max-sm:text-[14px] max-sm:leading-snug outline-none transition-[border,box-shadow] placeholder:text-fg/30 focus:border-fg/40 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--fg)_8%,transparent)]"
            />
          </label>
          <div className={clsx("min-h-[52px] rounded-[16px] bg-fg/[0.03] px-4 py-3 max-sm:min-h-0 max-sm:px-3 max-sm:py-2", !p.heard.length && !p.suggested && "max-sm:hidden")} aria-live="polite">
            {p.heard.length || p.suggested ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <Sparkles className="size-3.5 text-[var(--p-lavender-ink)]" />
                <span className="text-fg/55">We picked up:</span>
                {p.suggested && p.industryId && <span className="ob-chip rounded-full bg-fg px-2 py-0.5 font-medium text-bg">{industryById(p.industryId)?.label}</span>}
                {p.heard.map((h, i) => (
                  <span key={h} className="ob-chip rounded-full bg-[var(--p-lavender)] px-2 py-0.5 font-medium text-[var(--p-lavender-ink)]" style={{ animationDelay: `${i * 50}ms` }}>
                    {h}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-fg/45">Try: how you sell (shop, online, tables, appointments), what you track (stock, deliveries, projects) and how many people work with you.</p>
            )}
          </div>
        </div>
        <div className="grid gap-3">
          <p className="flex items-baseline justify-between px-1 text-[12.5px] font-semibold text-fg/60">
            <span>
              Closest industry <span className="font-normal text-fg/45 max-sm:hidden">{p.suggested && "— we suggested one, change it if it's not right"}</span>
            </span>
            <span className="font-normal text-fg/40 sm:hidden">Swipe for more</span>
          </p>
          {/* Phones: two rows that scroll sideways, so the whole step fits on one screen. */}
          <div role="radiogroup" aria-label="Industry" className="grid grid-cols-2 gap-2.5 max-sm:-mx-4 max-sm:grid-cols-none max-sm:auto-cols-[40%] max-sm:grid-flow-col max-sm:grid-rows-2 max-sm:snap-x max-sm:scroll-px-4 max-sm:gap-2 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 max-sm:[scrollbar-width:none] sm:grid-cols-3 xl:grid-cols-4">
            {INDUSTRIES.map((ind, i) => {
              const on = p.industryId === ind.id;
              return (
                <button
                  key={ind.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => p.onPick(ind.id)}
                  className={clsx("p-in group relative aspect-[4/3] overflow-hidden rounded-[18px] text-left max-sm:aspect-[4/2.9] max-sm:snap-start max-sm:rounded-[14px] shadow-[0_12px_28px_-22px_rgb(30_20_60/0.6)] transition-all duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-0.5", on ? "ring-[3px] ring-fg ring-offset-2 ring-offset-[var(--p-canvas)]" : "ring-1 ring-fg/[0.06]")}
                  style={{ animationDelay: `${140 + i * 30}ms` }}
                >
                  {ind.photo ? (
                    <Image src={photoUrl(ind.photo, 480)} alt="" fill sizes="(min-width: 1280px) 15vw, (min-width: 640px) 28vw, 45vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.06]" />
                  ) : (
                    <span className={`tint-${ind.tint} absolute inset-0 grid place-items-center`} style={{ background: "radial-gradient(80% 80% at 30% 20%, var(--t), color-mix(in srgb, var(--t) 40%, var(--surface-solid)))" }}>
                      <Sparkles className="size-9 opacity-60" style={{ color: "var(--t-ink)" }} />
                    </span>
                  )}
                  <span className={clsx("absolute inset-0", ind.photo ? "bg-gradient-to-t from-black/80 via-black/10 to-transparent" : "")} />
                  <span className={clsx("absolute inset-x-0 bottom-0 p-3 max-sm:p-2.5", ind.photo ? "text-white" : "text-fg")}>
                    <b className="block text-[14px] leading-tight font-semibold tracking-[-0.01em] max-sm:text-[12.5px]">{ind.label}</b>
                    <span className={clsx("mt-0.5 block truncate text-[11.5px] max-sm:hidden", ind.photo ? "text-white/75" : "text-fg/55")}>{ind.line}</span>
                  </span>
                  <span className={clsx("absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full transition-all duration-300", on ? "scale-100 bg-white text-black" : "scale-75 bg-white/30 text-transparent backdrop-blur-[6px]")}>
                    <Check className="size-3.5" />
                  </span>
                  {on && p.suggested && <span className="absolute top-2.5 left-2.5 rounded-full bg-white px-2 py-0.5 text-[10.5px] font-semibold text-black">Suggested</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/** A live miniature of the dashboard: the sidebar and widgets follow the chosen features. */
export function DashPreview({ name, industry, modules, big }: { name: string; industry: Industry; modules: ModuleId[]; big?: boolean }) {
  const shown = MODULES.filter((m) => modules.includes(m.id));
  return (
    <div className={clsx("overflow-hidden rounded-[24px] bg-[var(--surface-solid)] shadow-[0_40px_90px_-40px_rgb(40_20_80/0.5)] ring-1 ring-fg/[0.07]", big && "lg:rounded-[28px]")} aria-label="Preview of your dashboard" role="img">
      <div className="flex h-8 items-center gap-1.5 border-b border-fg/[0.06] px-3.5">
        <i className="size-2.5 rounded-full bg-[#ff5f57]" />
        <i className="size-2.5 rounded-full bg-[#febc2e]" />
        <i className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto rounded-full bg-fg/[0.05] px-3 py-0.5 text-[10.5px] font-medium text-fg/45">{(name || "your-business").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.cloudesk</span>
      </div>
      <div className="grid min-h-[380px] grid-cols-[38%_minmax(0,1fr)] sm:grid-cols-[32%_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden border-r border-fg/[0.06] p-2.5 text-[11.5px]">
          <span className="mb-2 flex items-center gap-1.5 px-1.5 font-semibold">
            <LogoMark className="size-4" />
            <span className="truncate">{name || "Your business"}</span>
          </span>
          <PreviewItem icon={<LayoutDashboard className="size-3" />} label="Home" active />
          {/* Grouped exactly like the real sidebar. */}
          {MODULE_GROUPS.map((g) => {
            const list = shown.filter((m) => m.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id} className="grid gap-0.5">
                <span className="mt-1.5 px-1.5 text-[8.5px] font-semibold tracking-[0.08em] text-fg/40 uppercase">{g.label.replace(/ — .*/, "")}</span>
                {list.map((m) => (
                  <span key={m.id} className={`tint-${m.tint} ob-chip flex items-center gap-1.5 rounded-[8px] px-1.5 py-1`}>
                    <span className="tint-chip grid size-4 shrink-0 place-items-center rounded-[5px]">
                      <ModuleGlyph id={m.id} className="size-2.5" />
                    </span>
                    <span className="min-w-0 truncate font-medium">{m.name}</span>
                  </span>
                ))}
              </div>
            );
          })}
          <span className="mt-1.5 px-1.5 text-[8.5px] font-semibold tracking-[0.08em] text-fg/40 uppercase">Websites & apps</span>
          <PreviewItem icon={<PanelsTopLeft className="size-3" />} label="Web apps" />
          <PreviewItem icon={<Rocket className="size-3" />} label="Deployments" />
        </div>
        <div className="grid min-w-0 content-start gap-2.5 p-3">
          <div className="relative h-20 overflow-hidden rounded-[14px]">
            {industry.photo ? <Image src={photoUrl(industry.photo, 700)} alt="" fill sizes="30vw" className="object-cover" /> : <span className={`tint-${industry.tint} absolute inset-0`} style={{ background: "var(--t)" }} />}
            <span className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
            <span className="absolute bottom-2.5 left-3 text-white">
              <span className="block text-[10px] font-medium opacity-75">Good morning</span>
              <b className="block text-[14px] font-semibold tracking-tight">{name || "Your business"}</b>
            </span>
          </div>
          {shown.length ? (
            <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
              {shown.slice(0, big ? 6 : 4).map((m) => (
                <Widget key={m.id} id={m.id} />
              ))}
            </div>
          ) : (
            <p className="grid h-40 place-items-center rounded-[14px] border border-dashed border-fg/15 text-[12px] text-fg/45">Pick features to see them here</p>
          )}
        </div>
      </div>
    </div>
  );
}

const PreviewItem = ({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) => (
  <span className={clsx("flex items-center gap-1.5 rounded-[8px] px-1.5 py-1", active ? "bg-fg text-bg" : "text-fg/60")}>
    <span className="grid size-4 place-items-center">{icon}</span>
    {label}
  </span>
);

/** A small, made-up-free illustration of each feature (shapes only, no numbers). */
function Widget({ id }: { id: ModuleId }) {
  const m = moduleById(id)!;
  const bar = (h: number, j: number) => <i key={j} className="w-full origin-bottom rounded-[3px]" style={{ height: `${h}%`, background: "var(--t-ink)", opacity: 0.25 + j * 0.12, animation: `mk-bar .7s ${j * 0.07}s cubic-bezier(.2,.8,.2,1) both` }} />;
  let art: React.ReactNode;
  switch (id) {
    case "store":
    case "growth":
      art = <span className="flex h-full items-end gap-1">{[35, 55, 45, 75, 60, 90].map(bar)}</span>;
      break;
    case "horeca":
      art = (
        <span className="grid h-full grid-cols-4 gap-1">
          {["t", "f", "t", "r", "f", "t", "c", "f"].map((s, j) => (
            <i key={j} className="rounded-[4px]" style={{ background: s === "f" ? "color-mix(in srgb, var(--fg) 7%, transparent)" : s === "r" ? "var(--p-mint)" : s === "c" ? "var(--p-rose)" : "var(--t)", animation: `ob-chip .5s ${j * 0.05}s both` }} />
          ))}
        </span>
      );
      break;
    case "bookings":
      art = (
        <span className="grid h-full grid-cols-7 gap-0.5">
          {Array.from({ length: 14 }, (_, j) => (
            <i key={j} className="grid place-items-center rounded-[3px] bg-fg/[0.05]">{[2, 4, 5, 9, 11].includes(j) && <b className="size-1.5 rounded-full" style={{ background: "var(--t-ink)" }} />}</i>
          ))}
        </span>
      );
      break;
    case "invoicing":
    case "pos":
      art = (
        <span className="grid h-full content-center gap-1">
          {[90, 70, 80].map((w, j) => (
            <i key={j} className="h-1.5 rounded-full bg-fg/10" style={{ width: `${w}%` }} />
          ))}
          <span className="mt-1 flex items-center justify-between">
            <i className="h-2 w-10 rounded-full" style={{ background: "var(--t-ink)", opacity: 0.6 }} />
            <i className="rounded-full px-1.5 text-[8px] font-bold not-italic" style={{ background: "var(--t)", color: "var(--t-ink)" }}>{id === "pos" ? "UPI" : "PAID"}</i>
          </span>
        </span>
      );
      break;
    case "chatbot":
      art = (
        <span className="grid h-full content-center gap-1">
          <i className="h-3 w-3/4 rounded-full rounded-bl-none bg-fg/10" />
          <i className="h-3 w-2/3 justify-self-end rounded-full rounded-br-none" style={{ background: "var(--t)" }} />
        </span>
      );
      break;
    case "automations":
      art = (
        <span className="flex h-full items-center justify-between">
          {[0, 1, 2].map((j) => (
            <span key={j} className="flex items-center">
              <i className="size-4 rounded-[5px]" style={{ background: j === 1 ? "var(--t-ink)" : "var(--t)", opacity: j === 1 ? 0.7 : 1 }} />
              {j < 2 && <i className="h-px w-4 bg-fg/20" />}
            </span>
          ))}
        </span>
      );
      break;
    case "promotions":
      art = (
        <span className="grid h-full place-items-center">
          <i className="rounded-[8px] px-2 py-1 text-[10px] font-bold not-italic" style={{ background: "var(--t)", color: "var(--t-ink)" }}>
            10% OFF
          </i>
        </span>
      );
      break;
    default:
      art = (
        <span className="grid h-full content-center gap-1">
          {[60, 85, 45, 70].map((w, j) => (
            <i key={j} className="h-1.5 rounded-full" style={{ width: `${w}%`, background: j % 2 ? "var(--t)" : "color-mix(in srgb, var(--fg) 10%, transparent)" }} />
          ))}
        </span>
      );
  }
  return (
    <span className={`tint-${m.tint} ob-chip grid h-[104px] min-w-0 grid-rows-[auto_1fr] gap-2 rounded-[14px] bg-fg/[0.03] p-2.5 ring-1 ring-fg/[0.05]`}>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold">
        <span className="tint-chip grid size-5 place-items-center rounded-[6px]">
          <ModuleGlyph id={id} className="size-3" />
        </span>
        <span className="min-w-0 truncate">{m.name}</span>
      </span>
      {art}
    </span>
  );
}

// ─── Build ───────────────────────────────────────────────────────────────────

type Task = { id: "answers" | "modules" | "project" | "venue" | "dash" | `setup:${ModuleId}`; label: string };

function Build(p: { name: string; brief: string; industry: Industry; modules: ModuleId[]; partsOff: PartsOff; canManage: boolean; orgId: string; onDone: (projectId: string | null) => void; onBack: () => void }) {
  const [done, setDone] = useState(0);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const project = useRef<string | null>(null);
  const ind = p.industry;
  // Hospitality gets its venue ready straight away: tables, QR codes and settings.
  const venue = !!ind.venue && p.modules.includes("horeca") && p.canManage;
  const tasks: Task[] = [
    { id: "answers", label: "Saving what you told us" },
    ...(p.canManage ? [{ id: "modules" as const, label: `Switching on ${p.modules.length} feature${p.modules.length === 1 ? "" : "s"}${ind.id === "other" ? "" : ` for your ${ind.label.toLowerCase()}`}` }] : []),
    // Each picked module gets what it needs to be useful from the first click.
    ...(p.canManage ? p.modules.map((m) => ({ id: `setup:${m}` as const, label: SETUP_LABEL[m] })) : []),
    ...(venue
      ? [
          { id: "project" as const, label: `Creating ${p.name}'s workspace` },
          { id: "venue" as const, label: ind.venue === "hotel" ? "Setting up your restaurant, rooms and QR menu" : "Laying out 10 tables with their own QR codes" },
        ]
      : []),
    { id: "dash", label: "Arranging your dashboard" },
  ];
  useEffect(() => {
    let cancelled = false;
    const run = async (id: Task["id"]) => {
      if (id === "answers") {
        await api("/api/v1/auth/onboarding", { method: "PUT", body: { name: p.name, brief: p.brief || undefined, kind: ind.launch.kind, intent: ind.launch.kind, category: ind.launch.category, sells: ind.sells, goals: goalsFor(p.modules, ind), complete: true } });
      } else if (id === "modules") {
        await api(`/api/v1/orgs/${p.orgId}/modules`, { method: "PUT", body: { modules: p.modules, industry: ind.id, partsOff: p.partsOff } });
      } else if (id.startsWith("setup:")) {
        await api(`/api/v1/orgs/${p.orgId}/modules/setup`, { method: "POST", body: { module: id.slice(6) } });
      } else if (id === "project") {
        if (project.current) return;
        const r = await api<{ project: { id: string } }>(`/api/v1/orgs/${p.orgId}/projects`, { method: "POST", body: { templateId: "blank", name: p.name } });
        project.current = r.project.id;
      } else if (id === "venue") {
        const base = `/api/v1/projects/${project.current}/horeca`;
        const v = await api<{ venue: unknown }>(`${base}/venue`);
        if (v.venue) return;
        await api(`${base}/venue`, { method: "PUT", body: { name: p.name, kind: ind.venue, taxBps: 500, serviceChargeBps: 0 } });
        const { area } = await api<{ area: { id: string } }>(`${base}/areas`, { method: "POST", body: { name: ind.venue === "hotel" ? "Restaurant" : "Main floor" } });
        await api(`${base}/tables/bulk`, { method: "POST", body: { areaId: area.id, prefix: "T", count: 10, seats: 4 } });
      }
    };
    (async () => {
      for (let i = done; i < tasks.length; i++) {
        const started = Date.now();
        try {
          await run(tasks[i].id);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e));
          return;
        }
        // Each step stays on screen long enough to read (module setups are quicker).
        const wait = (tasks[i].id.startsWith("setup:") ? 260 : 650) - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (cancelled) return;
        setDone(i + 1);
      }
      if (!cancelled) setTimeout(() => p.onDone(project.current), 450);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per attempt, resuming after the last finished step
  }, [attempt]);
  const len = 2 * Math.PI * 52;
  const pct = done / tasks.length;
  return (
    <section className="ob-screen mx-auto grid w-full max-w-xl justify-items-center gap-8 text-center" aria-live="polite">
      <div className="relative grid size-40 place-items-center">
        <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r="52" fill="none" stroke="color-mix(in srgb, var(--fg) 8%, transparent)" strokeWidth="8" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#ob-grad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - pct)} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.16,1,.3,1)" }} />
          <defs>
            <linearGradient id="ob-grad" x1="0" x2="1">
              <stop offset="0" stopColor="var(--p-peach-ink)" />
              <stop offset=".5" stopColor="var(--p-lavender-ink)" />
              <stop offset="1" stopColor="var(--p-mint-ink)" />
            </linearGradient>
          </defs>
        </svg>
        <span className="grid size-24 place-items-center rounded-full bg-[var(--surface-solid)] shadow-[0_20px_50px_-24px_rgb(40_20_80/0.5)]">
          {done >= tasks.length ? <Check className="size-10 text-[var(--p-mint-ink)]" /> : <LogoMark className="size-10" />}
        </span>
      </div>
      <Heading eyebrow="Step 4 of 4 · Setting up" title={done >= tasks.length ? "All set" : `Setting up ${p.name}`} sub="This is happening for real — nothing here is a placeholder." />
      <ol className="p-glass grid w-full gap-1 rounded-[24px] p-3 text-left">
        {tasks.map((t, i) => {
          const state = i < done ? "done" : i === done && !error ? "now" : i === done && error ? "error" : "next";
          return (
            <li key={t.id} className={clsx("flex items-center gap-3 rounded-[14px] px-3 py-2.5 transition-all duration-500", state === "now" && "bg-fg/[0.04]", state === "next" && "opacity-40")}>
              <span className={clsx("grid size-7 shrink-0 place-items-center rounded-full transition-all duration-500", state === "done" ? "bg-[var(--p-mint)] text-[var(--p-mint-ink)]" : state === "error" ? "bg-danger-soft text-danger" : "bg-fg/[0.06] text-fg/50")}>
                {state === "done" ? <Check className="size-4" /> : state === "now" ? <Loader2 className="size-4 animate-spin" /> : <span className="text-[12px] font-semibold">{i + 1}</span>}
              </span>
              <span className="text-[14px] font-medium">{t.label}</span>
            </li>
          );
        })}
      </ol>
      {error && (
        <div className="grid gap-3">
          <p className="text-[14px] text-danger">{error}</p>
          <div className="flex justify-center gap-3">
            <button type="button" onClick={p.onBack} className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] text-fg/60 hover:text-fg">
              <ArrowLeft className="size-4" /> Back
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setAttempt((a) => a + 1);
              }}
              className="p-cta inline-flex items-center gap-2 px-6"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Ready ───────────────────────────────────────────────────────────────────

function Ready({ name, industry, modules, projectId }: { name: string; industry: Industry; modules: ModuleId[]; projectId: string | null }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const open = (href: string) => {
    setLeaving(true);
    setTimeout(() => router.push(href), 250);
  };
  const store = industry.launch.kind === "store";
  const primary = projectId
    ? { label: "Open Cloudesk for Horeca", sub: "Your tables and QR codes are ready — add your menu next", href: `/projects/${projectId}/horeca` }
    : { label: store ? "Build my online store" : "Build my website", sub: store ? "About 3 minutes, from your design to live" : modules.includes("store") ? "About 3 minutes. Add your online store to it afterwards, in the same design." : "About 3 minutes, from your design to live", href: `/launch?from=onboarding&kind=${industry.launch.kind}` };
  const secondary = projectId ? { label: "Design my website", href: `/projects/${projectId}/builder` } : { label: "Explore my dashboard first", href: "/home" };
  return (
    <section className={clsx("ob-screen grid w-full items-center gap-10 transition-all duration-300 lg:grid-cols-[1fr_1.1fr]", leaving && "scale-[0.98] opacity-0 blur-sm")}>
      <Confetti />
      <div className="grid gap-6 text-center lg:text-left">
        <p className="p-in text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Your workspace is ready</p>
        <h1 className="p-in text-[clamp(2.2rem,5vw,3.8rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance" style={{ animationDelay: "80ms" }}>
          Welcome to {name}&apos;s Cloudesk.
        </h1>
        <p className="p-in mx-auto max-w-md text-[16px] leading-relaxed text-fg/60 lg:mx-0" style={{ animationDelay: "160ms" }}>
          Your dashboard has {modules.length} feature{modules.length === 1 ? "" : "s"} {industry.id === "other" ? "you picked" : `picked for your ${industry.label.toLowerCase()}`}, plus everything every business gets. Nothing else to clutter it.
        </p>
        <div className="p-in flex flex-wrap justify-center gap-1.5 lg:justify-start" style={{ animationDelay: "220ms" }}>
          {modules.map((id, i) => {
            const m = moduleById(id)!;
            return (
              <span key={id} className={`tint-${m.tint} ob-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold`} style={{ background: "var(--t)", color: "var(--t-ink)", animationDelay: `${300 + i * 70}ms` }}>
                <ModuleGlyph id={id} className="size-3.5" />
                {m.name}
              </span>
            );
          })}
        </div>
        <div className="p-in grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-center lg:justify-start" style={{ animationDelay: "320ms" }}>
          <button type="button" autoFocus onClick={() => open(primary.href)} className="p-cta lx-sheen inline-flex items-center justify-center gap-2 px-8">
            <Sparkles className="size-4" /> {primary.label}
          </button>
          <button type="button" onClick={() => open(secondary.href)} className="p-glass inline-flex h-[50px] items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold">
            {secondary.label} <ArrowRight className="size-4" />
          </button>
        </div>
        <p className="p-in text-[13px] text-fg/50" style={{ animationDelay: "380ms" }}>
          {primary.sub}
        </p>
      </div>
      <div className="p-in" style={{ animationDelay: "200ms" }}>
        <DashPreview name={name} industry={industry} modules={modules} big />
      </div>
    </section>
  );
}

/** A short CSS confetti burst (skipped for reduced motion by the global rule). */
export function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 60 }, (_, i) => ({
      x: `${Math.round((Math.random() - 0.5) * 120)}vw`,
      y: `${Math.round(30 + Math.random() * 70)}vh`,
      r: `${Math.round((Math.random() - 0.5) * 900)}deg`,
      c: ["#a2502a", "#5b48b0", "#1f7a55", "#2d6db5", "#c08a12", "#b03a6b"][i % 6],
      d: Math.random() * 0.25,
    })),
  );
  return (
    <div className="lx-confetti" aria-hidden>
      {pieces.map((q, i) => (
        <i key={i} style={{ background: q.c, animationDelay: `${q.d}s`, ["--x" as string]: q.x, ["--y" as string]: q.y, ["--r" as string]: q.r }} />
      ))}
    </div>
  );
}

export function Heading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="grid gap-3 text-center max-sm:gap-1.5 max-sm:text-left">
      <p className="p-in text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase max-sm:text-[10.5px] max-sm:tracking-[0.16em]">{eyebrow}</p>
      <h1 className="p-in text-[clamp(2rem,4.6vw,3.1rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance max-sm:text-[26px] max-sm:leading-[1.1] max-sm:tracking-[-0.035em]" style={{ animationDelay: "60ms" }}>
        {title}
      </h1>
      {sub && (
        <p className="p-in mx-auto max-w-xl text-[16px] leading-relaxed text-fg/60 max-sm:hidden" style={{ animationDelay: "120ms" }}>
          {sub}
        </p>
      )}
    </div>
  );
}
