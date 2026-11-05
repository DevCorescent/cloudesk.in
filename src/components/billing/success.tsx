"use client";

// After a payment the server has confirmed: a calm, celebratory moment that
// says what was paid for, line by line, and that the receipt is on its way.
// Only ever shown for an invoice the server reports as paid.
import { ArrowRight, Check, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSession } from "@/components/shell/session-context";
import { Button } from "@/components/ui/primitives";
import { money } from "@/lib/billing/catalog";
import { day, lineName, type Invoice, type Overview } from "./types";

const VIA: Record<string, string> = { razorpay: "Razorpay", stripe: "Stripe", manual: "Bank transfer", credit: "Account credit" };

/** What the payment bought, in a sentence. */
export function purposeOf(inv: Invoice, o: Overview | undefined): { title: string; sub: string } {
  const s = o?.subscription;
  const plan = s?.planName ?? "Your plan";
  const what = inv.lines.filter((l) => l.amount > 0).map((l) => lineName(l).replace(/ \(top-up\)$/, "")).join(", ");
  switch (inv.kind) {
    case "topup":
      return { title: "Top-up added", sub: `${what} — ready to use now. Whatever you don't use carries over to next month.` };
    case "upgrade":
      return { title: `${plan} is active`, sub: `Everything in your new plan is switched on${s?.currentPeriodEnd ? `, through ${day(s.currentPeriodEnd)}` : ""}.` };
    case "renewal":
      return { title: `${plan} renewed`, sub: inv.periodEnd ? `Paid through ${day(inv.periodEnd)}.` : "Your plan carries on." };
    case "first":
      return o?.state === "trial" && inv.periodStart && new Date(inv.periodStart).getTime() > Date.now()
        ? { title: `${plan} is all set`, sub: `It starts when your trial ends on ${day(inv.periodStart)} — no break, nothing more to do.` }
        : { title: `${plan} is active`, sub: inv.periodEnd ? `Paid through ${day(inv.periodEnd)}.` : "Every feature in it is switched on." };
    default:
      return { title: "Payment received", sub: inv.description };
  }
}

export function PaymentSuccess({ invoice: inv, overview, onClose }: { invoice: Invoice; overview?: Overview; onClose: () => void }) {
  const { user } = useSession();
  const p = purposeOf(inv, overview);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const onBilling = typeof window !== "undefined" && window.location.pathname.startsWith("/settings/billing");
  return createPortal(
    <div className="pay-ok fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/30 p-4 backdrop-blur-[8px] max-sm:items-end max-sm:p-0" role="dialog" aria-modal="true" aria-labelledby="pay-ok-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pay-ok-card relative border border-border bg-[var(--surface-solid)] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.35)] w-full max-w-[420px] overflow-hidden rounded-[28px] px-6 pt-8 pb-6 text-center max-sm:max-w-none max-sm:rounded-b-none max-sm:pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div aria-hidden className="pay-ok-glow pointer-events-none absolute inset-x-0 -top-24 mx-auto size-72 rounded-full" />
        {/* The mark: a ring that settles, a check that draws itself, a soft burst. */}
        <div className="relative mx-auto grid size-[88px] place-items-center" aria-hidden>
          <span className="pay-ok-ring absolute inset-0 rounded-full" />
          <span className="pay-ok-wave absolute inset-0 rounded-full" />
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="pay-ok-spark absolute top-1/2 left-1/2 size-1.5 rounded-full" style={{ "--a": `${i * 30}deg`, "--d": `${(i % 3) * 40}ms` } as CSSProperties} />
          ))}
          <svg viewBox="0 0 52 52" className="relative size-[46px]">
            <path className="pay-ok-check" d="M14 27.5 22.5 36 38.5 18" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="pay-ok-rise relative mt-5" style={{ "--d": "380ms" } as CSSProperties}>
          <p className="text-[12px] font-semibold tracking-[0.12em] text-success uppercase">Payment successful</p>
          <p className="mt-1.5 text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{money(inv.total, inv.currency)}</p>
        </div>
        <div className="pay-ok-rise relative mt-4" style={{ "--d": "500ms" } as CSSProperties}>
          <h2 id="pay-ok-title" className="text-[17px] font-semibold tracking-[-0.015em] text-balance">
            {p.title}
          </h2>
          <p className="mx-auto mt-1 max-w-[34ch] text-[13px] text-muted text-pretty">{p.sub}</p>
        </div>

        <dl className="pay-ok-rise relative mt-5 grid gap-1.5 rounded-[16px] bg-surface-2 p-3.5 text-left text-[12.5px] tabular-nums" style={{ "--d": "620ms" } as CSSProperties}>
          {inv.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-3">
              <dt className="min-w-0 truncate text-muted">{lineName(l)}</dt>
              <dd className={l.amount < 0 ? "text-success" : ""}>{l.amount < 0 ? `−${money(-l.amount, inv.currency)}` : money(l.amount, inv.currency)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-border pt-1.5">
            <dt className="text-muted">
              {inv.taxLabel} {inv.taxBps / 100}%
            </dt>
            <dd>{money(inv.tax, inv.currency)}</dd>
          </div>
          <div className="flex justify-between gap-3 font-semibold">
            <dt>Paid</dt>
            <dd>{money(inv.total, inv.currency)}</dd>
          </div>
          <p className="mt-0.5 text-[11.5px] text-subtle">
            {inv.number}
            {inv.paidVia ? ` · ${VIA[inv.paidVia] ?? inv.paidVia}` : ""}
            {inv.paidAt ? ` · ${day(inv.paidAt)}` : ""}
          </p>
        </dl>

        <p className="pay-ok-rise relative mt-3 text-[12px] text-muted text-balance" style={{ "--d": "720ms" } as CSSProperties}>
          <Mail className="mr-1 inline size-3.5 -translate-y-px align-middle" aria-hidden />
          Receipt with the GST invoice sent to <span className="break-all text-fg">{user.email}</span>
        </p>

        <div className="pay-ok-rise relative mt-5 grid gap-2" style={{ "--d": "800ms" } as CSSProperties}>
          <Button variant="primary" className="w-full" icon={<Check className="size-4" />} onClick={onClose} autoFocus>
            Done
          </Button>
          {!onBilling && (
            <Link href="/settings/billing" onClick={onClose} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-muted hover:text-fg">
              Billing and invoices <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
