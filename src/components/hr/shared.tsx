"use client";

// HR: shared client pieces — who you are (HR admin, payroll, manager or
// yourself), the workspace's departments, locations, leave types and people,
// API hooks, money and dates, and small parts used on every screen.
import { useModules } from "@/components/shell/use-modules";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import type { HrSettings } from "@/lib/hr/model";
import { formatPrice } from "@/lib/store/money";
export { Avatar, Section, Stat } from "@/components/crm/shared";

export type Person = { id: string; name: string; designation: string; departmentId: string | null; managerId: string | null; status: string; userId: string | null };
export type LeaveType = { id: string; name: string; code: string; quota: number; accrual: string; carryForward: number; paid: boolean; allowHalf: boolean; color: string; active: boolean };
export type Meta = {
  me: { userId: string; role: string; manage: boolean; payroll: boolean; employeeId: string | null; name: string | null; reports: string[]; isManager: boolean };
  settings: HrSettings;
  departments: { id: string; name: string; headId: string | null; people: number }[];
  locations: { id: string; name: string; address: string; state: string }[];
  leaveTypes: LeaveType[];
  people: Person[];
  members: { id: string; name: string; email: string; role: string }[];
  ptStates: { code: string; name: string }[];
  units?: { id: string; code: string; name: string }[];
};

type Ctx = { orgId: string; meta: Meta; go: (path: string) => void };
const HrCtx = createContext<Ctx | null>(null);
export const HrProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <HrCtx.Provider value={value}>{children}</HrCtx.Provider>;
export function useHr() {
  const c = useContext(HrCtx);
  if (!c) throw new Error("HR context missing");
  return c;
}

export const hrApi = (orgId: string, path: string) => `/api/v1/orgs/${orgId}/hr/${path}`;

export function useHrQuery<T>(path: string | null, opts: { keepPrevious?: boolean; refetchInterval?: number } = {}) {
  const { orgId } = useHr();
  return useQuery({ queryKey: ["hr", orgId, path], queryFn: () => api<T>(hrApi(orgId, path!)), enabled: !!path, placeholderData: opts.keepPrevious ? keepPreviousData : undefined, refetchInterval: opts.refetchInterval });
}

export function useHrAction<B = unknown, R = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown }, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void } = {}) {
  const { orgId } = useHr();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api<R>(hrApi(orgId, r.path), { method: r.method ?? "POST", body: r.body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["hr", orgId] });
      // Anything this did may have opened or moved an approval.
      qc.invalidateQueries({ queryKey: ["approvals", orgId] });
      qc.invalidateQueries({ queryKey: ["notify", orgId] });
      if (opts.success) toast({ tone: "success", title: typeof opts.success === "function" ? opts.success(r) : opts.success });
      opts.onDone?.(r);
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
}

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatPrice(n, "INR"));
/** ₹12.5L a year */
export const lakh = (n: number) => (n >= 1e7 * 100 ? `₹${(n / 1e9).toFixed(2)}Cr` : `₹${(n / 1e7).toFixed(n % 1e7 === 0 ? 0 : 1)}L`);
export const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
export const fromPaise = (n: number | null | undefined) => (n ? String(n / 100) : "");

export const fmt = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" }) : "—");
export const timeOf = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—");
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const hours = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export const personName = (meta: Meta, id: string | null | undefined) => meta.people.find((p) => p.id === id)?.name ?? "—";
export const deptName = (meta: Meta, id: string | null | undefined) => meta.departments.find((d) => d.id === id)?.name ?? "—";
export const locName = (meta: Meta, id: string | null | undefined) => meta.locations.find((d) => d.id === id)?.name ?? "—";

const STATUS: Record<string, string> = {
  pending: "bg-warning-soft text-warning",
  approved: "bg-success-soft text-success",
  approving: "bg-warning-soft text-warning",
  paid: "bg-success-soft text-success",
  rejected: "bg-danger-soft text-danger",
  cancelled: "bg-surface-2 text-muted",
  active: "bg-success-soft text-success",
  notice: "bg-warning-soft text-warning",
  exited: "bg-surface-2 text-muted",
  draft: "bg-surface-2 text-muted",
  finalised: "bg-accent-soft text-accent",
  settled: "bg-success-soft text-success",
  to_explain: "bg-warning-soft text-warning",
  explained: "bg-accent-soft text-accent",
  personal: "bg-danger-soft text-danger",
  repaid: "bg-success-soft text-success",
};
const LABEL: Record<string, string> = { approving: "Further approval", pending: "Waiting", approved: "Approved", rejected: "Declined", cancelled: "Cancelled", paid: "Paid", active: "Active", notice: "On notice", exited: "Left", draft: "Draft", finalised: "Finalised", settled: "Settled", to_explain: "To explain", explained: "Explained", personal: "Personal", repaid: "Repaid" };
export function StatusPill({ status }: { status: string }) {
  return <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", STATUS[status] ?? "bg-surface-2 text-muted")}>{LABEL[status] ?? status}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
}

/** Whether a part of HR (attendance, leave, payroll, claims, hiring, performance, assets) is switched on. */
export function useHrParts() {
  const { partOn } = useModules();
  return (part: string) => partOn("hr", part);
}
