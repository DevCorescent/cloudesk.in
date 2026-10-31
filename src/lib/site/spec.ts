// Structured project specification produced by the planner (rule-based or an
// LLM) and approved by the user before any site generation happens.
import { z } from "zod";
import { SECTION_TYPES, THEME_PRESETS } from "./model";

export const projectSpecSchema = z.object({
  name: z.string().min(1).max(120),
  summary: z.string().max(1000),
  kind: z.enum(["website", "landing", "portfolio", "blog", "store", "app"]),
  industry: z.string().max(60),
  audience: z.string().max(300),
  goals: z.array(z.string().max(200)).max(10),
  tone: z.string().max(120),
  themePreset: z.enum(Object.keys(THEME_PRESETS) as [string, ...string[]]),
  /** Design direction (see design.ts PERSONALITIES) and variation seed. */
  personality: z.string().max(40).optional(),
  designSeed: z.number().int().min(0).max(1000).optional(),
  pages: z
    .array(
      z.object({
        path: z.string().regex(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/),
        title: z.string().min(1).max(80),
        purpose: z.string().max(300),
        sections: z.array(z.enum(SECTION_TYPES)).min(1).max(20),
      }),
    )
    .min(1)
    .max(20),
  contact: z.object({
    email: z.string().max(120).default(""),
    phone: z.string().max(40).default(""),
    whatsapp: z.string().max(20).default(""),
    address: z.string().max(300).default(""),
  }),
  dataModels: z
    .array(z.object({ name: z.string().max(60), fields: z.array(z.string().max(60)).max(30), purpose: z.string().max(200) }))
    .max(20),
  integrations: z
    .array(z.object({ provider: z.string().max(60), purpose: z.string().max(200), required: z.boolean() }))
    .max(20),
  questions: z.array(z.object({ id: z.string().max(40), question: z.string().max(300), why: z.string().max(300) })).max(8),
  assumptions: z.array(z.string().max(300)).max(15),
});

export type ProjectSpec = z.infer<typeof projectSpecSchema>;
