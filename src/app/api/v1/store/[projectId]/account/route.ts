import { z } from "zod";
import { sendAccountLink } from "@/server/commerce/customer";
import { redirect, storefrontContext, withMsg } from "@/server/commerce/http";
import { clientIp, errorResponse } from "@/server/http/handler";
import { log } from "@/server/log";
import { rateLimit } from "@/server/security/rate-limit";

// "My orders": emails a signed link. The response never reveals whether the email has orders.
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    const email = String(form.get("email") ?? "").trim().slice(0, 200);
    if (!z.email().safeParse(email).success) return redirect(withMsg(`${ctx.base}/account`, "err", "Enter a valid email address."));
    await rateLimit(`acct-ip:${clientIp(req)}`, 10, 600_000);
    await rateLimit(`acct-email:${projectId}:${email.toLowerCase()}`, 3, 3600_000);
    await sendAccountLink(projectId, email, ctx.publicBase).catch((e) => log.warn("account_link_failed", { error: (e as Error).message }));
    return redirect(`${ctx.base}/account?sent=1`);
  } catch (err) {
    return errorResponse(err);
  }
}
