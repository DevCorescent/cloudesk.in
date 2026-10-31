import { handleRazorpayWebhook } from "@/server/billing/billing";
import { errorResponse } from "@/server/http/handler";

/** Razorpay → platform billing events. Verified with RAZORPAY_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    return Response.json(await handleRazorpayWebhook(raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id")));
  } catch (err) {
    return errorResponse(err);
  }
}
