import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";
import { normalizeHostname, projectForHost } from "@/server/services/domains";

// For the TLS edge proxy (e.g. Caddy `on_demand_tls { ask … }`): a certificate
// may be issued only for verified customer domains with a live site.
export async function GET(req: Request) {
  try {
    await rateLimit(`ask:${clientIp(req) ?? "local"}`, 600, 60_000);
    const host = normalizeHostname(new URL(req.url).searchParams.get("domain") ?? "");
    const p = await projectForHost(host);
    return new Response(p?.prod ? "ok" : "unknown", { status: p?.prod ? 200 : 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch {
    return new Response("unknown", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
}
