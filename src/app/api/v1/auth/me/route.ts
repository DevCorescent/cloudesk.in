import { route } from "@/server/http/handler";
import { listOrgsForUser } from "@/server/services/orgs";

export const GET = route(async (ctx) => ({ user: ctx.user, organizations: await listOrgsForUser(ctx.user.id) }));
