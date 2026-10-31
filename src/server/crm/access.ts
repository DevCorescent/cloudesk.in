// Who is asking and what they may see. Every CRM call starts here: the
// workspace, the person, whether they run the CRM (crm:manage) and whether the
// workspace limits members to the records they own.
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { can, type Permission, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { randomToken } from "../security/tokens";
import { DEFAULT_PIPELINE, DEFAULT_SCORING, DEFAULT_TEMPLATES, settingsJsonSchema, settingsSchema, type CrmSettings } from "@/lib/crm/model";
import { isOn } from "@/lib/workspace/modules";

/** Parse input with a schema, turning problems into a friendly 422. */
export function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

export type Scope = { orgId: string; userId: string; role: Role; manage: boolean; write: boolean; own: boolean; settings: Settings };
export type Settings = CrmSettings & { captureToken: string; rrCursor: number };

export async function scope(ctx: AuthedContext, orgId: string, permission: Permission = "crm:read"): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, permission);
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "crm")) throw new ApiError("forbidden", "Switch on the CRM in Settings → Features first");
  const settings = await getSettings(orgId);
  const manage = can(role, "crm:manage");
  return { orgId, userId: ctx.user.id, role, manage, write: can(role, "crm:write"), own: settings.visibility === "own" && !manage, settings };
}

/** A scope for system work (capture, jobs): sees everything, acts as nobody. */
export async function systemScope(orgId: string): Promise<Scope> {
  return { orgId, userId: "", role: "owner", manage: true, write: true, own: false, settings: await getSettings(orgId) };
}

export function requireWrite(s: Scope) {
  if (!s.write) throw new ApiError("forbidden", "Your role can view the CRM but not change it");
}
export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can change this");
}

/** Records a member may see when the workspace keeps records private to their owner. */
export function visible(s: Scope, ownerCol: SQL | AnyPgColumn) {
  return s.own ? sql`(${ownerCol} = ${s.userId} or ${ownerCol} is null)` : sql`true`;
}

/** Settings, created with a default sales pipeline the first time. */
export async function getSettings(orgId: string): Promise<Settings> {
  let [row] = await db.select().from(schema.crmSettings).where(eq(schema.crmSettings.orgId, orgId));
  if (!row) {
    [row] = await db
      .insert(schema.crmSettings)
      .values({ orgId, captureToken: randomToken(18), settings: { scoring: DEFAULT_SCORING, templates: DEFAULT_TEMPLATES } })
      .onConflictDoNothing()
      .returning();
    if (!row) [row] = await db.select().from(schema.crmSettings).where(eq(schema.crmSettings.orgId, orgId));
    else await createPipeline(orgId, DEFAULT_PIPELINE);
  }
  const parsed = settingsSchema.parse({ currency: row.currency, visibility: row.visibility, assignment: row.assignment, defaultOwnerId: row.defaultOwnerId, settings: row.settings });
  return { ...parsed, captureToken: row.captureToken, rrCursor: row.rrCursor };
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const input = check(settingsSchema, raw);
  if (input.defaultOwnerId) await requireMember(s.orgId, input.defaultOwnerId);
  await db
    .update(schema.crmSettings)
    .set({ currency: input.currency, visibility: input.visibility, assignment: input.assignment, defaultOwnerId: input.defaultOwnerId, settings: settingsJsonSchema.parse(input.settings), updatedAt: new Date() })
    .where(eq(schema.crmSettings.orgId, s.orgId));
  return getSettings(s.orgId);
}

export async function rotateCaptureToken(s: Scope) {
  requireManage(s);
  const token = randomToken(18);
  await db.update(schema.crmSettings).set({ captureToken: token }).where(eq(schema.crmSettings.orgId, s.orgId));
  return token;
}

/** Workspace members who can own CRM records. */
export async function owners(orgId: string) {
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.memberships.createdAt));
  return rows.map((r) => ({ ...r, canOwn: can(r.role as Role, "crm:write") }));
}

export async function requireMember(orgId: string, userId: string) {
  const [m] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  if (!m) throw new ApiError("validation_failed", "That owner isn't in this workspace", { ownerId: ["Not a member"] });
}

/** The owner for a lead that arrived by itself: nobody, one person, or the next in turn. */
export async function nextOwner(orgId: string): Promise<string | null> {
  const st = await getSettings(orgId);
  if (st.assignment === "default") return st.defaultOwnerId;
  if (st.assignment !== "round_robin") return null;
  const people = (await owners(orgId)).filter((o) => o.canOwn);
  if (!people.length) return null;
  const [row] = await db
    .update(schema.crmSettings)
    .set({ rrCursor: sql`${schema.crmSettings.rrCursor} + 1` })
    .where(eq(schema.crmSettings.orgId, orgId))
    .returning({ n: schema.crmSettings.rrCursor });
  return people[(row.n - 1) % people.length].id;
}

// ─── Pipelines ───

export async function pipelines(orgId: string) {
  const ps = await db.select().from(schema.crmPipelines).where(eq(schema.crmPipelines.orgId, orgId)).orderBy(asc(schema.crmPipelines.sort), asc(schema.crmPipelines.createdAt));
  const stages = ps.length ? await db.select().from(schema.crmStages).where(inArray(schema.crmStages.pipelineId, ps.map((p) => p.id))).orderBy(asc(schema.crmStages.sort)) : [];
  return ps.map((p) => ({ ...p, stages: stages.filter((st) => st.pipelineId === p.id) }));
}

export async function createPipeline(orgId: string, input: { name: string; stages: { name: string; probability: number; kind: "open" | "won" | "lost"; rotDays: number }[] }) {
  checkStages(input.stages);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmPipelines).where(eq(schema.crmPipelines.orgId, orgId));
  if (n >= 20) throw new ApiError("validation_failed", "A workspace can have up to 20 pipelines");
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(schema.crmPipelines).values({ orgId, name: input.name, sort: n }).returning();
    await tx.insert(schema.crmStages).values(input.stages.map((st, i) => ({ orgId, pipelineId: p.id, name: st.name, probability: st.kind === "won" ? 100 : st.kind === "lost" ? 0 : st.probability, kind: st.kind, rotDays: st.rotDays, sort: i })));
    return p;
  });
}

function checkStages(stages: { kind: string }[]) {
  if (!stages.some((s) => s.kind === "open")) throw new ApiError("validation_failed", "Add at least one open stage");
  if (stages.filter((s) => s.kind === "won").length !== 1 || stages.filter((s) => s.kind === "lost").length !== 1) throw new ApiError("validation_failed", "A pipeline needs exactly one Won and one Lost stage");
}

/** Renames, reorders, adds and removes stages. A stage with deals can only go if they move first. */
export async function updatePipeline(orgId: string, pipelineId: string, input: { name: string; stages: { id?: string; name: string; probability: number; kind: "open" | "won" | "lost"; rotDays: number }[] }) {
  checkStages(input.stages);
  const [p] = await db.select().from(schema.crmPipelines).where(and(eq(schema.crmPipelines.id, pipelineId), eq(schema.crmPipelines.orgId, orgId)));
  if (!p) throw notFound("Pipeline");
  const current = await db.select().from(schema.crmStages).where(eq(schema.crmStages.pipelineId, pipelineId));
  const keep = new Set(input.stages.map((s) => s.id).filter(Boolean));
  const gone = current.filter((c) => !keep.has(c.id));
  if (gone.length) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDeals).where(inArray(schema.crmDeals.stageId, gone.map((g) => g.id)));
    if (n) throw new ApiError("conflict", `Move the ${n} deal${n === 1 ? "" : "s"} out of ${gone.map((g) => g.name).join(", ")} before removing ${gone.length === 1 ? "it" : "them"}`);
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.crmPipelines).set({ name: input.name }).where(eq(schema.crmPipelines.id, pipelineId));
    if (gone.length) await tx.delete(schema.crmStages).where(inArray(schema.crmStages.id, gone.map((g) => g.id)));
    for (const [i, st] of input.stages.entries()) {
      const values = { name: st.name, probability: st.kind === "won" ? 100 : st.kind === "lost" ? 0 : st.probability, kind: st.kind, rotDays: st.rotDays, sort: i };
      if (st.id && current.some((c) => c.id === st.id)) await tx.update(schema.crmStages).set(values).where(eq(schema.crmStages.id, st.id));
      else await tx.insert(schema.crmStages).values({ orgId, pipelineId, ...values });
    }
  });
  return (await pipelines(orgId)).find((x) => x.id === pipelineId)!;
}

export async function deletePipeline(orgId: string, pipelineId: string) {
  const all = await pipelines(orgId);
  if (all.length <= 1) throw new ApiError("conflict", "Keep at least one pipeline");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDeals).where(eq(schema.crmDeals.pipelineId, pipelineId));
  if (n) throw new ApiError("conflict", `This pipeline has ${n} deal${n === 1 ? "" : "s"}; move or delete them first`);
  await db.delete(schema.crmPipelines).where(and(eq(schema.crmPipelines.id, pipelineId), eq(schema.crmPipelines.orgId, orgId)));
}

// ─── Custom fields ───

export async function fields(orgId: string) {
  return db.select().from(schema.crmFields).where(eq(schema.crmFields.orgId, orgId)).orderBy(asc(schema.crmFields.entity), asc(schema.crmFields.sort));
}
