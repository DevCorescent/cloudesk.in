import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The model is a stand-in that returns a listing, so upload, validation,
// mapping and usage recording all run for real.
const ai = { on: true, reply: "" };
vi.mock("@/server/ai/gateway", () => ({
  hasLlm: async () => ai.on,
  complete: async (req: { messages: { content: unknown }[] }) => {
    const parts = req.messages[0].content as { type: string }[];
    if (parts[0].type !== "image") throw new Error("expected the photo first");
    return { text: ai.reply, provider: "anthropic", model: "test-model", inputTokens: 1200, outputTokens: 300, costMicroUsd: 9000 };
  },
}));

const { eq } = await import("drizzle-orm");
const { closeDb, db, schema } = await import("@/db");
const { call, cookieFrom, ORIGIN, resetDb } = await import("../helpers");
const me = await import("@/app/api/v1/auth/me/route");
const signup = await import("@/app/api/v1/auth/signup/route");
const orgProjects = await import("@/app/api/v1/orgs/[orgId]/projects/route");
const admin = await import("@/app/api/v1/projects/[projectId]/store/[[...slug]]/route");

let cookie = "";
let projectId = "";
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function upload(bytes: Buffer, name = "mug.png") {
  const f = new FormData();
  f.set("file", new File([new Uint8Array(bytes)], name, { type: "image/png" }));
  const res = await admin.POST(new Request(`${ORIGIN}/api/v1/projects/${projectId}/store/products/from-photo`, { method: "POST", body: f, headers: { cookie, origin: ORIGIN } }), { params: Promise.resolve({ projectId, slug: ["products", "from-photo"] }) });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Isha", email: "isha@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "store", name: "Kiln" } })).json.project.id;
  await store("POST", "setup", { name: "Kiln", country: "IN", region: "Kerala", email: "k@example.com", replaceDesign: false });
  await store("POST", "collections", { title: "Mugs & cups", description: "", productIds: [] });
});
afterAll(closeDb);

describe("photo to product listing", () => {
  it("drafts a listing from a photo, keeping only valid suggestions", async () => {
    ai.reply = JSON.stringify({ title: "Speckled stoneware mug", description: "A round mug in a speckled cream glaze.", tags: ["Mug", "stoneware", "mug"], hsn: "6912", gstPercent: 12, collection: "mugs & cups", altText: "Cream mug on a table", checks: ["Add the capacity"] });
    const r = await upload(PNG);
    expect(r.status).toBe(200);
    const cols = (await store("GET", "collections")).json.collections;
    expect(r.json.draft).toMatchObject({ title: "Speckled stoneware mug", tags: ["mug", "stoneware"], hsn: "6912", taxBps: 1200, collectionIds: [cols[0].id] });
    expect(r.json.draft.images[0]).toMatch(/^\/assets\//);
    expect(r.json.checks).toContain("Add the capacity");
    expect(r.json.checks.join(" ")).toMatch(/confirm them with your accountant/);
    // Nothing is saved until the owner reviews it.
    expect((await store("GET", "products")).json.products.filter((p: { isSample: boolean }) => !p.isSample)).toHaveLength(0);
    // Usage counts toward the AI budget.
    const [t] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.kind, "product_listing"));
    expect(t.costMicroUsd).toBe(9000);
  });

  it("drops suggestions that aren't valid instead of passing them on", async () => {
    ai.reply = JSON.stringify({ title: "Mug", description: "x", tags: [], hsn: "12", gstPercent: 7, collection: "Not a collection", altText: "", checks: [] });
    const r = await upload(PNG);
    expect(r.json.draft).toMatchObject({ hsn: "", taxBps: null, collectionIds: [] });
  });

  it("refuses non-images and explains when no AI provider is connected", async () => {
    expect((await upload(Buffer.from("<svg onload=alert(1)></svg>"), "x.svg")).status).toBe(422);
    ai.on = false;
    const r = await upload(PNG);
    expect(r.status).toBe(424);
    expect(r.json.error.message).toMatch(/AI provider/);
  });
});
