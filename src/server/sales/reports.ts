// Commission plans and targets, and the sales numbers: what each salesperson
// sold (invoiced from their orders, less credit notes) and collected, their
// commission, and the home screen's open orders, deliveries and invoicing due.
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { commissionOn, openValue, planSchema, targetSchema, toInvoice } from "@/lib/sales/model";
import { ApiError, notFound } from "../http/errors";
import { check, people, requireManage, requirePart, todayIst, type Scope } from "./access";

export async function plans(s: Scope) {
  return db.select().from(schema.salesCommissionPlans).where(eq(schema.salesCommissionPlans.orgId, s.orgId)).orderBy(asc(schema.salesCommissionPlans.name));
}

export async function savePlan(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  requirePart(s, "commissions");
  const v = check(planSchema, raw);
  if (v.userId && !(await people(s.orgId)).some((p) => p.id === v.userId)) throw new ApiError("validation_failed", "Pick someone in this workspace");
  if (id) {
    const [r] = await db.update(schema.salesCommissionPlans).set(v).where(and(eq(schema.salesCommissionPlans.id, id), eq(schema.salesCommissionPlans.orgId, s.orgId))).returning();
    if (!r) throw notFound("Plan");
    return r;
  }
  const [r] = await db.insert(schema.salesCommissionPlans).values({ ...v, orgId: s.orgId }).returning();
  return r;
}

export async function deletePlan(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.salesCommissionPlans).where(and(eq(schema.salesCommissionPlans.id, id), eq(schema.salesCommissionPlans.orgId, s.orgId)));
}

export async function targets(s: Scope, year?: string) {
  const y = year && /^\d{4}$/.test(year) ? year : todayIst().slice(0, 4);
  return db.select().from(schema.salesTargets).where(and(eq(schema.salesTargets.orgId, s.orgId), sql`${schema.salesTargets.month} like ${`${y}-%`}`));
}

export async function setTarget(s: Scope, raw: unknown) {
  requireManage(s);
  requirePart(s, "commissions");
  const v = check(targetSchema, raw);
  if (!(await people(s.orgId)).some((p) => p.id === v.userId)) throw new ApiError("validation_failed", "Pick someone in this workspace");
  if (!v.amount) {
    await db.delete(schema.salesTargets).where(and(eq(schema.salesTargets.orgId, s.orgId), eq(schema.salesTargets.userId, v.userId), eq(schema.salesTargets.month, v.month)));
    return null;
  }
  const [r] = await db.insert(schema.salesTargets).values({ ...v, orgId: s.orgId }).onConflictDoUpdate({ target: [schema.salesTargets.orgId, schema.salesTargets.userId, schema.salesTargets.month], set: { amount: v.amount } }).returning();
  return r;
}

type Sold = { user_id: string | null; month: string; invoiced: number; collected: number };

/** Sales (before tax) per salesperson and month: invoiced from their orders less credit notes, and collected in the period. */
async function sold(orgId: string, from: string, to: string) {
  const inv = (await db.execute(sql`
    select o.salesperson_id as user_id, to_char(d.issue_date, 'YYYY-MM') as month,
      sum(case when d.type = 'credit_note' then -(d.total - d.tax_total) else d.total - d.tax_total end)::bigint as invoiced
    from sales_order_invoices l join sales_orders o on o.id = l.order_id join invoice_documents d on d.id = l.invoice_id
    where l.org_id = ${orgId} and d.status not in ('draft','void') and d.issue_date between ${from} and ${to}
    group by 1, 2`)) as unknown as { rows: { user_id: string | null; month: string; invoiced: number }[] };
  // Payments, counted before tax in the same proportion as their invoice.
  const col = (await db.execute(sql`
    select o.salesperson_id as user_id, to_char(p.paid_on, 'YYYY-MM') as month,
      sum(round(p.amount::numeric * (d.total - d.tax_total) / nullif(d.total, 0)))::bigint as collected
    from sales_order_invoices l join sales_orders o on o.id = l.order_id join invoice_documents d on d.id = l.invoice_id and d.type = 'invoice'
      join invoice_payments p on p.document_id = d.id
    where l.org_id = ${orgId} and d.status <> 'void' and p.paid_on between ${from} and ${to}
    group by 1, 2`)) as unknown as { rows: { user_id: string | null; month: string; collected: number }[] };
  const out = new Map<string, Sold>();
  const key = (u: string | null, m: string) => `${u ?? ""}|${m}`;
  for (const r of inv.rows) out.set(key(r.user_id, r.month), { user_id: r.user_id, month: r.month, invoiced: Number(r.invoiced), collected: 0 });
  for (const r of col.rows) {
    const k = key(r.user_id, r.month);
    out.set(k, { ...(out.get(k) ?? { user_id: r.user_id, month: r.month, invoiced: 0, collected: 0 }), collected: Number(r.collected) });
  }
  return [...out.values()];
}

/** Commission per salesperson for a period, by their plan (their own, else the one for everyone). */
export async function commissions(s: Scope, q: { from?: string; to?: string }) {
  requirePart(s, "commissions");
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : todayIst();
  const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : `${to.slice(0, 7)}-01`;
  const [rows, ps, team, ts] = await Promise.all([sold(s.orgId, from, to), plans(s), people(s.orgId), db.select().from(schema.salesTargets).where(and(eq(schema.salesTargets.orgId, s.orgId), sql`${schema.salesTargets.month} between ${from.slice(0, 7)} and ${to.slice(0, 7)}`))]);
  const planOf = (u: string | null) => ps.find((p) => p.active && p.userId === u) ?? ps.find((p) => p.active && !p.userId) ?? null;
  // Members only see their own line unless they run sales.
  const users = [...new Set([...rows.map((r) => r.user_id), ...ts.map((t) => t.userId)])].filter((u) => s.manage || u === s.userId);
  const lines = users.map((u) => {
    const mine = rows.filter((r) => r.user_id === u);
    const invoiced = mine.reduce((a, r) => a + r.invoiced, 0);
    const collected = mine.reduce((a, r) => a + r.collected, 0);
    const plan = u ? planOf(u) : null;
    const target = ts.filter((t) => t.userId === u).reduce((a, t) => a + t.amount, 0);
    return { userId: u, name: u ? team.find((p) => p.id === u)?.name ?? "Someone who left" : "No salesperson", invoiced, collected, plan: plan ? { id: plan.id, name: plan.name, ratePct: plan.ratePct, basis: plan.basis } : null, commission: plan ? commissionOn(plan.basis === "collected" ? collected : invoiced, plan.ratePct) : 0, target, achieved: target ? Math.round((invoiced / target) * 1000) / 10 : null };
  });
  return { from, to, lines: lines.sort((a, b) => b.invoiced - a.invoiced), total: lines.reduce((a, l) => a + l.commission, 0) };
}

export async function home(s: Scope) {
  const orders = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.orgId, s.orgId));
  const live = orders.filter((o) => ["confirmed", "partial", "delivered"].includes(o.status));
  const month = todayIst().slice(0, 7);
  const thisMonth = orders.filter((o) => String(o.date).startsWith(month) && !["draft", "cancelled"].includes(o.status));
  const byClient = new Map<string, { name: string; value: number }>();
  const byItem = new Map<string, { name: string; qty: number; value: number }>();
  for (const o of orders.filter((x) => !["draft", "cancelled"].includes(x.status) && String(x.date) >= `${Number(month.slice(0, 4)) - 1}${month.slice(4)}-01`)) {
    const c = byClient.get(o.clientId) ?? { name: o.clientName, value: 0 };
    c.value += o.subtotal;
    byClient.set(o.clientId, c);
    for (const l of o.lines) {
      const k = l.itemId ?? l.name;
      const it = byItem.get(k) ?? { name: l.name, qty: 0, value: 0 };
      it.qty += l.qty;
      it.value += Math.round(l.qty * l.rate * (1 - l.discountPct / 100));
      byItem.set(k, it);
    }
  }
  return {
    waiting: orders.filter((o) => o.status === "pending_approval").length,
    open: { count: live.length, value: live.reduce((a, o) => a + openValue(o.lines), 0) },
    toDeliver: live.filter((o) => o.lines.some((l) => l.itemId && l.delivered < l.qty - 0.0005)).map((o) => ({ id: o.id, number: o.number, client: o.clientName, expectedDate: o.expectedDate, late: !!o.expectedDate && String(o.expectedDate) < todayIst() })),
    toInvoice: [...live, ...orders.filter((o) => o.status === "closed")].filter((o) => toInvoice(o.lines, s.settings.invoiceOn).length).map((o) => ({ id: o.id, number: o.number, client: o.clientName })),
    month: { orders: thisMonth.length, value: thisMonth.reduce((a, o) => a + o.subtotal, 0) },
    topCustomers: [...byClient.values()].sort((a, b) => b.value - a.value).slice(0, 5),
    topItems: [...byItem.values()].sort((a, b) => b.value - a.value).slice(0, 5),
  };
}
