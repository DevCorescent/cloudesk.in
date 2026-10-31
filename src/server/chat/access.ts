// Who may use Chat and see which conversation. Public channels are open to
// everyone in the workspace (they can read and join); private channels,
// group chats and DMs only to their members. Owners and admins of the
// workspace can manage any channel but never read private ones they're not in.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

/** A guest (someone outside the workspace) sees one conversation, and without history only what came after they joined. */
export type GuestOf = { id: string; channelId: string; since: number; history: boolean; files: boolean };
export type ChatScope = { orgId: string; userId: string; userName: string; userEmail: string; role: Role; manage: boolean; has: (m: ModuleId) => boolean; ctx: AuthedContext; guest?: GuestOf };
export type Channel = typeof schema.teamChannels.$inferSelect;
export type Member = typeof schema.teamMembers.$inferSelect;
export { check } from "../mail/access";

export async function chatScope(ctx: AuthedContext, orgId: string): Promise<ChatScope> {
  const { role } = await requireOrg(ctx, orgId, "chat:use");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "chat")) throw new ApiError("forbidden", "Switch on Chat in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  if (!visibleTo(visible, "chat")) throw new ApiError("forbidden", "Your role doesn't include Chat");
  return { orgId, userId: ctx.user.id, userName: ctx.user.name, userEmail: ctx.user.email, role, manage: can(role, "chat:manage"), has: (id) => visibleTo(visible, id), ctx };
}

const isUuid = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

/**
 * A conversation this person may open. `need`: "read" (public channels count),
 * "post" (a member, and allowed to post), "admin" (a channel owner/admin, or a
 * workspace admin for public channels and ones they belong to).
 */
export async function channelFor(s: ChatScope, id: string, need: "read" | "post" | "admin" = "read"): Promise<{ c: Channel; m: Member | null }> {
  if (!isUuid(id)) throw notFound("Conversation");
  const [c] = await db.select().from(schema.teamChannels).where(and(eq(schema.teamChannels.id, id), eq(schema.teamChannels.orgId, s.orgId)));
  if (!c) throw notFound("Conversation");
  const [m] = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.channelId, id), eq(schema.teamMembers.userId, s.userId)));
  const open = c.kind === "channel" && c.visibility === "public" && !s.guest;
  if (!m && !open) throw notFound("Conversation");
  if (s.guest && (c.id !== s.guest.channelId || m?.role !== "guest")) throw notFound("Conversation");
  if (need === "post") {
    if (!m) throw new ApiError("forbidden", "Join the channel to post");
    if (c.archived) throw new ApiError("conflict", "This channel is archived");
    if (c.settings.posting === "admins" && m.role !== "owner" && m.role !== "admin" && !s.manage) throw new ApiError("forbidden", "Only the channel's admins post here");
  }
  if (need === "admin") {
    const ok = m?.role === "owner" || m?.role === "admin" || (s.manage && (open || !!m));
    if (!ok) throw new ApiError("forbidden", "Only the channel's admins can change this");
  }
  return { c, m: m ?? null };
}

export async function messageFor(s: ChatScope, id: string, need: "read" | "post" | "admin" = "read") {
  if (!isUuid(id)) throw notFound("Message");
  const [msg] = await db.select().from(schema.teamMessages).where(and(eq(schema.teamMessages.id, id), eq(schema.teamMessages.orgId, s.orgId)));
  if (!msg) throw notFound("Message");
  // Scheduled messages are only their author's until they post.
  if (msg.scheduledFor && msg.authorId !== s.userId) throw notFound("Message");
  if (s.guest && !s.guest.history && msg.seq <= s.guest.since) throw notFound("Message");
  const { c, m } = await channelFor(s, msg.channelId, need);
  return { msg, c, m };
}
