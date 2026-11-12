import { trackOpen } from "@/server/outreach/core";

// Outreach's open pixel: a 1×1 transparent GIF that counts the email as opened.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await trackOpen(token).catch(() => {});
  return new Response(new Uint8Array(GIF), { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(GIF.length) } });
}
