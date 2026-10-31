import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";
import * as invAccept from "@/app/api/v1/invitations/accept/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgInvites from "@/app/api/v1/orgs/[orgId]/invitations/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as collab from "@/app/api/v1/projects/[projectId]/collab/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as fileRoute from "@/app/api/v1/projects/[projectId]/file/route";
import * as review from "@/app/review/[token]/route";
import * as rv from "@/app/rv/[token]/[[...path]]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

type U = { cookie: string; orgId: string };
let owner: U;
let designer: U;
let viewer: U;
let outsider: U;
let projectId = "";

async function user(name: string, email: string): Promise<U> {
  const r = await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } });
  const cookie = cookieFrom(r);
  return { cookie, orgId: (await call(me.GET, { cookie })).json.organizations[0].id };
}
async function invite(email: string, role: string, u: U) {
  await call(orgInvites.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { email, role } });
  const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, email)).orderBy(desc(schema.outboundEmails.createdAt));
  const token = mails.map((m) => m.body.match(/invit\S*token=([\w-]+)/)?.[1]).find(Boolean)!;
  expect((await call(invAccept.POST, { method: "POST", cookie: u.cookie, body: { token } })).status).toBe(200);
}
const c = (u: U, method: string, slug: string[], body?: unknown) => call(collab[method as "GET"], { method, cookie: u.cookie, body, params: { projectId, slug } });

beforeAll(async () => {
  await resetDb();
  owner = await user("Olivia Owner", "olivia@example.com");
  designer = await user("Dev Designer", "dev@example.com");
  viewer = await user("Vic Viewer", "vic@example.com");
  outsider = await user("Ola Outsider", "ola@example.com");
  projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { templateId: "blank", name: "Team site" } })).json.project.id;
  await invite("dev@example.com", "designer", designer);
  await invite("vic@example.com", "viewer", viewer);
});

afterAll(async () => {
  await closeDb();
});

describe("presence and live sync", () => {
  it("shows who else is editing, and forgets them when they go quiet", async () => {
    expect((await c(owner, "POST", ["presence"], { pageId: "p1", sectionId: "s1" })).json.others).toEqual([]);
    const seen = await c(designer, "POST", ["presence"], { pageId: "p1", sectionId: "s2" });
    expect(seen.json.others).toMatchObject([{ name: "Olivia Owner", sectionId: "s1" }]);
    await db.update(schema.editorPresence).set({ seenAt: new Date(Date.now() - 60_000) }).where(eq(schema.editorPresence.pageId, "p1"));
    expect((await c(owner, "POST", ["presence"], { pageId: "p1" })).json.others).toEqual([]);
    expect((await c(outsider, "POST", ["presence"], {})).status).toBe(404);
  });

  it("tells editors about newer revisions and who made them", async () => {
    const f = await call(fileRoute.GET, { cookie: designer.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    const doc = JSON.parse(f.json.content);
    doc.name = "Team site v2";
    await call(fileRoute.PUT, { method: "PUT", cookie: designer.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}`, body: { content: JSON.stringify(doc, null, 2), baseRevision: f.json.revision } });
    const meta = await call(fileRoute.GET, { cookie: owner.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}&meta=1` });
    expect(meta.json).toMatchObject({ revision: f.json.revision + 1, updatedByName: "Dev Designer" });
    expect(meta.json.content).toBeUndefined();
  });
});

describe("comments", () => {
  it("lets anyone on the project comment and mention teammates; only editors resolve", async () => {
    const made = await c(viewer, "POST", ["comments"], { pageId: "p1", sectionId: "s1", body: "Can @olivia check the hero copy? cc @dev" });
    expect(made.status).toBe(201);
    const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, "Vic Viewer mentioned you on Team site"));
    expect(mails.map((m) => m.to).sort()).toEqual(["dev@example.com", "olivia@example.com"]);
    await c(designer, "POST", ["comments"], { pageId: "p1", sectionId: "s1", body: "On it", parentId: made.json.comment.id });
    expect((await c(viewer, "POST", ["comments", made.json.comment.id, "resolve"], { resolved: true })).status).toBe(404);
    expect((await c(designer, "POST", ["comments", made.json.comment.id, "resolve"], { resolved: true })).status).toBe(200);
    const list = (await c(owner, "GET", ["comments"])).json.comments;
    expect(list).toHaveLength(2);
    expect(list[0].resolvedAt).not.toBeNull();
    expect((await c(outsider, "GET", ["comments"])).status).toBe(404);
    // Deleting a comment takes its replies; others' comments can't be deleted by viewers.
    expect((await c(viewer, "DELETE", ["comments", list[1].id])).status).toBe(403);
    expect((await c(viewer, "DELETE", ["comments", made.json.comment.id])).status).toBe(200);
    expect((await c(owner, "GET", ["comments"])).json.comments).toHaveLength(0);
  });
});

describe("client review links", () => {
  let token = "";
  it("needs a deployed version and preview rights to share", async () => {
    expect((await c(designer, "POST", ["review-links"], { label: "Round 1" })).status).toBe(409);
    const dep = await call(deployments.POST, { method: "POST", cookie: owner.cookie, params: { projectId }, body: { environment: "preview" } });
    expect(dep.json.deployment.status).toBe("ready");
    expect((await c(viewer, "POST", ["review-links"], { label: "x" })).status).toBe(403);
    const r = await c(designer, "POST", ["review-links"], { label: "Round 1", days: 7 });
    expect(r.status).toBe(201);
    token = new URL(r.json.url).pathname.split("/").pop()!;
  });

  it("shows the preview to a client without an account, and records comments and approval", async () => {
    const pageRes = await review.GET(new Request(`${ORIGIN}/review/${token}`), { params: Promise.resolve({ token }) });
    const html = await pageRes.text();
    expect(html).toContain("Team site");
    expect(html).toContain(`<iframe title="Preview" src="/rv/${token}/"`);
    const site = await rv.GET(new Request(`${ORIGIN}/rv/${token}/`), { params: Promise.resolve({ token, path: [] }) });
    expect(site.status).toBe(200);
    expect(site.headers.get("x-robots-tag")).toContain("noindex");
    expect((await rv.GET(new Request(`${ORIGIN}/rv/nope-nope-nope-nope-nope/`), { params: Promise.resolve({ token: "nope-nope-nope-nope-nope", path: [] }) })).status).toBe(404);

    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return review.POST(new Request(`${ORIGIN}/review/${token}`, { method: "POST", headers: { origin: ORIGIN }, body: f }), { params: Promise.resolve({ token }) });
    };
    expect((await form({ action: "comment", name: "Priya (client)", page: "/", body: "Love it — can the logo be bigger?" })).status).toBe(303);
    expect((await form({ action: "approve", name: "Priya", page: "/", note: "Go ahead and launch" })).status).toBe(303);
    const links = (await c(owner, "GET", ["review-links"])).json.links;
    expect(links[0]).toMatchObject({ status: "approved", decidedBy: "Priya", decisionNote: "Go ahead and launch" });
    const comments = (await c(owner, "GET", ["comments"])).json.comments;
    expect(comments.map((x: { guestName: string }) => x.guestName)).toContain("Priya (client)");
    expect((await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, "Priya approved Team site"))).length).toBeGreaterThanOrEqual(2);
  });

  it("stops working when turned off", async () => {
    const [l] = (await c(owner, "GET", ["review-links"])).json.links;
    await c(owner, "POST", ["review-links", l.id, "revoke"], {});
    expect((await review.GET(new Request(`${ORIGIN}/review/${token}`), { params: Promise.resolve({ token }) })).status).toBe(404);
    expect((await rv.GET(new Request(`${ORIGIN}/rv/${token}/`), { params: Promise.resolve({ token, path: [] }) })).status).toBe(404);
  });
});
