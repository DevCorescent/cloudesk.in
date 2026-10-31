// HR & payroll: the shared vocabulary and the pure rules — working days, leave
// accrual, the salary structure from CTC, Indian statutory deductions (PF, ESI,
// professional tax, an income-tax estimate) and the monthly payslip. All money
// is in paise.
import { z } from "zod";

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
export const EMPLOYMENT_LABEL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Intern" };
export const EMP_STATUS_LABEL: Record<string, string> = { active: "Active", notice: "On notice", exited: "Left" };
export const CANDIDATE_STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;
export const STAGE_LABEL: Record<string, string> = { applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Not selected" };
export const CLAIM_CATEGORIES = ["Travel", "Lodging", "Food", "Fuel", "Mileage", "Per diem", "Phone & internet", "Client entertainment", "Office supplies", "Training", "Medical", "Other"];
export const ASSET_CATEGORIES = ["laptop", "phone", "monitor", "vehicle", "id_card", "furniture", "other"];

/** Professional tax slabs (monthly, by gross) for states that levy it. Verify with your state's latest notification. */
export const PT_STATES: Record<string, { name: string; slab: (gross: number, month: number, gender: string) => number }> = {
  MH: { name: "Maharashtra", slab: (g, m, gender) => (gender === "female" ? (g <= 2500000 ? 0 : m === 2 ? 30000 : 20000) : g <= 750000 ? 0 : g <= 1000000 ? 17500 : m === 2 ? 30000 : 20000) },
  KA: { name: "Karnataka", slab: (g) => (g < 2500000 ? 0 : 20000) },
  GJ: { name: "Gujarat", slab: (g) => (g < 1200000 ? 0 : 20000) },
  TS: { name: "Telangana", slab: (g) => (g <= 1500000 ? 0 : g <= 2000000 ? 15000 : 20000) },
  AP: { name: "Andhra Pradesh", slab: (g) => (g <= 1500000 ? 0 : g <= 2000000 ? 15000 : 20000) },
  WB: { name: "West Bengal", slab: (g) => (g <= 1000000 ? 0 : g <= 1500000 ? 11000 : g <= 2500000 ? 13000 : g <= 4000000 ? 15000 : 20000) },
  TN: { name: "Tamil Nadu (half-yearly, shown monthly)", slab: (g) => (g <= 2100000 ? 0 : g <= 3000000 ? 2250 : g <= 4500000 ? 5250 : g <= 6000000 ? 11500 : g <= 7500000 ? 17000 : 20830) },
};

const text = (max: number) => z.string().trim().max(max).default("");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const dayOrNull = day.nullable().default(null);

export const settingsSchema = z
  .object({
    company: z.object({ legalName: text(160), address: text(400), pan: text(10), tan: text(10), pfCode: text(30), esiCode: text(30), signatory: text(80), signatoryTitle: text(80) }).prefault({}),
    /** Working days, 0 = Sunday … 6 = Saturday. */
    workWeek: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5, 6]),
    shift: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/).default("09:30"), end: z.string().regex(/^\d{2}:\d{2}$/).default("18:30"), graceMin: z.number().int().min(0).max(240).default(15), fullDayHours: z.number().min(1).max(16).default(8), halfDayHours: z.number().min(0.5).max(12).default(4) }).prefault({}),
    attendance: z.object({ selfCheckIn: z.boolean().default(true), absentIfNoCheckIn: z.boolean().default(false), horeca: z.boolean().default(true) }).prefault({}),
    payroll: z
      .object({
        basicPct: z.number().min(10).max(100).default(50),
        hraPct: z.number().min(0).max(100).default(40),
        pf: z.boolean().default(true),
        pfOnFullBasic: z.boolean().default(false),
        esi: z.boolean().default(true),
        pt: z.boolean().default(true),
        ptState: z.string().max(4).default("MH"),
        tds: z.boolean().default(true),
      })
      .prefault({}),
    onboarding: z.array(z.object({ title: z.string().trim().min(1).max(120), owner: z.enum(["hr", "manager", "employee", "it"]).default("hr") })).max(40).default([
      { title: "Collect PAN, Aadhaar and bank details", owner: "hr" },
      { title: "Sign the appointment letter", owner: "employee" },
      { title: "Set up laptop and email", owner: "it" },
      { title: "Add to payroll and PF", owner: "hr" },
      { title: "First-week plan and buddy", owner: "manager" },
    ]),
    offboarding: z.array(z.object({ title: z.string().trim().min(1).max(120), owner: z.enum(["hr", "manager", "employee", "it"]).default("hr") })).max(40).default([
      { title: "Hand over work and documents", owner: "manager" },
      { title: "Return laptop, ID card and other assets", owner: "employee" },
      { title: "Remove access to email and tools", owner: "it" },
      { title: "Full and final settlement", owner: "hr" },
      { title: "Issue relieving and experience letters", owner: "hr" },
    ]),
    letters: z.array(z.object({ id: z.string().max(40), name: z.string().trim().min(1).max(80), body: z.string().max(20000) })).max(30).default([]),
    /** Overtime: time worked beyond the shift (all of it on a day off), paid at a multiple of the ordinary hourly rate. */
    overtime: z.object({ enabled: z.boolean().default(false), multiplier: z.number().min(1).max(4).default(2), minMinutes: z.number().int().min(0).max(240).default(30), requireApproval: z.boolean().default(true) }).prefault({}),
    /** Full and final settlement. */
    settlement: z.object({ noticeDays: z.number().int().min(0).max(180).default(30), gratuityYears: z.number().min(0).max(10).default(5), encashCodes: z.array(z.string().max(6)).max(20).default(["EL"]) }).prefault({}),
    /** Expense policy, mileage and per-diem rates (paise), and trip numbering. */
    expenses: z
      .object({
        limits: z.array(z.object({ category: z.string().trim().min(1).max(40), perClaim: z.number().int().min(0).max(1e10).default(0), perDay: z.number().int().min(0).max(1e10).default(0), receiptAbove: z.number().int().min(0).max(1e10).default(0) })).max(30).default([]),
        mileage: z.object({ car: z.number().int().min(0).max(100_000).default(0), bike: z.number().int().min(0).max(100_000).default(0) }).prefault({}),
        perDiem: z.object({ domestic: z.number().int().min(0).max(1e9).default(0), international: z.number().int().min(0).max(1e9).default(0) }).prefault({}),
        /** Refuse claims over a limit instead of flagging them for the approver. */
        blockOverLimit: z.boolean().default(false),
        tripPrefix: z.string().trim().min(1).max(10).default("TR-"),
      })
      .prefault({}),
  })
  .prefault({});
export type HrSettings = z.infer<typeof settingsSchema>;

export const employeeSchema = z.object({
  name: z.string().trim().min(1, "Add their name").max(120),
  email: z.string().trim().toLowerCase().max(200).default("").refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email"),
  phone: text(30),
  personalEmail: z.string().trim().toLowerCase().max(200).default(""),
  dob: dayOrNull,
  gender: z.enum(["", "female", "male", "other"]).default(""),
  address: text(400),
  emergency: z.object({ name: text(80), phone: text(30), relation: text(40) }).prefault({}),
  designation: text(120),
  departmentId: z.uuid().nullable().default(null),
  locationId: z.uuid().nullable().default(null),
  /** Where their pay is charged in the books (Settings → Organisation). */
  costCentreId: z.uuid().nullable().default(null),
  managerId: z.uuid().nullable().default(null),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  joinDate: day,
  probationEnd: dayOrNull,
  ctc: z.number().int().min(0).max(1e12).default(0),
  salary: z.object({ basicPct: z.number().min(10).max(100).optional(), hraPct: z.number().min(0).max(100).optional(), pf: z.boolean().optional(), esi: z.boolean().optional() }).prefault({}),
  bank: z.object({ name: text(80), account: text(30), ifsc: z.string().trim().toUpperCase().max(11).default("") }).prefault({}),
  ids: z.object({ pan: z.string().trim().toUpperCase().max(10).default(""), uan: text(12), esic: text(17), aadhaarLast4: z.string().regex(/^\d{0,4}$/).default("") }).prefault({}),
  custom: z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).default({}),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const leaveTypeSchema = z.object({ name: z.string().trim().min(1).max(60), code: z.string().trim().toUpperCase().min(1).max(6), quota: z.number().min(0).max(365).default(12), accrual: z.enum(["yearly", "monthly", "none"]).default("yearly"), carryForward: z.number().min(0).max(365).default(0), paid: z.boolean().default(true), allowHalf: z.boolean().default(true), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2a78d6"), active: z.boolean().default(true) });
export const DEFAULT_LEAVE_TYPES = [
  { name: "Casual leave", code: "CL", quota: 12, accrual: "monthly" as const, carryForward: 0, paid: true, color: "#2a78d6" },
  { name: "Sick leave", code: "SL", quota: 8, accrual: "yearly" as const, carryForward: 0, paid: true, color: "#e0567a" },
  { name: "Earned leave", code: "EL", quota: 15, accrual: "monthly" as const, carryForward: 30, paid: true, color: "#2f9e6e" },
  { name: "Unpaid leave", code: "LOP", quota: 0, accrual: "none" as const, carryForward: 0, paid: false, color: "#8b8b93" },
];

export const leaveRequestSchema = z.object({ leaveTypeId: z.uuid(), fromDate: day, toDate: day, half: z.enum(["none", "first", "second"]).default("none"), reason: text(500) });

// ─── Dates ───

export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);
export function eachDay(from: string, to: string) {
  const out: string[] = [];
  for (let d = parseDay(from); d <= parseDay(to); d = new Date(d.getTime() + 86400_000)) out.push(iso(d));
  return out;
}
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
export const monthDays = (month: string) => eachDay(`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`);
export const weekday = (s: string) => parseDay(s).getUTCDay();

/** Working days between two dates: not a weekly off, not a (non-optional) holiday. */
export function workingDays(from: string, to: string, workWeek: number[], holidays: Set<string>) {
  return eachDay(from, to).filter((d) => workWeek.includes(weekday(d)) && !holidays.has(d));
}

export function leaveDays(from: string, to: string, half: string, workWeek: number[], holidays: Set<string>) {
  const n = workingDays(from, to, workWeek, holidays).length;
  return half !== "none" && from === to ? (n ? 0.5 : 0) : n;
}

/** Days earned so far this year (or by a date): yearly = all at once (pro-rated for joiners), monthly = a twelfth per month started. */
export function accrued(t: { quota: number; accrual: string }, year: number, joinDate: string, today: string) {
  if (t.accrual === "none") return 0;
  const start = joinDate > `${year}-01-01` ? joinDate : `${year}-01-01`;
  if (start.slice(0, 4) !== String(year) && start > `${year}-12-31`) return 0;
  const startMonth = start.slice(0, 4) === String(year) ? Number(start.slice(5, 7)) : 1;
  if (t.accrual === "yearly") return round1((t.quota * (13 - startMonth)) / 12);
  const thisMonth = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) : today > `${year}-12-31` ? 12 : 0;
  const months = Math.max(0, thisMonth - startMonth + 1);
  return round1((t.quota * months) / 12);
}
const round1 = (n: number) => Math.round(n * 2) / 2;

// ─── Payroll ───

export type Line = { code: string; label: string; amount: number };
export type Structure = { monthlyCtc: number; basic: number; hra: number; special: number; gross: number; employerPf: number; employerEsi: number; esiApplies: boolean };

const PF_CEILING = 1500000; // ₹15,000 wages
/** Payroll is in whole rupees. */
const rupee = (paise: number) => Math.round(paise / 100) * 100;
const rupeeUp = (paise: number) => Math.ceil(paise / 100) * 100;
const ESI_LIMIT = 2100000; // ₹21,000 gross

/** The monthly salary structure from a yearly CTC. CTC includes the employer's PF (and ESI, where it applies). */
export function structure(ctc: number, p: { basicPct: number; hraPct: number; pf: boolean; pfOnFullBasic: boolean; esi: boolean }): Structure {
  const monthlyCtc = rupee(ctc / 12);
  const basic = rupee((monthlyCtc * p.basicPct) / 100);
  const hra = rupee((basic * p.hraPct) / 100);
  const employerPf = p.pf ? rupee(0.12 * (p.pfOnFullBasic ? basic : Math.min(basic, PF_CEILING))) : 0;
  let gross = monthlyCtc - employerPf;
  let employerEsi = 0;
  let esiApplies = false;
  // ESI is for gross up to ₹21,000; the employer's 3.25% also comes out of CTC.
  if (p.esi && gross / 1.0325 <= ESI_LIMIT) {
    esiApplies = true;
    const g = rupee(gross / 1.0325);
    employerEsi = gross - g;
    gross = g;
  }
  const special = Math.max(0, gross - basic - hra);
  return { monthlyCtc, basic, hra, special, gross: basic + hra + special, employerPf, employerEsi, esiApplies };
}

/** New tax regime (FY 2025-26): yearly tax on taxable income after the ₹75,000 standard deduction; nil up to ₹12 lakh (rebate); 4% cess. */
export function incomeTaxNewRegime(annualGross: number) {
  const taxable = Math.max(0, annualGross - 7500000);
  if (taxable <= 120000000) return 0;
  const slabs: [number, number][] = [
    [40000000, 0],
    [80000000, 0.05],
    [120000000, 0.1],
    [160000000, 0.15],
    [200000000, 0.2],
    [240000000, 0.25],
    [Infinity, 0.3],
  ];
  let tax = 0;
  let prev = 0;
  for (const [upto, rate] of slabs) {
    if (taxable > prev) tax += (Math.min(taxable, upto) - prev) * rate;
    prev = upto;
  }
  // Marginal relief just above ₹12 lakh: tax can't exceed the income above it.
  tax = Math.min(tax, taxable - 120000000);
  return Math.round(tax * 1.04);
}

export type PayslipInput = {
  ctc: number;
  rules: HrSettings["payroll"];
  overrides: { basicPct?: number; hraPct?: number; pf?: boolean; esi?: boolean };
  month: string;
  /** Days in the month the person was employed (join/exit). */
  employedDays: number;
  lopDays: number;
  gender: string;
  adjustments: { label: string; amount: number; kind: "earning" | "deduction" | "reimbursement" }[];
};

export function computePayslip(i: PayslipInput) {
  const p = { basicPct: i.overrides.basicPct ?? i.rules.basicPct, hraPct: i.overrides.hraPct ?? i.rules.hraPct, pf: (i.overrides.pf ?? true) && i.rules.pf, pfOnFullBasic: i.rules.pfOnFullBasic, esi: (i.overrides.esi ?? true) && i.rules.esi };
  const s = structure(i.ctc, p);
  const dim = daysInMonth(i.month);
  const paidDays = Math.max(0, Math.min(dim, i.employedDays) - i.lopDays);
  const f = paidDays / dim;
  const basic = rupee(s.basic * f);
  const hra = rupee(s.hra * f);
  const special = rupee(s.special * f);
  const extra = i.adjustments.filter((a) => a.kind === "earning");
  const earnings: Line[] = [
    { code: "BASIC", label: "Basic", amount: basic },
    { code: "HRA", label: "House rent allowance", amount: hra },
    { code: "SPECIAL", label: "Special allowance", amount: special },
    ...extra.map((a, n) => ({ code: `ADJ${n}`, label: a.label, amount: a.amount })),
  ].filter((l) => l.amount > 0 || ["BASIC", "HRA", "SPECIAL"].includes(l.code));
  const gross = earnings.reduce((a, l) => a + l.amount, 0);
  const pf = p.pf ? rupee(0.12 * (p.pfOnFullBasic ? basic : Math.min(basic, PF_CEILING))) : 0;
  const esi = s.esiApplies ? rupeeUp(gross * 0.0075) : 0;
  const month = Number(i.month.slice(5, 7));
  const ptRule = PT_STATES[i.rules.ptState];
  const pt = i.rules.pt && ptRule && gross > 0 ? ptRule.slab(gross, month, i.gender) : 0;
  // TDS spread evenly over the year on the full structure (plus this month's one-offs).
  const annual = s.gross * 12 + extra.reduce((a, l) => a + l.amount, 0);
  const tds = i.rules.tds && paidDays > 0 ? rupee(incomeTaxNewRegime(annual) / 12) : 0;
  const deductions: Line[] = [
    { code: "PF", label: "Provident fund (12%)", amount: pf },
    { code: "ESI", label: "ESI (0.75%)", amount: esi },
    { code: "PT", label: "Professional tax", amount: pt },
    { code: "TDS", label: "Income tax (TDS)", amount: tds },
    ...i.adjustments.filter((a) => a.kind === "deduction").map((a, n) => ({ code: `DED${n}`, label: a.label, amount: a.amount })),
  ].filter((l) => l.amount > 0);
  const reimbursements: Line[] = i.adjustments.filter((a) => a.kind === "reimbursement").map((a, n) => ({ code: `REIMB${n}`, label: a.label, amount: a.amount }));
  const totalDeductions = deductions.reduce((a, l) => a + l.amount, 0);
  const employer: Line[] = [
    { code: "EPF", label: "Employer PF (12%)", amount: pf },
    { code: "EESI", label: "Employer ESI (3.25%)", amount: s.esiApplies ? rupeeUp(gross * 0.0325) : 0 },
  ].filter((l) => l.amount > 0);
  const net = gross - totalDeductions + reimbursements.reduce((a, l) => a + l.amount, 0);
  return { days: { inMonth: dim, employed: Math.min(dim, i.employedDays), lop: i.lopDays, paid: paidDays }, structure: s, earnings, deductions, reimbursements, employer, gross, deductionsTotal: totalDeductions, net, cost: gross + employer.reduce((a, l) => a + l.amount, 0) };
}
export type Payslip = ReturnType<typeof computePayslip>;

/** {{name}}, {{designation}}, {{join_date}}… in HR letters. */
export function renderLetter(tmpl: string, v: Record<string, string>) {
  return tmpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => v[k] ?? "");
}

export const DEFAULT_LETTERS = [
  {
    id: "offer",
    name: "Offer letter",
    body: "{{date}}\n\nDear {{name}},\n\nWe are delighted to offer you the position of {{designation}} at {{company}}, in the {{department}} team, starting on {{join_date}}.\n\nYour annual cost to company will be {{ctc}}, as set out in the attached salary structure. You will be on probation until {{probation_end}}.\n\nPlease sign and return a copy of this letter to confirm your acceptance.\n\nWe look forward to welcoming you.\n\n{{signatory}}\n{{signatory_title}}, {{company}}",
  },
  {
    id: "experience",
    name: "Experience letter",
    body: "{{date}}\n\nTO WHOM IT MAY CONCERN\n\nThis is to certify that {{name}} worked with {{company}} as {{designation}} from {{join_date}} to {{exit_date}}.\n\nDuring this time we found them sincere and hardworking. We wish them the very best.\n\n{{signatory}}\n{{signatory_title}}, {{company}}",
  },
  {
    id: "relieving",
    name: "Relieving letter",
    body: "{{date}}\n\nDear {{name}},\n\nThis is to confirm that your resignation has been accepted and you are relieved from your duties as {{designation}} at {{company}} with effect from close of business on {{exit_date}}.\n\nYour full and final settlement will be processed as per company policy.\n\n{{signatory}}\n{{signatory_title}}, {{company}}",
  },
  {
    id: "salary",
    name: "Salary certificate",
    body: "{{date}}\n\nTO WHOM IT MAY CONCERN\n\nThis is to certify that {{name}} (employee no. {{emp_no}}) has been working with {{company}} as {{designation}} since {{join_date}}. Their current annual cost to company is {{ctc}}.\n\nThis certificate is issued at their request.\n\n{{signatory}}\n{{signatory_title}}, {{company}}",
  },
];

// ── HR+: shifts, overtime, settlement, records ──────────────────────────────

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30");
export const shiftSchema = z.object({ name: z.string().trim().min(1, "Name the shift").max(40), start: hhmm, end: hhmm, breakMinutes: z.number().int().min(0).max(480).default(0), graceMin: z.number().int().min(0).max(240).default(15), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2a78d6"), active: z.boolean().default(true) });
export const rosterSchema = z.object({ entries: z.array(z.object({ employeeId: z.uuid(), date: day, shiftId: z.uuid().nullable() })).min(1).max(5000) });
export const overtimeSchema = z.object({ employeeId: z.uuid(), date: day, minutes: z.number().int().min(1).max(1440), note: text(300) });
export const settlementLineSchema = z.object({ code: z.string().trim().min(1).max(20), label: z.string().trim().min(1).max(80), kind: z.enum(["earning", "recovery"]), amount: z.number().int().min(0).max(1e11), note: text(200) });
export const DOC_KINDS = { contract: "Employment contract", offer: "Offer letter", id_proof: "ID proof", certificate: "Certificate", policy: "Policy acknowledgement", visa: "Visa / work permit", other: "Other" } as const;
export const documentSchema = z.object({ employeeId: z.uuid(), kind: z.enum(Object.keys(DOC_KINDS) as [keyof typeof DOC_KINDS]).default("other"), title: z.string().trim().min(1, "Name the document").max(120), number: text(60), issuedOn: day.nullable().default(null), validTo: day.nullable().default(null), link: z.union([z.literal(""), z.url("Use a web link")]).default(""), notes: text(1000) });
export const TRAINING_KINDS = { course: "Course", workshop: "Workshop", certification: "Certification", induction: "Induction", safety: "Safety" } as const;
export const trainingSchema = z.object({ title: z.string().trim().min(1, "Name the training").max(120), kind: z.enum(Object.keys(TRAINING_KINDS) as [keyof typeof TRAINING_KINDS]).default("course"), provider: text(120), hours: z.number().min(0).max(10000).default(0), costPerPerson: z.number().int().min(0).max(1e10).default(0), validMonths: z.number().int().min(0).max(120).default(0), mandatory: z.boolean().default(false), departmentIds: z.array(z.uuid()).max(100).default([]), active: z.boolean().default(true) });
export const CASE_ACTIONS = { none: "None", verbal_warning: "Verbal warning", written_warning: "Written warning", final_warning: "Final warning", suspension: "Suspension", termination: "Termination" } as const;
export const caseSchema = z.object({ kind: z.enum(["grievance", "disciplinary"]), employeeId: z.uuid().nullable().default(null), anonymous: z.boolean().default(false), category: text(60), subject: z.string().trim().min(1, "Say what it's about").max(160), description: text(4000) });
export const positionSchema = z.object({ departmentId: z.uuid().nullable().default(null), title: z.string().trim().min(1, "Name the role").max(80), planned: z.number().int().min(0).max(10000).default(1), budgetCtc: z.number().int().min(0).max(1e11).default(0), byDate: day.nullable().default(null), notes: text(500) });

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Working minutes in a shift (across midnight for night shifts), less its break. */
export const shiftMinutes = (sh: { start: string; end: string; breakMinutes: number }) => ((mins(sh.end) - mins(sh.start) + 1440) % 1440 || 1440) - sh.breakMinutes;
/** Late: checked in after the shift's start plus grace (minutes since midnight, IST). */
export const isLate = (checkInMinute: number, sh: { start: string; graceMin: number }) => {
  const d = (checkInMinute - mins(sh.start) + 1440) % 1440;
  return d > sh.graceMin && d < 12 * 60;
};
/** Overtime on a day: past the shift's working minutes (everything on a day off), counted once it reaches the minimum. */
export function overtimeMinutes(worked: number, shiftMins: number | null, minMinutes: number) {
  const extra = shiftMins === null ? worked : worked - shiftMins;
  return extra >= Math.max(1, minMinutes) ? extra : 0;
}
/** Pay for overtime: the ordinary hourly rate (monthly basic ÷ 26 days ÷ day's hours) times the multiplier. */
export const overtimePay = (minutes: number, monthlyBasic: number, fullDayHours: number, multiplier: number) => rupee((monthlyBasic / 26 / fullDayHours) * (minutes / 60) * multiplier);

/** Years of service counted for gratuity: whole years, plus one for six months or more over. */
export function serviceYears(joinDate: string, lastDay: string) {
  const a = parseDay(joinDate);
  const b = parseDay(lastDay);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  let months = b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, counted: years + (months >= 6 ? 1 : 0) };
}

export const GRATUITY_CAP = 20_00_000_00;
/** Gratuity under the Payment of Gratuity Act: 15 days' basic for each counted year (basic ÷ 26 × 15), capped at ₹20 lakh, once the minimum service is met. */
export function gratuity(monthlyBasic: number, joinDate: string, lastDay: string, minYears: number) {
  const sv = serviceYears(joinDate, lastDay);
  const exact = sv.years + sv.months / 12;
  if (exact < minYears) return { eligible: false, years: sv.counted, amount: 0 };
  return { eligible: true, years: sv.counted, amount: Math.min(GRATUITY_CAP, rupee((monthlyBasic / 26) * 15 * sv.counted)) };
}

/** The usual lines of a full and final settlement; the final month's salary is paid by payroll. */
export function settlementLines(i: { monthlyBasic: number; monthlyGross: number; joinDate: string; lastDay: string; noticeFrom: string | null; noticeDays: number; encashDays: number; gratuityYears: number }) {
  const lines: { code: string; label: string; kind: "earning" | "recovery"; amount: number; note: string }[] = [];
  if (i.encashDays > 0) lines.push({ code: "LEAVE", label: "Leave encashment", kind: "earning", amount: rupee((i.monthlyBasic / 26) * i.encashDays), note: `${i.encashDays} day${i.encashDays === 1 ? "" : "s"} at basic ÷ 26` });
  const g = gratuity(i.monthlyBasic, i.joinDate, i.lastDay, i.gratuityYears);
  if (g.eligible && g.amount > 0) lines.push({ code: "GRATUITY", label: "Gratuity", kind: "earning", amount: g.amount, note: `${g.years} year${g.years === 1 ? "" : "s"} × 15 days' basic` });
  if (i.noticeDays > 0) {
    const served = i.noticeFrom ? Math.max(0, Math.round((parseDay(i.lastDay).getTime() - parseDay(i.noticeFrom).getTime()) / 86_400_000) + 1) : 0;
    const short = Math.max(0, i.noticeDays - served);
    if (short > 0) lines.push({ code: "NOTICE", label: "Notice period not served", kind: "recovery", amount: rupee((i.monthlyGross / 30) * short), note: `${short} of ${i.noticeDays} days at gross ÷ 30` });
  }
  return lines;
}

// ── Expense & travel ─────────────────────────────────────────────────────────

export type ExpensePolicy = HrSettings["expenses"];
export const VEHICLES = ["car", "bike"] as const;
export const TRIP_MODES = ["Flight", "Train", "Bus", "Car", "Other"] as const;

export const tripSchema = z.object({
  purpose: z.string().trim().min(1, "Say what the trip is for").max(300),
  destination: z.string().trim().min(1, "Where to?").max(160),
  international: z.boolean().default(false),
  departOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(TRIP_MODES).default("Flight"),
  estimate: z.number().int().min(0).max(1e10).default(0),
  advance: z.number().int().min(0).max(1e10).default(0),
  projectId: z.uuid().nullable().default(null),
  notes: z.string().trim().max(2000).default(""),
});

export type PolicyFlag = { code: "over_limit" | "over_daily" | "no_receipt"; message: string };
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * What a claim breaks in the policy: over the per-claim limit, over the daily
 * limit once the person's other claims in that category that day are added,
 * or no receipt above the amount that needs one.
 */
export function policyCheck(c: { category: string; amount: number; receiptUrl: string }, p: ExpensePolicy, sameDay = 0): PolicyFlag[] {
  const rule = p.limits.find((l) => l.category.toLowerCase() === c.category.toLowerCase());
  const out: PolicyFlag[] = [];
  if (!rule) return out;
  if (rule.perClaim && c.amount > rule.perClaim) out.push({ code: "over_limit", message: `${rupees(c.amount - rule.perClaim)} over the ${rupees(rule.perClaim)} limit for ${rule.category}` });
  if (rule.perDay && sameDay + c.amount > rule.perDay) out.push({ code: "over_daily", message: `${rupees(sameDay + c.amount)} on ${rule.category} that day, over the ${rupees(rule.perDay)} daily limit` });
  if (rule.receiptAbove && c.amount > rule.receiptAbove && !c.receiptUrl) out.push({ code: "no_receipt", message: `A receipt is needed above ${rupees(rule.receiptAbove)}` });
  return out;
}

/** Mileage: kilometres at the vehicle's rate (paise per km). */
export const mileageAmount = (km: number, vehicle: (typeof VEHICLES)[number], p: ExpensePolicy) => Math.round(km * p.mileage[vehicle]);

/** Days away, counting the day you leave and the day you're back. */
export const tripDays = (departOn: string, returnOn: string) => Math.max(0, Math.round((Date.parse(`${returnOn}T00:00:00Z`) - Date.parse(`${departOn}T00:00:00Z`)) / 86_400_000) + 1);

export const perDiemFor = (t: { departOn: string; returnOn: string; international: boolean }, p: ExpensePolicy) => tripDays(t.departOn, t.returnOn) * (t.international ? p.perDiem.international : p.perDiem.domestic);

/** Settling a trip: what was claimed against the advance paid. Positive pays the person; negative they return. */
export const tripBalance = (advance: number, claimed: number) => ({ claimed, advance, net: claimed - advance });

/** A card statement line's identity, so importing the same statement twice adds nothing. */
export const cardFingerprint = (t: { date: string; amount: number; merchant: string; reference: string }) => `${t.date}|${t.amount}|${t.merchant.trim().toLowerCase().replace(/\s+/g, " ")}|${t.reference.trim()}`;
