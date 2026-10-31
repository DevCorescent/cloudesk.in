// Helpdesk: tickets from email, the customer portal or the team; who handles
// them; and service-level targets counted in business hours (India time, the
// workspace's working days and hours, holidays off). The clock pauses while a
// ticket waits on the customer or is on hold.
import { z } from "zod";

export const STATUSES = ["new", "open", "pending", "on_hold", "resolved", "closed"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { new: "New", open: "Open", pending: "Waiting on customer", on_hold: "On hold", resolved: "Resolved", closed: "Closed" };
/** The SLA clock doesn't run in these. */
export const PAUSED: readonly Status[] = ["pending", "on_hold"];
export const DONE: readonly Status[] = ["resolved", "closed"];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const CHANNELS = ["email", "portal", "web", "phone", "chat", "manual"] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const target = z.object({ first: z.number().int().min(1).max(100_000), resolve: z.number().int().min(1).max(500_000) });
export type Hours = { days: number[]; start: string; end: string };

export const settingsSchema = z.object({
  prefix: z.string().trim().min(1).max(10).default("HD-"),
  /** ISO weekdays (Monday 1 … Sunday 7) and opening hours, India time. */
  hours: z.object({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5, 6]), start: hhmm.default("09:30"), end: hhmm.default("18:30") }).refine((h) => h.start < h.end, "Closing time must be after opening").prefault({}),
  holidays: z.array(day).max(100).default([]),
  /** Business minutes to first reply and to resolve, by priority. */
  sla: z.object({ low: target.default({ first: 1440, resolve: 7200 }), normal: target.default({ first: 480, resolve: 2880 }), high: target.default({ first: 120, resolve: 960 }), urgent: target.default({ first: 30, resolve: 240 }) }).prefault({}),
  assignment: z.enum(["none", "round_robin"]).default("none"),
  /** Who takes tickets in turn (round robin); empty means every agent. */
  agents: z.array(z.uuid()).max(200).default([]),
  /** Resolved tickets close on their own after this many days without a reply. */
  autoCloseDays: z.number().int().min(0).max(90).default(7),
  csat: z.boolean().default(true),
  /** Your support address, used as Reply-To so customers' replies come back to the inbound address. */
  replyTo: z.union([z.email(), z.literal("")]).default(""),
  signature: z.string().trim().max(1000).default(""),
});
export type HdSettings = z.infer<typeof settingsSchema>;

export const ticketSchema = z.object({
  subject: z.string().trim().min(1, "What's it about?").max(200),
  body: z.string().trim().max(20_000).default(""),
  customerName: z.string().trim().max(120).default(""),
  customerEmail: z.union([z.email(), z.literal("")]).default(""),
  customerPhone: z.string().trim().max(30).default(""),
  priority: z.enum(PRIORITIES).default("normal"),
  channel: z.enum(CHANNELS).default("manual"),
  assigneeId: z.uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  contactId: z.uuid().nullable().default(null),
});
export const updateSchema = z.object({ status: z.enum(STATUSES), priority: z.enum(PRIORITIES), assigneeId: z.uuid().nullable(), tags: z.array(z.string().trim().min(1).max(30)).max(12), subject: z.string().trim().min(1).max(200) }).partial();
export const replySchema = z.object({ body: z.string().trim().min(1, "Write something first").max(20_000), internal: z.boolean().default(false), status: z.enum(STATUSES).optional() });
export const cannedSchema = z.object({ title: z.string().trim().min(1, "Name it").max(80), body: z.string().trim().min(1, "Write the reply").max(10_000) });

// ── Business time (India) ───────────────────────────────────────────────────

const IST = 5.5 * 3_600_000;
const MIN = 60_000;
const DAY = 86_400_000;
const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Opening and closing (UTC ms) of the working day containing the IST day starting at `dayStart` (IST-shifted ms), or null. */
function window(dayStart: number, hours: Hours, holidays: ReadonlySet<string>) {
  const d = new Date(dayStart);
  const iso = d.toISOString().slice(0, 10);
  const wd = d.getUTCDay() || 7;
  if (!hours.days.includes(wd) || holidays.has(iso)) return null;
  return { open: dayStart + mins(hours.start) * MIN - IST, close: dayStart + mins(hours.end) * MIN - IST };
}

/** The moment `minutes` business minutes after `from`. */
export function addBusinessMinutes(from: Date, minutes: number, hours: Hours, holidays: readonly string[] = []): Date {
  const hol = new Set(holidays);
  let t = from.getTime();
  let left = minutes;
  for (let i = 0; i < 3700; i++) {
    const dayStart = Math.floor((t + IST) / DAY) * DAY;
    const w = window(dayStart, hours, hol);
    if (w) {
      if (t < w.open) t = w.open;
      if (t < w.close) {
        const avail = (w.close - t) / MIN;
        if (left <= avail) return new Date(t + left * MIN);
        left -= avail;
      }
    }
    t = dayStart + DAY - IST;
  }
  throw new Error("Business hours never open");
}

/** Business minutes between two moments (0 if `to` is earlier). */
export function businessMinutesBetween(from: Date, to: Date, hours: Hours, holidays: readonly string[] = []): number {
  const hol = new Set(holidays);
  let t = from.getTime();
  const end = to.getTime();
  let total = 0;
  for (let i = 0; i < 3700 && t < end; i++) {
    const dayStart = Math.floor((t + IST) / DAY) * DAY;
    const w = window(dayStart, hours, hol);
    if (w) {
      const a = Math.max(t, w.open);
      const b = Math.min(end, w.close);
      if (b > a) total += (b - a) / MIN;
    }
    t = dayStart + DAY - IST;
  }
  return Math.round(total);
}

/** Business minutes as people say them: "45 min", "3 h 20 min", "2 working days 1 h". */
export function durationText(m: number, hours: Hours) {
  const perDay = mins(hours.end) - mins(hours.start);
  const d = Math.floor(m / perDay);
  const h = Math.floor((m % perDay) / 60);
  const r = Math.round(m % 60);
  return [d ? `${d} working day${d > 1 ? "s" : ""}` : "", h ? `${h} h` : "", r || (!d && !h) ? `${r} min` : ""].filter(Boolean).join(" ");
}

// ── Threads and replies ─────────────────────────────────────────────────────

/** A ticket number in a subject — "[HD-0042]" — for threading email replies. */
export function ticketRef(subject: string, prefix: string) {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`\\[(${esc}\\d{1,9})\\]`, "i").exec(subject);
  return m ? m[1].toUpperCase() : null;
}

/** The new part of an emailed reply: stops at the quoted earlier message. */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) break;
    if (/^On .{4,200}wrote:\s*$/i.test(l.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim())) break;
    if (/^From:\s.+/i.test(l.trim()) && out.length) break;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Fill {{name}}, {{ticket}}, {{agent}} in a saved reply. */
export const fillCanned = (body: string, v: { name: string; ticket: string; agent: string }) => body.replace(/\{\{\s*(name|ticket|agent)\s*\}\}/g, (_, k: "name" | "ticket" | "agent") => v[k] || "");

// ── Reports ─────────────────────────────────────────────────────────────────

export type TicketFacts = { createdAt: Date; firstRespondedAt: Date | null; resolvedAt: Date | null; firstResponseDue: Date | null; resolveDue: Date | null; firstBreached: boolean; resolveBreached: boolean; csat: number | null; status: Status };

/** Targets met, average business minutes to first reply and to resolve, and satisfaction. */
export function stats(ts: TicketFacts[], hours: Hours, holidays: readonly string[] = []) {
  const replied = ts.filter((t) => t.firstRespondedAt);
  const resolved = ts.filter((t) => t.resolvedAt);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const rated = ts.filter((t) => t.csat !== null);
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : null);
  return {
    tickets: ts.length,
    open: ts.filter((t) => !DONE.includes(t.status)).length,
    firstMet: pct(replied.filter((t) => !t.firstBreached).length, replied.length),
    resolveMet: pct(resolved.filter((t) => !t.resolveBreached).length, resolved.length),
    avgFirst: avg(replied.map((t) => businessMinutesBetween(t.createdAt, t.firstRespondedAt!, hours, holidays))),
    avgResolve: avg(resolved.map((t) => businessMinutesBetween(t.createdAt, t.resolvedAt!, hours, holidays))),
    csat: rated.length ? Math.round((rated.reduce((n, t) => n + t.csat!, 0) / rated.length) * 10) / 10 : null,
    happy: pct(rated.filter((t) => t.csat! >= 4).length, rated.length),
    rated: rated.length,
  };
}

// ── Status changes and the SLA clock ────────────────────────────────────────

/** Statuses where the resolve clock is stopped (waiting on the customer, on hold, or done). */
export const STOPPED: readonly Status[] = ["pending", "on_hold", "resolved", "closed"];
type Clock = { status: Status; resolveDue: Date | null; pausedAt: Date | null; remainingMins: number | null; resolvedAt: Date | null; closedAt: Date | null; resolveBreached: boolean };

/** What changes on a ticket moving to `next`: the clock stops (keeping the time left) or restarts from now with it; resolving and closing are stamped. */
export function transition(t: Clock, next: Status, now: Date, s: Pick<HdSettings, "hours" | "holidays">): Partial<Clock> {
  if (t.status === next) return {};
  const patch: Partial<Clock> = { status: next };
  const wasStopped = STOPPED.includes(t.status);
  const stops = STOPPED.includes(next);
  if (!wasStopped && stops) {
    patch.pausedAt = now;
    patch.remainingMins = t.resolveDue ? Math.max(0, businessMinutesBetween(now, t.resolveDue, s.hours, s.holidays)) : null;
    if (t.resolveDue && now > t.resolveDue) patch.resolveBreached = true;
  }
  if (wasStopped && !stops) {
    patch.pausedAt = null;
    if (t.remainingMins !== null) patch.resolveDue = addBusinessMinutes(now, t.remainingMins, s.hours, s.holidays);
    patch.remainingMins = null;
  }
  if (next === "resolved") patch.resolvedAt = now;
  else if (next !== "closed") patch.resolvedAt = null;
  patch.closedAt = next === "closed" ? now : null;
  return patch;
}
