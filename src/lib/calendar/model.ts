// Calendar: what an event and its minutes (MOM) look like, reminders, colours,
// and the email the minutes are shared as.
import { z } from "zod";
import { repeatSchema } from "./recur";

export const CAL_COLORS = ["#2563eb", "#0f766e", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#475569"];

/** Minutes before the start; 0 = "when it starts". */
export const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 180, 360, 1440, 2880, 10080];
/** By default: the day before, 3 hours, 1 hour, 10 minutes and at the start — several nudges on the day. */
export const DEFAULT_REMINDERS = [1440, 180, 60, 10, 0];

export function reminderLabel(min: number) {
  if (min === 0) return "When it starts";
  if (min < 60) return `${min} min before`;
  if (min < 1440) return `${min / 60} ${min === 60 ? "hour" : "hours"} before`;
  if (min < 10080) return `${min / 1440} ${min === 1440 ? "day" : "days"} before`;
  return "1 week before";
}

const https = z.union([z.literal(""), z.string().trim().max(2000).regex(/^https:\/\/[^\s"'<>]+$/i, "Use a full https:// link")]);
export const personSchema = z.object({ name: z.string().trim().max(120).default(""), email: z.email("Check the email").transform((x) => x.toLowerCase()) });
export type Person = z.infer<typeof personSchema>;

export const eventSchema = z
  .object({
    calendarId: z.uuid(),
    title: z.string().trim().min(1, "Give it a title").max(200),
    description: z.string().max(10_000).default(""),
    location: z.string().trim().max(300).default(""),
    meetingUrl: https.default(""),
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    allDay: z.boolean().default(false),
    tz: z.string().trim().max(64).default("Asia/Kolkata"),
    repeat: repeatSchema.nullable().default(null),
    attendees: z.array(personSchema).max(100).default([]),
    reminders: z.array(z.number().int().min(0).max(10080)).max(8).default(DEFAULT_REMINDERS),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().default(null),
    status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  })
  .refine((v) => Date.parse(v.end) > Date.parse(v.start), { message: "It has to end after it starts", path: ["end"] });
export type EventIn = z.input<typeof eventSchema>;

export const actionSchema = z.object({ text: z.string().trim().min(1).max(500), owner: z.string().trim().max(120).default(""), due: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""), done: z.boolean().default(false) });
export const notesSchema = z.object({
  present: z.array(z.string().trim().max(200)).max(200).default([]),
  summary: z.string().max(20_000).default(""),
  points: z.string().max(40_000).default(""),
  decisions: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  actions: z.array(actionSchema).max(100).default([]),
  nextMeeting: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
});
export type Notes = z.infer<typeof notesSchema>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type MinutesMeta = { title: string; when: string; organizer: string; where: string };

/** The minutes as plain text (the email's text part). */
export function minutesText(m: MinutesMeta, n: Notes, intro = "") {
  const out = [intro.trim(), `Minutes of meeting: ${m.title}`, `When: ${m.when}`, m.organizer && `Organised by: ${m.organizer}`, m.where && `Where: ${m.where}`, n.present.length ? `Present: ${n.present.join(", ")}` : ""];
  if (n.summary.trim()) out.push("", "Summary", n.summary.trim());
  if (n.points.trim()) out.push("", "Discussion", n.points.trim());
  if (n.decisions.length) out.push("", "Decisions", ...n.decisions.map((d, i) => `${i + 1}. ${d}`));
  if (n.actions.length) out.push("", "Action items", ...n.actions.map((a) => `- ${a.text}${a.owner ? ` — ${a.owner}` : ""}${a.due ? ` (by ${a.due})` : ""}${a.done ? " ✓" : ""}`));
  if (n.nextMeeting) out.push("", `Next meeting: ${n.nextMeeting}`);
  return out.filter((x, i) => x !== "" || i > 0).join("\n").replace(/^\n+/, "");
}

/** The minutes as email-safe HTML. */
export function minutesHtml(m: MinutesMeta, n: Notes, accent = "#2563eb", intro = "") {
  const FONT = "Arial,Helvetica,sans-serif";
  const h = (t: string) => `<tr><td style="padding:18px 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${accent}">${t}</td></tr>`;
  const p = (t: string) => `<tr><td style="font-family:${FONT};font-size:14px;line-height:1.6;color:#1d1d1f">${esc(t).replace(/\n/g, "<br>")}</td></tr>`;
  const rows: string[] = [];
  if (intro.trim()) rows.push(`<tr><td style="padding-bottom:16px;font-family:${FONT};font-size:14px;line-height:1.6;color:#1d1d1f">${esc(intro.trim()).replace(/\n/g, "<br>")}</td></tr>`);
  rows.push(`<tr><td style="font-family:${FONT};font-size:20px;font-weight:700;color:#111">Minutes of meeting</td></tr>`, `<tr><td style="padding-top:2px;font-family:${FONT};font-size:15px;color:#1d1d1f">${esc(m.title)}</td></tr>`);
  const meta = [["When", m.when], ["Organised by", m.organizer], ["Where", m.where], ["Present", n.present.join(", ")]].filter(([, v]) => v);
  rows.push(`<tr><td style="padding-top:12px"><table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse">${meta.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;font-family:${FONT};font-size:13px;color:#6e6e73;vertical-align:top">${k}</td><td style="padding:2px 0;font-family:${FONT};font-size:13px;color:#1d1d1f">${esc(v!)}</td></tr>`).join("")}</table></td></tr>`);
  if (n.summary.trim()) rows.push(h("Summary"), p(n.summary.trim()));
  if (n.points.trim()) rows.push(h("Discussion"), p(n.points.trim()));
  if (n.decisions.length) rows.push(h("Decisions"), `<tr><td><ol style="margin:0;padding-left:20px;font-family:${FONT};font-size:14px;line-height:1.6;color:#1d1d1f">${n.decisions.map((d) => `<li>${esc(d)}</li>`).join("")}</ol></td></tr>`);
  if (n.actions.length)
    rows.push(
      h("Action items"),
      `<tr><td><table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;width:100%;max-width:640px"><tr>${["Action", "Owner", "Due"].map((t) => `<td style="padding:8px 10px;background:#f4f4f5;font-family:${FONT};font-size:12px;font-weight:700;color:#3a3a3c">${t}</td>`).join("")}</tr>${n.actions
        .map((a) => `<tr>${[`${a.done ? "✓ " : ""}${a.text}`, a.owner || "—", a.due || "—"].map((v) => `<td style="padding:8px 10px;border-bottom:1px solid #e5e5ea;font-family:${FONT};font-size:13px;color:#1d1d1f;vertical-align:top">${esc(v)}</td>`).join("")}</tr>`)
        .join("")}</table></td></tr>`,
    );
  if (n.nextMeeting) rows.push(h("Next meeting"), p(n.nextMeeting));
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;max-width:680px">${rows.join("")}</table>`;
}
