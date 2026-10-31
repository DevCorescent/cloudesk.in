// An email into the rest of Cloudesk: a note (new, or added to one), a
// calendar event (a meeting with its people, or time to deal with it), a
// task, a chat message. Each goes through that module's own rules, as you,
// links back to the email, and is listed on the email under "Connected" —
// together with notes attached to it and events made from its invites.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ConnectionOut, LinkTargetsOut } from "@/lib/mail/api";
import { chatLinkSchema, emailBlocks, toEventSchema, toNoteSchema, toTaskSchema, writtenPart, type EmailForNote } from "@/lib/mail/links";
import { hasLlm } from "../ai/gateway";
import { calScope, calendarsOf, defaultCalendar } from "../calendar/access";
import { createEvent } from "../calendar/core";
import { ApiError, notFound } from "../http/errors";
import type { AuthedContext } from "../http/handler";
import * as notes from "../notes/core";
import { scope as workScope } from "../work/access";
import { listProjects } from "../work/projects";
import { saveTask } from "../work/tasks";
import { check, thread as threadFor, type Scope } from "./access";
import { threadAi } from "./ai";

const L = schema.mailLinks;
const M = schema.mailMessages;
const N = schema.notes;
const E = schema.calEvents;
const isUuid = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const href = (threadId: string) => `/mail/t/${threadId}`;

async function remember(s: Scope, threadId: string, kind: "note" | "event" | "chat" | "task", targetId: string, label: string, link: string, messageId: string | null = null) {
  await db.insert(L).values({ orgId: s.orgId, threadId, messageId, kind, targetId, label: label.slice(0, 200), href: link, createdBy: s.userId }).onConflictDoUpdate({ target: [L.threadId, L.kind, L.targetId], set: { label: label.slice(0, 200), href: link } });
}

/** The conversation's messages (sent or received — not drafts waiting to go) with their attachments. */
async function messagesOf(threadId: string): Promise<EmailForNote[]> {
  const rows = await db.select({ id: M.id, fromName: M.fromName, fromAddress: M.fromAddress, date: M.date, text: M.text }).from(M).where(and(eq(M.threadId, threadId), sql`coalesce(${M.sendStatus}, 'sent') = 'sent'`)).orderBy(M.date);
  const files = rows.length ? await db.select({ id: schema.mailAttachments.id, messageId: schema.mailAttachments.messageId, filename: schema.mailAttachments.filename }).from(schema.mailAttachments).where(inArray(schema.mailAttachments.messageId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ id: r.id, fromName: r.fromName, fromAddress: r.fromAddress, date: r.date.toISOString(), text: r.text, attachments: files.filter((f) => f.messageId === r.id && !/\.ics$/i.test(f.filename)).map((f) => ({ id: f.id, filename: f.filename })) }));
}

// ── What can be made ────────────────────────────────────────────────────────

export async function linkTargets(s: Scope, ctx: AuthedContext): Promise<LinkTargetsOut> {
  const calendars = s.has("calendar") ? (await calendarsOf(s.orgId, s.userId)).map((c) => ({ id: c.id, name: c.name, color: c.color, isDefault: c.isDefault })) : null;
  let projects: LinkTargetsOut["projects"] = null;
  if (s.has("work")) {
    try {
      const ws = await workScope(ctx, s.orgId);
      if (ws.write) projects = ((await listProjects(ws, { status: "open" })) as unknown as { id: string; name: string; code: string }[]).map((p) => ({ id: p.id, name: p.name, code: p.code }));
    } catch {
      projects = null;
    }
  }
  return { calendars, projects, chat: s.has("chat"), ai: await hasLlm(s.orgId) };
}

// ── Notes ───────────────────────────────────────────────────────────────────

export async function toNote(s: Scope, threadId: string, raw: unknown) {
  const t = await threadFor(s, threadId);
  const v = check(toNoteSchema, raw);
  const all = await messagesOf(t.id);
  if (!all.length) throw new ApiError("conflict", "There's nothing in this conversation yet");
  const picked = v.what === "latest" ? [all.at(-1)!] : v.what === "message" ? all.filter((m) => m.id === v.messageId) : all;
  if (!picked.length) throw notFound("Message");
  let summary: string | undefined;
  let actions: { text: string }[] | undefined;
  if (v.what === "summary") {
    const sum = await threadAi(s, t.id, { kind: "summary" });
    const act = await threadAi(s, t.id, { kind: "actions" }).catch(() => ({ actions: [] as { text: string }[] }));
    summary = sum.summary ?? "";
    actions = (act.actions ?? []).map((a) => ({ text: a.text }));
  }
  const blocks = emailBlocks({ orgId: s.orgId, threadId: t.id, subject: t.subject, messages: v.what === "summary" ? all : picked, attachments: v.attachments, comment: v.comment, summary, actions });
  const w = { orgId: s.orgId, userId: s.userId };
  let note: { id: string; title: string };
  if (v.mode === "append") {
    const cur = (await notes.get(w, v.noteId!)) as unknown as { id: string; title: string; content: { blocks: unknown[] }; version: number; access?: string };
    const merged = { blocks: [...(cur.content.blocks as never[]), { id: crypto.randomUUID().slice(0, 12), type: "divider", text: "" }, ...blocks] };
    const u = (await notes.update(w, cur.id, { content: merged, baseVersion: cur.version })) as unknown as { id: string; title: string };
    note = { id: u.id, title: u.title };
  } else {
    const n = (await notes.create(w, { title: (v.title || t.subject || "Email").slice(0, 300), icon: "✉️", content: { blocks }, tags: v.tags, attached: { module: "mail", href: href(t.id), label: (t.subject || "Email").slice(0, 200) } })) as unknown as { id: string; title: string };
    if (v.remindAt) await notes.update(w, n.id, { remindAt: new Date(v.remindAt).toISOString() });
    note = { id: n.id, title: n.title };
  }
  await remember(s, t.id, "note", note.id, note.title || "Untitled note", `/notes/${note.id}`, v.what === "message" ? (v.messageId ?? null) : null);
  return { note };
}

// ── Calendar ────────────────────────────────────────────────────────────────

export async function toEvent(s: Scope, ctx: AuthedContext, threadId: string, raw: unknown) {
  if (!s.has("calendar")) throw new ApiError("forbidden", "Calendar isn't on in this workspace");
  const t = await threadFor(s, threadId);
  const v = check(toEventSchema, raw);
  const cs = await calScope(ctx, s.orgId);
  const calendarId = v.calendarId ?? (await defaultCalendar(s.orgId, s.userId)).id;
  const last = (await messagesOf(t.id)).at(-1);
  const excerpt = last ? writtenPart(last.text).slice(0, 1200) : "";
  const description = [v.description, v.kind === "focus" ? "Time set aside to deal with this email." : "", `From the email “${t.subject || "(no subject)"}”${last ? ` — ${last.fromName || last.fromAddress}` : ""}.`, excerpt && `> ${excerpt.replace(/\n/g, "\n> ")}`].filter(Boolean).join("\n\n");
  const meeting = v.kind === "meeting";
  const r = await createEvent(cs, { calendarId, title: v.title, description: description.slice(0, 10_000), meetingUrl: meeting ? v.meetingUrl : "", start: v.start, end: v.end, allDay: v.allDay, tz: v.tz, attendees: meeting ? v.attendees : [], reminders: v.reminders, sendInvite: meeting && v.invite && v.attendees.length > 0, accountId: t.accountId }, s);
  // The event knows its email: "Open the email" in the calendar, minutes sent as a reply.
  await db.update(E).set({ mailThreadId: t.id, mailAccountId: t.accountId }).where(eq(E.id, r.event.id));
  await remember(s, t.id, "event", r.event.id, v.title, `/calendar?event=${r.event.id}`);
  return { event: { id: r.event.id, title: v.title, start: v.start } };
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function toTask(s: Scope, ctx: AuthedContext, threadId: string, raw: unknown) {
  if (!s.has("work")) throw new ApiError("forbidden", "Projects & timesheets isn't on in this workspace");
  const t = await threadFor(s, threadId);
  const v = check(toTaskSchema, raw);
  const ws = await workScope(ctx, s.orgId);
  const last = (await messagesOf(t.id)).at(-1);
  const from = last ? `${last.fromName ? `${last.fromName} <${last.fromAddress}>` : last.fromAddress}, ${new Date(last.date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}` : "";
  const description = v.includeEmail
    ? [`From the email “${t.subject || "(no subject)"}”${from ? ` — ${from}` : ""}.`, `Open it: ${href(t.id)}`, last ? `> ${writtenPart(last.text).slice(0, 3000).replace(/\n/g, "\n> ")}` : ""].filter(Boolean).join("\n\n")
    : `From an email: ${href(t.id)}`;
  const task = (await saveTask(ws, null, { projectId: v.projectId, title: v.title, description, assigneeId: v.assigneeId, dueDate: v.dueDate, priority: v.priority })) as unknown as { id: string; title: string; number: number };
  await remember(s, t.id, "task", task.id, `#${task.number} ${task.title}`, `/work/tasks/${task.id}`);
  return { task: { id: task.id, title: task.title, number: task.number } };
}

// ── Chat (the browser posts through Chat's own API, then tells us where) ────

export async function chatLink(s: Scope, threadId: string, raw: unknown) {
  const t = await threadFor(s, threadId);
  const v = check(chatLinkSchema, raw);
  const [m] = await db.select({ id: schema.teamMessages.id, authorId: schema.teamMessages.authorId, channelId: schema.teamMessages.channelId }).from(schema.teamMessages).where(and(eq(schema.teamMessages.id, v.messageId), eq(schema.teamMessages.orgId, s.orgId)));
  if (!m || m.authorId !== s.userId || m.channelId !== v.channelId) throw notFound("Chat message");
  await remember(s, t.id, "chat", m.id, v.where || "Chat", `/chat/${m.channelId}?m=${m.id}`);
  return { ok: true };
}

export async function unlink(s: Scope, threadId: string, linkId: string) {
  const t = await threadFor(s, threadId);
  if (!isUuid(linkId)) throw notFound("Link");
  await db.delete(L).where(and(eq(L.id, linkId), eq(L.threadId, t.id), eq(L.orgId, s.orgId)));
  return { ok: true };
}

// ── Everything connected to the conversation ───────────────────────────────

export async function connections(s: Scope, threadId: string): Promise<{ items: ConnectionOut[] }> {
  const t = await threadFor(s, threadId);
  const links = await db.select().from(L).where(eq(L.threadId, t.id)).orderBy(L.createdAt);
  const ids = (k: string) => links.filter((l) => l.kind === k).map((l) => l.targetId);
  const linkOf = (k: string, id: string) => links.find((l) => l.kind === k && l.targetId === id);
  const names = new Map((await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [...new Set(links.map((l) => l.createdBy).filter((x): x is string => !!x)), "00000000-0000-0000-0000-000000000000"]))).map((u) => [u.id, u.name]));
  const items: ConnectionOut[] = [];
  const gone: string[] = [];

  // Notes: made from it, or attached to it from "Notes on this page" — the ones you can read.
  const noteIds = ids("note");
  const nrows = await db
    .select({ id: N.id, title: N.title, ownerId: N.ownerId, visibility: N.visibility, updatedAt: N.updatedAt, deletedAt: N.deletedAt, words: N.words })
    .from(N)
    .where(and(eq(N.orgId, s.orgId), or(noteIds.length ? inArray(N.id, noteIds) : sql`false`, sql`${N.attached}->>'href' = ${href(t.id)}`)));
  for (const n of nrows) {
    if (n.deletedAt) {
      if (linkOf("note", n.id)) gone.push(linkOf("note", n.id)!.id);
      continue;
    }
    const shared = n.ownerId === s.userId || n.visibility !== "private" || (await db.select({ u: schema.noteShares.userId }).from(schema.noteShares).where(and(eq(schema.noteShares.noteId, n.id), eq(schema.noteShares.userId, s.userId)))).length > 0;
    if (!shared) continue;
    const l = linkOf("note", n.id);
    items.push({ id: l?.id ?? null, kind: "note", targetId: n.id, title: n.title || "Untitled note", sub: `${n.words} words · updated ${n.updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`, href: `/notes/${n.id}`, at: (l?.createdAt ?? n.updatedAt).toISOString(), by: l?.createdBy ? (names.get(l.createdBy) ?? null) : null });
  }
  for (const id of noteIds) if (!nrows.some((n) => n.id === id)) gone.push(linkOf("note", id)!.id);

  // Events: made from it, or from its invite — calendars are personal, so only yours.
  const eventIds = [...new Set([...ids("event"), ...(t.meetingEventId ? [t.meetingEventId] : [])])];
  const erows = await db.select({ id: E.id, title: E.title, startsAt: E.startsAt, ownerId: E.ownerId, status: E.status, repeat: E.repeat }).from(E).where(and(eq(E.orgId, s.orgId), eq(E.ownerId, s.userId), or(eventIds.length ? inArray(E.id, eventIds) : sql`false`, eq(E.mailThreadId, t.id))));
  for (const e of erows) {
    const l = linkOf("event", e.id);
    items.push({ id: l?.id ?? null, kind: "event", targetId: e.id, title: e.title, sub: `${e.repeat ? "Repeats · " : ""}${e.startsAt.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}${e.status === "cancelled" ? " · cancelled" : ""}`, href: `/calendar?event=${e.id}`, at: (l?.createdAt ?? e.startsAt).toISOString(), by: l?.createdBy ? (names.get(l.createdBy) ?? null) : null });
  }
  for (const id of ids("event")) {
    const [still] = await db.select({ id: E.id }).from(E).where(eq(E.id, id));
    if (!still) gone.push(linkOf("event", id)!.id);
  }

  // Tasks.
  const taskIds = ids("task");
  const trows = taskIds.length ? await db.select({ id: schema.workTasks.id, title: schema.workTasks.title, number: schema.workTasks.number, status: schema.workTasks.status, dueDate: schema.workTasks.dueDate }).from(schema.workTasks).where(and(eq(schema.workTasks.orgId, s.orgId), inArray(schema.workTasks.id, taskIds))) : [];
  for (const id of taskIds) {
    const tk = trows.find((x) => x.id === id);
    const l = linkOf("task", id)!;
    if (!tk) {
      gone.push(l.id);
      continue;
    }
    items.push({ id: l.id, kind: "task", targetId: id, title: `#${tk.number} ${tk.title}`, sub: `${String(tk.status).replace(/_/g, " ")}${tk.dueDate ? ` · due ${new Date(`${tk.dueDate}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}`, href: `/work/tasks/${id}`, at: l.createdAt.toISOString(), by: l.createdBy ? (names.get(l.createdBy) ?? null) : null });
  }

  // Chat messages (opening one goes through Chat's own checks).
  const chatIds = ids("chat");
  const crows = chatIds.length ? await db.select({ id: schema.teamMessages.id, deletedAt: schema.teamMessages.deletedAt, replyCount: schema.teamMessages.replyCount }).from(schema.teamMessages).where(and(inArray(schema.teamMessages.id, chatIds), isNull(schema.teamMessages.deletedAt))) : [];
  for (const id of chatIds) {
    const c = crows.find((x) => x.id === id);
    const l = linkOf("chat", id)!;
    if (!c) {
      gone.push(l.id);
      continue;
    }
    items.push({ id: l.id, kind: "chat", targetId: id, title: `Shared in ${l.label}`, sub: c.replyCount ? `${c.replyCount} ${c.replyCount === 1 ? "reply" : "replies"}` : "No replies yet", href: l.href, at: l.createdAt.toISOString(), by: l.createdBy ? (names.get(l.createdBy) ?? null) : null });
  }

  if (gone.length) await db.delete(L).where(inArray(L.id, gone));
  return { items: items.sort((a, b) => b.at.localeCompare(a.at)) };
}
