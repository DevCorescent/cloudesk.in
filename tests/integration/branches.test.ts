import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { parseSiteDoc, serializeSiteDoc, SITE_DOC_PATH, type SiteDoc } from "@/lib/site/model";
import * as invAccept from "@/app/api/v1/invitations/accept/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgInvites from "@/app/api/v1/orgs/[orgId]/invitations/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as branches from "@/app/api/v1/projects/[projectId]/branches/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as promote from "@/app/api/v1/projects/[projectId]/deployments/[deploymentId]/promote/route";
import * as fileRoute from "@/app/api/v1/projects/[projectId]/file/route";
import { call, cookieFrom, resetDb } from "../helpers";

type U = { cookie: string; orgId: string };
let owner: U;
let viewer: U;
let projectId = "";

async function user(name: string, email: string): Promise<U> {
  const r = await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } });
  const cookie = cookieFrom(r);
  return { cookie, orgId: (await call(me.GET, { cookie })).json.organizations[0].id };
}
const b = (u: U, method: string, slug: string[] = [], body?: unknown, query = "") =>
  call(branches[method as "GET"], { method, cookie: u.cookie, body, params: { projectId, slug }, path: `/x${query}` });
const filePath = `/x?path=${SITE_DOC_PATH}`;
async function readMain() {
  const f = await call(fileRoute.GET, { cookie: owner.cookie, params: { projectId }, path: filePath });
  return { doc: (parseSiteDoc(f.json.content) as { doc: SiteDoc }).doc, revision: f.json.revision as number };
}
async function writeMain(edit: (d: SiteDoc) => void) {
  const { doc, revision } = await readMain();
  edit(doc);
  const r = await call(fileRoute.PUT, { method: "PUT", cookie: owner.cookie, params: { projectId }, path: filePath, body: { content: serializeSiteDoc(doc), baseRevision: revision } });
  expect(r.status).toBe(200);
}
async function editBranch(id: string, edit: (d: SiteDoc) => void) {
  const g = await b(owner, "GET", [id, "doc"]);
  const doc = (parseSiteDoc(g.json.content) as { doc: SiteDoc }).doc;
  edit(doc);
  return b(owner, "PUT", [id, "doc"], { content: serializeSiteDoc(doc), baseRevision: g.json.revision });
}
const heroOf = (d: SiteDoc) => d.pages[0].sections.find((s) => s.type === "hero")!;

beforeAll(async () => {
  await resetDb();
  owner = await user("Olivia Owner", "olivia@example.com");
  viewer = await user("Vic Viewer", "vic@example.com");
  projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { templateId: "restaurant", name: "Bistro" } })).json.project.id;
  await call(orgInvites.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { email: "vic@example.com", role: "viewer" } });
  const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "vic@example.com")).orderBy(desc(schema.outboundEmails.createdAt));
  const token = mails.map((m) => m.body.match(/invit\S*token=([\w-]+)/)?.[1]).find(Boolean)!;
  await call(invAccept.POST, { method: "POST", cookie: viewer.cookie, body: { token } });
});

afterAll(async () => {
  await closeDb();
});

describe("version branches", () => {
  let id = "";

  it("creates a branch from main that viewers can see but not change", async () => {
    expect((await b(viewer, "POST", [], { name: "Diwali look" })).status).toBe(403);
    const r = await b(owner, "POST", [], { name: "Diwali look", description: "Festive colours" });
    expect(r.status).toBe(201);
    id = r.json.branch.id;
    expect((await b(owner, "POST", [], { name: "diwali LOOK" })).status).toBe(409);
    const list = await b(viewer, "GET");
    expect(list.json.branches).toMatchObject([{ name: "Diwali look", mainChanged: false, createdByName: "Olivia Owner" }]);
    expect((await b(viewer, "GET", [id, "doc"])).json.revision).toBe(1);
    expect((await b(viewer, "PUT", [id, "doc"], { content: "{}", baseRevision: 1 })).status).toBe(403);
    expect((await b(owner, "GET", ["not-a-uuid", "doc"])).status).toBe(404);
  });

  it("saves branch edits with revision checks, without touching main", async () => {
    const before = await readMain();
    const r = await editBranch(id, (d) => {
      heroOf(d).props.heading = "Festive menu";
      d.theme.palette.accent = "#d97706";
    });
    expect(r.json.revision).toBe(2);
    expect((await b(owner, "PUT", [id, "doc"], { content: "{}", baseRevision: 2 })).status).toBe(422);
    expect((await b(owner, "PUT", [id, "doc"], { content: serializeSiteDoc(before.doc), baseRevision: 1 })).status).toBe(409);
    const after = await readMain();
    expect(after.revision).toBe(before.revision);
    expect(heroOf(after.doc).props.heading).not.toBe("Festive menu");
    const meta = await b(owner, "GET", [id, "doc"], undefined, "?meta=1");
    expect(meta.json).toMatchObject({ revision: 2, updatedByName: "Olivia Owner" });
  });

  it("previews the branch as its own deployment, which can't be promoted", async () => {
    const r = await b(owner, "POST", [id, "deploy"], {});
    expect(r.status).toBe(201);
    expect(r.json.deployment).toMatchObject({ status: "ready", environment: "preview" });
    const [dep] = await db.select().from(schema.deployments).where(eq(schema.deployments.id, r.json.deployment.id));
    expect(dep.branchName).toBe("Diwali look");
    expect(dep.sourceRevisions).toEqual({ "branch:Diwali look": 2 });
    expect((dep.artifact as Record<string, string>)["/"]).toContain("Festive menu");
    const p = await call(promote.POST, { method: "POST", cookie: owner.cookie, params: { projectId, deploymentId: dep.id } });
    expect(p.status).toBe(409);
    expect((await call(deployments.GET, { cookie: owner.cookie, params: { projectId } })).json.deployments[0].branchName).toBe("Diwali look");
  });

  it("merges into main, asking about real conflicts only", async () => {
    await writeMain((d) => {
      heroOf(d).props.heading = "Weekday specials";
      heroOf(d).props.subheading = "Lunch from noon";
    });
    expect((await b(owner, "GET")).json.branches[0].mainChanged).toBe(true);
    const preview = await b(owner, "GET", [id, "merge"], undefined, "?into=main");
    expect(preview.json.upToDate).toBe(false);
    expect(preview.json.conflicts).toHaveLength(1);
    const [conflict] = preview.json.conflicts;
    expect(conflict).toMatchObject({ main: "Weekday specials", branch: "Festive menu", resolution: null });
    const body = { into: "main", mainRevision: preview.json.mainRevision, branchRevision: preview.json.branchRevision };
    const unresolved = await b(owner, "POST", [id, "merge"], { ...body, resolutions: {} });
    expect(unresolved.status).toBe(409);
    expect((await b(owner, "POST", [id, "merge"], { ...body, mainRevision: body.mainRevision - 1, resolutions: { [conflict.id]: "branch" } })).status).toBe(409);
    const ok = await b(owner, "POST", [id, "merge"], { ...body, resolutions: { [conflict.id]: "branch" } });
    expect(ok.status).toBe(200);
    const main = await readMain();
    expect(main.revision).toBe(ok.json.mainRevision);
    expect(heroOf(main.doc).props.heading).toBe("Festive menu");
    expect(heroOf(main.doc).props.subheading).toBe("Lunch from noon");
    expect(main.doc.theme.palette.accent).toBe("#d97706");
    const [rev] = await db.select().from(schema.fileRevisions).where(eq(schema.fileRevisions.projectId, projectId)).orderBy(desc(schema.fileRevisions.revision)).limit(1);
    expect(rev.message).toBe('Merged branch "Diwali look"');
    const list = (await b(owner, "GET")).json.branches[0];
    expect(list.mergedAt).not.toBeNull();
    expect(list.mainChanged).toBe(false);
    expect((await b(owner, "GET", [id, "merge"], undefined, "?into=main")).json.upToDate).toBe(true);
  });

  it("brings newer main changes into the branch", async () => {
    await writeMain((d) => {
      d.name = "Bistro & Bar";
    });
    await editBranch(id, (d) => {
      heroOf(d).props.subheading = "Sweets all week";
    });
    const preview = await b(owner, "GET", [id, "merge"], undefined, "?into=branch");
    expect(preview.json).toMatchObject({ conflicts: [], incoming: 1, upToDate: false });
    const r = await b(owner, "POST", [id, "merge"], { into: "branch", mainRevision: preview.json.mainRevision, branchRevision: preview.json.branchRevision });
    expect(r.status).toBe(200);
    const g = await b(owner, "GET", [id, "doc"]);
    const doc = (parseSiteDoc(g.json.content) as { doc: SiteDoc }).doc;
    expect(doc.name).toBe("Bistro & Bar");
    expect(heroOf(doc).props.subheading).toBe("Sweets all week");
    // Main is untouched by a sync.
    expect(heroOf((await readMain()).doc).props.subheading).toBe("Lunch from noon");
  });

  it("deletes branches; merged history stays on main", async () => {
    expect((await b(viewer, "DELETE", [id])).status).toBe(403);
    expect((await b(owner, "DELETE", [id])).status).toBe(200);
    expect((await b(owner, "GET")).json.branches).toEqual([]);
    expect(heroOf((await readMain()).doc).props.heading).toBe("Festive menu");
  });
});
