import { serveDeployment } from "@/server/hosting/serve";

export async function GET(req: Request, { params }: { params: Promise<{ deploymentId: string; path?: string[] }> }) {
  const { deploymentId, path } = await params;
  return serveDeployment(req, deploymentId, path, `/sites/${deploymentId}`);
}

// Order tracking form (no JavaScript on published sites).
export async function POST(req: Request, { params }: { params: Promise<{ deploymentId: string; path?: string[] }> }) {
  const { deploymentId, path } = await params;
  if ((path ?? []).join("/") !== "track" || req.headers.get("origin") !== new URL(req.url).origin) return new Response("Not found", { status: 404 });
  return serveDeployment(req, deploymentId, path, `/sites/${deploymentId}`, { trackForm: await req.formData() });
}
