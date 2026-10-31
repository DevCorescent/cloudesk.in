// Clinic (doctors, dentists, physiotherapy): patients, appointments with a
// token queue per doctor and day, consultations (vitals, notes, diagnosis,
// prescription, follow-up) that are signed and then only added to, and bills
// with receipts. Clinical notes are for clinicians only; the front desk works
// with demographics, appointments and bills.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const text = (n: number) => z.string().trim().max(n).default("");
const money = z.number().int().min(0).max(1e10);

export const settingsSchema = z.object({
  mrnPrefix: z.string().trim().min(1).max(8).default("MRN-"),
  billPrefix: z.string().trim().min(1).max(8).default("CB-"),
  slotMinutes: z.number().int().min(5).max(120).default(15),
  /** Services and their default fees (paise), e.g. Consultation ₹500. */
  services: z.array(z.object({ name: z.string().trim().min(1).max(80), fee: money })).max(100).default([{ name: "Consultation", fee: 500_00 }, { name: "Follow-up", fee: 300_00 }]),
  /** Doctor-specific consultation fees: userId → paise. */
  doctorFees: z.record(z.string(), money).default({}),
  footer: text(300),
  /** Members who see and write clinical notes; empty means owners and admins. */
  clinicians: z.array(z.uuid()).max(200).default([]),
});
export type ClinicSettings = z.infer<typeof settingsSchema>;

export const patientSchema = z.object({
  name: z.string().trim().min(1, "Name the patient").max(120),
  dob: day.nullable().default(null),
  ageYears: z.number().int().min(0).max(130).nullable().default(null),
  gender: z.enum(["", "female", "male", "other"]).default(""),
  phone: text(20),
  email: z.union([z.email(), z.literal("")]).default(""),
  address: text(500),
  bloodGroup: z.enum(["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).default(""),
  allergies: text(500),
  conditions: text(500),
  emergencyName: text(120),
  emergencyPhone: text(20),
  /** The patient agreed to their data being kept and used for their care. */
  consent: z.boolean().default(false),
});

export const APPT_STATUSES = ["booked", "arrived", "in_consultation", "done", "no_show", "cancelled"] as const;
export type ApptStatus = (typeof APPT_STATUSES)[number];
export const appointmentSchema = z.object({ patientId: z.uuid(), doctorId: z.uuid(), date: day, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable().default(null), minutes: z.number().int().min(5).max(240).default(15), type: z.enum(["consultation", "follow_up", "procedure"]).default("consultation"), reason: text(300) });

const vitalsSchema = z.object({ systolic: z.number().int().min(40).max(300).nullable().default(null), diastolic: z.number().int().min(20).max(200).nullable().default(null), pulse: z.number().int().min(20).max(250).nullable().default(null), tempC: z.number().min(30).max(45).nullable().default(null), spo2: z.number().int().min(40).max(100).nullable().default(null), weightKg: z.number().min(0.5).max(400).nullable().default(null), heightCm: z.number().min(30).max(250).nullable().default(null) }).prefault({});
export const rxItemSchema = z.object({ drug: z.string().trim().min(1, "Name the medicine").max(120), strength: text(40), dose: z.string().trim().max(40).default(""), days: z.number().int().min(0).max(365).default(0), instructions: text(200) });
export const visitSchema = z.object({
  appointmentId: z.uuid().nullable().default(null),
  patientId: z.uuid(),
  vitals: vitalsSchema,
  complaints: text(4000),
  findings: text(4000),
  diagnosis: text(500),
  icd10: z.string().trim().toUpperCase().regex(/^$|^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, "An ICD-10 code looks like J06.9").default(""),
  prescription: z.array(rxItemSchema).max(30).default([]),
  advice: text(2000),
  tests: text(1000),
  followUp: day.nullable().default(null),
});
export const billSchema = z.object({ patientId: z.uuid(), visitId: z.uuid().nullable().default(null), items: z.array(z.object({ name: z.string().trim().min(1).max(80), qty: z.number().int().min(1).max(1000).default(1), rate: money })).min(1, "Add a service").max(50), discount: money.default(0) });
export const paymentSchema = z.object({ amount: money.refine((v) => v > 0, "Enter an amount"), method: z.enum(["cash", "upi", "card", "bank", "insurance"]).default("upi"), paidOn: day, reference: text(80), accountId: z.uuid().nullable().default(null) });

/** BMI from weight and height, to one decimal, with its WHO band (Asian cut-offs are lower; shown as a guide). */
export function bmi(weightKg: number | null, heightCm: number | null) {
  if (!weightKg || !heightCm) return null;
  const v = Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
  return { value: v, band: v < 18.5 ? "underweight" : v < 25 ? "normal" : v < 30 ? "overweight" : "obese" };
}

/** Readings worth a doctor's eye. */
export function flags(v: z.infer<typeof vitalsSchema>) {
  const out: string[] = [];
  if (v.systolic && v.diastolic && (v.systolic >= 140 || v.diastolic >= 90)) out.push("High blood pressure");
  if (v.systolic && v.systolic < 90) out.push("Low blood pressure");
  if (v.spo2 !== null && v.spo2 < 94) out.push("Low oxygen saturation");
  if (v.tempC !== null && v.tempC >= 38) out.push("Fever");
  if (v.pulse !== null && (v.pulse > 100 || v.pulse < 50)) out.push(v.pulse > 100 ? "Fast pulse" : "Slow pulse");
  return out;
}

/** "1-0-1" style doses: tablets a day, if it can be read. */
export function perDay(dose: string) {
  const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(dose.trim());
  if (m) return Number(m[1]) + Number(m[2]) + Number(m[3]);
  const map: Record<string, number> = { OD: 1, BD: 2, BID: 2, TDS: 3, TID: 3, QID: 4, HS: 1 };
  return map[dose.trim().toUpperCase()] ?? null;
}

/** Age in whole years on a date (from date of birth, or as recorded). */
export function age(p: { dob: string | null; ageYears: number | null }, on: string) {
  if (p.dob) {
    const [y, m, d] = p.dob.split("-").map(Number);
    const [Y, M, D] = on.split("-").map(Number);
    return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
  }
  return p.ageYears;
}

export const billTotal = (items: { qty: number; rate: number }[], discount: number) => Math.max(0, items.reduce((n, i) => n + i.qty * i.rate, 0) - discount);
