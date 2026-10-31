// Signing customers and suppliers into a workspace's portal: a one-time link
// to an email the workspace already knows (a customer on an invoice, a CRM
// contact, someone who raised a ticket; an approved supplier), then a session
// cookie. Only hashes of links and sessions are stored. Asking for a link
// says the same thing whether or not the email is known, so addresses can't
// be probed.
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { cookieName, LINK_MINUTES, loginSchema, SESSION_DAYS, settingsSchema, type PortalKind, type PortalSettings } from "@/lib/portal/model";
import { isOn, isPartOn, type PartsOff } from "@/lib/workspace/modules";
import { readCookie } from "../auth/session";
import { ApiError, notFound } from "../http/errors";
import { check } from "../helpdesk/access";
import { log } from "../log";
import { rateLimit } from "../security/rate-limit";
import { randomToken, sha256 } from "../security/tokens";
import { appUrl, sendMail } from "../services/mail";

export type Portal = { orgId: string; name: string; slug: string; settings: PortalSettings; modules: string[] | null; partsOff: PartsOff };
export type Visitor = Portal & { kind: PortalKind; email: string; sessionId: string };

export async function getPortalSettings(orgId: string) {
  const [row] = await db.select().from(schema.portalSettings).where(eq(schema.portalSettings.orgId, orgId));
  return settingsSchema.parse(row?.settings ?? {});
}

/** The workspace behind a portal address, if its portal is on. */
export async function portalBySlug(slug: string): Promise<Portal> {
  if (!/^[a-z0-9-]{1,80}$/i.test(slug)) throw notFound("Portal");
  const [o] = await db.select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug, modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.slug, slug.toLowerCase()));
  if (!o || !isOn(o.modules, "portal")) throw notFound("Portal");
  return { orgId: o.id, name: o.name, slug: o.slug, settings: await getPortalSettings(o.id), modules: o.modules as string[] | null, partsOff: (o.partsOff ?? {}) as PartsOff };
}

/** Whether this side of the portal is open: the part switched on and the portal settings allowing it. */
export function sideOpen(p: Portal, kind: PortalKind) {
  return isPartOn(p.partsOff, "portal", kind === "customer" ? "customers" : "suppliers") && (kind === "customer" ? p.settings.customers.enabled : p.settings.suppliers.enabled);
}

/** The workspace's finance books and projects that can hold invoices. */
export async function invoiceOwnerIds(orgId: string) {
  const rows = await db
    .select({ id: schema.invoiceOwners.id })
    .from(schema.invoiceOwners)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.invoiceOwners.projectId))
    .leftJoin(schema.financeBooks, eq(schema.financeBooks.id, schema.invoiceOwners.bookId))
    .where(or(eq(schema.projects.orgId, orgId), eq(schema.financeBooks.orgId, orgId)));
  return rows.map((r) => r.id);
}

/** Invoice clients with this email in the workspace. */
export async function clientIds(orgId: string, email: string) {
  const owners = await invoiceOwnerIds(orgId);
  if (!owners.length) return [];
  const rows = await db.select({ id: schema.invoiceClients.id }).from(schema.invoiceClients).where(and(inArray(schema.invoiceClients.projectId, owners), sql`lower(${schema.invoiceClients.email}) = ${email}`));
  return rows.map((r) => r.id);
}

/** The supplier with this email, if they're one the workspace still deals with. */
export async function supplierFor(orgId: string, email: string) {
  const [s] = await db.select().from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, orgId), sql`lower(${schema.invSuppliers.email}) = ${email}`, eq(schema.invSuppliers.active, true), sql`${schema.invSuppliers.approval} <> 'blocked'`));
  return s ?? null;
}

/** Is this someone the workspace knows on that side? */
export async function known(orgId: string, kind: PortalKind, email: string) {
  if (kind === "supplier") return !!(await supplierFor(orgId, email));
  if ((await clientIds(orgId, email)).length) return true;
  const [c] = await db.select({ id: schema.crmContacts.id }).from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, orgId), sql`lower(${schema.crmContacts.email}) = ${email}`));
  if (c) return true;
  const [t] = await db.select({ id: schema.hdTickets.id }).from(schema.hdTickets).where(and(eq(schema.hdTickets.orgId, orgId), sql`lower(${schema.hdTickets.customerEmail}) = ${email}`)).limit(1);
  return !!t;
}

/** Email a one-time sign-in link — only to known addresses, but the answer is the same either way. */
export async function requestLink(slug: string, raw: unknown, ip: string | null) {
  const p = await portalBySlug(slug);
  const v = check(loginSchema, raw);
  if (!sideOpen(p, v.kind)) throw notFound("Portal");
  const email = v.email.trim().toLowerCase();
  await rateLimit(`portal-link-ip:${ip ?? "?"}`, 20, 3_600_000);
  await rateLimit(`portal-link:${p.orgId}:${email}`, 5, 3_600_000);
  if (await known(p.orgId, v.kind, email)) {
    const token = randomToken(24);
    await db.insert(schema.portalLinks).values({ orgId: p.orgId, kind: v.kind, email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) });
    const url = appUrl(`/portal/${p.slug}?kind=${v.kind}&t=${token}`);
    await sendMail({ to: email, subject: `Your sign-in link for ${p.name}`, fromName: p.name, body: `Hello,\n\nUse this link to open your ${v.kind === "customer" ? "customer" : "supplier"} portal with ${p.name}. It works once, for ${LINK_MINUTES} minutes:\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.` }).catch((e) => log.warn("portal.link_mail_failed", { err: String(e) }));
  }
  return { sent: true };
}

const secure = () => ((process.env.APP_URL ?? "").startsWith("https://") ? "; Secure" : "");

/** Use a link: it's spent, and a session starts. Returns the cookie to set. */
export async function signIn(slug: string, token: string, who: { ip: string | null; userAgent: string | null }) {
  const p = await portalBySlug(slug);
  await rateLimit(`portal-verify:${who.ip ?? "?"}`, 30, 3_600_000);
  if (!token || token.length < 20) throw new ApiError("unauthenticated", "This sign-in link doesn't work. Ask for a new one.");
  const [link] = await db.update(schema.portalLinks).set({ usedAt: new Date() }).where(and(eq(schema.portalLinks.tokenHash, sha256(token)), eq(schema.portalLinks.orgId, p.orgId), isNull(schema.portalLinks.usedAt), gt(schema.portalLinks.expiresAt, new Date()))).returning();
  if (!link) throw new ApiError("unauthenticated", "This sign-in link has expired or was already used. Ask for a new one.");
  const kind = link.kind as PortalKind;
  if (!sideOpen(p, kind) || !(await known(p.orgId, kind, link.email))) throw new ApiError("forbidden", "This portal isn't open to you any more");
  const session = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.portalSessions).values({ orgId: p.orgId, kind, email: link.email, tokenHash: sha256(session), expiresAt, ip: who.ip, userAgent: who.userAgent?.slice(0, 300) ?? null });
  return { kind, email: link.email, cookie: `${cookieName(kind)}=${session}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure()}` };
}

/** The signed-in visitor for this portal and side, or an "unauthenticated" error. */
export async function visitor(slug: string, kind: PortalKind, req: Request): Promise<Visitor> {
  const p = await portalBySlug(slug);
  if (!sideOpen(p, kind)) throw notFound("Portal");
  const token = readCookie(req.headers.get("cookie"), cookieName(kind));
  if (!token) throw new ApiError("unauthenticated", "Sign in to continue");
  const [s] = await db.select().from(schema.portalSessions).where(and(eq(schema.portalSessions.tokenHash, sha256(token)), eq(schema.portalSessions.orgId, p.orgId), eq(schema.portalSessions.kind, kind), isNull(schema.portalSessions.revokedAt), gt(schema.portalSessions.expiresAt, new Date())));
  if (!s) throw new ApiError("unauthenticated", "Sign in to continue");
  // A supplier who has been blocked loses access straight away.
  if (kind === "supplier" && !(await supplierFor(p.orgId, s.email))) throw new ApiError("forbidden", "This portal isn't open to you any more");
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) await db.update(schema.portalSessions).set({ lastSeenAt: new Date() }).where(eq(schema.portalSessions.id, s.id));
  return { ...p, kind, email: s.email, sessionId: s.id };
}

export async function signOut(slug: string, kind: PortalKind, req: Request) {
  const token = readCookie(req.headers.get("cookie"), cookieName(kind));
  if (token) await db.update(schema.portalSessions).set({ revokedAt: new Date() }).where(eq(schema.portalSessions.tokenHash, sha256(token)));
  void slug;
  return `${cookieName(kind)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The supplier portal's address, for emails to suppliers — or null when it isn't open. */
export async function supplierPortalUrl(orgId: string) {
  const [o] = await db.select({ slug: schema.organizations.slug, modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!o || !isOn(o.modules, "portal") || !isPartOn(o.partsOff as PartsOff, "portal", "suppliers") || !(await getPortalSettings(orgId)).suppliers.enabled) return null;
  return appUrl(`/portal/${o.slug}?kind=supplier`);
}
