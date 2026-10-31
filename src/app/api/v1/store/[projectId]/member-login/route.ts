import { z } from "zod";
import { sendMemberLink } from "@/server/commerce/digital";
import { redirect, storefrontContext, withMsg } from "@/server/commerce/http";
import { clientIp, errorResponse } from "@/server/http/handler";
import { log } from "@/server/log";
import { rateLimit } from "@/server/security/rate-limit";

// Members area sign-in: emails a link to active members. Same response either way.
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    const next = String(form.get("next") ?? "/");
    const back = `${ctx.base}${/^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/"}`;
    const email = String(form.get("email") ?? "").trim().slice(0, 200);
    if (!z.email().safeParse(email).success) return redirect(withMsg(back, "err", "Enter a valid email address."));
    await rateLimit(`member-ip:${clientIp(req)}`, 10, 600_000);
    await rateLimit(`member-email:${projectId}:${email.toLowerCase()}`, 3, 3600_000);
    await sendMemberLink(projectId, email, ctx.publicBase, /^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/").catch((e) => log.warn("member_link_failed", { error: (e as Error).message }));
    return redirect(`${back}?sent=1`);
  } catch (err) {
    return errorResponse(err);
  }
}
