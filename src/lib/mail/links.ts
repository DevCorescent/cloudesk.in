// Turning an email into a note: the parts worth keeping (what was written —
// not the quoted history, the signature or the "On … wrote:" line), as note
// blocks: paragraphs, lists, a card back to the email, its attachments.
import { z } from "zod";
import { block, type Block } from "@/lib/notes/blocks";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const toNoteSchema = z.object({
  /** A new note, or added to the end of one you can edit. */
  mode: z.enum(["new", "append"]).default("new"),
  noteId: z.uuid().optional(),
  /** The whole conversation, the latest message, one message, or an AI summary with its to-dos. */
  what: z.enum(["all", "latest", "message", "summary"]).default("all"),
  messageId: z.uuid().optional(),
  title: z.string().trim().max(300).default(""),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
  attachments: z.boolean().default(true),
  /** Remind me about the note (new notes only). */
  remindAt: z.iso.datetime({ offset: true }).nullable().default(null),
  /** A line of your own at the top. */
  comment: z.string().trim().max(2000).default(""),
}).refine((v) => v.mode === "new" || !!v.noteId, { message: "Pick the note to add it to", path: ["noteId"] })
  .refine((v) => v.what !== "message" || !!v.messageId, { message: "Which message?", path: ["messageId"] });

const person = z.object({ name: z.string().trim().max(120).default(""), email: z.string().trim().toLowerCase().email() });
export const toEventSchema = z.object({
  /** A meeting with people, or time blocked out to deal with the email. */
  kind: z.enum(["meeting", "focus"]).default("meeting"),
  title: z.string().trim().min(1, "Give it a title").max(200),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  allDay: z.boolean().default(false),
  tz: z.string().trim().max(64).default("Asia/Kolkata"),
  calendarId: z.uuid().optional(),
  attendees: z.array(person).max(50).default([]),
  meetingUrl: z.string().trim().max(500).regex(/^(https:\/\/\S+)?$/, "Use an https:// link").default(""),
  reminders: z.array(z.number().int().min(0).max(10080)).max(8).default([10]),
  /** Email the invite from this mailbox (meetings with people). */
  invite: z.boolean().default(false),
  description: z.string().max(5000).default(""),
}).refine((v) => Date.parse(v.end) > Date.parse(v.start), { message: "It has to end after it starts", path: ["end"] });

export const toTaskSchema = z.object({
  projectId: z.uuid({ message: "Pick a project" }),
  title: z.string().trim().min(1, "Give the task a title").max(300),
  assigneeId: z.uuid().nullable().default(null),
  dueDate: day.nullable().default(null),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  /** Put the email (who, when, what) in the task's description. */
  includeEmail: z.boolean().default(true),
});

export const chatLinkSchema = z.object({ messageId: z.uuid(), channelId: z.uuid(), where: z.string().trim().max(120).default("") });

/**
 * What someone actually wrote: no quoted history ("> …", "On … wrote:", Outlook's
 * "-----Original Message-----" / "From: … Sent: …"), no signature after "-- ".
 */
export function writtenPart(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^-- ?$/.test(l)) break;
    if (/^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}/i.test(l)) break;
    if (/^On .{4,200}(wrote|écrit|schrieb):\s*$/i.test(l) || (/^On .{4,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? ""))) break;
    if (/^From:\s.+/i.test(l) && /^(Sent|Date):\s.+/i.test(lines[i + 1] ?? "")) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Plain email text as note blocks: paragraphs, bulleted and numbered lists. */
export function textToBlocks(text: string, max = 300): Block[] {
  const blocks: Block[] = [];
  const bullet = /^\s*[-*•]\s+/;
  const numbered = /^\s*\d{1,3}[.)]\s+/;
  for (const para of writtenPart(text).split(/\n{2,}/)) {
    // A paragraph can mix a line of text with a list under it ("We agreed:\n- one\n- two").
    let run: string[] = [];
    const flush = () => {
      if (run.length) blocks.push(block("p", run.join("\n").slice(0, 8000)));
      run = [];
    };
    for (const l of para.split("\n")) {
      if (!l.trim()) continue;
      if (bullet.test(l)) {
        flush();
        blocks.push(block("bullet", l.replace(bullet, "").slice(0, 4000)));
      } else if (numbered.test(l)) {
        flush();
        blocks.push(block("number", l.replace(numbered, "").slice(0, 4000)));
      } else run.push(l);
    }
    flush();
    if (blocks.length >= max) break;
  }
  return blocks.slice(0, max);
}

export type EmailForNote = { id: string; fromName: string; fromAddress: string; date: string; text: string; attachments: { id: string; filename: string }[] };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The note's blocks: a card back to the email, then each message (or the summary and its to-dos). */
export function emailBlocks(v: { orgId: string; threadId: string; subject: string; messages: EmailForNote[]; attachments: boolean; comment?: string; summary?: string; actions?: { text: string }[] }): Block[] {
  const first = v.messages[0];
  const out: Block[] = [];
  if (v.comment) out.push(block("p", v.comment));
  out.push(block("record", v.subject || "(no subject)", { url: `/mail/t/${v.threadId}`, module: "Email", sub: first ? `${first.fromName || first.fromAddress} · ${when(first.date)}${v.messages.length > 1 ? ` · ${v.messages.length} messages` : ""}` : "" }));
  if (v.summary !== undefined) {
    out.push(block("h3", "Summary"));
    out.push(...textToBlocks(v.summary, 60));
    if (v.actions?.length) {
      out.push(block("h3", "To do"));
      v.actions.slice(0, 30).forEach((a) => out.push(block("todo", a.text.slice(0, 500), { checked: false })));
    }
  } else {
    for (const m of v.messages) {
      if (v.messages.length > 1) out.push(block("h3", `${m.fromName || m.fromAddress} · ${when(m.date)}`));
      const body = textToBlocks(m.text, 300);
      out.push(...(body.length ? body : [block("p", "(no text)")]));
    }
  }
  const files = v.attachments ? v.messages.flatMap((m) => m.attachments) : [];
  if (files.length) {
    out.push(block("h3", "Attachments"));
    files.slice(0, 30).forEach((f) => out.push(block("bullet", `[${f.filename.replace(/[[\]()]/g, "")}](/api/v1/orgs/${v.orgId}/mail/attachments/${f.id})`)));
  }
  return out.slice(0, 1500);
}
