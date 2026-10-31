// The workspace integration hub: webhooks for ERP events (signed, retried
// with backoff, logged; switched off after many failures in a row), keys for
// the ERP API, the background work behind it (what failed, retrying it), and
// a daily reconciliation of events sent against events delivered.
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DISABLE_AFTER, endpointSchema, ERP_EVENTS, keySchema, reconcile, type ErpEvent, type ErpScope } from "@/lib/hub/model";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { defineJob, enqueue, PermanentError } from "../jobs/queue";
import { log } from "../log";
import { safeRequest, validateUrl, type SafeResponse } from "../net/safe-fetch";
import { signPayload } from "../events/webhooks";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken, sha256 } from "../security/tokens";
import { audit } from "../services/audit";
import { check } from "../helpdesk/access";

export type Scope = { orgId: string; userId: string; role: Role; manage: boolean };
const W = schema.orgWebhooks;
const Dl = schema.orgWebhookDeliveries;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
export const MAX_ENDPOINTS = 20;
export const MAX_KEYS = 25;

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "audit:read");
  return { orgId, userId: ctx.user.id, role, manage: can(role, "integrations:manage") };
}
const requireManage = (s: Scope) => {
  if (!s.manage) throw new ApiError("forbidden", "Only owners, admins and developers can change integrations");
};

type Http = (url: string, opts: { method: string; headers: Record<string, string>; body: string }) => Promise<SafeResponse>;
let http: Http = (url, opts) => safeRequest(url, { ...opts, maxBytes: 8000, timeoutMs: 10_000 });
/** Test hook. */
export function setHubHttp(fn: Http | null) {
  http = fn ?? ((url, opts) => safeRequest(url, { ...opts, maxBytes: 8000, timeoutMs: 10_000 }));
}

// ── Webhooks ────────────────────────────────────────────────────────────────

/** A webhook without its (encrypted) secret. */
const hide = (e: typeof W.$inferSelect) => {
  const { secretEnc, ...rest } = e;
  void secretEnc;
  return rest;
};

export async function endpoints(s: Scope) {
  return (await db.select().from(W).where(eq(W.orgId, s.orgId)).orderBy(desc(W.createdAt))).map(hide);
}

export async function createEndpoint(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(endpointSchema, raw);
  await validateUrl(v.url);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(W).where(eq(W.orgId, s.orgId));
  if (n >= MAX_ENDPOINTS) throw new ApiError("conflict", `A workspace can have up to ${MAX_ENDPOINTS} webhooks`);
  const secret = `whsec_${randomToken(24)}`;
  const [e] = await db.insert(W).values({ ...v, orgId: s.orgId, secretEnc: encryptSecret(secret), createdBy: s.userId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hub.webhook_created", targetType: "org_webhook", targetId: e.id, metadata: { url: v.url, events: v.events } });
  return { endpoint: hide(e), secret };
}

export async function updateEndpoint(s: Scope, id: string, raw: unknown) {
  requireManage(s);
  if (!isId(id)) throw notFound("Webhook");
  const v = check(z.object({ events: endpointSchema.shape.events.optional(), description: z.string().trim().max(200).optional(), enabled: z.boolean().optional() }), raw);
  const [e] = await db.update(W).set({ ...(v.events ? { events: v.events } : {}), ...(v.description !== undefined ? { description: v.description } : {}), ...(typeof v.enabled === "boolean" ? { enabled: v.enabled, ...(v.enabled ? { failures: 0, disabledReason: "" } : {}) } : {}) }).where(and(eq(W.id, id), eq(W.orgId, s.orgId))).returning();
  if (!e) throw notFound("Webhook");
  return hide(e);
}

export async function deleteEndpoint(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Webhook");
  const [e] = await db.delete(W).where(and(eq(W.id, id), eq(W.orgId, s.orgId))).returning();
  if (!e) throw notFound("Webhook");
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hub.webhook_deleted", targetType: "org_webhook", targetId: id, metadata: { url: e.url } });
}

export async function rollSecret(s: Scope, id: string) {
  requireManage(s);
  const secret = `whsec_${randomToken(24)}`;
  const [e] = await db.update(W).set({ secretEnc: encryptSecret(secret) }).where(and(eq(W.id, id), eq(W.orgId, s.orgId))).returning({ id: W.id });
  if (!e) throw notFound("Webhook");
  return { secret };
}

export async function deliveries(s: Scope, endpointId: string, q: { status?: string } = {}) {
  if (!isId(endpointId)) throw notFound("Webhook");
  return db.select({ id: Dl.id, event: Dl.event, eventId: Dl.eventId, status: Dl.status, attempts: Dl.attempts, responseStatus: Dl.responseStatus, responseBody: Dl.responseBody, error: Dl.error, createdAt: Dl.createdAt, deliveredAt: Dl.deliveredAt }).from(Dl).where(and(eq(Dl.orgId, s.orgId), eq(Dl.endpointId, endpointId), q.status ? eq(Dl.status, q.status) : sql`true`)).orderBy(desc(Dl.createdAt)).limit(200);
}

/**
 * Tell subscribed endpoints that something happened. Never throws: a webhook
 * problem must not undo the work that raised the event.
 */
export async function emit(orgId: string, type: ErpEvent, data: Record<string, unknown>) {
  try {
    const list = await db.select({ id: W.id, events: W.events }).from(W).where(and(eq(W.orgId, orgId), eq(W.enabled, true)));
    const to = list.filter((e) => e.events.includes("*") || e.events.includes(type) || type === "hub.test");
    if (!to.length) return 0;
    const evt = { id: `evt_${randomToken(12)}`, type, createdAt: new Date().toISOString(), orgId, data };
    for (const e of to) {
      const [d] = await db.insert(Dl).values({ orgId, endpointId: e.id, eventId: evt.id, event: type, payload: evt }).returning({ id: Dl.id });
      await enqueue("hub.deliver", { deliveryId: d.id }, { orgId, maxAttempts: 8 });
    }
    return to.length;
  } catch (e) {
    log.warn("hub.emit_failed", { orgId, type, err: String(e) });
    return 0;
  }
}

export async function sendTest(s: Scope, id: string) {
  requireManage(s);
  const [e] = await db.select({ id: W.id }).from(W).where(and(eq(W.id, id), eq(W.orgId, s.orgId)));
  if (!e) throw notFound("Webhook");
  const evt = { id: `evt_${randomToken(12)}`, type: "hub.test", createdAt: new Date().toISOString(), orgId: s.orgId, data: { message: "This is a test event from Cloudesk." } };
  const [d] = await db.insert(Dl).values({ orgId: s.orgId, endpointId: e.id, eventId: evt.id, event: "hub.test", payload: evt }).returning();
  await enqueue("hub.deliver", { deliveryId: d.id }, { orgId: s.orgId, maxAttempts: 1 });
  return { deliveryId: d.id };
}

export async function redeliver(s: Scope, deliveryId: string) {
  requireManage(s);
  if (!isId(deliveryId)) throw notFound("Delivery");
  const [d] = await db.update(Dl).set({ status: "pending", error: null }).where(and(eq(Dl.id, deliveryId), eq(Dl.orgId, s.orgId))).returning({ id: Dl.id });
  if (!d) throw notFound("Delivery");
  await enqueue("hub.deliver", { deliveryId: d.id }, { orgId: s.orgId, maxAttempts: 8 });
  return { ok: true };
}

/** Send one delivery. Exported for tests (jobs run it in production). */
export async function deliver(deliveryId: string, final: boolean) {
  const [d] = await db.select().from(Dl).where(eq(Dl.id, deliveryId));
  if (!d || d.status === "succeeded") return { skipped: true };
  const [e] = await db.select().from(W).where(eq(W.id, d.endpointId));
  if (!e || !e.enabled) {
    await db.update(Dl).set({ status: "dead", error: "Webhook removed or switched off" }).where(eq(Dl.id, d.id));
    return { skipped: true };
  }
  const body = JSON.stringify(d.payload);
  const attempts = d.attempts + 1;
  let r: SafeResponse | null = null;
  let err = "";
  try {
    r = await http(e.url, { method: "POST", headers: { "Content-Type": "application/json", "CC-Event": d.event, "CC-Delivery": d.id, "CC-Signature": signPayload(decryptSecret(e.secretEnc), body) }, body });
  } catch (x) {
    err = (x as Error).message.slice(0, 500);
  }
  const ok = !!r && r.status >= 200 && r.status < 300;
  const gone = r?.status === 410;
  const dead = ok ? false : gone || final;
  await db.update(Dl).set({ status: ok ? "succeeded" : dead ? "dead" : "failed", attempts, responseStatus: r?.status ?? null, responseBody: r?.text.slice(0, 2000) ?? null, error: ok ? null : err || `HTTP ${r?.status}`, deliveredAt: ok ? new Date() : null }).where(eq(Dl.id, d.id));
  if (ok) {
    if (e.failures) await db.update(W).set({ failures: 0 }).where(eq(W.id, e.id));
    return { status: r!.status };
  }
  // Too many failures in a row (or 410 Gone): switch it off and say why.
  const failures = e.failures + 1;
  const off = gone || failures >= DISABLE_AFTER;
  await db.update(W).set({ failures, ...(off ? { enabled: false, disabledReason: gone ? "The receiver answered 410 Gone" : `${failures} deliveries in a row failed` } : {}) }).where(eq(W.id, e.id));
  if (off) await audit({ orgId: e.orgId, actorId: null, action: "hub.webhook_disabled", targetType: "org_webhook", targetId: e.id, metadata: { url: e.url, failures } });
  if (gone) throw new PermanentError("The receiver answered 410 Gone; the webhook was switched off");
  throw new Error(err || `HTTP ${r?.status}`);
}

defineJob<{ deliveryId: string }>("hub.deliver", ({ deliveryId }, { job }) => deliver(deliveryId, job.attempts >= job.maxAttempts), { timeoutMs: 20_000 });

/** Per day and webhook: events sent, delivered, failed for good, still trying. */
export async function reconciliation(s: Scope, days = 14) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = (await db.execute(sql`select to_char(d.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, w.url as endpoint, d.status, count(*)::int as n from org_webhook_deliveries d join org_webhooks w on w.id = d.endpoint_id where d.org_id = ${s.orgId} and d.created_at >= ${since} group by 1, 2, 3`)) as unknown as { rows: { day: string; endpoint: string; status: string; n: number }[] };
  return reconcile(rows.rows);
}

// ── API keys ────────────────────────────────────────────────────────────────

const K = schema.orgApiKeys;

export async function keys(s: Scope) {
  return db.select({ id: K.id, name: K.name, prefix: K.prefix, scopes: K.scopes, lastUsedAt: K.lastUsedAt, expiresAt: K.expiresAt, revokedAt: K.revokedAt, createdAt: K.createdAt }).from(K).where(eq(K.orgId, s.orgId)).orderBy(desc(K.createdAt));
}

export async function createKey(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(keySchema, raw);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(K).where(and(eq(K.orgId, s.orgId), isNull(K.revokedAt)));
  if (n >= MAX_KEYS) throw new ApiError("conflict", `A workspace can have up to ${MAX_KEYS} active keys`);
  const key = `ck_org_${randomToken(30)}`;
  const [row] = await db.insert(K).values({ orgId: s.orgId, name: v.name, prefix: key.slice(0, 15), keyHash: sha256(key), scopes: [...new Set(v.scopes)], createdBy: s.userId, expiresAt: v.expiresInDays ? new Date(Date.now() + v.expiresInDays * 86_400_000) : null }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hub.api_key_created", targetType: "org_api_key", targetId: row.id, metadata: { name: v.name, scopes: v.scopes } });
  return { key, id: row.id };
}

export async function revokeKey(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("API key");
  const [r] = await db.update(K).set({ revokedAt: new Date() }).where(and(eq(K.id, id), eq(K.orgId, s.orgId), isNull(K.revokedAt))).returning({ id: K.id, name: K.name });
  if (!r) throw notFound("API key");
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hub.api_key_revoked", targetType: "org_api_key", targetId: id, metadata: { name: r.name } });
}

/** A bearer key to its workspace and scopes, or null (unknown, revoked, expired). */
export async function resolveKey(raw: string | null) {
  if (!raw || !/^ck_org_[\w-]{30,60}$/.test(raw)) return null;
  const [k] = await db.select().from(K).where(and(eq(K.keyHash, sha256(raw)), isNull(K.revokedAt)));
  if (!k || (k.expiresAt && k.expiresAt.getTime() < Date.now())) return null;
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) await db.update(K).set({ lastUsedAt: new Date() }).where(eq(K.id, k.id));
  return { keyId: k.id, orgId: k.orgId, scopes: k.scopes as ErpScope[] };
}

export async function usage(s: Scope) {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = (await db.execute(sql`select k.name, c.status, count(*)::int as n, round(avg(c.ms))::int as ms from org_api_calls c left join org_api_keys k on k.id = c.key_id where c.org_id = ${s.orgId} and c.at >= ${since} group by 1, 2 order by 3 desc`)) as unknown as { rows: { name: string | null; status: number; n: number; ms: number }[] };
  return rows.rows;
}

// ── Background work ─────────────────────────────────────────────────────────

const J = schema.jobs;

export async function jobs(s: Scope) {
  const since = new Date(Date.now() - 86_400_000);
  const [counts] = await db.select({ queued: sql<number>`count(*) filter (where ${J.status} = 'queued')::int`, running: sql<number>`count(*) filter (where ${J.status} = 'running')::int`, retrying: sql<number>`count(*) filter (where ${J.status} = 'failed')::int`, dead: sql<number>`count(*) filter (where ${J.status} = 'dead')::int`, done: sql<number>`count(*) filter (where ${J.status} = 'succeeded' and ${J.finishedAt} >= ${since})::int` }).from(J).where(eq(J.orgId, s.orgId));
  const problems = await db.select({ id: J.id, kind: J.kind, status: J.status, attempts: J.attempts, maxAttempts: J.maxAttempts, lastError: J.lastError, runAt: J.runAt, createdAt: J.createdAt }).from(J).where(and(eq(J.orgId, s.orgId), inArray(J.status, ["failed", "dead"]))).orderBy(desc(J.createdAt)).limit(100);
  const [dl] = await db.select({ dead: sql<number>`count(*) filter (where ${Dl.status} = 'dead')::int`, failing: sql<number>`count(*) filter (where ${Dl.status} = 'failed')::int` }).from(Dl).where(and(eq(Dl.orgId, s.orgId), gte(Dl.createdAt, new Date(Date.now() - 7 * 86_400_000))));
  return { counts, problems, webhooks: dl };
}

export async function retryJob(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Job");
  const [r] = await db.update(J).set({ status: "queued", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null }).where(and(eq(J.id, id), eq(J.orgId, s.orgId), inArray(J.status, ["dead", "failed"]))).returning({ id: J.id });
  if (!r) throw notFound("Job");
  return { ok: true };
}

export const eventCatalogue = () => Object.entries(ERP_EVENTS).map(([id, description]) => ({ id, description }));

/** Keep API call logs 30 days and delivered webhook logs 90 days. */
export async function prune(now = new Date()) {
  await db.delete(schema.orgApiCalls).where(sql`${schema.orgApiCalls.at} < ${new Date(now.getTime() - 30 * 86_400_000)}`);
  await db.delete(Dl).where(and(sql`${Dl.createdAt} < ${new Date(now.getTime() - 90 * 86_400_000)}`, inArray(Dl.status, ["succeeded", "dead"])));
  // Replayed offline writes arrive within days; a week of answers is plenty.
  await db.delete(schema.idempotentWrites).where(sql`${schema.idempotentWrites.createdAt} < ${new Date(now.getTime() - 7 * 86_400_000)}`);
}
