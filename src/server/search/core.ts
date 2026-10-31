// Smart search: records across every module this person can open (customers,
// deals, invoices, items, people, tickets, orders, students, patients,
// contracts, custom records, web apps), each kind behind the same module
// switch and permission its own screens use. Whether the AI answer mode is
// available — and if not, what's missing — comes from here too.
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hasLlm } from "../ai/gateway";
import { can, type Role } from "../authz/permissions";
import { scopeFor, type Scope } from "../bi/core";
import { search as copilotSearch } from "../copilot/core";
import { SEARCH_KINDS } from "@/lib/copilot/model";
import { requireOrg, type AuthedContext } from "../http/handler";

export type Hit = { kind: string; label: string; sub: string; link: string; id: string };

/** What each kind is called in results. */
export const KIND_LABEL: Record<string, string> = {
  contacts: "Contacts", deals: "Deals", suppliers: "Suppliers", items: "Items", employees: "People", projects: "Projects", invoices: "Invoices", tickets: "Tickets",
  orders: "Sales orders", students: "Students", patients: "Patients", contracts: "Contracts", records: "Your records", webapps: "Web apps",
  notes: "Notes", documents: "Documents", emails: "Email", events: "Meetings", messages: "Chat", channels: "Channels", tasks: "Tasks", members: "Team",
};

/** Typing a kind's name ("invoices", "my notes", "meetings") lists its latest records. */
const BROWSE: Record<string, string> = {
  invoice: "invoices", invoices: "invoices", bill: "invoices", bills: "invoices",
  note: "notes", notes: "notes",
  doc: "documents", docs: "documents", document: "documents", documents: "documents", files: "documents", drive: "documents",
  email: "emails", emails: "emails", mail: "emails", inbox: "emails",
  meeting: "events", meetings: "events", event: "events", events: "events", calendar: "events",
  task: "tasks", tasks: "tasks", todo: "tasks",
  ticket: "tickets", tickets: "tickets",
  order: "orders", orders: "orders",
  channel: "channels", channels: "channels", chat: "channels",
};

async function context(ctx: AuthedContext, orgId: string): Promise<{ s: Scope; role: Role }> {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  return { s: await scopeFor(orgId, ctx.user.id, role), role };
}

const like = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

export async function search(ctx: AuthedContext, orgId: string, raw: string): Promise<Hit[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return [];
  const { s } = await context(ctx, orgId);
  const t = like(q);
  const out: Hit[] = [];
  // Contacts, deals, suppliers, items, people and projects: the copilot's search, with its rules.
  // (Documents have their own block below, with snippets and "docs" browsing.)
  for (const h of await copilotSearch({ ...s, name: ctx.user.name }, q, SEARCH_KINDS.filter((k) => k !== "documents"))) {
    const [label, ...rest] = h.label.split(" · ");
    out.push({ kind: h.kind, id: h.id, label: label ?? h.label, sub: rest.join(" · "), link: h.link });
  }
  const tasks: Promise<void>[] = [];
  const add = (f: () => Promise<Hit[]>) => tasks.push(f().then((hits) => void out.push(...hits)));
  // "invoices", "my notes", "meetings": the latest of that kind, not a text match.
  const browse = BROWSE[q.toLowerCase().replace(/^(my|all|recent|latest|new)\s+/, "").trim()] ?? null;
  const me = ctx.user.id;
  const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const time = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

  // Notes: yours, shared with you, or shared with the workspace.
  add(async () => {
    const N = schema.notes;
    const readable = or(eq(N.ownerId, me), sql`${N.visibility} in ('view', 'edit')`, sql`exists (select 1 from ${schema.noteShares} where ${schema.noteShares.noteId} = ${N.id} and ${schema.noteShares.userId} = ${me})`);
    const match = browse === "notes" ? undefined : or(ilike(N.title, t), ilike(N.text, t));
    const rows = await db.select({ id: N.id, title: N.title, icon: N.icon, text: N.text, updatedAt: N.updatedAt }).from(N).where(and(eq(N.orgId, orgId), isNull(N.deletedAt), readable, match)).orderBy(sql`${N.updatedAt} desc`).limit(browse === "notes" ? 8 : 5);
    return rows.map((r) => {
      const body = r.text.slice(r.title.length).replace(/\s+/g, " ").trim();
      const i = body.toLowerCase().indexOf(q.toLowerCase());
      return { kind: "notes", id: r.id, label: `${r.icon ? `${r.icon} ` : ""}${r.title || "Untitled"}`, sub: (i > 30 ? `…${body.slice(i - 20, i + 80)}` : body.slice(0, 100)) || `Updated ${day(r.updatedAt)}`, link: `/notes/${r.id}` };
    });
  });
  // Documents and files: the drive's own rules (private, shared, folder access), text inside documents too.
  if (s.has("documents"))
    add(async () => {
      const { scope } = await import("../documents/access");
      const ds = await scope(ctx, orgId).catch(() => null);
      if (!ds) return [];
      const { list, recentDocs } = await import("../documents/drive");
      const files = browse === "documents" ? await recentDocs(ds, 8) : (await list(ds, { section: "search", q })).files.slice(0, 6);
      return files.map((f) => {
        const i = f.snippet.toLowerCase().indexOf(q.toLowerCase());
        const sub = f.kind === "doc" ? (i > 30 ? `…${f.snippet.slice(i - 20, i + 80)}` : f.snippet.slice(0, 100)) || `Edited ${day(new Date(f.updatedAt))}` : `${f.filename || "File"} · ${day(new Date(f.updatedAt))}`;
        return { kind: "documents", id: f.id, label: `${f.icon ? `${f.icon} ` : ""}${f.title}`, sub, link: f.kind === "doc" ? `/documents/d/${f.id}` : `/documents/file/${f.id}` };
      });
    });
  // Email: the mailboxes you own or that are shared with you.
  if (s.has("mail"))
    add(async () => {
      const M = schema.mailThreads;
      const A = schema.mailAccounts;
      const match = browse === "emails" ? undefined : or(ilike(M.subject, t), ilike(M.snippet, t));
      const rows = await db.select({ id: M.id, subject: M.subject, snippet: M.snippet }).from(M).innerJoin(A, eq(A.id, M.accountId)).where(and(eq(M.orgId, orgId), or(eq(A.ownerId, me), eq(A.shared, true)), match)).orderBy(sql`${M.lastMessageAt} desc`).limit(5);
      return rows.map((r) => ({ kind: "emails", id: r.id, label: r.subject || "(no subject)", sub: r.snippet.slice(0, 110), link: `/mail/t/${r.id}` }));
    });
  // Meetings in your calendar (upcoming first when browsing).
  if (s.has("calendar"))
    add(async () => {
      const E = schema.calEvents;
      const match = browse === "events" ? sql`${E.startsAt} >= now() - interval '1 day'` : or(ilike(E.title, t), ilike(E.location, t), ilike(E.description, t));
      const rows = await db.select({ id: E.id, title: E.title, startsAt: E.startsAt, location: E.location }).from(E).where(and(eq(E.orgId, orgId), eq(E.ownerId, me), sql`${E.status} <> 'cancelled'`, match)).orderBy(browse === "events" ? sql`${E.startsAt} asc` : sql`${E.startsAt} desc`).limit(5);
      return rows.map((r) => ({ kind: "events", id: r.id, label: r.title, sub: [`${day(r.startsAt)}, ${time(r.startsAt)}`, r.location].filter(Boolean).join(" · "), link: `/calendar?event=${r.id}&at=${encodeURIComponent(r.startsAt.toISOString())}` }));
    });
  // Chat: channels you can see, and messages in conversations you're in.
  if (s.has("chat")) {
    add(async () => {
      const C = schema.teamChannels;
      const match = browse === "channels" ? undefined : ilike(C.name, t);
      const rows = await db.select({ id: C.id, name: C.name, topic: C.topic }).from(C).where(and(eq(C.orgId, orgId), eq(C.kind, "channel"), eq(C.archived, false), match, or(eq(C.visibility, "public"), sql`exists (select 1 from ${schema.teamMembers} m where m.channel_id = ${C.id} and m.user_id = ${me})`))).limit(5);
      return rows.map((r) => ({ kind: "channels", id: r.id, label: `#${r.name}`, sub: r.topic || "Channel", link: `/chat/${r.id}` }));
    });
    if (!browse)
      add(async () => {
        const X = schema.teamMessages;
        const C = schema.teamChannels;
        const rows = await db.select({ id: X.id, body: X.body, channelId: X.channelId, name: C.name, kind: C.kind }).from(X).innerJoin(C, eq(C.id, X.channelId)).where(and(eq(X.orgId, orgId), isNull(X.deletedAt), ilike(X.body, t), sql`exists (select 1 from ${schema.teamMembers} m where m.channel_id = ${X.channelId} and m.user_id = ${me})`)).orderBy(sql`${X.seq} desc`).limit(5);
        return rows.map((r) => {
          const i = r.body.toLowerCase().indexOf(q.toLowerCase());
          return { kind: "messages", id: r.id, label: (i > 40 ? `…${r.body.slice(i - 30, i + 90)}` : r.body.slice(0, 110)).replace(/\s+/g, " "), sub: r.kind === "channel" ? `#${r.name}` : "Direct message", link: `/chat/${r.channelId}?m=${r.id}` };
        });
      });
  }
  // Tasks in Projects.
  if (s.has("work") && s.ctx.can("work:read"))
    add(async () => {
      const T = schema.workTasks;
      const match = browse === "tasks" ? and(eq(T.assigneeId, me), sql`${T.status} <> 'done'`) : ilike(T.title, t);
      const rows = await db.select({ id: T.id, title: T.title, status: T.status, due: T.dueDate }).from(T).where(and(eq(T.orgId, orgId), match)).orderBy(browse === "tasks" ? sql`${T.dueDate} asc nulls last` : sql`${T.updatedAt} desc`).limit(5);
      return rows.map((r) => ({ kind: "tasks", id: r.id, label: r.title, sub: [r.status, r.due && `due ${r.due}`].filter(Boolean).join(" · "), link: `/work/tasks/${r.id}` }));
    });
  // People in the workspace.
  if (!browse)
    add(async () => {
      const U = schema.users;
      const rows = await db.select({ id: U.id, name: U.name, email: U.email, role: schema.memberships.role }).from(schema.memberships).innerJoin(U, eq(U.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), or(ilike(U.name, t), ilike(U.email, t)))).limit(5);
      return rows.map((r) => ({ kind: "members", id: r.id, label: r.name, sub: `${r.email} · ${r.role}`, link: "/team" }));
    });

  add(async () => {
    const P = schema.projects;
    return (await db.select({ id: P.id, name: P.name }).from(P).where(and(eq(P.orgId, orgId), isNull(P.archivedAt), ilike(P.name, t))).limit(5)).map((r) => ({ kind: "webapps", id: r.id, label: r.name, sub: "Web app", link: `/projects/${r.id}` }));
  });
  if (s.has("invoicing") && s.ctx.can("invoices:manage"))
    add(async () =>
      (
        await db.execute(sql`select d.id, d.number, d.type, d.total, d.amount_paid, d.status, d.client->>'name' as client, coalesce(o.book_id, o.project_id) as owner, o.book_id
        from invoice_documents d join invoice_owners o on o.id = d.project_id left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
        where coalesce(p.org_id, b.org_id) = ${orgId} and d.number <> '' and (${browse === "invoices"} or d.number ilike ${t} or d.client->>'name' ilike ${t}) order by d.issue_date desc limit 5`)
      ).rows.map((r) => {
        const x = r as { id: string; number: string; type: string; total: number; amount_paid: number; status: string; client: string | null; owner: string; book_id: string | null };
        const path = { invoice: "invoices", quote: "quotes", proforma: "proforma", credit_note: "credit-notes" }[x.type] ?? "invoices";
        return { kind: "invoices", id: x.id, label: `${x.number}${x.client ? ` · ${x.client}` : ""}`, sub: `₹${(Number(x.total) / 100).toLocaleString("en-IN")} · ${x.status}`, link: x.book_id ? `/finance/${x.owner}/${path}/${x.id}` : `/projects/${x.owner}/invoicing/${path}/${x.id}` };
      }),
    );
  if (s.has("helpdesk") && s.ctx.can("hd:read"))
    add(async () => {
      const T = schema.hdTickets;
      return (await db.select({ id: T.id, number: T.number, subject: T.subject, status: T.status, customer: T.customerName }).from(T).where(and(eq(T.orgId, orgId), browse === "tickets" ? undefined : or(ilike(T.subject, t), ilike(T.number, t), ilike(T.customerName, t), ilike(T.customerEmail, t)))).orderBy(sql`${T.createdAt} desc`).limit(5)).map((r) => ({ kind: "tickets", id: r.id, label: `${r.number} · ${r.subject}`, sub: [r.customer, r.status].filter(Boolean).join(" · "), link: `/helpdesk/tickets/${r.id}` }));
    });
  if (s.has("sales") && s.ctx.can("sales:read"))
    add(async () => {
      const O = schema.salesOrders;
      return (await db.select({ id: O.id, number: O.number, client: O.clientName, total: O.total, status: O.status }).from(O).where(and(eq(O.orgId, orgId), browse === "orders" ? undefined : or(ilike(O.number, t), ilike(O.clientName, t), ilike(O.reference, t)))).orderBy(sql`${O.createdAt} desc`).limit(5)).map((r) => ({ kind: "orders", id: r.id, label: `${r.number} · ${r.client}`, sub: `₹${(Number(r.total) / 100).toLocaleString("en-IN")} · ${r.status}`, link: `/sales/orders/${r.id}` }));
    });
  if (s.has("education") && s.ctx.can("edu:read"))
    add(async () => {
      const S = schema.eduStudents;
      return (await db.select({ id: S.id, name: S.name, no: S.admissionNo, guardian: S.guardianName }).from(S).where(and(eq(S.orgId, orgId), or(ilike(S.name, t), ilike(S.admissionNo, t), ilike(S.guardianName, t), ilike(S.guardianPhone, t)))).limit(5)).map((r) => ({ kind: "students", id: r.id, label: r.name, sub: [r.no, r.guardian].filter(Boolean).join(" · "), link: `/school/students/${r.id}` }));
    });
  if (s.has("clinic") && s.ctx.can("clinic:read"))
    add(async () => {
      const P = schema.clinicPatients;
      return (await db.select({ id: P.id, name: P.name, mrn: P.mrn, phone: P.phone }).from(P).where(and(eq(P.orgId, orgId), or(ilike(P.name, t), ilike(P.mrn, t), ilike(P.phone, t)))).limit(5)).map((r) => ({ kind: "patients", id: r.id, label: r.name, sub: [r.mrn, r.phone].filter(Boolean).join(" · "), link: `/clinic/patients/${r.id}` }));
    });
  if (s.has("construction") && s.ctx.can("con:read"))
    add(async () => {
      const K = schema.conContracts;
      return (await db.select({ id: K.id, name: K.name, client: K.client, wo: K.workOrderNo }).from(K).where(and(eq(K.orgId, orgId), or(ilike(K.name, t), ilike(K.client, t), ilike(K.workOrderNo, t)))).limit(5)).map((r) => ({ kind: "contracts", id: r.id, label: r.name, sub: [r.client, r.wo].filter(Boolean).join(" · "), link: `/construction/contracts/${r.id}` }));
    });
  if (s.has("objects") && s.ctx.can("custom:read"))
    add(async () => {
      const R = schema.customRecords;
      const O = schema.customObjects;
      return (await db.select({ id: R.id, title: R.title, seq: R.seq, obj: O.name, prefix: O.prefix, objectId: O.id }).from(R).innerJoin(O, eq(O.id, R.objectId)).where(and(eq(R.orgId, orgId), or(ilike(R.title, t), sql`${R.values}::text ilike ${t}`))).limit(5)).map((r) => ({ kind: "records", id: r.id, label: r.title || `${r.prefix}-${String(r.seq).padStart(4, "0")}`, sub: r.obj, link: `/objects/${r.objectId}/${r.id}` }));
    });
  await Promise.all(tasks);
  // Closest first within each kind: an exact or starting match beats one in the middle.
  const lq = q.toLowerCase();
  const rank = (h: Hit) => (h.label.toLowerCase() === lq ? 0 : h.label.toLowerCase().startsWith(lq) ? 1 : h.label.toLowerCase().includes(lq) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, 60);
}

/** Whether "Ask AI" can answer here, and if not, what would make it work. */
export async function aiStatus(ctx: AuthedContext, orgId: string) {
  const { s, role } = await context(ctx, orgId);
  const switchedOn = s.has("copilot");
  const allowed = can(role, "copilot:use");
  return {
    module: switchedOn,
    allowed,
    connected: await hasLlm(orgId),
    canEnable: can(role, "org:update"),
    canConnect: can(role, "secrets:manage"),
  };
}
