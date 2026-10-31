// Store sales (online orders and the till) shown next to a book's invoices,
// so Finance covers everything the business takes in. A project's books
// always include its own store; standalone books can link one store.
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import type { InvoicingScope } from "./books";

/** The store project whose sales belong in these books, if any. */
export async function linkedStore(scope: InvoicingScope): Promise<string | null> {
  let projectId: string | null = scope.kind === "project" ? scope.id : null;
  if (scope.kind === "book") {
    const [b] = await db.select({ linked: schema.financeBooks.linkedProjectId }).from(schema.financeBooks).where(eq(schema.financeBooks.id, scope.id));
    projectId = b?.linked ?? null;
  }
  if (!projectId) return null;
  const [s] = await db
    .select({ id: schema.stores.projectId })
    .from(schema.stores)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.stores.projectId))
    .where(and(eq(schema.stores.projectId, projectId), eq(schema.projects.orgId, scope.orgId), isNull(schema.projects.archivedAt)));
  return s?.id ?? null;
}

/** Stores in the workspace that standalone books can link to. */
export async function storeChoices(orgId: string) {
  return db
    .select({ id: schema.projects.id, name: schema.projects.name, currency: schema.stores.currency })
    .from(schema.stores)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.stores.projectId))
    .where(and(eq(schema.projects.orgId, orgId), isNull(schema.projects.archivedAt)));
}

export async function linkStore(scope: InvoicingScope, projectId: string | null) {
  if (scope.kind !== "book") throw new ApiError("conflict", "A project's own invoices already include its store.");
  if (projectId && !(await storeChoices(scope.orgId)).some((s) => s.id === projectId)) throw notFound("Store");
  await db.update(schema.financeBooks).set({ linkedProjectId: projectId }).where(eq(schema.financeBooks.id, scope.id));
  return { linkedProjectId: projectId };
}

/**
 * Paid store orders in the range (by payment date, India time), in the store's
 * base currency: gross, refunds, net, tax, split by online and counter, and by month.
 * Foreign-currency orders count at their recorded base amount.
 */
export async function storeSales(projectId: string, range: { from: string; to: string }) {
  const [store] = await db.select({ name: schema.projects.name, currency: schema.stores.currency }).from(schema.stores).innerJoin(schema.projects, eq(schema.projects.id, schema.stores.projectId)).where(eq(schema.stores.projectId, projectId));
  if (!store) return null;
  const o = schema.storeOrders;
  const base = sql`coalesce(${o.baseTotal}, ${o.total})`;
  // Refunds and tax are stored in the order's currency; scale them to base.
  const scale = sql`(${base}::numeric / nullif(${o.total}, 0))`;
  const day = sql`(${o.paidAt} at time zone 'Asia/Kolkata')::date`;
  const where = and(eq(o.projectId, projectId), isNull(o.cancelledAt), sql`${o.paidAt} is not null`, gte(day, sql`${range.from}::date`), lte(day, sql`${range.to}::date`));
  const sums = {
    gross: sql<number>`coalesce(sum(${base}),0)::bigint`,
    refunds: sql<number>`coalesce(sum(round(${o.refundedTotal} * coalesce(${scale}, 1))),0)::bigint`,
    tax: sql<number>`coalesce(sum(round(${o.taxTotal} * coalesce(${scale}, 1))),0)::bigint`,
    orders: sql<number>`count(*)::int`,
  };
  const [all] = await db.select(sums).from(o).where(where);
  const channels = await db.select({ channel: o.channel, ...sums }).from(o).where(where).groupBy(o.channel);
  const months = await db
    .select({ month: sql<string>`to_char(${o.paidAt} at time zone 'Asia/Kolkata', 'YYYY-MM')`, net: sql<number>`coalesce(sum(${base} - round(${o.refundedTotal} * coalesce(${scale}, 1))),0)::bigint` })
    .from(o)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const n = (v: unknown) => Number(v ?? 0);
  const ch = (name: string) => {
    const c = channels.find((x) => x.channel === name);
    return { orders: n(c?.orders), net: n(c?.gross) - n(c?.refunds) };
  };
  return {
    projectId,
    name: store.name,
    currency: store.currency,
    gross: n(all?.gross),
    refunds: n(all?.refunds),
    net: n(all?.gross) - n(all?.refunds),
    tax: n(all?.tax),
    orders: n(all?.orders),
    online: ch("online"),
    counter: ch("pos"),
    months: months.map((m) => ({ month: m.month, net: n(m.net) })),
  };
}
