// Price lists (the default list is the standard selling price; others are
// fixed prices or a discount off it, with quantity tiers and dates), customer
// terms (price list, credit limit, payment terms, salesperson, hold), and the
// credit position that orders are checked against.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { creditCheck, customerSchema, openValue, priceFor, priceItemSchema, priceListSchema } from "@/lib/sales/model";
import { z } from "zod";
import { ApiError, notFound } from "../http/errors";
import { invoiceBooks } from "../org/org";
import { audit } from "../services/audit";
import { assertBook, check, requireManage, requirePart, type Scope } from "./access";

export async function priceLists(orgId: string) {
  const lists = await db.select().from(schema.salesPriceLists).where(eq(schema.salesPriceLists.orgId, orgId)).orderBy(sql`${schema.salesPriceLists.isDefault} desc`, asc(schema.salesPriceLists.name));
  const counts = lists.length ? await db.select({ listId: schema.salesPriceItems.listId, n: sql<number>`count(*)::int` }).from(schema.salesPriceItems).where(inArray(schema.salesPriceItems.listId, lists.map((l) => l.id))).groupBy(schema.salesPriceItems.listId) : [];
  return lists.map((l) => ({ ...l, items: counts.find((c) => c.listId === l.id)?.n ?? 0 }));
}

async function getList(orgId: string, id: string) {
  const [l] = await db.select().from(schema.salesPriceLists).where(and(eq(schema.salesPriceLists.id, id), eq(schema.salesPriceLists.orgId, orgId)));
  if (!l) throw notFound("Price list");
  return l;
}

export async function priceListDetail(s: Scope, id: string) {
  const list = await getList(s.orgId, id);
  const items = await db
    .select({ p: schema.salesPriceItems, name: schema.invItems.name, sku: schema.invItems.sku, unit: schema.invItems.unit, avgCost: schema.invItems.avgCost })
    .from(schema.salesPriceItems)
    .innerJoin(schema.invItems, eq(schema.invItems.id, schema.salesPriceItems.itemId))
    .where(eq(schema.salesPriceItems.listId, id))
    .orderBy(asc(schema.invItems.name), asc(schema.salesPriceItems.minQty));
  return { list, items: items.map((x) => ({ ...x.p, name: x.name, sku: x.sku, unit: x.unit, avgCost: x.avgCost })) };
}

export async function savePriceList(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  requirePart(s, "pricing");
  const v = check(priceListSchema, raw);
  if (v.validFrom && v.validTo && v.validTo < v.validFrom) throw new ApiError("validation_failed", "It can't end before it starts", { validTo: ["Before the start"] });
  if (v.isDefault && v.kind !== "fixed") throw new ApiError("validation_failed", "The default list holds fixed prices");
  return db.transaction(async (tx) => {
    if (v.isDefault) await tx.update(schema.salesPriceLists).set({ isDefault: false }).where(eq(schema.salesPriceLists.orgId, s.orgId));
    if (id) {
      const cur = await getList(s.orgId, id);
      if (cur.isDefault && !v.isDefault) throw new ApiError("conflict", "Make another list the default instead");
      const [r] = await tx.update(schema.salesPriceLists).set(v).where(eq(schema.salesPriceLists.id, id)).returning();
      return r;
    }
    const [r] = await tx.insert(schema.salesPriceLists).values({ ...v, orgId: s.orgId }).returning();
    return r;
  });
}

export async function deletePriceList(s: Scope, id: string) {
  requireManage(s);
  const l = await getList(s.orgId, id);
  if (l.isDefault) throw new ApiError("conflict", "The default price list can't be deleted");
  await db.update(schema.salesCustomers).set({ priceListId: null }).where(eq(schema.salesCustomers.priceListId, id));
  await db.delete(schema.salesPriceLists).where(eq(schema.salesPriceLists.id, id));
}

/** Set (or with price 0 and remove: true, take out) an item's price on a list. */
export async function setPrice(s: Scope, listId: string, raw: unknown) {
  requireManage(s);
  const list = await getList(s.orgId, listId);
  if (list.kind !== "fixed") throw new ApiError("conflict", "This list is a discount off the default list — it has no prices of its own");
  const body = raw as { remove?: boolean };
  const v = check(priceItemSchema, raw);
  const [it] = await db.select({ id: schema.invItems.id }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), eq(schema.invItems.id, v.itemId)));
  if (!it) throw new ApiError("validation_failed", "Pick an item from Inventory");
  if (body.remove) {
    await db.delete(schema.salesPriceItems).where(and(eq(schema.salesPriceItems.listId, listId), eq(schema.salesPriceItems.itemId, v.itemId), eq(schema.salesPriceItems.minQty, v.minQty)));
    return null;
  }
  const [r] = await db.insert(schema.salesPriceItems).values({ ...v, listId }).onConflictDoUpdate({ target: [schema.salesPriceItems.listId, schema.salesPriceItems.itemId, schema.salesPriceItems.minQty], set: { price: v.price } }).returning();
  return r;
}

// ── Customers ───────────────────────────────────────────────────────────────

/** Every client in the workspace's invoicing books, with their sales terms and what they owe. */
export async function customers(s: Scope) {
  const books = await invoiceBooks(s.orgId);
  if (!books.length) return [];
  const clients = await db.select().from(schema.invoiceClients).where(and(inArray(schema.invoiceClients.projectId, books.map((b) => b.id)), isNull(schema.invoiceClients.archivedAt))).orderBy(asc(schema.invoiceClients.name));
  const terms = await db.select().from(schema.salesCustomers).where(eq(schema.salesCustomers.orgId, s.orgId));
  const pos = await positions(s.orgId, clients.map((c) => c.id));
  return clients.map((c) => {
    const t = terms.find((x) => x.clientId === c.id);
    const p = pos.get(c.id) ?? { owed: 0, onOrder: 0 };
    return { clientId: c.id, ownerId: c.projectId, book: books.find((b) => b.id === c.projectId)?.name ?? "", name: c.company || c.name, contact: c.name, gstin: c.gstin, state: (c.billing as { state?: string })?.state ?? "", terms: t ?? null, ...p, ...creditCheck(t?.creditLimit ?? 0, p.owed, p.onOrder, 0) };
  });
}

/** What each client owes on issued invoices, and the value still to invoice on their open orders. */
export async function positions(orgId: string, clientIds: string[], exceptOrder?: string) {
  const out = new Map<string, { owed: number; onOrder: number }>();
  if (!clientIds.length) return out;
  const ids = sql.join(clientIds.map((c) => sql`${c}`), sql`, `);
  const owed = (await db.execute(sql`
    select client_id, coalesce(sum(case when type = 'invoice' then total - amount_paid else -(total - amount_paid) end), 0)::bigint as owed
    from invoice_documents where client_id in (${ids}) and type in ('invoice','credit_note') and status not in ('draft','void') and currency = 'INR'
    group by client_id`)) as unknown as { rows: { client_id: string; owed: number }[] };
  for (const r of owed.rows) out.set(r.client_id, { owed: Math.max(0, Number(r.owed)), onOrder: 0 });
  const orders = await db.select({ id: schema.salesOrders.id, clientId: schema.salesOrders.clientId, lines: schema.salesOrders.lines }).from(schema.salesOrders).where(and(eq(schema.salesOrders.orgId, orgId), inArray(schema.salesOrders.clientId, clientIds), inArray(schema.salesOrders.status, ["pending_approval", "confirmed", "partial", "delivered"])));
  for (const o of orders) {
    if (o.id === exceptOrder) continue;
    const cur = out.get(o.clientId) ?? { owed: 0, onOrder: 0 };
    cur.onOrder += openValue(o.lines);
    out.set(o.clientId, cur);
  }
  return out;
}

export async function saveCustomer(s: Scope, raw: unknown) {
  requireManage(s);
  requirePart(s, "pricing");
  const v = check(customerSchema, raw);
  await assertBook(s.orgId, v.ownerId);
  const [c] = await db.select().from(schema.invoiceClients).where(and(eq(schema.invoiceClients.id, v.clientId), eq(schema.invoiceClients.projectId, v.ownerId)));
  if (!c) throw new ApiError("validation_failed", "Pick a client from those books");
  if (v.priceListId) await getList(s.orgId, v.priceListId);
  const [r] = await db.insert(schema.salesCustomers).values({ ...v, orgId: s.orgId }).onConflictDoUpdate({ target: schema.salesCustomers.clientId, set: { ...v, updatedAt: new Date() } }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "sales.customer_terms", targetType: "invoice_client", targetId: v.clientId, metadata: { creditLimit: v.creditLimit, onHold: v.onHold, priceListId: v.priceListId } });
  return r;
}

export async function termsFor(orgId: string, clientId: string) {
  const [t] = await db.select().from(schema.salesCustomers).where(and(eq(schema.salesCustomers.orgId, orgId), eq(schema.salesCustomers.clientId, clientId)));
  return t ?? null;
}

const quoteSchema = z.object({ clientId: z.uuid().nullable().default(null), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), items: z.array(z.object({ itemId: z.uuid(), qty: z.number().min(0).max(1e9) })).max(300) });

/** Prices for a customer on a day, item by item (null when no list prices it). */
export async function quote(s: Scope, raw: unknown) {
  const v = check(quoteSchema, raw);
  const t = v.clientId ? await termsFor(s.orgId, v.clientId) : null;
  const lists = await db.select().from(schema.salesPriceLists).where(eq(schema.salesPriceLists.orgId, s.orgId));
  const items = v.items.length && lists.length ? await db.select().from(schema.salesPriceItems).where(and(inArray(schema.salesPriceItems.listId, lists.map((l) => l.id)), inArray(schema.salesPriceItems.itemId, v.items.map((i) => i.itemId)))) : [];
  const L = lists.map((l) => ({ ...l, validFrom: l.validFrom ? String(l.validFrom) : null, validTo: l.validTo ? String(l.validTo) : null }));
  return {
    discountPct: t?.discountPct ?? 0,
    prices: v.items.map((i) => ({ itemId: i.itemId, qty: i.qty, ...(priceFor(i.itemId, i.qty, v.date, L, items.map((x) => ({ ...x, minQty: Number(x.minQty) })), t?.priceListId ?? null) ?? { price: null, listPrice: null, from: null }) })),
  };
}
