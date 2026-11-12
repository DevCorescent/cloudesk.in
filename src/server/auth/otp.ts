// One-time codes sent by email, for signing up, signing in and changing a
// forgotten password from account settings. A code is six
// digits, works once, for 10 minutes, with 5 tries; only an HMAC of it (keyed
// with the server's secret and the row id) is stored. Asking again replaces the
// previous code. Sending is rate-limited per address and per IP.
import { createHmac, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { rateLimit } from "../security/rate-limit";
import { safeEqual } from "../security/tokens";
import { mailProvider, sendMail } from "../services/mail";

export type OtpPurpose = "signup" | "login" | "password";
const TTL_MS = 10 * 60_000;
const MAX_TRIES = 5;
const RESEND_AFTER_MS = 30_000;

function secret() {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k) throw new ApiError("unavailable", "Email codes aren't available: the server has no APP_ENCRYPTION_KEY.");
  return k;
}
const digest = (id: string, code: string) => createHmac("sha256", secret()).update(`otp:${id}:${code}`).digest("hex");

/** In development without a mail service, the code is shown on screen (never in production). */
export const showCodeOnScreen = () => process.env.NODE_ENV !== "production" && mailProvider() === "outbox";

/** Sends a fresh code. Returns the ticket that identifies this code (and the code itself only where showCodeOnScreen). */
export async function issueOtp(email: string, purpose: OtpPurpose, opts: { ip?: string | null; payload?: Record<string, unknown> | null; send?: boolean } = {}) {
  const addr = email.trim().toLowerCase();
  await rateLimit(`otp:${purpose}:${addr}`, 6, 60 * 60_000);
  await rateLimit(`otp:ip:${opts.ip ?? "unknown"}`, 40, 60 * 60_000);
  const [last] = await db.select({ createdAt: schema.emailOtps.createdAt }).from(schema.emailOtps).where(and(sql`lower(${schema.emailOtps.email}) = ${addr}`, eq(schema.emailOtps.purpose, purpose))).orderBy(desc(schema.emailOtps.createdAt)).limit(1);
  if (last && Date.now() - last.createdAt.getTime() < RESEND_AFTER_MS) throw new ApiError("rate_limited", "A code was just sent. Wait a few seconds before asking for another.");
  // Only the newest code works.
  await db.update(schema.emailOtps).set({ consumedAt: new Date() }).where(and(sql`lower(${schema.emailOtps.email}) = ${addr}`, eq(schema.emailOtps.purpose, purpose), isNull(schema.emailOtps.consumedAt)));
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [row] = await db.insert(schema.emailOtps).values({ email: addr, purpose, codeHash: "pending", expiresAt: new Date(Date.now() + TTL_MS), payload: opts.payload ?? null, ip: opts.ip ?? null }).returning({ id: schema.emailOtps.id, expiresAt: schema.emailOtps.expiresAt });
  await db.update(schema.emailOtps).set({ codeHash: digest(row.id, code) }).where(eq(schema.emailOtps.id, row.id));
  if (opts.send !== false) {
    const what = purpose === "signup" ? "finish creating your Cloudesk account" : purpose === "password" ? "change your Cloudesk password" : "sign in to Cloudesk";
    await sendMail({ to: addr, subject: `${code} is your Cloudesk code`, body: `Your code to ${what} is:\n\n${code}\n\nIt works once, for the next 10 minutes. If you didn't ask for it, you can ignore this email — nobody can get in without the code.` });
  }
  return { ticket: row.id, expiresAt: row.expiresAt, devCode: showCodeOnScreen() ? code : undefined };
}

/**
 * Checks a code. Finds it by ticket (sign-up) or the newest one for the address
 * (sign-in). A wrong code uses up a try; the fifth wrong one ends the code.
 */
export async function verifyOtp(q: { purpose: OtpPurpose; code: string; ticket?: string; email?: string; ip?: string | null }) {
  await rateLimit(`otp:verify:${q.ip ?? "unknown"}`, 60, 15 * 60_000);
  const code = q.code.replace(/\D/g, "");
  const bad = () => new ApiError("bad_request", "That code is wrong or has expired. Ask for a new one.");
  if (code.length !== 6) throw bad();
  const where = q.ticket ? and(eq(schema.emailOtps.id, q.ticket), eq(schema.emailOtps.purpose, q.purpose)) : and(sql`lower(${schema.emailOtps.email}) = ${(q.email ?? "").trim().toLowerCase()}`, eq(schema.emailOtps.purpose, q.purpose));
  if (q.ticket && !/^[0-9a-f-]{36}$/i.test(q.ticket)) throw bad();
  const [row] = await db.select().from(schema.emailOtps).where(and(where, isNull(schema.emailOtps.consumedAt), gt(schema.emailOtps.expiresAt, new Date()))).orderBy(desc(schema.emailOtps.createdAt)).limit(1);
  if (!row || row.attempts >= MAX_TRIES) throw bad();
  if (!safeEqual(digest(row.id, code), row.codeHash)) {
    const [u] = await db.update(schema.emailOtps).set({ attempts: sql`${schema.emailOtps.attempts} + 1`, consumedAt: sql`case when ${schema.emailOtps.attempts} + 1 >= ${MAX_TRIES} then now() else null end` }).where(eq(schema.emailOtps.id, row.id)).returning({ attempts: schema.emailOtps.attempts });
    const left = MAX_TRIES - (u?.attempts ?? MAX_TRIES);
    throw new ApiError("bad_request", left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right, and it has now expired. Ask for a new one.");
  }
  // Used once: whoever marks it first wins.
  const [used] = await db.update(schema.emailOtps).set({ consumedAt: new Date() }).where(and(eq(schema.emailOtps.id, row.id), isNull(schema.emailOtps.consumedAt))).returning();
  if (!used) throw bad();
  return used;
}

/** Old codes are only kept a day (for support questions). */
export async function pruneOtps() {
  await db.delete(schema.emailOtps).where(sql`${schema.emailOtps.createdAt} < now() - interval '1 day'`);
}
