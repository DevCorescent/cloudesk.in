"use client";

// Sign-up's plan step: everything is free for the trial; this picks what comes
// after it. A plan from the catalogue, a plan built feature by feature (with a
// live, itemised price), or nothing yet. Prices come from the server's
// catalogue and are worked out with the same maths the server uses.
import clsx from "clsx";
import { Check, ChevronDown, Gift, Minus, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { money, quote, QuoteError, taxOf, type CatalogPlan, type Choice, type Interval, type Pricing, type Quote } from "@/lib/billing/catalog";
import { MODULE_GROUPS, moduleById, MODULES, neededBy, withRequirements, type ModuleId } from "@/lib/workspace/modules";

/** What GET /api/v1/plans returns. */
export type PublicPricing = Pick<Pricing, "currency" | "trialDays" | "taxBps" | "taxLabel" | "yearlyMonths" | "customBase" | "customBaseModules" | "customSeatsIncluded" | "seatPrice" | "customLimits" | "modulePrices">;
export type Catalog = { plans: CatalogPlan[]; pricing: PublicPricing };

/** The person's pick on this step (a Choice, or "later"). */
export type PlanPick = { kind: "plan"; planId: string } | { kind: "custom"; modules: ModuleId[]; seats: number } | { kind: "later" };

export const toChoice = (pick: PlanPick, interval: Interval): Choice | undefined => (pick.kind === "plan" ? { kind: "plan", planId: pick.planId, interval } : pick.kind === "custom" ? { kind: "custom", modules: pick.modules, seats: pick.seats, interval } : undefined);

/** Prices a pick; null when it can't be priced (or nothing was picked). */
export function priceOf(pick: PlanPick, interval: Interval, catalog: Catalog): Quote | null {
  const choice = toChoice(pick, interval);
  if (!choice) return null;
  try {
    return quote(choice, catalog.plans, catalog.pricing as Pricing);
  } catch (e) {
    if (e instanceof QuoteError) return null;
    throw e;
  }
}

export const featureName = (id: string) => moduleById(id)?.name ?? id;
const names = (ids: string[]) => (ids.length <= 2 ? ids.join(" and ") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`);
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** The starting point for building your own: the features chosen earlier, minus the base. */
export const customFrom = (modules: ModuleId[], pricing: PublicPricing): PlanPick => ({ kind: "custom", modules: modules.filter((m) => !pricing.customBaseModules.includes(m) && typeof pricing.modulePrices[m] === "number"), seats: pricing.customSeatsIncluded });

export function ChoosePlan({ catalog, chosen, pick, onPick, interval, onInterval }: { catalog: Catalog; chosen: ModuleId[]; pick: PlanPick; onPick: (p: PlanPick) => void; interval: Interval; onInterval: (i: Interval) => void }) {
  const { plans, pricing } = catalog;
  const free = 12 - pricing.yearlyMonths;
  const [lastCustom, setLastCustom] = useState<PlanPick>(() => (pick.kind === "custom" ? pick : customFrom(chosen, pricing)));
  const custom = pick.kind === "custom" ? pick : (lastCustom as Extract<PlanPick, { kind: "custom" }>);
  const setCustom = (p: Extract<PlanPick, { kind: "custom" }>) => {
    setLastCustom(p);
    onPick(p);
  };
  // Phones show the builder folded into one line until it's opened.
  const [building, setBuilding] = useState(false);
  const customQuote = useMemo(() => priceOf(custom, interval, catalog), [custom, interval, catalog]);
  return (
    <div className="grid gap-6 max-sm:gap-2.5">
      <div className="p-glass p-in flex flex-col gap-3 rounded-[24px] p-4 max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:rounded-[18px] max-sm:py-2 max-sm:pr-2 max-sm:pl-3.5 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--p-mint)] text-[var(--p-mint-ink)] max-sm:hidden">
          <Gift className="size-5" />
        </span>
        <p className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-fg/70 max-sm:hidden">
          <b className="font-semibold text-fg">Everything is free for {pricing.trialDays} days — no card needed.</b> Pick what you&apos;d like after the trial; you can change it any time.
        </p>
        <p className="flex items-center gap-1.5 text-[12.5px] leading-tight font-medium text-fg/70 sm:hidden">
          <Gift className="size-4 shrink-0 text-[var(--p-mint-ink)]" /> {pricing.trialDays} days free
        </p>
        <div role="radiogroup" aria-label="Billing period" className="inline-flex shrink-0 self-start rounded-full bg-fg/[0.06] p-1 max-sm:self-auto sm:self-auto">
          {(["month", "year"] as const).map((i) => (
            <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => onInterval(i)} className={clsx("inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-all max-sm:h-8 max-sm:px-3 max-sm:text-[12.5px]", interval === i ? "bg-[var(--surface-solid)] text-fg shadow-sm" : "text-fg/55 hover:text-fg")}>
              {i === "month" ? "Monthly" : "Yearly"}
              {i === "year" && free > 0 && <span className="rounded-full bg-[var(--p-mint)] px-1.5 py-px text-[11px] font-semibold text-[var(--p-mint-ink)]">{count(free, "month")} free</span>}
            </button>
          ))}
        </div>
      </div>

      <div role="radiogroup" aria-label="Plan after the trial" className="grid gap-3 max-sm:gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} interval={interval} chosen={chosen} selected={pick.kind === "plan" && pick.planId === p.id} onSelect={() => onPick({ kind: "plan", planId: p.id })} delay={i * 50} />
        ))}
      </div>

      <div className={clsx("p-in overflow-hidden rounded-[24px] border transition-all duration-300", pick.kind === "custom" ? "border-fg bg-[var(--surface-solid)] shadow-[0_24px_50px_-34px_rgb(30_20_60/0.7)]" : "border-fg/[0.08] bg-[var(--surface-solid)]/70")}>
        <button type="button" role="radio" aria-checked={pick.kind === "custom"} onClick={() => onPick(custom)} className="flex w-full items-center gap-3 p-4 text-left max-sm:px-3.5 max-sm:py-3 sm:p-5">
          <span className={clsx("grid size-10 shrink-0 place-items-center rounded-[13px] max-sm:size-8 max-sm:rounded-[10px]", pick.kind === "custom" ? "bg-fg text-bg" : "bg-[var(--p-lavender)] text-[var(--p-lavender-ink)]")}>
            <Sparkles className="size-[18px] max-sm:size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[16px] font-semibold tracking-[-0.01em] max-sm:text-[15px]">Build your own</b>
            <span className="block text-[13px] text-fg/55 max-sm:hidden">Mail, Calendar and Chat, plus only the features you want — starting with the ones you picked.</span>
          </span>
          {customQuote && (
            <span className="text-right sm:hidden">
              <b className="block text-[15px] font-semibold tracking-[-0.02em] tabular-nums">{money(customQuote.amount, customQuote.currency)}</b>
              <span className="block text-[11px] text-fg/45">/{interval === "year" ? "year" : "month"}</span>
            </span>
          )}
          <Radio on={pick.kind === "custom"} />
        </button>
        {pick.kind === "custom" && (
          <>
            <button type="button" aria-expanded={building} onClick={() => setBuilding(!building)} className="flex w-full items-center justify-between gap-2 border-t border-fg/[0.06] px-3.5 py-2.5 text-[12.5px] text-fg/60 sm:hidden">
              <span>
                {count(custom.modules.length + pricing.customBaseModules.length, "feature")} · {count(custom.seats, "person", "people")}
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-fg">
                {building ? "Done" : "Customise"} <ChevronDown className={clsx("size-3.5 transition-transform", building && "rotate-180")} />
              </span>
            </button>
            <div className={clsx(!building && "max-sm:hidden")}>
              <Builder catalog={catalog} pick={custom} onPick={setCustom} interval={interval} />
            </div>
          </>
        )}
      </div>

      <button type="button" role="radio" aria-checked={pick.kind === "later"} onClick={() => onPick({ kind: "later" })} className={clsx("flex items-center gap-3 rounded-[20px] border px-4 py-3.5 text-left transition-all max-sm:rounded-[16px] max-sm:px-3.5 max-sm:py-3 sm:px-5", pick.kind === "later" ? "border-fg bg-[var(--surface-solid)]" : "border-dashed border-fg/15 hover:border-fg/30")}>
        <span className="min-w-0 flex-1">
          <b className="block text-[14.5px] font-semibold">Decide later</b>
          <span className="block text-[12.5px] text-fg/55 max-sm:hidden">Use everything during the trial and choose a plan before it ends, in Settings → Billing.</span>
        </span>
        <Radio on={pick.kind === "later"} />
      </button>
    </div>
  );
}

const Radio = ({ on }: { on: boolean }) => (
  <span aria-hidden className={clsx("grid size-6 shrink-0 place-items-center rounded-full border-2 transition-all", on ? "border-fg bg-fg text-bg" : "border-fg/20")}>{on && <Check className="size-3.5" />}</span>
);

function PlanCard({ plan, interval, chosen, selected, onSelect, delay }: { plan: CatalogPlan; interval: Interval; chosen: ModuleId[]; selected: boolean; onSelect: () => void; delay: number }) {
  const [more, setMore] = useState(false);
  const perMonth = interval === "year" ? Math.round(plan.yearly / 12) : plan.monthly;
  const missing = plan.modules ? chosen.filter((m) => !plan.modules!.includes(m)).map(featureName) : [];
  const included = plan.modules?.map(featureName) ?? [];
  const shown = more ? included : included.slice(0, 6);
  const l = plan.limits;
  return (
    <div className={clsx("p-in relative flex flex-col rounded-[24px] border bg-[var(--surface-solid)] transition-all duration-300 max-sm:rounded-[16px]", selected ? "border-fg shadow-[0_24px_50px_-30px_rgb(30_20_60/0.7)]" : plan.highlight ? "border-[color-mix(in_srgb,var(--p-lavender-ink)_45%,transparent)]" : "border-fg/[0.08]")} style={{ animationDelay: `${delay}ms` }}>
      {plan.highlight && <span className="absolute -top-2.5 left-4 rounded-full bg-[var(--p-lavender-ink)] px-2.5 py-0.5 text-[11px] font-semibold text-white max-sm:right-12 max-sm:left-auto max-sm:text-[10px]">Recommended</span>}
      {/* Phones: one row — name and fit on the left, price and the radio on the right. */}
      <button type="button" role="radio" aria-checked={selected} aria-label={`${plan.name}, ${money(perMonth, plan.currency)} a month`} onClick={onSelect} className="grid gap-3 p-4 pb-3 text-left max-sm:grid-cols-[minmax(0,1fr)_auto_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-0 max-sm:px-3.5 max-sm:py-3 sm:p-5 sm:pb-3">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <b className="block text-[17px] font-semibold tracking-[-0.015em] max-sm:text-[15px]">{plan.name}</b>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-fg/55 max-sm:hidden">{plan.kind === "basic" && plan.modules?.length === 3 ? "Mail, Calendar and Chat" : plan.tagline}</span>
            {plan.modules !== null && chosen.length > 0 && (
              <span className={clsx("mt-0.5 block truncate text-[11.5px] sm:hidden", missing.length ? "text-[var(--p-butter-ink)]" : "text-[var(--p-mint-ink)]")}>{missing.length ? `Leaves out ${count(missing.length, "feature")} you picked` : "Covers everything you picked"}</span>
            )}
            {plan.modules === null && <span className="mt-0.5 block text-[11.5px] text-[var(--p-mint-ink)] sm:hidden">Every feature</span>}
          </span>
          <span className="max-sm:hidden">
            <Radio on={selected} />
          </span>
        </span>
        <span className="max-sm:text-right">
          <span className="text-[28px] font-semibold tracking-[-0.03em] tabular-nums max-sm:text-[17px]">{money(perMonth, plan.currency)}</span>
          <span className="text-[13px] text-fg/50 max-sm:block max-sm:text-[11px]"> /month</span>
          <span className="block text-[12px] text-fg/45 max-sm:hidden">{interval === "year" ? `${money(plan.yearly, plan.currency)} billed yearly` : "billed monthly"}, plus tax</span>
        </span>
        <span className="sm:hidden">
          <Radio on={selected} />
        </span>
      </button>
      <div className="grid flex-1 content-start gap-3 border-t border-fg/[0.06] px-4 py-3.5 text-[12.5px] max-sm:hidden sm:px-5">
        <ul className="grid gap-1 text-fg/65">
          <li className="flex items-center gap-1.5"><Check className="size-3.5 shrink-0 text-[var(--p-mint-ink)]" /> {l.seats ? `Up to ${count(l.seats, "person", "people")}` : "No team members"}</li>
          <li className="flex items-center gap-1.5"><Check className="size-3.5 shrink-0 text-[var(--p-mint-ink)]" /> {l.projects ? count(l.projects, "web app") : "No web apps"}</li>
          <li className="flex items-center gap-1.5"><Check className="size-3.5 shrink-0 text-[var(--p-mint-ink)]" /> {l.customDomains ? count(l.customDomains, "custom domain") : "No custom domains"}</li>
        </ul>
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.1em] text-fg/40 uppercase">Includes</p>
          {plan.modules === null ? (
            <p className="font-medium text-fg/75">Every feature</p>
          ) : (
            <p className="leading-relaxed text-fg/65">
              {shown.join(" · ")}
              {included.length > 6 && (
                <button type="button" onClick={() => setMore(!more)} className="ml-1 font-medium text-fg underline-offset-2 hover:underline">
                  {more ? "Show less" : `+${included.length - 6} more`}
                </button>
              )}
            </p>
          )}
        </div>
        {plan.modules !== null && chosen.length > 0 && (
          missing.length ? (
            <p className="flex items-start gap-1.5 rounded-[12px] bg-[var(--p-butter)] px-2.5 py-2 leading-snug text-[var(--p-butter-ink)]">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                {plan.name} doesn&apos;t include {missing.length > 4 ? `${names(missing.slice(0, 3))} and ${missing.length - 3} more you picked` : names(missing)}
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 rounded-[12px] bg-[var(--p-mint)] px-2.5 py-2 leading-snug text-[var(--p-mint-ink)]">
              <Check className="mt-px size-3.5 shrink-0" /> Covers everything you picked
            </p>
          )
        )}
      </div>
    </div>
  );
}

function Builder({ catalog, pick, onPick, interval }: { catalog: Catalog; pick: Extract<PlanPick, { kind: "custom" }>; onPick: (p: Extract<PlanPick, { kind: "custom" }>) => void; interval: Interval }) {
  const { pricing } = catalog;
  const [auto, setAuto] = useState<string | null>(null);
  const base = pricing.customBaseModules;
  const q = useMemo(() => priceOf(pick, interval, catalog), [pick, interval, catalog]);
  const toggle = (id: ModuleId) => {
    const on = pick.modules.includes(id);
    if (on) {
      const gone = neededBy(id, pick.modules);
      setAuto(gone.length ? `${names(gone.map(featureName))} ${gone.length === 1 ? "was" : "were"} switched off too — ${gone.length === 1 ? "it needs" : "they need"} ${featureName(id)}.` : null);
      return onPick({ ...pick, modules: pick.modules.filter((m) => m !== id && !gone.includes(m)) });
    }
    const next = withRequirements([...pick.modules, id]).filter((m) => !base.includes(m));
    const added = next.filter((m) => m !== id && !pick.modules.includes(m));
    setAuto(added.length ? `${names(added.map(featureName))} ${added.length === 1 ? "was" : "were"} added — ${featureName(id)} needs ${added.length === 1 ? "it" : "them"}.` : null);
    onPick({ ...pick, modules: next });
  };
  const seats = (n: number) => onPick({ ...pick, seats: Math.max(pricing.customSeatsIncluded, Math.min(10000, Math.floor(n) || pricing.customSeatsIncluded)) });
  const tax = q ? taxOf(q.amount, pricing.taxBps) : 0;
  const per = interval === "year" ? "year" : "month";
  return (
    <div className="grid gap-6 border-t border-fg/[0.06] p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid content-start gap-5">
        <div className="flex flex-wrap items-center gap-2 rounded-[16px] bg-fg/[0.03] px-3.5 py-3 text-[13px]">
          <b className="font-semibold">Always included:</b>
          {base.map((m) => (
            <span key={m} className="inline-flex items-center gap-1 text-fg/70">
              <Check className="size-3.5 text-[var(--p-mint-ink)]" /> {featureName(m)}
            </span>
          ))}
          <span className="text-fg/50">· {count(pricing.customSeatsIncluded, "person", "people")} · {money(pricing.customBase, pricing.currency)}/month</span>
        </div>
        {auto && (
          <p role="status" className="rounded-[12px] bg-[var(--p-sky)] px-3 py-2 text-[12.5px] text-[var(--p-sky-ink)]">
            {auto}
          </p>
        )}
        {MODULE_GROUPS.map((g) => {
          const list = MODULES.filter((m) => m.group === g.id && !base.includes(m.id));
          if (!list.length) return null;
          return (
            <fieldset key={g.id} className="grid gap-2">
              <legend className="mb-2 px-1 text-[11.5px] font-semibold tracking-[0.12em] text-fg/45 uppercase">{g.label}</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {list.map((m) => {
                  const price = pricing.modulePrices[m.id];
                  const on = pick.modules.includes(m.id);
                  return (
                    <label key={m.id} className={clsx(`tint-${m.tint}`, "flex cursor-pointer items-center gap-2.5 rounded-[14px] border px-3 py-2.5 transition-colors", on ? "border-[color-mix(in_srgb,var(--t-ink)_40%,transparent)] bg-[color-mix(in_srgb,var(--t)_45%,var(--surface-solid))]" : "border-fg/[0.07] hover:border-fg/20", typeof price !== "number" && "cursor-not-allowed opacity-50")}>
                      <input type="checkbox" checked={on} disabled={typeof price !== "number"} onChange={() => toggle(m.id)} className="size-4 shrink-0 accent-[var(--t-ink)]" />
                      <span className="tint-chip grid size-7 shrink-0 place-items-center rounded-[9px]">
                        <ModuleGlyph id={m.id} className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium" title={m.short}>{m.name}</span>
                      <span className="shrink-0 text-[12.5px] text-fg/55 tabular-nums">{typeof price === "number" ? `${money(price, pricing.currency)}/mo` : "Not available"}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      <aside className="grid content-start gap-4 lg:sticky lg:top-24">
        <div className="rounded-[20px] bg-fg/[0.03] p-4">
          <p className="mb-2 text-[12.5px] font-semibold text-fg/60" id="seats-label">People</p>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Fewer people" disabled={pick.seats <= pricing.customSeatsIncluded} onClick={() => seats(pick.seats - 1)} className="grid size-10 place-items-center rounded-full bg-[var(--surface-solid)] ring-1 ring-fg/10 disabled:opacity-40">
              <Minus className="size-4" />
            </button>
            <input aria-labelledby="seats-label" inputMode="numeric" value={pick.seats} onChange={(e) => seats(Number(e.target.value.replace(/\D/g, "")))} className="h-10 w-20 rounded-[12px] border border-fg/10 bg-[var(--surface-solid)] text-center text-[16px] font-semibold tabular-nums outline-none focus:border-fg/40" />
            <button type="button" aria-label="More people" onClick={() => seats(pick.seats + 1)} className="grid size-10 place-items-center rounded-full bg-[var(--surface-solid)] ring-1 ring-fg/10">
              <Plus className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-[12px] text-fg/50">{count(pricing.customSeatsIncluded, "person", "people")} included, then {money(pricing.seatPrice, pricing.currency)} a month for each extra person.</p>
        </div>
        <div className="rounded-[20px] border border-fg/[0.08] p-4" aria-live="polite">
          <p className="mb-2 text-[12.5px] font-semibold text-fg/60">Your plan, per {per}</p>
          {q ? (
            <>
              <ul className="grid gap-1.5 text-[13px]">
                {q.lines.map((l) => (
                  <li key={l.label} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-fg/65">{l.module ? featureName(l.module) : l.label}</span>
                    <span className="shrink-0 tabular-nums">{money(l.amount, q.currency)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid gap-1 border-t border-fg/[0.08] pt-3 text-[13px]">
                <p className="flex justify-between"><span className="text-fg/60">Subtotal</span><span className="tabular-nums">{money(q.amount, q.currency)}</span></p>
                <p className="flex justify-between"><span className="text-fg/60">{pricing.taxLabel} ({pricing.taxBps / 100}%)</span><span className="tabular-nums">{money(tax, q.currency)}</span></p>
                <p className="mt-1 flex items-baseline justify-between text-[16px] font-semibold"><span>Total per {per}</span><span className="tabular-nums">{money(q.amount + tax, q.currency)}</span></p>
                {interval === "year" && <p className="text-right text-[12px] text-fg/50">{pricing.yearlyMonths} months&apos; price for 12 months</p>}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-fg/55">This combination can&apos;t be priced yet — try removing a feature.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
