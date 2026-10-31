// Advanced design controls: per-section backgrounds, colours, typography,
// spacing, cards, dividers and custom CSS; per-element styles; and site-wide
// interface settings. Everything here is validated data turned into CSS by
// code — no user string reaches the stylesheet without being checked.
import { z } from "zod";
import { FONT_KEYS, fontStack } from "./fonts";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour");
const px = (min: number, max: number) => z.number().int().min(min).max(max);

export const DIVIDERS = ["none", "wave", "slant", "curve", "zigzag", "arc"] as const;
export const CARD_STYLES = ["theme", "flat", "outline", "shadow", "glass", "elevated"] as const;
export const WIDTHS = ["narrow", "normal", "wide", "full"] as const;
export const MIN_HEIGHTS = ["auto", "40vh", "60vh", "80vh", "100vh"] as const;

export const advSchema = z.object({
  bg: z
    .object({
      kind: z.enum(["none", "color", "gradient", "image", "video"]).default("none"),
      color: hex.optional(),
      color2: hex.optional(),
      angle: px(0, 360).optional(),
      radial: z.boolean().optional(),
      image: z.string().max(1000).optional(),
      video: z.string().max(1000).optional(),
      position: z.enum(["center", "top", "bottom", "left", "right"]).optional(),
      fixed: z.boolean().optional(),
      overlay: hex.optional(),
      overlayOpacity: px(0, 95).optional(),
      blur: px(0, 30).optional(),
    })
    .optional(),
  colors: z.object({ text: hex.optional(), heading: hex.optional(), muted: hex.optional(), accent: hex.optional(), accentText: hex.optional(), surface: hex.optional() }).optional(),
  type: z
    .object({
      headingFont: z.enum(FONT_KEYS).optional(),
      bodyFont: z.enum(FONT_KEYS).optional(),
      headingSize: px(14, 180).optional(),
      headingWeight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900)]).optional(),
      letterSpacing: z.number().min(-0.1).max(0.4).optional(),
      lineHeight: z.number().min(0.8).max(2.4).optional(),
      uppercase: z.boolean().optional(),
      bodySize: px(12, 28).optional(),
    })
    .optional(),
  space: z
    .object({
      top: px(0, 360).optional(),
      bottom: px(0, 360).optional(),
      width: z.enum(WIDTHS).optional(),
      minHeight: z.enum(MIN_HEIGHTS).optional(),
      valign: z.enum(["start", "center", "end"]).optional(),
      gap: px(0, 120).optional(),
      mobileTop: px(0, 240).optional(),
      mobileBottom: px(0, 240).optional(),
      mobileHeadingSize: px(14, 120).optional(),
    })
    .optional(),
  card: z.object({ style: z.enum(CARD_STYLES).optional(), radius: px(0, 64).optional(), imageRadius: px(0, 64).optional() }).optional(),
  border: z.object({ top: z.boolean().optional(), bottom: z.boolean().optional(), color: hex.optional(), radius: px(0, 64).optional(), inset: px(0, 64).optional() }).optional(),
  divider: z.object({ top: z.enum(DIVIDERS).optional(), bottom: z.enum(DIVIDERS).optional(), color: hex.optional(), height: px(16, 200).optional(), flip: z.boolean().optional() }).optional(),
  /** Overrides the automatic anchor (e.g. #pricing) for in-page links. */
  anchor: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "Lowercase letters, numbers and dashes").optional(),
  /** Scoped to this section; @-rules, imports and external URLs are refused. */
  css: z.string().max(6000).optional(),
});
export type Adv = z.infer<typeof advSchema>;

/** What an element can change on tablets or phones only. */
export const deviceElementSchema = z.object({
  color: hex.optional(),
  bg: hex.optional(),
  size: px(10, 200).optional(),
  weight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900)]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  letterSpacing: z.number().min(-0.1).max(0.4).optional(),
  lineHeight: z.number().min(0.8).max(2.4).optional(),
  padX: px(0, 80).optional(),
  padY: px(0, 60).optional(),
  maxWidth: px(0, 1600).optional(),
  hidden: z.boolean().optional(),
});
export type DeviceElementStyle = z.infer<typeof deviceElementSchema>;

/** How an element looks under the pointer. */
export const hoverSchema = z.object({
  color: hex.optional(),
  bg: hex.optional(),
  scale: px(90, 115).optional(),
  lift: z.boolean().optional(),
  shadow: z.enum(["none", "soft", "strong", "glow"]).optional(),
});

export const elementStyleSchema = z.object({
  color: hex.optional(),
  bg: hex.optional(),
  size: px(10, 200).optional(),
  mobileSize: px(10, 120).optional(),
  weight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900)]).optional(),
  italic: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  underline: z.boolean().optional(),
  letterSpacing: z.number().min(-0.1).max(0.4).optional(),
  lineHeight: z.number().min(0.8).max(2.4).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  font: z.enum(FONT_KEYS).optional(),
  radius: px(0, 64).optional(),
  padX: px(0, 80).optional(),
  padY: px(0, 60).optional(),
  maxWidth: px(0, 1600).optional(),
  opacity: px(10, 100).optional(),
  shadow: z.enum(["none", "soft", "strong", "glow"]).optional(),
  hidden: z.boolean().optional(),
  hideMobile: z.boolean().optional(),
  tablet: deviceElementSchema.optional(),
  mobile: deviceElementSchema.optional(),
  hover: hoverSchema.optional(),
});
export type ElementStyle = z.infer<typeof elementStyleSchema>;
/** Field paths like "heading", "primaryLabel" or "items.2.title". */
export const ELEMENT_PATH = /^[a-zA-Z][a-zA-Z0-9]{0,30}(\.\d{1,2}\.[a-zA-Z][a-zA-Z0-9]{0,30})?$/;
export const elementsSchema = z.record(z.string().regex(ELEMENT_PATH), elementStyleSchema).refine((r) => Object.keys(r).length <= 80, "Too many styled elements");

export const siteUiSchema = z.object({
  header: z.enum(["static", "sticky", "transparent", "glass"]).optional(),
  container: px(880, 1600).optional(),
  baseSize: px(14, 20).optional(),
  headingWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900)]).optional(),
  headingSpacing: z.number().min(-0.08).max(0.2).optional(),
  buttonRadius: px(0, 40).optional(),
  buttonUppercase: z.boolean().optional(),
  buttonShadow: z.boolean().optional(),
  buttonSize: z.enum(["sm", "md", "lg"]).optional(),
  linkUnderline: z.boolean().optional(),
  sectionSpace: z.number().min(0.5).max(2).optional(),
  selection: hex.optional(),
  scrollbar: z.boolean().optional(),
});
export type SiteUi = z.infer<typeof siteUiSchema>;

// ── helpers ──

const n = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);
/** A URL safe to put inside CSS url("…"). */
export function cssUrl(u: string) {
  const map: Record<string, string> = { '"': "%22", "\\": "%5C", "\n": "", "\r": "", "(": "%28", ")": "%29" };
  return `url("${u.replace(/["\\\n\r()]/g, (c) => map[c])}")`;
}
const rgba = (h: string, op: number) => {
  const x = parseInt(h.slice(1), 16);
  return `rgba(${(x >> 16) & 255},${(x >> 8) & 255},${x & 255},${n(op / 100, 2)})`;
};

const DIVIDER_PATH: Record<Exclude<(typeof DIVIDERS)[number], "none">, string> = {
  wave: "M0,64 C240,120 480,0 720,48 C960,96 1200,24 1440,64 L1440,120 L0,120 Z",
  slant: "M0,120 L1440,0 L1440,120 Z",
  curve: "M0,120 Q720,-40 1440,120 Z",
  zigzag: "M0,120 L0,60 L120,100 L240,60 L360,100 L480,60 L600,100 L720,60 L840,100 L960,60 L1080,100 L1200,60 L1320,100 L1440,60 L1440,120 Z",
  arc: "M0,0 Q720,140 1440,0 L1440,120 L0,120 Z",
};
/** An inline SVG mask for shape dividers (no external request). */
function dividerMask(kind: keyof typeof DIVIDER_PATH, flip: boolean) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 120' preserveAspectRatio='none'><path d='${DIVIDER_PATH[kind]}' fill='black'${flip ? " transform='translate(1440 0) scale(-1 1)'" : ""}/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Custom CSS: declarations, or rules scoped to the section. Unsafe constructs are dropped. */
export function scopeCss(raw: string, scope: string): { css: string; problems: string[] } {
  const problems: string[] = [];
  let src = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  // Any CSS escape is refused (not only hex ones): "u\rl(" would otherwise slip past the url() check.
  if (/[<>\\]|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(src)) {
    problems.push("Removed characters or constructs that aren't allowed (<, >, escapes, expression, javascript:).");
    src = src.replace(/[<>]/g, "").replace(/\\[0-9a-f]+\s?/gi, "").replace(/\\/g, "").replace(/expression\s*\(|javascript:|behavior\s*:|-moz-binding/gi, "");
  }
  if (/@/.test(src)) {
    problems.push("@-rules (@import, @media, @font-face…) aren't allowed; use the device settings instead.");
    src = src.replace(/@[^{;]*(\{[^}]*\}|;)/g, "");
  }
  // url() only with https, data:image or same-site paths.
  src = src.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, _q, u: string) => {
    if (/^(https:\/\/|\/(?!\/)|data:image\/(png|jpe?g|gif|webp);)/i.test(u.trim())) return cssUrl(u.trim());
    problems.push(`Removed url(${u.slice(0, 40)}): use https images.`);
    return "none";
  });
  const out: string[] = [];
  if (!src.includes("{")) {
    const decl = src.trim();
    if (decl) out.push(`${scope}{${decl}}`);
  } else {
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s === "&" || s === ":scope" ? scope : s.startsWith("&") ? scope + s.slice(1) : `${scope} ${s}`));
      if (sels.length) out.push(`${sels.join(",")}{${m[2].trim()}}`);
    }
  }
  return { css: out.join(""), problems };
}

const WIDTH_PX: Record<(typeof WIDTHS)[number], string> = { narrow: "760px", normal: "var(--container,1180px)", wide: "1400px", full: "100%" };
const CARD_CSS: Record<Exclude<(typeof CARD_STYLES)[number], "theme">, string> = {
  flat: "background:var(--surface);border:0;box-shadow:none",
  outline: "background:transparent;border:1px solid var(--line);box-shadow:none",
  shadow: "background:var(--bg);border:0;box-shadow:0 1px 2px rgb(0 0 0/.06),0 12px 32px rgb(0 0 0/.08)",
  glass: "background:color-mix(in srgb,var(--surface) 55%,transparent);border:1px solid color-mix(in srgb,var(--text) 10%,transparent);backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%)",
  elevated: "background:var(--bg);border:1px solid var(--line);box-shadow:0 30px 60px -30px rgb(0 0 0/.25)",
};
const CARDS = (c: string) => [".card", ".plan", ".team-card", ".quote", ".bento-item", ".faq details", ".tl-item", ".cmp-wrap", ".form-card", ".tab-panel"].map((t) => `${c} ${t}`).join(",");

/** CSS for one section's advanced settings. `safeImg` validates image/video URLs. */
export function advancedCss(cls: string, adv: Adv | undefined, safeImg: (u: unknown) => string): string {
  if (!adv) return "";
  const root: string[] = [];
  let css = "";
  const bg = adv.bg;
  if (bg && bg.kind !== "none") {
    if (bg.kind === "color" && bg.color) root.push(`background:${bg.color}`);
    if (bg.kind === "gradient" && bg.color && bg.color2) root.push(`background:${bg.radial ? `radial-gradient(circle at 30% 20%,${bg.color},${bg.color2})` : `linear-gradient(${bg.angle ?? 135}deg,${bg.color},${bg.color2})`}`);
    if (bg.kind === "image") {
      const u = safeImg(bg.image);
      if (u) root.push(`background-image:${cssUrl(u)};background-size:cover;background-position:${bg.position ?? "center"}${bg.fixed ? ";background-attachment:fixed" : ""}`);
    }
    if ((bg.kind === "image" || bg.kind === "video") && bg.overlay) {
      root.push("position:relative;isolation:isolate");
      css += `${cls}>.adv-overlay{position:absolute;inset:0;z-index:-1;background:${rgba(bg.overlay, bg.overlayOpacity ?? 40)}${bg.blur ? `;backdrop-filter:blur(${bg.blur}px);-webkit-backdrop-filter:blur(${bg.blur}px)` : ""};pointer-events:none}`;
    }
    if (bg.kind === "video") css += `${cls}{position:relative;isolation:isolate;overflow:hidden}${cls}>.adv-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}`;
  }
  const c = adv.colors;
  if (c) {
    if (c.text) root.push(`color:${c.text};--text:${c.text}`);
    if (c.muted) root.push(`--muted:${c.muted}`);
    if (c.accent) root.push(`--accent:${c.accent}`);
    if (c.accentText) root.push(`--accent-text:${c.accentText}`);
    if (c.surface) root.push(`--surface:${c.surface}`);
    if (c.heading) css += `${cls} h1,${cls} h2,${cls} h3{color:${c.heading}}`;
  }
  const t = adv.type;
  if (t) {
    const h: string[] = [];
    if (t.headingFont) h.push(`font-family:${fontStack(t.headingFont)}`);
    if (t.headingWeight) h.push(`font-weight:${t.headingWeight}`);
    if (t.letterSpacing !== undefined) h.push(`letter-spacing:${n(t.letterSpacing)}em`);
    if (t.lineHeight) h.push(`line-height:${n(t.lineHeight, 2)}`);
    if (t.uppercase) h.push("text-transform:uppercase");
    if (h.length) css += `${cls} h1,${cls} h2,${cls} h3,${cls} .display{${h.join(";")}}`;
    if (t.headingSize) css += `${cls} h1,${cls} h2,${cls} .display{font-size:clamp(${Math.max(14, Math.round(t.headingSize * 0.55))}px,${n(t.headingSize / 14.4, 2)}vw,${t.headingSize}px)}`;
    if (t.bodyFont) root.push(`font-family:${fontStack(t.bodyFont)}`);
    if (t.bodySize) root.push(`font-size:${t.bodySize}px`);
  }
  const s = adv.space;
  if (s) {
    if (s.top !== undefined) root.push(`padding-top:${s.top}px`);
    if (s.bottom !== undefined) root.push(`padding-bottom:${s.bottom}px`);
    if (s.minHeight && s.minHeight !== "auto") root.push(`min-height:${s.minHeight};display:flex;flex-direction:column;justify-content:${{ start: "flex-start", center: "center", end: "flex-end" }[s.valign ?? "center"]}`);
    if (s.width) css += `${cls} .wrap{max-width:${WIDTH_PX[s.width]}${s.width === "full" ? ";padding-left:clamp(16px,3vw,40px);padding-right:clamp(16px,3vw,40px)" : ""}}`;
    if (s.gap !== undefined) css += `${cls} .grid,${cls} .bento,${cls} .gallery,${cls} .team,${cls} .plans,${cls} .quotes,${cls} .tl,${cls} .dl-grid{gap:${s.gap}px}`;
    const mob: string[] = [];
    if (s.mobileTop !== undefined) mob.push(`padding-top:${s.mobileTop}px`);
    if (s.mobileBottom !== undefined) mob.push(`padding-bottom:${s.mobileBottom}px`);
    if (mob.length || s.mobileHeadingSize) css += `@media (max-width:767px){${mob.length ? `${cls}{${mob.join(";")}}` : ""}${s.mobileHeadingSize ? `${cls} h1,${cls} h2,${cls} .display{font-size:${s.mobileHeadingSize}px}` : ""}}`;
  }
  const card = adv.card;
  if (card) {
    const rules: string[] = [];
    if (card.style && card.style !== "theme") rules.push(CARD_CSS[card.style]);
    if (card.radius !== undefined) rules.push(`border-radius:${card.radius}px`);
    if (rules.length) css += `${CARDS(cls)}{${rules.join(";")}}`;
    if (card.imageRadius !== undefined) css += `${cls} img{border-radius:${card.imageRadius}px}`;
  }
  const b = adv.border;
  if (b) {
    const col = b.color ?? "var(--line)";
    if (b.top) root.push(`border-top:1px solid ${col}`);
    if (b.bottom) root.push(`border-bottom:1px solid ${col}`);
    if (b.radius) root.push(`border-radius:${b.radius}px;overflow:hidden`);
    if (b.inset) root.push(`margin-left:${b.inset}px;margin-right:${b.inset}px`);
  }
  const d = adv.divider;
  if (d && ((d.top && d.top !== "none") || (d.bottom && d.bottom !== "none"))) {
    const h = d.height ?? 60;
    const col = d.color ?? "var(--bg)";
    root.push("position:relative");
    if (d.top && d.top !== "none") css += `${cls}>.adv-div-top{position:absolute;left:0;right:0;top:-1px;height:${h}px;background:${col};-webkit-mask:${dividerMask(d.top, !!d.flip)} top/100% 100% no-repeat;mask:${dividerMask(d.top, !!d.flip)} top/100% 100% no-repeat;transform:scaleY(-1);pointer-events:none;z-index:1}`;
    if (d.bottom && d.bottom !== "none") css += `${cls}>.adv-div-bottom{position:absolute;left:0;right:0;bottom:-1px;height:${h}px;background:${col};-webkit-mask:${dividerMask(d.bottom, !!d.flip)} bottom/100% 100% no-repeat;mask:${dividerMask(d.bottom, !!d.flip)} bottom/100% 100% no-repeat;pointer-events:none;z-index:1}`;
  }
  if (root.length) css = `${cls}{${root.join(";")}}${css}`;
  if (adv.css) css += scopeCss(adv.css, cls).css;
  return css;
}

const SHADOW = { none: "none", soft: "0 6px 20px rgb(0 0 0/.10)", strong: "0 18px 44px rgb(0 0 0/.22)", glow: "0 0 0 1px var(--accent),0 10px 30px color-mix(in srgb,var(--accent) 35%,transparent)" };

function deviceRules(d: DeviceElementStyle): string {
  if (d.hidden) return "display:none!important";
  const r: string[] = [];
  if (d.color) r.push(`color:${d.color}`);
  if (d.bg) r.push(`background:${d.bg}`);
  if (d.size) r.push(`font-size:${d.size}px`);
  if (d.weight) r.push(`font-weight:${d.weight}`);
  if (d.align) r.push(`text-align:${d.align}`, d.align === "center" ? "margin-left:auto;margin-right:auto" : d.align === "right" ? "margin-left:auto;margin-right:0" : "margin-left:0;margin-right:auto");
  if (d.letterSpacing !== undefined) r.push(`letter-spacing:${n(d.letterSpacing)}em`);
  if (d.lineHeight) r.push(`line-height:${n(d.lineHeight, 2)}`);
  if (d.padX !== undefined || d.padY !== undefined) r.push(`padding:${d.padY ?? 0}px ${d.padX ?? 0}px`);
  if (d.maxWidth) r.push(`max-width:${d.maxWidth}px`);
  return r.flatMap((x) => x.split(";")).map((x) => `${x}!important`).join(";");
}

/** CSS for per-element styles (elements carry data-f="path"). */
export function elementsCss(cls: string, elements: Record<string, ElementStyle> | undefined): string {
  if (!elements) return "";
  let css = "";
  for (const [path, e] of Object.entries(elements)) {
    if (!ELEMENT_PATH.test(path)) continue;
    const sel = `${cls} [data-f="${path}"]`;
    const r: string[] = [];
    if (e.hidden) {
      css += `${sel}{display:none!important}`;
      continue;
    }
    if (e.color) r.push(`color:${e.color}`);
    if (e.bg) r.push(`background:${e.bg}`);
    if (e.size) r.push(`font-size:${e.size}px`);
    if (e.weight) r.push(`font-weight:${e.weight}`);
    if (e.italic) r.push("font-style:italic");
    if (e.uppercase) r.push("text-transform:uppercase");
    if (e.underline) r.push("text-decoration:underline;text-underline-offset:.18em");
    if (e.letterSpacing !== undefined) r.push(`letter-spacing:${n(e.letterSpacing)}em`);
    if (e.lineHeight) r.push(`line-height:${n(e.lineHeight, 2)}`);
    if (e.align) r.push(`text-align:${e.align}${e.align === "center" ? ";margin-left:auto;margin-right:auto" : e.align === "right" ? ";margin-left:auto" : ""}`);
    if (e.font) r.push(`font-family:${fontStack(e.font)}`);
    if (e.radius !== undefined) r.push(`border-radius:${e.radius}px`);
    if (e.padX !== undefined || e.padY !== undefined) r.push(`padding:${e.padY ?? 0}px ${e.padX ?? 0}px`);
    if (e.maxWidth) r.push(`max-width:${e.maxWidth}px`);
    if (e.opacity !== undefined && e.opacity < 100) r.push(`opacity:${n(e.opacity / 100, 2)}`);
    if (e.shadow && e.shadow !== "none") r.push(`box-shadow:${SHADOW[e.shadow]}`);
    // Element styles win over section and theme rules.
    if (r.length) css += `${sel}{${r.map((x) => x.split(";").map((d) => `${d}!important`).join(";")).join(";")}}`;
    if (e.hover) {
      const h: string[] = [];
      if (e.hover.color) h.push(`color:${e.hover.color}`);
      if (e.hover.bg) h.push(`background:${e.hover.bg}`);
      const t = [e.hover.scale && e.hover.scale !== 100 ? `scale(${n(e.hover.scale / 100, 2)})` : "", e.hover.lift ? "translateY(-3px)" : ""].filter(Boolean).join(" ");
      if (t) h.push(`transform:${t}`);
      if (e.hover.shadow && e.hover.shadow !== "none") h.push(`box-shadow:${SHADOW[e.hover.shadow]}`);
      if (h.length) css += `${sel}{transition:color .2s,background .2s,transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s}@media (hover:hover){${sel}:hover{${h.map((d) => `${d}!important`).join(";")}}}`;
    }
    // Tablet, then phone: the narrower rule comes later so it wins.
    for (const [q, d] of [["(max-width:1023px)", e.tablet], ["(max-width:767px)", e.mobile]] as const) {
      if (!d) continue;
      const m = deviceRules(d);
      if (m) css += `@media ${q}{${sel}{${m}}}`;
    }
    if (e.mobileSize) css += `@media (max-width:767px){${sel}{font-size:${e.mobileSize}px!important}}`;
    if (e.hideMobile) css += `@media (max-width:767px){${sel}{display:none!important}}`;
  }
  return css;
}

/** Site-wide interface CSS from theme.ui. */
export function siteUiCss(ui: SiteUi | undefined): string {
  if (!ui) return "";
  const root: string[] = [];
  let css = "";
  if (ui.container) root.push(`--container:${ui.container}px`);
  if (ui.baseSize) css += `html{font-size:${ui.baseSize}px}body{font-size:${ui.baseSize}px}`;
  if (ui.sectionSpace) root.push(`--sy:calc(clamp(64px,9vw,120px)*${n(ui.sectionSpace, 2)});--sy-sm:calc(clamp(40px,6vw,72px)*${n(ui.sectionSpace, 2)});--sy-lg:calc(clamp(88px,12vw,168px)*${n(ui.sectionSpace, 2)})`);
  if (root.length) css += `:root{${root.join(";")}}`;
  if (ui.container) css += `.wrap{max-width:var(--container)}`;
  if (ui.headingWeight) css += `h1,h2,h3,.display{font-weight:${ui.headingWeight}}`;
  if (ui.headingSpacing !== undefined) css += `h1,h2,.display{letter-spacing:${n(ui.headingSpacing)}em}`;
  const btn: string[] = [];
  if (ui.buttonRadius !== undefined) btn.push(`border-radius:${ui.buttonRadius}px`);
  if (ui.buttonUppercase) btn.push("text-transform:uppercase;letter-spacing:.06em;font-size:.86em");
  if (ui.buttonShadow) btn.push("box-shadow:0 10px 24px -10px color-mix(in srgb,var(--accent) 70%,transparent)");
  if (ui.buttonSize === "sm") btn.push("padding:.55em 1.1em");
  if (ui.buttonSize === "lg") btn.push("padding:1.05em 2em;font-size:1.06em");
  if (btn.length) css += `.btn{${btn.join(";")}}`;
  if (ui.linkUnderline) css += `.prose a,main p a{text-decoration:underline;text-underline-offset:.2em}`;
  if (ui.selection) css += `::selection{background:${ui.selection};color:#fff}`;
  if (ui.header === "sticky" || ui.header === "glass") css += `.sec-navbar{position:sticky;top:0;z-index:50}`;
  if (ui.header === "glass") css += `.sec-navbar{background:color-mix(in srgb,var(--bg) 70%,transparent)!important;backdrop-filter:blur(18px) saturate(180%);-webkit-backdrop-filter:blur(18px) saturate(180%);border-bottom:1px solid color-mix(in srgb,var(--text) 8%,transparent)}`;
  if (ui.header === "transparent") css += `.sec-navbar{position:absolute;left:0;right:0;top:0;z-index:50;background:transparent!important;border:0!important}.sec-banner+.sec-navbar{top:auto}`;
  if (ui.scrollbar) css += `html{scrollbar-width:thin;scrollbar-color:var(--accent) transparent}`;
  return css;
}

/** Background layers that need elements (video, overlay). */
export function advancedLayers(adv: Adv | undefined, safeMedia: (u: unknown) => string): string {
  let out = "";
  // Shape dividers are real elements so they never clash with ::before/::after used by themes or the editor.
  if (adv?.divider?.top && adv.divider.top !== "none") out += `<div class="adv-div-top" aria-hidden="true"></div>`;
  if (adv?.divider?.bottom && adv.divider.bottom !== "none") out += `<div class="adv-div-bottom" aria-hidden="true"></div>`;
  const bg = adv?.bg;
  if (!bg || (bg.kind !== "video" && bg.kind !== "image")) return out;
  if (bg.kind === "video") {
    const u = safeMedia(bg.video);
    const poster = safeMedia(bg.image);
    if (u) out += `<video class="adv-video" autoplay muted loop playsinline preload="metadata" aria-hidden="true"${poster ? ` poster="${poster.replace(/"/g, "&quot;")}"` : ""}><source src="${u.replace(/"/g, "&quot;")}"></video>`;
  }
  if (bg.overlay) out += `<div class="adv-overlay" aria-hidden="true"></div>`;
  return out;
}

/** Fonts used by sections and elements beyond the theme pair (to load on the page). */
export function extraFonts(sections: { style: { adv?: Adv; elements?: Record<string, ElementStyle> } }[]) {
  const keys = new Set<string>();
  for (const s of sections) {
    if (s.style.adv?.type?.headingFont) keys.add(s.style.adv.type.headingFont);
    if (s.style.adv?.type?.bodyFont) keys.add(s.style.adv.type.bodyFont);
    for (const e of Object.values(s.style.elements ?? {})) if (e.font) keys.add(e.font);
  }
  return [...keys];
}

const NOT_TEXT = /(href|url|link|image|img|src|icon|video|embed|id|variant|style|layout|columns|mode|kind|type|table|form|limit|sort|filter)$/i;
export type ElementNode = { path: string; label: string; children?: ElementNode[] };

/** A section's editable elements, for the layers tree: its texts, and each list item's texts. */
export function elementTree(props: Record<string, unknown>): ElementNode[] {
  const out: ElementNode[] = [];
  const human = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("_") || NOT_TEXT.test(k)) continue;
    if (typeof v === "string" && v.trim() && ELEMENT_PATH.test(k)) out.push({ path: k, label: `${human(k)} · ${v.trim().slice(0, 32)}` });
    else if (Array.isArray(v) && v.length && typeof v[0] === "object" && v[0] !== null) {
      const items: ElementNode[] = [];
      v.slice(0, 24).forEach((item, i) => {
        const kids = Object.entries(item as Record<string, unknown>)
          .filter(([kk, vv]) => typeof vv === "string" && (vv as string).trim() && !NOT_TEXT.test(kk) && ELEMENT_PATH.test(`${k}.${i}.${kk}`))
          .map(([kk, vv]) => ({ path: `${k}.${i}.${kk}`, label: `${human(kk)} · ${(vv as string).trim().slice(0, 28)}` }));
        if (kids.length) items.push({ path: `${k}.${i}`, label: `${human(k)} #${i + 1}`, children: kids });
      });
      if (items.length) out.push({ path: k, label: `${human(k)} (${items.length})`, children: items });
    }
  }
  return out.slice(0, 40);
}
