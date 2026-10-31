"use client";

// Browser side of co-editing: a Yjs document kept in sync with the server
// (POST for local updates, server-sent events for everyone else's), plus
// awareness for live cursors and names.
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { api, ApiClientError } from "./api";

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const COLORS = ["#0a84ff", "#ff375f", "#30d158", "#ff9f0a", "#bf5af2", "#64d2ff", "#ffd60a", "#ac8e68"];
export type Peer = { clientId: number; name: string; color: string };

export class CodocSession {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText("content");
  readonly awareness = new Awareness(this.doc);
  readonly clientKey = Math.random().toString(36).slice(2, 12);
  docId = "";
  seq = 0;
  revision = 0;
  canWrite = false;
  onReset: () => void = () => {};
  onSaved: (revision: number) => void = () => {};
  onPeers: (peers: Peer[]) => void = () => {};
  private es: EventSource | null = null;
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;
  private retry = 0;

  private constructor(private projectId: string) {}

  static async open(projectId: string, path: string, me: { name: string }) {
    const s = new CodocSession(projectId);
    const o = await api<{ docId: string; seq: number; revision: number; state: string; canWrite: boolean }>(`/api/v1/projects/${projectId}/codoc?path=${encodeURIComponent(path)}`);
    s.docId = o.docId;
    s.seq = o.seq;
    s.revision = o.revision;
    s.canWrite = o.canWrite;
    Y.applyUpdate(s.doc, unb64(o.state), "remote");
    s.awareness.setLocalStateField("user", { name: me.name, color: COLORS[s.doc.clientID % COLORS.length] });
    s.doc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === "remote" || !s.canWrite) return;
      s.pending.push(u);
      s.schedule();
    });
    s.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === "remote") return;
      const changed = [...added, ...updated, ...removed].filter((id) => id === s.doc.clientID);
      if (changed.length) void s.post("awareness", encodeAwarenessUpdate(s.awareness, changed)).catch(() => {});
    });
    s.awareness.on("change", () => s.onPeers(s.peers()));
    s.connect();
    return s;
  }

  peers(): Peer[] {
    const out: Peer[] = [];
    this.awareness.getStates().forEach((st, id) => {
      const u = (st as { user?: { name: string; color: string } }).user;
      if (id !== this.doc.clientID && u) out.push({ clientId: id, name: u.name, color: u.color });
    });
    return out;
  }

  private connect() {
    if (this.closed) return;
    const es = new EventSource(`/api/v1/projects/${this.projectId}/codoc/${this.docId}/stream?since=${this.seq}`);
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
    es.addEventListener("saved", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { seq: number; revision: number };
      this.seq = Math.max(this.seq, d.seq);
      this.revision = d.revision;
      this.onSaved(d.revision);
    });
    es.addEventListener("reset", () => {
      this.destroy();
      this.onReset();
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
    }, 40);
  }

  /** Sends queued local edits; resolves once the server has them. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (!this.pending.length) return;
    const batch = this.pending.splice(0);
    this.flushing = this.post("doc", Y.mergeUpdates(batch))
      .catch((e) => {
        if (e instanceof ApiClientError && (e.status === 403 || e.status === 404)) return;
        this.pending.unshift(...batch);
        setTimeout(() => this.schedule(), 1000);
      })
      .finally(() => (this.flushing = null));
    await this.flushing;
  }

  private async post(kind: "doc" | "awareness", update: Uint8Array) {
    await api(`/api/v1/projects/${this.projectId}/codoc/${this.docId}`, { method: "POST", body: { kind, clientId: this.clientKey, update: b64(update) } });
  }

  async save() {
    await this.flush();
    const r = await api<{ revision: number; content: string }>(`/api/v1/projects/${this.projectId}/codoc/${this.docId}/save`, { method: "POST" });
    this.revision = r.revision;
    return r;
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.es?.close();
    if (this.timer) clearTimeout(this.timer);
    // Tell others this cursor is gone (the awareness "update" handler posts it).
    try {
      removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    } catch {
      /* ignore */
    }
    this.awareness.destroy();
  }
}
