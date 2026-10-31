// Cloudesk for Horeca: till sessions. Open with a cash float, take payments,
// record cash paid in or out (petty cash, a supplier paid at the door), then
// count the drawer at close — the Z report shows what was expected, what was
// counted and the difference, plus the shift's sales by payment method.
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { actorName, approve, logEvent, type Actor } from "./staff";
import { check } from "./venue";

type Shift = typeof schema.horecaShifts.$inferSelect;
type Pay = { method: string; amount: number; at: string; shiftId?: string; staff?: string };

export async function openShift(projectId: string) {
  const [s] = await db.select().from(schema.horecaShifts).where(and(eq(schema.horecaShifts.projectId, projectId), eq(schema.horecaShifts.status, "open"))).orderBy(desc(schema.horecaShifts.openedAt)).limit(1);
  return s ?? null;
}

export async function startShift(projectId: string, raw: unknown, actor: Actor) {
  const input = check(z.object({ openingFloat: z.number().int().min(0).max(100_000_000).default(0) }), raw);
  if (await openShift(projectId)) throw new ApiError("conflict", "A till session is already open — close it first");
  const [s] = await db.insert(schema.horecaShifts).values({ projectId, openingFloat: input.openingFloat, openedBy: await actorName(projectId, actor) }).returning();
  return s;
}

const moveSchema = z.object({ kind: z.enum(["pay_in", "pay_out"]), amount: z.number().int().min(1).max(100_000_000), reason: z.string().trim().min(1, "Add a reason").max(200) });
export async function cashMove(projectId: string, raw: unknown, actor: Actor) {
  const input = check(moveSchema, raw);
  const s = await openShift(projectId);
  if (!s) throw new ApiError("conflict", "Open a till session first");
  const staffName = await actorName(projectId, actor);
  // Taking cash out of the drawer needs a manager.
  const approvedBy = input.kind === "pay_out" ? await approve(projectId, actor, "Paying cash out") : "";
  await db.transaction(async (tx) => {
    await tx.insert(schema.horecaCashMoves).values({ projectId, shiftId: s.id, kind: input.kind, amount: input.amount, reason: input.reason, staffName });
    await logEvent({ projectId, kind: input.kind, staffName, approvedBy, amount: input.amount, detail: input.reason }, tx);
  });
  return shiftReport(projectId, s.id);
}

/** Everything in a shift: payments by method, cash in/out, voids and discounts, and the drawer. */
export async function shiftReport(projectId: string, shiftId: string) {
  const [s] = await db.select().from(schema.horecaShifts).where(and(eq(schema.horecaShifts.id, shiftId), eq(schema.horecaShifts.projectId, projectId)));
  if (!s) throw notFound("Shift");
  const end = s.closedAt ?? new Date();
  const orders = await db
    .select({ id: schema.horecaOrders.id, number: schema.horecaOrders.number, payments: schema.horecaOrders.payments, tip: schema.horecaOrders.tip, status: schema.horecaOrders.status })
    .from(schema.horecaOrders)
    .where(and(eq(schema.horecaOrders.projectId, projectId), sql`${schema.horecaOrders.payments} @> ${JSON.stringify([{ shiftId }])}::jsonb`));
  const methods: Record<string, number> = {};
  let bills = 0;
  for (const o of orders) {
    const mine = (o.payments as Pay[]).filter((p) => p.shiftId === shiftId);
    if (mine.length && o.status === "paid") bills++;
    for (const p of mine) methods[p.method] = (methods[p.method] ?? 0) + p.amount;
  }
  const moves = await db.select().from(schema.horecaCashMoves).where(eq(schema.horecaCashMoves.shiftId, shiftId)).orderBy(desc(schema.horecaCashMoves.createdAt));
  const payIn = moves.filter((m) => m.kind === "pay_in").reduce((a, m) => a + m.amount, 0);
  const payOut = moves.filter((m) => m.kind === "pay_out").reduce((a, m) => a + m.amount, 0);
  const events = await db.select().from(schema.horecaEvents).where(and(eq(schema.horecaEvents.projectId, projectId), gte(schema.horecaEvents.createdAt, s.openedAt), lte(schema.horecaEvents.createdAt, end)));
  const sum = (k: string) => events.filter((e) => e.kind === k).reduce((a, e) => a + e.amount, 0);
  const expectedCash = s.openingFloat + (methods.cash ?? 0) + payIn - payOut;
  return {
    shift: s,
    methods,
    takings: Object.values(methods).reduce((a, v) => a + v, 0),
    bills,
    payIn,
    payOut,
    moves,
    voids: { count: events.filter((e) => e.kind === "void").length, amount: sum("void") },
    discounts: { count: events.filter((e) => e.kind === "discount").length, amount: sum("discount") },
    comps: { count: events.filter((e) => e.kind === "comp").length, amount: sum("comp") },
    expectedCash,
    countedCash: s.countedCash,
    variance: s.countedCash === null ? null : s.countedCash - expectedCash,
  };
}

export async function closeShift(projectId: string, raw: unknown, actor: Actor) {
  const input = check(z.object({ countedCash: z.number().int().min(0).max(100_000_000), note: z.string().trim().max(300).default("") }), raw);
  const s = await openShift(projectId);
  if (!s) throw new ApiError("conflict", "There's no open till session");
  const r = await shiftReport(projectId, s.id);
  await db
    .update(schema.horecaShifts)
    .set({ status: "closed", closedAt: new Date(), closedBy: await actorName(projectId, actor), expectedCash: r.expectedCash, countedCash: input.countedCash, note: input.note })
    .where(eq(schema.horecaShifts.id, s.id));
  return shiftReport(projectId, s.id);
}

export async function shifts(projectId: string) {
  const rows: Shift[] = await db.select().from(schema.horecaShifts).where(eq(schema.horecaShifts.projectId, projectId)).orderBy(desc(schema.horecaShifts.openedAt)).limit(30);
  return rows.map((s) => ({ ...s, variance: s.countedCash === null || s.expectedCash === null ? null : s.countedCash - s.expectedCash }));
}
