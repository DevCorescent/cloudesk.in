// Contacts: the list with filters, the full profile (their deals, timeline and
// everything they've bought or booked elsewhere in Cloudesk), adding without
// duplicates, editing with a trail, bulk actions and merging.
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { contactQuerySchema, contactSchema, emailDomain, emailKey, LIFECYCLE, LIFECYCLE_LABEL, LEAD_STATUS, phoneKey, type ContactQuery, type Lifecycle } from "@/lib/crm/model";
import { check, owners, requireManage, requireMember, requireWrite, visible, type Scope } from "./access";
import { findOrCreateCompany } from "./companies";
import { linkedFor } from "./linked";
import { addEvent, rescore } from "./timeline";
import { emit } from "../hub/core";
import { contains } from "../security/like";

export type Contact = typeof schema.crmContacts.$inferSelect;
const C = schema.crmContacts;
const phoneSql = sql`right(regexp_replace(${C.phone}, '\\D', '', 'g'), 10)`;

function filters(s: Scope, q: ContactQuery): SQL {
  const parts: (SQL | undefined)[] = [eq(C.orgId, s.orgId), visible(s, C.ownerId)];
  if (q.q) {
    const t = contains(q.q);
    const digits = q.q.replace(/\D/g, "");
    parts.push(or(ilike(C.name, t), ilike(C.email, t), ilike(C.title, t), digits.length >= 4 ? sql`regexp_replace(${C.phone}, '\\D', '', 'g') like ${contains(digits)}` : undefined, sql`${C.companyId} in (select id from crm_companies where org_id = ${s.orgId} and name ilike ${t})`));
  }
  const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  if (q.lifecycle) parts.push(inArray(C.lifecycle, list(q.lifecycle)));
  if (q.leadStatus) parts.push(inArray(C.leadStatus, list(q.leadStatus)));
  if (q.owner === "me") parts.push(eq(C.ownerId, s.userId));
  else if (q.owner === "none") parts.push(sql`${C.ownerId} is null`);
  else if (/^[0-9a-f-]{36}$/.test(q.owner)) parts.push(eq(C.ownerId, q.owner));
  if (q.tag) parts.push(sql`${q.tag} = any(${C.tags})`);
  if (q.source) parts.push(eq(C.source, q.source));
  if (/^[0-9a-f-]{36}$/.test(q.companyId)) parts.push(eq(C.companyId, q.companyId));
  if (q.minScore) parts.push(sql`${C.score} >= ${q.minScore}`);
  if (q.activity === "7d") parts.push(sql`${C.lastActivityAt} > now() - interval '7 days'`);
  if (q.activity === "30d") parts.push(sql`${C.lastActivityAt} > now() - interval '30 days'`);
  if (q.activity === "stale30") parts.push(sql`(${C.lastActivityAt} is null or ${C.lastActivityAt} < now() - interval '30 days')`);
  if (q.activity === "never") parts.push(sql`${C.lastActivityAt} is null`);
  if (q.marketing === "yes") parts.push(eq(C.marketing, true));
  if (q.marketing === "no") parts.push(eq(C.marketing, false));
  return and(...parts)!;
}

export async function listContacts(s: Scope, raw: unknown) {
  const q = check(contactQuerySchema, raw);
  const where = filters(s, q);
  const col = { updated: C.updatedAt, created: C.createdAt, name: sql`lower(${C.name})`, score: C.score, activity: C.lastActivityAt }[q.sort];
  const order = q.dir === "asc" ? sql`${col} asc nulls first` : sql`${col} desc nulls last`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(C).where(where);
  const rows = await db
    .select({ c: C, company: schema.crmCompanies.name, openDeals: sql<number>`(select count(*)::int from crm_deals d where d.contact_id = ${C.id} and d.status = 'open')` })
    .from(C)
    .leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, C.companyId))
    .where(where)
    .orderBy(order, desc(C.id))
    .limit(q.per)
    .offset((q.page - 1) * q.per);
  return { total: n, page: q.page, per: q.per, contacts: rows.map((r) => ({ ...r.c, company: r.company ?? "", openDeals: r.openDeals })) };
}

/** Every matching id (for "select all N" bulk actions), capped. */
export async function contactIdsFor(s: Scope, raw: unknown, cap = 5000) {
  const q = check(contactQuerySchema, raw);
  const rows = await db.select({ id: C.id }).from(C).where(filters(s, q)).limit(cap);
  return rows.map((r) => r.id);
}

export async function requireContact(s: Scope, id: string) {
  const [c] = await db.select().from(C).where(and(eq(C.id, id), eq(C.orgId, s.orgId), visible(s, C.ownerId)));
  if (!c) throw notFound("Contact");
  return c;
}

export async function getContact(s: Scope, id: string) {
  const c = await requireContact(s, id);
  const [company, deals, activities, enrollments, linked, dupes] = await Promise.all([
    c.companyId ? db.select().from(schema.crmCompanies).where(eq(schema.crmCompanies.id, c.companyId)).then((r) => r[0] ?? null) : null,
    db
      .select({ deal: schema.crmDeals, stage: schema.crmStages.name, stageKind: schema.crmStages.kind })
      .from(schema.crmDeals)
      .innerJoin(schema.crmStages, eq(schema.crmStages.id, schema.crmDeals.stageId))
      .where(eq(schema.crmDeals.contactId, id))
      .orderBy(desc(schema.crmDeals.updatedAt)),
    db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.orgId, s.orgId), eq(schema.crmActivities.contactId, id))).orderBy(desc(sql`coalesce(${schema.crmActivities.doneAt}, ${schema.crmActivities.dueAt}, ${schema.crmActivities.createdAt})`)).limit(200),
    db
      .select({ e: schema.crmEnrollments, name: schema.crmSequences.name, steps: schema.crmSequences.steps })
      .from(schema.crmEnrollments)
      .innerJoin(schema.crmSequences, eq(schema.crmSequences.id, schema.crmEnrollments.sequenceId))
      .where(eq(schema.crmEnrollments.contactId, id)),
    linkedFor(s.orgId, c),
    duplicatesOf(s, c),
  ]);
  return {
    contact: c,
    company,
    deals: deals.map((d) => ({ ...d.deal, stage: d.stage, stageKind: d.stageKind })),
    activities,
    enrollments: enrollments.map((e) => ({ ...e.e, sequence: e.name, totalSteps: (e.steps as unknown[]).length })),
    linked,
    duplicates: dupes,
  };
}

/** Others that look like the same person: same email, same phone, or same name at the same company. */
async function duplicatesOf(s: Scope, c: Contact) {
  const pk = phoneKey(c.phone);
  const conds = [c.email ? sql`lower(${C.email}) = ${emailKey(c.email)}` : undefined, pk ? sql`${phoneSql} = ${pk}` : undefined, c.name && c.companyId ? and(sql`lower(${C.name}) = ${c.name.toLowerCase()}`, eq(C.companyId, c.companyId)) : undefined].filter(Boolean) as SQL[];
  if (!conds.length) return [];
  return db.select({ id: C.id, name: C.name, email: C.email, phone: C.phone }).from(C).where(and(eq(C.orgId, s.orgId), ne(C.id, c.id), or(...conds), visible(s, C.ownerId))).limit(10);
}

/** Finds an existing contact by email, then by phone. */
export async function findContact(orgId: string, p: { email?: string; phone?: string }) {
  const e = emailKey(p.email ?? "");
  if (e) {
    const [hit] = await db.select().from(C).where(and(eq(C.orgId, orgId), sql`lower(${C.email}) = ${e}`)).limit(1);
    if (hit) return hit;
  }
  const pk = phoneKey(p.phone ?? "");
  if (pk) {
    const [hit] = await db.select().from(C).where(and(eq(C.orgId, orgId), sql`${phoneSql} = ${pk}`)).orderBy(asc(C.createdAt)).limit(1);
    if (hit) return hit;
  }
  return null;
}

async function resolveCompany(orgId: string, input: { companyId: string | null; companyName: string; email: string; ownerId: string | null }) {
  if (input.companyId) {
    const [co] = await db.select({ id: schema.crmCompanies.id }).from(schema.crmCompanies).where(and(eq(schema.crmCompanies.id, input.companyId), eq(schema.crmCompanies.orgId, orgId)));
    if (!co) throw new ApiError("validation_failed", "That company isn't in this CRM", { companyId: ["Not found"] });
    return co.id;
  }
  if (input.companyName) return findOrCreateCompany(orgId, { name: input.companyName, ownerId: input.ownerId, create: true });
  const domain = emailDomain(input.email);
  return domain ? findOrCreateCompany(orgId, { domain }) : null;
}

export async function createContact(s: Scope, raw: unknown, opts: { allowDuplicatePhone?: boolean } = {}) {
  requireWrite(s);
  const input = check(contactSchema, raw);
  if (!input.name && !input.email && !input.phone) throw new ApiError("validation_failed", "Add a name, email or phone", { name: ["Required"] });
  const existing = await findContact(s.orgId, { email: input.email, phone: opts.allowDuplicatePhone ? "" : input.phone });
  if (existing) throw new ApiError("conflict", `${existing.name || existing.email || existing.phone} is already in your CRM`, { existingId: existing.id });
  // The plan's contact allowance (Free: 100).
  await (await import("../billing/subscriptions")).assertQuota(s.orgId, "contacts");
  if (input.ownerId) await requireMember(s.orgId, input.ownerId);
  const ownerId = input.ownerId ?? (s.userId || null);
  const companyId = await resolveCompany(s.orgId, { ...input, ownerId });
  const { companyName: _, ...values } = input;
  void _;
  const [c] = await db.insert(C).values({ orgId: s.orgId, ...values, companyId, ownerId }).returning();
  await addEvent(s.orgId, { subject: "Contact added", contactId: c.id, by: s.userId, meta: { source: c.source } });
  await rescore(s.orgId, [c.id]);
  await emit(s.orgId, "crm.contact.created", { id: c.id, name: c.name, email: c.email, phone: c.phone, source: c.source });
  return (await db.select().from(C).where(eq(C.id, c.id)))[0];
}

export async function updateContact(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const cur = await requireContact(s, id);
  const patch = (raw ?? {}) as Record<string, unknown>;
  const input = check(contactSchema, { ...cur, companyName: "", ...patch });
  if (input.email && emailKey(input.email) !== emailKey(cur.email)) {
    const other = await findContact(s.orgId, { email: input.email });
    if (other && other.id !== id) throw new ApiError("conflict", `${other.name || other.email} already has that email`, { existingId: other.id });
  }
  if (input.ownerId && input.ownerId !== cur.ownerId) await requireMember(s.orgId, input.ownerId);
  const companyId = "companyId" in patch || "companyName" in patch ? await resolveCompany(s.orgId, { companyId: input.companyId, companyName: input.companyName, email: "", ownerId: input.ownerId }) : cur.companyId;
  const { companyName: _, ...values } = input;
  void _;
  const [c] = await db.update(C).set({ ...values, companyId, updatedAt: new Date() }).where(eq(C.id, id)).returning();
  await trail(s, cur, c);
  await rescore(s.orgId, [id]);
  return (await db.select().from(C).where(eq(C.id, id)))[0];
}

/** Timeline entries for changes worth seeing later. */
async function trail(s: Scope, before: Contact, after: Contact) {
  const notes: string[] = [];
  if (before.lifecycle !== after.lifecycle) notes.push(`Stage: ${LIFECYCLE_LABEL[before.lifecycle as Lifecycle] ?? before.lifecycle} → ${LIFECYCLE_LABEL[after.lifecycle as Lifecycle] ?? after.lifecycle}`);
  if (before.ownerId !== after.ownerId) {
    const people = await owners(s.orgId);
    notes.push(`Owner: ${people.find((p) => p.id === before.ownerId)?.name ?? "nobody"} → ${people.find((p) => p.id === after.ownerId)?.name ?? "nobody"}`);
  }
  if (before.leadStatus !== after.leadStatus) notes.push(`Lead status: ${before.leadStatus} → ${after.leadStatus}`);
  if (!before.doNotContact && after.doNotContact) notes.push("Marked do not contact");
  for (const n of notes) await addEvent(s.orgId, { subject: n, contactId: after.id, by: s.userId });
}

export async function deleteContacts(s: Scope, ids: string[]) {
  requireManage(s);
  if (!ids.length) return 0;
  const rows = await db.delete(C).where(and(eq(C.orgId, s.orgId), inArray(C.id, ids))).returning({ id: C.id, name: C.name, email: C.email });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "crm.contacts.deleted", targetType: "crm_contact", targetId: rows[0]?.id, metadata: { count: rows.length, sample: rows.slice(0, 5).map((r) => r.name || r.email) } });
  return rows.length;
}

const bulkSchema = {
  owner: (v: unknown) => (v === null || typeof v === "string" ? v : undefined),
};

/** One change applied to many contacts. */
export async function bulkContacts(s: Scope, raw: { ids?: unknown; action?: unknown; value?: unknown }) {
  requireWrite(s);
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)).slice(0, 5000) : [];
  if (!ids.length) throw new ApiError("validation_failed", "Choose some contacts first");
  // Only those this person may see.
  const mine = (await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), inArray(C.id, ids), visible(s, C.ownerId)))).map((r) => r.id);
  const value = raw.value;
  const now = new Date();
  switch (raw.action) {
    case "owner": {
      const owner = bulkSchema.owner(value);
      if (owner === undefined) throw new ApiError("validation_failed", "Choose an owner");
      if (owner) await requireMember(s.orgId, owner);
      await db.update(C).set({ ownerId: owner, updatedAt: now }).where(inArray(C.id, mine));
      break;
    }
    case "lifecycle":
      if (!LIFECYCLE.includes(value as Lifecycle)) throw new ApiError("validation_failed", "Choose a stage");
      await db.update(C).set({ lifecycle: value as string, updatedAt: now }).where(inArray(C.id, mine));
      break;
    case "lead_status":
      if (!LEAD_STATUS.includes(value as (typeof LEAD_STATUS)[number])) throw new ApiError("validation_failed", "Choose a status");
      await db.update(C).set({ leadStatus: value as string, updatedAt: now }).where(inArray(C.id, mine));
      break;
    case "tag_add":
    case "tag_remove": {
      const tag = String(value ?? "").trim().slice(0, 40);
      if (!tag) throw new ApiError("validation_failed", "Type a tag");
      await db
        .update(C)
        .set({ tags: raw.action === "tag_add" ? sql`(select array(select distinct unnest(${C.tags} || array[${tag}]::text[])))` : sql`array_remove(${C.tags}, ${tag})`, updatedAt: now })
        .where(inArray(C.id, mine));
      break;
    }
    case "marketing":
      await db.update(C).set({ marketing: !!value, updatedAt: now }).where(inArray(C.id, mine));
      break;
    case "delete":
      return { count: await deleteContacts(s, mine) };
    default:
      throw new ApiError("validation_failed", "Unknown action");
  }
  await rescore(s.orgId, mine);
  return { count: mine.length };
}

/**
 * Merges others into one contact: their deals, timeline and sequence enrolments
 * move over; blank fields are filled from them; tags are combined. The others
 * are deleted.
 */
export async function mergeContacts(s: Scope, keepId: string, otherIds: string[]) {
  requireManage(s);
  const keep = await requireContact(s, keepId);
  const others = (await db.select().from(C).where(and(eq(C.orgId, s.orgId), inArray(C.id, otherIds.filter((x) => x !== keepId))))).slice(0, 20);
  if (!others.length) throw new ApiError("validation_failed", "Choose contacts to merge in");
  const fill = <K extends keyof Contact>(k: K) => (keep[k] || others.find((o) => o[k])?.[k] || keep[k]) as Contact[K];
  const order = LIFECYCLE as readonly string[];
  const lifecycle = [keep, ...others].map((x) => x.lifecycle).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
  await db.transaction(async (tx) => {
    const ids = others.map((o) => o.id);
    await tx.update(schema.crmDeals).set({ contactId: keep.id }).where(inArray(schema.crmDeals.contactId, ids));
    await tx.update(schema.crmActivities).set({ contactId: keep.id }).where(inArray(schema.crmActivities.contactId, ids));
    await tx.delete(schema.crmEnrollments).where(and(inArray(schema.crmEnrollments.contactId, ids), sql`${schema.crmEnrollments.sequenceId} in (select sequence_id from crm_enrollments where contact_id = ${keep.id})`));
    await tx.update(schema.crmEnrollments).set({ contactId: keep.id }).where(inArray(schema.crmEnrollments.contactId, ids));
    await tx.delete(C).where(inArray(C.id, ids));
    await tx
      .update(C)
      .set({
        name: fill("name"),
        email: fill("email"),
        phone: fill("phone"),
        title: fill("title"),
        companyId: fill("companyId"),
        ownerId: fill("ownerId"),
        city: fill("city"),
        country: fill("country"),
        lifecycle,
        tags: [...new Set([keep, ...others].flatMap((x) => x.tags))].slice(0, 30),
        custom: Object.assign({}, ...others.map((o) => o.custom as object), keep.custom as object),
        marketing: keep.marketing || others.some((o) => o.marketing),
        doNotContact: keep.doNotContact || others.some((o) => o.doNotContact),
        updatedAt: new Date(),
      })
      .where(eq(C.id, keep.id));
    await addEvent(s.orgId, { subject: `Merged ${others.length} duplicate${others.length === 1 ? "" : "s"}`, body: others.map((o) => o.name || o.email || o.phone).join(", "), contactId: keep.id, by: s.userId }, tx);
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "crm.contacts.merged", targetType: "crm_contact", targetId: keep.id, metadata: { merged: others.map((o) => o.id) } });
  await rescore(s.orgId, [keep.id]);
  return getContact(s, keep.id);
}

/** Groups of likely duplicates across the workspace (same email or phone). */
export async function duplicateGroups(s: Scope) {
  const rows = await db.execute<{ key: string; ids: string[] }>(sql`
    select key, array_agg(id order by created_at) as ids from (
      select id, created_at, 'e:' || lower(email) as key from crm_contacts where org_id = ${s.orgId} and email <> ''
      union all
      select id, created_at, 'p:' || right(regexp_replace(phone, '\\D', '', 'g'), 10) from crm_contacts where org_id = ${s.orgId} and length(regexp_replace(phone, '\\D', '', 'g')) >= 7
    ) k group by key having count(*) > 1 limit 100`);
  const groups = (rows as unknown as { rows?: { key: string; ids: string[] }[] }).rows ?? (rows as unknown as { key: string; ids: string[] }[]);
  const ids = [...new Set(groups.flatMap((g) => g.ids))];
  const people = ids.length ? await db.select({ id: C.id, name: C.name, email: C.email, phone: C.phone, createdAt: C.createdAt, source: C.source }).from(C).where(and(inArray(C.id, ids), visible(s, C.ownerId))) : [];
  return groups
    .map((g) => ({ key: g.key, by: g.key.startsWith("e:") ? "email" : "phone", contacts: g.ids.map((id) => people.find((p) => p.id === id)).filter(Boolean) }))
    .filter((g) => g.contacts.length > 1);
}

export async function tagsInUse(s: Scope) {
  const rows = await db.execute<{ tag: string; n: number }>(sql`select t as tag, count(*)::int as n from crm_contacts, unnest(tags) t where org_id = ${s.orgId} group by t order by n desc limit 100`);
  return ((rows as unknown as { rows?: { tag: string; n: number }[] }).rows ?? (rows as unknown as { tag: string; n: number }[])).map((r) => ({ tag: r.tag, n: Number(r.n) }));
}
