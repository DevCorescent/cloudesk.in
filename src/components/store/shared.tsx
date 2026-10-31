"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Badge, cx, Input } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { formatMoney, minorDigits, parseMoney } from "@/lib/store/money";

export type Store = {
  projectId: string;
  name: string;
  email: string;
  phone: string;
  currency: string;
  currencies: { code: string; rate: string; rounding: "none" | "whole" | "x.99" | "x.95" }[];
  currencyRatesUpdatedAt: string | null;
  country: string;
  region: string;
  address: { line1: string; line2?: string; city: string; region: string; postalCode: string; country: string } | null;
  taxId: string;
  pricesIncludeTax: boolean;
  defaultTaxBps: number;
  orderPrefix: string;
  lowStockThreshold: number;
  policies: { refund?: string; shipping?: string; privacy?: string; terms?: string };
  checkout: { requirePhone?: boolean; orderNotes?: boolean; termsRequired?: boolean; showTrustBadges?: boolean; announcement?: string; returnDays?: number };
  notifyEmails: string[];
};

export type TemplateCard = { id: string; name: string; description: string; category: string; image: string; accent: string; storeName: string; signature?: boolean };

type Ctx = { projectId: string; store: Store; base: string; can: (p: string) => boolean; liveUrl: string | null; mailDelivery: boolean };
const StoreCtx = createContext<Ctx | null>(null);
export const StoreProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
export function useStoreCtx() {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStoreCtx outside StoreProvider");
  return v;
}

export const storeApi = (projectId: string, path = "") => `/api/v1/projects/${projectId}/store${path ? `/${path}` : ""}`;

/** Fetch helper bound to the current store. */
export function useStoreQuery<T>(path: string, opts: { enabled?: boolean; refetchInterval?: (q: { state: { data?: T } }) => number | false } = {}) {
  const { projectId } = useStoreCtx();
  return useQuery({ queryKey: ["store", projectId, path], queryFn: () => api<T>(storeApi(projectId, path)), enabled: opts.enabled, refetchInterval: opts.refetchInterval });
}

export function useMoney() {
  const { store } = useStoreCtx();
  return (minor: number | null | undefined) => (minor === null || minor === undefined ? "—" : formatMoney(minor, store.currency));
}

/** Text input for prices, editing in major units and emitting minor units. */
export function MoneyInput({ value, onChange, currency, placeholder, id, ...rest }: { value: number | null; onChange: (v: number | null) => void; currency: string; placeholder?: string; id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string; "aria-label"?: string }) {
  const d = minorDigits(currency);
  const fmt = (v: number | null) => (v === null ? "" : (v / 10 ** d).toFixed(d).replace(/\.00$/, ""));
  const [text, setText] = useState(fmt(value));
  const [last, setLast] = useState(value);
  // Keep the text in step when the value changes from outside.
  if (value !== last) {
    setLast(value);
    if (parseMoney(text, currency) !== value) setText(fmt(value));
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-subtle">{currencySymbol(currency)}</span>
      <Input
        id={id}
        inputMode="decimal"
        className="pl-7 tabular-nums"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim() === "" ? null : parseMoney(e.target.value, currency);
          setLast(v);
          onChange(v);
        }}
        {...rest}
      />
    </div>
  );
}

export const currencySymbol = (c: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: c, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? c;
  } catch {
    return c;
  }
};

const FIN: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  pending: { label: "Payment pending", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  partially_refunded: { label: "Partly refunded", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
  voided: { label: "Voided", tone: "neutral" },
};
const FUL: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  unfulfilled: { label: "Unfulfilled", tone: "warning" },
  packed: { label: "Packed", tone: "accent" },
  shipped: { label: "Shipped", tone: "accent" },
  delivered: { label: "Delivered", tone: "success" },
};

export function OrderBadges({ financial, fulfillment, cancelled, method }: { financial: string; fulfillment: string; cancelled?: string | null; method?: string }) {
  if (cancelled) return <Badge tone="danger">Cancelled</Badge>;
  const f = FIN[financial] ?? { label: financial, tone: "neutral" as const };
  const s = FUL[fulfillment] ?? { label: fulfillment, tone: "neutral" as const };
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={f.tone}>{financial === "pending" && method === "cod" ? "COD — collect on delivery" : f.label}</Badge>
      <Badge tone={s.tone}>{s.label}</Badge>
    </span>
  );
}

export const PAYMENT_LABEL: Record<string, string> = { cod: "Cash on delivery", manual: "UPI / bank transfer", giftcard: "Gift card", stripe: "Stripe", razorpay: "Razorpay", paypal: "PayPal" };

/** A titled settings block with an optional description and actions. */
export function Panel({ title, description, actions, children, className }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function SubHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs text-muted hover:text-fg">
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-lg font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A data table shell that scrolls horizontally on narrow screens. */
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 font-medium whitespace-nowrap first:pl-4 last:pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const td = "px-3 py-2.5 align-middle first:pl-4 last:pr-4";

export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
