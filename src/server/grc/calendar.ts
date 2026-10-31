// The compliance calendar: obligations that repeat (GST returns, TDS, PF,
// ROC filings…), each due date kept as a filing to mark done (with the
// acknowledgement or challan number) or waived. Due dates are laid out a year
// ahead; owners are reminded a few days before and again if one goes overdue.
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { INDIA_PACK, obligationSchema, occurrences, recurrenceSchema } from "@/lib/grc/model";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { notify } from "../notify/notify";
import { check, members, requireMember, requirePart, requireRegisters, requireWrite, todayIst, type Scope } from "./access";

const O = schema.grcObligations;
const F = schema.grcFilings;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Lay out an obligation's due dates from the day it was added (or 90 days back, whichever is later) to a year ahead; existing ones are kept. */
async function layOut(o: typeof O.$inferSelect, today = todayIst()) {
  const r = recurrenceSchema.safeParse(o.recurrence);
  if (!r.success || !o.active) return;
  // Past dates from before it was added would only show as "overdue" things that were very likely filed.
  const added = new Date(o.createdAt.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const from = [addDays(today, -90), added].sort().at(-1)!;
  const due = occurrences(r.data, from, addDays(today, 365));
  if (due.length) await db.insert(F).values(due.map((d) => ({ orgId: o.orgId, obligationId: o.id, period: d.period, label: d.label, dueDate: d.due }))).onConflictDoNothing();
}

export async function obligations(s: Scope) {
  requireRegisters(s);
  requirePart(s, "calendar");
  return db.select().from(O).where(eq(O.orgId, s.orgId)).orderBy(asc(O.title));
}

export async function saveObligation(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "calendar");
  const v = check(obligationSchema, raw);
  await requireMember(s.orgId, v.ownerId);
  let o: typeof O.$inferSelect;
  if (id) {
    if (!isId(id)) throw notFound("Obligation");
    const [r] = await db.update(O).set(v).where(and(eq(O.id, id), eq(O.orgId, s.orgId))).returning();
    if (!r) throw notFound("Obligation");
    o = r;
    // A changed schedule: future filings not yet done are re-laid out.
    await db.delete(F).where(and(eq(F.obligationId, o.id), eq(F.status, "pending"), gte(F.dueDate, todayIst())));
  } else [o] = await db.insert(O).values({ ...v, orgId: s.orgId }).returning();
  await layOut(o);
  return o;
}

export async function deleteObligation(s: Scope, id: string) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Obligation");
  await db.delete(O).where(and(eq(O.id, id), eq(O.orgId, s.orgId)));
}

/** Add the Indian statutory pack (those not already added), owned by the person adding it. */
export async function addPack(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "calendar");
  const { keys } = check(z.object({ keys: z.array(z.string().max(30)).max(INDIA_PACK.length).optional() }), raw);
  const have = new Set((await db.select({ k: O.packKey }).from(O).where(eq(O.orgId, s.orgId))).map((r) => r.k));
  const add = INDIA_PACK.filter((p) => (!keys || keys.includes(p.key)) && !have.has(p.key));
  for (const p of add) {
    const [o] = await db.insert(O).values({ orgId: s.orgId, title: p.title, authority: p.authority, category: p.category, recurrence: p.recurrence, notes: p.notes, ownerId: s.userId, packKey: p.key }).returning();
    await layOut(o);
  }
  return { added: add.length };
}

/** Filings in a window (default: 30 days back to 60 ahead), overdue first. */
export async function filings(s: Scope, q: { from?: string; to?: string; status?: string } = {}) {
  requireRegisters(s);
  requirePart(s, "calendar");
  const today = todayIst();
  for (const o of await db.select().from(O).where(and(eq(O.orgId, s.orgId), eq(O.active, true)))) await layOut(o, today);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = q.from && day.test(q.from) ? q.from : addDays(today, -30);
  const to = q.to && day.test(q.to) ? q.to : addDays(today, 60);
  const rows = await db
    .select({ f: F, title: O.title, authority: O.authority, category: O.category, ownerId: O.ownerId, owner: schema.users.name })
    .from(F)
    .innerJoin(O, eq(O.id, F.obligationId))
    .leftJoin(schema.users, eq(schema.users.id, O.ownerId))
    // "pending": everything still to do up to the window's end, however overdue; otherwise the window.
    .where(and(eq(F.orgId, s.orgId), q.status === "pending" ? and(eq(F.status, "pending"), lte(F.dueDate, to)) : and(gte(F.dueDate, from), lte(F.dueDate, to))))
    .orderBy(asc(F.dueDate));
  return rows.map(({ f, ...o }) => ({ ...f, ...o, dueDate: String(f.dueDate), overdue: f.status === "pending" && String(f.dueDate) < today, dueSoon: f.status === "pending" && String(f.dueDate) >= today && String(f.dueDate) <= addDays(today, 7) }));
}

const markSchema = z.object({ status: z.enum(["done", "waived", "pending"]), reference: z.string().trim().max(120).default(""), note: z.string().trim().max(1000).default(""), documentId: z.uuid().nullable().default(null) });

/** Mark a filing done (with its reference), waived (with a reason), or back to pending. */
export async function markFiling(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Filing");
  const v = check(markSchema, raw);
  if (v.status === "waived" && !v.note) throw new ApiError("validation_failed", "Say why it doesn't apply", { note: ["Required"] });
  if (v.documentId) {
    const [d] = await db.select({ id: schema.docFiles.id }).from(schema.docFiles).where(and(eq(schema.docFiles.id, v.documentId), eq(schema.docFiles.orgId, s.orgId)));
    if (!d) throw notFound("Document");
  }
  const [r] = await db.update(F).set({ ...v, doneAt: v.status === "pending" ? null : new Date(), doneBy: v.status === "pending" ? null : s.userId }).where(and(eq(F.id, id), eq(F.orgId, s.orgId))).returning();
  if (!r) throw notFound("Filing");
  return r;
}

/** Remind owners of filings coming due, and again once if one goes overdue. */
export async function remind(now = new Date()) {
  const today = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ f: F, o: O })
    .from(F)
    .innerJoin(O, eq(O.id, F.obligationId))
    .where(and(eq(F.status, "pending"), eq(O.active, true), lte(F.dueDate, addDays(today, 60)), or(isNull(F.remindedAt), sql`${F.remindedAt} < (${F.dueDate}::timestamp + interval '1 day')`)!));
  let sent = 0;
  const admins = new Map<string, string[]>();
  for (const { f, o } of rows) {
    const due = String(f.dueDate);
    const before = !f.remindedAt && today >= addDays(due, -o.remindDays) && today <= due;
    const late = today > due && (!f.remindedAt || f.remindedAt.getTime() < Date.parse(`${due}T23:59:59+05:30`));
    if (!before && !late) continue;
    let to = o.ownerId ? [o.ownerId] : admins.get(o.orgId);
    if (!to) {
      to = (await members(o.orgId)).filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.id);
      admins.set(o.orgId, to);
    }
    await notify(o.orgId, to, { kind: "grc.due", title: late ? `Overdue: ${o.title} (${f.label}) was due ${due}` : `${o.title} (${f.label}) is due ${due}`, link: "/compliance/calendar", values: { title: o.title, period: f.label, due, link: "/compliance/calendar" } }).catch((e) => log.warn("grc.remind_failed", { err: String(e) }));
    await db.update(F).set({ remindedAt: now }).where(eq(F.id, f.id));
    sent++;
  }
  return sent;
}

export async function calendarSummary(s: Scope) {
  const today = todayIst();
  const [r] = await db
    .select({ overdue: sql<number>`count(*) filter (where ${F.dueDate} < ${today}::date)::int`, week: sql<number>`count(*) filter (where ${F.dueDate} >= ${today}::date and ${F.dueDate} <= ${addDays(today, 7)}::date)::int` })
    .from(F)
    .where(and(eq(F.orgId, s.orgId), eq(F.status, "pending"), inArray(F.obligationId, db.select({ id: O.id }).from(O).where(eq(O.active, true)))));
  return r;
}
