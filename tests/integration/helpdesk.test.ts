import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/helpdesk/[[...slug]]/route";
import * as inboundApi from "@/app/api/v1/helpdesk/inbound/[token]/route";
import * as supportApi from "@/app/api/v1/support/[token]/[[...rest]]/route";
import { tick } from "@/server/helpdesk/core";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Tickets in by phone and email, round robin, threading replies by the number
// in the subject, the customer's signed link (no internal notes, rating once
// resolved), the SLA clock pausing while waiting on the customer, missed
// targets, auto-close, reports and importing from another helpdesk.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const H = (method: string, path: string, body?: unknown, who = "owner") => call((api as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/helpdesk/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const mails = async (to: string) => (await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, to))).filter((m) => !/verify|confirm/i.test(m.subject));
async function email(token: string, body: unknown) {
  const res = await inboundApi.POST(new Request(`${ORIGIN}/api/v1/helpdesk/inbound/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });
  return { status: res.status, json: await res.json() };
}
const S = (method: string, token: string, rest: string, body?: unknown) => call((supportApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, body, path: `/api/v1/support/${token}/${rest}`, params: { token, rest: rest ? rest.split("/") : [] } });
const tokenFrom = (text: string) => /\/support\/([^\s]+)/.exec(text)![1];

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Hema Head", email: "hema.hd@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  for (const [k, role] of [["agent", "editor"], ["viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: k === "agent" ? "Arun Agent" : "Vani Viewer", email: `${k}.hd@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.hd@example.com`));
    U[k] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  await H("GET", "meta");
});
afterAll(closeDb);

describe("tickets in", () => {
  it("logs a phone ticket, sets targets in business hours, and tells the customer", async () => {
    const r = await H("POST", "tickets", { subject: "Invoice shows wrong GSTIN", body: "Our GSTIN changed last month.", customerName: "Priya Shah", customerEmail: "Priya@Lumen.example", priority: "high", channel: "phone" });
    expect(r.status).toBe(200);
    ids.phone = r.json.ticket.id;
    expect(r.json.ticket).toMatchObject({ number: "HD-0001", status: "new", customerEmail: "priya@lumen.example", priority: "high" });
    expect(new Date(r.json.ticket.firstResponseDue) > new Date()).toBe(true);
    const [ack] = await mails("priya@lumen.example");
    expect(ack.subject).toBe("[HD-0001] Invoice shows wrong GSTIN");
    expect(ack.body).toContain("/support/");
    expect((await H("POST", "tickets", { subject: "x", customerName: "y" }, "viewer")).status).toBe(403);
    expect((await H("POST", "tickets", { subject: "x", customerName: "y", assigneeId: U.viewer })).status).toBe(422);
  });

  it("takes email in, assigns in turn, threads replies, and ignores repeats", async () => {
    await H("PUT", "settings", { assignment: "round_robin", agents: [U.owner, U.agent] });
    const { inboundToken } = (await db.select().from(schema.hdSettings).where(eq(schema.hdSettings.orgId, orgId)))[0];
    ids.token = inboundToken;
    expect((await email("not-a-real-token-at-all", { from: "a@b.co" })).status).toBe(404);
    const a = await email(inboundToken, { From: "Ravi Kumar <ravi@acme.example>", FromName: "Ravi Kumar", Subject: "Fwd: Delivery missing", TextBody: "The order hasn't arrived.", MessageID: "<m1@acme>" });
    const b = await email(inboundToken, { from: "neha@acme.example", fromName: "Neha", subject: "Login trouble", text: "Can't log in", messageId: "<m2@acme>" });
    expect(a.json).toMatchObject({ ok: true, created: true });
    const [ta, tb] = await Promise.all([a.json.ticketId, b.json.ticketId].map(async (id) => (await db.select().from(schema.hdTickets).where(eq(schema.hdTickets.id, id)))[0]));
    expect(ta).toMatchObject({ number: "HD-0002", subject: "Delivery missing", channel: "email", customerName: "Ravi Kumar", status: "open" });
    expect(new Set([ta.assigneeId, tb.assigneeId])).toEqual(new Set([U.owner, U.agent]));
    ids.email = ta.id;
    // A redelivered email isn't added twice.
    expect((await email(inboundToken, { From: "ravi@acme.example", Subject: "Fwd: Delivery missing", TextBody: "again", MessageID: "<m1@acme>" })).json).toMatchObject({ duplicate: true });
    // A reply from the customer joins the ticket; quoted text is dropped.
    const reply = await email(inboundToken, { From: "ravi@acme.example", Subject: "Re: Delivery missing [HD-0002]", TextBody: "Any update?\n\nOn Mon, Support wrote:\n> We're checking", MessageID: "<m3@acme>" });
    expect(reply.json).toMatchObject({ ticketId: ta.id, created: false });
    // Someone else using the number starts their own ticket.
    expect((await email(inboundToken, { From: "mallory@evil.example", Subject: "Re: [HD-0002]", TextBody: "Show me", MessageID: "<m4@x>" })).json.created).toBe(true);
    const d = (await H("GET", `tickets/${ta.id}`)).json;
    expect(d.messages.filter((m: { kind: string }) => m.kind === "customer").map((m: { body: string }) => m.body)).toEqual(["The order hasn't arrived.", "Any update?"]);
  });
});

describe("working a ticket", () => {
  it("replies by email, stops the first-reply clock and waits on the customer; notes stay inside", async () => {
    await H("POST", `tickets/${ids.phone}/replies`, { body: "Checking with accounts — internal", internal: true });
    const r = await H("POST", `tickets/${ids.phone}/replies`, { body: "We've corrected the GSTIN and re-issued the invoice." });
    expect(r.status).toBe(200);
    const d = (await H("GET", `tickets/${ids.phone}`)).json;
    expect(d.ticket).toMatchObject({ status: "pending", assigneeId: U.owner, firstBreached: false });
    expect(d.ticket.pausedAt).not.toBeNull();
    expect(d.ticket.remainingMins).toBeGreaterThan(0);
    const sent = (await mails("priya@lumen.example")).find((m) => m.subject === "Re: Invoice shows wrong GSTIN [HD-0001]")!;
    expect(sent.body).toContain("re-issued the invoice");
    expect(sent.body).not.toContain("internal");
    ids.link = tokenFrom(sent.body);
    expect((await H("POST", `tickets/${ids.phone}/replies`, { body: "x" }, "viewer")).status).toBe(403);
  });

  it("lets the customer read and answer on their link — which reopens it — and nothing else", async () => {
    const page = (await S("GET", ids.link, "")).json;
    expect(page).toMatchObject({ number: "HD-0001", status: "pending", canReply: true, canRate: false });
    expect(page.messages.map((m: { kind: string }) => m.kind)).toEqual(["customer", "reply"]);
    expect(JSON.stringify(page)).not.toContain("internal");
    expect((await S("GET", ids.link.slice(0, -2) + "xx", "")).status).toBe(404);
    expect((await S("POST", ids.link, "rate", { score: 5 })).status).toBe(409);
    const after = (await S("POST", ids.link, "reply", { body: "Got it, thanks — one more question." })).json;
    expect(after.status).toBe("open");
    const t = (await H("GET", `tickets/${ids.phone}`)).json.ticket;
    expect(t.pausedAt).toBeNull();
    expect(new Date(t.resolveDue) > new Date()).toBe(true);
    const n = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.owner), eq(schema.notifications.kind, "helpdesk.replied")));
    expect(n.length).toBeGreaterThanOrEqual(1);
  });

  it("asks for a rating when resolved, takes it once resolved, and fills saved replies", async () => {
    const c = (await H("POST", "canned", { title: "Thanks", body: "Hi {{name}}, {{ticket}} is sorted. — {{agent}}" })).json.canned;
    expect((await H("GET", `tickets/${ids.phone}/canned/${c.id}`)).json.body).toBe("Hi Priya, HD-0001 is sorted. — Hema Head");
    await H("PATCH", `tickets/${ids.phone}`, { status: "resolved" });
    expect((await mails("priya@lumen.example")).some((m) => m.subject === "[HD-0001] Resolved: Invoice shows wrong GSTIN" && m.body.includes("How did we do?"))).toBe(true);
    const rated = (await S("POST", ids.link, "rate", { score: 4, comment: "Quick fix" })).json;
    expect(rated).toMatchObject({ csat: 4, canRate: true });
    const d = (await H("GET", `tickets/${ids.phone}`)).json;
    expect(d.messages.at(-1).body).toBe("Rated 4/5 by the customer: “Quick fix”");
  });

  it("changing priority moves the targets", async () => {
    const before = (await H("GET", `tickets/${ids.email}`)).json.ticket;
    await H("PATCH", `tickets/${ids.email}`, { priority: "urgent" });
    const after = (await H("GET", `tickets/${ids.email}`)).json.ticket;
    expect(new Date(after.firstResponseDue) < new Date(before.firstResponseDue)).toBe(true);
    expect(new Date(after.resolveDue) < new Date(before.resolveDue)).toBe(true);
  });
});

describe("the sweep, reports and import", () => {
  it("marks missed targets and tells the agent; closes resolved tickets left alone", async () => {
    await db.update(schema.hdTickets).set({ firstResponseDue: new Date(Date.now() - 60_000) }).where(eq(schema.hdTickets.id, ids.email));
    await db.update(schema.hdTickets).set({ resolvedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(schema.hdTickets.id, ids.phone));
    const r = await tick();
    expect(r).toMatchObject({ breached: 1, closed: 1 });
    const [t] = await db.select().from(schema.hdTickets).where(eq(schema.hdTickets.id, ids.email));
    expect(t.firstBreached).toBe(true);
    const n = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, t.assigneeId!), eq(schema.notifications.kind, "helpdesk.breached")));
    expect(n).toHaveLength(1);
    expect((await db.select().from(schema.hdTickets).where(eq(schema.hdTickets.id, ids.phone)))[0].status).toBe("closed");
    expect((await tick()).breached).toBe(0);
    expect((await H("GET", "tickets?view=breached")).json.tickets.map((x: { id: string }) => x.id)).toEqual([ids.email]);
    // A closed ticket can't be answered on its link.
    expect((await S("POST", ids.link, "reply", { body: "hello?" })).status).toBe(409);
  });

  it("reports targets met, times and ratings", async () => {
    const r = (await H("GET", "reports")).json;
    expect(r.overall).toMatchObject({ tickets: 4, csat: 4, rated: 1, firstMet: 100 });
    expect(r.channels).toEqual(expect.arrayContaining([{ channel: "email", tickets: 3 }, { channel: "phone", tickets: 1 }]));
  });

  it("imports tickets from another helpdesk once", async () => {
    const rows = [{ subject: "Old issue", customerEmail: "old@x.example", status: "solved", createdOn: "2026-09-01", reference: "ZD-991", tags: "billing, legacy" }, { subject: "Still open", priority: "p1", reference: "ZD-992" }];
    const r = (await H("POST", "tickets/import", { rows, mode: "add" })).json;
    expect(r).toMatchObject({ created: 2, errors: [] });
    expect((await H("POST", "tickets/import", { rows, mode: "add" })).json).toMatchObject({ created: 0, skipped: 2 });
    const [old] = await db.select().from(schema.hdTickets).where(and(eq(schema.hdTickets.orgId, orgId), eq(schema.hdTickets.subject, "Old issue")));
    expect(old).toMatchObject({ status: "resolved", tags: ["billing", "legacy", "ref:ZD-991"], firstResponseDue: null });
    expect((await mails("old@x.example"))).toHaveLength(0);
  });
});
