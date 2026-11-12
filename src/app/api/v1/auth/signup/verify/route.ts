// Sign-up step 2: the code creates the account and workspace. No session is
// started here — the person signs in next, with what they just chose.
import { z } from "zod";
import { readCookie } from "@/server/auth/session";
import { readJson, route } from "@/server/http/handler";
import { parseRefCookie } from "@/server/partners/core";
import { completeSignup } from "@/server/services/signup";
import { claimOutreach } from "@/server/outreach/claim";

export const POST = route(
  async (ctx) => {
    const { ticket, code } = await readJson(ctx.req, z.object({ ticket: z.uuid(), code: z.string().trim().min(6).max(12) }));
    const cookies = ctx.req.headers.get("cookie");
    const out = await completeSignup(ticket, code, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent"), ref: parseRefCookie(readCookie(cookies, "cc_ref")) });
    // Came from an outreach email: credit that email exactly.
    await claimOutreach(out.email, readCookie(cookies, "cc_po"));
    return Response.json(out, { status: 201 });
  },
  { auth: false },
);
