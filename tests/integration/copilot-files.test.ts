import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/copilot/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

// Files in the copilot, with a stand-in model: a question can carry files (as
// a form); the model labels them, a bill is read by the accounts reader — not
// typed by the model — and saved only when confirmed; files can be filed in
// Documents; price lists become inventory items; advisors add their brief.
let orgId = "";
let cookie = "";
const A = (method: string, path: string, body?: unknown) => call((api as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/orgs/${orgId}/copilot/${path}`, params: { orgId, slug: path.split("/").filter(Boolean) } });
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

type Req = { system: { text: string }[] | string; messages: { role: string; content: unknown }[]; output_config?: { format?: unknown } };
type Reply = { content: unknown[]; stop_reason: string };
let script: ((r: Req) => Reply)[] = [];
const requests: Req[] = [];
const toolCall = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const say = (text: string): Reply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
const lastResult = (r: Req) => (r.messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0]!;

async function ask(text: string, files: { name: string; bytes: Buffer }[], turns: ((r: Req) => Reply)[], advisor = "") {
  script = turns;
  const form = new FormData();
  form.set("text", text);
  form.set("advisor", advisor);
  for (const f of files) form.append("files", new File([new Uint8Array(f.bytes)], f.name));
  const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/copilot/threads`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: form });
  const res = await api.POST(req, { params: Promise.resolve({ orgId, slug: ["threads"] }) });
  const json = await res.json();
  expect(res.status).toBe(200);
  return json as { id: string; items: { role: string; text?: string; files?: { id: string; name: string }[]; doc?: { kind: string; title: string } }[]; actions: { id: string; kind: string; status: string; input: Record<string, unknown> }[] };
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Farah Files", email: "farah.files@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  const acc = (m: string, p: string, b?: unknown) => call((accApi as unknown as Record<string, Parameters<typeof call>[0]>)[m], { method: m, cookie, body: b, path: `/api/v1/orgs/${orgId}/accounts/${p}`, params: { orgId, slug: p.split("/") } });
  await acc("GET", "meta");
  await acc("PUT", "settings", { state: "MH" });
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  setAnthropicClientFactory(() => ({ beta: { messages: { stream: (params: unknown) => ({ finalMessage: async () => {
    const r = JSON.parse(JSON.stringify(params)) as Req;
    requests.push(r);
    // The accounts reader asks for JSON: answer as a bill.
    if (r.output_config?.format) return { content: [{ type: "text", text: JSON.stringify({ isBill: true, supplierName: "Menon Traders", supplierGstin: "27AAPFU0939F1ZV", billNo: "MT/1182", date: "2026-10-28", dueDate: "2026-11-12", currency: "INR", lines: [{ description: "Cotton fabric 200 m", amount: 30000, gstRate: 5, accountCode: "5260" }], taxTotal: 1500, total: 31500 }) }], stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10 } };
    const next = script.shift();
    if (!next) throw new Error("No scripted reply left");
    return { ...next(r), model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 10 } };
  } }) } } }) as never);
});
afterAll(async () => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
  await closeDb();
});

describe("files in the copilot", () => {
  it("reads a bill with the accounts reader, and saves it to Accounts once confirmed", async () => {
    let read: { content: string; is_error?: boolean } = { content: "" };
    const t = await ask("Record this", [{ name: "menon-bill.pdf", bytes: PDF }], [
      (r) => {
        // The file reached the model as a PDF, without storage markers.
        const blocks = r.messages.at(-1)!.content as { type: string; cc_file?: unknown }[];
        expect(blocks.some((b) => b.type === "document")).toBe(true);
        expect(JSON.stringify(r.messages)).not.toMatch(/cc_file|cc_data/);
        return { content: [toolCall("d1", "identify_document", { attachmentId: "f1", kind: "supplier_bill", title: "Menon Traders bill MT/1182", facts: ["₹31,500 incl. GST"] }), toolCall("x1", "extract_bill", { attachmentId: "f1" })], stop_reason: "tool_use" };
      },
      (r) => {
        read = (r.messages.at(-1)!.content as { content: string; is_error?: boolean }[])[1]!;
        return say("It's a Menon Traders bill for ₹31,500 — check it and save.");
      },
    ]);
    expect(read.is_error).toBeFalsy();
    expect(read.content).toMatch(/Menon Traders \(MT\/1182\) — ₹31,500/);
    expect(t.items[0]).toMatchObject({ role: "user", text: "Record this", files: [{ id: "f1", name: "menon-bill.pdf" }] });
    expect(t.items.find((i) => i.doc)?.doc).toMatchObject({ kind: "supplier_bill", title: "Menon Traders bill MT/1182" });
    const bill = t.actions.find((a) => a.kind === "record_bill")!;
    expect(bill).toMatchObject({ status: "proposed", input: { kind: "bill", draft: expect.objectContaining({ supplierName: "Menon Traders", billNo: "MT/1182" }) } });
    expect(await db.select().from(schema.accBills).where(eq(schema.accBills.orgId, orgId))).toHaveLength(0);

    const done = await A("POST", `actions/${bill.id}/confirm`, {});
    expect(done.status).toBe(200);
    const [saved] = await db.select().from(schema.accBills).where(eq(schema.accBills.id, done.json.id));
    expect(saved).toMatchObject({ billNo: "MT/1182", supplierName: "Menon Traders" });
  });

  it("won't let the model type a bill itself", async () => {
    let res: { content: string; is_error?: boolean } = { content: "" };
    await ask("Add a bill", [], [() => ({ content: [toolCall("p1", "propose_action", { kind: "record_bill", summary: "x", input: { attachmentId: "f1", draft: {} } })], stop_reason: "tool_use" }), (r) => ((res = lastResult(r)), say("Okay."))]);
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/extract_bill/);
  });

  it("files an upload in Documents, and adds a price list to inventory", async () => {
    const csv = Buffer.from("Item,Price\nCotton shirt,450\nLinen shirt,1299\n");
    const t = await ask("Save this and add the items", [{ name: "price-list.csv", bytes: csv }], [
      (r) => {
        expect(JSON.stringify(r.messages.at(-1)!.content)).toContain("Cotton shirt,450");
        return { content: [toolCall("s1", "propose_action", { kind: "save_document", summary: "Save the price list", input: { attachmentId: "f1", title: "Price list Nov 2026" } }), toolCall("s2", "propose_action", { kind: "inventory_items", summary: "Add 2 items", input: { items: [{ name: "Cotton shirt", cost: 450, gstRate: 5 }, { name: "Linen shirt", cost: 1299, gstRate: 5 }] } })], stop_reason: "tool_use" };
      },
      () => say("Ready to save."),
    ]);
    const doc = t.actions.find((a) => a.kind === "save_document")!;
    const d = await A("POST", `actions/${doc.id}/confirm`, {});
    expect(d.status).toBe(200);
    expect(d.json.link).toMatch(/^\/documents\/file\//);
    const [file] = await db.select().from(schema.docFiles).where(eq(schema.docFiles.id, d.json.id));
    expect(file?.title).toBe("Price list Nov 2026");

    const items = t.actions.find((a) => a.kind === "inventory_items")!;
    expect((await A("POST", `actions/${items.id}/confirm`, {})).status).toBe(200);
    const rows = await db.select().from(schema.invItems).where(eq(schema.invItems.orgId, orgId));
    expect(rows.map((r) => [r.name, r.avgCost]).sort()).toEqual([["Cotton shirt", 45000], ["Linen shirt", 129900]]);
  });

  it("adds the chosen advisor's brief to the instructions", async () => {
    requests.length = 0;
    await ask("How's my cash flow?", [], [() => say("Fine.")], "finance");
    const sys = requests.at(-1)!.system as { text: string }[];
    expect(sys.at(-1)!.text).toMatch(/^Advisor mode — Finance & tax advisor\./);
    expect(sys.at(-1)!.text).toMatch(/GSTR-1\/3B/);
  });
});
