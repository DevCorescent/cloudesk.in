// Education (schools, colleges, coaching): students in classes, fee plans
// split into instalments and raised as fee invoices (with each student's
// concession), receipts, attendance by day, and exams with marks turned into
// grades and report cards.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const text = (n: number) => z.string().trim().max(n).default("");
const money = z.number().int().min(0).max(1e11);

export const settingsSchema = z.object({
  /** The month the academic year starts (6 = June). */
  yearStartMonth: z.number().int().min(1).max(12).default(6),
  feePrefix: z.string().trim().min(1).max(10).default("FEE-"),
  receiptPrefix: z.string().trim().min(1).max(10).default("RCT-"),
  /** Percentage floors for grades, highest first. */
  grades: z.array(z.object({ min: z.number().min(0).max(100), grade: z.string().trim().min(1).max(4) })).min(1).max(12).default([{ min: 91, grade: "A1" }, { min: 81, grade: "A2" }, { min: 71, grade: "B1" }, { min: 61, grade: "B2" }, { min: 51, grade: "C1" }, { min: 41, grade: "C2" }, { min: 33, grade: "D" }, { min: 0, grade: "E" }]),
  passPct: z.number().min(0).max(100).default(33),
  /** Remind guardians this many days before a fee falls due (and when it's overdue). */
  remindDays: z.number().int().min(0).max(30).default(3),
});
export type EduSettings = z.infer<typeof settingsSchema>;

export const classSchema = z.object({ name: z.string().trim().min(1, "Name the class").max(60), section: text(10), year: z.string().trim().regex(/^\d{4}-\d{2}$/, "Like 2026-27"), teacherId: z.uuid().nullable().default(null), capacity: z.number().int().min(0).max(1000).default(0) });

export const studentSchema = z.object({
  admissionNo: text(30),
  name: z.string().trim().min(1, "Name the student").max(120),
  dob: day.nullable().default(null),
  gender: z.enum(["", "female", "male", "other"]).default(""),
  classId: z.uuid().nullable().default(null),
  rollNo: z.number().int().min(0).max(10_000).nullable().default(null),
  guardianName: text(120),
  guardianPhone: text(20),
  guardianEmail: z.union([z.email(), z.literal("")]).default(""),
  address: text(500),
  /** Fee concession as a percentage (siblings, merit, staff ward…). */
  concessionPct: z.number().min(0).max(100).default(0),
  concessionNote: text(120),
  status: z.enum(["active", "left", "alumni"]).default("active"),
  joinedOn: day.nullable().default(null),
});

export const planSchema = z.object({
  name: z.string().trim().min(1, "Name the fee plan").max(80),
  year: z.string().trim().regex(/^\d{4}-\d{2}$/, "Like 2026-27"),
  classIds: z.array(z.uuid()).min(1, "Pick the classes it's for").max(100),
  heads: z.array(z.object({ name: z.string().trim().min(1).max(60), amount: money, concession: z.boolean().default(true) })).min(1, "Add a fee head").max(30),
  installments: z.array(z.object({ label: z.string().trim().min(1).max(40), dueDate: day, pct: z.number().positive().max(100) })).min(1).max(12).refine((xs) => Math.abs(xs.reduce((n, x) => n + x.pct, 0) - 100) < 0.001, "Instalments must add up to 100%"),
  /** GST on the fee (0 for school education; coaching is usually 18%). */
  gstRate: z.number().min(0).max(28).default(0),
});
export type Plan = z.infer<typeof planSchema>;

export const paymentSchema = z.object({ amount: money.refine((v) => v > 0, "Enter an amount"), method: z.enum(["cash", "upi", "card", "bank", "cheque"]).default("upi"), paidOn: day, reference: text(80), accountId: z.uuid().nullable().default(null) });
export const examSchema = z.object({ name: z.string().trim().min(1, "Name the exam").max(80), classId: z.uuid(), date: day.nullable().default(null), subjects: z.array(z.object({ name: z.string().trim().min(1).max(60), max: z.number().positive().max(1000) })).min(1, "Add a subject").max(20) });
export const ATTENDANCE = ["present", "absent", "late", "leave"] as const;

/** A plan's amount for one student: heads with concession reduced by their percentage. Paise. */
export function feeFor(plan: Pick<Plan, "heads">, concessionPct: number) {
  return plan.heads.reduce((n, h) => n + (h.concession ? Math.round((h.amount * (100 - concessionPct)) / 100) : h.amount), 0);
}

/** Split an amount into instalments by percentage; whatever rounding leaves goes on the last, so they add up exactly. */
export function splitInstalments(total: number, installments: Plan["installments"]) {
  const parts = installments.map((i) => Math.floor((total * i.pct) / 100));
  parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0);
  return installments.map((i, k) => ({ ...i, amount: parts[k] }));
}

/** GST included on top of a fee: the tax (paise) at a rate. */
export const gstOn = (amount: number, rate: number) => Math.round((amount * rate) / 100);

export function grade(pct: number, scale: EduSettings["grades"]) {
  return [...scale].sort((a, b) => b.min - a.min).find((g) => pct >= g.min)?.grade ?? scale[scale.length - 1].grade;
}

/** A report card from marks: each subject's percentage and grade, the total, overall grade and pass/fail (every subject at the pass mark). */
export function reportCard(subjects: { name: string; max: number }[], marks: Record<string, number | null>, s: Pick<EduSettings, "grades" | "passPct">) {
  const rows = subjects.map((sub) => {
    const m = marks[sub.name];
    const pct = m === null || m === undefined ? null : Math.round((m / sub.max) * 1000) / 10;
    return { subject: sub.name, max: sub.max, marks: m ?? null, pct, grade: pct === null ? null : grade(pct, s.grades), passed: pct === null ? null : pct >= s.passPct };
  });
  const scored = rows.filter((r) => r.marks !== null);
  const total = scored.reduce((n, r) => n + (r.marks ?? 0), 0);
  const max = scored.reduce((n, r) => n + r.max, 0);
  const pct = max ? Math.round((total / max) * 1000) / 10 : null;
  return { rows, total, max, pct, grade: pct === null ? null : grade(pct, s.grades), result: !scored.length ? null : scored.length < rows.length ? "incomplete" : rows.every((r) => r.passed) ? "pass" : "fail" };
}

/** Attendance percentage: present and late count as attended; leave is excused (left out). */
export function attendancePct(marks: (typeof ATTENDANCE)[number][]) {
  const counted = marks.filter((m) => m !== "leave");
  if (!counted.length) return null;
  return Math.round((counted.filter((m) => m !== "absent").length / counted.length) * 1000) / 10;
}

/** The academic year a date falls in, like "2026-27". */
export function academicYear(date: string, startMonth: number) {
  const [y, m] = date.split("-").map(Number);
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
