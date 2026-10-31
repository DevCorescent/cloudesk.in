import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as deployments from "@/app/api/v1/projects/[projectId]/deployments/route";
import * as fileRoute from "@/app/api/v1/projects/[projectId]/file/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as cartRoute from "@/app/api/v1/store/[projectId]/cart/route";
import * as checkoutRoute from "@/app/api/v1/store/[projectId]/checkout/route";
import * as memberLogin from "@/app/api/v1/store/[projectId]/member-login/route";
import * as memberSession from "@/app/api/v1/store/[projectId]/member/route";
import * as download from "@/app/api/v1/store/[projectId]/orders/[number]/download/[itemId]/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
let otherProject = "";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const store = (method: string, path: string, body?: unknown, pid = projectId) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${pid}/store/${path}`, params: { projectId: pid, slug: path.split("?")[0].split("/").filter(Boolean) } });

async function uploadFile(bytes: Buffer, name: string, pid = projectId) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), name);
  const res = await admin.POST(new Request(`${ORIGIN}/api/v1/projects/${pid}/store/files`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: form }), { params: Promise.resolve({ projectId: pid, slug: ["files"] }) });
  return { status: res.status, json: await res.json() };
}
async function post(handler: (r: Request, c: { params: Promise<{ projectId: string }> }) => Promise<Response>, fields: Record<string, string>, c = "") {
  const f = new FormData();
  f.set("_base", "/s/acme/club");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await handler(new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN, ...(c ? { cookie: c } : {}) }, body: f }), { params: Promise.resolve({ projectId }) });
  return { location: decodeURIComponent(res.headers.get("location") ?? ""), cookie: res.headers.get("set-cookie")?.split(";")[0] ?? c };
}
async function buyAndPay(variant: string, email: string) {
  const a = await post(cartRoute.POST, { action: "add", variant });
  await post(checkoutRoute.POST, { step: "details", email, phone: "9876543210", name: "Nina Das", line1: "1 Road", line2: "", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }, a.cookie);
  const placed = await post(checkoutRoute.POST, { step: "place", rate: "", payment: "manual" }, a.cookie);
  const [, n, key] = /\/order\/(\d+)\?key=([^&]+)/.exec(placed.location) ?? [];
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, Number(n))));
  return { o, key: key ?? "", placed: placed.location };
}
const dl = (n: number, key: string, itemId: string) => download.GET(new Request(`${ORIGIN}/x?key=${encodeURIComponent(key)}`), { params: Promise.resolve({ projectId, number: String(n), itemId }) });

beforeAll(async () => {
  await resetDb();
  const r = await call(signup.POST, { method: "POST", body: { name: "C", email: "club@example.com", password: "correct-horse-42" } });
  cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  const orgId = m.json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Club" } })).json.project.id;
  otherProject = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Other" } })).json.project.id;
  await store("POST", "setup", { name: "Club", country: "IN", region: "Maharashtra" });
  await store("POST", "setup", { name: "Other", country: "IN" }, otherProject);
  await store("PUT", "payments/manual", { enabled: true, settings: { upiId: "club@upi" } });
});

afterAll(async () => {
  await closeDb();
});

describe("digital products", () => {
  let fileId = "";
  it("stores sellable files privately and only accepts known file types", async () => {
    expect((await uploadFile(Buffer.from("<html><script>alert(1)</script></html>"), "x.pdf")).status).toBe(422);
    expect((await uploadFile(Buffer.from("MZ\x90\x00"), "setup.exe")).status).toBe(422);
    const ok = await uploadFile(PDF, "Guide to Pune.pdf");
    expect(ok.status).toBe(201);
    expect(ok.json.file).toMatchObject({ filename: "Guide to Pune.pdf", mime: "application/pdf" });
    fileId = ok.json.file.id;
    const other = await uploadFile(PDF, "other.pdf", otherProject);
    expect((await store("POST", "products", { title: "Stolen", kind: "digital", digitalFileId: other.json.file.id, status: "active", variants: [{ options: {}, price: 100 }] })).status).toBe(422);
  });

  it("sells a download: no delivery or cash on delivery, delivered on payment, limited downloads", async () => {
    const p = await store("POST", "products", { title: "City guide (PDF)", kind: "digital", digitalFileId: fileId, status: "active", variants: [{ options: {}, price: 49900, trackInventory: false }] });
    const variant = p.json.product.variants[0].id;
    const { o, key } = await buyAndPay(variant, "nina@example.com");
    expect(o).toMatchObject({ paymentMethod: "manual", shippingTotal: 0 });
    expect((o.shippingMethod as { id: string }).id).toBe("digital");
    const [item] = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id));
    expect(item.kind).toBe("digital");
    expect((await dl(o.number, key, item.id)).status).toBe(403); // not paid yet
    await store("POST", `orders/${o.id}`, { action: "mark_paid" });
    const [paid] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, o.id));
    expect(paid.fulfillmentStatus).toBe("delivered");
    const res = await dl(o.number, key, item.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="Guide to Pune.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect((await dl(o.number, "wrong", item.id)).status).toBe(404);
    for (let i = 0; i < 9; i++) expect((await dl(o.number, key, item.id)).status).toBe(200);
    expect((await dl(o.number, key, item.id)).status).toBe(403);
  });
});

describe("memberships", () => {
  let depId = "";
  it("grants access on payment and extends it on renewal", async () => {
    const p = await store("POST", "products", { title: "Club membership (30 days)", kind: "membership", membershipDays: 30, status: "active", variants: [{ options: {}, price: 99900, trackInventory: false }] });
    const variant = p.json.product.variants[0].id;
    const first = await buyAndPay(variant, "Member@Example.com");
    await store("POST", `orders/${first.o.id}`, { action: "mark_paid" });
    let members = (await store("GET", "members")).json.members;
    expect(members).toHaveLength(1);
    expect(members[0].email).toBe("member@example.com");
    const until = new Date(members[0].expiresAt).getTime();
    expect(Math.round((until - Date.now()) / 86400_000)).toBe(30);
    const second = await buyAndPay(variant, "member@example.com");
    await store("POST", `orders/${second.o.id}`, { action: "mark_paid" });
    members = (await store("GET", "members")).json.members;
    expect(members).toHaveLength(1);
    expect(Math.round((new Date(members[0].expiresAt).getTime() - Date.now()) / 86400_000)).toBe(60);
  });

  it("shows members-only pages only to signed-in members, by emailed link", async () => {
    const f = await call(fileRoute.GET, { cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}` });
    const doc = JSON.parse(f.json.content);
    doc.pages.push({ id: "p_club", path: "/club", title: "Members lounge", description: "", kind: "page", membersOnly: true, sections: [{ id: "s_club_text", type: "text", props: { heading: "Secret recipes", body: "Only for members." } }] });
    expect((await call(fileRoute.PUT, { method: "PUT", cookie, params: { projectId }, path: `/x?path=${SITE_DOC_PATH}`, body: { content: JSON.stringify(doc, null, 2), baseRevision: f.json.revision } })).status).toBe(200);
    const dep = await call(deployments.POST, { method: "POST", cookie, params: { projectId }, body: { environment: "production" } });
    expect(dep.json.deployment.status).toBe("ready");
    depId = dep.json.deployment.id;
    const page = (c = "") => siteServe.GET(new Request(`${ORIGIN}/sites/${depId}/club`, { headers: { "user-agent": "Mozilla/5.0 test", ...(c ? { cookie: c } : {}) } }), { params: Promise.resolve({ deploymentId: depId, path: ["club"] }) });

    const gate = await (await page()).text();
    expect(gate).toContain("Members only");
    expect(gate).not.toContain("Secret recipes");
    const sitemap = await (await siteServe.GET(new Request(`${ORIGIN}/sites/${depId}/sitemap.xml`), { params: Promise.resolve({ deploymentId: depId, path: ["sitemap.xml"] }) })).text();
    expect(sitemap).not.toContain("/club<");

    const before = (await db.select().from(schema.outboundEmails)).length;
    expect((await post(memberLogin.POST, { email: "stranger@example.com", next: "/club" })).location).toContain("sent=1");
    expect((await db.select().from(schema.outboundEmails)).length).toBe(before);
    await post(memberLogin.POST, { email: "member@example.com", next: "/club" });
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, "Club: your sign-in link"));
    const link = new URL(/https?:\/\/\S+/.exec(mail.body)![0]);
    const res = await memberSession.GET(new Request(`${ORIGIN}${link.pathname}${link.search}`), { params: Promise.resolve({ projectId }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/s/acme/club/club");
    const memberCookie = res.headers.get("set-cookie")!.split(";")[0];
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await (await page(memberCookie)).text()).toContain("Secret recipes");
    // A forged cookie or a revoked membership is refused.
    expect(await (await page(memberCookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).text()).not.toContain("Secret recipes");
    const [m] = (await store("GET", "members")).json.members;
    await store("POST", `members/${m.id}/revoke`, {});
    expect(await (await page(memberCookie)).text()).not.toContain("Secret recipes");
  });
});
