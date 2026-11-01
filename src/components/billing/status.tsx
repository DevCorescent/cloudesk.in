"use client";

// The subscription's state everywhere else in the app: a banner under the top
// bar when something needs doing (trial ending, payment due, ended), a small
// chip by the workspace name, and a compact card on Home for whoever pays.
// Read from the session (every member has org.plan) so nothing extra loads,
// except the Home card, which shares Settings → Billing's query.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, Clock, CreditCard, X } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useSession } from "@/components/shell/session-context";
import { Badge, buttonClasses, Card } from "@/components/ui/primitives";
import { money } from "@/lib/billing/catalog";
import { api } from "@/lib/client/api";
import { canManageBilling, day, daysUntil, plural, shortDay, stateBadge, subKey, subPath, type Overview } from "./types";

const DISMISS = "cloudesk.subscription-banner";
const today = () => new Date().toISOString().slice(0, 10);
const EVENT = "cloudesk-subscription-banner";

function readDismissed(key: string) {
  try {
    return localStorage.getItem(`${DISMISS}.${key}`) === today();
  } catch {
    return false;
  }
}

/** Whether this banner was dismissed today (false while rendering on the server). */
function useDismissed(key: string) {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => readDismissed(key),
    () => true,
  );
}

function dismiss(key: string) {
  try {
    localStorage.setItem(`${DISMISS}.${key}`, today());
  } catch {
    /* storage unavailable: hidden for this page view only */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function SubscriptionBanner() {
  const { org } = useSession();
  const p = org.plan;
  const left = p?.until ? daysUntil(p.until) : null;
  const show = !!p && (p.state === "expired" || p.state === "grace" || p.state === "free" || (p.state === "trial" && left !== null && left <= 7));
  const key = `${org.id}.${p?.state ?? ""}`;
  const dismissed = useDismissed(key);
  if (!p || !show || (p.state !== "expired" && dismissed)) return null;
  const manage = canManageBilling(org.role);
  const expired = p.state === "expired";
  const grace = p.state === "grace";
  const free = p.state === "free";
  const text = free
    ? "You're on the Free plan — upgrade for every feature, unlimited invoices and contacts, and your own domain."
    : expired
    ? "Your subscription has ended. This workspace is read-only — nothing is deleted."
    : grace
      ? `Payment due — everything keeps working until ${day(p.until)}.`
      : left === 0
        ? "Your free trial ends today."
        : `Your free trial ends in ${plural(left!, "day")}.`;
  const action = free ? "See plans" : expired || grace ? (grace ? "Pay now" : "Choose a plan") : "Choose a plan";
  const Icon = expired || grace ? AlertTriangle : Clock;
  return (
    <div role={expired ? "alert" : "status"} className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-[13px] sm:px-6", expired ? "bg-danger-soft" : grace ? "bg-warning-soft" : "bg-accent-soft")}>
      <Icon className={clsx("size-4 shrink-0", expired ? "text-danger" : grace ? "text-warning" : "text-accent")} aria-hidden />
      <span className="min-w-0 flex-1 text-fg">{text}</span>
      {manage ? (
        <Link href="/settings/billing" className={buttonClasses(expired ? "primary" : "secondary", "sm")}>
          {action} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ) : (
        <span className="text-[12.5px] text-muted max-sm:order-last max-sm:basis-full max-sm:pl-[26px]">Ask an owner to {expired ? "choose a plan" : grace ? "pay the invoice" : "choose a plan"}.</span>
      )}
      {!expired && (
        <button type="button" aria-label="Hide for today" title="Hide for today" onClick={() => dismiss(key)} className="grid size-6 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** "Trial · 18 days" by the workspace name, when the plan needs a glance. */
export function PlanChip({ className }: { className?: string }) {
  const { org } = useSession();
  const p = org.plan;
  if (!p || p.state === "active" || p.state === "unrestricted") return null;
  const left = daysUntil(p.until);
  const label = p.state === "trial" ? `Trial · ${left === null ? "" : left === 0 ? "ends today" : plural(left, "day")}` : p.state === "grace" ? "Payment due" : p.state === "canceling" ? `Ends ${shortDay(p.until)}` : p.state === "free" ? "Free" : "Read-only";
  const tone = p.state === "trial" ? (left !== null && left <= 7 ? "text-warning bg-warning-soft" : "text-accent bg-accent-soft") : p.state === "expired" ? "text-danger bg-danger-soft" : p.state === "free" ? "text-fg/70 bg-surface-3" : "text-warning bg-warning-soft";
  return <span className={clsx("inline-flex h-4 items-center rounded-full px-1.5 text-[10.5px] leading-none font-medium whitespace-nowrap", tone, className)}>{label}</span>;
}

/** Home: the plan at a glance, for owners and the billing role only. */
/** Phones' home screen: the plan in one line, with the way to choose one. */
export function PlanStrip() {
  const { org } = useSession();
  const manage = canManageBilling(org.role);
  const q = useQuery({ queryKey: subKey(org.id), queryFn: () => api<Overview>(subPath(org.id)), enabled: manage && !!org.plan && org.plan.state !== "unrestricted", staleTime: 60_000, retry: false });
  const o = q.data;
  if (!manage || !o || !o.enforced || !o.subscription || o.state === "unrestricted" || o.state === "active") return null;
  const s = o.subscription;
  const trialPlan = s.planId === "trial";
  const left = o.state === "trial" ? o.stats.trialDaysLeft : o.state === "grace" ? daysUntil(s.graceEndsAt) : o.state === "canceling" ? o.stats.periodDaysLeft : null;
  const name = o.state === "free" ? "Free plan" : trialPlan ? "Free trial" : s.planName;
  const when = o.state === "trial" || o.state === "canceling" ? (left === 0 ? "ends today" : `${plural(left ?? 0, "day")} left`) : o.state === "grace" ? `until ${shortDay(s.graceEndsAt)}` : o.state === "expired" ? "read-only" : s.complimentary ? "from Cloudesk" : "";
  const urgent = o.state === "expired" || o.state === "grace" || (o.state === "trial" && (left ?? 99) <= 7);
  return (
    <Link href="/settings/billing" className="plan-strip flex h-11 items-center gap-2.5 rounded-[14px] pr-1.5 pl-3 active:scale-[0.99]">
      <CreditCard className="size-4 shrink-0 text-[var(--tint-lavender-ink)]" strokeWidth={1.9} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        <b className="font-semibold">{name}</b>
        {when && <span className={clsx(urgent ? "text-danger" : "text-muted")}> · {when}</span>}
      </span>
      <span className={clsx("inline-flex h-8 shrink-0 items-center rounded-[10px] px-3 text-[12.5px] font-semibold", urgent || trialPlan || o.state === "free" ? "bg-fg text-bg" : "bg-surface-2")}>
        {o.state === "free" ? "Upgrade" : trialPlan || o.state === "expired" ? "Choose plan" : "Manage"}
      </span>
    </Link>
  );
}

export function SubscriptionCard() {
  const { org } = useSession();
  const manage = canManageBilling(org.role);
  const q = useQuery({ queryKey: subKey(org.id), queryFn: () => api<Overview>(subPath(org.id)), enabled: manage && !!org.plan && org.plan.state !== "unrestricted", staleTime: 60_000, retry: false });
  const o = q.data;
  if (!manage || !o || !o.enforced || !o.subscription || o.state === "unrestricted") return null;
  const s = o.subscription;
  const badge = stateBadge(o);
  const trialPlan = s.planId === "trial";
  const next = o.invoices.filter((i) => i.status === "open").sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime())[0];
  const left = o.state === "trial" ? o.stats.trialDaysLeft : o.state === "grace" ? daysUntil(s.graceEndsAt) : o.state === "active" || o.state === "canceling" ? o.stats.periodDaysLeft : null;
  const when =
    o.state === "trial"
      ? `${left === 0 ? "Trial ends today" : `${plural(left ?? 0, "day")} left in your trial`}${trialPlan ? "" : ` · then ${s.planName}`}`
      : o.state === "grace"
        ? `Everything works until ${shortDay(s.graceEndsAt)}, then ${o.free ? "the Free plan" : "read-only"}`
        : o.state === "expired"
          ? "Read-only until you choose a plan"
          : o.state === "free"
            ? "Upgrade for every feature, more seats and your own domain"
          : o.state === "canceling"
            ? `Ends ${day(s.currentPeriodEnd)}`
            : s.complimentary
              ? `Provided by Cloudesk${s.compUntil ? ` until ${shortDay(s.compUntil)}` : ""}`
              : `Renews ${day(s.currentPeriodEnd)}`;
  const sub = [when, next ? `next ${money(next.total, next.currency)} due ${shortDay(next.dueAt)}` : trialPlan && o.state === "trial" ? "no plan chosen yet" : null].filter(Boolean).join(" · ");
  const urgent = o.state === "expired" || o.state === "grace" || o.state === "free" || (trialPlan && (left ?? 99) <= 7);
  const quotas = o.state === "free" || o.state === "trial" ? Object.entries(o.quotas ?? {}) : [];
  return (
    <Card className="plan-card mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 px-3.5 py-3 sm:px-4 lg:grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="tint-lavender tint-chip grid size-9 shrink-0 place-items-center rounded-[11px]">
          <CreditCard className="size-[17px]" strokeWidth={1.85} />
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13.5px] leading-tight font-semibold">
            <span className="truncate">{o.state === "free" ? "Free plan" : trialPlan ? "Free trial" : s.planName}</span>
            {!(trialPlan && o.state === "trial") && o.state !== "free" && <Badge tone={badge.tone}>{badge.label}</Badge>}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted">
            <span className="sm:hidden">{o.state === "trial" ? (left === 0 ? "Ends today" : `${plural(left ?? 0, "day")} left`) : when}</span>
            <span className="max-sm:hidden">{sub}</span>
          </p>
        </div>
      </div>
      {quotas.length > 0 && (
        <dl className="col-span-2 grid grid-cols-3 gap-x-4 sm:gap-x-6 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:pl-6">
          {quotas.map(([k, q]) => {
            const share = q!.limit ? Math.min(1, q!.used / q!.limit) : 1;
            return (
              <div key={k} className="min-w-0">
                <dt className="truncate text-[11.5px] leading-none text-muted">{q!.label}</dt>
                <dd className="mt-1.5 flex items-center gap-2">
                  <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={`${q!.label} used`} aria-valuemin={0} aria-valuemax={q!.limit} aria-valuenow={q!.used}>
                    <span className={clsx("block h-full rounded-full transition-[width] duration-500", share >= 1 ? "bg-danger" : share >= 0.8 ? "bg-warning" : "bg-[var(--tint-lavender-ink)]")} style={{ width: `${Math.max(3, share * 100)}%` }} />
                  </span>
                  <span className={clsx("shrink-0 text-[11.5px] leading-none font-medium tabular-nums", share >= 1 ? "text-danger" : share >= 0.8 ? "text-warning" : "text-fg/80")}>
                    {compactNum(q!.used)}<span className="text-subtle">/{compactNum(q!.limit)}</span>
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <Link href="/settings/billing" className={clsx(buttonClasses(urgent ? "primary" : "secondary", "sm"), "col-start-2 row-start-1 shrink-0 lg:col-start-3")}>
        {o.state === "free" ? "Upgrade" : trialPlan || o.state === "expired" ? "Choose a plan" : "Manage billing"}
      </Link>
    </Card>
  );
}

const compactNum = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}k` : n.toLocaleString("en-IN"));
