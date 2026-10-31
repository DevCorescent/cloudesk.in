// Closing months. A closed month takes no new entries and no changes — from
// people or from the automatic posting — for one company, or for every
// company when closed workspace-wide. Reopening is recorded in the audit log.
// The lock date in settings still works alongside it (everything up to a day).
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { fiscalYear } from "@/lib/org/model";
import { ApiError } from "../http/errors";
import { getCompany } from "../org/org";
import { audit } from "../services/audit";
import { check, requireManage, type Scope } from "./access";

export async function closedMonths(orgId: string) {
  return db.select().from(schema.accPeriods).where(eq(schema.accPeriods.orgId, orgId)).orderBy(schema.accPeriods.month);
}

/** A test for "is this date in a closed month for this company", loaded once. */
export async function closedTest(orgId: string) {
  const rows = await closedMonths(orgId);
  const all = new Set(rows.filter((r) => !r.companyId).map((r) => r.month));
  const by = new Set(rows.filter((r) => r.companyId).map((r) => `${r.companyId}|${r.month}`));
  return (date: string, companyId: string | null | undefined) => all.has(date.slice(0, 7)) || (!!companyId && by.has(`${companyId}|${date.slice(0, 7)}`));
}

export async function assertPeriodOpen(orgId: string, companyId: string | null | undefined, date: string, what = "This") {
  const rows = await db.select({ id: schema.accPeriods.id }).from(schema.accPeriods).where(and(eq(schema.accPeriods.orgId, orgId), eq(schema.accPeriods.month, date.slice(0, 7)), companyId ? or(isNull(schema.accPeriods.companyId), eq(schema.accPeriods.companyId, companyId)) : isNull(schema.accPeriods.companyId)));
  if (rows.length) throw new ApiError("conflict", `${what} is dated in ${date.slice(0, 7)}, which is closed. Reopen the month in Accounts → Settings to change it.`);
}

const closeSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"), companyId: z.uuid().nullable().default(null), note: z.string().trim().max(300).default("") });

export async function closeMonth(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(closeSchema, raw);
  if (v.companyId) await getCompany(s.orgId, v.companyId);
  const thisMonth = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  if (v.month > thisMonth) throw new ApiError("validation_failed", "A month that hasn't started can't be closed");
  const [r] = await db.insert(schema.accPeriods).values({ orgId: s.orgId, companyId: v.companyId, month: v.month, closedBy: s.userId, note: v.note }).onConflictDoNothing().returning();
  if (!r) throw new ApiError("conflict", `${v.month} is already closed`);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.month_closed", targetType: "acc_period", targetId: r.id, metadata: { month: v.month, companyId: v.companyId } });
  return r;
}

/** Close every month of a financial year at once (year-end). */
export async function closeYear(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(z.object({ year: z.string().regex(/^\d{4}-\d{2}$|^\d{4}$/), companyId: z.uuid().nullable().default(null) }), raw);
  const start = Number(v.year.slice(0, 4));
  const fy = fiscalYear(`${start}-${String(s.settings.fyStartMonth).padStart(2, "0")}-01`, s.settings.fyStartMonth);
  const thisMonth = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  if (fy.months[11] >= thisMonth) throw new ApiError("validation_failed", `${fy.label} hasn't ended yet`);
  let closed = 0;
  for (const month of fy.months) {
    const [r] = await db.insert(schema.accPeriods).values({ orgId: s.orgId, companyId: v.companyId, month, closedBy: s.userId, note: `Year-end ${fy.label}` }).onConflictDoNothing().returning();
    if (r) closed++;
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.year_closed", targetType: "acc_period", metadata: { year: fy.label, companyId: v.companyId, closed } });
  return { year: fy.label, closed };
}

export async function reopenMonth(s: Scope, id: string) {
  requireManage(s);
  const [p] = await db.select().from(schema.accPeriods).where(and(eq(schema.accPeriods.id, id), eq(schema.accPeriods.orgId, s.orgId)));
  if (!p) throw new ApiError("not_found", "That month isn't closed");
  await db.delete(schema.accPeriods).where(eq(schema.accPeriods.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "accounts.month_reopened", targetType: "acc_period", targetId: id, metadata: { month: p.month, companyId: p.companyId } });
}
