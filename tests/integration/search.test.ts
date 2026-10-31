import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/search/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Smart search: records across modules, each behind its own module switch and
// permission, closest matches first; and whether AI answers are available.
let orgId = "";
const C: Record<string, string> = {};
const S = (q: string, who = "owner") => call(api.GET, { cookie: C[who], path: `/api/v1/orgs/${orgId}/search?${q}`, params: { orgId } });
const kinds = (r: { json: { results: { kind: string }[] } }) => r.json.results.map((x) => x.kind);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Sana Search", email: "sana.search@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik View", email: "vik.search@example.com", password: "correct-horse-42" } }));
  const [v] = await db.select().from(schema.users).where(eq(schema.users.email, "vik.search@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: v!.id, role: "viewer" });
  await db.insert(schema.crmContacts).values({ orgId, name: "Meera Kapoor", email: "meera@kapoor.in" } as never);
  await db.insert(schema.invItems).values({ orgId, name: "Masala chai 250g", sku: "CHAI-250" } as never);
  await db.insert(schema.hdTickets).values({ orgId, number: "HD-0042", subject: "Chai order arrived late", customerName: "Meera Kapoor", status: "open" } as never);
  const [book] = await db.insert(schema.financeBooks).values({ orgId, name: "Main" } as never).returning();
  await db.insert(schema.invoiceOwners).values({ id: book!.id, bookId: book!.id });
  await db.insert(schema.invoiceDocuments).values({ projectId: book!.id, type: "invoice", number: "INV-2026-0007", status: "sent", client: { name: "Meera Kapoor" }, issueDate: "2026-10-01", currency: "INR", lines: [], adjustments: [], taxMode: "none", total: 12_500_00, shareToken: "tok-s1" } as never);
});
afterAll(closeDb);

describe("smart search", () => {
  it("finds records across modules, with links that open them", async () => {
    const r = await S("q=meera");
    expect(r.status).toBe(200);
    expect(kinds(r)).toEqual(expect.arrayContaining(["contacts", "tickets", "invoices"]));
    const inv = r.json.results.find((x: { kind: string }) => x.kind === "invoices");
    expect(inv.label).toBe("INV-2026-0007 · Meera Kapoor");
    expect(inv.link).toMatch(/^\/finance\/[0-9a-f-]+\/invoices\/[0-9a-f-]+$/);
    expect(kinds(await S("q=chai-250"))).toEqual(["items"]);
    expect(kinds(await S("q=HD-0042"))).toEqual(["tickets"]);
  });

  it("puts exact and starting matches first", async () => {
    const r = (await S("q=chai")).json.results;
    expect(r[0].label.toLowerCase().startsWith("chai") || r[0].label.toLowerCase().startsWith("masala")).toBe(true);
  });

  it("shows only what a role may open", async () => {
    const r = await S("q=meera", "viewer");
    expect(kinds(r)).not.toContain("invoices");
    expect(kinds(r)).toContain("contacts");
  });

  it("leaves out switched-off modules and ignores one-letter searches", async () => {
    await db.update(schema.organizations).set({ modules: ["invoicing"] }).where(eq(schema.organizations.id, orgId));
    expect(kinds(await S("q=meera"))).toEqual(["invoices"]);
    await db.update(schema.organizations).set({ modules: null }).where(eq(schema.organizations.id, orgId));
    expect((await S("q=m")).json.results).toEqual([]);
    // Wildcards are searched for literally.
    expect((await S("q=%25%25")).json.results).toEqual([]);
  });

  it("says whether AI answers are available, and what's missing", async () => {
    const a = (await S("ai=1")).json.ai;
    expect(a).toMatchObject({ module: true, allowed: true, canEnable: true, canConnect: true });
    expect(typeof a.connected).toBe("boolean");
    await db.update(schema.organizations).set({ modules: ["invoicing"] }).where(eq(schema.organizations.id, orgId));
    expect((await S("ai=1")).json.ai.module).toBe(false);
    expect((await S("ai=1", "viewer")).json.ai).toMatchObject({ canEnable: false, canConnect: false });
    await db.update(schema.organizations).set({ modules: null }).where(eq(schema.organizations.id, orgId));
  });
});
