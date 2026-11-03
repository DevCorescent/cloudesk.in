"use client";

// Helping a workspace choose the plan it needs: allowance meters, what Free
// would lock away (from what it actually built), and one upgrade prompt that
// appears wherever a limit or a locked feature is hit.
import { ArrowRight, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/shell/session-context";
import { Dialog } from "@/components/ui/overlays";
import { Button, Card, cx } from "@/components/ui/primitives";
import { money } from "@/lib/billing/catalog";
import { api } from "@/lib/client/api";
import { moduleById, type ModuleId } from "@/lib/workspace/modules";
import { canManageBilling, subKey, subPath, type Overview } from "./types";

/** An allowance as people read it: dollars for AI spend, MB or GB for storage, whole numbers otherwise. */
const amount = (k: string, n: number) => (k === "aiBudgetUsd" ? `$${n.toFixed(2)}` : k === "storageMb" ? (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`) : Math.round(n).toLocaleString("en-IN"));

/** Bars for each allowance: amber from 80%, red when it's used up. */
export function QuotaMeters({ o, compact, stacked }: { o: Pick<Overview, "quotas" | "state">; compact?: boolean; stacked?: boolean }) {
  const rows = Object.entries(o.quotas ?? {});
  if (!rows.length) return null;
  return (
    <div className={cx("grid", compact ? "gap-2.5" : "gap-3", !stacked && "sm:grid-cols-2 lg:grid-cols-4")}>
      {rows.map(([k, q]) => {
        const share = q!.limit ? Math.min(1, q!.used / q!.limit) : 1;
        const tone = share >= 1 ? "bg-danger" : share >= 0.8 ? "bg-warning" : "bg-accent";
        return (
          <div key={k} className={cx(!compact && "rounded-[16px] bg-surface p-4 ring-1 ring-border")}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate font-medium">{q!.label}</span>
              <span className={cx("shrink-0 tabular-nums", share >= 1 ? "font-semibold text-danger" : share >= 0.8 ? "text-warning" : "text-muted")}>{amount(k, q!.used)} / {amount(k, q!.limit)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cx("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${Math.max(2, share * 100)}%` }} /></div>
            {!compact && <p className="mt-1.5 text-[12px] text-muted">{share >= 1 ? "Used up — upgrade to keep going" : q!.monthly ? "Resets on the 1st" : "In total"}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** "Keep what you've built": the work in features the Free plan doesn't include, and the plan that keeps all of it. */
export function KeepRecap({ o, onChoose }: { o: Pick<Overview, "recap" | "state" | "stats" | "free">; onChoose?: (planId: string | null) => void }) {
  const r = o.recap;
  if (!r || !r.lost.length || !o.free) return null;
  const trial = o.state === "trial";
  return (
    <Card className="overflow-hidden p-0">
      <div className="bg-[radial-gradient(80%_120%_at_0%_0%,rgb(124_92_255/0.10),transparent_60%)] p-5">
        <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.1em] text-accent uppercase"><Sparkles className="size-3.5" /> {trial ? "Keep what you've built" : "Waiting for you"}</p>
        <h3 className="mt-1 text-[18px] font-semibold tracking-tight">{trial ? `When your trial ends${o.stats.trialDaysLeft !== null ? ` in ${o.stats.trialDaysLeft} day${o.stats.trialDaysLeft === 1 ? "" : "s"}` : ""}, the Free plan won't include:` : "Your work in these features is kept, locked until you upgrade:"}</h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {r.lost.map((l) => (
            <li key={l.module} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] ring-1 ring-border"><Lock className="size-3.5 text-muted" /> {l.name} <span className="text-muted">· {l.records.toLocaleString("en-IN")} {l.records === 1 ? "record" : "records"}</span></li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {r.plan && <Button variant="primary" onClick={() => onChoose?.(r.plan!.planId)}>Keep it all with {r.plan.name} · {money(r.plan.monthly, r.plan.currency)}/mo</Button>}
          {r.custom && (!r.plan || r.custom.monthly < r.plan.monthly) && <Button onClick={() => onChoose?.(null)}>Or build your own · from {money(r.custom.monthly, r.custom.currency)}/mo</Button>}
        </div>
        <p className="mt-2 text-[12px] text-muted">Nothing is deleted on Free — upgrade any time and it&apos;s all back as you left it.</p>
      </div>
    </Card>
  );
}

type Paywall = { message: string; quota: string | null; module: string | null; upgrade: string | null };

/** One upgrade prompt for the whole app, raised by any API answer about the plan (see src/lib/client/api.ts). */
export function PaywallDialog() {
  const { org } = useSession();
  const [p, setP] = useState<Paywall | null>(null);
  const manage = canManageBilling(org.role);
  useEffect(() => {
    let last = 0;
    const on = (e: Event) => {
      // One prompt at a time, and not twice in a row for the same action.
      if (Date.now() - last < 4000) return;
      last = Date.now();
      setP((e as CustomEvent<Paywall>).detail);
    };
    window.addEventListener("cc:paywall", on);
    return () => window.removeEventListener("cc:paywall", on);
  }, []);
  const plans = useQuery({ queryKey: ["public-plans"], queryFn: () => api<{ plans: Overview["plans"] }>("/api/v1/plans"), enabled: !!p, staleTime: 300_000 });
  const o = useQuery({ queryKey: subKey(org.id), queryFn: () => api<Overview>(subPath(org.id)), enabled: !!p && manage, staleTime: 30_000, retry: false });
  if (!p) return null;
  const rec = plans.data?.plans.find((x) => x.id === p.upgrade) ?? null;
  const mod = p.module ? moduleById(p.module as ModuleId) : null;
  const title = p.quota ? "You've reached your plan's limit" : mod ? `${mod.name} isn't in your plan` : "Upgrade to continue";
  const href = rec ? `/settings/billing?plan=${rec.id}#plans` : mod ? `/settings/billing?add=${mod.id}` : "/settings/billing#plans";
  return (
    <Dialog
      open
      onClose={() => setP(null)}
      size="sm"
      title={title}
      description={p.message}
      footer={
        <>
          <Button onClick={() => setP(null)}>Not now</Button>
          {manage ? (
            <Link href={href} onClick={() => setP(null)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13.5px] font-medium text-bg hover:opacity-90">
              {rec ? `See ${rec.name}` : mod ? `Add ${mod.name}` : "See plans"} <ArrowRight className="size-4" />
            </Link>
          ) : null}
        </>
      }
    >
      <div className="grid gap-3">
        {rec && (
          <div className="rounded-[14px] bg-surface-2 p-3 text-[13px]">
            <p className="font-medium">{rec.name} · {money(rec.monthly, rec.currency)}/month</p>
            <p className="text-muted">{rec.tagline}</p>
          </div>
        )}
        {manage && o.data?.quotas && Object.keys(o.data.quotas).length > 0 && <QuotaMeters o={o.data} compact stacked />}
        {!manage && <p className="text-[13px] text-muted">Ask an owner of this workspace to upgrade in Settings → Billing.</p>}
      </div>
    </Dialog>
  );
}
