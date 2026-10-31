// Approvals for a workspace: the queue, requests, decisions, policies,
// delegations and analytics. Everyone in the workspace can see their own
// queue and requests; owners and admins write policies and see analytics.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { APPROVAL_KINDS, ROLE_NAMES } from "@/lib/approvals/model";
import { isOn } from "@/lib/workspace/modules";
import { can } from "@/server/authz/permissions";
import { analytics, decide, describe, forDoc, getRequest, mine, queue } from "@/server/approvals/engine";
import { addDelegation, deleteDelegation, delegations, deletePolicy, policies, savePolicy } from "@/server/approvals/policies";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  const admin = can(role, "org:update");
  const w = { orgId, userId: ctx.user.id, admin };
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = new URL(ctx.req.url).searchParams;
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  switch (key) {
    case "GET meta": {
      const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
      const people = await db.select({ id: schema.users.id, name: schema.users.name, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId));
      const departments = isOn(org?.modules, "hr") ? await db.select({ id: schema.hrDepartments.id, name: schema.hrDepartments.name }).from(schema.hrDepartments).where(eq(schema.hrDepartments.orgId, orgId)) : [];
      // Only kinds whose module is on can be given a policy.
      const kinds = Object.entries(APPROVAL_KINDS).filter(([, k]) => isOn(org?.modules, k.module)).map(([kind, k]) => ({ kind, ...k }));
      const groups = await db.select({ id: schema.orgGroups.id, name: schema.orgGroups.name }).from(schema.orgGroups).where(eq(schema.orgGroups.orgId, orgId));
      return { me: { id: ctx.user.id, admin }, kinds, people, roles: ROLE_NAMES, departments, groups };
    }
    case "GET queue":
      return { requests: await queue(orgId, ctx.user.id) };
    case "GET mine":
      return { requests: await mine(orgId, ctx.user.id) };
    case "GET doc":
      return { requests: await forDoc(orgId, qs.get("kind") ?? "", qs.get("refId") ?? "", ctx.user.id) };
    case "GET requests :id": {
      const r = await getRequest(orgId, id!);
      // Requesters, approvers and admins can open a request; it can hold amounts and names.
      const d = await describe(r, ctx.user.id);
      if (!admin && r.requesterId !== ctx.user.id && !d.canAct) {
        const [acted] = await db.select({ id: schema.approvalActions.id }).from(schema.approvalActions).where(and(eq(schema.approvalActions.requestId, r.id), eq(schema.approvalActions.userId, ctx.user.id))).limit(1);
        if (!acted) throw notFound("Approval");
      }
      return { request: d };
    }
    case "POST requests :id decide": {
      const b = z.object({ approve: z.boolean(), note: z.string().max(1000).default("") }).parse(await body(ctx));
      return decide(orgId, ctx.user.id, id!, b.approve, b.note);
    }
    case "GET policies":
      if (!admin) throw new ApiError("forbidden", "Only owners and admins can see approval rules");
      return { policies: await policies(orgId) };
    case "POST policies":
      return { policy: await savePolicy(w, null, await body(ctx)) };
    case "PUT policies :id":
      return { policy: await savePolicy(w, id!, await body(ctx)) };
    case "DELETE policies :id":
      await deletePolicy(w, id!);
      return { ok: true };
    case "GET delegations":
      return { delegations: await delegations(w) };
    case "POST delegations":
      return { delegation: await addDelegation(w, await body(ctx)) };
    case "DELETE delegations :id":
      await deleteDelegation(w, id!);
      return { ok: true };
    case "GET analytics":
      if (!admin) throw new ApiError("forbidden", "Only owners and admins can see approval analytics");
      return analytics(orgId);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
