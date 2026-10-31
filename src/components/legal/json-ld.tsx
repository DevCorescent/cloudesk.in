// Structured data for search engines: the organisation behind the service and
// the website. Only values that are actually set are included.
import { settings } from "@/server/platform/settings";

const safe = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export async function SiteJsonLd() {
  const s = await settings().catch(() => null);
  const url = process.env.APP_URL ?? "http://localhost:3000";
  const product = s?.general.productName || "Cloudesk";
  const email = s?.general.supportEmail || s?.legal.contactEmail || "";
  const org: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: s?.legal.companyName || product,
    ...(s?.legal.companyName ? { brand: { "@type": "Brand", name: product } } : {}),
    url,
    logo: new URL("/icon.svg", url).toString(),
    ...(email ? { contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email, availableLanguage: ["en"] }] } : {}),
    ...(s?.legal.registeredAddress ? { address: s.legal.registeredAddress } : {}),
  };
  const site = { "@context": "https://schema.org", "@type": "WebSite", name: product, url, inLanguage: "en-IN" };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safe(org) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safe(site) }} />
    </>
  );
}
