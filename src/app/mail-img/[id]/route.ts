import { readSignatureImage } from "@/server/mail/signatures";

// Public signature images (logos, photos): recipients' mail apps load these,
// so no sign-in. Ids are unguessable; the type was checked from the bytes.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await readSignatureImage(id);
  if (!img) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mime,
      "Content-Length": String(img.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
