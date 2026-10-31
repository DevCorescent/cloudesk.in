// The platform console's API (platform admins only; to anyone else it doesn't
// exist). Each action checks the admin's role, the admin IP allowlist and the
// two-step requirement (see requirePlatform), and is written to the audit log.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { platformPerms, ROLE_LABEL, type PlatformPerm } from "@/lib/platform/admin-roles";
import { PLANS, PLAN_IDS } from "@/lib/platform/plans";
import { deleteFlag, flags, reauthenticate, requirePlatform, saveFlag, setComp, setNote, setTrial, suspend, tenant, tenants, unsuspend } from "@/server/platform/admin";
import { clientDetail, revenueOverview } from "@/server/platform/clients";
import { configView, saveConfig } from "@/server/platform/config";
import { moduleDetail, modulesOverview } from "@/server/platform/modules-usage";
import { scalability } from "@/server/platform/scalability";
import { overview } from "@/server/platform/analytics";
import { checklist, markManual } from "@/server/platform/golive";
import { health, retryDeadJobs } from "@/server/platform/health";
import { integrations, testIntegration } from "@/server/platform/integrations";
import { saveSection, settings, settingsMeta } from "@/server/platform/settings";
import { auditSearch, disableUser, enableUser, setPlatformRole, signOutEverywhere, userDetail, users, verifyUserEmail } from "@/server/platform/users";
import { configuredProviders, planLimits } from "@/server/billing/billing";
import { rateLimit } from "@/server/security/rate-limit";
import { banIp, clearFirewallCache, firewallEvents, firewallOverview, unbanIp } from "@/server/security/firewall";
import * as cloudflare from "@/server/security/cloudflare";
import { securityPosture } from "@/server/security/posture";
import { choiceSchema } from "@/lib/billing/schema";
import { MODULE_IDS, type ModuleId } from "@/lib/workspace/modules";
import { adminAct, adminList, adminStats, allPlans, clearEntitlement, overview as subscriptionOverview, paymentProviders, planUsage, savePlan, type AdminAction } from "@/server/billing/subscriptions";
import * as partners from "@/server/partners/core";
import { adminComment, adminDetail, adminList as requestList, adminUpdate, release, rollback, workspacesFor } from "@/server/requests/core";

type P = { slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

const limitsSchema = z.object({ projects: z.number().int().min(0).max(100000), seats: z.number().int().min(0).max(100000), customDomains: z.number().int().min(0).max(100000), automationsPerProject: z.number().int().min(0).max(100000) });
const amount = z.number().int().min(0).max(1_000_000_000);
const planSchema = z.object({
  name: z.string().trim().min(1).max(40),
  tagline: z.string().trim().max(120).default(""),
  kind: z.enum(["preset", "basic", "free"]).default("preset"),
  quotas: z.object({ invoicesPerMonth: z.number().int().min(0).max(10_000_000).optional(), contacts: z.number().int().min(0).max(10_000_000).optional(), aiPerMonth: z.number().int().min(0).max(10_000_000).optional() }).default({}),
  modules: z.array(z.enum(MODULE_IDS as unknown as [ModuleId, ...ModuleId[]])).min(1).max(MODULE_IDS.length).nullable(),
  limits: limitsSchema,
  monthly: amount,
  yearly: amount,
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  highlight: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(1000).default(0),
});
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend_trial"), days: z.number().int().min(1).max(365) }),
  z.object({ action: z.literal("end_trial") }),
  z.object({ action: z.literal("assign"), choice: choiceSchema, complimentary: z.boolean(), months: z.number().int().min(1).max(60).nullable().optional(), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("expire") }),
  z.object({ action: z.literal("credit"), amount: z.number().int().min(-100_000_000).max(100_000_000), note: z.string().trim().min(1, "Say why").max(300) }),
  z.object({ action: z.literal("record_payment"), invoiceId: z.uuid(), reference: z.string().trim().min(2, "Enter the payment reference").max(120) }),
  z.object({ action: z.literal("void_invoice"), invoiceId: z.uuid() }),
  z.object({ action: z.literal("end_complimentary") }),
]);

const csv = (name: string, head: string[], rows: unknown[][]) => {
  const cell = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : String(v ?? "");
    // Leading =,+,-,@ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const text = [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  return new Response(text, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` } });
};

async function handle(ctx: AuthedContext, { slug = [] }: P) {
  const [section, id, sub] = slug;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${ctx.req.method} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const need = (perm: PlatformPerm, fresh = false) => requirePlatform(ctx, perm, { fresh });
  const me = { id: ctx.user.id, email: ctx.user.email };
  switch (key) {
    case "GET me":
      await need("analytics:read");
      return { role: ctx.user.platformRole, perms: platformPerms(ctx.user.platformRole), roles: ROLE_LABEL };

    // Step-up: re-enter the password before sensitive actions.
    case "POST reauth":
      await need("analytics:read");
      await rateLimit(`admin-reauth:${ctx.user.id}`, 10, 15 * 60_000);
      await reauthenticate(ctx, await body(ctx));
      return { ok: true };

    // Analytics, health, scalability, modules, revenue, go-live
    case "GET scalability":
      await need("health:read");
      return scalability();
    case "GET modules":
      await need("analytics:read");
      return modulesOverview();
    case `GET modules ${id}`:
      await need("analytics:read");
      return moduleDetail(id ?? "");
    case "GET revenue":
      await need("analytics:read");
      return revenueOverview();
    case "GET clients :id":
      await need("tenants:read");
      return clientDetail(id!);
    case "GET overview":
      await need("analytics:read");
      return overview();
    case "GET health":
      await need("health:read");
      return health();
    case "POST jobs retry": {
      const adminId = await need("tenants:write");
      return retryDeadJobs(adminId, z.object({ kind: z.string().min(1).max(100) }).parse(await body(ctx)).kind);
    }
    case "GET golive":
      await need("settings:read");
      return checklist();
    case "POST golive":
      await need("settings:write");
      {
        const v = z.object({ id: z.string(), done: z.boolean() }).parse(await body(ctx));
        await markManual(me, v.id, v.done);
      }
      return checklist();

    // Workspaces
    case "GET tenants":
      await need("tenants:read");
      return { tenants: await tenants(qs) };
    case "GET tenants csv": {
      await need("tenants:read");
      const t = await tenants(qs);
      return csv("workspaces", ["id", "name", "slug", "plan", "paid_plan", "subscription", "trial_plan", "trial_ends", "comp_plan", "members", "last_active", "suspended_at", "created_at"], t.map((x) => [x.id, x.name, x.slug, x.plan, x.paidPlan, x.subscriptionStatus, x.trialPlan, x.trialEndsAt, x.compPlan, x.members, x.lastActive, x.suspendedAt, x.createdAt]));
    }
    case "GET tenants :id":
      return tenant(await need("tenants:read"), id!);
    case "POST tenants :id suspend":
      await suspend(await need("tenants:write"), id!, await body(ctx));
      return { ok: true };
    case "POST tenants :id unsuspend":
      await unsuspend(await need("tenants:write"), id!);
      return { ok: true };
    case "POST tenants :id trial":
      await setTrial(await need("tenants:write"), id!, await body(ctx));
      return { ok: true };
    case "POST tenants :id comp":
      await setComp(await need("tenants:write"), id!, await body(ctx));
      return { ok: true };
    case "PUT tenants :id note":
      await setNote(await need("tenants:write"), id!, await body(ctx));
      return { ok: true };

    // Users and admins
    case "GET users":
      await need("users:read");
      return { users: await users(qs) };
    case "GET users csv": {
      await need("users:read");
      const u = await users(qs);
      return csv("users", ["id", "name", "email", "verified", "two_step", "platform_role", "workspaces", "last_seen", "disabled_at", "created_at"], u.map((x) => [x.id, x.name, x.email, x.verified, x.mfa, x.platformRole, x.workspaces, x.lastSeen, x.disabledAt, x.createdAt]));
    }
    case "GET users :id":
      await need("users:read");
      return userDetail(id!);
    case "POST users :id disable":
      await disableUser(await need("users:write", true), id!, await body(ctx));
      return { ok: true };
    case "POST users :id enable":
      await enableUser(await need("users:write"), id!);
      return { ok: true };
    case "POST users :id signout":
      await signOutEverywhere(await need("users:write"), id!);
      return { ok: true };
    case "POST users :id verify":
      await verifyUserEmail(await need("users:write"), id!);
      return { ok: true };
    case "PUT users :id role":
      await setPlatformRole(await need("admins:write", true), id!, await body(ctx));
      return { ok: true };

    // Audit
    case "GET audit":
      await need("audit:read");
      return { entries: await auditSearch(qs) };

    // Flags
    // Feature requests from workspaces
    case "GET requests":
      await need("requests:read");
      return requestList(qs);
    case "GET requests workspaces":
      await need("requests:read");
      return workspacesFor(qs.q ?? "");
    case "GET requests :id":
      await need("requests:read");
      return adminDetail(id!);
    case "PUT requests :id":
      return adminUpdate(await need("requests:write"), id!, await body(ctx));
    case "POST requests :id notes":
      return adminComment(await need("requests:write"), id!, await body(ctx));
    case "POST requests :id release":
      return release(await need("flags:write"), id!, await body(ctx));
    case "POST requests :id rollback":
      return rollback(await need("flags:write"), id!, await body(ctx));

    case "GET flags":
      await need("tenants:read");
      return { flags: await flags() };
    case "PUT flags":
      await saveFlag(await need("flags:write"), await body(ctx));
      return { ok: true };
    case "DELETE flags":
      await deleteFlag(await need("flags:write"), qs.key ?? "");
      return { ok: true };

    // Settings (general, signup, security, plans) and notices (maintenance, announcement)
    case "GET settings":
      await need("settings:read");
      return { settings: await settings(), meta: await settingsMeta() };
    case `PUT settings ${id}`: {
      const notice = id === "maintenance" || id === "announcement";
      const adminId = await need(notice ? "notices:write" : "settings:write", id === "security");
      if (id === "firewall") await need("settings:write", true);
      // Commission rates are money: a fresh sign-in.
      if (id === "partners") await need("settings:write", true);
      const saved = await saveSection(adminId, id ?? "", await body(ctx));
      if (id === "pricing") clearEntitlement();
      if (id === "firewall") clearFirewallCache();
      return { section: saved };
    }

    // Security: the app firewall and Cloudflare
    case "GET security posture":
      await need("settings:read");
      return securityPosture();
    case "GET security firewall":
      await need("settings:read");
      return firewallOverview();
    case "GET security events":
      await need("settings:read");
      return { events: await firewallEvents({ ip: qs.ip || undefined, grp: qs.group || undefined, action: qs.action || undefined, before: Number(qs.before) || undefined, limit: Number(qs.limit) || undefined }) };
    case "PUT security firewall": {
      // Changing what the firewall lets through needs a fresh sign-in.
      const adminId = await need("settings:write", true);
      const saved = await saveSection(adminId, "firewall", await body(ctx));
      clearFirewallCache();
      return { policy: saved };
    }
    case "POST security bans": {
      const adminId = await need("settings:write");
      const b = await readJson(ctx.req, z.object({ ip: z.string().trim().min(2).max(60), minutes: z.number().int().min(1).max(525_600).nullable(), reason: z.string().trim().min(1, "Say why").max(300) }));
      return banIp(adminId, b);
    }
    case "DELETE security bans":
      await unbanIp(await need("settings:write"), qs.ip ?? "");
      return { ok: true };
    case "GET security cloudflare":
      await need("settings:read");
      return cloudflare.cloudflareStatus();
    case "POST security cloudflare": {
      // Connect: the token and zone are saved encrypted, then checked against Cloudflare.
      const adminId = await need("settings:write", true);
      const b = await readJson(ctx.req, z.object({ token: z.string().trim().min(30).max(80).optional(), zoneId: z.string().trim().regex(/^[a-f0-9]{32}$/, "The zone ID is 32 hex characters").optional(), syncBans: z.boolean().optional() }));
      await saveConfig(adminId, { ...(b.token ? { CLOUDFLARE_API_TOKEN: b.token } : {}), ...(b.zoneId ? { CLOUDFLARE_ZONE_ID: b.zoneId } : {}), ...(b.syncBans === undefined ? {} : { CLOUDFLARE_SYNC_BANS: b.syncBans ? "on" : "off" }) });
      return cloudflare.cloudflareStatus();
    }
    case "DELETE security cloudflare": {
      const adminId = await need("settings:write", true);
      if ((await settings()).firewall.requireCloudflare) await cloudflare.unlockOrigin(adminId);
      await saveConfig(adminId, { CLOUDFLARE_API_TOKEN: null, CLOUDFLARE_ZONE_ID: null, CLOUDFLARE_SYNC_BANS: null });
      return { ok: true };
    }
    case "PUT security cloudflare-setting": {
      const adminId = await need("settings:write", true);
      const b = await readJson(ctx.req, z.object({ id: z.string().max(40), value: z.string().max(40) }));
      return cloudflare.setCloudflareSetting(adminId, b.id, b.value);
    }
    case "POST security cloudflare-purge": {
      const adminId = await need("settings:write");
      const b = await readJson(ctx.req, z.object({ files: z.array(z.string().max(2000)).max(30).nullable() }));
      await cloudflare.purgeCache(adminId, b.files);
      return { ok: true };
    }
    case "GET security cloudflare-rules":
      await need("settings:read");
      return { access: await cloudflare.accessRules(), custom: await cloudflare.customRules() };
    case "POST security cloudflare-access": {
      const adminId = await need("settings:write", true);
      const b = await readJson(ctx.req, z.object({ mode: z.string().max(30), target: z.string().max(20), value: z.string().max(60), notes: z.string().max(200).default("") }));
      return cloudflare.addAccessRule(adminId, b);
    }
    case "DELETE security cloudflare-access":
      await cloudflare.deleteAccessRule(await need("settings:write", true), qs.id ?? "");
      return { ok: true };
    case "POST security cloudflare-custom": {
      const adminId = await need("settings:write", true);
      const b = await readJson(ctx.req, z.object({ description: z.string().trim().min(1).max(200), expression: z.string().max(4000), action: z.string().max(30) }));
      return { rules: await cloudflare.addCustomRule(adminId, b) };
    }
    case "DELETE security cloudflare-custom":
      await cloudflare.deleteCustomRule(await need("settings:write", true), qs.id ?? "");
      return { ok: true };
    case "GET security cloudflare-events":
      await need("settings:read");
      return cloudflare.cloudflareEvents(Number(qs.hours) || 24);
    case "POST security cloudflare-lock":
      await cloudflare.lockOrigin(await need("settings:write", true));
      return cloudflare.cloudflareStatus();
    case "DELETE security cloudflare-lock":
      await cloudflare.unlockOrigin(await need("settings:write", true));
      return cloudflare.cloudflareStatus();

    // Subscriptions
    case "GET subscriptions":
      await need("tenants:read");
      return { stats: await adminStats(), rows: await adminList({ state: qs.state, search: qs.q, limit: Number(qs.limit) || undefined }) };
    case "GET subscriptions csv": {
      await need("tenants:read");
      const r = await adminList({ state: qs.state, search: qs.q, limit: 500 });
      return csv("subscriptions", ["workspace_id", "workspace", "plan", "status", "interval", "amount", "mrr", "currency", "trial_ends", "period_ends", "grace_ends", "cancel_at_end", "complimentary", "credit", "due"], r.map((x) => [x.orgId, x.name, x.planName, x.status, x.interval, x.amount / 100, x.mrr / 100, x.currency, x.trialEndsAt, x.currentPeriodEnd, x.graceEndsAt, x.cancelAtPeriodEnd, x.complimentary, x.credit / 100, x.due / 100]));
    }
    case "GET subscriptions :id":
      await need("tenants:read");
      return subscriptionOverview(id!);
    case "POST subscriptions :id": {
      const raw = (await readJson(ctx.req, actionSchema)) as AdminAction;
      // Money moves need a fresh sign-in.
      const adminId = await need("tenants:write", ["record_payment", "credit", "assign"].includes(raw.action));
      return adminAct(adminId, id!, raw);
    }
    case "GET billing-plans":
      await need("settings:read");
      return { plans: await allPlans(), usage: await planUsage(), pricing: (await settings()).pricing, providers: paymentProviders() };
    case `PUT billing-plans ${id}`: {
      const adminId = await need("settings:write", true);
      const p = await readJson(ctx.req, planSchema);
      return { plans: await savePlan(adminId, { id: id ?? "", ...p }) };
    }

    // The partner program
    case "GET partners":
      await need("tenants:read");
      return { stats: await partners.adminStats(), rows: await partners.adminPartners({ status: qs.status, type: qs.type, search: qs.q }), program: (await settings()).partners };
    case "GET partners workspaces":
      await need("tenants:read");
      return { workspaces: await partners.searchWorkspaces(qs.q ?? "") };
    case "GET partners :id":
      await need("tenants:read");
      return partners.adminDetail(id!);
    case "POST partners :id":
      return { partner: await partners.adminAct(await need("tenants:write"), id!, await readJson(ctx.req, partners.adminActionSchema)) };
    case "PUT partners :id":
      return { partner: await partners.adminUpdate(await need("tenants:write"), id!, await readJson(ctx.req, partners.adminUpdateSchema)) };
    case "GET partners :id payout-details":
      // Bank and UPI details: a fresh sign-in, and it's audited.
      return partners.adminPayoutDetails(await need("tenants:write", true), id!);
    case "POST partners :id coupons":
      return { coupon: await partners.adminCreateCoupon(await need("tenants:write"), id!, await readJson(ctx.req, partners.adminCouponSchema)) };
    case "POST partners :id referrals": {
      const { orgId } = await readJson(ctx.req, z.object({ orgId: z.uuid() }));
      return { referral: await partners.adminAttach(await need("tenants:write"), id!, orgId) };
    }
    case "POST partners :id adjust":
      return { commission: await partners.adminAdjust(await need("tenants:write", true), id!, await readJson(ctx.req, partners.adjustmentSchema)) };
    case "PUT partner-coupons :id":
      return { coupon: await partners.adminUpdateCoupon(await need("tenants:write"), id!, await readJson(ctx.req, partners.adminCouponPatch)) };
    case "DELETE partner-referrals :id":
      return { referral: await partners.adminReverse(await need("tenants:write"), id!) };
    case "POST partner-commissions :id void": {
      const { note } = await readJson(ctx.req, z.object({ note: z.string().trim().min(3, "Say why — the partner sees this").max(300) }));
      return { commission: await partners.adminVoidCommission(await need("tenants:write", true), id!, note) };
    }
    case "GET partner-payouts":
      await need("tenants:read");
      return { payouts: await partners.adminPayouts({ status: qs.status }) };
    case "POST partner-payouts :id": {
      const a = await readJson(ctx.req, partners.payoutActionSchema);
      // Marking money as sent needs a fresh sign-in.
      return { payout: await partners.adminPayoutAct(await need("tenants:write", a.action === "paid"), id!, a) };
    }

    // Plans and billing
    case "GET plans":
      await need("settings:read");
      return { billing: configuredProviders(), plans: await Promise.all(PLAN_IDS.map(async (p) => ({ id: p, name: PLANS[p].name, builtIn: PLANS[p].limits, limits: await planLimits(p) }))) };

    // Integrations, and their settings saved from the console (secrets never come back)
    case "GET config":
      await need("settings:read");
      return { config: await configView() };
    case "PUT config":
      await saveConfig(await need("settings:write", true), await body(ctx));
      return { config: await configView() };
    case "GET integrations":
      await need("settings:read");
      return { integrations: integrations() };
    case `POST integrations ${id} test`: {
      await need("integrations:test");
      await rateLimit(`admin-integration-test:${ctx.user.id}`, 20, 10 * 60_000);
      return testIntegration(me, id ?? "");
    }
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
