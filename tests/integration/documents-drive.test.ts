import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/documents/[[...slug]]/route";
import * as search from "@/app/api/v1/orgs/[orgId]/search/route";
import * as dashboard from "@/app/api/v1/orgs/[orgId]/dashboard/[[...slug]]/route";
import { byLink } from "@/server/documents/drive";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// The drive: private documents until shared, team folders by their rules,
// shares (view / comment / edit), stars, the trash, live co-editing saved back
// as content with versions, comments with mentions, share links, exports and
// imports, and search that respects all of it.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
type H = Parameters<typeof call>[0];
const D = (method: string, path: string, body?: unknown, who = "owner") => call((api as unknown as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/documents/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const raw = async (path: string, who = "owner") => {
  const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/documents/${path}`, { headers: { cookie: C[who] } });
  return api.GET(req, { params: Promise.resolve({ orgId, slug: path.split("?")[0].split("/") }) });
};
const upload = async (path: string, name: string, bytes: Buffer, meta: unknown = {}, who = "owner") => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  form.set("meta", JSON.stringify(meta));
  const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/documents/${path}`, { method: "POST", headers: { cookie: C[who], origin: ORIGIN }, body: form });
  const res = await api.POST(req, { params: Promise.resolve({ orgId, slug: path.split("/") }) });
  return { status: res.status, json: await res.json() };
};
const ids_of = (r: { json: { files: { id: string }[]; folders: { id: string }[] } }) => [...r.json.folders.map((f) => f.id), ...r.json.files.map((f) => f.id)];

/** An edit from a browser: a paragraph appended to the shared document. */
async function liveAppend(fileId: string, text: string, who = "owner") {
  const o = await D("GET", `docs/${fileId}/live`, undefined, who);
  const y = new Y.Doc();
  Y.applyUpdate(y, Uint8Array.from(Buffer.from(o.json.state, "base64")));
  const before = Y.encodeStateVector(y);
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [new Y.XmlText(text)]);
  const frag = y.getXmlFragment("default");
  frag.insert(frag.length, [p]);
  const update = Y.encodeStateAsUpdate(y, before);
  return D("POST", `docs/${fileId}/live`, { kind: "doc", clientId: "test", update: Buffer.from(update).toString("base64") }, who);
}

beforeAll(async () => {
  await resetDb();
  for (const [k, name, role] of [["owner", "Asha Owner", null], ["editor", "Esha Editor", "editor"], ["viewer", "Vik Viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email: `${k}.drive@example.com`, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
    if (k === "owner") orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
    else await db.insert(schema.memberships).values({ orgId, userId: U[k]!, role: role! });
  }
});
afterAll(closeDb);

describe("my documents and team folders", () => {
  it("keeps a new document private to its owner until it's shared", async () => {
    const r = await D("POST", "docs", { templateId: "proposal", root: "mine" });
    expect(r.status).toBe(200);
    ids.proposal = r.json.file.id;
    expect(r.json.file).toMatchObject({ kind: "doc", access: "private", title: "Proposal", role: "edit" });
    expect(ids_of(await D("GET", "drive?section=mine"))).toContain(ids.proposal);
    expect((await D("GET", `docs/${ids.proposal}`, undefined, "editor")).status).toBe(404);
    expect(ids_of(await D("GET", "drive?section=mine", undefined, "editor"))).not.toContain(ids.proposal);
    // Owners and admins don't see someone's private documents either.
    const e = await D("POST", "docs", { title: "Esha's plan", root: "mine" }, "editor");
    expect((await D("GET", `docs/${e.json.file.id}`)).status).toBe(404);
  });

  it("opens a team folder to the team, and a viewer can read but not change what's in it", async () => {
    ids.folder = (await D("POST", "folder", { name: "Clients", root: "team", color: "violet" })).json.folder.id;
    const doc = await D("POST", "docs", { title: "Client list", folderId: ids.folder });
    ids.teamDoc = doc.json.file.id;
    expect(doc.json.file.access).toBe("inherit");
    expect((await D("GET", `docs/${ids.teamDoc}`, undefined, "viewer")).json.role).toBe("view");
    expect((await D("GET", `docs/${ids.teamDoc}`, undefined, "editor")).json.role).toBe("edit");
    expect((await D("PATCH", `files/${ids.teamDoc}`, { title: "Renamed" }, "viewer")).status).toBe(403);
    expect((await liveAppend(ids.teamDoc, "nope", "viewer")).status).toBe(403);
    // A viewer can't add to a team folder; they can still keep their own documents.
    expect((await D("POST", "docs", { title: "x", folderId: ids.folder }, "viewer")).status).toBe(403);
    expect((await D("POST", "docs", { title: "Mine", root: "mine" }, "viewer")).status).toBe(200);
  });

  it("makes a folder private to whoever made it", async () => {
    const f = await D("POST", "folder", { name: "Private stuff", root: "mine" }, "editor");
    expect(f.json.folder.access).toBe("private");
    await D("POST", "docs", { title: "Inside", folderId: f.json.folder.id }, "editor");
    expect((await D("GET", `drive?section=folder&folderId=${f.json.folder.id}`)).status).toBe(404);
    expect((await D("GET", "tree")).json.folders.map((x: { id: string }) => x.id)).not.toContain(f.json.folder.id);
  });

  it("moves, copies and stars", async () => {
    const m = await D("POST", "move", { files: [ids.proposal], folderId: ids.folder });
    expect(m.status).toBe(200);
    expect((await D("GET", `docs/${ids.proposal}`, undefined, "viewer")).json.role).toBe("view");
    await D("POST", "move", { files: [ids.proposal], folderId: null, root: "mine" });
    expect((await D("GET", `docs/${ids.proposal}`, undefined, "viewer")).status).toBe(404);
    const c = await D("POST", `files/${ids.proposal}/copy`, {});
    expect(c.json.file.title).toBe("Copy of Proposal");
    expect(c.json.file.snippet).toContain("Proposal for");
    await D("POST", "star", { id: ids.proposal, kind: "file", on: true });
    expect((await D("GET", "drive?section=starred")).json.files.map((f: { id: string }) => f.id)).toEqual([ids.proposal]);
    // A folder can't go inside itself.
    const sub = await D("POST", "folder", { name: "Sub", folderId: ids.folder });
    expect((await D("POST", "move", { folders: [ids.folder], folderId: sub.json.folder.id })).status).toBe(422);
  });
});

describe("sharing", () => {
  it("shares with chosen people, who are told, and a share can be view, comment or edit", async () => {
    const r = await D("PUT", "shares", { fileId: ids.proposal, people: [{ userId: U.viewer, role: "comment" }, { userId: U.editor, role: "view" }] });
    expect(r.status).toBe(200);
    expect((await D("GET", `docs/${ids.proposal}`, undefined, "viewer")).json.role).toBe("comment");
    expect((await D("GET", `docs/${ids.proposal}`, undefined, "editor")).json.role).toBe("view");
    expect(ids_of(await D("GET", "drive?section=shared", undefined, "viewer"))).toContain(ids.proposal);
    const told = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, U.viewer!));
    expect(told.some((n) => n.kind === "documents.shared" && n.title.includes("Proposal"))).toBe(true);
    // Only people who can edit it can share it.
    expect((await D("PUT", "shares", { fileId: ids.proposal, people: [] }, "viewer")).status).toBe(403);
  });

  it("turns a read-only link on and off", async () => {
    const on = await D("PUT", `files/${ids.proposal}/link`, { on: true });
    const token = on.json.link.url.split("/read/")[1];
    expect((await byLink(token))?.id).toBe(ids.proposal);
    expect(await byLink(`${token.slice(0, -2)}xx`)).toBeNull();
    // The same link again, not a new one.
    expect((await D("PUT", `files/${ids.proposal}/link`, { on: true })).json.link.url).toBe(on.json.link.url);
    await D("PUT", `files/${ids.proposal}/link`, { on: false });
    expect(await byLink(token)).toBeNull();
  });
});

describe("writing together", () => {
  it("saves live edits back as the document's content, and keeps a version", async () => {
    expect((await liveAppend(ids.proposal, "Agreed scope: three phases")).status).toBe(200);
    const s = await D("POST", `docs/${ids.proposal}/save`, { name: "Sent to client" });
    expect(s.json.saved).toBe(true);
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, ids.proposal!));
    expect(f!.bodyText).toContain("Agreed scope: three phases");
    expect(f!.words).toBeGreaterThan(20);
    const v = await D("GET", `docs/${ids.proposal}/versions`);
    expect(v.json.versions[0]).toMatchObject({ note: "Sent to client" });
    ids.version = String(v.json.versions[0].version);
  });

  it("restores a version, keeping today's text as a version too", async () => {
    await liveAppend(ids.proposal, "A late change");
    await D("POST", `docs/${ids.proposal}/save`, {});
    const r = await D("POST", `docs/${ids.proposal}/restore`, { version: Number(ids.version) });
    expect(r.status).toBe(200);
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, ids.proposal!));
    expect(f!.bodyText).not.toContain("A late change");
    const v = await D("GET", `docs/${ids.proposal}/versions`);
    expect(v.json.versions.some((x: { note: string }) => x.note.startsWith("Before restoring"))).toBe(true);
    // The live copy starts again from the restored content.
    const live = await D("GET", `docs/${ids.proposal}/live`);
    const y = new Y.Doc();
    Y.applyUpdate(y, Uint8Array.from(Buffer.from(live.json.state, "base64")));
    expect(y.getXmlFragment("default").toString()).not.toContain("A late change");
  });

  it("lets commenters comment, mentions tell people, and threads resolve", async () => {
    const t = await D("POST", `docs/${ids.proposal}/comments`, { body: "Can @Esha Editor check the price?", quote: "Investment", mentions: [U.editor] }, "viewer");
    expect(t.status).toBe(200);
    expect((await D("POST", `docs/${ids.proposal}/comments`, { body: "Hi" }, "editor")).status).toBe(403);
    const told = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, U.editor!));
    expect(told.some((n) => n.kind === "documents.mention")).toBe(true);
    const owner = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, U.owner!));
    expect(owner.some((n) => n.kind === "documents.comment")).toBe(true);
    await D("POST", `docs/${ids.proposal}/comments`, { body: "Done", parentId: t.json.comment.id });
    expect((await D("POST", `docs/${ids.proposal}/comments/${t.json.comment.id}/resolve`, { resolved: true }, "viewer")).status).toBe(200);
    const list = await D("GET", `docs/${ids.proposal}/comments`);
    expect(list.json.threads[0]).toMatchObject({ resolved: true, quote: "Investment" });
    expect(list.json.threads[0].replies).toHaveLength(1);
    // Only its author changes a comment.
    expect((await D("PATCH", `docs/${ids.proposal}/comments/${t.json.comment.id}`, { body: "x" })).status).toBe(403);
  });
});

describe("in and out", () => {
  it("downloads a document as PDF, Word, Markdown, HTML and text", async () => {
    const pdf = await raw(`docs/${ids.proposal}/export?format=pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    const docx = await raw(`docs/${ids.proposal}/export?format=docx`);
    expect(Buffer.from(await docx.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
    expect(await (await raw(`docs/${ids.proposal}/export?format=md`)).text()).toContain("# Proposal for");
    expect(await (await raw(`docs/${ids.proposal}/export?format=html`)).text()).toContain("<h1");
    expect(await (await raw(`docs/${ids.proposal}/export?format=txt`)).text()).toContain("Scope of work");
  });

  it("imports Markdown as an editable document and makes a PDF copy to sign", async () => {
    const r = await upload("docs/import", "Plan.md", Buffer.from("# Launch plan\n\n- Book venue\n- [ ] Send invites\n\n| A | B |\n|---|---|\n| 1 | 2 |\n"), { root: "mine" });
    expect(r.status).toBe(200);
    expect(r.json.file).toMatchObject({ kind: "doc", title: "Plan" });
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, r.json.file.id));
    expect(f!.bodyText).toContain("Book venue");
    const p = await D("POST", `docs/${r.json.file.id}/pdf`, {});
    const [pf] = await db.select().from(schema.docVersions).where(eq(schema.docVersions.fileId, p.json.fileId));
    expect(pf!.mime).toBe("application/pdf");
  });

  it("stores images for a document and serves them only to people who can open it", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const a = await upload(`docs/${ids.proposal}/assets`, "x.png", png);
    expect(a.status).toBe(200);
    const id = a.json.id;
    expect((await raw(`assets/${id}`)).status).toBe(200);
    expect((await raw(`assets/${id}`, "viewer")).status).toBe(200);
    await D("PUT", "shares", { fileId: ids.proposal, people: [] });
    expect((await raw(`assets/${id}`, "viewer")).status).toBe(404);
    expect((await upload(`docs/${ids.proposal}/assets`, "x.png", Buffer.from("not an image"))).status).toBe(422);
  });
});

describe("trash and search", () => {
  it("finds words inside documents, only for people who can open them", async () => {
    const S = (who: string) => call(search.GET, { cookie: C[who], path: `/api/v1/orgs/${orgId}/search?q=${encodeURIComponent("three phases")}`, params: { orgId } });
    expect((await S("owner")).json.results.some((h: { kind: string; id: string }) => h.kind === "documents" && h.id === ids.proposal)).toBe(true);
    expect((await S("viewer")).json.results.some((h: { id: string }) => h.id === ids.proposal)).toBe(false);
  });

  it("shows recent documents on Home, and what was shared this week", async () => {
    const desk = (who: string) => call((dashboard as unknown as Record<string, H>).GET, { cookie: C[who], path: `/api/v1/orgs/${orgId}/dashboard/desk`, params: { orgId, slug: ["desk"] } });
    expect((await desk("owner")).json.documents.items.map((f: { id: string }) => f.id)).toContain(ids.proposal);
    await D("PUT", "shares", { fileId: ids.proposal, people: [{ userId: U.viewer, role: "view" }] });
    const v = (await desk("viewer")).json.documents;
    expect(v.shared).toBe(1);
  });

  it("trashes a folder with what's in it, restores it, and deletes for good", async () => {
    await D("POST", "trash", { folders: [ids.folder] });
    expect((await D("GET", `docs/${ids.teamDoc}`)).status).toBe(404);
    expect(ids_of(await D("GET", "drive?section=trash"))).toContain(ids.folder);
    expect((await D("POST", "trash", { folders: [ids.folder] }, "viewer")).status).toBe(404);
    await D("POST", "restore", { folders: [ids.folder] });
    expect((await D("GET", `docs/${ids.teamDoc}`)).status).toBe(200);
    await D("POST", "trash", { files: [ids.teamDoc] });
    expect((await D("POST", "purge", { files: [ids.proposal] })).status).toBe(409);
    expect((await D("POST", "purge", { files: [ids.teamDoc] })).status).toBe(200);
    expect(await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, ids.teamDoc!))).toHaveLength(0);
  });
});
