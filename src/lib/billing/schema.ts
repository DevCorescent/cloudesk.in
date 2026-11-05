// Request shapes for subscriptions, shared by the routes and sign-up.
import { z } from "zod";
import { MODULE_IDS, type ModuleId } from "@/lib/workspace/modules";
import { PACK_KEYS, TOPUP_KEYS, type PackKey, type TopupKey } from "./catalog";

const moduleId = z.enum(MODULE_IDS as unknown as [ModuleId, ...ModuleId[]]);
export const intervalSchema = z.enum(["month", "year"]);

/** Features and packs bought on top of a plan. */
export const addonsSchema = z.object({
  modules: z.array(moduleId).max(MODULE_IDS.length).optional(),
  packs: z.partialRecord(z.enum(PACK_KEYS as [PackKey, ...PackKey[]]), z.number().int().min(0).max(1000)).optional(),
});

/** Top-ups to buy now: how many packs of each. */
export const topupSchema = z.partialRecord(z.enum(TOPUP_KEYS as [TopupKey, ...TopupKey[]]), z.number().int().min(0).max(100));

export const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), planId: z.string().trim().regex(/^[a-z0-9-]{2,30}$/), interval: intervalSchema, addons: addonsSchema.optional() }),
  z.object({ kind: z.literal("custom"), modules: z.array(moduleId).max(MODULE_IDS.length), seats: z.number().int().min(1).max(10000), interval: intervalSchema, addons: addonsSchema.optional() }),
]);

/** A plan's allowances (unlimited when left out). The AI budget is in US dollars and may have cents. */
export const quotasSchema = z.object({
  invoicesPerMonth: z.number().int().min(0).max(10_000_000).optional(),
  contacts: z.number().int().min(0).max(100_000_000).optional(),
  aiPerMonth: z.number().int().min(0).max(10_000_000).optional(),
  aiBudgetUsd: z.number().min(0).max(100_000).optional(),
  campaignEmailsPerMonth: z.number().int().min(0).max(100_000_000).optional(),
  signaturesPerMonth: z.number().int().min(0).max(10_000_000).optional(),
  storageMb: z.number().int().min(0).max(100_000_000).optional(),
  chatGuests: z.number().int().min(0).max(10_000_000).optional(),
});

/** What the platform team can set on one workspace on top of its plan (Admin → a workspace). */
export const overridesSchema = z.object({
  /** Features added to the plan for this workspace. */
  modules: z.array(moduleId).max(MODULE_IDS.length).default([]),
  /** Raised or lowered limits; anything not set comes from the plan. */
  limits: z.object({ projects: z.number().int().min(0).max(100_000).optional(), seats: z.number().int().min(0).max(100_000).optional(), customDomains: z.number().int().min(0).max(100_000).optional(), automationsPerProject: z.number().int().min(0).max(100_000).optional() }).default({}),
  /** Allowances to use instead of the plan's; null makes one unlimited. */
  quotas: z.partialRecord(z.enum(["invoicesPerMonth", "contacts", "aiPerMonth", "aiBudgetUsd", "campaignEmailsPerMonth", "signaturesPerMonth", "storageMb", "chatGuests"]), z.number().min(0).max(100_000_000).nullable()).default({}),
  note: z.string().trim().max(500).default(""),
});
export type Overrides = z.infer<typeof overridesSchema>;
