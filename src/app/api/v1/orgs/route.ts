import { z } from "zod";
import { db } from "@/db";
import { readJson, route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";
import { createOrganization, listOrgsForUser } from "@/server/services/orgs";

export const GET = route(async (ctx) => ({ organizations: await listOrgsForUser(ctx.user.id) }));

export const POST = route(async (ctx) => {
  const { name } = await readJson(ctx.req, z.object({ name: z.string().trim().min(2).max(100) }));
  const org = await db.transaction((tx) => createOrganization(tx, { name, ownerId: ctx.user.id }));
  await audit({ orgId: org.id, actorId: ctx.user.id, action: "org.created", targetType: "organization", targetId: org.id });
  return Response.json({ organization: org }, { status: 201 });
});
