// Expense & travel: claims checked against the expense policy (limits per
// claim and per day, receipts), mileage and per-diem claims, business trips
// (approved, an advance paid, settled against what's claimed), company cards
// (statements imported, each spend explained as a claim or marked personal and
// repaid), and the journals all of it posts. Claims on a project go on its
// expenses; billable ones on its next invoice.
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { PostLine } from "@/lib/accounting/model";
import { target } from "@/lib/import/targets";
import { CLAIM_CATEGORIES, VEHICLES, cardFingerprint, mileageAmount, perDiemFor, policyCheck, tripBalance, tripSchema, type HrSettings } from "@/lib/hr/model";
import { cancelFor, gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { runImport, str } from "../import/run";
import { audit } from "../services/audit";
import { addEvent, check, isSelf, oversees, requireEmployee, requireMe, requirePayroll, todayIst, within, type Employee, type Scope } from "./access";

type Trip = typeof schema.hrTrips.$inferSelect;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── Claims ──────────────────────────────────────────────────────────────────

export const claimInput = z.object({
  kind: z.enum(["expense", "mileage", "per_diem"]).default("expense"),
  category: z.enum(CLAIM_CATEGORIES as [string, ...string[]]).default("Other"),
  amount: z.number().int().min(0).max(1e10).default(0),
  date: day,
  description: z.string().trim().max(500).default(""),
  receiptUrl: z.string().trim().max(500).default("").refine((v) => !v || /^https?:\/\//.test(v), "Use an https:// link"),
  km: z.number().min(0).max(100_000).nullable().default(null),
  vehicle: z.enum(VEHICLES).nullable().default(null),
  tripId: z.uuid().nullable().default(null),
  projectId: z.uuid().nullable().default(null),
  billable: z.boolean().default(false),
  justification: z.string().trim().max(1000).default(""),
});
type ClaimInput = z.infer<typeof claimInput>;

/**
 * Check a claim and work out what it comes to: mileage at the policy's rate,
 * per diem for the trip's days, the trip and project it belongs to, and what it
 * breaks in the policy (which needs a reason, or is refused if the policy says so).
 */
export async function prepareClaim(orgId: string, settings: HrSettings, employeeId: string, v: ClaimInput, opts: { amount?: number } = {}) {
  const p = settings.expenses;
  let { amount, category } = v;
  let trip: Trip | null = null;
  if (v.tripId) {
    trip = await getTrip(orgId, v.tripId);
    if (trip.employeeId !== employeeId) throw new ApiError("validation_failed", "That trip is someone else's", { tripId: ["Not your trip"] });
    if (trip.status !== "approved") throw new ApiError("conflict", trip.status === "settled" ? "That trip is settled; claim it on its own" : "Claims go on a trip once it's approved");
  }
  if (v.kind === "mileage") {
    if (!v.km || !v.vehicle) throw new ApiError("validation_failed", "Enter the kilometres and the vehicle", { km: ["Enter the distance"] });
    if (!p.mileage[v.vehicle]) throw new ApiError("validation_failed", `There's no mileage rate for a ${v.vehicle} yet. HR sets it in Settings → Expenses.`);
    amount = mileageAmount(v.km, v.vehicle, p);
    category = "Mileage";
  } else if (v.kind === "per_diem") {
    if (!trip) throw new ApiError("validation_failed", "A per diem is claimed on a trip", { tripId: ["Pick the trip"] });
    amount = perDiemFor({ departOn: String(trip.departOn), returnOn: String(trip.returnOn), international: trip.international }, p);
    if (!amount) throw new ApiError("validation_failed", "There's no per-diem rate yet. HR sets it in Settings → Expenses.");
    const [dup] = await db.select({ id: schema.hrClaims.id }).from(schema.hrClaims).where(and(eq(schema.hrClaims.tripId, trip.id), eq(schema.hrClaims.kind, "per_diem"), ne(schema.hrClaims.status, "rejected")));
    if (dup) throw new ApiError("conflict", "This trip already has a per diem");
    category = "Per diem";
  }
  if (opts.amount !== undefined) amount = opts.amount;
  if (amount < 100) throw new ApiError("validation_failed", "Enter the amount", { amount: ["Enter the amount"] });
  if (v.date > todayIst()) throw new ApiError("validation_failed", "The expense date is in the future");
  const projectId = v.projectId ?? trip?.projectId ?? null;
  if (projectId) {
    const [pr] = await db.select({ id: schema.workProjects.id }).from(schema.workProjects).where(and(eq(schema.workProjects.id, projectId), eq(schema.workProjects.orgId, orgId)));
    if (!pr) throw new ApiError("validation_failed", "That project isn't in this workspace", { projectId: ["Unknown project"] });
  }
  const [{ n }] = await db.select({ n: sql<number>`coalesce(sum(${schema.hrClaims.amount}), 0)::bigint` }).from(schema.hrClaims).where(and(eq(schema.hrClaims.employeeId, employeeId), eq(schema.hrClaims.category, category), eq(schema.hrClaims.date, v.date), ne(schema.hrClaims.status, "rejected")));
  const flags = v.kind === "expense" ? policyCheck({ category, amount, receiptUrl: v.receiptUrl }, p, Number(n)) : [];
  const over = flags.filter((f) => f.code !== "no_receipt");
  if (over.length && p.blockOverLimit) throw new ApiError("validation_failed", `Over the expense policy: ${over[0].message}`);
  if (flags.length && !v.justification) throw new ApiError("validation_failed", `${flags[0].message}. Say why, and the approver will see it.`, { justification: ["Say why"] });
  return { orgId, employeeId, kind: v.kind, category, amount, date: v.date, description: v.description, receiptUrl: v.receiptUrl, km: v.kind === "mileage" ? v.km : null, vehicle: v.kind === "mileage" ? v.vehicle : null, tripId: trip?.id ?? null, projectId, billable: !!projectId && v.billable, flags, justification: v.justification };
}

export async function submitClaim(s: Scope, raw: unknown) {
  const me = requireMe(s);
  const v = check(claimInput, raw);
  const [c] = await db.insert(schema.hrClaims).values(await prepareClaim(s.orgId, s.settings, me.id, v)).returning();
  return c;
}

/**
 * A claim is finally approved: put it on its project's expenses, and close a
 * company-card spend (nothing to pay back).
 */
export async function claimApproved(orgId: string, id: string) {
  const [c] = await db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.id, id), eq(schema.hrClaims.orgId, orgId)));
  if (!c || c.status !== "approved") return;
  if (c.paidBy === "company") await db.update(schema.hrClaims).set({ status: "paid" }).where(eq(schema.hrClaims.id, c.id));
  if (c.projectId) {
    const [have] = await db.select({ id: schema.workExpenses.id }).from(schema.workExpenses).where(eq(schema.workExpenses.claimId, c.id));
    if (!have) {
      const [e] = await db.select({ name: schema.hrEmployees.name }).from(schema.hrEmployees).where(eq(schema.hrEmployees.id, c.employeeId));
      await db.insert(schema.workExpenses).values({ orgId, projectId: c.projectId, date: String(c.date), category: c.category, description: c.description, vendor: `Claimed by ${e?.name ?? "staff"}`, amount: c.amount, billable: c.billable, receiptLink: c.receiptUrl, claimId: c.id });
    }
  }
}

/** A claim was turned down: a company-card spend goes back to be explained again. */
export async function claimRejected(orgId: string, id: string) {
  await db.update(schema.hrCardTxns).set({ status: "open", claimId: null }).where(and(eq(schema.hrCardTxns.orgId, orgId), eq(schema.hrCardTxns.claimId, id), eq(schema.hrCardTxns.status, "explained")));
}

// ── Trips ───────────────────────────────────────────────────────────────────

async function getTrip(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Trip");
  const [t] = await db.select().from(schema.hrTrips).where(and(eq(schema.hrTrips.id, id), eq(schema.hrTrips.orgId, orgId)));
  if (!t) throw notFound("Trip");
  return t;
}

const canSee = (s: Scope, employeeId: string) => isSelf(s, employeeId) || oversees(s, employeeId) || (s.payroll && within(s, employeeId));

export async function trips(s: Scope, q: { status?: string; mine?: string } = {}) {
  const rows = await db.select({ t: schema.hrTrips, name: schema.hrEmployees.name }).from(schema.hrTrips).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrTrips.employeeId)).where(and(eq(schema.hrTrips.orgId, s.orgId), q.status ? eq(schema.hrTrips.status, q.status) : undefined)).orderBy(desc(schema.hrTrips.departOn)).limit(500);
  return rows.filter(({ t }) => (q.mine === "1" ? isSelf(s, t.employeeId) : canSee(s, t.employeeId))).map(({ t, name }) => ({ ...t, name, canDecide: t.status === "pending" && oversees(s, t.employeeId) && (!isSelf(s, t.employeeId) || s.manage) }));
}

export async function tripDetail(s: Scope, id: string) {
  const t = await getTrip(s.orgId, id);
  if (!canSee(s, t.employeeId)) throw notFound("Trip");
  const [e] = await db.select({ name: schema.hrEmployees.name }).from(schema.hrEmployees).where(eq(schema.hrEmployees.id, t.employeeId));
  const claims = await db.select().from(schema.hrClaims).where(eq(schema.hrClaims.tripId, t.id)).orderBy(asc(schema.hrClaims.date));
  const approved = claims.filter((c) => c.status === "approved" || c.status === "paid").reduce((n, c) => n + Number(c.amount), 0);
  const waiting = claims.filter((c) => c.status === "pending" || c.status === "approving").length;
  return {
    trip: { ...t, name: e?.name ?? "" },
    claims,
    balance: { ...tripBalance(t.advancePaidOn ? Number(t.advance) : 0, approved), waiting },
    perDiem: perDiemFor({ departOn: String(t.departOn), returnOn: String(t.returnOn), international: t.international }, s.settings.expenses),
    can: { edit: isSelf(s, t.employeeId) && ["draft", "rejected"].includes(t.status), decide: t.status === "pending" && oversees(s, t.employeeId) && (!isSelf(s, t.employeeId) || s.manage), pay: s.payroll, claim: isSelf(s, t.employeeId) && t.status === "approved" },
  };
}

const tripInput = tripSchema.extend({ employeeId: z.uuid().optional() });

export async function saveTrip(s: Scope, id: string | null, raw: unknown) {
  const v = check(tripInput, raw);
  if (v.returnOn < v.departOn) throw new ApiError("validation_failed", "The return is before the departure", { returnOn: ["Before departure"] });
  if (v.projectId) {
    const [pr] = await db.select({ id: schema.workProjects.id }).from(schema.workProjects).where(and(eq(schema.workProjects.id, v.projectId), eq(schema.workProjects.orgId, s.orgId)));
    if (!pr) throw new ApiError("validation_failed", "That project isn't in this workspace", { projectId: ["Unknown project"] });
  }
  const { employeeId: forWhom, ...fields } = v;
  if (id) {
    const t = await getTrip(s.orgId, id);
    if (!isSelf(s, t.employeeId) && !s.payroll) throw new ApiError("forbidden", "Only the traveller or HR can change a trip");
    if (!["draft", "rejected"].includes(t.status)) throw new ApiError("conflict", "Only a draft or a trip sent back can be changed");
    const [row] = await db.update(schema.hrTrips).set({ ...fields, status: "draft" }).where(eq(schema.hrTrips.id, t.id)).returning();
    return row;
  }
  let emp: Employee;
  if (forWhom && !isSelf(s, forWhom)) {
    requirePayroll(s);
    emp = await requireEmployee(s.orgId, forWhom);
    if (!within(s, emp.id)) throw new ApiError("forbidden", "That person is outside the companies or branches you work with");
  } else emp = requireMe(s);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trips:${s.orgId}`}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.hrTrips).where(eq(schema.hrTrips.orgId, s.orgId));
    const [row] = await tx.insert(schema.hrTrips).values({ ...fields, orgId: s.orgId, employeeId: emp.id, number: `${s.settings.expenses.tripPrefix}${String(n + 1).padStart(4, "0")}` }).returning();
    return row;
  });
}

export async function submitTrip(s: Scope, id: string) {
  const t = await getTrip(s.orgId, id);
  if (!isSelf(s, t.employeeId) && !s.payroll) throw new ApiError("forbidden", "Only the traveller or HR can send a trip for approval");
  if (!["draft", "rejected"].includes(t.status)) throw new ApiError("conflict", "Already sent");
  await db.update(schema.hrTrips).set({ status: "pending", decisionNote: "" }).where(eq(schema.hrTrips.id, t.id));
  return { status: "pending" as const };
}

/** The manager's (or HR's) decision; approval rules for trips can add further steps. */
export async function decideTrip(s: Scope, id: string, raw: unknown) {
  const t = await getTrip(s.orgId, id);
  if (!oversees(s, t.employeeId) || (isSelf(s, t.employeeId) && !s.manage)) throw new ApiError("forbidden", "Only their manager or HR can decide this");
  if (t.status !== "pending") throw new ApiError("conflict", "This trip isn't waiting for a decision");
  const { approve, note } = check(z.object({ approve: z.boolean(), note: z.string().trim().max(300).default("") }), raw);
  if (!approve) {
    await db.update(schema.hrTrips).set({ status: "rejected", decidedBy: s.userId, decisionNote: note }).where(eq(schema.hrTrips.id, t.id));
    return { status: "rejected" as const };
  }
  const [emp] = await db.select({ userId: schema.hrEmployees.userId, name: schema.hrEmployees.name }).from(schema.hrEmployees).where(eq(schema.hrEmployees.id, t.employeeId));
  const g = await gate(s.orgId, { kind: "hr.trip", refId: t.id, label: `Trip ${t.number} · ${t.destination} · ${emp?.name ?? ""}`, amount: Number(t.estimate) + Number(t.advance), requesterId: emp?.userId ?? null, link: `/hr/trips/${t.id}` });
  const status = g.status === "pending" ? "approving" : "approved";
  await db.update(schema.hrTrips).set({ status, decidedBy: s.userId, decisionNote: note }).where(eq(schema.hrTrips.id, t.id));
  if (status === "approved") await addEvent(s.orgId, t.employeeId, "trip", `Trip approved: ${t.destination}`, s.userId, { number: t.number });
  return { status };
}

export async function tripDecided(orgId: string, id: string, approved: boolean) {
  await db.update(schema.hrTrips).set({ status: approved ? "approved" : "rejected" }).where(and(eq(schema.hrTrips.id, id), eq(schema.hrTrips.orgId, orgId), eq(schema.hrTrips.status, "approving")));
}

export async function cancelTrip(s: Scope, id: string) {
  const t = await getTrip(s.orgId, id);
  if (!isSelf(s, t.employeeId) && !s.payroll) throw new ApiError("forbidden", "Only the traveller or HR can cancel a trip");
  if (t.status === "settled" || t.status === "cancelled") throw new ApiError("conflict", "This trip is already closed");
  if (t.advancePaidOn) throw new ApiError("conflict", "The advance has been paid. Settle the trip instead, so the advance is accounted for.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.hrClaims).where(and(eq(schema.hrClaims.tripId, t.id), ne(schema.hrClaims.status, "rejected")));
  if (n) throw new ApiError("conflict", "There are claims on this trip. Settle it instead.");
  if (t.status === "approving") await cancelFor(s.orgId, "hr.trip", t.id, s.userId, "The trip was cancelled");
  await db.update(schema.hrTrips).set({ status: "cancelled" }).where(eq(schema.hrTrips.id, t.id));
}

const payInput = z.object({ accountId: z.uuid(), date: day });
async function cashAccount(orgId: string, accountId: string) {
  const [acc] = await db.select().from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), eq(schema.accAccounts.id, accountId)));
  if (!acc || !["bank", "cash"].includes(acc.subtype)) throw new ApiError("validation_failed", "Pick a bank or cash account", { accountId: ["Bank or cash"] });
  return acc;
}

export async function payAdvance(s: Scope, id: string, raw: unknown) {
  requirePayroll(s);
  const t = await getTrip(s.orgId, id);
  if (t.status !== "approved") throw new ApiError("conflict", "Approve the trip first");
  if (!Number(t.advance)) throw new ApiError("conflict", "No advance was asked for");
  if (t.advancePaidOn) throw new ApiError("conflict", "The advance is already paid");
  const v = check(payInput, raw);
  await cashAccount(s.orgId, v.accountId);
  const [row] = await db.update(schema.hrTrips).set({ advancePaidOn: v.date, advanceAccountId: v.accountId }).where(and(eq(schema.hrTrips.id, t.id), sql`${schema.hrTrips.advancePaidOn} is null`)).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.trip_advance_paid", targetType: "hr_trip", targetId: t.id, metadata: { amount: t.advance } });
  return row;
}

/** Per diem for the trip's days at the policy's rate, as a claim. */
export async function addPerDiem(s: Scope, id: string) {
  const t = await getTrip(s.orgId, id);
  if (!isSelf(s, t.employeeId) && !s.payroll) throw new ApiError("forbidden", "Only the traveller or HR can claim this");
  const v = check(claimInput, { kind: "per_diem", date: String(t.returnOn) > todayIst() ? todayIst() : String(t.returnOn), tripId: t.id, description: `${t.destination} · ${t.number}` });
  const [c] = await db.insert(schema.hrClaims).values(await prepareClaim(s.orgId, s.settings, t.employeeId, v)).returning();
  return c;
}

/** Close a trip: approved claims against the advance, the balance paid to them or returned. */
export async function settleTrip(s: Scope, id: string, raw: unknown) {
  requirePayroll(s);
  const t = await getTrip(s.orgId, id);
  if (t.status !== "approved") throw new ApiError("conflict", t.status === "settled" ? "Already settled" : "Only an approved trip can be settled");
  const claims = await db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.tripId, t.id), ne(schema.hrClaims.status, "rejected")));
  if (claims.some((c) => c.status === "pending" || c.status === "approving")) throw new ApiError("conflict", "Some claims on this trip are still waiting for approval");
  const b = tripBalance(t.advancePaidOn ? Number(t.advance) : 0, claims.reduce((n, c) => n + Number(c.amount), 0));
  const v = check(z.object({ accountId: z.uuid().nullable().default(null), date: day }), raw);
  if (b.net !== 0) {
    if (!v.accountId) throw new ApiError("validation_failed", b.net > 0 ? "Pick the account the balance is paid from" : "Pick the account the unused advance comes back into", { accountId: ["Pick an account"] });
    await cashAccount(s.orgId, v.accountId);
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.update(schema.hrTrips).set({ status: "settled", settledOn: v.date, settleAccountId: b.net ? v.accountId : null, claimed: b.claimed, balance: b.net }).where(and(eq(schema.hrTrips.id, t.id), eq(schema.hrTrips.status, "approved"))).returning();
    if (!row) throw new ApiError("conflict", "Already settled");
    if (claims.length) await tx.update(schema.hrClaims).set({ status: "paid" }).where(inArray(schema.hrClaims.id, claims.map((c) => c.id)));
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.trip_settled", targetType: "hr_trip", targetId: t.id, metadata: b });
  return b;
}

// ── Company cards ───────────────────────────────────────────────────────────

const cardInput = z.object({ employeeId: z.uuid(), name: z.string().trim().min(1, "Name the card").max(80), last4: z.string().regex(/^\d{4}$/, "The last four digits"), active: z.boolean().default(true) });

export async function cards(s: Scope) {
  const rows = await db.select({ c: schema.hrCards, name: schema.hrEmployees.name }).from(schema.hrCards).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrCards.employeeId)).where(eq(schema.hrCards.orgId, s.orgId)).orderBy(asc(schema.hrEmployees.name));
  return rows.filter(({ c }) => isSelf(s, c.employeeId) || (s.payroll && within(s, c.employeeId))).map(({ c, name }) => ({ ...c, holder: name }));
}

export async function saveCard(s: Scope, id: string | null, raw: unknown) {
  requirePayroll(s);
  const v = check(cardInput, raw);
  const e = await requireEmployee(s.orgId, v.employeeId);
  if (!within(s, e.id)) throw new ApiError("forbidden", "That person is outside the companies or branches you work with");
  const [clash] = await db.select({ id: schema.hrCards.id }).from(schema.hrCards).where(and(eq(schema.hrCards.orgId, s.orgId), eq(schema.hrCards.last4, v.last4)));
  if (clash && clash.id !== id) throw new ApiError("conflict", `A card ending ${v.last4} is already set up`);
  if (id) {
    const [row] = await db.update(schema.hrCards).set(v).where(and(eq(schema.hrCards.id, id), eq(schema.hrCards.orgId, s.orgId))).returning();
    if (!row) throw notFound("Card");
    return row;
  }
  const [row] = await db.insert(schema.hrCards).values({ ...v, orgId: s.orgId }).returning();
  return row;
}

export async function cardTxns(s: Scope, q: { status?: string; mine?: string } = {}) {
  const rows = await db.select({ t: schema.hrCardTxns, holder: schema.hrEmployees.name, card: schema.hrCards.name, last4: schema.hrCards.last4 }).from(schema.hrCardTxns).innerJoin(schema.hrCards, eq(schema.hrCards.id, schema.hrCardTxns.cardId)).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrCardTxns.employeeId)).where(and(eq(schema.hrCardTxns.orgId, s.orgId), q.status ? eq(schema.hrCardTxns.status, q.status) : undefined)).orderBy(desc(schema.hrCardTxns.date)).limit(1000);
  return rows.filter(({ t }) => (q.mine === "1" ? isSelf(s, t.employeeId) : isSelf(s, t.employeeId) || (s.payroll && within(s, t.employeeId)))).map(({ t, holder, card, last4 }) => ({ ...t, holder, card: `${card} ··${last4}` }));
}

/** Statement lines from a CSV or Excel file; matched to cards by their last four digits, the same line never twice. */
export async function importCardTxns(s: Scope, raw: unknown) {
  requirePayroll(s);
  const all = await db.select().from(schema.hrCards).where(eq(schema.hrCards.orgId, s.orgId));
  const extra = z.object({ cardId: z.uuid().optional() }).parse(raw);
  return runImport(target("hr.card_txns"), raw, async (v) => {
    const digits = str(v.card).replace(/\D/g, "").slice(-4);
    const card = digits ? all.find((c) => c.last4 === digits) : all.find((c) => c.id === extra.cardId);
    if (!card) throw new ApiError("validation_failed", digits ? `No card ending ${digits} is set up` : "Which card? Add a Card column or pick one");
    const amount = Number(v.amount);
    if (!(amount > 0)) throw new ApiError("validation_failed", "Credits and card payments aren't brought in; record the card bill's payment in Accounting");
    const row = { date: str(v.date), amount, merchant: str(v.merchant).slice(0, 200), reference: str(v.reference).slice(0, 80) };
    const ins = await db.insert(schema.hrCardTxns).values({ ...row, orgId: s.orgId, cardId: card.id, employeeId: card.employeeId, fingerprint: cardFingerprint(row) }).onConflictDoNothing().returning({ id: schema.hrCardTxns.id });
    return ins.length ? "created" : "skipped";
  });
}

async function getTxn(s: Scope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Card spend");
  const [t] = await db.select().from(schema.hrCardTxns).where(and(eq(schema.hrCardTxns.id, id), eq(schema.hrCardTxns.orgId, s.orgId)));
  if (!t || !(isSelf(s, t.employeeId) || (s.payroll && within(s, t.employeeId)))) throw notFound("Card spend");
  return t;
}

/** The cardholder says what a spend was: it becomes a claim (paid by the company) for approval. */
export async function explainTxn(s: Scope, id: string, raw: unknown) {
  const t = await getTxn(s, id);
  if (t.status !== "open") throw new ApiError("conflict", "This spend is already explained or marked personal");
  const v = check(claimInput, { ...(raw as object), kind: "expense", date: String(t.date), amount: Number(t.amount) });
  const values = await prepareClaim(s.orgId, s.settings, t.employeeId, v, { amount: Number(t.amount) });
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(schema.hrClaims).values({ ...values, description: values.description || t.merchant, paidBy: "company", cardTxnId: t.id }).returning();
    const [ok] = await tx.update(schema.hrCardTxns).set({ status: "explained", claimId: c.id }).where(and(eq(schema.hrCardTxns.id, t.id), eq(schema.hrCardTxns.status, "open"))).returning();
    if (!ok) throw new ApiError("conflict", "This spend is already explained");
    return c;
  });
}

export async function markPersonal(s: Scope, id: string) {
  const t = await getTxn(s, id);
  if (t.status !== "open") throw new ApiError("conflict", "Only an unexplained spend can be marked personal");
  await db.update(schema.hrCardTxns).set({ status: "personal" }).where(eq(schema.hrCardTxns.id, t.id));
}

export async function markRepaid(s: Scope, id: string, raw: unknown) {
  requirePayroll(s);
  const t = await getTxn(s, id);
  if (t.status !== "personal") throw new ApiError("conflict", "Only a personal spend is repaid");
  const v = check(payInput, raw);
  await cashAccount(s.orgId, v.accountId);
  await db.update(schema.hrCardTxns).set({ status: "repaid", repaidOn: v.date, repaidAccountId: v.accountId }).where(eq(schema.hrCardTxns.id, t.id));
}

/** The travel desk: trips waiting or in progress, spends to explain, and what's out as advances. */
export async function travelHome(s: Scope) {
  const [ts, txns] = await Promise.all([trips(s), cardTxns(s)]);
  return {
    waiting: ts.filter((t) => t.canDecide).length,
    away: ts.filter((t) => t.status === "approved" && String(t.departOn) <= todayIst() && String(t.returnOn) >= todayIst()).length,
    toSettle: ts.filter((t) => t.status === "approved" && String(t.returnOn) < todayIst()).length,
    advancesOut: ts.filter((t) => t.status === "approved" && t.advancePaidOn).reduce((n, t) => n + Number(t.advance), 0),
    toExplain: txns.filter((t) => t.status === "open").length,
    personalOwed: txns.filter((t) => t.status === "personal").reduce((n, t) => n + Number(t.amount), 0),
  };
}

// ── Books ───────────────────────────────────────────────────────────────────

type Ref = { companyId: string; branchId: string | null; costCentreId?: string | null };

/**
 * Journals: advances paid (Dr staff advances, Cr bank), trips settled (Dr
 * reimbursements for what was claimed, Cr staff advances for the advance, the
 * balance through the bank), company-card spends approved (Dr reimbursements,
 * Cr company cards), personal spends (Dr staff advances, Cr company cards) and
 * their repayment (Dr bank, Cr staff advances).
 */
export async function travelWants(orgId: string, ofEmployee: (id: string) => Ref) {
  const out: { sourceType: string; sourceId: string; date: string; narration: string; sourceRef: string; party: string; lines: PostLine[]; companyId: string; branchId: string | null }[] = [];
  const [ts, names, cardClaims, txns] = await Promise.all([
    db.select().from(schema.hrTrips).where(and(eq(schema.hrTrips.orgId, orgId), inArray(schema.hrTrips.status, ["approved", "settled"]))),
    db.select({ id: schema.hrEmployees.id, name: schema.hrEmployees.name }).from(schema.hrEmployees).where(eq(schema.hrEmployees.orgId, orgId)),
    db.select().from(schema.hrClaims).where(and(eq(schema.hrClaims.orgId, orgId), eq(schema.hrClaims.paidBy, "company"), eq(schema.hrClaims.status, "paid"))),
    db.select().from(schema.hrCardTxns).where(and(eq(schema.hrCardTxns.orgId, orgId), inArray(schema.hrCardTxns.status, ["personal", "repaid"]))),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  for (const t of ts) {
    const ref = ofEmployee(t.employeeId);
    const who = nameOf.get(t.employeeId) ?? "";
    if (t.advancePaidOn && t.advanceAccountId && Number(t.advance)) {
      out.push({ sourceType: "travel_advance", sourceId: t.id, date: String(t.advancePaidOn), narration: `Travel advance · ${t.number} ${t.destination}`, sourceRef: t.number, party: who, lines: [{ key: "staff_advances", debit: Number(t.advance), credit: 0 }, { accountId: t.advanceAccountId, debit: 0, credit: Number(t.advance) }], companyId: ref.companyId, branchId: ref.branchId });
    }
    if (t.status === "settled" && t.settledOn) {
      const advance = t.advancePaidOn ? Number(t.advance) : 0;
      const bal = Number(t.balance);
      const lines: PostLine[] = [{ key: "reimbursements", debit: Number(t.claimed), credit: 0, costCentreId: ref.costCentreId ?? null }, { key: "staff_advances", debit: 0, credit: advance }];
      if (bal && t.settleAccountId) lines.push(bal > 0 ? { accountId: t.settleAccountId, debit: 0, credit: bal } : { accountId: t.settleAccountId, debit: -bal, credit: 0 });
      if (Number(t.claimed) || advance) out.push({ sourceType: "trip_settlement", sourceId: t.id, date: String(t.settledOn), narration: `Trip settled · ${t.number} ${t.destination}`, sourceRef: t.number, party: who, lines, companyId: ref.companyId, branchId: ref.branchId });
    }
  }
  const txnDate = new Map(txns.map((x) => [x.id, String(x.date)]));
  const claimTxn = cardClaims.length ? await db.select({ id: schema.hrCardTxns.id, date: schema.hrCardTxns.date }).from(schema.hrCardTxns).where(inArray(schema.hrCardTxns.id, cardClaims.map((c) => c.cardTxnId!).filter(Boolean))) : [];
  for (const c of claimTxn) txnDate.set(c.id, String(c.date));
  for (const c of cardClaims) {
    const ref = ofEmployee(c.employeeId);
    out.push({ sourceType: "card_spend", sourceId: c.id, date: (c.cardTxnId && txnDate.get(c.cardTxnId)) || String(c.date), narration: `Company card · ${c.description || c.category}`, sourceRef: "Card", party: nameOf.get(c.employeeId) ?? "", lines: [{ key: "reimbursements", debit: Number(c.amount), credit: 0, costCentreId: ref.costCentreId ?? null }, { key: "card_payable", debit: 0, credit: Number(c.amount) }], companyId: ref.companyId, branchId: ref.branchId });
  }
  for (const x of txns) {
    const ref = ofEmployee(x.employeeId);
    const who = nameOf.get(x.employeeId) ?? "";
    out.push({ sourceType: "card_personal", sourceId: x.id, date: String(x.date), narration: `Personal spend on company card · ${x.merchant}`, sourceRef: "Card", party: who, lines: [{ key: "staff_advances", debit: Number(x.amount), credit: 0 }, { key: "card_payable", debit: 0, credit: Number(x.amount) }], companyId: ref.companyId, branchId: ref.branchId });
    if (x.status === "repaid" && x.repaidOn && x.repaidAccountId) out.push({ sourceType: "card_repaid", sourceId: x.id, date: String(x.repaidOn), narration: `Personal card spend repaid · ${x.merchant}`, sourceRef: "Card", party: who, lines: [{ accountId: x.repaidAccountId, debit: Number(x.amount), credit: 0 }, { key: "staff_advances", debit: 0, credit: Number(x.amount) }], companyId: ref.companyId, branchId: ref.branchId });
  }
  return out;
}
