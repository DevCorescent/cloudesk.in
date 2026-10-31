import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/custom/[[...slug]]/route";
import * as invApi from "@/app/api/v1/orgs/[orgId]/inventory/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Custom fields on items (checked, with rules on the item's own fields too),
// import by SKU, an object of the workspace's own linking back to items, bulk
// changes that skip what breaks a rule and can be undone, and deleting a
// field only on purpose.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const X = mk(api, "custom");
const I = mk(invApi, "inventory");
const E = "entity=inventory.item";

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Om Owner", email: "om.custom@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  for (const [who, role] of [["ed", "editor"], ["viewer", "viewer"]] as const) {
    C[who] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: `${who} person`, email: `${who}.custom@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${who}.custom@example.com`));
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  ids.a = (await I("POST", "items", { name: "Ceiling fan", sku: "FAN-1", category: "Electrical" })).json.item.id;
  ids.b = (await I("POST", "items", { name: "Wall clock", sku: "CLK-1", category: "Decor" })).json.item.id;
});
afterAll(closeDb);

describe("custom fields on items", () => {
  it("adds fields, refusing a built-in or repeated key", async () => {
    expect((await X("POST", `fields?${E}`, { key: "sku", label: "SKU again", type: "text" })).status).toBe(409);
    for (const f of [
      { key: "warranty_months", label: "Warranty (months)", type: "number" },
      { key: "grade", label: "Grade", type: "select", options: ["A", "B", "C"] },
      { key: "certified", label: "BIS certified", type: "checkbox" },
      { key: "spec_sheet", label: "Spec sheet", type: "url" },
    ]) expect((await X("POST", `fields?${E}`, f)).status).toBe(200);
    expect((await X("POST", `fields?${E}`, { key: "grade", label: "Grade 2", type: "text" })).status).toBe(409);
    expect((await X("POST", `fields?${E}`, { key: "kind", label: "Kind", type: "select" })).status).toBe(422);
    expect((await X("POST", `fields?${E}`, { key: "x", label: "X", type: "text" }, "ed")).status).toBe(403);
    expect((await X("GET", `fields?${E}`)).json.fields.map((f: { key: string }) => f.key)).toEqual(["warranty_months", "grade", "certified", "spec_sheet"]);
  });

  it("checks and cleans values; viewers can't change them", async () => {
    const r = await X("PUT", `values?${E}&id=${ids.a}`, { grade: "b", warranty_months: "24", certified: "yes" }, "ed");
    expect(r.status).toBe(200);
    expect(r.json.values).toEqual({ grade: "B", warranty_months: 24, certified: true });
    expect((await X("PUT", `values?${E}&id=${ids.a}`, { grade: "D" })).json.error.message).toMatch(/isn't one of A, B, C/);
    expect((await X("PUT", `values?${E}&id=${ids.a}`, { spec_sheet: "javascript:alert(1)" })).status).toBe(422);
    expect((await X("PUT", `values?${E}&id=${ids.a}`, { nope: 1 })).status).toBe(422);
    expect((await X("PUT", `values?${E}&id=${ids.a}`, { grade: "A" }, "viewer")).status).toBe(403);
    expect((await X("PUT", `values?${E}&id=00000000-0000-4000-8000-000000000000`, { grade: "A" })).status).toBe(404);
    // A partial save keeps the rest.
    expect((await X("PUT", `values?${E}&id=${ids.a}`, { warranty_months: 18 })).json.values).toMatchObject({ grade: "B", warranty_months: 18, certified: true });
  });

  it("refuses saves that break a rule — on custom and built-in fields", async () => {
    expect((await X("POST", `rules?${E}`, { name: "Grade A needs a year", when: [{ field: "grade", op: "eq", value: "A" }], then: [{ field: "warranty_months", op: "gte", value: 12 }], message: "Grade A items carry at least 12 months' warranty" })).status).toBe(200);
    expect((await X("POST", `rules?${E}`, { name: "Electricals certified", when: [{ field: "category", op: "eq", value: "Electrical" }], then: [{ field: "certified", op: "eq", value: true }], message: "Electrical items must be BIS certified" })).status).toBe(200);
    expect((await X("POST", `rules?${E}`, { name: "Bad", then: [{ field: "colour", op: "filled" }], message: "x" })).json.error.message).toMatch(/no field “colour”/);
    expect((await X("PUT", `values?${E}&id=${ids.b}`, { grade: "A", warranty_months: 6 })).json.error.message).toBe("Grade A items carry at least 12 months' warranty");
    expect((await X("PUT", `values?${E}&id=${ids.a}`, { certified: false })).json.error.message).toBe("Electrical items must be BIS certified");
    expect((await X("PUT", `values?${E}&id=${ids.b}`, { grade: "A", warranty_months: 12 })).status).toBe(200);
  });

  it("imports values by SKU and exports them", async () => {
    const r = (await X("POST", `values/import?${E}`, { rows: [{ __match: "CLK-1", spec_sheet: "https://example.com/clk.pdf" }, { __match: "NOPE-9", grade: "C" }, { __match: "FAN-1", grade: "A", warranty_months: 6 }], mode: "update" })).json;
    expect(r.updated).toBe(1);
    expect(r.errors.map((e: { message: string }) => e.message)).toEqual(["No item with SKU “NOPE-9”", "Grade A items carry at least 12 months' warranty"]);
    const list = (await X("GET", `records?${E}`)).json.records;
    expect(list.find((x: { match: string }) => x.match === "CLK-1").values.spec_sheet).toBe("https://example.com/clk.pdf");
  });
});

describe("an object of the workspace's own", () => {
  it("makes an object with fields, a title field and a link to items", async () => {
    const o = (await X("POST", "objects", { name: "Site visit", plural: "Site visits", prefix: "VIS" })).json.object;
    ids.o = o.id;
    const OE = `entity=obj:${o.id}`;
    for (const f of [
      { key: "site", label: "Site", type: "text", required: true },
      { key: "visited_on", label: "Visited on", type: "date" },
      { key: "item", label: "Item installed", type: "link", linkTo: "inventory.item" },
      { key: "outcome", label: "Outcome", type: "select", options: ["Done", "Revisit"] },
    ]) expect((await X("POST", `fields?${OE}`, f)).status).toBe(200);
    expect((await X("PUT", `objects/${o.id}`, { name: "Site visit", plural: "Site visits", prefix: "VIS", titleField: "item" })).status).toBe(422);
    expect((await X("PUT", `objects/${o.id}`, { name: "Site visit", plural: "Site visits", prefix: "VIS", titleField: "site" })).status).toBe(200);
    expect((await X("POST", "objects", { name: "Site visit", plural: "site visits" })).status).toBe(409);
    expect((await X("POST", `rules?${OE}`, { name: "Revisit needs a date", when: [{ field: "outcome", op: "eq", value: "Revisit" }], then: [{ field: "visited_on", op: "filled" }], message: "Say when the site was visited" })).status).toBe(200);
  });

  it("adds records numbered in order, with links checked and linked back", async () => {
    const R = (b: unknown, who = "ed") => X("POST", `objects/${ids.o}/records`, b, who);
    expect((await R({ visited_on: "2026-10-20" })).json.error.message).toBe("Site is needed");
    expect((await R({ site: "Baner", item: "00000000-0000-4000-8000-000000000000" })).json.error.message).toMatch(/isn't there/);
    expect((await R({ site: "Baner", outcome: "Revisit" })).json.error.message).toBe("Say when the site was visited");
    const r1 = (await R({ site: "Baner", item: ids.a, outcome: "Done", visited_on: "2026-10-20" })).json.record;
    const r2 = (await R({ site: "Aundh", item: ids.a, outcome: "Done" })).json.record;
    const r3 = (await R({ site: "Wakad", outcome: "Done" })).json.record;
    Object.assign(ids, { r1: r1.id, r2: r2.id, r3: r3.id });
    expect([r1.number, r2.number, r3.number]).toEqual(["VIS-0001", "VIS-0002", "VIS-0003"]);
    expect(r1.title).toBe("Baner");
    expect((await R({ site: "x" }, "viewer")).status).toBe(403);
    const d = (await X("GET", `objects/${ids.o}/records/${r1.id}`)).json;
    expect(d.titles[ids.a]).toBe("Ceiling fan");
    const v = (await X("GET", `values?${E}&id=${ids.a}`)).json;
    expect(v.backlinks.map((b: { title: string }) => b.title).sort()).toEqual(["Aundh", "Baner"]);
    expect((await X("GET", `lookup?entity=obj:${ids.o}&q=VIS-2`)).json.results[0].title).toBe("Aundh");
    expect((await X("GET", `objects/${ids.o}/records?q=wak`)).json.records.map((r: { title: string }) => r.title)).toEqual(["Wakad"]);
    // The object's own page counts its records (it used to show 0).
    expect((await X("GET", `objects/${ids.o}`)).json.object.count).toBe((await X("GET", `objects/${ids.o}/records`)).json.records.length);
  });

  it("imports records, linking items by name", async () => {
    const r = (await X("POST", `objects/${ids.o}/import`, { rows: [{ site: "Hinjewadi", item: "Wall clock", outcome: "Done" }, { site: "Kothrud", item: "Toaster" }, { site: "Baner", outcome: "Revisit", visited_on: "2026-10-21" }], mode: "update" })).json;
    expect(r).toMatchObject({ created: 1, updated: 1 });
    expect(r.errors[0].message).toBe("Item installed: no record called “Toaster”");
  });
});

describe("bulk changes", () => {
  it("sets a field on many items, skipping ones a rule refuses, and undoes it", async () => {
    // Fan is grade B (no rule), clock is grade A (needs 12 months).
    const r = (await X("POST", "bulk", { action: "set", entity: "inventory.item", ids: [ids.a, ids.b], field: "warranty_months", value: 3 }, "ed")).json;
    expect(r.changed).toBe(1);
    expect(r.skipped).toEqual([{ id: ids.b, reason: "Grade A items carry at least 12 months' warranty" }]);
    ids.run = r.id;
    expect((await X("GET", `values?${E}&id=${ids.a}`)).json.values.warranty_months).toBe(3);
    const [log] = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.action, "custom.bulk_set")));
    expect(log?.metadata).toMatchObject({ changed: 1, skipped: 1 });
    expect((await X("POST", `bulk/${ids.run}/undo`, undefined, "viewer")).status).toBe(403);
    expect((await X("POST", `bulk/${ids.run}/undo`, undefined, "ed")).json).toEqual({ restored: 1, left: [] });
    expect((await X("GET", `values?${E}&id=${ids.a}`)).json.values.warranty_months).toBe(18);
    expect((await X("POST", `bulk/${ids.run}/undo`)).status).toBe(409);
  });

  it("leaves records changed since alone when undoing", async () => {
    const r = (await X("POST", "bulk", { action: "set", entity: `obj:${ids.o}`, ids: [ids.r2, ids.r3], field: "outcome", value: "Revisit" })).json;
    // Both lack a visit date, so the rule keeps them as they are.
    expect(r.changed).toBe(0);
    const r2 = (await X("POST", "bulk", { action: "set", entity: `obj:${ids.o}`, ids: [ids.r2, ids.r3], field: "visited_on", value: "2026-10-22" })).json;
    expect(r2.changed).toBe(2);
    await X("PUT", `objects/${ids.o}/records/${ids.r3}`, { visited_on: "2026-10-23" });
    const u = (await X("POST", `bulk/${r2.id}/undo`)).json;
    expect(u).toEqual({ restored: 1, left: [{ id: ids.r3, reason: "Changed since" }] });
  });

  it("deletes records in bulk only when confirmed, and brings them back", async () => {
    const body = { action: "delete", entity: `obj:${ids.o}`, ids: [ids.r2, ids.r3], confirm: 1 };
    expect((await X("POST", "bulk", body)).status).toBe(422);
    expect((await X("POST", "bulk", { ...body, confirm: 2 }, "ed")).status).toBe(403);
    const r = (await X("POST", "bulk", { ...body, confirm: 2 })).json;
    expect(r.changed).toBe(2);
    expect((await X("GET", `objects/${ids.o}/records/${ids.r2}`)).status).toBe(404);
    expect((await X("POST", `bulk/${r.id}/undo`)).json).toEqual({ restored: 2, left: [] });
    expect((await X("GET", `objects/${ids.o}/records/${ids.r2}`)).json.record.number).toBe("VIS-0002");
    expect((await X("GET", "bulk")).json.runs.length).toBe(4);
  });
});

describe("changing and deleting fields", () => {
  it("won't change a field's type once it has values, or delete one a rule uses", async () => {
    const f = (await X("GET", `fields?${E}`)).json.fields as { id: string; key: string }[];
    const grade = f.find((x) => x.key === "grade")!;
    expect((await X("PUT", `fields/${grade.id}?${E}`, { key: "grade", label: "Grade", type: "text" })).status).toBe(409);
    expect((await X("PUT", `fields/${grade.id}?${E}`, { key: "grade", label: "Quality grade", type: "select", options: ["A", "B", "C", "D"] })).status).toBe(200);
    expect((await X("DELETE", `fields/${grade.id}?${E}&confirm=grade`)).json.error.message).toMatch(/Grade A needs a year/);
    const spec = f.find((x) => x.key === "spec_sheet")!;
    expect((await X("DELETE", `fields/${spec.id}?${E}&confirm=nope`)).status).toBe(422);
    expect((await X("DELETE", `fields/${spec.id}?${E}&confirm=spec_sheet`)).status).toBe(200);
    expect((await X("GET", `values?${E}&id=${ids.b}`)).json.values.spec_sheet).toBeUndefined();
  });

  it("won't delete an object other records link to, or one with records unless confirmed", async () => {
    const o = (await X("POST", "objects", { name: "Licence", plural: "Licences", prefix: "LIC" })).json.object;
    await X("POST", `fields?entity=obj:${ids.o}`, { key: "licence", label: "Licence", type: "link", linkTo: `obj:${o.id}` });
    expect((await X("DELETE", `objects/${o.id}`)).json.error.message).toMatch(/links to licences/);
    expect((await X("DELETE", `objects/${ids.o}`)).json.error.message).toMatch(/Type “Site visits”/);
    expect((await X("DELETE", `objects/${ids.o}?confirm=Site visits`)).status).toBe(200);
    expect(await db.select().from(schema.customRecords).where(eq(schema.customRecords.objectId, ids.o))).toEqual([]);
  });
});

describe("writes replayed from the offline outbox", () => {
  it("does a write once however often it's sent with the same Idempotency-Key", async () => {
    const o = (await X("POST", "objects", { name: "Sample", plural: "Samples", prefix: "SMP" })).json.object;
    await X("POST", `fields?entity=obj:${o.id}`, { key: "lot", label: "Lot", type: "text" });
    const send = (path: string, key: string) => call(api.POST as Parameters<typeof call>[0], { method: "POST", cookie: C.ed, body: { lot: "L-7" }, path: `/api/v1/orgs/${orgId}/custom/${path}`, params: { orgId, slug: seg(path) }, headers: { "idempotency-key": key } });
    const a = await send(`objects/${o.id}/records`, "offline-key-0001");
    const b = await send(`objects/${o.id}/records`, "offline-key-0001");
    expect(b.status).toBe(200);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(b.json.record.id).toBe(a.json.record.id);
    expect((await X("GET", `objects/${o.id}/records`)).json.records).toHaveLength(1);
    expect((await send(`objects/${o.id}/import`, "offline-key-0001")).status).toBe(409);
    expect((await send(`objects/${o.id}/records`, "bad key!")).status).toBe(422);
    // Another person's key is theirs alone.
    const c = await call(api.POST as Parameters<typeof call>[0], { method: "POST", cookie: C.owner, body: { lot: "L-8" }, path: `/api/v1/orgs/${orgId}/custom/objects/${o.id}/records`, params: { orgId, slug: ["objects", o.id, "records"] }, headers: { "idempotency-key": "offline-key-0001" } });
    expect(c.json.record.number).toBe("SMP-0002");
  });
});
