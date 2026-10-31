// Accounting & GST: the chart of accounts a workspace starts with, the shapes
// of journals, bills and settings, and the small rules (signs, balancing,
// financial years) shared by the server and the screens. Money is in paise.
import { z } from "zod";
import { tdsSettingsSchema } from "./tds";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export const ACCOUNT_TYPES: { id: AccountType; label: string }[] = [
  { id: "asset", label: "Assets" },
  { id: "liability", label: "Liabilities" },
  { id: "equity", label: "Equity" },
  { id: "income", label: "Income" },
  { id: "expense", label: "Expenses" },
];
export const SUBTYPES = ["bank", "cash", "receivable", "payable", "tax_in", "tax_out", "inventory", "fixed", "current", "other"] as const;

/** Assets and expenses grow with debits; the rest with credits. */
export const debitNormal = (t: string) => t === "asset" || t === "expense";
/** A balance shown the way people read it: positive in the account's normal direction. */
export const natural = (type: string, debit: number, credit: number) => (debitNormal(type) ? debit - credit : credit - debit);

type Seed = { code: string; name: string; type: AccountType; subtype?: (typeof SUBTYPES)[number]; key?: string; description?: string };

/** A chart of accounts that suits most small Indian businesses; every account can be renamed and more added. */
export const DEFAULT_ACCOUNTS: Seed[] = [
  { code: "1000", name: "Cash in hand", type: "asset", subtype: "cash", key: "cash" },
  { code: "1010", name: "Bank account", type: "asset", subtype: "bank", key: "bank" },
  { code: "1020", name: "Online payments to settle", type: "asset", subtype: "current", key: "clearing", description: "Store orders paid online, until the gateway settles them to your bank." },
  { code: "1100", name: "Accounts receivable", type: "asset", subtype: "receivable", key: "ar" },
  { code: "1200", name: "Inventory", type: "asset", subtype: "inventory", key: "inventory" },
  { code: "1300", name: "Input CGST", type: "asset", subtype: "tax_in", key: "cgst_in" },
  { code: "1301", name: "Input SGST", type: "asset", subtype: "tax_in", key: "sgst_in" },
  { code: "1302", name: "Input IGST", type: "asset", subtype: "tax_in", key: "igst_in" },
  { code: "1350", name: "Due from group companies", type: "asset", subtype: "current", key: "ic_receivable", description: "What other companies in the group owe this one; eliminated when the group is consolidated." },
  { code: "1400", name: "Advances and deposits", type: "asset", subtype: "current", key: "advances" },
  { code: "1420", name: "Staff advances", type: "asset", subtype: "current", key: "staff_advances", description: "Travel advances paid to staff and personal spends on company cards, until they're settled or repaid." },
  { code: "1430", name: "TDS receivable", type: "asset", subtype: "current", key: "tds_receivable", description: "Tax your clients deducted from what they paid you (claim it against your income tax; check Form 26AS)." },
  { code: "1440", name: "Retention receivable", type: "asset", subtype: "current", key: "retention_receivable", description: "Money clients hold back from running bills until the defect liability period ends." },
  { code: "1410", name: "Prepaid expenses", type: "asset", subtype: "current", key: "prepaid", description: "Paid up front and spread over the months it covers." },
  { code: "1500", name: "Fixed assets", type: "asset", subtype: "fixed", key: "fixed_assets" },
  { code: "1510", name: "Accumulated depreciation", type: "asset", subtype: "fixed", key: "acc_dep", description: "Depreciation charged so far on fixed assets; it reduces their value." },
  { code: "2000", name: "Accounts payable", type: "liability", subtype: "payable", key: "ap" },
  { code: "2060", name: "Company cards", type: "liability", subtype: "current", key: "card_payable", description: "Spends on company cards, until the card bill is paid." },
  { code: "2050", name: "Customer advances", type: "liability", subtype: "current", key: "customer_advances", description: "Money customers paid before being invoiced; it's used against their invoices." },
  { code: "2100", name: "Output CGST", type: "liability", subtype: "tax_out", key: "cgst_out" },
  { code: "2101", name: "Output SGST", type: "liability", subtype: "tax_out", key: "sgst_out" },
  { code: "2102", name: "Output IGST", type: "liability", subtype: "tax_out", key: "igst_out" },
  { code: "2103", name: "Other taxes payable", type: "liability", subtype: "tax_out", key: "tax_other" },
  { code: "2200", name: "Salaries payable", type: "liability", subtype: "current", key: "salaries_payable" },
  { code: "2210", name: "PF payable", type: "liability", subtype: "current", key: "pf_payable" },
  { code: "2211", name: "ESI payable", type: "liability", subtype: "current", key: "esi_payable" },
  { code: "2212", name: "Professional tax payable", type: "liability", subtype: "current", key: "pt_payable" },
  { code: "2213", name: "TDS payable", type: "liability", subtype: "current", key: "tds_payable" },
  { code: "2220", name: "Tips payable to staff", type: "liability", subtype: "current", key: "tips_payable" },
  { code: "2300", name: "Loans", type: "liability", subtype: "other" },
  { code: "2350", name: "Due to group companies", type: "liability", subtype: "current", key: "ic_payable", description: "What this company owes other companies in the group; eliminated when the group is consolidated." },
  { code: "2400", name: "Accrued expenses", type: "liability", subtype: "current", key: "accrued", description: "Costs of a period not billed yet (rent, power), usually reversed next month." },
  { code: "3000", name: "Owner's capital", type: "equity", key: "capital" },
  { code: "3900", name: "Opening balance adjustments", type: "equity", key: "opening" },
  { code: "4000", name: "Sales", type: "income", key: "sales" },
  { code: "4010", name: "Store sales", type: "income", key: "store_sales" },
  { code: "4060", name: "Contract revenue", type: "income", key: "contract_revenue", description: "Work certified on running-account bills in Construction." },
  { code: "4050", name: "Clinic income", type: "income", key: "clinic_income", description: "Consultations and procedures billed in Clinic (healthcare services are exempt from GST)." },
  { code: "4040", name: "Fee income", type: "income", key: "fee_income", description: "Fees raised in Education (schools, coaching)." },
  { code: "4030", name: "Restaurant sales", type: "income", key: "restaurant_sales", description: "Paid bills from Cloudesk for Horeca, after discounts, with service charge and delivery." },
  { code: "4020", name: "Sales returns", type: "income", key: "returns", description: "Credit notes and refunds; it reduces income." },
  { code: "4100", name: "Other income", type: "income", key: "other_income" },
  { code: "4110", name: "Gain or loss on assets", type: "income", key: "asset_gain", description: "What selling or scrapping a fixed asset made over (or under) its book value." },
  { code: "4120", name: "Exchange gain or loss", type: "income", key: "fx_gain_loss", description: "Differences from exchange rates on foreign-currency invoices and bills, realised when paid and revalued at month end." },
  { code: "4900", name: "Round off", type: "income", key: "round_off" },
  { code: "5000", name: "Cost of goods sold", type: "expense", key: "cogs" },
  { code: "5010", name: "Purchases", type: "expense", key: "purchases" },
  { code: "5100", name: "Salaries and wages", type: "expense", key: "salaries" },
  { code: "5110", name: "Employer PF and ESI", type: "expense", key: "employer_contrib" },
  { code: "5120", name: "Staff reimbursements", type: "expense", key: "reimbursements" },
  { code: "5200", name: "Rent", type: "expense" },
  { code: "5210", name: "Electricity and utilities", type: "expense" },
  { code: "5220", name: "Internet and phone", type: "expense" },
  { code: "5230", name: "Marketing and ads", type: "expense" },
  { code: "5240", name: "Software and subscriptions", type: "expense" },
  { code: "5250", name: "Travel and conveyance", type: "expense" },
  { code: "5260", name: "Office supplies", type: "expense" },
  { code: "5255", name: "Vehicle running costs", type: "expense", key: "vehicle_costs", description: "Fuel, tolls, parking and other trip costs from Logistics." },
  { code: "5265", name: "Freight outward", type: "expense", key: "freight_out", description: "Carriage paid to transporters and couriers for shipments." },
  { code: "5270", name: "Bank charges", type: "expense", key: "bank_charges" },
  { code: "5280", name: "Professional fees", type: "expense" },
  { code: "5290", name: "Repairs and maintenance", type: "expense", key: "repairs" },
  { code: "5160", name: "Production costs absorbed", type: "expense", key: "production_absorbed", description: "Labour and machine time moved into the value of goods made; it offsets those costs where they're booked." },
  { code: "5300", name: "Stock adjustments", type: "expense", key: "stock_adjust", description: "Damage, loss, finds and count differences in Inventory." },
  { code: "5400", name: "Depreciation", type: "expense", key: "depreciation" },
  { code: "5900", name: "Other expenses", type: "expense", key: "other_expense" },
  { code: "5910", name: "Cash short or over", type: "expense", key: "cash_over_short", description: "Differences found when petty cash is counted." },
];

export const settingsSchema = z.object({
  /** Two-letter state of the business, for GST. */
  state: z.string().trim().toUpperCase().max(2).default(""),
  gstin: z.string().trim().toUpperCase().max(15).default(""),
  /** Month the financial year starts (4 = April). */
  fyStartMonth: z.number().int().min(1).max(12).default(4),
  /** Nothing dated on or before this can be added, changed or removed. */
  lockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  /** Post from invoices, store, inventory and payroll automatically. */
  autoPost: z.object({ invoices: z.boolean().default(true), store: z.boolean().default(true), inventory: z.boolean().default(true), payroll: z.boolean().default(true) }).prefault({}),
  /** Where non-cash payments land, when nothing says otherwise. */
  defaultBankId: z.uuid().nullable().default(null),
  journalPrefix: z.string().trim().max(8).default("JV-"),
  billPrefix: z.string().trim().max(8).default("BL-"),
  /** TDS on suppliers: TAN and any rate overrides. */
  tds: tdsSettingsSchema.prefault({}),
});
export type AccSettings = z.infer<typeof settingsSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const money = z.number().int("Use whole paise").min(0).max(1e13);

export const accountSchema = z.object({
  code: z.string().trim().min(1, "Give it a code").max(12),
  name: z.string().trim().min(1, "Name the account").max(80),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
  subtype: z.enum(SUBTYPES).default("other"),
  description: z.string().trim().max(300).default(""),
  bank: z.object({ bankName: z.string().trim().max(60).optional(), last4: z.string().trim().regex(/^\d{0,4}$/).optional(), ifsc: z.string().trim().toUpperCase().max(11).optional() }).nullable().default(null),
  active: z.boolean().default(true),
});

export const journalSchema = z.object({
  date: day,
  narration: z.string().trim().max(500).default(""),
  lines: z
    .array(z.object({ accountId: z.uuid(), debit: money.default(0), credit: money.default(0), description: z.string().trim().max(200).default(""), costCentreId: z.uuid().nullable().default(null), branchId: z.uuid().nullable().default(null), partnerCompanyId: z.uuid().nullable().default(null) }))
    .min(2, "A journal needs at least two lines")
    .max(200),
  opening: z.boolean().default(false),
  /** The company it's for; the default company when not given. */
  companyId: z.uuid().nullable().default(null),
});

export const billSchema = z.object({
  supplierId: z.uuid().nullable().default(null),
  supplierName: z.string().trim().max(120).default(""),
  billNo: z.string().trim().max(60).default(""),
  date: day,
  dueDate: day.nullable().default(null),
  lines: z.array(z.object({ accountId: z.uuid(), description: z.string().trim().max(200).default(""), amount: money, gstRate: z.number().min(0).max(28).default(0), costCentreId: z.uuid().nullable().default(null) })).min(1, "Add at least one line").max(100),
  /** A debit note is what a supplier owes back on one of their bills. */
  kind: z.enum(["bill", "debit_note"]).default("bill"),
  againstBillId: z.uuid().nullable().default(null),
  /** TDS: a section (see lib/accounting/tds); the amount is worked out unless given. */
  tdsSection: z.string().trim().max(20).default(""),
  tdsAmount: z.number().int().min(0).max(1e13).nullable().default(null),
  itc: z.boolean().default(true),
  interState: z.boolean().default(false),
  notes: z.string().trim().max(2000).default(""),
  companyId: z.uuid().nullable().default(null),
  branchId: z.uuid().nullable().default(null),
  /** A bill in another currency: line amounts are in its minor units, posted in rupees at fxRate (or the workspace rate on the date). */
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a currency code like USD").default("INR"),
  fxRate: z.number().positive().max(1e6).nullable().default(null),
});

/** For a foreign bill, `amount` is the rupees actually paid and `fxAmount` what it pays in the bill's currency. */
export const paymentSchema = z.object({ accountId: z.uuid(), amount: money.refine((v) => v > 0, "Enter an amount"), date: day, reference: z.string().trim().max(80).default(""), fxAmount: z.number().int().min(1).max(1e13).nullable().default(null) });

/** A bill or expense: lines before GST, GST by line, split inside or across states. */
export function billTotals(lines: { amount: number; gstRate: number }[], interState: boolean) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    subtotal += l.amount;
    tax += Math.round((l.amount * l.gstRate) / 100);
  }
  const half = Math.floor(tax / 2);
  return { subtotal, tax, total: subtotal + tax, split: interState ? { igst: tax, cgst: 0, sgst: 0 } : { igst: 0, cgst: tax - half, sgst: half } };
}

export type PostLine = { key?: string; accountId?: string; debit: number; credit: number; description?: string; costCentreId?: string | null; branchId?: string | null; partnerCompanyId?: string | null };

/** Debits equal credits, nothing negative, something to post. */
export function balanced(lines: { debit: number; credit: number }[]) {
  const d = lines.reduce((a, l) => a + l.debit, 0);
  const c = lines.reduce((a, l) => a + l.credit, 0);
  return d === c && d > 0 && lines.every((l) => l.debit >= 0 && l.credit >= 0);
}

/** A signed amount as a debit or credit line. */
export const dr = (key: string, amount: number, description = ""): PostLine => (amount >= 0 ? { key, debit: amount, credit: 0, description } : { key, debit: 0, credit: -amount, description });
export const cr = (key: string, amount: number, description = ""): PostLine => dr(key, -amount, description);

/** The financial year a date falls in, as its first and last day. */
export function financialYear(date: string, startMonth = 4) {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  return { from, to: end.toISOString().slice(0, 10), label: startMonth === 1 ? String(startYear) : `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}` };
}

/** Read a bank statement CSV: finds the date, description, reference and amount (or debit/credit) columns by name. */
export function parseStatement(text: string) {
  const rows = csvRows(text).filter((r) => r.some((c) => c.trim()));
  const headerAt = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|withdrawal|credit|deposit/i.test(c)));
  if (headerAt < 0) return { lines: [], problem: "Couldn't find a header row with a date and an amount (or debit and credit) column." };
  const head = rows[headerAt].map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iDate = col(/(^|\s)(txn |transaction |value )?date/);
  const iDesc = col(/narration|description|particulars|details|remarks/);
  const iRef = col(/ref|cheque|chq|utr/);
  const iAmt = col(/^amount|amount \(inr\)|^amt/);
  const iDr = col(/debit|withdrawal|dr\b/);
  const iCr = col(/credit|deposit|cr\b/);
  const num = (v: string | undefined) => {
    const t = (v ?? "").replace(/[,₹\s]/g, "");
    if (!t) return 0;
    const neg = /^\(.*\)$/.test(t) || /dr$/i.test(t);
    const n = Number(t.replace(/[()]|cr$|dr$/gi, ""));
    return Number.isFinite(n) ? Math.round((neg ? -n : n) * 100) : NaN;
  };
  const lines: { date: string; description: string; reference: string; amount: number }[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const date = toIsoDate(r[iDate] ?? "");
    if (!date) continue;
    const amount = iAmt >= 0 && iDr < 0 ? num(r[iAmt]) : num(r[iCr]) - num(r[iDr]);
    if (!Number.isFinite(amount) || amount === 0) continue;
    lines.push({ date, description: (r[iDesc] ?? "").trim().slice(0, 300), reference: (iRef >= 0 ? r[iRef] ?? "" : "").trim().slice(0, 80), amount });
  }
  return { lines, problem: lines.length ? null : "No transactions with a date and an amount were found." };
}

/** 24/10/2026, 24-10-2026, 2026-10-24, 24 Oct 2026, 24-Oct-26 → 2026-10-24. Day first, as Indian banks write it. */
export function toIsoDate(v: string) {
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return iso(year(+m[3]), +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]*(\d{2,4})$/);
  if (m) {
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1;
    if (mon) return iso(year(+m[3]), mon, +m[1]);
  }
  return null;
}
const year = (y: number) => (y < 100 ? 2000 + y : y);
function iso(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** RFC 4180-ish CSV rows: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Bill statuses that aren't in the books: voided, waiting for approval, or sent back. */
export const NOT_POSTED = ["void", "pending_approval", "rejected"];
