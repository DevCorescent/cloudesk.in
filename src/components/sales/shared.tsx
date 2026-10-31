"use client";

// Sales: shared client pieces — the meta, types, money and status.
import { cx } from "@/components/ui/primitives";
import { useModule, useModuleAction, useModuleQuery } from "@/components/shell/module-frame";
import type { OrderStatus, SalesSettings } from "@/lib/sales/model";
import { ORDER_STATUS_LABEL } from "@/lib/sales/model";
import { formatPrice } from "@/lib/store/money";
export { Section, Stat } from "@/components/crm/shared";

export type Meta = {
  me: { id: string; write: boolean; manage: boolean };
  settings: SalesSettings;
  people: { id: string; name: string }[];
  books: { id: string; name: string; kind: "book" | "project" }[];
  items: { id: string; name: string; sku: string; unit: string; hsn: string; gstRate: number; trackSerials: boolean }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  lists: { id: string; name: string; isDefault: boolean; kind: string }[];
  parts: { pricing: boolean; delivery: boolean; commissions: boolean };
  links: { inventory: boolean; crm: boolean };
};

export type Line = { id: string; itemId: string | null; name: string; hsn: string; unit: string; qty: number; rate: number; listRate: number; discountPct: number; taxBps: number; delivered: number; invoiced: number; returned: number };
export type Order = { id: string; number: string; ownerId: string; clientId: string; clientName: string; date: string; expectedDate: string | null; warehouseId: string | null; salespersonId: string | null; priceListId: string | null; placeOfSupply: string; reference: string; dealId: string | null; lines: Line[]; subtotal: number; discount: number; tax: number; total: number; status: OrderStatus; holds: string[]; notes: string; createdBy: string | null };
export type Customer = { clientId: string; ownerId: string; book: string; name: string; contact: string; gstin: string; state: string; terms: { priceListId: string | null; creditLimit: number; paymentTermsDays: number; discountPct: number; salespersonId: string | null; onHold: boolean; notes: string } | null; owed: number; onOrder: number; limit: number; headroom: number | null };

export const useSales = () => useModule<Meta>();
export const useSalesQuery = useModuleQuery;
export const useSalesAction = useModuleAction;

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatPrice(n, "INR"));
export const short = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(1)}L` : formatPrice(Math.round(n / 100) * 100, "INR").replace(/\.00$/, ""));
export const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
export const fromPaise = (n: number | null | undefined) => (n ? String(n / 100) : "");
export const fmt = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" }) : "—");
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const qty = (n: number) => Number(n.toFixed(3)).toLocaleString("en-IN", { maximumFractionDigits: 3 });

const TONE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  pending_approval: "bg-warning-soft text-warning",
  confirmed: "bg-accent-soft text-accent",
  partial: "bg-warning-soft text-warning",
  delivered: "bg-success-soft text-success",
  closed: "bg-surface-2 text-muted",
  cancelled: "bg-surface-2 text-muted",
  dispatched: "bg-accent-soft text-accent",
};
export function StatusPill({ status }: { status: string }) {
  return <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", TONE[status] ?? "bg-surface-2 text-muted")}>{ORDER_STATUS_LABEL[status as OrderStatus] ?? (status === "dispatched" ? "On the way" : status[0].toUpperCase() + status.slice(1))}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
}
