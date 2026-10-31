import { brandIssues } from "@/lib/site/brand-rules";
import { serializeSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import { can } from "@/server/authz/permissions";
import { loadDoc } from "@/server/growth/opportunities";
import { ApiError } from "@/server/http/errors";
import { readJson, requireProject, route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";
import { brandRulesSchema, getBrandRules, saveBrandRules } from "@/server/services/brand";
import { writeFile } from "@/server/services/files";

type P = { projectId: string };

export const GET = route<P>(async (ctx, { projectId }) => {
  const { role } = await requireProject(ctx, projectId, "project:read");
  const rules = await getBrandRules(projectId);
  const loaded = await loadDoc(projectId);
  return { rules, issues: loaded ? brandIssues(loaded.doc, rules) : [], theme: loaded?.doc.theme ?? null, logo: loaded?.doc.brand?.logo ?? null, canManage: can(role, "brand:manage") };
});

export const PUT = route<P>(async (ctx, { projectId }) => {
  const { project } = await requireProject(ctx, projectId, "brand:manage");
  const input = await readJson(ctx.req, brandRulesSchema);
  const loaded = await loadDoc(projectId);
  if (!loaded) throw new ApiError("conflict", "The site design cannot be read; fix it in the IDE first");
  const rules = await saveBrandRules(projectId, ctx.user.id, input, loaded.doc);
  await audit({ orgId: project.orgId, actorId: ctx.user.id, action: "brand.rules_updated", targetType: "project", targetId: projectId, metadata: { lockPalette: input.lockPalette, lockFonts: input.lockFonts, lockLogo: input.lockLogo, bannedWords: input.bannedWords.length }, ip: ctx.ip });
  return { rules, issues: brandIssues(loaded.doc, rules) };
});

/** Puts the locked colours, fonts and logo back on the site. */
export const POST = route<P>(async (ctx, { projectId }) => {
  await requireProject(ctx, projectId, "design:write");
  const rules = await getBrandRules(projectId);
  const loaded = await loadDoc(projectId);
  if (!rules || !loaded) throw new ApiError("conflict", "Nothing to restore");
  const doc = loaded.doc;
  if (rules.lockPalette && rules.palette) doc.theme.palette = rules.palette;
  if (rules.lockFonts && rules.font && rules.headingFont) Object.assign(doc.theme, { font: rules.font, headingFont: rules.headingFont });
  if (rules.lockLogo && rules.logo) doc.brand = { ...(doc.brand ?? {}), logo: rules.logo };
  await writeFile(projectId, SITE_DOC_PATH, serializeSiteDoc(doc), loaded.revision, { userId: ctx.user.id, source: "user", message: "Restored the locked brand" });
  return { issues: brandIssues(doc, rules) };
});
