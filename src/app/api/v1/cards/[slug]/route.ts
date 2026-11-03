// The public side of a business ID: someone who was given it sends their own
// details back to its owner. No account needed; limited per address and card.
import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { exchange } from "@/server/cards/cards";
import { rateLimit } from "@/server/security/rate-limit";

export const POST = route<{ slug: string }>(
  async (ctx, { slug }) => {
    await rateLimit(`card-x:${ctx.ip}`, 10, 3600_000);
    await rateLimit(`card-x:${slug.toLowerCase()}`, 100, 24 * 3600_000);
    return exchange(slug, await readJson(ctx.req, z.unknown()));
  },
  { auth: false },
);
