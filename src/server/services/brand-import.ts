import { clusterColors, colorsFromCss, feelFromCss, fontsFromCss, matchFont, type BrandKit } from "@/lib/site/brand";
import { safeFetchText } from "../net/safe-fetch";

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];

function metaContent(html: string, key: string) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if ((attr(tag, "name") ?? attr(tag, "property"))?.toLowerCase() === key) return attr(tag, "content");
  }
  return undefined;
}

/**
 * Reads a public website's brand signals: name, description, theme colour,
 * colours and fonts used in its CSS, and an icon/logo. Only data is
 * extracted; nothing from the site is executed or stored verbatim.
 */
export async function importBrandFromUrl(raw: string): Promise<BrandKit> {
  const page = await safeFetchText(raw, { maxBytes: 1_500_000 });
  const html = page.text;
  const base = page.url;

  const cssParts: string[] = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) cssParts.push(m[1]);
  for (const m of html.matchAll(/style\s*=\s*"([^"]*)"/gi)) cssParts.push(m[1]);
  cssParts.push(html.match(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi)?.join("\n") ?? "");

  const sheetLinks = [...html.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)]
    .map((m) => attr(m[0], "href"))
    .filter((h): h is string => !!h)
    .slice(0, 3);
  for (const href of sheetLinks) {
    try {
      const css = await safeFetchText(new URL(href, base).toString(), { maxBytes: 600_000, accept: "text/css,*/*;q=0.1" });
      cssParts.push(css.text);
    } catch {
      // A stylesheet that cannot be fetched safely is simply skipped.
    }
  }
  const css = cssParts.join("\n");

  const weighted = colorsFromCss(css);
  const themeColor = metaContent(html, "theme-color");
  if (themeColor && /^#[0-9a-f]{6}$/i.test(themeColor)) weighted.push({ hex: themeColor.toLowerCase(), weight: 50 });
  const colors = clusterColors(weighted, 8).map((c) => c.hex);

  const fontNames = fontsFromCss(css).slice(0, 6);
  const matched = fontNames.map(matchFont).filter((f): f is NonNullable<typeof f> => !!f);

  const icon = [...html.matchAll(/<link\b[^>]*rel=["'][^"']*(apple-touch-icon|icon)[^"']*["'][^>]*>/gi)].map((m) => attr(m[0], "href")).find(Boolean);
  const og = metaContent(html, "og:image");
  const logoRaw = icon ?? og;
  let logo: string | undefined;
  if (logoRaw) {
    try {
      const u = new URL(logoRaw, base);
      if (u.protocol === "https:") logo = u.toString();
    } catch {
      /* ignore */
    }
  }
  const title = (metaContent(html, "og:site_name") ?? html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1] ?? "").trim();
  return {
    name: title.split(/\s[|–—-]\s/)[0]?.slice(0, 80) || undefined,
    description: (metaContent(html, "description") ?? metaContent(html, "og:description"))?.slice(0, 300),
    logo,
    colors,
    headingFont: matched[0],
    bodyFont: matched[1] ?? matched[0],
    fontNames,
    source: base.hostname,
    feel: feelFromCss(css, html),
  };
}
