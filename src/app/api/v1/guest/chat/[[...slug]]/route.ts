// Chat for guests — people outside the workspace who came through an invite
// link. No account and no session: a guest is known by the secret in a cookie
// that only this conversation's guest API receives, and every call goes
// through the same checks as members' Chat, narrowed to that conversation.
//
//   GET  invite/:code            what the link is for
//   POST invite/:code/join       ask to join with a name (sets the cookie)
//   GET  c/:ch                   where the guest stands (+ the conversation once in)
//   POST c/:ch/resume            sign this browser in with a personal link's secret
//   DELETE c/:ch                 withdraw the request, or leave
//   …and messages, reactions, votes, files, read, typing, presence and a live stream.
import { z } from "zod";
import { readJson, route, type RequestContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { readCookie, secureAttr } from "@/server/auth/session";
import { MAX_FILE, postSchema } from "@/lib/chat/model";
import { subscribe, type ChatEvent } from "@/server/chat/bus";
import * as chat from "@/server/chat/core";
import { guestByToken, guestCookieName, guestCookiePath, guestLeave, guestScope, guestSeen, guestState, invitePreview, requestJoin } from "@/server/chat/guests";

type P = { slug?: string[] };
const isId = (x?: string) => !!x && /^[0-9a-f-]{36}$/i.test(x);
const STREAM_MS = 5 * 60_000;
const COOKIE_DAYS = 180;

function setCookie(ctx: RequestContext, channelId: string, token: string) {
  ctx.headers.append("Set-Cookie", `${guestCookieName(channelId)}=${token}; Path=${guestCookiePath(channelId)}; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_DAYS * 86_400}${secureAttr()}`);
}
function clearCookie(ctx: RequestContext, channelId: string) {
  ctx.headers.append("Set-Cookie", `${guestCookieName(channelId)}=; Path=${guestCookiePath(channelId)}; HttpOnly; SameSite=Lax; Max-Age=0${secureAttr()}`);
}

function stream(orgId: string, channelId: string, me: string, signal: AbortSignal) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
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
      send(`retry: 2000\n\n`);
      send(`event: hello\ndata: {}\n\n`);
      subscribe(
        orgId,
        (e: ChatEvent) => {
          // Only this conversation, and only ids: content is read through the API, with its checks.
          if (e.ch !== channelId) return;
          if (e.t === "t" && e.u === me) return;
          send(`event: ${e.t}\ndata: ${JSON.stringify({ ch: e.ch, id: e.id, seq: e.seq, u: e.u, thread: e.thread ?? null, n: e.n, me: e.me })}\n\n`);
        },
        stop.signal,
      );
      const ping = setInterval(() => send(`: ping\n\n`), 20_000);
      const end = setTimeout(finish, STREAM_MS);
      signal.addEventListener("abort", finish, { once: true });
    },
  });
}

async function handle(ctx: RequestContext, { slug = [] }: P) {
  const [section, key, sub, id, sub2] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const ip = ctx.ip ?? "unknown";

  if (section === "invite" && key) {
    if (m === "GET" && !sub) {
      await rateLimit(`guest-invite-view:${ip}`, 300, 60 * 60_000);
      return invitePreview(key);
    }
    if (m === "POST" && sub === "join") {
      await rateLimit(`guest-join:${ip}`, 15, 60 * 60_000);
      await rateLimit(`guest-join-code:${key}`, 200, 60 * 60_000);
      const r = await requestJoin(key, await readJson(ctx.req, z.unknown()), { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") ?? "" });
      setCookie(ctx, r.channelId, r.token);
      // The secret also comes back once, for the guest's personal link to other devices.
      return { channelId: r.channelId, token: r.token };
    }
    throw notFound("Route");
  }
  if (section !== "c" || !isId(key)) throw notFound("Route");
  const channelId = key!;

  if (sub === "resume" && m === "POST") {
    await rateLimit(`guest-resume:${ip}`, 30, 60 * 60_000);
    const { token } = await readJson(ctx.req, z.object({ token: z.string().min(20).max(100) }));
    const g = await guestByToken(channelId, token);
    if (!g) throw new ApiError("not_found", "That personal link doesn't work any more");
    setCookie(ctx, channelId, token);
    return { ok: true };
  }

  const token = readCookie(ctx.req.headers.get("cookie"), guestCookieName(channelId));
  if (!sub) {
    if (m === "GET") return guestState(channelId, token);
    if (m === "DELETE") {
      const g = await guestByToken(channelId, token);
      if (g) await guestLeave(g, ctx);
      clearCookie(ctx, channelId);
      return { ok: true };
    }
    throw notFound("Route");
  }

  const g = await guestByToken(channelId, token);
  if (!g) throw new ApiError("unauthenticated", "Open your invite link again to join");
  const s = await guestScope(g, ctx);
  const op = `${m} ${sub}${id ? (isId(id) ? " :id" : ` ${id}`) : ""}${sub2 ? ` ${sub2}` : ""}`;

  switch (op) {
    case "GET stream":
      await guestSeen(g);
      return new Response(stream(s.orgId, channelId, s.userId, ctx.req.signal), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
    case "POST ping":
      await guestSeen(g);
      return chat.ping(s);
    case "POST read":
      return chat.markRead(s, channelId, await readJson(ctx.req, z.unknown()));
    case "POST typing":
      await rateLimit(`chat-typing:${s.userId}`, 600, 10 * 60_000);
      return chat.typing(s, channelId, await readJson(ctx.req, z.unknown()));
    case "GET messages":
      return chat.page(s, channelId, qs);
    case "POST messages": {
      await rateLimit(`chat-post:${s.userId}`, 300, 10 * 60_000);
      // Guests write text (in threads too) and share files when the invite allows; nothing else.
      const v = postSchema.pick({ body: true, parentId: true, files: true, alsoToChannel: true }).safeParse(await readJson(ctx.req, z.unknown()));
      if (!v.success) throw new ApiError("validation_failed", v.error.issues[0]?.message ?? "Check the message");
      if (v.data.files?.length && !s.guest!.files) throw new ApiError("forbidden", "Sharing files isn't allowed for guests here");
      return chat.post(s, channelId, { body: v.data.body, parentId: v.data.parentId, files: v.data.files, alsoToChannel: v.data.alsoToChannel });
    }
    case "GET messages :id":
      return chat.one(s, id!);
    case "PATCH messages :id": {
      const v = await readJson(ctx.req, z.object({ body: z.string() }));
      return chat.edit(s, id!, { body: v.body });
    }
    case "DELETE messages :id":
      return chat.remove(s, id!);
    case "POST messages :id react":
      return chat.react(s, id!, await readJson(ctx.req, z.unknown()));
    case "POST messages :id vote":
      return chat.vote(s, id!, await readJson(ctx.req, z.unknown()));
    case "POST files": {
      if (!s.guest!.files) throw new ApiError("forbidden", "Sharing files isn't allowed for guests here");
      await rateLimit(`chat-upload:${s.userId}`, 60, 60 * 60_000);
      const len = Number(ctx.req.headers.get("content-length") ?? 0);
      if (len > MAX_FILE) throw new ApiError("payload_too_large", "Files can be up to 25 MB");
      const data = Buffer.from(await ctx.req.arrayBuffer());
      if (!data.length) throw new ApiError("validation_failed", "The file is empty");
      if (data.length > MAX_FILE) throw new ApiError("payload_too_large", "Files can be up to 25 MB");
      return chat.upload(s, channelId, { filename: decodeURIComponent(qs.name ?? "file").slice(0, 200), mime: (ctx.req.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim(), data });
    }
    case "GET files :id": {
      const f = await chat.download(s, id!);
      const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(f.mime) && qs.download !== "1";
      return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } });
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle, { auth: false });
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
