// Cloudesk for Horeca: sales reports for any date range (venue time) — totals,
// GST by rate, payment methods, order types, hours, days, categories, items,
// staff, voids/discounts/comps and feedback — and the outlets view for chains.
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { splitGst } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { totalsOf } from "./orders";
import { requireVenue } from "./venue";

const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).getUTCHours();
const day = (s: string | undefined, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s ?? "") ? s! : fallback);

export async function salesReport(projectId: string, fromDay?: string, toDay?: string) {
  const venue = await requireVenue(projectId);
  const today = istDate(new Date());
  const from = day(fromDay, today);
  const to = day(toDay, from);
  if (to < from) throw new ApiError("validation_failed", "The end date is before the start");
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000);
  if (end.getTime() - start.getTime() > 400 * 86_400_000) throw new ApiError("validation_failed", "Choose up to 400 days");

  const orders = await db
    .select()
    .from(schema.horecaOrders)
    .where(and(eq(schema.horecaOrders.projectId, projectId), inArray(schema.horecaOrders.status, ["paid", "cancelled"]), isNotNull(schema.horecaOrders.closedAt), gte(schema.horecaOrders.closedAt, start), lt(schema.horecaOrders.closedAt, end)));
  const paid = orders.filter((o) => o.status === "paid");
  const items = paid.length ? await db.select().from(schema.horecaOrderItems).where(inArray(schema.horecaOrderItems.orderId, paid.map((o) => o.id))) : [];
  const menu = await db.select({ id: schema.horecaItems.id, category: schema.horecaCategories.name }).from(schema.horecaItems).innerJoin(schema.horecaCategories, eq(schema.horecaCategories.id, schema.horecaItems.categoryId)).where(eq(schema.horecaItems.projectId, projectId));

  const sum = { gross: 0, discounts: 0, comps: 0, net: 0, service: 0, delivery: 0, tax: 0, tips: 0, roundOff: 0, total: 0, bills: paid.length, covers: 0 };
  /** Spend on bills that recorded covers — a per-head figure only means something over those. */
  let coveredTotal = 0;
  const methods: Record<string, number> = {};
  const types: Record<string, { bills: number; total: number }> = {};
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, bills: 0, total: 0 }));
  const days = new Map<string, { day: string; bills: number; total: number; covers: number }>();
  const staff = new Map<string, { name: string; bills: number; total: number }>();
  const gst = new Map<number, { rate: number; taxable: number; tax: number }>();
  for (const o of paid) {
    const mine = items.filter((i) => i.orderId === o.id);
    const t = totalsOf(o, mine, venue);
    sum.gross += t.subtotal + t.comps;
    sum.discounts += t.discount;
    sum.comps += t.comps;
    sum.net += t.subtotal - t.discount;
    sum.service += t.service;
    sum.delivery += t.delivery;
    sum.tax += t.tax;
    sum.tips += t.tip;
    sum.roundOff += t.roundOff;
    sum.total += t.total;
    sum.covers += o.covers;
    if (o.covers) coveredTotal += t.total;
    for (const p of o.payments as { method: string; amount: number }[]) methods[p.method] = (methods[p.method] ?? 0) + p.amount;
    const ty = (types[o.source] ??= { bills: 0, total: 0 });
    ty.bills++;
    ty.total += t.total;
    const h = hours[istHour(o.closedAt!)];
    h.bills++;
    h.total += t.total;
    const d = istDate(o.closedAt!);
    const dd = days.get(d) ?? { day: d, bills: 0, total: 0, covers: 0 };
    dd.bills++;
    dd.total += t.total;
    dd.covers += o.covers;
    days.set(d, dd);
    const who = o.staffName || "Not recorded";
    const st = staff.get(who) ?? { name: who, bills: 0, total: 0 };
    st.bills++;
    st.total += t.total;
    staff.set(who, st);
    // GST by rate: each line's share of the discount, plus service and delivery at the venue rate.
    const keep = t.subtotal ? (t.subtotal - t.discount) / t.subtotal : 0;
    for (const i of mine.filter((x) => x.status !== "void" && x.status !== "pending" && !x.comp)) {
      const g = gst.get(i.taxBps) ?? { rate: i.taxBps, taxable: 0, tax: 0 };
      const taxable = i.qty * i.unitPrice * keep;
      g.taxable += taxable;
      g.tax += (taxable * i.taxBps) / 10_000;
      gst.set(i.taxBps, g);
    }
    if (t.service + t.delivery) {
      const g = gst.get(venue.taxBps) ?? { rate: venue.taxBps, taxable: 0, tax: 0 };
      g.taxable += t.service + t.delivery;
      g.tax += ((t.service + t.delivery) * venue.taxBps) / 10_000;
      gst.set(venue.taxBps, g);
    }
  }
  const byItem = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
  const byCat = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const i of items) {
    if (i.status === "void" || i.status === "pending") continue;
    const revenue = i.comp ? 0 : i.qty * i.unitPrice;
    const cat = menu.find((m) => m.id === i.itemId)?.category ?? "Other";
    const it = byItem.get(i.name) ?? { name: i.name, category: cat, qty: 0, revenue: 0 };
    it.qty += i.qty;
    it.revenue += revenue;
    byItem.set(i.name, it);
    const c = byCat.get(cat) ?? { name: cat, qty: 0, revenue: 0 };
    c.qty += i.qty;
    c.revenue += revenue;
    byCat.set(cat, c);
  }
  const events = await db.select().from(schema.horecaEvents).where(and(eq(schema.horecaEvents.projectId, projectId), gte(schema.horecaEvents.createdAt, start), lt(schema.horecaEvents.createdAt, end))).orderBy(asc(schema.horecaEvents.createdAt));
  const [fb] = await db.select({ n: sql<number>`count(*)::int`, avg: sql<number>`coalesce(avg(${schema.horecaFeedback.rating}), 0)::float` }).from(schema.horecaFeedback).where(and(eq(schema.horecaFeedback.projectId, projectId), gte(schema.horecaFeedback.createdAt, start), lt(schema.horecaFeedback.createdAt, end)));
  const cancelled = orders.filter((o) => o.status === "cancelled" && !o.cancelReason.startsWith("Merged into"));
  const round = (n: number) => Math.round(n);
  const tax = splitGst(sum.tax);
  return {
    from,
    to,
    currency: venue.currency,
    totals: { ...sum, ...tax, average: sum.bills ? round(sum.total / sum.bills) : 0, perCover: sum.covers ? round(coveredTotal / sum.covers) : 0 },
    gst: [...gst.values()].sort((a, b) => a.rate - b.rate).map((g) => ({ rate: g.rate, taxable: round(g.taxable), tax: round(g.tax), ...splitGst(round(g.tax)) })),
    methods,
    types,
    hours,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    categories: [...byCat.values()].sort((a, b) => b.revenue - a.revenue),
    items: [...byItem.values()].sort((a, b) => b.revenue - a.revenue),
    staff: [...staff.values()].sort((a, b) => b.total - a.total),
    cancelled: { count: cancelled.length },
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    eventTotals: ["void", "discount", "comp", "pay_out"].map((k) => ({ kind: k, count: events.filter((e) => e.kind === k).length, amount: events.filter((e) => e.kind === k).reduce((a, e) => a + e.amount, 0) })),
    feedback: { count: fb?.n ?? 0, average: Math.round((fb?.avg ?? 0) * 10) / 10 },
  };
}

// ─── Chains: every outlet in the workspace ───────────────────────────────────

export async function outlets(orgId: string) {
  const rows = await db
    .select({ projectId: schema.horecaVenues.projectId, name: schema.horecaVenues.name, kind: schema.horecaVenues.kind, currency: schema.horecaVenues.currency, project: schema.projects.name })
    .from(schema.horecaVenues)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.horecaVenues.projectId))
    .where(and(eq(schema.projects.orgId, orgId), sql`${schema.projects.archivedAt} is null`))
    .orderBy(asc(schema.horecaVenues.name));
  const today = istDate(new Date());
  const out = [];
  for (const r of rows) {
    const rep = await salesReport(r.projectId, today, today);
    const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.horecaOrders).where(and(eq(schema.horecaOrders.projectId, r.projectId), inArray(schema.horecaOrders.status, ["open", "billed"])));
    const [tables] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.horecaTables).where(and(eq(schema.horecaTables.projectId, r.projectId), eq(schema.horecaTables.active, true), eq(schema.horecaTables.kind, "table")));
    out.push({ ...r, sales: rep.totals.total, bills: rep.totals.bills, covers: rep.totals.covers, open: open?.n ?? 0, tables: tables?.n ?? 0 });
  }
  return { outlets: out, totals: { sales: out.reduce((a, o) => a + o.sales, 0), bills: out.reduce((a, o) => a + o.bills, 0), covers: out.reduce((a, o) => a + o.covers, 0) } };
}

/** Copies another outlet's menu (categories, add-ons, dishes) into this one. Bar and recipe links stay behind. */
export async function copyMenu(projectId: string, fromProjectId: string) {
  if (fromProjectId === projectId) throw new ApiError("validation_failed", "Choose a different outlet");
  await requireVenue(projectId);
  const [src] = await db.select({ id: schema.horecaVenues.projectId }).from(schema.horecaVenues).where(eq(schema.horecaVenues.projectId, fromProjectId));
  if (!src) throw notFound("Outlet");
  const [cats, groups, items] = await Promise.all([
    db.select().from(schema.horecaCategories).where(eq(schema.horecaCategories.projectId, fromProjectId)),
    db.select().from(schema.horecaModifierGroups).where(eq(schema.horecaModifierGroups.projectId, fromProjectId)),
    db.select().from(schema.horecaItems).where(eq(schema.horecaItems.projectId, fromProjectId)),
  ]);
  return db.transaction(async (tx) => {
    const catMap = new Map<string, string>();
    for (const c of cats) {
      const [n] = await tx.insert(schema.horecaCategories).values({ projectId, name: c.name, station: c.station, availableFrom: c.availableFrom, availableTo: c.availableTo, active: c.active, sort: c.sort }).returning();
      catMap.set(c.id, n.id);
    }
    const groupMap = new Map<string, string>();
    for (const g of groups) {
      const [n] = await tx.insert(schema.horecaModifierGroups).values({ projectId, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options }).returning();
      groupMap.set(g.id, n.id);
    }
    for (const i of items) {
      const { id: _id, projectId: _p, createdAt: _c, categoryId, modifierGroupIds, ...rest } = i;
      void _id;
      void _p;
      void _c;
      await tx.insert(schema.horecaItems).values({ ...rest, projectId, categoryId: catMap.get(categoryId)!, modifierGroupIds: (modifierGroupIds as string[]).map((m) => groupMap.get(m)).filter(Boolean), barItemId: null, pourMl: null, recipe: [] });
    }
    return { categories: cats.length, groups: groups.length, items: items.length };
  });
}
