import { ApiError } from "@/server/http/errors";
import { errorResponse } from "@/server/http/handler";
import { inbound } from "@/server/helpdesk/core";
import { rateLimit } from "@/server/security/rate-limit";

/**
 * Inbound email for the Helpdesk. Point your email provider's inbound parse
 * (e.g. Postmark inbound) here. Server-to-server: no cookies, no Origin check;
 * the unguessable token in the URL is the credential.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await rateLimit(`hd-in:${token}`, 120, 60_000);
    const text = await req.text();
    if (text.length > 2_000_000) throw new ApiError("payload_too_large", "Emails are limited to 2 MB");
    let body: unknown;
    try {
      body = JSON.parse(text || "{}");
    } catch {
      throw new ApiError("bad_request", "Send the email as JSON");
    }
    return Response.json(await inbound(token, body));
  } catch (err) {
    return errorResponse(err);
  }
}
