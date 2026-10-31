import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as ask from "@/app/api/v1/domains/ask/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as domains from "@/app/api/v1/projects/[projectId]/domains/[[...slug]]/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as payReturn from "@/app/api/v1/store/[projectId]/pay/[provider]/[action]/route";
import * as custom from "@/app/d/[[...path]]/route";
import { setDomainResolver } from "@/server/services/domains";
import { call, cookieFrom, resetDb } from "../helpers";

let cookie = "";
let otherCookie = "";
let projectId = "";
let otherProject = "";
const dns: Record<string, { txt?: string[]; cname?: string[] }> = {};

async function user(email: string) {
  const r = await call(signup.POST, { method: "POST", body: { name: email, email, password: "correct-horse-42" } });
  const c = cookieFrom(r);
  return { cookie: c, orgId: (await call(me.GET, { cookie: c })).json.organizations[0].id as string };
}
const d = (method: string, slug: string[] = [], body?: unknown, c = cookie, pid = projectId) => call(domains[method as "GET"], { method, cookie: c, body, params: { projectId: pid, slug } });
const site = (host: string, path: string[] = []) => custom.GET(new Request(`https://${host}/d/${path.join("/")}`, { headers: { host, "user-agent": "Mozilla/5.0 test" } }), { params: Promise.resolve({ path }) });

beforeAll(async () => {
  await resetDb();
  process.env.CUSTOM_DOMAIN_CNAME = "sites.platform.test";
  setDomainResolver({
    txt: async (n) => (dns[n]?.txt ? dns[n].txt!.map((t) => [t]) : Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }))),
    cname: async (n) => dns[n]?.cname ?? Promise.reject(new Error("ENODATA")),
    a: async () => Promise.reject(new Error("ENODATA")),
  });
  const u = await user("o@example.com");
  cookie = u.cookie;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: u.orgId }, body: { templateId: "cafe", name: "Brew" } })).json.project.id;
  const v = await user("v@example.com");
  otherCookie = v.cookie;
  otherProject = (await call(orgProjects.POST, { method: "POST", cookie: otherCookie, params: { orgId: v.orgId }, body: { templateId: "cafe", name: "Other" } })).json.project.id;
});

afterAll(async () => {
  delete process.env.CUSTOM_DOMAIN_CNAME;
  await closeDb();
});

describe("custom domains", () => {
  it("rejects invalid, platform and IP hostnames, and domains used by another site", async () => {
    for (const bad of ["not a domain", "localhost", "192.168.1.10", "sites.platform.test", "-bad.example.com"]) expect((await d("POST", [], { hostname: bad })).status).toBe(422);
    const ok = await d("POST", [], { hostname: "https://Shop.Example.com/" });
    expect(ok.status).toBe(201);
    expect(ok.json.domain).toMatchObject({ hostname: "shop.example.com", status: "pending" });
    expect((await d("POST", [], { hostname: "shop.example.com" }, otherCookie, otherProject)).status).toBe(409);
    expect((await d("GET", [], undefined, otherCookie)).status).toBe(404);
  });

  it("verifies ownership with a TXT record and the CNAME, then serves the live site there", async () => {
    const [dom] = (await d("GET")).json.domains;
    let c = await d("POST", [dom.id, "check"]);
    expect(c.json.domain.status).toBe("pending");
    expect(c.json.domain.lastError).toContain("_creationcloud.shop.example.com");
    dns["_creationcloud.shop.example.com"] = { txt: [dom.verificationToken] };
    c = await d("POST", [dom.id, "check"]);
    expect(c.json.domain.lastError).toContain("CNAME");
    dns["shop.example.com"] = { cname: ["sites.platform.test."] };
    c = await d("POST", [dom.id, "check"]);
    expect(c.json.domain.status).toBe("verified");

    // No certificate until there is a live site.
    expect((await ask.GET(new Request("http://x/api/v1/domains/ask?domain=shop.example.com"))).status).toBe(404);
    expect((await site("shop.example.com")).status).toBe(404);
    const dep = await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } });
    expect(dep.json.deployment.status).toBe("ready");
    expect((await ask.GET(new Request("http://x/api/v1/domains/ask?domain=shop.example.com"))).status).toBe(200);
    expect((await ask.GET(new Request("http://x/api/v1/domains/ask?domain=evil.example.com"))).status).toBe(404);

    const home = await site("shop.example.com");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('href="/about"');
    expect(html).not.toContain("/s/");
    expect((await site("shop.example.com", ["about"])).status).toBe(200);
    expect((await site("unknown.example.com")).status).toBe(404);
    expect((await site("localhost:3000")).status).toBe(404);
    const sitemap = await (await site("shop.example.com", ["sitemap.xml"])).text();
    expect(sitemap).toContain("<loc>https://shop.example.com/about</loc>");
  });

  it("runs the store on the domain, and accepts the root base only from that domain", async () => {
    const s = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, params: { projectId, slug: path.split("/").filter(Boolean) } });
    await s("POST", "setup", { name: "Brew Shop", country: "IN" });
    const p = await s("POST", "products", { title: "Beans", status: "active", variants: [{ options: {}, price: 50000, stock: 5 }] });
    const add = async (host: string) => {
      const f = new FormData();
      f.set("_base", "");
      f.set("action", "add");
      f.set("variant", p.json.product.variants[0].id);
      return cartRoute.POST(new Request(`https://${host}/api/v1/store/${projectId}/cart`, { method: "POST", headers: { host, origin: `https://${host}` }, body: f }), { params: Promise.resolve({ projectId }) });
    };
    const ok = await add("shop.example.com");
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/cart?m=added");
    expect((await add("evil.example.com")).status).toBe(400);

    // Payment returns may go back to a verified domain of this project, and nowhere else.
    const ret = (base: string) => payReturn.GET(new Request(`http://localhost:3000/x?order=00000000-0000-0000-0000-000000000000&key=k&base=${encodeURIComponent(base)}`), { params: Promise.resolve({ projectId, provider: "stripe", action: "cancel" }) });
    expect((await ret("https://shop.example.com")).status).toBe(404); // accepted base; unknown order
    expect((await ret("https://evil.example.com")).status).toBe(400);
  });

  it("stops serving a removed domain", async () => {
    const [dom] = (await d("GET")).json.domains;
    expect((await d("DELETE", [dom.id])).status).toBe(200);
    expect((await site("shop.example.com")).status).toBe(404);
  });
});
