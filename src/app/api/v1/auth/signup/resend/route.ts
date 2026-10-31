// Sign-up: send the code again (a new code; the old one stops working).
import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { resendSignup } from "@/server/services/signup";

export const POST = route(
  async (ctx) => {
    const { ticket } = await readJson(ctx.req, z.object({ ticket: z.uuid() }));
    return resendSignup(ticket, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
  },
  { auth: false },
);
