import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as data from "@/app/api/v1/projects/[projectId]/data/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import * as forms from "@/app/api/v1/sites/[deploymentId]/forms/[formId]/route";
import { createSection } from "@/lib/site/model";
import { customFormId } from "@/lib/site/sections-extra";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
let depId = "";
let formId = "";
let x = 0;
const submit = async (fields: Record<string, string>, id = formId) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await forms.POST(new Request(`${ORIGIN}/api/v1/sites/${depId}/forms/${id}?page=/`, { method: "POST", headers: { origin: ORIGIN, referer: `${ORIGIN}/sites/${depId}/`, "x-forwarded-for": `198.51.100.${++x}` }, body: f }), { params: Promise.resolve({ deploymentId: depId, formId: id }) });
  return { status: res.status, location: res.headers.get("location"), json: res.status >= 400 ? await res.json() : null };
};

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Fay Form", email: "fay@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Quote Co" } })).json.project.id;
  await call(data.POST, { method: "POST", cookie, path: `/api/v1/projects/${projectId}/data/tables`, params: { projectId, slug: ["tables"] }, body: { name: "Leads", fields: [{ key: "name", name: "Name", type: "text", required: true }, { key: "email", name: "Email", type: "email" }, { key: "budget", name: "Budget", type: "text" }] } });
  const f = await call(file.GET, { cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId } });
  const doc = JSON.parse(f.json.content);
  const s = createSection("form");
  Object.assign(s.props, { table: "leads", notifyEmail: "fay@example.com" });
  doc.pages[0].sections.splice(1, 0, s);
  formId = customFormId(s.id);
  await call(file.PUT, { method: "PUT", cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId }, body: { content: JSON.stringify(doc), baseRevision: f.json.revision } });
  depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
});
afterAll(closeDb);

describe("custom forms", () => {
  it("accepts a valid submission into the inbox, a data table and an email to the team", async () => {
    const r = await submit({ name: "Ravi", email: "ravi@example.com", budget: "₹50k–₹2L", details: "A new website", sneaky: "ignored" });
    expect(r.status).toBe(303);
    const [sub] = await db.select().from(schema.formSubmissions).where(and(eq(schema.formSubmissions.projectId, projectId), eq(schema.formSubmissions.formId, formId)));
    expect(sub.data).toEqual({ name: "Ravi", email: "ravi@example.com", budget: "₹50k–₹2L", details: "A new website" });
    const rows = await call(data.GET, { cookie, path: `/api/v1/projects/${projectId}/data/api/leads`, params: { projectId, slug: ["api", "leads"] } });
    expect(rows.json.data[0]).toMatchObject({ name: "Ravi", email: "ravi@example.com", budget: "₹50k–₹2L" });
    const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "fay@example.com"));
    const mail = mails.find((m) => m.subject.includes("submission"))!;
    expect(mail.subject).toBe("Quote Co: new “Request a quote” submission");
    expect(mail.body).toContain("details: A new website");
  });

  it("validates against the published definition", async () => {
    expect((await submit({ name: "", email: "x@example.com", details: "hi" })).json.error.message).toBe("Name is required");
    expect((await submit({ name: "A", email: "nope", details: "hi" })).json.error.message).toBe("Email: enter a valid email");
    expect((await submit({ name: "A", email: "a@example.com", budget: "A million", details: "hi" })).json.error.message).toBe("Budget: choose one of the options");
    expect((await submit({ name: "A" }, "x-nonexistent")).status).toBe(404);
  });

  it("never emails addresses outside the team", async () => {
    const f = await call(file.GET, { cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId } });
    const doc = JSON.parse(f.json.content);
    const s = doc.pages[0].sections.find((x: { type: string }) => x.type === "form");
    s.props.notifyEmail = "victim@elsewhere.example";
    await call(file.PUT, { method: "PUT", cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId }, body: { content: JSON.stringify(doc), baseRevision: f.json.revision } });
    depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
    expect((await submit({ name: "B", email: "b@example.com", details: "hi" })).status).toBe(303);
    expect(await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "victim@elsewhere.example"))).toHaveLength(0);
  });
});
