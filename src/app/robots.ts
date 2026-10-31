import type { MetadataRoute } from "next";

// The platform's own robots.txt (customer domains are rewritten to their
// sites by the proxy and never reach this). Public marketing and legal pages
// are open; the signed-in app, the API and private link pages are not.
const PRIVATE = ["/api/", "/admin", "/settings", "/home", "/welcome", "/c/", "/d/", "/doc/", "/e/", "/f/", "/m/", "/portal/", "/r/", "/review/", "/rv/", "/sign/", "/t/", "/track/", "/u/", "/v/", "/careers/", "/support/", "/mail-img/", "/offline"];

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}
