import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import * as webhooks from "@/app/api/v1/store/[projectId]/webhooks/[provider]/route";
import { chatLink, setWhatsAppHttp, waNumber } from "@/server/commerce/whatsapp";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
const sent: { to: string; template: { name: string; components?: { parameters: { text: string }[] }[] } }[] = [];

const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });

async function post(handler: (r: Request, c: { params: Promise<{ projectId: string }> }) => Promise<Response>, fields: Record<string, string>, cartCookie = "") {
  const f = new FormData();
  f.set("_base", "/s/acme/wa");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await handler(new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN, ...(cartCookie ? { cookie: cartCookie } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
  return { location: decodeURIComponent(res.headers.get("location") ?? ""), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cartCookie };
}

async function order(variant: string, optIn: boolean, consent = false) {
  const a = await post(cartRoute.POST, { action: "add", variant });
  await post(checkoutRoute.POST, { step: "details", email: "meena@example.com", phone: "98765 43210", name: "Meena Iyer", line1: "1 Beach Rd", line2: "", city: "Chennai", region: "Tamil Nadu", postalCode: "600001", country: "IN", ...(optIn ? { whatsapp: "1" } : {}), ...(consent ? { consent: "1" } : {}) }, a.cookie);
  const rate = (await store("GET", "shipping")).json.zones[0].rates.find((r: { kind: string }) => r.kind === "flat").id;
  const placed = await post(checkoutRoute.POST, { step: "place", rate, payment: "cod" }, a.cookie);
  const n = Number(/\/order\/(\d+)/.exec(placed.location)?.[1]);
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, n)));
  return { o, cartCookie: a.cookie };
}

beforeAll(async () => {
  await resetDb();
  setWhatsAppHttp(async (input, init) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    if (auth !== "Bearer good-token") return Response.json({ error: { message: "Invalid OAuth access token.", code: 190 } }, { status: 401 });
    if (url.includes("?fields=")) return Response.json({ display_phone_number: "+91 80000 00000", verified_name: "Kobo Goods", id: "1234567" });
    if (url.endsWith("/messages")) {
      const body = JSON.parse(String(init?.body));
      sent.push({ to: body.to, template: body.template });
      return Response.json({ messages: [{ id: `wamid.${sent.length}` }] });
    }
    return Response.json({ error: { message: "unexpected" } }, { status: 400 });
  });
  const r = await call(signup.POST, { method: "POST", body: { name: "O", email: "o@example.com", password: "correct-horse-42" } });
  cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: m.json.organizations[0].id }, body: { templateId: "blank", name: "Wa" } })).json.project.id;
  await store("POST", "setup", { name: "Kobo Goods", country: "IN", region: "Karnataka" });
});

afterAll(async () => {
  setWhatsAppHttp((i, init) => fetch(i, init));
  await closeDb();
});

describe("whatsapp", () => {
  it("normalises numbers and builds click-to-chat links", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("+1 (415) 555-0100", "US")).toBe("14155550100");
    expect(waNumber("0091 98765 43210")).toBe("919876543210");
    expect(waNumber("12")).toBeNull();
    expect(chatLink("919876543210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
  });

  it("verifies credentials before storing them and never returns the token", async () => {
    expect((await store("PUT", "integrations/whatsapp", { enabled: true })).status).toBe(409);
    expect((await store("PUT", "integrations/whatsapp", { phoneNumberId: "1234567", accessToken: "bad" })).status).toBe(422);
    const ok = await store("PUT", "integrations/whatsapp", { phoneNumberId: "1234567", accessToken: "good-token", appSecret: "app-secret", chatNumber: "98765 43210" });
    expect(ok.json.whatsapp).toMatchObject({ connected: true, displayNumber: "+91 80000 00000", verifiedName: "Kobo Goods", chatNumber: "919876543210", hasAppSecret: true });
    expect(JSON.stringify(ok.json)).not.toContain("good-token");
    expect(JSON.stringify(ok.json)).not.toContain("app-secret");
    const tpl = await store("PUT", "integrations/whatsapp", { enabled: true, templates: { order_confirmation: { name: "order_confirmation", language: "en", enabled: true }, order_shipped: { name: "order_shipped", language: "en", enabled: true }, cart_reminder: { name: "cart_reminder", language: "en", enabled: true } } });
    expect(tpl.status).toBe(200);
    expect((await store("PUT", "integrations/whatsapp", { templates: { order_shipped: { name: "Bad Name!", language: "en", enabled: true } } })).status).toBe(422);
  });

  it("messages only shoppers who opted in, with the right details at each step", async () => {
    const p = await store("POST", "products", { title: "Tea set", status: "active", variants: [{ options: {}, price: 120000, stock: 20 }] });
    const variant = p.json.product.variants[0].id;
    await order(variant, false);
    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toHaveLength(0);

    const { o } = await order(variant, true);
    await new Promise((r) => setTimeout(r, 150));
    expect(o.whatsappOptIn).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("919876543210");
    expect(sent[0].template.name).toBe("order_confirmation");
    const params = sent[0].template.components![0].parameters.map((x) => x.text);
    expect(params[0]).toBe("Meena");
    expect(params[2]).toBe("Kobo Goods");
    expect(params[4]).toContain(`/order/${o.number}?key=`);

    await store("POST", `orders/${o.id}`, { action: "fulfill", status: "shipped", carrier: "delhivery", trackingNumber: "DL1" });
    expect(sent[1].template.name).toBe("order_shipped");
    expect(sent[1].template.components![0].parameters.map((x) => x.text)).toEqual(["Meena", `#${o.number}`, "Delhivery", expect.stringContaining("DL1")]);
    // Delivered has no template configured, so nothing is sent.
    await store("POST", `orders/${o.id}`, { action: "fulfill", status: "delivered" });
    expect(sent).toHaveLength(2);
    const log = (await store("GET", "integrations/whatsapp")).json.messages;
    expect(log.map((m: { status: string }) => m.status)).toEqual(["sent", "sent"]);
  });

  it("accepts signed delivery receipts only, and never moves a status backwards", async () => {
    const challenge = await webhooks.GET(new Request(`${ORIGIN}/x?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`), { params: Promise.resolve({ projectId, provider: "whatsapp" }) });
    expect(challenge.status).toBe(403);
    const token = (await store("GET", "integrations/whatsapp")).json.whatsapp.verifyToken;
    const ok = await webhooks.GET(new Request(`${ORIGIN}/x?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`), { params: Promise.resolve({ projectId, provider: "whatsapp" }) });
    expect(await ok.text()).toBe("42");

    const status = (id: string, s: string) => JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id, status: s }] } }] }] });
    const send = (raw: string, secret = "app-secret") => webhooks.POST(new Request(`${ORIGIN}/x`, { method: "POST", headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw }), { params: Promise.resolve({ projectId, provider: "whatsapp" }) });
    expect((await send(status("wamid.1", "read"), "forged")).status).toBe(403);
    expect((await (await send(status("wamid.1", "read"))).json()).updated).toBe(1);
    expect((await (await send(status("wamid.1", "delivered"))).json()).updated).toBe(0);
    const [m] = await db.select().from(schema.storeMessages).where(eq(schema.storeMessages.providerId, "wamid.1"));
    expect(m.status).toBe("read");
  });

  it("sends a cart reminder only with marketing consent and the WhatsApp opt-in, once", async () => {
    const p = await store("POST", "products", { title: "Mug", status: "active", variants: [{ options: {}, price: 50000, stock: 20 }] });
    const a = await post(cartRoute.POST, { action: "add", variant: p.json.product.variants[0].id });
    await post(checkoutRoute.POST, { step: "details", email: "cart@example.com", phone: "9876500000", name: "Ravi K", line1: "x", line2: "", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN", whatsapp: "1" }, a.cookie);
    const [cart] = await db.select().from(schema.storeCarts).where(eq(schema.storeCarts.email, "cart@example.com"));
    // Opted in to WhatsApp updates but not to marketing: no reminder.
    expect((await store("POST", `abandoned/${cart.id}/whatsapp`, {})).status).toBe(403);
    await db.update(schema.storeCarts).set({ marketingConsent: true }).where(eq(schema.storeCarts.id, cart.id));
    // The reminder links to the live store, so it needs the store published first.
    expect((await store("POST", `abandoned/${cart.id}/whatsapp`, {})).status).toBe(409);
    await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } });
    expect((await store("POST", `abandoned/${cart.id}/whatsapp`, {})).status).toBe(200);
    expect(sent.at(-1)!.template.name).toBe("cart_reminder");
    // The link restores the cart in any browser.
    expect(sent.at(-1)!.template.components![0].parameters.at(-1)!.text).toMatch(/\/cart\/recover\?t=[\w-]{20,}$/);
    expect(sent.at(-1)!.to).toBe("919876500000");
    expect((await store("POST", `abandoned/${cart.id}/whatsapp`, {})).status).toBe(409);
  });
});
