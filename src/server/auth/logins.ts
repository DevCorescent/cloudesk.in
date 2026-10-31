// Every sign-in attempt is recorded: who, how (password, two-factor, GitHub,
// SSO), from where, and whether it worked. A successful sign-in from a
// browser and network not seen for that person before emails them, so a
// stolen password shows up quickly.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { appUrl, sendMail } from "../services/mail";

/** The browser family and the first two parts of the address: enough to tell "a new device" apart without fingerprinting. */
export function deviceKey(ip: string | null | undefined, ua: string | null | undefined) {
  const net = (ip ?? "").includes(":") ? (ip ?? "").split(":").slice(0, 3).join(":") : (ip ?? "").split(".").slice(0, 2).join(".");
  const u = ua ?? "";
  const browser = /Edg\//.test(u) ? "Edge" : /Chrome\//.test(u) ? "Chrome" : /Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : u.slice(0, 20);
  const os = /Windows/.test(u) ? "Windows" : /Mac OS X|Macintosh/.test(u) ? "macOS" : /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iOS" : /Linux/.test(u) ? "Linux" : "";
  return `${browser}|${os}|${net}`;
}

export async function recordLogin(x: { userId: string | null; email: string; ok: boolean; method: "password" | "mfa" | "github" | "sso" | "email_code"; reason?: string; ip?: string | null; userAgent?: string | null }) {
  try {
    let newDevice = false;
    if (x.ok && x.userId) {
      const seen = await db.select({ ip: schema.loginEvents.ip, ua: schema.loginEvents.userAgent }).from(schema.loginEvents).where(and(eq(schema.loginEvents.userId, x.userId), eq(schema.loginEvents.ok, true))).orderBy(desc(schema.loginEvents.at)).limit(200);
      const key = deviceKey(x.ip, x.userAgent);
      // The very first sign-in isn't "new" — there's nothing to compare with.
      newDevice = seen.length > 0 && !seen.some((s) => deviceKey(s.ip, s.ua) === key);
    }
    await db.insert(schema.loginEvents).values({ userId: x.userId, email: x.email.toLowerCase().slice(0, 320), ok: x.ok, method: x.method, reason: x.reason ?? "", ip: x.ip ?? null, userAgent: x.userAgent?.slice(0, 300) ?? null, newDevice });
    if (newDevice && x.userId) {
      const [u] = await db.select({ email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, x.userId));
      const [browser, os] = deviceKey(x.ip, x.userAgent).split("|");
      const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
      if (u) await sendMail({ to: u.email, subject: "New sign-in to your Cloudesk account", body: `Hi ${u.name || "there"},\n\nYour account was just signed in to from ${browser}${os ? ` on ${os}` : ""} (${x.ip ?? "unknown address"}) at ${when} IST.\n\nIf this was you, there's nothing to do. If not, change your password now and sign out other sessions: ${appUrl("/settings")}` }).catch(() => {});
    }
  } catch (e) {
    log.warn("login_event_failed", { err: String(e) });
  }
}

/** A person's recent sign-ins (for Settings → Security). */
export async function myLogins(userId: string) {
  return db.select({ id: schema.loginEvents.id, ok: schema.loginEvents.ok, method: schema.loginEvents.method, reason: schema.loginEvents.reason, ip: schema.loginEvents.ip, userAgent: schema.loginEvents.userAgent, newDevice: schema.loginEvents.newDevice, at: schema.loginEvents.at }).from(schema.loginEvents).where(eq(schema.loginEvents.userId, userId)).orderBy(desc(schema.loginEvents.at)).limit(50);
}

/** Sign-ins by a workspace's members in the last week, with failures counted — for owners and admins. */
export async function workspaceLogins(orgId: string) {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = (await db.execute(sql`select u.name, u.email, e.ok, e.method, e.reason, e.ip, e.new_device as "newDevice", e.at from login_events e join memberships m on m.user_id = e.user_id and m.org_id = ${orgId} join users u on u.id = e.user_id where e.at >= ${since} order by e.at desc limit 300`)) as unknown as { rows: { name: string; email: string; ok: boolean; method: string; reason: string; ip: string | null; newDevice: boolean; at: string }[] };
  const failures = new Map<string, number>();
  for (const r of rows.rows) if (!r.ok) failures.set(r.email, (failures.get(r.email) ?? 0) + 1);
  return { events: rows.rows, attention: [...failures.entries()].filter(([, n]) => n >= 5).map(([email, n]) => ({ email, failures: n })) };
}

/** Failed attempts for an address in the last hour (or the given window) — used to slow guessing down further. */
export async function recentFailures(email: string, windowMs = 3_600_000) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginEvents).where(and(eq(schema.loginEvents.email, email.toLowerCase()), eq(schema.loginEvents.ok, false), gte(schema.loginEvents.at, new Date(Date.now() - windowMs))));
  return r.n;
}

/**
 * Per-account brake on password guessing that rotating IP addresses can't get
 * around: after this many failures for one address, password sign-in for it
 * pauses (signing in with an emailed code still works, so the owner isn't locked out).
 */
export const PASSWORD_LOCK = { perHour: 20, perDay: 50 } as const;
export async function assertPasswordNotLocked(email: string) {
  const hour = await recentFailures(email);
  const day = hour >= PASSWORD_LOCK.perHour ? hour : await recentFailures(email, 86_400_000);
  if (hour >= PASSWORD_LOCK.perHour || day >= PASSWORD_LOCK.perDay) {
    throw new ApiError("rate_limited", "Too many failed sign-ins for this account. Try again later, or sign in with an emailed code.", { retryAfterSeconds: hour >= PASSWORD_LOCK.perHour ? 3600 : 86_400 });
  }
}
