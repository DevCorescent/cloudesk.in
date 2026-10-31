// The inventory home and reports: what stock is worth and where, what's low,
// what's expiring, what's on order, what hasn't moved, and recent movement.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { q3 } from "@/lib/inventory/model";
import { todayIst, type Scope } from "./access";
import { balances, onOrder, totals } from "./stock";

const rowsOf = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? (r as T[]));

export async function home(s: Scope, full = false) {
  const [items, whs, bal, ordered, pos, moves, counts] = await Promise.all([
    db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), eq(schema.invItems.active, true))),
    db.select().from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, s.orgId)),
    balances(s.orgId),
    onOrder(s.orgId),
    db.select({ id: schema.invPurchaseOrders.id, number: schema.invPurchaseOrders.number, status: schema.invPurchaseOrders.status, total: schema.invPurchaseOrders.total, expectedDate: schema.invPurchaseOrders.expectedDate, supplier: schema.invSuppliers.name }).from(schema.invPurchaseOrders).innerJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.invPurchaseOrders.supplierId)).where(and(eq(schema.invPurchaseOrders.orgId, s.orgId), inArray(schema.invPurchaseOrders.status, ["sent", "partial", "draft"]))).orderBy(sql`${schema.invPurchaseOrders.expectedDate} asc nulls last`),
    db.select({ m: schema.invMoves, item: schema.invItems.name, unit: schema.invItems.unit, warehouse: schema.invWarehouses.name }).from(schema.invMoves).innerJoin(schema.invItems, eq(schema.invItems.id, schema.invMoves.itemId)).innerJoin(schema.invWarehouses, eq(schema.invWarehouses.id, schema.invMoves.warehouseId)).where(eq(schema.invMoves.orgId, s.orgId)).orderBy(desc(schema.invMoves.createdAt)).limit(12),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.invCounts).where(eq(schema.invCounts.orgId, s.orgId)),
  ]);
  const tot = totals(bal);
  const byId = new Map(items.map((i) => [i.id, i]));
  const value = bal.reduce((a, b) => a + Math.round(b.qty * (byId.get(b.itemId)?.avgCost ?? 0)), 0);
  const byWarehouse = whs.map((w) => {
    const rows = bal.filter((b) => b.warehouseId === w.id);
    return { id: w.id, name: w.name, store: !!w.projectId, items: new Set(rows.filter((r) => r.qty > 0).map((r) => r.itemId)).size, value: rows.reduce((a, b) => a + Math.round(b.qty * (byId.get(b.itemId)?.avgCost ?? 0)), 0) };
  });
  const low = items
    .filter((i) => i.reorderLevel > 0 && (tot.get(i.id) ?? 0) <= i.reorderLevel)
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit, onHand: tot.get(i.id) ?? 0, reorderLevel: i.reorderLevel, onOrder: ordered.get(i.id) ?? 0 }))
    .sort((a, b) => a.onHand / (a.reorderLevel || 1) - b.onHand / (b.reorderLevel || 1));
  const today = todayIst();
  const warn = new Date(Date.now() + s.settings.expiryWarnDays * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
  const expiring = bal
    .filter((b) => b.expiry && b.qty > 0 && b.expiry <= warn)
    .map((b) => ({ itemId: b.itemId, name: byId.get(b.itemId)?.name ?? "", unit: byId.get(b.itemId)?.unit ?? "", warehouse: whs.find((w) => w.id === b.warehouseId)?.name ?? "", batch: b.batch, expiry: b.expiry!, qty: b.qty, expired: b.expiry! < today }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  return {
    stats: { items: items.length, value, low: low.length, out: items.filter((i) => (tot.get(i.id) ?? 0) <= 0).length, openOrders: pos.filter((p) => p.status !== "draft").length, onOrderValue: pos.filter((p) => p.status !== "draft").reduce((a, p) => a + Number(p.total), 0), expiring: expiring.length, counted: counts[0]?.n ?? 0 },
    byWarehouse,
    low: low.slice(0, 8),
    expiring: full ? expiring : expiring.slice(0, 8),
    orders: pos.slice(0, 8).map((p) => ({ ...p, total: Number(p.total), late: p.status !== "draft" && !!p.expectedDate && String(p.expectedDate) < today })),
    recent: moves.map((m) => ({ ...m.m, item: m.item, unit: m.unit, warehouse: m.warehouse })),
  };
}

export async function reports(s: Scope) {
  const since90 = new Date(Date.now() - 90 * 86400_000);
  const [items, bal, inbound, recentMoves, storeMoves, spend] = await Promise.all([
    db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), eq(schema.invItems.active, true))),
    balances(s.orgId),
    rowsOf<{ month: string; received: number; value: number }>(
      await db.execute(sql`select to_char(date_trunc('month', (created_at at time zone 'Asia/Kolkata')), 'YYYY-MM') as month, sum(case when qty > 0 then qty else 0 end)::float as received, sum(case when kind = 'receive' then qty * unit_cost else 0 end)::float as value from inv_moves where org_id = ${s.orgId} and created_at > now() - interval '12 months' group by 1 order by 1`),
    ),
    db.selectDistinct({ itemId: schema.invMoves.itemId }).from(schema.invMoves).where(and(eq(schema.invMoves.orgId, s.orgId), gte(schema.invMoves.createdAt, since90))),
    db.selectDistinct({ itemId: schema.invItems.id }).from(schema.invItems).innerJoin(schema.storeInventoryLog, eq(schema.storeInventoryLog.variantId, schema.invItems.variantId)).where(and(eq(schema.invItems.orgId, s.orgId), gte(schema.storeInventoryLog.createdAt, since90))),
    rowsOf<{ supplier: string; total: number; receipts: number }>(
      await db.execute(sql`select coalesce(sp.name, 'No supplier') as supplier, sum(r.total)::bigint as total, count(*)::int as receipts from inv_receipts r left join inv_suppliers sp on sp.id = r.supplier_id where r.org_id = ${s.orgId} and r.date >= (now() at time zone 'Asia/Kolkata')::date - 365 group by 1 order by 2 desc limit 10`),
    ),
  ]);
  const tot = totals(bal);
  const moved = new Set([...recentMoves.map((m) => m.itemId), ...storeMoves.map((m) => m.itemId)]);
  const byCategory = new Map<string, number>();
  for (const it of items) byCategory.set(it.category || "Uncategorised", (byCategory.get(it.category || "Uncategorised") ?? 0) + Math.round((tot.get(it.id) ?? 0) * it.avgCost));
  const valuation = items
    .map((it) => ({ id: it.id, name: it.name, sku: it.sku, unit: it.unit, category: it.category, onHand: tot.get(it.id) ?? 0, avgCost: it.avgCost, value: Math.round((tot.get(it.id) ?? 0) * it.avgCost) }))
    .sort((a, b) => b.value - a.value);
  return {
    totalValue: valuation.reduce((a, v) => a + v.value, 0),
    valuation,
    byCategory: [...byCategory.entries()].map(([name, value]) => ({ name, value })).filter((c) => c.value > 0).sort((a, b) => b.value - a.value),
    dead: valuation.filter((v) => v.onHand > 0 && !moved.has(v.id)).map((v) => ({ ...v, onHand: q3(v.onHand) })),
    inbound: inbound.map((r) => ({ month: r.month, received: q3(Number(r.received)), value: Math.round(Number(r.value)) })),
    suppliers: spend.map((r) => ({ supplier: r.supplier, total: Number(r.total), receipts: Number(r.receipts) })),
  };
}

/** The ledger, filtered. */
export async function movements(s: Scope, opts: { itemId?: string; warehouseId?: string; kind?: string } = {}) {
  return db
    .select({ m: schema.invMoves, item: schema.invItems.name, unit: schema.invItems.unit, warehouse: schema.invWarehouses.name, by: schema.users.name })
    .from(schema.invMoves)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.invMoves.itemId))
    .innerJoin(schema.invWarehouses, eq(schema.invWarehouses.id, schema.invMoves.warehouseId))
    .leftJoin(schema.users, eq(schema.users.id, schema.invMoves.actorId))
    .where(and(eq(schema.invMoves.orgId, s.orgId), opts.itemId ? eq(schema.invMoves.itemId, opts.itemId) : undefined, opts.warehouseId ? eq(schema.invMoves.warehouseId, opts.warehouseId) : undefined, opts.kind ? eq(schema.invMoves.kind, opts.kind) : undefined))
    .orderBy(desc(schema.invMoves.createdAt))
    .limit(300)
    .then((r) => r.map((x) => ({ ...x.m, item: x.item, unit: x.unit, warehouse: x.warehouse, by: x.by })));
}

/** Batches expiring within the warning window (or already expired). */
export async function expiring(s: Scope) {
  return (await home(s, true)).expiring;
}
