// Workspace features: which parts of the dashboard this organization uses.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { INDUSTRIES, isOn, MODULE_IDS, normaliseParts, withRequirements, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { log } from "@/server/log";
import { setupModule } from "@/server/workspace/setup";
import { readJson, requireOrg, route } from "@/server/http/handler";
import { audit } from "@/server/services/audit";

type P = { orgId: string };

const input = z.object({
  /** null switches everything on. */
  modules: z.array(z.enum(MODULE_IDS as [ModuleId, ...ModuleId[]])).max(MODULE_IDS.length).nullable(),
  industry: z.enum(INDUSTRIES.map((i) => i.id) as [string, ...string[]]).optional(),
  /** Parts switched off, by module; left out keeps what's saved. */
  partsOff: z.record(z.string().max(40), z.array(z.string().max(40)).max(40)).optional(),
});

async function current(orgId: string) {
  const [o] = await db.select({ modules: schema.organizations.modules, industry: schema.organizations.industry, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return { modules: o?.modules ?? null, industry: o?.industry ?? null, partsOff: (o?.partsOff ?? {}) as PartsOff };
}

export const GET = route<P>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:read");
  return current(orgId);
});

export const PUT = route<P>(async (ctx, { orgId }) => {
  await requireOrg(ctx, orgId, "org:update");
  const b = await readJson(ctx.req, input);
  const before = (await current(orgId)).modules;
  // Whatever a chosen module needs comes with it.
  const modules = b.modules ? withRequirements(b.modules) : null;
  const partsOff = b.partsOff ? normaliseParts(b.partsOff) : undefined;
  await db
    .update(schema.organizations)
    .set({ modules, ...(b.industry ? { industry: b.industry } : {}), ...(partsOff ? { partsOff } : {}) })
    .where(eq(schema.organizations.id, orgId));
  // Whatever was just switched on gets set up, so it's ready to use.
  const wasOn = (id: ModuleId) => isOn(before, id);
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  for (const id of MODULE_IDS.filter((m) => isOn(modules, m) && !wasOn(m))) {
    await setupModule(id, { orgId, userId: ctx.user.id, businessName: org?.name ?? "My business" }).catch((e) => log.warn("module setup failed", { orgId, module: id, error: String(e) }));
  }
  await audit({ orgId, actorId: ctx.user.id, action: "org.modules_updated", targetType: "organization", targetId: orgId, metadata: { modules, industry: b.industry ?? null, ...(partsOff ? { partsOff } : {}) } });
  return current(orgId);
});
