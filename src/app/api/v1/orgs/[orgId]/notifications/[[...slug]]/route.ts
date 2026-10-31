// Notifications for the signed-in member of a workspace: the list, read
// marks, preferences and reminders; owners and admins edit the wording.
import { z } from "zod";
import { can } from "@/server/authz/permissions";
import { ApiError, notFound } from "@/server/http/errors";
import { readJson, requireOrg, route, type AuthedContext } from "@/server/http/handler";
import { addReminder, deleteReminder, getPrefs, list, markRead, myReminders, savePrefs, saveTemplate, templates } from "@/server/notify/notify";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  const admin = can(role, "org:update");
  const me = ctx.user.id;
  const [section, id] = slug;
  const m = ctx.req.method;
  const qs = new URL(ctx.req.url).searchParams;
  switch (`${m} ${section ?? ""}${id ? " :id" : ""}`) {
    case "GET ":
      return list(orgId, me, { unread: qs.get("unread") === "1", limit: Number(qs.get("limit") ?? 50) });
    case "POST read": {
      const b = z.object({ ids: z.union([z.array(z.uuid()).max(500), z.literal("all")]) }).parse(await body(ctx));
      await markRead(orgId, me, b.ids);
      return { ok: true };
    }
    case "GET prefs":
      return { prefs: await getPrefs(orgId, me) };
    case "PUT prefs":
      return { prefs: await savePrefs(orgId, me, await body(ctx)) };
    case "GET templates":
      if (!admin) throw new ApiError("forbidden", "Only owners and admins can change the wording");
      return { templates: await templates(orgId) };
    case "PUT templates :id":
      if (!admin) throw new ApiError("forbidden", "Only owners and admins can change the wording");
      await saveTemplate(orgId, id!, await body(ctx));
      return { ok: true };
    case "DELETE templates :id":
      if (!admin) throw new ApiError("forbidden", "Only owners and admins can change the wording");
      await saveTemplate(orgId, id!, null);
      return { ok: true };
    case "GET reminders":
      return { reminders: await myReminders(orgId, me) };
    case "POST reminders":
      return { reminder: await addReminder(orgId, me, await body(ctx)) };
    case "DELETE reminders :id":
      await deleteReminder(orgId, me, id!);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
