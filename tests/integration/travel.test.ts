import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as hrApi from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import * as workApi from "@/app/api/v1/orgs/[orgId]/work/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// The expense policy on claims, mileage and per diem, a trip approved with an
// advance and settled against its claims, company-card statements explained
// or marked personal and repaid, claims landing on a project, and the
// journals all of it posts.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const H = mk(hrApi, "hr");
const A = mk(accApi, "accounts");
const W = mk(workApi, "work");
const journal = async (sourceType: string, sourceId: string) => {
  const [j] = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, sourceType), eq(schema.accJournals.sourceId, sourceId)));
  if (!j) return null;
  const lines = await db.select({ debit: schema.accLines.debit, credit: schema.accLines.credit, key: schema.accAccounts.systemKey }).from(schema.accLines).innerJoin(schema.accAccounts, eq(schema.accAccounts.id, schema.accLines.accountId)).where(eq(schema.accLines.journalId, j.id));
  return Object.fromEntries(lines.map((l) => [l.key, Number(l.debit) - Number(l.credit)]));
};

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Hema HR", email: "hema.travel@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.asha = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Asha Nair", email: "asha.travel@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "asha.travel@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  ids.asha = (await H("POST", "people", { name: "Asha Nair", email: "asha.travel@example.com", designation: "Consultant", joinDate: "2024-01-01", ctc: 900000_00 })).json.employee.id;
  await H("POST", `people/${ids.asha}/link`, { userId: u.id });
  const meta = (await H("GET", "meta")).json;
  await H("PUT", "settings", { ...meta.settings, expenses: { limits: [{ category: "Food", perClaim: 1500_00, perDay: 0, receiptAbove: 500_00 }], mileage: { car: 12_00, bike: 0 }, perDiem: { domestic: 1000_00, international: 0 }, blockOverLimit: false, tripPrefix: "TR-" } });
  ids.bank = (await A("GET", "meta")).json.accounts.find((a: { systemKey: string }) => a.systemKey === "bank").id;
  ids.project = (await W("POST", "projects", { name: "Client rollout", billing: "fixed", fee: 100000_00 })).json.project.id;
});
afterAll(closeDb);

describe("claims and the policy", () => {
  it("asks for a reason over the limit, works out mileage, and pays it in payroll", async () => {
    const over = await H("POST", "claims", { category: "Food", amount: 1800_00, date: "2026-10-03", receiptUrl: "https://r.example/1" }, "asha");
    expect(over.status).toBe(422);
    expect(over.json.error.message).toMatch(/₹300 over the ₹1,500 limit for Food/);
    const ok = (await H("POST", "claims", { category: "Food", amount: 1800_00, date: "2026-10-03", receiptUrl: "https://r.example/1", justification: "Team dinner with the client" }, "asha")).json.claim;
    expect(ok.flags.map((f: { code: string }) => f.code)).toEqual(["over_limit"]);
    expect((await H("POST", "claims", { kind: "mileage", km: 10, vehicle: "bike", date: "2026-10-03" }, "asha")).status).toBe(422);
    const mileage = (await H("POST", "claims", { kind: "mileage", km: 42.5, vehicle: "car", date: "2026-10-04", description: "Office to client" }, "asha")).json.claim;
    expect(mileage).toMatchObject({ category: "Mileage", amount: 510_00 });
    for (const c of [ok, mileage]) await H("POST", `claims/${c.id}/decide`, { action: "approve" });
    await H("POST", "payroll", { month: "2026-10" });
    const rows = await db.select().from(schema.hrClaims).where(inArray(schema.hrClaims.id, [ok.id, mileage.id]));
    expect(rows.every((r) => r.payrollRunId)).toBe(true);
  });
});

describe("trips", () => {
  it("approves a trip, pays the advance, and settles it against the claims", async () => {
    const t = (await H("POST", "trips", { purpose: "Client workshop", destination: "Pune", departOn: "2026-10-05", returnOn: "2026-10-07", mode: "Train", estimate: 15000_00, advance: 10000_00, projectId: ids.project }, "asha")).json.trip;
    expect(t.number).toBe("TR-0001");
    ids.trip = t.id;
    expect((await H("POST", "claims", { category: "Lodging", amount: 4000_00, date: "2026-10-05", tripId: t.id }, "asha")).status).toBe(409);
    await H("POST", `trips/${t.id}/submit`, {}, "asha");
    expect((await H("POST", `trips/${t.id}/decide`, { approve: true }, "asha")).status).toBe(403);
    expect((await H("POST", `trips/${t.id}/decide`, { approve: true })).json.status).toBe("approved");
    expect((await H("POST", `trips/${t.id}/advance`, { accountId: ids.bank, date: "2026-10-04" }, "asha")).status).toBe(403);
    await H("POST", `trips/${t.id}/advance`, { accountId: ids.bank, date: "2026-10-04" });

    const lodging = (await H("POST", "claims", { category: "Lodging", amount: 4000_00, date: "2026-10-05", tripId: t.id, billable: true }, "asha")).json.claim;
    expect(lodging.projectId).toBe(ids.project);
    const pd = (await H("POST", `trips/${t.id}/per-diem`, {}, "asha")).json.claim;
    expect(pd).toMatchObject({ category: "Per diem", amount: 3000_00 });
    expect((await H("POST", `trips/${t.id}/per-diem`, {}, "asha")).status).toBe(409);
    expect((await H("POST", `trips/${t.id}/settle`, { accountId: ids.bank, date: "2026-10-10" })).status).toBe(409);
    for (const c of [lodging, pd]) await H("POST", `claims/${c.id}/decide`, { action: "approve" });
    // Trip claims aren't paid in payroll or on their own.
    expect((await H("POST", `claims/${lodging.id}/decide`, { action: "paid" })).status).toBe(409);
    const d = (await H("GET", `trips/${t.id}`, undefined, "asha")).json;
    expect(d.balance).toMatchObject({ claimed: 7000_00, advance: 10000_00, net: -3000_00, waiting: 0 });
    expect((await H("POST", `trips/${t.id}/settle`, { date: "2026-10-10" })).status).toBe(422);
    expect((await H("POST", `trips/${t.id}/settle`, { accountId: ids.bank, date: "2026-10-10" })).json.net).toBe(-3000_00);
    expect((await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.tripId, t.id))).map((c) => c.status)).toEqual(["paid", "paid"]);
    // Lodging is on the project, billable at cost.
    const ex = (await W("GET", `projects/${ids.project}/expenses`)).json.expenses;
    expect(ex.map((e: { category: string; billable: boolean; amount: number }) => [e.category, e.billable, e.amount])).toEqual(expect.arrayContaining([["Lodging", true, 4000_00], ["Per diem", false, 3000_00]]));

    await A("POST", "sync");
    expect(await journal("travel_advance", t.id)).toEqual({ staff_advances: 10000_00, bank: -10000_00 });
    expect(await journal("trip_settlement", t.id)).toEqual({ reimbursements: 7000_00, staff_advances: -10000_00, bank: 3000_00 });
  });
});

describe("company cards", () => {
  it("imports a statement once, and posts what's explained, personal and repaid", async () => {
    ids.card = (await H("POST", "cards", { employeeId: ids.asha, name: "HDFC Corporate", last4: "4321" })).json.card.id;
    expect((await H("POST", "cards", { employeeId: ids.asha, name: "Again", last4: "4321" })).status).toBe(409);
    const rows = [
      { date: "2026-10-12", amount: 2400_00, merchant: "IndiGo 6E-512", card: "XXXX XXXX XXXX 4321", reference: "A1" },
      { date: "2026-10-13", amount: 650_00, merchant: "Amazon personal", card: "4321", reference: "A2" },
      { date: "2026-10-13", amount: 900_00, merchant: "Cafe", card: "4321", reference: "A3" },
      { date: "2026-10-14", amount: 10_00, merchant: "Other", card: "9999", reference: "A4" },
    ];
    const imp = (await H("POST", "card-txns-import", { rows, mode: "add" })).json;
    expect(imp).toMatchObject({ created: 3, errors: [expect.objectContaining({ message: "No card ending 9999 is set up" })] });
    expect((await H("POST", "card-txns-import", { rows: rows.slice(0, 1), mode: "add" })).json).toMatchObject({ created: 0, skipped: 1 });

    const txns = (await H("GET", "card-txns?mine=1", undefined, "asha")).json.txns;
    const by = (m: string) => txns.find((x: { merchant: string }) => x.merchant === m);
    const claim = (await H("POST", `card-txns/${by("IndiGo 6E-512").id}/explain`, { category: "Travel", description: "Flight to Pune", projectId: ids.project, billable: true }, "asha")).json.claim;
    expect(claim).toMatchObject({ paidBy: "company", amount: 2400_00, status: "pending" });
    await H("POST", `card-txns/${by("Amazon personal").id}/personal`, {}, "asha");
    // A rejected explanation goes back to be explained again.
    const cafe = (await H("POST", `card-txns/${by("Cafe").id}/explain`, { category: "Food", receiptUrl: "https://r.example/2" }, "asha")).json.claim;
    await H("POST", `claims/${cafe.id}/decide`, { action: "reject", note: "Personal" });
    expect((await db.select().from(schema.hrCardTxns).where(eq(schema.hrCardTxns.id, by("Cafe").id)))[0]).toMatchObject({ status: "open", claimId: null });

    await H("POST", `claims/${claim.id}/decide`, { action: "approve" });
    expect((await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.id, claim.id)))[0].status).toBe("paid");
    expect((await H("POST", `card-txns/${by("Amazon personal").id}/repaid`, { accountId: ids.bank, date: "2026-10-20" }, "asha")).status).toBe(403);
    await H("POST", `card-txns/${by("Amazon personal").id}/repaid`, { accountId: ids.bank, date: "2026-10-20" });

    await A("POST", "sync");
    expect(await journal("card_spend", claim.id)).toEqual({ reimbursements: 2400_00, card_payable: -2400_00 });
    expect(await journal("card_personal", by("Amazon personal").id)).toEqual({ staff_advances: 650_00, card_payable: -650_00 });
    expect(await journal("card_repaid", by("Amazon personal").id)).toEqual({ bank: 650_00, staff_advances: -650_00 });
    // A company-card claim is never paid to the employee.
    const run = await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.id, claim.id));
    expect(run[0].payrollRunId).toBeNull();
    expect((await H("GET", "travel")).json).toMatchObject({ toExplain: 1, personalOwed: 0, advancesOut: 0 });
  });
});
