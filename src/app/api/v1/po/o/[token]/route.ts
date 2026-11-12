import { trackOpen } from "@/server/outreach/core";

// Outreach's open pixel: a 1×1 transparent GIF that counts the email as opened.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Who fetched it decides whether it was a person (see classifyHit): Apple's privacy proxy and scanners aren't.
  await trackOpen(token, { ua: req.headers.get("user-agent"), ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "", method: req.method }).catch(() => {});
  return new Response(new Uint8Array(GIF), { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(GIF.length) } });
}
