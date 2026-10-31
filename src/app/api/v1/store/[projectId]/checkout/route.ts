import { z } from "zod";
import { validateGstin } from "@/lib/store/gst";
import { db, schema } from "@/db";
import { saveCart } from "@/server/commerce/cart";
import { cartFor, redirect, storefrontContext, withMsg } from "@/server/commerce/http";
import { notifyLowStock, notifyPlaced, placeOrder, startPayment } from "@/server/commerce/orders";
import { ApiError } from "@/server/http/errors";
import { clientIp, errorResponse } from "@/server/http/handler";
import { log } from "@/server/log";
import { attributeConversion, recordStat } from "@/server/services/stats";
import { eq } from "drizzle-orm";

const details = z.object({
  email: z.string().trim().email("Enter a valid email").max(200),
  phone: z.string().trim().max(30),
  name: z.string().trim().min(1, "Enter your name").max(120),
  line1: z.string().trim().min(1, "Enter your address").max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().min(1, "Enter your city").max(80),
  region: z.string().trim().min(1, "Enter your state or region").max(80),
  postalCode: z.string().trim().min(3, "Enter your postal code").max(12),
  country: z.string().trim().length(2),
});

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    const { cart } = await cartFor(projectId, ctx.token, false);
    if (!cart) return redirect(`${ctx.base}/cart`);
    const back = `${ctx.base}/checkout`;
    const step = String(form.get("step") ?? "");

    if (step === "details") {
      const raw = Object.fromEntries(["email", "phone", "name", "line1", "line2", "city", "region", "postalCode", "country"].map((k) => [k, String(form.get(k) ?? "")]));
      const r = details.safeParse(raw);
      if (!r.success) return redirect(withMsg(`${back}?edit=1`, "err", r.error.issues[0]?.message ?? "Check your details"));
      const [store] = await db.select({ checkout: schema.stores.checkout }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
      if ((store?.checkout as { requirePhone?: boolean })?.requirePhone !== false && r.data.phone.replace(/\D/g, "").length < 7) return redirect(withMsg(`${back}?edit=1`, "err", "Enter a phone number for delivery updates"));
      const { email, phone, ...address } = r.data;
      // Optional B2B purchase: a valid GSTIN puts the buyer's details on the tax invoice.
      const gstinRaw = String(form.get("gstin") ?? "").trim();
      let buyerGstin = "";
      if (gstinRaw) {
        const g = validateGstin(gstinRaw);
        if (!g.ok) return redirect(withMsg(`${back}?edit=1`, "err", `GSTIN: ${g.reason}`));
        buyerGstin = g.gstin;
      }
      const buyerBusinessName = buyerGstin ? String(form.get("businessName") ?? "").trim().slice(0, 120) : "";
      await saveCart(cart.id, { email, address: { ...address, phone, country: address.country.toUpperCase() }, marketingConsent: form.get("consent") === "1", whatsappOptIn: form.get("whatsapp") === "1", buyerGstin, buyerBusinessName, shippingRateId: null });
      void recordStat(projectId, "/checkout", "checkout");
      void attributeConversion(projectId, "checkout", clientIp(req), req.headers.get("user-agent"));
      return redirect(back);
    }

    if (step === "place") {
      const rate = String(form.get("rate") ?? "");
      const payment = String(form.get("payment") ?? "");
      await saveCart(cart.id, { shippingRateId: /^[0-9a-f-]{36}$/i.test(rate) ? rate : null, paymentMethod: payment.slice(0, 20) });
      const fresh = { ...cart, shippingRateId: /^[0-9a-f-]{36}$/i.test(rate) ? rate : null, paymentMethod: payment.slice(0, 20) };
      const addr = cart.address as { phone?: string; name: string; line1: string; line2?: string; city: string; region: string; postalCode: string; country: string } | null;
      if (!addr || !cart.email) return redirect(`${back}?edit=1`);
      let placed;
      try {
        placed = await placeOrder(projectId, fresh, { email: cart.email, phone: addr.phone ?? "", address: addr, note: String(form.get("note") ?? ""), marketingConsent: cart.marketingConsent });
      } catch (e) {
        if (e instanceof ApiError) return redirect(withMsg(back, "err", e.message));
        throw e;
      }
      const orderUrl = `${ctx.base}/order/${placed.order.number}?key=${encodeURIComponent(placed.key)}`;
      void recordStat(projectId, "/checkout", "order");
      void attributeConversion(projectId, "order", clientIp(req), req.headers.get("user-agent"));
      void notifyPlaced(placed.order, placed.key, ctx.publicBase).catch((e) => log.warn("order_mail_failed", { error: (e as Error).message }));
      void notifyLowStock(projectId, placed.lowStock).catch((e) => log.warn("stock_mail_failed", { error: (e as Error).message }));
      if (placed.online) {
        try {
          return redirect(await startPayment(placed.order, placed.store, placed.key, ctx.publicBase));
        } catch (e) {
          log.warn("payment_start_failed", { error: (e as Error).message });
          return redirect(`${orderUrl}&payment=failed`);
        }
      }
      return redirect(`${orderUrl}&placed=1`);
    }
    return redirect(back);
  } catch (err) {
    return errorResponse(err);
  }
}
