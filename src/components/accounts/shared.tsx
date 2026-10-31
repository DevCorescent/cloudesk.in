"use client";

// Accounting: shared client pieces — the chart of accounts, settings and
// switched-on parts, API hooks, money formatting and small parts.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import type { AccSettings } from "@/lib/accounting/model";
import { formatPrice } from "@/lib/store/money";
export { Section, Stat } from "@/components/crm/shared";

export type Account = { id: string; code: string; name: string; type: string; subtype: string; systemKey: string | null; description: string; bank: { bankName?: string; last4?: string; ifsc?: string } | null; active: boolean };
export type Meta = {
  me: { write: boolean; manage: boolean };
  settings: AccSettings;
  accounts: Account[];
  suppliers: { id: string; name: string; state: string }[];
  fy: { from: string; to: string; label: string };
  syncedAt: string | null;
  /** An AI provider is connected (bills can be read from a PDF or photo). */
  aiConnected?: boolean;
  parts: { bills: boolean; banking: boolean; gst: boolean };
  companies: { id: string; name: string; isDefault: boolean; gstin: string; active: boolean }[];
  branches: { id: string; name: string; companyId: string; active: boolean }[];
  units: { id: string; code: string; name: string; kind: string; active: boolean }[];
  /** Foreign currencies set up in Settings → Organisation. */
  currencies: { code: string; name: string }[];
};

/** Which part of the books reports show: a company, a branch, a cost centre (empty: everything). */
export type Slice = { companyId: string; branchId: string; costCentreId: string };
type Ctx = { orgId: string; meta: Meta; go: (path: string) => void; slice: Slice; setSlice: (s: Slice) => void };
const AccCtx = createContext<Ctx | null>(null);
export const AccProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <AccCtx.Provider value={value}>{children}</AccCtx.Provider>;
export function useAcc() {
  const c = useContext(AccCtx);
  if (!c) throw new Error("Accounts context missing");
  return c;
}

export const accApi = (orgId: string, path: string) => `/api/v1/orgs/${orgId}/accounts/${path}`;

export function useAccQuery<T>(path: string | null, opts: { keepPrevious?: boolean } = {}) {
  const { orgId } = useAcc();
  return useQuery({ queryKey: ["acc", orgId, path], queryFn: () => api<T>(accApi(orgId, path!)), enabled: !!path, placeholderData: opts.keepPrevious ? keepPreviousData : undefined });
}

export function useAccAction<B = unknown, R = unknown>(fn: (b: B) => { path: string; method?: string; body?: unknown }, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void } = {}) {
  const { orgId } = useAcc();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (b: B) => {
      const r = fn(b);
      return api<R>(accApi(orgId, r.path), { method: r.method ?? "POST", body: r.body ?? {} });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["acc", orgId] });
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
/** ₹4.2L, ₹1.1Cr, or whole rupees below a lakh. */
export const short = (n: number) => (Math.abs(n) >= 1e9 ? `${n < 0 ? "−" : ""}₹${(Math.abs(n) / 1e9).toFixed(2)}Cr` : Math.abs(n) >= 1e7 ? `${n < 0 ? "−" : ""}₹${(Math.abs(n) / 1e7).toFixed(1)}L` : formatPrice(Math.round(n / 100) * 100, "INR").replace(/\.00$/, ""));
/** A balance in the account's normal direction, with "Cr"/"Dr" when it's the other way. */
export const amt = (n: number) => (n < 0 ? `(${inr(-n)})` : inr(n));
export const toPaise = (v: string) => Math.round((Number(String(v).replace(/[^\d.]/g, "")) || 0) * 100);
export const fromPaise = (n: number | null | undefined) => (n ? String(n / 100) : "");
export const fmt = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" }) : "—");
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const accName = (meta: Meta, id: string | null | undefined) => {
  const a = meta.accounts.find((x) => x.id === id);
  return a ? a.name : "—";
};

export const SOURCE_LABEL: Record<string, string> = { depreciation: "Depreciation", asset_disposal: "Asset disposal", recurring: "Repeating journal", recurring_reversal: "Reversal", spread: "Spread",
  manual: "Journal",
  opening: "Opening balance",
  bank: "From bank",
  invoice: "Invoice",
  credit_note: "Credit note",
  invoice_payment: "Payment received",
  store_sale: "Store sale",
  store_refund: "Store refund",
  restaurant_sale: "Restaurant bill",
  bill: "Bill",
  bill_payment: "Bill paid",
  stock: "Stock",
  payroll: "Payroll",
  payroll_payment: "Salaries paid",
  claim: "Claim paid",
  tds_deposit: "TDS deposit",
  fx_revaluation: "Exchange revaluation",
  fx_revaluation_reversal: "Revaluation reversal",
  intercompany: "Intercompany",
  production: "Production",
  settlement: "Full and final",
  travel_advance: "Travel advance",
  trip_settlement: "Trip settlement",
  card_spend: "Company card",
  card_personal: "Personal card spend",
  card_repaid: "Card spend repaid",
  maintenance_parts: "Spare parts",
  fuel: "Fuel",
  trip_costs: "Trip costs",
  freight: "Freight",
  fee: "Fee",
  fee_payment: "Fee received",
  clinic_bill: "Clinic bill",
  clinic_payment: "Clinic payment",
  ra_bill: "RA bill",
  contract_receipt: "Contract receipt",
  receipt_advance: "Customer advance",
};

const STATUS: Record<string, [string, string]> = {
  open: ["bg-accent-soft text-accent", "Open"],
  draft: ["bg-surface-2 text-muted", "Draft"],
  approved: ["bg-accent-soft text-accent", "Approved"],
  cancelled: ["bg-surface-2 text-muted", "Cancelled"],
  partial: ["bg-warning-soft text-warning", "Part paid"],
  paid: ["bg-success-soft text-success", "Paid"],
  void: ["bg-surface-2 text-muted", "Void"],
  pending_approval: ["bg-warning-soft text-warning", "Waiting for approval"],
  rejected: ["bg-danger-soft text-danger", "Sent back"],
  overdue: ["bg-danger-soft text-danger", "Overdue"],
  unmatched: ["bg-warning-soft text-warning", "To match"],
  matched: ["bg-success-soft text-success", "Matched"],
  ignored: ["bg-surface-2 text-muted", "Ignored"],
};
export function StatusPill({ status }: { status: string }) {
  const [c, label] = STATUS[status] ?? ["bg-surface-2 text-muted", status];
  return <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap", c)}>{label}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[16px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{children}</p>;
}

/** Accounts as <option>s, grouped by type. */
export function AccountOptions({ accounts, filter }: { accounts: Account[]; filter?: (a: Account) => boolean }) {
  const groups: [string, string][] = [["asset", "Assets"], ["liability", "Liabilities"], ["equity", "Equity"], ["income", "Income"], ["expense", "Expenses"]];
  return (
    <>
      {groups.map(([t, label]) => {
        const list = accounts.filter((a) => a.type === t && a.active && (!filter || filter(a)));
        if (!list.length) return null;
        return (
          <optgroup key={t} label={label}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

/** The report filter as query parameters ("&companyId=…"), or "" for everything. */
export function useSliceQs() {
  const { slice } = useAcc();
  const p = Object.entries(slice).filter(([, v]) => v);
  return p.length ? `&${new URLSearchParams(p)}` : "";
}

/** Company, branch and cost centre pickers, shown when the workspace has any of them. */
export function SliceBar() {
  const { meta, slice, setSlice } = useAcc();
  if (meta.companies.length < 2 && !meta.branches.length && !meta.units.length) return null;
  const branches = meta.branches.filter((b) => !slice.companyId || b.companyId === slice.companyId);
  const sel = "h-8 rounded-[9px] border border-border bg-surface px-2 text-[12.5px]";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Which part of the books">
      {meta.companies.length > 1 && (
        <select aria-label="Company" value={slice.companyId} onChange={(e) => setSlice({ ...slice, companyId: e.target.value, branchId: "" })} className={sel}>
          <option value="">All companies</option>
          {meta.companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      {branches.length > 0 && (
        <select aria-label="Branch" value={slice.branchId} onChange={(e) => setSlice({ ...slice, branchId: e.target.value })} className={sel}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}
      {meta.units.length > 0 && (
        <select aria-label="Cost centre" value={slice.costCentreId} onChange={(e) => setSlice({ ...slice, costCentreId: e.target.value })} className={sel}>
          <option value="">All cost centres</option>
          {meta.units.map((u) => (
            <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
          ))}
        </select>
      )}
      {(slice.companyId || slice.branchId || slice.costCentreId) && (
        <button type="button" onClick={() => setSlice({ companyId: "", branchId: "", costCentreId: "" })} className="text-[12.5px] font-medium text-muted hover:text-fg">
          Show everything
        </button>
      )}
    </div>
  );
}
