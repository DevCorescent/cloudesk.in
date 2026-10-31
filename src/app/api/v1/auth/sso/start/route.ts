import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { start } from "@/server/auth/sso";

export const POST = route(
  async (ctx) => {
    await rateLimit(`sso-start:${ctx.ip}`, 30, 15 * 60_000);
    const r = await start(await readJson(ctx.req, z.record(z.string(), z.unknown())));
    ctx.headers.append("Set-Cookie", r.cookie);
    return { url: r.url };
  },
  { auth: false },
);
