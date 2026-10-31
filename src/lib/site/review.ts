// Design review: the checks a senior designer runs on a page, each with an
// explanation and (where safe) a one-click fix. Deterministic, no AI needed.
import { contrast } from "./color";
import { applyLayout, harmonize } from "./design";
import { isPlaceholderPhoto } from "./media";
import { createSection, sectionDef, variantOf, type Page, type Section, type SiteDoc } from "./model";
import { safeImageUrl } from "./render";

export type Finding = {
  id: string;
  area: "Hierarchy" | "Rhythm" | "Conversion" | "Restraint" | "Readability" | "Mobile" | "Imagery";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  sectionId?: string;
  fixLabel?: string;
  fix?: (doc: SiteDoc, pageId: string) => void;
};

const words = (v: unknown) => String(v ?? "").trim().split(/\s+/).filter(Boolean).length;
const pageOf = (doc: SiteDoc, id: string) => doc.pages.find((p) => p.id === id)!;
const CONTENT = (s: Section) => !["navbar", "footer", "banner"].includes(s.type);
// A closing action is a conversion section, or a button repeating the hero's primary action.
const isClosingAction = (s: Section, primaryHref: unknown) =>
  ["cta", "booking", "contact", "newsletter", "pricing", "products"].includes(s.type) || (!!primaryHref && String(s.props.buttonLabel ?? "").trim() !== "" && s.props.buttonHref === primaryHref);

export function reviewPage(doc: SiteDoc, page: Page): Finding[] {
  const out: Finding[] = [];
  const secs = page.sections;
  const hero = secs.find((s) => s.type === "hero");

  if (!hero) {
    out.push({ id: "no-hero", area: "Hierarchy", severity: "high", title: "The page has no hero", detail: "Visitors decide in seconds whether they are in the right place. A hero with one clear promise anchors the page.", fixLabel: "Add a hero", fix: (d, pid) => pageOf(d, pid).sections.splice(secs[0]?.type === "navbar" ? 1 : 0, 0, createSection("hero")) });
  } else {
    if (words(hero.props.heading) > 12) {
      out.push({ id: "long-headline", area: "Hierarchy", severity: "medium", sectionId: hero.id, title: `Headline is ${words(hero.props.heading)} words`, detail: "Strong headlines are short (under 10 words). Move detail into the supporting text." });
    }
    const v = variantOf(hero);
    if ((v === "overlay" || v === "split") && !safeImageUrl(hero.props.image)) {
      out.push({ id: "hero-no-image", area: "Imagery", severity: "medium", sectionId: hero.id, title: "Photo layout without a photo", detail: `The “${v}” hero is designed around an image. Add one, or switch to a type-led layout.`, fixLabel: "Use the editorial layout", fix: (d, pid) => void (pageOf(d, pid).sections.find((s) => s.id === hero.id)!.variant = "editorial") });
    }
    if (!String(hero.props.primaryLabel ?? "").trim()) {
      out.push({ id: "hero-no-cta", area: "Conversion", severity: "high", sectionId: hero.id, title: "The hero has no primary action", detail: "Give visitors one obvious next step above the fold.", fixLabel: "Add “Get in touch”", fix: (d, pid) => Object.assign(pageOf(d, pid).sections.find((s) => s.id === hero.id)!.props, { primaryLabel: "Get in touch", primaryHref: "#contact" }) });
    }
    if (doc.theme.typeScale === "dramatic" && String(hero.props.heading ?? "").length > 48 && !hero.style.overrides?.mobile?.textScale) {
      out.push({ id: "mobile-headline", area: "Mobile", severity: "low", sectionId: hero.id, title: "Long headline at dramatic size on phones", detail: "At 390px this headline wraps to many lines and pushes the action below the fold.", fixLabel: "Reduce headline size on mobile", fix: (d, pid) => {
        const s = pageOf(d, pid).sections.find((x) => x.id === hero.id)!;
        s.style.overrides = { ...s.style.overrides, mobile: { ...s.style.overrides?.mobile, textScale: "sm" } };
      } });
    }
  }

  // Rhythm: neighbouring sections with the same strong background merge visually.
  const content = secs.filter(CONTENT);
  for (let i = 1; i < content.length; i++) {
    const [a, b] = [content[i - 1], content[i]];
    const strong = (x: Section) => x.style.background === "accent" || x.style.background === "inverse";
    if ((strong(a) && strong(b)) || (a.style.background === "surface" && b.style.background === "surface")) {
      out.push({ id: `rhythm-${b.id}`, area: "Rhythm", severity: strong(a) ? "medium" : "low", sectionId: b.id, title: "Two sections run together", detail: `${sectionDef(a.type)?.label} and ${sectionDef(b.type)?.label} share a background, so the page loses its rhythm.`, fixLabel: "Re-balance section backgrounds", fix: (d) => applyLayout(d, d.theme.personality ?? "modern", { structure: false }) });
      break;
    }
  }

  const decorated = content.filter((s) => s.style.decor !== "none");
  if (decorated.length > 2) {
    out.push({ id: "too-much-decor", area: "Restraint", severity: "low", title: `${decorated.length} decorated sections`, detail: "Decoration works as an accent. More than two decorated sections compete with the content.", fixLabel: "Keep decoration on the first two", fix: (d, pid) => pageOf(d, pid).sections.filter(CONTENT).filter((s) => s.style.decor !== "none").slice(2).forEach((s) => (s.style.decor = "none")) });
  }

  if (!content.slice(1).some((s) => isClosingAction(s, hero?.props.primaryHref)) && content.length > 2) {
    out.push({ id: "no-closing-cta", area: "Conversion", severity: "medium", title: "No action at the end of the page", detail: "Visitors who read to the bottom are the most interested. Repeat the primary action there.", fixLabel: "Add a call-to-action band", fix: (d, pid) => {
      const p = pageOf(d, pid);
      const s = createSection("cta");
      const h = p.sections.find((x) => x.type === "hero");
      Object.assign(s.props, { heading: "Ready when you are", buttonLabel: h?.props.primaryLabel || "Get in touch", buttonHref: h?.props.primaryHref || "#contact" });
      s.style.background = "accent";
      const footer = p.sections.findIndex((x) => x.type === "footer");
      p.sections.splice(footer >= 0 ? footer : p.sections.length, 0, s);
    } });
  }

  const nav = secs.find((s) => s.type === "navbar");
  if (nav && !String(nav.props.ctaLabel ?? "").trim() && hero?.props.primaryLabel) {
    out.push({ id: "nav-cta", area: "Conversion", severity: "low", sectionId: nav.id, title: "Navigation has no action button", detail: "A button in the sticky navigation keeps the main action one click away while scrolling.", fixLabel: "Add the hero's action to the navigation", fix: (d, pid) => Object.assign(pageOf(d, pid).sections.find((s) => s.id === nav.id)!.props, { ctaLabel: hero.props.primaryLabel, ctaHref: hero.props.primaryHref }) });
  }
  if (!secs.some((s) => s.type === "footer")) {
    out.push({ id: "no-footer", area: "Hierarchy", severity: "low", title: "The page has no footer", detail: "Footers signal the end of the page and hold secondary links visitors expect.", fixLabel: "Add a footer", fix: (d, pid) => void pageOf(d, pid).sections.push(createSection("footer")) });
  }
  if (content.length > 11) {
    out.push({ id: "long-page", area: "Hierarchy", severity: "low", title: `${content.length} sections on one page`, detail: "Long pages lose people. Consider moving detail (team, FAQ, process) to its own page." });
  }

  for (const s of content) {
    for (const k of ["body", "subheading"]) {
      const paras = String(s.props[k] ?? "").split(/\n\s*\n/);
      if (paras.some((p) => words(p) > 90)) {
        out.push({ id: `wall-${s.id}`, area: "Readability", severity: "low", sectionId: s.id, title: `Long paragraph in ${sectionDef(s.type)?.label}`, detail: "Paragraphs over ~90 words feel like a wall of text on screens. Split them or use a list." });
        break;
      }
    }
  }

  for (const s of content.filter((x) => x.props._example)) {
    out.push({ id: `example-${s.id}`, area: "Conversion", severity: "high", sectionId: s.id, title: `${sectionDef(s.type)?.label} shows example content`, detail: "Example figures, names or logos must be replaced with real ones (or removed) before the site can go live." });
  }

  const pal = doc.theme.palette;
  if (contrast(pal.text, pal.background) < 4.5 || contrast(pal.muted, pal.background) < 4.5 || contrast(pal.accentText, pal.accent) < 4.5) {
    out.push({ id: "contrast", area: "Readability", severity: "high", title: "Some text fails contrast", detail: "Low-contrast text is hard to read for many people and in sunlight. WCAG AA needs 4.5:1.", fixLabel: "Fix contrast", fix: (d) => void (d.theme.palette = harmonize(d.theme.palette)) });
  }

  const stock = content.flatMap((s) => Object.values(s.props)).filter(isPlaceholderPhoto).length;
  if (stock) {
    out.push({ id: "stock", area: "Imagery", severity: "low", title: `${stock} placeholder photo${stock === 1 ? "" : "s"}`, detail: "Real photos of your place, people and work convert better than stock. Upload yours in Media." });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
