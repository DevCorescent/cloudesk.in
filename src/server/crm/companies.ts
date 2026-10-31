// Companies (accounts): the people who work there, their deals and the
// combined timeline.
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { notFound } from "../http/errors";
import { audit } from "../services/audit";
import { companySchema } from "@/lib/crm/model";
import { check, requireManage, requireMember, requireWrite, visible, type Scope } from "./access";
import { addEvent } from "./timeline";
import { contains } from "../security/like";

export type Company = typeof schema.crmCompanies.$inferSelect;

export async function listCompanies(s: Scope, opts: { q?: string; page?: number; per?: number } = {}) {
  const per = Math.min(200, opts.per ?? 50);
  const page = Math.max(1, opts.page ?? 1);
  const q = (opts.q ?? "").trim();
  const where = and(eq(schema.crmCompanies.orgId, s.orgId), visible(s, schema.crmCompanies.ownerId), q ? or(ilike(schema.crmCompanies.name, contains(q)), ilike(schema.crmCompanies.domain, contains(q)), ilike(schema.crmCompanies.city, contains(q))) : undefined);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmCompanies).where(where);
  const rows = await db
    .select({
      company: schema.crmCompanies,
      contacts: sql<number>`(select count(*)::int from crm_contacts c where c.company_id = crm_companies.id)`,
      openDeals: sql<number>`(select count(*)::int from crm_deals d where d.company_id = crm_companies.id and d.status = 'open')`,
      pipeline: sql<number>`(select coalesce(sum(d.value), 0)::bigint from crm_deals d where d.company_id = crm_companies.id and d.status = 'open')`,
      won: sql<number>`(select coalesce(sum(d.value), 0)::bigint from crm_deals d where d.company_id = crm_companies.id and d.status = 'won')`,
    })
    .from(schema.crmCompanies)
    .where(where)
    .orderBy(asc(sql`lower(${schema.crmCompanies.name})`))
    .limit(per)
    .offset((page - 1) * per);
  return { total: n, companies: rows.map((r) => ({ ...r.company, contacts: r.contacts, openDeals: r.openDeals, pipeline: Number(r.pipeline), won: Number(r.won) })) };
}

export async function requireCompany(s: Scope, id: string) {
  const [c] = await db.select().from(schema.crmCompanies).where(and(eq(schema.crmCompanies.id, id), eq(schema.crmCompanies.orgId, s.orgId), visible(s, schema.crmCompanies.ownerId)));
  if (!c) throw notFound("Company");
  return c;
}

export async function getCompany(s: Scope, id: string) {
  const company = await requireCompany(s, id);
  const [contacts, deals, activities] = await Promise.all([
    db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.companyId, id), visible(s, schema.crmContacts.ownerId))).orderBy(desc(schema.crmContacts.score)).limit(200),
    db
      .select({ deal: schema.crmDeals, stage: schema.crmStages.name })
      .from(schema.crmDeals)
      .innerJoin(schema.crmStages, eq(schema.crmStages.id, schema.crmDeals.stageId))
      .where(and(eq(schema.crmDeals.companyId, id), visible(s, schema.crmDeals.ownerId)))
      .orderBy(desc(schema.crmDeals.updatedAt)),
    db
      .select()
      .from(schema.crmActivities)
      .where(or(eq(schema.crmActivities.companyId, id), sql`${schema.crmActivities.contactId} in (select id from crm_contacts where company_id = ${id})`, sql`${schema.crmActivities.dealId} in (select id from crm_deals where company_id = ${id})`))
      .orderBy(desc(schema.crmActivities.createdAt))
      .limit(100),
  ]);
  return { company, contacts, deals: deals.map((d) => ({ ...d.deal, stage: d.stage })), activities };
}

export async function saveCompany(s: Scope, raw: unknown, id?: string) {
  requireWrite(s);
  const current = id ? await requireCompany(s, id) : null;
  const input = check(companySchema, { ...(current ?? {}), ...(raw as object) });
  if (input.ownerId && input.ownerId !== current?.ownerId) await requireMember(s.orgId, input.ownerId);
  if (current) {
    const [c] = await db.update(schema.crmCompanies).set({ ...input, updatedAt: new Date() }).where(eq(schema.crmCompanies.id, current.id)).returning();
    return c;
  }
  const [c] = await db.insert(schema.crmCompanies).values({ orgId: s.orgId, ...input, ownerId: input.ownerId ?? (s.userId || null) }).returning();
  await addEvent(s.orgId, { subject: "Company added", companyId: c.id, by: s.userId });
  // People whose work email matches the company's domain join it.
  if (c.domain) await db.update(schema.crmContacts).set({ companyId: c.id }).where(and(eq(schema.crmContacts.orgId, s.orgId), sql`${schema.crmContacts.companyId} is null`, sql`lower(split_part(${schema.crmContacts.email}, '@', 2)) = ${c.domain}`));
  return c;
}

export async function deleteCompany(s: Scope, id: string) {
  requireManage(s);
  const c = await requireCompany(s, id);
  await db.delete(schema.crmCompanies).where(eq(schema.crmCompanies.id, c.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "crm.company.deleted", targetType: "crm_company", targetId: id, metadata: { name: c.name } });
}

/** Finds a company by name (or the domain of a work email), creating it if asked. */
export async function findOrCreateCompany(orgId: string, opts: { name?: string; domain?: string; ownerId?: string | null; create?: boolean }) {
  const name = (opts.name ?? "").trim();
  const domain = (opts.domain ?? "").trim().toLowerCase();
  if (!name && !domain) return null;
  const [hit] = await db
    .select({ id: schema.crmCompanies.id })
    .from(schema.crmCompanies)
    .where(and(eq(schema.crmCompanies.orgId, orgId), or(name ? sql`lower(${schema.crmCompanies.name}) = ${name.toLowerCase()}` : sql`false`, domain ? eq(schema.crmCompanies.domain, domain) : sql`false`)))
    .limit(1);
  if (hit) return hit.id;
  if (!opts.create || !name) return null;
  const [c] = await db.insert(schema.crmCompanies).values({ orgId, name: name.slice(0, 160), domain, ownerId: opts.ownerId ?? null }).returning({ id: schema.crmCompanies.id });
  return c.id;
}

export async function companyNames(orgId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: schema.crmCompanies.id, name: schema.crmCompanies.name }).from(schema.crmCompanies).where(inArray(schema.crmCompanies.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
