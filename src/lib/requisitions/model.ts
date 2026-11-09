// Requisitions: the things a client owes you (documents, details, signatures),
// asked for once and then chased by email on a schedule until everything
// required is in. Shared by the server and the browser: statuses, the
// schedule arithmetic, the emails' wording, and the plain matching used when
// AI isn't available to read a reply.
import { z } from "zod";

export const LIST_STATUSES = ["draft", "active", "paused", "completed", "cancelled"] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];
export const LIST_LABEL: Record<ListStatus, string> = { draft: "Draft", active: "Chasing", paused: "Paused", completed: "Complete", cancelled: "Cancelled" };

export const ITEM_STATUSES = ["pending", "received", "review", "rejected", "waived"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_LABEL: Record<ItemStatus, string> = { pending: "Waiting", received: "Received", review: "Check this", rejected: "Asked again", waived: "Not needed" };
/** Still owed by the client. */
export const OWED: ItemStatus[] = ["pending", "rejected"];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 10:30");

/** How often to ask, when, and when to stop. Times are India time. */
export const scheduleSchema = z.object({
  everyDays: z.number().int().min(1).max(30).default(3),
  at: time.default("10:30"),
  weekdaysOnly: z.boolean().default(true),
  maxReminders: z.number().int().min(1).max(30).default(8),
  /** After the client replies, hold reminders this many days (they may be getting things together). */
  quietAfterReply: z.number().int().min(0).max(14).default(2),
  /** Reminders get firmer as they go (friendly → polite → final). */
  escalate: z.boolean().default(true),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const PRESETS: { id: string; label: string; sub: string; schedule: Schedule }[] = [
  { id: "gentle", label: "Gentle", sub: "Every 4 days, up to 6 reminders", schedule: { everyDays: 4, at: "10:30", weekdaysOnly: true, maxReminders: 6, quietAfterReply: 3, escalate: true } },
  { id: "standard", label: "Standard", sub: "Every 2 days, up to 10 reminders", schedule: { everyDays: 2, at: "10:30", weekdaysOnly: true, maxReminders: 10, quietAfterReply: 2, escalate: true } },
  { id: "firm", label: "Firm", sub: "Every day, up to 14 reminders", schedule: { everyDays: 1, at: "10:00", weekdaysOnly: true, maxReminders: 14, quietAfterReply: 1, escalate: true } },
];

const email = z.email("Enter a valid email").transform((x) => x.trim().toLowerCase());
const itemInput = z.object({ title: z.string().trim().min(1, "Name the item").max(200), description: z.string().trim().max(1000).default(""), required: z.boolean().default(true) });

export const listSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  message: z.string().trim().max(4000).default(""),
  clientName: z.string().trim().max(200).default(""),
  clientEmail: email,
  cc: z.array(email).max(10).default([]),
  contactId: z.uuid().nullable().default(null),
  companyId: z.uuid().nullable().default(null),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  items: z.array(itemInput).min(1, "Add at least one item").max(100),
  schedule: scheduleSchema.default(PRESETS[1]!.schedule),
  mailAccountId: z.uuid().nullable().default(null),
  ownerId: z.uuid().nullable().default(null),
  /** Send the request now (true) or keep it as a draft. */
  send: z.boolean().default(true),
});
export type ListInput = z.input<typeof listSchema>;

export const updateSchema = listSchema.omit({ items: true, send: true }).partial();
export const itemSchema = itemInput;
export const itemUpdateSchema = z.object({ status: z.enum(ITEM_STATUSES).optional(), note: z.string().trim().max(1000).optional(), title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(1000).optional(), required: z.boolean().optional() });

export const settingsSchema = z.object({
  /** The connected mailbox requests go from by default (its replies are read). */
  mailAccountId: z.uuid().nullable().default(null),
  schedule: scheduleSchema.default(PRESETS[1]!.schedule),
  signOff: z.string().trim().max(500).default(""),
  /** Thank the client when everything's in. */
  thankYou: z.boolean().default(true),
  /** Read replies with AI to tick items off (otherwise attachments are matched by name). */
  readReplies: z.boolean().default(true),
  /** How sure the reading must be to mark an item received; below it, it's left to check. */
  autoMark: z.number().min(0.5).max(0.99).default(0.75),
  /** Uploads on the client's link count as received straight away (otherwise they wait to be checked). */
  trustUploads: z.boolean().default(true),
});
export type RqSettings = z.infer<typeof settingsSchema>;

export const templateSchema = z.object({ name: z.string().trim().min(1).max(120), title: z.string().trim().max(200).default(""), message: z.string().trim().max(4000).default(""), items: z.array(itemInput).min(1).max(100) });

/** Lists people start from, before they've saved their own. */
export const STARTERS: { name: string; title: string; items: { title: string; description?: string }[] }[] = [
  { name: "KYC — individual", title: "KYC documents", items: [{ title: "PAN card" }, { title: "Aadhaar card", description: "Front and back" }, { title: "Address proof", description: "Utility bill or bank statement, not older than 3 months" }, { title: "Passport-size photo" }, { title: "Cancelled cheque" }] },
  { name: "Income tax return", title: "Documents for your ITR", items: [{ title: "Form 16", description: "From each employer this year" }, { title: "Form 26AS / AIS" }, { title: "Bank statements", description: "All accounts, April to March" }, { title: "Investment proofs (80C, 80D)" }, { title: "Rent receipts", description: "If you claim HRA" }, { title: "Capital gains statements", description: "From your broker", } ] },
  { name: "GST — monthly", title: "This month's GST documents", items: [{ title: "Sales invoices", description: "All invoices raised this month" }, { title: "Purchase invoices" }, { title: "Credit and debit notes" }, { title: "Bank statement" }, { title: "Expense bills" }] },
  { name: "Employee onboarding", title: "Joining documents", items: [{ title: "Signed offer letter" }, { title: "PAN card" }, { title: "Aadhaar card" }, { title: "Bank account details", description: "Cancelled cheque or passbook" }, { title: "Educational certificates" }, { title: "Relieving letter", description: "From your last employer" }, { title: "Passport-size photo" }] },
  { name: "Loan application", title: "Loan application documents", items: [{ title: "Last 6 months' bank statements" }, { title: "Last 3 months' salary slips" }, { title: "ITR for the last 2 years" }, { title: "Identity and address proof" }, { title: "Property papers", description: "For a secured loan" }] },
];

// ── The schedule ────────────────────────────────────────────────────────────

const IST = 330 * 60_000;
const DAY = 86_400_000;

/** The time `at` (HH:MM, India) on the India date of `d`, as an instant. */
function atIst(d: Date, at: string) {
  const [h, m] = at.split(":").map(Number) as [number, number];
  const local = new Date(d.getTime() + IST);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - IST);
}
const weekend = (d: Date) => [0, 6].includes(new Date(d.getTime() + IST).getUTCDay());

/**
 * When the next reminder goes: `everyDays` after `from`, at the set time,
 * moved past weekends when asked, never before `notBefore` (a quiet spell
 * after a reply, or a date the client promised).
 */
export function nextReminder(from: Date, s: Schedule, notBefore?: Date | null): Date {
  let t = atIst(new Date(from.getTime() + s.everyDays * DAY), s.at);
  if (notBefore && t < notBefore) {
    t = atIst(notBefore, s.at);
    if (t < notBefore) t = new Date(t.getTime() + DAY);
  }
  for (let i = 0; i < 7 && s.weekdaysOnly && weekend(t); i++) t = new Date(t.getTime() + DAY);
  return t;
}

/** Days from today (India) to a due date; negative when it's passed. */
export function daysToDue(due: string | null, now = new Date()): number | null {
  if (!due) return null;
  const today = new Date(now.getTime() + IST).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

// ── The emails ──────────────────────────────────────────────────────────────

export const refOf = (number: string) => `[${number}]`;
/** A requisition number in a subject ("Re: … [REQ-0012]"). */
export const refIn = (subject: string) => /\[(REQ-\d{3,})\]/i.exec(subject)?.[1]?.toUpperCase() ?? null;

const fmtDue = (due: string) => new Date(`${due}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

type EmailIn = {
  kind: "request" | "reminder" | "thanks";
  /** Which reminder this is (1 = the first reminder). */
  n: number;
  max: number;
  escalate: boolean;
  business: string;
  number: string;
  title: string;
  message: string;
  clientName: string;
  dueDate: string | null;
  items: { title: string; description: string; status: ItemStatus; required: boolean; note: string }[];
  link: string;
  signOff: string;
  sender: string;
  now?: Date;
};

/** The request, a reminder (firmer as they go), or the thank-you — subject and plain text. */
export function composeEmail(e: EmailIn): { subject: string; body: string } {
  const first = e.clientName.trim().split(/\s+/)[0] || "there";
  const owed = e.items.filter((i) => OWED.includes(i.status) && i.required);
  const optional = e.items.filter((i) => OWED.includes(i.status) && !i.required);
  const done = e.items.filter((i) => i.status === "received" || i.status === "review");
  const left = daysToDue(e.dueDate, e.now);
  const ref = refOf(e.number);
  const sign = [e.signOff.trim() || "Thank you,", e.sender].filter(Boolean).join("\n");
  const line = (i: EmailIn["items"][number]) => `  • ${i.title}${i.description ? ` — ${i.description}` : ""}${i.status === "rejected" && i.note ? `\n    (Please send this again: ${i.note})` : ""}`;

  if (e.kind === "thanks")
    return {
      subject: `Received, thank you — ${e.title} ${ref}`,
      body: [`Hi ${first},`, "", `We've received everything we needed for "${e.title}". Thank you for sending it across.`, "", sign].join("\n"),
    };

  const final = e.escalate && e.kind === "reminder" && e.n >= e.max;
  const firm = e.escalate && e.kind === "reminder" && !final && e.n >= Math.max(3, Math.ceil(e.max / 2));
  // Reminders keep the request's subject, so they stay one conversation in the client's inbox; only the last says it's the last.
  const base = `${e.title} — documents needed ${ref}`;
  const subject = e.kind === "request" ? base : final ? `Final reminder: ${base}` : `Re: ${base}`;
  const due = e.dueDate ? (left !== null && left < 0 ? `This was due on ${fmtDue(e.dueDate)}.` : left === 0 ? "This is due today." : `Please send ${e.kind === "request" ? "these" : "them"} by ${fmtDue(e.dueDate)}.`) : "";
  const open =
    e.kind === "request"
      ? [`Hi ${first},`, "", e.message.trim() || `${e.business} needs a few things from you for "${e.title}".`]
      : final
        ? [`Hi ${first},`, "", `This is our last reminder about "${e.title}". We still haven't received the items below, and we can't move ahead without them.`]
        : firm
          ? [`Hi ${first},`, "", `We're still waiting on a few things for "${e.title}" — could you send them as soon as you can?`]
          : [`Hi ${first},`, "", `A gentle reminder about "${e.title}" — a few things are still to come.`];
  return {
    subject,
    body: [
      ...open,
      "",
      owed.length ? (e.kind === "request" ? "What we need:" : "Still needed:") : "",
      ...owed.map(line),
      optional.length ? "\nIf you have them (optional):" : "",
      ...optional.map(line),
      done.length && e.kind === "reminder" ? `\nAlready received — thank you: ${done.map((i) => i.title).join(", ")}.` : "",
      "",
      due,
      `Upload them here, item by item: ${e.link}`,
      "Or simply reply to this email with them attached.",
      "",
      sign,
    ]
      .filter((x, i, a) => !(x === "" && a[i - 1] === ""))
      .join("\n")
      .trim(),
  };
}

// ── Reading a reply without AI ──────────────────────────────────────────────

const STOP = new Set(["the", "and", "for", "of", "a", "an", "to", "your", "our", "copy", "card", "document", "documents", "proof", "details", "last", "this", "from", "all", "with", "or", "in", "on"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    // "statements" and "statement" are the same thing here.
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * Items a reply seems to cover, by name: an attachment whose name carries the
 * item's words (pan.pdf → "PAN card") counts strongly; a mention in the text
 * of having attached or sent it, less so. Used when AI isn't available.
 */
export function matchByName(items: { id: string; title: string }[], text: string, filenames: string[]): { id: string; confidence: number; reason: string }[] {
  const body = ` ${words(text).join(" ")} `;
  const sent = /\b(attach|attached|attaching|enclos|sending|sent|here is|here are|please find|pfa)/i.test(text);
  const named = items.map((it) => ({ ...it, w: words(it.title) })).filter((it) => it.w.length);
  // Each attachment goes to the one item it fits best ("sales-invoices.pdf" is
  // the sales invoices, not the purchase ones); a file that fits two equally goes to neither.
  const byFile = new Map<string, { file: string; share: number }>();
  for (const f of filenames) {
    const fw = words(f.replace(/\.[a-z0-9]+$/i, ""));
    const scored = named.map((it) => ({ id: it.id, share: it.w.filter((x) => fw.includes(x)).length / it.w.length })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share);
    const [top, next] = scored;
    if (!top || (next && next.share === top.share)) continue;
    const cur = byFile.get(top.id);
    if (!cur || top.share > cur.share) byFile.set(top.id, { file: f, share: top.share });
  }
  const out: { id: string; confidence: number; reason: string }[] = [];
  for (const it of named) {
    const best = byFile.get(it.id);
    if (best) {
      out.push({ id: it.id, confidence: Math.round((0.55 + 0.3 * best.share) * 100) / 100, reason: `Attached as ${best.file}` });
      continue;
    }
    const hits = it.w.filter((x) => body.includes(` ${x} `)).length;
    if (sent && hits === it.w.length) out.push({ id: it.id, confidence: 0.55, reason: "Mentioned as sent in the reply" });
  }
  return out;
}

/** Plain text of a reply without the quoted earlier messages. */
export function newText(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l) => /^\s*>/.test(l) || /^On .+ wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From:\s/i.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}

export const progressOf = (items: { status: string; required: boolean }[]) => {
  const req = items.filter((i) => i.required && i.status !== "waived");
  const got = req.filter((i) => i.status === "received").length;
  return { got, of: req.length, pct: req.length ? Math.round((got / req.length) * 100) : 100 };
};
