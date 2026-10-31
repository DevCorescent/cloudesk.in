import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import { parseSiteDoc, SITE_DOC_PATH, type SiteDoc } from "@/lib/site/model";
import { readFile } from "@/server/services/files";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let viewer = "";
let orgId = "";
let projectId = "";
const store = (cookie: string, method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
const site = async (): Promise<SiteDoc> => {
  const r = parseSiteDoc((await readFile(projectId, SITE_DOC_PATH)).content);
  if (!r.ok) throw new Error("bad doc");
  return r.doc;
};
const home = (d: SiteDoc) => d.pages.find((p) => p.path === "/") ?? d.pages[0];

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Asha", email: "asha.spa@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  // A salon workspace that had the store switched off at onboarding.
  await db.update(schema.organizations).set({ modules: ["bookings", "invoicing"], industry: "salon" }).where(eq(schema.organizations.id, orgId));
  projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner, params: { orgId }, body: { templateId: "spa", name: "Still Waters Spa" } })).json.project.id;
  viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik", email: "vik.spa@example.com", password: "correct-horse-42" } }));
  const vik = (await call(me.GET, { cookie: viewer })).json.user.id;
  await db.insert(schema.memberships).values({ orgId, userId: vik, role: "viewer" });
});
afterAll(closeDb);

describe("adding a store to an existing website", () => {
  it("refuses people who can't manage the store", async () => {
    expect((await store(viewer, "POST", "embed", { name: "Spa shop" })).status).toBe(403);
  });

  it("adds the store, samples and shop sections — keeping the website's design", async () => {
    const before = await site();
    const r = await store(owner, "POST", "embed", { name: "Still Waters Shop", country: "IN", sample: "beauty", placement: "after-hero", categories: true });
    expect(r.status).toBe(200);
    expect(r.json.store.name).toBe("Still Waters Shop");
    expect(r.json.seeded).toBeGreaterThan(0);
    expect(r.json.added).toEqual(expect.arrayContaining(["A Shop link in your menu", "Bestsellers and categories on your home page"]));

    const after = await site();
    // Same theme and every original section, plus the shop.
    expect(after.theme).toEqual(before.theme);
    const types = home(after).sections.map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(["productGrid", "collectionList"]));
    expect(types.filter((t) => t !== "productGrid" && t !== "collectionList")).toEqual(home(before).sections.map((s) => s.type));
    const nav = home(after).sections.find((s) => s.type === "navbar")!;
    expect(nav.props.showCart).toBe(true);

    const samples = await db.select().from(schema.storeProducts).where(and(eq(schema.storeProducts.projectId, projectId), eq(schema.storeProducts.isSample, true)));
    expect(samples.length).toBe(r.json.seeded);
    // The store is switched back on for the workspace.
    const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
    expect(org.modules).toContain("store");
    // The previous website is in history.
    const revs = await db.select().from(schema.fileRevisions).where(and(eq(schema.fileRevisions.projectId, projectId), eq(schema.fileRevisions.path, SITE_DOC_PATH)));
    expect(revs.some((x) => x.message === "Added the online store to the website")).toBe(true);
    expect(revs.length).toBeGreaterThanOrEqual(2);
  });

  it("running it again adds nothing twice", async () => {
    const r = await store(owner, "POST", "embed", { name: "Still Waters Shop", sample: "beauty" });
    expect(r.status).toBe(200);
    expect(r.json.seeded).toBe(0);
    const types = home(await site()).sections.map((s) => s.type);
    expect(types.filter((t) => t === "productGrid")).toHaveLength(1);
  });

  it("rejects an unknown sample catalogue", async () => {
    expect((await store(owner, "POST", "embed", { name: "x", sample: "nope" })).status).toBe(404);
  });
});
