import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listOrgsForUser } from "../services/orgs";
import { resolveSession, SESSION_COOKIE } from "./session";

export const ORG_COOKIE = "cc_org";

/** For server components: the signed-in user, or null. */
export async function getPageSession() {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}

/** Requires a session and resolves the active organization. */
export async function requirePageSession(next = "/home") {
  const session = await getPageSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  const orgs = await listOrgsForUser(session.user.id);
  const store = await cookies();
  const wanted = store.get(ORG_COOKIE)?.value;
  const activeOrg = orgs.find((o) => o.id === wanted) ?? orgs[0] ?? null;
  return { user: session.user, orgs, activeOrg };
}
