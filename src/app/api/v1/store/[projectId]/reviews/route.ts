import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { redirect, storefrontContext } from "@/server/commerce/http";
import { errorResponse } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

// Customer reviews are queued for the owner to approve; nothing is published automatically.
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const form = await req.formData();
    const ctx = await storefrontContext(req, projectId, form);
    if (!ctx) return new Response("Bad request", { status: 400 });
    const productId = String(form.get("product") ?? "");
    const [p] = /^[0-9a-f-]{36}$/i.test(productId) ? await db.select({ id: schema.storeProducts.id, slug: schema.storeProducts.slug }).from(schema.storeProducts).where(and(eq(schema.storeProducts.id, productId), eq(schema.storeProducts.projectId, projectId))) : [];
    if (!p) return redirect(`${ctx.base}/shop`);
    if (String(form.get("_hp") ?? "")) return redirect(`${ctx.base}/product/${p.slug}?review=1`);
    await rateLimit(`review:${projectId}:${req.headers.get("x-forwarded-for") ?? ""}`, 5, 3600_000);
    const name = String(form.get("name") ?? "").trim().slice(0, 80);
    const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
    const body = String(form.get("body") ?? "").trim().slice(0, 2000);
    const rating = Math.min(5, Math.max(1, Math.round(Number(form.get("rating")) || 5)));
    if (!name || !body || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return redirect(`${ctx.base}/product/${p.slug}?err=${encodeURIComponent("Please add your name, email and review.")}`);
    // "Verified buyer" only when this email has a paid order containing the product.
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from store_orders o join store_order_items i on i.order_id = o.id where o.project_id = ${projectId} and lower(o.email) = ${email} and i.product_id = ${p.id} and o.financial_status = 'paid'`).then((r) => r.rows);
    await db.insert(schema.storeReviews).values({ projectId, productId: p.id, name, rating, title: String(form.get("title") ?? "").trim().slice(0, 120), body, verified: n > 0, status: "pending" });
    return redirect(`${ctx.base}/product/${p.slug}?review=1#reviews`);
  } catch (err) {
    return errorResponse(err);
  }
}
