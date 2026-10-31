// Billing: approved, billable time and reached milestones become a draft
// invoice in the project's books, for its client. Each entry remembers the
// invoice and the rate it went at, so it's never billed twice; voiding or
// deleting that invoice frees the time to be billed again.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { DocInput, Line } from "@/lib/invoicing/model";
import { partySchema } from "@/lib/invoicing/model";
import { billLines, hrs, type BillEntry } from "@/lib/work/model";
import { ApiError } from "../http/errors";
import { createDoc, getSettings as invoiceSettings } from "../invoicing/service";
import { chargeOf, expensesToBill } from "./plus";
import { audit } from "../services/audit";
import { assertBook, check, getProject, invoiceBooks, partOn, requireManage, requirePart, todayIst, type Scope } from "./access";

/** Free time and milestones whose invoice was voided or deleted. */
export async function releaseBilling(orgId: string) {
  const t = (await db.execute(sql`
    update work_time t set invoice_id = null, billed_rate = null, updated_at = now()
    where t.org_id = ${orgId} and t.invoice_id is not null
      and not exists (select 1 from invoice_documents d where d.id = t.invoice_id and d.status <> 'void')
    returning t.id`)) as unknown as { rows: unknown[] };
  const m = (await db.execute(sql`
    update work_milestones m set invoice_id = null
    where m.org_id = ${orgId} and m.invoice_id is not null
      and not exists (select 1 from invoice_documents d where d.id = m.invoice_id and d.status <> 'void')
    returning m.id`)) as unknown as { rows: unknown[] };
  const e = (await db.execute(sql`
    update work_expenses e set invoice_id = null
    where e.org_id = ${orgId} and e.invoice_id is not null
      and not exists (select 1 from invoice_documents d where d.id = e.invoice_id and d.status <> 'void')
    returning e.id`)) as unknown as { rows: unknown[] };
  return t.rows.length + m.rows.length + e.rows.length;
}

/** The workspace that owns some books, for the invoicing screens to release time after a void. */
export async function releaseBillingFor(ownerId: string) {
  const rows = (await db.execute(sql`select coalesce(p.org_id, b.org_id) as org_id from invoice_owners o left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where o.id = ${ownerId}`)) as unknown as { rows: { org_id: string }[] };
  if (rows.rows[0]?.org_id) await releaseBilling(rows.rows[0].org_id);
}

async function entriesToBill(s: Scope, projectId: string, upTo: string) {
  const rows = (await db.execute(sql`
    select t.id, t.minutes, t.date::text as date, t.note, t.task_id, coalesce(k.title, '') as task_title, u.name as user_name,
      coalesce(m.rate, p.rate) as rate, t.status
    from work_time t join work_projects p on p.id = t.project_id join users u on u.id = t.user_id
      left join work_members m on m.project_id = t.project_id and m.user_id = t.user_id
      left join work_tasks k on k.id = t.task_id
    where t.org_id = ${s.orgId} and t.project_id = ${projectId} and t.billable and t.invoice_id is null and t.timer_started_at is null
      and t.minutes > 0 and t.date <= ${upTo} and t.status <> 'rejected'
    order by t.date, t.created_at`)) as unknown as { rows: { id: string; minutes: number; date: string; note: string; task_id: string | null; task_title: string; user_name: string; rate: number; status: string }[] };
  const ready = rows.rows.filter((r) => r.status === "approved");
  return {
    ready: ready.map((r): BillEntry => ({ id: r.id, minutes: r.minutes, rate: Number(r.rate), taskId: r.task_id, taskTitle: r.task_title, userName: r.user_name, date: r.date, note: r.note })),
    waiting: rows.rows.filter((r) => r.status !== "approved").reduce((n, r) => n + r.minutes, 0),
  };
}

/** What's ready to bill on a project, and what's still waiting for approval. */
export async function unbilled(s: Scope, projectId: string, q: { upTo?: string; groupBy?: string } = {}) {
  requireManage(s);
  requirePart(s, "billing");
  await releaseBilling(s.orgId);
  const p = await getProject(s, projectId);
  const upTo = q.upTo && /^\d{4}-\d{2}-\d{2}$/.test(q.upTo) ? q.upTo : todayIst();
  const groupBy = (["task", "person", "single"] as const).find((g) => g === q.groupBy) ?? "task";
  const { ready, waiting } = await entriesToBill(s, p.id, upTo);
  const milestones = await db.select().from(schema.workMilestones).where(and(eq(schema.workMilestones.projectId, p.id), isNull(schema.workMilestones.invoiceId), sql`${schema.workMilestones.doneAt} is not null`, sql`${schema.workMilestones.amount} > 0`)).orderBy(asc(schema.workMilestones.position));
  const invoices = (await db.execute(sql`
    select d.id, d.number, d.status, d.total, d.issue_date::text as issue_date, d.project_id as owner_id
    from invoice_documents d
    where d.id in (select distinct invoice_id from work_time where project_id = ${p.id} and invoice_id is not null union select invoice_id from work_milestones where project_id = ${p.id} and invoice_id is not null union select invoice_id from work_expenses where project_id = ${p.id} and invoice_id is not null)
    order by d.created_at desc`)) as unknown as { rows: { id: string; number: string; status: string; total: number; issue_date: string; owner_id: string }[] };
  const exps = partOn(s, "expenses") && p.billing !== "none" ? await expensesToBill(p.id, upTo) : [];
  const books = await invoiceBooks(s.orgId);
  const link = (ownerId: string, id: string) => {
    const b = books.find((x) => x.id === ownerId);
    return b?.kind === "project" ? `/projects/${ownerId}/invoicing/invoices/${id}` : `/finance/${ownerId}/invoices/${id}`;
  };
  return {
    upTo,
    groupBy,
    lines: p.billing === "hourly" ? billLines(ready, groupBy, s.settings.roundTo, `${p.name} — professional services`) : [],
    noRate: ready.some((e) => !e.rate),
    entries: ready.length,
    waitingMinutes: waiting,
    milestones: milestones.map((m) => ({ id: m.id, name: m.name, amount: m.amount, doneAt: m.doneAt })),
    expenses: exps.map((e) => ({ id: e.id, date: e.date, category: e.category, description: e.description, amount: e.amount, markupPct: e.markupPct, charge: chargeOf(e) })),
    invoices: invoices.rows.map((d) => ({ ...d, href: link(d.owner_id, d.id) })),
    ready: !!p.ownerId && !!p.clientId,
  };
}

const billSchema = z.object({ upTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), groupBy: z.enum(["task", "person", "single"]).default("task"), milestoneIds: z.array(z.uuid()).max(100).default([]), includeTime: z.boolean().default(true), expenseIds: z.array(z.uuid()).max(500).default([]) });

/** Make a draft invoice from what's ready to bill. */
export async function billProject(s: Scope, projectId: string, raw: unknown) {
  requireManage(s);
  requirePart(s, "billing");
  await releaseBilling(s.orgId);
  const p = await getProject(s, projectId);
  const v = check(billSchema, raw);
  if (!p.ownerId || !p.clientId) throw new ApiError("validation_failed", "Pick the books and the client this project bills before invoicing it", { clientId: ["Pick a client"] });
  await assertBook(s.orgId, p.ownerId);
  const [client] = await db.select().from(schema.invoiceClients).where(and(eq(schema.invoiceClients.id, p.clientId), eq(schema.invoiceClients.projectId, p.ownerId)));
  if (!client) throw new ApiError("validation_failed", "The project's client is no longer in those books", { clientId: ["Pick a client"] });
  const upTo = v.upTo ?? todayIst();
  const time = v.includeTime && p.billing === "hourly" ? await entriesToBill(s, p.id, upTo) : { ready: [], waiting: 0 };
  if (time.ready.some((e) => !e.rate)) throw new ApiError("validation_failed", "Some of this time has no rate. Set the project's rate per hour (or each person's) first.", { rate: ["Set a rate"] });
  const groups = billLines(time.ready, v.groupBy, s.settings.roundTo, `${p.name} — professional services`);
  const milestones = v.milestoneIds.length ? await db.select().from(schema.workMilestones).where(and(eq(schema.workMilestones.projectId, p.id), inArray(schema.workMilestones.id, v.milestoneIds), isNull(schema.workMilestones.invoiceId), sql`${schema.workMilestones.doneAt} is not null`)) : [];
  if (milestones.length !== v.milestoneIds.length) throw new ApiError("conflict", "Some of those milestones aren't reached yet or are already invoiced");
  const exps = v.expenseIds.length ? (await expensesToBill(p.id, upTo)).filter((e) => v.expenseIds.includes(e.id)) : [];
  if (exps.length !== v.expenseIds.length) throw new ApiError("conflict", "Some of those expenses aren't billable or are already invoiced");
  if (!groups.length && !milestones.length && !exps.length) throw new ApiError("conflict", time.waiting ? `Nothing is ready to bill yet: ${hrs(time.waiting)} is waiting for approval` : "Nothing is ready to bill on this project");

  const settings = await invoiceSettings(p.ownerId);
  const tax = settings.taxMode === "none" ? 0 : settings.defaultTaxBps;
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const lines: Line[] = [
    ...groups.map((g, i): Line => ({ id: `t${i + 1}`, itemId: null, name: g.name, description: g.from === g.to ? fmt(g.from) : `${fmt(g.from)} – ${fmt(g.to)}`, hsn: "", quantity: g.hours, unit: "hrs", rate: g.rate, discount: null, taxBps: tax })),
    ...milestones.map((m, i): Line => ({ id: `m${i + 1}`, itemId: null, name: m.name, description: `Milestone · ${p.name}`, hsn: "", quantity: 1, unit: "", rate: m.amount, discount: null, taxBps: tax })),
    ...exps.map((e, i): Line => ({ id: `e${i + 1}`, itemId: null, name: `${e.category}${e.description ? `: ${e.description}` : ""}`.slice(0, 200), description: [fmt(e.date), e.vendor, e.markupPct ? `incl. ${e.markupPct}% handling` : ""].filter(Boolean).join(" · "), hsn: "", quantity: 1, unit: "", rate: chargeOf(e), discount: null, taxBps: tax })),
  ];
  const party = partySchema.parse({ name: client.name, company: client.company, email: client.email, phone: client.phone, gstin: client.gstin, billing: client.billing, shipping: client.shipping });
  const issueDate = todayIst();
  const due = new Date(Date.parse(`${issueDate}T00:00:00Z`) + settings.dueDays * 86_400_000).toISOString().slice(0, 10);
  const input: DocInput = {
    type: "invoice",
    clientId: client.id,
    client: party,
    issueDate,
    dueDate: due,
    currency: settings.currency,
    lines,
    adjustments: { discount: null, charges: [], roundOff: true },
    taxMode: settings.taxMode,
    inclusive: false,
    placeOfSupply: party.billing.state,
    title: "",
    reference: p.code,
    notes: settings.notes,
    terms: settings.terms,
    footer: "",
    customFields: [{ label: "Project", value: `${p.code} · ${p.name}`.slice(0, 200) }],
    templateId: null,
    recurring: null,
    number: "",
  };
  const doc = await createDoc(p.ownerId, s.userId, input);
  // Claim the time; anything claimed by someone else in the meantime is left out of this invoice's record.
  const timeIds = groups.flatMap((g) => g.ids);
  const rates = new Map(time.ready.map((e) => [e.id, e.rate]));
  for (const rate of new Set(timeIds.map((id) => rates.get(id)!))) {
    const ids = timeIds.filter((id) => rates.get(id) === rate);
    await db.update(schema.workTime).set({ invoiceId: doc.id, billedRate: rate, updatedAt: new Date() }).where(and(inArray(schema.workTime.id, ids), isNull(schema.workTime.invoiceId)));
  }
  if (milestones.length) await db.update(schema.workMilestones).set({ invoiceId: doc.id }).where(inArray(schema.workMilestones.id, milestones.map((m) => m.id)));
  if (exps.length) await db.update(schema.workExpenses).set({ invoiceId: doc.id }).where(and(inArray(schema.workExpenses.id, exps.map((e) => e.id)), isNull(schema.workExpenses.invoiceId)));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "work.project_billed", targetType: "work_project", targetId: p.id, metadata: { invoiceId: doc.id, entries: timeIds.length, milestones: milestones.length, expenses: exps.length, total: doc.total } });
  const books = await invoiceBooks(s.orgId);
  const kind = books.find((b) => b.id === p.ownerId)?.kind;
  return { invoice: { id: doc.id, total: doc.total, href: kind === "project" ? `/projects/${p.ownerId}/invoicing/invoices/${doc.id}` : `/finance/${p.ownerId}/invoices/${doc.id}` }, entries: timeIds.length, milestones: milestones.length, expenses: exps.length };
}

/** Projects with something to bill, for the billing screen. */
export async function billingOverview(s: Scope) {
  requireManage(s);
  requirePart(s, "billing");
  await releaseBilling(s.orgId);
  const rows = (await db.execute(sql`
    select p.id, p.code, p.name, p.client_name, p.billing, p.owner_id, p.client_id,
      coalesce(sum(t.minutes) filter (where t.status = 'approved'), 0)::int as ready_minutes,
      coalesce(sum(round(t.minutes * coalesce(m.rate, p.rate) / 60.0)) filter (where t.status = 'approved'), 0)::bigint as ready_amount,
      coalesce(sum(t.minutes) filter (where t.status in ('draft','submitted')), 0)::int as waiting_minutes,
      (select coalesce(sum(ms.amount), 0) from work_milestones ms where ms.project_id = p.id and ms.done_at is not null and ms.invoice_id is null)::bigint as milestones,
      (select coalesce(sum(round(e.amount * (1 + e.markup_pct / 100.0))), 0) from work_expenses e where e.project_id = p.id and e.billable and e.invoice_id is null)::bigint as expenses
    from work_projects p
      left join work_time t on t.project_id = p.id and t.billable and t.invoice_id is null and t.minutes > 0 and t.timer_started_at is null and p.billing = 'hourly'
      left join work_members m on m.project_id = p.id and m.user_id = t.user_id
    where p.org_id = ${s.orgId} and p.billing <> 'none'
    group by p.id order by p.name`)) as unknown as { rows: { id: string; code: string; name: string; client_name: string; billing: string; owner_id: string | null; client_id: string | null; ready_minutes: number; ready_amount: number; waiting_minutes: number; milestones: number; expenses: number }[] };
  return rows.rows
    .map((r) => ({ id: r.id, code: r.code, name: r.name, client: r.client_name, billing: r.billing, hasClient: !!r.owner_id && !!r.client_id, readyMinutes: r.ready_minutes, readyAmount: Number(r.ready_amount), waitingMinutes: r.waiting_minutes, milestones: Number(r.milestones), expenses: partOn(s, "expenses") ? Number(r.expenses) : 0 }))
    .filter((r) => r.readyMinutes || r.waitingMinutes || r.milestones || r.expenses);
}
