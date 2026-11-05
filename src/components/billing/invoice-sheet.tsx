"use client";

// One subscription invoice, laid out like paper. The dialog shows it; for
// printing, a copy is placed straight under <body> and everything else is
// hidden by the print stylesheet, so the page prints as just the invoice.
import { Printer } from "lucide-react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/ui/overlays";
import { Badge, Button, cx } from "@/components/ui/primitives";
import { money } from "@/lib/billing/catalog";
import { day, isFuture, type Invoice } from "./types";

const VIA: Record<string, string> = { razorpay: "Razorpay", stripe: "Stripe", manual: "Bank transfer", credit: "Account credit" };
const KIND: Record<Invoice["kind"], string> = { first: "First period", renewal: "Renewal", upgrade: "Plan change", topup: "Top-up", manual: "Raised by Cloudesk" };

const PRINT_CSS = `
@media screen { .cd-invoice-print { display: none; } }
@media print {
  @page { margin: 14mm; }
  html, body { background: #fff !important; }
  body > :not(.cd-invoice-print) { display: none !important; }
  .cd-invoice-print { display: block; color: #111; }
}`;

export function invoiceTone(s: Invoice["status"], dueAt: string | null): "success" | "warning" | "danger" | "neutral" {
  if (s === "paid") return "success";
  if (s === "void") return "neutral";
  return dueAt && !isFuture(dueAt, -86_400_000) ? "danger" : "warning";
}
export const invoiceStatus = (s: Invoice["status"], dueAt: string | null) => (s === "paid" ? "Paid" : s === "void" ? "Cancelled" : dueAt && !isFuture(dueAt, -86_400_000) ? "Overdue" : "Open");

function Paper({ inv, workspace, print }: { inv: Invoice; workspace: string; print?: boolean }) {
  const pct = inv.taxBps / 100;
  return (
    <article className={cx("text-[13px] leading-relaxed", print ? "mx-auto max-w-[720px]" : "rounded-[16px] border border-border bg-white p-5 text-[#111] shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-7 dark:bg-white")}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/10 pb-4">
        <div>
          <p className="text-[20px] font-semibold tracking-[-0.02em]">Cloudesk</p>
          <p className="text-[12px] text-black/55">Tax invoice for a subscription</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[14px] font-semibold">{inv.number}</p>
          <p className="text-[12px] text-black/55">Issued {day(inv.createdAt)}</p>
          {!print && (
            <Badge tone={invoiceTone(inv.status, inv.dueAt)} className="mt-1">
              {invoiceStatus(inv.status, inv.dueAt)}
            </Badge>
          )}
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 py-4 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-[11px] font-semibold tracking-[0.06em] text-black/50 uppercase">Billed to</dt>
          <dd className="font-medium break-words">{workspace}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.06em] text-black/50 uppercase">Period</dt>
          <dd>{inv.periodStart ? `${day(inv.periodStart)} – ${day(inv.periodEnd)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.06em] text-black/50 uppercase">Due</dt>
          <dd>{day(inv.dueAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.06em] text-black/50 uppercase">Status</dt>
          <dd>{inv.status === "paid" ? `Paid ${day(inv.paidAt)}${inv.paidVia ? ` · ${VIA[inv.paidVia] ?? inv.paidVia}` : ""}` : invoiceStatus(inv.status, inv.dueAt)}</dd>
        </div>
      </dl>
      <p className="pb-2 text-[12px] text-black/55">
        {KIND[inv.kind]} · {inv.description}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black/10 text-left text-[11px] font-semibold tracking-[0.06em] text-black/50 uppercase">
            <th className="py-2 font-semibold">Item</th>
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i} className="border-b border-black/[0.06]">
              <td className={cx("py-2 pr-3", l.amount < 0 && "text-black/60")}>{l.label}</td>
              <td className={cx("py-2 text-right tabular-nums", l.amount < 0 && "text-[#1f7a52]")}>{l.amount < 0 ? `−${money(-l.amount, inv.currency)}` : money(l.amount, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-3 grid max-w-[300px] gap-1 tabular-nums">
        <div className="flex justify-between gap-4">
          <dt className="text-black/60">Subtotal</dt>
          <dd>{money(inv.subtotal, inv.currency)}</dd>
        </div>
        {inv.creditApplied > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-black/60">Credit applied</dt>
            <dd className="text-[#1f7a52]">−{money(inv.creditApplied, inv.currency)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-black/60">
            {inv.taxLabel} {pct % 1 ? pct.toFixed(2) : pct}%
          </dt>
          <dd>{money(inv.tax, inv.currency)}</dd>
        </div>
        <div className="mt-1 flex justify-between gap-4 border-t border-black/15 pt-2 text-[15px] font-semibold">
          <dt>Total</dt>
          <dd>{money(inv.total, inv.currency)}</dd>
        </div>
      </dl>
      <p className="mt-6 border-t border-black/10 pt-3 text-[11.5px] text-black/50">Amounts in {inv.currency}. Credit lines (shown with −) are unused time on an earlier plan or credit on your account.</p>
    </article>
  );
}

export function InvoiceSheet({ invoice, workspace, onClose, onPay, paying }: { invoice: Invoice; workspace: string; onClose: () => void; onPay?: () => void; paying?: boolean }) {
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        size="lg"
        title={`Invoice ${invoice.number}`}
        footer={
          <>
            <Button icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
              Print or save as PDF
            </Button>
            {onPay && invoice.status === "open" && invoice.total > 0 && (
              <Button variant="primary" loading={paying} onClick={onPay}>
                Pay {money(invoice.total, invoice.currency)}
              </Button>
            )}
          </>
        }
      >
        <Paper inv={invoice} workspace={workspace} />
      </Dialog>
      {typeof document !== "undefined" &&
        createPortal(
          <div className="cd-invoice-print">
            <style>{PRINT_CSS}</style>
            <Paper inv={invoice} workspace={workspace} print />
          </div>,
          document.body,
        )}
    </>
  );
}
