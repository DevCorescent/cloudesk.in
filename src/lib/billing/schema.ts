// Request shapes for subscriptions, shared by the routes and sign-up.
import { z } from "zod";
import { MODULE_IDS, type ModuleId } from "@/lib/workspace/modules";

const moduleId = z.enum(MODULE_IDS as unknown as [ModuleId, ...ModuleId[]]);
export const intervalSchema = z.enum(["month", "year"]);

export const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), planId: z.string().trim().regex(/^[a-z0-9-]{2,30}$/), interval: intervalSchema }),
  z.object({ kind: z.literal("custom"), modules: z.array(moduleId).max(MODULE_IDS.length), seats: z.number().int().min(1).max(10000), interval: intervalSchema }),
]);
