// Approval policies (owners and admins) and delegations (anyone, for
// themselves; owners and admins for anyone). Editing a policy bumps its
// version; requests already in flight keep the steps they started with.
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { delegationSchema, policySchema } from "@/lib/approvals/model";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";

type Who = { orgId: string; userId: string; admin: boolean };

function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}
const requireAdmin = (w: Who) => {
  if (!w.admin) throw new ApiError("forbidden", "Only workspace owners and admins can change approval rules");
};

export async function policies(orgId: string) {
  return db.select().from(schema.approvalPolicies).where(eq(schema.approvalPolicies.orgId, orgId)).orderBy(asc(schema.approvalPolicies.kind), asc(schema.approvalPolicies.priority), asc(schema.approvalPolicies.createdAt));
}

async function checkPeople(orgId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const rows = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
  const have = new Set(rows.map((r) => r.userId));
  if (uniq.some((u) => !have.has(u))) throw new ApiError("validation_failed", "Approvers must be in this workspace");
}

export async function savePolicy(w: Who, id: string | null, raw: unknown) {
  requireAdmin(w);
  const v = check(policySchema, raw);
  await checkPeople(w.orgId, v.steps.flatMap((s) => [...s.approvers.flatMap((a) => (a.type === "user" ? [a.userId] : [])), ...s.escalateTo]));
  const groupIds = [...new Set(v.steps.flatMap((s) => s.approvers.flatMap((a) => (a.type === "group" ? [a.groupId] : []))))];
  if (groupIds.length) {
    const found = await db.select({ id: schema.orgGroups.id }).from(schema.orgGroups).where(and(eq(schema.orgGroups.orgId, w.orgId), inArray(schema.orgGroups.id, groupIds)));
    if (found.length !== groupIds.length) throw new ApiError("validation_failed", "Use groups from this workspace");
  }
  if (v.conditions.minAmount !== null && v.conditions.maxAmount !== null && v.conditions.maxAmount < v.conditions.minAmount) throw new ApiError("validation_failed", "The upper amount is below the lower one", { "conditions.maxAmount": ["Below the lower amount"] });
  if (id) {
    const [cur] = await db.select().from(schema.approvalPolicies).where(and(eq(schema.approvalPolicies.id, id), eq(schema.approvalPolicies.orgId, w.orgId)));
    if (!cur) throw notFound("Policy");
    const [row] = await db.update(schema.approvalPolicies).set({ ...v, version: cur.version + 1, updatedAt: new Date() }).where(eq(schema.approvalPolicies.id, id)).returning();
    await audit({ orgId: w.orgId, actorId: w.userId, action: "approvals.policy_updated", targetType: "approval_policy", targetId: id, metadata: { name: v.name, version: row.version } });
    return row;
  }
  const [row] = await db.insert(schema.approvalPolicies).values({ ...v, orgId: w.orgId, createdBy: w.userId }).returning();
  await audit({ orgId: w.orgId, actorId: w.userId, action: "approvals.policy_created", targetType: "approval_policy", targetId: row.id, metadata: { name: v.name, kind: v.kind } });
  return row;
}

export async function deletePolicy(w: Who, id: string) {
  requireAdmin(w);
  const [cur] = await db.select().from(schema.approvalPolicies).where(and(eq(schema.approvalPolicies.id, id), eq(schema.approvalPolicies.orgId, w.orgId)));
  if (!cur) throw notFound("Policy");
  // Requests already in flight carry their own steps, so they finish as they started.
  await db.delete(schema.approvalPolicies).where(eq(schema.approvalPolicies.id, id));
  await audit({ orgId: w.orgId, actorId: w.userId, action: "approvals.policy_deleted", targetType: "approval_policy", targetId: id, metadata: { name: cur.name } });
}

export async function delegations(w: Who) {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ d: schema.approvalDelegations, from: schema.users.name })
    .from(schema.approvalDelegations)
    .innerJoin(schema.users, eq(schema.users.id, schema.approvalDelegations.fromUserId))
    .where(and(eq(schema.approvalDelegations.orgId, w.orgId), gte(schema.approvalDelegations.ends, today)))
    .orderBy(desc(schema.approvalDelegations.starts));
  const to = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
  const name = new Map(to.map((u) => [u.id, u.name]));
  return rows.filter((r) => w.admin || r.d.fromUserId === w.userId || r.d.toUserId === w.userId).map((r) => ({ ...r.d, fromName: r.from, toName: name.get(r.d.toUserId) ?? "" }));
}

export async function addDelegation(w: Who, raw: unknown) {
  const body = raw as { fromUserId?: string };
  const fromUserId = body.fromUserId && body.fromUserId !== w.userId ? (requireAdmin(w), body.fromUserId) : w.userId;
  const v = check(delegationSchema, raw);
  if (v.ends < v.starts) throw new ApiError("validation_failed", "The end is before the start", { ends: ["Before the start"] });
  if (v.toUserId === fromUserId) throw new ApiError("validation_failed", "Pick someone else to stand in");
  await checkPeople(w.orgId, [v.toUserId, fromUserId]);
  const [row] = await db.insert(schema.approvalDelegations).values({ ...v, orgId: w.orgId, fromUserId }).returning();
  await audit({ orgId: w.orgId, actorId: w.userId, action: "approvals.delegated", targetType: "approval_delegation", targetId: row.id, metadata: { from: fromUserId, to: v.toUserId, starts: v.starts, ends: v.ends } });
  return row;
}

export async function deleteDelegation(w: Who, id: string) {
  const [d] = await db.select().from(schema.approvalDelegations).where(and(eq(schema.approvalDelegations.id, id), eq(schema.approvalDelegations.orgId, w.orgId)));
  if (!d) throw notFound("Delegation");
  if (d.fromUserId !== w.userId) requireAdmin(w);
  await db.delete(schema.approvalDelegations).where(eq(schema.approvalDelegations.id, id));
}
