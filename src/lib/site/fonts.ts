// Font library. Web fonts load from Fontsource on jsDelivr at pinned versions;
// the original system stacks stay available (and are the fallbacks).
export type FontInfo = { label: string; category: "sans" | "serif" | "display" | "mono"; stack: string; css?: string };

const SYS_SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const SYS_SERIF = `"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif`;
const cdn = (pkg: string) => `https://cdn.jsdelivr.net/npm/${pkg}@5.3.0/index.css`;

export const FONTS = {
  sans: { label: "System sans", category: "sans", stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif` },
  serif: { label: "System serif", category: "serif", stack: `"New York", ${SYS_SERIF}` },
  rounded: { label: "System rounded", category: "sans", stack: `ui-rounded, "SF Pro Rounded", "Nunito", ${SYS_SANS}` },
  mono: { label: "System mono", category: "mono", stack: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` },
  inter: { label: "Inter", category: "sans", stack: `"Inter Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/inter") },
  manrope: { label: "Manrope", category: "sans", stack: `"Manrope Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/manrope") },
  "dm-sans": { label: "DM Sans", category: "sans", stack: `"DM Sans Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/dm-sans") },
  "plus-jakarta": { label: "Plus Jakarta Sans", category: "sans", stack: `"Plus Jakarta Sans Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/plus-jakarta-sans") },
  outfit: { label: "Outfit", category: "sans", stack: `"Outfit Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/outfit") },
  nunito: { label: "Nunito", category: "sans", stack: `"Nunito Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/nunito") },
  "libre-franklin": { label: "Libre Franklin", category: "sans", stack: `"Libre Franklin Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/libre-franklin") },
  "space-grotesk": { label: "Space Grotesk", category: "display", stack: `"Space Grotesk Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/space-grotesk") },
  sora: { label: "Sora", category: "display", stack: `"Sora Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/sora") },
  bricolage: { label: "Bricolage Grotesque", category: "display", stack: `"Bricolage Grotesque Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/bricolage-grotesque") },
  syne: { label: "Syne", category: "display", stack: `"Syne Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/syne") },
  archivo: { label: "Archivo", category: "display", stack: `"Archivo Variable", ${SYS_SANS}`, css: cdn("@fontsource-variable/archivo") },
  fraunces: { label: "Fraunces", category: "serif", stack: `"Fraunces Variable", ${SYS_SERIF}`, css: cdn("@fontsource-variable/fraunces") },
  playfair: { label: "Playfair Display", category: "serif", stack: `"Playfair Display Variable", ${SYS_SERIF}`, css: cdn("@fontsource-variable/playfair-display") },
  "instrument-serif": { label: "Instrument Serif", category: "serif", stack: `"Instrument Serif", ${SYS_SERIF}`, css: cdn("@fontsource/instrument-serif") },
  cormorant: { label: "Cormorant Garamond", category: "serif", stack: `"Cormorant Garamond Variable", ${SYS_SERIF}`, css: cdn("@fontsource-variable/cormorant-garamond") },
  "eb-garamond": { label: "EB Garamond", category: "serif", stack: `"EB Garamond Variable", ${SYS_SERIF}`, css: cdn("@fontsource-variable/eb-garamond") },
  "jetbrains-mono": { label: "JetBrains Mono", category: "mono", stack: `"JetBrains Mono Variable", ui-monospace, monospace`, css: cdn("@fontsource-variable/jetbrains-mono") },
} as const satisfies Record<string, FontInfo>;

export type FontKey = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as [FontKey, ...FontKey[]];

/** Curated heading/body pairings, each tested for legibility and contrast of character. */
export const FONT_PAIRS: { id: string; label: string; heading: FontKey; body: FontKey; mood: string }[] = [
  { id: "editorial", label: "Fraunces + Inter", heading: "fraunces", body: "inter", mood: "Warm editorial" },
  { id: "luxury", label: "Cormorant + Manrope", heading: "cormorant", body: "manrope", mood: "Refined luxury" },
  { id: "gallery", label: "Instrument Serif + Inter", heading: "instrument-serif", body: "inter", mood: "Gallery, fashion" },
  { id: "classic", label: "Playfair + DM Sans", heading: "playfair", body: "dm-sans", mood: "Classic, hospitality" },
  { id: "literary", label: "EB Garamond + Libre Franklin", heading: "eb-garamond", body: "libre-franklin", mood: "Literary, professional" },
  { id: "product", label: "Inter + Inter", heading: "inter", body: "inter", mood: "Clean product" },
  { id: "tech", label: "Space Grotesk + Inter", heading: "space-grotesk", body: "inter", mood: "Technical, modern" },
  { id: "startup", label: "Sora + Plus Jakarta", heading: "sora", body: "plus-jakarta", mood: "Startup, confident" },
  { id: "expressive", label: "Bricolage + DM Sans", heading: "bricolage", body: "dm-sans", mood: "Expressive, creative" },
  { id: "avant", label: "Syne + Manrope", heading: "syne", body: "manrope", mood: "Avant-garde studio" },
  { id: "friendly", label: "Outfit + Nunito", heading: "outfit", body: "nunito", mood: "Friendly, approachable" },
  { id: "bold", label: "Archivo + Inter", heading: "archivo", body: "inter", mood: "Bold, athletic" },
  { id: "system", label: "System fonts", heading: "sans", body: "sans", mood: "Fastest loading" },
];

export function fontStack(key: string): string {
  return (FONTS as Record<string, FontInfo>)[key]?.stack ?? FONTS.sans.stack;
}

export function fontCss(keys: string[]): string[] {
  return [...new Set(keys.map((k) => (FONTS as Record<string, FontInfo>)[k]?.css).filter((x): x is string => !!x))];
}
