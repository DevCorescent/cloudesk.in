// Sequences: follow-ups spaced over days. Each enrolled contact moves through
// the steps in the background queue — an email goes out (through the
// workspace's mail setup) or a task lands on the owner's list. Unsubscribing,
// "do not contact" or winning a deal stops it.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { defineJob, enqueue } from "../jobs/queue";
import { log } from "../log";
import { sequenceSchema, SEQUENCE_STEP } from "@/lib/crm/model";
import type { z } from "zod";
import { check, requireManage, requireWrite, systemScope, visible, type Scope } from "./access";
import { emailContact } from "./activities";
import { addEvent } from "./timeline";

type Step = z.infer<typeof SEQUENCE_STEP>;
const DAY = 86400_000;

export async function listSequences(s: Scope) {
  const rows = await db
    .select({
      q: schema.crmSequences,
      active: sql<number>`(select count(*)::int from crm_enrollments e where e.sequence_id = crm_sequences.id and e.status = 'active')`,
      finished: sql<number>`(select count(*)::int from crm_enrollments e where e.sequence_id = crm_sequences.id and e.status = 'finished')`,
      stopped: sql<number>`(select count(*)::int from crm_enrollments e where e.sequence_id = crm_sequences.id and e.status = 'stopped')`,
      sent: sql<number>`(select count(*)::int from crm_activities a where a.org_id = ${s.orgId} and a.kind = 'email' and a.meta->>'sequence' = crm_sequences.id::text)`,
    })
    .from(schema.crmSequences)
    .where(eq(schema.crmSequences.orgId, s.orgId))
    .orderBy(desc(schema.crmSequences.createdAt));
  return rows.map((r) => ({ ...r.q, steps: r.q.steps as Step[], counts: { active: r.active, finished: r.finished, stopped: r.stopped, sent: r.sent } }));
}

async function requireSequence(s: Scope, id: string) {
  const [q] = await db.select().from(schema.crmSequences).where(and(eq(schema.crmSequences.id, id), eq(schema.crmSequences.orgId, s.orgId)));
  if (!q) throw notFound("Sequence");
  return q;
}

export async function getSequence(s: Scope, id: string) {
  const q = await requireSequence(s, id);
  const enrolled = await db
    .select({ e: schema.crmEnrollments, name: schema.crmContacts.name, email: schema.crmContacts.email })
    .from(schema.crmEnrollments)
    .innerJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.crmEnrollments.contactId))
    .where(and(eq(schema.crmEnrollments.sequenceId, id), visible(s, schema.crmContacts.ownerId)))
    .orderBy(asc(schema.crmEnrollments.status), desc(schema.crmEnrollments.createdAt))
    .limit(500);
  return { sequence: { ...q, steps: q.steps as Step[] }, enrolled: enrolled.map((r) => ({ ...r.e, name: r.name, email: r.email })) };
}

export async function saveSequence(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const input = check(sequenceSchema, raw);
  for (const [i, st] of input.steps.entries()) {
    if (st.kind === "email" && (!st.subject || !st.body)) throw new ApiError("validation_failed", `Step ${i + 1}: add the email's subject and message`);
    if (st.kind === "task" && !st.subject) throw new ApiError("validation_failed", `Step ${i + 1}: say what the task is`);
  }
  if (id) {
    await requireSequence(s, id);
    const [q] = await db.update(schema.crmSequences).set(input).where(eq(schema.crmSequences.id, id)).returning();
    return q;
  }
  const [q] = await db.insert(schema.crmSequences).values({ orgId: s.orgId, ...input, createdBy: s.userId }).returning();
  return q;
}

export async function deleteSequence(s: Scope, id: string) {
  requireManage(s);
  await requireSequence(s, id);
  await db.delete(schema.crmSequences).where(eq(schema.crmSequences.id, id));
}

/** Puts contacts into a sequence. Those already in it, without an email (for email steps) or marked do-not-contact are skipped. */
export async function enroll(s: Scope, sequenceId: string, contactIds: string[]) {
  requireWrite(s);
  const q = await requireSequence(s, sequenceId);
  if (!q.active) throw new ApiError("conflict", "Turn this sequence on first");
  const steps = q.steps as Step[];
  const needsEmail = steps.some((x) => x.kind === "email");
  const people = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, s.orgId), inArray(schema.crmContacts.id, contactIds.slice(0, 2000)), visible(s, schema.crmContacts.ownerId)));
  const skipped: { id: string; name: string; why: string }[] = [];
  let added = 0;
  for (const c of people) {
    if (c.doNotContact) skipped.push({ id: c.id, name: c.name || c.email, why: "Do not contact" });
    else if (needsEmail && !c.email) skipped.push({ id: c.id, name: c.name || c.phone, why: "No email" });
    else {
      const nextAt = new Date(Date.now() + steps[0].delayDays * DAY);
      const [e] = await db.insert(schema.crmEnrollments).values({ orgId: s.orgId, sequenceId, contactId: c.id, nextAt, enrolledBy: s.userId || null }).onConflictDoNothing().returning();
      if (!e) {
        skipped.push({ id: c.id, name: c.name || c.email, why: "Already in it" });
        continue;
      }
      added++;
      await addEvent(s.orgId, { subject: `Added to sequence “${q.name}”`, contactId: c.id, by: s.userId });
      await schedule(e.id, 0, nextAt, s.orgId);
    }
  }
  return { added, skipped };
}

export async function stopEnrollment(s: Scope, enrollmentId: string, reason = "Stopped by hand") {
  requireWrite(s);
  const [e] = await db.select().from(schema.crmEnrollments).where(and(eq(schema.crmEnrollments.id, enrollmentId), eq(schema.crmEnrollments.orgId, s.orgId)));
  if (!e) throw notFound("Enrolment");
  await db.update(schema.crmEnrollments).set({ status: "stopped", stopReason: reason, nextAt: null }).where(eq(schema.crmEnrollments.id, e.id));
}

async function schedule(enrollmentId: string, step: number, at: Date, orgId: string) {
  await enqueue("crm.sequence.step", { enrollmentId, step }, { runAt: at, dedupeKey: `crm-seq:${enrollmentId}:${step}`, orgId, maxAttempts: 3 });
}

/** Runs one step for one enrolment, then schedules the next. */
export async function runStep(enrollmentId: string, step: number) {
  const [e] = await db.select().from(schema.crmEnrollments).where(eq(schema.crmEnrollments.id, enrollmentId));
  if (!e || e.status !== "active" || e.step !== step) return "skipped";
  const [q] = await db.select().from(schema.crmSequences).where(eq(schema.crmSequences.id, e.sequenceId));
  const [c] = await db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, e.contactId));
  const stop = async (reason: string) => {
    await db.update(schema.crmEnrollments).set({ status: "stopped", stopReason: reason, nextAt: null }).where(eq(schema.crmEnrollments.id, e.id));
    return "stopped";
  };
  if (!q || !c) return stop("Removed");
  if (!q.active) return stop("Sequence turned off");
  if (c.doNotContact) return stop("Do not contact");
  const steps = q.steps as Step[];
  const st = steps[step];
  if (!st) return stop("Steps changed");
  const s = await systemScope(e.orgId);
  if (st.kind === "email") {
    try {
      await emailContact(s, c.id, { subject: st.subject, body: st.body, sequence: q.id });
    } catch (err) {
      log.warn("crm_sequence_email_failed", { enrollmentId, error: (err as Error).message });
      return stop((err as Error).message.slice(0, 120));
    }
  } else {
    await db.insert(schema.crmActivities).values({ orgId: e.orgId, kind: "task", subject: st.subject, body: st.body, contactId: c.id, ownerId: c.ownerId ?? e.enrolledBy, dueAt: new Date(), meta: { sequence: q.id } });
  }
  const next = step + 1;
  if (next >= steps.length) {
    await db.update(schema.crmEnrollments).set({ step: next, status: "finished", nextAt: null }).where(eq(schema.crmEnrollments.id, e.id));
    await addEvent(e.orgId, { subject: `Finished sequence “${q.name}”`, contactId: c.id });
    return "finished";
  }
  const at = new Date(Date.now() + steps[next].delayDays * DAY);
  await db.update(schema.crmEnrollments).set({ step: next, nextAt: at }).where(eq(schema.crmEnrollments.id, e.id));
  await schedule(e.id, next, at, e.orgId);
  return "next";
}

defineJob<{ enrollmentId: string; step: number }>("crm.sequence.step", ({ enrollmentId, step }) => runStep(enrollmentId, step), { timeoutMs: 30_000 });
