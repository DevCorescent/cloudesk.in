// Renders a site document to standalone HTML. Used for the builder preview
// (client-side, in a sandboxed iframe) and for deployments (server-side).
// Every user-controlled string passes through esc() or safeUrl(). Published
// output contains no JavaScript; motion is pure CSS.
import { EXTRA_CSS, renderExtra } from "./sections-extra";
import { CONNECTED_CSS, CONNECTED_TYPES, renderConnected } from "./sections-connected";
import { advancedCss, advancedLayers, elementsCss, extraFonts, siteUiCss } from "./advanced";
import { freeformItems, freeformRows, mobileRows, readingOrder, type FreeformItem } from "./freeform";
import { fontCss, fontStack } from "./fonts";
import { esc, safeImageUrl, safeUrl } from "./html";
import { BOOK_CSS } from "../bookings/pages";
import { collectionListBody, productGridBody, STORE_CSS, type Catalog } from "../store/storefront";
import { DATA_LIST_CSS, dataListBody } from "./data-list";
import { isDark } from "./color";
import { iconSvg } from "./icons";
import { variantOf, type Page, type Section, type SiteDoc, type SiteTheme } from "./model";

export type RenderMode =
  | { kind: "editor"; selectedId?: string | null }
  | { kind: "preview" }
  | { kind: "publish"; formAction: (formId: string) => string; basePath: string; ab?: "A" | "B" };

/** True when a page has a running A/B test (published twice, as A and B). */
export const hasExperiment = (page: Page) => page.sections.some((s) => s.ab?.running);

/** The key visitors are bucketed and counted under: the autopilot experiment id, or the page path for builder tests. */
export function experimentKey(page: Page) {
  const s = page.sections.find((x) => x.ab?.running);
  return s?.ab?.experimentId ? `g:${s.ab.experimentId}` : page.path;
}

/** Formats an ISO date (YYYY-MM-DD) for display without timezone drift. */
function formatDate(iso: string, lang: string) {
  const [y, m, d] = iso.split("-").map(Number);
  try {
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } catch {
    return iso;
  }
}

/** A deliberately small Markdown subset; every piece of text is escaped first. */
export function markdown(src: string, mode: RenderMode): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Bounded so a body full of "[" can't make this quadratic.
      .replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, (_m, label: string, href: string) => {
        const u = linkHref(href.replace(/&amp;/g, "&"), mode);
        return u ? `<a href="${esc(u)}">${label}</a>` : label;
      });
  return src
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => {
      const b = block.trim();
      if (!b) return "";
      const h = b.match(/^(#{2,4})\s+(.+)$/);
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      if (/^>\s/.test(b)) return `<blockquote>${inline(b.replace(/^>\s?/gm, ""))}</blockquote>`;
      const lines = b.split("\n");
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

export { esc, safeImageUrl, safeUrl } from "./html";

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const has = (v: unknown) => str(v).trim().length > 0;
const arr = <T = Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const pad = (n: number) => String(n).padStart(2, "0");

const RADIUS = { none: "0px", sm: "6px", md: "12px", lg: "22px" };
const DENSITY = { compact: 0.75, comfortable: 1, airy: 1.35 };
const SCALE = {
  compact: { h1: "clamp(2.1rem,4.4vw,3.4rem)", h2: "clamp(1.6rem,2.8vw,2.2rem)", hx: "clamp(2.6rem,6vw,4.6rem)" },
  balanced: { h1: "clamp(2.5rem,5.6vw,4.6rem)", h2: "clamp(1.85rem,3.4vw,2.8rem)", hx: "clamp(3rem,8vw,6.4rem)" },
  dramatic: { h1: "clamp(2.9rem,7vw,6rem)", h2: "clamp(2.1rem,4.2vw,3.5rem)", hx: "clamp(3.4rem,10.5vw,8.6rem)" },
};

function linkHref(href: unknown, mode: RenderMode): string {
  const u = safeUrl(href);
  if (mode.kind === "publish" && u.startsWith("/") && mode.basePath) {
    return mode.basePath.replace(/\/$/, "") + (u === "/" ? "/" : u);
  }
  return u;
}

/** Marks an element with its field path, for element styles and inline editing. */
const F = (path: string) => ` data-f="${path}"`;

function button(label: unknown, href: unknown, mode: RenderMode, variant: "primary" | "secondary" | "ghost" = "primary", path?: string) {
  const l = str(label).trim();
  if (!l) return "";
  const h = linkHref(href, mode) || "#";
  const arrow = variant === "ghost" ? ` <span aria-hidden="true">→</span>` : "";
  return `<a class="btn btn-${variant}" href="${esc(h)}"${path ? F(path) : ""}>${esc(l)}${arrow}</a>`;
}

function paragraphs(text: unknown, path?: string): string {
  const parts = str(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // A single paragraph can be edited inline; several are edited in the panel.
  return parts.map((p) => `<p${path ? F(path) : ""}${path && parts.length > 1 ? ` data-multi="1"` : ""}>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

function header(p: Record<string, unknown>, extra = "") {
  const h = has(p.heading);
  const s = has(p.subheading);
  if (!h && !s) return "";
  return `<header class="sec-head ${extra}">${has(p.eyebrow) ? `<p class="eyebrow"${F("eyebrow")}>${esc(p.eyebrow)}</p>` : ""}${h ? `<h2${F("heading")}>${esc(p.heading)}</h2>` : ""}${s ? `<p class="lead"${F("subheading")}>${esc(p.subheading)}</p>` : ""}</header>`;
}

function img(src: unknown, alt: unknown, cls = "", eager = false) {
  const u = safeImageUrl(src);
  return u ? `<img class="${cls}" src="${esc(u)}" alt="${esc(alt)}" loading="${eager ? "eager" : "lazy"}" decoding="async">` : "";
}

function formOpen(formId: string, mode: RenderMode, cls = "form") {
  if (mode.kind === "publish") return `<form class="${cls}" method="post" action="${esc(mode.formAction(formId))}">${mode.ab ? `<input type="hidden" name="_ab" value="${mode.ab}">` : ""}`;
  // Previews run in sandboxed frames without allow-forms, so submission is already blocked.
  return `<form class="${cls}" data-disabled-form>`;
}

function formNotice(mode: RenderMode) {
  return mode.kind === "publish" ? "" : `<p class="form-note">Forms are inactive in preview. They store submissions once the site is deployed.</p>`;
}

const HP = `<input type="text" name="_hp" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">`;
const CHECK = iconSvg("check", 18);

// Commerce sections in published HTML are markers, filled per request with
// live catalog data (prices and stock must never be stale).
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
const MARKER = /<!--cc:(productGrid|collectionList):([a-z-]+):([A-Za-z0-9_-]*)-->/g;

/** Replaces commerce markers and the cart count in published HTML. */
export { b64, unb64 };

export function fillCommerce(html: string, catalog: Catalog | null, base: string, cartCount: number) {
  return html
    .replace(MARKER, (_m, type: string, variant: string, data: string) => {
      let props: Record<string, unknown> = {};
      try {
        props = JSON.parse(unb64(data));
      } catch {
        /* malformed marker: render with defaults */
      }
      return type === "productGrid" ? productGridBody(props, variant, catalog, base, false) : collectionListBody(props, variant, catalog, base, false);
    })
    .replace(/<!--cc:cart-->/g, cartCount > 0 ? String(cartCount) : "");
}

let renderCatalog: Catalog | null = null;

function renderSection(s: Section, mode: RenderMode, doc: SiteDoc, page: Page): string {
  const inB = mode.kind === "publish" && mode.ab === "B" && !!s.ab?.running;
  const p = inB && s.ab?.props ? { ...s.props, ...s.ab.props } : s.props;
  // The B variant is checked against the section's variants too (it lands in class names).
  const v = variantOf(inB && s.ab?.variant ? { ...s, variant: s.ab.variant } : s);
  switch (s.type) {
    case "banner":
      return `<div class="wrap banner"><span${F("text")}>${esc(p.text)}</span>${has(p.linkLabel) ? `<a href="${esc(linkHref(p.linkHref, mode) || "#")}"${F("linkLabel")}>${esc(p.linkLabel)} →</a>` : ""}</div>`;

    case "navbar": {
      const links = arr(p.links)
        .map((l, n) => `<a href="${esc(linkHref(l.href, mode) || "#")}"${F(`links.${n}.label`)}>${esc(l.label)}</a>`)
        .join("");
      const id = `nav-${esc(s.id)}`;
      const logo = safeImageUrl(p.logo || doc.brand?.logo);
      const pageLang = page.lang ?? doc.lang;
      const group = page.translationOf ?? page.id;
      const langs = [...new Set(doc.pages.map((x) => x.lang ?? doc.lang))];
      const switcher =
        langs.length > 1
          ? `<span class="lang-switch">${langs
              .map((l) => {
                const target = doc.pages.find((x) => (x.lang ?? doc.lang) === l && (x.id === group || x.translationOf === group)) ?? doc.pages.find((x) => (x.lang ?? doc.lang) === l);
                return l === pageLang ? `<strong aria-current="true">${esc(l.toUpperCase())}</strong>` : `<a href="${esc(linkHref(target?.path ?? "/", mode))}" hreflang="${esc(l)}">${esc(l.toUpperCase())}</a>`;
              })
              .join("")}</span>`
          : "";
      return `<nav class="nav nav-${v} wrap"><a class="brand" href="${esc(linkHref("/", mode))}">${logo ? `<img class="brand-logo" src="${esc(logo)}" alt="">` : ""}<span${F("brand")}>${esc(p.brand)}</span></a>
<input type="checkbox" id="${id}" class="nav-toggle" aria-label="Toggle menu"><label for="${id}" class="nav-burger" aria-hidden="true"><span></span><span></span></label>
<div class="nav-links">${links}${switcher}${p.showCart ? `<a class="cart-link" href="${esc(linkHref("/cart", mode) || "#")}">${iconSvg("bag", 18)}<span>Cart</span><span class="cart-count">${mode.kind === "publish" ? "<!--cc:cart-->" : ""}</span></a>` : ""}${button(p.ctaLabel, p.ctaHref, mode, "primary", "ctaLabel")}</div></nav>`;
    }

    case "hero": {
      const image = safeImageUrl(p.image);
      const eyebrow = has(p.eyebrow) ? `<p class="eyebrow${v === "centered" ? " eyebrow-pill" : ""}"${F("eyebrow")}>${esc(p.eyebrow)}</p>` : "";
      const actions = button(p.primaryLabel, p.primaryHref, mode, "primary", "primaryLabel") + button(p.secondaryLabel, p.secondaryHref, mode, v === "editorial" || v === "minimal" ? "ghost" : "secondary", "secondaryLabel");
      const acts = actions ? `<div class="actions">${actions}</div>` : "";
      const sub = has(p.subheading) ? `<p class="lead"${F("subheading")}>${esc(p.subheading)}</p>` : "";
      const h1 = `<h1${F("heading")}>${esc(p.heading)}</h1>`;
      if (v === "overlay") {
        return `<div class="hero-overlay">${image ? img(image, p.imageAlt, "hero-bg", true) : `<div class="hero-bg hero-bg-fallback"></div>`}<div class="hero-scrim"></div>
<div class="wrap hero-overlay-inner"><div class="hero-copy reveal-1">${eyebrow}${h1}${sub}${acts}</div></div></div>`;
      }
      if (v === "split") {
        return `<div class="wrap hero hero-split"><div class="hero-copy reveal-1">${eyebrow}${h1}${sub}${acts}</div>${image ? `<div class="hero-media reveal-2">${img(image, p.imageAlt, "", true)}</div>` : `<div class="hero-media hero-art reveal-2" aria-hidden="true"></div>`}</div>`;
      }
      if (v === "editorial") {
        return `<div class="wrap hero hero-editorial">${eyebrow}<h1 class="display reveal-1"${F("heading")}>${esc(p.heading)}</h1><div class="hero-meta reveal-2">${sub}${acts}</div>${image ? `<div class="hero-wide reveal-3">${img(image, p.imageAlt, "", true)}</div>` : ""}</div>`;
      }
      if (v === "minimal") {
        return `<div class="wrap narrow hero hero-minimal reveal-1">${eyebrow}${h1}${sub}${acts}</div>`;
      }
      return `<div class="wrap hero hero-centered"><div class="hero-copy reveal-1">${eyebrow}${h1}${sub}${acts}</div>${image ? `<div class="hero-frame reveal-2">${img(image, p.imageAlt, "", true)}</div>` : ""}</div>`;
    }

    case "features": {
      const items = arr(p.items);
      if (v === "numbered") {
        return `<div class="wrap">${header(p)}<div class="grid numbered">${items.map((i, n) => `<article class="num-item reveal"><span class="num">${pad(n + 1)}</span><h3${F(`items.${n}.title`)}>${esc(i.title)}</h3>${paragraphs(i.body, `items.${n}.body`)}</article>`).join("")}</div></div>`;
      }
      if (v === "icons") {
        return `<div class="wrap">${header(p)}<div class="grid icon-list">${items.map((i, n) => `<article class="icon-item reveal"><span class="icon-plain">${iconSvg(str(i.icon) || "sparkles", 26)}</span><h3${F(`items.${n}.title`)}>${esc(i.title)}</h3>${paragraphs(i.body, `items.${n}.body`)}</article>`).join("")}</div></div>`;
      }
      if (v === "bento") {
        return `<div class="wrap">${header(p)}<div class="bento">${items.map((i, n) => `<article class="card bento-item${n === 0 ? " bento-lead" : ""} reveal"><span class="icon-chip">${iconSvg(str(i.icon) || "sparkles", 22)}</span><h3${F(`items.${n}.title`)}>${esc(i.title)}</h3>${paragraphs(i.body, `items.${n}.body`)}</article>`).join("")}</div></div>`;
      }
      return `<div class="wrap">${header(p)}<div class="grid">${items.map((i, n) => `<article class="card reveal"><span class="icon-chip">${iconSvg(str(i.icon) || "sparkles", 22)}</span><h3${F(`items.${n}.title`)}>${esc(i.title)}</h3>${paragraphs(i.body, `items.${n}.body`)}</article>`).join("")}</div></div>`;
    }

    case "text":
      if (v === "columns") return `<div class="wrap text-columns reveal">${has(p.heading) ? `<h2${F("heading")}>${esc(p.heading)}</h2>` : "<span></span>"}<div class="prose">${paragraphs(p.body, "body")}</div></div>`;
      if (v === "lead") return `<div class="wrap narrow prose prose-lead reveal">${has(p.heading) ? `<p class="eyebrow"${F("heading")}>${esc(p.heading)}</p>` : ""}${paragraphs(p.body, "body")}</div>`;
      return `<div class="wrap narrow prose reveal">${has(p.heading) ? `<h2${F("heading")}>${esc(p.heading)}</h2>` : ""}${paragraphs(p.body, "body")}</div>`;

    case "split": {
      const bullets = arr<string>(p.bullets).filter((b) => has(b));
      const media = safeImageUrl(p.image) ? img(p.image, p.imageAlt) : `<div class="art-block" aria-hidden="true"></div>`;
      const cta = button(p.buttonLabel, p.buttonHref, mode, "primary", "buttonLabel");
      return `<div class="wrap split split-${v}"><div class="split-media reveal">${media}</div><div class="split-copy reveal">${has(p.eyebrow) ? `<p class="eyebrow"${F("eyebrow")}>${esc(p.eyebrow)}</p>` : ""}<h2${F("heading")}>${esc(p.heading)}</h2>${paragraphs(p.body, "body")}${
        bullets.length ? `<ul class="checks">${bullets.map((b) => `<li>${CHECK}<span>${esc(b)}</span></li>`).join("")}</ul>` : ""
      }${cta ? `<div class="actions">${cta}</div>` : ""}</div></div>`;
    }

    case "freeform": {
      const items = readingOrder(freeformItems(p));
      const el = (i: FreeformItem) => {
        const cls = `ff-el ff-i${i.index} ff-${i.kind} ff-tone-${i.tone} ff-${i.size} ff-al-${i.align}`;
        switch (i.kind) {
          case "heading":
            return has(i.text) ? `<h2 class="${cls}">${esc(i.text)}</h2>` : "";
          case "text":
            return has(i.text) ? `<div class="${cls}">${paragraphs(i.text)}</div>` : "";
          case "image":
            return `<div class="${cls}">${img(i.image, i.alt) || `<div class="art-block" aria-hidden="true"></div>`}</div>`;
          case "button":
            return has(i.text) ? `<div class="${cls}">${button(i.text, i.href, mode, i.tone === "plain" ? "ghost" : i.tone === "surface" ? "secondary" : "primary")}</div>` : "";
          default:
            return `<div class="${cls}" aria-hidden="true"></div>`;
        }
      };
      return `<div class="wrap"><div class="ff ff-m-${p.mobile === "custom" ? "custom" : "stack"}">${items.map(el).join("")}</div></div>`;
    }

    case "stats":
      return `<div class="wrap">${header(p)}<div class="stats stats-${v}">${arr(p.items)
        .map((i, n) => `<div class="stat reveal"><span class="stat-value"${F(`items.${n}.value`)}>${esc(i.value)}</span><span class="stat-label"${F(`items.${n}.label`)}>${esc(i.label)}</span></div>`)
        .join("")}</div></div>`;

    case "steps": {
      const items = arr(p.items);
      if (v === "timeline") return `<div class="wrap narrow">${header(p)}<ol class="timeline">${items.map((i, n) => `<li class="reveal"><span class="tl-dot">${n + 1}</span><div><h3${F(`items.${n}.title`)}>${esc(i.title)}</h3>${paragraphs(i.body, `items.${n}.body`)}</div></li>`).join("")}</ol></div>`;
      return `<div class="wrap">${header(p)}<ol class="grid steps">${items.map((i, n) => `<li class="step reveal"><span class="num">${pad(n + 1)}</span><h3${F(`items.${n}.title`)}>${esc(i.title)}</h3>${paragraphs(i.body, `items.${n}.body`)}</li>`).join("")}</ol></div>`;
    }

    case "team": {
      const members = arr(p.members);
      const avatar = (m: Record<string, unknown>) =>
        safeImageUrl(m.photo)
          ? img(m.photo, m.name, "avatar")
          : `<span class="avatar avatar-initials" aria-hidden="true">${esc(
              str(m.name)
                .split(/\s+/)
                .map((w) => w[0] ?? "")
                .join("")
                .slice(0, 2)
                .toUpperCase(),
            )}</span>`;
      if (v === "list") return `<div class="wrap narrow">${header(p)}<div class="team-list">${members.map((m, n) => `<article class="team-row reveal">${avatar(m)}<div><h3${F(`members.${n}.name`)}>${esc(m.name)}</h3><p class="muted"${F(`members.${n}.role`)}>${esc(m.role)}</p>${paragraphs(m.bio, `members.${n}.bio`)}</div></article>`).join("")}</div></div>`;
      return `<div class="wrap">${header(p)}<div class="grid team-grid">${members.map((m, n) => `<article class="team-card reveal">${avatar(m)}<h3${F(`members.${n}.name`)}>${esc(m.name)}</h3><p class="muted"${F(`members.${n}.role`)}>${esc(m.role)}</p></article>`).join("")}</div></div>`;
    }

    case "logos":
      return `<div class="wrap logos">${has(p.heading) ? `<p class="logos-head"${F("heading")}>${esc(p.heading)}</p>` : ""}${(() => {
        const row = arr(p.items)
          .map((i, n) => `<span class="wordmark wm-${n % 4}"${F(`items.${n}.name`)}>${esc(i.name)}</span>`)
          .join("");
        return v === "marquee" ? `<div class="marquee" aria-label="Logos"><div class="marquee-track">${row}${row.replace(/ data-f="[^"]*"/g, ' aria-hidden="true"')}</div></div>` : `<div class="logo-row">${row}</div>`;
      })()}</div>`;

    case "menu": {
      const cur = str(p.currency);
      const price = (i: Record<string, unknown>) => (has(i.price) ? esc(cur) + esc(i.price) : "");
      if (v === "cards") {
        return `<div class="wrap">${header(p)}${arr(p.categories)
          .map(
            (c) =>
              `<div class="menu-block"><h3 class="menu-cat-title">${esc(c.name)}</h3><div class="grid menu-cards">${arr(c.items)
                .map((i) => `<article class="card menu-card reveal"><div class="menu-row"><h4>${esc(i.name)}</h4><span class="menu-price">${price(i)}</span></div>${has(i.description) ? `<p class="muted">${esc(i.description)}</p>` : ""}</article>`)
                .join("")}</div></div>`,
          )
          .join("")}</div>`;
      }
      const cats = arr(p.categories)
        .map(
          (c) =>
            `<div class="menu-cat reveal"><h3>${esc(c.name)}</h3><ul class="menu-list">${arr(c.items)
              .map((i) => `<li><div class="menu-row"><span class="menu-name">${esc(i.name)}</span><span class="menu-dots" aria-hidden="true"></span><span class="menu-price">${price(i)}</span></div>${has(i.description) ? `<p class="muted">${esc(i.description)}</p>` : ""}</li>`)
              .join("")}</ul></div>`,
        )
        .join("");
      return `<div class="wrap">${header(p)}<div class="menu">${cats}</div></div>`;
    }

    case "gallery": {
      const imgs = arr(p.images).filter((i) => safeImageUrl(i.src));
      const inner = imgs.map((i) => `<figure class="reveal">${img(i.src, i.alt)}</figure>`).join("");
      const empty = mode.kind === "editor" ? `<p class="placeholder">Add images in the properties panel.</p>` : "";
      return `<div class="wrap">${header(p)}${imgs.length ? `<div class="gallery gallery-${v}">${inner}</div>` : empty}</div>`;
    }

    case "testimonials": {
      const items = arr(p.items);
      if (v === "spotlight" && items[0]) {
        const t = items[0];
        return `<div class="wrap narrow spotlight reveal"><span class="quote-mark" aria-hidden="true">“</span><blockquote${F("items.0.quote")}>${esc(t.quote)}</blockquote><p class="cite"><strong${F("items.0.author")}>${esc(t.author)}</strong>${has(t.role) ? ` · <span class="muted"${F("items.0.role")}>${esc(t.role)}</span>` : ""}</p></div>`;
      }
      const quotes = items
        .map((i, n) => `<figure class="card quote reveal"><span class="quote-mark sm" aria-hidden="true">“</span><blockquote${F(`items.${n}.quote`)}>${esc(i.quote)}</blockquote><figcaption><strong${F(`items.${n}.author`)}>${esc(i.author)}</strong>${has(i.role) ? `<span class="muted"${F(`items.${n}.role`)}>${esc(i.role)}</span>` : ""}</figcaption></figure>`)
        .join("");
      if (v === "carousel") return `<div class="wrap">${header(p)}<div class="carousel" tabindex="0" aria-label="Testimonials">${quotes}</div></div>`;
      return `<div class="wrap">${header(p)}<div class="grid">${quotes}</div></div>`;
    }

    case "pricing": {
      const plans = arr(p.plans);
      const feats = (pl: Record<string, unknown>) => `<ul class="checks">${arr<string>(pl.features).map((f) => `<li>${CHECK}<span>${esc(f)}</span></li>`).join("")}</ul>`;
      if (v === "minimal") {
        return `<div class="wrap narrow">${header(p)}<div class="price-rows">${plans
          .map((pl, n) => `<article class="price-row reveal"><div><h3${F(`plans.${n}.name`)}>${esc(pl.name)}</h3>${feats(pl)}</div><div class="price-side"><p class="price"><span${F(`plans.${n}.price`)}>${esc(pl.price)}</span><small${F(`plans.${n}.period`)}>${esc(pl.period)}</small></p>${button(pl.ctaLabel, pl.ctaHref, mode, pl.highlighted ? "primary" : "secondary", `plans.${n}.ctaLabel`)}</div></article>`)
          .join("")}</div></div>`;
      }
      return `<div class="wrap">${header(p)}<div class="grid pricing">${plans
        .map(
          (pl, n) =>
            `<article class="card plan${pl.highlighted ? " plan-hl" : ""} reveal">${pl.highlighted ? `<span class="plan-badge">Most popular</span>` : ""}<h3${F(`plans.${n}.name`)}>${esc(pl.name)}</h3><p class="price"><span${F(`plans.${n}.price`)}>${esc(pl.price)}</span><small${F(`plans.${n}.period`)}>${esc(pl.period)}</small></p>${feats(pl)}${button(pl.ctaLabel, pl.ctaHref, mode, pl.highlighted ? "primary" : "secondary", `plans.${n}.ctaLabel`)}</article>`,
        )
        .join("")}</div></div>`;
    }

    case "faq": {
      const items = arr(p.items)
        .map((i, n) => `<details class="faq-item"><summary${F(`items.${n}.question`)}>${esc(i.question)}</summary>${paragraphs(i.answer, `items.${n}.answer`)}</details>`)
        .join("");
      if (v === "split") return `<div class="wrap faq-split"><div>${header(p)}</div><div class="faq">${items}</div></div>`;
      return `<div class="wrap narrow">${header(p)}<div class="faq">${items}</div></div>`;
    }

    case "cta": {
      const cta = button(p.buttonLabel, p.buttonHref, mode, "primary", "buttonLabel");
      const inner = `<h2${F("heading")}>${esc(p.heading)}</h2>${has(p.body) ? `<p class="lead"${F("body")}>${esc(p.body)}</p>` : ""}${cta ? `<div class="actions">${cta}</div>` : ""}`;
      if (v === "card") return `<div class="wrap"><div class="cta-card reveal">${inner}</div></div>`;
      return `<div class="wrap narrow cta reveal">${inner}</div>`;
    }

    case "contact": {
      const wa = str(p.whatsapp).replace(/\D/g, "");
      const details = [
        has(p.email) && `<li>${iconSvg("chat", 18)}<div><span class="muted">Email</span><a href="mailto:${esc(str(p.email).trim())}">${esc(p.email)}</a></div></li>`,
        has(p.phone) && `<li>${iconSvg("phone", 18)}<div><span class="muted">Phone</span><a href="tel:${esc(str(p.phone).replace(/[^\d+]/g, ""))}">${esc(p.phone)}</a></div></li>`,
        wa && `<li>${iconSvg("chat", 18)}<div><span class="muted">WhatsApp</span><a href="https://wa.me/${esc(wa)}" rel="noopener" target="_blank">Message us on WhatsApp</a></div></li>`,
        has(p.address) && `<li>${iconSvg("map-pin", 18)}<div><span class="muted">Address</span><span>${esc(p.address).replace(/\n/g, "<br>")}</span></div></li>`,
        has(p.hours) && `<li>${iconSvg("clock", 18)}<div><span class="muted">Hours</span><span>${esc(p.hours).replace(/\n/g, "<br>")}</span></div></li>`,
      ]
        .filter(Boolean)
        .join("");
      const form = p.showForm
        ? `${formOpen("contact", mode, "form card form-card")}${HP}
<div class="row"><label>Name<input name="name" required maxlength="120" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label></div>
<label>Message<textarea name="message" required maxlength="4000" rows="4"></textarea></label>
<button class="btn btn-primary" type="submit">Send message</button>${formNotice(mode)}</form>`
        : "";
      const intro = `${header({ heading: p.heading })}${paragraphs(p.body, "body")}${details ? `<ul class="details">${details}</ul>` : ""}`;
      if (v === "centered") return `<div class="wrap narrow contact-centered reveal">${intro}${form}</div>`;
      return `<div class="wrap"><div class="contact"><div class="reveal">${intro}</div>${form ? `<div class="reveal">${form}</div>` : ""}</div></div>`;
    }

    case "booking": {
      const max = Math.min(Math.max(Number(p.maxPartySize) || 10, 1), 100);
      const form = `${formOpen("booking", mode, v === "card" ? "form card form-card" : "form")}${HP}
<div class="row"><label>Name<input name="name" required maxlength="120" autocomplete="name"></label><label>Phone or email<input name="contact" required maxlength="200"></label></div>
<div class="row"><label>Date<input name="date" type="date" required></label><label>Time<input name="time" type="time" required></label><label>Guests<input name="guests" type="number" min="1" max="${max}" value="2" required></label></div>
<label>Notes<textarea name="notes" maxlength="1000" rows="3"></textarea></label>
<button class="btn btn-primary" type="submit">${esc(str(p.buttonLabel) || "Request booking")}</button>${formNotice(mode)}</form>`;
      return `<div class="wrap narrow reveal">${header({ heading: p.heading })}${paragraphs(p.body, "body")}${form}</div>`;
    }

    case "newsletter": {
      const form = `${formOpen("newsletter", mode, "form newsletter-form")}${HP}<label class="sr-only" for="nl-${esc(s.id)}">Email</label><input id="nl-${esc(s.id)}" name="email" type="email" required maxlength="200" autocomplete="email" placeholder="you@example.com"><button class="btn btn-primary" type="submit">${esc(str(p.buttonLabel) || "Subscribe")}</button></form>${formNotice(mode)}`;
      const inner = `<h2${F("heading")}>${esc(p.heading)}</h2>${has(p.body) ? `<p class="lead"${F("body")}>${esc(p.body)}</p>` : ""}${form}`;
      return v === "card" ? `<div class="wrap"><div class="cta-card newsletter reveal">${inner}</div></div>` : `<div class="wrap narrow newsletter reveal">${inner}</div>`;
    }

    case "dataList": {
      if (mode.kind === "publish") return `<!--cc:dataList:${v}:${b64(JSON.stringify(p))}-->`;
      const sample = { name: String(p.table || "table"), fields: [{ key: "title", name: "Name", type: "text" }, { key: "detail", name: "Detail", type: "text" }] };
      const rows = [1, 2, 3].map((i) => ({ title: `Row ${i} from “${p.table || "your table"}”`, detail: "Live data on the published site" }));
      return dataListBody({ ...p, titleField: "title", fields: ["detail"], imageField: "", linkField: "" }, v, p.table ? sample : null, rows, mode.kind === "editor" ? "Choose a table (its API name) in the section settings." : undefined);
    }

    case "productGrid":
    case "collectionList": {
      if (mode.kind === "publish") return `<!--cc:${s.type}:${v}:${b64(JSON.stringify(s.props))}-->`;
      const body = s.type === "productGrid" ? productGridBody : collectionListBody;
      return body(p, v, renderCatalog, "", mode.kind === "editor");
    }

    case "posts": {
      const lang = page.lang ?? doc.lang;
      const posts = doc.pages
        .filter((x) => x.kind === "post" && (x.lang ?? doc.lang) === lang)
        .sort((a, b) => (b.meta?.date ?? "").localeCompare(a.meta?.date ?? ""))
        .slice(0, Math.min(Math.max(Number(p.limit) || 3, 1), 24));
      if (!posts.length) return `<div class="wrap">${header(p)}${mode.kind === "editor" ? `<p class="placeholder">No posts yet. Add one from Pages → New post.</p>` : ""}</div>`;
      const card = (x: Page) => {
        const image = safeImageUrl(x.meta?.image);
        const href = esc(linkHref(x.path, mode));
        return v === "list"
          ? `<article class="post-row reveal"><a href="${href}"><span class="muted post-date">${x.meta?.date ? esc(formatDate(x.meta.date, lang)) : ""}</span><h3>${esc(x.title)}</h3>${x.description ? `<p class="muted">${esc(x.description)}</p>` : ""}</a></article>`
          : `<article class="post-card reveal"><a href="${href}">${image ? `<div class="post-img">${img(image, "")}</div>` : `<div class="post-img art-block"></div>`}<span class="muted post-date">${x.meta?.date ? esc(formatDate(x.meta.date, lang)) : ""}</span><h3>${esc(x.title)}</h3>${x.description ? `<p class="muted">${esc(x.description)}</p>` : ""}</a></article>`;
      };
      return `<div class="wrap${v === "list" ? " narrow" : ""}">${header(p)}<div class="${v === "list" ? "post-list" : "grid posts"}">${posts.map(card).join("")}</div></div>`;
    }

    case "article": {
      const meta = page.kind === "post" ? `<p class="muted article-meta">${[page.meta?.date ? formatDate(page.meta.date, page.lang ?? doc.lang) : "", page.meta?.author ?? ""].filter(Boolean).map(esc).join(" · ")}</p>` : "";
      return `<div class="wrap narrow"><article class="article">${meta}${markdown(str(p.body), mode)}</article></div>`;
    }

    case "products": {
      const items = arr(p.items);
      const card = (i: Record<string, unknown>) =>
        `<article class="product reveal"><div class="product-img">${safeImageUrl(i.image) ? img(i.image, i.name) : `<div class="art-block"></div>`}${has(i.badge) ? `<span class="product-badge">${esc(i.badge)}</span>` : ""}</div><div class="product-body"><div class="product-row"><h3>${esc(i.name)}</h3><span class="product-price">${esc(i.price)}</span></div>${has(i.description) ? `<p class="muted">${esc(i.description)}</p>` : ""}${button(i.buttonLabel || "Buy now", i.buttonHref, mode, "secondary")}</div></article>`;
      return `<div class="wrap">${header(p)}<div class="${v === "showcase" ? "products-showcase" : "grid products"}">${items.map(card).join("")}</div></div>`;
    }

    case "map": {
      const q = str(p.address).trim();
      const zoom = Math.min(Math.max(Number(p.zoom) || 15, 1), 20);
      const frame = q
        ? `<iframe class="map-frame" title="Map of ${esc(q)}" src="https://www.google.com/maps?q=${encodeURIComponent(q)}&amp;z=${zoom}&amp;output=embed" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`
        : `<div class="map-frame placeholder">Add an address to show the map.</div>`;
      const link = q ? `<a class="btn btn-secondary" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(q)}" target="_blank" rel="noopener">Open in Maps</a>` : "";
      if (v === "split") return `<div class="wrap map-split"><div>${header({ heading: p.heading })}<p>${esc(q).replace(/\n/g, "<br>")}</p>${link}</div>${frame}</div>`;
      return `<div class="wrap">${header({ heading: p.heading })}${frame}${link ? `<div class="actions">${link}</div>` : ""}</div>`;
    }

    case "footer": {
      const links = arr(p.links)
        .map((l) => `<a href="${esc(linkHref(l.href, mode) || "#")}">${esc(l.label)}</a>`)
        .join("");
      if (v === "columns") {
        return `<div class="wrap footer-cols"><div><p class="brand">${esc(doc.name)}</p><p class="muted">${esc(doc.pages[0]?.description ?? "")}</p></div><nav class="footer-links col" aria-label="Footer">${links}</nav></div><div class="wrap footer-base"><p class="muted"${F("text")}>${esc(p.text)}</p></div>`;
      }
      return `<div class="wrap footer"><p class="muted"${F("text")}>${esc(p.text)}</p><nav class="footer-links" aria-label="Footer">${links}</nav></div>`;
    }
    default:
      if ((CONNECTED_TYPES as readonly string[]).includes(s.type)) return renderConnected(s.type, p, v, { publish: mode.kind === "publish", form: { open: (id, cls) => formOpen(id, mode, cls), notice: formNotice(mode), honeypot: HP } }) ?? "";
      return renderExtra(s.type, s.id, p, v, { editor: mode.kind === "editor", form: { open: (id, cls) => formOpen(id, mode, cls), notice: formNotice(mode), honeypot: HP, editor: mode.kind === "editor" } }) ?? "";
  }
}

const EXTRA_TYPES = new Set(["video", "embed", "tabs", "timeline", "comparison", "marquee", "socials", "spacer", "form"]);
const usesExtraCss = (page: Page) => page.sections.some((s) => EXTRA_TYPES.has(s.type) || (s.type === "logos" && s.variant === "marquee") || (s.type === "testimonials" && s.variant === "carousel"));

// ─── Styles ──────────────────────────────────────────────────────────────────

function themeCss(t: SiteTheme): string {
  const p = t.palette;
  const d = DENSITY[t.density];
  const sc = SCALE[t.typeScale ?? "balanced"];
  const btnRadius = t.buttonStyle === "pill" ? "999px" : t.buttonStyle === "sharp" ? "0px" : RADIUS[t.radius];
  const serifHead = /serif|garamond|cormorant|fraunces|playfair/i.test(fontStack(t.headingFont).split(",")[0]);
  return `:root{--bg:${p.background};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--accent:${p.accent};--accent-text:${p.accentText};
--line:color-mix(in srgb,var(--text) 12%,transparent);--radius:${RADIUS[t.radius]};--btn-radius:${btnRadius};--font:${fontStack(t.font)};--heading-font:${fontStack(t.headingFont)};
--h1:${sc.h1};--h2:${sc.h2};--hx:${sc.hx};--hw:${serifHead ? 460 : 640};--hls:${serifHead ? "-0.015em" : "-0.032em"};
--sy:${(96 * d).toFixed(0)}px;--sy-sm:${(56 * d).toFixed(0)}px;--sy-lg:${(140 * d).toFixed(0)}px}`;
}

function themeOverrides(t: SiteTheme): string {
  const outline =
    t.buttonStyle === "outline"
      ? ".btn-primary{background:transparent;color:var(--text);border-color:var(--text);box-shadow:none}.bg-accent .btn-primary,.bg-inverse .btn-primary,.hero-overlay .btn-primary,.cta-card .btn-primary,.plan-hl .btn-primary{background:transparent;color:inherit;border-color:currentColor}"
      : "";
  return outline + (t.surface === "glass" ? glassCss(isDark(t.palette.background)) : "");
}

/**
 * Frosted glass: soft colour light fixed behind the page, translucent cards
 * and bars that blur what is behind them, and a fine highlight on the top
 * edge. Browsers without backdrop-filter still get the translucent fills.
 */
function glassCss(dark: boolean): string {
  const edge = dark ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.65)";
  const rim = dark ? "rgba(255,255,255,.08)" : "color-mix(in srgb,var(--text) 8%,transparent)";
  const shade = dark ? "0 30px 60px -30px rgba(0,0,0,.7)" : "0 24px 48px -28px rgba(15,23,42,.22)";
  const blur = "-webkit-backdrop-filter:blur(24px) saturate(1.8);backdrop-filter:blur(24px) saturate(1.8)";
  return `body{background:radial-gradient(55% 45% at 8% 0%,color-mix(in srgb,var(--accent) ${dark ? 26 : 16}%,transparent),transparent 70%) fixed,radial-gradient(45% 40% at 96% 28%,color-mix(in srgb,var(--accent) ${dark ? 18 : 10}%,transparent),transparent 70%) fixed,radial-gradient(60% 50% at 50% 105%,color-mix(in srgb,var(--surface) 90%,transparent),transparent 70%) fixed,var(--bg)}
.bg-surface{background:color-mix(in srgb,var(--surface) 42%,transparent)}
.card,.stats-cards .stat{background:color-mix(in srgb,var(--surface) ${dark ? 45 : 55}%,transparent);${blur};border:1px solid ${rim};box-shadow:inset 0 1px 0 ${edge},${shade}}
.bg-surface .card,.bg-surface .stats-cards .stat{background:color-mix(in srgb,var(--bg) ${dark ? 40 : 55}%,transparent)}
.card:hover{box-shadow:inset 0 1px 0 ${edge},${shade.replace("-30px", "-24px").replace("-28px", "-22px")}}
.sec-navbar{background:color-mix(in srgb,var(--bg) 60%,transparent);${blur};border-bottom:1px solid ${rim}}
.nav-floating{background:color-mix(in srgb,var(--bg) 58%,transparent);${blur};box-shadow:inset 0 1px 0 ${edge},${shade}}
.btn-secondary{background:color-mix(in srgb,var(--surface) 50%,transparent);${blur};border-color:${rim}}
.hero-frame,.split-media img,.gallery img{box-shadow:${shade}}
.cta-card{${blur};box-shadow:inset 0 1px 0 ${edge},${shade}}
input,textarea,select{background:color-mix(in srgb,var(--bg) 55%,transparent)!important}
.hero-overlay .hero-copy{background:rgba(255,255,255,${dark ? ".06" : ".10"});${blur};border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 30px 60px -30px rgba(0,0,0,.45);border-radius:calc(var(--radius) + 10px);padding:clamp(22px,3.4vw,44px)}
.pc{padding:10px;border-radius:calc(var(--radius) + 8px);background:color-mix(in srgb,var(--surface) ${dark ? 40 : 50}%,transparent);${blur};border:1px solid ${rim};box-shadow:inset 0 1px 0 ${edge},${shade};transition:transform .5s cubic-bezier(.2,.8,.2,1),box-shadow .5s}
.pc:hover{transform:translateY(-4px)}.pc-body{padding:12px 6px 4px}.pgrid{gap:22px}
.ctile-label{background:rgba(0,0,0,.22);${blur};border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:10px 16px}.ctile::after{background:linear-gradient(180deg,transparent 60%,rgba(0,0,0,.35))}
.pdp-info,.cart-side,.co-side,.faq-item{background:color-mix(in srgb,var(--surface) ${dark ? 40 : 50}%,transparent);${blur};border:1px solid ${rim};box-shadow:inset 0 1px 0 ${edge},${shade};border-radius:calc(var(--radius) + 8px);padding:clamp(18px,2.4vw,28px)}
.faq-item{margin-bottom:12px;border-bottom:1px solid ${rim}}
.pc-badge{${blur}}.pc-badge-soft{background:color-mix(in srgb,var(--bg) 60%,transparent)}
.plan-hl{background:color-mix(in srgb,var(--accent) ${dark ? 20 : 12}%,color-mix(in srgb,var(--surface) 60%,transparent));color:var(--text);border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);box-shadow:inset 0 1px 0 ${edge},0 0 0 1px color-mix(in srgb,var(--accent) 25%,transparent),${shade}}.plan-hl small{color:var(--muted);opacity:1}.plan-hl .checks .ico{color:var(--accent)}.plan-hl .btn-primary{background:var(--accent);color:var(--accent-text)}
`;
}

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 var(--font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-x:hidden}
img{max-width:100%;display:block}a{color:inherit}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
h1,h2,h3,h4{font-family:var(--heading-font);font-weight:var(--hw);letter-spacing:var(--hls);line-height:1.08;margin:0 0 .5em;text-wrap:balance}
h1{font-size:var(--h1)}h2{font-size:var(--h2)}h3{font-size:1.22rem;line-height:1.3;letter-spacing:-.01em}h4{font-size:1.05rem;margin:0}
p{margin:0 0 1em;text-wrap:pretty}.lead{font-size:clamp(1.05rem,1.4vw,1.22rem);color:var(--muted);max-width:38em;line-height:1.6}.muted{color:var(--muted)}
.wrap{width:100%;max-width:1200px;margin:0 auto;padding:0 28px}.narrow{max-width:800px}
.sec{padding:var(--sy) 0;position:relative;isolation:isolate}.sec.py-sm{padding:var(--sy-sm) 0}.sec.py-lg{padding:var(--sy-lg) 0}
.bg-surface{background:var(--surface)}.bg-accent{background:var(--accent);color:var(--accent-text)}.bg-inverse{background:var(--text);color:var(--bg)}
.bg-accent .muted,.bg-accent .lead,.bg-inverse .muted,.bg-inverse .lead,.bg-accent .eyebrow,.bg-inverse .eyebrow{color:inherit;opacity:.78}
.bg-inverse{--line:color-mix(in srgb,var(--bg) 16%,transparent)}.bg-inverse .card{background:color-mix(in srgb,var(--bg) 7%,transparent);border-color:var(--line)}
.al-center{text-align:center}.al-center .lead,.al-center .sec-head{margin-left:auto;margin-right:auto}.al-center .actions{justify-content:center}
.sec-head{margin-bottom:48px;max-width:44em}.sec-head h2{margin-bottom:.35em}
.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:.74rem;font-weight:600;color:var(--muted);margin-bottom:1.1em;font-family:var(--font)}
.eyebrow-pill{display:inline-block;letter-spacing:.08em;padding:6px 14px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 70%,transparent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4em;min-height:48px;padding:0 26px;border-radius:var(--btn-radius);font:600 .97rem/1 var(--font);letter-spacing:.005em;text-decoration:none;border:1.5px solid transparent;cursor:pointer;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s,background .2s,opacity .2s}
.btn:hover{transform:translateY(-1px)}.btn:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.btn-primary{background:var(--accent);color:var(--accent-text);box-shadow:0 6px 18px -8px color-mix(in srgb,var(--accent) 70%,transparent)}
.btn-secondary{border-color:color-mix(in srgb,currentColor 35%,transparent);color:inherit;background:transparent}.btn-secondary:hover{border-color:currentColor}
.btn-ghost{padding:0 4px;min-height:40px;color:inherit;text-decoration:underline;text-underline-offset:5px;text-decoration-thickness:1px}
.bg-accent .btn-primary{background:var(--accent-text);color:var(--accent)}.bg-inverse .btn-primary{background:var(--bg);color:var(--text);box-shadow:none}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:32px}
.ico{flex-shrink:0}
.banner{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;font-size:.88rem;padding-top:10px;padding-bottom:10px}.banner a{font-weight:600;text-decoration:none}
.sec-banner{padding:0!important;background:var(--accent);color:var(--accent-text)}
.nav{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:76px;position:relative}
.brand{font-family:var(--heading-font);font-weight:var(--hw);font-size:1.3rem;text-decoration:none;letter-spacing:-.02em}
.nav-links{display:flex;align-items:center;gap:30px}.nav-links a:not(.btn){text-decoration:none;color:var(--muted);font-size:.95rem;transition:color .2s}.nav-links a:not(.btn):hover{color:var(--text)}
.nav-links .btn{min-height:42px;padding:0 20px}
.nav-toggle,.nav-burger{display:none}
.sec-navbar{padding:0!important;position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid var(--line)}
.nav-centered{flex-direction:column;justify-content:center;gap:6px;padding-top:18px;padding-bottom:14px}.nav-centered .brand{font-size:1.6rem}.nav-centered .nav-links{gap:34px}
.sec-navbar:has(.nav-floating){background:transparent;border:0;backdrop-filter:none;-webkit-backdrop-filter:none;padding-top:14px!important}
.nav-floating{max-width:1120px;min-height:64px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px);box-shadow:0 10px 30px -18px rgba(0,0,0,.35);padding:0 10px 0 26px}
.hero{position:relative}.hero h1{margin-bottom:.4em}
.hero-centered{text-align:center}.hero-centered .hero-copy{max-width:880px;margin:0 auto}.hero-centered .lead{margin:0 auto}.hero-centered .actions{justify-content:center}
.hero-frame{margin-top:64px;border-radius:calc(var(--radius) + 6px);overflow:hidden;box-shadow:0 40px 80px -40px rgba(0,0,0,.45),0 0 0 1px var(--line)}.hero-frame img{width:100%;aspect-ratio:16/8;object-fit:cover}
.hero-split{display:grid;grid-template-columns:1.05fr 1fr;gap:72px;align-items:center}
.hero-media img,.hero-art{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--radius)}
.hero-art,.art-block,.hero-bg-fallback{background:radial-gradient(120% 90% at 20% 10%,color-mix(in srgb,var(--accent) 55%,var(--bg)) 0,transparent 55%),radial-gradient(90% 80% at 90% 90%,color-mix(in srgb,var(--accent) 30%,var(--surface)) 0,transparent 60%),var(--surface)}
.art-block{aspect-ratio:4/3;border-radius:var(--radius)}
.ff{--ff-row:36px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:0 16px;position:relative}
.ff-el{min-width:0;margin:0;display:flex;flex-direction:column;justify-content:center;border-radius:var(--radius)}
.ff-heading{font-family:var(--heading-font);line-height:1.08}.ff-heading.ff-sm{font-size:1.25em}.ff-heading.ff-md{font-size:1.75em}.ff-heading.ff-lg{font-size:clamp(2em,4vw,2.75em)}.ff-heading.ff-xl{font-size:clamp(2.4em,6vw,4.25em)}
.ff-text.ff-sm{font-size:.9em}.ff-text.ff-lg{font-size:1.2em}.ff-text.ff-xl{font-size:1.45em}.ff-text p{margin:0 0 .6em}.ff-text p:last-child{margin:0}
.ff-al-center{text-align:center;align-items:center}.ff-al-right{text-align:right;align-items:flex-end}.ff-al-left{align-items:flex-start}
.ff-image img,.ff-image .art-block{width:100%;height:100%;object-fit:cover;border-radius:var(--radius);aspect-ratio:auto;min-height:120px}
.ff-tone-surface:not(.ff-button){background:var(--surface)}.ff-tone-accent:not(.ff-button){background:var(--accent);color:var(--accent-text)}.ff-tone-inverse:not(.ff-button){background:var(--text);color:var(--bg)}
.ff-heading.ff-tone-surface,.ff-heading.ff-tone-accent,.ff-heading.ff-tone-inverse,.ff-text.ff-tone-surface,.ff-text.ff-tone-accent,.ff-text.ff-tone-inverse{padding:16px 20px}
.sec-hero:has(.hero-overlay){padding:0!important}
.hero-overlay{position:relative;min-height:min(92vh,880px);display:flex;align-items:flex-end;color:#fff;overflow:hidden}
.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.02)}
.hero-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.38) 0%,rgba(0,0,0,.32) 45%,rgba(0,0,0,.78) 100%),linear-gradient(90deg,rgba(0,0,0,.35),transparent 70%)}
.hero-overlay h1,.hero-overlay .lead{text-shadow:0 2px 24px rgba(0,0,0,.35)}
.hero-overlay-inner{position:relative;padding-bottom:clamp(56px,9vh,110px);padding-top:140px}.hero-overlay .hero-copy{max-width:760px}
.hero-overlay .lead,.hero-overlay .eyebrow{color:rgba(255,255,255,.88)}.hero-overlay .btn-secondary{color:#fff}
.hero-editorial .display{font-size:var(--hx);line-height:.98;max-width:14ch;margin-bottom:.35em}
.hero-meta{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:24px 48px;border-top:1px solid var(--line);padding-top:28px}.hero-meta .lead{margin:0;max-width:30em}.hero-meta .actions{margin:0}
.hero-wide{margin-top:56px}.hero-wide img{width:100%;aspect-ratio:21/9;object-fit:cover;border-radius:var(--radius)}
.hero-minimal h1{font-size:calc(var(--h1) * .86)}
.grid{display:grid;grid-template-columns:repeat(var(--cols-d,3),minmax(0,1fr));gap:24px;list-style:none;padding:0;margin:0}
.card{background:var(--surface);border-radius:var(--radius);padding:32px;border:1px solid var(--line);transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s}
.bg-surface .card{background:var(--bg)}.card p:last-child{margin-bottom:0}
.card:hover{box-shadow:0 18px 40px -26px rgba(0,0,0,.35)}
.icon-chip{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:calc(var(--radius) * .7 + 4px);background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);margin-bottom:22px}
.bg-inverse .icon-chip,.bg-accent .icon-chip{color:inherit;background:color-mix(in srgb,currentColor 12%,transparent)}
.icon-plain{display:inline-flex;color:var(--accent);margin-bottom:16px}.bg-inverse .icon-plain{color:inherit}
.icon-item p,.num-item p{color:var(--muted)}.bg-inverse .icon-item p,.bg-inverse .num-item p{color:inherit;opacity:.78}
.numbered .num-item{border-top:1px solid var(--line);padding-top:26px}
.num{display:block;font-family:var(--heading-font);font-size:.95rem;color:var(--accent);letter-spacing:.06em;margin-bottom:18px;font-variant-numeric:tabular-nums}.bg-inverse .num,.bg-accent .num{color:inherit;opacity:.7}
.bento{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:minmax(190px,auto);gap:18px}
.bento-lead{grid-column:span 2;grid-row:span 2;display:flex;flex-direction:column;justify-content:flex-end;background:radial-gradient(90% 90% at 100% 0%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 60%),var(--surface)}
.bento-lead h3{font-size:clamp(1.5rem,2.4vw,2.1rem)}.bento-item:nth-child(4){background:var(--accent);color:var(--accent-text);border-color:transparent}.bento-item:nth-child(4) .icon-chip{color:inherit;background:color-mix(in srgb,currentColor 14%,transparent)}
.prose-lead p{font-family:var(--heading-font);font-size:clamp(1.45rem,2.6vw,2.15rem);line-height:1.35;letter-spacing:-.015em;font-weight:var(--hw)}
.text-columns{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);gap:64px}.text-columns .prose{font-size:1.08rem;color:var(--muted)}
.split{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}.split-image-right .split-media{order:2}
.split-media img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--radius)}
.checks{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:12px}.checks li{display:flex;gap:10px;align-items:flex-start}.checks .ico{color:var(--accent);margin-top:3px}.bg-inverse .checks .ico,.bg-accent .checks .ico{color:inherit}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:24px}
.stat{display:flex;flex-direction:column;gap:6px}.stat-value{font-family:var(--heading-font);font-size:clamp(2.6rem,5.5vw,4.4rem);line-height:1;letter-spacing:-.04em;font-weight:var(--hw)}
.stat-label{color:var(--muted);font-size:.95rem}.bg-inverse .stat-label,.bg-accent .stat-label{color:inherit;opacity:.75}.stats-row .stat{border-left:1px solid var(--line);padding-left:24px}.stats-cards .stat{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:28px}
.bg-surface .stats-cards .stat{background:var(--bg)}
.step{border-top:2px solid currentColor;padding-top:24px}.step p{color:var(--muted)}
.timeline{list-style:none;margin:0;padding:0;position:relative}.timeline::before{content:"";position:absolute;left:19px;top:8px;bottom:8px;width:1px;background:var(--line)}
.timeline li{display:flex;gap:24px;padding-bottom:36px;position:relative}.timeline p{color:var(--muted)}
.tl-dot{flex-shrink:0;width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--accent);color:var(--accent-text);font-weight:600;font-size:.95rem;position:relative}
.team-grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.team-card h3{margin:16px 0 2px}.team-card p{margin:0}
.avatar{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius)}
.avatar-initials{display:flex;align-items:center;justify-content:center;font-family:var(--heading-font);font-size:2.2rem;color:var(--accent);background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 16%,var(--surface)),var(--surface))}
.team-row{display:grid;grid-template-columns:96px 1fr;gap:24px;padding:26px 0;border-bottom:1px solid var(--line)}.team-row .avatar{border-radius:50%}.team-row .avatar-initials{font-size:1.4rem}
.logos{text-align:center}.logos-head{color:var(--muted);font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;margin-bottom:26px}
.logo-row{display:flex;flex-wrap:wrap;justify-content:center;gap:22px 56px;opacity:.72}.wordmark{font-size:1.45rem;letter-spacing:-.02em;font-weight:700;font-family:var(--font)}
.wm-1{font-family:var(--heading-font);font-style:italic;font-weight:500}.wm-2{text-transform:uppercase;letter-spacing:.2em;font-size:1.05rem}.wm-3{font-family:var(--heading-font);font-weight:var(--hw)}
.sec-logos{padding:56px 0!important}
.menu{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:56px 72px}.menu-list{list-style:none;padding:0;margin:0}.menu-list li{padding:14px 0}
.menu-cat h3,.menu-cat-title{font-size:.8rem;text-transform:uppercase;letter-spacing:.16em;font-family:var(--font);font-weight:600;color:var(--accent);margin-bottom:10px}
.menu-row{display:flex;align-items:baseline;gap:10px}.menu-name{font-weight:600;font-family:var(--heading-font);font-size:1.12rem}.menu-dots{flex:1;border-bottom:1px dotted color-mix(in srgb,var(--text) 35%,transparent);transform:translateY(-5px)}
.menu-price{font-variant-numeric:tabular-nums;font-weight:600}.menu-list p{margin:4px 0 0;font-size:.94rem}
.menu-block{margin-bottom:44px}.menu-cards{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}.menu-card{padding:24px}.menu-card .menu-row{justify-content:space-between}.menu-card p{margin:8px 0 0;font-size:.94rem}
.gallery{display:grid;gap:16px}.gallery figure{margin:0;overflow:hidden;border-radius:var(--radius)}.gallery img{width:100%;height:100%;object-fit:cover;transition:transform .6s cubic-bezier(.2,.8,.2,1)}.gallery figure:hover img{transform:scale(1.04)}
.gallery-grid{grid-template-columns:repeat(var(--cols-d,3),minmax(0,1fr))}.gallery-grid img{aspect-ratio:1}
.gallery-masonry{display:block;columns:3 260px;column-gap:16px}.gallery-masonry figure{margin-bottom:16px;break-inside:avoid}.gallery-masonry figure:nth-child(3n+1) img{aspect-ratio:3/4}.gallery-masonry figure:nth-child(3n+2) img{aspect-ratio:1}.gallery-masonry figure:nth-child(3n) img{aspect-ratio:4/3}
.gallery-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:12px;scrollbar-width:thin}.gallery-carousel figure{flex:0 0 min(78%,520px);scroll-snap-align:start}.gallery-carousel img{aspect-ratio:4/5}
.quote blockquote{margin:0 0 22px;font-size:1.06rem;line-height:1.6}.quote figcaption{display:flex;flex-direction:column;font-size:.93rem}
.quote-mark{font-family:var(--heading-font);font-size:5.5rem;line-height:.6;color:var(--accent);display:block;height:.45em}.quote-mark.sm{font-size:3.2rem}.bg-inverse .quote-mark,.bg-accent .quote-mark{color:inherit;opacity:.6}
.spotlight{text-align:center}.spotlight blockquote{margin:24px auto;font-family:var(--heading-font);font-size:clamp(1.6rem,3.2vw,2.6rem);line-height:1.3;letter-spacing:-.02em;font-weight:var(--hw);max-width:24em}
.plan{display:flex;flex-direction:column;gap:8px;position:relative}.plan .btn{margin-top:auto}.plan .checks{margin:14px 0 30px}
.plan-hl{background:var(--text);color:var(--bg);border-color:transparent;box-shadow:0 30px 60px -30px rgba(0,0,0,.5)}.plan-hl .checks .ico{color:inherit}.plan-hl small{color:inherit;opacity:.7}.plan-hl .btn-primary{background:var(--bg);color:var(--text)}
.plan-badge{position:absolute;top:22px;right:22px;font-size:.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border-radius:999px;background:var(--accent);color:var(--accent-text)}
.price span{font-family:var(--heading-font);font-size:2.7rem;font-weight:var(--hw);letter-spacing:-.03em}.price small{color:var(--muted);margin-left:6px}.bg-inverse .price small,.bg-accent .price small{color:inherit;opacity:.65}
.price-rows{display:grid}.price-row{display:flex;justify-content:space-between;gap:32px;padding:32px 0;border-bottom:1px solid var(--line)}.price-side{display:flex;flex-direction:column;align-items:flex-end;gap:14px}
.faq-item{border-bottom:1px solid var(--line);padding:22px 0}.faq-item summary{cursor:pointer;font-weight:600;list-style:none;display:flex;justify-content:space-between;gap:16px;font-size:1.06rem}
.faq-item summary::-webkit-details-marker{display:none}.faq-item summary::after{content:"+";color:var(--muted);font-size:1.4rem;line-height:1;transition:transform .25s}.faq-item[open] summary::after{transform:rotate(45deg)}.faq-item p{margin:12px 0 0;color:var(--muted)}
.faq-split{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:72px}.faq-split .faq{border-top:1px solid var(--line)}
.cta{text-align:center}.cta .lead{margin:0 auto}.cta .actions{justify-content:center}
.cta-card{position:relative;overflow:hidden;text-align:center;padding:clamp(48px,7vw,96px) 32px;border-radius:calc(var(--radius) + 8px);background:radial-gradient(80% 120% at 50% -20%,color-mix(in srgb,var(--accent-text) 22%,transparent),transparent 60%),var(--accent);color:var(--accent-text)}
.cta-card .lead{color:inherit;opacity:.82;margin:0 auto}.cta-card .actions{justify-content:center}.cta-card .btn-primary{background:var(--accent-text);color:var(--accent)}
.contact{display:grid;grid-template-columns:1fr 1.05fr;gap:72px;align-items:start}.contact-centered{text-align:center}.contact-centered .details{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));text-align:left}.contact-centered .form{text-align:left;margin-top:40px}
.details{list-style:none;padding:0;margin:28px 0 0;display:grid;gap:20px}.details li{display:flex;gap:14px}.details .ico{color:var(--accent);margin-top:4px}.details li>div{display:grid;gap:2px}
.form{display:grid;gap:16px}.form label{display:grid;gap:7px;font-size:.88rem;font-weight:600}
.form input,.form textarea{font:inherit;font-size:1rem;padding:13px 15px;border-radius:calc(var(--radius) * .6 + 2px);border:1px solid color-mix(in srgb,var(--text) 18%,transparent);background:var(--bg);color:var(--text);width:100%;transition:border-color .2s,box-shadow .2s}
.form input:focus,.form textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 16%,transparent)}
.form .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}.form .btn{justify-self:start}.form-card{padding:clamp(24px,4vw,40px)}
.form-note{font-size:.82rem;color:var(--muted);margin:0}.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.newsletter{text-align:center}.newsletter .lead{margin:0 auto 26px}.newsletter-form{display:flex;gap:10px;max-width:460px;margin:0 auto;flex-wrap:wrap}.newsletter-form input{flex:1;min-width:200px}
.cta-card.newsletter input{background:color-mix(in srgb,var(--accent-text) 12%,transparent);color:inherit;border-color:color-mix(in srgb,var(--accent-text) 35%,transparent)}.cta-card.newsletter input::placeholder{color:inherit;opacity:.7}
.footer{display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap}.footer p{margin:0}.footer-links{display:flex;gap:22px;flex-wrap:wrap}.footer-links a{text-decoration:none;color:var(--muted);font-size:.93rem}.footer-links a:hover{color:var(--text)}
.footer-cols{display:grid;grid-template-columns:1.4fr 1fr;gap:48px;padding-bottom:40px}.footer-cols .brand{display:block;margin-bottom:10px;font-size:1.6rem}.footer-cols p.muted{max-width:30em;font-size:.95rem}
.footer-links.col{flex-direction:column;align-items:flex-start;gap:12px}.footer-base{border-top:1px solid var(--line);padding-top:24px;font-size:.88rem}.footer-base p{margin:0}
.sec-footer{border-top:1px solid var(--line);padding:56px 0 40px!important}
.placeholder{border:1px dashed var(--line);border-radius:var(--radius);padding:40px;text-align:center;color:var(--muted)}
.notice{background:#e7f6ec;color:#11532b;padding:14px 24px;text-align:center;font-size:.95rem}
.decor-gradient::before,.decor-mesh::before,.decor-glow::before,.decor-grid::before,.decor-dots::before,.decor-grain::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none}
.decor-gradient::before{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 10%,transparent),transparent 70%)}
.decor-mesh::before{background:radial-gradient(40% 50% at 15% 20%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%),radial-gradient(35% 45% at 85% 15%,color-mix(in srgb,var(--accent) 14%,var(--surface)),transparent 70%),radial-gradient(50% 50% at 60% 90%,color-mix(in srgb,var(--surface) 90%,transparent),transparent 70%)}
.decor-glow::before{background:radial-gradient(55% 60% at 50% 0%,color-mix(in srgb,var(--accent) 32%,transparent),transparent 70%)}
.decor-grid::before{background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(70% 70% at 50% 30%,#000,transparent);mask-image:radial-gradient(70% 70% at 50% 30%,#000,transparent)}
.decor-dots::before{background-image:radial-gradient(color-mix(in srgb,currentColor 18%,transparent) 1.2px,transparent 1.3px);background-size:22px 22px;-webkit-mask-image:linear-gradient(180deg,#000,transparent 85%);mask-image:linear-gradient(180deg,#000,transparent 85%)}
.decor-grain::before{opacity:.18;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.brand{display:inline-flex;align-items:center;gap:10px}.brand-logo{height:30px;width:auto;max-width:140px;object-fit:contain}
.lang-switch{display:inline-flex;gap:10px;font-size:.82rem;letter-spacing:.06em}.lang-switch a{color:var(--muted);text-decoration:none}
.posts{grid-template-columns:repeat(var(--cols-d,3),minmax(0,1fr))}.post-card a,.post-row a{text-decoration:none;color:inherit;display:block}
.post-img{aspect-ratio:16/10;border-radius:var(--radius);overflow:hidden;margin-bottom:18px}.post-img img{width:100%;height:100%;object-fit:cover;transition:transform .6s cubic-bezier(.2,.8,.2,1)}.post-card:hover img{transform:scale(1.04)}
.post-date{display:block;font-size:.85rem;margin-bottom:8px}.post-card h3,.post-row h3{margin-bottom:8px}.post-row{padding:26px 0;border-bottom:1px solid var(--line)}.post-row:hover h3,.post-card:hover h3{text-decoration:underline;text-underline-offset:4px}
.article{font-size:1.1rem;line-height:1.75}.article h2{font-size:calc(var(--h2) * .8);margin-top:1.6em}.article h3{margin-top:1.4em}.article ul,.article ol{padding-left:1.3em;margin:0 0 1.2em}.article li{margin-bottom:.4em}
.article blockquote{margin:1.6em 0;padding-left:1.2em;border-left:3px solid var(--accent);font-family:var(--heading-font);font-size:1.3rem}.article code{font-size:.9em;background:var(--surface);padding:2px 6px;border-radius:4px}.article a{color:var(--accent)}.article-meta{margin-bottom:2em}
.products{grid-template-columns:repeat(var(--cols-d,3),minmax(0,1fr))}.product{display:flex;flex-direction:column}.product-img{position:relative;aspect-ratio:4/5;border-radius:var(--radius);overflow:hidden;background:var(--surface);margin-bottom:16px}
.product-img img,.product-img .art-block{width:100%;height:100%;object-fit:cover;aspect-ratio:auto;transition:transform .6s cubic-bezier(.2,.8,.2,1)}.product:hover .product-img img{transform:scale(1.04)}
.product-badge{position:absolute;top:12px;left:12px;background:var(--bg);color:var(--text);font-size:.75rem;font-weight:600;padding:5px 10px;border-radius:999px}
.product-row{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.product-row h3{margin:0;font-size:1.1rem}.product-price{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.product-body p{margin:6px 0 16px;font-size:.95rem}.product .btn{align-self:flex-start;min-height:42px}
.products-showcase{display:grid;gap:56px}.products-showcase .product{display:grid;grid-template-columns:1.1fr 1fr;gap:56px;align-items:center}.products-showcase .product:nth-child(even) .product-img{order:2}.products-showcase .product-row h3{font-size:clamp(1.6rem,3vw,2.4rem)}
.map-frame{width:100%;height:440px;border:0;border-radius:var(--radius);display:block;background:var(--surface)}.map-frame.placeholder{display:flex;align-items:center;justify-content:center}.map-split{display:grid;grid-template-columns:1fr 1.4fr;gap:56px;align-items:center}
@media (max-width:1023px){.grid{grid-template-columns:repeat(var(--cols-t,2),minmax(0,1fr))}.hero-split,.split{gap:48px}.contact,.faq-split,.text-columns{gap:40px}.bento{grid-template-columns:repeat(2,minmax(0,1fr))}.hide-tablet{display:none!important}}
@media (min-width:1024px){.hide-desktop{display:none!important}}
@media (max-width:767px){body{font-size:16px}.wrap{padding:0 20px}.ff-m-stack{display:flex;flex-direction:column;gap:16px}.ff-m-stack .ff-shape{display:none}.ff-m-custom{grid-template-columns:repeat(4,minmax(0,1fr));gap:0 12px}.grid,.gallery-grid{grid-template-columns:repeat(var(--cols-m,1),minmax(0,1fr))}
.hero-split,.contact,.menu,.split,.faq-split,.text-columns,.footer-cols,.bento,.map-split,.products-showcase .product{grid-template-columns:1fr}.products-showcase .product:nth-child(even) .product-img{order:0}.posts,.products{grid-template-columns:repeat(var(--cols-m,1),minmax(0,1fr))}.bento-lead{grid-column:auto;grid-row:auto}.split-image-right .split-media{order:0}.menu{gap:32px}
.hero-media img,.hero-art,.split-media img{aspect-ratio:4/3}.hero-frame{margin-top:40px}.hero-frame img,.hero-wide img{aspect-ratio:4/3}.hero-overlay{min-height:84vh}
.price-row{flex-direction:column}.price-side{align-items:flex-start}.stats-row .stat{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:16px}
.nav-burger{display:flex;flex-direction:column;gap:6px;cursor:pointer;padding:10px;margin-left:auto}.nav-burger span{width:22px;height:2px;background:currentColor;display:block}
.nav-centered{flex-direction:row;padding-top:0;padding-bottom:0}.nav-floating{border-radius:var(--radius);padding:0 10px 0 20px}
.nav-links{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;align-items:stretch;gap:0;padding:8px 20px 20px;background:var(--bg);border-bottom:1px solid var(--line);box-shadow:0 20px 30px -20px rgba(0,0,0,.3)}
.nav-links a:not(.btn){padding:13px 0;font-size:1.05rem}.nav-links .btn{margin-top:8px}.nav-toggle:checked~.nav-links{display:flex}.hide-mobile{display:none!important}.hide-tablet:not(.hide-mobile){display:block!important}}
@media (min-width:768px) and (max-width:1023px){.hide-tablet{display:none!important}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn,.card,.gallery img{transition:none}}
@media print{.reveal,.reveal-1,.reveal-2,.reveal-3,.hero-bg{animation:none!important;opacity:1!important;transform:none!important}.sec-navbar{position:static}}`;

// Motion is pure CSS: an entrance for the hero and scroll-linked reveals where
// the browser supports scroll-driven animations. Disabled for reduced motion.
const MOTION_CSS = {
  subtle: `@media (prefers-reduced-motion:no-preference){@keyframes cc-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.reveal-1{animation:cc-up .8s cubic-bezier(.2,.8,.2,1) both}.reveal-2{animation:cc-up .9s .12s cubic-bezier(.2,.8,.2,1) both}.reveal-3{animation:cc-up 1s .24s cubic-bezier(.2,.8,.2,1) both}
@supports (animation-timeline:view()){.reveal{animation:cc-up linear both;animation-timeline:view();animation-range:entry 0% entry 60%}}}`,
  expressive: `@media (prefers-reduced-motion:no-preference){@keyframes cc-up{from{opacity:0;transform:translateY(34px) scale(.98)}to{opacity:1;transform:none}}@keyframes cc-zoom{from{transform:scale(1.12)}to{transform:scale(1.02)}}
.reveal-1{animation:cc-up 1s cubic-bezier(.2,.8,.2,1) both}.reveal-2{animation:cc-up 1.1s .15s cubic-bezier(.2,.8,.2,1) both}.reveal-3{animation:cc-up 1.2s .3s cubic-bezier(.2,.8,.2,1) both}.hero-bg{animation:cc-zoom 2.4s cubic-bezier(.2,.8,.2,1) both}
@supports (animation-timeline:view()){.reveal{animation:cc-up linear both;animation-timeline:view();animation-range:entry 0% entry 75%}}}`,
  none: "",
};

const EDITOR_CSS = `[data-section-id]{position:relative;cursor:pointer}[data-section-id]:hover::after{content:"";position:absolute;inset:0;outline:1.5px solid #2f6fed;outline-offset:-1.5px;pointer-events:none;z-index:40}
[data-section-id].is-selected::after{content:"";position:absolute;inset:0;outline:2px solid #2f6fed;outline-offset:-2px;pointer-events:none;z-index:40}
.sec-navbar[data-section-id]{position:sticky}
.is-selected [data-f]{cursor:text;transition:outline-color .15s}.is-selected [data-f]:hover{outline:1px dashed #2f6fed;outline-offset:3px;border-radius:2px}
[data-f].is-el{outline:2px solid #2f6fed!important;outline-offset:3px;border-radius:2px}[data-f][contenteditable]{outline:2px solid #2f6fed!important;outline-offset:3px;background:color-mix(in srgb,#2f6fed 8%,transparent);cursor:text;-webkit-user-modify:read-write-plaintext-only}`;

// Runs inside a sandboxed iframe without same-origin access; it can only post
// messages to the parent, which verifies event.source.
const EDITOR_BRIDGE = `(function(){var cur=null,el=null,editing=null,pending=null;
function post(m){m.source='cc-canvas';parent.postMessage(m,'*')}
function layout(){var items=[];document.querySelectorAll('[data-section-id]').forEach(function(x){if(x.parentElement&&x.parentElement.closest('[data-section-id]'))return;var r=x.getBoundingClientRect();if(r.height>0)items.push({id:x.getAttribute('data-section-id'),top:r.top,height:r.height})});post({type:'layout',items:items,vh:window.innerHeight})}
function report(){layout();var e=cur&&document.querySelector('[data-section-id="'+CSS.escape(cur)+'"]');if(!e){post({type:'rect',id:null});return}var r=e.getBoundingClientRect();post({type:'rect',id:cur,top:r.top,height:r.height,vh:window.innerHeight})}
function mark(){document.querySelectorAll('.is-el').forEach(function(x){x.classList.remove('is-el')});if(!el||!cur)return;var s=document.querySelector('[data-section-id="'+CSS.escape(cur)+'"]');var t=s&&s.querySelector('[data-f="'+CSS.escape(el)+'"]');if(t)t.classList.add('is-el')}
function sel(id,scroll){if(id!==cur)el=null;cur=id;document.querySelectorAll('.is-selected').forEach(function(e){e.classList.remove('is-selected')});var e=id&&document.querySelector('[data-section-id="'+CSS.escape(id)+'"]');if(e){e.classList.add('is-selected');if(scroll)e.scrollIntoView({block:'nearest',behavior:'smooth'})}mark();report()}
function fonts(list){(list||[]).forEach(function(u){if(!/^https:\\/\\/cdn\\.jsdelivr\\.net\\//.test(u))return;if(!document.querySelector('link[href="'+u+'"]')){var l=document.createElement('link');l.rel='stylesheet';l.href=u;document.head.appendChild(l)}})}
function apply(d){fonts(d.fonts);document.querySelector('style').textContent=d.style;document.querySelector('main').innerHTML=d.main;if(d.el!==undefined)el=d.el;sel(d.id,false)}
function finish(save){var t=editing;if(!t)return;editing=null;var v=t.node.innerText.replace(/\\u00a0/g,' ');t.node.removeAttribute('contenteditable');if(save&&v!==t.orig)post({type:'text',id:t.id,path:t.path,value:t.multi?v:v.replace(/\\s*\\n\\s*/g,' ').trim()});else t.node.innerText=t.orig;if(pending){var p=pending;pending=null;apply(p)}}
document.addEventListener('click',function(e){if(editing&&editing.node.contains(e.target))return;var a=e.target.closest('a');if(a)e.preventDefault();var s=e.target.closest('[data-section-id]');var id=s?s.getAttribute('data-section-id'):null;var f=e.target.closest('[data-f]');if(s&&f&&id===cur&&s.contains(f)){el=f.getAttribute('data-f');mark();post({type:'element',id:id,path:el});return}post({type:'select',id:id})},true);
document.addEventListener('dblclick',function(e){var f=e.target.closest('[data-f]');var s=f&&f.closest('[data-section-id]');if(!f||!s||f.hasAttribute('data-multi')||f.querySelector('img,svg,input'))return;e.preventDefault();finish(true);var id=s.getAttribute('data-section-id');cur=id;el=f.getAttribute('data-f');post({type:'element',id:id,path:el});editing={node:f,id:id,path:el,orig:f.innerText,multi:/^(P|BLOCKQUOTE|DD)$/.test(f.tagName)};f.setAttribute('contenteditable','plaintext-only');if(f.contentEditable!=='plaintext-only')f.setAttribute('contenteditable','true');f.focus();var r=document.createRange();r.selectNodeContents(f);var g=getSelection();g.removeAllRanges();g.addRange(r)},true);
document.addEventListener('keydown',function(e){if(!editing)return;if(e.key==='Escape'){e.preventDefault();finish(false)}else if(e.key==='Enter'&&(!editing.multi||e.metaKey||e.ctrlKey)){e.preventDefault();finish(true)}},true);
document.addEventListener('focusout',function(e){if(editing&&e.target===editing.node)finish(true)},true);
document.addEventListener('paste',function(e){if(!editing)return;e.preventDefault();document.execCommand('insertText',false,(e.clipboardData||window.clipboardData).getData('text/plain'))},true);
document.addEventListener('submit',function(e){e.preventDefault()},true);
window.addEventListener('scroll',report,{passive:true});window.addEventListener('resize',report);
window.addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d||d.source!=='cc-editor')return;if(d.type==='patch'){if(editing){pending=d;return}apply(d)}else if(d.type==='select'){sel(d.id,true)}else if(d.type==='element'){el=d.path;mark()}else if(d.type==='scroll'){window.scrollBy(0,d.dy||0)}});
post({type:'ready'});
sel(__SELECTED__,true);})();`;

/**
 * Renders a storefront page (shop, product, cart…) inside the site's chrome:
 * the home page's banner, navigation and footer, with `main` in between.
 */
export function renderShell(doc: SiteDoc, mode: RenderMode, input: { title: string; description?: string; main: string; lang?: string; noindex?: boolean; notice?: string }) {
  const home = doc.pages.find((p) => p.path === "/" && !p.lang) ?? doc.pages[0];
  const chrome = home.sections.filter((s) => s.type === "navbar" || s.type === "banner" || s.type === "footer");
  const page: Page = { id: "store", path: "/__store", title: input.title, description: input.description ?? "", kind: "page", lang: input.lang, sections: chrome };
  return renderPage(doc, page, mode, {
    inject: input.main,
    store: true,
    notice: input.notice,
    head: input.noindex ? `<meta name="robots" content="noindex">` : "",
  });
}

/** Favicon, canonical, robots, verification and structured data for a page's <head>. */
export function seoHead(doc: SiteDoc, page: Page, title: string): string {
  const site = doc.seo;
  let h = "";
  const icon = site?.favicon && safeImageUrl(site.favicon);
  if (icon) h += `<link rel="icon" href="${esc(icon)}">`;
  if (page.seo?.canonical) h += `<link rel="canonical" href="${esc(page.seo.canonical)}">`;
  if (page.seo?.noindex) h += `<meta name="robots" content="noindex">`;
  if (site?.googleVerify) h += `<meta name="google-site-verification" content="${esc(site.googleVerify)}">`;
  if (site?.bingVerify) h += `<meta name="msvalidate.01" content="${esc(site.bingVerify)}">`;
  if (site?.org && (page.path === "/" || page.kind === "post")) {
    const logo = doc.brand?.logo && safeImageUrl(doc.brand.logo);
    const data: Record<string, unknown> =
      page.kind === "post"
        ? { "@context": "https://schema.org", "@type": "BlogPosting", headline: title, ...(page.meta?.date ? { datePublished: page.meta.date } : {}), ...(page.meta?.author ? { author: { "@type": "Person", name: page.meta.author } } : {}), publisher: { "@type": site.org.type, name: doc.name } }
        : { "@context": "https://schema.org", "@type": site.org.type, name: doc.name, ...(page.description ? { description: page.description } : {}), ...(logo && /^https:/.test(logo) ? { logo } : {}), ...(site.org.phone ? { telephone: site.org.phone } : {}), ...(site.org.email ? { email: site.org.email } : {}), ...(site.org.address ? { address: site.org.address } : {}), ...(site.org.sameAs.length ? { sameAs: site.org.sameAs } : {}) };
    // Data, not code: "<" is escaped so nothing in it can end the block early.
    h += `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
  }
  return h;
}

/** Splits rendered HTML into the parts the editor canvas patches in place. */
export function canvasParts(html: string): { style: string; main: string; fonts: string[] } {
  return {
    style: html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "",
    main: html.match(/<main>([\s\S]*)<\/main>/)?.[1] ?? "",
    fonts: [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")),
  };
}

export function siteFontUrls(doc: SiteDoc): string[] {
  return fontCss([doc.theme.headingFont, doc.theme.font]);
}

const TEXT_SCALE = { sm: 0.92, md: 1, lg: 1.12 };
const PAD = { sm: "var(--sy-sm)", md: "var(--sy)", lg: "var(--sy-lg)" };
export const sectionClass = (id: string) => `s-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

/** Per-section CSS for text size and tablet/mobile overrides. */
// Entrance keyframes for per-section motion (scroll-driven, no JavaScript).
const ENTRANCE: Record<string, string> = {
  fade: "from{opacity:0}to{opacity:1}",
  up: "from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:none}",
  zoom: "from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}",
  left: "from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}",
  right: "from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}",
  blur: "from{opacity:0;filter:blur(12px)}to{opacity:1;filter:none}",
};
const RANGE = { slow: 90, normal: 60, fast: 35 } as const;
const HOVER_TARGETS = (c: string) => [".card", ".plan", "figure", ".team-card", ".pc", ".ctile", ".svc-card", ".bento-item"].map((t) => `${c} ${t}`).join(",");

function motionCss(s: Section) {
  const m = s.style.motion;
  if (!m) return "";
  const cls = `.${sectionClass(s.id)}`;
  const reveals = `${cls} .reveal,${cls} .reveal-1,${cls} .reveal-2,${cls} .reveal-3`;
  let css = "";
  if (m.entrance === "none") css += `${reveals}{animation:none!important;opacity:1!important;transform:none!important;filter:none!important}`;
  else if (m.entrance !== "theme" || m.speed !== "normal" || !m.stagger) {
    const name = m.entrance === "theme" ? "cc-up" : `cc-${m.entrance}`;
    const end = RANGE[m.speed];
    css += `@supports (animation-timeline:view()){${reveals}{animation:${name} linear both;animation-timeline:view();animation-range:entry 0% entry ${end}%}`;
    if (m.stagger) for (let i = 2; i <= 6; i++) css += `${cls} .reveal:nth-child(${i}){animation-range:entry ${(i - 1) * 6}% entry ${Math.min(100, end + (i - 1) * 6)}%}`;
    css += "}";
    if (m.entrance !== "theme") css += `@keyframes cc-${m.entrance}{${ENTRANCE[m.entrance]}}`;
  }
  if (m.parallax) css += `@supports (animation-timeline:view()){${cls} .hero-bg img,${cls} .hero-media img,${cls} .split-media img,${cls} .hero-wide img{animation:cc-parallax linear both;animation-timeline:view();animation-range:cover 0% cover 100%;transform-origin:center}}@keyframes cc-parallax{from{transform:translateY(-6%) scale(1.12)}to{transform:translateY(6%) scale(1.12)}}`;
  const wrapped = css ? `@media (prefers-reduced-motion:no-preference){${css}}` : "";
  const hover =
    m.hover === "none"
      ? ""
      : `@media (hover:hover){${HOVER_TARGETS(cls)}{transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s ease}${HOVER_TARGETS(cls).split(",").map((t) => `${t}:hover`).join(",")}{${
          m.hover === "lift" ? "transform:translateY(-4px);box-shadow:0 14px 34px rgb(0 0 0/.12)" : m.hover === "glow" ? "box-shadow:0 0 0 1px var(--accent),0 12px 34px color-mix(in srgb,var(--accent) 28%,transparent)" : "transform:scale(1.03)"
        }}}@media (prefers-reduced-motion:reduce){${HOVER_TARGETS(cls)}{transition:box-shadow .2s ease}${HOVER_TARGETS(cls).split(",").map((t) => `${t}:hover`).join(",")}{transform:none}}`;
  return wrapped + hover;
}

/** Grid placement per element; tablets use the desktop layout. */
function freeformCss(cls: string, props: Record<string, unknown>) {
  const items = freeformItems(props);
  let css = `${cls} .ff{grid-template-rows:repeat(${freeformRows(props)},minmax(var(--ff-row),auto))}`;
  css += items.map((i) => `${cls} .ff-i${i.index}{grid-column:${i.desktop.x + 1}/span ${i.desktop.w};grid-row:${i.desktop.y + 1}/span ${i.desktop.h};z-index:${i.index + 1}}`).join("");
  if (props.mobile === "custom") {
    const m = items.map((i) => `${cls} .ff-i${i.index}{${i.mobile ? `grid-column:${i.mobile.x + 1}/span ${i.mobile.w};grid-row:${i.mobile.y + 1}/span ${i.mobile.h}` : "display:none"}}`).join("");
    css += `@media (max-width:767px){${cls} .ff{grid-template-rows:repeat(${mobileRows(items)},minmax(var(--ff-row),auto))}${m}}`;
  }
  return css;
}

function sectionCss(s: Section, editor = false): string {
  const cls = `.${sectionClass(s.id)}`;
  const rule = (o: { align?: string; paddingY?: string; textScale?: string }) =>
    [
      o.textScale ? `font-size:${TEXT_SCALE[o.textScale as keyof typeof TEXT_SCALE]}em` : "",
      o.paddingY ? `padding-top:${PAD[o.paddingY as keyof typeof PAD]};padding-bottom:${PAD[o.paddingY as keyof typeof PAD]}` : "",
      o.align ? `text-align:${o.align}` : "",
    ]
      .filter(Boolean)
      .join(";");
  let css = s.style.textScale && s.style.textScale !== "md" ? `${cls}{${rule({ textScale: s.style.textScale })}}` : "";
  const t = s.style.overrides?.tablet;
  const m = s.style.overrides?.mobile;
  if (t && rule(t)) css += `@media (max-width:1023px){${cls}{${rule(t)}}${t.align === "center" ? `${cls} .sec-head,${cls} .lead{margin-left:auto;margin-right:auto}${cls} .actions{justify-content:center}` : t.align === "left" ? `${cls} .actions{justify-content:flex-start}` : ""}}`;
  if (m && rule(m)) css += `@media (max-width:767px){${cls}{${rule(m)}}${m.align === "center" ? `${cls} .sec-head,${cls} .lead{margin-left:auto;margin-right:auto}${cls} .actions{justify-content:center}` : m.align === "left" ? `${cls} .actions{justify-content:flex-start}` : ""}}`;
  if (s.type === "freeform") css += freeformCss(cls, s.props);
  css += advancedCss(cls, s.style.adv, safeImageUrl) + elementsCss(cls, s.style.elements);
  // Motion is left out of the editor canvas so editing stays steady.
  return editor ? css : css + motionCss(s);
}

export type RenderOptions = {
  notice?: string;
  /** Live catalog for commerce sections in the builder and previews. */
  catalog?: Catalog | null;
  /** Extra main content inserted after the header sections (storefront pages). */
  inject?: string;
  /** Forces the commerce stylesheet (storefront pages). */
  store?: boolean;
  /** Extra <head> markup (e.g. robots meta). */
  head?: string;
};

export function renderPage(doc: SiteDoc, page: Page, mode: RenderMode, opts: RenderOptions = {}): string {
  renderCatalog = opts.catalog ?? null;
  const headerCount = page.sections.findIndex((s) => s.type !== "navbar" && s.type !== "banner");
  const sectionsHtml = page.sections
    .map((s) => {
      const st = s.style;
      const cls = [
        "sec",
        `sec-${s.type}`,
        sectionClass(s.id),
        st.paddingY !== "md" ? `py-${st.paddingY}` : "",
        st.background !== "default" ? `bg-${st.background}` : "",
        st.align === "center" ? "al-center" : "",
        st.decor && st.decor !== "none" ? `decor-${st.decor}` : "",
        ...st.hideOn.map((b) => `hide-${b}`),
      ]
        .filter(Boolean)
        .join(" ");
      const cols = st.columns ? ` style="--cols-d:${st.columns.desktop};--cols-t:${st.columns.tablet};--cols-m:${st.columns.mobile}"` : "";
      const tag = s.type === "navbar" || s.type === "banner" ? "header" : s.type === "footer" ? "footer" : "section";
      const anchor = st.adv?.anchor ?? ({ contact: "contact", booking: "booking", menu: "menu", pricing: "pricing", faq: "faq", gallery: "gallery", team: "team" } as Record<string, string>)[s.type];
      const idAttr = anchor ? ` id="${anchor}"` : "";
      const editorAttr = mode.kind === "editor" ? ` data-section-id="${esc(s.id)}"` : "";
      return `<${tag} class="${cls}"${cols}${idAttr}${editorAttr}>${advancedLayers(st.adv, safeImageUrl)}${renderSection(s, mode, doc, page)}</${tag}>`;
    });
  if (opts.inject !== undefined) sectionsHtml.splice(headerCount < 0 ? sectionsHtml.length : headerCount, 0, opts.inject);
  const body = sectionsHtml.join("\n");
  const usesStore = opts.store || page.sections.some((s) => s.type === "productGrid" || s.type === "collectionList" || (s.type === "navbar" && s.props.showCart));

  const title = page.path === "/" ? page.title : `${page.title} · ${doc.name}`;
  const editor = mode.kind === "editor";
  const motion = editor ? "" : MOTION_CSS[doc.theme.motion ?? "subtle"];
  const fonts = [...new Set([...siteFontUrls(doc), ...fontCss(extraFonts(page.sections))])];
  const perSection = page.sections.map((s) => sectionCss(s, editor)).join("");
  const group = page.translationOf ?? page.id;
  const alternates =
    mode.kind === "publish"
      ? doc.pages
          .filter((x) => x.id === group || x.translationOf === group)
          .filter((x) => x.id !== page.id)
          .map((x) => `<link rel="alternate" hreflang="${esc(x.lang ?? doc.lang)}" href="${esc(linkHref(x.path, mode))}">`)
          .join("")
      : "";
  const bridge = editor ? `<script>${EDITOR_BRIDGE.replace("__SELECTED__", JSON.stringify(mode.selectedId ?? null).replace(/</g, "\\u003c"))}</script>` : "";
  return `<!doctype html>
<html lang="${esc(page.lang ?? doc.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${page.description ? `<meta name="description" content="${esc(page.description)}">` : ""}
<meta property="og:title" content="${esc(title)}">${page.description ? `<meta property="og:description" content="${esc(page.description)}">` : ""}
<meta name="theme-color" content="${esc(doc.theme.palette.background)}">${alternates}${seoHead(doc, page, title)}${page.meta?.image && safeImageUrl(page.meta.image) ? `<meta property="og:image" content="${esc(safeImageUrl(page.meta.image))}">` : ""}
${fonts.length ? `<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>` : ""}${fonts.map((f) => `<link rel="stylesheet" href="${esc(f)}">`).join("")}
${opts.head ?? ""}<style>${themeCss(doc.theme)}${BASE_CSS}${usesStore ? STORE_CSS + BOOK_CSS : ""}${page.sections.some((s) => s.type === "dataList") ? DATA_LIST_CSS : ""}${usesExtraCss(page) ? EXTRA_CSS : ""}${page.sections.some((s) => (CONNECTED_TYPES as readonly string[]).includes(s.type)) ? CONNECTED_CSS : ""}${themeOverrides(doc.theme)}${siteUiCss(doc.theme.ui)}${perSection}${motion}${editor ? EDITOR_CSS : ""}</style></head>
<body>${opts.notice ? `<div class="notice" role="status">${esc(opts.notice)}</div>` : ""}
<main>${body}</main>${bridge}</body></html>`;
}
