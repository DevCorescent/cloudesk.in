"use client";

// Cloudesk for Horeca: shared client helpers (venue context, API hooks, money,
// small presentational pieces).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { cx, Switch } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import type { HorecaSettings } from "@/lib/horeca/model";
import { formatPrice } from "@/lib/store/money";

export type Venue = { projectId: string; name: string; kind: string; currency: string; taxBps: number; serviceChargeBps: number; token: string; settings: HorecaSettings };
export type Operator = { id: string; name: string; role: string; /** From unlocking: lets a manager at the till approve without their PIN again. */ ticket?: string };
type Ctx = {
  projectId: string;
  venue: Venue;
  base: string;
  /** The staff member who unlocked the screen (null when no staff are set up). */
  operator: Operator | null;
  lock: () => void;
  /** Asks for a manager's PIN; resolves null if cancelled. */
  requestApproval: (why: string) => Promise<string | null>;
  fullscreen: boolean;
  setFullscreen: (v: boolean) => void;
};
const HCtx = createContext<Ctx | null>(null);
export const HorecaProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <HCtx.Provider value={value}>{children}</HCtx.Provider>;
export function useH() {
  const c = useContext(HCtx);
  if (!c) throw new Error("Horeca context missing");
  return c;
}

export const hApi = (projectId: string, path: string) => `/api/v1/projects/${projectId}/horeca/${path}`;

export function useHQuery<T>(path: string, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  const { projectId } = useH();
  return useQuery({ queryKey: ["horeca", projectId, path], queryFn: () => api<T>(hApi(projectId, path)), refetchInterval: opts.refetchInterval, enabled: opts.enabled });
}

class Cancelled extends Error {}
const needsApproval = (e: unknown) => e instanceof ApiClientError && e.status === 403 && Array.isArray((e.details as { approval?: unknown } | null)?.approval);

/**
 * A write that refreshes every Horeca view and reports problems. It says who
 * is at the till, and when the server wants a manager's PIN it asks for one
 * and tries again.
 */
export function useHAction<B = unknown, R = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown }, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void } = {}) {
  const { projectId, operator, requestApproval } = useH();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (b: B) => {
      const r = fn(b);
      const method = r.method ?? "POST";
      const send = (extra: Record<string, unknown>) => api<R>(hApi(projectId, r.path), { method, body: method === "GET" || method === "DELETE" ? r.body : { ...((r.body as object | undefined) ?? {}), ...extra } });
      const who = operator ? { staffId: operator.id, ...(operator.ticket ? { staffTicket: operator.ticket } : {}) } : {};
      try {
        return await send(who);
      } catch (first) {
        if (!needsApproval(first)) throw first;
        // Ask for a manager's PIN; a wrong one asks again (the server rate-limits guesses).
        let why = (first as Error).message;
        for (;;) {
          const pin = await requestApproval(why);
          if (!pin) throw new Cancelled("Cancelled");
          try {
            return await send({ ...who, approvalPin: pin });
          } catch (e) {
            if (!needsApproval(e)) throw e;
            why = (e as Error).message;
          }
        }
      }
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["horeca", projectId] });
      if (opts.success) toast({ tone: "success", title: typeof opts.success === "function" ? opts.success(r) : opts.success });
      opts.onDone?.(r);
    },
    onError: (e) => {
      if (!(e instanceof Cancelled)) toast({ tone: "error", title: errorMessage(e) });
    },
  });
}

/** Saves venue details and settings; the patch is merged over what's saved. */
export function useSaveVenue(opts: { success?: string; onDone?: () => void } = {}) {
  const { venue } = useH();
  return useHAction<{ name?: string; kind?: string; currency?: string; taxBps?: number; serviceChargeBps?: number; settings?: Partial<{ [K in keyof HorecaSettings]: Partial<HorecaSettings[K]> }> }>(
    (p) => ({
      path: "venue",
      method: "PUT",
      body: {
        name: p.name ?? venue.name,
        kind: p.kind ?? venue.kind,
        currency: p.currency ?? venue.currency,
        taxBps: p.taxBps ?? venue.taxBps,
        serviceChargeBps: p.serviceChargeBps ?? venue.serviceChargeBps,
        // Every settings group is sent, each merged with what's saved, so saving one never resets another.
        settings: Object.fromEntries(Object.entries(venue.settings).map(([k, v]) => [k, { ...(v as object), ...((p.settings as Record<string, object> | undefined)?.[k] ?? {}) }])),
      },
    }),
    { success: opts.success ?? "Saved", onDone: opts.onDone },
  );
}

export function useMoney() {
  const { venue } = useH();
  return (n: number) => formatPrice(n, venue.currency);
}

/** Tables in floor order: by area, then naturally by name (T2 before T10); rooms last. */
export function sortTables<T extends { name: string; areaId?: string | null; kind?: string }>(tables: T[], areas: { id: string }[] = []) {
  const at = (t: T) => (t.kind === "room" ? 1e6 : t.areaId ? areas.findIndex((a) => a.id === t.areaId) : 1e5);
  return [...tables].sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** A switch with its label beside it (Switch on its own only labels for screen readers). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13.5px]">
      <span onClick={() => onChange(!checked)} className="cursor-pointer select-none">
        {label}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** "whisky" → "Whisky" (only the first letter, unlike CSS capitalize). */
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Minutes since a time, for tickets and tables. */
export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "good" }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface p-4 shadow-sm">
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <p className={cx("mt-1 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums", tone === "warn" && "text-warning", tone === "good" && "text-success")}>{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] text-subtle">{sub}</p>}
    </div>
  );
}

export function DietMark({ diet }: { diet: string }) {
  if (diet === "none") return null;
  const color = diet === "veg" || diet === "vegan" ? "#16a34a" : diet === "egg" ? "#ca8a04" : "#b45309";
  return (
    <span className="inline-grid size-[14px] shrink-0 place-items-center rounded-[3px] border-[1.6px]" style={{ borderColor: color, color }} title={diet}>
      {diet === "nonveg" ? <span className="size-0 border-x-[4px] border-b-[7px] border-x-transparent" style={{ borderBottomColor: color }} /> : <span className="size-[7px] rounded-full" style={{ background: color }} />}
    </span>
  );
}

export const STATUS_TONE: Record<string, string> = {
  pending: "bg-[#e0e7ff] text-[#3730a3]",
  new: "bg-warning-soft text-warning",
  preparing: "bg-[#ffedd5] text-[#9a3412]",
  ready: "bg-success-soft text-success",
  served: "bg-surface-3 text-muted",
  void: "bg-danger-soft text-danger line-through",
};
export const STATUS_LABEL: Record<string, string> = { pending: "Awaiting OK", new: "Sent", preparing: "Cooking", ready: "Ready", served: "Served", void: "Cancelled" };

export function Pill({ status }: { status: string }) {
  return <span className={cx("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap", STATUS_TONE[status] ?? "bg-surface-2")}>{STATUS_LABEL[status] ?? status}</span>;
}

/** Major-unit input that stores minor units. */
export function toMinor(v: string) {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export const toMajor = (n: number) => (n / 100).toString();
