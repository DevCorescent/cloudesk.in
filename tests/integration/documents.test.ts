import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/documents/[[...slug]]/route";
import * as signApi from "@/app/api/v1/sign/[token]/[[...rest]]/route";
import * as workApi from "@/app/api/v1/orgs/[orgId]/work/[[...slug]]/route";
import { textPdf } from "@/lib/documents/pdf";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Folders and who can open them, files with versions, a contract approved and
// signed by two people in order (each by their own link), the certificate,
// a decline, and contracts imported from a sheet.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const D = mk(api, "documents");
const W = mk(workApi, "work");
const S = (method: "GET" | "POST", token: string, rest: string[] = [], body?: unknown) => call(signApi[method], { method, body, path: `/api/v1/sign/${token}/${rest.join("/")}`, params: { token, rest } });
const pdf = (text: string) => textPdf([{ text }], { title: text });

async function uploadTo(path: string, name: string, bytes: Buffer, meta: unknown = {}, who = "owner", note = "") {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  form.set("meta", JSON.stringify(meta));
  if (note) form.set("note", note);
  const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/documents/${path}`, { method: "POST", headers: { cookie: C[who], origin: ORIGIN }, body: form });
  const res = await api.POST(req, { params: Promise.resolve({ orgId, slug: path.split("/") }) });
  return { status: res.status, json: await res.json() };
}
/** The signing link last emailed to someone (mail isn't set up in tests, so it's in the outbox). */
async function linkFor(email: string) {
  const [m] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, email)).orderBy(desc(schema.outboundEmails.createdAt)).limit(1);
  return m.body.match(/\/sign\/([A-Za-z0-9_-]+)/)![1];
}

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Lata Legal", email: "lata.docs@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  for (const [k, role] of [["editor", "editor"], ["viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: `${k} person`, email: `${k}.docs@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.docs@example.com`));
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  ids.project = (await W("POST", "projects", { name: "Harbour app" })).json.project.id;
});
afterAll(closeDb);

describe("folders and files", () => {
  it("keeps closed folders closed, refuses what isn't a document, and keeps versions", async () => {
    expect((await D("POST", "folders", { name: "Legal" }, "editor")).status).toBe(403);
    ids.legal = (await D("POST", "folders", { name: "Legal", access: "managers" })).json.folder.id;
    ids.shared = (await D("POST", "folders", { name: "Shared" })).json.folder.id;
    expect((await uploadTo("files", "setup.pdf", Buffer.from("MZ\x90\x00 not a pdf"))).status).toBe(422);
    const nda = await uploadTo("files", "NDA draft.pdf", pdf("NDA v1"), { folderId: ids.legal, tags: ["nda"] });
    expect(nda.status).toBe(200);
    ids.nda = nda.json.file.id;
    const sow = await uploadTo("files", "Statement of work.pdf", pdf("SOW v1"), { folderId: ids.shared, linkType: "work_project", linkId: ids.project, tags: ["sow"] }, "editor");
    ids.sow = sow.json.file.id;
    expect(sow.json.file).toMatchObject({ version: 1, mime: "application/pdf", link: { name: "Harbour app", href: `/work/projects/${ids.project}` } });
    expect((await uploadTo("files", "x.pdf", pdf("x"), { linkType: "work_project", linkId: "00000000-0000-4000-8000-000000000000" })).status).toBe(422);

    expect((await D("GET", `files?folderId=${ids.legal}`, undefined, "viewer")).json.files).toHaveLength(0);
    expect((await D("GET", `files/${ids.nda}`, undefined, "viewer")).status).toBe(404);
    expect((await D("GET", "folders", undefined, "viewer")).json.folders.map((f: { name: string }) => f.name)).toEqual(["Shared"]);
    expect((await D("GET", "files?q=nda")).json.files).toHaveLength(1);
    expect((await D("GET", "files?q=nda", undefined, "viewer")).json.files).toHaveLength(0);
    expect((await D("GET", `files?linkType=work_project&linkId=${ids.project}`, undefined, "viewer")).json.files).toHaveLength(1);

    const v2 = await uploadTo(`files/${ids.nda}/versions`, "NDA final.pdf", pdf("NDA v2"), {}, "owner", "Counsel's changes");
    expect(v2.json.version).toBe(2);
    const d = (await D("GET", `files/${ids.nda}`)).json;
    expect(d.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const one = await D("GET", `files/${ids.nda}/download?version=1`);
    expect(one.headers.get("content-disposition")).toMatch(/attachment; filename="NDA draft.pdf"/);
    expect(one.headers.get("etag")).toBe(`"${createHash("sha256").update(pdf("NDA v1")).digest("hex")}"`);
  });
});

describe("contracts and signatures", () => {
  it("approves a contract, then two people sign it in order by their own links", async () => {
    const made = await D("POST", "contracts", { title: "Mutual NDA", kind: "nda", counterparty: "Lumen Labs", value: 500000_00, startOn: "2026-10-01", endOn: "2027-09-30", autoRenew: true, renewalMonths: 12, noticeDays: 60, fileId: ids.nda, obligations: [{ id: "o1", text: "Return confidential material", due: "2027-10-15" }] });
    // The file is in a folder only owners and admins open, so an editor can't attach it.
    expect((await D("POST", "contracts", { title: "x", counterparty: "y", fileId: ids.nda }, "editor")).status).toBe(404);
    const c = made.json.contract;
    expect(c.number).toBe("CTR-0001");
    ids.contract = c.id;
    // Not approved yet: it can't go for signature.
    expect((await D("POST", "signatures", { fileId: ids.nda, contractId: c.id, title: "Mutual NDA", signers: [{ name: "Rohan", email: "rohan@lumen.example" }] })).status).toBe(409);
    expect((await D("POST", `contracts/${c.id}/submit`, {}, "editor")).json.status).toBe("review");
    expect((await D("POST", `contracts/${c.id}/decide`, { approve: true }, "editor")).status).toBe(403);
    expect((await D("POST", `contracts/${c.id}/decide`, { approve: true })).json.status).toBe("approved");
    // Approved terms are locked; obligations still change.
    await D("PUT", `contracts/${c.id}`, { title: "Changed", kind: "nda", counterparty: "Someone else", value: 1, fileId: ids.nda, obligations: [] });
    expect((await D("GET", `contracts/${c.id}`)).json.contract).toMatchObject({ title: "Mutual NDA", counterparty: "Lumen Labs", value: 500000_00, obligations: [] });

    const sent = (await D("POST", "signatures", { fileId: ids.nda, contractId: c.id, title: "Mutual NDA", message: "Please sign", signers: [{ name: "Rohan Mehta", email: "rohan@lumen.example" }, { name: "Lata Legal", email: "lata.docs@example.com" }] })).json;
    expect(sent.links).toHaveLength(1);
    expect(sent.emailed).toBe(false);
    ids.req = sent.request.id;
    const t1 = sent.links[0].url.split("/sign/")[1];
    expect(t1).toBe(await linkFor("rohan@lumen.example"));
    expect((await D("GET", `contracts/${c.id}`)).json.contract.status).toBe("signing");

    const view = (await S("GET", t1)).json;
    expect(view).toMatchObject({ title: "Mutual NDA", canSign: true, me: { name: "Rohan Mehta" }, file: { filename: "NDA final.pdf", version: 2 } });
    expect((await S("POST", t1, ["sign"], { name: "Rohan Mehta", consent: true })).status).toBe(409);
    const file = await S("GET", t1, ["file"]);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect((await S("POST", t1, ["sign"], { name: "Rohan Mehta", consent: false })).status).toBe(422);
    expect((await S("POST", t1, ["sign"], { name: "Rohan Mehta", consent: true })).json.status).toBe("signed");
    expect((await S("POST", t1, ["sign"], { name: "Rohan Mehta", consent: true })).status).toBe(409);

    const t2 = await linkFor("lata.docs@example.com");
    await S("GET", t2, ["file"]);
    await S("POST", t2, ["sign"], { name: "Lata Legal", consent: true });
    const d = (await D("GET", `signatures/${ids.req}`)).json;
    expect(d.request).toMatchObject({ status: "completed", hasCertificate: true });
    expect(d.events.map((e: { kind: string }) => e.kind)).toEqual(["created", "sent", "viewed", "signed", "sent", "viewed", "signed", "completed"]);
    const cert = await D("GET", `signatures/${ids.req}/certificate`);
    expect(cert.text.startsWith("%PDF-1.4")).toBe(true);
    expect(cert.text).toContain(d.request.sha256);
    expect((await D("GET", `contracts/${c.id}`)).json.contract.status).toBe("signed");
    // The link still shows it's done, but nothing more can be signed with it.
    expect((await S("GET", t1)).json).toMatchObject({ status: "completed", canSign: false, me: { status: "signed" } });
    expect((await D("DELETE", `files/${ids.nda}`)).status).toBe(409);
  });

  it("stops when someone declines, and tells the sender", async () => {
    const sent = (await D("POST", "signatures", { fileId: ids.sow, title: "SOW", sequential: false, signers: [{ name: "A", email: "a@x.example" }, { name: "B", email: "b@x.example" }] }, "editor")).json;
    expect(sent.links).toHaveLength(2);
    const [ta, tb] = sent.links.map((l: { url: string }) => l.url.split("/sign/")[1]);
    expect((await S("POST", ta, ["decline"], { reason: "" })).status).toBe(422);
    await S("POST", ta, ["decline"], { reason: "Wrong rate on page 2" });
    expect((await S("GET", tb)).json).toMatchObject({ status: "declined", canSign: false });
    const [n] = await db.select().from(schema.notifications).where(and(eq(schema.notifications.orgId, orgId), eq(schema.notifications.kind, "documents.declined")));
    expect(n.title).toMatch(/A declined to sign/);
  });
});

describe("renewals and import", () => {
  it("flags notice dates, and imports a register once", async () => {
    const rows = [
      { title: "Office lease", counterparty: "Shree Estates", number: "LEASE-1", kind: "lease", value: 1200000_00, startOn: "2025-11-01", endOn: "2026-10-31", autoRenew: true, renewalMonths: 12, noticeDays: 3, status: "signed" },
      { title: "Old AMC", counterparty: "CoolAir", kind: "service", endOn: "2025-01-01", status: "terminated" },
    ];
    expect((await D("POST", "contracts/import", { rows, mode: "update" }, "editor")).status).toBe(403);
    expect((await D("POST", "contracts/import", { rows, mode: "update" })).json).toMatchObject({ created: 2, updated: 0 });
    expect((await D("POST", "contracts/import", { rows: rows.slice(0, 1), mode: "update" })).json).toMatchObject({ created: 0, updated: 1 });
    const all = (await D("GET", "contracts?q=lease")).json.contracts;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ number: "LEASE-1", status: "signed" });
    const home = (await D("GET", "home")).json;
    expect(home.counts.contracts).toBeGreaterThanOrEqual(2);
    expect(home.storage.used).toBeGreaterThan(0);
  });
});
