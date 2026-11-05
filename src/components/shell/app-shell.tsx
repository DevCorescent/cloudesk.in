"use client";

import { ChatLayer } from "@/components/chat/share";
import { ComposeAnywhereButton, MailComposeProvider } from "@/components/mail/compose-provider";
import { PageNotesButton } from "@/components/notes/page-notes";
import clsx from "clsx";
import { Check, ChevronsUpDown, FileText, Handshake, LogOut, Monitor, Moon, Plus, Search, Settings, Sun, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Wordmark } from "../brand";
import { Menu } from "../ui/overlays";
import { buttonClasses } from "../ui/primitives";
import { Keys } from "../ui/shortcut";
import { inPlan, isOn, visibleTo, moduleForPath, type ModuleId } from "@/lib/workspace/modules";
import { NotificationBell } from "@/components/notify/bell";
import { AlertsButton } from "@/components/shell/alerts";
import { PlanChip, SubscriptionBanner } from "@/components/billing/status";
import { PaywallDialog } from "@/components/billing/upsell";
import { CommandPalette } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { ModuleOff } from "./module-off";
import { PlatformNotices } from "./notices";
import { PendingInvites } from "./pending-invites";
import { OfflineBar } from "./offline";
import { setTheme, signOut, switchOrg, useSession, useThemePref, type ThemePref } from "./session-context";
import { CollapseButton, RailTip, useSidebarCollapsed, WebAppNav, WorkspaceNav } from "./sidebar";

function OrgSwitcher({ compact }: { compact?: boolean }) {
  const { org, orgs } = useSession();
  const router = useRouter();
  return (
    <Menu
      label="Switch organization"
      align="start"
      trigger={(p) =>
        compact ? (
          <RailTip on label={org.name} sub={`${org.role[0]!.toUpperCase()}${org.role.slice(1)} · switch`}>
            <button {...p} aria-label={`${org.name} — switch workspace`} className="group/org grid size-10 place-items-center rounded-[12px] transition-colors hover:bg-fg/[0.05]">
              <span className="flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF5A5F] to-[#FDBA5A] text-[13px] font-semibold text-white shadow-[0_6px_14px_-6px_rgb(255_90_95/0.7)] ring-1 ring-white/40 transition-transform duration-200 group-hover/org:scale-105">{org.name.slice(0, 1).toUpperCase()}</span>
            </button>
          </RailTip>
        ) : (
        <button {...p} className="flex h-11 w-full items-center gap-2.5 rounded-[11px] px-2 text-left transition-colors hover:bg-fg/[0.04]">
          <span className="flex size-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-[#FF5A5F] to-[#FDBA5A] text-[11px] font-semibold text-white shadow-sm">{org.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-medium">{org.name}</span>
            <span className="flex items-center gap-1.5 text-[11px] leading-tight text-subtle">
              <span className="capitalize">{org.role}</span>
              <PlanChip />
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 text-subtle" aria-hidden />
        </button>
        )
      }
      items={[
        ...orgs.map((o) => ({ label: o.name, icon: o.id === org.id ? <Check /> : <span className="inline-block size-4" />, onSelect: () => switchOrg(o.id) })),
        "separator" as const,
        { label: "Team and roles", icon: <Users />, onSelect: () => router.push("/team") },
      ]}
    />
  );
}

function ThemeMenu() {
  const theme = useThemePref();
  const choose = (t: ThemePref) => setTheme(t);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <Menu
      label="Theme"
      trigger={(p) => (
        <button {...p} aria-label="Theme" title="Theme" className="bar-icon">
          <Icon aria-hidden />
        </button>
      )}
      items={[
        { label: "Light", icon: <Sun />, onSelect: () => choose("light") },
        { label: "Dark", icon: <Moon />, onSelect: () => choose("dark") },
        { label: "Match system", icon: <Monitor />, onSelect: () => choose("system") },
      ]}
    />
  );
}

function AccountMenu() {
  const { user } = useSession();
  const router = useRouter();
  return (
    <Menu
      label="Account"
      trigger={(p) => (
        <button {...p} aria-label="Account" className="ml-0.5 flex size-[32px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#e5e5ea] to-[#8e8e93] text-[12px] font-semibold text-black shadow-sm ring-2 ring-white/70 hover:brightness-105 dark:from-[#48484a] dark:to-[#1c1c1e] dark:text-white dark:ring-white/10">
          {user.name.slice(0, 1).toUpperCase()}
        </button>
      )}
      items={[
        { label: user.email, disabled: true, onSelect: () => {} },
        "separator",
        { label: "Account settings", icon: <Settings />, onSelect: () => router.push("/settings") },
        { label: "Partner program", icon: <Handshake />, onSelect: () => router.push("/partner") },
        { label: "Sign out", icon: <LogOut />, onSelect: () => void signOut() },
      ]}
    />
  );
}

/** The phone app bar's title: the place you're in. */
const PLACES: [RegExp, string][] = [
  [/^\/home/, "Home"], [/^\/inbox/, "My work"], [/^\/copilot/, "Copilot"], [/^\/notes/, "Notes"], [/^\/calculator/, "Calculator"],
  [/^\/settings/, "Settings"], [/^\/team/, "Team"], [/^\/projects\/?$/, "Web apps"], [/^\/create/, "New web app"], [/^\/templates/, "Templates"],
  [/^\/requests/, "Requests"], [/^\/roadmap/, "Roadmap"], [/^\/admin/, "Platform admin"], [/^\/partner/, "Partner program"],
];
const placeName = (p: string) => PLACES.find(([re]) => re.test(p))?.[1] ?? moduleForPath(p)?.name;

function MfaRequiredBanner() {
  const { user, org } = useSession();
  if (!org.requireMfa || user.mfaEnabled) return null;
  return (
    <div role="alert" className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-border bg-warning-soft px-4 py-3 text-[13px] lg:mx-6">
      <span>
        <strong>{org.name}</strong> requires two-factor sign-in. Web apps stay locked until you turn it on.
      </span>
      <Link href="/settings" className={buttonClasses("primary", "sm")}>
        Turn it on
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { org } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const projectId = pathname.match(/^\/projects\/([0-9a-f-]{36})/)?.[1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const on = (id: ModuleId) => visibleTo(org, id);
  // A feature this workspace hasn't switched on gets an invitation, not a broken page.
  const off = moduleForPath(pathname);
  const page = off && !on(off.id) ? <ModuleOff module={off} reason={!inPlan(org, off.id) ? "plan" : isOn(org.modules, off.id) ? "role" : "off"} /> : children;
  // Builder, IDE and the till are full-screen workspaces with their own toolbar.
  if (/^\/projects\/[0-9a-f-]{36}\/(builder|ide|pos)/.test(pathname) || pathname.startsWith("/launch") || pathname.startsWith("/welcome")) {
    return (
      <MailComposeProvider>
      <ChatLayer>
        {page}
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            </ChatLayer>
    </MailComposeProvider>
    );
  }
  const navFor = (c: boolean, close?: () => void) => (projectId && org.role !== "employee" ? <WebAppNav projectId={projectId} pathname={pathname} onNavigate={close} collapsed={c} /> : <WorkspaceNav pathname={pathname} onNavigate={close} collapsed={c} groupsOnly={!!close} />);
  const place = placeName(pathname);

  return (
    <MailComposeProvider>
      <ChatLayer>
    <div className="flex min-h-dvh">
      {/* Floating glass sidebar, inset from the window edge. */}
      <aside className={clsx("side-panel sticky top-2 m-2 mr-0 hidden h-[calc(100dvh-16px)] shrink-0 flex-col overflow-hidden rounded-[18px] lg:flex", collapsed ? "w-[64px]" : "w-[244px]")}>
        <div className={clsx("pt-2 pb-1", collapsed ? "flex justify-center px-3 pt-3" : "px-2")}>
          <OrgSwitcher compact={collapsed} />
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1 [scrollbar-width:thin]">{navFor(collapsed)}</div>
        <div className={clsx("border-t border-fg/[0.06] py-2", collapsed ? "flex justify-center px-3" : "px-2")}>
          <CollapseButton collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-bar sticky top-0 z-30 flex h-[var(--bar)] items-center gap-2 border-b px-4 pt-[env(safe-area-inset-top)] lg:px-6">
          <Link href="/home" aria-label="Cloudesk home" className={clsx("mr-1 shrink-0 items-center sm:mr-3", place ? "hidden lg:inline-flex" : "inline-flex")}>
            <Wordmark className="text-[20px]" />
          </Link>
          {place && (
            <Link href="/home" className="flex min-w-0 items-center gap-2.5 lg:hidden" aria-label={`${place} — Cloudesk home`}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#FF5A5F] to-[#FDBA5A] text-[12px] font-semibold text-white shadow-[0_4px_10px_-4px_rgb(255_90_95/0.7)]">{org.name.slice(0, 1).toUpperCase()}</span>
              <span className="truncate text-[17px] font-semibold tracking-[-0.02em]">{place}</span>
            </Link>
          )}
          <button
            onClick={() => setPaletteOpen(true)}
            data-tour="search"
            aria-label="Search or run a command"
            className="app-search ml-auto flex size-[36px] shrink-0 items-center justify-center gap-2 rounded-full text-[13px] text-subtle transition-colors hover:bg-surface-3 lg:ml-0 lg:h-9 lg:w-full lg:max-w-sm lg:shrink lg:justify-start lg:px-3.5"
          >
            <Search className="size-[18px] stroke-[1.75] lg:size-3.5 lg:stroke-2" aria-hidden />
            <span className="hidden flex-1 truncate text-left lg:inline">Search or run a command</span>
            <span className="hidden lg:inline-flex"><Keys k="mod+k" /></span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 lg:ml-auto">
            <span className="hidden lg:inline-flex">
              <Link href="/create" className={buttonClasses("primary", "md")}>
                <Plus className="size-3.5" aria-hidden /> New web app
              </Link>
            </span>
            <span className="mx-1.5 hidden h-5 w-px bg-fg/10 lg:block" aria-hidden />
            <Link href="/documents" aria-label="Documents" title="Documents" aria-current={pathname.startsWith("/documents") ? "page" : undefined} className="bar-icon">
              <FileText aria-hidden />
            </Link>
            <span className="hidden items-center gap-0.5 lg:flex">
              <PageNotesButton />
              <ComposeAnywhereButton />
            </span>
            <AlertsButton />
            <NotificationBell />
            <span className="hidden lg:inline-flex">
              <ThemeMenu />
            </span>
            <span className="mx-1.5 hidden h-5 w-px bg-fg/10 sm:block" aria-hidden />
            <AccountMenu />
          </div>
        </header>
        <OfflineBar />
        <PlatformNotices />
        <PendingInvites />
        <SubscriptionBanner />
        <PaywallDialog />
        <main id="main" className="min-w-0 flex-1 pb-[var(--dock)]">
          <MfaRequiredBanner />
          {page}
        </main>
      </div>
      <MobileNav pathname={pathname} nav={(close) => navFor(false, close)} org={<OrgSwitcher />} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
          </ChatLayer>
    </MailComposeProvider>
  );
}
