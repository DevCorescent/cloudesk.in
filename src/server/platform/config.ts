// Integration settings that platform owners can set from the admin console
// instead of the server environment: email, billing, GitHub sign-in, AI and
// search keys. Values are encrypted with APP_ENCRYPTION_KEY, never sent back
// to the browser, and an environment variable of the same name always wins.
// Bootstrap settings (database, encryption key, public address, custom-domain
// target read by the edge proxy) stay environment-only.
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { audit } from "../services/audit";

export type ConfigKey = { key: string; label: string; secret: boolean; pattern?: RegExp; hint?: string; options?: string[] };

/** Everything that may be set from the console, by integration. */
export const CONFIG_GROUPS: Record<string, ConfigKey[]> = {
  email: [
    { key: "MAIL_FROM", label: "From address", secret: false, pattern: /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/, hint: "hello@yourdomain.com" },
    { key: "MAIL_PROVIDER", label: "Provider", secret: false, pattern: /^(resend|postmark|sendgrid|smtp|outbox)$/, options: ["resend", "postmark", "sendgrid", "smtp"] },
    { key: "RESEND_API_KEY", label: "Resend API key", secret: true, pattern: /^re_[A-Za-z0-9_]{10,}$/ },
    { key: "POSTMARK_SERVER_TOKEN", label: "Postmark server token", secret: true },
    { key: "POSTMARK_STREAM", label: "Postmark message stream", secret: false, hint: "outbound" },
    { key: "SENDGRID_API_KEY", label: "SendGrid API key", secret: true, pattern: /^SG\.[A-Za-z0-9_.-]{20,}$/ },
    { key: "SMTP_HOST", label: "SMTP host", secret: false },
    { key: "SMTP_PORT", label: "SMTP port", secret: false, pattern: /^\d{2,5}$/ },
    { key: "SMTP_USER", label: "SMTP user", secret: false },
    { key: "SMTP_PASS", label: "SMTP password", secret: true },
    { key: "SMTP_SECURE", label: "SMTP implicit TLS (true for port 465)", secret: false, pattern: /^(true|false)$/, options: ["false", "true"] },
  ],
  stripe: [
    { key: "STRIPE_SECRET_KEY", label: "Secret key", secret: true, pattern: /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/ },
    { key: "STRIPE_WEBHOOK_SECRET", label: "Webhook signing secret", secret: true, pattern: /^whsec_[A-Za-z0-9]{10,}$/ },
    { key: "STRIPE_PRICE_PRO", label: "Price ID for Pro", secret: false, pattern: /^price_[A-Za-z0-9]{6,}$/ },
    { key: "STRIPE_PRICE_BUSINESS", label: "Price ID for Business", secret: false, pattern: /^price_[A-Za-z0-9]{6,}$/ },
  ],
  razorpay: [
    { key: "RAZORPAY_KEY_ID", label: "Key ID", secret: false, pattern: /^rzp_(live|test)_[A-Za-z0-9]{6,}$/ },
    { key: "RAZORPAY_KEY_SECRET", label: "Key secret", secret: true },
    { key: "RAZORPAY_WEBHOOK_SECRET", label: "Webhook secret", secret: true },
    { key: "RAZORPAY_PLAN_PRO", label: "Plan ID for Pro", secret: false, pattern: /^plan_[A-Za-z0-9]{6,}$/ },
    { key: "RAZORPAY_PLAN_BUSINESS", label: "Plan ID for Business", secret: false, pattern: /^plan_[A-Za-z0-9]{6,}$/ },
  ],
  github: [
    { key: "GITHUB_CLIENT_ID", label: "Client ID", secret: false },
    { key: "GITHUB_CLIENT_SECRET", label: "Client secret", secret: true },
  ],
  google_mail: [
    { key: "GOOGLE_OAUTH_CLIENT_ID", label: "OAuth client ID", secret: false, pattern: /^[\w-]+\.apps\.googleusercontent\.com$/, hint: "1234-abc.apps.googleusercontent.com" },
    { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "OAuth client secret", secret: true },
  ],
  microsoft_mail: [
    { key: "MICROSOFT_OAUTH_CLIENT_ID", label: "Application (client) ID", secret: false, pattern: /^[0-9a-f-]{36}$/i },
    { key: "MICROSOFT_OAUTH_CLIENT_SECRET", label: "Client secret value", secret: true },
  ],
  anthropic: [
    { key: "ANTHROPIC_API_KEY", label: "API key", secret: true, pattern: /^sk-ant-[A-Za-z0-9_-]{10,}$/ },
    { key: "AI_MONTHLY_BUDGET_USD", label: "Monthly AI budget per workspace (USD)", secret: false, pattern: /^\d{1,6}(\.\d{1,2})?$/ },
  ],
  cloudflare: [
    { key: "CLOUDFLARE_API_TOKEN", label: "API token (Zone: Read, Zone Settings: Edit, Firewall Services: Edit, Cache Purge, Zone WAF: Edit, Transform Rules: Edit, Analytics: Read)", secret: true, pattern: /^[A-Za-z0-9_-]{30,80}$/ },
    { key: "CLOUDFLARE_ZONE_ID", label: "Zone ID", secret: false, pattern: /^[a-f0-9]{32}$/, hint: "32 hex characters, from the zone's Overview page" },
    { key: "CLOUDFLARE_ORIGIN_SECRET", label: "Origin lock secret (set by “Lock origin”)", secret: true, pattern: /^[a-f0-9]{64}$/ },
    { key: "CLOUDFLARE_SYNC_BANS", label: "Copy firewall bans to Cloudflare", secret: false, pattern: /^(on|off)$/, options: ["off", "on"] },
  ],
  voyage: [
    { key: "VOYAGE_API_KEY", label: "API key", secret: true },
    { key: "VOYAGE_MODEL", label: "Model", secret: false, hint: "voyage-3.5-lite" },
  ],
};
const ALL = new Map(Object.values(CONFIG_GROUPS).flat().map((k) => [k.key, k]));

const store = globalThis as unknown as { __platformConfig?: { at: number; values: Map<string, string> } };

/** A setting: the environment variable if set, else the value saved in the console. */
export function cfg(key: string): string | undefined {
  const env = process.env[key];
  if (env !== undefined && env !== "") return env;
  return store.__platformConfig?.values.get(key);
}

export const configSource = (key: string): "env" | "console" | null => (process.env[key] ? "env" : store.__platformConfig?.values.has(key) ? "console" : null);

/** Loads console-saved settings into this server's memory (at start-up, every 30 s, and after a save). */
export async function loadConfig(retry = true): Promise<void> {
  try {
    const rows = await db.select().from(schema.platformConfig);
    const values = new Map<string, string>();
    for (const r of rows) {
      try {
        values.set(r.key, decryptSecret(r.valueEnc));
      } catch {
        log.error("platform_config_unreadable", { key: r.key });
      }
    }
    store.__platformConfig = { at: Date.now(), values };
  } catch (e) {
    // A database that scales to zero (Neon's free tier) can refuse the first
    // connection while it wakes up: try once more before giving up.
    if (retry) {
      await new Promise((r) => setTimeout(r, 1500));
      return loadConfig(false);
    }
    log.error("platform_config_load_failed", { error: String(e), cause: String((e as { cause?: unknown }).cause ?? "") });
  }
}

/** Saves or clears settings. Values for keys set in the environment are refused (the environment would win anyway). */
export async function saveConfig(adminId: string, raw: unknown) {
  if (!raw || typeof raw !== "object") throw new ApiError("validation_failed", "Send the settings to save");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.length > 30) throw new ApiError("validation_failed", "Send between 1 and 30 settings");
  for (const [key, v] of entries) {
    const def = ALL.get(key);
    if (!def) throw new ApiError("validation_failed", `${key} can't be set from the console`);
    if (process.env[key]) throw new ApiError("conflict", `${key} is set in the server environment, which takes precedence — change it there`);
    if (v !== null && (typeof v !== "string" || v.trim().length === 0 || v.length > 2000)) throw new ApiError("validation_failed", `${def.label}: enter a value, or clear it`);
    if (typeof v === "string" && def.pattern && !def.pattern.test(v.trim())) throw new ApiError("validation_failed", `${def.label} doesn't look right${def.hint ? ` — e.g. ${def.hint}` : ""}`);
  }
  const clear = entries.filter(([, v]) => v === null).map(([k]) => k);
  if (clear.length) await db.delete(schema.platformConfig).where(inArray(schema.platformConfig.key, clear));
  for (const [key, v] of entries) {
    if (v === null) continue;
    const valueEnc = encryptSecret(String(v).trim());
    await db.insert(schema.platformConfig).values({ key, valueEnc, updatedBy: adminId }).onConflictDoUpdate({ target: schema.platformConfig.key, set: { valueEnc, updatedBy: adminId, updatedAt: new Date() } });
  }
  // Only key names are recorded — never values.
  await audit({ actorId: adminId, action: "platform.config_saved", targetType: "platform_config", metadata: { set: entries.filter(([, v]) => v !== null).map(([k]) => k), cleared: clear } });
  await loadConfig();
}

/** What the console may show: for each key, where it's set and (for non-secrets) its value. */
export async function configView() {
  const rows = await db.select({ key: schema.platformConfig.key, updatedAt: schema.platformConfig.updatedAt, by: schema.users.email }).from(schema.platformConfig).leftJoin(schema.users, eq(schema.users.id, schema.platformConfig.updatedBy));
  const meta = new Map(rows.map((r) => [r.key, r]));
  return Object.fromEntries(
    Object.entries(CONFIG_GROUPS).map(([group, keys]) => [
      group,
      keys.map((k) => {
        const source = configSource(k.key);
        const m = meta.get(k.key);
        return { key: k.key, label: k.label, secret: k.secret, hint: k.hint ?? "", options: k.options ?? null, source, value: !k.secret && source ? cfg(k.key) ?? "" : "", updatedAt: m?.updatedAt ?? null, updatedBy: m?.by ?? null };
      }),
    ]),
  );
}
