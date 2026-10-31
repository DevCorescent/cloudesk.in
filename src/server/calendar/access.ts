// Who may use Calendar, and each person's own calendars. Calendars are
// personal: you see your own events (including those added from team-inbox
// invites you chose to add). Every Calendar call starts here.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CAL_COLORS } from "@/lib/calendar/model";
import { isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";

export type CalScope = { orgId: string; userId: string; userName: string; userEmail: string; has: (m: ModuleId) => boolean };
export type CalEvent = typeof schema.calEvents.$inferSelect;
export { check } from "../mail/access";

export async function calScope(ctx: AuthedContext, orgId: string): Promise<CalScope> {
  await requireOrg(ctx, orgId, "calendar:use");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "calendar")) throw new ApiError("forbidden", "Switch on Calendar in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  if (!visibleTo(visible, "calendar")) throw new ApiError("forbidden", "Your role doesn't include Calendar");
  return { orgId, userId: ctx.user.id, userName: ctx.user.name, userEmail: ctx.user.email, has: (id) => visibleTo(visible, id) };
}

const C = schema.calCalendars;

/** Your calendars; a "Work" (default) and a "Personal" one are made the first time. */
export async function calendarsOf(orgId: string, userId: string) {
  let rows = await db.select().from(C).where(and(eq(C.orgId, orgId), eq(C.ownerId, userId))).orderBy(C.createdAt);
  if (!rows.length) {
    // First visit: several requests arrive at once (the home page, the calendar) — only one makes them.
    rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`calendars:${orgId}:${userId}`}))`);
      const now = await tx.select().from(C).where(and(eq(C.orgId, orgId), eq(C.ownerId, userId))).orderBy(C.createdAt);
      if (now.length) return now;
      return tx.insert(C).values([{ orgId, ownerId: userId, name: "Work", color: CAL_COLORS[0]!, isDefault: true }, { orgId, ownerId: userId, name: "Personal", color: CAL_COLORS[2]! }]).returning();
    });
  }
  return rows;
}

export async function defaultCalendar(orgId: string, userId: string) {
  const rows = await calendarsOf(orgId, userId);
  return rows.find((r) => r.isDefault) ?? rows[0]!;
}

export async function ownCalendar(s: CalScope, id: string) {
  const [c] = await db.select().from(C).where(and(eq(C.id, id), eq(C.orgId, s.orgId), eq(C.ownerId, s.userId)));
  if (!c) throw notFound("Calendar");
  return c;
}

export async function ownEvent(s: CalScope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Event");
  const [e] = await db.select().from(schema.calEvents).where(and(eq(schema.calEvents.id, id), eq(schema.calEvents.orgId, s.orgId), eq(schema.calEvents.ownerId, s.userId)));
  if (!e) throw notFound("Event");
  return e;
}
