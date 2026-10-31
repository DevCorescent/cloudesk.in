import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as publicApi from "@/app/api/public/v1/[[...path]]/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as data from "@/app/api/v1/projects/[projectId]/data/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import * as integrations from "@/app/api/v1/projects/[projectId]/integrations/[[...slug]]/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { parseSimpleFilter } from "@/server/data/site";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let editor = "";
let projectId = "";
let people = "";
let teams = "";
const D = (method: string, slug: string[] = [], body?: unknown, c = cookie, query = "") => call(data[method as "GET"], { method, cookie: c, body, path: `/api/v1/projects/${projectId}/data/${slug.join("/")}${query}`, params: { projectId, slug } });
const pub = async (method: string, path: string, opts: { key?: string; body?: unknown } = {}) => {
  const res = await publicApi[method as "GET"](new Request(`${ORIGIN}/api/public/v1/${path}`, { method, headers: { ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}), ...(opts.body ? { "content-type": "application/json" } : {}), "x-forwarded-for": "203.0.113.9" }, body: opts.body ? JSON.stringify(opts.body) : undefined }), { params: Promise.resolve({ path: new URL(`${ORIGIN}/${path}`).pathname.split("/").filter(Boolean) }) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Dana Data", email: "dana@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Northwind" } })).json.project.id;
  editor = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Eli Editor", email: "eli@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "eli@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
});
afterAll(closeDb);

describe("database studio", () => {
  it("creates tables with typed fields; only schema roles can change structure", async () => {
    const t = await D("POST", ["tables"], { name: "Teams", fields: [{ key: "name", name: "Name", type: "text", required: true }, { key: "floor", name: "Floor", type: "number" }] });
    expect(t.status).toBe(201);
    teams = t.json.table.id;
    expect(t.json.table.slug).toBe("teams");
    const p = await D("POST", ["tables"], {
      name: "Team members",
      fields: [
        { key: "name", name: "Name", type: "text", required: true },
        { key: "email", name: "Email", type: "email" },
        { key: "role", name: "Role", type: "select", options: ["Partner", "Analyst", "Intern"] },
        { key: "skills", name: "Skills", type: "multiselect", options: ["Tax", "Audit", "M&A"] },
        { key: "years", name: "Years", type: "number" },
        { key: "active", name: "Active", type: "boolean" },
        { key: "joined", name: "Joined", type: "date" },
        { key: "team", name: "Team", type: "relation", relationTable: teams },
      ],
    });
    people = p.json.table.id;
    expect(p.json.table.slug).toBe("team-members");
    expect((await D("POST", ["tables"], { name: "Team members" })).status).toBe(409);
    expect((await D("POST", ["tables"], { name: "Bad", fields: [{ key: "id", name: "Id", type: "text" }] })).status).toBe(422);
    expect((await D("POST", ["tables"], { name: "X", fields: [{ key: "s", name: "S", type: "select" }] })).json.error.message).toBe("S: add at least one option");
    expect((await D("POST", ["tables"], { name: "Nope" }, editor)).status).toBe(403);
  });

  it("validates and stores rows; filters, sorts, searches and expands links", async () => {
    const tm = (await D("POST", ["api", "teams"], { rows: [{ name: "Advisory", floor: 3 }, { name: "Tax", floor: "5" }] })).json.data;
    expect(tm.map((r: { floor: number }) => r.floor)).toEqual([3, 5]);
    const add = await D("POST", ["api", "team-members"], {
      rows: [
        { name: "Asha Rao", email: "ASHA@northwind.example", role: "Partner", skills: "Tax, M&A", years: 18, active: "yes", joined: "2008-04-01", team: tm[1].id },
        { name: "Ben Ito", email: "ben@northwind.example", role: "Analyst", skills: ["Audit"], years: 3, active: true, joined: "2023-09-15", team: tm[0].id },
        { name: "Cleo Park", role: "Intern", years: 0.5, joined: "2026-06-01" },
      ],
    }, editor); // editors can write rows
    expect(add.status).toBe(201);
    expect(add.json.data[0]).toMatchObject({ email: "asha@northwind.example", skills: ["Tax", "M&A"], active: true, team: tm[1].id });
    expect(add.json.data[2]).toMatchObject({ active: false, skills: [], email: null });

    const bad = await D("POST", ["api", "team-members"], { name: "", role: "CEO", years: "lots", extra: 1 });
    expect(bad.status).toBe(422);
    expect(bad.json.error.details).toEqual({ name: ["Required"], role: ["Expected one of: Partner, Analyst, Intern"], years: ["Expected a number"], extra: ["Unknown field"] });
    expect((await D("POST", ["api", "team-members"], { name: "Ghost", team: "00000000-0000-4000-8000-000000000000" })).json.error.message).toBe("Team: linked row not found");

    const q = (s: string) => D("GET", ["api", "team-members"], undefined, cookie, s).then((r) => r.json);
    expect((await q("?filter[years][gte]=3&sort=-years")).data.map((r: { name: string }) => r.name)).toEqual(["Asha Rao", "Ben Ito"]);
    expect((await q("?filter[skills]=Audit")).data.map((r: { name: string }) => r.name)).toEqual(["Ben Ito"]);
    expect((await q("?filter[role][in]=Intern,Analyst&sort=name")).data.map((r: { name: string }) => r.name)).toEqual(["Ben Ito", "Cleo Park"]);
    expect((await q("?filter[email][empty]=1")).total).toBe(1);
    expect((await q("?filter[name]=asha rao")).total).toBe(1); // case-insensitive equality on text
    expect((await q("?filter[joined][lt]=2024-01-01&sort=joined")).data.map((r: { name: string }) => r.name)).toEqual(["Asha Rao", "Ben Ito"]);
    expect((await q("?q=northwind")).total).toBe(2);
    expect((await q("?filter[name][contains]=%")).total).toBe(0); // wildcards are literal
    const page = await q("?limit=2&sort=name");
    expect(page).toMatchObject({ total: 3, next: 2 });
    const ex = await q("?expand=team&sort=name&limit=1");
    expect(ex.data[0].team).toMatchObject({ name: "Tax", floor: 5 });
    expect((await D("GET", ["api", "team-members"], undefined, cookie, "?filter[nope]=1")).json.error.message).toBe('Unknown field "nope" in filter');
    expect((await D("GET", ["api", "team-members"], undefined, cookie, "?filter[years][like]=1")).status).toBe(422);
  });

  it("updates and deletes rows, clearing links to deleted rows", async () => {
    const all = (await D("GET", ["api", "team-members"], undefined, cookie, "?sort=name")).json.data;
    const r = await D("PATCH", ["api", "team-members", all[2].id], { years: 1, role: "Analyst" });
    expect(r.json).toMatchObject({ years: 1, role: "Analyst", name: "Cleo Park" });
    expect((await D("PATCH", ["api", "team-members", all[2].id], { years: "x" })).status).toBe(422);
    const tax = (await D("GET", ["api", "teams"], undefined, cookie, "?filter[name]=Tax")).json.data[0];
    expect((await D("DELETE", ["api", "teams", tax.id])).json).toEqual({ id: tax.id, deleted: true });
    expect((await D("GET", ["api", "team-members", all[0].id])).json.team).toBeNull();
    expect((await D("DELETE", ["tables", teams])).json.error.message).toBe('"Team members" links to this table. Remove that link field first.');
  });

  it("converts values when a field's type changes, or refuses", async () => {
    const t = (await D("GET")).json.tables.find((x: { id: string }) => x.id === people);
    const fields = t.fields.map((f: { key: string }) => (f.key === "years" ? { ...f, type: "text" } : f));
    expect((await D("PATCH", ["tables", people], { fields })).status).toBe(200);
    expect((await D("GET", ["api", "team-members"], undefined, cookie, "?filter[name]=Asha Rao")).json.data[0].years).toBe("18");
    const back = fields.map((f: { key: string; type: string }) => (f.key === "role" ? { ...f, type: "number" } : f.key === "years" ? { ...f, type: "number" } : f));
    const refused = await D("PATCH", ["tables", people], { fields: back });
    expect(refused.status).toBe(409);
    expect(refused.json.error.message).toBe("3 values can't be converted. Fix them or choose to clear them.");
    expect((await D("PATCH", ["tables", people], { fields: back, clearInvalid: true })).status).toBe(200);
    const rows = (await D("GET", ["api", "team-members"], undefined, cookie, "?sort=name")).json.data;
    expect(rows.map((r: { years: number; role: unknown }) => [r.years, r.role])).toEqual([[18, null], [3, null], [1, null]]);
    // Dropping a field removes its values.
    await D("PATCH", ["tables", people], { fields: back.filter((f: { key: string }) => f.key !== "role") });
    const [row] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.tableId, people)).limit(1);
    const roleId = t.fields.find((f: { key: string }) => f.key === "role").id;
    expect(Object.keys(row.data as object)).not.toContain(roleId);
  });

  it("imports and exports CSV safely", async () => {
    const csv = 'Name,Email,Years,Unknown\n"Dee, Jr.",dee@northwind.example,7,x\nEve,not-an-email,2,y\n=HYPERLINK("x"),,1,z\n';
    const dry = await D("POST", ["tables", people, "import"], { csv });
    expect(dry.json).toMatchObject({ inserted: 0, matched: ["name", "email", "years"], ignored: ["Unknown"] });
    expect(dry.json.problems).toEqual([{ line: 3, errors: ["email: Expected an email address"] }]);
    const go = await D("POST", ["tables", people, "import"], { csv, skipInvalid: true });
    expect(go.json).toMatchObject({ inserted: 2, skipped: 1 });
    const res = await call(data.GET, { cookie, path: `/api/v1/projects/${projectId}/data/tables/${people}/export`, params: { projectId, slug: ["tables", people, "export"] } });
    expect(res.text).toContain('"Dee, Jr.",dee@northwind.example');
    expect(res.text).toContain(`'=HYPERLINK(""x"")`); // formulas are neutralised
  });
});

describe("API studio", () => {
  let readKey = "";
  let writeKey = "";
  it("serves the tables over the public API with scoped keys", async () => {
    readKey = (await call(integrations.POST, { method: "POST", cookie, params: { projectId, slug: ["keys"] }, body: { name: "Reader", scopes: ["data:read"] } })).json.key;
    writeKey = (await call(integrations.POST, { method: "POST", cookie, params: { projectId, slug: ["keys"] }, body: { name: "Writer", scopes: ["data:read", "data:write"] } })).json.key;
    // Sorted by name, the first page of one is the first of the full list (the order itself follows the database's collation).
    const sorted = (await pub("GET", "data/team-members?sort=name", { key: readKey })).json.data.map((r: { name: string }) => r.name);
    expect(sorted).toContain("=HYPERLINK(\"x\")");
    expect((await pub("GET", "data/team-members?sort=name&limit=1", { key: readKey })).json.data.map((r: { name: string }) => r.name)).toEqual([sorted[0]]);
    expect((await pub("POST", "data/team-members", { key: readKey, body: { name: "X" } })).json.error.message).toBe('This key needs the "data:write" permission');
    const c = await pub("POST", "data/team-members", { key: writeKey, body: { name: "Finn", years: 4 } });
    expect(c.status).toBe(201);
    expect((await pub("DELETE", `data/team-members/${c.json.id}`, { key: writeKey })).status).toBe(200);
    expect((await pub("GET", "data/team-members")).status).toBe(401);
    const spec = await pub("GET", "data/openapi.json", { key: readKey });
    expect(Object.keys(spec.json.paths)).toEqual(["/data/teams", "/data/teams/{id}", "/data/team-members", "/data/team-members/{id}"]);
    expect(spec.json.components.schemas.TeamMembersInput.properties.skills).toMatchObject({ type: "array", items: { enum: ["Tax", "Audit", "M&A"] } });
  });

  it("allows anonymous access only to tables marked public, with CORS", async () => {
    expect((await pub("GET", `p/${projectId}/data/team-members`)).status).toBe(404);
    await D("PATCH", ["tables", people], { publicRead: true });
    const r = await pub("GET", `p/${projectId}/data/team-members?limit=2`);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    // Expanding a link doesn't open the linked table when it isn't public itself.
    const ex = (await pub("GET", `p/${projectId}/data/team-members?expand=team`)).json.data.find((x: { team: unknown }) => x.team);
    expect(typeof ex.team).toBe("string");
    const one = (await pub("GET", `p/${projectId}/data/team-members/${ex.id}?expand=team`)).json;
    expect(typeof one.team).toBe("string");
    expect((await pub("POST", `p/${projectId}/data/team-members`, { body: { name: "Spam" } })).status).toBe(404);
    await D("PATCH", ["tables", people], { publicInsert: true });
    const ins = await pub("POST", `p/${projectId}/data/team-members`, { body: { name: "Gia" } });
    expect(Object.keys(ins.json)).toEqual(["id"]);
    expect((await pub("POST", `p/${projectId}/data/team-members`, { body: { rows: [{ name: "a" }, { name: "b" }] } })).status).toBe(422);
    expect((await pub("PATCH", `p/${projectId}/data/team-members/${ins.json.id}`, { body: { name: "Hacked" } })).status).toBe(404);
    expect((await pub("GET", `p/${projectId}/data`)).json.data.map((t: { slug: string }) => t.slug)).toEqual(["team-members"]);
    const [a] = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "data.table_access"))).limit(1);
    expect(a).toBeTruthy();
  });

  it("has a console that sends requests as a key or anonymously", async () => {
    const r = await D("POST", ["console"], { method: "GET", path: "/data/teams?limit=1", as: "key", scopes: ["data:read"] });
    expect(r.json).toMatchObject({ status: 200, body: { total: 1 } });
    expect((await D("POST", ["console"], { method: "GET", path: "/data/teams", as: "anonymous" })).json.status).toBe(404);
    expect((await D("POST", ["console"], { method: "POST", path: "/data/teams", body: '{"name": "Ops"}', as: "key", scopes: ["data:read"] })).json.status).toBe(403);
    expect((await D("POST", ["console"], { method: "POST", path: "/data/teams", body: "{oops", as: "key", scopes: ["data:write"] })).json).toMatchObject({ status: 422, body: { error: { message: "The body is not valid JSON" } } });
  });
});

describe("app builder", () => {
  it("parses simple filters", () => {
    expect(parseSimpleFilter("status=Published, price<100 and name~oak")).toEqual([
      { field: "status", op: "eq", value: "Published" },
      { field: "price", op: "lt", value: "100" },
      { field: "name", op: "contains", value: "oak" },
    ]);
  });

  it("renders live rows on the published site", async () => {
    const f = await call(file.GET, { cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId } });
    const doc = JSON.parse(f.json.content);
    doc.pages[0].sections.splice(1, 0, { id: "dl1", type: "dataList", variant: "table", props: { heading: "Our people", table: "team-members", titleField: "name", fields: ["years", "skills"], filter: "years>1", sort: "-years", limit: 10 } });
    expect((await call(file.PUT, { method: "PUT", cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId }, body: { content: JSON.stringify(doc), baseRevision: f.json.revision } })).status).toBe(200);
    const dep = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
    const html = async () => (await siteServe.GET(new Request(`${ORIGIN}/sites/${dep}/`), { params: Promise.resolve({ deploymentId: dep, path: [] }) })).text();
    let page = await html();
    expect(page).toContain("<h2>Our people</h2>");
    expect(page).toMatch(/<td>Asha Rao<\/td><td>18<\/td><td><span class="dl-tag">Tax<\/span><span class="dl-tag">M&amp;A<\/span><\/td>/);
    expect(page.indexOf("Asha Rao")).toBeLessThan(page.indexOf("Dee, Jr."));
    expect(page).not.toContain("Cleo"); // 1 year: filtered out
    // New rows appear without redeploying.
    await D("POST", ["api", "team-members"], { name: "Hana <b>Bold</b>", years: 30 });
    page = await html();
    expect(page.indexOf("Hana &lt;b&gt;Bold&lt;/b&gt;")).toBeGreaterThan(-1);
    expect(page.indexOf("Hana")).toBeLessThan(page.indexOf("Asha Rao"));
  });
});
