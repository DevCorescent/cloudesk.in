import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as api from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as capture from "@/app/api/v1/crm/capture/[token]/route";
import * as unsub from "@/app/u/[token]/route";
import { captureFromEvent } from "@/server/crm/capture";
import { unsubscribeToken } from "@/server/crm/activities";
import { saveGuest } from "@/server/horeca/guests";
import { drain } from "@/server/jobs/queue";
import "@/server/jobs/registry";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let editor = "";
let viewer = "";
let orgId = "";
let ownerId = "";
let editorId = "";
let projectId = "";
const h = (method: string, path: string, body?: unknown, cookie = owner) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/crm/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
// Query strings travel in the path for the handler to read.
const get = (path: string, cookie = owner) => call(api.GET, { method: "GET", cookie, path: `/api/v1/orgs/${orgId}/crm/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Riya Sen", email: "riya.crm@example.com", password: "correct-horse-42" } }));
  const meRes = (await call(me.GET, { cookie: owner })).json;
  orgId = meRes.organizations[0].id;
  ownerId = meRes.user.id;
  editor = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Kabir Rep", email: "kabir.crm@example.com", password: "correct-horse-42" } }));
  editorId = (await call(me.GET, { cookie: editor })).json.user.id;
  await db.insert(schema.memberships).values({ orgId, userId: editorId, role: "editor" });
  viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vee Viewer", email: "vee.crm@example.com", password: "correct-horse-42" } }));
  await db.insert(schema.memberships).values({ orgId, userId: (await call(me.GET, { cookie: viewer })).json.user.id, role: "viewer" });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner, params: { orgId }, body: { templateId: "blank", name: "Sen Studio" } })).json.project.id;
});
afterAll(closeDb);

describe("CRM", () => {
  let asha = "";
  let deal = "";
  let stages: { id: string; name: string; kind: string; probability: number }[] = [];

  it("sets up a default sales pipeline on first use", async () => {
    const r = await get("meta");
    expect(r.status).toBe(200);
    expect(r.json.pipelines).toHaveLength(1);
    stages = r.json.pipelines[0].stages;
    expect(stages.map((s) => s.name)).toEqual(["New lead", "Contacted", "Qualified", "Proposal sent", "Negotiation", "Won", "Lost"]);
    expect(r.json.me).toMatchObject({ manage: true, write: true });
    expect(r.json.settings.captureUrl).toMatch(/\/api\/v1\/crm\/capture\//);
    expect((await get("meta", editor)).json.settings.captureUrl).toBeNull();
  });

  it("adds a contact with a company, and refuses a duplicate email", async () => {
    const r = await h("POST", "contacts", { name: "Asha Kapoor", email: "Asha@Acme.in", phone: "+91 98200 11111", title: "Head of Ops", companyName: "Acme Foods" });
    expect(r.status).toBe(200);
    asha = r.json.contact.id;
    expect(r.json.contact.email).toBe("asha@acme.in");
    expect(r.json.contact.companyId).toBeTruthy();
    expect(r.json.contact.ownerId).toBe(ownerId);
    // Score from the default rules: email, phone, company, title.
    expect(r.json.contact.score).toBe(35);
    const dup = await h("POST", "contacts", { name: "A. Kapoor", email: "asha@acme.in" });
    expect(dup.status).toBe(409);
    expect(dup.json.error.details.existingId).toBe(asha);
    // Same phone, different email: still the same person.
    expect((await h("POST", "contacts", { name: "Asha", phone: "9820011111" })).status).toBe(409);
    // A colleague at the same domain joins the company once it has a domain.
    const co = (await get(`contacts/${asha}`)).json.company;
    await h("PUT", `companies/${co.id}`, { domain: "acme.in" });
    const r2 = await h("POST", "contacts", { name: "Dev Rao", email: "dev@acme.in" });
    expect(r2.json.contact.companyId).toBe(co.id);
  });

  it("filters, searches and bulk-edits contacts", async () => {
    for (const [name, email, lifecycle] of [["Meera Iyer", "meera@zen.io", "qualified"], ["Tom Lee", "tom@zen.io", "customer"], ["Ola Bose", "ola@gmail.com", "lead"]]) await h("POST", "contacts", { name, email, lifecycle });
    expect((await get("contacts?q=zen")).json.total).toBe(2);
    expect((await get("contacts?lifecycle=customer,qualified")).json.total).toBe(2);
    expect((await get("contacts?q=98200")).json.contacts[0].name).toBe("Asha Kapoor");
    const ids = (await get("contacts?q=zen")).json.contacts.map((c: { id: string }) => c.id);
    expect((await h("POST", "contacts/bulk", { ids, action: "tag_add", value: "VIP" })).json.count).toBe(2);
    expect((await get("contacts?tag=VIP")).json.total).toBe(2);
    // "Everything matching" without listing ids.
    expect((await h("POST", "contacts/bulk", { query: { tag: "VIP" }, action: "owner", value: editorId })).json.count).toBe(2);
    expect((await get("contacts?owner=" + editorId)).json.total).toBe(2);
    const search = (await get("search?q=acme")).json;
    expect(search.companies[0].name).toBe("Acme Foods");
  });

  it("runs a deal through the pipeline: weighted board, lost needs a reason, won makes a customer", async () => {
    const r = await h("POST", "deals", { title: "Acme — annual catering", value: 50000000, contactId: asha });
    expect(r.status).toBe(200);
    deal = r.json.deal.id;
    expect(r.json.deal.stageId).toBe(stages[0].id);
    expect(r.json.deal.companyId).toBeTruthy(); // from the contact
    expect((await get(`contacts/${asha}`)).json.contact.lifecycle).toBe("opportunity");
    await h("POST", `deals/${deal}/move`, { stageId: stages[3].id });
    const board = (await get("deals/board")).json;
    expect(board.columns[3].deals[0].id).toBe(deal);
    expect(board.totals.weighted).toBe(30000000); // 60% of ₹5,00,000
    const lost = await h("POST", `deals/${deal}/move`, { stageId: stages[6].id });
    expect(lost.status).toBe(422);
    await h("POST", `deals/${deal}/move`, { stageId: stages[5].id });
    const view = (await get(`deals/${deal}`)).json;
    expect(view.deal.status).toBe("won");
    expect(view.activities.some((a: { subject: string }) => a.subject.startsWith("Deal won"))).toBe(true);
    expect((await get(`contacts/${asha}`)).json.contact.lifecycle).toBe("customer");
    // Reopening by moving back.
    await h("POST", `deals/${deal}/move`, { stageId: stages[4].id });
    expect((await get(`deals/${deal}`)).json.deal).toMatchObject({ status: "open", closedAt: null });
    await h("POST", `deals/${deal}/move`, { stageId: stages[5].id });
  });

  it("logs calls and notes, and keeps a to-do list", async () => {
    const meera = (await get("contacts?q=meera")).json.contacts[0];
    const call1 = await h("POST", "activities", { kind: "call", subject: "Intro call", body: "Wants a demo next week", outcome: "connected", durationMin: 12, contactId: meera.id });
    expect(call1.status).toBe(200);
    expect((await get(`contacts/${meera.id}`)).json.contact.leadStatus).toBe("contacted");
    const due = new Date(Date.now() - 3600_000).toISOString();
    const t = (await h("POST", "activities", { kind: "task", subject: "Send the demo link", dueAt: due, contactId: meera.id })).json.activity;
    expect((await get("tasks")).json.open.map((x: { id: string }) => x.id)).toContain(t.id);
    expect((await h("POST", "activities", { kind: "note", contactId: meera.id })).status).toBe(422);
    await h("PUT", `activities/${t.id}`, { done: true });
    const after = (await get("tasks")).json;
    expect(after.open.map((x: { id: string }) => x.id)).not.toContain(t.id);
    expect(after.done[0].id).toBe(t.id);
    const home = (await get("home")).json;
    expect(home.kpis.contacts).toBeGreaterThanOrEqual(5);
    expect(home.kpis.wonMonth).toBe(50000000);
  });

  it("emails a contact (recorded when no mail service is set up), and honours unsubscribe", async () => {
    const meera = (await get("contacts?q=meera")).json.contacts[0];
    const r = await h("POST", `contacts/${meera.id}/email`, { subject: "Hi {{first_name}}", body: "Here's the deck, {{first_name}}." });
    expect(r.status).toBe(200);
    expect(r.json.delivered).toBe(false);
    expect(r.json.activity.subject).toBe("Hi Meera");
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "meera@zen.io"));
    expect(mail.body).toContain("Here's the deck, Meera.");
    expect(mail.body).toContain("/u/");
    const token = unsubscribeToken(meera.id);
    // Opening the link changes nothing; the button does.
    expect((await call(unsub.GET, { params: { token } })).status).toBe(200);
    expect((await get(`contacts/${meera.id}`)).json.contact.doNotContact).toBe(false);
    expect((await call(unsub.POST, { method: "POST", params: { token } })).status).toBe(200);
    expect((await get(`contacts/${meera.id}`)).json.contact.doNotContact).toBe(true);
    expect((await h("POST", `contacts/${meera.id}/email`, { subject: "Again", body: "?" })).status).toBe(409);
    expect((await call(unsub.POST, { method: "POST", params: { token: token.slice(0, -2) + "xx" } })).status).toBe(404);
  });

  it("captures leads from website forms, the web-to-lead link and restaurant guests", async () => {
    await captureFromEvent(projectId, "form.submitted", { formName: "Contact us", data: { "Your name": "Nisha Patel", Email: "nisha@bloom.co", Phone: "98111 22233", Company: "Bloom & Co", Message: "Need a quote for 40 people" } });
    const nisha = (await get("contacts?q=nisha")).json.contacts[0];
    expect(nisha).toMatchObject({ name: "Nisha Patel", email: "nisha@bloom.co", source: "web_form", company: "Bloom & Co" });
    const t = (await get(`contacts/${nisha.id}`)).json;
    expect(t.activities.some((a: { body: string }) => a.body === "Need a quote for 40 people")).toBe(true);
    // The same person again only updates them.
    await captureFromEvent(projectId, "form.submitted", { formName: "Newsletter", data: { email: "NISHA@bloom.co" } });
    expect((await get("contacts?q=nisha")).json.total).toBe(1);

    const url: string = (await get("meta")).json.settings.captureUrl;
    const token = url.split("/").pop()!;
    const lead = await call(capture.POST, { method: "POST", origin: "https://somewhere-else.com", params: { token }, body: { name: "Zoya Khan", email: "zoya@khan.dev", message: "Interested" } });
    expect(lead.status).toBe(200);
    expect(lead.headers.get("access-control-allow-origin")).toBe("*");
    expect((await get("contacts?q=zoya")).json.contacts[0].source).toBe("web_to_lead");
    expect((await call(capture.POST, { method: "POST", params: { token: "nope" }, body: { email: "x@y.z" } })).status).toBe(404);
    expect((await call(capture.POST, { method: "POST", params: { token }, body: { name: "No contact" } })).status).toBe(422);

    await saveGuest(projectId, { name: "Arjun Mehta", phone: "+91 99000 55555" });
    const arjun = (await get("contacts?q=arjun")).json.contacts[0];
    expect(arjun).toMatchObject({ source: "horeca", lifecycle: "customer" });
    // Their restaurant visits show on the profile.
    expect((await get(`contacts/${arjun.id}`)).json.linked.visits).toHaveLength(1);
  });

  it("finds and merges duplicates", async () => {
    // Two records the system couldn't tell apart on the way in (different email, same phone).
    const [a] = await db.insert(schema.crmContacts).values({ orgId, name: "Sam Roy", email: "sam@one.com", phone: "9000012345", tags: ["a"] }).returning();
    const [b] = await db.insert(schema.crmContacts).values({ orgId, name: "", email: "sam@two.com", phone: "+91 90000 12345", title: "CTO", tags: ["b"] }).returning();
    await h("POST", "activities", { kind: "note", body: "Met at the expo", contactId: b.id });
    const groups = (await get("contacts/duplicates")).json.groups;
    const g = groups.find((x: { contacts: { id: string }[] }) => x.contacts.some((c) => c.id === a.id));
    expect(g.by).toBe("phone");
    const merged = (await h("POST", "contacts/merge", { keepId: a.id, otherIds: [b.id] })).json;
    expect(merged.contact).toMatchObject({ name: "Sam Roy", email: "sam@one.com", title: "CTO" });
    expect(merged.contact.tags.sort()).toEqual(["a", "b"]);
    expect(merged.activities.some((x: { body: string }) => x.body === "Met at the expo")).toBe(true);
    expect((await get(`contacts/${b.id}`)).status).toBe(404);
  });

  it("runs a follow-up sequence in the background and stops on unsubscribe", async () => {
    const seq = (await h("POST", "sequences", { name: "New lead nurture", steps: [{ kind: "email", delayDays: 0, subject: "Welcome, {{first_name}}", body: "Thanks for reaching out." }, { kind: "task", delayDays: 0, subject: "Call them" }, { kind: "email", delayDays: 3, subject: "Checking in", body: "Any questions?" }] })).json.sequence;
    const zoya = (await get("contacts?q=zoya")).json.contacts[0];
    const meera = (await get("contacts?q=meera")).json.contacts[0];
    const r = (await h("POST", `sequences/${seq.id}/enroll`, { contactIds: [zoya.id, meera.id] })).json;
    expect(r.added).toBe(1);
    expect(r.skipped[0].why).toBe("Do not contact");
    await drain();
    const v = (await get(`sequences/${seq.id}`)).json;
    expect(v.enrolled[0]).toMatchObject({ status: "active", step: 2 });
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "zoya@khan.dev"));
    expect(mail.subject).toBe("Welcome, Zoya");
    const [task] = await db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.contactId, zoya.id), eq(schema.crmActivities.kind, "task")));
    expect(task.subject).toBe("Call them");
    expect((await h("POST", `sequences/${seq.id}/enroll`, { contactIds: [zoya.id] })).json.skipped[0].why).toBe("Already in it");
    await call(unsub.POST, { method: "POST", params: { token: unsubscribeToken(zoya.id) } });
    expect((await get(`sequences/${seq.id}`)).json.enrolled[0]).toMatchObject({ status: "stopped", stopReason: "Unsubscribed" });
  });

  it("imports a spreadsheet without duplicating, and exports CSV", async () => {
    await h("POST", "fields", { entity: "contact", label: "Annual budget", type: "number" });
    const r = await h("POST", "contacts/import", {
      rows: [
        { name: "Imran Ali", email: "imran@delta.in", company: "Delta Labs", tags: "expo, hot", "custom.annual_budget": "250000" },
        { first_name: "Asha", last_name: "K", email: "asha@acme.in", city: "Mumbai" },
        { name: "", email: "bad-email" },
      ],
      tags: ["Expo 2026"],
    });
    expect(r.json).toMatchObject({ created: 1, updated: 1 });
    expect(r.json.skipped[0].row).toBe(3);
    const imran = (await get("contacts?q=imran")).json.contacts[0];
    expect(imran.tags.sort()).toEqual(["Expo 2026", "expo", "hot"]);
    expect(imran.custom).toEqual({ annual_budget: "250000" });
    expect(imran.company).toBe("Delta Labs");
    const asha = (await get("contacts?q=asha@acme.in")).json.contacts[0];
    expect(asha.city).toBe("Mumbai");
    expect(asha.name).toBe("Asha Kapoor"); // not overwritten
    const csv = await get("contacts/export?q=imran");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.text).toContain("Imran Ali");
    expect(csv.text).toContain("Annual budget");
  });

  it("reports win rate, forecast and each rep's activity", async () => {
    const ds = (await get("meta")).json.pipelines[0].stages;
    const d2 = (await h("POST", "deals", { title: "Zen — pilot", value: 10000000, expectedClose: "2026-12-15" })).json.deal;
    await h("POST", `deals/${d2.id}/move`, { stageId: ds[2].id });
    const d3 = (await h("POST", "deals", { title: "Bloom — event", value: 4000000 })).json.deal;
    await h("POST", `deals/${d3.id}/move`, { stageId: ds[6].id, lostReason: "Price" });
    const r = (await get("reports")).json;
    expect(r.totals).toMatchObject({ won: 1, lost: 1, winRate: 50, wonValue: 50000000 });
    expect(r.lostReasons).toEqual([{ reason: "Price", count: 1 }]);
    expect(r.forecast.find((f: { month: string }) => f.month === "2026-12")).toMatchObject({ total: 10000000, weighted: 4000000 });
    const riya = r.reps.find((x: { name: string }) => x.name === "Riya Sen");
    expect(riya.calls).toBe(1);
    expect(r.sources.find((x: { source: string }) => x.source === "web_form").leads).toBe(1);
  });

  it("keeps records private to their owner when the workspace asks, and viewers read-only", async () => {
    expect((await get("contacts", editor)).json.total).toBeGreaterThan(2);
    await h("PUT", "settings", { visibility: "own" });
    const mine = (await get("contacts", editor)).json;
    // Their own two plus unowned leads (captured ones arrive unassigned).
    expect(mine.contacts.every((c: { ownerId: string | null }) => c.ownerId === editorId || c.ownerId === null)).toBe(true);
    expect((await get(`contacts/${asha}`, editor)).status).toBe(404);
    expect((await get("contacts", owner)).json.total).toBeGreaterThan(mine.total);
    await h("PUT", "settings", { visibility: "all" });
    expect((await h("POST", "contacts", { name: "Nope" }, viewer)).status).toBe(403);
    expect((await get("contacts", viewer)).status).toBe(200);
    expect((await h("DELETE", `contacts/${asha}`, undefined, editor)).status).toBe(403);
    expect((await h("PUT", "settings", { visibility: "own" }, editor)).status).toBe(403);
  });

  it("assigns captured leads round-robin", async () => {
    await h("PUT", "settings", { assignment: "round_robin" });
    for (const n of ["one", "two", "three", "four"]) await captureFromEvent(projectId, "form.submitted", { data: { name: `RR ${n}`, email: `rr-${n}@leads.dev` } });
    const people = (await get("contacts?q=leads.dev&sort=created&dir=asc")).json.contacts.map((c: { ownerId: string }) => c.ownerId);
    expect(new Set(people)).toEqual(new Set([ownerId, editorId]));
    expect(people[0]).not.toBe(people[1]);
  });

  it("is off when the workspace hasn't switched the CRM on", async () => {
    await db.update(schema.organizations).set({ modules: ["store"] }).where(eq(schema.organizations.id, orgId));
    expect((await get("meta")).status).toBe(403);
    await captureFromEvent(projectId, "form.submitted", { data: { email: "ghost@nowhere.dev" } });
    await db.update(schema.organizations).set({ modules: null }).where(eq(schema.organizations.id, orgId));
    expect((await get("contacts?q=ghost")).json.total).toBe(0);
  });
});

