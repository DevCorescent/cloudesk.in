import { describe, expect, it } from "vitest";
import { expiryFrom, inviteProblem, inviteText, isGuestEmail, joinSchema, shareTargets, waNumber } from "@/lib/chat/guests";
import { deviceOf } from "@/server/chat/guests";

describe("chat guest invites", () => {
  const now = Date.UTC(2026, 9, 30, 12);

  it("works out expiry and why a link can't be used", () => {
    expect(expiryFrom("never", now)).toBeNull();
    expect(expiryFrom("1d", now)!.getTime()).toBe(now + 86_400_000);
    const ok = { revokedAt: null, expiresAt: new Date(now + 1000), maxUses: 3, uses: 2 };
    expect(inviteProblem(ok, now)).toBeNull();
    expect(inviteProblem({ ...ok, uses: 3 }, now)).toMatch(/used as many times/);
    expect(inviteProblem({ ...ok, expiresAt: new Date(now) }, now)).toMatch(/expired/);
    expect(inviteProblem({ ...ok, revokedAt: new Date(now) }, now)).toMatch(/turned off/);
    expect(inviteProblem({ ...ok, maxUses: null, uses: 999 }, now)).toBeNull();
  });

  it("builds share links for every app, with the message encoded", () => {
    const text = inviteText({ inviter: "Meera", where: "#client-project", workspace: "Saffron & Co", url: "https://app.cloudesk.in/j/abc123def456", approval: true });
    expect(text).toContain("an admin lets you in");
    expect(text.endsWith("https://app.cloudesk.in/j/abc123def456")).toBe(true);
    const t = Object.fromEntries(shareTargets({ url: "https://app.cloudesk.in/j/abc123def456", text, subject: "Join us" }).map((x) => [x.id, x.href]));
    expect(t.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
    expect(t.email).toBe(`mailto:?subject=Join%20us&body=${encodeURIComponent(text)}`);
    expect(t.telegram).toMatch(/^https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Fapp\.cloudesk\.in%2Fj%2Fabc123def456&text=/);
    expect(t.sms).toMatch(/^sms:\?&body=/);
    expect(Object.keys(t)).toEqual(["whatsapp", "email", "sms", "telegram", "teams", "linkedin", "x", "facebook"]);
  });

  it("sends WhatsApp straight to a number when one is given", () => {
    expect(waNumber("+91 98765-43210")).toBe("919876543210");
    const [wa, , sms] = shareTargets({ url: "u", text: "hi", subject: "s", phone: "+91 98765 43210" });
    expect(wa!.href).toBe("https://wa.me/919876543210?text=hi");
    expect(sms!.href).toBe("sms:+919876543210?&body=hi");
    expect(shareTargets({ url: "u", text: "hi", subject: "s", phone: "123" })[0]!.href).toBe("https://wa.me/?text=hi");
  });

  it("asks only for a name, and keeps tokens out of it", () => {
    expect(joinSchema.safeParse({ name: "Priya Sharma" }).success).toBe(true);
    expect(joinSchema.safeParse({ name: "P" }).success).toBe(false);
    expect(joinSchema.safeParse({ name: "@[Boss](u:123)" }).success).toBe(false);
    expect(joinSchema.safeParse({ name: "Priya", contact: "+91 98765 43210" }).success).toBe(true);
    expect(joinSchema.safeParse({ name: "Priya", contact: "nonsense" }).success).toBe(false);
  });

  it("recognises guest identities and devices", () => {
    expect(isGuestEmail("1b2c@guest.cloudesk.invalid")).toBe(true);
    expect(isGuestEmail("meera@saffron.in")).toBe(false);
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone / iPad");
    expect(deviceOf("")).toBe("Unknown device");
  });
});
