// Plain, true statements about how the service handles money and data, with
// a link to the Security page. No badges for certifications we don't hold.
// Server-safe (no client code), so it can sit anywhere. The full version is a
// section with a heading; `compact` is just the grid, for inside other pages.
import clsx from "clsx";
import { ArrowRight, CreditCard, Download, Fingerprint, Lock, MapPin, ReceiptText, ShieldCheck } from "lucide-react";
import Link from "next/link";

const ITEMS = [
  { icon: CreditCard, title: "Payments by Razorpay & Stripe", text: "They take the payment — we never store card details." },
  { icon: Lock, title: "Encrypted connections", text: "Every page and every API call goes over HTTPS." },
  { icon: Fingerprint, title: "Two-step sign-in", text: "Add an authenticator code on top of your password." },
  { icon: ReceiptText, title: "GST on every invoice", text: "Tax is added and shown on everything we bill you." },
  { icon: Download, title: "Export any time", text: "Your data is yours — download it whenever you like." },
  { icon: ShieldCheck, title: "DPDP Act & GDPR", text: "Privacy practices aligned with Indian and EU law." },
  { icon: MapPin, title: "Built for Indian businesses", text: "Rupee pricing, GST and Indian states built in." },
] as const;

export function TrustStrip({ className, compact }: { className?: string; compact?: boolean }) {
  const grid = (
    <ul className={clsx("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", compact ? "gap-2.5" : "gap-3 sm:gap-4")}>
      {ITEMS.map(({ icon: Icon, title, text }) => (
        <li key={title} className={clsx("flex items-start gap-3 rounded-[18px] border border-fg/[0.06] bg-white/70", compact ? "p-3.5" : "p-4 sm:p-5")}>
          <span className={clsx("grid shrink-0 place-items-center rounded-[12px] bg-[var(--p-mint,#ccfbf1)]/60 text-[var(--p-mint-ink,#0f766e)]", compact ? "size-8" : "size-9")}>
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className={clsx("block font-semibold text-fg", compact ? "text-[13px]" : "text-[14px]")}>{title}</span>
            <span className={clsx("mt-0.5 block leading-snug text-fg/55", compact ? "text-[12px]" : "text-[13px]")}>{text}</span>
          </span>
        </li>
      ))}
      <li>
        <Link
          href="/security"
          className={clsx("group flex h-full items-center justify-between gap-3 rounded-[18px] bg-fg text-bg transition-opacity hover:opacity-90", compact ? "p-3.5" : "p-4 sm:p-5")}
        >
          <span>
            <span className={clsx("block font-semibold", compact ? "text-[13px]" : "text-[14px]")}>How we keep you safe</span>
            <span className={clsx("mt-0.5 block leading-snug text-bg/65", compact ? "text-[12px]" : "text-[13px]")}>Security, firewall and reporting a problem</span>
          </span>
          <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </li>
    </ul>
  );

  if (compact) return <div className={className} data-testid="trust-strip">{grid}</div>;
  return (
    <section className={className} data-testid="trust-strip" aria-labelledby="trust-heading">
      <div className="mb-6 flex flex-col gap-2 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-fg/40 uppercase">Trust & safety</p>
          <h2 id="trust-heading" data-no-fit className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight sm:text-[26px]">Your business, kept safe</h2>
        </div>
        <p className="max-w-md text-[13.5px] leading-relaxed text-fg/55">How we handle your payments, your data and your sign-ins — in plain words, nothing we can&apos;t back up.</p>
      </div>
      {grid}
    </section>
  );
}
