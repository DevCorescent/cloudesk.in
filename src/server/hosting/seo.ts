import { esc } from "@/lib/site/html";
import { minorDigits } from "@/lib/store/money";
import { getStore } from "../commerce/catalog";
import { loadCatalog } from "../commerce/storefront";
import { appUrl } from "../services/mail";

// Machine-readable files for search engines and shopping channels. Served
// for production deployments only; previews tell crawlers to stay away.

export const SEO_PATHS = new Set(["/robots.txt", "/sitemap.xml", "/products.xml"]);

const text = (body: string, type: string) =>
  new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });

const POLICIES = ["shipping", "refund", "privacy", "terms"];

export async function seoFile(path: string, opts: { projectId: string; basePath: string; artifact: Record<string, string>; isProd: boolean; deployedAt: Date }) {
  const abs = (p: string) => appUrl(`${opts.basePath}${p === "/" ? "" : p}` || "/");
  if (path === "/robots.txt") {
    if (!opts.isProd) return text("User-agent: *\nDisallow: /\n", "text/plain");
    // robots.txt rules are paths; on a custom domain (absolute base) the site is at the root.
    const prefix = /^https?:/.test(opts.basePath) ? "" : opts.basePath;
    const priv = ["/cart", "/checkout", "/order/", "/track", "/account"].map((p) => `Disallow: ${prefix}${p}`).join("\n");
    return text(`User-agent: *\nAllow: ${prefix}/\n${priv}\n\nSitemap: ${abs("/sitemap.xml")}\n`, "text/plain");
  }
  if (!opts.isProd) return null;

  const catalog = opts.artifact["/__doc"] ? await loadCatalog(opts.projectId) : null;
  if (path === "/sitemap.xml") {
    const lastmod = opts.deployedAt.toISOString().slice(0, 10);
    // Members-only pages are left out: search engines cannot see them anyway.
    const doc = opts.artifact["/__doc"] ? (JSON.parse(opts.artifact["/__doc"]) as { pages?: { path: string; membersOnly?: boolean; seo?: { noindex?: boolean } }[] }) : null;
    // Pages asked not to be listed are left out too.
    const hidden = new Set((doc?.pages ?? []).filter((p) => p.membersOnly || p.seo?.noindex).map((p) => p.path));
    const pages = Object.keys(opts.artifact).filter((p) => p.startsWith("/") && !p.startsWith("/__") && !p.includes("#") && !hidden.has(p));
    const urls = pages.map((p) => ({ loc: abs(p), lastmod }));
    if (catalog && catalog.products.length) {
      urls.push({ loc: abs("/shop"), lastmod });
      for (const c of catalog.collections.filter((c) => c.productCount > 0)) urls.push({ loc: abs(`/shop/${c.slug}`), lastmod });
      for (const p of catalog.products.filter((p) => !p.isSample)) urls.push({ loc: abs(`/product/${p.slug}`), lastmod });
      for (const k of POLICIES) urls.push({ loc: abs(`/policies/${k}`), lastmod });
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
    return text(body, "application/xml");
  }

  // Google Merchant Center / Meta catalog feed (RSS 2.0 with g: fields).
  if (path === "/products.xml") {
    if (!catalog) return null;
    const store = await getStore(opts.projectId);
    const d = minorDigits(catalog.currency);
    const price = (n: number) => `${(n / 10 ** d).toFixed(d)} ${catalog.currency}`;
    const plain = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 5000);
    const items: string[] = [];
    for (const p of catalog.products.filter((p) => !p.isSample)) {
      for (const v of p.variants) {
        const sale = v.compareAt && v.compareAt > v.price;
        items.push(
          [
            `<g:id>${esc(v.id)}</g:id>`,
            p.variants.length > 1 ? `<g:item_group_id>${esc(p.id)}</g:item_group_id>` : "",
            `<g:title>${esc(plain(p.variants.length > 1 && v.title !== "Default" ? `${p.title} - ${v.title}` : p.title).slice(0, 150))}</g:title>`,
            `<g:description>${esc(plain(p.description) || p.title)}</g:description>`,
            `<g:link>${esc(abs(`/product/${p.slug}`))}</g:link>`,
            p.images[0] ? `<g:image_link>${esc(p.images[0].startsWith("/") ? appUrl(p.images[0]) : p.images[0])}</g:image_link>` : "",
            ...p.images.slice(1, 10).map((i) => `<g:additional_image_link>${esc(i.startsWith("/") ? appUrl(i) : i)}</g:additional_image_link>`),
            `<g:availability>${v.available > 0 ? "in_stock" : "out_of_stock"}</g:availability>`,
            `<g:price>${price(sale ? v.compareAt! : v.price)}</g:price>`,
            sale ? `<g:sale_price>${price(v.price)}</g:sale_price>` : "",
            `<g:brand>${esc(p.vendor || store?.name || "")}</g:brand>`,
            `<g:condition>new</g:condition>`,
            `<g:identifier_exists>no</g:identifier_exists>`,
            ...Object.entries(v.options).map(([k, val]) => (/size/i.test(k) ? `<g:size>${esc(val)}</g:size>` : /colou?r/i.test(k) ? `<g:color>${esc(val)}</g:color>` : /material/i.test(k) ? `<g:material>${esc(val)}</g:material>` : "")),
          ]
            .filter(Boolean)
            .join(""),
        );
      }
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${esc(store?.name ?? "Products")}</title><link>${esc(abs("/shop"))}</link><description>${esc(store?.name ?? "")} product feed</description>\n${items.map((i) => `<item>${i}</item>`).join("\n")}\n</channel></rss>\n`;
    return text(body, "application/xml");
  }
  return null;
}
