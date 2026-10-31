import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";
import { composeSiteJson } from "@/lib/site/planner";
import type { ProjectSpec } from "@/lib/site/spec";
import { notFound } from "../http/errors";
import { audit } from "./audit";
import { createFile } from "./files";
import { slugify } from "./orgs";
import { assertWithinLimit } from "../billing/billing";
import { contains } from "../security/like";

function readme(spec: ProjectSpec): string {
  const lines = [
    `# ${spec.name}`,
    "",
    spec.summary || "",
    "",
    "## Project files",
    "",
    `- \`${SITE_DOC_PATH}\` — the site design document. The visual builder edits this file;`,
    "  you can also edit it directly here. It is validated on every save.",
    "",
    "## Specification",
    "",
    `- Audience: ${spec.audience}`,
    `- Tone: ${spec.tone}`,
    ...spec.goals.map((g) => `- Goal: ${g}`),
    "",
    "### Pages",
    ...spec.pages.map((p) => `- \`${p.path}\` ${p.title} — ${p.purpose}`),
  ];
  if (spec.dataModels.length) {
    lines.push("", "### Data", ...spec.dataModels.map((m) => `- ${m.name}: ${m.fields.join(", ")} — ${m.purpose}`));
  }
  if (spec.assumptions.length) lines.push("", "### Assumptions", ...spec.assumptions.map((a) => `- ${a}`));
  return lines.join("\n") + "\n";
}

async function uniqueSlug(orgId: string, name: string) {
  const base = slugify(name);
  const rows = await db
    .select({ slug: schema.projects.slug })
    .from(schema.projects)
    .where(and(eq(schema.projects.orgId, orgId), sql`${schema.projects.slug} ~ ${`^${base}(-[0-9]+)?$`}`));
  if (!rows.length) return base;
  const taken = new Set(rows.map((r) => r.slug));
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function createProjectFromSpec(orgId: string, userId: string, spec: ProjectSpec, source: "template" | "ai" | "user", siteJson?: string) {
  await assertWithinLimit(orgId, "projects");
  const slug = await uniqueSlug(orgId, spec.name);
  const project = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(schema.projects)
      .values({ orgId, name: spec.name, slug, kind: spec.kind, description: spec.summary.slice(0, 500), spec, createdBy: userId })
      .returning();
    const author = { userId, source: source === "user" ? ("system" as const) : source, message: "Project created" };
    await createFile(p.id, SITE_DOC_PATH, siteJson ?? composeSiteJson(spec), author, tx);
    await createFile(p.id, "README.md", readme(spec), author, tx);
    return p;
  });
  await audit({ orgId, actorId: userId, action: "project.created", targetType: "project", targetId: project.id, metadata: { source } });
  return project;
}

export async function listProjects(orgId: string, opts: { q?: string; limit?: number; offset?: number } = {}) {
  const where = and(
    eq(schema.projects.orgId, orgId),
    isNull(schema.projects.archivedAt),
    opts.q ? or(ilike(schema.projects.name, contains(opts.q)), ilike(schema.projects.description, contains(opts.q))) : undefined,
  );
  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        slug: schema.projects.slug,
        kind: schema.projects.kind,
        description: schema.projects.description,
        updatedAt: schema.projects.updatedAt,
        productionDeploymentId: schema.projects.productionDeploymentId,
      })
      .from(schema.projects)
      .where(where)
      .orderBy(desc(schema.projects.updatedAt))
      .limit(Math.min(opts.limit ?? 50, 100))
      .offset(opts.offset ?? 0),
    db.select({ total: sql<number>`count(*)::int` }).from(schema.projects).where(where),
  ]);
  return { items, total };
}

export async function updateProject(projectId: string, orgId: string, userId: string, patch: { name?: string; description?: string }) {
  const [p] = await db
    .update(schema.projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId)))
    .returning();
  if (!p) throw notFound("Project");
  await audit({ orgId, actorId: userId, action: "project.updated", targetType: "project", targetId: projectId, metadata: patch });
  return p;
}

export async function archiveProject(projectId: string, orgId: string, userId: string) {
  await db.update(schema.projects).set({ archivedAt: new Date() }).where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId)));
  await audit({ orgId, actorId: userId, action: "project.archived", targetType: "project", targetId: projectId });
}

export async function projectActivity(projectId: string, limit = 30) {
  return db
    .select({
      path: schema.fileRevisions.path,
      revision: schema.fileRevisions.revision,
      source: schema.fileRevisions.source,
      message: schema.fileRevisions.message,
      createdAt: schema.fileRevisions.createdAt,
      authorName: schema.users.name,
    })
    .from(schema.fileRevisions)
    .leftJoin(schema.users, eq(schema.users.id, schema.fileRevisions.authorId))
    .where(eq(schema.fileRevisions.projectId, projectId))
    .orderBy(desc(schema.fileRevisions.createdAt))
    .limit(limit);
}
