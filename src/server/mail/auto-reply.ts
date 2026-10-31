// Automatic replies (out of office). A mailbox can answer new mail on its own
// between two dates, but carefully (RFC 3834): never to mailing lists, robots,
// other auto-replies or suspicious mail; at most once every few days per
// sender; only to mail that arrived after it was switched on (so the first
// sync of an old inbox doesn't answer last month's mail); and optionally only
// to people you know. The reply goes out through the normal send job, marked
// Auto-Submitted, and doesn't count as answering the conversation.
import { eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { autoReplyActive, autoReplyAllowed, autoReplySchema, fillTemplate, type AutoReply, type Category } from "@/lib/mail/model";
import { enqueue } from "../jobs/queue";
import type { Account } from "./access";
import { signatureForSend } from "./signatures";
import { newMessageId } from "./transport";

/** One auto-reply per sender per this long. */
export const AUTO_REPLY_EVERY_MS = 4 * 86_400_000;

export function autoReplyOf(settings: Record<string, unknown>): (AutoReply & { enabledAt?: string }) | null {
  const raw = settings.autoReply as Record<string, unknown> | undefined;
  if (!raw) return null;
  const v = autoReplySchema.safeParse(raw);
  return v.success ? { ...v.data, enabledAt: typeof raw.enabledAt === "string" ? raw.enabledAt : undefined } : null;
}

type Incoming = {
  threadId: string;
  messageId: string;
  references: string;
  subject: string;
  date: Date;
  from: { name: string; address: string };
  replyTo: string;
  warnings: string[];
  headers: { autoSubmitted: string; precedence: string; listId: string; listUnsubscribe: string; autoResponseSuppress: string };
  known: () => Promise<boolean>;
};

/** Sends the mailbox's auto-reply to a message that just arrived, if it should get one. Returns whether it was queued. */
export async function maybeAutoReply(acc: Account, m: Incoming): Promise<boolean> {
  const ar = autoReplyOf(acc.settings);
  const now = new Date();
  if (!ar || acc.status === "paused" || !autoReplyActive(ar, now) || !autoReplyActive(ar, m.date)) return false;
  // Only mail that arrived after it was switched on, and recently.
  if (ar.enabledAt && m.date.getTime() < Date.parse(ar.enabledAt) - 60_000) return false;
  if (now.getTime() - m.date.getTime() > 2 * 86_400_000) return false;
  const [t] = await db.select({ status: schema.mailThreads.status, category: schema.mailThreads.category, muted: schema.mailThreads.muted }).from(schema.mailThreads).where(eq(schema.mailThreads.id, m.threadId));
  if (!t || t.status === "spam" || t.status === "trash") return false;
  const allowed = autoReplyAllowed({ from: m.from.address, ownAddress: acc.address, ...m.headers, category: t.category as Category, warnings: m.warnings });
  if (!allowed.ok) return false;
  if (ar.onlyKnown && !(await m.known())) return false;
  // At most once per sender every few days (claimed atomically, so two syncs can't both send).
  const to = (m.replyTo || m.from.address).toLowerCase();
  const R = schema.mailAutoReplies;
  const claimed = await db
    .insert(R)
    .values({ accountId: acc.id, address: to, sentAt: now })
    .onConflictDoUpdate({ target: [R.accountId, R.address], set: { sentAt: now }, setWhere: lt(R.sentAt, new Date(now.getTime() - AUTO_REPLY_EVERY_MS)) })
    .returning({ address: R.address });
  if (!claimed.length) return false;

  const values = { name: m.from.name, email: m.from.address, myName: acc.displayName };
  const subject = ar.subject ? fillTemplate(ar.subject, values) : `Re: ${m.subject.replace(/^re:\s*/i, "")}`;
  let body = fillTemplate(ar.body, values);
  const escape = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  let html = `<div style="white-space:pre-wrap">${escape(body)}</div>`;
  // The owner's reply signature for this mailbox (or the mailbox's plain one).
  const signature = await signatureForSend(acc.ownerId, acc.orgId, acc.id, "reply", undefined).catch(() => "legacy" as const);
  if (signature === "legacy") {
    const sig = acc.signature.trim();
    if (sig && !body.includes(sig)) body = `${body.trimEnd()}\n\n${sig}`;
    html = `<div style="white-space:pre-wrap">${escape(body)}</div>`;
  } else if (signature) {
    body = `${body.trimEnd()}\n\n-- \n${signature.text}`;
    html += `<div style="margin:18px 0 0">${signature.html}</div>`;
  }
  const [msg] = await db
    .insert(schema.mailMessages)
    .values({
      orgId: acc.orgId, accountId: acc.id, threadId: m.threadId, messageId: newMessageId(acc.address), inReplyTo: m.messageId, references: [m.references, m.messageId].filter(Boolean).join(" ").trim(),
      fromAddress: acc.address, fromName: acc.displayName, to: [{ name: m.from.name, address: to }], subject, date: now, snippet: body.replace(/\s+/g, " ").slice(0, 180), text: body, html,
      seen: true, direction: "out", sendStatus: "scheduled", sendAt: now, auto: true,
    })
    .returning({ id: schema.mailMessages.id });
  await enqueue("mail.send", { messageId: msg!.id }, { orgId: acc.orgId, maxAttempts: 3, dedupeKey: `mail.send:${msg!.id}` });
  return true;
}

/** Forget who had an auto-reply (when it's switched on again), so this absence answers everyone once. */
export async function resetAutoReplies(accountId: string) {
  await db.delete(schema.mailAutoReplies).where(eq(schema.mailAutoReplies.accountId, accountId));
}
