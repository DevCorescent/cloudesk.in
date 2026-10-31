// Chat's background minute: scheduled messages go out, "remind me" reminders
// arrive, and urgent messages nudge again every 2 minutes for 20 minutes
// until they're read (like a phone ringing until it's picked up).
import { and, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { preview } from "@/lib/chat/text";
import { log } from "../log";
import { notify } from "../notify/notify";
import { postScheduled } from "./core";

const URGENT_EVERY = 2 * 60_000;
const URGENT_FOR = 20 * 60_000;

export async function chatTick(now = new Date()) {
  let posted = 0;
  let reminded = 0;
  let nudged = 0;
  try {
    posted = await postScheduled(now);
    const S = schema.teamSaved;
    const due = await db.select({ userId: S.userId, messageId: S.messageId, orgId: S.orgId }).from(S).where(and(isNotNull(S.remindAt), lte(S.remindAt, now), eq(S.reminded, false))).limit(200);
    for (const r of due) {
      const [m] = await db.select({ body: schema.teamMessages.body, channelId: schema.teamMessages.channelId, name: schema.teamChannels.name, kind: schema.teamChannels.kind }).from(schema.teamMessages).innerJoin(schema.teamChannels, eq(schema.teamChannels.id, schema.teamMessages.channelId)).where(eq(schema.teamMessages.id, r.messageId));
      await db.update(S).set({ reminded: true }).where(and(eq(S.userId, r.userId), eq(S.messageId, r.messageId)));
      if (!m) continue;
      const where = m.kind === "channel" ? `#${m.name}` : "a chat";
      const link = `/chat/${m.channelId}?m=${r.messageId}`;
      await notify(r.orgId, [r.userId], { kind: "chat.reminder", title: `Reminder: a message in ${where}`, body: preview(m.body, 180) || undefined, link, values: { channel: where, text: preview(m.body, 180), link } });
      reminded++;
    }
    // Urgent messages: everyone who hasn't read them yet hears again.
    const X = schema.teamMessages;
    const urgent = await db.select().from(X).where(and(eq(X.priority, "urgent"), isNull(X.deletedAt), isNull(X.scheduledFor), gt(X.createdAt, new Date(now.getTime() - URGENT_FOR)), lte(X.createdAt, new Date(now.getTime() - URGENT_EVERY + 5000)))).limit(50);
    for (const m of urgent) {
      const since = now.getTime() - m.createdAt.getTime();
      // Once per 2-minute step since it was sent.
      if (since % URGENT_EVERY >= 60_000) continue;
      const unread = (await db.execute(sql`select user_id from team_members where channel_id = ${m.channelId} and read_seq < ${m.seq} and user_id <> ${m.authorId ?? sql`'00000000-0000-0000-0000-000000000000'::uuid`} and notify <> 'none'`)).rows as { user_id: string }[];
      if (!unread.length) continue;
      const [c] = await db.select({ name: schema.teamChannels.name, kind: schema.teamChannels.kind }).from(schema.teamChannels).where(eq(schema.teamChannels.id, m.channelId));
      const [a] = m.authorId ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, m.authorId)) : [];
      const link = `/chat/${m.channelId}?m=${m.id}`;
      const where = c?.kind === "channel" ? `#${c.name}` : "a chat";
      await notify(m.orgId, unread.map((u) => u.user_id), { kind: "chat.urgent", title: `Urgent (still unread): ${a?.name ?? "Someone"} in ${where}`, body: preview(m.body, 180) || undefined, link, values: { who: a?.name ?? "", channel: where, text: preview(m.body, 180), link } });
      nudged += unread.length;
    }
  } catch (e) {
    log.warn("chat_tick_failed", { error: (e as Error).message });
  }
  return { posted, reminded, nudged };
}
