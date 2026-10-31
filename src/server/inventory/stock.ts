// The stock engine. Every change to a quantity goes through `move`, which
// writes the ledger (inv_moves) and the balance in one transaction.
//
// One special case keeps a single number for what's on sale: when an item is
// linked to a store variant and the location is that store's own shelf
// (a warehouse with the store's projectId), the quantity lives in the
// variant's `stock` — the online store and the POS keep selling from it as
// before — and the change is also written to the store's inventory log.
import { and, asc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { q3 } from "@/lib/inventory/model";
import { ApiError, notFound } from "../http/errors";
import type { Scope } from "./access";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Item = typeof schema.invItems.$inferSelect;
type Warehouse = typeof schema.invWarehouses.$inferSelect;

export const isShelf = (item: Pick<Item, "variantId" | "projectId">, wh: Pick<Warehouse, "projectId">) => !!item.variantId && !!wh.projectId && item.projectId === wh.projectId;

export async function getItem(orgId: string, id: string, tx: Tx | typeof db = db) {
  const [it] = await tx.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), eq(schema.invItems.id, id)));
  if (!it) throw notFound("Item");
  return it;
}

export async function getWarehouse(orgId: string, id: string, tx: Tx | typeof db = db) {
  const [w] = await tx.select().from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, orgId), eq(schema.invWarehouses.id, id)));
  if (!w) throw notFound("Location");
  return w;
}

export type MoveInput = {
  item: Item;
  warehouse: Warehouse;
  qty: number;
  kind: "receive" | "issue" | "adjust" | "count" | "transfer_out" | "transfer_in" | "return";
  batch?: string;
  expiry?: string | null;
  unitCost?: number;
  refType?: string;
  refId?: string | null;
  refNo?: string;
  note?: string;
  /** The bin it goes into or comes out of, in a location with bins. */
  binId?: string | null;
};

/** Change one balance and record why. Refuses to go below zero when the workspace blocks it. */
export async function move(tx: Tx, s: Pick<Scope, "orgId" | "userId" | "settings">, m: MoveInput) {
  const qty = q3(m.qty);
  if (!qty) return;
  const batch = m.batch ?? "";
  if (isShelf(m.item, m.warehouse)) {
    if (!Number.isInteger(qty)) throw new ApiError("validation_failed", `${m.item.name}: the store counts stock in whole units`);
    const [v] = await tx
      .update(schema.storeVariants)
      .set({ stock: sql`${schema.storeVariants.stock} + ${qty}` })
      .where(eq(schema.storeVariants.id, m.item.variantId!))
      .returning({ stock: schema.storeVariants.stock });
    if (!v) throw new ApiError("conflict", `${m.item.name} is no longer in the store`);
    if (qty < 0 && v.stock < 0 && s.settings.blockNegative) throw new ApiError("conflict", `Only ${v.stock - qty} of ${m.item.name} on hand at ${m.warehouse.name}`);
    await tx.insert(schema.storeInventoryLog).values({ projectId: m.warehouse.projectId!, variantId: m.item.variantId!, delta: qty, reason: `inventory:${m.kind}`, ref: m.refNo || null, actorId: s.userId || null });
  } else {
    const [row] = await tx
      .insert(schema.invStock)
      .values({ orgId: s.orgId, itemId: m.item.id, warehouseId: m.warehouse.id, batch, expiry: m.expiry ?? null, qty })
      .onConflictDoUpdate({
        target: [schema.invStock.itemId, schema.invStock.warehouseId, schema.invStock.batch],
        set: { qty: sql`${schema.invStock.qty} + ${qty}`, updatedAt: new Date(), ...(m.expiry ? { expiry: m.expiry } : {}) },
      })
      .returning({ qty: schema.invStock.qty });
    if (qty < 0 && row.qty < -0.0005 && s.settings.blockNegative) {
      throw new ApiError("conflict", `Only ${q3(row.qty - qty)} ${m.item.unit} of ${m.item.name}${batch ? ` (batch ${batch})` : ""} on hand at ${m.warehouse.name}`);
    }
    await binsFollow(tx, s.orgId, m, qty, batch, Number(row.qty));
  }
  await tx.insert(schema.invMoves).values({
    orgId: s.orgId,
    itemId: m.item.id,
    warehouseId: m.warehouse.id,
    batch,
    qty,
    kind: m.kind,
    unitCost: m.unitCost ?? m.item.avgCost,
    refType: m.refType ?? "",
    refId: m.refId ?? null,
    refNo: m.refNo ?? "",
    note: m.note ?? "",
    actorId: s.userId || null,
  });
}

/**
 * What to take out for an item without a named batch: batches with the
 * earliest expiry first (then the oldest), until the quantity is covered.
 * Items without batches come out of the '' row.
 */
export async function allocate(tx: Tx, item: Item, wh: Warehouse, qty: number, batch = "") {
  if (batch || !item.trackBatches || isShelf(item, wh)) return [{ batch, qty }];
  const rows = await tx
    .select({ batch: schema.invStock.batch, qty: schema.invStock.qty })
    .from(schema.invStock)
    .where(and(eq(schema.invStock.itemId, item.id), eq(schema.invStock.warehouseId, wh.id), gt(schema.invStock.qty, 0)))
    .orderBy(sql`${schema.invStock.expiry} asc nulls last`, asc(schema.invStock.updatedAt));
  const out: { batch: string; qty: number }[] = [];
  let left = qty;
  for (const r of rows) {
    if (left <= 0) break;
    const take = q3(Math.min(left, r.qty));
    out.push({ batch: r.batch, qty: take });
    left = q3(left - take);
  }
  // Whatever isn't covered comes from the unbatched row, where the
  // negative-stock check catches it.
  if (left > 0) out.push({ batch: "", qty: left });
  return out;
}

export type Balance = { itemId: string; warehouseId: string; batch: string; expiry: string | null; qty: number };

/** Quantities on hand, store shelves included, optionally for some items or one location. */
export async function balances(orgId: string, opts: { itemIds?: string[]; warehouseId?: string } = {}): Promise<Balance[]> {
  if (opts.itemIds && !opts.itemIds.length) return [];
  const [rows, shelves] = await Promise.all([
    db
      .select({ itemId: schema.invStock.itemId, warehouseId: schema.invStock.warehouseId, batch: schema.invStock.batch, expiry: schema.invStock.expiry, qty: schema.invStock.qty })
      .from(schema.invStock)
      .where(and(eq(schema.invStock.orgId, orgId), ne(schema.invStock.qty, 0), opts.itemIds ? inArray(schema.invStock.itemId, opts.itemIds) : undefined, opts.warehouseId ? eq(schema.invStock.warehouseId, opts.warehouseId) : undefined)),
    db
      .select({ itemId: schema.invItems.id, warehouseId: schema.invWarehouses.id, qty: schema.storeVariants.stock })
      .from(schema.invItems)
      .innerJoin(schema.storeVariants, eq(schema.storeVariants.id, schema.invItems.variantId))
      .innerJoin(schema.invWarehouses, and(eq(schema.invWarehouses.orgId, orgId), eq(schema.invWarehouses.projectId, schema.invItems.projectId)))
      .where(and(eq(schema.invItems.orgId, orgId), isNotNull(schema.invItems.variantId), opts.itemIds ? inArray(schema.invItems.id, opts.itemIds) : undefined, opts.warehouseId ? eq(schema.invWarehouses.id, opts.warehouseId) : undefined)),
  ]);
  return [...rows.map((r) => ({ ...r, expiry: r.expiry ? String(r.expiry) : null })), ...shelves.map((r) => ({ ...r, batch: "", expiry: null, qty: Number(r.qty) }))];
}

/** Total on hand per item across locations. */
export function totals(bal: Balance[]) {
  const m = new Map<string, number>();
  for (const b of bal) m.set(b.itemId, q3((m.get(b.itemId) ?? 0) + b.qty));
  return m;
}

/** Ordered but not yet received, per item, from open purchase orders. */
export async function onOrder(orgId: string) {
  const pos = await db
    .select({ lines: schema.invPurchaseOrders.lines })
    .from(schema.invPurchaseOrders)
    .where(and(eq(schema.invPurchaseOrders.orgId, orgId), inArray(schema.invPurchaseOrders.status, ["draft", "sent", "partial"])));
  const m = new Map<string, number>();
  for (const p of pos) for (const l of p.lines) m.set(l.itemId, q3((m.get(l.itemId) ?? 0) + Math.max(0, l.qty - l.received)));
  return m;
}

/** Promised to orders and not yet gone out, per item (optionally at one location). */
export async function reserved(orgId: string, warehouseId?: string) {
  const rows = await db.select({ itemId: schema.invReservations.itemId, qty: sql<number>`sum(${schema.invReservations.qty})::float` }).from(schema.invReservations).where(and(eq(schema.invReservations.orgId, orgId), warehouseId ? eq(schema.invReservations.warehouseId, warehouseId) : undefined)).groupBy(schema.invReservations.itemId);
  return new Map(rows.map((r) => [r.itemId, q3(Number(r.qty))]));
}

/** In quarantine bins, per item (optionally at one location): on hand but not available. */
export async function quarantined(orgId: string, warehouseId?: string) {
  const rows = await db.select({ itemId: schema.invBinStock.itemId, qty: sql<number>`sum(${schema.invBinStock.qty})::float` }).from(schema.invBinStock).innerJoin(schema.invBins, eq(schema.invBins.id, schema.invBinStock.binId)).where(and(eq(schema.invBinStock.orgId, orgId), eq(schema.invBins.kind, "quarantine"), warehouseId ? eq(schema.invBins.warehouseId, warehouseId) : undefined)).groupBy(schema.invBinStock.itemId);
  return new Map(rows.map((r) => [r.itemId, q3(Number(r.qty))]));
}

/**
 * Keep bins in step with a location's stock. A move that names a bin changes
 * that bin (and can't take out more than it holds). Stock that leaves without
 * a bin (a sale, an adjustment) comes out of what isn't put away first, then
 * out of storage bins — never silently out of quarantine unless nothing else is left.
 */
async function binsFollow(tx: Tx, orgId: string, m: MoveInput, qty: number, batch: string, rowQty: number) {
  if (m.binId) {
    const [bin] = await tx.select().from(schema.invBins).where(and(eq(schema.invBins.id, m.binId), eq(schema.invBins.orgId, orgId)));
    if (!bin || bin.warehouseId !== m.warehouse.id) throw new ApiError("validation_failed", "That bin isn't in this location");
    const [b] = await tx
      .insert(schema.invBinStock)
      .values({ orgId, binId: bin.id, itemId: m.item.id, batch, qty })
      .onConflictDoUpdate({ target: [schema.invBinStock.binId, schema.invBinStock.itemId, schema.invBinStock.batch], set: { qty: sql`${schema.invBinStock.qty} + ${qty}`, updatedAt: new Date() } })
      .returning({ qty: schema.invBinStock.qty });
    if (Number(b.qty) < -0.0005) throw new ApiError("conflict", `Only ${q3(Number(b.qty) - qty)} of ${m.item.name} in bin ${bin.code}`);
    return;
  }
  if (qty >= 0) return;
  const held = await tx
    .select({ id: schema.invBinStock.id, qty: schema.invBinStock.qty, kind: schema.invBins.kind, code: schema.invBins.code })
    .from(schema.invBinStock)
    .innerJoin(schema.invBins, eq(schema.invBins.id, schema.invBinStock.binId))
    .where(and(eq(schema.invBins.warehouseId, m.warehouse.id), eq(schema.invBinStock.itemId, m.item.id), eq(schema.invBinStock.batch, batch), gt(schema.invBinStock.qty, 0)));
  let over = q3(held.reduce((a, h) => a + Number(h.qty), 0) - Math.max(0, rowQty));
  if (over <= 0) return;
  for (const h of held.sort((a, b) => (a.kind === "quarantine" ? 1 : 0) - (b.kind === "quarantine" ? 1 : 0) || b.code.localeCompare(a.code))) {
    if (over <= 0) break;
    const take = q3(Math.min(over, Number(h.qty)));
    await tx.update(schema.invBinStock).set({ qty: sql`${schema.invBinStock.qty} - ${take}`, updatedAt: new Date() }).where(eq(schema.invBinStock.id, h.id));
    over = q3(over - take);
  }
}
