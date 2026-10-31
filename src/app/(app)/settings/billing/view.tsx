"use client";

// Settings → Billing: the workspace's subscription. Where it stands (trial,
// plan, dates, what's due), what it uses, changing plan or building one from
// features, paying and printing invoices, and the history of every change.
// Owners and the billing role manage it; everyone else sees the plan's name.
import { CouponCard } from "@/components/billing/coupon";
import { KeepRecap, QuotaMeters } from "@/components/billing/upsell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChangePlan } from "@/components/billing/change-plan";
import { InvoiceSheet } from "@/components/billing/invoice-sheet";
import { usePayInvoice, useStripeReturn } from "@/components/billing/pay";
import { Hero, Invoices, Stats, Timeline } from "@/components/billing/sections";
import { canManageBilling, day, stateBadge, subKey, subPath, type Invoice, type Overview } from "@/components/billing/types";
import { useSession } from "@/components/shell/session-context";
import { useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, ErrorState, Notice, Skeleton } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { MODULE_IDS, moduleById, type ModuleId } from "@/lib/workspace/modules";

type Legacy = { subscription: { provider: "stripe" | "razorpay"; status: string; plan: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null };

export function BillingView() {
  const { org } = useSession();
  const canManage = canManageBilling(org.role);
  if (!canManage) return <ReadOnly />;
  return <Manage />;
}

function ReadOnly() {
  const { org } = useSession();
  const p = org.plan;
  const badge = p ? stateBadge({ state: p.state as Overview["state"], subscription: null }) : null;
  return (
    <div className="grid gap-4">
      <Card className="p-5 sm:p-6">
        <p className="text-[12px] font-medium text-muted">This workspace&apos;s plan</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{p ? (p.state === "trial" ? "Free trial" : p.name || "Plan") : "No plan needed"}</h2>
          {badge && p?.state !== "unrestricted" && <Badge tone={badge.tone}>{badge.label}</Badge>}
        </div>
        {p?.until && <p className="mt-1 text-[13px] text-muted">{p.state === "trial" ? `Trial ends ${day(p.until)}` : p.state === "grace" ? `Payment due by ${day(p.until)}` : `Runs until ${day(p.until)}`}</p>}
        <p className="mt-4 rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">Only the workspace owner and members with the Billing role can see invoices and change the plan. Ask an owner if you need a feature that isn&apos;t included.</p>
      </Card>
    </div>
  );
}

function Manage() {
  const { org } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const params = useSearchParams();
  const addParam = params.get("add");
  const add = addParam && (MODULE_IDS as string[]).includes(addParam) ? (addParam as ModuleId) : null;
  const q = useQuery({ queryKey: subKey(org.id), queryFn: () => api<Overview>(subPath(org.id)), retry: (n, e) => !(e instanceof ApiClientError && e.status === 403) && n < 2 });
  const legacy = useQuery({ queryKey: ["billing", org.id], queryFn: () => api<Legacy>(`/api/v1/orgs/${org.id}/billing`), staleTime: 300_000 });
  const pay = usePayInvoice(org.id, q.data);
  const ret = useStripeReturn(org.id, true);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [planKey, setPlanKey] = useState(0);
  const apply = (o: Overview) => qc.setQueryData(subKey(org.id), o);
  const cancel = useMutation({ mutationFn: (on: boolean) => api<Overview>(subPath(org.id, on ? "/cancel" : "/resume"), { method: "POST", body: {} }), onSuccess: (o, on) => { apply(o); toast({ tone: "success", title: on ? "Cancelled at the end of the period" : "Your plan carries on" }); }, onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });

  if (q.isError) {
    if (q.error instanceof ApiClientError && q.error.status === 403) return <ReadOnly />;
    return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  }
  if (!q.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-56 rounded-[var(--radius-xl)]" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-[18px]" />)}</div>
        <Skeleton className="h-80 rounded-[var(--radius-xl)]" />
      </div>
    );
  }
  const o = q.data;
  const sub = o.subscription;
  const toPlans = () => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const payNow = (inv: Invoice) => {
    setViewing(null);
    pay.pay(inv);
  };

  return (
    <div className="grid gap-6">
      {ret.cancelled && <Notice action={<Button size="sm" variant="ghost" onClick={ret.dismissCancelled}>Dismiss</Button>}>Payment cancelled — nothing was charged.</Notice>}
      {add && sub && o.entitled !== null && !o.entitled.includes(add) && (
        <Notice tone="accent" title={`Add ${moduleById(add)?.name ?? add} to your plan`}>
          It&apos;s preselected in “Build your own” below with everything you have now — check the total and review.
        </Notice>
      )}
      {!o.enforced || !sub ? (
        <Notice title="Plans aren't switched on here">Every feature is available and nothing is limited or charged on this platform.</Notice>
      ) : (
        <>
          <Hero o={o} onPay={payNow} paying={pay.busy} busy={cancel.isPending} onCancel={() => cancel.mutate(true)} onResume={() => cancel.mutate(false)} onChoose={toPlans} onView={setViewing} />
          {(o.state === "free" || o.state === "trial") && <QuotaMeters o={o} />}
          <KeepRecap o={o} onChoose={() => toPlans()} />
          <Stats o={o} />
          <CouponCard o={o} orgId={org.id} />
          <ChangePlan key={planKey} o={o} orgId={org.id} add={add} onDone={() => setPlanKey((k) => k + 1)} onPay={(id, ov) => { const inv = ov.invoices.find((i) => i.id === id); if (inv) pay.pay(inv); }} />
        </>
      )}
      <Invoices o={o} onPay={payNow} paying={pay.busy} onView={setViewing} />
      {o.events.length > 0 && <Timeline o={o} />}
      {legacy.data?.subscription && <LegacyBox orgId={org.id} s={legacy.data.subscription} />}
      {viewing && <InvoiceSheet invoice={o.invoices.find((i) => i.id === viewing.id) ?? viewing} workspace={org.name} onClose={() => setViewing(null)} onPay={() => payNow(viewing)} paying={pay.busy === viewing.id} />}
      {pay.ui}
    </div>
  );
}

/** A subscription started with the old Pro/Business plans, while it still runs. */
function LegacyBox({ orgId, s }: { orgId: string; s: NonNullable<Legacy["subscription"]> }) {
  const toast = useToast();
  const portal = useMutation({ mutationFn: () => api<{ url: string }>(`/api/v1/orgs/${orgId}/billing/portal`, { method: "POST", body: {} }), onSuccess: (r) => (window.location.href = r.url), onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
      <div className="min-w-0">
        <p className="font-medium">Legacy subscription</p>
        <p className="text-muted">
          {s.plan} via {s.provider === "stripe" ? "Stripe" : "Razorpay"} · {s.status}
          {s.currentPeriodEnd ? ` · ${s.cancelAtPeriodEnd ? "ends" : "renews"} ${day(s.currentPeriodEnd)}` : ""}. Started before plans moved here; contact support to move it over.
        </p>
      </div>
      {s.provider === "stripe" && (
        <Button size="sm" icon={<CreditCard className="size-3.5" />} loading={portal.isPending} onClick={() => portal.mutate()}>
          Manage on Stripe <ExternalLink className="size-3" />
        </Button>
      )}
    </Card>
  );
}
