// Your profile: name, username, a phone number people can find you by, and
// whether people outside your workspaces can find you at all.
import { z } from "zod";
import { readJson, route } from "@/server/http/handler";
import { getProfile, updateProfile, usernameFree } from "@/server/people/directory";
import { rateLimit } from "@/server/security/rate-limit";

export const GET = route(async (ctx) => {
  const check = new URL(ctx.req.url).searchParams.get("username");
  if (check !== null) {
    await rateLimit(`uname:${ctx.user.id}`, 60, 60_000);
    return usernameFree(ctx.user.id, check);
  }
  return { profile: await getProfile(ctx.user.id) };
});

export const PATCH = route(async (ctx) => {
  await rateLimit(`profile:${ctx.user.id}`, 30, 3600_000);
  return { profile: await updateProfile(ctx.user.id, await readJson(ctx.req, z.unknown())) };
});
