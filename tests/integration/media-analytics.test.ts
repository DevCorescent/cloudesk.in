import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as analytics from "@/app/api/v1/projects/[projectId]/analytics/route";
import * as assets from "@/app/api/v1/projects/[projectId]/assets/route";
import * as assetDelete from "@/app/api/v1/projects/[projectId]/assets/[assetId]/route";
import * as brandImport from "@/app/api/v1/projects/[projectId]/brand-import/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import * as siteForm from "@/app/api/v1/sites/[deploymentId]/forms/[formId]/route";
import * as serveAsset from "@/app/assets/[assetId]/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

async function newUser(name: string, email: string) {
  const r = await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } });
  const cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  return { cookie, orgId: m.json.organizations[0].id as string };
}

async function upload(projectId: string, cookie: string, bytes: Buffer, name: string, type = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  const req = new Request(`${ORIGIN}/api/v1/projects/${projectId}/assets`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: form });
  const res = await assets.POST(req, { params: Promise.resolve({ projectId }) });
  return { status: res.status, json: await res.json() };
}

let owner: Awaited<ReturnType<typeof newUser>>;
let other: Awaited<ReturnType<typeof newUser>>;
let projectId: string;

beforeAll(async () => {
  await resetDb();
  owner = await newUser("Olivia Owner", "olivia@example.com");
  other = await newUser("Oscar Other", "oscar@example.com");
  const r = await call(orgProjects.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { templateId: "cafe", name: "Bean There" } });
  projectId = r.json.project.id;
});

afterAll(async () => {
  await closeDb();
});

describe("media library", () => {
  let assetId: string;

  it("accepts real images, de-duplicates, and serves them with safe headers", async () => {
    const first = await upload(projectId, owner.cookie, PNG, "logo.png");
    expect(first.status).toBe(201);
    assetId = first.json.asset.id;
    const again = await upload(projectId, owner.cookie, PNG, "copy.png");
    expect(again.json.asset).toMatchObject({ id: assetId, duplicate: true });

    const res = await serveAsset.GET(new Request(`${ORIGIN}/assets/${assetId}`), { params: Promise.resolve({ assetId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("rejects SVG and files that only claim to be images", async () => {
    const svg = await upload(projectId, owner.cookie, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "x.svg", "image/svg+xml");
    expect(svg.status).toBe(422);
    const fake = await upload(projectId, owner.cookie, Buffer.from("<html>hi</html>"), "photo.png", "image/png");
    expect(fake.status).toBe(422);
  });

  it("keeps each organization's library private", async () => {
    expect((await call(assets.GET, { cookie: other.cookie, params: { projectId } })).status).toBe(404);
    expect((await upload(projectId, other.cookie, PNG, "x.png")).status).toBe(404);
    expect((await call(assetDelete.DELETE, { method: "DELETE", cookie: other.cookie, params: { projectId, assetId } })).status).toBe(404);
    expect((await call(assets.GET, { cookie: owner.cookie, params: { projectId } })).json.assets).toHaveLength(1);
  });
});

describe("brand import", () => {
  it("refuses private and internal addresses (SSRF)", async () => {
    for (const url of ["http://127.0.0.1:3000/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "file:///etc/passwd"]) {
      const r = await call(brandImport.POST, { method: "POST", cookie: owner.cookie, params: { projectId }, body: { url } });
      expect(r.status, url).toBe(422);
    }
  });
  it("is not available to other organizations", async () => {
    expect((await call(brandImport.POST, { method: "POST", cookie: other.cookie, params: { projectId }, body: { url: "example.com" } })).status).toBe(404);
  });
});

describe("A/B testing and analytics", () => {
  let depId: string;

  it("publishes both variants when a test is running", async () => {
    const path = `/x?path=${SITE_DOC_PATH}`;
    const cur = await call(file.GET, { cookie: owner.cookie, params: { projectId }, path });
    const doc = JSON.parse(cur.json.content);
    const hero = doc.pages[0].sections.find((s: { type: string }) => s.type === "hero");
    hero.variant = "centered";
    hero.ab = { variant: "editorial", running: true };
    // Example content would block production; this template has none on the home page.
    await call(file.PUT, { method: "PUT", cookie: owner.cookie, params: { projectId }, path, body: { content: JSON.stringify(doc), baseRevision: cur.json.revision } });
    const dep = await call(deployments.POST, { method: "POST", cookie: owner.cookie, params: { projectId }, body: { environment: "production" } });
    expect(dep.json.deployment.status).toBe("ready");
    depId = dep.json.deployment.id;
    const [row] = await db.select({ artifact: schema.deployments.artifact }).from(schema.deployments);
    const keys = Object.keys(row.artifact as object);
    expect(keys).toEqual(expect.arrayContaining(["/", "/#B"]));
  });

  it("serves both variants to different visitors and counts views anonymously", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const req = new Request(`${ORIGIN}/sites/${depId}`, { headers: { "user-agent": BROWSER_UA, "x-forwarded-for": `203.0.113.${i}` } });
      const res = await siteServe.GET(req, { params: Promise.resolve({ deploymentId: depId }) });
      const html = await res.text();
      seen.add(html.includes(`class="wrap hero hero-editorial"`) ? "B" : "A");
    }
    expect(seen).toEqual(new Set(["A", "B"]));
    // Bots are not counted.
    await siteServe.GET(new Request(`${ORIGIN}/sites/${depId}`, { headers: { "user-agent": "Googlebot/2.1" } }), { params: Promise.resolve({ deploymentId: depId }) });
    await new Promise((r) => setTimeout(r, 100));
    const stats = await call(analytics.GET, { cookie: owner.cookie, params: { projectId } });
    const total = stats.json.days.reduce((a: number, d: { views: number }) => a + d.views, 0);
    expect(total).toBe(24);
    const exp = stats.json.experiments.find((e: { path: string }) => e.path === "/");
    expect(exp.A.views + exp.B.views).toBe(24);
    // Nothing identifying is stored.
    const cols = Object.keys((await db.select().from(schema.siteStats).limit(1))[0]);
    expect(cols.sort()).toEqual(["count", "day", "experiment", "kind", "path", "projectId", "variant"].sort());
  });

  it("attributes form submissions to the variant that produced them", async () => {
    const body = new URLSearchParams({ email: "fan@example.com", _ab: "B" });
    const req = new Request(`${ORIGIN}/api/v1/sites/${depId}/forms/newsletter?page=%2F`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body });
    const res = await siteForm.POST(req, { params: Promise.resolve({ deploymentId: depId, formId: "newsletter" }) });
    expect(res.status).toBe(303);
    const stats = await call(analytics.GET, { cookie: owner.cookie, params: { projectId } });
    expect(stats.json.experiments.find((e: { path: string }) => e.path === "/").B.submits).toBe(1);
    expect((await call(analytics.GET, { cookie: other.cookie, params: { projectId } })).status).toBe(404);
  });
});
