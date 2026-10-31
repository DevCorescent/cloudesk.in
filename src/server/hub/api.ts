// The workspace's ERP API, for other systems: bearer keys with scopes, an
// optional Cloudesk-Version header (the answer always names its version),
// cursor pages of up to 100, a rate limit per key, and a log of every call.
import { and, asc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, schema } from "@/db";
import { API_VERSIONS, CURRENT_VERSION, decodeCursor, encodeCursor, ERP_EVENTS, ERP_SCOPES, type ErpScope } from "@/lib/hub/model";
import { isOn, type ModuleId } from "@/lib/workspace/modules";
import { ApiError, notFound } from "../http/errors";
import { errorResponse } from "../http/handler";
import { rateLimit } from "../security/rate-limit";
import { resolveKey } from "./core";

type Key = NonNullable<Awaited<ReturnType<typeof resolveKey>>>;

function need(k: Key, scope: ErpScope) {
  if (!k.scopes.includes(scope)) throw new ApiError("forbidden", `This key doesn't have the ${scope} permission`);
}
async function moduleOn(orgId: string, m: ModuleId) {
  const [o] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(o?.modules, m)) throw new ApiError("forbidden", `The ${m} module is switched off in this workspace`);
}

const msOf = (col: AnyPgColumn) => sql`date_trunc('milliseconds', ${col})`;
const pageQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(200).optional() });
/** One page: rows after the cursor in (created, id) order, and the cursor for the next. */
async function page<T extends { createdAt: Date; id: string }>(q: URLSearchParams, run: (after: SQL, limit: number) => Promise<T[]>, created: AnyPgColumn, idCol: AnyPgColumn, map: (r: T) => unknown) {
  const p = pageQuery.safeParse(Object.fromEntries(q));
  if (!p.success) throw new ApiError("validation_failed", p.error.issues[0]?.message ?? "Check the query");
  const c = q.get("cursor") ? decodeCursor(q.get("cursor")) : null;
  if (q.get("cursor") && !c) throw new ApiError("validation_failed", "That cursor isn't valid");
  // Compared at millisecond precision, which is what the cursor (a JS date) can hold.
  const ms = sql`date_trunc('milliseconds', ${created})`;
  const after = c ? or(sql`${ms} > ${c.at}`, and(sql`${ms} = ${c.at}`, gt(idCol, c.id)))! : sql`true`;
  const rows = await run(after, p.data.limit + 1);
  const more = rows.length > p.data.limit;
  const data = rows.slice(0, p.data.limit);
  return { data: data.map(map), next_cursor: more ? encodeCursor(data[data.length - 1].createdAt, data[data.length - 1].id) : null };
}

async function body(req: Request) {
  const t = await req.text();
  if (t.length > 64_000) throw new ApiError("payload_too_large", "Bodies are limited to 64 KB");
  try {
    return JSON.parse(t || "{}");
  } catch {
    throw new ApiError("bad_request", "Send JSON");
  }
}

async function route(req: Request, k: Key, path: string[]) {
  const [res] = path;
  const q = new URL(req.url).searchParams;
  const key = `${req.method} ${res ?? ""}`;
  switch (key) {
    case "GET contacts": {
      need(k, "contacts:read");
      await moduleOn(k.orgId, "crm");
      const C = schema.crmContacts;
      return page(q, (after, limit) => db.select().from(C).where(and(eq(C.orgId, k.orgId), after)).orderBy(asc(msOf(C.createdAt)), asc(C.id)).limit(limit), C.createdAt, C.id, (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, title: c.title, company_id: c.companyId, lifecycle: c.lifecycle, created_at: c.createdAt }));
    }
    case "POST contacts": {
      need(k, "contacts:write");
      await moduleOn(k.orgId, "crm");
      const { systemScope } = await import("../crm/access");
      const { createContact } = await import("../crm/contacts");
      const v = z.object({ name: z.string().max(120).default(""), email: z.string().max(320).default(""), phone: z.string().max(30).default(""), title: z.string().max(120).default(""), companyName: z.string().max(120).default("") }).parse(await body(req));
      const c = await createContact(await systemScope(k.orgId), { ...v, source: "api" });
      return { data: { id: c.id, name: c.name, email: c.email, phone: c.phone, created_at: c.createdAt } };
    }
    case "GET deals": {
      need(k, "deals:read");
      await moduleOn(k.orgId, "crm");
      const D = schema.crmDeals;
      return page(q, (after, limit) => db.select().from(D).where(and(eq(D.orgId, k.orgId), after)).orderBy(asc(msOf(D.createdAt)), asc(D.id)).limit(limit), D.createdAt, D.id, (d) => ({ id: d.id, title: d.title, value_paise: d.value, status: d.status, stage_id: d.stageId, contact_id: d.contactId, expected_close: d.expectedClose, created_at: d.createdAt }));
    }
    case "GET items": {
      need(k, "items:read");
      await moduleOn(k.orgId, "inventory");
      const I = schema.invItems;
      const out = await page(q, (after, limit) => db.select().from(I).where(and(eq(I.orgId, k.orgId), after)).orderBy(asc(msOf(I.createdAt)), asc(I.id)).limit(limit), I.createdAt, I.id, (i) => ({ id: i.id, name: i.name, sku: i.sku, unit: i.unit, gst_rate: i.gstRate, active: i.active, created_at: i.createdAt }));
      const ids = (out.data as { id: string }[]).map((x) => x.id);
      const stock = ids.length ? ((await db.execute(sql`select item_id, sum(qty)::float as qty from inv_stock where item_id = any(${`{${ids.join(",")}}`}::uuid[]) group by 1`)) as unknown as { rows: { item_id: string; qty: number }[] }).rows : [];
      return { ...out, data: (out.data as { id: string }[]).map((x) => ({ ...x, on_hand: stock.find((s) => s.item_id === x.id)?.qty ?? 0 })) };
    }
    case "GET suppliers": {
      need(k, "suppliers:read");
      await moduleOn(k.orgId, "inventory");
      const S = schema.invSuppliers;
      return page(q, (after, limit) => db.select().from(S).where(and(eq(S.orgId, k.orgId), after)).orderBy(asc(msOf(S.createdAt)), asc(S.id)).limit(limit), S.createdAt, S.id, (s) => ({ id: s.id, name: s.name, gstin: s.gstin, email: s.email, phone: s.phone, state: s.state, active: s.active, created_at: s.createdAt }));
    }
    case "GET sales-orders": {
      need(k, "sales_orders:read");
      await moduleOn(k.orgId, "sales");
      const O = schema.salesOrders;
      return page(q, (after, limit) => db.select().from(O).where(and(eq(O.orgId, k.orgId), after)).orderBy(asc(msOf(O.createdAt)), asc(O.id)).limit(limit), O.createdAt, O.id, (o) => ({ id: o.id, number: o.number, date: o.date, client_id: o.clientId, client_name: o.clientName, status: o.status, total_paise: o.total, lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, rate_paise: l.rate, delivered: l.delivered })), created_at: o.createdAt }));
    }
    case "GET bills": {
      need(k, "bills:read");
      await moduleOn(k.orgId, "accounting");
      const B = schema.accBills;
      return page(q, (after, limit) => db.select().from(B).where(and(eq(B.orgId, k.orgId), after)).orderBy(asc(msOf(B.createdAt)), asc(B.id)).limit(limit), B.createdAt, B.id, (b) => ({ id: b.id, number: b.number, supplier_bill_no: b.billNo, supplier_id: b.supplierId, supplier_name: b.supplierName, date: b.date, due_date: b.dueDate, kind: b.kind, total_paise: b.total, paid_paise: b.amountPaid, status: b.status, created_at: b.createdAt }));
    }
    case "GET tickets": {
      need(k, "tickets:read");
      await moduleOn(k.orgId, "helpdesk");
      const T = schema.hdTickets;
      return page(q, (after, limit) => db.select().from(T).where(and(eq(T.orgId, k.orgId), after)).orderBy(asc(msOf(T.createdAt)), asc(T.id)).limit(limit), T.createdAt, T.id, (t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, channel: t.channel, customer_name: t.customerName, customer_email: t.customerEmail, created_at: t.createdAt }));
    }
    case "POST tickets": {
      need(k, "tickets:write");
      await moduleOn(k.orgId, "helpdesk");
      const v = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().max(20_000).default(""), customer_name: z.string().max(120).default(""), customer_email: z.union([z.email(), z.literal("")]).default(""), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), acknowledge: z.boolean().default(false) }).parse(await body(req));
      const { intake } = await import("../helpdesk/core");
      const t = await intake(k.orgId, { subject: v.subject, body: v.body, name: v.customer_name, email: v.customer_email, channel: "api", priority: v.priority }, { acknowledge: v.acknowledge });
      return { data: { id: t.id, number: t.number, status: t.status, created_at: t.createdAt } };
    }
  }
  throw notFound("Endpoint");
}

/** Handle one ERP API request. */
export async function handleErp(req: Request, path: string[]) {
  const started = Date.now();
  const asked = req.headers.get("cloudesk-version");
  const version = asked ?? CURRENT_VERSION;
  const headers = { "Cloudesk-Version": version, "Cache-Control": "no-store" };
  let k: Key | null = null;
  let status = 500;
  try {
    if (path[0] === "openapi.json" && req.method === "GET") return Response.json(openapi(), { headers });
    if (asked && !(API_VERSIONS as readonly string[]).includes(asked)) throw new ApiError("bad_request", `Unknown Cloudesk-Version ${asked}. Supported: ${API_VERSIONS.join(", ")}`);
    k = await resolveKey((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null);
    if (!k) throw new ApiError("unauthenticated", "Send a valid workspace API key as: Authorization: Bearer ck_org_…");
    await rateLimit(`erp:${k.keyId}`, 600, 60_000);
    const data = await route(req, k, path);
    status = req.method === "POST" ? 201 : 200;
    return Response.json(data, { status, headers });
  } catch (err) {
    if (err instanceof z.ZodError) err = new ApiError("validation_failed", err.issues[0]?.message ?? "Check the body", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    const res = errorResponse(err);
    status = res.status;
    for (const [h, v] of Object.entries(headers)) res.headers.set(h, v);
    return res;
  } finally {
    if (k) await db.insert(schema.orgApiCalls).values({ orgId: k.orgId, keyId: k.keyId, method: req.method, path: `/${path.join("/")}`.slice(0, 200), status, version, ms: Date.now() - started }).catch(() => {});
  }
}

/** An OpenAPI description of the ERP API. */
export function openapi() {
  const list = (name: string, scope: ErpScope, props: Record<string, string>) => ({
    get: { summary: `List ${name}`, description: `Needs ${scope}. Oldest first; pass next_cursor as cursor for the next page.`, security: [{ key: [] }], parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, { name: "cursor", in: "query", schema: { type: "string" } }], responses: { 200: { description: "A page", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { type: "object", properties: Object.fromEntries(Object.entries(props).map(([k, t]) => [k, { type: t }])) } }, next_cursor: { type: ["string", "null"] } } } } } } } },
  });
  return {
    openapi: "3.1.0",
    info: { title: "Cloudesk ERP API", version: CURRENT_VERSION, description: `Workspace data for other systems. Authenticate with a workspace API key (Settings → Integrations) as a bearer token. Send Cloudesk-Version to pin a version (supported: ${API_VERSIONS.join(", ")}). Amounts are integers in paise. 600 requests a minute per key. Webhook events: ${Object.keys(ERP_EVENTS).join(", ")}.` },
    servers: [{ url: "/api/v1/erp" }],
    components: { securitySchemes: { key: { type: "http", scheme: "bearer", description: Object.entries(ERP_SCOPES).map(([k, v]) => `${k}: ${v}`).join("; ") } } },
    paths: {
      "/contacts": { ...list("contacts", "contacts:read", { id: "string", name: "string", email: "string", phone: "string", lifecycle: "string", created_at: "string" }), post: { summary: "Add a contact", description: "Needs contacts:write. 409 if the email or phone is already in the CRM.", security: [{ key: [] }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, title: { type: "string" }, companyName: { type: "string" } } } } } }, responses: { 201: { description: "Added" }, 409: { description: "Already in the CRM" } } } },
      "/deals": list("deals", "deals:read", { id: "string", title: "string", value_paise: "integer", status: "string", created_at: "string" }),
      "/items": list("items", "items:read", { id: "string", name: "string", sku: "string", unit: "string", on_hand: "number", created_at: "string" }),
      "/suppliers": list("suppliers", "suppliers:read", { id: "string", name: "string", gstin: "string", email: "string", created_at: "string" }),
      "/sales-orders": list("sales orders", "sales_orders:read", { id: "string", number: "string", status: "string", total_paise: "integer", created_at: "string" }),
      "/bills": list("supplier bills", "bills:read", { id: "string", number: "string", supplier_name: "string", total_paise: "integer", paid_paise: "integer", status: "string", created_at: "string" }),
      "/tickets": { ...list("tickets", "tickets:read", { id: "string", number: "string", subject: "string", status: "string", created_at: "string" }), post: { summary: "Open a ticket", description: "Needs tickets:write. Set acknowledge to email the customer their reference.", security: [{ key: [] }], requestBody: { content: { "application/json": { schema: { type: "object", required: ["subject"], properties: { subject: { type: "string" }, body: { type: "string" }, customer_name: { type: "string" }, customer_email: { type: "string" }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, acknowledge: { type: "boolean" } } } } } }, responses: { 201: { description: "Opened" } } } },
    },
  };
}
