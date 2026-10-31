import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as calc from "@/app/api/v1/orgs/[orgId]/calculator/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

const C: Record<string, string> = {};
const U: Record<string, string> = {};
let org = "";
let other = "";
const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
const H = (method: string, path: string, body?: unknown, who = "asha", o = org) => call((calc as unknown as Record<string, Parameters<typeof call>[0]>)[method]!, { method, cookie: C[who], body, path: `/api/v1/orgs/${o}/calculator/${path}`, params: { orgId: o, slug: seg(path) } });

beforeAll(async () => {
  await resetDb();
  for (const [k, email] of [["asha", "asha@calc.in"], ["ravi", "ravi@calc.in"], ["eve", "eve@other.in"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: k, email, password: "correct-horse-42" } }));
    const m = (await call(me.GET, { cookie: C[k] })).json;
    U[k] = m.user.id;
    if (k === "asha") org = m.organizations[0].id;
    if (k === "eve") other = m.organizations[0].id;
  }
  await db.insert(schema.memberships).values({ orgId: org, userId: U.ravi!, role: "editor" });
});
afterAll(closeDb);

describe("calculator history", () => {
  it("keeps typed calculations and formulas, newest first, pinned on top", async () => {
    const a = await H("POST", "history", { kind: "expr", input: "1,25,000 + 18%", result: "1,47,500", resultValue: 147500 });
    expect(a.status).toBe(200);
    await H("POST", "history", { kind: "formula", input: "emi", values: { principal: 1000000, rate: 9, months: 240 }, result: "Monthly EMI: ₹8,997.26", resultValue: 8997.26 });
    expect((await H("POST", "history", { kind: "formula", input: "not-a-formula", result: "x" })).status).toBe(422);
    await H("PATCH", `history/${a.json.entry.id}`, { pinned: true, note: "Quote for Mehta & Co" });
    const r = await H("GET", "history");
    expect(r.json.entries.map((e: { input: string }) => e.input)).toEqual(["1,25,000 + 18%", "emi"]);
    expect(r.json.entries[0]).toMatchObject({ pinned: true, note: "Quote for Mehta & Co", resultValue: 147500 });
    expect(r.json.counts).toEqual({ total: 2, pinned: 1 });
    expect((await H("GET", "history?q=mehta")).json.entries).toHaveLength(1);
    // Wildcards match literally: "_" isn't "any character".
    expect((await H("GET", "history?q=_")).json.entries).toHaveLength(0);
    expect((await H("GET", "history?q=%25")).json.entries).toHaveLength(1);
  });

  it("is private to each person, even in the same workspace", async () => {
    expect((await H("GET", "history", undefined, "ravi")).json.entries).toEqual([]);
    const mine = (await H("GET", "history")).json.entries[0].id;
    expect((await H("DELETE", `history/${mine}`, undefined, "ravi")).status).toBe(404);
    expect((await H("GET", "history", undefined, "eve")).status).toBe(404);
    expect((await H("GET", "history", undefined, "eve", other)).json.entries).toEqual([]);
  });

  it("clears all but pinned, and exports CSV safely", async () => {
    await H("POST", "history", { kind: "expr", input: "=1+1", result: "2", resultValue: 2, note: "@SUM(A1)" });
    const csv = await H("GET", "history/csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.text).toContain("'=1+1");
    expect(csv.text).toContain("'@SUM(A1)");
    expect((await H("DELETE", "history")).json.removed).toBe(2);
    expect((await H("GET", "history")).json.entries).toHaveLength(1);
    expect((await H("DELETE", "history?all=1")).json.removed).toBe(1);
    expect(await db.select().from(schema.calcHistory).where(eq(schema.calcHistory.userId, U.asha!))).toEqual([]);
  });
});
