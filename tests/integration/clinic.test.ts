import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as api from "@/app/api/v1/orgs/[orgId]/clinic/[[...slug]]/route";
import * as accApi from "@/app/api/v1/orgs/[orgId]/accounts/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Patients with consent, tokens per doctor and day, the queue, a consultation
// written and signed by a clinician (then only added to), clinical notes kept
// from the front desk and every look at them logged, bills with payments, and
// the books.
let orgId = "";
const C: Record<string, string> = {};
const U: Record<string, string> = {};
const ids: Record<string, string> = {};
const seg = (p: string) => p.split("?")[0].split("/").filter(Boolean);
const mk = (mod: unknown, base: string) => (method: string, path: string, body?: unknown, who = "owner") => call((mod as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C[who], body, path: `/api/v1/orgs/${orgId}/${base}/${path}`, params: { orgId, slug: seg(path) } });
const K = mk(api, "clinic");
const A = mk(accApi, "accounts");
const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Dr Owner", email: "dr.owner@example.com", password: "correct-horse-42" } }));
  const m = (await call(me.GET, { cookie: C.owner })).json;
  orgId = m.organizations[0].id;
  U.owner = m.user.id;
  for (const [k, role] of [["desk", "editor"], ["doc2", "editor"]] as const) {
    C[k] = cookieFrom(await call(signup.POST, { method: "POST", body: { name: k === "desk" ? "Front Desk" : "Dr Two", email: `${k}.clinic@example.com`, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `${k}.clinic@example.com`));
    U[k] = u.id;
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
  }
  await K("GET", "meta");
});
afterAll(closeDb);

describe("patients and the queue", () => {
  it("registers patients only with consent, numbered", async () => {
    expect((await K("POST", "patients", { name: "Ramesh Iyer" }, "desk")).status).toBe(422);
    const p = (await K("POST", "patients", { name: "Ramesh Iyer", ageYears: 54, gender: "male", phone: "9820012345", allergies: "Penicillin", consent: true }, "desk")).json.patient;
    expect(p.mrn).toBe("MRN-00001");
    ids.p = p.id;
    // The front desk edits contact details; it gets blanks for clinical fields, and its edit can't wipe them.
    expect((await K("PUT", `patients/${p.id}`, { name: "Ramesh Iyer", ageYears: 54, gender: "male", phone: "9820099999", allergies: "", conditions: "", consent: true }, "desk")).status).toBe(200);
    const [row] = await db.select().from(schema.clinicPatients).where(eq(schema.clinicPatients.id, p.id));
    expect(row).toMatchObject({ phone: "9820099999", allergies: "Penicillin" });
  });

  it("gives tokens per doctor and day, refuses overlaps and non-doctors", async () => {
    expect((await K("POST", "appointments", { patientId: ids.p, doctorId: U.desk, date: today }, "desk")).status).toBe(422);
    const a1 = (await K("POST", "appointments", { patientId: ids.p, doctorId: U.owner, date: today, time: "10:00", minutes: 15 }, "desk")).json.appointment;
    expect(a1.token).toBe(1);
    ids.appt = a1.id;
    expect((await K("POST", "appointments", { patientId: ids.p, doctorId: U.owner, date: today, time: "10:10" }, "desk")).status).toBe(409);
    expect((await K("POST", "appointments", { patientId: ids.p, doctorId: U.owner, date: today }, "desk")).json.appointment.token).toBe(2);
    await K("PUT", "settings", { clinicians: [U.owner, U.doc2] });
    expect((await K("POST", "appointments", { patientId: ids.p, doctorId: U.doc2, date: today }, "desk")).json.appointment.token).toBe(1);
    expect((await K("POST", `appointments/${ids.appt}/status`, { status: "done" }, "desk")).status).toBe(409);
    await K("POST", `appointments/${ids.appt}/status`, { status: "arrived" }, "desk");
    expect((await K("POST", `appointments/${ids.appt}/status`, { status: "in_consultation" }, "desk")).status).toBe(403);
    const q = (await K("GET", "queue")).json.appointments;
    expect(q.map((x: { doctor: string; token: number; status: string }) => [x.doctor, x.token, x.status])).toEqual([["Dr Owner", 1, "arrived"], ["Dr Owner", 2, "booked"], ["Dr Two", 1, "booked"]]);
  });
});

describe("consultations", () => {
  it("are written and signed by a clinician, then only added to", async () => {
    expect((await K("POST", "visits", { patientId: ids.p }, "desk")).status).toBe(403);
    const v = (await K("POST", "visits", { patientId: ids.p, appointmentId: ids.appt, vitals: { systolic: 152, diastolic: 96, pulse: 88, weightKg: 82, heightCm: 172 }, complaints: "Headache for 3 days", diagnosis: "Essential hypertension", icd10: "i10", prescription: [{ drug: "Amlodipine", strength: "5 mg", dose: "1-0-0", days: 30 }], followUp: today })).json.visit;
    ids.visit = v.id;
    expect(v.icd10).toBe("I10");
    expect((await db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.id, ids.appt)))[0].status).toBe("in_consultation");
    expect((await K("POST", `visits/${v.id}/sign`, undefined, "doc2")).status).toBe(403);
    await K("POST", `visits/${v.id}/sign`);
    expect((await db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.id, ids.appt)))[0].status).toBe("done");
    expect((await K("PUT", `visits/${v.id}`, { patientId: ids.p, diagnosis: "changed" })).status).toBe(409);
    expect((await K("POST", `visits/${v.id}/addendum`, { text: "BP recheck at home advised" }, "doc2")).json.visit.addenda[0]).toMatchObject({ by: "Dr Two", text: "BP recheck at home advised" });
    const rx = (await K("GET", `visits/${v.id}/prescription`)).json;
    expect(rx).toMatchObject({ doctor: "Dr Owner", signed: true, prescription: [{ drug: "Amlodipine", dose: "1-0-0", days: 30 }] });
  });

  it("keeps clinical notes from the front desk and logs every look", async () => {
    const desk = (await K("GET", `patients/${ids.p}`, undefined, "desk")).json;
    expect(desk.visits).toBeNull();
    expect(desk.patient.allergies).toBe("");
    const doc = (await K("GET", `patients/${ids.p}`)).json;
    expect(doc.visits[0]).toMatchObject({ diagnosis: "Essential hypertension", bmi: { value: 27.7, band: "overweight" }, flags: ["High blood pressure"] });
    expect(doc.patient.allergies).toBe("Penicillin");
    const views = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.action, "clinic.record_viewed")));
    expect(views).toHaveLength(1);
    expect((await K("GET", "home")).json.followUps.map((f: { patient: string }) => f.patient)).toEqual(["Ramesh Iyer"]);
  });
});

describe("billing", () => {
  it("bills, takes payments, won't void what's paid, and posts to the books", async () => {
    const b = (await K("POST", "bills", { patientId: ids.p, visitId: ids.visit, items: [{ name: "Consultation", rate: 500_00 }, { name: "ECG", rate: 300_00 }], discount: 100_00 }, "desk")).json.bill;
    expect(b).toMatchObject({ number: "CB-00001", total: 700_00, status: "due" });
    await K("POST", `bills/${b.id}/payments`, { amount: 400_00, method: "upi", paidOn: today }, "desk");
    expect((await K("POST", `bills/${b.id}/payments`, { amount: 400_00, method: "cash", paidOn: today }, "desk")).status).toBe(422);
    await K("POST", `bills/${b.id}/payments`, { amount: 300_00, method: "cash", paidOn: today }, "desk");
    expect((await db.select().from(schema.clinicBills).where(eq(schema.clinicBills.id, b.id)))[0].status).toBe("paid");
    expect((await K("POST", `bills/${b.id}/void`, undefined, "desk")).status).toBe(409);
    await A("GET", "meta");
    await A("POST", "sync");
    const js = await db.select().from(schema.accJournals).where(eq(schema.accJournals.orgId, orgId));
    expect(js.filter((j) => j.sourceType === "clinic_bill").map((j) => Number(j.total))).toEqual([700_00]);
    expect(js.filter((j) => j.sourceType === "clinic_payment").map((j) => Number(j.total)).sort()).toEqual([300_00, 400_00]);
  });
});
