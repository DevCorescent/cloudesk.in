// Sign-up after onboarding: the person describes their business and picks
// features and a plan first; then their details; then a six-digit code sent to
// their email. Only a correct code creates the account (already verified), the
// workspace with its features and the free trial. They then sign in.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { choiceSchema } from "@/lib/billing/schema";
import { answers } from "@/lib/onboarding/answers";
import { INDUSTRIES, MODULE_IDS, normaliseParts, withRequirements, type ModuleId } from "@/lib/workspace/modules";
import { hashPassword } from "../auth/password";
import { issueOtp, verifyOtp } from "../auth/otp";
import { changePlan, quoteFor } from "../billing/subscriptions";
import { attachReferral, completePartnerSignup, partnerPayload, resolveCode } from "../partners/core";
import { ApiError } from "../http/errors";
import { email, password } from "../http/schemas";
import { log } from "../log";
import { assertSignupAllowed } from "../platform/settings";
import { setupModule } from "../workspace/setup";
import { audit } from "./audit";
import { findUserByEmail } from "./auth";
import { acceptInvitation, createOrganization, previewInvitation } from "./orgs";

export const signupStart = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email,
  password,
  workspaceName: z.string().trim().min(1, "Name your business").max(80),
  industry: z.enum(INDUSTRIES.map((i) => i.id) as [string, ...string[]]).optional(),
  /** null = every feature on. */
  modules: z.array(z.enum(MODULE_IDS as unknown as [ModuleId, ...ModuleId[]])).max(MODULE_IDS.length).nullable().optional(),
  partsOff: z.record(z.string().max(40), z.array(z.string().max(40)).max(40)).optional(),
  onboarding: answers.omit({ complete: true, tourDone: true }).optional(),
  /** The plan to be on after the trial (optional: it can be chosen later). */
  choice: choiceSchema.optional(),
  /** A partner's coupon code. */
  coupon: z.string().trim().max(30).optional(),
  acceptTerms: z.literal(true, { message: "Please accept the terms to continue" }),
});
export type SignupStart = z.infer<typeof signupStart>;

/** `ref` is the partner link the person arrived through (the cc_ref cookie). */
type Meta = { ip?: string | null; userAgent?: string | null; ref?: { code: string; campaign: string } | null };

export async function startSignup(input: SignupStart, meta: Meta) {
  if (await findUserByEmail(input.email)) throw new ApiError("conflict", "An account with this email already exists. Sign in instead.");
  await assertSignupAllowed(input.email);
  if (input.choice) await quoteFor(input.choice);
  if (input.coupon && !(await resolveCode(input.coupon))) throw new ApiError("validation_failed", "That partner code isn't valid or has expired.", { coupon: ["Not valid"] });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out of what's stored
  const { password: pw, acceptTerms, ...rest } = input;
  const payload = { ...rest, passwordHash: await hashPassword(pw) };
  const sent = await issueOtp(input.email, "signup", { ip: meta.ip, payload });
  return { ticket: sent.ticket, email: input.email, expiresAt: sent.expiresAt, devCode: sent.devCode };
}

export async function resendSignup(ticket: string, meta: Meta) {
  const [row] = await db.select().from(schema.emailOtps).where(eq(schema.emailOtps.id, ticket));
  if (!row || row.purpose !== "signup" || !row.payload) throw new ApiError("bad_request", "Start again — this sign-up has expired.");
  const sent = await issueOtp(row.email, "signup", { ip: meta.ip, payload: row.payload });
  return { ticket: sent.ticket, email: row.email, expiresAt: sent.expiresAt, devCode: sent.devCode };
}

export const invitedStart = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(1, "Enter your name").max(100),
  password,
  acceptTerms: z.literal(true, { message: "Please accept the terms to continue" }),
});

/** Someone invited to a workspace: just their name and a password, then the code. No workspace of their own. */
export async function startInvitedSignup(input: z.infer<typeof invitedStart>, meta: Meta) {
  const inv = await previewInvitation(input.token);
  await assertSignupAllowed(inv.email);
  if (await findUserByEmail(inv.email)) throw new ApiError("conflict", "You already have an account. Sign in to accept the invitation.");
  const payload = { invite: input.token, name: input.name, email: inv.email, passwordHash: await hashPassword(input.password) };
  const sent = await issueOtp(inv.email, "signup", { ip: meta.ip, payload });
  return { ticket: sent.ticket, email: inv.email, workspace: inv.orgName, expiresAt: sent.expiresAt, devCode: sent.devCode };
}

async function completeInvited(d: { invite: string; name: string; email: string; passwordHash: string }, meta: Meta) {
  if (await findUserByEmail(d.email)) throw new ApiError("conflict", "An account with this email already exists. Sign in instead.");
  const now = new Date();
  const [user] = await db.insert(schema.users).values({ name: d.name, email: d.email, passwordHash: d.passwordHash, emailVerifiedAt: now, onboardedAt: now }).returning();
  const inv = await acceptInvitation(d.invite, { id: user.id, email: user.email });
  await audit({ actorId: user.id, orgId: inv.orgId, action: "user.signup", targetType: "user", targetId: user.id, ip: meta.ip, metadata: { method: "email_code", invited: true } });
  return { email: user.email, workspace: inv.orgName, joined: true };
}

export async function completeSignup(ticket: string, code: string, meta: Meta) {
  const otp = await verifyOtp({ purpose: "signup", ticket, code, ip: meta.ip });
  const invited = z.object({ invite: z.string(), name: z.string(), email: z.string(), passwordHash: z.string().min(20) }).safeParse(otp.payload);
  if (invited.success) return completeInvited(invited.data, meta);
  const partner = partnerPayload.safeParse(otp.payload);
  if (partner.success) return completePartnerSignup(partner.data, meta);
  const p = signupStart.omit({ password: true, acceptTerms: true }).extend({ passwordHash: z.string().min(20) }).safeParse(otp.payload);
  if (!p.success) throw new ApiError("bad_request", "Start again — this sign-up couldn't be read.");
  const d = p.data;
  // Checked again: the address may have been taken (or sign-ups closed) since the code was sent.
  if (await findUserByEmail(d.email)) throw new ApiError("conflict", "An account with this email already exists. Sign in instead.");
  await assertSignupAllowed(d.email);
  const modules = d.modules ? withRequirements(d.modules) : null;
  const now = new Date();
  const { user, org } = await db.transaction(async (tx) => {
    const [u] = await tx.insert(schema.users).values({ name: d.name, email: d.email, passwordHash: d.passwordHash, emailVerifiedAt: now, onboarding: { ...(d.onboarding ?? {}), name: d.workspaceName }, onboardedAt: now }).returning();
    const o = await createOrganization(tx, { name: d.workspaceName, ownerId: u.id });
    await tx.update(schema.organizations).set({ modules, billingEmail: d.email, ...(d.industry ? { industry: d.industry } : {}), ...(d.partsOff ? { partsOff: normaliseParts(d.partsOff) } : {}) }).where(eq(schema.organizations.id, o.id));
    return { user: u, org: o };
  });
  // Each chosen feature is set up so it's ready on first sign-in; one failing doesn't stop the rest.
  for (const id of MODULE_IDS.filter((m) => !modules || modules.includes(m))) {
    await setupModule(id, { orgId: org.id, userId: user.id, businessName: d.workspaceName }).catch((e) => log.warn("signup module setup failed", { orgId: org.id, module: id, error: String(e) }));
  }
  // A partner's code or link: before the plan is chosen, so the first invoice gets the discount.
  if (d.coupon || meta.ref) await attachReferral(org.id, { ownerId: user.id, email: user.email, coupon: d.coupon, ref: meta.ref }).catch((e) => log.warn("signup referral failed", { orgId: org.id, error: String(e) }));
  else await attachReferral(org.id, { ownerId: user.id, email: user.email }).catch((e) => log.warn("signup lead match failed", { orgId: org.id, error: String(e) }));
  if (d.choice) await changePlan(org.id, user.id, d.choice).catch((e) => log.warn("signup plan choice failed", { orgId: org.id, error: String(e) }));
  await audit({ actorId: user.id, orgId: org.id, action: "user.signup", targetType: "user", targetId: user.id, ip: meta.ip, metadata: { method: "email_code", modules: modules?.length ?? "all", plan: d.choice ? (d.choice.kind === "plan" ? d.choice.planId : "custom") : null } });
  return { email: user.email, workspace: org.name };
}
