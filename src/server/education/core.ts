// Education: classes and students; fee plans raised as instalments for each
// student in their classes (with the student's concession, GST if the plan
// has it), payments with numbered receipts, waivers, dues and reminders to
// guardians; attendance by class and day; exams with marks and report cards.
// Fees post to Accounts: the fee as income and a receivable, payments into
// the account they were received in.
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ATTENDANCE, attendancePct, classSchema, examSchema, feeFor, gstOn, paymentSchema, planSchema, reportCard, splitInstalments, studentSchema } from "@/lib/education/model";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { audit } from "../services/audit";
import { sendMail } from "../services/mail";
import { check, getClass, getSettings, getStudent, nextNumber, requireManage, requireWrite, todayIst, type Scope } from "./access";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const S = schema.eduStudents;
const F = schema.eduFees;
const P = schema.eduPayments;
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ── Classes ─────────────────────────────────────────────────────────────────

export async function classes(s: Scope) {
  const rows = await db.select({ c: schema.eduClasses, teacher: schema.users.name, students: sql<number>`(select count(*)::int from edu_students st where st.class_id = ${schema.eduClasses.id} and st.status = 'active')` }).from(schema.eduClasses).leftJoin(schema.users, eq(schema.users.id, schema.eduClasses.teacherId)).where(eq(schema.eduClasses.orgId, s.orgId)).orderBy(desc(schema.eduClasses.year), asc(schema.eduClasses.name), asc(schema.eduClasses.section));
  return rows.map(({ c, teacher, students }) => ({ ...c, teacher, students, label: `${c.name}${c.section ? ` – ${c.section}` : ""}` }));
}

export async function saveClass(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(classSchema, raw);
  if (v.teacherId) {
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, v.teacherId)));
    if (!m) throw new ApiError("validation_failed", "That teacher isn't in this workspace", { teacherId: ["Not a member"] });
  }
  if (id) {
    const [r] = await db.update(schema.eduClasses).set(v).where(and(eq(schema.eduClasses.id, id), eq(schema.eduClasses.orgId, s.orgId))).returning();
    if (!r) throw notFound("Class");
    return r;
  }
  return (await db.insert(schema.eduClasses).values({ ...v, orgId: s.orgId }).returning())[0];
}

// ── Students ────────────────────────────────────────────────────────────────

export async function students(s: Scope, q: { classId?: string; status?: string; q?: string } = {}) {
  const t = q.q?.trim() ? `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const rows = await db
    .select({ st: S, due: sql<number>`coalesce((select sum(f.amount + f.tax - f.paid) from edu_fees f where f.student_id = "edu_students"."id" and f.status in ('due','partial')), 0)::bigint`, overdue: sql<number>`coalesce((select sum(f.amount + f.tax - f.paid) from edu_fees f where f.student_id = "edu_students"."id" and f.status in ('due','partial') and f.due_date < ${todayIst()}::date), 0)::bigint` })
    .from(S)
    .where(and(eq(S.orgId, s.orgId), q.classId && isId(q.classId) ? eq(S.classId, q.classId) : sql`true`, q.status ? eq(S.status, q.status) : eq(S.status, "active"), t ? sql`(${S.name} ilike ${t} or ${S.admissionNo} ilike ${t} or ${S.guardianName} ilike ${t} or ${S.guardianPhone} ilike ${t})` : sql`true`))
    .orderBy(asc(S.rollNo), asc(S.name))
    .limit(2000);
  return rows.map(({ st, due, overdue }) => ({ ...st, due: Number(due), overdue: Number(overdue) }));
}

export async function saveStudent(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(studentSchema, raw);
  if (v.classId) await getClass(s.orgId, v.classId);
  if (v.concessionPct && !s.manage) {
    const cur = id ? await getStudent(s.orgId, id) : null;
    if (!cur || cur.concessionPct !== v.concessionPct) throw new ApiError("forbidden", "Only owners and admins can give a fee concession");
  }
  if (id) {
    await getStudent(s.orgId, id);
    if (v.admissionNo) await uniqueAdmission(s.orgId, v.admissionNo, id);
    const [r] = await db.update(S).set({ ...v, admissionNo: v.admissionNo || undefined }).where(eq(S.id, id)).returning();
    return r;
  }
  const admissionNo = v.admissionNo || (await nextNumber(s.orgId, "admission", "ADM-", 4));
  await uniqueAdmission(s.orgId, admissionNo, null);
  const [r] = await db.insert(S).values({ ...v, admissionNo, orgId: s.orgId, joinedOn: v.joinedOn ?? todayIst() }).returning();
  return r;
}

async function uniqueAdmission(orgId: string, no: string, id: string | null) {
  const [d] = await db.select({ id: S.id }).from(S).where(and(eq(S.orgId, orgId), sql`lower(${S.admissionNo}) = ${no.toLowerCase()}`, id ? ne(S.id, id) : sql`true`));
  if (d) throw new ApiError("conflict", `Admission number ${no} is already taken`);
}

export async function studentDetail(s: Scope, id: string) {
  const st = await getStudent(s.orgId, id);
  const fees = await db.select().from(F).where(eq(F.studentId, st.id)).orderBy(asc(F.dueDate));
  const pays = fees.length ? await db.select().from(P).where(inArray(P.feeId, fees.map((f) => f.id))).orderBy(desc(P.paidOn)) : [];
  const att = await db.select({ status: schema.eduAttendance.status }).from(schema.eduAttendance).where(eq(schema.eduAttendance.studentId, st.id));
  const exams = st.classId ? await db.select().from(schema.eduExams).where(eq(schema.eduExams.classId, st.classId)).orderBy(desc(schema.eduExams.date)) : [];
  const cls = st.classId ? (await db.select().from(schema.eduClasses).where(eq(schema.eduClasses.id, st.classId)))[0] : null;
  return { student: st, class: cls, fees, payments: pays, attendance: { days: att.length, pct: attendancePct(att.map((a) => a.status as (typeof ATTENDANCE)[number])) }, exams: exams.map((e) => ({ id: e.id, name: e.name, date: e.date })) };
}

// ── Fee plans and fees ──────────────────────────────────────────────────────

export const plans = (s: Scope) => db.select().from(schema.eduFeePlans).where(eq(schema.eduFeePlans.orgId, s.orgId)).orderBy(desc(schema.eduFeePlans.year), asc(schema.eduFeePlans.name));

export async function savePlan(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const v = check(planSchema, raw);
  const cls = await db.select({ id: schema.eduClasses.id }).from(schema.eduClasses).where(and(eq(schema.eduClasses.orgId, s.orgId), inArray(schema.eduClasses.id, v.classIds)));
  if (cls.length !== new Set(v.classIds).size) throw new ApiError("validation_failed", "A class isn't in this workspace", { classIds: ["Unknown class"] });
  if (id) {
    const [raised] = await db.select({ id: F.id }).from(F).where(eq(F.planId, id)).limit(1);
    if (raised) throw new ApiError("conflict", "Fees have been raised from this plan — make a new plan for changes");
    const [r] = await db.update(schema.eduFeePlans).set(v).where(and(eq(schema.eduFeePlans.id, id), eq(schema.eduFeePlans.orgId, s.orgId))).returning();
    if (!r) throw notFound("Fee plan");
    return r;
  }
  return (await db.insert(schema.eduFeePlans).values({ ...v, orgId: s.orgId }).returning())[0];
}

/** Raise a plan's instalments for every active student in its classes; running it again only adds what's missing (new students). */
export async function raisePlan(s: Scope, planId: string) {
  requireWrite(s);
  if (!isId(planId)) throw notFound("Fee plan");
  const [p] = await db.select().from(schema.eduFeePlans).where(and(eq(schema.eduFeePlans.id, planId), eq(schema.eduFeePlans.orgId, s.orgId)));
  if (!p) throw notFound("Fee plan");
  const kids = await db.select().from(S).where(and(eq(S.orgId, s.orgId), inArray(S.classId, p.classIds), eq(S.status, "active")));
  const have = new Set((await db.select({ k: sql<string>`${F.studentId}::text || '|' || ${F.label}` }).from(F).where(eq(F.planId, p.id))).map((r) => r.k));
  let raised = 0;
  let total = 0;
  for (const k of kids) {
    for (const part of splitInstalments(feeFor(p, k.concessionPct), p.installments)) {
      if (have.has(`${k.id}|${part.label}`) || part.amount <= 0) continue;
      const tax = gstOn(part.amount, p.gstRate);
      await db.insert(F).values({ orgId: s.orgId, number: await nextNumber(s.orgId, "fee", s.settings.feePrefix), studentId: k.id, planId: p.id, label: part.label, dueDate: part.dueDate, amount: part.amount, tax }).onConflictDoNothing();
      raised++;
      total += part.amount + tax;
    }
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "education.fees_raised", targetType: "edu_fee_plan", targetId: p.id, metadata: { plan: p.name, fees: raised, total } });
  return { raised, total, students: kids.length };
}

async function getFee(orgId: string, id: string) {
  if (!isId(id)) throw notFound("Fee");
  const [f] = await db.select().from(F).where(and(eq(F.id, id), eq(F.orgId, orgId)));
  if (!f) throw notFound("Fee");
  return f;
}

/** Take a payment against a fee (part or full), with a numbered receipt. */
export async function pay(s: Scope, feeId: string, raw: unknown) {
  requireWrite(s);
  const f = await getFee(s.orgId, feeId);
  if (f.status === "paid" || f.status === "waived") throw new ApiError("conflict", f.status === "paid" ? "This fee is already paid" : "This fee was waived");
  const v = check(paymentSchema, raw);
  const left = f.amount + f.tax - f.paid;
  if (v.amount > left) throw new ApiError("validation_failed", `Only ${inr(left)} is still due`, { amount: ["More than due"] });
  if (v.paidOn > todayIst()) throw new ApiError("validation_failed", "A payment can't be in the future", { paidOn: ["In the future"] });
  if (v.accountId) {
    const [a] = await db.select({ id: schema.accAccounts.id, subtype: schema.accAccounts.subtype }).from(schema.accAccounts).where(and(eq(schema.accAccounts.id, v.accountId), eq(schema.accAccounts.orgId, s.orgId)));
    if (!a || !["cash", "bank"].includes(a.subtype ?? "")) throw new ApiError("validation_failed", "Pick a cash or bank account", { accountId: ["Not a cash or bank account"] });
  }
  const receiptNo = await nextNumber(s.orgId, "receipt", s.settings.receiptPrefix);
  const [r] = await db.transaction(async (tx) => {
    const ins = await tx.insert(P).values({ ...v, orgId: s.orgId, feeId: f.id, receiptNo, createdBy: s.userId }).returning();
    const paid = f.paid + v.amount;
    await tx.update(F).set({ paid, status: paid >= f.amount + f.tax ? "paid" : "partial" }).where(eq(F.id, f.id));
    return ins;
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "education.fee_paid", targetType: "edu_fee", targetId: f.id, metadata: { receiptNo, amount: v.amount, method: v.method } });
  return r;
}

export async function waive(s: Scope, feeId: string, raw: unknown) {
  requireManage(s);
  const f = await getFee(s.orgId, feeId);
  if (f.paid) throw new ApiError("conflict", "Part of this fee is paid — record a concession on the student for next time instead");
  if (f.status === "waived") throw new ApiError("conflict", "Already waived");
  const { reason } = check(z.object({ reason: z.string().trim().min(1, "Say why").max(200) }), raw);
  await db.update(F).set({ status: "waived", waivedReason: reason }).where(eq(F.id, f.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "education.fee_waived", targetType: "edu_fee", targetId: f.id, metadata: { reason, amount: f.amount + f.tax } });
}

/** Fees still to collect: overdue first, then due soon; with totals. */
export async function dues(s: Scope, q: { classId?: string; view?: string } = {}) {
  const today = todayIst();
  const rows = await db
    .select({ f: F, student: S.name, admissionNo: S.admissionNo, guardianPhone: S.guardianPhone, classId: S.classId })
    .from(F)
    .innerJoin(S, eq(S.id, F.studentId))
    .where(and(eq(F.orgId, s.orgId), inArray(F.status, ["due", "partial"]), q.view === "overdue" ? sql`${F.dueDate} < ${today}::date` : sql`true`, q.classId && isId(q.classId) ? eq(S.classId, q.classId) : sql`true`))
    .orderBy(asc(F.dueDate), asc(S.name))
    .limit(3000);
  const list = rows.map(({ f, ...r }) => ({ ...f, ...r, dueDate: String(f.dueDate), left: f.amount + f.tax - f.paid, overdue: String(f.dueDate) < today }));
  return { fees: list, total: list.reduce((n, f) => n + f.left, 0), overdue: list.filter((f) => f.overdue).reduce((n, f) => n + f.left, 0) };
}

export async function collections(s: Scope, q: { from?: string; to?: string } = {}) {
  const to = q.to ?? todayIst();
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  const rows = await db.select({ p: P, student: S.name, fee: F.number, label: F.label }).from(P).innerJoin(F, eq(F.id, P.feeId)).innerJoin(S, eq(S.id, F.studentId)).where(and(eq(P.orgId, s.orgId), gte(P.paidOn, from), lte(P.paidOn, to))).orderBy(desc(P.paidOn));
  const byMethod: Record<string, number> = {};
  for (const r of rows) byMethod[r.p.method] = (byMethod[r.p.method] ?? 0) + r.p.amount;
  return { from, to, payments: rows.map(({ p, ...r }) => ({ ...p, ...r })), total: rows.reduce((n, r) => n + r.p.amount, 0), byMethod };
}

/** Email guardians about fees due within the reminder window, and once a week while overdue. */
export async function remind(now = new Date()) {
  const today = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const orgs = await db.select({ orgId: schema.eduSettings.orgId, name: schema.organizations.name }).from(schema.eduSettings).innerJoin(schema.organizations, eq(schema.organizations.id, schema.eduSettings.orgId));
  let sent = 0;
  for (const o of orgs) {
    const st = await getSettings(o.orgId);
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + st.remindDays * 86_400_000).toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const due = await db.select({ f: F, s: S }).from(F).innerJoin(S, eq(S.id, F.studentId)).where(and(eq(F.orgId, o.orgId), inArray(F.status, ["due", "partial"]), lte(F.dueDate, soon), sql`(${F.remindedAt} is null or ${F.remindedAt} < ${weekAgo})`, ne(S.guardianEmail, "")));
    for (const { f, s: kid } of due) {
      const late = String(f.dueDate) < today;
      await sendMail({ to: kid.guardianEmail, fromName: o.name, subject: `${late ? "Overdue" : "Due"}: ${f.label} fee for ${kid.name}`, body: `Dear ${kid.guardianName || "parent"},\n\nThe ${f.label} fee for ${kid.name} (${kid.admissionNo}) of ${inr(f.amount + f.tax - f.paid)} ${late ? `was due on ${f.dueDate}` : `is due on ${f.dueDate}`}. Reference ${f.number}.\n\nIf you've already paid, thank you — please ignore this.\n\n${o.name}` }).catch((e) => log.warn("edu.remind_failed", { err: String(e) }));
      await db.update(F).set({ remindedAt: now }).where(eq(F.id, f.id));
      sent++;
    }
  }
  return sent;
}

// ── Attendance ──────────────────────────────────────────────────────────────

export async function attendance(s: Scope, classId: string, date: string) {
  await getClass(s.orgId, classId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError("validation_failed", "Pick a date");
  const kids = await db.select({ id: S.id, name: S.name, rollNo: S.rollNo }).from(S).where(and(eq(S.classId, classId), eq(S.status, "active"))).orderBy(asc(S.rollNo), asc(S.name));
  const marks = kids.length ? await db.select().from(schema.eduAttendance).where(and(inArray(schema.eduAttendance.studentId, kids.map((k) => k.id)), eq(schema.eduAttendance.date, date))) : [];
  return { date, students: kids.map((k) => ({ ...k, status: marks.find((m) => m.studentId === k.id)?.status ?? null })) };
}

export async function markAttendance(s: Scope, classId: string, raw: unknown) {
  requireWrite(s);
  await getClass(s.orgId, classId);
  const v = check(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), marks: z.array(z.object({ studentId: z.uuid(), status: z.enum(ATTENDANCE) })).min(1).max(1000) }), raw);
  if (v.date > todayIst()) throw new ApiError("validation_failed", "Attendance can't be marked for a future day");
  const ids = new Set((await db.select({ id: S.id }).from(S).where(eq(S.classId, classId))).map((r) => r.id));
  if (v.marks.some((m) => !ids.has(m.studentId))) throw new ApiError("validation_failed", "A student isn't in this class");
  for (const m of v.marks) await db.insert(schema.eduAttendance).values({ orgId: s.orgId, studentId: m.studentId, date: v.date, status: m.status, markedBy: s.userId }).onConflictDoUpdate({ target: [schema.eduAttendance.studentId, schema.eduAttendance.date], set: { status: m.status, markedBy: s.userId } });
  return { marked: v.marks.length };
}

/** A class's attendance for a month: each student's percentage and absences. */
export async function attendanceMonth(s: Scope, classId: string, month: string) {
  await getClass(s.orgId, classId);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError("validation_failed", "Pick a month");
  const kids = await db.select({ id: S.id, name: S.name, rollNo: S.rollNo }).from(S).where(and(eq(S.classId, classId), eq(S.status, "active"))).orderBy(asc(S.rollNo), asc(S.name));
  const rows = kids.length ? await db.select().from(schema.eduAttendance).where(and(inArray(schema.eduAttendance.studentId, kids.map((k) => k.id)), sql`to_char(${schema.eduAttendance.date}, 'YYYY-MM') = ${month}`)) : [];
  return { month, students: kids.map((k) => {
    const mine = rows.filter((r) => r.studentId === k.id).map((r) => r.status as (typeof ATTENDANCE)[number]);
    return { ...k, days: mine.length, absent: mine.filter((m) => m === "absent").length, pct: attendancePct(mine) };
  }) };
}

// ── Exams ───────────────────────────────────────────────────────────────────

export async function exams(s: Scope, classId?: string) {
  return db.select().from(schema.eduExams).where(and(eq(schema.eduExams.orgId, s.orgId), classId && isId(classId) ? eq(schema.eduExams.classId, classId) : sql`true`)).orderBy(desc(schema.eduExams.date));
}

export async function saveExam(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(examSchema, raw);
  await getClass(s.orgId, v.classId);
  if (new Set(v.subjects.map((x) => x.name.toLowerCase())).size !== v.subjects.length) throw new ApiError("validation_failed", "Each subject once");
  if (id) {
    const [r] = await db.update(schema.eduExams).set(v).where(and(eq(schema.eduExams.id, id), eq(schema.eduExams.orgId, s.orgId))).returning();
    if (!r) throw notFound("Exam");
    return r;
  }
  return (await db.insert(schema.eduExams).values({ ...v, orgId: s.orgId }).returning())[0];
}

async function getExam(orgId: string, id: string) {
  if (!isId(id)) throw notFound("Exam");
  const [e] = await db.select().from(schema.eduExams).where(and(eq(schema.eduExams.id, id), eq(schema.eduExams.orgId, orgId)));
  if (!e) throw notFound("Exam");
  return e;
}

/** An exam's marks sheet: every student in the class, each subject, with their report card. */
export async function examSheet(s: Scope, id: string) {
  const e = await getExam(s.orgId, id);
  const kids = await db.select({ id: S.id, name: S.name, rollNo: S.rollNo, admissionNo: S.admissionNo }).from(S).where(and(eq(S.classId, e.classId), eq(S.status, "active"))).orderBy(asc(S.rollNo), asc(S.name));
  const marks = await db.select().from(schema.eduMarks).where(eq(schema.eduMarks.examId, e.id));
  const rows = kids.map((k) => {
    const mine = Object.fromEntries(marks.filter((m) => m.studentId === k.id).map((m) => [m.subject, m.marks]));
    return { ...k, marks: mine, card: reportCard(e.subjects, mine, s.settings) };
  });
  // Rank by percentage among those with every subject entered.
  const ranked = rows.filter((r) => r.card.result !== "incomplete" && r.card.pct !== null).sort((a, b) => b.card.pct! - a.card.pct!);
  return { exam: e, students: rows.map((r) => ({ ...r, rank: ranked.findIndex((x) => x.id === r.id) + 1 || null })) };
}

export async function saveMarks(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const e = await getExam(s.orgId, id);
  const v = check(z.object({ marks: z.array(z.object({ studentId: z.uuid(), subject: z.string().max(60), marks: z.number().min(0).nullable() })).min(1).max(20_000) }), raw);
  const ids = new Set((await db.select({ id: S.id }).from(S).where(eq(S.classId, e.classId))).map((r) => r.id));
  for (const m of v.marks) {
    const sub = e.subjects.find((x) => x.name === m.subject);
    if (!sub) throw new ApiError("validation_failed", `${m.subject} isn't a subject of this exam`);
    if (!ids.has(m.studentId)) throw new ApiError("validation_failed", "A student isn't in this class");
    if (m.marks !== null && m.marks > sub.max) throw new ApiError("validation_failed", `${m.subject} is out of ${sub.max}`);
    await db.insert(schema.eduMarks).values({ examId: e.id, studentId: m.studentId, subject: m.subject, marks: m.marks }).onConflictDoUpdate({ target: [schema.eduMarks.examId, schema.eduMarks.studentId, schema.eduMarks.subject], set: { marks: m.marks } });
  }
  return { saved: v.marks.length };
}

// ── Home and accounting ─────────────────────────────────────────────────────

export async function home(s: Scope) {
  const today = todayIst();
  const [st] = await db.select({ active: sql<number>`count(*)::int` }).from(S).where(and(eq(S.orgId, s.orgId), eq(S.status, "active")));
  const [fees] = await db.select({ due: sql<number>`coalesce(sum(${F.amount} + ${F.tax} - ${F.paid}) filter (where ${F.status} in ('due','partial')), 0)::bigint`, overdue: sql<number>`coalesce(sum(${F.amount} + ${F.tax} - ${F.paid}) filter (where ${F.status} in ('due','partial') and ${F.dueDate} < ${today}::date), 0)::bigint` }).from(F).where(eq(F.orgId, s.orgId));
  const [month] = await db.select({ collected: sql<number>`coalesce(sum(${P.amount}), 0)::bigint` }).from(P).where(and(eq(P.orgId, s.orgId), gte(P.paidOn, `${today.slice(0, 7)}-01`)));
  const [att] = await db.select({ present: sql<number>`count(*) filter (where ${schema.eduAttendance.status} in ('present','late'))::int`, marked: sql<number>`count(*) filter (where ${schema.eduAttendance.status} <> 'leave')::int` }).from(schema.eduAttendance).where(and(eq(schema.eduAttendance.orgId, s.orgId), eq(schema.eduAttendance.date, today)));
  return { students: st.active, due: Number(fees.due), overdue: Number(fees.overdue), collectedThisMonth: Number(month.collected), today: { marked: att.marked, pct: att.marked ? Math.round((att.present / att.marked) * 1000) / 10 : null } };
}

/** Journal entries for Accounts: each fee (income and GST against receivables) and each payment (into its account). */
export async function educationWants(orgId: string) {
  const fees = await db.select({ f: F, student: S.name }).from(F).innerJoin(S, eq(S.id, F.studentId)).where(and(eq(F.orgId, orgId), ne(F.status, "waived")));
  const pays = await db.select({ p: P, fee: F.number, student: S.name }).from(P).innerJoin(F, eq(F.id, P.feeId)).innerJoin(S, eq(S.id, F.studentId)).where(eq(P.orgId, orgId));
  const out: { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: { key?: string; accountId?: string; debit: number; credit: number; memo?: string }[] }[] = [];
  for (const { f, student } of fees) {
    const half = Math.floor(f.tax / 2);
    out.push({ sourceType: "fee", sourceId: f.id, date: String(f.dueDate), narration: `${f.label} fee — ${student}`, sourceRef: f.number, party: student, lines: [{ key: "ar", debit: f.amount + f.tax, credit: 0 }, { key: "fee_income", debit: 0, credit: f.amount }, ...(f.tax ? [{ key: "cgst_out", debit: 0, credit: half }, { key: "sgst_out", debit: 0, credit: f.tax - half }] : [])] });
  }
  for (const { p, fee, student } of pays) {
    const into = p.accountId ? { accountId: p.accountId } : { key: p.method === "cash" ? "cash" : "bank" };
    out.push({ sourceType: "fee_payment", sourceId: p.id, date: String(p.paidOn), narration: `Fee received — ${student} (${fee})`, sourceRef: p.receiptNo, party: student, lines: [{ ...into, debit: p.amount, credit: 0 }, { key: "ar", debit: 0, credit: p.amount }] });
  }
  return out;
}
