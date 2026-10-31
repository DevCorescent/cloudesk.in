// Email signatures: the details a person fills in once, and ready-made designs
// that turn them into email-safe HTML (tables and inline styles only — what
// Gmail, Outlook and Apple Mail all render) plus a plain-text version. Every
// value is escaped and every link must be https (or mailto/tel, built here),
// so a signature can't carry scripts or odd links. Used by the editor's live
// preview and by the server when it sends.
import { z } from "zod";

const https = z.union([z.literal(""), z.string().trim().max(500).regex(/^https:\/\/[^\s"'<>]+$/i, "Use a full https:// link")]);
/** An uploaded signature image (/mail-img/<id>) or an https link. */
const image = z.union([z.literal(""), z.string().trim().max(500).regex(/^(https:\/\/[^\s"'<>]+|\/mail-img\/[0-9a-f-]{36})$/i, "Use an uploaded image or an https:// link")]);
const line = (max = 120) => z.string().trim().max(max).default("");

export const signatureFields = z.object({
  name: z.string().trim().min(1, "Add your name").max(80),
  title: line(),
  department: line(),
  company: line(),
  phone: line(40),
  mobile: line(40),
  email: z.union([z.literal(""), z.email("Check the email")]).default(""),
  website: https.default(""),
  address: line(240),
  logo: image.default(""),
  photo: image.default(""),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#0b5cad"),
  linkedin: https.default(""),
  twitter: https.default(""),
  instagram: https.default(""),
  facebook: https.default(""),
  youtube: https.default(""),
  ctaLabel: line(40),
  ctaUrl: https.default(""),
  tagline: line(160),
  disclaimer: z.string().trim().max(1200).default(""),
});
export type SignatureFields = z.infer<typeof signatureFields>;

export const DESIGNS = [
  { id: "corporate", name: "Corporate", line: "Logo beside your details, with a brand-colour divider" },
  { id: "modern", name: "Modern", line: "Round photo, bold name and labelled contacts" },
  { id: "executive", name: "Executive", line: "Refined serif name with a brand band underneath" },
  { id: "banner", name: "Call to action", line: "Your details with a button — book a meeting, see the catalogue" },
  { id: "classic", name: "Classic", line: "Clean and timeless, works everywhere" },
  { id: "minimal", name: "Minimal", line: "Two quiet lines — great for internal mail" },
  { id: "compact", name: "Compact", line: "One line for replies and forwards" },
] as const;
export type DesignId = (typeof DESIGNS)[number]["id"];
export const DESIGN_IDS = DESIGNS.map((d) => d.id) as [DesignId, ...DesignId[]];

export const signatureSchema = z.object({
  name: z.string().trim().min(1, "Name this signature").max(60),
  design: z.enum(DESIGN_IDS),
  fields: signatureFields,
});

export const ACCENTS = ["#0b5cad", "#0f766e", "#1d4ed8", "#7c3aed", "#be123c", "#c2410c", "#111827", "#15803d"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "Arial,Helvetica,sans-serif";
const INK = "#1d1d1f";
const MUTED = "#6e6e73";
const bare = (url: string) => url.replace(/^https:\/\//i, "").replace(/\/$/, "");
const telHref = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

type Ctx = { f: SignatureFields; a: string; img: (u: string) => string };

const a = (href: string, label: string, color: string, extra = "") => `<a href="${esc(href)}" style="color:${color};text-decoration:none;${extra}">${esc(label)}</a>`;
const socials = ({ f }: Ctx) =>
  ([["LinkedIn", f.linkedin], ["X", f.twitter], ["Instagram", f.instagram], ["Facebook", f.facebook], ["YouTube", f.youtube]] as const).filter(([, u]) => u);

function socialRow(c: Ctx, size = 12) {
  const s = socials(c);
  if (!s.length) return "";
  return s.map(([label, u]) => a(u, label, c.a, `font-weight:600;font-size:${size}px`)).join(`<span style="color:#c7c7cc">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`);
}
/**
 * "T +91 … | M …" then "E name@… | W site.com" with labels in the accent colour.
 * Each item stays whole (no breaking inside a number); `split` puts phones and online details on separate lines.
 */
function contacts(c: Ctx, sep = " &nbsp;|&nbsp; ", labelled = true, split = false) {
  const { f } = c;
  const L = (t: string) => (labelled ? `<span style="color:${c.a};font-weight:700">${t}</span>&nbsp;` : "");
  const item = (html: string) => `<span style="white-space:nowrap">${html}</span>`;
  const phones = [f.phone && item(`${L("T")}${a(telHref(f.phone), f.phone, INK)}`), f.mobile && item(`${L("M")}${a(telHref(f.mobile), f.mobile, INK)}`)].filter(Boolean);
  const online = [f.email && item(`${L("E")}${a(`mailto:${f.email}`, f.email, INK)}`), f.website && item(`${L("W")}${a(f.website, bare(f.website), INK)}`)].filter(Boolean);
  const join = (xs: (string | false)[]) => xs.join(`<span style="color:#c7c7cc">${sep}</span>`);
  if (split) return [join(phones), join(online)].filter(Boolean).join("<br>");
  return join([...phones, ...online]);
}
const roleLine = (f: SignatureFields) => [f.title, f.department].filter(Boolean).join(", ");
const disclaimer = (f: SignatureFields) => (f.disclaimer ? `<tr><td colspan="3" style="padding-top:12px;font-family:${FONT};font-size:10px;line-height:1.45;color:#8e8e93;max-width:560px">${esc(f.disclaimer).replace(/\n/g, "<br>")}</td></tr>` : "");
const table = (inner: string, extra = "") => `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:${FONT};color:${INK};${extra}">${inner}</table>`;
const td = (html: string, style = "") => `<td style="font-family:${FONT};font-size:13px;line-height:1.5;color:${INK};vertical-align:top;${style}">${html}</td>`;
const tr = (...cells: string[]) => `<tr>${cells.join("")}</tr>`;

const RENDER: Record<DesignId, (c: Ctx) => string> = {
  corporate: (c) => {
    const { f } = c;
    const left = f.logo ? td(`<img src="${esc(c.img(f.logo))}" alt="${esc(f.company || f.name)}" width="96" style="display:block;width:96px;max-width:96px;height:auto;border:0">`, `padding:2px 18px 2px 0;border-right:2px solid ${c.a}`) : "";
    const right = [
      `<div style="font-size:16px;font-weight:700;color:#111;letter-spacing:-0.2px">${esc(f.name)}</div>`,
      roleLine(f) && `<div style="font-size:13px;color:${c.a};font-weight:600">${esc(roleLine(f))}</div>`,
      f.company && `<div style="font-size:13px;color:${MUTED}">${esc(f.company)}</div>`,
      contacts(c) && `<div style="padding-top:8px;font-size:12px;line-height:1.6">${contacts(c, " &nbsp;|&nbsp; ", true, true)}</div>`,
      f.address && `<div style="font-size:12px;color:${MUTED}">${esc(f.address)}</div>`,
      socialRow(c) && `<div style="padding-top:6px">${socialRow(c)}</div>`,
      f.tagline && `<div style="padding-top:8px;font-size:12px;font-style:italic;color:${MUTED}">${esc(f.tagline)}</div>`,
    ].filter(Boolean).join("");
    return table(tr(left, td(right, f.logo ? "padding-left:18px" : "")) + disclaimer(f));
  },
  modern: (c) => {
    const { f } = c;
    // A photo is shown round; without one, the logo is shown whole.
    const left = f.photo
      ? td(`<img src="${esc(c.img(f.photo))}" alt="${esc(f.name)}" width="76" height="76" style="display:block;width:76px;height:76px;border-radius:50%;border:0;object-fit:cover">`, "padding-right:16px")
      : f.logo
        ? td(`<img src="${esc(c.img(f.logo))}" alt="${esc(f.company || f.name)}" width="88" style="display:block;width:88px;height:auto;border:0">`, "padding-right:16px")
        : "";
    const line2 = [f.title, f.company].filter(Boolean).join(" · ");
    const right = [
      `<div style="font-size:18px;font-weight:800;color:#111;letter-spacing:-0.3px">${esc(f.name)}</div>`,
      line2 && `<div style="font-size:13px;font-weight:600;color:${c.a}">${esc(line2)}</div>`,
      f.department && `<div style="font-size:12px;color:${MUTED}">${esc(f.department)}</div>`,
      `<div style="height:8px;line-height:8px;font-size:0">&nbsp;</div>`,
      contacts(c, "<br>") && `<div style="font-size:12px;line-height:1.7">${contacts(c, "<br>")}</div>`,
      f.address && `<div style="font-size:12px;color:${MUTED}">${esc(f.address)}</div>`,
      socialRow(c) && `<div style="padding-top:8px">${socialRow(c)}</div>`,
    ].filter(Boolean).join("");
    return table(tr(left, td(right)) + (f.logo && f.photo ? tr(td(""), td(`<img src="${esc(c.img(f.logo))}" alt="${esc(f.company)}" height="28" style="display:block;height:28px;width:auto;border:0;margin-top:10px">`)) : "") + disclaimer(f));
  },
  executive: (c) => {
    const { f } = c;
    const band = [f.address && esc(f.address), f.website && a(f.website, bare(f.website), "#ffffff", "font-weight:700")].filter(Boolean).join("&nbsp;&nbsp;·&nbsp;&nbsp;");
    return table(
      tr(td(`<div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:#111">${esc(f.name)}</div>`, "padding-bottom:4px")) +
        (roleLine(f) || f.company ? tr(td(`<div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:${c.a};font-weight:700">${esc([roleLine(f), f.company].filter(Boolean).join("  |  "))}</div>`, "padding-bottom:10px")) : "") +
        tr(td(`<div style="width:56px;height:2px;background:${c.a};line-height:2px;font-size:0">&nbsp;</div>`, "padding-bottom:10px")) +
        (contacts(c, " &nbsp;&nbsp; ") ? tr(td(`<div style="font-size:12px">${contacts(c, " &nbsp;&nbsp; ")}</div>`)) : "") +
        (socialRow(c) ? tr(td(socialRow(c, 11), "padding-top:6px")) : "") +
        (band || f.logo ? tr(td(table(tr((f.logo ? td(`<img src="${esc(c.img(f.logo))}" alt="${esc(f.company)}" height="26" style="display:block;height:26px;width:auto;border:0">`, "padding:10px 14px;background:#ffffff") : "") + (band ? td(`<div style="font-size:11px;color:#ffffff">${band}</div>`, `padding:10px 14px;background:${c.a};vertical-align:middle`) : "")), `margin-top:12px;border:1px solid ${c.a}`))) : "") +
        (f.tagline ? tr(td(`<div style="font-size:11px;color:${MUTED};font-style:italic">${esc(f.tagline)}</div>`, "padding-top:8px")) : "") +
        disclaimer(f),
    );
  },
  banner: (c) => {
    const { f } = c;
    const details = [
      `<div style="font-size:16px;font-weight:700;color:#111">${esc(f.name)}</div>`,
      (roleLine(f) || f.company) && `<div style="font-size:13px;color:${MUTED}">${esc([roleLine(f), f.company].filter(Boolean).join(" · "))}</div>`,
      contacts(c) && `<div style="padding-top:6px;font-size:12px;line-height:1.6">${contacts(c, " &nbsp;|&nbsp; ", true, true)}</div>`,
      f.ctaUrl && `<div style="padding-top:12px"><a href="${esc(f.ctaUrl)}" style="display:inline-block;background:${c.a};color:#ffffff;font-family:${FONT};font-size:13px;font-weight:700;text-decoration:none;padding:9px 18px;border-radius:6px">${esc(f.ctaLabel || "Book a meeting")} &rarr;</a></div>`,
      socialRow(c) && `<div style="padding-top:10px">${socialRow(c)}</div>`,
    ].filter(Boolean).join("");
    const logo = f.logo ? td(`<img src="${esc(c.img(f.logo))}" alt="${esc(f.company)}" width="88" style="display:block;width:88px;height:auto;border:0">`, "padding-left:24px;vertical-align:middle") : "";
    return table(tr(td(details), logo) + (f.tagline ? tr(td(`<div style="font-size:12px;color:${MUTED};padding-top:10px">${esc(f.tagline)}</div>`)) : "") + disclaimer(f));
  },
  classic: (c) => {
    const { f } = c;
    return table(
      tr(td(`<div style="font-size:15px;font-weight:700;color:#111">${esc(f.name)}</div>`)) +
        (roleLine(f) ? tr(td(`<div style="font-size:13px;color:${INK}">${esc(roleLine(f))}</div>`)) : "") +
        (f.company ? tr(td(`<div style="font-size:13px;font-weight:700;color:${c.a}">${esc(f.company)}</div>`)) : "") +
        tr(td(`<div style="width:40px;height:2px;background:${c.a};line-height:2px;font-size:0;margin:8px 0">&nbsp;</div>`)) +
        (contacts(c, " &nbsp;|&nbsp; ", false) ? tr(td(`<div style="font-size:12px;line-height:1.6">${contacts(c, " &nbsp;|&nbsp; ", false, true)}</div>`)) : "") +
        (f.address ? tr(td(`<div style="font-size:12px;color:${MUTED}">${esc(f.address)}</div>`)) : "") +
        (socialRow(c) ? tr(td(socialRow(c), "padding-top:6px")) : "") +
        (f.logo ? tr(td(`<img src="${esc(c.img(f.logo))}" alt="${esc(f.company)}" height="30" style="display:block;height:30px;width:auto;border:0;margin-top:10px">`)) : "") +
        disclaimer(f),
    );
  },
  minimal: (c) => {
    const { f } = c;
    const top = [`<b style="color:#111">${esc(f.name)}</b>`, roleLine(f) && esc(roleLine(f)), f.company && esc(f.company)].filter(Boolean).join(`<span style="color:#c7c7cc"> · </span>`);
    return table(tr(td(`<div style="font-size:13px;color:${MUTED}">${top}</div>${contacts(c, " · ", false) ? `<div style="font-size:12px;color:${MUTED}">${contacts(c, " · ", false)}</div>` : ""}`)) + disclaimer(f));
  },
  compact: (c) => {
    const { f } = c;
    const bits = [`<b style="color:#111">${esc(f.name)}</b>`, f.title && esc(f.title), f.company && `<span style="color:${c.a};font-weight:600">${esc(f.company)}</span>`, f.mobile || f.phone ? `<span style="white-space:nowrap">${a(telHref(f.mobile || f.phone), f.mobile || f.phone, INK)}</span>` : ""].filter(Boolean);
    return table(tr(td(`<div style="font-size:12.5px;color:${MUTED}">${bits.join(`<span style="color:#c7c7cc"> &nbsp;|&nbsp; </span>`)}</div>`)));
  },
};

/** The plain-text version (for the text part of the email). */
export function signatureText(design: DesignId, f: SignatureFields) {
  if (design === "compact") return [f.name, f.title, f.company, f.mobile || f.phone].filter(Boolean).join(" | ");
  const lines = [
    f.name,
    [roleLine(f), design === "minimal" ? f.company : ""].filter(Boolean).join(" · "),
    design === "minimal" ? "" : f.company,
    [f.phone && `T ${f.phone}`, f.mobile && `M ${f.mobile}`, f.email, f.website && bare(f.website)].filter(Boolean).join(" | "),
    f.address,
    socials({ f, a: "", img: (u) => u }).map(([l, u]) => `${l}: ${u}`).join("  "),
    f.ctaUrl && design === "banner" ? `${f.ctaLabel || "Book a meeting"}: ${f.ctaUrl}` : "",
    f.tagline,
    f.disclaimer ? `\n${f.disclaimer}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Email-safe HTML. `origin` turns uploaded images (/mail-img/…) into full links recipients can load. */
export function signatureHtml(design: DesignId, f: SignatureFields, origin: string) {
  const img = (u: string) => (u.startsWith("/") ? `${origin.replace(/\/$/, "")}${u}` : u);
  const render = RENDER[design] ?? RENDER.classic;
  return `<div class="cc-signature" style="margin:0;padding:0">${render({ f, a: f.accent || "#0b5cad", img })}</div>`;
}

/** Splits a message body at the quoted part (reply quote or forwarded message), so the signature goes above it. */
export function splitQuote(body: string): [string, string] {
  const m = /\n*(?:On [^\n]{3,240} wrote:\n>|-{6,} Forwarded message -{6,})/.exec(body);
  return m ? [body.slice(0, m.index), body.slice(m.index)] : [body, ""];
}
