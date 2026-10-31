// Apps: the plugin system. An organization registers an app by its manifest;
// installing it into a project creates a scoped API key and an event
// subscription for the app, then hands both to the app's installUrl in a
// signed request. If the hand-off fails, the install is rolled back.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { API_SCOPES, EVENT_TYPES } from "@/lib/platform/events";
import { ApiError, notFound } from "../http/errors";
import { safeRequest, validateUrl, type SafeResponse } from "../net/safe-fetch";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { randomToken } from "../security/tokens";
import { audit } from "../services/audit";
import { appUrl } from "../services/mail";
import { createEndpoint, signPayload } from "../events/webhooks";
import { createApiKey } from "./api-keys";

const httpsUrl = z.string().url().max(500).refine((u) => /^https:\/\//i.test(u) || (process.env.NODE_ENV !== "production" && /^http:\/\//i.test(u)), "Must be an https URL");

export const manifestSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Lowercase letters, numbers and dashes"),
  version: z.string().max(20).default("1.0.0"),
  description: z.string().trim().max(500).default(""),
  author: z.string().trim().max(80).default(""),
  homepage: httpsUrl.optional(),
  icon: z.string().max(4).default("🧩"),
  scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length).default([]),
  events: z.array(z.enum(EVENT_TYPES)).max(EVENT_TYPES.length).default([]),
  /** Receives the project's events (signed with the install's webhook secret). */
  webhookUrl: httpsUrl.optional(),
  /** Receives the API key and webhook secret when installed (signed with the app secret). */
  installUrl: httpsUrl.optional(),
  uninstallUrl: httpsUrl.optional(),
  configFields: z
    .array(
      z.object({
        key: z.string().regex(/^[a-zA-Z]\w{0,39}$/),
        label: z.string().max(80),
        type: z.enum(["text", "secret", "select", "boolean"]),
        required: z.boolean().default(false),
        options: z.array(z.string().max(80)).max(30).optional(),
        help: z.string().max(200).optional(),
      }),
    )
    .max(15)
    .default([]),
});
export type AppManifest = z.infer<typeof manifestSchema>;

type Http = (url: string, opts: { method: string; headers: Record<string, string>; body: string }) => Promise<SafeResponse>;
let http: Http = (url, opts) => safeRequest(url, { ...opts, maxBytes: 8000, timeoutMs: 10_000 });
/** Test hook. */
export function setAppHttp(fn: Http | null) {
  http = fn ?? ((url, opts) => safeRequest(url, { ...opts, maxBytes: 8000, timeoutMs: 10_000 }));
}

function parseManifest(raw: unknown) {
  const r = manifestSchema.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", "The manifest is invalid", Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "manifest", [i.message]])));
  const m = r.data;
  for (const u of [m.webhookUrl, m.installUrl, m.uninstallUrl, m.homepage]) if (u) validateUrl(u);
  if (m.events.length && !m.webhookUrl) throw new ApiError("validation_failed", "Apps that subscribe to events need a webhookUrl", { webhookUrl: ["Required with events"] });
  if (m.scopes.length && !m.installUrl) throw new ApiError("validation_failed", "Apps that use the API need an installUrl to receive their key", { installUrl: ["Required with scopes"] });
  return m;
}

export async function registerApp(orgId: string, userId: string, raw: unknown) {
  const manifest = parseManifest(raw);
  const secret = `appsec_${randomToken(24)}`;
  const [a] = await db.insert(schema.apps).values({ orgId, slug: manifest.slug, manifest, secretEnc: encryptSecret(secret), createdBy: userId }).onConflictDoNothing().returning();
  if (!a) throw new ApiError("conflict", `Your organization already has an app called "${manifest.slug}"`);
  await audit({ orgId, actorId: userId, action: "app.registered", targetType: "app", targetId: a.id, metadata: { slug: manifest.slug } });
  return { app: a, secret };
}

export async function updateApp(orgId: string, appId: string, raw: unknown) {
  const manifest = parseManifest(raw);
  const r = await db.update(schema.apps).set({ manifest, updatedAt: new Date() }).where(and(eq(schema.apps.id, appId), eq(schema.apps.orgId, orgId))).returning({ id: schema.apps.id });
  if (!r.length) throw notFound("App");
}

export async function deleteApp(orgId: string, userId: string, appId: string) {
  // The app must be this workspace's before anything of its installs is torn down.
  const [own] = await db.select({ id: schema.apps.id }).from(schema.apps).where(and(eq(schema.apps.id, appId), eq(schema.apps.orgId, orgId)));
  if (!own) throw notFound("App");
  const installs = await db.select({ id: schema.appInstalls.id, projectId: schema.appInstalls.projectId }).from(schema.appInstalls).where(eq(schema.appInstalls.appId, appId));
  for (const i of installs) await removeInstallResources(i.id);
  const r = await db.delete(schema.apps).where(and(eq(schema.apps.id, appId), eq(schema.apps.orgId, orgId))).returning({ id: schema.apps.id });
  if (!r.length) throw notFound("App");
  await audit({ orgId, actorId: userId, action: "app.deleted", targetType: "app", targetId: appId });
}

export async function listApps(orgId: string, projectId?: string) {
  const apps = await db.select().from(schema.apps).where(eq(schema.apps.orgId, orgId));
  const installs = projectId && apps.length ? await db.select().from(schema.appInstalls).where(and(eq(schema.appInstalls.projectId, projectId), inArray(schema.appInstalls.appId, apps.map((a) => a.id)))) : [];
  return apps.map((a) => ({ id: a.id, manifest: a.manifest as AppManifest, createdAt: a.createdAt, install: installs.find((i) => i.appId === a.id) ? { id: installs.find((i) => i.appId === a.id)!.id, scopes: installs.find((i) => i.appId === a.id)!.scopes, createdAt: installs.find((i) => i.appId === a.id)!.createdAt } : null }));
}

function cleanConfig(m: AppManifest, raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of m.configFields) {
    const v = raw[f.key];
    if (v === undefined || v === "") {
      if (f.required) throw new ApiError("validation_failed", `${f.label} is required`, { [f.key]: ["Required"] });
      continue;
    }
    if (f.type === "boolean") out[f.key] = !!v;
    else if (f.type === "select") {
      if (!f.options?.includes(String(v))) throw new ApiError("validation_failed", `${f.label}: choose one of the options`, { [f.key]: ["Invalid"] });
      out[f.key] = String(v);
    } else out[f.key] = String(v).slice(0, 2000);
  }
  return out;
}

async function removeInstallResources(installId: string) {
  await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.appInstallId, installId));
  await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.appInstallId, installId));
  await db.delete(schema.appInstalls).where(eq(schema.appInstalls.id, installId));
}

/** POSTs a signed message to the app. */
async function tellApp(app: typeof schema.apps.$inferSelect, url: string, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return http(url, { method: "POST", headers: { "Content-Type": "application/json", "CC-Signature": signPayload(decryptSecret(app.secretEnc), raw), "CC-Event": String(body.type) }, body: raw });
}

export async function installApp(project: { id: string; orgId: string; name: string }, userId: string, appId: string, rawConfig: Record<string, unknown>) {
  const [app] = await db.select().from(schema.apps).where(and(eq(schema.apps.id, appId), eq(schema.apps.orgId, project.orgId)));
  if (!app) throw notFound("App");
  const m = app.manifest as AppManifest;
  const config = cleanConfig(m, rawConfig);
  const [install] = await db.insert(schema.appInstalls).values({ appId: app.id, projectId: project.id, scopes: m.scopes, config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, m.configFields.find((f) => f.key === k)?.type === "secret" ? encryptSecret(String(v)) : v])), installedBy: userId }).onConflictDoNothing().returning();
  if (!install) throw new ApiError("conflict", `${m.name} is already installed in this project`);
  try {
    const key = m.scopes.length ? await createApiKey(project.id, { name: `App: ${m.name}`, scopes: m.scopes }, userId, install.id) : null;
    const hook = m.events.length && m.webhookUrl ? await createEndpoint(project.id, { url: m.webhookUrl, events: m.events, description: `App: ${m.name}` }, install.id) : null;
    if (m.installUrl) {
      const r = await tellApp(app, m.installUrl, { type: "app.installed", installId: install.id, projectId: project.id, projectName: project.name, apiBase: appUrl("/api/public/v1"), apiKey: key?.key ?? null, scopes: m.scopes, webhookSecret: hook?.secret ?? null, events: m.events, config });
      if (r.status < 200 || r.status >= 300) throw new ApiError("provider_error", `${m.name} didn't accept the install (HTTP ${r.status})`);
    }
  } catch (e) {
    await removeInstallResources(install.id);
    throw e instanceof ApiError ? e : new ApiError("provider_error", `Couldn't reach ${m.name} to finish installing: ${(e as Error).message}`);
  }
  await audit({ orgId: project.orgId, actorId: userId, action: "app.installed", targetType: "app", targetId: app.id, metadata: { projectId: project.id, scopes: m.scopes } });
  return { installId: install.id };
}

export async function uninstallApp(project: { id: string; orgId: string }, userId: string, appId: string) {
  const [row] = await db.select({ install: schema.appInstalls, app: schema.apps }).from(schema.appInstalls).innerJoin(schema.apps, eq(schema.apps.id, schema.appInstalls.appId)).where(and(eq(schema.appInstalls.appId, appId), eq(schema.appInstalls.projectId, project.id)));
  if (!row) throw notFound("Installed app");
  await removeInstallResources(row.install.id);
  const m = row.app.manifest as AppManifest;
  // Best effort: access is already revoked whether or not the app hears about it.
  if (m.uninstallUrl) await tellApp(row.app, m.uninstallUrl, { type: "app.uninstalled", installId: row.install.id, projectId: project.id }).catch(() => null);
  await audit({ orgId: project.orgId, actorId: userId, action: "app.uninstalled", targetType: "app", targetId: appId, metadata: { projectId: project.id } });
}

export async function rotateAppSecret(orgId: string, appId: string) {
  const secret = `appsec_${randomToken(24)}`;
  const r = await db.update(schema.apps).set({ secretEnc: encryptSecret(secret), updatedAt: new Date() }).where(and(eq(schema.apps.id, appId), eq(schema.apps.orgId, orgId))).returning({ id: schema.apps.id });
  if (!r.length) throw notFound("App");
  return { secret };
}
