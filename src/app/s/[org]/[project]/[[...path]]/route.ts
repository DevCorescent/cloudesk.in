import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { serveDeployment } from "@/server/hosting/serve";

// Stable production URL for a project: /s/<org-slug>/<project-slug>/...
export async function GET(req: Request, { params }: { params: Promise<{ org: string; project: string; path?: string[] }> }) {
  const { org, project, path } = await params;
  const [row] = await db
    .select({ prod: schema.projects.productionDeploymentId })
    .from(schema.projects)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .where(and(eq(schema.organizations.slug, org), eq(schema.projects.slug, project)));
  if (!row?.prod) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  return serveDeployment(req, row.prod, path, `/s/${org}/${project}`, { requireProduction: true });
}

// Order tracking form (no JavaScript on published sites).
export async function POST(req: Request, { params }: { params: Promise<{ org: string; project: string; path?: string[] }> }) {
  const { org, project, path } = await params;
  if ((path ?? []).join("/") !== "track" || req.headers.get("origin") !== new URL(req.url).origin) return new Response("Not found", { status: 404 });
  const [row] = await db
    .select({ prod: schema.projects.productionDeploymentId })
    .from(schema.projects)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .where(and(eq(schema.organizations.slug, org), eq(schema.projects.slug, project)));
  if (!row?.prod) return new Response("Not found", { status: 404 });
  return serveDeployment(req, row.prod, path, `/s/${org}/${project}`, { requireProduction: true, trackForm: await req.formData() });
}
