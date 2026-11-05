// The workspace's subscription as GET /orgs/:id/subscription returns it, and
// the small formatting helpers every billing screen shares. Amounts are minor
// units (paise); limits that are unlimited arrive as null (Infinity in JSON).
import type { CatalogPlan, Choice, Interval, Pack, PackKey, Quotas, Quote, SubState, TopupKey } from "@/lib/billing/catalog";
import { moduleById, type ModuleId } from "@/lib/workspace/modules";

export type Limit = number | null;
export type LimitsJson = { projects: Limit; seats: Limit; customDomains: Limit; automationsPerProject: Limit };
export type Provider = "razorpay" | "stripe";

export type Line = { label: string; amount: number; module?: string; addon?: "module" | PackKey; qty?: number };

export type Invoice = {
  id: string;
  number: string;
  kind: "first" | "renewal" | "upgrade" | "topup" | "manual";
  description: string;
  lines: Line[];
  subtotal: number;
  creditApplied: number;
  taxLabel: string;
  taxBps: number;
  tax: number;
  total: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: "open" | "paid" | "void";
  dueAt: string | null;
  paidAt: string | null;
  paidVia: Provider | "manual" | "credit" | null;
  createdAt: string;
};

export type SubEvent = { id: string; kind: string; detail: Record<string, unknown>; byPlatform: boolean; createdAt: string; actor: string | null };

export type Pending = { planId: string; planName: string; interval: Interval; amount: number; currency?: string; effectiveAt?: string | null };

export type Subscription = {
  planId: string;
  planName: string;
  modules: ModuleId[] | null;
  limits: LimitsJson;
  seats: number;
  interval: Interval;
  amount: number;
  monthly: number;
  currency: string;
  lines: Line[];
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  pending: Pending | null;
  credit: number;
  complimentary: boolean;
  compUntil: string | null;
};

/** The pricing rules as the workspace sees them (no `enforce` or renewal notice). */
export type PublicPricing = {
  currency: string;
  trialDays: number;
  taxBps: number;
  taxLabel: string;
  yearlyMonths: number;
  graceDays: number;
  customBase: number;
  customBaseModules: ModuleId[];
  customSeatsIncluded: number;
  seatPrice: number;
  customLimits: { projects: Limit; customDomains: Limit; automationsPerProject: Limit };
  modulePrices: Partial<Record<ModuleId, number>>;
  customQuotas: Quotas;
  aiCostShareBps: number;
  usdInr: number;
  /** Add-ons on any paid plan. */
  packs: Record<PackKey, Pack>;
};

export type Overview = {
  enforced: boolean;
  state: SubState;
  entitled: ModuleId[] | null;
  limits: LimitsJson;
  usage: { projects: number; seats: number; customDomains: number };
  subscription: Subscription | null;
  stats: { trialDaysLeft: number | null; trialDays: number; periodDaysLeft: number | null; paidTotal: number; paidInvoices: number; customerSince: string | null; due: number; nextDueAt: string | null; featuresIncluded: number; featuresTotal: number };
  plans: CatalogPlan[];
  /** The Free plan (what the workspace has without paying), if the platform offers one. */
  free: CatalogPlan | null;
  /** Allowances in force and how much is used (only those with a limit). */
  quotas: Partial<Record<keyof Quotas, { used: number; limit: number; topup?: number; label: string; unit: string; monthly: boolean }>>;
  /** Allowances that can be topped up now (bought once, paid at once), and this month's top-up spend. */
  topups?: { packs: { key: TopupKey; size: number; price: number; left: number }[]; month: { subtotal: number; tax: number; total: number; count: number } };
  /** In the trial or on Free: what was built in features Free doesn't include, and the plan that keeps it. */
  /** A partner's code on this workspace, and the discount still to come. */
  coupon: { code: string; discount: string; left: number } | null;
  recap: { lost: { module: ModuleId; name: string; records: number }[]; plan: { planId: string; name: string; monthly: number; currency: string } | null; custom: { monthly: number; currency: string } | null } | null;
  pricing: PublicPricing;
  providers: Provider[];
  /** The website payments are approved for (e.g. https://cloudesk.in); paying starts there. */
  payOrigin?: string | null;
  invoices: Invoice[];
  events: SubEvent[];
};

export type Preview = {
  mode: "trial" | "start" | "upgrade" | "downgrade" | "same";
  quote: Quote;
  credit: number;
  charge: number;
  balanceUsed: number;
  discount: number;
  discountCode: string | null;
  subtotal: number;
  tax: number;
  total: number;
  carry: number;
  periodStart: string | null;
  periodEnd: string | null;
  chargeFrom?: string | null;
  effectiveAt: string | null;
  note: string;
};

export type ChangeResult = { mode: Preview["mode"]; applied: boolean; invoiceId: string | null; overview: Overview };

export type { Choice, Interval };

export const subKey = (orgId: string) => ["subscription", orgId];
export const subPath = (orgId: string, rest = "") => `/api/v1/orgs/${orgId}/subscription${rest}`;
export const canManageBilling = (role: string) => role === "owner" || role === "billing";

/** "1 Dec 2026" (Indian order, short month). */
export const day = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
/** "1 Dec" for dates this year, otherwise with the year. */
export const shortDay = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const x = new Date(d);
  return x.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(x.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
};
export const daysUntil = (d: string | Date | null | undefined) => (d ? Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)) : null);
/** Whether a date is still ahead (allowing `slack` ms either way). */
export const isFuture = (d: string | Date | null | undefined, slack = 0) => !!d && new Date(d).getTime() > Date.now() + slack;
/** How much of a span (ms timestamps) is still to come, 0–1. */
export const shareLeft = (start: number, end: number) => Math.max(0, Math.min(1, (end - Date.now()) / Math.max(1, end - start)));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A quote or subscription line, with a module's id shown as its name. */
export const lineName = (l: Line) => (l.module ? (moduleById(l.module)?.name ?? l.label) : (moduleById(l.label)?.name ?? l.label));

export const isUnlimited = (n: Limit | undefined) => n === null || n === undefined || !Number.isFinite(n);
export const limitText = (n: Limit | undefined) => (isUnlimited(n) ? "Unlimited" : String(n));

export const intervalWord = (i: Interval) => (i === "year" ? "yearly" : "monthly");
export const perWord = (i: Interval) => (i === "year" ? "/year" : "/month");

/** How the state reads in a badge, and its tone. */
export function stateBadge(o: Pick<Overview, "state" | "subscription">): { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" } {
  const s = o.subscription;
  if (s?.complimentary && o.state === "active") return { label: "Complimentary", tone: "accent" };
  switch (o.state) {
    case "trial":
      return { label: s?.cancelAtPeriodEnd ? "Trial · won't continue" : "Free trial", tone: "accent" };
    case "active":
      return { label: "Active", tone: "success" };
    case "grace":
      return { label: "Payment due", tone: "warning" };
    case "canceling":
      return { label: `Cancels on ${shortDay(s?.currentPeriodEnd)}`, tone: "warning" };
    case "free":
      return { label: "Free plan", tone: "neutral" };
    case "expired":
      return { label: "Ended — read-only", tone: "danger" };
    default:
      return { label: "Unrestricted", tone: "neutral" };
  }
}

/** Human sentence for a timeline event. */
export function eventText(e: SubEvent, invoices: Invoice[], currency: string, fmt: (n: number, c?: string) => string): string {
  const d = e.detail ?? {};
  const who = e.byPlatform ? "Cloudesk team" : (e.actor ?? "Someone");
  const plan = typeof d.plan === "string" ? d.plan : "a plan";
  const iv = d.interval === "year" ? " (yearly)" : d.interval === "month" ? " (monthly)" : "";
  const inv = typeof d.invoice === "number" ? invoices.find((i) => i.number.endsWith(String(d.invoice).padStart(6, "0")))?.number ?? `invoice #${d.invoice}` : null;
  const amt = (v: unknown) => (typeof v === "number" ? fmt(v, currency) : "");
  const when = (v: unknown) => (typeof v === "string" ? day(v) : "");
  switch (e.kind) {
    case "trial_started":
      return `Free trial started${typeof d.days === "number" ? ` — ${d.days} days of everything` : ""}`;
    case "plan_chosen":
      return `${who} chose ${plan}${iv}${inv ? ` · ${inv}` : ""}`;
    case "upgrade_requested":
      return `${who} asked to move to ${plan}${iv}${typeof d.total === "number" ? ` — ${amt(d.total)} to pay` : ""}`;
    case "upgraded":
      return `Moved to ${plan}`;
    case "activated":
      return `${plan} started${d.to ? `, paid until ${when(d.to)}` : ""}`;
    case "renewed":
      return `${plan} renewed${d.to ? ` until ${when(d.to)}` : ""}`;
    case "renewal_invoiced":
      return `Renewal invoice raised${typeof d.total === "number" ? ` for ${amt(d.total)}` : ""}${inv ? ` · ${inv}` : ""}`;
    case "paid": {
      const via = d.via === "razorpay" ? "Razorpay" : d.via === "stripe" ? "Stripe" : d.via === "credit" ? "account credit" : d.via === "manual" ? "bank transfer (recorded by the Cloudesk team)" : "";
      return `${inv ?? "Invoice"} paid${typeof d.total === "number" ? ` — ${amt(d.total)}` : ""}${via ? ` via ${via}` : ""}`;
    }
    case "change_scheduled":
      return `${who} scheduled a move to ${plan}${iv}${d.at ? ` on ${when(d.at)}` : ""}`;
    case "cancel_requested":
      return e.byPlatform ? "Cloudesk team set the plan to end at the end of the period" : `${who} cancelled${d.at ? ` — ends on ${when(d.at)}` : " at the end of the period"}`;
    case "cancel_undone":
      return e.byPlatform ? "Cloudesk team kept the plan going" : `${who} kept the plan going`;
    case "trial_ended":
      return d.paid ? "Free trial ended — your plan carried on" : "Free trial ended";
    case "past_due":
      return `Renewal not paid — ${typeof d.graceDays === "number" ? `${d.graceDays} days to pay before the workspace becomes read-only` : "payment due"}`;
    case "expired":
      return d.reason === "platform" ? "Cloudesk team ended the subscription" : "Subscription ended — the workspace is read-only";
    case "canceled":
      return "Subscription ended as cancelled";
    case "trial_extended":
      return `Cloudesk team extended your trial${typeof d.days === "number" ? ` by ${plural(d.days, "day")}` : ""}${d.until ? `, until ${when(d.until)}` : ""}`;
    case "trial_ended_by_platform":
      return "Cloudesk team ended the free trial";
    case "complimentary_given":
      return `Cloudesk team gave you ${plan} free${d.until ? ` until ${when(d.until)}` : ""}`;
    case "complimentary_ended":
      return "Complimentary plan ended";
    case "plan_assigned":
      return `Cloudesk team set your plan to ${plan}${inv ? ` · ${inv}` : ""}`;
    case "topup_requested":
      return `${who} chose a top-up${typeof d.what === "string" ? ` — ${d.what}` : ""}${typeof d.total === "number" ? `, ${amt(d.total)}` : ""}`;
    case "topup_added":
      return `Top-up added${typeof d.what === "string" ? `: ${d.what}` : ""}`;
    case "credit":
      return `Cloudesk team added ${amt(d.amount)} credit${typeof d.note === "string" && d.note ? ` — “${d.note}”` : ""}`;
    case "invoice_voided":
      return `Cloudesk team cancelled ${inv ?? "an invoice"}`;
    default:
      return e.kind.replace(/_/g, " ");
  }
}
