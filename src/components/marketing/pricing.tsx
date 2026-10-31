"use client";

// The pricing page's interactive parts: plans by month or year, and two
// pop-ups — a calculator for building your own plan (with industry presets)
// and the feature comparison. Prices come from the live catalogue and use the
// same arithmetic the server charges with.
import clsx from "clsx";
import { ArrowRight, Check, Minus, Plus, RotateCcw, SlidersHorizontal, Sparkles, Table2, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { money, quote, taxOf, type CatalogPlan, type Interval, type Pricing } from "@/lib/billing/catalog";
import { INDUSTRIES, MODULE_GROUPS, MODULES, moduleById, withRequirements, type Industry, type ModuleId, type Tint } from "@/lib/workspace/modules";

export type PublicPricing = Pick<Pricing, "currency" | "trialDays" | "taxBps" | "taxLabel" | "yearlyMonths" | "customBase" | "customBaseModules" | "customSeatsIncluded" | "seatPrice" | "customLimits" | "modulePrices">;

const nameOf = (id: string) => moduleById(id as ModuleId)?.name ?? id;
const unlimited = (n: number) => (n >= 100000 ? "Unlimited" : n.toLocaleString("en-IN"));
const asFull = (pricing: PublicPricing) => ({ ...pricing, enforce: true, graceDays: 0, renewalNoticeDays: 7 }) as Pricing;

const TINT_DOT: Record<Tint, string> = { lavender: "bg-[var(--p-lavender-ink)]", sky: "bg-[var(--p-sky-ink)]", mint: "bg-[var(--p-mint-ink)]", peach: "bg-[var(--p-peach-ink)]", butter: "bg-[var(--p-butter-ink)]", rose: "bg-[var(--p-rose-ink)]" };

function Toggle({ value, onChange, months, compact }: { value: Interval; onChange: (v: Interval) => void; months: number; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full bg-fg/[0.05] p-1 ring-1 ring-fg/[0.06]">
      {(["month", "year"] as const).map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} onClick={() => onChange(i)} className={clsx("inline-flex items-center gap-2 rounded-full font-medium transition-all", compact ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-[13.5px]", value === i ? "bg-white text-fg shadow-[0_1px_3px_rgb(0_0_0/0.08)]" : "text-fg/55 hover:text-fg")}>
          {i === "month" ? "Monthly" : "Yearly"}
          {i === "year" && months < 12 && <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{12 - months} months free</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Pop-up (native <dialog>: focus trap, Escape, inert background) ─────────

function Popup({ open, onClose, title, eyebrow, children, size = "wide" }: { open: boolean; onClose: () => void; title: string; eyebrow: string; children: ReactNode; size?: "wide" | "table" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = `pp-${eyebrow.replace(/\W+/g, "-").toLowerCase()}`;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={id}
      className={clsx("mk-popup m-auto w-[calc(100%-24px)] rounded-[28px] bg-white p-0 text-fg shadow-[0_40px_120px_-30px_rgb(20_10_60/0.45)] ring-1 ring-fg/[0.08] backdrop:bg-[#0f0d1a]/55 backdrop:backdrop-blur-[8px]", size === "wide" ? "max-w-[1180px]" : "max-w-[1020px]")}
    >
      {open && (
        <div className="flex max-h-[min(90vh,960px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-fg/[0.06] px-5 py-4 sm:px-7">
            <div>
              <p className="text-[11.5px] font-semibold tracking-[0.16em] text-fg/45 uppercase">{eyebrow}</p>
              <h2 id={id} className="mt-0.5 text-[22px] font-[450] tracking-[-0.025em] sm:text-[26px]">{title}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-fg/[0.1] transition-colors hover:bg-fg/[0.05]"><X className="size-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ─── Plans + the two pop-ups ─────────────────────────────────────────────────

export function PricingSection({ plans, pricing, free }: { plans: CatalogPlan[]; pricing: PublicPricing; free?: CatalogPlan | null }) {
  const [interval, setInterval] = useState<Interval>("month");
  const [popup, setPopup] = useState<"build" | "compare" | null>(null);
  const [preset, setPreset] = useState<Industry["id"] | null>(null);
  const openBuild = (industry?: Industry["id"]) => {
    setPreset(industry ?? null);
    setPopup("build");
  };
  return (
    <div>
      <div className="flex justify-center">
        <Toggle value={interval} onChange={setInterval} months={pricing.yearlyMonths} />
      </div>
      <PricingPlans plans={plans} pricing={pricing} free={free} interval={interval} onCompare={() => setPopup("compare")} />

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => openBuild()} className="group flex items-center gap-4 rounded-[22px] bg-fg p-5 text-left text-bg transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-24px_rgb(20_10_60/0.6)]">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/12"><SlidersHorizontal className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-medium">Customise your plan</span>
            <span className="block text-[13.5px] text-bg/65">Pick a preset for your industry, then add or remove features. Prices update as you go.</span>
          </span>
          <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
        <button type="button" onClick={() => setPopup("compare")} className="group flex items-center gap-4 rounded-[22px] bg-white p-5 text-left ring-1 ring-fg/[0.08] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-30px_rgb(20_10_60/0.35)]">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-fg/[0.05]"><Table2 className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-medium">Compare plans</span>
            <span className="block text-[13.5px] text-fg/55">Every feature and limit, plan by plan, in one table.</span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-fg/50 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <span className="mr-1 text-[13px] text-fg/50">Presets for:</span>
        {INDUSTRIES.filter((i) => i.id !== "other").slice(0, 8).map((i) => (
          <button key={i.id} type="button" onClick={() => openBuild(i.id)} className="inline-flex h-8 items-center gap-2 rounded-full bg-white px-3 text-[13px] ring-1 ring-fg/[0.08] transition-colors hover:ring-fg/25">
            <span className={clsx("size-1.5 rounded-full", TINT_DOT[i.tint])} />{i.label}
          </button>
        ))}
        <button type="button" onClick={() => openBuild()} className="inline-flex h-8 items-center rounded-full px-3 text-[13px] text-fg/60 underline-offset-4 hover:underline">more…</button>
      </div>

      <Popup open={popup === "build"} onClose={() => setPopup(null)} eyebrow="Customise your plan" title="Only the features you use.">
        {popup === "build" && <BuildYourOwn plans={plans} pricing={pricing} interval={interval} onInterval={setInterval} preset={preset} />}
      </Popup>
      <Popup open={popup === "compare"} onClose={() => setPopup(null)} eyebrow="Compare plans" title="Every feature, plan by plan." size="table">
        {popup === "compare" && (
          <div className="px-5 pb-6 sm:px-7">
            <Comparison plans={plans} />
          </div>
        )}
      </Popup>
    </div>
  );
}

export function PricingPlans({ plans, pricing, free, interval, onCompare }: { plans: CatalogPlan[]; pricing: PublicPricing; free?: CatalogPlan | null; interval: Interval; onCompare?: () => void }) {
  const full = asFull(pricing);
  return (
    <div className={clsx("mt-10 grid gap-4 md:grid-cols-2", free ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
      {free && <FreeCard p={free} trialDays={pricing.trialDays} />}
      {plans.map((p) => {
        const q = quote({ kind: "plan", planId: p.id, interval }, plans, full);
        return (
          <div key={p.id} className={clsx("relative flex flex-col rounded-[24px] bg-white p-6 ring-1", p.highlight ? "shadow-[0_30px_70px_-35px_rgb(80_40_160/0.45)] ring-[#7c5cff]/40" : "ring-fg/[0.07]")}>
            {p.highlight && <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-[#1d1d24] px-3 py-1 text-[11.5px] font-medium text-white"><Sparkles className="size-3" /> Most popular</span>}
            <p className="text-[13px] font-semibold tracking-[0.12em] text-fg/45 uppercase">{p.kind === "basic" ? "Basic" : "Plan"}</p>
            <h3 className="mt-1 text-[24px] font-[450] tracking-[-0.02em]">{p.name}</h3>
            <p className="mt-1 min-h-[2.6em] text-[14px] leading-snug text-fg/55">{p.tagline}</p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-[36px] font-[420] tracking-[-0.03em] tabular-nums">{money(q.monthly, p.currency)}</span>
              <span className="text-[14px] text-fg/50">/ month</span>
            </p>
            <p className="text-[12.5px] text-fg/45">{interval === "year" ? `${money(q.amount, p.currency)} billed yearly` : "billed monthly"} · plus {pricing.taxLabel}</p>
            <Link href={`/start?plan=${p.id}&interval=${interval}`} className={clsx("mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-full text-[14.5px] font-medium transition-colors", p.highlight ? "bg-fg text-bg hover:opacity-90" : "ring-1 ring-fg/[0.12] hover:bg-fg/[0.04]")}>
              Start {pricing.trialDays}-day free trial <ArrowRight className="size-4" />
            </Link>
            <ul className="mt-6 space-y-2 border-t border-fg/[0.06] pt-5 text-[13.5px] text-fg/75">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {p.modules === null ? "Every feature in Cloudesk" : `${p.modules.length} features`}</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {unlimited(p.limits.seats)} team seats</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {p.limits.projects ? `${unlimited(p.limits.projects)} web apps & stores` : "No web apps"}</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {p.limits.customDomains ? `${unlimited(p.limits.customDomains)} custom domain${p.limits.customDomains === 1 ? "" : "s"}` : "Cloudesk address only"}</li>
              {p.modules && p.modules.slice(0, 6).map((m) => <li key={m} className="flex gap-2 text-fg/60"><Check className="mt-0.5 size-4 shrink-0 text-fg/30" /> {nameOf(m)}</li>)}
              {p.modules && p.modules.length > 6 && (
                <li className="pl-6 text-fg/45">
                  and {p.modules.length - 6} more{onCompare ? <> — <button type="button" onClick={onCompare} className="text-fg/70 underline underline-offset-4 hover:text-fg">compare</button></> : ""}
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

const QUOTA_TEXT: Record<string, (n: number) => string> = { invoicesPerMonth: (n) => `${n} invoices a month`, contacts: (n) => `${n.toLocaleString("en-IN")} CRM contacts`, aiPerMonth: (n) => `${n} AI requests a month` };

function FreeCard({ p, trialDays }: { p: CatalogPlan; trialDays: number }) {
  return (
    <div className="relative flex flex-col rounded-[24px] bg-white/60 p-6 ring-1 ring-fg/[0.07]">
      <p className="text-[13px] font-semibold tracking-[0.12em] text-fg/45 uppercase">After the trial</p>
      <h3 className="mt-1 text-[24px] font-[450] tracking-[-0.02em]">{p.name}</h3>
      <p className="mt-1 min-h-[2.6em] text-[14px] leading-snug text-fg/55">{p.tagline}</p>
      <p className="mt-5 flex items-baseline gap-1.5"><span className="text-[36px] font-[420] tracking-[-0.03em] tabular-nums">₹0</span><span className="text-[14px] text-fg/50">forever</span></p>
      <p className="text-[12.5px] text-fg/45">Starts with {trialDays} days of everything</p>
      <Link href="/start" className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-full text-[14.5px] font-medium ring-1 ring-fg/[0.12] hover:bg-fg/[0.04]">Start free <ArrowRight className="size-4" /></Link>
      <ul className="mt-6 space-y-2 border-t border-fg/[0.06] pt-5 text-[13.5px] text-fg/75">
        {(p.modules ?? []).map((m) => <li key={m} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {nameOf(m)}</li>)}
        {Object.entries(p.quotas ?? {}).map(([k, n]) => <li key={k} className="flex gap-2 text-fg/60"><Minus className="mt-0.5 size-4 shrink-0 text-fg/30" /> {QUOTA_TEXT[k]?.(n) ?? `${k}: ${n}`}</li>)}
        <li className="flex gap-2 text-fg/60"><Minus className="mt-0.5 size-4 shrink-0 text-fg/30" /> {p.limits.seats} team seats · {p.limits.projects} web app · Cloudesk address</li>
        <li className="flex gap-2 text-fg/60"><Minus className="mt-0.5 size-4 shrink-0 text-fg/30" /> “Made with Cloudesk” on your site</li>
      </ul>
    </div>
  );
}

// ─── Build your own ──────────────────────────────────────────────────────────

const DEFAULT_PICK: ModuleId[] = ["crm", "invoicing"];
const sameSet = (a: ModuleId[], b: ModuleId[]) => a.length === b.length && a.every((x) => b.includes(x));

export function BuildYourOwn({ plans, pricing, interval, onInterval, preset }: { plans: CatalogPlan[]; pricing: PublicPricing; interval: Interval; onInterval: (v: Interval) => void; preset?: Industry["id"] | null }) {
  const base = useMemo(() => new Set(pricing.customBaseModules), [pricing.customBaseModules]);
  // A preset is the industry's features, minus what the base already includes and anything that isn't sold on its own.
  const sellable = (ids: ModuleId[]) => ids.filter((m) => !base.has(m) && typeof pricing.modulePrices[m] === "number");
  const presets = INDUSTRIES.filter((i) => i.id !== "other").map((i) => ({ ...i, pick: sellable(i.modules) }));
  const [picked, setPicked] = useState<ModuleId[]>(() => presets.find((p) => p.id === preset)?.pick ?? DEFAULT_PICK);
  const [seats, setSeats] = useState(pricing.customSeatsIncluded);
  const q = useMemo(() => quote({ kind: "custom", modules: picked, seats, interval }, plans, asFull(pricing)), [picked, seats, interval, plans]); // eslint-disable-line react-hooks/exhaustive-deps
  const added = new Set(withRequirements(picked));
  const toggle = (m: ModuleId) => setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));
  const tax = taxOf(q.amount, pricing.taxBps);
  const active = presets.find((p) => sameSet(p.pick, picked))?.id ?? null;
  const extras = [...added].filter((m) => !base.has(m));
  const summary = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[14px]">Team seats <span className="text-fg/45">({pricing.customSeatsIncluded} included)</span></span>
        <span className="inline-flex items-center gap-2">
          <button type="button" aria-label="Fewer seats" disabled={seats <= pricing.customSeatsIncluded} onClick={() => setSeats(seats - 1)} className="grid size-8 place-items-center rounded-full ring-1 ring-fg/15 disabled:opacity-30"><Minus className="size-3.5" /></button>
          <span className="w-8 text-center text-[15px] font-medium tabular-nums">{seats}</span>
          <button type="button" aria-label="More seats" onClick={() => setSeats(Math.min(10000, seats + 1))} className="grid size-8 place-items-center rounded-full ring-1 ring-fg/15"><Plus className="size-3.5" /></button>
        </span>
      </div>
      <ul className="mt-4 space-y-1.5 border-t border-fg/[0.06] pt-4 text-[13.5px]">
        {q.lines.map((l) => (
          <li key={l.label} className="flex justify-between gap-3"><span className="text-fg/65">{l.module ? nameOf(l.module) : l.label}</span><span className="tabular-nums">{money(l.amount, q.currency)}</span></li>
        ))}
        <li className="flex justify-between gap-3 text-fg/50"><span>{pricing.taxLabel} ({pricing.taxBps / 100}%)</span><span className="tabular-nums">{money(tax, q.currency)}</span></li>
      </ul>
    </>
  );
  const total = (
    <div className="flex items-baseline justify-between">
      <span className="text-[14px] text-fg/60">Total {interval === "year" ? "per year" : "per month"}</span>
      <span className="text-[26px] font-[450] tracking-[-0.02em] tabular-nums">{money(q.amount + tax, q.currency)}</span>
    </div>
  );
  const cta = (
    <Link href={`/start?build=${encodeURIComponent(picked.join(","))}&seats=${seats}&interval=${interval}`} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-fg text-[14.5px] font-medium text-bg hover:opacity-90">
      Start {pricing.trialDays}-day free trial <ArrowRight className="size-4" />
    </Link>
  );
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="px-5 py-5 sm:px-7">
        {/* Step 1: presets */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11.5px] font-semibold tracking-[0.12em] text-fg/40 uppercase">1 · Start from your industry</p>
            <p className="mt-1 text-[13.5px] text-fg/55">A preset picks the features businesses like yours use. Change anything after.</p>
          </div>
          <Toggle value={interval} onChange={onInterval} months={pricing.yearlyMonths} compact />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-3 sm:overflow-visible md:grid-cols-4 [&::-webkit-scrollbar]:hidden">
          {presets.map((p) => {
            const on = active === p.id;
            return (
              <button key={p.id} type="button" aria-pressed={on} onClick={() => setPicked(p.pick)} className={clsx("flex w-[168px] shrink-0 flex-col items-start rounded-[14px] p-3 text-left ring-1 transition-colors sm:w-auto", on ? "bg-fg text-bg ring-fg" : "bg-white ring-fg/[0.08] hover:ring-fg/25")}>
                <span className="flex items-center gap-2 text-[13.5px] font-medium"><span className={clsx("size-2 rounded-full", on ? "bg-bg/70" : TINT_DOT[p.tint])} />{p.label}</span>
                <span className={clsx("mt-0.5 line-clamp-1 text-[12px]", on ? "text-bg/60" : "text-fg/45")}>{p.line}</span>
                <span className={clsx("mt-2 text-[11.5px] tabular-nums", on ? "text-bg/70" : "text-fg/40")}>{p.pick.length} features</span>
              </button>
            );
          })}
          <button type="button" onClick={() => setPicked([])} className={clsx("flex w-[168px] shrink-0 flex-col items-start justify-center rounded-[14px] p-3 text-left ring-1 ring-dashed transition-colors sm:w-auto", picked.length === 0 ? "bg-fg/[0.04] ring-fg/30" : "ring-fg/15 hover:ring-fg/30")}>
            <span className="flex items-center gap-2 text-[13.5px] font-medium"><RotateCcw className="size-3.5" />Start blank</span>
            <span className="mt-0.5 text-[12px] text-fg/45">Just {[...base].map(nameOf).join(", ")}</span>
          </button>
        </div>

        {/* Step 2: features */}
        <div className="mt-7">
          <p className="text-[11.5px] font-semibold tracking-[0.12em] text-fg/40 uppercase">2 · Add or remove features</p>
          <p className="mt-1 text-[13.5px] text-fg/55">Always included: <span className="font-medium text-fg">{[...base].map(nameOf).join(", ")}</span> with {pricing.customSeatsIncluded} seats.</p>
        </div>
        {MODULE_GROUPS.map((g) => {
          const mods = MODULES.filter((m) => m.group === g.id && !base.has(m.id) && typeof pricing.modulePrices[m.id] === "number");
          if (!mods.length) return null;
          return (
            <div key={g.id} className="mt-5">
              <p className="text-[12.5px] font-medium text-fg/70">{g.label} <span className="font-normal text-fg/40">— {g.line}</span></p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {mods.map((m) => {
                  const on = picked.includes(m.id);
                  const via = !on && added.has(m.id);
                  return (
                    <button key={m.id} type="button" aria-pressed={on || via} onClick={() => toggle(m.id)} className={clsx("flex items-start gap-3 rounded-[14px] p-3 text-left ring-1 transition-colors", on ? "bg-fg/[0.04] ring-fg/25" : via ? "bg-fg/[0.02] ring-fg/10" : "bg-white ring-fg/[0.07] hover:ring-fg/20")}>
                      <span className={clsx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] ring-1", on || via ? "bg-fg text-bg ring-fg" : "ring-fg/25")}>{(on || via) && <Check className="size-3.5" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2"><span className="text-[14px] font-medium">{m.name}</span><span className="text-[13px] text-fg/55 tabular-nums">{money(pricing.modulePrices[m.id]!, pricing.currency)}/mo</span></span>
                        <span className="mt-0.5 line-clamp-1 text-[12.5px] text-fg/45">{via ? `Added — ${[...added].filter((x) => picked.includes(x) && moduleById(x)?.requires?.includes(m.id)).map(nameOf).join(", ") || "another feature"} needs it` : m.short}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary: a sticky column on wide screens, a sticky bar at the bottom on phones. */}
      <aside className="hidden border-l border-fg/[0.06] bg-fg/[0.02] lg:block">
        <div className="sticky top-0 p-6">
          <p className="text-[13px] font-semibold tracking-[0.12em] text-fg/45 uppercase">Your plan</p>
          <p className="mt-1 text-[13px] text-fg/55">{extras.length ? `${extras.length} feature${extras.length === 1 ? "" : "s"} on top of the base` : "Just the base"}{active ? ` · ${presets.find((p) => p.id === active)!.label} preset` : ""}</p>
          <div className="mt-4">{summary}</div>
          <div className="mt-4 border-t border-fg/[0.06] pt-4">{total}</div>
          {interval === "year" && <p className="mt-1 text-right text-[12.5px] text-fg/45">{money(q.monthly, q.currency)} a month before {pricing.taxLabel}</p>}
          <div className="mt-5">{cta}</div>
          <p className="mt-3 text-center text-[12.5px] text-fg/45">Everything is free for {pricing.trialDays} days. No card needed.</p>
        </div>
      </aside>
      <div className="sticky bottom-0 border-t border-fg/[0.08] bg-white/95 px-5 py-3 backdrop-blur lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:hidden">
            <span className="text-[13px] text-fg/60">{extras.length} feature{extras.length === 1 ? "" : "s"} · {seats} seats <span className="underline underline-offset-4">details</span></span>
            <span className="text-[20px] font-[450] tracking-[-0.02em] tabular-nums">{money(q.amount + tax, q.currency)}<span className="ml-1 text-[12px] text-fg/50">/{interval === "year" ? "yr" : "mo"}</span></span>
          </summary>
          <div className="mt-3 max-h-[40vh] overflow-y-auto">{summary}</div>
        </details>
        <div className="mt-3">{cta}</div>
      </div>
    </div>
  );
}

// ─── Comparison ──────────────────────────────────────────────────────────────

export function Comparison({ plans }: { plans: CatalogPlan[] }) {
  const has = (p: CatalogPlan, m: ModuleId) => p.modules === null || p.modules.includes(m);
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13.5px]">
        <thead className="sticky top-0 z-10 bg-white">
          <tr>
            <th className="sticky left-0 bg-white py-3 text-left font-medium text-fg/50">Feature</th>
            {plans.map((p) => <th key={p.id} className="py-3 text-center font-[500]">{p.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {[
            ["Team seats", (p: CatalogPlan) => unlimited(p.limits.seats)],
            ["Web apps & stores", (p: CatalogPlan) => unlimited(p.limits.projects)],
            ["Custom domains", (p: CatalogPlan) => unlimited(p.limits.customDomains)],
            ["Automations per web app", (p: CatalogPlan) => unlimited(p.limits.automationsPerProject)],
          ].map(([label, f]) => (
            <tr key={label as string}>
              <td className="sticky left-0 border-t border-fg/[0.06] bg-white py-2.5 text-fg/70">{label as string}</td>
              {plans.map((p) => <td key={p.id} className="border-t border-fg/[0.06] py-2.5 text-center tabular-nums">{(f as (p: CatalogPlan) => string)(p)}</td>)}
            </tr>
          ))}
          {MODULE_GROUPS.map((g) => (
            <Fragment key={g.id}>
              <tr><td colSpan={plans.length + 1} className="pt-6 pb-2 text-[11.5px] font-semibold tracking-[0.12em] text-fg/40 uppercase">{g.label}</td></tr>
              {MODULES.filter((m) => m.group === g.id).map((m) => (
                <tr key={m.id}>
                  <td className="sticky left-0 border-t border-fg/[0.06] bg-white py-2.5 text-fg/70">{m.name}</td>
                  {plans.map((p) => (
                    <td key={p.id} className="border-t border-fg/[0.06] py-2.5 text-center">
                      {has(p, m.id) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Included" /> : <Minus className="mx-auto size-4 text-fg/20" aria-label="Not included" />}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
