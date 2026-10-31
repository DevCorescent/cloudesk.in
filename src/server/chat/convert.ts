// From a conversation into the rest of Cloudesk: a message (or an AI action
// item) becomes a task in Projects, a meeting card goes into your calendar.
// Each goes through that module's own rules and permissions, as you.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { plain } from "@/lib/chat/text";
import { calScope, defaultCalendar } from "../calendar/access";
import { createEvent } from "../calendar/core";
import { ApiError } from "../http/errors";
import { scope as workScope } from "../work/access";
import { listProjects } from "../work/projects";
import { saveTask } from "../work/tasks";
import { channelFor, check, messageFor, type ChatScope } from "./access";
import { afterPost } from "./core";

const taskIn = z.object({
  projectId: z.uuid(),
  items: z.array(z.object({ title: z.string().trim().min(1).max(300), assigneeId: z.uuid().nullable().default(null), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) })).min(1).max(20),
  /** The message the tasks come from (linked in their description, and replied to). */
  messageId: z.uuid().nullable().default(null),
});

/** Projects you can add tasks to. */
export async function taskTargets(s: ChatScope) {
  if (!s.has("work")) return { projects: [], available: false };
  const ws = await workScope(s.ctx, s.orgId);
  if (!ws.write) return { projects: [], available: false };
  const rows = (await listProjects(ws, { status: "open" })) as unknown as { id: string; name: string; code: string }[];
  return { projects: rows.map((p) => ({ id: p.id, name: p.name, code: p.code })), available: true };
}

export async function makeTasks(s: ChatScope, raw: unknown) {
  if (!s.has("work")) throw new ApiError("forbidden", "Projects & timesheets isn't on in this workspace");
  const v = check(taskIn, raw);
  const ws = await workScope(s.ctx, s.orgId);
  const src = v.messageId ? await messageFor(s, v.messageId, "read") : null;
  const from = src ? `\n\nFrom Chat: /chat/${src.c.id}?m=${src.msg.id}${src.msg.body ? `\n> ${plain(src.msg.body).slice(0, 1500).replace(/\n/g, "\n> ")}` : ""}` : "";
  const made: { id: string; title: string; number: number }[] = [];
  for (const it of v.items) {
    const t = await saveTask(ws, null, { projectId: v.projectId, title: it.title, description: `Made from a chat message.${from}`, assigneeId: it.assigneeId, dueDate: it.dueDate });
    made.push({ id: t.id, title: t.title, number: t.number });
  }
  // Say so in the thread, so everyone sees it's being handled — only where this person may post.
  const canPost = src ? await channelFor(s, src.c.id, "post").then(() => true, () => false) : false;
  if (src && canPost && !src.msg.deletedAt) {
    const parent = src.msg.parentId ? ((await db.select().from(schema.teamMessages).where(eq(schema.teamMessages.id, src.msg.parentId)))[0] ?? src.msg) : src.msg;
    const body = `${made.length === 1 ? "Made a task" : `Made ${made.length} tasks`}: ${made.map((t) => `[${t.title}](/work/tasks/${t.id})`).join(", ")}`;
    const [m] = await db.insert(schema.teamMessages).values({ orgId: s.orgId, channelId: src.c.id, parentId: parent.id, authorId: s.userId, kind: "system", body, data: { tasks: made } }).returning();
    await afterPost(s, src.c, m!, parent);
  }
  return { tasks: made };
}

/** A meeting card → an event in your own calendar (with the call link and the people in it). */
export async function addToCalendar(s: ChatScope, messageId: string) {
  if (!s.has("calendar")) throw new ApiError("forbidden", "Calendar isn't on in this workspace");
  const { msg, c } = await messageFor(s, messageId, "read");
  if (msg.kind !== "event") throw new ApiError("conflict", "Not a meeting");
  const d = msg.data as { title: string; start: string; end: string; meetingUrl?: string };
  const cs = await calScope(s.ctx, s.orgId);
  const cal = await defaultCalendar(s.orgId, s.userId);
  const [author] = msg.authorId ? await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, msg.authorId)) : [];
  const r = await createEvent(cs, { calendarId: cal.id, title: d.title, start: d.start, end: d.end, meetingUrl: d.meetingUrl ?? "", description: `From ${c.kind === "channel" ? `#${c.name}` : "a chat"} in Cloudesk Chat.`, attendees: author && msg.authorId !== s.userId ? [{ name: author.name, email: author.email }] : [], sendInvite: false }, null);
  await db.insert(schema.teamVotes).values({ messageId: msg.id, userId: s.userId, choice: "going" }).onConflictDoNothing();
  return { event: { id: r.event.id } };
}
