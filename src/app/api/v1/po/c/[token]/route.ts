import { trackClick } from "@/server/outreach/core";

// Outreach's tracked links: count the click, then go where the link pointed.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const u = new URL(req.url).searchParams.get("u") ?? "";
  const to = await trackClick(token, u).catch(() => "/");
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
