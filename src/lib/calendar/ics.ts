// iCalendar (RFC 5545) — just what meeting invites need. Reads the invite
// attached to an email (Google, Outlook, Zoom, Teams all send one: METHOD
// REQUEST, CANCEL, REPLY), and writes invites, replies (RSVP) and cancellations
// for the mail we send. Times are converted to UTC; zones can be IANA names,
// Outlook's Windows names, or a VTIMEZONE block's fixed offset.
import { normaliseTz, zonedToUtc } from "./tz";

export type IcsPerson = { name: string; email: string; partstat?: string; role?: string };
export type IcsEvent = {
  uid: string;
  sequence: number;
  summary: string;
  description: string;
  location: string;
  url: string;
  start: number;
  end: number;
  allDay: boolean;
  tz: string | null;
  status: string;
  organizer: IcsPerson | null;
  attendees: IcsPerson[];
  rrule: string;
  /** The video-call link the invite names itself (Google's X-GOOGLE-CONFERENCE, Teams' meeting URL). */
  conference: string;
};
export type IcsCalendar = { method: string; events: IcsEvent[] };

type Line = { name: string; params: Record<string, string>; value: string };

function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter((l) => l.trim());
}

function parseLine(line: string): Line {
  // NAME;PARAM=VALUE;PARAM="quoted:value":VALUE — the first unquoted ":" ends the params,
  // and unquoted ";" separate them. One linear pass (a lookahead regex here was quadratic
  // on a hostile invite's long line of semicolons).
  let i = 0;
  let quoted = false;
  const parts: string[] = [];
  let from = 0;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ";" && !quoted) {
      parts.push(line.slice(from, i));
      from = i + 1;
    } else if (line[i] === ":" && !quoted) break;
  }
  parts.push(line.slice(from, i));
  const value = line.slice(i + 1);
  const [name, ...rest] = parts;
  const params: Record<string, string> = {};
  for (const r of rest) {
    const eq = r.indexOf("=");
    if (eq > 0) params[r.slice(0, eq).toUpperCase()] = r.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value };
}

const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const escapeText = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function person(l: Line): IcsPerson {
  return { name: unescape(l.params.CN ?? ""), email: l.value.replace(/^mailto:/i, "").trim().toLowerCase(), partstat: l.params.PARTSTAT, role: l.params.ROLE };
}

/** A fixed offset from a VTIMEZONE (its STANDARD part) for zones we can't name. */
function vtimezoneOffsets(lines: Line[]) {
  const out = new Map<string, number>();
  let tzid = "";
  let inStd = false;
  for (const l of lines) {
    if (l.name === "BEGIN" && l.value === "VTIMEZONE") tzid = "";
    else if (l.name === "TZID" && !inStd) tzid = l.value;
    else if (l.name === "BEGIN" && l.value === "STANDARD") inStd = true;
    else if (l.name === "END" && l.value === "STANDARD") inStd = false;
    else if (inStd && l.name === "TZOFFSETTO" && tzid && !out.has(tzid)) {
      const m = /^([+-])(\d{2})(\d{2})/.exec(l.value);
      if (m) out.set(tzid, (m[1] === "-" ? -1 : 1) * (+m[2]! * 60 + +m[3]!));
    }
  }
  return out;
}

function parseTime(l: Line, fixed: Map<string, number>, fallbackTz: string): { ms: number; allDay: boolean; tz: string | null } | null {
  const v = l.value.trim();
  if (l.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    return m ? { ms: Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!), allDay: true, tz: null } : null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const parts = { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +(m[6] ?? 0) };
  if (m[7]) return { ms: Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s), allDay: false, tz: "UTC" };
  const tzid = l.params.TZID;
  const iana = normaliseTz(tzid);
  if (iana) return { ms: zonedToUtc(parts, iana), allDay: false, tz: iana };
  if (tzid && fixed.has(tzid)) return { ms: Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi, parts.s) - fixed.get(tzid)! * 60_000, allDay: false, tz: null };
  // Floating time: the reader's zone.
  return { ms: zonedToUtc(parts, fallbackTz), allDay: false, tz: fallbackTz };
}

function duration(v: string) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

/** Reads an iCalendar file. `fallbackTz` is used for times without a zone. */
export function parseIcs(text: string, fallbackTz = "Asia/Kolkata"): IcsCalendar {
  // Real invites are a few KB; anything this large is not one we'll read.
  if (text.length > 2_000_000) return { method: "", events: [] };
  const lines = unfold(text).map(parseLine);
  const fixed = vtimezoneOffsets(lines);
  let method = "";
  const events: IcsEvent[] = [];
  let cur: (Partial<IcsEvent> & { attendees: IcsPerson[]; dur?: number | null }) | null = null;
  let depth = 0; // nested blocks inside a VEVENT (VALARM)
  for (const l of lines) {
    if (l.name === "METHOD" && !cur) method = l.value.trim().toUpperCase();
    if (l.name === "BEGIN" && l.value === "VEVENT") {
      cur = { attendees: [] };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (l.name === "BEGIN") depth++;
    else if (l.name === "END" && l.value !== "VEVENT") depth--;
    else if (l.name === "END" && l.value === "VEVENT") {
      if (cur.start !== undefined) {
        const end = cur.end ?? (cur.dur ? cur.start + cur.dur : cur.allDay ? cur.start + 86_400_000 : cur.start + 3_600_000);
        events.push({ uid: cur.uid ?? "", sequence: cur.sequence ?? 0, summary: cur.summary ?? "", description: cur.description ?? "", location: cur.location ?? "", url: cur.url ?? "", start: cur.start, end, allDay: !!cur.allDay, tz: cur.tz ?? null, status: cur.status ?? "CONFIRMED", organizer: cur.organizer ?? null, attendees: cur.attendees, rrule: cur.rrule ?? "", conference: cur.conference ?? "" });
      }
      cur = null;
      continue;
    }
    if (depth > 0) continue;
    switch (l.name) {
      case "UID": cur.uid = l.value.trim(); break;
      case "SEQUENCE": cur.sequence = Number(l.value) || 0; break;
      case "SUMMARY": cur.summary = unescape(l.value).trim(); break;
      case "DESCRIPTION": cur.description = unescape(l.value); break;
      case "LOCATION": cur.location = unescape(l.value).trim(); break;
      case "URL": cur.url = l.value.trim(); break;
      case "STATUS": cur.status = l.value.trim().toUpperCase(); break;
      case "RRULE": cur.rrule = l.value.trim(); break;
      case "X-GOOGLE-CONFERENCE":
      case "X-MICROSOFT-SKYPETEAMSMEETINGURL":
      case "X-MICROSOFT-ONLINEMEETINGCONFLINK":
      case "X-MICROSOFT-ONLINEMEETINGEXTERNALLINK":
        if (!cur.conference && /^https:\/\//i.test(l.value.trim())) cur.conference = l.value.trim();
        break;
      case "ORGANIZER": cur.organizer = person(l); break;
      case "ATTENDEE": cur.attendees.push(person(l)); break;
      case "DURATION": cur.dur = duration(l.value); break;
      case "DTSTART": {
        const t = parseTime(l, fixed, fallbackTz);
        if (t) Object.assign(cur, { start: t.ms, allDay: t.allDay, tz: t.tz });
        break;
      }
      case "DTEND": {
        const t = parseTime(l, fixed, fallbackTz);
        if (t) cur.end = t.ms;
        break;
      }
    }
  }
  return { method, events };
}

// ── Writing ─────────────────────────────────────────────────────────────────

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

const enc = new TextEncoder();
/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const who = (p: IcsPerson, kind: "ORGANIZER" | "ATTENDEE", partstat?: string) =>
  `${kind}${p.name ? `;CN="${p.name.replace(/"/g, "")}"` : ""}${kind === "ATTENDEE" ? `;ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat ?? p.partstat ?? "NEEDS-ACTION"};RSVP=TRUE` : ""}:mailto:${p.email}`;

export type BuildIcs = {
  method: "REQUEST" | "REPLY" | "CANCEL" | "PUBLISH";
  uid: string;
  sequence?: number;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  start: number;
  end: number;
  allDay?: boolean;
  organizer: IcsPerson;
  attendees: IcsPerson[];
  rrule?: string;
  /** For REPLY: who is answering, and how. */
  reply?: { email: string; name?: string; partstat: "ACCEPTED" | "TENTATIVE" | "DECLINED" };
  now?: number;
};

export function buildIcs(e: BuildIcs): string {
  const t = (name: string, ms: number) => (e.allDay ? `${name};VALUE=DATE:${dateOnly(ms)}` : `${name}:${stamp(ms)}`);
  const attendees = e.method === "REPLY" && e.reply ? [who({ email: e.reply.email, name: e.reply.name ?? "" }, "ATTENDEE", e.reply.partstat)] : e.attendees.map((a) => who(a, "ATTENDEE"));
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Cloudesk//Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(e.now ?? Date.now())}`,
    `SEQUENCE:${e.sequence ?? 0}`,
    t("DTSTART", e.start),
    t("DTEND", e.end),
    `SUMMARY:${escapeText(e.summary)}`,
    e.description ? `DESCRIPTION:${escapeText(e.description)}` : "",
    e.location ? `LOCATION:${escapeText(e.location)}` : "",
    e.url ? `URL:${e.url}` : "",
    e.rrule ? `RRULE:${e.rrule}` : "",
    who(e.organizer, "ORGANIZER"),
    ...attendees,
    `STATUS:${e.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
