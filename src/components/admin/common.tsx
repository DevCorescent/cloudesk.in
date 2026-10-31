"use client";

// Shared pieces of the platform console: the API helper that refreshes the
// console after an action, the admin's own permissions, and small displays.
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, Card, Field, Input, Notice } from "@/components/ui/primitives";
import type { ChartKind, Result } from "@/components/bi/chart";
import { ChartView } from "@/components/bi/chart";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import type { PlatformPerm, PlatformRole } from "@/lib/platform/admin-roles";

export type Me = { role: PlatformRole; perms: PlatformPerm[]; roles: Record<PlatformRole, { name: string; what: string }> };
export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);
export const useCan = () => {
  const me = useMe();
  return (p: PlatformPerm) => !!me?.perms.includes(p);
};

export const useAdmin = <T,>(path: string, opts: { enabled?: boolean; refetchInterval?: number } = {}) =>
  useQuery({ queryKey: ["admin", path], queryFn: () => api<T>(`/api/v1/admin/${path}`), placeholderData: keepPreviousData, ...opts });

/** Asks for the password again before a sensitive action (the server requires it within 15 minutes). */
const ReauthContext = createContext<() => Promise<boolean>>(async () => false);
export const useReauth = () => useContext(ReauthContext);

export function ReauthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback(() => new Promise<boolean>((resolve) => {
    pending.current = resolve;
    setPassword("");
    setCode("");
    setErr("");
    setOpen(true);
  }), []);
  const finish = (ok: boolean) => {
    setOpen(false);
    pending.current?.(ok);
    pending.current = null;
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/v1/admin/reauth", { method: "POST", body: { password, code } });
      finish(true);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ReauthContext.Provider value={ask}>
      {children}
      <Dialog
        open={open}
        onClose={() => finish(false)}
        size="sm"
        title="Confirm it's you"
        description={"This is a sensitive change. Enter your password — you won't be asked again for 15 minutes."}
        footer={<><Button onClick={() => finish(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!password && !code} onClick={() => void submit()}>Confirm</Button></>}
      >
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {err && <Notice tone="danger">{err}</Notice>}
          <Field label="Password">{(a) => <Input {...a} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Field label="Or a two-step code" hint="Only for accounts that sign in with GitHub or SSO.">{(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <button type="submit" className="hidden" />
        </form>
      </Dialog>
    </ReauthContext.Provider>
  );
}

const needsReauth = (e: unknown) => e instanceof ApiClientError && e.status === 403 && !!(e.details as { reauth?: boolean } | null)?.reauth;

/** Runs a console action, refreshes everything, and says how it went (asking for the password first when the server needs it). */
export function useRun() {
  const qc = useQueryClient();
  const toast = useToast();
  const reauth = useReauth();
  return async <T = unknown,>(path: string, method: string, body?: unknown, done?: string): Promise<T | null> => {
    const call = () => api<T>(`/api/v1/admin/${path}`, { method, body: body ?? {} });
    try {
      let r: T;
      try {
        r = await call();
      } catch (e) {
        if (!needsReauth(e) || !(await reauth())) throw e;
        r = await call();
      }
      await qc.invalidateQueries({ queryKey: ["admin"] });
      if (done) toast({ tone: "success", title: done });
      return r;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return null;
    }
  };
}

export const bytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} kB` : `${b} B`);
export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-IN");
export const duration = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "danger" | "warning" | "success" }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.02em] ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-muted">{sub}</p>}
    </Card>
  );
}

export function Section({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {sub && <p className="text-[12.5px] text-muted">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A daily series (or several sharing one unit) as a report chart. */
export function DailyChart({ series, kind = "bar" }: { series: { label: string; points: { day: string; n: number }[] }[]; kind?: ChartKind }) {
  const days = series[0]?.points.map((p) => p.day) ?? [];
  const r: Result = {
    dims: 1,
    columns: [{ key: "day", label: "Day", type: "date", bucket: "day" }, ...series.map((s, i) => ({ key: `s${i}`, label: s.label, type: "count" as const }))],
    rows: days.map((d, i) => [d, ...series.map((s) => s.points[i]?.n ?? 0)]),
    totals: [null, ...series.map((s) => s.points.reduce((a, p) => a + p.n, 0))],
    range: { from: days[0] ?? null, to: days[days.length - 1] ?? null },
    truncated: false,
  };
  return <ChartView r={r} kind={kind} compact />;
}
