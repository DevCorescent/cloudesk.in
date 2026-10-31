// Payment gateways behind one interface. Online providers use hosted checkout
// pages (redirect), so published sites need no JavaScript and card data never
// touches this platform. A browser redirect is never treated as proof of
// payment: every return is verified server-side with the provider, and
// webhooks are signature-checked and de-duplicated.
import { createHmac, timingSafeEqual } from "node:crypto";
import { minorDigits, toMajor } from "@/lib/store/money";
import { ApiError } from "../http/errors";

export type ProviderId = "stripe" | "razorpay" | "paypal" | "cod" | "manual";

export type ProviderField = { key: string; label: string; secret: boolean; placeholder?: string; help?: string };

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  description: string;
  methods: string[];
  regions: string;
  online: boolean;
  fields: ProviderField[];
  docsUrl?: string;
  refunds: "api" | "manual";
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "razorpay",
    name: "Razorpay",
    description: "UPI, cards, netbanking and wallets for India via Razorpay Payment Links.",
    methods: ["UPI", "Cards", "Netbanking", "Wallets"],
    regions: "India (INR)",
    online: true,
    fields: [
      { key: "keyId", label: "Key ID", secret: false, placeholder: "rzp_test_…" },
      { key: "keySecret", label: "Key secret", secret: true },
      { key: "webhookSecret", label: "Webhook secret", secret: true, help: "Optional. Set the same secret on the webhook in the Razorpay dashboard (event: payment_link.paid)." },
    ],
    docsUrl: "https://razorpay.com/docs/payments/payment-links/apis/",
    refunds: "api",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Cards, Apple Pay, Google Pay and local methods through Stripe Checkout.",
    methods: ["Cards", "Apple Pay", "Google Pay"],
    regions: "Global",
    online: true,
    fields: [
      { key: "secretKey", label: "Secret key", secret: true, placeholder: "sk_test_…" },
      { key: "webhookSecret", label: "Webhook signing secret", secret: true, placeholder: "whsec_…", help: "Optional. Add a webhook for checkout.session.completed pointing at the URL shown below." },
    ],
    docsUrl: "https://docs.stripe.com/payments/checkout",
    refunds: "api",
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "PayPal balance and cards through PayPal Checkout.",
    methods: ["PayPal", "Cards"],
    regions: "Global (INR only for India-registered accounts)",
    online: true,
    fields: [
      { key: "clientId", label: "Client ID", secret: false },
      { key: "clientSecret", label: "Client secret", secret: true },
      { key: "webhookId", label: "Webhook ID", secret: false, help: "Optional. Used to verify PAYMENT.CAPTURE.COMPLETED webhooks." },
    ],
    docsUrl: "https://developer.paypal.com/docs/api/orders/v2/",
    refunds: "api",
  },
  {
    id: "cod",
    name: "Cash on delivery",
    description: "Customers pay the courier on delivery. You confirm payment when it arrives.",
    methods: ["Cash", "UPI on delivery"],
    regions: "Anywhere your shipping rates allow it",
    online: false,
    fields: [],
    refunds: "manual",
  },
  {
    id: "manual",
    name: "Bank transfer / UPI",
    description: "Show your UPI ID or bank details after checkout. You mark orders paid once the money arrives.",
    methods: ["UPI", "Bank transfer"],
    regions: "Anywhere",
    online: false,
    fields: [],
    refunds: "manual",
  },
];

export const providerInfo = (id: string) => PROVIDERS.find((p) => p.id === id);

// Injectable for tests.
type Fetch = typeof fetch;
let http: Fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
export function setPaymentHttp(f: Fetch) {
  http = f;
}
/** The same (test-injectable) transport, for subscription calls. */
export const providerHttp: Fetch = (input, init) => http(input, init);

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const hmac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

export type PayOrder = { id: string; number: number; label: string; total: number; currency: string; email: string; phone: string; name: string };
export type Creds = Record<string, string>;

async function json(res: Response, provider: string) {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (body as { error?: { message?: string; description?: string }; message?: string } | null)?.error?.message ?? (body as { error?: { description?: string } })?.error?.description ?? (body as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw new ApiError("provider_error", `${provider}: ${msg}`);
  }
  return body as Record<string, unknown>;
}

// ─── Stripe ──────────────────────────────────────────────────────────────────

const stripeAuth = (c: Creds) => ({ Authorization: `Bearer ${c.secretKey}` });

export const stripe = {
  async test(c: Creds) {
    await json(await http("https://api.stripe.com/v1/balance", { headers: stripeAuth(c) }), "Stripe");
  },
  async create(c: Creds, o: PayOrder, urls: { success: string; cancel: string }) {
    const body = new URLSearchParams({
      mode: "payment",
      success_url: urls.success,
      cancel_url: urls.cancel,
      client_reference_id: o.id,
      customer_email: o.email,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": o.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(o.total),
      "line_items[0][price_data][product_data][name]": o.label,
      "metadata[order_id]": o.id,
      "payment_intent_data[metadata][order_id]": o.id,
    });
    const s = await json(await http("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { ...stripeAuth(c), "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `order-${o.id}` }, body }), "Stripe");
    return { redirectUrl: String(s.url), ref: String(s.id) };
  },
  async verify(c: Creds, ref: string, o: PayOrder) {
    const s = await json(await http(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(ref)}`, { headers: stripeAuth(c) }), "Stripe");
    const paid = s.payment_status === "paid" && Number(s.amount_total) === o.total && String(s.currency).toUpperCase() === o.currency;
    return { paid, captureRef: s.payment_intent ? String(s.payment_intent) : undefined };
  },
  /** Verifies the Stripe-Signature header (t=…,v1=…) with a 5-minute tolerance. */
  webhook(c: Creds, raw: string, headers: Headers, now = Date.now()) {
    if (!c.webhookSecret) throw new ApiError("forbidden", "Webhook secret not configured");
    const sig = headers.get("stripe-signature") ?? "";
    const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=") as [string, string]));
    const t = Number(parts.t);
    const v1s = sig.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
    if (!t || !v1s.length || Math.abs(now / 1000 - t) > 300) throw new ApiError("forbidden", "Invalid signature");
    const expected = hmac(c.webhookSecret, `${t}.${raw}`);
    if (!v1s.some((v) => safeEq(v, expected))) throw new ApiError("forbidden", "Invalid signature");
    const evt = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
    if (evt.type !== "checkout.session.completed") return { eventId: evt.id };
    const obj = evt.data.object;
    return { eventId: evt.id, ref: String(obj.id), paid: obj.payment_status === "paid", amount: Number(obj.amount_total), captureRef: obj.payment_intent ? String(obj.payment_intent) : undefined };
  },
  async refund(c: Creds, captureRef: string, amount: number) {
    const r = await json(await http("https://api.stripe.com/v1/refunds", { method: "POST", headers: { ...stripeAuth(c), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ payment_intent: captureRef, amount: String(amount) }) }), "Stripe");
    return String(r.id);
  },
};

// ─── Razorpay ────────────────────────────────────────────────────────────────

const rzpAuth = (c: Creds) => ({ Authorization: `Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64")}` });

export const razorpay = {
  async test(c: Creds) {
    await json(await http("https://api.razorpay.com/v1/payments?count=1", { headers: rzpAuth(c) }), "Razorpay");
  },
  async create(c: Creds, o: PayOrder, urls: { success: string; cancel: string }) {
    const l = await json(
      await http("https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: { ...rzpAuth(c), "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: o.total,
          currency: o.currency,
          reference_id: o.id,
          description: o.label,
          customer: { name: o.name, email: o.email, contact: o.phone || undefined },
          notify: { sms: false, email: false },
          reminder_enable: false,
          callback_url: urls.success,
          callback_method: "get",
          notes: { order_id: o.id },
        }),
      }),
      "Razorpay",
    );
    return { redirectUrl: String(l.short_url), ref: String(l.id) };
  },
  /** Checks the callback signature, then confirms status with the API. */
  async verify(c: Creds, ref: string, o: PayOrder, params: URLSearchParams) {
    const linkId = params.get("razorpay_payment_link_id") ?? "";
    const refId = params.get("razorpay_payment_link_reference_id") ?? "";
    const status = params.get("razorpay_payment_link_status") ?? "";
    const paymentId = params.get("razorpay_payment_id") ?? "";
    const sig = params.get("razorpay_signature") ?? "";
    if (linkId && sig) {
      const expected = hmac(c.keySecret, `${linkId}|${refId}|${status}|${paymentId}`);
      if (!safeEq(sig, expected) || linkId !== ref) return { paid: false };
    }
    const l = await json(await http(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(ref)}`, { headers: rzpAuth(c) }), "Razorpay");
    const payments = (l.payments as { payment_id: string; status: string }[] | null) ?? [];
    const captured = payments.find((p) => p.status === "captured")?.payment_id ?? (paymentId || undefined);
    return { paid: l.status === "paid" && Number(l.amount_paid ?? l.amount) >= o.total, captureRef: captured };
  },
  webhook(c: Creds, raw: string, headers: Headers) {
    if (!c.webhookSecret) throw new ApiError("forbidden", "Webhook secret not configured");
    const sig = headers.get("x-razorpay-signature") ?? "";
    if (!sig || !safeEq(sig, hmac(c.webhookSecret, raw))) throw new ApiError("forbidden", "Invalid signature");
    const evt = JSON.parse(raw) as { event: string; payload: { payment_link?: { entity: { id: string; status: string; amount_paid: number } }; payment?: { entity: { id: string } } } };
    const eventId = headers.get("x-razorpay-event-id") ?? hmac("id", raw).slice(0, 32);
    if (evt.event !== "payment_link.paid" || !evt.payload.payment_link) return { eventId };
    const link = evt.payload.payment_link.entity;
    return { eventId, ref: link.id, paid: link.status === "paid", amount: link.amount_paid, captureRef: evt.payload.payment?.entity.id };
  },
  async refund(c: Creds, captureRef: string, amount: number) {
    const r = await json(await http(`https://api.razorpay.com/v1/payments/${encodeURIComponent(captureRef)}/refund`, { method: "POST", headers: { ...rzpAuth(c), "Content-Type": "application/json" }, body: JSON.stringify({ amount }) }), "Razorpay");
    return String(r.id);
  },
};

// ─── PayPal ──────────────────────────────────────────────────────────────────

const ppBase = (mode: string) => (mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
const ppValue = (minor: number, currency: string) => toMajor(minor, currency).toFixed(minorDigits(currency));

async function ppToken(c: Creds, mode: string) {
  const r = await json(
    await http(`${ppBase(mode)}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }),
    "PayPal",
  );
  return String(r.access_token);
}

export const paypal = {
  async test(c: Creds, mode: string) {
    await ppToken(c, mode);
  },
  async create(c: Creds, o: PayOrder, urls: { success: string; cancel: string }, mode: string, brand: string) {
    const token = await ppToken(c, mode);
    const r = await json(
      await http(`${ppBase(mode)}/v2/checkout/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `order-${o.id}` },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{ reference_id: o.id, custom_id: o.id, description: o.label, amount: { currency_code: o.currency, value: ppValue(o.total, o.currency) } }],
          application_context: { return_url: urls.success, cancel_url: urls.cancel, brand_name: brand.slice(0, 120), user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" },
        }),
      }),
      "PayPal",
    );
    const approve = (r.links as { rel: string; href: string }[]).find((l) => l.rel === "approve" || l.rel === "payer-action");
    if (!approve) throw new ApiError("provider_error", "PayPal did not return an approval link");
    return { redirectUrl: approve.href, ref: String(r.id) };
  },
  /** Captures server-side on return; only a COMPLETED capture of the full amount counts. */
  async verify(c: Creds, ref: string, o: PayOrder, _params: URLSearchParams, mode: string) {
    const token = await ppToken(c, mode);
    const r = await json(await http(`${ppBase(mode)}/v2/checkout/orders/${encodeURIComponent(ref)}/capture`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `capture-${o.id}` } }), "PayPal");
    const cap = (r.purchase_units as { payments?: { captures?: { id: string; status: string; amount: { value: string; currency_code: string } }[] } }[])?.[0]?.payments?.captures?.[0];
    const paid = r.status === "COMPLETED" && cap?.status === "COMPLETED" && cap.amount.value === ppValue(o.total, o.currency) && cap.amount.currency_code === o.currency;
    return { paid, captureRef: cap?.id };
  },
  async webhook(c: Creds, raw: string, headers: Headers, mode: string) {
    if (!c.webhookId) throw new ApiError("forbidden", "Webhook ID not configured");
    const token = await ppToken(c, mode);
    const v = await json(
      await http(`${ppBase(mode)}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_algo: headers.get("paypal-auth-algo"),
          cert_url: headers.get("paypal-cert-url"),
          transmission_id: headers.get("paypal-transmission-id"),
          transmission_sig: headers.get("paypal-transmission-sig"),
          transmission_time: headers.get("paypal-transmission-time"),
          webhook_id: c.webhookId,
          webhook_event: JSON.parse(raw),
        }),
      }),
      "PayPal",
    );
    if (v.verification_status !== "SUCCESS") throw new ApiError("forbidden", "Invalid signature");
    const evt = JSON.parse(raw) as { id: string; event_type: string; resource: { id: string; status: string; supplementary_data?: { related_ids?: { order_id?: string } } } };
    if (evt.event_type !== "PAYMENT.CAPTURE.COMPLETED") return { eventId: evt.id };
    return { eventId: evt.id, ref: evt.resource.supplementary_data?.related_ids?.order_id, paid: evt.resource.status === "COMPLETED", captureRef: evt.resource.id };
  },
  async refund(c: Creds, captureRef: string, amount: number, currency: string, mode: string) {
    const token = await ppToken(c, mode);
    const r = await json(
      await http(`${ppBase(mode)}/v2/payments/captures/${encodeURIComponent(captureRef)}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: { value: ppValue(amount, currency), currency_code: currency } }),
      }),
      "PayPal",
    );
    return String(r.id);
  },
};

/** Infers test vs live mode from credentials where the provider encodes it. */
export function inferMode(provider: ProviderId, c: Creds, fallback: string) {
  if (provider === "stripe") return c.secretKey?.startsWith("sk_live_") ? "live" : "test";
  if (provider === "razorpay") return c.keyId?.startsWith("rzp_live_") ? "live" : "test";
  return fallback;
}
