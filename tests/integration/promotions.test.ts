import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as promos from "@/app/api/v1/projects/[projectId]/promotions/[[...slug]]/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as forms from "@/app/api/v1/sites/[deploymentId]/forms/[formId]/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let orgId = "";
let projectId = "";
let siteOnly = "";
let depId = "";
const P = (method: string, slug: string[] = [], body?: unknown, pid = projectId) => call(promos[method as "GET"], { method, cookie, body, params: { projectId: pid, slug } });
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
const serve = (path: string, ua = "Mozilla/5.0 (Macintosh) Safari") => siteServe.GET(new Request(`${ORIGIN}/sites/${depId}${path}`, { headers: { "user-agent": ua } }), { params: Promise.resolve({ deploymentId: depId, path: path.split("?")[0].split("/").filter(Boolean) }) });

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Priya Promo", email: "priya@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "store", name: "Loom" } })).json.project.id;
  siteOnly = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "cafe", name: "Brew" } })).json.project.id;
  await store("POST", "setup", { name: "Loom", country: "IN", region: "Karnataka", email: "hello@loom.example", replaceDesign: false });
  depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
});
afterAll(closeDb);

describe("promotions", () => {
  it("only promise what's real: codes must exist, cart extras need a store", async () => {
    // A draft may hold any code; switching it on needs the code to exist.
    const draft = (await P("POST", [], { preset: "exit" })).json.promotion;
    const r = await P("PUT", [draft.id], { ...draft, enabled: true });
    expect(r.status).toBe(422);
    expect(r.json.error.message).toMatch(/no discount code "STAY15"/);
    await P("DELETE", [draft.id]);
    expect((await P("POST", [], { preset: "goal" }, siteOnly)).status).toBe(422);
    const countdownNoEnd = await P("POST", [], { kind: "bar", name: "Sale", enabled: true, config: { messages: ["Sale ends in"], countdown: true } });
    expect(countdownNoEnd.status).toBe(422);
    expect(JSON.stringify(countdownNoEnd.json.error.details)).toMatch(/real end date/);
  });

  it("shows a live pop-up on the published site, under a policy that allows only its script", async () => {
    expect((await store("POST", "discounts", { code: "STAY15", kind: "percent", value: 15 })).status).toBe(201);
    const created = await P("POST", [], { preset: "exit" });
    expect(created.status).toBe(201);
    const p = created.json.promotion;
    // Drafts never appear.
    expect(await (await serve("/")).text()).not.toContain("ccp-pop");
    expect((await P("PUT", [p.id], { ...p, enabled: true })).status).toBe(200);
    const res = await serve("/");
    const html = await res.text();
    expect(html).toContain(`data-cc-promo="${p.id}"`);
    expect(html).toContain("STAY15");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+';/);
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
  });

  it("respects targeting and schedules", async () => {
    const bar = (await P("POST", [], { kind: "bar", name: "Home only", enabled: true, config: { messages: ["Hello from the home page"], targeting: { pages: "home" } } })).json.promotion;
    expect(await (await serve("/")).text()).toContain("Hello from the home page");
    expect(await (await serve("/shop")).text()).not.toContain("Hello from the home page");
    await P("PUT", [bar.id], { ...bar, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await (await serve("/")).text()).not.toContain("Hello from the home page");
  });

  it("adds free-delivery progress to the cart from the store's real rate", async () => {
    expect((await P("POST", [], { preset: "goal" })).status).toBe(201);
    const list = (await P("GET")).json;
    expect(list.store.freeOver).toBe(99900);
  });

  it("counts views from real visitors on production, and sign-ups from pop-up forms", async () => {
    const p = (await P("GET")).json.promotions.find((x: { kind: string; enabled: boolean }) => x.kind === "popup" && x.enabled);
    expect((await serve(`/__promo?id=${p.id}&e=view`)).status).toBe(204);
    await serve(`/__promo?id=${p.id}&e=view`, "Googlebot/2.1");
    await serve(`/__promo?id=${p.id}&e=click`);
    const f = new FormData();
    f.set("email", "shopper@example.com");
    await forms.POST(new Request(`${ORIGIN}/api/v1/sites/${depId}/forms/newsletter?page=/&promo=${p.id}`, { method: "POST", headers: { origin: ORIGIN, referer: `${ORIGIN}/sites/${depId}/` }, body: f }), { params: Promise.resolve({ deploymentId: depId, formId: "newsletter" }) });
    const stats = (await P("GET")).json.promotions.find((x: { id: string }) => x.id === p.id).stats;
    expect(stats).toEqual({ views: 1, clicks: 1, submits: 1 });
    const subs = await db.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.projectId, projectId));
    expect(subs.some((s) => (s.data as { email: string }).email === "shopper@example.com")).toBe(true);
  });

  it("can be deleted, taking it off the site at once", async () => {
    for (const p of (await P("GET")).json.promotions) expect((await P("DELETE", [p.id])).status).toBe(200);
    expect(await (await serve("/")).text()).not.toContain("ccp-root");
  });
});
