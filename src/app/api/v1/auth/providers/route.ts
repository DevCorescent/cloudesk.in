import { githubConfigured } from "@/server/auth/github";
import { route } from "@/server/http/handler";

/** Which sign-in providers are available (the login page hides the rest). */
export const GET = route(async () => ({ github: githubConfigured() }), { auth: false });
