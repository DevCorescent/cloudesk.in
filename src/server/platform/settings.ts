// Platform-wide settings, set from the admin console instead of code or
// environment: product details, who may sign up, admin security, maintenance
// mode, the announcement banner, plan limits, and the go-live checklist's
// manual items. Each section is validated, stored as one row, cached briefly,
// and every change is audited.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_PRICING } from "@/lib/billing/catalog";
import { DEFAULT_PROGRAM, PARTNER_TYPES } from "@/lib/partners/program";
import { PLAN_IDS } from "@/lib/platform/plans";
import { MODULE_IDS } from "@/lib/workspace/modules";
import { ApiError } from "../http/errors";
import { audit } from "../services/audit";

const url = z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(300)]).default("");
const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter domains like example.com");
/** An amount in minor units (paise): up to ₹1 crore. */
const money = z.number().int().min(0).max(1_000_000_000);
const limits = z.object({ projects: z.number().int().min(0).max(100000), seats: z.number().int().min(0).max(100000), customDomains: z.number().int().min(0).max(100000), automationsPerProject: z.number().int().min(0).max(100000) }).partial();

export const SECTIONS = {
  general: z.object({
    productName: z.string().trim().min(1).max(60).default("Cloudesk"),
    supportEmail: z.union([z.literal(""), z.email()]).default(""),
    statusPageUrl: url,
    termsUrl: url,
    privacyUrl: url,
  }),
  signup: z.object({
    /** open: anyone; invite: only people invited to a workspace; closed: no new accounts. */
    mode: z.enum(["open", "invite", "closed"]).default("open"),
    allowedDomains: z.array(domain).max(200).default([]),
    blockedDomains: z.array(domain).max(500).default([]),
    trialPlan: z.enum(["none", ...PLAN_IDS.filter((p) => p !== "free")] as [string, ...string[]]).default("none"),
    trialDays: z.number().int().min(1).max(90).default(14),
  }),
  security: z.object({
    /** Platform admins must have two-step sign-in on to use the console. */
    adminMfaRequired: z.boolean().default(false),
    /** If set, the console only answers from these IP addresses. */
    adminIpAllowlist: z.array(z.string().trim().regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, "Enter IP addresses (or IPv4 ranges like 10.0.0.0/8)")).max(100).default([]),
  }),
  maintenance: z.object({
    /** Workspaces become read-only: changes are refused with the message. Published sites and stores keep serving. */
    enabled: z.boolean().default(false),
    message: z.string().trim().max(300).default("We're doing scheduled maintenance. Changes are paused for a few minutes."),
  }),
  announcement: z.object({
    enabled: z.boolean().default(false),
    tone: z.enum(["info", "success", "warning"]).default("info"),
    text: z.string().trim().max(300).default(""),
    link: url,
    audience: z.enum(["all", ...PLAN_IDS] as [string, ...string[]]).default("all"),
    endsAt: z.iso.datetime().nullable().default(null),
  }),
  plans: z.object({
    /** Limit overrides per plan; anything not set uses the built-in limits. */
    free: limits.default({}),
    pro: limits.default({}),
    business: limits.default({}),
  }),
  /** Subscriptions: the trial, tax, renewals and the prices for building your own plan (Admin → Plans). */
  pricing: z.object({
    enforce: z.boolean().default(DEFAULT_PRICING.enforce),
    freePlan: z.boolean().default(DEFAULT_PRICING.freePlan),
    trialQuotas: z.object({ invoicesPerMonth: z.number().int().min(0).max(1_000_000).optional(), contacts: z.number().int().min(0).max(10_000_000).optional(), aiPerMonth: z.number().int().min(0).max(1_000_000).optional() }).default(DEFAULT_PRICING.trialQuotas),
    currency: z.string().regex(/^[A-Z]{3}$/).default(DEFAULT_PRICING.currency),
    trialDays: z.number().int().min(0).max(365).default(DEFAULT_PRICING.trialDays),
    taxBps: z.number().int().min(0).max(5000).default(DEFAULT_PRICING.taxBps),
    taxLabel: z.string().trim().min(1).max(20).default(DEFAULT_PRICING.taxLabel),
    yearlyMonths: z.number().int().min(1).max(12).default(DEFAULT_PRICING.yearlyMonths),
    graceDays: z.number().int().min(0).max(60).default(DEFAULT_PRICING.graceDays),
    renewalNoticeDays: z.number().int().min(1).max(30).default(DEFAULT_PRICING.renewalNoticeDays),
    customBase: money.default(DEFAULT_PRICING.customBase),
    customBaseModules: z.array(z.enum(MODULE_IDS as unknown as [string, ...string[]])).max(40).default(DEFAULT_PRICING.customBaseModules),
    customSeatsIncluded: z.number().int().min(1).max(1000).default(DEFAULT_PRICING.customSeatsIncluded),
    seatPrice: money.default(DEFAULT_PRICING.seatPrice),
    customLimits: z.object({ projects: z.number().int().min(0).max(100000), customDomains: z.number().int().min(0).max(100000), automationsPerProject: z.number().int().min(0).max(100000) }).default(DEFAULT_PRICING.customLimits),
    modulePrices: z.partialRecord(z.enum(MODULE_IDS as unknown as [string, ...string[]]), money).default(DEFAULT_PRICING.modulePrices as Record<string, number>),
  }),
  /** The company behind the service, shown on the legal pages (Terms, Privacy, Grievance…). Empty fields are left out, never invented. */
  legal: z.object({
    companyName: z.string().trim().max(200).default(""),
    registeredAddress: z.string().trim().max(600).default(""),
    cin: z.string().trim().max(40).default(""),
    gstin: z.string().trim().max(20).default(""),
    contactEmail: z.union([z.literal(""), z.email()]).default(""),
    contactPhone: z.string().trim().max(40).default(""),
    /** Grievance Officer (IT Act 2000 / IT Rules 2021; DPDP Act 2023 contact). */
    grievanceName: z.string().trim().max(120).default(""),
    grievanceEmail: z.union([z.literal(""), z.email()]).default(""),
    grievancePhone: z.string().trim().max(40).default(""),
    /** Data Protection Officer / privacy contact. */
    dpoName: z.string().trim().max(120).default(""),
    dpoEmail: z.union([z.literal(""), z.email()]).default(""),
    /** EU/UK representative under GDPR Art. 27, if appointed. */
    euRepresentative: z.string().trim().max(400).default(""),
    /** Courts with jurisdiction, e.g. "Bengaluru, Karnataka". */
    jurisdiction: z.string().trim().max(120).default(""),
    /** When the current versions of the policies took effect (YYYY-MM-DD). */
    effectiveDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  }),
  /** The application firewall (Admin → Security → Firewall). */
  firewall: z.object({
    /** off: nothing checked; monitor: matches are logged, not blocked; block: matches are refused. */
    mode: z.enum(["off", "monitor", "block"]).default("block"),
    /** Where the visitor's IP address comes from: the first X-Forwarded-For hop, the last (appended by your own proxy), X-Real-IP, or Cloudflare's CF-Connecting-IP. */
    trustProxy: z.enum(["xff-first", "xff-last", "x-real-ip", "cloudflare"]).default("xff-first"),
    /** Built-in rule groups. */
    rules: z.object({
      sqli: z.boolean().default(true),
      xss: z.boolean().default(true),
      traversal: z.boolean().default(true),
      probes: z.boolean().default(true),
      scanners: z.boolean().default(true),
      protocol: z.boolean().default(true),
      injection: z.boolean().default(true),
    }).default({ sqli: true, xss: true, traversal: true, probes: true, scanners: true, protocol: true, injection: true }),
    /** Never checked (your office, monitoring). IPv4/IPv6 addresses or IPv4 CIDR ranges. */
    allowIps: z.array(z.string().trim().regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/)).max(500).default([]),
    /** Always refused. */
    blockIps: z.array(z.string().trim().regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/)).max(5000).default([]),
    /** Two-letter country codes refused (needs Cloudflare's CF-IPCountry header). */
    blockCountries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(250).default([]),
    /** Requests per minute from one address across the whole site (0 = no limit). */
    ratePerMinute: z.number().int().min(0).max(100000).default(1200),
    /** After this many refused requests in 10 minutes an address is banned (0 = never). */
    autoBanAfter: z.number().int().min(0).max(10000).default(30),
    autoBanMinutes: z.number().int().min(1).max(43200).default(60),
    /** Refuse requests that didn't come through Cloudflare (needs the origin lock set up in Admin → Security → Cloudflare). */
    requireCloudflare: z.boolean().default(false),
    /** Custom rules, checked in order before the built-in ones. */
    custom: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]{1,40}$/),
      name: z.string().trim().min(1).max(80),
      enabled: z.boolean().default(true),
      action: z.enum(["block", "allow", "log"]),
      field: z.enum(["path", "query", "ua", "ip", "country", "method", "host", "referer"]),
      op: z.enum(["contains", "equals", "starts", "regex", "in"]),
      value: z.string().max(500),
    })).max(200).default([]),
  }),
  /** The partner program (Admin → Partners): rates per kind of partner, tiers, holds and payouts. */
  partners: z.object({
    /** New applications are accepted. */
    open: z.boolean().default(DEFAULT_PROGRAM.open),
    /** How long a link visit is remembered before sign-up. */
    cookieDays: z.number().int().min(1).max(365).default(DEFAULT_PROGRAM.cookieDays),
    /** Earnings can be withdrawn this many days after the customer paid. */
    holdDays: z.number().int().min(0).max(180).default(DEFAULT_PROGRAM.holdDays),
    minPayout: money.default(DEFAULT_PROGRAM.minPayout),
    /** Tax withheld from payouts (e.g. TDS under section 194H in India), in basis points. */
    tdsBps: z.number().int().min(0).max(5000).default(DEFAULT_PROGRAM.tdsBps),
    /** How long a registered lead stays protected. */
    leadDays: z.number().int().min(7).max(365).default(DEFAULT_PROGRAM.leadDays),
    maxCoupons: z.number().int().min(1).max(100).default(DEFAULT_PROGRAM.maxCoupons),
    types: z.object(Object.fromEntries(PARTNER_TYPES.map((t) => [t, z.object({
      commissionBps: z.number().int().min(0).max(10000),
      commissionMonths: z.number().int().min(0).max(120),
      discountBps: z.number().int().min(0).max(9000),
      discountPayments: z.number().int().min(1).max(24),
      maxDiscountBps: z.number().int().min(0).max(9000),
    }).default(DEFAULT_PROGRAM.types[t])])) as Record<(typeof PARTNER_TYPES)[number], z.ZodDefault<z.ZodObject<{ commissionBps: z.ZodNumber; commissionMonths: z.ZodNumber; discountBps: z.ZodNumber; discountPayments: z.ZodNumber; maxDiscountBps: z.ZodNumber }>>>).default(DEFAULT_PROGRAM.types),
    tiers: z.array(z.object({ name: z.string().trim().min(1).max(30), minActive: z.number().int().min(0).max(100000), bonusBps: z.number().int().min(0).max(5000) })).min(1).max(8).default(DEFAULT_PROGRAM.tiers),
  }),
  golive: z.object({
    /** Manual checks ticked off by an operator: id → who and when. */
    done: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.object({ by: z.string().max(200), at: z.string().max(40) })).default({}),
  }),
} as const;

export type Section = keyof typeof SECTIONS;
export type Settings = { [K in Section]: z.infer<(typeof SECTIONS)[K]> };
export const isSection = (s: string): s is Section => s in SECTIONS;

// One cache per server process (route bundles can each load this module), so a
// save is seen everywhere on this server at once; other servers within 10 seconds.
const store = globalThis as unknown as { __platformSettings?: { at: number; v: Settings } | null };
export const clearSettingsCache = () => void (store.__platformSettings = null);
/** The settings as last loaded on this server, without waiting (null before the first load). For code that can't await. */
export const cachedSettings = (): Settings | null => store.__platformSettings?.v ?? null;

/** Every section, with defaults for anything never set. Cached for 10 seconds. */
export async function settings(): Promise<Settings> {
  const cache = store.__platformSettings;
  if (cache && Date.now() - cache.at < 10_000) return cache.v;
  const rows = await db.select().from(schema.platformSettings);
  const by = new Map(rows.map((r) => [r.key, r.value]));
  const v = Object.fromEntries((Object.keys(SECTIONS) as Section[]).map((k) => {
    const r = SECTIONS[k].safeParse(by.get(k) ?? {});
    return [k, r.success ? r.data : SECTIONS[k].parse({})];
  })) as Settings;
  store.__platformSettings = { at: Date.now(), v };
  return v;
}

export async function saveSection(adminId: string, section: string, raw: unknown) {
  if (!isSection(section)) throw new ApiError("not_found", "No such settings section");
  const r = SECTIONS[section].safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the fields", r.error.issues);
  const value = r.data as Record<string, unknown>;
  await db.insert(schema.platformSettings).values({ key: section, value, updatedBy: adminId }).onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedBy: adminId, updatedAt: new Date() } });
  await audit({ actorId: adminId, action: `platform.settings_${section}`, targetType: "platform_settings", targetId: section, metadata: section === "golive" ? { items: Object.keys((value as { done: object }).done).length } : value });
  clearSettingsCache();
  return (await settings())[section];
}

/** When each section last changed, and by whom. */
export async function settingsMeta() {
  const rows = await db.select({ key: schema.platformSettings.key, updatedAt: schema.platformSettings.updatedAt, by: schema.users.email }).from(schema.platformSettings).leftJoin(schema.users, eq(schema.users.id, schema.platformSettings.updatedBy));
  return Object.fromEntries(rows.map((r) => [r.key, { updatedAt: r.updatedAt, by: r.by }]));
}

// ── Used across the app ─────────────────────────────────────────────────────

/** Whether this email may make a new account (and own a new workspace), or why not. */
export async function signupAllowed(email: string, invited: boolean): Promise<string | null> {
  const s = (await settings()).signup;
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  if (s.blockedDomains.some((x) => d === x || d.endsWith(`.${x}`))) return "Sign-ups from this email domain aren't accepted.";
  if (s.mode === "closed") return "New sign-ups are closed right now.";
  if (s.mode === "invite" && !invited) return "Sign-up is by invitation only. Ask a workspace owner to invite you.";
  if (s.allowedDomains.length && !invited && !s.allowedDomains.some((x) => d === x || d.endsWith(`.${x}`))) return "Sign-up is limited to approved email domains.";
  return null;
}

/** Throws unless this email may make an account; someone with a pending invitation counts as invited. */
export async function assertSignupAllowed(email: string) {
  const [inv] = await db.select({ id: schema.invitations.id }).from(schema.invitations).where(and(sql`lower(${schema.invitations.email}) = ${email.toLowerCase()}`, isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt), gt(schema.invitations.expiresAt, new Date()))).limit(1);
  const why = await signupAllowed(email, !!inv);
  if (why) throw new ApiError("forbidden", why);
}

/** The trial a brand-new workspace starts with, as organisation columns (empty if none). */
export async function signupTrial(): Promise<{ trialPlan?: string; trialEndsAt?: Date }> {
  const s = (await settings()).signup;
  return s.trialPlan === "none" ? {} : { trialPlan: s.trialPlan, trialEndsAt: new Date(Date.now() + s.trialDays * 86_400_000) };
}

export async function maintenance() {
  return (await settings()).maintenance;
}

/** The banner a signed-in person on this plan should see, if any. */
export async function noticeFor(plan: string | null) {
  const s = await settings();
  const a = s.announcement;
  const out: { kind: "maintenance" | "announcement"; tone: string; text: string; link?: string }[] = [];
  if (s.maintenance.enabled) out.push({ kind: "maintenance", tone: "warning", text: s.maintenance.message });
  if (a.enabled && a.text && (!a.endsAt || new Date(a.endsAt) > new Date()) && (a.audience === "all" || a.audience === plan)) out.push({ kind: "announcement", tone: a.tone, text: a.text, link: a.link || undefined });
  return out;
}
