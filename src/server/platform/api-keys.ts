// Project API keys for the public REST API. The key is shown once; only its
// SHA-256 hash is stored. Each key has explicit scopes.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { API_SCOPES, type ApiScope } from "@/lib/platform/events";
import { ApiError, notFound } from "../http/errors";
import { randomToken, sha256 } from "../security/tokens";

export const MAX_KEYS = 25;

export function checkScopes(scopes: string[]): ApiScope[] {
  const bad = scopes.filter((s) => !API_SCOPES.includes(s as ApiScope));
  if (bad.length) throw new ApiError("validation_failed", `Unknown scopes: ${bad.join(", ")}`);
  if (!scopes.length) throw new ApiError("validation_failed", "Choose at least one permission");
  return [...new Set(scopes)] as ApiScope[];
}

export async function createApiKey(projectId: string, input: { name: string; scopes: string[] }, userId: string | null, appInstallId: string | null = null) {
  const scopes = checkScopes(input.scopes);
  const live = await db.select({ id: schema.apiKeys.id }).from(schema.apiKeys).where(and(eq(schema.apiKeys.projectId, projectId), isNull(schema.apiKeys.revokedAt)));
  if (live.length >= MAX_KEYS) throw new ApiError("conflict", `A project can have up to ${MAX_KEYS} active keys`);
  const key = `cc_live_${randomToken(30)}`;
  const [row] = await db.insert(schema.apiKeys).values({ projectId, name: input.name.trim().slice(0, 80) || "API key", prefix: key.slice(0, 14), keyHash: sha256(key), scopes, createdBy: userId, appInstallId }).returning();
  return { key, row };
}

export async function listApiKeys(projectId: string) {
  return db
    .select({ id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix, scopes: schema.apiKeys.scopes, appInstallId: schema.apiKeys.appInstallId, lastUsedAt: schema.apiKeys.lastUsedAt, revokedAt: schema.apiKeys.revokedAt, createdAt: schema.apiKeys.createdAt })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.projectId, projectId))
    .orderBy(desc(schema.apiKeys.createdAt));
}

export async function revokeApiKey(projectId: string, id: string) {
  const r = await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.projectId, projectId), isNull(schema.apiKeys.revokedAt))).returning({ id: schema.apiKeys.id });
  if (!r.length) throw notFound("API key");
}

/** Resolves a bearer key to its project and scopes, or null. */
export async function resolveApiKey(raw: string | null) {
  if (!raw || !/^cc_live_[\w-]{30,60}$/.test(raw)) return null;
  const [row] = await db
    .select({ key: schema.apiKeys, project: { id: schema.projects.id, orgId: schema.projects.orgId, name: schema.projects.name, slug: schema.projects.slug, archivedAt: schema.projects.archivedAt, productionDeploymentId: schema.projects.productionDeploymentId } })
    .from(schema.apiKeys)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.apiKeys.projectId))
    .where(and(eq(schema.apiKeys.keyHash, sha256(raw)), isNull(schema.apiKeys.revokedAt)));
  if (!row || row.project.archivedAt) return null;
  // Record use at most once a minute per key.
  if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) await db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.key.id));
  return { keyId: row.key.id, scopes: row.key.scopes as ApiScope[], project: row.project };
}
