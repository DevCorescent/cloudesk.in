// Mail API for a workspace: mailboxes (detect, test, connect, OAuth sign-in,
// change, remove, sync), conversations (list, search, read, act, bulk, notes,
// links, AI, message details), sending (send, undo, retry), recurring emails, analytics, sender
// clean-up, rules, templates and export.
// Dispatches on "METHOD section :id sub", like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { scope } from "@/server/mail/access";
import { checkConnection, createAccount, deleteAccount, detect, updateAccount } from "@/server/mail/accounts";
import { briefing, threadAi } from "@/server/mail/ai";
import { analytics } from "@/server/mail/analytics";
import { addNote, attachment, bulk, deleteRule, deleteTemplate, detail, exportCsv, html, importTemplates, link, messageDetails, meta, rules, saveRule, saveTemplate, setSender, templates, threads, unsubscribe, update } from "@/server/mail/core";
import { cleanup, topSenders } from "@/server/mail/senders";
import { bulkContacts, deleteContacts, deleteGroup, importContacts, listContacts, saveContact, saveGroup, suggest } from "@/server/mail/contacts";
import { deleteSignature, listSignatures, saveSignature, setSignatureDefaults, uploadSignatureImage } from "@/server/mail/signatures";
import { startUrl } from "@/server/mail/oauth";
import { cancel, retry, send, testSend } from "@/server/mail/send";
import { chatLink, connections, linkTargets, toEvent, toNote, toTask, unlink } from "@/server/mail/links";
import { createSchedule, deleteSchedule, duplicateSchedule, getSchedule, listSchedules, scheduleAction, updateSchedule } from "@/server/mail/schedules";
import { enqueue } from "@/server/jobs/queue";
import { account } from "@/server/mail/access";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.unknown());
const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/i.test(x);

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (isId(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);
  // DELETE threads/:id/links/:linkId — the one four-part path.
  if (m === "DELETE" && section === "threads" && isId(id) && sub === "links" && slug[3]) return unlink(s, id!, slug[3]);

  switch (key) {
    case "GET meta":
      return meta(s);
    case "GET detect":
      await rateLimit(`mail-detect:${s.userId}`, 60, 10 * 60_000);
      return detect(qs.email ?? "");

    // Mailboxes
    case "POST accounts check":
      await rateLimit(`mail-check:${s.userId}`, 20, 10 * 60_000);
      return checkConnection(await body(ctx));
    case "POST accounts":
      await rateLimit(`mail-connect:${s.userId}`, 20, 60 * 60_000);
      return { account: await createAccount(s, await body(ctx)) };
    case "PATCH accounts :id":
      return { account: await updateAccount(s, id!, await body(ctx)) };
    case "DELETE accounts :id":
      await deleteAccount(s, id!);
      return { ok: true };
    case "POST accounts :id sync": {
      const a = await account(s, id!);
      await rateLimit(`mail-sync:${a.id}`, 30, 10 * 60_000);
      await enqueue("mail.sync", { accountId: a.id }, { orgId, priority: 20, dedupeKey: `mail.sync:${a.id}:now:${Math.floor(Date.now() / 10_000)}` });
      return { ok: true };
    }
    case "POST accounts :id test": {
      await rateLimit(`mail-test:${s.userId}`, 10, 60 * 60_000);
      return testSend(s, id!);
    }
    case "GET oauth google start":
    case "GET oauth microsoft start": {
      const { url, cookie } = startUrl(id as "google" | "microsoft", { orgId, userId: s.userId, loginHint: qs.email, shared: qs.shared === "1" && s.manage });
      return new Response(null, { status: 302, headers: { location: url, "set-cookie": cookie, "cache-control": "no-store" } });
    }

    // Conversations
    case "GET threads":
      return threads(s, qs);
    case "POST threads bulk":
      return bulk(s, await body(ctx));
    case "GET threads :id":
      return detail(s, id!);
    case "PATCH threads :id":
      return { thread: await update(s, id!, await body(ctx)) };
    case "POST threads :id notes":
      return addNote(s, id!, await body(ctx));
    case "POST threads :id link":
      return link(s, id!, await body(ctx));
    case "POST threads :id unsubscribe":
      return unsubscribe(s, id!);
    case "POST threads :id ai":
      await rateLimit(`mail-ai:${s.userId}`, 60, 60 * 60_000);
      return threadAi(s, id!, await body(ctx));
    case "POST ai briefing":
      await rateLimit(`mail-ai:${s.userId}`, 60, 60 * 60_000);
      return briefing(s);
    case "POST senders":
      return setSender(s, await body(ctx));
    case "GET senders top":
      return topSenders(s, qs);
    case "POST senders cleanup":
      await rateLimit(`mail-cleanup:${s.userId}`, 120, 60 * 60_000);
      return cleanup(s, await body(ctx));
    case "GET analytics":
      await rateLimit(`mail-analytics:${s.userId}`, 240, 60 * 60_000);
      return analytics(s, qs);
    case "GET messages :id details":
      return messageDetails(s, id!);
    case "GET messages :id html":
      return html(s, id!, qs.images === "1");
    case "GET attachments :id":
      return attachment(s, id!);

    // Sending
    // Into the rest of Cloudesk: notes, calendar, tasks, chat
    case "GET link-targets":
      return linkTargets(s, ctx);
    case "GET threads :id connections":
      return connections(s, id!);
    case "POST threads :id note":
      await rateLimit(`mail-link:${s.userId}`, 300, 60 * 60_000);
      return toNote(s, id!, await body(ctx));
    case "POST threads :id event":
      await rateLimit(`mail-link:${s.userId}`, 300, 60 * 60_000);
      return toEvent(s, ctx, id!, await body(ctx));
    case "POST threads :id task":
      await rateLimit(`mail-link:${s.userId}`, 300, 60 * 60_000);
      return toTask(s, ctx, id!, await body(ctx));
    case "POST threads :id chat":
      return chatLink(s, id!, await body(ctx));

    // Recurring emails
    case "GET schedules":
      return listSchedules(s);
    case "POST schedules":
      await rateLimit(`mail-schedule:${s.userId}`, 120, 60 * 60_000);
      return createSchedule(s, await body(ctx));
    case "GET schedules :id":
      return getSchedule(s, id!);
    case "PUT schedules :id":
      return updateSchedule(s, id!, await body(ctx));
    case "DELETE schedules :id":
      return deleteSchedule(s, id!);
    case "POST schedules :id duplicate":
      return duplicateSchedule(s, id!);
    case "POST schedules :id pause":
    case "POST schedules :id resume":
    case "POST schedules :id skip":
    case "POST schedules :id send-now":
      await rateLimit(`mail-schedule-action:${s.userId}`, 300, 60 * 60_000);
      return scheduleAction(s, id!, sub!);

    case "POST send":
      await rateLimit(`mail-send:${s.userId}`, 300, 60 * 60_000);
      return send(s, await body(ctx));
    case "POST messages :id cancel":
      return cancel(s, id!);
    case "POST messages :id retry":
      return retry(s, id!);

    // Address book
    case "GET suggest":
      await rateLimit(`mail-suggest:${s.userId}`, 3000, 60 * 60_000);
      return suggest(s, qs);
    case "GET contacts":
      return listContacts(s, qs);
    case "POST contacts":
      return saveContact(s, null, await body(ctx));
    case "PUT contacts :id":
      return saveContact(s, id!, await body(ctx));
    case "DELETE contacts :id":
      return deleteContacts(s, [id!]);
    case "POST contacts bulk":
      return bulkContacts(s, await body(ctx));
    case "POST contacts import":
      return importContacts(s, await body(ctx));
    case "POST groups":
      return saveGroup(s, null, await body(ctx));
    case "PUT groups :id":
      return saveGroup(s, id!, await body(ctx));
    case "DELETE groups :id":
      await deleteGroup(s, id!);
      return { ok: true };

    // Signatures
    case "GET signatures":
      return listSignatures(s);
    case "POST signatures":
      return saveSignature(s, null, await body(ctx));
    case "PUT signatures :id":
      return saveSignature(s, id!, await body(ctx));
    case "DELETE signatures :id":
      await deleteSignature(s, id!);
      return { ok: true };
    case "PUT signatures defaults":
      return setSignatureDefaults(s, await body(ctx));
    case "POST signatures image":
      await rateLimit(`mail-sig-img:${s.userId}`, 30, 60 * 60_000);
      return uploadSignatureImage(s, await body(ctx));

    // Rules, templates, export
    case "GET rules":
      return rules(s);
    case "POST rules":
      return saveRule(s, null, await body(ctx));
    case "PUT rules :id":
      return saveRule(s, id!, await body(ctx));
    case "DELETE rules :id":
      await deleteRule(s, id!);
      return { ok: true };
    case "GET templates":
      return templates(s);
    case "POST templates":
      return saveTemplate(s, null, await body(ctx));
    case "POST templates import":
      return importTemplates(s, await body(ctx));
    case "PUT templates :id":
      return saveTemplate(s, id!, await body(ctx));
    case "DELETE templates :id":
      await deleteTemplate(s, id!);
      return { ok: true };
    case "GET export":
      return exportCsv(s, qs);
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const PATCH = route<P>(handle);
export const DELETE = route<P>(handle);
