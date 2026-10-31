// Invoices and Inventory: an invoicing item linked to an inventory item takes
// stock out when an invoice is issued, and a credit note puts it back. It
// works out what each invoice should have moved and posts the difference, so
// editing, voiding or crediting an invoice keeps stock right without double
// counting. Stock comes from (and returns to) the workspace's default location.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { q3 } from "@/lib/inventory/model";
import { isOn } from "@/lib/workspace/modules";
import { log } from "../log";
import { getSettings } from "./access";
import { move } from "./stock";

type Doc = { id: string; type: string; status: string; number: string; lines: { itemId?: string | null; quantity: number }[] };

/** Bring stock in line with invoices — one invoice, or all of a workspace's. */
export async function syncInvoiceStock(orgId: string, docId?: string) {
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "inventory")) return 0;
  const links = await db
    .select({ invoiceItemId: schema.invoiceItems.id, invItemId: schema.invoiceItems.invItemId })
    .from(schema.invoiceItems)
    .innerJoin(schema.invItems, and(eq(schema.invItems.id, schema.invoiceItems.invItemId), eq(schema.invItems.orgId, orgId)));
  const linked = new Map(links.map((l) => [l.invoiceItemId, l.invItemId!]));
  if (!linked.size) return 0;
  const docs = ((await db.execute(sql`
    select d.id, d.type, d.status, d.number, d.lines
    from invoice_documents d join invoice_owners o on o.id = d.project_id
    left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
    where coalesce(p.org_id, b.org_id) = ${orgId} and d.type in ('invoice','credit_note') ${docId ? sql`and d.id = ${docId}` : sql``}`)) as unknown as { rows: Doc[] }).rows;
  const touched = docs.filter((d) => d.lines.some((l) => l.itemId && linked.has(l.itemId)));
  const existing = touched.length
    ? await db
        .select({ refId: schema.invMoves.refId, itemId: schema.invMoves.itemId, qty: sql<number>`sum(${schema.invMoves.qty})::float` })
        .from(schema.invMoves)
        .where(and(eq(schema.invMoves.orgId, orgId), eq(schema.invMoves.refType, "invoice"), inArray(schema.invMoves.refId, touched.map((d) => d.id))))
        .groupBy(schema.invMoves.refId, schema.invMoves.itemId)
    : [];
  // Also undo moves for invoices whose lines no longer use a linked item.
  const stale = docId
    ? await db.select({ refId: schema.invMoves.refId, itemId: schema.invMoves.itemId, qty: sql<number>`sum(${schema.invMoves.qty})::float` }).from(schema.invMoves).where(and(eq(schema.invMoves.orgId, orgId), eq(schema.invMoves.refType, "invoice"), eq(schema.invMoves.refId, docId))).groupBy(schema.invMoves.refId, schema.invMoves.itemId)
    : [];
  const [wh] = await db.select().from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, orgId), eq(schema.invWarehouses.isDefault, true)));
  if (!wh) return 0;
  const settings = { ...(await getSettings(orgId)), blockNegative: false };
  const items = new Map((await db.select().from(schema.invItems).where(eq(schema.invItems.orgId, orgId))).map((i) => [i.id, i]));
  let posted = 0;
  const all = new Map<string, Doc>([...touched, ...docs.filter((d) => stale.some((x) => x.refId === d.id))].map((d) => [d.id, d]));
  for (const d of all.values()) {
    // What this document should have moved: out for an issued invoice, back in for a credit note.
    const want = new Map<string, number>();
    const live = !["draft", "void"].includes(d.status) && d.number !== "";
    if (live)
      for (const l of d.lines) {
        const inv = l.itemId ? linked.get(l.itemId) : undefined;
        if (inv) want.set(inv, q3((want.get(inv) ?? 0) + (d.type === "credit_note" ? 1 : -1) * Number(l.quantity)));
      }
    const have = new Map([...existing, ...stale].filter((e) => e.refId === d.id).map((e) => [e.itemId, Number(e.qty)]));
    for (const itemId of new Set([...want.keys(), ...have.keys()])) {
      const diff = q3((want.get(itemId) ?? 0) - (have.get(itemId) ?? 0));
      const item = items.get(itemId);
      if (!diff || !item) continue;
      try {
        await db.transaction((tx) => move(tx, { orgId, userId: "", settings }, { item, warehouse: wh, qty: diff, kind: diff < 0 ? "issue" : "return", refType: "invoice", refId: d.id, refNo: d.number || "Draft", note: d.type === "credit_note" ? "Credit note" : live ? "Invoiced" : "Invoice cancelled" }));
        posted++;
      } catch (e) {
        log.warn("invoice stock move failed", { orgId, doc: d.id, error: String(e) });
      }
    }
  }
  return posted;
}

/** For the invoicing screens: the workspace that owns a project's or book's invoicing. */
export async function syncInvoiceStockFor(ownerId: string, docId: string) {
  const rows = (await db.execute(sql`select coalesce(p.org_id, b.org_id) as org_id from invoice_owners o left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where o.id = ${ownerId}`)) as unknown as { rows: { org_id: string }[] };
  const orgId = rows.rows[0]?.org_id;
  if (orgId) await syncInvoiceStock(orgId, docId);
}
