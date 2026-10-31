import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as crm from "@/app/api/v1/orgs/[orgId]/crm/[[...slug]]/route";
import * as api from "@/app/api/v1/orgs/[orgId]/hr/[[...slug]]/route";
import * as careers from "@/app/careers/[token]/route";
import { horecaPresence } from "@/server/hr/time";
import { acceptInvitation, createInvitation } from "@/server/services/orgs";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let managerC = "";
let staffC = "";
let orgId = "";
let ownerId = "";
const ids: Record<string, string> = {};
const h = (method: string, path: string, body?: unknown, cookie = owner) => call(api[method as "GET"], { method, cookie, body, path: `/api/v1/orgs/${orgId}/hr/${path}`, params: { orgId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const user = async (name: string, email: string) => {
  const c = cookieFrom(await call(signup.POST, { method: "POST", body: { name, email, password: "correct-horse-42" } }));
  return { cookie: c, id: (await call(me.GET, { cookie: c })).json.user.id as string };
};

beforeAll(async () => {
  await resetDb();
  const o = await user("Sana Owner", "sana.hr@example.com");
  owner = o.cookie;
  ownerId = o.id;
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  const m = await user("Meera Manager", "meera.hr@example.com");
  const st = await user("Arjun Staff", "arjun.hr@example.com");
  managerC = m.cookie;
  staffC = st.cookie;
  await db.insert(schema.memberships).values([
    { orgId, userId: m.id, role: "editor" },
    { orgId, userId: st.id, role: "employee" },
  ]);
});
afterAll(closeDb);

describe("HR & payroll", () => {
  it("sets up leave types on first use", async () => {
    const r = await h("GET", "meta");
    expect(r.status).toBe(200);
    expect(r.json.leaveTypes.map((t: { code: string }) => t.code)).toEqual(["CL", "SL", "EL", "LOP"]);
    expect(r.json.me).toMatchObject({ manage: true, payroll: true, employeeId: null });
  });

  it("adds people, links their accounts by email and starts onboarding", async () => {
    ids.dept = (await h("POST", "departments", { name: "Operations" })).json.department.id;
    ids.loc = (await h("POST", "locations", { name: "Mumbai HQ", state: "MH" })).json.location.id;
    const meera = await h("POST", "people", { name: "Meera Manager", email: "meera.hr@example.com", designation: "Ops Lead", departmentId: ids.dept, locationId: ids.loc, joinDate: "2024-04-01", ctc: 1500000_00 });
    expect(meera.status).toBe(200);
    ids.meera = meera.json.employee.id;
    expect(meera.json.employee.empNo).toBe("EMP001");
    expect(meera.json.employee.userId).toBeTruthy();
    const arjun = await h("POST", "people", { name: "Arjun Staff", email: "arjun.hr@example.com", designation: "Associate", departmentId: ids.dept, locationId: ids.loc, managerId: ids.meera, joinDate: "2026-01-01", ctc: 600000_00, gender: "male", bank: { name: "Arjun Staff", account: "50100123456789", ifsc: "HDFC0000123" }, ids: { pan: "ABCDE1234F" } });
    ids.arjun = arjun.json.employee.id;
    const view = (await h("GET", `people/${ids.arjun}`)).json;
    expect(view.checklists[0].kind).toBe("onboarding");
    expect(view.events[0].kind).toBe("joined");
    expect(view.structure.basic).toBe(25000_00);
    expect((await h("POST", "people", { name: "Dup", email: "ARJUN.hr@example.com", joinDate: "2026-01-01" })).status).toBe(409);
    // No loops in the reporting line.
    expect((await h("PUT", `people/${ids.meera}`, { managerId: ids.arjun })).status).toBe(422);
  });

  it("gives an Employee only their own HR — no projects, no CRM — and hides others' pay", async () => {
    expect((await call(orgProjects.GET, { cookie: staffC, params: { orgId } })).status).toBe(403);
    expect((await call(crm.GET, { cookie: staffC, params: { orgId, slug: ["meta"] }, path: `/api/v1/orgs/${orgId}/crm/meta` })).status).toBe(403);
    const m = (await h("GET", "meta", undefined, staffC)).json;
    expect(m.me).toMatchObject({ employeeId: ids.arjun, manage: false, payroll: false });
    expect(m.members).toEqual([]);
    const other = (await h("GET", `people/${ids.meera}`, undefined, staffC)).json;
    expect(other.limited).toBe(true);
    expect(other.employee.ctc).toBeUndefined();
    const self = (await h("GET", `people/${ids.arjun}`, undefined, staffC)).json;
    expect(self.employee.ctc).toBe(600000_00);
    expect((await h("PUT", `people/${ids.arjun}`, { ctc: 900000_00 }, staffC)).status).toBe(403);
    expect((await h("PUT", `people/${ids.arjun}`, { phone: "+91 98200 55555" }, staffC)).status).toBe(200);
    // The manager sees their report's profile but not the pay.
    const mgr = (await h("GET", `people/${ids.arjun}`, undefined, managerC)).json;
    expect(mgr.limited).toBe(false);
    expect(mgr.employee.ctc).toBeNull();
  });

  it("checks in and out, and lets managers mark attendance for their people", async () => {
    const i = await h("POST", "attendance/check-in", {}, staffC);
    expect(i.status).toBe(200);
    expect((await h("POST", "attendance/check-in", {}, staffC)).status).toBe(409);
    const o = await h("POST", "attendance/check-out", {}, staffC);
    expect(o.json.attendance.checkOut).toBeTruthy();
    expect((await h("POST", "attendance/mark", { employeeIds: [ids.meera], date: "2026-10-05", status: "absent" }, staffC)).status).toBe(403);
    expect((await h("POST", "attendance/mark", { employeeIds: [ids.arjun], date: "2026-10-06", status: "absent" }, managerC)).status).toBe(200);
    const sheet = (await h("GET", "attendance/month?month=2026-10", undefined, managerC)).json;
    const row = sheet.people.find((p: { id: string }) => p.id === ids.arjun);
    expect(row.cells[5]).toBe("A");
    expect(sheet.days[3].off).toBe(true); // Sunday 4 Oct
  });

  it("requests leave with balances, holidays and approvals", async () => {
    const types = (await h("GET", "meta")).json.leaveTypes;
    ids.cl = types.find((t: { code: string }) => t.code === "CL").id;
    ids.lop = types.find((t: { code: string }) => t.code === "LOP").id;
    await h("POST", "holidays", { date: "2026-11-09", name: "Diwali" });
    const r = await h("POST", "leave", { leaveTypeId: ids.cl, fromDate: "2026-11-09", toDate: "2026-11-10", reason: "Family" }, staffC);
    expect(r.status).toBe(200);
    expect(r.json.request.days).toBe(1); // the 9th is a holiday
    expect((await h("POST", "leave", { leaveTypeId: ids.cl, fromDate: "2026-11-10", toDate: "2026-11-10" }, staffC)).status).toBe(409);
    expect((await h("POST", "leave", { leaveTypeId: ids.cl, fromDate: "2026-12-01", toDate: "2026-12-31" }, staffC)).json.error.message).toMatch(/left/);
    expect((await h("POST", `leave/${r.json.request.id}/decide`, { approve: true }, staffC)).status).toBe(403);
    expect((await h("POST", `leave/${r.json.request.id}/decide`, { approve: true }, managerC)).status).toBe(200);
    const bal = (await h("GET", `people/${ids.arjun}/balances`, undefined, staffC)).json.balances;
    const cl = bal.find((b: { code: string }) => b.code === "CL");
    expect(cl.accrued).toBe(10); // a twelfth a month to October
    expect(cl.available).toBe(9);
    const unpaid = await h("POST", "leave", { leaveTypeId: ids.lop, fromDate: "2026-10-08", toDate: "2026-10-08" }, staffC);
    await h("POST", `leave/${unpaid.json.request.id}/decide`, { approve: true }, managerC);
  });

  it("runs payroll: loss of pay, claims, adjustments, finalise and the bank file", async () => {
    const claim = await h("POST", "claims", { category: "Travel", amount: 1200_00, date: "2026-10-12", description: "Client visit" }, staffC);
    await h("POST", `claims/${claim.json.claim.id}/decide`, { action: "approve" }, managerC);
    expect((await h("GET", "payroll", undefined, staffC)).status).toBe(403);
    // A September run doesn't take an October expense.
    const sep = await h("POST", "payroll", { month: "2026-09" });
    expect(sep.json.slips.find((p: { employeeId: string }) => p.employeeId === ids.arjun).data.reimbursements).toHaveLength(0);
    await h("DELETE", `payroll/${sep.json.run.id}`);
    const run = await h("POST", "payroll", { month: "2026-10" });
    expect(run.status).toBe(200);
    ids.run = run.json.run.id;
    const slip = run.json.slips.find((p: { employeeId: string }) => p.employeeId === ids.arjun);
    // Absent on the 6th, unpaid leave on the 8th, and today's check-in and out a second apart is a half day
    // (unless today is a Sunday, the weekly off, when a short day costs nothing).
    const sunday = new Date(Date.now() + 5.5 * 3_600_000).getUTCDay() === 0;
    expect(slip.data.days).toMatchObject(sunday ? { inMonth: 31, lop: 2, paid: 29 } : { inMonth: 31, lop: 2.5, paid: 28.5 });
    expect(slip.data.reimbursements[0]).toMatchObject({ label: "Travel claim", amount: 1200_00 });
    expect(slip.data.deductions.find((l: { code: string }) => l.code === "PT").amount).toBe(200_00);
    // A one-off bonus.
    const adj = await h("PUT", `payroll/${ids.run}/slips/${ids.arjun}`, { adjustments: [{ label: "Festival bonus", amount: 3000_00, kind: "earning" }] });
    const after = adj.json.slips.find((p: { employeeId: string }) => p.employeeId === ids.arjun);
    expect(after.gross).toBe(slip.gross + 3000_00);
    expect(after.data.reimbursements).toHaveLength(1); // the claim stays
    // Not visible to the person while it's a draft.
    expect((await h("GET", "payslips/mine", undefined, staffC)).json.payslips).toHaveLength(0);
    expect((await h("GET", `payroll/${ids.run}/bank`)).status).toBe(409);
    await h("POST", `payroll/${ids.run}/finalise`);
    const [c] = await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.id, claim.json.claim.id));
    expect(c.status).toBe("paid");
    const mine = (await h("GET", "payslips/mine", undefined, staffC)).json.payslips;
    expect(mine).toHaveLength(1);
    const ps = (await h("GET", `payslips/${mine[0].id}`, undefined, staffC)).json;
    expect(ps.employee).toMatchObject({ pan: "ABCDE1234F", account: "•••• 6789" });
    const bank = await h("GET", `payroll/${ids.run}/bank`);
    expect(bank.text).toContain("50100123456789");
    expect(bank.text).toContain(((after.net) / 100).toFixed(2));
    expect((await h("PUT", `payroll/${ids.run}/slips/${ids.arjun}`, { hold: true })).status).toBe(409);
    expect((await h("POST", "payroll", { month: "2026-10" })).status).toBe(409);
  });

  it("hires from the careers page", async () => {
    const job = (await h("POST", "jobs", { title: "Barista", departmentId: ids.dept, locationId: ids.loc, openings: 1, salaryRange: "₹2.4–3L" })).json.job;
    const { careersUrl } = (await h("GET", "jobs")).json;
    const token = careersUrl.split("/").pop();
    const page = await call(careers.GET, { params: { token } });
    expect(page.text).toContain("Barista");
    const form = new URLSearchParams({ jobId: job.id, name: "Ritu Barista", email: "ritu@coffee.in", phone: "9820099999" }).toString();
    const res = await careers.POST(new Request(`http://localhost:3000/careers/${token}`, { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost:3000" } }), { params: Promise.resolve({ token }) });
    expect(await res.text()).toContain("your application is in");
    const pipe = (await h("GET", `jobs/${job.id}`)).json;
    const ritu = pipe.columns.find((c: { stage: string }) => c.stage === "applied").candidates[0];
    expect(ritu.source).toBe("careers_page");
    await h("POST", `candidates/${ritu.id}/move`, { stage: "interview" });
    const hired = await h("POST", `candidates/${ritu.id}/hire`, { joinDate: "2026-11-02", ctc: 280000_00, managerId: ids.meera });
    expect(hired.json.employee).toMatchObject({ name: "Ritu Barista", designation: "Barista", managerId: ids.meera });
    expect((await h("GET", "jobs")).json.jobs[0].status).toBe("closed");
  });

  it("handles notice and exit with offboarding", async () => {
    const ritu = (await h("GET", "people?q=Ritu")).json.people[0];
    const ex = await h("POST", `people/${ritu.id}/exit`, { lastDay: "2026-12-31", reason: "Moving cities" });
    expect(ex.json.employee.status).toBe("notice");
    const v = (await h("GET", `people/${ritu.id}`)).json;
    expect(v.checklists.map((c: { kind: string }) => c.kind).sort()).toEqual(["offboarding", "onboarding"]);
    const item = v.checklists.find((c: { kind: string }) => c.kind === "offboarding").items[0];
    expect((await h("POST", `people/${ritu.id}/checklist`, { kind: "offboarding", itemId: item.id, done: true }, managerC)).status).toBe(200);
    expect((await h("POST", `people/${ritu.id}/checklist`, { kind: "offboarding", itemId: "x3", done: true }, managerC)).status).toBe(403); // an HR/IT item
    const letter = (await h("GET", `people/${ritu.id}/letter?template=relieving`)).json;
    expect(letter.text).toContain("Ritu Barista");
    expect(letter.text).toContain("31 December 2026");
  });

  it("runs a review cycle: self first, then the manager", async () => {
    await h("POST", "reviews", { cycle: "2026 H2" });
    const mine = (await h("GET", "reviews", undefined, staffC)).json.reviews.find((r: { employeeId: string }) => r.employeeId === ids.arjun);
    expect((await h("POST", `reviews/${mine.id}/submit`, { rating: 4, note: "Shipped the new process" }, managerC)).status).toBe(409);
    await h("POST", `reviews/${mine.id}/submit`, { rating: 4, note: "Shipped the new process" }, staffC);
    await h("POST", `reviews/${mine.id}/submit`, { rating: 5, note: "Excellent" }, managerC);
    const done = (await h("GET", "reviews", undefined, staffC)).json.reviews.find((r: { employeeId: string }) => r.employeeId === ids.arjun);
    expect(done).toMatchObject({ status: "done", selfRating: 4, managerRating: 5 });
    await h("POST", "goals", { employeeId: ids.arjun, title: "Cut order errors to under 1%", progress: 20 }, managerC);
    const g = (await h("GET", "goals", undefined, staffC)).json.goals[0];
    expect((await h("PUT", `goals/${g.id}`, { progress: 60 }, staffC)).status).toBe(200);
    expect((await h("PUT", `goals/${g.id}`, { title: "Something easier" }, staffC)).status).toBe(403);
  });

  it("counts a Horeca till unlock as attendance", async () => {
    const [p] = await db.insert(schema.projects).values({ orgId, name: "Café", slug: "cafe-hr", createdBy: ownerId }).returning();
    const [st] = await db.insert(schema.horecaStaff).values({ projectId: p.id, name: "Meera Manager", role: "manager", pinHash: "x" }).returning();
    await db.update(schema.hrEmployees).set({ horecaStaffId: st.id }).where(eq(schema.hrEmployees.id, ids.meera));
    await horecaPresence(p.id, st.id);
    const board = (await h("GET", "attendance/today")).json;
    expect(board.people.find((x: { id: string }) => x.id === ids.meera)).toMatchObject({ status: "in", source: "horeca" });
  });

  it("links someone invited as an Employee when they accept", async () => {
    const e = (await h("POST", "people", { name: "Kiran New", email: "kiran.new@example.com", joinDate: "2026-10-20" })).json.employee;
    expect(e.userId).toBeNull();
    const { token } = await createInvitation(orgId, { id: ownerId, role: "owner", name: "Sana" }, "kiran.new@example.com", "employee");
    const k = await user("Kiran New", "kiran.new@example.com");
    await acceptInvitation(token, { id: k.id, email: "kiran.new@example.com" });
    const [row] = await db.select().from(schema.hrEmployees).where(and(eq(schema.hrEmployees.id, e.id)));
    expect(row.userId).toBe(k.id);
  });

  it("reports headcount, attrition and payroll cost", async () => {
    const r = (await h("GET", "reports?year=2026")).json;
    expect(r.headcount).toBe(4);
    expect(r.byDepartment[0]).toMatchObject({ name: "Operations", count: 3 });
    expect(r.payroll[0]).toMatchObject({ month: "2026-10", employees: 2 });
    expect((await h("GET", "reports", undefined, staffC)).status).toBe(403);
    const home = (await h("GET", "home")).json;
    expect(home.stats.headcount).toBe(4);
    expect(home.stats.onNotice).toHaveLength(1);
  });
});
