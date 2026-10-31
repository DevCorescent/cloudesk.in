// Reports: the home dashboard and the sales reports — pipeline by stage,
// weighted forecast, win rate, deal size and cycle, lost reasons, lead sources,
// each rep's activity and results, and the lifecycle funnel.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { forecast, LIFECYCLE } from "@/lib/crm/model";
import { owners, pipelines, visible, type Scope } from "./access";
import { tasks, upcomingMeetings } from "./activities";

const rowsOf = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? (r as T[]));

function range(from?: string, to?: string) {
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const end = ok(to) ? new Date(`${to}T23:59:59.999+05:30`) : new Date();
  const start = ok(from) ? new Date(`${from}T00:00:00+05:30`) : new Date(end.getTime() - 89 * 86400_000);
  return { start, end };
}

export async function home(s: Scope) {
  const [myTasks, meetings, [counts], recent, ps] = await Promise.all([
    tasks(s, {}),
    upcomingMeetings(s),
    db
      .select({
        contacts: sql<number>`count(*)::int`,
        newWeek: sql<number>`count(*) filter (where ${schema.crmContacts.createdAt} > now() - interval '7 days')::int`,
        newPrev: sql<number>`count(*) filter (where ${schema.crmContacts.createdAt} between now() - interval '14 days' and now() - interval '7 days')::int`,
        customers: sql<number>`count(*) filter (where ${schema.crmContacts.lifecycle} = 'customer')::int`,
        hot: sql<number>`count(*) filter (where ${schema.crmContacts.score} >= 60 and ${schema.crmContacts.lifecycle} in ('lead','qualified','opportunity'))::int`,
        untouched: sql<number>`count(*) filter (where ${schema.crmContacts.lifecycle} = 'lead' and ${schema.crmContacts.leadStatus} = 'new')::int`,
      })
      .from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.orgId, s.orgId), visible(s, schema.crmContacts.ownerId))),
    db
      .select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, phone: schema.crmContacts.phone, source: schema.crmContacts.source, score: schema.crmContacts.score, lifecycle: schema.crmContacts.lifecycle, createdAt: schema.crmContacts.createdAt })
      .from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.orgId, s.orgId), visible(s, schema.crmContacts.ownerId)))
      .orderBy(sql`${schema.crmContacts.createdAt} desc`)
      .limit(8),
    pipelines(s.orgId),
  ]);
  const deals = await db
    .select({ value: schema.crmDeals.value, status: schema.crmDeals.status, stageId: schema.crmDeals.stageId, expectedClose: schema.crmDeals.expectedClose, closedAt: schema.crmDeals.closedAt, stageEnteredAt: schema.crmDeals.stageEnteredAt, pipelineId: schema.crmDeals.pipelineId })
    .from(schema.crmDeals)
    .where(and(eq(schema.crmDeals.orgId, s.orgId), visible(s, schema.crmDeals.ownerId)));
  const stages = ps.flatMap((p) => p.stages);
  const prob = (id: string) => stages.find((x) => x.id === id)?.probability ?? 0;
  const open = deals.filter((d) => d.status === "open");
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const wonMonth = deals.filter((d) => d.status === "won" && d.closedAt && d.closedAt >= monthStart);
  const rotting = open.filter((d) => {
    const st = stages.find((x) => x.id === d.stageId);
    return st && st.rotDays > 0 && Date.now() - d.stageEnteredAt.getTime() > st.rotDays * 86400_000;
  }).length;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const p0 = ps[0];
  return {
    kpis: {
      contacts: counts.contacts,
      newWeek: counts.newWeek,
      newPrev: counts.newPrev,
      customers: counts.customers,
      hot: counts.hot,
      untouched: counts.untouched,
      openDeals: open.length,
      pipeline: open.reduce((a, d) => a + d.value, 0),
      weighted: open.reduce((a, d) => a + Math.round((d.value * prob(d.stageId)) / 100), 0),
      wonMonth: wonMonth.reduce((a, d) => a + d.value, 0),
      wonMonthCount: wonMonth.length,
      rotting,
    },
    tasks: { overdue: myTasks.open.filter((t) => t.dueAt && t.dueAt < new Date()), today: myTasks.open.filter((t) => t.dueAt && t.dueAt >= new Date() && t.dueAt <= today), upcoming: myTasks.open.filter((t) => !t.dueAt || t.dueAt > today).slice(0, 8) },
    meetings,
    recent,
    funnel: p0 ? { pipeline: p0.name, stages: p0.stages.filter((x) => x.kind === "open").map((st) => { const ds = open.filter((d) => d.stageId === st.id); return { id: st.id, name: st.name, count: ds.length, value: ds.reduce((a, d) => a + d.value, 0) }; }) } : null,
  };
}

export async function salesReport(s: Scope, opts: { from?: string; to?: string; pipelineId?: string }) {
  const { start, end } = range(opts.from, opts.to);
  const ps = await pipelines(s.orgId);
  const p = ps.find((x) => x.id === opts.pipelineId) ?? null;
  const stages = ps.flatMap((x) => x.stages);
  const people = await owners(s.orgId);
  const who = (id: string | null) => people.find((x) => x.id === id)?.name ?? "Unassigned";
  const deals = await db
    .select()
    .from(schema.crmDeals)
    .where(and(eq(schema.crmDeals.orgId, s.orgId), visible(s, schema.crmDeals.ownerId), p ? eq(schema.crmDeals.pipelineId, p.id) : undefined));
  const prob = (id: string) => stages.find((x) => x.id === id)?.probability ?? 0;
  const inRange = (d: Date | null) => !!d && d >= start && d <= end;
  const closed = deals.filter((d) => d.status !== "open" && inRange(d.closedAt));
  const won = closed.filter((d) => d.status === "won");
  const lost = closed.filter((d) => d.status === "lost");
  const created = deals.filter((d) => inRange(d.createdAt));
  const open = deals.filter((d) => d.status === "open");
  const cycle = won.length ? Math.round(won.reduce((a, d) => a + (d.closedAt!.getTime() - d.createdAt.getTime()) / 86400_000, 0) / won.length) : 0;

  const byStage = (p ? p.stages : (ps[0]?.stages ?? [])).filter((x) => x.kind === "open").map((st) => {
    const ds = open.filter((d) => d.stageId === st.id);
    const total = ds.reduce((a, d) => a + d.value, 0);
    return { stage: st.name, probability: st.probability, count: ds.length, total, weighted: Math.round((total * st.probability) / 100) };
  });
  const lostReasons = [...lost.reduce((m, d) => m.set(d.lostReason || "No reason", (m.get(d.lostReason || "No reason") ?? 0) + 1), new Map<string, number>())].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  const acts = rowsOf<{ owner: string | null; kind: string; n: number }>(
    await db.execute(sql`select owner_id as owner, kind, count(*)::int as n from crm_activities where org_id = ${s.orgId} and kind <> 'event' and coalesce(done_at, created_at) between ${start} and ${end} and (kind <> 'task' or done_at is not null) group by owner_id, kind`),
  );
  const repIds = [...new Set([...deals.map((d) => d.ownerId), ...acts.map((a) => a.owner)])];
  const reps = repIds
    .map((id) => {
      const mine = closed.filter((d) => d.ownerId === id);
      const w = mine.filter((d) => d.status === "won");
      const a = acts.filter((x) => x.owner === id);
      const n = (k: string) => Number(a.find((x) => x.kind === k)?.n ?? 0);
      return { ownerId: id, name: who(id), won: w.length, wonValue: w.reduce((x, d) => x + d.value, 0), lost: mine.length - w.length, winRate: mine.length ? Math.round((w.length / mine.length) * 100) : null, open: open.filter((d) => d.ownerId === id).length, pipeline: open.filter((d) => d.ownerId === id).reduce((x, d) => x + d.value, 0), calls: n("call"), emails: n("email"), meetings: n("meeting"), notes: n("note"), tasks: n("task") };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.calls + b.emails + b.meetings - (a.calls + a.emails + a.meetings));

  const sources = rowsOf<{ source: string; leads: number; customers: number }>(
    await db.execute(sql`select source, count(*)::int as leads, count(*) filter (where lifecycle in ('customer','evangelist'))::int as customers from crm_contacts where org_id = ${s.orgId} and created_at between ${start} and ${end} group by source order by leads desc`),
  ).map((r) => ({ source: r.source, leads: Number(r.leads), customers: Number(r.customers), rate: Number(r.leads) ? Math.round((Number(r.customers) / Number(r.leads)) * 100) : 0 }));
  const funnel = rowsOf<{ lifecycle: string; n: number }>(await db.execute(sql`select lifecycle, count(*)::int as n from crm_contacts where org_id = ${s.orgId} group by lifecycle`));
  const weekly = rowsOf<{ week: string; leads: number }>(
    await db.execute(sql`select to_char(date_trunc('week', created_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as week, count(*)::int as leads from crm_contacts where org_id = ${s.orgId} and created_at between ${start} and ${end} group by 1 order by 1`),
  );
  const wonWeekly = new Map<string, number>();
  for (const d of won) {
    const k = weekOf(d.closedAt!);
    wonWeekly.set(k, (wonWeekly.get(k) ?? 0) + d.value);
  }

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    pipelines: ps.map((x) => ({ id: x.id, name: x.name })),
    totals: {
      won: won.length,
      wonValue: won.reduce((a, d) => a + d.value, 0),
      lost: lost.length,
      lostValue: lost.reduce((a, d) => a + d.value, 0),
      winRate: closed.length ? Math.round((won.length / closed.length) * 100) : null,
      avgDeal: won.length ? Math.round(won.reduce((a, d) => a + d.value, 0) / won.length) : 0,
      cycleDays: cycle,
      created: created.length,
      createdValue: created.reduce((a, d) => a + d.value, 0),
      open: open.length,
      pipeline: open.reduce((a, d) => a + d.value, 0),
      weighted: open.reduce((a, d) => a + Math.round((d.value * prob(d.stageId)) / 100), 0),
    },
    byStage,
    forecast: forecast(open.map((d) => ({ value: d.value, probability: prob(d.stageId), expectedClose: d.expectedClose ? String(d.expectedClose) : null, status: d.status }))),
    lostReasons,
    reps,
    sources,
    funnel: LIFECYCLE.map((l) => ({ lifecycle: l, count: Number(funnel.find((f) => f.lifecycle === l)?.n ?? 0) })),
    weekly: weekly.map((w) => ({ week: w.week, leads: Number(w.leads), won: wonWeekly.get(w.week) ?? 0 })),
  };
}

function weekOf(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const day = (ist.getUTCDay() + 6) % 7;
  ist.setUTCDate(ist.getUTCDate() - day);
  return ist.toISOString().slice(0, 10);
}
