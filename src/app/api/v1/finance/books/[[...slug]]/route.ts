// Standalone finance books, outside any project.
//   GET  /api/v1/finance/books?orgId=…   → the workspace's books
//   POST /api/v1/finance/books           → { orgId, name } creates one
//   *    /api/v1/finance/books/:id/…     → every invoicing endpoint for that book
import { z } from "zod";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { bookScope, createBook, listBooks } from "@/server/invoicing/books";
import { handleInvoicing } from "@/server/invoicing/http";
import { rateLimit } from "@/server/security/rate-limit";

type P = { slug?: string[] };

const handler = route<P>(async (ctx, { slug = [] }) => {
  const [bookId, ...rest] = slug;
  if (!bookId) {
    if (ctx.req.method === "GET") {
      const orgId = new URL(ctx.req.url).searchParams.get("orgId") ?? "";
      await requireOrg(ctx, orgId, "invoices:manage");
      return { books: await listBooks(orgId) };
    }
    if (ctx.req.method === "POST") {
      const body = await readJson(ctx.req, z.object({ orgId: z.uuid(), name: z.string().trim().max(80).default("") }));
      await requireOrg(ctx, body.orgId, "invoices:manage");
      await rateLimit(`book-create:${ctx.user.id}`, 20, 3600_000);
      return Response.json({ book: await createBook(body.orgId, ctx.user.id, body.name) }, { status: 201 });
    }
    throw notFound("Route");
  }
  return handleInvoicing(ctx, await bookScope(ctx, bookId), rest);
});
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
