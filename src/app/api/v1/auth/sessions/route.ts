import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { revokeAllSessions, revokeSession } from "@/server/auth/session";
import { ApiError } from "@/server/http/errors";
import { readJson, route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";

export const GET = route(async (ctx) => {
  const rows = await db
    .select({ id: schema.sessions.id, ip: schema.sessions.ip, userAgent: schema.sessions.userAgent, createdAt: schema.sessions.createdAt, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, ctx.user.id), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.createdAt));
  // Expose a short reference, never the stored hash itself.
  return { sessions: rows.map((r) => ({ ...r, id: r.id.slice(0, 16), current: r.id === ctx.sessionId })) };
});

export const DELETE = route(async (ctx) => {
  const input = await readJson(ctx.req, z.object({ id: z.string().min(16).max(16).optional(), others: z.boolean().optional() }));
  if (input.others) {
    await revokeAllSessions(ctx.user.id, ctx.sessionId);
  } else if (input.id) {
    const rows = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, ctx.user.id));
    const match = rows.find((r) => r.id.startsWith(input.id!));
    if (!match) throw new ApiError("not_found", "Session not found");
    await revokeSession(match.id);
  } else throw new ApiError("bad_request", "Specify a session or others: true");
  await audit({ actorId: ctx.user.id, action: "user.sessions_revoked", ip: ctx.ip });
  return { ok: true };
});
