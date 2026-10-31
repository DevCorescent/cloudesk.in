// Getting data in and out: importing contacts from a spreadsheet (matched by
// email or phone, so re-importing updates instead of duplicating), CSV export,
// custom fields and saved views.
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { csvEscape } from "@/lib/data/model";
import { contactQuerySchema, contactSchema, ENTITIES, fieldKey, fieldSchema, LIFECYCLE, LIFECYCLE_LABEL, SOURCE_LABEL, type Lifecycle } from "@/lib/crm/model";
import { check, owners, requireManage, requireMember, requireWrite, visible, type Scope } from "./access";
import { findOrCreateCompany } from "./companies";
import { contactIdsFor, findContact } from "./contacts";
import { addEvent, rescore } from "./timeline";

const importSchema = z.object({
  rows: z.array(z.record(z.string().max(60), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]))).min(1).max(2000),
  update: z.boolean().default(true),
  ownerId: z.uuid().nullable().default(null),
  lifecycle: z.enum(LIFECYCLE).default("lead"),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

/** Rows already mapped to contact fields by the import screen (custom fields as custom.<key>). */
export async function importContacts(s: Scope, raw: unknown) {
  requireWrite(s);
  const input = check(importSchema, raw);
  if (input.ownerId) await requireMember(s.orgId, input.ownerId);
  const known = new Set((await db.select({ key: schema.crmFields.key }).from(schema.crmFields).where(and(eq(schema.crmFields.orgId, s.orgId), eq(schema.crmFields.entity, "contact")))).map((f) => f.key));
  const result = { created: 0, updated: 0, skipped: [] as { row: number; reason: string }[] };
  const touched: string[] = [];
  const companies = new Map<string, string | null>();
  for (const [i, r] of input.rows.entries()) {
    const str = (k: string) => (r[k] === null || r[k] === undefined ? "" : String(r[k]).trim());
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) if (k.startsWith("custom.") && known.has(k.slice(7)) && v !== null && v !== "") custom[k.slice(7)] = String(v).slice(0, 2000);
    const life = str("lifecycle").toLowerCase();
    const lifecycle = (LIFECYCLE as readonly string[]).includes(life) ? (life as Lifecycle) : (Object.entries(LIFECYCLE_LABEL).find(([, l]) => l.toLowerCase() === life)?.[0] as Lifecycle | undefined) ?? input.lifecycle;
    const v = contactSchema.safeParse({
      name: str("name") || [str("first_name"), str("last_name")].filter(Boolean).join(" "),
      email: str("email"),
      phone: str("phone"),
      title: str("title"),
      city: str("city"),
      country: str("country"),
      lifecycle,
      source: str("source").toLowerCase().replace(/\s+/g, "_") || "import",
      tags: [...input.tags, ...str("tags").split(/[,;|]/).map((t) => t.trim()).filter(Boolean)].slice(0, 30),
      marketing: /^(y|yes|true|1)$/i.test(str("marketing")),
      custom,
    });
    if (!v.success) {
      result.skipped.push({ row: i + 1, reason: v.error.issues[0]?.message ?? "Invalid" });
      continue;
    }
    const c = v.data;
    if (!c.name && !c.email && !c.phone) {
      result.skipped.push({ row: i + 1, reason: "No name, email or phone" });
      continue;
    }
    const company = str("company");
    if (company && !companies.has(company.toLowerCase())) companies.set(company.toLowerCase(), await findOrCreateCompany(s.orgId, { name: company, ownerId: input.ownerId ?? s.userId, create: true }));
    const companyId = company ? (companies.get(company.toLowerCase()) ?? null) : null;
    const existing = await findContact(s.orgId, { email: c.email, phone: c.phone });
    const { companyName: _, ...values } = c;
    void _;
    if (existing) {
      if (!input.update) {
        result.skipped.push({ row: i + 1, reason: `Already in the CRM (${existing.name || existing.email || existing.phone})` });
        continue;
      }
      // Fill in what's blank; tags are added; nothing typed by hand is overwritten.
      await db
        .update(schema.crmContacts)
        .set({
          name: existing.name || c.name,
          email: existing.email || c.email,
          phone: existing.phone || c.phone,
          title: existing.title || c.title,
          city: existing.city || c.city,
          country: existing.country || c.country,
          companyId: existing.companyId ?? companyId,
          tags: [...new Set([...existing.tags, ...c.tags])].slice(0, 30),
          custom: { ...custom, ...(existing.custom as object) },
          updatedAt: new Date(),
        })
        .where(eq(schema.crmContacts.id, existing.id));
      result.updated++;
      touched.push(existing.id);
    } else {
      // New contacts stop at the plan's allowance; the rest of the file is reported, not lost silently.
      try {
        await (await import("../billing/subscriptions")).assertQuota(s.orgId, "contacts");
      } catch (e) {
        result.skipped.push({ row: i + 1, reason: e instanceof Error ? e.message : "Over the plan's contact allowance" });
        continue;
      }
      const [row] = await db.insert(schema.crmContacts).values({ orgId: s.orgId, ...values, companyId, ownerId: input.ownerId ?? s.userId }).onConflictDoNothing().returning({ id: schema.crmContacts.id });
      if (!row) {
        result.skipped.push({ row: i + 1, reason: "Duplicate email in the file" });
        continue;
      }
      result.created++;
      touched.push(row.id);
    }
  }
  for (let i = 0; i < touched.length; i += 500) await rescore(s.orgId, touched.slice(i, i + 500));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "crm.contacts.imported", targetType: "crm_contact", metadata: { created: result.created, updated: result.updated, skipped: result.skipped.length } });
  if (touched.length) await addEvent(s.orgId, { subject: `Imported ${result.created} new and updated ${result.updated} contacts`, by: s.userId, contactId: touched[0] });
  return result;
}

export async function exportContacts(s: Scope, raw: unknown) {
  const ids = await contactIdsFor(s, check(contactQuerySchema, { ...(raw as object), page: 1, per: 200 }), 20000);
  const people = await owners(s.orgId);
  const fields = await db.select().from(schema.crmFields).where(and(eq(schema.crmFields.orgId, s.orgId), eq(schema.crmFields.entity, "contact"))).orderBy(asc(schema.crmFields.sort));
  const head = ["Name", "Email", "Phone", "Title", "Company", "Lifecycle", "Lead status", "Source", "Score", "Owner", "Tags", "City", "Country", "Marketing", "Do not contact", "Last activity", "Created", ...fields.map((f) => f.label)];
  const lines = [head.map(csvEscape).join(",")];
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db.select({ c: schema.crmContacts, company: schema.crmCompanies.name }).from(schema.crmContacts).leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, schema.crmContacts.companyId)).where(inArray(schema.crmContacts.id, ids.slice(i, i + 1000)));
    for (const { c, company } of rows) {
      const cu = c.custom as Record<string, unknown>;
      lines.push(
        [c.name, c.email, c.phone, c.title, company ?? "", LIFECYCLE_LABEL[c.lifecycle as Lifecycle] ?? c.lifecycle, c.leadStatus, SOURCE_LABEL[c.source] ?? c.source, c.score, people.find((p) => p.id === c.ownerId)?.name ?? "", c.tags.join("; "), c.city, c.country, c.marketing ? "yes" : "no", c.doNotContact ? "yes" : "no", c.lastActivityAt?.toISOString() ?? "", c.createdAt.toISOString(), ...fields.map((f) => cu?.[f.key] ?? "")]
          .map(csvEscape)
          .join(","),
      );
    }
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "crm.contacts.exported", targetType: "crm_contact", metadata: { count: ids.length } });
  return lines.join("\n");
}

export async function exportDeals(s: Scope) {
  const people = await owners(s.orgId);
  const rows = await db
    .select({ d: schema.crmDeals, stage: schema.crmStages.name, pipeline: schema.crmPipelines.name, contact: schema.crmContacts.name, company: schema.crmCompanies.name })
    .from(schema.crmDeals)
    .innerJoin(schema.crmStages, eq(schema.crmStages.id, schema.crmDeals.stageId))
    .innerJoin(schema.crmPipelines, eq(schema.crmPipelines.id, schema.crmDeals.pipelineId))
    .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.crmDeals.contactId))
    .leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, schema.crmDeals.companyId))
    .where(and(eq(schema.crmDeals.orgId, s.orgId), visible(s, schema.crmDeals.ownerId)))
    .limit(20000);
  const head = ["Deal", "Value", "Currency", "Pipeline", "Stage", "Status", "Lost reason", "Contact", "Company", "Owner", "Expected close", "Closed", "Created"];
  return [head, ...rows.map(({ d, stage, pipeline, contact, company }) => [d.title, (d.value / 100).toFixed(2), d.currency, pipeline, stage, d.status, d.lostReason, contact ?? "", company ?? "", people.find((p) => p.id === d.ownerId)?.name ?? "", d.expectedClose ?? "", d.closedAt?.toISOString() ?? "", d.createdAt.toISOString()])].map((r) => r.map(csvEscape).join(",")).join("\n");
}

// ─── Custom fields ───

export async function saveField(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const input = check(fieldSchema, raw);
  if (input.type === "select" && !input.options.length) throw new ApiError("validation_failed", "Add the choices for this list", { options: ["Required"] });
  if (id) {
    const [f] = await db.update(schema.crmFields).set({ label: input.label, type: input.type, options: input.options }).where(and(eq(schema.crmFields.id, id), eq(schema.crmFields.orgId, s.orgId))).returning();
    if (!f) throw notFound("Field");
    return f;
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmFields).where(and(eq(schema.crmFields.orgId, s.orgId), eq(schema.crmFields.entity, input.entity)));
  if (n >= 50) throw new ApiError("validation_failed", "Up to 50 fields each for contacts, companies and deals");
  let key = fieldKey(input.label);
  const taken = new Set((await db.select({ key: schema.crmFields.key }).from(schema.crmFields).where(and(eq(schema.crmFields.orgId, s.orgId), eq(schema.crmFields.entity, input.entity)))).map((f) => f.key));
  for (let i = 2; taken.has(key); i++) key = `${fieldKey(input.label).slice(0, 36)}_${i}`;
  const [f] = await db.insert(schema.crmFields).values({ orgId: s.orgId, ...input, key, sort: n }).returning();
  return f;
}

export async function deleteField(s: Scope, id: string) {
  requireManage(s);
  const r = await db.delete(schema.crmFields).where(and(eq(schema.crmFields.id, id), eq(schema.crmFields.orgId, s.orgId))).returning();
  if (!r.length) throw notFound("Field");
}

// ─── Saved views ───

const viewSchema = z.object({ entity: z.enum(ENTITIES), name: z.string().trim().min(1, "Name the view").max(60), query: z.record(z.string().max(40), z.union([z.string().max(200), z.number()])), shared: z.boolean().default(false) });

export async function views(s: Scope, entity: string) {
  return db
    .select()
    .from(schema.crmViews)
    .where(and(eq(schema.crmViews.orgId, s.orgId), eq(schema.crmViews.entity, entity), or(sql`${schema.crmViews.userId} is null`, eq(schema.crmViews.userId, s.userId))))
    .orderBy(asc(schema.crmViews.createdAt));
}

export async function saveView(s: Scope, raw: unknown) {
  const input = check(viewSchema, raw);
  if (input.shared) requireManage(s);
  const [v] = await db.insert(schema.crmViews).values({ orgId: s.orgId, userId: input.shared ? null : s.userId, entity: input.entity, name: input.name, query: input.query }).returning();
  return v;
}

export async function deleteView(s: Scope, id: string) {
  const [v] = await db.select().from(schema.crmViews).where(and(eq(schema.crmViews.id, id), eq(schema.crmViews.orgId, s.orgId)));
  if (!v) throw notFound("View");
  if (v.userId !== s.userId) requireManage(s);
  await db.delete(schema.crmViews).where(eq(schema.crmViews.id, id));
}
