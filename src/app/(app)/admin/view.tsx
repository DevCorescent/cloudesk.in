"use client";

// The platform control centre: analytics, the go-live checklist, live health,
// workspaces, people and admins, the audit log, release flags, notices and
// maintenance, subscriptions, plans and pricing, integrations, settings and infrastructure. Sections show
// only what the admin's role allows; the server checks every action again.
import clsx from "clsx";
import { Lightbulb, Activity, BarChart3, Blocks, BrickWall, Building2, Cable, Cloud, Flag, Gauge, Banknote, CreditCard, Handshake, Megaphone, Rocket, ScrollText, Server, Settings, ShieldCheck, ShieldHalf, Tags, TrendingUp, Users, Scale } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AuditPanel } from "@/components/admin/audit";
import { CloudflarePanel } from "@/components/admin/cloudflare";
import { FirewallPanel } from "@/components/admin/firewall";
import { SecurityPosturePanel } from "@/components/admin/security-posture";
import { MeContext, ReauthProvider, useAdmin, type Me } from "@/components/admin/common";
import { RequestsPanel } from "@/components/admin/requests";
import { FlagsPanel } from "@/components/admin/flags";
import { GoLivePanel } from "@/components/admin/golive";
import { HealthPanel } from "@/components/admin/health";
import { InfraPanel } from "@/components/admin/infra";
import { ModulesPanel } from "@/components/admin/modules";
import { RevenuePanel } from "@/components/admin/revenue";
import { ScalabilityPanel } from "@/components/admin/scalability";
import { IntegrationsPanel } from "@/components/admin/integrations";
import { OverviewPanel } from "@/components/admin/overview";
import { PartnersPanel } from "@/components/admin/partners";
import { PlansPricingPanel } from "@/components/admin/plans";
import { NoticesPanel, SettingsPanel } from "@/components/admin/settings";
import { SubscriptionsPanel } from "@/components/admin/subscriptions";
import { AdminsPanel, UsersPanel } from "@/components/admin/users";
import { WorkspacesPanel } from "@/components/admin/workspaces";
import { MarginsPanel } from "@/components/admin/margins";
import { ErrorState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import type { PlatformPerm } from "@/lib/platform/admin-roles";

// `hash` is the address a section lives at when it isn't just its id (#security/firewall).
type Tab = { id: string; hash?: string; label: string; icon: ReactNode; perm: PlatformPerm; group: string; sub: string; render: (go: (id: string) => void) => ReactNode };

const TABS: Tab[] = [
  { id: "overview", label: "Overview", icon: <BarChart3 />, perm: "analytics:read", group: "Insights", sub: "Growth, activity, plans and revenue across the platform.", render: () => <OverviewPanel /> },
  { id: "revenue", label: "Revenue", icon: <Banknote />, perm: "analytics:read", group: "Insights", sub: "What clients earn through the platform, and what the platform earns from them.", render: () => <RevenuePanel /> },
  { id: "margins", label: "Margins", icon: <Scale />, perm: "tenants:read", group: "Insights", sub: "What each workspace pays against what it costs to run this month — so no plan or customer loses money unnoticed.", render: () => <MarginsPanel /> },
  { id: "modules", label: "Modules", icon: <Blocks />, perm: "analytics:read", group: "Insights", sub: "Adoption, activity and results of every feature across all workspaces.", render: () => <ModulesPanel /> },
  { id: "scalability", label: "Scalability", icon: <TrendingUp />, perm: "health:read", group: "Insights", sub: "Traffic, latency, servers, database growth and capacity recommendations.", render: () => <ScalabilityPanel /> },
  { id: "health", label: "Health", icon: <Activity />, perm: "health:read", group: "Insights", sub: "Database, servers, jobs and what's failing — refreshes every 20 seconds.", render: () => <HealthPanel /> },
  { id: "golive", label: "Go-live", icon: <Rocket />, perm: "settings:read", group: "Insights", sub: "Everything this installation needs before taking real customers.", render: (go) => <GoLivePanel onGo={go} /> },
  { id: "workspaces", label: "Workspaces", icon: <Building2 />, perm: "tenants:read", group: "Customers", sub: "Every workspace: subscription, usage and state. Suspend, lift, keep a private note.", render: () => <WorkspacesPanel /> },
  { id: "subscriptions", label: "Subscriptions", icon: <CreditCard />, perm: "tenants:read", group: "Customers", sub: "MRR, trials and payments due. Extend trials, assign plans, add credit, record payments.", render: () => <SubscriptionsPanel /> },
  { id: "partners", label: "Partners", icon: <Handshake />, perm: "tenants:read", group: "Customers", sub: "Applications, partners and what they've brought, payout requests, and the program's rates and tiers.", render: () => <PartnersPanel /> },
  { id: "users", label: "People", icon: <Users />, perm: "users:read", group: "Customers", sub: "Every account: workspaces, sessions and sign-ins. Disable, sign out, verify.", render: () => <UsersPanel /> },
  { id: "audit", label: "Audit log", icon: <ScrollText />, perm: "audit:read", group: "Customers", sub: "Who did what, across every workspace and this console.", render: () => <AuditPanel /> },
  { id: "notices", label: "Notices", icon: <Megaphone />, perm: "settings:read", group: "Operate", sub: "Maintenance mode and the announcement banner.", render: () => <NoticesPanel /> },
  { id: "requests", label: "Feature requests", icon: <Lightbulb />, perm: "requests:read", group: "Customers", sub: "What workspaces ask for. Reply, plan, publish to the roadmap — and release to everyone or chosen workspaces.", render: () => <RequestsPanel /> },
  { id: "flags", label: "Release flags", icon: <Flag />, perm: "tenants:read", group: "Operate", sub: "Turn features on for everyone or for chosen workspaces.", render: () => <FlagsPanel /> },
  { id: "plans", label: "Plans & pricing", icon: <Tags />, perm: "settings:read", group: "Operate", sub: "The plan catalogue, the free trial, tax and build-your-own prices.", render: () => <PlansPricingPanel /> },
  { id: "security", label: "Posture", icon: <ShieldHalf />, perm: "settings:read", group: "Security", sub: "How well this installation is protected, checked live — and what to fix.", render: (go) => <SecurityPosturePanel onGo={go} /> },
  { id: "firewall", hash: "security/firewall", label: "Firewall", icon: <BrickWall />, perm: "settings:read", group: "Security", sub: "The app's own firewall: rules, limits, bans and every blocked request.", render: () => <FirewallPanel /> },
  { id: "cloudflare", hash: "security/cloudflare", label: "Cloudflare", icon: <Cloud />, perm: "settings:read", group: "Security", sub: "The edge in front of the app: attack mode, settings, rules, cache and the origin lock.", render: (go) => <CloudflarePanel onGo={go} /> },
  { id: "integrations", label: "Integrations", icon: <Cable />, perm: "settings:read", group: "Platform", sub: "Database, email, billing, sign-in, AI, domains and workers — and live tests.", render: () => <IntegrationsPanel /> },
  { id: "settings", label: "Settings", icon: <Settings />, perm: "settings:read", group: "Platform", sub: "Product details, sign-up rules and admin security.", render: () => <SettingsPanel /> },
  { id: "admins", label: "Admins & roles", icon: <ShieldCheck />, perm: "users:read", group: "Platform", sub: "Who runs the platform, and what each role may do.", render: () => <AdminsPanel /> },
  { id: "infra", label: "Infrastructure", icon: <Server />, perm: "health:read", group: "Platform", sub: "How it's running, scaling readiness and deployment files.", render: () => <InfraPanel /> },
];

/** The section an address points at: "#security/firewall/…" → firewall, "#requests/<id>" → requests. */
const tabFromHash = (raw: string) => {
  const h = raw.replace(/^#/, "");
  return TABS.find((t) => t.hash && (h === t.hash || h.startsWith(`${t.hash}/`)))?.id ?? TABS.find((t) => t.id === h.split("/")[0])?.id ?? null;
};

export function AdminConsole() {
  const me = useAdmin<Me>("me");
  // The section is kept in the address (#health) so it survives a reload and can be shared.
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && tabFromHash(window.location.hash)) || "overview");
  // Back/forward and links to another #section switch the section too.
  useEffect(() => {
    const on = () => {
      // "#requests/<id>" opens a section at one of its records.
      const h = tabFromHash(window.location.hash);
      if (h) setTab(h);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (id: string) => {
    setTab(id);
    history.replaceState(null, "", `#${TABS.find((t) => t.id === id)?.hash ?? id}`);
    window.scrollTo({ top: 0 });
  };
  if (me.isError) return <div className="mx-auto max-w-3xl px-4 py-12"><ErrorState title="Not available" message={errorMessage(me.error)} /></div>;
  if (!me.data) return <div className="mx-auto max-w-6xl px-4 py-8"><Skeleton className="h-96" /></div>;
  const tabs = TABS.filter((t) => me.data!.perms.includes(t.perm));
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  const groups = [...new Set(tabs.map((t) => t.group))];
  return (
    <MeContext.Provider value={me.data}>
      <ReauthProvider>
      <div className="mx-auto max-w-[88rem] px-4 py-6 sm:px-8">
        <PageHeader title="Platform admin" description={`Control centre · signed in as ${me.data.roles[me.data.role]?.name ?? me.data.role}. Every action is checked on the server and written to the audit log.`} />
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
          <nav aria-label="Admin sections" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <div className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-4 lg:overflow-visible">
              {groups.map((g) => (
                <div key={g} className="flex gap-1 lg:block lg:space-y-0.5">
                  <p className="hidden px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase lg:block">{g}</p>
                  {tabs.filter((t) => t.group === g).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => go(t.id)}
                      aria-current={t.id === cur.id ? "page" : undefined}
                      className={clsx("flex shrink-0 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[13px] whitespace-nowrap lg:w-full [&>svg]:size-4", t.id === cur.id ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>
          <main className="min-w-0">
            <div className="mb-5 flex items-center gap-2">
              <Gauge className="size-4 text-subtle" aria-hidden />
              <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{cur.label}</h2>
              <p className="hidden text-[13px] text-muted sm:block">— {cur.sub}</p>
            </div>
            {cur.render(go)}
          </main>
        </div>
      </div>
      </ReauthProvider>
    </MeContext.Provider>
  );
}
