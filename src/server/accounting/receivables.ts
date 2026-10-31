// Money in from customers, the way it actually arrives: one transfer that
// covers several invoices, or more than is owed. A receipt is spread over the
// customer's open invoices (oldest due first, unless chosen) as payments in
// their invoicing books; what's left is kept as a customer advance and used
// against later invoices.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { PostLine } from "@/lib/accounting/model";
import { ApiError, notFound } from "../http/errors";
import { addPayment, deletePayment } from "../invoicing/service";
import type { Resolver } from "../org/resolve";
import { audit } from "../services/audit";
import { check, nextNumber, requireManage, requireWrite, type Scope } from "./access";
import { invoiceBooks } from "../org/org";
import { assertPeriodOpen } from "./periods";
import { sync } from "./sync";

const receiptSchema = z.object({
  ownerId: z.uuid(),
  clientId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().min(1).max(1e13),
  accountId: z.uuid(),
  reference: z.string().trim().max(120).default(""),
  /** Chosen invoices and amounts; empty spreads it oldest-due first. */
  allocations: z.array(z.object({ documentId: z.uuid(), amount: z.number().int().min(1) })).max(200).default([]),
});

type OpenInvoice = { id: string; number: string; issue_date: string; due_date: string | null; total: number; paid: number; owed: number };

/** A customer's unpaid invoices, oldest due first. */
export async function openInvoices(s: Scope, ownerId: string, clientId: string): Promise<OpenInvoice[]> {
  await requireBook(s, ownerId);
  const rows = (await db.execute(sql`
    select id, number, issue_date::text, due_date::text, total, amount_paid as paid, total - amount_paid as owed
    from invoice_documents
    where project_id = ${ownerId} and client_id = ${clientId} and type = 'invoice' and status in ('sent','viewed','partial') and currency = 'INR' and total > amount_paid
    order by coalesce(due_date, issue_date), issue_date, number`)) as unknown as { rows: OpenInvoice[] };
  return rows.rows.map((r) => ({ ...r, total: Number(r.total), paid: Number(r.paid), owed: Number(r.owed) }));
}

async function requireBook(s: Scope, ownerId: string) {
  if (!(await invoiceBooks(s.orgId)).some((b) => b.id === ownerId)) throw new ApiError("validation_failed", "Those invoicing books aren't in this workspace");
}

export async function receipts(s: Scope) {
  return db.select().from(schema.accReceipts).where(eq(schema.accReceipts.orgId, s.orgId)).orderBy(desc(schema.accReceipts.date), desc(schema.accReceipts.createdAt)).limit(300);
}

/** A customer's advances still unused. */
export async function advances(s: Scope, ownerId?: string, clientId?: string) {
  const rows = await db.select().from(schema.accReceipts).where(and(eq(schema.accReceipts.orgId, s.orgId), sql`${schema.accReceipts.advance} > ${schema.accReceipts.advanceUsed}`, ownerId ? eq(schema.accReceipts.ownerId, ownerId) : undefined, clientId ? eq(schema.accReceipts.clientId, clientId) : undefined)).orderBy(asc(schema.accReceipts.date));
  return rows.map((r) => ({ ...r, left: r.advance - r.advanceUsed }));
}

export async function receive(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(receiptSchema, raw);
  await requireBook(s, v.ownerId);
  const [client] = await db.select().from(schema.invoiceClients).where(and(eq(schema.invoiceClients.id, v.clientId), eq(schema.invoiceClients.projectId, v.ownerId)));
  if (!client) throw new ApiError("validation_failed", "Pick a client from those books", { clientId: ["Unknown client"] });
  const [acc] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.id, v.accountId)));
  if (!acc || !["bank", "cash"].includes(acc.subtype)) throw new ApiError("validation_failed", "Pick the bank or cash account it came into");
  const { resolver } = await import("../org/resolve");
  const companyId = (await resolver(s.orgId)).ofOwner(v.ownerId).companyId;
  await assertPeriodOpen(s.orgId, companyId, v.date, "This receipt");
  const open = await openInvoices(s, v.ownerId, v.clientId);
  // Spread it: as chosen, or oldest due first.
  let plan: { documentId: string; amount: number }[];
  if (v.allocations.length) {
    for (const a of v.allocations) {
      const inv = open.find((o) => o.id === a.documentId);
      if (!inv) throw new ApiError("validation_failed", "Allocate only to this client's unpaid invoices");
      if (a.amount > inv.owed) throw new ApiError("validation_failed", `Only ${(inv.owed / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })} is owed on ${inv.number}`);
    }
    plan = v.allocations;
  } else {
    let left = v.amount;
    plan = [];
    for (const o of open) {
      if (!left) break;
      const amount = Math.min(left, o.owed);
      plan.push({ documentId: o.id, amount });
      left -= amount;
    }
  }
  const allocated = plan.reduce((a, p) => a + p.amount, 0);
  if (allocated > v.amount) throw new ApiError("validation_failed", "You've allocated more than was received");
  const number = await nextNumber(s.orgId, "receipt", "RC-");
  const [r] = await db.insert(schema.accReceipts).values({ orgId: s.orgId, companyId, number, ownerId: v.ownerId, clientId: v.clientId, clientName: client.company || client.name, date: v.date, amount: v.amount, accountId: v.accountId, reference: v.reference, advance: v.amount - allocated, createdBy: s.userId }).returning();
  const made: { documentId: string; number: string; amount: number; paymentId: string }[] = [];
  for (const p of plan) {
    const pay = await addPayment(v.ownerId, p.documentId, s.userId, { amount: p.amount, method: acc.subtype === "cash" ? "cash" : "bank", paidOn: v.date, reference: `${number}${v.reference ? ` · ${v.reference}` : ""}`, note: "From a receipt in Accounts", accountId: v.accountId, receiptId: r.id });
    made.push({ ...p, number: open.find((o) => o.id === p.documentId)!.number, paymentId: pay.id });
  }
  const [out] = await db.update(schema.accReceipts).set({ allocations: made }).where(eq(schema.accReceipts.id, r.id)).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.receipt_recorded", targetType: "acc_receipt", targetId: r.id, metadata: { number, amount: v.amount, allocated, advance: v.amount - allocated } });
  await sync(s);
  return out;
}

const applySchema = z.object({ documentId: z.uuid(), amount: z.number().int().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Use an advance against one of the customer's invoices. */
export async function applyAdvance(s: Scope, receiptId: string, raw: unknown) {
  requireWrite(s);
  const v = check(applySchema, raw);
  const r = await getReceipt(s, receiptId);
  const left = r.advance - r.advanceUsed;
  if (v.amount > left) throw new ApiError("validation_failed", `Only ${(left / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })} of this advance is left`);
  const inv = (await openInvoices(s, r.ownerId, r.clientId!)).find((o) => o.id === v.documentId);
  if (!inv) throw new ApiError("validation_failed", "Use it against one of this client's unpaid invoices");
  if (v.amount > inv.owed) throw new ApiError("validation_failed", `Only ${(inv.owed / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" })} is owed on ${inv.number}`);
  await assertPeriodOpen(s.orgId, r.companyId, v.date, "This");
  const pay = await addPayment(r.ownerId, v.documentId, s.userId, { amount: v.amount, method: "advance", paidOn: v.date, reference: `${r.number} (advance)`, note: "Advance used", receiptId: r.id });
  await db.update(schema.accReceipts).set({ advanceUsed: r.advanceUsed + v.amount, allocations: [...r.allocations, { documentId: v.documentId, number: inv.number, amount: v.amount, paymentId: pay.id }] }).where(eq(schema.accReceipts.id, r.id));
  await sync(s);
  return getReceipt(s, receiptId);
}

async function getReceipt(s: Scope, id: string) {
  const [r] = await db.select().from(schema.accReceipts).where(and(eq(schema.accReceipts.id, id), eq(schema.accReceipts.orgId, s.orgId)));
  if (!r) throw notFound("Receipt");
  return r;
}

/** Undo a receipt: its payments come off the invoices and its advance goes. */
export async function deleteReceipt(s: Scope, id: string) {
  requireManage(s);
  const r = await getReceipt(s, id);
  await assertPeriodOpen(s.orgId, r.companyId, String(r.date), "This receipt");
  // A payment already removed in Invoicing is fine; anything else stops the undo.
  for (const a of r.allocations)
    await deletePayment(r.ownerId, a.documentId, a.paymentId, s.userId).catch((e) => {
      if (!(e instanceof ApiError && e.code === "not_found")) throw e;
    });
  await db.delete(schema.accReceipts).where(eq(schema.accReceipts.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.receipt_deleted", targetType: "acc_receipt", targetId: id, metadata: { number: r.number, amount: r.amount } });
  await sync(s);
}

/** For the sync: the part of a receipt kept as an advance goes to the bank and to customer advances. */
export async function receiptWants(orgId: string, r: Resolver) {
  const rows = await db.select().from(schema.accReceipts).where(and(eq(schema.accReceipts.orgId, orgId), sql`${schema.accReceipts.advance} > 0`));
  return rows.map((x) => ({ sourceType: "receipt_advance", sourceId: x.id, date: String(x.date), narration: `Advance from ${x.clientName} · ${x.number}`, sourceRef: x.number, party: x.clientName, lines: [{ accountId: x.accountId, debit: x.advance, credit: 0 }, { key: "customer_advances", debit: 0, credit: x.advance }] as PostLine[], companyId: x.companyId ?? r.defaultCompany }));
}

