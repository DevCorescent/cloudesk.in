import { clearCatalogCache, clearEntitlement } from "@/server/billing/subscriptions";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { loadConfig } from "@/server/platform/config";
import { clearSettingsCache } from "@/server/platform/settings";
import { resetRateLimits } from "@/server/security/rate-limit";

export const ORIGIN = "http://localhost:3000";

export async function resetDb() {
  resetRateLimits();
  clearSettingsCache();
  // Truncating ~400 tables can outlast the app's 15 s statement timeout on a busy machine.
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = 0`);
    await tx.execute(sql`truncate table users, organizations, sessions, auth_tokens, outbound_emails, audit_logs, platform_settings, platform_config, rate_limits, request_stats, platform_snapshots, email_otps, plan_catalog, firewall_events, firewall_bans, po_contacts, po_templates, po_funnels, po_enrollments, po_sends, po_events cascade`);
  });
  clearCatalogCache();
  clearEntitlement();
  await loadConfig();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;

/** Invokes a route handler the way Next.js would. */
export async function call(handler: Handler, opts: { method?: string; path?: string; body?: unknown; cookie?: string; params?: Record<string, string | string[]>; origin?: string | null; headers?: Record<string, string> } = {}) {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { "user-agent": "vitest", ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin !== null && method !== "GET") headers.origin = opts.origin ?? ORIGIN;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${ORIGIN}${opts.path ?? "/api"}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests assert on arbitrary response shapes
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

export function cookieFrom(res: { headers: Headers }) {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0];
}

export async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (done(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}
