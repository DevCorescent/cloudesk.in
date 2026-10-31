// Projects: who's on them, what they're billed at, their milestones, and how
// far along they are (tasks done, hours used against the budget).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { burn, milestoneSchema, projectSchema, type ProjectInput } from "@/lib/work/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { assertBook, check, getProject, nextCode, requireManage, requireWrite, todayIst, type Scope } from "./access";
import { contains } from "../security/like";

type Stats = { tasks: number; done: number; overdue: number; minutes: number; billableMinutes: number; unbilledMinutes: number; used: number };

/** Task and time totals per project; "used" is billable time at each person's rate, in paise. */
export async function projectStats(orgId: string, ids: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>();
  if (!ids.length) return out;
  const today = todayIst();
  const tasks = await db
    .select({ projectId: schema.workTasks.projectId, n: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${schema.workTasks.status} = 'done')::int`, overdue: sql<number>`count(*) filter (where ${schema.workTasks.status} <> 'done' and ${schema.workTasks.dueDate} < ${today})::int` })
    .from(schema.workTasks)
    .where(and(eq(schema.workTasks.orgId, orgId), inArray(schema.workTasks.projectId, ids), sql`${schema.workTasks.parentId} is null`))
    .groupBy(schema.workTasks.projectId);
  const time = (await db.execute(sql`
    select t.project_id, sum(t.minutes)::int as minutes,
      coalesce(sum(t.minutes) filter (where t.billable), 0)::int as billable,
      coalesce(sum(t.minutes) filter (where t.billable and t.invoice_id is null and t.status <> 'rejected'), 0)::int as unbilled,
      coalesce(sum(round(t.minutes * coalesce(t.billed_rate, m.rate, p.rate) / 60.0)) filter (where t.billable), 0)::bigint as used
    from work_time t join work_projects p on p.id = t.project_id left join work_members m on m.project_id = t.project_id and m.user_id = t.user_id
    where t.org_id = ${orgId} and t.project_id in ${ids} and t.status <> 'rejected'
    group by t.project_id`)) as unknown as { rows: { project_id: string; minutes: number; billable: number; unbilled: number; used: number }[] };
  for (const id of ids) out.set(id, { tasks: 0, done: 0, overdue: 0, minutes: 0, billableMinutes: 0, unbilledMinutes: 0, used: 0 });
  for (const t of tasks) Object.assign(out.get(t.projectId)!, { tasks: t.n, done: t.done, overdue: t.overdue });
  for (const t of time.rows) Object.assign(out.get(t.project_id)!, { minutes: t.minutes, billableMinutes: t.billable, unbilledMinutes: t.unbilled, used: Number(t.used) });
  return out;
}

export async function listProjects(s: Scope, f: { status?: string; q?: string; mine?: string } = {}) {
  const where = [eq(schema.workProjects.orgId, s.orgId)];
  if (f.status === "open") where.push(sql`${schema.workProjects.status} in ('planned','active','on_hold')`);
  else if (f.status && f.status !== "all") where.push(eq(schema.workProjects.status, f.status));
  if (f.q) where.push(sql`(${schema.workProjects.name} ilike ${contains(f.q)} or ${schema.workProjects.code} ilike ${contains(f.q)} or ${schema.workProjects.clientName} ilike ${contains(f.q)})`);
  if (f.mine === "1") where.push(sql`(${schema.workProjects.leadId} = ${s.userId} or exists (select 1 from work_members m where m.project_id = ${schema.workProjects.id} and m.user_id = ${s.userId}))`);
  const rows = await db.select().from(schema.workProjects).where(and(...where)).orderBy(sql`case ${schema.workProjects.status} when 'active' then 0 when 'planned' then 1 when 'on_hold' then 2 else 3 end`, asc(schema.workProjects.dueDate), desc(schema.workProjects.createdAt)).limit(500);
  const stats = await projectStats(s.orgId, rows.map((r) => r.id));
  const members = rows.length ? await db.select({ projectId: schema.workMembers.projectId, userId: schema.workMembers.userId }).from(schema.workMembers).where(inArray(schema.workMembers.projectId, rows.map((r) => r.id))) : [];
  return rows.map((p) => {
    const st = stats.get(p.id)!;
    return { ...publicProject(s, p), stats: st, burn: burn(p, { minutes: st.minutes, amount: st.used }), members: members.filter((m) => m.projectId === p.id).map((m) => m.userId) };
  });
}

/** Rates are for people who plan work; costs only for those who run it. */
function publicProject(s: Scope, p: typeof schema.workProjects.$inferSelect) {
  return s.write ? p : { ...p, rate: 0, fee: 0, budgetAmount: 0 };
}

export async function projectDetail(s: Scope, id: string) {
  const p = await getProject(s, id);
  const [stats, members, milestones] = await Promise.all([
    projectStats(s.orgId, [id]),
    db.select({ userId: schema.workMembers.userId, rate: schema.workMembers.rate, costRate: schema.workMembers.costRate, name: schema.users.name, email: schema.users.email }).from(schema.workMembers).innerJoin(schema.users, eq(schema.users.id, schema.workMembers.userId)).where(eq(schema.workMembers.projectId, id)).orderBy(asc(schema.users.name)),
    milestonesOf(id),
  ]);
  const st = stats.get(id)!;
  const deal = p.dealId ? (await db.select({ id: schema.crmDeals.id, title: schema.crmDeals.title, value: schema.crmDeals.value }).from(schema.crmDeals).where(and(eq(schema.crmDeals.id, p.dealId), eq(schema.crmDeals.orgId, s.orgId))))[0] ?? null : null;
  return {
    project: publicProject(s, p),
    stats: st,
    burn: burn(p, { minutes: st.minutes, amount: st.used }),
    members: members.map((m) => ({ ...m, rate: s.write ? m.rate : null, costRate: s.manage ? m.costRate : null })),
    milestones: milestones.map((m) => ({ ...m, amount: s.write ? m.amount : 0 })),
    deal: deal && s.has("crm") ? deal : null,
  };
}

async function checkRefs(s: Scope, v: ProjectInput) {
  if (v.ownerId) await assertBook(s.orgId, v.ownerId);
  if (v.clientId) {
    if (!v.ownerId) throw new ApiError("validation_failed", "Pick the books the client is in", { ownerId: ["Pick books"] });
    const [c] = await db.select({ id: schema.invoiceClients.id }).from(schema.invoiceClients).where(and(eq(schema.invoiceClients.id, v.clientId), eq(schema.invoiceClients.projectId, v.ownerId)));
    if (!c) throw new ApiError("validation_failed", "That client isn't in those books", { clientId: ["Unknown client"] });
  }
  if (v.dealId) {
    const [d] = await db.select({ id: schema.crmDeals.id }).from(schema.crmDeals).where(and(eq(schema.crmDeals.id, v.dealId), eq(schema.crmDeals.orgId, s.orgId)));
    if (!d) throw new ApiError("validation_failed", "That deal isn't in this workspace", { dealId: ["Unknown deal"] });
  }
  const users = [...new Set([...(v.members ?? []).map((m) => m.userId), ...(v.leadId ? [v.leadId] : [])])];
  if (users.length) {
    const found = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), inArray(schema.memberships.userId, users)));
    if (found.length !== users.length) throw new ApiError("validation_failed", "Everyone on a project must be in this workspace", { members: ["Not in this workspace"] });
  }
  if (v.startDate && v.dueDate && v.dueDate < v.startDate) throw new ApiError("validation_failed", "The due date is before the start", { dueDate: ["Before the start date"] });
}

export async function saveProject(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const before = id ? await getProject(s, id) : null;
  const v = check(projectSchema, raw);
  await checkRefs(s, v);
  if (v.clientId && !v.clientName) {
    const [c] = await db.select({ name: schema.invoiceClients.name, company: schema.invoiceClients.company }).from(schema.invoiceClients).where(eq(schema.invoiceClients.id, v.clientId));
    v.clientName = c?.company || c?.name || "";
  }
  const { members, ...fields } = v;
  const values = { ...fields, updatedAt: new Date() };
  const row = await db.transaction(async (tx) => {
    let p: typeof schema.workProjects.$inferSelect;
    if (before) {
      [p] = await tx.update(schema.workProjects).set(values).where(eq(schema.workProjects.id, before.id)).returning();
    } else {
      const code = await nextCode(s.orgId, s.settings.projectPrefix);
      [p] = await tx.insert(schema.workProjects).values({ ...values, rate: v.rate || s.settings.defaultRate, orgId: s.orgId, code, leadId: v.leadId ?? s.userId, createdBy: s.userId }).returning();
    }
    if (members) {
      const keep = new Map(members.map((m) => [m.userId, m]));
      // The lead is always on the project.
      if (p.leadId && !keep.has(p.leadId)) keep.set(p.leadId, { userId: p.leadId, rate: null, costRate: null });
      const old = await tx.select().from(schema.workMembers).where(eq(schema.workMembers.projectId, p.id));
      await tx.delete(schema.workMembers).where(eq(schema.workMembers.projectId, p.id));
      if (keep.size)
        await tx.insert(schema.workMembers).values(
          [...keep.values()].map((m) => {
            const was = old.find((o) => o.userId === m.userId);
            // Only owners and admins set cost rates; others keep what was there.
            return { projectId: p.id, userId: m.userId, rate: m.rate, costRate: s.manage ? m.costRate : (was?.costRate ?? null) };
          }),
        );
    } else if (!before && p.leadId) {
      await tx.insert(schema.workMembers).values({ projectId: p.id, userId: p.leadId }).onConflictDoNothing();
    }
    return p;
  });
  if (!before) await audit({ orgId: s.orgId, actorId: s.userId, action: "work.project_created", targetType: "work_project", targetId: row.id, metadata: { code: row.code, name: row.name } });
  return row;
}

export async function setStatus(s: Scope, id: string, status: string) {
  requireWrite(s);
  const p = await getProject(s, id);
  const v = check(projectSchema.shape.status, status);
  await db.update(schema.workProjects).set({ status: v, updatedAt: new Date() }).where(eq(schema.workProjects.id, p.id));
}

export async function deleteProject(s: Scope, id: string) {
  requireManage(s);
  const p = await getProject(s, id);
  const [billed] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workTime).where(and(eq(schema.workTime.projectId, id), sql`${schema.workTime.invoiceId} is not null`));
  const [mbilled] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workMilestones).where(and(eq(schema.workMilestones.projectId, id), sql`${schema.workMilestones.invoiceId} is not null`));
  if (billed.n || mbilled.n) throw new ApiError("conflict", "Time or milestones on this project have been invoiced. Mark it cancelled or done instead, so the record stays.");
  await db.delete(schema.workProjects).where(eq(schema.workProjects.id, p.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "work.project_deleted", targetType: "work_project", targetId: p.id, metadata: { code: p.code, name: p.name } });
}

// ── Milestones ──────────────────────────────────────────────────────────────

export async function milestonesOf(projectId: string) {
  const rows = await db.select().from(schema.workMilestones).where(eq(schema.workMilestones.projectId, projectId)).orderBy(asc(schema.workMilestones.position), asc(schema.workMilestones.dueDate));
  if (!rows.length) return [];
  const counts = await db.select({ id: schema.workTasks.milestoneId, n: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${schema.workTasks.status} = 'done')::int` }).from(schema.workTasks).where(inArray(schema.workTasks.milestoneId, rows.map((r) => r.id))).groupBy(schema.workTasks.milestoneId);
  return rows.map((m) => ({ ...m, tasks: counts.find((c) => c.id === m.id)?.n ?? 0, tasksDone: counts.find((c) => c.id === m.id)?.done ?? 0 }));
}

async function getMilestone(s: Scope, id: string) {
  const [m] = await db.select().from(schema.workMilestones).where(and(eq(schema.workMilestones.id, id), eq(schema.workMilestones.orgId, s.orgId)));
  if (!m) throw notFound("Milestone");
  return m;
}

export async function saveMilestone(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(milestoneSchema, raw);
  await getProject(s, v.projectId);
  if (id) {
    const m = await getMilestone(s, id);
    if (m.invoiceId && v.amount !== m.amount) throw new ApiError("conflict", "This milestone has been invoiced, so its amount can't change");
    const [row] = await db.update(schema.workMilestones).set({ name: v.name, dueDate: v.dueDate, amount: v.amount }).where(eq(schema.workMilestones.id, m.id)).returning();
    return row;
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.workMilestones).where(eq(schema.workMilestones.projectId, v.projectId));
  const [row] = await db.insert(schema.workMilestones).values({ ...v, orgId: s.orgId, position: n }).returning();
  return row;
}

export async function completeMilestone(s: Scope, id: string, done: boolean) {
  requireWrite(s);
  const m = await getMilestone(s, id);
  await db.update(schema.workMilestones).set({ doneAt: done ? (m.doneAt ?? new Date()) : null }).where(eq(schema.workMilestones.id, m.id));
}

export async function deleteMilestone(s: Scope, id: string) {
  requireWrite(s);
  const m = await getMilestone(s, id);
  if (m.invoiceId) throw new ApiError("conflict", "This milestone has been invoiced. Void the invoice first.");
  await db.delete(schema.workMilestones).where(eq(schema.workMilestones.id, m.id));
}

/** What a new project from a won CRM deal starts with: its title, value, company, and a matching invoicing client. */
export async function fromDeal(s: Scope, dealId: string) {
  requireWrite(s);
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) throw notFound("Deal");
  const [d] = await db
    .select({ id: schema.crmDeals.id, title: schema.crmDeals.title, value: schema.crmDeals.value, status: schema.crmDeals.status, company: schema.crmCompanies.name, contact: schema.crmContacts.name, email: schema.crmContacts.email })
    .from(schema.crmDeals)
    .leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, schema.crmDeals.companyId))
    .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.crmDeals.contactId))
    .where(and(eq(schema.crmDeals.id, dealId), eq(schema.crmDeals.orgId, s.orgId)));
  if (!d) throw notFound("Deal");
  const [existing] = await db.select({ id: schema.workProjects.id, code: schema.workProjects.code }).from(schema.workProjects).where(and(eq(schema.workProjects.orgId, s.orgId), eq(schema.workProjects.dealId, d.id)));
  // A client in the workspace's books with the same company name or email.
  const who = d.company || d.contact || "";
  const match = who || d.email
    ? ((await db.execute(sql`
        select c.id, c.project_id as owner_id from invoice_clients c join invoice_owners o on o.id = c.project_id
          left join finance_books b on b.id = o.book_id left join projects p on p.id = o.project_id
        where coalesce(b.org_id, p.org_id) = ${s.orgId} and c.archived_at is null
          and (lower(c.company) = lower(${who}) or lower(c.name) = lower(${who}) or (${d.email ?? ""} <> '' and lower(c.email) = lower(${d.email ?? ""})))
        limit 1`)) as unknown as { rows: { id: string; owner_id: string }[] }).rows[0]
    : undefined;
  return { deal: { id: d.id, title: d.title, value: Number(d.value), status: d.status, company: who }, existing: existing ?? null, prefill: { name: d.title, dealId: d.id, clientName: who, ownerId: match?.owner_id ?? null, clientId: match?.id ?? null, billing: "fixed" as const, fee: Number(d.value) } };
}
