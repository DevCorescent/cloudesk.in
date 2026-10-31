// The warehouse floor: bins (with quarantine), putting stock away and moving
// it between bins, serial numbers, stock reserved for sales orders, waves of
// orders picked, packed and dispatched together, scanning, and the stock
// reports that need history — FIFO value, ageing, ABC classes and counts due.
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { abc, ageing, binMoveSchema, binSchema, fifoLayers, q3, waveSchema } from "@/lib/inventory/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { check, requireManage, requireWarehouseAccess, requireWrite, todayIst, type Scope } from "./access";
import { balances, getItem, getWarehouse, quarantined, reserved, totals, type Tx } from "./stock";
import { contains } from "../security/like";

// ── Bins ────────────────────────────────────────────────────────────────────

export async function bins(s: Scope, warehouseId: string) {
  requireWarehouseAccess(s, warehouseId);
  const rows = await db.select().from(schema.invBins).where(and(eq(schema.invBins.orgId, s.orgId), eq(schema.invBins.warehouseId, warehouseId))).orderBy(asc(schema.invBins.zone), asc(schema.invBins.code));
  const stock = rows.length
    ? await db.select({ b: schema.invBinStock, name: schema.invItems.name, unit: schema.invItems.unit }).from(schema.invBinStock).innerJoin(schema.invItems, eq(schema.invItems.id, schema.invBinStock.itemId)).where(and(inArray(schema.invBinStock.binId, rows.map((r) => r.id)), gt(schema.invBinStock.qty, 0)))
    : [];
  // What's at the location but not in any bin.
  const bal = await balances(s.orgId, { warehouseId });
  const inBins = new Map<string, number>();
  for (const x of stock) inBins.set(`${x.b.itemId}|${x.b.batch}`, q3((inBins.get(`${x.b.itemId}|${x.b.batch}`) ?? 0) + Number(x.b.qty)));
  const names = new Map((await db.select({ id: schema.invItems.id, name: schema.invItems.name, unit: schema.invItems.unit }).from(schema.invItems).where(eq(schema.invItems.orgId, s.orgId))).map((i) => [i.id, i]));
  const unplaced = bal.map((b) => ({ itemId: b.itemId, batch: b.batch, qty: q3(b.qty - (inBins.get(`${b.itemId}|${b.batch}`) ?? 0)), name: names.get(b.itemId)?.name ?? "", unit: names.get(b.itemId)?.unit ?? "" })).filter((x) => x.qty > 0.0005);
  return { bins: rows.map((r) => ({ ...r, stock: stock.filter((x) => x.b.binId === r.id).map((x) => ({ itemId: x.b.itemId, batch: x.b.batch, qty: Number(x.b.qty), name: x.name, unit: x.unit })) })), unplaced };
}

export async function saveBin(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(binSchema, raw);
  requireWarehouseAccess(s, v.warehouseId);
  await getWarehouse(s.orgId, v.warehouseId);
  const [dup] = await db.select({ id: schema.invBins.id }).from(schema.invBins).where(and(eq(schema.invBins.warehouseId, v.warehouseId), sql`lower(${schema.invBins.code}) = ${v.code.toLowerCase()}`));
  if (dup && dup.id !== id) throw new ApiError("conflict", `There's already a bin ${v.code} here`);
  if (id) {
    const [cur] = await db.select().from(schema.invBins).where(and(eq(schema.invBins.id, id), eq(schema.invBins.orgId, s.orgId)));
    if (!cur) throw notFound("Bin");
    if (cur.warehouseId !== v.warehouseId) throw new ApiError("conflict", "A bin can't move to another location");
    const [r] = await db.update(schema.invBins).set(v).where(eq(schema.invBins.id, id)).returning();
    return r;
  }
  const [r] = await db.insert(schema.invBins).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

export async function deleteBin(s: Scope, id: string) {
  requireManage(s);
  const [held] = await db.select({ id: schema.invBinStock.id }).from(schema.invBinStock).where(and(eq(schema.invBinStock.binId, id), gt(schema.invBinStock.qty, 0))).limit(1);
  if (held) throw new ApiError("conflict", "Move what's in this bin out first");
  await db.delete(schema.invBins).where(and(eq(schema.invBins.id, id), eq(schema.invBins.orgId, s.orgId)));
}

/** Put stock away into a bin, move it between bins, or take it out of bins — the location's total doesn't change. */
export async function moveInBins(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(binMoveSchema, raw);
  requireWarehouseAccess(s, v.warehouseId);
  if (!v.fromBinId && !v.toBinId) throw new ApiError("validation_failed", "Pick a bin to move from or to");
  if (v.fromBinId === v.toBinId) throw new ApiError("validation_failed", "Pick two different bins");
  const ids = [v.fromBinId, v.toBinId].filter((x): x is string => !!x);
  const bs = await db.select().from(schema.invBins).where(and(eq(schema.invBins.orgId, s.orgId), inArray(schema.invBins.id, ids)));
  if (bs.length !== ids.length || bs.some((b) => b.warehouseId !== v.warehouseId)) throw new ApiError("validation_failed", "Use bins in this location");
  const item = await getItem(s.orgId, v.itemId);
  await db.transaction(async (tx) => {
    if (!v.fromBinId) {
      // From what isn't put away yet.
      const view = await bins(s, v.warehouseId);
      const free = view.unplaced.find((u) => u.itemId === v.itemId && u.batch === v.batch)?.qty ?? 0;
      if (v.qty > free + 0.0005) throw new ApiError("conflict", `Only ${free} of ${item.name} isn't in a bin yet`);
    } else await shift(tx, s.orgId, v.fromBinId, v.itemId, v.batch, -v.qty, item.name);
    if (v.toBinId) await shift(tx, s.orgId, v.toBinId, v.itemId, v.batch, v.qty, item.name);
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.bin_move", targetType: "inv_item", targetId: v.itemId, metadata: { qty: v.qty, from: v.fromBinId, to: v.toBinId } });
}

async function shift(tx: Tx, orgId: string, binId: string, itemId: string, batch: string, qty: number, name: string) {
  const [b] = await tx
    .insert(schema.invBinStock)
    .values({ orgId, binId, itemId, batch, qty })
    .onConflictDoUpdate({ target: [schema.invBinStock.binId, schema.invBinStock.itemId, schema.invBinStock.batch], set: { qty: sql`${schema.invBinStock.qty} + ${qty}`, updatedAt: new Date() } })
    .returning({ qty: schema.invBinStock.qty });
  if (Number(b.qty) < -0.0005) throw new ApiError("conflict", `Only ${q3(Number(b.qty) - qty)} of ${name} in that bin`);
}

// ── Serial numbers ──────────────────────────────────────────────────────────

/** Units coming in: each serial is new (or back from a customer). */
export async function serialsIn(tx: Tx, orgId: string, itemId: string, warehouseId: string, serials: string[], r: { type: string; id: string; no: string }, allowReturning = false) {
  const clean = serials.map((x) => x.trim()).filter(Boolean);
  if (new Set(clean.map((x) => x.toLowerCase())).size !== clean.length) throw new ApiError("validation_failed", "A serial number is listed twice");
  for (const serial of clean) {
    const [cur] = await tx.select().from(schema.invSerials).where(and(eq(schema.invSerials.itemId, itemId), sql`lower(${schema.invSerials.serial}) = ${serial.toLowerCase()}`));
    if (cur && !(allowReturning && cur.status === "delivered")) throw new ApiError("conflict", `Serial ${serial} is already ${cur.status === "in_stock" ? "in stock" : cur.status.replace(/_/g, " ")}`);
    if (cur) await tx.update(schema.invSerials).set({ status: "in_stock", warehouseId, lastRef: r, updatedAt: new Date() }).where(eq(schema.invSerials.id, cur.id));
    else await tx.insert(schema.invSerials).values({ orgId, itemId, serial, warehouseId, receivedRef: r, lastRef: r });
  }
}

/** Units going out: each serial must be in stock at the location. */
export async function serialsOut(tx: Tx, orgId: string, itemId: string, warehouseId: string, serials: string[], to: "delivered" | "returned_to_supplier" | "scrapped", r: { type: string; id: string; no: string }) {
  for (const serial of serials.map((x) => x.trim()).filter(Boolean)) {
    const [cur] = await tx.select().from(schema.invSerials).where(and(eq(schema.invSerials.orgId, orgId), eq(schema.invSerials.itemId, itemId), sql`lower(${schema.invSerials.serial}) = ${serial.toLowerCase()}`));
    if (!cur || cur.status !== "in_stock" || cur.warehouseId !== warehouseId) throw new ApiError("conflict", `Serial ${serial} isn't in stock here`);
    await tx.update(schema.invSerials).set({ status: to, warehouseId: null, lastRef: r, updatedAt: new Date() }).where(eq(schema.invSerials.id, cur.id));
  }
}

/** Check a serial-tracked line has one serial per unit. */
export function needSerials(item: { name: string; trackSerials: boolean }, qty: number, serials: string[] | undefined) {
  if (!item.trackSerials || qty <= 0) return;
  if (!Number.isInteger(qty)) throw new ApiError("validation_failed", `${item.name} is counted by serial number — use whole units`);
  if ((serials ?? []).filter((x) => x.trim()).length !== qty) throw new ApiError("validation_failed", `Enter ${qty} serial number${qty === 1 ? "" : "s"} for ${item.name}`);
}

export async function serialsOf(s: Scope, q: { itemId?: string; status?: string; q?: string }) {
  return db
    .select({ x: schema.invSerials, item: schema.invItems.name })
    .from(schema.invSerials)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.invSerials.itemId))
    .where(and(eq(schema.invSerials.orgId, s.orgId), q.itemId ? eq(schema.invSerials.itemId, q.itemId) : undefined, q.status ? eq(schema.invSerials.status, q.status) : undefined, q.q ? sql`${schema.invSerials.serial} ilike ${contains(q.q)}` : undefined))
    .orderBy(desc(schema.invSerials.updatedAt))
    .limit(500)
    .then((r) => r.map((y) => ({ ...y.x, item: y.item })));
}

// ── Reservations ────────────────────────────────────────────────────────────

/** Keep a sales order's reservations equal to what's still to deliver while it's confirmed; none otherwise. */
export async function syncOrderReservations(orgId: string, orderId: string) {
  const [o] = await db.select().from(schema.salesOrders).where(and(eq(schema.salesOrders.id, orderId), eq(schema.salesOrders.orgId, orgId)));
  await db.delete(schema.invReservations).where(and(eq(schema.invReservations.refType, "sales_order"), eq(schema.invReservations.refId, orderId)));
  if (!o || !["confirmed", "partial"].includes(o.status)) return;
  let wh = o.warehouseId;
  if (!wh) [{ id: wh }] = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, orgId), eq(schema.invWarehouses.isDefault, true))).then((r) => (r.length ? r : [{ id: null as unknown as string }]));
  if (!wh) return;
  const rows = o.lines.filter((l) => l.itemId && l.qty - l.delivered > 0.0005).map((l) => ({ orgId, itemId: l.itemId!, warehouseId: wh!, qty: q3(l.qty - l.delivered), refType: "sales_order", refId: o.id, lineId: l.id, refNo: o.number }));
  if (rows.length) await db.insert(schema.invReservations).values(rows);
}

/** Free to promise per item at a location: on hand, less reserved and quarantined. */
export async function availability(s: Scope, warehouseId?: string) {
  const [bal, held, quar] = await Promise.all([balances(s.orgId, { warehouseId }), reserved(s.orgId, warehouseId), quarantined(s.orgId, warehouseId)]);
  const tot = totals(bal);
  const ids = new Set([...tot.keys(), ...held.keys()]);
  return [...ids].map((id) => ({ itemId: id, onHand: tot.get(id) ?? 0, reserved: held.get(id) ?? 0, quarantined: quar.get(id) ?? 0, available: q3((tot.get(id) ?? 0) - (held.get(id) ?? 0) - (quar.get(id) ?? 0)) }));
}

// ── Waves: pick, pack, dispatch ─────────────────────────────────────────────

async function nextWave(orgId: string, prefix: string) {
  await db.insert(schema.invSettings).values({ orgId }).onConflictDoNothing();
  const rows = (await db.execute(sql`update inv_settings set counters = jsonb_set(counters, '{wave}', to_jsonb(coalesce((counters->>'wave')::int, 1) + 1)) where org_id = ${orgId} returning (counters->>'wave')::int - 1 as n`)) as unknown as { rows: { n: number }[] };
  return `${prefix}${String(rows.rows[0].n).padStart(4, "0")}`;
}

async function getWave(orgId: string, id: string) {
  const [w] = await db.select().from(schema.invWaves).where(and(eq(schema.invWaves.id, id), eq(schema.invWaves.orgId, orgId)));
  if (!w) throw notFound("Wave");
  return w;
}

/** Confirmed sales orders with goods still to go out of a location, for building a wave. */
export async function waveCandidates(s: Scope, warehouseId: string) {
  const def = (await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.isDefault, true))))[0]?.id;
  const inWaves = new Set((await db.select({ ids: schema.invWaves.orderIds }).from(schema.invWaves).where(and(eq(schema.invWaves.orgId, s.orgId), inArray(schema.invWaves.status, ["picking", "packed"])))).flatMap((w) => w.ids));
  const orders = await db.select().from(schema.salesOrders).where(and(eq(schema.salesOrders.orgId, s.orgId), inArray(schema.salesOrders.status, ["confirmed", "partial"])));
  return orders
    .filter((o) => (o.warehouseId ?? def) === warehouseId && !inWaves.has(o.id) && o.lines.some((l) => l.itemId && l.qty - l.delivered > 0.0005))
    .map((o) => ({ id: o.id, number: o.number, client: o.clientName, expectedDate: o.expectedDate, lines: o.lines.filter((l) => l.itemId && l.qty - l.delivered > 0.0005).length }));
}

export async function waves(s: Scope) {
  return db.select().from(schema.invWaves).where(eq(schema.invWaves.orgId, s.orgId)).orderBy(desc(schema.invWaves.createdAt)).limit(200);
}

export async function waveDetail(s: Scope, id: string) {
  const w = await getWave(s.orgId, id);
  const orders = w.orderIds.length ? await db.select({ id: schema.salesOrders.id, number: schema.salesOrders.number, client: schema.salesOrders.clientName }).from(schema.salesOrders).where(inArray(schema.salesOrders.id, w.orderIds)) : [];
  const itemIds = [...new Set(w.lines.map((l) => l.itemId))];
  const items = itemIds.length ? await db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku, barcode: schema.invItems.barcode, unit: schema.invItems.unit, trackSerials: schema.invItems.trackSerials }).from(schema.invItems).where(inArray(schema.invItems.id, itemIds)) : [];
  // Where to pick from: bins holding the item (not quarantine), fullest first.
  const binRows = itemIds.length ? await db.select({ itemId: schema.invBinStock.itemId, binId: schema.invBins.id, code: schema.invBins.code, zone: schema.invBins.zone, qty: schema.invBinStock.qty, batch: schema.invBinStock.batch }).from(schema.invBinStock).innerJoin(schema.invBins, eq(schema.invBins.id, schema.invBinStock.binId)).where(and(eq(schema.invBins.warehouseId, w.warehouseId), inArray(schema.invBinStock.itemId, itemIds), gt(schema.invBinStock.qty, 0), sql`${schema.invBins.kind} <> 'quarantine'`)).orderBy(asc(schema.invBins.zone), asc(schema.invBins.code)) : [];
  return { wave: w, orders, items, bins: binRows.map((b) => ({ ...b, qty: Number(b.qty) })) };
}

export async function createWave(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(waveSchema, raw);
  requireWarehouseAccess(s, v.warehouseId);
  const ok = new Set((await waveCandidates(s, v.warehouseId)).map((c) => c.id));
  for (const id of v.orderIds) if (!ok.has(id)) throw new ApiError("validation_failed", "Some of those orders aren't ready to pick from this location");
  const orders = await db.select().from(schema.salesOrders).where(inArray(schema.salesOrders.id, v.orderIds));
  const lines = orders.flatMap((o) => o.lines.filter((l) => l.itemId && l.qty - l.delivered > 0.0005).map((l) => ({ orderId: o.id, lineId: l.id, itemId: l.itemId!, qty: q3(l.qty - l.delivered), picked: 0, binId: null as string | null, batch: "", serials: [] as string[] })));
  const number = await nextWave(s.orgId, s.settings.wavePrefix);
  const [w] = await db.insert(schema.invWaves).values({ orgId: s.orgId, number, warehouseId: v.warehouseId, orderIds: v.orderIds, lines, createdBy: s.userId }).returning();
  return w;
}

/** Record what was picked for each line: quantity, the bin it came from, and serials. */
export async function pickWave(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const w = await getWave(s.orgId, id);
  if (w.status !== "picking") throw new ApiError("conflict", "This wave is past picking");
  const body = (raw as { lines?: { orderId: string; lineId: string; picked: number; binId?: string | null; batch?: string; serials?: string[] }[] })?.lines ?? [];
  const lines = w.lines.map((l) => {
    const p = body.find((b) => b.orderId === l.orderId && b.lineId === l.lineId);
    if (!p) return l;
    const picked = q3(Number(p.picked) || 0);
    if (picked < 0 || picked > l.qty + 0.0005) throw new ApiError("validation_failed", `Pick between 0 and ${l.qty}`);
    return { ...l, picked, binId: p.binId ?? null, batch: p.batch ?? l.batch, serials: (p.serials ?? l.serials).map((x) => x.trim()).filter(Boolean) };
  });
  const [r] = await db.update(schema.invWaves).set({ lines }).where(eq(schema.invWaves.id, id)).returning();
  return r;
}

export async function packWave(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const w = await getWave(s.orgId, id);
  if (w.status !== "picking") throw new ApiError("conflict", "This wave is already packed");
  if (!w.lines.some((l) => l.picked > 0)) throw new ApiError("conflict", "Pick something first");
  const packages = ((raw as { packages?: { orderId: string; boxes: number; weightKg: number }[] })?.packages ?? []).filter((p) => w.orderIds.includes(p.orderId)).map((p) => ({ orderId: p.orderId, boxes: Math.max(1, Math.round(Number(p.boxes) || 1)), weightKg: Math.max(0, Number(p.weightKg) || 0) }));
  const [r] = await db.update(schema.invWaves).set({ packages, status: "packed" }).where(eq(schema.invWaves.id, id)).returning();
  return r;
}

/** Dispatch: one delivery challan per order for what was picked — stock comes out of the bins it was picked from. */
export async function dispatchWave(s: Scope, id: string, deliver: (orderId: string, warehouseId: string, lines: { lineId: string; qty: number; binId: string | null; batch: string; serials: string[] }[]) => Promise<{ number: string }>) {
  requireWrite(s);
  const w = await getWave(s.orgId, id);
  if (!["picking", "packed"].includes(w.status)) throw new ApiError("conflict", `This wave is ${w.status}`);
  const challans: string[] = [];
  for (const orderId of w.orderIds) {
    const lines = w.lines.filter((l) => l.orderId === orderId && l.picked > 0).map((l) => ({ lineId: l.lineId, qty: l.picked, binId: l.binId, batch: l.batch, serials: l.serials }));
    if (lines.length) challans.push((await deliver(orderId, w.warehouseId, lines)).number);
  }
  if (!challans.length) throw new ApiError("conflict", "Nothing was picked");
  await db.update(schema.invWaves).set({ status: "dispatched", dispatchedAt: new Date() }).where(eq(schema.invWaves.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.wave_dispatched", targetType: "inv_wave", targetId: id, metadata: { number: w.number, challans } });
  return { challans };
}

export async function cancelWave(s: Scope, id: string) {
  requireWrite(s);
  const w = await getWave(s.orgId, id);
  if (w.status === "dispatched") throw new ApiError("conflict", "A dispatched wave can't be cancelled");
  await db.update(schema.invWaves).set({ status: "cancelled" }).where(eq(schema.invWaves.id, id));
}

// ── Scanning ────────────────────────────────────────────────────────────────

/** What a scanned code is: an item (barcode or SKU), a serial number, or a bin. */
export async function scan(s: Scope, code: string) {
  const c = code.trim();
  if (!c) throw new ApiError("validation_failed", "Scan or type a code");
  const [item] = await db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), sql`(${schema.invItems.barcode} = ${c} or lower(${schema.invItems.sku}) = ${c.toLowerCase()})`)).limit(1);
  if (item) return { kind: "item" as const, item: { id: item.id, name: item.name, sku: item.sku, unit: item.unit, trackSerials: item.trackSerials } };
  const [ser] = await db.select({ x: schema.invSerials, name: schema.invItems.name }).from(schema.invSerials).innerJoin(schema.invItems, eq(schema.invItems.id, schema.invSerials.itemId)).where(and(eq(schema.invSerials.orgId, s.orgId), sql`lower(${schema.invSerials.serial}) = ${c.toLowerCase()}`)).limit(1);
  if (ser) return { kind: "serial" as const, serial: { ...ser.x, item: ser.name } };
  const [bin] = await db.select().from(schema.invBins).where(and(eq(schema.invBins.orgId, s.orgId), sql`lower(${schema.invBins.code}) = ${c.toLowerCase()}`)).limit(1);
  if (bin) return { kind: "bin" as const, bin };
  throw new ApiError("not_found", `Nothing matches “${c}”`);
}

// ── Valuation, ageing, ABC and counts due ───────────────────────────────────

/** Each item's stock valued by average cost and by FIFO, with its age by receipt. */
export async function stockValue(s: Scope) {
  const today = todayIst();
  const [items, bal, recv] = await Promise.all([
    db.select().from(schema.invItems).where(eq(schema.invItems.orgId, s.orgId)),
    balances(s.orgId),
    // Every positive movement with a cost, newest first.
    db.select({ itemId: schema.invMoves.itemId, qty: schema.invMoves.qty, unitCost: schema.invMoves.unitCost, at: schema.invMoves.createdAt }).from(schema.invMoves).where(and(eq(schema.invMoves.orgId, s.orgId), gt(schema.invMoves.qty, 0), sql`${schema.invMoves.kind} in ('receive','return','adjust','count','transfer_in')`)).orderBy(desc(schema.invMoves.createdAt)),
  ]);
  const tot = totals(bal);
  const byItem = new Map<string, { qty: number; unitCost: number; date: string }[]>();
  for (const r of recv) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), { qty: Number(r.qty), unitCost: r.unitCost, date: new Date(r.at.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) }]);
  const rows = items
    .filter((it) => (tot.get(it.id) ?? 0) > 0)
    .map((it) => {
      const onHand = tot.get(it.id) ?? 0;
      const f = fifoLayers(onHand, byItem.get(it.id) ?? [], it.avgCost);
      return { id: it.id, name: it.name, sku: it.sku, unit: it.unit, category: it.category, onHand, average: Math.round(onHand * it.avgCost), fifo: f.value, ages: ageing(f.layers, today) };
    });
  const buckets = rows[0]?.ages.map((a, i) => ({ bucket: a.bucket, value: rows.reduce((n, r) => n + r.ages[i].value, 0) })) ?? [];
  return { method: s.settings.valuation, rows, buckets, totals: { average: rows.reduce((a, r) => a + r.average, 0), fifo: rows.reduce((a, r) => a + r.fifo, 0) } };
}

/** ABC classes from a year's issues at cost, and the items due a count at each location. */
export async function countsDue(s: Scope) {
  const since = new Date(Date.now() - 365 * 86_400_000);
  const used = await db.select({ itemId: schema.invMoves.itemId, value: sql<number>`sum(-${schema.invMoves.qty} * ${schema.invMoves.unitCost})::float` }).from(schema.invMoves).where(and(eq(schema.invMoves.orgId, s.orgId), sql`${schema.invMoves.qty} < 0`, sql`${schema.invMoves.kind} in ('issue','adjust')`, sql`${schema.invMoves.createdAt} >= ${since}`)).groupBy(schema.invMoves.itemId);
  const items = await db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), eq(schema.invItems.active, true)));
  const cls = abc(items.map((i) => ({ id: i.id, value: Number(used.find((u) => u.itemId === i.id)?.value ?? 0) })));
  // Last counted: from count sheets (a count that matched the books moves no stock but still counts).
  const last = ((await db.execute(sql`
    select l->>'itemId' as "itemId", c.warehouse_id as "warehouseId", max(c.created_at) as at
    from inv_counts c cross join lateral jsonb_array_elements(c.lines) l
    where c.org_id = ${s.orgId} group by 1, 2`)) as unknown as { rows: { itemId: string; warehouseId: string; at: string }[] }).rows;
  const bal = await balances(s.orgId);
  const now = Date.now();
  const due: { itemId: string; name: string; sku: string; warehouseId: string; cls: "A" | "B" | "C"; lastCounted: string | null; overdueDays: number }[] = [];
  for (const b of bal) {
    if (s.warehouses && !s.warehouses.has(b.warehouseId)) continue;
    const it = items.find((i) => i.id === b.itemId);
    if (!it || due.some((d) => d.itemId === b.itemId && d.warehouseId === b.warehouseId)) continue;
    const c = cls.get(it.id) ?? "C";
    const l = last.find((x) => x.itemId === it.id && x.warehouseId === b.warehouseId);
    const every = s.settings.countEvery[c];
    const age = l ? Math.floor((now - new Date(l.at).getTime()) / 86_400_000) : Infinity;
    if (age >= every) due.push({ itemId: it.id, name: it.name, sku: it.sku, warehouseId: b.warehouseId, cls: c, lastCounted: l ? new Date(l.at).toISOString().slice(0, 10) : null, overdueDays: Number.isFinite(age) ? age - every : 0 });
  }
  const order = { A: 0, B: 1, C: 2 };
  return { classes: Object.fromEntries(cls), every: s.settings.countEvery, due: due.sort((a, b) => order[a.cls] - order[b.cls] || b.overdueDays - a.overdueDays) };
}

