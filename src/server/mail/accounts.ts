// Connecting mailboxes: work out the provider from the address (its domain,
// or the domain's MX records), test IMAP and SMTP before saving, keep the
// password or refresh token encrypted, and refresh OAuth access tokens.
import { resolveMx } from "node:dns/promises";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { autoReplySchema, PROVIDERS, providerForAddress, providerForMx, providerOf, type ProviderId } from "@/lib/mail/model";
import type { AccountOut, CheckOut } from "@/lib/mail/api";
import { ApiError } from "../http/errors";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { audit } from "../services/audit";
import { enqueue } from "../jobs/queue";
import { check, type Account, type Scope, account, membersOf } from "./access";
import { autoReplyOf, resetAutoReplies } from "./auto-reply";
import { refreshAccess, type OauthProvider, type Tokens } from "./oauth";
import { explain, failKind, transport, type Creds } from "./transport";

type Mx = (domain: string) => Promise<{ exchange: string }[]>;
let mxLookup: Mx = resolveMx;
/** Tests answer MX lookups themselves. */
export function setMxLookup(f: Mx | null) {
  mxLookup = f ?? resolveMx;
}

export async function detect(address: string) {
  const email = z.email().safeParse(address.trim());
  if (!email.success) throw new ApiError("validation_failed", "Enter a full email address");
  const known = providerForAddress(email.data);
  if (known) return { provider: known, via: "domain" as const, mx: [] as string[] };
  const domain = email.data.split("@")[1]!;
  let mx: string[] = [];
  try {
    mx = (await Promise.race([mxLookup(domain), new Promise<never>((_r, rej) => setTimeout(() => rej(new Error("timeout")), 5000))])).map((r) => r.exchange);
  } catch {
    mx = [];
  }
  const byMx = providerForMx(mx);
  return byMx ? { provider: byMx, via: "mx" as const, mx } : { provider: "custom" as ProviderId, via: "guess" as const, mx };
}

const host = z.string().trim().min(3, "Enter the server name").max(255).regex(/^[a-z0-9.-]+$/i, "Server names are letters, numbers, dots and dashes");
const port = z.coerce.number().int().min(1).max(65535);
export const connectSchema = z.object({
  provider: z.enum(PROVIDERS.map((p) => p.id) as [ProviderId, ...ProviderId[]]),
  address: z.email("Enter a full email address").max(254),
  displayName: z.string().trim().max(120).default(""),
  username: z.string().trim().max(254).default(""),
  password: z.string().min(1, "Enter the password").max(500),
  imapHost: host,
  imapPort: port,
  imapSecure: z.boolean(),
  smtpHost: host,
  smtpPort: port,
  smtpSecure: z.boolean(),
});
const createSchema = connectSchema.extend({
  name: z.string().trim().max(80).default(""),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#6366f1"),
  shared: z.boolean().default(false),
  members: z.array(z.uuid()).max(200).default([]),
  syncDays: z.coerce.number().int().min(1).max(3650).default(30),
});

function credsFrom(v: z.infer<typeof connectSchema>): Creds {
  return { imapHost: v.imapHost, imapPort: v.imapPort, imapSecure: v.imapSecure, smtpHost: v.smtpHost, smtpPort: v.smtpPort, smtpSecure: v.smtpSecure, username: v.username || v.address, pass: v.provider === "gmail" || v.provider === "google_workspace" ? v.password.replace(/\s+/g, "") : v.password };
  // (Google shows app passwords in groups of four with spaces; the spaces aren't part of it.)
}

/** Signs in to IMAP (listing folders) and SMTP, and says exactly what failed. */
export async function testCreds(c: Creds): Promise<CheckOut> {
  const out: CheckOut = { imap: { ok: false }, smtp: { ok: false } };
  try {
    const conn = await transport().imap(c);
    try {
      out.imap = { ok: true, folders: (await conn.folders()).map((f) => f.path).slice(0, 40) };
    } finally {
      await conn.close();
    }
  } catch (e) {
    out.imap = { ok: false, error: explain(e, "imap"), kind: failKind(e) };
  }
  try {
    await transport().verifySmtp(c);
    out.smtp = { ok: true };
  } catch (e) {
    out.smtp = { ok: false, error: explain(e, "smtp"), kind: failKind(e) };
  }
  return out;
}

export async function checkConnection(raw: unknown) {
  return testCreds(credsFrom(check(connectSchema, raw)));
}

async function setMembers(accountId: string, members: string[], orgId: string) {
  await db.delete(schema.mailAccountMembers).where(eq(schema.mailAccountMembers.accountId, accountId));
  const valid = members.length ? await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId)) : [];
  const ok = members.filter((m) => valid.some((v) => v.id === m));
  if (ok.length) await db.insert(schema.mailAccountMembers).values(ok.map((userId) => ({ accountId, userId }))).onConflictDoNothing();
}

/** Tests, then saves the mailbox and starts the first sync. */
export async function createAccount(s: Scope, raw: unknown) {
  const v = check(createSchema, raw);
  if (v.shared && !s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can add team inboxes");
  const c = credsFrom(v);
  const result = await testCreds(c);
  if (!result.imap.ok || !result.smtp.ok) throw new ApiError("validation_failed", result.imap.error ?? result.smtp.error ?? "Couldn't connect", { check: [JSON.stringify(result)] });
  const p = providerOf(v.provider)!;
  let row: Account;
  try {
    [row] = (await db.insert(schema.mailAccounts).values({ orgId: s.orgId, ownerId: s.userId, shared: v.shared, name: v.name || v.address, address: v.address.toLowerCase(), displayName: v.displayName || s.userName, provider: v.provider, auth: "password", imapHost: c.imapHost, imapPort: c.imapPort, imapSecure: c.imapSecure, smtpHost: c.smtpHost, smtpPort: c.smtpPort, smtpSecure: c.smtpSecure, username: c.username, secretEnc: encryptSecret(c.pass!), color: v.color, status: "connecting", settings: { syncDays: v.syncDays, sendDelaySec: 10, aiTriage: false, savesSent: !!p.savesSent } }).returning()) as [Account];
  } catch (e) {
    if (String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code) === "23505") throw new ApiError("conflict", "This mailbox is already connected in your workspace");
    throw e;
  }
  if (v.shared) await setMembers(row.id, [...new Set([s.userId, ...v.members])], s.orgId);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "mail.account_connected", targetType: "mail_account", targetId: row.id, metadata: { address: row.address, provider: row.provider, shared: row.shared } });
  await enqueue("mail.sync", { accountId: row.id }, { orgId: s.orgId, dedupeKey: `mail.sync:${row.id}:first`, priority: 50 });
  return accountOut(s, row, v.shared ? [s.userId, ...v.members] : []);
}

/** Saves a mailbox connected through Google or Microsoft sign-in. */
export async function createOauthAccount(o: { orgId: string; userId: string; userName: string; shared: boolean }, p: OauthProvider, t: Tokens) {
  if (!t.email) throw new ApiError("provider_error", "The sign-in didn't say which mailbox it was for. Try again.");
  if (!t.refreshToken) throw new ApiError("provider_error", "The sign-in didn't grant ongoing access. Remove Cloudesk from your account's connected apps and try again.");
  const preset = providerOf(p === "google" ? (t.email.endsWith("@gmail.com") || t.email.endsWith("@googlemail.com") ? "gmail" : "google_workspace") : "microsoft")!;
  const values = { orgId: o.orgId, ownerId: o.userId, shared: o.shared, name: t.email, address: t.email.toLowerCase(), displayName: t.name ?? o.userName, provider: preset.id, auth: `oauth_${p}`, imapHost: preset.imap!.host, imapPort: preset.imap!.port, imapSecure: preset.imap!.secure, smtpHost: preset.smtp!.host, smtpPort: preset.smtp!.port, smtpSecure: preset.smtp!.secure, username: t.email, secretEnc: encryptSecret(t.refreshToken), accessTokenEnc: encryptSecret(t.accessToken), tokenExpiresAt: t.expiresAt, status: "connecting", settings: { syncDays: 30, sendDelaySec: 10, aiTriage: false, savesSent: !!preset.savesSent } };
  const [existing] = await db.select().from(schema.mailAccounts).where(and(eq(schema.mailAccounts.orgId, o.orgId), eq(schema.mailAccounts.address, values.address)));
  const [row] = existing
    ? await db.update(schema.mailAccounts).set({ secretEnc: values.secretEnc, accessTokenEnc: values.accessTokenEnc, tokenExpiresAt: values.tokenExpiresAt, auth: values.auth, status: "connecting", lastError: "" }).where(eq(schema.mailAccounts.id, existing.id)).returning()
    : await db.insert(schema.mailAccounts).values(values).returning();
  if (o.shared && !existing) await setMembers(row!.id, [o.userId], o.orgId);
  await audit({ orgId: o.orgId, actorId: o.userId, action: "mail.account_connected", targetType: "mail_account", targetId: row!.id, metadata: { address: row!.address, provider: row!.provider, via: p } });
  await enqueue("mail.sync", { accountId: row!.id }, { orgId: o.orgId, dedupeKey: `mail.sync:${row!.id}:oauth:${Date.now()}`, priority: 50 });
  return row!;
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  displayName: z.string().trim().max(120),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  signature: z.string().max(5000),
  shared: z.boolean(),
  members: z.array(z.uuid()).max(200),
  syncDays: z.coerce.number().int().min(1).max(3650),
  sendDelaySec: z.coerce.number().int().min(0).max(60),
  aiTriage: z.boolean(),
  /** Reply within this many hours (null: no target). */
  slaHours: z.number().int().min(1).max(720).nullable(),
  /** Put meeting invites from this mailbox straight into the owner's calendar. */
  autoAddMeetings: z.boolean(),
  autoReply: autoReplySchema,
  paused: z.boolean(),
  password: z.string().min(1).max(500),
}).partial();

export async function updateAccount(s: Scope, id: string, raw: unknown) {
  const a = await account(s, id, true);
  const v = check(patchSchema, raw);
  if (v.shared !== undefined && v.shared !== a.shared && !s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can make team inboxes");
  const settings: Record<string, unknown> = { ...a.settings, ...(v.syncDays !== undefined ? { syncDays: v.syncDays } : {}), ...(v.sendDelaySec !== undefined ? { sendDelaySec: v.sendDelaySec } : {}), ...(v.aiTriage !== undefined ? { aiTriage: v.aiTriage } : {}), ...(v.slaHours !== undefined ? { slaHours: v.slaHours } : {}), ...(v.autoAddMeetings !== undefined ? { autoAddMeetings: v.autoAddMeetings } : {}) };
  if (v.autoReply) {
    // Switching it on starts a new absence: answer mail from now on, everyone once.
    const was = autoReplyOf(a.settings);
    const turnedOn = v.autoReply.enabled && !was?.enabled;
    settings.autoReply = { ...v.autoReply, enabledAt: turnedOn ? new Date().toISOString() : (was?.enabledAt ?? new Date().toISOString()) };
    if (turnedOn) await resetAutoReplies(a.id);
  }
  const set: Partial<typeof schema.mailAccounts.$inferInsert> = { settings };
  for (const k of ["name", "displayName", "color", "signature", "shared"] as const) if (v[k] !== undefined) (set as Record<string, unknown>)[k] = v[k];
  if (v.paused !== undefined) set.status = v.paused ? "paused" : "connecting";
  if (v.password) {
    if (a.auth !== "password") throw new ApiError("conflict", "This mailbox signs in with Google or Microsoft — reconnect it instead");
    const result = await testCreds({ ...credsOf(a), pass: v.password });
    if (!result.imap.ok || !result.smtp.ok) throw new ApiError("validation_failed", result.imap.error ?? result.smtp.error ?? "Couldn't connect");
    set.secretEnc = encryptSecret(v.password);
    set.status = "connecting";
    set.lastError = "";
  }
  const [row] = await db.update(schema.mailAccounts).set(set).where(eq(schema.mailAccounts.id, a.id)).returning();
  if (v.members !== undefined && (row!.shared || v.shared)) await setMembers(a.id, [...new Set([a.ownerId, ...v.members])], s.orgId);
  if (set.status === "connecting") await enqueue("mail.sync", { accountId: a.id }, { orgId: s.orgId, dedupeKey: `mail.sync:${a.id}:${Math.floor(Date.now() / 60_000)}` });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "mail.account_changed", targetType: "mail_account", targetId: a.id, metadata: { fields: Object.keys(v).filter((k) => k !== "password"), passwordChanged: !!v.password } });
  return accountOut(s, row!, (await membersOf([a.id])).get(a.id) ?? []);
}

export async function deleteAccount(s: Scope, id: string) {
  const a = await account(s, id, true);
  await db.delete(schema.mailAccounts).where(eq(schema.mailAccounts.id, a.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "mail.account_removed", targetType: "mail_account", targetId: a.id, metadata: { address: a.address } });
}

export function credsOf(a: Account): Creds {
  return { imapHost: a.imapHost, imapPort: a.imapPort, imapSecure: a.imapSecure, smtpHost: a.smtpHost, smtpPort: a.smtpPort, smtpSecure: a.smtpSecure, username: a.username, pass: a.auth === "password" ? decryptSecret(a.secretEnc) : undefined };
}

/** Credentials ready to use: OAuth access tokens are refreshed when they're about to expire. */
export async function liveCreds(a: Account, f: typeof fetch = fetch): Promise<Creds> {
  const c = credsOf(a);
  if (a.auth === "password") return c;
  const p: OauthProvider = a.auth === "oauth_google" ? "google" : "microsoft";
  if (a.accessTokenEnc && a.tokenExpiresAt && a.tokenExpiresAt.getTime() - Date.now() > 120_000) return { ...c, accessToken: decryptSecret(a.accessTokenEnc) };
  const t = await refreshAccess(p, decryptSecret(a.secretEnc), f);
  await db.update(schema.mailAccounts).set({ accessTokenEnc: encryptSecret(t.accessToken), tokenExpiresAt: t.expiresAt, ...(t.refreshToken ? { secretEnc: encryptSecret(t.refreshToken) } : {}) }).where(eq(schema.mailAccounts.id, a.id));
  return { ...c, accessToken: t.accessToken };
}

export function accountOut(s: Scope, a: Account, members: string[]): AccountOut {
  const st = a.settings as { syncDays?: number; sendDelaySec?: number; aiTriage?: boolean; slaHours?: number | null; autoAddMeetings?: boolean };
  return {
    id: a.id, name: a.name, address: a.address, displayName: a.displayName, provider: a.provider as ProviderId, auth: a.auth as AccountOut["auth"], shared: a.shared, members, ownerId: a.ownerId, mine: a.ownerId === s.userId,
    color: a.color, signature: a.signature, status: a.status as AccountOut["status"], lastError: a.lastError, lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    imapHost: a.imapHost, imapPort: a.imapPort, imapSecure: a.imapSecure, smtpHost: a.smtpHost, smtpPort: a.smtpPort, smtpSecure: a.smtpSecure, username: a.username,
    settings: { syncDays: st.syncDays ?? 30, sendDelaySec: st.sendDelaySec ?? 10, aiTriage: !!st.aiTriage, slaHours: st.slaHours ?? null, autoAddMeetings: st.autoAddMeetings !== false, autoReply: autoReplyOf(a.settings) },
  };
}
