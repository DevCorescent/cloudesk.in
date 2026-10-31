// A document shared by link, as a PDF (an uploaded file, as it is).
import { byLink } from "@/server/documents/drive";
import { render } from "@/server/documents/exporting";
import { publicFileBytes } from "@/server/documents/tools";
import { rateLimit } from "@/server/security/rate-limit";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await byLink(token);
  if (!f) return new Response("Not found", { status: 404 });
  try {
    await rateLimit(`read-pdf:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon"}`, 30, 3_600_000);
  } catch {
    return new Response("Too many downloads — try again later", { status: 429 });
  }
  if (f.kind === "file") {
    // An uploaded file: as it is, always as a download.
    const v = await publicFileBytes(f.id);
    if (!v) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(v.data), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${v.filename.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  }
  const out = await render(f, "pdf");
  return new Response(new Uint8Array(out.data), { headers: { "Content-Type": out.mime, "Content-Disposition": `attachment; filename="${out.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
