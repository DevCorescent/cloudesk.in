// Wakes co-editing streams when updates arrive. Uses Postgres LISTEN/NOTIFY so
// every server instance hears every write; streams also re-check on a timer,
// so a dropped listener only slows delivery down, it never loses updates.
import { EventEmitter } from "node:events";
import { Client } from "pg";
import { listenConfig } from "@/db";
import { log } from "../log";

const g = globalThis as unknown as { __ccCodocBus?: { emitter: EventEmitter; client: Client | null; starting: Promise<void> | null } };
const bus = (g.__ccCodocBus ??= { emitter: new EventEmitter().setMaxListeners(10_000), client: null, starting: null });

function start() {
  const config = listenConfig();
  if (bus.client || bus.starting || !config) return;
  bus.starting = (async () => {
    const c = new Client(config);
    try {
      await c.connect();
      await c.query("LISTEN codoc");
      c.on("notification", (n) => n.payload && bus.emitter.emit(n.payload));
      c.on("error", (e) => {
        log.warn("codoc_listen_error", { error: e.message });
        bus.client = null;
        c.end().catch(() => {});
      });
      bus.client = c;
    } catch (e) {
      log.warn("codoc_listen_failed", { error: (e as Error).message });
      c.end().catch(() => {});
    } finally {
      bus.starting = null;
    }
  })();
}

/** Resolves when the document gets an update, or after `ms`. */
export function waitForUpdate(docId: string, ms: number, signal?: AbortSignal) {
  start();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      bus.emitter.off(docId, done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    bus.emitter.once(docId, done);
    signal?.addEventListener("abort", done);
  });
}

export async function closeCodocBus() {
  const c = bus.client;
  bus.client = null;
  await c?.end().catch(() => {});
}
