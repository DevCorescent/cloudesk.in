import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as docPage from "@/app/doc/[token]/route";
import * as fileRoute from "@/app/f/[id]/route";
import * as books from "@/app/api/v1/finance/books/[[...slug]]/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as invRoute from "@/app/api/v1/projects/[projectId]/invoicing/[[...slug]]/route";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let owner = "";
let editor = "";
let viewer = "";
let outsider = "";
let orgId = "";
let bookId = "";
const B = (method: string, path: string, body?: unknown, c = owner) => call(books[method as "GET"], { method, cookie: c, body, path: `/api/v1/finance/books/${path}`, params: { slug: path.split("?")[0].split("/").filter(Boolean) } });
const today = new Date().toISOString().slice(0, 10);
const doc = (patch: Record<string, unknown> = {}) => ({ type: "invoice", client: { name: "Ravi Shah", email: "ravi@example.com", billing: { line1: "", line2: "", city: "Ahmedabad", state: "Gujarat", postalCode: "", country: "IN" } }, issueDate: today, currency: "INR", lines: [{ id: "a", name: "Consulting", quantity: 10, rate: 250000, taxBps: 1800 }], taxMode: "gst", ...patch });

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Meera Books", email: "meera@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  for (const [email, role] of [["ed@example.com", "editor"], ["vi@example.com", "viewer"]] as const) {
    const c = cookieFrom(await call(signup.POST, { method: "POST", body: { name: role, email, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
    if (role === "editor") editor = c;
    else viewer = c;
  }
  outsider = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Out Sider", email: "out@example.com", password: "correct-horse-42" } }));
});
afterAll(closeDb);

describe("standalone finance books", () => {
  it("are created per workspace, with no project", async () => {
    expect((await B("GET", `?orgId=${orgId}`)).json.books).toEqual([]);
    const r = await B("POST", "", { orgId, name: "Shah Consulting" });
    expect(r.status).toBe(201);
    bookId = r.json.book.id;
    const boot = await B("GET", bookId);
    expect(boot.json.scope).toEqual({ kind: "book", id: bookId, name: "Shah Consulting", canDelete: true });
    expect(boot.json.settings.business.name).toBe("Shah Consulting");
    expect(boot.json.templates.map((t: { name: string }) => t.name)).toEqual(["Classic"]);
    const projects = await db.select().from(schema.projects).where(eq(schema.projects.orgId, orgId));
    expect(projects).toHaveLength(0);
  });

  it("follow workspace roles and stay private to the workspace", async () => {
    expect((await B("GET", bookId, undefined, editor)).status).toBe(200);
    expect((await B("GET", bookId, undefined, editor)).json.scope.canDelete).toBe(false);
    expect((await B("GET", bookId, undefined, viewer)).status).toBe(403);
    expect((await B("GET", bookId, undefined, outsider)).status).toBe(404);
    expect((await B("GET", `?orgId=${orgId}`, undefined, outsider)).status).toBe(404);
    expect((await B("POST", "", { orgId, name: "Nope" }, viewer)).status).toBe(403);
  });

  it("do everything invoicing does: documents, numbering, sharing, payments, reports", async () => {
    const r = await B("POST", `${bookId}/documents`, { document: doc(), issue: true });
    expect(r.status).toBe(201);
    expect(r.json.document.number).toMatch(/^INV\/\d{4}-\d{2}\/0001$/);
    expect(r.json.document.total).toBe(2950000);
    const page = await docPage.GET(new Request(`${ORIGIN}/doc/${r.json.document.shareToken}`), { params: Promise.resolve({ token: r.json.document.shareToken }) });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Shah Consulting");
    await B("POST", `${bookId}/documents/${r.json.document.id}/payments`, { amount: 950000, method: "upi", paidOn: today });
    const rep = await B("GET", `${bookId}/reports?from=${today.slice(0, 4)}-01-01&to=${today}`);
    expect(rep.json.kpis).toMatchObject({ invoiced: 2950000, collected: 950000, outstanding: 2000000 });
    const list = (await B("GET", `?orgId=${orgId}`)).json.books;
    expect(list[0]).toMatchObject({ name: "Shah Consulting", documents: 1, outstanding: 2000000, currency: "INR" });
  });

  it("keep their own logo files, served publicly for client documents", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const f = new FormData();
    f.set("file", new File([png], "logo.png", { type: "image/png" }));
    const res = await books.POST(new Request(`${ORIGIN}/api/v1/finance/books/${bookId}/upload`, { method: "POST", body: f, headers: { cookie: owner, origin: ORIGIN } }), { params: Promise.resolve({ slug: [bookId, "upload"] }) });
    const { asset } = await res.json();
    expect(asset.url).toMatch(/^\/f\/[0-9a-f-]{36}$/);
    const served = await fileRoute.GET(new Request(`${ORIGIN}${asset.url}`), { params: Promise.resolve({ id: asset.url.slice(3) }) });
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("are separate from each other and from project books", async () => {
    const other = (await B("POST", "", { orgId, name: "Second Brand" })).json.book.id;
    expect((await B("POST", `${other}/documents`, { document: doc(), issue: true })).json.document.number).toMatch(/\/0001$/);
    const pid = (await call(orgProjects.POST, { method: "POST", cookie: owner, params: { orgId }, body: { templateId: "blank", name: "Site" } })).json.project.id;
    const P = (m: string, path: string, body?: unknown) => call(invRoute[m as "GET"], { method: m, cookie: owner, body, path: `/api/v1/projects/${pid}/invoicing/${path}`, params: { projectId: pid, slug: path.split("/").filter(Boolean) } });
    expect((await P("GET", "documents")).json.documents).toEqual([]);
    expect((await P("GET", "")).json.scope.kind).toBe("project");
    // A book's documents can't be reached through another book's address.
    const first = (await B("GET", `${bookId}/documents`)).json.documents[0];
    expect((await B("GET", `${other}/documents/${first.id}`)).status).toBe(404);
  });

  it("are renamed by editors but deleted only by owners/admins, taking everything with them", async () => {
    expect((await B("PUT", `${bookId}/book`, { name: "Shah & Co" }, editor)).json.book.name).toBe("Shah & Co");
    expect((await B("DELETE", `${bookId}/book`, undefined, editor)).status).toBe(403);
    const docs = (await B("GET", `${bookId}/documents`)).json.documents;
    expect((await B("DELETE", `${bookId}/book`)).status).toBe(200);
    expect((await B("GET", bookId)).status).toBe(404);
    expect(await db.select().from(schema.invoiceDocuments).where(eq(schema.invoiceDocuments.projectId, bookId))).toEqual([]);
    const page = await docPage.GET(new Request(`${ORIGIN}/doc/${docs[0].shareToken}`), { params: Promise.resolve({ token: docs[0].shareToken }) });
    expect(page.status).toBe(404);
  });
});

describe("store sales in Finance", () => {
  it("a book can link one of the workspace's stores and see its paid sales beside invoices", async () => {
    const book = (await B("POST", "", { orgId, name: "All income" })).json.book.id;
    const pid = (await call(orgProjects.POST, { method: "POST", cookie: owner, params: { orgId }, body: { templateId: "blank", name: "Shop" } })).json.project.id;
    // No store yet: nothing to link.
    expect((await B("GET", `${book}/store-link`)).json.choices).toEqual([]);
    expect((await B("GET", `${book}/reports`)).json.store).toBeNull();
    await db.insert(schema.stores).values({ projectId: pid, name: "Shop", currency: "INR", country: "IN", region: "Gujarat" } as typeof schema.stores.$inferInsert);
    const order = (n: number, total: number, extra: Partial<typeof schema.storeOrders.$inferInsert>) =>
      db.insert(schema.storeOrders).values({ projectId: pid, number: n, accessKeyHash: `k${n}`, email: "x@example.com", shippingAddress: {}, subtotal: total, total, taxTotal: Math.round((total * 18) / 118), currency: "INR", taxIncluded: true, paymentMethod: "cod", paidAt: new Date(), financialStatus: "paid", ...extra } as typeof schema.storeOrders.$inferInsert);
    await order(1, 118000, { channel: "online" });
    await order(2, 59000, { channel: "pos", refundedTotal: 9000 });
    await order(3, 50000, { channel: "online", cancelledAt: new Date() }); // cancelled: not income
    await order(4, 70000, { channel: "online", paidAt: null, financialStatus: "pending" }); // unpaid: not income
    expect((await B("GET", `${book}/store-link`)).json.choices.map((c: { name: string }) => c.name)).toEqual(["Shop"]);
    expect((await B("PUT", `${book}/store-link`, { projectId: pid })).status).toBe(200);
    const st = (await B("GET", `${book}/reports`)).json.store;
    expect(st).toMatchObject({ name: "Shop", gross: 177000, refunds: 9000, net: 168000, orders: 2, online: { orders: 1, net: 118000 }, counter: { orders: 1, net: 50000 } });
    // A store outside the workspace can't be linked.
    expect((await B("PUT", `${book}/store-link`, { projectId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    // A project's own invoicing always includes its store.
    const P = (path: string) => call(invRoute.GET, { method: "GET", cookie: owner, path: `/api/v1/projects/${pid}/invoicing/${path}`, params: { projectId: pid, slug: path.split("?")[0].split("/").filter(Boolean) } });
    expect((await P("reports")).json.store.net).toBe(168000);
  });
});
