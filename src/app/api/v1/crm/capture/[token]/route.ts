// Web-to-lead: any form, on any website, can post here and the person lands
// in the workspace's CRM. Accepts JSON or a normal form post, from anywhere.
import { clientIp, errorResponse } from "@/server/http/handler";
import { ApiError } from "@/server/http/errors";
import { webLead } from "@/server/crm/capture";
import { rateLimit } from "@/server/security/rate-limit";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    await rateLimit(`crm-capture:${clientIp(req) ?? "unknown"}`, 30, 3600_000);
    await rateLimit(`crm-capture-token:${token}`, 2000, 3600_000);
    const type = req.headers.get("content-type") ?? "";
    const text = await req.text();
    if (text.length > 20_000) throw new ApiError("payload_too_large", "That's too much for a lead form");
    let data: Record<string, unknown> = {};
    if (type.includes("application/json")) {
      try {
        data = JSON.parse(text || "{}");
      } catch {
        throw new ApiError("bad_request", "Send valid JSON");
      }
    } else data = Object.fromEntries(new URLSearchParams(text));
    const out = await webLead(token, data);
    // A plain HTML form gets sent back where it came from (or to its "redirect").
    const back = typeof data.redirect === "string" && /^https?:\/\//.test(data.redirect) ? data.redirect : null;
    if (!type.includes("application/json") && back) return Response.redirect(back, 303);
    if (!type.includes("application/json")) return new Response("<!doctype html><meta charset=utf-8><title>Thanks</title><p style=\"font:16px system-ui;margin:40px\">Thanks — we'll be in touch soon.</p>", { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });
    return Response.json(out, { headers: CORS });
  } catch (e) {
    const res = errorResponse(e);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
}
