import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError } from "@/server/http/errors";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";

type P = { orgId: string };

export const GET = route<P>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:read");
  const [o] = await db.select({ requireMfa: schema.organizations.requireMfa }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const members = await db
    .select({ mfa: schema.users.totpEnabledAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.orgId, orgId));
  return { requireMfa: o.requireMfa, members: members.length, membersWithMfa: members.filter((m) => m.mfa).length };
});

export const PATCH = route<P>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:update");
  const { requireMfa } = await readJson(ctx.req, z.object({ requireMfa: z.boolean() }));
  // Owners can't lock themselves out: they must use two-factor first.
  if (requireMfa && !ctx.user.mfaEnabled) throw new ApiError("conflict", "Turn on two-factor sign-in for your own account first.");
  await db.update(schema.organizations).set({ requireMfa }).where(eq(schema.organizations.id, orgId));
  await audit({ orgId, actorId: ctx.user.id, action: requireMfa ? "org.mfa_required" : "org.mfa_optional", targetType: "organization", targetId: orgId });
  return { requireMfa };
});
