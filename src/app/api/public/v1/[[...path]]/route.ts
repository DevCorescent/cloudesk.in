// Public REST API (v1). Authenticate with `Authorization: Bearer cc_live_…`.
// Server-to-server: no cookies and no CSRF checks; each key is limited to
// its project and scopes. The OpenAPI document is at /api/public/v1/openapi.json.
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { OPENAPI } from "@/lib/platform/openapi";
import type { ApiScope } from "@/lib/platform/events";
import { adjustStock, loadProducts } from "@/server/commerce/catalog";
import { updateFulfillment } from "@/server/commerce/orders";
import { ApiError, notFound } from "@/server/http/errors";
import { clientIp, errorResponse } from "@/server/http/handler";
import { dataApi } from "@/server/data/api";
import { resolveApiKey } from "@/server/platform/api-keys";
import { rateLimit } from "@/server/security/rate-limit";
import { appUrl } from "@/server/services/mail";

type Ctx = Awaited<ReturnType<typeof authenticate>>;

async function authenticate(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const k = await resolveApiKey(auth.startsWith("Bearer ") ? auth.slice(7).trim() : null);
  if (!k) throw new ApiError("unauthenticated", "Missing or invalid API key. Send Authorization: Bearer cc_live_…");
  await rateLimit(`api:${k.keyId}`, 600, 60_000);
  return k;
}

function need(ctx: Ctx, scope: ApiScope) {
  if (!ctx.scopes.includes(scope)) throw new ApiError("forbidden", `This key needs the "${scope}" permission`);
}

const page = (url: URL) => ({
  limit: Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50)),
  before: url.searchParams.get("before") ? new Date(url.searchParams.get("before")!) : null,
  since: url.searchParams.get("since") ? new Date(url.searchParams.get("since")!) : null,
});
const valid = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? d : null);
const next = <T extends { createdAt: Date }>(rows: T[], limit: number) => (rows.length === limit ? rows.at(-1)!.createdAt.toISOString() : null);

function productOut(p: Awaited<ReturnType<typeof loadProducts>>[number]) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    kind: p.kind,
    description: p.description,
    tags: p.tags,
    images: p.images,
    createdAt: p.createdAt,
    variants: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, price: v.price, compareAt: v.compareAt, trackInventory: v.trackInventory, stock: v.stock, options: v.options })),
  };
}

async function handle(req: Request, path: string[]) {
  const url = new URL(req.url);
  const route = `${req.method} ${path.map((p, i) => (i % 2 === 1 && !["variants", "fulfillment"].includes(p) ? ":id" : p)).join("/")}`;
  if (route === "GET openapi.json") return Response.json(OPENAPI);
  // Tables marked public: no key, any origin, rate-limited per address.
  if (path[0] === "p" && path[2] === "data") {
    if (!z.uuid().safeParse(path[1]).success) throw notFound("Project");
    await rateLimit(`data-anon:${clientIp(req) ?? "unknown"}`, req.method === "GET" ? 120 : 10, 60_000);
    const [p] = await db.select({ id: schema.projects.id, archivedAt: schema.projects.archivedAt }).from(schema.projects).where(eq(schema.projects.id, path[1]));
    if (!p || p.archivedAt) throw notFound("Project");
    const r = await dataApi(p.id, { kind: "anonymous" }, req.method, path.slice(3), url, () => req.json());
    return Response.json(r.body, { status: r.status, headers: CORS });
  }
  const ctx = await authenticate(req);
  const projectId = ctx.project.id;
  if (path[0] === "data") {
    const r = await dataApi(projectId, { kind: "key", scopes: ctx.scopes }, req.method, path.slice(1), url, () => req.json());
    return Response.json(r.body, { status: r.status });
  }
  switch (route) {
    case "GET project": {
      need(ctx, "project:read");
      const [org] = await db.select({ slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.id, ctx.project.orgId));
      return { id: ctx.project.id, name: ctx.project.name, liveUrl: ctx.project.productionDeploymentId ? appUrl(`/s/${org.slug}/${ctx.project.slug}`) : null };
    }
    case "GET products": {
      need(ctx, "products:read");
      const status = url.searchParams.get("status");
      const rows = await loadProducts(projectId, status && ["draft", "active", "archived"].includes(status) ? { status: status as "active" } : undefined);
      return { data: rows.map(productOut) };
    }
    case "GET products/:id": {
      need(ctx, "products:read");
      if (!z.uuid().safeParse(path[1]).success) throw notFound("Product");
      const [p] = await loadProducts(projectId, { ids: [path[1]] });
      if (!p) throw notFound("Product");
      return productOut(p);
    }
    case "PATCH products/:id/variants/:id": {
      need(ctx, "products:write");
      const [, productId, , variantId] = path;
      if (!z.uuid().safeParse(productId).success || !z.uuid().safeParse(variantId).success) throw notFound("Variant");
      const body = z.object({ stock: z.number().int().min(0).max(10_000_000).optional(), price: z.number().int().min(0).max(1_000_000_000).optional(), sku: z.string().max(80).optional() }).parse(await req.json());
      const [v] = await db.select().from(schema.storeVariants).where(and(eq(schema.storeVariants.id, variantId), eq(schema.storeVariants.productId, productId), eq(schema.storeVariants.projectId, projectId)));
      if (!v) throw notFound("Variant");
      if (body.stock !== undefined) await adjustStock(projectId, v.id, body.stock - v.stock, "Set through the API", null, `api:${ctx.keyId.slice(0, 8)}`);
      if (body.price !== undefined || body.sku !== undefined) await db.update(schema.storeVariants).set({ ...(body.price !== undefined ? { price: body.price } : {}), ...(body.sku !== undefined ? { sku: body.sku } : {}) }).where(eq(schema.storeVariants.id, v.id));
      const [after] = await db.select().from(schema.storeVariants).where(eq(schema.storeVariants.id, v.id));
      return { id: after.id, stock: after.stock, price: after.price, sku: after.sku };
    }
    case "GET orders": {
      need(ctx, "orders:read");
      const p = page(url);
      const status = url.searchParams.get("financialStatus");
      const rows = await db
        .select()
        .from(schema.storeOrders)
        .where(and(eq(schema.storeOrders.projectId, projectId), valid(p.before) ? lt(schema.storeOrders.createdAt, p.before!) : undefined, valid(p.since) ? gte(schema.storeOrders.createdAt, p.since!) : undefined, status ? sql`${schema.storeOrders.financialStatus}::text = ${status}` : undefined))
        .orderBy(desc(schema.storeOrders.createdAt))
        .limit(p.limit);
      return { data: rows.map(orderOut), nextBefore: next(rows, p.limit) };
    }
    case "GET orders/:id": {
      need(ctx, "orders:read");
      const n = Number(path[1]);
      const [o] = Number.isInteger(n) ? await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, n))) : [];
      if (!o) throw notFound("Order");
      const items = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id));
      return { ...orderOut(o), items: items.map((i) => ({ title: i.title, variant: i.variantTitle, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })) };
    }
    case "POST orders/:id/fulfillment": {
      need(ctx, "orders:write");
      const n = Number(path[1]);
      const [o] = Number.isInteger(n) ? await db.select({ id: schema.storeOrders.id }).from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, n))) : [];
      if (!o) throw notFound("Order");
      const body = z.object({ status: z.enum(["packed", "shipped", "delivered"]), carrier: z.string().max(40).optional(), trackingNumber: z.string().max(80).optional(), notifyCustomer: z.boolean().default(true) }).parse(await req.json());
      await updateFulfillment(projectId, o.id, null, { status: body.status, carrier: body.carrier, trackingNumber: body.trackingNumber, notify: body.notifyCustomer });
      const [after] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, o.id));
      return orderOut(after);
    }
    case "GET submissions": {
      need(ctx, "submissions:read");
      const p = page(url);
      const formId = url.searchParams.get("formId");
      const rows = await db
        .select({ id: schema.formSubmissions.id, formId: schema.formSubmissions.formId, data: schema.formSubmissions.data, createdAt: schema.formSubmissions.createdAt })
        .from(schema.formSubmissions)
        .where(and(eq(schema.formSubmissions.projectId, projectId), formId ? eq(schema.formSubmissions.formId, formId) : undefined, valid(p.before) ? lt(schema.formSubmissions.createdAt, p.before!) : undefined, valid(p.since) ? gte(schema.formSubmissions.createdAt, p.since!) : undefined))
        .orderBy(desc(schema.formSubmissions.createdAt))
        .limit(p.limit);
      return { data: rows, nextBefore: next(rows, p.limit) };
    }
    case "GET bookings": {
      need(ctx, "bookings:read");
      const p = page(url);
      const rows = await db
        .select({ id: schema.bookings.id, service: schema.bookings.serviceName, status: schema.bookings.status, startsAt: schema.bookings.startsAt, endsAt: schema.bookings.endsAt, name: schema.bookings.name, email: schema.bookings.email, phone: schema.bookings.phone, notes: schema.bookings.notes, amount: schema.bookings.amount, currency: schema.bookings.currency, paid: schema.bookings.paid, createdAt: schema.bookings.createdAt })
        .from(schema.bookings)
        .where(and(eq(schema.bookings.projectId, projectId), valid(p.before) ? lt(schema.bookings.createdAt, p.before!) : undefined, valid(p.since) ? gte(schema.bookings.createdAt, p.since!) : undefined))
        .orderBy(desc(schema.bookings.createdAt))
        .limit(p.limit);
      return { data: rows, nextBefore: next(rows, p.limit) };
    }
  }
  throw notFound("Endpoint");
}

function orderOut(o: typeof schema.storeOrders.$inferSelect) {
  const addr = o.shippingAddress as Record<string, string>;
  return {
    number: o.number,
    email: o.email,
    customerName: addr?.name ?? "",
    shippingAddress: addr,
    currency: o.currency,
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    shippingTotal: o.shippingTotal,
    taxTotal: o.taxTotal,
    total: o.total,
    refundedTotal: o.refundedTotal,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    paymentMethod: o.paymentMethod,
    tracking: o.tracking,
    invoiceNumber: o.invoiceNumber,
    cancelledAt: o.cancelledAt,
    createdAt: o.createdAt,
  };
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" };

async function entry(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const path = (await params).path ?? [];
  const anon = path[0] === "p";
  const withCors = (res: Response) => {
    if (anon) for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  };
  try {
    const out = await handle(req, path);
    const res = out instanceof Response ? out : Response.json(out);
    res.headers.set("Cache-Control", "no-store");
    return withCors(res);
  } catch (err) {
    if (err instanceof z.ZodError) return withCors(errorResponse(new ApiError("validation_failed", "Invalid request body", Object.fromEntries(err.issues.map((i) => [i.path.join(".") || "body", [i.message]])))));
    if (err instanceof SyntaxError) return withCors(errorResponse(new ApiError("validation_failed", "The body is not valid JSON")));
    return withCors(errorResponse(err));
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export const GET = entry;
export const POST = entry;
export const PATCH = entry;
export const DELETE = entry;
