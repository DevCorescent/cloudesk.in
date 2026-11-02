// What this installation is connected to, read from its environment: never a
// secret's value, only whether it is set. Owners can test a connection live —
// the database, email (to their own address), billing (fetches a price), AI
// (lists models, which costs nothing) — and the result is the provider's answer.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { configuredProviders, priceFor } from "../billing/billing";
import { ApiError } from "../http/errors";
import { audit } from "../services/audit";
import { MAIL_PROVIDER_NAMES, mailProvider, sendMail } from "../services/mail";
import { cfg } from "./config";
import { switchOn } from "./health";

const has = (k: string) => !!cfg(k);
type Status = "ready" | "partial" | "missing" | "optional";
export type Integration = { id: string; name: string; group: string; status: Status; detail: string; keys: { key: string; set: boolean }[]; testable: boolean; docs: string };

const keys = (...k: string[]) => k.map((key) => ({ key, set: has(key) }));
const status = (ks: { set: boolean }[], required = true): Status => (ks.every((k) => k.set) ? "ready" : ks.some((k) => k.set) ? "partial" : required ? "missing" : "optional");

export function integrations(): Integration[] {
  const mail = mailProvider();
  const billing = configuredProviders();
  const enc = process.env.APP_ENCRYPTION_KEY ?? "";
  const app = process.env.APP_URL ?? "";
  return [
    { id: "database", name: "PostgreSQL database", group: "Core", status: has("DATABASE_URL") ? "ready" : "missing", detail: "Every workspace's data. Use a managed Postgres with backups and a read replica for scale.", keys: keys("DATABASE_URL"), testable: true, docs: "DATABASE_URL=postgres://user:pass@host:5432/db" },
    { id: "encryption", name: "Encryption key", group: "Core", status: enc.length >= 32 ? "ready" : enc ? "partial" : "missing", detail: enc && enc.length < 32 ? "Set, but shorter than 32 characters." : "Encrypts saved tokens, two-step secrets and connection passwords. Never change it once data exists.", keys: keys("APP_ENCRYPTION_KEY"), testable: false, docs: "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)" },
    { id: "app_url", name: "Public address", group: "Core", status: app.startsWith("https://") ? "ready" : app ? "partial" : "missing", detail: app ? (app.startsWith("https://") ? app : `${app} — use https:// in production`) : "Used in emails, links and payment callbacks.", keys: keys("APP_URL"), testable: false, docs: "APP_URL=https://app.yourdomain.com" },
    { id: "email", name: "Email delivery", group: "Messaging", status: mail === "outbox" ? "missing" : "ready", detail: mail === "outbox" ? "Emails are only recorded in the outbox, not delivered. Set MAIL_FROM and one provider." : `Sending with ${MAIL_PROVIDER_NAMES[mail]}.`, keys: keys("MAIL_FROM", "MAIL_PROVIDER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SENDGRID_API_KEY", "SMTP_HOST"), testable: mail !== "outbox", docs: "MAIL_FROM=Cloudesk <hello@yourdomain.com> and RESEND_API_KEY=… (or Postmark, SendGrid, SMTP_*)" },
    { id: "stripe", name: "Stripe Billing", group: "Billing", status: billing.includes("stripe") ? "ready" : status(keys("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO", "STRIPE_PRICE_BUSINESS"), false), detail: "Subscriptions for Pro and Business. Plan limits are only enforced once a billing provider is ready.", keys: keys("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO", "STRIPE_PRICE_BUSINESS"), testable: billing.includes("stripe"), docs: "Webhook: POST {APP_URL}/api/v1/billing/webhooks/stripe" },
    { id: "razorpay", name: "Razorpay Subscriptions", group: "Billing", status: billing.includes("razorpay") ? "ready" : status(keys("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PLAN_PRO", "RAZORPAY_PLAN_BUSINESS"), false), detail: "Subscriptions in India (UPI, cards, netbanking).", keys: keys("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PLAN_PRO", "RAZORPAY_PLAN_BUSINESS"), testable: billing.includes("razorpay"), docs: "Webhook: POST {APP_URL}/api/v1/billing/webhooks/razorpay" },
    { id: "github", name: "Sign in with GitHub", group: "Sign-in", status: status(keys("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"), false), detail: "An OAuth app; callback {APP_URL}/api/v1/auth/github/callback. Workspace SSO (SAML/OIDC) is set up per workspace.", keys: keys("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"), testable: false, docs: "github.com/settings/developers → New OAuth App" },
    { id: "google_mail", name: "Mail: Sign in with Google", group: "Mail", status: status(keys("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"), false), detail: "Lets people connect Gmail and Google Workspace mailboxes by signing in with Google instead of an app password.", keys: keys("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"), testable: false, docs: "Google Cloud console → OAuth client (web); redirect {APP_URL}/api/v1/mail/oauth/callback" },
    { id: "microsoft_mail", name: "Mail: Sign in with Microsoft", group: "Mail", status: status(keys("MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET"), false), detail: "Needed for Outlook.com and Microsoft 365 mailboxes — Microsoft doesn't accept passwords for mail apps.", keys: keys("MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET"), testable: false, docs: "Microsoft Entra → App registrations; redirect {APP_URL}/api/v1/mail/oauth/callback" },
    { id: "anthropic", name: "AI (Claude)", group: "AI", status: has("ANTHROPIC_API_KEY") ? "ready" : "optional", detail: `Copilot, the builder assistant and AI IDE. Monthly budget per workspace: $${cfg("AI_MONTHLY_BUDGET_USD") ?? "20"}. Without a key, built-in rules are used and the UI says so.`, keys: keys("ANTHROPIC_API_KEY", "AI_MONTHLY_BUDGET_USD"), testable: has("ANTHROPIC_API_KEY"), docs: "console.anthropic.com → API keys" },
    { id: "gemini", name: "AI (Gemini, free tier)", group: "AI", status: has("GEMINI_API_KEY") ? "ready" : "optional", detail: "A free Google key for trying the AI features. Every workspace without its own key uses it when no Claude key is set; usage is free but rate-limited by Google.", keys: keys("GEMINI_API_KEY", "GEMINI_MODEL"), testable: has("GEMINI_API_KEY"), docs: "aistudio.google.com/apikey" },
    { id: "voyage", name: "Semantic search (Voyage)", group: "AI", status: has("VOYAGE_API_KEY") ? "ready" : "optional", detail: "Embeddings for the chatbot and search; keyword search works without it.", keys: keys("VOYAGE_API_KEY", "VOYAGE_MODEL"), testable: false, docs: "dash.voyageai.com" },
    { id: "domains", name: "Custom domains", group: "Hosting", status: has("CUSTOM_DOMAIN_CNAME") || has("CUSTOM_DOMAIN_IPV4") ? "ready" : "missing", detail: "The target customers point their DNS at. Put a TLS-terminating proxy (Caddy, Cloudflare, a load balancer with on-demand certificates) in front.", keys: keys("CUSTOM_DOMAIN_CNAME", "CUSTOM_DOMAIN_IPV4"), testable: false, docs: "CUSTOM_DOMAIN_CNAME=sites.yourdomain.com" },
    { id: "jobs", name: "Background worker & schedulers", group: "Hosting", status: switchOn("JOBS_WORKER") ? "ready" : "partial", detail: switchOn("JOBS_WORKER") ? "This server runs the job worker and schedulers. On several servers, run one or two worker nodes and set APP_ROLE=web on the rest." : "The worker is off on this server — make sure a worker node runs it.", keys: keys("APP_ROLE", "JOBS_WORKER", "JOBS_POLL_MS"), testable: false, docs: "APP_ROLE=web on web-only nodes" },
    { id: "docker", name: "Code execution containers", group: "Hosting", status: process.env.EXEC_DOCKER === "on" ? "ready" : "optional", detail: "Python and full Node in the AI IDE run in locked-down containers when enabled.", keys: keys("EXEC_DOCKER", "EXEC_PYTHON_IMAGE", "EXEC_NODE_IMAGE"), testable: false, docs: "EXEC_DOCKER=on on a host with Docker" },
  ];
}

/** Tests one connection live and returns the provider's answer. */
export async function testIntegration(admin: { id: string; email: string }, id: string, f: typeof fetch = fetch) {
  const t0 = Date.now();
  let note: string;
  switch (id) {
    case "database":
      await db.execute(sql`select 1`);
      note = "The database answered.";
      break;
    case "email": {
      if (mailProvider() === "outbox") throw new ApiError("provider_not_configured", "No email provider is set up");
      await sendMail({ to: admin.email, subject: "Test email from the admin console", body: "This is a test from Admin → Integrations. If you can read it, email delivery works." });
      note = `Sent a test email to ${admin.email} — check the inbox (and the outbox for delivery status).`;
      break;
    }
    case "stripe":
    case "razorpay": {
      if (!configuredProviders().includes(id)) throw new ApiError("provider_not_configured", "Not configured");
      const p = await priceFor(id, "pro");
      if (!p) throw new ApiError("provider_error", "The provider didn't return the Pro price — check the price/plan ID");
      note = `Pro is ${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()} per ${p.interval}.`;
      break;
    }
    case "anthropic": {
      const key = cfg("ANTHROPIC_API_KEY");
      if (!key) throw new ApiError("provider_not_configured", "Not configured");
      const r = await f("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new ApiError("provider_error", r.status === 401 ? "The AI key was refused" : `The AI provider said HTTP ${r.status}`);
      note = "The AI key works (listed models — no tokens used).";
      break;
    }
    case "gemini": {
      const key = cfg("GEMINI_API_KEY");
      if (!key) throw new ApiError("provider_not_configured", "Not configured");
      const r = await f("https://generativelanguage.googleapis.com/v1beta/openai/models", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new ApiError("provider_error", r.status === 400 || r.status === 401 || r.status === 403 ? "Google refused the key" : `Google said HTTP ${r.status}`);
      note = "The Gemini key works (listed models — no quota used).";
      break;
    }
    default:
      throw new ApiError("bad_request", "This integration has no live test");
  }
  await audit({ actorId: admin.id, action: "platform.integration_tested", targetType: "integration", targetId: id });
  return { ok: true, note, ms: Date.now() - t0 };
}
