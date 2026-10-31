// Importing projects, tasks and time from spreadsheets (another tool's export,
// or a sheet kept by hand). People are matched by email or name, projects by
// code or name, clients by name in the project's books, milestones are found
// or added. Rows go through the same saves as the screens.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { target } from "@/lib/import/targets";
import { ApiError } from "../http/errors";
import { runImport, str } from "../import/run";
import { invoiceBooks, people, requireManage, requireWrite, type Scope } from "./access";
import { saveMilestone, saveProject } from "./projects";
import { saveTask } from "./tasks";
import { saveExpense } from "./plus";
import { saveEntry } from "./time";

const extra = z.object({ projectId: z.uuid().optional(), ownerId: z.uuid().optional() });

async function finders(s: Scope) {
  const team = await people(s.orgId);
  const person = (ref: string) => {
    const k = ref.trim().toLowerCase();
    if (!k) return null;
    const hit = team.find((p) => p.email.toLowerCase() === k) ?? team.find((p) => p.name.toLowerCase() === k) ?? team.find((p) => p.name.toLowerCase().split(/\s+/)[0] === k);
    if (!hit) throw new ApiError("validation_failed", `“${ref}” isn't on your team — use their email`);
    return hit.id;
  };
  const projects = new Map<string, string>();
  const project = async (ref: string) => {
    const k = ref.trim().toLowerCase();
    if (projects.has(k)) return projects.get(k)!;
    const [p] = await db.select({ id: schema.workProjects.id }).from(schema.workProjects).where(and(eq(schema.workProjects.orgId, s.orgId), sql`(lower(${schema.workProjects.code}) = ${k} or lower(${schema.workProjects.name}) = ${k})`)).orderBy(sql`lower(${schema.workProjects.code}) = ${k} desc`).limit(1);
    if (!p) throw new ApiError("validation_failed", `There's no project called “${ref}” — import projects first, or pick one`);
    projects.set(k, p.id);
    return p.id;
  };
  return { person, project };
}

export async function importProjects(s: Scope, raw: unknown) {
  requireWrite(s);
  const opts = extra.parse(raw);
  const { person } = await finders(s);
  const books = await invoiceBooks(s.orgId);
  const ownerId = opts.ownerId && books.some((b) => b.id === opts.ownerId) ? opts.ownerId : (books.find((b) => b.kind === "book") ?? books[0])?.id ?? null;
  return runImport(target("work.projects"), raw, async (v, mode) => {
    const code = str(v.code).trim();
    const name = str(v.name);
    const [found] = await db.select().from(schema.workProjects).where(and(eq(schema.workProjects.orgId, s.orgId), code ? sql`lower(${schema.workProjects.code}) = ${code.toLowerCase()}` : sql`lower(${schema.workProjects.name}) = ${name.toLowerCase()}`));
    if (found && mode === "skip") return "skipped";
    let clientId: string | null = found?.clientId ?? null;
    let clientOwner: string | null = found?.ownerId ?? null;
    const clientName = str(v.client);
    if (clientName) {
      // In the books picked for the import, or any books in the workspace.
      const where = opts.ownerId ? [opts.ownerId] : books.map((b) => b.id);
      const [c] = where.length ? await db.select({ id: schema.invoiceClients.id, ownerId: schema.invoiceClients.projectId }).from(schema.invoiceClients).where(and(inArray(schema.invoiceClients.projectId, where), sql`${schema.invoiceClients.archivedAt} is null`, sql`(lower(${schema.invoiceClients.name}) = ${clientName.toLowerCase()} or lower(${schema.invoiceClients.company}) = ${clientName.toLowerCase()})`)).limit(1) : [];
      clientId = c?.id ?? null;
      clientOwner = c?.ownerId ?? clientOwner;
    }
    const body = {
      name,
      description: str(v.description) || found?.description || "",
      ownerId: clientOwner ?? ownerId,
      clientId,
      clientName: clientName || found?.clientName || "",
      status: str(v.status) || found?.status || "active",
      billing: str(v.billing) || found?.billing || "hourly",
      rate: v.rate !== null ? Number(v.rate) : (found?.rate ?? 0),
      fee: v.fee !== null ? Number(v.fee) : (found?.fee ?? 0),
      budgetHours: v.budgetHours !== null ? Number(v.budgetHours) : (found?.budgetHours ?? 0),
      budgetAmount: v.budgetAmount !== null ? Number(v.budgetAmount) : (found?.budgetAmount ?? 0),
      startDate: v.startDate ? str(v.startDate) : (found?.startDate ?? null),
      dueDate: v.dueDate ? str(v.dueDate) : (found?.dueDate ?? null),
      leadId: v.lead ? person(str(v.lead)) : (found?.leadId ?? null),
      tint: found?.tint ?? "sky",
    };
    const p = await saveProject(s, found?.id ?? null, body);
    // A code from the file replaces the generated one, if it's free.
    if (!found && code && code !== p.code) {
      const [clash] = await db.select({ id: schema.workProjects.id }).from(schema.workProjects).where(and(eq(schema.workProjects.orgId, s.orgId), eq(schema.workProjects.code, code)));
      if (!clash) await db.update(schema.workProjects).set({ code }).where(eq(schema.workProjects.id, p.id));
    }
    return found ? "updated" : "created";
  });
}

export async function importTasks(s: Scope, raw: unknown) {
  requireWrite(s);
  const opts = extra.parse(raw);
  const { person, project } = await finders(s);
  const milestones = new Map<string, string>();
  return runImport(target("work.tasks"), raw, async (v, mode) => {
    const projectId = str(v.project) ? await project(str(v.project)) : opts.projectId;
    if (!projectId) throw new ApiError("validation_failed", "Which project is this task on? Add a Project column or pick one");
    const title = str(v.title);
    const [found] = await db.select().from(schema.workTasks).where(and(eq(schema.workTasks.projectId, projectId), sql`lower(${schema.workTasks.title}) = ${title.toLowerCase()}`, sql`${schema.workTasks.parentId} is null`));
    if (found && mode === "skip") return "skipped";
    let milestoneId = found?.milestoneId ?? null;
    const ms = str(v.milestone).trim();
    if (ms) {
      const k = `${projectId}|${ms.toLowerCase()}`;
      if (!milestones.has(k)) {
        const [m] = await db.select({ id: schema.workMilestones.id }).from(schema.workMilestones).where(and(eq(schema.workMilestones.projectId, projectId), sql`lower(${schema.workMilestones.name}) = ${ms.toLowerCase()}`));
        milestones.set(k, m?.id ?? (await saveMilestone(s, null, { projectId, name: ms })).id);
      }
      milestoneId = milestones.get(k)!;
    }
    const tags = str(v.tags) ? str(v.tags).split(/[,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 12) : (found?.tags ?? []);
    await saveTask(s, found?.id ?? null, {
      projectId,
      title,
      description: str(v.description) || found?.description || "",
      status: str(v.status) || found?.status || "todo",
      priority: str(v.priority) || found?.priority || "normal",
      assigneeId: v.assignee ? person(str(v.assignee)) : (found?.assigneeId ?? null),
      milestoneId,
      startDate: v.startDate ? str(v.startDate) : (found?.startDate ?? null),
      dueDate: v.dueDate ? str(v.dueDate) : (found?.dueDate ?? null),
      estimateHours: v.estimateHours !== null ? Number(v.estimateHours) : (found?.estimateHours ?? 0),
      billable: found?.billable ?? true,
      checklist: found?.checklist ?? [],
      tags,
    });
    return found ? "updated" : "created";
  });
}

export async function importTime(s: Scope, raw: unknown) {
  const opts = extra.parse(raw);
  const { person, project } = await finders(s);
  const tasks = new Map<string, string | null>();
  return runImport(target("work.time"), raw, async (v) => {
    const projectId = str(v.project) ? await project(str(v.project)) : opts.projectId;
    if (!projectId) throw new ApiError("validation_failed", "Which project is this time for? Add a Project column or pick one");
    let userId: string | undefined;
    if (str(v.person)) {
      userId = person(str(v.person))!;
      if (userId !== s.userId) requireManage(s);
    }
    let taskId: string | null = null;
    const ref = str(v.task).trim();
    if (ref) {
      const k = `${projectId}|${ref.toLowerCase()}`;
      if (!tasks.has(k)) {
        const num = ref.match(/^#?(\d+)$/)?.[1];
        const [t] = await db.select({ id: schema.workTasks.id }).from(schema.workTasks).where(and(eq(schema.workTasks.projectId, projectId), num ? eq(schema.workTasks.number, Number(num)) : sql`lower(${schema.workTasks.title}) = ${ref.toLowerCase()}`)).limit(1);
        tasks.set(k, t?.id ?? null);
      }
      taskId = tasks.get(k)!;
      if (!taskId) throw new ApiError("validation_failed", `There's no task “${ref}” on that project`);
    }
    await saveEntry(s, null, { projectId, taskId, date: str(v.date), minutes: Number(v.minutes), note: str(v.note), billable: v.billable !== false, userId });
    return "created";
  });
}

export async function importExpenses(s: Scope, raw: unknown) {
  requireWrite(s);
  const opts = extra.parse(raw);
  const { project } = await finders(s);
  return runImport(target("work.expenses"), raw, async (v) => {
    const projectId = str(v.project) ? await project(str(v.project)) : opts.projectId;
    if (!projectId) throw new ApiError("validation_failed", "Which project is this expense for? Add a Project column or pick one");
    await saveExpense(s, null, { projectId, date: str(v.date), amount: Number(v.amount), category: str(v.category) || "Other", description: str(v.description), vendor: str(v.vendor), billable: v.billable !== false, markupPct: v.markupPct == null || v.markupPct === "" ? 0 : Number(v.markupPct), receiptLink: str(v.receiptLink) });
    return "created";
  });
}
