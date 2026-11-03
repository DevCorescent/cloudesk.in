// The briefing AI mode opens with: what's on today, what needs the person,
// and what to do next — gathered straight from the workspace (no model call,
// so it's instant and free), each item read as them and within their role.
// Suggestions and follow-up questions are prompts the copilot then acts on.
import { and, asc, count, eq, gte, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Scope } from "./core";

export type BriefItem = { text: string; sub?: string; href?: string; tone?: "danger" | "warning" | "info" };
export type BriefSuggestion = { label: string; prompt: string };
export type Briefing = {
  today: BriefItem[];
  attention: BriefItem[];
  suggestions: BriefSuggestion[];
  updates: BriefSuggestion[];
  counts: { meetings: number; replies: number; overdueInvoices: number; overdueTasks: number };
};

const IST = 5.5 * 3_600_000;
const istDay = (t = Date.now()) => new Date(t + IST).toISOString().slice(0, 10);
const istTime = (d: string | Date) => new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const istWhen = (d: string | Date) => {
  const day = istDay(new Date(d).getTime());
  const label = day === istDay() ? "Today" : day === istDay(Date.now() + 86_400_000) ? "Tomorrow" : new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
  return `${label} ${istTime(d)}`;
};
const rupees = (paise: number) => {
  const r = paise / 100;
  return r >= 1e7 ? `₹${(r / 1e7).toFixed(2)} Cr` : r >= 1e5 ? `₹${(r / 1e5).toFixed(2)} L` : `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Each part is independent: one module failing (or switched off) leaves the rest of the briefing intact. */
const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await f();
  } catch {
    return fallback;
  }
};

export async function briefing(s: Scope): Promise<Briefing> {
  const out: Briefing = { today: [], attention: [], suggestions: [], updates: [], counts: { meetings: 0, replies: 0, overdueInvoices: 0, overdueTasks: 0 } };
  const today = istDay();

  // ── Calendar: the next 36 hours ──────────────────────────────────────────
  await safe(async () => {
    if (!s.has("calendar") || !s.ctx.can("calendar:use")) return;
    const { range } = await import("../calendar/core");
    const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, s.userId));
    const r = await range({ orgId: s.orgId, userId: s.userId, userName: u?.name ?? "", userEmail: u?.email ?? "", has: s.has }, { from: new Date().toISOString(), to: new Date(Date.now() + 36 * 3_600_000).toISOString() });
    const events = r.events.filter((e) => !e.allDay).slice(0, 5);
    out.counts.meetings = events.length;
    for (const e of events) out.today.push({ text: e.title, sub: `${istWhen(e.start)}${e.meetingUrl ? " · video call" : ""}`, href: `/calendar?event=${e.id}` });
    const next = events[0];
    if (next && Date.parse(next.start) - Date.now() < 3 * 3_600_000) out.suggestions.push({ label: `Prepare for “${next.title}”`, prompt: `Help me prepare for my meeting “${next.title}” (${istWhen(next.start)}): who's involved, what's open with them in the CRM, recent emails, and what I should cover.` });
  }, undefined);

  // ── Tasks due: CRM follow-ups and project tasks ──────────────────────────
  await safe(async () => {
    const A = schema.crmActivities;
    const endOfToday = new Date(`${today}T23:59:59+05:30`);
    const crm = s.has("crm") ? await db.select({ subject: A.subject, dueAt: A.dueAt, contactId: A.contactId, dealId: A.dealId }).from(A).where(and(eq(A.orgId, s.orgId), eq(A.kind, "task"), isNull(A.doneAt), eq(A.ownerId, s.userId), lte(A.dueAt, endOfToday))).orderBy(asc(A.dueAt)).limit(6) : [];
    const T = schema.workTasks;
    const work = s.has("work") ? await db.select({ title: T.title, dueDate: T.dueDate, projectId: T.projectId }).from(T).where(and(eq(T.orgId, s.orgId), eq(T.assigneeId, s.userId), ne(T.status, "done"), lte(T.dueDate, today))).orderBy(asc(T.dueDate)).limit(6) : [];
    const overdue = crm.filter((t) => t.dueAt && istDay(t.dueAt.getTime()) < today).length + work.filter((t) => t.dueDate && t.dueDate < today).length;
    out.counts.overdueTasks = overdue;
    for (const t of crm.slice(0, 3)) out.today.push({ text: t.subject || "Follow-up", sub: t.dueAt && istDay(t.dueAt.getTime()) < today ? "Follow-up · overdue" : "Follow-up · due today", href: t.dealId ? `/crm/deals/${t.dealId}` : t.contactId ? `/crm/contacts/${t.contactId}` : "/crm/tasks", tone: t.dueAt && istDay(t.dueAt.getTime()) < today ? "warning" : undefined });
    for (const t of work.slice(0, 3)) out.today.push({ text: t.title, sub: t.dueDate && t.dueDate < today ? `Task · overdue since ${t.dueDate}` : "Task · due today", href: `/work/projects/${t.projectId}`, tone: t.dueDate && t.dueDate < today ? "warning" : undefined });
    if (overdue) out.suggestions.push({ label: `Sort out ${plural(overdue, "overdue task")}`, prompt: "List my overdue tasks and follow-ups, and help me decide what to do with each — do it now, move the date, or hand it off." });
  }, undefined);

  // ── Email waiting for a reply ────────────────────────────────────────────
  await safe(async () => {
    const { scopeFor } = await import("../mail/access");
    const m = await scopeFor(s.orgId, s.userId);
    if (!m) return;
    const { threads } = await import("../mail/core");
    const r = await threads(m, { account: "all", view: "needsreply" });
    const n = r.threads.length;
    out.counts.replies = n;
    if (n) {
      const top = r.threads[0]!;
      out.attention.push({ text: `${plural(n, "email")} waiting for your reply`, sub: `Latest: “${top.subject || "(no subject)"}” from ${top.participants[0]?.name || top.participants[0]?.address || "someone"}`, href: "/mail?view=needsreply", tone: "info" });
      out.suggestions.push({ label: n === 1 ? "Draft the reply" : `Draft replies to ${Math.min(n, 3)} emails`, prompt: "Look at the emails waiting for my reply, summarise each in a line, and draft replies to the most important ones for me to check and send." });
    }
  }, undefined);

  // ── Money: overdue invoices ──────────────────────────────────────────────
  await safe(async () => {
    if (!s.ctx.can("invoices:manage")) return;
    const { invoiceBooks } = await import("../org/org");
    const { listDocs } = await import("../invoicing/service");
    let n = 0;
    let owed = 0;
    let oldest: { client: string; due: string } | null = null;
    for (const b of (await invoiceBooks(s.orgId)).slice(0, 5)) {
      const docs = (await listDocs(b.id, { type: "invoice", status: "overdue" })) as unknown as { client: { name: string }; total: number; amountPaid: number; dueDate: string | null }[];
      for (const d of docs) {
        n++;
        owed += d.total - d.amountPaid;
        if (d.dueDate && (!oldest || d.dueDate < oldest.due)) oldest = { client: d.client?.name ?? "", due: d.dueDate };
      }
    }
    out.counts.overdueInvoices = n;
    if (n) {
      out.attention.push({ text: `${plural(n, "invoice")} overdue · ${rupees(owed)}`, sub: oldest ? `Oldest: ${oldest.client}, due ${oldest.due}` : undefined, href: "/finance", tone: "danger" });
      out.suggestions.push({ label: `Chase ${rupees(owed)} owed`, prompt: "Show my overdue invoices and draft polite payment reminder emails to each client, firmer for the oldest ones." });
    }
  }, undefined);

  // ── Deals: what to ask them about ────────────────────────────────────────
  await safe(async () => {
    if (!s.has("crm") || !s.ctx.can("crm:read")) return;
    const D = schema.crmDeals;
    const stale = await db
      .select({ id: D.id, title: D.title, value: D.value, expectedClose: D.expectedClose })
      .from(D)
      .where(and(eq(D.orgId, s.orgId), eq(D.status, "open"), or(eq(D.ownerId, s.userId), isNull(D.ownerId)), lt(D.updatedAt, new Date(Date.now() - 7 * 86_400_000))))
      .orderBy(sql`${D.value} desc`)
      .limit(2);
    for (const d of stale) out.updates.push({ label: `Any news on “${d.title}”?`, prompt: `I have an update on the deal “${d.title}” (${rupees(d.value)}). Ask me what's happened since, then log it as a note and suggest the next step.` });
    const closing = await db.select({ title: D.title, expectedClose: D.expectedClose, value: D.value }).from(D).where(and(eq(D.orgId, s.orgId), eq(D.status, "open"), gte(D.expectedClose, today), lte(D.expectedClose, istDay(Date.now() + 7 * 86_400_000)))).limit(3);
    if (closing.length) out.attention.push({ text: `${plural(closing.length, "deal")} expected to close this week`, sub: closing.map((c) => `${c.title} (${rupees(c.value)})`).join(" · "), href: "/crm/deals" });
  }, undefined);

  // ── Setting up: the first gaps ───────────────────────────────────────────
  await safe(async () => {
    const { companies } = await import("../org/org");
    const [co] = await companies(s.orgId);
    if (co && (!co.legalName || !co.address) && (s.role === "owner" || s.role === "admin")) out.suggestions.push({ label: "Finish my business details", prompt: "Help me set up my workspace: check what's missing, ask me for it, and save it." });
    const [boxes] = await db.select({ n: count() }).from(schema.mailAccounts).where(eq(schema.mailAccounts.orgId, s.orgId));
    if (!boxes?.n && s.has("mail")) out.suggestions.push({ label: "Connect my email", prompt: "How do I connect my Gmail or Outlook here, and what will you be able to do with it?" });
    const [team] = await db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.orgId, s.orgId));
    if ((team?.n ?? 1) <= 1 && (s.role === "owner" || s.role === "admin")) out.suggestions.push({ label: "Invite my team", prompt: "I want to invite people to my team. Ask me for their emails and roles, then send the invitations." });
  }, undefined);

  // Always something useful to ask for.
  if (!out.updates.length) out.updates.push({ label: "I have an update to log", prompt: "I have an update to record. Ask me what happened, then save it in the right place (a CRM note, a task or a calendar event)." });
  out.updates.push({ label: "Plan my day", prompt: "Plan my day: look at my meetings, tasks, emails waiting and money owed, and give me a prioritised list with times." });
  out.suggestions = out.suggestions.slice(0, 4);
  return out;
}
