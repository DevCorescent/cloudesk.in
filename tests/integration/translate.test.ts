import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";

// The model is replaced by a stand-in that "translates" by prefixing text,
// so the real task runner, validation, diff and apply steps all run.
vi.mock("@/server/ai/gateway", () => ({
  hasLlm: async () => true,
  complete: async (req: { messages: { content: string }[] }) => {
    const json = /<texts>\n([\s\S]*)\n<\/texts>/.exec(req.messages.at(-1)!.content)![1];
    const texts = JSON.parse(json) as Record<string, string>;
    return { text: JSON.stringify(Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, `[hi] ${v}`]))), provider: "anthropic", model: "test-model", inputTokens: 100, outputTokens: 100, costMicroUsd: 10 };
  },
}));

const { call, cookieFrom, resetDb, waitFor } = await import("../helpers");
const me = await import("@/app/api/v1/auth/me/route");
const signup = await import("@/app/api/v1/auth/signup/route");
const orgProjects = await import("@/app/api/v1/orgs/[orgId]/projects/route");
const file = await import("@/app/api/v1/projects/[projectId]/file/route");
const tasks = await import("@/app/api/v1/projects/[projectId]/ai/tasks/route");
const task = await import("@/app/api/v1/ai/tasks/[taskId]/route");
const apply = await import("@/app/api/v1/ai/tasks/[taskId]/apply/route");

let cookie = "";
let projectId = "";

beforeAll(async () => {
  await resetDb();
  const r = await call(signup.POST, { method: "POST", body: { name: "T", email: "t@example.com", password: "correct-horse-42" } });
  cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: m.json.organizations[0].id }, body: { templateId: "cafe", name: "Brew" } })).json.project.id;
  // Add a Hindi copy of the home page, as the Pages panel does.
  const f = await call(file.GET, { cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
  const doc = JSON.parse(f.json.content);
  const home = structuredClone(doc.pages[0]);
  doc.pages.push({ ...home, id: "p_hi", path: "/hi", lang: "hi", translationOf: home.id, needsTranslation: true, sections: home.sections.map((x: { id: string }) => ({ ...x, id: `${x.id}_hi` })) });
  const put = await call(file.PUT, { method: "PUT", cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}`, body: { content: JSON.stringify(doc, null, 2), baseRevision: f.json.revision } });
  if (put.status !== 200) throw new Error(JSON.stringify(put.json));
});

afterAll(async () => {
  await closeDb();
});

describe("AI translation task", () => {
  it("translates only the text of the target language and applies after review", async () => {
    const start = await call(tasks.POST, { method: "POST", cookie, params: { projectId }, body: { kind: "translate", input: { lang: "hi" } } });
    expect(start.status).toBe(202);
    const done = await waitFor(() => call(task.GET, { cookie, params: { taskId: start.json.task.id } }), (r) => !["queued", "running"].includes(r.json.task.status));
    expect(done.json.task.error ?? done.json.task.status).toBe("awaiting_review");
    const after = JSON.parse(done.json.task.result.changes[0].after);
    const hi = after.pages.find((p: { id: string }) => p.id === "p_hi");
    expect(hi.needsTranslation).toBeUndefined();
    expect(hi.sections.find((s: { type: string }) => s.type === "hero").props.heading).toMatch(/^\[hi\] /);
    const before = JSON.parse(done.json.task.result.changes[0].before);
    expect(after.pages[0]).toEqual(before.pages[0]);
    expect((await call(apply.POST, { method: "POST", cookie, params: { taskId: start.json.task.id } })).status).toBe(200);
    const saved = JSON.parse((await call(file.GET, { cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` })).json.content);
    expect(saved.pages.find((p: { id: string }) => p.id === "p_hi").title).toMatch(/^\[hi\] /);
  });

  it("refuses a language with no pages", async () => {
    const start = await call(tasks.POST, { method: "POST", cookie, params: { projectId }, body: { kind: "translate", input: { lang: "fr" } } });
    const done = await waitFor(() => call(task.GET, { cookie, params: { taskId: start.json.task.id } }), (r) => !["queued", "running"].includes(r.json.task.status));
    expect(done.json.task.status).toBe("failed");
    expect(done.json.task.error).toContain("no pages");
  });
});
