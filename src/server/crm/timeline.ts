// System entries on the timeline (created, stage moved, owner changed…), the
// "last activity" stamp, and lead scores — kept apart so every CRM module can
// use them without importing each other.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeScore, type ScoreRule } from "@/lib/crm/model";
import { getSettings } from "./access";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function addEvent(orgId: string, e: { subject: string; body?: string; contactId?: string | null; companyId?: string | null; dealId?: string | null; by?: string | null; meta?: Record<string, unknown> }, tx: Tx | typeof db = db) {
  await tx.insert(schema.crmActivities).values({
    orgId,
    kind: "event",
    subject: e.subject.slice(0, 200),
    body: (e.body ?? "").slice(0, 2000),
    contactId: e.contactId ?? null,
    companyId: e.companyId ?? null,
    dealId: e.dealId ?? null,
    createdBy: e.by || null,
    ownerId: e.by || null,
    doneAt: new Date(),
    meta: e.meta ?? {},
  });
}

export async function touch(contactIds: (string | null | undefined)[]) {
  const ids = [...new Set(contactIds.filter((x): x is string => !!x))];
  if (ids.length) await db.update(schema.crmContacts).set({ lastActivityAt: new Date() }).where(inArray(schema.crmContacts.id, ids));
}

/** Recomputes lead scores from the workspace's rules. */
export async function rescore(orgId: string, contactIds: string[]) {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!ids.length) return;
  const rules: ScoreRule[] = (await getSettings(orgId)).settings.scoring;
  const contacts = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, orgId), inArray(schema.crmContacts.id, ids)));
  const acts = await db
    .select({ id: schema.crmActivities.contactId, n: sql<number>`count(*)::int`, recent: sql<boolean>`bool_or(${schema.crmActivities.createdAt} > now() - interval '7 days')` })
    .from(schema.crmActivities)
    .where(and(inArray(schema.crmActivities.contactId, ids), ne(schema.crmActivities.kind, "event"), sql`${schema.crmActivities.createdAt} > now() - interval '30 days'`, sql`(${schema.crmActivities.kind} <> 'task' or ${schema.crmActivities.doneAt} is not null)`))
    .groupBy(schema.crmActivities.contactId);
  const deals = await db
    .select({ id: schema.crmDeals.contactId, open: sql<number>`count(*) filter (where ${schema.crmDeals.status} = 'open')::int`, won: sql<number>`count(*) filter (where ${schema.crmDeals.status} = 'won')::int` })
    .from(schema.crmDeals)
    .where(inArray(schema.crmDeals.contactId, ids))
    .groupBy(schema.crmDeals.contactId);
  for (const c of contacts) {
    const a = acts.find((x) => x.id === c.id);
    const d = deals.find((x) => x.id === c.id);
    const score = computeScore(rules, { email: c.email, phone: c.phone, companyId: c.companyId, title: c.title, marketing: c.marketing, source: c.source, tags: c.tags, lifecycle: c.lifecycle, activities30: a?.n ?? 0, recentActivity: !!a?.recent, openDeals: d?.open ?? 0, wonDeals: d?.won ?? 0 });
    if (score !== c.score) await db.update(schema.crmContacts).set({ score }).where(eq(schema.crmContacts.id, c.id));
  }
}

/** All contacts in a workspace, in batches (after the rules change). */
export async function rescoreAll(orgId: string) {
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = await db.select({ id: schema.crmContacts.id }).from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, orgId), sql`${schema.crmContacts.id} > ${last}`)).orderBy(schema.crmContacts.id).limit(500);
    if (!rows.length) break;
    await rescore(orgId, rows.map((r) => r.id));
    last = rows[rows.length - 1].id;
  }
}

