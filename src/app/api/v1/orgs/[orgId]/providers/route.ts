import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { MODELS, PROVIDERS, ROUTES } from "@/server/ai/catalog";
import { requireOrg, route } from "@/server/http/handler";
import { cfg } from "@/server/platform/config";
import { activeProvider } from "@/server/ai/gateway";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:read");
  const creds = await db
    .select({ provider: schema.providerCredentials.provider, keyHint: schema.providerCredentials.keyHint, status: schema.providerCredentials.status, lastVerifiedAt: schema.providerCredentials.lastVerifiedAt, lastError: schema.providerCredentials.lastError, createdAt: schema.providerCredentials.createdAt })
    .from(schema.providerCredentials)
    .where(eq(schema.providerCredentials.orgId, orgId));
  return {
    providers: PROVIDERS.map((p) => {
      const cred = creds.find((c) => c.provider === p.id) ?? null;
      const platformKey = !!(p.envVar && cfg(p.envVar));
      return { ...p, envVar: undefined, credential: cred, platformKeyAvailable: p.implemented && platformKey };
    }),
    models: MODELS,
    routes: ROUTES,
    /** What the AI features run on now: anthropic, gemini or null (built-in rules). */
    active: await activeProvider(orgId),
  };
});
