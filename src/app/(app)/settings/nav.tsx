"use client";

// Settings navigation, grouped by what each page is about. On wide screens a
// menu beside the page; on narrow ones the current section in a bar that opens
// every section, grouped the same way.
import clsx from "clsx";
import { Bell, Blocks, Building2, CreditCard, Database, GitBranch, IdCard, KeyRound, LayoutGrid, Monitor, ScrollText, Settings2, ShieldCheck, Sparkles, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SectionSwitcher } from "@/components/shell/module-frame";

type Item = { href: string; label: string; icon: LucideIcon };
export const GROUPS: { label: string; items: Item[] }[] = [
  { label: "You", items: [
    { href: "/settings", label: "Account", icon: User },
    { href: "/settings/business-id", label: "Business ID", icon: IdCard },
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
      {/* Narrow screens: where you are, and a sheet with every section grouped as on desktop. */}
      <div className="lg:hidden">
        <SectionSwitcher title="Settings" items={GROUPS.flatMap((g) => g.items.map((i, k) => ({ id: i.href, label: i.label, icon: <i.icon />, group: k === 0 ? g.label : undefined })))} section={ALL.find((i) => i.href === path)?.href ?? "/settings"} href={(id) => id} />
      </div>
    </>
  );
}
