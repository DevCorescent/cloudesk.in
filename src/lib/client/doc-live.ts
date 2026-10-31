"use client";

// Browser side of co-editing a written document: a Yjs document kept in step
// with the server (POST for your edits, server-sent events for everyone
// else's), awareness for live cursors, and a save of the merged document a
// moment after you stop typing (the server keeps versions from those saves).
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { api, ApiClientError } from "./api";

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const PEER_COLORS = ["#7c5cdb", "#e5484d", "#1f9d6c", "#e8743b", "#2a86d1", "#c9871a", "#d6409f", "#0e9aa7"];
export type Peer = { clientId: number; name: string; color: string; userId?: string };
export type SaveState = "saved" | "saving" | "unsaved" | "offline" | "readonly";

const SAVE_AFTER_MS = 2500;

export class DocLive {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly clientKey = Math.random().toString(36).slice(2, 12);
  seq = 0;
  canWrite = false;
  state: SaveState = "saved";
  onReset: (why: string) => void = () => {};
  private listeners = { peers: new Set<(p: Peer[]) => void>(), state: new Set<(s: SaveState) => void>(), saved: new Set<(r: { version: number; words?: number }) => void>() };
  private es: EventSource | null = null;
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;
  private retry = 0;
  private dirty = false;

  private constructor(
    private orgId: string,
    readonly fileId: string,
  ) {}

  private url(p = "") {
    return `/api/v1/orgs/${this.orgId}/documents/docs/${this.fileId}${p}`;
  }

  static async open(orgId: string, fileId: string, me: { id: string; name: string }) {
    const s = new DocLive(orgId, fileId);
    const o = await api<{ seq: number; state: string; role: "view" | "comment" | "edit" }>(s.url("/live"));
    s.seq = o.seq;
    s.canWrite = o.role === "edit";
    s.state = s.canWrite ? "saved" : "readonly";
    Y.applyUpdate(s.doc, unb64(o.state), "remote");
    s.awareness.setLocalStateField("user", { name: me.name, color: PEER_COLORS[Math.abs(hash(me.id)) % PEER_COLORS.length], userId: me.id });
    s.doc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === "remote" || !s.canWrite) return;
      s.pending.push(u);
      s.dirty = true;
      s.setState("unsaved");
      s.schedule();
    });
    s.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === "remote") return;
      if ([...added, ...updated, ...removed].includes(s.doc.clientID)) void s.post("awareness", encodeAwarenessUpdate(s.awareness, [s.doc.clientID])).catch(() => {});
    });
    s.awareness.on("change", () => s.listeners.peers.forEach((f) => f(s.peers())));
    s.connect();
    window.addEventListener("online", s.wake);
    return s;
  }

  /** Listen for who's here, the save state, or saves; returns a function that stops listening. */
  on<K extends keyof DocLive["listeners"]>(event: K, fn: DocLive["listeners"][K] extends Set<infer F> ? F : never) {
    const set = this.listeners[event] as Set<typeof fn>;
    set.add(fn);
    return () => void set.delete(fn);
  }

  private wake = () => {
    if (this.pending.length) this.schedule();
  };

  private setState(st: SaveState) {
    if (this.state === st) return;
    this.state = st;
    this.listeners.state.forEach((f) => f(st));
  }

  peers(): Peer[] {
    const out: Peer[] = [];
    this.awareness.getStates().forEach((st, id) => {
      const u = (st as { user?: { name: string; color: string; userId?: string } }).user;
      if (id !== this.doc.clientID && u) out.push({ clientId: id, name: u.name, color: u.color, userId: u.userId });
    });
    return out;
  }

  private connect() {
    if (this.closed) return;
    const es = new EventSource(this.url(`/stream?since=${this.seq}`));
    this.es = es;
    es.addEventListener("u", (e) => {
      this.retry = 0;
      const d = JSON.parse((e as MessageEvent).data) as { seq: number; kind: string; clientId: string; update: string };
      this.seq = Math.max(this.seq, d.seq);
      if (d.kind === "doc") Y.applyUpdate(this.doc, unb64(d.update), "remote");
      else if (d.kind === "awareness" && d.clientId !== this.clientKey) {
        try {
          applyAwarenessUpdate(this.awareness, unb64(d.update), "remote");
        } catch {
          /* ignore malformed cursor data */
        }
      }
    });
    es.addEventListener("reset", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { why: string };
      this.destroy();
      this.onReset(d.why);
    });
    // The server ends each stream after ~25 s; reconnect from the last seq.
    es.onerror = () => {
      es.close();
      if (this.closed) return;
      const wait = Math.min(10_000, 300 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 60);
  }

  /** Sends queued edits; resolves once the server has them. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (!this.pending.length) return;
    const batch = this.pending.splice(0);
    this.setState("saving");
    this.flushing = this.post("doc", Y.mergeUpdates(batch))
      .then(() => {
        if (!this.pending.length) this.queueSave();
      })
      .catch((e) => {
        if (e instanceof ApiClientError && (e.status === 403 || e.status === 404 || e.status === 413)) {
          this.setState(e.status === 413 ? "unsaved" : "readonly");
          return;
        }
        this.pending.unshift(...batch);
        this.setState("offline");
        setTimeout(() => this.schedule(), navigator.onLine ? 1500 : 5000);
      })
      .finally(() => (this.flushing = null));
    await this.flushing;
  }

  private queueSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save().catch(() => {}), SAVE_AFTER_MS);
  }

  private async post(kind: "doc" | "awareness", update: Uint8Array) {
    await api(this.url("/live"), { method: "POST", body: { kind, clientId: this.clientKey, update: b64(update) } });
  }

  /** Writes the merged document back as the file's content (optionally as a named version). */
  async save(name?: string) {
    if (!this.canWrite) return null;
    await this.flush();
    if (!this.dirty && !name) {
      this.setState("saved");
      return null;
    }
    this.dirty = false;
    this.setState("saving");
    try {
      const r = await api<{ saved: boolean; version: number; words?: number }>(this.url("/save"), { method: "POST", body: name ? { name } : {} });
      this.setState(this.pending.length ? "unsaved" : "saved");
      this.listeners.saved.forEach((f) => f(r));
      return r;
    } catch (e) {
      this.dirty = true;
      this.setState("offline");
      throw e;
    }
  }

  get unsaved() {
    return this.pending.length > 0 || this.dirty;
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.es?.close();
    window.removeEventListener("online", this.wake);
    if (this.timer) clearTimeout(this.timer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    try {
      removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    } catch {
      /* ignore */
    }
    this.awareness.destroy();
  }
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
