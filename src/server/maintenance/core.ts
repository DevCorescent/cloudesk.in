// Assets & maintenance: the register (with components, meters and its
// fixed-asset line), preventive plans that raise work orders when due, work
// orders (requests, breakdowns with downtime, checklists, labour, spare parts
// issued from stock, outside work), contracts, reliability and cost reports,
// and the journals spare parts post.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { assetSchema, contractSchema, isDue, minutesBetween, orderCost, orderSchema, planSchema, projectMeterDate, reliability, usagePerDay } from "@/lib/maintenance/model";
import { ApiError, notFound } from "../http/errors";
import { allocate, getItem, getWarehouse, move } from "../inventory/stock";
import { audit } from "../services/audit";
import { isOn } from "@/lib/workspace/modules";
import { check, getAsset, getSettings, nextNumber, requireManage, requireWrite, stockScope, team, todayIst, type Scope } from "./access";
import { contains } from "../security/like";

type Asset = typeof schema.mntAssets.$inferSelect;
type Plan = typeof schema.mntPlans.$inferSelect;
type Order = typeof schema.mntOrders.$inferSelect;
const OPEN = ["requested", "open", "in_progress", "on_hold"];
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

async function checkMember(orgId: string, userId: string | null, field: string) {
  if (!userId) return;
  const [m] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  if (!m) throw new ApiError("validation_failed", "They aren't in this workspace", { [field]: ["Not in this workspace"] });
}

// ── Assets ──────────────────────────────────────────────────────────────────

export async function listAssets(s: Scope, q: { status?: string; q?: string; category?: string } = {}) {
  const rows = await db
    .select()
    .from(schema.mntAssets)
    .where(and(eq(schema.mntAssets.orgId, s.orgId), q.status === "all" ? undefined : q.status ? eq(schema.mntAssets.status, q.status) : ne(schema.mntAssets.status, "retired"), q.category ? eq(schema.mntAssets.category, q.category) : undefined, q.q ? sql`(${schema.mntAssets.name} ilike ${contains(q.q)} or ${schema.mntAssets.code} ilike ${contains(q.q)} or ${schema.mntAssets.serial} ilike ${contains(q.q)} or ${schema.mntAssets.location} ilike ${contains(q.q)})` : undefined))
    .orderBy(asc(schema.mntAssets.code))
    .limit(2000);
  const open = rows.length ? await db.select({ assetId: schema.mntOrders.assetId, n: sql<number>`count(*)::int` }).from(schema.mntOrders).where(and(eq(schema.mntOrders.orgId, s.orgId), inArray(schema.mntOrders.status, OPEN))).groupBy(schema.mntOrders.assetId) : [];
  const plans = rows.length ? await db.select().from(schema.mntPlans).where(and(eq(schema.mntPlans.orgId, s.orgId), eq(schema.mntPlans.active, true))) : [];
  const today = todayIst();
  return rows.map((a) => {
    const mine = plans.filter((p) => p.assetId === a.id).map((p) => planState(p, a, today));
    const next = mine.map((p) => p.date).filter(Boolean).sort()[0] ?? null;
    return { ...a, openOrders: open.find((o) => o.assetId === a.id)?.n ?? 0, nextService: next, serviceDue: mine.some((p) => p.due) };
  });
}

function planState(p: Plan, a: Pick<Asset, "meter">, today: string, perDay: number | null = null) {
  const st = isDue({ everyDays: p.everyDays, everyMeter: p.everyMeter, startOn: String(p.startOn), startMeter: p.startMeter, lastDoneOn: p.lastDoneOn ? String(p.lastDoneOn) : null, lastDoneMeter: p.lastDoneMeter, leadDays: p.leadDays, leadMeter: p.leadMeter }, today, a.meter);
  const meterDate = st.meter !== null && a.meter !== null ? projectMeterDate(st.meter, a.meter, perDay, today) : null;
  // The earlier of the calendar date and when the meter is expected to get there.
  const date = [st.date, meterDate].filter(Boolean).sort()[0] ?? null;
  return { ...st, date, meterDate };
}

export async function assetDetail(s: Scope, id: string) {
  const a = await getAsset(s.orgId, id);
  const [parts, readings, plans, orders, contracts, parent] = await Promise.all([
    db.select({ id: schema.mntAssets.id, code: schema.mntAssets.code, name: schema.mntAssets.name, status: schema.mntAssets.status }).from(schema.mntAssets).where(eq(schema.mntAssets.parentId, a.id)).orderBy(asc(schema.mntAssets.code)),
    db.select().from(schema.mntReadings).where(eq(schema.mntReadings.assetId, a.id)).orderBy(desc(schema.mntReadings.on), desc(schema.mntReadings.createdAt)).limit(30),
    db.select().from(schema.mntPlans).where(eq(schema.mntPlans.assetId, a.id)).orderBy(asc(schema.mntPlans.title)),
    db.select().from(schema.mntOrders).where(eq(schema.mntOrders.assetId, a.id)).orderBy(desc(schema.mntOrders.createdAt)).limit(100),
    db.select().from(schema.mntContracts).where(and(eq(schema.mntContracts.orgId, s.orgId), sql`${a.id} = any(${schema.mntContracts.assetIds})`)).orderBy(desc(schema.mntContracts.endOn)),
    a.parentId ? db.select({ id: schema.mntAssets.id, code: schema.mntAssets.code, name: schema.mntAssets.name }).from(schema.mntAssets).where(eq(schema.mntAssets.id, a.parentId)) : Promise.resolve([]),
  ]);
  const today = todayIst();
  // Average use over the last 90 days of readings.
  const recent = readings.filter((r) => String(r.on) >= addDaysIso(today, -90)).map((r) => ({ value: r.value, on: String(r.on) })).reverse();
  const perDay = usagePerDay(recent);
  const cost = orders.filter((o) => o.status === "done").reduce((t, o) => {
    const c = orderCost({ labour: o.labour, partsCost: Number(o.partsCost), externalCost: Number(o.externalCost) });
    return { labour: t.labour + c.labour, parts: t.parts + c.parts, external: t.external + c.external, total: t.total + c.total };
  }, { labour: 0, parts: 0, external: 0, total: 0 });
  const from = addDaysIso(today, -89);
  const rel = reliability(90 * 24, orders.filter((o) => o.kind === "breakdown" && o.downFrom).map((o) => ({ downMinutes: downIn(o, from, today) })).filter((b) => b.downMinutes > 0));
  const fixed = a.fixedAssetId && s.has("accounting") ? (await db.select({ id: schema.accAssets.id, code: schema.accAssets.code, name: schema.accAssets.name, cost: schema.accAssets.cost, status: schema.accAssets.status }).from(schema.accAssets).where(and(eq(schema.accAssets.id, a.fixedAssetId), eq(schema.accAssets.orgId, s.orgId))))[0] ?? null : null;
  return {
    asset: a,
    parent: parent[0] ?? null,
    components: parts,
    readings,
    perDay,
    plans: plans.map((p) => ({ ...p, ...planState(p, a, today, perDay) })),
    orders,
    contracts: contracts.map((c) => ({ ...c, state: contractState(c, today, s.settings.contractNoticeDays) })),
    cost,
    reliability: rel,
    fixedAsset: fixed,
  };
}

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Minutes an order's asset was down within [from, to] (whole days, IST); still down counts to now. */
function downIn(o: Pick<Order, "downFrom" | "downTo">, from: string, to: string) {
  if (!o.downFrom) return 0;
  const start = new Date(Math.max(new Date(o.downFrom).getTime(), Date.parse(`${from}T00:00:00+05:30`)));
  const end = new Date(Math.min((o.downTo ? new Date(o.downTo) : new Date()).getTime(), Date.parse(`${to}T23:59:59.999+05:30`)));
  return end > start ? minutesBetween(start, end) : 0;
}

async function checkAssetRefs(s: Scope, v: z.infer<typeof assetSchema>, selfId?: string) {
  if (v.parentId) {
    if (v.parentId === selfId) throw new ApiError("validation_failed", "An asset can't be its own component");
    let at: string | null = v.parentId;
    for (let i = 0; at && i < 20; i++) {
      const [p]: { id: string; parentId: string | null }[] = await db.select({ id: schema.mntAssets.id, parentId: schema.mntAssets.parentId }).from(schema.mntAssets).where(and(eq(schema.mntAssets.id, at), eq(schema.mntAssets.orgId, s.orgId)));
      if (!p) throw new ApiError("validation_failed", "That parent asset isn't in this workspace", { parentId: ["Unknown asset"] });
      if (selfId && p.parentId === selfId) throw new ApiError("validation_failed", "That would make a loop of components");
      at = p.parentId;
    }
  }
  await checkMember(s.orgId, v.custodianId, "custodianId");
  if (v.fixedAssetId) {
    const [f] = await db.select({ id: schema.accAssets.id }).from(schema.accAssets).where(and(eq(schema.accAssets.id, v.fixedAssetId), eq(schema.accAssets.orgId, s.orgId)));
    if (!f) throw new ApiError("validation_failed", "That fixed asset isn't in this workspace's register", { fixedAssetId: ["Unknown fixed asset"] });
    const [taken] = await db.select({ code: schema.mntAssets.code }).from(schema.mntAssets).where(and(eq(schema.mntAssets.fixedAssetId, v.fixedAssetId), selfId ? ne(schema.mntAssets.id, selfId) : undefined));
    if (taken) throw new ApiError("conflict", `That fixed asset is already linked to ${taken.code}`);
  }
}

export async function saveAsset(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(assetSchema, raw);
  await checkAssetRefs(s, v, id ?? undefined);
  if (id) {
    const a = await getAsset(s.orgId, id);
    const [row] = await db.update(schema.mntAssets).set(v).where(eq(schema.mntAssets.id, a.id)).returning();
    return row;
  }
  const code = await nextNumber(s.orgId, "asset", s.settings.assetPrefix);
  const [row] = await db.insert(schema.mntAssets).values({ ...v, orgId: s.orgId, code }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "maintenance.asset_created", targetType: "mnt_asset", targetId: row.id, metadata: { code, name: row.name } });
  return row;
}

/** Bring in fixed assets from the accounting register that aren't here yet. */
export async function fromFixedAssets(s: Scope) {
  requireManage(s);
  if (!s.has("accounting")) throw new ApiError("forbidden", "Switch on Accounting to use its fixed-asset register");
  const fixed = await db.select().from(schema.accAssets).where(and(eq(schema.accAssets.orgId, s.orgId), eq(schema.accAssets.status, "active"), sql`not exists (select 1 from mnt_assets m where m.fixed_asset_id = ${schema.accAssets.id})`)).orderBy(asc(schema.accAssets.code));
  for (const f of fixed) {
    const code = await nextNumber(s.orgId, "asset", s.settings.assetPrefix);
    await db.insert(schema.mntAssets).values({ orgId: s.orgId, code, name: f.name, category: f.category, fixedAssetId: f.id, purchaseDate: f.purchaseDate });
  }
  return { added: fixed.length };
}

const readingSchema = z.object({ value: z.number().min(0).max(1e12), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reset: z.boolean().default(false) });

/** A meter reading; a lower one than before is refused unless the meter was replaced. Raises any plans now due. */
export async function addReading(s: Scope, assetId: string, raw: unknown) {
  requireWrite(s);
  const a = await getAsset(s.orgId, assetId);
  if (!a.meterUnit) throw new ApiError("validation_failed", "Give the asset a meter unit (hours, km…) first");
  const v = check(readingSchema, raw);
  if (v.on > todayIst()) throw new ApiError("validation_failed", "That date is in the future");
  const [last] = await db.select().from(schema.mntReadings).where(and(eq(schema.mntReadings.assetId, a.id), sql`${schema.mntReadings.on} <= ${v.on}`)).orderBy(desc(schema.mntReadings.on), desc(schema.mntReadings.createdAt)).limit(1);
  if (last && v.value < last.value && !v.reset) throw new ApiError("validation_failed", `That's below the last reading (${last.value} ${a.meterUnit} on ${last.on}). Tick "meter replaced" if it was reset.`);
  await db.insert(schema.mntReadings).values({ orgId: s.orgId, assetId: a.id, value: v.value, on: v.on, by: s.userId });
  if (!a.meterAt || v.on >= String(a.meterAt)) await db.update(schema.mntAssets).set({ meter: v.value, meterAt: v.on }).where(eq(schema.mntAssets.id, a.id));
  if (v.reset) await db.update(schema.mntPlans).set({ lastDoneMeter: v.value, startMeter: v.value }).where(and(eq(schema.mntPlans.assetId, a.id), sql`${schema.mntPlans.everyMeter} is not null`));
  const raised = await raiseDue(s, a.id);
  return { meter: v.value, raised: raised.length };
}

/**
 * A reading taken elsewhere (a vehicle's odometer from Logistics): recorded if
 * the asset has a meter and the reading doesn't go backwards, then any plans
 * now due are raised. Quietly does nothing otherwise.
 */
export async function meterFromElsewhere(orgId: string, assetId: string, value: number, on: string, by: string | null) {
  const [a] = await db.select().from(schema.mntAssets).where(and(eq(schema.mntAssets.id, assetId), eq(schema.mntAssets.orgId, orgId)));
  if (!a || !a.meterUnit || (a.meter !== null && value < a.meter)) return { recorded: false, raised: 0 };
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "maintenance")) return { recorded: false, raised: 0 };
  await db.insert(schema.mntReadings).values({ orgId, assetId: a.id, value, on, by });
  if (!a.meterAt || on >= String(a.meterAt)) await db.update(schema.mntAssets).set({ meter: value, meterAt: on }).where(eq(schema.mntAssets.id, a.id));
  const settings = await getSettings(orgId);
  const raised = await raiseDue({ orgId, userId: by ?? "", role: "owner", write: true, manage: true, settings, partsOff: {}, has: () => true }, a.id);
  return { recorded: true, raised: raised.length };
}

// ── Plans ───────────────────────────────────────────────────────────────────

export async function plans(s: Scope) {
  const rows = await db.select({ p: schema.mntPlans, a: schema.mntAssets }).from(schema.mntPlans).innerJoin(schema.mntAssets, eq(schema.mntAssets.id, schema.mntPlans.assetId)).where(eq(schema.mntPlans.orgId, s.orgId)).orderBy(asc(schema.mntAssets.code));
  const today = todayIst();
  const open = await db.select({ planId: schema.mntOrders.planId, number: schema.mntOrders.number, id: schema.mntOrders.id }).from(schema.mntOrders).where(and(eq(schema.mntOrders.orgId, s.orgId), inArray(schema.mntOrders.status, OPEN), sql`${schema.mntOrders.planId} is not null`));
  return rows
    .map(({ p, a }) => ({ ...p, asset: { id: a.id, code: a.code, name: a.name, meter: a.meter, meterUnit: a.meterUnit }, ...planState(p, a, today), openOrder: open.find((o) => o.planId === p.id) ?? null }))
    .sort((x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999"));
}

async function checkPlanRefs(s: Scope, v: z.infer<typeof planSchema>) {
  const a = await getAsset(s.orgId, v.assetId);
  if (v.everyMeter && !a.meterUnit) throw new ApiError("validation_failed", "This asset has no meter. Give it a meter unit, or repeat by days.", { everyMeter: ["No meter"] });
  await checkMember(s.orgId, v.assigneeId, "assigneeId");
  if (v.parts.length) {
    const found = await db.select({ id: schema.invItems.id }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), inArray(schema.invItems.id, v.parts.map((x) => x.itemId))));
    if (found.length !== new Set(v.parts.map((x) => x.itemId)).size) throw new ApiError("validation_failed", "Some spare parts aren't in Inventory", { parts: ["Unknown item"] });
  }
}

export async function savePlan(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(planSchema, raw);
  await checkPlanRefs(s, v);
  if (id) {
    if (!isId(id)) throw notFound("Plan");
    const [row] = await db.update(schema.mntPlans).set(v).where(and(eq(schema.mntPlans.id, id), eq(schema.mntPlans.orgId, s.orgId))).returning();
    if (!row) throw notFound("Plan");
    return row;
  }
  const [row] = await db.insert(schema.mntPlans).values({ ...v, orgId: s.orgId }).returning();
  return row;
}

export async function deletePlan(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Plan");
  const [row] = await db.delete(schema.mntPlans).where(and(eq(schema.mntPlans.id, id), eq(schema.mntPlans.orgId, s.orgId))).returning();
  if (!row) throw notFound("Plan");
}

/**
 * Raise a preventive work order for every active plan that's due (by date or
 * meter) and doesn't already have one open. One asset, or all of them.
 */
export async function raiseDue(s: Scope, assetId?: string) {
  const today = todayIst();
  const rows = await db.select({ p: schema.mntPlans, a: schema.mntAssets }).from(schema.mntPlans).innerJoin(schema.mntAssets, eq(schema.mntAssets.id, schema.mntPlans.assetId)).where(and(eq(schema.mntPlans.orgId, s.orgId), eq(schema.mntPlans.active, true), ne(schema.mntAssets.status, "retired"), assetId ? eq(schema.mntPlans.assetId, assetId) : undefined));
  const out: Order[] = [];
  for (const { p, a } of rows) {
    const st = planState(p, a, today);
    if (!st.due) continue;
    const [busy] = await db.select({ id: schema.mntOrders.id }).from(schema.mntOrders).where(and(eq(schema.mntOrders.planId, p.id), inArray(schema.mntOrders.status, OPEN)));
    if (busy) continue;
    const number = await nextNumber(s.orgId, "order", s.settings.orderPrefix);
    const [o] = await db
      .insert(schema.mntOrders)
      .values({ orgId: s.orgId, number, assetId: a.id, planId: p.id, kind: "preventive", title: p.title, description: st.byMeter && st.meter !== null ? `Due at ${st.meter} ${a.meterUnit}` : "", priority: "normal", status: "open", assigneeId: p.assigneeId, dueDate: st.date && st.date > today ? st.date : today, checklist: p.checklist.map((c) => ({ ...c, done: false })), requestedBy: s.userId || null })
      .returning();
    out.push(o);
  }
  return out;
}

// ── Work orders ─────────────────────────────────────────────────────────────

async function getOrder(orgId: string, id: string) {
  if (!isId(id)) throw notFound("Work order");
  const [o] = await db.select().from(schema.mntOrders).where(and(eq(schema.mntOrders.id, id), eq(schema.mntOrders.orgId, orgId)));
  if (!o) throw notFound("Work order");
  return o;
}

export async function listOrders(s: Scope, q: { status?: string; assetId?: string; kind?: string; mine?: string } = {}) {
  const where = [eq(schema.mntOrders.orgId, s.orgId)];
  if (q.status === "open" || !q.status) where.push(inArray(schema.mntOrders.status, OPEN));
  else if (q.status !== "all") where.push(eq(schema.mntOrders.status, q.status));
  if (q.assetId && isId(q.assetId)) where.push(eq(schema.mntOrders.assetId, q.assetId));
  if (q.kind) where.push(eq(schema.mntOrders.kind, q.kind));
  if (q.mine === "1") where.push(eq(schema.mntOrders.assigneeId, s.userId));
  const rows = await db.select({ o: schema.mntOrders, code: schema.mntAssets.code, asset: schema.mntAssets.name, criticality: schema.mntAssets.criticality }).from(schema.mntOrders).innerJoin(schema.mntAssets, eq(schema.mntAssets.id, schema.mntOrders.assetId)).where(and(...where)).orderBy(sql`case ${schema.mntOrders.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, asc(schema.mntOrders.dueDate), desc(schema.mntOrders.createdAt)).limit(1000);
  const today = todayIst();
  return rows.map(({ o, code, asset, criticality }) => ({ ...o, asset: { code, name: asset, criticality }, cost: orderCost({ labour: o.labour, partsCost: Number(o.partsCost), externalCost: Number(o.externalCost) }).total, overdue: OPEN.includes(o.status) && !!o.dueDate && String(o.dueDate) < today, downMinutes: o.downFrom ? minutesBetween(o.downFrom, o.downTo ?? new Date()) : 0 }));
}

export async function orderDetail(s: Scope, id: string) {
  const o = await getOrder(s.orgId, id);
  const a = await getAsset(s.orgId, o.assetId);
  const items = o.parts.length ? await db.select({ id: schema.invItems.id, name: schema.invItems.name, unit: schema.invItems.unit, sku: schema.invItems.sku }).from(schema.invItems).where(inArray(schema.invItems.id, [...new Set(o.parts.map((p) => p.itemId))])) : [];
  const plan = o.planId ? (await db.select().from(schema.mntPlans).where(eq(schema.mntPlans.id, o.planId)))[0] ?? null : null;
  return {
    order: o,
    asset: { id: a.id, code: a.code, name: a.name, status: a.status, meter: a.meter, meterUnit: a.meterUnit, location: a.location },
    plan: plan ? { id: plan.id, title: plan.title, parts: plan.parts } : null,
    items,
    cost: orderCost({ labour: o.labour, partsCost: Number(o.partsCost), externalCost: Number(o.externalCost) }),
    downMinutes: o.downFrom ? minutesBetween(o.downFrom, o.downTo ?? new Date()) : 0,
    people: await team(s.orgId),
  };
}

/** A new work order. Without work-order rights, it's a request a technician picks up. */
export async function createOrder(s: Scope, raw: unknown) {
  const v = check(orderSchema, raw);
  if (!s.write && !s.settings.requestsFromEveryone) requireWrite(s);
  const a = await getAsset(s.orgId, v.assetId);
  if (a.status === "retired") throw new ApiError("conflict", "That asset is retired");
  await checkMember(s.orgId, v.assigneeId, "assigneeId");
  const number = await nextNumber(s.orgId, "order", s.settings.orderPrefix);
  const stopped = v.stopped && v.kind !== "preventive";
  const [o] = await db
    .insert(schema.mntOrders)
    .values({ orgId: s.orgId, number, assetId: a.id, kind: s.write ? v.kind : "request", title: v.title, description: v.description, priority: v.priority, status: s.write ? "open" : "requested", requestedBy: s.userId, assigneeId: s.write ? v.assigneeId : null, dueDate: v.dueDate, downFrom: stopped ? new Date() : null })
    .returning();
  if (stopped) await db.update(schema.mntAssets).set({ status: "down" }).where(eq(schema.mntAssets.id, a.id));
  return o;
}

const editSchema = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).default(""), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), assigneeId: z.uuid().nullable().default(null), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), kind: z.enum(["breakdown", "preventive", "request", "inspection", "improvement"]).optional() });

export async function updateOrder(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is closed");
  const v = check(editSchema, raw);
  await checkMember(s.orgId, v.assigneeId, "assigneeId");
  const [row] = await db.update(schema.mntOrders).set({ ...v, kind: v.kind ?? o.kind, status: o.status === "requested" ? "open" : o.status }).where(eq(schema.mntOrders.id, o.id)).returning();
  return row;
}

const stepSchema = z.object({ step: z.enum(["start", "hold", "resume", "stop", "back"]) });

/** Start, hold or resume the job; "stop" marks the asset down from now, "back" running again. */
export async function stepOrder(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is closed");
  const { step } = check(stepSchema, raw);
  const set: Partial<Order> = {};
  if (step === "start") Object.assign(set, { status: "in_progress", startedAt: o.startedAt ?? new Date() });
  if (step === "hold") set.status = "on_hold";
  if (step === "resume") set.status = "in_progress";
  if (step === "stop") {
    if (o.downFrom && !o.downTo) throw new ApiError("conflict", "The asset is already marked stopped");
    Object.assign(set, { downFrom: o.downFrom ?? new Date(), downTo: null });
    await db.update(schema.mntAssets).set({ status: o.kind === "breakdown" ? "down" : "maintenance" }).where(eq(schema.mntAssets.id, o.assetId));
  }
  if (step === "back") {
    if (!o.downFrom || o.downTo) throw new ApiError("conflict", "The asset isn't marked stopped");
    set.downTo = new Date();
    await backToRunning(o.assetId, o.id);
  }
  const [row] = await db.update(schema.mntOrders).set(set).where(eq(schema.mntOrders.id, o.id)).returning();
  return row;
}

/** Running again, unless another open order still has it stopped. */
async function backToRunning(assetId: string, exceptOrderId: string) {
  const [other] = await db.select({ id: schema.mntOrders.id }).from(schema.mntOrders).where(and(eq(schema.mntOrders.assetId, assetId), ne(schema.mntOrders.id, exceptOrderId), inArray(schema.mntOrders.status, OPEN), sql`${schema.mntOrders.downFrom} is not null`, isNull(schema.mntOrders.downTo)));
  if (!other) await db.update(schema.mntAssets).set({ status: "running" }).where(and(eq(schema.mntAssets.id, assetId), inArray(schema.mntAssets.status, ["down", "maintenance"])));
}

export async function tickItem(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is closed");
  const v = check(z.object({ item: z.string().min(1).max(40), done: z.boolean(), note: z.string().trim().max(300).optional() }), raw);
  if (!o.checklist.some((c) => c.id === v.item)) throw notFound("Checklist item");
  const checklist = o.checklist.map((c) => (c.id === v.item ? { ...c, done: v.done, ...(v.note !== undefined ? { note: v.note } : {}) } : c));
  await db.update(schema.mntOrders).set({ checklist }).where(eq(schema.mntOrders.id, o.id));
  return { checklist };
}

const labourSchema = z.object({ userId: z.uuid(), minutes: z.number().int().min(1).max(24 * 60), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rate: z.number().int().min(0).max(1e8).optional() });

/** Time someone spent on the job, costed at the workspace's labour rate (owners can set a person's rate). */
export async function logLabour(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is closed");
  const v = check(labourSchema, raw);
  await checkMember(s.orgId, v.userId, "userId");
  const rate = s.manage && v.rate !== undefined ? v.rate : s.settings.labourRate;
  const labour = [...o.labour, { userId: v.userId, minutes: v.minutes, rate, on: v.on }];
  await db.update(schema.mntOrders).set({ labour, status: o.status === "open" ? "in_progress" : o.status, startedAt: o.startedAt ?? new Date() }).where(eq(schema.mntOrders.id, o.id));
  return { labour };
}

const partsSchema = z.object({ warehouseId: z.uuid().optional(), lines: z.array(z.object({ itemId: z.uuid(), qty: z.number().min(-1e6).max(1e6), batch: z.string().trim().max(40).default("") })).min(1).max(100) });

/** Spare parts out of stock onto the job (a negative quantity returns them), at their stock cost. */
export async function issueParts(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  if (!s.has("inventory")) throw new ApiError("forbidden", "Switch on Inventory to issue spare parts from stock");
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is closed");
  const v = check(partsSchema, raw);
  const whId = v.warehouseId ?? o.warehouseId ?? s.settings.partsWarehouseId;
  if (!whId) throw new ApiError("validation_failed", "Pick the location the parts come from", { warehouseId: ["Pick a location"] });
  const ss = await stockScope(s);
  if (ss.warehouses && !ss.warehouses.has(whId)) throw new ApiError("forbidden", "You can't work with stock in that location");
  const wh = await getWarehouse(s.orgId, whId);
  const parts = o.parts.map((p) => ({ ...p }));
  let delta = 0;
  await db.transaction(async (tx) => {
    for (const l of v.lines.filter((x) => Math.abs(x.qty) >= 0.0005)) {
      const item = await getItem(s.orgId, l.itemId, tx);
      let p = parts.find((x) => x.itemId === item.id);
      if (!p) parts.push((p = { itemId: item.id, qty: 0, cost: 0 }));
      if (l.qty < 0 && -l.qty > p.qty + 0.0005) throw new ApiError("validation_failed", `You can't return more ${item.name} than was issued`);
      const unit = l.qty > 0 ? item.avgCost : p.qty ? p.cost / p.qty : item.avgCost;
      const lots = l.qty > 0 ? await allocate(tx, item, wh, l.qty, l.batch) : [{ batch: l.batch, qty: l.qty }];
      for (const lot of lots) await move(tx, ss, { item, warehouse: wh, qty: -lot.qty, kind: l.qty > 0 ? "issue" : "return", batch: lot.batch, unitCost: Math.round(unit), refType: "mnt_order", refId: o.id, refNo: o.number, note: l.qty > 0 ? "Issued for maintenance" : "Returned from maintenance" });
      const c = Math.round(l.qty * unit);
      p.qty = Math.round((p.qty + l.qty) * 1000) / 1000;
      p.cost += c;
      delta += c;
    }
    await tx.update(schema.mntOrders).set({ parts: parts.filter((p) => p.qty > 0.0005 || p.cost), partsCost: sql`${schema.mntOrders.partsCost} + ${delta}`, warehouseId: wh.id }).where(eq(schema.mntOrders.id, o.id));
  });
  return { parts, partsCost: Number(o.partsCost) + delta };
}

export async function setExternal(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is closed");
  const v = check(z.object({ cost: z.number().int().min(0).max(1e11), note: z.string().trim().max(300).default("") }), raw);
  await db.update(schema.mntOrders).set({ externalCost: v.cost, externalNote: v.note }).where(eq(schema.mntOrders.id, o.id));
  return { externalCost: v.cost };
}

const completeSchema = z.object({ failure: z.string().trim().max(200).default(""), cause: z.string().trim().max(1000).default(""), remedy: z.string().trim().max(1000).default(""), meter: z.number().min(0).max(1e12).nullable().default(null), force: z.boolean().default(false) });

/** Done: the asset is back (downtime ends), a plan's next service counts from today (and the meter), and a breakdown needs its cause. */
export async function completeOrder(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is already closed");
  if (o.status === "requested") throw new ApiError("conflict", "Accept the request first");
  const v = check(completeSchema, raw);
  if (o.kind === "breakdown" && !v.cause) throw new ApiError("validation_failed", "Say what caused the breakdown", { cause: ["Needed for a breakdown"] });
  const left = o.checklist.filter((c) => !c.done).length;
  if (left && !v.force) throw new ApiError("conflict", `${left} checklist item${left === 1 ? " isn't" : "s aren't"} done. Tick them, or finish anyway.`);
  const a = await getAsset(s.orgId, o.assetId);
  const today = todayIst();
  if (v.meter !== null) {
    if (!a.meterUnit) throw new ApiError("validation_failed", "This asset has no meter");
    if (a.meter !== null && v.meter < a.meter) throw new ApiError("validation_failed", `That's below the last reading (${a.meter} ${a.meterUnit})`);
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    const [ok] = await tx.update(schema.mntOrders).set({ status: "done", completedAt: now, startedAt: o.startedAt ?? now, downTo: o.downFrom && !o.downTo ? now : o.downTo, failure: v.failure, cause: v.cause, remedy: v.remedy, meterAtDone: v.meter ?? a.meter }).where(and(eq(schema.mntOrders.id, o.id), inArray(schema.mntOrders.status, OPEN))).returning();
    if (!ok) throw new ApiError("conflict", "This work order is already closed");
    if (v.meter !== null) {
      await tx.insert(schema.mntReadings).values({ orgId: s.orgId, assetId: a.id, value: v.meter, on: today, by: s.userId });
      await tx.update(schema.mntAssets).set({ meter: v.meter, meterAt: today }).where(eq(schema.mntAssets.id, a.id));
    }
    if (o.planId) await tx.update(schema.mntPlans).set({ lastDoneOn: today, lastDoneMeter: v.meter ?? a.meter }).where(eq(schema.mntPlans.id, o.planId));
  });
  if (o.downFrom && !o.downTo) await backToRunning(a.id, o.id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "maintenance.order_done", targetType: "mnt_order", targetId: o.id, metadata: { number: o.number, kind: o.kind } });
  return getOrder(s.orgId, o.id);
}

export async function cancelOrder(s: Scope, id: string) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This work order is already closed");
  if (o.parts.some((p) => p.qty > 0.0005)) throw new ApiError("conflict", "Parts were issued to this job. Return them first, or finish it.");
  await db.update(schema.mntOrders).set({ status: "cancelled", downTo: o.downFrom && !o.downTo ? new Date() : o.downTo }).where(eq(schema.mntOrders.id, o.id));
  if (o.downFrom && !o.downTo) await backToRunning(o.assetId, o.id);
}

// ── Contracts ───────────────────────────────────────────────────────────────

function contractState(c: { startOn: string | Date; endOn: string | Date }, today: string, notice: number) {
  const end = String(c.endOn);
  if (end < today) return "expired";
  if (String(c.startOn) > today) return "upcoming";
  return addDaysIso(today, notice) >= end ? "ending" : "active";
}

export async function contracts(s: Scope) {
  const rows = await db.select().from(schema.mntContracts).where(eq(schema.mntContracts.orgId, s.orgId)).orderBy(asc(schema.mntContracts.endOn));
  const ids = [...new Set(rows.flatMap((r) => r.assetIds))];
  const assets = ids.length ? await db.select({ id: schema.mntAssets.id, code: schema.mntAssets.code, name: schema.mntAssets.name }).from(schema.mntAssets).where(inArray(schema.mntAssets.id, ids)) : [];
  const today = todayIst();
  return rows.map((c) => ({ ...c, cost: s.manage ? c.cost : 0, state: contractState(c, today, s.settings.contractNoticeDays), assets: assets.filter((a) => c.assetIds.includes(a.id)) }));
}

export async function saveContract(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(contractSchema, raw);
  if (v.endOn < v.startOn) throw new ApiError("validation_failed", "It ends before it starts", { endOn: ["Before the start"] });
  const found = await db.select({ id: schema.mntAssets.id }).from(schema.mntAssets).where(and(eq(schema.mntAssets.orgId, s.orgId), inArray(schema.mntAssets.id, v.assetIds)));
  if (found.length !== new Set(v.assetIds).size) throw new ApiError("validation_failed", "Some of those assets aren't in this workspace", { assetIds: ["Unknown asset"] });
  if (v.supplierId) {
    const [sup] = await db.select({ id: schema.invSuppliers.id }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.id, v.supplierId), eq(schema.invSuppliers.orgId, s.orgId)));
    if (!sup) throw new ApiError("validation_failed", "That supplier isn't in this workspace", { supplierId: ["Unknown supplier"] });
  }
  const values = { ...v, assetIds: [...new Set(v.assetIds)] };
  if (id) {
    if (!isId(id)) throw notFound("Contract");
    const [row] = await db.update(schema.mntContracts).set(values).where(and(eq(schema.mntContracts.id, id), eq(schema.mntContracts.orgId, s.orgId))).returning();
    if (!row) throw notFound("Contract");
    return row;
  }
  const [row] = await db.insert(schema.mntContracts).values({ ...values, orgId: s.orgId }).returning();
  return row;
}

export async function deleteContract(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Contract");
  const [row] = await db.delete(schema.mntContracts).where(and(eq(schema.mntContracts.id, id), eq(schema.mntContracts.orgId, s.orgId))).returning();
  if (!row) throw notFound("Contract");
}

// ── Reports & home ──────────────────────────────────────────────────────────

const range = (q: { from?: string; to?: string }) => {
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const to = ok(q.to) ? q.to! : todayIst();
  const from = ok(q.from) && q.from! <= to ? q.from! : addDaysIso(to, -89);
  return { from, to, hours: (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 3_600_000 + 24 };
};

/** Per asset over a period: failures, downtime, MTBF, MTTR, availability, and what jobs completed in it cost. */
export async function reports(s: Scope, q: { from?: string; to?: string }) {
  const r = range(q);
  const [assets, orders] = await Promise.all([
    db.select().from(schema.mntAssets).where(and(eq(schema.mntAssets.orgId, s.orgId), ne(schema.mntAssets.status, "retired"))).orderBy(asc(schema.mntAssets.code)),
    db.select().from(schema.mntOrders).where(and(eq(schema.mntOrders.orgId, s.orgId), ne(schema.mntOrders.status, "cancelled"))),
  ]);
  const rows = assets.map((a) => {
    const mine = orders.filter((o) => o.assetId === a.id);
    const breakdowns = mine.filter((o) => o.kind === "breakdown" && o.downFrom).map((o) => ({ downMinutes: downIn(o, r.from, r.to) })).filter((b) => b.downMinutes > 0);
    const done = mine.filter((o) => o.status === "done" && o.completedAt && toIst(o.completedAt) >= r.from && toIst(o.completedAt) <= r.to);
    const cost = done.reduce((t, o) => {
      const c = orderCost({ labour: o.labour, partsCost: Number(o.partsCost), externalCost: Number(o.externalCost) });
      return { labour: t.labour + c.labour, parts: t.parts + c.parts, external: t.external + c.external, total: t.total + c.total };
    }, { labour: 0, parts: 0, external: 0, total: 0 });
    return { id: a.id, code: a.code, name: a.name, category: a.category, criticality: a.criticality, ...reliability(r.hours, breakdowns), jobs: done.length, preventive: done.filter((o) => o.kind === "preventive").length, cost };
  });
  const totals = rows.reduce((t, x) => ({ failures: t.failures + x.failures, downHours: Math.round((t.downHours + x.downHours) * 100) / 100, jobs: t.jobs + x.jobs, cost: t.cost + x.cost.total }), { failures: 0, downHours: 0, jobs: 0, cost: 0 });
  const done = rows.reduce((n, x) => n + x.jobs, 0);
  return { ...r, assets: rows, totals: { ...totals, preventiveShare: done ? rows.reduce((n, x) => n + x.preventive, 0) / done : null } };
}

const toIst = (d: Date | string) => new Date(new Date(d).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export async function home(s: Scope) {
  const today = todayIst();
  const [orders, assets, ps, cs] = await Promise.all([listOrders(s, { status: "open" }), db.select({ id: schema.mntAssets.id, code: schema.mntAssets.code, name: schema.mntAssets.name, status: schema.mntAssets.status, criticality: schema.mntAssets.criticality }).from(schema.mntAssets).where(eq(schema.mntAssets.orgId, s.orgId)), plans(s), contracts(s)]);
  const month = today.slice(0, 7);
  const [{ cost }] = (await db.execute(sql`select coalesce(sum(parts_cost + external_cost), 0)::bigint as cost from mnt_orders where org_id = ${s.orgId} and status = 'done' and to_char(completed_at at time zone 'Asia/Kolkata', 'YYYY-MM') = ${month}`) as unknown as { rows: { cost: number }[] }).rows;
  return {
    counts: { open: orders.length, overdue: orders.filter((o) => o.overdue).length, requests: orders.filter((o) => o.status === "requested").length, down: assets.filter((a) => a.status === "down").length, assets: assets.filter((a) => a.status !== "retired").length, dueNotRaised: ps.filter((p) => p.active && p.due && !p.openOrder).length },
    down: assets.filter((a) => a.status === "down"),
    orders: orders.slice(0, 10),
    upcoming: ps.filter((p) => p.active && p.date && p.date <= addDaysIso(today, 30)).slice(0, 10),
    contracts: cs.filter((c) => c.state === "ending" || c.state === "expired").slice(0, 8),
    partsAndOutsideThisMonth: Number(cost),
  };
}

// ── Books ───────────────────────────────────────────────────────────────────

/** Spare parts used on maintenance jobs: Dr repairs and maintenance, Cr inventory (and back for returns). */
export async function maintenanceWants(orgId: string, ofWarehouse: (id: string) => { companyId?: string; branchId?: string | null }) {
  const moves = await db.select({ m: schema.invMoves, item: schema.invItems.name }).from(schema.invMoves).innerJoin(schema.invItems, eq(schema.invItems.id, schema.invMoves.itemId)).where(and(eq(schema.invMoves.orgId, orgId), eq(schema.invMoves.refType, "mnt_order")));
  return moves
    .map(({ m, item }) => ({ m, item, value: Math.round(-m.qty * m.unitCost) }))
    .filter((x) => x.value)
    .map(({ m, item, value }) => ({
      sourceType: "maintenance_parts",
      sourceId: m.id,
      date: toIst(m.createdAt),
      narration: `${value > 0 ? "Spare parts used" : "Spare parts returned"}: ${item}`,
      sourceRef: m.refNo || "Maintenance",
      party: "",
      lines: value > 0 ? [{ key: "repairs", debit: value, credit: 0 }, { key: "inventory", debit: 0, credit: value }] : [{ key: "inventory", debit: -value, credit: 0 }, { key: "repairs", debit: 0, credit: -value }],
      ...ofWarehouse(m.warehouseId),
    }));
}
