// A small set of edit commands understood without an AI provider. Anything
// else requires a connected model; we never pretend to understand a request.
import { applyPersonality, designAction, PERSONALITIES } from "./design";
import { createSection, SECTION_DEFS, THEME_PRESETS, type SiteDoc } from "./model";

export type CommandResult = { doc: SiteDoc; summary: string } | null;

const SYNONYMS: Record<string, string> = {
  pricing: "pricing",
  prices: "pricing",
  faq: "faq",
  faqs: "faq",
  questions: "faq",
  testimonials: "testimonials",
  testimonial: "testimonials",
  reviews: "testimonials",
  gallery: "gallery",
  photos: "gallery",
  menu: "menu",
  contact: "contact",
  "contact form": "contact",
  booking: "booking",
  reservation: "booking",
  reservations: "booking",
  features: "features",
  "feature grid": "features",
  "call to action": "cta",
  cta: "cta",
  text: "text",
  about: "text",
  hero: "hero",
  stats: "stats",
  numbers: "stats",
  figures: "stats",
  steps: "steps",
  process: "steps",
  "how it works": "steps",
  team: "team",
  logos: "logos",
  clients: "logos",
  newsletter: "newsletter",
  "image and text": "split",
  spotlight: "split",
  announcement: "banner",
};

// Phrases mapped to deterministic design actions (see design.ts).
const DESIGN_PHRASES: [RegExp, string][] = [
  [/\b(more )?(premium|luxurious|luxury|elegant|high[- ]end|classy|sophisticated)\b/, "premium"],
  [/\b(bolder|more bold|stronger|punchier|more impact)\b/, "bolder"],
  [/\b(simpl(er|ify)|more minimal|minimalist|cleaner|declutter)\b/, "minimal"],
  [/\bdark( mode| theme| version)?\b/, "dark"],
  [/\blight( mode| theme| version)\b/, "light"],
  [/\b(more (white ?space|space|breathing room)|improve spacing|less cramped|airier)\b/, "space"],
  [/\b(tighten|tighter|more compact|less space)\b/, "tighten"],
  [/\b(soft(er)?|round(er|ed)) (corners|edges|look)\b/, "soften"],
  [/\b(sharp(er)?|square) (corners|edges|look)\b/, "sharpen"],
  [/\b(new|different|another|change( the)?) (fonts?|typography|typeface)\b/, "fonts"],
  [/\b(new|different|another|change( the)?) (colou?rs?|palette|colou?r scheme)\b/, "palette"],
  [/\b(add|more) (motion|animations?)|animate\b/, "motion"],
  [/\b(remove|no|stop) (motion|animations?)\b/, "still"],
  [/\b(fix|improve) (the )?(contrast|readability|accessibility)\b/, "contrast"],
  [/\b(improve|fix|better) (the )?(rhythm|flow|layout balance)\b/, "rhythm"],
];

function matchType(phrase: string): string | null {
  const p = phrase.toLowerCase().replace(/\b(a|an|the|new)\b/g, "").replace(/\s+/g, " ").trim();
  if (SYNONYMS[p]) return SYNONYMS[p];
  const def = SECTION_DEFS.find((d) => d.label.toLowerCase() === p || d.type === p);
  return def?.type ?? null;
}

export function runCommand(input: SiteDoc, instruction: string, pageId?: string | null): CommandResult {
  const text = instruction.trim().toLowerCase();
  const doc = structuredClone(input);
  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];

  const add = text.match(/^(?:please\s+)?add\s+(.+?)\s+section(?:\s+to\s+(?:this|the)\s+page)?\.?$/);
  if (add) {
    const type = matchType(add[1]);
    if (!type) return null;
    const footerIdx = page.sections.findIndex((s) => s.type === "footer");
    const at = footerIdx >= 0 ? footerIdx : page.sections.length;
    page.sections.splice(at, 0, createSection(type));
    const label = SECTION_DEFS.find((d) => d.type === type)!.label;
    return { doc, summary: `Added a ${label} section to “${page.title}”, above the footer.` };
  }

  const remove = text.match(/^(?:please\s+)?(?:remove|delete)\s+(?:the\s+)?(.+?)\s+section\.?$/);
  if (remove) {
    const type = matchType(remove[1]);
    if (!type) return null;
    const idx = page.sections.findIndex((s) => s.type === type);
    if (idx < 0) return null;
    page.sections.splice(idx, 1);
    return { doc, summary: `Removed the ${SECTION_DEFS.find((d) => d.type === type)!.label} section from “${page.title}”.` };
  }

  const direction = text.match(/^(?:use|apply|switch to|make it|restyle (?:it )?(?:as|in))\s+(?:the\s+|a\s+)?([\w-]+(?: [\w-]+)?)\s+(?:direction|style|look)\.?$/);
  if (direction) {
    const want = direction[1].replace(/\s+/g, "-");
    const p = PERSONALITIES.find((x) => x.id === want || x.label.toLowerCase() === direction[1]);
    if (p) {
      applyPersonality(doc, p.id);
      return { doc, summary: `Restyled the whole site in the ${p.label} direction: ${p.description}` };
    }
  }

  // Design phrases only apply to short, whole-site styling requests, so
  // "remove the premium plan" is not mistaken for "make it premium".
  const global = text.length <= 70 && !/\b(section|plan|page|button|heading|image|photo|menu|price|item|text|copy)\b/.test(text);
  for (const [re, id] of global ? DESIGN_PHRASES : []) {
    if (re.test(text)) {
      const action = designAction(id)!;
      action.apply(doc);
      return { doc, summary: `Applied the built-in “${action.label}” design action: ${action.description}` };
    }
  }

  const theme = text.match(/^(?:use|apply|switch to|change (?:the )?theme to)\s+(?:the\s+)?(\w+)(?:\s+theme)?\.?$/);
  if (theme) {
    const key = theme[1] === "dark" ? "midnight" : theme[1];
    const preset = THEME_PRESETS[key];
    if (!preset) return null;
    doc.theme = structuredClone(preset.theme);
    return { doc, summary: `Applied the ${preset.label} theme to the whole site.` };
  }
  return null;
}

export const COMMAND_EXAMPLES = ["Make it more premium", "Switch to dark mode", "Try a different font pairing", "Apply the editorial style", "Add a how it works section", "Improve spacing"];
