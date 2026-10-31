// The inbox itself: counts per mailbox and view, listing and searching
// conversations, reading one (with the CRM contact behind it), every action
// on a conversation (read, star, pin, snooze, follow-up, labels, category,
// assign, archive, trash, spam), bulk actions, team notes, links to the CRM
// and Helpdesk, the sender screener, one-click unsubscribe, rules and
// templates, and the safe HTML view of an email.
import { and, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { CATEGORIES, parseSearch, REPLY_CATEGORIES, ruleSchema, templateSchema, VIEWS, type Category } from "@/lib/mail/model";
import type { Counts, MessageDetails, MessageMeeting, MessageOut, MetaOut, ThreadOut, ThreadRow } from "@/lib/mail/api";
import { target } from "@/lib/import/targets";
import { hasLlm } from "../ai/gateway";
import { runImport, str } from "../import/run";
import { ApiError, notFound } from "../http/errors";
import { safeRequest } from "../net/safe-fetch";
import { neutralizeScriptUrls } from "../security/html-urls";
import { defineJob, enqueue } from "../jobs/queue";
import { notify } from "../notify/notify";
import { audit } from "../services/audit";
import { appUrl } from "../services/mail";
import { account, accountIds, accountsFor, check, membersOf, thread as threadFor, type Scope } from "./access";
import { accountOut } from "./accounts";
import { oauthConfigured } from "./oauth";
import type { MailMeeting, Op } from "./sync";
import { refreshThread } from "./sync";

const T = schema.mailThreads;
const M = schema.mailMessages;
const esc = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

// ── Meta and counts ─────────────────────────────────────────────────────────

/** Conversations where they're waiting on us: in the inbox, personal mail, not muted, and we haven't answered. (On "t".) */
const owed = sql.raw(`t.status = 'inbox' and (t.snooze_until is null or t.snooze_until <= now()) and t.awaiting_since is not null and not t.muted and t.category in (${REPLY_CATEGORIES.map((c) => `'${c}'`).join(",")})`);

const visible = (now: Date) => and(eq(T.status, "inbox"), or(isNull(T.snoozeUntil), lte(T.snoozeUntil, now)));

export async function countsFor(ids: string[], userId: string): Promise<Counts> {
  const empty: Counts = { inbox: 0, unread: 0, categories: {}, snoozed: 0, waiting: 0, followups: 0, scheduled: 0, assigned: 0, drafts: 0, needsReply: 0, overdue: 0, muted: 0, meetings: 0 };
  if (!ids.length) return empty;
  const now = new Date();
  const [row] = (await db.execute<Record<string, number>>(sql`select
      count(*) filter (where t.status = 'inbox' and (t.snooze_until is null or t.snooze_until <= now()))::int as inbox,
      coalesce(sum(t.unread) filter (where t.status = 'inbox' and (t.snooze_until is null or t.snooze_until <= now())), 0)::int as unread,
      count(*) filter (where t.status = 'inbox' and t.snooze_until > now())::int as snoozed,
      count(*) filter (where t.last_direction = 'out' and t.status in ('inbox','archived') and t.last_message_at > now() - interval '30 days' and t.last_message_at < now() - interval '1 day')::int as waiting,
      count(*) filter (where t.follow_up_at is not null)::int as followups,
      count(*) filter (where t.assignee_id = ${userId} and t.status = 'inbox')::int as assigned,
      count(*) filter (where ${owed})::int as "needsReply",
      count(*) filter (where ${owed} and t.awaiting_since + (a.settings->>'slaHours')::int * interval '1 hour' < now())::int as overdue,
      count(*) filter (where t.muted and t.status <> 'trash')::int as muted,
      count(*) filter (where t.status = 'inbox' and t.meeting_event_id is null and exists (select 1 from mail_messages x where x.thread_id = t.id and x.meeting is not null and coalesce((x.meeting->>'cancelled')::boolean, false) = false) and (t.meeting_at is null or t.meeting_at > now() - interval '1 day'))::int as meetings
    from mail_threads t join mail_accounts a on a.id = t.account_id where t.account_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)).rows;
  const cats = await db.select({ c: T.category, n: sql<number>`count(*)::int` }).from(T).where(and(inArray(T.accountId, ids), visible(now), gt(T.unread, 0))).groupBy(T.category);
  const [sched] = await db.select({ n: sql<number>`count(*)::int` }).from(M).where(and(inArray(M.accountId, ids), eq(M.sendStatus, "scheduled"), gt(M.sendAt, new Date(Date.now() + 60_000))));
  return { ...empty, ...Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)])), categories: Object.fromEntries(cats.map((c) => [c.c, Number(c.n)])), scheduled: Number(sched?.n ?? 0) };
}

export async function meta(s: Scope): Promise<MetaOut> {
  const accts = await accountsFor(s);
  const ids = accts.map((a) => a.id);
  const members = await membersOf(ids);
  const counts: Record<string, Counts> = { all: await countsFor(ids, s.userId) };
  for (const a of accts) counts[a.id] = await countsFor([a.id], s.userId);
  const labels = ids.length ? (await db.execute<{ l: string }>(sql`select distinct unnest(labels) as l from mail_threads where account_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) order by 1 limit 200`)).rows.map((r) => r.l) : [];
  const team = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, s.orgId));
  return {
    me: { id: s.userId, name: s.userName, email: s.userEmail, manage: s.manage },
    accounts: accts.map((a) => accountOut(s, a, members.get(a.id) ?? [])),
    counts,
    labels,
    aiAvailable: await hasLlm(s.orgId),
    oauth: { google: oauthConfigured("google"), microsoft: oauthConfigured("microsoft") },
    members: team,
    links: { crm: s.has("crm"), helpdesk: s.has("helpdesk") },
  };
}

// ── Listing and search ──────────────────────────────────────────────────────

const rowOut = (t: typeof T.$inferSelect): ThreadRow => ({
  id: t.id, accountId: t.accountId, subject: t.subject, snippet: t.snippet, participants: t.participants, lastMessageAt: t.lastMessageAt.toISOString(), messageCount: t.messageCount, unread: t.unread,
  lastDirection: t.lastDirection as "in" | "out", category: t.category as Category, priority: t.priority as ThreadRow["priority"], status: t.status as ThreadRow["status"], snoozeUntil: t.snoozeUntil?.toISOString() ?? null,
  starred: t.starred, pinned: t.pinned, labels: t.labels, assigneeId: t.assigneeId, followUpAt: t.followUpAt?.toISOString() ?? null, hasAttachments: t.hasAttachments, warnings: t.warnings,
  muted: t.muted, awaitingSince: t.awaitingSince?.toISOString() ?? null, meetingAt: t.meetingAt?.toISOString() ?? null, meetingEventId: t.meetingEventId,
});

export async function threads(s: Scope, q: Record<string, string>) {
  const all = await accountIds(s);
  const ids = q.account && q.account !== "all" ? all.filter((i) => i === q.account) : all;
  if (!ids.length) return { threads: [], next: null };
  const view = (VIEWS as readonly string[]).includes(q.view ?? "") ? q.view! : "inbox";
  const now = new Date();
  const conds: (SQL | undefined)[] = [inArray(T.accountId, ids)];
  const search = parseSearch(q.q ?? "");
  const searching = !!(search.text || search.from || search.to || search.subject || search.label || search.hasAttachment !== undefined || search.unread !== undefined || search.starred || search.before || search.after);
  switch (view) {
    case "inbox":
      if (!searching) conds.push(visible(now));
      if (q.category && (CATEGORIES as readonly string[]).includes(q.category)) conds.push(eq(T.category, q.category));
      break;
    case "needsreply": conds.push(visible(now), isNotNull(T.awaitingSince), eq(T.muted, false), inArray(T.category, REPLY_CATEGORIES)); break;
    case "muted": conds.push(eq(T.muted, true), sql`${T.status} <> 'trash'`); break;
    case "meetings": conds.push(sql`${T.status} not in ('trash','spam')`, sql`exists (select 1 from mail_messages x where x.thread_id = ${T.id} and x.meeting is not null)`); break;
    case "important": conds.push(visible(now), eq(T.priority, "high")); break;
    case "starred": conds.push(eq(T.starred, true), sql`${T.status} <> 'trash'`); break;
    case "snoozed": conds.push(eq(T.status, "inbox"), gt(T.snoozeUntil, now)); break;
    case "waiting": conds.push(eq(T.lastDirection, "out"), inArray(T.status, ["inbox", "archived"]), gt(T.lastMessageAt, new Date(Date.now() - 30 * 86_400_000)), lt(T.lastMessageAt, new Date(Date.now() - 86_400_000))); break;
    case "followups": conds.push(isNotNull(T.followUpAt)); break;
    case "scheduled": conds.push(sql`exists (select 1 from mail_messages x where x.thread_id = ${T.id} and x.send_status = 'scheduled')`); break;
    case "sent": conds.push(sql`exists (select 1 from mail_messages x where x.thread_id = ${T.id} and x.direction = 'out' and x.send_status = 'sent')`); break;
    case "archive": conds.push(eq(T.status, "archived")); break;
    case "trash": conds.push(eq(T.status, "trash")); break;
    case "spam": conds.push(eq(T.status, "spam")); break;
    case "assigned": conds.push(eq(T.assigneeId, s.userId), eq(T.status, "inbox")); break;
    case "attachments": conds.push(eq(T.hasAttachments, true), sql`${T.status} <> 'trash'`); break;
  }
  if (searching && view === "inbox") conds.push(sql`${T.status} not in ('trash', 'spam')`);
  if (search.label || q.label) conds.push(sql`${search.label ?? q.label} = any(${T.labels})`);
  if (search.category) conds.push(eq(T.category, search.category));
  if (search.unread !== undefined) conds.push(search.unread ? gt(T.unread, 0) : eq(T.unread, 0));
  if (search.starred) conds.push(eq(T.starred, true));
  if (search.hasAttachment) conds.push(eq(T.hasAttachments, true));
  if (search.before) conds.push(lt(T.lastMessageAt, new Date(`${search.before}T00:00:00Z`)));
  if (search.after) conds.push(gte(T.lastMessageAt, new Date(`${search.after}T00:00:00Z`)));
  if (search.from) conds.push(sql`exists (select 1 from mail_messages x where x.thread_id = ${T.id} and (x.from_address ilike ${esc(search.from)} or x.from_name ilike ${esc(search.from)}))`);
  if (search.to) conds.push(sql`exists (select 1 from mail_messages x where x.thread_id = ${T.id} and x."to"::text ilike ${esc(search.to)})`);
  if (search.subject) conds.push(ilike(T.subject, esc(search.subject)));
  if (search.text) conds.push(or(ilike(T.subject, esc(search.text)), ilike(T.snippet, esc(search.text)), sql`${T.participants}::text ilike ${esc(search.text)}`, sql`exists (select 1 from mail_messages x where x.thread_id = ${T.id} and x.text ilike ${esc(search.text)})`));
  if (q.cursor) {
    const [at, id] = q.cursor.split("_");
    if (at && id && /^[0-9a-f-]{36}$/i.test(id)) conds.push(or(lt(T.lastMessageAt, new Date(Number(at))), and(eq(T.lastMessageAt, new Date(Number(at))), lt(T.id, id))));
  }
  const limit = 50;
  if (view === "needsreply") {
    // Oldest wait first; small enough to show at once.
    const rows = await db.select().from(T).where(and(...conds)).orderBy(T.awaitingSince, T.id).limit(200);
    return { threads: rows.map(rowOut), next: null };
  }
  const rows = await db.select().from(T).where(and(...conds)).orderBy(view === "inbox" && !searching ? desc(T.pinned) : sql`1`, desc(T.lastMessageAt), desc(T.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { threads: page.map(rowOut), next: rows.length > limit && last ? `${last.lastMessageAt.getTime()}_${last.id}` : null };
}

// ── One conversation ────────────────────────────────────────────────────────

/** The meeting stored on a message, for the meeting card. */
function meetingOut(raw: unknown): MessageMeeting | null {
  const g = raw as MailMeeting | null;
  if (!g) return null;
  return { title: g.title, start: g.start ? new Date(g.start).toISOString() : null, end: g.end ? new Date(g.end).toISOString() : null, allDay: g.allDay, url: g.url, provider: g.provider, location: g.location, source: g.source, confidence: g.confidence, organizer: g.organizer, attendees: g.attendees.slice(0, 30), cancelled: g.cancelled, rsvp: g.source === "ics" && !!g.organizer?.address };
}

function unsubscribeOf(header: string, post: boolean): MessageOut["unsubscribe"] {
  if (!header) return null;
  const parts = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim());
  const url = parts.find((p) => /^https:\/\//i.test(p));
  const mailto = parts.find((p) => /^mailto:/i.test(p));
  return url || mailto ? { url, mailto, oneClick: !!url && post } : null;
}

export async function detail(s: Scope, id: string): Promise<ThreadOut> {
  const t = await threadFor(s, id);
  const msgs = await db.select().from(M).where(and(eq(M.threadId, t.id), sql`coalesce(${M.sendStatus}, '') <> 'cancelled'`)).orderBy(M.date);
  const files = msgs.length ? await db.select({ id: schema.mailAttachments.id, messageId: schema.mailAttachments.messageId, filename: schema.mailAttachments.filename, mime: schema.mailAttachments.mime, size: schema.mailAttachments.size, inline: schema.mailAttachments.inline, stored: sql<boolean>`${schema.mailAttachments.data} is not null` }).from(schema.mailAttachments).where(inArray(schema.mailAttachments.messageId, msgs.map((m) => m.id))) : [];
  const notes = await db.select({ id: schema.mailNotes.id, body: schema.mailNotes.body, by: schema.users.name, at: schema.mailNotes.createdAt }).from(schema.mailNotes).leftJoin(schema.users, eq(schema.users.id, schema.mailNotes.userId)).where(eq(schema.mailNotes.threadId, t.id)).orderBy(schema.mailNotes.createdAt);
  // Reading it marks it read, here and on the server.
  const unseen = msgs.filter((m) => m.direction === "in" && !m.seen).map((m) => m.id);
  if (unseen.length) {
    await db.update(M).set({ seen: true }).where(inArray(M.id, unseen));
    await db.update(T).set({ unread: 0 }).where(eq(T.id, t.id));
    await queueOp({ accountId: t.accountId, messageIds: unseen, op: "seen" }, s.orgId);
  }
  const main = t.participants[0]?.address ?? "";
  let contact: ThreadOut["contact"] = null;
  if (main && s.has("crm")) {
    const [c] = await db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, company: schema.crmCompanies.name }).from(schema.crmContacts).leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, schema.crmContacts.companyId)).where(and(eq(schema.crmContacts.orgId, s.orgId), t.contactId ? eq(schema.crmContacts.id, t.contactId) : sql`lower(${schema.crmContacts.email}) = ${main}`)).limit(1);
    if (c) {
      const deals = await db.select({ id: schema.crmDeals.id, title: schema.crmDeals.title, value: schema.crmDeals.value, status: schema.crmDeals.status }).from(schema.crmDeals).where(and(eq(schema.crmDeals.orgId, s.orgId), eq(schema.crmDeals.contactId, c.id))).orderBy(desc(schema.crmDeals.createdAt)).limit(5);
      contact = { ...c, company: c.company ?? null, deals: deals.map((d) => ({ ...d, value: Number(d.value) })) };
    }
  }
  const [verdict] = main ? await db.select({ v: schema.mailSenders.verdict }).from(schema.mailSenders).where(and(eq(schema.mailSenders.accountId, t.accountId), eq(schema.mailSenders.address, main))) : [];
  const fresh = (await threadFor(s, id));
  return {
    thread: { ...rowOut(fresh), reasons: fresh.reasons, aiSummary: fresh.aiSummary, contactId: fresh.contactId, dealId: fresh.dealId, ticketId: fresh.ticketId },
    messages: msgs.map((m) => ({
      id: m.id, from: { name: m.fromName, address: m.fromAddress }, to: m.to, cc: m.cc, replyTo: m.replyTo, subject: m.subject, date: m.date.toISOString(), text: m.text, hasHtml: !!m.html, direction: m.direction as "in" | "out",
      sendStatus: m.sendStatus as MessageOut["sendStatus"], sendAt: m.sendAt?.toISOString() ?? null, sendError: m.sendError, groups: m.groupSend?.groups ?? [], messageId: m.messageId,
      attachments: files.filter((f) => f.messageId === m.id).map((f) => ({ id: f.id, filename: f.filename, mime: f.mime, size: f.size, inline: f.inline, stored: !!f.stored })),
      unsubscribe: unsubscribeOf(m.listUnsubscribe, m.listUnsubscribePost),
      auto: m.auto,
      meeting: meetingOut(m.meeting),
    })),
    notes: notes.map((n) => ({ id: n.id, body: n.body, by: n.by, at: n.at.toISOString() })),
    contact,
    sender: { address: main, verdict: (verdict?.v ?? null) as ThreadOut["sender"]["verdict"] },
  };
}

// ── Changes ─────────────────────────────────────────────────────────────────

async function queueOp(o: Op, orgId: string) {
  if (o.messageIds.length) await enqueue("mail.op", o, { orgId, maxAttempts: 4 });
}
async function serverIds(threadIds: string[]) {
  return threadIds.length ? (await db.select({ id: M.id, accountId: M.accountId }).from(M).where(and(inArray(M.threadId, threadIds), isNotNull(M.uid)))) : [];
}
/** Mirrors a change to the real mailboxes (per account). */
async function mirror(threadIds: string[], op: Op["op"], orgId: string) {
  const rows = await serverIds(threadIds);
  for (const acc of [...new Set(rows.map((r) => r.accountId))]) await queueOp({ accountId: acc, messageIds: rows.filter((r) => r.accountId === acc).map((r) => r.id), op }, orgId);
}

const patchSchema = z.object({
  status: z.enum(["inbox", "archived", "trash", "spam"]),
  starred: z.boolean(),
  pinned: z.boolean(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20),
  category: z.enum(CATEGORIES),
  snoozeUntil: z.iso.datetime({ offset: true }).nullable(),
  followUpAt: z.iso.datetime({ offset: true }).nullable(),
  assigneeId: z.uuid().nullable(),
  read: z.boolean(),
  muted: z.boolean(),
}).partial();

export async function update(s: Scope, id: string, raw: unknown) {
  const t = await threadFor(s, id);
  const v = check(patchSchema, raw);
  const set: Partial<typeof T.$inferInsert> = {};
  if (v.status !== undefined) set.status = v.status;
  if (v.starred !== undefined) set.starred = v.starred;
  if (v.pinned !== undefined) set.pinned = v.pinned;
  if (v.labels !== undefined) set.labels = [...new Set(v.labels)];
  if (v.category !== undefined) set.category = v.category;
  // Muting also takes it out of the inbox; unmuting brings it back.
  if (v.muted !== undefined) {
    set.muted = v.muted;
    if (v.status === undefined) set.status = v.muted ? (t.status === "inbox" ? "archived" : t.status) : t.status === "archived" ? "inbox" : t.status;
  }
  if (v.snoozeUntil !== undefined) set.snoozeUntil = v.snoozeUntil ? new Date(v.snoozeUntil) : null;
  if (v.followUpAt !== undefined) set.followUpAt = v.followUpAt ? new Date(v.followUpAt) : null;
  if (v.assigneeId !== undefined) {
    const acc = await account(s, t.accountId);
    if (!acc.shared) throw new ApiError("conflict", "Only team-inbox conversations can be assigned");
    if (v.assigneeId) {
      const allowed = acc.ownerId === v.assigneeId || ((await membersOf([acc.id])).get(acc.id) ?? []).includes(v.assigneeId);
      if (!allowed) throw new ApiError("validation_failed", "They aren't on this team inbox", { assigneeId: ["Not a member"] });
    }
    set.assigneeId = v.assigneeId;
  }
  if (Object.keys(set).length) await db.update(T).set(set).where(eq(T.id, t.id));
  if (v.read !== undefined) {
    const msgs = await db.select({ id: M.id }).from(M).where(and(eq(M.threadId, t.id), eq(M.direction, "in")));
    await db.update(M).set({ seen: v.read }).where(inArray(M.id, msgs.length ? msgs.map((m) => m.id) : ["00000000-0000-0000-0000-000000000000"]));
    await refreshThread(t.id);
    await mirror([t.id], v.read ? "seen" : "unseen", s.orgId);
  }
  if (v.starred !== undefined) await mirror([t.id], v.starred ? "flag" : "unflag", s.orgId);
  if (set.status === "archived" && v.muted) await mirror([t.id], "archive", s.orgId);
  if (v.status === "archived" || v.status === "trash" || v.status === "spam") await mirror([t.id], v.status === "archived" ? "archive" : v.status === "trash" ? "trash" : "junk", s.orgId);
  if (v.assigneeId && v.assigneeId !== s.userId && v.assigneeId !== t.assigneeId) {
    await notify(s.orgId, [v.assigneeId], { kind: "mail.assigned", title: `${s.userName} gave you an email: ${t.subject || "(no subject)"}`, link: `/mail/t/${t.id}`, values: { subject: t.subject, from: t.participants[0]?.address ?? "", by: s.userName, link: `/mail/t/${t.id}` } });
  }
  const [row] = await db.select().from(T).where(eq(T.id, t.id));
  return rowOut(row!);
}

const bulkSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500), action: z.enum(["archive", "inbox", "trash", "spam", "read", "unread", "star", "unstar", "label", "unlabel", "category", "snooze"]), value: z.string().trim().max(100).optional() });

export async function bulk(s: Scope, raw: unknown) {
  const v = check(bulkSchema, raw);
  const ids = await accountIds(s);
  const rows = ids.length ? await db.select({ id: T.id }).from(T).where(and(inArray(T.id, v.ids), inArray(T.accountId, ids))) : [];
  const tids = rows.map((r) => r.id);
  if (!tids.length) return { ok: true, count: 0 };
  const where = inArray(T.id, tids);
  switch (v.action) {
    case "archive": case "inbox": case "trash": case "spam":
      await db.update(T).set({ status: v.action === "archive" ? "archived" : v.action, ...(v.action === "inbox" ? { snoozeUntil: null } : {}) }).where(where);
      if (v.action !== "inbox") await mirror(tids, v.action === "archive" ? "archive" : v.action === "trash" ? "trash" : "junk", s.orgId);
      break;
    case "read": case "unread":
      await db.update(M).set({ seen: v.action === "read" }).where(and(inArray(M.threadId, tids), eq(M.direction, "in")));
      for (const t of tids) await refreshThread(t);
      await mirror(tids, v.action === "read" ? "seen" : "unseen", s.orgId);
      break;
    case "star": case "unstar":
      await db.update(T).set({ starred: v.action === "star" }).where(where);
      await mirror(tids, v.action === "star" ? "flag" : "unflag", s.orgId);
      break;
    case "label":
      if (!v.value) throw new ApiError("validation_failed", "Name the label");
      await db.update(T).set({ labels: sql`array_append(array_remove(${T.labels}, ${v.value}), ${v.value})` }).where(where);
      break;
    case "unlabel":
      await db.update(T).set({ labels: sql`array_remove(${T.labels}, ${v.value ?? ""})` }).where(where);
      break;
    case "category":
      if (!(CATEGORIES as readonly string[]).includes(v.value ?? "")) throw new ApiError("validation_failed", "Pick a category");
      await db.update(T).set({ category: v.value! }).where(where);
      break;
    case "snooze":
      if (!v.value || Number.isNaN(Date.parse(v.value))) throw new ApiError("validation_failed", "Pick when to bring it back");
      await db.update(T).set({ snoozeUntil: new Date(v.value) }).where(where);
      break;
  }
  return { ok: true, count: tids.length };
}

export async function addNote(s: Scope, id: string, raw: unknown) {
  const t = await threadFor(s, id);
  const { body } = check(z.object({ body: z.string().trim().min(1, "Write a note").max(5000) }), raw);
  const [n] = await db.insert(schema.mailNotes).values({ orgId: s.orgId, threadId: t.id, userId: s.userId, body }).returning();
  // @mentions of teammates on the inbox notify them.
  const acc = await account(s, t.accountId);
  if (acc.shared) {
    const team = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [acc.ownerId, ...((await membersOf([acc.id])).get(acc.id) ?? [])]));
    const mentioned = team.filter((u) => u.id !== s.userId && !!u.name.trim() && new RegExp(`@${(u.name.split(" ")[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body));
    if (mentioned.length) await notify(s.orgId, mentioned.map((u) => u.id), { kind: "mail.assigned", title: `${s.userName} mentioned you on an email`, body: body.slice(0, 200), link: `/mail/t/${t.id}`, values: { subject: t.subject, from: "", by: s.userName, link: `/mail/t/${t.id}` } });
  }
  return { note: { id: n!.id, body: n!.body, by: s.userName, at: n!.createdAt.toISOString() } };
}

// ── Links: CRM contact, Helpdesk ticket ─────────────────────────────────────

export async function link(s: Scope, id: string, raw: unknown) {
  const t = await threadFor(s, id);
  const { kind } = check(z.object({ kind: z.enum(["contact", "ticket"]) }), raw);
  if (kind === "contact" && !s.has("crm")) throw new ApiError("forbidden", "Switch on the CRM to add contacts from email");
  if (kind === "ticket" && !s.has("helpdesk")) throw new ApiError("forbidden", "Switch on the Helpdesk to make tickets from email");
  return linkThread(s.orgId, s.userId, t.id, kind);
}

async function linkThread(orgId: string, userId: string | null, threadId: string, kind: "contact" | "ticket") {
  const [t] = await db.select().from(T).where(eq(T.id, threadId));
  if (!t) throw notFound("Conversation");
  const who = t.participants[0];
  if (!who) throw new ApiError("conflict", "This conversation has nobody to link");
  if (kind === "contact") {
    const { capture } = await import("../crm/capture");
    const r = await capture(orgId, "web", { email: who.address, name: who.name || who.address.split("@")[0] }, { source: "email", event: { subject: `Email: ${t.subject || "(no subject)"}`.slice(0, 200), body: t.snippet } });
    if (!r) throw new ApiError("conflict", "The CRM didn't accept this contact — check the CRM is switched on");
    const contactId = r.id;
    if (contactId) await db.update(T).set({ contactId }).where(eq(T.id, t.id));
    return { contactId };
  }
  const [first] = await db.select().from(M).where(eq(M.threadId, t.id)).orderBy(M.date).limit(1);
  const { intake } = await import("../helpdesk/core");
  const r = await intake(orgId, { subject: t.subject || "(no subject)", body: (first?.text ?? t.snippet).slice(0, 20_000), name: who.name || who.address, email: who.address, channel: "email", createdBy: userId, contactId: t.contactId }, { acknowledge: false });
  const ticketId = r?.id ?? null;
  if (ticketId) await db.update(T).set({ ticketId }).where(eq(T.id, t.id));
  if (userId) await audit({ orgId, actorId: userId, action: "mail.ticket_created", targetType: "mail_thread", targetId: t.id, metadata: { ticketId } });
  return { ticketId };
}
defineJob<{ threadId: string; kind: "contact" | "ticket" }>("mail.link", async ({ threadId, kind }) => {
  const [t] = await db.select({ orgId: T.orgId }).from(T).where(eq(T.id, threadId));
  return t ? linkThread(t.orgId, null, threadId, kind) : null;
});

// ── Senders and unsubscribe ─────────────────────────────────────────────────

export async function setSender(s: Scope, raw: unknown) {
  const v = check(z.object({ accountId: z.uuid(), address: z.email().transform((x) => x.toLowerCase()), verdict: z.enum(["allowed", "blocked", "vip"]).nullable() }), raw);
  await account(s, v.accountId);
  const S = schema.mailSenders;
  if (!v.verdict) await db.delete(S).where(and(eq(S.accountId, v.accountId), eq(S.address, v.address)));
  else await db.insert(S).values({ orgId: s.orgId, accountId: v.accountId, address: v.address, verdict: v.verdict }).onConflictDoUpdate({ target: [S.accountId, S.address], set: { verdict: v.verdict } });
  // The screener decision applies to what's already here.
  const from = sql`exists (select 1 from mail_messages x where x.thread_id = ${T.id} and x.from_address = ${v.address})`;
  if (v.verdict === "blocked") await db.update(T).set({ status: "spam" }).where(and(eq(T.accountId, v.accountId), from));
  if (v.verdict === "allowed" || v.verdict === "vip") await db.update(T).set({ category: "people", ...(v.verdict === "vip" ? { priority: "high" } : {}) }).where(and(eq(T.accountId, v.accountId), eq(T.category, "screener"), from));
  if (v.verdict === "vip") await db.update(T).set({ priority: "high" }).where(and(eq(T.accountId, v.accountId), from));
  return { ok: true };
}

type Fetch = typeof fetch;
// The unsubscribe URL comes from a (possibly hostile) sender's List-Unsubscribe
// header, so it's only ever posted to a public address (no internal SSRF).
const safeHttp: Fetch = async (u, init) => {
  const r = await safeRequest(String(u), { method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body as string, maxBytes: 4096, timeoutMs: 10_000 });
  return new Response(null, { status: r.status });
};
let http: Fetch = safeHttp;
export function setUnsubscribeHttp(f: Fetch | null) {
  http = f ?? safeHttp;
}

/** One-click unsubscribe (RFC 8058) when the sender supports it; otherwise the mailto or link to open. */
export async function unsubscribe(s: Scope, id: string) {
  const t = await threadFor(s, id);
  const [m] = await db.select().from(M).where(and(eq(M.threadId, t.id), sql`${M.listUnsubscribe} <> ''`)).orderBy(desc(M.date)).limit(1);
  const u = m ? unsubscribeOf(m.listUnsubscribe, m.listUnsubscribePost) : null;
  if (!u) throw new ApiError("conflict", "This sender didn't include a way to unsubscribe");
  let via: "one-click" | "mailto" | "link" = u.url ? "link" : "mailto";
  if (u.oneClick && u.url) {
    try {
      const r = await http(u.url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (r.status < 400) via = "one-click";
    } catch {
      /* fall back to the link */
    }
  }
  if (via === "one-click") await db.update(T).set({ status: "archived", labels: sql`array_append(array_remove(${T.labels}, 'Unsubscribed'), 'Unsubscribed')` }).where(eq(T.id, t.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "mail.unsubscribed", targetType: "mail_thread", targetId: t.id, metadata: { via, from: m!.fromAddress } });
  return { ok: via === "one-click", via, url: via === "mailto" ? u.mailto : via === "link" ? u.url : undefined };
}

// ── Viewing HTML safely, and attachments ────────────────────────────────────

/** The email's HTML as its own document: no scripts, no forms, remote images only when asked. */
export async function html(s: Scope, id: string, images: boolean) {
  const [m] = await db.select().from(M).where(and(eq(M.id, id), eq(M.orgId, s.orgId)));
  if (!m) throw notFound("Message");
  await threadFor(s, m.threadId);
  const files = await db.select({ id: schema.mailAttachments.id, cid: schema.mailAttachments.contentId }).from(schema.mailAttachments).where(eq(schema.mailAttachments.messageId, m.id));
  const origin = new URL(appUrl("/")).origin;
  let body = m.html !== null && m.html !== undefined ? neutralizeScriptUrls(m.html) : `<pre style="white-space:pre-wrap;font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif">${m.text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`;
  // Pictures sent inside the email (cid:) load from us.
  for (const f of files) if (f.cid) body = body.split(`cid:${f.cid}`).join(`${origin}/api/v1/orgs/${s.orgId}/mail/attachments/${f.id}`);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><meta name="referrer" content="no-referrer"><style>html{margin:0;padding:0;overflow-y:hidden;overflow-x:auto}body{margin:0;padding:14px 16px;background:#fff;color:#1d1d1f;font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}a{color:#0369a1}</style></head><body>${body}</body></html>`;
  // No scripts ever run (no allow-scripts, default-src 'none'); allow-same-origin only lets the
  // inbox measure the email's height so the frame fits it.
  const csp = ["default-src 'none'", "style-src 'unsafe-inline'", `img-src data: ${origin}${images ? " https: http:" : ""}`, "font-src data:", "form-action 'none'", "frame-ancestors 'self'", "base-uri 'none'", "sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox"].join("; ");
  return new Response(doc, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": csp, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "private, no-store" } });
}

/** The technical details of one message: IDs, size, folder and what the sender checks said. */
export async function messageDetails(s: Scope, id: string): Promise<MessageDetails> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Message");
  const [m] = await db.select().from(M).where(and(eq(M.id, id), eq(M.orgId, s.orgId)));
  if (!m) throw notFound("Message");
  await threadFor(s, m.threadId);
  const verdict = (k: string) => m.authResults.match(new RegExp(`\\b${k}=([a-z]+)`, "i"))?.[1]?.toLowerCase() ?? null;
  return {
    messageId: m.messageId, inReplyTo: m.inReplyTo, references: m.references.split(/\s+/).filter(Boolean), folder: m.folder, sizeBytes: m.sizeBytes, date: m.date.toISOString(), replyTo: m.replyTo,
    auth: { spf: verdict("spf"), dkim: verdict("dkim"), dmarc: verdict("dmarc"), raw: m.authResults }, listUnsubscribe: m.listUnsubscribe, auto: m.auto,
  };
}

export async function attachment(s: Scope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Attachment");
  const [a] = await db.select().from(schema.mailAttachments).where(and(eq(schema.mailAttachments.id, id), eq(schema.mailAttachments.orgId, s.orgId)));
  if (!a) throw notFound("Attachment");
  const [m] = await db.select({ threadId: M.threadId }).from(M).where(eq(M.id, a.messageId));
  await threadFor(s, m!.threadId);
  if (!a.data) throw new ApiError("conflict", "This file was too large to keep (over 15 MB) — open it in your mail provider");
  // Images and PDFs open in the browser; everything else downloads.
  const inline = /^image\/(png|jpe?g|gif|webp)$|^application\/pdf$/.test(a.mime);
  return new Response(new Uint8Array(a.data), { headers: { "content-type": inline ? a.mime : "application/octet-stream", "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=3600" } });
}

// ── Rules and templates ─────────────────────────────────────────────────────

const R = schema.mailRules;
const rulesFor = (s: Scope) => db.select().from(R).where(and(eq(R.orgId, s.orgId), eq(R.ownerId, s.userId))).orderBy(R.createdAt);
export const rules = async (s: Scope) => ({ rules: (await rulesFor(s)).map((r) => ({ id: r.id, name: r.name, accountId: r.accountId, match: r.match as "all" | "any", conditions: r.conditions, actions: r.actions, enabled: r.enabled, hits: r.hits })) });

export async function saveRule(s: Scope, id: string | null, raw: unknown) {
  const v = check(ruleSchema, raw);
  if (v.accountId) await account(s, v.accountId);
  if (id) {
    const [r] = await db.update(R).set({ name: v.name, accountId: v.accountId, match: v.match, conditions: v.conditions, actions: v.actions, enabled: v.enabled }).where(and(eq(R.id, id), eq(R.ownerId, s.userId))).returning();
    if (!r) throw notFound("Rule");
    return { rule: r };
  }
  const [r] = await db.insert(R).values({ orgId: s.orgId, ownerId: s.userId, ...v }).returning();
  return { rule: r };
}
export async function deleteRule(s: Scope, id: string) {
  const r = await db.delete(R).where(and(eq(R.id, id), eq(R.ownerId, s.userId))).returning({ id: R.id });
  if (!r.length) throw notFound("Rule");
}

const P = schema.mailTemplates;
export async function templates(s: Scope) {
  const rows = await db.select().from(P).where(and(eq(P.orgId, s.orgId), or(eq(P.ownerId, s.userId), eq(P.shared, true)))).orderBy(desc(P.uses), P.name);
  return { templates: rows.map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, shortcut: t.shortcut, shared: t.shared, mine: t.ownerId === s.userId, uses: t.uses })) };
}
export async function saveTemplate(s: Scope, id: string | null, raw: unknown) {
  const v = check(templateSchema, raw);
  if (v.shared && !s.manage) throw new ApiError("forbidden", "Only owners and admins can share templates with the team");
  if (id) {
    const [t] = await db.update(P).set(v).where(and(eq(P.id, id), eq(P.orgId, s.orgId), s.manage ? sql`true` : eq(P.ownerId, s.userId))).returning();
    if (!t) throw notFound("Template");
    return { template: t };
  }
  const [t] = await db.insert(P).values({ orgId: s.orgId, ownerId: s.userId, ...v }).returning();
  return { template: t };
}
export async function deleteTemplate(s: Scope, id: string) {
  const r = await db.delete(P).where(and(eq(P.id, id), eq(P.orgId, s.orgId), s.manage ? sql`true` : eq(P.ownerId, s.userId))).returning({ id: P.id });
  if (!r.length) throw notFound("Template");
}

/** Your templates from a spreadsheet (name, subject, body, shortcut); a template you already have with the same name is updated or skipped. */
export async function importTemplates(s: Scope, raw: unknown) {
  return runImport(target("mail.templates"), raw, async (v, mode) => {
    const shortcut = str(v.shortcut).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const t = check(templateSchema, { name: str(v.name), subject: str(v.subject), body: str(v.body), shortcut, shared: false });
    const [mine] = await db.select({ id: P.id }).from(P).where(and(eq(P.orgId, s.orgId), eq(P.ownerId, s.userId), sql`lower(${P.name}) = ${t.name.toLowerCase()}`)).limit(1);
    if (mine) {
      if (mode === "skip") return "skipped";
      await db.update(P).set({ subject: t.subject, body: t.body, shortcut: t.shortcut }).where(eq(P.id, mine.id));
      return "updated";
    }
    await db.insert(P).values({ orgId: s.orgId, ownerId: s.userId, ...t });
    return "created";
  });
}

/** The conversations in a view as CSV (subject, people, dates, category, labels). */
export async function exportCsv(s: Scope, q: Record<string, string>) {
  const out: ThreadRow[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 40; i++) {
    const r = await threads(s, { ...q, ...(cursor ? { cursor } : {}) });
    out.push(...r.threads);
    if (!r.next) break;
    cursor = r.next;
  }
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [["Subject", "With", "Last message", "Messages", "Unread", "Category", "Labels", "Status"], ...out.map((t) => [t.subject, t.participants.map((p) => p.address).join("; "), t.lastMessageAt, t.messageCount, t.unread, t.category, t.labels.join("; "), t.status])];
  return new Response(lines.map((l) => l.map(cell).join(",")).join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="mail.csv"' } });
}
