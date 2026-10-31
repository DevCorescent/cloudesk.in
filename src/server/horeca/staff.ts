// Cloudesk for Horeca: staff, PINs and approvals. Staff unlock the POS by
// tapping their name and entering their PIN; voids, big discounts, comps and
// cash pay-outs can need a manager's PIN. With no staff set up, nothing asks
// for a PIN — a one-person café isn't slowed down. Sensitive actions are
// logged in horeca_events either way.
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { APPROVER_ROLES, staffSchema, type actorSchema } from "@/lib/horeca/model";
import type { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password";
import { ApiError, notFound } from "../http/errors";
import { horecaPresence } from "../hr/time";
import { log } from "../log";
import { rateLimit } from "../security/rate-limit";
import { safeEqual } from "../security/tokens";
import { check } from "./venue";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Actor = z.infer<typeof actorSchema>;

// Unlocking hands the till a ticket for that staff member (a shift long). A manager at the till approves without
// re-entering their PIN only with it — a staff id alone (which anyone can list) proves nothing.
const TICKET_TTL_MS = 16 * 3600_000;
function ticketKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update("horeca-staff-ticket-v1").digest();
}
export function staffTicket(projectId: string, staffId: string, now = Date.now()) {
  const payload = `${staffId}.${now + TICKET_TTL_MS}`;
  return `${payload}.${createHmac("sha256", ticketKey()).update(`${projectId}.${payload}`).digest("base64url")}`;
}
function validTicket(projectId: string, staffId: string, ticket: string | null | undefined) {
  const [id, exp, sig] = (ticket ?? "").split(".");
  if (!id || !exp || !sig || id !== staffId || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, createHmac("sha256", ticketKey()).update(`${projectId}.${id}.${exp}`).digest("base64url"));
}

const view = (s: typeof schema.horecaStaff.$inferSelect) => ({ id: s.id, name: s.name, role: s.role, active: s.active, lastSeenAt: s.lastSeenAt });

export async function listStaff(projectId: string) {
  const rows = await db.select().from(schema.horecaStaff).where(eq(schema.horecaStaff.projectId, projectId)).orderBy(asc(schema.horecaStaff.name));
  return rows.map(view);
}

export async function saveStaff(projectId: string, raw: unknown, id?: string) {
  const input = check(staffSchema, raw);
  if (!id && !input.pin) throw new ApiError("validation_failed", "Set a PIN", { pin: ["Required"] });
  const pinHash = input.pin ? await hashPassword(input.pin) : undefined;
  const values = { name: input.name, role: input.role, active: input.active, ...(pinHash ? { pinHash } : {}) };
  const [r] = id
    ? await db.update(schema.horecaStaff).set(values).where(and(eq(schema.horecaStaff.id, id), eq(schema.horecaStaff.projectId, projectId))).returning()
    : await db.insert(schema.horecaStaff).values({ projectId, ...values, pinHash: pinHash! }).returning();
  if (!r) throw notFound("Staff member");
  return view(r);
}

export async function deleteStaff(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaStaff).where(and(eq(schema.horecaStaff.id, id), eq(schema.horecaStaff.projectId, projectId))).returning({ id: schema.horecaStaff.id });
  if (!rows.length) throw notFound("Staff member");
}

const hasStaff = async (projectId: string) => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.horecaStaff).where(and(eq(schema.horecaStaff.projectId, projectId), eq(schema.horecaStaff.active, true)));
  return (r?.n ?? 0) > 0;
};

/** Unlock: the staff member taps their name and enters their PIN. */
export async function unlock(projectId: string, staffId: string, pin: string) {
  await rateLimit(`horeca-pin:${projectId}:${staffId}`, 8, 5 * 60_000);
  const [s] = await db.select().from(schema.horecaStaff).where(and(eq(schema.horecaStaff.id, staffId), eq(schema.horecaStaff.projectId, projectId), eq(schema.horecaStaff.active, true)));
  if (!s || !/^\d{4,6}$/.test(pin) || !(await verifyPassword(s.pinHash, pin))) throw new ApiError("forbidden", "That PIN isn't right");
  await db.update(schema.horecaStaff).set({ lastSeenAt: new Date() }).where(eq(schema.horecaStaff.id, s.id));
  // Unlocking the till counts as being at work, for anyone linked in HR.
  await horecaPresence(projectId, s.id).catch((e) => log.warn("hr_presence_failed", { error: (e as Error).message }));
  return { ...view(s), ticket: staffTicket(projectId, s.id) };
}

/** The staff member at the till, if one unlocked it. */
export async function actorName(projectId: string, a: Actor) {
  if (!a.staffId) return "";
  const [s] = await db.select({ name: schema.horecaStaff.name }).from(schema.horecaStaff).where(and(eq(schema.horecaStaff.id, a.staffId), eq(schema.horecaStaff.projectId, projectId)));
  return s?.name ?? "";
}

/**
 * When an action needs approval: passes if no staff are set up, if the person
 * at the till is a manager (who unlocked it: their ticket), or if a manager's PIN was given. Returns who approved.
 */
export async function approve(projectId: string, a: Actor, what: string) {
  if (!(await hasStaff(projectId))) return "";
  const managers = await db.select().from(schema.horecaStaff).where(and(eq(schema.horecaStaff.projectId, projectId), eq(schema.horecaStaff.active, true), inArray(schema.horecaStaff.role, APPROVER_ROLES)));
  const me = managers.find((m) => m.id === a.staffId && validTicket(projectId, m.id, a.staffTicket));
  if (me) return me.name;
  if (!a.approvalPin) throw new ApiError("forbidden", `${what} needs a manager's PIN`, { approval: ["required"] });
  await rateLimit(`horeca-approve:${projectId}`, 12, 5 * 60_000);
  for (const m of managers) if (await verifyPassword(m.pinHash, a.approvalPin)) return m.name;
  throw new ApiError("forbidden", "That manager PIN isn't right", { approval: ["wrong"] });
}

/** Records a sensitive action for the loss-prevention report. */
export async function logEvent(e: { projectId: string; kind: string; orderId?: string | null; staffName?: string; approvedBy?: string; amount?: number; detail?: string }, tx: Tx | typeof db = db) {
  await tx.insert(schema.horecaEvents).values({ projectId: e.projectId, kind: e.kind, orderId: e.orderId ?? null, staffName: e.staffName ?? "", approvedBy: e.approvedBy ?? "", amount: e.amount ?? 0, detail: e.detail ?? "" });
}

export async function recentEvents(projectId: string, sinceDays = 7) {
  return db
    .select()
    .from(schema.horecaEvents)
    .where(and(eq(schema.horecaEvents.projectId, projectId), gte(schema.horecaEvents.createdAt, sql`now() - make_interval(days => ${sinceDays})`)))
    .orderBy(desc(schema.horecaEvents.createdAt))
    .limit(300);
}
