// Cloudflare, controlled from the platform console (Admin → Security →
// Cloudflare): the zone's status and security settings, "I'm under attack"
// mode, cache purges, IP access rules and custom WAF rules, firewall event
// analytics, copying the app firewall's bans to Cloudflare, and locking the
// origin so only traffic through Cloudflare reaches the app (Cloudflare adds a
// secret header that the app firewall then requires). Uses the v4 REST API and
// the GraphQL analytics API with a scoped API token saved encrypted in the
// console (or the environment). Nothing here is pretended: every result comes
// from Cloudflare, and errors are shown as Cloudflare words them.
import { randomBytes } from "node:crypto";
import { ApiError } from "../http/errors";
import { cfg, saveConfig } from "../platform/config";
import { saveSection, settings } from "../platform/settings";
import { audit } from "../services/audit";

type Fetch = typeof fetch;
const timeout = (init?: RequestInit) => ({ ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
let http: Fetch = (input, init) => fetch(input, timeout(init));
/** Test hook. */
export function setCloudflareHttp(f: Fetch | null) {
  http = f ?? ((input, init) => fetch(input, timeout(init)));
}

const API = "https://api.cloudflare.com/client/v4";
const LOCK_DESC = "Cloudesk origin lock";
export const ORIGIN_HEADER = "x-cloudesk-origin";

const token = () => cfg("CLOUDFLARE_API_TOKEN") ?? "";
const zone = () => cfg("CLOUDFLARE_ZONE_ID") ?? "";
export const cloudflareConfigured = () => !!token() && /^[a-f0-9]{32}$/.test(zone());

type Envelope<T> = { success: boolean; errors?: { code: number; message: string }[]; result: T; result_info?: Record<string, number> };

async function cf<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  if (!cloudflareConfigured()) throw new ApiError("bad_request", "Connect Cloudflare first (API token and zone ID).");
  const res = await http(`${API}${path}`, { method: init.method ?? (init.json ? "POST" : "GET"), headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const body = (await res.json().catch(() => ({ success: false, errors: [{ code: res.status, message: `HTTP ${res.status}` }] }))) as Envelope<T>;
  if (!res.ok || !body.success) throw new ApiError("provider_error", `Cloudflare: ${body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`);
  return body.result;
}

// ── Status and settings ─────────────────────────────────────────────────────

/** The settings the console shows and may change, with the values Cloudflare accepts. */
export const CF_SETTINGS: Record<string, { label: string; values: string[] }> = {
  security_level: { label: "Security level", values: ["essentially_off", "low", "medium", "high", "under_attack"] },
  ssl: { label: "SSL/TLS mode", values: ["off", "flexible", "full", "strict"] },
  always_use_https: { label: "Always use HTTPS", values: ["on", "off"] },
  automatic_https_rewrites: { label: "Automatic HTTPS rewrites", values: ["on", "off"] },
  min_tls_version: { label: "Minimum TLS version", values: ["1.0", "1.1", "1.2", "1.3"] },
  tls_1_3: { label: "TLS 1.3", values: ["on", "off", "zrt"] },
  browser_check: { label: "Browser integrity check", values: ["on", "off"] },
  email_obfuscation: { label: "Email address obfuscation", values: ["on", "off"] },
  hotlink_protection: { label: "Hotlink protection", values: ["on", "off"] },
  development_mode: { label: "Development mode (bypass cache)", values: ["on", "off"] },
  challenge_ttl: { label: "Challenge passage (seconds)", values: ["300", "900", "1800", "2700", "3600", "7200", "10800", "14400", "28800", "57600", "86400"] },
};

export async function cloudflareStatus() {
  if (!cloudflareConfigured()) return { configured: false as const, tokenSet: !!token(), zoneSet: !!zone() };
  const [verify, z, list] = await Promise.all([
    cf<{ status: string; expires_on?: string }>("/user/tokens/verify").catch((e: Error) => ({ status: `error: ${e.message}` })),
    cf<{ id: string; name: string; status: string; paused: boolean; plan: { name: string }; name_servers: string[]; original_name_servers?: string[] }>(`/zones/${zone()}`),
    cf<{ id: string; value: unknown; editable: boolean }[]>(`/zones/${zone()}/settings`),
  ]);
  const settingsNow = Object.fromEntries(list.filter((s) => s.id in CF_SETTINGS).map((s) => [s.id, { value: String(typeof s.value === "object" ? JSON.stringify(s.value) : s.value), editable: s.editable }]));
  const lock = await originLockRule().catch(() => null);
  const fw = (await settings()).firewall;
  return {
    configured: true as const,
    token: verify,
    zone: { id: z.id, name: z.name, status: z.status, paused: z.paused, plan: z.plan?.name ?? "", nameServers: z.name_servers ?? [] },
    settings: settingsNow,
    originLock: { cloudflareRule: !!lock, secretSet: !!cfg("CLOUDFLARE_ORIGIN_SECRET"), enforced: fw.requireCloudflare, trustProxy: fw.trustProxy },
    syncBans: cfg("CLOUDFLARE_SYNC_BANS") === "on",
  };
}

export async function setCloudflareSetting(adminId: string, id: string, value: string) {
  const def = CF_SETTINGS[id];
  if (!def) throw new ApiError("validation_failed", "That setting can't be changed from here");
  if (!def.values.includes(value)) throw new ApiError("validation_failed", `${def.label}: choose one of ${def.values.join(", ")}`);
  const v = id === "challenge_ttl" ? Number(value) : value;
  const r = await cf<{ id: string; value: unknown }>(`/zones/${zone()}/settings/${id}`, { method: "PATCH", json: { value: v } });
  await audit({ actorId: adminId, action: "platform.cloudflare_setting", targetType: "cloudflare", targetId: id, metadata: { value } });
  return r;
}

export async function purgeCache(adminId: string, files: string[] | null) {
  if (files && (!files.length || files.length > 30 || files.some((f) => !/^https?:\/\/[^\s]+$/.test(f)))) throw new ApiError("validation_failed", "Give up to 30 full URLs, or purge everything");
  await cf(`/zones/${zone()}/purge_cache`, { json: files ? { files } : { purge_everything: true } });
  await audit({ actorId: adminId, action: "platform.cloudflare_purge", targetType: "cloudflare", metadata: { everything: !files, files: files?.length ?? 0 } });
}

// ── IP access rules ─────────────────────────────────────────────────────────

const MODES = ["block", "challenge", "js_challenge", "managed_challenge", "whitelist"] as const;
const TARGETS = ["ip", "ip6", "ip_range", "country", "asn"] as const;

export async function accessRules() {
  return cf<{ id: string; mode: string; notes: string; configuration: { target: string; value: string }; created_on: string }[]>(`/zones/${zone()}/firewall/access_rules/rules?per_page=100&order=created_on&direction=desc`);
}

export async function addAccessRule(adminId: string, r: { mode: string; target: string; value: string; notes: string }) {
  if (!(MODES as readonly string[]).includes(r.mode) || !(TARGETS as readonly string[]).includes(r.target)) throw new ApiError("validation_failed", "Choose an action and what it applies to");
  if (!r.value.trim() || r.value.length > 60) throw new ApiError("validation_failed", "Enter the address, range, country code or ASN");
  const out = await cf<{ id: string }>(`/zones/${zone()}/firewall/access_rules/rules`, { json: { mode: r.mode, configuration: { target: r.target, value: r.value.trim() }, notes: r.notes.slice(0, 200) } });
  await audit({ actorId: adminId, action: "platform.cloudflare_access_rule", targetType: "cloudflare", targetId: out.id, metadata: { mode: r.mode, target: r.target, value: r.value } });
  return out;
}

export async function deleteAccessRule(adminId: string, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new ApiError("validation_failed", "Unknown rule");
  await cf(`/zones/${zone()}/firewall/access_rules/rules/${id}`, { method: "DELETE" });
  await audit({ actorId: adminId, action: "platform.cloudflare_access_rule_deleted", targetType: "cloudflare", targetId: id });
}

/** Copying app-firewall bans to Cloudflare stops them at the edge too (when switched on). */
export const cloudflareSyncOn = async () => cloudflareConfigured() && cfg("CLOUDFLARE_SYNC_BANS") === "on";

export async function cloudflareBlockIp(ip: string, note: string) {
  const r = await cf<{ id: string }>(`/zones/${zone()}/firewall/access_rules/rules`, { json: { mode: "block", configuration: { target: ip.includes(":") ? "ip6" : "ip", value: ip }, notes: note.slice(0, 200) } });
  return r.id;
}
export async function cloudflareUnblock(id: string) {
  await cf(`/zones/${zone()}/firewall/access_rules/rules/${id}`, { method: "DELETE" });
}

// ── Custom WAF rules (rulesets: http_request_firewall_custom) ────────────────

type Ruleset = { id: string; rules?: { id: string; description?: string; expression: string; action: string; enabled: boolean; action_parameters?: unknown }[] };

async function entrypoint(phase: string): Promise<Ruleset | null> {
  try {
    return await cf<Ruleset>(`/zones/${zone()}/rulesets/phases/${phase}/entrypoint`);
  } catch (e) {
    if (e instanceof ApiError && /not found|could not find|10003/i.test(e.message)) return null;
    throw e;
  }
}

export async function customRules() {
  return (await entrypoint("http_request_firewall_custom"))?.rules ?? [];
}

const CUSTOM_ACTIONS = ["block", "managed_challenge", "js_challenge", "challenge", "log", "skip"];

export async function addCustomRule(adminId: string, r: { description: string; expression: string; action: string }) {
  if (!CUSTOM_ACTIONS.includes(r.action)) throw new ApiError("validation_failed", "Choose an action");
  if (!r.expression.trim() || r.expression.length > 4000) throw new ApiError("validation_failed", "Enter a rule expression, e.g. (http.request.uri.path contains \"/wp-admin\")");
  const rule = { description: r.description.slice(0, 200), expression: r.expression.trim(), action: r.action, ...(r.action === "skip" ? { action_parameters: { ruleset: "current" } } : {}) };
  const ep = await entrypoint("http_request_firewall_custom");
  const out = ep ? await cf<Ruleset>(`/zones/${zone()}/rulesets/${ep.id}/rules`, { json: rule }) : await cf<Ruleset>(`/zones/${zone()}/rulesets/phases/http_request_firewall_custom/entrypoint`, { method: "PUT", json: { rules: [rule] } });
  await audit({ actorId: adminId, action: "platform.cloudflare_custom_rule", targetType: "cloudflare", metadata: { description: r.description, action: r.action } });
  return out.rules ?? [];
}

export async function deleteCustomRule(adminId: string, ruleId: string) {
  if (!/^[a-f0-9]{32}$/.test(ruleId)) throw new ApiError("validation_failed", "Unknown rule");
  const ep = await entrypoint("http_request_firewall_custom");
  if (!ep) throw new ApiError("not_found", "No custom rules");
  await cf(`/zones/${zone()}/rulesets/${ep.id}/rules/${ruleId}`, { method: "DELETE" });
  await audit({ actorId: adminId, action: "platform.cloudflare_custom_rule_deleted", targetType: "cloudflare", targetId: ruleId });
}

// ── Firewall events (GraphQL analytics) ─────────────────────────────────────

export async function cloudflareEvents(hours = 24) {
  const since = new Date(Date.now() - Math.min(72, Math.max(1, hours)) * 3_600_000).toISOString();
  const query = `query($zone: String!, $since: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
    events: firewallEventsAdaptive(filter: { datetime_geq: $since }, limit: 50, orderBy: [datetime_DESC]) { action clientIP clientCountryName clientRequestPath clientRequestHTTPMethodName datetime source ruleId userAgent }
    byAction: firewallEventsAdaptiveGroups(filter: { datetime_geq: $since }, limit: 20) { count dimensions { action source } }
    byCountry: firewallEventsAdaptiveGroups(filter: { datetime_geq: $since }, limit: 10, orderBy: [count_DESC]) { count dimensions { clientCountryName } }
  } } }`;
  if (!cloudflareConfigured()) throw new ApiError("bad_request", "Connect Cloudflare first (API token and zone ID).");
  const res = await http(`${API}/graphql`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: { zone: zone(), since } }) });
  const body = (await res.json().catch(() => ({}))) as { data?: { viewer?: { zones?: { events: unknown[]; byAction: unknown[]; byCountry: unknown[] }[] } }; errors?: { message: string }[] };
  if (body.errors?.length) throw new ApiError("provider_error", `Cloudflare analytics: ${body.errors.map((e) => e.message).join("; ")}`);
  const z = body.data?.viewer?.zones?.[0];
  return { since, events: z?.events ?? [], byAction: z?.byAction ?? [], byCountry: z?.byCountry ?? [] };
}

// ── Locking the origin to Cloudflare ────────────────────────────────────────

async function originLockRule() {
  const ep = await entrypoint("http_request_late_transform");
  return ep?.rules?.find((r) => r.description === LOCK_DESC) ?? null;
}

/**
 * Cloudflare adds a secret header to every request it forwards; the app
 * firewall can then refuse anything without it (someone who found the server's
 * own address can't go around Cloudflare). Turning on the requirement is a
 * separate step, once requests are seen arriving with the header.
 */
export async function lockOrigin(adminId: string) {
  const secret = randomBytes(32).toString("hex");
  const ep = await entrypoint("http_request_late_transform");
  const keep = (ep?.rules ?? []).filter((r) => r.description !== LOCK_DESC).map(({ id: _id, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
  const ours = { description: LOCK_DESC, expression: "true", action: "rewrite", enabled: true, action_parameters: { headers: { [ORIGIN_HEADER]: { operation: "set", value: secret } } } };
  // Save the secret first: the header must never arrive before the app knows it.
  await saveConfig(adminId, { CLOUDFLARE_ORIGIN_SECRET: secret });
  await cf(`/zones/${zone()}/rulesets/phases/http_request_late_transform/entrypoint`, { method: "PUT", json: { rules: [...keep, ours] } });
  await audit({ actorId: adminId, action: "platform.cloudflare_origin_locked", targetType: "cloudflare" });
}

export async function unlockOrigin(adminId: string) {
  const fw = (await settings()).firewall;
  // Stop requiring the header before removing it, so nothing is locked out in between.
  if (fw.requireCloudflare) await saveSection(adminId, "firewall", { ...fw, requireCloudflare: false });
  const ep = await entrypoint("http_request_late_transform");
  if (ep?.rules?.some((r) => r.description === LOCK_DESC)) {
    const keep = ep.rules.filter((r) => r.description !== LOCK_DESC).map(({ id: _id, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
    await cf(`/zones/${zone()}/rulesets/phases/http_request_late_transform/entrypoint`, { method: "PUT", json: { rules: keep } });
  }
  await saveConfig(adminId, { CLOUDFLARE_ORIGIN_SECRET: null });
  await audit({ actorId: adminId, action: "platform.cloudflare_origin_unlocked", targetType: "cloudflare" });
}
