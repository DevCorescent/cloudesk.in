"use client";

// AI mode before sign-up: the whole of sign-up as a conversation. It asks for
// the business, works out the industry, runs the quick questions (pre-answered
// for that industry), picks the features and the plan, takes the account
// details, confirms the email with a code, creates the workspace and signs the
// person in. It sends exactly what the /start form sends, to the same API.
// Progress survives a refresh (sessionStorage); the password never does.
import { freeFor } from "@/lib/festive";
import clsx from "clsx";
import { ArrowRight, Gift, Loader2, ReceiptIndianRupee, Sparkles, Store, Users } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { OtpInput, useCountdown } from "@/components/otp-input";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { money, type Interval } from "@/lib/billing/catalog";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { profileFor, QUESTION_IDS, QUESTIONS, recommend, type Profile, type QuestionId } from "@/lib/onboarding/recommend";
import { suggestIndustry } from "@/lib/onboarding/suggest";
import { goalsFor, industryById, INDUSTRIES, moduleById, MODULES, withRequirements, type IndustryId, type ModuleId, type Tint } from "@/lib/workspace/modules";
import { customFrom, priceOf, toChoice, type Catalog, type PlanPick } from "@/components/onboarding/choose-plan";
import { AiScreen, type AiInput, type AiMsg, type AiSection } from "./ai-screen";

const TINT: Record<Tint, string> = { peach: "#ff9b7a", lavender: "#a99bff", mint: "#4fd6a0", sky: "#6cc0ff", butter: "#f5c35c", rose: "#ff7aa2" };
const KEY = "cc-ai-onboard";
const RESEND_MS = 30_000;

type Step = "home" | "name" | "brief" | "industry" | "q" | "features" | "plan" | "person" | "email" | "password" | "terms" | "verify" | "exists" | "done";
type Line = { id: string; role: "user" | "assistant"; text: string };
type State = {
  step: Step;
  qi: number;
  intent: "store" | "website" | null;
  name: string;
  brief: string;
  industry: IndustryId | null;
  profile: Profile | null;
  modules: ModuleId[];
  pick: PlanPick | null;
  interval: Interval;
  person: string;
  email: string;
  ticket: string | null;
  sentAt: number;
  devCode: string | null;
  workspace: string | null;
  signedIn: boolean;
  lines: Line[];
};
const START: State = { step: "home", qi: 0, intent: null, name: "", brief: "", industry: null, profile: null, modules: [], pick: null, interval: "month", person: "", email: "", ticket: null, sentAt: 0, devCode: null, workspace: null, signedIn: false, lines: [] };

const FAQ = {
  free: { q: "Is it really free to start?", a: `Yes. Every feature is **free for ${freeFor()}** — no card needed. Before the trial ends you pick a plan, or carry on with fewer features on the Free plan.` },
  team: { q: "Can my team use it too?", a: "Yes. Everyone gets their own sign-in and a role — owner, manager, staff or accountant — so they only see what's theirs. Chat, calendar and tasks are shared." },
};

const QINPUT: Partial<Record<Step, { input: AiInput; placeholder: string }>> = {
  name: { input: "text", placeholder: "Your business name" },
  brief: { input: "text", placeholder: "What your business does" },
  person: { input: "name", placeholder: "Your full name" },
  email: { input: "email", placeholder: "you@yourbusiness.com" },
  password: { input: "password", placeholder: "Choose a password" },
};
const BACK: Partial<Record<Step, Step>> = { brief: "name", industry: "brief", features: "q", plan: "features", person: "plan", email: "person", password: "email", terms: "password" };

let n = 0;
const uid = () => `l${Date.now().toString(36)}${++n}`;
const load = (): State | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? { ...START, ...(JSON.parse(raw) as State) } : null;
  } catch {
    return null;
  }
};
const save = (s: State | null) => {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {}
};
const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const goodPassword = (p: string) => p.length >= 10 && /[a-zA-Z]/.test(p) && /[0-9\W]/.test(p);

export function PublicAiMode({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<State>(START);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [planError, setPlanError] = useState(false);
  const password = useRef("");
  const ready = useRef(false);

  // Carry on where a refresh left off.
  useEffect(() => {
    const saved = load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount; storage isn't there during server rendering
    if (saved) setS(saved.step === "password" || saved.step === "terms" ? { ...saved, step: "password" } : saved);
    ready.current = true;
  }, []);
  useEffect(() => {
    if (ready.current) save(s.step === "home" && !s.lines.length ? null : s);
  }, [s]);
  // The plans, fetched once the conversation gets near them.
  useEffect(() => {
    if (catalog || (s.step !== "features" && s.step !== "plan")) return;
    api<Catalog>("/api/v1/plans").then(setCatalog, () => setPlanError(true));
  }, [s.step, catalog]);

  // ── Conversation helpers ──────────────────────────────────────────────────
  const line = (role: Line["role"], text: string): Line => ({ id: uid(), role, text });
  /** Their answer, then the next question, in one update. */
  const move = (patch: Partial<State>, said: string | null, asked: string) =>
    setS((x) => ({ ...x, ...patch, lines: [...x.lines, ...(said !== null ? [line("user", said)] : []), line("assistant", asked)] }));

  const askName = (patch: Partial<State> = {}, said: string | null = null) => move({ ...patch, step: "name" }, said, "Let's set up your workspace — it takes about two minutes. **What's your business called?**");
  const askBrief = (name: string, said: string | null) => move({ name, step: "brief" }, said, `Nice. What does **${name}** do? A line is plenty — for example, “a bakery in Pune with a shop and online orders”.`);
  const askIndustry = (x: State, patch: Partial<State>, said: string | null) => {
    const guess = suggestIndustry(`${patch.name ?? x.name} ${patch.brief ?? x.brief}`);
    move({ ...patch, step: "industry", industry: guess }, said, guess ? `Sounds like a **${industryById(guess)!.label.toLowerCase()}** business. Is that right?` : "Which of these is closest to your business?");
  };
  const askQuestions = (x: State, industry: IndustryId, said: string | null) => {
    const profile = profileFor(industry, x.brief).profile;
    move({ industry, profile, qi: 0, step: "q" }, said, `Great. **5 quick questions** — I've already ticked what usually fits a ${industryById(industry)!.label.toLowerCase()}. Change anything that's not right.\n\n**1 of 5 · ${QUESTIONS[QUESTION_IDS[0]!].title}**`);
  };
  const askFeatures = (x: State, profile: Profile, said: string) => {
    const modules = recommend(profile, x.industry).modules;
    move({ profile, modules, step: "features" }, said, `Here's what I'd switch on for **${x.name}** — ${modules.length} features. Tap any to leave it out, or add more.`);
  };
  const askPlan = (said: string) => move({ step: "plan" }, said, `Everything is **free for ${freeFor()}**, no card needed. **Which plan should follow the trial?** You can change it any time.`);
  const askPerson = (said: string) => move({ step: "person" }, said, "Almost there — now your account. **What's your name?**");

  const back = () => {
    const to = s.step === "q" && s.qi > 0 ? "q" : s.step === "q" ? "industry" : BACK[s.step];
    if (!to) return;
    if (s.step === "q" && s.qi > 0) return move({ qi: s.qi - 1 }, null, `**${s.qi} of 5 · ${QUESTIONS[QUESTION_IDS[s.qi - 1]!].title}**`);
    const again: Partial<Record<Step, string>> = {
      name: "Sure. **What's your business called?**",
      brief: `What does **${s.name}** do?`,
      industry: "Which of these is closest to your business?",
      q: `**5 of 5 · ${QUESTIONS[QUESTION_IDS[4]!].title}**`,
      features: "Here are the features again — tap to change.",
      plan: "Which plan should follow the trial?",
      person: "What's your name?",
      email: "What's your work email?",
      password: "Choose a password — at least 10 characters, with a number or symbol.",
    };
    move({ step: to, ...(to === "q" ? { qi: 4 } : {}) }, null, again[to] ?? "Okay.");
  };

  // ── Typed answers ─────────────────────────────────────────────────────────
  const onText = (raw: string) => {
    const t = raw.trim();
    if (/^(back|go back|undo)$/i.test(t)) return back();
    switch (s.step) {
      case "home": {
        // A sentence is a description; a few words are a name.
        if (t.split(/\s+/).length > 4) return move({ brief: t, step: "name" }, t, "Got it. **And what's the business called?**");
        return askBrief(t, t);
      }
      case "name":
        if (t.length < 2) return move({}, t, "That's a bit short — what's the business called?");
        if (s.brief) return askIndustry(s, { name: t }, t);
        return askBrief(t, t);
      case "brief":
        return askIndustry(s, { brief: t }, t);
      case "industry": {
        const guess = suggestIndustry(t);
        if (guess) return askQuestions({ ...s, brief: `${s.brief} ${t}` }, guess, t);
        return move({}, t, "I couldn't place that — pick the closest one below.");
      }
      case "person":
        if (t.length < 2) return move({}, t, "What's your full name?");
        return move({ person: t, step: "email" }, t, `Thanks, ${first(t)}. **What's your work email?** I'll send a code there to confirm it.`);
      case "email":
        if (!/^\S+@\S+\.\S+$/.test(t)) return move({}, t, "That doesn't look like an email address — try again?");
        return move({ email: t, step: "password" }, t, "**Choose a password** — at least 10 characters, mixing letters with a number or symbol.");
      case "password":
        if (!goodPassword(t)) return move({}, "•".repeat(Math.min(t.length, 12)), "That one's too weak — use at least 10 characters, with letters and a number or symbol.");
        password.current = t;
        return move({ step: "terms" }, "•".repeat(Math.min(t.length, 12)), `Last thing: **create ${s.name} with these details?** You'll get a 6-digit code at ${s.email}.`);
      default:
        return move({}, t, "Tap one of the options above to carry on — or type **back** to change your last answer.");
    }
  };

  // ── Creating the account ─────────────────────────────────────────────────
  const create = async () => {
    if (!password.current) return move({ step: "password" }, null, "For your security I don't keep passwords across a refresh — **choose your password** again, please.");
    const ind = industryById(s.industry);
    setBusy(true);
    try {
      const r = await api<{ ticket: string; email: string; devCode?: string }>("/api/v1/auth/signup/start", {
        method: "POST",
        body: {
          name: s.person.trim(),
          email: s.email.trim(),
          password: password.current,
          workspaceName: s.name.trim(),
          industry: s.industry ?? undefined,
          modules: s.modules,
          partsOff: {},
          onboarding: ind
            ? { name: s.name.slice(0, 80), brief: s.brief.trim() || undefined, kind: ind.launch.kind, intent: s.intent ?? ind.launch.kind, category: ind.launch.category, sells: ind.sells, goals: goalsFor(s.modules, ind) }
            : { name: s.name.slice(0, 80), brief: s.brief.trim() || undefined },
          choice: s.pick ? toChoice(s.pick, s.interval) : undefined,
          acceptTerms: true,
        },
      });
      move({ step: "verify", ticket: r.ticket, email: r.email, sentAt: Date.now(), devCode: r.devCode ?? null }, "Yes, create my workspace", `I've sent a **6-digit code** to **${r.email}**. Enter it below — it works for 10 minutes.`);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) move({ step: "exists" }, "Yes, create my workspace", `There's already an account with **${s.email}**.`);
      else if (e instanceof ApiClientError && e.fieldErrors().email) move({ step: "email" }, "Yes, create my workspace", `${e.fieldErrors().email![0]} — **what's your work email?**`);
      else if (e instanceof ApiClientError && e.fieldErrors().password) move({ step: "password" }, "Yes, create my workspace", `${e.fieldErrors().password![0]} — **choose another password.**`);
      else move({}, "Yes, create my workspace", `${errorMessage(e)} Try again in a moment.`);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (code: string) => {
    setBusy(true);
    try {
      const r = await api<{ email: string; workspace: string }>("/api/v1/auth/signup/verify", { method: "POST", body: { ticket: s.ticket, code } });
      let signedIn = false;
      if (password.current) {
        signedIn = await api<{ mfaRequired?: boolean }>("/api/v1/auth/login", { method: "POST", body: { email: r.email, password: password.current } }).then((x) => !x.mfaRequired, () => false);
      }
      password.current = "";
      move({ step: "done", workspace: r.workspace, signedIn, ticket: null, devCode: null }, "••••••", `**${r.workspace}** is ready. Your ${freeFor() === "30 days" ? "30-day" : "3-month"} free trial has started — every feature, no card needed.`);
    } catch (e) {
      move({}, "••••••", `${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      const r = await api<{ ticket: string; devCode?: string }>("/api/v1/auth/signup/resend", { method: "POST", body: { ticket: s.ticket } });
      move({ ticket: r.ticket, sentAt: Date.now(), devCode: r.devCode ?? null }, "Send a new code", "A new code is on its way. The old one no longer works.");
    } catch (e) {
      move({}, "Send a new code", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    password.current = "";
    save(null);
    setS(START);
  };

  // ── What sits under the latest question ──────────────────────────────────
  const widget = (): ReactNode => {
    const backBtn = BACK[s.step] || s.step === "q" ? (
      <button type="button" className="ai-back" onClick={back}>
        ← Back
      </button>
    ) : null;
    switch (s.step) {
      case "brief":
        return (
          <div className="ai-acts">
            <button type="button" className="ai-btn-ghost" onClick={() => askIndustry(s, { brief: "" }, "Skip")}>
              Skip
            </button>
            {backBtn}
          </div>
        );
      case "industry":
        return <IndustryPick guess={s.industry} onPick={(id) => askQuestions(s, id, industryById(id)!.label)} back={backBtn} />;
      case "q":
        return <Question key={s.qi} q={QUESTION_IDS[s.qi]!} profile={s.profile!} onDone={(profile, said) => (s.qi < QUESTION_IDS.length - 1 ? move({ profile, qi: s.qi + 1 }, said, `**${s.qi + 2} of 5 · ${QUESTIONS[QUESTION_IDS[s.qi + 1]!].title}**`) : askFeatures(s, profile, said))} back={backBtn} />;
      case "features":
        return <Features chosen={s.modules} recommended={recommend(s.profile!, s.industry).modules} onChange={(modules) => setS((x) => ({ ...x, modules }))} onDone={() => askPlan(`${s.modules.length} features`)} back={backBtn} />;
      case "plan":
        return catalog ? (
          <PlanPicker catalog={catalog} modules={s.modules} interval={s.interval} onInterval={(interval) => setS((x) => ({ ...x, interval }))} onPick={(pick, label) => (setS((x) => ({ ...x, pick })), askPerson(label))} back={backBtn} />
        ) : planError ? (
          <div className="ai-acts">
            <p className="ai-note">Plans couldn&apos;t load — you can choose one later.</p>
            <button type="button" className="ai-btn" onClick={() => askPerson("Decide later")}>
              Continue
            </button>
          </div>
        ) : (
          <p className="ai-note flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading plans…</p>
        );
      case "terms": {
        const ind = industryById(s.industry);
        const plan = s.pick?.kind === "plan" ? catalog?.plans.find((x) => x.id === (s.pick as { planId: string }).planId)?.name : s.pick?.kind === "custom" ? "Your own plan" : "Choose later";
        return (
          <div className="ai-ask">
            <div className="ai-panel" style={{ marginTop: 0 }}>
              <div className="ai-rows">
                <div className="ai-row"><span>Business</span><b>{s.name}</b></div>
                {ind && <div className="ai-row"><span>Industry</span><b>{ind.label}</b></div>}
                <div className="ai-row"><span>Features</span><b>{s.modules.length}</b></div>
                <div className="ai-row"><span>After the trial</span><b>{plan ?? "Choose later"}</b></div>
                <div className="ai-row"><span>Sign-in</span><b className="truncate">{s.email}</b></div>
              </div>
            </div>
            <p className="ai-note">
              By continuing you agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>
            <div className="ai-acts">
              <button type="button" className="ai-btn" disabled={busy} onClick={() => void create()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Yes, create my workspace
              </button>
              {backBtn}
            </div>
          </div>
        );
      }
      case "verify":
        return <Verify devCode={s.devCode} sentAt={s.sentAt} busy={busy} onCode={(c) => void verify(c)} onResend={() => void resend()} onChange={() => move({ step: "email" }, "Change email", "Sure — **what's your work email?**")} />;
      case "exists":
        return (
          <div className="ai-acts">
            <a className="ai-btn" href={`/login?email=${encodeURIComponent(s.email)}`}>
              Sign in instead
            </a>
            <button type="button" className="ai-btn-ghost" onClick={() => move({ step: "email" }, "Use another email", "**What's your work email?**")}>
              Use another email
            </button>
          </div>
        );
      case "done": {
        const ind = industryById(s.industry);
        const kind = s.intent ?? (s.modules.includes("store") ? "store" : null) ?? (ind?.launch.kind === "website" ? "website" : null);
        const login = (next: string) => (s.signedIn ? next : `/login?email=${encodeURIComponent(s.email)}&welcome=1&next=${encodeURIComponent(next)}`);
        return (
          <div className="ai-done">
            <b>You&apos;re all set 🎉</b>
            <p className="ai-note">{s.modules.length} features switched on · free for {freeFor()}</p>
            <a className="ai-cta" href={login("/home")} onClick={() => save(null)}>
              Open my workspace <ArrowRight className="size-4" aria-hidden />
            </a>
            {kind && (
              <a className="ai-btn-ghost justify-center" href={login(`/launch?kind=${kind}&from=onboarding`)} onClick={() => save(null)}>
                {kind === "store" ? "Open my online store" : "Build my website"}
              </a>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  const msgs: AiMsg[] = s.lines.map((l, i) => ({ ...l, node: i === s.lines.length - 1 && l.role === "assistant" ? widget() : undefined }));

  const sections: AiSection[] = [
    {
      title: "A few ways to get started.",
      cards: [
        { id: "plan", title: "Set up my workspace", sub: "A few questions, and I'll create everything for you.", icon: Sparkles, tone: "#8b7bff", onPick: () => askName({ intent: null }, "Set up my workspace") },
        { id: "store", title: "Open my online store", sub: "Products, UPI checkout and delivery, live in minutes.", icon: Store, tone: "#ff6b6b", onPick: () => askName({ intent: "store" }, "I want to open an online store") },
        { id: "bill", title: "Bill and get paid faster", sub: "GST invoices, UPI links and reminders that send themselves.", icon: ReceiptIndianRupee, tone: "#3ccf91", onPick: () => askName({ intent: null, brief: "GST invoices and payments by UPI" }, "I want to bill and get paid faster") },
      ],
    },
    {
      title: "Start with a business like yours.",
      tiles: [
        { id: "cafe", label: "Set up my café", photo: industryById("cafe")!.photo, onPick: () => askName({ brief: "a café" }, "I run a café") },
        { id: "retail", label: "Launch my fashion store", photo: industryById("retail")!.photo, onPick: () => askName({ brief: "a clothing store that also sells online", intent: "store" }, "I run a clothing store") },
      ],
    },
    {
      title: "Questions people ask first.",
      cards: [
        { id: "free", title: FAQ.free.q, sub: "What's included in the trial, and what happens after.", icon: Gift, tone: "#f5a35c", onPick: () => move({ step: "home" }, FAQ.free.q, FAQ.free.a) },
        { id: "team", title: FAQ.team.q, sub: "Sign-ins, roles and what each person can see.", icon: Users, tone: "#4fb3ff", onPick: () => move({ step: "home" }, FAQ.team.q, FAQ.team.a) },
      ],
    },
  ];

  const qi = QINPUT[s.step];
  return (
    <AiScreen
      greeting="Hi — I'm your Cloudesk setup guide."
      sections={sections}
      messages={msgs}
      showHome={!s.lines.length}
      busy={busy}
      onSend={onText}
      onClose={onClose}
      onNew={restart}
      closeLabel="Back to the intro"
      input={qi?.input ?? "text"}
      placeholder={qi?.placeholder ?? (s.step === "home" ? "Your business name, or what it does" : "Type back to change an answer")}
      quick={s.step === "home" ? ["I run a café", "I sell clothes online", "I run a clinic", "I'm a consultant"] : undefined}
    />
  );
}

// ── Widgets ────────────────────────────────────────────────────────────────

function IndustryPick({ guess, onPick, back }: { guess: IndustryId | null; onPick: (id: IndustryId) => void; back: ReactNode }) {
  const [all, setAll] = useState(!guess);
  if (guess && !all)
    return (
      <div className="ai-acts">
        <button type="button" className="ai-btn" onClick={() => onPick(guess)}>
          Yes, that&apos;s right
        </button>
        <button type="button" className="ai-btn-ghost" onClick={() => setAll(true)}>
          Pick another
        </button>
        {back}
      </div>
    );
  return (
    <div className="ai-ask">
      <div className="ai-opts">
        {INDUSTRIES.map((i) => (
          <button key={i.id} type="button" className="ai-opt" aria-pressed={i.id === guess} onClick={() => onPick(i.id)}>
            <b>{i.label}</b>
            <small>{i.line}</small>
          </button>
        ))}
      </div>
      {back}
    </div>
  );
}

function Question({ q, profile, onDone, back }: { q: QuestionId; profile: Profile; onDone: (p: Profile, said: string) => void; back: ReactNode }) {
  const Q = QUESTIONS[q];
  const [p, setP] = useState(profile);
  const on = (id: string) => (q === "team" ? p.team === id : (p[q] as string[]).includes(id));
  const labels = (x: Profile) => Q.options.filter((o) => (q === "team" ? x.team === o.id : (x[q] as string[]).includes(o.id))).map((o) => o.label);
  const tap = (id: string) => {
    if (q === "team") {
      const next = { ...p, team: id as Profile["team"] };
      return onDone(next, Q.options.find((o) => o.id === id)!.label);
    }
    const list = p[q] as string[];
    setP({ ...p, [q]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  return (
    <div className="ai-ask">
      <div className="ai-opts">
        {Q.options.map((o) => (
          <button key={o.id} type="button" className="ai-opt" aria-pressed={on(o.id)} onClick={() => tap(o.id)}>
            <b>{o.label}</b>
            <small>{o.hint}</small>
          </button>
        ))}
      </div>
      <div className="ai-acts">
        {Q.multi && (
          <button type="button" className="ai-btn" onClick={() => onDone(p, labels(p).join(", ") || "None of these")}>
            Continue
          </button>
        )}
        {back}
      </div>
    </div>
  );
}

function Features({ chosen, recommended, onChange, onDone, back }: { chosen: ModuleId[]; recommended: ModuleId[]; onChange: (m: ModuleId[]) => void; onDone: () => void; back: ReactNode }) {
  const [more, setMore] = useState(false);
  const toggle = (id: ModuleId) => onChange(chosen.includes(id) ? chosen.filter((m) => m !== id) : withRequirements([...chosen, id]));
  const chip = (id: ModuleId) => {
    const m = moduleById(id)!;
    return (
      <button key={id} type="button" className="ai-tog" aria-pressed={chosen.includes(id)} style={{ "--c": TINT[m.tint] } as CSSProperties} onClick={() => toggle(id)}>
        <ModuleGlyph id={id} />
        {m.name}
      </button>
    );
  };
  const others = MODULES.map((m) => m.id).filter((id) => !recommended.includes(id));
  return (
    <div className="ai-ask">
      <div className="ai-togs">{recommended.map(chip)}</div>
      {more && <div className="ai-togs">{others.map(chip)}</div>}
      <div className="ai-acts">
        <button type="button" className="ai-btn" disabled={!chosen.length} onClick={onDone}>
          Looks good · {chosen.length}
        </button>
        <button type="button" className="ai-btn-ghost" onClick={() => setMore(!more)}>
          {more ? "Fewer" : `Add more (${others.length})`}
        </button>
        {back}
      </div>
    </div>
  );
}

function PlanPicker({ catalog, modules, interval, onInterval, onPick, back }: { catalog: Catalog; modules: ModuleId[]; interval: Interval; onInterval: (i: Interval) => void; onPick: (p: PlanPick, label: string) => void; back: ReactNode }) {
  const custom = customFrom(modules, catalog.pricing);
  const cq = priceOf(custom, interval, catalog);
  const per = (monthly: number, yearly: number) => (interval === "year" ? Math.round(yearly / 12) : monthly);
  const covers = (pm: ModuleId[] | null) => !pm || modules.every((m) => pm.includes(m) || catalog.pricing.customBaseModules.includes(m));
  const free = 12 - catalog.pricing.yearlyMonths;
  return (
    <div className="ai-ask">
      <div className="ai-seg" role="radiogroup" aria-label="Billing">
        {(["month", "year"] as const).map((i) => (
          <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => onInterval(i)}>
            {i === "month" ? "Monthly" : `Yearly${free > 0 ? ` · ${free} months free` : ""}`}
          </button>
        ))}
      </div>
      <div className="ai-opts is-wide">
        {cq && (
          <button type="button" className="ai-opt ai-opt-row" onClick={() => onPick(custom, `Build my own · ${money(interval === "year" ? Math.round(cq.amount / 12) : cq.amount, cq.currency)}/month`)}>
            <span>
              <b>Build my own</b>
              <small>Exactly the {modules.length} features you picked</small>
            </span>
            <em>
              {money(interval === "year" ? Math.round(cq.amount / 12) : cq.amount, cq.currency)}
              <small>/month</small>
            </em>
          </button>
        )}
        {catalog.plans.map((p) => (
          <button key={p.id} type="button" className="ai-opt ai-opt-row" onClick={() => onPick({ kind: "plan", planId: p.id }, `${p.name} · ${money(per(p.monthly, p.yearly), p.currency)}/month`)}>
            <span>
              <b>{p.name}</b>
              <small className={clsx(covers(p.modules) ? "" : "!text-[#f5c35c]")}>{covers(p.modules) ? p.tagline || "Covers everything you picked" : "Leaves out some features you picked"}</small>
            </span>
            <em>
              {money(per(p.monthly, p.yearly), p.currency)}
              <small>/month</small>
            </em>
          </button>
        ))}
        <button type="button" className="ai-opt" onClick={() => onPick({ kind: "later" }, "Decide later")}>
          <b>Decide later</b>
          <small>Use everything in the trial, choose before it ends</small>
        </button>
      </div>
      <p className="ai-note">Prices plus tax. {back}</p>
    </div>
  );
}

function Verify({ devCode, sentAt, busy, onCode, onResend, onChange }: { devCode: string | null; sentAt: number; busy: boolean; onCode: (c: string) => void; onResend: () => void; onChange: () => void }) {
  const [code, setCode] = useState("");
  const wait = useCountdown(sentAt + RESEND_MS);
  return (
    <div className="ai-ask">
      {devCode && <p className="ai-dev">Development: your code is <b className="font-mono tracking-[0.15em]">{devCode}</b></p>}
      <OtpInput value={code} onChange={setCode} onComplete={(c) => (onCode(c), setCode(""))} disabled={busy} autoFocus label="6-digit code" />
      <div className="ai-acts">
        {busy ? (
          <span className="ai-note flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Creating your workspace…</span>
        ) : (
          <>
            {wait > 0 ? <span className="ai-note">New code in {wait}s</span> : <button type="button" className="ai-back" onClick={onResend}>Send a new code</button>}
            <button type="button" className="ai-back" onClick={onChange}>
              Change email
            </button>
          </>
        )}
      </div>
    </div>
  );
}
