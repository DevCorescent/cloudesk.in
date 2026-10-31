// Work centres, recipes (bill of materials + routing) and work orders.
// A work order is planned from a recipe, released (materials reserved),
// materials are issued out of stock at their cost, operations are timed, and
// completing it receives the output into stock at its real unit cost —
// materials plus conversion (time at the work centre's rate).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { bomSchema, completeSchema, conversionCost, issueSchema, plan, q3, timeSchema, variances, workCentreSchema, workOrderSchema } from "@/lib/manufacturing/model";
import { weightedAverage } from "@/lib/inventory/model";
import { ApiError, notFound } from "../http/errors";
import { ensureDefaultWarehouse } from "../inventory/items";
import { allocate, balances, getItem, getWarehouse, move, totals } from "../inventory/stock";
import { audit } from "../services/audit";
import { check, nextNumber, requireManage, requirePart, requireWrite, stockScope, type Scope } from "./access";

// ── Work centres ────────────────────────────────────────────────────────────

export async function workCentres(orgId: string) {
  return db.select().from(schema.mfgWorkCentres).where(eq(schema.mfgWorkCentres.orgId, orgId)).orderBy(asc(schema.mfgWorkCentres.code));
}

export async function saveWorkCentre(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  requirePart(s, "routing");
  const v = check(workCentreSchema, raw);
  const [dup] = await db.select({ id: schema.mfgWorkCentres.id }).from(schema.mfgWorkCentres).where(and(eq(schema.mfgWorkCentres.orgId, s.orgId), sql`lower(${schema.mfgWorkCentres.code}) = ${v.code.toLowerCase()}`));
  if (dup && dup.id !== id) throw new ApiError("conflict", `There's already a work centre ${v.code}`);
  if (id) {
    const [r] = await db.update(schema.mfgWorkCentres).set(v).where(and(eq(schema.mfgWorkCentres.id, id), eq(schema.mfgWorkCentres.orgId, s.orgId))).returning();
    if (!r) throw notFound("Work centre");
    return r;
  }
  const [r] = await db.insert(schema.mfgWorkCentres).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

// ── Recipes ─────────────────────────────────────────────────────────────────

export async function boms(s: Scope) {
  return db.select({ b: schema.mfgBoms, item: schema.invItems.name, unit: schema.invItems.unit }).from(schema.mfgBoms).innerJoin(schema.invItems, eq(schema.invItems.id, schema.mfgBoms.itemId)).where(eq(schema.mfgBoms.orgId, s.orgId)).orderBy(asc(schema.invItems.name)).then((r) => r.map((x) => ({ ...x.b, item: x.item, unit: x.unit })));
}

async function getBom(orgId: string, id: string) {
  const [b] = await db.select().from(schema.mfgBoms).where(and(eq(schema.mfgBoms.id, id), eq(schema.mfgBoms.orgId, orgId)));
  if (!b) throw notFound("Recipe");
  return b;
}

/** A recipe with its standard cost per unit: components at average cost plus time at the centres' rates. */
export async function bomDetail(s: Scope, id: string) {
  const b = await getBom(s.orgId, id);
  const items = await db.select({ id: schema.invItems.id, name: schema.invItems.name, unit: schema.invItems.unit, avgCost: schema.invItems.avgCost }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), inArray(schema.invItems.id, [b.itemId, ...b.lines.map((l) => l.itemId)])));
  const centres = await workCentres(s.orgId);
  const p = plan({ ...b, outputQty: Number(b.outputQty) }, Number(b.outputQty));
  const material = p.materials.reduce((a, m) => a + Math.round(m.required * (items.find((i) => i.id === m.itemId)?.avgCost ?? 0)), 0);
  const conversion = conversionCost(p.operations, new Map(centres.map((c) => [c.id, c.costPerHour])));
  return { bom: b, items, centres, standard: { material, conversion, perUnit: Math.round((material + conversion) / Number(b.outputQty)) } };
}

/** Recipes can't use the item they make, directly or through another recipe. */
async function assertNoLoop(orgId: string, itemId: string, lines: { itemId: string }[], skip: string | null) {
  const all = await db.select({ id: schema.mfgBoms.id, itemId: schema.mfgBoms.itemId, lines: schema.mfgBoms.lines }).from(schema.mfgBoms).where(and(eq(schema.mfgBoms.orgId, orgId), eq(schema.mfgBoms.active, true)));
  const uses = new Map<string, string[]>();
  for (const b of all) if (b.id !== skip) uses.set(b.itemId, [...(uses.get(b.itemId) ?? []), ...b.lines.map((l) => l.itemId)]);
  uses.set(itemId, [...(uses.get(itemId) ?? []), ...lines.map((l) => l.itemId)]);
  const seen = new Set<string>();
  const walk = (id: string, depth: number): boolean => {
    if (depth > 30) return true;
    for (const c of uses.get(id) ?? []) {
      if (c === itemId) return true;
      if (seen.has(`${id}>${c}`)) continue;
      seen.add(`${id}>${c}`);
      if (walk(c, depth + 1)) return true;
    }
    return false;
  };
  if (walk(itemId, 0)) throw new ApiError("validation_failed", "A recipe can't use what it makes, even through another recipe");
}

export async function saveBom(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(bomSchema, raw);
  const ids = [v.itemId, ...v.lines.map((l) => l.itemId)];
  if ((await db.select({ id: schema.invItems.id }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), inArray(schema.invItems.id, ids)))).length !== new Set(ids).size) throw new ApiError("validation_failed", "Use items from Inventory");
  if (v.lines.some((l) => l.itemId === v.itemId)) throw new ApiError("validation_failed", "A recipe can't use what it makes");
  if (new Set(v.lines.map((l) => l.itemId)).size !== v.lines.length) throw new ApiError("validation_failed", "List each component once");
  if (v.operations.length) {
    requirePart(s, "routing");
    const cs = new Set((await workCentres(s.orgId)).map((c) => c.id));
    if (v.operations.some((o) => !cs.has(o.workCentreId))) throw new ApiError("validation_failed", "Use work centres from this workspace");
  }
  await assertNoLoop(s.orgId, v.itemId, v.lines, id);
  return db.transaction(async (tx) => {
    // One default recipe per item.
    if (v.isDefault) await tx.update(schema.mfgBoms).set({ isDefault: false }).where(and(eq(schema.mfgBoms.orgId, s.orgId), eq(schema.mfgBoms.itemId, v.itemId)));
    if (id) {
      await getBom(s.orgId, id);
      const [r] = await tx.update(schema.mfgBoms).set({ ...v, updatedAt: new Date() }).where(eq(schema.mfgBoms.id, id)).returning();
      return r;
    }
    const [r] = await tx.insert(schema.mfgBoms).values({ ...v, orgId: s.orgId }).returning();
    return r;
  });
}

export async function deleteBom(s: Scope, id: string) {
  requireManage(s);
  const [used] = await db.select({ id: schema.mfgWorkOrders.id }).from(schema.mfgWorkOrders).where(and(eq(schema.mfgWorkOrders.bomId, id), inArray(schema.mfgWorkOrders.status, ["draft", "released", "in_progress"]))).limit(1);
  if (used) throw new ApiError("conflict", "Open work orders use this recipe — switch it off instead");
  await db.delete(schema.mfgBoms).where(and(eq(schema.mfgBoms.id, id), eq(schema.mfgBoms.orgId, s.orgId)));
}

export async function defaultBom(orgId: string, itemId: string) {
  const [b] = await db.select().from(schema.mfgBoms).where(and(eq(schema.mfgBoms.orgId, orgId), eq(schema.mfgBoms.itemId, itemId), eq(schema.mfgBoms.active, true))).orderBy(desc(schema.mfgBoms.isDefault)).limit(1);
  return b ?? null;
}

// ── Work orders ─────────────────────────────────────────────────────────────

async function getWo(orgId: string, id: string) {
  const [w] = await db.select().from(schema.mfgWorkOrders).where(and(eq(schema.mfgWorkOrders.id, id), eq(schema.mfgWorkOrders.orgId, orgId)));
  if (!w) throw notFound("Work order");
  return w;
}

export async function workOrders(s: Scope, q: { status?: string } = {}) {
  return db
    .select({ w: schema.mfgWorkOrders, item: schema.invItems.name, unit: schema.invItems.unit })
    .from(schema.mfgWorkOrders)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.mfgWorkOrders.itemId))
    .where(and(eq(schema.mfgWorkOrders.orgId, s.orgId), q.status === "open" ? inArray(schema.mfgWorkOrders.status, ["draft", "released", "in_progress"]) : q.status ? eq(schema.mfgWorkOrders.status, q.status) : undefined))
    .orderBy(desc(schema.mfgWorkOrders.createdAt))
    .limit(300)
    .then((r) => r.map((x) => ({ ...x.w, item: x.item, unit: x.unit })));
}

export async function workOrderDetail(s: Scope, id: string) {
  const w = await getWo(s.orgId, id);
  const ids = [w.itemId, ...w.materials.map((m) => m.itemId)];
  const [items, centres, bal] = await Promise.all([
    db.select({ id: schema.invItems.id, name: schema.invItems.name, unit: schema.invItems.unit, avgCost: schema.invItems.avgCost, trackBatches: schema.invItems.trackBatches }).from(schema.invItems).where(inArray(schema.invItems.id, ids)),
    workCentres(s.orgId),
    balances(s.orgId, { itemIds: ids, warehouseId: w.warehouseId }),
  ]);
  const onHand = totals(bal);
  const v = w.status === "done" ? variances(w.materials, Number(w.qty), Number(w.produced), new Map(items.map((i) => [i.id, i.avgCost])), w.operations) : null;
  const made = items.find((i) => i.id === w.itemId);
  return { order: { ...w, item: made?.name ?? "", unit: made?.unit ?? "" }, items, centres, onHand: Object.fromEntries(onHand), variances: v };
}

export async function saveWorkOrder(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(workOrderSchema, raw);
  await getItem(s.orgId, v.itemId);
  const bom = v.bomId ? await getBom(s.orgId, v.bomId) : await defaultBom(s.orgId, v.itemId);
  if (!bom) throw new ApiError("validation_failed", "This item has no recipe — add one first", { bomId: ["Add a recipe"] });
  if (bom.itemId !== v.itemId) throw new ApiError("validation_failed", "That recipe is for another item");
  let warehouseId = v.warehouseId ?? s.settings.defaultWarehouseId;
  if (!warehouseId) {
    await ensureDefaultWarehouse(s.orgId);
    warehouseId = (await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.isDefault, true))))[0]?.id ?? null;
  }
  if (!warehouseId) throw new ApiError("validation_failed", "Pick a location");
  await getWarehouse(s.orgId, warehouseId);
  if (v.plannedStart && v.plannedEnd && v.plannedEnd < v.plannedStart) throw new ApiError("validation_failed", "It can't finish before it starts");
  const p = plan({ ...bom, outputQty: Number(bom.outputQty) }, v.qty);
  const values = { ...v, bomId: bom.id, warehouseId, materials: p.materials, operations: p.operations };
  if (id) {
    const cur = await getWo(s.orgId, id);
    if (cur.status !== "draft") throw new ApiError("conflict", "Only a draft work order can change");
    const [r] = await db.update(schema.mfgWorkOrders).set(values).where(eq(schema.mfgWorkOrders.id, id)).returning();
    return r;
  }
  const number = await nextNumber(s.orgId, s.settings.workOrderPrefix);
  const [r] = await db.insert(schema.mfgWorkOrders).values({ ...values, number, orgId: s.orgId, createdBy: s.userId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "manufacturing.work_order_created", targetType: "mfg_work_order", targetId: r.id, metadata: { number, qty: v.qty } });
  return r;
}

/** What's still to issue for each material, reserved against the location while the order is open. */
async function syncReservations(orgId: string, w: { id: string; number: string; status: string; warehouseId: string; materials: { itemId: string; required: number; issued: number }[] }) {
  await db.delete(schema.invReservations).where(and(eq(schema.invReservations.refType, "work_order"), eq(schema.invReservations.refId, w.id)));
  if (!["released", "in_progress"].includes(w.status)) return;
  const rows = w.materials.filter((m) => m.required - m.issued > 0.0005).map((m) => ({ orgId, itemId: m.itemId, warehouseId: w.warehouseId, qty: q3(m.required - m.issued), refType: "work_order", refId: w.id, lineId: m.itemId, refNo: w.number }));
  if (rows.length) await db.insert(schema.invReservations).values(rows);
}

export async function releaseWorkOrder(s: Scope, id: string) {
  requireWrite(s);
  const w = await getWo(s.orgId, id);
  if (w.status !== "draft") throw new ApiError("conflict", "Only a draft can be released");
  const [r] = await db.update(schema.mfgWorkOrders).set({ status: "released" }).where(eq(schema.mfgWorkOrders.id, id)).returning();
  await syncReservations(s.orgId, r);
  return r;
}

/** Issue materials (a negative quantity returns unused material to stock). */
export async function issueMaterials(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const w = await getWo(s.orgId, id);
  if (!["released", "in_progress"].includes(w.status)) throw new ApiError("conflict", w.status === "draft" ? "Release the work order first" : `This work order is ${w.status}`);
  const v = check(issueSchema, raw);
  const ss = await stockScope(s);
  if (ss.warehouses && !ss.warehouses.has(w.warehouseId)) throw new ApiError("forbidden", "You can't work with stock in that location");
  const wh = await getWarehouse(s.orgId, w.warehouseId);
  const materials = w.materials.map((m) => ({ ...m }));
  let cost = 0;
  await db.transaction(async (tx) => {
    for (const l of v.lines.filter((x) => x.qty)) {
      let m = materials.find((x) => x.itemId === l.itemId);
      if (!m) {
        // Something not in the recipe (a substitute): it's added with nothing required.
        m = { itemId: l.itemId, required: 0, issued: 0 };
        materials.push(m);
      }
      if (l.qty < 0 && -l.qty > m.issued + 0.0005) throw new ApiError("validation_failed", "You can't return more than was issued");
      const item = await getItem(s.orgId, l.itemId, tx);
      const parts = l.qty > 0 ? await allocate(tx, item, wh, l.qty, l.batch) : [{ batch: l.batch, qty: l.qty }];
      for (const part of parts) await move(tx, ss, { item, warehouse: wh, qty: -part.qty, kind: l.qty > 0 ? "issue" : "return", batch: part.batch, unitCost: item.avgCost, refType: "work_order", refId: w.id, refNo: w.number, note: l.qty > 0 ? "Issued to production" : "Returned from production" });
      m.issued = q3(m.issued + l.qty);
      cost += Math.round(l.qty * item.avgCost);
    }
    await tx.update(schema.mfgWorkOrders).set({ materials, materialCost: sql`${schema.mfgWorkOrders.materialCost} + ${cost}`, status: "in_progress" }).where(eq(schema.mfgWorkOrders.id, id));
  });
  const r = await getWo(s.orgId, id);
  await syncReservations(s.orgId, r);
  return r;
}

/** Shop floor: minutes spent on an operation, and whether it's finished. */
export async function logTime(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  requirePart(s, "routing");
  const w = await getWo(s.orgId, id);
  if (!["released", "in_progress"].includes(w.status)) throw new ApiError("conflict", w.status === "draft" ? "Release the work order first" : `This work order is ${w.status}`);
  const v = check(timeSchema, raw);
  if (!w.operations.some((o) => o.id === v.operationId)) throw new ApiError("validation_failed", "That operation isn't on this work order");
  const operations = w.operations.map((o) => (o.id === v.operationId ? { ...o, actualMinutes: Math.round(v.minutes), done: v.done } : o));
  const [r] = await db.update(schema.mfgWorkOrders).set({ operations, status: "in_progress" }).where(eq(schema.mfgWorkOrders.id, id)).returning();
  return r;
}

/**
 * Finish: the output goes into stock at materials + conversion, divided over
 * what was made (scrap carries no value of its own). The item's average cost
 * takes it in like a purchase.
 */
export async function completeWorkOrder(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const w = await getWo(s.orgId, id);
  if (w.status !== "in_progress") throw new ApiError("conflict", w.status === "released" ? "Issue materials before finishing" : `This work order is ${w.status}`);
  const v = check(completeSchema, raw);
  if (!(v.produced > 0)) throw new ApiError("validation_failed", "Enter how many were made");
  const item = await getItem(s.orgId, w.itemId);
  if (item.trackBatches && !v.batch) throw new ApiError("validation_failed", `${item.name} is tracked by batch — give the output a batch number`);
  if (item.trackSerials) throw new ApiError("validation_failed", "Items with serial numbers can't be made here yet — receive them with their serials instead");
  const ss = await stockScope(s);
  const wh = await getWarehouse(s.orgId, w.warehouseId);
  const rates = new Map((await workCentres(s.orgId)).map((c) => [c.id, c.costPerHour]));
  const conversion = conversionCost(w.operations, rates);
  const unitCost = Math.round((w.materialCost + conversion) / v.produced);
  const before = totals(await balances(s.orgId, { itemIds: [item.id] })).get(item.id) ?? 0;
  await db.transaction(async (tx) => {
    await move(tx, ss, { item, warehouse: wh, qty: v.produced, kind: "receive", batch: v.batch, expiry: v.expiry, unitCost, refType: "work_order", refId: w.id, refNo: w.number, note: "Made" });
    await tx.update(schema.invItems).set({ avgCost: weightedAverage(before, item.avgCost, v.produced, unitCost), updatedAt: new Date() }).where(eq(schema.invItems.id, item.id));
    await tx.update(schema.mfgWorkOrders).set({ status: "done", produced: v.produced, scrap: v.scrap, conversionCost: conversion, unitCost, completedAt: new Date() }).where(eq(schema.mfgWorkOrders.id, id));
  });
  const r = await getWo(s.orgId, id);
  await syncReservations(s.orgId, r);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "manufacturing.work_order_done", targetType: "mfg_work_order", targetId: id, metadata: { number: w.number, produced: v.produced, scrap: v.scrap, unitCost } });
  const { queueInspections } = await import("../quality/core");
  await queueInspections(s.orgId, "production", { type: "work_order", id: w.id, no: w.number }, [{ itemId: w.itemId, qty: v.produced, warehouseId: w.warehouseId, batch: v.batch, binId: null, supplierId: null }]);
  // The books take in the conversion cost (time moved into stock value).
  const { syncIfStale } = await import("../accounting/sync");
  const { systemScope } = await import("../accounting/access");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  if (!org?.modules || org.modules.includes("accounting")) await syncIfStale(await systemScope(s.orgId)).catch(() => undefined);
  return r;
}

export async function cancelWorkOrder(s: Scope, id: string) {
  requireWrite(s);
  const w = await getWo(s.orgId, id);
  if (w.status === "done") throw new ApiError("conflict", "A finished work order can't be cancelled");
  if (w.materials.some((m) => m.issued > 0.0005)) throw new ApiError("conflict", "Return the issued materials to stock first");
  const [r] = await db.update(schema.mfgWorkOrders).set({ status: "cancelled" }).where(eq(schema.mfgWorkOrders.id, id)).returning();
  await syncReservations(s.orgId, r);
  return r;
}

/** For the books: finished orders move their conversion cost into stock value. */
export async function productionWants(orgId: string) {
  const rows = await db.select({ w: schema.mfgWorkOrders, item: schema.invItems.name }).from(schema.mfgWorkOrders).innerJoin(schema.invItems, eq(schema.invItems.id, schema.mfgWorkOrders.itemId)).where(and(eq(schema.mfgWorkOrders.orgId, orgId), eq(schema.mfgWorkOrders.status, "done"), sql`${schema.mfgWorkOrders.conversionCost} > 0`));
  return rows.map(({ w, item }) => ({
    sourceType: "production",
    sourceId: w.id,
    date: new Date((w.completedAt ?? w.createdAt).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10),
    narration: `Made ${w.produced} ${item} (${w.number}) — time and machine cost into stock`,
    sourceRef: w.number,
    party: "",
    lines: [{ key: "inventory", debit: w.conversionCost, credit: 0 }, { key: "production_absorbed", debit: 0, credit: w.conversionCost }],
  }));
}
