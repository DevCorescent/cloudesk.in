// Importing prices into a price list and customer terms from spreadsheets
// (a distributor's rate list, another system's customer master). Items are
// matched by SKU then name, customers by name in the invoicing books, price
// lists by name and salespeople by email or name. Rows go through the same
// saves as the screens.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { target } from "@/lib/import/targets";
import { ApiError } from "../http/errors";
import { runImport, str } from "../import/run";
import { invoiceBooks } from "../org/org";
import { requireManage, type Scope } from "./access";
import { saveCustomer, setPrice, termsFor } from "./pricing";

export async function importPrices(s: Scope, listId: string, raw: unknown) {
  requireManage(s);
  const [list] = await db.select().from(schema.salesPriceLists).where(and(eq(schema.salesPriceLists.id, listId), eq(schema.salesPriceLists.orgId, s.orgId)));
  if (!list) throw new ApiError("not_found", "Price list not found");
  return runImport(target("sales.prices"), raw, async (v, mode) => {
    const ref = str(v.item).trim().toLowerCase();
    const [it] = await db.select({ id: schema.invItems.id }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), sql`(lower(${schema.invItems.sku}) = ${ref} or lower(${schema.invItems.name}) = ${ref})`)).orderBy(sql`lower(${schema.invItems.sku}) = ${ref} desc`).limit(1);
    if (!it) throw new ApiError("validation_failed", `“${str(v.item)}” isn't an item in Inventory — import items first`);
    const minQty = Number(v.minQty ?? 0) || 0;
    const [found] = await db.select({ id: schema.salesPriceItems.id }).from(schema.salesPriceItems).where(and(eq(schema.salesPriceItems.listId, listId), eq(schema.salesPriceItems.itemId, it.id), eq(schema.salesPriceItems.minQty, minQty)));
    if (found && mode === "skip") return "skipped";
    await setPrice(s, listId, { itemId: it.id, price: Number(v.price), minQty });
    return found ? "updated" : "created";
  });
}

const extra = z.object({ ownerId: z.uuid().optional() });

export async function importCustomers(s: Scope, raw: unknown) {
  requireManage(s);
  const opts = extra.parse(raw);
  const books = (await invoiceBooks(s.orgId)).map((b) => b.id);
  const where = opts.ownerId && books.includes(opts.ownerId) ? [opts.ownerId] : books;
  if (!where.length) throw new ApiError("conflict", "Set up invoicing books first — customers live there");
  const lists = await db.select().from(schema.salesPriceLists).where(eq(schema.salesPriceLists.orgId, s.orgId));
  const team = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, s.orgId));
  return runImport(target("sales.customers"), raw, async (v, mode) => {
    const name = str(v.customer).trim().toLowerCase();
    const [c] = await db.select({ id: schema.invoiceClients.id, ownerId: schema.invoiceClients.projectId }).from(schema.invoiceClients).where(and(inArray(schema.invoiceClients.projectId, where), sql`${schema.invoiceClients.archivedAt} is null`, sql`(lower(${schema.invoiceClients.company}) = ${name} or lower(${schema.invoiceClients.name}) = ${name})`)).limit(1);
    if (!c) throw new ApiError("validation_failed", `“${str(v.customer)}” isn't a client in your invoicing books — import clients first`);
    const cur = await termsFor(s.orgId, c.id);
    if (cur && mode === "skip") return "skipped";
    const pl = str(v.priceList).trim().toLowerCase();
    const list = pl ? lists.find((l) => l.name.toLowerCase() === pl) : null;
    if (pl && !list) throw new ApiError("validation_failed", `There's no price list called “${str(v.priceList)}”`);
    const sp = str(v.salesperson).trim().toLowerCase();
    const person = sp ? team.find((p) => p.email.toLowerCase() === sp || p.name.toLowerCase() === sp) : null;
    if (sp && !person) throw new ApiError("validation_failed", `“${str(v.salesperson)}” isn't on your team`);
    await saveCustomer(s, {
      ownerId: c.ownerId,
      clientId: c.id,
      priceListId: list?.id ?? cur?.priceListId ?? null,
      creditLimit: v.creditLimit === null || v.creditLimit === undefined ? cur?.creditLimit ?? 0 : Number(v.creditLimit),
      paymentTermsDays: v.paymentTermsDays === null || v.paymentTermsDays === undefined ? cur?.paymentTermsDays ?? 30 : Number(v.paymentTermsDays),
      discountPct: v.discountPct === null || v.discountPct === undefined ? cur?.discountPct ?? 0 : Number(v.discountPct),
      salespersonId: person?.id ?? cur?.salespersonId ?? null,
      onHold: v.onHold === null || v.onHold === undefined ? cur?.onHold ?? false : !!v.onHold,
      notes: cur?.notes ?? "",
    });
    return cur ? "updated" : "created";
  });
}
