import { bookSchema, cancelBooking, createBooking, notifyBooked, startBookingPayment } from "@/server/bookings/bookings";
import { redirect, storefrontContext, withMsg } from "@/server/commerce/http";
import { ApiError } from "@/server/http/errors";
import { clientIp, errorResponse } from "@/server/http/handler";
import { log } from "@/server/log";
import { rateLimit } from "@/server/security/rate-limit";
import { appUrl } from "@/server/services/mail";

// Booking form posts from published sites (create or cancel).
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    await rateLimit(`book:${clientIp(req)}`, 20, 600_000);
    const field = (k: string) => String(form.get(k) ?? "");

    if (field("action") === "cancel") {
      const id = field("id");
      const key = field("key");
      const back = `${ctx.base}/booking/${id}?key=${encodeURIComponent(key)}`;
      try {
        await cancelBooking(projectId, id, { key }, field("reason").slice(0, 300) || "Cancelled by customer");
      } catch (e) {
        if (e instanceof ApiError) return redirect(withMsg(back, "err", e.message));
        throw e;
      }
      return redirect(`${back}&cancelled=1`);
    }

    const serviceId = field("serviceId");
    const parsed = bookSchema.safeParse({ serviceId, start: field("start"), name: field("name"), email: field("email"), phone: field("phone"), notes: field("notes"), payment: field("payment") || "none" });
    const back = `${ctx.base}/book/${/^[0-9a-f-]{36}$/i.test(serviceId) ? serviceId : ""}`;
    if (!parsed.success) return redirect(withMsg(back, "err", parsed.error.issues[0]?.message ?? "Check your details"));
    let made;
    try {
      made = await createBooking(projectId, parsed.data);
    } catch (e) {
      if (e instanceof ApiError) return redirect(withMsg(back, "err", e.message));
      throw e;
    }
    const page = `${ctx.base}/booking/${made.booking.id}?key=${encodeURIComponent(made.key)}`;
    if (made.online) {
      try {
        return redirect(await startBookingPayment(made.booking, made.key, ctx.publicBase));
      } catch (e) {
        log.warn("booking_payment_start_failed", { error: (e as Error).message });
        return redirect(`${page}&payment=failed`);
      }
    }
    void notifyBooked(made.booking, appUrl(`${ctx.publicBase}/booking/${made.booking.id}?key=${encodeURIComponent(made.key)}`)).catch((e) => log.warn("booking_mail_failed", { error: (e as Error).message }));
    return redirect(`${page}&booked=1`);
  } catch (err) {
    return errorResponse(err);
  }
}
