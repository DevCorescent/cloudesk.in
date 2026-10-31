// Construction contracts: the bill of quantities (BOQ), the measurement book
// (each entry numbers × length × breadth × depth), and running-account (RA)
// bills — work done to date less what was billed before, at BOQ rates, with
// retention, mobilisation-advance recovery, GST and the client's TDS.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const text = (n: number) => z.string().trim().max(n).default("");
const money = z.number().int().min(0).max(1e13);
const pct = z.number().min(0).max(100);

export const contractSchema = z.object({
  name: z.string().trim().min(1, "Name the contract").max(160),
  client: z.string().trim().min(1, "Who's the client?").max(160),
  clientGstin: text(15),
  workOrderNo: text(60),
  site: text(300),
  startDate: day.nullable().default(null),
  endDate: day.nullable().default(null),
  /** Held back from each RA bill until the defect liability period ends. */
  retentionPct: pct.default(5),
  /** Mobilisation advance received, recovered from RA bills at this rate. */
  advancePct: pct.default(10),
  gstRate: z.number().min(0).max(28).default(18),
  interState: z.boolean().default(false),
  /** TDS the client deducts (194C: 1% individual/HUF, 2% others). */
  tdsPct: z.number().min(0).max(10).default(2),
  status: z.enum(["active", "completed", "closed"]).default("active"),
});
export type Contract = z.infer<typeof contractSchema>;

export const boqItemSchema = z.object({ code: z.string().trim().min(1, "Give it an item code").max(30), description: z.string().trim().min(1, "Describe the item").max(1000), unit: z.string().trim().min(1).max(20), qty: z.number().min(0).max(1e9), rate: money });
export const measureSchema = z.object({ itemId: z.uuid(), date: day, location: text(200), nos: z.number().min(0).max(1e6).default(1), length: z.number().min(0).max(1e6).nullable().default(null), breadth: z.number().min(0).max(1e6).nullable().default(null), depth: z.number().min(0).max(1e6).nullable().default(null), qty: z.number().min(-1e9).max(1e9).nullable().default(null), remarks: text(300) });
export const diarySchema = z.object({ date: day, weather: text(60), labour: z.array(z.object({ trade: z.string().trim().min(1).max(40), count: z.number().int().min(0).max(10000) })).max(30).default([]), work: z.string().trim().min(1, "What was done today?").max(5000), hindrances: text(2000), visitors: text(500) });
export const paymentSchema = z.object({ kind: z.enum(["bill", "advance", "retention"]).default("bill"), billId: z.uuid().nullable().default(null), amount: money.refine((v) => v > 0, "Enter an amount"), date: day, reference: text(80), accountId: z.uuid().nullable().default(null) });

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A measurement's quantity: given directly, or numbers × the dimensions that were taken (deductions can be negative). */
export function mbQty(m: { nos: number; length: number | null; breadth: number | null; depth: number | null; qty: number | null }) {
  if (m.qty !== null && m.qty !== undefined) return r3(m.qty);
  const dims = [m.length, m.breadth, m.depth].filter((x): x is number => x !== null && x !== undefined);
  return r3(dims.reduce((n, d) => n * d, m.nos));
}

/**
 * An RA bill: for each BOQ item, quantity to date (measured, never more than
 * the work allows unless excess is accepted), this bill's quantity (to date
 * less billed before) and amount; then the deductions.
 */
export function raBill(
  items: { id: string; code: string; description: string; unit: string; qty: number; rate: number }[],
  toDate: Record<string, number>,
  billedBefore: Record<string, number>,
  c: Pick<Contract, "retentionPct" | "advancePct" | "gstRate" | "tdsPct" | "interState">,
  advanceLeft: number,
) {
  const lines = items
    .map((i) => {
      const upto = r3(toDate[i.id] ?? 0);
      const prev = r3(billedBefore[i.id] ?? 0);
      const now = r3(upto - prev);
      return { itemId: i.id, code: i.code, description: i.description, unit: i.unit, rate: i.rate, boqQty: i.qty, upto, prev, qty: now, amount: Math.round(now * i.rate), excess: upto > i.qty };
    })
    .filter((l) => l.qty !== 0);
  const gross = lines.reduce((n, l) => n + l.amount, 0);
  const retention = Math.round((gross * c.retentionPct) / 100);
  const advance = Math.min(Math.max(0, advanceLeft), Math.round((gross * c.advancePct) / 100));
  const gst = Math.round((gross * c.gstRate) / 100);
  const tds = Math.round((gross * c.tdsPct) / 100);
  const net = gross + gst - retention - advance - tds;
  return { lines, gross, retention, advance, gst, tds, net, cgst: c.interState ? 0 : Math.floor(gst / 2), sgst: c.interState ? 0 : gst - Math.floor(gst / 2), igst: c.interState ? gst : 0 };
}

/** Progress: certified value against the contract (BOQ) value. */
export const progress = (certified: number, boqValue: number) => (boqValue ? Math.round((certified / boqValue) * 1000) / 10 : 0);
