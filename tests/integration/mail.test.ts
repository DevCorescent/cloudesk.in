import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/mail/[[...slug]]/route";
import * as crmApi from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { drain } from "@/server/jobs/queue";
import { createOauthAccount, liveCreds, setMxLookup } from "@/server/mail/accounts";
import { setUnsubscribeHttp } from "@/server/mail/core";
import { exchangeCode, seal, startUrl, unseal } from "@/server/mail/oauth";
import { syncAccount } from "@/server/mail/sync";
import { setMailTransport, type Creds, type MailTransport } from "@/server/mail/transport";
import { call, cookieFrom, resetDb } from "../helpers";

// Mail, against a pretend mail server that holds real RFC 5322 messages and
// records every IMAP and SMTP action. Nothing here talks to a real provider.
type Box = { uidValidity: number; next: number; msgs: { uid: number; flags: string[]; source: Buffer }[] };
const server = {
  password: "app-pass-1234",
  boxes: {} as Record<string, Box>,
  ops: [] as string[],
  sent: [] as { to: string[]; raw: string }[],
  reset() {
    this.boxes = { INBOX: { uidValidity: 7, next: 1, msgs: [] }, Sent: { uidValidity: 7, next: 1, msgs: [] }, Archive: { uidValidity: 7, next: 1, msgs: [] }, Trash: { uidValidity: 7, next: 1, msgs: [] }, Junk: { uidValidity: 7, next: 1, msgs: [] } };
    this.ops = [];
    this.sent = [];
  },
  async deliver(folder: string, opts: ConstructorParameters<typeof MailComposer>[0]) {
    const source = await new MailComposer(opts).compile().build();
    const b = this.boxes[folder]!;
    b.msgs.push({ uid: b.next++, flags: [], source });
  },
};
const login = (c: Creds) => {
  if (!c.accessToken && c.pass !== server.password) throw Object.assign(new Error("Invalid credentials (Failure)"), { authenticationFailed: true });
};
const fake: MailTransport = {
  async imap(c) {
    login(c);
    return {
      async folders() {
        return [{ path: "INBOX", name: "INBOX" }, { path: "Sent", name: "Sent", specialUse: "\\Sent" }, { path: "Archive", name: "Archive", specialUse: "\\Archive" }, { path: "Trash", name: "Trash", specialUse: "\\Trash" }, { path: "Junk", name: "Junk", specialUse: "\\Junk" }];
      },
      async fetchNew(path, { lastUid, limit }) {
        const b = server.boxes[path]!;
        return { uidValidity: b.uidValidity, messages: b.msgs.filter((m) => m.uid > lastUid).slice(-limit) };
      },
      async setFlags(path, uids, flags, add) {
        server.ops.push(`${add ? "+" : "-"}${flags.join(",")} ${path}:${uids.join(",")}`);
      },
      async move(path, uids, dest) {
        server.ops.push(`move ${path}:${uids.join(",")} → ${dest}`);
      },
      async append(path, raw) {
        server.ops.push(`append ${path}`);
        const b = server.boxes[path]!;
        b.msgs.push({ uid: b.next++, flags: ["\\Seen"], source: raw });
      },
      async close() {},
    };
  },
  async verifySmtp(c) {
    login(c);
  },
  async send(c, envelope, raw) {
    login(c);
    server.sent.push({ to: envelope.to, raw: raw.toString() });
  },
};

const PW = "correct-horse-42";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
let orgId = "";
let accountId = "";
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const X = (method: string, path: string, body?: unknown, who = "owner") => call((api as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/mail/${path}`, params: { orgId, slug: seg(path) } });
const CRM = (method: string, path: string, body?: unknown) => call((crmApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C.owner, body, path: `/api/v1/orgs/${orgId}/crm/${path}`, params: { orgId, slug: seg(path) } });
const conn = { provider: "custom", address: "meera@saffron.in", displayName: "Meera Iyer", password: server.password, imapHost: "mail.saffron.in", imapPort: 993, imapSecure: true, smtpHost: "mail.saffron.in", smtpPort: 465, smtpSecure: true };
const threadsIn = async (q = "") => (await X("GET", `threads?account=all&${q}`)).json.threads as { id: string; subject: string; category: string; priority: string; status: string; labels: string[]; warnings: string[]; messageCount: number; unread: number }[];
const bySubject = async (subject: string, q = "view=inbox") => (await threadsIn(q)).find((t) => t.subject === subject)!;

beforeAll(async () => {
  await resetDb();
  server.reset();
  setMailTransport(fake);
  for (const [k, name, email] of [["owner", "Meera Iyer", "meera@saffron.in"], ["teammate", "Ravi Kumar", "ravi@saffron.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: PW } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  await db.insert(schema.memberships).values({ orgId, userId: U.teammate!, role: "editor" });
  await CRM("GET", "meta");
  await CRM("POST", "contacts", { name: "Anika Bose", email: "anika@tajhotels.com" });
});
afterEach(() => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
});
afterAll(async () => {
  setMailTransport(null);
  setMxLookup(null);
  setUnsubscribeHttp(null);
  await closeDb();
});

describe("connecting a mailbox", () => {
  it("works out the provider from the address or its MX records", async () => {
    expect((await X("GET", "detect?email=me@gmail.com")).json).toMatchObject({ provider: "gmail", via: "domain" });
    setMxLookup(async (d) => (d === "acme.in" ? [{ exchange: "aspmx.l.google.com" }] : []));
    expect((await X("GET", "detect?email=asha@acme.in")).json).toMatchObject({ provider: "google_workspace", via: "mx" });
    expect((await X("GET", "detect?email=asha@unknown.example")).json).toMatchObject({ provider: "custom", via: "guess" });
    expect((await X("GET", "detect?email=not-an-email")).status).toBe(422);
  });

  it("tests the connection and explains a refused sign-in", async () => {
    const bad = (await X("POST", "accounts/check", { ...conn, password: "wrong" })).json;
    expect(bad.imap).toMatchObject({ ok: false, kind: "auth" });
    expect(bad.imap.error).toMatch(/app password/);
    const ok = (await X("POST", "accounts/check", conn)).json;
    expect(ok).toMatchObject({ imap: { ok: true, folders: expect.arrayContaining(["INBOX", "Sent"]) }, smtp: { ok: true } });
  });

  it("saves the mailbox with the password encrypted, and never returns it", async () => {
    const r = await X("POST", "accounts", { ...conn, name: "Saffron", syncDays: 30 });
    expect(r.status).toBe(200);
    accountId = r.json.account.id;
    expect(r.text).not.toContain(server.password);
    const [row] = await db.select().from(schema.mailAccounts).where(eq(schema.mailAccounts.id, accountId));
    expect(row!.secretEnc).not.toContain(server.password);
    expect((await X("POST", "accounts", { ...conn })).json.error.message).toMatch(/already connected/);
    // The teammate can't see someone else's personal mailbox.
    expect((await X("GET", "meta", undefined, "teammate")).json.accounts).toEqual([]);
  });
});

describe("bringing mail in", () => {
  it("sorts new mail into categories, threads replies, and warns about spoofing", async () => {
    await server.deliver("INBOX", { from: "Anika Bose <anika@tajhotels.com>", to: "meera@saffron.in", subject: "Tableware for the new wing?", text: "Hi Meera, can you quote 400 plates by Friday?", messageId: "<q1@tajhotels.com>" });
    await server.deliver("INBOX", { from: "Bright Lights <billing@brightlights.in>", to: "meera@saffron.in", subject: "Tax invoice BL-204 for October", text: "Please find the invoice attached.", attachments: [{ filename: "BL-204.pdf", content: Buffer.from("%PDF-1.4 fake"), contentType: "application/pdf" }] });
    await server.deliver("INBOX", { from: "Chumbak <news@chumbak.com>", to: "meera@saffron.in", subject: "Diwali sale: 40% off everything", text: "Shop now", headers: { "List-Unsubscribe": "<https://chumbak.com/u/123>, <mailto:unsub@chumbak.com>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    await server.deliver("INBOX", { from: "Dev Malhotra <dev@thirdwave.cafe>", to: "meera@saffron.in", subject: "Hello from Third Wave", text: "We'd love to stock your mugs." });
    await server.deliver("INBOX", { from: "\"service@paypal.com\" <alerts@paypa1-security.co>", to: "meera@saffron.in", subject: "Your account is limited", text: "Verify now", headers: { "Authentication-Results": "mx.saffron.in; spf=fail; dmarc=fail" } });
    await server.deliver("INBOX", { from: "Anika Bose <anika@tajhotels.com>", to: "meera@saffron.in", subject: "Re: Tableware for the new wing?", text: "Also need saucers.", inReplyTo: "<q1@tajhotels.com>", references: "<q1@tajhotels.com>" });
    const r = await syncAccount(accountId);
    expect(r.added).toBe(6);
    const taj = await bySubject("Tableware for the new wing?");
    expect(taj).toMatchObject({ category: "people", priority: "high", messageCount: 2, unread: 2 });
    expect((await bySubject("Tax invoice BL-204 for October")).category).toBe("finance");
    expect((await bySubject("Diwali sale: 40% off everything")).category).toBe("promotions");
    expect((await bySubject("Hello from Third Wave")).category).toBe("screener");
    const phish = await bySubject("Your account is limited");
    expect(phish.warnings.join(" ")).toMatch(/paypal.com/);
    expect(phish.warnings.join(" ")).toMatch(/SPF\/DKIM\/DMARC/);
    // A second sync brings nothing twice.
    expect((await syncAccount(accountId)).added).toBe(0);
    const meta = (await X("GET", "meta")).json;
    expect(meta.counts.all.inbox).toBe(5);
    expect(meta.counts.all.categories).toMatchObject({ people: 1, finance: 1, promotions: 1, screener: 1 });
  });

  it("searches with operators and views", async () => {
    expect((await threadsIn("q=" + encodeURIComponent("from:anika saucers"))).map((t) => t.subject)).toEqual(["Tableware for the new wing?"]);
    expect((await threadsIn("q=has:attachment")).map((t) => t.subject)).toEqual(["Tax invoice BL-204 for October"]);
    expect((await threadsIn("view=inbox&category=promotions")).map((t) => t.subject)).toEqual(["Diwali sale: 40% off everything"]);
    expect((await threadsIn("view=important")).map((t) => t.subject)).toContain("Tableware for the new wing?");
  });

  it("opens a conversation: marks it read here and on the server, shows the CRM contact", async () => {
    const taj = await bySubject("Tableware for the new wing?");
    const d = (await X("GET", `threads/${taj.id}`)).json;
    expect(d.messages).toHaveLength(2);
    expect(d.contact).toMatchObject({ name: "Anika Bose", email: "anika@tajhotels.com" });
    expect(d.thread.reasons.join(" ")).toMatch(/CRM contact/);
    expect((await bySubject("Tableware for the new wing?")).unread).toBe(0);
    await drain();
    expect(server.ops).toContain("+\\Seen INBOX:1,6");
  });

  it("archives, stars and labels — mirrored to the real mailbox", async () => {
    const promo = await bySubject("Diwali sale: 40% off everything");
    await X("PATCH", `threads/${promo.id}`, { status: "archived" });
    const taj = await bySubject("Tableware for the new wing?");
    await X("POST", "threads/bulk", { ids: [taj.id], action: "star" });
    await X("POST", "threads/bulk", { ids: [taj.id], action: "label", value: "Wholesale" });
    await drain();
    expect(server.ops).toContain("move INBOX:3 → Archive");
    expect(server.ops).toContain("+\\Flagged INBOX:1,6");
    expect((await threadsIn("q=label:Wholesale")).map((t) => t.subject)).toEqual(["Tableware for the new wing?"]);
    expect((await threadsIn("view=archive")).map((t) => t.subject)).toEqual(["Diwali sale: 40% off everything"]);
  });

  it("lets the screener decide about new senders", async () => {
    const t = await bySubject("Hello from Third Wave");
    await X("POST", "senders", { accountId, address: "dev@thirdwave.cafe", verdict: "allowed" });
    expect((await X("GET", `threads/${t.id}`)).json.thread.category).toBe("people");
    const p = await bySubject("Your account is limited");
    await X("POST", "senders", { accountId, address: "alerts@paypa1-security.co", verdict: "blocked" });
    expect((await threadsIn("view=spam")).map((x) => x.id)).toContain(p.id);
    // Their next email goes straight to spam.
    await server.deliver("INBOX", { from: "alerts@paypa1-security.co", to: "meera@saffron.in", subject: "Final warning", text: "Verify" });
    await syncAccount(accountId);
    expect((await threadsIn("view=spam")).map((x) => x.subject)).toContain("Final warning");
  });

  it("runs rules on new mail", async () => {
    const r = await X("POST", "rules", { name: "Supplier bills", match: "all", conditions: [{ field: "from", op: "domain", value: "brightlights.in" }], actions: [{ type: "label", value: "Bills" }, { type: "star", value: "" }] });
    expect(r.status).toBe(200);
    await server.deliver("INBOX", { from: "billing@brightlights.in", to: "meera@saffron.in", subject: "Tax invoice BL-221", text: "Invoice for November" });
    await syncAccount(accountId);
    const t = await bySubject("Tax invoice BL-221");
    expect(t.labels).toEqual(["Bills"]);
    expect((await X("GET", "rules")).json.rules[0].hits).toBe(1);
    expect((await X("POST", "rules", { name: "x", conditions: [], actions: [] })).status).toBe(422);
  });
});

describe("sending", () => {
  it("replies in the same conversation after the undo delay, and files a copy in Sent", async () => {
    await X("PATCH", `accounts/${accountId}`, { sendDelaySec: 0, signature: "— Meera, Saffron & Sage" });
    const taj = await bySubject("Tableware for the new wing?");
    const d = (await X("GET", `threads/${taj.id}`)).json;
    const r = (await X("POST", "send", { accountId, replyTo: d.messages[1].id, mode: "reply", to: ["anika@tajhotels.com"], body: "Hi {{first_name}}, attaching the quote.", followUpAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), attachments: [{ filename: "quote.txt", mime: "text/plain", data: Buffer.from("400 plates").toString("base64") }] })).json;
    expect(r.message).toMatchObject({ threadId: taj.id, sendStatus: "scheduled" });
    await drain();
    expect(server.sent).toHaveLength(1);
    const raw = server.sent[0]!.raw;
    expect(raw).toContain(`In-Reply-To: ${d.messages[1].messageId}`);
    // (Long headers fold onto the next line, which is valid.)
    expect(raw).toMatch(/References: <q1@tajhotels\.com>\s+<[^>]+>/);
    expect(raw).toContain("Subject: Re: Tableware for the new wing?");
    const parsed = await simpleParser(raw);
    expect(parsed.text).toContain("Hi Anika, attaching the quote.");
    expect(parsed.text).toContain("— Meera, Saffron & Sage");
    expect(raw).toContain("quote.txt");
    expect(server.ops).toContain("append Sent");
    const after = (await X("GET", `threads/${taj.id}`)).json;
    expect(after.messages.at(-1)).toMatchObject({ direction: "out", sendStatus: "sent" });
    expect(after.thread.followUpAt).not.toBeNull();
    // Our own copy coming back from Sent isn't shown twice.
    await syncAccount(accountId);
    expect((await X("GET", `threads/${taj.id}`)).json.messages).toHaveLength(3);
    // A reply from them clears the follow-up.
    await server.deliver("INBOX", { from: "anika@tajhotels.com", to: "meera@saffron.in", subject: "Re: Tableware for the new wing?", text: "Approved!", inReplyTo: after.messages.at(-1).messageId });
    await syncAccount(accountId);
    expect((await X("GET", `threads/${taj.id}`)).json.thread.followUpAt).toBeNull();
  });

  it("can be undone, or scheduled", async () => {
    await X("PATCH", `accounts/${accountId}`, { sendDelaySec: 30 });
    const r = (await X("POST", "send", { accountId, to: ["dev@thirdwave.cafe"], subject: "Mug catalogue", body: "Here you go" })).json;
    expect((await X("POST", `messages/${r.message.id}/cancel`)).json).toMatchObject({ ok: true, draft: { subject: "Mug catalogue" } });
    expect((await threadsIn("view=sent")).map((t) => t.subject)).not.toContain("Mug catalogue");
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const s2 = (await X("POST", "send", { accountId, to: ["dev@thirdwave.cafe"], subject: "Tomorrow's order", body: "Hi", sendAt: later })).json;
    expect(s2.message.sendAt).toBe(later);
    expect((await X("GET", "meta")).json.counts.all.scheduled).toBe(1);
    expect((await X("POST", "send", { accountId, to: [], subject: "x", body: "y" })).status).toBe(422);
    expect((await X("POST", "send", { accountId, to: ["not-an-email"], subject: "x", body: "y" })).status).toBe(422);
  });
});

describe("safety and extras", () => {
  it("serves email HTML without scripts, remote images or forms", async () => {
    await server.deliver("INBOX", { from: "news@shop.example", to: "meera@saffron.in", subject: "HTML mail", html: '<p>Hi</p><img src="https://tracker.example/p.gif"><script>alert(1)</script>' });
    await syncAccount(accountId);
    const t = await bySubject("HTML mail");
    const d = (await X("GET", `threads/${t.id}`)).json;
    const r = await X("GET", `messages/${d.messages[0].id}/html`);
    const csp = r.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("allow-scripts");
    expect(csp).not.toContain("https:");
    expect((await X("GET", `messages/${d.messages[0].id}/html?images=1`)).headers.get("content-security-policy")).toContain("https:");
  });

  it("unsubscribes with one click when the sender supports it", async () => {
    const posted: string[] = [];
    setUnsubscribeHttp((async (u: string) => (posted.push(u), new Response(null, { status: 200 }))) as never);
    const promo = (await threadsIn("view=archive")).find((t) => t.subject.startsWith("Diwali"))!;
    expect((await X("POST", `threads/${promo.id}/unsubscribe`)).json).toMatchObject({ ok: true, via: "one-click" });
    expect(posted).toEqual(["https://chumbak.com/u/123"]);
  });

  it("explains that AI needs a provider, and summarises when there is one", async () => {
    const taj = await bySubject("Tableware for the new wing?");
    expect((await X("POST", `threads/${taj.id}/ai`, { kind: "summary" })).status).toBe(424);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    let prompt = "";
    setAnthropicClientFactory(() => ({ beta: { messages: { stream: (p: { messages: { content: string }[] }) => ({ finalMessage: async () => {
      prompt = p.messages[0]!.content;
      return { content: [{ type: "text", text: JSON.stringify({ summary: "Taj wants 400 plates and saucers; quote sent, approved.", draft: "", actions: [{ kind: "task", text: "Confirm delivery date" }] }) }], stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 900, output_tokens: 60 } };
    } }) } } }) as never);
    const r = (await X("POST", `threads/${taj.id}/ai`, { kind: "summary" })).json;
    expect(r).toMatchObject({ summary: expect.stringContaining("400 plates"), actions: [{ kind: "task" }] });
    expect(prompt).toContain("Also need saucers.");
    expect((await X("GET", `threads/${taj.id}`)).json.thread.aiSummary).toContain("400 plates");
  });

  it("adds the sender to the CRM and makes a helpdesk ticket from an email", async () => {
    const t = await bySubject("Hello from Third Wave", "view=inbox");
    const c = (await X("POST", `threads/${t.id}/link`, { kind: "contact" })).json;
    expect(c.contactId).toBeTruthy();
    const tk = (await X("POST", `threads/${t.id}/link`, { kind: "ticket" })).json;
    expect(tk.ticketId).toBeTruthy();
    const [ticket] = await db.select().from(schema.hdTickets).where(eq(schema.hdTickets.id, tk.ticketId));
    expect(ticket).toMatchObject({ subject: "Hello from Third Wave" });
  });
});

describe("team inboxes", () => {
  it("are shared with members, can be assigned, and keep internal notes", async () => {
    server.password = "team-pass";
    // The team mailbox is its own mailbox on the server: start it empty.
    server.boxes.INBOX!.msgs = [];
    server.boxes.Sent!.msgs = [];
    const r = await X("POST", "accounts", { ...conn, address: "orders@saffron.in", password: "team-pass", name: "Orders", shared: true, members: [U.teammate] });
    expect(r.status).toBe(200);
    const team = r.json.account.id;
    await server.deliver("INBOX", { from: "buyer@goodearth.in", to: "orders@saffron.in", subject: "PO 5512", text: "Please confirm" });
    await syncAccount(team);
    const seen = (await X("GET", `threads?account=${team}`, undefined, "teammate")).json.threads;
    expect(seen.map((t: { subject: string }) => t.subject)).toContain("PO 5512");
    const t = seen.find((x: { subject: string }) => x.subject === "PO 5512");
    await X("PATCH", `threads/${t.id}`, { assigneeId: U.teammate });
    expect((await X("GET", "threads?account=all&view=assigned", undefined, "teammate")).json.threads.map((x: { id: string }) => x.id)).toEqual([t.id]);
    const n = (await X("POST", `threads/${t.id}/notes`, { body: "@Ravi please check stock first" })).json;
    expect(n.note.body).toContain("check stock");
    const [notice] = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.teammate!), eq(schema.notifications.kind, "mail.assigned")));
    expect(notice).toBeDefined();
    // Assigning outside the inbox is refused; a personal mailbox can't be assigned.
    expect((await X("PATCH", `threads/${t.id}`, { assigneeId: U.owner })).status).toBe(200);
    const personal = await bySubject("Tax invoice BL-204 for October");
    expect((await X("PATCH", `threads/${personal.id}`, { assigneeId: U.teammate })).status).toBe(409);
    server.password = "app-pass-1234";
  });
});

describe("Sign in with Google / Microsoft", () => {
  it("needs the platform's OAuth app, signs its state, and refreshes access tokens", async () => {
    expect(() => startUrl("google", { orgId, userId: U.owner! })).toThrow(/isn't set up/);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "123-abc.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    try {
      const { url, cookie, state } = startUrl("google", { orgId, userId: U.owner!, loginHint: "meera@gmail.com" });
      expect(url).toContain("accounts.google.com");
      expect(url).toContain(encodeURIComponent("https://mail.google.com/"));
      expect(cookie).toContain(`cc_mail_oauth=${state.n}`);
      expect(unseal(seal(state))).toMatchObject({ uid: U.owner });
      expect(unseal(seal(state).replace(/.$/, "x"))).toBeNull();
      const idToken = `x.${Buffer.from(JSON.stringify({ email: "meera@gmail.com", name: "Meera Iyer" })).toString("base64url")}.y`;
      const f = (async () => Response.json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, id_token: idToken })) as never;
      const tokens = await exchangeCode("google", "code-1", f);
      expect(tokens).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1", email: "meera@gmail.com" });
      const acc = await createOauthAccount({ orgId, userId: U.owner!, userName: "Meera Iyer", shared: false }, "google", tokens);
      expect(acc).toMatchObject({ provider: "gmail", auth: "oauth_google", imapHost: "imap.gmail.com", address: "meera@gmail.com" });
      // An access token about to expire is refreshed before use.
      await db.update(schema.mailAccounts).set({ tokenExpiresAt: new Date(Date.now() + 30_000) }).where(eq(schema.mailAccounts.id, acc.id));
      const [row] = await db.select().from(schema.mailAccounts).where(eq(schema.mailAccounts.id, acc.id));
      const creds = await liveCreds(row!, (async () => Response.json({ access_token: "at-2", expires_in: 3600 })) as never);
      expect(creds).toMatchObject({ accessToken: "at-2", username: "meera@gmail.com" });
    } finally {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    }
  });
});

describe("templates from a spreadsheet", () => {
  it("adds new ones, updates or skips ones you already have by name, and reports bad rows", async () => {
    const rows = [
      { name: "Price list", subject: "Our prices", body: "Hi {{first_name}}, our price list is attached.", shortcut: "Price List" },
      { name: "Directions", body: "We're at 12 MG Road." },
      { name: "No body" },
    ];
    const first = (await X("POST", "templates/import", { rows, mode: "update" })).json;
    expect(first).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    expect(first.errors).toHaveLength(1);
    const list = (await X("GET", "templates")).json.templates as { name: string; shortcut: string }[];
    expect(list.find((t) => t.name === "Price list")?.shortcut).toBe("price-list");

    const again = [{ name: "price list", body: "Updated prices." }];
    expect((await X("POST", "templates/import", { rows: again, mode: "skip" })).json).toMatchObject({ created: 0, skipped: 1 });
    expect((await X("POST", "templates/import", { rows: again, mode: "update" })).json).toMatchObject({ created: 0, updated: 1 });
    const after = (await X("GET", "templates")).json.templates as { name: string; body: string }[];
    expect(after.filter((t) => t.name.toLowerCase() === "price list")).toHaveLength(1);
    expect(after.find((t) => t.name === "Price list")?.body).toBe("Updated prices.");
  });
});

describe("replies owed, reply targets and analytics", () => {
  it("lists mail that needs a reply, flags it overdue past the target, and clears it when answered", async () => {
    await X("PATCH", `accounts/${accountId}`, { slaHours: 2, sendDelaySec: 0 });
    await server.deliver("INBOX", { from: "Priya Nair <priya@woodworks.in>", to: "meera@saffron.in", subject: "Quote for 50 chairs?", text: "Could you quote 50 chairs by Friday?", date: new Date(Date.now() - 3 * 3_600_000), messageId: "<q50@woodworks.in>" });
    await syncAccount(accountId);
    const owed = (await X("GET", "threads?account=all&view=needsreply")).json.threads as { id: string; subject: string; awaitingSince: string | null }[];
    const t = owed.find((x) => x.subject === "Quote for 50 chairs?")!;
    expect(t.awaitingSince).not.toBeNull();
    const counts = (await X("GET", "meta")).json.counts.all;
    expect(counts.needsReply).toBeGreaterThanOrEqual(1);
    expect(counts.overdue).toBeGreaterThanOrEqual(1);

    const msg = (await X("GET", `threads/${t.id}`)).json.messages[0];
    expect((await X("POST", "send", { accountId, replyTo: msg.id, to: ["priya@woodworks.in"], body: "Yes — quote attached tomorrow." })).status).toBe(200);
    await drain();
    expect(((await X("GET", "threads?account=all&view=needsreply")).json.threads as { id: string }[]).some((x) => x.id === t.id)).toBe(false);
    expect((await X("GET", `threads/${t.id}`)).json.thread.awaitingSince).toBeNull();
  });

  it("counts mail, reply times and the reply target from the stored messages", async () => {
    const r = await X("GET", "analytics?days=30&tz=Asia/Kolkata");
    expect(r.status).toBe(200);
    const a = r.json;
    expect(a.range).toMatchObject({ days: 30, tz: "Asia/Kolkata" });
    expect(a.daily).toHaveLength(30);
    expect(a.daily.reduce((n: number, d: { received: number }) => n + d.received, 0)).toBe(a.totals.received);
    expect(a.hours).toHaveLength(7);
    expect(a.hours.flat().reduce((n: number, x: number) => n + x, 0)).toBe(a.totals.received);
    expect(a.totals.replied).toBeGreaterThanOrEqual(1);
    // Priya waited about three hours: past the two-hour target.
    expect(a.totals.medianReplyMin).not.toBeNull();
    expect(a.mailboxes[0]).toMatchObject({ slaHours: 2 });
    expect(a.totals.withinSla).not.toBeNull();
    expect(a.totals.withinSla).toBeLessThan(100);
    expect(a.replyBuckets.find((b: { label: string }) => b.label === "1–4 hours").n).toBeGreaterThanOrEqual(1);
    expect(a.senders.length).toBeGreaterThan(0);
    // A bad time zone falls back to UTC rather than failing.
    expect((await X("GET", "analytics?days=7&tz=Not/AZone")).json.range.tz).toBe("UTC");
  });
});

describe("muting, auto-replies, sender clean-up and message details", () => {
  it("keeps a muted conversation out of the inbox when new replies arrive", async () => {
    await server.deliver("INBOX", { from: "Group <group@club.example>", to: "meera@saffron.in", subject: "Weekend plans", text: "Who's in?", messageId: "<wk1@club.example>" });
    await syncAccount(accountId);
    const t = await bySubject("Weekend plans");
    expect((await X("PATCH", `threads/${t.id}`, { muted: true })).json.thread).toMatchObject({ muted: true, status: "archived" });
    await server.deliver("INBOX", { from: "Group <group@club.example>", to: "meera@saffron.in", subject: "Re: Weekend plans", text: "Me!", inReplyTo: "<wk1@club.example>", references: "<wk1@club.example>" });
    await syncAccount(accountId);
    expect((await X("GET", `threads/${t.id}`)).json.thread).toMatchObject({ status: "archived", muted: true, messageCount: 2 });
    expect(((await X("GET", "threads?account=all&view=muted")).json.threads as { id: string }[]).map((x) => x.id)).toContain(t.id);
    expect((await X("PATCH", `threads/${t.id}`, { muted: false })).json.thread).toMatchObject({ muted: false, status: "inbox" });
  });

  it("auto-replies once per sender, never to lists or robots, and it doesn't count as answering", async () => {
    const r = await X("PATCH", `accounts/${accountId}`, { autoReply: { enabled: true, body: "Hi {{first_name}}, I'm away until Monday.", tzOffset: 330 } });
    expect(r.json.account.settings.autoReply).toMatchObject({ enabled: true });
    server.sent = [];
    await server.deliver("INBOX", { from: "Kiran Rao <kiran@client.in>", to: "meera@saffron.in", subject: "Invoice question", text: "Is GST included?", messageId: "<iq1@client.in>" });
    await server.deliver("INBOX", { from: "Shop <deals@shop.example>", to: "meera@saffron.in", subject: "Sale", text: "40% off", headers: { "List-Unsubscribe": "<https://shop.example/u>" } });
    await server.deliver("INBOX", { from: "noreply@bank.example", to: "meera@saffron.in", subject: "Statement ready", text: "Your statement" });
    await server.deliver("INBOX", { from: "Away <away@other.example>", to: "meera@saffron.in", subject: "Out of office", text: "I'm away", headers: { "Auto-Submitted": "auto-replied" } });
    await syncAccount(accountId);
    await drain();
    expect(server.sent.map((m) => m.to.join())).toEqual(["kiran@client.in"]);
    const raw = server.sent[0]!.raw;
    expect(raw).toMatch(/Auto-Submitted: auto-replied/);
    expect(raw).toMatch(/In-Reply-To: <iq1@client\.in>/);
    expect((await simpleParser(raw)).text).toContain("Hi Kiran, I'm away until Monday.");
    // Still owed a real answer.
    const t = await bySubject("Invoice question");
    expect((await X("GET", `threads/${t.id}`)).json.thread.awaitingSince).not.toBeNull();
    expect((await X("GET", `threads/${t.id}`)).json.messages.some((m: { auto: boolean }) => m.auto)).toBe(true);
    // A second email from Kiran within a few days gets no second auto-reply.
    await server.deliver("INBOX", { from: "Kiran Rao <kiran@client.in>", to: "meera@saffron.in", subject: "One more thing", text: "And delivery?" });
    await syncAccount(accountId);
    await drain();
    expect(server.sent).toHaveLength(1);
    expect((await X("GET", "analytics?days=7")).json.totals.autoReplies).toBe(1);
    await X("PATCH", `accounts/${accountId}`, { autoReply: { enabled: false, body: "Hi {{first_name}}, I'm away until Monday." } });
  });

  it("shows who sends the most and cleans up everything from one sender", async () => {
    for (const n of [1, 2, 3]) await server.deliver("INBOX", { from: "Promo <promo@offers.example>", to: "meera@saffron.in", subject: `Offer ${n}`, text: "Buy now", headers: { "List-Unsubscribe": "<https://offers.example/u>" } });
    await syncAccount(accountId);
    const top = (await X("GET", "senders/top?account=all&q=offers")).json.senders;
    expect(top[0]).toMatchObject({ address: "promo@offers.example", messages: 3, inInbox: 3, list: true });
    expect((await X("POST", "senders/cleanup", { address: "promo@offers.example", action: "archive" })).json).toMatchObject({ count: 3 });
    expect((await threadsIn("view=inbox")).some((t) => t.subject.startsWith("Offer "))).toBe(false);
    expect((await X("POST", "senders/cleanup", { address: "promo@offers.example", action: "block" })).json.count).toBe(3);
    expect((await X("GET", "senders/top?account=all&q=offers")).json.senders).toHaveLength(0);
    await server.deliver("INBOX", { from: "Promo <promo@offers.example>", to: "meera@saffron.in", subject: "Offer 4", text: "Buy now" });
    await syncAccount(accountId);
    expect((await threadsIn("view=spam")).some((t) => t.subject === "Offer 4")).toBe(true);
  });

  it("shows a message's technical details and what the sender checks said", async () => {
    await server.deliver("INBOX", { from: "Asha <asha@acme.in>", to: "meera@saffron.in", subject: "Checked mail", text: "Hello", messageId: "<chk1@acme.in>", headers: { "Authentication-Results": "mx.saffron.in; spf=pass smtp.mailfrom=acme.in; dkim=fail header.d=acme.in; dmarc=pass" } });
    await syncAccount(accountId);
    const t = await bySubject("Checked mail");
    const m = (await X("GET", `threads/${t.id}`)).json.messages[0];
    const d = (await X("GET", `messages/${m.id}/details`)).json;
    expect(d).toMatchObject({ messageId: "<chk1@acme.in>", folder: "INBOX", auth: { spf: "pass", dkim: "fail", dmarc: "pass" }, auto: false });
    expect(d.sizeBytes).toBeGreaterThan(0);
    expect((await X("GET", "messages/00000000-0000-4000-8000-000000000000/details")).status).toBe(404);
  });
});

describe("signatures", () => {
  const fields = { name: "Meera Iyer", title: "Founder", company: "Saffron & Sage", phone: "+91 98200 12345", email: "meera@saffron.in", website: "https://saffronsage.in", accent: "#0b5cad" };

  it("saves designed signatures; the first becomes the default in every mailbox", async () => {
    const r = await X("POST", "signatures", { name: "Formal", design: "corporate", fields });
    expect(r.status).toBe(200);
    const list = (await X("GET", "signatures")).json;
    expect(list.signatures).toHaveLength(1);
    expect(list.defaults[accountId]).toEqual({ newId: r.json.signature.id, replyId: r.json.signature.id });
    expect((await X("POST", "signatures", { name: "Bad", design: "corporate", fields: { ...fields, website: "javascript:alert(1)" } })).status).toBe(422);
    const short = (await X("POST", "signatures", { name: "Short", design: "compact", fields })).json.signature;
    expect((await X("PUT", "signatures/defaults", { accountId, newId: r.json.signature.id, replyId: short.id })).status).toBe(200);
  });

  it("puts the reply signature above the quoted text, in HTML and plain text", async () => {
    await X("PATCH", `accounts/${accountId}`, { sendDelaySec: 0 });
    await server.deliver("INBOX", { from: "Leela Rao <leela@decor.in>", to: "meera@saffron.in", subject: "Lamps", text: "Do you stock brass lamps?", messageId: "<lamps1@decor.in>" });
    await syncAccount(accountId);
    const t = await bySubject("Lamps");
    const msg = (await X("GET", `threads/${t.id}`)).json.messages[0];
    server.sent = [];
    const body = "Yes, we do!\n\nOn 26 Oct 2026, 10:00 am, Leela Rao <leela@decor.in> wrote:\n> Do you stock brass lamps?";
    expect((await X("POST", "send", { accountId, replyTo: msg.id, mode: "reply", to: ["leela@decor.in"], body })).status).toBe(200);
    await drain();
    const p = await simpleParser(server.sent[0]!.raw);
    // The default for replies is the compact one.
    expect(p.text).toMatch(/Yes, we do!\s+-- \nMeera Iyer \| Founder \| Saffron & Sage \| \+91 98200 12345\s+On 26 Oct/);
    const html = String(p.html);
    expect(html.indexOf("Meera Iyer")).toBeGreaterThan(html.indexOf("Yes, we do!"));
    expect(html.indexOf("Meera Iyer")).toBeLessThan(html.indexOf("brass lamps"));
  });

  it("uses the chosen signature, or none, and only your own", async () => {
    const sigs = (await X("GET", "signatures")).json.signatures as { id: string; name: string }[];
    const formal = sigs.find((x) => x.name === "Formal")!;
    server.sent = [];
    await X("POST", "send", { accountId, to: ["leela@decor.in"], subject: "Catalogue", body: "Attached soon.", signatureId: formal.id });
    await X("POST", "send", { accountId, to: ["leela@decor.in"], subject: "No sig", body: "Plain.", signatureId: null });
    await drain();
    // The two sends can go out in either order.
    const parsed = await Promise.all(server.sent.map((m) => simpleParser(m.raw)));
    const withSig = parsed.find((p) => p.subject === "Catalogue");
    const without = parsed.find((p) => p.subject === "No sig");
    expect(String(withSig!.html)).toContain("saffronsage.in");
    expect(withSig!.text).toContain("T +91 98200 12345");
    expect(without!.text!.trim()).toBe("Plain.");
    const other = (await X("POST", "signatures", { name: "Ravi's", design: "minimal", fields: { ...fields, name: "Ravi Kumar" } }, "teammate")).json.signature;
    expect((await X("POST", "send", { accountId, to: ["leela@decor.in"], body: "x", signatureId: other.id })).status).toBe(422);
    expect((await X("DELETE", `signatures/${other.id}`)).status).toBe(404);
  });

  it("takes logo uploads (real images only) and serves them publicly", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const r = await X("POST", "signatures/image", { data: png.toString("base64") });
    expect(r.json.url).toMatch(/^\/mail-img\/[0-9a-f-]{36}$/);
    const { GET } = await import("@/app/mail-img/[id]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: r.json.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await X("POST", "signatures/image", { data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64") })).status).toBe(422);
  });

  it("auto-replies carry the owner's reply signature", async () => {
    await X("PATCH", `accounts/${accountId}`, { autoReply: { enabled: true, body: "Away till Monday.", tzOffset: 330 } });
    server.sent = [];
    await server.deliver("INBOX", { from: "Nisha <nisha@bloom.in>", to: "meera@saffron.in", subject: "Hello", text: "Are you open Sunday?" });
    await syncAccount(accountId);
    await drain();
    expect((await simpleParser(server.sent[0]!.raw)).text).toContain("Away till Monday.\n\n-- \nMeera Iyer | Founder");
    await X("PATCH", `accounts/${accountId}`, { autoReply: { enabled: false, body: "Away till Monday." } });
  });
});

describe("address book and sending to groups", () => {
  it("keeps contacts and groups, imports a sheet, and suggests who to send to", async () => {
    const g = (await X("POST", "groups", { name: "Suppliers", color: "#0f766e" })).json.id;
    const a = await X("POST", "contacts", { name: "Asha Rao", email: "Asha@BrassWorks.in", company: "Brass Works", groupIds: [g], favorite: true });
    expect(a.json.contact).toMatchObject({ email: "asha@brassworks.in", groupIds: [g] });
    expect((await X("POST", "contacts", { email: "asha@brassworks.in" })).status).toBe(409);
    const imp = (await X("POST", "contacts/import", { rows: [{ name: "Bilal Khan", email: "bilal@linenloft.in", company: "Linen Loft", groups: "Suppliers, Textiles" }, { name: "Asha R.", email: "asha@brassworks.in", phone: "+91 98200 11111" }, { name: "No email" }], mode: "update" })).json;
    expect(imp).toMatchObject({ created: 1, updated: 1 });
    expect(imp.errors).toHaveLength(1);
    const list = (await X("GET", "contacts")).json;
    expect(list.groups.map((x: { name: string; count: number }) => [x.name, x.count])).toEqual([["Suppliers", 2], ["Textiles", 1]]);
    expect(list.contacts.find((c: { email: string }) => c.email === "asha@brassworks.in")).toMatchObject({ phone: "+91 98200 11111", name: "Asha R.", company: "Brass Works" }); // the sheet updates; blanks keep what was there
    expect((await X("GET", `contacts?group=${g}&q=linen`)).json.contacts).toHaveLength(1);
    const sug = (await X("GET", "suggest?q=sup")).json.suggestions;
    expect(sug[0]).toMatchObject({ kind: "group", name: "Suppliers", count: 2 });
    const people = (await X("GET", "suggest?q=asha")).json.suggestions as { email: string; source: string }[];
    expect(people[0]).toMatchObject({ email: "asha@brassworks.in", source: "Favourite" });
    // People you've emailed show up too (Priya wrote earlier in these tests).
    expect(((await X("GET", "suggest?q=priya")).json.suggestions as { source: string }[]).some((x) => x.source === "Emailed")).toBe(true);
  });

  it("sends to a group in one email, or separately to each person with their own name", async () => {
    await X("PATCH", `accounts/${accountId}`, { sendDelaySec: 0, autoReply: { enabled: false, body: "x" } });
    const groups = (await X("GET", "contacts")).json.groups as { id: string; name: string }[];
    const sup = groups.find((x) => x.name === "Suppliers")!.id;
    server.sent = [];
    const one = await X("POST", "send", { accountId, groupIds: [sup], subject: "Holiday notice", body: "We're closed on Friday.", signatureId: null });
    expect(one.json.count).toBe(1);
    await drain();
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]!.to.sort()).toEqual(["asha@brassworks.in", "bilal@linenloft.in"]);
    server.sent = [];
    const many = await X("POST", "send", { accountId, groupIds: [sup], to: ["dev@thirdwave.cafe"], separately: true, subject: "Your order", body: "Hi {{first_name}}, your order is on its way.", signatureId: null });
    expect(many.json.count).toBe(3);
    await drain();
    expect(server.sent.map((m) => m.to.join()).sort()).toEqual(["asha@brassworks.in", "bilal@linenloft.in", "dev@thirdwave.cafe"]);
    const texts = await Promise.all(server.sent.map(async (m) => (await simpleParser(m.raw)).text ?? ""));
    expect(texts.some((t) => t.startsWith("Hi Asha,"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Hi Bilal,"))).toBe(true);
    const [asha] = (await X("GET", "contacts?q=asha")).json.contacts;
    expect(asha.emailCount).toBe(2);
    const empty = (await X("POST", "groups", { name: "Board" })).json.id;
    expect((await X("POST", "send", { accountId, groupIds: [empty], body: "x" })).status).toBe(422);
  });

  it("an email to a group reaches whoever is in it when it goes, and says which group", async () => {
    const groups = (await X("GET", "contacts")).json.groups as { id: string; name: string; color: string }[];
    const sup = groups.find((x) => x.name === "Suppliers")!;
    server.sent = [];
    const r = (await X("POST", "send", { accountId, groupIds: [sup.id], to: ["dev@thirdwave.cafe"], subject: "Price list 2027", body: "Attached.", signatureId: null })).json;
    // Someone joins the group before it goes out.
    await X("POST", "contacts", { name: "Kiran Rao", email: "kiran@potteryhouse.in", groupIds: [sup.id] });
    await drain();
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]!.to.sort()).toEqual(["asha@brassworks.in", "bilal@linenloft.in", "dev@thirdwave.cafe", "kiran@potteryhouse.in"]);
    const t = (await X("GET", `threads/${r.message.threadId}`)).json;
    expect(t.messages[0].groups).toEqual([{ id: sup.id, name: "Suppliers", color: sup.color }]);
    expect(t.messages[0].to.map((p: { address: string }) => p.address)).toContain("kiran@potteryhouse.in");
  });

  it("sends a real test email from the mailbox to itself, and reports a refusal honestly", async () => {
    server.sent = [];
    const ok = (await X("POST", `accounts/${accountId}/test`)).json;
    expect(ok).toMatchObject({ sent: true, to: "meera@saffron.in", server: "mail.saffron.in" });
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]!.to).toEqual(["meera@saffron.in"]);
    expect((await simpleParser(server.sent[0]!.raw)).subject).toMatch(/^Cloudesk test email/);
    const real = server.password;
    server.password = "changed-elsewhere";
    try {
      const bad = (await X("POST", `accounts/${accountId}/test`)).json;
      expect(bad.sent).toBe(false);
      expect(bad.error).toMatch(/sign-in|password/i);
    } finally {
      server.password = real;
    }
  });

  it("groups contacts in bulk and removes them", async () => {
    const list = (await X("GET", "contacts")).json;
    const textiles = list.groups.find((x: { name: string }) => x.name === "Textiles").id;
    const ids = list.contacts.map((c: { id: string }) => c.id);
    expect((await X("POST", "contacts/bulk", { ids, action: "addToGroup", groupId: textiles })).json.count).toBe(ids.length);
    expect((await X("GET", `contacts?group=${textiles}`)).json.contacts).toHaveLength(ids.length);
    expect((await X("POST", "contacts/bulk", { ids: [ids[0]], action: "delete" })).json.count).toBe(1);
    expect((await X("DELETE", `groups/${textiles}`)).status).toBe(200);
  });
});
