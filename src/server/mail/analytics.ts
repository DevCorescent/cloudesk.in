// Mail analytics: how much mail comes and goes, how fast it's answered, who
// sends it and when. Everything is counted from the stored messages — nothing
// is estimated. A "turn" starts when they write after we last did (or first);
// our first real reply ends it, and the gap is the reply time. Auto-replies
// never count as replies. Reply rates and targets look only at personal mail
// (Primary, People and New senders), where an answer is expected; spam is left out.
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { REPLY_CATEGORIES, type Category } from "@/lib/mail/model";
import type { MailStats } from "@/lib/mail/api";
import { accountsFor, type Scope } from "./access";

const DAY = 86_400_000;
const n = (v: unknown) => Number(v ?? 0);
const list = (ids: string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
const cats = sql.raw(REPLY_CATEGORIES.map((c) => `'${c}'`).join(","));

/** A valid IANA time zone, or UTC. */
export function safeTz(tz: string | undefined) {
  if (!tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const median = (xs: number[]) => quantile(xs, 0.5);
function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const i = (a.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round((a[lo]! + (a[hi]! - a[lo]!) * (i - lo)) * 10) / 10;
}

type Turn = { account: string; asked: Date; replied: Date | null; by: string | null; mins: number | null };

/** Turns' reply times and the share answered within the mailbox's target. */
function summarise(turns: Turn[], sla: Map<string, number | null>, now: number) {
  const done = turns.filter((t) => t.mins !== null);
  const mins = done.map((t) => t.mins!);
  let met = 0;
  let missed = 0;
  for (const t of turns) {
    const h = sla.get(t.account);
    if (!h) continue;
    const limit = h * 60;
    if (t.mins !== null) {
      if (t.mins <= limit) met++;
      else missed++;
    }
    else if (now - t.asked.getTime() > limit * 60_000) missed++;
  }
  return {
    replied: done.length,
    replyRate: turns.length ? Math.round((done.length / turns.length) * 1000) / 10 : null,
    medianReplyMin: median(mins),
    p90ReplyMin: quantile(mins, 0.9),
    withinSla: met + missed ? Math.round((met / (met + missed)) * 1000) / 10 : null,
    mins,
  };
}

export async function analytics(s: Scope, q: Record<string, string>): Promise<MailStats> {
  const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const tz = safeTz(q.tz);
  const accts = (await accountsFor(s)).filter((a) => !q.account || q.account === "all" || a.id === q.account);
  const now = Date.now();
  const since = new Date(now - days * DAY);
  const prevSince = new Date(now - 2 * days * DAY);
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayList = Array.from({ length: days }, (_, i) => dayFmt.format(new Date(now - (days - 1 - i) * DAY)));
  const empty: MailStats = {
    range: { days, from: dayList[0]!, to: dayList[dayList.length - 1]!, tz },
    totals: { received: 0, sent: 0, conversations: 0, replied: 0, owed: 0, replyRate: null, medianReplyMin: null, p90ReplyMin: null, withinSla: null, needsReply: 0, overdue: 0, autoReplies: 0 },
    prev: { received: 0, sent: 0, medianReplyMin: null, replyRate: null },
    daily: dayList.map((day) => ({ day, received: 0, sent: 0 })),
    hours: Array.from({ length: 7 }, () => Array(24).fill(0)),
    replyBuckets: [], categories: [], senders: [], domains: [], mailboxes: [], people: [], oldestWaiting: [],
  };
  if (!accts.length) return empty;
  const ids = list(accts.map((a) => a.id));
  // Messages that really went or came (not drafts, scheduled or failed), outside spam.
  const real = sql`(x.send_status is null or x.send_status = 'sent') and t.status <> 'spam'`;

  const [tot] = (await db.execute(sql`select
      count(*) filter (where x.direction = 'in' and x.date >= ${since})::int as received,
      count(*) filter (where x.direction = 'out' and not x.auto and x.date >= ${since})::int as sent,
      count(*) filter (where x.direction = 'out' and x.auto and x.date >= ${since})::int as auto,
      count(distinct x.thread_id) filter (where x.date >= ${since})::int as conversations,
      count(*) filter (where x.direction = 'in' and x.date < ${since})::int as prev_received,
      count(*) filter (where x.direction = 'out' and not x.auto and x.date < ${since})::int as prev_sent
    from mail_messages x join mail_threads t on t.id = x.thread_id
    where x.account_id in (${ids}) and ${real} and x.date >= ${prevSince} and x.date <= now()`)).rows as Record<string, unknown>[];

  const daily = (await db.execute(sql`select to_char(x.date at time zone ${tz}, 'YYYY-MM-DD') as day,
      count(*) filter (where x.direction = 'in')::int as received, count(*) filter (where x.direction = 'out' and not x.auto)::int as sent
    from mail_messages x join mail_threads t on t.id = x.thread_id
    where x.account_id in (${ids}) and ${real} and x.date >= ${since} and x.date <= now() group by 1`)).rows as { day: string; received: number; sent: number }[];
  const byDay = new Map(daily.map((d) => [d.day, d]));

  const hourRows = (await db.execute(sql`select extract(isodow from x.date at time zone ${tz})::int - 1 as dow, extract(hour from x.date at time zone ${tz})::int as h, count(*)::int as c
    from mail_messages x join mail_threads t on t.id = x.thread_id
    where x.account_id in (${ids}) and ${real} and x.direction = 'in' and x.date >= ${since} group by 1, 2`)).rows as { dow: number; h: number; c: number }[];
  const hours = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of hourRows) if (hours[n(r.dow)]) hours[n(r.dow)]![n(r.h)] = n(r.c);

  // Reply turns (personal mail only), from a little before the previous period so turns that started then are whole.
  const turnRows = (await db.execute(sql`with m as (
        select x.thread_id, x.account_id, x.direction, x.date, x.sent_by, lag(x.direction) over (partition by x.thread_id order by x.date, x.id) as prev
        from mail_messages x join mail_threads t on t.id = x.thread_id
        where x.account_id in (${ids}) and ${real} and not x.auto and t.category in (${cats}) and x.date >= ${new Date(prevSince.getTime() - 30 * DAY)}
      ), g as (
        select *, sum(case when direction = 'in' and (prev is null or prev = 'out') then 1 else 0 end) over (partition by thread_id order by date rows unbounded preceding) as turn from m
      ), turns as (
        select account_id, min(date) filter (where direction = 'in') as asked, min(date) filter (where direction = 'out') as replied,
          (array_agg(sent_by order by date) filter (where direction = 'out'))[1] as by
        from g where turn > 0 group by thread_id, account_id, turn
      )
      select account_id, asked, replied, by, extract(epoch from (replied - asked)) / 60 as mins from turns where asked >= ${prevSince} limit 100000`)).rows as { account_id: string; asked: string | Date; replied: string | Date | null; by: string | null; mins: unknown }[];
  const turns: Turn[] = turnRows.map((r) => ({ account: r.account_id, asked: new Date(r.asked), replied: r.replied ? new Date(r.replied) : null, by: r.by, mins: r.mins === null || r.mins === undefined ? null : Math.max(0, Number(r.mins)) }));
  const cur = turns.filter((t) => t.asked >= since);
  const prev = turns.filter((t) => t.asked < since);
  const sla = new Map(accts.map((a) => [a.id, (a.settings as { slaHours?: number | null }).slaHours ?? null]));
  const c = summarise(cur, sla, now);
  const p = summarise(prev, sla, now);

  const buckets: [string, number][] = [["Under 1 hour", 60], ["1–4 hours", 240], ["4–24 hours", 1440], ["1–3 days", 4320], ["Over 3 days", Infinity]];
  const replyBuckets = buckets.map(([label, max], i) => ({ label, n: c.mins.filter((m) => m < max && (i === 0 || m >= buckets[i - 1]![1])).length }));

  const categories = ((await db.execute(sql`select t.category, count(*)::int as c from mail_messages x join mail_threads t on t.id = x.thread_id
    where x.account_id in (${ids}) and ${real} and x.direction = 'in' and x.date >= ${since} group by 1 order by 2 desc`)).rows as { category: Category; c: number }[]).map((r) => ({ category: r.category, n: n(r.c) }));
  const senders = ((await db.execute(sql`select x.from_address as address, max(x.from_name) as name, count(*)::int as c from mail_messages x join mail_threads t on t.id = x.thread_id
    where x.account_id in (${ids}) and ${real} and x.direction = 'in' and x.date >= ${since} and x.from_address <> '' group by 1 order by 3 desc, 1 limit 8`)).rows as { address: string; name: string | null; c: number }[]).map((r) => ({ address: r.address, name: r.name ?? "", n: n(r.c) }));
  const domains = ((await db.execute(sql`select split_part(x.from_address, '@', 2) as domain, count(*)::int as c from mail_messages x join mail_threads t on t.id = x.thread_id
    where x.account_id in (${ids}) and ${real} and x.direction = 'in' and x.date >= ${since} and x.from_address like '%@%' group by 1 order by 2 desc, 1 limit 8`)).rows as { domain: string; c: number }[]).map((r) => ({ domain: r.domain, n: n(r.c) }));

  // What's owed right now.
  const owedWhere = sql`t.account_id in (${ids}) and t.status = 'inbox' and (t.snooze_until is null or t.snooze_until <= now()) and t.awaiting_since is not null and not t.muted and t.category in (${cats})`;
  const overdueExpr = sql`t.awaiting_since + (a.settings->>'slaHours')::int * interval '1 hour' < now()`;
  const owedRows = (await db.execute(sql`select t.account_id, count(*)::int as c, count(*) filter (where ${overdueExpr})::int as late
    from mail_threads t join mail_accounts a on a.id = t.account_id where ${owedWhere} group by 1`)).rows as { account_id: string; c: number; late: number }[];
  const owedBy = new Map(owedRows.map((r) => [r.account_id, { c: n(r.c), late: n(r.late) }]));
  const oldest = (await db.execute(sql`select t.id, t.subject, t.participants, t.awaiting_since, t.account_id, coalesce(${overdueExpr}, false) as late
    from mail_threads t join mail_accounts a on a.id = t.account_id where ${owedWhere} order by t.awaiting_since limit 6`)).rows as { id: string; subject: string; participants: { name: string; address: string }[]; awaiting_since: string | Date; account_id: string; late: boolean }[];

  const perAccount = (await db.execute(sql`select x.account_id, count(*) filter (where x.direction = 'in')::int as received, count(*) filter (where x.direction = 'out' and not x.auto)::int as sent
    from mail_messages x join mail_threads t on t.id = x.thread_id where x.account_id in (${ids}) and ${real} and x.date >= ${since} and x.date <= now() group by 1`)).rows as { account_id: string; received: number; sent: number }[];
  const mailboxes = accts.map((a) => {
    const r = perAccount.find((x) => x.account_id === a.id);
    const st = summarise(cur.filter((t) => t.account === a.id), sla, now);
    const o = owedBy.get(a.id);
    return { id: a.id, name: a.name, color: a.color, received: n(r?.received), sent: n(r?.sent), medianReplyMin: st.medianReplyMin, withinSla: st.withinSla, slaHours: sla.get(a.id) ?? null, needsReply: o?.c ?? 0, overdue: o?.late ?? 0 };
  });

  const byPerson = new Map<string | null, number[]>();
  for (const t of cur) if (t.mins !== null) byPerson.set(t.by, [...(byPerson.get(t.by) ?? []), t.mins]);
  const userIds = [...byPerson.keys()].filter((x): x is string => !!x);
  const names = userIds.length ? ((await db.execute(sql`select id, name, email from ${schema.users} where id in (${list(userIds)})`)).rows as { id: string; name: string; email: string }[]) : [];
  const people = [...byPerson.entries()]
    .map(([id, ms]) => ({ id, name: id ? (names.find((u) => u.id === id)?.name || names.find((u) => u.id === id)?.email || "Someone") : "Outside Cloudesk", replies: ms.length, medianReplyMin: median(ms) }))
    .sort((a, b) => b.replies - a.replies);

  return {
    range: empty.range,
    totals: {
      received: n(tot?.received), sent: n(tot?.sent), conversations: n(tot?.conversations), autoReplies: n(tot?.auto),
      replied: c.replied, owed: cur.length, replyRate: c.replyRate, medianReplyMin: c.medianReplyMin, p90ReplyMin: c.p90ReplyMin, withinSla: c.withinSla,
      needsReply: owedRows.reduce((a, r) => a + n(r.c), 0), overdue: owedRows.reduce((a, r) => a + n(r.late), 0),
    },
    prev: { received: n(tot?.prev_received), sent: n(tot?.prev_sent), medianReplyMin: p.medianReplyMin, replyRate: p.replyRate },
    daily: dayList.map((day) => ({ day, received: n(byDay.get(day)?.received), sent: n(byDay.get(day)?.sent) })),
    hours,
    replyBuckets,
    categories,
    senders,
    domains,
    mailboxes,
    people,
    oldestWaiting: oldest.map((o) => ({ id: o.id, subject: o.subject, from: o.participants[0]?.name || o.participants[0]?.address || "", since: new Date(o.awaiting_since).toISOString(), waitingMin: Math.round((now - new Date(o.awaiting_since).getTime()) / 60_000), accountId: o.account_id, overdue: !!o.late })),
  };
}
