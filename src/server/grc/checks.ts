// Checks that read across the business: duties one person holds that should
// be split (by role, and in what actually happened in the last 90 days),
// fraud indicators in suppliers and bills, emissions from electricity and fuel
// (the Logistics fuel log included), and the GRC home page.
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { duplicateBills, largeBills } from "@/lib/copilot/anomalies";
import { DEFAULT_FACTORS, emissions, esgSchema, FACTOR_LABEL, heat, rating, roleConflicts, roundBills, score, sharedSupplierAccounts, splitBills, supplierEmployeeMatches, type FactorKey, type Indicator } from "@/lib/grc/model";
import { can, type Permission, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { calendarSummary } from "./calendar";
import { due } from "./registers";
import { check, members, requirePart, requireRegisters, requireWrite, todayIst, type Scope } from "./access";

const ago = (days: number) => new Date(Date.parse(`${todayIst()}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
/** Checks that read the books, payroll and suppliers need someone who may see them. */
function requireFinance(s: Scope) {
  requireRegisters(s);
  if (!can(s.role, "accounts:read")) throw new ApiError("forbidden", "These checks read the books, so they need access to Accounts");
}

// ── Segregation of duties ───────────────────────────────────────────────────

export async function sod(s: Scope) {
  requireFinance(s);
  const team = (await members(s.orgId)).filter((m) => m.role !== "employee");
  const byRole = roleConflicts(team, (role, p) => can(role as Role, p as Permission)).map((r) => ({ key: r.key, label: r.label, members: r.members.map(({ id, name, role }) => ({ id, name, role })) }));
  const since = ago(90);
  const names = new Map(team.map((m) => [m.id, m.name]));
  const happened: { kind: string; title: string; detail: string; link: string }[] = [];
  // A purchase order raised and its goods received by the same person.
  if (s.has("inventory")) {
    const rows = await db
      .select({ po: schema.invPurchaseOrders.number, poId: schema.invPurchaseOrders.id, by: schema.invPurchaseOrders.createdBy, grn: schema.invReceipts.number })
      .from(schema.invReceipts)
      .innerJoin(schema.invPurchaseOrders, eq(schema.invPurchaseOrders.id, schema.invReceipts.poId))
      .where(and(eq(schema.invReceipts.orgId, s.orgId), gte(schema.invReceipts.date, since), isNotNull(schema.invPurchaseOrders.createdBy), sql`${schema.invReceipts.createdBy} = ${schema.invPurchaseOrders.createdBy}`))
      .limit(100);
    for (const r of rows) happened.push({ kind: "po_received_by_buyer", title: `${names.get(r.by!) ?? "Someone"} ordered and received ${r.po}`, detail: `The same person raised the purchase order and recorded goods received (${r.grn}).`, link: `/inventory/orders/${r.poId}` });
  }
  // A bill entered and paid in a payment run by the same person.
  if (s.has("accounting")) {
    const runs = await db.select({ id: schema.accPaymentRuns.id, number: schema.accPaymentRuns.number, by: schema.accPaymentRuns.createdBy, items: schema.accPaymentRuns.items }).from(schema.accPaymentRuns).where(and(eq(schema.accPaymentRuns.orgId, s.orgId), eq(schema.accPaymentRuns.status, "paid"), gte(schema.accPaymentRuns.date, since), isNotNull(schema.accPaymentRuns.createdBy)));
    const billIds = [...new Set(runs.flatMap((r) => r.items.map((i) => i.billId)))];
    const bills = billIds.length ? await db.select({ id: schema.accBills.id, number: schema.accBills.number, supplier: schema.accBills.supplierName, by: schema.accBills.createdBy }).from(schema.accBills).where(inArray(schema.accBills.id, billIds)) : [];
    for (const r of runs)
      for (const b of bills.filter((x) => x.by === r.by && r.items.some((i) => i.billId === x.id)))
        happened.push({ kind: "bill_paid_by_enterer", title: `${names.get(r.by!) ?? "Someone"} entered and paid ${b.number}`, detail: `The same person entered ${b.supplier}'s bill and made the payment run (${r.number}) that paid it.`, link: `/accounts/bills/${b.id}` });
  }
  return { byRole, happened, smallTeam: team.length <= 3 };
}

// ── Fraud indicators ────────────────────────────────────────────────────────

export async function fraud(s: Scope) {
  requireFinance(s);
  const out: Indicator[] = [];
  const sups = s.has("inventory") ? await db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name, pan: schema.invSuppliers.pan, gstin: schema.invSuppliers.gstin, bank: schema.invSuppliers.bank }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, s.orgId), eq(schema.invSuppliers.active, true))) : [];
  const supRows = sups.map((x) => ({ ...x, gstin: x.gstin ?? "", account: x.bank?.account ?? "" }));
  out.push(...sharedSupplierAccounts(supRows));
  // Matching suppliers to staff reads employees' bank and PAN, which only payroll may see.
  if (s.has("hr") && can(s.role, "hr:payroll")) {
    const emps = await db.select({ id: schema.hrEmployees.id, name: schema.hrEmployees.name, bank: schema.hrEmployees.bank, ids: schema.hrEmployees.ids }).from(schema.hrEmployees).where(eq(schema.hrEmployees.orgId, s.orgId));
    out.push(...supplierEmployeeMatches(supRows, emps.map((e) => ({ id: e.id, name: e.name, pan: (e.ids as { pan?: string })?.pan ?? "", account: (e.bank as { account?: string })?.account ?? "" }))));
  }
  if (s.has("accounting")) {
    const B = schema.accBills;
    const bills = (await db.select({ id: B.id, number: B.number, supplier: B.supplierName, billNo: B.billNo, total: B.total, date: B.date }).from(B).where(and(eq(B.orgId, s.orgId), eq(B.kind, "bill"), sql`${B.status} not in ('void','rejected')`, gte(B.date, ago(365))))).map((b) => ({ ...b, date: String(b.date) }));
    out.push(...duplicateBills(bills).map((f) => ({ kind: f.kind, title: f.title, detail: f.detail, link: f.link })));
    out.push(...largeBills(bills, ago(30)).map((f) => ({ kind: f.kind, title: f.title, detail: f.detail, link: f.link })));
    out.push(...splitBills(bills.filter((b) => b.date >= ago(90)), s.settings.splitLimit));
    out.push(...roundBills(bills.filter((b) => b.date >= ago(90))));
  }
  return { indicators: out, payrollChecked: s.has("hr") && can(s.role, "hr:payroll") };
}

// ── Emissions ───────────────────────────────────────────────────────────────

const E = schema.grcEsg;

export async function esg(s: Scope, q: { year?: string } = {}) {
  requireRegisters(s);
  requirePart(s, "esg");
  const rows = await db.select().from(E).where(eq(E.orgId, s.orgId)).orderBy(desc(E.month), desc(E.createdAt)).limit(1000);
  // Fuel from the Logistics fuel log, by month and fuel type.
  const fuel = s.has("logistics")
    ? ((await db.execute(sql`select to_char(f.date, 'YYYY-MM') as month, v.fuel, sum(f.litres)::float as litres from lgx_fuel f join lgx_vehicles v on v.id = f.vehicle_id where v.org_id = ${s.orgId} group by 1, 2`)) as unknown as { rows: { month: string; fuel: string; litres: number }[] }).rows
    : [];
  const fromFleet = fuel.flatMap((f) => (f.fuel === "diesel" || f.fuel === "petrol" ? [{ month: f.month, metric: `${f.fuel}_l` as FactorKey, quantity: Number(f.litres), source: "Logistics fuel log" }] : []));
  const all = [...rows.map((r) => ({ month: r.month, metric: r.metric as FactorKey, quantity: r.quantity })), ...fromFleet];
  const year = q.year && /^\d{4}$/.test(q.year) ? q.year : null;
  const factors = s.settings.factors;
  return {
    entries: rows,
    fleet: fromFleet,
    monthly: emissions(year ? all.filter((r) => r.month.startsWith(year)) : all, factors),
    factors,
    defaults: DEFAULT_FACTORS,
    labels: FACTOR_LABEL,
  };
}

export async function addEsg(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "esg");
  const v = check(esgSchema, raw);
  if (v.month > todayIst().slice(0, 7)) throw new ApiError("validation_failed", "That month hasn't happened yet", { month: ["In the future"] });
  return (await db.insert(E).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning())[0];
}

export async function deleteEsg(s: Scope, id: string) {
  requireWrite(s);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Entry");
  await db.delete(E).where(and(eq(E.id, id), eq(E.orgId, s.orgId)));
}

// ── Home ────────────────────────────────────────────────────────────────────

export async function home(s: Scope) {
  const policiesToAck = await db
    .select({ id: schema.grcPolicies.id, title: schema.grcPolicies.title, version: schema.grcPolicies.version, audience: schema.grcPolicies.audience })
    .from(schema.grcPolicies)
    .where(and(eq(schema.grcPolicies.orgId, s.orgId), eq(schema.grcPolicies.status, "published"), sql`not exists (select 1 from grc_policy_acks a where a.policy_id = ${schema.grcPolicies.id} and a.version = ${schema.grcPolicies.version} and a.user_id = ${s.userId})`));
  const mine = policiesToAck.filter((p) => !p.audience.length || p.audience.includes(s.role)).map(({ id, title, version }) => ({ id, title, version }));
  if (!s.registers) return { registers: false, policiesToAck: mine };
  const risks = await db.select({ likelihood: schema.grcRisks.likelihood, impact: schema.grcRisks.impact, rl: schema.grcRisks.residualLikelihood, ri: schema.grcRisks.residualImpact }).from(schema.grcRisks).where(and(eq(schema.grcRisks.orgId, s.orgId), sql`${schema.grcRisks.status} <> 'closed'`));
  // The heat map shows where risks stand now: after controls where that's been assessed.
  const now = risks.map((r) => ({ likelihood: r.rl ?? r.likelihood, impact: r.ri ?? r.impact }));
  const byRating = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of now) byRating[rating(score(r.likelihood, r.impact))]++;
  const today = todayIst();
  const [ctl] = await db.select({ overdue: sql<number>`count(*) filter (where ${schema.grcControls.active} and ${schema.grcControls.nextTestDue} < ${today}::date)::int`, failing: sql<number>`count(*) filter (where ${schema.grcControls.active} and ${schema.grcControls.lastResult} = 'ineffective')::int` }).from(schema.grcControls).where(eq(schema.grcControls.orgId, s.orgId));
  const [inc] = await db.select({ open: sql<number>`count(*) filter (where ${schema.grcIncidents.status} in ('open','investigating'))::int`, critical: sql<number>`count(*) filter (where ${schema.grcIncidents.status} in ('open','investigating') and ${schema.grcIncidents.severity} in ('high','critical'))::int` }).from(schema.grcIncidents).where(eq(schema.grcIncidents.orgId, s.orgId));
  const [fnd] = await db.select({ open: sql<number>`count(*) filter (where ${schema.grcFindings.status} = 'open')::int`, overdue: sql<number>`count(*) filter (where ${schema.grcFindings.status} = 'open' and ${schema.grcFindings.dueDate} < ${today}::date)::int` }).from(schema.grcFindings).where(eq(schema.grcFindings.orgId, s.orgId));
  return { registers: true, policiesToAck: mine, risks: { open: now.length, byRating, heat: heat(now) }, controls: ctl, incidents: inc, findings: fnd, calendar: await calendarSummary(s), ...(await due(s)) };
}
