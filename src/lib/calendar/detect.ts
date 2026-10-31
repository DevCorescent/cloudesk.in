// Spotting meetings in email: the video link (Google Meet, Zoom, Teams, Webex,
// Jitsi, Whereby, GoTo) and — when there's no calendar invite attached — the
// date and time written in the text ("tomorrow at 3 pm", "28 Oct, 11:30 AM
// IST", "Thursday 4–5pm"). Text times are a best guess and are always shown
// for the person to confirm before anything goes in the calendar.
import { partsIn, zonedToUtc } from "./tz";

const TAIL = String.raw`[^\s"'<>)\]]*`;
export const MEETING_PROVIDERS = [
  { id: "meet", name: "Google Meet", re: new RegExp(String.raw`https://meet\.google\.com/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup/[\w-]+)(?:\?[^\s"'<>)\]]*)?`, "i") },
  { id: "zoom", name: "Zoom", re: new RegExp(String.raw`https://(?:[\w-]+\.)?zoom(?:gov)?\.(?:us|com)/(?:j|my|w|s|wc/join)/` + TAIL, "i") },
  { id: "teams", name: "Microsoft Teams", re: new RegExp(String.raw`https://teams\.(?:microsoft|live)\.com/(?:l/meetup-join|meet|v2/\?meetingjoin)` + TAIL, "i") },
  { id: "webex", name: "Webex", re: new RegExp(String.raw`https://[\w-]+\.webex\.com/(?:meet|join|wbxmjs|[\w-]+/j\.php|webappng)` + TAIL, "i") },
  { id: "zoho", name: "Zoho Meeting", re: new RegExp(String.raw`https://(?:meeting|meet)\.zoho\.(?:com|in|eu|com\.au)/` + TAIL, "i") },
  { id: "jitsi", name: "Jitsi", re: /https:\/\/meet\.jit\.si\/[\w-]+/i },
  { id: "whereby", name: "Whereby", re: /https:\/\/whereby\.com\/[\w-]+/i },
  { id: "goto", name: "GoTo Meeting", re: /https:\/\/(?:global\.gotomeeting\.com\/join|meet\.goto\.com|app\.gotomeeting\.com\/\?meetingid=)[\w-]+/i },
  { id: "chime", name: "Amazon Chime", re: /https:\/\/chime\.aws\/\d+/i },
  { id: "bluejeans", name: "BlueJeans", re: /https:\/\/bluejeans\.com\/\d+/i },
  { id: "skype", name: "Skype", re: /https:\/\/join\.skype\.com\/[\w-]+/i },
  { id: "ringcentral", name: "RingCentral", re: /https:\/\/(?:v\.)?ringcentral\.com\/join\/\d+/i },
] as const;
export type MeetingProvider = (typeof MEETING_PROVIDERS)[number]["id"] | "other";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/**
 * Text ready for link-spotting: HTML entities decoded, and links unwrapped from
 * the redirects mail systems wrap them in (Outlook Safe Links, Google's
 * /url?q=, Proofpoint, Mimecast, Barracuda), so the real meeting link shows.
 */
export function unwrapLinks(text: string): string {
  const decoded = text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, k: string) => ENTITIES[k] ?? _);
  const inner = (u: string) => {
    try {
      return decodeURIComponent(u);
    } catch {
      return u;
    }
  };
  return decoded
    .replace(/https:\/\/[\w.-]*safelinks\.protection\.outlook\.com\/\S*?[?&]url=([^&\s"'<>]+)\S*/gi, (_, u: string) => ` ${inner(u)} `)
    .replace(/https?:\/\/(?:www\.)?google\.[a-z.]+\/url\?(?:\S*?&)?q=([^&\s"'<>]+)\S*/gi, (_, u: string) => ` ${inner(u)} `)
    .replace(/https:\/\/urldefense\.(?:com|proofpoint\.com)\/v3\/__([^_]+?)__\S*/gi, (_, u: string) => ` ${u} `)
    .replace(/https:\/\/[\w.-]*(?:mimecast|barracudanetworks)\.com\/\S*?[?&](?:url|a)=([^&\s"'<>]+)\S*/gi, (_, u: string) => ` ${inner(u)} `);
}

/** The first meeting link in some text (HTML is fine), and whose it is. */
export function findMeetingLink(raw: string): { url: string; provider: MeetingProvider } | null {
  const text = unwrapLinks(raw);
  let best: { url: string; provider: MeetingProvider; at: number } | null = null;
  for (const p of MEETING_PROVIDERS) {
    const m = p.re.exec(text);
    if (m && (!best || m.index < best.at)) best = { url: m[0].replace(/[.,;:!?*]+$/, ""), provider: p.id, at: m.index };
  }
  return best ? { url: best.url, provider: best.provider } : null;
}

export const providerName = (id: string | null | undefined) => MEETING_PROVIDERS.find((p) => p.id === id)?.name ?? (id ? "Video call" : "");

// ── Dates and times written in text ─────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Common zone abbreviations → minutes ahead of UTC. */
const ABBR: Record<string, number> = { ist: 330, utc: 0, gmt: 0, bst: 60, cet: 60, cest: 120, eet: 120, gst: 240, sgt: 480, hkt: 480, jst: 540, aest: 600, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420 };

const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const TIME = "(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|hrs|h\\b)?";

export type FoundTime = { start: number; end: number | null; confidence: "high" | "medium" | "low"; text: string };

type DateHit = { y: number; m: number; d: number; at: number; len: number; text: string };
type TimeHit = { h: number; mi: number; endH?: number; endMi?: number; tz?: number; at: number; len: number; text: string };

function dates(text: string, base: { y: number; m: number; d: number; dow: number }): DateHit[] {
  const out: DateHit[] = [];
  const t = text.toLowerCase();
  const year = (y: string | undefined, m: number, d: number) => {
    if (y) return y.length === 2 ? 2000 + +y : +y;
    // No year: the next time that date comes round.
    return m < base.m || (m === base.m && d < base.d) ? base.y + 1 : base.y;
  };
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MON}\\.?,?(?:\\s+(\\d{4}))?`, "g"))) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3)) + 1;
    out.push({ d: +m[1]!, m: mo, y: year(m[3], mo, +m[1]!), at: m.index!, len: m[0].length, text: m[0] });
  }
  for (const m of t.matchAll(new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "g"))) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3)) + 1;
    if (+m[2]! > 31) continue;
    out.push({ d: +m[2]!, m: mo, y: year(m[3], mo, +m[2]!), at: m.index!, len: m[0].length, text: m[0] });
  }
  // dd/mm/yyyy (and dd-mm-yy), the Indian order.
  for (const m of t.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/g)) {
    if (+m[2]! > 12 || +m[1]! > 31) continue;
    out.push({ d: +m[1]!, m: +m[2]!, y: year(m[3], +m[2]!, +m[1]!), at: m.index!, len: m[0].length, text: m[0] });
  }
  const shift = (n: number) => {
    const d = new Date(Date.UTC(base.y, base.m - 1, base.d + n));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  for (const m of t.matchAll(/\b(today|tonight|tomorrow|day after tomorrow)\b/g)) {
    const n = m[1] === "tomorrow" ? 1 : m[1] === "day after tomorrow" ? 2 : 0;
    out.push({ ...shift(n), at: m.index!, len: m[0].length, text: m[0] });
  }
  for (const m of t.matchAll(/\b(this|next|on|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)) {
    const want = DAYS.indexOf(m[2]!);
    let n = (want - base.dow + 7) % 7;
    if (n === 0) n = m[1] === "this" ? 0 : 7;
    out.push({ ...shift(n), at: m.index!, len: m[0].length, text: m[0] });
  }
  return out.filter((d) => d.m >= 1 && d.m <= 12 && d.d >= 1 && d.d <= 31);
}

function times(text: string): TimeHit[] {
  const out: TimeHit[] = [];
  const t = text.toLowerCase();
  const tzAfter = (from: number) => {
    const m = /^\s*\(?\s*(ist|utc|gmt|bst|cet|cest|eet|gst|sgt|hkt|jst|aest|est|edt|cst|cdt|mst|mdt|pst|pdt)\b(?:\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?)?/.exec(t.slice(from));
    if (!m) return undefined;
    const base = ABBR[m[1]!] ?? 0;
    return m[2] ? (m[2] === "-" ? -1 : 1) * (+m[3]! * 60 + +(m[4] ?? 0)) + (m[1] === "utc" || m[1] === "gmt" ? 0 : base) : base;
  };
  const re = new RegExp(`(?:\\b(?:at|@|from|by)\\s+)?\\b${TIME}(?:\\s*(?:-|–|—|to|till|until)\\s*${TIME})?`, "g");
  for (const m of t.matchAll(re)) {
    const [, h1, mi1, ap1, h2, mi2, ap2] = m;
    const has = (x: string | undefined) => !!x;
    // A bare number isn't a time: it needs am/pm, a colon, or "hrs".
    if (!has(ap1) && !has(mi1) && !has(ap2)) continue;
    const pm = (ap: string | undefined, h: number) => (ap && /p/.test(ap) ? (h % 12) + 12 : ap && /a/.test(ap) ? h % 12 : h);
    const sh = pm(ap1 ?? (h2 && ap2 && /p/.test(ap2) && +h1! < +h2! ? ap2 : undefined), +h1!);
    if (sh > 23 || +(mi1 ?? 0) > 59) continue;
    const hit: TimeHit = { h: sh, mi: +(mi1 ?? 0), at: m.index!, len: m[0].length, text: m[0].trim() };
    if (h2) {
      const eh = pm(ap2 ?? ap1, +h2);
      if (eh <= 23 && +(mi2 ?? 0) <= 59) Object.assign(hit, { endH: eh, endMi: +(mi2 ?? 0) });
    }
    hit.tz = tzAfter(m.index! + m[0].length);
    out.push(hit);
  }
  return out;
}

/**
 * The meeting time written in an email, relative to when it was sent. `tz` is
 * the reader's zone, used when the email doesn't name one.
 */
export function findMeetingTime(text: string, sentAt: number, tz = "Asia/Kolkata"): FoundTime | null {
  const plain = text.replace(/\s+/g, " ").slice(0, 6000);
  const p = partsIn(sentAt, tz);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const ds = dates(plain, { y: p.y, m: p.m, d: p.d, dow });
  const ts = times(plain);
  if (!ts.length) return null;
  const keyword = /\b(meet(?:ing)?|call|catch[- ]?up|sync|demo|interview|discussion|session|review|webinar|invite|zoom|teams|google meet)\b/i.test(plain);
  // The closest date and time to each other, preferring ones near meeting words.
  let best: { d: DateHit | null; t: TimeHit; gap: number } | null = null;
  for (const t of ts) {
    for (const d of ds) {
      const gap = Math.abs(t.at - d.at);
      if (gap < 90 && (!best || gap < best.gap)) best = { d, t, gap };
    }
    if (!best && ds.length === 0) best = { d: null, t, gap: 999 };
  }
  if (!best) return null;
  const { d, t } = best;
  const wall = (h: number, mi: number, day: { y: number; m: number; d: number }) =>
    t.tz !== undefined ? Date.UTC(day.y, day.m - 1, day.d, h, mi) - t.tz * 60_000 : zonedToUtc({ ...day, h, mi, s: 0 }, tz);
  let day = d ?? { y: p.y, m: p.m, d: p.d };
  let start = wall(t.h, t.mi, day);
  if (!d && start <= sentAt) {
    // "at 3 pm" with no day, already past when sent: the next day.
    const nd = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    day = { y: nd.getUTCFullYear(), m: nd.getUTCMonth() + 1, d: nd.getUTCDate() };
    start = wall(t.h, t.mi, day);
  }
  let end = t.endH !== undefined ? wall(t.endH, t.endMi ?? 0, day) : null;
  if (end !== null && end <= start) end = null;
  const confidence = d && keyword ? "high" : d || keyword ? "medium" : "low";
  return { start, end, confidence, text: `${d ? `${d.text} ` : ""}${t.text}`.trim() };
}
