// Sales orders: drafted, then confirmed. Confirming checks the customer's
// hold and credit limit and any discount above the workspace's limit; an
// order with a reason to stop goes for approval (through an approval rule for
// sales orders when there is one, otherwise to a sales manager), and is
// refused outright when the workspace blocks orders over the limit.
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { approvalReasons, creditCheck, orderSchema, orderTotals, statusFrom, type OrderLine, type OrderStatus } from "@/lib/sales/model";
import { cancelFor, gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { audit } from "../services/audit";
import { assertBook, check, nextNumber, requireManage, requireWrite, todayIst, type Scope } from "./access";
import { positions, termsFor } from "./pricing";
import { syncOrderReservations } from "../inventory/warehouse";
import { emit } from "../hub/core";
import { contains } from "../security/like";

type Order = typeof schema.salesOrders.$inferSelect;

export async function getOrder(orgId: string, id: string) {
  const [o] = await db.select().from(schema.salesOrders).where(and(eq(schema.salesOrders.id, id), eq(schema.salesOrders.orgId, orgId)));
  if (!o) throw notFound("Sales order");
  return o;
}

export async function listOrders(s: Scope, q: { status?: string; q?: string; clientId?: string } = {}) {
  const open = ["confirmed", "partial", "delivered"];
  const rows = await db
    .select()
    .from(schema.salesOrders)
    .where(and(eq(schema.salesOrders.orgId, s.orgId), q.status === "open" ? inArray(schema.salesOrders.status, open) : q.status ? eq(schema.salesOrders.status, q.status) : undefined, q.clientId ? eq(schema.salesOrders.clientId, q.clientId) : undefined, q.q ? or(ilike(schema.salesOrders.clientName, contains(q.q)), ilike(schema.salesOrders.number, contains(q.q)), ilike(schema.salesOrders.reference, contains(q.q))) : undefined))
    .orderBy(desc(schema.salesOrders.date), desc(schema.salesOrders.createdAt))
    .limit(500);
  return rows.map((o) => ({ ...o, toDeliver: o.lines.filter((l) => l.itemId).reduce((a, l) => a + Math.max(0, l.qty - l.delivered), 0), uninvoiced: o.lines.some((l) => l.invoiced < (l.itemId && s.settings.invoiceOn === "delivery" ? l.delivered - l.returned : l.qty) - 0.0005) }));
}

export async function orderDetail(s: Scope, id: string) {
  const o = await getOrder(s.orgId, id);
  const [deliveries, returns, invoices] = await Promise.all([
    db.select().from(schema.salesDeliveries).where(eq(schema.salesDeliveries.orderId, id)).orderBy(desc(schema.salesDeliveries.date)),
    db.select().from(schema.salesReturns).where(eq(schema.salesReturns.orderId, id)).orderBy(desc(schema.salesReturns.date)),
    db.execute(sql`select d.id, d.number, d.type, d.status, d.total, d.amount_paid, d.issue_date::text as issue_date, d.project_id as owner_id from invoice_documents d where d.id in (select invoice_id from sales_order_invoices where order_id = ${id}) or d.id in (select credit_note_id from sales_returns where order_id = ${id}) order by d.created_at`) as unknown as Promise<{ rows: { id: string; number: string; type: string; status: string; total: number; amount_paid: number; issue_date: string; owner_id: string }[] }>,
  ]);
  const t = await termsFor(s.orgId, o.clientId);
  const pos = (await positions(s.orgId, [o.clientId], o.id)).get(o.clientId) ?? { owed: 0, onOrder: 0 };
  // Who to write to about the order: the customer's email in the books.
  const [who] = await db.select({ name: schema.invoiceClients.name, email: schema.invoiceClients.email }).from(schema.invoiceClients).where(eq(schema.invoiceClients.id, o.clientId));
  return { order: o, deliveries, returns, invoices: invoices.rows, credit: creditCheck(t?.creditLimit ?? 0, pos.owed, pos.onOrder, o.total), terms: t, contact: { name: who?.name ?? "", email: who?.email ?? "" } };
}

async function clientOf(orgId: string, ownerId: string, clientId: string) {
  await assertBook(orgId, ownerId);
  const [c] = await db.select().from(schema.invoiceClients).where(and(eq(schema.invoiceClients.id, clientId), eq(schema.invoiceClients.projectId, ownerId)));
  if (!c) throw new ApiError("validation_failed", "Pick a customer from those books", { clientId: ["Unknown customer"] });
  return c;
}

/** Save a draft (or change a confirmed order that has nothing delivered or invoiced yet — it goes back to draft). */
export async function saveOrder(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(orderSchema, raw);
  const c = await clientOf(s.orgId, v.ownerId, v.clientId);
  const itemIds = [...new Set(v.lines.map((l) => l.itemId).filter((x): x is string => !!x))];
  if (itemIds.length && (await db.select({ id: schema.invItems.id }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), inArray(schema.invItems.id, itemIds)))).length !== itemIds.length) throw new ApiError("validation_failed", "Use items from this workspace's Inventory");
  if (v.warehouseId && !(await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.id, v.warehouseId)))).length) throw new ApiError("validation_failed", "Pick a location from this workspace");
  if (new Set(v.lines.map((l) => l.id)).size !== v.lines.length) throw new ApiError("validation_failed", "Each line needs its own id");
  const t = orderTotals(v.lines);
  const base = { ...v, clientName: c.company || c.name, placeOfSupply: v.placeOfSupply || ((c.billing as { state?: string })?.state ?? ""), warehouseId: v.warehouseId ?? s.settings.defaultWarehouseId, subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total, updatedAt: new Date() };
  if (id) {
    const cur = await getOrder(s.orgId, id);
    if (["cancelled", "closed"].includes(cur.status)) throw new ApiError("conflict", `This order is ${cur.status}`);
    if (cur.lines.some((l) => l.delivered || l.invoiced)) throw new ApiError("conflict", "Part of this order is delivered or invoiced — it can't be changed. Close it and start another for the rest.");
    // Changing a confirmed or waiting order sends it back to draft; any approval is withdrawn.
    if (cur.status === "pending_approval") await cancelFor(s.orgId, "sales.order", id, s.userId, "The order was changed");
    const [r] = await db.update(schema.salesOrders).set({ ...base, lines: v.lines.map((l) => ({ ...l, delivered: 0, invoiced: 0, returned: 0 })), status: "draft", holds: [] }).where(eq(schema.salesOrders.id, id)).returning();
    await syncOrderReservations(s.orgId, id);
    return r;
  }
  const number = await nextNumber(s.orgId, "order", s.settings.orderPrefix);
  const [r] = await db.insert(schema.salesOrders).values({ ...base, orgId: s.orgId, number, lines: v.lines.map((l) => ({ ...l, delivered: 0, invoiced: 0, returned: 0 })), createdBy: s.userId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.order_created", targetType: "sales_order", targetId: r.id, metadata: { number, total: r.total } });
  return r;
}

/** Confirm a draft: checks, then confirmed, waiting for approval, or refused. */
export async function confirmOrder(s: Scope, id: string) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (o.status !== "draft") throw new ApiError("conflict", o.status === "pending_approval" ? "This order is already waiting for approval" : "Only a draft can be confirmed");
  const t = await termsFor(s.orgId, o.clientId);
  if (t?.onHold) throw new ApiError("conflict", `${o.clientName} is on hold — a sales manager can take the hold off in Customers`);
  const pos = (await positions(s.orgId, [o.clientId], o.id)).get(o.clientId) ?? { owed: 0, onOrder: 0 };
  const credit = creditCheck(t?.creditLimit ?? 0, pos.owed, pos.onOrder, o.total);
  if (credit.over && s.settings.creditCheck === "block") throw new ApiError("conflict", `This takes ${o.clientName} to ₹${Math.round(credit.exposure / 100).toLocaleString("en-IN")} against a limit of ₹${Math.round(credit.limit / 100).toLocaleString("en-IN")}`, { credit });
  const holds = approvalReasons(o.lines, s.settings.maxDiscountPct, credit, s.settings.creditCheck);
  let status: OrderStatus = "confirmed";
  if (holds.length) {
    const g = await gate(s.orgId, { kind: "sales.order", refId: o.id, label: `${o.number} · ${o.clientName} — ${holds.join("; ")}`, amount: o.total, requesterId: s.userId, link: `/sales/orders/${o.id}` });
    // Without a rule for sales orders, a sales manager's own order goes through; anyone else's waits for one.
    status = g.status === "pending" || (g.status === "none" && !s.manage) ? "pending_approval" : "confirmed";
    if (status === "pending_approval" && g.status === "none") await tellManagers(s, o, holds);
  }
  const [r] = await db.update(schema.salesOrders).set({ status, holds, updatedAt: new Date() }).where(eq(schema.salesOrders.id, id)).returning();
  await syncOrderReservations(s.orgId, id);
  if (status === "confirmed") await emit(s.orgId, "sales.order.confirmed", { id, number: o.number, clientId: o.clientId, clientName: o.clientName, totalPaise: o.total });
  await audit({ orgId: s.orgId, actorId: s.userId, action: status === "confirmed" ? "sales.order_confirmed" : "sales.order_held", targetType: "sales_order", targetId: id, metadata: { number: o.number, holds, credit: credit.limit ? credit : null } });
  return { order: r, holds, credit: credit.limit ? credit : null, warning: credit.over && s.settings.creditCheck === "warn" ? "Over the customer's credit limit" : null };
}

async function tellManagers(s: Scope, o: Order, holds: string[]) {
  const mgrs = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.role, ["owner", "admin"])));
  await notify(s.orgId, mgrs.map((m) => m.userId).filter((u) => u !== s.userId), { kind: "approval.requested", title: `${o.number} needs your OK`, body: `${o.clientName}: ${holds.join("; ")}`, link: `/sales/orders/${o.id}`, values: { document: o.number, amount: `₹${Math.round(o.total / 100).toLocaleString("en-IN")}`, link: `/sales/orders/${o.id}` } });
}

/** A sales manager approves a held order (when no approval rule handles sales orders). */
export async function approveOrder(s: Scope, id: string, approve: boolean) {
  requireManage(s);
  const o = await getOrder(s.orgId, id);
  if (o.status !== "pending_approval") throw new ApiError("conflict", "This order isn't waiting for approval");
  const [pending] = await db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, s.orgId), eq(schema.approvalRequests.kind, "sales.order"), eq(schema.approvalRequests.refId, id), eq(schema.approvalRequests.status, "pending")));
  if (pending) throw new ApiError("conflict", "This order follows an approval rule — decide it in My work");
  await (approve ? orderApproved : orderRejected)(s.orgId, id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: approve ? "sales.order_approved" : "sales.order_rejected", targetType: "sales_order", targetId: id, metadata: { number: o.number, holds: o.holds } });
  if (o.createdBy && o.createdBy !== s.userId) await notify(s.orgId, [o.createdBy], { kind: approve ? "approval.approved" : "approval.rejected", title: `${o.number} ${approve ? "approved" : "sent back"}`, body: o.clientName, link: `/sales/orders/${o.id}`, values: { document: o.number, link: `/sales/orders/${o.id}` } });
  return getOrder(s.orgId, id);
}

export async function orderApproved(orgId: string, id: string) {
  await db.update(schema.salesOrders).set({ status: "confirmed", updatedAt: new Date() }).where(and(eq(schema.salesOrders.id, id), eq(schema.salesOrders.orgId, orgId), eq(schema.salesOrders.status, "pending_approval")));
  await syncOrderReservations(orgId, id);
}
export async function orderRejected(orgId: string, id: string) {
  await db.update(schema.salesOrders).set({ status: "draft", updatedAt: new Date() }).where(and(eq(schema.salesOrders.id, id), eq(schema.salesOrders.orgId, orgId), eq(schema.salesOrders.status, "pending_approval")));
}

export async function cancelOrder(s: Scope, id: string) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (o.lines.some((l) => l.delivered > l.returned + 0.0005 || l.invoiced > 0)) throw new ApiError("conflict", "Goods have gone out or been invoiced — return them or close the order instead");
  if (o.status === "pending_approval") await cancelFor(s.orgId, "sales.order", id, s.userId, "The order was cancelled");
  await db.update(schema.salesOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.salesOrders.id, id));
  await syncOrderReservations(s.orgId, id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.order_cancelled", targetType: "sales_order", targetId: id, metadata: { number: o.number } });
}

/** Close an order short: what isn't delivered won't be. */
export async function closeOrder(s: Scope, id: string) {
  requireWrite(s);
  const o = await getOrder(s.orgId, id);
  if (!["confirmed", "partial", "delivered"].includes(o.status)) throw new ApiError("conflict", "Only a confirmed order can be closed");
  await db.update(schema.salesOrders).set({ status: "closed", updatedAt: new Date() }).where(eq(schema.salesOrders.id, id));
  await syncOrderReservations(s.orgId, id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.order_closed", targetType: "sales_order", targetId: id, metadata: { number: o.number } });
}

export async function deleteOrder(s: Scope, id: string) {
  requireManage(s);
  const o = await getOrder(s.orgId, id);
  if (!["draft", "cancelled"].includes(o.status)) throw new ApiError("conflict", "Only a draft or cancelled order can be deleted");
  await db.delete(schema.salesOrders).where(eq(schema.salesOrders.id, id));
}

/** Recompute an order's status after deliveries, returns or invoices. */
export async function refreshStatus(id: string, lines: OrderLine[]) {
  const [o] = await db.select({ status: schema.salesOrders.status }).from(schema.salesOrders).where(eq(schema.salesOrders.id, id));
  if (!o) return;
  await db.update(schema.salesOrders).set({ lines: lines as Order["lines"], status: statusFrom(lines, o.status as OrderStatus), updatedAt: new Date() }).where(eq(schema.salesOrders.id, id));
}

/** A won CRM deal as the start of an order: its customer (matched by name in the books) and value. */
export async function fromDeal(s: Scope, dealId: string) {
  const rows = (await db.execute(sql`
    select d.id, d.title, d.value as amount, coalesce(c.name, '') as company, coalesce(p.name, '') as contact
    from crm_deals d left join crm_companies c on c.id = d.company_id left join crm_contacts p on p.id = d.contact_id
    where d.id = ${dealId} and d.org_id = ${s.orgId}`)) as unknown as { rows: { id: string; title: string; amount: number; company: string; contact: string }[] };
  const d = rows.rows[0];
  if (!d) throw notFound("Deal");
  const name = d.company || d.contact;
  const match = name ? (await db.execute(sql`select c.id, c.project_id as owner_id from invoice_clients c where c.project_id in (select o.id from invoice_owners o left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where coalesce(p.org_id, b.org_id) = ${s.orgId}) and (lower(c.company) = lower(${name}) or lower(c.name) = lower(${name})) and c.archived_at is null limit 1`)) as unknown as { rows: { id: string; owner_id: string }[] } : { rows: [] };
  return { dealId: d.id, title: d.title, amount: Number(d.amount ?? 0), customer: name, clientId: match.rows[0]?.id ?? null, ownerId: match.rows[0]?.owner_id ?? null, date: todayIst() };
}
