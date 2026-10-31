// Feature requests. A workspace asks; the Cloudesk team (platform admins)
// reviews, replies, plans and builds; when it's ready it's released through a
// release flag — to every workspace, or only to chosen ones (often just the
// one that asked). Workspaces see their own requests in full, the public
// roadmap (title, the team's reply and status only), and what was released
// to them.
import { z } from "zod";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { adminUpdateSchema, commentSchema, releaseSchema, requestSchema, STATUS_INFO, suggestKey, type AdminRequestOut, type NoteOut, type RequestOut, type RequestStatus } from "@/lib/requests/model";
import { audit } from "../services/audit";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { notify } from "../notify/notify";
import { check } from "../mail/access";
import { saveFlag } from "../platform/admin";
import { appUrl, sendMail } from "../services/mail";

const R = schema.featureRequests;
const V = schema.featureRequestVotes;
const N = schema.featureRequestNotes;
type Row = typeof R.$inferSelect;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

export type WScope = { orgId: string; userId: string; userName: string };
export async function wscope(ctx: AuthedContext, orgId: string): Promise<WScope> {
  await requireOrg(ctx, orgId, "org:read");
  return { orgId, userId: ctx.user.id, userName: ctx.user.name };
}

async function names(ids: (string | null)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  return new Map((u.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, u)) : []).map((x) => [x.id, x.name]));
}

async function shape(rows: Row[], viewer: { orgId: string | null; userId: string | null }): Promise<RequestOut[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [voted, counts, dups, who] = await Promise.all([
    viewer.userId ? db.select({ id: V.requestId }).from(V).where(and(eq(V.userId, viewer.userId), inArray(V.requestId, ids))) : Promise.resolve([]),
    db.select({ id: N.requestId, n: sql<number>`count(*)::int` }).from(N).where(and(inArray(N.requestId, ids), eq(N.internal, false), eq(N.kind, "comment"))).groupBy(N.requestId),
    (async () => {
      const d = rows.map((r) => r.duplicateOf).filter((x): x is string => !!x);
      return d.length ? db.select({ id: R.id, number: R.number, title: R.title }).from(R).where(inArray(R.id, d)) : [];
    })(),
    names(rows.map((r) => r.userId)),
  ]);
  const v = new Set(voted.map((x) => x.id));
  return rows.map((r) => {
    const ours = r.orgId === viewer.orgId;
    const forUs = !!r.release && (r.release.mode === "everyone" || (!!viewer.orgId && r.release.orgIds.includes(viewer.orgId)));
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      // Another workspace's own words stay theirs: the roadmap shows the title and the team's reply.
      problem: ours ? r.problem : "",
      details: ours ? r.details : "",
      area: r.area,
      priority: r.priority as RequestOut["priority"],
      scope: r.scope as RequestOut["scope"],
      status: r.status as RequestStatus,
      reply: r.reply,
      eta: r.eta ? String(r.eta) : null,
      public: r.public,
      votes: r.votes,
      voted: v.has(r.id),
      mine: !!viewer.userId && r.userId === viewer.userId,
      ours,
      by: ours && r.userId ? (who.get(r.userId) ?? null) : null,
      duplicateOf: dups.find((d) => d.id === r.duplicateOf) ?? null,
      released: r.releasedAt && r.release ? { at: r.releasedAt.toISOString(), notes: r.release.notes, forUs } : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      noteCount: counts.find((c) => c.id === r.id)?.n ?? 0,
    };
  });
}

async function notesOf(requestId: string, team: boolean): Promise<NoteOut[]> {
  const rows = await db.select().from(N).where(and(eq(N.requestId, requestId), ...(team ? [] : [eq(N.internal, false)]))).orderBy(N.createdAt);
  const who = await names(rows.map((r) => r.authorId));
  return rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, fromTeam: r.fromTeam, internal: r.internal, by: r.fromTeam && !team ? "Cloudesk team" : r.authorId ? (who.get(r.authorId) ?? null) : null, meta: r.meta, at: r.createdAt.toISOString() }));
}

// ── Workspace ──────────────────────────────────────────────────────────────

export async function list(s: WScope, q: { view?: string; q?: string }) {
  const where: SQL[] = [];
  if (q.view === "roadmap") where.push(or(eq(R.public, true), eq(R.orgId, s.orgId))!, sql`${R.status} not in ('declined', 'duplicate')`);
  else where.push(eq(R.orgId, s.orgId));
  if (q.q?.trim()) where.push(ilike(R.title, `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
  const rows = await db.select().from(R).where(and(...where)).orderBy(q.view === "roadmap" ? desc(R.votes) : desc(R.updatedAt)).limit(300);
  return { requests: await shape(rows, { orgId: s.orgId, userId: s.userId }) };
}

/** What was released to this workspace (by request), newest first. */
export async function whatsNew(s: WScope) {
  const rows = await db.select().from(R).where(and(eq(R.status, "released"), or(sql`${R.release}->>'mode' = 'everyone'`, sql`${R.release}->'orgIds' ? ${s.orgId}`))).orderBy(desc(R.releasedAt)).limit(100);
  return { releases: await shape(rows, { orgId: s.orgId, userId: s.userId }) };
}

async function readable(s: WScope, id: string) {
  if (!isId(id)) throw notFound("Request");
  const [r] = await db.select().from(R).where(eq(R.id, id));
  const forUs = r?.release && (r.release.mode === "everyone" || r.release.orgIds.includes(s.orgId));
  if (!r || (r.orgId !== s.orgId && !r.public && !forUs)) throw notFound("Request");
  return r;
}

export async function detail(s: WScope, id: string) {
  const r = await readable(s, id);
  const [out] = await shape([r], { orgId: s.orgId, userId: s.userId });
  return { request: out!, notes: r.orgId === s.orgId ? await notesOf(r.id, false) : [] };
}

export async function create(s: WScope, raw: unknown) {
  const v = check(requestSchema, raw);
  const [r] = await db.insert(R).values({ orgId: s.orgId, userId: s.userId, ...v, votes: 1 }).returning();
  await db.insert(V).values({ requestId: r!.id, userId: s.userId, orgId: s.orgId }).onConflictDoNothing();
  await audit({ orgId: s.orgId, actorId: s.userId, action: "feature_request.created", targetType: "feature_request", targetId: r!.id, metadata: { number: r!.number } });
  await tellTeam(r!, s.userName);
  return { request: (await shape([r!], { orgId: s.orgId, userId: s.userId }))[0]! };
}

/** The Cloudesk team hears about every new request (by email; it's also counted in the console). */
async function tellTeam(r: Row, by: string) {
  const admins = await db.select({ email: schema.users.email }).from(schema.users).where(and(eq(schema.users.isPlatformAdmin, true), sql`coalesce(${schema.users.platformRole}, 'owner') in ('owner', 'admin', 'support')`));
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, r.orgId));
  for (const a of admins) {
    await sendMail({ to: a.email, subject: `Feature request #${r.number}: ${r.title}`, body: `${by} (${org?.name ?? "a workspace"}) asked for a feature — ${r.scope === "workspace" ? "for their workspace" : "for everyone"}, ${r.priority}.\n\n${r.problem}\n\nOpen it: ${appUrl(`/admin#requests/${r.id}`)}` }).catch(() => {});
  }
}

export async function update(s: WScope, id: string, raw: unknown) {
  const r = await readable(s, id);
  if (r.orgId !== s.orgId) throw notFound("Request");
  if (r.userId !== s.userId) throw new ApiError("forbidden", "Only the person who asked can change it — add a comment instead");
  if (r.status !== "submitted") throw new ApiError("conflict", "The team has started on it — add a comment instead");
  // Only what was sent changes (no defaults filled in).
  const sh = requestSchema.shape;
  const v = check(z.object({ title: sh.title.optional(), problem: sh.problem.optional(), details: z.string().trim().max(8000).optional(), area: z.string().regex(/^[a-z0-9-]{2,30}$/).optional(), priority: z.enum(["nice", "important", "critical"]).optional(), scope: z.enum(["workspace", "everyone"]).optional() }), raw);
  await db.update(R).set({ ...v, updatedAt: new Date() }).where(eq(R.id, r.id));
  return detail(s, id);
}

export async function withdraw(s: WScope, id: string) {
  const r = await readable(s, id);
  if (r.orgId !== s.orgId || r.userId !== s.userId) throw new ApiError("forbidden", "Only the person who asked can withdraw it");
  if (!STATUS_INFO[r.status as RequestStatus]?.open || r.status !== "submitted") throw new ApiError("conflict", "The team has started on it — add a comment to let them know instead");
  await db.delete(R).where(eq(R.id, r.id));
  return { ok: true };
}

export async function comment(s: WScope, id: string, raw: unknown) {
  const r = await readable(s, id);
  if (r.orgId !== s.orgId) throw new ApiError("forbidden", "Comments are for the workspace that asked — vote to show you want it too");
  const v = check(commentSchema, raw);
  await db.insert(N).values({ requestId: r.id, authorId: s.userId, body: v.body });
  await db.update(R).set({ updatedAt: new Date() }).where(eq(R.id, r.id));
  return { notes: await notesOf(r.id, false) };
}

export async function vote(s: WScope, id: string, on: boolean) {
  const r = await readable(s, id);
  if (on) {
    const ins = await db.insert(V).values({ requestId: r.id, userId: s.userId, orgId: s.orgId }).onConflictDoNothing().returning();
    if (ins.length) await db.update(R).set({ votes: sql`${R.votes} + 1` }).where(eq(R.id, r.id));
  } else {
    const del = await db.delete(V).where(and(eq(V.requestId, r.id), eq(V.userId, s.userId))).returning();
    if (del.length) await db.update(R).set({ votes: sql`greatest(${R.votes} - 1, 0)` }).where(eq(R.id, r.id));
  }
  const [x] = await db.select({ votes: R.votes }).from(R).where(eq(R.id, r.id));
  return { votes: x?.votes ?? 0, voted: on };
}

/** Release flags that are on for this workspace (for the browser: `useFlag(key)`). */
export async function flagsFor(orgId: string) {
  const rows = await db.select({ key: schema.featureFlags.key }).from(schema.featureFlags).where(or(eq(schema.featureFlags.enabled, true), sql`${schema.featureFlags.orgIds} ? ${orgId}`));
  return { flags: rows.map((r) => r.key) };
}

// ── The Cloudesk team ──────────────────────────────────────────────────────

async function adminShape(rows: Row[]): Promise<AdminRequestOut[]> {
  const base = await shape(rows, { orgId: null, userId: null });
  const orgs = rows.length ? await db.select({ id: schema.organizations.id, name: schema.organizations.name, plan: schema.organizations.plan }).from(schema.organizations).where(inArray(schema.organizations.id, [...new Set(rows.map((r) => r.orgId))])) : [];
  const uids = rows.map((r) => r.userId).filter((x): x is string => !!x);
  const users = uids.length ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, uids)) : [];
  const keys = rows.map((r) => r.flagKey).filter((x): x is string => !!x);
  const flags = keys.length ? await db.select().from(schema.featureFlags).where(inArray(schema.featureFlags.key, keys)) : [];
  const internal = rows.length ? await db.select({ id: N.requestId, n: sql<number>`count(*)::int` }).from(N).where(and(inArray(N.requestId, rows.map((r) => r.id)), eq(N.internal, true))).groupBy(N.requestId) : [];
  return rows.map((r, i) => {
    const f = flags.find((x) => x.key === r.flagKey);
    return {
      ...base[i]!,
      problem: r.problem,
      details: r.details,
      ours: false,
      org: orgs.find((o) => o.id === r.orgId) ?? { id: r.orgId, name: "Deleted workspace", plan: null },
      requester: users.find((u) => u.id === r.userId) ?? null,
      by: users.find((u) => u.id === r.userId)?.name ?? null,
      flagKey: r.flagKey,
      release: r.release,
      flag: f ? { enabled: f.enabled, orgIds: f.orgIds } : null,
      internalCount: internal.find((x) => x.id === r.id)?.n ?? 0,
    };
  });
}

export async function adminList(q: { status?: string; scope?: string; q?: string; org?: string; sort?: string }) {
  const where: SQL[] = [];
  if (q.status === "open") where.push(inArray(R.status, ["submitted", "under_review", "planned", "in_progress", "testing"]));
  else if (q.status && q.status !== "all") where.push(eq(R.status, q.status));
  if (q.scope === "workspace" || q.scope === "everyone") where.push(eq(R.scope, q.scope));
  if (q.org && isId(q.org)) where.push(eq(R.orgId, q.org));
  if (q.q?.trim()) {
    const t = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(R.title, t), ilike(R.problem, t), sql`${R.number}::text = ${q.q.trim().replace(/^#/, "")}`)!);
  }
  const order = q.sort === "votes" ? [desc(R.votes), desc(R.createdAt)] : q.sort === "priority" ? [sql`case ${R.priority} when 'critical' then 0 when 'important' then 1 else 2 end`, desc(R.createdAt)] : [desc(R.createdAt)];
  const rows = await db.select().from(R).where(where.length ? and(...where) : undefined).orderBy(...order).limit(500);
  const counts = await db.select({ status: R.status, n: sql<number>`count(*)::int` }).from(R).groupBy(R.status);
  return { requests: await adminShape(rows), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number> };
}

async function adminRow(id: string) {
  if (!isId(id)) throw notFound("Request");
  const [r] = await db.select().from(R).where(eq(R.id, id));
  if (!r) throw notFound("Request");
  return r;
}

export async function adminDetail(id: string) {
  const r = await adminRow(id);
  const voters = await db.select({ orgId: V.orgId, n: sql<number>`count(*)::int` }).from(V).where(eq(V.requestId, r.id)).groupBy(V.orgId);
  return { request: (await adminShape([r]))[0]!, notes: await notesOf(r.id, true), voterWorkspaces: voters.length, suggestedKey: r.flagKey ?? suggestKey(r.number, r.title) };
}

/** People to tell about a request: who asked, and colleagues who voted for it in that workspace. */
async function watchers(r: Row) {
  const v = await db.select({ u: V.userId }).from(V).where(and(eq(V.requestId, r.id), eq(V.orgId, r.orgId)));
  return [...new Set([r.userId, ...v.map((x) => x.u)].filter((x): x is string => !!x))];
}

export async function adminUpdate(adminId: string, id: string, raw: unknown) {
  const r = await adminRow(id);
  const v = check(adminUpdateSchema.extend({ title: requestSchema.shape.title.optional() }), raw);
  if (v.status === "released") throw new ApiError("validation_failed", "Use Release to give it out — it switches the feature on where it should go");
  if (v.status === "duplicate" && !v.duplicateOf && !r.duplicateOf) throw new ApiError("validation_failed", "Pick the request it duplicates", { duplicateOf: ["Which one?"] });
  if (v.duplicateOf) {
    if (v.duplicateOf === r.id) throw new ApiError("validation_failed", "A request can't duplicate itself");
    await adminRow(v.duplicateOf);
  }
  const set: Partial<Row> = { updatedAt: new Date() };
  if (v.title) set.title = v.title;
  if (v.status) set.status = v.status;
  if (v.reply !== undefined) set.reply = v.reply;
  if (v.eta !== undefined) set.eta = v.eta;
  if (v.public !== undefined) set.public = v.public;
  if (v.duplicateOf !== undefined) set.duplicateOf = v.duplicateOf;
  if (v.duplicateOf) set.status = "duplicate";
  await db.update(R).set(set).where(eq(R.id, r.id));
  const changed = set.status && set.status !== r.status;
  if (changed) await db.insert(N).values({ requestId: r.id, authorId: adminId, kind: "status", fromTeam: true, body: v.note && !v.internal ? v.note : "", meta: { from: r.status, to: set.status } });
  else if (v.note) await db.insert(N).values({ requestId: r.id, authorId: adminId, fromTeam: true, internal: v.internal, body: v.note });
  if (changed && v.note && v.internal) await db.insert(N).values({ requestId: r.id, authorId: adminId, fromTeam: true, internal: true, body: v.note });
  // Moving a duplicate's votes to the one it duplicates (each person once).
  if (v.duplicateOf && v.duplicateOf !== r.duplicateOf) {
    await db.execute(sql`insert into feature_request_votes (request_id, user_id, org_id) select ${v.duplicateOf}, user_id, org_id from feature_request_votes where request_id = ${r.id} on conflict do nothing`);
    await db.execute(sql`update feature_requests set votes = (select count(*) from feature_request_votes where request_id = ${v.duplicateOf}) where id = ${v.duplicateOf}`);
  }
  await audit({ actorId: adminId, orgId: r.orgId, action: "platform.feature_request_updated", targetType: "feature_request", targetId: r.id, metadata: { status: set.status, public: v.public } });
  // Tell them when something they'd care about changed: the status, or a message (not internal notes).
  if (changed || (v.note && !v.internal) || (v.reply !== undefined && v.reply !== r.reply)) {
    const st = STATUS_INFO[(set.status ?? r.status) as RequestStatus];
    const link = `/requests/${r.id}`;
    await notify(r.orgId, await watchers(r), { kind: "feature.updated", title: changed ? `Feature request #${r.number} is ${st.label.toLowerCase()}` : `The Cloudesk team replied on #${r.number}`, body: `${set.title ?? r.title}${v.note && !v.internal ? `\n\n${v.note}` : v.reply ? `\n\n${v.reply}` : ""}`, link, values: { number: String(r.number), title: set.title ?? r.title, status: st.label, link } });
  }
  return adminDetail(id);
}

export async function adminComment(adminId: string, id: string, raw: unknown) {
  return adminUpdate(adminId, id, { note: (raw as { body?: string })?.body ?? "", internal: !!(raw as { internal?: boolean })?.internal });
}

/**
 * Give the finished feature out: its release flag goes on for everyone, or
 * for the chosen workspaces (added to whoever already has it). The request
 * is marked released, and the people in those workspaces are told.
 */
export async function release(adminId: string, id: string, raw: unknown) {
  const r = await adminRow(id);
  const v = check(releaseSchema, raw);
  if (r.status === "declined" || r.status === "duplicate") throw new ApiError("conflict", "Reopen it first — it's closed");
  let orgIds: string[] = [];
  if (v.mode === "workspaces") {
    if (!v.orgIds.length) throw new ApiError("validation_failed", "Pick at least one workspace", { orgIds: ["Which ones?"] });
    orgIds = (await db.select({ id: schema.organizations.id }).from(schema.organizations).where(inArray(schema.organizations.id, v.orgIds))).map((o) => o.id);
    if (orgIds.length !== new Set(v.orgIds).size) throw new ApiError("validation_failed", "Some of those workspaces don't exist");
  }
  const [taken] = await db.select({ id: R.id, number: R.number }).from(R).where(and(eq(R.flagKey, v.flagKey), sql`${R.id} <> ${r.id}`));
  const [flag] = await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, v.flagKey));
  const merged = [...new Set([...(flag?.orgIds ?? []), ...orgIds])];
  await saveFlag(adminId, { key: v.flagKey, description: `#${r.number} ${r.title}`.slice(0, 300), enabled: v.mode === "everyone" || !!flag?.enabled, orgIds: v.mode === "everyone" ? (flag?.orgIds ?? []) : merged });
  const rel = { mode: v.mode === "everyone" || flag?.enabled ? ("everyone" as const) : ("workspaces" as const), orgIds: v.mode === "everyone" ? [] : merged, notes: v.notes, by: adminId, at: new Date().toISOString() };
  await db.update(R).set({ status: "released", flagKey: v.flagKey, release: rel, releasedAt: new Date(), updatedAt: new Date() }).where(eq(R.id, r.id));
  await db.insert(N).values({ requestId: r.id, authorId: adminId, kind: "release", fromTeam: true, body: v.notes, meta: { mode: rel.mode, workspaces: rel.orgIds.length, flag: v.flagKey, sharedWith: taken ? taken.number : null } });
  await audit({ actorId: adminId, orgId: r.orgId, action: "platform.feature_released", targetType: "feature_request", targetId: r.id, metadata: { flag: v.flagKey, mode: rel.mode, workspaces: rel.orgIds.length } });
  // Who to tell: the people who asked (always), and — if announcing — everyone in the workspaces that got it.
  const link = `/requests/${r.id}`;
  const tell = async (orgId: string, users: string[]) => notify(orgId, users, { kind: "feature.released", title: `Now live: ${r.title}`, body: v.notes || `Feature request #${r.number} has been released${rel.mode === "everyone" ? " for everyone" : " for your workspace"}.`, link, values: { number: String(r.number), title: r.title, link } });
  const told = await watchers(r);
  await tell(r.orgId, told);
  if (v.announce) {
    const targets = rel.mode === "everyone" ? [] : rel.orgIds; // A release to everyone is announced in What's new, not by notifying every person on the platform.
    for (const o of targets) {
      const people = (await db.select({ u: schema.memberships.userId }).from(schema.memberships).where(eq(schema.memberships.orgId, o))).map((m) => m.u);
      await tell(o, o === r.orgId ? people.filter((u) => !told.includes(u)) : people);
    }
  }
  return adminDetail(id);
}

/** Take it back: off for everyone, or out of chosen workspaces. The request goes back to Testing. */
export async function rollback(adminId: string, id: string, raw: unknown) {
  const r = await adminRow(id);
  if (!r.flagKey) throw new ApiError("conflict", "It hasn't been released through a flag");
  const v = check(releaseSchema.pick({ orgIds: true }).extend({ all: z.boolean().default(true) }), raw);
  const [flag] = await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, r.flagKey));
  const left = v.all ? [] : (flag?.orgIds ?? []).filter((o) => !v.orgIds.includes(o));
  await saveFlag(adminId, { key: r.flagKey, description: flag?.description ?? `#${r.number} ${r.title}`, enabled: v.all ? false : !!flag?.enabled, orgIds: left });
  const still = !v.all && (!!flag?.enabled || left.length > 0);
  await db.update(R).set({ status: still ? "released" : "testing", release: still && r.release ? { ...r.release, orgIds: left } : null, releasedAt: still ? r.releasedAt : null, updatedAt: new Date() }).where(eq(R.id, r.id));
  await db.insert(N).values({ requestId: r.id, authorId: adminId, kind: "status", fromTeam: true, internal: true, body: v.all ? "Release rolled back everywhere" : `Removed from ${v.orgIds.length} workspace(s)`, meta: { from: "released", to: still ? "released" : "testing" } });
  await audit({ actorId: adminId, orgId: r.orgId, action: "platform.feature_rolled_back", targetType: "feature_request", targetId: r.id, metadata: { flag: r.flagKey, all: v.all } });
  return adminDetail(id);
}

/** Workspaces to pick from when releasing (search by name). */
export async function workspacesFor(q: string) {
  const t = `%${q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return { workspaces: await db.select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug }).from(schema.organizations).where(q.trim() ? or(ilike(schema.organizations.name, t), ilike(schema.organizations.slug, t)) : undefined).orderBy(schema.organizations.name).limit(30) };
}

