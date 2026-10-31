import { disconnectGithub, githubConfigured, listConnections } from "@/server/auth/github";
import { route } from "@/server/http/handler";

export const GET = route(async (ctx) => ({ githubAvailable: githubConfigured(), connections: await listConnections(ctx.user.id) }));

export const DELETE = route(async (ctx) => {
  await disconnectGithub(ctx.user.id);
  return { ok: true };
});
