// Bringing mail in: each mailbox is synced by a background job (every few
// minutes, and on demand). New messages in the inbox and Sent folders are
// parsed, threaded (by Message-ID references, then by subject), sorted into a
// category with the reasons, checked for spoofing, run through the person's
// rules, and stored with their attachments. Changes made here (read, archive,
// trash, star) are written back to the server by `mail.op` jobs.
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { db, schema } from "@/db";
import { classify, normSubject, ruleMatches, suspicious, type Category } from "@/lib/mail/model";
import { defineJob, enqueue, PermanentError } from "../jobs/queue";
import { log } from "../log";
import { notify } from "../notify/notify";
import { liveCreds } from "./accounts";
import { maybeAutoReply } from "./auto-reply";
import { onMailMeeting } from "../calendar/from-mail";
import { findMeetingLink, findMeetingTime } from "@/lib/calendar/detect";
import { parseIcs } from "@/lib/calendar/ics";
import type { Account } from "./access";
import { explain, transport, type MailConn } from "./transport";

const A = schema.mailAccounts;
const M = schema.mailMessages;
const T = schema.mailThreads;
const MAX_ATTACHMENT = 15 * 1024 * 1024;
const BATCH = 200;

type Addr = { name: string; address: string };
const addrs = (a: AddressObject | AddressObject[] | undefined): Addr[] => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value).filter((v) => !!v.address).map((v) => ({ name: v.name ?? "", address: v.address!.toLowerCase() }));
const header = (p: ParsedMail, name: string) => p.headerLines.find((h) => h.key === name)?.line.replace(/^[^:]+:\s*/, "").replace(/\r?\n\s+/g, " ") ?? "";
const snippetOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 180);

/** Which of our folders this server path is, from its special-use flag or name. */
export function folderPaths(list: { path: string; name: string; specialUse?: string }[]) {
  const by = (use: string, re: RegExp) => list.find((f) => f.specialUse === use)?.path ?? list.find((f) => re.test(f.name) || re.test(f.path))?.path;
  return {
    INBOX: list.find((f) => f.path.toUpperCase() === "INBOX")?.path ?? "INBOX",
    Sent: by("\\Sent", /^(sent|sent items|sent mail|sent messages|\[gmail\]\/sent mail)$/i),
    Archive: by("\\Archive", /^(archive|archives|\[gmail\]\/all mail)$/i) ?? list.find((f) => f.specialUse === "\\All")?.path,
    Trash: by("\\Trash", /^(trash|deleted|deleted items|deleted messages|bin|\[gmail\]\/(trash|bin))$/i),
    Junk: by("\\Junk", /^(junk|spam|junk e-?mail|bulk mail|\[gmail\]\/spam)$/i),
  };
}

// ── Ingest ──────────────────────────────────────────────────────────────────

/** Stores one fetched message. Returns false when it was already there. */
export async function ingest(acc: Account, folder: "INBOX" | "Sent", uid: number, source: Buffer, flags: string[]): Promise<boolean> {
  const [dup] = await db.select({ id: M.id }).from(M).where(and(eq(M.accountId, acc.id), eq(M.folder, folder), eq(M.uid, uid)));
  if (dup) return false;
  const p = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = addrs(p.from)[0] ?? { name: "", address: "" };
  const direction: "in" | "out" = folder === "Sent" || from.address === acc.address ? "out" : "in";
  const messageId = p.messageId ?? "";
  // Our own sent mail comes back from the Sent folder: just note where it lives.
  if (messageId) {
    const [mine] = await db.select({ id: M.id }).from(M).where(and(eq(M.accountId, acc.id), eq(M.messageId, messageId)));
    if (mine) {
      await db.update(M).set({ folder, uid }).where(eq(M.id, mine.id));
      return false;
    }
  }
  const refs = (Array.isArray(p.references) ? p.references : p.references ? [p.references] : []).filter(Boolean);
  const inReplyTo = p.inReplyTo ?? "";
  const to = addrs(p.to);
  const cc = addrs(p.cc);
  const subject = p.subject ?? "";
  const text = (p.text ?? "").slice(0, 200_000);
  const html = typeof p.html === "string" ? p.html.slice(0, 2_000_000) : null;
  const date = p.date && !Number.isNaN(p.date.getTime()) ? p.date : new Date();
  const lu = header(p, "list-unsubscribe");
  const lup = /one-click/i.test(header(p, "list-unsubscribe-post"));
  const auth = header(p, "authentication-results");
  const replyTo = addrs(p.replyTo)[0]?.address ?? "";
  const files = p.attachments ?? [];
  const seen = direction === "out" || flags.includes("\\Seen");

  // Threading: a referenced message first, then the same subject with the same people lately.
  let threadId: string | null = null;
  const ids = [inReplyTo, ...refs].filter(Boolean);
  if (ids.length) {
    const [hit] = await db.select({ threadId: M.threadId }).from(M).where(and(eq(M.accountId, acc.id), inArray(M.messageId, ids))).limit(1);
    threadId = hit?.threadId ?? null;
  }
  const norm = normSubject(subject);
  const people = [from, ...to, ...cc].map((x) => x.address).filter((x) => x && x !== acc.address);
  if (!threadId && norm.length > 3 && /^(re|fwd?|fw)\s*:/i.test(subject.trim())) {
    const candidates = await db.select({ id: T.id, participants: T.participants }).from(T).where(and(eq(T.accountId, acc.id), eq(T.normSubject, norm), gte(T.lastMessageAt, new Date(date.getTime() - 60 * 86_400_000)))).orderBy(desc(T.lastMessageAt)).limit(5);
    threadId = candidates.find((c) => c.participants.some((x) => people.includes(x.address)))?.id ?? null;
  }

  const verdict = direction === "in" ? await senderVerdict(acc.id, from.address) : null;
  const warnings = direction === "in" ? suspicious({ from: from.address, fromName: from.name, authResults: auth, replyTo }) : [];

  if (!threadId) {
    let category: Category = "primary";
    let priority: "high" | "normal" | "low" = "normal";
    let reasons: string[] = [];
    if (direction === "in") {
      const known = verdict === "allowed" || verdict === "vip" || (await knownSender(acc, from.address));
      const first = !known && !(await anyFrom(acc.id, from.address));
      const c = classify({ from: from.address, fromName: from.name, subject, text, listUnsubscribe: !!lu, precedenceBulk: /bulk|list/i.test(header(p, "precedence")), knownSender: known, firstFromSender: first, toMeDirectly: to.some((x) => x.address === acc.address) });
      category = c.category;
      priority = verdict === "vip" ? "high" : c.priority;
      reasons = verdict === "vip" ? ["A VIP sender", ...c.reasons] : c.reasons;
    }
    const [t] = await db.insert(T).values({ orgId: acc.orgId, accountId: acc.id, subject, normSubject: norm, participants: dedupe([from, ...to, ...cc].filter((x) => x.address !== acc.address)), snippet: snippetOf(text), lastMessageAt: date, category, priority, reasons, warnings, status: verdict === "blocked" ? "spam" : "inbox", lastDirection: direction }).returning({ id: T.id });
    threadId = t!.id;
  }

  // A meeting: the calendar invite if there is one, else a video link (with a time read from the text).
  const meeting = direction === "in" ? meetingIn({ files, subject, text, html, date, from, list: !!lu }) : null;
  const [msg] = await db
    .insert(M)
    .values({ orgId: acc.orgId, accountId: acc.id, threadId, folder, uid, messageId, inReplyTo, references: refs.join(" "), fromAddress: from.address, fromName: from.name, to, cc, replyTo, subject, date, snippet: snippetOf(text), text, html, seen, direction, listUnsubscribe: lu.slice(0, 1000), listUnsubscribePost: lup, authResults: auth.slice(0, 2000), hasAttachments: files.some((f) => f.contentDisposition !== "inline" && !/^text\/calendar/i.test(f.contentType ?? "")), sizeBytes: source.length, sendStatus: direction === "out" ? "sent" : null, meeting })
    .onConflictDoNothing()
    .returning({ id: M.id });
  if (!msg) return false;
  // Invites carry the calendar twice (a calendar part and invite.ics): keep one copy.
  const isCal = (f: (typeof files)[number]) => /^(text|application)\/(calendar|ics)/i.test(f.contentType ?? "");
  const firstCal = files.find(isCal);
  const keep = files.filter((f) => !isCal(f) || f === firstCal).map((f) => (f === firstCal && !f.filename ? Object.assign(f, { filename: "invite.ics" }) : f));
  if (keep.length)
    await db.insert(schema.mailAttachments).values(keep.slice(0, 50).map((f) => ({ orgId: acc.orgId, messageId: msg.id, filename: (f.filename ?? "attachment").slice(0, 200), mime: f.contentType ?? "application/octet-stream", size: f.size ?? f.content?.length ?? 0, contentId: (f.contentId ?? "").replace(/[<>]/g, ""), inline: f.contentDisposition === "inline", data: f.content && f.content.length <= MAX_ATTACHMENT ? f.content : null })));

  await refreshThread(threadId, direction === "in" ? { incoming: true, warnings } : {});
  if (meeting) {
    if (typeof meeting.start === "number") await db.update(T).set({ meetingAt: new Date(meeting.start) }).where(eq(T.id, threadId));
    await onMailMeeting(acc, threadId, msg.id, meeting).catch((e) => log.warn("calendar_from_mail_failed", { accountId: acc.id, error: String(e) }));
  }
  if (direction === "in" && verdict !== "blocked") {
    await applyRules(acc, threadId, { from: from.address, to: to.map((x) => x.address), subject, text, hasAttachment: files.length > 0 });
    if (folder === "INBOX")
      await maybeAutoReply(acc, {
        threadId, messageId, references: refs.join(" "), subject, date, from, replyTo, warnings,
        headers: { autoSubmitted: header(p, "auto-submitted"), precedence: header(p, "precedence"), listId: header(p, "list-id"), listUnsubscribe: lu, autoResponseSuppress: header(p, "x-auto-response-suppress") },
        known: () => knownSender(acc, from.address),
      }).catch((e) => log.warn("mail_auto_reply_failed", { accountId: acc.id, error: String(e) }));
  }
  return true;
}

export type MailMeeting = {
  source: "ics" | "text";
  method: string;
  uid: string;
  sequence: number;
  title: string;
  start: number | null;
  end: number | null;
  allDay: boolean;
  tz: string | null;
  url: string;
  provider: string | null;
  location: string;
  description: string;
  organizer: Addr | null;
  attendees: Addr[];
  rrule: string;
  confidence: "high" | "medium" | "low";
  cancelled: boolean;
};

/** A meeting in an email: its calendar invite first; otherwise a video link and the time written in the text. */
/** A calendar file from a parsed or a stored email. */
type CalFile = { contentType?: string; filename?: string; content?: Buffer | null };

/** Which version of meeting-finding mail was last scanned with (a newer one rescans recent mail). */
export const MEETING_SCAN_VERSION = 2;

/**
 * A meeting in an email: its calendar invite first (exact — even from mailing
 * tools that add an unsubscribe link); otherwise, for personal mail, a video
 * link and the time written in the text.
 */
export function meetingIn(m: { files: CalFile[]; subject: string; text: string; html: string | null; date: Date; from: Addr; list?: boolean }): MailMeeting | null {
  const cals = m.files.filter((f) => f.content && (/^(text|application)\/(calendar|ics|x-vcalendar)/i.test(f.contentType ?? "") || /\.(ics|vcs)$/i.test(f.filename ?? "")));
  for (const cal of cals) {
    try {
      const c = parseIcs(cal.content!.toString("utf8"));
      const e = c.events[0];
      if (e) {
        // The invite's own conference link first, then any link in it or the email.
        const link = findMeetingLink([e.conference, e.url, e.location, e.description, m.text, m.html ?? ""].join("\n"));
        return {
          source: "ics", method: c.method || "REQUEST", uid: e.uid, sequence: e.sequence, title: e.summary || m.subject, start: e.start, end: e.end, allDay: e.allDay, tz: e.tz,
          url: link?.url ?? "", provider: link?.provider ?? null, location: e.location.slice(0, 300), description: e.description.slice(0, 4000),
          organizer: e.organizer ? { name: e.organizer.name, address: e.organizer.email } : { name: m.from.name, address: m.from.address },
          attendees: e.attendees.slice(0, 60).map((a) => ({ name: a.name, address: a.email })), rrule: e.rrule, confidence: "high", cancelled: c.method === "CANCEL" || e.status === "CANCELLED",
        };
      }
    } catch {
      /* an unreadable invite: try the next, then the text */
    }
  }
  if (m.list) return null;
  const body = `${m.text}\n${m.html ?? ""}`;
  const link = findMeetingLink(body);
  if (!link) return null;
  const when = findMeetingTime(`${m.subject}\n${m.text}`, m.date.getTime());
  return {
    source: "text", method: "", uid: "", sequence: 0, title: m.subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "") || "Meeting", start: when?.start ?? null, end: when ? (when.end ?? when.start + 30 * 60_000) : null, allDay: false, tz: null,
    url: link.url, provider: link.provider, location: "", description: "", organizer: { name: m.from.name, address: m.from.address }, attendees: [], rrule: "", confidence: when?.confidence ?? "low", cancelled: false,
  };
}

const dedupe = (xs: Addr[]) => xs.filter((x, i) => xs.findIndex((y) => y.address === x.address) === i).slice(0, 30);

async function senderVerdict(accountId: string, address: string) {
  const [r] = await db.select({ v: schema.mailSenders.verdict }).from(schema.mailSenders).where(and(eq(schema.mailSenders.accountId, accountId), eq(schema.mailSenders.address, address)));
  return (r?.v ?? null) as "allowed" | "blocked" | "vip" | null;
}
async function knownSender(acc: Account, address: string) {
  if (!address) return false;
  const [wrote] = await db.select({ id: M.id }).from(M).where(and(eq(M.accountId, acc.id), eq(M.direction, "out"), sql`${M.to} @> ${JSON.stringify([{ address }])}::jsonb`)).limit(1);
  if (wrote) return true;
  const [contact] = await db.select({ id: schema.crmContacts.id }).from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, acc.orgId), sql`lower(${schema.crmContacts.email}) = ${address}`)).limit(1);
  return !!contact;
}
async function anyFrom(accountId: string, address: string) {
  const [r] = await db.select({ id: M.id }).from(M).where(and(eq(M.accountId, accountId), eq(M.fromAddress, address))).limit(1);
  return !!r;
}

/** Recomputes a thread's counts, snippet and participants from its messages. */
export async function refreshThread(threadId: string, opts: { incoming?: boolean; warnings?: string[] } = {}) {
  const msgs = await db.select({ date: M.date, seen: M.seen, direction: M.direction, snippet: M.snippet, from: M.fromAddress, fromName: M.fromName, to: M.to, hasAttachments: M.hasAttachments, sendStatus: M.sendStatus, auto: M.auto }).from(M).where(eq(M.threadId, threadId)).orderBy(M.date);
  const real = msgs.filter((m) => !m.sendStatus || m.sendStatus === "sent");
  const last = real[real.length - 1] ?? msgs[msgs.length - 1];
  if (!last) return;
  // Who wrote last, and since when they've been waiting — an auto-reply doesn't answer anyone.
  const human = real.filter((m) => !m.auto);
  const lastHuman = human[human.length - 1] ?? last;
  const answered = human.map((m) => m.direction).lastIndexOf("out");
  const awaitingSince = human.slice(answered + 1).find((m) => m.direction === "in")?.date ?? null;
  const [t] = await db.select().from(T).where(eq(T.id, threadId));
  if (!t) return;
  const [acc] = await db.select({ address: A.address }).from(A).where(eq(A.id, t.accountId));
  const people = dedupe([...t.participants, ...real.flatMap((m) => [{ name: m.fromName, address: m.from }, ...m.to])].filter((x) => x.address && x.address !== acc?.address));
  await db
    .update(T)
    .set({
      messageCount: real.length,
      unread: real.filter((m) => m.direction === "in" && !m.seen).length,
      snippet: last.snippet,
      lastMessageAt: last.date,
      lastDirection: lastHuman.direction,
      awaitingSince,
      hasAttachments: real.some((m) => m.hasAttachments),
      participants: people,
      ...(opts.warnings?.length ? { warnings: [...new Set([...t.warnings, ...opts.warnings])] } : {}),
      // New mail brings an archived or snoozed conversation back, and answers a follow-up.
      // (Unless it's muted: then it stays archived.)
      ...(opts.incoming ? { status: t.status === "archived" && !t.muted ? "inbox" : t.status, snoozeUntil: null, followUpAt: null } : {}),
    })
    .where(eq(T.id, threadId));
}

// ── Rules ───────────────────────────────────────────────────────────────────

async function applyRules(acc: Account, threadId: string, m: { from: string; to: string[]; subject: string; text: string; hasAttachment: boolean }) {
  const rules = await db.select().from(schema.mailRules).where(and(eq(schema.mailRules.orgId, acc.orgId), eq(schema.mailRules.enabled, true), or(eq(schema.mailRules.accountId, acc.id), and(isNull(schema.mailRules.accountId), or(eq(schema.mailRules.ownerId, acc.ownerId), sql`exists (select 1 from mail_account_members x where x.account_id = ${acc.id} and x.user_id = ${schema.mailRules.ownerId})`)))));
  if (!rules.length) return;
  const [t] = await db.select().from(T).where(eq(T.id, threadId));
  if (!t) return;
  for (const r of rules) {
    if (!ruleMatches({ match: r.match as "all" | "any", conditions: r.conditions as never }, { ...m, category: t.category as Category })) continue;
    const set: Partial<typeof T.$inferInsert> = {};
    for (const a of r.actions) {
      if (a.type === "label" && a.value) set.labels = [...new Set([...(set.labels ?? t.labels), a.value])];
      if (a.type === "category") set.category = a.value;
      if (a.type === "priority") set.priority = a.value;
      if (a.type === "archive") set.status = "archived";
      if (a.type === "trash") set.status = "trash";
      if (a.type === "star") set.starred = true;
      if (a.type === "assign" && /^[0-9a-f-]{36}$/i.test(a.value)) set.assigneeId = a.value;
      if (a.type === "read") await db.update(M).set({ seen: true }).where(eq(M.threadId, threadId));
      if (a.type === "ticket" || a.type === "contact") await enqueue("mail.link", { threadId, kind: a.type }, { orgId: acc.orgId, dedupeKey: `mail.link:${threadId}:${a.type}` });
    }
    if (Object.keys(set).length) await db.update(T).set({ ...set, reasons: [...t.reasons, `Rule “${r.name}”`] }).where(eq(T.id, threadId));
    await db.update(schema.mailRules).set({ hits: sql`${schema.mailRules.hits} + 1` }).where(eq(schema.mailRules.id, r.id));
  }
  await refreshThread(threadId);
}

// ── Sync ────────────────────────────────────────────────────────────────────

export async function syncAccount(accountId: string): Promise<{ added: number; more: boolean }> {
  const [acc] = await db.select().from(A).where(eq(A.id, accountId));
  if (!acc || acc.status === "paused") return { added: 0, more: false };
  let conn: MailConn | null = null;
  let added = 0;
  let more = false;
  try {
    conn = await transport().imap(await liveCreds(acc));
    const paths = folderPaths(await conn.folders());
    const state = { ...acc.syncState };
    for (const k of ["Archive", "Trash", "Junk"] as const) if (paths[k]) state[k] = { path: paths[k]!, uidValidity: 0, lastUid: 0 };
    const days = Number((acc.settings as { syncDays?: number }).syncDays ?? 30);
    for (const folder of ["INBOX", "Sent"] as const) {
      const path = paths[folder];
      if (!path) continue;
      const prev = state[folder];
      const fresh = !prev || prev.path !== path;
      const r = await conn.fetchNew(path, { lastUid: fresh ? 0 : prev!.lastUid, since: new Date(Date.now() - days * 86_400_000), limit: BATCH });
      // A changed UIDVALIDITY means the server renumbered the folder: start that folder over.
      if (!fresh && prev!.uidValidity && r.uidValidity && r.uidValidity !== prev!.uidValidity) {
        state[folder] = { path, uidValidity: r.uidValidity, lastUid: 0 };
        more = true;
        continue;
      }
      let lastUid = fresh ? 0 : prev!.lastUid;
      for (const m of r.messages.sort((a, b) => a.uid - b.uid)) {
        try {
          if (await ingest(acc, folder, m.uid, m.source, m.flags)) added++;
        } catch (e) {
          log.warn("mail_ingest_failed", { accountId, uid: m.uid, error: String(e) });
        }
        lastUid = Math.max(lastUid, m.uid);
      }
      state[folder] = { path, uidValidity: r.uidValidity, lastUid };
      if (r.messages.length >= BATCH) more = true;
    }
    await db.update(A).set({ syncState: state, status: "active", lastError: "", lastSyncAt: new Date() }).where(eq(A.id, acc.id));
  } catch (e) {
    const message = explain(e, "imap");
    await db.update(A).set({ status: "error", lastError: message }).where(eq(A.id, acc.id));
    log.warn("mail_sync_failed", { accountId, error: String(e) });
    throw new PermanentError(message);
  } finally {
    await conn?.close().catch(() => {});
  }
  if (more) await enqueue("mail.sync", { accountId }, { orgId: acc.orgId, dedupeKey: `mail.sync:${accountId}:more:${Date.now()}`, delayMs: 2000 });
  return { added, more };
}

/** Queues a sync for every live mailbox (run every few minutes by the worker), and sends follow-up reminders. */
export async function mailTick() {
  const rows = await db.select({ id: A.id, orgId: A.orgId, settings: A.settings }).from(A).where(inArray(A.status, ["active", "connecting", "error"]));
  const bucket = Math.floor(Date.now() / (3 * 60_000));
  for (const r of rows) {
    await enqueue("mail.sync", { accountId: r.id }, { orgId: r.orgId, dedupeKey: `mail.sync:${r.id}:${bucket}` });
    // Meetings in mail that arrived before (or before the finder improved): look once.
    if ((r.settings as { meetingScan?: number }).meetingScan !== MEETING_SCAN_VERSION) await enqueue("mail.meetings.scan", { accountId: r.id }, { orgId: r.orgId, dedupeKey: `mail.meetings.scan:${r.id}:v${MEETING_SCAN_VERSION}` });
  }
  // Follow-ups that are due: tell the owner once (the reminder is cleared so it isn't repeated).
  const due = await db.select({ id: T.id, orgId: T.orgId, subject: T.subject, participants: T.participants, owner: A.ownerId, assignee: T.assigneeId }).from(T).innerJoin(A, eq(A.id, T.accountId)).where(and(lte(T.followUpAt, new Date()), eq(T.lastDirection, "out"))).limit(200);
  for (const d of due) {
    await notify(d.orgId, [d.assignee ?? d.owner], { kind: "mail.followup", title: `No reply yet: ${d.subject || "(no subject)"}`, body: `Nobody has replied${d.participants[0] ? ` from ${d.participants[0].name || d.participants[0].address}` : ""}. Nudge them?`, link: `/mail/t/${d.id}`, values: { subject: d.subject, to: d.participants[0]?.address ?? "", link: `/mail/t/${d.id}` } });
    await db.update(T).set({ followUpAt: null, labels: sql`array_append(array_remove(${T.labels}, 'Follow up'), 'Follow up')` }).where(eq(T.id, d.id));
  }
}

// ── Writing changes back to the server ──────────────────────────────────────

export type Op = { accountId: string; messageIds: string[]; op: "seen" | "unseen" | "flag" | "unflag" | "archive" | "trash" | "junk" | "inbox" };

/** Applies a change to the real mailbox (IMAP), for the messages that live on the server. */
export async function applyOp(o: Op) {
  const [acc] = await db.select().from(A).where(eq(A.id, o.accountId));
  if (!acc || acc.status === "paused") return;
  const msgs = (await db.select({ id: M.id, folder: M.folder, uid: M.uid }).from(M).where(and(eq(M.accountId, acc.id), inArray(M.id, o.messageIds)))).filter((m) => m.folder && m.uid);
  if (!msgs.length) return;
  const conn = await transport().imap(await liveCreds(acc));
  try {
    const st = acc.syncState;
    for (const folder of [...new Set(msgs.map((m) => m.folder!))]) {
      const path = st[folder]?.path ?? (folder === "INBOX" ? "INBOX" : null);
      if (!path) continue;
      const uids = msgs.filter((m) => m.folder === folder).map((m) => m.uid!).sort((a, b) => a - b);
      if (o.op === "seen" || o.op === "unseen") await conn.setFlags(path, uids, ["\\Seen"], o.op === "seen");
      if (o.op === "flag" || o.op === "unflag") await conn.setFlags(path, uids, ["\\Flagged"], o.op === "flag");
      const dest = o.op === "archive" ? st.Archive?.path : o.op === "trash" ? st.Trash?.path : o.op === "junk" ? st.Junk?.path : null;
      if (dest && folder === "INBOX") {
        await conn.move(path, uids, dest);
        // It now lives elsewhere on the server, under a UID we don't know: stop tracking its old place.
        await db.update(M).set({ folder: o.op === "archive" ? "Archive" : o.op === "trash" ? "Trash" : "Junk", uid: null }).where(inArray(M.id, msgs.filter((m) => m.folder === folder).map((m) => m.id)));
      }
    }
  } finally {
    await conn.close().catch(() => {});
  }
}

defineJob<{ accountId: string }>("mail.sync", async ({ accountId }) => syncAccount(accountId), { timeoutMs: 10 * 60_000 });
defineJob<Op>("mail.op", async (o) => applyOp(o), { timeoutMs: 2 * 60_000 });
