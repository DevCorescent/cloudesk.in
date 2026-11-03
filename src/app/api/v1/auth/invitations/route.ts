// Workspace invitations waiting for you (sent to your username or your
// email), and accepting or declining one without the emailed link.
import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { uuid } from "@/server/http/schemas";
import { answerInvitation, myInvitations } from "@/server/services/orgs";

export const GET = route(async (ctx) => ({ invitations: await myInvitations(ctx.user) }));

export const POST = route(async (ctx) => {
  const { id, accept } = await readJson(ctx.req, z.object({ id: uuid, accept: z.boolean() }));
  return answerInvitation(id, ctx.user, accept);
});
