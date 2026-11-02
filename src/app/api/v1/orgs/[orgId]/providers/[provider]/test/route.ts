import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyAnthropicKey } from "@/server/ai/gateway";
import { verifyGeminiKey } from "@/server/ai/gemini";
import { ApiError } from "@/server/http/errors";
import { requireOrg, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { decryptSecret } from "@/server/security/secrets";

export const POST = route<{ orgId: string; provider: string }>(async (ctx, { orgId, provider }) => {
  await requireOrg(ctx, orgId, "secrets:manage");
  await rateLimit(`provider-test:${orgId}`, 20, 3600_000);
  if (provider !== "anthropic" && provider !== "gemini") throw new ApiError("conflict", "Only Anthropic and Gemini can be tested");
  const [cred] = await db.select().from(schema.providerCredentials).where(and(eq(schema.providerCredentials.orgId, orgId), eq(schema.providerCredentials.provider, provider)));
  if (!cred) throw new ApiError("not_found", "No key saved for this provider");
  const key = decryptSecret(cred.ciphertext);
  const r = provider === "gemini" ? await verifyGeminiKey(key) : await verifyAnthropicKey(key);
  await db
    .update(schema.providerCredentials)
    .set(r.ok ? { status: "verified", lastVerifiedAt: new Date(), lastError: null } : { status: "error", lastError: r.error })
    .where(eq(schema.providerCredentials.id, cred.id));
  return r;
});
