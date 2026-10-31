// Sections wired to the rest of the workspace: open jobs from HR, upcoming
// events from Marketing, and a support form that opens Helpdesk tickets. In
// the editor they show sample content (clearly labelled); on the published
// site they're markers filled per request with live records, so a job closed
// or an event added shows up without republishing.
import type { FieldDef, SectionDef } from "./model";
import { esc } from "./html";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const has = (v: unknown) => str(v).trim().length > 0;
const F = (path: string) => ` data-f="${path}"`;
const head = (p: P) =>
  has(p.heading) || has(p.subheading) ? `<header class="sec-head">${has(p.heading) ? `<h2${F("heading")}>${esc(p.heading)}</h2>` : ""}${has(p.subheading) ? `<p class="lead"${F("subheading")}>${esc(p.subheading)}</p>` : ""}</header>` : "";
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const heading: FieldDef[] = [
  { key: "heading", label: "Heading", kind: "text", max: 140 },
  { key: "subheading", label: "Supporting text", kind: "textarea", max: 400 },
];

export const CONNECTED_TYPES = ["careers", "events", "support"] as const;

export const CONNECTED_SECTION_DEFS: SectionDef[] = [
  {
    type: "careers",
    label: "Open jobs",
    description: "Live roles from HR → Hiring, each linking to apply",
    category: "Conversion",
    fields: [...heading, { key: "buttonLabel", label: "Button", kind: "text", max: 40 }, { key: "emptyText", label: "When nothing is open", kind: "text", max: 200 }],
    defaults: () => ({ heading: "Join the team", subheading: "We're hiring. Find a role that fits you.", buttonLabel: "Apply", emptyText: "No open roles right now — check back soon." }),
  },
  {
    type: "events",
    label: "Upcoming events",
    description: "Live events from Marketing, with registration",
    category: "Conversion",
    fields: [...heading, { key: "buttonLabel", label: "Button", kind: "text", max: 40 }, { key: "limit", label: "How many", kind: "number", min: 1, max: 12 }, { key: "emptyText", label: "When nothing is coming up", kind: "text", max: 200 }],
    defaults: () => ({ heading: "Upcoming events", subheading: "Workshops, launches and meet-ups.", buttonLabel: "Register", limit: 6, emptyText: "No events coming up right now." }),
  },
  {
    type: "support",
    label: "Support request",
    description: "A form that opens a Helpdesk ticket and emails the customer a reference",
    category: "Conversion",
    fields: [...heading, { key: "buttonLabel", label: "Button", kind: "text", max: 40 }],
    defaults: () => ({ heading: "How can we help?", subheading: "Tell us what's happening and we'll get back to you. You'll get a reference number by email.", buttonLabel: "Send request" }),
  },
];

export const CONNECTED_VARIANTS: Record<string, { value: string; label: string }[]> = {
  careers: [{ value: "list", label: "List" }, { value: "cards", label: "Cards" }],
  events: [{ value: "cards", label: "Cards" }, { value: "list", label: "List" }],
  support: [{ value: "default", label: "Default" }, { value: "split", label: "With text beside" }],
};

export type Job = { id: string; title: string; department: string | null; location: string | null; employmentType: string; salaryRange: string | null };
export type EventItem = { name: string; when: string | null; venue: string | null; online: boolean; placesLeft: number | null; href: string };

const TYPE_LABEL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Internship" };

export function careersHtml(p: P, v: string, jobs: Job[], applyHref: (job: Job) => string, note?: string) {
  const items = jobs.length
    ? `<div class="cx-list cx-${v === "cards" ? "cards" : "rows"}">${jobs
        .map((j) => `<a class="cx-item card" href="${esc(applyHref(j))}"><span class="cx-main"><b>${esc(j.title)}</b><span class="cx-meta">${[j.department, j.location, TYPE_LABEL[j.employmentType] ?? j.employmentType, j.salaryRange].filter(Boolean).map((x) => esc(x)).join(" · ")}</span></span><span class="btn btn-ghost cx-btn">${esc(str(p.buttonLabel) || "Apply")} →</span></a>`)
        .join("")}</div>`
    : `<p class="cx-empty muted">${esc(str(p.emptyText) || "No open roles right now.")}</p>`;
  return `<div class="wrap reveal">${head(p)}${items}${note ? `<p class="form-note">${esc(note)}</p>` : ""}</div>`;
}

export function eventsHtml(p: P, v: string, events: EventItem[], note?: string) {
  const items = events.length
    ? `<div class="cx-list cx-${v === "list" ? "rows" : "cards"}">${events
        .map((e) => `<a class="cx-item card" href="${esc(e.href)}"><span class="cx-main"><b>${esc(e.name)}</b><span class="cx-meta">${[e.when, e.venue, e.online ? "Online" : "", e.placesLeft !== null ? `${e.placesLeft} places left` : ""].filter(Boolean).map((x) => esc(String(x))).join(" · ")}</span></span><span class="btn btn-ghost cx-btn">${esc(str(p.buttonLabel) || "Register")} →</span></a>`)
        .join("")}</div>`
    : `<p class="cx-empty muted">${esc(str(p.emptyText) || "No events coming up right now.")}</p>`;
  return `<div class="wrap reveal">${head(p)}${items}${note ? `<p class="form-note">${esc(note)}</p>` : ""}</div>`;
}

type Form = { open: (id: string, cls?: string) => string; notice: string; honeypot: string };

/** Renders a connected section; `publish` emits the marker the server fills with live records. */
export function renderConnected(type: string, p: P, v: string, ctx: { publish: boolean; form: Form }): string | null {
  if (type === "careers") {
    if (ctx.publish) return `<!--cc:careers:${v}:${b64(JSON.stringify(p))}-->`;
    const sample: Job[] = [
      { id: "1", title: "Sample role: Store manager", department: "Operations", location: "Pune", employmentType: "full_time", salaryRange: null },
      { id: "2", title: "Sample role: Sales associate", department: "Sales", location: "Pune", employmentType: "part_time", salaryRange: null },
    ];
    return careersHtml(p, v, sample, () => "#", "Preview: your open roles from HR → Hiring appear here on the published site.");
  }
  if (type === "events") {
    if (ctx.publish) return `<!--cc:events:${v}:${b64(JSON.stringify(p))}-->`;
    const sample: EventItem[] = [{ name: "Sample event: Spring launch", when: "Sat, 14 Mar · 6:00 pm", venue: "Your venue", online: false, placesLeft: 40, href: "#" }];
    return eventsHtml(p, v, sample, "Preview: upcoming events from Marketing appear here on the published site.");
  }
  if (type === "support") {
    const form = `${ctx.form.open("support", "form")}${ctx.form.honeypot}<div class="row"><label>Your name<input name="name" required maxlength="120" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label></div><label>Subject<input name="subject" required maxlength="200"></label><label>What's happening?<textarea name="message" required maxlength="4000" rows="5"></textarea></label><button class="btn btn-primary" type="submit"${F("buttonLabel")}>${esc(str(p.buttonLabel) || "Send request")}</button></form>${ctx.form.notice}`;
    return v === "split" ? `<div class="wrap split reveal"><div>${head(p)}</div><div>${form}</div></div>` : `<div class="wrap narrow reveal">${head(p)}${form}</div>`;
  }
  return null;
}

export const CONNECTED_CSS = `.cx-list{display:grid;gap:12px}.cx-cards{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}.cx-item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;text-decoration:none;color:inherit;transition:transform .2s,box-shadow .2s}.cx-cards .cx-item{flex-direction:column;align-items:flex-start}.cx-item:hover{transform:translateY(-2px)}.cx-main{display:grid;gap:4px;min-width:0}.cx-main b{font-size:1.05rem}.cx-meta{color:var(--muted);font-size:.92rem}.cx-btn{flex-shrink:0}.cx-empty{text-align:center;padding:24px 0}@media (max-width:767px){.cx-item{flex-direction:column;align-items:flex-start}}`;
