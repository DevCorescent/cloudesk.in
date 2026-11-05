// Notifications: one call tells people something happened — in the app (the
// bell and the inbox) and by email — following each person's preferences and
// the workspace's own wording. Emails go through the outbox, so delivery is
// only claimed when a mail service actually sent them.
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { isGuestEmail } from "@/lib/chat/guests";
import { fill, NOTIFICATION_KINDS, prefsSchema, reminderSchema, templateSchema, type NotificationKind } from "@/lib/approvals/model";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { appUrl, sendMail } from "../services/mail";

/** `email: false` keeps it in the app only (when a fuller email goes separately, like a payment receipt). */
export type Notice = { kind: NotificationKind; title: string; body?: string; link?: string; values?: Record<string, string>; email?: false };

async function prefsOf(orgId: string, userIds: string[]) {
  const rows = userIds.length ? await db.select().from(schema.notificationPrefs).where(and(eq(schema.notificationPrefs.orgId, orgId), inArray(schema.notificationPrefs.userId, userIds))) : [];
  return new Map(rows.map((r) => [r.userId, r.prefs]));
}

/** Tell these people. Never throws: a notification failing must not undo the work that caused it. */
export async function notify(orgId: string, userIds: (string | null | undefined)[], n: Notice) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  try {
    const [users, prefs, [tpl], [org]] = await Promise.all([
      db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids)),
      prefsOf(orgId, ids),
      db.select().from(schema.notificationTemplates).where(and(eq(schema.notificationTemplates.orgId, orgId), eq(schema.notificationTemplates.kind, n.kind))),
      db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId)),
    ]);
    const link = n.link ?? "";
    let sent = 0;
    // Chat guests have no inbox or notifications page: nothing goes to them.
    for (const u of users.filter((x) => !isGuestEmail(x.email))) {
      const p = prefs.get(u.id)?.[n.kind] ?? {};
      const values = { title: n.title, body: n.body ?? "", link: link ? appUrl(link) : "", name: u.name, workspace: org?.name ?? "", ...n.values };
      const title = tpl ? fill(tpl.subject, values) : n.title;
      const body = tpl ? fill(tpl.body, values) : (n.body ?? "");
      let emailId: string | null = null;
      if (n.email !== false && (p.email ?? NOTIFICATION_KINDS[n.kind].email) && u.email) {
        emailId = await sendMail({ to: u.email, subject: title, body: `${body}${body ? "\n\n" : ""}${link ? `Open it: ${appUrl(link)}` : ""}`.trim(), fromName: org?.name }).catch(() => null);
      }
      if (p.app ?? true) await db.insert(schema.notifications).values({ orgId, userId: u.id, kind: n.kind, title, body, link, emailId });
      sent++;
    }
    return sent;
  } catch (e) {
    log.warn("notify failed", { orgId, kind: n.kind, error: String(e) });
    return 0;
  }
}

export async function list(orgId: string, userId: string, opts: { unread?: boolean; limit?: number } = {}) {
  const rows = await db
    .select({ n: schema.notifications, delivery: schema.outboundEmails.status, transport: schema.outboundEmails.transport })
    .from(schema.notifications)
    .leftJoin(schema.outboundEmails, eq(schema.outboundEmails.id, schema.notifications.emailId))
    .where(and(eq(schema.notifications.orgId, orgId), eq(schema.notifications.userId, userId), opts.unread ? isNull(schema.notifications.readAt) : undefined))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  const [{ unread }] = await db.select({ unread: sql<number>`count(*)::int` }).from(schema.notifications).where(and(eq(schema.notifications.orgId, orgId), eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  // Email delivery as it really is: recorded only (no mail service), sent, retrying or failed.
  return { unread, items: rows.map((r) => ({ ...r.n, email: r.n.emailId ? (r.transport === "outbox" ? "recorded" : (r.delivery ?? "queued")) : null })) };
}

export async function markRead(orgId: string, userId: string, ids: string[] | "all") {
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.orgId, orgId), eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt), ids === "all" ? undefined : inArray(schema.notifications.id, ids.slice(0, 500))));
}

export async function getPrefs(orgId: string, userId: string) {
  const [row] = await db.select().from(schema.notificationPrefs).where(and(eq(schema.notificationPrefs.orgId, orgId), eq(schema.notificationPrefs.userId, userId)));
  const saved = row?.prefs ?? {};
  return Object.fromEntries(Object.entries(NOTIFICATION_KINDS).map(([k, d]) => [k, { label: d.label, app: saved[k]?.app ?? true, email: saved[k]?.email ?? d.email }]));
}

export async function savePrefs(orgId: string, userId: string, raw: unknown) {
  const r = prefsSchema.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", "Check the settings");
  const prefs = Object.fromEntries(Object.entries(r.data).filter(([k]) => k in NOTIFICATION_KINDS));
  await db.insert(schema.notificationPrefs).values({ orgId, userId, prefs }).onConflictDoUpdate({ target: [schema.notificationPrefs.orgId, schema.notificationPrefs.userId], set: { prefs, updatedAt: new Date() } });
  return getPrefs(orgId, userId);
}

export async function templates(orgId: string) {
  const rows = await db.select().from(schema.notificationTemplates).where(eq(schema.notificationTemplates.orgId, orgId));
  return Object.entries(NOTIFICATION_KINDS).map(([kind, d]) => {
    const t = rows.find((r) => r.kind === kind);
    return { kind, label: d.label, fields: ["title", "body", "link", "name", "workspace", ...d.fields], subject: t?.subject ?? null, body: t?.body ?? null };
  });
}

export async function saveTemplate(orgId: string, kind: string, raw: unknown | null) {
  if (!(kind in NOTIFICATION_KINDS)) throw notFound("Notification type");
  if (raw === null) {
    await db.delete(schema.notificationTemplates).where(and(eq(schema.notificationTemplates.orgId, orgId), eq(schema.notificationTemplates.kind, kind)));
    return;
  }
  const r = templateSchema.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the wording");
  await db.insert(schema.notificationTemplates).values({ orgId, kind, ...r.data }).onConflictDoUpdate({ target: [schema.notificationTemplates.orgId, schema.notificationTemplates.kind], set: { ...r.data, updatedAt: new Date() } });
}

// ── Reminders ────────────────────────────────────────────────────────────────

export async function addReminder(orgId: string, userId: string, raw: unknown) {
  const r = reminderSchema.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the reminder");
  if (Date.parse(r.data.at) < Date.now() - 60_000) throw new ApiError("validation_failed", "Pick a time in the future", { at: ["In the past"] });
  const [row] = await db.insert(schema.reminders).values({ orgId, userId, at: new Date(r.data.at), title: r.data.title, note: r.data.note, link: r.data.link }).returning();
  return row;
}

export async function myReminders(orgId: string, userId: string) {
  return db.select().from(schema.reminders).where(and(eq(schema.reminders.orgId, orgId), eq(schema.reminders.userId, userId), isNull(schema.reminders.sentAt))).orderBy(schema.reminders.at);
}

export async function deleteReminder(orgId: string, userId: string, id: string) {
  await db.delete(schema.reminders).where(and(eq(schema.reminders.id, id), eq(schema.reminders.orgId, orgId), eq(schema.reminders.userId, userId)));
}

/** Send reminders that are due. Each is claimed first, so two runs never send one twice. */
export async function sendDueReminders(now = new Date()) {
  const due = await db.update(schema.reminders).set({ sentAt: now }).where(and(isNull(schema.reminders.sentAt), lte(schema.reminders.at, now))).returning();
  for (const r of due) await notify(r.orgId, [r.userId], { kind: "reminder", title: r.title, body: r.note, link: r.link, values: { note: r.note } });
  return due.length;
}
