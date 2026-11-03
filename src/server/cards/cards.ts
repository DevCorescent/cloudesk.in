// Virtual business IDs. Every member gets one the first time they open it,
// filled in from their account, their HR record and the workspace; they edit
// it and pick a design unless the company's template fixes those. It's
// shared at /id/<slug> — a page with a QR code, one-tap save to contacts and
// a form for the people they meet to send their details back (which land in
// the CRM and tell the card's owner).
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BusinessCardData } from "@/db/schema";
import { cardPatchSchema, COMPANY_FIELDS, effective, exchangeSchema, templateSchema, type Template } from "@/lib/cards/model";
import { isOn } from "@/lib/workspace/modules";
import { capture } from "../crm/capture";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { ensureUsername } from "../people/directory";
import { appUrl } from "../services/mail";
import { qrSvg } from "@/lib/store/barcode";

const B = schema.businessCards;
const T = schema.businessCardTemplates;
const E = schema.businessCardExchanges;
type Card = typeof B.$inferSelect;

export const cardUrl = (slug: string) => appUrl(`/id/${slug}`);

function issues(err: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string[]> = {};
  for (const i of err.issues) (out[i.path.map(String).join(".") || "form"] ??= []).push(i.message);
  return new ApiError("validation_failed", err.issues[0]?.message ?? "Check the highlighted fields", out);
}

export async function template(orgId: string): Promise<Template | null> {
  const [t] = await db.select().from(T).where(eq(T.orgId, orgId));
  return t ? { data: t.data, style: t.style, lockStyle: t.lockStyle, lockCompany: t.lockCompany } : null;
}

async function slugFree(slug: string, except?: string) {
  const [hit] = await db.select({ id: B.id }).from(B).where(and(sql`lower(${B.slug}) = ${slug.toLowerCase()}`, except ? sql`${B.id} <> ${except}` : undefined));
  return !hit;
}

/** A public address nobody has: their username, then with the workspace, then with a few random letters. */
async function newSlug(userId: string, orgSlug: string) {
  const base = (await ensureUsername(userId)).replace(/[._]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "member";
  for (const s of [base, `${base}-${orgSlug}`.slice(0, 40)]) if (s.length >= 3 && (await slugFree(s))) return s;
  return `${base.slice(0, 30)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** What we already know about a member: their account, their HR record, the workspace. */
async function starting(orgId: string, userId: string): Promise<BusinessCardData> {
  const [u] = await db.select({ name: schema.users.name, email: schema.users.email, phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, userId));
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const hr = await db.execute(sql`select e.designation, e.phone, e.email, d.name as department from hr_employees e left join hr_departments d on d.id = e.department_id where e.org_id = ${orgId} and e.user_id = ${userId} limit 1`);
  const e = (hr.rows[0] ?? {}) as { designation?: string; phone?: string; email?: string; department?: string };
  const phone = e.phone || u?.phone || "";
  return { name: u?.name ?? "", title: e.designation || "", department: e.department || "", company: org?.name ?? "", email: e.email || u?.email || "", phone, whatsapp: phone };
}

/** The member's card, made the first time they open it. */
export async function ensureCard(orgId: string, userId: string): Promise<Card> {
  const [have] = await db.select().from(B).where(and(eq(B.orgId, orgId), eq(B.userId, userId)));
  if (have) return have;
  const [org] = await db.select({ slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  for (let tries = 0; tries < 3; tries++) {
    try {
      const [made] = await db.insert(B).values({ orgId, userId, slug: await newSlug(userId, org?.slug ?? "team"), data: await starting(orgId, userId) }).onConflictDoNothing({ target: [B.orgId, B.userId] }).returning();
      if (made) return made;
      const [again] = await db.select().from(B).where(and(eq(B.orgId, orgId), eq(B.userId, userId)));
      if (again) return again;
    } catch {
      // The slug was taken between the check and the write: pick another.
    }
  }
  throw new ApiError("conflict", "Couldn't make your business ID — try again");
}

function out(c: Card, t: Template | null) {
  const e = effective(c, t);
  const url = cardUrl(c.slug);
  return {
    id: c.id,
    slug: c.slug,
    url,
    data: c.data,
    style: c.style,
    hidden: c.hidden,
    published: c.published,
    exchange: c.exchange,
    views: c.views,
    saves: c.saves,
    updatedAt: c.updatedAt.toISOString(),
    effective: e,
    qr: qrSvg(url, { margin: 1 }),
  };
}

export async function myCard(orgId: string, userId: string) {
  const c = await ensureCard(orgId, userId);
  const t = await template(orgId);
  const recent = await db.select().from(E).where(eq(E.cardId, c.id)).orderBy(desc(E.createdAt)).limit(20);
  return { card: out(c, t), template: t, exchanges: recent.map((x) => ({ id: x.id, name: x.name, email: x.email, phone: x.phone, company: x.company, note: x.note, at: x.createdAt.toISOString() })) };
}

export async function updateMyCard(orgId: string, userId: string, raw: unknown) {
  const v = cardPatchSchema.safeParse(raw);
  if (!v.success) throw issues(v.error);
  const c = await ensureCard(orgId, userId);
  const t = await template(orgId);
  const p = v.data;
  const set: Partial<typeof B.$inferInsert> = { updatedAt: new Date() };
  if (p.data) {
    const data: BusinessCardData = { ...c.data, ...p.data };
    // The company's details come from its template when it fixes them.
    if (t?.lockCompany) for (const k of COMPANY_FIELDS) if (t.data[k] !== undefined) delete (data as Record<string, unknown>)[k];
    set.data = data;
  }
  if (p.style) {
    if (t?.lockStyle) throw new ApiError("forbidden", "Your company has fixed the design of business IDs");
    set.style = { ...c.style, ...p.style };
  }
  if (p.hidden) set.hidden = p.hidden;
  if (p.published !== undefined) set.published = p.published;
  if (p.exchange !== undefined) set.exchange = p.exchange;
  if (p.slug && p.slug !== c.slug) {
    if (!(await slugFree(p.slug, c.id))) throw new ApiError("validation_failed", "That address is taken", { slug: ["That address is taken — try another"] });
    set.slug = p.slug;
  }
  const [u] = await db.update(B).set(set).where(eq(B.id, c.id)).returning();
  return { card: out(u!, t) };
}

/** Start again from the account, HR record and workspace (keeping the address and design). */
export async function refreshMyCard(orgId: string, userId: string) {
  const c = await ensureCard(orgId, userId);
  const [u] = await db.update(B).set({ data: { ...(await starting(orgId, userId)), bio: c.data.bio, links: c.data.links }, updatedAt: new Date() }).where(eq(B.id, c.id)).returning();
  return { card: out(u!, await template(orgId)) };
}

export async function setTemplate(orgId: string, userId: string, raw: unknown) {
  const v = templateSchema.safeParse(raw);
  if (!v.success) throw issues(v.error);
  const p = v.data;
  const now = await template(orgId);
  const row = { orgId, data: p.data ?? now?.data ?? {}, style: p.style ?? now?.style ?? {}, lockStyle: p.lockStyle ?? now?.lockStyle ?? false, lockCompany: p.lockCompany ?? now?.lockCompany ?? true, updatedBy: userId, updatedAt: new Date() };
  await db.insert(T).values(row).onConflictDoUpdate({ target: T.orgId, set: row });
  return { template: await template(orgId) };
}

/** Every member's card, for the people who run the workspace. */
export async function listCards(orgId: string) {
  const rows = await db
    .select({ userId: schema.memberships.userId, name: schema.users.name, role: schema.memberships.role, card: B })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(B, and(eq(B.orgId, schema.memberships.orgId), eq(B.userId, schema.memberships.userId)))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(schema.users.name);
  return {
    members: rows.map((r) => ({ userId: r.userId, name: r.name, role: r.role, card: r.card ? { slug: r.card.slug, url: cardUrl(r.card.slug), title: r.card.data.title ?? "", published: r.card.published, views: r.card.views, saves: r.card.saves } : null })),
  };
}

/** Make a business ID for everyone who hasn't got one yet. */
export async function generateAll(orgId: string) {
  const missing = await db.execute(sql`select m.user_id from memberships m where m.org_id = ${orgId} and not exists (select 1 from business_cards b where b.org_id = m.org_id and b.user_id = m.user_id)`);
  let made = 0;
  for (const r of missing.rows as { user_id: string }[]) {
    await ensureCard(orgId, r.user_id);
    made++;
  }
  return { made };
}

/** The public card behind /id/<slug>, or null when it's off, or its workspace is closed. */
export async function publicCard(slug: string, opts: { count?: "view" | "save" } = {}) {
  const [row] = await db
    .select({ card: B, org: { name: schema.organizations.name, suspendedAt: schema.organizations.suspendedAt, deletionScheduledAt: schema.organizations.deletionScheduledAt } })
    .from(B)
    .innerJoin(schema.organizations, eq(schema.organizations.id, B.orgId))
    .innerJoin(schema.memberships, and(eq(schema.memberships.orgId, B.orgId), eq(schema.memberships.userId, B.userId)))
    .where(sql`lower(${B.slug}) = ${slug.toLowerCase()}`);
  if (!row || !row.card.published || row.org.suspendedAt) return null;
  if (opts.count === "view") await db.update(B).set({ views: sql`${B.views} + 1` }).where(eq(B.id, row.card.id));
  if (opts.count === "save") await db.update(B).set({ saves: sql`${B.saves} + 1` }).where(eq(B.id, row.card.id));
  const e = effective(row.card, await template(row.card.orgId));
  return { slug: row.card.slug, url: cardUrl(row.card.slug), workspace: row.org.name, exchange: row.card.exchange, data: e.data, style: e.style, qr: qrSvg(cardUrl(row.card.slug), { margin: 1 }) };
}

/** Someone the card's owner met sends their details back. */
export async function exchange(slug: string, raw: unknown) {
  const v = exchangeSchema.safeParse(raw);
  if (!v.success) throw issues(v.error);
  const [c] = await db.select().from(B).where(sql`lower(${B.slug}) = ${slug.toLowerCase()}`);
  if (!c || !c.published || !c.exchange) throw notFound("Business ID");
  const p = v.data;
  await db.insert(E).values({ orgId: c.orgId, cardId: c.id, name: p.name, email: p.email, phone: p.phone, company: p.company, note: p.note });
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, c.orgId));
  const owner = c.data.name || "a member";
  // In the CRM (when it's on), as a lead from this business ID.
  if (isOn(org?.modules, "crm")) {
    try {
      await capture(c.orgId, "web", { name: p.name, email: p.email, phone: p.phone, company: p.company }, { source: "business_card", event: { subject: `Shared their details from ${owner}'s business ID`, body: p.note || undefined } });
    } catch {
      // The CRM being unavailable mustn't lose the details: they're saved above.
    }
  }
  const contact = [p.email, p.phone].filter(Boolean).join(" · ");
  await notify(c.orgId, [c.userId], { kind: "card.exchange", title: `${p.name} sent you their details`, body: [p.company, contact, p.note && `“${p.note}”`].filter(Boolean).join("\n"), link: "/settings/business-id", values: { name: p.name, contact, link: "/settings/business-id" } });
  return { ok: true };
}

export async function vcardFor(slug: string) {
  return publicCard(slug, { count: "save" });
}

