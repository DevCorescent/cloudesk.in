// Organisation structure: companies, branches, cost centres, currencies and
// rates, groups, data access and access reviews. Everyone in the workspace can
// read the structure (it labels their screens); owners and admins change it.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { COMMON_CURRENCIES } from "@/lib/org/model";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import * as org from "@/server/org/org";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const bodyAny = (ctx: AuthedContext) => readJson(ctx.req, z.unknown());

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const w = await org.who(ctx, orgId);
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = new URL(ctx.req.url).searchParams;
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const admin = () => {
    if (!w.admin) throw new ApiError("forbidden", "Only workspace owners and admins can see this");
  };
  switch (key) {
    case "GET meta": {
      const [companies, branches, units, currencies, groups] = await Promise.all([org.companies(orgId), org.branches(orgId), org.units(orgId), org.currencies(orgId), org.groups(orgId)]);
      const people = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId));
      return { me: { id: w.userId, admin: w.admin }, companies, branches, units, currencies, groups, people, common: COMMON_CURRENCIES, links: w.admin ? await org.linkables(orgId) : null };
    }
    case "POST companies":
      return { company: await org.saveCompany(w, null, await body(ctx)) };
    case "PUT companies :id":
      return { company: await org.saveCompany(w, id!, await body(ctx)) };
    case "POST companies :id default":
      await org.makeDefaultCompany(w, id!);
      return { ok: true };
    case "DELETE companies :id":
      await org.deleteCompany(w, id!);
      return { ok: true };

    case "POST branches":
      return { branch: await org.saveBranch(w, null, await body(ctx)) };
    case "POST branches import":
      return org.importBranches(w, await bodyAny(ctx));
    case "PUT branches :id":
      return { branch: await org.saveBranch(w, id!, await body(ctx)) };
    case "DELETE branches :id":
      await org.deleteBranch(w, id!);
      return { ok: true };
    case "POST links":
      await org.linkToBranch(w, await body(ctx));
      return { ok: true };

    case "POST units":
      return { unit: await org.saveUnit(w, null, await body(ctx)) };
    case "POST units import":
      return org.importUnits(w, await bodyAny(ctx));
    case "PUT units :id":
      return { unit: await org.saveUnit(w, id!, await body(ctx)) };
    case "DELETE units :id":
      await org.deleteUnit(w, id!);
      return { ok: true };

    case "POST currencies":
      return { currency: await org.saveCurrency(w, await body(ctx)) };
    case "GET rates":
      return { rates: await org.rates(orgId, qs.get("currency") ?? "") };
    case "POST rates":
      return { rate: await org.saveRate(w, await body(ctx)) };
    case "POST rates import":
      return org.importRates(w, await bodyAny(ctx));
    case "DELETE rates :id":
      await org.deleteRate(w, id!);
      return { ok: true };

    case "POST groups":
      return { group: await org.saveGroup(w, null, await body(ctx)) };
    case "PUT groups :id":
      return { group: await org.saveGroup(w, id!, await body(ctx)) };
    case "DELETE groups :id":
      await org.deleteGroup(w, id!);
      return { ok: true };

    case "GET access":
      admin();
      return { members: await org.accessSnapshot(orgId), reviews: await org.reviews(orgId) };
    case "PUT access :id":
      await org.setMemberAccess(w, id!, (await readJson(ctx.req, z.object({ access: z.unknown() }))).access);
      return { ok: true };
    case "POST reviews":
      return { review: await org.completeReview(w, await body(ctx)) };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
