import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hasLlm } from "@/server/ai/gateway";
import { notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { getChatbot, listConversations, messagesOf, previewAnswer, saveChatbot, staffReply } from "@/server/knowledge/chat";
import { addSource, deleteSource, embeddingsEnabled, ensureBuiltInSources, listSources, reindexProject } from "@/server/knowledge/kb";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";

type P = { projectId: string; slug?: string[] };
const uuid = (v: string | undefined) => !!v && z.uuid().safeParse(v).success;

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [section, id, action] = slug;
  const key = `${ctx.req.method} ${[section, id && ":id", action].filter(Boolean).join(" ")}`.trim();
  switch (key) {
    case "GET": {
      const { project } = await requireProject(ctx, projectId, "project:read");
      await ensureBuiltInSources(projectId);
      const [stats] = await db.select({ n: schema.kbChunks.id }).from(schema.kbChunks).where(eq(schema.kbChunks.projectId, projectId)).limit(1);
      return { chatbot: await getChatbot(projectId), sources: await listSources(projectId), indexed: !!stats, ai: await hasLlm(project.orgId), embeddings: embeddingsEnabled() };
    }
    case "PUT": {
      const { project } = await requireProject(ctx, projectId, "project:update");
      const body = await readJson(ctx.req, z.object({ enabled: z.boolean(), name: z.string().trim().min(1).max(40), greeting: z.string().trim().max(300), instructions: z.string().max(2000), handoffEmail: z.union([z.literal(""), z.email().max(200)]), showLauncher: z.boolean() }));
      const out = await saveChatbot(projectId, body);
      await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "chatbot.updated", targetType: "project", targetId: projectId, metadata: { enabled: body.enabled } });
      return { chatbot: out };
    }
    case "POST sources": {
      await requireProject(ctx, projectId, "project:update");
      await rateLimit(`kb-src:${ctx.user.id}`, 60, 3600_000);
      const body = await readJson(ctx.req, z.discriminatedUnion("kind", [z.object({ kind: z.literal("text"), title: z.string().max(120), content: z.string().max(200_000) }), z.object({ kind: z.literal("url"), title: z.string().max(120).default(""), url: z.string().max(500) })]));
      return Response.json({ source: await addSource(projectId, body) }, { status: 201 });
    }
    case "DELETE sources :id":
      await requireProject(ctx, projectId, "project:update");
      if (!uuid(id)) throw notFound("Source");
      await deleteSource(projectId, id);
      return { ok: true };
    case "POST reindex":
      await requireProject(ctx, projectId, "project:update");
      await rateLimit(`kb-reindex:${projectId}`, 20, 3600_000);
      await reindexProject(projectId);
      return { sources: await listSources(projectId) };
    case "POST test": {
      const { project } = await requireProject(ctx, projectId, "project:update");
      await rateLimit(`chat-test:${ctx.user.id}`, 60, 3600_000);
      const { question } = await readJson(ctx.req, z.object({ question: z.string().max(1000) }));
      return previewAnswer(project, question);
    }
    case "GET conversations":
      await requireProject(ctx, projectId, "submissions:read");
      return { conversations: await listConversations(projectId) };
    case "GET conversations :id": {
      await requireProject(ctx, projectId, "submissions:read");
      if (!uuid(id)) throw notFound("Conversation");
      const [c] = await db.select().from(schema.chatConversations).where(and(eq(schema.chatConversations.id, id), eq(schema.chatConversations.projectId, projectId)));
      if (!c) throw notFound("Conversation");
      return { conversation: c, messages: await messagesOf(c.id) };
    }
    case "POST conversations :id reply": {
      await requireProject(ctx, projectId, "submissions:read");
      if (!uuid(id)) throw notFound("Conversation");
      const body = await readJson(ctx.req, z.object({ text: z.string().max(4000).default(""), close: z.boolean().default(false) }));
      return staffReply(projectId, id, body.text, body.close);
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
