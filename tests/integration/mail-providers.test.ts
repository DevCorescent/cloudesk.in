import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { drain } from "@/server/jobs/queue";
import { mailProvider, sendMail, setMailHttp } from "@/server/services/mail";
import { resetDb } from "../helpers";

const KEYS = ["MAIL_FROM", "MAIL_PROVIDER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SENDGRID_API_KEY", "SMTP_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_REQUIRE_TLS"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const env = (vars: Record<string, string>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
};
const email = async (subject: string) => (await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, subject)))[0];

type Req = { url: string; headers: Record<string, string>; body: unknown };
let reqs: Req[] = [];
const mockHttp = (respond: (r: Req) => Response) =>
  setMailHttp(async (input, init) => {
    const r = { url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) };
    reqs.push(r);
    return respond(r);
  });

beforeAll(async () => {
  await resetDb();
});
afterEach(() => {
  reqs = [];
});
afterAll(async () => {
  env(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)) as Record<string, string>);
  await closeDb();
});

describe("choosing a provider", () => {
  it("uses MAIL_PROVIDER when it is configured, otherwise the first configured", () => {
    env({});
    expect(mailProvider()).toBe("outbox");
    env({ MAIL_FROM: "shop@example.com", SENDGRID_API_KEY: "SG.x" });
    expect(mailProvider()).toBe("sendgrid");
    env({ MAIL_FROM: "shop@example.com", SENDGRID_API_KEY: "SG.x", POSTMARK_SERVER_TOKEN: "pm", MAIL_PROVIDER: "postmark" });
    expect(mailProvider()).toBe("postmark");
    env({ MAIL_FROM: "shop@example.com", MAIL_PROVIDER: "smtp" }); // asked for, not configured
    expect(mailProvider()).toBe("outbox");
    env({ POSTMARK_SERVER_TOKEN: "pm" }); // no sender address
    expect(mailProvider()).toBe("outbox");
  });
});

describe("Postmark and SendGrid", () => {
  it("send in each provider's format", async () => {
    env({ MAIL_FROM: "shop@example.com", POSTMARK_SERVER_TOKEN: "pm-token" });
    mockHttp(() => Response.json({ MessageID: "pm-1", ErrorCode: 0 }));
    await sendMail({ to: "a@example.com", subject: "PM hello", body: "Hi", fromName: 'Ember "&" Oat', replyTo: "owner@example.com" });
    expect(reqs[0]).toMatchObject({ url: "https://api.postmarkapp.com/email", headers: { "x-postmark-server-token": "pm-token" }, body: { From: '"Ember & Oat" <shop@example.com>', To: "a@example.com", TextBody: "Hi", ReplyTo: "owner@example.com", MessageStream: "outbound" } });
    expect(await email("PM hello")).toMatchObject({ status: "sent", providerId: "pm-1", transport: "postmark" });

    env({ MAIL_FROM: "shop@example.com", SENDGRID_API_KEY: "SG.key" });
    mockHttp(() => new Response(null, { status: 202, headers: { "x-message-id": "sg-1" } }));
    await sendMail({ to: "b@example.com", subject: "SG hello", body: "Hi", fromName: "Ember" });
    expect(reqs.at(-1)).toMatchObject({ url: "https://api.sendgrid.com/v3/mail/send", headers: { authorization: "Bearer SG.key" }, body: { personalizations: [{ to: [{ email: "b@example.com" }] }], from: { email: "shop@example.com", name: "Ember" }, content: [{ type: "text/plain", value: "Hi" }] } });
    expect(await email("SG hello")).toMatchObject({ status: "sent", providerId: "sg-1" });
  });

  it("carry attachments (an invoice PDF) in each provider's format", async () => {
    const pdf = { filename: "Invoice 7.pdf", contentType: "application/pdf", base64: Buffer.from("%PDF-1.7 test").toString("base64") };
    env({ MAIL_FROM: "shop@example.com", POSTMARK_SERVER_TOKEN: "pm-token" });
    mockHttp(() => Response.json({ MessageID: "pm-2", ErrorCode: 0 }));
    await sendMail({ to: "a@example.com", subject: "PM file", body: "Hi", attachments: [pdf] });
    expect(reqs.at(-1)!.body).toMatchObject({ Attachments: [{ Name: "Invoice 7.pdf", Content: pdf.base64, ContentType: "application/pdf" }] });
    env({ MAIL_FROM: "shop@example.com", SENDGRID_API_KEY: "SG.key" });
    mockHttp(() => new Response(null, { status: 202, headers: { "x-message-id": "sg-2" } }));
    await sendMail({ to: "b@example.com", subject: "SG file", body: "Hi", attachments: [pdf] });
    expect(reqs.at(-1)!.body).toMatchObject({ attachments: [{ content: pdf.base64, filename: "Invoice 7.pdf", type: "application/pdf", disposition: "attachment" }] });
    env({ MAIL_FROM: "shop@example.com", RESEND_API_KEY: "re_key" });
    mockHttp(() => Response.json({ id: "re-2" }));
    await sendMail({ to: "c@example.com", subject: "RE file", body: "Hi", attachments: [pdf] });
    expect(reqs.at(-1)!.body).toMatchObject({ attachments: [{ filename: "Invoice 7.pdf", content: pdf.base64, content_type: "application/pdf" }] });
  });

  it("retries temporary failures in the background, and gives up on permanent ones", async () => {
    env({ MAIL_FROM: "shop@example.com", SENDGRID_API_KEY: "SG.key" });
    let n = 0;
    mockHttp(() => (++n === 1 ? new Response('{"errors":[{"message":"try later"}]}', { status: 503 }) : new Response(null, { status: 202 })));
    await sendMail({ to: "c@example.com", subject: "Flaky", body: "x" });
    expect(await email("Flaky")).toMatchObject({ status: "retrying", error: "try later" });
    await db.update(schema.jobs).set({ runAt: new Date(Date.now() - 1000) });
    await drain();
    expect(await email("Flaky")).toMatchObject({ status: "sent" });

    mockHttp(() => new Response('{"errors":[{"message":"The from address does not match a verified Sender Identity"}]}', { status: 403 }));
    await sendMail({ to: "d@example.com", subject: "Refused", body: "x" });
    const r = await email("Refused");
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/verified Sender Identity/);
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.status, "queued"))).toHaveLength(0);
  });
});

describe("SMTP", () => {
  let server: SMTPServer;
  let port = 0;
  const received: { from: string; to: string[]; raw: string; user?: string }[] = [];

  beforeAll(async () => {
    server = new SMTPServer({
      secure: false,
      disabledCommands: ["STARTTLS"],
      authOptional: false,
      authMethods: ["PLAIN", "LOGIN"],
      onAuth(auth, _s, cb) {
        if (auth.username === "mailer" && auth.password === "s3cret") cb(null, { user: "mailer" });
        else cb(new Error("Invalid credentials"));
      },
      onRcptTo(addr, _s, cb) {
        if (addr.address.endsWith("@blocked.example")) {
          const e = new Error("Mailbox unavailable") as Error & { responseCode: number };
          e.responseCode = 550;
          return cb(e);
        }
        cb();
      },
      onData(stream, session, cb) {
        let raw = "";
        stream.on("data", (c) => (raw += c));
        stream.on("end", () => {
          received.push({ from: session.envelope.mailFrom ? (session.envelope.mailFrom as { address: string }).address : "", to: session.envelope.rcptTo.map((r) => r.address), raw, user: session.user as string });
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("delivers through a real SMTP conversation with login", async () => {
    // A local test server without TLS; production should keep SMTP_REQUIRE_TLS on.
    env({ MAIL_FROM: "shop@example.com", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: "mailer", SMTP_PASS: "s3cret", SMTP_REQUIRE_TLS: "false" });
    expect(mailProvider()).toBe("smtp");
    await sendMail({ to: "e@example.com", subject: "SMTP hello", body: "Line one\nLine two", fromName: "Ember", replyTo: "owner@example.com" });
    expect(await email("SMTP hello")).toMatchObject({ status: "sent", transport: "smtp" });
    expect(received[0]).toMatchObject({ from: "shop@example.com", to: ["e@example.com"], user: "mailer" });
    expect(received[0].raw).toContain("Subject: SMTP hello");
    expect(received[0].raw).toContain("Reply-To: owner@example.com");
    expect(received[0].raw).toMatch(/From: Ember <shop@example\.com>/);
    await sendMail({ to: "e@example.com", subject: "SMTP file", body: "See attached", attachments: [{ filename: "Invoice 7.pdf", contentType: "application/pdf", base64: Buffer.from("%PDF-1.7 test").toString("base64") }] });
    const withFile = received.at(-1)!.raw;
    expect(withFile).toMatch(/Content-Type: application\/pdf; name="Invoice 7\.pdf"/);
    expect(withFile).toContain(Buffer.from("%PDF-1.7 test").toString("base64"));
  });

  it("marks a refused recipient as failed without retrying", async () => {
    await sendMail({ to: "x@blocked.example", subject: "SMTP refused", body: "x" });
    const r = await email("SMTP refused");
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/Mailbox unavailable|550/);
  });
});
