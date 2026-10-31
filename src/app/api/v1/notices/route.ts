// Banners for the signed-in app: maintenance mode and the platform's
// announcement (for everyone, or only for workspaces on one plan).
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { effectivePlan } from "@/server/billing/billing";
import { route } from "@/server/http/handler";
import { noticeFor } from "@/server/platform/settings";

export const GET = route(async (ctx) => {
  const orgs = await db.select({ o: schema.organizations }).from(schema.memberships).innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId)).where(eq(schema.memberships.userId, ctx.user.id));
  const plans = new Set(orgs.map(({ o }) => effectivePlan(o)));
  const all = await noticeFor(null);
  const byPlan = (await Promise.all([...plans].map((p) => noticeFor(p)))).flat();
  const seen = new Set<string>();
  const notices = [...all, ...byPlan].filter((n) => (seen.has(n.kind + n.text) ? false : (seen.add(n.kind + n.text), true)));
  return { notices };
});
