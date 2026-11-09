// Subscriptions: every workspace starts on a free trial of everything, then
// pays for a plan from the catalogue or one it built itself. Cloudesk keeps the
// subscription, its periods and its invoices; the payment provider only takes
// the money for an invoice. Nothing is applied because a browser came back from
// checkout: a payment counts once the provider confirms it to the server
// (a signature checked with our secret, then the payment looked up by id).
import { launchOffer } from "@/lib/festive";
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  addInterval,
  addonsOf,
  DEFAULT_PLANS,
  entitledTo,
  entitlement,
  isAddonLine,
  isDowngrade,
  isTopupKey,
  money,
  prorate,
  quote,
  QuoteError,
  taxOf,
  TOPUP_KEYS,
  topupQuote,
  type CatalogPlan,
  type Choice,
  type Entitlement,
  type FreeTier,
  type Interval,
  type Pricing,
  type Quote,
  type QuoteLine,
  type QuotaKey,
  type TopupKey,
  QUOTA_KEYS,
  QUOTA_LABEL,
  type Quotas,
} from "@/lib/billing/catalog";
import type { Overrides } from "@/lib/billing/schema";
import type { Limits } from "@/lib/platform/plans";
import { moduleById, MODULE_IDS, type ModuleId } from "@/lib/workspace/modules";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { notify } from "../notify/notify";
import { settings } from "../platform/settings";
import { couponOfOrg, discountFor, earnFromInvoice, useDiscount } from "../partners/core";
import { audit } from "../services/audit";
import { safeEqual } from "../security/tokens";
import { providerApi, providerKey, type BillingProvider } from "./billing";
import { refreshPublicPages } from "../platform/public-pages";

type Exec = Pick<typeof db, "select" | "insert" | "update" | "execute">;
export type Sub = typeof schema.orgSubscriptions.$inferSelect;
export type Invoice = typeof schema.subscriptionInvoices.$inferSelect;

// ── Catalogue and pricing ───────────────────────────────────────────────────

const cache = globalThis as unknown as { __planCatalog?: { at: number; v: CatalogPlan[] } | null; __allowancesChecked?: boolean; __entitlements?: Map<string, { at: number; v: Entitlement & { planName: string; topups?: Partial<Record<string, number>> } }> };
export const clearCatalogCache = () => void (cache.__planCatalog = null);
const ents = () => (cache.__entitlements ??= new Map());
export const clearEntitlement = (orgId?: string) => (orgId ? ents().delete(orgId) : ents().clear());

const toPlan = (r: typeof schema.planCatalog.$inferSelect): CatalogPlan => ({
  id: r.id,
  name: r.name,
  tagline: r.tagline,
  kind: r.kind === "basic" ? "basic" : r.kind === "free" ? "free" : "preset",
  modules: (r.modules as ModuleId[] | null) ?? null,
  limits: r.limits,
  quotas: r.quotas ?? {},
  monthly: r.monthly,
  yearly: r.yearly,
  currency: r.currency,
  highlight: r.highlight,
  active: r.active,
  sort: r.sort,
});

const BACKFILL = "billing_allowances_backfilled";

/**
 * Once per platform: built-in plans saved before allowances existed (so with
 * none, i.e. unlimited AI, storage, email…) get the recommended allowances, so
 * every plan's running costs stay under its price and extra room can be sold
 * as add-ons. Prices, features and limits are left alone; a plan an admin
 * later leaves unlimited stays that way. Subscribers keep what they bought.
 */
async function backfillAllowances(rows: (typeof schema.planCatalog.$inferSelect)[]) {
  if (cache.__allowancesChecked) return false;
  const [done] = await db.select({ key: schema.platformSettings.key }).from(schema.platformSettings).where(eq(schema.platformSettings.key, BACKFILL));
  cache.__allowancesChecked = true;
  if (done) return false;
  const filled: string[] = [];
  for (const r of rows) {
    const d = DEFAULT_PLANS.find((x) => x.id === r.id);
    if (!d?.quotas || r.kind === "free" || Object.keys(r.quotas ?? {}).length) continue;
    await db.update(schema.planCatalog).set({ quotas: d.quotas as Record<string, number>, updatedAt: new Date() }).where(eq(schema.planCatalog.id, r.id));
    filled.push(r.id);
  }
  await db.insert(schema.platformSettings).values({ key: BACKFILL, value: { at: new Date().toISOString(), plans: filled } }).onConflictDoNothing();
  if (filled.length) log.info("plan_allowances_backfilled", { plans: filled });
  return filled.length > 0;
}

/** Every plan, including archived ones; the defaults are added the first time. Cached for 10 seconds. */
export async function allPlans(): Promise<CatalogPlan[]> {
  const c = cache.__planCatalog;
  if (c && Date.now() - c.at < 10_000) return c.v;
  let rows = await db.select().from(schema.planCatalog).orderBy(asc(schema.planCatalog.sort), asc(schema.planCatalog.monthly));
  // The defaults are added the first time — and the Free plan once, for catalogues made before it existed.
  if (!rows.length || !rows.some((r) => r.id === "free" || r.kind === "free")) {
    const add = rows.length ? DEFAULT_PLANS.filter((p) => p.kind === "free") : DEFAULT_PLANS;
    await db.insert(schema.planCatalog).values(add.map((p) => ({ ...p, modules: p.modules, quotas: p.quotas ?? {} }))).onConflictDoNothing();
    rows = await db.select().from(schema.planCatalog).orderBy(asc(schema.planCatalog.sort), asc(schema.planCatalog.monthly));
  }
  if (await backfillAllowances(rows)) rows = await db.select().from(schema.planCatalog).orderBy(asc(schema.planCatalog.sort), asc(schema.planCatalog.monthly));
  const v = rows.map(toPlan);
  cache.__planCatalog = { at: Date.now(), v };
  return v;
}

export const activePlans = async () => (await allPlans()).filter((p) => p.active);
/** Plans that can be bought (everything on sale but Free). */
export const paidPlans = async () => (await activePlans()).filter((p) => p.kind !== "free");

/** What a workspace has without a paid plan: the active Free plan, if the platform offers one. */
export async function freeTier(): Promise<FreeTier> {
  const p = await pricing();
  if (!p.freePlan) return null;
  const f = (await activePlans()).find((x) => x.kind === "free");
  return f ? { modules: f.modules, limits: f.limits, quotas: f.quotas ?? {} } : null;
}
export const pricing = async (): Promise<Pricing> => (await settings()).pricing as Pricing;

/** During the trial a workspace gets the largest limits on sale. */
export async function trialLimits(): Promise<Limits> {
  const ps = await paidPlans();
  const max = (k: keyof Limits) => Math.max(0, ...ps.map((p) => p.limits[k]));
  return ps.length ? { projects: max("projects"), seats: max("seats"), customDomains: max("customDomains"), automationsPerProject: max("automationsPerProject") } : { projects: 50, seats: 100, customDomains: 25, automationsPerProject: 100 };
}

export async function quoteFor(choice: Choice): Promise<Quote> {
  try {
    return quote(choice, await activePlans(), await pricing());
  } catch (e) {
    if (e instanceof QuoteError) throw new ApiError("validation_failed", e.message);
    throw e;
  }
}

/** The subscription columns for a priced choice. */
const snapshot = (q: Quote) => ({ planId: q.planId, planName: q.name, modules: q.modules, limits: q.limits, quotas: q.quotas, seats: q.seats, interval: q.interval, amount: q.amount, monthly: q.monthly, currency: q.currency, lines: q.lines });
type Snapshot = ReturnType<typeof snapshot>;
const isSnapshot = (v: unknown): v is Snapshot => !!v && typeof v === "object" && "planId" in v && "amount" in v && "interval" in v;

// ── A workspace's subscription ──────────────────────────────────────────────

async function event(exec: Exec, orgId: string, kind: string, detail: Record<string, unknown> = {}, actorId?: string | null, byPlatform = false) {
  await exec.insert(schema.subscriptionEvents).values({ orgId, kind, detail, actorId: actorId ?? null, byPlatform });
}

/** The free trial for someone starting now: the launch & Diwali offer's three months while it runs (lib/festive.ts). */
export function trialDaysNow(base: number) {
  const offer = launchOffer();
  return offer ? Math.max(base, offer.trialDays) : base;
}

/** Starts a new workspace's free trial of everything (once). */
export async function startTrial(exec: Exec, orgId: string) {
  const p = await pricing();
  const now = new Date();
  // The launch & Diwali offer: three months free for workspaces started while it runs (lib/festive.ts).
  const offer = launchOffer(now);
  const days = trialDaysNow(p.trialDays);
  const [row] = await exec
    .insert(schema.orgSubscriptions)
    .values({ orgId, planId: "trial", planName: "Free trial", modules: null, limits: await trialLimits(), status: "trialing", trialStartedAt: now, trialEndsAt: new Date(now.getTime() + days * 86_400_000) })
    .onConflictDoNothing()
    .returning();
  if (row) await event(exec, orgId, "trial_started", { days, endsAt: row.trialEndsAt, ...(offer ? { offer: "launch-diwali-2026" } : {}) });
  return row ?? null;
}

export async function subscriptionOf(orgId: string, exec: Exec = db): Promise<Sub | null> {
  const [s] = await exec.select().from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, orgId));
  return s ?? null;
}

/**
 * The platform team's overrides on top of whatever the workspace is on (trial,
 * plan, Free or grace): extra features, raised or lowered limits, and
 * allowances (null = unlimited). A read-only (expired) workspace stays read-only.
 */
export function withOverrides<E extends Entitlement>(e: E, o: Sub["overrides"] | null | undefined): E {
  if (!o || e.state === "unrestricted" || e.state === "expired") return e;
  const modules = e.modules === null ? null : [...new Set([...e.modules, ...(o.modules ?? [])])];
  const limits = { ...e.limits, ...(o.limits ?? {}) } as Limits;
  const quotas = { ...e.quotas };
  for (const [k, v] of Object.entries(o.quotas ?? {})) {
    if (v === null) delete quotas[k as QuotaKey];
    else if (typeof v === "number") quotas[k as QuotaKey] = v;
  }
  return { ...e, modules, limits, quotas };
}

/** What the workspace may use right now. Cached for a few seconds per server. */
export async function entitlementFor(orgId: string): Promise<Entitlement & { planName: string; topups?: Partial<Record<TopupKey | "aiBudgetUsd", number>> }> {
  const hit = ents().get(orgId);
  if (hit && Date.now() - hit.at < 5_000) return hit.v;
  const [sub, p] = await Promise.all([subscriptionOf(orgId), pricing()]);
  const v = { ...withOverrides(entitlement(sub, await trialLimits(), new Date(), p.enforce, { free: await freeTier(), trialQuotas: p.trialQuotas }), sub?.overrides), planName: sub?.planName ?? "" };
  if (v.state === "free") v.planName = "Free";
  // Top-ups left go on top of this month's allowances.
  if (v.state !== "unrestricted" && v.state !== "expired") {
    const extra = await topupExtras(orgId, v.quotas);
    if (Object.keys(extra).length) {
      Object.assign(v, { topups: extra });
      v.quotas = { ...v.quotas };
      for (const [k, n] of Object.entries(extra) as [TopupKey | "aiBudgetUsd", number][]) if (v.quotas[k] !== undefined && n > 0) v.quotas[k] = round4(v.quotas[k]! + n);
    }
  }
  ents().set(orgId, { at: Date.now(), v });
  return v;
}

/** The same for many workspaces at once (the session's workspace list). */
export async function entitlementsFor(orgIds: string[]) {
  if (!orgIds.length) return new Map<string, Entitlement & { planName: string; had: string[] | null }>();
  const [rows, p, tl] = await Promise.all([db.select().from(schema.orgSubscriptions).where(inArray(schema.orgSubscriptions.orgId, orgIds)), pricing(), trialLimits()]);
  const by = new Map(rows.map((r) => [r.orgId, r]));
  const free = await freeTier();
  return new Map(orgIds.map((id) => {
    const e = withOverrides(entitlement(by.get(id) ?? null, tl, new Date(), p.enforce, { free, trialQuotas: p.trialQuotas }), by.get(id)?.overrides);
    return [id, { ...e, planName: e.state === "free" ? "Free" : (by.get(id)?.planName ?? ""), had: (by.get(id)?.modules as string[] | null | undefined) ?? null }];
  }));
}

// Paying, and being shown as online in Chat, work even when a subscription has ended.
const API_ALWAYS = /^\/api\/v1\/orgs\/[^/]+\/(subscription|billing|chat\/presence)(\/|$)/;

/**
 * The plan's part of every workspace request: a feature outside the plan is
 * refused, and once a subscription has ended the workspace is read-only
 * (everything can still be opened and exported) until a plan is paid for.
 */
export async function assertEntitled(orgId: string, req: Request, module: ModuleId | null) {
  const path = new URL(req.url).pathname;
  if (API_ALWAYS.test(path)) return;
  const e = await entitlementFor(orgId);
  if (e.state === "unrestricted") return;
  if (e.state === "expired") {
    if (req.method !== "GET" && req.method !== "HEAD") throw new ApiError("forbidden", "Your subscription has ended, so this workspace is read-only. Choose a plan in Settings → Billing to carry on — nothing has been deleted.", { subscription: ["expired"] });
    return;
  }
  if (module && !entitledTo(e.modules, module)) {
    throw new ApiError("forbidden", `${moduleById(module)?.name ?? module} isn't in your ${e.planName || "current"} plan. Add it in Settings → Billing.`, { planRequired: [module] });
  }
}

// ── Changing plan ───────────────────────────────────────────────────────────

export type Preview = {
  mode: "trial" | "start" | "upgrade" | "downgrade" | "same";
  quote: Quote;
  /** Unused time on the current plan (upgrades). */
  credit: number;
  /** The new plan for the time being paid for. */
  charge: number;
  /** Credit already on the account, used here. */
  balanceUsed: number;
  subtotal: number;
  tax: number;
  total: number;
  /** Left over after this invoice (if the credit is more than the charge). */
  carry: number;
  /** Off from a partner's code (before tax), and the code. */
  discount: number;
  discountCode: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Upgrades: the time being charged for runs from here to periodEnd. */
  chargeFrom?: string | null;
  /** When the change takes effect. */
  effectiveAt: string | null;
  note: string;
};

function paidPeriod(sub: Sub, now: Date) {
  return !sub.complimentary && sub.currentPeriodStart && sub.currentPeriodEnd && sub.currentPeriodEnd > now && sub.currentPeriodStart <= now && sub.amount > 0 && sub.planId !== "trial";
}
const inTrial = (sub: Sub, now: Date) => sub.status === "trialing" && !!sub.trialEndsAt && sub.trialEndsAt > now;

/** Changes are measured to the minute, so a preview and the invoice that follows agree to the paisa. */
const toMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

export async function previewChange(orgId: string, choice: Choice, now = toMinute(new Date())): Promise<Preview> {
  const [sub, q, p] = await Promise.all([subscriptionOf(orgId), quoteFor(choice), pricing()]);
  if (!sub) throw new ApiError("not_found", "This workspace has no subscription yet");
  return previewFor(sub, q, p, now, await discountFor(orgId));
}

type Discount = Awaited<ReturnType<typeof discountFor>>;
const discountLine = (pv: Preview, d: Discount) => (pv.discount && d ? [{ label: `Partner code ${d.code} (${d.bps / 100}% off)`, amount: -pv.discount }] : []);

function previewFor(sub: Sub, q: Quote, p: Pricing, now: Date, disc: Discount = null): Preview {
  const base = { quote: q, credit: 0, charge: 0, balanceUsed: 0, carry: 0, discount: 0, discountCode: null };
  // Same plan, period, price and lines (so adding or dropping an add-on is a change).
  const lineKey = (ls: unknown) => ((ls as QuoteLine[] | null) ?? []).map((l) => `${l.label}|${l.amount}|${l.addon ?? ""}|${l.qty ?? ""}`).join("\n");
  const same = sub.planId === q.planId && sub.interval === q.interval && sub.amount === q.amount && JSON.stringify(sub.modules) === JSON.stringify(q.modules) && sub.seats === q.seats && lineKey(sub.lines) === lineKey(q.lines);
  const bill = (charge: number, credit: number) => {
    const owed = charge - credit;
    const balanceUsed = owed > 0 ? Math.min(sub.credit, owed) : 0;
    const before = Math.max(0, owed - balanceUsed);
    const discount = disc ? Math.round((before * disc.bps) / 10000) : 0;
    const subtotal = before - discount;
    const tax = taxOf(subtotal, p.taxBps);
    return { charge, credit, balanceUsed, subtotal, tax, total: subtotal + tax, carry: owed < 0 ? -owed : 0, discount, discountCode: discount ? disc!.code : null };
  };
  // Paid during the trial: changes are measured against that paid period, from when it starts.
  const prepaid = inTrial(sub, now) && !sub.complimentary && !!sub.currentPeriodStart && !!sub.currentPeriodEnd && sub.amount > 0 && sub.planId !== "trial";
  if (inTrial(sub, now) && !prepaid) {
    const start = sub.trialEndsAt!;
    return { ...base, mode: same ? "same" : "trial", ...bill(q.amount, 0), periodStart: start.toISOString(), periodEnd: addInterval(start, q.interval).toISOString(), effectiveAt: start.toISOString(), note: `Free until ${start.toDateString()} — everything stays switched on until then. Pay any time before it ends to carry on without a break.` };
  }
  if (paidPeriod(sub, now) || prepaid) {
    const at = prepaid ? sub.currentPeriodStart! : now;
    if (same) return { ...base, mode: "same", subtotal: 0, tax: 0, total: 0, periodStart: sub.currentPeriodStart!.toISOString(), periodEnd: sub.currentPeriodEnd!.toISOString(), effectiveAt: null, note: "You're already on this plan." };
    const from = { monthly: sub.monthly, modules: sub.modules, limits: sub.limits };
    if (isDowngrade(from, { monthly: q.monthly, modules: q.modules, limits: q.limits }) && !(q.interval === "year" && sub.interval === "month" && q.monthly >= sub.monthly)) {
      const at = sub.currentPeriodEnd!;
      return { ...base, mode: "downgrade", subtotal: 0, tax: 0, total: 0, periodStart: at.toISOString(), periodEnd: addInterval(at, q.interval).toISOString(), effectiveAt: at.toISOString(), note: `Takes effect when your current period ends on ${at.toDateString()}. You keep everything you have until then.` };
    }
    const r = prorate({ current: { amount: sub.amount, interval: sub.interval as Interval }, periodStart: sub.currentPeriodStart!, periodEnd: sub.currentPeriodEnd!, now: at, next: { amount: q.amount, interval: q.interval } });
    const fresh = r.periodStart.getTime() === at.getTime();
    return { ...base, mode: "upgrade", ...bill(r.charge, r.credit), periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString(), chargeFrom: (fresh ? r.periodStart : at).toISOString(), effectiveAt: (prepaid ? at : now).toISOString(), note: prepaid ? `You've already paid for ${sub.planName}; that payment counts in full towards ${q.name}. Everything stays switched on until your trial ends.` : `Starts as soon as it's paid. You're charged for the time left${fresh ? " on a new period starting today" : ` until ${r.periodEnd.toDateString()}`}, less what's unused on your current plan.` };
  }
  // No trial or paid period running (ended, or in the grace period): a fresh period from the day it's paid.
  return { ...base, mode: "start", ...bill(q.amount, 0), periodStart: now.toISOString(), periodEnd: addInterval(now, q.interval).toISOString(), effectiveAt: now.toISOString(), note: "Your plan starts the moment it's paid, for a full period from that day." };
}

/**
 * A smaller plan is only taken while the workspace fits in it — otherwise it
 * would keep more seats, sites or storage than it pays for. Says exactly what
 * to remove first.
 */
async function assertFits(orgId: string, q: Quote, o: Sub["overrides"] | null) {
  const { usageFor } = await import("./billing");
  const lim = { ...q.limits, ...(o?.limits ?? {}) } as Limits;
  const quotas: Quotas = { ...q.quotas };
  for (const [k, v] of Object.entries(o?.quotas ?? {})) if (v === null) delete quotas[k as QuotaKey];
  else if (typeof v === "number") quotas[k as QuotaKey] = v;
  const [u, totals] = await Promise.all([usageFor(orgId), quotaUsage(orgId)]);
  const over: string[] = [];
  if (u.seats > lim.seats) over.push(`${u.seats} team members (the plan has ${lim.seats})`);
  if (u.projects > lim.projects) over.push(`${u.projects} sites (the plan has ${lim.projects})`);
  if (u.customDomains > lim.customDomains) over.push(`${u.customDomains} custom domains (the plan has ${lim.customDomains})`);
  for (const k of ["contacts", "storageMb", "chatGuests"] as const) {
    const cap = quotas[k];
    if (cap !== undefined && totals[k] > cap) over.push(`${fmtQuota(k, totals[k])} ${QUOTA_LABEL[k].unit} (the plan has ${fmtQuota(k, cap)})`);
  }
  if (over.length) throw new ApiError("conflict", `${q.name} is smaller than what this workspace uses: ${over.join(", ")}. Remove the extra first, or choose a bigger plan.`, { fits: over });
}

const fmtQuota = (k: QuotaKey, n: number) => (k === "aiBudgetUsd" ? `$${n.toFixed(2)}` : Math.round(n).toLocaleString("en-IN"));

async function lockOrg(tx: Exec, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription:${orgId}`}))`);
}

async function voidOpen(tx: Exec, orgId: string, kinds: string[]) {
  await tx.update(schema.subscriptionInvoices).set({ status: "void" }).where(and(eq(schema.subscriptionInvoices.orgId, orgId), eq(schema.subscriptionInvoices.status, "open"), inArray(schema.subscriptionInvoices.kind, kinds)));
}

async function raiseInvoice(tx: Exec, orgId: string, v: { kind: string; description: string; lines: { label: string; amount: number }[]; subtotal: number; creditApplied: number; tax: number; total: number; currency: string; periodStart: Date | null; periodEnd: Date | null; dueAt: Date; applies: Record<string, unknown>; createdBy?: string | null }, p: Pricing) {
  const [inv] = await tx.insert(schema.subscriptionInvoices).values({ orgId, ...v, taxBps: p.taxBps, taxLabel: p.taxLabel, createdBy: v.createdBy ?? null }).returning();
  return inv;
}

const lineLabel = (l: { label: string; module?: string; addon?: string }) => (l.module ? `${moduleById(l.module as ModuleId)?.name ?? l.label}${l.addon ? " (add-on)" : ""}` : l.addon ? `${l.label} (add-on)` : l.label);

/**
 * Applies a choice. In the trial it's what you'll be on afterwards (an invoice
 * for the first period is raised, payable any time); an upgrade is invoiced for
 * the difference and applied once paid (at once if credit covers it); a
 * downgrade is scheduled for the end of the period.
 */
export async function changePlan(orgId: string, actorId: string, choice: Choice, now = toMinute(new Date())) {
  const [q, p] = await Promise.all([quoteFor(choice), pricing()]);
  const out = await db.transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const sub = await subscriptionOf(orgId, tx);
    if (!sub) throw new ApiError("not_found", "This workspace has no subscription yet");
    if (sub.complimentary && (!sub.compUntil || sub.compUntil > now)) throw new ApiError("conflict", "Your plan is provided by the Cloudesk team. Contact support to change it.");
    const disc = await discountFor(orgId, tx);
    const pv = previewFor(sub, q, p, now, disc);
    if (pv.mode !== "same") await assertFits(orgId, q, sub.overrides);
    const snap = snapshot(q);
    const discounted = pv.discount && disc ? { discount: { referralId: disc.referralId, amount: pv.discount } } : {};
    const lines = q.lines.map((l) => ({ label: lineLabel(l), amount: l.amount }));
    if (pv.mode === "same") throw new ApiError("conflict", "You're already on this plan.");
    if (pv.mode === "trial") {
      await tx.update(schema.orgSubscriptions).set({ ...snap, cancelAtPeriodEnd: false, updatedAt: now }).where(eq(schema.orgSubscriptions.id, sub.id));
      await voidOpen(tx, orgId, ["first", "upgrade"]);
      const inv = await raiseInvoice(tx, orgId, { kind: "first", description: `${q.name} — first ${q.interval === "year" ? "year" : "month"} after the trial`, lines: [...lines, ...discountLine(pv, disc)], subtotal: pv.subtotal, creditApplied: pv.balanceUsed, tax: pv.tax, total: pv.total, currency: q.currency, periodStart: new Date(pv.periodStart!), periodEnd: new Date(pv.periodEnd!), dueAt: sub.trialEndsAt!, applies: { snapshot: snap, start: "trial_end", ...discounted }, createdBy: actorId }, p);
      await event(tx, orgId, "plan_chosen", { plan: q.name, interval: q.interval, amount: q.amount, invoice: inv.seq }, actorId);
      return { preview: pv, invoice: inv, applied: true };
    }
    if (pv.mode === "downgrade") {
      await tx.update(schema.orgSubscriptions).set({ pending: { ...snap, effectiveAt: pv.effectiveAt }, updatedAt: now }).where(eq(schema.orgSubscriptions.id, sub.id));
      // An upgrade waiting to be paid would undo this; the renewal is raised again with the new plan.
      await voidOpen(tx, orgId, ["renewal", "upgrade"]);
      await event(tx, orgId, "change_scheduled", { plan: q.name, interval: q.interval, at: pv.effectiveAt }, actorId);
      return { preview: pv, invoice: null, applied: false };
    }
    // start or upgrade: one invoice for it; anything open from earlier choices goes.
    await voidOpen(tx, orgId, ["first", "upgrade"]);
    const span = (a: string, b: string) => `${new Date(a).toDateString().slice(4)} – ${new Date(b).toDateString().slice(4)}`;
    const extras = q.lines.filter(isAddonLine).length;
    const invLines = pv.mode === "upgrade" ? [{ label: `${q.name}${extras ? ` with ${extras} add-on${extras === 1 ? "" : "s"}` : ""}, ${span(pv.chargeFrom ?? pv.periodStart!, pv.periodEnd!)}`, amount: pv.charge }, ...(pv.credit ? [{ label: `Unused time on ${sub.planName}`, amount: -pv.credit }] : [])] : lines;
    if (pv.balanceUsed) invLines.push({ label: "Credit on your account", amount: -pv.balanceUsed });
    invLines.push(...discountLine(pv, disc));
    const inv = await raiseInvoice(tx, orgId, { kind: pv.mode === "upgrade" ? "upgrade" : "first", description: pv.mode === "upgrade" ? `Change to ${q.name}` : `${q.name} — ${q.interval === "year" ? "1 year" : "1 month"}`, lines: invLines, subtotal: pv.subtotal, creditApplied: pv.balanceUsed, tax: pv.tax, total: pv.total, currency: q.currency, periodStart: new Date(pv.periodStart!), periodEnd: new Date(pv.periodEnd!), dueAt: now, applies: { snapshot: snap, start: pv.mode === "upgrade" ? "now" : "on_payment", periodStart: pv.periodStart, periodEnd: pv.periodEnd, carry: pv.carry, ...discounted }, createdBy: actorId }, p);
    await event(tx, orgId, pv.mode === "upgrade" ? "upgrade_requested" : "plan_chosen", { plan: q.name, interval: q.interval, total: pv.total, invoice: inv.seq }, actorId);
    return { preview: pv, invoice: inv, applied: false };
  });
  clearEntitlement(orgId);
  // Nothing to pay (credit covers it): settled straight away.
  if (out.invoice && out.invoice.total === 0 && out.preview.mode !== "trial") {
    await markPaid(out.invoice.id, { via: "credit", ref: `credit:${out.invoice.id}` });
    return { ...out, applied: true };
  }
  await audit({ actorId, orgId, action: "billing.plan_changed", targetType: "subscription", targetId: orgId, metadata: { mode: out.preview.mode, plan: q.name, interval: q.interval, total: out.preview.total } });
  return out;
}

export async function cancelAtEnd(orgId: string, actorId: string, cancel: boolean) {
  await db.transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const sub = await subscriptionOf(orgId, tx);
    if (!sub) throw new ApiError("not_found", "No subscription");
    if (sub.complimentary) throw new ApiError("conflict", "Your plan is provided by the Cloudesk team. Contact support to change it.");
    if (sub.cancelAtPeriodEnd === cancel) return;
    if (!cancel && sub.status === "expired") throw new ApiError("conflict", "This subscription has ended — choose a plan to start again.");
    await tx.update(schema.orgSubscriptions).set({ cancelAtPeriodEnd: cancel, pending: cancel ? null : sub.pending, updatedAt: new Date() }).where(eq(schema.orgSubscriptions.id, sub.id));
    if (cancel) await voidOpen(tx, orgId, sub.status === "trialing" ? ["first", "renewal"] : ["renewal"]);
    // Changing their mind in the trial: the plan chosen for afterwards gets its invoice back (unless it's already paid).
    const now = new Date();
    if (!cancel && inTrial(sub, now) && sub.planId !== "trial" && sub.amount > 0 && !(sub.currentPeriodEnd && sub.currentPeriodEnd > sub.trialEndsAt!)) {
      const [open] = await tx.select({ id: schema.subscriptionInvoices.id }).from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, orgId), eq(schema.subscriptionInvoices.kind, "first"), eq(schema.subscriptionInvoices.status, "open")));
      if (!open) {
        const p = await pricing();
        const snap = { planId: sub.planId, planName: sub.planName, modules: sub.modules, limits: sub.limits, quotas: sub.quotas, seats: sub.seats, interval: sub.interval as Interval, amount: sub.amount, monthly: sub.monthly, currency: sub.currency, lines: sub.lines };
        const used = Math.min(sub.credit, sub.amount);
        const subtotal = sub.amount - used;
        const tax = taxOf(subtotal, p.taxBps);
        await raiseInvoice(tx, orgId, { kind: "first", description: `${sub.planName} — first ${sub.interval === "year" ? "year" : "month"} after the trial`, lines: [...(sub.lines as { label: string; amount: number; module?: string }[]).map((l) => ({ label: lineLabel(l), amount: l.amount })), ...(used ? [{ label: "Credit on your account", amount: -used }] : [])], subtotal, creditApplied: used, tax, total: subtotal + tax, currency: sub.currency, periodStart: sub.trialEndsAt!, periodEnd: addInterval(sub.trialEndsAt!, sub.interval as Interval), dueAt: sub.trialEndsAt!, applies: { snapshot: snap, start: "trial_end" }, createdBy: actorId }, p);
      }
    }
    await event(tx, orgId, cancel ? "cancel_requested" : "cancel_undone", { at: (sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnd)?.toISOString() }, actorId);
  });
  clearEntitlement(orgId);
  await audit({ actorId, orgId, action: cancel ? "billing.cancel" : "billing.resume", targetType: "subscription", targetId: orgId });
}

// ── Paying an invoice ───────────────────────────────────────────────────────

/** Providers that can take a one-off payment for an invoice (only the keys are needed; webhooks are optional). */
export function paymentProviders(): BillingProvider[] {
  const out: BillingProvider[] = [];
  if (providerKey("RAZORPAY_KEY_ID") && providerKey("RAZORPAY_KEY_SECRET")) out.push("razorpay");
  if (providerKey("STRIPE_SECRET_KEY")) out.push("stripe");
  return out;
}

async function invoiceOf(orgId: string, id: string) {
  const [inv] = await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.id, id), eq(schema.subscriptionInvoices.orgId, orgId)));
  if (!inv) throw new ApiError("not_found", "Invoice not found");
  return inv;
}

export const invoiceNumber = (inv: Pick<Invoice, "seq" | "createdAt">) => `CD-${new Date(inv.createdAt).getUTCFullYear()}-${String(inv.seq).padStart(6, "0")}`;

/** Opens a payment for an open invoice with the provider; the browser finishes it there. */
export async function startPayment(orgId: string, invoiceId: string, provider: BillingProvider, payer: { email: string; name: string }, returnTo: string) {
  if (!paymentProviders().includes(provider)) throw new ApiError("bad_request", "Online payments aren't set up yet. Contact support to pay another way.");
  const inv = await invoiceOf(orgId, invoiceId);
  if (inv.status !== "open") throw new ApiError("conflict", inv.status === "paid" ? "This invoice is already paid." : "This invoice was cancelled.");
  if (inv.total <= 0) throw new ApiError("conflict", "Nothing to pay on this invoice.");
  const number = invoiceNumber(inv);
  if (provider === "razorpay") {
    // One order per invoice and amount; asking again reuses it.
    let orderId = inv.providerRef?.startsWith("order_") ? inv.providerRef : "";
    if (!orderId) {
      const o = await providerApi("razorpay", "/orders", { json: { amount: inv.total, currency: inv.currency, receipt: number, notes: { invoice_id: inv.id, org_id: orgId } } });
      orderId = String(o.id);
      await db.update(schema.subscriptionInvoices).set({ providerRef: orderId }).where(eq(schema.subscriptionInvoices.id, inv.id));
    }
    return { provider, keyId: providerKey("RAZORPAY_KEY_ID"), orderId, amount: inv.total, currency: inv.currency, name: "Cloudesk", description: `${number} · ${inv.description}`, prefill: payer };
  }
  const base = returnTo.replace(/\?.*$/, "");
  const s = await providerApi("stripe", "/checkout/sessions", {
    form: {
      mode: "payment",
      customer_email: payer.email,
      client_reference_id: orgId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": inv.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(inv.total),
      "line_items[0][price_data][product_data][name]": `${number} · ${inv.description}`.slice(0, 250),
      "metadata[invoice_id]": inv.id,
      "metadata[org_id]": orgId,
      "payment_intent_data[metadata][invoice_id]": inv.id,
      success_url: `${base}?paid=stripe&invoice=${inv.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}?paid=cancelled`,
    },
    idempotencyKey: `invoice-${inv.id}-${inv.total}`,
  });
  await db.update(schema.subscriptionInvoices).set({ providerRef: String(s.id) }).where(eq(schema.subscriptionInvoices.id, inv.id));
  return { provider, url: String(s.url) };
}

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

/**
 * Confirms a payment the browser reports, by asking the provider. Razorpay: the
 * checkout signature (HMAC of order|payment with our secret) and then the payment
 * itself (captured, this order, this amount). Stripe: the checkout session is paid,
 * for this invoice and this amount.
 */
export async function confirmPayment(orgId: string, invoiceId: string, body: { provider: BillingProvider; orderId?: string; paymentId?: string; signature?: string; sessionId?: string }) {
  const inv = await invoiceOf(orgId, invoiceId);
  if (inv.status === "paid") return { paid: true, invoice: inv };
  if (inv.status !== "open") throw new ApiError("conflict", "This invoice was cancelled.");
  if (body.provider === "razorpay") {
    const { orderId = "", paymentId = "", signature = "" } = body;
    if (!orderId || orderId !== inv.providerRef) throw new ApiError("bad_request", "This payment isn't for this invoice.");
    if (!safeEqual(hmac(providerKey("RAZORPAY_KEY_SECRET"), `${orderId}|${paymentId}`), signature)) throw new ApiError("bad_request", "The payment couldn't be verified.");
    let pay = await providerApi("razorpay", `/payments/${encodeURIComponent(paymentId)}`);
    if (pay.order_id !== orderId || Number(pay.amount) !== inv.total || String(pay.currency) !== inv.currency) throw new ApiError("bad_request", "The payment doesn't match this invoice.");
    if (pay.status === "authorized") pay = await providerApi("razorpay", `/payments/${encodeURIComponent(paymentId)}/capture`, { json: { amount: inv.total, currency: inv.currency } });
    if (pay.status !== "captured") throw new ApiError("conflict", "The payment hasn't gone through yet. If money left your account, it will show here once Razorpay confirms it.");
    return { paid: true, invoice: await markPaid(inv.id, { via: "razorpay", ref: paymentId }) };
  }
  const sessionId = body.sessionId ?? "";
  if (!sessionId || sessionId !== inv.providerRef) throw new ApiError("bad_request", "This payment isn't for this invoice.");
  const s = await providerApi("stripe", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  const meta = (s.metadata ?? {}) as Record<string, string>;
  if (meta.invoice_id !== inv.id || Number(s.amount_total) !== inv.total || String(s.currency).toUpperCase() !== inv.currency) throw new ApiError("bad_request", "The payment doesn't match this invoice.");
  if (s.payment_status !== "paid") throw new ApiError("conflict", "The payment hasn't gone through yet.");
  return { paid: true, invoice: await markPaid(inv.id, { via: "stripe", ref: String(s.payment_intent ?? s.id) }) };
}

/** From the providers' signed webhooks (already verified by the caller). */
export async function paymentFromWebhook(provider: BillingProvider, invoiceId: string, ref: string, amount: number, currency: string) {
  const [inv] = await db.select().from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.id, invoiceId));
  if (!inv || inv.status === "void") return null;
  if (inv.status === "paid") return inv;
  if (amount !== inv.total || currency.toUpperCase() !== inv.currency) {
    log.warn("billing.webhook_amount_mismatch", { invoiceId, amount, currency });
    return null;
  }
  return markPaid(inv.id, { via: provider, ref });
}

/** Razorpay's webhook: the order identifies the invoice. */
export async function paymentByOrder(orderId: string, paymentId: string, amount: number, currency: string) {
  const [inv] = await db.select({ id: schema.subscriptionInvoices.id }).from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.providerRef, orderId));
  return inv ? paymentFromWebhook("razorpay", inv.id, paymentId, amount, currency) : null;
}

/**
 * Marks an invoice paid and does what it was for — once, whichever of the
 * browser, the webhook or an admin gets there first.
 */
export async function markPaid(invoiceId: string, how: { via: "razorpay" | "stripe" | "manual" | "credit"; ref: string; actorId?: string | null }, now = new Date()) {
  const res = await db.transaction(async (tx) => {
    const [pre] = await tx.select().from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.id, invoiceId));
    if (!pre) throw new ApiError("not_found", "Invoice not found");
    await lockOrg(tx, pre.orgId);
    const [inv] = await tx.update(schema.subscriptionInvoices).set({ status: "paid", paidAt: now, paidVia: how.via, paymentRef: how.ref }).where(and(eq(schema.subscriptionInvoices.id, invoiceId), eq(schema.subscriptionInvoices.status, "open"))).returning();
    if (!inv) {
      const [cur] = await tx.select().from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.id, invoiceId));
      if (cur?.status === "paid") return { inv: cur, fresh: false };
      throw new ApiError("conflict", "This invoice was cancelled, so it can't be paid.");
    }
    const sub = await subscriptionOf(inv.orgId, tx);
    const a = inv.applies as { snapshot?: unknown; start?: string; periodStart?: string; periodEnd?: string; carry?: number; discount?: { referralId: string }; topup?: { units: Partial<Record<string, number>> } };
    // A partner code's discount was used on this payment.
    if (a.discount?.referralId) await useDiscount(tx, a.discount.referralId);
    if (sub && isSnapshot(a.snapshot)) {
      const snap = a.snapshot;
      const credit = Math.max(0, sub.credit - inv.creditApplied) + (a.carry ?? 0);
      let start: Date, end: Date;
      if (inv.kind === "upgrade" && a.periodStart && a.periodEnd) [start, end] = [new Date(a.periodStart), new Date(a.periodEnd)];
      else if (a.start === "trial_end" && sub.trialEndsAt && sub.trialEndsAt > now && sub.status === "trialing") [start, end] = [sub.trialEndsAt, addInterval(sub.trialEndsAt, snap.interval as Interval)];
      else if (inv.kind === "renewal" && sub.currentPeriodEnd && (sub.currentPeriodEnd > now || (sub.graceEndsAt && sub.graceEndsAt > now))) [start, end] = [sub.currentPeriodEnd, addInterval(sub.currentPeriodEnd, snap.interval as Interval)];
      else [start, end] = [now, addInterval(now, snap.interval as Interval)];
      const keepTrial = sub.status === "trialing" && !!sub.trialEndsAt && sub.trialEndsAt > now;
      // A plan that starts now ends any trial still running (one that started at the trial's end keeps it).
      const trialEndsAt = !keepTrial && sub.trialEndsAt && sub.trialEndsAt > now ? now : sub.trialEndsAt;
      await tx.update(schema.orgSubscriptions).set({ ...snap, status: keepTrial ? "trialing" : "active", trialEndsAt, currentPeriodStart: start, currentPeriodEnd: end, graceEndsAt: null, cancelAtPeriodEnd: false, pending: inv.kind === "renewal" ? null : sub.pending && inv.kind !== "upgrade" ? sub.pending : null, credit, reminded: [], complimentary: false, compUntil: null, updatedAt: now }).where(eq(schema.orgSubscriptions.id, sub.id));
      if (how.via === "razorpay" || how.via === "stripe") await tx.update(schema.organizations).set({ billingProvider: how.via }).where(eq(schema.organizations.id, inv.orgId));
      await event(tx, inv.orgId, inv.kind === "renewal" ? "renewed" : inv.kind === "upgrade" ? "upgraded" : "activated", { invoice: inv.seq, plan: snap.planName, from: start.toISOString(), to: end.toISOString() }, how.actorId);
    }
    if (a.topup) {
      // Top-ups: the allowance goes up now; account credit used on it is spent.
      const units = Object.entries(a.topup.units).filter(([, n]) => typeof n === "number" && n > 0) as [string, number][];
      if (units.length) await tx.insert(schema.quotaTopups).values(units.map(([key, n]) => ({ orgId: inv.orgId, key, kind: "purchase", units: n, invoiceId: inv.id, createdAt: now })));
      if (sub && inv.creditApplied) await tx.update(schema.orgSubscriptions).set({ credit: Math.max(0, sub.credit - inv.creditApplied), updatedAt: now }).where(eq(schema.orgSubscriptions.id, sub.id));
      await event(tx, inv.orgId, "topup_added", { invoice: inv.seq, what: inv.description.replace(/^Top-up: /, "") }, how.actorId);
    }
    await event(tx, inv.orgId, "paid", { invoice: inv.seq, total: inv.total, via: how.via, ref: how.via === "manual" ? how.ref : undefined }, how.actorId, how.via === "manual");
    return { inv, fresh: true };
  });
  clearEntitlement(res.inv.orgId);
  if (res.fresh) {
    await audit({ actorId: how.actorId ?? null, orgId: res.inv.orgId, action: "billing.invoice_paid", targetType: "subscription_invoice", targetId: res.inv.id, metadata: { total: res.inv.total, via: how.via } });
    // The partner who brought this workspace earns their share.
    await earnFromInvoice(res.inv.id).catch((e) => log.warn("partner commission failed", { invoiceId: res.inv.id, error: String(e) }));
    if (res.inv.total > 0) {
      // The receipt (a PDF tax invoice) goes by email; the bell gets the note.
      await notifyOwners(res.inv.orgId, { kind: "billing.paid", title: `Payment received — ${invoiceNumber(res.inv)}`, body: `We received ${money(res.inv.total, res.inv.currency)}. Thank you!`, link: "/settings/billing", values: { number: invoiceNumber(res.inv), amount: money(res.inv.total, res.inv.currency) }, email: false });
      await (await import("./receipt")).sendReceipt(res.inv, invoiceNumber(res.inv)).catch((e) => log.warn("billing.receipt_failed", { invoiceId: res.inv.id, error: String(e) }));
    }
  }
  return res.inv;
}

async function notifyOwners(orgId: string, n: Parameters<typeof notify>[2]) {
  const owners = await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), inArray(schema.memberships.role, ["owner", "billing"])));
  await notify(orgId, owners.map((o) => o.id), n);
}

// ── What the workspace sees ─────────────────────────────────────────────────

const publicInvoice = (i: Invoice) => ({ id: i.id, number: invoiceNumber(i), kind: i.kind, description: i.description, lines: i.lines, subtotal: i.subtotal, creditApplied: i.creditApplied, taxLabel: i.taxLabel, taxBps: i.taxBps, tax: i.tax, total: i.total, currency: i.currency, periodStart: i.periodStart, periodEnd: i.periodEnd, status: i.status, dueAt: i.dueAt, paidAt: i.paidAt, paidVia: i.paidVia, createdAt: i.createdAt });

export async function overview(orgId: string) {
  const [sub, p, plans, ent, all] = await Promise.all([subscriptionOf(orgId), pricing(), paidPlans(), entitlementFor(orgId), activePlans()]);
  const freePlan = p.freePlan ? (all.find((x) => x.kind === "free") ?? null) : null;
  const [invoices, events, [paid], usage] = await Promise.all([
    db.select().from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.orgId, orgId)).orderBy(desc(schema.subscriptionInvoices.createdAt)).limit(50),
    db.select({ id: schema.subscriptionEvents.id, kind: schema.subscriptionEvents.kind, detail: schema.subscriptionEvents.detail, byPlatform: schema.subscriptionEvents.byPlatform, createdAt: schema.subscriptionEvents.createdAt, actor: schema.users.name }).from(schema.subscriptionEvents).leftJoin(schema.users, eq(schema.users.id, schema.subscriptionEvents.actorId)).where(eq(schema.subscriptionEvents.orgId, orgId)).orderBy(desc(schema.subscriptionEvents.createdAt)).limit(50),
    db.select({ total: sql<number>`coalesce(sum(${schema.subscriptionInvoices.total}),0)::bigint`, n: sql<number>`count(*)::int`, first: sql<string | null>`min(${schema.subscriptionInvoices.paidAt})` }).from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, orgId), eq(schema.subscriptionInvoices.status, "paid"), gt(schema.subscriptionInvoices.total, 0))),
    (await import("./billing")).usageFor(orgId),
  ]);
  const [org] = await db.select({ name: schema.organizations.name, slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const [qUsed, recap, coupon] = await Promise.all([quotaUsage(orgId), ent.state === "trial" || ent.state === "free" ? keepRecap(orgId) : Promise.resolve(null), couponOfOrg(orgId)]);
  const left = (ent.topups ?? {}) as Partial<Record<QuotaKey, number>>;
  // limit includes top-ups left; topup is how much of it they are.
  const quotas = Object.fromEntries(QUOTA_KEYS.filter((k) => ent.quotas[k] !== undefined).map((k) => [k, { used: qUsed[k], limit: ent.quotas[k]!, topup: left[k] ?? 0, label: QUOTA_LABEL[k].name, unit: QUOTA_LABEL[k].unit, monthly: QUOTA_LABEL[k].monthly }]));
  // What can be topped up now (the allowance is limited and its feature is on), and this month's top-up spend.
  const month = monthStart();
  const topupPaid = invoices.filter((i) => i.kind === "topup" && i.status === "paid" && i.paidAt && i.paidAt >= month);
  const topups = {
    packs: ent.state === "unrestricted" || ent.state === "expired" ? [] : TOPUP_KEYS.filter((k) => ent.quotas[k] !== undefined && (QUOTA_LABEL[k].module === null || ent.modules === null || ent.modules.includes(QUOTA_LABEL[k].module!))).map((k) => ({ key: k, size: p.packs[k].size, price: p.packs[k].price, left: left[k] ?? 0 })),
    month: { subtotal: topupPaid.reduce((n, i) => n + i.subtotal, 0), tax: topupPaid.reduce((n, i) => n + i.tax, 0), total: topupPaid.reduce((n, i) => n + i.total, 0), count: topupPaid.length },
  };
  const now = Date.now();
  const days = (d: Date | null | undefined) => (d ? Math.max(0, Math.ceil((d.getTime() - now) / 86_400_000)) : null);
  const open = invoices.filter((i) => i.status === "open");
  return {
    workspace: org ? { id: orgId, name: org.name, slug: org.slug } : null,
    enforced: p.enforce,
    state: ent.state,
    quotas,
    topups,
    recap,
    coupon,
    entitled: ent.modules,
    limits: ent.limits,
    usage,
    subscription: sub && {
      planId: sub.planId,
      planName: sub.planName,
      modules: sub.modules,
      limits: sub.limits,
      seats: sub.seats,
      interval: sub.interval,
      amount: sub.amount,
      monthly: sub.monthly,
      currency: sub.currency,
      lines: sub.lines,
      status: sub.status,
      trialStartedAt: sub.trialStartedAt,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      graceEndsAt: sub.graceEndsAt,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pending: sub.pending,
      credit: sub.credit,
      complimentary: sub.complimentary,
      compUntil: sub.compUntil,
    },
    stats: {
      trialDaysLeft: sub?.status === "trialing" ? days(sub.trialEndsAt) : null,
      trialDays: sub?.trialStartedAt && sub.trialEndsAt ? Math.round((sub.trialEndsAt.getTime() - sub.trialStartedAt.getTime()) / 86_400_000) : p.trialDays,
      periodDaysLeft: days(sub?.currentPeriodEnd),
      paidTotal: Number(paid?.total ?? 0),
      paidInvoices: paid?.n ?? 0,
      customerSince: paid?.first ?? null,
      due: open.reduce((s, i) => s + i.total, 0),
      nextDueAt: open.map((i) => i.dueAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null,
      featuresIncluded: ent.modules === null ? MODULE_IDS.length : ent.modules.length,
      featuresTotal: MODULE_IDS.length,
    },
    plans,
    free: freePlan,
    pricing: { currency: p.currency, trialDays: trialDaysNow(p.trialDays), taxBps: p.taxBps, taxLabel: p.taxLabel, yearlyMonths: p.yearlyMonths, graceDays: p.graceDays, customBase: p.customBase, customBaseModules: p.customBaseModules, customSeatsIncluded: p.customSeatsIncluded, seatPrice: p.seatPrice, customLimits: p.customLimits, modulePrices: p.modulePrices, customQuotas: p.customQuotas, aiCostShareBps: p.aiCostShareBps, usdInr: p.usdInr, packs: p.packs },
    providers: paymentProviders(),
    // Where payments must be made from (the website the payment provider approved), if set.
    payOrigin: (await import("../platform/config")).cfg("PAYMENT_ORIGIN")?.replace(/\/+$/, "") || null,
    invoices: invoices.map(publicInvoice),
    events,
  };
}

/** The catalogue as the public site and onboarding see it. */
export async function publicCatalog() {
  const [all, p] = await Promise.all([activePlans(), pricing()]);
  // Plans on sale; the Free plan (what you have without paying) separately.
  const plans = all.filter((x) => x.kind !== "free");
  const free = p.freePlan ? (all.find((x) => x.kind === "free") ?? null) : null;
  return { plans, free, pricing: { currency: p.currency, trialDays: trialDaysNow(p.trialDays), taxBps: p.taxBps, taxLabel: p.taxLabel, yearlyMonths: p.yearlyMonths, customBase: p.customBase, customBaseModules: p.customBaseModules, customSeatsIncluded: p.customSeatsIncluded, seatPrice: p.seatPrice, customLimits: p.customLimits, modulePrices: p.modulePrices } };
}

// ── The scheduler ───────────────────────────────────────────────────────────

const REMIND = [7, 3, 1];

/** Trial reminders and endings, renewal invoices, missed renewals and the end of grace periods. Safe to run often. */
export async function subscriptionTick(now = new Date()) {
  const p = await pricing();
  const day = 86_400_000;
  let changed = 0;

  // Trial reminders (7, 3 and 1 days before the end).
  const ending = await db.select().from(schema.orgSubscriptions).where(and(eq(schema.orgSubscriptions.status, "trialing"), gt(schema.orgSubscriptions.trialEndsAt, now), lte(schema.orgSubscriptions.trialEndsAt, new Date(now.getTime() + REMIND[0]! * day)))).limit(500);
  for (const s of ending) {
    const left = Math.ceil((s.trialEndsAt!.getTime() - now.getTime()) / day);
    const mark = REMIND.filter((d) => left <= d && !s.reminded.includes(d)).sort((a, b) => a - b)[0];
    if (mark === undefined) continue;
    await db.update(schema.orgSubscriptions).set({ reminded: [...s.reminded, ...REMIND.filter((d) => d >= mark)] }).where(eq(schema.orgSubscriptions.id, s.id));
    const paid = s.currentPeriodEnd && s.currentPeriodEnd > s.trialEndsAt!;
    await notifyOwners(s.orgId, { kind: "billing.trial", title: paid ? `Your trial ends in ${left} day${left === 1 ? "" : "s"} — your ${s.planName} plan is paid and starts then` : `Your free trial ends in ${left} day${left === 1 ? "" : "s"}`, body: paid ? "Nothing to do." : s.planId === "trial" ? "Choose a plan in Settings → Billing to keep everything running." : `Pay for your ${s.planName} plan in Settings → Billing to carry on without a break.`, link: "/settings/billing", values: { days: String(left) } });
  }

  // Trials that ended.
  const ended = await db.select().from(schema.orgSubscriptions).where(and(eq(schema.orgSubscriptions.status, "trialing"), lte(schema.orgSubscriptions.trialEndsAt, now))).limit(500);
  for (const s of ended) {
    const paid = !!s.currentPeriodEnd && s.currentPeriodEnd > now;
    await db.transaction(async (tx) => {
      await lockOrg(tx, s.orgId);
      await tx.update(schema.orgSubscriptions).set({ status: paid ? "active" : s.complimentary ? "active" : "expired", updatedAt: now }).where(and(eq(schema.orgSubscriptions.id, s.id), eq(schema.orgSubscriptions.status, "trialing")));
      await event(tx, s.orgId, "trial_ended", { paid });
    });
    if (!paid && !s.complimentary) {
      const free = await freeTier();
      await notifyOwners(s.orgId, { kind: "billing.expired", title: "Your free trial has ended", body: free ? "You're on the Free plan now. Everything you made is kept — choose a plan to get every feature back." : "Your workspace is read-only until you choose a plan. Nothing has been deleted.", link: "/settings/billing" });
    }
    clearEntitlement(s.orgId);
    changed++;
  }

  // Renewal invoices, raised a few days before a paid period ends.
  const due = await db
    .select()
    .from(schema.orgSubscriptions)
    .where(and(eq(schema.orgSubscriptions.status, "active"), eq(schema.orgSubscriptions.cancelAtPeriodEnd, false), eq(schema.orgSubscriptions.complimentary, false), isNotNull(schema.orgSubscriptions.currentPeriodEnd), lte(schema.orgSubscriptions.currentPeriodEnd, new Date(now.getTime() + p.renewalNoticeDays * day)), gt(schema.orgSubscriptions.currentPeriodEnd, new Date(now.getTime() - p.graceDays * day))))
    .limit(500);
  for (const s of due) {
    const inv = await db.transaction(async (tx) => {
      await lockOrg(tx, s.orgId);
      const [open] = await tx.select({ id: schema.subscriptionInvoices.id }).from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, s.orgId), eq(schema.subscriptionInvoices.kind, "renewal"), ne(schema.subscriptionInvoices.status, "void"), eq(schema.subscriptionInvoices.periodStart, s.currentPeriodEnd!)));
      if (open) return null;
      const next = isSnapshot(s.pending) ? (s.pending as Snapshot) : { planId: s.planId, planName: s.planName, modules: s.modules, limits: s.limits, quotas: s.quotas, seats: s.seats, interval: s.interval, amount: s.amount, monthly: s.monthly, currency: s.currency, lines: s.lines };
      const owed = next.amount;
      const used = Math.min(s.credit, owed);
      const disc = await discountFor(s.orgId, tx);
      const discount = disc ? Math.round(((owed - used) * disc.bps) / 10000) : 0;
      const subtotal = owed - used - discount;
      const tax = taxOf(subtotal, p.taxBps);
      const lines = [...(next.lines as { label: string; amount: number; module?: string }[]).map((l) => ({ label: lineLabel(l), amount: l.amount })), ...(used ? [{ label: "Credit on your account", amount: -used }] : []), ...(discount ? [{ label: `Partner code ${disc!.code} (${disc!.bps / 100}% off)`, amount: -discount }] : [])];
      const created = await raiseInvoice(tx, s.orgId, { kind: "renewal", description: `${next.planName} — renewal`, lines, subtotal, creditApplied: used, tax, total: subtotal + tax, currency: next.currency, periodStart: s.currentPeriodEnd!, periodEnd: addInterval(s.currentPeriodEnd!, next.interval as Interval), dueAt: s.currentPeriodEnd!, applies: { snapshot: next, start: "period_end", ...(discount ? { discount: { referralId: disc!.referralId, amount: discount } } : {}) } }, p);
      await event(tx, s.orgId, "renewal_invoiced", { invoice: created.seq, total: created.total });
      return created;
    });
    if (!inv) continue;
    changed++;
    if (inv.total === 0) await markPaid(inv.id, { via: "credit", ref: `credit:${inv.id}` }, now);
    else await notifyOwners(s.orgId, { kind: "billing.invoice", title: `Renewal invoice ${invoiceNumber(inv)} — ${money(inv.total, inv.currency)}`, body: `Due on ${s.currentPeriodEnd!.toDateString()}.`, link: "/settings/billing", values: { number: invoiceNumber(inv), amount: money(inv.total, inv.currency) } });
  }

  // Periods that ended: cancelled ones end; unpaid renewals get the grace period.
  const lapsed = await db.select().from(schema.orgSubscriptions).where(and(inArray(schema.orgSubscriptions.status, ["active"]), eq(schema.orgSubscriptions.complimentary, false), isNotNull(schema.orgSubscriptions.currentPeriodEnd), lte(schema.orgSubscriptions.currentPeriodEnd, now))).limit(500);
  for (const s of lapsed) {
    const status = s.cancelAtPeriodEnd || p.graceDays === 0 ? "expired" : "past_due";
    await db.transaction(async (tx) => {
      await lockOrg(tx, s.orgId);
      await tx.update(schema.orgSubscriptions).set({ status, graceEndsAt: status === "past_due" ? new Date(s.currentPeriodEnd!.getTime() + p.graceDays * day) : null, updatedAt: now }).where(and(eq(schema.orgSubscriptions.id, s.id), eq(schema.orgSubscriptions.status, "active"), lte(schema.orgSubscriptions.currentPeriodEnd, now)));
      await event(tx, s.orgId, status === "expired" ? (s.cancelAtPeriodEnd ? "canceled" : "expired") : "past_due", { graceDays: p.graceDays });
    });
    clearEntitlement(s.orgId);
    changed++;
    await notifyOwners(s.orgId, status === "expired" ? { kind: "billing.expired", title: "Your subscription has ended", body: "Your workspace is read-only until you choose a plan. Nothing has been deleted.", link: "/settings/billing" } : { kind: "billing.invoice", title: "Your renewal hasn't been paid", body: `Everything keeps working for ${p.graceDays} more days. Pay the renewal invoice in Settings → Billing.`, link: "/settings/billing" });
  }

  // Grace periods that ran out.
  const over = await db.select().from(schema.orgSubscriptions).where(and(eq(schema.orgSubscriptions.status, "past_due"), lte(schema.orgSubscriptions.graceEndsAt, now))).limit(500);
  for (const s of over) {
    await db.update(schema.orgSubscriptions).set({ status: "expired", updatedAt: now }).where(and(eq(schema.orgSubscriptions.id, s.id), eq(schema.orgSubscriptions.status, "past_due")));
    await event(db, s.orgId, "expired", { reason: "unpaid" });
    clearEntitlement(s.orgId);
    changed++;
    await notifyOwners(s.orgId, { kind: "billing.expired", title: "Your subscription has ended", body: "The renewal wasn't paid, so your workspace is read-only. Pay it in Settings → Billing to carry on.", link: "/settings/billing" });
  }

  // Complimentary plans that ran out.
  const comp = await db.select().from(schema.orgSubscriptions).where(and(eq(schema.orgSubscriptions.complimentary, true), isNotNull(schema.orgSubscriptions.compUntil), lte(schema.orgSubscriptions.compUntil, now))).limit(500);
  for (const s of comp) {
    await db.update(schema.orgSubscriptions).set({ complimentary: false, compUntil: null, status: s.currentPeriodEnd && s.currentPeriodEnd > now ? "active" : "expired", updatedAt: now }).where(eq(schema.orgSubscriptions.id, s.id));
    await event(db, s.orgId, "complimentary_ended", {});
    clearEntitlement(s.orgId);
    changed++;
  }
  return changed;
}

// ── The platform console ────────────────────────────────────────────────────

const monthlyOf = (s: Pick<Sub, "monthly" | "complimentary">) => (s.complimentary ? 0 : s.monthly);

export async function adminStats(now = new Date()) {
  const [byStatus, [mrr], [trialsSoon], [collected], [outstanding], [converted]] = await Promise.all([
    db.select({ status: schema.orgSubscriptions.status, n: sql<number>`count(*)::int` }).from(schema.orgSubscriptions).groupBy(schema.orgSubscriptions.status),
    db.select({ v: sql<number>`coalesce(sum(${schema.orgSubscriptions.monthly}),0)::bigint`, n: sql<number>`count(*)::int` }).from(schema.orgSubscriptions).where(and(inArray(schema.orgSubscriptions.status, ["active", "past_due"]), eq(schema.orgSubscriptions.complimentary, false), gt(schema.orgSubscriptions.currentPeriodEnd, sql`now() - interval '60 days'`))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.orgSubscriptions).where(and(eq(schema.orgSubscriptions.status, "trialing"), gt(schema.orgSubscriptions.trialEndsAt, now), lte(schema.orgSubscriptions.trialEndsAt, new Date(now.getTime() + 7 * 86_400_000)))),
    db.select({ v: sql<number>`coalesce(sum(${schema.subscriptionInvoices.total}),0)::bigint` }).from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.status, "paid"), gt(schema.subscriptionInvoices.paidAt, new Date(now.getTime() - 30 * 86_400_000)), ne(schema.subscriptionInvoices.paidVia, "credit"))),
    db.select({ v: sql<number>`coalesce(sum(${schema.subscriptionInvoices.total}),0)::bigint`, n: sql<number>`count(*)::int` }).from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.status, "open")),
    db.select({ n: sql<number>`count(distinct ${schema.subscriptionInvoices.orgId})::int` }).from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.status, "paid"), gt(schema.subscriptionInvoices.total, 0))),
  ]);
  const byPlan = await db.select({ plan: schema.orgSubscriptions.planName, n: sql<number>`count(*)::int`, mrr: sql<number>`coalesce(sum(case when ${schema.orgSubscriptions.complimentary} then 0 else ${schema.orgSubscriptions.monthly} end),0)::bigint` }).from(schema.orgSubscriptions).where(inArray(schema.orgSubscriptions.status, ["active", "past_due"])).groupBy(schema.orgSubscriptions.planName);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  const total = byStatus.reduce((s, r) => s + r.n, 0);
  return {
    currency: (await pricing()).currency,
    counts: { trialing: counts.trialing ?? 0, active: counts.active ?? 0, past_due: counts.past_due ?? 0, canceled: counts.canceled ?? 0, expired: counts.expired ?? 0, total },
    mrr: Number(mrr?.v ?? 0),
    arr: Number(mrr?.v ?? 0) * 12,
    paying: mrr?.n ?? 0,
    trialsEndingThisWeek: trialsSoon?.n ?? 0,
    collected30d: Number(collected?.v ?? 0),
    outstanding: Number(outstanding?.v ?? 0),
    openInvoices: outstanding?.n ?? 0,
    everPaid: converted?.n ?? 0,
    byPlan: byPlan.map((r) => ({ plan: r.plan, workspaces: r.n, mrr: Number(r.mrr) })),
  };
}

export async function adminList(q: { state?: string; search?: string; limit?: number }) {
  const where = [] as ReturnType<typeof eq>[];
  if (q.state && ["trialing", "active", "past_due", "canceled", "expired"].includes(q.state)) where.push(eq(schema.orgSubscriptions.status, q.state));
  if (q.search) where.push(sql`(${schema.organizations.name} ilike ${`%${q.search}%`} or ${schema.organizations.slug} ilike ${`%${q.search}%`})` as never);
  const rows = await db
    .select({ orgId: schema.orgSubscriptions.orgId, name: schema.organizations.name, slug: schema.organizations.slug, planId: schema.orgSubscriptions.planId, planName: schema.orgSubscriptions.planName, status: schema.orgSubscriptions.status, interval: schema.orgSubscriptions.interval, amount: schema.orgSubscriptions.amount, monthly: schema.orgSubscriptions.monthly, currency: schema.orgSubscriptions.currency, trialEndsAt: schema.orgSubscriptions.trialEndsAt, currentPeriodEnd: schema.orgSubscriptions.currentPeriodEnd, graceEndsAt: schema.orgSubscriptions.graceEndsAt, cancelAtPeriodEnd: schema.orgSubscriptions.cancelAtPeriodEnd, complimentary: schema.orgSubscriptions.complimentary, compUntil: schema.orgSubscriptions.compUntil, credit: schema.orgSubscriptions.credit, updatedAt: schema.orgSubscriptions.updatedAt })
    .from(schema.orgSubscriptions)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.orgSubscriptions.orgId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.orgSubscriptions.updatedAt))
    .limit(Math.min(500, q.limit ?? 200));
  const open = rows.length ? await db.select({ orgId: schema.subscriptionInvoices.orgId, v: sql<number>`sum(${schema.subscriptionInvoices.total})::bigint` }).from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.status, "open"), inArray(schema.subscriptionInvoices.orgId, rows.map((r) => r.orgId)))).groupBy(schema.subscriptionInvoices.orgId) : [];
  const dueBy = new Map(open.map((o) => [o.orgId, Number(o.v)]));
  return rows.map((r) => ({ ...r, mrr: monthlyOf(r), due: dueBy.get(r.orgId) ?? 0 }));
}

export type AdminAction =
  | { action: "extend_trial"; days: number }
  | { action: "end_trial" }
  | { action: "assign"; choice: Choice; complimentary: boolean; months?: number | null; note?: string }
  | { action: "cancel" }
  | { action: "reactivate" }
  | { action: "expire" }
  | { action: "credit"; amount: number; note: string }
  | { action: "record_payment"; invoiceId: string; reference: string }
  | { action: "void_invoice"; invoiceId: string }
  | { action: "end_complimentary" }
  | { action: "set_overrides"; overrides: Overrides };

/** What the platform team can do to a workspace's subscription; all of it is on the timeline and in the audit log. */
export async function adminAct(adminId: string, orgId: string, a: AdminAction, now = new Date()) {
  const p = await pricing();
  if (a.action === "record_payment") {
    const [inv] = await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.id, a.invoiceId), eq(schema.subscriptionInvoices.orgId, orgId)));
    if (!inv) throw new ApiError("not_found", "Invoice not found");
    await markPaid(inv.id, { via: "manual", ref: `manual:${a.reference}:${inv.id}`, actorId: adminId }, now);
  } else if (a.action === "assign") {
    const q = await quoteFor(a.choice);
    await db.transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const sub = await subscriptionOf(orgId, tx);
      if (!sub) throw new ApiError("not_found", "No subscription");
      await voidOpen(tx, orgId, ["first", "upgrade", "renewal"]);
      if (a.complimentary) {
        const until = a.months ? addInterval(now, "month", a.months) : null;
        await tx.update(schema.orgSubscriptions).set({ ...snapshot(q), status: "active", complimentary: true, compUntil: until, trialEndsAt: sub.trialEndsAt && sub.trialEndsAt > now ? now : sub.trialEndsAt, cancelAtPeriodEnd: false, graceEndsAt: null, pending: null, updatedAt: now }).where(eq(schema.orgSubscriptions.id, sub.id));
        await event(tx, orgId, "complimentary_given", { plan: q.name, until: until?.toISOString() ?? null, note: a.note ?? "" }, adminId, true);
      } else {
        // An invoice for the workspace to pay; the plan starts when it's paid.
        const tax = taxOf(q.amount, p.taxBps);
        const inv = await raiseInvoice(tx, orgId, { kind: "first", description: `${q.name} — ${q.interval === "year" ? "1 year" : "1 month"}`, lines: q.lines.map((l) => ({ label: lineLabel(l), amount: l.amount })), subtotal: q.amount, creditApplied: 0, tax, total: q.amount + tax, currency: q.currency, periodStart: now, periodEnd: addInterval(now, q.interval), dueAt: now, applies: { snapshot: snapshot(q), start: inTrial(sub, now) ? "trial_end" : "on_payment" }, createdBy: adminId }, p);
        if (inTrial(sub, now)) await tx.update(schema.orgSubscriptions).set({ ...snapshot(q), updatedAt: now }).where(eq(schema.orgSubscriptions.id, sub.id));
        await event(tx, orgId, "plan_assigned", { plan: q.name, invoice: inv.seq, note: a.note ?? "" }, adminId, true);
      }
    });
  } else {
    await db.transaction(async (tx) => {
      await lockOrg(tx, orgId);
      const sub = await subscriptionOf(orgId, tx);
      if (!sub) throw new ApiError("not_found", "No subscription");
      const set = (v: Partial<typeof schema.orgSubscriptions.$inferInsert>) => tx.update(schema.orgSubscriptions).set({ ...v, updatedAt: now }).where(eq(schema.orgSubscriptions.id, sub.id));
      switch (a.action) {
        case "extend_trial": {
          if (!Number.isInteger(a.days) || a.days < 1 || a.days > 365) throw new ApiError("validation_failed", "Extend by 1 to 365 days");
          const from = inTrial(sub, now) ? sub.trialEndsAt! : now;
          const until = new Date(from.getTime() + a.days * 86_400_000);
          await set({ status: "trialing", trialEndsAt: until, trialStartedAt: sub.trialStartedAt ?? now, reminded: [], graceEndsAt: null });
          await event(tx, orgId, "trial_extended", { days: a.days, until: until.toISOString() }, adminId, true);
          break;
        }
        case "end_trial":
          if (!inTrial(sub, now)) throw new ApiError("conflict", "This workspace isn't on a trial");
          await set({ trialEndsAt: now });
          await event(tx, orgId, "trial_ended_by_platform", {}, adminId, true);
          break;
        case "cancel":
          await set({ cancelAtPeriodEnd: true, pending: null });
          await voidOpen(tx, orgId, ["renewal"]);
          await event(tx, orgId, "cancel_requested", {}, adminId, true);
          break;
        case "reactivate":
          await set({ cancelAtPeriodEnd: false });
          await event(tx, orgId, "cancel_undone", {}, adminId, true);
          break;
        case "expire":
          await set({ status: "expired", currentPeriodEnd: sub.currentPeriodEnd && sub.currentPeriodEnd > now ? now : sub.currentPeriodEnd, trialEndsAt: sub.trialEndsAt && sub.trialEndsAt > now ? now : sub.trialEndsAt, graceEndsAt: null, complimentary: false, compUntil: null });
          await voidOpen(tx, orgId, ["renewal"]);
          await event(tx, orgId, "expired", { reason: "platform" }, adminId, true);
          break;
        case "credit":
          if (!Number.isInteger(a.amount) || a.amount === 0 || Math.abs(a.amount) > 100_000_000) throw new ApiError("validation_failed", "Enter an amount");
          if (sub.credit + a.amount < 0) throw new ApiError("validation_failed", "Credit can't go below zero");
          await set({ credit: sub.credit + a.amount });
          await event(tx, orgId, "credit", { amount: a.amount, note: a.note }, adminId, true);
          break;
        case "void_invoice": {
          const [inv] = await tx.update(schema.subscriptionInvoices).set({ status: "void" }).where(and(eq(schema.subscriptionInvoices.id, a.invoiceId), eq(schema.subscriptionInvoices.orgId, orgId), eq(schema.subscriptionInvoices.status, "open"))).returning();
          if (!inv) throw new ApiError("conflict", "Only an open invoice can be voided");
          await event(tx, orgId, "invoice_voided", { invoice: inv.seq }, adminId, true);
          break;
        }
        case "set_overrides": {
          const o = a.overrides;
          const clean = { modules: o.modules, limits: o.limits, quotas: o.quotas, note: o.note };
          await set({ overrides: clean });
          await event(tx, orgId, "overrides_set", { modules: o.modules, limits: o.limits, quotas: o.quotas, note: o.note }, adminId, true);
          break;
        }
        case "end_complimentary":
          if (!sub.complimentary) throw new ApiError("conflict", "This workspace isn't on a complimentary plan");
          await set({ complimentary: false, compUntil: null, status: sub.currentPeriodEnd && sub.currentPeriodEnd > now ? "active" : "expired" });
          await event(tx, orgId, "complimentary_ended", {}, adminId, true);
          break;
      }
    });
  }
  clearEntitlement(orgId);
  await audit({ actorId: adminId, orgId, action: `platform.subscription_${a.action}`, targetType: "subscription", targetId: orgId, metadata: a as unknown as Record<string, unknown> });
  return overview(orgId);
}

/** Admin → Plans: add or edit a plan in the catalogue. Existing subscribers keep what they bought. */
export async function savePlan(adminId: string, plan: CatalogPlan) {
  if (!/^[a-z0-9-]{2,30}$/.test(plan.id) || plan.id === "custom" || plan.id === "trial") throw new ApiError("validation_failed", "Plan ids are 2–30 lowercase letters, digits or dashes (not “custom” or “trial”)");
  if (plan.modules && plan.modules.some((m) => !MODULE_IDS.includes(m))) throw new ApiError("validation_failed", "Unknown feature in the plan");
  if (plan.kind === "free") {
    if (plan.monthly !== 0 || plan.yearly !== 0) throw new ApiError("validation_failed", "The Free plan costs nothing — set both prices to 0");
    if (!plan.modules) throw new ApiError("validation_failed", "Choose the features the Free plan includes (not every feature)");
    const other = (await allPlans()).find((p) => p.kind === "free" && p.id !== plan.id);
    if (other) throw new ApiError("conflict", `${other.name} is already the free plan`);
  } else if (plan.monthly < 100 || plan.yearly < 100) throw new ApiError("validation_failed", "A paid plan costs at least ₹1");
  const modules = plan.modules ? (await import("@/lib/workspace/modules")).withRequirements(plan.modules) : null;
  const values = { ...plan, modules, quotas: (plan.quotas ?? {}) as Record<string, number>, updatedAt: new Date() };
  await db.insert(schema.planCatalog).values(values).onConflictDoUpdate({ target: schema.planCatalog.id, set: values });
  refreshPublicPages();
  clearCatalogCache();
  await audit({ actorId: adminId, action: "platform.plan_saved", targetType: "plan", targetId: plan.id, metadata: { name: plan.name, monthly: plan.monthly, yearly: plan.yearly, active: plan.active, modules: modules?.length ?? "all" } });
  return allPlans();
}

/**
 * Admin → Plans → a plan → "Give subscribers the latest": existing subscribers
 * keep a copy of what they bought, so features and allowances added to a plan
 * later don't reach them. This brings their features, limits and allowances up
 * to the plan as it is now; what they pay stays the same until they change plan.
 * Seats bought on top are kept.
 */
export async function syncSubscribers(adminId: string, planId: string) {
  const plan = (await allPlans()).find((p) => p.id === planId);
  if (!plan || plan.kind === "free") throw new ApiError("not_found", "Plan not found");
  const rows = await db.select({ id: schema.orgSubscriptions.id, orgId: schema.orgSubscriptions.orgId, seats: schema.orgSubscriptions.seats, limits: schema.orgSubscriptions.limits, lines: schema.orgSubscriptions.lines, interval: schema.orgSubscriptions.interval }).from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.planId, planId));
  const [plans, p] = await Promise.all([allPlans(), pricing()]);
  for (const r of rows) {
    // Add-ons bought on top stay on top of the plan as it is now.
    let now = { modules: plan.modules, limits: { ...plan.limits }, quotas: (plan.quotas ?? {}) as Quotas };
    try {
      const q = quote({ kind: "plan", planId, interval: r.interval as Interval, addons: addonsOf(r.lines) }, plans.map((x) => (x.id === planId ? { ...x, active: true } : x)), p);
      now = { modules: q.modules, limits: q.limits, quotas: q.quotas };
    } catch {
      // An add-on that can't be sold any more: the plan alone.
    }
    const limits = { ...now.limits, seats: Math.max(now.limits.seats, r.limits?.seats ?? 0) };
    await db.update(schema.orgSubscriptions).set({ modules: now.modules, limits, quotas: now.quotas as Record<string, number>, planName: plan.name, updatedAt: new Date() }).where(eq(schema.orgSubscriptions.id, r.id));
    await event(db, r.orgId, "plan_refreshed", { plan: plan.name }, adminId, true);
    clearEntitlement(r.orgId);
  }
  await audit({ actorId: adminId, action: "platform.plan_synced", targetType: "plan", targetId: planId, metadata: { subscribers: rows.length } });
  return { updated: rows.length };
}

/**
 * Admin → Plans → "Apply recommended plans": the built-in plans' features,
 * limits and allowances (and any built-in plan that's missing, like Business).
 * Prices, names and what's on sale are left exactly as the platform set them.
 */
export async function applyRecommendedPlans(adminId: string) {
  const have = new Map((await allPlans()).map((p) => [p.id, p]));
  for (const d of DEFAULT_PLANS) {
    const cur = have.get(d.id);
    const values = cur
      ? { ...cur, tagline: d.tagline, modules: d.modules, limits: d.limits, quotas: (d.quotas ?? {}) as Record<string, number>, sort: d.sort, updatedAt: new Date() }
      : { ...d, quotas: (d.quotas ?? {}) as Record<string, number>, updatedAt: new Date() };
    await db.insert(schema.planCatalog).values(values).onConflictDoUpdate({ target: schema.planCatalog.id, set: values });
  }
  clearCatalogCache();
  refreshPublicPages();
  await audit({ actorId: adminId, action: "platform.plans_recommended", targetType: "plan", targetId: "catalogue", metadata: { plans: DEFAULT_PLANS.map((p) => p.id) } });
  return allPlans();
}

/** Rough provider prices, for the margins view (US dollars). */
const COST = { emailUsd: 0.0004, storageGbUsd: 0.023 };

/**
 * Admin → Margins: what each workspace pays against what it costs to run this
 * month (AI, campaign email, storage), worst first — so a plan or a customer
 * that loses money shows up before the invoice does.
 */
export async function margins(limit = 200) {
  const p = await pricing();
  const since = monthStart();
  const rate = p.usdInr;
  const rows = await db.execute(sql`
    select s.org_id, o.name, o.slug, s.plan_name, s.status, s.complimentary, s.monthly, s.currency,
      coalesce((select sum(cost_micro_usd) from ai_tasks t where t.org_id = s.org_id and t.created_at >= ${since}),0)::bigint as ai_micro,
      coalesce((select count(*) from mkt_sends m where m.org_id = s.org_id and m.sent_at >= ${since}),0)::int as emails,
      (coalesce((select sum(size) from doc_versions v where v.org_id = s.org_id),0) + coalesce((select sum(size) from doc_assets x where x.org_id = s.org_id),0) + coalesce((select sum(a.size) from assets a join projects pr on pr.id = a.project_id where pr.org_id = s.org_id),0))::bigint as bytes
    from org_subscriptions s join organizations o on o.id = s.org_id
    order by ai_micro desc limit ${Math.min(1000, limit)}`);
  const list = (rows.rows as { org_id: string; name: string; slug: string; plan_name: string; status: string; complimentary: boolean; monthly: number; currency: string; ai_micro: string; emails: number; bytes: string }[]).map((r) => {
    const revenue = r.complimentary || !["active", "past_due"].includes(r.status) ? 0 : Number(r.monthly);
    const aiUsd = Number(r.ai_micro) / 1_000_000;
    const costUsd = aiUsd + r.emails * COST.emailUsd + (Number(r.bytes) / 1_073_741_824) * COST.storageGbUsd;
    const cost = Math.round(costUsd * rate * 100);
    return { orgId: r.org_id, name: r.name, slug: r.slug, plan: r.plan_name, status: r.status, complimentary: r.complimentary, revenue, aiUsd: Math.round(aiUsd * 100) / 100, emails: r.emails, storageMb: Math.round(Number(r.bytes) / 1_048_576), cost, margin: revenue - cost, losing: cost > revenue && cost > 0 };
  });
  list.sort((a, b) => a.margin - b.margin);
  const totals = list.reduce((t, r) => ({ revenue: t.revenue + r.revenue, cost: t.cost + r.cost, losing: t.losing + (r.losing ? 1 : 0) }), { revenue: 0, cost: 0, losing: 0 });
  return { currency: p.currency, usdInr: rate, since: since.toISOString(), totals: { ...totals, margin: totals.revenue - totals.cost }, workspaces: list };
}

/** One workspace's allowances: used, its limit, and the plan's limit before any override. */
export async function allowancesOf(orgId: string) {
  const [e, used, sub] = await Promise.all([entitlementFor(orgId), quotaUsage(orgId), subscriptionOf(orgId)]);
  return { state: e.state, plan: e.planName, modules: e.modules, limits: e.limits, overrides: sub?.overrides ?? {}, quotas: QUOTA_KEYS.map((k) => ({ key: k, name: QUOTA_LABEL[k].name, unit: QUOTA_LABEL[k].unit, used: Math.round(used[k] * 100) / 100, limit: e.quotas[k] ?? null })) };
}

/** Subscribers per plan, for the catalogue editor. */
export async function planUsage() {
  // Workspaces on the plan now: paying (or in their grace period) or given it by the platform.
  const rows = await db.select({ planId: schema.orgSubscriptions.planId, n: sql<number>`count(*)::int` }).from(schema.orgSubscriptions).where(inArray(schema.orgSubscriptions.status, ["active", "past_due"])).groupBy(schema.orgSubscriptions.planId);
  return Object.fromEntries(rows.map((r) => [r.planId, r.n]));
}

// ── Free plan allowances and helping people choose a plan ───────────────────

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// ── Top-ups ─────────────────────────────────────────────────────────────────

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
type TopupUnit = TopupKey | "aiBudgetUsd";

/** One monthly allowance's use between two dates (for settling a month that has ended). */
async function usageBetween(orgId: string, key: TopupUnit, from: Date, to: Date): Promise<number> {
  const n = (r: { rows: unknown[] }) => Number((r.rows[0] as { n?: number | string } | undefined)?.n ?? 0);
  switch (key) {
    case "invoicesPerMonth":
      return n(await db.execute(sql`select count(*)::int as n from invoice_documents d join invoice_owners o on o.id = d.project_id left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where coalesce(p.org_id, b.org_id) = ${orgId} and d.type = 'invoice' and d.created_at >= ${from} and d.created_at < ${to}`));
    case "aiPerMonth":
      return n(await db.execute(sql`select count(*)::int as n from ai_tasks where org_id = ${orgId} and created_at > ${from} and created_at < ${to}`));
    case "aiBudgetUsd":
      return n(await db.execute(sql`select coalesce(sum(cost_micro_usd),0)::bigint as n from ai_tasks where org_id = ${orgId} and created_at > ${from} and created_at < ${to}`)) / 1_000_000;
    case "campaignEmailsPerMonth":
      return n(await db.execute(sql`select count(*)::int as n from mkt_sends where org_id = ${orgId} and sent_at >= ${from} and sent_at < ${to}`));
    case "signaturesPerMonth":
      return n(await db.execute(sql`select count(*)::int as n from doc_sign_requests where org_id = ${orgId} and created_at > ${from} and created_at < ${to}`));
  }
}

/**
 * What's left of each top-up: everything bought, less what went on usage
 * beyond the plan's allowance in months that have ended. Settles those months
 * the first time they're needed (once each), so the balance carries over and
 * only real use beyond the plan ever draws on it.
 */
export async function topupExtras(orgId: string, base: Quotas, now = new Date()): Promise<Partial<Record<TopupUnit, number>>> {
  const rows = await db.select().from(schema.quotaTopups).where(eq(schema.quotaTopups.orgId, orgId));
  if (!rows.length) return {};
  const cur = monthKey(now);
  const out: Partial<Record<TopupUnit, number>> = {};
  for (const key of [...new Set(rows.map((r) => r.key))] as TopupUnit[]) {
    const mine = rows.filter((r) => r.key === key);
    const bought = mine.filter((r) => r.kind === "purchase");
    if (!bought.length) continue;
    const settled = new Map(mine.filter((r) => r.kind === "used" && r.month).map((r) => [r.month!, r.units]));
    // Each month from the first purchase up to last month, oldest first.
    for (let m = monthStart(new Date(Math.min(...bought.map((r) => r.createdAt.getTime())))); monthKey(m) < cur; m = nextMonth(m)) {
      const mk = monthKey(m);
      if (settled.has(mk)) continue;
      const end = nextMonth(m);
      const avail = bought.filter((r) => r.createdAt < end).reduce((s, r) => s + r.units, 0) - [...settled].filter(([k]) => k < mk).reduce((s, [, u]) => s + u, 0);
      const cap = base[key];
      const take = avail <= 0 || cap === undefined ? 0 : round4(Math.min(avail, Math.max(0, (await usageBetween(orgId, key, m, end)) - cap)));
      await db.insert(schema.quotaTopups).values({ orgId, key, kind: "used", units: take, month: mk }).onConflictDoNothing();
      const [row] = await db.select({ units: schema.quotaTopups.units }).from(schema.quotaTopups).where(and(eq(schema.quotaTopups.orgId, orgId), eq(schema.quotaTopups.key, key), eq(schema.quotaTopups.kind, "used"), eq(schema.quotaTopups.month, mk)));
      settled.set(mk, row?.units ?? take);
    }
    out[key] = round4(Math.max(0, bought.reduce((s, r) => s + r.units, 0) - [...settled].filter(([k]) => k < cur).reduce((s, [, u]) => s + u, 0)));
  }
  return out;
}

/**
 * Buys top-ups: one invoice, due now, paid online (or from account credit).
 * The allowance goes up the moment it's paid. Any earlier unpaid top-up
 * invoice is replaced, so nothing is charged twice.
 */
export async function buyTopup(orgId: string, actorId: string, packs: Partial<Record<TopupKey, number>>, now = new Date()) {
  const [p, ent] = await Promise.all([pricing(), entitlementFor(orgId)]);
  if (ent.state === "unrestricted") throw new ApiError("conflict", "Nothing is limited on this workspace — there's nothing to top up.");
  if (ent.state === "expired") throw new ApiError("conflict", "This workspace's plan has ended. Choose a plan first.");
  for (const k of Object.keys(packs)) {
    if (!isTopupKey(k)) throw new ApiError("validation_failed", "That allowance can't be topped up.");
    if (ent.quotas[k] === undefined && (packs[k] ?? 0) > 0) throw new ApiError("conflict", `${QUOTA_LABEL[k].name} are already unlimited on your plan.`);
  }
  let t;
  try {
    t = topupQuote(packs, p);
  } catch (e) {
    if (e instanceof QuoteError) throw new ApiError("validation_failed", e.message);
    throw e;
  }
  const inv = await db.transaction(async (tx) => {
    await lockOrg(tx, orgId);
    const sub = await subscriptionOf(orgId, tx);
    await voidOpen(tx, orgId, ["topup"]);
    const used = Math.min(sub?.credit ?? 0, t.amount);
    const subtotal = t.amount - used;
    const tax = taxOf(subtotal, p.taxBps);
    const lines = [...t.lines.map((l) => ({ label: l.label, amount: l.amount })), ...(used ? [{ label: "Credit on your account", amount: -used }] : [])];
    const names = t.lines.map((l) => l.label.replace(/ \(top-up\)$/, "")).join(", ");
    const row = await raiseInvoice(tx, orgId, { kind: "topup", description: `Top-up: ${names}`, lines, subtotal, creditApplied: used, tax, total: subtotal + tax, currency: p.currency, periodStart: null, periodEnd: null, dueAt: now, applies: { topup: { packs, units: t.units } }, createdBy: actorId }, p);
    await event(tx, orgId, "topup_requested", { what: names, total: subtotal + tax, invoice: row.seq }, actorId);
    return row;
  });
  if (inv.total === 0) return { invoice: await markPaid(inv.id, { via: "credit", ref: `credit:${inv.id}`, actorId }), applied: true };
  return { invoice: inv, applied: false };
}

/** How much of each allowance the workspace has used (this calendar month; contacts, storage and guests in total). */
export async function quotaUsage(orgId: string, only?: QuotaKey): Promise<Record<QuotaKey, number>> {
  const since = monthStart();
  const want = (k: QuotaKey) => !only || only === k;
  const one = async (q: Promise<{ n: number | string | null }[]> | null) => (q ? Number((await q)[0]?.n ?? 0) : 0);
  const [inv, contacts, ai, aiCost, campaign, sign, storage, guests] = await Promise.all([
    want("invoicesPerMonth")
      ? db.execute(sql`select count(*)::int as n from invoice_documents d join invoice_owners o on o.id = d.project_id left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where coalesce(p.org_id, b.org_id) = ${orgId} and d.type = 'invoice' and d.created_at >= ${since}`).then((r) => Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0))
      : 0,
    one(want("contacts") ? db.select({ n: sql<number>`count(*)::int` }).from(schema.crmContacts).where(eq(schema.crmContacts.orgId, orgId)) : null),
    one(want("aiPerMonth") ? db.select({ n: sql<number>`count(*)::int` }).from(schema.aiTasks).where(and(eq(schema.aiTasks.orgId, orgId), gt(schema.aiTasks.createdAt, since))) : null),
    one(want("aiBudgetUsd") ? db.select({ n: sql<string>`coalesce(sum(${schema.aiTasks.costMicroUsd}),0)::bigint` }).from(schema.aiTasks).where(and(eq(schema.aiTasks.orgId, orgId), gt(schema.aiTasks.createdAt, since))) : null),
    // Queued sends count as soon as they're queued, so a campaign can't overshoot while it's going out.
    one(want("campaignEmailsPerMonth") ? db.select({ n: sql<number>`count(*)::int` }).from(schema.mktSends).where(and(eq(schema.mktSends.orgId, orgId), sql`(${schema.mktSends.status} = 'queued' or ${schema.mktSends.sentAt} >= ${since})`)) : null),
    one(want("signaturesPerMonth") ? db.select({ n: sql<number>`count(*)::int` }).from(schema.docSignRequests).where(and(eq(schema.docSignRequests.orgId, orgId), gt(schema.docSignRequests.createdAt, since))) : null),
    want("storageMb")
      ? db.execute(sql`select (coalesce((select sum(size) from doc_versions where org_id = ${orgId}),0) + coalesce((select sum(size) from doc_assets where org_id = ${orgId}),0) + coalesce((select sum(a.size) from assets a join projects p on p.id = a.project_id where p.org_id = ${orgId}),0) + coalesce((select sum(size) from rq_files where org_id = ${orgId}),0))::bigint as n`).then((r) => Number((r.rows[0] as { n?: string | number } | undefined)?.n ?? 0))
      : 0,
    one(want("chatGuests") ? db.select({ n: sql<number>`count(distinct ${schema.teamMembers.userId})::int` }).from(schema.teamMembers).where(and(eq(schema.teamMembers.orgId, orgId), eq(schema.teamMembers.role, "guest"))) : null),
  ]);
  return {
    invoicesPerMonth: inv,
    contacts,
    aiPerMonth: ai,
    aiBudgetUsd: aiCost / 1_000_000,
    campaignEmailsPerMonth: campaign,
    signaturesPerMonth: sign,
    storageMb: storage / 1_048_576,
    chatGuests: guests,
  };
}

/** The workspace an invoice owner (a web app, or a finance book) belongs to. */
export async function orgOfInvoiceOwner(ownerId: string): Promise<string | null> {
  const r = await db.execute(sql`select coalesce(p.org_id, b.org_id) as org from invoice_owners o left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where o.id = ${ownerId}`);
  return ((r.rows[0] as { org?: string } | undefined)?.org as string | undefined) ?? null;
}

/**
 * The cheapest paid plan that includes these features and has more of this
 * allowance than now (unlimited counts). null if no plan on sale does —
 * building your own is then the answer.
 */
export async function recommendPlan(needs: { modules?: string[]; quota?: QuotaKey; atLeast?: number }) {
  const plans = (await paidPlans()).sort((a, b) => a.monthly - b.monthly);
  const fits = plans.find((p) => (needs.modules ?? []).every((m) => p.modules === null || p.modules.includes(m as ModuleId)) && (!needs.quota || p.quotas?.[needs.quota] === undefined || p.quotas[needs.quota]! > (needs.atLeast ?? 0)));
  return fits ? { planId: fits.id, name: fits.name, monthly: fits.monthly, currency: fits.currency } : null;
}

/**
 * Refuses one more of something once the plan's allowance is used, with the
 * plan that would allow it. Near the limit (80%), the owners hear about it once
 * a month — before anyone is stopped.
 */
export async function assertQuota(orgId: string, key: QuotaKey, adding = 1) {
  const e = await entitlementFor(orgId);
  const limit = e.quotas[key];
  if (limit === undefined || e.state === "unrestricted") return;
  const used = (await quotaUsage(orgId, key))[key];
  const meta = QUOTA_LABEL[key];
  if (used + adding > limit) {
    const rec = await recommendPlan({ modules: meta.module ? [meta.module] : [], quota: key, atLeast: limit });
    const plan = e.state === "trial" ? "Your free trial" : `The ${e.planName || "current"} plan`;
    const top = isTopupKey(key);
    throw new ApiError("conflict", `${plan} includes ${fmtQuota(key, limit)} ${meta.unit} and you've used ${fmtQuota(key, used)}.${top ? " Top up now to keep going — it's added straight away." : rec ? ` ${rec.name} has more — upgrade in Settings → Billing.` : " Upgrade in Settings → Billing for more."}`, { quota: [key], limit: [String(limit)], used: [String(Math.round(used * 100) / 100)], ...(top ? { topup: [key] } : {}), ...(rec ? { upgrade: [rec.planId] } : {}) });
  }
  if ((used + adding) / limit >= 0.8) void warnOnce(orgId, key, used + adding, limit).catch(() => {});
}

async function warnOnce(orgId: string, key: QuotaKey, used: number, limit: number) {
  const month = monthStart().toISOString().slice(0, 7);
  const [seen] = await db.select({ id: schema.subscriptionEvents.id }).from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.orgId, orgId), eq(schema.subscriptionEvents.kind, "quota_warning"), sql`${schema.subscriptionEvents.detail}->>'key' = ${key}`, sql`${schema.subscriptionEvents.detail}->>'month' = ${month}`)).limit(1);
  if (seen) return;
  await event(db, orgId, "quota_warning", { key, month, used, limit });
  const meta = QUOTA_LABEL[key];
  await notifyOwners(orgId, { kind: "billing.invoice", title: `You've used ${fmtQuota(key, used)} of ${fmtQuota(key, limit)} ${meta.unit}`, body: meta.monthly ? "It resets on the 1st. Upgrade for more before you run out." : "Upgrade for more before you run out.", link: "/settings/billing" });
}

/** The records a workspace has in each feature — to show what a plan keeps (and what Free would lock away). */
export async function usageRecap(orgId: string) {
  const c = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const proj = (t: { projectId: unknown }) => sql`${t.projectId} in (select id from projects where org_id = ${orgId})`;
  const counts: Partial<Record<ModuleId, number>> = Object.fromEntries(
    await Promise.all([
      ["hr", c(db.select({ n }).from(schema.hrEmployees).where(eq(schema.hrEmployees.orgId, orgId)))],
      ["inventory", c(db.select({ n }).from(schema.invItems).where(eq(schema.invItems.orgId, orgId)))],
      ["work", c(db.select({ n }).from(schema.workProjects).where(eq(schema.workProjects.orgId, orgId)))],
      ["documents", c(db.select({ n }).from(schema.docFiles).where(eq(schema.docFiles.orgId, orgId)))],
      ["sales", c(db.select({ n }).from(schema.salesOrders).where(eq(schema.salesOrders.orgId, orgId)))],
      ["manufacturing", c(db.select({ n }).from(schema.mfgWorkOrders).where(eq(schema.mfgWorkOrders.orgId, orgId)))],
      ["helpdesk", c(db.select({ n }).from(schema.hdTickets).where(eq(schema.hdTickets.orgId, orgId)))],
      ["accounting", c(db.select({ n }).from(schema.accJournals).where(eq(schema.accJournals.orgId, orgId)))],
      ["marketing", c(db.select({ n }).from(schema.mktCampaigns).where(eq(schema.mktCampaigns.orgId, orgId)))],
      ["logistics", c(db.select({ n }).from(schema.lgxShipments).where(eq(schema.lgxShipments.orgId, orgId)))],
      ["education", c(db.select({ n }).from(schema.eduStudents).where(eq(schema.eduStudents.orgId, orgId)))],
      ["clinic", c(db.select({ n }).from(schema.clinicPatients).where(eq(schema.clinicPatients.orgId, orgId)))],
      ["construction", c(db.select({ n }).from(schema.conContracts).where(eq(schema.conContracts.orgId, orgId)))],
      ["store", c(db.select({ n }).from(schema.storeProducts).where(proj(schema.storeProducts)))],
      ["bookings", c(db.select({ n }).from(schema.bookings).where(proj(schema.bookings)))],
    ] as [ModuleId, Promise<number>][]).then((r) => Promise.all(r.map(async ([k, v]) => [k, await v] as const))),
  );
  return Object.fromEntries(Object.entries(counts).filter(([, v]) => (v ?? 0) > 0)) as Partial<Record<ModuleId, number>>;
}

/**
 * Before the trial ends (or on Free): what the workspace built in features the
 * Free plan doesn't include, and the cheapest plan that keeps all of it.
 */
export async function keepRecap(orgId: string) {
  const [used, free] = await Promise.all([usageRecap(orgId), freeTier()]);
  const lost = Object.entries(used).filter(([m]) => free && free.modules && !free.modules.includes(m)).map(([m, n]) => ({ module: m as ModuleId, name: moduleById(m as ModuleId)?.name ?? m, records: n! }));
  if (!lost.length) return { lost, plan: null, custom: null };
  const plan = await recommendPlan({ modules: lost.map((l) => l.module) });
  let custom: { monthly: number; currency: string } | null = null;
  try {
    const q = await quoteFor({ kind: "custom", modules: lost.map((l) => l.module), seats: (await pricing()).customSeatsIncluded, interval: "month" });
    custom = { monthly: q.monthly, currency: q.currency };
  } catch {}
  return { lost, plan, custom };
}
