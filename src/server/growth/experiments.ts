import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { createSection, sectionDef, serializeSiteDoc, SITE_DOC_PATH, type SiteDoc } from "@/lib/site/model";
import { formatMoney } from "@/lib/store/money";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { audit } from "../services/audit";
import { createDeployment } from "../services/deployments";
import { writeFile } from "../services/files";
import { appUrl, sendMail } from "../services/mail";
import { experimentCounts, pageViews, significance } from "../services/stats";
import { findOpportunities, loadDoc, METRIC_LABEL, type Metric, type Opportunity, type TestChange } from "./opportunities";

export type ExperimentRow = typeof schema.growthExperiments.$inferSelect;
type Project = { id: string; orgId: string; name: string };

/** Longest a test runs before it is called inconclusive. */
export const MAX_DAYS = 28;

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(projectId: string) {
  const [s] = await db.select().from(schema.growthSettings).where(eq(schema.growthSettings.projectId, projectId));
  return s ?? { projectId, autoApplyWinners: true, autoPublish: false, autoStart: false, dismissed: [] as string[], updatedAt: new Date() };
}

export const settingsSchema = z.object({ autoApplyWinners: z.boolean(), autoPublish: z.boolean(), autoStart: z.boolean() }).partial();

export async function saveSettings(projectId: string, patch: z.infer<typeof settingsSchema>) {
  await db
    .insert(schema.growthSettings)
    .values({ projectId, ...patch })
    .onConflictDoUpdate({ target: schema.growthSettings.projectId, set: { ...patch, updatedAt: new Date() } });
  return getSettings(projectId);
}

export async function dismiss(projectId: string, key: string) {
  const s = await getSettings(projectId);
  const dismissed = [...new Set([...s.dismissed, key])].slice(-500);
  await db.insert(schema.growthSettings).values({ projectId, dismissed }).onConflictDoUpdate({ target: schema.growthSettings.projectId, set: { dismissed, updatedAt: new Date() } });
}

// ─── Document edits ──────────────────────────────────────────────────────────

/** Applies a change to the latest design document and saves it as a new revision. */
async function editDoc(projectId: string, userId: string | null, message: string, fn: (doc: SiteDoc) => boolean | void) {
  const loaded = await loadDoc(projectId);
  if (!loaded) throw new ApiError("conflict", "The site design cannot be read; fix it in the IDE first");
  const changed = fn(loaded.doc);
  if (changed === false) return false;
  await writeFile(projectId, SITE_DOC_PATH, serializeSiteDoc(loaded.doc), loaded.revision, { userId, source: "ai", message });
  return true;
}

function findSection(doc: SiteDoc, path: string, sectionId: string) {
  const page = doc.pages.find((p) => p.path === path);
  const section = page?.sections.find((s) => s.id === sectionId);
  return { page, section };
}

/** Only text fields of the section, within their length limits, may be changed by a test. */
function validateChange(type: string, change: TestChange) {
  const def = sectionDef(type);
  if (!def) throw new ApiError("validation_failed", "Unknown section type");
  if (change.variant && !(def.variants ?? []).some((v) => v.value === change.variant)) throw new ApiError("validation_failed", "That layout does not exist for this section");
  for (const [k, v] of Object.entries(change.props ?? {})) {
    const f = def.fields.find((x) => x.key === k);
    if (!f || !["text", "textarea"].includes(f.kind)) throw new ApiError("validation_failed", `“${k}” cannot be tested`);
    if (typeof v !== "string" || v.length > ((f as { max?: number }).max ?? 500)) throw new ApiError("validation_failed", `“${f.label}” is too long`);
  }
  if (!change.variant && !Object.keys(change.props ?? {}).length) throw new ApiError("validation_failed", "The test does not change anything");
}

// ─── Starting and stopping ───────────────────────────────────────────────────

export const customTestSchema = z.object({
  path: z.string().max(200),
  sectionId: z.string().max(64),
  title: z.string().trim().min(1).max(200),
  hypothesis: z.string().trim().max(500).default(""),
  metric: z.enum(["submit", "cart_add", "checkout", "order"]),
  change: z.object({ variant: z.string().max(40).optional(), props: z.record(z.string(), z.string().max(2000)).optional() }),
});

export async function startExperiment(project: Project, userId: string | null, input: z.infer<typeof customTestSchema> & { opportunityKey?: string; source?: string }) {
  const running = await db.select({ id: schema.growthExperiments.id }).from(schema.growthExperiments).where(and(eq(schema.growthExperiments.projectId, project.id), eq(schema.growthExperiments.path, input.path), eq(schema.growthExperiments.status, "running")));
  if (running.length) throw new ApiError("conflict", "A test is already running on this page. One test per page keeps results clean.");
  const id = crypto.randomUUID();
  let before: TestChange = {};
  await editDoc(project.id, userId, `Growth: started test — ${input.title}`, (doc) => {
    const { page, section } = findSection(doc, input.path, input.sectionId);
    if (!page || !section) throw notFound("Section");
    if (page.sections.some((s) => s.ab?.running)) throw new ApiError("conflict", "A test is already running on this page (started from the builder). Stop it first.");
    validateChange(section.type, input.change);
    before = { variant: input.change.variant ? (section.variant ?? sectionDef(section.type)?.variants?.[0]?.value) : undefined, props: Object.fromEntries(Object.keys(input.change.props ?? {}).map((k) => [k, section.props[k]])) };
    section.ab = { variant: input.change.variant ?? "", props: input.change.props, running: true, experimentId: id };
  });
  const [exp] = await db
    .insert(schema.growthExperiments)
    .values({ id, projectId: project.id, path: input.path, sectionId: input.sectionId, title: input.title, hypothesis: input.hypothesis, change: { ...input.change, before }, metric: input.metric, source: input.source ?? "user", opportunityKey: input.opportunityKey ?? "", createdBy: userId })
    .returning();
  await audit({ orgId: project.orgId, actorId: userId, action: "growth.test_started", targetType: "experiment", targetId: id, metadata: { title: input.title } });
  return exp;
}

/** Starts a suggested test. Headline tests get their new copy from the AI first. */
export async function startFromOpportunity(project: Project, userId: string | null, opportunityKey: string, opts: { aiAvailable: boolean; writeHeadline?: (o: Opportunity) => Promise<Record<string, string>> }) {
  const o = (await findOpportunities(project.id, { aiAvailable: opts.aiAvailable })).find((x) => x.key === opportunityKey);
  if (!o?.test) throw new ApiError("conflict", "This suggestion is no longer available. Refresh the page.");
  let change = o.test.change as z.infer<typeof customTestSchema>["change"];
  let source = "rules";
  if (o.test.aiWritable) {
    if (!opts.writeHeadline) throw new ApiError("provider_not_configured", "Connect an AI provider to write new headlines.");
    change = { props: await opts.writeHeadline(o) };
    source = "ai";
  }
  return startExperiment(project, userId, { path: o.test.path, sectionId: o.test.sectionId, title: o.title, hypothesis: o.test.hypothesis, metric: o.test.metric, change, opportunityKey, source });
}

/** Removes the B version from the document (keeping A), or applies B permanently. */
async function settleDoc(projectId: string, exp: ExperimentRow, applyB: boolean, userId: string | null) {
  const change = exp.change as TestChange;
  let found = false;
  const changed = await editDoc(projectId, userId, applyB ? `Growth: applied winning version — ${exp.title}` : `Growth: ended test — ${exp.title}`, (doc) => {
    const { section } = findSection(doc, exp.path, exp.sectionId);
    if (!section?.ab || section.ab.experimentId !== exp.id) return false;
    found = true;
    if (applyB) {
      if (change.variant) section.variant = change.variant;
      if (change.props) Object.assign(section.props, change.props);
    }
    delete section.ab;
  });
  return changed && found;
}

export async function stopExperiment(project: Project, userId: string, id: string) {
  const exp = await getExperiment(project.id, id);
  if (exp.status !== "running") throw new ApiError("conflict", "This test has already ended");
  await settleDoc(project.id, exp, false, userId);
  await db.update(schema.growthExperiments).set({ status: "stopped", endedAt: new Date(), outcome: "kept_original" }).where(eq(schema.growthExperiments.id, id));
  await audit({ orgId: project.orgId, actorId: userId, action: "growth.test_stopped", targetType: "experiment", targetId: id });
}

export async function applyWinner(project: Project, userId: string, id: string) {
  const exp = await getExperiment(project.id, id);
  if (exp.status !== "won" || exp.outcome === "applied" || exp.outcome === "applied_published") throw new ApiError("conflict", "Only an unapplied winning test can be applied");
  const ok = await settleDoc(project.id, exp, true, userId).catch(() => false);
  if (!ok) {
    // The test arm is already gone from the design (e.g. ended earlier): apply the change directly.
    await editDoc(project.id, userId, `Growth: applied winning version — ${exp.title}`, (doc) => {
      const { section } = findSection(doc, exp.path, exp.sectionId);
      if (!section) throw new ApiError("conflict", "The tested section no longer exists");
      const c = exp.change as TestChange;
      if (c.variant) section.variant = c.variant;
      if (c.props) Object.assign(section.props, c.props);
      delete section.ab;
    });
  }
  await db.update(schema.growthExperiments).set({ outcome: "applied" }).where(eq(schema.growthExperiments.id, id));
}

export async function getExperiment(projectId: string, id: string) {
  const [e] = await db.select().from(schema.growthExperiments).where(and(eq(schema.growthExperiments.id, id), eq(schema.growthExperiments.projectId, projectId)));
  if (!e) throw notFound("Test");
  return e;
}

// ─── Results ─────────────────────────────────────────────────────────────────

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function liveResult(exp: ExperimentRow) {
  const counts = await experimentCounts(exp.projectId, `g:${exp.id}`, dayOf(exp.startedAt));
  const metric = exp.metric as Metric;
  const A = { views: counts.A.view, conversions: counts.A[metric] };
  const B = { views: counts.B.view, conversions: counts.B[metric] };
  const sig = significance({ views: A.views, submits: A.conversions }, { views: B.views, submits: B.conversions });
  const uplift = sig.rateA > 0 ? (sig.rateB - sig.rateA) / sig.rateA : null;
  return { A, B, rateA: sig.rateA, rateB: sig.rateB, confidence: sig.confidence, verdict: sig.verdict, uplift, days: Math.max(1, Math.ceil((Date.now() - exp.startedAt.getTime()) / 86400_000)) };
}

/** A clearly labelled estimate of what the winner adds per month at current traffic. */
async function monthlyImpact(projectId: string, exp: ExperimentRow, rateA: number, rateB: number) {
  const views = (await pageViews(projectId, 30)).get(exp.path) ?? 0;
  const extra = Math.round((rateB - rateA) * views);
  const metric = exp.metric as Metric;
  let revenue: number | null = null;
  const [store] = await db.select({ currency: schema.stores.currency }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (store && (metric === "order" || metric === "cart_add" || metric === "checkout")) {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [o] = await db.select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(coalesce(${schema.storeOrders.baseTotal}, ${schema.storeOrders.total})),0)::bigint` }).from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), sql`${schema.storeOrders.cancelledAt} is null`, sql`${schema.storeOrders.createdAt} >= ${since}`));
    const [c] = await db.select({ n: sql<number>`coalesce(sum(${schema.siteStats.count}),0)::int` }).from(schema.siteStats).where(and(eq(schema.siteStats.projectId, projectId), eq(schema.siteStats.kind, metric), eq(schema.siteStats.experiment, ""), sql`${schema.siteStats.day} >= ${dayOf(since)}`));
    if (o.n > 0) {
      const aov = Number(o.total) / o.n;
      // Convert the metric into orders using this store's own ratio over the last 30 days.
      const toOrders = metric === "order" ? 1 : c.n > 0 ? Math.min(1, o.n / c.n) : 0;
      revenue = Math.round(extra * toOrders * aov);
    }
  }
  return { views, extra, unit: METRIC_LABEL[metric], revenue, currency: store?.currency ?? null };
}

async function notifyOwners(project: Project, subject: string, body: string) {
  const owners = await db
    .select({ email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.orgId, project.orgId), inArray(schema.memberships.role, ["owner", "admin"])));
  for (const o of owners) await sendMail({ to: o.email, subject, body: `${body}\n\nSee all tests: ${appUrl(`/projects/${project.id}/growth`)}` }).catch(() => {});
}

async function publish(project: Project, userId: string | null, reason: string) {
  try {
    const actor = userId ?? (await db.select({ id: schema.users.id }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, project.orgId), eq(schema.memberships.role, "owner"))).limit(1))[0]?.id;
    if (!actor) return { ok: false, error: "No owner to publish as" };
    const d = await createDeployment(project, "production", actor);
    if (d.status !== "ready") return { ok: false, error: d.error ?? "Deployment failed" };
    log.info("growth_published", { project: project.id, reason });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Decides finished tests. A winner is called at 95% confidence with at least
 * 100 visits per group; after MAX_DAYS without a winner the test is
 * inconclusive and the original stays.
 */
export async function evaluateProject(projectId: string) {
  const running = await db.select().from(schema.growthExperiments).where(and(eq(schema.growthExperiments.projectId, projectId), eq(schema.growthExperiments.status, "running")));
  if (!running.length) return [];
  const [project] = await db.select({ id: schema.projects.id, orgId: schema.projects.orgId, name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const settings = await getSettings(projectId);
  const decided: { id: string; status: string }[] = [];
  for (const exp of running) {
    const r = await liveResult(exp);
    const sure = r.confidence !== null && r.confidence >= 0.95;
    const expired = r.days > MAX_DAYS;
    if (!sure && !expired) continue;
    const status = sure ? (r.rateB > r.rateA ? "won" : "lost") : "inconclusive";
    const impact = status === "won" ? await monthlyImpact(projectId, exp, r.rateA, r.rateB) : null;
    let outcome = "kept_original";
    let docChanged = false;
    try {
      if (status === "won" && settings.autoApplyWinners) {
        docChanged = await settleDoc(projectId, exp, true, null);
        outcome = docChanged ? "applied" : "skipped: the tested section was changed or removed";
      } else {
        docChanged = await settleDoc(projectId, exp, false, null);
        outcome = status === "won" ? "awaiting_apply" : "kept_original";
      }
    } catch (e) {
      outcome = `skipped: ${(e as Error).message}`;
    }
    let published: { ok: boolean; error?: string } | null = null;
    if (docChanged && settings.autoPublish) {
      published = await publish(project, null, `test ${exp.id} ${status}`);
      if (published.ok && outcome === "applied") outcome = "applied_published";
    }
    await db.update(schema.growthExperiments).set({ status, endedAt: new Date(), outcome, result: { ...r, impact, published } }).where(eq(schema.growthExperiments.id, exp.id));
    decided.push({ id: exp.id, status });
    const m = (n: number) => `${(n * 100).toFixed(2)}%`;
    const impactLine = impact && impact.extra > 0 ? `\nEstimated at current traffic: about ${impact.extra} more ${impact.unit} a month${impact.revenue && impact.currency ? ` (≈ ${formatMoney(impact.revenue, impact.currency)} in sales)` : ""}. This is an estimate, not a guarantee.` : "";
    const next = { applied: "The winning version is now in your design.", applied_published: "The winning version is in your design and live on your site.", awaiting_apply: "Open Growth to apply the winning version.", kept_original: "Your original version stays." }[outcome.split(":")[0]] ?? outcome;
    await notifyOwners(
      project,
      `${project.name}: test ${status === "won" ? "found a winner" : status === "lost" ? "finished — the original is better" : "ended without a clear winner"}`,
      `${exp.title}\n\nOriginal: ${m(r.rateA)} ${METRIC_LABEL[exp.metric as Metric]} per visit (${r.A.views} visits)\nNew version: ${m(r.rateB)} (${r.B.views} visits)${r.confidence !== null ? `\nConfidence: ${(r.confidence * 100).toFixed(0)}%` : ""}${impactLine}\n\n${next}`,
    );
  }
  return decided;
}

/** When enabled, starts the most promising test on a page that has none. */
export async function autoStart(projectId: string) {
  const settings = await getSettings(projectId);
  if (!settings.autoStart) return null;
  const [project] = await db.select({ id: schema.projects.id, orgId: schema.projects.orgId, name: schema.projects.name, prod: schema.projects.productionDeploymentId }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project?.prod) return null;
  const running = await db.select({ id: schema.growthExperiments.id }).from(schema.growthExperiments).where(and(eq(schema.growthExperiments.projectId, projectId), eq(schema.growthExperiments.status, "running")));
  if (running.length >= 2) return null;
  const next = (await findOpportunities(projectId, { aiAvailable: false })).find((o) => o.test && o.impact !== "low");
  if (!next) return null;
  const exp = await startFromOpportunity(project, null, next.key, { aiAvailable: false });
  if (settings.autoPublish) await publish(project, null, `auto-started ${exp.id}`);
  return exp;
}

export async function listExperiments(projectId: string) {
  const rows = await db.select().from(schema.growthExperiments).where(eq(schema.growthExperiments.projectId, projectId)).orderBy(desc(schema.growthExperiments.startedAt)).limit(100);
  return Promise.all(rows.map(async (e) => ({ ...e, live: e.status === "running" ? await liveResult(e) : null })));
}

/** Runs the evaluation (and optional auto-start) for every project with growth activity. */
export async function growthTick() {
  const projects = await db.execute<{ project_id: string }>(sql`select distinct project_id from growth_experiments where status = 'running' union select project_id from growth_settings where auto_start`);
  for (const p of projects.rows) {
    try {
      await evaluateProject(p.project_id);
      await autoStart(p.project_id);
    } catch (e) {
      log.warn("growth_tick_failed", { project: p.project_id, error: (e as Error).message });
    }
  }
}

// ─── One-click fixes ─────────────────────────────────────────────────────────

export async function applyAction(project: Project, userId: string, key: string, can: (p: string) => boolean) {
  const o = (await findOpportunities(project.id)).find((x) => x.key === key);
  if (!o?.action || o.action.type === "link") throw new ApiError("conflict", "This suggestion is no longer available. Refresh the page.");
  const a = o.action;
  if ((a.type === "feature_product" || a.type === "unfeature_product" || a.type === "set_free_shipping") && !can("store:manage")) throw new ApiError("forbidden", "You need store access for this");
  if ((a.type === "add_product_grid" || a.type === "set_banner") && !can("design:write")) throw new ApiError("forbidden", "You need design access for this");
  if (a.type === "feature_product" || a.type === "unfeature_product") {
    await db.update(schema.storeProducts).set({ featured: a.type === "feature_product", updatedAt: new Date() }).where(and(eq(schema.storeProducts.id, a.productId), eq(schema.storeProducts.projectId, project.id)));
  } else if (a.type === "set_free_shipping") {
    await db.update(schema.storeShippingRates).set({ freeOver: a.amount }).where(and(eq(schema.storeShippingRates.id, a.rateId), eq(schema.storeShippingRates.projectId, project.id)));
  } else if (a.type === "add_product_grid") {
    await editDoc(project.id, userId, "Growth: added a bestsellers grid to the home page", (doc) => {
      const page = doc.pages.find((p) => p.id === a.pageId);
      if (!page) throw notFound("Page");
      const grid = createSection("productGrid");
      Object.assign(grid.props, { heading: "Bestsellers", subheading: "", sort: "featured", limit: 8, buttonLabel: "Shop all" });
      const heroAt = page.sections.findIndex((s) => s.type === "hero");
      page.sections.splice(heroAt >= 0 ? heroAt + 1 : 1, 0, grid);
    });
  } else if (a.type === "set_banner") {
    await editDoc(project.id, userId, "Growth: added a free-shipping announcement", (doc) => {
      const page = doc.pages.find((p) => p.id === a.pageId);
      if (!page) throw notFound("Page");
      const banner = createSection("banner");
      Object.assign(banner.props, { text: a.text, linkLabel: "Shop now", linkHref: "/shop" });
      page.sections.unshift(banner);
    });
  }
  await audit({ orgId: project.orgId, actorId: userId, action: "growth.fix_applied", targetType: "project", targetId: project.id, metadata: { type: a.type, title: o.title } });
  return { done: o.title, needsPublish: a.type === "add_product_grid" || a.type === "set_banner" };
}

export { publish as publishProduction };
