# @creation-cloud/sdk

Typed client for the Cloudesk public API, webhook verification, and app (plugin) manifests. No dependencies; runs on Node 18+, Deno, Bun and edge runtimes.

## API

```ts
import { CreationCloud } from "@creation-cloud/sdk";

const cc = new CreationCloud({ apiKey: process.env.CC_API_KEY!, baseUrl: "https://your-host/api/public/v1" });

const { data: products } = await cc.products.list({ status: "active" });
await cc.products.updateVariant(products[0].id, products[0].variants[0].id, { stock: 25 });

for await (const order of cc.orders.all({ since: "2026-10-01T00:00:00Z" })) {
  if (order.financialStatus === "paid" && order.fulfillmentStatus === "unfulfilled") {
    await cc.orders.fulfill(order.number, { status: "shipped", carrier: "delhivery", trackingNumber: "DL123" });
  }
}
```

Keys are created in **Project → Integrations → API keys** with only the permissions you choose. Rate limit: 600 requests per minute per key (the client retries 429 and 5xx twice). The full OpenAPI document is at `/api/public/v1/openapi.json`.

## Webhooks

```ts
import { verifyWebhook } from "@creation-cloud/sdk";

export async function POST(req: Request) {
  const raw = await req.text(); // the raw body, before JSON.parse
  const event = await verifyWebhook(process.env.CC_WEBHOOK_SECRET!, raw, req.headers.get("CC-Signature"));
  if (event.type === "order.paid") { /* … */ }
  return new Response(null, { status: 204 });
}
```

Deliveries are retried with backoff for about a day when your endpoint doesn't answer 2xx. Answer `410 Gone` to switch the endpoint off. Use `event.id` to ignore duplicates.

## Apps

An app is a manifest registered in **Organization → Apps**. Installing it into a project creates an API key with the app's scopes and a webhook subscription to its events, then POSTs an `app.installed` hand-off (signed with the app secret) to `installUrl`:

```ts
import { defineApp, verifyWebhook, type InstallHandoff } from "@creation-cloud/sdk";

export const manifest = defineApp({
  name: "Stock sync",
  slug: "stock-sync",
  scopes: ["products:read", "products:write"],
  events: ["order.paid"],
  webhookUrl: "https://stock-sync.example.com/events",
  installUrl: "https://stock-sync.example.com/install",
  configFields: [{ key: "warehouse", label: "Warehouse code", type: "text", required: true }],
});

// installUrl handler
const handoff = await verifyWebhook<InstallHandoff>(process.env.APP_SECRET!, raw, req.headers.get("CC-Signature"));
// Store handoff.data.apiKey and handoff.data.webhookSecret for handoff.data.projectId.
```

If `installUrl` doesn't answer 2xx, the install is rolled back. Uninstalling revokes the key and subscription immediately and POSTs `app.uninstalled` to `uninstallUrl`.
