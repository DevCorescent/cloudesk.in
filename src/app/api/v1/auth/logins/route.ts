import { route } from "@/server/http/handler";
import { myLogins } from "@/server/auth/logins";

/** The signed-in person's recent sign-ins. */
export const GET = route(async (ctx) => ({ logins: await myLogins(ctx.user.id) }));
