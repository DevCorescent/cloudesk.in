import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db, schema } from "@/db";
import { defineJob, enqueue, PermanentError } from "../jobs/queue";
import { log } from "../log";
import { cfg } from "../platform/config";

// Mail transport. Providers: Resend, Postmark, SendGrid (HTTP APIs) and any
// SMTP server. Choose with MAIL_PROVIDER, or it is picked from whichever keys
// are set. Without a provider, messages are only recorded in the outbox
// (visible in /settings/developer) so flows can be completed in development.
// Every message is recorded with its delivery status. Temporary failures are
// retried in the background job queue with backoff.
/** Attachments travel base64-encoded (they may wait in the retry queue). */
export type MailAttachment = { filename: string; contentType: string; base64: string };
export type MailMessage = { to: string; subject: string; body: string; fromName?: string; replyTo?: string; attachments?: MailAttachment[] };
export type MailProvider = "resend" | "postmark" | "sendgrid" | "smtp" | "outbox";

type Fetch = typeof fetch;
let http: Fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
/** Injectable for tests. */
export function setMailHttp(f: Fetch) {
  http = f;
}

const has = (...keys: string[]) => keys.every((k) => !!cfg(k));
const smtpConfigured = () => has("SMTP_URL") || has("SMTP_HOST");

/** The provider in use: MAIL_PROVIDER if it is fully configured, else the first configured one. */
export function mailProvider(): MailProvider {
  if (!cfg("MAIL_FROM")) return "outbox";
  const ready: Record<Exclude<MailProvider, "outbox">, boolean> = { resend: has("RESEND_API_KEY"), postmark: has("POSTMARK_SERVER_TOKEN"), sendgrid: has("SENDGRID_API_KEY"), smtp: smtpConfigured() };
  const wanted = cfg("MAIL_PROVIDER") as MailProvider | undefined;
  if (wanted && wanted !== "outbox" && ready[wanted]) return wanted;
  if (wanted === "outbox") return "outbox";
  return (Object.keys(ready) as (keyof typeof ready)[]).find((k) => ready[k]) ?? "outbox";
}

export const mailConfigured = () => mailProvider() !== "outbox";

export const MAIL_PROVIDER_NAMES: Record<MailProvider, string> = { resend: "Resend", postmark: "Postmark", sendgrid: "SendGrid", smtp: "SMTP", outbox: "Outbox only (not delivered)" };

// Display names cannot contain characters that break the From header.
const displayName = (s: string) => s.replace(/["<>\r\n]/g, "").trim().slice(0, 60);

class TemporaryError extends Error {}
const failure = (status: number, message: string) => (status === 429 || status >= 500 ? new TemporaryError(message) : new PermanentError(message));

async function viaResend(msg: MailMessage, from: string, idempotencyKey: string) {
  const res = await http("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.body, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.base64, content_type: a.contentType })) } : {}) }),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok) throw failure(res.status, body?.message ?? `HTTP ${res.status}`);
  return body?.id ?? null;
}

async function viaPostmark(msg: MailMessage, from: string) {
  const res = await http("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "X-Postmark-Server-Token": cfg("POSTMARK_SERVER_TOKEN")!, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ From: from, To: msg.to, Subject: msg.subject, TextBody: msg.body, MessageStream: cfg("POSTMARK_STREAM") || "outbound", ...(msg.replyTo ? { ReplyTo: msg.replyTo } : {}), ...(msg.attachments?.length ? { Attachments: msg.attachments.map((a) => ({ Name: a.filename, Content: a.base64, ContentType: a.contentType })) } : {}) }),
  });
  const body = (await res.json().catch(() => null)) as { MessageID?: string; Message?: string; ErrorCode?: number } | null;
  if (!res.ok || (body?.ErrorCode && body.ErrorCode !== 0)) throw failure(res.status === 200 ? 422 : res.status, body?.Message ?? `HTTP ${res.status}`);
  return body?.MessageID ?? null;
}

async function viaSendgrid(msg: MailMessage, from: string, fromName?: string) {
  const res = await http("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg("SENDGRID_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: cfg("MAIL_FROM"), ...(fromName ? { name: displayName(fromName) } : {}) },
      subject: msg.subject,
      content: [{ type: "text/plain", value: msg.body }],
      ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ content: a.base64, filename: a.filename, type: a.contentType, disposition: "attachment" })) } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { errors?: { message: string }[] } | null;
    throw failure(res.status, body?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`);
  }
  void from;
  return res.headers.get("x-message-id");
}

let smtp: ReturnType<typeof nodemailer.createTransport> | null = null;
let smtpKey = "";
function smtpTransport() {
  const key = [cfg("SMTP_URL"), cfg("SMTP_HOST"), cfg("SMTP_PORT"), cfg("SMTP_USER"), cfg("SMTP_SECURE")].join("|");
  if (!smtp || key !== smtpKey) {
    smtpKey = key;
    smtp = cfg("SMTP_URL")
      ? nodemailer.createTransport(cfg("SMTP_URL"))
      : nodemailer.createTransport({
          host: cfg("SMTP_HOST"),
          port: Number(cfg("SMTP_PORT")) || 587,
          // 465 = TLS from the start; otherwise STARTTLS is required unless SMTP_REQUIRE_TLS=false.
          secure: cfg("SMTP_SECURE") === "true" || Number(cfg("SMTP_PORT")) === 465,
          requireTLS: cfg("SMTP_REQUIRE_TLS") !== "false",
          auth: cfg("SMTP_USER") ? { user: cfg("SMTP_USER"), pass: cfg("SMTP_PASS") ?? "" } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        });
  }
  return smtp;
}

async function viaSmtp(msg: MailMessage, from: string) {
  try {
    const info = await smtpTransport().sendMail({ from, to: msg.to, subject: msg.subject, text: msg.body, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}), ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.base64, "base64"), contentType: a.contentType })) } : {}) });
    if (info.rejected?.length) throw new PermanentError(`Rejected by the mail server: ${info.rejected.join(", ")}`);
    return info.messageId ?? null;
  } catch (e) {
    if (e instanceof PermanentError) throw e;
    const code = (e as { responseCode?: number }).responseCode;
    // 5xx SMTP replies are permanent; connection problems and 4xx are worth retrying.
    throw code && code >= 500 ? new PermanentError((e as Error).message) : new TemporaryError((e as Error).message);
  }
}

async function deliver(id: string, msg: MailMessage, provider: Exclude<MailProvider, "outbox">) {
  const from = msg.fromName ? `"${displayName(msg.fromName)}" <${cfg("MAIL_FROM")}>` : cfg("MAIL_FROM")!;
  const providerId = provider === "resend" ? await viaResend(msg, from, id) : provider === "postmark" ? await viaPostmark(msg, from) : provider === "sendgrid" ? await viaSendgrid(msg, from, msg.fromName) : await viaSmtp(msg, from);
  await db.update(schema.outboundEmails).set({ status: "sent", providerId, error: null }).where(eq(schema.outboundEmails.id, id));
  log.info("mail_sent", { to: msg.to, subject: redactMailSecrets(msg.subject), provider });
}

/** Retries of temporary failures, in the background queue. */
defineJob<{ emailId: string; provider: Exclude<MailProvider, "outbox">; msg: MailMessage }>(
  "mail.send",
  async ({ emailId, provider, msg }, { job }) => {
    try {
      await deliver(emailId, msg, provider);
    } catch (e) {
      const final = e instanceof PermanentError || job.attempts >= job.maxAttempts;
      await db.update(schema.outboundEmails).set({ status: final ? "failed" : "retrying", error: (e as Error).message.slice(0, 500) }).where(eq(schema.outboundEmails.id, emailId));
      throw e;
    }
  },
  { timeoutMs: 30_000 },
);

/** Records the email in the outbox and delivers it when a provider is set up; returns the outbox id. */
export async function sendMail(msg: MailMessage): Promise<string> {
  const provider = mailProvider();
  const [row] = await db.insert(schema.outboundEmails).values({ to: msg.to, subject: msg.subject, body: msg.body, transport: provider }).returning({ id: schema.outboundEmails.id });
  if (provider === "outbox") {
    log.info("mail_recorded", { to: msg.to, subject: redactMailSecrets(msg.subject), transport: provider });
    return row.id;
  }
  try {
    await deliver(row.id, msg, provider);
  } catch (e) {
    // Delivery failures never break the flow that triggered the email.
    const temporary = e instanceof TemporaryError;
    await db.update(schema.outboundEmails).set({ status: temporary ? "retrying" : "failed", error: (e as Error).message.slice(0, 500) }).where(eq(schema.outboundEmails.id, row.id));
    log.warn("mail_failed", { to: msg.to, error: (e as Error).message, provider, retrying: temporary });
    if (temporary) await enqueue("mail.send", { emailId: row.id, provider, msg }, { delayMs: 30_000, maxAttempts: 6 }).catch(() => {});
  }
  return row.id;
}

/**
 * Hides what in an email signs someone in or proves their mailbox: ?token= /
 * ?code= links and one-time codes. For logs and for showing sent mail back.
 */
export function redactMailSecrets(text: string): string {
  let out = text.replace(/([?&](?:token|code|key)=)[^\s&#"'<>]+/gi, "$1[hidden]");
  if (/\b(?:your (?:cloudesk )?code|one-time code)\b/i.test(out)) out = out.replace(/\b\d{6}\b/g, "••••••");
  return out;
}

export function appUrl(path: string) {
  return new URL(path, process.env.APP_URL ?? "http://localhost:3000").toString();
}
