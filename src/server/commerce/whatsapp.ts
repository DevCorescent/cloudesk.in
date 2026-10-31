import { createHmac } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/store/money";
import type { Address } from "@/lib/store/shipping";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken, safeEqual } from "../security/tokens";
import { appUrl } from "../services/mail";

// WhatsApp Cloud API (Meta). Business-initiated messages must use templates
// the owner has had approved in WhatsApp Manager; we only fill in variables.
// API reference: https://developers.facebook.com/docs/whatsapp/cloud-api
const GRAPH = "https://graph.facebook.com/v21.0";

type Fetch = typeof fetch;
let http: Fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
/** Injectable for tests. */
export function setWhatsAppHttp(f: Fetch) {
  http = f;
}

export type WaEvent = "order_confirmation" | "order_shipped" | "order_delivered" | "cart_reminder";
export type WaCreds = { phoneNumberId: string; accessToken: string; appSecret?: string };
export type WaTemplate = { name: string; language: string; enabled: boolean };
export type WaSettings = {
  /** Number for click-to-chat links, in international format. Works without the API. */
  chatNumber?: string;
  displayNumber?: string;
  verifiedName?: string;
  verifyToken?: string;
  templates?: Partial<Record<WaEvent, WaTemplate>>;
};

/** Suggested template bodies to submit in WhatsApp Manager. Variables are filled in the order shown. */
export const TEMPLATE_GUIDE: Record<WaEvent, { title: string; category: "UTILITY" | "MARKETING"; body: string; variables: string[] }> = {
  order_confirmation: { title: "Order confirmation", category: "UTILITY", body: "Hi {{1}}, thank you for your order {{2}} from {{3}}. Total: {{4}}. We'll message you when it ships. View your order: {{5}}", variables: ["Customer first name", "Order number", "Store name", "Amount", "Order link"] },
  order_shipped: { title: "Order shipped", category: "UTILITY", body: "Good news {{1}}! Your order {{2}} has shipped with {{3}}. Track it here: {{4}}", variables: ["Customer first name", "Order number", "Courier", "Tracking link"] },
  order_delivered: { title: "Order delivered", category: "UTILITY", body: "Hi {{1}}, your order {{2}} has been delivered. We hope you love it! Questions? Just reply to this message.", variables: ["Customer first name", "Order number"] },
  cart_reminder: { title: "Cart reminder", category: "MARKETING", body: "Hi {{1}}, you left something in your cart at {{2}}. Pick up where you left off: {{3}}", variables: ["Customer first name", "Store name", "Cart link"] },
};

/** Normalises a phone number to WhatsApp's digits-only international format; Indian 10-digit numbers get +91. */
export function waNumber(raw: string, defaultCountry = "IN") {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (defaultCountry === "IN" && /^0?[6-9]\d{9}$/.test(d)) d = `91${d.replace(/^0/, "")}`;
  return /^\d{8,15}$/.test(d) ? d : null;
}

export const chatLink = (number: string, text: string) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const res = await http(`${GRAPH}${path}`, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
  if (!res.ok || body?.error) throw new ApiError("provider_error", `WhatsApp: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  return body;
}

async function row(projectId: string) {
  const [r] = await db.select().from(schema.storeIntegrations).where(and(eq(schema.storeIntegrations.projectId, projectId), eq(schema.storeIntegrations.kind, "whatsapp")));
  return r ?? null;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getWhatsApp(projectId: string) {
  const r = await row(projectId);
  const s = (r?.settings ?? {}) as WaSettings;
  return {
    enabled: r?.enabled ?? false,
    status: r?.status ?? "not_connected",
    lastError: r?.lastError ?? null,
    connected: r?.status === "connected",
    hasAppSecret: (() => {
      try {
        return !!(r?.secrets && (JSON.parse(decryptSecret(r.secrets)) as WaCreds).appSecret);
      } catch {
        return false;
      }
    })(),
    chatNumber: s.chatNumber ?? "",
    displayNumber: s.displayNumber ?? "",
    verifiedName: s.verifiedName ?? "",
    templates: s.templates ?? {},
    webhookUrl: appUrl(`/api/v1/store/${projectId}/webhooks/whatsapp`),
    verifyToken: s.verifyToken ?? "",
    guide: TEMPLATE_GUIDE,
  };
}

const templateSchema = z.object({ name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Lowercase letters, numbers and underscores"), language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "e.g. en or en_US"), enabled: z.boolean() });

export const whatsappUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  chatNumber: z.string().trim().max(20).optional(),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Digits only").optional(),
  accessToken: z.string().trim().max(1000).optional(),
  appSecret: z.string().trim().max(200).optional(),
  templates: z.partialRecord(z.enum(["order_confirmation", "order_shipped", "order_delivered", "cart_reminder"]), templateSchema).optional(),
});

/** Saves settings. New credentials are checked against the Graph API before they are stored. */
export async function saveWhatsApp(projectId: string, input: z.infer<typeof whatsappUpdateSchema>, country = "IN") {
  const existing = await row(projectId);
  const settings = { ...((existing?.settings as WaSettings) ?? {}) };
  let secrets = existing?.secrets ?? null;
  let status = existing?.status ?? "not_connected";
  const prev = secrets ? (JSON.parse(decryptSecret(secrets)) as WaCreds) : null;
  if (input.chatNumber !== undefined) {
    if (input.chatNumber === "") delete settings.chatNumber;
    else {
      const n = waNumber(input.chatNumber, country);
      if (!n) throw new ApiError("validation_failed", "Enter the number with country code, e.g. +91 98765 43210", { chatNumber: ["Invalid number"] });
      settings.chatNumber = n;
    }
  }
  if (input.phoneNumberId || input.accessToken || input.appSecret !== undefined) {
    const c: WaCreds = { phoneNumberId: input.phoneNumberId || prev?.phoneNumberId || "", accessToken: input.accessToken || prev?.accessToken || "", appSecret: input.appSecret === undefined ? prev?.appSecret : input.appSecret || undefined };
    if (!c.phoneNumberId || !c.accessToken) throw new ApiError("validation_failed", "Enter the phone number ID and access token", { phoneNumberId: ["Required"] });
    if (input.phoneNumberId || input.accessToken) {
      try {
        const info = await call(`/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`, c.accessToken);
        settings.displayNumber = String(info.display_phone_number ?? "");
        settings.verifiedName = String(info.verified_name ?? "");
      } catch (e) {
        throw new ApiError("validation_failed", `Could not connect: ${(e as Error).message}`, { accessToken: [(e as Error).message] });
      }
      status = "connected";
    }
    secrets = encryptSecret(JSON.stringify(c));
  }
  settings.verifyToken ??= randomToken(18);
  if (input.templates) settings.templates = { ...(settings.templates ?? {}), ...input.templates };
  const enabled = input.enabled ?? existing?.enabled ?? false;
  if (enabled && status !== "connected") throw new ApiError("conflict", "Connect the WhatsApp Cloud API before turning on automatic messages");
  const values = { enabled, secrets, status, settings, lastError: status === "connected" ? null : (existing?.lastError ?? null), updatedAt: new Date() };
  if (existing) await db.update(schema.storeIntegrations).set(values).where(eq(schema.storeIntegrations.id, existing.id));
  else await db.insert(schema.storeIntegrations).values({ projectId, kind: "whatsapp", ...values });
  return getWhatsApp(projectId);
}

/** Click-to-chat number for storefront links (no API needed). */
export async function chatNumber(projectId: string) {
  const r = await row(projectId);
  return ((r?.settings ?? {}) as WaSettings).chatNumber ?? null;
}

/** Whether checkout should offer the WhatsApp opt-in. */
export async function whatsappActive(projectId: string) {
  const r = await row(projectId);
  if (!r?.enabled || r.status !== "connected") return false;
  const t = ((r.settings ?? {}) as WaSettings).templates ?? {};
  return Object.values(t).some((x) => x?.enabled);
}

// ─── Sending ─────────────────────────────────────────────────────────────────

async function send(projectId: string, event: WaEvent | "test", to: string, params: string[], orderId: string | null, override?: WaTemplate) {
  const r = await row(projectId);
  if (!r?.secrets || r.status !== "connected") return { ok: false as const, error: "WhatsApp is not connected" };
  if (event !== "test" && !r.enabled) return { ok: false as const, error: "WhatsApp messages are turned off" };
  const tpl = override ?? ((r.settings ?? {}) as WaSettings).templates?.[event as WaEvent];
  if (!tpl?.enabled || !tpl.name) return { ok: false as const, error: "No approved template is set up for this message" };
  const c = JSON.parse(decryptSecret(r.secrets)) as WaCreds;
  const [msg] = await db.insert(schema.storeMessages).values({ projectId, orderId, channel: "whatsapp", to, event, template: tpl.name }).returning();
  try {
    const res = await call(`/${encodeURIComponent(c.phoneNumberId)}/messages`, c.accessToken, {
      method: "POST",
      body: {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: { name: tpl.name, language: { code: tpl.language }, ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 1000) || "-" })) }] } : {}) },
      },
    });
    const id = (res.messages as { id: string }[] | undefined)?.[0]?.id ?? null;
    await db.update(schema.storeMessages).set({ status: "sent", providerId: id, updatedAt: new Date() }).where(eq(schema.storeMessages.id, msg.id));
    return { ok: true as const, id };
  } catch (e) {
    await db.update(schema.storeMessages).set({ status: "failed", error: (e as Error).message.slice(0, 500), updatedAt: new Date() }).where(eq(schema.storeMessages.id, msg.id));
    log.warn("whatsapp_failed", { event, error: (e as Error).message });
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function sendTestMessage(projectId: string, to: string, event: WaEvent, country = "IN") {
  const n = waNumber(to, country);
  if (!n) throw new ApiError("validation_failed", "Enter the number with country code", { to: ["Invalid number"] });
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const samples: Record<WaEvent, string[]> = {
    order_confirmation: ["Asha", "#1001", store?.name ?? "Your store", formatMoney(149900, store?.currency ?? "INR"), appUrl("/")],
    order_shipped: ["Asha", "#1001", "Delhivery", appUrl("/")],
    order_delivered: ["Asha", "#1001"],
    cart_reminder: ["Asha", store?.name ?? "Your store", appUrl("/")],
  };
  const r = await row(projectId);
  const tpl = ((r?.settings ?? {}) as WaSettings).templates?.[event];
  if (!tpl?.name) throw new ApiError("validation_failed", "Set the template name for this message first");
  const out = await send(projectId, "test", n, samples[event], null, { ...tpl, enabled: true });
  if (!out.ok) throw new ApiError("provider_error", out.error);
  return out;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

type OrderRow = typeof schema.storeOrders.$inferSelect;

/** Sends an order update if the customer opted in and the owner set up the template. Never throws. */
export async function notifyOrderWhatsApp(o: OrderRow, event: "order_confirmation" | "order_shipped" | "order_delivered", link?: string) {
  try {
    if (!o.whatsappOptIn) return;
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, o.projectId));
    const to = waNumber(o.phone, store?.country ?? "IN");
    if (!to) return;
    const a = o.shippingAddress as Address;
    const label = `${store.orderPrefix}${o.number}`;
    const t = o.tracking as { carrier?: string; url?: string; number?: string } | null;
    const params =
      event === "order_confirmation"
        ? [firstName(a.name), label, store.name, formatMoney(o.total - o.giftCardTotal, o.currency), link ?? ""]
        : event === "order_shipped"
          ? [firstName(a.name), label, t?.carrier || "our courier", t?.url || link || t?.number || ""]
          : [firstName(a.name), label];
    await send(o.projectId, event, to, params, o.id);
  } catch (e) {
    log.warn("whatsapp_notify_failed", { error: (e as Error).message });
  }
}

/** Cart reminder on WhatsApp: only with marketing consent and the WhatsApp opt-in, once per cart. */
export async function sendCartReminderWhatsApp(projectId: string, cartId: string, cartLink: string) {
  const [c] = await db.select().from(schema.storeCarts).where(and(eq(schema.storeCarts.id, cartId), eq(schema.storeCarts.projectId, projectId)));
  if (!c || c.orderId) throw new ApiError("not_found", "Cart not found");
  if (!c.marketingConsent || !c.whatsappOptIn) throw new ApiError("forbidden", "This shopper did not agree to WhatsApp messages");
  if (c.whatsappRemindedAt) throw new ApiError("conflict", "A WhatsApp reminder was already sent");
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const a = c.address as (Address & { phone?: string }) | null;
  const to = waNumber(a?.phone ?? "", store.country);
  if (!to) throw new ApiError("conflict", "No valid phone number on this cart");
  const r = await send(projectId, "cart_reminder", to, [firstName(a?.name ?? ""), store.name, cartLink], null);
  if (!r.ok) throw new ApiError("provider_error", r.error);
  await db.update(schema.storeCarts).set({ whatsappRemindedAt: new Date() }).where(eq(schema.storeCarts.id, c.id));
}

export async function listMessages(projectId: string) {
  return db.select().from(schema.storeMessages).where(eq(schema.storeMessages.projectId, projectId)).orderBy(desc(schema.storeMessages.createdAt)).limit(100);
}

// ─── Webhook (delivery receipts) ─────────────────────────────────────────────

/** Meta's subscription handshake: echo the challenge when the verify token matches. */
export async function verifyWebhook(projectId: string, params: URLSearchParams) {
  const r = await row(projectId);
  const token = ((r?.settings ?? {}) as WaSettings).verifyToken;
  if (params.get("hub.mode") === "subscribe" && token && safeEqual(params.get("hub.verify_token") ?? "", token)) return params.get("hub.challenge") ?? "";
  return null;
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** Applies status updates. Requires the app secret so updates cannot be forged. */
export async function handleWhatsAppWebhook(projectId: string, raw: string, signature: string | null) {
  const r = await row(projectId);
  if (!r?.secrets) throw new ApiError("not_found", "WhatsApp not configured");
  const c = JSON.parse(decryptSecret(r.secrets)) as WaCreds;
  if (!c.appSecret) throw new ApiError("forbidden", "Add the app secret to receive delivery updates");
  const expected = `sha256=${createHmac("sha256", c.appSecret).update(raw).digest("hex")}`;
  if (!signature || !safeEqual(signature, expected)) throw new ApiError("forbidden", "Invalid signature");
  const body = JSON.parse(raw) as { entry?: { changes?: { value?: { statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[] } }[] }[] };
  let updated = 0;
  for (const e of body.entry ?? [])
    for (const ch of e.changes ?? [])
      for (const st of ch.value?.statuses ?? []) {
        const [m] = await db.select().from(schema.storeMessages).where(and(eq(schema.storeMessages.projectId, projectId), eq(schema.storeMessages.providerId, st.id)));
        // Statuses can arrive out of order; never move backwards.
        if (!m || (RANK[st.status] ?? 0) <= (RANK[m.status] ?? 0)) continue;
        await db
          .update(schema.storeMessages)
          .set({ status: st.status, error: st.status === "failed" ? (st.errors?.[0]?.message ?? st.errors?.[0]?.title ?? "Failed") : m.error, updatedAt: new Date() })
          .where(eq(schema.storeMessages.id, m.id));
        updated++;
      }
  return { updated };
}
