import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";
import * as invAccept from "@/app/api/v1/invitations/accept/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgInvites from "@/app/api/v1/orgs/[orgId]/invitations/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as brand from "@/app/api/v1/projects/[projectId]/brand/route";
import * as file from "@/app/api/v1/projects/[projectId]/file/route";
import { writeFile } from "@/server/services/files";
import { call, cookieFrom, resetDb } from "../helpers";

let owner: { cookie: string; orgId: string; id: string };
let designer: { cookie: string };
let projectId: string;

async function user(email: string) {
  const r = await call(signup.POST, { method: "POST", body: { name: email, email, password: "correct-horse-42" } });
  const cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  return { cookie, orgId: m.json.organizations[0].id as string, id: m.json.user.id as string };
}
const getDoc = async () => {
  const r = await call(file.GET, { cookie: owner.cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
  return { doc: JSON.parse(r.json.content), revision: r.json.revision as number };
};
const save = (cookie: string, doc: unknown, revision: number) => call(file.PUT, { method: "PUT", cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}`, body: { content: JSON.stringify(doc, null, 2), baseRevision: revision } });

beforeAll(async () => {
  await resetDb();
  owner = await user("owner@example.com");
  projectId = (await call(orgProjects.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { templateId: "cafe", name: "Brew" } })).json.project.id;
  await call(orgInvites.POST, { method: "POST", cookie: owner.cookie, params: { orgId: owner.orgId }, body: { email: "dee@example.com", role: "designer" } });
  const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "dee@example.com"));
  const d = await user("dee@example.com");
  await call(invAccept.POST, { method: "POST", cookie: d.cookie, body: { token: mail.body.match(/token=([\w-]+)/)![1] } });
  designer = d;
});

afterAll(async () => {
  await closeDb();
});

describe("brand guardrails", () => {
  it("only owners and admins can set the rules", async () => {
    const body = { lockPalette: true, lockFonts: true, lockLogo: false, voice: "Warm and plain.", bannedWords: ["Cheap"], preferredTerms: [{ avoid: "customers", use: "guests" }] };
    expect((await call(brand.PUT, { method: "PUT", cookie: designer.cookie, params: { projectId }, body })).status).toBe(403);
    const r = await call(brand.PUT, { method: "PUT", cookie: owner.cookie, params: { projectId }, body });
    expect(r.status).toBe(200);
    expect(r.json.rules.bannedWords).toEqual(["cheap"]);
    const { doc } = await getDoc();
    expect(r.json.rules.palette).toEqual(doc.theme.palette);
    expect((await call(brand.GET, { cookie: designer.cookie, params: { projectId } })).json.canManage).toBe(false);
  });

  it("blocks saves that change locked colours or fonts — for everyone — but allows other edits", async () => {
    let { doc, revision } = await getDoc();
    const recolored = structuredClone(doc);
    recolored.theme.palette.accent = "#ff00aa";
    const blocked = await save(designer.cookie, recolored, revision);
    expect(blocked.status).toBe(422);
    expect(blocked.json.error.message).toContain("brand colours are locked");
    expect((await save(owner.cookie, recolored, revision)).status).toBe(422);

    doc.pages[0].sections[1].props.heading = "Coffee for our customers";
    const ok = await save(designer.cookie, doc, revision);
    expect(ok.status).toBe(200);
    // People get a warning, not a block, for wording.
    const check = await call(brand.GET, { cookie: owner.cookie, params: { projectId } });
    expect(check.json.issues.some((i: { kind: string; word: string }) => i.kind === "preferred" && i.word === "customers")).toBe(true);

    ({ doc, revision } = await getDoc());
    doc.pages[0].sections[1].props.heading = "Cheap coffee";
    await expect(writeFile(projectId, SITE_DOC_PATH, JSON.stringify(doc, null, 2), revision, { userId: null, source: "ai" })).rejects.toThrow(/words your brand avoids/);
  });

  it("restores the locked brand after an unlock and relock drift", async () => {
    // Unlock, change colours, relock with the old palette still recorded, then restore.
    const { doc, revision } = await getDoc();
    const original = structuredClone(doc.theme.palette);
    await db.update(schema.brandGuardrails).set({ lockPalette: false }).where(eq(schema.brandGuardrails.projectId, projectId));
    doc.theme.palette.accent = "#123456";
    expect((await save(owner.cookie, doc, revision)).status).toBe(200);
    await db.update(schema.brandGuardrails).set({ lockPalette: true }).where(eq(schema.brandGuardrails.projectId, projectId));
    const drift = await call(brand.GET, { cookie: owner.cookie, params: { projectId } });
    expect(drift.json.issues.some((i: { kind: string }) => i.kind === "palette")).toBe(true);
    const r = await call(brand.POST, { method: "POST", cookie: designer.cookie, params: { projectId }, body: {} });
    expect(r.status).toBe(200);
    expect((await getDoc()).doc.theme.palette).toEqual(original);
  });
});
