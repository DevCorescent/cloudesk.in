import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as hook from "@/app/api/v1/hooks/w/[token]/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as automations from "@/app/api/v1/projects/[projectId]/automations/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as forms from "@/app/api/v1/sites/[deploymentId]/forms/[formId]/route";
import { emitWorkflowEvent, scheduleTick, setWorkflowHttp } from "@/server/automation/workflows";
import { backoffMs, defineJob, drain, enqueue, PermanentError, recoverStaleJobs, workOnce } from "@/server/jobs/queue";
import "@/server/jobs/registry";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
const a = (method: string, slug: string[] = [], body?: unknown) => call(automations[method as "GET"], { method, cookie, body, params: { projectId, slug } });
const job = async (id: string) => (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
/** Makes waiting/retrying jobs due now. */
const makeDue = () => db.update(schema.jobs).set({ runAt: new Date(Date.now() - 1000) });

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
let calls: Call[] = [];
let respond: (c: Call) => { status: number; text: string } = () => ({ status: 200, text: '{"ok":true}' });

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Ada Ops", email: "ada@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "restaurant", name: "Bistro" } })).json.project.id;
  setWorkflowHttp(async (url, opts) => {
    const c = { url, ...opts };
    calls.push(c);
    const r = respond(c);
    return { status: r.status, headers: {}, text: r.text, truncated: false };
  });
});
afterEach(() => {
  calls = [];
  respond = () => ({ status: 200, text: '{"ok":true}' });
});
afterAll(async () => {
  setWorkflowHttp(null);
  await closeDb();
});

describe("job queue", () => {
  it("retries with backoff, then gives up; permanent errors don't retry", async () => {
    let n = 0;
    defineJob("test.flaky", async () => {
      n++;
      if (n < 3) throw new Error(`boom ${n}`);
      return { n };
    });
    defineJob("test.permanent", async () => {
      throw new PermanentError("bad input");
    });
    const j = (await enqueue("test.flaky", {}, { maxAttempts: 5 }))!;
    await workOnce();
    let row = await job(j.id);
    expect(row).toMatchObject({ status: "failed", attempts: 1, lastError: "boom 1" });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 5000); // backed off
    await makeDue();
    await workOnce();
    await makeDue();
    await workOnce();
    row = await job(j.id);
    expect(row).toMatchObject({ status: "succeeded", attempts: 3, result: { n: 3 } });
    const p = (await enqueue("test.permanent", {}))!;
    await workOnce();
    expect(await job(p.id)).toMatchObject({ status: "dead", attempts: 1, lastError: "bad input" });
    expect(backoffMs(1)).toBeGreaterThanOrEqual(8000);
    expect(backoffMs(20)).toBeLessThanOrEqual(3600_000 * 1.2);
  });

  it("never runs a job twice under concurrent workers, de-duplicates, and recovers stale locks", async () => {
    let runs = 0;
    defineJob("test.count", async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 20));
    });
    for (let i = 0; i < 12; i++) await enqueue("test.count", { i });
    await Promise.all([workOnce(10), workOnce(10), workOnce(10)]);
    await drain();
    expect(runs).toBe(12);
    expect(await enqueue("test.count", {}, { dedupeKey: "once" })).not.toBeNull();
    expect(await enqueue("test.count", {}, { dedupeKey: "once" })).toBeNull();
    const s = (await enqueue("test.count", {}))!;
    await db.update(schema.jobs).set({ status: "running", lockedAt: new Date(Date.now() - 3600_000) }).where(eq(schema.jobs.id, s.id));
    expect(await recoverStaleJobs()).toBe(1);
    expect((await job(s.id)).status).toBe("failed");
  });
});

describe("automations", () => {
  let wid = "";

  it("is managed by builders with the right role", async () => {
    const created = await a("POST", [], {
      name: "Big order alert",
      trigger: { type: "order_paid", config: {} },
      steps: [
        { id: "big", type: "condition", config: { left: "{{trigger.total}}", op: "gt", right: "1000" } },
        { id: "mail", type: "send_email", config: { to: "ada@example.com", subject: "Order {{trigger.label}} paid", body: "{{trigger.customerName}} paid {{trigger.currency}} {{trigger.total}}" } },
        { id: "crm", type: "http_request", config: { method: "POST", url: "https://crm.example.com/hooks/orders", headers: { Authorization: "Bearer {{secrets.crmToken}}" }, body: '{"customer":"{{trigger.customerName}}","total":{{trigger.total}}}', failOn4xx: true } },
      ],
      secrets: { crmToken: "sk_live_123" },
    });
    expect(created.status).toBe(201);
    wid = created.json.workflow.id;
    expect(created.json.workflow.secretNames).toEqual(["crmToken"]);
    expect(JSON.stringify(created.json)).not.toContain("sk_live_123");
    const [row] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, wid));
    expect(row.secretsEnc).not.toContain("sk_live_123");
    expect((await a("POST", [], { name: "x", trigger: { type: "schedule", config: { cron: "99 * * * *", timezone: "UTC" } }, steps: [] })).status).toBe(422);
  });

  it("runs only when enabled; each step is a retried job; data can't break the JSON body", async () => {
    await emitWorkflowEvent(projectId, "order_paid", { label: "B1001", total: "2499.00", currency: "INR", customerName: 'Riya "R"', email: "riya@example.com" });
    expect(await db.select().from(schema.workflowRuns)).toHaveLength(0);
    expect((await a("POST", [wid, "enable"], {})).status).toBe(200);
    // A 503 is retried; the step before it is not repeated.
    let attempt = 0;
    respond = () => (++attempt === 1 ? { status: 503, text: "down" } : { status: 201, text: '{"id":"c_9"}' });
    await emitWorkflowEvent(projectId, "order_paid", { label: "B1002", total: "2499.00", currency: "INR", customerName: 'Riya "R"', email: "riya@example.com" });
    await drain();
    let [run] = await db.select().from(schema.workflowRuns);
    expect(run.status).toBe("running");
    await makeDue();
    await drain();
    [run] = await db.select().from(schema.workflowRuns);
    expect(run.status).toBe("succeeded");
    const steps = run.log as { id: string; status: string; output: unknown; attempts: number }[];
    expect(steps.map((s) => [s.id, s.status])).toEqual([["big", "succeeded"], ["mail", "succeeded"], ["crm", "succeeded"]]);
    expect(steps[2]).toMatchObject({ attempts: 2, output: { status: 201, body: { id: "c_9" } } });
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Authorization).toBe("Bearer sk_live_123");
    expect(JSON.parse(calls[1].body!)).toEqual({ customer: 'Riya "R"', total: 2499 });
    const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, "Order B1002 paid"));
    expect(mails).toHaveLength(1);
    expect(mails[0].body).toBe('Riya "R" paid INR 2499.00');
  });

  it("stops at a failed condition, and fails fast on a 4xx", async () => {
    await db.delete(schema.workflowRuns);
    await emitWorkflowEvent(projectId, "order_paid", { label: "B1003", total: "200.00", currency: "INR", customerName: "Sam", email: "sam@example.com" });
    respond = () => ({ status: 400, text: '{"error":"bad"}' });
    await emitWorkflowEvent(projectId, "order_paid", { label: "B1004", total: "5000.00", currency: "INR", customerName: "Sam", email: "sam@example.com" });
    await drain();
    const runs = await db.select().from(schema.workflowRuns);
    expect(runs.map((r) => r.status).sort()).toEqual(["failed", "stopped"]);
    expect(runs.find((r) => r.status === "failed")!.error).toMatch(/http_request: The service answered 400/);
  });

  it("emails only teammates or the trigger's own address", async () => {
    const w = await a("POST", [], { name: "Leak", trigger: { type: "manual", config: {} }, steps: [{ id: "m", type: "send_email", config: { to: "{{trigger.to}}", subject: "s", body: "b" } }] });
    const r1 = await a("POST", [w.json.workflow.id, "run"], { input: { to: "stranger@evil.example" } });
    expect(r1.status).toBe(202);
    await drain();
    const [run] = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, r1.json.run.id));
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/teammates, or to the customer from a form, order or booking/);
    // Manual runs can't email an address just because it is in the input…
    const r2 = await a("POST", [w.json.workflow.id, "run"], { input: { to: "customer@example.com", email: "customer@example.com" } });
    await drain();
    expect((await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, r2.json.run.id)))[0].status).toBe("failed");
    // …but an order's own customer can be thanked.
    const t = await a("POST", [], { name: "Thanks", trigger: { type: "order_placed", config: {} }, steps: [{ id: "m", type: "send_email", config: { to: "{{trigger.email}}", subject: "Thanks for your order", body: "b" } }] });
    await a("POST", [t.json.workflow.id, "enable"], {});
    await emitWorkflowEvent(projectId, "order_placed", { email: "customer@example.com", label: "B2001" });
    await drain();
    expect(await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "customer@example.com"))).toHaveLength(1);
  });

  it("waits on a delay as a scheduled job, and can be stopped while waiting", async () => {
    const w = await a("POST", [], { name: "Follow-up", trigger: { type: "manual", config: {} }, steps: [{ id: "wait", type: "delay", config: { amount: 2, unit: "days" } }, { id: "m", type: "send_email", config: { to: "ada@example.com", subject: "Follow up", body: "x" } }] });
    const r = await a("POST", [w.json.workflow.id, "run"], { input: {} });
    await drain();
    const [run] = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, r.json.run.id));
    expect(run.status).toBe("waiting");
    const [next] = await db.select().from(schema.jobs).where(eq(schema.jobs.status, "queued"));
    expect(next.runAt.getTime() - Date.now()).toBeGreaterThan(47 * 3600_000);
    expect((await a("POST", [w.json.workflow.id, "runs", r.json.run.id, "stop"], {})).status).toBe(200);
    await makeDue();
    await drain();
    expect(await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, "Follow up"))).toHaveLength(0);
  });

  it("starts from a published form and from a secret webhook", async () => {
    const f = await a("POST", [], { name: "New lead", trigger: { type: "form_submitted", config: { formId: "contact" } }, steps: [{ id: "slack", type: "slack", config: { text: "New lead: {{trigger.data.name}} <{{trigger.data.email}}>" } }], secrets: { slackWebhookUrl: "https://hooks.slack.com/services/T0/B0/xyz" } });
    await a("POST", [f.json.workflow.id, "enable"], {});
    const dep = await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "preview" } });
    const fd = new FormData();
    fd.set("name", "Priya");
    fd.set("email", "priya@example.com");
    fd.set("message", "Table for 4?");
    const res = await forms.POST(new Request(`${ORIGIN}/api/v1/sites/${dep.json.deployment.id}/forms/contact?page=/`, { method: "POST", headers: { origin: ORIGIN }, body: fd }), { params: Promise.resolve({ deploymentId: dep.json.deployment.id, formId: "contact" }) });
    expect(res.status).toBe(303);
    await drain();
    expect(calls.at(-1)).toMatchObject({ url: "https://hooks.slack.com/services/T0/B0/xyz" });
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ text: "New lead: Priya <priya@example.com>" });

    const h = await a("POST", [], { name: "Inbound", trigger: { type: "webhook", config: {} }, steps: [{ id: "c", type: "condition", config: { left: "{{trigger.body.event}}", op: "equals", right: "signup" } }] });
    const { url } = (await a("POST", [h.json.workflow.id, "webhook"], {})).json;
    const token = url.split("/").pop();
    const post = (t: string) => hook.POST(new Request(`${ORIGIN}/api/v1/hooks/w/${t}`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"event":"signup"}' }), { params: Promise.resolve({ token: t }) });
    expect((await post(token)).status).toBe(404); // not enabled yet
    await a("POST", [h.json.workflow.id, "enable"], {});
    const ok = await post(token);
    expect(ok.status).toBe(202);
    await drain();
    const [run] = await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, (await ok.json()).runId));
    expect(run).toMatchObject({ status: "succeeded", input: { body: { event: "signup" } } });
    expect((await post("not-a-real-token-at-all-xx")).status).toBe(404);
  });

  it("fires a schedule once per matching minute, even with two ticks", async () => {
    const s = await a("POST", [], { name: "Daily digest", trigger: { type: "schedule", config: { cron: "0 9 * * *", timezone: "Asia/Kolkata" } }, steps: [{ id: "m", type: "send_email", config: { to: "ada@example.com", subject: "Digest {{trigger.local}}", body: "x" } }] });
    await a("POST", [s.json.workflow.id, "enable"], {});
    await db.update(schema.workflows).set({ lastScheduledAt: null }).where(eq(schema.workflows.id, s.json.workflow.id));
    const nine = new Date("2026-10-22T03:30:20Z"); // 09:00 in Kolkata
    expect(await Promise.all([scheduleTick(nine), scheduleTick(nine)])).toEqual(expect.arrayContaining([1, 0]));
    expect(await scheduleTick(new Date("2026-10-22T03:31:00Z"))).toBe(0);
    await drain();
    expect((await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, "Digest 2026-10-22 09:00"))).length).toBe(1);
    const preview = await a("GET", ["cron"]);
    expect(preview.json.error).toBeTruthy();
  });
});
