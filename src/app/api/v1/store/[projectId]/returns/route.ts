import { requestReturn, returnRequestSchema, verifyAccountToken } from "@/server/commerce/customer";
import { redirect, storefrontContext, withMsg } from "@/server/commerce/http";
import { ApiError } from "@/server/http/errors";
import { clientIp, errorResponse } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

// Customer return requests, authorised by the order's secret key or a signed account link.
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    await rateLimit(`return:${clientIp(req)}`, 10, 600_000);
    const number = Number(String(form.get("number") ?? "").replace(/\D/g, ""));
    const key = String(form.get("key") ?? "");
    const token = String(form.get("token") ?? "");
    const email = token ? verifyAccountToken(projectId, token) : null;
    const back = token ? `${ctx.base}/account?token=${encodeURIComponent(token)}` : `${ctx.base}/order/${number}?key=${encodeURIComponent(key)}`;
    if (!number || (!key && !email)) return redirect(withMsg(`${ctx.base}/account`, "err", "That link has expired. Enter your email to get a new one."));
    const items = [...form.entries()]
      .filter(([k]) => k.startsWith("qty_"))
      .map(([k, v]) => ({ itemId: k.slice(4), quantity: Math.floor(Number(v)) || 0 }))
      .filter((i) => i.quantity > 0);
    const parsed = returnRequestSchema.safeParse({ reason: String(form.get("reason") ?? ""), details: String(form.get("details") ?? ""), items });
    if (!parsed.success) return redirect(withMsg(back, "err", items.length ? "Choose a reason for the return." : "Choose at least one item to return."));
    try {
      await requestReturn(projectId, number, { key: key || undefined, email: email ?? undefined }, parsed.data);
    } catch (e) {
      if (e instanceof ApiError) return redirect(withMsg(back, "err", e.message));
      throw e;
    }
    return redirect(`${back}${back.includes("?") ? "&" : "?"}return=1`);
  } catch (err) {
    return errorResponse(err);
  }
}
