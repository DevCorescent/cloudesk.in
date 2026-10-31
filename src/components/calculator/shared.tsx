"use client";

// What the calculator's parts share: display settings (kept on this device),
// the history API, and number formatting with those settings.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import type { AngleMode } from "@/lib/calculator/expr";
import { formatMoney, formatNumber, type Grouping } from "@/lib/calculator/format";
import { api, errorMessage } from "@/lib/client/api";

export type Settings = { angle: AngleMode; grouping: Grouping; decimals: "auto" | 0 | 2 | 4; sci: boolean; memory: number; vars: Record<string, number> };
const DEFAULTS: Settings = { angle: "deg", grouping: "indian", decimals: "auto", sci: false, memory: 0, vars: {} };

const listeners = new Set<() => void>();
const cache = new Map<string, Settings>();
const keyFor = (userId: string) => `cc-calc:${userId}`;

function read(userId: string): Settings {
  const k = keyFor(userId);
  if (cache.has(k)) return cache.get(k)!;
  let v = DEFAULTS;
  try {
    const raw = localStorage.getItem(k);
    if (raw) v = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {}
  cache.set(k, v);
  return v;
}

/** Display settings, memory and variables — per person, on this device. */
export function useCalcSettings() {
  const { user } = useSession();
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(user.id),
    () => DEFAULTS,
  );
  const set = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...read(user.id), ...patch };
      cache.set(keyFor(user.id), next);
      try {
        localStorage.setItem(keyFor(user.id), JSON.stringify(next));
      } catch {}
      listeners.forEach((l) => l());
    },
    [user.id],
  );
  return [s, set] as const;
}

export const fmt = (x: number, s: Pick<Settings, "grouping" | "decimals">) => formatNumber(x, { grouping: s.grouping, decimals: s.decimals });
export const fmtMoney = (x: number, s: Pick<Settings, "grouping">) => formatMoney(x, { grouping: s.grouping });

export type Entry = { id: string; kind: "expr" | "formula"; input: string; values: Record<string, number | string> | null; result: string; resultValue: number | null; note: string; pinned: boolean; createdAt: string };

export function useHistory(search: string, pinned: boolean) {
  const { org } = useSession();
  const qs = new URLSearchParams({ ...(search ? { q: search } : {}), ...(pinned ? { pinned: "1" } : {}) }).toString();
  return useQuery({ queryKey: ["calc-history", org.id, qs], queryFn: () => api<{ entries: Entry[]; counts: { total: number; pinned: number } }>(`/api/v1/orgs/${org.id}/calculator/history${qs ? `?${qs}` : ""}`) });
}

export function useHistoryActions() {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/api/v1/orgs/${org.id}/calculator/history`;
  const done = () => void qc.invalidateQueries({ queryKey: ["calc-history", org.id] });
  const fail = (e: unknown) => toast({ tone: "error", title: errorMessage(e) });
  const save = useMutation({ mutationFn: (e: Omit<Entry, "id" | "createdAt" | "pinned" | "note" | "values"> & { values?: Record<string, number | string>; note?: string }) => api<{ entry: Entry }>(base, { method: "POST", body: e }), onSuccess: done, onError: fail });
  const update = useMutation({ mutationFn: ({ id, ...patch }: { id: string; note?: string; pinned?: boolean }) => api(`${base}/${id}`, { method: "PATCH", body: patch }), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => api(`${base}/${id}`, { method: "DELETE" }), onSuccess: done, onError: fail });
  const clear = useMutation({ mutationFn: (all: boolean) => api<{ removed: number }>(`${base}${all ? "?all=1" : ""}`, { method: "DELETE" }), onSuccess: (r) => { done(); toast({ tone: "success", title: `${r.removed} cleared` }); }, onError: fail });
  return { save, update, remove, clear, csvUrl: `${base}/csv` };
}

export async function copy(text: string, toast: ReturnType<typeof useToast>) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ tone: "success", title: "Copied" });
  } catch {
    toast({ tone: "error", title: "Couldn't copy — select the text instead" });
  }
}
