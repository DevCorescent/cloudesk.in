// Email waiting for a reply, handled from AI mode: each one with a draft made
// on request (using what the business told its AI), sent with one click as a
// reply to the latest message — through Mail's own send, with its undo
// window — or put away (done, or later). Everything runs as the person, in
// the mailboxes they can open.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError } from "../http/errors";
import type { Scope } from "./core";

const M = schema.mailMessages;

export type InboxItem = { id: string; subject: string; from: { name: string; address: string }; snippet: string; waitingSince: string | null; unread: boolean };

async function mail(s: Scope) {
  const { scopeFor } = await import("../mail/access");
  const m = await scopeFor(s.orgId, s.userId);
  if (!m) throw new ApiError("forbidden", "Mail isn't open to you");
  return m;
}

/** The emails waiting for this person's reply, oldest wait first. */
export async function inbox(s: Scope): Promise<{ connected: boolean; items: InboxItem[] }> {
  const { scopeFor, accountIds } = await import("../mail/access");
  const m = await scopeFor(s.orgId, s.userId);
  if (!m || !(await accountIds(m)).length) return { connected: false, items: [] };
  const { threads } = await import("../mail/core");
  const r = await threads(m, { account: "all", view: "needsreply" });
  return {
    connected: true,
    items: r.threads.slice(0, 12).map((t) => ({ id: t.id, subject: t.subject || "(no subject)", from: t.participants[0] ?? { name: "", address: "" }, snippet: t.snippet, waitingSince: t.awaitingSince, unread: t.unread > 0 })),
  };
}

const draftInput = z.object({ tone: z.enum(["friendly", "formal", "short"]).default("friendly"), instruction: z.string().trim().max(500).default("") });

/** A reply draft for one conversation, for the person to check (or send as is). */
export async function draft(s: Scope, threadId: string, raw: unknown) {
  const v = draftInput.safeParse(raw ?? {});
  if (!v.success) throw new ApiError("validation_failed", "Check the tone");
  const m = await mail(s);
  const { threadAi } = await import("../mail/ai");
  const { context } = await import("./knowledge");
  const [t] = await db.select({ subject: schema.mailThreads.subject }).from(schema.mailThreads).where(eq(schema.mailThreads.id, threadId));
  const out = await threadAi(m, threadId, { kind: "reply", ...v.data }, await context(s, t?.subject ?? ""));
  return { draft: out.draft ?? "" };
}

const replyInput = z.object({ body: z.string().trim().min(1, "Write the reply").max(20_000), all: z.boolean().default(false) });

/** Send a reply to the latest message from the other side (Mail's send: it waits a few seconds, so it can be undone). */
export async function reply(s: Scope, threadId: string, raw: unknown) {
  const v = replyInput.safeParse(raw);
  if (!v.success) throw new ApiError("validation_failed", v.error.issues[0]?.message ?? "Write the reply", { body: ["Required"] });
  const m = await mail(s);
  const { thread } = await import("../mail/access");
  const t = await thread(m, threadId);
  const [last] = await db.select().from(M).where(and(eq(M.threadId, t.id), eq(M.direction, "in"))).orderBy(desc(M.date)).limit(1);
  if (!last) throw new ApiError("conflict", "There's no message from them to reply to");
  const { send } = await import("../mail/send");
  const [acc] = await db.select({ address: schema.mailAccounts.address }).from(schema.mailAccounts).where(eq(schema.mailAccounts.id, t.accountId));
  const mine = (acc?.address ?? "").toLowerCase();
  const others = (xs: { address: string }[]) => xs.map((x) => x.address.toLowerCase()).filter((a) => a && a !== mine);
  const cc = v.data.all ? [...new Set([...others(last.to), ...others(last.cc)])].filter((a) => a !== last.fromAddress.toLowerCase()) : [];
  const r = await send(m, { accountId: t.accountId, mode: v.data.all ? "replyAll" : "reply", replyTo: last.id, to: [last.fromAddress], cc, body: v.data.body });
  return { messageId: r.message.id, threadId: r.message.threadId, sendAt: r.message.sendAt, link: `/mail/t/${r.message.threadId}` };
}

/** Undo a reply in the few seconds before it goes. */
export async function undo(s: Scope, messageId: string) {
  const m = await mail(s);
  const { cancel } = await import("../mail/send");
  return cancel(m, messageId);
}

const putAway = z.object({ action: z.enum(["done", "later"]) });

/** Done: archived (and read). Later: snoozed to tomorrow, 9 am India time. */
export async function settle(s: Scope, threadId: string, raw: unknown) {
  const v = putAway.safeParse(raw);
  if (!v.success) throw new ApiError("validation_failed", "Say done or later");
  const m = await mail(s);
  const { update } = await import("../mail/core");
  if (v.data.action === "done") await update(m, threadId, { status: "archived", read: true });
  else {
    const tomorrow = new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
    await update(m, threadId, { snoozeUntil: `${tomorrow}T09:00:00+05:30` });
  }
  return { ok: true };
}
