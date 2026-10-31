// Content, SEO and accessibility checks for a site document. Each finding
// explains what is wrong and where, so the score is never an opaque number.
import { contrast } from "./color";
import { outOfSync } from "./globals";
import { isPlaceholderPhoto } from "./media";
import { sectionDef, type FieldDef, type SiteDoc } from "./model";
import { safeImageUrl, safeUrl } from "./render";

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  category: "seo" | "accessibility" | "content" | "links" | "structure" | "design";
  message: string;
  pageId?: string;
  sectionId?: string;
};

const PLACEHOLDER = /\[(replace|customer name|add |client )[^\]]*\]/i;

export function walkStrings(value: unknown, fields: FieldDef[], visit: (field: FieldDef, v: unknown) => void) {
  const obj = (value ?? {}) as Record<string, unknown>;
  for (const f of fields) {
    const v = obj[f.key];
    if (f.kind === "list") {
      if (Array.isArray(v)) for (const item of v) walkStrings(item, f.fields, visit);
    } else visit(f, v);
  }
}

/** Whether the site shows a store (product grids, collections or a cart link). */
export const usesStore = (doc: SiteDoc) => doc.pages.some((p) => p.sections.some((s) => s.type === "productGrid" || s.type === "collectionList" || (s.type === "navbar" && !!s.props.showCart)));

// Store pages (/shop, /cart, …) are served dynamically, not from site pages.
const STORE_ROUTE = /^\/(shop(\/[a-z0-9-]+)?|product\/[a-z0-9-]+|cart|checkout|track|account|book(\/[0-9a-f-]{36})?|policies\/(shipping|refund|privacy|terms))$/;
export const isStoreRoute = (path: string) => STORE_ROUTE.test(path);

export function diagnose(doc: SiteDoc): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const g of outOfSync(doc)) out.push({ severity: "warning", category: "structure", message: `Global component “${g.name}” differs on ${g.pages.join(", ")}. Open one instance in the builder and make any edit to sync them, or detach it.` });
  const paths = new Set(doc.pages.map((p) => p.path));
  const hasStore = usesStore(doc);
  const pal = doc.theme.palette;
  const pairs: [string, string, string, number][] = [
    ["Body text", pal.text, pal.background, 4.5],
    ["Body text on surfaces", pal.text, pal.surface, 4.5],
    ["Secondary text", pal.muted, pal.background, 4.5],
    ["Button text", pal.accentText, pal.accent, 4.5],
  ];
  for (const [label, fg, bg, min] of pairs) {
    const r = contrast(fg, bg);
    if (r < min) out.push({ severity: r < 3 ? "error" : "warning", category: "accessibility", message: `${label} contrast is ${r.toFixed(2)}:1; WCAG AA needs ${min}:1. Use “Fix contrast” in Design.` });
  }
  let placeholderPhotos = 0;

  for (const page of doc.pages) {
    const at = { pageId: page.id };
    if (!page.description.trim()) {
      out.push({ ...at, severity: "warning", category: "seo", message: `“${page.title}” has no meta description. Search results will show arbitrary text.` });
    } else if (page.description.length < 50) {
      out.push({ ...at, severity: "info", category: "seo", message: `“${page.title}” meta description is short (${page.description.length} characters); 120–160 works best.` });
    }
    const heroes = page.sections.filter((s) => s.type === "hero").length;
    if (heroes === 0) out.push({ ...at, severity: "info", category: "accessibility", message: `“${page.title}” has no hero, so it has no top-level heading (h1).` });
    if (heroes > 1) out.push({ ...at, severity: "warning", category: "accessibility", message: `“${page.title}” has ${heroes} hero sections, which creates multiple h1 headings.` });
    if (page.sections.length === 0) out.push({ ...at, severity: "warning", category: "structure", message: `“${page.title}” is empty.` });
    if (page.needsTranslation) out.push({ ...at, severity: "warning", category: "content", message: `“${page.title}” (${page.lang}) has not been translated yet.` });

    for (const s of page.sections) {
      const def = sectionDef(s.type);
      if (!def) continue;
      const here = { ...at, sectionId: s.id };
      if (s.props._example) {
        out.push({ ...here, severity: "error", category: "content", message: `${def.label} contains example figures or names. Edit it with real information (or delete it) before publishing to production.` });
      }
      walkStrings(s.props, def.fields, (f, v) => {
        if (f.kind === "image" && isPlaceholderPhoto(v)) placeholderPhotos++;
        if (typeof v === "string" && PLACEHOLDER.test(v)) {
          out.push({ ...here, severity: "warning", category: "content", message: `${def.label}: “${f.label}” still contains placeholder text. Replace it with real content before publishing.` });
        }
        if (f.kind === "url" && typeof v === "string" && v.trim()) {
          const u = safeUrl(v);
          if (!u) out.push({ ...here, severity: "error", category: "links", message: `${def.label}: “${v}” is not a valid or allowed link.` });
          else if (u.startsWith("/") && !paths.has(u.split(/[?#]/)[0].replace(/\/$/, "") || "/") && !(hasStore && isStoreRoute(u.split(/[?#]/)[0].replace(/\/$/, "")))) {
            out.push({ ...here, severity: "error", category: "links", message: `${def.label}: link “${v}” points to a page that does not exist.` });
          }
        }
        if (f.kind === "image" && typeof v === "string" && v.trim() && !safeImageUrl(v)) {
          out.push({ ...here, severity: "error", category: "content", message: `${def.label}: image URL “${v}” must start with https:// or /.` });
        }
      });
      if (s.type === "hero" && safeImageUrl(s.props.image) && !String(s.props.imageAlt ?? "").trim()) {
        out.push({ ...here, severity: "warning", category: "accessibility", message: "Hero image has no description (alt text) for screen readers." });
      }
      if (s.type === "gallery") {
        const missing = (Array.isArray(s.props.images) ? s.props.images : []).filter((i: { src?: string; alt?: string }) => i?.src && !i?.alt?.trim()).length;
        if (missing) out.push({ ...here, severity: "warning", category: "accessibility", message: `Gallery has ${missing} image(s) without a description.` });
      }
      if (s.type === "products") {
        const noLink = (Array.isArray(s.props.items) ? s.props.items : []).filter((i: { buttonHref?: string }) => !String(i?.buttonHref ?? "").trim()).length;
        if (noLink) out.push({ ...here, severity: "warning", category: "links", message: `${noLink} product(s) have no buy link. Add a payment link (Stripe, Razorpay) or a page to enquire.` });
      }
      if (s.type === "map" && !String(s.props.address ?? "").trim()) out.push({ ...here, severity: "warning", category: "content", message: "Map has no address." });
            if (s.type === "contact" && !s.props.showForm && !["email", "phone", "whatsapp", "address"].some((k) => String(s.props[k] ?? "").trim())) {
        out.push({ ...here, severity: "warning", category: "content", message: "Contact section has no contact method and no form." });
      }
      if (s.style.hideOn.length === 3) {
        out.push({ ...here, severity: "info", category: "structure", message: `${def.label} is hidden on every screen size.` });
      }
    }
  }
  if (placeholderPhotos) {
    out.push({ severity: "warning", category: "content", message: `${placeholderPhotos} placeholder photo${placeholderPhotos === 1 ? " is" : "s are"} in use. They are free stock images; replace them with photos of your own business before launch.` });
  }
  return out;
}

/** Summary used by the UI: counts by severity, never an invented score. */
export function summarize(d: Diagnostic[]) {
  return {
    errors: d.filter((x) => x.severity === "error").length,
    warnings: d.filter((x) => x.severity === "warning").length,
    info: d.filter((x) => x.severity === "info").length,
  };
}
