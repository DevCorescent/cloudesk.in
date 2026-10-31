// Projects & timesheets API for a workspace. Dispatches on
// "METHOD section :id sub", like the Inventory and HR APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { clientsOf, invoiceBooks, partOn, people, saveSettings, scope } from "@/server/work/access";
import { billProject, billingOverview, unbilled } from "@/server/work/billing";
import { importExpenses, importProjects, importTasks, importTime } from "@/server/work/import";
import { addDoc, addLink, applySchedule, changes, decideChange, deleteAllocation, deleteChange, deleteDoc, deleteExpense, deleteLink, deleteRisk, docs, expenses, resources, risks, saveAllocation, saveChange, saveExpense, saveRisk, schedule, submitChange } from "@/server/work/plus";
import { completeMilestone, deleteMilestone, deleteProject, fromDeal, listProjects, projectDetail, saveMilestone, saveProject, setStatus } from "@/server/work/projects";
import { home, profit, reports } from "@/server/work/reports";
import { addComment, deleteComment, deleteTask, listTasks, moveTask, saveTask, taskDetail, tick } from "@/server/work/tasks";
import { approvals, decideWeek, deleteEntry, listTime, recallWeek, saveEntry, setCell, startTimer, stopTimer, submitWeek, timer, week } from "@/server/work/time";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  // Ids become ":id"; words stay as they are ("projects import").
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return {
        me: { id: s.userId, write: s.write, manage: s.manage, payroll: s.payroll },
        settings: s.settings,
        people: await people(orgId),
        books: s.write ? await invoiceBooks(orgId) : [],
        parts: { timesheets: partOn(s, "timesheets"), billing: partOn(s, "billing"), profit: partOn(s, "profit"), planning: partOn(s, "planning"), expenses: partOn(s, "expenses"), control: partOn(s, "control") },
        links: { crm: s.has("crm"), invoicing: s.has("invoicing"), hr: s.has("hr") },
      };
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);
    case "GET reports":
      return reports(s, qs);
    case "GET profit":
      return profit(s, qs);
    case "GET clients":
      // For picking a project's client: people who plan projects, and only names (contact details stay in Invoicing).
      if (!s.write) throw new ApiError("forbidden", "Only people who plan projects can pick a client");
      return { clients: await clientsOf(orgId, z.uuid().parse(qs.ownerId)) };
    case "GET deals :id":
      return fromDeal(s, id!);

    case "GET projects":
      return { projects: await listProjects(s, qs) };
    case "POST projects":
      return { project: await saveProject(s, null, await body(ctx)) };
    case "POST projects import":
      return importProjects(s, await body(ctx));
    case "GET projects :id":
      return projectDetail(s, id!);
    case "PUT projects :id":
      return { project: await saveProject(s, id!, await body(ctx)) };
    case "POST projects :id status":
      await setStatus(s, id!, String((await body(ctx)).status ?? ""));
      return { ok: true };
    case "DELETE projects :id":
      await deleteProject(s, id!);
      return { ok: true };

    case "GET projects :id schedule":
      return schedule(s, id!);
    case "POST projects :id reschedule":
      return applySchedule(s, id!);
    case "GET projects :id expenses":
      return expenses(s, id!);
    case "GET projects :id risks":
      return { risks: await risks(s, id!) };
    case "GET projects :id changes":
      return { changes: await changes(s, id!) };
    case "GET projects :id docs":
      return { docs: await docs(s, id!) };

    case "POST links":
      return { link: await addLink(s, await body(ctx)) };
    case "DELETE links :id":
      await deleteLink(s, id!);
      return { ok: true };
    case "GET resources":
      return resources(s, qs);
    case "POST allocations":
      return { allocation: await saveAllocation(s, null, await body(ctx)) };
    case "PUT allocations :id":
      return { allocation: await saveAllocation(s, id!, await body(ctx)) };
    case "DELETE allocations :id":
      await deleteAllocation(s, id!);
      return { ok: true };
    case "POST expenses":
      return { expense: await saveExpense(s, null, await body(ctx)) };
    case "POST expenses import":
      return importExpenses(s, await body(ctx));
    case "PUT expenses :id":
      return { expense: await saveExpense(s, id!, await body(ctx)) };
    case "DELETE expenses :id":
      await deleteExpense(s, id!);
      return { ok: true };
    case "POST risks":
      return { risk: await saveRisk(s, null, await body(ctx)) };
    case "PUT risks :id":
      return { risk: await saveRisk(s, id!, await body(ctx)) };
    case "DELETE risks :id":
      await deleteRisk(s, id!);
      return { ok: true };
    case "POST changes":
      return { change: await saveChange(s, null, await body(ctx)) };
    case "PUT changes :id":
      return { change: await saveChange(s, id!, await body(ctx)) };
    case "POST changes :id submit":
      return submitChange(s, id!);
    case "POST changes :id decide":
      return decideChange(s, id!, await body(ctx));
    case "DELETE changes :id":
      await deleteChange(s, id!);
      return { ok: true };
    case "POST docs":
      return { doc: await addDoc(s, await body(ctx)) };
    case "DELETE docs :id":
      await deleteDoc(s, id!);
      return { ok: true };

    case "POST milestones":
      return { milestone: await saveMilestone(s, null, await body(ctx)) };
    case "PUT milestones :id":
      return { milestone: await saveMilestone(s, id!, await body(ctx)) };
    case "POST milestones :id done":
      await completeMilestone(s, id!, (await body(ctx)).done !== false);
      return { ok: true };
    case "DELETE milestones :id":
      await deleteMilestone(s, id!);
      return { ok: true };

    case "GET tasks":
      return { tasks: await listTasks(s, qs) };
    case "POST tasks":
      return { task: await saveTask(s, null, await body(ctx)) };
    case "POST tasks import":
      return importTasks(s, await body(ctx));
    case "GET tasks :id":
      return taskDetail(s, id!);
    case "PUT tasks :id":
      return { task: await saveTask(s, id!, await body(ctx)) };
    case "POST tasks :id move":
      return { task: await moveTask(s, id!, await body(ctx)) };
    case "POST tasks :id tick":
      return tick(s, id!, await body(ctx));
    case "POST tasks :id comments":
      return { comment: await addComment(s, id!, await body(ctx)) };
    case "DELETE tasks :id":
      await deleteTask(s, id!);
      return { ok: true };
    case "DELETE comments :id":
      await deleteComment(s, id!);
      return { ok: true };

    case "GET time":
      return { entries: await listTime(s, qs) };
    case "POST time":
      return { entry: await saveEntry(s, null, await body(ctx)) };
    case "POST time import":
      return importTime(s, await body(ctx));
    case "PUT time :id":
      return { entry: await saveEntry(s, id!, await body(ctx)) };
    case "DELETE time :id":
      await deleteEntry(s, id!);
      return { ok: true };
    case "GET timesheet":
      return week(s, qs);
    case "PUT timesheet cell":
      return setCell(s, await body(ctx));
    case "POST timesheet submit":
      return submitWeek(s, await body(ctx));
    case "POST timesheet recall":
      return recallWeek(s, await body(ctx));
    case "GET timer":
      return timer(s);
    case "POST timer start":
      return startTimer(s, await body(ctx));
    case "POST timer stop":
      return stopTimer(s);
    case "GET approvals":
      return { weeks: await approvals(s) };
    case "POST approvals":
      return decideWeek(s, await body(ctx));

    case "GET billing":
      return { projects: await billingOverview(s) };
    case "GET billing :id":
      return unbilled(s, id!, qs);
    case "POST billing :id":
      return billProject(s, id!, await body(ctx));
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
