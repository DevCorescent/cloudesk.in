import { redirect, storefrontContext, withMsg } from "@/server/commerce/http";
import { getOrderByKey, providerCreds } from "@/server/commerce/orders";
import { cancelStoreSubscription } from "@/server/commerce/subscriptions";
import { clientIp, errorResponse } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

/** A customer cancels their subscription from the order page (authorised by the order's private key). */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    await rateLimit(`sub-cancel:${clientIp(req)}`, 10, 600_000);
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    const number = Number(form.get("number"));
    const key = String(form.get("key") ?? "");
    const found = Number.isInteger(number) ? await getOrderByKey(projectId, number, key) : null;
    const back = `${ctx.base}/order/${number}?key=${encodeURIComponent(key)}`;
    if (!found?.order.subscriptionId) return redirect(withMsg(back, "err", "We couldn't find that subscription."));
    const p = await providerCreds(projectId, found.order.paymentMethod);
    if (!p) return redirect(withMsg(back, "err", "Please contact the store to cancel."));
    try {
      await cancelStoreSubscription(projectId, found.order.subscriptionId, p.creds, "customer");
    } catch (e) {
      return redirect(withMsg(back, "err", (e as Error).message));
    }
    return redirect(withMsg(back, "sub", "cancelled"));
  } catch (err) {
    return errorResponse(err);
  }
}
