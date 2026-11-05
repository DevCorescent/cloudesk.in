"use client";

// Top-ups: more of a monthly allowance (AI requests, invoices, campaign
// emails, e-sign requests), bought once and paid at once — on any plan, Free
// included. They're used only after the plan's own allowance runs out, and
// what's left carries over, so nothing bought is wasted. The total shown is
// the server's arithmetic (topupQuote, then tax on it).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Zap } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx } from "@/components/ui/primitives";
import { money, PACK_LABEL, QUOTA_LABEL, taxOf, type QuotaKey, type TopupKey } from "@/lib/billing/catalog";
import { api, errorMessage } from "@/lib/client/api";
import { amountText } from "./addons";
import { usePayInvoice } from "./pay";
import { subKey, subPath, type Overview } from "./types";

/** An allowance as people read it: dollars for AI spend, GB for storage, whole numbers otherwise. */
export const fmtQuota = (k: QuotaKey, n: number) => (k === "aiBudgetUsd" ? `$${n.toFixed(2)}` : amountText(k, n));

/** Buy top-ups, then pay straight away (Razorpay opens over the page). Render `ui` once. */
export function useTopup(orgId: string, o: Overview | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  const pay = usePayInvoice(orgId, o);
  const m = useMutation({
    mutationFn: (packs: Partial<Record<TopupKey, number>>) => api<{ applied: boolean; invoiceId: string; overview: Overview }>(subPath(orgId, "/topup"), { method: "POST", body: { packs } }),
    onSuccess: (r) => {
      qc.setQueryData(subKey(orgId), r.overview);
      if (r.applied) return toast({ tone: "success", title: "Top-up added", description: "Paid from your account credit — it's ready to use." });
      const inv = r.overview.invoices.find((i) => i.id === r.invoiceId);
      if (inv) pay.pay(inv);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't start the top-up", description: errorMessage(e) }),
  });
  return { buy: (packs: Partial<Record<TopupKey, number>>) => m.mutate(packs), busy: m.isPending || !!pay.busy, ui: pay.ui };
}

const priceOf = (o: Overview, packs: Partial<Record<TopupKey, number>>) => {
  const subtotal = (o.topups?.packs ?? []).reduce((s, p) => s + (packs[p.key] ?? 0) * p.price, 0);
  const tax = taxOf(subtotal, o.pricing.taxBps);
  return { subtotal, tax, total: subtotal + tax };
};

function Stepper({ n, set, label, disabled }: { n: number; set: (n: number) => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button size="sm" aria-label={`Fewer ${label}`} disabled={disabled || n <= 0} onClick={() => set(n - 1)} icon={<Minus className="size-3.5" />} />
      <span className="w-6 text-center text-[14px] font-semibold tabular-nums" aria-live="polite">
        {n}
      </span>
      <Button size="sm" aria-label={`More ${label}`} disabled={disabled || n >= 100} onClick={() => set(n + 1)} icon={<Plus className="size-3.5" />} />
    </div>
  );
}

/** Settings → Billing: every allowance that can be topped up, with a basket and one payment. */
export function TopupCard({ o, orgId, focus }: { o: Overview; orgId: string; focus?: TopupKey | null }) {
  const packs = o.topups?.packs ?? [];
  const [want, setWant] = useState<Partial<Record<TopupKey, number>>>(() => (focus && packs.some((p) => p.key === focus) ? { [focus]: 1 } : {}));
  const t = useTopup(orgId, o);
  if (!packs.length) return null;
  const cur = o.pricing.currency;
  const price = priceOf(o, want);
  const month = o.topups!.month;
  return (
    <section id="topups" aria-labelledby="topups-h" className="grid gap-3">
      <div>
        <h2 id="topups-h" className="flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-[-0.015em]">
          Top up <Badge tone="accent">Pay once · never expires</Badge>
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">Ran out, or about to? Add more now and keep going. A top-up is only used after this month&apos;s allowance runs out, and whatever&apos;s left carries over to next month.</p>
      </div>
      <Card className="overflow-clip">
        <ul className="grid gap-2 p-4 sm:p-5 lg:grid-cols-2">
          {packs.map((p) => {
            const q = o.quotas[p.key];
            const n = want[p.key] ?? 0;
            const share = q ? Math.min(1, q.used / Math.max(1, q.limit)) : 0;
            return (
              <li key={p.key} id={`topup-${p.key}`} className={cx("grid gap-2 rounded-[14px] border px-3 py-3", n > 0 ? "border-fg/20 bg-surface-2" : "border-border", focus === p.key && "ring-2 ring-accent")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">{QUOTA_LABEL[p.key].name}</p>
                    <p className="text-[12px] text-muted tabular-nums">
                      {q ? `${fmtQuota(p.key, q.used)} of ${fmtQuota(p.key, q.limit)} used this month` : "This month"}
                      {p.left > 0 && <> · {fmtQuota(p.key, p.left)} top-up left</>}
                    </p>
                  </div>
                  <Stepper n={n} label={QUOTA_LABEL[p.key].name} disabled={t.busy} set={(x) => setWant((w) => ({ ...w, [p.key]: Math.max(0, Math.min(100, x)) }))} />
                </div>
                {q && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className={cx("h-full rounded-full transition-[width] duration-500", share >= 1 ? "bg-danger" : share >= 0.8 ? "bg-warning" : "bg-fg")} style={{ width: `${Math.max(q.used ? 3 : 0, share * 100)}%` }} />
                  </div>
                )}
                <p className="flex flex-wrap justify-between gap-x-3 text-[11.5px] text-subtle tabular-nums">
                  <span>
                    +{PACK_LABEL[p.key].amount(p.size).replace(/ a month$/, "")} for {money(p.price, cur)}
                  </span>
                  {n > 0 && (
                    <span className="font-medium text-fg">
                      {n} × {money(p.price, cur)} = {money(n * p.price, cur)}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="sticky bottom-[var(--dock)] z-10 grid gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <div className="min-w-0 text-[12.5px] text-muted tabular-nums">
            {price.subtotal > 0 ? (
              <>
                <span className="text-fg">{money(price.subtotal, cur)}</span> + {o.pricing.taxLabel} {money(price.tax, cur)} ={" "}
                <b className="text-[16px] font-semibold text-fg">{money(price.total, cur)}</b> <span>once</span>
              </>
            ) : (
              <>Choose how many packs you need.{month.count > 0 && ` This month: ${money(month.total, cur)} on top-ups.`}</>
            )}
          </div>
          <Button variant="primary" className="max-sm:w-full" icon={<Zap className="size-3.5" />} disabled={price.subtotal <= 0} loading={t.busy} onClick={() => t.buy(want)}>
            {price.subtotal > 0 ? `Pay ${money(price.total, cur)}` : "Top up"}
          </Button>
        </div>
      </Card>
      {t.ui}
    </section>
  );
}

/** One allowance, one tap: for the upgrade prompt and the home page. */
/** `buy` comes from a useTopup the caller keeps mounted, since its payment window opens after this closes. */
export function TopupOffer({ o, k, buy, busy }: { o: Overview; k: TopupKey; buy: (packs: Partial<Record<TopupKey, number>>) => void; busy: boolean }) {
  const p = o.topups?.packs.find((x) => x.key === k);
  const [n, setN] = useState(1);
  if (!p) return null;
  const cur = o.pricing.currency;
  const price = priceOf(o, { [k]: n });
  return (
    <div className="grid gap-3 rounded-[14px] border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">+{PACK_LABEL[k].amount(n * p.size).replace(/ a month$/, "")}</p>
          <p className="text-[12px] text-muted tabular-nums">
            {money(price.subtotal, cur)} + {o.pricing.taxLabel} {money(price.tax, cur)} · added straight away, never expires
          </p>
        </div>
        <Stepper n={n} label="packs" disabled={busy} set={(x) => setN(Math.max(1, Math.min(100, x)))} />
      </div>
      <Button
        variant="primary"
        className="w-full"
        icon={<Zap className="size-3.5" />}
        loading={busy}
        onClick={() => buy({ [k]: n })}
      >
        Pay {money(price.total, cur)} and continue
      </Button>
    </div>
  );
}
