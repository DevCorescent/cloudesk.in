import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { email } from "@/server/http/schemas";
import { rateLimit } from "@/server/security/rate-limit";
import { requestPasswordReset } from "@/server/services/auth";

export const POST = route(
  async (ctx) => {
    const input = await readJson(ctx.req, z.object({ email }));
    await rateLimit(`forgot:${ctx.ip}`, 10, 3600_000);
    await rateLimit(`forgot:${input.email}`, 3, 3600_000);
    await requestPasswordReset(input.email, { ip: ctx.ip });
    return { ok: true };
  },
  { auth: false },
);
