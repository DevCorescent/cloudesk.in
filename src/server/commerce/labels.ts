// Shipping labels through EasyPost or Shippo (worldwide carriers: USPS, UPS,
// FedEx, DHL, Royal Mail, Canada Post …). Compare rates, buy a label, and let
// tracking webhooks mark orders delivered. International shipments carry a
// customs declaration built from the order's items.
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { toMajor } from "@/lib/store/money";
import type { Address } from "@/lib/store/shipping";
import { ApiError, notFound } from "../http/errors";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken } from "../security/tokens";
import { appUrl } from "../services/mail";
import { getStore } from "./catalog";
import { getOrder, updateFulfillment } from "./orders";

export const LABEL_PROVIDERS = ["easypost", "shippo"] as const;
export type LabelProvider = (typeof LABEL_PROVIDERS)[number];
export type LabelSettings = { lengthCm: number; widthCm: number; heightCm: number; defaultWeightGrams: number; contentsType: "merchandise" | "gift" | "documents" | "sample"; webhookToken?: string };
const DEFAULTS: LabelSettings = { lengthCm: 25, widthCm: 20, heightCm: 10, defaultWeightGrams: 500, contentsType: "merchandise" };

export type LabelRate = { id: string; carrier: string; service: string; amount: number; currency: string; days: number | null };
export type LabelShipment = { provider: LabelProvider; shipmentId: string; rates?: LabelRate[]; carrier?: string; service?: string; trackingCode?: string; trackingUrl?: string; labelUrl?: string; cost?: number; costCurrency?: string; status?: string; trackerId?: string; syncedAt?: string };

type Fetch = typeof fetch;
let http: Fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30000) });
/** Test hook. */
export function setLabelHttp(f: Fetch | null) {
  http = f ?? ((input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30000) }));
}

async function api(provider: LabelProvider, apiKey: string, path: string, body?: unknown, method = body ? "POST" : "GET") {
  const url = provider === "easypost" ? `https://api.easypost.com/v2${path}` : `https://api.goshippo.com${path}`;
  const auth = provider === "easypost" ? `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` : `ShippoToken ${apiKey}`;
  const res = await http(url, { method, headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string }; detail?: string; messages?: { text: string }[] };
  if (!res.ok) throw new ApiError("provider_error", `${provider === "easypost" ? "EasyPost" : "Shippo"}: ${json.error?.message ?? json.detail ?? json.messages?.map((m) => m.text).join("; ") ?? `HTTP ${res.status}`}`);
  return json;
}

async function row(projectId: string, provider: LabelProvider) {
  const [r] = await db.select().from(schema.storeIntegrations).where(and(eq(schema.storeIntegrations.projectId, projectId), eq(schema.storeIntegrations.kind, provider)));
  return r ?? null;
}

export async function getLabelProviders(projectId: string) {
  const out = [];
  for (const p of LABEL_PROVIDERS) {
    const r = await row(projectId, p);
    const s = { ...DEFAULTS, ...((r?.settings ?? {}) as Partial<LabelSettings>) };
    out.push({ provider: p, enabled: !!r?.enabled, status: r?.status ?? "not_connected", lastError: r?.lastError ?? null, settings: { lengthCm: s.lengthCm, widthCm: s.widthCm, heightCm: s.heightCm, defaultWeightGrams: s.defaultWeightGrams, contentsType: s.contentsType }, testMode: r?.secrets ? isTestKey(p, JSON.parse(decryptSecret(r.secrets)).apiKey) : null, webhookUrl: s.webhookToken ? webhookUrl(projectId, p, s.webhookToken) : null });
  }
  return out;
}

const isTestKey = (p: LabelProvider, key: string) => (p === "easypost" ? key.startsWith("EZTK") : key.startsWith("shippo_test_"));
const webhookUrl = (projectId: string, p: LabelProvider, token: string) => appUrl(`/api/v1/store/${projectId}/webhooks/${p}?token=${token}`);

export const labelUpdateSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().trim().max(200).optional(),
  webhookSecret: z.string().trim().max(200).optional(),
  settings: z.object({ lengthCm: z.number().min(1).max(300), widthCm: z.number().min(1).max(300), heightCm: z.number().min(1).max(300), defaultWeightGrams: z.number().int().min(1).max(150_000), contentsType: z.enum(["merchandise", "gift", "documents", "sample"]) }).partial().optional(),
});

/** Saves the connection. A new key is checked with the provider first. */
export async function saveLabelProvider(projectId: string, provider: LabelProvider, input: z.infer<typeof labelUpdateSchema>) {
  const existing = await row(projectId, provider);
  const prev = existing?.secrets ? (JSON.parse(decryptSecret(existing.secrets)) as { apiKey: string; webhookSecret?: string }) : null;
  let secrets = existing?.secrets ?? null;
  let status = existing?.status ?? "not_connected";
  if (input.apiKey || input.webhookSecret) {
    const c = { apiKey: input.apiKey || prev?.apiKey || "", webhookSecret: input.webhookSecret || prev?.webhookSecret };
    if (!c.apiKey) throw new ApiError("validation_failed", "Enter the API key", { apiKey: ["Required"] });
    try {
      await api(provider, c.apiKey, provider === "easypost" ? "/addresses?page_size=1" : "/carrier_accounts/?results=1");
    } catch (e) {
      throw new ApiError("validation_failed", `The key didn't work: ${(e as Error).message}`, { apiKey: ["Rejected"] });
    }
    secrets = encryptSecret(JSON.stringify(c));
    status = "connected";
  }
  if (input.enabled && status !== "connected") throw new ApiError("conflict", "Connect the account before turning it on");
  const settings = { ...DEFAULTS, ...((existing?.settings as object) ?? {}), ...(input.settings ?? {}) } as LabelSettings;
  settings.webhookToken ??= randomToken(18);
  const values = { enabled: input.enabled, secrets, status, settings, lastError: null, updatedAt: new Date() };
  if (existing) await db.update(schema.storeIntegrations).set(values).where(eq(schema.storeIntegrations.id, existing.id));
  else await db.insert(schema.storeIntegrations).values({ projectId, kind: provider, ...values });
  return (await getLabelProviders(projectId)).find((p) => p.provider === provider)!;
}

async function creds(projectId: string, provider: LabelProvider) {
  const r = await row(projectId, provider);
  if (!r?.secrets || !r.enabled || r.status !== "connected") throw new ApiError("provider_not_configured", `Connect ${provider === "easypost" ? "EasyPost" : "Shippo"} in Shipping settings first.`);
  return { c: JSON.parse(decryptSecret(r.secrets)) as { apiKey: string; webhookSecret?: string }, settings: { ...DEFAULTS, ...(r.settings as Partial<LabelSettings>) } };
}

type StoreAddr = { name: string; line1: string; line2?: string; city: string; region: string; postalCode: string; country: string; phone?: string };

/** Gets rates for an order (and remembers the shipment so a label can be bought). */
export async function labelRates(projectId: string, orderId: string, provider: LabelProvider, opts: { weightGrams?: number } = {}) {
  const { c, settings } = await creds(projectId, provider);
  const { order, items } = await getOrder(projectId, orderId);
  if (order.cancelledAt) throw new ApiError("conflict", "This order is cancelled");
  if (order.fulfillmentStatus === "shipped" || order.fulfillmentStatus === "delivered") throw new ApiError("conflict", "This order has already shipped");
  const store = (await getStore(projectId))!;
  const from = store.address as StoreAddr | null;
  if (!from?.line1 || !from.postalCode) throw new ApiError("conflict", "Add your business address in Store settings — it's the label's return address.");
  const to = order.shippingAddress as Address;
  const physical = items.filter((i) => i.kind === "physical");
  const vIds = physical.map((i) => i.variantId).filter((x): x is string => !!x);
  const weights = new Map((vIds.length ? await db.select({ id: schema.storeVariants.id, w: schema.storeVariants.weightGrams }).from(schema.storeVariants).where(inArray(schema.storeVariants.id, vIds)) : []).map((v) => [v.id, v.w]));
  const itemWeight = (i: (typeof physical)[number]) => (i.variantId ? (weights.get(i.variantId) ?? 0) : 0);
  const weight = opts.weightGrams ?? Math.max(settings.defaultWeightGrams, physical.reduce((a, i) => a + itemWeight(i) * i.quantity, 0));
  const international = to.country.toUpperCase() !== (from.country ?? store.country).toUpperCase();
  const customsItems = physical.map((i) => ({ description: i.title.slice(0, 45), quantity: i.quantity, value: toMajor(i.unitPrice * i.quantity, order.currency), weightGrams: Math.max(1, Math.round((itemWeight(i) || weight / Math.max(1, physical.length)) * i.quantity)), hsCode: i.hsn ?? "" }));
  const fromAddr = { name: store.name, street1: from.line1, street2: from.line2 ?? "", city: from.city, state: from.region || store.region, zip: from.postalCode, country: (from.country || store.country).toUpperCase(), phone: store.phone || from.phone || "", email: store.email };
  const toAddr = { name: to.name, street1: to.line1, street2: to.line2 ?? "", city: to.city, state: to.region, zip: to.postalCode, country: to.country.toUpperCase(), phone: order.phone, email: order.email };
  let shipment: LabelShipment;
  if (provider === "easypost") {
    const s = await api("easypost", c.apiKey, "/shipments", {
      shipment: {
        from_address: fromAddr,
        to_address: toAddr,
        parcel: { length: settings.lengthCm / 2.54, width: settings.widthCm / 2.54, height: settings.heightCm / 2.54, weight: weight / 28.3495 },
        ...(international ? { customs_info: { contents_type: settings.contentsType, customs_certify: true, customs_signer: store.name, eel_pfc: "NOEEI 30.37(a)", customs_items: customsItems.map((i) => ({ description: i.description, quantity: i.quantity, value: i.value, weight: i.weightGrams / 28.3495, hs_tariff_number: i.hsCode, origin_country: fromAddr.country })) } } : {}),
        reference: `order-${order.number}`,
      },
    });
    const rates = (s.rates as { id: string; carrier: string; service: string; rate: string; currency: string; delivery_days: number | null }[]) ?? [];
    shipment = { provider, shipmentId: String(s.id), rates: rates.map((r) => ({ id: r.id, carrier: r.carrier, service: r.service, amount: Math.round(Number(r.rate) * 100), currency: r.currency, days: r.delivery_days })) };
  } else {
    let customs: string | undefined;
    if (international) {
      const d = await api("shippo", c.apiKey, "/customs/declarations/", {
        certify: true,
        certify_signer: store.name,
        contents_type: settings.contentsType.toUpperCase(),
        non_delivery_option: "RETURN",
        items: customsItems.map((i) => ({ description: i.description, quantity: i.quantity, net_weight: String(i.weightGrams), mass_unit: "g", value_amount: i.value.toFixed(2), value_currency: order.currency, tariff_number: i.hsCode, origin_country: fromAddr.country })),
      });
      customs = String(d.object_id);
    }
    const s = await api("shippo", c.apiKey, "/shipments/", {
      address_from: fromAddr,
      address_to: toAddr,
      parcels: [{ length: String(settings.lengthCm), width: String(settings.widthCm), height: String(settings.heightCm), distance_unit: "cm", weight: String(weight), mass_unit: "g" }],
      ...(customs ? { customs_declaration: customs } : {}),
      async: false,
    });
    const rates = (s.rates as { object_id: string; provider: string; servicelevel: { name: string }; amount: string; currency: string; estimated_days: number | null }[]) ?? [];
    shipment = { provider, shipmentId: String(s.object_id), rates: rates.map((r) => ({ id: r.object_id, carrier: r.provider, service: r.servicelevel?.name ?? "", amount: Math.round(Number(r.amount) * 100), currency: r.currency, days: r.estimated_days })) };
  }
  shipment.rates!.sort((a, b) => a.amount - b.amount);
  if (!shipment.rates!.length) throw new ApiError("provider_error", "No carrier offered a rate for this parcel and address. Check the addresses and parcel size.");
  await db.update(schema.storeOrders).set({ shipment }).where(eq(schema.storeOrders.id, order.id));
  return shipment;
}

/** Buys the chosen rate's label and marks the order shipped. */
export async function buyLabel(projectId: string, orderId: string, rateId: string, actorId: string) {
  const { order } = await getOrder(projectId, orderId);
  const s = order.shipment as LabelShipment | null;
  if (!s?.rates?.length || !LABEL_PROVIDERS.includes(s.provider)) throw new ApiError("conflict", "Get rates first");
  if (s.labelUrl) throw new ApiError("conflict", "A label was already bought for this order");
  const rate = s.rates.find((r) => r.id === rateId);
  if (!rate) throw new ApiError("validation_failed", "Choose one of the rates");
  const { c } = await creds(projectId, s.provider);
  let bought: LabelShipment;
  if (s.provider === "easypost") {
    const r = await api("easypost", c.apiKey, `/shipments/${encodeURIComponent(s.shipmentId)}/buy`, { rate: { id: rate.id } });
    const tracker = r.tracker as { id?: string; public_url?: string } | undefined;
    bought = { ...s, carrier: rate.carrier, service: rate.service, trackingCode: String(r.tracking_code), labelUrl: (r.postage_label as { label_url?: string })?.label_url, trackingUrl: tracker?.public_url, trackerId: tracker?.id, cost: rate.amount, costCurrency: rate.currency, status: "pre_transit" };
  } else {
    const t = await api("shippo", c.apiKey, "/transactions/", { rate: rate.id, label_file_type: "PDF", async: false });
    if (t.status !== "SUCCESS") throw new ApiError("provider_error", `Shippo couldn't create the label: ${((t.messages as { text: string }[]) ?? []).map((m) => m.text).join("; ") || t.status}`);
    bought = { ...s, carrier: rate.carrier, service: rate.service, trackingCode: String(t.tracking_number), labelUrl: String(t.label_url), trackingUrl: t.tracking_url_provider ? String(t.tracking_url_provider) : undefined, cost: rate.amount, costCurrency: rate.currency, status: "pre_transit" };
  }
  bought.rates = undefined;
  bought.syncedAt = new Date().toISOString();
  await db.update(schema.storeOrders).set({ shipment: bought }).where(eq(schema.storeOrders.id, order.id));
  await updateFulfillment(projectId, order.id, actorId, { status: "shipped", carrier: `${rate.carrier} ${rate.service}`.trim(), trackingNumber: bought.trackingCode, trackingUrl: bought.trackingUrl, notify: true });
  return bought;
}

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Tracking updates from EasyPost (HMAC-signed) or Shippo (secret token in the URL). */
export async function handleLabelWebhook(projectId: string, provider: LabelProvider, raw: string, headers: Headers, token: string | null) {
  const r = await row(projectId, provider);
  if (!r?.secrets) throw notFound("Webhook");
  const settings = { ...DEFAULTS, ...(r.settings as Partial<LabelSettings>) };
  const c = JSON.parse(decryptSecret(r.secrets)) as { webhookSecret?: string };
  if (!token || !settings.webhookToken || !safeEq(token, settings.webhookToken)) throw new ApiError("forbidden", "Invalid webhook token");
  if (provider === "easypost" && c.webhookSecret) {
    const sig = headers.get("x-hmac-signature") ?? "";
    const expected = `hmac-sha256-hex=${createHmac("sha256", c.webhookSecret.normalize("NFKD")).update(raw).digest("hex")}`;
    if (!safeEq(sig, expected)) throw new ApiError("forbidden", "Invalid signature");
  }
  const evt = JSON.parse(raw) as Record<string, unknown>;
  let tracking = "";
  let status = "";
  if (provider === "easypost") {
    const o = (evt.result ?? {}) as { tracking_code?: string; status?: string };
    if (!String(evt.description ?? "").startsWith("tracker.")) return { ignored: true };
    tracking = o.tracking_code ?? "";
    status = o.status ?? "";
  } else {
    if (evt.event !== "track_updated") return { ignored: true };
    const d = (evt.data ?? {}) as { tracking_number?: string; tracking_status?: { status?: string } };
    tracking = d.tracking_number ?? "";
    status = (d.tracking_status?.status ?? "").toLowerCase();
  }
  if (!tracking) return { ignored: true };
  const [order] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), sql`${schema.storeOrders.shipment}->>'trackingCode' = ${tracking}`));
  if (!order) return { unmatched: true };
  await db.update(schema.storeOrders).set({ shipment: { ...(order.shipment as object), status, syncedAt: new Date().toISOString() } }).where(eq(schema.storeOrders.id, order.id));
  if (status === "delivered" && order.fulfillmentStatus === "shipped") await updateFulfillment(projectId, order.id, null, { status: "delivered", notify: true });
  return { updated: true, status };
}
