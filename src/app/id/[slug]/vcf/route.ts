// A business ID as a contact file: phones add it to their contacts in one tap.
import { vcard } from "@/lib/cards/model";
import { publicCard } from "@/server/cards/cards";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await publicCard(slug, { count: "save" });
  if (!c) return new Response("Not found", { status: 404 });
  const file = (c.data.name || "contact").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "contact";
  return new Response(vcard(c.data, c.url), {
    headers: { "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.vcf"`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
