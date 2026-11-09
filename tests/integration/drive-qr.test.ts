import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/documents/[[...slug]]/route";
import * as dropApi from "@/app/api/v1/drop/[token]/route";
import * as removeApi from "@/app/api/v1/drop/remove/[token]/route";
import { expireTick } from "@/server/documents/drop";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Drive QR: a folder's QR that anyone can upload into from a phone, with the
// time each upload stays (then it's deleted completely), every access logged
// and emailed to the uploader with a link that deletes it, and the QR itself
// turned off or replaced.
let orgId = "";
const C: Record<string, string> = {};
type H = Parameters<typeof call>[0];
const D = (method: string, path: string, body?: unknown, who = "owner") => call((api as unknown as Record<string, H>)[method]!, { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/documents/${path}`, params: { orgId, slug: path.split("?")[0]!.split("/").filter(Boolean) } });
const tokenOf = (url: string) => url.split("/drop/")[1]!;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const drop = async (token: string, name: string, meta: unknown) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(PDF)], name));
  form.set("meta", JSON.stringify(meta));
  const res = await dropApi.POST(new Request(`${ORIGIN}/api/v1/drop/${token}`, { method: "POST", body: form, headers: { origin: ORIGIN, "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1" } }), { params: Promise.resolve({ token }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const view = (token: string) => call(dropApi.GET as H, { path: `/api/v1/drop/${token}`, params: { token } });
const mailsTo = (to: string) => db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, to)).orderBy(desc(schema.outboundEmails.createdAt));
const teamFiles = async () => (await D("GET", "drive?section=team")).json.files as { id: string; title: string; deleteAt: string | null; dropped: { name: string; email: string } | null }[];
const ids: Record<string, string> = {};

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Meera Rao", email: "meera.qr@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik Viewer", email: "viewer.qr@example.com", password: "correct-horse-42" } }));
  const [v] = await db.select().from(schema.users).where(eq(schema.users.email, "viewer.qr@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: v!.id, role: "viewer" });
});
afterAll(closeDb);

describe("setting up a folder's QR", () => {
  it("makes a QR for Team documents, with how long uploads stay", async () => {
    expect((await D("GET", "drop?root=team")).json).toEqual({ drop: null });
    const r = await D("PUT", "drop", { root: "team", name: "Front desk", stayMinutes: 7 * 24 * 60, uploaderChooses: true });
    expect(r.status).toBe(200);
    expect(r.json.drop).toMatchObject({ name: "Front desk", enabled: true, stayMinutes: 10080, uploads: 0 });
    ids.token = tokenOf(r.json.drop.url);
    ids.drop = r.json.drop.id;
  });

  it("is only for people who can add there", async () => {
    expect((await D("PUT", "drop", { root: "team" }, "viewer")).status).toBe(403);
  });

  it("shows the uploader where it goes and the times they may pick (up to the limit)", async () => {
    const r = await view(ids.token!);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ place: "Front desk", stayMinutes: 10080, maxMb: 25 });
    expect(r.json.choices.map((c: { label: string }) => c.label)).toEqual(["1 hour", "6 hours", "1 day", "3 days", "7 days"]);
  });
});

describe("uploading from a phone", () => {
  it("files it with the time chosen, tells the owner, and emails the uploader a delete link", async () => {
    const r = await drop(ids.token!, "Aadhaar.pdf", { name: "Asha", email: "asha@client.example", stayMinutes: 60 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ title: "Aadhaar", stay: "1 hour" });
    const f = (await teamFiles()).find((x) => x.title === "Aadhaar")!;
    ids.file = f.id;
    expect(f.dropped).toEqual({ name: "Asha", email: "asha@client.example" });
    expect(new Date(f.deleteAt!).getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
    const [mail] = await mailsTo("asha@client.example");
    expect(mail!.subject).toMatch(/“Aadhaar” was received/);
    ids.remove = /\/drop\/remove\/(\S+)/.exec(mail!.body)![1]!;
    const [n] = await db.select().from(schema.notifications).where(eq(schema.notifications.kind, "documents.dropped"));
    expect(n!.title).toContain("Aadhaar");
    // The log says where it came from.
    const act = (await D("GET", `files/${ids.file}/activity`)).json.activity;
    expect(act[0]).toMatchObject({ kind: "dropped", detail: { name: "Asha", device: "iPhone · Safari" } });
  });

  it("keeps to the folder's limit when asked for more", async () => {
    const r = await drop(ids.token!, "Long.pdf", { stayMinutes: 30 * 24 * 60 });
    expect(r.json.stay).toBe("7 days");
  });
});

describe("every access, told to the uploader", () => {
  it("emails them when it's opened, downloaded or printed — once a minute per person", async () => {
    const before = (await mailsTo("asha@client.example")).length;
    expect((await D("POST", `files/${ids.file}/event`, { kind: "viewed" })).status).toBe(200);
    await D("POST", `files/${ids.file}/event`, { kind: "viewed" });
    await D("POST", `files/${ids.file}/event`, { kind: "printed" });
    const res = await api.GET(new Request(`${ORIGIN}/api/v1/orgs/${orgId}/documents/files/${ids.file}/download`, { headers: { cookie: C.owner! } }), { params: Promise.resolve({ orgId, slug: ["files", ids.file!, "download"] }) });
    expect(res.status).toBe(200);
    const mails = (await mailsTo("asha@client.example")).slice(0, (await mailsTo("asha@client.example")).length - before);
    expect(mails.map((m) => m.subject).sort()).toEqual(["“Aadhaar” was downloaded", "“Aadhaar” was opened", "“Aadhaar” was printed"]);
    expect(mails[0]!.body).toContain("By: Meera Rao");
    expect(mails[0]!.body).toContain("/drop/remove/");
  });

  it("tells them when the time it stays changes", async () => {
    expect((await D("PUT", `files/${ids.file}/stay`, { minutes: 24 * 60 })).status).toBe(200);
    const [m] = await mailsTo("asha@client.example");
    expect(m!.subject).toBe("“Aadhaar” was changed when it's deleted");
  });
});

describe("deleting", () => {
  it("lets the uploader delete it completely from their email's link", async () => {
    const v = await call(removeApi.GET as H, { path: `/api/v1/drop/remove/${ids.remove}`, params: { token: ids.remove! } });
    expect(v.json).toMatchObject({ gone: false, title: "Aadhaar" });
    const r = await call(removeApi.POST as H, { method: "POST", body: {}, path: `/api/v1/drop/remove/${ids.remove}`, params: { token: ids.remove! } });
    expect(r.json).toEqual({ deleted: true });
    expect((await teamFiles()).some((f) => f.id === ids.file)).toBe(false);
    expect(await db.select().from(schema.docVersions).where(eq(schema.docVersions.fileId, ids.file!))).toHaveLength(0);
    expect((await call(removeApi.GET as H, { path: `/api/v1/drop/remove/${ids.remove}`, params: { token: ids.remove! } })).json).toEqual({ gone: true });
  });

  it("deletes uploads completely when their time comes, and tells the uploader", async () => {
    await drop(ids.token!, "Payslip.pdf", { email: "ravi@client.example", stayMinutes: 60 });
    const f = (await teamFiles()).find((x) => x.title === "Payslip")!;
    await db.update(schema.docFiles).set({ deleteAt: new Date(Date.now() - 1000) }).where(eq(schema.docFiles.id, f.id));
    expect((await expireTick()).deleted).toBe(1);
    expect((await teamFiles()).some((x) => x.id === f.id)).toBe(false);
    expect((await mailsTo("ravi@client.example"))[0]!.subject).toBe("“Payslip” was deleted");
  });
});

describe("the QR itself", () => {
  it("stops working when turned off, and a new one replaces the old", async () => {
    await D("PUT", "drop", { root: "team", name: "Front desk", stayMinutes: 7 * 24 * 60, enabled: false });
    expect((await view(ids.token!)).status).toBe(404);
    await D("PUT", "drop", { root: "team", name: "Front desk", stayMinutes: 7 * 24 * 60, enabled: true });
    expect((await view(ids.token!)).status).toBe(200);
    const r = await D("POST", `drop/${ids.drop}/rotate`, {});
    expect((await view(ids.token!)).status).toBe(404);
    expect((await view(tokenOf(r.json.drop.url))).status).toBe(200);
    expect((await drop(ids.token!, "Late.pdf", {})).status).toBe(404);
  });

  it("makes the drive refresh while it's taking uploads", async () => {
    expect((await D("GET", "drive?section=team")).json.qrLive).toBe(true);
    expect((await D("GET", "drive?section=mine")).json.qrLive).toBe(false);
  });
});
