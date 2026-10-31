import { readAsset } from "@/server/media/assets";

// Public, immutable image delivery. URLs are unguessable ids; published sites
// reference them directly. The stored type was detected from the bytes.
export async function GET(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const a = await readAsset(assetId);
  if (!a) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  const etag = `"${a.sha256.slice(0, 32)}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(a.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
