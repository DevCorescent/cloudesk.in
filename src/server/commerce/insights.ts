import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const day = (d: Date) => d.toISOString().slice(0, 10);

type Period = { from: Date; to: Date };

async function periodSales(projectId: string, p: Period) {
  const live = and(eq(schema.storeOrders.projectId, projectId), isNull(schema.storeOrders.cancelledAt), gte(schema.storeOrders.createdAt, p.from), lt(schema.storeOrders.createdAt, p.to));
  const [agg] = await db
    .select({
      orders: sql<number>`count(*)::int`,
      gross: sql<number>`coalesce(sum(coalesce(${schema.storeOrders.baseTotal}, ${schema.storeOrders.total})),0)::bigint`,
      refunds: sql<number>`coalesce(sum(${schema.storeOrders.refundedTotal}),0)::bigint`,
      discounts: sql<number>`coalesce(sum(${schema.storeOrders.discountTotal}),0)::bigint`,
      shipping: sql<number>`coalesce(sum(${schema.storeOrders.shippingTotal}),0)::bigint`,
      tax: sql<number>`coalesce(sum(${schema.storeOrders.taxTotal}),0)::bigint`,
      paid: sql<number>`coalesce(sum(case when ${schema.storeOrders.financialStatus} in ('paid','partially_refunded','refunded') then coalesce(${schema.storeOrders.baseTotal}, ${schema.storeOrders.total}) else 0 end),0)::bigint`,
      // Walk-in sales carry no email; count known customers by record, else by email.
      customers: sql<number>`count(distinct coalesce(${schema.storeOrders.customerId}::text, nullif(lower(${schema.storeOrders.email}), '')))::int`,
    })
    .from(schema.storeOrders)
    .where(live);
  const [items] = await db
    .select({
      units: sql<number>`coalesce(sum(i.quantity),0)::int`,
      revenueWithCost: sql<number>`coalesce(sum(case when i.unit_cost is not null then i.total else 0 end),0)::bigint`,
      cost: sql<number>`coalesce(sum(coalesce(i.unit_cost,0) * i.quantity),0)::bigint`,
    })
    .from(sql`store_order_items i join store_orders o on o.id = i.order_id`)
    .where(sql`o.project_id = ${projectId} and o.cancelled_at is null and o.created_at >= ${p.from} and o.created_at < ${p.to}`);
  const n = (v: unknown) => Number(v ?? 0);
  const gross = n(agg.gross);
  const net = gross - n(agg.refunds);
  return {
    orders: n(agg.orders),
    gross,
    net,
    refunds: n(agg.refunds),
    discounts: n(agg.discounts),
    shipping: n(agg.shipping),
    tax: n(agg.tax),
    collected: n(agg.paid),
    customers: n(agg.customers),
    aov: agg.orders ? Math.round(gross / n(agg.orders)) : 0,
    units: n(items.units),
    // Profit only where products have a cost recorded.
    costCoverage: n(items.revenueWithCost),
    grossProfit: n(items.revenueWithCost) - n(items.cost),
  };
}

const change = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : (cur - prev) / prev);

export async function storeInsights(projectId: string, days: number) {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - days * 86400_000);
  const prevFrom = new Date(from.getTime() - days * 86400_000);
  const [cur, prev] = await Promise.all([periodSales(projectId, { from, to }), periodSales(projectId, { from: prevFrom, to: from })]);

  const series = await db
    .select({ day: sql<string>`to_char(${schema.storeOrders.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`, sales: sql<number>`coalesce(sum(coalesce(${schema.storeOrders.baseTotal}, ${schema.storeOrders.total})),0)::bigint`, orders: sql<number>`count(*)::int` })
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), isNull(schema.storeOrders.cancelledAt), gte(schema.storeOrders.createdAt, from)))
    .groupBy(sql`1`);
  const byDay = new Map(series.map((r) => [r.day, r]));
  const daily = Array.from({ length: days }, (_, i) => {
    const d = day(new Date(from.getTime() + i * 86400_000));
    const r = byDay.get(d);
    return { day: d, sales: Number(r?.sales ?? 0), orders: r?.orders ?? 0 };
  });

  const topProducts = await db.execute<{ title: string; units: number; revenue: number }>(sql`
    select i.title, sum(i.quantity)::int as units, sum(i.total)::bigint as revenue
    from store_order_items i join store_orders o on o.id = i.order_id
    where o.project_id = ${projectId} and o.cancelled_at is null and o.created_at >= ${from}
    group by i.title order by revenue desc limit 8`);

  const payments = await db
    .select({ method: schema.storeOrders.paymentMethod, orders: sql<number>`count(*)::int`, sales: sql<number>`coalesce(sum(coalesce(${schema.storeOrders.baseTotal}, ${schema.storeOrders.total})),0)::bigint` })
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), isNull(schema.storeOrders.cancelledAt), gte(schema.storeOrders.createdAt, from)))
    .groupBy(schema.storeOrders.paymentMethod);

  const regions = await db.execute<{ region: string; orders: number; sales: number }>(sql`
    select coalesce(nullif(shipping_address->>'region',''), shipping_address->>'country') as region, count(*)::int as orders, sum(coalesce(base_total, total))::bigint as sales
    from store_orders where project_id = ${projectId} and cancelled_at is null and created_at >= ${from}
    group by 1 order by sales desc limit 6`);

  // Returning = customers in this period who also ordered before it.
  const [ret] = await db.execute<{ returning: number; total: number }>(sql`
    with cur as (select distinct lower(email) e from store_orders where project_id = ${projectId} and cancelled_at is null and created_at >= ${from})
    select count(*) filter (where exists (select 1 from store_orders o where o.project_id = ${projectId} and lower(o.email) = cur.e and o.created_at < ${from}))::int as returning, count(*)::int as total from cur`).then((r) => r.rows);

  const [backlog] = await db
    .select({
      toFulfill: sql<number>`count(*) filter (where ${schema.storeOrders.fulfillmentStatus} in ('unfulfilled','packed') and (${schema.storeOrders.financialStatus} = 'paid' or ${schema.storeOrders.paymentMethod} = 'cod'))::int`,
      unpaid: sql<number>`count(*) filter (where ${schema.storeOrders.financialStatus} = 'pending' and ${schema.storeOrders.paymentMethod} in ('manual'))::int`,
      inTransit: sql<number>`count(*) filter (where ${schema.storeOrders.fulfillmentStatus} = 'shipped')::int`,
    })
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), isNull(schema.storeOrders.cancelledAt)));

  const [store] = await db.select({ threshold: schema.stores.lowStockThreshold }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const lowStock = await db
    .select({ variantId: schema.storeVariants.id, productId: schema.storeProducts.id, title: schema.storeProducts.title, variant: schema.storeVariants.title, stock: schema.storeVariants.stock })
    .from(schema.storeVariants)
    .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
    .where(and(eq(schema.storeVariants.projectId, projectId), eq(schema.storeVariants.trackInventory, true), eq(schema.storeProducts.status, "active"), sql`${schema.storeVariants.stock} <= ${store?.threshold ?? 5}`))
    .orderBy(schema.storeVariants.stock)
    .limit(10);

  const fromDay = day(from);
  const funnelRows = await db
    .select({ kind: schema.siteStats.kind, path: schema.siteStats.path, count: sql<number>`sum(${schema.siteStats.count})::int` })
    .from(schema.siteStats)
    // Views on A/B pages exist only as experiment rows; store events are also copied to experiment rows, so count those once.
    .where(and(eq(schema.siteStats.projectId, projectId), gte(schema.siteStats.day, fromDay), sql`(${schema.siteStats.kind} = 'view' or ${schema.siteStats.experiment} = '')`))
    .groupBy(schema.siteStats.kind, schema.siteStats.path);
  const sum = (f: (r: (typeof funnelRows)[number]) => boolean) => funnelRows.filter(f).reduce((a, r) => a + r.count, 0);
  const funnel = {
    visits: sum((r) => r.kind === "view"),
    productViews: sum((r) => r.kind === "view" && r.path.startsWith("/product/")),
    addToCart: sum((r) => r.kind === "cart_add"),
    checkout: sum((r) => r.kind === "checkout"),
    orders: cur.orders,
  };

  const [abandoned] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.storeCarts)
    .where(and(eq(schema.storeCarts.projectId, projectId), isNull(schema.storeCarts.orderId), gte(schema.storeCarts.updatedAt, from), lt(schema.storeCarts.updatedAt, new Date(Date.now() - 3600_000)), sql`${schema.storeCarts.email} <> ''`, sql`jsonb_array_length(${schema.storeCarts.items}) > 0`));

  return {
    range: { from: fromDay, days },
    kpis: {
      gross: { value: cur.gross, change: change(cur.gross, prev.gross) },
      net: { value: cur.net, change: change(cur.net, prev.net) },
      orders: { value: cur.orders, change: change(cur.orders, prev.orders) },
      aov: { value: cur.aov, change: change(cur.aov, prev.aov) },
      units: { value: cur.units, change: change(cur.units, prev.units) },
      customers: { value: cur.customers, change: change(cur.customers, prev.customers) },
      conversion: { value: funnel.visits ? cur.orders / funnel.visits : null, change: null },
      grossProfit: { value: cur.costCoverage ? cur.grossProfit : null, margin: cur.costCoverage ? cur.grossProfit / cur.costCoverage : null },
    },
    breakdown: { refunds: cur.refunds, discounts: cur.discounts, shipping: cur.shipping, tax: cur.tax, collected: cur.collected },
    daily,
    topProducts: topProducts.rows.map((r) => ({ title: r.title, units: Number(r.units), revenue: Number(r.revenue) })),
    payments: payments.map((p) => ({ method: p.method, orders: p.orders, sales: Number(p.sales) })),
    regions: regions.rows.map((r) => ({ region: r.region, orders: Number(r.orders), sales: Number(r.sales) })),
    customers: { returning: Number(ret?.returning ?? 0), total: Number(ret?.total ?? 0) },
    backlog,
    lowStock,
    funnel,
    abandoned: abandoned.count,
  };
}
