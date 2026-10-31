// The go-live checklist: everything this installation needs before it takes
// real customers. Automatic checks are measured from the environment and the
// database on every request; the rest (backups, monitoring, legal review…) are
// things only a person can confirm, ticked off here with who and when.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { configuredProviders } from "../billing/billing";
import { ApiError } from "../http/errors";
import { mailProvider } from "../services/mail";
import { switchOn } from "./health";
import { saveSection, settings } from "./settings";

export type Check = { id: string; group: string; title: string; status: "pass" | "warn" | "fail" | "todo" | "done"; detail: string; fix?: string; manual?: boolean; doneBy?: string; doneAt?: string; blocking: boolean };

export const MANUAL: { id: string; group: string; title: string; detail: string; blocking: boolean }[] = [
  { id: "backups", group: "Data", title: "Automated database backups, with a tested restore", detail: "Point-in-time recovery on the managed database, and one restore actually done into a scratch database.", blocking: true },
  { id: "monitoring", group: "Operations", title: "Uptime monitoring and alerting", detail: "An external check on /api/v1/health every minute, paging someone when it fails.", blocking: true },
  { id: "tls", group: "Security", title: "HTTPS everywhere, including customer domains", detail: "A TLS-terminating proxy or load balancer with on-demand certificates for custom domains; HTTP redirects to HTTPS.", blocking: true },
  { id: "secrets", group: "Security", title: "Secrets stored in a secret manager", detail: "Environment values live in your platform's secret store, not in files on servers or in the repository.", blocking: true },
  { id: "legal", group: "Business", title: "Terms, privacy policy and data processing agreement reviewed", detail: "Linked from sign-up and the marketing site.", blocking: true },
  { id: "loadtest", group: "Operations", title: "Load test at expected peak", detail: "Several app servers behind the load balancer, one or two job workers, and the database's connection limit sized for them.", blocking: false },
  { id: "incident", group: "Operations", title: "Incident contact and status page", detail: "Who is on call, and where customers see status.", blocking: false },
  { id: "proxy", group: "Security", title: "The proxy overwrites X-Forwarded-For", detail: "The load balancer or proxy replaces (not appends to) X-Forwarded-For with the real client address, so rate limits and the admin IP allowlist can't be fooled (deploy/Caddyfile does this).", blocking: true },
  { id: "dns", group: "Hosting", title: "App and site domains point at the load balancer", detail: "app.yourdomain.com for the app, and the custom-domain target customers will use.", blocking: true },
];

export async function checklist(): Promise<{ checks: Check[]; ready: boolean; blocking: number; done: number; total: number }> {
  const s = await settings();
  const enc = process.env.APP_ENCRYPTION_KEY ?? "";
  const app = process.env.APP_URL ?? "";
  const [admins] = (await db.execute<{ n: number; mfa: number }>(sql`select count(*)::int as n, count(*) filter (where totp_enabled_at is not null)::int as mfa from users where is_platform_admin and disabled_at is null`)).rows;
  const [mig] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => ({ rows: [{ n: -1 }] }))).rows;
  const [met] = (await db.execute<{ n: number }>(sql`select count(distinct node)::int as n from request_stats where bucket > now() - interval '10 minutes'`)).rows;
  const c = (x: Omit<Check, "blocking"> & { blocking?: boolean }): Check => ({ blocking: true, ...x });
  const auto: Check[] = [
    c({ id: "env", group: "Core", title: "Running in production mode", status: process.env.NODE_ENV === "production" ? "pass" : "fail", detail: `NODE_ENV is “${process.env.NODE_ENV ?? ""}”.`, fix: "Build with next build and start with NODE_ENV=production." }),
    c({ id: "app_url", group: "Core", title: "Public HTTPS address", status: app.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(app) ? "pass" : "fail", detail: app || "APP_URL isn't set.", fix: "APP_URL=https://app.yourdomain.com" }),
    c({ id: "encryption", group: "Security", title: "Strong encryption key", status: enc.length >= 32 ? "pass" : "fail", detail: enc ? `${enc.length} characters.` : "APP_ENCRYPTION_KEY isn't set.", fix: "openssl rand -base64 32 — and keep it safe; changing it later makes saved secrets unreadable." }),
    c({ id: "migrations", group: "Data", title: "Database migrated", status: Number(mig?.n) > 0 ? "pass" : "fail", detail: Number(mig?.n) > 0 ? `${mig!.n} migrations applied.` : "No migration record found.", fix: "npm run db:migrate on each release, before the new version takes traffic." }),
    c({ id: "email", group: "Messaging", title: "Email is delivered", status: mailProvider() !== "outbox" ? "pass" : "fail", detail: mailProvider() !== "outbox" ? "A provider is configured — send a test from Integrations." : "Emails are only recorded, so sign-up verification and password resets never arrive.", fix: "MAIL_FROM plus Resend, Postmark, SendGrid or SMTP." }),
    c({ id: "billing", group: "Business", title: "Billing connected", status: configuredProviders().length ? "pass" : "warn", detail: configuredProviders().length ? `Using ${configuredProviders().join(" and ")}.` : "No billing provider: every workspace is unlimited and nobody can pay.", fix: "Stripe or Razorpay keys, prices and webhook secret.", blocking: false }),
    c({ id: "domains", group: "Hosting", title: "Custom-domain target set", status: process.env.CUSTOM_DOMAIN_CNAME || process.env.CUSTOM_DOMAIN_IPV4 ? "pass" : "warn", detail: process.env.CUSTOM_DOMAIN_CNAME || process.env.CUSTOM_DOMAIN_IPV4 || "Customers can't connect their own domains yet.", fix: "CUSTOM_DOMAIN_CNAME=sites.yourdomain.com", blocking: false }),
    c({ id: "worker", group: "Hosting", title: "A background worker is running", status: switchOn("JOBS_WORKER") ? "pass" : "warn", detail: switchOn("JOBS_WORKER") ? "This server runs it." : "Off on this server — confirm another server runs it.", fix: "Run at least one node without APP_ROLE=web (and without JOBS_WORKER=off).", blocking: false }),
    c({ id: "ratelimit", group: "Security", title: "Rate limits shared across servers", status: (process.env.RATE_LIMIT_STORE ?? (process.env.NODE_ENV === "production" ? "postgres" : "memory")) === "postgres" ? "pass" : "warn", detail: (process.env.RATE_LIMIT_STORE ?? (process.env.NODE_ENV === "production" ? "postgres" : "memory")) === "postgres" ? "Counted in Postgres, so limits hold across every server." : "Counted in each server's memory.", fix: "Leave RATE_LIMIT_STORE unset in production (or set it to postgres).", blocking: false }),
    c({ id: "metrics", group: "Operations", title: "Request metrics are being recorded", status: Number(met?.n) > 0 ? "pass" : "warn", detail: Number(met?.n) > 0 ? `${met!.n} server(s) reported in the last 10 minutes.` : "No server has written request metrics in the last 10 minutes (they're written once a minute after traffic).", fix: "Make sure the servers run with the bundled start-up (npm start) so instrumentation runs.", blocking: false }),
    c({ id: "admins", group: "Security", title: "At least two platform owners/admins", status: Number(admins?.n) >= 2 ? "pass" : "warn", detail: `${admins?.n ?? 0} active platform admin(s).`, fix: "Add a second admin under Admins, so one lost device doesn't lock you out.", blocking: false }),
    c({ id: "admin_mfa", group: "Security", title: "Two-step sign-in required for admins", status: s.security.adminMfaRequired && Number(admins?.mfa) === Number(admins?.n) ? "pass" : "fail", detail: `${admins?.mfa ?? 0} of ${admins?.n ?? 0} admins have it on; requirement is ${s.security.adminMfaRequired ? "on" : "off"}.`, fix: "Each admin turns it on in Settings → Security, then switch on “Require two-step for admins”." }),
    c({ id: "support", group: "Business", title: "Support email and legal links set", status: s.general.supportEmail && s.general.termsUrl && s.general.privacyUrl ? "pass" : "fail", detail: [s.general.supportEmail || "no support email", s.general.termsUrl ? "terms ✓" : "no terms", s.general.privacyUrl ? "privacy ✓" : "no privacy policy"].join(" · "), fix: "Admin → Settings → General." }),
    c({ id: "maintenance", group: "Operations", title: "Maintenance mode is off", status: s.maintenance.enabled ? "fail" : "pass", detail: s.maintenance.enabled ? "Workspaces are read-only right now." : "Workspaces can make changes.", fix: "Admin → Notices." }),
    c({ id: "signup", group: "Business", title: "Sign-up open", status: s.signup.mode === "open" ? "pass" : "warn", detail: `Sign-up is ${s.signup.mode}.`, fix: "Admin → Settings → Sign-up, when you're ready for the public.", blocking: false }),
  ];
  const manual: Check[] = MANUAL.map((m) => {
    const d = s.golive.done[m.id];
    return { ...m, manual: true, status: d ? "done" : "todo", doneBy: d?.by, doneAt: d?.at };
  });
  const checks = [...auto, ...manual];
  const open = checks.filter((x) => x.blocking && (x.status === "fail" || x.status === "todo"));
  return { checks, ready: open.length === 0, blocking: open.length, done: checks.filter((x) => x.status === "pass" || x.status === "done").length, total: checks.length };
}

/** Ticks a manual item off (or back on). */
export async function markManual(admin: { id: string; email: string }, id: string, done: boolean) {
  if (!MANUAL.some((m) => m.id === id)) throw new ApiError("not_found", "No such checklist item");
  const cur = { ...(await settings()).golive.done };
  if (done) cur[id] = { by: admin.email, at: new Date().toISOString() };
  else delete cur[id];
  await saveSection(admin.id, "golive", { done: cur });
}
