import { bookingByKey, verifyBookingReturn } from "@/server/bookings/bookings";
import { redirect } from "@/server/commerce/http";
import { safeBase } from "@/server/commerce/orders";
import { log } from "@/server/log";
import { hostServesProject } from "@/server/services/domains";

// Return / cancel from hosted checkout for paid bookings. The redirect proves
// nothing: the booking is confirmed only after asking the provider.
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string; provider: string; action: string }> }) {
  const { projectId, provider, action } = await params;
  const url = new URL(req.url);
  const rawBase = url.searchParams.get("base") ?? "";
  let base = safeBase(rawBase);
  if (!base && /^https?:\/\/[^/]+$/.test(rawBase) && (await hostServesProject(new URL(rawBase).host, projectId))) base = rawBase;
  if (!base || !["stripe", "razorpay", "paypal"].includes(provider)) return new Response("Bad request", { status: 400 });
  const key = url.searchParams.get("key") ?? "";
  const b = await bookingByKey(projectId, url.searchParams.get("booking") ?? "", key);
  if (!b) return new Response("Not found", { status: 404 });
  const page = `${base}/booking/${b.id}?key=${encodeURIComponent(key)}`;
  if (action === "cancel") return redirect(`${page}&payment=failed`);
  let paid = false;
  try {
    paid = await verifyBookingReturn(b, url.searchParams);
  } catch (e) {
    log.warn("booking_verify_failed", { provider, error: (e as Error).message });
  }
  return redirect(paid ? `${page}&booked=1` : `${page}&payment=failed`);
}
