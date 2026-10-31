import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { verifyEmail } from "@/server/services/auth";

export const POST = route(
  async (ctx) => {
    await rateLimit(`verify:${ctx.ip}`, 20, 3600_000);
    const { token } = await readJson(ctx.req, z.object({ token: z.string().min(10).max(200) }));
    await verifyEmail(token);
    return { ok: true };
  },
  { auth: false },
);
