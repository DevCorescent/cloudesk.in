// An uploaded file shared by link: its latest version, to show in the page (PDFs and images) — nothing that could run script.
import { byLink } from "@/server/documents/drive";
import { publicFileBytes } from "@/server/documents/tools";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await byLink(token);
  if (!f || f.kind !== "file") return new Response("Not found", { status: 404 });
  const v = await publicFileBytes(f.id);
  if (!v) return new Response("Not found", { status: 404 });
  const shown = v.mime === "application/pdf" || v.mime.startsWith("image/");
  return new Response(new Uint8Array(v.data), { headers: { "Content-Type": shown ? v.mime : "application/octet-stream", "Content-Disposition": `${shown ? "inline" : "attachment"}; filename="${v.filename.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } });
}
