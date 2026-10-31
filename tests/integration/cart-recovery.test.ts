import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { runCartRecovery } from "@/server/commerce/recovery";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
let depId = "";
let variant = "";
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
async function post(handler: (r: Request, c: { params: Promise<{ projectId: string }> }) => Promise<Response>, fields: Record<string, string>, cart = "") {
  const f = new FormData();
  f.set("_base", "/s/acme/kora");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await handler(new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN, ...(cart ? { cookie: cart } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
  return { location: decodeURIComponent(res.headers.get("location") ?? ""), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cart };
}
const visit = (path: string, c = "") => siteServe.GET(new Request(`${ORIGIN}/sites/${depId}${path}`, { headers: c ? { cookie: c } : {} }), { params: Promise.resolve({ deploymentId: depId, path: path.split("?")[0].split("/").filter(Boolean) }) });
/** A shopper who reached checkout details and left. */
async function leave(email: string, consent: boolean) {
  const a = await post(cartRoute.POST, { action: "add", variant });
  await post(checkoutRoute.POST, { step: "details", email, phone: "98765 43210", name: "Meena Iyer", line1: "1 Beach Rd", line2: "", city: "Chennai", region: "Tamil Nadu", postalCode: "600001", country: "IN", ...(consent ? { consent: "1" } : {}) }, a.cookie);
  const [c] = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.email, email));
  await db.update(schema.storeCarts).set({ updatedAt: new Date(Date.now() - 4 * 3_600_000) }).where(eq(schema.storeCarts.id, c.id));
  return c.id;
}
const emailsTo = (to: string) => db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, to));

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Rhea", email: "rhea@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "store", name: "Kora" } })).json.project.id;
  await store("POST", "setup", { name: "Kora", country: "IN", region: "Karnataka", email: "hi@kora.example", replaceDesign: false });
  variant = (await store("POST", "products", { title: "Clay mug", status: "active", variants: [{ options: {}, price: 59900, stock: 30 }] })).json.product.variants[0].id;
  await store("POST", "discounts", { code: "COMEBACK10", kind: "percent", value: 10 });
});
afterAll(closeDb);

describe("automatic cart recovery", () => {
  it("only switches on with a real code", async () => {
    const bad = await store("PUT", "recovery", { enabled: true, delayHours: 3, email: true, discountCode: "NOPE" });
    expect(bad.status).toBe(422);
    expect((await store("PUT", "recovery", { enabled: true, delayHours: 3, email: true, whatsapp: true })).status).toBe(422); // WhatsApp not connected
    const ok = await store("PUT", "recovery", { enabled: true, delayHours: 3, email: true, discountCode: "comeback10" });
    expect(ok.status).toBe(200);
    expect(ok.json.settings.discountCode).toBe("COMEBACK10");
  });

  it("waits for the store to be published, then reminds consenting shoppers once", async () => {
    depId = "pending";
    const consented = await leave("asha@example.com", true);
    await leave("no-consent@example.com", false);
    expect(await runCartRecovery()).toBe(0); // not published yet
    depId = (await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } })).json.deployment.id;
    expect(await runCartRecovery()).toBe(1);
    expect(await runCartRecovery()).toBe(0); // never twice
    expect(await emailsTo("no-consent@example.com")).toHaveLength(0);
    const [mail] = await emailsTo("asha@example.com");
    expect(mail.body).toContain("1 × Clay mug");
    expect(mail.body).toContain("COMEBACK10");
    const [c] = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.id, consented));
    expect(c.recoveryEmailedAt).not.toBeNull();
  });

  it("restores the cart in a new browser with the code applied, and counts the recovered order", async () => {
    const [mail] = await emailsTo("asha@example.com");
    const token = /\/cart\/recover\?t=([\w-]+)/.exec(mail.body)![1];
    const res = await visit(`/cart/recover?t=${token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/sites/${depId}/cart?m=recovered&code=COMEBACK10`);
    const cart = res.headers.get("set-cookie")!.split(";")[0];
    const page = await (await visit("/cart?m=recovered&code=COMEBACK10", cart)).text();
    expect(page).toContain("Welcome back");
    expect(page).toContain("Clay mug");
    expect((await visit("/cart/recover?t=forged-token-000000000000")).headers.get("location")).toMatch(/err=/);

    const rate = (await store("GET", "shipping")).json.zones[0].rates.find((r: { kind: string }) => r.kind === "flat").id;
    const placed = await post(checkoutRoute.POST, { step: "place", rate, payment: "cod" }, cart);
    expect(placed.location).toMatch(/\/order\//);
    const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId)));
    expect(o.discountTotal).toBeGreaterThan(0);
    const r = (await store("GET", "recovery")).json;
    expect(r.stats).toMatchObject({ sent: 1, cameBack: 1, orders: 1 });
    expect(r.stats.revenue).toBe(o.total);
  });
});
