import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { mergeDocs, type Side } from "@/lib/site/merge";
import { parseSiteDoc, serializeSiteDoc, SITE_DOC_PATH, siteDocSchema, type SiteDoc } from "@/lib/site/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "./audit";
import { enforceBrand } from "./brand";
import { createDeployment } from "./deployments";
import { MAX_FILE_BYTES, readFile, writeFile } from "./files";

export const MAX_BRANCHES = 20;

type Project = { id: string; orgId: string };

function parse(content: string, what: string): SiteDoc {
  const r = parseSiteDoc(content);
  if (!r.ok) throw new ApiError("validation_failed", `The ${what} is invalid. Fix it before merging.`, { problems: r.errors.slice(0, 50) });
  return r.doc;
}

export async function listBranches(projectId: string) {
  const main = await readFile(projectId, SITE_DOC_PATH);
  const rows = await db
    .select({
      id: schema.siteBranches.id,
      name: schema.siteBranches.name,
      description: schema.siteBranches.description,
      revision: schema.siteBranches.revision,
      baseRevision: schema.siteBranches.baseRevision,
      updatedAt: schema.siteBranches.updatedAt,
      mergedAt: schema.siteBranches.mergedAt,
      createdAt: schema.siteBranches.createdAt,
      createdByName: schema.users.name,
    })
    .from(schema.siteBranches)
    .leftJoin(schema.users, eq(schema.users.id, schema.siteBranches.createdBy))
    .where(eq(schema.siteBranches.projectId, projectId))
    .orderBy(desc(schema.siteBranches.updatedAt));
  // "Main moved on" means the live document changed after the branch was made or synced.
  return { mainRevision: main.revision, branches: rows.map((b) => ({ ...b, mainChanged: main.revision !== b.baseRevision })) };
}

export async function getBranch(projectId: string, id: string) {
  const [b] = await db.select().from(schema.siteBranches).where(and(eq(schema.siteBranches.id, id), eq(schema.siteBranches.projectId, projectId)));
  if (!b) throw notFound("Branch");
  return b;
}

export async function createBranch(project: Project, userId: string, input: { name: string; description: string }) {
  const name = input.name.trim();
  if (!name) throw new ApiError("validation_failed", "Name the branch", { name: ["Required"] });
  const existing = await db.select({ id: schema.siteBranches.id, name: schema.siteBranches.name }).from(schema.siteBranches).where(eq(schema.siteBranches.projectId, project.id));
  if (existing.length >= MAX_BRANCHES) throw new ApiError("conflict", `A project can have up to ${MAX_BRANCHES} branches. Delete one you no longer need.`);
  if (existing.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new ApiError("conflict", `There is already a branch called "${name}"`);
  const main = await readFile(project.id, SITE_DOC_PATH);
  const [b] = await db
    .insert(schema.siteBranches)
    .values({ projectId: project.id, name, description: input.description, content: main.content, baseContent: main.content, baseRevision: main.revision, createdBy: userId, updatedBy: userId })
    .returning();
  await audit({ orgId: project.orgId, actorId: userId, action: "branch.created", targetType: "branch", targetId: b.id, metadata: { name, fromRevision: main.revision } });
  return b;
}

/** Optimistic-concurrency save, the same contract as project files. */
export async function saveBranchDoc(projectId: string, id: string, content: string, baseRevision: number, userId: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new ApiError("payload_too_large", "The design document is limited to 1 MB");
  const r = parseSiteDoc(content);
  if (!r.ok) throw new ApiError("validation_failed", "The site document is invalid. Fix the problems listed and save again.", { problems: r.errors.slice(0, 50) });
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(schema.siteBranches).where(and(eq(schema.siteBranches.id, id), eq(schema.siteBranches.projectId, projectId))).for("update");
    if (!b) throw notFound("Branch");
    if (b.revision !== baseRevision) throw new ApiError("revision_conflict", "This branch changed since you opened it. Review the latest version before saving.", { currentRevision: b.revision, baseRevision });
    if (b.content === content) return b;
    await enforceBrand(projectId, b.content, content, "user", tx);
    const [saved] = await tx
      .update(schema.siteBranches)
      .set({ content, revision: b.revision + 1, updatedBy: userId, updatedAt: new Date() })
      .where(eq(schema.siteBranches.id, b.id))
      .returning();
    return saved;
  });
}

/**
 * Three-way merge between the branch and main.
 * into "main": the branch's changes land on the live working copy.
 * into "branch": main's newer changes are brought into the branch.
 */
async function computeMerge(projectId: string, id: string, into: "main" | "branch", resolutions: Record<string, Side>) {
  const b = await getBranch(projectId, id);
  const main = await readFile(projectId, SITE_DOC_PATH);
  const [base, mainDoc, branchDoc] = [parse(b.baseContent, "branch's starting point"), parse(main.content, "main design document"), parse(b.content, "branch")];
  // mergeDocs always calls its second argument "main"; for a sync the sides swap.
  const result = into === "main" ? mergeDocs(base, mainDoc, branchDoc, resolutions) : mergeDocs(base, branchDoc, mainDoc, flip(resolutions));
  const conflicts = into === "main" ? result.conflicts : result.conflicts.map((c) => ({ ...c, main: c.branch, branch: c.main, resolution: c.resolution && flipSide(c.resolution) }));
  // Changes coming in from the other side (mergeDocs counts them as "fromBranch").
  return { branch: b, main, result: { ...result, conflicts }, incoming: result.fromBranch };
}
const flipSide = (s: Side): Side => (s === "main" ? "branch" : "main");
const flip = (r: Record<string, Side>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, flipSide(v)]));

export async function previewMerge(projectId: string, id: string, into: "main" | "branch") {
  const { branch, main, result, incoming } = await computeMerge(projectId, id, into, {});
  const check = siteDocSchema.safeParse(result.doc);
  return {
    into,
    branchRevision: branch.revision,
    mainRevision: main.revision,
    incoming,
    conflicts: result.conflicts,
    upToDate: incoming === 0 && result.conflicts.length === 0,
    problems: check.success ? [] : check.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

export async function mergeBranch(
  project: Project,
  id: string,
  userId: string,
  input: { into: "main" | "branch"; mainRevision: number; branchRevision: number; resolutions: Record<string, Side> },
) {
  const { branch, main, result } = await computeMerge(project.id, id, input.into, input.resolutions);
  if (main.revision !== input.mainRevision || branch.revision !== input.branchRevision) {
    throw new ApiError("revision_conflict", "Someone saved while you were reviewing the merge. Review it again.", { mainRevision: main.revision, branchRevision: branch.revision });
  }
  const open = result.conflicts.filter((c) => !c.resolution);
  if (open.length) throw new ApiError("conflict", `Choose a version for ${open.length} conflicting change(s) first`, { conflicts: open.map((c) => c.id) });
  const check = siteDocSchema.safeParse(result.doc);
  if (!check.success) throw new ApiError("validation_failed", "The merged site would be invalid.", { problems: check.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`) });
  const merged = serializeSiteDoc(check.data);

  return db.transaction(async (tx) => {
    let mainRevision = main.revision;
    if (input.into === "main") {
      const f = await writeFile(project.id, SITE_DOC_PATH, merged, main.revision, { userId, source: "user", message: `Merged branch "${branch.name}"` }, tx);
      mainRevision = f.revision;
    } else {
      await enforceBrand(project.id, branch.content, merged, "user", tx);
    }
    // Afterwards both sides share this document as their new common starting point.
    const [b] = await tx
      .update(schema.siteBranches)
      .set({
        content: merged,
        revision: branch.revision + 1,
        baseContent: input.into === "main" ? merged : main.content,
        baseRevision: mainRevision,
        updatedBy: userId,
        updatedAt: new Date(),
        ...(input.into === "main" ? { mergedAt: new Date(), mergedBy: userId } : {}),
      })
      .where(and(eq(schema.siteBranches.id, branch.id), eq(schema.siteBranches.revision, branch.revision)))
      .returning();
    if (!b) throw new ApiError("revision_conflict", "Someone saved the branch while merging. Review it again.");
    await audit({ orgId: project.orgId, actorId: userId, action: input.into === "main" ? "branch.merged" : "branch.synced", targetType: "branch", targetId: branch.id, metadata: { name: branch.name, mainRevision, resolved: Object.keys(input.resolutions).length } });
    return { branch: b, mainRevision };
  });
}

export async function deleteBranch(project: Project, id: string, userId: string) {
  const b = await getBranch(project.id, id);
  await db.delete(schema.siteBranches).where(eq(schema.siteBranches.id, b.id));
  await audit({ orgId: project.orgId, actorId: userId, action: "branch.deleted", targetType: "branch", targetId: b.id, metadata: { name: b.name, merged: !!b.mergedAt } });
}

export async function deployBranchPreview(project: Project, id: string, userId: string) {
  const b = await getBranch(project.id, id);
  return createDeployment(project, "preview", userId, { name: b.name, content: b.content, revision: b.revision });
}
