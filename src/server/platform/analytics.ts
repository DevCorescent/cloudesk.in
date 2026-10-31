// Platform analytics for operators: growth, activity, plans and revenue, the
// signup-to-paid funnel, module adoption and usage. Every figure is counted
// from the database at request time; revenue is only shown when billing is
// configured, and then from the provider's own prices.
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { MODULES } from "@/lib/workspace/modules";
import { PLAN_IDS, type PlanId } from "@/lib/platform/plans";
import { configuredProviders, effectivePlan, priceFor } from "../billing/billing";

type Row = Record<string, unknown>;
const rows = async <T extends Row>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows;
const one = async <T extends Row>(q: ReturnType<typeof sql>) => (await rows<T>(q))[0]!;
const n = (v: unknown) => Number(v ?? 0);

/** Daily counts for the last `days` days, oldest first, with empty days filled in. */
function series(list: { day: string; n: number }[], days: number) {
  const by = new Map(list.map((r) => [String(r.day).slice(0, 10), n(r.n)]));
  const out: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day: d, n: by.get(d) ?? 0 });
  }
  return out;
}

// Chat guests (hidden identities on guest.cloudesk.invalid) aren't sign-ups and aren't counted.
export async function overview() {
  const totals = await one(sql`select
    (select count(*)::int from users where email not like '%@guest.cloudesk.invalid') as users,
    (select count(*)::int from users where created_at > now() - interval '7 days' and email not like '%@guest.cloudesk.invalid') as users7,
    (select count(*)::int from users where created_at > now() - interval '30 days' and email not like '%@guest.cloudesk.invalid') as users30,
    (select count(*)::int from users where disabled_at is not null) as disabled,
    (select count(*)::int from users where is_platform_admin) as admins,
    (select count(*)::int from organizations) as orgs,
    (select count(*)::int from organizations where created_at > now() - interval '30 days') as orgs30,
    (select count(*)::int from organizations where suspended_at is not null) as suspended,
    (select count(distinct org_id)::int from audit_logs where org_id is not null and created_at > now() - interval '1 day') as active1,
    (select count(distinct org_id)::int from audit_logs where org_id is not null and created_at > now() - interval '7 days') as active7,
    (select count(distinct org_id)::int from audit_logs where org_id is not null and created_at > now() - interval '30 days') as active30,
    (select count(distinct user_id)::int from sessions where last_seen_at > now() - interval '1 day') as dau,
    (select count(distinct user_id)::int from sessions where last_seen_at > now() - interval '30 days') as mau,
    (select count(*)::int from projects where archived_at is null) as projects,
    (select count(*)::int from projects where production_deployment_id is not null) as live,
    (select count(*)::int from deployments where created_at > now() - interval '30 days') as deploys30,
    (select count(*)::int from deployments where created_at > now() - interval '30 days' and status = 'failed') as "deploysFailed30",
    (select count(*)::int from site_domains where status = 'verified') as domains,
    (select count(*)::int from store_orders where created_at > now() - interval '30 days') as orders30,
    (select count(*)::int from ai_tasks where created_at > now() - interval '30 days') as ai30,
    (select coalesce(sum(cost_micro_usd),0)::bigint from ai_tasks where created_at > now() - interval '30 days') as "aiCost30",
    (select count(*)::int from outbound_emails where created_at > now() - interval '30 days') as emails30,
    (select count(*)::int from outbound_emails where created_at > now() - interval '30 days' and status = 'failed') as "emailsFailed30"`);
  const t = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, n(v)])) as Record<string, number>;

  const [signups, orgsDaily, activeDaily, logins] = await Promise.all([
    rows<{ day: string; n: number }>(sql`select (created_at at time zone 'UTC')::date::text as day, count(*)::int as n from users where created_at > now() - interval '30 days' and email not like '%@guest.cloudesk.invalid' group by 1`),
    rows<{ day: string; n: number }>(sql`select (created_at at time zone 'UTC')::date::text as day, count(*)::int as n from organizations where created_at > now() - interval '30 days' group by 1`),
    rows<{ day: string; n: number }>(sql`select (created_at at time zone 'UTC')::date::text as day, count(distinct org_id)::int as n from audit_logs where org_id is not null and created_at > now() - interval '30 days' group by 1`),
    rows<{ day: string; ok: boolean; n: number }>(sql`select (at at time zone 'UTC')::date::text as day, ok, count(*)::int as n from login_events where at > now() - interval '14 days' group by 1, 2`),
  ]);

  // Plans: what each workspace has in force (paid, trial or complimentary).
  const orgs = await db.select({ plan: schema.organizations.plan, subscriptionStatus: schema.organizations.subscriptionStatus, currentPeriodEnd: schema.organizations.currentPeriodEnd, trialPlan: schema.organizations.trialPlan, trialEndsAt: schema.organizations.trialEndsAt, compPlan: schema.organizations.compPlan, modules: schema.organizations.modules, industry: schema.organizations.industry }).from(schema.organizations);
  const now = new Date();
  const plans = Object.fromEntries(PLAN_IDS.map((p) => [p, 0])) as Record<PlanId, number>;
  const paying: Record<string, number> = {};
  const status: Record<string, number> = {};
  let trials = 0, trialsEnding = 0, comp = 0;
  for (const o of orgs) {
    plans[effectivePlan(o, now)]++;
    if (o.subscriptionStatus) status[o.subscriptionStatus] = (status[o.subscriptionStatus] ?? 0) + 1;
    if (o.plan !== "free" && ["active", "trialing", "past_due"].includes(o.subscriptionStatus ?? "")) paying[o.plan] = (paying[o.plan] ?? 0) + 1;
    if (o.trialPlan && o.trialEndsAt && o.trialEndsAt > now) {
      trials++;
      if (o.trialEndsAt.getTime() - now.getTime() < 7 * 86_400_000) trialsEnding++;
    }
    if (o.compPlan) comp++;
  }

  // Monthly recurring revenue, only from the billing provider's real prices.
  const providers = configuredProviders();
  let mrr: { currency: string; amount: number }[] | null = null;
  if (providers.length) {
    const sums = new Map<string, number>();
    for (const [plan, count] of Object.entries(paying)) {
      if (plan === "free") continue;
      const price = await priceFor(providers[0]!, plan as Exclude<PlanId, "free">).catch(() => null);
      if (!price) continue;
      const monthly = price.interval === "year" ? price.amount / 12 : price.amount;
      sums.set(price.currency, (sums.get(price.currency) ?? 0) + monthly * count);
    }
    mrr = [...sums].map(([currency, amount]) => ({ currency, amount: Math.round(amount) }));
  }

  const modules = MODULES.map((m) => ({ id: m.id, name: m.name, workspaces: orgs.filter((o) => !o.modules || o.modules.includes(m.id)).length })).sort((a, b) => b.workspaces - a.workspaces);
  const industries: Record<string, number> = {};
  for (const o of orgs) industries[o.industry || "not set"] = (industries[o.industry || "not set"] ?? 0) + 1;

  const funnel = await one(sql`select
    (select count(*)::int from users where email not like '%@guest.cloudesk.invalid') as signed_up,
    (select count(*)::int from users where onboarded_at is not null) as onboarded,
    (select count(distinct org_id)::int from projects) as built,
    (select count(distinct org_id)::int from projects where production_deployment_id is not null) as published`);
  const paid = Object.values(paying).reduce((a, b) => a + b, 0);

  const revenue = await rows<{ currency: string; n: number; gross: number }>(sql`select currency, count(*)::int as n, coalesce(sum(total - refunded_total),0)::bigint as gross from store_orders where paid_at > now() - interval '30 days' group by currency order by gross desc`);

  const top = await rows<{ id: string; name: string; slug: string; events: number }>(sql`select o.id, o.name, o.slug, count(*)::int as events from audit_logs a join organizations o on o.id = a.org_id where a.created_at > now() - interval '30 days' group by o.id order by events desc limit 10`);

  return {
    totals: t,
    series: {
      signups: series(signups, 30),
      workspaces: series(orgsDaily, 30),
      activeWorkspaces: series(activeDaily, 30),
      logins: series(logins.filter((r) => r.ok).map((r) => ({ day: r.day, n: r.n })), 14),
      loginFailures: series(logins.filter((r) => !r.ok).map((r) => ({ day: r.day, n: r.n })), 14),
    },
    plans: { inForce: plans, paying, subscriptionStatus: status, trials, trialsEnding, comp, billingConfigured: providers.length > 0, mrr },
    funnel: [
      { step: "Signed up", n: n(funnel.signed_up) },
      { step: "Finished onboarding", n: n(funnel.onboarded) },
      { step: "Built a web app (workspaces)", n: n(funnel.built) },
      { step: "Published one (workspaces)", n: n(funnel.published) },
      { step: "Paying (workspaces)", n: paid },
    ],
    modules,
    industries: Object.entries(industries).map(([industry, count]) => ({ industry, count })).sort((a, b) => b.count - a.count),
    storeRevenue30: revenue.map((r) => ({ currency: r.currency, orders: n(r.n), gross: n(r.gross) })),
    topWorkspaces: top.map((r) => ({ ...r, events: n(r.events) })),
  };
}
