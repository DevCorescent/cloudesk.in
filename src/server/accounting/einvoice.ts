// E-invoices and e-way bills for the workspace's invoices: which ones need
// them, the JSON to upload on the portals, and the IRN / EWB numbers recorded
// back. No call goes to the IRP or the e-way bill system.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { einvoiceJson, ewayJson, recordSchema, transportSchema, type EDoc, type Seller } from "@/lib/accounting/einvoice";
import type { Address, Party } from "@/lib/invoicing/model";
import { ApiError, notFound } from "../http/errors";
import { getSettings } from "../invoicing/service";
import { invoiceBooks, rateFor } from "../org/org";
import { resolver } from "../org/resolve";
import { audit } from "../services/audit";
import { check, requirePart, requireWrite, type Scope } from "./access";

type Row = typeof schema.invoiceDocuments.$inferSelect;

async function sellerFor(orgId: string, ownerId: string, cache: Map<string, Seller>): Promise<Seller> {
  const hit = cache.get(ownerId);
  if (hit) return hit;
  const biz = (await getSettings(ownerId)).business;
  // The company the books belong to fills in a missing GSTIN.
  const companyId = (await resolver(orgId)).ofOwner(ownerId).companyId;
  const [co] = await db.select().from(schema.orgCompanies).where(eq(schema.orgCompanies.id, companyId));
  const out: Seller = { gstin: biz.gstin || co?.gstin || "", legalName: biz.legalName || co?.legalName || biz.name || co?.name || "", tradeName: biz.name || co?.name || "", address: biz.address as Address, phone: biz.phone, email: biz.email };
  cache.set(ownerId, out);
  return out;
}

const asDoc = (d: Row): EDoc => ({ type: d.type as EDoc["type"], number: d.number, issueDate: String(d.issueDate), client: d.client as Party, currency: d.currency, lines: d.lines as EDoc["lines"], adjustments: d.adjustments as EDoc["adjustments"], taxMode: d.taxMode as EDoc["taxMode"], inclusive: d.inclusive, placeOfSupply: d.placeOfSupply });

async function rateOf(orgId: string, d: Row) {
  if (d.currency === "INR") return null;
  return d.fxRate ? Number(d.fxRate) : rateFor(orgId, d.currency, String(d.issueDate));
}

async function docsOf(s: Scope, where: ReturnType<typeof sql> | ReturnType<typeof inArray>) {
  const books = await invoiceBooks(s.orgId);
  if (!books.length) return [];
  return db
    .select()
    .from(schema.invoiceDocuments)
    .where(and(inArray(schema.invoiceDocuments.projectId, books.map((b) => b.id)), inArray(schema.invoiceDocuments.type, ["invoice", "credit_note"]), sql`${schema.invoiceDocuments.status} not in ('draft','void')`, sql`${schema.invoiceDocuments.number} <> ''`, where));
}

/** A month's invoices and credit notes to businesses or abroad, with what's recorded and what would stop an upload. */
export async function einvoices(s: Scope, month?: string) {
  requirePart(s, "gst");
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const docs = (await docsOf(s, sql`to_char(${schema.invoiceDocuments.issueDate}, 'YYYY-MM') = ${m}`)).filter((d) => {
    const c = d.client as Party;
    return !!c.gstin || (c.billing?.country ?? "IN") !== "IN";
  });
  const recs = docs.length ? await db.select().from(schema.accEinvoices).where(inArray(schema.accEinvoices.documentId, docs.map((d) => d.id))) : [];
  const cache = new Map<string, Seller>();
  const out = [];
  for (const d of docs.sort((a, b) => String(a.issueDate).localeCompare(String(b.issueDate)) || a.number.localeCompare(b.number))) {
    const rec = recs.find((r) => r.documentId === d.id) ?? null;
    const doc = asDoc(d);
    const seller = await sellerFor(s.orgId, d.projectId, cache);
    const rate = await rateOf(s.orgId, d);
    const e = einvoiceJson(doc, seller, rate);
    const goods = doc.lines.some((l) => l.hsn && !l.hsn.startsWith("99"));
    out.push({ id: d.id, ownerId: d.projectId, type: d.type, number: d.number, date: String(d.issueDate), client: (d.client as Party).company || (d.client as Party).name, gstin: (d.client as Party).gstin, currency: d.currency, total: d.total, totalInr: e.json.ValDtls.TotInvVal, goods, problems: e.problems, record: rec });
  }
  return { month: m, documents: out };
}

async function one(s: Scope, id: string) {
  const [d] = await docsOf(s, eq(schema.invoiceDocuments.id, id));
  if (!d) throw notFound("Invoice");
  return d;
}

/** JSON for the IRP's bulk upload: an array of e-invoices. Refused while any has problems. */
export async function einvoiceExport(s: Scope, ids: string[]) {
  requirePart(s, "gst");
  if (!ids.length) throw new ApiError("validation_failed", "Pick at least one invoice");
  const docs = await docsOf(s, inArray(schema.invoiceDocuments.id, ids.slice(0, 500)));
  if (docs.length !== new Set(ids).size) throw new ApiError("validation_failed", "Use invoices from this workspace");
  const cache = new Map<string, Seller>();
  const out = [];
  const issues: Record<string, string[]> = {};
  for (const d of docs) {
    const e = einvoiceJson(asDoc(d), await sellerFor(s.orgId, d.projectId, cache), await rateOf(s.orgId, d));
    if (e.problems.length) issues[d.number] = e.problems;
    out.push(e.json);
  }
  if (Object.keys(issues).length) throw new ApiError("validation_failed", `Fix ${Object.keys(issues).join(", ")} first`, issues);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.einvoice_exported", targetType: "invoice_document", targetId: docs[0].id, metadata: { count: docs.length, numbers: docs.map((d) => d.number).slice(0, 20) } });
  return out;
}

/** JSON for the e-way bill bulk generation, from the transport details saved on the invoice. */
export async function ewayExport(s: Scope, id: string) {
  requirePart(s, "gst");
  const d = await one(s, id);
  if (d.type !== "invoice") throw new ApiError("validation_failed", "E-way bills are made from invoices");
  const [rec] = await db.select().from(schema.accEinvoices).where(eq(schema.accEinvoices.documentId, id));
  const t = transportSchema.parse(rec?.transport ?? {});
  const e = ewayJson(asDoc(d), await sellerFor(s.orgId, d.projectId, new Map()), await rateOf(s.orgId, d), t);
  if (e.problems.length) throw new ApiError("validation_failed", e.problems[0], { problems: e.problems });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.eway_exported", targetType: "invoice_document", targetId: id, metadata: { number: d.number } });
  return e.json;
}

/** The IRN, acknowledgement and e-way bill numbers from the portals, and the transport details. */
export async function saveEinvoice(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  requirePart(s, "gst");
  const d = await one(s, id);
  const v = check(recordSchema, raw);
  const values = { ...v, irn: v.irn.toLowerCase(), orgId: s.orgId, updatedBy: s.userId, updatedAt: new Date() };
  const [r] = await db.insert(schema.accEinvoices).values({ documentId: id, ...values }).onConflictDoUpdate({ target: schema.accEinvoices.documentId, set: values }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.einvoice_recorded", targetType: "invoice_document", targetId: id, metadata: { number: d.number, irn: !!v.irn, ewb: v.ewbNo || null } });
  return r;
}
