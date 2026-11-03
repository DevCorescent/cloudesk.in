"use client";

// Settings navigation, grouped by what each page is about. On wide screens a
// menu beside the page; on narrow ones a strip of tabs that scrolls sideways
// on its own (the page never does), with the current tab kept in view.
import clsx from "clsx";
import { Bell, Blocks, Building2, CreditCard, Database, GitBranch, KeyRound, LayoutGrid, Monitor, ScrollText, Settings2, ShieldCheck, Sparkles, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type Item = { href: string; label: string; icon: LucideIcon };
export const GROUPS: { label: string; items: Item[] }[] = [
  { label: "You", items: [
    { href: "/settings", label: "Account", icon: User },
    { href: "/settings/notifications", label: "Notifications", icon: Bell },
  ] },
  { label: "Workspace", items: [
    { href: "/settings/workspace", label: "Workspace", icon: Monitor },
    { href: "/settings/organisation", label: "Organisation", icon: Building2 },
    { href: "/settings/features", label: "Features", icon: LayoutGrid },
    { href: "/settings/customise", label: "Customise", icon: Settings2 },
    { href: "/settings/approvals", label: "Approvals", icon: GitBranch },
  ] },
  { label: "Security", items: [
    { href: "/settings/identity", label: "Identity & sign-in", icon: ShieldCheck },
    { href: "/settings/audit", label: "Audit log", icon: ScrollText },
  ] },
  { label: "Billing & data", items: [
    { href: "/settings/billing", label: "Billing", icon: CreditCard },
    { href: "/settings/data", label: "Data", icon: Database },
    { href: "/settings/integrations", label: "Integrations", icon: Blocks },
    { href: "/settings/ai", label: "AI providers", icon: Sparkles },
    { href: "/settings/developer", label: "Developer", icon: KeyRound },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.items);

export function SettingsNav() {
  const path = usePathname();
  const strip = useRef<HTMLDivElement>(null);
  // Keep the current tab in view on narrow screens.
  useEffect(() => {
    strip.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [path]);
  return (
    <>
      <nav aria-label="Settings" className="hidden lg:block">
        <div className="sticky top-20 grid gap-4">
          {GROUPS.map((g) => (
            <div key={g.label} className="grid gap-px">
              <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">{g.label}</p>
              {g.items.map((i) => {
                const on = path === i.href;
                return (
                  <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={clsx("flex h-8 items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] transition-colors", on ? "side-row-on" : "text-muted hover:bg-fg/[0.04] hover:text-fg")}>
                    <i.icon className={clsx("size-[15px] shrink-0", on ? "text-fg" : "text-subtle")} aria-hidden />
                    <span className="truncate">{i.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
      <div ref={strip} className="-mx-4 min-w-0 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden [&::-webkit-scrollbar]:hidden">
        <nav aria-label="Settings sections" className="flex w-max gap-1.5 pb-1">
          {ALL.map((i) => {
            const on = path === i.href;
            return (
              <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={clsx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors", on ? "border-transparent bg-fg text-bg" : "border-border bg-surface text-muted hover:text-fg")}>
                <i.icon className="size-3.5" aria-hidden />
                {i.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
