import { serveDeployment } from "@/server/hosting/serve";
import { reviewLinkByToken } from "@/server/services/collab";

// The deployed version a client review link points to (framed by /review/<token>).
export async function GET(req: Request, { params }: { params: Promise<{ token: string; path?: string[] }> }) {
  const { token, path } = await params;
  const r = await reviewLinkByToken(token);
  if (!r) return new Response("This review link has expired or been turned off.", { status: 404, headers: { "Content-Type": "text/plain" } });
  const res = await serveDeployment(req, r.link.deploymentId, path, `/rv/${token}`, { reviewAccess: true });
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}
