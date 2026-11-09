import { and, desc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/requisitions/[[...slug]]/route";
import * as collectApi from "@/app/api/v1/collect/[token]/[[...rest]]/route";
import { onRequisitionMail, requisitionsTick } from "@/server/requisitions/core";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Requisitions end to end: asking a client, reminders on the schedule (and
// when they stop), the client's link (view, upload, note), replies read and
// matched to items, sending a wrong file back, finishing with a thank-you,
// tracking, permissions and import.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const R = (method: string, path: string, body?: unknown, who = "owner") => call((api as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/requisitions/${path}`, params: { orgId, slug: path.split("?")[0]!.split("/").filter(Boolean) } });
const tokenOf = (link: string) => link.split("/collect/")[1]!;
const pub = (method: string, token: string, rest: string[] = [], body?: unknown) => call((collectApi as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, body, path: `/api/v1/collect/${token}/${rest.join("/")}`, params: { token, rest } });
const mails = (subject: string) => db.select().from(schema.outboundEmails).where(like(schema.outboundEmails.subject, `%${subject}%`)).orderBy(desc(schema.outboundEmails.createdAt));
const acc = () => ({ id: "00000000-0000-0000-0000-000000000000", orgId, address: "meera@rao.example" });
let mailN = 0;
const reply = (over: Partial<Parameters<typeof onRequisitionMail>[1]> = {}) => onRequisitionMail(acc(), { threadId: crypto.randomUUID(), mailId: crypto.randomUUID(), headerId: `<r${++mailN}@client.example>`, inReplyTo: "", refs: [], from: { name: "Asha", address: "asha@client.example" }, subject: "Re: ITR documents — documents needed [REQ-0001]", text: "", files: [], ...over });
const ids: Record<string, string> = {};

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Meera Rao", email: "meera.rq@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  C.viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik Viewer", email: "viewer.rq@example.com", password: "correct-horse-42" } }));
  const [v] = await db.select().from(schema.users).where(eq(schema.users.email, "viewer.rq@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: v!.id, role: "viewer" });
  expect((await R("GET", "meta")).status).toBe(200);
});
afterAll(closeDb);

describe("asking a client", () => {
  it("sends the request with every item, the client's link and a number to thread replies", async () => {
    const r = await R("POST", "lists", { title: "ITR documents", clientName: "Asha Kulkarni", clientEmail: "Asha@Client.example", dueDate: "2030-01-31", items: [{ title: "PAN card" }, { title: "Form 16", description: "From each employer" }, { title: "Bank statements" }, { title: "Rent receipts", required: false }], schedule: { everyDays: 2, at: "10:30", weekdaysOnly: false, maxReminders: 2, quietAfterReply: 2, escalate: true } });
    expect(r.status).toBe(200);
    ids.list = r.json.list.id;
    ids.token = tokenOf(r.json.link);
    expect(r.json.list).toMatchObject({ number: "REQ-0001", status: "active", clientEmail: "asha@client.example", got: 0, of: 3, remindersSent: 0, via: "platform" });
    expect(new Date(r.json.list.nextReminderAt).getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    const [sent] = await mails("[REQ-0001]");
    expect(sent).toMatchObject({ to: "asha@client.example", subject: "ITR documents — documents needed [REQ-0001]" });
    expect(sent!.body).toContain("• PAN card");
    expect(sent!.body).toContain(r.json.link);
    expect(r.json.events.map((e: { kind: string }) => e.kind)).toEqual(["requested", "created"]);
  });

  it("lets only those who chase clients make one", async () => {
    expect((await R("POST", "lists", { title: "x", clientEmail: "x@y.example", items: [{ title: "a" }] }, "viewer")).status).toBe(403);
    expect((await R("GET", "lists", undefined, "viewer")).status).toBe(200);
  });
});

describe("the client's link", () => {
  it("shows what's needed and notes the view", async () => {
    const r = await pub("GET", ids.token!);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ number: "REQ-0001", title: "ITR documents", progress: { got: 0, of: 3 } });
    expect(r.json.items.map((i: { title: string }) => i.title)).toEqual(["PAN card", "Form 16", "Bank statements", "Rent receipts"]);
    const d = (await R("GET", `lists/${ids.list}`)).json;
    expect(d.list.views).toBe(1);
    expect(d.events[0]).toMatchObject({ kind: "viewed", detail: { first: true } });
    expect((await pub("GET", `${ids.list}.wrongsignature`)).status).toBe(404);
  });

  it("takes an upload against an item and marks it received", async () => {
    const form = new FormData();
    const form16 = (await pub("GET", ids.token!)).json.items.find((i: { title: string }) => i.title === "Form 16").id;
    form.set("itemId", form16);
    form.set("file", new File([Buffer.from("%PDF-1.4 form 16")], "form16.pdf", { type: "application/pdf" }));
    const res = await collectApi.POST(new Request(`${ORIGIN}/api/v1/collect/${ids.token}/upload`, { method: "POST", body: form, headers: { origin: ORIGIN } }), { params: Promise.resolve({ token: ids.token!, rest: ["upload"] }) });
    expect(res.status).toBe(200);
    const v = (await res.json()) as { progress: { got: number } };
    expect(v.progress.got).toBe(1);
    const d = (await R("GET", `lists/${ids.list}`)).json;
    expect(d.items.find((i: { title: string }) => i.title === "Form 16")).toMatchObject({ status: "received", receivedVia: "upload" });
    expect(d.files).toHaveLength(1);
    // A file the client may not send.
    const bad = new FormData();
    bad.set("file", new File([Buffer.from("MZ")], "run.exe"));
    const no = await collectApi.POST(new Request(`${ORIGIN}/api/v1/collect/${ids.token}/upload`, { method: "POST", body: bad, headers: { origin: ORIGIN } }), { params: Promise.resolve({ token: ids.token!, rest: ["upload"] }) });
    expect(no.status).toBe(422);
  });

  it("takes a note for the team", async () => {
    expect((await pub("POST", ids.token!, ["note"], { text: "Bank statement coming Monday" })).status).toBe(200);
    expect((await R("GET", `lists/${ids.list}`)).json.events[0]).toMatchObject({ kind: "client_note", detail: { text: "Bank statement coming Monday" } });
  });
});

describe("replies", () => {
  it("files the attachments and ticks off what they are (by name, with AI off)", async () => {
    const r = await reply({ text: "Hi, please find attached my PAN.\n\nOn Mon, Meera wrote:\n> We need your bank statements", files: [{ filename: "PAN_Asha.pdf", contentType: "application/pdf", content: Buffer.from("%PDF pan"), contentDisposition: "attachment" }] });
    expect(r).toMatchObject({ marked: 1, review: 0 });
    const d = (await R("GET", `lists/${ids.list}`)).json;
    expect(d.items.find((i: { title: string }) => i.title === "PAN card")).toMatchObject({ status: "received", receivedVia: "email", confidence: 0.85 });
    // Quoted text doesn't count: the bank statements are still owed.
    expect(d.items.find((i: { title: string }) => i.title === "Bank statements").status).toBe("pending");
    expect(d.files.find((f: { filename: string }) => f.filename === "PAN_Asha.pdf")).toMatchObject({ source: "email" });
    expect(d.messages[0]).toMatchObject({ direction: "in", kind: "reply", analysis: { by: "names", marked: ["PAN card"] } });
    // Reminders wait after a reply.
    expect(new Date(d.list.nextReminderAt).getTime()).toBeGreaterThan(Date.now() + 1.5 * 86_400_000);
  });

  it("reads each email once, and ignores mail that isn't about a requisition", async () => {
    const mailId = crypto.randomUUID();
    await reply({ mailId, headerId: "<same@client.example>", text: "Thanks" });
    expect(await reply({ mailId, headerId: "<same@client.example>", text: "Thanks" })).toBeNull();
    expect(await reply({ from: { name: "Spam", address: "someone@else.example" }, subject: "Hello" })).toBeNull();
  });

  it("finds the requisition from the message it answers, even from someone else on the thread", async () => {
    await db.update(schema.rqMessages).set({ headerId: "<request-1@rao.example>" }).where(and(eq(schema.rqMessages.listId, ids.list!), eq(schema.rqMessages.kind, "request")));
    const r = await reply({ inReplyTo: "<request-1@rao.example>", from: { name: "Asha's CA", address: "ca@other.example" }, subject: "Re: your request", text: "Sent." });
    expect(r).toMatchObject({ listId: ids.list });
  });
});

describe("chasing", () => {
  it("asks again for a wrong file, with the team's note, in the next reminder", async () => {
    const d = (await R("GET", `lists/${ids.list}`)).json;
    const pan = d.items.find((i: { title: string }) => i.title === "PAN card");
    expect((await R("PATCH", `lists/${ids.list}/items/${pan.id}`, { status: "rejected" })).status).toBe(422);
    expect((await R("PATCH", `lists/${ids.list}/items/${pan.id}`, { status: "rejected", note: "The photo is blurred" })).status).toBe(200);
    await db.update(schema.rqLists).set({ nextReminderAt: new Date(Date.now() - 60_000) }).where(eq(schema.rqLists.id, ids.list!));
    expect(await requisitionsTick()).toEqual({ sent: 1 });
    const [r1] = await mails("Re: ITR documents");
    expect(r1!.body).toContain("(Please send this again: The photo is blurred)");
    expect(r1!.body).toContain("Already received — thank you: Form 16.");
    // A second tick doesn't send it again.
    expect(await requisitionsTick()).toEqual({ sent: 0 });
  });

  it("stops at the limit and tells the owner", async () => {
    await db.update(schema.rqLists).set({ nextReminderAt: new Date(Date.now() - 60_000) }).where(eq(schema.rqLists.id, ids.list!));
    await requisitionsTick();
    const [last] = await mails("Final reminder: ITR documents");
    expect(last).toBeTruthy();
    const d = (await R("GET", `lists/${ids.list}`)).json;
    expect(d.list).toMatchObject({ remindersSent: 2, nextReminderAt: null });
    expect(d.list.note).toMatch(/Stopped after 2 reminders/);
    const [n] = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.owner!), eq(schema.notifications.kind, "requisitions.stalled")));
    expect(n).toBeTruthy();
  });

  it("finishes when everything required is in, and thanks the client", async () => {
    const d = (await R("GET", `lists/${ids.list}`)).json;
    for (const it of d.items.filter((i: { status: string; required: boolean }) => i.required && i.status !== "received")) await R("PATCH", `lists/${ids.list}/items/${it.id}`, { status: "received" });
    const done = (await R("GET", `lists/${ids.list}`)).json;
    expect(done.list.status).toBe("completed");
    expect(await mails("Received, thank you — ITR documents")).toHaveLength(1);
    expect((await pub("GET", ids.token!)).json.status).toBe("completed");
  });
});

describe("tracking and the rest", () => {
  it("reports how chasing is going", async () => {
    const r = (await R("GET", "reports")).json;
    expect(r).toMatchObject({ done: 1, open: 0, viewedRate: 100, remindersSent: 2 });
    expect(r.receivedBy).toMatchObject({ upload: 1, manual: 2 });
  });

  it("won't email a contact who asked not to be contacted", async () => {
    const [c] = await db.insert(schema.crmContacts).values({ orgId, name: "No Mail", email: "nomail@client.example", doNotContact: true }).returning();
    const r = await R("POST", "lists", { title: "KYC", clientEmail: "nomail@client.example", contactId: c!.id, items: [{ title: "PAN card" }] });
    expect(r.status).toBe(409);
    expect((await R("POST", "lists", { title: "KYC", clientEmail: "nomail@client.example", contactId: c!.id, items: [{ title: "PAN card" }], send: false })).json.list.status).toBe("draft");
  });

  it("imports rows into one requisition per client and title", async () => {
    const r = await R("POST", "lists/import", { mode: "draft", rows: [{ clientEmail: "a@x.example", title: "KYC", item: "PAN card" }, { clientEmail: "a@x.example", title: "KYC", item: "Aadhaar card" }, { clientEmail: "b@x.example", title: "KYC", item: "PAN card" }] });
    expect(r.status).toBe(200);
    expect(r.json.requisitions).toBe(2);
    const drafts = (await R("GET", "lists?view=drafts")).json.lists;
    expect(drafts.find((l: { clientEmail: string }) => l.clientEmail === "a@x.example")).toMatchObject({ of: 2, status: "draft" });
  });
});

describe("from a connected mailbox", () => {
  it("sends in one conversation from the mailbox, and matches the client's reply by the message it answers", async () => {
    const [box] = await db.insert(schema.mailAccounts).values({ orgId, ownerId: U.owner!, name: "Work", address: "meera@rao.example", displayName: "Meera Rao", provider: "custom", imapHost: "imap.rao.example", imapPort: 993, smtpHost: "smtp.rao.example", smtpPort: 465, username: "m", secretEnc: "x", status: "active" } as never).returning();
    const r = await R("POST", "lists", { title: "GST October", clientName: "Lumen Foods", clientEmail: "accounts@lumen.example", mailAccountId: box!.id, items: [{ title: "Sales invoices" }, { title: "Purchase invoices" }] });
    expect(r.status).toBe(200);
    expect(r.json.list.via).toBe("mailbox");
    const [sent] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.threadId, r.json.list.threadId));
    expect(sent).toMatchObject({ direction: "out", subject: "GST October — documents needed [REQ-0005]" });
    expect(sent!.messageId).toMatch(/@rao\.example>$/);
    // The reply answers that message: matched by header, its files read by name.
    const got = await onRequisitionMail({ id: box!.id, orgId, address: "meera@rao.example" }, { threadId: r.json.list.threadId, mailId: crypto.randomUUID(), headerId: "<lumen-1@lumen.example>", inReplyTo: sent!.messageId, refs: [sent!.messageId], from: { name: "Lumen accounts", address: "accounts@lumen.example" }, subject: "Re: GST October — documents needed [REQ-0005]", text: "Attached are this month's sales invoices.", files: [{ filename: "sales-invoices-oct.zip", contentType: "application/zip", content: Buffer.from("PK.."), contentDisposition: "attachment" }] });
    expect(got).toMatchObject({ listId: r.json.list.id, marked: 1 });
    // The next reminder replies in the same conversation.
    await db.update(schema.rqLists).set({ nextReminderAt: new Date(Date.now() - 60_000) }).where(eq(schema.rqLists.id, r.json.list.id));
    await requisitionsTick();
    const out = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.threadId, r.json.list.threadId), eq(schema.mailMessages.direction, "out")));
    expect(out).toHaveLength(2);
    const reminder = out.find((m) => m.id !== sent!.id)!;
    expect(reminder.inReplyTo).toBe(sent!.messageId);
    expect(reminder.text).toContain("• Purchase invoices");
    expect(reminder.text).not.toContain("• Sales invoices");
  });
});

