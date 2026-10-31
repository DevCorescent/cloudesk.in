import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/education/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { remind } from "@/server/education/core";
import { call, cookieFrom, resetDb } from "../helpers";

// A class and students (one with a sibling concession), a fee plan raised in
// three instalments (again only adds what's new), part and full payments with
// receipts, a waiver, dues and reminders to guardians, attendance, exam marks
// and report cards, importing students — and the fees in the books.
let orgId = "";
const C: Record<string, string> = {};
const ids: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const E = mk(api, "education");
const A = mk(accApi, "accounts");
const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Sunita School", email: "sunita.edu@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  C.teacher = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Tarun Teacher", email: "tarun.edu@example.com", password: "correct-horse-42" } }));
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "tarun.edu@example.com"));
  await db.insert(schema.memberships).values({ orgId, userId: u.id, role: "editor" });
  await E("GET", "meta");
  ids.cls = (await E("POST", "classes", { name: "Class 5", section: "A", year: "2026-27", teacherId: u.id })).json.class.id;
  ids.asha = (await E("POST", "students", { name: "Asha Rao", classId: ids.cls, rollNo: 1, guardianName: "Ravi Rao", guardianEmail: "ravi.rao@example.com" })).json.student.id;
  ids.ved = (await E("POST", "students", { name: "Ved Rao", classId: ids.cls, rollNo: 2, guardianEmail: "ravi.rao@example.com", concessionPct: 25, concessionNote: "Sibling" })).json.student.id;
});
afterAll(closeDb);

describe("students and fees", () => {
  it("numbers admissions, and only managers give concessions", async () => {
    const [a] = await db.select().from(schema.eduStudents).where(eq(schema.eduStudents.id, ids.asha));
    expect(a.admissionNo).toBe("ADM-0001");
    expect((await E("POST", "students", { name: "X", concessionPct: 50 }, "teacher")).status).toBe(403);
    expect((await E("POST", "students", { name: "Dup", admissionNo: "adm-0001" })).status).toBe(409);
  });

  it("raises a plan in instalments with the concession, and again only adds new students", async () => {
    const plan = (await E("POST", "plans", { name: "Annual 2026-27", year: "2026-27", classIds: [ids.cls], heads: [{ name: "Tuition", amount: 60000_00 }, { name: "Transport", amount: 12000_00, concession: false }], installments: [{ label: "Term 1", dueDate: addDays(-5), pct: 40 }, { label: "Term 2", dueDate: addDays(2), pct: 30 }, { label: "Term 3", dueDate: addDays(120), pct: 30 }] })).json.plan;
    ids.plan = plan.id;
    const r = (await E("POST", `plans/${plan.id}/raise`)).json;
    expect(r).toMatchObject({ raised: 6, students: 2, total: 72000_00 + 57000_00 });
    expect((await E("POST", `plans/${plan.id}/raise`)).json.raised).toBe(0);
    ids.kiran = (await E("POST", "students", { name: "Kiran", classId: ids.cls, rollNo: 3 })).json.student.id;
    expect((await E("POST", `plans/${plan.id}/raise`)).json).toMatchObject({ raised: 3, total: 72000_00 });
    expect((await E("PUT", `plans/${plan.id}`, { name: "x", year: "2026-27", classIds: [ids.cls], heads: [{ name: "T", amount: 1 }], installments: [{ label: "A", dueDate: today, pct: 100 }] })).status).toBe(409);
    const ved = (await E("GET", `students/${ids.ved}`)).json;
    expect(ved.fees.map((f: { label: string; amount: number }) => [f.label, f.amount])).toEqual([["Term 1", 22800_00], ["Term 2", 17100_00], ["Term 3", 17100_00]]);
  });

  it("takes part and full payments with receipts, refuses overpaying, and waives", async () => {
    const fees = (await E("GET", `students/${ids.asha}`)).json.fees;
    const t1 = fees[0];
    const p1 = (await E("POST", `fees/${t1.id}/payments`, { amount: 10000_00, method: "upi", paidOn: today, reference: "UPI-1" }, "teacher")).json.payment;
    expect(p1.receiptNo).toBe("RCT-00001");
    expect((await E("POST", `fees/${t1.id}/payments`, { amount: 30000_00, method: "cash", paidOn: today })).status).toBe(422);
    await E("POST", `fees/${t1.id}/payments`, { amount: 18800_00, method: "cash", paidOn: today });
    expect((await db.select().from(schema.eduFees).where(eq(schema.eduFees.id, t1.id)))[0].status).toBe("paid");
    expect((await E("POST", `fees/${fees[2].id}/waive`, { reason: "Scholarship" }, "teacher")).status).toBe(403);
    await E("POST", `fees/${fees[2].id}/waive`, { reason: "Scholarship" });
    const d = (await E("GET", "fees")).json;
    expect(d.fees.find((f: { id: string }) => f.id === t1.id)).toBeUndefined();
    expect(d.overdue).toBe(22800_00 + 28800_00);
    expect((await E("GET", "collections")).json).toMatchObject({ total: 28800_00, byMethod: { upi: 10000_00, cash: 18800_00 } });
    // Each student's dues in the list come from their own fees.
    const list = (await E("GET", "students")).json.students;
    expect(list.find((x: { id: string }) => x.id === ids.asha).due).toBe(21600_00);
    expect(list.find((x: { id: string }) => x.id === ids.ved)).toMatchObject({ due: 57000_00, overdue: 22800_00 });
  });

  it("reminds guardians about fees due soon or overdue, at most weekly", async () => {
    const n = await remind();
    expect(n).toBe(3);
    const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "ravi.rao@example.com"));
    // Asha's Term 1 is paid and her Term 3 waived; Kiran has no guardian email.
    expect(mails.map((m) => m.subject).sort()).toEqual(["Due: Term 2 fee for Asha Rao", "Due: Term 2 fee for Ved Rao", "Overdue: Term 1 fee for Ved Rao"]);
    expect(await remind()).toBe(0);
  });

  it("puts fees and payments in the books", async () => {
    await A("GET", "meta");
    await A("POST", "sync");
    const js = await db.select().from(schema.accJournals).where(eq(schema.accJournals.orgId, orgId));
    const by = (t: string) => js.filter((j) => j.sourceType === t).map((j) => Number(j.total)).sort((a, b) => a - b);
    expect(by("fee").length).toBe(8);
    expect(by("fee_payment")).toEqual([10000_00, 18800_00]);
    const acc = (await A("GET", "meta")).json.accounts.find((a: { code: string }) => a.code === "4040");
    expect(acc.name).toBe("Fee income");
  });
});

describe("attendance and exams", () => {
  it("marks attendance by class and day, and works out the month", async () => {
    expect((await E("POST", `attendance/${ids.cls}`, { date: addDays(1), marks: [{ studentId: ids.asha, status: "present" }] }, "teacher")).status).toBe(422);
    await E("POST", `attendance/${ids.cls}`, { date: today, marks: [{ studentId: ids.asha, status: "present" }, { studentId: ids.ved, status: "absent" }, { studentId: ids.kiran, status: "leave" }] }, "teacher");
    await E("POST", `attendance/${ids.cls}`, { date: today, marks: [{ studentId: ids.ved, status: "late" }] }, "teacher");
    const day = (await E("GET", `attendance/${ids.cls}?date=${today}`)).json;
    expect(day.students.map((x: { status: string }) => x.status)).toEqual(["present", "late", "leave"]);
    const month = (await E("GET", `attendance/${ids.cls}?month=${today.slice(0, 7)}`)).json;
    expect(month.students.map((x: { pct: number | null }) => x.pct)).toEqual([100, 100, null]);
    expect((await E("GET", "home")).json.today).toEqual({ marked: 2, pct: 100 });
  });

  it("enters marks, makes report cards and ranks the class", async () => {
    const ex = (await E("POST", "exams", { name: "Half-yearly", classId: ids.cls, date: today, subjects: [{ name: "Maths", max: 100 }, { name: "English", max: 80 }] }, "teacher")).json.exam;
    expect((await E("POST", `exams/${ex.id}/marks`, { marks: [{ studentId: ids.asha, subject: "Maths", marks: 120 }] })).status).toBe(422);
    await E("POST", `exams/${ex.id}/marks`, { marks: [{ studentId: ids.asha, subject: "Maths", marks: 92 }, { studentId: ids.asha, subject: "English", marks: 70 }, { studentId: ids.ved, subject: "Maths", marks: 30 }, { studentId: ids.ved, subject: "English", marks: 60 }] }, "teacher");
    const sheet = (await E("GET", `exams/${ex.id}`)).json.students;
    const asha = sheet.find((x: { id: string }) => x.id === ids.asha);
    expect(asha.card).toMatchObject({ total: 162, max: 180, pct: 90, grade: "A2", result: "pass" });
    expect(asha.rank).toBe(1);
    expect(sheet.find((x: { id: string }) => x.id === ids.ved).card.result).toBe("fail");
    expect(sheet.find((x: { id: string }) => x.id === ids.kiran)).toMatchObject({ rank: null, card: { result: null } });
  });

  it("imports students into their classes by name", async () => {
    const r = (await E("POST", "students/import", { rows: [{ name: "Meera", className: "Class 5 – A", guardianPhone: "9820012345" }, { name: "Nope", className: "Class 9" }, { name: "Asha Rao Updated", admissionNo: "ADM-0001" }], mode: "update" })).json;
    expect(r).toMatchObject({ created: 1, updated: 1 });
    expect(r.errors[0].message).toMatch(/No class called “Class 9”/);
    const [m] = await db.select().from(schema.eduStudents).where(and(eq(schema.eduStudents.orgId, orgId), eq(schema.eduStudents.name, "Meera")));
    expect(m.classId).toBe(ids.cls);
  });
});
