import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as hrApi from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { getSettings } from "@/server/hr/access";
import { noteOvertime, shiftFor } from "@/server/hr/plus";
import { overtimePay, structure } from "@/lib/hr/model";
import { call, cookieFrom, resetDb } from "../helpers";

// Shifts and the roster, overtime found at check-out and paid in payroll, a
// full and final settlement (gratuity, leave, notice) approved, paid and
// posted, documents expiring, mandatory training, grievance and disciplinary
// cases with who may see them, and the headcount plan.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const mk = (mod: Record<string, unknown>, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const H = mk(hrApi, "hr");
const A = mk(accApi, "accounts");

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Hema HR", email: "hema.hr@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  for (const [k, name, role] of [["asha", "Asha Nair", "employee"], ["ravi", "Ravi Rao", "employee"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email: `${k}.hrplus@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.hrplus@example.com`));
    U[k] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  const meta = (await H("GET", "meta")).json;
  ids.eng = (await H("POST", "departments", { name: "Engineering" })).json.department?.id ?? (await db.select().from(schema.hrDepartments).where(eq(schema.hrDepartments.orgId, orgId)))[0]?.id;
  ids.asha = (await H("POST", "people", { name: "Asha Nair", email: "asha.hrplus@example.com", designation: "Engineer", departmentId: ids.eng, joinDate: "2021-07-15", ctc: 1200000_00 })).json.employee.id;
  ids.ravi = (await H("POST", "people", { name: "Ravi Rao", email: "ravi.hrplus@example.com", designation: "Engineer", departmentId: ids.eng, joinDate: "2024-01-01", ctc: 600000_00 })).json.employee.id;
  await H("POST", `people/${ids.asha}/link`, { userId: U.asha });
  await H("POST", `people/${ids.ravi}/link`, { userId: U.ravi });
  await H("PUT", "settings", { ...meta.settings, overtime: { enabled: true, multiplier: 2, minMinutes: 30, requireApproval: true } });
});
afterAll(closeDb);

describe("shifts and overtime", () => {
  it("rosters a night shift, finds overtime at check-out, and pays it in payroll", async () => {
    const night = (await H("POST", "shifts", { name: "Night", start: "22:00", end: "06:00", breakMinutes: 30 })).json.shift;
    await H("POST", "roster", { entries: [{ employeeId: ids.asha, date: "2026-10-05", shiftId: night.id }, { employeeId: ids.asha, date: "2026-10-04", shiftId: null }] });
    expect((await H("POST", "roster", { entries: [{ employeeId: ids.ravi, date: "2026-10-05", shiftId: night.id }] }, "asha")).status).toBe(403);
    const st = await getSettings(orgId);
    expect(await shiftFor(orgId, ids.asha, "2026-10-05", st.settings)).toMatchObject({ start: "22:00", end: "06:00" });
    expect(await shiftFor(orgId, ids.asha, "2026-10-04", st.settings)).toBeNull();
    // 9 hours on a 7.5-hour shift: 90 minutes; 5 hours on a day off: all of it.
    expect((await noteOvertime(orgId, ids.asha, "2026-10-05", 540, st.settings))?.minutes).toBe(90);
    expect((await noteOvertime(orgId, ids.asha, "2026-10-04", 300, st.settings))?.minutes).toBe(300);
    expect(await noteOvertime(orgId, ids.asha, "2026-10-06", 500, st.settings)).toBeNull();
    const pending = (await H("GET", "overtime?status=pending")).json.overtime;
    expect(pending).toHaveLength(2);
    expect((await H("POST", `overtime/${pending[0].id}/decide`, { approve: true }, "ravi")).status).toBe(403);
    for (const o of pending) await H("POST", `overtime/${o.id}/decide`, { approve: o.minutes === 90 });
    const run = (await H("POST", "payroll", { month: "2026-10" })).json;
    const slip = run.payslips?.find((p: { employeeId: string }) => p.employeeId === ids.asha) ?? (await db.select().from(schema.hrPayslips).where(and(eq(schema.hrPayslips.employeeId, ids.asha))))[0];
    const basic = structure(1200000_00, { basicPct: 50, hraPct: 40, pf: true, pfOnFullBasic: false, esi: true }).basic;
    const ot = (slip.data as { earnings: { label: string; amount: number }[] }).earnings.find((l) => l.label.startsWith("Overtime"));
    expect(ot).toMatchObject({ label: "Overtime (1h 30m at 2×)", amount: overtimePay(90, basic, 8, 2) });
  });
});

describe("full and final settlement", () => {
  it("works out gratuity, leave and notice, and is approved, paid and posted", async () => {
    await H("POST", `people/${ids.asha}/exit`, { lastDay: "2026-10-31", noticeFrom: "2026-10-12", reason: "Moving city" });
    expect((await H("POST", "settlements", { employeeId: ids.ravi })).status).toBe(409);
    const d = (await H("POST", "settlements", { employeeId: ids.asha })).json;
    const codes = d.settlement.lines.map((l: { code: string }) => l.code);
    expect(codes).toEqual(expect.arrayContaining(["GRATUITY", "NOTICE"]));
    const basic = structure(1200000_00, { basicPct: 50, hraPct: 40, pf: true, pfOnFullBasic: false, esi: true }).basic;
    expect(d.settlement.lines.find((l: { code: string }) => l.code === "GRATUITY").amount).toBe(Math.round((basic / 26) * 15 * 5 / 100) * 100);
    // An advance to recover.
    const lines = [...d.settlement.lines, { code: "ADV", label: "Salary advance", kind: "recovery", amount: 10000_00, note: "" }];
    const ed = (await H("PUT", `settlements/${d.settlement.id}`, { lines })).json.settlement;
    expect(ed.recoveries).toBe(lines.filter((l: { kind: string }) => l.kind === "recovery").reduce((a: number, l: { amount: number }) => a + l.amount, 0));
    expect((await H("POST", `settlements/${d.settlement.id}/submit`, {})).json.status).toBe("approved");
    const bank = (await A("GET", "meta")).json.accounts.find((a: { systemKey: string }) => a.systemKey === "bank").id;
    await H("POST", `settlements/${d.settlement.id}/pay`, { accountId: bank, date: "2026-11-05" });
    await A("POST", "sync");
    const [j] = await db.select().from(schema.accJournals).where(and(eq(schema.accJournals.orgId, orgId), eq(schema.accJournals.sourceType, "settlement")));
    expect(j.total).toBe(ed.earnings);
  });
});

describe("documents, training, cases and the plan", () => {
  it("flags documents expiring and training not done", async () => {
    await H("POST", "documents", { employeeId: ids.ravi, kind: "visa", title: "Work permit", validTo: "2026-11-10" });
    await H("POST", "documents", { employeeId: ids.ravi, kind: "contract", title: "Contract", validTo: "2028-01-01" });
    expect((await H("GET", "documents?expiring=1")).json.documents.map((x: { title: string }) => x.title)).toEqual(["Work permit"]);
    expect((await H("GET", "documents", undefined, "ravi")).json.documents).toHaveLength(2);
    expect((await H("GET", "documents", undefined, "asha")).json.documents).toHaveLength(0);
    const t = (await H("POST", "trainings", { title: "Fire safety", kind: "safety", mandatory: true, validMonths: 12 })).json.training;
    expect((await H("GET", "trainings")).json.trainings[0]).toMatchObject({ required: 1, missing: 1 });
    await H("POST", `trainings/${t.id}/record`, { employeeIds: [ids.ravi], status: "completed", completedOn: "2026-10-01" });
    expect((await H("GET", "trainings")).json.trainings[0]).toMatchObject({ missing: 0, completed: 1 });
  });

  it("keeps grievances to the person and HR, and closes disciplinary cases with an outcome", async () => {
    const g = (await H("POST", "cases", { kind: "grievance", anonymous: true, category: "Harassment", subject: "Comments in meetings" }, "ravi")).json.case;
    expect(g.number).toBe("GR-0001");
    expect((await H("GET", "cases", undefined, "asha")).json.cases).toHaveLength(0);
    expect((await H("GET", "cases", undefined, "ravi")).json.cases[0]).toMatchObject({ name: null, employeeId: null });
    expect((await H("GET", "cases")).json.cases[0].name).toBe("Ravi Rao");
    expect((await H("PUT", `cases/${g.id}`, { status: "closed" }, "ravi")).status).toBe(403);
    expect((await H("POST", "cases", { kind: "disciplinary", employeeId: ids.ravi, subject: "Late on 6 days" }, "ravi")).status).toBe(403);
    const dc = (await H("POST", "cases", { kind: "disciplinary", employeeId: ids.ravi, subject: "Late on 6 days" })).json.case;
    expect((await H("PUT", `cases/${dc.id}`, { status: "closed" })).status).toBe(422);
    const closed = (await H("PUT", `cases/${dc.id}`, { status: "closed", action: "written_warning", outcome: "Written warning issued" })).json.case;
    expect(closed.timeline.at(-1).note).toMatch(/Status: closed · Action: written warning/);
  });

  it("compares the headcount plan with who's here, and opens hiring", async () => {
    const p = (await H("POST", "positions", { departmentId: ids.eng, title: "Engineer", planned: 3, budgetCtc: 900000_00 })).json.position;
    const w = (await H("GET", "workforce")).json;
    // Asha is serving her notice: two engineers, one leaving, so two places to fill.
    expect(w.positions[0]).toMatchObject({ filled: 2, leaving: 1, open: 2, plannedCtc: 3 * 900000_00 });
    const job = (await H("POST", `positions/${p.id}/hire`, {})).json.job;
    expect(job).toMatchObject({ title: "Engineer", openings: 3 });
  });
});
