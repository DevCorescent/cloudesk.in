// Governance, risk & compliance: a risk register scored likelihood × impact
// (before and after controls), controls and their tests, a compliance
// calendar of recurring obligations (with the usual Indian statutory dates as
// a starting pack), policies people acknowledge, incidents, internal audits
// with findings, checks for duties that shouldn't sit with one person, fraud
// indicators, and an emissions log.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const text = (max: number) => z.string().trim().max(max).default("");
const uuidOrNull = z.uuid().nullable().default(null);
const level = z.number().int().min(1).max(5);

// ── Risks and controls ──────────────────────────────────────────────────────

export const RISK_CATEGORIES = ["strategic", "operational", "financial", "compliance", "legal", "technology", "security", "people", "reputation", "supply_chain", "environment"] as const;
export const TREATMENTS = ["reduce", "accept", "transfer", "avoid"] as const;
export const RISK_STATUSES = ["open", "treating", "closed"] as const;

export const riskSchema = z.object({
  title: z.string().trim().min(1, "Name the risk").max(200),
  description: text(4000),
  category: z.enum(RISK_CATEGORIES).default("operational"),
  ownerId: uuidOrNull,
  likelihood: level.default(3),
  impact: level.default(3),
  residualLikelihood: level.nullable().default(null),
  residualImpact: level.nullable().default(null),
  treatment: z.enum(TREATMENTS).default("reduce"),
  plan: text(4000),
  status: z.enum(RISK_STATUSES).default("open"),
  reviewDate: day.nullable().default(null),
  controlIds: z.array(z.uuid()).max(50).default([]),
});

export const score = (likelihood: number, impact: number) => likelihood * impact;
/** Ratings on the 1–25 scale: 1–4 low, 5–9 medium, 10–16 high, 20–25 critical. */
export function rating(s: number): "low" | "medium" | "high" | "critical" {
  return s >= 20 ? "critical" : s >= 10 ? "high" : s >= 5 ? "medium" : "low";
}

/** Counts in a 5×5 grid (impact rows from 5 down, likelihood columns 1–5), for the heat map. */
export function heat(risks: { likelihood: number; impact: number }[]) {
  const grid = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
  for (const r of risks) grid[5 - r.impact][r.likelihood - 1]++;
  return grid;
}

export const CONTROL_TYPES = ["preventive", "detective", "corrective"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly", "adhoc"] as const;
export const controlSchema = z.object({
  code: z.string().trim().min(1, "Give it a code").max(20),
  name: z.string().trim().min(1, "Name the control").max(200),
  description: text(4000),
  ownerId: uuidOrNull,
  type: z.enum(CONTROL_TYPES).default("preventive"),
  frequency: z.enum(FREQUENCIES).default("quarterly"),
  nextTestDue: day.nullable().default(null),
  active: z.boolean().default(true),
});
export const testSchema = z.object({ testedOn: day, result: z.enum(["effective", "partly", "ineffective"]), notes: text(4000), documentId: uuidOrNull });

const MONTHS: Record<(typeof FREQUENCIES)[number], number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12, adhoc: 0 };
/** When a control is next due for testing after a test on `on`. */
export function nextTest(on: string, frequency: (typeof FREQUENCIES)[number]) {
  const m = MONTHS[frequency];
  if (!m) return null;
  const d = new Date(`${on}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
}

// ── Compliance calendar ─────────────────────────────────────────────────────

/** How an obligation repeats: monthly on a day (of the following month, for a month's return), on fixed dates each year, or once. */
export const recurrenceSchema = z.discriminatedUnion("freq", [
  z.object({ freq: z.literal("monthly"), day: z.number().int().min(1).max(31), nextMonth: z.boolean().default(true), marchOverride: z.string().regex(/^\d{2}-\d{2}$/).nullable().default(null) }),
  z.object({ freq: z.literal("dates"), dates: z.array(z.string().regex(/^\d{2}-\d{2}$/, "Use MM-DD")).min(1).max(12) }),
  z.object({ freq: z.literal("once"), date: day }),
]);
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const obligationSchema = z.object({
  title: z.string().trim().min(1, "What has to be done?").max(200),
  authority: text(120),
  category: z.enum(["gst", "income_tax", "tds", "payroll", "company_law", "labour", "licence", "other"]).default("other"),
  recurrence: recurrenceSchema,
  ownerId: uuidOrNull,
  remindDays: z.number().int().min(0).max(60).default(5),
  notes: text(2000),
  active: z.boolean().default(true),
});

const pad = (n: number) => String(n).padStart(2, "0");
const monthName = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const clampDay = (y: number, m: number, d: number) => Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());

/** Each due date of an obligation between two dates (inclusive), with the period it's for. */
export function occurrences(r: Recurrence, from: string, to: string): { period: string; label: string; due: string }[] {
  const out: { period: string; label: string; due: string }[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (r.freq === "once") return r.date >= from && r.date <= to ? [{ period: r.date, label: "Once", due: r.date }] : [];
  if (r.freq === "monthly") {
    // Every period whose due date could fall in the window: from the month before `from` to the month of `to`.
    const shift = r.nextMonth ? 1 : 0;
    for (let i = fy * 12 + (fm - 1) - shift; i <= ty * 12 + (tm - 1); i++) {
      const y = Math.floor(i / 12);
      const m = (i % 12) + 1;
      const j = i + shift;
      const dy = Math.floor(j / 12);
      const dm = (j % 12) + 1;
      // e.g. TDS for March is due on 30 April, not 7 April.
      const due = r.marchOverride && m === 3 ? `${dy}-${r.marchOverride}` : `${dy}-${pad(dm)}-${pad(clampDay(dy, dm, r.day))}`;
      if (due >= from && due <= to) out.push({ period: `${y}-${pad(m)}`, label: monthName(y, m), due });
    }
    return out;
  }
  for (let y = fy; y <= ty; y++)
    for (const md of r.dates) {
      const [m, d] = md.split("-").map(Number);
      const due = `${y}-${pad(m)}-${pad(clampDay(y, m, d))}`;
      if (due >= from && due <= to) out.push({ period: due, label: due, due });
    }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/**
 * A starting pack of common Indian statutory dates, to edit to the business.
 * These are the standard due dates; the government often extends them, and
 * some depend on turnover, state or the AGM date — check before relying on one.
 */
export const INDIA_PACK: { key: string; title: string; authority: string; category: z.infer<typeof obligationSchema>["category"]; recurrence: Recurrence; notes: string }[] = [
  { key: "gstr1", title: "GSTR-1 (outward supplies)", authority: "GSTN", category: "gst", recurrence: { freq: "monthly", day: 11, nextMonth: true, marchOverride: null }, notes: "Monthly filers. Quarterly (QRMP) filers file by the 13th after the quarter." },
  { key: "gstr3b", title: "GSTR-3B (summary return and tax)", authority: "GSTN", category: "gst", recurrence: { freq: "monthly", day: 20, nextMonth: true, marchOverride: null }, notes: "Monthly filers. QRMP filers: 22nd or 24th after the quarter, by state." },
  { key: "gstr9", title: "GSTR-9 (GST annual return)", authority: "GSTN", category: "gst", recurrence: { freq: "dates", dates: ["12-31"] }, notes: "For the financial year ended the previous March." },
  { key: "tds_pay", title: "TDS / TCS deposit", authority: "Income Tax Department", category: "tds", recurrence: { freq: "monthly", day: 7, nextMonth: true, marchOverride: "04-30" }, notes: "Tax deducted in March is due by 30 April." },
  { key: "tds_return", title: "TDS returns (24Q, 26Q)", authority: "Income Tax Department", category: "tds", recurrence: { freq: "dates", dates: ["07-31", "10-31", "01-31", "05-31"] }, notes: "Quarterly, for the quarter just ended." },
  { key: "form16", title: "Form 16 to employees", authority: "Income Tax Department", category: "tds", recurrence: { freq: "dates", dates: ["06-15"] }, notes: "" },
  { key: "advance_tax", title: "Advance tax instalment", authority: "Income Tax Department", category: "income_tax", recurrence: { freq: "dates", dates: ["06-15", "09-15", "12-15", "03-15"] }, notes: "15%, 45%, 75% and 100% of the year's estimated tax." },
  { key: "tax_audit", title: "Tax audit report (Form 3CA/3CB-3CD)", authority: "Income Tax Department", category: "income_tax", recurrence: { freq: "dates", dates: ["09-30"] }, notes: "If a tax audit applies." },
  { key: "itr_audit", title: "Income tax return (audited)", authority: "Income Tax Department", category: "income_tax", recurrence: { freq: "dates", dates: ["10-31"] }, notes: "Companies and others whose accounts are audited." },
  { key: "pf", title: "PF contribution and ECR", authority: "EPFO", category: "payroll", recurrence: { freq: "monthly", day: 15, nextMonth: true, marchOverride: null }, notes: "" },
  { key: "esi", title: "ESI contribution", authority: "ESIC", category: "payroll", recurrence: { freq: "monthly", day: 15, nextMonth: true, marchOverride: null }, notes: "" },
  { key: "aoc4", title: "AOC-4 (financial statements to the ROC)", authority: "MCA", category: "company_law", recurrence: { freq: "dates", dates: ["10-30"] }, notes: "Within 30 days of the AGM; shown for an AGM on 30 September." },
  { key: "mgt7", title: "MGT-7 (annual return to the ROC)", authority: "MCA", category: "company_law", recurrence: { freq: "dates", dates: ["11-29"] }, notes: "Within 60 days of the AGM; shown for an AGM on 30 September." },
  { key: "dir3kyc", title: "DIR-3 KYC for directors", authority: "MCA", category: "company_law", recurrence: { freq: "dates", dates: ["09-30"] }, notes: "" },
];

// ── Policies, incidents, audits ─────────────────────────────────────────────

export const policySchema = z.object({
  title: z.string().trim().min(1, "Name the policy").max(200),
  body: z.string().trim().min(1, "Write the policy").max(100_000),
  ownerId: uuidOrNull,
  effectiveDate: day.nullable().default(null),
  reviewDate: day.nullable().default(null),
  /** Who must read and acknowledge it: everyone, or members with these roles. */
  audience: z.array(z.string().max(30)).max(10).default([]),
});

export const INCIDENT_TYPES = ["security", "data_breach", "fraud", "safety", "compliance", "service", "other"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const INCIDENT_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export const incidentSchema = z.object({
  title: z.string().trim().min(1, "What happened?").max(200),
  type: z.enum(INCIDENT_TYPES).default("other"),
  severity: z.enum(SEVERITIES).default("medium"),
  occurredAt: z.iso.datetime({ offset: true }),
  description: z.string().trim().min(1, "Describe what happened").max(10_000),
  personalData: z.boolean().default(false),
});
export const incidentUpdateSchema = z.object({ status: z.enum(INCIDENT_STATUSES), severity: z.enum(SEVERITIES), ownerId: z.uuid().nullable(), rootCause: z.string().max(10_000), actions: z.string().max(10_000), riskId: z.uuid().nullable() }).partial();

export const auditSchema = z.object({ title: z.string().trim().min(1, "Name the audit").max(200), scope: text(4000), auditorId: uuidOrNull, periodFrom: day.nullable().default(null), periodTo: day.nullable().default(null), status: z.enum(["planned", "fieldwork", "reporting", "closed"]).default("planned") });
export const findingSchema = z.object({ title: z.string().trim().min(1, "Name the finding").max(200), severity: z.enum(SEVERITIES).default("medium"), detail: text(10_000), recommendation: text(4000), ownerId: uuidOrNull, dueDate: day.nullable().default(null), response: text(4000), status: z.enum(["open", "closed"]).default("open") });

// ── Segregation of duties ───────────────────────────────────────────────────

/** Pairs of duties one person shouldn't hold together. */
export const SOD_RULES = [
  { key: "buy_pay", a: "inventory:write", b: "accounts:write", label: "Raises purchase orders and records supplier bills and payments" },
  { key: "payroll_hr", a: "hr:manage", b: "hr:payroll", label: "Changes employee records and runs payroll" },
  { key: "sell_collect", a: "sales:write", b: "invoices:manage", label: "Takes sales orders and manages invoices and receipts" },
] as const;

/** Members whose role grants both sides of a rule. */
export function roleConflicts(members: { id: string; name: string; role: string }[], can: (role: string, p: string) => boolean) {
  return SOD_RULES.map((r) => ({ ...r, members: members.filter((m) => can(m.role, r.a) && can(m.role, r.b)) })).filter((r) => r.members.length);
}

// ── Fraud indicators ────────────────────────────────────────────────────────

const digits = (s: string | undefined | null) => (s ?? "").replace(/\D/g, "");
const pan = (s: string | undefined | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** A PAN from a supplier's PAN or GSTIN (characters 3–12). */
export const supplierPan = (s: { pan: string; gstin: string }) => pan(s.pan) || (s.gstin.length === 15 ? s.gstin.slice(2, 12).toUpperCase() : "");

export type Indicator = { kind: string; title: string; detail: string; link: string };

/** A supplier paid into an employee's bank account, or sharing an employee's PAN. */
export function supplierEmployeeMatches(suppliers: { id: string; name: string; pan: string; gstin: string; account: string }[], employees: { id: string; name: string; pan: string; account: string }[]): Indicator[] {
  const out: Indicator[] = [];
  for (const s of suppliers) {
    const acc = digits(s.account);
    const sp = supplierPan(s);
    for (const e of employees) {
      if (acc.length >= 8 && acc === digits(e.account)) out.push({ kind: "supplier_employee_bank", title: `${s.name} shares a bank account with ${e.name}`, detail: `The supplier's bank account ending ${acc.slice(-4)} is also on ${e.name}'s employee record.`, link: "/inventory/suppliers" });
      if (sp.length === 10 && sp === pan(e.pan)) out.push({ kind: "supplier_employee_pan", title: `${s.name} has ${e.name}'s PAN`, detail: `The supplier's PAN ${sp} is also on ${e.name}'s employee record.`, link: "/inventory/suppliers" });
    }
  }
  return out;
}

/** Different suppliers paid into the same bank account. */
export function sharedSupplierAccounts(suppliers: { id: string; name: string; account: string }[]): Indicator[] {
  const by = new Map<string, string[]>();
  for (const s of suppliers) {
    const acc = digits(s.account);
    if (acc.length >= 8) by.set(acc, [...(by.get(acc) ?? []), s.name]);
  }
  return [...by.entries()].filter(([, names]) => names.length > 1).map(([acc, names]) => ({ kind: "shared_supplier_bank", title: `${names.length} suppliers share one bank account`, detail: `${names.join(", ")} all use the account ending ${acc.slice(-4)}.`, link: "/inventory/suppliers" }));
}

/** Several bills from one supplier on one day, each under a limit but together over it — a sign of splitting to stay under approval. */
export function splitBills(bills: { id: string; supplier: string; date: string; total: number }[], limit: number): Indicator[] {
  if (!limit) return [];
  const by = new Map<string, typeof bills>();
  for (const b of bills) if (b.total < limit) by.set(`${b.supplier.toLowerCase()}|${b.date}`, [...(by.get(`${b.supplier.toLowerCase()}|${b.date}`) ?? []), b]);
  const out: Indicator[] = [];
  for (const group of by.values()) {
    const sum = group.reduce((n, b) => n + b.total, 0);
    if (group.length >= 2 && sum >= limit) out.push({ kind: "split_bills", title: `${group.length} bills from ${group[0].supplier} on ${group[0].date}`, detail: `Each is under ₹${(limit / 100).toLocaleString("en-IN")}, together ₹${(sum / 100).toLocaleString("en-IN")}.`, link: `/accounts/bills/${group[0].id}` });
  }
  return out;
}

/** Bills for large round sums (multiples of ₹10,000, ₹50,000 or more) — worth checking for support. */
export function roundBills(bills: { id: string; supplier: string; number: string; total: number }[]): Indicator[] {
  return bills.filter((b) => b.total >= 50_000_00 && b.total % 10_000_00 === 0).map((b) => ({ kind: "round_bill", title: `Round-sum bill from ${b.supplier}`, detail: `${b.number} is exactly ₹${(b.total / 100).toLocaleString("en-IN")}.`, link: `/accounts/bills/${b.id}` }));
}

// ── Emissions (ESG) ─────────────────────────────────────────────────────────

/**
 * Emission factors in kg CO2 per unit. Defaults are commonly used figures —
 * electricity from India's grid (CEA CO2 baseline database, about 0.72 kg per
 * kWh in recent versions), fuels from IPCC defaults. Check and set your own.
 */
export const DEFAULT_FACTORS = { electricity_kwh: 0.716, diesel_l: 2.68, petrol_l: 2.31, lpg_kg: 2.98, cng_kg: 2.69 } as const;
export type FactorKey = keyof typeof DEFAULT_FACTORS;
export const FACTOR_LABEL: Record<FactorKey, { label: string; unit: string; scope: 1 | 2 }> = { electricity_kwh: { label: "Electricity", unit: "kWh", scope: 2 }, diesel_l: { label: "Diesel", unit: "litres", scope: 1 }, petrol_l: { label: "Petrol", unit: "litres", scope: 1 }, lpg_kg: { label: "LPG", unit: "kg", scope: 1 }, cng_kg: { label: "CNG", unit: "kg", scope: 1 } };
export const esgSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"), metric: z.enum(Object.keys(DEFAULT_FACTORS) as [FactorKey, ...FactorKey[]]), quantity: z.number().min(0).max(1e10), note: text(500) });

export const settingsSchema = z.object({
  factors: z.object(Object.fromEntries(Object.entries(DEFAULT_FACTORS).map(([k, v]) => [k, z.number().min(0).max(100).default(v)])) as { [K in FactorKey]: z.ZodDefault<z.ZodNumber> }).prefault({}),
  /** Bills under this (paise) that add up over it on one day from one supplier are flagged. */
  splitLimit: z.number().int().min(0).max(1e12).default(1_00_000_00),
  riskReviewMonths: z.number().int().min(1).max(36).default(6),
});
export type GrcSettings = z.infer<typeof settingsSchema>;

/** Monthly emissions (kg CO2) by scope from activity quantities. */
export function emissions(rows: { month: string; metric: FactorKey; quantity: number }[], factors: Record<FactorKey, number>) {
  const by = new Map<string, { month: string; scope1: number; scope2: number }>();
  for (const r of rows) {
    const e = by.get(r.month) ?? { month: r.month, scope1: 0, scope2: 0 };
    const kg = r.quantity * factors[r.metric];
    if (FACTOR_LABEL[r.metric].scope === 1) e.scope1 += kg;
    else e.scope2 += kg;
    by.set(r.month, e);
  }
  return [...by.values()].map((e) => ({ ...e, scope1: Math.round(e.scope1), scope2: Math.round(e.scope2), total: Math.round(e.scope1 + e.scope2) })).sort((a, b) => a.month.localeCompare(b.month));
}
