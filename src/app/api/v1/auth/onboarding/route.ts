import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { answers } from "@/lib/onboarding/answers";
import { readJson, route } from "@/server/http/handler";

async function current(userId: string) {
  const [u] = await db.select({ onboarding: schema.users.onboarding, onboardedAt: schema.users.onboardedAt }).from(schema.users).where(eq(schema.users.id, userId));
  return { onboarding: (u?.onboarding ?? {}) as Record<string, unknown>, onboardedAt: u?.onboardedAt ?? null };
}

export const GET = route(async (ctx) => current(ctx.user.id));

export const PUT = route(async (ctx) => {
  const { complete, ...input } = await readJson(ctx.req, answers);
  const cur = await current(ctx.user.id);
  const onboarding = { ...cur.onboarding, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  await db
    .update(schema.users)
    .set({ onboarding, ...(complete && !cur.onboardedAt ? { onboardedAt: new Date() } : {}) })
    .where(eq(schema.users.id, ctx.user.id));
  return current(ctx.user.id);
});
