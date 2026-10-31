import { handleLabelWebhook } from "@/server/commerce/labels";
import { handleWebhook } from "@/server/commerce/orders";
import type { ProviderId } from "@/server/commerce/payments";
import { handleWhatsAppWebhook, verifyWebhook } from "@/server/commerce/whatsapp";
import { ApiError } from "@/server/http/errors";
import { errorResponse } from "@/server/http/handler";

type Ctx = { params: Promise<{ projectId: string; provider: string }> };
const valid = (projectId: string) => /^[0-9a-f-]{36}$/i.test(projectId);

// Meta's webhook subscription check (WhatsApp only).
export async function GET(req: Request, { params }: Ctx) {
  const { projectId, provider } = await params;
  if (!valid(projectId) || provider !== "whatsapp") return new Response("Not found", { status: 404 });
  const challenge = await verifyWebhook(projectId, new URL(req.url).searchParams);
  return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge, { headers: { "Content-Type": "text/plain" } });
}

// Provider webhooks. Signatures are verified against the raw body; payment
// events are de-duplicated, so retries are safe.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId, provider } = await params;
    if (!valid(projectId) || !["stripe", "razorpay", "paypal", "whatsapp", "easypost", "shippo"].includes(provider)) throw new ApiError("not_found", "Unknown webhook");
    const raw = await req.text();
    if (raw.length > 512 * 1024) throw new ApiError("payload_too_large", "Payload too large");
    if (provider === "easypost" || provider === "shippo") return Response.json({ received: true, ...(await handleLabelWebhook(projectId, provider, raw, req.headers, new URL(req.url).searchParams.get("token"))) });
    if (provider === "whatsapp") return Response.json({ received: true, ...(await handleWhatsAppWebhook(projectId, raw, req.headers.get("x-hub-signature-256"))) });
    const r = await handleWebhook(projectId, provider as ProviderId, raw, req.headers);
    return Response.json({ received: true, ...r });
  } catch (err) {
    return errorResponse(err);
  }
}
