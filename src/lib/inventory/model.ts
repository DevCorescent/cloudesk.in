// Inventory & purchasing: shapes and the arithmetic shared by the server and
// the screens. Money is in paise (integers); quantities have up to three
// decimals so items can be kept in kg or litres.
import { z } from "zod";

export const UNITS = ["pcs", "box", "pack", "kg", "g", "l", "ml", "m", "dozen", "pair", "set"] as const;
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;

/** Round a quantity to three decimals, the precision we store. */
export const q3 = (n: number) => Math.round(n * 1000) / 1000;

const money = z.number().int("Use whole paise").min(0).max(1e12);
const quantity = z.number().min(0).max(1e9).transform(q3);
const positive = z.number().gt(0, "Enter a quantity").max(1e9).transform(q3);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const uuid = z.uuid();

export const settingsSchema = z.object({
  /** Days before expiry that a batch counts as "expiring soon". */
  expiryWarnDays: z.number().int().min(1).max(365).default(30),
  /** Stop issuing or transferring more than is on hand. */
  blockNegative: z.boolean().default(true),
  poPrefix: z.string().trim().max(8).default("PO-"),
  grnPrefix: z.string().trim().max(8).default("GRN-"),
  transferPrefix: z.string().trim().max(8).default("TR-"),
  /** Shown on purchase orders. */
  poTerms: z.string().trim().max(2000).default("Please quote our PO number on your invoice. Deliver to the address above during working hours."),
  requisitionPrefix: z.string().trim().max(8).default("REQ-"),
  rfqPrefix: z.string().trim().max(8).default("RFQ-"),
  returnPrefix: z.string().trim().max(8).default("RTV-"),
  /** Only order from suppliers whose onboarding is approved. */
  requireApprovedSupplier: z.boolean().default(false),
  /** A purchase order taking a category over its month's budget: allowed, warned, or refused. */
  budgetCheck: z.enum(["off", "warn", "block"]).default("warn"),
  /** Price differences up to this % count as a match in the 3-way match. */
  matchTolerancePct: z.number().min(0).max(50).default(2),
  /** How stock is valued in reports: weighted average, or first in first out. */
  valuation: z.enum(["average", "fifo"]).default("average"),
  /** Days between counts for A, B and C items (by what they're worth to the business). */
  countEvery: z.object({ A: z.number().int().min(1).max(730).default(30), B: z.number().int().min(1).max(730).default(90), C: z.number().int().min(1).max(730).default(180) }).prefault({}),
  wavePrefix: z.string().trim().max(8).default("WV-"),
});
export type InvSettings = z.infer<typeof settingsSchema>;

export const warehouseSchema = z.object({
  name: z.string().trim().min(1, "Name the location").max(80),
  code: z.string().trim().max(12).default(""),
  address: z.string().trim().max(400).default(""),
  state: z.string().trim().toUpperCase().max(2).default(""),
  projectId: uuid.nullable().default(null),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Name the supplier").max(120),
  contactName: z.string().trim().max(120).default(""),
  email: z.union([z.literal(""), z.email("Check the email")]).default(""),
  phone: z.string().trim().max(30).default(""),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .default("")
    .refine((v) => !v || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), "That doesn't look like a GSTIN"),
  state: z.string().trim().toUpperCase().max(2).default(""),
  address: z.string().trim().max(400).default(""),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  /** For TDS and payment runs (Accounts). */
  pan: z.string().trim().toUpperCase().regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, "A PAN looks like ABCDE1234F").default(""),
  tdsSection: z.string().trim().max(20).default(""),
  deductee: z.enum(["company", "other"]).default("other"),
  bank: z.object({ name: z.string().trim().max(120).default(""), account: z.string().trim().regex(/^[0-9]{0,20}$/, "Digits only").default(""), ifsc: z.string().trim().toUpperCase().regex(/^([A-Z]{4}0[A-Z0-9]{6})?$/, "An IFSC looks like HDFC0001234").default("") }).prefault({}),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
  notes: z.string().trim().max(2000).default(""),
  active: z.boolean().default(true),
});

export const itemSchema = z.object({
  name: z.string().trim().min(1, "Name the item").max(160),
  sku: z.string().trim().max(60).default(""),
  barcode: z.string().trim().max(60).default(""),
  unit: z.enum(UNITS).default("pcs"),
  category: z.string().trim().max(60).default(""),
  hsn: z.string().trim().max(10).default(""),
  gstRate: z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "Pick a GST rate").default(18),
  avgCost: money.default(0),
  trackBatches: z.boolean().default(false),
  reorderLevel: quantity.default(0),
  reorderQty: quantity.default(0),
  safetyStock: quantity.default(0),
  trackSerials: z.boolean().default(false),
  supplierId: uuid.nullable().default(null),
  notes: z.string().trim().max(2000).default(""),
  active: z.boolean().default(true),
});

export const poLineSchema = z.object({ itemId: uuid, qty: positive, rate: money, gstRate: z.number().min(0).max(28) });
export const poSchema = z.object({
  supplierId: uuid,
  warehouseId: uuid,
  orderDate: day,
  expectedDate: day.nullable().default(null),
  lines: z.array(poLineSchema).min(1, "Add at least one item").max(200),
  notes: z.string().trim().max(2000).default(""),
});

export const receiptLineSchema = z.object({
  itemId: uuid,
  qty: positive,
  rate: money,
  gstRate: z.number().min(0).max(28).default(0),
  batch: z.string().trim().max(40).default(""),
  expiry: day.nullable().default(null),
  /** Of the quantity that arrived, how much failed inspection (it doesn't go into stock). */
  rejected: quantity.default(0),
  rejectReason: z.string().trim().max(200).default(""),
  /** For items tracked by serial number: one per unit accepted. */
  serials: z.array(z.string().trim().min(1).max(80)).max(10000).default([]),
  /** Put away straight into this bin. */
  binId: uuid.nullable().default(null),
});
export const receiptSchema = z.object({
  poId: uuid.nullable().default(null),
  supplierId: uuid.nullable().default(null),
  warehouseId: uuid,
  date: day,
  supplierInvoice: z.string().trim().max(60).default(""),
  lines: z.array(receiptLineSchema).min(1, "Add at least one item").max(200),
  notes: z.string().trim().max(2000).default(""),
});

export const transferSchema = z.object({
  fromId: uuid,
  toId: uuid,
  lines: z.array(z.object({ itemId: uuid, qty: positive, batch: z.string().trim().max(40).default("") })).min(1, "Add at least one item").max(200),
  notes: z.string().trim().max(2000).default(""),
});

export const adjustSchema = z.object({
  itemId: uuid,
  warehouseId: uuid,
  batch: z.string().trim().max(40).default(""),
  expiry: day.nullable().default(null),
  /** Signed change: +5 found, -2 damaged. */
  qty: z.number().refine((v) => v !== 0, "Enter a change").transform(q3),
  reason: z.enum(["damaged", "expired", "lost", "found", "used", "opening", "other"]),
  note: z.string().trim().max(300).default(""),
});

export const countSchema = z.object({
  warehouseId: uuid,
  lines: z.array(z.object({ itemId: uuid, batch: z.string().trim().max(40).default(""), counted: quantity })).min(1, "Count at least one item").max(2000),
  note: z.string().trim().max(300).default(""),
});

export const ADJUST_REASONS: Record<string, string> = { damaged: "Damaged", expired: "Expired", lost: "Lost or stolen", found: "Found", used: "Used in-house", opening: "Opening stock", other: "Other" };

/** Line totals with GST: inside a state CGST + SGST, across states IGST. */
export function purchaseTotals(lines: { qty: number; rate: number; gstRate: number }[], interState: boolean) {
  let subtotal = 0;
  let tax = 0;
  const rows = lines.map((l) => {
    const amount = Math.round(l.qty * l.rate);
    const t = Math.round((amount * l.gstRate) / 100);
    subtotal += amount;
    tax += t;
    return { amount, tax: t };
  });
  const half = Math.floor(tax / 2);
  return { rows, subtotal, tax, total: subtotal + tax, split: interState ? { igst: tax, cgst: 0, sgst: 0 } : { igst: 0, cgst: tax - half, sgst: half } };
}

/** Purchases are inter-state when both states are known and differ. */
export const isInterState = (supplierState: string, warehouseState: string) => !!supplierState && !!warehouseState && supplierState !== warehouseState;

/**
 * New weighted average cost after receiving `qty` at `rate` onto `onHand` at
 * `avg`. An average of 0 means the cost isn't known (not that it was free), so
 * the first priced receipt sets it.
 */
export function weightedAverage(onHand: number, avg: number, qty: number, rate: number) {
  const base = avg > 0 ? Math.max(0, onHand) : 0;
  if (base + qty <= 0) return rate;
  return Math.round((base * avg + qty * rate) / (base + qty));
}

/** How much to order for an item that's low: its reorder quantity, or enough to get back above the level. */
export function suggestedOrder(onHand: number, onOrder: number, level: number, reorderQty: number, safety = 0) {
  const short = level + safety - onHand - onOrder;
  if (short < 0 || (short === 0 && level === 0)) return 0;
  return q3(Math.max(reorderQty, short));
}

export const fmtQty = (n: number, unit = "") => `${Number(n.toFixed(3)).toLocaleString("en-IN", { maximumFractionDigits: 3 })}${unit && unit !== "pcs" ? ` ${unit}` : ""}`;

// ── Procurement ─────────────────────────────────────────────────────────────

export const SUPPLIER_CHECKS = { gst: "GST certificate", pan: "PAN card", bank: "Cancelled cheque / bank letter", msme: "MSME registration (if any)", agreement: "Signed terms or agreement" } as const;

export const onboardingSchema = z.object({ approval: z.enum(["pending", "approved", "blocked"]), checklist: z.partialRecord(z.enum(Object.keys(SUPPLIER_CHECKS) as [keyof typeof SUPPLIER_CHECKS]), z.boolean()).default({}), note: z.string().trim().max(300).default("") });

export const requisitionSchema = z.object({
  warehouseId: uuid,
  neededBy: day.nullable().default(null),
  reason: z.string().trim().max(500).default(""),
  lines: z.array(z.object({ itemId: uuid, qty: positive, estRate: money.default(0), note: z.string().trim().max(200).default("") })).min(1, "Add at least one item").max(200),
});

export const rfqSchema = z.object({
  title: z.string().trim().max(120).default(""),
  warehouseId: uuid,
  dueDate: day.nullable().default(null),
  lines: z.array(z.object({ itemId: uuid, qty: positive })).min(1, "Add at least one item").max(200),
  supplierIds: z.array(uuid).min(1, "Ask at least one supplier").max(30),
  notes: z.string().trim().max(2000).default(""),
  requisitionId: uuid.nullable().default(null),
});

export const quoteSchema = z.object({
  supplierId: uuid,
  lines: z.array(z.object({ itemId: uuid, rate: money, gstRate: z.number().min(0).max(28).default(18), leadDays: z.number().int().min(0).max(365).default(7) })).min(1, "Quote at least one item").max(200),
  validTill: day.nullable().default(null),
  terms: z.string().trim().max(1000).default(""),
});

export const awardSchema = z.object({ award: z.array(z.object({ itemId: uuid, supplierId: uuid })).min(1, "Pick a supplier for at least one item"), orderDate: day, expectedDate: day.nullable().default(null) });

export const supplierRateSchema = z.object({ supplierId: uuid, itemId: uuid, rate: money, minQty: quantity.default(0), validFrom: day.nullable().default(null), validTo: day.nullable().default(null), reference: z.string().trim().max(60).default("") });

export const supplierReturnSchema = z.object({
  supplierId: uuid,
  receiptId: uuid.nullable().default(null),
  warehouseId: uuid,
  date: day,
  lines: z.array(z.object({ itemId: uuid, qty: positive, rate: money, gstRate: z.number().min(0).max(28).default(0), batch: z.string().trim().max(40).default(""), reason: z.string().trim().max(200).default(""), serials: z.array(z.string().trim().min(1).max(80)).max(10000).default([]), binId: uuid.nullable().default(null) })).min(1, "Return at least one item").max(200),
  /** Make a debit note against the receipt's bill in Accounts. */
  debitNote: z.boolean().default(true),
  notes: z.string().trim().max(500).default(""),
});

export const purchaseBudgetSchema = z.object({ category: z.string().trim().min(1, "Pick a category").max(60), month: z.string().regex(/^\d{4}-\d{2}$/, "Use a month"), amount: money });

/** The best quote for each item: the lowest rate before GST (input credit comes back), then the shortest lead time. */
export function compareQuotes(lines: { itemId: string; qty: number }[], quotes: { supplierId: string; lines: { itemId: string; rate: number; gstRate: number; leadDays: number }[] }[]) {
  return lines.map((l) => {
    const offers = quotes
      .map((q) => ({ supplierId: q.supplierId, line: q.lines.find((x) => x.itemId === l.itemId) }))
      .filter((o): o is { supplierId: string; line: { itemId: string; rate: number; gstRate: number; leadDays: number } } => !!o.line && o.line.rate > 0)
      .map((o) => ({ supplierId: o.supplierId, rate: o.line.rate, gstRate: o.line.gstRate, leadDays: o.line.leadDays, amount: Math.round(o.line.rate * l.qty) }))
      .sort((a, b) => a.rate - b.rate || a.leadDays - b.leadDays);
    return { itemId: l.itemId, qty: l.qty, offers, best: offers[0]?.supplierId ?? null, saving: offers.length > 1 ? offers[offers.length - 1].amount - offers[0].amount : 0 };
  });
}

/** The agreed rate for an item from a supplier on a day (the best tier the quantity reaches). */
export function contractRate(rates: { itemId: string; rate: number; minQty: number; validFrom: string | null; validTo: string | null }[], itemId: string, qty: number, day: string) {
  const ok = rates.filter((r) => r.itemId === itemId && r.minQty <= qty && (!r.validFrom || r.validFrom <= day) && (!r.validTo || r.validTo >= day)).sort((a, b) => b.minQty - a.minQty);
  return ok[0]?.rate ?? null;
}

export type MatchStatus = "matched" | "price" | "quantity" | "to_receive" | "to_bill" | "bill_differs";

/**
 * The 3-way match for a purchase order: what was ordered, received (accepted)
 * and billed. Price differences within the tolerance count as matching.
 */
export function threeWay(po: { status: string; lines: { itemId: string; qty: number; rate: number; received: number }[] }, receipts: { lines: { itemId: string; qty: number; rate: number }[]; subtotal: number; billed: number | null }[], tolerancePct: number) {
  const issues: { kind: MatchStatus; itemId?: string; detail: string }[] = [];
  for (const l of po.lines) {
    for (const r of receipts) for (const x of r.lines.filter((y) => y.itemId === l.itemId)) if (l.rate && Math.abs(x.rate - l.rate) > (l.rate * tolerancePct) / 100) issues.push({ kind: "price", itemId: l.itemId, detail: `Received at ₹${(x.rate / 100).toFixed(2)} against ₹${(l.rate / 100).toFixed(2)} ordered` });
    const got = receipts.reduce((a, r) => a + r.lines.filter((x) => x.itemId === l.itemId).reduce((b, x) => b + x.qty, 0), 0);
    if (got > l.qty + 0.0005) issues.push({ kind: "quantity", itemId: l.itemId, detail: `${q3(got)} received against ${l.qty} ordered` });
  }
  for (const r of receipts) if (r.billed !== null && Math.abs(r.billed - r.subtotal) > Math.max(100, (r.subtotal * tolerancePct) / 100)) issues.push({ kind: "bill_differs", detail: `Billed ₹${(r.billed / 100).toFixed(2)} before GST against ₹${(r.subtotal / 100).toFixed(2)} received` });
  const orderedValue = po.lines.reduce((a, l) => a + Math.round(l.qty * l.rate), 0);
  const receivedValue = receipts.reduce((a, r) => a + r.subtotal, 0);
  const billedValue = receipts.reduce((a, r) => a + (r.billed ?? 0), 0);
  const allIn = po.lines.every((l) => l.received + 0.0005 >= l.qty) || ["received", "closed"].includes(po.status);
  const status: MatchStatus = issues[0]?.kind ?? (!allIn ? "to_receive" : receipts.some((r) => r.billed === null) ? "to_bill" : "matched");
  return { status, issues, orderedValue, receivedValue, billedValue };
}

export const MATCH_LABEL: Record<MatchStatus, string> = { matched: "Matched", price: "Price differs", quantity: "Over-received", to_receive: "Still to receive", to_bill: "Still to bill", bill_differs: "Bill differs" };

/** A supplier's record: on time (received by the expected date), rejected share, and average lead time. */
export function supplierScore(rows: { expected: string | null; ordered: string; received: string; accepted: number; rejected: number }[]) {
  const withDue = rows.filter((r) => r.expected);
  const onTime = withDue.length ? Math.round((withDue.filter((r) => r.received <= r.expected!).length / withDue.length) * 100) : null;
  const total = rows.reduce((a, r) => a + r.accepted + r.rejected, 0);
  const rejectedPct = total ? Math.round((rows.reduce((a, r) => a + r.rejected, 0) / total) * 1000) / 10 : null;
  const days = rows.map((r) => (Date.parse(r.received) - Date.parse(r.ordered)) / 86_400_000).filter((d) => d >= 0);
  return { deliveries: rows.length, onTimePct: onTime, rejectedPct, avgLeadDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null };
}

// ── Warehouse ───────────────────────────────────────────────────────────────

export const BIN_KINDS = { storage: "Storage", receiving: "Receiving", dispatch: "Dispatch", quarantine: "Quarantine (not available)" } as const;
export const binSchema = z.object({ warehouseId: uuid, code: z.string().trim().min(1, "Give the bin a code").max(30), zone: z.string().trim().max(40).default(""), kind: z.enum(Object.keys(BIN_KINDS) as [keyof typeof BIN_KINDS]).default("storage"), active: z.boolean().default(true) });
/** Move stock into, out of or between bins in one location (from null: not yet put away). */
export const binMoveSchema = z.object({ warehouseId: uuid, itemId: uuid, batch: z.string().trim().max(40).default(""), qty: positive, fromBinId: uuid.nullable().default(null), toBinId: uuid.nullable().default(null) });
export const waveSchema = z.object({ warehouseId: uuid, orderIds: z.array(uuid).min(1, "Pick at least one order").max(100) });

/** Stock in hand valued first-in-first-out: what's left is the newest receipts; anything older than the history is at average cost. */
export function fifoLayers(onHand: number, receiptsNewestFirst: { qty: number; unitCost: number; date: string }[], avgCost: number) {
  let left = Math.max(0, onHand);
  const layers: { qty: number; unitCost: number; date: string | null }[] = [];
  for (const r of receiptsNewestFirst) {
    if (left <= 0) break;
    const take = q3(Math.min(left, r.qty));
    if (take > 0) layers.push({ qty: take, unitCost: r.unitCost, date: r.date });
    left = q3(left - take);
  }
  if (left > 0) layers.push({ qty: left, unitCost: avgCost, date: null });
  return { layers, value: layers.reduce((a, l) => a + Math.round(l.qty * l.unitCost), 0) };
}

export const AGE_BUCKETS = [{ key: "0-30", max: 30 }, { key: "31-60", max: 60 }, { key: "61-90", max: 90 }, { key: "91-180", max: 180 }, { key: "180+", max: Infinity }] as const;

/** How old the stock in hand is, by the receipt it came on (stock older than the history counts as 180+). */
export function ageing(layers: { qty: number; unitCost: number; date: string | null }[], today: string) {
  const out = AGE_BUCKETS.map((b) => ({ bucket: b.key, qty: 0, value: 0 }));
  for (const l of layers) {
    const days = l.date ? Math.floor((Date.parse(today) - Date.parse(l.date)) / 86_400_000) : Infinity;
    const i = AGE_BUCKETS.findIndex((b) => days <= b.max);
    out[i].qty = q3(out[i].qty + l.qty);
    out[i].value += Math.round(l.qty * l.unitCost);
  }
  return out;
}

/** ABC classes by what each item is worth to the business (a year's issues at cost): A the top 80%, B the next 15%, C the rest. */
export function abc(items: { id: string; value: number }[]) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((a, i) => a + i.value, 0);
  const out = new Map<string, "A" | "B" | "C">();
  let run = 0;
  for (const i of sorted) {
    const before = total ? run / total : 1;
    out.set(i.id, !total || i.value <= 0 ? "C" : before < 0.8 ? "A" : before < 0.95 ? "B" : "C");
    run += i.value;
  }
  return out;
}
