// Sign-up step 2: the code creates the account and workspace. No session is
// started here — the person signs in next, with what they just chose.
import { z } from "zod";
import { readCookie } from "@/server/auth/session";
import { readJson, route } from "@/server/http/handler";
import { parseRefCookie } from "@/server/partners/core";
import { completeSignup } from "@/server/services/signup";

export const POST = route(
  async (ctx) => {
    const { ticket, code } = await readJson(ctx.req, z.object({ ticket: z.uuid(), code: z.string().trim().min(6).max(12) }));
    return Response.json(await completeSignup(ticket, code, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent"), ref: parseRefCookie(readCookie(ctx.req.headers.get("cookie"), "cc_ref")) }), { status: 201 });
  },
  { auth: false },
);
