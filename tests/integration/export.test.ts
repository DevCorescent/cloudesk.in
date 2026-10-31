import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as exp from "@/app/api/v1/projects/[projectId]/export/[[...slug]]/route";
import * as forms from "@/app/api/v1/sites/[deploymentId]/forms/[formId]/route";
import { checkConnection, publishTo } from "@/server/export/targets";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

// Exporting a web app: a zip of the live version, and publishing it to
// GitHub, Netlify and Vercel through their APIs — exercised against a fake
// provider that checks each request, never a real account.
let cookie = "";
let projectId = "";
let orgId = "";
let userId = "";
let depId = "";
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const E = (method: string, path: string, body?: unknown) => call((exp as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/projects/${projectId}/export/${path}`, params: { projectId, slug: seg(path) } });

type Seen = { method: string; url: string; headers: Record<string, string>; body: unknown };
function fakeProvider(routes: [RegExp, string, (req: Seen) => { status?: number; json: unknown }][]) {
  const seen: Seen[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const raw = init?.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw instanceof Uint8Array ? raw : null;
    const req = { method, url, headers, body };
    seen.push(req);
    const r = routes.find(([re, m]) => m === method && re.test(url));
    if (!r) return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), { status: 500 });
    const out = r[2](req);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, seen };
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Eli Export", email: "eli.export@example.com", password: "correct-horse-42" } }));
  const who = (await call(me.GET, { cookie })).json;
  orgId = who.organizations[0].id;
  userId = who.user.id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Acme Export" } })).json.project.id;
});
afterAll(closeDb);

const project = () => ({ id: projectId, orgId, name: "Acme Export" });

describe("exporting a web app", () => {
  it("needs a published version first", async () => {
    expect((await E("GET", "zip")).status).toBe(409);
  });

  it("downloads a zip of the live version that standard tools open", async () => {
    depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
    const res = await exp.GET(new Request(`${ORIGIN}/api/v1/projects/${projectId}/export/zip`, { headers: { cookie } }), { params: Promise.resolve({ projectId, slug: ["zip"] }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const dir = mkdtempSync(join(tmpdir(), "cc-export-"));
    const file = join(dir, "site.zip");
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const list = execFileSync("unzip", ["-Z1", file]).toString().split("\n").filter(Boolean);
    expect(list).toEqual(expect.arrayContaining(["index.html", "404.html", "sitemap.xml", "robots.txt", "_headers", "README.md"]));
    const index = execFileSync("unzip", ["-p", file, "index.html"]).toString();
    expect(index).not.toContain("__CC_BASE__");
    expect(index).not.toContain("<!--cc:");
    // Nothing in it still points at a platform path that would break off-platform.
    expect(index).not.toMatch(/(?:action|src|href)="\/api\//);
    const [log] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "export.downloaded"));
    expect(log).toBeDefined();
  });

  it("keeps tokens to itself", async () => {
    const r = await E("POST", "targets", { provider: "github", name: "Main repo", token: "ghp_secret_token_value", repo: "acme/site", dir: "docs", url: "https://acme.github.io" });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain("ghp_secret_token_value");
    expect(r.json.target.tokenSaved).toBe(true);
    const [row] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.id, r.json.target.id));
    expect(row!.token).not.toContain("ghp_secret");
    expect((await E("POST", "targets", { provider: "github", name: "x", token: "t", repo: "not a repo" })).status).toBe(422);
    expect((await E("POST", "targets", { provider: "vercel", name: "x", project: "acme" })).json.error.message).toBe("Paste an access token");
  });

  it("commits to GitHub in one commit, removing pages that are gone", async () => {
    const [t] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.provider, "github"));
    const { f, seen } = fakeProvider([
      [/\/repos\/acme\/site$/, "GET", () => ({ json: { default_branch: "main", html_url: "https://github.com/acme/site", permissions: { push: true } } })],
      [/\/git\/ref\/heads\/main$/, "GET", () => ({ json: { object: { sha: "c0" } } })],
      [/\/git\/commits\/c0$/, "GET", () => ({ json: { tree: { sha: "t0" } } })],
      [/\/git\/trees\/t0\?recursive=1$/, "GET", () => ({ json: { tree: [{ path: "README.md", type: "blob" }, { path: "docs/old-page/index.html", type: "blob" }, { path: "docs/index.html", type: "blob" }] } })],
      [/\/git\/trees$/, "POST", () => ({ json: { sha: "t1" } })],
      [/\/git\/commits$/, "POST", () => ({ json: { sha: "c1", html_url: "https://github.com/acme/site/commit/c1" } })],
      [/\/git\/refs\/heads\/main$/, "PATCH", () => ({ json: { object: { sha: "c1" } } })],
    ]);
    const r = await publishTo(project(), userId, t!.id, f);
    expect(r.result.ref).toBe("c1");
    expect(seen.every((x) => x.headers.authorization === "Bearer ghp_secret_token_value")).toBe(true);
    const tree = seen.find((x) => x.url.endsWith("/git/trees") && x.method === "POST")!.body as { base_tree: string; tree: { path: string; sha?: null; content?: string }[] };
    expect(tree.base_tree).toBe("t0");
    expect(tree.tree.find((x) => x.path === "docs/index.html")?.content).toContain("<html");
    expect(tree.tree.find((x) => x.path === "docs/old-page/index.html")).toEqual({ path: "docs/old-page/index.html", mode: "100644", type: "blob", sha: null });
    expect(tree.tree.some((x) => x.path === "README.md")).toBe(false);
    expect((seen.find((x) => x.method === "PATCH")!.body as { sha: string }).sha).toBe("c1");
    const [row] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.id, t!.id));
    expect(row).toMatchObject({ status: "done", url: "https://acme.github.io", lastDeploymentId: depId });
  });

  it("records the provider's own error when the token is refused", async () => {
    const [t] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.provider, "github"));
    const { f } = fakeProvider([[/\/repos\/acme\/site$/, "GET", () => ({ status: 401, json: { message: "Bad credentials" } })]]);
    await expect(publishTo(project(), userId, t!.id, f)).rejects.toThrow("GitHub refused the token");
    const [row] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.id, t!.id));
    expect(row).toMatchObject({ status: "failed" });
    expect(row!.lastError).toContain("Bad credentials");
  });

  it("deploys a zip to Netlify, making the site first, and waits until it's live", async () => {
    const id = (await E("POST", "targets", { provider: "netlify", name: "Netlify", token: "nfp_token", siteName: "acme-export" })).json.target.id;
    let polls = 0;
    const { f, seen } = fakeProvider([
      [/api\.netlify\.com\/api\/v1\/sites$/, "POST", () => ({ json: { id: "site-1", ssl_url: "https://acme-export.netlify.app" } })],
      [/\/sites\/site-1\/deploys$/, "POST", () => ({ json: { id: "dep-1", state: "uploaded" } })],
      [/\/deploys\/dep-1$/, "GET", () => ({ json: { id: "dep-1", state: ++polls < 2 ? "processing" : "ready", ssl_url: "https://acme-export.netlify.app" } })],
    ]);
    const { deployNetlify } = await import("@/server/export/providers");
    void deployNetlify;
    const r = await publishTo(project(), userId, id, async (u, i) => {
      // Skip the real wait between polls.
      return f(u, i);
    });
    expect(r.result.url).toBe("https://acme-export.netlify.app");
    const upload = seen.find((x) => x.url.endsWith("/deploys") && x.method === "POST")!;
    expect(upload.headers["content-type"]).toBe("application/zip");
    expect((upload.body as Uint8Array).slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    const [row] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.id, id));
    expect(row).toMatchObject({ status: "done", url: "https://acme-export.netlify.app" });
    expect(row!.config.siteId).toBe("site-1");
  }, 30_000);

  it("deploys files to Vercel as production", async () => {
    const id = (await E("POST", "targets", { provider: "vercel", name: "Vercel", token: "vc_token", project: "acme-export" })).json.target.id;
    const { f, seen } = fakeProvider([[/api\.vercel\.com\/v13\/deployments$/, "POST", () => ({ json: { id: "dpl_1", url: "acme-export-abc.vercel.app", readyState: "READY", alias: ["acme-export.vercel.app"] } })]]);
    const r = await publishTo(project(), userId, id, f);
    expect(r.result.url).toBe("https://acme-export.vercel.app");
    const body = seen[0]!.body as { name: string; target: string; files: { file: string; data: string }[] };
    expect(body).toMatchObject({ name: "acme-export", target: "production" });
    expect(body.files.map((x) => x.file)).toEqual(expect.arrayContaining(["index.html", "404.html"]));
  });

  it("uploads to Cloudflare Pages: makes the project, sends only missing files, deploys with _headers", async () => {
    const acct = "0123456789abcdef0123456789abcdef";
    const id = (await E("POST", "targets", { provider: "cloudflare", name: "Cloudflare", token: "cf_token", accountId: acct, project: "acme-export" })).json.target.id;
    let polls = 0;
    let missing: string[] = [];
    const { f, seen } = fakeProvider([
      [/\/pages\/projects\/acme-export$/, "GET", () => ({ status: 404, json: { success: false, errors: [{ message: "Project not found" }] } })],
      [/\/pages\/projects$/, "POST", () => ({ json: { success: true, result: { name: "acme-export", subdomain: "acme-export.pages.dev" } } })],
      [/\/upload-token$/, "GET", () => ({ json: { success: true, result: { jwt: "upload-jwt" } } })],
      [/\/pages\/assets\/check-missing$/, "POST", (r) => ((missing = (r.body as { hashes: string[] }).hashes.slice(1)), { json: { success: true, result: missing } })],
      [/\/pages\/assets\/upload$/, "POST", () => ({ json: { success: true, result: null } })],
      [/\/pages\/assets\/upsert-hashes$/, "POST", () => ({ json: { success: true, result: null } })],
      [/\/acme-export\/deployments$/, "POST", () => ({ json: { success: true, result: { id: "cfdep-1", latest_stage: { name: "queued", status: "active" } } } })],
      [/\/deployments\/cfdep-1$/, "GET", () => ({ json: { success: true, result: { id: "cfdep-1", latest_stage: ++polls < 2 ? { name: "deploy", status: "active" } : { name: "deploy", status: "success" } } } })],
    ]);
    // FormData bodies aren't JSON: keep them as they are for the checks below.
    const pass = (async (u: RequestInfo | URL, i?: RequestInit) => (i?.body instanceof FormData ? f(u, { ...i, body: undefined, headers: { ...(i.headers as Record<string, string>), "x-form": JSON.stringify([...i.body.keys()]) } }) : f(u, i))) as typeof fetch;
    const r = await publishTo(project(), userId, id, pass);
    expect(r.result.url).toBe("https://acme-export.pages.dev");
    expect(seen.find((x) => x.url.endsWith("/upload-token"))!.headers.authorization).toBe("Bearer cf_token");
    const uploads = seen.filter((x) => x.url.endsWith("/pages/assets/upload"));
    expect(uploads.every((x) => x.headers.authorization === "Bearer upload-jwt")).toBe(true);
    const sent = uploads.flatMap((x) => (x.body as { key: string; base64: boolean }[]).map((b) => b.key));
    expect(sent.sort()).toEqual([...new Set(missing)].sort());
    const dep = seen.find((x) => x.url.endsWith("/acme-export/deployments") && x.method === "POST")!;
    expect(JSON.parse(dep.headers["x-form"])).toEqual(expect.arrayContaining(["manifest", "branch", "_headers"]));
    const [row] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.id, id));
    expect(row).toMatchObject({ status: "done", url: "https://acme-export.pages.dev" });
  }, 30_000);

  it("checks a connection with the provider before saving, without publishing", async () => {
    const { f, seen } = fakeProvider([[/api\.vercel\.com\/v2\/user$/, "GET", () => ({ json: { user: { username: "eli" } } })]]);
    const ok = await checkConnection(project(), null, { provider: "vercel", name: "V", token: "vc", project: "acme-site" }, f);
    expect(ok.note).toContain("Signed in as eli");
    expect(seen).toHaveLength(1);
    const bad = fakeProvider([[/api\.github\.com\/repos\/acme\/site$/, "GET", () => ({ json: { full_name: "acme/site", default_branch: "main", permissions: { push: false } } })]]);
    // The saved GitHub token is used when none is typed.
    const [gh] = await db.select().from(schema.siteTargets).where(eq(schema.siteTargets.provider, "github"));
    await expect(checkConnection(project(), gh!.id, { provider: "github", name: "G", repo: "acme/site" }, bad.f)).rejects.toThrow("not push");
    expect(bad.seen[0]!.headers.authorization).toBe("Bearer ghp_secret_token_value");
    expect((await E("POST", "check", { provider: "cloudflare", name: "C", token: "t", accountId: "nope", project: "x" })).status).toBe(422);
  });

  it("accepts forms posted from its own external copies only", async () => {
    const post = (origin: string) => {
      const f = new FormData();
      f.set("name", "Ravi");
      f.set("email", "ravi@example.com");
      f.set("message", "Hello");
      return forms.POST(new Request(`${ORIGIN}/api/v1/sites/${depId}/forms/contact?page=/`, { method: "POST", headers: { origin, referer: `${origin}/`, "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` }, body: f }), { params: Promise.resolve({ deploymentId: depId, formId: "contact" }) });
    };
    const ok = await post("https://acme-export.netlify.app");
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("https://acme-export.netlify.app/?submitted=1");
    expect((await post("https://evil.example")).status).toBe(403);
  });
});
