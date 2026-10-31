// Money and detail per client, for platform operators. Two views:
//  - revenueOverview(): the business revenue clients take through the platform
//    (paid store and POS orders, invoice payments, restaurant bills, paid
//    bookings, school fees, clinic and construction receipts), and the
//    platform's own subscription revenue from them — only from the billing
//    provider's real prices, never invented.
//  - clientDetail(): one workspace end to end — members, plan and billing,
//    usage against limits, web apps, its revenue, AI spend, storage, failing
//    jobs, sign-ins, activity by area and health flags.
// Amounts are integer minor units; currencies are never added together.
// Counts and totals only — no business records' contents leave a workspace.
import { eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { MODULES } from "@/lib/workspace/modules";
import { PLAN_IDS, type PlanId } from "@/lib/platform/plans";
import { billingEnforced, configuredProviders, effectivePlan, limitsFor, planLimits, priceFor, usageFor } from "../billing/billing";
import { notFound } from "../http/errors";

type Row = Record<string, unknown>;
const rows = async <T extends Row>(q: SQL) => (await db.execute<T>(q)).rows;
const n = (v: unknown) => Number(v ?? 0);
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

/** Human names for each revenue source. */
export const SOURCES: Record<string, string> = {
  store: "Online store",
  pos: "Point of sale",
  invoices: "Invoice payments",
  restaurant: "Restaurant & hotel bills",
  bookings: "Paid bookings",
  education: "School fees",
  clinic: "Clinic bills",
  construction: "Construction receipts",
};

/**
 * Every payment clients have taken, one row each: workspace, source, currency,
 * amount (minor units) and when. Optionally limited to one workspace.
 * School, clinic and construction modules record in rupees (paise), so they're INR.
 */
function revenueRows(orgId?: string): SQL {
  const only = (col: SQL) => (orgId ? sql`and ${col} = ${orgId}` : sql``);
  return sql`
    select p.org_id, case when so.channel = 'pos' then 'pos' else 'store' end as source, upper(so.currency) as currency, (so.total - so.refunded_total)::bigint as amount, so.paid_at as at
      from store_orders so join projects p on p.id = so.project_id
      where so.paid_at is not null ${only(sql`p.org_id`)}
    union all
    select coalesce(p.org_id, fb.org_id), 'invoices', upper(d.currency), ip.amount::bigint, ip.paid_on::timestamptz
      from invoice_payments ip
      join invoice_documents d on d.id = ip.document_id
      join invoice_owners io on io.id = ip.project_id
      left join projects p on p.id = io.project_id
      left join finance_books fb on fb.id = io.book_id
      where true ${only(sql`coalesce(p.org_id, fb.org_id)`)}
    union all
    select p.org_id, 'restaurant', upper(coalesce(v.currency, 'INR')), (select coalesce(round(sum((x->>'amount')::numeric)), 0) from jsonb_array_elements(o.payments) x)::bigint, coalesce(o.closed_at, o.billed_at, o.created_at)
      from horeca_orders o join projects p on p.id = o.project_id left join horeca_venues v on v.project_id = o.project_id
      where o.status = 'paid' ${only(sql`p.org_id`)}
    union all
    select p.org_id, 'bookings', upper(b.currency), b.amount::bigint, b.created_at
      from bookings b join projects p on p.id = b.project_id
      where b.paid and b.status <> 'cancelled' ${only(sql`p.org_id`)}
    union all
    select org_id, 'education', 'INR', amount::bigint, paid_on::timestamptz from edu_payments where true ${only(sql`org_id`)}
    union all
    select org_id, 'clinic', 'INR', amount::bigint, paid_on::timestamptz from clinic_payments where true ${only(sql`org_id`)}
    union all
    select org_id, 'construction', 'INR', amount::bigint, date::timestamptz from con_payments where true ${only(sql`org_id`)}`;
}

/** The last 12 calendar months as YYYY-MM, oldest first. */
function last12Months(now = new Date()) {
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

type Totals = { currency: string; allTime: number; last30: number; prev30: number; growthPct: number | null; bySource: { source: string; last30: number; allTime: number }[] };

async function gmv(orgId?: string) {
  const bySource = await rows<{ currency: string; source: string; all_time: number; last30: number; prev30: number }>(sql`
    with rev as (${revenueRows(orgId)})
    select currency, source,
      coalesce(sum(amount), 0)::bigint as all_time,
      coalesce(sum(amount) filter (where at > now() - interval '30 days'), 0)::bigint as last30,
      coalesce(sum(amount) filter (where at <= now() - interval '30 days' and at > now() - interval '60 days'), 0)::bigint as prev30
    from rev where org_id is not null group by currency, source`);
  const byCurrency = new Map<string, Totals>();
  for (const r of bySource) {
    const t = byCurrency.get(r.currency) ?? { currency: r.currency, allTime: 0, last30: 0, prev30: 0, growthPct: null, bySource: [] };
    t.allTime += n(r.all_time);
    t.last30 += n(r.last30);
    t.prev30 += n(r.prev30);
    t.bySource.push({ source: r.source, last30: n(r.last30), allTime: n(r.all_time) });
    byCurrency.set(r.currency, t);
  }
  const totals = [...byCurrency.values()]
    .map((t) => ({ ...t, growthPct: t.prev30 > 0 ? Math.round(((t.last30 - t.prev30) / t.prev30) * 1000) / 10 : null, bySource: t.bySource.sort((a, b) => b.allTime - a.allTime) }))
    .sort((a, b) => b.allTime - a.allTime);

  const months = last12Months();
  const monthRows = await rows<{ month: string; currency: string; amount: number }>(sql`
    with rev as (${revenueRows(orgId)})
    select to_char(date_trunc('month', at), 'YYYY-MM') as month, currency, coalesce(sum(amount), 0)::bigint as amount
    from rev where org_id is not null and at >= date_trunc('month', now()) - interval '11 months'
    group by 1, 2`);
  const got = new Map(monthRows.map((r) => [`${r.month}|${r.currency}`, n(r.amount)]));
  const monthly = totals.flatMap((t) => months.map((month) => ({ month, currency: t.currency, amount: got.get(`${month}|${t.currency}`) ?? 0 })));
  return { byCurrency: totals, monthly };
}

export async function revenueOverview() {
  const { byCurrency, monthly } = await gmv();
  const top = await rows<{ org_id: string; name: string; slug: string; currency: string; last30: number }>(sql`
    with rev as (${revenueRows()})
    select r.org_id, o.name, o.slug, r.currency, sum(r.amount)::bigint as last30
    from rev r join organizations o on o.id = r.org_id
    where r.at > now() - interval '30 days'
    group by r.org_id, o.name, o.slug, r.currency
    having sum(r.amount) <> 0
    order by last30 desc limit 20`);

  // The platform's own revenue: subscriptions, priced only from the billing provider.
  const orgs = await db.select({ plan: schema.organizations.plan, subscriptionStatus: schema.organizations.subscriptionStatus, trialPlan: schema.organizations.trialPlan, trialEndsAt: schema.organizations.trialEndsAt, compPlan: schema.organizations.compPlan }).from(schema.organizations);
  const now = new Date();
  const paying: Partial<Record<PlanId, number>> = {};
  const counts = { paying: 0, trialing: 0, comp: 0, pastDue: 0, canceled: 0 };
  for (const o of orgs) {
    const st = o.subscriptionStatus ?? "";
    if (o.plan !== "free" && (st === "active" || st === "past_due")) {
      paying[o.plan as PlanId] = (paying[o.plan as PlanId] ?? 0) + 1;
      counts.paying++;
    }
    if (st === "trialing" || (o.trialPlan && o.trialEndsAt && o.trialEndsAt > now)) counts.trialing++;
    if (o.compPlan) counts.comp++;
    if (st === "past_due") counts.pastDue++;
    if (st === "canceled") counts.canceled++;
  }
  const providers = configuredProviders();
  const billingConfigured = providers.length > 0;
  const perPlan: { plan: PlanId; paying: number; mrr: number | null; currency: string | null }[] = [];
  const mrrBy = new Map<string, number>();
  for (const plan of PLAN_IDS.filter((p) => p !== "free")) {
    const count = paying[plan] ?? 0;
    if (!billingConfigured) {
      perPlan.push({ plan, paying: count, mrr: null, currency: null });
      continue;
    }
    const price = await priceFor(providers[0]!, plan as Exclude<PlanId, "free">).catch(() => null);
    if (!price) {
      perPlan.push({ plan, paying: count, mrr: null, currency: null });
      continue;
    }
    const monthly = Math.round((price.interval === "year" ? price.amount / 12 : price.amount) * count);
    const cur = price.currency.toUpperCase();
    mrrBy.set(cur, (mrrBy.get(cur) ?? 0) + monthly);
    perPlan.push({ plan, paying: count, mrr: monthly, currency: cur });
  }

  return {
    gmv: { byCurrency, monthly, topClients: top.map((r) => ({ orgId: r.org_id, name: r.name, slug: r.slug, currency: r.currency, last30: n(r.last30) })) },
    platform: { billingConfigured, mrr: billingConfigured ? [...mrrBy].map(([currency, amount]) => ({ currency, amount })) : null, perPlan, counts },
    generatedAt: new Date().toISOString(),
  };
}

const finiteOrNull = (l: Record<string, number>) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, Number.isFinite(v) ? v : null])) as Record<string, number | null>;

/** Everything an operator needs about one workspace (counts and totals, not its records). */
export async function clientDetail(orgId: string) {
  if (!isId(orgId)) throw notFound("Workspace");
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!o) throw notFound("Workspace");
  const now = new Date();
  const plan = effectivePlan(o, now);

  const [members, webApps, domains, revenue, ai, storage, jobs, logins, activity, deploys] = await Promise.all([
    rows<{ id: string; name: string; email: string; role: string; last_seen: string | null; mfa: boolean; disabled: boolean; joined: string }>(sql`
      select u.id, u.name, u.email, m.role::text as role, (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as last_seen,
        u.totp_enabled_at is not null as mfa, u.disabled_at is not null as disabled, m.created_at as joined
      from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId}
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.name`),
    rows<{ id: string; name: string; slug: string; kind: string; live: boolean; archived: string | null; created: string; last_deploy: string | null; last_status: string | null }>(sql`
      select p.id, p.name, p.slug, p.kind::text as kind, p.production_deployment_id is not null as live, p.archived_at as archived, p.created_at as created,
        d.created_at as last_deploy, d.status::text as last_status
      from projects p
      left join lateral (select created_at, status from deployments where project_id = p.id order by created_at desc limit 1) d on true
      where p.org_id = ${orgId} order by p.archived_at nulls first, p.created_at desc`),
    rows<{ project_id: string; hostname: string; status: string }>(sql`select sd.project_id, sd.hostname, sd.status from site_domains sd join projects p on p.id = sd.project_id where p.org_id = ${orgId} order by sd.hostname`),
    gmv(orgId),
    rows<{ month: number; d30: number; tasks30: number }>(sql`select
      coalesce(sum(cost_micro_usd) filter (where created_at >= date_trunc('month', now())), 0)::bigint as month,
      coalesce(sum(cost_micro_usd) filter (where created_at > now() - interval '30 days'), 0)::bigint as d30,
      count(*) filter (where created_at > now() - interval '30 days')::int as tasks30
      from ai_tasks where org_id = ${orgId}`),
    rows<{ bytes: number; files: number }>(sql`select coalesce(sum(a.size), 0)::bigint as bytes, count(*)::int as files from assets a join projects p on p.id = a.project_id where p.org_id = ${orgId}`),
    rows<{ kind: string; status: string; n: number; last_error: string | null; last: string }>(sql`
      select kind, status, count(*)::int as n, left((array_agg(last_error order by coalesce(finished_at, created_at) desc))[1], 300) as last_error, max(coalesce(finished_at, created_at)) as last
      from jobs where org_id = ${orgId} and status in ('failed', 'dead') group by kind, status order by n desc limit 20`),
    rows<{ ok: number; failed: number; people: number }>(sql`
      select count(*) filter (where l.ok)::int as ok, count(*) filter (where not l.ok)::int as failed, count(distinct l.user_id) filter (where l.ok)::int as people
      from login_events l where l.at > now() - interval '30 days' and l.user_id in (select user_id from memberships where org_id = ${orgId})`),
    rows<{ area: string; n: number }>(sql`select split_part(action, '.', 1) as area, count(*)::int as n from audit_logs where org_id = ${orgId} and created_at > now() - interval '30 days' group by 1 order by n desc`),
    rows<{ failed7: number; total30: number }>(sql`select
      count(*) filter (where d.status = 'failed' and d.created_at > now() - interval '7 days')::int as failed7,
      count(*) filter (where d.created_at > now() - interval '30 days')::int as total30
      from deployments d join projects p on p.id = d.project_id where p.org_id = ${orgId}`),
  ]);

  const [usage, limits] = await Promise.all([usageFor(orgId), limitsFor(orgId)]);
  const planLimit = await planLimits(plan);
  const on = o.modules ? MODULES.filter((m) => o.modules!.includes(m.id)) : MODULES;
  const st = o.subscriptionStatus ?? "";

  return {
    profile: { id: o.id, name: o.name, slug: o.slug, industry: o.industry, createdAt: o.createdAt, note: o.platformNote, requireMfa: o.requireMfa },
    owners: members.filter((m) => m.role === "owner").map((m) => ({ name: m.name, email: m.email })),
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, lastSeen: m.last_seen, mfa: m.mfa, disabled: m.disabled, joinedAt: m.joined })),
    billing: {
      plan,
      paidPlan: o.plan,
      subscriptionStatus: o.subscriptionStatus,
      provider: o.billingProvider,
      currentPeriodEnd: o.currentPeriodEnd,
      cancelAtPeriodEnd: o.cancelAtPeriodEnd,
      billingEmail: o.billingEmail,
      trialPlan: o.trialPlan,
      trialEndsAt: o.trialEndsAt,
      trialActive: !!(o.trialPlan && o.trialEndsAt && o.trialEndsAt > now),
      compPlan: o.compPlan,
    },
    usage: { used: usage, limits: finiteOrNull(limits as unknown as Record<string, number>), planLimits: finiteOrNull(planLimit as unknown as Record<string, number>), enforced: billingEnforced() },
    modules: { all: !o.modules, on: on.map((m) => ({ id: m.id, name: m.name })), offCount: MODULES.length - on.length },
    webApps: webApps.map((w) => ({ id: w.id, name: w.name, slug: w.slug, kind: w.kind, live: w.live, archivedAt: w.archived, createdAt: w.created, lastDeployAt: w.last_deploy, lastDeployStatus: w.last_status, domains: domains.filter((d) => d.project_id === w.id).map((d) => ({ hostname: d.hostname, status: d.status })) })),
    revenue: { byCurrency: revenue.byCurrency, monthly: revenue.monthly },
    ai: { costMonthMicroUsd: n(ai[0]?.month), cost30MicroUsd: n(ai[0]?.d30), tasks30: n(ai[0]?.tasks30) },
    storage: { bytes: n(storage[0]?.bytes), files: n(storage[0]?.files) },
    jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, n: n(j.n), lastError: j.last_error, last: j.last })),
    signIns30: { ok: n(logins[0]?.ok), failed: n(logins[0]?.failed), people: n(logins[0]?.people) },
    activity30: activity.map((a) => ({ area: a.area, n: n(a.n) })),
    health: {
      suspended: !!o.suspendedAt,
      suspendedReason: o.suspendedReason,
      sitesOffline: o.sitesOffline,
      deletionScheduledAt: o.deletionScheduledAt,
      failedDeploys7d: n(deploys[0]?.failed7),
      deploys30d: n(deploys[0]?.total30),
      pastDue: st === "past_due",
      deadJobs: jobs.filter((j) => j.status === "dead").reduce((a, j) => a + n(j.n), 0),
    },
    generatedAt: now.toISOString(),
  };
}

export type RevenueOverview = Awaited<ReturnType<typeof revenueOverview>>;
export type ClientDetailData = Awaited<ReturnType<typeof clientDetail>>;
