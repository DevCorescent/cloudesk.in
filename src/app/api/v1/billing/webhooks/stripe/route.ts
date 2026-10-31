import { handleStripeWebhook } from "@/server/billing/billing";
import { errorResponse } from "@/server/http/handler";

/** Stripe → platform billing events. Verified with STRIPE_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    return Response.json(await handleStripeWebhook(raw, req.headers.get("stripe-signature")));
  } catch (err) {
    return errorResponse(err);
  }
}
