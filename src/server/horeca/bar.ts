// Cloudesk for Horeca: bar inventory in millilitres — purchases, pours from
// orders, wastage, physical counts and the variance between them.
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { barCountSchema, barItemSchema, barMoveSchema } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { check } from "./venue";

export async function barStock(projectId: string) {
  const items = await db.select().from(schema.horecaBarItems).where(eq(schema.horecaBarItems.projectId, projectId)).orderBy(asc(schema.horecaBarItems.category), asc(schema.horecaBarItems.name));
  // What was poured over the last 7 days, per bottle.
  const week = await db
    .select({ id: schema.horecaBarMoves.barItemId, ml: sql<number>`-sum(${schema.horecaBarMoves.ml})::int` })
    .from(schema.horecaBarMoves)
    .where(and(eq(schema.horecaBarMoves.projectId, projectId), inArray(schema.horecaBarMoves.kind, ["sale", "void"]), gte(schema.horecaBarMoves.createdAt, sql`now() - interval '7 days'`)))
    .groupBy(schema.horecaBarMoves.barItemId);
  const rows = items.map((i) => {
    const sold7 = week.find((w) => w.id === i.id)?.ml ?? 0;
    const perDay = sold7 / 7;
    return {
      ...i,
      bottles: i.stockMl / i.bottleMl,
      value: Math.round((i.stockMl / i.bottleMl) * i.costPerBottle),
      low: i.stockMl <= i.reorderMl,
      sold7,
      /** Days of stock left at last week's pace. */
      daysLeft: perDay > 0 ? Math.floor(i.stockMl / perDay) : null,
    };
  });
  return { items: rows, value: rows.reduce((a, r) => a + r.value, 0), low: rows.filter((r) => r.low && r.active).length };
}

export async function saveBarItem(projectId: string, raw: unknown, id?: string) {
  const input = check(barItemSchema, raw);
  const [r] = id
    ? await db.update(schema.horecaBarItems).set(input).where(and(eq(schema.horecaBarItems.id, id), eq(schema.horecaBarItems.projectId, projectId))).returning()
    : await db.insert(schema.horecaBarItems).values({ projectId, ...input }).returning();
  if (!r) throw notFound("Bar item");
  return r;
}
export async function deleteBarItem(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaBarItems).where(and(eq(schema.horecaBarItems.id, id), eq(schema.horecaBarItems.projectId, projectId))).returning({ id: schema.horecaBarItems.id });
  if (!rows.length) throw notFound("Bar item");
}

/** A purchase (bottles in), wastage (spills, breakage) or a manual adjustment. */
export async function addBarMove(projectId: string, userId: string, raw: unknown) {
  const input = check(barMoveSchema, raw);
  const [item] = await db.select().from(schema.horecaBarItems).where(and(eq(schema.horecaBarItems.id, input.barItemId), eq(schema.horecaBarItems.projectId, projectId)));
  if (!item) throw notFound("Bar item");
  let ml = Math.round(input.bottles * item.bottleMl) + input.ml;
  if (input.kind === "purchase") ml = Math.abs(ml);
  if (input.kind === "wastage") ml = -Math.abs(ml);
  if (!ml) throw new ApiError("validation_failed", "Enter bottles or millilitres");
  if (item.stockMl + ml < 0) throw new ApiError("validation_failed", `There's only ${item.stockMl} ml in stock.`);
  await db.transaction(async (tx) => {
    await tx.insert(schema.horecaBarMoves).values({ projectId, barItemId: item.id, kind: input.kind, ml, note: input.note, createdBy: userId });
    await tx.update(schema.horecaBarItems).set({ stockMl: sql`${schema.horecaBarItems.stockMl} + ${ml}` }).where(eq(schema.horecaBarItems.id, item.id));
  });
}

export async function barMoves(projectId: string, barItemId?: string) {
  return db
    .select({ id: schema.horecaBarMoves.id, kind: schema.horecaBarMoves.kind, ml: schema.horecaBarMoves.ml, note: schema.horecaBarMoves.note, createdAt: schema.horecaBarMoves.createdAt, item: schema.horecaBarItems.name, barItemId: schema.horecaBarMoves.barItemId })
    .from(schema.horecaBarMoves)
    .innerJoin(schema.horecaBarItems, eq(schema.horecaBarItems.id, schema.horecaBarMoves.barItemId))
    .where(and(eq(schema.horecaBarMoves.projectId, projectId), barItemId ? eq(schema.horecaBarMoves.barItemId, barItemId) : sql`true`))
    .orderBy(desc(schema.horecaBarMoves.createdAt))
    .limit(200);
}

/**
 * A physical count: we record what the system expected, set stock to what was
 * counted, and keep the difference (in ml and money) as the variance.
 */
export async function recordCount(projectId: string, userId: string, raw: unknown) {
  const input = check(barCountSchema, raw);
  const items = await db.select().from(schema.horecaBarItems).where(and(eq(schema.horecaBarItems.projectId, projectId), inArray(schema.horecaBarItems.id, input.lines.map((l) => l.barItemId))));
  if (items.length !== new Set(input.lines.map((l) => l.barItemId)).size) throw notFound("Bar item");
  const lines = input.lines.map((l) => {
    const i = items.find((x) => x.id === l.barItemId)!;
    return { barItemId: i.id, name: i.name, expectedMl: i.stockMl, countedMl: l.countedMl, costPerMl: i.costPerBottle / i.bottleMl };
  });
  const [count] = await db.transaction(async (tx) => {
    for (const l of lines) {
      const diff = l.countedMl - l.expectedMl;
      if (!diff) continue;
      await tx.insert(schema.horecaBarMoves).values({ projectId, barItemId: l.barItemId, kind: "adjust", ml: diff, note: "Stock count", createdBy: userId });
      await tx.update(schema.horecaBarItems).set({ stockMl: l.countedMl }).where(eq(schema.horecaBarItems.id, l.barItemId));
    }
    return tx.insert(schema.horecaBarCounts).values({ projectId, lines, note: input.note, createdBy: userId }).returning();
  });
  return varianceOf(count);
}

const varianceOf = (c: typeof schema.horecaBarCounts.$inferSelect) => {
  const lines = (c.lines as { barItemId: string; name: string; expectedMl: number; countedMl: number; costPerMl: number }[]).map((l) => ({ ...l, varianceMl: l.countedMl - l.expectedMl, varianceValue: Math.round((l.countedMl - l.expectedMl) * l.costPerMl) }));
  return { id: c.id, createdAt: c.createdAt.toISOString(), note: c.note, lines, totalValue: lines.reduce((a, l) => a + l.varianceValue, 0) };
};

export async function counts(projectId: string) {
  const rows = await db.select().from(schema.horecaBarCounts).where(eq(schema.horecaBarCounts.projectId, projectId)).orderBy(desc(schema.horecaBarCounts.createdAt)).limit(20);
  return rows.map(varianceOf);
}
