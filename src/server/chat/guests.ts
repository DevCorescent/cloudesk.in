// Guests in Chat: invite links for one conversation, join requests from
// people with no Cloudesk account (just a name), approval by the
// conversation's admins, and the guest's own scoped access afterwards.
//
// A guest gets a hidden identity in `users` (no password, an address on an
// unroutable domain) so messages, reactions, votes and files work exactly as
// they do for members. They never get a session: their browser holds a
// random secret in a cookie scoped to that one conversation's guest API.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChannelOut, GuestOut, GuestStateOut, InviteOut, PersonOut } from "@/lib/chat/api";
import { decideSchema, expiryFrom, GUEST_DOMAIN, inviteEmailSchema, invitePatchSchema, inviteProblem, inviteSchema, inviteText, joinSchema } from "@/lib/chat/guests";
import { ONLINE_MS } from "@/lib/chat/model";
import { isOn } from "@/lib/workspace/modules";
import { ApiError, notFound } from "../http/errors";
import type { AuthedContext } from "../http/handler";
import { notify } from "../notify/notify";
import { appUrl, sendMail } from "../services/mail";
import { channelFor, check, type Channel, type ChatScope } from "./access";
import { publish } from "./bus";
import { addMembers, leave, removeMember } from "./core";

const C = schema.teamChannels;
const M = schema.teamMembers;
const X = schema.teamMessages;
const I = schema.teamInvites;
const G = schema.teamGuests;

type Invite = typeof I.$inferSelect;
type Guest = typeof G.$inferSelect;

const isUuid = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const inviteUrl = (code: string) => appUrl(`/j/${code}`);
/** Each conversation has its own guest cookie, sent only to that conversation's guest API. */
export const guestCookieName = (channelId: string) => `cc_guest_${channelId.replace(/-/g, "")}`;
export const guestCookiePath = (channelId: string) => `/api/v1/guest/chat/c/${channelId}`;

const where = (c: Pick<Channel, "kind" | "name">) => (c.kind === "channel" ? `#${c.name}` : c.name || "a group chat");

function inviteOut(i: Invite): InviteOut {
  return { id: i.id, code: i.code, url: inviteUrl(i.code), label: i.label, approval: i.approval, history: i.history, files: i.files, maxUses: i.maxUses, uses: i.uses, expiresAt: i.expiresAt?.toISOString() ?? null, revokedAt: i.revokedAt?.toISOString() ?? null, problem: inviteProblem(i), sent: i.sent, createdBy: i.createdBy, createdAt: i.createdAt.toISOString() };
}

/** "Chrome on Android" — enough for an admin to recognise a request, nothing more. */
export function deviceOf(ua: string) {
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone / iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return [b, os].filter(Boolean).join(" on ") || "Unknown device";
}

function guestOut(g: Guest): GuestOut {
  return { id: g.id, userId: g.userId, name: g.name, contact: g.contact, note: g.note, status: g.status as GuestOut["status"], reason: g.reason, history: g.history, files: g.files, invite: g.inviteId, device: deviceOf(g.userAgent), decidedBy: g.decidedBy, decidedAt: g.decidedAt?.toISOString() ?? null, lastSeenAt: g.lastSeenAt?.toISOString() ?? null, createdAt: g.createdAt.toISOString() };
}

// ── For the conversation's admins ──────────────────────────────────────────

/** Only a conversation's admins (or workspace chat admins) invite and let people in; never into a DM. */
async function adminOf(s: ChatScope, channelId: string) {
  if (s.guest) throw new ApiError("forbidden", "Guests can't invite people");
  const { c } = await channelFor(s, channelId, "admin");
  if (c.kind === "dm") throw new ApiError("conflict", "Start a group chat or a channel to invite guests");
  return c;
}

export async function listInvites(s: ChatScope, channelId: string) {
  const c = await adminOf(s, channelId);
  const rows = await db.select().from(I).where(eq(I.channelId, c.id)).orderBy(desc(I.createdAt)).limit(100);
  return { invites: rows.map(inviteOut) };
}

export async function createInvite(s: ChatScope, channelId: string, raw: unknown) {
  const c = await adminOf(s, channelId);
  if (c.archived) throw new ApiError("conflict", "This channel is archived");
  const v = check(inviteSchema, raw);
  const [live] = await db.select({ n: sql<number>`count(*)::int` }).from(I).where(and(eq(I.channelId, c.id), sql`${I.revokedAt} is null`));
  if (Number(live?.n) >= 50) throw new ApiError("conflict", "This conversation has 50 invite links — turn some off first");
  const [i] = await db.insert(I).values({ orgId: s.orgId, channelId: c.id, code: randomBytes(12).toString("base64url"), label: v.label, approval: v.approval, history: v.history, files: v.files, maxUses: v.maxUses || null, expiresAt: expiryFrom(v.expires), createdBy: s.userId }).returning();
  return { invite: inviteOut(i!) };
}

async function inviteFor(s: ChatScope, id: string) {
  if (!isUuid(id)) throw notFound("Invite");
  const [i] = await db.select().from(I).where(and(eq(I.id, id), eq(I.orgId, s.orgId)));
  if (!i) throw notFound("Invite");
  const c = await adminOf(s, i.channelId);
  return { i, c };
}

export async function updateInvite(s: ChatScope, id: string, raw: unknown) {
  const { i } = await inviteFor(s, id);
  const v = check(invitePatchSchema, raw);
  const [u] = await db
    .update(I)
    .set({ ...(v.label !== undefined ? { label: v.label } : {}), ...(v.approval !== undefined ? { approval: v.approval } : {}), ...(v.history !== undefined ? { history: v.history } : {}), ...(v.files !== undefined ? { files: v.files } : {}), ...(v.revoked !== undefined ? { revokedAt: v.revoked ? (i.revokedAt ?? new Date()) : null } : {}) })
    .where(eq(I.id, i.id))
    .returning();
  return { invite: inviteOut(u!) };
}

/** Sends the invite from Cloudesk, one email per person, replies going to whoever sent it. */
export async function emailInvite(s: ChatScope, id: string, raw: unknown) {
  const { i, c } = await inviteFor(s, id);
  const problem = inviteProblem(i);
  if (problem) throw new ApiError("conflict", problem);
  const v = check(inviteEmailSchema, raw);
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  const text = inviteText({ inviter: s.userName, where: where(c), workspace: org?.name ?? "their workspace", url: inviteUrl(i.code), approval: i.approval });
  const to = [...new Set(v.to)];
  for (const addr of to) {
    await sendMail({ to: addr, subject: `${s.userName} invited you to chat in ${where(c)}`, body: [v.message, text, i.expiresAt ? `This link works until ${i.expiresAt.toUTCString()}.` : ""].filter(Boolean).join("\n\n"), fromName: `${s.userName} via Cloudesk`, replyTo: s.userEmail });
  }
  const at = new Date().toISOString();
  await db.update(I).set({ sent: sql`${I.sent} || ${JSON.stringify(to.map((t) => ({ via: "email", to: t, at })))}::jsonb` }).where(eq(I.id, i.id));
  return { sent: to.length };
}

/**
 * Invite one person found by search into this conversation. A member of the
 * workspace is added straight away; anyone else — a Cloudesk account found
 * by username (its email stays on the server), a contact or a typed email —
 * gets an email with a guest link to this conversation, which lets them in
 * without waiting for approval.
 */
export async function invitePerson(s: ChatScope, channelId: string, raw: unknown) {
  if (s.guest) throw new ApiError("forbidden", "Guests can't invite people");
  const v = check(z.object({ userId: z.uuid().optional(), email: z.email("An email address").max(200).optional(), message: z.string().trim().max(1000).default("") }), raw);
  if (!v.userId && !v.email) throw new ApiError("validation_failed", "Who should we invite?");
  if (v.userId) {
    const [member] = await db.select({ u: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, s.orgId), eq(schema.memberships.userId, v.userId)));
    if (member) {
      const r = await addMembers(s, channelId, { users: [v.userId] });
      return { added: r.added, sent: 0, label: "" };
    }
  }
  const c = await adminOf(s, channelId);
  if (c.archived) throw new ApiError("conflict", "This channel is archived");
  let to = v.email ?? "";
  let label = to;
  if (v.userId) {
    const [u] = await db.select({ email: schema.users.email, name: schema.users.name, username: schema.users.username }).from(schema.users).where(and(eq(schema.users.id, v.userId), sql`${schema.users.email} not like ${`%@${GUEST_DOMAIN}`}`, sql`${schema.users.disabledAt} is null`));
    if (!u) throw notFound("Person");
    to = u.email;
    label = u.username ? `@${u.username}` : u.name;
  }
  // One link per conversation for people invited by name; it lets them straight in.
  let [link] = await db.select().from(I).where(and(eq(I.channelId, c.id), eq(I.label, "Invited by name"), sql`${I.revokedAt} is null`, sql`(${I.expiresAt} is null or ${I.expiresAt} > now())`)).limit(1);
  link ??= (await db.insert(I).values({ orgId: s.orgId, channelId: c.id, code: randomBytes(12).toString("base64url"), label: "Invited by name", approval: false, history: false, files: true, createdBy: s.userId }).returning())[0];
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  const text = inviteText({ inviter: s.userName, where: where(c), workspace: org?.name ?? "their workspace", url: inviteUrl(link!.code), approval: false });
  await sendMail({ to, subject: `${s.userName} invited you to chat in ${where(c)}`, body: [v.message, text].filter(Boolean).join("\n\n"), fromName: `${s.userName} via Cloudesk`, replyTo: s.userEmail });
  const at = new Date().toISOString();
  await db.update(I).set({ sent: sql`${I.sent} || ${JSON.stringify([{ via: "email", to: label, at }])}::jsonb` }).where(eq(I.id, link!.id));
  return { added: 0, sent: 1, label };
}

export async function listGuests(s: ChatScope, channelId: string) {
  const c = await adminOf(s, channelId);
  const rows = await db.select().from(G).where(eq(G.channelId, c.id)).orderBy(sql`case ${G.status} when 'pending' then 0 when 'approved' then 1 else 2 end`, desc(G.createdAt)).limit(300);
  return { guests: rows.map(guestOut) };
}

async function guestFor(s: ChatScope, id: string) {
  if (!isUuid(id)) throw notFound("Guest");
  const [g] = await db.select().from(G).where(and(eq(G.id, id), eq(G.orgId, s.orgId)));
  if (!g) throw notFound("Guest");
  const c = await adminOf(s, g.channelId);
  return { g, c };
}

/** Lets a guest in: a member of the conversation (role "guest"), seeing from now on (or everything, with history). */
async function admit(g: Guest, c: Channel, by: { id: string; name: string } | null) {
  const [top] = await db.select({ n: max(X.seq) }).from(X).where(eq(X.channelId, c.id));
  const since = Number(top?.n ?? 0);
  const [ok] = await db.update(G).set({ status: "approved", sinceSeq: since, decidedBy: by?.id ?? null, decidedAt: new Date(), reason: "" }).where(and(eq(G.id, g.id), eq(G.status, "pending"))).returning({ id: G.id });
  if (!ok) throw new ApiError("conflict", "Someone already answered this request");
  await db.insert(M).values({ channelId: c.id, userId: g.userId, orgId: c.orgId, role: "guest", readSeq: since }).onConflictDoUpdate({ target: [M.channelId, M.userId], set: { role: "guest" } });
  const [m] = await db.insert(X).values({ orgId: c.orgId, channelId: c.id, authorId: by?.id ?? g.userId, kind: "system", body: by ? `${g.name} joined as a guest — let in by ${by.name}` : `${g.name} joined as a guest with an invite link`, data: { guest: g.id } }).returning();
  await db.update(C).set({ lastMessageAt: new Date() }).where(eq(C.id, c.id));
  await publish({ o: c.orgId, t: "m", ch: c.id, id: m!.id, seq: m!.seq });
  await publish({ o: c.orgId, t: "c", ch: c.id });
}

export async function decide(s: ChatScope, id: string, raw: unknown) {
  const { g, c } = await guestFor(s, id);
  const v = check(decideSchema, raw);
  if (g.status !== "pending") throw new ApiError("conflict", "Someone already answered this request");
  if (v.approve) {
    if (c.archived) throw new ApiError("conflict", "This channel is archived");
    await admit(g, c, { id: s.userId, name: s.userName });
  } else {
    const [ok] = await db.update(G).set({ status: "rejected", reason: v.reason, decidedBy: s.userId, decidedAt: new Date() }).where(and(eq(G.id, g.id), eq(G.status, "pending"))).returning({ id: G.id });
    if (!ok) throw new ApiError("conflict", "Someone already answered this request");
    await publish({ o: s.orgId, t: "c", ch: c.id });
  }
  return { ok: true };
}

/** Takes a guest out of the conversation (or turns down a waiting request). */
export async function removeGuest(s: ChatScope, id: string) {
  const { g, c } = await guestFor(s, id);
  if (g.status === "pending") return decide(s, id, { approve: false });
  if (g.status !== "approved") return { ok: true };
  return removeMember(s, c.id, g.userId);
}

// ── For the guest ──────────────────────────────────────────────────────────

async function inviteByCode(code: string) {
  if (!/^[\w-]{10,40}$/.test(code)) throw notFound("Invite");
  const [row] = await db
    .select({ i: I, c: C, org: { name: schema.organizations.name, modules: schema.organizations.modules }, inviter: schema.users.name })
    .from(I)
    .innerJoin(C, eq(C.id, I.channelId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, I.orgId))
    .leftJoin(schema.users, eq(schema.users.id, I.createdBy))
    .where(eq(I.code, code));
  if (!row) throw notFound("Invite");
  return row;
}

type InviteRow = Awaited<ReturnType<typeof inviteByCode>>;
const problemOf = (r: InviteRow) => (!isOn(r.org.modules, "chat") ? "Chat isn't available in this workspace any more." : r.c.archived ? "This conversation has been archived." : inviteProblem(r.i));

function inviteInfo(r: InviteRow): GuestStateOut["invite"] {
  return { workspace: r.org.name, where: where(r.c), kind: r.c.kind as ChannelOut["kind"], topic: r.c.topic, emoji: r.c.emoji, color: r.c.color, inviter: r.inviter ?? "Someone", approval: r.i.approval, problem: problemOf(r), channelId: r.c.id };
}

export async function invitePreview(code: string) {
  return { invite: inviteInfo(await inviteByCode(code)) };
}

/** Who should hear about a request: the conversation's owners and admins, or the workspace's admins if it has none. */
async function approversOf(c: Channel) {
  const own = (await db.select({ u: M.userId }).from(M).where(and(eq(M.channelId, c.id), inArray(M.role, ["owner", "admin"])))).map((r) => r.u);
  if (own.length) return own;
  return (await db.select({ u: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, c.orgId), inArray(schema.memberships.role, ["owner", "admin"])))).map((r) => r.u);
}

/** Someone with the link asks to join (or joins, if the link doesn't need approval). Returns their secret for the cookie. */
export async function requestJoin(code: string, raw: unknown, from: { ip: string | null; userAgent: string }) {
  const v = check(joinSchema, raw);
  const r = await inviteByCode(code);
  const problem = problemOf(r);
  if (problem) throw new ApiError("conflict", problem);
  const [waiting] = await db.select({ n: sql<number>`count(*)::int` }).from(G).where(and(eq(G.channelId, r.c.id), eq(G.status, "pending")));
  if (Number(waiting?.n) >= 100) throw new ApiError("conflict", "Too many people are waiting to be let in. Try again later.");
  const token = randomBytes(32).toString("base64url");
  const g = await db.transaction(async (tx) => {
    // One use at a time, so a link for 5 people lets in 5, not 6.
    const [i] = await tx.select().from(I).where(eq(I.id, r.i.id)).for("update");
    const p = i ? inviteProblem(i) : "This invite link was turned off.";
    if (p) throw new ApiError("conflict", p);
    await tx.update(I).set({ uses: sql`${I.uses} + 1` }).where(eq(I.id, i!.id));
    const [u] = await tx.insert(schema.users).values({ email: `${randomUUID()}@${GUEST_DOMAIN}`, name: v.name }).returning({ id: schema.users.id });
    const [g] = await tx.insert(G).values({ orgId: r.c.orgId, channelId: r.c.id, inviteId: i!.id, userId: u!.id, name: v.name, contact: v.contact, note: v.note, tokenHash: hashToken(token), history: i!.history, files: i!.files, ip: from.ip, userAgent: from.userAgent.slice(0, 300) }).returning();
    return g!;
  });
  if (!r.i.approval) await admit(g, r.c, null);
  else {
    const link = `/chat/${r.c.id}?guests=1`;
    await notify(r.c.orgId, await approversOf(r.c), { kind: "chat.guest", title: `${v.name} asks to join ${where(r.c)} as a guest`, body: [v.note && `“${v.note}”`, v.contact && `Contact: ${v.contact}`].filter(Boolean).join("\n") || undefined, link, values: { who: v.name, channel: where(r.c), link } });
    await publish({ o: r.c.orgId, t: "c", ch: r.c.id });
  }
  return { token, channelId: r.c.id };
}

export async function guestByToken(channelId: string, token: string | undefined | null) {
  if (!token || !isUuid(channelId) || token.length > 100) return null;
  const [g] = await db.select().from(G).where(and(eq(G.tokenHash, hashToken(token)), eq(G.channelId, channelId)));
  return g ?? null;
}

/** The guest's view of Chat: only this conversation, as a member who can't manage anything. */
export async function guestScope(g: Guest, ctx: Omit<AuthedContext, "user" | "sessionId">): Promise<ChatScope> {
  if (g.status === "pending") throw new ApiError("forbidden", "An admin hasn't let you in yet");
  if (g.status !== "approved") throw new ApiError("forbidden", g.status === "rejected" ? "Your request to join wasn't accepted" : "You're no longer in this conversation");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, g.orgId));
  if (!isOn(org?.modules, "chat")) throw new ApiError("forbidden", "Chat isn't available in this workspace any more");
  const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, g.userId));
  return {
    orgId: g.orgId,
    userId: g.userId,
    userName: `${u?.name ?? g.name} (guest)`,
    userEmail: u?.email ?? "",
    role: "viewer",
    manage: false,
    has: () => false,
    ctx: ctx as AuthedContext,
    guest: { id: g.id, channelId: g.channelId, since: g.sinceSeq, history: g.history, files: g.files },
  };
}

/** People in the conversation, as a guest may see them: names and presence, never their email. */
async function peopleIn(c: Channel): Promise<{ people: PersonOut[]; members: string[] }> {
  const rows = await db
    .select({ id: M.userId, role: M.role, name: schema.users.name, status: schema.teamPresence.status, note: schema.teamPresence.note, emoji: schema.teamPresence.emoji, until: schema.teamPresence.until, lastSeenAt: schema.teamPresence.lastSeenAt })
    .from(M)
    .innerJoin(schema.users, eq(schema.users.id, M.userId))
    .leftJoin(schema.teamPresence, and(eq(schema.teamPresence.orgId, c.orgId), eq(schema.teamPresence.userId, M.userId)))
    .where(eq(M.channelId, c.id))
    .orderBy(schema.users.name);
  const now = Date.now();
  // Former guests and members who wrote here still need a name.
  const gone = await db.select({ id: G.userId, name: G.name }).from(G).where(and(eq(G.channelId, c.id), inArray(G.status, ["removed", "left"])));
  const inNow = new Set(rows.map((r) => r.id));
  const people = [
    ...rows.map((r) => {
      const expired = !!r.until && r.until.getTime() < now;
      return { id: r.id, name: r.name, email: "", status: ((expired ? "available" : r.status) ?? "available") as PersonOut["status"], note: expired ? "" : (r.note ?? ""), emoji: expired ? "" : (r.emoji ?? ""), online: !!r.lastSeenAt && now - r.lastSeenAt.getTime() < ONLINE_MS, inMeeting: null, lastSeenAt: r.lastSeenAt?.toISOString() ?? null, ...(r.role === "guest" ? { guest: true } : {}) };
    }),
    ...gone.filter((x) => !inNow.has(x.id)).map((x) => ({ id: x.id, name: x.name, email: "", status: "available" as const, note: "", emoji: "", online: false, inMeeting: null, lastSeenAt: null, guest: true })),
  ];
  return { people, members: [...inNow] };
}

/** Everything the guest page needs: the invite, where the guest stands, and once in, the conversation and its people. */
export async function guestState(channelId: string, token: string | undefined | null): Promise<GuestStateOut> {
  if (!isUuid(channelId)) throw notFound("Conversation");
  const g = await guestByToken(channelId, token);
  const [c] = await db.select().from(C).where(eq(C.id, channelId));
  if (!c) throw notFound("Conversation");
  const [org] = await db.select({ name: schema.organizations.name, modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, c.orgId));
  const [inv] = g?.inviteId ? await db.select({ approval: I.approval, inviter: schema.users.name }).from(I).leftJoin(schema.users, eq(schema.users.id, I.createdBy)).where(eq(I.id, g.inviteId)) : [];
  const invite: GuestStateOut["invite"] = { workspace: org?.name ?? "", where: where(c), kind: c.kind as ChannelOut["kind"], topic: c.topic, emoji: c.emoji, color: c.color, inviter: inv?.inviter ?? "Someone", approval: inv?.approval ?? true, problem: !isOn(org?.modules, "chat") ? "Chat isn't available in this workspace any more." : null, channelId: c.id };
  if (!g) return { invite, guest: null, channel: null, people: [], members: [] };
  const guest = { id: g.id, userId: g.userId, name: g.name, status: g.status as GuestOut["status"], reason: g.reason, files: g.files, history: g.history };
  if (g.status !== "approved" || invite.problem) return { invite, guest, channel: null, people: [], members: [] };
  const [m] = await db.select().from(M).where(and(eq(M.channelId, c.id), eq(M.userId, g.userId)));
  const { people, members } = await peopleIn(c);
  const channel: ChannelOut = {
    id: c.id,
    kind: c.kind as ChannelOut["kind"],
    name: c.name,
    topic: c.topic,
    description: c.description,
    visibility: c.visibility as ChannelOut["visibility"],
    emoji: c.emoji,
    color: c.color,
    posting: c.settings.posting ?? "everyone",
    ai: false,
    archived: c.archived,
    people: c.kind === "channel" ? [] : members.filter((u) => u !== g.userId).slice(0, 50),
    memberCount: members.length,
    member: !!m,
    role: null,
    notify: "all",
    starred: false,
    unread: 0,
    mentions: 0,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastPreview: "",
    readSeq: m?.readSeq ?? 0,
    guests: people.filter((p) => p.guest && members.includes(p.id)).length,
    requests: 0,
  };
  return { invite, guest, channel, people, members };
}

/** The guest withdraws a waiting request, or leaves the conversation. */
export async function guestLeave(g: Guest, ctx: Omit<AuthedContext, "user" | "sessionId">) {
  if (g.status === "pending") {
    await db.update(G).set({ status: "left" }).where(and(eq(G.id, g.id), eq(G.status, "pending")));
    await publish({ o: g.orgId, t: "c", ch: g.channelId });
    return { ok: true };
  }
  if (g.status !== "approved") return { ok: true };
  return leave(await guestScope(g, ctx), g.channelId);
}

export async function guestSeen(g: Guest) {
  await db.update(G).set({ lastSeenAt: new Date() }).where(eq(G.id, g.id));
}
