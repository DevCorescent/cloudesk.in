"use client";

// Inventory: shared client pieces — the workspace's locations, suppliers and
// switched-on parts, API hooks, money and quantities, and small parts used on
// every screen.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import type { InvSettings } from "@/lib/inventory/model";
import { formatPrice } from "@/lib/store/money";
export { Section, Stat } from "@/components/crm/shared";
export { fmtQty, q3 } from "@/lib/inventory/model";

export type Warehouse = { id: string; name: string; code: string; address: string; state: string; projectId: string | null; isDefault: boolean; active: boolean };
export type Meta = {
  me: { write: boolean; manage: boolean };
  settings: InvSettings;
  warehouses: Warehouse[];
  suppliers: { id: string; name: string; state: string; active: boolean; approval: "pending" | "approved" | "blocked" }[];
  categories: string[];
  stores: { id: string; name: string; linked: boolean }[];
  parts: { purchasing: boolean; locations: boolean; batches: boolean; procurement: boolean; warehouse: boolean };
};
export type Item = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  category: string;
  hsn: string;
  gstRate: number;
  avgCost: number;
  trackBatches: boolean;
  reorderLevel: number;
  reorderQty: number;
  safetyStock: number;
  trackSerials: boolean;
  supplierId: string | null;
  projectId: string | null;
  variantId: string | null;
  notes: string;
  active: boolean;
  onHand: number;
  onOrder: number;
  value: number;
  low: boolean;
  byLocation: Record<string, number>;
  storeTitle: string | null;
};

type Ctx = { orgId: string; meta: Meta; go: (path: string) => void };
const InvCtx = createContext<Ctx | null>(null);
export const InvProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <InvCtx.Provider value={value}>{children}</InvCtx.Provider>;
export function useInv() {
  const c = useContext(InvCtx);
  if (!c) throw new Error("Inventory context missing");
  return c;
}

export const invApi = (orgId: string, path: string) => `/api/v1/orgs/${orgId}/inventory/${path}`;

export function useInvQuery<T>(path: string | null, opts: { keepPrevious?: boolean; refetchInterval?: number } = {}) {
  const { orgId } = useInv();
  return useQuery({ queryKey: ["inv", orgId, path], queryFn: () => api<T>(invApi(orgId, path!)), enabled: !!path, placeholderData: opts.keepPrevious ? keepPreviousData : undefined, refetchInterval: opts.refetchInterval });
}

export function useInvAction<B = unknown, R = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown }, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void } = {}) {
  const { orgId } = useInv();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api<R>(invApi(orgId, r.path), { method: r.method ?? "POST", body: r.body ?? {} });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["inv", orgId] });
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
/** ₹4.2L, ₹1.1Cr, or the full amount below a lakh. */
export const short = (n: number) => (Math.abs(n) >= 1e9 ? `₹${(n / 1e9).toFixed(2)}Cr` : Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(1)}L` : formatPrice(Math.round(n / 100) * 100, "INR").replace(/\.00$/, ""));
export const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
export const fromPaise = (n: number | null | undefined) => (n ? String(n / 100) : "");
export const fmt = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" }) : "—");
export const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const whName = (meta: Meta, id: string | null | undefined) => meta.warehouses.find((w) => w.id === id)?.name ?? "—";
export const supName = (meta: Meta, id: string | null | undefined) => meta.suppliers.find((w) => w.id === id)?.name ?? "—";

const STATUS: Record<string, [string, string]> = {
  draft: ["bg-surface-2 text-muted", "Draft"],
  sent: ["bg-accent-soft text-accent", "Sent"],
  partial: ["bg-warning-soft text-warning", "Part received"],
  received: ["bg-success-soft text-success", "Received"],
  closed: ["bg-surface-2 text-muted", "Closed"],
  cancelled: ["bg-surface-2 text-muted", "Cancelled"],
  in_transit: ["bg-warning-soft text-warning", "In transit"],
  low: ["bg-warning-soft text-warning", "Low"],
  out: ["bg-danger-soft text-danger", "Out"],
  late: ["bg-danger-soft text-danger", "Late"],
  expired: ["bg-danger-soft text-danger", "Expired"],
  soon: ["bg-warning-soft text-warning", "Expiring"],
};
export function StatusPill({ status }: { status: string }) {
  const [c, label] = STATUS[status] ?? ["bg-surface-2 text-muted", status];
  return <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", c)}>{label}</span>;
}

export const MOVE_LABEL: Record<string, string> = { receive: "Received", issue: "Issued", adjust: "Adjusted", count: "Count", transfer_out: "Sent out", transfer_in: "Arrived", return: "Returned", sale: "Sold", store: "Store edit" };

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
}

/** A signed quantity, green in and red out. */
export function Delta({ qty, unit }: { qty: number; unit?: string }) {
  return (
    <b className={cx("tabular-nums", qty > 0 ? "text-success" : qty < 0 ? "text-danger" : "text-muted")}>
      {qty > 0 ? "+" : ""}
      {Number(qty.toFixed(3)).toLocaleString("en-IN", { maximumFractionDigits: 3 })}
      {unit && unit !== "pcs" ? ` ${unit}` : ""}
    </b>
  );
}
