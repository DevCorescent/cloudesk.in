"use client";

// The partner dashboard. Before approval it shows where the application is
// (and lets them add payout details); once approved, everything they earn
// and the tools for their kind of partner — leads for sales partners and
// organisations, campaigns for marketing partners, coupons for influencers.
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, BookOpen, Clock3, Handshake, LayoutDashboard, Link2, ReceiptText, ShieldAlert, Target, UserRound, Users, Wallet, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/overlays";
import { ErrorState, Notice, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { discountText, months, pct, TYPE_INFO, type PartnerType } from "@/lib/partners/program";
import { Overview } from "./overview";
import { Customers, Earnings, Leads, LinksAndCoupons, Payouts, Playbook, Profile, PayoutDetailsForm } from "./sections";
import type { Dashboard, Mine, PartnerProfile, Terms } from "./types";
import { date, MINE_KEY } from "./types";

type TabId = "overview" | "customers" | "leads" | "links" | "earnings" | "payouts" | "profile" | "playbook";
const TAB_META: Record<TabId, { label: string; icon: ReactNode }> = {
  overview: { label: "Overview", icon: <LayoutDashboard className="size-4" /> },
  customers: { label: "Customers", icon: <Users className="size-4" /> },
  leads: { label: "Leads", icon: <Target className="size-4" /> },
  links: { label: "Links & codes", icon: <Link2 className="size-4" /> },
  earnings: { label: "Earnings", icon: <ReceiptText className="size-4" /> },
  payouts: { label: "Payouts", icon: <Wallet className="size-4" /> },
  profile: { label: "Profile", icon: <UserRound className="size-4" /> },
  playbook: { label: "Playbook", icon: <BookOpen className="size-4" /> },
};
/** Each kind of partner sees the tools for their work first. */
const TABS_FOR: Record<PartnerType, TabId[]> = {
  organisation: ["overview", "customers", "leads", "links", "earnings", "payouts", "playbook", "profile"],
  freelancer: ["overview", "customers", "links", "earnings", "payouts", "playbook", "profile"],
  sales: ["overview", "leads", "customers", "links", "earnings", "payouts", "playbook", "profile"],
  marketing: ["overview", "links", "customers", "earnings", "payouts", "playbook", "profile"],
  influencer: ["overview", "links", "customers", "earnings", "payouts", "playbook", "profile"],
};
const LINKS_LABEL: Partial<Record<PartnerType, string>> = { marketing: "Campaigns & codes", influencer: "Coupons & links" };

export function PartnerDashboard({ person }: { person: string }) {
  const q = useQuery({ queryKey: MINE_KEY, queryFn: () => api<Mine>("/api/v1/partner") });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="grid gap-4"><Skeleton className="h-40" /><Skeleton className="h-72" /></div>;
  const d = q.data;
  if (!d.partner) return <NotApplied />;
  if (!("totals" in d) || !d.totals) return <Review partner={d.partner} terms={(d as { terms: Terms }).terms} />;
  return <Approved d={d as Dashboard} person={person} />;
}

function NotApplied() {
  return (
    <div className="mx-auto grid max-w-xl gap-4 rounded-[24px] bg-surface p-8 text-center ring-1 ring-border">
      <span className="mx-auto grid size-12 place-items-center rounded-[16px] bg-accent-soft text-accent"><Handshake className="size-5" /></span>
      <h1 className="text-[22px] font-semibold tracking-tight">Become a Cloudesk partner</h1>
      <p className="text-[14px] text-muted">Earn a share of what every customer you bring pays — for months, not once. Agencies, freelancers, sales and marketing partners and creators are all welcome.</p>
      <Link href="/partners#apply" className="mx-auto inline-flex h-10 items-center rounded-full bg-fg px-5 text-[14px] font-medium text-bg">Apply now</Link>
    </div>
  );
}

function Review({ partner: p, terms }: { partner: PartnerProfile; terms: Terms }) {
  const info = TYPE_INFO[p.type];
  const state = {
    pending: { icon: <Clock3 className="size-5" />, tone: "bg-accent-soft text-accent", title: "Your application is being reviewed", body: "We usually reply within 2 working days, by email. You can add your payout details now so you're ready to withdraw." },
    rejected: { icon: <XCircle className="size-5" />, tone: "bg-danger-soft text-danger", title: "We couldn't approve your application", body: p.reviewNote || "You can update your details and apply again." },
    suspended: { icon: <ShieldAlert className="size-5" />, tone: "bg-warning-soft text-warning", title: "Your partner account is paused", body: `${p.reviewNote || "Your codes don't work for new customers right now."} Reply to our email if you have questions.` },
    approved: { icon: <BadgeCheck className="size-5" />, tone: "bg-success-soft text-success", title: "Approved", body: "" },
  }[p.status];
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-4 rounded-[24px] bg-surface p-6 ring-1 ring-border">
        <span className={`grid size-12 shrink-0 place-items-center rounded-[16px] ${state.tone}`}>{state.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-muted uppercase">{info.name} · applied {date(p.createdAt)}</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">{state.title}</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-muted">{state.body}</p>
          {p.status === "rejected" && <Link href="/partners#apply" className="mt-4 inline-flex h-9 items-center rounded-full bg-fg px-4 text-[13px] font-medium text-bg">Update and apply again</Link>}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[20px] bg-surface p-5 ring-1 ring-border">
          <h2 className="text-[15px] font-semibold">What you&apos;ll earn once approved</h2>
          <ul className="mt-3 grid gap-2 text-[13.5px]">
            <li><b>{pct(terms.commissionBps)}</b> of what each customer pays, {months(terms.commissionMonths)}</li>
            {terms.discountBps > 0 && <li>Your customers get <b>{discountText(terms.discountBps, terms.discountPayments)}</b> with your code</li>}
            <li>Withdraw {terms.holdDays} days after a customer pays · from ₹{(terms.minPayout / 100).toLocaleString("en-IN")}</li>
          </ul>
          <p className="mt-4 text-[12.5px] text-subtle">Your code: <span className="font-mono font-medium text-fg">{p.code}</span> — it starts working when you&apos;re approved.</p>
        </section>
        <section className="rounded-[20px] bg-surface p-5 ring-1 ring-border">
          <h2 className="text-[15px] font-semibold">Payout details</h2>
          <p className="mt-1 text-[13px] text-muted">Where we send your earnings. Stored encrypted; only the last digits are shown again.</p>
          <div className="mt-4"><PayoutDetailsForm partner={p} /></div>
        </section>
      </div>
    </div>
  );
}

function Approved({ d, person }: { d: Dashboard; person: string }) {
  const p = d.partner;
  const tabs = TABS_FOR[p.type];
  const [tab, setTab] = useState<TabId>("overview");
  // The section is kept in the address (#payouts) so it survives a reload.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as TabId;
      if (tabs.includes(h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [tabs]);
  const go = (t: TabId) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };
  return (
    <div className="grid gap-5">
      {p.status === "suspended" && <Notice tone="warning" title="Your partner account is paused">{p.reviewNote}</Notice>}
      <Tabs value={tab} onChange={go} tabs={tabs.map((t) => ({ value: t, label: <>{TAB_META[t].icon}{t === "links" ? (LINKS_LABEL[p.type] ?? TAB_META.links.label) : TAB_META[t].label}</> }))} />
      {tab === "overview" && <Overview d={d} person={person} go={(t) => go(t as TabId)} />}
      {tab === "customers" && <Customers d={d} />}
      {tab === "leads" && <Leads d={d} />}
      {tab === "links" && <LinksAndCoupons d={d} />}
      {tab === "earnings" && <Earnings />}
      {tab === "payouts" && <Payouts d={d} />}
      {tab === "profile" && <Profile d={d} />}
      {tab === "playbook" && <Playbook d={d} />}
    </div>
  );
}
