import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PROVIDERS } from "@/server/ai/catalog";
import { verifyAnthropicKey } from "@/server/ai/gateway";
import { verifyGeminiKey } from "@/server/ai/gemini";
import { ApiError } from "@/server/http/errors";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { encryptSecret, secretHint } from "@/server/security/secrets";
import { audit } from "@/server/services/audit";

function assertProvider(provider: string) {
  const p = PROVIDERS.find((x) => x.id === provider);
  if (!p || p.id === "builtin") throw new ApiError("not_found", "Unknown provider");
  if (!p.implemented) throw new ApiError("conflict", `${p.name} is not implemented yet and cannot be connected.`);
  return p;
}

// Saving a key verifies it first; an invalid key is never stored.
export const PUT = route<{ orgId: string; provider: string }>(async (ctx, { orgId, provider }) => {
  await requireOrg(ctx, orgId, "secrets:manage");
  assertProvider(provider);
  await rateLimit(`provider:${orgId}`, 10, 3600_000);
  const { apiKey } = await readJson(ctx.req, z.object({ apiKey: z.string().trim().min(20).max(300) }));
  const check = provider === "gemini" ? await verifyGeminiKey(apiKey) : await verifyAnthropicKey(apiKey);
  if (!check.ok) throw new ApiError("validation_failed", check.error, { apiKey: [check.error] });
  const values = { ciphertext: encryptSecret(apiKey), keyHint: secretHint(apiKey), status: "verified", lastVerifiedAt: new Date(), lastError: null };
  await db
    .insert(schema.providerCredentials)
    .values({ orgId, provider, createdBy: ctx.user.id, ...values })
    .onConflictDoUpdate({ target: [schema.providerCredentials.orgId, schema.providerCredentials.provider], set: values });
  await audit({ orgId, actorId: ctx.user.id, action: "provider.connected", targetType: "provider", targetId: provider });
  return { ok: true, keyHint: values.keyHint };
});

export const DELETE = route<{ orgId: string; provider: string }>(async (ctx, { orgId, provider }) => {
  await requireOrg(ctx, orgId, "secrets:manage");
  assertProvider(provider);
  await db.delete(schema.providerCredentials).where(and(eq(schema.providerCredentials.orgId, orgId), eq(schema.providerCredentials.provider, provider)));
  await audit({ orgId, actorId: ctx.user.id, action: "provider.disconnected", targetType: "provider", targetId: provider });
  return { ok: true };
});
