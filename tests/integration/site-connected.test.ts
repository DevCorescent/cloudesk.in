import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as hrApi from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import * as forms from "@/app/api/v1/sites/[deploymentId]/forms/[formId]/route";
import * as site from "@/app/sites/[deploymentId]/[[...path]]/route";
import { createSection } from "@/lib/site/model";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

// A published site's connected sections: open jobs from HR and events from
// Marketing filled live per request; a support form that opens a Helpdesk
// ticket; newsletter sign-ups that land in the CRM as consenting subscribers.
let cookie = "";
let orgId = "";
let projectId = "";
let depId = "";
let x = 0;
const page = async () => (await site.GET(new Request(`${ORIGIN}/sites/${depId}/`), { params: Promise.resolve({ deploymentId: depId, path: [] }) })).text();
const submit = async (formId: string, fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await forms.POST(new Request(`${ORIGIN}/api/v1/sites/${depId}/forms/${formId}?page=/`, { method: "POST", headers: { origin: ORIGIN, referer: `${ORIGIN}/sites/${depId}/`, "x-forwarded-for": `198.51.100.${++x}` }, body: f }), { params: Promise.resolve({ deploymentId: depId, formId }) });
  return { status: res.status, json: res.status >= 400 ? await res.json() : null };
};

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Cora Connect", email: "cora.connect@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Brew Co" } })).json.project.id;
  // HR settings exist once HR is opened; one open role.
  await call(hrApi.GET, { cookie, path: `/api/v1/orgs/${orgId}/hr/meta`, params: { orgId, slug: ["meta"] } });
  await db.insert(schema.hrJobs).values({ orgId, title: "Head barista", employmentType: "full_time", status: "open" } as never);
  await db.insert(schema.hrJobs).values({ orgId, title: "Closed role", employmentType: "full_time", status: "closed" } as never);
  // One upcoming event with registration, one past.
  await db.insert(schema.mktCampaigns).values([
    { orgId, name: "Latte art workshop", slug: "latte", kind: "event", status: "active", eventAt: new Date(Date.now() + 7 * 86_400_000), venue: "Brew Co, Pune", capacity: 20, regToken: "reg-latte-1234567890" },
    { orgId, name: "Last year's meetup", slug: "old", kind: "event", status: "active", eventAt: new Date(Date.now() - 7 * 86_400_000), regToken: "reg-old-1234567890" },
  ] as never);
  const f = await call(file.GET, { cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId } });
  const doc = JSON.parse(f.json.content);
  doc.pages[0].sections.splice(1, 0, createSection("careers"), createSection("events"), createSection("support"), createSection("newsletter"));
  await call(file.PUT, { method: "PUT", cookie, path: `/api/v1/projects/${projectId}/file?path=site/site.json`, params: { projectId }, body: { content: JSON.stringify(doc), baseRevision: f.json.revision } });
  depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
});
afterAll(closeDb);

describe("connected sections on a published site", () => {
  it("lists open roles and upcoming events, live, with links to apply and register", async () => {
    const html = await page();
    expect(html).toContain("Head barista");
    expect(html).not.toContain("Closed role");
    expect(html).toMatch(/href="[^"]*\/careers\/[A-Za-z0-9_-]+#job-[0-9a-f-]+"/);
    expect(html).toContain("Latte art workshop");
    expect(html).toContain("20 places left");
    expect(html).toContain('/e/reg-latte-1234567890"');
    expect(html).not.toContain("Last year's meetup");
    expect(html).not.toContain("Sample role");
    expect(html).not.toContain("<!--cc:");
    // A role closed after publishing disappears without republishing.
    await db.update(schema.hrJobs).set({ status: "closed" }).where(eq(schema.hrJobs.title, "Head barista"));
    expect(await page()).toContain("No open roles right now");
  });

  it("shows the empty message when the module is switched off", async () => {
    await db.update(schema.organizations).set({ modules: ["invoicing"] }).where(eq(schema.organizations.id, orgId));
    const html = await page();
    expect(html).toContain("No events coming up right now.");
    await db.update(schema.organizations).set({ modules: null }).where(eq(schema.organizations.id, orgId));
  });

  it("opens a Helpdesk ticket from the support form", async () => {
    expect((await submit("support", { name: "Ravi", email: "nope", subject: "x", message: "y" })).status).toBe(422);
    expect((await submit("support", { name: "Ravi", email: "ravi@example.com", subject: "Order not delivered", message: "Placed on Monday, still waiting." })).status).toBe(303);
    const [t] = await db.select().from(schema.hdTickets).where(eq(schema.hdTickets.orgId, orgId));
    expect(t).toMatchObject({ subject: "Order not delivered", customerEmail: "ravi@example.com", channel: "web", tags: ["website"] });
    const ack = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "ravi@example.com"));
    expect(ack.some((m) => m.subject.includes(t!.number))).toBe(true);
  });

  it("adds newsletter sign-ups to the CRM as subscribers who agreed to marketing", async () => {
    expect((await submit("newsletter", { email: "nina@example.com" })).status).toBe(303);
    const [c] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, orgId), eq(schema.crmContacts.email, "nina@example.com")));
    expect(c).toMatchObject({ lifecycle: "subscriber", marketing: true, source: "newsletter" });
  });
});
