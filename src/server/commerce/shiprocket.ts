import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { Address } from "@/lib/store/shipping";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { getOrder, orderLabel, updateFulfillment } from "./orders";

// Shiprocket (India): courier aggregation — create the shipment, assign an
// AWB, generate the label and schedule pickup, then sync tracking.
// API reference: https://apidocs.shiprocket.in/
const BASE = "https://apiv2.shiprocket.in/v1/external";

type Fetch = typeof fetch;
let http: Fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000) });
/** Injectable for tests. */
export function setShiprocketHttp(f: Fetch) {
  http = f;
  tokens.clear();
}

export type ShiprocketCreds = { email: string; password: string };
export type ShiprocketSettings = { pickupLocation?: string; lengthCm?: number; breadthCm?: number; heightCm?: number; defaultWeightGrams?: number };
export type Shipment = { provider: "shiprocket"; orderRef?: string; shipmentId?: string; awb?: string; courier?: string; labelUrl?: string; status?: string; pickupScheduled?: boolean; syncedAt?: string };

async function call<T = Record<string, unknown>>(path: string, init: { method?: string; token?: string; body?: unknown }) {
  const res = await http(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const b = body as { message?: string; errors?: Record<string, string[]> } | null;
    const detail = b?.errors ? Object.values(b.errors).flat().join(" ") : "";
    throw new ApiError("provider_error", `Shiprocket: ${b?.message ?? `HTTP ${res.status}`}${detail ? ` (${detail})` : ""}`);
  }
  return body as T;
}

// Tokens last 10 days; cache them in memory for a few hours.
const tokens = new Map<string, { token: string; at: number }>();
async function token(c: ShiprocketCreds) {
  const k = c.email.toLowerCase();
  const hit = tokens.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.token;
  const r = await call<{ token?: string }>("/auth/login", { method: "POST", body: { email: c.email, password: c.password } });
  if (!r.token) throw new ApiError("provider_error", "Shiprocket did not return a token");
  tokens.set(k, { token: r.token, at: Date.now() });
  return r.token;
}

// ─── Connection ──────────────────────────────────────────────────────────────

export const shiprocketUpdateSchema = z.object({
  enabled: z.boolean(),
  email: z.string().trim().max(200).optional(),
  password: z.string().max(200).optional(),
  settings: z.object({ pickupLocation: z.string().trim().max(80), lengthCm: z.number().min(1).max(300), breadthCm: z.number().min(1).max(300), heightCm: z.number().min(1).max(300), defaultWeightGrams: z.number().int().min(1).max(100000) }).partial().optional(),
});

async function row(projectId: string) {
  const [r] = await db.select().from(schema.storeIntegrations).where(and(eq(schema.storeIntegrations.projectId, projectId), eq(schema.storeIntegrations.kind, "shiprocket")));
  return r ?? null;
}

async function creds(projectId: string) {
  const r = await row(projectId);
  if (!r?.secrets || !r.enabled || r.status !== "connected") throw new ApiError("provider_not_configured", "Connect Shiprocket in Shipping settings first.");
  return { c: JSON.parse(decryptSecret(r.secrets)) as ShiprocketCreds, settings: r.settings as ShiprocketSettings };
}

export async function getShiprocket(projectId: string) {
  const r = await row(projectId);
  let emailHint = "";
  if (r?.secrets) {
    try {
      emailHint = (JSON.parse(decryptSecret(r.secrets)) as ShiprocketCreds).email;
    } catch {
      emailHint = "";
    }
  }
  return { enabled: r?.enabled ?? false, status: r?.status ?? "not_connected", lastError: r?.lastError ?? null, settings: (r?.settings ?? {}) as ShiprocketSettings, email: emailHint ? `${emailHint.slice(0, 2)}…@${emailHint.split("@")[1] ?? ""}` : "", hasPassword: !!r?.secrets };
}

/** Saves settings; new credentials are checked by logging in before they are stored. */
export async function saveShiprocket(projectId: string, input: z.infer<typeof shiprocketUpdateSchema>) {
  const existing = await row(projectId);
  let secrets = existing?.secrets ?? null;
  let status = existing?.status ?? "not_connected";
  const prev = secrets ? (JSON.parse(decryptSecret(secrets)) as ShiprocketCreds) : null;
  if (input.email || input.password) {
    const c = { email: input.email || prev?.email || "", password: input.password || prev?.password || "" };
    if (!c.email || !c.password) throw new ApiError("validation_failed", "Enter the API user email and password", { email: ["Required"] });
    tokens.delete(c.email.toLowerCase());
    try {
      await token(c);
    } catch (e) {
      throw new ApiError("validation_failed", `Could not sign in to Shiprocket: ${(e as Error).message}`, { password: ["Check the API user credentials"] });
    }
    secrets = encryptSecret(JSON.stringify(c));
    status = "connected";
  }
  if (input.enabled && status !== "connected") throw new ApiError("conflict", "Connect Shiprocket before turning it on");
  const settings = { ...((existing?.settings as object) ?? {}), ...(input.settings ?? {}) };
  const values = { enabled: input.enabled, secrets, status, settings, lastError: status === "connected" ? null : existing?.lastError ?? null, updatedAt: new Date() };
  if (existing) await db.update(schema.storeIntegrations).set(values).where(eq(schema.storeIntegrations.id, existing.id));
  else await db.insert(schema.storeIntegrations).values({ projectId, kind: "shiprocket", ...values });
  return getShiprocket(projectId);
}

// ─── Shipments ───────────────────────────────────────────────────────────────

const trackUrl = (awb: string) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;

/** Books a courier for an order: creates the Shiprocket order, assigns an AWB, generates the label and requests pickup. */
export async function bookShipment(projectId: string, orderId: string, actorId: string, opts: { courierId?: number; weightGrams?: number } = {}) {
  const { c, settings } = await creds(projectId);
  const { order, items } = await getOrder(projectId, orderId);
  if (order.cancelledAt) throw new ApiError("conflict", "This order is cancelled");
  if (order.fulfillmentStatus === "shipped" || order.fulfillmentStatus === "delivered") throw new ApiError("conflict", "This order has already shipped");
  if (order.financialStatus === "pending" && order.paymentMethod !== "cod") throw new ApiError("conflict", "Wait until the order is paid before booking a courier");
  const prior = order.shipment as Shipment | null;
  if (prior?.awb) throw new ApiError("conflict", `A courier is already booked (AWB ${prior.awb})`);
  if (!settings.pickupLocation) throw new ApiError("validation_failed", "Set your Shiprocket pickup location name in Shipping settings");
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const a = order.shippingAddress as Address;
  if (a.country !== "IN" || store.currency !== "INR") throw new ApiError("conflict", "Shiprocket bookings here cover INR orders delivered within India only");
  const t = await token(c);
  const [first, ...rest] = a.name.trim().split(/\s+/);
  const weightKg = Math.max(0.05, (opts.weightGrams ?? Math.max(settings.defaultWeightGrams ?? 500, 1)) / 1000);
  const cod = order.paymentMethod === "cod" && order.financialStatus === "pending";
  const shipment: Shipment = { provider: "shiprocket", ...(prior ?? {}) };
  const save = async () => db.update(schema.storeOrders).set({ shipment }).where(eq(schema.storeOrders.id, order.id));

  // Each step is saved as it completes, so a failure part-way can be resumed without duplicating the order.
  if (!shipment.shipmentId) {
    const created = await call<{ order_id?: number; shipment_id?: number; status?: string }>("/orders/create/adhoc", {
      method: "POST",
      token: t,
      body: {
        order_id: `${orderLabel(store.orderPrefix, order.number)}`.replace(/[^\w-]/g, "") || String(order.number),
        order_date: order.createdAt.toISOString().slice(0, 16).replace("T", " "),
        pickup_location: settings.pickupLocation,
        billing_customer_name: first,
        billing_last_name: rest.join(" "),
        billing_address: a.line1,
        billing_address_2: a.line2 ?? "",
        billing_city: a.city,
        billing_pincode: a.postalCode,
        billing_state: a.region,
        billing_country: "India",
        billing_email: order.email,
        billing_phone: order.phone.replace(/\D/g, "").slice(-10),
        shipping_is_billing: true,
        order_items: items.map((i) => ({ name: i.title + (i.variantTitle && i.variantTitle !== "Default" ? ` (${i.variantTitle})` : ""), sku: i.sku || i.id.slice(0, 12), units: i.quantity, selling_price: (i.unitPrice / 100).toFixed(2) })),
        payment_method: cod ? "COD" : "Prepaid",
        sub_total: ((order.total - order.giftCardTotal) / 100).toFixed(2),
        length: settings.lengthCm ?? 20,
        breadth: settings.breadthCm ?? 15,
        height: settings.heightCm ?? 10,
        weight: weightKg,
      },
    });
    if (!created.shipment_id) throw new ApiError("provider_error", "Shiprocket did not return a shipment");
    shipment.orderRef = String(created.order_id ?? "");
    shipment.shipmentId = String(created.shipment_id);
    await save();
  }
  if (!shipment.awb) {
    const awb = await call<{ awb_assign_status?: number; response?: { data?: { awb_code?: string; courier_name?: string } }; message?: string }>("/courier/assign/awb", { method: "POST", token: t, body: { shipment_id: Number(shipment.shipmentId), ...(opts.courierId ? { courier_id: opts.courierId } : {}) } });
    const code = awb.response?.data?.awb_code;
    if (!code) throw new ApiError("provider_error", `Shiprocket could not assign a courier${awb.message ? `: ${awb.message}` : ""}. Check your wallet balance and serviceability for PIN ${a.postalCode}.`);
    shipment.awb = code;
    shipment.courier = awb.response?.data?.courier_name ?? "Shiprocket";
    await save();
  }
  if (!shipment.labelUrl) {
    try {
      const label = await call<{ label_url?: string }>("/courier/generate/label", { method: "POST", token: t, body: { shipment_id: [Number(shipment.shipmentId)] } });
      if (label.label_url) shipment.labelUrl = label.label_url;
    } catch (e) {
      log.warn("shiprocket_label_failed", { error: (e as Error).message });
    }
  }
  if (!shipment.pickupScheduled) {
    try {
      await call("/courier/generate/pickup", { method: "POST", token: t, body: { shipment_id: [Number(shipment.shipmentId)] } });
      shipment.pickupScheduled = true;
    } catch (e) {
      log.warn("shiprocket_pickup_failed", { error: (e as Error).message });
    }
  }
  shipment.status = "booked";
  await db
    .update(schema.storeOrders)
    .set({ shipment, tracking: { carrier: shipment.courier, number: shipment.awb, url: trackUrl(shipment.awb!) }, ...(order.fulfillmentStatus === "unfulfilled" ? { fulfillmentStatus: "packed" as const } : {}) })
    .where(eq(schema.storeOrders.id, order.id));
  await db.insert(schema.storeOrderEvents).values({ orderId: order.id, kind: "shipment_booked", message: `Courier booked with ${shipment.courier} via Shiprocket · AWB ${shipment.awb}${shipment.pickupScheduled ? " · pickup requested" : ""}`, data: shipment, actorId });
  return shipment;
}

const SHIPPED = /picked|transit|shipped|out for delivery|reached|dispatched/i;

/** Pulls the latest courier status and moves the order to shipped or delivered. */
export async function syncShipment(projectId: string, orderId: string, actorId: string | null) {
  const { c } = await creds(projectId);
  const { order } = await getOrder(projectId, orderId);
  const s = order.shipment as Shipment | null;
  if (!s?.awb) throw new ApiError("conflict", "No courier booking to track");
  const t = await token(c);
  const r = await call<{ tracking_data?: { shipment_status?: number; shipment_track?: { current_status?: string }[]; track_url?: string } }>(`/courier/track/awb/${encodeURIComponent(s.awb)}`, { token: t });
  const status = r.tracking_data?.shipment_track?.[0]?.current_status ?? "";
  const next = { ...s, status: status || s.status, syncedAt: new Date().toISOString() };
  await db.update(schema.storeOrders).set({ shipment: next }).where(eq(schema.storeOrders.id, order.id));
  if (!order.cancelledAt) {
    // The tracking link saved at booking is kept; only the status moves forward.
    if (/delivered/i.test(status) && !/undelivered|rto/i.test(status) && order.fulfillmentStatus !== "delivered") await updateFulfillment(projectId, order.id, actorId, { status: "delivered" });
    else if (SHIPPED.test(status) && (order.fulfillmentStatus === "unfulfilled" || order.fulfillmentStatus === "packed")) await updateFulfillment(projectId, order.id, actorId, { status: "shipped" });
  }
  return { status: next.status };
}

export async function syncOpenShipments(projectId: string) {
  const r = await row(projectId);
  if (!r?.enabled) return 0;
  const open = await db.select({ id: schema.storeOrders.id, shipment: schema.storeOrders.shipment, f: schema.storeOrders.fulfillmentStatus }).from(schema.storeOrders).where(eq(schema.storeOrders.projectId, projectId));
  let n = 0;
  for (const o of open.filter((x) => (x.shipment as Shipment | null)?.awb && x.f !== "delivered" && x.f !== "returned").slice(0, 50)) {
    try {
      await syncShipment(projectId, o.id, null);
      n++;
    } catch (e) {
      log.warn("shiprocket_sync_failed", { order: o.id, error: (e as Error).message });
    }
  }
  return n;
}
