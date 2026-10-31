// Inspection plans; inspections queued by themselves when goods are received
// or made (and raised by hand for any stage); results judged against the
// plan; a failed lot held in the location's quarantine bin and reported as a
// non-conformance; and non-conformances worked through root cause, corrective
// and preventive actions and a disposition that's carried out on the held
// stock (released, scrapped, or returned to the supplier with a debit note).
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { judge, ncrSchema, ncrUpdateSchema, planFor, planSchema, resultSchema, sampleCount, type Stage } from "@/lib/quality/model";
import { isOn } from "@/lib/workspace/modules";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { audit } from "../services/audit";
import { getItem, getWarehouse, move } from "../inventory/stock";
import { check, nextNumber, requireManage, requireWrite, stockScope, type Scope } from "./access";

// ── Plans ───────────────────────────────────────────────────────────────────

export async function plans(orgId: string) {
  return db.select().from(schema.qcPlans).where(eq(schema.qcPlans.orgId, orgId)).orderBy(schema.qcPlans.name);
}

export async function savePlan(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(planSchema, raw);
  if (!v.itemId && !v.category) throw new ApiError("validation_failed", "Pick an item or a category", { itemId: ["Pick one"] });
  if (v.itemId) await getItem(s.orgId, v.itemId);
  if (new Set(v.parameters.map((p) => p.id)).size !== v.parameters.length) throw new ApiError("validation_failed", "Each check needs its own id");
  for (const p of v.parameters) if (p.kind === "measure" && p.min !== null && p.max !== null && p.max < p.min) throw new ApiError("validation_failed", `${p.name}: the upper limit is below the lower one`);
  if (id) {
    const [r] = await db.update(schema.qcPlans).set(v).where(and(eq(schema.qcPlans.id, id), eq(schema.qcPlans.orgId, s.orgId))).returning();
    if (!r) throw notFound("Plan");
    return r;
  }
  const [r] = await db.insert(schema.qcPlans).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

export async function deletePlan(s: Scope, id: string) {
  requireManage(s);
  const [used] = await db.select({ id: schema.qcInspections.id }).from(schema.qcInspections).where(and(eq(schema.qcInspections.planId, id), eq(schema.qcInspections.status, "pending"))).limit(1);
  if (used) throw new ApiError("conflict", "Inspections waiting on this plan — switch it off instead");
  await db.delete(schema.qcPlans).where(and(eq(schema.qcPlans.id, id), eq(schema.qcPlans.orgId, s.orgId)));
}

// ── Inspections ─────────────────────────────────────────────────────────────

type Lot = { itemId: string; qty: number; warehouseId: string | null; batch: string; binId: string | null; supplierId: string | null };

/**
 * Queue inspections for what just arrived or was made, for items with a plan
 * at that stage. Called by Inventory and Manufacturing; does nothing when
 * Quality is off, and never stops the work that called it.
 */
export async function queueInspections(orgId: string, stage: Stage, source: { type: string; id: string; no: string }, lots: Lot[]) {
  try {
    const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
    if (!isOn(org?.modules, "quality") || !lots.length) return 0;
    const ps = await plans(orgId);
    if (!ps.length) return 0;
    const items = await db.select({ id: schema.invItems.id, category: schema.invItems.category }).from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), inArray(schema.invItems.id, lots.map((l) => l.itemId))));
    const { getSettings } = await import("./access");
    const st = await getSettings(orgId);
    let n = 0;
    for (const l of lots.filter((x) => x.qty > 0)) {
      const it = items.find((i) => i.id === l.itemId);
      const plan = it ? planFor(ps, it, stage) : null;
      if (!plan) continue;
      const number = await nextNumber(orgId, "inspection", st.inspectionPrefix);
      await db.insert(schema.qcInspections).values({ orgId, number, planId: plan.id, stage, itemId: l.itemId, warehouseId: l.warehouseId, batch: l.batch, lotQty: l.qty, binId: l.binId, sampleCount: sampleCount(plan, l.qty), source, supplierId: l.supplierId });
      n++;
    }
    return n;
  } catch (e) {
    log.warn("queueing inspections failed", { orgId, source, error: String(e) });
    return 0;
  }
}

export async function inspections(s: Scope, q: { status?: string } = {}) {
  return db
    .select({ i: schema.qcInspections, item: schema.invItems.name, plan: schema.qcPlans.name, supplier: schema.invSuppliers.name })
    .from(schema.qcInspections)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.qcInspections.itemId))
    .leftJoin(schema.qcPlans, eq(schema.qcPlans.id, schema.qcInspections.planId))
    .leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.qcInspections.supplierId))
    .where(and(eq(schema.qcInspections.orgId, s.orgId), q.status ? eq(schema.qcInspections.status, q.status) : undefined))
    .orderBy(desc(schema.qcInspections.createdAt))
    .limit(300)
    .then((r) => r.map((x) => ({ ...x.i, item: x.item, plan: x.plan ?? "", supplier: x.supplier ?? null })));
}

async function getInspection(orgId: string, id: string) {
  const [i] = await db.select().from(schema.qcInspections).where(and(eq(schema.qcInspections.id, id), eq(schema.qcInspections.orgId, orgId)));
  if (!i) throw notFound("Inspection");
  return i;
}

export async function inspectionDetail(s: Scope, id: string) {
  const i = await getInspection(s.orgId, id);
  const [plan] = await db.select().from(schema.qcPlans).where(eq(schema.qcPlans.id, i.planId));
  const item = await getItem(s.orgId, i.itemId);
  return { inspection: i, plan: plan ?? null, item: { id: item.id, name: item.name, unit: item.unit } };
}

/** Raise an inspection by hand (any stage, e.g. before dispatch or a re-check of stock). */
export async function raiseInspection(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = raw as { planId?: string; itemId?: string; warehouseId?: string | null; qty?: number; batch?: string };
  const [plan] = v.planId ? await db.select().from(schema.qcPlans).where(and(eq(schema.qcPlans.id, v.planId), eq(schema.qcPlans.orgId, s.orgId))) : [];
  if (!plan) throw new ApiError("validation_failed", "Pick a plan");
  const item = await getItem(s.orgId, String(v.itemId ?? plan.itemId ?? ""));
  if (plan.itemId && plan.itemId !== item.id) throw new ApiError("validation_failed", "That plan is for another item");
  if (v.warehouseId) await getWarehouse(s.orgId, v.warehouseId);
  const qty = Number(v.qty) || 0;
  if (!(qty > 0)) throw new ApiError("validation_failed", "How many are in the lot?");
  const number = await nextNumber(s.orgId, "inspection", s.settings.inspectionPrefix);
  const [r] = await db.insert(schema.qcInspections).values({ orgId: s.orgId, number, planId: plan.id, stage: plan.stage, itemId: item.id, warehouseId: v.warehouseId ?? null, batch: String(v.batch ?? ""), lotQty: qty, sampleCount: sampleCount(plan, qty), source: { type: "manual", id: null, no: "" } }).returning();
  return r;
}

/** The quarantine bin at a location, if it has one. */
async function quarantineBin(orgId: string, warehouseId: string | null) {
  if (!warehouseId) return null;
  const [b] = await db.select().from(schema.invBins).where(and(eq(schema.invBins.orgId, orgId), eq(schema.invBins.warehouseId, warehouseId), eq(schema.invBins.kind, "quarantine"), eq(schema.invBins.active, true))).limit(1);
  return b ?? null;
}

/**
 * Record the results. A lot that fails is reported as a non-conformance and,
 * when the workspace asks for it and the location has a quarantine bin, held
 * there — as much of the lot as is still where it was received.
 */
export async function recordResults(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const i = await getInspection(s.orgId, id);
  if (i.status !== "pending") throw new ApiError("conflict", "This inspection is already recorded");
  const v = check(resultSchema, raw);
  const [plan] = await db.select().from(schema.qcPlans).where(eq(schema.qcPlans.id, i.planId));
  if (!plan) throw new ApiError("conflict", "The plan for this inspection was deleted");
  if (v.samples.length < i.sampleCount) throw new ApiError("validation_failed", `Record all ${i.sampleCount} samples`);
  const j = judge(plan.parameters, v.samples, plan.acceptMax);
  let quarantined = 0;
  let ncrId: string | null = null;
  if (!j.passed) {
    const item = await getItem(s.orgId, i.itemId);
    const number = await nextNumber(s.orgId, "ncr", s.settings.ncrPrefix);
    const worst = Object.entries(j.byParameter).filter(([, n]) => n).map(([pid]) => plan.parameters.find((p) => p.id === pid)?.name).filter(Boolean);
    const [ncr] = await db.insert(schema.qcNcrs).values({ orgId: s.orgId, number, source: "inspection", inspectionId: i.id, itemId: i.itemId, supplierId: i.supplierId, warehouseId: i.warehouseId, batch: i.batch, qty: i.lotQty, severity: j.defective > plan.acceptMax * 2 + 1 ? "major" : "minor", title: `${item.name} failed ${i.number}`, description: `${j.defective} of ${v.samples.length} samples failed (${worst.join(", ")}); the plan accepts ${plan.acceptMax}.`, createdBy: s.userId }).returning();
    ncrId = ncr.id;
    const qbin = s.settings.quarantineOnFail ? await quarantineBin(s.orgId, i.warehouseId) : null;
    if (qbin && i.warehouseId) {
      // What's still there to hold: in the bin it went into, or not yet put away.
      const free = await stillThere(s.orgId, i.warehouseId, i.itemId, i.batch, i.binId);
      quarantined = Math.min(Number(i.lotQty), free);
      if (quarantined > 0) {
        const { moveInBins } = await import("../inventory/warehouse");
        await moveInBins(await stockScope(s), { warehouseId: i.warehouseId, itemId: i.itemId, batch: i.batch, qty: quarantined, fromBinId: i.binId, toBinId: qbin.id });
        await db.update(schema.qcNcrs).set({ held: quarantined }).where(eq(schema.qcNcrs.id, ncr.id));
      }
    }
  }
  const [r] = await db.update(schema.qcInspections).set({ samples: v.samples, notes: v.notes, defective: j.defective, status: j.passed ? "passed" : "failed", quarantined, ncrId, inspectedBy: s.userId, inspectedAt: new Date() }).where(eq(schema.qcInspections.id, id)).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: j.passed ? "quality.passed" : "quality.failed", targetType: "qc_inspection", targetId: id, metadata: { number: i.number, defective: j.defective, quarantined } });
  return { inspection: r, result: j, ncrId };
}

async function stillThere(orgId: string, warehouseId: string, itemId: string, batch: string, binId: string | null) {
  if (binId) {
    const [b] = await db.select({ qty: schema.invBinStock.qty }).from(schema.invBinStock).where(and(eq(schema.invBinStock.binId, binId), eq(schema.invBinStock.itemId, itemId), eq(schema.invBinStock.batch, batch)));
    return Math.max(0, Number(b?.qty ?? 0));
  }
  const [st] = await db.select({ qty: schema.invStock.qty }).from(schema.invStock).where(and(eq(schema.invStock.warehouseId, warehouseId), eq(schema.invStock.itemId, itemId), eq(schema.invStock.batch, batch)));
  const [inBins] = await db.select({ qty: sql<number>`coalesce(sum(${schema.invBinStock.qty}),0)::float` }).from(schema.invBinStock).innerJoin(schema.invBins, eq(schema.invBins.id, schema.invBinStock.binId)).where(and(eq(schema.invBins.warehouseId, warehouseId), eq(schema.invBinStock.itemId, itemId), eq(schema.invBinStock.batch, batch)));
  return Math.max(0, Number(st?.qty ?? 0) - Number(inBins?.qty ?? 0));
}

// ── Non-conformances ────────────────────────────────────────────────────────

export async function ncrs(s: Scope, q: { status?: string } = {}) {
  return db
    .select({ n: schema.qcNcrs, item: schema.invItems.name, supplier: schema.invSuppliers.name })
    .from(schema.qcNcrs)
    .leftJoin(schema.invItems, eq(schema.invItems.id, schema.qcNcrs.itemId))
    .leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.qcNcrs.supplierId))
    .where(and(eq(schema.qcNcrs.orgId, s.orgId), q.status ? eq(schema.qcNcrs.status, q.status) : undefined))
    .orderBy(desc(schema.qcNcrs.createdAt))
    .limit(300)
    .then((r) => r.map((x) => ({ ...x.n, item: x.item, supplier: x.supplier })));
}

async function getNcr(orgId: string, id: string) {
  const [n] = await db.select().from(schema.qcNcrs).where(and(eq(schema.qcNcrs.id, id), eq(schema.qcNcrs.orgId, orgId)));
  if (!n) throw notFound("Non-conformance");
  return n;
}

export async function ncrDetail(s: Scope, id: string) {
  const n = await getNcr(s.orgId, id);
  const inspection = n.inspectionId ? (await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, n.inspectionId)))[0] ?? null : null;
  return { ncr: n, inspection };
}

export async function raiseNcr(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(ncrSchema, raw);
  if (v.itemId) await getItem(s.orgId, v.itemId);
  if (v.warehouseId) await getWarehouse(s.orgId, v.warehouseId);
  if (v.supplierId) {
    const [sup] = await db.select({ id: schema.invSuppliers.id }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.id, v.supplierId), eq(schema.invSuppliers.orgId, s.orgId)));
    if (!sup) throw new ApiError("validation_failed", "That supplier isn't in this workspace", { supplierId: ["Unknown supplier"] });
  }
  const number = await nextNumber(s.orgId, "ncr", s.settings.ncrPrefix);
  const [r] = await db.insert(schema.qcNcrs).values({ ...v, number, orgId: s.orgId, createdBy: s.userId }).returning();
  return r;
}

export async function updateNcr(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const n = await getNcr(s.orgId, id);
  if (n.status === "closed") throw new ApiError("conflict", "This report is closed");
  const v = check(ncrUpdateSchema, raw);
  if (v.disposition !== n.disposition) requireManage(s);
  const [r] = await db.update(schema.qcNcrs).set(v).where(eq(schema.qcNcrs.id, id)).returning();
  return r;
}

/**
 * Close a report: the disposition is carried out on what's held in quarantine
 * — released to stock (use as is, rework), written off (scrap), or sent back
 * to the supplier on a return with a debit note.
 */
export async function closeNcr(s: Scope, id: string) {
  requireManage(s);
  const n = await getNcr(s.orgId, id);
  if (n.status === "closed") throw new ApiError("conflict", "Already closed");
  if (n.disposition === "pending") throw new ApiError("validation_failed", "Decide what happens to the goods first");
  if (!n.rootCause.trim()) throw new ApiError("validation_failed", "Record the root cause first");
  if (n.actions.some((a) => !a.done)) throw new ApiError("validation_failed", "Finish the corrective and preventive actions first");
  const held = Number(n.held);
  let note = "";
  if (held > 0 && n.itemId && n.warehouseId) {
    const qbin = await quarantineBin(s.orgId, n.warehouseId);
    if (!qbin) throw new ApiError("conflict", "The quarantine bin holding these goods is gone");
    const inv = await stockScope(s);
    if (n.disposition === "use" || n.disposition === "rework") {
      const { moveInBins } = await import("../inventory/warehouse");
      await moveInBins(inv, { warehouseId: n.warehouseId, itemId: n.itemId, batch: n.batch, qty: held, fromBinId: qbin.id, toBinId: null });
      note = "Released to stock";
    } else if (n.disposition === "scrap") {
      const item = await getItem(s.orgId, n.itemId);
      const wh = await getWarehouse(s.orgId, n.warehouseId);
      await db.transaction((tx) => move(tx, inv, { item, warehouse: wh, qty: -held, kind: "adjust", batch: n.batch, binId: qbin.id, refType: "qc_ncr", refId: n.id, refNo: n.number, note: `Scrapped: ${n.title}` }));
      note = "Scrapped";
    } else if (n.disposition === "return") {
      if (!n.supplierId) throw new ApiError("validation_failed", "Name the supplier to return to");
      const insp = n.inspectionId ? (await db.select().from(schema.qcInspections).where(eq(schema.qcInspections.id, n.inspectionId)))[0] : null;
      const receiptId = insp?.source.type === "receipt" ? insp.source.id : null;
      const rc = receiptId ? (await db.select().from(schema.invReceipts).where(eq(schema.invReceipts.id, receiptId)))[0] : null;
      const line = rc?.lines.find((l) => l.itemId === n.itemId && (l.batch ?? "") === n.batch);
      const item = await getItem(s.orgId, n.itemId);
      const { returnToSupplier } = await import("../inventory/procurement");
      const r = await returnToSupplier(inv, { supplierId: n.supplierId, receiptId, warehouseId: n.warehouseId, date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), debitNote: !!receiptId, notes: `${n.number}: ${n.title}`, lines: [{ itemId: n.itemId, qty: held, rate: line?.rate ?? item.avgCost, gstRate: line?.gstRate ?? item.gstRate, batch: n.batch, reason: n.title.slice(0, 200), binId: qbin.id }] });
      note = `Returned on ${r.return.number}${r.debitNote ? ` with debit note ${r.debitNote.number}` : r.note ? ` (${r.note})` : ""}`;
    }
  }
  const [r] = await db.update(schema.qcNcrs).set({ status: "closed", closedAt: new Date(), held: 0 }).where(eq(schema.qcNcrs.id, id)).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "quality.ncr_closed", targetType: "qc_ncr", targetId: id, metadata: { number: n.number, disposition: n.disposition, held, note } });
  return { ncr: r, note };
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export async function home(s: Scope) {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const done = await db
    .select({ status: schema.qcInspections.status, supplierId: schema.qcInspections.supplierId, supplier: schema.invSuppliers.name, itemId: schema.qcInspections.itemId, item: schema.invItems.name })
    .from(schema.qcInspections)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.qcInspections.itemId))
    .leftJoin(schema.invSuppliers, eq(schema.invSuppliers.id, schema.qcInspections.supplierId))
    .where(and(eq(schema.qcInspections.orgId, s.orgId), inArray(schema.qcInspections.status, ["passed", "failed"]), sql`${schema.qcInspections.inspectedAt} >= ${since}`));
  const rate = (rows: typeof done) => (rows.length ? Math.round((rows.filter((r) => r.status === "passed").length / rows.length) * 1000) / 10 : null);
  const group = <K extends "supplierId" | "itemId">(k: K, name: "supplier" | "item") => [...new Set(done.map((d) => d[k]).filter((x): x is string => !!x))].map((id) => ({ id, name: done.find((d) => d[k] === id)?.[name] ?? "", inspected: done.filter((d) => d[k] === id).length, passRate: rate(done.filter((d) => d[k] === id)) })).sort((a, b) => (a.passRate ?? 100) - (b.passRate ?? 100));
  const open = await db.select().from(schema.qcNcrs).where(and(eq(schema.qcNcrs.orgId, s.orgId), eq(schema.qcNcrs.status, "open")));
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [{ pending }] = await db.select({ pending: sql<number>`count(*)::int` }).from(schema.qcInspections).where(and(eq(schema.qcInspections.orgId, s.orgId), eq(schema.qcInspections.status, "pending")));
  return {
    pending,
    passRate: rate(done),
    inspected: done.length,
    openNcrs: open.length,
    held: open.reduce((a, n) => a + Number(n.held), 0),
    overdueActions: open.flatMap((n) => n.actions.filter((a) => !a.done && a.due && a.due < today).map((a) => ({ ncrId: n.id, number: n.number, action: a.action, due: a.due }))),
    suppliers: group("supplierId", "supplier"),
    items: group("itemId", "item").slice(0, 10),
  };
}
