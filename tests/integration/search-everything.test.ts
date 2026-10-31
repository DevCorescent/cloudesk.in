import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/search/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { block } from "@/lib/notes/blocks";
import { call, cookieFrom, resetDb } from "../helpers";

// Search for anything: notes, email, meetings, chat, tasks and people too —
// only what each person can open — "invoices"/"notes"/"meetings" list the
// latest, and Ask AI answers from the results with the ones it used.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const S = (q: string, who = "asha") => call(api.GET, { cookie: C[who], path: `/api/v1/orgs/${orgId}/search?q=${encodeURIComponent(q)}`, params: { orgId } });
const ASK = (question: string, who = "asha") => call(api.POST, { method: "POST", cookie: C[who], body: { question }, path: `/api/v1/orgs/${orgId}/search`, params: { orgId } });
const hits = (r: { json: { results: { kind: string; label: string }[] } }) => r.json.results;
const ai = (json: unknown) => setAnthropicClientFactory(() => ({ beta: { messages: { stream: () => ({ finalMessage: async () => ({ content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10 } }) }) } } }) as never);

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["asha", "Asha Rao", "asha@kiln.in"], ["ravi", "Ravi Kumar", "ravi@kiln.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    U[k] = (await call(me.GET, { cookie: C[k] })).json.user.id;
  }
  orgId = (await call(me.GET, { cookie: C.asha })).json.organizations[0].id;
  await db.insert(schema.memberships).values({ orgId, userId: U.ravi!, role: "editor" });
  const note = (ownerId: string, title: string, text: string, visibility = "private") => ({ orgId, ownerId, title, content: { blocks: [block("p", text)] }, text: `${title}\n${text}`, visibility });
  await db.insert(schema.notes).values([note(U.asha!, "Kiran Textiles pricing", "Agreed 12% off on orders above 400 sets"), note(U.ravi!, "Ravi's private plan", "Kiran Textiles renewal ideas"), note(U.ravi!, "Team handbook", "Kiran Textiles is our biggest client", "view")]);
  const [cal] = await db.insert(schema.calCalendars).values({ orgId, ownerId: U.asha!, name: "Work" }).returning();
  const soon = new Date(Date.now() + 2 * 86_400_000);
  await db.insert(schema.calEvents).values({ orgId, ownerId: U.asha!, calendarId: cal!.id, uid: "s1", title: "Tasting with Kiran Textiles", startsAt: soon, endsAt: new Date(soon.getTime() + 3600_000) });
  const [p] = await db.insert(schema.workProjects).values({ orgId, code: "P-1", name: "Kiran launch" } as never).returning();
  await db.insert(schema.workTasks).values({ orgId, projectId: p!.id, number: 1, title: "Send Kiran Textiles the quote", assigneeId: U.asha!, dueDate: "2026-11-05" });
});
afterEach(() => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
});
afterAll(closeDb);

describe("search for anything", () => {
  it("finds notes, meetings, tasks and people — never someone else's private note", async () => {
    const r = hits(await S("kiran"));
    const labels = r.map((h) => `${h.kind}: ${h.label}`);
    expect(labels).toEqual(expect.arrayContaining(["notes: Kiran Textiles pricing", "notes: Team handbook", "events: Tasting with Kiran Textiles", "tasks: Send Kiran Textiles the quote"]));
    expect(labels).not.toContain("notes: Ravi's private plan");
    expect(hits(await S("ravi")).map((h) => h.kind)).toContain("members");
    const ev = hits(await S("tasting")).find((h) => h.kind === "events") as unknown as { link: string };
    expect(ev.link).toMatch(/^\/calendar\?event=[0-9a-f-]+&at=/);
  });

  it("lists the latest of a kind when you type its name", async () => {
    const notes = hits(await S("notes"));
    expect(notes.filter((h) => h.kind === "notes").map((h) => h.label).sort()).toEqual(["Kiran Textiles pricing", "Team handbook"]);
    expect(hits(await S("my tasks")).map((h) => h.label)).toContain("Send Kiran Textiles the quote");
    expect(hits(await S("meetings")).map((h) => h.label)).toContain("Tasting with Kiran Textiles");
  });

  it("answers questions from the results, with the ones it used", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    ai({ answer: "You agreed 12% off on orders above 400 sets.", found: true, cited: [1, 99] });
    const r = await ASK("What did we agree with Kiran Textiles on pricing?");
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ found: true, answer: expect.stringContaining("12%") });
    expect(r.json.sources).toHaveLength(1);
    expect(r.json.sources[0]).toMatchObject({ link: expect.stringMatching(/^\//) });
    // The model only ever sees what this person can find.
    const [task] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.orgId, orgId));
    expect(task).toMatchObject({ kind: "search.ask" });
  });

  it("says so when nothing matches, without asking the model", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const r = await ASK("zzqx unknownword qqq");
    expect(r.json).toMatchObject({ found: false, sources: [] });
    expect((await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.orgId, orgId))).length).toBe(1);
  });

  it("asks for an AI connection when there isn't one", async () => {
    const r = await ASK("What did we agree with Kiran Textiles?");
    expect(r.json.error.message).toMatch(/No AI provider is connected/);
  });
});
