// Brand kit: turns observed colours and fonts (from a logo's pixels or a
// website's CSS) into a harmonized theme. Pure; used on client and server.
import { contrast, hexToRgb, luminance, mix, rgbToHex } from "./color";
import { harmonize } from "./design";
import { FONTS, type FontKey } from "./fonts";
import type { SiteTheme } from "./model";

export type WeightedColor = { hex: string; weight: number };

export type BrandKit = {
  name?: string;
  description?: string;
  logo?: string;
  colors: string[];
  headingFont?: FontKey;
  bodyFont?: FontKey;
  fontNames: string[];
  source: string;
  /** The site's look beyond colours and fonts (only when imported from a website). */
  feel?: Feel;
};

export type Feel = {
  radius?: SiteTheme["radius"];
  buttonStyle?: SiteTheme["buttonStyle"];
  density?: SiteTheme["density"];
  typeScale?: SiteTheme["typeScale"];
  dark?: boolean;
  /** Human-readable reasons, shown before applying. */
  evidence: string[];
};

const px = (v: string, unit: string) => (unit === "rem" || unit === "em" ? Number(v) * 16 : Number(v));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

/**
 * Reads the "feel" of a site from its CSS and class names: corner rounding,
 * button shape, vertical spacing, headline scale and light or dark. Style
 * only — no text or images are copied.
 */
export function feelFromCss(css: string, html = ""): Feel {
  const evidence: string[] = [];
  const out: Feel = { evidence };
  const rules = [...css.matchAll(/([^{}]{1,300})\{([^{}]{0,2000})\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const radii = [...css.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem|em|%)/gi)].map((m) => (m[2] === "%" ? (Number(m[1]) >= 50 ? 9999 : 8) : px(m[1], m[2])));
  const twRadius = [...html.matchAll(/\brounded(?:-(none|sm|md|lg|xl|2xl|3xl|full))?\b/g)].map((m) => ({ none: 0, sm: 2, undefined: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, full: 9999 })[String(m[1]) as "sm"] ?? 4);
  const all = [...radii, ...twRadius];
  const corners = median(all.filter((r) => r < 999));
  if (corners !== null) {
    out.radius = corners === 0 ? "none" : corners <= 4 ? "sm" : corners <= 10 ? "md" : "lg";
    evidence.push(`Corners are mostly ${corners}px`);
  }
  const buttons = rules.filter((r) => /btn|button|\.cta/i.test(r.sel));
  const pill = buttons.some((r) => /border-radius\s*:\s*(9{3,}|[5-9]\d{2,}px|50%|\d{2,}rem)/i.test(r.body)) || /\b(btn|button)[^"']*rounded-full|rounded-full[^"']*\b(btn|button)/i.test(html);
  const outline = buttons.some((r) => /background(-color)?\s*:\s*(transparent|none)/i.test(r.body) && /border\s*:\s*[1-3]px/i.test(r.body));
  const sharp = buttons.length > 0 && buttons.every((r) => !/border-radius/i.test(r.body) || /border-radius\s*:\s*0(px)?\b/i.test(r.body));
  out.buttonStyle = pill ? "pill" : outline ? "outline" : sharp && out.radius === "none" ? "sharp" : buttons.length ? "solid" : undefined;
  if (out.buttonStyle) evidence.push(`Buttons look ${out.buttonStyle === "pill" ? "pill-shaped" : out.buttonStyle}`);
  const pads = rules
    .filter((r) => /section|hero|banner|container|wrapper|main|\.block/i.test(r.sel))
    .flatMap((r) => [...r.body.matchAll(/padding(?:-top|-bottom)?\s*:\s*([\d.]+)(px|rem|em)/gi)].map((m) => px(m[1], m[2])));
  const tw = [...html.matchAll(/\bpy-(\d{1,2})\b/g)].map((m) => Number(m[1]) * 4);
  const pad = median([...pads, ...tw].filter((v) => v >= 16));
  if (pad !== null) {
    out.density = pad >= 96 ? "airy" : pad >= 56 ? "comfortable" : "compact";
    evidence.push(`Sections have about ${Math.round(pad)}px of vertical space`);
  }
  const h1 = rules.filter((r) => /(^|[\s,])h1\b|hero.*(title|heading)|display/i.test(r.sel)).flatMap((r) => [...r.body.matchAll(/font-size\s*:\s*([\d.]+)(px|rem|em)/gi)].map((m) => px(m[1], m[2])));
  const twH = [...html.matchAll(/\btext-(4xl|5xl|6xl|7xl|8xl|9xl)\b/g)].map((m) => ({ "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 })[m[1] as "4xl"]);
  const big = Math.max(0, ...h1, ...twH);
  if (big) {
    out.typeScale = big >= 56 ? "dramatic" : big <= 36 ? "compact" : "balanced";
    evidence.push(`Headlines up to ${Math.round(big)}px`);
  }
  const bg = rules.filter((r) => /(^|,)\s*(html|body|:root)\b/i.test(r.sel)).flatMap((r) => [...r.body.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map((m) => m[1]));
  if (bg.length) {
    const hex = bg[0].length === 4 ? `#${[...bg[0].slice(1)].map((c) => c + c).join("")}` : bg[0];
    out.dark = luminance(hex) < 0.2;
    evidence.push(`${out.dark ? "Dark" : "Light"} page background`);
  }
  return out;
}

/** Applies a detected feel to a theme (only the parts that were detected). */
export function applyFeel(theme: SiteTheme, f: Feel): SiteTheme {
  return { ...theme, ...(f.radius ? { radius: f.radius } : {}), ...(f.buttonStyle ? { buttonStyle: f.buttonStyle } : {}), ...(f.density ? { density: f.density } : {}), ...(f.typeScale ? { typeScale: f.typeScale } : {}) };
}

function hsl(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

export const saturation = (hex: string) => hsl(hex).s;

/** Merges near-identical colours so the palette reflects distinct brand hues. */
export function clusterColors(colors: WeightedColor[], maxColors = 8): WeightedColor[] {
  const out: WeightedColor[] = [];
  const dist = (a: string, b: string) => {
    const [x, y] = [hexToRgb(a), hexToRgb(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  for (const c of [...colors].sort((a, b) => b.weight - a.weight)) {
    const near = out.find((o) => dist(o.hex, c.hex) < 38);
    if (near) near.weight += c.weight;
    else out.push({ ...c });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, maxColors);
}

/**
 * Builds a full palette from brand colours: the most prominent saturated
 * colour becomes the accent; background and text are derived to keep the
 * brand feel while meeting WCAG AA (enforced by harmonize).
 */
export function paletteFromColors(colors: WeightedColor[], opts: { dark?: boolean } = {}): SiteTheme["palette"] {
  const clustered = clusterColors(colors);
  const saturated = clustered.filter((c) => saturation(c.hex) > 0.28 && luminance(c.hex) > 0.03 && luminance(c.hex) < 0.85);
  const accent = (saturated[0] ?? clustered.find((c) => luminance(c.hex) < 0.5) ?? { hex: "#2747d6" }).hex;
  const lights = clustered.filter((c) => luminance(c.hex) > 0.85);
  const darks = clustered.filter((c) => luminance(c.hex) < 0.06);
  if (opts.dark) {
    const background = darks[0]?.hex ?? mix(accent, "#000000", 0.88);
    return harmonize({ background, surface: mix(background, "#ffffff", 0.06), text: "#f4f2ee", muted: "#b0aca5", accent: mix(accent, "#ffffff", 0.15), accentText: "#ffffff" });
  }
  const background = lights[0]?.hex ?? mix(accent, "#ffffff", 0.96);
  const text = darks[0]?.hex ?? mix(accent, "#000000", 0.85);
  return harmonize({
    background,
    surface: mix(background, accent, 0.06),
    text,
    muted: mix(text, background, 0.42),
    accent,
    accentText: contrast("#ffffff", accent) >= contrast("#111111", accent) ? "#ffffff" : "#111111",
  });
}

/** Samples an RGBA pixel buffer into weighted colours (skips transparent pixels). */
export function colorsFromPixels(data: Uint8ClampedArray | Uint8Array, step = 4): WeightedColor[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 128) continue;
    // Quantize to 32 levels per channel to group similar pixels.
    const q = [data[i], data[i + 1], data[i + 2]].map((v) => Math.min(255, Math.round(v / 8) * 8)) as [number, number, number];
    const hex = rgbToHex(q);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].map(([hex, weight]) => ({ hex, weight }));
}

const FONT_ALIASES: Record<string, FontKey> = {
  inter: "inter",
  manrope: "manrope",
  "dm sans": "dm-sans",
  "plus jakarta sans": "plus-jakarta",
  outfit: "outfit",
  nunito: "nunito",
  "libre franklin": "libre-franklin",
  "space grotesk": "space-grotesk",
  sora: "sora",
  "bricolage grotesque": "bricolage",
  syne: "syne",
  archivo: "archivo",
  fraunces: "fraunces",
  "playfair display": "playfair",
  playfair: "playfair",
  "instrument serif": "instrument-serif",
  "cormorant garamond": "cormorant",
  cormorant: "cormorant",
  "eb garamond": "eb-garamond",
  garamond: "eb-garamond",
  "jetbrains mono": "jetbrains-mono",
};

/** Maps a font-family name seen in the wild to the closest font we host. */
export function matchFont(name: string): FontKey | undefined {
  const n = name.toLowerCase().replace(/["']/g, "").replace(/\s+variable$/, "").trim();
  if (FONT_ALIASES[n]) return FONT_ALIASES[n];
  if (/(roboto|helvetica|arial|open sans|lato|source sans|work sans|poppins|montserrat|raleway|ubuntu|noto sans|ibm plex sans|figtree|geist)/.test(n)) {
    return /(poppins|montserrat|raleway)/.test(n) ? "outfit" : "inter";
  }
  if (/(merriweather|lora|georgia|times|crimson|libre baskerville|baskerville|spectral|noto serif|pt serif|source serif|dm serif)/.test(n)) return /dm serif|playfair/.test(n) ? "playfair" : "fraunces";
  if (/(mono|code|courier)/.test(n)) return "jetbrains-mono";
  return undefined;
}

const HEX_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const RGB_RE = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)/gi;

/** Counts colours in CSS text (hex and rgb()). */
export function colorsFromCss(css: string): WeightedColor[] {
  const counts = new Map<string, number>();
  const add = (hex: string) => counts.set(hex, (counts.get(hex) ?? 0) + 1);
  for (const m of css.matchAll(HEX_RE)) {
    const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    add(`#${h.toLowerCase()}`);
  }
  for (const m of css.matchAll(RGB_RE)) {
    if (m[4] && parseFloat(m[4]) < (m[4].endsWith("%") ? 50 : 0.5)) continue;
    add(rgbToHex([Number(m[1]), Number(m[2]), Number(m[3])]));
  }
  return [...counts.entries()].map(([hex, weight]) => ({ hex, weight }));
}

export function fontsFromCss(css: string): string[] {
  const names = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const first = m[1].split(",")[0].trim().replace(/["']/g, "");
    if (!first || /^(inherit|initial|var\(|-apple-system|system-ui|sans-serif|serif|monospace)/i.test(first)) continue;
    names.set(first, (names.get(first) ?? 0) + 1);
  }
  for (const m of css.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&)\s]+)/gi)) {
    for (const fam of decodeURIComponent(m[1]).split("|")) names.set(fam.split(":")[0].replace(/\+/g, " "), 99);
  }
  return [...names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** Applies a brand kit to a theme: palette, fonts and (optionally) logo. */
export function applyBrand(theme: SiteTheme, kit: Pick<BrandKit, "colors" | "headingFont" | "bodyFont">, opts: { dark?: boolean } = {}): SiteTheme {
  const palette = kit.colors.length ? paletteFromColors(kit.colors.map((hex, i) => ({ hex, weight: kit.colors.length - i })), opts) : theme.palette;
  return {
    ...theme,
    palette,
    headingFont: kit.headingFont ?? theme.headingFont,
    font: kit.bodyFont ?? kit.headingFont ?? theme.font,
  };
}

export const FONT_LABEL = (k: FontKey) => FONTS[k].label;
