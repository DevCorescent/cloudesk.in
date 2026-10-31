import type { MetadataRoute } from "next";
import { BUSINESSES } from "@/components/marketing/businesses";
import { FEATURES } from "@/components/marketing/features";
import { LEGAL_PAGES } from "@/components/legal/pages";

// Public pages of the marketing site, for search engines.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const at = (path: string, priority: number, changeFrequency: "weekly" | "monthly" | "yearly") => ({ url: new URL(path, base).toString(), lastModified: new Date(), changeFrequency, priority });
  return [
    at("/", 1, "weekly"),
    at("/pricing", 0.9, "weekly"),
    at("/partners", 0.8, "monthly"),
    at("/features", 0.8, "monthly"),
    ...FEATURES.map((f) => at(`/features/${f.slug}`, 0.7, "monthly")),
    at("/for", 0.7, "monthly"),
    ...BUSINESSES.map((b) => at(`/for/${b.slug}`, 0.6, "monthly")),
    at("/start", 0.6, "monthly"),
    at("/legal", 0.4, "yearly"),
    at("/contact", 0.4, "yearly"),
    ...LEGAL_PAGES.map((p) => at(p.href, 0.3, "yearly")),
  ];
}
