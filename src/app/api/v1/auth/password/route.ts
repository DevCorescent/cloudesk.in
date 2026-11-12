import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { password } from "@/server/http/schemas";
import { rateLimit } from "@/server/security/rate-limit";
import { changePassword } from "@/server/services/auth";

export const PATCH = route(async (ctx) => {
  await rateLimit(`chpw:${ctx.user.id}`, 5, 15 * 60_000);
  const input = await readJson(ctx.req, z.object({ currentPassword: z.string().max(200).default(""), code: z.string().max(20).default(""), newPassword: password }));
  await changePassword(ctx.user.id, ctx.sessionId, input.currentPassword, input.newPassword, { code: input.code, ip: ctx.ip });
  return { ok: true };
});
