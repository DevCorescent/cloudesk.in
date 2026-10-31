// Admin → Security → Posture: how well this installation is protected, checked
// live from its configuration and recent activity. Each check says what's wrong
// and how to fix it; nothing is scored that wasn't actually checked.
import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { cfg } from "../platform/config";
import { settings } from "../platform/settings";
import { cloudflareConfigured } from "./cloudflare";
import { localShare, originLastSeen } from "./firewall";

type Check = { id: string; area: "transport" | "firewall" | "edge" | "accounts" | "secrets" | "legal"; title: string; ok: boolean; severity: "high" | "medium" | "low"; detail: string; fix?: string };

export async function securityPosture() {
  const s = await settings();
  const fw = s.firewall;
  const day = new Date(Date.now() - 86_400_000);
  const appUrl = process.env.APP_URL ?? "";
  const [[admins], [adminsMfa], [users], [usersMfa], [failed], [blocked], [bans]] = await Promise.all([
    db.select({ n: count() }).from(schema.users).where(eq(schema.users.isPlatformAdmin, true)),
    db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.isPlatformAdmin, true), isNotNull(schema.users.totpEnabledAt))),
    db.select({ n: count() }).from(schema.users),
    db.select({ n: count() }).from(schema.users).where(isNotNull(schema.users.totpEnabledAt)),
    db.select({ n: count() }).from(schema.loginEvents).where(and(eq(schema.loginEvents.ok, false), gte(schema.loginEvents.at, day))),
    db.select({ n: count() }).from(schema.firewallEvents).where(and(eq(schema.firewallEvents.action, "block"), gte(schema.firewallEvents.at, day))),
    db.select({ n: count() }).from(schema.firewallBans),
  ]);
  const cf = cloudflareConfigured();
  const seen = originLastSeen();
  const checks: Check[] = [
    { id: "https", area: "transport", title: "Served over HTTPS", ok: appUrl.startsWith("https://"), severity: "high", detail: appUrl ? `Public address: ${appUrl}` : "APP_URL isn't set", fix: "Set APP_URL to the https:// address. HSTS (two years) is sent automatically once it's HTTPS." },
    { id: "production", area: "transport", title: "Running in production mode", ok: process.env.NODE_ENV === "production", severity: "medium", detail: `NODE_ENV=${process.env.NODE_ENV ?? "unset"}`, fix: "Run the production build (next build && next start)." },
    { id: "encryption-key", area: "secrets", title: "Encryption key for stored secrets", ok: Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64").length === 32, severity: "high", detail: "Provider keys and the origin secret are encrypted with AES-256-GCM using APP_ENCRYPTION_KEY.", fix: "Set APP_ENCRYPTION_KEY to 32 random bytes, base64-encoded." },
    { id: "firewall-mode", area: "firewall", title: "Firewall blocking attacks", ok: fw.mode === "block" && process.env.FIREWALL !== "off", severity: "high", detail: process.env.FIREWALL === "off" ? "Switched off by FIREWALL=off in the environment" : `Mode: ${fw.mode}`, fix: "Set the firewall mode to Block (Monitor only logs)." },
    { id: "firewall-rules", area: "firewall", title: "All built-in rule groups on", ok: Object.values(fw.rules).every(Boolean), severity: "medium", detail: `${Object.values(fw.rules).filter(Boolean).length} of ${Object.keys(fw.rules).length} on`, fix: "Switch on every rule group unless one blocks legitimate traffic." },
    { id: "rate-limit", area: "firewall", title: "Per-address rate limit", ok: fw.ratePerMinute > 0 && fw.ratePerMinute <= 3000, severity: "medium", detail: fw.ratePerMinute ? `${fw.ratePerMinute} requests a minute` : "Off", fix: "Set a limit between 300 and 3,000 requests a minute." },
    { id: "auto-ban", area: "firewall", title: "Repeat attackers banned automatically", ok: fw.autoBanAfter > 0, severity: "low", detail: fw.autoBanAfter ? `After ${fw.autoBanAfter} refused requests in 10 minutes, for ${fw.autoBanMinutes} minutes` : "Off" },
    { id: "trust-proxy", area: "edge", title: "Visitor addresses read from a trusted header", ok: cf ? fw.trustProxy === "cloudflare" : fw.trustProxy !== "xff-first", severity: "medium", detail: `Using ${fw.trustProxy}`, fix: cf ? "Behind Cloudflare, read CF-Connecting-IP (choose Cloudflare)." : "Behind your own proxy or load balancer, use the last X-Forwarded-For hop or X-Real-IP; the first hop can be set by anyone." },
    { id: "local-traffic", area: "edge", title: "Visitors' real addresses are seen", ok: localShare() < 0.9 || process.env.NODE_ENV !== "production", severity: "high", detail: `${Math.round(localShare() * 100)}% of recent requests look like they come from this server itself`, fix: "A proxy in front of the app is hiding visitors' addresses: choose the matching address source in Firewall (last X-Forwarded-For hop, X-Real-IP or Cloudflare). Until then rate limits and bans can't tell visitors apart." },
    { id: "cloudflare", area: "edge", title: "Cloudflare connected", ok: cf, severity: "medium", detail: cf ? `Zone ${cfg("CLOUDFLARE_ZONE_ID")}` : "Not connected", fix: "Put the domain behind Cloudflare (DDoS protection, edge WAF, caching) and connect it here." },
    { id: "origin-lock", area: "edge", title: "Only Cloudflare can reach the server", ok: cf && fw.requireCloudflare && !!cfg("CLOUDFLARE_ORIGIN_SECRET"), severity: cf ? "high" : "low", detail: fw.requireCloudflare ? "Requests without Cloudflare's secret header are refused" : seen ? `Cloudflare's header last seen ${new Date(seen).toISOString()}` : "Not set up", fix: "Lock origin, wait until requests are seen with the header, then require it." },
    { id: "admin-mfa-rule", area: "accounts", title: "Two-step sign-in required for admins", ok: s.security.adminMfaRequired, severity: "high", detail: s.security.adminMfaRequired ? "Required" : "Not required", fix: "Turn on “Admins must use two-step sign-in” in Settings → Security." },
    { id: "admin-mfa", area: "accounts", title: "Every admin has two-step sign-in", ok: admins.n > 0 && adminsMfa.n === admins.n, severity: "high", detail: `${adminsMfa.n} of ${admins.n} admins` },
    { id: "admin-ips", area: "accounts", title: "Console limited to known networks", ok: s.security.adminIpAllowlist.length > 0, severity: "low", detail: s.security.adminIpAllowlist.length ? `${s.security.adminIpAllowlist.length} addresses or ranges` : "Open to any network (with sign-in)", fix: "Optional: add your office or VPN addresses in Settings → Security." },
    { id: "failed-logins", area: "accounts", title: "Failed sign-ins in the last day", ok: failed.n < 200, severity: "low", detail: `${failed.n} failed sign-ins`, fix: "A spike can mean password guessing: look at Audit → Sign-ins and consider banning the addresses." },
    { id: "mail", area: "accounts", title: "Email service for sign-in codes", ok: !!cfg("MAIL_FROM") && (cfg("MAIL_PROVIDER") ?? "") !== "outbox", severity: "high", detail: cfg("MAIL_FROM") ? `From ${cfg("MAIL_FROM")}` : "Not configured — sign-up codes can't be delivered", fix: "Configure email in Integrations." },
    { id: "webhook-secrets", area: "secrets", title: "Payment webhooks signed", ok: (!cfg("RAZORPAY_KEY_ID") || !!cfg("RAZORPAY_WEBHOOK_SECRET")) && (!cfg("STRIPE_SECRET_KEY") || !!cfg("STRIPE_WEBHOOK_SECRET")), severity: "medium", detail: "Webhooks without a signing secret are refused", fix: "Set the webhook secrets for each payment provider you use." },
    { id: "legal", area: "legal", title: "Company and Grievance Officer details published", ok: !!(s.legal.companyName && s.legal.grievanceEmail), severity: "medium", detail: s.legal.companyName ? s.legal.companyName : "Company details missing from the legal pages", fix: "Fill in Settings → Legal (the IT Rules 2021 require a Grievance Officer contact)." },
  ];
  const weight = { high: 3, medium: 2, low: 1 };
  const total = checks.reduce((n, c) => n + weight[c.severity], 0);
  const got = checks.filter((c) => c.ok).reduce((n, c) => n + weight[c.severity], 0);
  return {
    score: Math.round((got / total) * 100),
    checks,
    activity: { blocked24h: blocked.n, bans: bans.n, failedLogins24h: failed.n, users: users.n, usersWithMfa: usersMfa.n },
  };
}
