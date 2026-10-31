// Modern section types: video, embed, tabs, timeline, comparison, marquee,
// social links, spacer and a custom form builder. Published sites stay
// script-free: tabs use radio inputs, the marquee is a CSS animation, and
// videos/embeds come only from an allowlist of hosts.
import type { FieldDef, SectionDef } from "./model";
import { esc, safeImageUrl } from "./html";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const has = (v: unknown) => str(v).trim().length > 0;
const arr = <T = P>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const F = (path: string) => ` data-f="${path}"`;
const paras = (t: unknown, path?: string) =>
  str(t)
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p${path ? F(path) : ""}>${esc(x).replace(/\n/g, "<br>")}</p>`)
    .join("");
const head = (p: P) =>
  has(p.heading) || has(p.subheading) ? `<header class="sec-head">${has(p.heading) ? `<h2${F("heading")}>${esc(p.heading)}</h2>` : ""}${has(p.subheading) ? `<p class="lead"${F("subheading")}>${esc(p.subheading)}</p>` : ""}</header>` : "";

export const FORM_FIELD_TYPES = ["text", "email", "tel", "number", "textarea", "select", "radio", "checkbox", "date", "time", "url"] as const;
export const SOCIAL_NETWORKS = ["instagram", "x", "facebook", "linkedin", "youtube", "tiktok", "github", "whatsapp", "pinterest", "threads", "dribbble", "behance", "email", "website"] as const;

const heading: FieldDef[] = [
  { key: "heading", label: "Heading", kind: "text", max: 140 },
  { key: "subheading", label: "Supporting text", kind: "textarea", max: 400 },
];

export const EXTRA_SECTION_DEFS: SectionDef[] = [
  {
    type: "video",
    label: "Video",
    description: "YouTube, Vimeo or your own video file",
    category: "Content",
    fields: [
      ...heading,
      { key: "url", label: "Video link (YouTube, Vimeo or .mp4/.webm)", kind: "url" },
      { key: "poster", label: "Cover image (for video files)", kind: "image" },
      { key: "caption", label: "Caption", kind: "text", max: 200 },
      { key: "aspect", label: "Shape", kind: "select", options: [{ value: "16/9", label: "Widescreen 16:9" }, { value: "21/9", label: "Cinema 21:9" }, { value: "4/3", label: "Classic 4:3" }, { value: "1/1", label: "Square" }, { value: "9/16", label: "Vertical 9:16" }] },
      { key: "autoplay", label: "Autoplay muted on loop (video files)", kind: "boolean" },
      { key: "body", label: "Text beside the video (side-by-side layout)", kind: "textarea", max: 800 },
    ],
    defaults: () => ({ heading: "See it in action", subheading: "", url: "", poster: "", caption: "", aspect: "16/9", autoplay: false, body: "" }),
  },
  {
    type: "embed",
    label: "Embed",
    description: "Calendly, Typeform, Spotify, Loom, Figma, Google Maps…",
    category: "Content",
    fields: [...heading, { key: "url", label: "Share or embed link", kind: "url" }, { key: "height", label: "Height (px)", kind: "number", min: 160, max: 1400 }, { key: "caption", label: "Caption", kind: "text", max: 200 }],
    defaults: () => ({ heading: "", subheading: "", url: "", height: 600, caption: "" }),
  },
  {
    type: "tabs",
    label: "Tabs",
    description: "Switch between panels of text and images",
    category: "Content",
    fields: [...heading, { key: "items", label: "Tabs", kind: "list", itemLabel: "Tab", maxItems: 8, fields: [{ key: "title", label: "Tab label", kind: "text", max: 40 }, { key: "body", label: "Text", kind: "textarea", max: 1200 }, { key: "image", label: "Image", kind: "image" }] }],
    defaults: () => ({ heading: "How we work", subheading: "", items: [{ title: "Discover", body: "We start by listening.", image: "" }, { title: "Design", body: "Ideas take shape quickly.", image: "" }, { title: "Deliver", body: "Launched, measured and improved.", image: "" }] }),
  },
  {
    type: "timeline",
    label: "Timeline",
    description: "Milestones, history or a roadmap",
    category: "Content",
    fields: [...heading, { key: "items", label: "Milestones", kind: "list", itemLabel: "Milestone", maxItems: 20, fields: [{ key: "date", label: "Date or label", kind: "text", max: 40 }, { key: "title", label: "Title", kind: "text", max: 120 }, { key: "body", label: "Text", kind: "textarea", max: 600 }] }],
    defaults: () => ({ heading: "Our story", subheading: "", items: [{ date: "2019", title: "Founded", body: "Started in a small studio." }, { date: "2022", title: "Growing", body: "A team of twelve." }, { date: "Today", title: "Still curious", body: "Serving customers worldwide." }] }),
  },
  {
    type: "comparison",
    label: "Comparison table",
    description: "Compare plans or options feature by feature",
    category: "Conversion",
    fields: [
      ...heading,
      { key: "columns", label: "Columns (plans or options)", kind: "strings", itemLabel: "Column", maxItems: 5 },
      { key: "highlight", label: "Highlighted column (1–5, 0 for none)", kind: "number", min: 0, max: 5 },
      { key: "rows", label: "Rows", kind: "list", itemLabel: "Row", maxItems: 30, fields: [{ key: "feature", label: "Feature", kind: "text", max: 120 }, { key: "values", label: "Values, separated by | (yes, no or text)", kind: "text", max: 300 }] },
    ],
    defaults: () => ({ heading: "Compare plans", subheading: "", columns: ["Starter", "Pro", "Business"], highlight: 2, rows: [{ feature: "Projects", values: "3 | Unlimited | Unlimited" }, { feature: "Custom domain", values: "no | yes | yes" }, { feature: "Priority support", values: "no | no | yes" }] }),
  },
  {
    type: "marquee",
    label: "Scrolling text",
    description: "A bold, continuously scrolling line of words",
    category: "Structure",
    fields: [
      { key: "items", label: "Words or phrases", kind: "strings", itemLabel: "Phrase", maxItems: 12 },
      { key: "separator", label: "Separator", kind: "text", max: 4 },
      { key: "speed", label: "Speed", kind: "select", options: [{ value: "slow", label: "Slow" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }] },
      { key: "reverse", label: "Scroll right to left reversed", kind: "boolean" },
    ],
    defaults: () => ({ items: ["Design", "Build", "Launch", "Grow"], separator: "✦", speed: "normal", reverse: false }),
  },
  {
    type: "socials",
    label: "Social links",
    description: "Links to your profiles",
    category: "Structure",
    fields: [{ key: "heading", label: "Heading", kind: "text", max: 120 }, { key: "links", label: "Profiles", kind: "list", itemLabel: "Profile", maxItems: 14, fields: [{ key: "network", label: "Network", kind: "select", options: SOCIAL_NETWORKS.map((n) => ({ value: n, label: n === "x" ? "X (Twitter)" : n[0].toUpperCase() + n.slice(1) })) }, { key: "url", label: "Link", kind: "url" }] }],
    defaults: () => ({ heading: "Follow along", links: [{ network: "instagram", url: "" }, { network: "linkedin", url: "" }] }),
  },
  {
    type: "spacer",
    label: "Spacer / divider",
    description: "Breathing room or a line between sections",
    category: "Structure",
    fields: [{ key: "height", label: "Height (px)", kind: "number", min: 0, max: 400 }, { key: "line", label: "Show a line", kind: "boolean" }],
    defaults: () => ({ height: 64, line: false }),
  },
  {
    type: "form",
    label: "Custom form",
    description: "Build any form; send answers to your inbox, a data table and automations",
    category: "Conversion",
    fields: [
      ...heading,
      {
        key: "fields",
        label: "Fields",
        kind: "list",
        itemLabel: "Field",
        maxItems: 25,
        fields: [
          { key: "label", label: "Label", kind: "text", max: 80 },
          { key: "name", label: "Key (matches a data table field; letters and _)", kind: "text", max: 40 },
          { key: "type", label: "Type", kind: "select", options: FORM_FIELD_TYPES.map((t) => ({ value: t, label: { text: "Short text", email: "Email", tel: "Phone", number: "Number", textarea: "Long text", select: "Dropdown", radio: "Choice", checkbox: "Checkbox", date: "Date", time: "Time", url: "Website" }[t] })) },
          { key: "options", label: "Options (for dropdown/choice, separated by commas)", kind: "text", max: 400 },
          { key: "placeholder", label: "Placeholder", kind: "text", max: 80 },
          { key: "required", label: "Required", kind: "boolean" },
          { key: "half", label: "Half width", kind: "boolean" },
        ],
      },
      { key: "submitLabel", label: "Button label", kind: "text", max: 40 },
      { key: "successMessage", label: "Message after sending", kind: "text", max: 200 },
      { key: "table", label: "Also save to data table (API name, optional)", kind: "text", max: 40 },
      { key: "notifyEmail", label: "Email each submission to (optional)", kind: "text", max: 200 },
    ],
    defaults: () => ({
      heading: "Request a quote",
      subheading: "Tell us about your project and we'll reply within a day.",
      fields: [
        { label: "Name", name: "name", type: "text", required: true, half: true, options: "", placeholder: "" },
        { label: "Email", name: "email", type: "email", required: true, half: true, options: "", placeholder: "" },
        { label: "Budget", name: "budget", type: "select", required: false, half: false, options: "Under ₹50k, ₹50k–₹2L, Above ₹2L", placeholder: "" },
        { label: "Details", name: "details", type: "textarea", required: true, half: false, options: "", placeholder: "" },
      ],
      submitLabel: "Send",
      successMessage: "Thanks — we'll be in touch soon.",
      table: "",
      notifyEmail: "",
    }),
  },
];

export const EXTRA_VARIANTS: Record<string, { value: string; label: string }[]> = {
  video: [{ value: "contained", label: "Contained" }, { value: "wide", label: "Full width" }, { value: "split", label: "Beside text" }],
  embed: [{ value: "contained", label: "Contained" }, { value: "wide", label: "Full width" }],
  tabs: [{ value: "tabs", label: "Tabs" }, { value: "pills", label: "Pills" }, { value: "side", label: "Side menu" }],
  timeline: [{ value: "vertical", label: "Vertical" }, { value: "alternating", label: "Alternating" }, { value: "horizontal", label: "Horizontal" }],
  comparison: [{ value: "table", label: "Table" }, { value: "cards", label: "Cards on phones" }],
  marquee: [{ value: "bold", label: "Bold" }, { value: "outline", label: "Outlined" }, { value: "subtle", label: "Subtle" }],
  socials: [{ value: "icons", label: "Icons" }, { value: "buttons", label: "Buttons" }, { value: "list", label: "List" }],
  spacer: [{ value: "default", label: "Default" }],
  form: [{ value: "card", label: "Card" }, { value: "plain", label: "Plain" }, { value: "split", label: "Beside heading" }],
};

// ── Video & embeds: only known hosts, converted to their embed URLs ──

export function videoEmbed(raw: unknown): { kind: "iframe" | "file"; src: string } | null {
  const s = str(raw).trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.pathname.startsWith("/embed/") ? u.pathname.slice(7) : u.pathname.startsWith("/shorts/") ? u.pathname.slice(8) : u.searchParams.get("v") ?? "";
    return /^[\w-]{6,20}$/.test(id) ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}?rel=0` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/(\d{5,12})/)?.[1];
    return id ? { kind: "iframe", src: `https://player.vimeo.com/video/${id}?dnt=1` } : null;
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: "file", src: u.toString() };
  return null;
}

const EMBED_HOSTS: Record<string, (u: URL) => string | null> = {
  "calendly.com": (u) => `https://calendly.com${u.pathname}?hide_gdpr_banner=1`,
  "form.typeform.com": (u) => `https://form.typeform.com${u.pathname}`,
  "open.spotify.com": (u) => `https://open.spotify.com/embed${u.pathname.replace(/^\/embed/, "")}`,
  "www.loom.com": (u) => `https://www.loom.com/embed/${u.pathname.split("/").pop()}`,
  "loom.com": (u) => `https://www.loom.com/embed/${u.pathname.split("/").pop()}`,
  "www.figma.com": (u) => `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(u.toString())}`,
  "figma.com": (u) => `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(u.toString())}`,
  "docs.google.com": (u) => (u.pathname.startsWith("/forms/") || u.pathname.startsWith("/presentation/") || u.pathname.startsWith("/spreadsheets/") ? u.toString() : null),
  "www.google.com": (u) => (u.pathname.startsWith("/maps") ? u.toString() : null),
  "codepen.io": (u) => `https://codepen.io${u.pathname.replace("/pen/", "/embed/")}`,
  "airtable.com": (u) => (u.pathname.startsWith("/embed/") ? u.toString() : `https://airtable.com/embed${u.pathname}`),
  "tally.so": (u) => `https://tally.so/embed${u.pathname.replace(/^\/(r|embed)/, "")}`,
};
/** Hosts published pages may frame (kept in sync with the site CSP). */
export const FRAME_HOSTS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://calendly.com", "https://form.typeform.com", "https://open.spotify.com", "https://www.loom.com", "https://www.figma.com", "https://docs.google.com", "https://www.google.com", "https://codepen.io", "https://airtable.com", "https://tally.so"];

export function embedSrc(raw: unknown): string | null {
  const v = videoEmbed(raw);
  if (v?.kind === "iframe") return v.src;
  try {
    const u = new URL(str(raw).trim());
    if (u.protocol !== "https:") return null;
    const fn = EMBED_HOSTS[u.hostname];
    return fn ? fn(u) : null;
  } catch {
    return null;
  }
}

// ── Social icons (simple monochrome glyphs, no external requests) ──

const SOCIAL_SVG: Record<string, string> = {
  instagram: `<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>`,
  x: `<path d="M4 4l16 16M20 4L4 20"/>`,
  facebook: `<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>`,
  linkedin: `<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 11v5M8 8v.01M12 16v-5M12 13a2 2 0 0 1 4 0v3"/>`,
  youtube: `<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor"/>`,
  tiktok: `<path d="M14 3v11a4 4 0 1 1-4-4M14 3c.5 2.5 2.5 4 5 4"/>`,
  github: `<path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>`,
  whatsapp: `<path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 7.6 19.4z"/><path d="M9 9.5c.5 2 2 3.5 4 4l1.2-1.2 2 1-.5 1.7c-3 .5-7.4-3.9-6.9-6.9L10.5 7.6l1 2z"/>`,
  pinterest: `<circle cx="12" cy="12" r="9"/><path d="M11 8.5c3-1 5 1 4.2 3.6-.6 2-2.6 2.4-3.4 1M11.5 10l-2 9"/>`,
  threads: `<path d="M17 8.5C16 5.5 14 4 11.5 4 7.5 4 5 7 5 12s2.5 8 6.5 8c3 0 5.5-1.8 5.5-4.5 0-4-6-4.5-7-2.5-.8 1.6.6 3 2.3 3 2.7 0 3.7-3 2.7-6"/>`,
  dribbble: `<circle cx="12" cy="12" r="9"/><path d="M4 9c6 0 11-1 15-4M6 19c2-5 6-8 13-7M9 3.5c3 4 5 10 6 17"/>`,
  behance: `<path d="M3 7h5a2.5 2.5 0 0 1 0 5H3zm0 5h5.5a2.5 2.5 0 0 1 0 5H3zM14 6h5M13.5 14h7a3.5 3.5 0 1 0-1 2.5"/>`,
  email: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>`,
  website: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>`,
};
const socialIcon = (n: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SOCIAL_SVG[n] ?? SOCIAL_SVG.website}</svg>`;
const NETWORK_LABEL = (n: string) => (n === "x" ? "X" : n === "email" ? "Email" : n === "website" ? "Website" : n[0].toUpperCase() + n.slice(1));

function safeLink(u: unknown): string {
  const s = str(u).trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  try {
    const x = new URL(s);
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : "";
  } catch {
    return "";
  }
}

// ── Renderers ──

export type FormCtx = { open: (formId: string, cls: string) => string; notice: string; honeypot: string; editor: boolean };

/** The form id posted for a custom form section. */
export const customFormId = (sectionId: string) => `x-${sectionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60)}`;
export const fieldName = (f: P, i: number) => (/^[a-z][a-z0-9_]{0,39}$/i.test(str(f.name)) ? str(f.name) : `field_${i + 1}`);

export function renderExtra(type: string, id: string, p: P, v: string, ctx: { editor: boolean; form: FormCtx }): string | null {
  switch (type) {
    case "video": {
      const vid = videoEmbed(p.url);
      const aspect = /^\d{1,2}\/\d{1,2}$/.test(str(p.aspect)) ? str(p.aspect) : "16/9";
      const poster = safeImageUrl(p.poster);
      const media = !vid
        ? `<div class="vid-frame vid-empty" style="aspect-ratio:${aspect}">${ctx.editor ? "Paste a YouTube, Vimeo or video file link" : ""}</div>`
        : vid.kind === "iframe"
          ? `<div class="vid-frame" style="aspect-ratio:${aspect}"><iframe src="${esc(vid.src)}" title="${esc(p.heading || "Video")}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
          : `<div class="vid-frame" style="aspect-ratio:${aspect}"><video src="${esc(vid.src)}"${poster ? ` poster="${esc(poster)}"` : ""} ${p.autoplay ? "autoplay muted loop playsinline" : "controls"} preload="metadata"></video></div>`;
      const cap = has(p.caption) ? `<p class="muted vid-cap"${F("caption")}>${esc(p.caption)}</p>` : "";
      if (v === "split") return `<div class="wrap split vid-split"><div class="split-copy reveal">${head(p)}${paras(p.body, "body")}</div><div class="reveal">${media}${cap}</div></div>`;
      return `<div class="${v === "wide" ? "wrap vid-wide" : "wrap"}">${head(p)}<div class="reveal">${media}${cap}</div></div>`;
    }
    case "embed": {
      const src = embedSrc(p.url);
      const h = Math.min(1400, Math.max(160, Number(p.height) || 600));
      const frame = src
        ? `<iframe class="embed-frame" src="${esc(src)}" title="${esc(p.heading || "Embedded content")}" style="height:${h}px" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" allow="encrypted-media; fullscreen; clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        : `<div class="embed-frame vid-empty" style="height:${Math.min(h, 320)}px">${ctx.editor ? "Paste a Calendly, Typeform, Spotify, Loom, Figma, Google, Tally, Airtable or CodePen link" : ""}</div>`;
      return `<div class="wrap${v === "wide" ? " vid-wide" : ""}">${head(p)}<div class="reveal">${frame}${has(p.caption) ? `<p class="muted vid-cap"${F("caption")}>${esc(p.caption)}</p>` : ""}</div></div>`;
    }
    case "tabs": {
      const items = arr(p.items).slice(0, 8);
      const group = `tabs-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
      const inputs = items.map((_, n) => `<input type="radio" class="tab-input" name="${group}" id="${group}-${n}"${n === 0 ? " checked" : ""}>`).join("");
      const labels = items.map((t, n) => `<label for="${group}-${n}" class="tab-label"${F(`items.${n}.title`)}>${esc(t.title)}</label>`).join("");
      const panels = items
        .map((t, n) => {
          const im = safeImageUrl(t.image);
          return `<div class="tab-panel">${im ? `<img src="${esc(im)}" alt="" loading="lazy">` : ""}<div>${paras(t.body, `items.${n}.body`)}</div></div>`;
        })
        .join("");
      // Each checked radio shows its panel via :nth-of-type rules.
      const rules = items.map((_, n) => `#${group}-${n}:checked~.tab-labels label:nth-of-type(${n + 1}){color:var(--accent-text);background:var(--accent);border-color:var(--accent)}#${group}-${n}:checked~.tab-panels .tab-panel:nth-of-type(${n + 1}){display:grid}`).join("");
      return `<div class="wrap">${head(p)}<div class="tabs tabs-${v} reveal">${inputs}<div class="tab-labels" role="tablist">${labels}</div><div class="tab-panels">${panels}</div><style>${rules}</style></div></div>`;
    }
    case "timeline": {
      const items = arr(p.items);
      return `<div class="wrap${v === "horizontal" ? "" : " narrow"}">${head(p)}<ol class="tl tl-${v}">${items
        .map((t, n) => `<li class="tl-item reveal"><span class="tl-date"${F(`items.${n}.date`)}>${esc(t.date)}</span><h3${F(`items.${n}.title`)}>${esc(t.title)}</h3>${paras(t.body, `items.${n}.body`)}</li>`)
        .join("")}</ol></div>`;
    }
    case "comparison": {
      const cols = arr<string>(p.columns).map(str).filter(Boolean).slice(0, 5);
      const hl = Number(p.highlight) || 0;
      const cell = (raw: string) => {
        const x = raw.trim();
        if (/^(yes|y|true|✓|✔)$/i.test(x)) return `<span class="cmp-yes" aria-label="Yes">✓</span>`;
        if (/^(no|n|false|✗|-|—)$/i.test(x)) return `<span class="cmp-no" aria-label="No">—</span>`;
        return esc(x);
      };
      const rows = arr(p.rows)
        .map((r, n) => {
          const vals = str(r.values).split("|");
          return `<tr><th scope="row"${F(`rows.${n}.feature`)}>${esc(r.feature)}</th>${cols.map((c, i) => `<td data-label="${esc(c)}"${i + 1 === hl ? ' class="cmp-hl"' : ""}>${cell(vals[i] ?? "")}</td>`).join("")}</tr>`;
        })
        .join("");
      return `<div class="wrap">${head(p)}<div class="cmp-wrap reveal${v === "cards" ? " cmp-cards" : ""}"><table class="cmp"><thead><tr><th></th>${cols.map((c, i) => `<th scope="col"${i + 1 === hl ? ' class="cmp-hl"' : ""}>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }
    case "marquee": {
      const items = arr<string>(p.items).map(str).filter(Boolean);
      const sep = esc(str(p.separator).slice(0, 4) || "•");
      const row = items.map((t) => `<span>${esc(t)}</span><span class="mq-sep" aria-hidden="true">${sep}</span>`).join("");
      const speed = { slow: 60, normal: 36, fast: 18 }[str(p.speed) as "slow"] ?? 36;
      return `<div class="mq mq-${v}${p.reverse ? " mq-rev" : ""}" style="--mq-speed:${speed}s"><div class="mq-track"><div class="mq-row">${row}</div><div class="mq-row" aria-hidden="true">${row}</div></div></div>`;
    }
    case "socials": {
      const links = arr(p.links)
        .map((l) => ({ n: (SOCIAL_SVG[str(l.network)] ? str(l.network) : "website") as string, href: safeLink(l.url) }))
        .filter((l) => l.href || ctx.editor);
      return `<div class="wrap socials socials-${v}">${has(p.heading) ? `<p class="socials-head"${F("heading")}>${esc(p.heading)}</p>` : ""}<div class="socials-row">${links
        .map((l) => `<a href="${esc(l.href || "#")}" rel="noopener me" target="_blank" aria-label="${esc(NETWORK_LABEL(l.n))}">${socialIcon(l.n)}${v === "icons" ? "" : `<span>${esc(NETWORK_LABEL(l.n))}</span>`}</a>`)
        .join("")}</div></div>`;
    }
    case "spacer": {
      const h = Math.min(400, Math.max(0, Number(p.height) || 0));
      return `<div class="wrap spacer" style="height:${h}px">${p.line ? `<hr class="spacer-line">` : ""}</div>`;
    }
    case "form": {
      const fid = customFormId(id);
      const fields = arr(p.fields).slice(0, 25);
      const input = (f: P, i: number) => {
        const name = fieldName(f, i);
        const type = (FORM_FIELD_TYPES as readonly string[]).includes(str(f.type)) ? str(f.type) : "text";
        const req = f.required ? " required" : "";
        const ph = has(f.placeholder) ? ` placeholder="${esc(f.placeholder)}"` : "";
        const opts = str(f.options).split(",").map((o) => o.trim()).filter(Boolean).slice(0, 30);
        const label = `<span${F(`fields.${i}.label`)}>${esc(f.label || name)}${f.required ? ` <span class="req" aria-hidden="true">*</span>` : ""}</span>`;
        const cls = f.half ? "ff-half" : "ff-full";
        if (type === "textarea") return `<label class="${cls}">${label}<textarea name="${name}" rows="4" maxlength="4000"${req}${ph}></textarea></label>`;
        if (type === "select") return `<label class="${cls}">${label}<select name="${name}"${req}><option value="">Choose…</option>${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
        if (type === "radio") return `<fieldset class="${cls} choice"><legend>${label}</legend>${opts.map((o, k) => `<label class="opt"><input type="radio" name="${name}" value="${esc(o)}"${req && k === 0 ? " required" : ""}> ${esc(o)}</label>`).join("")}</fieldset>`;
        if (type === "checkbox") return `<label class="${cls} opt check-opt"><input type="checkbox" name="${name}" value="yes"${req}> ${label}</label>`;
        const auto = type === "email" ? ' autocomplete="email"' : type === "tel" ? ' autocomplete="tel"' : name === "name" ? ' autocomplete="name"' : "";
        return `<label class="${cls}">${label}<input type="${type}" name="${name}" maxlength="500"${req}${ph}${auto}></label>`;
      };
      const form = `${ctx.form.open(fid, v === "plain" ? "form xform" : "form xform card form-card")}${ctx.form.honeypot}<div class="xform-grid">${fields.map(input).join("")}</div><button class="btn btn-primary" type="submit"${F("submitLabel")}>${esc(str(p.submitLabel) || "Send")}</button>${ctx.form.notice}</form>`;
      if (v === "split") return `<div class="wrap split xform-split"><div class="reveal">${head(p)}</div><div class="reveal">${form}</div></div>`;
      return `<div class="wrap narrow reveal">${head(p)}${form}</div>`;
    }
  }
  return null;
}

export const EXTRA_CSS = `.vid-frame{position:relative;width:100%;border-radius:var(--radius);overflow:hidden;background:color-mix(in srgb,var(--text) 6%,var(--bg))}.vid-frame iframe,.vid-frame video{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover}.vid-empty{display:grid;place-items:center;color:var(--muted);font-size:.95rem;border:1px dashed var(--line);border-radius:var(--radius)}.vid-cap{margin-top:12px;text-align:center}.vid-wide{max-width:min(1600px,100%)}
.embed-frame{width:100%;border:0;border-radius:var(--radius);background:var(--surface);display:block}
.tabs .tab-input{position:absolute;opacity:0;pointer-events:none}.tab-labels{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}.tab-label{cursor:pointer;padding:10px 18px;border:1px solid var(--line);border-radius:999px;font-weight:600;font-size:.95rem;transition:background .2s,color .2s}.tab-label:hover{border-color:var(--text)}.tabs-tabs .tab-labels{border-bottom:1px solid var(--line);gap:0}.tabs-tabs .tab-label{border:0;border-radius:0;padding:12px 18px;border-bottom:2px solid transparent;margin-bottom:-1px;background:none!important}.tab-input:focus-visible~.tab-labels{outline:2px solid var(--accent);outline-offset:4px}
.tab-panel{display:none;gap:32px;grid-template-columns:1fr;align-items:center}.tab-panel:has(img){grid-template-columns:1.1fr 1fr}.tab-panel img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius)}
.tabs-side{display:grid;grid-template-columns:220px 1fr;gap:32px}.tabs-side .tab-labels{flex-direction:column;margin:0}.tabs-side .tab-label{border-radius:var(--radius)}
@media (max-width:767px){.tabs-side{grid-template-columns:1fr}.tab-panel:has(img){grid-template-columns:1fr}}
.tl{list-style:none;margin:0;padding:0;position:relative}.tl-vertical,.tl-alternating{border-left:2px solid var(--line);padding-left:28px}.tl-item{position:relative;padding:0 0 36px}.tl-vertical .tl-item::before,.tl-alternating .tl-item::before{content:"";position:absolute;left:-36px;top:6px;width:14px;height:14px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--bg)}.tl-date{display:inline-block;font-weight:700;color:var(--accent);font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}.tl-item h3{margin:0 0 6px}
@media (min-width:900px){.tl-alternating{border:0;padding:0}.tl-alternating::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:2px;background:var(--line)}.tl-alternating .tl-item{width:50%;padding:0 48px 40px 0;text-align:right}.tl-alternating .tl-item:nth-child(even){margin-left:50%;padding:0 0 40px 48px;text-align:left}.tl-alternating .tl-item::before{left:auto;right:-7px}.tl-alternating .tl-item:nth-child(even)::before{left:-7px;right:auto}}
.tl-horizontal{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:24px;overflow-x:auto;border-top:2px solid var(--line);padding-top:28px;scroll-snap-type:x mandatory}.tl-horizontal .tl-item{scroll-snap-align:start}.tl-horizontal .tl-item::before{content:"";position:absolute;top:-36px;left:0;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.cmp-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius)}.cmp{width:100%;border-collapse:collapse;font-size:.97rem}.cmp th,.cmp td{padding:14px 18px;text-align:center;border-bottom:1px solid var(--line)}.cmp th[scope=row]{text-align:left;font-weight:500}.cmp thead th{font-family:var(--heading-font);font-size:1.05rem}.cmp tbody tr:last-child>*{border-bottom:0}.cmp .cmp-hl{background:color-mix(in srgb,var(--accent) 9%,transparent)}.cmp thead .cmp-hl{color:var(--accent)}.cmp-yes{color:var(--accent);font-weight:700}.cmp-no{color:var(--muted)}
@media (max-width:640px){.cmp-cards .cmp thead{display:none}.cmp-cards .cmp,.cmp-cards .cmp tbody,.cmp-cards .cmp tr,.cmp-cards .cmp th,.cmp-cards .cmp td{display:block}.cmp-cards .cmp tr{border-bottom:1px solid var(--line);padding:10px 0}.cmp-cards .cmp td{display:flex;justify-content:space-between;border:0;padding:6px 18px}.cmp-cards .cmp td::before{content:attr(data-label);color:var(--muted)}}
.mq{overflow:hidden;padding:clamp(18px,3vw,36px) 0;-webkit-mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}.mq-track{display:flex;width:max-content;animation:mq var(--mq-speed,36s) linear infinite}.mq-rev .mq-track{animation-direction:reverse}.mq-row{display:flex;align-items:center;gap:clamp(20px,3vw,48px);padding-right:clamp(20px,3vw,48px);font-family:var(--heading-font);font-weight:700;font-size:clamp(2rem,6vw,5.5rem);line-height:1;white-space:nowrap;letter-spacing:-.02em}.mq-sep{color:var(--accent);font-size:.6em}.mq-outline .mq-row span:not(.mq-sep){color:transparent;-webkit-text-stroke:1.5px var(--text)}.mq-subtle .mq-row{font-size:clamp(1.1rem,2.2vw,1.6rem);font-weight:500;color:var(--muted)}.mq:hover .mq-track{animation-play-state:paused}@keyframes mq{to{transform:translateX(-50%)}}@media (prefers-reduced-motion:reduce){.mq-track{animation:none}}
.marquee{overflow:hidden;-webkit-mask:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}.marquee-track{display:flex;gap:56px;width:max-content;animation:mq 40s linear infinite;align-items:center}.marquee:hover .marquee-track{animation-play-state:paused}@media (prefers-reduced-motion:reduce){.marquee-track{animation:none}}
.carousel{display:grid;grid-auto-flow:column;grid-auto-columns:min(420px,85%);gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:12px;scrollbar-width:thin}.carousel>*{scroll-snap-align:start}
.socials{text-align:center}.socials-head{color:var(--muted);margin:0 0 16px;font-size:.95rem}.socials-row{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}.socials-row a{display:inline-flex;align-items:center;gap:8px;color:var(--text);text-decoration:none;transition:transform .2s,background .2s,color .2s}.socials-icons .socials-row a{width:46px;height:46px;justify-content:center;border-radius:50%;border:1px solid var(--line)}.socials-icons .socials-row a:hover{background:var(--accent);color:var(--accent-text);border-color:var(--accent);transform:translateY(-2px)}.socials-buttons .socials-row a{padding:10px 18px;border-radius:999px;background:var(--surface);font-weight:600;font-size:.95rem}.socials-buttons .socials-row a:hover{background:var(--accent);color:var(--accent-text)}.socials-list .socials-row{flex-direction:column;align-items:center}
.spacer{display:flex;align-items:center}.spacer-line{width:100%;border:0;border-top:1px solid var(--line);margin:0}
.xform-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 18px;margin-bottom:20px}.xform-grid .ff-full{grid-column:1/-1}.xform-grid label,.xform-grid fieldset{display:grid;gap:6px;font-weight:500;font-size:.95rem;margin:0}.xform-grid fieldset{border:0;padding:0}.xform-grid .opt{display:flex!important;justify-content:flex-start;gap:10px;align-items:center;font-weight:400}.xform-grid .opt input{width:auto!important;height:auto;margin:0;flex:none;accent-color:var(--accent)}.xform-grid fieldset.choice{display:flex;flex-wrap:wrap;gap:6px 20px}.xform-grid fieldset.choice legend{width:100%;margin-bottom:6px}.xform-grid .check-opt{grid-column:1/-1}.xform .req{color:var(--accent)}@media (max-width:640px){.xform-grid{grid-template-columns:1fr}}`;
