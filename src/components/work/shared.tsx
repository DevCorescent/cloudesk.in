"use client";

// Projects & timesheets: shared client pieces — the team, settings and
// switched-on parts, API hooks, hours and money, and small parts used on
// every screen.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { formatPrice } from "@/lib/store/money";
import type { TaskStatus, WorkSettings } from "@/lib/work/model";
export { Section, Stat } from "@/components/crm/shared";
export { hm, hrs, parseDuration, weekDays, weekOf, addDays } from "@/lib/work/model";

export type Person = { id: string; name: string; email: string; role: string };
export type Meta = {
  me: { id: string; write: boolean; manage: boolean; payroll: boolean };
  settings: WorkSettings;
  people: Person[];
  books: { id: string; name: string; kind: "book" | "project" }[];
  parts: { timesheets: boolean; billing: boolean; profit: boolean; planning: boolean; expenses: boolean; control: boolean };
  links: { crm: boolean; invoicing: boolean; hr: boolean };
};
export type Project = {
  id: string;
  code: string;
  name: string;
  description: string;
  ownerId: string | null;
  clientId: string | null;
  clientName: string;
  dealId: string | null;
  status: "planned" | "active" | "on_hold" | "done" | "cancelled";
  billing: "hourly" | "fixed" | "none";
  rate: number;
  fee: number;
  budgetHours: number;
  budgetAmount: number;
  startDate: string | null;
  dueDate: string | null;
  leadId: string | null;
  tint: string;
};
export type Stats = { tasks: number; done: number; overdue: number; minutes: number; billableMinutes: number; unbilledMinutes: number; used: number };
export type ProjectRow = Project & { stats: Stats; burn: number | null; members: string[] };
export type Task = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: "low" | "normal" | "high" | "urgent";
  assigneeId: string | null;
  milestoneId: string | null;
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimateHours: number;
  billable: boolean;
  checklist: { id: string; text: string; done: boolean }[];
  tags: string[];
  position: number;
  completedAt: string | null;
  logged: number;
  subtasks: number;
  subtasksDone: number;
  comments: number;
  checklistDone: number;
  overdue: boolean;
  project?: { code: string; name: string; tint: string };
};
export type Milestone = { id: string; projectId: string; name: string; dueDate: string | null; amount: number; doneAt: string | null; invoiceId: string | null; tasks: number; tasksDone: number };

type Ctx = { orgId: string; meta: Meta; go: (path: string) => void };
const WorkCtx = createContext<Ctx | null>(null);
export const WorkProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <WorkCtx.Provider value={value}>{children}</WorkCtx.Provider>;
export function useWork() {
  const c = useContext(WorkCtx);
  if (!c) throw new Error("Projects context missing");
  return c;
}

export const workApi = (orgId: string, path: string) => `/api/v1/orgs/${orgId}/work/${path}`;

export function useWorkQuery<T>(path: string | null, opts: { keepPrevious?: boolean; refetchInterval?: number } = {}) {
  const { orgId } = useWork();
  return useQuery({ queryKey: ["work", orgId, path], queryFn: () => api<T>(workApi(orgId, path!)), enabled: !!path, placeholderData: opts.keepPrevious ? keepPreviousData : undefined, refetchInterval: opts.refetchInterval });
}

export function useWorkAction<B = unknown, R = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown }, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void } = {}) {
  const { orgId } = useWork();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api<R>(workApi(orgId, r.path), { method: r.method ?? "POST", body: r.body ?? {} });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["work", orgId] });
      if (opts.success) toast({ tone: "success", title: typeof opts.success === "function" ? opts.success(r) : opts.success });
      opts.onDone?.(r);
    },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
}

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatPrice(n, "INR"));
/** ₹4.2L, ₹1.1Cr, or the amount in rupees below a lakh. */
export const short = (n: number) => (Math.abs(n) >= 1e9 ? `₹${(n / 1e9).toFixed(2)}Cr` : Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(1)}L` : formatPrice(Math.round(n / 100) * 100, "INR").replace(/\.00$/, ""));
export const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
export const fromPaise = (n: number | null | undefined) => (n ? String(n / 100) : "");
export const fmt = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" }) : "—");
export const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);
export const personName = (meta: Meta, id: string | null | undefined) => meta.people.find((p) => p.id === id)?.name ?? "Nobody";

/** A project's colour as a chip (background and ink from the theme's tints). */
export const tint = (t: string | undefined) => `tint-${t || "sky"} tint-chip`;

/** Initials in a round chip; "Nobody" shows a dashed ring. */
export function Avatar({ name, size = 24, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const n = name?.trim();
  const initials = n ? n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") : "";
  return (
    <span title={n || "Nobody"} aria-hidden className={cx("inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold", n ? "bg-surface-2 text-fg" : "border border-dashed border-border text-subtle", className)} style={{ width: size, height: size }}>
      {initials || "?"}
    </span>
  );
}

const STATUS: Record<string, [string, string]> = {
  planned: ["bg-surface-2 text-muted", "Planned"],
  active: ["bg-accent-soft text-accent", "Active"],
  on_hold: ["bg-warning-soft text-warning", "On hold"],
  done: ["bg-success-soft text-success", "Done"],
  cancelled: ["bg-surface-2 text-muted", "Cancelled"],
  draft: ["bg-surface-2 text-muted", "Draft"],
  submitted: ["bg-warning-soft text-warning", "Waiting for approval"],
  approved: ["bg-success-soft text-success", "Approved"],
  rejected: ["bg-danger-soft text-danger", "Sent back"],
  empty: ["bg-surface-2 text-muted", "Nothing logged"],
  overdue: ["bg-danger-soft text-danger", "Overdue"],
  billed: ["bg-success-soft text-success", "Invoiced"],
  sent: ["bg-accent-soft text-accent", "Sent"],
  paid: ["bg-success-soft text-success", "Paid"],
  partial: ["bg-warning-soft text-warning", "Part paid"],
  viewed: ["bg-accent-soft text-accent", "Viewed"],
  void: ["bg-surface-2 text-muted", "Void"],
};
export function StatusPill({ status, label }: { status: string; label?: string }) {
  const [c, l] = STATUS[status] ?? ["bg-surface-2 text-muted", status];
  return <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", c)}>{label ?? l}</span>;
}

const PRIORITY: Record<string, string> = { low: "text-subtle", normal: "text-muted", high: "text-warning", urgent: "text-danger" };
export function PriorityFlag({ priority }: { priority: string }) {
  if (priority === "normal") return null;
  return <span className={cx("text-[11px] font-semibold uppercase", PRIORITY[priority])}>{priority}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
}

/** A thin bar, amber past 90% and red past 100% (unless plain). */
export function Bar({ value, className, plain }: { value: number | null; className?: string; /** A share, not a budget: no warning colours. */ plain?: boolean }) {
  const v = value ?? 0;
  return (
    <span className={cx("block h-1.5 overflow-hidden rounded-full bg-surface-2", className)}>
      <span className={cx("block h-full rounded-full", plain ? "bg-accent" : v > 1 ? "bg-danger" : v >= 0.9 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, v * 100)}%` }} />
    </span>
  );
}
