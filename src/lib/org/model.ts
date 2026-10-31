// Organisation: legal entities (companies), branches, cost and profit
// centres and business units, currencies and exchange rates, closed periods,
// user groups and data access. Shared by the server and the screens.
import { z } from "zod";
import { GST_CODE_STATE, validateGstin } from "@/lib/store/gst";

const text = (n: number) => z.string().trim().max(n).default("");
const stateCode = z.string().trim().toUpperCase().max(2).default("");
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .default("")
  .superRefine((g, ctx) => {
    const v = g ? validateGstin(g) : null;
    if (v && !v.ok) ctx.addIssue({ code: "custom", message: v.reason });
  });

export const BRANCH_KINDS = ["office", "store", "warehouse", "plant", "region", "other"] as const;
export const BRANCH_KIND_LABEL: Record<(typeof BRANCH_KINDS)[number], string> = { office: "Office", store: "Store / outlet", warehouse: "Warehouse", plant: "Plant / factory", region: "Region", other: "Other" };
export const UNIT_KINDS = ["cost_centre", "profit_centre", "business_unit"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
export const UNIT_KIND_LABEL: Record<UnitKind, string> = { cost_centre: "Cost centre", profit_centre: "Profit centre", business_unit: "Business unit" };

export const companySchema = z.object({
  name: z.string().trim().min(1, "Name the company").max(160),
  legalName: text(200),
  gstin,
  pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, "A PAN looks like ABCDE1234F").default(""),
  cin: text(21),
  state: stateCode,
  address: text(500),
  baseCurrency: z.string().trim().toUpperCase().length(3).default("INR"),
  parentId: z.uuid().nullable().default(null),
  active: z.boolean().default(true),
});

export const branchSchema = z.object({
  companyId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  code: text(16),
  name: z.string().trim().min(1, "Name the branch").max(120),
  kind: z.enum(BRANCH_KINDS).default("office"),
  state: stateCode,
  address: text(500),
  gstin,
  managerId: z.uuid().nullable().default(null),
  active: z.boolean().default(true),
});

export const unitSchema = z.object({
  kind: z.enum(UNIT_KINDS),
  code: z.string().trim().min(1, "Give it a code").max(16),
  name: z.string().trim().min(1, "Name it").max(120),
  parentId: z.uuid().nullable().default(null),
  companyId: z.uuid().nullable().default(null),
  managerId: z.uuid().nullable().default(null),
  active: z.boolean().default(true),
});

export const currencySchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter code like USD"), name: z.string().trim().min(1).max(60), symbol: text(6), decimals: z.number().int().min(0).max(3).default(2), active: z.boolean().default(true) });
export const rateSchema = z.object({ currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rate: z.number().positive("Enter how many rupees one unit is worth").max(1e7) });
export const groupSchema = z.object({ name: z.string().trim().min(1, "Name the group").max(80), description: text(300), members: z.array(z.uuid()).max(500).default([]) });
export const accessSchema = z.object({ companies: z.array(z.uuid()).max(100).optional(), branches: z.array(z.uuid()).max(500).optional() }).nullable();
export type Access = z.infer<typeof accessSchema>;

/** Common currencies to start from; the workspace adds rates for the ones it uses. */
export const COMMON_CURRENCIES: { code: string; name: string; symbol: string; decimals: number }[] = [
  { code: "USD", name: "US dollar", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "GBP", name: "Pound sterling", symbol: "£", decimals: 2 },
  { code: "AED", name: "UAE dirham", symbol: "د.إ", decimals: 2 },
  { code: "SGD", name: "Singapore dollar", symbol: "S$", decimals: 2 },
  { code: "AUD", name: "Australian dollar", symbol: "A$", decimals: 2 },
  { code: "CAD", name: "Canadian dollar", symbol: "C$", decimals: 2 },
  { code: "JPY", name: "Japanese yen", symbol: "¥", decimals: 0 },
  { code: "CNY", name: "Chinese yuan", symbol: "¥", decimals: 2 },
  { code: "SAR", name: "Saudi riyal", symbol: "﷼", decimals: 2 },
  { code: "NPR", name: "Nepalese rupee", symbol: "रू", decimals: 2 },
  { code: "BDT", name: "Bangladeshi taka", symbol: "৳", decimals: 2 },
  { code: "LKR", name: "Sri Lankan rupee", symbol: "Rs", decimals: 2 },
];

/**
 * Convert an amount in a foreign currency's minor units to paise at a rate
 * (rupees per unit), allowing for currencies without minor units (yen).
 */
export function toPaise(minor: number, rate: number, decimals = 2) {
  return Math.round((minor / 10 ** decimals) * rate * 100);
}

/** The rate in force on a date: the latest one on or before it. */
export function rateOn(rates: { date: string; rate: number }[], day: string) {
  let best: { date: string; rate: number } | null = null;
  for (const r of rates) if (r.date <= day && (!best || r.date > best.date)) best = r;
  return best;
}

/** The financial year (e.g. "2026-27") and its months for a date, given the month it starts. */
export function fiscalYear(day: string, startMonth = 4) {
  const [y, m] = day.split("-").map(Number);
  const start = m >= startMonth ? y : y - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const mm = ((startMonth - 1 + i) % 12) + 1;
    const yy = start + Math.floor((startMonth - 1 + i) / 12);
    return `${yy}-${String(mm).padStart(2, "0")}`;
  });
  const label = startMonth === 1 ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  return { label, start: `${months[0]}-01`, end: lastDayOf(months[11]), months };
}

export const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** A company's state from its GSTIN when none is given. */
export const stateFromGstin = (g: string) => GST_CODE_STATE[g.slice(0, 2)] ?? "";

/** Can a member with these limits see this company / branch? */
export function allows(access: Access | null | undefined, ref: { companyId?: string | null; branchId?: string | null }) {
  if (!access) return true;
  if (access.companies?.length && ref.companyId && !access.companies.includes(ref.companyId)) return false;
  if (access.branches?.length && ref.branchId && !access.branches.includes(ref.branchId)) return false;
  return true;
}
