import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import { setAnthropicClientFactory } from "@/server/ai/gateway";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// Reading a bill with a stand-in model: the file goes as a document block with
// a JSON-schema answer format, the answer becomes a draft matched to the
// supplier and accounts, and nothing is saved. Not a PDF or image: refused.
let orgId = "";
let cookie = "";
const sent: { messages: { content: { type: string; source?: { media_type: string } }[] }[]; output_config: { format: { type: string } } }[] = [];
let answer: unknown = {};
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const A = (method: string, path: string, body?: unknown) => call((accApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/orgs/${orgId}/accounts/${path}`, params: { orgId, slug: path.split("/") } });
const I = (method: string, path: string, body?: unknown) => call((invApi as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie, body, path: `/api/v1/orgs/${orgId}/inventory/${path}`, params: { orgId, slug: path.split("/") } });

async function read(name: string, bytes: Buffer) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  const req = new Request(`${ORIGIN}/api/v1/orgs/${orgId}/accounts/bills-extract`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: form });
  const res = await accApi.POST(req, { params: Promise.resolve({ orgId, slug: ["bills-extract"] }) });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Bela Books", email: "bela.extract@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  await A("GET", "meta");
  await A("PUT", "settings", { state: "MH" });
  await I("GET", "meta");
  await I("POST", "suppliers", { name: "Bright Lights", gstin: "29ABCDE1234F1ZW" });
});
afterEach(() => {
  setAnthropicClientFactory(null);
  process.env.ANTHROPIC_API_KEY = "";
});
afterAll(closeDb);

function stub() {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  setAnthropicClientFactory(() => ({ beta: { messages: { stream: (p: unknown) => ({ finalMessage: async () => {
    sent.push(JSON.parse(JSON.stringify(p)));
    return { content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 3000, output_tokens: 200 } };
  } }) } } }) as never);
}

describe("reading a bill", () => {
  it("says no provider is connected", async () => {
    expect((await A("GET", "meta")).json.aiConnected).toBe(false);
    expect((await read("bill.pdf", PDF)).status).toBe(424);
  });

  it("reads a PDF into a draft, matched to the supplier and an account, and saves nothing", async () => {
    stub();
    answer = { isBill: true, supplierName: "Bright Lights", supplierGstin: "29ABCDE1234F1ZW", billNo: "BL-77", date: "2026-10-18", dueDate: "", currency: "INR", lines: [{ description: "LED panels", amount: 5000, gstRate: 18, accountCode: "5260" }], taxTotal: 900, total: 5900 };
    const r = await read("bill.pdf", PDF);
    expect(r.status).toBe(200);
    expect(sent[0].messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(sent[0].output_config.format.type).toBe("json_schema");
    const office = (await A("GET", "meta")).json.accounts.find((a: { code: string }) => a.code === "5260").id;
    expect(r.json.draft).toMatchObject({ supplierName: "Bright Lights", billNo: "BL-77", date: "2026-10-18", interState: true, lines: [{ accountId: office, amount: 5000_00, gstRate: 18 }] });
    expect(r.json.draft.supplierId).toBeTruthy();
    expect(r.json.warnings).toEqual([]);
    expect(await db.select().from(schema.accBills).where(eq(schema.accBills.orgId, orgId))).toHaveLength(0);
    const [usage] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.kind, "bill_extract"));
    expect(usage).toMatchObject({ orgId, inputTokens: 3000, outputTokens: 200 });
    // The draft saves as an ordinary bill.
    const { draft } = r.json;
    expect((await A("POST", "bills", { supplierId: draft.supplierId, billNo: draft.billNo, date: draft.date, interState: draft.interState, lines: draft.lines })).status).toBe(200);
  });

  it("refuses files that aren't a PDF or image, and an answer that isn't the agreed shape", async () => {
    stub();
    const bad = await read("notes.txt", Buffer.from("hello"));
    expect(bad.status).toBe(422);
    answer = { supplier: "x" };
    const r = await read("bill.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
    expect(r.status).toBe(502);
    expect(r.json.error.message).toBe("The bill couldn't be read. Enter it by hand.");
  });
});
