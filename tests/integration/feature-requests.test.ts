import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import * as reqApi from "@/app/api/v1/orgs/[orgId]/requests/[[...slug]]/route";
import { isFlagOn } from "@/server/platform/admin";
import { call, cookieFrom, resetDb } from "../helpers";

// Two workspaces ask the Cloudesk team for features; the team reviews,
// replies and releases — to one workspace, then to everyone.
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const O: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const A = (method: string, path: string, body?: unknown, who = "staff") => call((admin as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/admin/${path}`, params: { slug: seg(path) } });
const W = (method: string, path: string, body?: unknown, who = "meera", org = "saffron") => call((reqApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${O[org]}/requests/${path}`, params: { orgId: O[org]!, slug: seg(path) } });
const notes = (who: string, kind: string) => db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, U[who]!), eq(schema.notifications.kind, kind)));

let ask = "";
let other = "";

beforeAll(async () => {
  await resetDb();
  for (const [k, name, email] of [["meera", "Meera Iyer", "meera@saffron.in"], ["ravi", "Ravi Kumar", "ravi@saffron.in"], ["dev", "Dev Malhotra", "dev@thirdwave.cafe"], ["staff", "Pat Platform", "pat@cloudesk.example"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
    const m = (await call(me.GET, { cookie: C[k] })).json;
    U[k] = m.user.id;
    if (k === "meera") O.saffron = m.organizations[0].id;
    if (k === "dev") O.thirdwave = m.organizations[0].id;
  }
  await db.insert(schema.memberships).values({ orgId: O.saffron!, userId: U.ravi!, role: "editor" });
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, U.staff!));
});
afterAll(closeDb);

describe("asking", () => {
  it("files a request, counts the asker's vote, and keeps it inside the workspace", async () => {
    const r = await W("POST", "", { title: "Bulk export invoices as PDFs", problem: "Our auditor wants every invoice of the year as PDFs in one go.", priority: "critical", scope: "workspace", area: "invoicing" });
    expect(r.status).toBe(200);
    ask = r.json.request.id;
    expect(r.json.request).toMatchObject({ status: "submitted", votes: 1, voted: true, mine: true, scope: "workspace" });
    expect((await W("POST", "", { title: "x", problem: "y" })).status).toBe(422);
    // A colleague sees it and adds their vote.
    expect((await W("POST", `${ask}/vote`, undefined, "ravi")).json).toEqual({ votes: 2, voted: true });
    // Another workspace can't see it.
    expect((await W("GET", ask, undefined, "dev", "thirdwave")).status).toBe(404);
    expect((await W("GET", "?view=roadmap", undefined, "dev", "thirdwave")).json.requests).toEqual([]);
    other = (await W("POST", "", { title: "WhatsApp order alerts", problem: "Customers want order updates on WhatsApp.", scope: "everyone" }, "dev", "thirdwave")).json.request.id;
  });

  it("only the asker edits or withdraws, and only before the team starts", async () => {
    expect((await W("PATCH", ask, { title: "Bulk export invoices as PDF files" }, "ravi")).status).toBe(403);
    expect((await W("PATCH", ask, { title: "Bulk export invoices as PDF files" })).json.request.title).toBe("Bulk export invoices as PDF files");
  });
});

describe("the Cloudesk team", () => {
  it("sees every request (and only platform admins do)", async () => {
    expect((await A("GET", "requests", undefined, "meera")).status).toBe(404);
    const l = (await A("GET", "requests?status=open")).json;
    expect(l.requests.map((r: { title: string }) => r.title).sort()).toEqual(["Bulk export invoices as PDF files", "WhatsApp order alerts"]);
    expect(l.counts).toEqual({ submitted: 2 });
    const d = (await A("GET", `requests/${ask}`)).json;
    expect(d.request).toMatchObject({ org: { id: O.saffron }, requester: { email: "meera@saffron.in" }, priority: "critical" });
    expect(d.suggestedKey).toMatch(/^fr-\d+-bulk-export-invoices-as-pdf-files$/);
  });

  it("moves it along, replies, keeps internal notes private, and tells the people who asked", async () => {
    await A("PUT", `requests/${ask}`, { status: "planned", reply: "Good idea — we'll add it to Invoicing.", eta: "2026-11-20", note: "Planned for the November release." });
    await A("POST", `requests/${ask}/notes`, { body: "Reuse the PDF renderer; zip on the server.", internal: true });
    const w = (await W("GET", ask)).json;
    expect(w.request).toMatchObject({ status: "planned", reply: "Good idea — we'll add it to Invoicing.", eta: "2026-11-20" });
    expect(w.notes.map((n: { kind: string; body: string; by: string }) => [n.kind, n.body, n.by])).toEqual([["status", "Planned for the November release.", "Cloudesk team"]]);
    expect((await A("GET", `requests/${ask}`)).json.notes.some((n: { internal: boolean }) => n.internal)).toBe(true);
    expect((await notes("meera", "feature.updated")).length).toBe(1);
    expect((await notes("ravi", "feature.updated")).length).toBe(1);
    // Once the team is on it, the asker comments instead of editing.
    expect((await W("PATCH", ask, { title: "Something else entirely" })).status).toBe(409);
    await W("POST", `${ask}/comments`, { body: "Can it include credit notes too?" });
    expect((await A("GET", `requests/${ask}`)).json.notes.at(-1)).toMatchObject({ body: "Can it include credit notes too?", fromTeam: false });
  });

  it("publishes to the public roadmap: other workspaces see the title and reply, not the details", async () => {
    await A("PUT", `requests/${ask}`, { public: true });
    const r = (await W("GET", "?view=roadmap", undefined, "dev", "thirdwave")).json.requests.find((x: { id: string }) => x.id === ask);
    expect(r).toMatchObject({ title: "Bulk export invoices as PDF files", reply: "Good idea — we'll add it to Invoicing.", problem: "", by: null, ours: false });
    expect((await W("POST", `${ask}/vote`, undefined, "dev", "thirdwave")).json.votes).toBe(3);
    expect((await W("POST", `${ask}/comments`, { body: "+1" }, "dev", "thirdwave")).status).toBe(403);
  });

  it("releases to the workspace that asked: the flag is on there only, and they're told", async () => {
    expect((await A("POST", `requests/${ask}/release`, { flagKey: "fr-bulk-pdf", mode: "workspaces", orgIds: [] })).status).toBe(422);
    const r = (await A("POST", `requests/${ask}/release`, { flagKey: "fr-bulk-pdf", mode: "workspaces", orgIds: [O.saffron], notes: "Invoicing → Export → All as PDF (zip)." })).json;
    expect(r.request).toMatchObject({ status: "released", flagKey: "fr-bulk-pdf", flag: { enabled: false, orgIds: [O.saffron] } });
    expect(await isFlagOn("fr-bulk-pdf", O.saffron!)).toBe(true);
    expect(await isFlagOn("fr-bulk-pdf", O.thirdwave!)).toBe(false);
    expect((await W("GET", "flags")).json.flags).toContain("fr-bulk-pdf");
    expect((await W("GET", "flags", undefined, "dev", "thirdwave")).json.flags).not.toContain("fr-bulk-pdf");
    expect((await W("GET", "whats-new")).json.releases[0]).toMatchObject({ id: ask, released: { notes: "Invoicing → Export → All as PDF (zip).", forUs: true } });
    expect((await W("GET", "whats-new", undefined, "dev", "thirdwave")).json.releases).toEqual([]);
    expect((await notes("meera", "feature.released")).length).toBe(1);
    expect((await notes("ravi", "feature.released")).length).toBe(1);
  });

  it("then to everyone, and can roll it back", async () => {
    await A("POST", `requests/${ask}/release`, { flagKey: "fr-bulk-pdf", mode: "everyone", notes: "Now for every workspace." });
    expect(await isFlagOn("fr-bulk-pdf", O.thirdwave!)).toBe(true);
    expect((await W("GET", "whats-new", undefined, "dev", "thirdwave")).json.releases[0]).toMatchObject({ id: ask, released: { forUs: true } });
    const back = (await A("POST", `requests/${ask}/rollback`, { all: true })).json;
    expect(back.request).toMatchObject({ status: "testing", flag: { enabled: false, orgIds: [] } });
    expect(await isFlagOn("fr-bulk-pdf", O.saffron!)).toBe(false);
  });

  it("merges duplicates, carrying the votes over", async () => {
    const dup = (await W("POST", "", { title: "Download all invoices at once", problem: "Need a zip of all invoices for the CA." }, "ravi")).json.request.id;
    expect((await A("PUT", `requests/${dup}`, { status: "duplicate" })).status).toBe(422);
    await A("PUT", `requests/${dup}`, { duplicateOf: ask, note: "Same as #1 — follow that one." });
    const d = (await W("GET", dup, undefined, "ravi")).json.request;
    expect(d).toMatchObject({ status: "duplicate", duplicateOf: { id: ask } });
    expect((await A("GET", `requests/${ask}`)).json.request.votes).toBe(3);
    // Releasing is for flag writers: support can update but not release.
    await db.update(schema.users).set({ platformRole: "support" }).where(eq(schema.users.id, U.staff!));
    expect((await A("PUT", `requests/${other}`, { status: "under_review" })).status).toBe(200);
    expect((await A("POST", `requests/${other}/release`, { flagKey: "fr-wa", mode: "everyone" })).status).toBe(403);
  });
});
