// Projects+: what each task waits on (and the schedule and critical path that
// follow), who's booked on what against their capacity less HR leave, project
// expenses (billed with markup and counted in profit), risks and issues,
// change requests that move the budget, fee and due date once approved, and
// links to the project's documents.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDays, allocatedHours, allocationSchema, capacityHours, changeSchema, criticalPath, expenseSchema, linkSchema, reschedule, riskLevel, riskSchema, riskScore, wouldLoop } from "@/lib/work/model";
import { gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { check, getProject, leaveByUser, people, requireManage, requirePart, requireWrite, todayIst, type Scope } from "./access";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
async function getRow<T extends { id: string; orgId: string }>(table: typeof schema.workTaskLinks | typeof schema.workAllocations | typeof schema.workExpenses | typeof schema.workRisks | typeof schema.workChanges | typeof schema.workDocs, s: Scope, id: string, what: string): Promise<T> {
  if (!isId(id)) throw notFound(what);
  const [r] = await db.select().from(table).where(and(eq(table.id, id), eq(table.orgId, s.orgId)));
  if (!r) throw notFound(what);
  return r as unknown as T;
}

// ── Dependencies & schedule ─────────────────────────────────────────────────

/** Every task on the project with its dates, the links between them, and the critical path. */
export async function schedule(s: Scope, projectId: string) {
  requirePart(s, "planning");
  const p = await getProject(s, projectId);
  const [tasks, links] = await Promise.all([
    db.select({ id: schema.workTasks.id, number: schema.workTasks.number, title: schema.workTasks.title, status: schema.workTasks.status, startDate: schema.workTasks.startDate, dueDate: schema.workTasks.dueDate, assigneeId: schema.workTasks.assigneeId, parentId: schema.workTasks.parentId, estimateHours: schema.workTasks.estimateHours }).from(schema.workTasks).where(eq(schema.workTasks.projectId, p.id)).orderBy(asc(schema.workTasks.startDate), asc(schema.workTasks.number)),
    db.select().from(schema.workTaskLinks).where(eq(schema.workTaskLinks.projectId, p.id)),
  ]);
  const ls = links.map((l) => ({ ...l, type: l.type as "FS" | "SS" }));
  const cp = criticalPath(tasks, ls);
  const pending = reschedule(tasks.map((t) => ({ ...t, done: t.status === "done" })), ls);
  return {
    project: { id: p.id, code: p.code, name: p.name, startDate: p.startDate, dueDate: p.dueDate },
    tasks,
    links,
    critical: cp.ids,
    finish: cp.finish,
    // The schedule finishing after the project is due.
    late: !!(cp.finish && p.dueDate && cp.finish > p.dueDate),
    // Tasks that start before what they wait on allows.
    conflicts: [...pending.keys()],
  };
}

export async function addLink(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "planning");
  const v = check(linkSchema, raw);
  const tasks = await db.select({ id: schema.workTasks.id, projectId: schema.workTasks.projectId }).from(schema.workTasks).where(and(eq(schema.workTasks.orgId, s.orgId), inArray(schema.workTasks.id, [v.fromId, v.toId])));
  if (tasks.length !== (v.fromId === v.toId ? 1 : 2)) throw notFound("Task");
  if (tasks[0].projectId !== (tasks[1] ?? tasks[0]).projectId) throw new ApiError("validation_failed", "Both tasks must be on the same project");
  const projectId = tasks[0].projectId;
  const existing = await db.select({ fromId: schema.workTaskLinks.fromId, toId: schema.workTaskLinks.toId }).from(schema.workTaskLinks).where(eq(schema.workTaskLinks.projectId, projectId));
  if (existing.some((l) => l.fromId === v.fromId && l.toId === v.toId)) throw new ApiError("conflict", "Those tasks are already linked");
  if (wouldLoop(existing, v)) throw new ApiError("validation_failed", "That would make a loop: a task can't wait on itself, directly or through others");
  const [row] = await db.insert(schema.workTaskLinks).values({ ...v, orgId: s.orgId, projectId }).returning();
  return row;
}

export async function deleteLink(s: Scope, id: string) {
  requireWrite(s);
  const l = await getRow<typeof schema.workTaskLinks.$inferSelect>(schema.workTaskLinks, s, id, "Link");
  await db.delete(schema.workTaskLinks).where(eq(schema.workTaskLinks.id, l.id));
}

/** Push tasks later so each starts when what it waits on allows; returns what moved. */
export async function applySchedule(s: Scope, projectId: string) {
  requireWrite(s);
  requirePart(s, "planning");
  const p = await getProject(s, projectId);
  const [tasks, links] = await Promise.all([
    db.select().from(schema.workTasks).where(eq(schema.workTasks.projectId, p.id)),
    db.select().from(schema.workTaskLinks).where(eq(schema.workTaskLinks.projectId, p.id)),
  ]);
  const moved = reschedule(tasks.map((t) => ({ id: t.id, startDate: t.startDate, dueDate: t.dueDate, done: t.status === "done" })), links.map((l) => ({ ...l, type: l.type as "FS" | "SS" })));
  await db.transaction(async (tx) => {
    for (const [id, d] of moved) await tx.update(schema.workTasks).set({ ...d, updatedAt: new Date() }).where(eq(schema.workTasks.id, id));
  });
  if (moved.size) await audit({ orgId: s.orgId, actorId: s.userId, action: "work.rescheduled", targetType: "work_project", targetId: p.id, metadata: { tasks: moved.size } });
  return { moved: [...moved.entries()].map(([id, d]) => ({ id, number: tasks.find((t) => t.id === id)!.number, ...d })) };
}

// ── Resources ───────────────────────────────────────────────────────────────

/** Everyone on the team: capacity (working days less HR leave) against hours booked on projects. */
export async function resources(s: Scope, q: { from?: string; to?: string }) {
  requirePart(s, "planning");
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const from = ok(q.from) ? q.from! : todayIst();
  const to = ok(q.to) && q.to! >= from ? q.to! : addDays(from, 27);
  if (Date.parse(to) - Date.parse(from) > 370 * 86_400_000) throw new ApiError("validation_failed", "Look at a year or less at a time");
  const [team, allocs, leave] = await Promise.all([
    people(s.orgId),
    db.select({ id: schema.workAllocations.id, projectId: schema.workAllocations.projectId, userId: schema.workAllocations.userId, from: schema.workAllocations.fromDate, to: schema.workAllocations.toDate, hoursPerDay: schema.workAllocations.hoursPerDay, code: schema.workProjects.code, project: schema.workProjects.name, tint: schema.workProjects.tint }).from(schema.workAllocations).innerJoin(schema.workProjects, eq(schema.workProjects.id, schema.workAllocations.projectId)).where(and(eq(schema.workAllocations.orgId, s.orgId), sql`${schema.workAllocations.fromDate} <= ${to}`, sql`${schema.workAllocations.toDate} >= ${from}`)).orderBy(asc(schema.workAllocations.fromDate)),
    leaveByUser(s.orgId, from, to),
  ]);
  const { workDays, dailyHours } = s.settings;
  const rows = team.map((u) => {
    const mine = allocs.filter((a) => a.userId === u.id);
    const capacity = capacityHours(from, to, workDays, dailyHours, leave.get(u.id) ?? new Map());
    const booked = allocatedHours(mine, from, to, workDays);
    // Weeks where they're booked past what they can do.
    const over: string[] = [];
    for (let w = from; w <= to; w = addDays(w, 7)) {
      const end = addDays(w, 6) < to ? addDays(w, 6) : to;
      if (allocatedHours(mine, w, end, workDays) > capacityHours(w, end, workDays, dailyHours, leave.get(u.id) ?? new Map()) + 0.001) over.push(w);
    }
    return { userId: u.id, name: u.name, capacity, booked, free: Math.round((capacity - booked) * 100) / 100, load: capacity ? booked / capacity : null, overWeeks: over, allocations: s.write || u.id === s.userId ? mine : [] };
  });
  return { from, to, people: rows };
}

async function checkAllocation(s: Scope, v: z.infer<typeof allocationSchema>) {
  await getProject(s, v.projectId);
  if (v.to < v.from) throw new ApiError("validation_failed", "The end is before the start", { to: ["Before the start"] });
  const [m] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, v.userId)));
  if (!m || m.role === "employee") throw new ApiError("validation_failed", "Only people on the team can be booked on projects", { userId: ["Not on the team"] });
}

export async function saveAllocation(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "planning");
  const v = check(allocationSchema, raw);
  await checkAllocation(s, v);
  const values = { projectId: v.projectId, userId: v.userId, fromDate: v.from, toDate: v.to, hoursPerDay: v.hoursPerDay };
  if (id) {
    const a = await getRow<typeof schema.workAllocations.$inferSelect>(schema.workAllocations, s, id, "Booking");
    const [row] = await db.update(schema.workAllocations).set(values).where(eq(schema.workAllocations.id, a.id)).returning();
    return row;
  }
  // Booking someone on a project puts them on its team.
  await db.insert(schema.workMembers).values({ projectId: v.projectId, userId: v.userId }).onConflictDoNothing();
  const [row] = await db.insert(schema.workAllocations).values({ ...values, orgId: s.orgId }).returning();
  return row;
}

export async function deleteAllocation(s: Scope, id: string) {
  requireWrite(s);
  const a = await getRow<typeof schema.workAllocations.$inferSelect>(schema.workAllocations, s, id, "Booking");
  await db.delete(schema.workAllocations).where(eq(schema.workAllocations.id, a.id));
}

// ── Expenses ────────────────────────────────────────────────────────────────

/** What a billable expense is charged at: its amount plus markup. */
export const chargeOf = (e: { amount: number; markupPct: number; billable: boolean }) => (e.billable ? Math.round(Number(e.amount) * (1 + e.markupPct / 100)) : 0);

const expenseInput = expenseSchema.extend({ projectId: z.uuid() });

export async function expenses(s: Scope, projectId: string) {
  requirePart(s, "expenses");
  const p = await getProject(s, projectId);
  const rows = await db.select().from(schema.workExpenses).where(eq(schema.workExpenses.projectId, p.id)).orderBy(desc(schema.workExpenses.date), desc(schema.workExpenses.createdAt));
  const out = rows.map((e) => ({ ...e, charge: chargeOf(e) }));
  return {
    expenses: s.write ? out : [],
    totals: { spent: out.reduce((n, e) => n + Number(e.amount), 0), billable: out.reduce((n, e) => n + e.charge, 0), toBill: out.filter((e) => !e.invoiceId).reduce((n, e) => n + e.charge, 0) },
  };
}

export async function saveExpense(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "expenses");
  const v = check(expenseInput, raw);
  await getProject(s, v.projectId);
  if (id) {
    const e = await getRow<typeof schema.workExpenses.$inferSelect>(schema.workExpenses, s, id, "Expense");
    if (e.invoiceId) throw new ApiError("conflict", "This expense has been invoiced. Void the invoice to change it.");
    const [row] = await db.update(schema.workExpenses).set(v).where(eq(schema.workExpenses.id, e.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.workExpenses).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning();
  return row;
}

export async function deleteExpense(s: Scope, id: string) {
  requireWrite(s);
  const e = await getRow<typeof schema.workExpenses.$inferSelect>(schema.workExpenses, s, id, "Expense");
  if (e.invoiceId) throw new ApiError("conflict", "This expense has been invoiced. Void the invoice first.");
  await db.delete(schema.workExpenses).where(eq(schema.workExpenses.id, e.id));
}

/** Billable expenses not yet invoiced, up to a date. */
export async function expensesToBill(projectId: string, upTo: string) {
  return db.select().from(schema.workExpenses).where(and(eq(schema.workExpenses.projectId, projectId), eq(schema.workExpenses.billable, true), isNull(schema.workExpenses.invoiceId), sql`${schema.workExpenses.date} <= ${upTo}`)).orderBy(asc(schema.workExpenses.date));
}

// ── Risks & issues ──────────────────────────────────────────────────────────

const riskInput = riskSchema.extend({ projectId: z.uuid() });

export async function risks(s: Scope, projectId: string) {
  requirePart(s, "control");
  const p = await getProject(s, projectId);
  const rows = await db.select({ r: schema.workRisks, owner: schema.users.name }).from(schema.workRisks).leftJoin(schema.users, eq(schema.users.id, schema.workRisks.ownerId)).where(eq(schema.workRisks.projectId, p.id)).orderBy(desc(sql`${schema.workRisks.probability} * ${schema.workRisks.impact}`), asc(schema.workRisks.createdAt));
  return rows.map(({ r, owner }) => ({ ...r, owner, score: riskScore(r), level: riskLevel(riskScore(r)), overdue: r.status !== "closed" && !!r.due && r.due < todayIst() }));
}

export async function saveRisk(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "control");
  const v = check(riskInput, raw);
  await getProject(s, v.projectId);
  if (v.ownerId) {
    const [m] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, v.ownerId)));
    if (!m) throw new ApiError("validation_failed", "The owner must be in this workspace", { ownerId: ["Not in this workspace"] });
  }
  if (id) {
    const r = await getRow<typeof schema.workRisks.$inferSelect>(schema.workRisks, s, id, "Risk");
    const [row] = await db.update(schema.workRisks).set({ ...v, updatedAt: new Date() }).where(eq(schema.workRisks.id, r.id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.workRisks).values({ ...v, orgId: s.orgId }).returning();
  return row;
}

export async function deleteRisk(s: Scope, id: string) {
  requireWrite(s);
  const r = await getRow<typeof schema.workRisks.$inferSelect>(schema.workRisks, s, id, "Risk");
  await db.delete(schema.workRisks).where(eq(schema.workRisks.id, r.id));
}

// ── Change requests ─────────────────────────────────────────────────────────

const changeInput = changeSchema.extend({ projectId: z.uuid() });

export async function changes(s: Scope, projectId: string) {
  requirePart(s, "control");
  const p = await getProject(s, projectId);
  const rows = await db.select({ c: schema.workChanges, by: schema.users.name }).from(schema.workChanges).leftJoin(schema.users, eq(schema.users.id, schema.workChanges.requestedBy)).where(eq(schema.workChanges.projectId, p.id)).orderBy(desc(schema.workChanges.createdAt));
  return rows.map(({ c, by }) => ({ ...c, fee: s.write ? c.fee : 0, by }));
}

async function getChange(s: Scope, id: string) {
  return getRow<typeof schema.workChanges.$inferSelect>(schema.workChanges, s, id, "Change request");
}

export async function saveChange(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "control");
  const v = check(changeInput, raw);
  const p = await getProject(s, v.projectId);
  if (id) {
    const c = await getChange(s, id);
    if (c.status !== "draft" && c.status !== "rejected") throw new ApiError("conflict", "Only a draft or rejected change can be edited");
    const [row] = await db.update(schema.workChanges).set({ title: v.title, description: v.description, hours: v.hours, fee: v.fee, days: v.days, status: "draft" }).where(eq(schema.workChanges.id, c.id)).returning();
    return row;
  }
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.workChanges).where(eq(schema.workChanges.projectId, p.id));
    const [row] = await tx.insert(schema.workChanges).values({ title: v.title, description: v.description, hours: v.hours, fee: v.fee, days: v.days, orgId: s.orgId, projectId: p.id, number: `CR-${String(n + 1).padStart(3, "0")}`, requestedBy: s.userId }).returning();
    return row;
  });
}

/** Send a change for approval. With no approval rule, a manager's change takes effect; anyone else's waits for one. */
export async function submitChange(s: Scope, id: string) {
  requireWrite(s);
  const c = await getChange(s, id);
  if (c.status !== "draft" && c.status !== "rejected") throw new ApiError("conflict", "Already sent");
  const p = await getProject(s, c.projectId);
  const g = await gate(s.orgId, { kind: "work.change", refId: c.id, label: `${c.number} · ${p.code} ${c.title}`, amount: Math.abs(Number(c.fee)), requesterId: s.userId, link: `/work/projects/${p.id}/changes` });
  if (g.status === "approved" || (g.status === "none" && s.manage)) return { status: await applyChange(s.orgId, c.id) };
  await db.update(schema.workChanges).set({ status: "pending" }).where(eq(schema.workChanges.id, c.id));
  return { status: "pending" as const };
}

/** A manager decides a change no approval rule covers. */
export async function decideChange(s: Scope, id: string, raw: unknown) {
  requireManage(s);
  const c = await getChange(s, id);
  if (c.status !== "pending") throw new ApiError("conflict", "This change isn't waiting for a decision");
  const [req] = await db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, s.orgId), eq(schema.approvalRequests.kind, "work.change"), eq(schema.approvalRequests.refId, c.id), eq(schema.approvalRequests.status, "pending")));
  if (req) throw new ApiError("conflict", "This change is with its approvers. Decide it in Approvals.");
  const { approve } = check(z.object({ approve: z.boolean() }), raw);
  if (approve) return { status: await applyChange(s.orgId, c.id) };
  await changeRejected(s.orgId, c.id);
  return { status: "rejected" as const };
}

/** Approved: move the project's budget hours, fee and due date. Runs once. */
export async function applyChange(orgId: string, id: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.update(schema.workChanges).set({ status: "approved", decidedAt: new Date() }).where(and(eq(schema.workChanges.id, id), eq(schema.workChanges.orgId, orgId), sql`${schema.workChanges.status} in ('draft','pending','rejected')`)).returning();
    if (!c) return "approved" as const;
    const [p] = await tx.select().from(schema.workProjects).where(eq(schema.workProjects.id, c.projectId));
    await tx
      .update(schema.workProjects)
      .set({ budgetHours: Math.max(0, p.budgetHours + c.hours), fee: Math.max(0, Number(p.fee) + Number(c.fee)), dueDate: p.dueDate && c.days ? addDays(p.dueDate, c.days) : p.dueDate, updatedAt: new Date() })
      .where(eq(schema.workProjects.id, p.id));
    await audit({ orgId, actorId: c.requestedBy, action: "work.change_approved", targetType: "work_project", targetId: p.id, metadata: { number: c.number, hours: c.hours, fee: c.fee, days: c.days } });
    return "approved" as const;
  });
}

export async function changeRejected(orgId: string, id: string) {
  await db.update(schema.workChanges).set({ status: "rejected", decidedAt: new Date() }).where(and(eq(schema.workChanges.id, id), eq(schema.workChanges.orgId, orgId), eq(schema.workChanges.status, "pending")));
}

export async function deleteChange(s: Scope, id: string) {
  requireWrite(s);
  const c = await getChange(s, id);
  if (c.status === "approved" || c.status === "pending") throw new ApiError("conflict", c.status === "approved" ? "An approved change stays on the record" : "Withdraw it from approval first");
  await db.delete(schema.workChanges).where(eq(schema.workChanges.id, c.id));
}

// ── Documents ───────────────────────────────────────────────────────────────

export async function docs(s: Scope, projectId: string) {
  requirePart(s, "control");
  const p = await getProject(s, projectId);
  return db.select({ id: schema.workDocs.id, title: schema.workDocs.title, url: schema.workDocs.url, createdAt: schema.workDocs.createdAt, by: schema.users.name }).from(schema.workDocs).leftJoin(schema.users, eq(schema.users.id, schema.workDocs.createdBy)).where(eq(schema.workDocs.projectId, p.id)).orderBy(asc(schema.workDocs.title));
}

export async function addDoc(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "control");
  const v = check(z.object({ projectId: z.uuid(), title: z.string().trim().min(1, "Name it").max(160), url: z.url("Use a web link").refine((u) => /^https?:\/\//i.test(u), "Use a web link") }), raw);
  await getProject(s, v.projectId);
  const [row] = await db.insert(schema.workDocs).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning();
  return row;
}

export async function deleteDoc(s: Scope, id: string) {
  requireWrite(s);
  const d = await getRow<typeof schema.workDocs.$inferSelect>(schema.workDocs, s, id, "Document");
  await db.delete(schema.workDocs).where(eq(schema.workDocs.id, d.id));
}
