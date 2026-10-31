// Clinic: patients (numbered, with consent recorded), appointments with a
// token per doctor and day and a queue that moves booked → arrived → in
// consultation → done, consultations written by clinicians (vitals, notes,
// diagnosis, prescription, follow-up) and signed — after which they're only
// added to — and bills with receipts. Every look at a patient's clinical
// record is in the audit log. Bills post to Accounts as clinic income.
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { appointmentSchema, APPT_STATUSES, billSchema, billTotal, bmi, flags, patientSchema, paymentSchema, visitSchema, type ApptStatus } from "@/lib/clinic/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { check, doctors, getPatient, isClinician, nextNumber, requireClinician, requireWrite, todayIst, type Scope } from "./access";
import type { Role } from "../authz/permissions";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const Pt = schema.clinicPatients;
const Ap = schema.clinicAppointments;
const V = schema.clinicVisits;
const B = schema.clinicBills;
const Py = schema.clinicPayments;

// ── Patients ────────────────────────────────────────────────────────────────

export async function patients(s: Scope, q: { q?: string } = {}) {
  const t = q.q?.trim() ? `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  return db.select({ id: Pt.id, mrn: Pt.mrn, name: Pt.name, phone: Pt.phone, gender: Pt.gender, dob: Pt.dob, ageYears: Pt.ageYears, createdAt: Pt.createdAt }).from(Pt).where(and(eq(Pt.orgId, s.orgId), t ? or(ilike(Pt.name, t), ilike(Pt.mrn, t), ilike(Pt.phone, t)) : sql`true`)).orderBy(desc(Pt.createdAt)).limit(500);
}

export async function savePatient(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(patientSchema, raw);
  const { consent, ...all } = v;
  // Allergies and conditions are clinical: the front desk never sees them (it gets blanks), so its edits can't change
  // them — only record them when registering someone new.
  const { allergies, conditions, ...rest } = all;
  const clinical = s.clinician ? { allergies, conditions } : {};
  if (id) {
    const cur = await getPatient(s.orgId, id);
    const [r] = await db.update(Pt).set({ ...rest, ...clinical, consentAt: consent ? (cur.consentAt ?? new Date()) : null }).where(and(eq(Pt.id, id), eq(Pt.orgId, s.orgId))).returning();
    return r;
  }
  if (!consent) throw new ApiError("validation_failed", "Record the patient's consent to keep their details", { consent: ["Required"] });
  const [r] = await db.insert(Pt).values({ ...rest, allergies, conditions, orgId: s.orgId, mrn: await nextNumber(s.orgId, "mrn", s.settings.mrnPrefix), consentAt: new Date() }).returning();
  return r;
}

/** A patient: details, appointments and bills for everyone; consultations only for clinicians (and that look is logged). */
export async function patientDetail(s: Scope, id: string, ip: string | null) {
  const p = await getPatient(s.orgId, id);
  const appts = await db.select({ a: Ap, doctor: schema.users.name }).from(Ap).leftJoin(schema.users, eq(schema.users.id, Ap.doctorId)).where(eq(Ap.patientId, p.id)).orderBy(desc(Ap.date), desc(Ap.token)).limit(100);
  const bills = await db.select().from(B).where(eq(B.patientId, p.id)).orderBy(desc(B.date));
  let visits: (typeof V.$inferSelect & { doctor: string | null; bmi: ReturnType<typeof bmi>; flags: string[] })[] | null = null;
  if (s.clinician) {
    const rows = await db.select({ v: V, doctor: schema.users.name }).from(V).leftJoin(schema.users, eq(schema.users.id, V.doctorId)).where(eq(V.patientId, p.id)).orderBy(desc(V.createdAt));
    visits = rows.map(({ v, doctor }) => {
      const vit = v.vitals as Parameters<typeof flags>[0];
      // Vitals are stored after the schema filled every reading (null when not taken).
      return { ...v, doctor, bmi: bmi(vit.weightKg ?? null, vit.heightCm ?? null), flags: flags(vit) };
    });
    await audit({ orgId: s.orgId, actorId: s.userId, action: "clinic.record_viewed", targetType: "clinic_patient", targetId: p.id, ip, metadata: { mrn: p.mrn } });
  }
  // Allergies and conditions are clinical too.
  const details = s.clinician ? p : { ...p, allergies: "", conditions: "" };
  return { patient: details, appointments: appts.map(({ a, doctor }) => ({ ...a, doctor })), bills, visits, clinician: s.clinician };
}

// ── Appointments and the queue ──────────────────────────────────────────────

export async function book(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(appointmentSchema, raw);
  await getPatient(s.orgId, v.patientId);
  const [m] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, v.doctorId)));
  if (!m || !isClinician(s.settings, v.doctorId, m.role as Role)) throw new ApiError("validation_failed", "Pick one of the clinic's doctors", { doctorId: ["Not a clinician"] });
  if (v.date < todayIst()) throw new ApiError("validation_failed", "That day has passed", { date: ["In the past"] });
  if (v.time) {
    // Two appointments for one doctor can't overlap.
    const sameDay = await db.select({ time: Ap.time, minutes: Ap.minutes }).from(Ap).where(and(eq(Ap.doctorId, v.doctorId), eq(Ap.date, v.date), inArray(Ap.status, ["booked", "arrived", "in_consultation"])));
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const start = mins(v.time);
    if (sameDay.some((x) => x.time && mins(x.time) < start + v.minutes && start < mins(x.time) + x.minutes)) throw new ApiError("conflict", "The doctor already has an appointment then");
  }
  // The next token for this doctor and day (taken with a retry on the unique key).
  for (let tries = 0; tries < 5; tries++) {
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${Ap.token}), 0)::int` }).from(Ap).where(and(eq(Ap.doctorId, v.doctorId), eq(Ap.date, v.date)));
    const [r] = await db.insert(Ap).values({ ...v, orgId: s.orgId, token: n + 1, createdBy: s.userId }).onConflictDoNothing().returning();
    if (r) return r;
  }
  throw new ApiError("conflict", "Couldn't take a token — try again");
}

const NEXT: Record<ApptStatus, ApptStatus[]> = { booked: ["arrived", "no_show", "cancelled"], arrived: ["in_consultation", "done", "cancelled"], in_consultation: ["done"], done: [], no_show: ["arrived"], cancelled: [] };

export async function setStatus(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const { status } = check(z.object({ status: z.enum(APPT_STATUSES) }), raw);
  if (!isId(id)) throw notFound("Appointment");
  const [a] = await db.select().from(Ap).where(and(eq(Ap.id, id), eq(Ap.orgId, s.orgId)));
  if (!a) throw notFound("Appointment");
  if (!NEXT[a.status as ApptStatus].includes(status)) throw new ApiError("conflict", `A ${a.status.replace("_", " ")} appointment can't become ${status.replace("_", " ")}`);
  if (status === "in_consultation") requireClinician(s);
  const [r] = await db.update(Ap).set({ status, ...(status === "arrived" ? { arrivedAt: new Date() } : {}) }).where(eq(Ap.id, a.id)).returning();
  return r;
}

/** A day's queue, by doctor and token. */
export async function queue(s: Scope, q: { date?: string; doctorId?: string } = {}) {
  const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayIst();
  const rows = await db.select({ a: Ap, patient: Pt.name, mrn: Pt.mrn, phone: Pt.phone, doctor: schema.users.name }).from(Ap).innerJoin(Pt, eq(Pt.id, Ap.patientId)).leftJoin(schema.users, eq(schema.users.id, Ap.doctorId)).where(and(eq(Ap.orgId, s.orgId), eq(Ap.date, date), q.doctorId && isId(q.doctorId) ? eq(Ap.doctorId, q.doctorId) : sql`true`)).orderBy(asc(schema.users.name), asc(Ap.token));
  return { date, appointments: rows.map(({ a, ...r }) => ({ ...a, ...r })) };
}

// ── Consultations ───────────────────────────────────────────────────────────

async function getVisit(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Consultation");
  const [v] = await db.select().from(V).where(and(eq(V.id, id), eq(V.orgId, s.orgId)));
  if (!v) throw notFound("Consultation");
  return v;
}

export async function saveVisit(s: Scope, id: string | null, raw: unknown) {
  requireClinician(s);
  const v = check(visitSchema, raw);
  await getPatient(s.orgId, v.patientId);
  if (id) {
    const cur = await getVisit(s, id);
    if (cur.signedAt) throw new ApiError("conflict", "This consultation is signed — add a note to it instead");
    const { appointmentId: _, ...rest } = v;
    void _;
    const [r] = await db.update(V).set(rest).where(eq(V.id, cur.id)).returning();
    return r;
  }
  if (v.appointmentId) {
    const [a] = await db.select().from(Ap).where(and(eq(Ap.id, v.appointmentId), eq(Ap.orgId, s.orgId), eq(Ap.patientId, v.patientId)));
    if (!a) throw new ApiError("validation_failed", "That appointment isn't this patient's");
    if (a.status === "booked" || a.status === "arrived") await db.update(Ap).set({ status: "in_consultation", arrivedAt: a.arrivedAt ?? new Date() }).where(eq(Ap.id, a.id));
  }
  return (await db.insert(V).values({ ...v, orgId: s.orgId, doctorId: s.userId }).returning())[0];
}

/** Sign a consultation: it can't be changed after, and its appointment is done. */
export async function signVisit(s: Scope, id: string) {
  requireClinician(s);
  const v = await getVisit(s, id);
  if (v.signedAt) throw new ApiError("conflict", "Already signed");
  if (v.doctorId !== s.userId) throw new ApiError("forbidden", "Only the doctor who wrote it can sign it");
  const [r] = await db.update(V).set({ signedAt: new Date() }).where(eq(V.id, v.id)).returning();
  if (v.appointmentId) await db.update(Ap).set({ status: "done" }).where(and(eq(Ap.id, v.appointmentId), inArray(Ap.status, ["arrived", "in_consultation"])));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "clinic.consultation_signed", targetType: "clinic_visit", targetId: v.id });
  return r;
}

export async function addendum(s: Scope, id: string, raw: unknown) {
  requireClinician(s);
  const v = await getVisit(s, id);
  if (!v.signedAt) throw new ApiError("conflict", "Edit the consultation — it isn't signed yet");
  const { text } = check(z.object({ text: z.string().trim().min(1, "Write the note").max(4000) }), raw);
  const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
  const [r] = await db.update(V).set({ addenda: [...v.addenda, { at: new Date().toISOString(), by: me?.name ?? "", text }] }).where(eq(V.id, v.id)).returning();
  return r;
}

/** What's printed on a prescription: patient, doctor, date, medicines and advice. */
export async function prescription(s: Scope, id: string, ip: string | null) {
  requireClinician(s);
  const v = await getVisit(s, id);
  const p = await getPatient(s.orgId, v.patientId);
  const [doc] = v.doctorId ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, v.doctorId)) : [];
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "clinic.prescription_printed", targetType: "clinic_visit", targetId: v.id, ip });
  return { clinic: org?.name ?? "", footer: s.settings.footer, doctor: doc?.name ?? "", date: v.createdAt, patient: { name: p.name, mrn: p.mrn, gender: p.gender, dob: p.dob, ageYears: p.ageYears }, vitals: v.vitals, diagnosis: v.diagnosis, prescription: v.prescription, advice: v.advice, tests: v.tests, followUp: v.followUp, signed: !!v.signedAt };
}

// ── Bills ───────────────────────────────────────────────────────────────────

export async function createBill(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(billSchema, raw);
  await getPatient(s.orgId, v.patientId);
  if (v.visitId) {
    const [x] = await db.select({ id: V.id }).from(V).where(and(eq(V.id, v.visitId), eq(V.patientId, v.patientId)));
    if (!x) throw new ApiError("validation_failed", "That consultation isn't this patient's");
  }
  const total = billTotal(v.items, v.discount);
  if (v.discount > v.items.reduce((n, i) => n + i.qty * i.rate, 0)) throw new ApiError("validation_failed", "The discount is more than the bill");
  return (await db.insert(B).values({ ...v, orgId: s.orgId, number: await nextNumber(s.orgId, "bill", s.settings.billPrefix), date: todayIst(), total, status: total ? "due" : "paid", createdBy: s.userId }).returning())[0];
}

export async function payBill(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Bill");
  const [b] = await db.select().from(B).where(and(eq(B.id, id), eq(B.orgId, s.orgId)));
  if (!b) throw notFound("Bill");
  if (b.status === "paid" || b.status === "void") throw new ApiError("conflict", b.status === "paid" ? "Already paid" : "This bill is void");
  const v = check(paymentSchema, raw);
  if (v.amount > b.total - b.paid) throw new ApiError("validation_failed", "That's more than is due", { amount: ["More than due"] });
  if (v.accountId) {
    const [a] = await db.select({ subtype: schema.accAccounts.subtype }).from(schema.accAccounts).where(and(eq(schema.accAccounts.id, v.accountId), eq(schema.accAccounts.orgId, s.orgId)));
    if (!a || !["cash", "bank"].includes(a.subtype ?? "")) throw new ApiError("validation_failed", "Pick a cash or bank account");
  }
  const [p] = await db.insert(Py).values({ ...v, orgId: s.orgId, billId: b.id, createdBy: s.userId }).returning();
  const paid = b.paid + v.amount;
  await db.update(B).set({ paid, status: paid >= b.total ? "paid" : "partial" }).where(eq(B.id, b.id));
  return p;
}

export async function voidBill(s: Scope, id: string) {
  requireWrite(s);
  const [b] = await db.select().from(B).where(and(eq(B.id, id), eq(B.orgId, s.orgId)));
  if (!b) throw notFound("Bill");
  if (b.paid) throw new ApiError("conflict", "Money has been taken on this bill");
  await db.update(B).set({ status: "void" }).where(eq(B.id, b.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "clinic.bill_voided", targetType: "clinic_bill", targetId: b.id, metadata: { number: b.number, total: b.total } });
}

export async function home(s: Scope) {
  const today = todayIst();
  const [q] = await db.select({ booked: sql<number>`count(*) filter (where ${Ap.status} = 'booked')::int`, waiting: sql<number>`count(*) filter (where ${Ap.status} = 'arrived')::int`, inRoom: sql<number>`count(*) filter (where ${Ap.status} = 'in_consultation')::int`, done: sql<number>`count(*) filter (where ${Ap.status} = 'done')::int` }).from(Ap).where(and(eq(Ap.orgId, s.orgId), eq(Ap.date, today)));
  const [m] = await db.select({ billed: sql<number>`coalesce(sum(${B.total}) filter (where ${B.status} <> 'void'), 0)::bigint`, due: sql<number>`coalesce(sum(${B.total} - ${B.paid}) filter (where ${B.status} in ('due','partial')), 0)::bigint` }).from(B).where(and(eq(B.orgId, s.orgId), gte(B.date, `${today.slice(0, 7)}-01`), lte(B.date, today)));
  const followUps = s.clinician ? await db.select({ id: V.id, patientId: V.patientId, followUp: V.followUp, patient: Pt.name }).from(V).innerJoin(Pt, eq(Pt.id, V.patientId)).where(and(eq(V.orgId, s.orgId), eq(V.followUp, today))) : [];
  return { today: q, month: { billed: Number(m.billed), due: Number(m.due) }, followUps, doctors: await doctors(s), clinician: s.clinician };
}

/** Journal entries for Accounts: each bill as clinic income against receivables; each payment into its account. */
export async function clinicWants(orgId: string) {
  const bills = await db.select({ b: B, patient: Pt.name }).from(B).innerJoin(Pt, eq(Pt.id, B.patientId)).where(and(eq(B.orgId, orgId), sql`${B.status} <> 'void'`, sql`${B.total} > 0`));
  const pays = await db.select({ p: Py, bill: B.number, patient: Pt.name }).from(Py).innerJoin(B, eq(B.id, Py.billId)).innerJoin(Pt, eq(Pt.id, B.patientId)).where(eq(Py.orgId, orgId));
  const out: { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: { key?: string; accountId?: string; debit: number; credit: number }[] }[] = [];
  for (const { b, patient } of bills) out.push({ sourceType: "clinic_bill", sourceId: b.id, date: String(b.date), narration: `Clinic bill — ${patient}`, sourceRef: b.number, party: patient, lines: [{ key: "ar", debit: b.total, credit: 0 }, { key: "clinic_income", debit: 0, credit: b.total }] });
  for (const { p, bill, patient } of pays) out.push({ sourceType: "clinic_payment", sourceId: p.id, date: String(p.paidOn), narration: `Clinic payment — ${patient} (${bill})`, sourceRef: bill, party: patient, lines: [{ ...(p.accountId ? { accountId: p.accountId } : { key: p.method === "cash" ? "cash" : "bank" }), debit: p.amount, credit: 0 }, { key: "ar", debit: 0, credit: p.amount }] });
  return out;
}
