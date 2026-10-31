import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as codoc from "@/app/api/v1/projects/[projectId]/codoc/[[...slug]]/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import * as files from "@/app/api/v1/projects/[projectId]/files/route";
import { closeCodocBus } from "@/server/services/codoc-bus";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let ana = "";
let bo = "";
let vi = "";
let projectId = "";
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const C = (method: string, slug: string[], c: string, body?: unknown, query = "") => call(codoc[method as "GET"], { method, cookie: c, body, path: `/api/v1/projects/${projectId}/codoc/${slug.join("/")}${query}`, params: { projectId, slug } });

/** A minimal client: a Y.Doc that pushes local updates and pulls remote ones. */
async function client(cookie: string, name: string) {
  const o = await C("GET", [], cookie, undefined, "?path=content/notes.md");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(o.json.state, "base64")), "remote");
  const pending: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && pending.push(u));
  let seq = o.json.seq as number;
  return {
    doc,
    text: doc.getText("content"),
    open: o.json,
    async push() {
      for (const u of pending.splice(0)) expect((await C("POST", [o.json.docId], cookie, { kind: "doc", clientId: name, update: b64(u) })).status).toBe(200);
    },
    /** Reads the SSE stream until `n` events (or the stream ends). */
    async pull(n = 50) {
      const res = await codoc.GET(new Request(`${ORIGIN}/api/v1/projects/${projectId}/codoc/${o.json.docId}/stream?since=${seq}`, { headers: { cookie } }), { params: Promise.resolve({ projectId, slug: [o.json.docId, "stream"] }) });
      const reader = res.body!.getReader();
      const events: { event: string; data: { seq: number; update?: string; kind?: string; revision?: number } }[] = [];
      let buf = "";
      const deadline = Date.now() + 4000;
      while (events.length < n && Date.now() < deadline) {
        const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), 400))]);
        if (r.done) break;
        buf += new TextDecoder().decode(r.value);
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (\w+)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
      await reader.cancel();
      for (const e of events) {
        if (e.data.seq) seq = e.data.seq;
        if (e.event === "u" && e.data.kind === "doc") Y.applyUpdate(doc, new Uint8Array(Buffer.from(e.data.update!, "base64")), "remote");
      }
      return events;
    },
  };
}

beforeAll(async () => {
  await resetDb();
  ana = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Ana", email: "ana@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie: ana })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie: ana, params: { orgId }, body: { templateId: "blank", name: "Notes" } })).json.project.id;
  for (const [email, role] of [["bo@example.com", "developer"], ["vi@example.com", "viewer"]] as const) {
    const c = cookieFrom(await call(signup.POST, { method: "POST", body: { name: email.slice(0, 2), email, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
    if (role === "developer") bo = c;
    else vi = c;
  }
  await call(files.POST, { method: "POST", cookie: ana, params: { projectId }, body: { path: "content/notes.md", content: "Hello world\n" } });
});
afterAll(async () => {
  await closeCodocBus();
  await closeDb();
});

describe("co-editing", () => {
  it("merges concurrent character edits from two editors", async () => {
    const a = await client(ana, "a");
    const b = await client(bo, "b");
    expect(a.open.docId).toBe(b.open.docId);
    expect(a.text.toString()).toBe("Hello world\n");
    // Both type at the same time, without seeing each other's change first.
    a.text.insert(5, ",");
    b.text.insert(11, "!");
    b.text.insert(0, "# ");
    await Promise.all([a.push(), b.push()]);
    await Promise.all([a.pull(3), b.pull(3)]);
    expect(a.text.toString()).toBe("# Hello, world!\n");
    expect(b.text.toString()).toBe(a.text.toString());
    // A third editor joining later gets the merged state in one go.
    const c = await client(ana, "c");
    expect(c.text.toString()).toBe("# Hello, world!\n");
  });

  it("relays cursors as awareness messages", async () => {
    const a = await client(ana, "a");
    const b = await client(bo, "b");
    await C("POST", [a.open.docId], ana, { kind: "awareness", clientId: "a", update: b64(new Uint8Array([1, 2, 3])) });
    const ev = await b.pull(1);
    expect(ev[0]).toMatchObject({ event: "u", data: { kind: "awareness", update: "AQID" } });
  });

  it("saves the shared text as a revision and tells other editors", async () => {
    const a = await client(ana, "a");
    const b = await client(bo, "b");
    const s = await C("POST", [a.open.docId, "save"], bo);
    expect(s.json).toMatchObject({ content: "# Hello, world!\n" });
    const rev = s.json.revision;
    const f = await call(file.GET, { cookie: ana, path: `/api/v1/projects/${projectId}/file?path=content/notes.md`, params: { projectId } });
    expect(f.json).toMatchObject({ content: "# Hello, world!\n", revision: rev });
    const ev = await a.pull(5);
    expect(ev.find((e) => e.event === "saved")?.data.revision).toBe(rev);
    // Still the same shared document after saving.
    a.text.insert(a.text.length, "More\n");
    await a.push();
    await b.pull(2);
    expect(b.text.toString()).toBe("# Hello, world!\nMore\n");
  });

  it("resets when the file is changed elsewhere", async () => {
    const a = await client(ana, "a");
    const f = await call(file.GET, { cookie: ana, path: `/api/v1/projects/${projectId}/file?path=content/notes.md`, params: { projectId } });
    await call(file.PUT, { method: "PUT", cookie: ana, path: `/api/v1/projects/${projectId}/file?path=content/notes.md`, params: { projectId }, body: { content: "Rewritten by the AI\n", baseRevision: f.json.revision } });
    expect((await a.pull(5)).at(-1)?.event).toBe("reset");
    expect((await C("POST", [a.open.docId, "save"], ana)).status).toBe(404);
    const fresh = await client(ana, "a2");
    expect(fresh.text.toString()).toBe("Rewritten by the AI\n");
  });

  it("doesn't leak another project's document", async () => {
    const a = await client(ana, "a");
    const outsider = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Oz", email: "oz@example.com", password: "correct-horse-42" } }));
    const theirOrg = (await call(me.GET, { cookie: outsider })).json.organizations[0].id;
    const theirs = (await call(orgProjects.POST, { method: "POST", cookie: outsider, params: { orgId: theirOrg }, body: { templateId: "blank", name: "Theirs" } })).json.project.id;
    const res = await codoc.GET(new Request(`${ORIGIN}/api/v1/projects/${theirs}/codoc/${a.open.docId}/stream?since=0`, { headers: { cookie: outsider } }), { params: Promise.resolve({ projectId: theirs, slug: [a.open.docId, "stream"] }) });
    const body = await res.text();
    expect(body).toContain("event: reset");
    expect(body).not.toContain("event: u");
    expect((await call(codoc.POST, { method: "POST", cookie: outsider, body: { kind: "doc", clientId: "o", update: "AA==" }, params: { projectId: theirs, slug: [a.open.docId] } })).status).toBe(404);
  });

  it("lets viewers watch but not type, and rejects garbage", async () => {
    const v = await client(vi, "v");
    expect(v.open.canWrite).toBe(false);
    v.text.insert(0, "x");
    const u = Y.encodeStateAsUpdate(v.doc);
    expect((await C("POST", [v.open.docId], vi, { kind: "doc", clientId: "v", update: b64(u) })).status).toBe(403);
    expect((await C("POST", [v.open.docId], vi, { kind: "awareness", clientId: "v", update: b64(new Uint8Array([1])) })).status).toBe(200);
    expect((await C("POST", [v.open.docId], ana, { kind: "doc", clientId: "a", update: b64(new Uint8Array([255, 255, 255, 1, 2])) })).status).toBe(422);
  });
});
