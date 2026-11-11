import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/documents/[[...slug]]/route";
import * as copilot from "@/app/api/v1/orgs/[orgId]/copilot/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { textOf, type PMNode } from "@/lib/documents/write";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// The AI document studio, with a stand-in model: a request becomes the right
// kind of document with what it said already filled in and only the missing
// questions asked; the draft is saved as a written document (a letterhead on
// letters, placeholders counted from the text, the review trimmed), revised on
// request with the letterhead kept and the old text versioned, exported, and
// made from a Copilot conversation once confirmed. Viewers can't make them.
let orgId = "";
const C: Record<string, string> = {};
type H = Parameters<typeof call>[0];
const D = (method: string, path: string, body?: unknown, who = "owner") => call((api as unknown as Record<string, H>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/documents/${path}`, params: { orgId, slug: path.split("?")[0]!.split("/").filter(Boolean) } });
const K = (method: string, path: string, body?: unknown) => call((copilot as unknown as Record<string, H>)[method], { method, cookie: C.owner, body, path: `/api/v1/orgs/${orgId}/copilot/${path}`, params: { orgId, slug: path.split("/").filter(Boolean) } });

type Req = { system: unknown; messages: { role: string; content: unknown }[]; output_config?: { effort?: string } };
let script: ((r: Req) => unknown)[] = [];
const requests: Req[] = [];
const answer = (v: unknown) => () => ({ content: [{ type: "text", text: JSON.stringify(v) }], stop_reason: "end_turn" });
const textOfReq = (r: Req) => `${typeof r.system === "string" ? r.system : JSON.stringify(r.system)}\n${JSON.stringify(r.messages)}`;

beforeAll(async () => {
  await resetDb();
  for (const [k, name, role] of [["owner", "Asha Rao", null], ["viewer", "Vik Viewer", "viewer"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email: `${k}.studio@example.com`, password: "correct-horse-42" } }));
    const u = (await call(me.GET, { cookie: C[k] })).json;
    if (!role) orgId = u.organizations[0].id;
    else await db.insert(schema.memberships).values({ orgId, userId: u.user.id, role });
  }
  await db.update(schema.organizations).set({ modules: null }).where(eq(schema.organizations.id, orgId));
  await (await import("@/server/org/org")).companies(orgId);
  await db.update(schema.orgCompanies).set({ name: "Rao Textiles", legalName: "Rao Textiles Private Limited", gstin: "27AAPFU0939F1ZV", address: "12 MG Road, Pune 411001", state: "Maharashtra" }).where(eq(schema.orgCompanies.orgId, orgId));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  setAnthropicClientFactory(() => ({ beta: { messages: { stream: (params: unknown) => ({ on: () => {}, finalMessage: async () => {
    const r = JSON.parse(JSON.stringify(params)) as Req;
    requests.push(r);
    const next = script.shift();
    if (!next) throw new Error("No scripted reply left");
    return { ...(next(r) as object), model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 10 } };
  } }) } } }) as never);
});
afterEach(() => {
  script = [];
});
afterAll(async () => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
  await closeDb();
});

const NDA = `# Mutual Non-Disclosure Agreement

This Agreement is made at Mumbai on {{Execution date}}.

## 1. Definitions
**Confidential Information** means all information disclosed by either Party.

## 2. Governing law and jurisdiction
This Agreement is governed by the laws of India; courts at Mumbai.

## 3. Execution
Signed for and on behalf of Rao Textiles Private Limited by {{Signatory designation}}.`;

describe("the AI document studio", () => {
  let docId = "";
  let letterId = "";

  it("works out the document from a sentence, fills what it said and asks only what's missing", async () => {
    script = [
      answer({ kindId: "nda-mutual" }),
      answer({ title: "Mutual NDA — Infosys Limited", summary: "A two-year mutual NDA for a software partnership.", answers: [{ key: "party", value: "Infosys Limited" }, { key: "seat", value: "Mumbai" }, { key: "made_up", value: "dropped" }], questions: [{ key: "residuals", label: "Allow a residuals clause?", type: "select", options: ["Yes", "No"], required: false, help: "Lets staff use what they remember" }, { key: "party", label: "Duplicate of a listed one", type: "text", options: [], required: false, help: "" }, { key: "bad key!", label: "Bad", type: "text", options: [], required: false, help: "" }] }),
    ];
    const r = await D("POST", "studio/plan", { prompt: "A mutual NDA with Infosys for 2 years, Mumbai courts" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: "nda-mutual", title: "Mutual NDA — Infosys Limited", answers: { party: "Infosys Limited", seat: "Mumbai" }, business: { name: "Rao Textiles Private Limited", state: "Maharashtra" } });
    expect(r.json.answers.made_up).toBeUndefined();
    const keys = r.json.questions.map((q: { key: string }) => q.key);
    expect(keys).toContain("purpose");
    expect(keys).toContain("residuals");
    expect(keys.filter((k: string) => k === "party")).toHaveLength(1);
    expect(keys).not.toContain("bad key!");
    // The business's own particulars go with the request, so it never asks for them.
    expect(textOfReq(requests.at(-1)!)).toContain("GSTIN: 27AAPFU0939F1ZV");
  });

  it("skips the guess when the kind is chosen, and refuses unknown kinds", async () => {
    requests.length = 0;
    script = [answer({ title: "Offer letter — Riya Sen", summary: "An offer letter.", answers: [{ key: "name", value: "Riya Sen" }], questions: [] })];
    const r = await D("POST", "studio/plan", { kindId: "offer-letter", prompt: "Offer to Riya Sen" });
    expect(r.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(r.json.answers).toEqual({ name: "Riya Sen" });
    expect((await D("POST", "studio/plan", { kindId: "made-up" })).status).toBe(422);
    expect((await D("POST", "studio/plan", {})).status).toBe(422);
  });

  it("drafts to the kind's standard, saves it, and reviews it", async () => {
    requests.length = 0;
    script = [answer({ title: "Mutual NDA — Infosys Limited", markdown: NDA, review: { clauses: [{ name: "Definitions and interpretation", included: true, note: "Clause 1" }, { name: "Non-solicitation", included: false, note: "Not added" }], laws: ["Indian Contract Act, 1872"], stamp: "Stamp as an agreement under the Maharashtra Stamp Act.", signing: "Authorised signatories of both; e-sign is valid.", warnings: ["Confirm the term with the client"], fill: ["Model's own list is ignored"] } })];
    const r = await D("POST", "studio/generate", { kindId: "nda-mutual", prompt: "Mutual NDA with Infosys", answers: { party: "Infosys Limited", purpose: "Software partnership" }, options: { detail: "Comprehensive", favour: "Balanced", state: "Maharashtra" }, root: "team" });
    expect(r.status).toBe(200);
    docId = r.json.file.id;
    expect(r.json.kind).toBe("nda-mutual");
    expect(r.json.review.clauses).toEqual([{ name: "Definitions and interpretation", included: true, note: "Clause 1" }, { name: "Non-solicitation", included: false, note: "Not added" }]);
    expect(r.json.review.fill).toEqual(["Execution date", "Signatory designation"]);
    // The kind's clauses and laws, the options and the business all went to the model.
    const asked = textOfReq(requests[0]!);
    expect(asked).toContain("Remedies including injunctive relief (Specific Relief Act)");
    expect(asked).toContain("Digital Personal Data Protection Act, 2023");
    expect(asked).toContain("Length: Comprehensive");
    expect(asked).toContain("Balance: Balanced");
    expect(asked).toContain("State for stamp duty and courts: Maharashtra");
    expect(requests[0]!.output_config?.effort).toBe("medium");
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, docId));
    expect(f).toMatchObject({ kind: "doc", title: "Mutual NDA — Infosys Limited", icon: "⚖️", access: "inherit" });
    const content = f!.content as PMNode;
    expect(content.content![0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(textOf(content)).toContain("governed by the laws of India");
    // A contract carries no letterhead.
    expect(textOf(content)).not.toContain("GSTIN 27AAPFU0939F1ZV");
  });

  it("puts the business's letterhead on letters and notices", async () => {
    script = [answer({ title: "Legal notice — Sharma Traders", markdown: "**Subject: Demand for payment of ₹2,40,000**\n\nDear Sir,\n\nYou owe us ₹2,40,000.", review: { clauses: [], laws: [], stamp: "", signing: "", warnings: [], fill: [] } })];
    const r = await D("POST", "studio/generate", { kindId: "demand-notice", prompt: "Notice to Sharma Traders for ₹2,40,000" });
    expect(r.status).toBe(200);
    letterId = r.json.file.id;
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, letterId));
    const nodes = (f!.content as PMNode).content!;
    expect(nodes[0]).toMatchObject({ type: "heading", attrs: { level: 2, textAlign: "center" } });
    expect(textOf(nodes[0]!).trim()).toBe("Rao Textiles Private Limited");
    expect(textOf({ type: "doc", content: nodes.slice(0, 4) })).toContain("GSTIN 27AAPFU0939F1ZV");
    expect(nodes.findIndex((n) => n.type === "horizontalRule")).toBe(3);
  });

  it("revises on request, keeping the letterhead and the earlier text as a version", async () => {
    let sent = "";
    script = [
      (r: Req) => {
        sent = textOfReq(r);
        return answer({ markdown: "**Subject: Final demand for payment of ₹2,40,000**\n\nDear Sir,\n\nPay within 15 days.", changes: ["Made it a final demand with a 15-day deadline"] })();
      },
    ];
    const r = await D("POST", `docs/${letterId}/refine`, { instruction: "Make it a final demand with 15 days to pay" });
    expect(r.status).toBe(200);
    expect(r.json.changes).toEqual(["Made it a final demand with a 15-day deadline"]);
    // Only the body went for revision.
    expect(sent).not.toContain("Rao Textiles Private Limited");
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, letterId));
    const text = textOf(f!.content as PMNode);
    expect(text).toContain("Rao Textiles Private Limited");
    expect(text).toContain("Pay within 15 days.");
    expect(text).not.toContain("You owe us");
    const versions = await db.select().from(schema.docVersions).where(and(eq(schema.docVersions.fileId, letterId), eq(schema.docVersions.note, "Before AI revision")));
    expect(versions).toHaveLength(1);
    expect((await D("POST", `docs/${letterId}/refine`, { instruction: "x" })).status).toBe(422);
  });

  it("downloads the draft as Word and PDF straight away", async () => {
    for (const format of ["docx", "pdf"]) {
      const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/documents/docs/${docId}/export?format=${format}`, { headers: { cookie: C.owner! } });
      const res = await api.GET(req, { params: Promise.resolve({ orgId, slug: ["docs", docId, "export"] }) });
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(500);
    }
  });

  it("makes a document from a Copilot conversation once confirmed", async () => {
    script = [
      () => ({ content: [{ type: "tool_use", id: "b1", name: "propose_action", input: { kind: "business_document", summary: "Draft an appointment letter for Riya Sen", input: { kindId: "appointment", request: "Appointment letter for Riya Sen, Senior Designer, ₹9,00,000 CTC, joining 1 December", answers: { name: "Riya Sen", designation: "Senior Designer" } } } }], stop_reason: "tool_use" }),
      () => ({ content: [{ type: "text", text: "The appointment letter is ready to confirm." }], stop_reason: "end_turn" }),
    ];
    const t = await K("POST", "threads", { text: "Make Riya's appointment letter" });
    expect(t.status).toBe(200);
    const a = t.json.actions.at(-1);
    expect(a).toMatchObject({ kind: "business_document", status: "proposed" });
    script = [answer({ title: "Appointment letter — Riya Sen", markdown: "# Appointment letter\n\nDear Riya,\n\nWe are pleased to appoint you as Senior Designer.", review: { clauses: [], laws: [], stamp: "", signing: "", warnings: [], fill: [] } })];
    const done = await K("POST", `actions/${a.id}/confirm`, {});
    expect(done.status).toBe(200);
    expect(done.json.link).toMatch(/^\/documents\/d\/[0-9a-f-]{36}$/);
    const [f] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, done.json.link.split("/").at(-1)));
    expect(f!.title).toBe("Appointment letter — Riya Sen");
  });

  it("opens the guided studio in the chat when the model calls start_document", async () => {
    let result = "";
    script = [
      () => ({ content: [{ type: "tool_use", id: "s1", name: "start_document", input: { kindId: "nda-mutual", request: "An NDA with Infosys before we share our designs" } }], stop_reason: "tool_use" }),
      (r: Req) => {
        result = JSON.stringify(r.messages.at(-1));
        return { content: [{ type: "text", text: "The NDA is ready to fill in below." }], stop_reason: "end_turn" };
      },
    ];
    const t = await K("POST", "threads", { text: "We need something to protect our designs before talking to Infosys" });
    expect(t.status).toBe(200);
    expect(result).toContain("The document studio is open below your answer");
    const items = t.json.items as { role: string }[];
    expect(items).toContainEqual({ role: "docflow", kindId: "nda-mutual", request: "An NDA with Infosys before we share our designs" });
    expect(items.at(-1)).toEqual({ role: "assistant", text: "The NDA is ready to fill in below." });
  });

  it("doesn't let a viewer make documents", async () => {
    const r = await D("POST", "studio/generate", { kindId: "nda-mutual", prompt: "An NDA" }, "viewer");
    expect(r.status).toBe(403);
  });
});
