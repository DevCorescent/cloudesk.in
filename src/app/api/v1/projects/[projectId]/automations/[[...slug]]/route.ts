import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { nextRuns } from "@/lib/automation/cron";
import { deleteWorkflow, getWorkflow, listRuns, listWorkflows, rotateWebhook, runManually, saveWorkflow, setEnabled, workflowLimits } from "@/server/automation/workflows";
import { notFound } from "@/server/http/errors";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { cancelJob, retryJob } from "@/server/jobs/queue";
import { rateLimit } from "@/server/security/rate-limit";

type P = { projectId: string; slug?: string[] };

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const { project } = await requireProject(ctx, projectId, "automations:manage");
  const [id, section, sub] = slug;
  if (id && !["jobs", "cron"].includes(id) && !z.uuid().safeParse(id).success) throw notFound("Workflow");
  const key = `${ctx.req.method} ${[id ? (["jobs", "cron"].includes(id) ? id : ":id") : "", section, sub && "x"].filter(Boolean).join(" ")}`.trim();
  switch (key) {
    case "GET":
      return { workflows: await listWorkflows(projectId), limits: workflowLimits };
    case "POST": {
      await rateLimit(`wf-save:${ctx.user.id}`, 120, 3600_000);
      return Response.json({ workflow: await saveWorkflow(project, ctx.user.id, await readJson(ctx.req, z.unknown())) }, { status: 201 });
    }
    case "GET cron": {
      // Preview of a schedule: next three times it would run.
      const url = new URL(ctx.req.url);
      try {
        return { next: nextRuns(url.searchParams.get("cron") ?? "", url.searchParams.get("tz") ?? "UTC") };
      } catch (e) {
        return { error: (e as Error).message, next: [] };
      }
    }
    case "GET jobs": {
      // The project's job queue: what is waiting, retrying or dead.
      const rows = await db
        .select({ id: schema.jobs.id, kind: schema.jobs.kind, status: schema.jobs.status, attempts: schema.jobs.attempts, maxAttempts: schema.jobs.maxAttempts, runAt: schema.jobs.runAt, lastError: schema.jobs.lastError, createdAt: schema.jobs.createdAt, finishedAt: schema.jobs.finishedAt })
        .from(schema.jobs)
        .where(eq(schema.jobs.projectId, projectId))
        .orderBy(desc(schema.jobs.createdAt))
        .limit(100);
      return { jobs: rows };
    }
    case "POST jobs x": {
      const ok = section && z.uuid().safeParse(section).success && (sub === "retry" ? await retryJob(section, projectId) : sub === "cancel" ? await cancelJob(section, projectId) : false);
      if (!ok) throw notFound("Job");
      return { ok: true };
    }
    case "GET :id": {
      const w = await getWorkflow(projectId, id);
      return { workflow: (await listWorkflows(projectId)).find((x) => x.id === w.id) };
    }
    case "PUT :id":
      return { workflow: await saveWorkflow(project, ctx.user.id, await readJson(ctx.req, z.unknown()), id) };
    case "DELETE :id":
      await deleteWorkflow(project, ctx.user.id, id);
      return { ok: true };
    case "POST :id enable":
    case "POST :id disable":
      await setEnabled(project, ctx.user.id, id, section === "enable");
      return { ok: true };
    case "POST :id run": {
      await rateLimit(`wf-run:${id}`, 60, 3600_000);
      const { input } = await readJson(ctx.req, z.object({ input: z.record(z.string(), z.unknown()).default({}) }));
      const run = await runManually(projectId, id, input);
      return Response.json({ run: run ? { id: run.id } : null }, { status: 202 });
    }
    case "POST :id webhook":
      return rotateWebhook(projectId, id);
    case "GET :id runs":
      return { runs: await listRuns(projectId, id) };
    case "POST :id runs x": {
      // Stop a run that is waiting (e.g. on a long delay) — one of this project's, of this workflow.
      if (section !== "runs" || !z.uuid().safeParse(sub).success) throw notFound("Run");
      const r = await db
        .update(schema.workflowRuns)
        .set({ status: "stopped", finishedAt: new Date(), error: "Stopped by a teammate" })
        .where(and(eq(schema.workflowRuns.id, sub), eq(schema.workflowRuns.workflowId, id), eq(schema.workflowRuns.projectId, projectId), inArray(schema.workflowRuns.status, ["running", "waiting"])))
        .returning({ id: schema.workflowRuns.id });
      if (!r.length) throw notFound("Run");
      return { ok: true };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
