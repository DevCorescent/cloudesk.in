import { describe, expect, it } from "vitest";
import { classify, fillTemplate, normSubject, parseSearch, providerForAddress, providerForMx, PROVIDERS, ruleMatches, suspicious } from "@/lib/mail/model";

const base = { from: "asha@acme.in", subject: "Hello", text: "", knownSender: false, firstFromSender: false, toMeDirectly: true };

describe("mail model", () => {
  it("knows providers by address and by MX record", () => {
    expect(providerForAddress("me@gmail.com")).toBe("gmail");
    expect(providerForAddress("me@outlook.com")).toBe("microsoft");
    expect(providerForAddress("me@acme.in")).toBeNull();
    expect(providerForMx(["aspmx.l.google.com."])).toBe("google_workspace");
    expect(providerForMx(["acme-in.mail.protection.outlook.com"])).toBe("microsoft");
    expect(providerForMx(["mx.zoho.in"])).toBe("zoho");
    expect(providerForMx(["mx1.titan.email"])).toBe("titan");
    expect(providerForMx(["mail.acme.in"])).toBeNull();
    // Every preset with servers has steps a person can follow.
    for (const p of PROVIDERS) expect(p.steps.length, p.id).toBeGreaterThan(0);
  });

  it("parses Gmail-style search", () => {
    expect(parseSearch('from:asha has:attachment "march invoice" is:unread before:2026-10-01 label:vip')).toEqual({ text: "march invoice", from: "asha", hasAttachment: true, unread: true, before: "2026-10-01", label: "vip" });
    expect(parseSearch("category:finance gst")).toEqual({ text: "gst", category: "finance" });
  });

  it("sorts mail into categories with reasons, and spots urgency", () => {
    expect(classify({ ...base, from: "messages-noreply@linkedin.com", subject: "You appeared in 5 searches" }).category).toBe("social");
    expect(classify({ ...base, subject: "Tax invoice INV-204 for October" }).category).toBe("finance");
    expect(classify({ ...base, knownSender: true }).category).toBe("people");
    expect(classify({ ...base, listUnsubscribe: true, subject: "Diwali sale: 40% off everything" })).toMatchObject({ category: "promotions", priority: "low" });
    expect(classify({ ...base, listUnsubscribe: true, subject: "Our October letter" }).category).toBe("newsletters");
    expect(classify({ ...base, from: "no-reply@bank.in", subject: "Your OTP for sign-in" }).category).toBe("updates");
    expect(classify({ ...base, firstFromSender: true }).category).toBe("screener");
    expect(classify({ ...base, knownSender: true, subject: "URGENT: contract today" }).priority).toBe("high");
    expect(classify({ ...base, knownSender: true, text: "Can you send the quote by Friday?" }).priority).toBe("high");
  });

  it("warns about spoofing and failed authentication", () => {
    expect(suspicious({ from: "billing@paypa1.co", fromName: "service@paypal.com" })[0]).toMatch(/paypal.com/);
    expect(suspicious({ from: "a@acme.in", authResults: "mx.google.com; spf=pass; dmarc=fail" })).toHaveLength(1);
    expect(suspicious({ from: "a@acme.in", replyTo: "a@evil.ru" })[0]).toMatch(/evil.ru/);
    expect(suspicious({ from: "a@acme.in", replyTo: "sales@mail.acme.in" })).toEqual([]);
  });

  it("matches rules and fills templates", () => {
    const m = { from: "ap@vendor.co.in", to: ["me@acme.in"], subject: "Invoice 22", text: "Please pay", category: "finance" as const, hasAttachment: true };
    expect(ruleMatches({ match: "all", conditions: [{ field: "from", op: "domain", value: "vendor.co.in" }, { field: "hasAttachment", op: "is", value: "true" }] }, m)).toBe(true);
    expect(ruleMatches({ match: "all", conditions: [{ field: "from", op: "domain", value: "vendor.co.in" }, { field: "subject", op: "contains", value: "quote" }] }, m)).toBe(false);
    expect(ruleMatches({ match: "any", conditions: [{ field: "subject", op: "contains", value: "quote" }, { field: "category", op: "is", value: "finance" }] }, m)).toBe(true);
    expect(fillTemplate("Hi {{first_name}}, thanks — {{my_name}}", { name: "Asha Rao", myName: "Meera" })).toBe("Hi Asha, thanks — Meera");
    // No name known: the greeting closes up instead of "Hi ,".
    expect(fillTemplate("Hi {{first_name}},\nThanks", { email: "x@y.in" })).toBe("Hi,\nThanks");
    expect(fillTemplate("Dear {{name}} at {{company}}", { name: "Asha Rao" })).toBe("Dear Asha Rao at");
    expect(normSubject("RE: Fwd: Re[2]: Quote for tables")).toBe("quote for tables");
  });
});

describe("connection errors", () => {
  it("sorts them by cause, so the wizard's advice doesn't depend on wording", async () => {
    const { failKind, explain } = await import("@/server/mail/transport");
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" });
    expect(failKind(refused)).toBe("network");
    expect(explain(refused, "imap")).toMatch(/didn't answer on that port/);
    expect(failKind(Object.assign(new Error("getaddrinfo ENOTFOUND imap.typo.example"), { code: "ENOTFOUND" }))).toBe("dns");
    expect(failKind({ authenticationFailed: true, message: "Command failed" })).toBe("auth");
    expect(failKind(new Error("self-signed certificate in certificate chain"))).toBe("tls");
    expect(failKind(new Error("something odd"))).toBe("other");
  });
});

describe("security headers", () => {
  it("leave email bodies frameable by the inbox, and keep blocking framing everywhere else", async () => {
    const { default: nextConfig } = await import("../../next.config");
    const rules = await nextConfig.headers!();
    const app = rules.find((r) => r.headers.some((h) => h.key === "X-Frame-Options"))!;
    // `/((?!…).*)` — the part in brackets is a plain regular expression.
    const covers = (path: string) => new RegExp(`^${app.source.replace(/^\/\((.*)\)$/, "/$1")}$`).test(path);
    expect(covers("/api/v1/orgs/9f19ea4a-6770-4ccc-9ba5-94381c451fe7/mail/messages/1b2c3d4e-0000-4000-8000-000000000000/html")).toBe(false);
    expect(covers("/api/v1/orgs/9f19ea4a-6770-4ccc-9ba5-94381c451fe7/mail/meta")).toBe(true);
    expect(covers("/api/v1/orgs/9f19ea4a-6770-4ccc-9ba5-94381c451fe7/mail/attachments/1b2c3d4e-0000-4000-8000-000000000000")).toBe(true);
    expect(covers("/mail")).toBe(true);
    expect(covers("/login")).toBe(true);
  });
});

describe("auto-replies and reply targets", () => {
  it("only auto-replies to real people writing personally", async () => {
    const { autoReplyAllowed } = await import("@/lib/mail/model");
    const base = { from: "kiran@client.in", ownAddress: "meera@saffron.in", autoSubmitted: "", precedence: "", listId: "", listUnsubscribe: "", autoResponseSuppress: "", category: "primary" as const, warnings: [] };
    expect(autoReplyAllowed(base).ok).toBe(true);
    expect(autoReplyAllowed({ ...base, category: "finance" }).ok).toBe(true);
    expect(autoReplyAllowed({ ...base, autoSubmitted: "no" }).ok).toBe(true);
    for (const bad of [{ from: "meera@saffron.in" }, { from: "no-reply@bank.in" }, { from: "noreply@shop.in" }, { from: "mailer-daemon@x.in" }, { autoSubmitted: "auto-replied" }, { precedence: "bulk" }, { listId: "<news.shop.in>" }, { listUnsubscribe: "<https://u>" }, { autoResponseSuppress: "All" }, { category: "promotions" as const }, { warnings: ["spoofed"] }])
      expect(autoReplyAllowed({ ...base, ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it("is on only between its dates, in the owner's time zone", async () => {
    const { autoReplyActive } = await import("@/lib/mail/model");
    const a = { enabled: true, from: "2026-11-02", until: "2026-11-06", subject: "", body: "Away", onlyKnown: false, tzOffset: 330 };
    expect(autoReplyActive(a, new Date("2026-11-01T18:00:00Z"))).toBe(false); // 23:30 on the 1st in India
    expect(autoReplyActive(a, new Date("2026-11-01T19:00:00Z"))).toBe(true); // 00:30 on the 2nd
    expect(autoReplyActive(a, new Date("2026-11-06T18:00:00Z"))).toBe(true);
    expect(autoReplyActive(a, new Date("2026-11-06T19:00:00Z"))).toBe(false);
    expect(autoReplyActive({ ...a, enabled: false }, new Date("2026-11-03T10:00:00Z"))).toBe(false);
    expect(autoReplyActive({ ...a, from: "", until: "" }, new Date())).toBe(true);
  });

  it("works out how long they've waited against the target", async () => {
    const { slaState } = await import("@/lib/mail/model");
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(slaState(null, 4, now)).toBeNull();
    expect(slaState("2026-10-26T09:00:00Z", 4, now)).toMatchObject({ waitingMs: 3 * 3_600_000, overdue: false });
    expect(slaState("2026-10-26T07:00:00Z", 4, now)).toMatchObject({ overdue: true });
    expect(slaState("2026-10-26T07:00:00Z", null, now)).toMatchObject({ dueAt: null, overdue: false });
  });
});
