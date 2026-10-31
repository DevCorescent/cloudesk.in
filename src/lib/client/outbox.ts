// The offline outbox. Writes made while the connection is down (a site
// measurement, a diary entry, a new record) are kept in this browser and sent
// when it's back, each with its own Idempotency-Key so a write that reached
// the server before the connection dropped isn't done twice. Only screens
// that opt in use it; everything else needs a connection.
import { api, ApiClientError } from "./api";

export type Queued = { key: string; method: string; path: string; body: unknown; label: string; at: number; error?: string };

const STORE = "cloudesk.outbox.v1";
const listeners = new Set<() => void>();
let flushing = false;

function read(): Queued[] {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Queued[]) : [];
  } catch {
    return [];
  }
}
function write(items: Queued[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(items));
  } catch {
    // Storage full or blocked: nothing more can be kept offline.
  }
  for (const l of listeners) l();
}

export const pending = () => read();
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const newKey = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

/**
 * Sends a write now, or keeps it for later when there's no connection.
 * Returns the server's answer, or `{ queued: true }` when it was kept.
 */
export async function sendOrQueue<T>(path: string, init: { method?: string; body?: unknown; label: string }): Promise<T | { queued: true }> {
  const item: Queued = { key: newKey(), method: init.method ?? "POST", path, body: init.body ?? {}, label: init.label, at: Date.now() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    write([...read(), item]);
    return { queued: true };
  }
  try {
    return await api<T>(path, { method: item.method, body: item.body, headers: { "Idempotency-Key": item.key } });
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 0) {
      write([...read(), item]);
      return { queued: true };
    }
    throw e;
  }
}

/**
 * Sends what's waiting, oldest first. A write the server refuses (a rule, a
 * closed period) stays with its message until it's discarded; a dropped
 * connection stops the run until next time.
 */
export async function flush(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const item of read()) {
      if (item.error) {
        failed++;
        continue;
      }
      try {
        await api(item.path, { method: item.method, body: item.body, headers: { "Idempotency-Key": item.key } });
        write(read().filter((x) => x.key !== item.key));
        sent++;
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 0) break;
        const msg = e instanceof Error ? e.message : "Refused";
        write(read().map((x) => (x.key === item.key ? { ...x, error: msg } : x)));
        failed++;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

export function discard(key: string) {
  write(read().filter((x) => x.key !== key));
}

/** Try again a write the server refused (after fixing what it said). */
export function retry(key: string) {
  write(read().map((x) => (x.key === key ? { ...x, error: undefined } : x)));
}
