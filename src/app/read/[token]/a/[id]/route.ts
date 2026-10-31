// An image in a document shared by link — only images of that document.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { byLink } from "@/server/documents/drive";
import { assetResponse } from "@/server/documents/exporting";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const f = await byLink(token);
  if (!f || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [a] = await db.select().from(schema.docAssets).where(and(eq(schema.docAssets.id, id), eq(schema.docAssets.fileId, f.id)));
  return a ? assetResponse(a) : new Response("Not found", { status: 404 });
}
