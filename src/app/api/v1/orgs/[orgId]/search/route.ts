// Smart search for the signed-in member: ?q= searches everything they can open
// (records, notes, email, meetings, chat, tasks, people); ?ai=1 says whether
// the AI answer mode is available; POST { question } answers from the results.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { askSearch } from "@/server/search/ai";
import { aiStatus, search } from "@/server/search/core";
import { rateLimit } from "@/server/security/rate-limit";

type P = { orgId: string };

export const GET = route<P>(async (ctx: AuthedContext, { orgId }: P) => {
  const url = new URL(ctx.req.url);
  if (url.searchParams.get("ai") === "1") return { ai: await aiStatus(ctx, orgId) };
  return { results: await search(ctx, orgId, url.searchParams.get("q") ?? "") };
});

export const POST = route<P>(async (ctx: AuthedContext, { orgId }: P) => {
  await rateLimit(`search-ai:${ctx.user.id}`, 60, 3_600_000);
  const { question } = await readJson(ctx.req, z.object({ question: z.string().trim().min(3, "Ask a question").max(500) }));
  return askSearch(ctx, orgId, question);
});
