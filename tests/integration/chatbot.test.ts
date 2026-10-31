import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as chatbot from "@/app/api/v1/projects/[projectId]/chatbot/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as chatPost from "@/app/api/v1/store/[projectId]/chat/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { setChatModel } from "@/server/knowledge/chat";
import { chunkText, search } from "@/server/knowledge/kb";
import { drain } from "@/server/jobs/queue";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
let depId = "";
const C = (method: string, slug: string[] = [], body?: unknown) => call(chatbot[method as "GET"], { method, cookie, body, params: { projectId, slug } });
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
const page = async (path: string, c = "") => (await siteServe.GET(new Request(`${ORIGIN}/sites/${depId}${path}`, { headers: c ? { cookie: c } : {} }), { params: Promise.resolve({ deploymentId: depId, path: path.split("/").filter(Boolean) }) })).text();
async function say(fields: Record<string, string>, c = "") {
  const f = new FormData();
  f.set("_base", `/sites/${depId}`);
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await chatPost.POST(new Request(`${ORIGIN}/api/v1/store/${projectId}/chat`, { method: "POST", headers: { origin: ORIGIN, ...(c ? { cookie: c } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
  return { status: res.status, location: decodeURIComponent(res.headers.get("location") ?? ""), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? c };
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Cara Chat", email: "cara@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "cafe", name: "Ember & Oat" } })).json.project.id;
  await store("POST", "setup", { name: "Ember & Oat", country: "IN", region: "Karnataka", email: "hello@emberoat.example", replaceDesign: false });
  for (const p of (await store("GET", "products")).json.products) await store("DELETE", `products/${p.id}`);
  await store("POST", "products", { title: "Single-origin beans", description: "Washed Ethiopian coffee with notes of jasmine and peach. 250 g bag, roasted weekly.", status: "active", variants: [{ options: {}, price: 69900, stock: 30 }] });
  const st = (await store("GET", "")).json.store;
  await store("PUT", "settings", { name: st.name, email: st.email, phone: "+91 98765 43210", currency: st.currency, country: st.country, region: st.region, address: { line1: "4 Church Street", line2: "", city: "Bengaluru", region: "Karnataka", postalCode: "560001", country: "IN" }, orderPrefix: st.orderPrefix, lowStockThreshold: st.lowStockThreshold, notifyEmails: [], policies: { ...st.policies, shipping: "We deliver across India within 3 to 5 working days. Orders over ₹999 ship free." }, checkout: st.checkout });
  depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
});
afterAll(async () => {
  setChatModel(null);
  delete process.env.ANTHROPIC_API_KEY;
  await closeDb();
});

describe("knowledge base", () => {
  it("chunks long text on paragraph and sentence boundaries", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} talks about coffee and pastries.`).join(" ");
    const chunks = chunkText(`Intro paragraph.\n\n${text}`, 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
  });

  it("indexes the published site, products, store details and owner notes", async () => {
    await drain(); // the production deploy queued a rebuild
    const r = await C("GET");
    expect(r.json.sources.map((s: { kind: string }) => s.kind).sort()).toEqual(["policies", "products", "site"]);
    expect(r.json.sources.every((s: { status: string; chunkCount: number }) => s.status === "ready" && s.chunkCount > 0)).toBe(true);
    const add = await C("POST", ["sources"], { kind: "text", title: "Opening hours", content: "We are open Monday to Saturday from 8 am to 7 pm. On Sundays we open at 9 am and close at 4 pm. Dogs are welcome on the terrace." });
    expect(add.status).toBe(201);
    await drain();
    const hits = await search(projectId, "when do you open on sunday");
    expect(hits[0].title).toBe("Opening hours");
    expect((await search(projectId, "shiping time"))[0].text).toContain("3 to 5 working days"); // typo tolerated
    expect((await search(projectId, "jasmine coffee"))[0]).toMatchObject({ title: "Single-origin beans", url: "/product/single-origin-beans" });
    expect((await C("DELETE", ["sources", r.json.sources[0].id])).status).toBe(409); // built-in sources stay
  });
});

describe("answers", () => {
  it("without an AI key, shows the best matching passages with links", async () => {
    const r = await C("POST", ["test"], { question: "Do you deliver outside Bengaluru?" });
    expect(r.json.mode).toBe("search");
    expect(r.json.text).toMatch(/^Here's what I found:/);
    expect(r.json.text).toContain("3 to 5 working days");
    const none = await C("POST", ["test"], { question: "xylophone quantum turbine" });
    expect(none.json).toMatchObject({ mode: "none" });
  });

  it("with an AI key, answers only from retrieved passages and cites them", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    let seen: { system: string; content: string } | null = null;
    setChatModel(async (req) => {
      seen = { system: req.system, content: String(req.messages.at(-1)!.content) };
      return { text: "Yes — we deliver across India in 3 to 5 working days, free over ₹999 [1].", provider: "anthropic", model: "claude-opus-5-5", inputTokens: 900, outputTokens: 40, costMicroUsd: 4400 };
    });
    const r = await C("POST", ["test"], { question: "Do you ship to Pune?" });
    expect(r.json.mode).toBe("ai");
    expect(r.json.sources[0].title).toBe("Shipping policy");
    expect(seen!.system).toContain("Answer ONLY with facts from the numbered context passages");
    expect(seen!.content).toContain("<context>");
    expect(seen!.content).toContain("[1] Shipping policy");
    const [task] = await db.select().from(schema.aiTasks).where(eq(schema.aiTasks.kind, "chat_answer"));
    expect(task).toMatchObject({ costMicroUsd: 4400, status: "succeeded" });
  });
});

describe("on the published site", () => {
  it("is off until switched on, then shows a launcher and a working /chat page", async () => {
    expect(await page("/chat")).toContain("Page not found");
    expect(await page("/")).not.toContain("cc-launch");
    expect((await C("PUT", [], { enabled: true, name: "Oat", greeting: "Hi! I'm Oat. Ask about coffee, hours or delivery.", instructions: "Recommend the single-origin beans for filter coffee.", handoffEmail: "", showLauncher: true })).status).toBe(200);
    expect(await page("/")).toContain(`class="cc-launch" href="/sites/${depId}/chat"`);
    const html = await page("/chat");
    expect(html).toContain("Hi! I&#39;m Oat");
    expect(html).not.toContain("<script");

    const first = await say({ action: "ask", message: "Do you ship to Pune?" });
    expect(first.location).toBe(`/sites/${depId}/chat#latest`);
    expect(first.cookie).toMatch(/^cc_chat_/);
    const thread = await page("/chat", first.cookie);
    expect(thread).toContain("Do you ship to Pune?");
    expect(thread).toContain("3 to 5 working days");
    expect(thread).toContain(`href="/sites/${depId}/policies/shipping"`);
    // Another visitor doesn't see this conversation.
    expect(await page("/chat")).not.toContain("Do you ship to Pune?");

    const h = await say({ action: "handoff", email: "visitor@example.com", note: "Can I order 5 kg for my office?" }, first.cookie);
    expect(h.location).toContain("sent=1");
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "hello@emberoat.example"));
    expect(mail.subject).toBe("Ember & Oat: a visitor asked for a reply");
    expect(mail.body).toContain("Can I order 5 kg for my office?");

    const list = (await C("GET", ["conversations"])).json.conversations;
    expect(list[0]).toMatchObject({ status: "needs_reply", email: "visitor@example.com" });
    const reply = await C("POST", ["conversations", list[0].id, "reply"], { text: "Yes! We'll email you a quote today.", close: true });
    expect(reply.json.emailed).toBe(true);
    expect((await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "visitor@example.com")))[0].body).toContain("We'll email you a quote today");
    expect(await page("/chat", first.cookie)).toContain("We&#39;ll email you a quote today");

    await C("PUT", [], { enabled: false, name: "Oat", greeting: "x", instructions: "", handoffEmail: "", showLauncher: true });
    expect(await page("/")).not.toContain("cc-launch");
    expect((await say({ action: "ask", message: "hello?" })).location).toContain("err=Chat%20is%20switched%20off".replace(/%20/g, " "));
  });
});
