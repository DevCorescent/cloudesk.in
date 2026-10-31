// A workspace's identity settings: single sign-on (OIDC), its verified
// domains, the SCIM token, and members' sign-in history.
import { z } from "zod";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, forbidden, notFound } from "@/server/http/errors";
import { addDomain, connection, removeConnection, removeDomain, saveConnection, verifyDomain } from "@/server/auth/sso";
import { revokeToken, rotateToken, tokenInfo } from "@/server/auth/scim";
import { workspaceLogins } from "@/server/auth/logins";
import { appUrl } from "@/server/services/mail";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const key = `${ctx.req.method} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  if (key === "GET logins") {
    await requireOrg(ctx, orgId, "audit:read");
    return workspaceLogins(orgId);
  }
  const { role } = await requireOrg(ctx, orgId, "org:update");
  // Single sign-on and SCIM decide who can sign in as which address and who gets added with what role, so an
  // admin pointing them at their own provider could become any member (owners included): owners only.
  if (ctx.req.method !== "GET" && role !== "owner") throw forbidden("Only workspace owners can change single sign-on and SCIM");
  const me = ctx.user.id;
  switch (key) {
    case "GET sso":
      return { ...(await connection(orgId)), scim: { token: await tokenInfo(orgId), baseUrl: appUrl("/api/v1/scim/v2") } };
    case "PUT sso": {
      const b = await body(ctx);
      // People joining through the provider or SCIM never become owners: an owner adds owners by hand.
      if (b.jitRole === "owner") throw new ApiError("validation_failed", "New people can't join as owners — invite them and make them owners by hand", { jitRole: ["Choose another role"] });
      return saveConnection(orgId, me, b);
    }
    case "DELETE sso":
      await removeConnection(orgId, me);
      return { ok: true };
    case "POST domains":
      return { domain: await addDomain(orgId, await body(ctx)) };
    case "DELETE domains :id":
      await removeDomain(orgId, id!);
      return { ok: true };
    case "POST domains :id verify":
      return verifyDomain(orgId, me, id!);
    case "POST scim":
      return { token: await rotateToken(orgId, me) };
    case "DELETE scim":
      await revokeToken(orgId, me);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
