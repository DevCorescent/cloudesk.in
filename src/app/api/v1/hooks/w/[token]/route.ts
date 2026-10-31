import { ApiError, notFound } from "@/server/http/errors";
import { errorResponse } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { triggerWebhook } from "@/server/automation/workflows";

/**
 * Incoming webhook for automations. Server-to-server: no cookies, no Origin
 * check; the unguessable token in the URL is the credential.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await rateLimit(`hook:${token}`, 120, 60_000);
    const text = await req.text();
    if (text.length > 64_000) throw new ApiError("payload_too_large", "Webhook bodies are limited to 64 KB");
    let body: unknown = text;
    if (/json/i.test(req.headers.get("content-type") ?? "") || /^\s*[[{]/.test(text)) {
      try {
        body = JSON.parse(text || "{}");
      } catch {
        throw new ApiError("validation_failed", "The body is not valid JSON");
      }
    }
    const query = Object.fromEntries(new URL(req.url).searchParams);
    const run = await triggerWebhook(token, { body, query });
    if (!run) throw notFound("Webhook");
    return Response.json({ accepted: true, runId: run.id }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
