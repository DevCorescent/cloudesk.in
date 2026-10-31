import { describe, expect, it } from "vitest";
import { siteDocSchema } from "@/lib/site/model";
import { renderPage } from "@/lib/site/render";
import { storeSiteDoc, STORE_TEMPLATES } from "@/lib/store/templates";

const pub = { kind: "publish" as const, basePath: "", formAction: () => "#" };

describe("search & sharing", () => {
  it("adds favicon, verification codes and business structured data to the home page", () => {
    const doc = storeSiteDoc(STORE_TEMPLATES[0]);
    doc.seo = { favicon: "https://cdn.example.com/icon.png", googleVerify: "g-code", bingVerify: "b-code", org: { type: "Store", phone: "+91 98000 00000", address: "1 MG Road", sameAs: ["https://instagram.com/acme"] } };
    const valid = siteDocSchema.parse(doc);
    const html = renderPage(valid, valid.pages[0], pub);
    expect(html).toContain('<link rel="icon" href="https://cdn.example.com/icon.png">');
    expect(html).toContain('<meta name="google-site-verification" content="g-code">');
    expect(html).toContain('<meta name="msvalidate.01" content="b-code">');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld).toMatchObject({ "@type": "Store", telephone: "+91 98000 00000", address: "1 MG Road", sameAs: ["https://instagram.com/acme"] });
    expect(html).not.toContain('name="robots"');
  });

  it("escapes structured data so it can't close its own script", () => {
    const doc = storeSiteDoc(STORE_TEMPLATES[0]);
    doc.name = "Acme</script><script>alert(1)</script>";
    doc.seo = { org: { type: "Organization", sameAs: [] } };
    const html = renderPage(siteDocSchema.parse(doc), doc.pages[0], pub);
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(block).not.toContain("<");
    expect(JSON.parse(block).name).toBe("Acme</script><script>alert(1)</script>");
  });

  it("marks a hidden page noindex and gives it a canonical link", () => {
    const doc = storeSiteDoc(STORE_TEMPLATES[0]);
    doc.pages[0].seo = { noindex: true, canonical: "https://acme.com/" };
    const html = renderPage(siteDocSchema.parse(doc), doc.pages[0], pub);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<link rel="canonical" href="https://acme.com/">');
  });

  it("only accepts https canonical and social links", () => {
    const doc = storeSiteDoc(STORE_TEMPLATES[0]);
    doc.pages[0].seo = { canonical: "javascript:alert(1)" };
    expect(siteDocSchema.safeParse(doc).success).toBe(false);
    const d2 = storeSiteDoc(STORE_TEMPLATES[0]);
    d2.seo = { org: { type: "Organization", sameAs: ["http://x.com"] } };
    expect(siteDocSchema.safeParse(d2).success).toBe(false);
  });
});
