// @creation-cloud/sdk — typed client for the public API, webhook signature
// verification and app manifests. No dependencies; works in Node 18+, Deno,
// Bun and edge runtimes (uses fetch and Web Crypto).

export type ApiScope = "project:read" | "products:read" | "products:write" | "orders:read" | "orders:write" | "submissions:read" | "bookings:read";
export type EventType = "order.placed" | "order.paid" | "order.shipped" | "order.cancelled" | "form.submitted" | "booking.confirmed" | "booking.cancelled" | "webhook.test";

export type Variant = { id: string; title: string; sku: string; price: number; compareAt: number | null; trackInventory: boolean; stock: number; options: Record<string, string> };
export type Product = { id: string; title: string; slug: string; status: "draft" | "active" | "archived"; kind: string; description: string; tags: string[]; images: unknown[]; createdAt: string; variants: Variant[] };
export type Order = {
  number: number;
  email: string;
  customerName: string;
  shippingAddress: Record<string, string>;
  currency: string;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  total: number;
  refundedTotal: number;
  financialStatus: string;
  fulfillmentStatus: string;
  paymentMethod: string;
  tracking: { carrier: string; number: string; url: string } | null;
  invoiceNumber: string | null;
  cancelledAt: string | null;
  createdAt: string;
  items?: { title: string; variant: string; sku: string; quantity: number; unitPrice: number; total: number }[];
};
export type Submission = { id: string; formId: string; data: Record<string, string>; createdAt: string };
export type Booking = { id: string; service: string; status: string; startsAt: string; endsAt: string; name: string; email: string; phone: string; notes: string; amount: number; currency: string; paid: boolean; createdAt: string };
export type Page<T> = { data: T[]; nextBefore: string | null };
export type ListParams = { limit?: number; before?: string; since?: string };
export type Event<T = Record<string, unknown>> = { id: string; type: EventType; createdAt: string; projectId: string; data: T };

export class CreationCloudError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CreationCloudError";
  }
}

type Options = { apiKey: string; baseUrl?: string; fetch?: typeof fetch; maxRetries?: number };

export class CreationCloud {
  private base: string;
  private f: typeof fetch;
  private retries: number;

  constructor(private opts: Options) {
    if (!opts.apiKey?.startsWith("cc_live_")) throw new Error("Pass an API key that starts with cc_live_");
    this.base = (opts.baseUrl ?? "https://app.creation.cloud/api/public/v1").replace(/\/$/, "");
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.retries = opts.maxRetries ?? 2;
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = query ? Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
    for (let attempt = 0; ; attempt++) {
      const res = await this.f(`${this.base}${path}${qs ? `?${qs}` : ""}`, {
        method,
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      // Rate limits and server errors are retried with backoff.
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: Record<string, unknown> } } | null;
      if (!res.ok) throw new CreationCloudError(res.status, json?.error?.code ?? "http_error", json?.error?.message ?? `HTTP ${res.status}`, json?.error?.details);
      return json as T;
    }
  }

  project() {
    return this.request<{ id: string; name: string; liveUrl: string | null }>("GET", "/project");
  }

  products = {
    list: (params: { status?: "draft" | "active" | "archived" } = {}) => this.request<{ data: Product[] }>("GET", "/products", undefined, params),
    get: (id: string) => this.request<Product>("GET", `/products/${id}`),
    updateVariant: (productId: string, variantId: string, patch: { stock?: number; price?: number; sku?: string }) => this.request<Pick<Variant, "id" | "stock" | "price" | "sku">>("PATCH", `/products/${productId}/variants/${variantId}`, patch),
  };

  orders = {
    list: (params: ListParams & { financialStatus?: string } = {}) => this.request<Page<Order>>("GET", "/orders", undefined, params),
    get: (number: number) => this.request<Order>("GET", `/orders/${number}`),
    fulfill: (number: number, body: { status: "packed" | "shipped" | "delivered"; carrier?: string; trackingNumber?: string; notifyCustomer?: boolean }) => this.request<Order>("POST", `/orders/${number}/fulfillment`, body),
    /** Iterates every order, following pages. */
    all: (params: Omit<ListParams, "before"> & { financialStatus?: string } = {}) => this.paginate<Order>((before) => this.orders.list({ ...params, before })),
  };

  private async *paginate<T>(load: (before?: string) => Promise<Page<T>>): AsyncGenerator<T> {
    let before: string | undefined;
    do {
      const page = await load(before);
      yield* page.data;
      before = page.nextBefore ?? undefined;
    } while (before);
  }

  submissions = {
    list: (params: ListParams & { formId?: "contact" | "booking" | "newsletter" } = {}) => this.request<Page<Submission>>("GET", "/submissions", undefined, params),
  };

  bookings = {
    list: (params: ListParams = {}) => this.request<Page<Booking>>("GET", "/bookings", undefined, params),
  };
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const toHex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a webhook or app hand-off and returns the parsed event.
 * Pass the raw request body (not re-serialized JSON) and the CC-Signature header.
 * Throws if the signature is wrong or older than `toleranceSec` (default 5 minutes).
 */
export async function verifyWebhook<T = Record<string, unknown>>(secret: string, rawBody: string, signatureHeader: string | null, opts: { toleranceSec?: number; now?: number } = {}): Promise<Event<T>> {
  const parts = Object.fromEntries((signatureHeader ?? "").split(",").map((kv) => kv.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) throw new Error("Missing or malformed CC-Signature header");
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? 300)) throw new Error("Webhook timestamp is outside the tolerance window");
  if (!timingSafeEqual(await hmacHex(secret, `${t}.${rawBody}`), parts.v1)) throw new Error("Webhook signature does not match");
  return JSON.parse(rawBody) as Event<T>;
}

// ─── Apps ────────────────────────────────────────────────────────────────────

export type ConfigField = { key: string; label: string; type: "text" | "secret" | "select" | "boolean"; required?: boolean; options?: string[]; help?: string };
export type AppManifest = {
  name: string;
  slug: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  icon?: string;
  scopes?: ApiScope[];
  events?: EventType[];
  webhookUrl?: string;
  installUrl?: string;
  uninstallUrl?: string;
  configFields?: ConfigField[];
};

/** Identity helper that type-checks a manifest. */
export const defineApp = (m: AppManifest) => m;

/** What your installUrl receives (verify it with your app secret). */
export type InstallHandoff = { type: "app.installed"; installId: string; projectId: string; projectName: string; apiBase: string; apiKey: string | null; scopes: ApiScope[]; webhookSecret: string | null; events: EventType[]; config: Record<string, unknown> };
