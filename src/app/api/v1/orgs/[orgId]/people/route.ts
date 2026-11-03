// Find people to invite: by username as you type, by an exact email or phone
// number, or among the workspace's own contacts. Members of the workspace only.
import { requireOrg, route } from "@/server/http/handler";
import { findPeople } from "@/server/people/directory";
import { rateLimit } from "@/server/security/rate-limit";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:read");
  await rateLimit(`people:${ctx.user.id}`, 120, 60_000);
  const url = new URL(ctx.req.url);
  return findPeople(orgId, ctx.user.id, (url.searchParams.get("q") ?? "").slice(0, 120), { contacts: url.searchParams.get("contacts") !== "0" });
});
