// Sender clean-up: who fills the inbox (most mail first), and one action for
// everything from one sender — archive, trash, mark read, block (future mail
// goes to trash) or unsubscribe (and archive what's there). Every action goes
// through the same paths as doing it by hand, so the real mailbox follows.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import type { SendersOut } from "@/lib/mail/api";
import { ApiError } from "../http/errors";
import { accountIds, check, type Scope } from "./access";
import { bulk, setSender, unsubscribe } from "./core";

const list = (ids: string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

export async function topSenders(s: Scope, q: Record<string, string>): Promise<SendersOut> {
  const all = await accountIds(s);
  const ids = q.account && q.account !== "all" ? all.filter((i) => i === q.account) : all;
  if (!ids.length) return { senders: [] };
  const find = (q.q ?? "").trim().toLowerCase().slice(0, 100);
  const rows = (await db.execute(sql`select x.from_address as address, max(x.from_name) as name, count(*)::int as messages,
        count(*) filter (where not x.seen)::int as unread,
        count(distinct x.thread_id) filter (where t.status = 'inbox')::int as in_inbox,
        max(x.date) as last, bool_or(x.list_unsubscribe <> '') as list,
        (select v.verdict from mail_senders v where v.address = x.from_address and v.account_id in (${list(ids)}) limit 1) as verdict
      from mail_messages x join mail_threads t on t.id = x.thread_id
      where x.account_id in (${list(ids)}) and x.direction = 'in' and x.from_address <> '' and t.status <> 'trash'
        ${find ? sql`and (x.from_address ilike ${`%${find.replace(/[%_\\]/g, (m) => `\\${m}`)}%`} or x.from_name ilike ${`%${find.replace(/[%_\\]/g, (m) => `\\${m}`)}%`})` : sql``}
      group by x.from_address order by messages desc, last desc limit 100`)).rows as { address: string; name: string | null; messages: number; unread: number; in_inbox: number; last: string | Date; list: boolean; verdict: string | null }[];
  return {
    senders: rows.map((r) => ({ address: r.address, name: r.name ?? "", messages: Number(r.messages), unread: Number(r.unread), inInbox: Number(r.in_inbox), last: new Date(r.last).toISOString(), list: !!r.list, verdict: (r.verdict ?? null) as SendersOut["senders"][number]["verdict"] })),
  };
}

const cleanupSchema = z.object({ address: z.string().trim().toLowerCase().min(3).max(320), account: z.string().optional(), action: z.enum(["archive", "trash", "read", "block", "unsubscribe"]) });

export async function cleanup(s: Scope, raw: unknown) {
  const v = check(cleanupSchema, raw);
  const all = await accountIds(s);
  const ids = v.account && v.account !== "all" ? all.filter((i) => i === v.account) : all;
  if (!ids.length) return { count: 0 };
  const threads = (await db.execute(sql`select distinct t.id, t.account_id, t.status from mail_threads t join mail_messages x on x.thread_id = t.id
    where t.account_id in (${list(ids)}) and x.direction = 'in' and x.from_address = ${v.address} and t.status <> 'trash'`)).rows as { id: string; account_id: string; status: string }[];
  const tids = threads.map((t) => t.id);
  let unsubscribed = false;
  if (v.action === "unsubscribe") {
    const [latest] = (await db.execute(sql`select x.thread_id from mail_messages x where x.account_id in (${list(ids)}) and x.from_address = ${v.address} and x.list_unsubscribe <> '' order by x.date desc limit 1`)).rows as { thread_id: string }[];
    if (!latest) throw new ApiError("conflict", "This sender doesn't offer an unsubscribe link — block them instead");
    await unsubscribe(s, latest.thread_id);
    unsubscribed = true;
  }
  if (v.action === "block") {
    const accs = [...new Set(threads.map((t) => t.account_id))];
    for (const acc of accs.length ? accs : ids) await setSender(s, { accountId: acc, address: v.address, verdict: "blocked" });
  }
  const action = v.action === "read" ? "read" : v.action === "trash" || v.action === "block" ? "trash" : "archive";
  const targets = action === "archive" ? threads.filter((t) => t.status === "inbox").map((t) => t.id) : tids;
  for (let i = 0; i < targets.length; i += 500) await bulk(s, { ids: targets.slice(i, i + 500), action });
  return { count: targets.length, unsubscribed };
}
