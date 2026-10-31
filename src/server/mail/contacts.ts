// The address book: the workspace's shared contacts and groups, used to pick
// who an email goes to. Suggestions as you type draw on the address book and
// its groups, CRM contacts, teammates and the people you've emailed — ranked
// by how often you write to them. Groups expand to their members when sending.
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ContactOut, ContactsOut, GroupOut, Suggestion } from "@/lib/mail/api";
import { target } from "@/lib/import/targets";
import { ApiError, notFound } from "../http/errors";
import { runImport, str } from "../import/run";
import { accountIds, check, type Scope } from "./access";

const C = schema.mailContacts;
const G = schema.mailContactGroups;
const GM = schema.mailContactGroupMembers;
const esc = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
const email = z.string().trim().toLowerCase().pipe(z.email("Check the email"));

const contactSchema = z.object({
  name: z.string().trim().max(120).default(""),
  email,
  company: z.string().trim().max(160).default(""),
  title: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  notes: z.string().max(4000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  favorite: z.boolean().default(false),
  groupIds: z.array(z.uuid()).max(50).default([]),
});
const groupSchema = z.object({ name: z.string().trim().min(1, "Name the group").max(60), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2563eb"), description: z.string().trim().max(300).default("") });

async function groupsOf(orgId: string): Promise<GroupOut[]> {
  const rows = await db
    .select({ id: G.id, name: G.name, color: G.color, description: G.description, count: sql<number>`(select count(*)::int from mail_contact_group_members m where m.group_id = ${G.id})` })
    .from(G)
    .where(eq(G.orgId, orgId))
    .orderBy(asc(G.name));
  return rows.map((g) => ({ ...g, count: Number(g.count) }));
}

const out = (c: typeof C.$inferSelect, groupIds: string[]): ContactOut => ({ id: c.id, name: c.name, email: c.email, company: c.company, title: c.title, phone: c.phone, notes: c.notes, tags: c.tags, favorite: c.favorite, groupIds, lastEmailedAt: c.lastEmailedAt?.toISOString() ?? null, emailCount: c.emailCount });

export async function listContacts(s: Scope, q: Record<string, string>): Promise<ContactsOut> {
  const conds = [eq(C.orgId, s.orgId)];
  const find = (q.q ?? "").trim().slice(0, 100);
  if (find) conds.push(or(ilike(C.name, esc(find)), ilike(C.email, esc(find)), ilike(C.company, esc(find)), sql`${find.toLowerCase()} = any(${C.tags})`)!);
  if (q.group && /^[0-9a-f-]{36}$/i.test(q.group)) conds.push(sql`exists (select 1 from mail_contact_group_members m where m.contact_id = ${C.id} and m.group_id = ${q.group})`);
  if (q.favorites === "1") conds.push(eq(C.favorite, true));
  const rows = await db.select().from(C).where(and(...conds)).orderBy(desc(C.favorite), asc(sql`lower(coalesce(nullif(${C.name}, ''), ${C.email}))`)).limit(2000);
  const links = rows.length ? await db.select().from(GM).where(inArray(GM.contactId, rows.map((r) => r.id))) : [];
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(C).where(eq(C.orgId, s.orgId));
  return { contacts: rows.map((r) => out(r, links.filter((l) => l.contactId === r.id).map((l) => l.groupId))), groups: await groupsOf(s.orgId), total: Number(total) };
}

async function setGroups(orgId: string, contactId: string, groupIds: string[]) {
  const valid = groupIds.length ? (await db.select({ id: G.id }).from(G).where(and(eq(G.orgId, orgId), inArray(G.id, groupIds)))).map((g) => g.id) : [];
  await db.delete(GM).where(eq(GM.contactId, contactId));
  if (valid.length) await db.insert(GM).values(valid.map((groupId) => ({ groupId, contactId }))).onConflictDoNothing();
}

export async function saveContact(s: Scope, id: string | null, raw: unknown) {
  const v = check(contactSchema, raw);
  const values = { name: v.name, email: v.email, company: v.company, title: v.title, phone: v.phone, notes: v.notes, tags: [...new Set(v.tags.map((t) => t.toLowerCase()))], favorite: v.favorite };
  const [dup] = await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), sql`lower(${C.email}) = ${v.email}`));
  if (dup && dup.id !== id) throw new ApiError("conflict", `${v.email} is already in your contacts`, { email: ["Already saved"] });
  let row: typeof C.$inferSelect | undefined;
  if (id) [row] = await db.update(C).set(values).where(and(eq(C.id, id), eq(C.orgId, s.orgId))).returning();
  else [row] = await db.insert(C).values({ orgId: s.orgId, createdBy: s.userId, ...values }).returning();
  if (!row) throw notFound("Contact");
  await setGroups(s.orgId, row.id, v.groupIds);
  return { contact: out(row, v.groupIds) };
}

export async function deleteContacts(s: Scope, ids: string[]) {
  if (!ids.length) return { count: 0 };
  const r = await db.delete(C).where(and(eq(C.orgId, s.orgId), inArray(C.id, ids))).returning({ id: C.id });
  return { count: r.length };
}

const bulkSchema = z.object({ ids: z.array(z.uuid()).min(1).max(2000), action: z.enum(["addToGroup", "removeFromGroup", "favorite", "unfavorite", "delete"]), groupId: z.uuid().optional() });

export async function bulkContacts(s: Scope, raw: unknown) {
  const v = check(bulkSchema, raw);
  const ids = (await db.select({ id: C.id }).from(C).where(and(eq(C.orgId, s.orgId), inArray(C.id, v.ids)))).map((r) => r.id);
  if (v.action === "delete") return deleteContacts(s, ids);
  if (v.action === "favorite" || v.action === "unfavorite") {
    await db.update(C).set({ favorite: v.action === "favorite" }).where(inArray(C.id, ids.length ? ids : [crypto.randomUUID()]));
    return { count: ids.length };
  }
  const [g] = v.groupId ? await db.select().from(G).where(and(eq(G.id, v.groupId), eq(G.orgId, s.orgId))) : [];
  if (!g) throw new ApiError("validation_failed", "Pick a group");
  if (v.action === "addToGroup" && ids.length) await db.insert(GM).values(ids.map((contactId) => ({ groupId: g.id, contactId }))).onConflictDoNothing();
  if (v.action === "removeFromGroup" && ids.length) await db.delete(GM).where(and(eq(GM.groupId, g.id), inArray(GM.contactId, ids)));
  return { count: ids.length };
}

export async function saveGroup(s: Scope, id: string | null, raw: unknown) {
  const v = check(groupSchema, raw);
  const [dup] = await db.select({ id: G.id }).from(G).where(and(eq(G.orgId, s.orgId), sql`lower(${G.name}) = ${v.name.toLowerCase()}`));
  if (dup && dup.id !== id) throw new ApiError("conflict", `There's already a group called ${v.name}`, { name: ["Already used"] });
  if (id) {
    const r = await db.update(G).set(v).where(and(eq(G.id, id), eq(G.orgId, s.orgId))).returning({ id: G.id });
    if (!r.length) throw notFound("Group");
    return { id };
  }
  const [g] = await db.insert(G).values({ orgId: s.orgId, createdBy: s.userId, ...v }).returning({ id: G.id });
  return { id: g!.id };
}

export async function deleteGroup(s: Scope, id: string) {
  const r = await db.delete(G).where(and(eq(G.id, id), eq(G.orgId, s.orgId))).returning({ id: G.id });
  if (!r.length) throw notFound("Group");
}

/** Contacts from a spreadsheet: name, email, company, title, phone, tags and groups (made if new). */
export async function importContacts(s: Scope, raw: unknown) {
  return runImport(target("mail.contacts"), raw, async (v, mode) => {
    const em = check(email, str(v.email));
    const groups = str(v.groups).split(/[,;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
    const groupIds: string[] = [];
    for (const name of groups) {
      const [g] = await db.select({ id: G.id }).from(G).where(and(eq(G.orgId, s.orgId), sql`lower(${G.name}) = ${name.toLowerCase()}`));
      groupIds.push(g?.id ?? (await db.insert(G).values({ orgId: s.orgId, createdBy: s.userId, name: name.slice(0, 60) }).returning({ id: G.id }))[0]!.id);
    }
    const values = { name: str(v.name).slice(0, 120), company: str(v.company).slice(0, 160), title: str(v.title).slice(0, 120), phone: str(v.phone).slice(0, 40), tags: str(v.tags).split(/[,;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20) };
    const [have] = await db.select().from(C).where(and(eq(C.orgId, s.orgId), sql`lower(${C.email}) = ${em}`));
    if (have) {
      if (mode === "skip") return "skipped";
      await db.update(C).set({ name: values.name || have.name, company: values.company || have.company, title: values.title || have.title, phone: values.phone || have.phone, tags: [...new Set([...have.tags, ...values.tags])] }).where(eq(C.id, have.id));
      if (groupIds.length) await db.insert(GM).values(groupIds.map((groupId) => ({ groupId, contactId: have.id }))).onConflictDoNothing();
      return "updated";
    }
    const [c] = await db.insert(C).values({ orgId: s.orgId, createdBy: s.userId, email: em, ...values }).returning({ id: C.id });
    if (groupIds.length) await db.insert(GM).values(groupIds.map((groupId) => ({ groupId, contactId: c!.id }))).onConflictDoNothing();
    return "created";
  });
}

/** A group's members, for sending. */
export async function expandGroups(orgId: string, groupIds: string[]) {
  if (!groupIds.length) return [];
  return db.select({ name: C.name, email: C.email }).from(C).innerJoin(GM, eq(GM.contactId, C.id)).innerJoin(G, eq(G.id, GM.groupId)).where(and(eq(G.orgId, orgId), inArray(G.id, groupIds)));
}

/** The groups' names and colours, for showing who an email went to. */
export async function groupsNamed(orgId: string, groupIds: string[]) {
  if (!groupIds.length) return [];
  return db.select({ id: G.id, name: G.name, color: G.color }).from(G).where(and(eq(G.orgId, orgId), inArray(G.id, groupIds)));
}

/** Records that these addresses were emailed (it ranks suggestions). */
export async function touchContacts(orgId: string, emails: string[]) {
  if (!emails.length) return;
  await db.update(C).set({ lastEmailedAt: new Date(), emailCount: sql`${C.emailCount} + 1` }).where(and(eq(C.orgId, orgId), inArray(sql`lower(${C.email})`, emails.map((e) => e.toLowerCase()))));
}

/** The address book's name (and company) for an address, for {{first_name}} and friends. */
export async function contactNamed(orgId: string, address: string) {
  const [c] = await db.select({ name: C.name, company: C.company }).from(C).where(and(eq(C.orgId, orgId), sql`lower(${C.email}) = ${address.toLowerCase()}`));
  return c ?? null;
}

/** Who to send to, as you type: groups, the address book, CRM contacts, teammates and people you've emailed. */
export async function suggest(s: Scope, q: Record<string, string>): Promise<{ suggestions: Suggestion[] }> {
  const find = (q.q ?? "").trim().toLowerCase().slice(0, 100);
  const like = esc(find);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (x: Suggestion) => {
    const key = x.kind === "group" ? `g:${x.id}` : x.email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(x);
  };
  const groups = await db.select({ id: G.id, name: G.name, color: G.color, count: sql<number>`(select count(*)::int from mail_contact_group_members m where m.group_id = ${G.id})` }).from(G).where(and(eq(G.orgId, s.orgId), find ? ilike(G.name, like) : sql`true`)).orderBy(asc(G.name)).limit(find ? 5 : 3);
  for (const g of groups) add({ kind: "group", id: g.id, name: g.name, email: "", color: g.color, count: Number(g.count), source: "Group" });
  const book = await db.select().from(C).where(and(eq(C.orgId, s.orgId), find ? or(ilike(C.name, like), ilike(C.email, like), ilike(C.company, like)) : sql`true`)).orderBy(desc(C.favorite), desc(C.emailCount), asc(C.name)).limit(8);
  for (const c of book) add({ kind: "person", id: c.id, name: c.name, email: c.email, company: c.company, source: c.favorite ? "Favourite" : "Contacts" });
  if (find.length >= 1) {
    // People you've written to or heard from, most frequent first.
    const ids = await accountIds(s);
    if (ids.length) {
      const people = (await db.execute(sql`select p->>'address' as email, max(p->>'name') as name, count(*)::int as n
          from mail_threads t, jsonb_array_elements(t.participants) p
          where t.account_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) and t.status <> 'spam' and (lower(p->>'address') like ${like} or lower(p->>'name') like ${like})
          group by 1 order by n desc limit 8`)).rows as { email: string; name: string | null }[];
      for (const p of people) add({ kind: "person", id: null, name: p.name ?? "", email: p.email, source: "Emailed" });
    }
    if (s.has("crm")) {
      const crm = await db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email }).from(schema.crmContacts).where(and(eq(schema.crmContacts.orgId, s.orgId), sql`${schema.crmContacts.email} <> ''`, or(ilike(schema.crmContacts.name, like), ilike(schema.crmContacts.email, like)))).limit(6);
      for (const c of crm) if (c.email) add({ kind: "person", id: null, name: c.name, email: c.email.toLowerCase(), source: "CRM" });
    }
    const team = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, s.orgId), or(ilike(schema.users.name, like), ilike(schema.users.email, like)))).limit(5);
    for (const t of team) add({ kind: "person", id: null, name: t.name, email: t.email.toLowerCase(), source: "Team" });
  }
  return { suggestions: out.slice(0, 14) };
}
