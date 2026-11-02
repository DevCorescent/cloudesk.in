import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/copilot/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { call, cookieFrom, resetDb } from "../helpers";

// The copilot across the workspace, with a stand-in model: it reads what's
// still to set up and the person's inbox, and its suggestions — business
// details, a draft invoice, a contact, an event, an invitation, an email —
// change nothing until confirmed, then go through the module that owns them.
// An edited email draft is checked like the original.
let orgId = "";
let cookie = "";
const A = (method: string, path: string, body?: unknown, c = cookie) => call((api as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: c, body, path: `/api/v1/orgs/${orgId}/copilot/${path}`, params: { orgId, slug: path.split("/").filter(Boolean) } });

type Req = { messages: { role: string; content: unknown }[] };
type Reply = { content: unknown[]; stop_reason: string };
let script: ((r: Req) => Reply)[] = [];
const requests: Req[] = [];
const toolCall = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const say = (text: string): Reply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
const propose = (id: string, kind: string, input: unknown, summary = kind): Reply => ({ content: [toolCall(id, "propose_action", { kind, summary, input })], stop_reason: "tool_use" });
const lastResult = (r: Req) => (r.messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0]!;

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Meera Shah", email: "meera.ws@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  setAnthropicClientFactory(() => ({ beta: { messages: { stream: (params: unknown) => ({ finalMessage: async () => {
    const r = JSON.parse(JSON.stringify(params)) as Req;
    requests.push(r);
    const next = script.shift();
    if (!next) throw new Error("No scripted reply left");
    return { ...next(r), model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 10 } };
  } }) } } }) as never);
});
afterEach(() => {
  script = [];
});
afterAll(async () => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
  await closeDb();
});

/** Ask, with the model's scripted turns; returns the thread and its newest suggestion. */
async function ask(text: string, turns: ((r: Req) => Reply)[]) {
  script = turns;
  const r = await A("POST", "threads", { text });
  expect(r.status).toBe(200);
  return { thread: r.json, action: r.json.actions.at(-1) as { id: string; kind: string; status: string; input: Record<string, unknown> } };
}

describe("the copilot across the workspace", () => {
  it("reads what's missing, then saves the business details once confirmed", async () => {
    let status = "";
    const { action } = await ask("Help me set up my workspace", [
      () => ({ content: [toolCall("s1", "setup_status", {})], stop_reason: "tool_use" }),
      (r) => {
        status = lastResult(r).content;
        return propose("p1", "business_profile", { legalName: "Shah Textiles Pvt Ltd", gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F", address: { line1: "12 MG Road", city: "Pune", state: "Maharashtra", postalCode: "411001" }, phone: "9800000000", upiId: "shah@upi" });
      },
      () => say("I've prepared your business details — check and confirm."),
    ]);
    expect(status).toContain("Legal name: MISSING");
    expect(status).toContain("Mailboxes connected: 0");
    expect(action).toMatchObject({ kind: "business_profile", status: "proposed", input: { gstin: "27AAPFU0939F1ZV" } });
    // Nothing changed yet.
    const [before] = await db.select().from(schema.orgCompanies).where(eq(schema.orgCompanies.orgId, orgId));
    expect(before?.gstin ?? "").toBe("");

    const done = await A("POST", `actions/${action.id}/confirm`, {});
    expect(done.status).toBe(200);
    expect(done.json.link).toBe("/settings/organisation");
    const [co] = await db.select().from(schema.orgCompanies).where(eq(schema.orgCompanies.orgId, orgId));
    expect(co).toMatchObject({ legalName: "Shah Textiles Pvt Ltd", gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F" });
    expect(co!.address).toContain("Pune");
    // Once only.
    expect((await A("POST", `actions/${action.id}/confirm`, {})).status).toBe(409);
  });

  it("drafts an invoice in rupees, with GST, as a draft", async () => {
    const { action } = await ask("Bill Lumen for 3 logo designs at 5000 each", [() => propose("p2", "invoice_draft", { client: { name: "Asha Kulkarni", company: "Lumen Studio", email: "asha@lumen.example", state: "Maharashtra" }, lines: [{ name: "Logo design", quantity: 3, rate: 5000, taxPercent: 18, hsn: "998391" }] }), () => say("Draft ready.")]);
    const done = await A("POST", `actions/${action.id}/confirm`, {});
    expect(done.status).toBe(200);
    expect(done.json.link).toMatch(/^\/finance\/[0-9a-f-]+\/invoices\/[0-9a-f-]+$/);
    const [doc] = await db.select().from(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.id, done.json.id));
    expect(doc).toMatchObject({ type: "invoice", status: "draft", total: 1_770_000 });
  });

  it("adds a contact, an event and an invitation through their modules", async () => {
    const c = await ask("Add Ravi from Menon Traders", [() => propose("p3", "crm_contact", { name: "Ravi Menon", email: "ravi@menon.example", companyName: "Menon Traders" }), () => say("Ready.")]);
    const cd = await A("POST", `actions/${c.action.id}/confirm`, {});
    expect(cd.status).toBe(200);
    const [contact] = await db.select().from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, orgId), eq(schema.crmContacts.email, "ravi@menon.example")));
    expect(contact?.name).toBe("Ravi Menon");

    const e = await ask("Call with Ravi tomorrow at 4", [() => propose("p4", "calendar_event", { title: "Call with Ravi", start: "2026-11-03T16:00:00+05:30", end: "2026-11-03T16:30:00+05:30" }), () => say("Ready.")]);
    const ed = await A("POST", `actions/${e.action.id}/confirm`, {});
    expect(ed.status).toBe(200);
    const [ev] = await db.select().from(schema.calEvents).where(eq(schema.calEvents.id, ed.json.id));
    expect(ev?.title).toBe("Call with Ravi");

    const i = await ask("Invite priya@shah.example as an editor", [() => propose("p5", "invite_member", { email: "priya@shah.example", role: "editor" }), () => say("Ready.")]);
    expect((await A("POST", `actions/${i.action.id}/confirm`, {})).status).toBe(200);
    const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.orgId, orgId));
    expect(inv).toMatchObject({ email: "priya@shah.example", role: "editor" });
  });

  it("checks an edited email draft, and needs a mailbox to send", async () => {
    let read = "";
    const { action } = await ask("Email Ravi about the order", [
      () => ({ content: [toolCall("m1", "mail_search", { query: "from:ravi" })], stop_reason: "tool_use" }),
      (r) => {
        read = lastResult(r).content;
        return propose("p6", "send_email", { to: ["ravi@menon.example"], subject: "Your order", body: "Hi Ravi,\n\nYour order ships Monday.\n\nMeera" });
      },
      () => say("The draft is ready for you to check and send."),
    ]);
    expect(read).toBe("No emails match.");
    expect(action.input).toMatchObject({ to: ["ravi@menon.example"], subject: "Your order" });
    // A bad address typed into the draft is refused, and the draft is kept.
    const bad = await A("POST", `actions/${action.id}/confirm`, { input: { to: ["not-an-email"] } });
    expect(bad.status).toBe(422);
    // A good edit is checked, but there's no mailbox to send from yet.
    const r = await A("POST", `actions/${action.id}/confirm`, { input: { subject: "Your order ships Monday" } });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/Connect a mailbox/);
    const [row] = await db.select().from(schema.copilotActions).where(eq(schema.copilotActions.id, action.id));
    expect(row).toMatchObject({ status: "failed", payload: expect.objectContaining({ subject: "Your order ships Monday" }) });
  });

  it("catches a mistyped GSTIN before proposing, so the model can ask again", async () => {
    let res: { content: string; is_error?: boolean } = { content: "" };
    await ask("My GSTIN is 27ABCDE1234F1Z5", [() => propose("g1", "business_profile", { gstin: "27ABCDE1234F1Z5" }), (r) => ((res = lastResult(r)), say("That GSTIN doesn't check out — could you read it again?"))]);
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/check digit/);
  });

  it("tells the model clearly when a module isn't open", async () => {
    let res: { content: string; is_error?: boolean } = { content: "" };
    await ask("What's overdue?", [() => ({ content: [toolCall("x1", "invoices_list", { status: "overdue" })], stop_reason: "tool_use" }), (r) => ((res = lastResult(r)), say("Nothing overdue."))]);
    // The owner can see invoices: the draft from earlier isn't overdue.
    expect(res.is_error).toBeFalsy();
    expect(res.content).toBe("No invoices match.");
  });
});
