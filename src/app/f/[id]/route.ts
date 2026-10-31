// Logos and signatures from standalone finance books, shown on documents
// clients open. Images only, served with their sniffed type.
import { financeFile } from "@/server/invoicing/books";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const f = await financeFile((await params).id);
  if (!f) return new Response("Not found", { status: 404 });
  if (req.headers.get("if-none-match") === `"${f.sha256}"`) return new Response(null, { status: 304 });
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Cache-Control": "public, max-age=86400", ETag: `"${f.sha256}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
}
