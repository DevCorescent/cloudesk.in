import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as hubApi from "@/app/api/v1/orgs/[orgId]/hub/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as erp from "@/app/api/v1/erp/[[...path]]/route";
import { deliver, setHubHttp } from "@/server/hub/core";
import { DISABLE_AFTER } from "@/lib/hub/model";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Webhooks for ERP events (filtered, signed, retried, switched off after too
// many failures, redelivered, reconciled), workspace API keys and the ERP API
// (scopes, versions, pages, writes, logging), and retrying background work.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const H = mk(hubApi, "hub");
const CRM = mk(crmApi, "crm");
type Sent = { url: string; headers: Record<string, string>; body: string };
const sent: Sent[] = [];
let answer = 200;
async function E(method: "GET" | "POST", path: string, key: string | null, body?: unknown, version?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  if (version) headers["cloudesk-version"] = version;
  const res = await erp[method](new Request(`${ORIGIN}/api/v1/erp/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ path: seg(path) }) });
  return { status: res.status, version: res.headers.get("cloudesk-version"), json: await res.json() };
}
const pending = async () => db.select().from(schema.orgWebhookDeliveries).where(and(eq(schema.orgWebhookDeliveries.orgId, orgId), eq(schema.orgWebhookDeliveries.status, "pending")));

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Hari Hub", email: "hari.hub@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik View", email: "vik.hub@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "vik.hub@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "admin" });
  setHubHttp(async (url, opts) => {
    sent.push({ url, headers: opts.headers, body: opts.body });
    return { status: answer, text: answer === 200 ? "ok" : "nope", headers: {} } as never;
  });
});
afterAll(async () => {
  setHubHttp(null);
  await closeDb();
});

describe("webhooks", () => {
  it("sends the events an endpoint asked for, signed with its secret", async () => {
    const r = (await H("POST", "webhooks", { url: "https://erp.example.com/hooks", events: ["crm.contact.created", "crm.deal.won"], description: "Our ERP" })).json;
    ids.hook = r.endpoint.id;
    ids.secret = r.secret;
    expect(r.secret).toMatch(/^whsec_/);
    expect((await H("GET", "webhooks")).json.webhooks[0]).not.toHaveProperty("secretEnc");
    expect((await H("POST", "webhooks", { url: "ftp://x.example.com", events: ["*"] })).status).toBe(422);
    await CRM("GET", "meta");
    await CRM("POST", "contacts", { name: "Asha", email: "asha@lumen.example" });
    await CRM("POST", "companies", { name: "Lumen" });
    const [d] = await pending();
    expect(d.event).toBe("crm.contact.created");
    await deliver(d.id, false);
    const last = sent.at(-1)!;
    expect(last.url).toBe("https://erp.example.com/hooks");
    const [t, v1] = last.headers["CC-Signature"].split(",").map((x) => x.split("=")[1]);
    expect(v1).toBe(createHmac("sha256", ids.secret).update(`${t}.${last.body}`).digest("hex"));
    expect(JSON.parse(last.body)).toMatchObject({ type: "crm.contact.created", orgId, data: { name: "Asha", email: "asha@lumen.example" } });
    expect((await db.select().from(schema.orgWebhookDeliveries).where(eq(schema.orgWebhookDeliveries.id, d.id)))[0]).toMatchObject({ status: "succeeded", responseStatus: 200, attempts: 1 });
  });

  it("retries failures, gives up at the last attempt, and can redeliver", async () => {
    answer = 500;
    await CRM("POST", "contacts", { name: "Ravi", email: "ravi@x.example" });
    const [d] = await pending();
    await expect(deliver(d.id, false)).rejects.toThrow("HTTP 500");
    expect((await db.select().from(schema.orgWebhookDeliveries).where(eq(schema.orgWebhookDeliveries.id, d.id)))[0].status).toBe("failed");
    await expect(deliver(d.id, true)).rejects.toThrow();
    expect((await db.select().from(schema.orgWebhookDeliveries).where(eq(schema.orgWebhookDeliveries.id, d.id)))[0].status).toBe("dead");
    answer = 200;
    await H("POST", `deliveries/${d.id}/retry`);
    await deliver(d.id, false);
    expect((await db.select().from(schema.orgWebhookDeliveries).where(eq(schema.orgWebhookDeliveries.id, d.id)))[0].status).toBe("succeeded");
    const rec = (await H("GET", "reconciliation")).json.days[0];
    expect(rec).toMatchObject({ endpoint: "https://erp.example.com/hooks", sent: 2, delivered: 2, failed: 0 });
  });

  it("switches an endpoint off after too many failures in a row", async () => {
    answer = 503;
    await db.update(schema.orgWebhooks).set({ failures: DISABLE_AFTER - 1 }).where(eq(schema.orgWebhooks.id, ids.hook));
    await CRM("POST", "contacts", { name: "Neha", email: "neha@x.example" });
    const [d] = await pending();
    await expect(deliver(d.id, false)).rejects.toThrow();
    const [w] = await db.select().from(schema.orgWebhooks).where(eq(schema.orgWebhooks.id, ids.hook));
    expect(w).toMatchObject({ enabled: false, disabledReason: `${DISABLE_AFTER} deliveries in a row failed` });
    answer = 200;
    expect((await H("PATCH", `webhooks/${ids.hook}`, { enabled: true })).json.webhook).toMatchObject({ enabled: true, failures: 0, disabledReason: "" });
  });
});

describe("the ERP API", () => {
  it("issues scoped keys shown once, and answers only with them", async () => {
    const r = (await H("POST", "keys", { name: "Warehouse sync", scopes: ["contacts:read", "tickets:write"] })).json;
    ids.key = r.key;
    ids.keyId = r.id;
    expect(r.key).toMatch(/^ck_org_/);
    expect(JSON.stringify((await H("GET", "keys")).json)).not.toContain(r.key);
    expect((await E("GET", "contacts", null)).status).toBe(401);
    expect((await E("GET", "contacts", "ck_org_" + "x".repeat(40))).status).toBe(401);
    const first = await E("GET", "contacts?limit=2", ids.key);
    expect(first.status).toBe(200);
    expect(first.version).toBe("2026-10-25");
    expect(first.json.data.map((c: { name: string }) => c.name)).toEqual(["Asha", "Ravi"]);
    const next = await E("GET", `contacts?limit=2&cursor=${first.json.next_cursor}`, ids.key);
    expect(next.json.data.map((c: { name: string }) => c.name)).toEqual(["Neha"]);
    expect(next.json.next_cursor).toBeNull();
    expect((await E("GET", "contacts", ids.key, undefined, "2020-01-01")).status).toBe(400);
    expect((await E("GET", "deals", ids.key)).status).toBe(403);
    expect((await E("POST", "contacts", ids.key, { name: "X" })).status).toBe(403);
    expect((await E("GET", "openapi.json", null)).json.openapi).toBe("3.1.0");
  });

  it("opens a ticket through the API, logs calls, and stops working when revoked", async () => {
    const t = await E("POST", "tickets", ids.key, { subject: "Sensor offline", customer_email: "ops@plant.example" });
    expect(t.status).toBe(201);
    expect(t.json.data.number).toBe("HD-0001");
    expect((await db.select().from(schema.hdTickets).where(eq(schema.hdTickets.id, t.json.data.id)))[0].channel).toBe("api");
    expect((await E("POST", "tickets", ids.key, { customer_email: "x" })).status).toBe(422);
    const calls = await db.select().from(schema.orgApiCalls).where(eq(schema.orgApiCalls.orgId, orgId));
    expect(calls.length).toBe(6);
    expect(calls.some((c) => c.path === "/tickets" && c.status === 201)).toBe(true);
    await H("DELETE", `keys/${ids.keyId}`);
    expect((await E("GET", "contacts", ids.key)).status).toBe(401);
  });
});

describe("background work", () => {
  it("shows what failed and retries it", async () => {
    const [j] = await db.insert(schema.jobs).values({ kind: "hub.deliver", payload: { deliveryId: "00000000-0000-0000-0000-000000000000" }, status: "dead", attempts: 8, lastError: "HTTP 500", orgId }).returning();
    const r = (await H("GET", "jobs")).json;
    expect(r.counts.dead).toBeGreaterThanOrEqual(1);
    expect(r.problems.map((p: { id: string }) => p.id)).toContain(j.id);
    await H("POST", `jobs/${j.id}/retry`);
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, j.id)))[0]).toMatchObject({ status: "queued", attempts: 0 });
  });
});
