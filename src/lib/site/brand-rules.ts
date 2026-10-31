// Brand guardrails: pure checks shared by the server (enforcement) and the
// editor (warnings). Locks are absolute; wording rules are guidance.
import { walkStrings } from "./diagnostics";
import { sectionDef, type SiteDoc, type SiteTheme } from "./model";

export type BrandRules = {
  lockPalette: boolean;
  palette: SiteTheme["palette"] | null;
  lockFonts: boolean;
  font: string | null;
  headingFont: string | null;
  lockLogo: boolean;
  logo: string | null;
  voice: string;
  bannedWords: string[];
  preferredTerms: { avoid: string; use: string }[];
};

export type BrandIssue = { kind: "palette" | "fonts" | "logo" | "banned" | "preferred"; message: string; pageTitle?: string; sectionId?: string; field?: string; word?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive match (works for multi-word phrases too). */
export const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w.trim())}(?=$|[^\\p{L}\\p{N}])`, "iu");

export function samePalette(a: SiteTheme["palette"] | null | undefined, b: SiteTheme["palette"] | null | undefined) {
  if (!a || !b) return false;
  return (Object.keys(a) as (keyof SiteTheme["palette"])[]).every((k) => a[k].toLowerCase() === b[k].toLowerCase());
}

/** Every user-visible string in the document with its location. */
export function docStrings(doc: SiteDoc) {
  const out: { text: string; pageTitle: string; sectionId?: string; field: string }[] = [];
  for (const page of doc.pages) {
    out.push({ text: page.title, pageTitle: page.title, field: "Page title" }, { text: page.description, pageTitle: page.title, field: "Page description" });
    for (const s of page.sections) {
      const def = sectionDef(s.type);
      if (!def) continue;
      const visit = (props: unknown) =>
        walkStrings(props, def.fields, (f, v) => {
          if (typeof v === "string" && (f.kind === "text" || f.kind === "textarea")) out.push({ text: v, pageTitle: page.title, sectionId: s.id, field: `${def.label}: ${f.label}` });
        });
      visit(s.props);
      if (s.ab?.props) visit(s.ab.props);
    }
  }
  return out;
}

/** Words and phrases from the list that appear in the text. */
export function bannedIn(text: string, words: string[]) {
  return words.filter((w) => w.trim() && wordRe(w).test(text));
}

export function brandIssues(doc: SiteDoc, rules: BrandRules | null): BrandIssue[] {
  if (!rules) return [];
  const out: BrandIssue[] = [];
  if (rules.lockPalette && rules.palette && !samePalette(doc.theme.palette, rules.palette)) out.push({ kind: "palette", message: "The colours differ from your locked brand palette." });
  if (rules.lockFonts && rules.font && (doc.theme.font !== rules.font || doc.theme.headingFont !== rules.headingFont)) out.push({ kind: "fonts", message: "The fonts differ from your locked brand fonts." });
  if (rules.lockLogo && rules.logo && (doc.brand?.logo ?? "") !== rules.logo) out.push({ kind: "logo", message: "The logo differs from your locked brand logo." });
  for (const s of docStrings(doc)) {
    for (const w of bannedIn(s.text, rules.bannedWords)) out.push({ kind: "banned", message: `“${w}” is on your list of words to avoid.`, pageTitle: s.pageTitle, sectionId: s.sectionId, field: s.field, word: w });
    for (const t of rules.preferredTerms) if (t.avoid.trim() && wordRe(t.avoid).test(s.text)) out.push({ kind: "preferred", message: `Say “${t.use}” instead of “${t.avoid}”.`, pageTitle: s.pageTitle, sectionId: s.sectionId, field: s.field, word: t.avoid });
  }
  return out;
}

/**
 * Changes that break a lock. A locked property may stay as it is or be set
 * to the locked value; anything else is refused. Wording is only refused for
 * AI-made changes that add new occurrences of banned words.
 */
export function lockViolations(before: SiteDoc | null, after: SiteDoc, rules: BrandRules, opts: { ai: boolean }) {
  const out: string[] = [];
  if (rules.lockPalette && rules.palette && !samePalette(after.theme.palette, rules.palette) && !samePalette(after.theme.palette, before?.theme.palette)) out.push("The brand colours are locked.");
  if (rules.lockFonts && rules.font) {
    const ok = (d: SiteDoc | null) => !!d && d.theme.font === after.theme.font && d.theme.headingFont === after.theme.headingFont;
    if (!(after.theme.font === rules.font && after.theme.headingFont === rules.headingFont) && !ok(before)) out.push("The brand fonts are locked.");
  }
  if (rules.lockLogo && rules.logo) {
    const logo = after.brand?.logo ?? "";
    if (logo !== rules.logo && logo !== (before?.brand?.logo ?? "")) out.push("The brand logo is locked.");
  }
  if (opts.ai && rules.bannedWords.length) {
    const count = (d: SiteDoc | null) => (d ? docStrings(d).reduce((n, s) => n + bannedIn(s.text, rules.bannedWords).length, 0) : 0);
    if (count(after) > count(before)) {
      const words = [...new Set(docStrings(after).flatMap((s) => bannedIn(s.text, rules.bannedWords)))];
      out.push(`The change uses words your brand avoids: ${words.map((w) => `“${w}”`).join(", ")}.`);
    }
  }
  return out;
}

/** Writing guidance for AI prompts. */
export function voicePrompt(rules: BrandRules | null) {
  if (!rules) return "";
  const parts: string[] = [];
  if (rules.voice.trim()) parts.push(`Brand voice: ${rules.voice.trim()}`);
  if (rules.bannedWords.length) parts.push(`Never use these words or phrases: ${rules.bannedWords.map((w) => `"${w}"`).join(", ")}.`);
  if (rules.preferredTerms.length) parts.push(`Preferred terms: ${rules.preferredTerms.map((t) => `say "${t.use}" instead of "${t.avoid}"`).join("; ")}.`);
  if (rules.lockPalette || rules.lockFonts || rules.lockLogo) parts.push(`Do not change: ${[rules.lockPalette && "the colour palette", rules.lockFonts && "the fonts", rules.lockLogo && "the logo"].filter(Boolean).join(", ")} (locked by the brand owner).`);
  return parts.length ? `<brand_guidelines>\n${parts.join("\n")}\n</brand_guidelines>` : "";
}
