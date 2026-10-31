// Injection, SSRF, XSS and parsing hardening (security audit 2026-10-27).
import { describe, expect, it } from "vitest";
import { parseIcs } from "@/lib/calendar/ics";
import { eventSchema } from "@/lib/chat/model";
import { csvEscape, neutralizeFormula } from "@/lib/data/model";
import { scopeCss } from "@/lib/site/advanced";
import { safeImageUrl, safeUrl } from "@/lib/site/html";
import { mergeDocs } from "@/lib/site/merge";
import { siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { markdown, renderPage } from "@/lib/site/render";
import { storeSiteDoc, STORE_TEMPLATES } from "@/lib/store/templates";
import { sniffImage } from "@/server/media/images";
import { isPublicAddress, publicAddressOf, validateUrl } from "@/server/net/safe-fetch";
import { isScriptUrl, neutralizeScriptUrls } from "@/server/security/html-urls";
import { contains, escapeLike } from "@/server/security/like";

describe("SSRF: public addresses", () => {
  it("refuses IPv4 reached through IPv6 in any spelling", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:0a00:0001", "::7f00:1", "::127.0.0.1", "0:0:0:0:0:ffff:127.0.0.1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "64:ff9b::7f00:1", "::", "::1", "0:0:0:0:0:0:0:1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("refuses non-global IPv6 ranges and accepts global unicast", () => {
    for (const ip of ["fe80::1", "fec0::1", "fd12:3456::1", "fc00::1", "ff02::1", "2001:db8::1", "2001::1", "100::1", "3fff::1", "fe80::1%eth0"]) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001::200e", "2002:5db8:d822::1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("rejects URLs whose host is a private address however it's written", () => {
    for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:a9fe:a9fe]/latest/meta-data/", "http://[::127.0.0.1]/", "http://0x7f.1/", "http://2130706433/", "http://127.1/", "http://0/", "http://localhost./", "http://foo.localhost./", "http://[fd00::1]/", "http://169.254.169.254/"]) {
      expect(() => validateUrl(u), u).toThrow();
    }
    expect(validateUrl("https://example.com/a").hostname).toBe("example.com");
  });
  it("resolves mail server names and refuses any private answer", async () => {
    const dns = (answers: Record<string, string[]>) => async (h: string) => (answers[h] ?? []).map((address) => ({ address }));
    const r = dns({ "mail.example.com": ["93.184.216.34"], "evil.example.com": ["93.184.216.34", "10.0.0.5"], "meta.example.com": ["169.254.169.254"], "v6.example.com": ["::ffff:7f00:1"] });
    expect(await publicAddressOf("mail.example.com", r)).toBe("93.184.216.34");
    expect(await publicAddressOf("1.1.1.1", r)).toBe("1.1.1.1");
    for (const h of ["evil.example.com", "meta.example.com", "v6.example.com", "nothing.example.com", "localhost", "imap.internal", "127.0.0.1", "[::1]", "10.1.1.1"]) {
      await expect(publicAddressOf(h, r), h).rejects.toThrow(/isn't a public server/);
    }
  });
});

describe("CSV formula injection", () => {
  it("quotes formulas, including DDE payloads that start like a number", () => {
    for (const v of ["=1+1", "+cmd", "@SUM(A1)", "-2+3+cmd|' /C calc'!A0", "-1+1", "\t=1", "=HYPERLINK(\"http://x\")"]) expect(neutralizeFormula(v), v).toBe(`'${v}`);
    for (const v of ["-12.50", "-3", "42", "hello", "", "a=b"]) expect(neutralizeFormula(v), v).toBe(v);
    expect(csvEscape('-2+3+cmd|"x"')).toBe(`"'-2+3+cmd|""x"""`);
    expect(csvEscape(-5)).toBe("-5");
  });
});

describe("LIKE patterns", () => {
  it("escapes wildcards so a search matches literally", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(contains("a_b")).toBe("%a\\_b%");
  });
});

describe("parsing untrusted input", () => {
  it("parses invite lines in linear time (no regex backtracking on ;)", () => {
    const hostile = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nX${";".repeat(200_000)}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const t = performance.now();
    parseIcs(hostile);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it("still reads quoted parameters with ; and : inside", () => {
    const ics = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:u1", "DTSTART:20261101T100000Z", "DTEND:20261101T110000Z", "SUMMARY:Sync", 'ORGANIZER;CN="Rao; Meera: PM";SENT-BY="mailto:a@b.in":mailto:meera@saffron.in', "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const cal = parseIcs(ics);
    expect(cal.method).toBe("REQUEST");
    expect(cal.events[0]!.organizer).toMatchObject({ name: "Rao; Meera: PM", email: "meera@saffron.in" });
  });
  it("ignores oversized calendar text", () => {
    expect(parseIcs("BEGIN:VCALENDAR\n" + "X".repeat(2_100_000)).events).toEqual([]);
  });
  it("doesn't throw on a truncated PNG", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
  it("ignores __proto__ keys when merging site documents", () => {
    const b = siteDocSchema.parse(storeSiteDoc(STORE_TEMPLATES[0]));
    const main = structuredClone(b);
    const branch = JSON.parse(JSON.stringify(b).replace('"props":{', '"props":{"__proto__":{"polluted":true},')) as SiteDoc;
    const r = mergeDocs(b, main, branch);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    for (const p of r.doc.pages) for (const s of p.sections) expect(Object.getPrototypeOf(s.props)).toBe(Object.prototype);
  });
});

describe("XSS in rendered pages", () => {
  const base = siteDocSchema.parse(storeSiteDoc(STORE_TEMPLATES[0]));
  it("only uses known variants for an A/B test's B side", () => {
    const doc = structuredClone(base);
    const hero = doc.pages[0].sections.find((s) => s.type === "hero")!;
    hero.ab = { variant: '"><img src=x onerror=alert(1)>', running: true };
    const html = renderPage(doc, doc.pages[0], { kind: "publish", basePath: "", formAction: () => "/f", ab: "B" });
    expect(html).not.toContain("onerror=alert(1)");
  });
  it("keeps the markdown link pattern fast on hostile input", () => {
    const t = performance.now();
    markdown("[".repeat(50_000) + "x", { kind: "preview" });
    expect(performance.now() - t).toBeLessThan(1000);
    expect(markdown("[Docs](https://example.com) and [bad](javascript:void0)", { kind: "preview" })).toBe('<p><a href="https://example.com/">Docs</a> and bad</p>');
  });
  it("treats /\\host and //host as other sites, not paths", () => {
    for (const u of ["/\\evil.com", "//evil.com", "/\t/evil.com", "javascript:alert(1)"]) {
      expect(safeUrl(u), u).toBe("");
      expect(safeImageUrl(u), u).toBe("");
    }
    expect(safeUrl("/shop")).toBe("/shop");
  });
  it("refuses CSS escapes in custom CSS", () => {
    const r = scopeCss("background: u\\rl(http://evil.example/x.png)", ".s");
    expect(r.css).not.toContain("\\");
    expect(r.css).not.toContain("evil.example");
    expect(r.problems.length).toBeGreaterThan(0);
  });
  it("only accepts http(s) meeting links in chat events", () => {
    const ok = { title: "Standup", start: "2026-11-01T10:00:00Z", end: "2026-11-01T10:30:00Z" };
    expect(eventSchema.safeParse({ ...ok, meetingUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(eventSchema.safeParse({ ...ok, meetingUrl: "https://meet.google.com/abc" }).success).toBe(true);
  });
});

describe("email HTML links", () => {
  it("recognises script URLs however they're encoded", () => {
    for (const u of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "&#106;avascript:alert(1)", "&#x6A;avascript&colon;alert(1)", "vbscript:x", "data:text/html,<script>alert(1)</script>"]) expect(isScriptUrl(u), u).toBe(true);
    for (const u of ["https://example.com", "mailto:a@b.in", "/x", "#top"]) expect(isScriptUrl(u), u).toBe(false);
  });
  it("replaces them with # and keeps normal links and inline images", () => {
    const html = `<a href="javascript:alert(1)">a</a><a href='&#106;avascript:x'>b</a><a HREF=javascript:x>c</a><a href="https://ok.example/">d</a><img src="data:image/png;base64,AAAA"><form action="javascript:x"></form>`;
    const out = neutralizeScriptUrls(html);
    expect(out).not.toMatch(/javascript|&#106;/i);
    expect(out).toContain('href="https://ok.example/"');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out.match(/"#"/g)).toHaveLength(4);
  });
});
