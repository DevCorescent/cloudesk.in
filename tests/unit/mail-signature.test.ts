import { describe, expect, it } from "vitest";
import { DESIGNS, signatureFields, signatureHtml, signatureSchema, signatureText, splitQuote } from "@/lib/mail/signature";

const f = signatureFields.parse({
  name: "Meera Iyer", title: "Founder", company: "Saffron & Sage", phone: "+91 98200 12345", email: "meera@saffronsage.in", website: "https://saffronsage.in",
  address: "12 MG Road, Bengaluru", logo: "/mail-img/0b9d5c8e-4f7a-4c2e-9d61-1f2a3b4c5d6e", linkedin: "https://linkedin.com/in/meera", ctaLabel: "Book a call", ctaUrl: "https://cal.com/meera", disclaimer: "Confidential.",
});

describe("signatures", () => {
  it("renders every design as email-safe HTML with the details escaped", () => {
    for (const d of DESIGNS) {
      const html = signatureHtml(d.id, f, "https://app.cloudesk.in");
      expect(html, d.id).toContain("Meera Iyer");
      expect(html, d.id).toContain("Saffron &amp; Sage");
      expect(html, d.id).not.toMatch(/<script|class="(?!cc-signature)|<style/);
    }
    // Uploaded images become full links recipients can load.
    expect(signatureHtml("corporate", f, "https://app.cloudesk.in")).toContain('src="https://app.cloudesk.in/mail-img/0b9d5c8e-4f7a-4c2e-9d61-1f2a3b4c5d6e"');
    expect(signatureHtml("banner", f, "x")).toContain('href="https://cal.com/meera"');
    expect(signatureHtml("corporate", f, "x")).toContain('href="tel:+919820012345"');
    const evil = signatureFields.parse({ ...f, name: '<img src=x onerror=alert(1)>', title: '"><script>' });
    expect(signatureHtml("modern", evil, "x")).not.toMatch(/<img src=x|<script/);
  });

  it("accepts only https links and uploaded images", () => {
    expect(signatureFields.safeParse({ ...f, website: "javascript:alert(1)" }).success).toBe(false);
    expect(signatureFields.safeParse({ ...f, website: "http://plain.example" }).success).toBe(false);
    expect(signatureFields.safeParse({ ...f, logo: "data:image/png;base64,AAAA" }).success).toBe(false);
    expect(signatureFields.safeParse({ ...f, logo: "https://cdn.example/logo.png" }).success).toBe(true);
    expect(signatureFields.safeParse({ ...f, accent: "red" }).success).toBe(false);
    expect(signatureSchema.safeParse({ name: "Work", design: "nope", fields: f }).success).toBe(false);
  });

  it("has a plain-text version", () => {
    const t = signatureText("corporate", f);
    expect(t.split("\n")[0]).toBe("Meera Iyer");
    expect(t).toContain("T +91 98200 12345 | meera@saffronsage.in | saffronsage.in");
    expect(signatureText("compact", f)).toBe("Meera Iyer | Founder | Saffron & Sage | +91 98200 12345");
  });

  it("splits a body at the reply quote or forwarded message", () => {
    expect(splitQuote("Thanks!\n\nOn 25 Oct 2026, 4:05 pm, Dev <dev@x.in> wrote:\n> Hi")).toEqual(["Thanks!", "\n\nOn 25 Oct 2026, 4:05 pm, Dev <dev@x.in> wrote:\n> Hi"]);
    expect(splitQuote("FYI\n\n---------- Forwarded message ----------\nFrom: A")[0]).toBe("FYI");
    expect(splitQuote("Just text")).toEqual(["Just text", ""]);
  });
});
