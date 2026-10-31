import { serveDeployment } from "@/server/hosting/serve";
import { isPlatformHost, originOf, projectForHost } from "@/server/services/domains";

// Sites on customers' own domains. The proxy rewrites requests for unknown
// hosts here; the host must be a verified domain with a live deployment.
type Ctx = { params: Promise<{ path?: string[] }> };
const notFound = () => new Response("This site is not available.", { status: 404, headers: { "Content-Type": "text/plain" } });

async function resolve(req: Request) {
  const host = req.headers.get("host") ?? "";
  if (!host || isPlatformHost(host)) return null;
  const p = await projectForHost(host);
  return p?.prod ? p : null;
}

export async function GET(req: Request, { params }: Ctx) {
  const p = await resolve(req);
  if (!p) return notFound();
  const { path } = await params;
  return serveDeployment(req, p.prod!, path, "", { requireProduction: true, publicOrigin: originOf(req) });
}

// Order tracking form (no JavaScript on published sites).
export async function POST(req: Request, { params }: Ctx) {
  const p = await resolve(req);
  const { path } = await params;
  const origin = req.headers.get("origin");
  if (!p || (path ?? []).join("/") !== "track" || !origin || new URL(origin).host !== req.headers.get("host")) return notFound();
  return serveDeployment(req, p.prod!, path, "", { requireProduction: true, publicOrigin: originOf(req), trackForm: await req.formData() });
}
