// The approval engine. A module asks `gate()` before a document takes effect
// (a bill is posted, a purchase order sent, payroll finalised…). If a policy
// matches, a request is opened and the document waits; approvers act from the
// inbox; when the last step is done, the module's handler finishes the job.
//
// Rules that always hold:
// - nobody approves their own request while anyone else could;
// - an approver's limit caps what their approval counts for;
// - a delegate acts on behalf of the person who delegated, and it's recorded;
// - the steps are copied onto the request, so editing a policy never changes
//   requests already in flight (the policy's version is kept on the request).
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { APPROVAL_KINDS, canAct, conditionsSchema, describeApprover, isKind, matches, stepDone, stepsFor, stepSchema, type ApprovalKind, type Step } from "@/lib/approvals/model";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { notify } from "../notify/notify";
import { audit } from "../services/audit";

type Request = typeof schema.approvalRequests.$inferSelect;
export type Doc = { kind: ApprovalKind; refId: string; label: string; amount: number; requesterId: string | null; link: string; payload?: unknown };
export type Gate = { status: "none" | "approved" | "pending"; request?: Request };

const inr = (paise: number) => (paise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function employeeOf(orgId: string, userId: string | null) {
  if (!userId) return null;
  const [e] = await db.select({ id: schema.hrEmployees.id, departmentId: schema.hrEmployees.departmentId, managerId: schema.hrEmployees.managerId }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, orgId), eq(schema.hrEmployees.userId, userId)));
  return e ?? null;
}

async function members(orgId: string) {
  return db.select({ userId: schema.memberships.userId, role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
}

/**
 * The people each approver slot of a step stands for. The requester is taken
 * out; a slot left empty falls back to the workspace's owners, and only if
 * the requester is the only one who could ever approve does it stay theirs.
 */
export async function resolveSlots(orgId: string, step: Step, requesterId: string | null): Promise<string[][]> {
  const team = await members(orgId);
  const owners = team.filter((m) => m.role === "owner").map((m) => m.userId);
  const me = await employeeOf(orgId, requesterId);
  const out: string[][] = [];
  for (const a of step.approvers) {
    let ids: string[] = [];
    if (a.type === "user") ids = team.some((m) => m.userId === a.userId) ? [a.userId] : [];
    else if (a.type === "role") ids = team.filter((m) => m.role === a.role).map((m) => m.userId);
    else if (a.type === "group") {
      const [g] = await db.select({ members: schema.orgGroups.members }).from(schema.orgGroups).where(and(eq(schema.orgGroups.id, a.groupId), eq(schema.orgGroups.orgId, orgId)));
      ids = (g?.members ?? []).filter((u) => team.some((m) => m.userId === u));
    }
    else if (me?.managerId) {
      const [mgr] = await db.select({ userId: schema.hrEmployees.userId }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.id, me.managerId), eq(schema.hrEmployees.orgId, orgId)));
      ids = mgr?.userId ? [mgr.userId] : [];
    }
    let others = ids.filter((u) => u !== requesterId);
    if (!others.length) others = owners.filter((u) => u !== requesterId);
    out.push(others.length ? others : requesterId ? [requesterId] : []);
  }
  return out;
}

/** People a user stands in for today on this kind of request. */
async function standingInFor(orgId: string, userId: string, kind: string) {
  const today = todayIst();
  const rows = await db.select().from(schema.approvalDelegations).where(and(eq(schema.approvalDelegations.orgId, orgId), eq(schema.approvalDelegations.toUserId, userId), lte(schema.approvalDelegations.starts, today), gte(schema.approvalDelegations.ends, today)));
  return rows.filter((d) => !d.kinds.length || d.kinds.includes(kind)).map((d) => d.fromUserId);
}

async function approvedIn(requestId: string, step: number) {
  const rows = await db.select().from(schema.approvalActions).where(and(eq(schema.approvalActions.requestId, requestId), eq(schema.approvalActions.step, step), eq(schema.approvalActions.action, "approved")));
  return new Set(rows.flatMap((r) => [r.onBehalfOf ?? r.userId!, r.userId!]));
}

async function notifyStep(req: Request, requesterName: string) {
  const step = (req.steps as Step[])[req.step];
  const slots = await resolveSlots(req.orgId, step, req.requesterId);
  await notify(req.orgId, slots.flat(), {
    kind: "approval.requested",
    title: `${requesterName || "Someone"} needs your approval: ${req.label}`,
    body: `${APPROVAL_KINDS[req.kind as ApprovalKind]?.label ?? req.kind} · ${inr(req.amount)} · step “${step.name}”`,
    link: "/inbox",
    values: { requester: requesterName, document: req.label, amount: inr(req.amount) },
  });
}

async function nameOf(userId: string | null) {
  if (!userId) return "";
  const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  return u?.name ?? "";
}

/** The latest request for a document. */
export async function latest(orgId: string, kind: string, refId: string) {
  const [r] = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, orgId), eq(schema.approvalRequests.kind, kind), eq(schema.approvalRequests.refId, refId))).orderBy(desc(schema.approvalRequests.createdAt)).limit(1);
  return r ?? null;
}

/**
 * Ask whether a document may take effect. "none": no policy applies.
 * "approved": approved for at least this amount. "pending": waiting (a request
 * is opened, or the open one is kept — and restarted if the amount changed).
 */
export async function gate(orgId: string, doc: Doc): Promise<Gate> {
  const prev = await latest(orgId, doc.kind, doc.refId);
  if (prev?.status === "approved" && doc.amount <= prev.amount) return { status: "approved", request: prev };
  if (prev?.status === "pending") {
    if (prev.amount === doc.amount) {
      if (doc.payload !== undefined || prev.label !== doc.label) await db.update(schema.approvalRequests).set({ label: doc.label, ...(doc.payload !== undefined ? { payload: doc.payload } : {}) }).where(eq(schema.approvalRequests.id, prev.id));
      return { status: "pending", request: { ...prev, label: doc.label } };
    }
    // The amount changed while waiting: start again, so approvals match what's being approved.
    await closeRequest(prev, "cancelled", null, "The amount changed — sent again for approval");
  }
  const me = await employeeOf(orgId, doc.requesterId);
  const policies = await db.select().from(schema.approvalPolicies).where(and(eq(schema.approvalPolicies.orgId, orgId), eq(schema.approvalPolicies.kind, doc.kind), eq(schema.approvalPolicies.active, true))).orderBy(schema.approvalPolicies.priority, schema.approvalPolicies.createdAt);
  const policy = policies.find((p) => matches(conditionsSchema.parse(p.conditions), { amount: doc.amount, departmentId: me?.departmentId ?? null }));
  const steps = policy ? stepsFor(policy.steps.map((s) => stepSchema.parse(s)), doc.amount) : [];
  if (!policy || !steps.length) return { status: "none" };
  const [req] = await db
    .insert(schema.approvalRequests)
    .values({ orgId, kind: doc.kind, refId: doc.refId, label: doc.label, amount: doc.amount, requesterId: doc.requesterId, departmentId: me?.departmentId ?? null, policyId: policy.id, policyName: policy.name, policyVersion: policy.version, steps, link: doc.link, payload: doc.payload ?? null })
    .returning();
  await db.insert(schema.approvalActions).values({ orgId, requestId: req.id, step: 0, userId: doc.requesterId, action: prev ? "resubmitted" : "submitted" });
  await notifyStep(req, await nameOf(doc.requesterId));
  return { status: "pending", request: req };
}

/** Throw unless the document is cleared to take effect. */
export async function requireCleared(orgId: string, doc: Doc, what: string) {
  const g = await gate(orgId, doc);
  if (g.status === "pending") throw new ApiError("conflict", `${what} is waiting for approval (${g.request!.policyName})`);
  return g;
}

async function closeRequest(req: Request, status: "approved" | "rejected" | "cancelled", userId: string | null, note = "") {
  await db.update(schema.approvalRequests).set({ status, decidedAt: new Date() }).where(eq(schema.approvalRequests.id, req.id));
  if (status === "cancelled") await db.insert(schema.approvalActions).values({ orgId: req.orgId, requestId: req.id, step: req.step, userId, action: "cancelled", note });
}

/** The document went away (deleted, voided): close its open request. */
export async function cancelFor(orgId: string, kind: ApprovalKind, refId: string, userId: string | null, note = "Cancelled") {
  const r = await latest(orgId, kind, refId);
  if (r?.status === "pending") await closeRequest(r, "cancelled", userId, note);
}

/** Who may act on a request right now: the slots of its current step, plus delegates standing in for them. */
async function eligibility(req: Request, userId: string) {
  const step = (req.steps as Step[])[req.step];
  const slots = await resolveSlots(req.orgId, step, req.requesterId);
  const approved = await approvedIn(req.id, req.step);
  if (canAct(step, slots, approved, req.amount, userId)) return { step, slots, approved, onBehalfOf: null as string | null };
  // Standing in for someone never lets people approve their own request.
  if (userId === req.requesterId) return null;
  for (const who of await standingInFor(req.orgId, userId, req.kind)) if (canAct(step, slots, approved, req.amount, who)) return { step, slots, approved, onBehalfOf: who };
  return null;
}

export async function decide(orgId: string, userId: string, requestId: string, approve: boolean, note = "") {
  if (!approve && !note.trim()) throw new ApiError("validation_failed", "Say why it's being sent back", { note: ["Add a note"] });
  // One decision at a time per request.
  return db.transaction(async (tx) => {
    const locked = (await tx.execute(sql`select * from approval_requests where id = ${requestId} and org_id = ${orgId} for update`)) as unknown as { rows: Record<string, unknown>[] };
    if (!locked.rows.length) throw notFound("Approval");
    const [req] = await tx.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, requestId));
    if (req.status !== "pending") throw new ApiError("conflict", `This was already ${req.status}`);
    const el = await eligibility(req, userId);
    if (!el) throw new ApiError("forbidden", "It isn't your turn to approve this — or your approval limit is below its amount");
    const by = await nameOf(userId);
    await tx.insert(schema.approvalActions).values({ orgId, requestId, step: req.step, userId, onBehalfOf: el.onBehalfOf, action: approve ? "approved" : "rejected", note: note.trim().slice(0, 1000) });
    if (!approve) {
      await tx.update(schema.approvalRequests).set({ status: "rejected", decidedAt: new Date() }).where(eq(schema.approvalRequests.id, requestId));
      return { req: { ...req, status: "rejected" }, done: true, by };
    }
    const approved = new Set([...el.approved, userId, ...(el.onBehalfOf ? [el.onBehalfOf] : [])]);
    if (!stepDone(el.step, el.slots, approved, req.amount)) return { req, done: false, by };
    const next = req.step + 1;
    if (next < (req.steps as Step[]).length) {
      await tx.update(schema.approvalRequests).set({ step: next, stepStartedAt: new Date() }).where(eq(schema.approvalRequests.id, requestId));
      return { req: { ...req, step: next }, done: false, advanced: true, by };
    }
    await tx.update(schema.approvalRequests).set({ status: "approved", decidedAt: new Date() }).where(eq(schema.approvalRequests.id, requestId));
    return { req: { ...req, status: "approved" }, done: true, by };
  }).then(async (r) => {
    const req = r.req as Request;
    const requesterName = await nameOf(req.requesterId);
    if ("advanced" in r && r.advanced) await notifyStep(req, requesterName);
    if (r.done) {
      const { HANDLERS } = await import("./handlers");
      const h = HANDLERS[req.kind as ApprovalKind];
      try {
        if (req.status === "approved") await h?.onApproved(req, userId);
        else await h?.onRejected?.(req, userId, note);
      } catch (e) {
        // The decision stands; the module's follow-up failed and is reported, not hidden.
        log.warn("approval follow-up failed", { requestId: req.id, kind: req.kind, error: String(e) });
        await db.insert(schema.approvalActions).values({ orgId, requestId: req.id, step: req.step, userId: null, action: "comment", note: `Couldn't finish automatically: ${e instanceof Error ? e.message : String(e)}` });
      }
      await notify(orgId, [req.requesterId], {
        kind: req.status === "approved" ? "approval.approved" : "approval.rejected",
        title: req.status === "approved" ? `Approved: ${req.label}` : `Sent back: ${req.label}`,
        body: req.status === "approved" ? `${r.by} gave the final approval.` : `${r.by}: ${note}`,
        link: req.link,
        values: { document: req.label, approver: r.by, note },
      });
      await audit({ orgId, actorId: userId, action: `approvals.${req.status}`, targetType: "approval_request", targetId: req.id, metadata: { kind: req.kind, refId: req.refId, amount: req.amount } });
    }
    return { status: req.status, step: req.step };
  });
}

/** Overdue steps: tell the people named (or the owners) once per step. */
export async function escalate(now = new Date()) {
  const open = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.status, "pending")).limit(2000);
  let n = 0;
  for (const req of open) {
    const step = (req.steps as Step[])[req.step];
    if (!step?.slaHours || req.escalatedStep >= req.step) continue;
    const hours = (now.getTime() - req.stepStartedAt.getTime()) / 3600_000;
    if (hours < step.slaHours) continue;
    const claimed = await db.update(schema.approvalRequests).set({ escalatedStep: req.step }).where(and(eq(schema.approvalRequests.id, req.id), sql`${schema.approvalRequests.escalatedStep} < ${req.step}`)).returning({ id: schema.approvalRequests.id });
    if (!claimed.length) continue;
    const to = step.escalateTo.length ? step.escalateTo : (await members(req.orgId)).filter((m) => m.role === "owner").map((m) => m.userId);
    await db.insert(schema.approvalActions).values({ orgId: req.orgId, requestId: req.id, step: req.step, userId: null, action: "escalated", note: `Waiting ${Math.floor(hours)} hours at “${step.name}”` });
    await notify(req.orgId, [...to, ...(await resolveSlots(req.orgId, step, req.requesterId)).flat()], { kind: "approval.escalated", title: `Overdue approval: ${req.label}`, body: `Waiting ${Math.floor(hours)} hours at “${step.name}” (allowed ${step.slaHours}).`, link: "/inbox", values: { document: req.label, step: step.name, hours: String(Math.floor(hours)) } });
    n++;
  }
  return n;
}

// ── Reading ─────────────────────────────────────────────────────────────────

async function names(ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const rows = uniq.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, uniq)) : [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** A request with its history and, for the current step, who it's waiting on. */
export async function describe(req: Request, viewerId?: string) {
  const actions = await db.select().from(schema.approvalActions).where(eq(schema.approvalActions.requestId, req.id)).orderBy(schema.approvalActions.createdAt);
  const steps = req.steps as Step[];
  const current = req.status === "pending" ? steps[req.step] : null;
  const slots = current ? await resolveSlots(req.orgId, current, req.requesterId) : [];
  const nm = await names([req.requesterId ?? "", ...actions.flatMap((a) => [a.userId ?? "", a.onBehalfOf ?? ""]), ...slots.flat(), ...steps.flatMap((s) => s.approvers.flatMap((a) => (a.type === "user" ? [a.userId] : [])))]);
  const approved = current ? await approvedIn(req.id, req.step) : new Set<string>();
  const gs = await db.select({ id: schema.orgGroups.id, name: schema.orgGroups.name }).from(schema.orgGroups).where(eq(schema.orgGroups.orgId, req.orgId));
  const group = (id: string) => gs.find((g) => g.id === id)?.name ?? "a group";
  return {
    id: req.id,
    kind: req.kind,
    kindLabel: APPROVAL_KINDS[req.kind as ApprovalKind]?.label ?? req.kind,
    refId: req.refId,
    label: req.label,
    amount: req.amount,
    link: req.link,
    status: req.status,
    policy: { name: req.policyName, version: req.policyVersion },
    requester: { id: req.requesterId, name: nm.get(req.requesterId ?? "") ?? "Someone" },
    createdAt: req.createdAt,
    decidedAt: req.decidedAt,
    step: req.step,
    steps: steps.map((s, i) => ({ name: s.name, mode: s.mode, slaHours: s.slaHours, who: s.approvers.map((a) => describeApprover(a, (id) => nm.get(id) ?? "someone", group)).join(s.mode === "all" ? " and " : " or "), state: req.status === "approved" || i < req.step ? "done" : i === req.step && req.status === "pending" ? "current" : i === req.step && req.status === "rejected" ? "rejected" : "later" })),
    waitingOn: current ? current.approvers.map((a, i) => ({ who: describeApprover(a, (id) => nm.get(id) ?? "someone", group), people: slots[i].map((u) => nm.get(u) ?? "someone"), done: slots[i].some((u) => approved.has(u)) })) : [],
    overdue: !!current?.slaHours && Date.now() - req.stepStartedAt.getTime() > current.slaHours * 3600_000,
    canAct: viewerId && req.status === "pending" ? !!(await eligibility(req, viewerId)) : false,
    history: actions.map((a) => ({ action: a.action, step: a.step, stepName: steps[a.step]?.name ?? "", by: a.userId ? (nm.get(a.userId) ?? "Someone") : "Cloudesk", onBehalfOf: a.onBehalfOf ? (nm.get(a.onBehalfOf) ?? null) : null, note: a.note, at: a.createdAt })),
  };
}

/** Requests waiting for this person (directly or as a delegate). */
export async function queue(orgId: string, userId: string) {
  const open = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, orgId), eq(schema.approvalRequests.status, "pending"))).orderBy(schema.approvalRequests.createdAt).limit(500);
  const mine: Request[] = [];
  for (const r of open) if (await eligibility(r, userId)) mine.push(r);
  return Promise.all(mine.map((r) => describe(r, userId)));
}

export async function mine(orgId: string, userId: string) {
  const rows = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, orgId), eq(schema.approvalRequests.requesterId, userId))).orderBy(desc(schema.approvalRequests.createdAt)).limit(100);
  return Promise.all(rows.map((r) => describe(r, userId)));
}

export async function forDoc(orgId: string, kind: string, refId: string, viewerId: string) {
  if (!isKind(kind)) throw notFound("Approval");
  const rows = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, orgId), eq(schema.approvalRequests.kind, kind), eq(schema.approvalRequests.refId, refId))).orderBy(desc(schema.approvalRequests.createdAt)).limit(10);
  return Promise.all(rows.map((r) => describe(r, viewerId)));
}

export async function getRequest(orgId: string, id: string) {
  const [r] = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, orgId), eq(schema.approvalRequests.id, id)));
  if (!r) throw notFound("Approval");
  return r;
}

/** How approvals are going, by kind: waiting, overdue, decided in 90 days, and how long decisions take. */
export async function analytics(orgId: string) {
  const rows = (await db.execute(sql`
    select kind,
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'approved' and created_at > now() - interval '90 days')::int as approved,
      count(*) filter (where status = 'rejected' and created_at > now() - interval '90 days')::int as rejected,
      coalesce(avg(extract(epoch from decided_at - created_at) / 3600) filter (where status in ('approved','rejected') and created_at > now() - interval '90 days'), 0)::float as hours
    from approval_requests where org_id = ${orgId} group by kind`)) as unknown as { rows: { kind: string; pending: number; approved: number; rejected: number; hours: number }[] };
  const open = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.orgId, orgId), eq(schema.approvalRequests.status, "pending")));
  const overdue = open.filter((r) => {
    const s = (r.steps as Step[])[r.step];
    return !!s?.slaHours && Date.now() - r.stepStartedAt.getTime() > s.slaHours * 3600_000;
  });
  // Where requests sit longest: the step they're waiting at.
  const stuck = new Map<string, { kind: string; step: string; waiting: number; hours: number }>();
  for (const r of open) {
    const s = (r.steps as Step[])[r.step];
    const k = `${r.kind}|${s?.name}`;
    const x = stuck.get(k) ?? { kind: r.kind, step: s?.name ?? "", waiting: 0, hours: 0 };
    x.waiting++;
    x.hours = Math.max(x.hours, (Date.now() - r.stepStartedAt.getTime()) / 3600_000);
    stuck.set(k, x);
  }
  return {
    byKind: rows.rows.map((r) => ({ ...r, label: APPROVAL_KINDS[r.kind as ApprovalKind]?.label ?? r.kind, overdue: overdue.filter((o) => o.kind === r.kind).length })),
    bottlenecks: [...stuck.values()].sort((a, b) => b.hours - a.hours).slice(0, 10),
  };
}
