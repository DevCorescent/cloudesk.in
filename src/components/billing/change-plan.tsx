"use client";

// Changing plan: the catalogue's plans, the small Workday plan, and "build your
// own" from features. The browser prices a choice live with the same arithmetic
// as the server, but what's confirmed is always the server's preview.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Minus, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, Notice, Skeleton } from "@/components/ui/primitives";
import { isAddonLine, money, taxOf, type Addons, type CatalogPlan } from "@/lib/billing/catalog";
import { api, errorMessage } from "@/lib/client/api";
import { MODULE_GROUPS, MODULES, moduleById, withRequirements, type ModuleId } from "@/lib/workspace/modules";
import { day, intervalWord, isFuture, lineName, limitText, perWord, subKey, subPath, type ChangeResult, type Choice, type Interval, type Limit, type Overview, type Preview } from "./types";

import { currentAddons, priceQuote, takesAddons } from "./addons";

export function ChangePlan({ o, orgId, add, onPay, onDone }: { o: Overview; orgId: string; add: ModuleId | null; onPay: (invoiceId: string, overview: Overview) => void; onDone?: () => void }) {
  const sub = o.subscription;
  // Add-ons go with the workspace to whichever plan it picks (those a plan already includes drop off).
  const carry = useMemo<Addons>(() => (takesAddons(o) ? currentAddons(sub) : {}), [o, sub]);
  const carried = (sub?.lines ?? []).filter(isAddonLine).length > 0 && takesAddons(o);
  // On a paid plan the plans fold away, so the page leads with the bill; they're one tap away.
  const [open, setOpen] = useState(() => !takesAddons(o) || (!!add && sub?.planId === "custom"));
  const [interval, setInterval] = useState<Interval>(sub && sub.planId !== "trial" ? sub.interval : "month");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [builder, setBuilder] = useState(!!add || sub?.planId === "custom");
  const plans = useMemo(() => [...o.plans].filter((p) => p.active).sort((a, b) => a.sort - b.sort), [o.plans]);
  const presets = plans.filter((p) => p.kind === "preset");
  const basics = plans.filter((p) => p.kind === "basic");
  const locked = !!sub?.complimentary && o.state === "active";
  const inTrial = o.state === "trial";
  // Once ended, the last plan can be chosen again like any other.
  const isCurrent = (planId: string) => !!sub && o.state !== "expired" && sub.planId === planId && sub.interval === interval;
  const yearlySaving = o.pricing.yearlyMonths < 12 ? 12 - o.pricing.yearlyMonths : 0;

  if (!open)
    return (
      <section id="plans" aria-labelledby="change-plan">
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-[18px] border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:bg-surface-2 sm:px-5">
          <span className="min-w-0 flex-1">
            <span id="change-plan" className="block text-[14px] font-semibold">
              Change plan
            </span>
            <span className="block text-[12.5px] text-muted">Compare plans, switch monthly or yearly, or build your own from features.{carried ? " Your add-ons come with you." : ""}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
        </button>
      </section>
    );

  return (
    <section aria-labelledby="change-plan" className="grid gap-4" id="plans">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="change-plan" className="text-[17px] font-semibold tracking-[-0.015em]">
            {o.state === "expired" ? "Choose a plan" : inTrial && sub?.planId === "trial" ? "Choose your plan for after the trial" : "Change plan"}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Prices before {o.pricing.taxLabel} ({o.pricing.taxBps / 100}%).{" "}
            {inTrial ? `Nothing is charged before your trial ends on ${day(sub?.trialEndsAt)}.` : "Upgrades start once paid, with unused time credited; smaller plans start at your next renewal."}
            {carried ? " Prices include your add-ons." : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<Interval> label="Billing period" value={interval} onChange={setInterval} options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]} />
          {yearlySaving > 0 && <span className="hidden text-[12px] font-medium text-success sm:inline">{yearlySaving} months free yearly</span>}
        </div>
      </div>
      {locked && <Notice tone="accent" title="Your plan is provided by the Cloudesk team">Contact support if you’d like to change it.</Notice>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {presets.map((p) => (
          <PlanCard key={p.id} p={p} o={o} interval={interval} carry={carry} current={isCurrent(p.id)} disabled={locked} onChoose={() => setChoice({ kind: "plan", planId: p.id, interval, addons: carry })} />
        ))}
      </div>
      {basics.map((p) => (
        <BasicCard key={p.id} p={p} o={o} interval={interval} carry={carry} current={isCurrent(p.id)} disabled={locked} onChoose={() => setChoice({ kind: "plan", planId: p.id, interval, addons: carry })} />
      ))}

      {builder ? (
        <Builder o={o} interval={interval} add={add} carry={carry} disabled={locked} current={isCurrent("custom")} onReview={(c) => setChoice(c)} />
      ) : (
        <button type="button" onClick={() => setBuilder(true)} className="flex items-center gap-3 rounded-[18px] border border-dashed border-border-strong bg-surface/60 px-5 py-4 text-left transition-colors hover:bg-surface">
          <span className="grid size-10 place-items-center rounded-[12px] bg-fg text-bg">
            <Sparkles className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Build your own</span>
            <span className="block text-[12.5px] text-muted">Mail, Calendar and Chat from {money(o.pricing.customBase, o.pricing.currency)}/month, then only the features you use.</span>
          </span>
          <span className="text-[13px] font-medium">Start →</span>
        </button>
      )}

      {choice && (
        <PreviewDialog
          o={o}
          orgId={orgId}
          choice={choice}
          onClose={() => setChoice(null)}
          onDone={(r) => {
            setChoice(null);
            onDone?.();
            const inv = r.invoiceId ? r.overview.invoices.find((i) => i.id === r.invoiceId) : null;
            if (!r.applied && inv && inv.status === "open" && inv.total > 0 && (r.mode === "start" || r.mode === "upgrade")) onPay(inv.id, r.overview);
          }}
        />
      )}
    </section>
  );
}

function priceFor(p: CatalogPlan, interval: Interval) {
  return interval === "year" ? { amount: p.yearly, perMonth: Math.round(p.yearly / 12) } : { amount: p.monthly, perMonth: p.monthly };
}

function limitsLine(l: CatalogPlan["limits"]) {
  const x = l as unknown as Record<string, Limit>;
  return [
    `${limitText(x.seats)} team seat${x.seats === 1 ? "" : "s"}`,
    x.projects === 0 ? null : `${limitText(x.projects)} web app${x.projects === 1 ? "" : "s"}`,
    x.customDomains === 0 ? null : `${limitText(x.customDomains)} custom domain${x.customDomains === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
}

/** A plan's price with the add-ons that would come along, or null when there are none. */
function withCarry(p: CatalogPlan, o: Overview, interval: Interval, carry: Addons) {
  if (!carry.modules?.length && !Object.keys(carry.packs ?? {}).length) return null;
  const q = priceQuote({ kind: "plan", planId: p.id, interval, addons: carry }, o);
  if (typeof q === "string") return null;
  const extra = q.amount - (interval === "year" ? p.yearly : p.monthly);
  return extra > 0 ? { extra, perMonth: q.monthly, amount: q.amount } : null;
}

function PlanCard({ p, o, interval, carry, current, disabled, onChoose }: { p: CatalogPlan; o: Overview; interval: Interval; carry: Addons; current: boolean; disabled: boolean; onChoose: () => void }) {
  const { amount, perMonth } = priceFor(p, interval);
  const w = withCarry(p, o, interval, carry);
  const inTrial = o.state === "trial";
  const names = (p.modules ?? []).map((m) => moduleById(m)?.name).filter(Boolean) as string[];
  const otherInterval = o.state !== "expired" && o.subscription?.planId === p.id && !current;
  return (
    <Card className={cx("relative flex flex-col p-5", p.highlight && "ring-2 ring-fg/80", current && "ring-2 ring-success/70")}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-[15px] font-semibold whitespace-nowrap">{p.name}</p>
        {current ? <Badge tone="success">{inTrial ? "After your trial" : "Current plan"}</Badge> : p.highlight ? <Badge tone="accent">Most popular</Badge> : null}
      </div>
      <p className="mt-0.5 min-h-[34px] text-[12.5px] text-muted">{p.tagline}</p>
      <p className="mt-3 flex items-baseline gap-1">
        <span className="text-[26px] font-semibold tracking-[-0.03em] tabular-nums">{money(perMonth, p.currency)}</span>
        <span className="text-[12.5px] text-muted">/month</span>
      </p>
      <p className="text-[12px] text-subtle">{interval === "year" ? `${money(amount, p.currency)} billed yearly` : "Billed monthly"} · + {o.pricing.taxLabel}</p>
      {w && <p className="mt-1 text-[12px] font-medium tabular-nums">{money(w.perMonth, p.currency)}/month with your add-ons (+{money(w.extra, p.currency)}{perWord(interval)})</p>}
      <ul className="mt-4 grid flex-1 content-start gap-1.5 text-[13px]">
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
          {p.modules === null ? "Every feature, including industry packs" : `${names.length} features: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}`}
        </li>
        {limitsLine(p.limits).map((l) => (
          <li key={l} className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {l}
          </li>
        ))}
      </ul>
      <Button className="mt-5 w-full" variant={current ? "secondary" : p.highlight ? "primary" : "secondary"} disabled={current || disabled} onClick={onChoose}>
        {current ? (inTrial ? "Chosen" : "Your plan") : otherInterval ? `Switch to ${intervalWord(interval)}` : `Choose ${p.name}`}
      </Button>
    </Card>
  );
}

function BasicCard({ p, o, interval, carry, current, disabled, onChoose }: { p: CatalogPlan; o: Overview; interval: Interval; carry: Addons; current: boolean; disabled: boolean; onChoose: () => void }) {
  const { amount, perMonth } = priceFor(p, interval);
  const w = withCarry(p, o, interval, carry);
  return (
    <Card className={cx("flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:px-5", current && "ring-2 ring-success/70")}>
      <div className="min-w-0 flex-1 basis-60">
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          {p.name} {current && <Badge tone="success">{o.state === "trial" ? "After your trial" : "Current plan"}</Badge>}
        </p>
        <p className="text-[12.5px] text-muted">
          {p.tagline} · {limitsLine(p.limits).join(" · ")}
        </p>
      </div>
      <p className="text-right">
        <span className="text-[18px] font-semibold tabular-nums">{money(perMonth, p.currency)}</span>
        <span className="text-[12px] text-muted">/month</span>
        <span className="block text-[11.5px] text-subtle">{interval === "year" ? `${money(amount, p.currency)} yearly` : "billed monthly"}</span>
        {w && <span className="block text-[11.5px] font-medium">{money(w.perMonth, p.currency)}/month with add-ons</span>}
      </p>
      <Button disabled={current || disabled} onClick={onChoose}>
        {current ? "Your plan" : `Choose ${p.name}`}
      </Button>
    </Card>
  );
}

// ─── Build your own ─────────────────────────────────────────────────────────

function Builder({ o, interval, add, carry, disabled, current, onReview }: { o: Overview; interval: Interval; add: ModuleId | null; carry: Addons; disabled: boolean; current: boolean; onReview: (c: Choice) => void }) {
  const pr = o.pricing;
  const sub = o.subscription;
  const base = pr.customBaseModules;
  // Start from what this workspace has now (a built plan or a catalogue plan's features), plus the feature asked for.
  const [picked, setPicked] = useState<ModuleId[]>(() => {
    const from = sub?.modules && sub.planId !== "trial" ? sub.modules : [];
    return [...new Set([...from, ...(add ? [add] : [])])].filter((m) => !base.includes(m) && typeof pr.modulePrices[m] === "number");
  });
  const [seats, setSeats] = useState(() => Math.max(pr.customSeatsIncluded, sub?.planId === "custom" ? sub.seats : o.usage.seats));
  const flash = useRef(add);
  useEffect(() => {
    if (!flash.current) return;
    const el = document.getElementById(`mod-${flash.current}`) ?? document.getElementById("builder");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const effective = useMemo(() => withRequirements([...base, ...picked]), [base, picked]);
  // Packs come along; seats are chosen here, and features are the plan itself.
  const packs = { ...(carry.packs ?? {}) };
  delete packs.seats;
  const choice: Choice = { kind: "custom", modules: picked, seats, interval, ...(Object.keys(packs).length ? { addons: { packs } } : {}) };
  const q = priceQuote(choice, o);
  const tax = typeof q === "string" ? 0 : taxOf(q.amount, pr.taxBps);
  const sellable = MODULES.filter((m) => !base.includes(m.id) && typeof pr.modulePrices[m.id] === "number");
  const toggle = (id: ModuleId) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const months = interval === "year" ? pr.yearlyMonths : 1;

  return (
    <Card id="builder" className="overflow-clip">
      <div>
        <div className="min-w-0 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold">Build your own plan</h3>
            {current && <Badge tone="success">You’re on a built plan</Badge>}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Always included: Mail, Calendar and Chat with {pr.customSeatsIncluded} seats, {limitText(pr.customLimits.projects)} web apps and {limitText(pr.customLimits.customDomains)} custom domain{pr.customLimits.customDomains === 1 ? "" : "s"}. Add features by the month{interval === "year" ? ` (yearly = ${pr.yearlyMonths} months)` : ""}.
          </p>
          <div className="mt-4 grid gap-5">
            {MODULE_GROUPS.map((g) => {
              const mods = sellable.filter((m) => m.group === g.id);
              if (!mods.length) return null;
              return (
                <fieldset key={g.id} className="min-w-0">
                  <legend className="text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">{g.label}</legend>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {mods.map((m) => {
                      const on = effective.includes(m.id);
                      const auto = on && !picked.includes(m.id);
                      const by = auto ? picked.filter((x) => withRequirements([x]).includes(m.id) && x !== m.id).map((x) => moduleById(x)?.name) : [];
                      const needs = (m.requires ?? []).filter((r) => !base.includes(r)).map((r) => moduleById(r)?.name);
                      return (
                        <label key={m.id} id={`mod-${m.id}`} className={cx("flex cursor-pointer items-start gap-2.5 rounded-[12px] border px-3 py-2.5 transition-colors", on ? "border-fg/25 bg-surface-2" : "border-border bg-surface hover:bg-surface-2", add === m.id && "ring-2 ring-accent", (auto || disabled) && "cursor-default")}>
                          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-fg" checked={on} disabled={auto || disabled} onChange={() => toggle(m.id)} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[13px] font-medium">{m.name}</span>
                              <span className="shrink-0 text-[12px] text-muted tabular-nums">{money(pr.modulePrices[m.id]!, pr.currency)}/mo</span>
                            </span>
                            <span className="line-clamp-2 text-[11.5px] leading-snug text-subtle">{auto ? `Added for ${by.join(", ")}` : needs.length ? `Brings ${needs.join(", ")} with it` : m.short}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>
        <div className="grid gap-5 border-t border-border bg-surface-2/60 p-5 sm:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <p className="text-[12.5px] font-medium">Team seats</p>
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" aria-label="Fewer seats" disabled={seats <= pr.customSeatsIncluded || disabled} onClick={() => setSeats((s) => Math.max(pr.customSeatsIncluded, s - 1))} icon={<Minus className="size-3.5" />} />
              <input aria-label="Seats" inputMode="numeric" value={seats} disabled={disabled} onChange={(e) => setSeats(Math.max(0, Math.min(10000, Number(e.target.value.replace(/\D/g, "")) || 0)))} onBlur={() => setSeats((s) => Math.max(pr.customSeatsIncluded, s))} className="h-8 w-16 rounded-full border border-border bg-surface text-center text-[13px] tabular-nums" />
              <Button size="sm" aria-label="More seats" disabled={disabled} onClick={() => setSeats((s) => s + 1)} icon={<Plus className="size-3.5" />} />
            </div>
            <p className="mt-1 text-[11.5px] text-subtle">
              {pr.customSeatsIncluded} included, then {money(pr.seatPrice, pr.currency)}/month each. {o.usage.seats} in use now.
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium">Itemised{interval === "year" ? ` · ${months} months` : " · per month"}</p>
            {typeof q === "string" ? (
              <p className="mt-1.5 text-[12.5px] text-danger">{q}</p>
            ) : (
              <>
                <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                  {q.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate text-muted">{lineName(l)}</span>
                      <span className="whitespace-nowrap tabular-nums">{money(l.amount, q.currency)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-2 grid gap-0.5 border-t border-border pt-2 text-[12.5px] tabular-nums sm:max-w-[50%] sm:ml-auto">
                  <div className="flex justify-between">
                    <dt className="text-muted">Subtotal</dt>
                    <dd>{money(q.amount, q.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">
                      {pr.taxLabel} {pr.taxBps / 100}%
                    </dt>
                    <dd>{money(tax, q.currency)}</dd>
                  </div>
                </dl>
              </>
            )}
          </div>
        </div>
        {/* Always in view while picking: the total and the next step. */}
        <div className="sticky bottom-[var(--dock)] z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-[var(--radius-xl)] border-t border-border bg-surface/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            {typeof q === "string" ? (
              <p className="text-[12.5px] text-danger">{q}</p>
            ) : (
              <>
                <p className="text-[17px] font-semibold tracking-[-0.02em] tabular-nums">
                  {money(q.amount + tax, q.currency)}
                  <span className="text-[12.5px] font-normal text-muted">{perWord(interval)} incl. {pr.taxLabel}</span>
                </p>
                <p className="text-[11.5px] text-subtle">
                  {plural2(effective.length, "feature")} · {plural2(seats, "seat")} · {money(q.monthly, q.currency)}/month before tax
                </p>
              </>
            )}
          </div>
          <Button variant="primary" disabled={typeof q === "string" || disabled} onClick={() => onReview(choice)}>
            Review this plan
          </Button>
        </div>
      </div>
    </Card>
  );
}

const plural2 = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ─── Preview and confirm ────────────────────────────────────────────────────

export function PreviewDialog({ o, orgId, choice, onClose, onDone }: { o: Overview; orgId: string; choice: Choice; onClose: () => void; onDone: (r: ChangeResult) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const preview = useMutation({ mutationFn: () => api<Preview>(subPath(orgId, "/preview"), { method: "POST", body: choice }) });
  const change = useMutation({
    mutationFn: () => api<ChangeResult>(subPath(orgId, "/change"), { method: "POST", body: choice }),
    onSuccess: (r) => {
      qc.setQueryData(subKey(orgId), r.overview);
      const pv = preview.data;
      const name = pv?.quote.name ?? "your plan";
      if (r.mode === "trial") toast({ tone: "success", title: `${name} starts when your trial ends`, description: `Pay the first invoice any time before ${day(pv?.effectiveAt)} to carry on without a break.` });
      else if (r.mode === "downgrade") toast({ tone: "success", title: `Moves to ${name} on ${day(pv?.effectiveAt)}`, description: "Nothing changes until then." });
      else if (r.applied) toast({ tone: "success", title: `You're on ${name}`, description: "Paid from your account credit." });
      onDone(r);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't change the plan", description: errorMessage(e) }),
  });
  const run = preview.mutate;
  useEffect(() => run(), [run]);
  const p = preview.data;
  const cur = o.pricing.currency;
  const m = (n: number) => money(n, p?.quote.currency ?? cur);
  const label = !p
    ? "Confirm"
    : p.mode === "trial"
      ? "Choose for after the trial"
      : p.mode === "downgrade"
        ? "Schedule change"
        : p.mode === "same"
          ? "Already on this plan"
          : p.total > 0
            ? `Confirm and pay ${m(p.total)}`
            : "Confirm change";
  // Same plan and period, different add-ons.
  const tweak = !!p && o.subscription?.planId === p.quote.planId && o.subscription?.interval === p.quote.interval;
  const title = p ? (p.mode === "trial" ? `${p.quote.name} after your trial` : tweak && (p.mode === "upgrade" || p.mode === "downgrade") ? "Update your add-ons" : p.mode === "downgrade" ? `Move to ${p.quote.name}` : p.mode === "upgrade" ? `Upgrade to ${p.quote.name}` : `Start ${p.quote.name}`) : "Checking the price…";
  const pct = o.pricing.taxBps / 100;
  const subName = o.subscription?.planName ?? "your current plan";

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={p ? `${intervalWord(p.quote.interval).replace(/^./, (c) => c.toUpperCase())} · ${m(p.quote.amount)}${perWord(p.quote.interval)} before ${o.pricing.taxLabel}` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button variant="primary" disabled={!p || p.mode === "same"} loading={change.isPending} onClick={() => change.mutate()}>
            {label}
          </Button>
        </>
      }
    >
      {preview.isError ? (
        <Notice tone="danger" title="Couldn't price this">
          {errorMessage(preview.error)}
        </Notice>
      ) : !p ? (
        <div className="grid gap-2">
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : (
        <div className="grid gap-4 text-[13px]">
          <p className="rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-muted">
            {p.mode === "trial" && (
              <>
                Free until <b className="font-medium text-fg">{day(p.effectiveAt)}</b> — everything stays on until then. Your first invoice ({m(p.total)}, for {day(p.periodStart)} – {day(p.periodEnd)}) is due that day; pay it any time before.
              </>
            )}
            {p.mode === "start" && (
              <>
                Starts the moment it’s paid, for a full {p.quote.interval} ({day(p.periodStart)} – {day(p.periodEnd)}). You’ll pay on the next step.
              </>
            )}
            {p.mode === "upgrade" && (
              <>
                {p.note.startsWith("You've already paid") ? p.note : <>Starts as soon as it’s paid. You pay for {isFuture(p.periodStart, -60_000) ? `a new period, ${day(p.periodStart)} – ${day(p.periodEnd)}` : `the time left until ${day(p.periodEnd)}`}, less what’s unused on {subName}.</>}
              </>
            )}
            {p.mode === "downgrade" && (
              <>
                Takes effect on <b className="font-medium text-fg">{day(p.effectiveAt)}</b>, when your current period ends. Nothing to pay now; you keep everything on {subName} until then.
              </>
            )}
            {p.mode === "same" && p.note}
          </p>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">{p.mode === "upgrade" ? "Due now" : p.mode === "downgrade" ? `From ${day(p.effectiveAt)}` : "Your invoice"}</p>
            <ul className="grid gap-1 tabular-nums">
              {p.mode === "upgrade" ? (
                <>
                  <li className="flex justify-between gap-3">
                    <span>
                      {p.quote.name}
                      {p.quote.lines.some(isAddonLine) ? " with add-ons" : ""}, {intervalWord(p.quote.interval)} — {day(p.chargeFrom ?? p.periodStart)} to {day(p.periodEnd)}
                    </span>
                    <span className="shrink-0 whitespace-nowrap">{m(p.charge)}</span>
                  </li>
                  {p.credit > 0 && (
                    <li className="flex justify-between gap-3 text-muted">
                      <span>Unused time on {subName}</span>
                      <span className="shrink-0 whitespace-nowrap text-success">−{m(p.credit)}</span>
                    </li>
                  )}
                </>
              ) : (
                p.quote.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-muted">
                      {lineName(l)}
                      {isAddonLine(l) ? " · add-on" : ""}
                    </span>
                    <span>{m(l.amount)}</span>
                  </li>
                ))
              )}
              {p.balanceUsed > 0 && (
                <li className="flex justify-between gap-3 text-muted">
                  <span>Credit on your account</span>
                  <span className="text-success">−{m(p.balanceUsed)}</span>
                </li>
              )}
              {p.discount > 0 && (
                <li className="flex justify-between gap-3 text-muted">
                  <span>Partner code {p.discountCode}</span>
                  <span className="text-success">−{m(p.discount)}</span>
                </li>
              )}
            </ul>
          </div>
          {(p.mode === "upgrade" || p.mode === "downgrade") && (
            <details className="group rounded-[12px] border border-border px-3.5 py-2.5" open={p.mode === "downgrade"}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12.5px] font-medium">
                <span>
                  Your bill from then on: {m(p.quote.amount)}
                  {perWord(p.quote.interval)} + {o.pricing.taxLabel}
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="mt-2 grid gap-1 text-[12.5px] tabular-nums">
                {p.quote.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-muted">
                      {lineName(l)}
                      {isAddonLine(l) ? " · add-on" : ""}
                    </span>
                    <span>{m(l.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-border pt-1">
                  <span className="text-muted">
                    {o.pricing.taxLabel} {pct}%
                  </span>
                  <span>{m(taxOf(p.quote.amount, o.pricing.taxBps))}</span>
                </li>
                <li className="flex justify-between gap-3 font-semibold">
                  <span>Each {p.quote.interval}</span>
                  <span>{m(p.quote.amount + taxOf(p.quote.amount, o.pricing.taxBps))}</span>
                </li>
              </ul>
            </details>
          )}
          {p.mode !== "downgrade" && p.mode !== "same" && (
            <dl className="grid gap-1 border-t border-border pt-3 tabular-nums">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd>{m(p.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">
                  {o.pricing.taxLabel} {pct}%
                </dt>
                <dd>{m(p.tax)}</dd>
              </div>
              <div className="mt-1 flex justify-between text-[16px] font-semibold">
                <dt>{p.mode === "trial" ? `Due ${day(p.effectiveAt)}` : "Total due now"}</dt>
                <dd>{m(p.total)}</dd>
              </div>
              {p.carry > 0 && <p className="text-[12px] text-success">{m(p.carry)} left over goes to your account credit.</p>}
            </dl>
          )}
          {p.mode === "downgrade" && (
            <p className="flex justify-between border-t border-border pt-3 text-[15px] font-semibold tabular-nums">
              <span>To pay now</span>
              <span>{m(0)}</span>
            </p>
          )}
          {(p.mode === "start" || (p.mode === "upgrade" && p.total > 0)) && !o.providers.length && (
            <p className="text-[12px] text-muted">Online payments aren&apos;t set up yet — after confirming, contact support to pay the invoice by bank transfer or UPI.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}
