"use client";

// Shared pieces of the Calendar: the API scoped to the workspace, the meta and
// range queries, and date helpers in the viewer's own time zone.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSession } from "@/components/shell/session-context";
import { api } from "@/lib/client/api";
import type { CalMetaOut, RangeOut } from "@/lib/calendar/api";

export const calKey = (orgId: string, ...rest: unknown[]) => ["calendar", orgId, ...rest];

export function useCalApi() {
  const { org } = useSession();
  const base = `/api/v1/orgs/${org.id}/calendar`;
  const call = useCallback(<T,>(path: string, method = "GET", body?: unknown) => api<T>(`${base}/${path}`, method === "GET" || method === "DELETE" ? { method } : { method, body: body ?? {} }), [base]);
  return { orgId: org.id, base, call };
}

export function useCalMeta(enabled = true) {
  const { orgId, call } = useCalApi();
  return useQuery({ queryKey: calKey(orgId, "meta"), queryFn: () => call<CalMetaOut>("meta"), refetchInterval: 60_000, enabled, retry: false });
}

export function useRange(from: Date, to: Date) {
  const { orgId, call } = useCalApi();
  return useQuery({
    queryKey: calKey(orgId, "range", from.toISOString(), to.toISOString()),
    queryFn: () => call<RangeOut>(`events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
}

export function useCalRefresh() {
  const qc = useQueryClient();
  const { orgId } = useCalApi();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: calKey(orgId) });
    void qc.invalidateQueries({ queryKey: ["mail", orgId] });
  }, [qc, orgId]);
}

// ── Dates (local time) ──────────────────────────────────────────────────────

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
/** Weeks start on Monday. */
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const time = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" ", "");
export const timeFull = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const localTz = () => (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Asia/Kolkata");

/** "Tue, 28 Oct · 3:00 – 4:00 pm" in local time. */
export function whenLocal(start: Date, end: Date, allDay: boolean) {
  const day = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  if (allDay) {
    const last = addDays(end, -1);
    return last > start && !sameDay(last, start) ? `${day(start)} – ${day(last)} · all day` : `${day(start)} · all day`;
  }
  return sameDay(start, end) ? `${day(start)} · ${timeFull(start)} – ${timeFull(end)}` : `${day(start)} ${timeFull(start)} – ${day(end)} ${timeFull(end)}`;
}

/** The event colour at a given strength, for fills and borders. */
export const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

/** Datetime-local input value for a date. */
export const toLocalInput = (d: Date) => `${dayKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
