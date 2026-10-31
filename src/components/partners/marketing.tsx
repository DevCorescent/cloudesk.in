"use client";

// The interactive parts of the public partner page: the kinds of partner
// with their scope of work, an earnings calculator worked out from the
// program's live rates, and the application (with an account made after the
// emailed code, or with the account you're signed in with).
import clsx from "clsx";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PasswordInput } from "@/components/auth-form";
import { OtpInput } from "@/components/otp-input";
import { Field } from "@/components/ui/primitives";
import { TYPE_ICON } from "./icons";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { discountText, months, pct, shareOf, tierFor, TYPE_INFO, TYPE_LIST, type PartnerType, type Tier } from "@/lib/partners/program";

export type PublicTerms = { id: PartnerType; commissionBps: number; commissionMonths: number; discountBps: number; discountPayments: number; maxDiscountBps: number };
export type PublicProgram = { open: boolean; holdDays: number; minPayout: number; cookieDays: number; leadDays: number; tiers: Tier[]; types: PublicTerms[] };

/** "Apply as …" anywhere on the page preselects that kind of partner in the form. */
export function pickType(t: PartnerType) {
  try {
    sessionStorage.setItem("cc_partner_type", t);
  } catch {}
  window.dispatchEvent(new CustomEvent("cc:partner-type", { detail: t }));
}

const TINT: Record<PartnerType, string> = { organisation: "bg-[var(--p-lavender)] text-[var(--p-lavender-ink)]", freelancer: "bg-[var(--p-mint)] text-[var(--p-mint-ink)]", sales: "bg-[var(--p-peach)] text-[var(--p-peach-ink)]", marketing: "bg-[var(--p-sky)] text-[var(--p-sky-ink)]", influencer: "bg-[var(--p-rose)] text-[var(--p-rose-ink)]" };

// ─── The kinds of partner ──────────────────────────────────────────────────

export function PartnerTypes({ program }: { program: PublicProgram }) {
  const [cur, setCur] = useState<PartnerType>("organisation");
  const info = TYPE_INFO[cur];
  const t = program.types.find((x) => x.id === cur)!;
  const Icon = TYPE_ICON[cur];
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div role="tablist" aria-label="Kinds of partner" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:overflow-visible">
        {TYPE_LIST.map((x) => {
          const I = TYPE_ICON[x.id];
          const on = x.id === cur;
          return (
            <button key={x.id} role="tab" aria-selected={on} type="button" onClick={() => setCur(x.id)} className={clsx("flex min-w-[220px] shrink-0 items-center gap-3 rounded-[18px] border p-3 text-left transition-all lg:min-w-0", on ? "border-fg/15 bg-white shadow-[0_12px_30px_-18px_rgb(0_0_0/0.35)]" : "border-transparent bg-white/50 hover:bg-white/80")}>
              <span className={clsx("grid size-10 shrink-0 place-items-center rounded-[12px]", TINT[x.id])}><I className="size-[18px]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold">{x.name}</span>
                <span className="block truncate text-[12.5px] text-fg/55">{x.short}</span>
              </span>
              <span className="shrink-0 text-right"><span className="block text-[17px] font-semibold tabular-nums">{pct(program.types.find((y) => y.id === x.id)!.commissionBps)}</span><span className="block text-[11px] text-fg/45">{program.types.find((y) => y.id === x.id)!.commissionMonths ? `${program.types.find((y) => y.id === x.id)!.commissionMonths} mo` : "always"}</span></span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="p-glass grid gap-6 rounded-[28px] p-6 sm:p-8">
        <div className="flex flex-wrap items-start gap-4">
          <span className={clsx("grid size-12 shrink-0 place-items-center rounded-[16px]", TINT[cur])}><Icon className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 data-no-fit className="text-[22px] font-semibold tracking-tight">{info.name}</h3>
            <p className="mt-1 max-w-2xl text-[14.5px] leading-relaxed text-fg/60">{info.who}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat big={pct(t.commissionBps)} label={`of what each customer pays, ${months(t.commissionMonths)}`} />
          <Stat big={t.discountBps ? pct(t.discountBps) : "—"} label={t.discountBps ? `off for your customers — ${discountText(t.discountBps, t.discountPayments).replace(/^\S+ off /, "")}` : "no customer discount"} />
          <Stat big={`+${pct(Math.max(...program.tiers.map((x) => x.bonusBps)))}`} label="more as you grow, with tier bonuses" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-[12px] font-semibold tracking-[0.14em] text-fg/45 uppercase">Scope of work</p>
            <ul className="mt-3 grid gap-2.5">
              {info.scope.map((s) => <li key={s} className="flex gap-2.5 text-[14px] leading-snug"><Check className="mt-0.5 size-4 shrink-0 text-[var(--p-mint-ink)]" />{s}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold tracking-[0.14em] text-fg/45 uppercase">Your dashboard</p>
            <ul className="mt-3 grid gap-2.5">
              {info.tools.map((s) => <li key={s} className="flex gap-2.5 text-[14px] leading-snug"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-[var(--p-sky-ink)]" />{s}</li>)}
            </ul>
          </div>
        </div>
        <a href={`#apply`} onClick={() => pickType(cur)} className="p-cta inline-flex w-fit items-center gap-2 px-6">Apply as {info.name.toLowerCase().replace(/^partner /, "a partner ")} <ArrowRight className="size-4" /></a>
      </div>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="rounded-[18px] bg-white/70 p-4 ring-1 ring-fg/[0.05]">
      <p className="text-[28px] leading-none font-semibold tracking-tight tabular-nums">{big}</p>
      <p className="mt-1.5 text-[12.5px] leading-snug text-fg/55">{label}</p>
    </div>
  );
}

// ─── Earnings calculator ───────────────────────────────────────────────────

export function EarningsCalculator({ program, plans }: { program: PublicProgram; plans: { id: string; name: string; monthly: number }[] }) {
  const [type, setType] = useState<PartnerType>("organisation");
  const [perMonth, setPerMonth] = useState(4);
  const [planId, setPlanId] = useState(plans.find((p) => p.id === "growth")?.id ?? plans[0]?.id ?? "");
  const t = program.types.find((x) => x.id === type)!;
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const price = plan?.monthly ?? 0;
  // A year of signing up `perMonth` paying customers a month, each paying the plan's monthly price.
  const year = useMemo(() => {
    let total = 0;
    let lastMonth = 0;
    for (let m = 1; m <= 12; m++) {
      const { tier } = tierFor(perMonth * m, program.tiers);
      const rate = Math.min(10000, t.commissionBps + tier.bonusBps);
      // Each month's new customers are on their k-th payment: discounted for the first few, earning within the window.
      let paid = 0;
      for (let joined = 1; joined <= m; joined++) {
        const k = m - joined + 1;
        if (t.commissionMonths && k > t.commissionMonths) continue;
        paid += perMonth * price * (k <= t.discountPayments ? 1 - t.discountBps / 10000 : 1);
      }
      lastMonth = shareOf(paid, rate);
      total += lastMonth;
    }
    return { total, lastMonth, tier: tierFor(perMonth * 12, program.tiers).tier };
  }, [perMonth, price, t, program.tiers]);
  const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
  return (
    <div className="p-glass grid grid-cols-1 gap-8 rounded-[32px] p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="grid content-start gap-6">
        <div className="grid gap-2">
          <p className="text-[13px] font-medium">I&apos;m a…</p>
          <div className="flex flex-wrap gap-2">
            {TYPE_LIST.map((x) => <button key={x.id} type="button" onClick={() => setType(x.id)} className={clsx("rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors", type === x.id ? "bg-fg text-bg" : "bg-white/70 text-fg/65 ring-1 ring-fg/[0.06] hover:text-fg")}>{x.name}</button>)}
          </div>
        </div>
        <div className="grid gap-2">
          <label htmlFor="calc-per-month" className="flex items-baseline justify-between text-[13px] font-medium"><span>New paying customers a month</span><span className="text-[22px] font-semibold tabular-nums">{perMonth}</span></label>
          <input id="calc-per-month" type="range" min={1} max={40} value={perMonth} onChange={(e) => setPerMonth(Number(e.target.value))} className="w-full accent-[var(--fg)]" />
        </div>
        <div className="grid gap-2">
          <p className="text-[13px] font-medium">On average they choose</p>
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => <button key={p.id} type="button" onClick={() => setPlanId(p.id)} className={clsx("rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors", planId === p.id ? "bg-fg text-bg" : "bg-white/70 text-fg/65 ring-1 ring-fg/[0.06] hover:text-fg")}>{p.name} · {rupees(p.monthly)}/mo</button>)}
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed text-fg/50">Worked out from the program&apos;s current rates: {pct(t.commissionBps)} {months(t.commissionMonths)}, tier bonuses as you pass {program.tiers.filter((x) => x.minActive > 0).map((x) => `${x.minActive}`).join(" and ")} paying customers, less your customers&apos; discount, before tax. An estimate — what you earn depends on what your customers actually pay.</p>
      </div>
      <div className="grid content-center gap-5 rounded-[26px] bg-fg p-6 text-bg sm:p-8">
        <div>
          <p className="text-[13px] text-bg/60">In your first year</p>
          <p className="mt-1 text-[clamp(2.4rem,6vw,3.6rem)] leading-none font-semibold tracking-[-0.04em] tabular-nums">{rupees(year.total)}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-bg/15 pt-5">
          <div><p className="text-[12.5px] text-bg/60">A month, by month 12</p><p className="mt-0.5 text-[22px] font-semibold tabular-nums">{rupees(year.lastMonth)}</p></div>
          <div><p className="text-[12.5px] text-bg/60">Paying customers</p><p className="mt-0.5 text-[22px] font-semibold tabular-nums">{perMonth * 12}</p></div>
        </div>
        <p className="text-[12.5px] text-bg/60">You&apos;d reach the <b className="text-bg">{year.tier.name}</b> tier{year.tier.bonusBps ? ` (+${pct(year.tier.bonusBps)} on every customer)` : ""}.</p>
        <a href="#apply" onClick={() => pickType(type)} className="inline-flex h-12 w-fit items-center gap-2 rounded-full bg-bg px-6 text-[15px] font-medium text-fg transition-transform hover:-translate-y-0.5">Start earning <ArrowRight className="size-4" /></a>
      </div>
    </div>
  );
}

// ─── Applying ──────────────────────────────────────────────────────────────

type Signed = { name: string; email: string } | null;
type Existing = { status: string; type: PartnerType } | null;

export function ApplyForm({ signedIn, existing, open, termsHref }: { signedIn: Signed; existing: Existing; open: boolean; termsHref: string }) {
  const [step, setStep] = useState<"type" | "details" | "account" | "verify" | "done">("type");
  const [type, setType] = useState<PartnerType | null>(existing?.type ?? null);
  const [f, setF] = useState({ name: "", phone: "", city: "", country: "IN", website: "" });
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [acct, setAcct] = useState({ person: signedIn?.name ?? "", email: signedIn?.email ?? "" });
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<{ message: string; exists?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<{ ticket: string; email: string; devCode?: string } | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    const valid = (v: unknown): v is PartnerType => typeof v === "string" && v in TYPE_INFO;
    try {
      const saved = sessionStorage.getItem("cc_partner_type");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount (sessionStorage isn't there on the server)
      if (valid(saved)) setType(saved);
    } catch {}
    const on = (e: Event) => {
      const t = (e as CustomEvent).detail;
      if (!valid(t)) return;
      setType(t);
      setStep((s) => (s === "type" ? "details" : s));
    };
    window.addEventListener("cc:partner-type", on);
    return () => window.removeEventListener("cc:partner-type", on);
  }, []);

  if (existing && existing.status !== "rejected")
    return (
      <Shell>
        <div className="grid justify-items-center gap-4 py-6 text-center">
          <span className="grid size-14 place-items-center rounded-[18px] bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><BadgeCheck className="size-6" /></span>
          <h3 data-no-fit className="text-[24px] font-semibold tracking-tight">{existing.status === "pending" ? "Your application is being reviewed" : "You're already a partner"}</h3>
          <p className="max-w-md text-[15px] text-fg/60">{existing.status === "pending" ? "We'll email you when it's approved. Meanwhile you can add your payout details." : "Your links, codes and earnings are in your partner dashboard."}</p>
          <Link href="/partner" className="p-cta inline-flex items-center gap-2 px-6">Open partner dashboard <ArrowRight className="size-4" /></Link>
        </div>
      </Shell>
    );
  if (!open)
    return (
      <Shell>
        <p className="py-8 text-center text-[15px] text-fg/60">We&apos;re not taking new partner applications right now. Please check back soon.</p>
      </Shell>
    );

  const info = type ? TYPE_INFO[type] : null;
  const steps = signedIn ? ["Kind of partner", "About you"] : ["Kind of partner", "About you", "Your account", "Confirm email"];
  const idx = { type: 0, details: 1, account: 2, verify: 3, done: steps.length }[step];
  const application = () => ({ type, ...f, profile, acceptTerms: terms });

  const checkDetails = () => {
    const e: Record<string, string[]> = {};
    if (f.name.trim().length < 2) e.name = [info?.company ? "Enter your organisation's name" : "Enter your name"];
    if (!/^[+\d\s()-]{7,30}$/.test(f.phone.trim())) e.phone = ["Enter a phone number"];
    if (!f.city.trim()) e.city = ["Enter your city"];
    for (const q of info?.fields ?? []) if (q.required && !profile[q.id]?.trim()) e[`profile.${q.id}`] = ["Required"];
    setErrors(e);
    return !Object.keys(e).length;
  };
  const fail = (err: unknown) => {
    if (err instanceof ApiClientError) {
      const fe = err.fieldErrors();
      setErrors(fe);
      if (err.code !== "validation_failed" || !Object.keys(fe).length) setError({ message: err.message, exists: err.status === 409 });
    } else setError({ message: errorMessage(err) });
    setBusy(false);
  };
  async function submitSignedIn() {
    if (!checkDetails()) return;
    if (!terms) return setErrors({ acceptTerms: ["Please accept the partner terms"] });
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/partner/apply", { method: "POST", body: application() });
      setStep("done");
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  }
  async function submitAccount(password: string) {
    const e: Record<string, string[]> = {};
    if (!acct.person.trim()) e.person = ["Enter your name"];
    if (!/^\S+@\S+\.\S+$/.test(acct.email.trim())) e.email = ["Enter a valid email address"];
    if (password.length < 10) e.password = ["Use at least 10 characters"];
    if (!terms) e.acceptTerms = ["Please accept the partner terms"];
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ticket: string; email: string; devCode?: string }>("/api/v1/partners/apply/start", { method: "POST", body: { ...application(), person: acct.person, email: acct.email, password } });
      setTicket(r);
      setStep("verify");
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  }
  async function verify(c: string) {
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/signup/verify", { method: "POST", body: { ticket: ticket.ticket, code: c } });
      setStep("done");
      setBusy(false);
    } catch (e) {
      setCode("");
      fail(e);
    }
  }

  return (
    <Shell>
      {step !== "done" && (
        <ol className="mb-6 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px]">
          {steps.map((s, i) => (
            <li key={s} className={clsx("inline-flex items-center gap-2", i === idx ? "font-semibold text-fg" : i < idx ? "text-fg/60" : "text-fg/35")}>
              <span className={clsx("grid size-5 place-items-center rounded-full text-[11px]", i < idx ? "bg-fg text-bg" : i === idx ? "bg-white ring-1 ring-fg" : "bg-fg/[0.06]")}>{i < idx ? <Check className="size-3" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-[14px] bg-rose-50 px-4 py-3 text-[13.5px] text-rose-700">
          {error.message} {error.exists && <Link href={`/login?email=${encodeURIComponent(acct.email)}&next=${encodeURIComponent("/partners#apply")}`} className="font-semibold underline">Sign in</Link>}
        </div>
      )}

      {step === "type" && (
        <div className="grid gap-5">
          <h3 data-no-fit className="text-[22px] font-semibold tracking-tight">How would you like to partner?</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TYPE_LIST.map((x) => {
              const I = TYPE_ICON[x.id];
              return (
                <button key={x.id} type="button" onClick={() => setType(x.id)} aria-pressed={type === x.id} className={clsx("grid gap-2 rounded-[20px] border p-4 text-left transition-all", type === x.id ? "border-fg bg-white shadow-[0_14px_30px_-20px_rgb(0_0_0/0.4)]" : "border-fg/[0.08] bg-white/60 hover:border-fg/20")}>
                  <span className={clsx("grid size-10 place-items-center rounded-[12px]", TINT[x.id])}><I className="size-[18px]" /></span>
                  <span className="text-[15px] font-semibold">{x.name}</span>
                  <span className="text-[13px] leading-snug text-fg/55">{x.short}</span>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end"><button type="button" disabled={!type} onClick={() => setStep("details")} className="p-cta inline-flex items-center gap-2 px-6">Continue <ArrowRight className="size-4" /></button></div>
        </div>
      )}

      {step === "details" && info && (
        <form className="grid gap-5" noValidate onSubmit={(e) => { e.preventDefault(); if (signedIn) void submitSignedIn(); else if (checkDetails()) { setError(null); setStep("account"); } }}>
          <h3 data-no-fit className="text-[22px] font-semibold tracking-tight">Tell us about {info.company ? "your organisation" : "yourself"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={info.company ? "Organisation name" : "Your name or brand"} error={errors.name?.[0]}>{(a) => <input {...a} className="p-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} autoFocus />}</Field>
            <Field label="Phone" error={errors.phone?.[0]}>{(a) => <input {...a} className="p-input" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} />}</Field>
            <Field label="City" error={errors.city?.[0]}>{(a) => <input {...a} className="p-input" autoComplete="address-level2" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} maxLength={80} />}</Field>
            <Field label="Country" error={errors.country?.[0]}>{(a) => (
              <select {...a} className="p-input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
                {[["IN", "India"], ["AE", "United Arab Emirates"], ["US", "United States"], ["GB", "United Kingdom"], ["SG", "Singapore"], ["AU", "Australia"], ["CA", "Canada"], ["NP", "Nepal"], ["BD", "Bangladesh"], ["LK", "Sri Lanka"]].map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            )}</Field>
            <Field label="Website" hint="Optional" error={errors.website?.[0]} className="sm:col-span-2">{(a) => <input {...a} className="p-input" type="url" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://" maxLength={300} />}</Field>
            {info.fields.map((q) => (
              <Field key={q.id} label={q.label} hint={q.hint ?? (q.required ? undefined : "Optional")} error={errors[`profile.${q.id}`]?.[0]} className={q.kind === "textarea" ? "sm:col-span-2" : undefined}>
                {(a) =>
                  q.kind === "select" ? (
                    <select {...a} className="p-input" value={profile[q.id] ?? ""} onChange={(e) => setProfile({ ...profile, [q.id]: e.target.value })}>
                      <option value="">Choose…</option>
                      {q.options!.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : q.kind === "textarea" ? (
                    <textarea {...a} className="p-input min-h-24 py-2.5" value={profile[q.id] ?? ""} onChange={(e) => setProfile({ ...profile, [q.id]: e.target.value })} placeholder={q.placeholder} maxLength={2000} />
                  ) : (
                    <input {...a} className="p-input" type={q.kind === "url" ? "url" : "text"} value={profile[q.id] ?? ""} onChange={(e) => setProfile({ ...profile, [q.id]: e.target.value })} placeholder={q.placeholder} maxLength={300} />
                  )
                }
              </Field>
            ))}
          </div>
          {signedIn && <Terms checked={terms} onChange={setTerms} error={errors.acceptTerms?.[0]} href={termsHref} />}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setStep("type")} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] text-fg/55 hover:text-fg"><ArrowLeft className="size-4" /> Back</button>
            {signedIn && <p className="hidden text-[12.5px] text-fg/50 sm:block">Applying as {signedIn.email}</p>}
            <button type="submit" disabled={busy} className="p-cta ml-auto inline-flex items-center gap-2 px-6">{busy && <Loader2 className="size-4 animate-spin" />}{signedIn ? "Send application" : "Continue"} <ArrowRight className="size-4" /></button>
          </div>
        </form>
      )}

      {step === "account" && (
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); void submitAccount(String(new FormData(e.currentTarget).get("password") ?? "")); }}>
          <h3 data-no-fit className="text-[22px] font-semibold tracking-tight">Create your partner account</h3>
          <p className="-mt-2 text-[14px] text-fg/55">You&apos;ll use it to sign in to your partner dashboard. Already have a Cloudesk account? <Link href="/login?next=%2Fpartners%23apply" className="font-medium text-fg underline underline-offset-2">Sign in first</Link>.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" error={errors.person?.[0]}>{(a) => <input {...a} className="p-input" autoComplete="name" value={acct.person} onChange={(e) => setAcct({ ...acct, person: e.target.value })} maxLength={100} autoFocus />}</Field>
            <Field label="Email" error={errors.email?.[0]}>{(a) => <input {...a} className="p-input" type="email" autoComplete="email" value={acct.email} onChange={(e) => setAcct({ ...acct, email: e.target.value })} maxLength={200} />}</Field>
          </div>
          <Field label="Password" hint="At least 10 characters, with a number or symbol." error={errors.password?.[0]}>{(a) => <PasswordInput id={a.id} name="password" autoComplete="new-password" strength invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]} />}</Field>
          <Terms checked={terms} onChange={setTerms} error={errors.acceptTerms?.[0]} href={termsHref} />
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setStep("details")} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14px] text-fg/55 hover:text-fg"><ArrowLeft className="size-4" /> Back</button>
            <button type="submit" disabled={busy} className="p-cta ml-auto inline-flex items-center gap-2 px-6">{busy && <Loader2 className="size-4 animate-spin" />}Email me a code <ArrowRight className="size-4" /></button>
          </div>
        </form>
      )}

      {step === "verify" && ticket && (
        <div className="mx-auto grid max-w-[420px] gap-5 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-[18px] bg-[var(--p-sky)] text-[var(--p-sky-ink)]"><MailCheck className="size-6" /></span>
          <h3 data-no-fit className="text-[24px] font-semibold tracking-tight">Check your email</h3>
          <p className="text-[14.5px] text-fg/60">We sent a 6-digit code to <b className="text-fg">{ticket.email}</b>. It works for 10 minutes.</p>
          {ticket.devCode && <p className="rounded-[14px] border border-dashed border-[var(--p-butter-ink)]/40 bg-[var(--p-butter)] px-3 py-2 text-[13px] text-[var(--p-butter-ink)]">Development: your code is <b className="font-mono tracking-[0.15em]">{ticket.devCode}</b></p>}
          <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} autoFocus label="6-digit code" />
          <button type="button" disabled={code.length < 6 || busy} onClick={() => void verify(code)} className="p-cta inline-flex items-center justify-center gap-2">{busy && <Loader2 className="size-4 animate-spin" />}Confirm and apply</button>
          <button type="button" onClick={() => setStep("account")} className="text-[13.5px] font-medium text-fg/60 hover:text-fg">Change email</button>
        </div>
      )}

      {step === "done" && (
        <div className="grid justify-items-center gap-4 py-6 text-center">
          <span className="grid size-14 place-items-center rounded-[18px] bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><BadgeCheck className="size-6" /></span>
          <h3 data-no-fit className="text-[26px] font-semibold tracking-tight">Application sent</h3>
          <p className="max-w-md text-[15px] text-fg/60">We review every application and usually reply within 2 working days, by email. {signedIn ? "You can see where it is in your partner dashboard." : "Log in to see where it is and add your payout details."}</p>
          <Link href={signedIn ? "/partner" : `/login?email=${encodeURIComponent(ticket?.email ?? acct.email)}&next=%2Fpartner`} className="p-cta inline-flex items-center gap-2 px-6">{signedIn ? "Open partner dashboard" : "Log in"} <ArrowRight className="size-4" /></Link>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="p-glass rounded-[32px] p-5 sm:p-8 lg:p-10">{children}</div>;
}

function Terms({ checked, onChange, error, href }: { checked: boolean; onChange: (v: boolean) => void; error?: string; href: string }) {
  return (
    <div className="grid gap-1">
      <label className="flex items-start gap-2.5 text-[13.5px] leading-snug text-fg/70">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={!!error || undefined} className="mt-0.5 size-4 shrink-0 accent-[var(--fg)]" />
        <span>I agree to the <a href={href} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">Partner Terms</a>, including the rules on honest promotion and disclosure.</span>
      </label>
      {error && <p className="pl-6.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
