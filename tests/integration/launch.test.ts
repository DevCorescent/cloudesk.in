import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as launchRoute from "@/app/api/v1/orgs/[orgId]/launch/route";
import * as setupRoute from "@/app/api/v1/projects/[projectId]/setup/route";
import * as siteServe from "@/app/sites/[deploymentId]/[[...path]]/route";
import { serializeSiteDoc } from "@/lib/site/model";
import { composeSite, planFromBrief } from "@/lib/site/planner";
import { analyse, parseDelimited } from "@/lib/store/import";
import { storeSiteDoc, storeTemplate } from "@/lib/store/templates";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let orgId = "";
type Ev = Record<string, unknown> & { step: string };
async function go(body: unknown, c = cookie) {
  const res = await launchRoute.POST(new Request(`${ORIGIN}/api/v1/orgs/${orgId}/launch`, { method: "POST", headers: { origin: ORIGIN, cookie: c, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgId }) });
  if (res.headers.get("content-type")?.includes("json") && !res.headers.get("content-type")?.includes("ndjson")) return { status: res.status, events: [] as Ev[], json: await res.json() };
  const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as Ev);
  return { status: res.status, events, json: null };
}

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Lia Launch", email: "lia@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
});
afterAll(closeDb);

const SHEET = `Product Name,Category,Size,MRP,Selling Price,Qty,Image URL,Description
Linen Kurta,Kurtas,M,2499,1899,5,https://images.unsplash.com/photo-1583391733956-6c78276477e2,Breathable handwoven linen kurta with a relaxed fit.
Linen Kurta,Kurtas,L,2499,1899,3,https://images.unsplash.com/photo-1583391733956-6c78276477e2,
Block Print Dupatta,Dupattas,,,,,,`;

describe("five-minute launch", () => {
  it("sets up bookings for a clinic website, hidden until the owner prices them", async () => {
    const doc = composeSite(planFromBrief("Smile Dental: dental clinic with appointments", { name: "Smile Dental" }), { personality: "corporate", seed: 0 });
    const r = await go({ kind: "website", name: "Smile Dental", tagline: "Dental clinic in Indiranagar", country: "IN", currency: "INR", doc: serializeSiteDoc(doc), bookings: true });
    expect(r.events.findLast((e) => e.step === "bookings")).toMatchObject({ status: "done" });
    const projectId = String(r.events.find((e) => e.step === "complete")!.projectId);
    const services = await db.select().from(schema.bookingServices).where(eq(schema.bookingServices.projectId, projectId));
    expect(services.length).toBeGreaterThan(0);
    expect(services.every((sv) => !sv.active && sv.price === 0)).toBe(true);
    const setup = (await call(setupRoute.GET, { cookie, params: { projectId } })).json;
    // Still a website: no product, payment or delivery chores.
    expect(setup.kind).toBe("website");
    expect(setup.items.map((i: { id: string }) => i.id)).toEqual(["publish", "design", "bookings", "domain"]);
    expect(setup.items.find((i: { id: string }) => i.id === "bookings").done).toBe(false);
  });

  it("adds the owner's domain and returns the exact DNS records to set", async () => {
    const doc = storeSiteDoc(storeTemplate("gifts")!, "Tea Leaf");
    const r = await go({ kind: "store", name: "Tea Leaf", country: "IN", currency: "INR", doc: serializeSiteDoc(doc), domain: "www.tealeaf.in" });
    const ev = r.events.find((e) => e.step === "domain" && e.status === "done") as Ev & { domain: { id: string; hostname: string; records: { type: string; name: string; value: string }[] } };
    expect(ev.domain.hostname).toBe("www.tealeaf.in");
    const [row] = await db.select().from(schema.siteDomains).where(eq(schema.siteDomains.hostname, "www.tealeaf.in"));
    expect(row.status).toBe("pending");
    expect(ev.domain.records[0]).toEqual({ type: "TXT", name: "_creationcloud.www.tealeaf.in", value: row.verificationToken, purpose: "Proves the domain is yours" });
    const projectId = String(r.events.find((e) => e.step === "complete")!.projectId);

    // A domain already used elsewhere doesn't stop the launch; it's reported plainly.
    const again = await go({ kind: "store", name: "Tea Leaf Two", country: "IN", currency: "INR", doc: serializeSiteDoc(doc), domain: "www.tealeaf.in" });
    expect(again.events.findLast((e) => e.step === "domain")).toMatchObject({ status: "skipped", detail: expect.stringContaining("connected to another site") });
    expect(again.events.find((e) => e.step === "complete")).toMatchObject({ liveUrl: expect.stringContaining("/s/"), problems: [expect.stringContaining("Domain:")] });

    // The dashboard checklist is worked out from real data.
    const setup = await call(setupRoute.GET, { cookie, params: { projectId } });
    const items = Object.fromEntries((setup.json.items as { id: string; done: boolean }[]).map((i) => [i.id, i.done]));
    expect(setup.json.kind).toBe("store");
    expect(items).toMatchObject({ publish: true, design: false, products: false, payments: true, domain: false });
    await db.update(schema.siteDomains).set({ status: "verified" }).where(eq(schema.siteDomains.id, row.id));
    expect((await call(setupRoute.GET, { cookie, params: { projectId } })).json.items.find((i: { id: string }) => i.id === "domain").done).toBe(true);
  });

  it("creates, fills and publishes a store in one go, streaming each step", async () => {
    const t = storeTemplate("fashion")!;
    const doc = storeSiteDoc(t, "Saanjh Studio");
    const { products } = analyse(parseDelimited(SHEET));
    const r = await go({ kind: "store", name: "Saanjh Studio", tagline: "Handwoven everyday wear", country: "IN", currency: "INR", doc: serializeSiteDoc(doc), products, payments: { cod: true, upiId: "saanjh@upi" } });
    expect(r.status).toBe(200);
    const steps = r.events.map((e) => `${e.step}:${e.status ?? ""}`);
    expect(steps).toEqual(expect.arrayContaining(["project:running", "project:done", "design:done", "store:done", "products:done", "payments:done", "publish:done"]));
    const done = r.events.find((e) => e.step === "complete")!;
    expect(done).toMatchObject({ imported: 2, drafts: 1, problems: [] });
    expect(String(done.liveUrl)).toMatch(/\/s\/[\w-]+\/saanjh-studio$/);

    const projectId = String(done.projectId);
    const prods = await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.projectId, projectId));
    expect(prods.map((p) => [p.title, p.status, p.isSample]).sort()).toEqual([["Block Print Dupatta", "draft", false], ["Linen Kurta", "active", false]]);
    const kurta = prods.find((p) => p.title === "Linen Kurta")!;
    const vars = await db.select().from(schema.storeVariants).where(eq(schema.storeVariants.productId, kurta.id));
    expect(vars.map((v) => [v.price, v.compareAt, v.stock]).sort()).toEqual([[189900, 249900, 3], [189900, 249900, 5]]);
    const cols = await db.select().from(schema.storeCollections).where(eq(schema.storeCollections.projectId, projectId));
    expect(cols.map((c) => c.title).sort()).toEqual(["Dupattas", "Kurtas"]);
    const pay = await db.select().from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.enabled, true)));
    expect(pay.map((p) => p.provider).sort()).toEqual(["cod", "manual"]);

    // The live shop shows the real product (and not the draft).
    const depId = String(done.deploymentId);
    const html = await (await siteServe.GET(new Request(`${ORIGIN}/sites/${depId}/shop`), { params: Promise.resolve({ deploymentId: depId, path: ["shop"] }) })).text();
    expect(html).toContain("Linen Kurta");
    expect(html).not.toContain("Block Print Dupatta");
  });

  it("launches a plain website, leaving out sample sections that would block publishing", async () => {
    const doc = composeSite(planFromBrief("A yoga studio in Goa with classes and retreats", { name: "Tide Yoga" }), { personality: "glass" });
    const hadExamples = doc.pages.some((p) => p.sections.some((s) => s.props._example));
    const r = await go({ kind: "website", name: "Tide Yoga", tagline: "Yoga by the sea", doc: serializeSiteDoc(doc) });
    const done = r.events.find((e) => e.step === "complete")!;
    expect(done.liveUrl).toBeTruthy();
    expect(r.events.some((e) => e.step === "store")).toBe(false);
    if (hadExamples) expect(String(r.events.find((e) => e.step === "design")?.detail)).toMatch(/left out \d+ sample section/);
  });

  it("refuses an invalid design and people outside the organisation", async () => {
    const bad = await go({ kind: "website", name: "X", doc: "{}" });
    expect(bad.events.at(-1)).toMatchObject({ step: "error", message: "The design couldn't be read" });
    const other = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Out Sider", email: "out@example.com", password: "correct-horse-42" } }));
    expect((await go({ kind: "website", name: "X", doc: "{}" }, other)).status).toBe(404);
  });
});
