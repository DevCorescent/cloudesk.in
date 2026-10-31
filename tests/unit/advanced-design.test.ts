import { describe, expect, it } from "vitest";
import { advancedCss, cssUrl, elementsCss, scopeCss, siteUiCss } from "@/lib/site/advanced";
import { safeImageUrl } from "@/lib/site/html";
import { createSection, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { composeSite, planFromBrief } from "@/lib/site/planner";
import { renderPage } from "@/lib/site/render";
import { customFormId, embedSrc, videoEmbed } from "@/lib/site/sections-extra";

const doc = (): SiteDoc => composeSite(planFromBrief("A design studio in Mumbai", { name: "Studio Nine" }));
const publish = { kind: "publish", basePath: "", formAction: (id: string) => `/f/${id}` } as const;

describe("custom CSS is scoped and sanitised", () => {
  it("scopes declarations and rules to the section", () => {
    expect(scopeCss("color: red; padding: 4px", ".s-a").css).toBe(".s-a{color: red; padding: 4px}");
    expect(scopeCss("h2, .card:hover { color: red } & { gap: 2px }", ".s-a").css).toBe(".s-a h2,.s-a .card:hover{color: red}.s-a{gap: 2px}");
  });
  it("removes escapes from the style element, @-rules, scripts and outside URLs", () => {
    const r = scopeCss("</style><script>alert(1)</script> h2{color:red} @import url(https://evil.example/x.css); .a{background:url(javascript:alert(1))} .b{background:url(http://x.test/a.png)} .c{background:url(https://ok.example/a.png)}", ".s");
    expect(r.css).not.toMatch(/<|>|@import|javascript|http:\/\//);
    expect(r.css).toContain('.s .c{background:url("https://ok.example/a.png")}');
    expect(r.problems.length).toBeGreaterThan(1);
  });
  it("quotes URLs so they can't break out of url()", () => {
    expect(cssUrl('https://x.test/a").b{color:red}')).toBe('url("https://x.test/a%22%29.b{color:red}")');
  });
});

describe("advanced section design", () => {
  it("produces background, colours, type, spacing, cards and dividers", () => {
    const css = advancedCss(
      ".s-x",
      {
        bg: { kind: "gradient", color: "#112233", color2: "#445566", angle: 90 },
        colors: { text: "#ffffff", heading: "#ff0000", accent: "#00ff00" },
        type: { headingSize: 96, headingWeight: 800, letterSpacing: -0.03, uppercase: true },
        space: { top: 140, bottom: 0, width: "wide", minHeight: "100vh", valign: "end", mobileTop: 40 },
        card: { style: "glass", radius: 24 },
        divider: { bottom: "wave", height: 80 },
      },
      safeImageUrl,
    );
    expect(css).toContain("background:linear-gradient(90deg,#112233,#445566)");
    expect(css).toContain("--accent:#00ff00");
    expect(css).toContain(".s-x h1,.s-x h2,.s-x h3{color:#ff0000}");
    expect(css).toContain("font-size:clamp(53px,6.67vw,96px)");
    expect(css).toContain("padding-top:140px;padding-bottom:0px");
    expect(css).toContain("justify-content:flex-end");
    expect(css).toContain("backdrop-filter:blur(18px)");
    expect(css).toMatch(/\.s-x>\.adv-div-bottom\{position:absolute;[^}]*mask:url\("data:image\/svg\+xml,/);
    expect(css).toContain("@media (max-width:767px){.s-x{padding-top:40px}}");
  });
  it("ignores unsafe background images", () => {
    expect(advancedCss(".s", { bg: { kind: "image", image: "javascript:alert(1)" } }, safeImageUrl)).toBe("");
  });
  it("styles single elements by field path", () => {
    const css = elementsCss(".s", { heading: { color: "#123456", size: 72, weight: 900, italic: true, mobileSize: 40 }, "items.1.title": { hidden: true } });
    expect(css).toContain('.s [data-f="heading"]{color:#123456!important;font-size:72px!important;font-weight:900!important;font-style:italic!important}');
    expect(css).toContain('.s [data-f="items.1.title"]{display:none!important}');
    expect(css).toContain('@media (max-width:767px){.s [data-f="heading"]{font-size:40px!important}}');
  });
  it("applies site-wide interface settings", () => {
    const css = siteUiCss({ header: "glass", container: 1320, buttonRadius: 0, buttonUppercase: true, headingWeight: 800 });
    expect(css).toContain(":root{--container:1320px}");
    expect(css).toContain(".sec-navbar{position:sticky;top:0;z-index:50}");
    expect(css).toContain(".btn{border-radius:0px;text-transform:uppercase");
  });
  it("validates advanced values in the document schema", () => {
    const d = doc();
    d.pages[0].sections[1].style.adv = { space: { top: 9999 } };
    expect(siteDocSchema.safeParse(d).success).toBe(false);
    d.pages[0].sections[1].style.adv = { colors: { text: "red;}" } } as never;
    expect(siteDocSchema.safeParse(d).success).toBe(false);
    d.pages[0].sections[1].style.adv = { anchor: "our-work", bg: { kind: "color", color: "#000000" } };
    d.pages[0].sections[1].style.elements = { heading: { size: 64 }, "bad path!": { size: 2 } } as never;
    expect(siteDocSchema.safeParse(d).success).toBe(false);
    d.pages[0].sections[1].style.elements = { heading: { size: 64 } };
    expect(siteDocSchema.safeParse(d).success).toBe(true);
  });
});

describe("rendering", () => {
  it("marks editable elements, applies anchors, layers and element styles", () => {
    const d = doc();
    const hero = d.pages[0].sections.find((s) => s.type === "hero")!;
    hero.style.adv = { anchor: "top", bg: { kind: "video", video: "https://cdn.example.com/loop.mp4", overlay: "#000000", overlayOpacity: 50 } };
    hero.style.elements = { heading: { color: "#ff3366" } };
    const html = renderPage(d, d.pages[0], publish);
    expect(html).toContain(`<h1 data-f="heading">`);
    expect(html).toContain(`id="top"`);
    expect(html).toContain(`<video class="adv-video" autoplay muted loop playsinline preload="metadata" aria-hidden="true"><source src="https://cdn.example.com/loop.mp4"></video><div class="adv-overlay"`);
    expect(html).toContain('[data-f="heading"]{color:#ff3366!important}');
  });

  it("renders the new sections without scripts", () => {
    const d = doc();
    const add = (type: string, props: Record<string, unknown> = {}, variant?: string) => {
      const s = createSection(type);
      Object.assign(s.props, props);
      if (variant) s.variant = variant;
      d.pages[0].sections.splice(1, 0, s);
      return s;
    };
    add("video", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    add("embed", { url: "https://calendly.com/studio/intro" });
    add("tabs");
    add("timeline", {}, "alternating");
    add("comparison");
    add("marquee");
    add("socials", { links: [{ network: "instagram", url: "https://instagram.com/studio" }, { network: "email", url: "hi@studio.example" }] });
    add("spacer", { height: 40, line: true });
    const form = add("form");
    const html = renderPage(d, d.pages[0], publish);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
    expect(html).toContain('src="https://calendly.com/studio/intro?hide_gdpr_banner=1"');
    expect(html).toMatch(/<input type="radio" class="tab-input" name="tabs-[^"]+" id="tabs-[^"]+-0" checked>/);
    expect(html).toContain('<span class="cmp-yes" aria-label="Yes">✓</span>');
    expect(html).toContain('class="mq mq-bold"');
    expect(html).toContain('href="mailto:hi@studio.example"');
    expect(html).toContain(`action="/f/${customFormId(form.id)}"`);
    expect(html).toContain('<select name="budget"><option value="">Choose…</option><option>Under ₹50k</option>');
    expect(html).toContain('<textarea name="details" rows="4" maxlength="4000" required>');
  });
});

describe("video and embed allowlist", () => {
  it("accepts known hosts and files", () => {
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ")).toEqual({ kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" });
    expect(videoEmbed("https://vimeo.com/76979871")).toEqual({ kind: "iframe", src: "https://player.vimeo.com/video/76979871?dnt=1" });
    expect(videoEmbed("https://cdn.example.com/a.mp4")).toEqual({ kind: "file", src: "https://cdn.example.com/a.mp4" });
    expect(embedSrc("https://open.spotify.com/playlist/37i9dQZF1DX")).toBe("https://open.spotify.com/embed/playlist/37i9dQZF1DX");
  });
  it("refuses everything else", () => {
    for (const u of ["http://youtu.be/dQw4w9WgXcQ", "javascript:alert(1)", "https://evil.example/embed", "https://youtube.com/watch?v=<x>", "data:text/html,hi"]) {
      expect(embedSrc(u)).toBeNull();
    }
  });
});
