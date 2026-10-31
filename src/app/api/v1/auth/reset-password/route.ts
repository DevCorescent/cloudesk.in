import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { password } from "@/server/http/schemas";
import { rateLimit } from "@/server/security/rate-limit";
import { resetPassword } from "@/server/services/auth";

export const POST = route(
  async (ctx) => {
    await rateLimit(`reset:${ctx.ip}`, 10, 3600_000);
    const input = await readJson(ctx.req, z.object({ token: z.string().min(10).max(200), password }));
    await resetPassword(input.token, input.password, { ip: ctx.ip });
    return { ok: true };
  },
  { auth: false },
);
