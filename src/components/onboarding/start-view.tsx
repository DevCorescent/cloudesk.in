"use client";

// Public sign-up (/start): the same onboarding as /welcome — the business, a
// few quick questions, the features — then a plan for after the free trial,
// the account details, and a six-digit code emailed to confirm the address.
// The code creates the account and the workspace with everything chosen here;
// the person then signs in. Answers survive a refresh (sessionStorage, never
// the password) and are cleared once the account exists.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, Eye, Gift, Loader2, LogIn, MailCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PasswordInput } from "@/components/auth-form";
import { Wordmark } from "@/components/brand";
import { CouponField } from "@/components/billing/coupon";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { OtpInput, useCountdown } from "@/components/otp-input";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { Field, Notice } from "@/components/ui/primitives";
import { money, type Interval } from "@/lib/billing/catalog";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { profileFor, recommend, type Profile } from "@/lib/onboarding/recommend";
import { goalsFor, industryById, moduleById, neededBy, withRequirements, type IndustryId, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { ChoosePlan, customFrom, featureName, priceOf, toChoice, type Catalog, type PlanPick } from "./choose-plan";
import { Plan, PlanSummary, Questions } from "./steps";
import { Business, Confetti, DashPreview, Heading, PlanAside, StepProgress, suggestIndustry, Welcome } from "./welcome-view";

type Screen = "welcome" | "business" | "questions" | "features" | "plan" | "account" | "verify" | "done";
const STEPS: { screen: Screen; label: string }[] = [
  { screen: "business", label: "Your business" },
  { screen: "questions", label: "Quick questions" },
  { screen: "features", label: "Features" },
  { screen: "plan", label: "Plan" },
  { screen: "account", label: "Your account" },
  { screen: "verify", label: "Confirm email" },
];
const KEY = "cloudesk:start";
const planLabel = (q: { planId: string; name: string }) => (q.planId === "custom" ? "your own plan" : `the ${q.name} plan`);
const RESEND_MS = 30_000;

/** What survives a refresh. Never the password or a code. */
type Saved = {
  screen: Screen;
  name: string;
  brief: string;
  picked: IndustryId | null;
  answers: Profile | null;
  chosen: ModuleId[] | null;
  partsOff: PartsOff;
  pick: PlanPick | null;
  interval: Interval;
  person: string;
  email: string;
  workspace: string | null;
  terms: boolean;
  ticket: string | null;
  sentAt: number;
};

function load(): Partial<Saved> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Saved>) : null;
  } catch {
    return null;
  }
}
function store(s: Saved | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private windows and blocked storage: the flow still works, it just won't survive a refresh.
  }
}

/** Arriving from /pricing: a plan, or features to build a plan from (already validated by the page). */
export type Preselect = { plan: string | null; build: ModuleId[] | null; seats: number | null; interval: Interval | null };

export function StartView({ industry: initialIndustry, preselect, next, termsUrl, privacyUrl }: { industry: IndustryId | null; preselect: Preselect; next: string | null; termsUrl: string; privacyUrl: string }) {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  // Arriving from a business page (/for/…) pre-picks that industry.
  const [picked, setPicked] = useState<IndustryId | null>(initialIndustry);
  const suggested = useMemo(() => suggestIndustry(`${name} ${brief}`), [name, brief]);
  const industryId = picked ?? suggested;
  const industry = industryById(industryId);
  const derived = useMemo(() => profileFor(industryId, brief), [industryId, brief]);
  const [answers, setAnswers] = useState<Profile | null>(null);
  const profile = answers ?? derived.profile;
  const rec = useMemo(() => recommend(profile, industryId), [profile, industryId]);
  const [chosen, setChosen] = useState<ModuleId[] | null>(null);
  // Features picked on /pricing are switched on alongside the recommendation.
  const modules = chosen ?? (preselect.build ? withRequirements([...new Set([...rec.modules, ...preselect.build])]) : rec.modules);
  const [partsOff, setPartsOff] = useState<PartsOff>({});
  const [pick, setPick] = useState<PlanPick | null>(() => (preselect.plan ? { kind: "plan", planId: preselect.plan } : preselect.build ? { kind: "custom", modules: preselect.build, seats: preselect.seats ?? 0 } : null));
  const [interval, setInterval] = useState<Interval>(preselect.interval ?? "month");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; workspace: string } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [restored, setRestored] = useState(false);

  const catalog = useQuery({ queryKey: ["plans-catalog"], queryFn: () => api<Catalog>("/api/v1/plans"), staleTime: 5 * 60_000 });
  // Building your own, from the features chosen, is the natural default.
  const plan: PlanPick = useMemo(() => {
    const c = catalog.data;
    if (!c) return pick ?? { kind: "later" };
    // A plan from a link that isn't on sale (any more) falls back to the default; seats never go below what's included.
    if (pick?.kind === "plan" && !c.plans.some((x) => x.id === pick.planId)) return customFrom(modules, c.pricing);
    if (pick?.kind === "custom") return { ...pick, modules: pick.modules.filter((m) => !c.pricing.customBaseModules.includes(m)), seats: Math.max(pick.seats, c.pricing.customSeatsIncluded) };
    return pick ?? customFrom(modules, c.pricing);
  }, [pick, catalog.data, modules]);
  const priced = catalog.data ? priceOf(plan, interval, catalog.data) : null;
  const workspaceName = workspace ?? name.trim();

  // Pick up where a refresh left off.
  useEffect(() => {
    const s = load();
    if (s) {
      /* eslint-disable react-hooks/set-state-in-effect -- read once after mount; storage isn't there during server rendering */
      if (s.screen && s.screen !== "done") setScreen(s.screen === "verify" && !s.ticket ? "account" : s.screen);
      setName(s.name ?? "");
      setBrief(s.brief ?? "");
      if (s.picked !== undefined) setPicked(s.picked);
      setAnswers(s.answers ?? null);
      setChosen(s.chosen ?? null);
      setPartsOff(s.partsOff ?? {});
      // A plan chosen on /pricing just now wins over an older, half-finished sign-up.
      if (!preselect.plan && !preselect.build) {
        setPick(s.pick ?? null);
        setInterval(s.interval === "year" ? "year" : "month");
      }
      setPerson(s.person ?? "");
      setEmail(s.email ?? "");
      setWorkspace(s.workspace ?? null);
      setTerms(!!s.terms);
      setTicket(s.ticket ?? null);
      setSentAt(s.sentAt ?? 0);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  useEffect(() => {
    if (!restored || screen === "done") return;
    if (screen === "welcome" && !name && !brief) return;
    store({ screen, name, brief, picked, answers, chosen, partsOff, pick, interval, person, email, workspace, terms, ticket, sentAt });
  }, [restored, screen, name, brief, picked, answers, chosen, partsOff, pick, interval, person, email, workspace, terms, ticket, sentAt]);

  const stepIdx = STEPS.findIndex((x) => x.screen === screen);
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
  const toggle = (id: ModuleId) => {
    setChosen(modules.includes(id) ? modules.filter((m) => m !== id && !neededBy(id, modules).includes(m)) : withRequirements([...modules, id]));
    // A plan built from the earlier features follows them again.
    if (pick?.kind === "custom") setPick(null);
  };
  const changed = !!chosen && (chosen.length !== rec.modules.length || chosen.some((m) => !rec.modules.includes(m)));
  const businessReady = name.trim().length >= 2 && !!industry;
  const planNote = plan.kind === "later" ? `Free for ${catalog.data?.pricing.trialDays ?? 30} days · choose a plan later` : priced ? `After the trial: ${planLabel(priced)} · ${money(priced.monthly, priced.currency)}/month${interval === "year" ? ", billed yearly" : ""} + tax` : "Choose what comes after the trial";
  const footer =
    screen === "business"
      ? { back: () => go("welcome"), next: () => go("questions"), label: "Continue", disabled: !businessReady, note: !name.trim() ? "Add your business name" : !industry ? "Pick the closest industry" : `${industry.label} · ${rec.modules.length} features so far` }
      : screen === "questions"
        ? { back: () => go("business"), next: () => (setChosen(null), go("features")), label: "See my features", disabled: false, note: `${rec.modules.length} feature${rec.modules.length === 1 ? "" : "s"} recommended` }
        : screen === "features"
          ? { back: () => go("questions"), next: () => go("plan"), label: "Choose my plan", disabled: !modules.length, note: `${modules.length} feature${modules.length === 1 ? "" : "s"} · change any time in Settings → Features` }
          : screen === "plan"
            ? { back: () => go("features"), next: () => go("account"), label: "Continue", disabled: !!catalog.data && plan.kind !== "later" && !priced, note: planNote }
            : null;
  const fromBusiness = industry && (screen === "questions" || screen === "features");

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
          <Link href="/" aria-label="Cloudesk home">
            <Wordmark className="text-[22px]" />
          </Link>
          {screen !== "welcome" && <StepProgress labels={STEPS.map((x) => x.label)} index={stepIdx} finished={screen === "done"} />}
          {screen !== "done" ? (
            <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-[13px] whitespace-nowrap text-fg/55 transition-colors hover:text-fg">
              <span className="hidden sm:inline">Have an account? </span>Sign in
            </Link>
          ) : (
            <span className="w-16" />
          )}
        </div>
        {screen !== "welcome" && (
          <div className="h-0.5 bg-fg/[0.05] md:hidden" aria-hidden>
            <div className="h-full bg-gradient-to-r from-[#FF5A5F] to-[#FDBA5A] transition-[width] duration-700" style={{ width: `${((Math.max(stepIdx, 0) + (screen === "done" ? 1 : 0.5)) / STEPS.length) * 100}%` }} />
          </div>
        )}
      </header>

      <main className={clsx("relative z-10 mx-auto max-w-[1320px] px-4 sm:px-8", footer ? "pt-8 pb-32 sm:pt-10" : "flex min-h-[calc(100dvh-4rem)] flex-col justify-center py-10")}>
        {screen === "welcome" && (
          <Welcome
            eyebrow="Start free · no card needed"
            onStart={() => go("business")}
            time="About 3 minutes"
            steps={[
              ["Your business", "Name, a line about it, your industry", "20 sec"],
              ["Quick questions and features", "Already answered for you — just check", "1 min"],
              ["Your plan", `Free for ${catalog.data?.pricing.trialDays ?? 30} days, then what you pick`, "30 sec"],
              ["Your account", "Your details and a code we email you", "1 min"],
            ]}
          />
        )}
        {screen === "business" && <Business eyebrow="Step 1 of 6 · Your business" name={name} setName={setName} brief={brief} setBrief={setBrief} industryId={industryId} suggested={!picked && !!suggested} onPick={pickIndustry} heard={derived.heard} />}
        {screen === "questions" && industry && (
          <>
            <Heading eyebrow={`Step 2 of 6 · ${industry.label}`} title="A few quick questions" sub="We've pre-answered them for a business like yours. Tap to change anything — the features update as you go." />
            <div className="mt-8">
              <Questions profile={profile} onChange={setAnswers} rec={rec} heard={derived.heard} industryLabel={industry.label} aside={<PlanSummary rec={rec} title="Features so far" />} />
            </div>
          </>
        )}
        {screen === "features" && industry && (
          <>
            <Heading eyebrow="Step 3 of 6 · Your features" title={`${name.trim() || "Your"}'s workspace`} sub="Here's what we recommend, and why. Switch anything off, leave out parts you won't use, or add more." />
            <div className="mt-8">
              <Plan
                rec={rec}
                modules={modules}
                partsOff={partsOff}
                onToggle={toggle}
                onPart={(id, part, on) => setPartsOff((p) => ({ ...p, [id]: on ? (p[id] ?? []).filter((x) => x !== part) : [...(p[id] ?? []), part] }))}
                onReset={() => (setChosen(null), setPartsOff({}), pick?.kind === "custom" && setPick(null))}
                changed={changed}
                aside={<PlanAside name={name.trim()} industry={industry} modules={modules} />}
              />
            </div>
          </>
        )}
        {screen === "plan" && (
          <>
            <Heading eyebrow="Step 4 of 6 · Your plan" title="Choose your plan" sub="Try everything first. This is only what you'll be on when the free trial ends." />
            <div className="mx-auto mt-8 max-w-[1180px]">
              {catalog.data ? (
                <ChoosePlan catalog={catalog.data} chosen={modules} pick={plan} onPick={setPick} interval={interval} onInterval={setInterval} />
              ) : catalog.isError ? (
                <Notice tone="warning" title="Plans couldn't be loaded">
                  {errorMessage(catalog.error)} You can carry on and choose a plan before the trial ends.
                </Notice>
              ) : (
                <p className="flex items-center justify-center gap-2 py-16 text-[14px] text-fg/55">
                  <Loader2 className="size-4 animate-spin" /> Loading plans…
                </p>
              )}
              <TrustStrip compact className="mt-8" />
            </div>
          </>
        )}
        {screen === "account" && (
          <Account
            person={person}
            setPerson={setPerson}
            email={email}
            setEmail={setEmail}
            workspace={workspaceName}
            setWorkspace={setWorkspace}
            terms={terms}
            setTerms={setTerms}
            termsUrl={termsUrl}
            privacyUrl={privacyUrl}
            summary={<Summary name={workspaceName} industryLabel={industry?.label} modules={modules} planNote={plan.kind === "later" ? "You'll choose a plan before the trial ends" : planNote.replace(/^After the trial: /, "")} trialDays={catalog.data?.pricing.trialDays ?? 30} />}
            onBack={() => go("plan")}
            body={(password) => ({
              name: person.trim(),
              email: email.trim(),
              password,
              workspaceName,
              industry: industryId ?? undefined,
              modules,
              partsOff,
              onboarding: industry
                ? { name: workspaceName.slice(0, 80), brief: brief.trim() || undefined, kind: industry.launch.kind, intent: industry.launch.kind, category: industry.launch.category, sells: industry.sells, goals: goalsFor(modules, industry) }
                : { name: workspaceName.slice(0, 80), brief: brief.trim() || undefined },
              choice: toChoice(plan, interval),
              acceptTerms: true,
            })}
            onSent={(r) => {
              setTicket(r.ticket);
              setEmail(r.email);
              setSentAt(Date.now());
              setDevCode(r.devCode ?? null);
              go("verify");
            }}
            next={next}
          />
        )}
        {screen === "verify" && ticket && (
          <Verify
            email={email}
            ticket={ticket}
            sentAt={sentAt}
            devCode={devCode}
            onResent={(r) => {
              setTicket(r.ticket);
              setSentAt(Date.now());
              setDevCode(r.devCode ?? null);
            }}
            onChangeEmail={() => go("account")}
            onDone={(r) => {
              store(null);
              setDone(r);
              go("done");
            }}
          />
        )}
        {screen === "done" && done && <Done result={done} industryId={industryId} modules={modules} planNote={plan.kind === "later" || !priced ? null : `${planLabel(priced)} · ${money(priced.monthly, priced.currency)}/month${interval === "year" ? ", billed yearly" : ""} + tax`} trialDays={catalog.data?.pricing.trialDays ?? 30} next={next} />}
      </main>

      {footer && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-fg/[0.06] bg-[color-mix(in_srgb,var(--p-canvas)_80%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-3 sm:px-8">
            <button type="button" onClick={footer.back} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] text-fg/55 transition-colors hover:text-fg">
              <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back</span>
            </button>
            <p className={clsx("min-w-0 flex-1 truncate text-[13px] text-fg/55", fromBusiness && "max-lg:invisible")} aria-live="polite">{footer.note}</p>
            {fromBusiness && (
              <button type="button" onClick={() => setSheet(true)} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium ring-1 ring-fg/10 lg:hidden">
                <Eye className="size-4" /> {screen === "features" ? modules.length : rec.modules.length} · Preview
              </button>
            )}
            <button type="button" disabled={footer.disabled} onClick={footer.next} className="p-cta lx-sheen inline-flex items-center gap-2 px-5 sm:px-7">
              {footer.label} <ArrowRight className="size-4" />
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
            {screen === "questions" ? <PlanSummary rec={rec} title="Features so far" /> : <PlanAside name={name.trim()} industry={industry} modules={modules} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── What they chose, beside the account form ───────────────────────────────

function Summary({ name, industryLabel, modules, planNote, trialDays }: { name: string; industryLabel?: string; modules: ModuleId[]; planNote: string; trialDays: number }) {
  return (
    <div className="p-glass grid gap-4 rounded-[24px] p-5">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] text-fg/45 uppercase">Your workspace</p>
        <p className="mt-1 text-[20px] font-semibold tracking-[-0.02em]">{name || "Your business"}</p>
        {industryLabel && <p className="text-[13px] text-fg/55">{industryLabel}</p>}
      </div>
      <div>
        <p className="mb-2 text-[12.5px] font-semibold text-fg/60">
          {modules.length} feature{modules.length === 1 ? "" : "s"}, set up for you
        </p>
        <div className="flex flex-wrap gap-1.5">
          {modules.map((id) => {
            const m = moduleById(id);
            if (!m) return null;
            return (
              <span key={id} className={`tint-${m.tint} inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium`} style={{ background: "var(--t)", color: "var(--t-ink)" }}>
                <ModuleGlyph id={id} className="size-3" />
                {m.name}
              </span>
            );
          })}
        </div>
      </div>
      <div className="grid gap-1.5 border-t border-fg/[0.06] pt-4 text-[13px]">
        <p className="flex items-start gap-2">
          <Gift className="mt-0.5 size-4 shrink-0 text-[var(--p-mint-ink)]" />
          <span>
            <b className="font-semibold">Free for {trialDays} days</b> — every feature, no card needed.
          </span>
        </p>
        <p className="flex items-start gap-2 text-fg/65">
          <Check className="mt-0.5 size-4 shrink-0 text-fg/40" />
          <span>After the trial: {planNote}</span>
        </p>
      </div>
    </div>
  );
}

// ─── Create your account ─────────────────────────────────────────────────────

type Sent = { ticket: string; email: string; expiresAt: string; devCode?: string };

function Account(p: {
  person: string;
  setPerson: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  workspace: string;
  setWorkspace: (v: string) => void;
  terms: boolean;
  setTerms: (v: boolean) => void;
  termsUrl: string;
  privacyUrl: string;
  summary: React.ReactNode;
  onBack: () => void;
  body: (password: string) => Record<string, unknown>;
  onSent: (r: Sent) => void;
  next: string | null;
}) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<{ message: string; exists?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [coupon, setCoupon] = useState("");
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const local: Record<string, string[]> = {};
    if (!p.person.trim()) local.name = ["Enter your name"];
    if (!/^\S+@\S+\.\S+$/.test(p.email.trim())) local.email = ["Enter a valid email address"];
    if (password.length < 10) local.password = ["Use at least 10 characters"];
    else if (!/[a-zA-Z]/.test(password) || !/[0-9\W]/.test(password)) local.password = ["Mix letters with numbers or symbols"];
    if (!p.workspace.trim()) local.workspaceName = ["Name your business"];
    if (!p.terms) local.acceptTerms = ["Please accept the terms to continue"];
    setErrors(local);
    setError(null);
    if (Object.keys(local).length) return;
    setLoading(true);
    try {
      p.onSent(await api<Sent>("/api/v1/auth/signup/start", { method: "POST", body: { ...p.body(password), ...(coupon ? { coupon } : {}) } }));
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fieldErrors());
        if (err.code !== "validation_failed") setError({ message: err.message, exists: err.status === 409 });
        else if (!Object.keys(err.fieldErrors()).length) setError({ message: err.message });
      } else setError({ message: "Could not send the code. Try again." });
      setLoading(false);
    }
  }
  const login = `/login?email=${encodeURIComponent(p.email.trim())}${p.next ? `&next=${encodeURIComponent(p.next)}` : ""}`;
  const link = (href: string, label: string) => (href ? <a href={href} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">{label}</a> : label);
  return (
    <section className="ob-screen mx-auto grid w-full max-w-[1000px] gap-8">
      <Heading eyebrow="Step 5 of 6 · Your account" title="Create your account" sub="Last step. We'll email you a 6-digit code to confirm the address, then set everything up." />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <form onSubmit={onSubmit} noValidate className="p-glass p-in grid gap-4 rounded-[28px] p-5 sm:p-7" style={{ animationDelay: "100ms" }}>
          {error && (
            <Notice tone="danger" action={error.exists ? <Link href={login} className="text-[13px] font-semibold text-fg underline underline-offset-2">Sign in instead</Link> : undefined}>
              {error.message}
            </Notice>
          )}
          <Field label="Your name" error={errors.name?.[0]}>{(a) => <input {...a} className="p-input" name="name" autoComplete="name" value={p.person} onChange={(e) => p.setPerson(e.target.value)} maxLength={100} autoFocus />}</Field>
          <Field label="Work email" error={errors.email?.[0]}>{(a) => <input {...a} className="p-input" name="email" type="email" autoComplete="email" value={p.email} onChange={(e) => p.setEmail(e.target.value)} maxLength={200} />}</Field>
          <Field label="Password" hint="At least 10 characters, with a number or symbol." error={errors.password?.[0]}>
            {(a) => <PasswordInput id={a.id} name="password" autoComplete="new-password" strength invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]} />}
          </Field>
          <Field label="Business name" hint="Your workspace's name — you can change it later." error={errors.workspaceName?.[0]}>{(a) => <input {...a} className="p-input" name="workspaceName" autoComplete="organization" value={p.workspace} onChange={(e) => p.setWorkspace(e.target.value)} maxLength={80} />}</Field>
          <CouponField value={coupon} onChange={(v) => (setCoupon(v), errors.coupon && setErrors((x) => ({ ...x, coupon: [] })))} error={errors.coupon?.[0]} />
          <div className="grid gap-1">
            <label className="flex items-start gap-2.5 text-[13.5px] leading-snug text-fg/70">
              <input type="checkbox" checked={p.terms} onChange={(e) => (p.setTerms(e.target.checked), e.target.checked && setErrors((x) => ({ ...x, acceptTerms: [] })))} aria-invalid={!!errors.acceptTerms?.[0] || undefined} aria-describedby={errors.acceptTerms?.[0] ? "terms-error" : undefined} className="mt-0.5 size-4 shrink-0 accent-[var(--fg)]" />
              <span>
                I agree to the {link(p.termsUrl, "Terms of Service")} and {link(p.privacyUrl, "Privacy Policy")}.
              </span>
            </label>
            {errors.acceptTerms?.[0] && <p id="terms-error" className="pl-6.5 text-[12px] text-danger">{errors.acceptTerms[0]}</p>}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <button type="button" onClick={p.onBack} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] text-fg/55 transition-colors hover:text-fg">
              <ArrowLeft className="size-4" /> Back
            </button>
            <button type="submit" disabled={loading} className="p-cta lx-sheen ml-auto inline-flex items-center gap-2 px-6 sm:px-8">
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue <ArrowRight className="size-4" />
            </button>
          </div>
        </form>
        <div className="p-in" style={{ animationDelay: "180ms" }}>
          {p.summary}
        </div>
      </div>
    </section>
  );
}

// ─── Check your email ────────────────────────────────────────────────────────

function Verify({ email, ticket, sentAt, devCode, onResent, onChangeEmail, onDone }: { email: string; ticket: string; sentAt: number; devCode: string | null; onResent: (r: Sent) => void; onChangeEmail: () => void; onDone: (r: { email: string; workspace: string }) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<{ message: string; restart?: boolean; exists?: boolean } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const wait = useCountdown(sentAt + RESEND_MS);
  async function verify(c: string) {
    setBusy("verify");
    setError(null);
    setInfo(null);
    try {
      onDone(await api<{ email: string; workspace: string }>("/api/v1/auth/signup/verify", { method: "POST", body: { ticket, code: c } }));
    } catch (e) {
      const message = errorMessage(e);
      setError({ message, restart: /start again/i.test(message), exists: e instanceof ApiClientError && e.status === 409 });
      setCode("");
      setBusy(null);
    }
  }
  async function resend() {
    setBusy("resend");
    setError(null);
    setInfo(null);
    try {
      onResent(await api<Sent>("/api/v1/auth/signup/resend", { method: "POST", body: { ticket } }));
      setCode("");
      setInfo("A new code is on its way. The old one no longer works.");
    } catch (e) {
      const message = errorMessage(e);
      setError({ message, restart: /start again/i.test(message) });
    }
    setBusy(null);
  }
  return (
    <section className="ob-screen mx-auto grid w-full max-w-[460px] gap-6">
      <div className="p-glass p-in grid gap-5 rounded-[28px] p-6 text-center sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-[18px] bg-[var(--p-sky)] text-[var(--p-sky-ink)]">
          <MailCheck className="size-6" />
        </span>
        <div className="grid gap-2">
          <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Step 6 of 6 · Confirm your email</p>
          <h1 className="text-[clamp(1.8rem,4vw,2.4rem)] leading-[1.05] font-semibold tracking-[-0.04em]">Check your email</h1>
          <p className="text-[15px] leading-relaxed text-fg/60">
            We sent a 6-digit code to <b className="font-semibold break-all text-fg">{email}</b>. Enter it below — it works for 10 minutes.
          </p>
        </div>
        {devCode && (
          <p className="rounded-[14px] border border-dashed border-[var(--p-butter-ink)]/40 bg-[var(--p-butter)] px-3 py-2 text-[13px] text-[var(--p-butter-ink)]">
            Development: your code is <b className="font-mono tracking-[0.15em]">{devCode}</b>
          </p>
        )}
        <OtpInput value={code} onChange={(v) => (setCode(v), error && setError(null))} onComplete={(c) => void verify(c)} disabled={busy === "verify"} invalid={!!error && !error.restart} autoFocus label="6-digit code" describedBy={error ? "otp-error" : undefined} />
        <div className="min-h-[22px]" aria-live="polite">
          {busy === "verify" ? (
            <p className="flex items-center justify-center gap-2 text-[13.5px] text-fg/60">
              <Loader2 className="size-4 animate-spin" /> Creating your workspace…
            </p>
          ) : error ? (
            <div id="otp-error" className="grid gap-2 text-[13.5px] text-danger">
              <p>{error.message}</p>
              {error.exists && <Link href={`/login?email=${encodeURIComponent(email)}`} className="font-semibold text-fg underline underline-offset-2">Sign in instead</Link>}
              {error.restart && (
                <button type="button" onClick={onChangeEmail} className="font-semibold text-fg underline underline-offset-2">
                  Start again
                </button>
              )}
            </div>
          ) : info ? (
            <p className="text-[13.5px] text-[var(--p-mint-ink)]">{info}</p>
          ) : null}
        </div>
        <button type="button" disabled={code.length < 6 || busy !== null} onClick={() => void verify(code)} className="p-cta inline-flex items-center justify-center gap-2">
          Confirm
        </button>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13.5px]">
          {wait > 0 ? (
            <span className="text-fg/50 tabular-nums">Send a new code in {wait}s</span>
          ) : (
            <button type="button" disabled={busy !== null} onClick={() => void resend()} className="inline-flex items-center gap-1.5 font-medium text-fg/75 hover:text-fg disabled:opacity-50">
              {busy === "resend" && <Loader2 className="size-3.5 animate-spin" />} Send a new code
            </button>
          )}
          <span className="text-fg/20" aria-hidden>
            ·
          </span>
          <button type="button" onClick={onChangeEmail} className="font-medium text-fg/75 hover:text-fg">
            Change email
          </button>
        </div>
      </div>
      <p className="text-center text-[12.5px] text-fg/50">Can&apos;t find it? Check your spam or promotions folder.</p>
    </section>
  );
}

// ─── You're all set ─────────────────────────────────────────────────────────

function Done({ result, industryId, modules, planNote, trialDays, next }: { result: { email: string; workspace: string }; industryId: IndustryId | null; modules: ModuleId[]; planNote: string | null; trialDays: number; next: string | null }) {
  const industry = industryById(industryId) ?? industryById("other")!;
  const login = `/login?email=${encodeURIComponent(result.email)}&welcome=1${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return (
    <section className="ob-screen grid w-full items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
      <Confetti />
      <div className="grid gap-6 text-center lg:text-left">
        <p className="p-in text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Your workspace is ready</p>
        <h1 className="p-in text-[clamp(2.2rem,5vw,3.8rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance" style={{ animationDelay: "80ms" }}>
          You&apos;re all set.
        </h1>
        <div className="p-in grid gap-2 text-[16px] leading-relaxed text-fg/65" style={{ animationDelay: "160ms" }}>
          <p>
            <b className="font-semibold text-fg">{result.workspace}</b> is set up. Your {trialDays}-day free trial has started — every feature, no card needed.
          </p>
          <p className="text-[14.5px]">{planNote ? <>After the trial you&apos;ll be on <b className="font-semibold text-fg">{planNote}</b>. You can change it any time.</> : "You'll choose a plan before the trial ends."}</p>
        </div>
        <div className="p-in grid gap-2" style={{ animationDelay: "220ms" }}>
          <p className="text-[12.5px] font-semibold text-fg/55">Set up for you</p>
          <div className="flex flex-wrap justify-center gap-1.5 lg:justify-start">
            {modules.map((id, i) => {
              const m = moduleById(id);
              if (!m) return null;
              return (
                <span key={id} className={`tint-${m.tint} ob-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold`} style={{ background: "var(--t)", color: "var(--t-ink)", animationDelay: `${300 + i * 60}ms` }}>
                  <ModuleGlyph id={id} className="size-3.5" />
                  {featureName(id)}
                </span>
              );
            })}
          </div>
        </div>
        <div className="p-in grid gap-3 sm:flex sm:items-center sm:justify-center lg:justify-start" style={{ animationDelay: "320ms" }}>
          <Link href={login} autoFocus className="p-cta lx-sheen inline-flex items-center justify-center gap-2 px-8">
            <LogIn className="size-4" /> Log in
          </Link>
          <span className="text-[13px] text-fg/55">
            Sign in as <b className="font-medium break-all text-fg/75">{result.email}</b> to start.
          </span>
        </div>
      </div>
      <div className="p-in" style={{ animationDelay: "200ms" }}>
        <DashPreview name={result.workspace} industry={industry} modules={modules} big />
      </div>
    </section>
  );
}
