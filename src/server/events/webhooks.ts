// Outgoing webhooks: signed, retried, logged.
//
// Each delivery POSTs JSON { id, type, createdAt, projectId, data } with
//   CC-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
// using the endpoint's signing secret. Receivers should reject timestamps
// older than 5 minutes. Non-2xx answers are retried with backoff; 410 Gone
// switches the endpoint off.
import { createHmac } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { EVENT_TYPES, type EventType } from "@/lib/platform/events";
import { ApiError, notFound } from "../http/errors";
import { defineJob, enqueue, PermanentError } from "../jobs/queue";
import { safeRequest, validateUrl, type SafeResponse } from "../net/safe-fetch";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken } from "../security/tokens";

export const MAX_ENDPOINTS = 20;

type Http = (url: string, opts: { method: string; headers: Record<string, string>; body: string }) => Promise<SafeResponse>;
let http: Http = (url, opts) => safeRequest(url, { ...opts, maxBytes: 8000, timeoutMs: 10_000 });
/** Test hook. */
export function setWebhookHttp(fn: Http | null) {
  http = fn ?? ((url, opts) => safeRequest(url, { ...opts, maxBytes: 8000, timeoutMs: 10_000 }));
}

export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export type EventEnvelope = { id: string; type: EventType; createdAt: string; projectId: string; data: Record<string, unknown> };

export async function listEndpoints(projectId: string) {
  return db
    .select({ id: schema.webhookEndpoints.id, url: schema.webhookEndpoints.url, description: schema.webhookEndpoints.description, events: schema.webhookEndpoints.events, enabled: schema.webhookEndpoints.enabled, appInstallId: schema.webhookEndpoints.appInstallId, createdAt: schema.webhookEndpoints.createdAt })
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.projectId, projectId))
    .orderBy(desc(schema.webhookEndpoints.createdAt));
}

function checkEvents(events: string[]) {
  const bad = events.filter((e) => e !== "*" && !EVENT_TYPES.includes(e as EventType));
  if (bad.length || !events.length) throw new ApiError("validation_failed", bad.length ? `Unknown events: ${bad.join(", ")}` : "Choose at least one event");
}

/** Creates an endpoint; returns the signing secret once. */
export async function createEndpoint(projectId: string, input: { url: string; description?: string; events: string[] }, appInstallId: string | null = null) {
  validateUrl(input.url);
  if (!/^https:\/\//i.test(input.url) && process.env.NODE_ENV === "production") throw new ApiError("validation_failed", "Webhook URLs must use https");
  checkEvents(input.events);
  const existing = await db.select({ id: schema.webhookEndpoints.id }).from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.projectId, projectId));
  if (existing.length >= MAX_ENDPOINTS) throw new ApiError("conflict", `A project can have up to ${MAX_ENDPOINTS} webhook endpoints`);
  const secret = `whsec_${randomToken(24)}`;
  const [e] = await db.insert(schema.webhookEndpoints).values({ projectId, url: input.url.trim(), description: input.description ?? "", events: input.events, secretEnc: encryptSecret(secret), appInstallId }).returning();
  return { endpoint: e, secret };
}

export async function updateEndpoint(projectId: string, id: string, input: { events?: string[]; enabled?: boolean; description?: string }) {
  if (input.events) checkEvents(input.events);
  const r = await db.update(schema.webhookEndpoints).set(input).where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.projectId, projectId))).returning({ id: schema.webhookEndpoints.id });
  if (!r.length) throw notFound("Webhook endpoint");
}

export async function deleteEndpoint(projectId: string, id: string) {
  const r = await db.delete(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.projectId, projectId))).returning({ id: schema.webhookEndpoints.id });
  if (!r.length) throw notFound("Webhook endpoint");
}

export async function rollSecret(projectId: string, id: string) {
  const secret = `whsec_${randomToken(24)}`;
  const r = await db.update(schema.webhookEndpoints).set({ secretEnc: encryptSecret(secret) }).where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.projectId, projectId))).returning({ id: schema.webhookEndpoints.id });
  if (!r.length) throw notFound("Webhook endpoint");
  return { secret };
}

export async function listDeliveries(projectId: string, endpointId: string) {
  return db
    .select()
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.projectId, projectId), eq(schema.webhookDeliveries.endpointId, endpointId)))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(50);
}

/** Queues deliveries of an event to every subscribed endpoint. */
export async function fanOutWebhooks(evt: EventEnvelope) {
  const endpoints = await db.select().from(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.projectId, evt.projectId), eq(schema.webhookEndpoints.enabled, true)));
  for (const e of endpoints) {
    const events = e.events as string[];
    if (!events.includes("*") && !events.includes(evt.type) && evt.type !== "webhook.test") continue;
    const [d] = await db.insert(schema.webhookDeliveries).values({ endpointId: e.id, projectId: evt.projectId, eventId: evt.id, event: evt.type, payload: evt }).returning();
    await enqueue("webhook.deliver", { deliveryId: d.id }, { projectId: evt.projectId, maxAttempts: 8 });
  }
}

export async function redeliver(projectId: string, deliveryId: string) {
  const [d] = await db.select().from(schema.webhookDeliveries).where(and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.projectId, projectId)));
  if (!d) throw notFound("Delivery");
  await db.update(schema.webhookDeliveries).set({ status: "pending", error: null }).where(eq(schema.webhookDeliveries.id, d.id));
  await enqueue("webhook.deliver", { deliveryId: d.id }, { projectId, maxAttempts: 8 });
}

defineJob<{ deliveryId: string }>(
  "webhook.deliver",
  async ({ deliveryId }, { job }) => {
    const [d] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, deliveryId));
    if (!d || d.status === "succeeded") return { skipped: true };
    const [e] = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, d.endpointId));
    if (!e || !e.enabled) {
      await db.update(schema.webhookDeliveries).set({ status: "dead", error: "Endpoint removed or switched off" }).where(eq(schema.webhookDeliveries.id, d.id));
      return { skipped: true };
    }
    const body = JSON.stringify(d.payload);
    const attempts = d.attempts + 1;
    let r: SafeResponse;
    try {
      r = await http(e.url, { method: "POST", headers: { "Content-Type": "application/json", "CC-Event": d.event, "CC-Delivery": d.id, "CC-Signature": signPayload(decryptSecret(e.secretEnc), body) }, body });
    } catch (err) {
      const final = job.attempts >= job.maxAttempts;
      await db.update(schema.webhookDeliveries).set({ status: final ? "dead" : "failed", attempts, error: (err as Error).message.slice(0, 500) }).where(eq(schema.webhookDeliveries.id, d.id));
      throw err;
    }
    const ok = r.status >= 200 && r.status < 300;
    if (r.status === 410) await db.update(schema.webhookEndpoints).set({ enabled: false }).where(eq(schema.webhookEndpoints.id, e.id));
    const final = ok || r.status === 410 || job.attempts >= job.maxAttempts;
    await db
      .update(schema.webhookDeliveries)
      .set({ status: ok ? "succeeded" : final ? "dead" : "failed", attempts, responseStatus: r.status, responseBody: r.text.slice(0, 2000), error: ok ? null : `HTTP ${r.status}`, deliveredAt: ok ? new Date() : null })
      .where(eq(schema.webhookDeliveries.id, d.id));
    if (!ok) throw r.status === 410 ? new PermanentError("Endpoint answered 410 Gone and was switched off") : new Error(`HTTP ${r.status}`);
    return { status: r.status };
  },
  { timeoutMs: 20_000 },
);

/** Sends a webhook.test event to one endpoint. */
export async function sendTestEvent(projectId: string, endpointId: string) {
  const [e] = await db.select().from(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.projectId, projectId)));
  if (!e) throw notFound("Webhook endpoint");
  const evt: EventEnvelope = { id: `evt_${randomToken(12)}`, type: "webhook.test", createdAt: new Date().toISOString(), projectId, data: { message: "This is a test event from Cloudesk." } };
  const [d] = await db.insert(schema.webhookDeliveries).values({ endpointId: e.id, projectId, eventId: evt.id, event: evt.type, payload: evt }).returning();
  await enqueue("webhook.deliver", { deliveryId: d.id }, { projectId, maxAttempts: 3 });
  return d;
}
