// Home's "Your desk": a quick look at My work, Mail, Calendar, Chat, Copilot,
// Notes, Documents and the Calculator for the signed-in member. Each block goes through
// its module's own access rules, is left out when the feature is off, not in
// the plan or not allowed for the role, and comes back null when it has
// nothing in it — so the page only shows features with at least one item.
import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { formulaById } from "@/lib/calculator/formulas";
import { can } from "../authz/permissions";
import { myWork } from "../approvals/inbox";
import { list as notifications } from "../notify/notify";
import { context, safely } from "./core";
import type { AuthedContext } from "../http/handler";

const HOUR = 3600_000;

export type Desk = {
  work: { approvals: number; todo: number; overdue: number; unread: number; items: { id: string; source: string; title: string; link: string; overdue: boolean; at: string | null }[] } | null;
  mail: { unread: number; needsReply: number; overdue: number; meetings: number; threads: { id: string; subject: string; from: string; snippet: string; at: string; unread: boolean; starred: boolean }[] } | null;
  calendar: { today: number; invites: number; minutes: number; events: { key: string; id: string; occurrence: string; provider: string | null; title: string; start: string; end: string; allDay: boolean; color: string; meetingUrl: string; location: string; attendees: number }[] } | null;
  chat: { unread: number; mentions: number; requests: number; channels: { id: string; kind: "channel" | "group" | "dm"; name: string; emoji: string; unread: number; mentions: number; preview: string; at: string | null }[] } | null;
  copilot: { threads: { id: string; title: string; at: string }[] } | null;
  notes: { pinned: number; reminders: number; items: { id: string; title: string; icon: string; snippet: string; pinned: boolean; remindAt: string | null; at: string; mine: boolean; owner: string | null }[] } | null;
  calculator: { total: number; pinned: number; entries: { id: string; input: string; result: string; note: string; pinned: boolean; kind: string; at: string }[] } | null;
  documents: { shared: number; items: { id: string; kind: "doc" | "file"; title: string; icon: string; snippet: string; mime: string; filename: string; at: string; owner: string; mine: boolean; shared: boolean }[] } | null;
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function desk(ctx: AuthedContext, orgId: string): Promise<Desk> {
  const c = await context(ctx, orgId);
  const who = { orgId, userId: c.userId };
  const [work, mail, calendar, chat, copilot, notes, calculator, documents] = await Promise.all([
    safely("desk:work", orgId, async () => {
      const [w, n] = await Promise.all([myWork(ctx, orgId), notifications(orgId, c.userId, { unread: true, limit: 4 })]);
      const items = [
        ...w.approvals.map((a) => ({ id: `a-${a.id}`, source: a.kindLabel ?? "Approval", title: a.label, link: a.link || "/inbox", overdue: !!a.overdue, at: null })),
        ...w.todo.map((t) => ({ id: `t-${t.id}`, source: t.source, title: t.title, link: t.link, overdue: t.overdue, at: t.due })),
        ...n.items.map((x) => ({ id: `n-${x.id}`, source: "Notification", title: x.title, link: x.link || "/inbox", overdue: false, at: iso(x.createdAt) })),
      ];
      // Overdue first, then approvals, then the rest as they came.
      items.sort((a, b) => Number(b.overdue) - Number(a.overdue));
      if (!items.length) return null;
      return { approvals: w.counts.approvals, todo: w.counts.todo, overdue: w.counts.overdue, unread: n.unread, items: items.slice(0, 5) };
    }),

    c.on("mail")
      ? safely("desk:mail", orgId, async () => {
          const { scope, accountIds } = await import("../mail/access");
          const { countsFor } = await import("../mail/core");
          const s = await scope(ctx, orgId);
          const ids = await accountIds(s);
          if (!ids.length) return null;
          const T = schema.mailThreads;
          const now = new Date();
          const shown = and(inArray(T.accountId, ids), eq(T.status, "inbox"), or(isNull(T.snoozeUntil), lte(T.snoozeUntil, now)));
          // Unread first; if everything's read, the latest conversations.
          const [counts, unread] = await Promise.all([countsFor(ids, c.userId), db.select().from(T).where(and(shown, gt(T.unread, 0))).orderBy(desc(T.lastMessageAt)).limit(4)]);
          const rows = unread.length >= 4 ? unread : [...unread, ...(await db.select().from(T).where(and(shown, eq(T.unread, 0))).orderBy(desc(T.lastMessageAt)).limit(4 - unread.length))];
          if (!rows.length) return null;
          return {
            unread: counts.unread,
            needsReply: counts.needsReply,
            overdue: counts.overdue,
            meetings: counts.meetings,
            threads: rows.map((t) => {
              const p = t.participants[0];
              return { id: t.id, subject: t.subject || "(no subject)", from: p?.name || p?.address || "", snippet: t.snippet, at: t.lastMessageAt.toISOString(), unread: t.unread > 0, starred: t.starred };
            }),
          };
        })
      : null,

    c.on("calendar")
      ? safely("desk:calendar", orgId, async () => {
          const { calScope } = await import("../calendar/access");
          const { meta, range } = await import("../calendar/core");
          const s = await calScope(ctx, orgId);
          const now = Date.now();
          const [r, m] = await Promise.all([range(s, { from: new Date(now - 12 * HOUR).toISOString(), to: new Date(now + 7 * 24 * HOUR).toISOString() }), meta(s)]);
          const live = r.events.filter((e) => e.status !== "cancelled" && e.response !== "declined" && Date.parse(e.end) > now);
          const endOfToday = Date.parse(`${new Date(now + 5.5 * HOUR).toISOString().slice(0, 10)}T23:59:59+05:30`);
          if (!live.length && !m.invites.length && !m.notesDue.length) return null;
          return {
            today: live.filter((e) => Date.parse(e.start) <= endOfToday).length,
            invites: m.invites.length,
            minutes: m.notesDue.length,
            events: live.slice(0, 4).map((e) => ({ key: e.key, id: e.id, occurrence: e.occurrence, provider: e.provider, title: e.title, start: e.start, end: e.end, allDay: e.allDay, color: e.color, meetingUrl: e.meetingUrl, location: e.location, attendees: e.attendees })),
          };
        })
      : null,

    c.on("chat")
      ? safely("desk:chat", orgId, async () => {
          const { chatScope } = await import("../chat/access");
          const { meta } = await import("../chat/core");
          const m = await meta(await chatScope(ctx, orgId));
          const names = new Map([...m.people, ...m.guests].map((p) => [p.id, p.name]));
          const mine = m.channels.filter((ch) => ch.member && !ch.archived && ch.lastMessageAt);
          if (!mine.length) return null;
          // Mentions, then unread, then the most recent.
          const order = [...mine].sort((a, b) => b.mentions - a.mentions || Number(b.unread > 0) - Number(a.unread > 0) || (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
          return {
            unread: m.counts.unread,
            mentions: m.counts.mentions,
            requests: m.counts.requests,
            channels: order.slice(0, 4).map((ch) => ({
              id: ch.id,
              kind: ch.kind,
              name: ch.kind === "channel" ? ch.name : ch.name || ch.people.map((p) => names.get(p) ?? "Someone").join(", "),
              emoji: ch.emoji,
              unread: ch.unread,
              mentions: ch.mentions,
              preview: ch.lastPreview,
              at: ch.lastMessageAt,
            })),
          };
        })
      : null,

    c.on("copilot") && can(c.role, "copilot:use")
      ? safely("desk:copilot", orgId, async () => {
          const T = schema.copilotThreads;
          const rows = await db.select({ id: T.id, title: T.title, updatedAt: T.updatedAt }).from(T).where(and(eq(T.orgId, orgId), eq(T.userId, c.userId))).orderBy(desc(T.updatedAt)).limit(3);
          return rows.length ? { threads: rows.map((t) => ({ id: t.id, title: t.title || "Untitled conversation", at: t.updatedAt.toISOString() })) } : null;
        })
      : null,

    safely("desk:notes", orgId, async () => {
      const { list, overview } = await import("../notes/core");
      const [items, o] = await Promise.all([list(who, { limit: 4 }), overview(who)]);
      if (!items.length) return null;
      return {
        pinned: o.counts.pinned,
        reminders: o.counts.reminders,
        items: items.map((n) => ({ id: n.id, title: n.title || "Untitled", icon: n.icon, snippet: n.snippet, pinned: n.pinned, remindAt: iso(n.remindAt), at: n.updatedAt.toISOString(), mine: n.mine, owner: n.owner })),
      };
    }),

    safely("desk:calculator", orgId, async () => {
      const { list, counts } = await import("../calculator/history");
      const [entries, n] = await Promise.all([list(who, { limit: 4 }), counts(who)]);
      if (!entries.length) return null;
      return { total: n.total, pinned: n.pinned, entries: entries.map((e) => ({ id: e.id, input: e.kind === "formula" ? (formulaById(e.input)?.name ?? e.input) : e.input, result: e.result, note: e.note, pinned: e.pinned, kind: e.kind, at: e.createdAt.toISOString() })) };
    }),

    // Documents you opened lately, and how many were shared with you this week.
    c.on("documents") && can(c.role, "doc:read")
      ? safely("desk:documents", orgId, async () => {
          const { getSettings } = await import("../documents/access");
          const { list, recentDocs } = await import("../documents/drive");
          const ds = { orgId, userId: c.userId, role: c.role, write: can(c.role, "doc:write"), manage: can(c.role, "doc:manage"), settings: await getSettings(orgId), has: c.on };
          const [recent, shared] = await Promise.all([recentDocs(ds, 4), list(ds, { section: "shared", modified: "week" })]);
          if (!recent.length && !shared.files.length) return null;
          const items = recent.length ? recent : shared.files.slice(0, 4);
          return { shared: shared.files.length, items: items.map((f) => ({ id: f.id, kind: f.kind, title: f.title, icon: f.icon, snippet: f.snippet.slice(0, 140), mime: f.mime, filename: f.filename, at: "openedAt" in f ? String(f.openedAt) : f.updatedAt, owner: f.owner, mine: f.mine, shared: f.shared })) };
        })
      : null,
  ]);
  return { work, mail, calendar, chat, copilot, notes, calculator, documents };
}
