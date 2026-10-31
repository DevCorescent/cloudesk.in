// Live chat events across server instances: Postgres NOTIFY on "team_chat",
// one LISTEN connection per process, fanned out to the open streams of that
// workspace. Streams also re-read on a timer, so a dropped listener only slows
// delivery, it never loses messages (everything is in the database).
import { EventEmitter } from "node:events";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { db } from "@/db";
import { log } from "../log";

/** m: new/changed message · r: read · t: typing · p: presence · c: channel changed. n: a new message (not an edit), me: who it mentions ("*" = everyone). */
export type ChatEvent = { o: string; t: "m" | "r" | "t" | "p" | "c"; ch?: string; u?: string; id?: string; seq?: number; thread?: string | null; n?: 1; me?: string[] };

const g = globalThis as unknown as { __ccChatBus?: { emitter: EventEmitter; client: Client | null; starting: Promise<void> | null; retry: ReturnType<typeof setTimeout> | null; failures: number; closed: boolean } };
const bus = (g.__ccChatBus ??= { emitter: new EventEmitter().setMaxListeners(100_000), client: null, starting: null, retry: null, failures: 0, closed: false });

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
  if (bus.client || bus.starting || !process.env.DATABASE_URL) return;
  bus.closed = false;
  bus.starting = (async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await c.connect();
      await c.query("LISTEN team_chat");
      c.on("notification", (n) => {
        if (!n.payload) return;
        try {
          const e = JSON.parse(n.payload) as ChatEvent;
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

/** Calls `on` for every event in the workspace until `signal` aborts. */
export function subscribe(orgId: string, on: (e: ChatEvent) => void, signal: AbortSignal) {
  start();
  bus.emitter.on(orgId, on);
  signal.addEventListener("abort", () => bus.emitter.off(orgId, on), { once: true });
}

export async function closeChatBus() {
  const c = bus.client;
  bus.closed = true;
  if (bus.retry) clearTimeout(bus.retry);
  bus.retry = null;
  bus.client = null;
  await c?.end().catch(() => {});
}
