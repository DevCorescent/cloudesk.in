// Cloudesk for Horeca: kitchen inventory. Ingredients are kept in grams,
// millilitres or pieces; each dish's recipe is deducted when it's sent to the
// kitchen (and put back if it's cancelled). Purchases from suppliers add
// stock, wastage removes it, and a physical count shows the variance.
// Recipe cost against menu price gives the food-cost % of every dish.
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { purchaseSchema, stockItemSchema, supplierSchema } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { check } from "./venue";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Item = typeof schema.horecaStockItems.$inferSelect;
export type RecipeLine = { stockItemId: string; qty: number };

/** Cost of `qty` units of an item, in minor units. */
export const unitCost = (i: Pick<Item, "costPerPack" | "packSize">, qty: number) => (i.packSize ? (i.costPerPack * qty) / i.packSize : 0);

export async function stockView(projectId: string) {
  const [items, suppliers] = await Promise.all([
    db.select().from(schema.horecaStockItems).where(eq(schema.horecaStockItems.projectId, projectId)).orderBy(asc(schema.horecaStockItems.category), asc(schema.horecaStockItems.name)),
    db.select().from(schema.horecaSuppliers).where(eq(schema.horecaSuppliers.projectId, projectId)).orderBy(asc(schema.horecaSuppliers.name)),
  ]);
  const used = await db
    .select({ id: schema.horecaStockMoves.stockItemId, qty: sql<number>`-sum(${schema.horecaStockMoves.qty})::int` })
    .from(schema.horecaStockMoves)
    .where(and(eq(schema.horecaStockMoves.projectId, projectId), inArray(schema.horecaStockMoves.kind, ["sale", "void"]), gte(schema.horecaStockMoves.createdAt, sql`now() - interval '7 days'`)))
    .groupBy(schema.horecaStockMoves.stockItemId);
  const rows = items.map((i) => {
    const used7 = used.find((u) => u.id === i.id)?.qty ?? 0;
    const perDay = used7 / 7;
    return { ...i, value: Math.round(unitCost(i, Math.max(0, i.stock))), low: i.stock <= i.reorderAt, used7, daysLeft: perDay > 0 ? Math.floor(Math.max(0, i.stock) / perDay) : null, supplier: suppliers.find((s) => s.id === i.supplierId)?.name ?? "" };
  });
  return { items: rows, suppliers, value: rows.reduce((a, r) => a + r.value, 0), low: rows.filter((r) => r.low && r.active).length };
}

export async function saveStockItem(projectId: string, raw: unknown, id?: string) {
  const input = check(stockItemSchema, raw);
  const [r] = id
    ? await db.update(schema.horecaStockItems).set(input).where(and(eq(schema.horecaStockItems.id, id), eq(schema.horecaStockItems.projectId, projectId))).returning()
    : await db.insert(schema.horecaStockItems).values({ projectId, ...input }).returning();
  if (!r) throw notFound("Stock item");
  return r;
}
export async function deleteStockItem(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaStockItems).where(and(eq(schema.horecaStockItems.id, id), eq(schema.horecaStockItems.projectId, projectId))).returning({ id: schema.horecaStockItems.id });
  if (!rows.length) throw notFound("Stock item");
}

export async function saveSupplier(projectId: string, raw: unknown, id?: string) {
  const input = check(supplierSchema, raw);
  const [r] = id
    ? await db.update(schema.horecaSuppliers).set(input).where(and(eq(schema.horecaSuppliers.id, id), eq(schema.horecaSuppliers.projectId, projectId))).returning()
    : await db.insert(schema.horecaSuppliers).values({ projectId, ...input }).returning();
  if (!r) throw notFound("Supplier");
  return r;
}
export async function deleteSupplier(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaSuppliers).where(and(eq(schema.horecaSuppliers.id, id), eq(schema.horecaSuppliers.projectId, projectId))).returning({ id: schema.horecaSuppliers.id });
  if (!rows.length) throw notFound("Supplier");
}

async function ownItems(tx: Tx | typeof db, projectId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const items = unique.length ? await tx.select().from(schema.horecaStockItems).where(and(eq(schema.horecaStockItems.projectId, projectId), inArray(schema.horecaStockItems.id, unique))) : [];
  if (items.length !== unique.length) throw notFound("Stock item");
  return items;
}

/** A supplier's invoice: adds stock and keeps the bill. */
export async function recordPurchase(projectId: string, userId: string, raw: unknown) {
  const input = check(purchaseSchema, raw);
  return db.transaction(async (tx) => {
    const items = await ownItems(tx, projectId, input.lines.map((l) => l.stockItemId));
    if (input.supplierId) {
      const [s] = await tx.select({ id: schema.horecaSuppliers.id }).from(schema.horecaSuppliers).where(and(eq(schema.horecaSuppliers.id, input.supplierId), eq(schema.horecaSuppliers.projectId, projectId)));
      if (!s) throw notFound("Supplier");
    }
    const lines = input.lines.map((l) => {
      const i = items.find((x) => x.id === l.stockItemId)!;
      return { stockItemId: i.id, name: i.name, unit: i.unit, qty: Math.round(l.packs * i.packSize), cost: l.cost };
    });
    const total = lines.reduce((a, l) => a + l.cost, 0);
    const [p] = await tx.insert(schema.horecaPurchases).values({ projectId, supplierId: input.supplierId, invoiceNo: input.invoiceNo, date: input.date, lines, total, createdBy: userId }).returning();
    for (const l of lines) {
      await tx.insert(schema.horecaStockMoves).values({ projectId, stockItemId: l.stockItemId, kind: "purchase", qty: l.qty, note: input.invoiceNo ? `Invoice ${input.invoiceNo}` : "Purchase", purchaseId: p.id, createdBy: userId });
      // The latest price paid becomes the item's cost, so food cost stays current.
      const i = items.find((x) => x.id === l.stockItemId)!;
      const costPerPack = l.qty ? Math.round((l.cost * i.packSize) / l.qty) : i.costPerPack;
      await tx.update(schema.horecaStockItems).set({ stock: sql`${schema.horecaStockItems.stock} + ${l.qty}`, ...(l.cost ? { costPerPack } : {}) }).where(eq(schema.horecaStockItems.id, l.stockItemId));
    }
    return p;
  });
}

export async function purchases(projectId: string) {
  return db
    .select({ p: schema.horecaPurchases, supplier: schema.horecaSuppliers.name })
    .from(schema.horecaPurchases)
    .leftJoin(schema.horecaSuppliers, eq(schema.horecaSuppliers.id, schema.horecaPurchases.supplierId))
    .where(eq(schema.horecaPurchases.projectId, projectId))
    .orderBy(desc(schema.horecaPurchases.date), desc(schema.horecaPurchases.createdAt))
    .limit(100)
    .then((r) => r.map((x) => ({ ...x.p, supplier: x.supplier ?? "" })));
}

const moveSchema = z.object({ stockItemId: z.uuid(), kind: z.enum(["wastage", "adjust"]), qty: z.number().int().min(-1_000_000).max(1_000_000), note: z.string().trim().max(200).default("") });
/** Spoilage, spills, staff meals — or a manual correction. */
export async function addStockMove(projectId: string, userId: string, raw: unknown) {
  const input = check(moveSchema, raw);
  const [i] = await ownItems(db, projectId, [input.stockItemId]);
  const qty = input.kind === "wastage" ? -Math.abs(input.qty) : input.qty;
  if (!qty) throw new ApiError("validation_failed", "Enter a quantity");
  if (i.stock + qty < 0) throw new ApiError("validation_failed", `There's only ${i.stock} ${i.unit} in stock.`);
  await db.transaction(async (tx) => {
    await tx.insert(schema.horecaStockMoves).values({ projectId, stockItemId: i.id, kind: input.kind, qty, note: input.note, createdBy: userId });
    await tx.update(schema.horecaStockItems).set({ stock: sql`${schema.horecaStockItems.stock} + ${qty}` }).where(eq(schema.horecaStockItems.id, i.id));
  });
}

export async function stockMoves(projectId: string, stockItemId?: string) {
  return db
    .select({ id: schema.horecaStockMoves.id, kind: schema.horecaStockMoves.kind, qty: schema.horecaStockMoves.qty, note: schema.horecaStockMoves.note, createdAt: schema.horecaStockMoves.createdAt, item: schema.horecaStockItems.name, unit: schema.horecaStockItems.unit })
    .from(schema.horecaStockMoves)
    .innerJoin(schema.horecaStockItems, eq(schema.horecaStockItems.id, schema.horecaStockMoves.stockItemId))
    .where(and(eq(schema.horecaStockMoves.projectId, projectId), stockItemId ? eq(schema.horecaStockMoves.stockItemId, stockItemId) : sql`true`))
    .orderBy(desc(schema.horecaStockMoves.createdAt))
    .limit(200);
}

const countSchema = z.object({ lines: z.array(z.object({ stockItemId: z.uuid(), counted: z.number().int().min(0).max(100_000_000) })).min(1).max(500), note: z.string().trim().max(300).default("") });
/** A physical count: stock is set to what was counted; the difference is the variance. */
export async function recordStockCount(projectId: string, userId: string, raw: unknown) {
  const input = check(countSchema, raw);
  return db.transaction(async (tx) => {
    const items = await ownItems(tx, projectId, input.lines.map((l) => l.stockItemId));
    const lines = input.lines.map((l) => {
      const i = items.find((x) => x.id === l.stockItemId)!;
      const variance = l.counted - i.stock;
      return { stockItemId: i.id, name: i.name, unit: i.unit, expected: i.stock, counted: l.counted, variance, value: Math.round(unitCost(i, variance)) };
    });
    for (const l of lines) {
      if (!l.variance) continue;
      await tx.insert(schema.horecaStockMoves).values({ projectId, stockItemId: l.stockItemId, kind: "adjust", qty: l.variance, note: "Stock count", createdBy: userId });
      await tx.update(schema.horecaStockItems).set({ stock: l.counted }).where(eq(schema.horecaStockItems.id, l.stockItemId));
    }
    const [c] = await tx.insert(schema.horecaStockCounts).values({ projectId, lines, note: input.note, createdBy: userId }).returning();
    return { id: c.id, createdAt: c.createdAt, note: c.note, lines, totalValue: lines.reduce((a, l) => a + l.value, 0) };
  });
}

export async function stockCounts(projectId: string) {
  const rows = await db.select().from(schema.horecaStockCounts).where(eq(schema.horecaStockCounts.projectId, projectId)).orderBy(desc(schema.horecaStockCounts.createdAt)).limit(20);
  return rows.map((c) => {
    const lines = c.lines as { value: number }[];
    return { ...c, totalValue: lines.reduce((a, l) => a + l.value, 0) };
  });
}

/** Takes a dish's ingredients out of stock as it's fired (sign −1), or puts them back (+1). */
export async function moveRecipe(tx: Tx, projectId: string, rows: { id: string; qty: number; name: string; recipe: unknown }[], sign: -1 | 1) {
  for (const r of rows) {
    for (const l of (r.recipe as RecipeLine[]) ?? []) {
      const qty = l.qty * r.qty * sign;
      if (!qty) continue;
      await tx.insert(schema.horecaStockMoves).values({ projectId, stockItemId: l.stockItemId, kind: sign < 0 ? "sale" : "void", qty, note: `${r.qty} × ${r.name}`, orderItemId: r.id });
      await tx.update(schema.horecaStockItems).set({ stock: sql`${schema.horecaStockItems.stock} + ${qty}` }).where(and(eq(schema.horecaStockItems.id, l.stockItemId), eq(schema.horecaStockItems.projectId, projectId)));
    }
  }
}

/** Every dish with a recipe: its ingredient cost and food-cost % of the menu price. */
export async function foodCost(projectId: string) {
  const [items, stock] = await Promise.all([
    db.select({ id: schema.horecaItems.id, name: schema.horecaItems.name, price: schema.horecaItems.price, recipe: schema.horecaItems.recipe }).from(schema.horecaItems).where(eq(schema.horecaItems.projectId, projectId)).orderBy(asc(schema.horecaItems.name)),
    db.select().from(schema.horecaStockItems).where(eq(schema.horecaStockItems.projectId, projectId)),
  ]);
  return items
    .filter((i) => (i.recipe as RecipeLine[]).length)
    .map((i) => {
      const cost = Math.round((i.recipe as RecipeLine[]).reduce((a, l) => {
        const s = stock.find((x) => x.id === l.stockItemId);
        return a + (s ? unitCost(s, l.qty) : 0);
      }, 0));
      return { id: i.id, name: i.name, price: i.price, cost, pct: i.price ? Math.round((cost / i.price) * 1000) / 10 : 0, margin: i.price - cost };
    });
}
