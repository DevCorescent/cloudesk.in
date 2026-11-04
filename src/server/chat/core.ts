// Team chat: conversations (channels, group chats, DMs), messages and
// threads, reactions, interactive messages (polls, checklists, decisions,
// approvals), read state, saved items, search, activity and presence.
import { z } from "zod";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActivityItem, ChannelOut, MessageOut, MetaOut, PageOut, PersonOut } from "@/lib/chat/api";
import { channelPatchSchema, channelSchema, dmKey, editSchema, groupSchema, ONLINE_MS, postSchema, presenceSchema, safeLink, voteSchema, type Status } from "@/lib/chat/model";
import { extract, plain, preview } from "@/lib/chat/text";
import { target } from "@/lib/import/targets";
import { occurrences } from "@/lib/calendar/recur";
import { hasLlm } from "../ai/gateway";
import { ApiError, notFound } from "../http/errors";
import { runImport, str } from "../import/run";
import { notify } from "../notify/notify";
import { channelFor, check, messageFor, type Channel, type ChatScope } from "./access";
import { publish } from "./bus";

const C = schema.teamChannels;
const M = schema.teamMembers;
const X = schema.teamMessages;
const R = schema.teamReactions;
const V = schema.teamVotes;
const F = schema.teamFiles;
const S = schema.teamSaved;
const P = schema.teamPresence;

type Msg = typeof X.$inferSelect;
const live = and(isNull(X.scheduledFor), isNull(X.deletedAt));
/** What shows in the channel itself: top-level messages and replies also sent to the channel. */
const inChannel = or(isNull(X.parentId), sql`(${X.data}->>'alsoToChannel')::boolean is true`);

// Work that every sidebar load would otherwise repeat, kept per process:
// workspaces whose default channels exist, people recently checked for the
// everyone-channels, and who's in a meeting (refreshed every 30 seconds).
const memo = ((globalThis as unknown as { __ccChatMemo?: { defaults: Set<string>; joined: Map<string, number>; meeting: Map<string, { at: number; map: Map<string, string> }> } }).__ccChatMemo ??= { defaults: new Set(), joined: new Map(), meeting: new Map() });
const JOIN_CHECK_MS = 5 * 60_000;
const MEETING_MS = 30_000;

// ── Setup ──────────────────────────────────────────────────────────────────

/** #general (everyone) and #announcements (admins post) — made once, everyone in them. */
export async function ensureDefaults(orgId: string) {
  if (memo.defaults.has(orgId)) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chat-defaults:${orgId}`}))`);
    const [any] = await tx.select({ id: C.id }).from(C).where(and(eq(C.orgId, orgId), eq(C.kind, "channel"))).limit(1);
    if (any) return;
    const people = await tx.select({ userId: schema.memberships.userId, role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
    const owner = people.find((p) => p.role === "owner")?.userId ?? people[0]?.userId ?? null;
    const made = await tx
      .insert(C)
      .values([
        { orgId, kind: "channel", name: "general", topic: "Everyone in the workspace", description: "Company-wide conversation. Everyone is here.", emoji: "💬", color: "#2563eb", settings: { posting: "everyone", ai: true, everyone: true } as never, createdBy: owner },
        { orgId, kind: "channel", name: "announcements", topic: "News from the team — admins post, everyone reads", description: "", emoji: "📣", color: "#ea580c", settings: { posting: "admins", ai: true, everyone: true } as never, createdBy: owner },
      ])
      .returning({ id: C.id });
    for (const ch of made) if (people.length) await tx.insert(M).values(people.map((p) => ({ channelId: ch.id, userId: p.userId, orgId, role: p.role === "owner" || p.role === "admin" ? "admin" : "member" }))).onConflictDoNothing();
  });
  memo.defaults.add(orgId);
}

/** People who joined the workspace later are added to the everyone-channels on their first visit. */
async function joinEveryone(s: ChatScope) {
  const key = `${s.orgId}:${s.userId}`;
  if (Date.now() - (memo.joined.get(key) ?? 0) < JOIN_CHECK_MS) return;
  memo.joined.set(key, Date.now());
  if (memo.joined.size > 50_000) memo.joined.clear();
  const missing = await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), eq(C.kind, "channel"), sql`(${C.settings}->>'everyone')::boolean is true`, sql`not exists (select 1 from team_members m where m.channel_id = ${C.id} and m.user_id = ${s.userId})`, sql`not exists (select 1 from team_messages x where x.channel_id = ${C.id} and x.kind = 'system' and x.data->>'left' = ${s.userId})`));
  if (missing.length) await db.insert(M).values(missing.map((c) => ({ channelId: c.id, userId: s.userId, orgId: s.orgId, role: s.manage ? "admin" : "member" }))).onConflictDoNothing();
}

// ── People & presence ──────────────────────────────────────────────────────

async function people(orgId: string): Promise<PersonOut[]> {
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, status: P.status, note: P.note, emoji: P.emoji, until: P.until, lastSeenAt: P.lastSeenAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(P, and(eq(P.orgId, orgId), eq(P.userId, schema.memberships.userId)))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
  const meeting = await inMeetingNow(orgId, rows.map((r) => r.id));
  const now = Date.now();
  return rows.map((r) => {
    const expired = r.until && r.until.getTime() < now;
    return { id: r.id, name: r.name, email: r.email, status: ((expired ? "available" : r.status) ?? "available") as Status, note: expired ? "" : (r.note ?? ""), emoji: expired ? "" : (r.emoji ?? ""), online: !!r.lastSeenAt && now - r.lastSeenAt.getTime() < ONLINE_MS, inMeeting: meeting.get(r.id) ?? null, lastSeenAt: r.lastSeenAt?.toISOString() ?? null };
  });
}

/** Who is in a meeting right now (from their calendars, repeats included). Calendars are personal, so only the fact is shared, never the event's title. */
async function inMeetingNow(orgId: string, userIds: string[]) {
  const hit = memo.meeting.get(orgId);
  if (hit && Date.now() - hit.at < MEETING_MS) return hit.map;
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  memo.meeting.set(orgId, { at: Date.now(), map: out });
  if (memo.meeting.size > 5_000) memo.meeting.clear();
  const now = Date.now();
  const E = schema.calEvents;
  const rows = await db
    .select({ ownerId: E.ownerId, startsAt: E.startsAt, endsAt: E.endsAt, tz: E.tz, repeat: E.repeat, skip: E.skip })
    .from(E)
    .where(and(eq(E.orgId, orgId), inArray(E.ownerId, userIds), eq(E.allDay, false), ne(E.status, "cancelled"), or(isNull(E.response), ne(E.response, "declined")), or(isNotNull(E.repeat), and(lte(E.startsAt, new Date(now)), gt(E.endsAt, new Date(now))))))
    .catch(() => []);
  for (const e of rows) {
    const dur = e.endsAt.getTime() - e.startsAt.getTime();
    const hits = occurrences(e.startsAt.getTime(), dur, e.tz, (e.repeat as never) ?? null, now - dur, now + 1, e.skip);
    if (hits.some((st) => st <= now && st + dur > now)) out.set(e.ownerId, "In a meeting");
  }
  return out;
}

export async function setPresence(s: ChatScope, raw: unknown) {
  const v = check(presenceSchema, raw);
  const values = { status: v.status, note: v.note, emoji: v.emoji, until: v.until ? new Date(v.until) : null, lastSeenAt: new Date() };
  await db.insert(P).values({ orgId: s.orgId, userId: s.userId, ...values }).onConflictDoUpdate({ target: [P.orgId, P.userId], set: values });
  await publish({ o: s.orgId, t: "p", u: s.userId });
  return { ok: true };
}

/** "I'm here" — sent every minute while Cloudesk is open. */
export async function ping(s: ChatScope) {
  const [before] = await db.select({ at: P.lastSeenAt }).from(P).where(and(eq(P.orgId, s.orgId), eq(P.userId, s.userId)));
  await db.insert(P).values({ orgId: s.orgId, userId: s.userId, lastSeenAt: new Date() }).onConflictDoUpdate({ target: [P.orgId, P.userId], set: { lastSeenAt: new Date() } });
  if (!before?.at || Date.now() - before.at.getTime() > ONLINE_MS) await publish({ o: s.orgId, t: "p", u: s.userId });
  return { ok: true };
}

/** Guests who are (or were) in this workspace's conversations, so their names show on their messages. */
export async function guestPeople(orgId: string, channelIds?: string[]): Promise<PersonOut[]> {
  const G = schema.teamGuests;
  const rows = await db
    .select({ id: G.userId, name: G.name, status: G.status, lastSeenAt: P.lastSeenAt })
    .from(G)
    .leftJoin(P, and(eq(P.orgId, orgId), eq(P.userId, G.userId)))
    .where(and(eq(G.orgId, orgId), inArray(G.status, ["approved", "removed", "left"]), ...(channelIds ? [inArray(G.channelId, channelIds.length ? channelIds : ["00000000-0000-0000-0000-000000000000"])] : [])))
    .orderBy(asc(G.name));
  const now = Date.now();
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ id: r.id, name: r.name, email: "", status: "available" as Status, note: "", emoji: "", online: r.status === "approved" && !!r.lastSeenAt && now - r.lastSeenAt.getTime() < ONLINE_MS, inMeeting: null, lastSeenAt: r.lastSeenAt?.toISOString() ?? null, guest: true }));
}

async function statusOf(orgId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, string>();
  const rows = await db.select({ userId: P.userId, status: P.status, until: P.until }).from(P).where(and(eq(P.orgId, orgId), inArray(P.userId, userIds)));
  return new Map(rows.filter((r) => !r.until || r.until.getTime() > Date.now()).map((r) => [r.userId, r.status]));
}

// ── Conversations ──────────────────────────────────────────────────────────

export async function meta(s: ChatScope): Promise<MetaOut> {
  await ensureDefaults(s.orgId);
  await joinEveryone(s);
  const rows = (
    await db.execute(sql`
    select c.*, m.role as my_role, m.read_seq, m.notify, m.starred, m.hidden, (m.user_id is not null) as is_member,
      (select count(*)::int from team_members mm where mm.channel_id = c.id) as member_count,
      (select array_agg(mm.user_id::text) from team_members mm where mm.channel_id = c.id and mm.user_id <> ${s.userId} and c.kind <> 'channel') as people,
      (select count(*)::int from team_members mm where mm.channel_id = c.id and mm.role = 'guest') as guest_count,
      (select count(*)::int from team_guests g where g.channel_id = c.id and g.status = 'pending' and (m.role in ('owner', 'admin') or ${s.manage})) as requests,
      coalesce(u.unread, 0) as unread, coalesce(u.mentions, 0) as mentions,
      lm.body as last_body, lm.kind as last_kind
    from team_channels c
    left join team_members m on m.channel_id = c.id and m.user_id = ${s.userId}
    left join lateral (
      select x.body, x.kind from team_messages x where x.channel_id = c.id and x.scheduled_for is null and x.deleted_at is null and (x.parent_id is null or (x.data->>'alsoToChannel')::boolean is true) order by x.seq desc limit 1
    ) lm on true
    left join lateral (
      select count(*) filter (where x.parent_id is null or (x.data->>'alsoToChannel')::boolean is true)::int as unread,
             count(*) filter (where x.mentions->'users' ? ${s.userId} or (x.mentions->>'everyone')::boolean is true or c.kind = 'dm')::int as mentions
      from team_messages x where m.user_id is not null and x.channel_id = c.id and x.seq > m.read_seq and x.scheduled_for is null and x.deleted_at is null and x.kind <> 'system' and coalesce(x.author_id::text, '') <> ${s.userId}
    ) u on true
    where c.org_id = ${s.orgId} and (m.user_id is not null or (c.kind = 'channel' and c.visibility = 'public'))
    order by c.last_message_at desc nulls last, c.created_at`)
  ).rows as Record<string, unknown>[];
  const channels: ChannelOut[] = rows.map((r) => {
    const st = (r.settings ?? {}) as { posting?: "everyone" | "admins"; ai?: boolean };
    return {
      id: r.id as string,
      kind: r.kind as ChannelOut["kind"],
      name: r.name as string,
      topic: r.topic as string,
      description: r.description as string,
      visibility: r.visibility as ChannelOut["visibility"],
      emoji: r.emoji as string,
      color: r.color as string,
      avatar: (r.avatar_file_id as string | null) ?? null,
      posting: st.posting ?? "everyone",
      ai: st.ai !== false,
      archived: !!r.archived,
      people: ((r.people as string[] | null) ?? []).slice(0, 50),
      memberCount: Number(r.member_count),
      member: !!r.is_member,
      role: (r.my_role as ChannelOut["role"]) ?? null,
      notify: ((r.notify as ChannelOut["notify"]) ?? "all"),
      starred: !!r.starred,
      unread: r.is_member && r.notify !== "none" ? Number(r.unread) : 0,
      mentions: r.is_member ? Number(r.mentions) : 0,
      lastMessageAt: r.last_message_at ? new Date(r.last_message_at as string).toISOString() : null,
      lastPreview: r.last_body ? preview(r.last_body as string, 80) : r.last_kind && r.last_kind !== "text" ? `[${r.last_kind}]` : "",
      readSeq: Number(r.read_seq ?? 0),
      guests: Number(r.guest_count ?? 0),
      requests: Number(r.requests ?? 0),
    };
  }).filter((c, i) => !rows[i]!.hidden || c.unread > 0);
  const ppl = await people(s.orgId);
  const me = ppl.find((p) => p.id === s.userId);
  const [pres] = await db.select({ until: P.until }).from(P).where(and(eq(P.orgId, s.orgId), eq(P.userId, s.userId)));
  const [saved] = await db.select({ n: sql<number>`count(*)::int` }).from(S).where(and(eq(S.userId, s.userId), eq(S.orgId, s.orgId), eq(S.done, false)));
  const member = channels.filter((c) => c.member);
  return {
    me: { id: s.userId, name: s.userName, email: s.userEmail, status: me?.status ?? "available", note: me?.note ?? "", emoji: me?.emoji ?? "", until: pres?.until && pres.until.getTime() > Date.now() ? pres.until.toISOString() : null, admin: s.manage },
    channels,
    people: ppl,
    guests: await guestPeople(s.orgId, channels.map((c) => c.id)),
    counts: { unread: member.reduce((a, c) => a + c.unread, 0), mentions: member.reduce((a, c) => a + c.mentions, 0), saved: Number(saved?.n ?? 0), activity: member.reduce((a, c) => a + c.mentions, 0), requests: channels.reduce((a, c) => a + c.requests, 0) },
    ai: await hasLlm(s.orgId),
  };
}

async function system(c: Channel, by: string | null, body: string, data: Record<string, unknown> = {}) {
  const [m] = await db.insert(X).values({ orgId: c.orgId, channelId: c.id, authorId: by, kind: "system", body, data }).returning();
  await db.update(C).set({ lastMessageAt: new Date() }).where(eq(C.id, c.id));
  await publish({ o: c.orgId, t: "m", ch: c.id, id: m!.id, seq: m!.seq, u: by ?? undefined, n: 1 });
  return m!;
}

async function orgMembers(orgId: string, ids: string[]) {
  if (!ids.length) return [];
  return (await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), inArray(schema.memberships.userId, ids)))).map((r) => r.id);
}

export async function createChannel(s: ChatScope, raw: unknown) {
  const v = check(channelSchema, raw);
  const nm = v.name.trim().toLowerCase().replace(/\s+/g, "-");
  const [dup] = await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), eq(C.kind, "channel"), sql`lower(${C.name}) = ${nm}`));
  if (dup) throw new ApiError("conflict", `There's already a #${nm}`, { name: ["Already used"] });
  const [c] = await db.insert(C).values({ orgId: s.orgId, kind: "channel", name: nm, topic: v.topic, description: v.description, visibility: v.visibility, emoji: v.emoji, color: v.color, settings: { posting: v.posting, ai: v.ai }, createdBy: s.userId }).returning();
  const others = (await orgMembers(s.orgId, v.members)).filter((u) => u !== s.userId);
  await db.insert(M).values([{ channelId: c!.id, userId: s.userId, orgId: s.orgId, role: "owner" }, ...others.map((u) => ({ channelId: c!.id, userId: u, orgId: s.orgId, role: "member" }))]);
  await system(c!, s.userId, `${s.userName} created #${nm}${others.length ? ` and added ${others.length} ${others.length === 1 ? "person" : "people"}` : ""}`);
  await publish({ o: s.orgId, t: "c", ch: c!.id });
  return { channel: { id: c!.id } };
}

export async function updateChannel(s: ChatScope, id: string, raw: unknown) {
  const { c } = await channelFor(s, id, "admin");
  const v = check(channelPatchSchema, raw);
  if (c.kind === "dm" && (v.name || v.visibility)) throw new ApiError("validation_failed", "Direct messages can't be renamed");
  const nm = v.name ? v.name.trim().toLowerCase().replace(/\s+/g, "-") : undefined;
  if (nm && c.kind === "channel" && nm !== c.name) {
    const [dup] = await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), eq(C.kind, "channel"), sql`lower(${C.name}) = ${nm}`, ne(C.id, c.id)));
    if (dup) throw new ApiError("conflict", `There's already a #${nm}`, { name: ["Already used"] });
  }
  const settings = { ...c.settings, ...(v.posting ? { posting: v.posting } : {}), ...(v.ai !== undefined ? { ai: v.ai } : {}) };
  // A picture: an image uploaded to this conversation. Direct messages show the other person instead.
  if (v.avatarFileId !== undefined) {
    if (c.kind === "dm") throw new ApiError("validation_failed", "Direct messages show the other person's picture");
    if (v.avatarFileId) {
      const [f] = await db.select({ mime: F.mime }).from(F).where(and(eq(F.id, v.avatarFileId), eq(F.channelId, c.id)));
      if (!f) throw notFound("File");
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) throw new ApiError("validation_failed", "Use a PNG, JPG, GIF or WebP image", { avatarFileId: ["Not an image"] });
    }
  }
  await db
    .update(C)
    .set({ ...(nm ? { name: c.kind === "channel" ? nm : v.name! } : {}), ...(v.topic !== undefined ? { topic: v.topic } : {}), ...(v.description !== undefined ? { description: v.description } : {}), ...(v.visibility && c.kind === "channel" ? { visibility: v.visibility } : {}), ...(v.emoji !== undefined ? { emoji: v.emoji } : {}), ...(v.color ? { color: v.color } : {}), ...(v.archived !== undefined ? { archived: v.archived } : {}), ...(v.avatarFileId !== undefined ? { avatarFileId: v.avatarFileId } : {}), settings })
    .where(eq(C.id, c.id));
  const what = c.kind === "group" ? "group" : "channel";
  const said = v.avatarFileId !== undefined && v.avatarFileId !== c.avatarFileId ? (v.avatarFileId ? `changed the ${what} picture` : `removed the ${what} picture`) : v.archived === true ? "archived the channel" : v.archived === false ? "brought the channel back" : nm && nm !== c.name ? `renamed it to ${c.kind === "channel" ? "#" : ""}${nm}` : v.topic !== undefined && v.topic !== c.topic ? `set the topic: ${v.topic || "(none)"}` : null;
  if (said) await system(c, s.userId, `${s.userName} ${said}`);
  await publish({ o: s.orgId, t: "c", ch: c.id });
  return { ok: true };
}

export async function join(s: ChatScope, id: string) {
  const { c, m } = await channelFor(s, id, "read");
  if (m) return { ok: true };
  if (c.archived) throw new ApiError("conflict", "This channel is archived");
  await db.insert(M).values({ channelId: c.id, userId: s.userId, orgId: s.orgId, role: "member" }).onConflictDoNothing();
  await system(c, s.userId, `${s.userName} joined`);
  return { ok: true };
}

export async function leave(s: ChatScope, id: string) {
  const { c, m } = await channelFor(s, id, "read");
  if (!m) return { ok: true };
  if (c.kind === "dm") throw new ApiError("conflict", "You can hide a direct message, not leave it");
  if (m.role === "owner") {
    const [other] = await db.select({ userId: M.userId }).from(M).where(and(eq(M.channelId, c.id), ne(M.userId, s.userId), ne(M.role, "guest"))).orderBy(sql`case role when 'admin' then 0 else 1 end`, M.joinedAt).limit(1);
    if (other) await db.update(M).set({ role: "owner" }).where(and(eq(M.channelId, c.id), eq(M.userId, other.userId)));
  }
  await db.delete(M).where(and(eq(M.channelId, c.id), eq(M.userId, s.userId)));
  if (s.guest) await db.update(schema.teamGuests).set({ status: "left" }).where(eq(schema.teamGuests.id, s.guest.id));
  await system(c, s.userId, `${s.userName} left`, { left: s.userId });
  if (s.guest) await publish({ o: s.orgId, t: "c", ch: c.id });
  return { ok: true };
}

export async function addMembers(s: ChatScope, id: string, raw: unknown) {
  const { c, m } = await channelFor(s, id, "read");
  if (!m) throw new ApiError("forbidden", "Join first to add people");
  if (c.kind === "dm") throw new ApiError("conflict", "Start a group chat to talk with more people");
  if (c.kind === "channel" && c.visibility === "private" && m.role === "member" && !s.manage) throw new ApiError("forbidden", "Only the channel's admins add people to a private channel");
  const ids = await orgMembers(s.orgId, check(groupSchema.pick({ users: true }), raw).users);
  const existing = new Set((await db.select({ u: M.userId }).from(M).where(eq(M.channelId, c.id))).map((r) => r.u));
  const fresh = ids.filter((u) => !existing.has(u));
  if (!fresh.length) return { added: 0 };
  await db.insert(M).values(fresh.map((u) => ({ channelId: c.id, userId: u, orgId: s.orgId, role: "member" }))).onConflictDoNothing();
  const names = await db.select({ name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, fresh));
  await system(c, s.userId, `${s.userName} added ${names.map((n) => n.name).join(", ")}`);
  await publish({ o: s.orgId, t: "c", ch: c.id });
  await notify(s.orgId, fresh, { kind: "chat.mention", title: `${s.userName} added you to ${label(c)}`, body: c.topic || undefined, link: `/chat/${c.id}`, values: { who: s.userName, channel: label(c), text: "", link: `/chat/${c.id}` } });
  return { added: fresh.length };
}

export async function removeMember(s: ChatScope, id: string, userId: string) {
  if (userId === s.userId) return leave(s, id);
  const { c } = await channelFor(s, id, "admin");
  if (c.kind === "dm") throw new ApiError("conflict", "Not in a direct message");
  const [was] = await db.delete(M).where(and(eq(M.channelId, c.id), eq(M.userId, userId))).returning({ role: M.role });
  if (was?.role === "guest") await db.update(schema.teamGuests).set({ status: "removed", decidedBy: s.userId, decidedAt: new Date() }).where(and(eq(schema.teamGuests.channelId, c.id), eq(schema.teamGuests.userId, userId), eq(schema.teamGuests.status, "approved")));
  const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  await system(c, s.userId, `${s.userName} removed ${u?.name ?? "someone"}${was?.role === "guest" ? " (guest)" : ""}`, { left: userId });
  if (was?.role === "guest") await publish({ o: s.orgId, t: "c", ch: c.id });
  return { ok: true };
}

export async function setRole(s: ChatScope, id: string, userId: string, role: string) {
  const { c } = await channelFor(s, id, "admin");
  if (!["admin", "member"].includes(role)) throw new ApiError("validation_failed", "Admin or member");
  await db.update(M).set({ role }).where(and(eq(M.channelId, c.id), eq(M.userId, userId), ne(M.role, "owner"), ne(M.role, "guest")));
  return { ok: true };
}

/** Your own settings for a conversation: notifications, star, hide. */
export async function prefs(s: ChatScope, id: string, raw: unknown) {
  const { m } = await channelFor(s, id, "read");
  if (!m) throw new ApiError("forbidden", "Join first");
  const v = check(z.object({ notify: z.enum(["all", "mentions", "none"]).optional(), starred: z.boolean().optional(), hidden: z.boolean().optional() }), raw);
  await db.update(M).set(v).where(and(eq(M.channelId, id), eq(M.userId, s.userId)));
  return { ok: true };
}

/** The direct message with this person (made the first time). */
export async function openDm(s: ChatScope, userId: string) {
  const [ok] = await orgMembers(s.orgId, [userId]);
  if (!ok) throw notFound("Person");
  const key = dmKey(s.userId, userId);
  const [found] = await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), eq(C.dmKey, key)));
  if (found) {
    await db.update(M).set({ hidden: false }).where(and(eq(M.channelId, found.id), eq(M.userId, s.userId)));
    return { channel: { id: found.id } };
  }
  const [c] = await db.insert(C).values({ orgId: s.orgId, kind: "dm", visibility: "private", dmKey: key, createdBy: s.userId }).onConflictDoNothing().returning();
  const id = c?.id ?? (await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), eq(C.dmKey, key))))[0]!.id;
  await db.insert(M).values([...new Set([s.userId, userId])].map((u) => ({ channelId: id, userId: u, orgId: s.orgId, role: "member" }))).onConflictDoNothing();
  await publish({ o: s.orgId, t: "c", ch: id });
  return { channel: { id } };
}

export async function createGroup(s: ChatScope, raw: unknown) {
  const v = check(groupSchema, raw);
  const ids = (await orgMembers(s.orgId, v.users)).filter((u) => u !== s.userId);
  if (!ids.length) throw new ApiError("validation_failed", "Pick someone", { users: ["Pick someone"] });
  if (ids.length === 1 && !v.name) return openDm(s, ids[0]!);
  const [c] = await db.insert(C).values({ orgId: s.orgId, kind: "group", name: v.name, visibility: "private", createdBy: s.userId }).returning();
  await db.insert(M).values([{ channelId: c!.id, userId: s.userId, orgId: s.orgId, role: "owner" }, ...ids.map((u) => ({ channelId: c!.id, userId: u, orgId: s.orgId, role: "member" }))]);
  await system(c!, s.userId, `${s.userName} started the group chat`);
  await publish({ o: s.orgId, t: "c", ch: c!.id });
  return { channel: { id: c!.id } };
}

export async function members(s: ChatScope, id: string) {
  await channelFor(s, id, "read");
  const rows = await db.select({ userId: M.userId, role: M.role, joinedAt: M.joinedAt }).from(M).where(eq(M.channelId, id)).orderBy(sql`case role when 'owner' then 0 when 'admin' then 1 else 2 end`, M.joinedAt);
  return { members: rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() })) };
}

const label = (c: Pick<Channel, "kind" | "name">) => (c.kind === "channel" ? `#${c.name}` : c.kind === "group" ? c.name || "your group chat" : "a direct message");

// ── Messages ───────────────────────────────────────────────────────────────

async function hydrate(s: ChatScope, rows: Msg[]): Promise<MessageOut[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [reacts, votes, files, saved, repliers, fwd] = await Promise.all([
    db.select().from(R).where(inArray(R.messageId, ids)).orderBy(R.createdAt),
    db.select().from(V).where(inArray(V.messageId, ids)).orderBy(V.createdAt),
    db.select({ id: F.id, messageId: F.messageId, filename: F.filename, mime: F.mime, size: F.size }).from(F).where(inArray(F.messageId, ids)),
    db.select({ messageId: S.messageId }).from(S).where(and(eq(S.userId, s.userId), inArray(S.messageId, ids))),
    db.execute(sql`select parent_id, array_agg(distinct author_id::text) as people from team_messages where parent_id in ${sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`} and deleted_at is null and scheduled_for is null group by parent_id`),
    (async () => {
      const src = rows.map((r) => r.forwardedFrom).filter((x): x is string => !!x);
      if (!src.length) return [];
      return db.select({ id: X.id, authorId: X.authorId, channel: C.name, kind: C.kind }).from(X).innerJoin(C, eq(C.id, X.channelId)).where(inArray(X.id, src));
    })(),
  ]);
  const savedSet = new Set(saved.map((x) => x.messageId));
  const rep = new Map(((repliers as unknown as { rows: { parent_id: string; people: string[] }[] }).rows).map((r) => [r.parent_id, r.people]));
  return rows.map((m) => {
    const anon = m.kind === "poll" && (m.data as { anonymous?: boolean }).anonymous;
    const byEmoji = new Map<string, string[]>();
    for (const r of reacts) if (r.messageId === m.id) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.userId]);
    const f = fwd.find((x) => x.id === m.forwardedFrom);
    return {
      id: m.id,
      seq: m.seq,
      channelId: m.channelId,
      parentId: m.parentId,
      authorId: m.authorId,
      kind: m.deletedAt ? "deleted" : m.kind,
      body: m.deletedAt ? "" : m.body,
      data: m.deletedAt ? {} : m.data,
      mentions: m.deletedAt ? { users: [], everyone: false, records: [] } : m.mentions,
      tags: m.tags,
      priority: m.priority as MessageOut["priority"],
      replyCount: m.replyCount,
      lastReplyAt: m.lastReplyAt?.toISOString() ?? null,
      replyPeople: (rep.get(m.id) ?? []).slice(0, 5),
      reactions: [...byEmoji].map(([emoji, users]) => ({ emoji, users })),
      votes: votes.filter((v) => v.messageId === m.id).map((v) => ({ choice: v.choice, userId: anon && v.userId !== s.userId ? "" : v.userId, note: v.note, at: v.createdAt.toISOString() })),
      files: m.deletedAt ? [] : files.filter((x) => x.messageId === m.id).map((x) => ({ id: x.id, filename: x.filename, mime: x.mime, size: x.size })),
      editedAt: m.editedAt?.toISOString() ?? null,
      deleted: !!m.deletedAt,
      pinned: !!m.pinnedAt,
      saved: savedSet.has(m.id),
      scheduledFor: m.scheduledFor?.toISOString() ?? null,
      forwardedFrom: f ? { channel: f.kind === "channel" ? `#${f.channel}` : f.kind === "group" ? f.channel || "a group chat" : "a direct message", author: f.authorId } : null,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

/** A page of the channel (or a thread): newest 50, or before/after a seq, or around a message. */
export async function page(s: ChatScope, id: string, q: Record<string, string>): Promise<PageOut> {
  const { c } = await channelFor(s, id, "read");
  const n = Math.min(100, Math.max(10, Number(q.limit) || 50));
  const thread = q.thread && /^[0-9a-f-]{36}$/i.test(q.thread) ? q.thread : null;
  const where: SQL[] = [eq(X.channelId, c.id), or(isNull(X.scheduledFor), eq(X.authorId, s.userId))!];
  if (thread) where.push(or(eq(X.id, thread), eq(X.parentId, thread))!);
  else where.push(inChannel!);
  if (s.guest && !s.guest.history) where.push(gt(X.seq, s.guest.since));
  let rows: Msg[];
  if (q.around && /^[0-9a-f-]{36}$/i.test(q.around)) {
    const [t] = await db.select({ seq: X.seq }).from(X).where(and(eq(X.id, q.around), eq(X.channelId, c.id)));
    const at = t?.seq ?? 0;
    const before = await db.select().from(X).where(and(...where, lte(X.seq, at))).orderBy(desc(X.seq)).limit(n / 2);
    const after = await db.select().from(X).where(and(...where, gt(X.seq, at))).orderBy(asc(X.seq)).limit(n / 2);
    rows = [...before.reverse(), ...after];
  } else if (q.after) {
    rows = await db.select().from(X).where(and(...where, gt(X.seq, Number(q.after)))).orderBy(asc(X.seq)).limit(n);
  } else {
    rows = (await db.select().from(X).where(and(...where, ...(q.before ? [lt(X.seq, Number(q.before))] : []))).orderBy(desc(X.seq)).limit(n + 1)).reverse();
  }
  const hasMore = !q.after && !q.around && rows.length > n;
  if (hasMore) rows = rows.slice(1);
  // Scheduled ones (yours) sit at the end.
  rows.sort((a, b) => (a.scheduledFor ? 1 : 0) - (b.scheduledFor ? 1 : 0) || a.seq - b.seq);
  const reads = c.kind !== "channel" ? await db.select({ u: M.userId, seq: M.readSeq }).from(M).where(eq(M.channelId, c.id)) : [];
  return { messages: await hydrate(s, rows), hasMore, readSeqs: Object.fromEntries(reads.map((r) => [r.u, r.seq])) };
}

export async function one(s: ChatScope, id: string) {
  const { msg } = await messageFor(s, id);
  return { message: (await hydrate(s, [msg]))[0]! };
}

const optionIds = (xs: { id: string }[]) => new Set(xs.map((x) => x.id)).size === xs.length;

export async function post(s: ChatScope, channelId: string, raw: unknown) {
  const { c } = await channelFor(s, channelId, "post");
  const v = check(postSchema, raw);
  const structured = v.poll ?? v.checklist ?? v.decision ?? v.approval ?? v.record ?? v.call ?? v.event;
  const body = v.body.trim();
  if (!body && !structured && !v.files.length) throw new ApiError("validation_failed", "Write something first", { body: ["Empty"] });
  let parent: Msg | null = null;
  if (v.parentId) {
    [parent] = await db.select().from(X).where(and(eq(X.id, v.parentId), eq(X.channelId, c.id)));
    if (!parent || parent.deletedAt) throw notFound("Message");
    if (parent.parentId) parent = (await db.select().from(X).where(eq(X.id, parent.parentId)))[0] ?? parent;
  }
  const sched = v.scheduledFor ? new Date(v.scheduledFor) : null;
  if (sched && sched.getTime() < Date.now() + 30_000) throw new ApiError("validation_failed", "Pick a time in the future", { scheduledFor: ["In the past"] });
  if (sched && sched.getTime() > Date.now() + 120 * 86_400_000) throw new ApiError("validation_failed", "Up to 120 days ahead", { scheduledFor: ["Too far"] });

  // What it is, and its interactive data.
  let kind = "text";
  let data: Record<string, unknown> = {};
  if (v.poll) {
    if (!optionIds(v.poll.options)) throw new ApiError("validation_failed", "Each choice needs its own id");
    kind = "poll";
    data = { ...v.poll, closed: false };
  } else if (v.checklist) {
    if (!optionIds(v.checklist.items)) throw new ApiError("validation_failed", "Each item needs its own id");
    kind = "checklist";
    data = v.checklist;
  } else if (v.decision) {
    kind = "decision";
    data = { ...v.decision, state: "proposed" };
  } else if (v.approval) {
    const approvers = (await channelMembers(c.id)).filter((u) => v.approval!.approvers.includes(u));
    if (!approvers.length) throw new ApiError("validation_failed", "Approvers must be in this conversation", { approvers: ["Not here"] });
    kind = "approval";
    data = { ...v.approval, approvers, state: "pending" };
  } else if (v.record) {
    kind = "record";
    data = { ...v.record, link: safeLink(v.record.link) };
  } else if (v.call) {
    kind = "call";
    // A real meeting room on Jitsi Meet (free, no account): the name is long and random, so it can't be guessed.
    const room = `Cloudesk-${crypto.randomUUID().replace(/-/g, "")}`;
    data = { title: v.call.title || `Call in ${label(c)}`, url: `https://meet.jit.si/${room}`, startedBy: s.userId };
  } else if (v.event) {
    if (new Date(v.event.end) <= new Date(v.event.start)) throw new ApiError("validation_failed", "It ends before it starts");
    kind = "event";
    data = { ...v.event, meetingUrl: /^https:\/\//.test(v.event.meetingUrl) ? v.event.meetingUrl : "" };
  }
  if (parent && v.alsoToChannel) data = { ...data, alsoToChannel: true };

  const ex = extract(body);
  const allowed = new Set([...(c.kind === "channel" && c.visibility === "public" ? await orgMembers(s.orgId, ex.users) : []), ...(await channelMembers(c.id)).filter((u) => ex.users.includes(u))]);
  const records = ex.records.map((r) => ({ ...r, link: safeLink(v.records.find((x) => x.kind === r.kind && x.id === r.id)?.link ?? "") }));
  const everyone = ex.everyone && c.kind !== "dm" && !s.guest;
  if (everyone && c.kind === "channel" && c.settings.posting !== "everyone" && !s.manage) throw new ApiError("forbidden", "Only admins can notify everyone here");
  const [msg] = await db
    .insert(X)
    .values({ orgId: s.orgId, channelId: c.id, parentId: parent?.id ?? null, authorId: s.userId, kind, body, data, mentions: { users: [...allowed], everyone, records }, tags: ex.tags, priority: v.priority, scheduledFor: sched })
    .returning();
  if (v.files.length) await db.update(F).set({ messageId: msg!.id }).where(and(inArray(F.id, v.files), eq(F.channelId, c.id), eq(F.uploadedBy, s.userId), isNull(F.messageId)));
  if (sched) return { message: (await hydrate(s, [msg!]))[0]!, notInChannel: ex.users.filter((u) => !allowed.has(u)) };
  await afterPost(s, c, msg!, parent);
  return { message: (await hydrate(s, [msg!]))[0]!, notInChannel: ex.users.filter((u) => !allowed.has(u)) };
}

async function channelMembers(channelId: string) {
  return (await db.select({ u: M.userId }).from(M).where(eq(M.channelId, channelId))).map((r) => r.u);
}

/** Counts, read state, live update and notifications once a message is out. */
export async function afterPost(s: Pick<ChatScope, "orgId" | "userId" | "userName">, c: Channel, msg: Msg, parent: Msg | null) {
  if (parent) await db.update(X).set({ replyCount: sql`${X.replyCount} + 1`, lastReplyAt: new Date() }).where(eq(X.id, parent.id));
  await db.update(C).set({ lastMessageAt: new Date() }).where(eq(C.id, c.id));
  // Hidden DMs come back when someone writes.
  if (c.kind !== "channel") await db.update(M).set({ hidden: false }).where(eq(M.channelId, c.id));
  if (!parent || (msg.data as { alsoToChannel?: boolean }).alsoToChannel) await db.update(M).set({ readSeq: msg.seq }).where(and(eq(M.channelId, c.id), eq(M.userId, s.userId), lt(M.readSeq, msg.seq)));
  await publish({ o: s.orgId, t: "m", ch: c.id, id: msg.id, seq: msg.seq, thread: parent?.id ?? null, u: msg.authorId ?? undefined, n: 1, me: msg.mentions.everyone ? ["*"] : msg.mentions.users.length > 40 ? ["?"] : msg.mentions.users });
  await fanout(s, c, msg, parent);
}

/** Who hears about it, respecting each person's channel setting and Do not disturb (urgent always gets through). */
async function fanout(s: Pick<ChatScope, "orgId" | "userId" | "userName">, c: Channel, msg: Msg, parent: Msg | null) {
  const mems = await db.select({ u: M.userId, notify: M.notify }).from(M).where(eq(M.channelId, c.id));
  const pref = new Map(mems.map((m) => [m.u, m.notify]));
  const text = preview(msg.body || describe(msg), 180);
  const link = `/chat/${c.id}?m=${msg.id}${parent ? `&t=${parent.id}` : ""}`;
  const urgent = msg.priority === "urgent";
  const head = urgent ? "Urgent: " : msg.priority === "important" ? "Important: " : "";
  const sent = new Set<string>([s.userId]);
  const status = await statusOf(s.orgId, [...pref.keys(), ...msg.mentions.users]);
  const quiet = (u: string) => !urgent && status.get(u) === "dnd";
  const tell = async (ids: string[], kind: "chat.mention" | "chat.dm" | "chat.reply" | "chat.urgent", title: string) => {
    const to = ids.filter((u) => !sent.has(u) && !quiet(u));
    to.forEach((u) => sent.add(u));
    if (to.length) await notify(s.orgId, to, { kind: urgent ? "chat.urgent" : kind, title: `${head}${title}`, body: text, link, values: { who: s.userName, channel: label(c), text, link } });
  };
  // Mentions always reach the person (unless they turned the conversation off entirely).
  await tell(msg.mentions.users.filter((u) => pref.get(u) !== "none"), "chat.mention", `${s.userName} mentioned you in ${label(c)}`);
  if (msg.mentions.everyone) await tell(mems.filter((m) => m.notify !== "none").map((m) => m.u), "chat.mention", `${s.userName} in ${label(c)}`);
  if (c.kind !== "channel") await tell(mems.filter((m) => m.notify === "all").map((m) => m.u), "chat.dm", c.kind === "dm" ? s.userName : `${s.userName} in ${label(c)}`);
  if (parent) {
    const inThread = [parent.authorId, ...(await db.selectDistinct({ a: X.authorId }).from(X).where(eq(X.parentId, parent.id))).map((r) => r.a)].filter((u): u is string => !!u && pref.has(u) && pref.get(u) !== "none");
    await tell(inThread, "chat.reply", `${s.userName} replied in ${label(c)}`);
  }
  if (urgent) await tell(mems.map((m) => m.u), "chat.urgent", `${s.userName} in ${label(c)}`);
  if (msg.kind === "approval") {
    const d = msg.data as { title: string; approvers: string[] };
    await notify(s.orgId, d.approvers.filter((u) => u !== s.userId), { kind: "chat.approval", title: `${s.userName} asks you to approve: ${d.title}`, body: label(c), link, values: { who: s.userName, title: d.title, link } });
  }
}

const describe = (m: Pick<Msg, "kind" | "data">) => {
  const d = m.data as Record<string, string>;
  return m.kind === "poll" ? `Poll: ${d.question}` : m.kind === "checklist" ? `Checklist: ${d.title}` : m.kind === "decision" ? `Decision: ${d.text}` : m.kind === "approval" ? `Approval: ${d.title}` : m.kind === "record" ? `${d.title}${d.sub ? ` · ${d.sub}` : ""}` : m.kind === "call" ? `📞 ${d.title}` : m.kind === "event" ? `📅 ${d.title}` : "";
};

export async function edit(s: ChatScope, id: string, raw: unknown) {
  const { msg, c } = await messageFor(s, id, "read");
  if (msg.authorId !== s.userId) throw new ApiError("forbidden", "You can only edit your own messages");
  if (msg.deletedAt) throw new ApiError("conflict", "This message was deleted");
  if (!["text", "decision"].includes(msg.kind)) throw new ApiError("conflict", "This kind of message can't be edited");
  const v = check(editSchema, raw);
  const ex = extract(v.body);
  const allowed = [...new Set([...(c.kind === "channel" && c.visibility === "public" ? await orgMembers(s.orgId, ex.users) : []), ...(await channelMembers(c.id)).filter((u) => ex.users.includes(u))])];
  const records = ex.records.map((r) => ({ ...r, link: safeLink(v.records.find((x) => x.kind === r.kind && x.id === r.id)?.link ?? msg.mentions.records.find((x) => x.kind === r.kind && x.id === r.id)?.link ?? "") }));
  const [m] = await db.update(X).set({ body: v.body, editedAt: msg.scheduledFor ? null : new Date(), mentions: { users: allowed, everyone: ex.everyone && c.kind !== "dm" && !s.guest, records }, tags: ex.tags }).where(eq(X.id, msg.id)).returning();
  if (!msg.scheduledFor) {
    await publish({ o: s.orgId, t: "m", ch: c.id, id: msg.id, thread: msg.parentId });
    const added = allowed.filter((u) => !msg.mentions.users.includes(u) && u !== s.userId);
    if (added.length) await notify(s.orgId, added, { kind: "chat.mention", title: `${s.userName} mentioned you in ${label(c)}`, body: preview(v.body, 180), link: `/chat/${c.id}?m=${msg.id}`, values: { who: s.userName, channel: label(c), text: preview(v.body, 180), link: `/chat/${c.id}?m=${msg.id}` } });
  }
  return { message: (await hydrate(s, [m!]))[0]! };
}

export async function remove(s: ChatScope, id: string) {
  const { msg, c, m } = await messageFor(s, id, "read");
  const admin = m?.role === "owner" || m?.role === "admin" || s.manage;
  if (msg.authorId !== s.userId && !admin) throw new ApiError("forbidden", "You can only delete your own messages");
  if (msg.scheduledFor) {
    await db.delete(X).where(eq(X.id, msg.id));
    return { ok: true };
  }
  await db.update(X).set({ deletedAt: new Date(), body: "", data: {}, pinnedAt: null }).where(eq(X.id, msg.id));
  await db.delete(F).where(eq(F.messageId, msg.id));
  if (msg.parentId) await db.update(X).set({ replyCount: sql`greatest(${X.replyCount} - 1, 0)` }).where(eq(X.id, msg.parentId));
  await publish({ o: s.orgId, t: "m", ch: c.id, id: msg.id, thread: msg.parentId });
  return { ok: true };
}

export async function react(s: ChatScope, id: string, raw: unknown) {
  const { msg, c, m } = await messageFor(s, id, "read");
  if (!m) throw new ApiError("forbidden", "Join to react");
  const v = check(z.object({ emoji: z.string().min(1).max(16), on: z.boolean().default(true) }), raw);
  if (v.on) {
    const [n] = await db.select({ n: sql<number>`count(distinct ${R.emoji})::int` }).from(R).where(eq(R.messageId, msg.id));
    if (Number(n?.n) >= 20) throw new ApiError("conflict", "That's plenty of reactions");
    await db.insert(R).values({ messageId: msg.id, userId: s.userId, emoji: v.emoji }).onConflictDoNothing();
  } else await db.delete(R).where(and(eq(R.messageId, msg.id), eq(R.userId, s.userId), eq(R.emoji, v.emoji)));
  await publish({ o: s.orgId, t: "m", ch: c.id, id: msg.id, thread: msg.parentId });
  return { ok: true };
}

export async function pin(s: ChatScope, id: string, on: boolean) {
  const { msg, c, m } = await messageFor(s, id, "read");
  if (!m) throw new ApiError("forbidden", "Join to pin");
  if (msg.deletedAt) throw new ApiError("conflict", "This message was deleted");
  await db.update(X).set(on ? { pinnedAt: new Date(), pinnedBy: s.userId } : { pinnedAt: null, pinnedBy: null }).where(eq(X.id, msg.id));
  if (on) await system(c, s.userId, `${s.userName} pinned a message`, { pinned: msg.id });
  else await publish({ o: s.orgId, t: "m", ch: c.id, id: msg.id });
  return { ok: true };
}

/** Answer a poll, tick a checklist item, agree or object to a decision, approve or reject. */
export async function vote(s: ChatScope, id: string, raw: unknown) {
  const { msg, c, m } = await messageFor(s, id, "read");
  if (!m) throw new ApiError("forbidden", "Join to take part");
  if (msg.deletedAt) throw new ApiError("conflict", "This message was deleted");
  const v = check(voteSchema, raw);
  const d = msg.data as Record<string, unknown>;
  const mine = and(eq(V.messageId, msg.id), eq(V.userId, s.userId));
  if (msg.kind === "poll") {
    const p = d as { options: { id: string }[]; multi: boolean; closed: boolean; closesAt: string | null };
    if (p.closed || (p.closesAt && new Date(p.closesAt).getTime() < Date.now())) throw new ApiError("conflict", "This poll is closed");
    if (!p.options.some((o) => o.id === v.choice)) throw new ApiError("validation_failed", "Not one of the choices");
    if (!p.multi) await db.delete(V).where(mine);
    if (v.on) await db.insert(V).values({ messageId: msg.id, userId: s.userId, choice: v.choice }).onConflictDoNothing();
    else await db.delete(V).where(and(mine, eq(V.choice, v.choice)));
  } else if (msg.kind === "checklist") {
    if (!(d.items as { id: string }[]).some((o) => o.id === v.choice)) throw new ApiError("validation_failed", "Not on the list");
    // A tick is shared: whoever ticks it, it's done (and anyone can untick).
    if (v.on) {
      const [done] = await db.select({ u: V.userId }).from(V).where(and(eq(V.messageId, msg.id), eq(V.choice, v.choice)));
      if (!done) await db.insert(V).values({ messageId: msg.id, userId: s.userId, choice: v.choice });
    } else await db.delete(V).where(and(eq(V.messageId, msg.id), eq(V.choice, v.choice)));
  } else if (msg.kind === "decision") {
    if (d.state !== "proposed") throw new ApiError("conflict", "This has already been decided");
    if (!["agree", "object", "abstain"].includes(v.choice)) throw new ApiError("validation_failed", "Agree, object or abstain");
    await db.delete(V).where(mine);
    if (v.on) await db.insert(V).values({ messageId: msg.id, userId: s.userId, choice: v.choice, note: v.note });
  } else if (msg.kind === "approval") {
    const a = d as { approvers: string[]; state: string; title: string };
    if (!a.approvers.includes(s.userId)) throw new ApiError("forbidden", "You're not one of the approvers");
    if (a.state !== "pending") throw new ApiError("conflict", `Already ${a.state}`);
    if (!["approve", "reject"].includes(v.choice)) throw new ApiError("validation_failed", "Approve or reject");
    if (v.choice === "reject" && !v.note) throw new ApiError("validation_failed", "Say why it's rejected", { note: ["A reason helps"] });
    await db.insert(V).values({ messageId: msg.id, userId: s.userId, choice: v.choice, note: v.note }).onConflictDoNothing();
    const state = v.choice === "approve" ? "approved" : "rejected";
    await db.update(X).set({ data: { ...d, state, decidedBy: s.userId, decidedAt: new Date().toISOString() } }).where(eq(X.id, msg.id));
    const [reply] = await db.insert(X).values({ orgId: s.orgId, channelId: c.id, parentId: msg.parentId ?? msg.id, authorId: s.userId, kind: "system", body: `${s.userName} ${state} “${a.title}”${v.note ? `: ${v.note}` : ""}` }).returning();
    await db.update(X).set({ replyCount: sql`${X.replyCount} + 1`, lastReplyAt: new Date() }).where(eq(X.id, msg.parentId ?? msg.id));
    await publish({ o: s.orgId, t: "m", ch: c.id, id: reply!.id, thread: msg.parentId ?? msg.id });
    if (msg.authorId && msg.authorId !== s.userId) await notify(s.orgId, [msg.authorId], { kind: "chat.approval", title: `${s.userName} ${state}: ${a.title}`, body: v.note || undefined, link: `/chat/${c.id}?m=${msg.id}`, values: { who: s.userName, title: a.title, link: `/chat/${c.id}?m=${msg.id}` } });
  } else throw new ApiError("conflict", "Nothing to answer here");
  await publish({ o: s.orgId, t: "m", ch: c.id, id: msg.id, thread: msg.parentId });
  return { message: (await hydrate(s, [(await db.select().from(X).where(eq(X.id, msg.id)))[0]!]))[0]! };
}

/** Close a poll, or settle a decision (its author or a channel admin). */
export async function settle(s: ChatScope, id: string, raw: unknown) {
  const { msg, c, m } = await messageFor(s, id, "read");
  const admin = m?.role === "owner" || m?.role === "admin" || s.manage;
  if (msg.authorId !== s.userId && !admin) throw new ApiError("forbidden", "Only whoever started it (or a channel admin) can close it");
  const v = check(z.object({ state: z.enum(["closed", "agreed", "rejected", "withdrawn"]) }), raw);
  const d = msg.data as Record<string, unknown>;
  if (msg.kind === "poll" && v.state === "closed") await db.update(X).set({ data: { ...d, closed: true } }).where(eq(X.id, msg.id));
  else if (msg.kind === "decision" && v.state !== "closed") {
    await db.update(X).set({ data: { ...d, state: v.state, decidedBy: s.userId, decidedAt: new Date().toISOString() } }).where(eq(X.id, msg.id));
    await system(c, s.userId, `${s.userName} marked the decision ${v.state}: “${String(d.text).slice(0, 140)}”`, { decision: msg.id });
  } else throw new ApiError("validation_failed", "That doesn't apply here");
  await publish({ o: s.orgId, t: "m", ch: c.id, id: msg.id, thread: msg.parentId });
  return { ok: true };
}

export async function forward(s: ChatScope, id: string, raw: unknown) {
  const { msg } = await messageFor(s, id, "read");
  const v = check(z.object({ to: z.uuid(), comment: z.string().max(2000).default("") }), raw);
  if (msg.deletedAt) throw new ApiError("conflict", "This message was deleted");
  const { c: to } = await channelFor(s, v.to, "post");
  const quote = msg.body ? msg.body.split("\n").map((l) => `> ${l}`).join("\n") : "";
  const body = [v.comment.trim(), quote].filter(Boolean).join("\n\n");
  const [f] = await db.insert(X).values({ orgId: s.orgId, channelId: to.id, authorId: s.userId, kind: msg.kind === "system" ? "text" : msg.kind, body, data: msg.kind === "record" || msg.kind === "event" || msg.kind === "call" ? msg.data : {}, mentions: { users: [], everyone: false, records: msg.mentions.records }, tags: msg.tags, forwardedFrom: msg.id }).returning();
  if (["poll", "checklist", "decision", "approval"].includes(msg.kind)) await db.update(X).set({ kind: "text", body: [body, `_${describe(msg)}_`].filter(Boolean).join("\n\n") }).where(eq(X.id, f!.id));
  await afterPost(s, to, f!, null);
  return { message: { id: f!.id, channelId: to.id } };
}

export async function markRead(s: ChatScope, id: string, raw: unknown) {
  const { m } = await channelFor(s, id, "read");
  if (!m) return { ok: true };
  const v = check(z.object({ seq: z.number().int().min(0).optional(), unreadFrom: z.number().int().min(1).optional() }), raw);
  const seq = v.unreadFrom ? v.unreadFrom - 1 : (v.seq ?? Number((await db.select({ n: sql<number>`coalesce(max(${X.seq}), 0)` }).from(X).where(eq(X.channelId, id)))[0]?.n ?? 0));
  await db.update(M).set({ readSeq: seq }).where(and(eq(M.channelId, id), eq(M.userId, s.userId), v.unreadFrom ? sql`true` : lt(M.readSeq, seq)));
  await publish({ o: s.orgId, t: "r", ch: id, u: s.userId, seq });
  return { ok: true };
}

export async function markAllRead(s: ChatScope) {
  await db.execute(sql`update team_members m set read_seq = coalesce((select max(seq) from team_messages x where x.channel_id = m.channel_id), 0) where m.user_id = ${s.userId} and m.org_id = ${s.orgId}`);
  return { ok: true };
}

export async function typing(s: ChatScope, id: string, raw: unknown) {
  const { m } = await channelFor(s, id, "read");
  if (!m) return { ok: true };
  const v = check(z.object({ thread: z.uuid().nullable().default(null) }), raw);
  await publish({ o: s.orgId, t: "t", ch: id, u: s.userId, thread: v.thread });
  return { ok: true };
}

// ── Saved & reminders ──────────────────────────────────────────────────────

export async function save(s: ChatScope, id: string, raw: unknown) {
  const { msg } = await messageFor(s, id, "read");
  const v = check(z.object({ on: z.boolean().default(true), remindAt: z.iso.datetime({ offset: true }).nullable().default(null), done: z.boolean().optional() }), raw);
  if (!v.on) {
    await db.delete(S).where(and(eq(S.userId, s.userId), eq(S.messageId, msg.id)));
    return { ok: true };
  }
  if (v.remindAt && new Date(v.remindAt).getTime() < Date.now()) throw new ApiError("validation_failed", "Pick a time in the future", { remindAt: ["In the past"] });
  const values = { remindAt: v.remindAt ? new Date(v.remindAt) : null, reminded: false, done: v.done ?? false };
  await db.insert(S).values({ userId: s.userId, messageId: msg.id, orgId: s.orgId, ...values }).onConflictDoUpdate({ target: [S.userId, S.messageId], set: v.remindAt !== null || v.done !== undefined ? values : { done: false } });
  return { ok: true };
}

export async function savedList(s: ChatScope) {
  const rows = await db.select({ msg: X, remindAt: S.remindAt, done: S.done, at: S.createdAt }).from(S).innerJoin(X, eq(X.id, S.messageId)).where(and(eq(S.userId, s.userId), eq(S.orgId, s.orgId))).orderBy(S.done, sql`${S.remindAt} asc nulls last`, desc(S.createdAt)).limit(200);
  const readable = await readableChannels(s);
  const ok = rows.filter((r) => readable.has(r.msg.channelId));
  const msgs = await hydrate(s, ok.map((r) => r.msg));
  return { saved: ok.map((r, i) => ({ message: msgs[i]!, remindAt: r.remindAt?.toISOString() ?? null, done: r.done, savedAt: r.at.toISOString() })) };
}

async function readableChannels(s: ChatScope) {
  const rows = await db.execute(sql`select c.id from team_channels c where c.org_id = ${s.orgId} and (exists (select 1 from team_members m where m.channel_id = c.id and m.user_id = ${s.userId}) or (c.kind = 'channel' and c.visibility = 'public'))`);
  return new Set((rows.rows as { id: string }[]).map((r) => r.id));
}

// ── Activity, search, pinned, files, decisions ─────────────────────────────

/** Mentions of you, replies in your threads, reactions to you, and DMs — newest first. */
export async function activity(s: ChatScope): Promise<{ items: ActivityItem[] }> {
  const rows = (
    await db.execute(sql`
    select x.id, c.id as channel_id, c.name, c.kind, m.read_seq,
      case when x.mentions->'users' ? ${s.userId} or (x.mentions->>'everyone')::boolean then 'mention'
           when c.kind <> 'channel' then 'dm' else 'reply' end as why
    from team_messages x join team_channels c on c.id = x.channel_id join team_members m on m.channel_id = c.id and m.user_id = ${s.userId}
    where x.org_id = ${s.orgId} and x.scheduled_for is null and x.deleted_at is null and x.kind <> 'system' and coalesce(x.author_id::text, '') <> ${s.userId}
      and x.created_at > now() - interval '30 days'
      and (x.mentions->'users' ? ${s.userId} or ((x.mentions->>'everyone')::boolean and c.kind <> 'dm') or c.kind <> 'channel'
           or x.parent_id in (select id from team_messages p where p.author_id = ${s.userId}))
    order by x.seq desc limit 60`)
  ).rows as { id: string; channel_id: string; name: string; kind: string; read_seq: number; why: ActivityItem["kind"] }[];
  const msgs = rows.length ? await db.select().from(X).where(inArray(X.id, rows.map((r) => r.id))) : [];
  const out = await hydrate(s, rows.map((r) => msgs.find((m) => m.id === r.id)!).filter(Boolean));
  const reacts = (
    await db.execute(sql`select r.message_id, r.user_id, r.emoji, r.created_at from team_reactions r join team_messages x on x.id = r.message_id where x.author_id = ${s.userId} and x.org_id = ${s.orgId} and r.user_id <> ${s.userId} and r.created_at > now() - interval '7 days' order by r.created_at desc limit 20`)
  ).rows as { message_id: string; user_id: string; emoji: string; created_at: string }[];
  const rmsgs = reacts.length ? await hydrate(s, await db.select().from(X).where(inArray(X.id, [...new Set(reacts.map((r) => r.message_id))]))) : [];
  const chans = rmsgs.length ? await db.select({ id: C.id, name: C.name, kind: C.kind }).from(C).where(inArray(C.id, rmsgs.map((m) => m.channelId))) : [];
  const items: ActivityItem[] = [
    ...out.map((m, i) => ({ kind: rows[i]!.why, message: m, channel: { id: rows[i]!.channel_id, name: rows[i]!.name, kind: rows[i]!.kind }, at: m.createdAt, unread: m.seq > Number(rows[i]!.read_seq) })),
    ...reacts.flatMap((r) => {
      const m = rmsgs.find((x) => x.id === r.message_id);
      const ch = chans.find((x) => x.id === m?.channelId);
      return m && ch ? [{ kind: "reaction" as const, message: { ...m, reactions: [{ emoji: r.emoji, users: [r.user_id] }] }, channel: ch, at: new Date(r.created_at).toISOString(), unread: false }] : [];
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, 80) };
}

/**
 * Search everything you can read. Understands from:@name, in:#channel,
 * has:file|link|poll|decision, is:pinned|saved, tag:#topic, before:/after:YYYY-MM-DD.
 */
export async function search(s: ChatScope, raw: string) {
  const q = raw.trim().slice(0, 200);
  if (!q) return { messages: [], query: q };
  const readable = [...(await readableChannels(s))];
  if (!readable.length) return { messages: [], query: q };
  const where: SQL[] = [eq(X.orgId, s.orgId), inArray(X.channelId, readable), live!, ne(X.kind, "system")];
  let words = q;
  const take = (re: RegExp) => {
    const out: string[] = [];
    words = words.replace(re, (_m, v: string) => (out.push(v), " "));
    return out;
  };
  const ppl = await people(s.orgId);
  for (const f of take(/\bfrom:@?("[^"]+"|\S+)/gi)) {
    const n = f.replace(/"/g, "").toLowerCase();
    const who = n === "me" ? [s.userId] : ppl.filter((p) => p.name.toLowerCase().includes(n) || p.email.toLowerCase().startsWith(n)).map((p) => p.id);
    where.push(who.length ? inArray(X.authorId, who) : sql`false`);
  }
  for (const f of take(/\bin:#?(\S+)/gi)) where.push(sql`${X.channelId} in (select id from team_channels where org_id = ${s.orgId} and lower(name) = ${f.toLowerCase()})`);
  for (const f of take(/\bhas:(\w+)/gi)) {
    const k = f.toLowerCase();
    if (k === "file") where.push(sql`exists (select 1 from team_files f where f.message_id = ${X.id})`);
    else if (k === "link") where.push(sql`${X.body} ~* 'https?://'`);
    else if (["poll", "decision", "approval", "checklist", "record", "call", "event"].includes(k)) where.push(eq(X.kind, k));
  }
  for (const f of take(/\bis:(\w+)/gi)) {
    if (f === "pinned") where.push(isNotNull(X.pinnedAt));
    if (f === "saved") where.push(sql`exists (select 1 from team_saved sv where sv.message_id = ${X.id} and sv.user_id = ${s.userId})`);
    if (f === "urgent" || f === "important") where.push(eq(X.priority, f));
  }
  for (const f of take(/\btag:#?([\w-]+)/gi)) where.push(sql`${f.toLowerCase()} = any(${X.tags})`);
  for (const f of take(/\bbefore:(\d{4}-\d{2}-\d{2})/gi)) where.push(lt(X.createdAt, new Date(`${f}T00:00:00Z`)));
  for (const f of take(/\bafter:(\d{4}-\d{2}-\d{2})/gi)) where.push(gt(X.createdAt, new Date(`${f}T23:59:59Z`)));
  for (const w of words.split(/\s+/).filter((x) => x.length > 0).slice(0, 8)) {
    const t = `%${w.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(X.body, t), sql`${X.data}::text ilike ${t}`, sql`exists (select 1 from team_files f where f.message_id = ${X.id} and f.filename ilike ${t})`)!);
  }
  const rows = await db.select().from(X).where(and(...where)).orderBy(desc(X.seq)).limit(60);
  return { messages: await hydrate(s, rows), query: q };
}

/** Pinned messages, files, decisions, polls and records shared in a conversation. */
export async function collections(s: ChatScope, id: string, what: string) {
  const { c } = await channelFor(s, id, "read");
  if (what === "files") {
    const rows = await db.select({ id: F.id, filename: F.filename, mime: F.mime, size: F.size, uploadedBy: F.uploadedBy, createdAt: F.createdAt, messageId: F.messageId }).from(F).where(and(eq(F.channelId, c.id), isNotNull(F.messageId))).orderBy(desc(F.createdAt)).limit(300);
    return { files: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  }
  const cond = what === "pinned" ? isNotNull(X.pinnedAt) : what === "decisions" ? inArray(X.kind, ["decision", "approval"]) : what === "polls" ? inArray(X.kind, ["poll", "checklist"]) : what === "records" ? or(eq(X.kind, "record"), sql`jsonb_array_length(${X.mentions}->'records') > 0`) : what === "links" ? sql`${X.body} ~* 'https?://'` : null;
  if (!cond) throw notFound("Collection");
  const rows = await db.select().from(X).where(and(eq(X.channelId, c.id), live!, cond)).orderBy(what === "pinned" ? desc(X.pinnedAt) : desc(X.seq)).limit(200);
  return { messages: await hydrate(s, rows) };
}

// ── Files ──────────────────────────────────────────────────────────────────

export async function upload(s: ChatScope, id: string, file: { filename: string; mime: string; data: Buffer }) {
  const { c } = await channelFor(s, id, "post");
  const [f] = await db.insert(F).values({ orgId: s.orgId, channelId: c.id, filename: file.filename.replace(/[\\/\0]/g, "_").slice(0, 200) || "file", mime: /^[\w.+-]+\/[\w.+-]+$/.test(file.mime) ? file.mime : "application/octet-stream", size: file.data.length, data: file.data, uploadedBy: s.userId }).returning({ id: F.id, filename: F.filename, mime: F.mime, size: F.size });
  return { file: f! };
}

export async function download(s: ChatScope, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("File");
  const [f] = await db.select().from(F).where(and(eq(F.id, id), eq(F.orgId, s.orgId)));
  if (!f) throw notFound("File");
  const { c } = await channelFor(s, f.channelId, "read");
  // Unsent uploads are only their uploader's — except the conversation's picture.
  if (!f.messageId && f.uploadedBy !== s.userId && c.avatarFileId !== f.id) throw notFound("File");
  // Guests without history don't get files from before they joined.
  if (s.guest && !s.guest.history && f.messageId) {
    const [x] = await db.select({ seq: X.seq }).from(X).where(eq(X.id, f.messageId));
    if (!x || x.seq <= s.guest.since) throw notFound("File");
  }
  return f;
}

// ── Scheduled ──────────────────────────────────────────────────────────────

/** Scheduled messages whose time has come: they post now (new seq, so they land at the end). */
export async function postScheduled(now = new Date()) {
  const due = await db.select().from(X).where(and(isNotNull(X.scheduledFor), lte(X.scheduledFor, now), isNull(X.deletedAt))).limit(100);
  for (const m of due) {
    const [c] = await db.select().from(C).where(eq(C.id, m.channelId));
    const [u] = m.authorId ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, m.authorId)) : [];
    const stillIn = m.authorId ? (await db.select({ u: M.userId }).from(M).where(and(eq(M.channelId, m.channelId), eq(M.userId, m.authorId))))[0] : null;
    if (!c || c.archived || !stillIn) {
      await db.delete(X).where(eq(X.id, m.id));
      continue;
    }
    const [posted] = await db.update(X).set({ scheduledFor: null, createdAt: now, seq: sql`nextval(pg_get_serial_sequence('team_messages', 'seq'))` }).where(and(eq(X.id, m.id), isNotNull(X.scheduledFor))).returning();
    if (!posted) continue;
    const parent = posted.parentId ? ((await db.select().from(X).where(eq(X.id, posted.parentId)))[0] ?? null) : null;
    await afterPost({ orgId: posted.orgId, userId: posted.authorId ?? "", userName: u?.name ?? "Someone" }, c, posted, parent);
  }
  return due.length;
}


// ── Import & export ────────────────────────────────────────────────────────

/** Channels from a spreadsheet: name, topic, description, public/private, and members by email. */
export async function importChannels(s: ChatScope, raw: unknown) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins import channels");
  return runImport(target("chat.channels"), raw, async (v, mode) => {
    const nm = str(v.name).trim().toLowerCase().replace(/\s+/g, "-").replace(/[#@<>]/g, "").slice(0, 60);
    if (!nm) throw new ApiError("validation_failed", "Name the channel");
    const visibility = /priv|closed|invite/i.test(str(v.visibility)) ? "private" : "public";
    const emails = str(v.members).split(/[,;|\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
    const users = emails.length ? (await db.select({ id: schema.users.id }).from(schema.users).innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.orgId, s.orgId))).where(inArray(sql`lower(${schema.users.email})`, emails))).map((u) => u.id) : [];
    const [have] = await db.select().from(C).where(and(eq(C.orgId, s.orgId), eq(C.kind, "channel"), sql`lower(${C.name}) = ${nm}`));
    if (have) {
      if (mode === "skip") return "skipped";
      await db.update(C).set({ topic: str(v.topic).slice(0, 250) || have.topic, description: str(v.description).slice(0, 1000) || have.description, ...(str(v.visibility) ? { visibility } : {}) }).where(eq(C.id, have.id));
      if (users.length) await db.insert(M).values(users.map((u) => ({ channelId: have.id, userId: u, orgId: s.orgId, role: "member" }))).onConflictDoNothing();
      return "updated";
    }
    const [c] = await db.insert(C).values({ orgId: s.orgId, kind: "channel", name: nm, topic: str(v.topic).slice(0, 250), description: str(v.description).slice(0, 1000), visibility, settings: { posting: "everyone", ai: true }, createdBy: s.userId }).returning({ id: C.id });
    await db.insert(M).values([...new Set([s.userId, ...users])].map((u) => ({ channelId: c!.id, userId: u, orgId: s.orgId, role: u === s.userId ? "owner" : "member" }))).onConflictDoNothing();
    return "created";
  });
}

const csvCell = (v: string) => {
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** The conversation as a CSV: time, who, where (channel or thread), what, and its reactions. */
export async function exportChannel(s: ChatScope, id: string) {
  const { c } = await channelFor(s, id, "read");
  const rows = await db.select().from(X).where(and(eq(X.channelId, c.id), live!)).orderBy(asc(X.seq)).limit(50_000);
  const ids = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const names = new Map((ids.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids)) : []).map((u) => [u.id, u.name]));
  const lines = [["Time (UTC)", "From", "In", "Kind", "Message", "Priority", "Pinned", "Replies"].join(",")];
  for (const r of rows) lines.push([r.createdAt.toISOString(), r.authorId ? (names.get(r.authorId) ?? "") : "System", r.parentId ? "Thread reply" : "Channel", r.kind, plainOf(r), r.priority, r.pinnedAt ? "yes" : "", String(r.replyCount)].map(csvCell).join(","));
  const nm = (c.kind === "channel" ? c.name : c.kind === "group" ? c.name || "group-chat" : "direct-message").replace(/[^\w.-]+/g, "-");
  return { filename: `chat-${nm}-${new Date().toISOString().slice(0, 10)}.csv`, csv: `﻿${lines.join("\r\n")}\r\n` };
}

const plainOf = (r: Msg) => [plain(r.body), describe(r)].filter(Boolean).join(" — ");
