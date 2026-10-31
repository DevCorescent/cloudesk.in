"use client";

// Shared pieces of the Mail app: the meta query, the API helper scoped to the
// workspace, the "undo send" bar, and small formatting helpers.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";
import type { AccountOut, MetaOut, Person } from "@/lib/mail/api";

export const mailKey = (orgId: string, ...rest: unknown[]) => ["mail", orgId, ...rest];

/** The workspace's mail API: `call("threads?view=inbox")`, `call("send", "POST", body)`. */
export function useMailApi() {
  const { org } = useSession();
  const base = `/api/v1/orgs/${org.id}/mail`;
  const call = useCallback(<T,>(path: string, method = "GET", body?: unknown) => api<T>(`${base}/${path}`, method === "GET" ? {} : { method, body: body ?? {} }), [base]);
  return { orgId: org.id, base, call };
}

export function useMailMeta() {
  const { orgId, call } = useMailApi();
  return useQuery({ queryKey: mailKey(orgId, "meta"), queryFn: () => call<MetaOut>("meta"), refetchInterval: 30_000, retry: false });
}

/** Refreshes everything mail shows (counts, lists, the open thread). */
export function useMailRefresh() {
  const qc = useQueryClient();
  const { orgId } = useMailApi();
  return useCallback(() => qc.invalidateQueries({ queryKey: mailKey(orgId) }), [qc, orgId]);
}

// ── Undo send ───────────────────────────────────────────────────────────────

type Pending = { id: string; until: number; label: string };
type UndoCtx = { show: (p: { id: string; seconds: number; label: string }) => void };
const Undo = createContext<UndoCtx>({ show: () => {} });
export const useUndoSend = () => useContext(Undo);

/** A bar at the bottom that counts down while a just-sent email can still be called back. */
export function UndoProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { call } = useMailApi();
  const refresh = useMailRefresh();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= pending.until) {
        setPending(null);
        setNote("Sent");
        setTimeout(() => setNote(null), 2500);
        void refresh();
      }
    }, 250);
    return () => clearInterval(t);
  }, [pending, refresh]);
  const show = useCallback((p: { id: string; seconds: number; label: string }) => {
    setNote(null);
    if (p.seconds <= 0) {
      setNote(p.label);
      setTimeout(() => setNote(null), 3000);
      return;
    }
    setNow(Date.now());
    setPending({ id: p.id, until: Date.now() + p.seconds * 1000, label: p.label });
  }, []);
  const undo = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await call(`messages/${pending.id}/cancel`, "POST");
      setNote("Sending cancelled — it's back in your drafts");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Too late to undo");
    } finally {
      setBusy(false);
      setPending(null);
      setTimeout(() => setNote(null), 3500);
      void refresh();
    }
  };
  const left = pending ? Math.max(0, Math.ceil((pending.until - now) / 1000)) : 0;
  return (
    <Undo.Provider value={{ show }}>
      {children}
      {(pending || note) && (
        <div role="status" aria-live="polite" className="fixed bottom-[calc(var(--dock)+20px)] left-1/2 z-[90] max-w-[calc(100vw-24px)] flex -translate-x-1/2 items-center gap-3 rounded-full bg-fg py-2 pr-2 pl-4 text-[13px] text-bg shadow-[0_18px_50px_-18px_rgb(0_0_0/0.6)]">
          {pending ? (
            <>
              <span className="tabular-nums">{pending.label} · sending in {left}s</span>
              <button type="button" disabled={busy} onClick={() => void undo()} className="rounded-full bg-bg/15 px-3 py-1 font-semibold hover:bg-bg/25">Undo</button>
            </>
          ) : (
            <span className="pr-2">{note}</span>
          )}
        </div>
      )}
    </Undo.Provider>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────

const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
export const colorFor = (s: string) => PALETTE[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]!;
export const initials = (p: Pick<Person, "name" | "address">) => {
  const n = (p.name || p.address.split("@")[0] || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
};
export const personName = (p: Pick<Person, "name" | "address">) => p.name || p.address.split("@")[0] || p.address;

export function Avatar({ p, size = 32 }: { p: Pick<Person, "name" | "address">; size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38, background: colorFor(p.address || p.name) }}>
      {initials(p)}
    </span>
  );
}

/** "10:42", "Tue", "12 Oct", "12 Oct 2025". */
export function shortTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6 && days > 0) return d.toLocaleDateString("en-IN", { weekday: "short" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
export const longTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
export const fileSize = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);

/** Preset times for snooze and schedule: later today, tomorrow morning, this weekend, next week. */
export function presets(now = new Date()) {
  const at = (d: Date, h: number) => {
    const x = new Date(d);
    x.setHours(h, 0, 0, 0);
    return x;
  };
  const later = new Date(now.getTime() + 3 * 3_600_000);
  later.setMinutes(0, 0, 0);
  const tomorrow = at(new Date(now.getTime() + 86_400_000), 9);
  const sat = new Date(now);
  sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const mon = new Date(now);
  mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  return [
    { label: "Later today", at: later },
    { label: "Tomorrow, 9 am", at: tomorrow },
    { label: "This weekend", at: at(sat, 9) },
    { label: "Next week", at: at(mon, 9) },
  ].filter((p) => p.at > now);
}

export const accountOf = (accounts: AccountOut[], id: string) => accounts.find((a) => a.id === id);

/** Is a keyboard event coming from someone typing? */
export const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};

/** Local draft storage that never throws (private windows, blocked storage). */
export const drafts = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`cloudesk.mail.draft.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(`cloudesk.mail.draft.${key}`, v);
    } catch {}
  },
  clear(key: string) {
    try {
      localStorage.removeItem(`cloudesk.mail.draft.${key}`);
    } catch {}
  },
};

export const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** Pulls every address out of pasted text ("A <a@x.in>, b@y.in"). */
export const addressesIn = (s: string) => [...new Set(s.match(/[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+/g) ?? [])];
