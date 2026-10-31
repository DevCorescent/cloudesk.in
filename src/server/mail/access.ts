// Who may see which mailbox. Everyone can connect their own mailboxes; a team
// inbox is visible to its owner, the people added to it, and (for managing)
// workspace owners and admins. Every Mail call starts here.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Scope = { orgId: string; userId: string; userName: string; userEmail: string; role: Role; manage: boolean; has: (m: ModuleId) => boolean };
export type Account = typeof schema.mailAccounts.$inferSelect;

export function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "mail:use");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "mail")) throw new ApiError("forbidden", "Switch on Mail in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  if (!visibleTo(visible, "mail")) throw new ApiError("forbidden", "Your role doesn't include Mail");
  return { orgId, userId: ctx.user.id, userName: ctx.user.name, userEmail: ctx.user.email, role, manage: can(role, "mail:manage"), has: (id) => visibleTo(visible, id) };
}

/**
 * The same scope for someone acting in the background (a recurring email
 * going out): they must still be in the workspace, with Mail on and in their role.
 * Null when they no longer may.
 */
export async function scopeFor(orgId: string, userId: string): Promise<Scope | null> {
  const [row] = await db
    .select({ role: schema.memberships.role, allowed: schema.customRoles.modules, modules: schema.organizations.modules, name: schema.users.name, email: schema.users.email, disabled: schema.users.disabledAt })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId))
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  if (!row || row.disabled || !isOn(row.modules, "mail")) return null;
  const role = row.role as Role;
  if (!can(role, "mail:use")) return null;
  const visible = { modules: row.modules ?? null, allowed: (row.allowed as string[] | null) ?? null };
  if (!visibleTo(visible, "mail")) return null;
  return { orgId, userId, userName: row.name, userEmail: row.email, role, manage: can(role, "mail:manage"), has: (id) => visibleTo(visible, id) };
}

/** Mailboxes this person can read: their own, and team inboxes they're in. */
export async function accountsFor(s: Scope): Promise<Account[]> {
  const A = schema.mailAccounts;
  return db
    .select()
    .from(A)
    .where(and(eq(A.orgId, s.orgId), or(eq(A.ownerId, s.userId), and(eq(A.shared, true), sql`exists (select 1 from mail_account_members m where m.account_id = ${A.id} and m.user_id = ${s.userId})`), s.manage ? eq(A.shared, true) : sql`false`)))
    .orderBy(A.createdAt);
}

export async function accountIds(s: Scope) {
  return (await accountsFor(s)).map((a) => a.id);
}

/** One mailbox, if this person may use it; `edit` also needs to own it (or manage a team inbox). */
export async function account(s: Scope, id: string, edit = false): Promise<Account> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Mailbox");
  const a = (await accountsFor(s)).find((x) => x.id === id);
  if (!a) throw notFound("Mailbox");
  if (edit && a.ownerId !== s.userId && !(a.shared && s.manage)) throw new ApiError("forbidden", "Only the mailbox's owner (or an admin, for a team inbox) can change it");
  return a;
}

/** A thread, if it's in a mailbox this person may read. */
export async function thread(s: Scope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Conversation");
  const ids = await accountIds(s);
  if (!ids.length) throw notFound("Conversation");
  const [t] = await db.select().from(schema.mailThreads).where(and(eq(schema.mailThreads.id, id), inArray(schema.mailThreads.accountId, ids)));
  if (!t) throw notFound("Conversation");
  return t;
}

export async function membersOf(accountIdList: string[]) {
  if (!accountIdList.length) return new Map<string, string[]>();
  const rows = await db.select().from(schema.mailAccountMembers).where(inArray(schema.mailAccountMembers.accountId, accountIdList));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.accountId, [...(out.get(r.accountId) ?? []), r.userId]);
  return out;
}
