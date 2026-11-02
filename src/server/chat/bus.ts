// Live chat events across server instances: Postgres NOTIFY on "team_chat",
// one LISTEN connection per process (a direct one — poolers drop notifications),
// fanned out to the open streams of that workspace. While that connection is
// down, each workspace with open streams reads new messages from the table every
// few seconds instead, so a dropped listener only slows delivery, never loses it.
import { EventEmitter } from "node:events";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { db, listenConfig } from "@/db";
import { log } from "../log";

/** m: new/changed message · r: read · t: typing · p: presence · c: channel changed. n: a new message (not an edit), me: who it mentions ("*" = everyone). */
export type ChatEvent = { o: string; t: "m" | "r" | "t" | "p" | "c"; ch?: string; u?: string; id?: string; seq?: number; thread?: string | null; n?: 1; me?: string[] };

type Poller = { cursor: number | null; timer: ReturnType<typeof setInterval>; busy: boolean };
const g = globalThis as unknown as { __ccChatBus?: { emitter: EventEmitter; client: Client | null; starting: Promise<void> | null; retry: ReturnType<typeof setTimeout> | null; failures: number; closed: boolean; pollers: Map<string, Poller> } };
const bus = (g.__ccChatBus ??= { emitter: new EventEmitter().setMaxListeners(100_000), client: null, starting: null, retry: null, failures: 0, closed: false, pollers: new Map() });
bus.pollers ??= new Map();
const POLL_MS = 3000;

/** Listens again after a dropped connection, backing off up to 30 s — as long as someone is listening. */
function reconnect() {
  if (bus.retry || bus.closed || bus.emitter.eventNames().length === 0) return;
  const wait = Math.min(30_000, 500 * 2 ** Math.min(bus.failures, 6));
  bus.failures += 1;
  bus.retry = setTimeout(() => {
    bus.retry = null;
    start();
  }, wait);
  bus.retry.unref?.();
}

function start() {
  const config = listenConfig();
  if (bus.client || bus.starting || !config) return;
  bus.closed = false;
  bus.starting = (async () => {
    const c = new Client(config);
    try {
      await c.connect();
      await c.query("LISTEN team_chat");
      c.on("notification", (n) => {
        if (!n.payload) return;
        try {
          const e = JSON.parse(n.payload) as ChatEvent;
          seen(e);
          bus.emitter.emit(e.o, e);
        } catch {
          /* not ours */
        }
      });
      const lost = (why: string) => {
        if (bus.client !== c) return;
        log.warn("chat_listen_lost", { error: why });
        bus.client = null;
        c.end().catch(() => {});
        reconnect();
      };
      c.on("error", (e) => lost(e.message));
      c.on("end", () => lost("connection ended"));
      bus.client = c;
      bus.failures = 0;
    } catch (e) {
      log.warn("chat_listen_failed", { error: (e as Error).message });
      c.end().catch(() => {});
      reconnect();
    } finally {
      bus.starting = null;
    }
  })();
}

export async function publish(e: ChatEvent) {
  await db.execute(sql`select pg_notify('team_chat', ${JSON.stringify(e)})`).catch(() => {});
}

/** Keeps the fallback's place up to date while live events arrive, so it never replays them. */
function seen(e: ChatEvent) {
  const p = bus.pollers.get(e.o);
  if (p && e.t === "m" && e.n && e.seq && (p.cursor === null || e.seq > p.cursor)) p.cursor = e.seq;
}

type Row = { id: string; channel_id: string; seq: string | number; parent_id: string | null; author_id: string | null; mentions: { users?: string[]; everyone?: boolean } | null };

/** The fallback: new messages straight from the table, only while LISTEN is down. */
async function poll(orgId: string, p: Poller) {
  if (p.busy) return;
  p.busy = true;
  try {
    if (p.cursor === null) {
      const r = await db.execute(sql`select coalesce(max(seq), 0) as seq from team_messages where org_id = ${orgId}`);
      p.cursor = Number((r.rows[0] as { seq: string | number }).seq);
      return;
    }
    if (bus.client) return;
    start();
    const r = await db.execute(sql`select id, channel_id, seq, parent_id, author_id, mentions from team_messages where org_id = ${orgId} and seq > ${p.cursor} and scheduled_for is null order by seq limit 100`);
    for (const m of r.rows as Row[]) {
      p.cursor = Math.max(p.cursor, Number(m.seq));
      const users = m.mentions?.users ?? [];
      bus.emitter.emit(orgId, { o: orgId, t: "m", ch: m.channel_id, id: m.id, seq: Number(m.seq), u: m.author_id ?? undefined, thread: m.parent_id, n: 1, me: m.mentions?.everyone ? ["*"] : users.length > 40 ? ["?"] : users } satisfies ChatEvent);
    }
  } catch (e) {
    log.warn("chat_poll_failed", { error: (e as Error).message });
  } finally {
    p.busy = false;
  }
}

/** Calls `on` for every event in the workspace until `signal` aborts. */
export function subscribe(orgId: string, on: (e: ChatEvent) => void, signal: AbortSignal) {
  start();
  bus.emitter.on(orgId, on);
  if (!bus.pollers.has(orgId)) {
    const p: Poller = { cursor: null, busy: false, timer: setInterval(() => void poll(orgId, p), POLL_MS) };
    p.timer.unref?.();
    bus.pollers.set(orgId, p);
    void poll(orgId, p);
  }
  signal.addEventListener(
    "abort",
    () => {
      bus.emitter.off(orgId, on);
      const p = bus.pollers.get(orgId);
      if (p && bus.emitter.listenerCount(orgId) === 0) {
        clearInterval(p.timer);
        bus.pollers.delete(orgId);
      }
    },
    { once: true },
  );
}

export async function closeChatBus() {
  const c = bus.client;
  bus.closed = true;
  if (bus.retry) clearTimeout(bus.retry);
  bus.retry = null;
  bus.client = null;
  for (const p of bus.pollers.values()) clearInterval(p.timer);
  bus.pollers.clear();
  await c?.end().catch(() => {});
}
