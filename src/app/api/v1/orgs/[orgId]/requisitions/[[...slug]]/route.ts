// Requisitions API for a workspace. Dispatches on "METHOD section :id sub",
// like the other module APIs.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { can, type Role } from "@/server/authz/permissions";
import { notFound } from "@/server/http/errors";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { saveSettings, scope } from "@/server/requisitions/access";
import { act, addItem, counts, create, deleteTemplate, detail, file, fileItem, forContact, importLists, list, remove, removeItem, report, saveTemplate, templates, update, updateItem } from "@/server/requisitions/core";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

/** Mailboxes in the workspace (for "send from"), and who can own a requisition. */
async function people(orgId: string) {
  const [boxes, members] = await Promise.all([
    db.select({ id: schema.mailAccounts.id, address: schema.mailAccounts.address, displayName: schema.mailAccounts.displayName, status: schema.mailAccounts.status, shared: schema.mailAccounts.shared, ownerId: schema.mailAccounts.ownerId }).from(schema.mailAccounts).where(eq(schema.mailAccounts.orgId, orgId)),
    db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)),
  ]);
  return { mailboxes: boxes, members: members.filter((m) => can(m.role as Role, "rq:write")).map(({ id, name, email }) => ({ id, name, email })) };
}

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, subId, subAct] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}${subId ? (/^[0-9a-f-]{36}$/.test(subId) ? " :sid" : ` ${subId}`) : ""}${subAct ? ` ${subAct}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return { me: { id: s.userId, write: s.write, manage: s.manage }, settings: s.settings, counts: await counts(s), ...(await people(orgId)), links: { crm: s.has("crm"), mail: s.has("mail") } };
    case "GET lists":
      return { lists: await list(s, qs) };
    case "POST lists":
      return create(s, await body(ctx));
    case "POST lists import":
      return importLists(s, await readJson(ctx.req, z.unknown()));
    case "GET lists :id":
      return detail(s, id!);
    case "PATCH lists :id":
      return update(s, id!, await body(ctx));
    case "DELETE lists :id":
      await remove(s, id!);
      return { ok: true };
    case "POST lists :id send":
    case "POST lists :id pause":
    case "POST lists :id resume":
    case "POST lists :id cancel":
    case "POST lists :id complete":
    case "POST lists :id reopen":
    case "POST lists :id rotate":
      return act(s, id!, sub!);
    case "POST lists :id items":
      return addItem(s, id!, await body(ctx));
    case "PATCH lists :id items :sid":
      return updateItem(s, id!, subId!, await body(ctx));
    case "DELETE lists :id items :sid":
      return removeItem(s, id!, subId!);
    case "GET lists :id files :sid":
      return file(s, id!, subId!);
    case "PATCH lists :id files :sid": {
      const v = await readJson(ctx.req, z.object({ itemId: z.uuid().nullable() }));
      return fileItem(s, id!, subId!, v.itemId);
    }
    case "GET contact": {
      if (!qs.contactId) throw notFound("Contact");
      return { lists: await forContact(s, qs.contactId) };
    }
    case "GET templates":
      return templates(s);
    case "POST templates":
      return { template: await saveTemplate(s, null, await body(ctx)) };
    case "PUT templates :id":
      return { template: await saveTemplate(s, id!, await body(ctx)) };
    case "DELETE templates :id":
      await deleteTemplate(s, id!);
      return { ok: true };
    case "GET reports":
      return report(s);
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const PATCH = route<P>(handle);
export const DELETE = route<P>(handle);
