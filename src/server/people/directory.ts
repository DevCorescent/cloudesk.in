// The people directory: usernames, your profile (username, phone, whether
// you can be found), and search — for inviting someone to a workspace or a
// conversation by their username, their email or phone number, or a contact
// the workspace already has.
//
// Privacy: an email or phone number only finds an account on an exact match,
// a username matches as you type; people who switched discovery off are only
// found by their own workspaces' members; and an account's email and phone
// are never sent back to the person searching.
import { and, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { GUEST_DOMAIN } from "@/lib/chat/guests";
import { phoneDigits, profileSchema, readQuery, suggestUsername, type PersonHit } from "@/lib/people/model";
import { ApiError } from "../http/errors";

const U = schema.users;
const realAccount = and(sql`${U.email} not like ${`%@${GUEST_DOMAIN}`}`, isNull(U.disabledAt));

async function free(handle: string, except?: string) {
  const [hit] = await db
    .select({ id: U.id })
    .from(U)
    .where(and(sql`lower(${U.username}) = ${handle.toLowerCase()}`, except ? ne(U.id, except) : undefined))
    .limit(1);
  return !hit;
}

/** A username nobody has, starting from `base` ("kabir.shah", then "kabir.shah2", …). */
export async function uniqueUsername(base: string, except?: string) {
  if (await free(base, except)) return base;
  for (let n = 2; n < 50; n++) {
    const next = `${base.slice(0, 27)}${n}`;
    if (await free(next, except)) return next;
  }
  return `${base.slice(0, 22)}.${Math.random().toString(36).slice(2, 8)}`;
}

/** The person's username, giving them one first if they have none (accounts made before usernames). */
export async function ensureUsername(userId: string) {
  const [u] = await db.select({ username: U.username, name: U.name, email: U.email }).from(U).where(eq(U.id, userId));
  if (!u) throw new ApiError("not_found", "Account not found");
  if (u.username) return u.username;
  for (let tries = 0; tries < 3; tries++) {
    const handle = await uniqueUsername(suggestUsername(u.name, u.email));
    try {
      const [set] = await db.update(U).set({ username: handle }).where(and(eq(U.id, userId), isNull(U.username))).returning({ username: U.username });
      if (set?.username) return set.username;
      const [again] = await db.select({ username: U.username }).from(U).where(eq(U.id, userId));
      if (again?.username) return again.username;
    } catch {
      // Someone took it between the check and the write: try the next one.
    }
  }
  throw new ApiError("conflict", "Couldn't pick a username — set one in Settings → Account");
}

export async function getProfile(userId: string) {
  const username = await ensureUsername(userId);
  const [u] = await db.select({ name: U.name, email: U.email, phone: U.phone, discoverable: U.discoverable }).from(U).where(eq(U.id, userId));
  return { name: u!.name, email: u!.email, username, phone: u!.phone, discoverable: u!.discoverable };
}

export async function updateProfile(userId: string, raw: unknown) {
  const v = profileSchema.safeParse(raw);
  if (!v.success) throw new ApiError("validation_failed", "Check the highlighted fields", Object.fromEntries(v.error.issues.map((i) => [String(i.path[0] ?? "form"), [i.message]])));
  const p = v.data;
  if (p.username !== undefined && !(await free(p.username, userId))) throw new ApiError("validation_failed", "That username is taken", { username: ["That username is taken — try another"] });
  const set: Partial<typeof U.$inferInsert> = {};
  if (p.name !== undefined) set.name = p.name;
  if (p.username !== undefined) set.username = p.username;
  if (p.phone !== undefined) set.phone = p.phone;
  if (p.discoverable !== undefined) set.discoverable = p.discoverable;
  if (Object.keys(set).length) {
    try {
      await db.update(U).set(set).where(eq(U.id, userId));
    } catch {
      throw new ApiError("validation_failed", "That username is taken", { username: ["That username is taken — try another"] });
    }
  }
  return getProfile(userId);
}

/** Can this username be taken? (For the field in Settings, as you type.) */
export async function usernameFree(userId: string, raw: string) {
  const v = profileSchema.shape.username.safeParse(raw);
  if (!v.success || !v.data) return { ok: false, reason: v.success ? "Pick a username" : (v.error.issues[0]?.message ?? "Not a valid username") };
  return (await free(v.data, userId)) ? { ok: true } : { ok: false, reason: "Taken — try another" };
}

/**
 * Search for people to invite to this workspace (or one of its conversations).
 * Accounts first (marked when they're already members or invited), then the
 * workspace's own contacts with an email, then the typed email itself.
 */
export async function findPeople(orgId: string, actorId: string, raw: string, opts: { contacts?: boolean } = {}): Promise<{ results: PersonHit[] }> {
  const q = readQuery(raw);
  if (q.kind === "none") return { results: [] };
  const coMember = sql`exists (select 1 from memberships m where m.org_id = ${orgId} and m.user_id = ${U.id})`;
  // People who'd rather not be found are still found by their own workspaces.
  const findable = or(eq(U.discoverable, true), coMember);
  let match;
  if (q.kind === "email") match = sql`lower(${U.email}) = ${q.value}`;
  else if (q.kind === "phone") match = sql`right(regexp_replace(${U.phone}, '\\D', '', 'g'), 10) = ${q.value}`;
  else {
    const like = `${q.value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // A username as you type; a name only among this workspace's members.
    match = or(ilike(U.username, like), and(coMember, or(ilike(U.name, like), ilike(U.name, `% ${like}`))));
  }
  const accounts = await db
    .select({
      id: U.id,
      name: U.name,
      username: U.username,
      member: sql<boolean>`${coMember}`,
      invited: sql<boolean>`exists (select 1 from invitations i where i.org_id = ${orgId} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and (i.user_id = ${U.id} or lower(i.email) = lower(${U.email})))`,
    })
    .from(U)
    .where(and(realAccount, findable, match, ne(U.id, actorId)))
    .orderBy(sql`${coMember} desc`, U.name)
    .limit(8);
  const results: PersonHit[] = [];
  for (const a of accounts) results.push({ kind: "account", id: a.id, name: a.name, username: a.username ?? (await ensureUsername(a.id)), member: !!a.member, invited: !!a.invited });

  // The workspace's own contacts (people it already knows) — for inviting by email.
  if (opts.contacts !== false && q.kind !== "phone") {
    const term = q.kind === "email" ? q.value : `%${q.value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const crm = await db.execute(
      q.kind === "email"
        ? sql`select name, email from crm_contacts where org_id = ${orgId} and lower(email) = ${term} and not do_not_contact limit 5`
        : sql`select name, email from crm_contacts where org_id = ${orgId} and email <> '' and not do_not_contact and (name ilike ${term} or email ilike ${term}) order by name limit 5`,
    );
    const mail = await db.execute(
      q.kind === "email"
        ? sql`select name, email from mail_contacts where org_id = ${orgId} and lower(email) = ${term} limit 5`
        : sql`select name, email from mail_contacts where org_id = ${orgId} and (name ilike ${term} or email ilike ${term}) order by favorite desc, email_count desc limit 5`,
    );
    const seen = new Set<string>();
    for (const [rows, source] of [[crm.rows, "CRM"], [mail.rows, "Mail"]] as const) {
      for (const r of rows as { name: string; email: string }[]) {
        const key = r.email.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push({ kind: "contact", key: `${source}:${key}`, name: r.name || r.email, email: r.email, source });
      }
    }
  } else if (q.kind === "phone" && opts.contacts !== false) {
    const crm = await db.execute(sql`select name, email from crm_contacts where org_id = ${orgId} and email <> '' and not do_not_contact and right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${q.value} limit 5`);
    for (const r of crm.rows as { name: string; email: string }[]) results.push({ kind: "contact", key: `CRM:${r.email.toLowerCase()}`, name: r.name || r.email, email: r.email, source: "CRM" });
  }
  // An email with no account and no contact: invite it as typed.
  if (q.kind === "email" && !results.some((r) => r.kind === "account" || (r.kind === "contact" && r.email.toLowerCase() === q.value))) results.push({ kind: "email", email: q.value });
  return { results };
}

/** The account behind a search result, for inviting it (its email stays on the server). */
export async function accountFor(userId: string) {
  const [u] = await db.select({ id: U.id, name: U.name, email: U.email, username: U.username }).from(U).where(and(eq(U.id, userId), realAccount));
  if (!u) throw new ApiError("not_found", "That account isn't available");
  return u;
}

export { phoneDigits };
