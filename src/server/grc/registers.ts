// The GRC registers: risks (scored before and after their controls), controls
// and their tests, incidents (anyone can report; the team investigates),
// internal audits with findings, and policies — published versions each
// member in the audience acknowledges.
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { auditSchema, controlSchema, findingSchema, incidentSchema, incidentUpdateSchema, nextTest, policySchema, rating, riskSchema, score, testSchema } from "@/lib/grc/model";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { audit as log } from "../services/audit";
import { check, members, nextNumber, requireMember, requirePart, requireRegisters, requireWrite, todayIst, type Scope } from "./access";
import { emit } from "../hub/core";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
async function one<T>(rows: Promise<T[]>, what: string) {
  const [r] = await rows;
  if (!r) throw notFound(what);
  return r;
}
const tell = (s: Scope, to: string | null | undefined, what: string, title: string, link: string) => (to && to !== s.userId ? notify(s.orgId, [to], { kind: "grc.assigned", title: `${what}: ${title}`, link, values: { what, title, link } }).catch(() => {}) : Promise.resolve());

// ── Risks ───────────────────────────────────────────────────────────────────

const R = schema.grcRisks;
const withScores = <T extends { likelihood: number; impact: number; residualLikelihood: number | null; residualImpact: number | null }>(r: T) => {
  const inherent = score(r.likelihood, r.impact);
  const residual = r.residualLikelihood && r.residualImpact ? score(r.residualLikelihood, r.residualImpact) : null;
  return { ...r, inherent, inherentRating: rating(inherent), residual, residualRating: residual === null ? null : rating(residual) };
};

export async function risks(s: Scope) {
  requireRegisters(s);
  requirePart(s, "risks");
  const rows = await db.select().from(R).where(eq(R.orgId, s.orgId)).orderBy(desc(sql`${R.likelihood} * ${R.impact}`), asc(R.number));
  const today = todayIst();
  return rows.map((r) => ({ ...withScores(r), reviewDue: r.status !== "closed" && !!r.reviewDate && String(r.reviewDate) <= today }));
}

async function checkControls(s: Scope, ids: string[]) {
  if (!ids.length) return;
  const found = await db.select({ id: schema.grcControls.id }).from(schema.grcControls).where(and(eq(schema.grcControls.orgId, s.orgId), inArray(schema.grcControls.id, ids)));
  if (found.length !== new Set(ids).size) throw new ApiError("validation_failed", "A linked control isn't in this workspace", { controlIds: ["Unknown control"] });
}

export async function saveRisk(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "risks");
  const v = check(riskSchema, raw);
  if ((v.residualLikelihood === null) !== (v.residualImpact === null)) throw new ApiError("validation_failed", "Give both residual likelihood and impact, or neither", { residualImpact: ["Both or neither"] });
  await requireMember(s.orgId, v.ownerId);
  await checkControls(s, v.controlIds);
  const reviewDate = v.reviewDate ?? new Date(Date.parse(`${todayIst()}T00:00:00Z`) + s.settings.riskReviewMonths * 30 * 86_400_000).toISOString().slice(0, 10);
  if (id) {
    const before = await one(db.select().from(R).where(and(eq(R.id, id), eq(R.orgId, s.orgId))), "Risk");
    const [r] = await db.update(R).set({ ...v, reviewDate, updatedAt: new Date() }).where(eq(R.id, id)).returning();
    if (v.ownerId !== before.ownerId) await tell(s, v.ownerId, "Risk", `${r.number} ${r.title}`, `/compliance/risks/${r.id}`);
    return withScores(r);
  }
  const [r] = await db.insert(R).values({ ...v, reviewDate, orgId: s.orgId, number: await nextNumber(s.orgId, "risk"), createdBy: s.userId }).returning();
  await tell(s, v.ownerId, "Risk", `${r.number} ${r.title}`, `/compliance/risks/${r.id}`);
  return withScores(r);
}

export async function riskDetail(s: Scope, id: string) {
  requireRegisters(s);
  if (!isId(id)) throw notFound("Risk");
  const r = await one(db.select().from(R).where(and(eq(R.id, id), eq(R.orgId, s.orgId))), "Risk");
  const controls = r.controlIds.length ? await db.select().from(schema.grcControls).where(inArray(schema.grcControls.id, r.controlIds)) : [];
  const incidents = await db.select({ id: schema.grcIncidents.id, number: schema.grcIncidents.number, title: schema.grcIncidents.title, status: schema.grcIncidents.status }).from(schema.grcIncidents).where(eq(schema.grcIncidents.riskId, r.id));
  return { risk: withScores(r), controls, incidents };
}

export async function deleteRisk(s: Scope, id: string) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Risk");
  await db.delete(R).where(and(eq(R.id, id), eq(R.orgId, s.orgId)));
}

// ── Controls ────────────────────────────────────────────────────────────────

const C = schema.grcControls;

export async function controls(s: Scope) {
  requireRegisters(s);
  requirePart(s, "risks");
  const rows = await db.select().from(C).where(eq(C.orgId, s.orgId)).orderBy(asc(C.code));
  const linked = await db.select({ ids: R.controlIds }).from(R).where(eq(R.orgId, s.orgId));
  const today = todayIst();
  return rows.map((c) => ({ ...c, risks: linked.filter((r) => r.ids.includes(c.id)).length, overdue: c.active && !!c.nextTestDue && String(c.nextTestDue) < today }));
}

export async function saveControl(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "risks");
  const v = check(controlSchema, raw);
  await requireMember(s.orgId, v.ownerId);
  const [dup] = await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), sql`upper(${C.code}) = ${v.code.toUpperCase()}`));
  if (dup && dup.id !== id) throw new ApiError("conflict", `There's already a control ${v.code}`);
  if (id) return one(db.update(C).set(v).where(and(eq(C.id, id), eq(C.orgId, s.orgId))).returning(), "Control");
  const [c] = await db.insert(C).values({ ...v, orgId: s.orgId, nextTestDue: v.nextTestDue ?? (v.frequency === "adhoc" ? null : todayIst()) }).returning();
  return c;
}

/** Record a test; the control's latest result and next due date follow it. */
export async function testControl(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const c = await one(db.select().from(C).where(and(eq(C.id, id), eq(C.orgId, s.orgId))), "Control");
  const v = check(testSchema, raw);
  if (v.testedOn > todayIst()) throw new ApiError("validation_failed", "A test can't be in the future", { testedOn: ["In the future"] });
  if (v.documentId) await one(db.select({ id: schema.docFiles.id }).from(schema.docFiles).where(and(eq(schema.docFiles.id, v.documentId), eq(schema.docFiles.orgId, s.orgId))), "Document");
  const [t] = await db.insert(schema.grcControlTests).values({ ...v, orgId: s.orgId, controlId: c.id, testedBy: s.userId }).returning();
  const latest = !c.lastTestedOn || v.testedOn >= String(c.lastTestedOn);
  if (latest) await db.update(C).set({ lastResult: v.result, lastTestedOn: v.testedOn, nextTestDue: nextTest(v.testedOn, c.frequency as never) }).where(eq(C.id, c.id));
  return t;
}

export async function controlDetail(s: Scope, id: string) {
  requireRegisters(s);
  if (!isId(id)) throw notFound("Control");
  const c = await one(db.select().from(C).where(and(eq(C.id, id), eq(C.orgId, s.orgId))), "Control");
  const tests = await db.select({ t: schema.grcControlTests, by: schema.users.name }).from(schema.grcControlTests).leftJoin(schema.users, eq(schema.users.id, schema.grcControlTests.testedBy)).where(eq(schema.grcControlTests.controlId, c.id)).orderBy(desc(schema.grcControlTests.testedOn));
  const risks = await db.select({ id: R.id, number: R.number, title: R.title }).from(R).where(and(eq(R.orgId, s.orgId), sql`${R.controlIds} @> ${JSON.stringify([c.id])}::jsonb`));
  return { control: c, tests: tests.map(({ t, by }) => ({ ...t, by })), risks };
}

// ── Incidents ───────────────────────────────────────────────────────────────

const I = schema.grcIncidents;

/** Anyone in the workspace can report one; owners and admins (and the owner of GRC work) are told. */
export async function reportIncident(s: Scope, raw: unknown) {
  const v = check(incidentSchema, raw);
  if (new Date(v.occurredAt).getTime() > Date.now() + 5 * 60_000) throw new ApiError("validation_failed", "That's in the future", { occurredAt: ["In the future"] });
  const [r] = await db.insert(I).values({ ...v, occurredAt: new Date(v.occurredAt), orgId: s.orgId, number: await nextNumber(s.orgId, "incident"), reportedBy: s.userId }).returning();
  const to = (await members(s.orgId)).filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.id);
  await notify(s.orgId, to, { kind: "grc.incident", title: `${r.number}: ${r.title} (${r.severity})`, link: `/compliance/incidents/${r.id}`, values: { number: r.number, title: r.title, severity: r.severity, link: `/compliance/incidents/${r.id}` } }).catch(() => {});
  await emit(s.orgId, "grc.incident.reported", { id: r.id, number: r.number, title: r.title, type: r.type, severity: r.severity, personalData: r.personalData });
  await log({ orgId: s.orgId, actorId: s.userId, action: "grc.incident_reported", targetType: "grc_incident", targetId: r.id, metadata: { number: r.number, severity: r.severity, personalData: r.personalData } });
  return r;
}

/** The team sees every incident; others see the ones they reported. */
export async function incidents(s: Scope) {
  const rows = await db.select().from(I).where(and(eq(I.orgId, s.orgId), s.registers ? sql`true` : eq(I.reportedBy, s.userId))).orderBy(desc(I.occurredAt)).limit(500);
  return rows;
}

export async function incidentDetail(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Incident");
  const r = await one(db.select().from(I).where(and(eq(I.id, id), eq(I.orgId, s.orgId))), "Incident");
  if (!s.registers && r.reportedBy !== s.userId) throw notFound("Incident");
  return r;
}

export async function updateIncident(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const r = await incidentDetail(s, id);
  const v = check(incidentUpdateSchema, raw);
  await requireMember(s.orgId, v.ownerId);
  if (v.riskId) await one(db.select({ id: R.id }).from(R).where(and(eq(R.id, v.riskId), eq(R.orgId, s.orgId))), "Risk");
  if ((v.status === "resolved" || v.status === "closed") && !(v.rootCause ?? r.rootCause).trim()) throw new ApiError("validation_failed", "Record the root cause before resolving it", { rootCause: ["Required"] });
  const resolvedAt = v.status === "resolved" || v.status === "closed" ? (r.resolvedAt ?? new Date()) : v.status ? null : r.resolvedAt;
  const [after] = await db.update(I).set({ ...v, resolvedAt, updatedAt: new Date() }).where(eq(I.id, r.id)).returning();
  if (v.ownerId && v.ownerId !== r.ownerId) await tell(s, v.ownerId, "Incident", `${r.number} ${r.title}`, `/compliance/incidents/${r.id}`);
  return after;
}

// ── Internal audits ─────────────────────────────────────────────────────────

const A = schema.grcAudits;
const F = schema.grcFindings;

export async function audits(s: Scope) {
  requireRegisters(s);
  requirePart(s, "audits");
  const rows = await db.select().from(A).where(eq(A.orgId, s.orgId)).orderBy(desc(A.createdAt));
  const counts = await db.select({ auditId: F.auditId, open: sql<number>`count(*) filter (where ${F.status} = 'open')::int`, total: sql<number>`count(*)::int` }).from(F).where(eq(F.orgId, s.orgId)).groupBy(F.auditId);
  return rows.map((a) => ({ ...a, findings: counts.find((c) => c.auditId === a.id) ?? { open: 0, total: 0 } }));
}

export async function saveAudit(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  requirePart(s, "audits");
  const v = check(auditSchema, raw);
  if (v.periodFrom && v.periodTo && v.periodFrom > v.periodTo) throw new ApiError("validation_failed", "The period ends before it starts", { periodTo: ["Before the start"] });
  await requireMember(s.orgId, v.auditorId, "auditorId");
  if (id) return one(db.update(A).set(v).where(and(eq(A.id, id), eq(A.orgId, s.orgId))).returning(), "Audit");
  const [a] = await db.insert(A).values({ ...v, orgId: s.orgId, number: await nextNumber(s.orgId, "audit") }).returning();
  return a;
}

export async function auditDetail(s: Scope, id: string) {
  requireRegisters(s);
  if (!isId(id)) throw notFound("Audit");
  const a = await one(db.select().from(A).where(and(eq(A.id, id), eq(A.orgId, s.orgId))), "Audit");
  const findings = await db.select().from(F).where(eq(F.auditId, a.id)).orderBy(asc(F.createdAt));
  const today = todayIst();
  return { audit: a, findings: findings.map((f) => ({ ...f, overdue: f.status === "open" && !!f.dueDate && String(f.dueDate) < today })) };
}

export async function saveFinding(s: Scope, auditId: string, id: string | null, raw: unknown) {
  requireWrite(s);
  const a = await one(db.select().from(A).where(and(eq(A.id, auditId), eq(A.orgId, s.orgId))), "Audit");
  const v = check(findingSchema, raw);
  await requireMember(s.orgId, v.ownerId);
  if (v.status === "closed" && !v.response.trim()) throw new ApiError("validation_failed", "Record management's response before closing it", { response: ["Required"] });
  const closedAt = v.status === "closed" ? new Date() : null;
  if (id) {
    const before = await one(db.select().from(F).where(and(eq(F.id, id), eq(F.auditId, a.id))), "Finding");
    const [f] = await db.update(F).set({ ...v, closedAt: v.status === "closed" ? (before.closedAt ?? closedAt) : null }).where(eq(F.id, id)).returning();
    if (v.ownerId && v.ownerId !== before.ownerId) await tell(s, v.ownerId, "Audit finding", f.title, `/compliance/audits/${a.id}`);
    return f;
  }
  const [f] = await db.insert(F).values({ ...v, closedAt, orgId: s.orgId, auditId: a.id }).returning();
  await tell(s, v.ownerId, "Audit finding", f.title, `/compliance/audits/${a.id}`);
  return f;
}

// ── Policies ────────────────────────────────────────────────────────────────

const P = schema.grcPolicies;
const inAudience = (audience: string[], role: string) => !audience.length || audience.includes(role);

/** Policies: the team sees all (with who has acknowledged); everyone sees what's published for them and whether they've acknowledged it. */
export async function policies(s: Scope) {
  const rows = await db.select().from(P).where(and(eq(P.orgId, s.orgId), s.registers ? sql`true` : eq(P.status, "published"))).orderBy(asc(P.title));
  const mine = await db.select().from(schema.grcPolicyAcks).where(eq(schema.grcPolicyAcks.userId, s.userId));
  const team = s.registers ? await members(s.orgId) : [];
  const acks = s.registers && rows.length ? await db.select().from(schema.grcPolicyAcks).where(inArray(schema.grcPolicyAcks.policyId, rows.map((r) => r.id))) : [];
  return rows
    .filter((p) => s.registers || inAudience(p.audience, s.role))
    .map((p) => {
      const audience = team.filter((m) => inAudience(p.audience, m.role));
      const done = new Set(acks.filter((a) => a.policyId === p.id && a.version === p.version).map((a) => a.userId));
      return { ...p, body: undefined, forMe: p.status === "published" && inAudience(p.audience, s.role), acknowledged: mine.some((a) => a.policyId === p.id && a.version === p.version), progress: s.registers && p.status === "published" ? { done: audience.filter((m) => done.has(m.id)).length, of: audience.length } : null };
    });
}

export async function policyDetail(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Policy");
  const p = await one(db.select().from(P).where(and(eq(P.id, id), eq(P.orgId, s.orgId))), "Policy");
  if (!s.registers && (p.status !== "published" || !inAudience(p.audience, s.role))) throw notFound("Policy");
  const [ack] = await db.select().from(schema.grcPolicyAcks).where(and(eq(schema.grcPolicyAcks.policyId, p.id), eq(schema.grcPolicyAcks.version, p.version), eq(schema.grcPolicyAcks.userId, s.userId)));
  let pending: { id: string; name: string }[] | null = null;
  if (s.registers && p.status === "published") {
    const done = new Set((await db.select().from(schema.grcPolicyAcks).where(and(eq(schema.grcPolicyAcks.policyId, p.id), eq(schema.grcPolicyAcks.version, p.version)))).map((a) => a.userId));
    pending = (await members(s.orgId)).filter((m) => inAudience(p.audience, m.role) && !done.has(m.id)).map(({ id, name }) => ({ id, name }));
  }
  return { policy: p, acknowledgedAt: ack?.at ?? null, pending };
}

/** Save a draft — or a change to a published policy, which becomes a new version everyone acknowledges again. */
export async function savePolicy(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(policySchema, raw);
  await requireMember(s.orgId, v.ownerId);
  if (!id) return (await db.insert(P).values({ ...v, orgId: s.orgId }).returning())[0];
  const p = await one(db.select().from(P).where(and(eq(P.id, id), eq(P.orgId, s.orgId))), "Policy");
  if (p.status === "retired") throw new ApiError("conflict", "This policy is retired");
  const changed = p.status === "published" && (p.body !== v.body || p.title !== v.title);
  const [after] = await db.update(P).set({ ...v, version: changed ? p.version + 1 : p.version, publishedAt: changed ? new Date() : p.publishedAt, updatedAt: new Date() }).where(eq(P.id, p.id)).returning();
  if (changed) await askToAcknowledge(s, after);
  return after;
}

async function askToAcknowledge(s: Scope, p: typeof P.$inferSelect) {
  const to = (await members(s.orgId)).filter((m) => inAudience(p.audience, m.role)).map((m) => m.id);
  await notify(s.orgId, to, { kind: "grc.policy", title: `Please read and acknowledge “${p.title}” (version ${p.version})`, link: `/compliance/policies/${p.id}`, values: { title: p.title, version: String(p.version), link: `/compliance/policies/${p.id}` } }).catch(() => {});
}

export async function publishPolicy(s: Scope, id: string) {
  requireWrite(s);
  const p = await one(db.select().from(P).where(and(eq(P.id, id), eq(P.orgId, s.orgId))), "Policy");
  if (p.status !== "draft") throw new ApiError("conflict", "Only a draft can be published");
  const [after] = await db.update(P).set({ status: "published", publishedAt: new Date(), effectiveDate: p.effectiveDate ?? todayIst(), updatedAt: new Date() }).where(eq(P.id, p.id)).returning();
  await askToAcknowledge(s, after);
  return after;
}

export async function retirePolicy(s: Scope, id: string) {
  requireWrite(s);
  const [r] = await db.update(P).set({ status: "retired", updatedAt: new Date() }).where(and(eq(P.id, id), eq(P.orgId, s.orgId))).returning();
  if (!r) throw notFound("Policy");
}

export async function acknowledge(s: Scope, id: string) {
  const { policy } = await policyDetail(s, id);
  if (policy.status !== "published") throw new ApiError("conflict", "Only a published policy can be acknowledged");
  await db.insert(schema.grcPolicyAcks).values({ policyId: policy.id, version: policy.version, userId: s.userId }).onConflictDoNothing();
  return { ok: true };
}

/** Risks whose review date has come, and policies due a review — for the home page. */
export async function due(s: Scope) {
  const today = todayIst();
  const [risk] = await db.select({ n: sql<number>`count(*)::int` }).from(R).where(and(eq(R.orgId, s.orgId), lte(R.reviewDate, today), sql`${R.status} <> 'closed'`));
  const [policy] = await db.select({ n: sql<number>`count(*)::int` }).from(P).where(and(eq(P.orgId, s.orgId), eq(P.status, "published"), lte(P.reviewDate, today)));
  return { risksToReview: risk.n, policiesToReview: policy.n };
}

/** Import a risk register from a spreadsheet; scores out of range are clamped to 1–5. */
export async function importRisks(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "risks");
  const { runImport, str } = await import("../import/run");
  const { target } = await import("@/lib/import/targets");
  const lv = (v: unknown, d: number | null) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Math.min(5, Math.max(1, Math.round(Number(v)))));
  return runImport(target("grc.risks"), raw, async (v) => {
    const title = str(v.title).trim();
    const [dup] = await db.select({ id: R.id }).from(R).where(and(eq(R.orgId, s.orgId), sql`lower(${R.title}) = ${title.toLowerCase()}`));
    if (dup) return "skipped";
    const rl = lv(v.residualLikelihood, null);
    const ri = lv(v.residualImpact, null);
    await saveRisk(s, null, { title, description: str(v.description), category: str(v.category) || "operational", likelihood: lv(v.likelihood, 3), impact: lv(v.impact, 3), residualLikelihood: rl !== null && ri !== null ? rl : null, residualImpact: rl !== null && ri !== null ? ri : null, treatment: str(v.treatment) || "reduce", plan: str(v.plan) });
    return "created";
  });
}
