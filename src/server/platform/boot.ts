// Start-up checks for production. Missing essentials stop the server with a
// clear message instead of failing later in confusing ways; weaker settings
// are logged as warnings (and shown on Admin → Go-live).
import { log } from "../log";

const MAIL_PROVIDERS = ["RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SENDGRID_API_KEY", "SMTP_URL"];

export function checkProductionEnv(env: Record<string, string | undefined> = process.env) {
  const fatal: string[] = [];
  const warn: string[] = [];
  if (!env.DATABASE_URL) fatal.push("DATABASE_URL is not set");
  // The same rule the cipher applies (src/server/security/secrets.ts): 32 bytes, base64.
  const key = Buffer.from(env.APP_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) fatal.push("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  const app = env.APP_URL ?? "";
  if (!app) fatal.push("APP_URL is not set (e.g. https://app.yourdomain.com)");
  else if (!app.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(app)) warn.push("APP_URL should use https:// — session cookies and payment callbacks depend on it");
  if (env.RATE_LIMIT_STORE === "memory") warn.push("RATE_LIMIT_STORE=memory: rate limits are per server");
  if (!env.DATABASE_SSL_CA && env.DATABASE_SSL !== "no-verify" && !/sslmode=/.test(env.DATABASE_URL ?? "")) warn.push("DATABASE_URL has no TLS: set DATABASE_SSL_CA to the database's CA bundle (the image ships /app/certs/rds-global-bundle.pem) unless the database is on the same private network");
  if (!env.TRUST_PROXY) warn.push("TRUST_PROXY is not set: client addresses are read from the first X-Forwarded-For entry. Behind a load balancer that appends to the header (AWS ALB, most clouds) set TRUST_PROXY=xff-last, or make the proxy overwrite the header");
  if (!env.MAIL_FROM || !MAIL_PROVIDERS.some((k) => env[k])) warn.push("No email provider in the environment (MAIL_FROM plus RESEND_API_KEY, POSTMARK_SERVER_TOKEN, SENDGRID_API_KEY or SMTP_URL). Unless one is saved in Admin → Integrations, sign-up codes and resets can't be sent");
  if (env.APP_ROLE !== "web" && !env.WORKER_SINGLETON_ACK) warn.push("This is a worker (APP_ROLE unset): run exactly one worker replica; web replicas must set APP_ROLE=web. Set WORKER_SINGLETON_ACK=1 to silence this");
  for (const w of warn) log.warn("production_config", { problem: w });
  if (fatal.length) {
    for (const f of fatal) log.error("production_config", { problem: f });
    throw new Error(`Cloudesk can't start in production: ${fatal.join("; ")}`);
  }
  return { warn };
}
