import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { parseSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import * as login from "@/app/api/v1/auth/login/route";
import * as logout from "@/app/api/v1/auth/logout/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as forgot from "@/app/api/v1/auth/forgot-password/route";
import * as reset from "@/app/api/v1/auth/reset-password/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as verify from "@/app/api/v1/auth/verify-email/route";
import * as invAccept from "@/app/api/v1/invitations/accept/route";
import * as orgInvites from "@/app/api/v1/orgs/[orgId]/invitations/route";
import * as orgMember from "@/app/api/v1/orgs/[orgId]/members/[userId]/route";
import * as orgPlan from "@/app/api/v1/orgs/[orgId]/plan/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as orgProvider from "@/app/api/v1/orgs/[orgId]/providers/[provider]/route";
import * as task from "@/app/api/v1/ai/tasks/[taskId]/route";
import * as taskApply from "@/app/api/v1/ai/tasks/[taskId]/apply/route";
import * as taskCancel from "@/app/api/v1/ai/tasks/[taskId]/cancel/route";
import * as taskRetry from "@/app/api/v1/ai/tasks/[taskId]/retry/route";
import * as project from "@/app/api/v1/projects/[projectId]/route";
import * as projTasks from "@/app/api/v1/projects/[projectId]/ai/tasks/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as promote from "@/app/api/v1/projects/[projectId]/deployments/[deploymentId]/promote/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import * as fileHistory from "@/app/api/v1/projects/[projectId]/file/history/route";
import * as fileRestore from "@/app/api/v1/projects/[projectId]/file/restore/route";
import * as files from "@/app/api/v1/projects/[projectId]/files/route";
import * as submissions from "@/app/api/v1/projects/[projectId]/submissions/route";
import * as siteForm from "@/app/api/v1/sites/[deploymentId]/forms/[formId]/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { call, cookieFrom, ORIGIN, resetDb, waitFor } from "../helpers";

const PW = "correct-horse-42";

async function newUser(name: string, email: string) {
  const r = await call(signup.POST, { method: "POST", body: { name, email, password: PW } });
  expect(r.status).toBe(201);
  const cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  return { cookie, id: m.json.user.id as string, orgId: m.json.organizations[0].id as string };
}

let alice: Awaited<ReturnType<typeof newUser>>;
let mallory: Awaited<ReturnType<typeof newUser>>;
let projectId: string;

beforeAll(async () => {
  await resetDb();
  alice = await newUser("Alice Owner", "alice@example.com");
  mallory = await newUser("Mallory Other", "mallory@example.com");
});

afterAll(async () => {
  await closeDb();
});

describe("authentication", () => {
  it("rejects duplicate emails case-insensitively", async () => {
    const r = await call(signup.POST, { method: "POST", body: { name: "A", email: "ALICE@example.com", password: PW } });
    expect(r.status).toBe(409);
  });

  it("validates passwords", async () => {
    const r = await call(signup.POST, { method: "POST", body: { name: "B", email: "b@example.com", password: "short" } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("validation_failed");
  });

  it("logs in, reports a generic error for wrong passwords, and logs out", async () => {
    const bad = await call(login.POST, { method: "POST", body: { email: "alice@example.com", password: "wrong-password-1" } });
    expect(bad.status).toBe(401);
    const nobody = await call(login.POST, { method: "POST", body: { email: "nobody@example.com", password: "wrong-password-1" } });
    expect(nobody.json.error.message).toBe(bad.json.error.message);
    const ok = await call(login.POST, { method: "POST", body: { email: "alice@example.com", password: PW } });
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax/);
    await call(logout.POST, { method: "POST", cookie });
    expect((await call(me.GET, { cookie })).status).toBe(401);
  });

  it("rejects cross-origin mutations (CSRF)", async () => {
    const r = await call(orgProjects.POST, { method: "POST", cookie: alice.cookie, params: { orgId: alice.orgId }, body: { templateId: "blank" }, origin: "https://evil.example" });
    expect(r.status).toBe(403);
    const none = await call(orgProjects.POST, { method: "POST", cookie: alice.cookie, params: { orgId: alice.orgId }, body: { templateId: "blank" }, origin: null });
    expect(none.status).toBe(403);
  });

  it("verifies email with a single-use token", async () => {
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "alice@example.com")).orderBy(desc(schema.outboundEmails.createdAt)).limit(1);
    const token = mail.body.match(/token=([\w-]+)/)![1];
    expect((await call(verify.POST, { method: "POST", body: { token } })).status).toBe(200);
    expect((await call(verify.POST, { method: "POST", body: { token } })).status).toBe(400);
    expect((await call(me.GET, { cookie: alice.cookie })).json.user.emailVerified).toBe(true);
  });

  it("resets a password and revokes existing sessions", async () => {
    const u = await newUser("Reset Me", "reset@example.com");
    await call(forgot.POST, { method: "POST", body: { email: "reset@example.com" } });
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, "Reset your password"));
    const token = mail.body.match(/token=([\w-]+)/)![1];
    expect((await call(reset.POST, { method: "POST", body: { token, password: "a-new-password-9" } })).status).toBe(200);
    expect((await call(me.GET, { cookie: u.cookie })).status).toBe(401);
    expect((await call(login.POST, { method: "POST", body: { email: "reset@example.com", password: "a-new-password-9" } })).status).toBe(200);
  });
});

describe("projects and files", () => {
  it("creates a project from a template with real files", async () => {
    const r = await call(orgProjects.POST, { method: "POST", cookie: alice.cookie, params: { orgId: alice.orgId }, body: { templateId: "restaurant", name: "Saffron House" } });
    expect(r.status).toBe(201);
    projectId = r.json.project.id;
    const list = await call(files.GET, { cookie: alice.cookie, params: { projectId } });
    expect(list.json.files.map((f: { path: string }) => f.path)).toEqual(["README.md", SITE_DOC_PATH]);
    const site = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    expect(parseSiteDoc(site.json.content).ok).toBe(true);
  });

  it("saves with optimistic concurrency and records history", async () => {
    const path = `/x?path=${SITE_DOC_PATH}`;
    const cur = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path });
    const doc = JSON.parse(cur.json.content);
    doc.name = "Saffron House Kitchen";
    const saved = await call(file.PUT, { method: "PUT", cookie: alice.cookie, params: { projectId }, path, body: { content: JSON.stringify(doc), baseRevision: cur.json.revision } });
    expect(saved.status).toBe(200);
    expect(saved.json.revision).toBe(cur.json.revision + 1);

    // A second writer still holding the old revision is rejected, not merged.
    const stale = await call(file.PUT, { method: "PUT", cookie: alice.cookie, params: { projectId }, path, body: { content: cur.json.content, baseRevision: cur.json.revision } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("revision_conflict");

    const hist = await call(fileHistory.GET, { cookie: alice.cookie, params: { projectId }, path });
    expect(hist.json.revisions.map((r: { revision: number }) => r.revision)).toEqual([2, 1]);

    const restored = await call(fileRestore.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { path: SITE_DOC_PATH, revision: 1, baseRevision: 2 } });
    expect(restored.json.revision).toBe(3);
  });

  it("refuses to save an invalid design document", async () => {
    const path = `/x?path=${SITE_DOC_PATH}`;
    const cur = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path });
    const r = await call(file.PUT, { method: "PUT", cookie: alice.cookie, params: { projectId }, path, body: { content: "{ not json", baseRevision: cur.json.revision } });
    expect(r.status).toBe(422);
    expect(r.json.error.details.problems[0]).toMatch(/Invalid JSON/);
  });

  it("rejects path traversal", async () => {
    const r = await call(files.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { path: "../../etc/passwd", content: "x" } });
    expect(r.status).toBe(422);
  });
});

describe("tenant isolation", () => {
  it("hides another organization's project, files, tasks and deployments", async () => {
    const asMallory = { cookie: mallory.cookie, params: { projectId } };
    expect((await call(project.GET, asMallory)).status).toBe(404);
    expect((await call(files.GET, asMallory)).status).toBe(404);
    expect((await call(file.GET, { ...asMallory, path: `/x?path=${SITE_DOC_PATH}` })).status).toBe(404);
    expect((await call(deployments.GET, asMallory)).status).toBe(404);
    expect((await call(deployments.POST, { ...asMallory, method: "POST", body: { environment: "production" } })).status).toBe(404);
    expect((await call(projTasks.GET, asMallory)).status).toBe(404);
    expect((await call(submissions.GET, asMallory)).status).toBe(404);
    expect((await call(orgProjects.GET, { cookie: mallory.cookie, params: { orgId: alice.orgId } })).status).toBe(404);
    expect((await call(orgProvider.PUT, { method: "PUT", cookie: mallory.cookie, params: { orgId: alice.orgId, provider: "anthropic" }, body: { apiKey: "x".repeat(30) } })).status).toBe(404);
  });

  it("does not let another tenant read or act on an AI task", async () => {
    const created = await call(projTasks.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { kind: "site_edit", input: { instruction: "Add a FAQ section" } } });
    const taskId = created.json.task.id;
    await waitFor(() => call(task.GET, { cookie: alice.cookie, params: { taskId } }), (r) => r.json.task.status !== "queued" && r.json.task.status !== "running");
    expect((await call(task.GET, { cookie: mallory.cookie, params: { taskId } })).status).toBe(404);
    expect((await call(taskApply.POST, { method: "POST", cookie: mallory.cookie, params: { taskId } })).status).toBe(404);
  });

  it("rejects malformed ids without leaking errors", async () => {
    expect((await call(project.GET, { cookie: alice.cookie, params: { projectId: "not-a-uuid" } })).status).toBe(404);
  });
});

describe("roles", () => {
  let viewer: Awaited<ReturnType<typeof newUser>>;
  it("invites a viewer who can read but not write or deploy", async () => {
    const inv = await call(orgInvites.POST, { method: "POST", cookie: alice.cookie, params: { orgId: alice.orgId }, body: { email: "vic@example.com", role: "viewer" } });
    expect(inv.status).toBe(201);
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "vic@example.com"));
    const token = mail.body.match(/token=([\w-]+)/)![1];
    viewer = await newUser("Vic Viewer", "vic@example.com");
    // A different user cannot redeem it.
    expect((await call(invAccept.POST, { method: "POST", cookie: mallory.cookie, body: { token } })).status).toBe(403);
    expect((await call(invAccept.POST, { method: "POST", cookie: viewer.cookie, body: { token } })).status).toBe(200);

    const as = { cookie: viewer.cookie, params: { projectId } };
    expect((await call(project.GET, as)).status).toBe(200);
    const cur = await call(file.GET, { ...as, path: `/x?path=${SITE_DOC_PATH}` });
    expect((await call(file.PUT, { ...as, method: "PUT", path: `/x?path=${SITE_DOC_PATH}`, body: { content: cur.json.content, baseRevision: cur.json.revision } })).status).toBe(403);
    expect((await call(deployments.POST, { ...as, method: "POST", body: { environment: "preview" } })).status).toBe(403);
    expect((await call(projTasks.POST, { ...as, method: "POST", body: { kind: "site_edit", input: { instruction: "Add a FAQ section" } } })).status).toBe(403);
  });

  it("lets a designer edit the design but not code files", async () => {
    await call(orgMember.PATCH, { method: "PATCH", cookie: alice.cookie, params: { orgId: alice.orgId, userId: viewer.id }, body: { role: "designer" } });
    const as = { cookie: viewer.cookie, params: { projectId } };
    const cur = await call(file.GET, { ...as, path: `/x?path=README.md` });
    expect((await call(file.PUT, { ...as, method: "PUT", path: `/x?path=README.md`, body: { content: "changed", baseRevision: cur.json.revision } })).status).toBe(403);
    expect((await call(files.POST, { ...as, method: "POST", body: { path: "src/x.ts", content: "" } })).status).toBe(403);
  });

  it("keeps at least one owner", async () => {
    const r = await call(orgMember.PATCH, { method: "PATCH", cookie: alice.cookie, params: { orgId: alice.orgId, userId: alice.id }, body: { role: "admin" } });
    expect(r.status).toBe(409);
  });
});

describe("AI tasks", () => {
  const done = (r: { json: { task: { status: string } } }) => !["queued", "running"].includes(r.json.task.status);

  it("plans a project with the built-in planner when no provider is connected", async () => {
    const r = await call(orgPlan.POST, { method: "POST", cookie: alice.cookie, params: { orgId: alice.orgId }, body: { brief: "A portfolio for a photographer called \"Lumen\" with a gallery" } });
    expect(r.status).toBe(202);
    const t = await waitFor(() => call(task.GET, { cookie: alice.cookie, params: { taskId: r.json.task.id } }), done);
    expect(t.json.task.status).toBe("succeeded");
    expect(t.json.task.result.planner).toBe("builtin");
    expect(t.json.task.result.spec.name).toBe("Lumen");
    // Another member of the same org cannot read someone's private brief.
    expect((await call(task.GET, { cookie: mallory.cookie, params: { taskId: r.json.task.id } })).status).toBe(404);
  });

  it("proposes a change for review, then applies it with attribution", async () => {
    const r = await call(projTasks.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { kind: "site_edit", input: { instruction: "Add a pricing section" } } });
    const t = await waitFor(() => call(task.GET, { cookie: alice.cookie, params: { taskId: r.json.task.id } }), done);
    expect(t.json.task.status).toBe("awaiting_review");
    const change = t.json.task.result.changes[0];
    expect(change.path).toBe(SITE_DOC_PATH);
    expect(change.after).toContain('"type": "pricing"');
    // Nothing is written until the user accepts.
    const before = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    expect(before.json.revision).toBe(change.baseRevision);

    expect((await call(taskApply.POST, { method: "POST", cookie: alice.cookie, params: { taskId: r.json.task.id } })).status).toBe(200);
    const after = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    expect(after.json.revision).toBe(change.baseRevision + 1);
    const hist = await call(fileHistory.GET, { cookie: alice.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    expect(hist.json.revisions[0].source).toBe("ai");
    expect(hist.json.revisions[0].aiTaskId).toBe(r.json.task.id);
    // Applying twice is refused.
    expect((await call(taskApply.POST, { method: "POST", cookie: alice.cookie, params: { taskId: r.json.task.id } })).status).toBe(409);
  });

  it("refuses to apply a stale patch over newer edits", async () => {
    const r = await call(projTasks.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { kind: "site_edit", input: { instruction: "Add a gallery section" } } });
    await waitFor(() => call(task.GET, { cookie: alice.cookie, params: { taskId: r.json.task.id } }), done);
    const cur = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    const doc = JSON.parse(cur.json.content);
    doc.name = "Edited meanwhile";
    await call(file.PUT, { method: "PUT", cookie: alice.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}`, body: { content: JSON.stringify(doc), baseRevision: cur.json.revision } });
    const apply = await call(taskApply.POST, { method: "POST", cookie: alice.cookie, params: { taskId: r.json.task.id } });
    expect(apply.status).toBe(409);
    expect(apply.json.error.code).toBe("revision_conflict");
    const latest = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    expect(JSON.parse(latest.json.content).name).toBe("Edited meanwhile");
  });

  it("fails clearly when a request needs a model that is not connected, and can be retried", async () => {
    const r = await call(projTasks.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { kind: "site_edit", input: { instruction: "Rewrite the hero copy for young families" } } });
    const t = await waitFor(() => call(task.GET, { cookie: alice.cookie, params: { taskId: r.json.task.id } }), done);
    expect(t.json.task.status).toBe("failed");
    expect(t.json.task.errorCode).toBe("provider_not_configured");
    const retry = await call(taskRetry.POST, { method: "POST", cookie: alice.cookie, params: { taskId: r.json.task.id } });
    expect(retry.status).toBe(202);
    const t2 = await waitFor(() => call(task.GET, { cookie: alice.cookie, params: { taskId: retry.json.task.id } }), done);
    expect(t2.json.task.attempt).toBe(2);
    expect(t2.json.task.parentTaskId).toBe(r.json.task.id);
  });

  it("cancels a queued task", async () => {
    const [row] = await db.insert(schema.aiTasks).values({ orgId: alice.orgId, projectId, kind: "site_edit", input: { instruction: "x" }, createdBy: alice.id }).returning();
    expect((await call(taskCancel.POST, { method: "POST", cookie: alice.cookie, params: { taskId: row.id } })).status).toBe(200);
    const t = await call(task.GET, { cookie: alice.cookie, params: { taskId: row.id } });
    expect(t.json.task.status).toBe("cancelled");
    expect((await call(taskCancel.POST, { method: "POST", cookie: alice.cookie, params: { taskId: row.id } })).status).toBe(409);
  });
});

describe("deployments and hosting", () => {
  let previewId: string;
  let prodId: string;

  it("blocks production deploys with broken links but allows previews", async () => {
    const path = `/x?path=${SITE_DOC_PATH}`;
    const cur = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path });
    const doc = JSON.parse(cur.json.content);
    const hero = doc.pages[0].sections.find((s: { type: string }) => s.type === "hero");
    hero.props.primaryHref = "/does-not-exist";
    await call(file.PUT, { method: "PUT", cookie: alice.cookie, params: { projectId }, path, body: { content: JSON.stringify(doc), baseRevision: cur.json.revision } });

    const prod = await call(deployments.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { environment: "production" } });
    expect(prod.json.deployment.status).toBe("failed");
    expect(prod.json.deployment.error).toMatch(/blocking/);

    const preview = await call(deployments.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { environment: "preview" } });
    expect(preview.json.deployment.status).toBe("ready");
    previewId = preview.json.deployment.id;

    hero.props.primaryHref = "#booking";
    const cur2 = await call(file.GET, { cookie: alice.cookie, params: { projectId }, path });
    await call(file.PUT, { method: "PUT", cookie: alice.cookie, params: { projectId }, path, body: { content: JSON.stringify(doc), baseRevision: cur2.json.revision } });
    const ok = await call(deployments.POST, { method: "POST", cookie: alice.cookie, params: { projectId }, body: { environment: "production" } });
    expect(ok.json.deployment.status).toBe("ready");
    prodId = ok.json.deployment.id;
  });

  it("serves production publicly and previews only to members", async () => {
    const pub = await call(siteServe.GET, { params: { deploymentId: prodId }, path: `/sites/${prodId}` });
    expect(pub.status).toBe(200);
    expect(pub.text).toContain("<title>");
    expect(pub.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(pub.text).not.toContain("<script");
    expect(pub.text).toContain(`href="/sites/${prodId}/about"`);

    expect((await call(siteServe.GET, { params: { deploymentId: previewId }, path: `/sites/${previewId}` })).status).toBe(404);
    expect((await call(siteServe.GET, { cookie: mallory.cookie, params: { deploymentId: previewId }, path: `/sites/${previewId}` })).status).toBe(404);
    expect((await call(siteServe.GET, { cookie: alice.cookie, params: { deploymentId: previewId }, path: `/sites/${previewId}` })).status).toBe(200);
    expect((await call(siteServe.GET, { params: { deploymentId: prodId, path: ["nope"] }, path: `/sites/${prodId}/nope` })).status).toBe(404);
  });

  it("stores form submissions from the published site", async () => {
    const body = new URLSearchParams({ name: "Riya", contact: "riya@example.com", date: "2026-11-01", time: "19:30", guests: "4", notes: "Window seat", extra: "dropped" });
    const req = new Request(`${ORIGIN}/api/v1/sites/${prodId}/forms/booking`, { method: "POST", headers: { origin: ORIGIN, referer: `${ORIGIN}/sites/${prodId}`, "content-type": "application/x-www-form-urlencoded" }, body });
    const res = await siteForm.POST(req, { params: Promise.resolve({ deploymentId: prodId, formId: "booking" }) });
    expect(res.status).toBe(303);
    const subs = await call(submissions.GET, { cookie: alice.cookie, params: { projectId } });
    expect(subs.json.submissions[0].data).toEqual({ name: "Riya", contact: "riya@example.com", date: "2026-11-01", time: "19:30", guests: "4", notes: "Window seat" });
    // Honeypot submissions are dropped silently.
    const spam = new URLSearchParams({ name: "bot", _hp: "x" });
    await siteForm.POST(new Request(`${ORIGIN}/api/v1/sites/${prodId}/forms/contact`, { method: "POST", headers: { origin: ORIGIN }, body: spam }), { params: Promise.resolve({ deploymentId: prodId, formId: "contact" }) });
    expect((await call(submissions.GET, { cookie: alice.cookie, params: { projectId } })).json.submissions).toHaveLength(1);
  });

  it("rolls production back to an earlier deployment", async () => {
    expect((await call(promote.POST, { method: "POST", cookie: alice.cookie, params: { projectId, deploymentId: previewId } })).status).toBe(200);
    const list = await call(deployments.GET, { cookie: alice.cookie, params: { projectId } });
    expect(list.json.productionDeploymentId).toBe(previewId);
  });
});
