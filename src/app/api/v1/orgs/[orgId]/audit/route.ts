import { desc, eq, lt, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOrg, route } from "@/server/http/handler";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "audit:read");
  const before = new URL(ctx.req.url).searchParams.get("before");
  const rows = await db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.targetType,
      targetId: schema.auditLogs.targetId,
      metadata: schema.auditLogs.metadata,
      createdAt: schema.auditLogs.createdAt,
      actorName: schema.users.name,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
    .where(and(eq(schema.auditLogs.orgId, orgId), before ? lt(schema.auditLogs.createdAt, new Date(before)) : undefined))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(50);
  return { events: rows };
});
