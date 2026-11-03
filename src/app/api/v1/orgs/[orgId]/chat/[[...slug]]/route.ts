// Chat API for a workspace: conversations, messages and threads, reactions,
// polls/decisions/approvals, read state, saved items, search, files,
// presence, AI, tasks and a live event stream (Server-Sent Events).
// Dispatches on "METHOD section :id sub", like the other module APIs.
import { z } from "zod";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { MAX_FILE } from "@/lib/chat/model";
import { chatScope, type ChatScope } from "@/server/chat/access";
import { ask, catchUp, rewrite } from "@/server/chat/ai";
import { subscribe, type ChatEvent } from "@/server/chat/bus";
import { addToCalendar, makeTasks, taskTargets } from "@/server/chat/convert";
import { createInvite, decide, emailInvite, invitePerson, listGuests, listInvites, removeGuest, updateInvite } from "@/server/chat/guests";
import * as chat from "@/server/chat/core";
import { db } from "@/db";
import { sql } from "drizzle-orm";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.unknown());
const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/i.test(x);
const STREAM_MS = 5 * 60_000;

async function readableSet(s: ChatScope) {
  const r = await db.execute(sql`select c.id from team_channels c where c.org_id = ${s.orgId} and (exists (select 1 from team_members m where m.channel_id = c.id and m.user_id = ${s.userId}) or (c.kind = 'channel' and c.visibility = 'public'))`);
  return new Set((r.rows as { id: string }[]).map((x) => x.id));
}

function stream(s: ChatScope, signal: AbortSignal) {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(ctrl) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          ctrl.enqueue(enc.encode(chunk));
        } catch {
          open = false;
        }
      };
      const stop = new AbortController();
      const finish = () => {
        if (!open) return;
        open = false;
        stop.abort();
        clearInterval(ping);
        clearTimeout(end);
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
      };
      let can = await readableSet(s);
      let refreshing = false;
      let refreshedAt = Date.now();
      const refresh = async () => {
        if (refreshing) return;
        refreshing = true;
        can = await readableSet(s).catch(() => can);
        refreshedAt = Date.now();
        refreshing = false;
      };
      send(`retry: 2000\n\n`);
      send(`event: hello\ndata: {}\n\n`);
      subscribe(
        s.orgId,
        (e: ChatEvent) => {
          // Only ids travel here — the browser reads the content through the API, with its checks.
          if (e.t === "p") return send(`event: p\ndata: ${JSON.stringify({ u: e.u })}\n\n`);
          if (e.t === "c") void refresh().then(() => send(`event: c\ndata: ${JSON.stringify({ ch: e.ch })}\n\n`));
          else if (e.ch && can.has(e.ch)) {
            if (e.t === "t" && e.u === s.userId) return;
            send(`event: ${e.t}\ndata: ${JSON.stringify({ ch: e.ch, id: e.id, seq: e.seq, u: e.u, thread: e.thread ?? null, n: e.n, me: e.me })}\n\n`);
            // A message somewhere this person can't read: re-check at most every 15 s (being added to a
            // conversation sends "c", so this is only a safety net) — not once per message per open tab.
          } else if (e.ch && e.t === "m" && Date.now() - refreshedAt > 15_000) void refresh().then(() => can.has(e.ch!) && send(`event: m\ndata: ${JSON.stringify({ ch: e.ch, id: e.id, seq: e.seq, u: e.u, thread: e.thread ?? null, n: e.n, me: e.me })}\n\n`));
        },
        stop.signal,
      );
      const ping = setInterval(() => send(`: ping\n\n`), 20_000);
      const end = setTimeout(finish, STREAM_MS);
      signal.addEventListener("abort", finish, { once: true });
    },
  });
}

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, sub2] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (isId(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${isId(sub) ? ":id" : sub}` : ""}${sub2 ? ` ${isId(sub2) ? ":id" : sub2}` : ""}`;
  const s = await chatScope(ctx, orgId);

  switch (key) {
    case "GET meta":
      return chat.meta(s);
    case "GET stream":
      return new Response(stream(s, ctx.req.signal), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
    case "GET activity":
      return chat.activity(s);
    case "GET saved":
      return chat.savedList(s);
    case "GET search":
      await rateLimit(`chat-search:${s.userId}`, 240, 60 * 60_000);
      return chat.search(s, qs.q ?? "");
    case "POST presence":
      return chat.setPresence(s, await body(ctx));
    case "POST presence ping":
      return chat.ping(s);
    case "POST read-all":
      return chat.markAllRead(s);

    // Conversations
    case "POST channels":
      await rateLimit(`chat-create:${s.userId}`, 60, 60 * 60_000);
      return chat.createChannel(s, await body(ctx));
    case "POST channels import":
      return chat.importChannels(s, await body(ctx));
    case "POST groups":
      await rateLimit(`chat-create:${s.userId}`, 60, 60 * 60_000);
      return chat.createGroup(s, await body(ctx));
    case "POST dm :id":
      return chat.openDm(s, id!);
    case "PATCH channels :id":
      return chat.updateChannel(s, id!, await body(ctx));
    case "POST channels :id join":
      return chat.join(s, id!);
    case "POST channels :id leave":
      return chat.leave(s, id!);
    case "GET channels :id members":
      return chat.members(s, id!);
    case "POST channels :id members":
      return chat.addMembers(s, id!, await body(ctx));
    case "DELETE channels :id members :id":
      return chat.removeMember(s, id!, sub2!);
    case "PATCH channels :id members :id": {
      const v = await readJson(ctx.req, z.object({ role: z.string() }));
      return chat.setRole(s, id!, sub2!, v.role);
    }
    case "PATCH channels :id prefs":
      return chat.prefs(s, id!, await body(ctx));
    case "POST channels :id read":
      return chat.markRead(s, id!, await body(ctx));
    case "POST channels :id typing":
      await rateLimit(`chat-typing:${s.userId}`, 600, 10 * 60_000);
      return chat.typing(s, id!, await body(ctx));
    case "GET channels :id messages":
      return chat.page(s, id!, qs);
    case "POST channels :id messages":
      await rateLimit(`chat-post:${s.userId}`, 600, 10 * 60_000);
      return chat.post(s, id!, await body(ctx));
    case "GET channels :id pinned":
    case "GET channels :id decisions":
    case "GET channels :id polls":
    case "GET channels :id records":
    case "GET channels :id links":
    case "GET channels :id files":
      return chat.collections(s, id!, sub!);
    case "GET channels :id export": {
      const f = await chat.exportChannel(s, id!);
      return new Response(f.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${f.filename}"`, "Cache-Control": "no-store" } });
    }
    case "POST channels :id files": {
      await rateLimit(`chat-upload:${s.userId}`, 200, 60 * 60_000);
      const len = Number(ctx.req.headers.get("content-length") ?? 0);
      if (len > MAX_FILE) throw new ApiError("payload_too_large", "Files can be up to 25 MB");
      const data = Buffer.from(await ctx.req.arrayBuffer());
      if (!data.length) throw new ApiError("validation_failed", "The file is empty");
      if (data.length > MAX_FILE) throw new ApiError("payload_too_large", "Files can be up to 25 MB");
      return chat.upload(s, id!, { filename: decodeURIComponent(qs.name ?? "file").slice(0, 200), mime: (ctx.req.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim(), data });
    }
    case "POST channels :id ai catch-up":
      await rateLimit(`chat-ai:${s.userId}`, 120, 60 * 60_000);
      return catchUp(s, id!, await body(ctx));
    case "POST channels :id ai ask":
      await rateLimit(`chat-ai:${s.userId}`, 120, 60 * 60_000);
      return ask(s, id!, await body(ctx));
    case "POST ai rewrite":
      await rateLimit(`chat-ai:${s.userId}`, 120, 60 * 60_000);
      return rewrite(s, await body(ctx));

    // Messages
    case "GET messages :id":
      return chat.one(s, id!);
    case "PATCH messages :id":
      return chat.edit(s, id!, await body(ctx));
    case "DELETE messages :id":
      return chat.remove(s, id!);
    case "POST messages :id react":
      return chat.react(s, id!, await body(ctx));
    case "POST messages :id pin":
      return chat.pin(s, id!, true);
    case "DELETE messages :id pin":
      return chat.pin(s, id!, false);
    case "POST messages :id vote":
      return chat.vote(s, id!, await body(ctx));
    case "POST messages :id settle":
      return chat.settle(s, id!, await body(ctx));
    case "POST messages :id save":
      return chat.save(s, id!, await body(ctx));
    case "POST messages :id forward":
      return chat.forward(s, id!, await body(ctx));
    case "POST messages :id calendar":
      return addToCalendar(s, id!);

    case "GET files :id": {
      const f = await chat.download(s, id!);
      const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(f.mime) && qs.download !== "1";
      return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } });
    }

    // Guests: invite links and the people who came through them
    case "GET channels :id invites":
      return listInvites(s, id!);
    case "POST channels :id invites":
      await rateLimit(`chat-invite:${s.userId}`, 100, 60 * 60_000);
      return createInvite(s, id!, await body(ctx));
    case "PATCH invites :id":
      return updateInvite(s, id!, await body(ctx));
    case "POST invites :id email":
      await rateLimit(`chat-invite-mail:${s.userId}`, 200, 24 * 60 * 60_000);
      return emailInvite(s, id!, await body(ctx));
    case "POST channels :id invite-person":
      await rateLimit(`chat-invite-mail:${s.userId}`, 200, 24 * 60 * 60_000);
      return invitePerson(s, id!, await body(ctx));
    case "GET channels :id guests":
      return listGuests(s, id!);
    case "POST guests :id decide":
      return decide(s, id!, await body(ctx));
    case "DELETE guests :id":
      return removeGuest(s, id!);

    // Into the rest of Cloudesk
    case "GET tasks targets":
      return taskTargets(s);
    case "POST tasks":
      await rateLimit(`chat-tasks:${s.userId}`, 200, 60 * 60_000);
      return makeTasks(s, await body(ctx));
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
