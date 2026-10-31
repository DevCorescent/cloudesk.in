import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as files from "@/app/api/v1/projects/[projectId]/files/route";
import * as terminal from "@/app/api/v1/projects/[projectId]/terminal/route";
import { dockerArgs, setDockerSpawn } from "@/server/exec/docker";
import { tokenize } from "@/server/exec/shell";
import { call, cookieFrom, resetDb } from "../helpers";

let cookie = "";
let viewer = "";
let projectId = "";
const sh = (command: string, c = cookie) => call(terminal.POST, { method: "POST", cookie: c, params: { projectId }, body: { command } });
const out = (r: { json: { output: { text: string }[] } }) => r.json.output.map((l) => l.text).join("\n");

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Tess Term", email: "tess@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "cafe", name: "Ember & Oat" } })).json.project.id;
  viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vic View", email: "vic@example.com", password: "correct-horse-42" } }));
  const [v] = await db.select().from(schema.users).where(eq(schema.users.email, "vic@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: v.id, role: "viewer" });
  await call(files.POST, { method: "POST", cookie, params: { projectId }, body: { path: "scripts/pages.js", content: `const doc = project.readJson("site/site.json");\nconst rows = doc.pages.map((p) => p.path + " " + p.title);\nconsole.log(rows.join("\\n"));\nproject.write("content/pages.md", "# Pages\\n\\n" + rows.map((r) => "- " + r).join("\\n") + "\\n");\nconsole.warn("args:", args.join(","));` } });
  await call(files.POST, { method: "POST", cookie, params: { projectId }, body: { path: "scripts/report.py", content: "print('hi')\n" } });
});
afterAll(async () => {
  setDockerSpawn(null);
  delete process.env.EXEC_DOCKER;
  await closeDb();
});

describe("terminal", () => {
  it("tokenizes like a shell", () => {
    expect(tokenize(`js "a b" 'c "d"' e\\ f ""`)).toEqual(["js", "a b", 'c "d"', "e f", ""]);
    expect(() => tokenize(`cat "x`)).toThrow(/Unclosed/);
  });

  it("lists, prints, searches and validates project files", async () => {
    expect(out(await sh("ls"))).toBe("scripts/\nsite/\nREADME.md");
    expect(out(await sh("ls scripts"))).toBe("pages.js\nreport.py");
    expect(out(await sh("cat scripts/report.py"))).toBe("print('hi')");
    const g = await sh(`grep "project.write" scripts`);
    expect(out(g)).toMatch(/^scripts\/pages\.js:4: project\.write/);
    expect((await sh("grep zzzz-none")).json.exitCode).toBe(1);
    expect(out(await sh("validate"))).toMatch(/^✓ site\/site\.json is valid · \d+ pages$/);
    expect(out(await sh("wc scripts/report.py"))).toBe("1 lines  1 words  12 bytes  scripts/report.py");
    const nf = await sh("rm -rf /");
    expect(nf.json).toMatchObject({ exitCode: 127 });
    expect(out(nf)).toContain("command not found");
    expect((await sh("cat ../../etc/passwd")).status).toBe(422);
  });

  it("runs scripts in the sandbox and saves their writes as revisions", async () => {
    const r = await sh("run scripts/pages.js --dry 2");
    expect(r.json).toMatchObject({ exitCode: 0, runtime: "quickjs", changed: ["content/pages.md"] });
    expect(r.json.output[0].text).toMatch(/^\/ \S/);
    expect(r.json.output).toContainEqual({ stream: "err", text: "args: --dry,2" });
    const [f] = await db.select().from(schema.projectFiles).where(and(eq(schema.projectFiles.projectId, projectId), eq(schema.projectFiles.path, "content/pages.md")));
    expect(f.content).toMatch(/^# Pages\n\n- \/ \S/);
    const [rev] = await db.select().from(schema.fileRevisions).where(and(eq(schema.fileRevisions.projectId, projectId), eq(schema.fileRevisions.path, "content/pages.md")));
    expect(rev.message).toBe("Script: scripts/pages.js");
    // Same output again: nothing to save.
    expect((await sh("run scripts/pages.js")).json.changed).toEqual([]);
  });

  it("evaluates expressions, and rejects invalid site edits from scripts", async () => {
    expect(out(await sh(`js project.files("scripts/").length * 10`))).toBe("20");
    const bad = await sh(`js project.write("site/site.json", "{}")`);
    expect(bad.json.exitCode).toBe(1);
    expect(out(bad)).toMatch(/^write site\/site\.json: The site document is invalid/);
    const loop = await sh("js while(true){}");
    expect(out(loop)).toBe("Stopped: the script ran longer than its time limit");
  });

  it("lets viewers read but not run code", async () => {
    expect((await sh("ls", viewer)).json.exitCode).toBe(0);
    expect(out(await sh("run scripts/pages.js", viewer))).toBe("Running code needs code edit access on this project");
    expect(out(await sh("js 1+1", viewer))).toBe("Running code needs code edit access on this project");
  });

  it("explains how to enable containers, and runs them locked down when enabled", async () => {
    expect(out(await sh("python scripts/report.py"))).toMatch(/isn't enabled on this server/);
    const args = dockerArgs("python", "/tmp/w", "scripts/report.py", ["a"], "n1");
    for (const flag of ["--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--user 65534:65534", "--pids-limit 64", "--memory 256m", "-v /tmp/w:/work:ro"]) expect(args.join(" ")).toContain(flag);
    expect(args.slice(-4)).toEqual(["python3", "-I", "scripts/report.py", "a"]);

    // A fake docker CLI: this checks our wiring, not Docker itself.
    process.env.EXEC_DOCKER = "on";
    const calls: string[][] = [];
    setDockerSpawn((_cmd, a) => {
      calls.push(a);
      const p = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {} });
      setTimeout(() => {
        if (a[0] === "run") p.stdout.write("hi\nthere\n");
        p.stdout.end();
        p.stderr.end();
        p.emit("close", 0);
      }, 5);
      return p;
    });
    const r = await sh("python scripts/report.py");
    expect(r.json).toMatchObject({ exitCode: 0, runtime: "docker" });
    expect(out(r)).toBe("hi\nthere");
    expect(calls.map((c) => c[0])).toEqual(["version", "run"]);
  });

  it("keeps a per-user history", async () => {
    const h = await call(terminal.GET, { cookie, params: { projectId } });
    expect(h.json.runs[0]).toMatchObject({ command: "python scripts/report.py", runtime: "docker", exitCode: 0 });
    expect(h.json.runs.some((r: { command: string }) => r.command === "ls")).toBe(true);
    expect((await call(terminal.GET, { cookie: viewer, params: { projectId } })).json.runs.every((r: { command: string }) => !r.command.startsWith("python"))).toBe(true);
  });
});
