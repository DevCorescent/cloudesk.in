// Deals: the board for a pipeline, moving between stages (with a trail and the
// days spent in each), winning or losing with a reason, and reopening.
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { dealSchema } from "@/lib/crm/model";
import { check, pipelines, requireManage, requireMember, requireWrite, visible, type Scope } from "./access";
import { addEvent, rescore, touch } from "./timeline";
import { emit } from "../hub/core";
import { contains } from "../security/like";

const D = schema.crmDeals;
export type Deal = typeof D.$inferSelect;

async function stageOf(orgId: string, stageId: string) {
  const [st] = await db.select().from(schema.crmStages).where(and(eq(schema.crmStages.id, stageId), eq(schema.crmStages.orgId, orgId)));
  if (!st) throw new ApiError("validation_failed", "Choose a stage", { stageId: ["Not found"] });
  return st;
}

export async function board(s: Scope, opts: { pipelineId?: string; owner?: string; q?: string; status?: string }) {
  const all = await pipelines(s.orgId);
  const p = all.find((x) => x.id === opts.pipelineId) ?? all[0];
  if (!p) throw notFound("Pipeline");
  const where = and(
    eq(D.orgId, s.orgId),
    eq(D.pipelineId, p.id),
    visible(s, D.ownerId),
    opts.owner === "me" ? eq(D.ownerId, s.userId) : opts.owner && /^[0-9a-f-]{36}$/.test(opts.owner) ? eq(D.ownerId, opts.owner) : undefined,
    opts.q ? ilike(D.title, contains(opts.q)) : undefined,
    // Closed deals stay on the board for 30 days so the Won/Lost columns aren't endless.
    opts.status === "all" ? undefined : sql`(${D.status} = 'open' or ${D.closedAt} > now() - interval '30 days')`,
  );
  const rows = await db
    .select({
      d: D,
      contact: schema.crmContacts.name,
      contactEmail: schema.crmContacts.email,
      company: schema.crmCompanies.name,
      nextTask: sql<string | null>`(select min(due_at)::text from crm_activities a where a.deal_id = ${D.id} and a.kind = 'task' and a.done_at is null)`,
    })
    .from(D)
    .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, D.contactId))
    .leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, D.companyId))
    .where(where)
    .orderBy(asc(D.position), desc(D.createdAt))
    .limit(2000);
  const deals = rows.map((r) => {
    const st = p.stages.find((x) => x.id === r.d.stageId);
    const days = Math.floor((Date.now() - r.d.stageEnteredAt.getTime()) / 86400000);
    return { ...r.d, contact: r.contact ?? r.contactEmail ?? "", company: r.company ?? "", nextTask: r.nextTask, daysInStage: days, rotting: !!st && st.kind === "open" && st.rotDays > 0 && days > st.rotDays };
  });
  const columns = p.stages.map((st) => {
    const ds = deals.filter((d) => d.stageId === st.id);
    const total = ds.reduce((a, d) => a + d.value, 0);
    return { stage: st, deals: ds, total, weighted: Math.round((total * st.probability) / 100) };
  });
  const open = deals.filter((d) => d.status === "open");
  return {
    pipeline: { id: p.id, name: p.name },
    pipelines: all.map((x) => ({ id: x.id, name: x.name })),
    columns,
    totals: { open: open.length, value: open.reduce((a, d) => a + d.value, 0), weighted: columns.filter((c) => c.stage.kind === "open").reduce((a, c) => a + c.weighted, 0) },
  };
}

export async function listDeals(s: Scope, opts: { q?: string; status?: string; owner?: string; pipelineId?: string; page?: number; per?: number }) {
  const per = Math.min(200, opts.per ?? 50);
  const page = Math.max(1, opts.page ?? 1);
  const where = and(
    eq(D.orgId, s.orgId),
    visible(s, D.ownerId),
    opts.pipelineId && /^[0-9a-f-]{36}$/.test(opts.pipelineId) ? eq(D.pipelineId, opts.pipelineId) : undefined,
    opts.status && ["open", "won", "lost"].includes(opts.status) ? eq(D.status, opts.status) : undefined,
    opts.owner === "me" ? eq(D.ownerId, s.userId) : opts.owner && /^[0-9a-f-]{36}$/.test(opts.owner) ? eq(D.ownerId, opts.owner) : undefined,
    opts.q ? ilike(D.title, contains(opts.q)) : undefined,
  );
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(D).where(where);
  const rows = await db
    .select({ d: D, stage: schema.crmStages.name, probability: schema.crmStages.probability, contact: schema.crmContacts.name, company: schema.crmCompanies.name })
    .from(D)
    .innerJoin(schema.crmStages, eq(schema.crmStages.id, D.stageId))
    .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, D.contactId))
    .leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, D.companyId))
    .where(where)
    .orderBy(desc(D.updatedAt))
    .limit(per)
    .offset((page - 1) * per);
  return { total: n, deals: rows.map((r) => ({ ...r.d, stage: r.stage, probability: r.probability, contact: r.contact ?? "", company: r.company ?? "" })) };
}

export async function requireDeal(s: Scope, id: string) {
  const [d] = await db.select().from(D).where(and(eq(D.id, id), eq(D.orgId, s.orgId), visible(s, D.ownerId)));
  if (!d) throw notFound("Deal");
  return d;
}

export async function getDeal(s: Scope, id: string) {
  const deal = await requireDeal(s, id);
  const [stage, contact, company, activities] = await Promise.all([
    stageOf(s.orgId, deal.stageId),
    deal.contactId ? db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, deal.contactId)).then((r) => r[0] ?? null) : null,
    deal.companyId ? db.select().from(schema.crmCompanies).where(eq(schema.crmCompanies.id, deal.companyId)).then((r) => r[0] ?? null) : null,
    db.select().from(schema.crmActivities).where(and(eq(schema.crmActivities.orgId, s.orgId), eq(schema.crmActivities.dealId, id))).orderBy(desc(sql`coalesce(${schema.crmActivities.doneAt}, ${schema.crmActivities.dueAt}, ${schema.crmActivities.createdAt})`)).limit(200),
  ]);
  const p = (await pipelines(s.orgId)).find((x) => x.id === deal.pipelineId);
  return { deal, stage, stages: p?.stages ?? [], pipeline: p ? { id: p.id, name: p.name } : null, contact, company, activities };
}

async function checkLinks(s: Scope, input: { contactId: string | null; companyId: string | null; ownerId: string | null }, cur?: Deal) {
  if (input.contactId && input.contactId !== cur?.contactId) {
    const [c] = await db.select({ id: schema.crmContacts.id, companyId: schema.crmContacts.companyId }).from(schema.crmContacts).where(and(eq(schema.crmContacts.id, input.contactId), eq(schema.crmContacts.orgId, s.orgId)));
    if (!c) throw new ApiError("validation_failed", "That contact isn't in this CRM", { contactId: ["Not found"] });
    // A deal with a person at a company belongs to that company too.
    if (!input.companyId && c.companyId) input.companyId = c.companyId;
  }
  if (input.companyId && input.companyId !== cur?.companyId) {
    const [c] = await db.select({ id: schema.crmCompanies.id }).from(schema.crmCompanies).where(and(eq(schema.crmCompanies.id, input.companyId), eq(schema.crmCompanies.orgId, s.orgId)));
    if (!c) throw new ApiError("validation_failed", "That company isn't in this CRM", { companyId: ["Not found"] });
  }
  if (input.ownerId && input.ownerId !== cur?.ownerId) await requireMember(s.orgId, input.ownerId);
}

export async function createDeal(s: Scope, raw: unknown) {
  requireWrite(s);
  const r = (raw ?? {}) as Record<string, unknown>;
  // Leaving out the pipeline or stage puts it at the start of the first pipeline.
  if (!r.pipelineId || !r.stageId) {
    const ps = await pipelines(s.orgId);
    const p = ps.find((x) => x.id === r.pipelineId) ?? ps[0];
    r.pipelineId = p.id;
    r.stageId = r.stageId ?? p.stages.find((x) => x.kind === "open")?.id;
  }
  const input = check(dealSchema, { currency: s.settings.currency, ...r });
  const st = await stageOf(s.orgId, input.stageId);
  if (st.pipelineId !== input.pipelineId) throw new ApiError("validation_failed", "That stage belongs to another pipeline");
  await checkLinks(s, input);
  const [{ min }] = await db.select({ min: sql<number>`coalesce(min(${D.position}), 0)` }).from(D).where(eq(D.stageId, st.id));
  const closed = st.kind !== "open";
  const [deal] = await db
    .insert(D)
    .values({ orgId: s.orgId, ...input, ownerId: input.ownerId ?? (s.userId || null), position: Number(min) - 1, status: closed ? st.kind : "open", closedAt: closed ? new Date() : null })
    .returning();
  await addEvent(s.orgId, { subject: `Deal created in ${st.name}`, dealId: deal.id, contactId: deal.contactId, companyId: deal.companyId, by: s.userId });
  if (deal.contactId) {
    // Someone with a deal is at least an opportunity.
    await db.update(schema.crmContacts).set({ lifecycle: "opportunity" }).where(and(eq(schema.crmContacts.id, deal.contactId), inArray(schema.crmContacts.lifecycle, ["subscriber", "lead", "qualified"])));
    await rescore(s.orgId, [deal.contactId]);
  }
  return deal;
}

export async function updateDeal(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const cur = await requireDeal(s, id);
  const input = check(dealSchema, { ...cur, expectedClose: cur.expectedClose ?? null, ...(raw as object) });
  await checkLinks(s, input, cur);
  if (input.stageId !== cur.stageId || input.pipelineId !== cur.pipelineId) {
    await moveDeal(s, id, { stageId: input.stageId, lostReason: typeof (raw as { lostReason?: unknown })?.lostReason === "string" ? String((raw as { lostReason: string }).lostReason).slice(0, 120) : undefined });
  }
  const { stageId: _s, pipelineId: _p, ...rest } = input;
  void _s;
  void _p;
  const [d] = await db.update(D).set({ ...rest, updatedAt: new Date() }).where(eq(D.id, id)).returning();
  if (cur.value !== d.value) await addEvent(s.orgId, { subject: `Value changed`, body: `${cur.value / 100} → ${d.value / 100} ${d.currency}`, dealId: id, by: s.userId });
  if (cur.ownerId !== d.ownerId) await addEvent(s.orgId, { subject: "Owner changed", dealId: id, by: s.userId });
  return d;
}

/** Moves a deal to a stage (and position in it). Won and Lost stages close the deal. */
export async function moveDeal(s: Scope, id: string, to: { stageId: string; beforeId?: string | null; lostReason?: string }) {
  requireWrite(s);
  const cur = await requireDeal(s, id);
  const st = await stageOf(s.orgId, to.stageId);
  let position = cur.position;
  if (to.beforeId) {
    const [b] = await db.select({ position: D.position }).from(D).where(and(eq(D.id, to.beforeId), eq(D.stageId, st.id)));
    const [a] = b ? await db.select({ position: D.position }).from(D).where(and(eq(D.stageId, st.id), sql`${D.position} < ${b.position}`, sql`${D.id} <> ${id}`)).orderBy(desc(D.position)).limit(1) : [];
    position = b ? (a ? (a.position + b.position) / 2 : b.position - 1) : position;
  } else if (st.id !== cur.stageId || to.beforeId === null) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${D.position}), 0)` }).from(D).where(and(eq(D.stageId, st.id), sql`${D.id} <> ${id}`));
    position = Number(max) + 1;
  }
  const changed = st.id !== cur.stageId;
  if (st.kind === "lost" && changed && !to.lostReason && !cur.lostReason) throw new ApiError("validation_failed", "Why was it lost?", { lostReason: ["Required"] });
  const status = st.kind === "open" ? "open" : st.kind;
  const [d] = await db
    .update(D)
    .set({
      stageId: st.id,
      pipelineId: st.pipelineId,
      position,
      status,
      lostReason: st.kind === "lost" ? (to.lostReason ?? cur.lostReason) : "",
      closedAt: status === "open" ? null : changed || !cur.closedAt ? new Date() : cur.closedAt,
      ...(changed ? { stageEnteredAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(D.id, id))
    .returning();
  if (changed) {
    const [from] = await db.select({ name: schema.crmStages.name }).from(schema.crmStages).where(eq(schema.crmStages.id, cur.stageId));
    const days = Math.floor((Date.now() - cur.stageEnteredAt.getTime()) / 86400000);
    await addEvent(s.orgId, {
      subject: st.kind === "won" ? "Deal won 🎉" : st.kind === "lost" ? `Deal lost — ${d.lostReason}` : `Moved to ${st.name}`,
      body: `From ${from?.name ?? "—"} after ${days} day${days === 1 ? "" : "s"}`,
      dealId: id,
      contactId: d.contactId,
      by: s.userId,
      meta: { from: cur.stageId, to: st.id, days },
    });
    if (st.kind === "won" && d.contactId) {
      await db.update(schema.crmContacts).set({ lifecycle: "customer", updatedAt: new Date() }).where(and(eq(schema.crmContacts.id, d.contactId), inArray(schema.crmContacts.lifecycle, ["subscriber", "lead", "qualified", "opportunity", "other"])));
      // A won deal ends any follow-up sequence for them.
      await db.update(schema.crmEnrollments).set({ status: "stopped", stopReason: "Deal won", nextAt: null }).where(and(eq(schema.crmEnrollments.contactId, d.contactId), eq(schema.crmEnrollments.status, "active")));
    }
    await touch([d.contactId]);
    if (d.contactId) await rescore(s.orgId, [d.contactId]);
    if (st.kind === "won") await emit(s.orgId, "crm.deal.won", { id: d.id, title: d.title, valuePaise: d.value, contactId: d.contactId });
  }
  return d;
}

export async function deleteDeal(s: Scope, id: string) {
  requireManage(s);
  const d = await requireDeal(s, id);
  await db.delete(D).where(eq(D.id, id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "crm.deal.deleted", targetType: "crm_deal", targetId: id, metadata: { title: d.title, value: d.value } });
  if (d.contactId) await rescore(s.orgId, [d.contactId]);
}
