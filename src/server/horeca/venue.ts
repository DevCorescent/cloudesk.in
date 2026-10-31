// Cloudesk for Horeca: the venue, its floor (areas, tables, QR codes) and its menu.
import { and, inArray, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, schema } from "@/db";
import { areaSchema, categorySchema, itemSchema, modifierGroupSchema, settingsSchema, tableSchema, venueSchema, type HorecaSettings } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { randomToken } from "../security/tokens";

export type Venue = typeof schema.horecaVenues.$inferSelect;

/** Parse input with a schema, turning problems into a friendly 422. */
export function check<T extends z.ZodType>(s: T, raw: unknown): z.infer<T> {
  const r = s.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

export const settingsOf = (v: Venue): HorecaSettings => settingsSchema.parse(v.settings ?? {});

export async function getVenue(projectId: string) {
  const [v] = await db.select().from(schema.horecaVenues).where(eq(schema.horecaVenues.projectId, projectId));
  return v ?? null;
}
export async function requireVenue(projectId: string) {
  const v = await getVenue(projectId);
  if (!v) throw new ApiError("conflict", "Set up Cloudesk for Horeca first");
  return v;
}

export async function saveVenue(projectId: string, raw: unknown) {
  const input = check(venueSchema, raw);
  const values = { name: input.name, kind: input.kind, currency: input.currency, taxBps: input.taxBps, serviceChargeBps: input.serviceChargeBps, settings: input.settings, updatedAt: new Date() };
  const [v] = await db
    .insert(schema.horecaVenues)
    .values({ projectId, token: randomToken(9), ...values })
    .onConflictDoUpdate({ target: schema.horecaVenues.projectId, set: values })
    .returning();
  return v;
}

/** Atomically take the next order / KOT / valet number. */
export async function nextNumber(projectId: string, field: "nextOrderNo" | "nextKotNo" | "nextValetNo", exec: Pick<typeof db, "update"> = db) {
  const col = schema.horecaVenues[field];
  const [r] = await exec
    .update(schema.horecaVenues)
    .set({ [field]: sql`${col} + 1` })
    .where(eq(schema.horecaVenues.projectId, projectId))
    .returning({ n: sql<number>`${col} - 1` });
  if (!r) throw new ApiError("conflict", "Set up Cloudesk for Horeca first");
  return r.n;
}

// ─── Floor ───────────────────────────────────────────────────────────────────

export const listAreas = (projectId: string) => db.select().from(schema.horecaAreas).where(eq(schema.horecaAreas.projectId, projectId)).orderBy(asc(schema.horecaAreas.sort), asc(schema.horecaAreas.name));
export const listTables = (projectId: string) => db.select().from(schema.horecaTables).where(eq(schema.horecaTables.projectId, projectId)).orderBy(asc(schema.horecaTables.sort), asc(schema.horecaTables.name));

export async function saveArea(projectId: string, raw: unknown, id?: string) {
  const input = check(areaSchema, raw);
  const [r] = id
    ? await db.update(schema.horecaAreas).set(input).where(and(eq(schema.horecaAreas.id, id), eq(schema.horecaAreas.projectId, projectId))).returning()
    : await db.insert(schema.horecaAreas).values({ projectId, ...input }).returning();
  if (!r) throw notFound("Area");
  return r;
}
export async function deleteArea(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaAreas).where(and(eq(schema.horecaAreas.id, id), eq(schema.horecaAreas.projectId, projectId))).returning({ id: schema.horecaAreas.id });
  if (!rows.length) throw notFound("Area");
}

async function ownArea(projectId: string, areaId: string | null) {
  if (!areaId) return;
  const [a] = await db.select({ id: schema.horecaAreas.id }).from(schema.horecaAreas).where(and(eq(schema.horecaAreas.id, areaId), eq(schema.horecaAreas.projectId, projectId)));
  if (!a) throw notFound("Area");
}

export async function saveTable(projectId: string, raw: unknown, id?: string) {
  const input = check(tableSchema, raw);
  await ownArea(projectId, input.areaId);
  const [r] = id
    ? await db.update(schema.horecaTables).set(input).where(and(eq(schema.horecaTables.id, id), eq(schema.horecaTables.projectId, projectId))).returning()
    : await db.insert(schema.horecaTables).values({ projectId, token: randomToken(9), ...input }).returning();
  if (!r) throw notFound("Table");
  return r;
}

/** Quick setup: "T1 … T12" in an area. */
export async function addTables(projectId: string, o: { areaId: string | null; prefix: string; from: number; count: number; seats: number }) {
  await ownArea(projectId, o.areaId);
  const count = Math.max(1, Math.min(60, Math.floor(o.count)));
  const rows = Array.from({ length: count }, (_, i) => ({ projectId, areaId: o.areaId, name: `${o.prefix.trim().slice(0, 10)}${o.from + i}`, seats: o.seats, token: randomToken(9), sort: o.from + i }));
  return db.insert(schema.horecaTables).values(rows).returning();
}

export async function deleteTable(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaTables).where(and(eq(schema.horecaTables.id, id), eq(schema.horecaTables.projectId, projectId))).returning({ id: schema.horecaTables.id });
  if (!rows.length) throw notFound("Table");
}

/** A fresh QR code for a table (the printed one stops working). */
export async function rotateTableQr(projectId: string, id: string) {
  const [r] = await db.update(schema.horecaTables).set({ token: randomToken(9) }).where(and(eq(schema.horecaTables.id, id), eq(schema.horecaTables.projectId, projectId))).returning();
  if (!r) throw notFound("Table");
  return r;
}

// ─── Menu ────────────────────────────────────────────────────────────────────

export async function menu(projectId: string) {
  const [categories, items, modifiers] = await Promise.all([
    db.select().from(schema.horecaCategories).where(eq(schema.horecaCategories.projectId, projectId)).orderBy(asc(schema.horecaCategories.sort), asc(schema.horecaCategories.name)),
    db.select().from(schema.horecaItems).where(eq(schema.horecaItems.projectId, projectId)).orderBy(asc(schema.horecaItems.sort), asc(schema.horecaItems.name)),
    db.select().from(schema.horecaModifierGroups).where(eq(schema.horecaModifierGroups.projectId, projectId)).orderBy(asc(schema.horecaModifierGroups.name)),
  ]);
  return { categories, items, modifiers };
}

export async function saveCategory(projectId: string, raw: unknown, id?: string) {
  const input = check(categorySchema, raw);
  const [r] = id
    ? await db.update(schema.horecaCategories).set(input).where(and(eq(schema.horecaCategories.id, id), eq(schema.horecaCategories.projectId, projectId))).returning()
    : await db.insert(schema.horecaCategories).values({ projectId, ...input }).returning();
  if (!r) throw notFound("Category");
  return r;
}
export async function deleteCategory(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaCategories).where(and(eq(schema.horecaCategories.id, id), eq(schema.horecaCategories.projectId, projectId))).returning({ id: schema.horecaCategories.id });
  if (!rows.length) throw notFound("Category");
}

export async function saveModifierGroup(projectId: string, raw: unknown, id?: string) {
  const input = check(modifierGroupSchema, raw);
  if (input.minSelect > input.maxSelect) throw new ApiError("validation_failed", "Minimum can't be more than maximum", { minSelect: ["More than the maximum"] });
  const [r] = id
    ? await db.update(schema.horecaModifierGroups).set(input).where(and(eq(schema.horecaModifierGroups.id, id), eq(schema.horecaModifierGroups.projectId, projectId))).returning()
    : await db.insert(schema.horecaModifierGroups).values({ projectId, ...input }).returning();
  if (!r) throw notFound("Add-on group");
  return r;
}
export async function deleteModifierGroup(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaModifierGroups).where(and(eq(schema.horecaModifierGroups.id, id), eq(schema.horecaModifierGroups.projectId, projectId))).returning({ id: schema.horecaModifierGroups.id });
  if (!rows.length) throw notFound("Add-on group");
}

export async function saveItem(projectId: string, raw: unknown, id?: string) {
  const input = check(itemSchema, raw);
  const [cat] = await db.select({ id: schema.horecaCategories.id }).from(schema.horecaCategories).where(and(eq(schema.horecaCategories.id, input.categoryId), eq(schema.horecaCategories.projectId, projectId)));
  if (!cat) throw notFound("Category");
  if (input.barItemId) {
    const [b] = await db.select({ id: schema.horecaBarItems.id }).from(schema.horecaBarItems).where(and(eq(schema.horecaBarItems.id, input.barItemId), eq(schema.horecaBarItems.projectId, projectId)));
    if (!b) throw notFound("Bar item");
    if (!input.pourMl) throw new ApiError("validation_failed", "Say how much each serve pours (ml)", { pourMl: ["Required with a bottle"] });
  }
  if (input.modifierGroupIds.length) {
    const own = await db.select({ id: schema.horecaModifierGroups.id }).from(schema.horecaModifierGroups).where(eq(schema.horecaModifierGroups.projectId, projectId));
    if (input.modifierGroupIds.some((m) => !own.some((o) => o.id === m))) throw notFound("Add-on group");
  }
  if (input.recipe.length) {
    const ids = [...new Set(input.recipe.map((l) => l.stockItemId))];
    const own = await db.select({ id: schema.horecaStockItems.id }).from(schema.horecaStockItems).where(and(eq(schema.horecaStockItems.projectId, projectId), inArray(schema.horecaStockItems.id, ids)));
    if (own.length !== ids.length) throw notFound("Ingredient");
  }
  const values = { ...input, pourMl: input.barItemId ? input.pourMl : null };
  const [r] = id
    ? await db.update(schema.horecaItems).set(values).where(and(eq(schema.horecaItems.id, id), eq(schema.horecaItems.projectId, projectId))).returning()
    : await db.insert(schema.horecaItems).values({ projectId, ...values }).returning();
  if (!r) throw notFound("Menu item");
  return r;
}
export async function deleteItem(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaItems).where(and(eq(schema.horecaItems.id, id), eq(schema.horecaItems.projectId, projectId))).returning({ id: schema.horecaItems.id });
  if (!rows.length) throw notFound("Menu item");
}
/** Mark an item sold out for now ("86") or back on. */
export async function setAvailable(projectId: string, id: string, available: boolean) {
  const [r] = await db.update(schema.horecaItems).set({ available }).where(and(eq(schema.horecaItems.id, id), eq(schema.horecaItems.projectId, projectId))).returning();
  if (!r) throw notFound("Menu item");
  return r;
}
