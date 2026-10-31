// OpenAPI 3.1 description of the public API (served at /api/public/v1/openapi.json).
import { API_SCOPES, EVENT_TYPES, SCOPE_INFO } from "./events";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const list = (item: string) => ({ type: "object", properties: { data: { type: "array", items: ref(item) }, nextBefore: { type: ["string", "null"], format: "date-time", description: "Pass as ?before= for the next page" } } });
const paging = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "before", in: "query", schema: { type: "string", format: "date-time" }, description: "Only items created before this time (for paging)" },
  { name: "since", in: "query", schema: { type: "string", format: "date-time" }, description: "Only items created at or after this time" },
];
const ok = (schema: object, scope: string) => ({ security: [{ bearer: [scope] }], responses: { "200": { description: "OK", content: { "application/json": { schema } } }, "401": ref401, "403": ref403, "404": ref404, "429": ref429 } });
const ref401 = { description: "Missing or invalid API key", content: { "application/json": { schema: ref("Error") } } };
const ref403 = { description: "The key lacks the required permission", content: { "application/json": { schema: ref("Error") } } };
const ref404 = { description: "Not found", content: { "application/json": { schema: ref("Error") } } };
const ref429 = { description: "Rate limited (600 requests per minute per key)", content: { "application/json": { schema: ref("Error") } } };

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Cloudesk public API",
    version: "1.0.0",
    description:
      "Read and update a project's store, orders, form submissions and bookings. Create keys in Project → Integrations → API keys. Amounts are integers in the currency's minor unit (e.g. paise). Webhooks are signed with `CC-Signature: t=<unix>,v1=<HMAC-SHA256(secret, \"<t>.<body>\")>`.",
  },
  servers: [{ url: "/api/public/v1" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: `API key (cc_live_…). Scopes: ${API_SCOPES.map((s) => `${s} — ${SCOPE_INFO[s]}`).join("; ")}` } },
    schemas: {
      Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "object" } } } } },
      Variant: { type: "object", properties: { id: { type: "string", format: "uuid" }, title: { type: "string" }, sku: { type: "string" }, price: { type: "integer" }, compareAt: { type: ["integer", "null"] }, trackInventory: { type: "boolean" }, stock: { type: "integer" }, options: { type: "object" } } },
      Product: { type: "object", properties: { id: { type: "string", format: "uuid" }, title: { type: "string" }, slug: { type: "string" }, status: { enum: ["draft", "active", "archived"] }, kind: { enum: ["physical", "digital", "membership"] }, description: { type: "string" }, tags: { type: "array", items: { type: "string" } }, images: { type: "array" }, createdAt: { type: "string", format: "date-time" }, variants: { type: "array", items: ref("Variant") } } },
      Order: {
        type: "object",
        properties: {
          number: { type: "integer" },
          email: { type: "string" },
          customerName: { type: "string" },
          shippingAddress: { type: "object" },
          currency: { type: "string" },
          subtotal: { type: "integer" },
          discountTotal: { type: "integer" },
          shippingTotal: { type: "integer" },
          taxTotal: { type: "integer" },
          total: { type: "integer" },
          refundedTotal: { type: "integer" },
          financialStatus: { type: "string" },
          fulfillmentStatus: { type: "string" },
          paymentMethod: { type: "string" },
          tracking: { type: ["object", "null"] },
          invoiceNumber: { type: ["string", "null"] },
          cancelledAt: { type: ["string", "null"], format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Submission: { type: "object", properties: { id: { type: "string" }, formId: { type: "string" }, data: { type: "object" }, createdAt: { type: "string", format: "date-time" } } },
      Booking: { type: "object", properties: { id: { type: "string" }, service: { type: "string" }, status: { type: "string" }, startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" }, name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, amount: { type: "integer" }, currency: { type: "string" }, paid: { type: "boolean" } } },
      Event: { type: "object", properties: { id: { type: "string" }, type: { enum: [...EVENT_TYPES] }, createdAt: { type: "string", format: "date-time" }, projectId: { type: "string" }, data: { type: "object" } } },
    },
  },
  paths: {
    "/project": { get: { summary: "The project this key belongs to", ...ok({ type: "object", properties: { id: { type: "string" }, name: { type: "string" }, liveUrl: { type: ["string", "null"] } } }, "project:read") } },
    "/products": { get: { summary: "List products", parameters: [{ name: "status", in: "query", schema: { enum: ["draft", "active", "archived"] } }], ...ok({ type: "object", properties: { data: { type: "array", items: ref("Product") } } }, "products:read") } },
    "/products/{id}": { get: { summary: "Get a product", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], ...ok(ref("Product"), "products:read") } },
    "/products/{productId}/variants/{variantId}": {
      patch: {
        summary: "Set stock, price or SKU of a variant",
        parameters: [
          { name: "productId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "variantId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { stock: { type: "integer", minimum: 0 }, price: { type: "integer", minimum: 0 }, sku: { type: "string" } } } } } },
        ...ok(ref("Variant"), "products:write"),
      },
    },
    "/orders": { get: { summary: "List orders, newest first", parameters: [...paging, { name: "financialStatus", in: "query", schema: { type: "string" } }], ...ok(list("Order"), "orders:read") } },
    "/orders/{number}": { get: { summary: "Get an order with its items", parameters: [{ name: "number", in: "path", required: true, schema: { type: "integer" } }], ...ok(ref("Order"), "orders:read") } },
    "/orders/{number}/fulfillment": {
      post: {
        summary: "Mark an order packed, shipped or delivered",
        parameters: [{ name: "number", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["status"], properties: { status: { enum: ["packed", "shipped", "delivered"] }, carrier: { type: "string" }, trackingNumber: { type: "string" }, notifyCustomer: { type: "boolean", default: true } } } } } },
        ...ok(ref("Order"), "orders:write"),
      },
    },
    "/submissions": { get: { summary: "List form submissions", parameters: [...paging, { name: "formId", in: "query", schema: { enum: ["contact", "booking", "newsletter"] } }], ...ok(list("Submission"), "submissions:read") } },
    "/bookings": { get: { summary: "List bookings", parameters: paging, ...ok(list("Booking"), "bookings:read") } },
  },
  webhooks: Object.fromEntries(EVENT_TYPES.map((t) => [t, { post: { summary: t, requestBody: { content: { "application/json": { schema: ref("Event") } } }, responses: { "2XX": { description: "Received" } } } }])),
};
