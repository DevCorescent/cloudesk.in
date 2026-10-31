import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { redirect } from "@/server/commerce/http";
import { safeBase, verifyReturn } from "@/server/commerce/orders";
import type { ProviderId } from "@/server/commerce/payments";
import { log } from "@/server/log";
import { sha256 } from "@/server/security/tokens";
import { hostServesProject } from "@/server/services/domains";

// Return / cancel from hosted checkout. The redirect itself proves nothing:
// payment is confirmed only by asking the provider (verifyReturn).
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string; provider: string; action: string }> }) {
  const { projectId, provider, action } = await params;
  const url = new URL(req.url);
  const orderId = url.searchParams.get("order") ?? "";
  const key = url.searchParams.get("key") ?? "";
  const rawBase = url.searchParams.get("base") ?? "";
  let base = safeBase(rawBase);
  // Custom domains pass their origin; accept it only if it is a verified domain of this project.
  if (!base && /^https?:\/\/[^/]+$/.test(rawBase) && (await hostServesProject(new URL(rawBase).host, projectId))) base = rawBase;
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !base || !["stripe", "razorpay", "paypal"].includes(provider)) return new Response("Bad request", { status: 400 });
  const [order] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, orderId), eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.accessKeyHash, sha256(key))));
  if (!order) return new Response("Not found", { status: 404 });
  const orderUrl = `${base}/order/${order.number}?key=${encodeURIComponent(key)}`;
  if (action === "cancel") return redirect(`${orderUrl}&payment=failed`);
  let paid = false;
  try {
    paid = await verifyReturn(projectId, provider as ProviderId, order, url.searchParams);
  } catch (e) {
    log.warn("payment_verify_failed", { provider, error: (e as Error).message });
  }
  return redirect(paid ? `${orderUrl}&placed=1` : `${orderUrl}&payment=failed`);
}
