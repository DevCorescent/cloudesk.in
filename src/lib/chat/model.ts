// Team chat: what can be posted, and the rules shared by server and browser.
import { z } from "zod";

export const MAX_BODY = 8000;
export const MAX_FILE = 25 * 1024 * 1024;
export const ONLINE_MS = 2 * 60_000;
export const EDIT_WINDOW_MS = 24 * 3_600_000;
export const STATUSES = ["available", "busy", "dnd", "away"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { available: "Available", busy: "Busy", dnd: "Do not disturb", away: "Away" };
export const PRIORITIES = ["normal", "important", "urgent"] as const;
export const CHANNEL_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#0891b2", "#475569"];
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"];

const name = z.string().trim().min(1, "Name it").max(60).regex(/^[^#@<>]+$/, "No #, @, < or >");
export const channelSchema = z.object({
  name,
  topic: z.string().trim().max(250).default(""),
  description: z.string().trim().max(1000).default(""),
  visibility: z.enum(["public", "private"]).default("public"),
  emoji: z.string().max(16).default(""),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2563eb"),
  posting: z.enum(["everyone", "admins"]).default("everyone"),
  ai: z.boolean().default(true),
  members: z.array(z.uuid()).max(500).default([]),
});
export const channelPatchSchema = channelSchema.omit({ members: true }).partial().extend({ archived: z.boolean().optional(), /** An uploaded image to use as its picture, or null to remove it. */ avatarFileId: z.uuid().nullable().optional() });
export const groupSchema = z.object({ users: z.array(z.uuid()).min(1, "Pick someone").max(49), name: z.string().trim().max(60).default("") });

const recordRef = z.object({ kind: z.string().regex(/^[a-z0-9_-]{1,40}$/), id: z.string().regex(/^[\w-]{1,80}$/), label: z.string().trim().min(1).max(120), link: z.string().max(400) });
const optionId = z.string().regex(/^[\w-]{1,24}$/);

export const pollSchema = z.object({ question: z.string().trim().min(1, "Ask something").max(300), options: z.array(z.object({ id: optionId, label: z.string().trim().min(1).max(120) })).min(2, "At least two choices").max(12), multi: z.boolean().default(false), anonymous: z.boolean().default(false), closesAt: z.iso.datetime({ offset: true }).nullable().default(null) });
export const checklistSchema = z.object({ title: z.string().trim().min(1).max(200), items: z.array(z.object({ id: optionId, label: z.string().trim().min(1).max(200) })).min(1).max(40) });
export const decisionSchema = z.object({ text: z.string().trim().min(1, "What's being decided?").max(1000) });
export const approvalSchema = z.object({ title: z.string().trim().min(1, "What needs approving?").max(300), details: z.string().trim().max(2000).default(""), approvers: z.array(z.uuid()).min(1, "Pick who approves").max(10), amount: z.string().trim().max(40).default("") });
export const recordCardSchema = z.object({ kind: z.string().regex(/^[a-z0-9_-]{1,40}$/), id: z.string().max(80).default(""), title: z.string().trim().min(1).max(200), sub: z.string().trim().max(300).default(""), link: z.string().max(400).default(""), module: z.string().max(40).default(""), fields: z.array(z.object({ label: z.string().trim().max(60), value: z.string().trim().max(200) })).max(12).default([]) });
export const callSchema = z.object({ title: z.string().trim().max(200).default("") });
export const eventSchema = z.object({ title: z.string().trim().min(1).max(200), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }), meetingUrl: z.string().trim().max(500).regex(/^(https?:\/\/\S+)?$/i, "Use an http(s) meeting link").default("") });

export const postSchema = z.object({
  body: z.string().max(MAX_BODY).default(""),
  parentId: z.uuid().nullable().default(null),
  priority: z.enum(PRIORITIES).default("normal"),
  records: z.array(recordRef).max(20).default([]),
  files: z.array(z.uuid()).max(10).default([]),
  scheduledFor: z.iso.datetime({ offset: true }).nullable().default(null),
  /** Also post a thread reply to the channel. */
  alsoToChannel: z.boolean().default(false),
  poll: pollSchema.optional(),
  checklist: checklistSchema.optional(),
  decision: decisionSchema.optional(),
  approval: approvalSchema.optional(),
  record: recordCardSchema.optional(),
  call: callSchema.optional(),
  event: eventSchema.optional(),
});
export type PostIn = z.input<typeof postSchema>;

export const editSchema = z.object({ body: z.string().trim().min(1).max(MAX_BODY), records: z.array(recordRef).max(20).default([]) });
export const voteSchema = z.object({ choice: z.string().regex(/^[\w-]{1,24}$/), on: z.boolean().default(true), note: z.string().trim().max(500).default("") });
export const presenceSchema = z.object({ status: z.enum(STATUSES), note: z.string().trim().max(100).default(""), emoji: z.string().max(16).default(""), until: z.iso.datetime({ offset: true }).nullable().default(null) });

/** A link inside the app (never another site): records shared in chat point here. */
export const safeLink = (l: string) => (/^\/(?!\/)[\w\-./?=&%#:+~]*$/.test(l) ? l : "");

/** DMs are one per pair. */
export const dmKey = (a: string, b: string) => [a, b].sort().join(":");

/** Slash commands the composer understands. */
export const COMMANDS = [
  { cmd: "poll", hint: "Question | choice | choice", label: "Start a poll" },
  { cmd: "checklist", hint: "Title | item | item", label: "Shared checklist" },
  { cmd: "decide", hint: "What's being decided", label: "Propose a decision" },
  { cmd: "approve", hint: "What needs approving", label: "Ask for approval" },
  { cmd: "task", hint: "What needs doing", label: "Make a task" },
  { cmd: "call", hint: "Title (optional)", label: "Start a video call" },
  { cmd: "meet", hint: "Title", label: "Schedule a meeting" },
  { cmd: "remind", hint: "in 30m / tomorrow 9am", label: "Remind me about this conversation" },
  { cmd: "status", hint: "busy | dnd | away | available [note]", label: "Set your status" },
  { cmd: "summary", hint: "", label: "Catch me up (AI)" },
  { cmd: "shrug", hint: "", label: "¯\\_(ツ)_/¯" },
] as const;

/** "/poll Lunch? | Pizza | Thali" → parts. */
export const pipeParts = (s: string) => s.split("|").map((x) => x.trim()).filter(Boolean);

/** "in 30m", "in 2h", "in 3d", "tomorrow", "tomorrow 9am", "monday", "5pm" → a time, or null. */
export function parseWhen(s: string, now = new Date()): Date | null {
  const t = s.trim().toLowerCase();
  const rel = /^in\s+(\d{1,3})\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)$/.exec(t);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]![0];
    return new Date(now.getTime() + n * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000));
  }
  const at = (d: Date, time?: string) => {
    const m = time ? /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(time.trim()) : null;
    let h = 9;
    let min = 0;
    if (m) {
      h = Number(m[1]);
      min = Number(m[2] ?? 0);
      if (m[3] === "pm" && h < 12) h += 12;
      if (m[3] === "am" && h === 12) h = 0;
      if (h > 23 || min > 59) return null;
    } else if (time) return null;
    const r = new Date(d);
    r.setHours(h, min, 0, 0);
    return r;
  };
  const tm = /^tomorrow(?:\s+(?:at\s+)?(.+))?$/.exec(t);
  if (tm) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return at(d, tm[1]);
  }
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dw = /^(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(?:at\s+)?(.+))?$/.exec(t);
  if (dw) {
    const d = new Date(now);
    const diff = (days.indexOf(dw[1]!) - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return at(d, dw[2]);
  }
  const only = /^(?:today\s+)?(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/.exec(t);
  if (only && /am|pm|:/.test(only[1]!)) {
    const r = at(now, only[1]);
    if (r && r.getTime() <= now.getTime()) r.setDate(r.getDate() + 1);
    return r;
  }
  return null;
}
