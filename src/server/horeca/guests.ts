// Cloudesk for Horeca: regulars — found by phone number, with visits, spend,
// loyalty points and feedback. Points are earned once, when a bill is paid,
// and can be spent as a payment method.
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { guestSchema } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { captureGuest, safely } from "../crm/capture";
import { check, requireVenue, settingsOf } from "./venue";
import { contains } from "../security/like";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Keeps the last 10 digits, so "+91 98200 11223" and "9820011223" are the same guest. */
export const normalPhone = (p: string) => p.replace(/\D/g, "").slice(-10);

export async function listGuests(projectId: string, q = "") {
  const term = q.trim();
  const digits = normalPhone(term);
  return db
    .select()
    .from(schema.horecaGuests)
    .where(and(eq(schema.horecaGuests.projectId, projectId), term ? or(ilike(schema.horecaGuests.name, contains(term)), digits.length >= 3 ? ilike(schema.horecaGuests.phone, contains(digits)) : sql`false`) : sql`true`))
    .orderBy(desc(schema.horecaGuests.lastVisitAt), asc(schema.horecaGuests.name))
    .limit(200);
}

export async function saveGuest(projectId: string, raw: unknown, id?: string) {
  const input = check(guestSchema, raw);
  const phone = normalPhone(input.phone);
  if (phone.length < 7) throw new ApiError("validation_failed", "Add a phone number", { phone: ["Too short"] });
  const values = { ...input, phone };
  try {
    const [r] = id
      ? await db.update(schema.horecaGuests).set(values).where(and(eq(schema.horecaGuests.id, id), eq(schema.horecaGuests.projectId, projectId))).returning()
      : await db.insert(schema.horecaGuests).values({ projectId, ...values }).returning();
    if (!r) throw notFound("Guest");
    await safely(captureGuest(projectId, { name: r.name, phone: r.phone, email: r.email }));
    return r;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ApiError("conflict", "A guest with that phone number already exists");
    throw e;
  }
}

export async function guestView(projectId: string, id: string) {
  const [g] = await db.select().from(schema.horecaGuests).where(and(eq(schema.horecaGuests.id, id), eq(schema.horecaGuests.projectId, projectId)));
  if (!g) throw notFound("Guest");
  const orders = await db
    .select({ id: schema.horecaOrders.id, number: schema.horecaOrders.number, status: schema.horecaOrders.status, source: schema.horecaOrders.source, createdAt: schema.horecaOrders.createdAt, payments: schema.horecaOrders.payments })
    .from(schema.horecaOrders)
    .where(and(eq(schema.horecaOrders.projectId, projectId), eq(schema.horecaOrders.guestId, id)))
    .orderBy(desc(schema.horecaOrders.createdAt))
    .limit(30);
  const venue = await requireVenue(projectId);
  const l = settingsOf(venue).loyalty;
  return { guest: g, orders, pointsValue: g.points * l.pointValue };
}

/** Finds the guest by phone, or adds them (filling in a missing name). */
export async function upsertGuest(tx: Tx, projectId: string, p: { name: string; phone: string }) {
  const phone = normalPhone(p.phone);
  if (phone.length < 7) return null;
  const [cur] = await tx.select().from(schema.horecaGuests).where(and(eq(schema.horecaGuests.projectId, projectId), eq(schema.horecaGuests.phone, phone)));
  if (cur) {
    if (!cur.name && p.name) await tx.update(schema.horecaGuests).set({ name: p.name }).where(eq(schema.horecaGuests.id, cur.id));
    return cur.id;
  }
  const [n] = await tx.insert(schema.horecaGuests).values({ projectId, phone, name: p.name }).returning();
  await safely(captureGuest(projectId, { name: p.name, phone }));
  return n.id;
}

/** A paid bill: one more visit, the spend, and points (when loyalty is on). Returns points earned. */
export async function creditVisit(tx: Tx, projectId: string, guestId: string, spend: number, loyalty: { enabled: boolean; pointsPer100: number }) {
  const points = loyalty.enabled ? Math.floor(spend / 10_000) * loyalty.pointsPer100 : 0;
  await tx
    .update(schema.horecaGuests)
    .set({ visits: sql`${schema.horecaGuests.visits} + 1`, spend: sql`${schema.horecaGuests.spend} + ${spend}`, points: sql`${schema.horecaGuests.points} + ${points}`, lastVisitAt: new Date() })
    .where(and(eq(schema.horecaGuests.id, guestId), eq(schema.horecaGuests.projectId, projectId)));
  return points;
}

/** Spends points as a payment; the amount must be a whole number of points. */
export async function redeemPoints(tx: Tx, projectId: string, guestId: string | null, amount: number, loyalty: { enabled: boolean; pointValue: number; minRedeem: number }) {
  if (!loyalty.enabled) throw new ApiError("conflict", "Loyalty points aren't switched on");
  if (!guestId) throw new ApiError("validation_failed", "Add the guest's phone number to use their points");
  if (amount % loyalty.pointValue) throw new ApiError("validation_failed", "Points pay in whole points");
  const points = amount / loyalty.pointValue;
  const [g] = await tx.select().from(schema.horecaGuests).where(and(eq(schema.horecaGuests.id, guestId), eq(schema.horecaGuests.projectId, projectId)));
  if (!g) throw notFound("Guest");
  if (g.points < loyalty.minRedeem) throw new ApiError("conflict", `Points can be used from ${loyalty.minRedeem} points`);
  if (g.points < points) throw new ApiError("conflict", `${g.name || "This guest"} has ${g.points} points`);
  await tx.update(schema.horecaGuests).set({ points: sql`${schema.horecaGuests.points} - ${points}` }).where(eq(schema.horecaGuests.id, g.id));
  return points;
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export async function leaveFeedback(projectId: string, orderId: string, rating: number, comment: string) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError("validation_failed", "Rate from 1 to 5");
  await db.insert(schema.horecaFeedback).values({ projectId, orderId, rating, comment: comment.trim().slice(0, 500) }).onConflictDoNothing();
}

export async function feedbackList(projectId: string) {
  const rows = await db
    .select({ f: schema.horecaFeedback, number: schema.horecaOrders.number, guestName: schema.horecaOrders.guestName })
    .from(schema.horecaFeedback)
    .leftJoin(schema.horecaOrders, eq(schema.horecaOrders.id, schema.horecaFeedback.orderId))
    .where(eq(schema.horecaFeedback.projectId, projectId))
    .orderBy(desc(schema.horecaFeedback.createdAt))
    .limit(100);
  const avg = rows.length ? rows.reduce((a, r) => a + r.f.rating, 0) / rows.length : 0;
  return { feedback: rows.map((r) => ({ ...r.f, orderNo: r.number, guestName: r.guestName ?? "" })), average: Math.round(avg * 10) / 10 };
}
