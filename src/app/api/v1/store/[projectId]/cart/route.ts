import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { presentment, type StoreCurrency } from "@/lib/store/fx";
import { MAX_LINE_QTY, saveCart, type CartItem } from "@/server/commerce/cart";
import { cartCookie, cartFor, redirect, storefrontContext, withMsg } from "@/server/commerce/http";
import { clientIp, errorResponse } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { attributeConversion, recordStat } from "@/server/services/stats";

// Cart actions from storefront forms: add | update | remove | coupon.
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    const action = String(form.get("action") ?? "");
    const variantId = String(form.get("variant") ?? "");
    const qty = Math.min(Math.max(Math.floor(Number(form.get("qty") ?? 1)) || 0, 0), MAX_LINE_QTY);
    const { cart, token, created } = await cartFor(projectId, ctx.token, action === "add" || action === "currency");
    const cookie = created && token ? cartCookie(ctx.cookieName, token) : undefined;
    if (!cart) return redirect(`${ctx.base}/cart`);
    let items = [...((cart.items as CartItem[]) ?? [])];

    if (action === "add") {
      const [v] = /^[0-9a-f-]{36}$/i.test(variantId)
        ? await db.select({ id: schema.storeVariants.id, stock: schema.storeVariants.stock, track: schema.storeVariants.trackInventory, slug: schema.storeProducts.slug, status: schema.storeProducts.status }).from(schema.storeVariants).innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId)).where(and(eq(schema.storeVariants.id, variantId), eq(schema.storeVariants.projectId, projectId)))
        : [];
      if (!v || v.status !== "active") return redirect(`${ctx.base}/shop`, cookie);
      const existing = items.find((i) => i.variantId === v.id);
      const want = (existing?.qty ?? 0) + Math.max(qty, 1);
      if (v.track && want > v.stock) return redirect(withMsg(`${ctx.base}/product/${v.slug}`, "err", v.stock > 0 ? `Only ${v.stock} available.` : "This option is sold out."), cookie);
      items = existing ? items.map((i) => (i.variantId === v.id ? { ...i, qty: Math.min(want, MAX_LINE_QTY) } : i)) : [...items, { variantId: v.id, qty: Math.max(qty, 1) }];
      if (items.length > 50) items = items.slice(-50);
      await saveCart(cart.id, { items });
      void recordStat(projectId, "/cart", "cart_add");
      void attributeConversion(projectId, "cart_add", clientIp(req), req.headers.get("user-agent"));
      return redirect(form.get("buyNow") ? `${ctx.base}/checkout` : withMsg(`${ctx.base}/cart`, "m", "added"), cookie);
    }
    if (action === "currency") {
      const [store] = await db.select({ currency: schema.stores.currency, currencies: schema.stores.currencies }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
      const wanted = String(form.get("currency") ?? "").toUpperCase();
      const cur = store ? presentment(store.currency, store.currencies as StoreCurrency[], wanted) : null;
      // Changing currency resets the delivery and payment choices, which are priced in it.
      await saveCart(cart.id, { currency: cur?.code ?? null, shippingRateId: null, paymentMethod: null });
      const back = String(form.get("return") ?? "/shop");
      return redirect(`${ctx.base}${/^\/(shop|product|cart)(\/[\w-]*)?(\?[\w=&%.-]*)?$/.test(back) ? back : "/shop"}`, cookie);
    }
    if (action === "update") items = qty === 0 ? items.filter((i) => i.variantId !== variantId) : items.map((i) => (i.variantId === variantId ? { ...i, qty } : i));
    if (action === "remove") items = items.filter((i) => i.variantId !== variantId);
    if (action === "coupon") {
      const code = String(form.get("code") ?? "").trim().slice(0, 40);
      await saveCart(cart.id, { discountCode: code || null });
      return redirect(`${ctx.base}/cart`, cookie);
    }
    if (action === "giftcard") {
      const code = String(form.get("code") ?? "").trim().toUpperCase().slice(0, 40);
      // Guessing codes is rate limited per network address.
      await rateLimit(`giftcard:${clientIp(req)}`, 20, 600_000);
      await saveCart(cart.id, { giftCardCode: code || null });
      return redirect(`${ctx.base}/cart`, cookie);
    }
    await saveCart(cart.id, { items });
    return redirect(`${ctx.base}/cart`, cookie);
  } catch (err) {
    return errorResponse(err);
  }
}
