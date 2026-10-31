// Invoicing HTTP API, shared by /projects/:id/invoicing and /finance/books/:id.
import { importClients, importItems } from "./import";
import { syncInvoiceStock } from "../inventory/invoice-stock";
import { log } from "../log";
import { z } from "zod";
import { clientSchema, docInputSchema, DOC_TYPES, paymentSchema, settingsSchema, templateConfigSchema, itemSchema, type DocType } from "@/lib/invoicing/model";
import { PREBUILT_TEMPLATES, prebuilt } from "@/lib/invoicing/templates";
import { hasLlm } from "../ai/gateway";
import { can } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { readJson, type AuthedContext } from "../http/handler";
import { rateLimit } from "../security/rate-limit";
import { audit } from "../services/audit";
import { mailConfigured } from "../services/mail";
import { deleteBook, renameBook, uploadImage, type InvoicingScope } from "./books";
import { readInvoiceFormat, REFERENCE_TYPES } from "./extract";
import { exportCsv, invoicingReport } from "./reports";
import { linkedStore, linkStore, storeChoices, storeSales } from "./store-sales";
import * as inv from "./service";
import { releaseBilling } from "../work/billing";
import { recomputeInvoiced } from "../sales/fulfil";

const qp = (ctx: AuthedContext) => new URL(ctx.req.url).searchParams;
const uuid = (v: string | undefined, what: string) => {
  if (!v || !z.uuid().safeParse(v).success) throw notFound(what);
  return v;
};
const isoDay = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
const range = (ctx: AuthedContext) => {
  const t = inv.today();
  const from = isoDay(qp(ctx).get("from"), `${t.slice(0, 4)}-01-01`);
  return { from, to: isoDay(qp(ctx).get("to"), t) };
};
const docType = (v: string | null): DocType | undefined => (DOC_TYPES as readonly string[]).includes(v ?? "") ? (v as DocType) : undefined;

const MAX_FILE = 5 * 1024 * 1024;
async function readUpload(ctx: AuthedContext, what: string) {
  if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_FILE + 64 * 1024) throw new ApiError("payload_too_large", "Files are limited to 5 MB");
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    throw new ApiError("bad_request", `Send the ${what} as multipart/form-data`);
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError("validation_failed", `Choose a ${what} to upload`, { file: ["Required"] });
  if (file.size > MAX_FILE) throw new ApiError("payload_too_large", "Files are limited to 5 MB");
  return { file, form, bytes: Buffer.from(await file.arrayBuffer()) };
}

const sendSchema = z.object({ to: z.email().max(200), subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(5000), attachPdf: z.boolean().default(true) });

/** Every invoicing endpoint, for a project's books or a standalone finance book. */
export async function handleInvoicing(ctx: AuthedContext, scope: InvoicingScope, slug: string[] = []) {
  const [section = "", id, sub, subId] = slug;
  const method = ctx.req.method;
  const projectId = scope.id;
  const role = scope.role;
  const project = { orgId: scope.orgId };
  const key = `${method} ${section}`;
  // Linked items take stock out of Inventory when an invoice is issued (and back for credit notes or a void).
  // After a document changes: stock for linked items, and sales orders' invoiced quantities (an issued credit note frees them).
  const stock = (docId: string) =>
    Promise.all([
      syncInvoiceStock(scope.orgId, docId).catch((e) => log.warn("invoice stock sync failed", { docId, error: String(e) })),
      recomputeInvoiced(scope.orgId).catch((e) => log.warn("sales invoiced sync failed", { docId, error: String(e) })),
    ]);

  switch (key) {
    case "GET ": {
      await inv.ensureTemplates(projectId, ctx.user.id);
      const [settings, templates, ai] = await Promise.all([inv.getSettings(projectId), inv.listTemplates(projectId), hasLlm(project.orgId)]);
      return { settings, templates, prebuilt: PREBUILT_TEMPLATES, mailConfigured: mailConfigured(), ai, canVoid: can(role, "invoices:void"), today: inv.today(), scope: { kind: scope.kind, id: scope.id, name: scope.name, canDelete: scope.kind === "book" && (role === "owner" || role === "admin") } };
    }

    // ── The books themselves (standalone only) ──
    case "PUT book": {
      const { name } = await readJson(ctx.req, z.object({ name: z.string().trim().min(1).max(80) }));
      return { book: await renameBook(scope, name) };
    }
    case "DELETE book": {
      await deleteBook(scope, ctx.user.id);
      return { ok: true };
    }

    // ── Settings ──
    case "GET settings":
      return { settings: await inv.getSettings(projectId) };
    case "PUT settings": {
      const input = await readJson(ctx.req, settingsSchema);
      const settings = await inv.saveSettings(projectId, input);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "invoicing.settings_updated", targetType: "project", targetId: projectId, ip: ctx.ip });
      return { settings };
    }
    case "POST upload": {
      // Logo or signature image for documents.
      await rateLimit(`inv-upload:${ctx.user.id}`, 60, 3600_000);
      const { file, bytes } = await readUpload(ctx, "image");
      const asset = await uploadImage(scope, ctx.user.id, { name: file.name, bytes });
      return Response.json({ asset }, { status: 201 });
    }

    // ── Templates ──
    case "GET templates": {
      if (id && sub === "reference") {
        const ref = await inv.templateReference(projectId, uuid(id, "Template"));
        return new Response(new Uint8Array(ref.data), { headers: { "Content-Type": ref.mime, "Content-Disposition": `inline; filename="${(ref.name ?? "reference").replace(/[^\w.\- ]/g, "")}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; plugin-types application/pdf", "Cache-Control": "private, max-age=300" } });
      }
      return { templates: await inv.listTemplates(projectId) };
    }
    case "POST templates": {
      if (id === "read") {
        // Upload the owner's own invoice; read its design (with AI) into a new template.
        await rateLimit(`inv-read:${ctx.user.id}`, 20, 3600_000);
        const { file, form, bytes } = await readUpload(ctx, "file");
        const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
        if (!REFERENCE_TYPES[mime]) throw new ApiError("validation_failed", "Upload a PNG, JPEG, WebP or PDF of your invoice", { file: ["Unsupported type"] });
        // Check the bytes really are what the type says.
        const magic = bytes.subarray(0, 4).toString("latin1");
        const ok = mime === "application/pdf" ? magic === "%PDF" : magic.startsWith("\x89PNG") || magic.startsWith("\xff\xd8") || magic === "RIFF" || magic.startsWith("GIF8");
        if (!ok) throw new ApiError("validation_failed", "That file doesn't look like the image or PDF it claims to be");
        const name = String(form.get("name") ?? "").trim() || `Matched from ${file.name}`.slice(0, 80);
        const read = await readInvoiceFormat(project.orgId, { mime, data: bytes });
        const config = read.ai ? read.config : prebuilt("classic")!.config;
        const template = await inv.saveTemplate(projectId, ctx.user.id, { name, config, source: "uploaded", basedOn: read.ai ? config.layout : "classic", reference: { mime, name: file.name, data: bytes }, extracted: read.ai ? read.extracted : null });
        return Response.json({ template, ai: read.ai, suggestions: read.ai ? read.suggestions : null, extracted: read.ai ? read.extracted : null }, { status: 201 });
      }
      const body = await readJson(ctx.req, z.object({ name: z.string().trim().min(1).max(80), from: z.string().max(40).optional(), config: templateConfigSchema.optional() }));
      const base = body.from ? prebuilt(body.from) : null;
      if (body.from && !base) throw notFound("Design");
      const template = await inv.saveTemplate(projectId, ctx.user.id, { name: body.name, config: body.config ?? base!.config, source: base ? "prebuilt" : "custom", basedOn: body.from ?? "" });
      return Response.json({ template }, { status: 201 });
    }
    case "PUT templates": {
      const body = await readJson(ctx.req, z.object({ name: z.string().trim().min(1).max(80), config: templateConfigSchema }));
      return { template: await inv.saveTemplate(projectId, ctx.user.id, { id: uuid(id, "Template"), name: body.name, config: body.config, source: "custom" }) };
    }
    case "DELETE templates":
      await inv.deleteTemplate(projectId, uuid(id, "Template"));
      return { ok: true };

    // ── Clients and items ──
    case "GET clients":
      return { clients: await inv.listClients(projectId, qp(ctx).get("q") ?? "") };
    case "POST clients":
      if (id === "import") return importClients(projectId, await readJson(ctx.req, z.unknown()));
      return Response.json({ client: await inv.saveClient(projectId, null, await readJson(ctx.req, clientSchema)) }, { status: 201 });
    case "PUT clients":
      return { client: await inv.saveClient(projectId, uuid(id, "Client"), await readJson(ctx.req, clientSchema)) };
    case "DELETE clients":
      await inv.archiveClient(projectId, uuid(id, "Client"));
      return { ok: true };
    case "GET items":
      return { items: await inv.listItems(projectId) };
    case "POST items":
      if (id === "import") return importItems(projectId, await readJson(ctx.req, z.unknown()));
      return Response.json({ item: await inv.saveItem(projectId, null, await readJson(ctx.req, itemSchema)) }, { status: 201 });
    case "PUT items":
      return { item: await inv.saveItem(projectId, uuid(id, "Item"), await readJson(ctx.req, itemSchema)) };
    case "DELETE items":
      await inv.archiveItem(projectId, uuid(id, "Item"));
      return { ok: true };

    // ── Documents ──
    case "GET documents": {
      if (!id) {
        const q = qp(ctx);
        return { documents: await inv.listDocs(projectId, { type: docType(q.get("type")), status: q.get("status") ?? undefined, q: q.get("q") ?? undefined, clientId: q.get("clientId") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined }) };
      }
      const docId = uuid(id, "Document");
      if (sub === "render") return new Response(await inv.renderForOwner(projectId, docId, { print: qp(ctx).get("print") === "1" }), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      if (sub === "pdf") {
        const f = await inv.pdfForOwner(projectId, docId);
        return new Response(Buffer.from(f.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${qp(ctx).get("download") === "1" ? "attachment" : "inline"}; filename="${f.filename}"`, "Cache-Control": "private, no-store" } });
      }
      if (sub === "message") {
        const d = await inv.getDoc(projectId, docId);
        return inv.defaultMessage(d, await inv.getSettings(projectId), qp(ctx).get("reminder") === "1");
      }
      return inv.docDetail(projectId, docId);
    }
    case "POST documents": {
      if (!id) {
        const body = await readJson(ctx.req, z.object({ document: docInputSchema, issue: z.boolean().default(false) }));
        const d = await inv.createDoc(projectId, ctx.user.id, body.document, { issue: body.issue });
        if (body.issue) await stock(d.id);
        return Response.json(await inv.docDetail(projectId, d.id), { status: 201 });
      }
      const docId = uuid(id, "Document");
      switch (sub) {
        case "issue":
          await inv.issueDoc(projectId, docId, ctx.user.id);
          await stock(docId);
          return inv.docDetail(projectId, docId);
        case "send":
        case "remind": {
          await rateLimit(`inv-send:${ctx.user.id}`, 100, 3600_000);
          const r = await inv.sendDoc(projectId, docId, ctx.user.id, { ...(await readJson(ctx.req, sendSchema)), reminder: sub === "remind" });
          return { delivered: r.delivered, ...(await inv.docDetail(projectId, docId)) };
        }
        case "shared": {
          // Shared by link, WhatsApp, SMS or another app: issue it and note it in the history.
          const how = (await readJson(ctx.req, z.object({ via: z.enum(["link", "whatsapp", "sms", "share", "qr", "print"]) }))).via;
          const d = await inv.issueDoc(projectId, docId, ctx.user.id);
          await inv.noteShared(d.id, how, ctx.user.id);
          await stock(d.id);
          return inv.docDetail(projectId, docId);
        }
        case "duplicate":
          return Response.json(await inv.docDetail(projectId, (await inv.duplicateDoc(projectId, docId, ctx.user.id)).id), { status: 201 });
        case "convert": {
          const to = (await readJson(ctx.req, z.object({ to: z.enum(["invoice", "proforma"]).default("invoice") }))).to;
          return Response.json(await inv.docDetail(projectId, (await inv.convertQuote(projectId, docId, ctx.user.id, to)).id), { status: 201 });
        }
        case "credit-note":
          return Response.json(await inv.docDetail(projectId, (await inv.creditNoteFor(projectId, docId, ctx.user.id)).id), { status: 201 });
        case "void": {
          if (!can(role, "invoices:void")) throw new ApiError("forbidden", "Only owners, admins and billing members can void documents");
          const { reason } = await readJson(ctx.req, z.object({ reason: z.string().trim().max(300).default("") }));
          await inv.voidDoc(projectId, docId, ctx.user.id, reason);
          await stock(docId);
          // Hours and milestones billed on it can be billed again.
          await releaseBilling(scope.orgId);
          await recomputeInvoiced(scope.orgId);
          await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "invoicing.voided", targetType: "invoice_document", targetId: docId, metadata: { reason }, ip: ctx.ip });
          return inv.docDetail(projectId, docId);
        }
        case "payments":
          await inv.addPayment(projectId, docId, ctx.user.id, await readJson(ctx.req, paymentSchema));
          return Response.json(await inv.docDetail(projectId, docId), { status: 201 });
        case "fx-rate": {
          const { rate } = await readJson(ctx.req, z.object({ rate: z.number().positive().max(1e6).nullable() }));
          await inv.setFxRate(projectId, docId, ctx.user.id, rate);
          return inv.docDetail(projectId, docId);
        }
      }
      throw notFound("Route");
    }
    case "PUT documents": {
      const body = await readJson(ctx.req, z.object({ document: docInputSchema }));
      await inv.updateDoc(projectId, uuid(id, "Document"), ctx.user.id, body.document);
      await stock(id!);
      return inv.docDetail(projectId, id!);
    }
    case "DELETE documents": {
      const docId = uuid(id, "Document");
      if (sub === "payments") {
        if (!can(role, "invoices:void")) throw new ApiError("forbidden", "Only owners, admins and billing members can remove payments");
        await inv.deletePayment(projectId, docId, uuid(subId, "Payment"), ctx.user.id);
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "invoicing.payment_removed", targetType: "invoice_document", targetId: docId, ip: ctx.ip });
        return inv.docDetail(projectId, docId);
      }
      await inv.deleteDraft(projectId, docId);
      await releaseBilling(scope.orgId);
      await recomputeInvoiced(scope.orgId);
      return { ok: true };
    }

    // ── Payments, reports, exports ──
    case "GET payments":
      return { payments: await inv.listPayments(projectId, range(ctx)) };
    case "GET reports": {
      const r = range(ctx);
      const store = await linkedStore(scope);
      return { ...(await invoicingReport(projectId, r)), store: store ? await storeSales(store, r) : null };
    }

    // ── Store sales alongside invoices ──
    case "GET store-link":
      return { kind: scope.kind, linked: await linkedStore(scope), choices: scope.kind === "book" ? await storeChoices(scope.orgId) : [] };
    case "PUT store-link": {
      const { projectId: link } = await readJson(ctx.req, z.object({ projectId: z.uuid().nullable() }));
      const out = await linkStore(scope, link);
      await audit({ orgId: scope.orgId, actorId: ctx.user.id, action: "finance.store_linked", targetType: "finance_book", targetId: scope.id, metadata: { projectId: link } });
      return out;
    }
    case "GET export": {
      const kind = id === "payments" || id === "tax" || id === "clients" ? id : "documents";
      const r = range(ctx);
      const body = await exportCsv(projectId, kind, r, docType(qp(ctx).get("type")));
      return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${r.from}-to-${r.to}.csv"` } });
    }
  }
  throw notFound("Route");
}

