import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/copilot/[[...slug]]/route";
import * as calApi from "@/app/api/v1/orgs/[orgId]/calendar/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// The briefing AI mode opens with, built from the workspace without a model:
// the next meetings, follow-ups that are due or late, deals to ask about, and
// setup steps — each a prompt the copilot can act on.
let orgId = "";
let cookie = "";
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown) => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0]!.split("/").filter(Boolean) } });
const A = mk(api, "copilot");
const CAL = mk(calApi, "calendar");
const CRM = mk(crmApi, "crm");

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Bina Brief", email: "bina.brief@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
});
afterAll(closeDb);

describe("the AI mode briefing", () => {
  it("is calm on an empty workspace, and suggests setting up", async () => {
    const r = await A("GET", "briefing");
    expect(r.status).toBe(200);
    expect(r.json.counts).toEqual({ meetings: 0, replies: 0, overdueInvoices: 0, overdueTasks: 0 });
    expect(r.json.suggestions.map((x: { label: string }) => x.label)).toEqual(expect.arrayContaining(["Finish my business details", "Invite my team"]));
    expect(r.json.updates.map((x: { label: string }) => x.label)).toContain("Plan my day");
  });

  it("brings up the next meeting, late follow-ups and quiet deals", async () => {
    const cals = (await CAL("GET", "meta")).json;
    const calendarId = (cals.calendars ?? cals.meta?.calendars ?? [])[0]?.id;
    const start = new Date(Date.now() + 60 * 60_000);
    const ev = await CAL("POST", "events", { calendarId, title: "Call with Lumen", start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString() });
    expect(ev.status).toBeLessThan(300);

    const contact = (await CRM("POST", "contacts", { name: "Asha Kulkarni", email: "asha@lumen.example" })).json.contact;
    const deal = (await CRM("POST", "deals", { title: "Lumen pilot", value: 250000_00, contactId: contact.id })).json.deal;
    await CRM("POST", "activities", { kind: "task", subject: "Send Lumen the proposal", dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), contactId: contact.id, dealId: deal.id });
    // The deal hasn't moved for ten days.
    await db.update(schema.crmDeals).set({ updatedAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(schema.crmDeals.id, deal.id));

    const r = await A("GET", "briefing");
    expect(r.status).toBe(200);
    const b = r.json;
    expect(b.counts.meetings).toBe(1);
    expect(b.counts.overdueTasks).toBe(1);
    expect(b.today.map((x: { text: string }) => x.text)).toEqual(expect.arrayContaining(["Call with Lumen", "Send Lumen the proposal"]));
    expect(b.today.find((x: { text: string }) => x.text === "Send Lumen the proposal")).toMatchObject({ sub: "Follow-up · overdue", tone: "warning", href: `/crm/deals/${deal.id}` });
    expect(b.suggestions.map((x: { label: string }) => x.label)).toEqual(expect.arrayContaining(["Prepare for “Call with Lumen”", "Sort out 1 overdue task"]));
    expect(b.updates[0]).toMatchObject({ label: "Any news on “Lumen pilot”?" });
    expect(b.updates[0].prompt).toMatch(/₹2\.50 L/);
  });
});
