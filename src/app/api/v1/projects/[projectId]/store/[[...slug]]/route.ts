import { catalogueFromImport, checkoutReadiness, createCatalogue, deleteCatalogue, duplicateCatalogue, getCatalogue, listCatalogues, recordShare, rotateCatalogueLink, SHARE_CHANNELS, updateCatalogue } from "@/server/commerce/catalogues";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { CURRENCIES, minorDigits } from "@/lib/store/money";
import { exportOrdersCsv, packingSlipsHtml, exportCustomersCsv, getCustomer, inventoryHistory, invoiceHtml, listCustomers, listInventory, listReviews, moderateReview, deleteReview } from "@/server/commerce/admin";
import { adjustStock, deleteCollection, deleteProduct, exportCsv, getProduct, getStore, importCsv, listCollections, loadProducts, saveCollection, saveProduct, type StoreRow } from "@/server/commerce/catalog";
import { storeInsights } from "@/server/commerce/insights";
import { loadCatalog } from "@/server/commerce/storefront";
import { abandonedCarts, addOrderNote, cancelOrder, getOrder, listOrders, manualMarkPaid, providerCreds, refundOrder, releaseExpired, updateFulfillment } from "@/server/commerce/orders";
import { providerInfo, type ProviderId } from "@/server/commerce/payments";
import { draftProductSchema, importDraftProducts } from "@/server/launch/launch";
import { can } from "@/server/authz/permissions";
import { productSchema } from "@/server/commerce/product-schema";
import { assignBarcodes, lookupCode, posCatalog, posSale, posSaleSchema, posSummary } from "@/server/commerce/pos";
import { receiptHtml } from "@/server/commerce/receipt";
import { askProvider, getTest, listTests, preflight, refundTest, startTest, webhookUrlFor } from "@/server/commerce/payment-test";
import {
  deleteDiscount,
  discountSchema,
  getShipping,
  getTaxes,
  listDiscounts,
  listPaymentProviders,
  providerUpdateSchema,
  retestProvider,
  saveDiscount,
  saveProvider,
  saveShipping,
  saveTaxes,
  setupStore,
  shippingSchema,
  taxSchema,
} from "@/server/commerce/settings";
import { applyStoreTemplate, embedStore, STORE_TEMPLATES } from "@/server/commerce/templates";
import { getRecovery, saveRecovery, sendReminderNow } from "@/server/commerce/recovery";
import { listingFromPhoto, MAX_PHOTO } from "@/server/commerce/photo-listing";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { listReturns, updateReturn } from "@/server/commerce/customer";
import { giftCardDetail, issueGiftCard, listGiftCards, setGiftCardDisabled } from "@/server/commerce/giftcards";
import { cancelStoreSubscription, listSubscriptions } from "@/server/commerce/subscriptions";
import { buyLabel, getLabelProviders, LABEL_PROVIDERS, labelRates, labelUpdateSchema, saveLabelProvider } from "@/server/commerce/labels";
import { bookShipment, getShiprocket, saveShiprocket, shiprocketUpdateSchema, syncOpenShipments, syncShipment } from "@/server/commerce/shiprocket";
import { bookingSettingsSchema, cancelBooking, deleteService, getBookingSettings, listBookings, listServices, releaseExpiredBookings, saveBookingSettings, saveService, serviceSchema, setBookingStatus } from "@/server/bookings/bookings";
import { gstCsv, gstReport } from "@/server/commerce/gst-report";
import { grantMembership, listDigitalFiles, listMembers, MAX_DIGITAL_BYTES, revokeMembership, uploadDigitalFile } from "@/server/commerce/digital";
import { audit } from "@/server/services/audit";
import { appUrl, mailConfigured } from "@/server/services/mail";
import { getWhatsApp, listMessages, saveWhatsApp, sendTestMessage, whatsappUpdateSchema } from "@/server/commerce/whatsapp";

type P = { projectId: string; slug?: string[] };

// ─── Schemas ─────────────────────────────────────────────────────────────────

const setupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  currency: z.string().trim().length(3).optional(),
  country: z.string().trim().length(2).optional(),
  region: z.string().trim().max(80).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  template: z.string().max(40).optional(),
  replaceDesign: z.boolean().optional(),
});

const embedSchema = z.object({
  name: z.string().trim().min(1).max(80),
  currency: z.string().trim().length(3).optional(),
  country: z.string().trim().length(2).optional(),
  region: z.string().trim().max(80).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  /** A store template whose sample products to add; null for none. */
  sample: z.string().max(40).nullable().default(null),
  placement: z.enum(["after-hero", "before-footer"]).default("after-hero"),
  categories: z.boolean().default(true),
});

const addressSchema = z.object({ line1: z.string().max(200), line2: z.string().max(200).optional(), city: z.string().max(80), region: z.string().max(80), postalCode: z.string().max(12), country: z.string().max(2) });

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.union([z.email(), z.literal("")]),
  phone: z.string().trim().max(30),
  currency: z.string().trim().length(3),
  country: z.string().trim().length(2),
  region: z.string().trim().max(80),
  address: addressSchema.nullable(),
  orderPrefix: z.string().trim().max(8),
  lowStockThreshold: z.number().int().min(0).max(10000),
  notifyEmails: z.array(z.email()).max(10),
  policies: z.object({ refund: z.string().max(20000), shipping: z.string().max(20000), privacy: z.string().max(20000), terms: z.string().max(20000) }).partial(),
  checkout: z.object({ requirePhone: z.boolean(), orderNotes: z.boolean(), termsRequired: z.boolean(), showTrustBadges: z.boolean(), announcement: z.string().max(200), returnDays: z.number().int().min(0).max(365) }).partial(),
});

const collectionSchema = z.object({ title: z.string().trim().min(1).max(80), slug: z.string().trim().max(80).optional(), description: z.string().max(2000).optional(), image: z.string().max(2000).optional(), sort: z.number().int().optional() });

const orderAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_paid") }),
  z.object({ action: z.literal("fulfill"), status: z.enum(["packed", "shipped", "delivered"]), carrier: z.string().max(40).optional(), trackingNumber: z.string().trim().max(80).optional(), notify: z.boolean().optional() }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(1).max(300), restock: z.boolean().optional() }),
  z.object({ action: z.literal("refund"), amount: z.number().int().min(1), reason: z.string().trim().max(300).default(""), restock: z.boolean().default(false) }),
  z.object({ action: z.literal("note"), note: z.string().trim().min(1).max(2000) }),
]);

const uuid = (v: string | undefined, what: string) => {
  if (!v || !z.uuid().safeParse(v).success) throw notFound(what);
  return v;
};

const qp = (ctx: AuthedContext) => new URL(ctx.req.url).searchParams;

async function requireStore(projectId: string): Promise<StoreRow> {
  const s = await getStore(projectId);
  if (!s) throw new ApiError("conflict", "Set up the store first");
  return s;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const method = ctx.req.method;
  const [section, id, sub] = slug;
  const key = `${method} ${section ?? ""}`;

  // Read-only views of the store are open to anyone who can manage it or its orders.
  const read = async () => {
    try {
      return await requireProject(ctx, projectId, "store:orders");
    } catch (e) {
      if ((e as ApiError).code === "forbidden") return requireProject(ctx, projectId, "store:manage");
      throw e;
    }
  };

  switch (key) {
    case "GET ": {
      await read();
      const store = await getStore(projectId);
      return { store, mailDelivery: mailConfigured(), templates: STORE_TEMPLATES.map(({ id, name, description, category, image, accent, storeName, signature }) => ({ id, name, description, category, image, accent, storeName, signature })) };
    }
    case "POST setup": {
      const { project, role } = await requireProject(ctx, projectId, "store:manage");
      const input = await readJson(ctx.req, setupSchema);
      if (input.template) {
        if (!(await requireProject(ctx, projectId, "design:write").catch(() => null))) throw new ApiError("forbidden", "Applying a template changes the site design");
        const out = await applyStoreTemplate(project, ctx.user.id, input.template, input);
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.template_applied", targetType: "project", targetId: projectId, metadata: { template: input.template }, ip: ctx.ip });
        return out;
      }
      const store = await setupStore(projectId, input);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.created", targetType: "project", targetId: projectId, ip: ctx.ip, metadata: { role } });
      return { store };
    }
    case "POST embed": {
      // Add the store to this project's existing website, in its own design.
      const { project, role } = await requireProject(ctx, projectId, "store:manage");
      if (!(await requireProject(ctx, projectId, "design:write").catch(() => null))) throw new ApiError("forbidden", "Adding the store changes the website's pages");
      const input = await readJson(ctx.req, embedSchema);
      const out = await embedStore(project, ctx.user.id, input);
      // A workspace that had the store switched off gets it back — if this person may change features.
      const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, project.orgId));
      if (org?.modules && !org.modules.includes("store") && can(role as Parameters<typeof can>[0], "org:update")) {
        await db.update(schema.organizations).set({ modules: [...org.modules, "store"] }).where(eq(schema.organizations.id, project.orgId));
      }
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.embedded", targetType: "project", targetId: projectId, ip: ctx.ip, metadata: { sample: input.sample, placement: input.placement } });
      return out;
    }
    case "PUT settings": {
      const { project } = await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      const s = await readJson(ctx.req, settingsSchema);
      const [store] = await db
        .update(schema.stores)
        .set({ ...s, currency: s.currency.toUpperCase(), country: s.country.toUpperCase(), updatedAt: new Date() })
        .where(eq(schema.stores.projectId, projectId))
        .returning();
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.settings_updated", targetType: "project", targetId: projectId, ip: ctx.ip });
      return { store };
    }

    case "PUT currencies": {
      // Extra currencies shoppers can pay in, at the store's own exchange rates.
      const { project } = await requireProject(ctx, projectId, "store:manage");
      const store = await requireStore(projectId);
      const { currencies } = await readJson(
        ctx.req,
        z.object({
          currencies: z
            .array(z.object({ code: z.string().length(3).transform((c) => c.toUpperCase()), rate: z.string().regex(/^\d{1,7}(\.\d{1,8})?$/, "Use a positive number like 0.012"), rounding: z.enum(["none", "whole", "x.99", "x.95"]) }))
            .max(10),
        }),
      );
      const codes = currencies.map((c) => c.code);
      if (codes.includes(store.currency)) throw new ApiError("validation_failed", `${store.currency} is already the store's currency`);
      if (new Set(codes).size !== codes.length) throw new ApiError("validation_failed", "Each currency can be added once");
      if (currencies.some((c) => !CURRENCIES.some((x) => x.code === c.code))) throw new ApiError("validation_failed", "Unsupported currency");
      if (currencies.some((c) => !(Number(c.rate) > 0))) throw new ApiError("validation_failed", "Rates must be greater than zero");
      const [updated] = await db.update(schema.stores).set({ currencies, currencyRatesUpdatedAt: new Date(), updatedAt: new Date() }).where(eq(schema.stores.projectId, projectId)).returning();
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.currencies_updated", targetType: "project", targetId: projectId, metadata: { codes } });
      return { store: updated };
    }

    case "GET catalog": {
      // Live products for commerce sections in the builder canvas.
      await read();
      return { catalog: await loadCatalog(projectId) };
    }

    case "GET insights": {
      await read();
      await requireStore(projectId);
      await releaseExpired(projectId);
      const days = Math.min(Math.max(Number(qp(ctx).get("days")) || 30, 1), 365);
      return storeInsights(projectId, days);
    }

    // ─── Catalog ───
    case "GET products": {
      await read();
      if (id) return { product: await getProduct(projectId, uuid(id, "Product")) };
      const p = qp(ctx);
      const status = p.get("status");
      return { products: await loadProducts(projectId, { q: p.get("q")?.slice(0, 80) || undefined, status: status === "draft" || status === "active" || status === "archived" ? status : undefined, collectionId: p.get("collection") && z.uuid().safeParse(p.get("collection")).success ? p.get("collection")! : undefined }) };
    }
    case "POST products": {
      if (id === "from-photo") {
        // Draft a listing from one photo (not saved: the owner reviews it in the editor).
        const { project } = await requireProject(ctx, projectId, "store:manage");
        await requireProject(ctx, projectId, "design:write"); // the photo is kept as a site asset
        await rateLimit(`photo-listing:${ctx.user.id}`, 40, 3600_000);
        if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_PHOTO + 64 * 1024) throw new ApiError("payload_too_large", "Photos are limited to 5 MB");
        const file = (await ctx.req.formData()).get("file");
        if (!(file instanceof File)) throw new ApiError("validation_failed", "Choose a photo", { file: ["Required"] });
        return listingFromPhoto(project, ctx.user.id, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
      }
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      const input = await readJson(ctx.req, productSchema);
      const pid = await saveProduct(projectId, ctx.user.id, input);
      return Response.json({ product: await getProduct(projectId, pid) }, { status: 201 });
    }
    case "PUT products": {
      await requireProject(ctx, projectId, "store:manage");
      const pid = uuid(id, "Product");
      await getProduct(projectId, pid);
      const input = await readJson(ctx.req, productSchema);
      await saveProduct(projectId, ctx.user.id, input, pid);
      return { product: await getProduct(projectId, pid) };
    }
    case "DELETE products": {
      const { project } = await requireProject(ctx, projectId, "store:manage");
      return deleteProduct(projectId, uuid(id, "Product"), ctx.user.id, project.orgId);
    }
    case "GET collections": {
      await read();
      return { collections: await listCollections(projectId) };
    }
    case "POST collections":
    case "PUT collections": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      const input = await readJson(ctx.req, collectionSchema);
      const c = await saveCollection(projectId, input, method === "PUT" ? uuid(id, "Collection") : undefined);
      return Response.json({ collection: c }, { status: method === "POST" ? 201 : 200 });
    }
    case "DELETE collections": {
      await requireProject(ctx, projectId, "store:manage");
      await deleteCollection(projectId, uuid(id, "Collection"));
      return { ok: true };
    }
    case "GET inventory": {
      await read();
      if (id && sub === "history") return { history: await inventoryHistory(projectId, uuid(id, "Variant")) };
      const p = qp(ctx);
      return listInventory(projectId, { q: p.get("q")?.slice(0, 80) || undefined, low: p.get("low") === "1" });
    }
    case "POST inventory": {
      await requireProject(ctx, projectId, "store:manage");
      const vid = uuid(id, "Variant");
      const body = await readJson(ctx.req, z.object({ mode: z.enum(["add", "set"]), quantity: z.number().int().min(-1_000_000).max(10_000_000), reason: z.string().trim().max(120).default("") }));
      const [v] = await db.select({ stock: schema.storeVariants.stock, projectId: schema.storeVariants.projectId }).from(schema.storeVariants).where(eq(schema.storeVariants.id, vid));
      if (!v || v.projectId !== projectId) throw notFound("Variant");
      const delta = body.mode === "set" ? body.quantity - v.stock : body.quantity;
      await adjustStock(projectId, vid, delta, body.reason || (body.mode === "set" ? "Stock count" : delta > 0 ? "Received stock" : "Removed stock"), ctx.user.id, null);
      return { stock: v.stock + delta };
    }
    case "GET export": {
      await read();
      const s = await requireStore(projectId);
      return new Response(await exportCsv(projectId, minorDigits(s.currency)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="products.csv"' } });
    }
    case "POST import": {
      await requireProject(ctx, projectId, "store:manage");
      const s = await requireStore(projectId);
      await rateLimit(`store-import:${ctx.user.id}`, 20, 3600_000);
      // Smart import: products already read and mapped in the browser from any spreadsheet.
      if (id === "smart") {
        const body = await readJson(ctx.req, z.object({ products: z.array(draftProductSchema).min(1).max(2000), catalogue: z.object({ title: z.string().trim().max(120).default("") }).nullable().default(null) }));
        const { ids, ...result } = await importDraftProducts(projectId, ctx.user.id, body.products);
        // Optionally, a catalogue of exactly these products, ready to share.
        const catalogue = body.catalogue ? await catalogueFromImport(projectId, ctx.user.id, ids, body.catalogue.title) : null;
        return { ...result, catalogue: catalogue ? { id: catalogue.id, title: catalogue.title, url: catalogue.url } : null };
      }
      const body = await readJson(ctx.req, z.object({ csv: z.string().min(1).max(1_900_000) }));
      return importCsv(projectId, ctx.user.id, body.csv, minorDigits(s.currency));
    }

    // ─── Catalogues ───
    case "GET catalogues": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      if (!id) return { catalogues: await listCatalogues(projectId), checkout: await checkoutReadiness(projectId) };
      return getCatalogue(projectId, id);
    }
    case "POST catalogues": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      if (!id) return { catalogue: await createCatalogue(projectId, ctx.user.id, await readJson(ctx.req, z.record(z.string(), z.unknown()))) };
      if (sub === "duplicate") return { catalogue: await duplicateCatalogue(projectId, ctx.user.id, id) };
      if (sub === "rotate") return { catalogue: await rotateCatalogueLink(projectId, id) };
      if (sub === "shared") {
        const body = await readJson(ctx.req, z.object({ via: z.enum(SHARE_CHANNELS) }));
        await recordShare(projectId, id, body.via);
        return { ok: true };
      }
      throw notFound("Route");
    }
    case "PUT catalogues": {
      await requireProject(ctx, projectId, "store:manage");
      if (!id) throw notFound("Catalogue");
      return { catalogue: await updateCatalogue(projectId, id, await readJson(ctx.req, z.record(z.string(), z.unknown()))) };
    }
    case "DELETE catalogues": {
      await requireProject(ctx, projectId, "store:manage");
      if (!id) throw notFound("Catalogue");
      await deleteCatalogue(projectId, id);
      return { ok: true };
    }

    // ─── Orders ───
    case "GET orders": {
      await requireProject(ctx, projectId, "store:orders");
      const ids = (qp(ctx).get("ids") ?? "").split(",").filter((x) => z.uuid().safeParse(x).success).slice(0, 200);
      if (id === "export") return new Response(await exportOrdersCsv(projectId, ids.length ? ids : undefined), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="orders.csv"' } });
      if (id === "slips") return new Response(await packingSlipsHtml(projectId, ids), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      if (id && sub === "invoice") return new Response(await invoiceHtml(projectId, uuid(id, "Order")), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      if (id) return getOrder(projectId, uuid(id, "Order"));
      await releaseExpired(projectId);
      const p = qp(ctx);
      return listOrders(projectId, { q: p.get("q")?.slice(0, 80) || undefined, status: p.get("status") ?? undefined, limit: Number(p.get("limit")) || 50, offset: Number(p.get("offset")) || 0 });
    }
    case "POST orders": {
      if (id && (sub === "label-rates" || sub === "label-buy")) {
        const { project } = await requireProject(ctx, projectId, "store:orders");
        const oid = uuid(id, "Order");
        await rateLimit(`labels:${ctx.user.id}`, 60, 600_000);
        if (sub === "label-rates") {
          const body = await readJson(ctx.req, z.object({ provider: z.enum(LABEL_PROVIDERS), weightGrams: z.number().int().min(1).max(150_000).optional() }));
          return { shipment: await labelRates(projectId, oid, body.provider, body) };
        }
        const { rateId } = await readJson(ctx.req, z.object({ rateId: z.string().min(1).max(100) }));
        await buyLabel(projectId, oid, rateId, ctx.user.id);
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.label_bought", targetType: "order", targetId: oid, ip: ctx.ip });
        return getOrder(projectId, oid);
      }
      if (id && (sub === "ship-book" || sub === "ship-sync")) {
        const { project } = await requireProject(ctx, projectId, "store:orders");
        const oid = uuid(id, "Order");
        await rateLimit(`ship:${ctx.user.id}`, 60, 600_000);
        if (sub === "ship-book") {
          const body = await readJson(ctx.req, z.object({ courierId: z.number().int().positive().optional(), weightGrams: z.number().int().min(1).max(100000).optional() }));
          await bookShipment(projectId, oid, ctx.user.id, body);
          await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.shipment_booked", targetType: "order", targetId: oid, ip: ctx.ip });
        } else await syncShipment(projectId, oid, ctx.user.id);
        return getOrder(projectId, oid);
      }
      if (id === "bulk") {
        const { project } = await requireProject(ctx, projectId, "store:orders");
        const body = await readJson(ctx.req, z.object({ ids: z.array(z.uuid()).min(1).max(200), action: z.enum(["packed", "delivered"]) }));
        const done: string[] = [];
        const failed: { id: string; error: string }[] = [];
        for (const oid of body.ids) {
          try {
            await updateFulfillment(projectId, oid, ctx.user.id, { status: body.action, notify: true });
            done.push(oid);
          } catch (e) {
            failed.push({ id: oid, error: (e as Error).message });
          }
        }
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: `store.orders_bulk_${body.action}`, targetType: "project", targetId: projectId, metadata: { count: done.length }, ip: ctx.ip });
        return { done, failed };
      }
      const oid = uuid(id, "Order");
      const body = await readJson(ctx.req, orderAction);
      const { project } = await requireProject(ctx, projectId, body.action === "refund" ? "store:refund" : "store:orders");
      if (body.action === "mark_paid") await manualMarkPaid(projectId, oid, ctx.user.id);
      else if (body.action === "fulfill") await updateFulfillment(projectId, oid, ctx.user.id, body);
      else if (body.action === "cancel") await cancelOrder(projectId, oid, ctx.user.id, body.reason, { restock: body.restock });
      else if (body.action === "refund") {
        await rateLimit(`refund:${ctx.user.id}`, 30, 3600_000);
        await refundOrder(projectId, oid, ctx.user.id, body.amount, body.reason, body.restock);
      } else await addOrderNote(projectId, oid, ctx.user.id, body.note);
      if (body.action !== "note") await audit({ orgId: project.orgId, actorId: ctx.user.id, action: `store.order_${body.action}`, targetType: "order", targetId: oid, ip: ctx.ip });
      return getOrder(projectId, oid);
    }

    // ─── Customers ───
    case "GET customers": {
      await requireProject(ctx, projectId, "store:orders");
      if (id === "export") return new Response(await exportCustomersCsv(projectId), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="customers.csv"' } });
      if (id) return getCustomer(projectId, uuid(id, "Customer"));
      const p = qp(ctx);
      return listCustomers(projectId, { q: p.get("q")?.slice(0, 80) || undefined, offset: Number(p.get("offset")) || 0 });
    }
    case "GET abandoned": {
      await requireProject(ctx, projectId, "store:orders");
      return { carts: await abandonedCarts(projectId) };
    }
    case "POST abandoned": {
      await requireProject(ctx, projectId, "store:orders");
      await rateLimit(`recover:${projectId}`, 200, 86400_000);
      await sendReminderNow(projectId, uuid(id, "Cart"), sub === "whatsapp" ? "whatsapp" : "email");
      return { ok: true };
    }
    case "GET recovery":
      await requireProject(ctx, projectId, "store:orders");
      return getRecovery(projectId);
    case "PUT recovery":
      await requireProject(ctx, projectId, "store:manage");
      return saveRecovery(projectId, await readJson(ctx.req, z.record(z.string(), z.unknown())));

    // ─── Marketing & settings ───
    case "GET discounts": {
      await read();
      return { discounts: await listDiscounts(projectId) };
    }
    case "POST discounts":
    case "PUT discounts": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      const d = await saveDiscount(projectId, await readJson(ctx.req, discountSchema), method === "PUT" ? uuid(id, "Discount") : undefined);
      return Response.json({ discount: d }, { status: method === "POST" ? 201 : 200 });
    }
    case "DELETE discounts": {
      await requireProject(ctx, projectId, "store:manage");
      await deleteDiscount(projectId, uuid(id, "Discount"));
      return { ok: true };
    }
    case "GET shipping": {
      await read();
      return getShipping(projectId);
    }
    case "PUT shipping": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      return saveShipping(projectId, await readJson(ctx.req, shippingSchema));
    }
    case "GET taxes": {
      await read();
      return getTaxes(projectId);
    }
    case "PUT taxes": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      return saveTaxes(projectId, await readJson(ctx.req, taxSchema));
    }
    case "GET payments": {
      await read();
      if (id && sub === "tests") {
        if (slug[3]) return { test: await getTest(projectId, uuid(slug[3], "Payment test")) };
        return { tests: (await listTests(projectId)).filter((t) => t.provider === id) };
      }
      return { providers: await listPaymentProviders(projectId) };
    }
    case "PUT payments":
    case "POST payments": {
      // Payment credentials are secrets: only owners and admins may change them.
      const { project } = await requireProject(ctx, projectId, "secrets:manage");
      await requireStore(projectId);
      const info = providerInfo(id ?? "");
      if (!info) throw notFound("Provider");
      await rateLimit(`payments:${ctx.user.id}`, 30, 600_000);
      if (method === "POST" && sub === "test") return retestProvider(projectId, info.id as ProviderId);
      // Live payment test: real provider sandbox, passes only on a signed webhook.
      if (method === "POST" && sub === "preflight") {
        const { checks, ready } = await preflight(projectId, info.id as ProviderId);
        return { checks, ready, webhookUrl: webhookUrlFor(projectId, info.id) };
      }
      if (method === "POST" && sub === "tests" && !slug[3]) {
        const r = await startTest(projectId, info.id as ProviderId, { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name });
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.payment_test_started", targetType: "provider", targetId: info.id, metadata: { testId: r.test.id, amount: r.test.amount, currency: r.test.currency }, ip: ctx.ip });
        return r;
      }
      if (method === "POST" && sub === "tests" && slug[4] === "check") return { test: await askProvider(projectId, uuid(slug[3], "Payment test")) };
      if (method === "POST" && sub === "tests" && slug[4] === "refund") return { test: await refundTest(projectId, uuid(slug[3], "Payment test")) };
      if (method === "POST") throw notFound("Route");
      const input = await readJson(ctx.req, providerUpdateSchema);
      await saveProvider(projectId, info.id as ProviderId, input);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.payment_provider_updated", targetType: "provider", targetId: info.id, metadata: { enabled: input.enabled, credentialsChanged: !!input.credentials }, ip: ctx.ip });
      return { providers: await listPaymentProviders(projectId) };
    }
    // ─── Point of sale ───
    case "GET pos": {
      const { project: proj } = await requireProject(ctx, projectId, "store:orders");
      await requireStore(projectId);
      if (id === "lookup") return { match: await lookupCode(projectId, String(qp(ctx).get("code") ?? "").slice(0, 500)) };
      if (id === "summary") {
        const day = qp(ctx).get("day");
        const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : new Date();
        const tz = Math.max(-840, Math.min(840, Number(qp(ctx).get("tz")) || 0));
        return posSummary(projectId, d, tz);
      }
      if (id === "receipt") {
        const [org] = proj.productionDeploymentId ? await db.select({ slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, proj.orgId)) : [];
        const siteUrl = org ? appUrl(`/s/${org.slug}/${proj.slug}`) : undefined;
        return new Response(await receiptHtml(projectId, uuid(sub, "Order"), { siteUrl }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
      const [org] = proj.productionDeploymentId ? await db.select({ slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, proj.orgId)) : [];
      return { ...(await posCatalog(projectId)), siteUrl: org ? appUrl(`/s/${org.slug}/${proj.slug}`) : null };
    }
    case "POST pos": {
      const { role } = await requireProject(ctx, projectId, "store:orders");
      await requireStore(projectId);
      if (id !== "sale") throw notFound("Route");
      await rateLimit(`pos:${ctx.user.id}`, 600, 3600_000);
      const input = await readJson(ctx.req, posSaleSchema);
      // Changing a price at the till needs catalog rights.
      if (input.lines.some((l) => l.unitPrice !== undefined) && !can(role, "store:manage")) throw new ApiError("forbidden", "Only people who manage the catalog can change prices at the till");
      const r = await posSale(projectId, { id: ctx.user.id, name: ctx.user.name }, input);
      return Response.json(r, { status: r.duplicate ? 200 : 201 });
    }
    case "POST barcodes": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      const body = await readJson(ctx.req, z.object({ productIds: z.array(z.uuid()).max(2000).optional() }));
      return assignBarcodes(projectId, body.productIds);
    }
    // ─── Gift cards ───
    case "GET giftcards": {
      await read();
      if (id) return giftCardDetail(projectId, uuid(id, "Gift card"));
      return { giftCards: await listGiftCards(projectId) };
    }
    case "POST giftcards": {
      // Gift cards are money: the same people who can refund may issue them.
      const { project } = await requireProject(ctx, projectId, "store:refund");
      await requireStore(projectId);
      await rateLimit(`giftcard-issue:${ctx.user.id}`, 100, 3600_000);
      const body = await readJson(ctx.req, z.object({ value: z.number().int().min(1).max(100_000_000), code: z.string().trim().max(32).optional(), recipientEmail: z.union([z.email(), z.literal("")]).optional(), note: z.string().max(500).optional(), expiresAt: z.string().datetime().nullable().optional(), sendEmail: z.boolean().optional() }));
      const card = await issueGiftCard(projectId, ctx.user.id, body);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.gift_card_issued", targetType: "gift_card", targetId: card.id, metadata: { value: card.initialValue }, ip: ctx.ip });
      return Response.json({ giftCard: card }, { status: 201 });
    }
    case "PUT giftcards": {
      const { project } = await requireProject(ctx, projectId, "store:refund");
      const body = await readJson(ctx.req, z.object({ disabled: z.boolean() }));
      const card = await setGiftCardDisabled(projectId, uuid(id, "Gift card"), body.disabled);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: body.disabled ? "store.gift_card_disabled" : "store.gift_card_enabled", targetType: "gift_card", targetId: card.id, ip: ctx.ip });
      return { giftCard: card };
    }

    // ─── Subscriptions ───
    case "GET subscriptions": {
      await requireProject(ctx, projectId, "store:orders");
      return { subscriptions: await listSubscriptions(projectId) };
    }
    case "POST subscriptions": {
      const { project } = await requireProject(ctx, projectId, "store:orders");
      if (sub !== "cancel") throw notFound("Route");
      const sid = uuid(id, "Subscription");
      const [row] = await db.select().from(schema.storeSubscriptions).where(and(eq(schema.storeSubscriptions.id, sid), eq(schema.storeSubscriptions.projectId, projectId)));
      if (!row) throw notFound("Subscription");
      const p = await providerCreds(projectId, row.provider);
      if (!p) throw new ApiError("provider_not_configured", "The payment provider for this subscription isn't connected");
      await cancelStoreSubscription(projectId, sid, p.creds, "staff");
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.subscription_cancelled", targetType: "subscription", targetId: sid, ip: ctx.ip });
      return { ok: true };
    }

    // ─── Returns ───
    case "GET returns": {
      await requireProject(ctx, projectId, "store:orders");
      const status = qp(ctx).get("status");
      return { returns: await listReturns(projectId, status && ["requested", "approved", "rejected", "received", "refunded"].includes(status) ? status : undefined) };
    }
    case "PUT returns": {
      await requireProject(ctx, projectId, "store:orders");
      const body = await readJson(ctx.req, z.object({ status: z.enum(["approved", "rejected", "received", "refunded"]), resolution: z.string().trim().max(1000).optional(), restock: z.boolean().optional(), notify: z.boolean().optional() }));
      await updateReturn(projectId, uuid(id, "Return"), ctx.user.id, body);
      return { ok: true };
    }

    // ─── Shipping integrations ───
    case "GET integrations": {
      await read();
      if (id === "whatsapp") return { whatsapp: await getWhatsApp(projectId), messages: await listMessages(projectId) };
      if (id === "labels") return { providers: await getLabelProviders(projectId) };
      if (id !== "shiprocket") throw notFound("Integration");
      return { shiprocket: await getShiprocket(projectId) };
    }
    case "POST integrations": {
      // Test message to a number of the owner's choice.
      await requireProject(ctx, projectId, "secrets:manage");
      if (id !== "whatsapp" || sub !== "test") throw notFound("Route");
      await rateLimit(`wa-test:${ctx.user.id}`, 10, 3600_000);
      const s = await requireStore(projectId);
      const body = await readJson(ctx.req, z.object({ to: z.string().max(20), event: z.enum(["order_confirmation", "order_shipped", "order_delivered", "cart_reminder"]) }));
      return sendTestMessage(projectId, body.to, body.event, s.country);
    }
    case "PUT integrations": {
      const { project } = await requireProject(ctx, projectId, "secrets:manage");
      if (id === "whatsapp") {
        await rateLimit(`integrations:${ctx.user.id}`, 30, 600_000);
        const s = await requireStore(projectId);
        const out = await saveWhatsApp(projectId, await readJson(ctx.req, whatsappUpdateSchema), s.country);
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.integration_updated", targetType: "integration", targetId: "whatsapp", ip: ctx.ip });
        return { whatsapp: out };
      }
      if (id === "easypost" || id === "shippo") {
        await rateLimit(`integrations:${ctx.user.id}`, 30, 600_000);
        const out = await saveLabelProvider(projectId, id, await readJson(ctx.req, labelUpdateSchema));
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.integration_updated", targetType: "integration", targetId: id, ip: ctx.ip });
        return { provider: out };
      }
      if (id !== "shiprocket") throw notFound("Integration");
      await rateLimit(`integrations:${ctx.user.id}`, 30, 600_000);
      const out = await saveShiprocket(projectId, await readJson(ctx.req, shiprocketUpdateSchema));
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.integration_updated", targetType: "integration", targetId: "shiprocket", ip: ctx.ip });
      return { shiprocket: out };
    }
    case "POST shipments": {
      await requireProject(ctx, projectId, "store:orders");
      await rateLimit(`ship-sync:${projectId}`, 30, 600_000);
      return { synced: await syncOpenShipments(projectId) };
    }

    // ─── Digital files & members ───
    case "GET files": {
      await read();
      return { files: await listDigitalFiles(projectId) };
    }
    case "POST files": {
      const { project } = await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      await rateLimit(`digital-upload:${ctx.user.id}`, 30, 3600_000);
      if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_DIGITAL_BYTES + 64 * 1024) throw new ApiError("payload_too_large", "Files for sale are limited to 25 MB");
      const form = await ctx.req.formData().catch(() => null);
      const f = form?.get("file");
      if (!(f instanceof File)) throw new ApiError("validation_failed", "Choose a file to upload", { file: ["Required"] });
      return Response.json({ file: await uploadDigitalFile(project, ctx.user.id, f.name, Buffer.from(await f.arrayBuffer())) }, { status: 201 });
    }
    case "GET members": {
      await requireProject(ctx, projectId, "store:orders");
      return { members: await listMembers(projectId) };
    }
    case "POST members": {
      const { project } = await requireProject(ctx, projectId, "store:orders");
      if (id && sub === "revoke") {
        await revokeMembership(projectId, uuid(id, "Membership"));
        await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.member_revoked", targetType: "membership", targetId: id, ip: ctx.ip });
        return { ok: true };
      }
      const body = await readJson(ctx.req, z.object({ email: z.email(), name: z.string().trim().max(120).default(""), days: z.number().int().min(1).max(3650).nullable() }));
      const m = await grantMembership(projectId, body);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "store.member_added", targetType: "membership", targetId: m.id, ip: ctx.ip });
      return Response.json({ member: m }, { status: 201 });
    }

    // ─── GST ───
    case "GET gst": {
      await requireProject(ctx, projectId, "store:orders");
      const p = qp(ctx);
      const report = await gstReport(projectId, p.get("month") ?? "");
      if (id === "csv") {
        const section = p.get("section") ?? "";
        if (!["b2b", "b2cl", "b2cs", "hsn", "cdn"].includes(section)) throw notFound("Section");
        return new Response(gstCsv(report, section as "b2b"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gst-${section}-${report.month}.csv"` } });
      }
      return report;
    }

    // ─── Bookings ───
    case "GET bookings": {
      await read();
      const p = qp(ctx);
      const from = p.get("from") ? new Date(p.get("from")!) : new Date(Date.now() - 86400_000);
      const to = p.get("to") ? new Date(p.get("to")!) : new Date(from.getTime() + 31 * 86400_000);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() - from.getTime() > 400 * 86400_000) throw new ApiError("validation_failed", "Invalid date range");
      await releaseExpiredBookings();
      return { bookings: await listBookings(projectId, from, to), services: await listServices(projectId), settings: await getBookingSettings(projectId) };
    }
    case "POST bookings": {
      await requireProject(ctx, projectId, "store:orders");
      const body = await readJson(ctx.req, z.object({ action: z.enum(["cancel", "completed", "no_show", "paid_at_visit"]), reason: z.string().trim().max(300).optional() }));
      const bid = uuid(id, "Booking");
      if (body.action === "cancel") await cancelBooking(projectId, bid, { staff: true }, body.reason || "Cancelled by the business");
      else await setBookingStatus(projectId, bid, body.action);
      return { ok: true };
    }
    case "POST booking-services":
    case "PUT booking-services": {
      await requireProject(ctx, projectId, "store:manage");
      await requireStore(projectId);
      const svc = await saveService(projectId, await readJson(ctx.req, serviceSchema), method === "PUT" ? uuid(id, "Service") : undefined);
      return Response.json({ service: svc }, { status: method === "POST" ? 201 : 200 });
    }
    case "DELETE booking-services": {
      await requireProject(ctx, projectId, "store:manage");
      await deleteService(projectId, uuid(id, "Service"));
      return { ok: true };
    }
    case "PUT booking-settings": {
      await requireProject(ctx, projectId, "store:manage");
      return { settings: await saveBookingSettings(projectId, await readJson(ctx.req, bookingSettingsSchema)) };
    }

    case "GET reviews": {
      await read();
      const status = qp(ctx).get("status");
      return { reviews: await listReviews(projectId, status === "pending" || status === "approved" || status === "rejected" ? status : undefined) };
    }
    case "PUT reviews": {
      await requireProject(ctx, projectId, "store:manage");
      const body = await readJson(ctx.req, z.object({ status: z.enum(["approved", "rejected", "pending"]) }));
      await moderateReview(projectId, uuid(id, "Review"), body.status);
      return { ok: true };
    }
    case "DELETE reviews": {
      await requireProject(ctx, projectId, "store:manage");
      await deleteReview(projectId, uuid(id, "Review"));
      return { ok: true };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
