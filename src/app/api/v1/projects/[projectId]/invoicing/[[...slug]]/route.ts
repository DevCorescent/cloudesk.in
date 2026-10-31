import { route } from "@/server/http/handler";
import { projectScope } from "@/server/invoicing/books";
import { handleInvoicing } from "@/server/invoicing/http";

type P = { projectId: string; slug?: string[] };

const handler = route<P>(async (ctx, { projectId, slug }) => handleInvoicing(ctx, await projectScope(ctx, projectId), slug));
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
