// The design engine: curated design directions ("personalities"), palettes,
// font pairings and deterministic design actions. It encodes the decisions a
// senior designer makes — type pairing, palette, rhythm, layout variants,
// decoration — and enforces WCAG contrast on every theme it produces.
// Works without any AI provider; an LLM can choose among the same options.
import { contrast, ensureContrast, isDark, luminance, mix, onColor } from "./color";
import { FONT_PAIRS, type FontKey } from "./fonts";
import { variantOf, type Section, type SiteDoc, type SiteTheme } from "./model";

export type Palette = SiteTheme["palette"] & { id: string; label: string };

export const PALETTES: Palette[] = [
  // light, warm
  { id: "linen", label: "Linen & Rust", background: "#fbf8f3", surface: "#f2ebe0", text: "#241c16", muted: "#6b5d50", accent: "#9a3f17", accentText: "#ffffff" },
  { id: "sand", label: "Sand & Olive", background: "#f7f4ec", surface: "#ece6d6", text: "#22231c", muted: "#5f6152", accent: "#4f5d2f", accentText: "#ffffff" },
  { id: "terracotta", label: "Terracotta", background: "#fff8f2", surface: "#f8e8da", text: "#2b1a12", muted: "#76584a", accent: "#b44a27", accentText: "#ffffff" },
  { id: "blush", label: "Blush & Plum", background: "#fdf7f6", surface: "#f6e6e3", text: "#2a1720", muted: "#6f5560", accent: "#7a2a52", accentText: "#ffffff" },
  // light, cool / neutral
  { id: "paper", label: "Paper & Ink", background: "#ffffff", surface: "#f4f4f2", text: "#111111", muted: "#5a5a58", accent: "#111111", accentText: "#ffffff" },
  { id: "cobalt", label: "Cobalt", background: "#fafbfc", surface: "#eef1f6", text: "#0f172a", muted: "#4b5567", accent: "#2747d6", accentText: "#ffffff" },
  { id: "teal", label: "Sea Glass", background: "#ffffff", surface: "#eef6f4", text: "#0f231d", muted: "#48625a", accent: "#0f766e", accentText: "#ffffff" },
  { id: "sage", label: "Sage", background: "#f8faf6", surface: "#e9efe4", text: "#1b2618", muted: "#56634f", accent: "#3e6b3a", accentText: "#ffffff" },
  { id: "navy", label: "Navy & Brass", background: "#fbfaf7", surface: "#efece4", text: "#121a2e", muted: "#525a6b", accent: "#1c2b52", accentText: "#ffffff" },
  { id: "violet", label: "Violet", background: "#fcfbff", surface: "#f0ecfb", text: "#1a1530", muted: "#5b5573", accent: "#5b34d6", accentText: "#ffffff" },
  // vivid
  { id: "citrus", label: "Citrus", background: "#fffdf5", surface: "#fff3c9", text: "#1d1a10", muted: "#5f5940", accent: "#e8501f", accentText: "#ffffff" },
  { id: "coral", label: "Coral Pop", background: "#fffaf8", surface: "#ffe7df", text: "#23120d", muted: "#6c4d44", accent: "#d93f2b", accentText: "#ffffff" },
  { id: "lime", label: "Electric Lime", background: "#ffffff", surface: "#f2f6e7", text: "#0d1105", muted: "#4f5640", accent: "#1d2b00", accentText: "#d6ff4f" },
  // dark
  { id: "midnight", label: "Midnight Gold", background: "#0c0d10", surface: "#16181d", text: "#f3f1ec", muted: "#a7a39a", accent: "#e3cf9f", accentText: "#17140d" },
  { id: "obsidian", label: "Obsidian", background: "#09090b", surface: "#141417", text: "#f4f4f5", muted: "#a1a1aa", accent: "#fafafa", accentText: "#09090b" },
  { id: "aurora", label: "Aurora", background: "#070b14", surface: "#0f1626", text: "#eef2ff", muted: "#9aa4bf", accent: "#7c9cff", accentText: "#06091a" },
  { id: "forest-night", label: "Forest Night", background: "#0d1310", surface: "#16201b", text: "#edf3ee", muted: "#9db0a3", accent: "#a6d39b", accentText: "#0d1a0c" },
  { id: "bordeaux", label: "Bordeaux", background: "#140b0d", surface: "#211316", text: "#f7eeea", muted: "#bba49d", accent: "#d9a273", accentText: "#1b0f08" },
  { id: "neon", label: "Neon Grid", background: "#0a0a0f", surface: "#13131c", text: "#f5f5ff", muted: "#a2a2b8", accent: "#c6ff3d", accentText: "#0a0f00" },
  // soft / wellness
  { id: "mist", label: "Morning Mist", background: "#f7f9f9", surface: "#e8eff0", text: "#16242a", muted: "#536871", accent: "#2f6f7f", accentText: "#ffffff" },
  { id: "clay", label: "Clay & Stone", background: "#f6f2ee", surface: "#e9e1d9", text: "#2a2420", muted: "#6a5f56", accent: "#7d5a44", accentText: "#ffffff" },
  { id: "lavender", label: "Lavender", background: "#fbf9fe", surface: "#efe9f8", text: "#221b30", muted: "#625a74", accent: "#6b4fa3", accentText: "#ffffff" },
  // second collection
  { id: "porcelain", label: "Porcelain", background: "#f5f7fb", surface: "#e8edf7", text: "#0b1220", muted: "#4a5568", accent: "#0066d6", accentText: "#ffffff" },
  { id: "ocean", label: "Deep Ocean", background: "#f4f9fb", surface: "#e2eff4", text: "#0a2230", muted: "#46606c", accent: "#0b6e99", accentText: "#ffffff" },
  { id: "champagne", label: "Champagne", background: "#faf7f2", surface: "#f0e9df", text: "#1f1a14", muted: "#6b6255", accent: "#7e5f33", accentText: "#ffffff" },
  { id: "rosewood", label: "Rosewood", background: "#fbf6f4", surface: "#f1e3df", text: "#2b1615", muted: "#6d5450", accent: "#9f3a4a", accentText: "#ffffff" },
  { id: "matcha", label: "Matcha", background: "#f6f8f1", surface: "#e6ecd9", text: "#1a2214", muted: "#55604a", accent: "#4f6b26", accentText: "#ffffff" },
  { id: "emerald", label: "Ivory & Emerald", background: "#fbfaf6", surface: "#eef0e8", text: "#10201a", muted: "#4f5d55", accent: "#0f5e45", accentText: "#ffffff" },
  { id: "saffron", label: "Saffron", background: "#fffaf0", surface: "#fdecc8", text: "#2a1606", muted: "#6e5136", accent: "#b93c0a", accentText: "#ffffff" },
  { id: "berry", label: "Berry", background: "#fff7fa", surface: "#fbe3ec", text: "#2a0f1c", muted: "#6e4a5a", accent: "#be185d", accentText: "#ffffff" },
  { id: "dusk", label: "Dusk", background: "#0b0b14", surface: "#171728", text: "#f2f2fa", muted: "#a3a3bd", accent: "#a78bfa", accentText: "#160d2e" },
  { id: "graphite", label: "Graphite", background: "#0e0f12", surface: "#1a1c21", text: "#f5f6f8", muted: "#a4a8b2", accent: "#5ac8fa", accentText: "#04121a" },
  { id: "espresso", label: "Espresso", background: "#15100d", surface: "#221a15", text: "#f5ede4", muted: "#b8a99a", accent: "#d4a373", accentText: "#1b120a" },
  { id: "royal", label: "Royal Night", background: "#0a1022", surface: "#131c36", text: "#eef2fb", muted: "#9aa6c4", accent: "#f2c46d", accentText: "#1a1405" },
];

export type Personality = {
  id: string;
  label: string;
  description: string;
  palettes: string[];
  fontPairs: string[];
  radius: SiteTheme["radius"];
  density: SiteTheme["density"];
  buttonStyle: SiteTheme["buttonStyle"];
  typeScale: SiteTheme["typeScale"];
  motion: SiteTheme["motion"];
  /** Preferred layout variant per section type. */
  variants: Record<string, string>;
  /** Decoration for hero / feature / cta sections. */
  decor: { hero: Section["style"]["decor"]; features: Section["style"]["decor"]; cta: Section["style"]["decor"] };
  /** How section backgrounds alternate down the page. */
  rhythm: "alternate" | "calm" | "contrast";
  surface?: SiteTheme["surface"];
};

export const PERSONALITIES: Personality[] = [
  {
    id: "luxury",
    label: "Luxury",
    description: "Refined serif type, generous space, restrained colour, full-bleed imagery.",
    palettes: ["midnight", "bordeaux", "linen", "navy", "champagne", "espresso", "royal"],
    fontPairs: ["luxury", "gallery", "classic"],
    radius: "none",
    density: "airy",
    buttonStyle: "sharp",
    typeScale: "dramatic",
    motion: "subtle",
    variants: { navbar: "centered", hero: "overlay", features: "numbered", testimonials: "spotlight", cta: "band", gallery: "masonry", menu: "list", footer: "columns", split: "image-left", stats: "row", text: "lead" },
    decor: { hero: "none", features: "none", cta: "grain" },
    rhythm: "calm",
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "Magazine-style headlines, warm paper tones and confident typography.",
    palettes: ["linen", "paper", "terracotta", "clay", "rosewood", "champagne"],
    fontPairs: ["editorial", "gallery", "literary"],
    radius: "none",
    density: "airy",
    buttonStyle: "sharp",
    typeScale: "dramatic",
    motion: "subtle",
    variants: { navbar: "classic", hero: "editorial", features: "numbered", text: "columns", testimonials: "spotlight", cta: "band", gallery: "masonry", footer: "columns", faq: "split", split: "image-right" },
    decor: { hero: "none", features: "none", cta: "none" },
    rhythm: "calm",
  },
  {
    id: "modern",
    label: "Modern product",
    description: "Crisp sans-serif, soft gradients, bento layouts and pill buttons.",
    palettes: ["cobalt", "violet", "teal", "paper", "porcelain", "ocean"],
    fontPairs: ["product", "startup", "tech"],
    radius: "lg",
    density: "comfortable",
    buttonStyle: "pill",
    typeScale: "balanced",
    motion: "expressive",
    variants: { navbar: "floating", hero: "centered", features: "bento", stats: "cards", testimonials: "grid", pricing: "cards", cta: "card", logos: "default", steps: "numbered", footer: "columns", faq: "split" },
    decor: { hero: "mesh", features: "none", cta: "gradient" },
    rhythm: "alternate",
  },
  {
    id: "dark-tech",
    label: "Dark tech",
    description: "Deep backgrounds, luminous accents, grid textures and technical type.",
    palettes: ["aurora", "neon", "obsidian", "graphite", "dusk"],
    fontPairs: ["tech", "startup", "avant"],
    radius: "md",
    density: "comfortable",
    buttonStyle: "pill",
    typeScale: "dramatic",
    motion: "expressive",
    variants: { navbar: "floating", hero: "centered", features: "bento", stats: "row", testimonials: "grid", cta: "card", steps: "timeline", footer: "columns" },
    decor: { hero: "glow", features: "grid", cta: "glow" },
    rhythm: "contrast",
  },
  {
    id: "friendly",
    label: "Friendly",
    description: "Rounded shapes, warm colour and approachable type for local businesses.",
    palettes: ["citrus", "coral", "mist", "lavender", "saffron", "berry"],
    fontPairs: ["friendly", "expressive"],
    radius: "lg",
    density: "comfortable",
    buttonStyle: "pill",
    typeScale: "balanced",
    motion: "subtle",
    variants: { navbar: "classic", hero: "split", features: "icons", testimonials: "grid", cta: "card", steps: "numbered", menu: "cards", gallery: "grid", footer: "simple" },
    decor: { hero: "dots", features: "none", cta: "gradient" },
    rhythm: "alternate",
  },
  {
    id: "bold",
    label: "Bold",
    description: "Oversized type, high contrast, sharp edges and strong colour blocks.",
    palettes: ["lime", "paper", "coral", "obsidian", "saffron"],
    fontPairs: ["bold", "avant", "expressive"],
    radius: "none",
    density: "compact",
    buttonStyle: "sharp",
    typeScale: "dramatic",
    motion: "expressive",
    variants: { navbar: "classic", hero: "editorial", features: "numbered", stats: "row", testimonials: "spotlight", cta: "band", gallery: "carousel", footer: "columns" },
    decor: { hero: "none", features: "none", cta: "none" },
    rhythm: "contrast",
  },
  {
    id: "organic",
    label: "Natural",
    description: "Earthy palette, soft corners and calm imagery for wellness and food.",
    palettes: ["sage", "sand", "clay", "forest-night", "matcha", "emerald"],
    fontPairs: ["classic", "editorial", "friendly"],
    radius: "lg",
    density: "airy",
    buttonStyle: "pill",
    typeScale: "balanced",
    motion: "subtle",
    variants: { navbar: "classic", hero: "overlay", features: "icons", testimonials: "spotlight", cta: "card", gallery: "masonry", steps: "numbered", split: "image-left", footer: "columns" },
    decor: { hero: "none", features: "none", cta: "grain" },
    rhythm: "calm",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Plenty of white space, quiet colour and precise alignment.",
    palettes: ["paper", "mist", "sand", "porcelain"],
    fontPairs: ["product", "gallery", "system"],
    radius: "sm",
    density: "airy",
    buttonStyle: "outline",
    typeScale: "balanced",
    motion: "subtle",
    variants: { navbar: "classic", hero: "minimal", features: "icons", text: "lead", testimonials: "spotlight", cta: "band", gallery: "grid", footer: "simple" },
    decor: { hero: "none", features: "none", cta: "none" },
    rhythm: "calm",
  },
  {
    id: "corporate",
    label: "Professional",
    description: "Trustworthy navy and teal, clear hierarchy and structured layouts.",
    palettes: ["navy", "teal", "cobalt", "ocean", "emerald"],
    fontPairs: ["literary", "product", "startup"],
    radius: "sm",
    density: "comfortable",
    buttonStyle: "solid",
    typeScale: "balanced",
    motion: "subtle",
    variants: { navbar: "classic", hero: "split", features: "cards", stats: "cards", testimonials: "grid", steps: "numbered", cta: "band", faq: "split", footer: "columns", team: "grid" },
    decor: { hero: "grid", features: "none", cta: "none" },
    rhythm: "alternate",
  },
  {
    id: "playful",
    label: "Playful",
    description: "Vivid colour, expressive type, dotted textures and bouncy rhythm.",
    palettes: ["coral", "citrus", "violet", "lavender", "berry", "saffron"],
    fontPairs: ["expressive", "avant", "friendly"],
    radius: "lg",
    density: "comfortable",
    buttonStyle: "pill",
    typeScale: "dramatic",
    motion: "expressive",
    variants: { navbar: "floating", hero: "centered", features: "bento", testimonials: "grid", cta: "card", gallery: "carousel", steps: "numbered", footer: "simple" },
    decor: { hero: "dots", features: "dots", cta: "gradient" },
    rhythm: "contrast",
  },
];

PERSONALITIES.push({
  id: "glass",
  label: "Glass",
  description: "Frosted, translucent panels over soft colour light, rounded corners and crisp system type — Apple-inspired.",
  palettes: ["porcelain", "dusk", "graphite", "ocean", "lavender"],
  fontPairs: ["system", "product", "startup"],
  radius: "lg",
  density: "airy",
  buttonStyle: "pill",
  typeScale: "dramatic",
  motion: "expressive",
  variants: { navbar: "floating", hero: "centered", features: "bento", stats: "cards", testimonials: "grid", pricing: "cards", cta: "card", steps: "numbered", faq: "split", gallery: "grid", footer: "columns", split: "image-right" },
  decor: { hero: "mesh", features: "mesh", cta: "gradient" },
  // Plain backgrounds let the page's colour light show through the glass.
  rhythm: "calm",
  surface: "glass",
});

export const personality = (id: string | undefined) => PERSONALITIES.find((p) => p.id === id) ?? PERSONALITIES[2];
export const palette = (id: string) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/** Fixes any palette so text, secondary text and buttons meet WCAG AA. */
export function harmonize(p: SiteTheme["palette"]): SiteTheme["palette"] {
  const out = { ...p };
  out.text = ensureContrast(out.text, out.background, 7);
  out.text = ensureContrast(out.text, out.surface, 4.5);
  out.muted = ensureContrast(out.muted, out.background, 4.5);
  out.muted = ensureContrast(out.muted, out.surface, 4.5);
  if (contrast(out.accentText, out.accent) < 4.5) out.accentText = onColor(out.accent);
  // The accent is used for links and outline buttons on the page background too.
  if (contrast(out.accent, out.background) < 3) out.accent = ensureContrast(out.accent, out.background, 3);
  if (contrast(out.accentText, out.accent) < 4.5) out.accentText = onColor(out.accent);
  // Mid-tone accents can fail with both black and white text: deepen (or lift) the accent until its text passes.
  for (let i = 0; i < 20 && contrast(out.accentText, out.accent) < 4.5; i++) {
    out.accent = mix(out.accent, luminance(out.accentText) > 0.5 ? "#000000" : "#ffffff", 0.06);
  }
  return out;
}

export function themeFor(personalityId: string, opts: { palette?: string; fontPair?: string; seed?: number } = {}): SiteTheme {
  const p = personality(personalityId);
  const seed = opts.seed ?? 0;
  const pal = palette(opts.palette ?? p.palettes[seed % p.palettes.length]);
  const pairId = opts.fontPair ?? p.fontPairs[seed % p.fontPairs.length];
  const pair = FONT_PAIRS.find((f) => f.id === pairId) ?? FONT_PAIRS[0];
  const { id: _id, label: _label, ...colors } = pal;
  void _id;
  void _label;
  return {
    palette: harmonize(colors),
    font: pair.body,
    headingFont: pair.heading,
    radius: p.radius,
    density: p.density,
    buttonStyle: p.buttonStyle,
    typeScale: p.typeScale,
    motion: p.motion,
    ...(p.surface ? { surface: p.surface } : {}),
    personality: p.id,
  };
}

/** Restyles section variants, decoration and background rhythm for a direction. */
export function applyLayout(doc: SiteDoc, personalityId: string, opts: { structure?: boolean } = {}) {
  const p = personality(personalityId);
  const structure = opts.structure !== false;
  for (const page of doc.pages) {
    let band = 0;
    for (const s of page.sections) {
      if (structure) {
        const preferred = p.variants[s.type];
        if (preferred) s.variant = preferred;
        if (s.type === "hero") s.style.decor = variantOf(s) === "overlay" ? "none" : p.decor.hero;
        else if (s.type === "features") s.style.decor = p.decor.features;
        else if (s.type === "cta") s.style.decor = p.decor.cta;
        else if (s.style.decor !== "none" && s.type !== "newsletter") s.style.decor = "none";
      }
      if (["navbar", "footer", "banner", "hero"].includes(s.type)) continue;
      if (s.type === "cta") {
        // On glass, the call-to-action card floats over the page's colour light.
        s.style.background = p.surface === "glass" ? "default" : p.rhythm === "calm" ? "inverse" : "accent";
        continue;
      }
      if (s.type === "logos") {
        s.style.background = "default";
        continue;
      }
      band++;
      s.style.background = p.rhythm === "calm" ? (band % 3 === 0 ? "surface" : "default") : p.rhythm === "contrast" ? (band % 4 === 0 ? "inverse" : band % 2 === 0 ? "surface" : "default") : band % 2 === 0 ? "surface" : "default";
    }
  }
}

export function applyPersonality(doc: SiteDoc, personalityId: string, seed = 0) {
  doc.theme = themeFor(personalityId, { seed });
  applyLayout(doc, personalityId);
}

/** Picks a direction from industry and brief wording. */
export function suggestPersonality(industry: string, brief: string): string {
  const t = brief.toLowerCase();
  if (/luxur|premium|exclusive|fine dining|boutique|high[- ]end|elegant/.test(t)) return "luxury";
  if (/minimal|simple|clean/.test(t)) return "minimal";
  if (/bold|loud|streetwear|athletic|gym|fitness|sport/.test(t)) return "bold";
  if (/kids|fun|playful|party|toy|candy/.test(t)) return "playful";
  if (/organic|natural|wellness|yoga|spa|eco|garden|farm|vegan/.test(t)) return "organic";
  if (/glassmorphism|\bglass\b|apple-like|apple style|\bios\b|iphone|mobile app/.test(t)) return "glass";
  if (/ai\b|crypto|developer|devtool|api|cyber|web3|gaming/.test(t)) return "dark-tech";
  if (/magazine|blog|journal|writer|author|photograph|architect/.test(t)) return "editorial";
  switch (industry) {
    case "Restaurant":
      return "editorial";
    case "Software":
      return "modern";
    case "Portfolio":
      return "editorial";
    case "Professional services":
    case "Law firm":
    case "Accounting & finance":
      return "corporate";
    case "Medical clinic":
      return "minimal";
    case "Hotel":
    case "Jewellery":
      return "luxury";
    case "Travel":
      return "organic";
    case "Photography":
    case "Weddings & events":
    case "Fashion":
    case "Architecture & interiors":
      return "editorial";
    case "Music & entertainment":
      return "dark-tech";
    case "Automotive":
    case "Home services":
      return "bold";
    case "Pet care":
    case "Nonprofit":
      return "friendly";
    case "Mobile app":
      return "glass";
    default:
      return "friendly";
  }
}

/** Three distinct directions to offer, starting with the best match. */
export function directionChoices(industry: string, brief: string): string[] {
  const first = suggestPersonality(industry, brief);
  const alternates: Record<string, string[]> = {
    luxury: ["editorial", "minimal"],
    editorial: ["luxury", "organic"],
    modern: ["dark-tech", "minimal"],
    "dark-tech": ["modern", "bold"],
    friendly: ["playful", "organic"],
    bold: ["dark-tech", "editorial"],
    organic: ["minimal", "luxury"],
    minimal: ["editorial", "modern"],
    corporate: ["modern", "minimal"],
    playful: ["friendly", "bold"],
    glass: ["modern", "dark-tech"],
  };
  return [first, ...(alternates[first] ?? ["modern", "minimal"])];
}

// ─── Design actions (one click, deterministic, undoable) ─────────────────────

export type DesignAction = { id: string; label: string; description: string; apply: (doc: SiteDoc) => void };

function nextPair(current: FontKey, step = 1) {
  const i = FONT_PAIRS.findIndex((p) => p.heading === current);
  return FONT_PAIRS[(i + step + FONT_PAIRS.length) % FONT_PAIRS.length];
}

function toDark(p: SiteTheme["palette"]): SiteTheme["palette"] {
  if (isDark(p.background)) return p;
  const background = mix(p.text, "#000000", 0.55);
  return harmonize({ background, surface: mix(background, "#ffffff", 0.06), text: "#f4f2ee", muted: "#b3aea6", accent: mix(p.accent, "#ffffff", 0.35), accentText: p.accentText });
}

function toLight(p: SiteTheme["palette"]): SiteTheme["palette"] {
  if (!isDark(p.background)) return p;
  return harmonize({ background: "#fbfaf8", surface: "#f0eee9", text: mix(p.background, "#000000", 0.4), muted: "#5d5a55", accent: mix(p.accent, "#000000", 0.45), accentText: "#ffffff" });
}

export const DESIGN_ACTIONS: DesignAction[] = [
  {
    id: "premium",
    label: "Make it premium",
    description: "Refined serif headings, more space, sharper edges, calmer rhythm.",
    apply: (d) => {
      const pair = FONT_PAIRS.find((p) => p.id === (isDark(d.theme.palette.background) ? "gallery" : "luxury"))!;
      Object.assign(d.theme, { headingFont: pair.heading, font: pair.body, density: "airy", typeScale: "dramatic", radius: "none", buttonStyle: "sharp", motion: "subtle" });
      for (const p of d.pages) for (const s of p.sections) {
        if (s.type === "hero" && variantOf(s) === "centered") s.variant = "editorial";
        if (s.type === "features") s.variant = "numbered";
        if (s.type === "testimonials") s.variant = "spotlight";
        if (["features", "hero"].includes(s.type) && ["dots", "grid"].includes(s.style.decor)) s.style.decor = "none";
      }
    },
  },
  {
    id: "bolder",
    label: "Make it bolder",
    description: "Bigger display type, stronger contrast blocks and square buttons.",
    apply: (d) => {
      Object.assign(d.theme, { headingFont: "archivo", typeScale: "dramatic", buttonStyle: "sharp", density: "compact", motion: "expressive" });
      for (const p of d.pages) for (const s of p.sections) if (s.type === "cta" || s.type === "stats") s.style.background = "inverse";
    },
  },
  {
    id: "minimal",
    label: "Simplify",
    description: "Removes decoration, quiets backgrounds and adds white space.",
    apply: (d) => {
      Object.assign(d.theme, { density: "airy", buttonStyle: "outline", motion: "subtle" });
      for (const p of d.pages) for (const s of p.sections) {
        s.style.decor = "none";
        if (s.style.background === "accent" || s.style.background === "inverse") s.style.background = s.type === "cta" ? "surface" : "default";
      }
    },
  },
  { id: "dark", label: "Dark mode", description: "Rebuilds the palette on a dark background with AA contrast.", apply: (d) => void (d.theme.palette = toDark(d.theme.palette)) },
  { id: "light", label: "Light mode", description: "Rebuilds the palette on a light background with AA contrast.", apply: (d) => void (d.theme.palette = toLight(d.theme.palette)) },
  { id: "space", label: "More breathing room", description: "Increases section spacing.", apply: (d) => void (d.theme.density = d.theme.density === "compact" ? "comfortable" : "airy") },
  { id: "tighten", label: "Tighten spacing", description: "Reduces section spacing.", apply: (d) => void (d.theme.density = d.theme.density === "airy" ? "comfortable" : "compact") },
  { id: "soften", label: "Softer corners", description: "Rounder cards, images and pill buttons.", apply: (d) => Object.assign(d.theme, { radius: "lg", buttonStyle: "pill" }) },
  { id: "sharpen", label: "Sharper corners", description: "Square edges for a tailored look.", apply: (d) => Object.assign(d.theme, { radius: "none", buttonStyle: "sharp" }) },
  {
    id: "fonts",
    label: "Try another font pairing",
    description: "Cycles through curated heading/body pairings.",
    apply: (d) => {
      const pair = nextPair(d.theme.headingFont);
      Object.assign(d.theme, { headingFont: pair.heading, font: pair.body });
    },
  },
  {
    id: "palette",
    label: "Try another palette",
    description: "Cycles through curated palettes that suit the current direction.",
    apply: (d) => {
      const p = personality(d.theme.personality);
      const pool = p.palettes.map(palette);
      const i = pool.findIndex((x) => x.background === d.theme.palette.background && x.accent === d.theme.palette.accent);
      const { id: _i, label: _l, ...c } = pool[(i + 1) % pool.length];
      void _i;
      void _l;
      d.theme.palette = harmonize(c);
    },
  },
  { id: "motion", label: "Add motion", description: "Gentle reveal animations as visitors scroll (respects reduced-motion settings).", apply: (d) => void (d.theme.motion = d.theme.motion === "none" ? "subtle" : "expressive") },
  { id: "still", label: "Remove motion", description: "Turns off all animations.", apply: (d) => void (d.theme.motion = "none") },
  { id: "glass", label: "Glass effect", description: "Frosted, translucent cards and navigation over soft colour light.", apply: (d) => Object.assign(d.theme, { surface: d.theme.surface === "glass" ? "solid" : "glass", radius: d.theme.radius === "none" ? "md" : d.theme.radius }) },
  { id: "contrast", label: "Fix contrast", description: "Adjusts colours so all text meets WCAG AA.", apply: (d) => void (d.theme.palette = harmonize(d.theme.palette)) },
  { id: "rhythm", label: "Improve section rhythm", description: "Re-balances alternating backgrounds down each page.", apply: (d) => applyLayout(d, d.theme.personality ?? "modern", { structure: false }) },
];

export const designAction = (id: string) => DESIGN_ACTIONS.find((a) => a.id === id);
