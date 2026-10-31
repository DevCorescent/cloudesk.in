// Planning: MRP from open sales orders, work orders' materials and safety
// stock against what's free and coming in; turning its suggestions into draft
// work orders and a requisition (or draft purchase orders); capacity of work
// centres; and the production numbers for the home screen.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { load, mrp, q3, variances } from "@/lib/manufacturing/model";
import { isPartOn } from "@/lib/workspace/modules";
import { ApiError } from "../http/errors";
import { balances, onOrder, quarantined, totals } from "../inventory/stock";
import { requirePart, requireWrite, stockScope, todayIst, type Scope } from "./access";
import { saveWorkOrder, workCentres } from "./production";

export async function runMrp(s: Scope) {
  requirePart(s, "mrp");
  const horizon = new Date(Date.now() + s.settings.horizonDays * 86_400_000).toISOString().slice(0, 10);
  const [items, boms, orders, wos, bal, quar, po] = await Promise.all([
    db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), eq(schema.invItems.active, true))),
    db.select().from(schema.mfgBoms).where(and(eq(schema.mfgBoms.orgId, s.orgId), eq(schema.mfgBoms.active, true))),
    db.select().from(schema.salesOrders).where(and(eq(schema.salesOrders.orgId, s.orgId), inArray(schema.salesOrders.status, ["confirmed", "partial", "pending_approval"]))),
    db.select().from(schema.mfgWorkOrders).where(and(eq(schema.mfgWorkOrders.orgId, s.orgId), inArray(schema.mfgWorkOrders.status, ["draft", "released", "in_progress"]))),
    balances(s.orgId),
    quarantined(s.orgId),
    onOrder(s.orgId),
  ]);
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, q3((m.get(k) ?? 0) + v));
  // Demand: goods still to deliver on orders due within the horizon (or with no date), and materials open work orders still need.
  const demand = new Map<string, number>();
  for (const o of orders) if (!o.expectedDate || String(o.expectedDate) <= horizon) for (const l of o.lines) if (l.itemId && l.qty > l.delivered) add(demand, l.itemId, l.qty - l.delivered);
  for (const w of wos) for (const m of w.materials) if (m.required > m.issued) add(demand, m.itemId, m.required - m.issued);
  // Supply: on hand less quarantine, open purchase orders and what open work orders will make.
  const onHand = totals(bal);
  const available = new Map([...onHand].map(([k, v]) => [k, q3(v - (quar.get(k) ?? 0))]));
  const incoming = new Map(po);
  for (const w of wos) add(incoming, w.itemId, Math.max(0, Number(w.qty) - Number(w.produced)));
  const defaults = new Map<string, (typeof boms)[number]>();
  for (const b of boms.sort((a, b2) => Number(b2.isDefault) - Number(a.isDefault))) if (!defaults.has(b.itemId)) defaults.set(b.itemId, b);
  const r = mrp({
    demand,
    available,
    incoming,
    safety: new Map(items.filter((i) => Number(i.safetyStock) > 0).map((i) => [i.id, Number(i.safetyStock)])),
    boms: new Map([...defaults].map(([k, b]) => [k, { outputQty: Number(b.outputQty), lines: b.lines }])),
    reorderQty: new Map(items.map((i) => [i.id, Number(i.reorderQty)])),
  });
  const info = (id: string) => {
    const it = items.find((i) => i.id === id);
    return { name: it?.name ?? "Item", unit: it?.unit ?? "", supplierId: it?.supplierId ?? null, bomId: defaults.get(id)?.id ?? null };
  };
  return { horizon, make: r.make.map((x) => ({ ...x, ...info(x.itemId) })), buy: r.buy.map((x) => ({ ...x, ...info(x.itemId) })), cyclic: r.cyclic };
}

/** Draft work orders for the items MRP says to make. */
export async function makeFromMrp(s: Scope, raw: unknown) {
  requireWrite(s);
  const lines = ((raw as { lines?: { itemId: string; qty: number }[] })?.lines ?? []).filter((l) => l.qty > 0);
  if (!lines.length) throw new ApiError("validation_failed", "Pick something to make");
  const made: string[] = [];
  for (const l of lines) made.push((await saveWorkOrder(s, null, { itemId: l.itemId, qty: l.qty, plannedStart: todayIst(), notes: "From MRP" })).id);
  return { workOrderIds: made };
}

/** What MRP says to buy: one requisition when Procurement is on, otherwise draft purchase orders by usual supplier. */
export async function buyFromMrp(s: Scope, raw: unknown) {
  requireWrite(s);
  const lines = ((raw as { lines?: { itemId: string; qty: number }[] })?.lines ?? []).filter((l) => l.qty > 0);
  if (!lines.length) throw new ApiError("validation_failed", "Pick something to buy");
  const inv = await stockScope(s);
  const [wh] = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.isDefault, true)));
  const warehouseId = s.settings.defaultWarehouseId ?? wh?.id;
  if (!warehouseId) throw new ApiError("conflict", "Add a location in Inventory first");
  if (isPartOn(s.partsOff, "inventory", "procurement") && isPartOn(s.partsOff, "inventory", "purchasing")) {
    const { saveRequisition } = await import("../inventory/procurement");
    const r = await saveRequisition(inv, null, { warehouseId, reason: "From MRP", lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) });
    return { requisitionId: r.id, number: r.number };
  }
  const { savePo } = await import("../inventory/purchasing");
  const items = await db.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), inArray(schema.invItems.id, lines.map((l) => l.itemId))));
  const bySupplier = new Map<string, typeof lines>();
  const noSupplier: string[] = [];
  for (const l of lines) {
    const it = items.find((i) => i.id === l.itemId);
    if (!it?.supplierId) noSupplier.push(it?.name ?? "Item");
    else bySupplier.set(it.supplierId, [...(bySupplier.get(it.supplierId) ?? []), l]);
  }
  const poIds: string[] = [];
  for (const [supplierId, ls] of bySupplier) poIds.push((await savePo(inv, null, { supplierId, warehouseId, orderDate: todayIst(), notes: "From MRP", lines: ls.map((l) => { const it = items.find((i) => i.id === l.itemId)!; return { itemId: l.itemId, qty: l.qty, rate: it.avgCost, gstRate: it.gstRate }; }) })).id);
  return { poIds, noSupplier };
}

/** How loaded each work centre is over the next days, from released and running work orders. */
export async function capacity(s: Scope, days = 14) {
  requirePart(s, "routing");
  const [centres, wos] = await Promise.all([workCentres(s.orgId), db.select().from(schema.mfgWorkOrders).where(and(eq(schema.mfgWorkOrders.orgId, s.orgId), inArray(schema.mfgWorkOrders.status, ["released", "in_progress"])))]);
  const l = load(wos, centres.filter((c) => c.active), days);
  return { days, centres: l.map((x) => ({ ...x, ...centres.find((c) => c.id === x.workCentreId)! })) };
}

export async function home(s: Scope) {
  const month = todayIst().slice(0, 7);
  const wos = await db.select({ w: schema.mfgWorkOrders, item: schema.invItems.name, unit: schema.invItems.unit }).from(schema.mfgWorkOrders).innerJoin(schema.invItems, eq(schema.invItems.id, schema.mfgWorkOrders.itemId)).where(eq(schema.mfgWorkOrders.orgId, s.orgId));
  const open = wos.filter((x) => ["released", "in_progress"].includes(x.w.status));
  const done = wos.filter((x) => x.w.status === "done" && x.w.completedAt && x.w.completedAt.toISOString().slice(0, 7) === month);
  const costs = new Map((await db.select({ id: schema.invItems.id, avgCost: schema.invItems.avgCost }).from(schema.invItems).where(eq(schema.invItems.orgId, s.orgId))).map((i) => [i.id, i.avgCost]));
  return {
    wip: { count: wos.filter((x) => x.w.status === "in_progress").length, value: wos.filter((x) => x.w.status === "in_progress").reduce((a, x) => a + x.w.materialCost, 0) },
    released: open.length,
    late: open.filter((x) => x.w.plannedEnd && String(x.w.plannedEnd) < todayIst()).map((x) => ({ id: x.w.id, number: x.w.number, item: x.item, plannedEnd: x.w.plannedEnd })),
    month: { orders: done.length, value: done.reduce((a, x) => a + Math.round(Number(x.w.produced) * x.w.unitCost), 0) },
    recent: done
      .slice(-8)
      .reverse()
      .map((x) => ({ id: x.w.id, number: x.w.number, item: x.item, unit: x.unit, produced: Number(x.w.produced), unitCost: x.w.unitCost, ...variances(x.w.materials, Number(x.w.qty), Number(x.w.produced), costs, x.w.operations) })),
    drafts: wos.filter((x) => x.w.status === "draft").length,
  };
}
