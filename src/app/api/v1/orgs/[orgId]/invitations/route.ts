import { z } from "zod";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { ApiError } from "@/server/http/errors";
import { email, role, uuid } from "@/server/http/schemas";
import { accountFor } from "@/server/people/directory";
import { rateLimit } from "@/server/security/rate-limit";
import { assertUnlimited } from "@/server/services/custom-roles";
import { createInvitation, listInvitations } from "@/server/services/orgs";

export const GET = route<{ orgId: string }>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "members:manage");
  return { invitations: await listInvitations(orgId) };
});

// By email, or by an account found with its username (`userId`), whose email stays hidden.
export const POST = route<{ orgId: string }>(async (ctx, { orgId }) => {
  const m = await requireOrg(ctx, orgId, "members:manage");
  await assertUnlimited(orgId, ctx.user.id);
  await rateLimit(`invite:${orgId}`, 50, 24 * 3600_000);
  const input = await readJson(ctx.req, z.object({ email: email.optional(), userId: uuid.optional(), role }));
  if (!input.email && !input.userId) throw new ApiError("validation_failed", "Who should we invite?", { email: ["Enter an email, or pick someone from the search"] });
  const account = input.userId ? await accountFor(input.userId) : null;
  const to = account?.email ?? input.email!;
  const { invitation } = await createInvitation(orgId, { id: ctx.user.id, role: m.role, name: ctx.user.name }, to, input.role, account ? { userId: account.id } : {});
  return Response.json({ invitation: { id: invitation.id, email: account ? "" : invitation.email, label: account ? `${account.name}${account.username ? ` · @${account.username}` : ""}` : invitation.email, role: invitation.role, expiresAt: invitation.expiresAt } }, { status: 201 });
});
