// The partner program. People apply (with a new account or the one they're
// signed in with); a platform admin approves them. Approved partners get a
// code for links and coupons; a workspace that signs up through it (or uses
// it later, or was registered as their lead) is theirs. Every invoice that
// workspace pays earns them a share of what it paid before tax, for the
// program's window. Earnings are held for a while, then can be withdrawn:
// the partner asks, an admin approves and records the transfer.
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { cleanCode, CODE_RE, discountText, months as monthsText, PARTNER_TYPES, payoutSplit, pct, rateFor, shareOf, TYPE_INFO, type PartnerType, type Program } from "@/lib/partners/program";
import { hashPassword } from "../auth/password";
import { issueOtp } from "../auth/otp";
import { ApiError, notFound } from "../http/errors";
import { email as emailSchema, password } from "../http/schemas";
import { log } from "../log";
import { assertSignupAllowed, settings } from "../platform/settings";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { contains } from "../security/like";
import { audit } from "../services/audit";
import { findUserByEmail } from "../services/auth";
import { sendMail } from "../services/mail";

const P = schema.partners;
const C = schema.partnerCoupons;
const R = schema.partnerReferrals;
const K = schema.partnerCommissions;
const O = schema.partnerPayouts;
const L = schema.partnerLeads;
type Exec = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
export type Partner = typeof P.$inferSelect;
const DAY = 86_400_000;

export const program = async (): Promise<Program> => (await settings()).partners as Program;
const n = (v: unknown) => Number(v ?? 0);
const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x;
};

// ─── Applying ──────────────────────────────────────────────────────────────

const str = (max: number) => z.string().trim().max(max);
export const applicationSchema = z.object({
  type: z.enum(PARTNER_TYPES),
  /** The organisation's name, or the person's own (for individuals). */
  name: str(120).min(2, "Enter a name"),
  phone: str(30).regex(/^[+\d\s()-]{7,30}$/, "Enter a phone number"),
  country: str(2).toUpperCase().regex(/^[A-Z]{2}$/).default("IN"),
  city: str(80).min(1, "Enter your city"),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(300)]).default(""),
  profile: z.record(z.string().max(40), str(2000)).default({}),
  acceptTerms: z.literal(true, { message: "Please accept the partner terms" }),
});
export type Application = z.infer<typeof applicationSchema>;

function checkProfile(a: Application) {
  const missing = TYPE_INFO[a.type].fields.filter((f) => f.required && !a.profile[f.id]?.trim());
  if (missing.length) throw new ApiError("validation_failed", `Please answer: ${missing.map((f) => f.label).join(", ")}`, Object.fromEntries(missing.map((f) => [`profile.${f.id}`, ["Required"]])));
  // Only the questions asked for this kind of partner are kept.
  const keep = new Set(TYPE_INFO[a.type].fields.map((f) => f.id));
  return Object.fromEntries(Object.entries(a.profile).filter(([k, v]) => keep.has(k) && v));
}

async function freeCode(exec: Exec, seed: string) {
  const base = (cleanCode(seed).replace(/\d+$/, "").slice(0, 8) || "PARTNER").padEnd(4, "X");
  for (let i = 0; i < 30; i++) {
    const code = `${base}${i < 20 ? Math.floor(10 + Math.random() * 90) : Math.floor(1000 + Math.random() * 9000)}`;
    const [taken] = await exec.select({ id: C.id }).from(C).where(eq(C.code, code));
    if (!taken) return code;
  }
  throw new ApiError("conflict", "Couldn't make a code — try again.");
}

async function assertOpen() {
  if (!(await program()).open) throw new ApiError("forbidden", "The partner program isn't taking applications right now.");
}

/** Applies with the signed-in account. A rejected application can be sent again. */
export async function apply(user: { id: string; email: string; name: string }, a: Application) {
  await assertOpen();
  const row = await db.transaction((tx) => applyIn(tx, user, a));
  await audit({ actorId: user.id, action: "partner.applied", targetType: "partner", targetId: row.id, metadata: { type: a.type } });
  return row;
}

async function applyIn(tx: Exec, user: { id: string; email: string; name: string }, a: Application) {
  const profile = checkProfile(a);
  const [cur] = await tx.select().from(P).where(eq(P.userId, user.id));
  if (cur && cur.status !== "rejected") throw new ApiError("conflict", cur.status === "pending" ? "Your application is already being reviewed." : "You're already a partner.");
  const fields = { type: a.type, name: a.name, phone: a.phone, country: a.country, city: a.city, website: a.website, profile, status: "pending", reviewNote: "", updatedAt: new Date() };
  if (cur) {
    const [u] = await tx.update(P).set(fields).where(eq(P.id, cur.id)).returning();
    return u!;
  }
  const code = await freeCode(tx, a.type === "organisation" ? a.name : user.name || a.name);
  const [p] = await tx.insert(P).values({ ...fields, userId: user.id, email: user.email, code }).returning();
  const t = (await program()).types[a.type];
  await tx.insert(C).values({ partnerId: p!.id, code, primary: true, discountBps: t.discountBps, discountPayments: t.discountPayments });
  return p!;
}

export const partnerSignupSchema = applicationSchema.extend({ person: str(100).min(1, "Enter your name"), email: emailSchema, password });

/** Applying without an account: the account is made when the emailed code is entered. */
export async function startPartnerSignup(input: z.infer<typeof partnerSignupSchema>, meta: { ip?: string | null }) {
  await assertOpen();
  checkProfile(input);
  if (await findUserByEmail(input.email)) throw new ApiError("conflict", "An account with this email already exists. Sign in, then apply.");
  await assertSignupAllowed(input.email);
  const { password: pw, person, email, ...application } = input;
  const payload = { partner: application, name: person, email, passwordHash: await hashPassword(pw) };
  const sent = await issueOtp(email, "signup", { ip: meta.ip, payload });
  return { ticket: sent.ticket, email, expiresAt: sent.expiresAt, devCode: sent.devCode };
}

export const partnerPayload = z.object({ partner: applicationSchema, name: z.string(), email: z.string(), passwordHash: z.string().min(20) });

/** The code was right: the account (no workspace of its own) and the application. */
export async function completePartnerSignup(d: z.infer<typeof partnerPayload>, meta: { ip?: string | null }) {
  if (await findUserByEmail(d.email)) throw new ApiError("conflict", "An account with this email already exists. Sign in instead.");
  await assertOpen();
  const now = new Date();
  // The account and the application together: neither is left without the other.
  const { user, row } = await db.transaction(async (tx) => {
    const [u] = await tx.insert(schema.users).values({ name: d.name, email: d.email, passwordHash: d.passwordHash, emailVerifiedAt: now, onboardedAt: now }).returning();
    return { user: u!, row: await applyIn(tx, { id: u!.id, email: u!.email, name: u!.name }, d.partner) };
  });
  await audit({ actorId: user.id, action: "user.signup", targetType: "user", targetId: user.id, ip: meta.ip, metadata: { method: "email_code", partner: d.partner.type } });
  await audit({ actorId: user.id, action: "partner.applied", targetType: "partner", targetId: row.id, metadata: { type: d.partner.type } });
  return { email: user.email, partner: true };
}

export async function partnerOf(userId: string) {
  const [p] = await db.select().from(P).where(eq(P.userId, userId));
  return p ?? null;
}

// ─── Codes and attribution ─────────────────────────────────────────────────

/** A code that works right now: its partner is approved, it's on, not expired or used up. */
export async function resolveCode(raw: string, exec: Exec = db) {
  const code = cleanCode(raw);
  if (!CODE_RE.test(code)) return null;
  const [row] = await exec.select({ c: C, p: P }).from(C).innerJoin(P, eq(P.id, C.partnerId)).where(eq(C.code, code));
  if (!row || row.p.status !== "approved" || !row.c.active) return null;
  if (row.c.expiresAt && row.c.expiresAt <= new Date()) return null;
  if (row.c.maxUses !== null && row.c.uses >= row.c.maxUses) return null;
  return row;
}

/** What a code gives the customer, for the sign-up and billing pages. */
export async function describeCode(raw: string) {
  const r = await resolveCode(raw);
  if (!r) return { valid: false as const };
  return { valid: true as const, code: r.c.code, partner: r.p.name, discountBps: r.c.discountBps, discountPayments: r.c.discountPayments, label: discountText(r.c.discountBps, r.c.discountPayments) || "Referred by a Cloudesk partner" };
}

/** The value of the referral cookie set by /go/CODE: "CODE" or "CODE|campaign". */
export const parseRefCookie = (v: string | undefined | null) => {
  if (!v) return null;
  const [code, campaign = ""] = v.split("|");
  const c = cleanCode(code ?? "");
  return CODE_RE.test(c) ? { code: c, campaign: campaign.replace(/[^\w .-]/g, "").slice(0, 60) } : null;
};

/**
 * Makes a workspace a partner's: from a coupon typed in, a link followed, or a
 * lead the partner registered for this email. The first one wins; a partner
 * can't refer their own account.
 */
export async function attachReferral(orgId: string, o: { ownerId: string; email?: string | null; coupon?: string | null; ref?: { code: string; campaign: string } | null; actorId?: string | null; source?: "manual" }, exec: Exec = db) {
  const [has] = await exec.select({ id: R.id }).from(R).where(eq(R.orgId, orgId));
  if (has) return null;
  const pick = (o.coupon ? await resolveCode(o.coupon, exec) : null) ?? (o.ref ? await resolveCode(o.ref.code, exec) : null);
  const prog = await program();
  if (pick) {
    if (pick.p.userId === o.ownerId) return null;
    const source = o.source ?? (o.coupon && cleanCode(o.coupon) === pick.c.code ? "coupon" : "link");
    const months = pick.p.commissionMonths ?? prog.types[pick.p.type as PartnerType].commissionMonths;
    const [ref] = await exec.insert(R).values({ partnerId: pick.p.id, orgId, couponId: pick.c.id, code: pick.c.code, source, campaign: source === "link" ? (o.ref?.campaign ?? "") : "", discountBps: pick.c.discountBps, discountLeft: pick.c.discountBps > 0 ? pick.c.discountPayments : 0, commissionBps: pick.c.commissionBps, commissionUntil: months ? addMonths(new Date(), months) : null, createdBy: o.actorId ?? null }).onConflictDoNothing().returning();
    if (ref) await exec.update(C).set({ uses: sql`${C.uses} + 1` }).where(eq(C.id, pick.c.id));
    return ref ?? null;
  }
  // A lead registered for this address, still protected.
  if (o.email) {
    const [lead] = await exec.select({ l: L, p: P }).from(L).innerJoin(P, eq(P.id, L.partnerId)).where(and(sql`lower(${L.email}) = ${o.email.toLowerCase()}`, gt(L.expiresAt, new Date()), inArray(L.status, ["registered", "contacted", "demo"]), eq(P.status, "approved"))).orderBy(L.createdAt).limit(1);
    if (lead && lead.p.userId !== o.ownerId) {
      const months = lead.p.commissionMonths ?? prog.types[lead.p.type as PartnerType].commissionMonths;
      const [ref] = await exec.insert(R).values({ partnerId: lead.p.id, orgId, code: lead.p.code, source: "lead", commissionUntil: months ? addMonths(new Date(), months) : null }).onConflictDoNothing().returning();
      if (ref) await exec.update(L).set({ status: "signed_up", orgId, updatedAt: new Date() }).where(eq(L.id, lead.l.id));
      return ref ?? null;
    }
  }
  return null;
}

async function ownerOf(orgId: string) {
  const [m] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, "owner"))).limit(1);
  return m?.userId ?? null;
}

/** A workspace entering a code in Billing (only if no partner brought it). */
export async function applyCouponToOrg(orgId: string, actor: { id: string }, code: string) {
  const [has] = await db.select({ id: R.id }).from(R).where(eq(R.orgId, orgId));
  if (has) throw new ApiError("conflict", "This workspace already has a partner code applied.");
  const r = await resolveCode(code);
  if (!r) throw new ApiError("validation_failed", "That code isn't valid or has expired.", { code: ["Not valid"] });
  const ref = await attachReferral(orgId, { ownerId: (await ownerOf(orgId)) ?? actor.id, coupon: code });
  if (!ref) throw new ApiError("validation_failed", "You can't use your own partner code.", { code: ["Not valid"] });
  await audit({ actorId: actor.id, orgId, action: "billing.coupon_applied", targetType: "partner_referral", targetId: ref.id, metadata: { code: ref.code } });
  return { code: ref.code, label: discountText(ref.discountBps, ref.discountLeft) };
}

/** The workspace's coupon discount still to come (for invoices). */
export async function discountFor(orgId: string, exec: Exec = db) {
  const [r] = await exec.select().from(R).where(and(eq(R.orgId, orgId), eq(R.status, "active"), gt(R.discountLeft, 0), gt(R.discountBps, 0)));
  return r ? { referralId: r.id, bps: r.discountBps, code: r.code, left: r.discountLeft } : null;
}

export async function couponOfOrg(orgId: string) {
  const [r] = await db.select().from(R).where(and(eq(R.orgId, orgId), eq(R.status, "active")));
  return r ? { code: r.code, discount: discountText(r.discountBps, r.discountLeft), left: r.discountLeft } : null;
}

/** A discounted invoice was paid: one payment fewer to discount. */
export async function useDiscount(exec: Exec, referralId: string) {
  await exec.update(R).set({ discountLeft: sql`greatest(0, ${R.discountLeft} - 1)` }).where(eq(R.id, referralId));
}

// ─── Earning ───────────────────────────────────────────────────────────────

/** On a paid plan now — including a plan paid for during the trial, which starts when the trial ends. */
const S = schema.orgSubscriptions;
const payingNow = and(or(eq(S.status, "active"), and(eq(S.status, "trialing"), isNotNull(S.currentPeriodStart))), eq(S.complimentary, false), gt(S.amount, 0));

/** Customers paying now (for tiers). */
async function payingCount(partnerId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(R).innerJoin(S, eq(S.orgId, R.orgId)).where(and(eq(R.partnerId, partnerId), eq(R.status, "active"), payingNow));
  return n(r?.n);
}

/** A paid invoice: the partner's share, if the workspace is theirs and still in the window. Once per invoice. */
export async function earnFromInvoice(invoiceId: string) {
  const [inv] = await db.select().from(schema.subscriptionInvoices).where(eq(schema.subscriptionInvoices.id, invoiceId));
  if (!inv || inv.status !== "paid" || inv.subtotal <= 0) return null;
  const [row] = await db.select({ r: R, p: P }).from(R).innerJoin(P, eq(P.id, R.partnerId)).where(and(eq(R.orgId, inv.orgId), eq(R.status, "active")));
  if (!row || row.p.status !== "approved") return null;
  const paidAt = inv.paidAt ?? new Date();
  if (row.r.commissionUntil && paidAt > row.r.commissionUntil) return null;
  const prog = await program();
  const rate = row.r.commissionBps ?? rateFor({ type: row.p.type as PartnerType, commissionBps: row.p.commissionBps }, prog, await payingCount(row.p.id)).rate;
  const amount = shareOf(inv.subtotal, rate);
  if (amount <= 0) return null;
  const [k] = await db.insert(K).values({ partnerId: row.p.id, referralId: row.r.id, orgId: inv.orgId, invoiceId: inv.id, basis: inv.subtotal, rateBps: rate, amount, currency: inv.currency, availableAt: new Date(paidAt.getTime() + prog.holdDays * DAY) }).onConflictDoNothing().returning();
  if (k) await db.update(L).set({ status: "won", updatedAt: new Date() }).where(and(eq(L.partnerId, row.p.id), eq(L.orgId, inv.orgId), ne(L.status, "won")));
  return k ?? null;
}

// ─── Balances and the dashboard ────────────────────────────────────────────

export async function balances(partnerId: string, exec: Exec = db, now = new Date()) {
  const [e] = await exec.select({
    earned: sql<string>`coalesce(sum(${K.amount}), 0)`,
    released: sql<string>`coalesce(sum(${K.amount}) filter (where ${K.availableAt} <= ${now}), 0)`,
  }).from(K).where(and(eq(K.partnerId, partnerId), eq(K.status, "earned")));
  const [o] = await exec.select({
    committed: sql<string>`coalesce(sum(${O.amount}) filter (where ${O.status} in ('requested', 'approved', 'paid')), 0)`,
    pending: sql<string>`coalesce(sum(${O.amount}) filter (where ${O.status} in ('requested', 'approved')), 0)`,
    paid: sql<string>`coalesce(sum(${O.amount}) filter (where ${O.status} = 'paid'), 0)`,
    tds: sql<string>`coalesce(sum(${O.tds}) filter (where ${O.status} = 'paid'), 0)`,
  }).from(O).where(eq(O.partnerId, partnerId));
  const earned = n(e?.earned), released = n(e?.released);
  return { earned, onHold: earned - released, available: released - n(o?.committed), pendingPayout: n(o?.pending), paidOut: n(o?.paid), tdsWithheld: n(o?.tds) };
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Everything a partner's dashboard shows. */
export async function dashboard(p: Partner, now = new Date()) {
  const prog = await program();
  const type = p.type as PartnerType;
  const customers = await db
    .select({ r: R, org: { id: schema.organizations.id, name: schema.organizations.name }, s: { status: S.status, planName: S.planName, monthly: S.monthly, amount: S.amount, interval: S.interval, complimentary: S.complimentary, trialEndsAt: S.trialEndsAt, periodStart: S.currentPeriodStart } })
    .from(R)
    .innerJoin(schema.organizations, eq(schema.organizations.id, R.orgId))
    .leftJoin(S, eq(S.orgId, R.orgId))
    .where(eq(R.partnerId, p.id))
    .orderBy(desc(R.createdAt))
    .limit(500);
  const orgIds = customers.map((c) => c.org.id);
  const paidBy = orgIds.length
    ? await db.select({ orgId: schema.subscriptionInvoices.orgId, total: sql<string>`coalesce(sum(${schema.subscriptionInvoices.subtotal}), 0)` }).from(schema.subscriptionInvoices).where(and(inArray(schema.subscriptionInvoices.orgId, orgIds), eq(schema.subscriptionInvoices.status, "paid"))).groupBy(schema.subscriptionInvoices.orgId)
    : [];
  const earnedBy = await db.select({ orgId: K.orgId, total: sql<string>`coalesce(sum(${K.amount}), 0)` }).from(K).where(and(eq(K.partnerId, p.id), eq(K.status, "earned"))).groupBy(K.orgId);
  const paid = new Map(paidBy.map((x) => [x.orgId, n(x.total)]));
  const earned = new Map(earnedBy.map((x) => [x.orgId, n(x.total)]));
  const stateOf = (s: (typeof customers)[number]["s"]) => {
    if (!s?.status) return "signed_up";
    // A plan paid for during the trial counts as paying.
    if (s.status === "trialing" && s.periodStart && s.amount > 0 && !s.complimentary) return "paying";
    if (s.status === "trialing" && s.trialEndsAt && s.trialEndsAt > now) return "trial";
    if (s.status === "active" && s.complimentary) return "complimentary";
    if (s.status === "active" && s.amount > 0) return "paying";
    return "not_paying";
  };
  const rows = customers.map((c) => {
    const state = c.r.status === "reversed" ? "reversed" : stateOf(c.s);
    const inWindow = !c.r.commissionUntil || c.r.commissionUntil > now;
    return { id: c.r.id, orgId: c.org.id, name: c.org.name, joinedAt: c.r.createdAt, source: c.r.source, code: c.r.code, campaign: c.r.campaign, state, plan: c.s?.planName ?? "", monthly: state === "paying" ? (c.s?.monthly ?? 0) : 0, paid: paid.get(c.org.id) ?? 0, earned: earned.get(c.org.id) ?? 0, commissionUntil: c.r.commissionUntil, inWindow, rateBps: c.r.commissionBps };
  });
  const active = rows.filter((r) => r.state === "paying").length;
  const rate = rateFor({ type, commissionBps: p.commissionBps }, prog, active);
  const mrr = rows.reduce((a, r) => a + r.monthly, 0);
  const earningMrr = rows.filter((r) => r.state === "paying" && r.inWindow).reduce((a, r) => a + shareOf(r.monthly, r.rateBps ?? rate.rate), 0);

  // The last 12 months: what referred customers paid, and what the partner earned.
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const kRows = await db.select({ m: sql<string>`to_char(${K.createdAt} at time zone 'UTC', 'YYYY-MM')`, amount: sql<string>`sum(${K.amount})`, basis: sql<string>`sum(${K.basis})` }).from(K).where(and(eq(K.partnerId, p.id), eq(K.status, "earned"), gte(K.createdAt, since))).groupBy(sql`1`);
  const byMonth = new Map(kRows.map((r) => [r.m, { earned: n(r.amount), revenue: n(r.basis) }]));
  const series = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
    const k = monthKey(d);
    return { month: k, ...(byMonth.get(k) ?? { earned: 0, revenue: 0 }) };
  });

  const [clicks] = await db.select({ all: sql<string>`coalesce(sum(${schema.partnerClicks.count}), 0)`, recent: sql<string>`coalesce(sum(${schema.partnerClicks.count}) filter (where ${schema.partnerClicks.day} >= ${new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10)}), 0)` }).from(schema.partnerClicks).where(eq(schema.partnerClicks.partnerId, p.id));
  const campaigns = await campaignStats(p.id, rows);
  const coupons = await couponStats(p.id, rows);
  const bal = await balances(p.id);
  const thisMonth = series.at(-1)!.earned;
  const lastMonth = series.at(-2)!.earned;
  return {
    partner: shapePartner(p),
    terms: termsFor(p, prog),
    rate: { base: rate.base, bonus: rate.bonus, rate: rate.rate, tier: rate.tier.name, next: rate.next?.name ?? null, toNext: rate.toNext, tiers: prog.tiers },
    totals: {
      clicks: n(clicks?.all),
      clicks30: n(clicks?.recent),
      signups: rows.filter((r) => r.state !== "reversed").length,
      trials: rows.filter((r) => r.state === "trial").length,
      paying: active,
      mrr,
      revenue: rows.reduce((a, r) => a + r.paid, 0),
      earningMrr,
      thisMonth,
      lastMonth,
      ...bal,
    },
    series,
    customers: rows,
    campaigns,
    coupons,
  };
}

async function campaignStats(partnerId: string, rows: { campaign: string; state: string; earned: number; source: string }[]) {
  const clicks = await db.select({ campaign: schema.partnerClicks.campaign, n: sql<string>`sum(${schema.partnerClicks.count})` }).from(schema.partnerClicks).where(eq(schema.partnerClicks.partnerId, partnerId)).groupBy(schema.partnerClicks.campaign);
  const names = new Set([...clicks.map((c) => c.campaign), ...rows.filter((r) => r.source === "link").map((r) => r.campaign)]);
  return [...names].map((c) => {
    const rs = rows.filter((r) => r.source === "link" && r.campaign === c);
    return { campaign: c, clicks: n(clicks.find((x) => x.campaign === c)?.n), signups: rs.length, paying: rs.filter((r) => r.state === "paying").length, earned: rs.reduce((a, r) => a + r.earned, 0) };
  }).sort((a, b) => b.clicks - a.clicks);
}

async function couponStats(partnerId: string, rows: { code: string; state: string; earned: number }[]) {
  const list = await db.select().from(C).where(eq(C.partnerId, partnerId)).orderBy(desc(C.primary), desc(C.createdAt));
  return list.map((c) => {
    const rs = rows.filter((r) => r.code === c.code);
    return { ...shapeCoupon(c), signups: rs.length, paying: rs.filter((r) => r.state === "paying").length, earned: rs.reduce((a, r) => a + r.earned, 0) };
  });
}

const shapeCoupon = (c: typeof C.$inferSelect) => ({ id: c.id, code: c.code, label: c.label, primary: c.primary, discountBps: c.discountBps, discountPayments: c.discountPayments, commissionBps: c.commissionBps, active: c.active, maxUses: c.maxUses, uses: c.uses, expiresAt: c.expiresAt, createdAt: c.createdAt, discount: discountText(c.discountBps, c.discountPayments) });

export const shapePartner = (p: Partner) => ({ id: p.id, type: p.type as PartnerType, status: p.status, code: p.code, name: p.name, email: p.email, phone: p.phone, country: p.country, city: p.city, website: p.website, profile: p.profile, payoutMethod: p.payoutMethod, payoutHint: p.payoutHint, reviewNote: p.reviewNote, createdAt: p.createdAt, approvedAt: p.approvedAt });

/** The terms this partner is on, in numbers and words. */
export function termsFor(p: Pick<Partner, "type" | "commissionBps" | "commissionMonths">, prog: Program) {
  const t = prog.types[p.type as PartnerType];
  const commissionBps = p.commissionBps ?? t.commissionBps;
  const commissionMonths = p.commissionMonths ?? t.commissionMonths;
  return { commissionBps, commissionMonths, discountBps: t.discountBps, discountPayments: t.discountPayments, maxDiscountBps: t.maxDiscountBps, holdDays: prog.holdDays, minPayout: prog.minPayout, tdsBps: prog.tdsBps, cookieDays: prog.cookieDays, leadDays: prog.leadDays, maxCoupons: prog.maxCoupons, summary: `${pct(commissionBps)} of what each customer pays ${monthsText(commissionMonths)}` };
}

/** The program as the public page shows it. */
export async function publicProgram() {
  const prog = await program();
  return { open: prog.open, holdDays: prog.holdDays, minPayout: prog.minPayout, cookieDays: prog.cookieDays, leadDays: prog.leadDays, tiers: prog.tiers, types: PARTNER_TYPES.map((t) => ({ id: t, ...prog.types[t] })) };
}

// ─── The partner's own changes ─────────────────────────────────────────────

export const profileSchema = z.object({ name: str(120).min(2), phone: str(30).regex(/^[+\d\s()-]{7,30}$/, "Enter a phone number"), city: str(80).min(1), website: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(300)]) }).partial();

export async function updateProfile(p: Partner, patch: z.infer<typeof profileSchema>) {
  const [u] = await db.update(P).set({ ...patch, updatedAt: new Date() }).where(eq(P.id, p.id)).returning();
  return shapePartner(u!);
}

export const payoutDetailsSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("upi"), upiId: z.string().trim().regex(/^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/, "Enter a UPI ID like name@bank"), holder: str(120).min(2, "Enter the account holder's name"), pan: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid PAN")]).default("") }),
  z.object({ method: z.literal("bank"), holder: str(120).min(2, "Enter the account holder's name"), account: z.string().trim().regex(/^\d{6,20}$/, "Enter the account number (digits only)"), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC"), bank: str(80).default(""), pan: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid PAN")]).default("") }),
  z.object({ method: z.literal("wire"), holder: str(120).min(2, "Enter the account holder's name"), account: str(40).min(6, "Enter the account number or IBAN"), swift: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "Enter a valid SWIFT/BIC"), bank: str(80).min(2, "Enter the bank's name"), country: str(2).toUpperCase().regex(/^[A-Z]{2}$/) }),
]);
export type PayoutDetails = z.infer<typeof payoutDetailsSchema>;

const hintOf = (d: PayoutDetails) => {
  if (d.method === "upi") {
    const [u = "", h = ""] = d.upiId.split("@");
    return `UPI · ${u.slice(0, 3)}…@${h}`;
  }
  if (d.method === "bank") return `${d.ifsc} · ••••${d.account.slice(-4)}`;
  return `${d.bank} · ••••${d.account.slice(-4)}`;
};

/** Stored encrypted; only a hint is ever shown back to the partner. */
export async function setPayoutDetails(p: Partner, d: PayoutDetails) {
  const [u] = await db.update(P).set({ payoutMethod: d.method, payoutEnc: encryptSecret(JSON.stringify(d)), payoutHint: hintOf(d), updatedAt: new Date() }).where(eq(P.id, p.id)).returning();
  await audit({ actorId: p.userId, action: "partner.payout_details", targetType: "partner", targetId: p.id, metadata: { method: d.method } });
  return shapePartner(u!);
}

export const couponSchema = z.object({
  code: z.string().trim().max(20).default(""),
  label: str(60).min(1, "Name the campaign"),
  discountBps: z.number().int().min(0).max(9000),
  discountPayments: z.number().int().min(1).max(24).default(1),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  expiresAt: z.iso.datetime().nullable().default(null),
});

const assertApproved = (p: Partner) => {
  if (p.status !== "approved") throw new ApiError("forbidden", "This is available once your partner profile is approved.");
};

export async function createCoupon(p: Partner, c: z.infer<typeof couponSchema>, byAdmin?: { id: string; commissionBps?: number | null }) {
  if (!byAdmin) assertApproved(p);
  const prog = await program();
  const t = prog.types[p.type as PartnerType];
  if (!byAdmin && c.discountBps > t.maxDiscountBps) throw new ApiError("validation_failed", `The most you can give is ${pct(t.maxDiscountBps)} off.`, { discountBps: ["Too high"] });
  if (!byAdmin && c.discountPayments > Math.max(t.discountPayments, 3)) throw new ApiError("validation_failed", `A discount can apply to at most ${Math.max(t.discountPayments, 3)} payments.`, { discountPayments: ["Too many"] });
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(C).where(and(eq(C.partnerId, p.id), eq(C.primary, false)));
  if (!byAdmin && n(count?.n) >= prog.maxCoupons) throw new ApiError("conflict", `You can have up to ${prog.maxCoupons} codes. Turn one off or ask us for more.`);
  const wanted = cleanCode(c.code);
  if (wanted && !CODE_RE.test(wanted)) throw new ApiError("validation_failed", "Codes are 4–20 letters and numbers.", { code: ["4–20 letters and numbers"] });
  const code = wanted || (await freeCode(db, `${p.code.replace(/\d+$/, "")}${c.label}`));
  const [taken] = await db.select({ id: C.id }).from(C).where(eq(C.code, code));
  if (taken) throw new ApiError("conflict", "That code is taken — try another.", { code: ["Taken"] });
  const [row] = await db.insert(C).values({ partnerId: p.id, code, label: c.label, discountBps: c.discountBps, discountPayments: c.discountPayments, maxUses: c.maxUses, expiresAt: c.expiresAt ? new Date(c.expiresAt) : null, commissionBps: byAdmin?.commissionBps ?? null, createdBy: byAdmin?.id ?? p.userId }).returning();
  return shapeCoupon(row!);
}

export async function setCouponActive(p: Partner, id: string, active: boolean) {
  const [row] = await db.update(C).set({ active }).where(and(eq(C.id, id), eq(C.partnerId, p.id), eq(C.primary, false))).returning();
  if (!row) throw notFound("Code");
  return shapeCoupon(row);
}

// Leads (deal registration)

export const leadSchema = z.object({ company: str(120).min(2, "Enter the business's name"), contactName: str(100).default(""), email: emailSchema, phone: str(30).default(""), notes: str(1000).default(""), value: z.number().int().min(0).max(1_000_000_000).default(0) });
const LEAD_STATUSES = ["registered", "contacted", "demo", "signed_up", "won", "lost"] as const;

export async function listLeads(partnerId: string) {
  return db.select().from(L).where(eq(L.partnerId, partnerId)).orderBy(desc(L.createdAt)).limit(500);
}

export async function registerLead(p: Partner, d: z.infer<typeof leadSchema>) {
  assertApproved(p);
  const prog = await program();
  if (await findUserByEmail(d.email)) throw new ApiError("conflict", "This person already has a Cloudesk account, so it can't be registered as a new lead.", { email: ["Already a customer"] });
  const [other] = await db.select({ id: L.id, partnerId: L.partnerId }).from(L).where(and(sql`lower(${L.email}) = ${d.email.toLowerCase()}`, gt(L.expiresAt, new Date()), inArray(L.status, ["registered", "contacted", "demo"])));
  if (other) throw new ApiError("conflict", other.partnerId === p.id ? "You've already registered this lead." : "Another partner registered this business recently.", { email: ["Already registered"] });
  const [row] = await db.insert(L).values({ ...d, partnerId: p.id, expiresAt: new Date(Date.now() + prog.leadDays * DAY) }).returning();
  return row!;
}

export async function updateLead(p: Partner, id: string, patch: { status?: string; notes?: string; value?: number }) {
  if (patch.status && !["registered", "contacted", "demo", "lost"].includes(patch.status)) throw new ApiError("validation_failed", "Signed up and won are set automatically.");
  const [cur] = await db.select().from(L).where(and(eq(L.id, id), eq(L.partnerId, p.id)));
  if (!cur) throw notFound("Lead");
  if (patch.status && ["signed_up", "won"].includes(cur.status)) throw new ApiError("conflict", "This lead has already signed up.");
  const [row] = await db.update(L).set({ ...(patch.status ? { status: patch.status } : {}), ...(patch.notes !== undefined ? { notes: patch.notes.slice(0, 1000) } : {}), ...(patch.value !== undefined ? { value: patch.value } : {}), updatedAt: new Date() }).where(eq(L.id, id)).returning();
  return row!;
}
export { LEAD_STATUSES };

// Link visits

/** /go/CODE: counts the visit (once per code, campaign and day per row). */
export async function recordClick(raw: string, campaign: string) {
  const r = await resolveCode(raw);
  if (!r) return null;
  const c = campaign.replace(/[^\w .-]/g, "").slice(0, 60);
  await db.insert(schema.partnerClicks).values({ partnerId: r.p.id, code: r.c.code, campaign: c, day: new Date().toISOString().slice(0, 10), count: 1 }).onConflictDoUpdate({ target: [schema.partnerClicks.partnerId, schema.partnerClicks.code, schema.partnerClicks.campaign, schema.partnerClicks.day], set: { count: sql`${schema.partnerClicks.count} + 1` } });
  return { code: r.c.code, campaign: c, days: (await program()).cookieDays };
}

// Payouts

const shapePayout = (o: typeof O.$inferSelect) => ({ id: o.id, number: `PO-${String(o.seq).padStart(5, "0")}`, amount: o.amount, tds: o.tds, net: o.net, currency: o.currency, status: o.status, method: o.method, note: o.note, adminNote: o.adminNote, reference: o.reference, createdAt: o.createdAt, decidedAt: o.decidedAt, paidAt: o.paidAt });

export async function listPayouts(partnerId: string) {
  return (await db.select().from(O).where(eq(O.partnerId, partnerId)).orderBy(desc(O.createdAt)).limit(200)).map(shapePayout);
}

export async function listCommissions(partnerId: string, limit = 300) {
  const rows = await db.select({ k: K, org: schema.organizations.name, seq: schema.subscriptionInvoices.seq }).from(K).leftJoin(schema.organizations, eq(schema.organizations.id, K.orgId)).leftJoin(schema.subscriptionInvoices, eq(schema.subscriptionInvoices.id, K.invoiceId)).where(eq(K.partnerId, partnerId)).orderBy(desc(K.createdAt)).limit(limit);
  const now = new Date();
  return rows.map(({ k, org, seq }) => ({ id: k.id, kind: k.kind, customer: org ?? "", invoice: seq ? `CD-${new Date(k.createdAt).getUTCFullYear()}-${String(seq).padStart(6, "0")}` : null, basis: k.basis, rateBps: k.rateBps, amount: k.amount, currency: k.currency, status: k.status === "void" ? "void" : k.availableAt <= now ? "available" : "on_hold", availableAt: k.availableAt, note: k.note, createdAt: k.createdAt }));
}

export const withdrawSchema = z.object({ amount: z.number().int().min(1), note: str(300).default("") });

/** Asks for a payout. One request open at a time; only what's past the hold. */
export async function requestPayout(p: Partner, d: z.infer<typeof withdrawSchema>) {
  assertApproved(p);
  if (!p.payoutMethod || !p.payoutEnc) throw new ApiError("validation_failed", "Add your payout details first.");
  const prog = await program();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`partner-payout:${p.id}`}))`);
    const [open] = await tx.select({ id: O.id }).from(O).where(and(eq(O.partnerId, p.id), inArray(O.status, ["requested", "approved"])));
    if (open) throw new ApiError("conflict", "You already have a payout in progress.");
    if (d.amount < prog.minPayout) throw new ApiError("validation_failed", `The smallest payout is ₹${(prog.minPayout / 100).toLocaleString("en-IN")}.`, { amount: ["Too small"] });
    const b = await balances(p.id, tx);
    if (d.amount > b.available) throw new ApiError("validation_failed", `You can withdraw up to ₹${(Math.max(0, b.available) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} now.`, { amount: ["More than available"] });
    const split = payoutSplit(d.amount, prog.tdsBps);
    const [o] = await tx.insert(O).values({ partnerId: p.id, ...split, method: p.payoutHint, note: d.note }).returning();
    return o!;
  });
  await audit({ actorId: p.userId, action: "partner.payout_requested", targetType: "partner_payout", targetId: row.id, metadata: { amount: row.amount } });
  return shapePayout(row);
}

export async function cancelPayout(p: Partner, id: string) {
  const [row] = await db.update(O).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(O.id, id), eq(O.partnerId, p.id), eq(O.status, "requested"))).returning();
  if (!row) throw new ApiError("conflict", "Only a request that hasn't been approved yet can be cancelled.");
  return shapePayout(row);
}

// ─── The platform console ──────────────────────────────────────────────────

export async function adminPartners(q: { status?: string; type?: string; search?: string }) {
  const where = [];
  if (q.status && q.status !== "all") where.push(eq(P.status, q.status));
  if (q.type && q.type !== "all") where.push(eq(P.type, q.type));
  if (q.search) where.push(or(sql`${P.name} ilike ${contains(q.search)}`, sql`${P.email} ilike ${contains(q.search)}`, sql`${P.code} ilike ${contains(q.search)}`)!);
  const rows = await db.select().from(P).where(where.length ? and(...where) : undefined).orderBy(sql`case ${P.status} when 'pending' then 0 else 1 end`, desc(P.createdAt)).limit(500);
  const ids = rows.map((r) => r.id);
  const refs = ids.length ? await db.select({ id: R.partnerId, n: sql<number>`count(*)::int` }).from(R).where(and(inArray(R.partnerId, ids), eq(R.status, "active"))).groupBy(R.partnerId) : [];
  const earned = ids.length ? await db.select({ id: K.partnerId, n: sql<string>`coalesce(sum(${K.amount}), 0)` }).from(K).where(and(inArray(K.partnerId, ids), eq(K.status, "earned"))).groupBy(K.partnerId) : [];
  return rows.map((p) => ({ ...shapePartner(p), commissionBps: p.commissionBps, customers: refs.find((x) => x.id === p.id)?.n ?? 0, earned: n(earned.find((x) => x.id === p.id)?.n) }));
}

export async function adminStats() {
  const [s] = await db.select({ pending: sql<number>`count(*) filter (where ${P.status} = 'pending')::int`, approved: sql<number>`count(*) filter (where ${P.status} = 'approved')::int`, all: sql<number>`count(*)::int` }).from(P);
  const [k] = await db.select({ earned: sql<string>`coalesce(sum(${K.amount}) filter (where ${K.status} = 'earned'), 0)`, basis: sql<string>`coalesce(sum(${K.basis}) filter (where ${K.status} = 'earned' and ${K.kind} = 'invoice'), 0)` }).from(K);
  const [o] = await db.select({ requested: sql<number>`count(*) filter (where ${O.status} in ('requested', 'approved'))::int`, owed: sql<string>`coalesce(sum(${O.amount}) filter (where ${O.status} in ('requested', 'approved')), 0)`, paid: sql<string>`coalesce(sum(${O.amount}) filter (where ${O.status} = 'paid'), 0)` }).from(O);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(R).where(eq(R.status, "active"));
  return { pending: n(s?.pending), approved: n(s?.approved), partners: n(s?.all), customers: n(r?.n), revenue: n(k?.basis), earned: n(k?.earned), payoutsOpen: n(o?.requested), payoutsOwed: n(o?.owed), paidOut: n(o?.paid) };
}

async function partnerById(id: string) {
  const [p] = await db.select().from(P).where(eq(P.id, id));
  if (!p) throw notFound("Partner");
  return p;
}

export async function adminDetail(id: string) {
  const p = await partnerById(id);
  const [user] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, p.userId));
  const d = await dashboard(p);
  return { ...d, account: user ?? null, overrides: { commissionBps: p.commissionBps, commissionMonths: p.commissionMonths }, adminNote: p.adminNote, commissions: await listCommissions(p.id, 100), payouts: await listPayouts(p.id), leads: await listLeads(p.id) };
}

export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: str(500).default("") }),
  z.object({ action: z.literal("reject"), note: str(500).min(3, "Say why — the applicant sees this") }),
  z.object({ action: z.literal("suspend"), note: str(500).min(3, "Say why — the partner sees this") }),
  z.object({ action: z.literal("reactivate") }),
]);

const MAIL: Record<string, (p: Partner, note: string) => { subject: string; body: string }> = {
  approve: (p) => ({ subject: "You're a Cloudesk partner", body: `Hi ${p.name},\n\nYour application to the Cloudesk partner program has been approved.\n\nYour code is ${p.code}. Sign in and open your partner dashboard to get your links, make coupon codes and see what you earn.\n\nWelcome aboard!` }),
  reject: (p, note) => ({ subject: "Your Cloudesk partner application", body: `Hi ${p.name},\n\nThank you for applying to the Cloudesk partner program. We can't approve your application right now.\n\n${note}\n\nYou're welcome to update your details and apply again from the partner page.` }),
  suspend: (p, note) => ({ subject: "Your Cloudesk partner account is paused", body: `Hi ${p.name},\n\nYour partner account has been paused, so your codes don't work for new customers for now.\n\n${note}\n\nReply to this email if you have questions.` }),
  reactivate: (p) => ({ subject: "Your Cloudesk partner account is active again", body: `Hi ${p.name},\n\nYour partner account is active again, and your codes work as before.` }),
};

export async function adminAct(adminId: string, id: string, a: z.infer<typeof adminActionSchema>) {
  const p = await partnerById(id);
  const allowed: Record<string, string[]> = { approve: ["pending", "rejected"], reject: ["pending"], suspend: ["approved"], reactivate: ["suspended"] };
  if (!allowed[a.action]!.includes(p.status)) throw new ApiError("conflict", `This partner is ${p.status}, so that can't be done.`);
  const now = new Date();
  const status = { approve: "approved", reject: "rejected", suspend: "suspended", reactivate: "approved" }[a.action];
  const note = "note" in a ? a.note : "";
  const [u] = await db.update(P).set({ status, reviewNote: a.action === "approve" || a.action === "reactivate" ? "" : note, reviewedBy: adminId, reviewedAt: now, ...(a.action === "approve" && !p.approvedAt ? { approvedAt: now } : {}), updatedAt: now }).where(eq(P.id, id)).returning();
  await audit({ actorId: adminId, action: `partner.${a.action}`, targetType: "partner", targetId: id, metadata: { note } });
  const m = MAIL[a.action]!(u!, note);
  await sendMail({ to: p.email, ...m }).catch((e) => log.warn("partner mail failed", { id, error: String(e) }));
  return shapePartner(u!);
}

export const adminUpdateSchema = z.object({
  type: z.enum(PARTNER_TYPES).optional(),
  commissionBps: z.number().int().min(0).max(10000).nullable().optional(),
  commissionMonths: z.number().int().min(0).max(120).nullable().optional(),
  adminNote: str(2000).optional(),
  code: z.string().trim().max(20).optional(),
});

export async function adminUpdate(adminId: string, id: string, d: z.infer<typeof adminUpdateSchema>) {
  const p = await partnerById(id);
  const out = await db.transaction(async (tx) => {
    if (d.code !== undefined && cleanCode(d.code) !== p.code) {
      const code = cleanCode(d.code);
      if (!CODE_RE.test(code)) throw new ApiError("validation_failed", "Codes are 4–20 letters and numbers.", { code: ["4–20 letters and numbers"] });
      const [taken] = await tx.select({ id: C.id }).from(C).where(eq(C.code, code));
      if (taken) throw new ApiError("conflict", "That code is taken.", { code: ["Taken"] });
      await tx.update(C).set({ code }).where(and(eq(C.partnerId, id), eq(C.primary, true)));
      d.code = code;
    } else delete d.code;
    const [u] = await tx.update(P).set({ ...d, updatedAt: new Date() }).where(eq(P.id, id)).returning();
    return u!;
  });
  await audit({ actorId: adminId, action: "partner.updated", targetType: "partner", targetId: id, metadata: { ...d, adminNote: d.adminNote === undefined ? undefined : "(changed)" } });
  return shapePartner(out);
}

/** For paying them: the full details (re-authenticated admins only). */
export async function adminPayoutDetails(adminId: string, id: string) {
  const p = await partnerById(id);
  await audit({ actorId: adminId, action: "partner.payout_details_viewed", targetType: "partner", targetId: id });
  if (!p.payoutEnc) return { details: null };
  return { details: JSON.parse(decryptSecret(p.payoutEnc)) as PayoutDetails };
}

export const adminCouponSchema = couponSchema.extend({ commissionBps: z.number().int().min(0).max(10000).nullable().default(null) });

export async function adminCreateCoupon(adminId: string, id: string, c: z.infer<typeof adminCouponSchema>) {
  const p = await partnerById(id);
  const row = await createCoupon(p, c, { id: adminId, commissionBps: c.commissionBps });
  await audit({ actorId: adminId, action: "partner.coupon_created", targetType: "partner_coupon", targetId: row.id, metadata: { code: row.code } });
  return row;
}

export const adminCouponPatch = z.object({ label: str(60).optional(), discountBps: z.number().int().min(0).max(9000).optional(), discountPayments: z.number().int().min(1).max(24).optional(), commissionBps: z.number().int().min(0).max(10000).nullable().optional(), active: z.boolean().optional(), maxUses: z.number().int().min(1).nullable().optional(), expiresAt: z.iso.datetime().nullable().optional() });

export async function adminUpdateCoupon(adminId: string, couponId: string, d: z.infer<typeof adminCouponPatch>) {
  const [row] = await db.update(C).set({ ...d, expiresAt: d.expiresAt === undefined ? undefined : d.expiresAt ? new Date(d.expiresAt) : null }).where(eq(C.id, couponId)).returning();
  if (!row) throw notFound("Code");
  await audit({ actorId: adminId, action: "partner.coupon_updated", targetType: "partner_coupon", targetId: couponId, metadata: d });
  return shapeCoupon(row);
}

/** Gives a workspace to a partner by hand (it mustn't have one already). */
export async function adminAttach(adminId: string, id: string, orgId: string) {
  const p = await partnerById(id);
  const [org] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!org) throw notFound("Workspace");
  if ((await ownerOf(orgId)) === p.userId) throw new ApiError("conflict", "That's the partner's own workspace.");
  const [has] = await db.select({ id: R.id }).from(R).where(eq(R.orgId, orgId));
  if (has) throw new ApiError("conflict", "That workspace already belongs to a partner. Reverse that first.");
  const prog = await program();
  const months = p.commissionMonths ?? prog.types[p.type as PartnerType].commissionMonths;
  const [ref] = await db.insert(R).values({ partnerId: id, orgId, code: p.code, source: "manual", commissionUntil: months ? addMonths(new Date(), months) : null, createdBy: adminId }).returning();
  await audit({ actorId: adminId, orgId, action: "partner.referral_added", targetType: "partner_referral", targetId: ref!.id, metadata: { partner: id } });
  return ref!;
}

/** Takes a workspace away from its partner: no more earnings or discount from it. */
export async function adminReverse(adminId: string, referralId: string) {
  const [ref] = await db.update(R).set({ status: "reversed", discountLeft: 0 }).where(and(eq(R.id, referralId), eq(R.status, "active"))).returning();
  if (!ref) throw notFound("Referral");
  await audit({ actorId: adminId, orgId: ref.orgId, action: "partner.referral_reversed", targetType: "partner_referral", targetId: referralId });
  return ref;
}

export const adjustmentSchema = z.object({ amount: z.number().int().min(-100_000_000).max(100_000_000).refine((v) => v !== 0, "Enter an amount"), note: str(300).min(3, "Say why — the partner sees this") });

export async function adminAdjust(adminId: string, id: string, d: z.infer<typeof adjustmentSchema>) {
  await partnerById(id);
  const [k] = await db.insert(K).values({ partnerId: id, kind: "adjustment", amount: d.amount, availableAt: new Date(), note: d.note, createdBy: adminId }).returning();
  await audit({ actorId: adminId, action: "partner.adjusted", targetType: "partner", targetId: id, metadata: { amount: d.amount, note: d.note } });
  return k!;
}

export async function adminVoidCommission(adminId: string, commissionId: string, note: string) {
  const [k] = await db.update(K).set({ status: "void", note }).where(and(eq(K.id, commissionId), eq(K.status, "earned"))).returning();
  if (!k) throw notFound("Commission");
  await audit({ actorId: adminId, action: "partner.commission_voided", targetType: "partner_commission", targetId: commissionId, metadata: { amount: k.amount, note } });
  return k;
}

export async function adminPayouts(q: { status?: string }) {
  const rows = await db.select({ o: O, p: { id: P.id, name: P.name, email: P.email, type: P.type, code: P.code } }).from(O).innerJoin(P, eq(P.id, O.partnerId)).where(q.status && q.status !== "all" ? (q.status === "open" ? inArray(O.status, ["requested", "approved"]) : eq(O.status, q.status)) : undefined).orderBy(sql`case ${O.status} when 'requested' then 0 when 'approved' then 1 else 2 end`, desc(O.createdAt)).limit(500);
  return rows.map((r) => ({ ...shapePayout(r.o), partner: r.p }));
}

export const payoutActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: str(300).default("") }),
  z.object({ action: z.literal("reject"), note: str(300).min(3, "Say why — the partner sees this") }),
  z.object({ action: z.literal("paid"), reference: str(120).min(3, "Enter the transfer reference (UTR)"), note: str(300).default("") }),
]);

export async function adminPayoutAct(adminId: string, payoutId: string, a: z.infer<typeof payoutActionSchema>) {
  const [cur] = await db.select().from(O).where(eq(O.id, payoutId));
  if (!cur) throw notFound("Payout");
  const from: Record<string, string[]> = { approve: ["requested"], reject: ["requested", "approved"], paid: ["requested", "approved"] };
  if (!from[a.action]!.includes(cur.status)) throw new ApiError("conflict", `This payout is ${cur.status}.`);
  const now = new Date();
  const [row] = await db.update(O).set({ status: a.action === "approve" ? "approved" : a.action === "reject" ? "rejected" : "paid", adminNote: a.note ?? "", decidedBy: adminId, decidedAt: now, ...(a.action === "paid" ? { reference: a.reference, paidAt: now } : {}) }).where(and(eq(O.id, payoutId), eq(O.status, cur.status))).returning();
  if (!row) throw new ApiError("conflict", "Someone else changed this payout — reload.");
  await audit({ actorId: adminId, action: `partner.payout_${a.action}`, targetType: "partner_payout", targetId: payoutId, metadata: { amount: row.amount, reference: a.action === "paid" ? a.reference : undefined } });
  const [p] = await db.select().from(P).where(eq(P.id, row.partnerId));
  const amt = `₹${(row.net / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const mail = a.action === "approve" ? { subject: "Your payout is approved", body: `Your payout request of ${amt} has been approved and will be transferred soon.` } : a.action === "paid" ? { subject: "Your payout has been sent", body: `We've sent ${amt} to ${row.method}. Reference: ${a.reference}.` } : { subject: "Your payout request", body: `We couldn't process your payout request: ${a.note}\n\nThe amount is back in your available balance.` };
  if (p) await sendMail({ to: p.email, subject: mail.subject, body: `Hi ${p.name},\n\n${mail.body}` }).catch((e) => log.warn("partner mail failed", { payoutId, error: String(e) }));
  return shapePayout(row);
}

/** Workspaces a partner could be given (search by name), for the console. */
export async function searchWorkspaces(q: string) {
  if (!q.trim()) return [];
  return db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).leftJoin(R, eq(R.orgId, schema.organizations.id)).where(and(sql`${schema.organizations.name} ilike ${contains(q)}`, isNull(R.id))).limit(10);
}

