import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as notesApi from "@/app/api/v1/orgs/[orgId]/notes/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { notesTick, publicNote } from "@/server/notes/core";
import { block } from "@/lib/notes/blocks";
import { call, cookieFrom, resetDb } from "../helpers";

const C: Record<string, string> = {};
const U: Record<string, string> = {};
let org = "";
let other = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
type H = Parameters<typeof call>[0];
const N = (method: string, path: string, body?: unknown, who = "asha", orgId = org) => call((notesApi as unknown as Record<string, H>)[method]!, { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/notes/${path}`, params: { orgId, slug: seg(path) } });
const doc = (...blocks: ReturnType<typeof block>[]) => ({ blocks });
const ai = (json: unknown) => setAnthropicClientFactory(() => ({ beta: { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10 } }) }) } } }) as never);

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["asha", "Asha Rao", "asha@kiln.in"], ["ravi", "Ravi Kumar", "ravi@kiln.in"], ["out", "Outsider", "x@elsewhere.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  org = (await call(me.GET, { cookie: C.asha })).json.organizations[0].id;
  other = (await call(me.GET, { cookie: C.out })).json.organizations[0].id;
  await db.insert(schema.memberships).values({ orgId: org, userId: U.ravi!, role: "viewer" });
});
afterEach(() => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
});
afterAll(closeDb);

describe("notes", () => {
  let first = "";
  let folder = "";

  it("are made in folders, searched, tagged and counted", async () => {
    folder = (await N("POST", "folders", { name: "Clients", color: "green" })).json.folder.id;
    const sub = (await N("POST", "folders", { name: "Kiran Textiles", parentId: folder })).json.folder.id;
    const r = await N("POST", "", { title: "Kiran call", folderId: sub, tags: ["Sales"], content: doc(block("h2", "Needs"), block("bullet", "Delivery by **March**"), block("todo", "Send quote"), block("calc", "total = 1200 * 3")) });
    expect(r.status, r.text).toBe(200);
    first = r.json.note.id;
    expect(r.json.note).toMatchObject({ title: "Kiran call", tags: ["sales"], access: "owner", canEdit: true, words: expect.any(Number) });
    await N("POST", "", { title: "Groceries", content: doc(block("todo", "Milk")) });
    // A folder shows what's inside it, its sub-folders included.
    expect((await N("GET", `?folder=${folder}`)).json.notes.map((x: { title: string }) => x.title)).toEqual(["Kiran call"]);
    expect((await N("GET", "?q=march")).json.notes.map((x: { title: string }) => x.title)).toEqual(["Kiran call"]);
    expect((await N("GET", "?tag=sales")).json.notes).toHaveLength(1);
    const ov = (await N("GET", "overview")).json;
    expect(ov.counts).toMatchObject({ all: 2, mine: 2, shared: 0 });
    expect(ov.folders.find((f: { id: string }) => f.id === sub)).toMatchObject({ parentId: folder, count: 1 });
    expect(ov.tags).toContainEqual({ tag: "sales", n: 1 });
    // A folder can't go inside itself.
    expect((await N("PATCH", `folders/${folder}`, { parentId: sub })).status).toBe(422);
  });

  it("are private until shared, and sharing says who may change them", async () => {
    expect((await N("GET", first, undefined, "ravi")).status).toBe(404);
    expect((await N("GET", first, undefined, "out", other)).status).toBe(404);
    // Someone from another workspace: this workspace doesn't exist to them.
    expect((await N("GET", `${first}`, undefined, "out")).status).toBe(404);
    await N("PATCH", first, { visibility: "view" });
    const seen = await N("GET", first, undefined, "ravi");
    expect(seen.json.note).toMatchObject({ access: "view", canEdit: false, shares: [] });
    expect((await N("PATCH", first, { title: "Hacked" }, "ravi")).status).toBe(403);
    expect((await N("GET", "?view=shared", undefined, "ravi")).json.notes.map((x: { title: string }) => x.title)).toEqual(["Kiran call"]);
    await N("PATCH", first, { visibility: "private" });
    expect((await N("PUT", `${first}/shares`, { shares: [{ userId: U.out, role: "edit" }] })).status).toBe(422);
    const shared = await N("PUT", `${first}/shares`, { shares: [{ userId: U.ravi, role: "edit" }] });
    expect(shared.json.note.shares).toMatchObject([{ userId: U.ravi, role: "edit", name: "Ravi Kumar" }]);
    const [note] = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.ravi!), eq(schema.notifications.kind, "notes.shared")));
    expect(note).toMatchObject({ link: `/notes/${first}` });
    const edit = await N("PATCH", first, { title: "Kiran Textiles call", baseVersion: seen.json.note.version }, "ravi");
    expect(edit.json.note).toMatchObject({ title: "Kiran Textiles call", access: "edit" });
    // Only the owner can file, pin, lock or delete it.
    expect((await N("PATCH", first, { pinned: true }, "ravi")).status).toBe(403);
    expect((await N("DELETE", first, undefined, "ravi")).status).toBe(403);
  });

  it("won't overwrite someone else's save, and keeps earlier versions", async () => {
    const cur = (await N("GET", first)).json.note;
    const stale = await N("PATCH", first, { title: "Mine", baseVersion: cur.version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.message).toMatch(/Ravi Kumar changed this note/);
    const v = (await N("GET", `${first}/versions`)).json.versions;
    expect(v.length).toBeGreaterThan(0);
    const back = await N("POST", `${first}/versions/${v.at(-1).id}/restore`);
    expect(back.json.note.title).toBe("Kiran call");
  });

  it("links to each other with [[Title]] and shows the backlinks", async () => {
    const r = await N("POST", "", { title: "Q1 plan", content: doc(block("p", "Start with [[Kiran call]] and [[Nobody]]")) });
    expect(r.json.note.links).toMatchObject([{ id: first, title: "Kiran call" }]);
    expect((await N("GET", first)).json.note.backlinks).toMatchObject([{ id: r.json.note.id, title: "Q1 plan" }]);
  });

  it("locks, and lock means read-only until unlocked", async () => {
    await N("PATCH", first, { locked: true });
    expect((await N("GET", first)).json.note.canEdit).toBe(false);
    expect((await N("PATCH", first, { content: doc(block("p", "x")) })).status).toBe(409);
    await N("PATCH", first, { locked: false });
    expect((await N("PATCH", first, { content: doc(block("p", "x")) })).status).toBe(200);
  });

  it("writes your meetings and tasks into the daily note, once a day", async () => {
    const [cal] = await db.insert(schema.calCalendars).values({ orgId: org, ownerId: U.asha!, name: "Work" }).returning();
    await db.insert(schema.calEvents).values({ orgId: org, ownerId: U.asha!, calendarId: cal!.id, uid: "e1", title: "Standup", startsAt: new Date("2026-11-02T04:30:00Z"), endsAt: new Date("2026-11-02T05:00:00Z") });
    const [p] = await db.insert(schema.workProjects).values({ orgId: org, code: "P-1", name: "Website" } as never).returning();
    await db.insert(schema.workTasks).values({ orgId: org, projectId: p!.id, number: 1, title: "Publish pricing page", assigneeId: U.asha!, dueDate: "2026-11-01" });
    const d = await N("GET", "daily/2026-11-02");
    expect(d.status, d.text).toBe(200);
    expect(d.json.note).toMatchObject({ kind: "daily", day: "2026-11-02", tags: ["daily"] });
    const texts = d.json.note.content.blocks.map((b: { text: string }) => b.text);
    expect(texts).toContain("10:00 — [Standup](/calendar)");
    expect(texts.some((t: string) => t.includes("Publish pricing page") && t.includes("was due 2026-11-01"))).toBe(true);
    expect((await N("GET", "daily/2026-11-02")).json.note.id).toBe(d.json.note.id);
    expect((await N("GET", "daily/days?month=2026-11")).json.days).toEqual(["2026-11-02"]);
  });

  it("saved from a module's page go to that module's folder and show on the page", async () => {
    const r = await N("POST", "", { title: "Payment promised", attached: { module: "invoicing", href: "/finance/x/invoices/123", label: "INV-0042" } });
    const ov = (await N("GET", "overview")).json;
    const f = ov.folders.find((x: { module: string | null }) => x.module === "invoicing");
    expect(f).toMatchObject({ name: "Invoicing", count: 1 });
    expect(r.json.note.folderId).toBe(f.id);
    expect((await N("GET", `?view=page&href=${encodeURIComponent("/finance/x/invoices/123")}`)).json.notes.map((x: { id: string }) => x.id)).toEqual([r.json.note.id]);
    // Only in-app pages.
    expect((await N("POST", "", { attached: { module: "x", href: "https://evil.example", label: "x" } })).status).toBe(422);
  });

  it("publishes read-only by link, and unpublishing breaks it", async () => {
    const r = await N("POST", `${first}/publish`);
    const token = r.json.note.publicToken;
    expect(token).toMatch(/^[\w-]{24}$/);
    expect(await publicNote(token)).toMatchObject({ title: "Kiran call", owner: "Asha Rao" });
    await N("DELETE", `${first}/publish`);
    expect(await publicNote(token)).toBeNull();
  });

  it("goes to the trash, comes back, and can be deleted for good", async () => {
    const g = (await N("POST", "", { title: "Temp" })).json.note.id;
    await N("DELETE", g);
    expect((await N("GET", "?q=temp")).json.notes).toHaveLength(0);
    expect((await N("GET", "?view=trash")).json.notes.map((x: { id: string }) => x.id)).toEqual([g]);
    expect((await N("POST", `${g}/restore`)).json.note.deletedAt).toBeNull();
    await N("DELETE", g);
    expect((await N("DELETE", `${g}?forever=1`)).json.deleted).toBe(1);
  });

  it("imports Markdown notes and exports them as CSV", async () => {
    const r = await N("POST", "import", { notes: [{ title: "Imported", content: doc(block("p", "From a file")), tags: ["imported"] }] });
    expect(r.json.created).toBe(1);
    const csv = await N("GET", "csv");
    expect(csv.text.split("\n")[0]).toBe("title,folder,tags,kind,day,words,updated,text");
    expect(csv.text).toContain("Imported");
  });

  it("reminds the owner when it's time", async () => {
    await N("PATCH", first, { remindAt: new Date(Date.now() - 1000).toISOString() });
    expect(await notesTick()).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U.asha!), eq(schema.notifications.kind, "notes.reminder")));
    expect(rows).toHaveLength(1);
    expect(await notesTick()).toBe(0);
  });

  it("uses AI: summary, rewrite, and answers across your notes with sources", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    ai({ summary: "A call about delivery.", points: ["Delivery by March", "Send a quote"] });
    const s = await N("POST", "ai", { action: "summarize", noteId: first });
    expect(s.status, s.text).toBe(200);
    expect(s.json.blocks.map((b: { type: string }) => b.type)).toEqual(["callout", "bullet", "bullet"]);
    ai({ text: "We'll deliver by March." });
    expect((await N("POST", "ai", { action: "rewrite", mode: "professional", text: "we deliver march" })).json.text).toBe("We'll deliver by March.");
    ai({ answer: "Delivery is due by March.", found: true, cited: [1, 9] });
    const a = await N("POST", "ai", { action: "ask_all", question: "When is delivery for Kiran?" });
    expect(a.json).toMatchObject({ found: true, sources: [{ id: first }] });
    ai({ items: [{ task: "Send quote", owner: "Asha", due: "2026-11-05" }, { task: "", owner: "", due: "" }] });
    const items = await N("POST", "ai", { action: "actions", noteId: first });
    expect(items.json.items).toHaveLength(1);
    expect(items.json.blocks[0]).toMatchObject({ type: "todo", text: "Asha: Send quote (by 2026-11-05)" });
    // Every call is counted against the workspace's AI allowance.
    expect((await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.orgId, org))).length).toBe(4);
    // Without a connection it says how to add one.
    process.env.ANTHROPIC_API_KEY = "";
    setAnthropicClientFactory(null);
    expect((await N("POST", "ai", { action: "rewrite", mode: "fix", text: "x" })).json.error.message).toMatch(/No AI provider is connected/);
  });
});
