// Manufacturing: bills of materials with routings, work centres, work orders
// (materials issued, operations timed, output received at its real cost), MRP
// and capacity. Shapes and the arithmetic shared by server and screens.
// Money is paise; quantities up to three decimals; times in minutes.
import { z } from "zod";

export const q3 = (n: number) => Math.round(n * 1000) / 1000;
const uuid = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const qty = z.number().gt(0, "Enter a quantity").max(1e9).transform(q3);
const text = (n: number) => z.string().trim().max(n).default("");

export const WO_STATUSES = ["draft", "released", "in_progress", "done", "cancelled"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];
export const WO_LABEL: Record<WoStatus, string> = { draft: "Draft", released: "Released", in_progress: "In production", done: "Done", cancelled: "Cancelled" };

export const settingsSchema = z.object({
  workOrderPrefix: z.string().trim().max(8).default("MO-"),
  /** Where components come from and finished goods go, unless the work order says otherwise. */
  defaultWarehouseId: uuid.nullable().default(null),
  /** Days MRP looks ahead for sales orders. */
  horizonDays: z.number().int().min(1).max(365).default(30),
});
export type MfgSettings = z.infer<typeof settingsSchema>;

export const workCentreSchema = z.object({
  code: z.string().trim().min(1, "Give it a code").max(20),
  name: z.string().trim().min(1, "Name it").max(80),
  /** Machine and labour cost per hour, paise. */
  costPerHour: z.number().int().min(0).max(1e9).default(0),
  hoursPerDay: z.number().min(0.5).max(24).default(8),
  active: z.boolean().default(true),
});

export const bomSchema = z.object({
  itemId: uuid,
  name: z.string().trim().min(1, "Name the recipe").max(80).default("Standard"),
  /** How much one run of this recipe makes. */
  outputQty: qty.default(1),
  lines: z.array(z.object({ itemId: uuid, qty, scrapPct: z.number().min(0).max(100).default(0) })).min(1, "Add at least one component").max(300),
  operations: z.array(z.object({ id: z.string().min(1).max(40), workCentreId: uuid, name: z.string().trim().min(1).max(80), minutes: z.number().min(0).max(100000).default(0), setupMinutes: z.number().min(0).max(100000).default(0) })).max(50).default([]),
  isDefault: z.boolean().default(true),
  active: z.boolean().default(true),
  notes: text(1000),
});
export type Bom = z.infer<typeof bomSchema>;

export const workOrderSchema = z.object({
  itemId: uuid,
  bomId: uuid.nullable().default(null),
  qty,
  warehouseId: uuid.nullable().default(null),
  plannedStart: day.nullable().default(null),
  plannedEnd: day.nullable().default(null),
  salesOrderId: uuid.nullable().default(null),
  notes: text(1000),
});

export const issueSchema = z.object({ lines: z.array(z.object({ itemId: uuid, qty: z.number().max(1e9).transform(q3), batch: text(40) })).min(1).max(300) });
export const timeSchema = z.object({ operationId: z.string().min(1), minutes: z.number().min(0).max(100000), done: z.boolean().default(false) });
export const completeSchema = z.object({ produced: z.number().min(0).max(1e9).transform(q3), scrap: z.number().min(0).max(1e9).transform(q3).default(0), batch: text(40), expiry: day.nullable().default(null) });

/** What one run of a recipe needs per unit of output, with its scrap allowance. */
export const perUnit = (line: { qty: number; scrapPct: number }, outputQty: number) => (line.qty / (outputQty || 1)) * (1 + line.scrapPct / 100);

/** Materials and operations for making `qty` with a recipe. */
export function plan(bom: Pick<Bom, "outputQty" | "lines" | "operations">, qty: number) {
  return {
    materials: bom.lines.map((l) => ({ itemId: l.itemId, required: q3(perUnit(l, bom.outputQty) * qty), issued: 0 })),
    operations: bom.operations.map((o) => ({ id: o.id, workCentreId: o.workCentreId, name: o.name, plannedMinutes: Math.round(o.setupMinutes + (o.minutes * qty) / (bom.outputQty || 1)), actualMinutes: 0, done: false })),
  };
}

/** The cost of conversion: each operation's time (actual, or planned if none was recorded) at its centre's rate. */
export function conversionCost(ops: { workCentreId: string; plannedMinutes: number; actualMinutes: number }[], rates: Map<string, number>) {
  return ops.reduce((a, o) => a + Math.round(((o.actualMinutes || o.plannedMinutes) / 60) * (rates.get(o.workCentreId) ?? 0)), 0);
}

/** Variances on a finished order: materials used against the recipe for what was made, and time against plan. */
export function variances(materials: { itemId: string; required: number; issued: number }[], planned: number, produced: number, costs: Map<string, number>, ops: { plannedMinutes: number; actualMinutes: number }[]) {
  const ratio = planned ? produced / planned : 0;
  const mat = materials.map((m) => {
    const standard = q3(m.required * ratio);
    return { itemId: m.itemId, standard, actual: m.issued, qty: q3(m.issued - standard), value: Math.round((m.issued - standard) * (costs.get(m.itemId) ?? 0)) };
  });
  const minutes = ops.reduce((a, o) => a + (o.actualMinutes || o.plannedMinutes), 0) - Math.round(ops.reduce((a, o) => a + o.plannedMinutes, 0) * ratio);
  return { materials: mat, materialValue: mat.reduce((a, m) => a + m.value, 0), minutes, yieldPct: planned ? Math.round((produced / planned) * 1000) / 10 : 0 };
}

export type Need = { itemId: string; demand: number; available: number; incoming: number; safety: number; net: number };

/**
 * Material requirements: for each item, what's needed (orders, safety stock,
 * and — for components — what planned production will use) against what's
 * free and coming. Items with a recipe are made (and their components needed
 * in turn, level by level); the rest are bought.
 */
export function mrp(input: { demand: Map<string, number>; available: Map<string, number>; incoming: Map<string, number>; safety: Map<string, number>; boms: Map<string, Pick<Bom, "outputQty" | "lines">>; reorderQty?: Map<string, number> }) {
  const need = new Map(input.demand);
  const make = new Map<string, Need>();
  const buy = new Map<string, Need>();
  const done = new Set<string>();
  // Work level by level: an item is settled once nothing that uses it is still unsettled.
  const usedBy = new Map<string, Set<string>>();
  for (const [parent, b] of input.boms) for (const l of b.lines) usedBy.set(l.itemId, new Set([...(usedBy.get(l.itemId) ?? []), parent]));
  const all = new Set([...need.keys(), ...input.boms.keys(), ...[...input.boms.values()].flatMap((b) => b.lines.map((l) => l.itemId)), ...input.safety.keys()]);
  for (let guard = 0; guard < 50 && done.size < all.size; guard++) {
    for (const id of all) {
      if (done.has(id)) continue;
      if ([...(usedBy.get(id) ?? [])].some((p) => !done.has(p) && all.has(p))) continue;
      done.add(id);
      const demand = q3(need.get(id) ?? 0);
      const safety = input.safety.get(id) ?? 0;
      const available = input.available.get(id) ?? 0;
      const incoming = input.incoming.get(id) ?? 0;
      const net = q3(Math.max(0, demand + safety - available - incoming));
      const row = { itemId: id, demand, available, incoming, safety, net };
      const bom = input.boms.get(id);
      if (bom) {
        if (net > 0) {
          make.set(id, row);
          for (const l of bom.lines) need.set(l.itemId, q3((need.get(l.itemId) ?? 0) + perUnit(l, bom.outputQty) * net));
        }
      } else if (net > 0) buy.set(id, { ...row, net: Math.max(net, input.reorderQty?.get(id) ?? 0) });
    }
  }
  return { make: [...make.values()], buy: [...buy.values()], cyclic: done.size < all.size };
}

/** Load on each work centre over the next days, from released and running orders. */
export function load(orders: { operations: { workCentreId: string; plannedMinutes: number; actualMinutes: number; done: boolean }[] }[], centres: { id: string; hoursPerDay: number }[], days: number) {
  return centres.map((c) => {
    const minutes = orders.reduce((a, o) => a + o.operations.filter((x) => x.workCentreId === c.id && !x.done).reduce((b, x) => b + Math.max(0, x.plannedMinutes - x.actualMinutes), 0), 0);
    const capacity = Math.round(c.hoursPerDay * 60 * days);
    return { workCentreId: c.id, minutes, capacity, pct: capacity ? Math.round((minutes / capacity) * 100) : 0 };
  });
}
