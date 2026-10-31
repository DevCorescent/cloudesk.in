import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { lockViolations, type BrandRules } from "@/lib/site/brand-rules";
import { FONT_KEYS } from "@/lib/site/fonts";
import { parseSiteDoc, type SiteDoc } from "@/lib/site/model";
import { ApiError } from "../http/errors";
import type { Tx } from "./orgs";

export async function getBrandRules(projectId: string, exec: typeof db | Tx = db): Promise<BrandRules | null> {
  const [r] = await exec.select().from(schema.brandGuardrails).where(eq(schema.brandGuardrails.projectId, projectId));
  if (!r) return null;
  return {
    lockPalette: r.lockPalette,
    palette: (r.palette as BrandRules["palette"]) ?? null,
    lockFonts: r.lockFonts,
    font: r.font,
    headingFont: r.headingFont,
    lockLogo: r.lockLogo,
    logo: r.logo,
    voice: r.voice,
    bannedWords: r.bannedWords,
    preferredTerms: (r.preferredTerms as BrandRules["preferredTerms"]) ?? [],
  };
}

export const brandRulesSchema = z.object({
  lockPalette: z.boolean(),
  lockFonts: z.boolean(),
  lockLogo: z.boolean(),
  voice: z.string().trim().max(1500),
  bannedWords: z.array(z.string().trim().min(1).max(60)).max(100),
  preferredTerms: z.array(z.object({ avoid: z.string().trim().min(1).max(60), use: z.string().trim().min(1).max(60) })).max(50),
});

/** Saves rules. Locking captures the site's current colours, fonts and logo as the brand. */
export async function saveBrandRules(projectId: string, userId: string, input: z.infer<typeof brandRulesSchema>, doc: SiteDoc) {
  if (input.lockLogo && !doc.brand?.logo) throw new ApiError("validation_failed", "Add a logo to the site before locking it", { lockLogo: ["No logo yet"] });
  const fontsOk = (FONT_KEYS as readonly string[]).includes(doc.theme.font);
  const values = {
    ...input,
    bannedWords: [...new Set(input.bannedWords.map((w) => w.toLowerCase()))],
    palette: input.lockPalette ? doc.theme.palette : null,
    font: input.lockFonts && fontsOk ? doc.theme.font : null,
    headingFont: input.lockFonts && fontsOk ? doc.theme.headingFont : null,
    logo: input.lockLogo ? (doc.brand?.logo ?? null) : null,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db.insert(schema.brandGuardrails).values({ projectId, ...values }).onConflictDoUpdate({ target: schema.brandGuardrails.projectId, set: values });
  return getBrandRules(projectId);
}

/** Called for every save of the design document. Throws when the change breaks a lock. */
export async function enforceBrand(projectId: string, beforeJson: string | null, afterJson: string, source: string, exec: typeof db | Tx) {
  const rules = await getBrandRules(projectId, exec);
  if (!rules) return;
  const after = parseSiteDoc(afterJson);
  if (!after.ok) return; // invalid documents are rejected by validation elsewhere
  const before = beforeJson ? parseSiteDoc(beforeJson) : null;
  const problems = lockViolations(before?.ok ? before.doc : null, after.doc, rules, { ai: source === "ai" });
  if (problems.length) throw new ApiError("validation_failed", `Brand guardrails: ${problems.join(" ")} An owner or admin can change this under Brand.`, { brand: problems });
}
