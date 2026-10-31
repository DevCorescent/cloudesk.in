// Assets & maintenance: the asset register, meters, preventive plans (by
// days or by meter), maintenance work orders, contracts (AMC, warranty,
// insurance, calibration), and the sums behind them — when a plan is next
// due, what an order cost, and how reliable an asset is.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ASSET_STATUSES = ["running", "down", "maintenance", "standby", "retired"] as const;
export const ASSET_STATUS_LABEL: Record<(typeof ASSET_STATUSES)[number], string> = { running: "Running", down: "Down", maintenance: "Under maintenance", standby: "Standby", retired: "Retired" };
export const CRITICALITY = ["low", "medium", "high"] as const;
export const ORDER_KINDS = ["breakdown", "preventive", "request", "inspection", "improvement"] as const;
export const ORDER_KIND_LABEL: Record<(typeof ORDER_KINDS)[number], string> = { breakdown: "Breakdown", preventive: "Preventive", request: "Request", inspection: "Inspection", improvement: "Improvement" };
export const ORDER_STATUSES = ["requested", "open", "in_progress", "on_hold", "done", "cancelled"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const CONTRACT_KINDS = ["amc", "warranty", "insurance", "calibration", "lease"] as const;
export const CONTRACT_KIND_LABEL: Record<(typeof CONTRACT_KINDS)[number], string> = { amc: "AMC", warranty: "Warranty", insurance: "Insurance", calibration: "Calibration", lease: "Lease" };

export const settingsSchema = z
  .object({
    assetPrefix: z.string().trim().min(1).max(10).default("AST-"),
    orderPrefix: z.string().trim().min(1).max(10).default("MWO-"),
    /** Warehouse spare parts come from by default. */
    partsWarehouseId: z.uuid().nullable().default(null),
    /** Hourly rate used to cost labour when a person's own rate isn't known (paise). */
    labourRate: z.number().int().min(0).max(1e8).default(0),
    /** Anyone on the team may raise a request; technicians turn it into work. */
    requestsFromEveryone: z.boolean().default(true),
    /** Days before a contract ends that it's flagged. */
    contractNoticeDays: z.number().int().min(0).max(365).default(30),
  })
  .prefault({});
export type MntSettings = z.infer<typeof settingsSchema>;

export const assetSchema = z.object({
  name: z.string().trim().min(1, "Name it").max(160),
  category: z.string().trim().max(60).default(""),
  location: z.string().trim().max(120).default(""),
  parentId: z.uuid().nullable().default(null),
  make: z.string().trim().max(80).default(""),
  model: z.string().trim().max(80).default(""),
  serial: z.string().trim().max(80).default(""),
  status: z.enum(ASSET_STATUSES).default("running"),
  criticality: z.enum(CRITICALITY).default("medium"),
  custodianId: z.uuid().nullable().default(null),
  fixedAssetId: z.uuid().nullable().default(null),
  purchaseDate: day.nullable().default(null),
  warrantyUntil: day.nullable().default(null),
  meterUnit: z.string().trim().max(20).default(""),
  notes: z.string().trim().max(4000).default(""),
});

const checkItem = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(200) });
export const planSchema = z
  .object({
    assetId: z.uuid(),
    title: z.string().trim().min(1, "Name the task").max(160),
    /** Every so many days, every so much on the meter, or whichever comes first. */
    everyDays: z.number().int().min(1).max(3650).nullable().default(null),
    everyMeter: z.number().min(0.01).max(1e9).nullable().default(null),
    /** Counting from: the first service is one interval after these. */
    startOn: day,
    startMeter: z.number().min(0).max(1e12).default(0),
    /** Raise the work order this many days (or meter units) early. */
    leadDays: z.number().int().min(0).max(365).default(7),
    leadMeter: z.number().min(0).max(1e9).default(0),
    checklist: z.array(checkItem).max(60).default([]),
    parts: z.array(z.object({ itemId: z.uuid(), qty: z.number().min(0.001).max(1e6) })).max(40).default([]),
    estimateHours: z.number().min(0).max(1000).default(0),
    assigneeId: z.uuid().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((p) => p.everyDays || p.everyMeter, { message: "Repeat it every so many days, or every so much on the meter", path: ["everyDays"] });
export type PlanInput = z.infer<typeof planSchema>;

export const orderSchema = z.object({
  assetId: z.uuid(),
  kind: z.enum(ORDER_KINDS).default("breakdown"),
  title: z.string().trim().min(1, "Say what's wrong or what to do").max(200),
  description: z.string().trim().max(4000).default(""),
  priority: z.enum(PRIORITIES).default("normal"),
  assigneeId: z.uuid().nullable().default(null),
  dueDate: day.nullable().default(null),
  /** For a breakdown: is the asset stopped? Downtime runs from now until it's back. */
  stopped: z.boolean().default(false),
});

export const contractSchema = z.object({
  kind: z.enum(CONTRACT_KINDS).default("amc"),
  vendor: z.string().trim().min(1, "Who's it with?").max(160),
  supplierId: z.uuid().nullable().default(null),
  reference: z.string().trim().max(80).default(""),
  assetIds: z.array(z.uuid()).min(1, "Pick the assets it covers").max(500),
  startOn: day,
  endOn: day,
  /** For the whole term, paise. */
  cost: z.number().int().min(0).max(1e11).default(0),
  /** Visits included, for AMCs. */
  visits: z.number().int().min(0).max(1000).default(0),
  notes: z.string().trim().max(2000).default(""),
});

const dnum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
export const addDays = (d: string, n: number) => new Date((dnum(d) + n) * 86_400_000).toISOString().slice(0, 10);

/** When a plan is next due: by date, by meter, or both (whichever comes first), counting from when it was last done — or from its start. */
export function nextDue(p: { everyDays: number | null; everyMeter: number | null; startOn: string; startMeter: number; lastDoneOn: string | null; lastDoneMeter: number | null }) {
  const date = p.everyDays ? addDays(p.lastDoneOn ?? p.startOn, p.everyDays) : null;
  const meter = p.everyMeter ? (p.lastDoneMeter !== null ? p.lastDoneMeter + p.everyMeter : p.startMeter + p.everyMeter) : null;
  return { date, meter };
}

/** Whether a plan should become a work order now: its date (less the lead) has come, or the meter is near enough. */
export function isDue(p: Parameters<typeof nextDue>[0] & { leadDays: number; leadMeter: number }, today: string, reading: number | null) {
  const n = nextDue(p);
  const byDate = !!n.date && addDays(n.date, -p.leadDays) <= today;
  const byMeter = n.meter !== null && reading !== null && reading >= n.meter - p.leadMeter;
  return { due: byDate || byMeter, byDate, byMeter, ...n };
}

/** Average meter use per day from readings (oldest first), to project when a meter plan comes due. */
export function usagePerDay(readings: { value: number; on: string }[]) {
  if (readings.length < 2) return null;
  const a = readings[0];
  const b = readings[readings.length - 1];
  const days = dnum(b.on) - dnum(a.on);
  return days > 0 ? (b.value - a.value) / days : null;
}

/** The date a meter is expected to reach a value, from today's reading and average use. */
export function projectMeterDate(target: number, reading: number, perDay: number | null, today: string) {
  if (reading >= target) return today;
  if (!perDay || perDay <= 0) return null;
  return addDays(today, Math.ceil((target - reading) / perDay));
}

export type Labour = { userId: string; minutes: number; rate: number };
/** An order's cost: labour at each person's rate, parts at stock cost, and outside work. */
export function orderCost(o: { labour: Labour[]; partsCost: number; externalCost: number }) {
  const labour = o.labour.reduce((n, l) => n + Math.round((l.minutes * l.rate) / 60), 0);
  return { labour, parts: o.partsCost, external: o.externalCost, total: labour + o.partsCost + o.externalCost };
}

/**
 * Reliability over a period from breakdowns: mean time between failures
 * (hours running ÷ failures), mean time to repair (hours down ÷ failures), and
 * availability (running ÷ the whole period).
 */
export function reliability(periodHours: number, breakdowns: { downMinutes: number }[]) {
  const down = breakdowns.reduce((n, b) => n + b.downMinutes, 0) / 60;
  const up = Math.max(0, periodHours - down);
  const n = breakdowns.length;
  return { failures: n, downHours: Math.round(down * 100) / 100, mtbf: n ? Math.round((up / n) * 100) / 100 : null, mttr: n ? Math.round((down / n) * 100) / 100 : null, availability: periodHours ? Math.round((up / periodHours) * 10000) / 10000 : null };
}

/** Minutes between two moments (an asset stopped and back), never negative. */
export const minutesBetween = (from: Date | string, to: Date | string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
