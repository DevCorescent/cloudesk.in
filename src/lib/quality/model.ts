// Quality: inspection plans (what to check on an item at receipt, after
// production or before dispatch), inspections with results per sample, and
// non-conformance reports with corrective and preventive actions (CAPA).
import { z } from "zod";

const uuid = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const text = (n: number) => z.string().trim().max(n).default("");

export const STAGES = { receipt: "Goods received", production: "After production", dispatch: "Before dispatch" } as const;
export type Stage = keyof typeof STAGES;
export const SEVERITY = { minor: "Minor", major: "Major", critical: "Critical" } as const;
export const DISPOSITIONS = { pending: "To decide", use: "Use as is", rework: "Rework", scrap: "Scrap", return: "Return to supplier" } as const;
export const NCR_SOURCES = { inspection: "Inspection", customer: "Customer complaint", internal: "Found in-house", supplier: "Supplier" } as const;

export const settingsSchema = z.object({
  ncrPrefix: z.string().trim().max(8).default("NCR-"),
  inspectionPrefix: z.string().trim().max(8).default("QC-"),
  /** Hold a failed lot in the location's quarantine bin (when there is one). */
  quarantineOnFail: z.boolean().default(true),
});
export type QcSettings = z.infer<typeof settingsSchema>;

export const parameterSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, "Name what's checked").max(80),
  /** measure: a number within limits; check: pass or fail */
  kind: z.enum(["measure", "check"]).default("check"),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  unit: text(20),
});

export const planSchema = z.object({
  name: z.string().trim().min(1, "Name the plan").max(80),
  itemId: uuid.nullable().default(null),
  /** Or every item in a category. */
  category: text(60),
  stage: z.enum(Object.keys(STAGES) as [Stage]),
  /** Samples per lot: a fixed number, or a percentage of the lot (at least one). */
  sampleSize: z.number().int().min(1).max(10000).default(5),
  samplePct: z.number().min(0).max(100).default(0),
  /** Most failed samples a lot can have and still pass. */
  acceptMax: z.number().int().min(0).max(10000).default(0),
  parameters: z.array(parameterSchema).min(1, "Add at least one thing to check").max(50),
  active: z.boolean().default(true),
});
export type Plan = z.infer<typeof planSchema>;

export const resultSchema = z.object({
  /** One entry per sample: each parameter's reading (a number for measures, true/false for checks). */
  samples: z.array(z.record(z.string(), z.union([z.number(), z.boolean(), z.null()]))).min(1, "Record at least one sample").max(10000),
  notes: text(1000),
});

export const ncrSchema = z.object({
  source: z.enum(Object.keys(NCR_SOURCES) as [keyof typeof NCR_SOURCES]).default("internal"),
  itemId: uuid.nullable().default(null),
  supplierId: uuid.nullable().default(null),
  warehouseId: uuid.nullable().default(null),
  batch: text(40),
  qty: z.number().min(0).max(1e9).default(0),
  severity: z.enum(Object.keys(SEVERITY) as [keyof typeof SEVERITY]).default("minor"),
  title: z.string().trim().min(1, "Say what's wrong").max(160),
  description: text(4000),
});

export const ncrUpdateSchema = z.object({
  rootCause: text(4000),
  disposition: z.enum(Object.keys(DISPOSITIONS) as [keyof typeof DISPOSITIONS]).default("pending"),
  actions: z.array(z.object({ id: z.string().min(1).max(40), action: z.string().trim().min(1).max(300), kind: z.enum(["corrective", "preventive"]).default("corrective"), ownerId: uuid.nullable().default(null), due: day.nullable().default(null), done: z.boolean().default(false) })).max(50).default([]),
});

/** How many samples to take from a lot. */
export const sampleCount = (plan: Pick<Plan, "sampleSize" | "samplePct">, lot: number) => Math.max(1, Math.min(Math.ceil(lot) || 1, plan.samplePct > 0 ? Math.ceil((lot * plan.samplePct) / 100) : plan.sampleSize));

/** Whether a reading passes a parameter. */
export function passes(p: Pick<z.infer<typeof parameterSchema>, "kind" | "min" | "max">, v: number | boolean | null | undefined) {
  if (v === null || v === undefined) return false;
  if (p.kind === "check") return v === true;
  if (typeof v !== "number") return false;
  return (p.min === null || v >= p.min) && (p.max === null || v <= p.max);
}

/** A lot's outcome: samples that fail any parameter, against what the plan accepts. */
export function judge(parameters: z.infer<typeof parameterSchema>[], samples: Record<string, number | boolean | null>[], acceptMax: number) {
  const failed = samples.map((s) => parameters.filter((p) => !passes(p, s[p.id])).map((p) => p.id));
  const defective = failed.filter((f) => f.length).length;
  const byParameter = Object.fromEntries(parameters.map((p) => [p.id, failed.filter((f) => f.includes(p.id)).length]));
  return { defective, byParameter, passed: defective <= acceptMax };
}

/** The plan for an item at a stage: one for the item itself first, else one for its category. */
export function planFor<T extends { itemId: string | null; category: string; stage: string; active: boolean }>(plans: T[], item: { id: string; category: string }, stage: Stage) {
  return plans.find((p) => p.active && p.stage === stage && p.itemId === item.id) ?? plans.find((p) => p.active && p.stage === stage && !p.itemId && !!p.category && p.category.toLowerCase() === item.category.toLowerCase()) ?? null;
}
