// Invoicing: settings and numbering, clients and saved items, documents
// (invoices, quotations, proforma invoices, credit notes), payments, sharing,
// quote acceptance, recurring invoices and reminders. Totals are always
// recomputed here from the lines — never trusted from the browser.
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, addPeriod, DOC_LABEL, displayStatus, settingsSchema, templateConfigSchema, type DocInput, type DocStatus, type DocType, type InvoiceSettings, type Party, type Recurring, type Series, type TemplateConfig } from "@/lib/invoicing/model";
import { renderDocument, titleFor, type RenderDoc } from "@/lib/invoicing/render";
import { renderPdf } from "./pdf";
import { prebuilt, PREBUILT_TEMPLATES } from "@/lib/invoicing/templates";
import { computeDocTotals, isIntraState } from "@/lib/invoicing/totals";
import { financialYear } from "@/lib/store/gst";
import { formatMoney } from "@/lib/store/money";
import { ApiError, notFound } from "../http/errors";
import { captureInvoiceClient, safely } from "../crm/capture";
import { log } from "../log";
import { randomToken } from "../security/tokens";
import { appUrl, mailConfigured, sendMail } from "../services/mail";
import { contains } from "../security/like";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DocRow = typeof schema.invoiceDocuments.$inferSelect;

/** The calendar day (YYYY-MM-DD) at a UTC offset, for now or for a given moment. */
export const today = (tzOffsetMin = 330, at: Date | number = Date.now()) => new Date(+at + tzOffsetMin * 60_000).toISOString().slice(0, 10);
const isoOf = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

// ── Settings ────────────────────────────────────────────────────────────────

/** Defaults come from what the project already knows (store details, UPI). */
async function defaultSettings(projectId: string): Promise<InvoiceSettings> {
  // The owner is a project or a standalone book; either gives the business its starting name.
  const [p] = (await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, projectId))).concat(await db.select({ name: schema.financeBooks.name }).from(schema.financeBooks).where(eq(schema.financeBooks.id, projectId)));
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const [manual] = await db.select({ settings: schema.storePaymentProviders.settings }).from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.provider, "manual")));
  const s = settingsSchema.parse({});
  s.business.name = store?.name || p?.name || "";
  if (store) {
    const a = (store.address ?? null) as { line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string } | null;
    s.business.email = store.email;
    s.business.phone = store.phone;
    s.business.gstin = store.taxId ?? "";
    s.business.address = { line1: a?.line1 ?? "", line2: a?.line2 ?? "", city: a?.city ?? "", state: a?.region || store.region || "", postalCode: a?.postalCode ?? "", country: a?.country || store.country || "IN" };
    s.currency = store.currency;
    s.taxMode = store.country === "IN" ? "gst" : "simple";
    s.defaultTaxBps = store.defaultTaxBps;
  }
  s.payment.upiId = ((manual?.settings ?? {}) as { upiId?: string }).upiId ?? "";
  s.terms = "Payment is due by the due date shown. Please quote the invoice number with your payment.";
  return s;
}

export async function getSettings(projectId: string): Promise<InvoiceSettings & { saved: boolean }> {
  const [row] = await db.select().from(schema.invoiceSettings).where(eq(schema.invoiceSettings.projectId, projectId));
  if (!row) return { ...(await defaultSettings(projectId)), saved: false };
  return { ...settingsSchema.parse(row.data), saved: true };
}

export async function saveSettings(projectId: string, input: InvoiceSettings) {
  const data = settingsSchema.parse(input);
  if (data.defaultTemplateId) await requireTemplate(projectId, data.defaultTemplateId);
  // Numbering counters are only moved forward deliberately; keep the year each series last used.
  const [cur] = await db.select().from(schema.invoiceSettings).where(eq(schema.invoiceSettings.projectId, projectId));
  const prev = cur ? (cur.data as { numbering?: Record<string, { fy?: string }> }).numbering : undefined;
  const numbering = Object.fromEntries(Object.entries(data.numbering).map(([k, v]) => [k, { ...v, fy: prev?.[k]?.fy }]));
  const value = { ...data, numbering };
  await db.insert(schema.invoiceSettings).values({ projectId, data: value }).onConflictDoUpdate({ target: schema.invoiceSettings.projectId, set: { data: value, updatedAt: new Date() } });
  return getSettings(projectId);
}

async function lockedSettings(tx: Tx, projectId: string) {
  await tx.insert(schema.invoiceSettings).values({ projectId, data: await defaultSettings(projectId) }).onConflictDoNothing();
  const [row] = await tx.select().from(schema.invoiceSettings).where(eq(schema.invoiceSettings.projectId, projectId)).for("update");
  return row.data as InvoiceSettings & { numbering: Record<DocType, Series & { fy?: string }> };
}

export function formatNumber(series: Series, seq: number, fy: string) {
  const n = String(seq).padStart(series.pad, "0");
  if (series.yearly) return [series.prefix, fy, n].filter(Boolean).join("/");
  return series.prefix ? `${series.prefix}-${n}` : n;
}

/** Next number in the series (restarting each financial year if set). Runs inside the caller's transaction. */
async function nextNumber(tx: Tx, projectId: string, type: DocType, issueDate: string) {
  const data = await lockedSettings(tx, projectId);
  const s = settingsSchema.shape.numbering.parse(data.numbering)[type];
  const prev = (data.numbering?.[type] ?? {}) as { fy?: string };
  const fy = financialYear(new Date(`${issueDate}T12:00:00Z`));
  let seq = s.yearly && prev.fy && prev.fy !== fy ? 1 : s.next;
  // Never collide with a number typed by hand earlier.
  for (let guard = 0; guard < 1000; guard++) {
    const candidate = formatNumber(s, seq, fy);
    const [clash] = await tx.select({ id: schema.invoiceDocuments.id }).from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.projectId, projectId), eq(schema.invoiceDocuments.type, type), eq(schema.invoiceDocuments.number, candidate)));
    if (!clash) {
      const numbering = { ...data.numbering, [type]: { ...s, next: seq + 1, fy } };
      await tx.update(schema.invoiceSettings).set({ data: { ...data, numbering }, updatedAt: new Date() }).where(eq(schema.invoiceSettings.projectId, projectId));
      return candidate;
    }
    seq++;
  }
  throw new ApiError("conflict", "Couldn't find a free number in this series — check Settings → Numbering");
}

// ── Templates ───────────────────────────────────────────────────────────────

const templateCols = { id: schema.invoiceTemplates.id, name: schema.invoiceTemplates.name, config: schema.invoiceTemplates.config, source: schema.invoiceTemplates.source, basedOn: schema.invoiceTemplates.basedOn, referenceMime: schema.invoiceTemplates.referenceMime, referenceName: schema.invoiceTemplates.referenceName, extracted: schema.invoiceTemplates.extracted, updatedAt: schema.invoiceTemplates.updatedAt };

export async function listTemplates(projectId: string) {
  const rows = await db.select(templateCols).from(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.projectId, projectId)).orderBy(asc(schema.invoiceTemplates.createdAt));
  return rows.map((r) => ({ ...r, config: templateConfigSchema.parse(r.config), hasReference: !!r.referenceMime }));
}

async function requireTemplate(projectId: string, id: string) {
  const [t] = await db.select(templateCols).from(schema.invoiceTemplates).where(and(eq(schema.invoiceTemplates.id, id), eq(schema.invoiceTemplates.projectId, projectId)));
  if (!t) throw notFound("Template");
  return t;
}

/** Makes sure there is at least one template to print with (a copy of Classic). */
export async function ensureTemplates(projectId: string, userId: string | null) {
  const [one] = await db.select({ id: schema.invoiceTemplates.id }).from(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.projectId, projectId)).limit(1);
  if (one) return;
  await saveTemplate(projectId, userId, { name: "Classic", config: PREBUILT_TEMPLATES[0].config, source: "prebuilt", basedOn: "classic" });
}

export async function saveTemplate(projectId: string, userId: string | null, input: { id?: string; name: string; config: unknown; source?: string; basedOn?: string; reference?: { mime: string; name: string; data: Buffer } | null; extracted?: unknown }) {
  const config = templateConfigSchema.parse(input.config);
  const values = {
    name: input.name.trim().slice(0, 80) || "Untitled",
    config,
    ...(input.source ? { source: input.source } : {}),
    ...(input.basedOn !== undefined ? { basedOn: input.basedOn } : {}),
    ...(input.reference ? { referenceMime: input.reference.mime, referenceName: input.reference.name.slice(0, 200), referenceData: input.reference.data } : {}),
    ...(input.extracted !== undefined ? { extracted: input.extracted } : {}),
    updatedAt: new Date(),
  };
  if (input.id) {
    await requireTemplate(projectId, input.id);
    await db.update(schema.invoiceTemplates).set(values).where(eq(schema.invoiceTemplates.id, input.id));
    return requireTemplate(projectId, input.id);
  }
  const count = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.projectId, projectId)))[0].n;
  if (count >= 30) throw new ApiError("conflict", "A project can keep up to 30 templates");
  const [row] = await db.insert(schema.invoiceTemplates).values({ projectId, createdBy: userId, ...values, name: values.name }).returning({ id: schema.invoiceTemplates.id });
  return requireTemplate(projectId, row.id);
}

export async function deleteTemplate(projectId: string, id: string) {
  await requireTemplate(projectId, id);
  const settings = await getSettings(projectId);
  if (settings.defaultTemplateId === id) throw new ApiError("conflict", "This is your default template — choose another default first");
  await db.delete(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.id, id));
}

export async function templateReference(projectId: string, id: string) {
  const [t] = await db.select({ mime: schema.invoiceTemplates.referenceMime, data: schema.invoiceTemplates.referenceData, name: schema.invoiceTemplates.referenceName }).from(schema.invoiceTemplates).where(and(eq(schema.invoiceTemplates.id, id), eq(schema.invoiceTemplates.projectId, projectId)));
  if (!t?.mime || !t.data) throw notFound("Uploaded file");
  return t as { mime: string; data: Buffer; name: string | null };
}

async function templateFor(projectId: string, templateId: string | null, settings: InvoiceSettings): Promise<TemplateConfig> {
  for (const id of [templateId, settings.defaultTemplateId]) {
    if (!id) continue;
    const [t] = await db.select({ config: schema.invoiceTemplates.config }).from(schema.invoiceTemplates).where(and(eq(schema.invoiceTemplates.id, id), eq(schema.invoiceTemplates.projectId, projectId)));
    if (t) return templateConfigSchema.parse(t.config);
  }
  const [first] = await db.select({ config: schema.invoiceTemplates.config }).from(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.projectId, projectId)).orderBy(asc(schema.invoiceTemplates.createdAt)).limit(1);
  return templateConfigSchema.parse(first?.config ?? prebuilt("classic")!.config);
}

// ── Clients and items ───────────────────────────────────────────────────────

export async function listClients(projectId: string, q = "") {
  const cond = [eq(schema.invoiceClients.projectId, projectId), isNull(schema.invoiceClients.archivedAt)];
  if (q.trim()) cond.push(or(ilike(schema.invoiceClients.name, contains(q.trim())), ilike(schema.invoiceClients.company, contains(q.trim())), ilike(schema.invoiceClients.email, contains(q.trim())))!);
  const clients = await db.select().from(schema.invoiceClients).where(and(...cond)).orderBy(asc(schema.invoiceClients.name)).limit(500);
  // Open balance per client.
  const open = await db
    .select({ clientId: schema.invoiceDocuments.clientId, invoiced: sql<number>`coalesce(sum(${schema.invoiceDocuments.total}),0)::bigint`, balance: sql<number>`coalesce(sum(${schema.invoiceDocuments.total} - ${schema.invoiceDocuments.amountPaid}),0)::bigint`, count: sql<number>`count(*)::int` })
    .from(schema.invoiceDocuments)
    .where(and(eq(schema.invoiceDocuments.projectId, projectId), eq(schema.invoiceDocuments.type, "invoice"), inArray(schema.invoiceDocuments.status, ["sent", "viewed", "partial", "paid"])))
    .groupBy(schema.invoiceDocuments.clientId);
  const byClient = new Map(open.map((o) => [o.clientId, o]));
  return clients.map((c) => ({ ...c, invoiced: Number(byClient.get(c.id)?.invoiced ?? 0), balance: Number(byClient.get(c.id)?.balance ?? 0), invoices: byClient.get(c.id)?.count ?? 0 }));
}

export async function saveClient(projectId: string, id: string | null, c: Party & { notes: string }) {
  const values = { name: c.name, company: c.company, email: c.email, phone: c.phone, gstin: c.gstin.toUpperCase(), billing: c.billing, shipping: c.shipping, notes: c.notes };
  if (id) {
    const r = await db.update(schema.invoiceClients).set(values).where(and(eq(schema.invoiceClients.id, id), eq(schema.invoiceClients.projectId, projectId))).returning();
    if (!r.length) throw notFound("Client");
    return r[0];
  }
  const [row] = await db.insert(schema.invoiceClients).values({ projectId, ...values }).returning();
  await safely(captureInvoiceClient(projectId, row));
  return row;
}

export async function archiveClient(projectId: string, id: string) {
  const r = await db.update(schema.invoiceClients).set({ archivedAt: new Date() }).where(and(eq(schema.invoiceClients.id, id), eq(schema.invoiceClients.projectId, projectId))).returning({ id: schema.invoiceClients.id });
  if (!r.length) throw notFound("Client");
}

export async function listItems(projectId: string) {
  return db.select().from(schema.invoiceItems).where(and(eq(schema.invoiceItems.projectId, projectId), isNull(schema.invoiceItems.archivedAt))).orderBy(asc(schema.invoiceItems.name)).limit(1000);
}

export async function saveItem(projectId: string, id: string | null, v: { name: string; description: string; hsn: string; unit: string; rate: number; taxBps: number }) {
  if (id) {
    const r = await db.update(schema.invoiceItems).set(v).where(and(eq(schema.invoiceItems.id, id), eq(schema.invoiceItems.projectId, projectId))).returning();
    if (!r.length) throw notFound("Item");
    return r[0];
  }
  const [row] = await db.insert(schema.invoiceItems).values({ projectId, ...v }).returning();
  return row;
}

export async function archiveItem(projectId: string, id: string) {
  const r = await db.update(schema.invoiceItems).set({ archivedAt: new Date() }).where(and(eq(schema.invoiceItems.id, id), eq(schema.invoiceItems.projectId, projectId))).returning({ id: schema.invoiceItems.id });
  if (!r.length) throw notFound("Item");
}

// ── Documents ───────────────────────────────────────────────────────────────

async function event(documentId: string, kind: string, message: string, actorId: string | null = null, exec: typeof db | Tx = db) {
  await exec.insert(schema.invoiceEvents).values({ documentId, kind, message, actorId });
}

function totalsFor(input: Pick<DocInput, "lines" | "adjustments" | "taxMode" | "inclusive" | "placeOfSupply" | "currency" | "client">, settings: InvoiceSettings) {
  return computeDocTotals({ lines: input.lines, adjustments: input.adjustments, taxMode: input.taxMode, inclusive: input.inclusive, intraState: isIntraState(settings.business.address.state, input.placeOfSupply || input.client.billing.state), currency: input.currency, taxLabel: settings.taxLabel });
}

function view(d: DocRow, t = today()) {
  const status = displayStatus({ type: d.type as DocType, status: d.status as DocStatus, total: d.total, amountPaid: d.amountPaid, dueDate: d.dueDate }, t);
  return { ...d, displayStatus: status, balance: d.type === "invoice" || d.type === "proforma" ? Math.max(0, d.total - d.amountPaid) : 0, shareUrl: appUrl(`/doc/${d.shareToken}`) };
}

export async function getDoc(projectId: string, id: string) {
  const [d] = await db.select().from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.id, id), eq(schema.invoiceDocuments.projectId, projectId)));
  if (!d) throw notFound("Document");
  return d;
}

export async function docDetail(projectId: string, id: string) {
  const d = await getDoc(projectId, id);
  const [payments, events] = await Promise.all([
    db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.documentId, id)).orderBy(asc(schema.invoicePayments.paidOn)),
    db.select().from(schema.invoiceEvents).where(eq(schema.invoiceEvents.documentId, id)).orderBy(desc(schema.invoiceEvents.createdAt)).limit(100),
  ]);
  const source = d.sourceId ? (await db.select({ id: schema.invoiceDocuments.id, type: schema.invoiceDocuments.type, number: schema.invoiceDocuments.number }).from(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.id, d.sourceId)))[0] ?? null : null;
  const children = await db.select({ id: schema.invoiceDocuments.id, type: schema.invoiceDocuments.type, number: schema.invoiceDocuments.number, status: schema.invoiceDocuments.status }).from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.projectId, projectId), eq(schema.invoiceDocuments.sourceId, id)));
  return { document: view(d), payments, events, source, children };
}

export async function listDocs(projectId: string, f: { type?: DocType; status?: string; q?: string; clientId?: string; from?: string; to?: string } = {}) {
  const cond = [eq(schema.invoiceDocuments.projectId, projectId)];
  if (f.type) cond.push(eq(schema.invoiceDocuments.type, f.type));
  if (f.clientId) cond.push(eq(schema.invoiceDocuments.clientId, f.clientId));
  if (f.from) cond.push(sql`${schema.invoiceDocuments.issueDate} >= ${f.from}`);
  if (f.to) cond.push(sql`${schema.invoiceDocuments.issueDate} <= ${f.to}`);
  if (f.q?.trim()) {
    const q = contains(f.q.trim());
    cond.push(or(ilike(schema.invoiceDocuments.number, q), sql`${schema.invoiceDocuments.client}->>'name' ilike ${q}`, sql`${schema.invoiceDocuments.client}->>'company' ilike ${q}`)!);
  }
  const rows = await db.select().from(schema.invoiceDocuments).where(and(...cond)).orderBy(desc(schema.invoiceDocuments.issueDate), desc(schema.invoiceDocuments.createdAt)).limit(1000);
  const t = today();
  const docs = rows.map((r) => view(r, t));
  return f.status ? docs.filter((d) => d.displayStatus === f.status) : docs;
}

function rowValues(input: DocInput, totals: ReturnType<typeof totalsFor>) {
  return {
    clientId: input.clientId,
    client: input.client,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    lines: input.lines,
    adjustments: input.adjustments,
    taxMode: input.taxMode,
    inclusive: input.inclusive,
    placeOfSupply: input.placeOfSupply,
    title: input.title,
    reference: input.reference,
    notes: input.notes,
    terms: input.terms,
    footer: input.footer,
    customFields: input.customFields,
    templateId: input.templateId,
    recurring: input.type === "invoice" ? input.recurring : null,
    subtotal: totals.subtotal,
    discountTotal: totals.discount,
    taxTotal: totals.tax,
    total: totals.total,
    taxes: totals.taxes,
    updatedAt: new Date(),
  };
}

async function checkRefs(projectId: string, input: DocInput) {
  if (input.clientId) {
    const [c] = await db.select({ id: schema.invoiceClients.id }).from(schema.invoiceClients).where(and(eq(schema.invoiceClients.id, input.clientId), eq(schema.invoiceClients.projectId, projectId)));
    if (!c) throw new ApiError("validation_failed", "That client isn't in this project", { clientId: ["Unknown client"] });
  }
  if (input.templateId) await requireTemplate(projectId, input.templateId);
  if (input.dueDate && input.dueDate < input.issueDate) throw new ApiError("validation_failed", "The due date is before the issue date", { dueDate: ["Before the issue date"] });
  if (input.recurring && input.recurring.endsOn && input.recurring.endsOn < input.recurring.nextRun) throw new ApiError("validation_failed", "Recurring invoices must end after the next run");
}

async function assertNumberFree(tx: Tx | typeof db, projectId: string, type: DocType, number: string, exceptId?: string) {
  const [clash] = await tx.select({ id: schema.invoiceDocuments.id }).from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.projectId, projectId), eq(schema.invoiceDocuments.type, type), eq(schema.invoiceDocuments.number, number), ...(exceptId ? [ne(schema.invoiceDocuments.id, exceptId)] : [])));
  if (clash) throw new ApiError("conflict", `${DOC_LABEL[type]} ${number} already exists`, { number: ["Already used"] });
}

/** Creates a draft, or issues it straight away (gets its number). */
export async function createDoc(projectId: string, userId: string | null, input: DocInput, opts: { issue?: boolean; sourceId?: string | null } = {}) {
  await checkRefs(projectId, input);
  // The plan's monthly invoice allowance (Free: 10). Quotes, credit notes and the rest don't count.
  if (input.type === "invoice") {
    const sub = await import("../billing/subscriptions");
    const orgId = await sub.orgOfInvoiceOwner(projectId);
    if (orgId) await sub.assertQuota(orgId, "invoicesPerMonth");
  }
  const settings = await getSettings(projectId);
  const totals = totalsFor(input, settings);
  if (input.type !== "quote" && totals.total <= 0 && input.type !== "credit_note") throw new ApiError("validation_failed", "The total must be more than zero");
  return db.transaction(async (tx) => {
    let number = "";
    if (opts.issue) {
      if (input.number) {
        await assertNumberFree(tx, projectId, input.type, input.number);
        number = input.number;
      } else number = await nextNumber(tx, projectId, input.type, input.issueDate);
    }
    const [row] = await tx
      .insert(schema.invoiceDocuments)
      .values({ projectId, type: input.type, number, status: opts.issue ? "sent" : "draft", shareToken: randomToken(18), createdBy: userId, sourceId: opts.sourceId ?? null, ...rowValues(input, totals) })
      .returning();
    await event(row.id, "created", opts.issue ? `${DOC_LABEL[input.type]} ${number} issued` : "Draft created", userId, tx);
    return row;
  });
}

export async function updateDoc(projectId: string, id: string, userId: string | null, input: DocInput) {
  const d = await getDoc(projectId, id);
  if (d.status === "void") throw new ApiError("conflict", "A void document can't be edited");
  if (d.type !== input.type) throw new ApiError("validation_failed", "The document type can't change — duplicate it instead");
  await checkRefs(projectId, input);
  const settings = await getSettings(projectId);
  const totals = totalsFor(input, settings);
  if (d.amountPaid > totals.total) throw new ApiError("conflict", `Payments of ${formatMoney(d.amountPaid, d.currency)} are already recorded — the total can't go below that`);
  return db.transaction(async (tx) => {
    let number = d.number;
    if (input.number && input.number !== d.number && d.status !== "draft") {
      await assertNumberFree(tx, projectId, d.type as DocType, input.number, id);
      number = input.number;
    }
    if (d.status === "draft" && input.number) {
      await assertNumberFree(tx, projectId, d.type as DocType, input.number, id);
      number = input.number;
    }
    const status = d.status === "partial" || d.status === "paid" ? (d.amountPaid >= totals.total ? "paid" : d.amountPaid > 0 ? "partial" : "sent") : d.status;
    const [row] = await tx.update(schema.invoiceDocuments).set({ ...rowValues(input, totals), number, status }).where(eq(schema.invoiceDocuments.id, id)).returning();
    if (d.status !== "draft") await event(id, "edited", "Edited after issuing", userId, tx);
    return row;
  });
}

/** Gives a draft its number and marks it issued. */
export async function issueDoc(projectId: string, id: string, userId: string | null) {
  const d = await getDoc(projectId, id);
  if (d.status !== "draft") return d;
  return db.transaction(async (tx) => {
    const number = d.number || (await nextNumber(tx, projectId, d.type as DocType, isoOf(d.issueDate)));
    const [row] = await tx.update(schema.invoiceDocuments).set({ number, status: "sent", updatedAt: new Date() }).where(eq(schema.invoiceDocuments.id, id)).returning();
    await event(id, "issued", `${DOC_LABEL[d.type as DocType]} ${number} issued`, userId, tx);
    return row;
  });
}

export async function deleteDraft(projectId: string, id: string) {
  const d = await getDoc(projectId, id);
  if (d.status !== "draft") throw new ApiError("conflict", "Only drafts can be deleted — void an issued document instead, so your numbering has no gaps");
  await db.delete(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.id, id));
}

export async function voidDoc(projectId: string, id: string, userId: string, reason: string) {
  const d = await getDoc(projectId, id);
  if (d.status === "draft") throw new ApiError("conflict", "Delete the draft instead");
  if (d.status === "void") return d;
  if (d.amountPaid > 0) throw new ApiError("conflict", "Remove the recorded payments, or issue a credit note, before voiding");
  const [row] = await db.update(schema.invoiceDocuments).set({ status: "void", voidedAt: new Date(), recurring: null, updatedAt: new Date() }).where(eq(schema.invoiceDocuments.id, id)).returning();
  await event(id, "void", `Voided${reason ? `: ${reason}` : ""}`, userId);
  return row;
}

function inputFrom(d: DocRow, patch: Partial<DocInput> = {}): DocInput {
  return {
    type: d.type as DocType,
    clientId: d.clientId,
    client: d.client as Party,
    issueDate: today(),
    dueDate: null,
    currency: d.currency,
    lines: d.lines as DocInput["lines"],
    adjustments: d.adjustments as DocInput["adjustments"],
    taxMode: d.taxMode as DocInput["taxMode"],
    inclusive: d.inclusive,
    placeOfSupply: d.placeOfSupply,
    title: "",
    reference: d.reference,
    notes: d.notes,
    terms: d.terms,
    footer: d.footer,
    customFields: d.customFields as DocInput["customFields"],
    templateId: d.templateId,
    recurring: null,
    number: "",
    ...patch,
  };
}

export async function duplicateDoc(projectId: string, id: string, userId: string) {
  const d = await getDoc(projectId, id);
  const settings = await getSettings(projectId);
  const t = today();
  const due = d.type === "quote" ? addDays(t, settings.quoteValidDays) : d.type === "invoice" ? addDays(t, settings.dueDays) : null;
  return createDoc(projectId, userId, inputFrom(d, { dueDate: due }));
}

/** Quote → invoice. The quote is marked converted and linked. */
export async function convertQuote(projectId: string, id: string, userId: string, to: "invoice" | "proforma" = "invoice") {
  const q = await getDoc(projectId, id);
  if (q.type !== "quote") throw new ApiError("conflict", "Only quotations can be converted");
  if (q.status === "void" || q.status === "declined") throw new ApiError("conflict", "This quotation was declined or voided");
  const settings = await getSettings(projectId);
  const doc = await createDoc(projectId, userId, inputFrom(q, { type: to, dueDate: to === "invoice" ? addDays(today(), settings.dueDays) : null, reference: q.reference || q.number }), { sourceId: q.id });
  if (to === "invoice") await db.update(schema.invoiceDocuments).set({ status: "converted", updatedAt: new Date() }).where(eq(schema.invoiceDocuments.id, q.id));
  await event(q.id, "converted", `Converted to ${DOC_LABEL[to].toLowerCase()}`, userId);
  return doc;
}

/** A credit note reversing (part of) an issued invoice. */
export async function creditNoteFor(projectId: string, id: string, userId: string) {
  const inv = await getDoc(projectId, id);
  if (inv.type !== "invoice" || inv.status === "draft" || inv.status === "void") throw new ApiError("conflict", "Credit notes are issued against an issued invoice");
  const doc = await createDoc(projectId, userId, inputFrom(inv, { type: "credit_note", reference: inv.number, notes: `Against invoice ${inv.number}` }), { sourceId: inv.id });
  await event(inv.id, "credit_note", "Credit note started", userId);
  return doc;
}

// ── Payments ────────────────────────────────────────────────────────────────

async function refreshPaid(tx: Tx, id: string) {
  const [{ paid, last }] = await tx.select({ paid: sql<number>`coalesce(sum(${schema.invoicePayments.amount}),0)::int`, last: sql<string | null>`max(${schema.invoicePayments.paidOn})::text` }).from(schema.invoicePayments).where(eq(schema.invoicePayments.documentId, id));
  const [d] = await tx.select().from(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.id, id));
  const status = paid >= d.total && d.total > 0 ? "paid" : paid > 0 ? "partial" : d.viewedAt ? "viewed" : "sent";
  await tx.update(schema.invoiceDocuments).set({ amountPaid: paid, status, paidAt: status === "paid" ? new Date(`${last}T12:00:00Z`) : null, updatedAt: new Date() }).where(eq(schema.invoiceDocuments.id, id));
}

export async function addPayment(projectId: string, id: string, userId: string | null, p: { amount: number; method: string; paidOn: string; reference: string; note: string; accountId?: string | null; receiptId?: string | null; inrAmount?: number | null }) {
  const d = await getDoc(projectId, id);
  if (d.type !== "invoice" && d.type !== "proforma") throw new ApiError("conflict", "Payments are recorded against invoices");
  if (d.status === "draft") throw new ApiError("conflict", "Issue the invoice before recording a payment");
  if (d.status === "void") throw new ApiError("conflict", "This invoice is void");
  const balance = d.total - d.amountPaid;
  if (d.currency === "INR") p = { ...p, inrAmount: null };
  if (p.amount > balance) throw new ApiError("validation_failed", `That's more than the ${formatMoney(balance, d.currency)} still due`, { amount: ["More than the balance"] });
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.invoicePayments).values({ projectId, documentId: id, createdBy: userId, ...p }).returning();
    await refreshPaid(tx, id);
    await event(id, "payment", `Payment of ${formatMoney(p.amount, d.currency)} recorded (${p.method})`, userId, tx);
    return row;
  });
}

/** The rate (₹ per unit) a foreign-currency invoice or credit note is posted at in Accounts; null uses the workspace rate on its date. */
export async function setFxRate(projectId: string, id: string, userId: string, rate: number | null) {
  const d = await getDoc(projectId, id);
  if (d.currency === "INR") throw new ApiError("validation_failed", "This document is in rupees");
  await db.update(schema.invoiceDocuments).set({ fxRate: rate === null ? null : String(rate) }).where(eq(schema.invoiceDocuments.id, id));
  await event(id, "edited", rate === null ? "Rate for the books cleared" : `Rate for the books set to ₹${rate} per ${d.currency}`, userId);
}

export async function deletePayment(projectId: string, docId: string, paymentId: string, userId: string) {
  const d = await getDoc(projectId, docId);
  return db.transaction(async (tx) => {
    const r = await tx.delete(schema.invoicePayments).where(and(eq(schema.invoicePayments.id, paymentId), eq(schema.invoicePayments.documentId, docId))).returning();
    if (!r.length) throw notFound("Payment");
    await refreshPaid(tx, docId);
    await event(docId, "payment_removed", `Payment of ${formatMoney(r[0].amount, d.currency)} removed`, userId, tx);
  });
}

export async function listPayments(projectId: string, f: { from?: string; to?: string } = {}) {
  const cond = [eq(schema.invoicePayments.projectId, projectId)];
  if (f.from) cond.push(sql`${schema.invoicePayments.paidOn} >= ${f.from}`);
  if (f.to) cond.push(sql`${schema.invoicePayments.paidOn} <= ${f.to}`);
  return db
    .select({ id: schema.invoicePayments.id, amount: schema.invoicePayments.amount, method: schema.invoicePayments.method, paidOn: schema.invoicePayments.paidOn, reference: schema.invoicePayments.reference, note: schema.invoicePayments.note, documentId: schema.invoicePayments.documentId, number: schema.invoiceDocuments.number, currency: schema.invoiceDocuments.currency, client: sql<string>`${schema.invoiceDocuments.client}->>'name'` })
    .from(schema.invoicePayments)
    .innerJoin(schema.invoiceDocuments, eq(schema.invoiceDocuments.id, schema.invoicePayments.documentId))
    .where(and(...cond))
    .orderBy(desc(schema.invoicePayments.paidOn))
    .limit(2000);
}

// ── Rendering and sharing ───────────────────────────────────────────────────

function toRender(d: DocRow): RenderDoc {
  return {
    type: d.type as DocType,
    number: d.number,
    status: view(d).displayStatus,
    title: d.title,
    issueDate: isoOf(d.issueDate),
    dueDate: d.dueDate ? isoOf(d.dueDate) : null,
    client: d.client as Party,
    lines: d.lines as RenderDoc["lines"],
    adjustments: d.adjustments as RenderDoc["adjustments"],
    taxMode: d.taxMode as RenderDoc["taxMode"],
    inclusive: d.inclusive,
    placeOfSupply: d.placeOfSupply,
    reference: d.reference,
    notes: d.notes,
    terms: d.terms,
    footer: d.footer,
    customFields: d.customFields as RenderDoc["customFields"],
    amountPaid: d.amountPaid,
    currency: d.currency,
  };
}

export function renderDoc(d: DocRow, settings: InvoiceSettings, template: TemplateConfig, extra: { before?: string; extraCss?: string; zoom?: number } = {}) {
  return renderDocument({ doc: toRender(d), settings, template, ...extra }).html;
}

/** The document as a PDF file, named like "Invoice INV-0042.pdf". */
export async function pdfOf(d: DocRow, settings: InvoiceSettings, template: TemplateConfig) {
  const bytes = await renderPdf({ doc: toRender(d), settings, template });
  const name = `${titleFor(toRender(d), template)} ${d.number || "draft"}`.replace(/[^\w .-]+/g, "-").trim();
  return { bytes, filename: `${name}.pdf` };
}

export async function pdfForOwner(projectId: string, id: string) {
  const d = await getDoc(projectId, id);
  const settings = await getSettings(projectId);
  return pdfOf(d, settings, await templateFor(projectId, d.templateId, settings));
}

export async function renderForOwner(projectId: string, id: string, opts: { print?: boolean } = {}) {
  const d = await getDoc(projectId, id);
  const settings = await getSettings(projectId);
  // ?print=1 opens the print dialog straight away ("Save as PDF" lives there).
  const before = opts.print ? `<script>addEventListener("load",function(){setTimeout(function(){print()},300)})</script>` : undefined;
  return renderDoc(d, settings, await templateFor(projectId, d.templateId, settings), { before });
}

/** The client's view: never drafts; first open marks it viewed. */
export async function publicDoc(token: string) {
  if (!/^[\w-]{10,64}$/.test(token)) return null;
  const [d] = await db.select().from(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.shareToken, token));
  if (!d || d.status === "draft") return null;
  const settings = await getSettings(d.projectId);
  const template = await templateFor(d.projectId, d.templateId, settings);
  return { doc: d, view: view(d), settings, template };
}

export async function markViewed(d: DocRow) {
  const first = !d.viewedAt;
  await db
    .update(schema.invoiceDocuments)
    .set({ viewCount: sql`${schema.invoiceDocuments.viewCount} + 1`, ...(first ? { viewedAt: new Date() } : {}), ...(d.status === "sent" ? { status: "viewed" } : {}) })
    .where(eq(schema.invoiceDocuments.id, d.id));
  if (first) await event(d.id, "viewed", "Opened by the client");
}

export async function decideQuote(token: string, decision: "accept" | "decline", name: string, note: string) {
  const [d] = await db.select().from(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.shareToken, token));
  if (!d || d.type !== "quote" || d.status === "draft") throw notFound("Quotation");
  if (!["sent", "viewed"].includes(d.status)) throw new ApiError("conflict", "This quotation has already been answered");
  if (d.dueDate && isoOf(d.dueDate) < today()) throw new ApiError("conflict", "This quotation has expired — ask for a fresh one");
  await db.update(schema.invoiceDocuments).set({ status: decision === "accept" ? "accepted" : "declined", decidedAt: new Date(), decidedBy: name.slice(0, 120), decisionNote: note.slice(0, 1000), updatedAt: new Date() }).where(eq(schema.invoiceDocuments.id, d.id));
  await event(d.id, decision === "accept" ? "accepted" : "declined", `${decision === "accept" ? "Accepted" : "Declined"} by ${name}${note ? `: ${note}` : ""}`);
}

/** Emails the link (issuing a draft first). Says honestly whether it was delivered. */
export async function sendDoc(projectId: string, id: string, userId: string | null, msg: { to: string; subject: string; message: string; reminder?: boolean; attachPdf?: boolean }) {
  let d = await getDoc(projectId, id);
  if (d.status === "void") throw new ApiError("conflict", "This document is void");
  if (d.status === "draft") d = await issueDoc(projectId, id, userId);
  const settings = await getSettings(projectId);
  const url = appUrl(`/doc/${d.shareToken}`);
  // The PDF goes along by default, so the client has the file as well as the link.
  const pdf = msg.attachPdf === false ? null : await pdfOf(d, settings, await templateFor(projectId, d.templateId, settings));
  await sendMail({ to: msg.to, subject: msg.subject.slice(0, 200), body: `${msg.message.trim()}\n\nView ${DOC_LABEL[d.type as DocType].toLowerCase()} ${d.number}: ${url}`, fromName: settings.business.name || undefined, replyTo: settings.business.email || undefined, ...(pdf ? { attachments: [{ filename: pdf.filename, contentType: "application/pdf", base64: Buffer.from(pdf.bytes).toString("base64") }] } : {}) });
  await db.update(schema.invoiceDocuments).set({ sentAt: new Date(), ...(msg.reminder ? { lastReminderAt: new Date() } : {}) }).where(eq(schema.invoiceDocuments.id, id));
  await event(id, msg.reminder ? "reminder" : "emailed", `${msg.reminder ? "Reminder emailed" : "Emailed"} to ${msg.to}${mailConfigured() ? "" : " (recorded only — email delivery isn't set up)"}`, userId);
  return { delivered: mailConfigured(), document: view(await getDoc(projectId, id)) };
}

const SHARED_VIA: Record<string, string> = { link: "Link copied", whatsapp: "Shared on WhatsApp", sms: "Shared by SMS", share: "Shared from another app", qr: "QR code shown", print: "Printed or saved as PDF" };
export async function noteShared(documentId: string, via: string, userId: string) {
  await event(documentId, "shared", SHARED_VIA[via] ?? "Shared", userId);
}

export function defaultMessage(d: DocRow, settings: InvoiceSettings, reminder = false) {
  const kind = DOC_LABEL[d.type as DocType].toLowerCase();
  const name = (d.client as Party).name.split(" ")[0] || "there";
  const amount = formatMoney(d.type === "invoice" ? Math.max(0, d.total - d.amountPaid) : d.total, d.currency);
  const due = d.dueDate ? new Date(`${isoOf(d.dueDate)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
  const subject = reminder ? `Reminder: ${kind} ${d.number} — ${amount} due` : `${DOC_LABEL[d.type as DocType]} ${d.number} from ${settings.business.name || "us"}`;
  const body = reminder
    ? `Hi ${name},\n\nA friendly reminder that ${kind} ${d.number} for ${amount}${due ? ` was due on ${due}` : " is due"}. You can view it and pay using the link below.\n\nThank you,\n${settings.business.name}`
    : d.type === "quote"
      ? `Hi ${name},\n\nPlease find our quotation ${d.number} for ${amount}${due ? `, valid until ${due}` : ""}. You can view and accept it online using the link below.\n\nThank you,\n${settings.business.name}`
      : `Hi ${name},\n\nPlease find ${kind} ${d.number} for ${amount}${due && d.type === "invoice" ? `, due on ${due}` : ""}. You can view, download and pay it using the link below.\n\nThank you,\n${settings.business.name}`;
  return { subject, message: body, whatsapp: `${body.replace(/\n\n/g, "\n")}\n` };
}

// ── Recurring invoices and reminders (hourly) ───────────────────────────────

export async function runRecurring(now = today()) {
  const due = await db.select({ id: schema.invoiceDocuments.id, projectId: schema.invoiceDocuments.projectId }).from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.type, "invoice"), sql`${schema.invoiceDocuments.recurring} is not null`, sql`(${schema.invoiceDocuments.recurring}->>'nextRun') <= ${now}`, ne(schema.invoiceDocuments.status, "void")));
  let created = 0;
  for (const { id, projectId } of due) {
    try {
      const made = await db.transaction(async (tx) => {
        // Lock the template invoice so two workers can't both create the next one.
        const [src] = await tx.select().from(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.id, id)).for("update", { skipLocked: true });
        const r = src?.recurring as Recurring | null;
        if (!src || !r || r.nextRun > now) return null;
        const next = addPeriod(r.nextRun, r.every);
        const stop = r.endsOn && next > r.endsOn;
        await tx.update(schema.invoiceDocuments).set({ recurring: stop ? null : { ...r, nextRun: next } }).where(eq(schema.invoiceDocuments.id, id));
        return { src, r };
      });
      if (!made) continue;
      const settings = await getSettings(projectId);
      const doc = await createDoc(projectId, null, inputFrom(made.src, { issueDate: made.r.nextRun, dueDate: addDays(made.r.nextRun, settings.dueDays), notes: made.src.notes }), { issue: true, sourceId: made.src.id });
      await event(made.src.id, "recurring", `Created ${doc.number}`);
      const email = (made.src.client as Party).email;
      if (made.r.autoSend && email) {
        const m = defaultMessage(doc, settings);
        await sendDoc(projectId, doc.id, null, { to: email, subject: m.subject, message: m.message });
      }
      created++;
    } catch (e) {
      log.warn("invoice_recurring_failed", { id, error: (e as Error).message });
    }
  }
  return created;
}

export async function runReminders(now = today()) {
  const rows = await db.select({ projectId: schema.invoiceSettings.projectId, data: schema.invoiceSettings.data }).from(schema.invoiceSettings).where(sql`(${schema.invoiceSettings.data}->'reminders'->>'enabled')::boolean = true`);
  let sent = 0;
  for (const r of rows) {
    const settings = settingsSchema.parse(r.data);
    const open = await db.select().from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.projectId, r.projectId), eq(schema.invoiceDocuments.type, "invoice"), inArray(schema.invoiceDocuments.status, ["sent", "viewed", "partial"]), sql`${schema.invoiceDocuments.dueDate} is not null`));
    for (const d of open) {
      const email = (d.client as Party).email;
      if (!email || d.amountPaid >= d.total) continue;
      // Compare in the same local day as `now` (IST), not UTC, so a run after midnight never repeats a reminder.
      if (d.lastReminderAt && today(330, d.lastReminderAt) === now) continue;
      const days = Math.round((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${isoOf(d.dueDate!)}T00:00:00Z`)) / 86_400_000);
      const before = days < 0 && -days === settings.reminders.beforeDays;
      const after = days > 0 && settings.reminders.afterDays.includes(days);
      if (!before && !after) continue;
      const m = defaultMessage(d, settings, true);
      await sendDoc(r.projectId, d.id, null, { to: email, subject: m.subject, message: m.message, reminder: true }).catch((e) => log.warn("invoice_reminder_failed", { id: d.id, error: (e as Error).message }));
      sent++;
    }
  }
  return sent;
}

export async function invoicingTick() {
  const t = today();
  return { recurring: await runRecurring(t), reminders: await runReminders(t) };
}

export { titleFor };
