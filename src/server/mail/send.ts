// Sending mail: replies keep the conversation together (In-Reply-To and
// References), every send waits a few seconds so it can be undone, sends can
// be scheduled, and "remind me if no reply" sets a follow-up. The actual send
// is a background job that talks to the account's SMTP server and files a
// copy in Sent (Gmail does that itself). Failures are recorded and the
// sender is told; nothing is reported as sent until the server accepted it.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { fillTemplate } from "@/lib/mail/model";
import { splitQuote } from "@/lib/mail/signature";
import type { SendOut } from "@/lib/mail/api";
import { ApiError, notFound } from "../http/errors";
import { defineJob, enqueue, PermanentError } from "../jobs/queue";
import { notify } from "../notify/notify";
import { audit } from "../services/audit";
import { account, accountIds, check, thread as threadFor, type Scope } from "./access";
import { liveCreds } from "./accounts";
import { contactNamed, expandGroups, groupsNamed, touchContacts } from "./contacts";
import { signatureForSend } from "./signatures";
import { refreshThread } from "./sync";
import { compose, explain, newMessageId, transport } from "./transport";

const M = schema.mailMessages;
const T = schema.mailThreads;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;

const email = z.string().trim().toLowerCase().pipe(z.email("Check the email addresses"));
const sendSchema = z.object({
  accountId: z.uuid(),
  threadId: z.uuid().optional(),
  replyTo: z.uuid().optional(),
  mode: z.enum(["new", "reply", "replyAll", "forward"]).default("new"),
  to: z.array(email).max(100).default([]),
  cc: z.array(email).max(100).default([]),
  bcc: z.array(email).max(100).default([]),
  subject: z.string().trim().max(500).default(""),
  body: z.string().max(500_000).default(""),
  sendAt: z.iso.datetime({ offset: true }).optional(),
  followUpAt: z.iso.datetime({ offset: true }).optional(),
  attachments: z.array(z.object({ filename: z.string().trim().min(1).max(200), mime: z.string().trim().max(200).default("application/octet-stream"), data: z.string() })).max(20).default([]),
  forwardAttachments: z.array(z.uuid()).max(30).default([]),
  templateId: z.uuid().optional(),
  /** One of your signatures, null for none; left out: your default for this mailbox. */
  signatureId: z.uuid().nullable().optional(),
  /** Address-book groups: their members are added to To. */
  groupIds: z.array(z.uuid()).max(20).default([]),
  /** One email per To recipient, each personalised, nobody seeing the others. */
  separately: z.boolean().default(false),
});

const MAX_SEPARATE = 500;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Plain text to simple, safe HTML (paragraphs and links). */
export function textToHtml(text: string) {
  const linked = escapeHtml(text).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1d1d1f">${linked.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}

/**
 * `extra` is for other modules sending through Mail: their own HTML body (the
 * text body stays the plain version), and a calendar invite/reply/cancel.
 */
export async function send(s: Scope, raw: unknown, extra: { html?: string; ical?: { method: "REQUEST" | "REPLY" | "CANCEL"; content: string } } = {}): Promise<SendOut> {
  const v0 = check(sendSchema, raw);
  // Groups become their members; then either one email, or one per person.
  const fromGroups = v0.groupIds.length ? (await expandGroups(s.orgId, v0.groupIds)).map((p) => p.email.toLowerCase()) : [];
  if (v0.groupIds.length && !fromGroups.length) throw new ApiError("validation_failed", "Those groups have nobody in them yet", { to: ["Empty group"] });
  const to = [...new Set([...v0.to, ...fromGroups])];
  if (v0.separately && to.length > 1) {
    if (v0.replyTo || v0.threadId) throw new ApiError("validation_failed", "Sending separately is for new emails — reply normally instead");
    if (to.length > MAX_SEPARATE) throw new ApiError("validation_failed", `Send separately to at most ${MAX_SEPARATE} people at a time`);
    let first: SendOut | null = null;
    for (const r of to) {
      const out = await sendOne(s, { ...v0, to: [r], cc: [], bcc: [], groupIds: [], separately: false }, extra);
      first ??= out;
    }
    await touchContacts(s.orgId, to);
    return { ...first!, count: to.length };
  }
  // One email to the group: it remembers the groups, so it reaches whoever is in them when it goes.
  const groupSend = v0.groupIds.length ? { groups: await groupsNamed(s.orgId, v0.groupIds), explicit: v0.to } : undefined;
  const out = await sendOne(s, { ...v0, to }, extra, groupSend);
  await touchContacts(s.orgId, [...to, ...v0.cc, ...v0.bcc]);
  return { ...out, count: 1 };
}

type GroupSend = NonNullable<typeof M.$inferSelect.groupSend>;

async function sendOne(s: Scope, v: z.infer<typeof sendSchema>, extra: { html?: string; ical?: { method: "REQUEST" | "REPLY" | "CANCEL"; content: string } }, groupSend?: GroupSend): Promise<SendOut> {
  const acc = await account(s, v.accountId);
  if (acc.status === "paused") throw new ApiError("conflict", "This mailbox is paused — resume it in Mail → Settings first");
  if (!v.to.length && !v.cc.length && !v.bcc.length) throw new ApiError("validation_failed", "Add at least one recipient", { to: ["Who's it for?"] });
  let subject = v.subject;
  let body = v.body;
  if (v.templateId) {
    const [tpl] = await db.select().from(schema.mailTemplates).where(and(eq(schema.mailTemplates.id, v.templateId), eq(schema.mailTemplates.orgId, s.orgId)));
    if (tpl) {
      await db.update(schema.mailTemplates).set({ uses: tpl.uses + 1 }).where(eq(schema.mailTemplates.id, tpl.id));
      subject ||= tpl.subject;
    }
  }
  // The conversation, and the message being answered.
  let threadId = v.threadId ?? null;
  let inReplyTo = "";
  let references = "";
  if (v.replyTo) {
    const [orig] = await db.select().from(M).where(and(eq(M.id, v.replyTo), eq(M.orgId, s.orgId)));
    if (!orig) throw notFound("Message");
    await threadFor(s, orig.threadId);
    threadId = orig.threadId;
    if (v.mode !== "forward") {
      inReplyTo = orig.messageId;
      references = [orig.references, orig.messageId].filter(Boolean).join(" ").trim();
    }
    if (!subject) subject = v.mode === "forward" ? `Fwd: ${orig.subject.replace(/^fwd?:\s*/i, "")}` : `Re: ${orig.subject.replace(/^re:\s*/i, "")}`;
    if (v.mode === "forward") threadId = null;
  } else if (threadId) await threadFor(s, threadId);
  const signature = await signatureForSend(s.userId, s.orgId, acc.id, v.mode, v.signatureId);
  if (signature === "legacy") {
    // No signatures set up: the mailbox's plain one, as before.
    const sig = acc.signature.trim();
    if (sig && !body.includes(sig)) body = `${body.trimEnd()}\n\n${sig}`;
  }
  // Placeholders ({{first_name}} …) take the first recipient's name: from the conversation, else the CRM.
  const first = v.to[0] ?? v.cc[0] ?? "";
  let name = "";
  let company = "";
  if (first && threadId) {
    const [t] = await db.select({ participants: T.participants }).from(T).where(eq(T.id, threadId));
    name = t?.participants.find((p) => p.address === first)?.name ?? "";
  }
  if (first && !name) {
    const c = await contactNamed(s.orgId, first);
    name = c?.name ?? "";
    company = c?.company ?? "";
  }
  if (first && !name && s.has("crm")) {
    const [c] = await db.select({ name: schema.crmContacts.name, company: schema.crmCompanies.name }).from(schema.crmContacts).leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, schema.crmContacts.companyId)).where(and(eq(schema.crmContacts.orgId, s.orgId), sql`lower(${schema.crmContacts.email}) = ${first}`)).limit(1);
    name = c?.name ?? "";
    company = c?.company ?? "";
  }
  body = fillTemplate(body, { name, email: first, company, myName: acc.displayName || s.userName });
  // A designed signature goes above the quoted part: HTML in the HTML, plain in the text.
  let html = extra.html ?? textToHtml(body);
  if (signature && signature !== "legacy") {
    const [mine, quoted] = splitQuote(body);
    body = `${mine.trimEnd()}\n\n-- \n${signature.text}${quoted}`;
    html = extra.html ? `${extra.html}<div style="margin:22px 0 0">${signature.html}</div>` : `${textToHtml(mine)}<div style="margin:18px 0 0">${signature.html}</div>${quoted.trim() ? textToHtml(quoted.replace(/^\n+/, "")) : ""}`;
  }

  // Attachments: uploaded now, or carried over when forwarding.
  const files: { filename: string; mime: string; data: Buffer }[] = v.attachments.map((a) => ({ filename: a.filename, mime: a.mime, data: Buffer.from(a.data, "base64") }));
  if (v.forwardAttachments.length) {
    // Only attachments on mail in mailboxes this person can open.
    const ids = await accountIds(s);
    const rows = ids.length
      ? await db
          .select({ a: schema.mailAttachments })
          .from(schema.mailAttachments)
          .innerJoin(schema.mailMessages, eq(schema.mailMessages.id, schema.mailAttachments.messageId))
          .where(and(eq(schema.mailAttachments.orgId, s.orgId), inArray(schema.mailAttachments.id, v.forwardAttachments), inArray(schema.mailMessages.accountId, ids)))
      : [];
    for (const { a: r } of rows) if (r.data) files.push({ filename: r.filename, mime: r.mime, data: r.data });
  }
  if (files.some((f) => f.data.length > MAX_FILE)) throw new ApiError("payload_too_large", "Each attachment can be up to 15 MB");
  if (files.reduce((a, f) => a + f.data.length, 0) > MAX_TOTAL) throw new ApiError("payload_too_large", "Attachments can add up to 25 MB per email");

  const delay = Number((acc.settings as { sendDelaySec?: number }).sendDelaySec ?? 10);
  const sendAt = v.sendAt ? new Date(v.sendAt) : new Date(Date.now() + delay * 1000);
  if (v.sendAt && sendAt.getTime() < Date.now() - 60_000) throw new ApiError("validation_failed", "Pick a time in the future to schedule", { sendAt: ["In the past"] });
  const to = v.to.map((address) => ({ name: "", address }));
  const cc = v.cc.map((address) => ({ name: "", address }));
  const bcc = v.bcc.map((address) => ({ name: "", address }));
  if (!threadId) {
    const [t] = await db.insert(T).values({ orgId: s.orgId, accountId: acc.id, subject, normSubject: subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim().toLowerCase(), participants: [...to, ...cc], snippet: body.replace(/\s+/g, " ").slice(0, 180), lastDirection: "out", category: "primary" }).returning({ id: T.id });
    threadId = t!.id;
  }
  const [msg] = await db
    .insert(M)
    .values({ orgId: s.orgId, accountId: acc.id, threadId, messageId: newMessageId(acc.address), inReplyTo, references, fromAddress: acc.address, fromName: acc.displayName, to, cc, bcc, subject, date: sendAt, snippet: body.replace(/\s+/g, " ").slice(0, 180), text: body, html, seen: true, direction: "out", hasAttachments: files.length > 0, sendStatus: "scheduled", sendAt, sentBy: s.userId, groupSend: groupSend ?? null })
    .returning();
  if (extra.ical) files.push({ filename: "invite.ics", mime: `text/calendar; method=${extra.ical.method}; charset=UTF-8`, data: Buffer.from(extra.ical.content, "utf8") });
  if (files.length) await db.insert(schema.mailAttachments).values(files.map((f) => ({ orgId: s.orgId, messageId: msg!.id, filename: f.filename, mime: f.mime, size: f.data.length, data: f.data })));
  if (v.followUpAt) await db.update(T).set({ followUpAt: new Date(v.followUpAt) }).where(eq(T.id, threadId));
  await enqueue("mail.send", { messageId: msg!.id }, { orgId: s.orgId, runAt: sendAt, maxAttempts: 3, dedupeKey: `mail.send:${msg!.id}` });
  return { message: { id: msg!.id, threadId, sendStatus: "scheduled", sendAt: sendAt.toISOString() } };
}

/**
 * "Send a test email": from the mailbox to itself, delivered right now over
 * its real SMTP server, so the answer is the server's — sent, or why not.
 */
export async function testSend(s: Scope, accountId: string) {
  const acc = await account(s, accountId);
  const when = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const out = await sendOne(s, check(sendSchema, { accountId: acc.id, to: [acc.address], subject: `Cloudesk test email — ${when}`, body: `This is a test from Cloudesk.\n\nIf it's in your inbox, sending from ${acc.address} works: it went through ${acc.smtpHost} with your sign-in.\n\nNo need to reply.`, signatureId: null }), {});
  try {
    await deliver(out.message.id, true);
    return { sent: true as const, messageId: out.message.id, threadId: out.message.threadId, to: acc.address, server: acc.smtpHost };
  } catch (e) {
    return { sent: false as const, messageId: out.message.id, threadId: out.message.threadId, to: acc.address, server: acc.smtpHost, error: (e as Error).message };
  }
}

/** Undo (during the delay) or cancel a scheduled send. */
export async function cancel(s: Scope, id: string) {
  const [m] = await db.select().from(M).where(and(eq(M.id, id), eq(M.orgId, s.orgId)));
  if (!m) throw notFound("Message");
  await threadFor(s, m.threadId);
  if (m.sendStatus !== "scheduled") throw new ApiError("conflict", m.sendStatus === "sent" ? "It's already been sent" : "This message isn't waiting to be sent");
  await db.update(M).set({ sendStatus: "cancelled" }).where(and(eq(M.id, m.id), eq(M.sendStatus, "scheduled")));
  const left = await db.select({ id: M.id }).from(M).where(eq(M.threadId, m.threadId));
  if (left.length <= 1) await db.delete(T).where(eq(T.id, m.threadId));
  else {
    await db.delete(M).where(eq(M.id, m.id));
    await refreshThread(m.threadId);
  }
  return { ok: true, draft: { to: m.to.map((x) => x.address), cc: m.cc.map((x) => x.address), subject: m.subject, body: m.text } };
}

/** The background send: SMTP, then a copy in Sent. */
export async function deliver(messageId: string, lastAttempt = true) {
  const [m] = await db.select().from(M).where(eq(M.id, messageId));
  if (!m || m.sendStatus !== "scheduled") return { skipped: true };
  const [acc] = await db.select().from(schema.mailAccounts).where(eq(schema.mailAccounts.id, m.accountId));
  if (!acc) return { skipped: true };
  await db.update(M).set({ sendStatus: "sending" }).where(eq(M.id, m.id));
  // Sent to groups: they become their members now (someone added since it was scheduled gets it too).
  if (m.groupSend?.groups.length) {
    const members = (await expandGroups(m.orgId, m.groupSend.groups.map((g) => g.id))).map((p) => p.email.toLowerCase());
    const now = [...new Set([...m.groupSend.explicit, ...members])];
    if (!now.length && !m.cc.length && !m.bcc.length) {
      await failed(m.id, "The groups it was for have nobody in them now");
      return { skipped: true };
    }
    m.to = now.map((address) => m.to.find((x) => x.address === address) ?? { name: "", address });
    await db.update(M).set({ to: m.to }).where(eq(M.id, m.id));
  }
  const files = await db.select().from(schema.mailAttachments).where(eq(schema.mailAttachments.messageId, m.id));
  // A calendar invite goes as the message's calendar part (so mail apps show Accept/Decline), not a plain attachment.
  const ical = files.find((f) => f.mime.startsWith("text/calendar") && f.data);
  try {
    const creds = await liveCreds(acc);
    const from = acc.displayName ? { name: acc.displayName, address: acc.address } : acc.address;
    const raw = await compose({ messageId: m.messageId, from, to: m.to.map((x) => x.address), cc: m.cc.map((x) => x.address), bcc: m.bcc.map((x) => x.address), subject: m.subject, text: m.text, html: m.html ?? undefined, inReplyTo: m.inReplyTo || undefined, references: m.references || undefined, ...(m.auto ? { headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All", Precedence: "auto_reply" } } : {}), ...(ical ? { icalEvent: { method: /method=(\w+)/i.exec(ical.mime)?.[1] ?? "REQUEST", filename: "invite.ics", content: ical.data!.toString("utf8") } } : {}), attachments: files.filter((f) => f.data && f !== ical).map((f) => ({ filename: f.filename, contentType: f.mime, content: f.data! })) });
    const rcpt = [...m.to, ...m.cc, ...m.bcc].map((x) => x.address);
    await transport().send(creds, { from: acc.address, to: rcpt }, raw);
    await db.update(M).set({ sendStatus: "sent", date: new Date(), sendError: "" }).where(eq(M.id, m.id));
    await refreshThread(m.threadId);
    // File a copy in Sent where the provider doesn't (best effort: the mail is already sent).
    if (!(acc.settings as { savesSent?: boolean }).savesSent && acc.syncState.Sent?.path) {
      try {
        const conn = await transport().imap(creds);
        try {
          await conn.append(acc.syncState.Sent.path, raw, ["\\Seen"]);
        } finally {
          await conn.close();
        }
      } catch {
        /* the next sync shows it from our copy anyway */
      }
    }
    return { sent: true };
  } catch (e) {
    const message = explain(e, "smtp");
    const auth = /sign-in|password/i.test(message);
    await db.update(M).set({ sendStatus: auth ? "failed" : "scheduled", sendError: message }).where(eq(M.id, m.id));
    if (auth || lastAttempt) {
      await failed(m.id, message);
      throw new PermanentError(message);
    }
    throw new Error(message);
  }
}

/** After the last retry: mark it failed and tell the sender. */
export async function failed(messageId: string, error: string) {
  const [m] = await db.update(M).set({ sendStatus: "failed", sendError: error }).where(eq(M.id, messageId)).returning();
  if (m) await notify(m.orgId, [m.sentBy], { kind: "mail.failed", title: `Couldn't send: ${m.subject || "(no subject)"}`, body: error, link: `/mail/t/${m.threadId}`, values: { subject: m.subject, error, link: `/mail/t/${m.threadId}` } });
}

/** Sends a failed message again. */
export async function retry(s: Scope, id: string) {
  const [m] = await db.select().from(M).where(and(eq(M.id, id), eq(M.orgId, s.orgId)));
  if (!m) throw notFound("Message");
  await threadFor(s, m.threadId);
  if (m.sendStatus !== "failed") throw new ApiError("conflict", "Only failed messages can be retried");
  await db.update(M).set({ sendStatus: "scheduled", sendAt: new Date(), sendError: "" }).where(eq(M.id, m.id));
  await enqueue("mail.send", { messageId: m.id }, { orgId: s.orgId, maxAttempts: 3, dedupeKey: `mail.send:${m.id}:${Date.now()}` });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "mail.send_retried", targetType: "mail_message", targetId: m.id });
  return { ok: true };
}

defineJob<{ messageId: string }>("mail.send", async ({ messageId }, { job }) => deliver(messageId, job.attempts >= job.maxAttempts), { timeoutMs: 3 * 60_000 });
