"use client";

// The warning sign in the top bar: everything that needs the workspace's
// attention in one place — an allowance running low or used up, the trial
// ending, a payment due or overdue, a plan ending or read-only, an email to
// verify — each with the quickest fixes, cheapest first. It's only there when
// there's something to say; on phones it opens as a sheet.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarClock, CreditCard, Gauge, Lock, MailCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { takesAddons } from "@/components/billing/addons";
import { usePayInvoice } from "@/components/billing/pay";
import { fmtQuota, useTopup } from "@/components/billing/topup";
import { canManageBilling, day, daysUntil, plural, shortDay, subKey, subPath, type Invoice, type Overview } from "@/components/billing/types";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, cx } from "@/components/ui/primitives";
import { isTopupKey, money, QUOTA_LABEL, type QuotaKey, type TopupKey } from "@/lib/billing/catalog";
import { api, errorMessage } from "@/lib/client/api";

const DAY = 86_400_000;
type Tone = "danger" | "warning" | "info";
type Fix = { label: string; note?: string; best?: boolean } & ({ href: string } | { run: () => void; busy?: boolean });
type Alert = { id: string; tone: Tone; icon: ReactNode; title: string; detail: string; fixes: Fix[]; meter?: { used: number; limit: number; ahead: number } };

/** Each allowance with how much is used and, for monthly ones, where this month's pace takes it. */
export function forecast(o: Pick<Overview, "quotas">, now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const elapsed = Math.max(DAY / 4, now.getTime() - start);
  return (Object.entries(o.quotas ?? {}) as [QuotaKey, NonNullable<Overview["quotas"][QuotaKey]>][]).map(([k, q]) => {
    const share = q.limit > 0 ? q.used / q.limit : 1;
    const rate = q.used / elapsed;
    const projected = q.monthly ? q.used + rate * (end - now.getTime()) : q.used;
    const runsOut = q.monthly && rate > 0 && q.used < q.limit ? start + q.limit / rate : null;
    return { key: k, ...q, share, projected, runsOut: runsOut && runsOut < end ? new Date(runsOut) : null, resets: new Date(end) };
  });
}

/** The cheapest plan on sale with more of an allowance than now (unlimited counts). */
function biggerPlan(o: Overview, k: QuotaKey, atLeast: number) {
  const cur = o.subscription?.monthly ?? 0;
  return [...o.plans].filter((p) => p.active && p.monthly > cur && (p.quotas?.[k] === undefined || p.quotas[k]! > atLeast)).sort((a, b) => a.monthly - b.monthly)[0] ?? null;
}

/** Everything to warn about, most urgent first. */
function alertsFor(o: Overview | undefined, plan: { state: string; until: string | null } | null | undefined, user: { emailVerified: boolean; email: string }, manage: boolean, act: { topup: (k: TopupKey) => void; pay: (i: Invoice) => void; resume: () => void; resend: () => void; busy: { topup: boolean; pay: string | null; resume: boolean; resend: boolean } }): Alert[] {
  const out: Alert[] = [];
  const ask = "Ask an owner or someone with the Billing role.";
  const state = o?.state ?? plan?.state;
  const s = o?.subscription;
  const cur = o?.pricing.currency ?? "INR";
  const open = (o?.invoices ?? []).filter((i) => i.status === "open" && i.total > 0).sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());
  const keep = o?.recap?.plan;
  const build = o?.recap?.custom;
  const cheapest = o ? [...o.plans].filter((p) => p.active).sort((a, b) => a.monthly - b.monthly)[0] : null;
  const planFixes = (): Fix[] =>
    !manage
      ? []
      : [
          ...(build && (!keep || build.monthly < keep.monthly) ? [{ label: `Build your own · ${money(build.monthly, build.currency)}/mo`, note: "Only the features you use", best: true, href: "/settings/billing#plans" }] : []),
          ...(keep ? [{ label: `Keep everything with ${keep.name} · ${money(keep.monthly, keep.currency)}/mo`, best: !build || keep.monthly <= build.monthly, href: `/settings/billing?plan=${keep.planId}#plans` }] : []),
          ...(!keep && !build && cheapest ? [{ label: `Plans from ${money(cheapest.monthly, cheapest.currency)}/mo`, best: true, href: "/settings/billing#plans" }] : []),
          { label: "Compare plans", href: "/settings/billing#plans" },
        ];

  if (state === "expired")
    out.push({ id: "expired", tone: "danger", icon: <Lock />, title: "This workspace is read-only", detail: `The plan has ended. Nothing is deleted — choose a plan and everything switches back on.${manage ? "" : ` ${ask}`}`, fixes: planFixes() });
  if (state === "grace") {
    const inv = open[0];
    out.push({ id: "grace", tone: "danger", icon: <CreditCard />, title: "Your renewal hasn't been paid", detail: `Everything keeps working until ${day(s?.graceEndsAt ?? plan?.until)}${o?.free ? ", then the workspace moves to the Free plan" : ", then it becomes read-only"}.${manage ? "" : ` ${ask}`}`, fixes: manage && inv ? [{ label: `Pay ${money(inv.total, inv.currency)} now`, best: true, run: () => act.pay(inv), busy: act.busy.pay === inv.id }, { label: "See the invoice", href: "/settings/billing" }] : [] });
  } else if (manage && open[0] && open[0].dueAt && new Date(open[0].dueAt).getTime() < Date.now() + 3 * DAY && state !== "trial") {
    const inv = open[0];
    const late = new Date(inv.dueAt!).getTime() < Date.now();
    out.push({ id: `inv-${inv.id}`, tone: late ? "danger" : "warning", icon: <CreditCard />, title: late ? `${inv.number} is overdue` : `${inv.number} is due ${shortDay(inv.dueAt)}`, detail: inv.description, fixes: [{ label: `Pay ${money(inv.total, inv.currency)}`, best: true, run: () => act.pay(inv), busy: act.busy.pay === inv.id }] });
  }
  if (state === "trial") {
    const left = o?.stats.trialDaysLeft ?? (plan?.until ? daysUntil(plan.until) : null);
    const chosen = s && s.planId !== "trial";
    const first = open.find((i) => i.kind === "first");
    if (left !== null && left <= 7) {
      if (!chosen)
        out.push({ id: "trial", tone: left <= 2 ? "danger" : "warning", icon: <CalendarClock />, title: left === 0 ? "Your free trial ends today" : `Your free trial ends in ${plural(left, "day")}`, detail: `${o?.free ? "After that you're on the Free plan; work in other features is kept but locked." : "After that the workspace becomes read-only."}${manage ? " Pick a plan now — nothing is charged before the trial ends." : ` ${ask}`}`, fixes: planFixes() });
      else if (first && manage)
        out.push({ id: "trial-pay", tone: "warning", icon: <CalendarClock />, title: `${s!.planName} starts ${shortDay(s!.trialEndsAt)}`, detail: "Pay the first invoice any time before then to carry on without a break.", fixes: [{ label: `Pay ${money(first.total, first.currency)}`, best: true, run: () => act.pay(first), busy: act.busy.pay === first.id }] });
    }
  }
  if (state === "canceling" && s)
    out.push({ id: "canceling", tone: "warning", icon: <CalendarClock />, title: `${s.planName} ends ${shortDay(s.currentPeriodEnd)}`, detail: `It won't renew; after that the workspace ${o?.free ? "moves to the Free plan" : "becomes read-only"}.`, fixes: manage ? [{ label: `Keep ${s.planName}`, best: true, run: act.resume, busy: act.busy.resume }] : [] });

  // Allowances: used up, or heading there at this month's pace.
  if (o && state !== "expired")
    for (const r of forecast(o).filter((x) => x.share >= 0.75 || x.runsOut).sort((a, b) => b.share - a.share)) {
      const name = QUOTA_LABEL[r.key].name;
      const tk: TopupKey | null = r.key === "aiBudgetUsd" ? "aiPerMonth" : isTopupKey(r.key) ? r.key : null;
      const pack = tk ? o.topups?.packs.find((p) => p.key === tk) : null;
      const monthlyPack = takesAddons(o) && r.key !== "aiBudgetUsd" ? o.pricing.packs?.[r.key as keyof typeof o.pricing.packs] : null;
      const up = biggerPlan(o, r.key, r.limit);
      const fixes: Fix[] = [];
      // Cheapest first: a one-off top-up, then the same every month, then a bigger plan.
      if (manage && pack) fixes.push({ label: `Add ${fmtQuota(pack.key, pack.size)} ${QUOTA_LABEL[pack.key].name.toLowerCase()} · ${money(pack.price, cur)} once`, note: "Straight away · never expires", run: () => act.topup(pack.key), busy: act.busy.topup });
      if (manage && monthlyPack) fixes.push({ label: `+${fmtQuota(r.key, monthlyPack.size)} ${name.toLowerCase()} every month · ${money(monthlyPack.price, cur)}/mo`, note: "Added to your plan", href: `/settings/billing?more=${r.key}` });
      if (manage && up) fixes.push({ label: `${up.name}${up.quotas?.[r.key] === undefined ? `: unlimited ${name.toLowerCase()}` : `: ${fmtQuota(r.key, up.quotas[r.key]!)} ${name.toLowerCase()}`} · ${money(up.monthly, up.currency)}/mo`, href: `/settings/billing?plan=${up.id}#plans` });
      if (fixes[0]) fixes[0].best = true;
      out.push({
        id: `q-${r.key}`,
        tone: r.share >= 1 ? "danger" : "warning",
        icon: <Gauge />,
        title: r.share >= 1 ? `${name} used up` : `${name} at ${Math.round(r.share * 100)}%`,
        detail: `${fmtQuota(r.key, r.used)} of ${fmtQuota(r.key, r.limit)}${r.monthly ? " this month" : ""}${r.share >= 1 ? "" : r.runsOut ? ` · runs out around ${shortDay(r.runsOut)} at this pace` : ""}${r.monthly ? ` · resets ${shortDay(r.resets)}` : ""}.${manage ? "" : ` ${ask}`}`,
        meter: { used: r.used, limit: r.limit, ahead: r.projected },
        fixes,
      });
    }

  if (!user.emailVerified) out.push({ id: "verify", tone: "info", icon: <MailCheck />, title: "Verify your email address", detail: `We sent a link to ${user.email}. Verifying keeps your account recoverable.`, fixes: [{ label: "Send the link again", run: act.resend, busy: act.busy.resend }] });
  if (state === "free" && manage) out.push({ id: "free", tone: "info", icon: <Sparkles />, title: "You're on the Free plan", detail: "Add the features you use, more seats and your own domain whenever you're ready.", fixes: planFixes() });
  const rank = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

const TONE: Record<Tone, string> = { danger: "bg-danger-soft text-danger", warning: "bg-warning-soft text-warning", info: "bg-accent-soft text-accent" };

export function AlertsButton() {
  const { org, user } = useSession();
  const manage = canManageBilling(org.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: subKey(org.id), queryFn: () => api<Overview>(subPath(org.id)), enabled: manage && !!org.plan && org.plan.state !== "unrestricted", staleTime: 60_000, refetchInterval: 300_000, retry: false });
  const o = q.data && q.data.enforced ? q.data : undefined;
  const t = useTopup(org.id, o);
  const pay = usePayInvoice(org.id, o);
  const resume = useMutation({ mutationFn: () => api<Overview>(subPath(org.id, "/resume"), { method: "POST", body: {} }), onSuccess: (x) => { qc.setQueryData(subKey(org.id), x); toast({ tone: "success", title: "Your plan carries on" }); }, onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });
  const resend = useMutation({ mutationFn: () => api("/api/v1/auth/resend-verification", { method: "POST" }), onSuccess: () => toast({ tone: "success", title: "Verification email sent" }), onError: (e) => toast({ tone: "error", title: "Couldn't send it", description: errorMessage(e) }) });

  const list = alertsFor(o, org.plan, user, manage, { topup: (k) => t.buy({ [k]: 1 }), pay: pay.pay, resume: () => resume.mutate(), resend: () => resend.mutate(), busy: { topup: t.busy, pay: pay.busy, resume: resume.isPending, resend: resend.isPending } });
  // Payment windows open over the page, so they live outside the pop-up (which closes first).
  const payUi = (
    <>
      {t.ui}
      {pay.ui}
    </>
  );
  if (!list.length) return payUi;
  const urgent = list.filter((a) => a.tone !== "info").length;
  const worst = list[0]!.tone;
  return (
    <>
      <button type="button" aria-label={urgent ? `${plural(urgent, "warning")}` : "Things to look at"} aria-expanded={open} title="Warnings" onClick={() => setOpen(true)} className={cx("bar-icon", worst === "danger" ? "text-danger" : worst === "warning" ? "text-warning" : "")}>
        <AlertTriangle aria-hidden />
        {urgent > 0 && <span className={cx("bar-badge", worst === "warning" && "!bg-warning")}>{urgent}</span>}
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} size="md" title={urgent ? `${plural(urgent, "thing")} need${urgent === 1 ? "s" : ""} attention` : "Worth a look"} description="The quickest fixes, cheapest first. Prices are before GST.">
          <ul className="grid gap-3">
            {list.map((a) => (
              <li key={a.id} className="rounded-[16px] border border-border bg-surface p-3.5">
                <div className="flex items-start gap-3">
                  <span className={cx("grid size-8 shrink-0 place-items-center rounded-[10px] [&>svg]:size-4", TONE[a.tone])}>{a.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold">{a.title}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">{a.detail}</p>
                  </div>
                </div>
                {a.meter && (
                  <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    {a.meter.ahead > a.meter.used && <div className="absolute inset-y-0 left-0 rounded-full bg-warning/25" style={{ width: `${Math.min(100, (a.meter.ahead / Math.max(1, a.meter.limit)) * 100)}%` }} />}
                    <div className={cx("absolute inset-y-0 left-0 rounded-full", a.tone === "danger" ? "bg-danger" : "bg-warning")} style={{ width: `${Math.max(3, Math.min(100, (a.meter.used / Math.max(1, a.meter.limit)) * 100))}%` }} />
                  </div>
                )}
                {a.fixes.length > 0 && (
                  <div className="mt-3 grid gap-1.5">
                    {a.fixes.map((f) =>
                      "href" in f ? (
                        <Link key={f.label} href={f.href} onClick={() => setOpen(false)} className={cx("flex min-h-11 items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-[13px] transition-colors", f.best ? "bg-fg text-bg hover:opacity-90" : "bg-surface-2 hover:bg-surface-3")}>
                          <FixText f={f} />
                          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                        </Link>
                      ) : (
                        <Button
                          key={f.label}
                          variant={f.best ? "primary" : "secondary"}
                          loading={f.busy}
                          onClick={() => {
                            setOpen(false);
                            f.run();
                          }} className="!h-auto min-h-11 w-full !justify-between !rounded-[12px] px-3 py-2 text-left">
                          <FixText f={f} />
                        </Button>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {payUi}
    </>
  );
}

function FixText({ f }: { f: Fix }) {
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-x-2 font-medium">
        {f.label}
        {f.best && <Badge tone="success" className="!text-[10.5px]">Best value</Badge>}
      </span>
      {f.note && <span className="block text-[11.5px] opacity-70">{f.note}</span>}
    </span>
  );
}
