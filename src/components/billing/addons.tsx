"use client";

// What the workspace pays and what it can add: the bill line by line (plan,
// add-ons, tax, total), and "Add to your plan" — any feature on its own and
// more room in packs (seats, web apps, invoices, storage…), priced live with
// the same arithmetic the server invoices with.
import { Check, Minus, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, cx, Switch } from "@/components/ui/primitives";
import { addonsOf, isAddonLine, money, PACK_KEYS, PACK_LABEL, QUOTA_KEYS, QUOTA_LABEL, quote, QuoteError, taxOf, type Addons, type PackKey, type Pricing, type Quote } from "@/lib/billing/catalog";
import { MODULES, moduleById, withRequirements, type ModuleId } from "@/lib/workspace/modules";
import { lineName, perWord, type Choice, type Interval, type Line, type Overview, type Subscription } from "./types";

export const asPricing = (o: Overview) => ({ ...o.pricing, enforce: true, renewalNoticeDays: 0 }) as unknown as Pricing;

export function priceQuote(choice: Choice, o: Overview): Quote | string {
  try {
    return quote(choice, o.plans, asPricing(o));
  } catch (e) {
    return e instanceof QuoteError ? e.message : "This can't be priced right now.";
  }
}

/** A paid plan (or one chosen for after the trial) that add-ons can go on. */
export const takesAddons = (o: Overview) => {
  const s = o.subscription;
  return !!s && o.enforced && s.planId !== "trial" && !s.complimentary && s.amount > 0 && ["trial", "active", "canceling", "grace"].includes(o.state);
};

/** What's bought on top of the current plan (a built plan's features are the plan itself). */
export const currentAddons = (s: Subscription | null): Required<Addons> => addonsOf(s?.lines);

/** The same plan with these add-ons, as a choice. */
export function sameWith(s: Subscription, interval: Interval, addons: Addons, built?: { modules: ModuleId[]; seats: number }): Choice {
  if (s.planId === "custom") {
    const packs = { ...(addons.packs ?? {}) };
    delete packs.seats;
    return { kind: "custom", modules: built?.modules ?? [], seats: built?.seats ?? s.seats, interval, addons: { packs } };
  }
  return { kind: "plan", planId: s.planId, interval, addons };
}

const sum = (ls: Line[]) => ls.reduce((n, l) => n + l.amount, 0);
const clean = (p: Partial<Record<PackKey, number>>) => Object.fromEntries(Object.entries(p).filter(([, n]) => n && n > 0)) as Partial<Record<PackKey, number>>;

// ─── The bill ───────────────────────────────────────────────────────────────

/** The plan's bill each period: plan, each add-on, tax and the total — the same lines the renewal invoice carries. */
export function YourBill({ o, onAdd }: { o: Overview; onAdd?: () => void }) {
  const s = o.subscription!;
  const lines = s.lines ?? [];
  const plan = lines.filter((l) => !isAddonLine(l));
  const extras = lines.filter(isAddonLine);
  const tax = taxOf(s.amount, o.pricing.taxBps);
  const cur = s.currency;
  const per = perWord(s.interval);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-semibold">Your bill</h2>
        <span className="text-[12px] text-muted">Every {s.interval === "year" ? "year" : "month"} · {o.state === "trial" ? "from the end of your trial" : "renews automatically"}</span>
      </div>
      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_260px]">
        <ul className="grid content-start gap-1.5 text-[13px] tabular-nums">
          {plan.map((l, i) => (
            <li key={`p${i}`} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{lineName(l)}</span>
              <span className="shrink-0">{money(l.amount, cur)}</span>
            </li>
          ))}
          {extras.length > 0 && <li className="mt-1.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">Add-ons</li>}
          {extras.map((l, i) => (
            <li key={`a${i}`} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-muted">{lineName(l)}</span>
              <span className="shrink-0">{money(l.amount, cur)}</span>
            </li>
          ))}
          {!extras.length && onAdd && (
            <li className="mt-1.5">
              <button type="button" onClick={onAdd} className="text-[12.5px] font-medium text-accent hover:underline">
                + Add a feature or more room
              </button>
            </li>
          )}
        </ul>
        <dl className="grid content-start gap-1 rounded-[14px] bg-surface-2 p-3.5 text-[13px] tabular-nums">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Plan</dt>
            <dd>{money(sum(plan), cur)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Add-ons</dt>
            <dd>{money(sum(extras), cur)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">
              {o.pricing.taxLabel} {o.pricing.taxBps / 100}%
            </dt>
            <dd>{money(tax, cur)}</dd>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <dt className="font-medium">Total</dt>
            <dd className="text-[20px] font-semibold tracking-[-0.02em]">
              {money(s.amount + tax, cur)}
              <span className="text-[12px] font-normal text-muted">{per}</span>
            </dd>
          </div>
          {s.interval === "year" && <p className="text-right text-[11.5px] text-subtle">≈ {money(Math.round((s.amount + tax) / 12), cur)} a month</p>}
        </dl>
      </div>
    </Card>
  );
}

// ─── Add to your plan ───────────────────────────────────────────────────────

const usedOf = (o: Overview, k: PackKey) => (k === "seats" ? o.usage.seats : k === "projects" ? o.usage.projects : k === "customDomains" ? o.usage.customDomains : (o.quotas[k]?.used ?? null));
const limitOf = (q: Quote, k: PackKey): number | null => {
  const v = k === "seats" || k === "projects" || k === "customDomains" ? q.limits[k] : q.quotas[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const amountText = (k: PackKey, n: number) => (k === "storageMb" ? (n >= 1024 ? `${+(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`) : Math.round(n).toLocaleString("en-IN"));

export function AddOns({ o, add, more, disabled, onReview }: { o: Overview; add: ModuleId | null; more: PackKey | null; disabled: boolean; onReview: (c: Choice) => void }) {
  const s = o.subscription!;
  const pr = o.pricing;
  const built = s.planId === "custom";
  const now = useMemo(() => currentAddons(s), [s]);
  const base = pr.customBaseModules;
  // A built plan's features are the plan; otherwise the plan's own features are what it had before add-ons.
  const own = useMemo(() => (built ? base : s.modules === null ? null : s.modules.filter((m) => !now.modules.includes(m))), [built, base, s.modules, now.modules]);
  const [mods, setMods] = useState<ModuleId[]>(() => {
    const from = built ? (s.modules ?? []).filter((m) => !base.includes(m)) : now.modules;
    return [...new Set([...from, ...(add && own && !own.includes(add) ? [add] : [])])];
  });
  const [packs, setPacks] = useState<Partial<Record<PackKey, number>>>(() => ({ ...now.packs, ...(more && !(built && more === "seats") ? { [more]: (now.packs[more] ?? 0) + 1 } : {}) }));
  const [seats, setSeats] = useState(() => s.seats + (built && more === "seats" ? 1 : 0));
  const [all, setAll] = useState(false);
  const [find, setFind] = useState("");

  useEffect(() => {
    if (!add && !more) return;
    document.getElementById(add ? `addon-${add}` : `pack-${more}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [add, more]);

  const choice = sameWith(s, s.interval, { modules: built ? [] : mods, packs: clean(packs) }, { modules: mods, seats });
  const q = priceQuote(choice, o);
  // The same plan and features without packs: the room each pack adds to.
  const bare = priceQuote(sameWith(s, s.interval, { modules: built ? [] : mods }, { modules: mods, seats: built ? seats : s.seats }), o);
  const months = s.interval === "year" ? pr.yearlyMonths : 1;
  const per = perWord(s.interval);
  const cur = s.currency;
  const changed = typeof q !== "string" && (q.amount !== s.amount || JSON.stringify(q.lines.map((l) => [l.label, l.amount])) !== JSON.stringify((s.lines ?? []).map((l) => [l.label, l.amount])));

  const effective = useMemo(() => withRequirements([...(own ?? []), ...mods]), [own, mods]);
  const sellable = MODULES.filter((m) => typeof pr.modulePrices[m.id] === "number" && !base.includes(m.id) && !(own ?? []).includes(m.id));
  const toggle = (id: ModuleId) => setMods((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const needle = find.trim().toLowerCase();
  const shown = sellable.filter((m) => (needle ? `${m.name} ${m.short}`.toLowerCase().includes(needle) : all || effective.includes(m.id) || m.id === add));
  const hidden = sellable.length - shown.length;

  const rows = typeof bare === "string" ? [] : PACK_KEYS.filter((k) => (built && k === "seats") || (pr.packs?.[k] && limitOf(bare, k) !== null));
  const setPack = (k: PackKey, n: number) => setPacks((p) => ({ ...p, [k]: Math.max(0, Math.min(1000, n)) }));

  const planLines = typeof q === "string" ? [] : q.lines.filter((l) => !isAddonLine(l));
  const extraLines = typeof q === "string" ? [] : q.lines.filter(isAddonLine);
  const tax = typeof q === "string" ? 0 : taxOf(q.amount, pr.taxBps);
  const delta = typeof q === "string" ? 0 : q.amount - s.amount;
  // Bought before plans had allowances: unlimited now, the plan's allowance after any change.
  const capped = typeof q === "string" || o.state === "trial" ? [] : QUOTA_KEYS.filter((k) => k !== "aiBudgetUsd" && o.quotas[k] === undefined && q.quotas[k] !== undefined);

  return (
    <section id="addons" aria-labelledby="addons-h" className="grid gap-3">
      <div>
        <h2 id="addons-h" className="text-[17px] font-semibold tracking-[-0.015em]">
          Add to your plan
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Any feature on its own, or more room when you need it — added to your {s.planName} bill{s.interval === "year" ? ` (yearly = ${months} months)` : ""}. Remove any time; it drops off at your next renewal.
        </p>
      </div>

      <Card className="overflow-clip">
        {/* Features */}
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold">{built ? "Features in your plan" : "Features"}</h3>
            {own !== null && sellable.length > 0 && (
              <label className="relative min-w-0 flex-1 basis-44 sm:max-w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a feature" aria-label="Find a feature" className="h-9 w-full rounded-full border border-border bg-surface pr-3 pl-8 text-[13px] max-sm:h-11 max-sm:text-[16px]" />
              </label>
            )}
          </div>
          {own === null ? (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-muted">
              <Check className="size-4 text-success" aria-hidden /> Every feature is already in {s.planName}.
            </p>
          ) : sellable.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">Every feature on sale is already in your plan.</p>
          ) : (
            <>
              {!built && <p className="mt-0.5 text-[12.5px] text-muted">Not in {s.planName}. Switch one on to add it for {money(Math.min(...sellable.map((m) => pr.modulePrices[m.id]!)), cur)}–{money(Math.max(...sellable.map((m) => pr.modulePrices[m.id]!)), cur)} a month.</p>}
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {shown.map((m) => {
                  const on = effective.includes(m.id);
                  const auto = on && !mods.includes(m.id);
                  const by = auto ? mods.filter((x) => x !== m.id && withRequirements([x]).includes(m.id)).map((x) => moduleById(x)?.name) : [];
                  return (
                    <li key={m.id} id={`addon-${m.id}`} className={cx("flex items-center gap-3 rounded-[14px] border px-3 py-2.5 transition-colors", on ? "border-fg/20 bg-surface-2" : "border-border", add === m.id && "ring-2 ring-accent")}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{m.name}</span>
                        <span className="line-clamp-1 text-[12px] text-subtle">{auto ? `Comes with ${by.join(", ")}` : m.short}</span>
                      </span>
                      <span className="shrink-0 text-right text-[12.5px] tabular-nums">
                        {money(pr.modulePrices[m.id]!, cur)}
                        <span className="block text-[11px] text-subtle">a month</span>
                      </span>
                      <Switch checked={on} disabled={auto || disabled} label={`${on ? "Remove" : "Add"} ${m.name}`} onChange={() => toggle(m.id)} />
                    </li>
                  );
                })}
              </ul>
              {!needle && (hidden > 0 || all) && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(!all)}>
                  {all ? "Show only what's added" : `Show all ${sellable.length} features`}
                </Button>
              )}
              {needle && !shown.length && <p className="mt-3 text-[13px] text-muted">No feature matches “{find}”.</p>}
            </>
          )}
        </div>

        {/* More room */}
        {rows.length > 0 && typeof bare !== "string" && (
          <div className="border-t border-border p-4 sm:p-5">
            <h3 className="text-[14px] font-semibold">More room</h3>
            <p className="mt-0.5 text-[12.5px] text-muted">What your plan includes, what you use, and packs to go further.</p>
            <ul className="mt-3 grid gap-2 lg:grid-cols-2">
              {rows.map((k) => {
                const seatsRow = built && k === "seats";
                const pk = seatsRow ? { size: 1, price: pr.seatPrice } : pr.packs[k];
                const n = seatsRow ? seats - pr.customSeatsIncluded : (packs[k] ?? 0);
                const inPlan = seatsRow ? pr.customSeatsIncluded : limitOf(bare, k)!;
                const total = inPlan + n * pk.size;
                const used = usedOf(o, k);
                const share = used === null ? 0 : Math.min(1, used / Math.max(1, total));
                const full = used !== null && used >= total;
                const min = seatsRow ? Math.max(0, (o.usage.seats ?? 0) - pr.customSeatsIncluded) : 0;
                return (
                  <li key={k} id={`pack-${k}`} className={cx("grid gap-2 rounded-[14px] border px-3 py-3", n > 0 ? "border-fg/20 bg-surface-2" : "border-border", more === k && "ring-2 ring-accent")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium">{PACK_LABEL[k].name}</p>
                        <p className="text-[12px] text-muted tabular-nums">
                          {amountText(k, inPlan)} in plan{n > 0 && <b className="font-semibold text-fg"> + {amountText(k, n * pk.size)}</b>}
                          {used !== null && <> · {amountText(k, used)} used</>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button size="sm" aria-label={`Fewer ${PACK_LABEL[k].name}`} disabled={disabled || n <= min} onClick={() => (seatsRow ? setSeats((x) => Math.max(pr.customSeatsIncluded + min, x - 1)) : setPack(k, n - 1))} icon={<Minus className="size-3.5" />} />
                        <span className="w-7 text-center text-[14px] font-semibold tabular-nums" aria-live="polite">
                          {n}
                        </span>
                        <Button size="sm" aria-label={`More ${PACK_LABEL[k].name}`} disabled={disabled || n >= 1000} onClick={() => (seatsRow ? setSeats((x) => x + 1) : setPack(k, n + 1))} icon={<Plus className="size-3.5" />} />
                      </div>
                    </div>
                    {used !== null && (
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className={cx("h-full rounded-full transition-[width] duration-500", full ? "bg-danger" : share >= 0.8 ? "bg-warning" : "bg-fg")} style={{ width: `${Math.max(used ? 3 : 0, share * 100)}%` }} />
                      </div>
                    )}
                    <p className="flex flex-wrap justify-between gap-x-3 text-[11.5px] text-subtle tabular-nums">
                      <span>
                        +{amountText(k, pk.size)} for {money(pk.price, cur)}/month each
                      </span>
                      {n > 0 && (
                        <span className="font-medium text-fg">
                          {n} × {money(pk.price, cur)} = {money(n * pk.price, cur)}/month
                        </span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {capped.length > 0 && changed && (
          <p className="mx-4 mb-3 rounded-[12px] bg-warning-soft px-3.5 py-2.5 text-[12.5px] sm:mx-5">
            Your plan has no limit on {capped.map((k) => QUOTA_LABEL[k].name.toLowerCase()).join(", ")} today. Changing your add-ons moves you to {s.planName}&apos;s current allowances: {capped.map((k) => `${amountText(k as PackKey, typeof q !== "string" ? q.quotas[k]! : 0)} ${QUOTA_LABEL[k].unit}`).join(", ")}.
          </p>
        )}
        {/* The new bill, always in view */}
        <div className="sticky bottom-[var(--dock)] z-10 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
          {typeof q === "string" ? (
            <p className="text-[12.5px] text-danger">{q}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12.5px] text-muted tabular-nums">
                  <div className="flex gap-1">
                    <dt>Plan</dt>
                    <dd className="text-fg">{money(sum(planLines), cur)}</dd>
                  </div>
                  <span aria-hidden>+</span>
                  <div className="flex gap-1">
                    <dt>Add-ons</dt>
                    <dd className="text-fg">{money(sum(extraLines), cur)}</dd>
                  </div>
                  <span aria-hidden>+</span>
                  <div className="flex gap-1">
                    <dt>{pr.taxLabel}</dt>
                    <dd className="text-fg">{money(tax, cur)}</dd>
                  </div>
                </dl>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[18px] font-semibold tracking-[-0.02em] tabular-nums">
                  {money(q.amount + tax, cur)}
                  <span className="text-[12.5px] font-normal text-muted">{per} in all</span>
                  {changed && delta !== 0 && <Badge tone={delta > 0 ? "accent" : "success"}>{`${delta > 0 ? "+" : "−"}${money(Math.abs(delta), cur)}${per} before ${pr.taxLabel}`}</Badge>}
                </p>
              </div>
              <Button variant="primary" className="max-sm:w-full" disabled={!changed || disabled} onClick={() => onReview(choice)}>
                {changed ? (delta > 0 ? "Review and pay" : "Review change") : "Nothing changed yet"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
