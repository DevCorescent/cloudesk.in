import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as growth from "@/app/api/v1/projects/[projectId]/growth/[[...slug]]/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { storeInsights } from "@/server/commerce/insights";
import { evaluateProject } from "@/server/growth/experiments";
import { loadDoc } from "@/server/growth/opportunities";
import { abBucket } from "@/server/services/stats";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";
let owner: { cookie: string; orgId: string };
let other: { cookie: string };
let projectId: string;

async function user(email: string) {
  const r = await call(signup.POST, { method: "POST", body: { name: email, email, password: "correct-horse-42" } });
  const cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  return { cookie, orgId: m.json.organizations[0].id as string };
}
const g = (method: string, path = "", body?: unknown, cookie = owner.cookie) => call(growth[method as "GET"], { method, cookie, body, params: { projectId, slug: path.split("/").filter(Boolean) } });
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie: owner.cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const today = () => new Date().toISOString().slice(0, 10);

async function traffic(expId: string, path: string, kind: string, A: [number, number], B: [number, number]) {
  const key = `g:${expId}`;
  const rows = [
    { kind: "view", variant: "A", count: A[0] },
    { kind, variant: "A", count: A[1] },
    { kind: "view", variant: "B", count: B[0] },
    { kind, variant: "B", count: B[1] },
  ];
  for (const r of rows)
    await db
      .insert(schema.siteStats)
      .values({ projectId, day: today(), path, experiment: key, ...r })
      .onConflictDoUpdate({ target: [schema.siteStats.projectId, schema.siteStats.day, schema.siteStats.path, schema.siteStats.kind, schema.siteStats.experiment, schema.siteStats.variant], set: { count: sql`${schema.siteStats.count} + ${r.count}` } });
}

beforeAll(async () => {
  await resetDb();
  owner = await user("olivia@example.com");
  other = await user("oscar@example.com");
  const p = await call(orgProjects.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { templateId: "blank", name: "Grow" } });
  projectId = p.json.project.id;
  await store("POST", "setup", { name: "Grow Shop", template: "fashion", country: "IN", region: "Karnataka", email: "owner@example.com", replaceDesign: true });
  for (const prod of (await store("GET", "products")).json.products) {
    const { id, createdAt: _c, updatedAt: _u, projectId: _p, isSample: _s, variants, ...rest } = prod;
    void _c; void _u; void _p; void _s;
    await store("PUT", `products/${id}`, { ...rest, isSample: false, variants: variants.map(({ id: vid, options, sku, price, compareAt, cost, trackInventory, stock, weightGrams }: Record<string, unknown>) => ({ id: vid, options, sku, price, compareAt, cost, trackInventory, stock, weightGrams })) });
  }
});

afterAll(async () => {
  await closeDb();
});

describe("growth autopilot", () => {
  it("is private to the organization", async () => {
    expect((await g("GET", "", undefined, other.cookie)).status).toBe(404);
  });

  it("suggests tests and store fixes from the site and its data", async () => {
    // A featured product that sells out should be flagged.
    const products = (await store("GET", "products")).json.products;
    const featured = products.find((p: { featured: boolean }) => p.featured);
    for (const v of featured.variants) await store("POST", `inventory/${v.id}`, { mode: "set", quantity: 0 });
    const r = await g("GET");
    expect(r.status).toBe(200);
    expect(r.json.aiAvailable).toBe(false);
    const tests = r.json.opportunities.filter((o: { kind: string }) => o.kind === "test");
    expect(tests.length).toBeGreaterThan(0);
    // Without an AI provider there are no AI-written tests.
    expect(tests.every((o: { test: { aiWritable: boolean } }) => !o.test.aiWritable)).toBe(true);
    const soldOut = r.json.opportunities.find((o: { title: string }) => o.title.includes("sold out but featured"));
    expect(soldOut).toBeDefined();
    const applied = await g("POST", `opportunities/${soldOut.key}/apply`, {});
    expect(applied.status).toBe(200);
    expect((await store("GET", `products/${featured.id}`)).json.product.featured).toBe(false);
  });

  it("runs a test end to end: serves both versions, counts store conversions, picks the winner and applies it", async () => {
    const r = await g("GET");
    const button = r.json.opportunities.find((o: { title: string }) => o.title.startsWith("Main button on"));
    expect(button).toBeDefined();
    const started = await g("POST", "tests", { opportunityKey: button.key });
    expect(started.status).toBe(201);
    const exp = started.json.experiment;
    expect(exp.metric).toBe("cart_add");
    expect((await g("POST", "tests", { opportunityKey: button.key })).status).toBe(409);

    let doc = (await loadDoc(projectId))!.doc;
    const hero = doc.pages[0].sections.find((s) => s.type === "hero")!;
    expect(hero.ab).toMatchObject({ running: true, experimentId: exp.id });
    const original = hero.props.primaryLabel;
    const newLabel = (exp.change.props as { primaryLabel: string }).primaryLabel;

    // Publish; each group sees its own button, and views are counted under the experiment.
    const dep = await call(deployments.POST, { method: "POST", cookie: owner.cookie, params: { projectId }, body: { environment: "production" } });
    expect(dep.json.deployment.status).toBe("ready");
    const seen = { A: "", B: "" };
    for (let i = 0; i < 40 && (!seen.A || !seen.B); i++) {
      const ua = `${UA} v${i}`;
      const res = await siteServe.GET(new Request(`${ORIGIN}/sites/${dep.json.deployment.id}`, { headers: { "user-agent": ua } }), { params: Promise.resolve({ deploymentId: dep.json.deployment.id, path: [] }) });
      const html = await res.text();
      seen[abBucket(null, ua, `g:${exp.id}`)] = html;
    }
    expect(seen.A).toContain(`>${original}<`);
    expect(seen.B).toContain(`>${newLabel}<`);
    const [views] = await db.select().from(schema.siteStats).where(and(eq(schema.siteStats.projectId, projectId), eq(schema.siteStats.experiment, `g:${exp.id}`), eq(schema.siteStats.kind, "view")));
    expect(views.count).toBeGreaterThan(0);

    // An add-to-cart is credited to the shopper's group, and the store funnel still counts it once.
    const variant = (await store("GET", "products")).json.products.find((p: { variants: { stock: number }[] }) => p.variants[0].stock > 0).variants[0].id;
    const f = new FormData();
    f.set("_base", "/s/acme/grow");
    f.set("action", "add");
    f.set("variant", variant);
    await cartRoute.POST(new Request(`${ORIGIN}/api/v1/store/${projectId}/cart`, { method: "POST", headers: { origin: ORIGIN, "user-agent": `${UA} shopper` }, body: f }), { params: Promise.resolve({ projectId }) });
    await new Promise((r) => setTimeout(r, 100));
    const attributed = await db.select().from(schema.siteStats).where(and(eq(schema.siteStats.experiment, `g:${exp.id}`), eq(schema.siteStats.kind, "cart_add")));
    expect(attributed).toHaveLength(1);
    expect(attributed[0].variant).toBe(abBucket(null, `${UA} shopper`, `g:${exp.id}`));
    expect((await storeInsights(projectId, 30)).funnel.addToCart).toBe(1);

    // Enough traffic for a clear winner.
    await traffic(exp.id, "/", "cart_add", [400, 12], [400, 40]);
    const decided = await evaluateProject(projectId);
    expect(decided).toEqual([{ id: exp.id, status: "won" }]);
    const list = (await g("GET")).json.experiments;
    const done = list.find((e: { id: string }) => e.id === exp.id);
    expect(done).toMatchObject({ status: "won", outcome: "applied" });
    expect(done.result.confidence).toBeGreaterThanOrEqual(0.95);
    doc = (await loadDoc(projectId))!.doc;
    const after = doc.pages[0].sections.find((s) => s.type === "hero")!;
    expect(after.props.primaryLabel).toBe(newLabel);
    expect(after.ab).toBeUndefined();
    const mail = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "olivia@example.com"));
    expect(mail.some((m) => m.subject.includes("found a winner"))).toBe(true);
    // The same idea is not suggested again.
    expect((await g("GET")).json.opportunities.some((o: { key: string }) => o.key === button.key)).toBe(false);
  });

  it("keeps the original when it wins, and ends unclear tests after 28 days", async () => {
    const opps = (await g("GET")).json.opportunities.filter((o: { kind: string }) => o.kind === "test");
    const a = await g("POST", "tests", { opportunityKey: opps[0].key });
    expect(a.status).toBe(201);
    await traffic(a.json.experiment.id, a.json.experiment.path, a.json.experiment.metric, [500, 50], [500, 15]);
    await evaluateProject(projectId);
    let e = (await g("GET")).json.experiments.find((x: { id: string }) => x.id === a.json.experiment.id);
    expect(e).toMatchObject({ status: "lost", outcome: "kept_original" });
    let doc = (await loadDoc(projectId))!.doc;
    expect(doc.pages.flatMap((p) => p.sections).some((s) => s.ab?.experimentId === e.id)).toBe(false);

    const next = (await g("GET")).json.opportunities.find((o: { kind: string }) => o.kind === "test");
    const b = await g("POST", "tests", { opportunityKey: next.key });
    await db.update(schema.growthExperiments).set({ startedAt: new Date(Date.now() - 30 * 86400_000) }).where(eq(schema.growthExperiments.id, b.json.experiment.id));
    await evaluateProject(projectId);
    e = (await g("GET")).json.experiments.find((x: { id: string }) => x.id === b.json.experiment.id);
    expect(e.status).toBe("inconclusive");
    doc = (await loadDoc(projectId))!.doc;
    expect(doc.pages.flatMap((p) => p.sections).some((s) => s.ab?.running)).toBe(false);
  });

  it("lets the owner stop a test, and refuses tests that change anything but text and layout", async () => {
    const o = (await g("GET")).json.opportunities.find((x: { kind: string }) => x.kind === "test");
    const s = await g("POST", "tests", { opportunityKey: o.key });
    expect((await g("POST", `tests/${s.json.experiment.id}/stop`, {})).status).toBe(200);
    const e = (await g("GET")).json.experiments.find((x: { id: string }) => x.id === s.json.experiment.id);
    expect(e.status).toBe("stopped");

    const doc = (await loadDoc(projectId))!.doc;
    const hero = doc.pages[0].sections.find((x) => x.type === "hero")!;
    const bad = await g("POST", "tests", { path: "/", sectionId: hero.id, title: "Sneaky", metric: "submit", change: { props: { image: "https://evil.example/x.png" } } });
    expect(bad.status).toBe(422);
    const long = await g("POST", "tests", { path: "/", sectionId: hero.id, title: "Long", metric: "submit", change: { props: { heading: "x".repeat(500) } } });
    expect(long.status).toBe(422);
  });

  it("saves autopilot settings for someone who can publish", async () => {
    const r = await g("PUT", "settings", { autoPublish: true, autoStart: true });
    expect(r.json.settings).toMatchObject({ autoApplyWinners: true, autoPublish: true, autoStart: true });
    expect((await g("GET")).json.settings).toMatchObject({ autoPublish: true, autoStart: true });
  });
});
