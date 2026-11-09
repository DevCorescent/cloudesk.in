"use client";

// The sidebar: light, and folded into groups by what each area is for
// (customers, money, people, operations…). Only switched-on modules appear; a
// group with nothing switched on doesn't. Groups open like dropdowns — the one
// you're in stays open — and the whole sidebar folds down to an icon rail,
// where each group opens as a flyout. Inside a web app the sidebar is that
// web app's own tools only, with a way back.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AppWindow, ArrowLeft, ClipboardCheck, BadgeCheck, Blocks, BookOpenCheck, Bot, Boxes, Building2, Calculator, NotebookPen, CalendarDays, ChevronDown, Code2, Contact, Database, DoorOpen, Factory, FileSignature, Gauge, GraduationCap, Handshake, HardHat, Home, Inbox, KanbanSquare, Landmark, LayoutGrid, LayoutTemplate, LifeBuoy, Lightbulb, Lock, Mail, Megaphone, MessagesSquare, Palette, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, PieChart, ReceiptText, Rocket, ScanLine, Send, Settings, Shapes, ShieldAlert, ShieldCheck, ShoppingBag, Sparkles, Stethoscope, TrendingUp, Truck, Users, UtensilsCrossed, Wand2, Workflow, Wrench } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useShortcuts } from "../ui/shortcut";
import { createPortal } from "react-dom";
import { useSession } from "./session-context";
import { useChatMeta } from "@/components/chat/shared";
import { useCalMeta } from "@/components/calendar/shared";
import { useMailBadge } from "@/components/notify/sounds";
import { inPlan, isOn, visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { api } from "@/lib/client/api";

type Tone = "lavender" | "peach" | "mint" | "sky" | "butter" | "rose";
export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** A count shown at the end of the row (unread messages). */
  badge?: { n: number; hot?: boolean };
  module?: ModuleId;
  match?: (p: string) => boolean;
  tour?: string;
};
export type Section = {
  id: string;
  label: string;
  icon: ReactNode;
  tone: Tone;
  items: NavItem[];
};

/** Accent per group — its icon and the selected row's icon take it. */
const INK: Record<Tone, string> = {
  lavender: "#7c5cdb",
  peach: "#e8743b",
  mint: "#1f9d6c",
  sky: "#2a86d1",
  butter: "#c9871a",
  rose: "#e5484d",
};

/** The workspace's areas, by what they're for. Only switched-on modules show. */
export const SECTIONS: Section[] = [
  {
    id: "customers",
    label: "Customers & sales",
    icon: <Handshake />,
    tone: "peach",
    items: [
      {
        href: "/crm",
        label: "CRM",
        icon: <Contact />,
        module: "crm",
        tour: "nav-crm",
      },
      {
        href: "/sales",
        label: "Sales orders",
        icon: <Handshake />,
        module: "sales",
      },
      {
        href: "/marketing",
        label: "Marketing",
        icon: <Send />,
        module: "marketing",
      },
      {
        href: "/helpdesk",
        label: "Helpdesk",
        icon: <LifeBuoy />,
        module: "helpdesk",
      },
      {
        href: "/requisitions",
        label: "Requisitions",
        icon: <ClipboardCheck />,
        module: "requisitions",
      },
      {
        href: "/portals",
        label: "Portals",
        icon: <DoorOpen />,
        module: "portal",
      },
    ],
  },
  {
    id: "money",
    label: "Money",
    icon: <Landmark />,
    tone: "butter",
    items: [
      {
        href: "/finance",
        label: "Invoices & finance",
        icon: <Landmark />,
        module: "invoicing",
        tour: "nav-finance",
      },
      {
        href: "/accounts",
        label: "Accounts",
        icon: <BookOpenCheck />,
        module: "accounting",
      },
    ],
  },
  {
    id: "people",
    label: "People & work",
    icon: <Users />,
    tone: "mint",
    items: [
      {
        href: "/hr",
        label: "HR & payroll",
        icon: <BadgeCheck />,
        module: "hr",
        tour: "nav-hr",
      },
      {
        href: "/work",
        label: "Projects & time",
        icon: <KanbanSquare />,
        module: "work",
      },
      {
        href: "/documents",
        label: "Documents & e-sign",
        icon: <FileSignature />,
        module: "documents",
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: <Boxes />,
    tone: "sky",
    items: [
      {
        href: "/inventory",
        label: "Inventory",
        icon: <Boxes />,
        module: "inventory",
      },
      {
        href: "/manufacturing",
        label: "Manufacturing",
        icon: <Factory />,
        module: "manufacturing",
      },
      {
        href: "/quality",
        label: "Quality",
        icon: <ShieldCheck />,
        module: "quality",
      },
      {
        href: "/maintenance",
        label: "Maintenance",
        icon: <Wrench />,
        module: "maintenance",
      },
      {
        href: "/logistics",
        label: "Logistics & fleet",
        icon: <Truck />,
        module: "logistics",
      },
    ],
  },
  {
    id: "industry",
    label: "Your industry",
    icon: <Building2 />,
    tone: "rose",
    items: [
      {
        href: "/clinic",
        label: "Clinic",
        icon: <Stethoscope />,
        module: "clinic",
      },
      {
        href: "/school",
        label: "Education",
        icon: <GraduationCap />,
        module: "education",
      },
      {
        href: "/construction",
        label: "Construction",
        icon: <HardHat />,
        module: "construction",
      },
    ],
  },
  {
    id: "insights",
    label: "Insights & control",
    icon: <PieChart />,
    tone: "lavender",
    items: [
      {
        href: "/reports",
        label: "Reports & dashboards",
        icon: <PieChart />,
        module: "bi",
      },
      {
        href: "/compliance",
        label: "Compliance & risk",
        icon: <ShieldAlert />,
        module: "grc",
      },
      {
        href: "/objects",
        label: "Custom objects",
        icon: <Shapes />,
        module: "objects",
      },
    ],
  },
  {
    id: "build",
    label: "Websites & apps",
    icon: <AppWindow />,
    tone: "lavender",
    items: [
      {
        href: "/projects",
        label: "Web apps",
        icon: <AppWindow />,
        match: (p) => p === "/projects",
      },
      { href: "/create", label: "Create with AI", icon: <Wand2 /> },
      { href: "/templates", label: "Templates", icon: <LayoutTemplate /> },
    ],
  },
];

const isActive = (item: NavItem, pathname: string) =>
  item.match
    ? item.match(pathname)
    : pathname === item.href || pathname.startsWith(item.href + "/");

// ─── Remembered UI state ─────────────────────────────────────────────────────

function useStored<T>(
  key: string,
  initial: T,
): [T, (v: T | ((x: T) => T)) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount; storage isn't there during server rendering
      if (raw !== null) setV(JSON.parse(raw) as T);
    } catch {
      // Private mode: defaults.
    }
  }, [key]);
  const set = (x: T | ((y: T) => T)) =>
    setV((prev) => {
      const next = typeof x === "function" ? (x as (y: T) => T)(prev) : x;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not kept; fine.
      }
      return next;
    });
  return [v, set];
}

/** Whether the sidebar is folded to icons (remembered; ⌘\ on Apple devices, Ctrl+\ elsewhere, toggles it). */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useStored("cloudesk.nav.collapsed", false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCollapsed]);
  return [collapsed, setCollapsed] as const;
}

// ─── Rail tooltips ───────────────────────────────────────────────────────────

/**
 * On the icon rail: a label that slides out beside an icon on hover or focus,
 * with its count and shortcut. Elsewhere it renders the child as it is.
 */
export function RailTip({ on, label, sub, keys, children }: { on: boolean; label: string; sub?: string; keys?: string; children: ReactNode }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (!on) return <>{children}</>;
  const show = (now?: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setAt({ top: r.top + r.height / 2, left: r.right + 12 });
    }, now ? 0 : 90);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setAt(null);
  };
  return (
    <div ref={ref} className="relative flex justify-center" onMouseEnter={() => show()} onMouseLeave={hide} onFocus={(e) => e.target.matches(":focus-visible") && show(true)} onBlur={hide} onClick={hide}>
      {children}
      {at &&
        createPortal(
          <div role="tooltip" className="rail-tip pointer-events-none fixed z-[60] flex -translate-y-1/2 items-center gap-2 rounded-[9px] bg-[#1c1c1f] px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap text-white shadow-[0_10px_26px_-10px_rgb(0_0_0/0.55)] dark:bg-[#f2f2f4] dark:text-black" style={{ top: at.top, left: at.left }}>
            <span className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rotate-45 rounded-[2px] bg-inherit" aria-hidden />
            <span className="relative">{label}</span>
            {sub && <span className="relative text-white/55 dark:text-black/50">{sub}</span>}
            {keys && <kbd className="relative rounded-[5px] bg-white/12 px-1.5 py-px font-sans text-[10.5px] text-white/70 dark:bg-black/10 dark:text-black/60">{keys}</kbd>}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A row's count, as a bubble on the rail and a pill in the full sidebar. */
function badgeText(b: NavItem["badge"]) {
  return b?.n ? (b.n > 99 ? "99+" : String(b.n)) : "";
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function Row({
  item,
  pathname,
  tone,
  onNavigate,
  collapsed,
  nested,
}: {
  item: NavItem;
  pathname: string;
  tone: Tone;
  onNavigate?: () => void;
  collapsed?: boolean;
  nested?: boolean;
}) {
  const active = isActive(item, pathname);
  if (collapsed) {
    const n = badgeText(item.badge);
    return (
      <RailTip on label={item.label} sub={n ? `${n} ${item.badge?.hot ? "need you" : "new"}` : undefined}>
        <Link
          href={item.href}
          onClick={onNavigate}
          data-tour={item.tour}
          aria-current={active ? "page" : undefined}
          aria-label={n ? `${item.label}, ${n} new` : item.label}
          className={clsx("rail-item group/rail relative grid h-[34px] w-10 place-items-center rounded-[11px] transition-[background,color,transform] duration-200 active:scale-95 [&_svg]:size-[17px]", active ? "rail-on" : "text-fg/50 hover:text-[var(--ink)]")}
          style={{ ["--ink" as string]: INK[tone] }}
        >
          {active && <span className="absolute top-2 bottom-2 -left-[11px] w-[3px] rounded-r-full bg-[var(--ink)]" aria-hidden />}
          {item.icon}
          {n && (
            <span className={clsx("absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px] leading-none font-bold text-white tabular-nums ring-2 ring-[var(--surface-solid)]", item.badge?.hot ? "bg-red-500" : "bg-sky-500")} aria-hidden>
              {n}
            </span>
          )}
        </Link>
      </RailTip>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      data-tour={item.tour}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group/row relative flex h-[30px] items-center rounded-[8px] text-[13px] transition-[background,color,box-shadow] duration-200 [&>svg]:size-[15px] [&>svg]:shrink-0",
        "gap-2.5 px-2.5",
        active ? "side-row-on" : "text-fg/60 hover:bg-fg/[0.04] hover:text-fg",
      )}
      style={active ? { ["--ink" as string]: INK[tone] } : undefined}
    >
      {nested && active && (
        <span
          className="absolute top-1.5 bottom-1.5 -left-[11px] w-[2px] rounded-full"
          style={{ background: INK[tone] }}
          aria-hidden
        />
      )}
      <span
        className={clsx(
          "grid place-items-center [&>svg]:size-[15px]",
          active
            ? "text-[var(--ink)]"
            : "text-fg/45 group-hover/row:text-fg/70",
        )}
      >
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
      {!!item.badge?.n && <span aria-label={`${item.badge.n} unread`} className={clsx("ml-auto grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums", item.badge.hot ? "bg-red-500 text-white" : "bg-fg/10 text-fg/70")}>{badgeText(item.badge)}</span>}
    </Link>
  );
}

/** A group as a dropdown: its header opens and closes it. */
function Group({
  section,
  pathname,
  onNavigate,
  open,
  toggle,
}: {
  section: Section;
  pathname: string;
  onNavigate?: () => void;
  open: boolean;
  toggle: () => void;
}) {
  const hasActive = section.items.some((i) => isActive(i, pathname));
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={clsx(
          "group/head flex h-[30px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] transition-colors",
          open ? "text-fg" : "text-fg/60 hover:bg-fg/[0.04] hover:text-fg",
        )}
      >
        <span
          className="grid size-[18px] place-items-center rounded-[5px] [&>svg]:size-[12px]"
          style={{
            background: `color-mix(in srgb, ${INK[section.tone]} 14%, transparent)`,
            color: INK[section.tone],
          }}
        >
          {section.icon}
        </span>
        <span className="flex-1 truncate font-medium">{section.label}</span>
        {!open && hasActive && (
          <span
            className="size-1.5 rounded-full"
            style={{ background: INK[section.tone] }}
            aria-label="You're here"
          />
        )}
        <ChevronDown
          className={clsx(
            "size-3.5 text-fg/35 transition-transform duration-300",
            !open && "-rotate-90",
          )}
          aria-hidden
        />
      </button>
      <div className="side-fold" data-open={open}>
        <div inert={!open}>
          <div className="relative mt-0.5 mb-1.5 ml-[18px] grid gap-px border-l border-fg/[0.07] pl-2.5">
            {section.items.map((i) => (
              <Row
                key={i.href}
                item={i}
                pathname={pathname}
                tone={section.tone}
                onNavigate={onNavigate}
                nested
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * On the icon rail: a group's icon that opens its items beside it — on hover,
 * or kept open with a click (Escape or a click elsewhere closes it).
 */
function RailGroup({
  section,
  pathname,
}: {
  section: Section;
  pathname: string;
}) {
  const [fly, setFly] = useState<{ top: number; left: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = section.items.find((i) => isActive(i, pathname));
  const ink = INK[section.tone];
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const h = 58 + section.items.length * 31;
    setFly({ top: Math.max(8, Math.min(r.top - 8, window.innerHeight - h - 8)), left: r.right + 14 });
  };
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    place();
  };
  const close = () => {
    setPinned(false);
    setFly(null);
  };
  const hide = () => {
    if (pinned) return;
    timer.current = setTimeout(() => setFly(null), 160);
  };
  useEffect(() => {
    if (!fly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        ref.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const links = [...(menu.current?.querySelectorAll("a") ?? [])];
        if (!links.length) return;
        e.preventDefault();
        const i = links.indexOf(document.activeElement as HTMLAnchorElement);
        links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !ref.current?.contains(t)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [fly]);
  return (
    <div
      className="flex justify-center"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        ref={ref}
        type="button"
        aria-label={active ? `${section.label} (you're in ${active.label})` : section.label}
        aria-haspopup="menu"
        aria-expanded={!!fly}
        onClick={() => {
          if (pinned) return close();
          setPinned(true);
          show();
          // Keyboard users land on the first item.
          requestAnimationFrame(() => menu.current?.querySelector("a")?.focus({ preventScroll: true }));
        }}
        className={clsx(
          "rail-item relative grid h-[34px] w-10 place-items-center rounded-[11px] transition-[background,box-shadow,transform] duration-200 active:scale-95 [&>svg]:size-[17px]",
          active || fly ? "rail-on" : "rail-group",
        )}
        style={{ ["--ink" as string]: ink, color: ink }}
      >
        {active && <span className="absolute top-2 bottom-2 -left-[11px] w-[3px] rounded-r-full" style={{ background: ink }} aria-hidden />}
        {section.icon}
        {/* A small notch says "there's more inside". */}
        <span className="absolute right-[3px] bottom-[3px] size-[5px] rounded-br-[3px] border-r-[1.5px] border-b-[1.5px] opacity-45" style={{ borderColor: ink }} aria-hidden />
      </button>
      {fly &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={section.label}
            className="side-fly fixed z-50 w-60 overflow-hidden rounded-[16px] border border-fg/[0.07] bg-[var(--surface-solid)] p-1.5 shadow-[0_22px_50px_-18px_rgb(20_10_40/0.4)]"
            style={{ top: fly.top, left: fly.left }}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <div className="mb-1 flex items-center gap-2.5 rounded-[11px] px-2 py-2" style={{ background: `color-mix(in srgb, ${ink} 9%, transparent)` }}>
              <span className="grid size-7 place-items-center rounded-[9px] [&>svg]:size-[15px]" style={{ background: `color-mix(in srgb, ${ink} 16%, transparent)`, color: ink }}>
                {section.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{section.label}</span>
                <span className="block text-[11px] text-fg/45">{section.items.length} {section.items.length === 1 ? "feature" : "features"}</span>
              </span>
            </div>
            {section.items.map((i) => (
              <Row
                key={i.href}
                item={i}
                pathname={pathname}
                tone={section.tone}
                onNavigate={close}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function Divider({ collapsed }: { collapsed?: boolean }) {
  return (
    <div
      className={clsx("h-px bg-fg/[0.07]", collapsed ? "mx-auto my-2.5 w-6" : "mx-2.5 my-2")}
      aria-hidden
    />
  );
}

/** The fold button at the bottom of the sidebar. */
export function CollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { withKeys, keys } = useShortcuts();
  const hint = keys("mod+backslash");
  return (
    <RailTip on={collapsed} label="Expand sidebar" keys={hint || undefined}>
    <button
      type="button"
      onClick={onToggle}
      title={collapsed ? undefined : withKeys("Collapse sidebar", "mod+backslash")}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={clsx(
        "flex h-[30px] items-center rounded-[8px] text-[12.5px] text-fg/45 transition-colors hover:bg-fg/[0.04] hover:text-fg [&>svg]:size-[15px]",
        collapsed ? "h-[34px] w-10 justify-center rounded-[11px] hover:bg-fg/[0.05]" : "w-full gap-2.5 px-2.5",
      )}
    >
      {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      {!collapsed && <span className="flex-1 text-left">Collapse</span>}
      {!collapsed && hint && <kbd className="rounded-[5px] border border-fg/10 px-1 text-[10.5px] text-fg/40">{hint}</kbd>}
    </button>
    </RailTip>
  );
}

// ─── The workspace sidebar ───────────────────────────────────────────────────

export function WorkspaceNav({
  pathname,
  onNavigate,
  collapsed,
  groupsOnly,
}: {
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  /** Leave out Home, Mail, Notes and the rest of the everyday places (the phone's More sheet shows them as tiles). */
  groupsOnly?: boolean;
}) {
  const { org, user } = useSession();
  const [opened, setOpened] = useStored<string[]>("cloudesk.nav.open", []);
  const on = (m?: ModuleId) => !m || visibleTo(org, m);
  const top = (
    <>
      <Row
        pathname={pathname}
        onNavigate={onNavigate}
        collapsed={collapsed}
        tone="lavender"
        item={{ href: "/home", label: "Home", icon: <Home /> }}
      />
      <Row
        pathname={pathname}
        onNavigate={onNavigate}
        collapsed={collapsed}
        tone="lavender"
        item={{ href: "/inbox", label: "My work", icon: <Inbox /> }}
      />
      {on("mail") && <MailRow pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />}
      {on("calendar") && <CalendarRow pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />}
      {on("chat") && <ChatRow pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} />}
    </>
  );
  if (org.role === "employee")
    return (
      <nav aria-label="Main" className="grid gap-px px-2 pb-3">
        <Row
          pathname={pathname}
          onNavigate={onNavigate}
          collapsed={collapsed}
          tone="lavender"
          item={{ href: "/inbox", label: "My work", icon: <Inbox /> }}
        />
        <Row
          pathname={pathname}
          onNavigate={onNavigate}
          collapsed={collapsed}
          tone="mint"
          item={{ href: "/hr", label: "My HR", icon: <BadgeCheck /> }}
        />
        <Row
          pathname={pathname}
          onNavigate={onNavigate}
          collapsed={collapsed}
          tone="lavender"
          item={{
            href: "/settings",
            label: "My account",
            icon: <Settings />,
            match: (p) => p === "/settings",
          }}
        />
      </nav>
    );
  const sections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => on(i.module)),
  })).filter((s) => s.items.length);
  // Features outside the plan that this workspace uses (or popular ones, if it switched everything on): a nudge, not a wall.
  const lockedAll = org.entitled ? SECTIONS.flatMap((sec) => sec.items).filter((i) => i.module && isOn(org.modules, i.module) && !inPlan(org, i.module)) : [];
  const picked = org.modules ? lockedAll : lockedAll.filter((i) => ["hr", "inventory", "accounting", "store"].includes(i.module!));
  const locked = picked.filter((i, n, a) => a.findIndex((x) => x.module === i.module) === n).slice(0, 4);
  // A group is open if it was opened, or if you're on one of its pages.
  const isOpen = (s: Section) =>
    opened.includes(s.id) || s.items.some((i) => isActive(i, pathname));
  const toggle = (s: Section) =>
    setOpened((o) => (isOpen(s) ? o.filter((x) => x !== s.id) : [...o, s.id]));
  const bottom = [
    {
      href: "/settings/features",
      label: "Choose features",
      icon: <LayoutGrid />,
    },
    { href: "/requests", label: "Request a feature", icon: <Lightbulb /> },
    { href: "/team", label: "Team", icon: <Users /> },
    {
      href: "/settings",
      label: "Settings",
      icon: <Settings />,
      match: (p: string) =>
        p.startsWith("/settings") && p !== "/settings/features",
    },
    ...(user.isPlatformAdmin
      ? [{ href: "/admin", label: "Platform admin", icon: <ShieldAlert /> }]
      : []),
  ];
  return (
    <nav
      aria-label="Main"
      className={clsx("grid pb-2", collapsed ? "gap-[3px] px-3" : "gap-px px-2")}
    >
      {!groupsOnly && <>
      {top}
      {on("copilot") && (
        <Row
          pathname={pathname}
          onNavigate={onNavigate}
          collapsed={collapsed}
          tone="lavender"
          item={{ href: "/copilot", label: "Ask Copilot", icon: <Sparkles /> }}
        />
      )}
      <Row pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} tone="butter" item={{ href: "/notes", label: "Notes", icon: <NotebookPen /> }} />
      <Row pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} tone="sky" item={{ href: "/calculator", label: "Calculator", icon: <Calculator /> }} />
      <Divider collapsed={collapsed} />
      </>}
      {collapsed ? (
        <div className="grid gap-1.5">
          {sections.map((s) => (
            <RailGroup key={s.id} section={s} pathname={pathname} />
          ))}
        </div>
      ) : (
        <div className="grid gap-px">
          {sections.map((s) => (
            <Group
              key={s.id}
              section={s}
              pathname={pathname}
              onNavigate={onNavigate}
              open={isOpen(s)}
              toggle={() => toggle(s)}
            />
          ))}
        </div>
      )}
      {!collapsed && locked.length > 0 && (
        <div className="mt-2 grid gap-px">
          <p className="px-2.5 pt-1 pb-0.5 text-[10.5px] font-semibold tracking-[0.12em] text-muted uppercase">Unlock with a plan</p>
          {locked.map((i) => (
            <Link key={i.href} href={i.href} onClick={onNavigate} className="group/lock flex h-[30px] items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] text-muted transition-colors hover:bg-fg/[0.04] hover:text-fg [&_svg]:size-4">
              <span className="opacity-60">{i.icon}</span>
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              <Lock className="!size-3.5 opacity-60 group-hover/lock:opacity-100" aria-label="Not in your plan" />
            </Link>
          ))}
        </div>
      )}
      <Divider collapsed={collapsed} />
      {bottom.map((i) => (
        <Row
          key={i.href}
          item={i}
          pathname={pathname}
          tone="lavender"
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      ))}
    </nav>
  );
}

// ─── Inside a web app ────────────────────────────────────────────────────────

/** Inside one web app: only its tools, grouped, with the way back to all web apps. */
export function WebAppNav({
  projectId,
  pathname,
  onNavigate,
  collapsed,
}: {
  projectId: string;
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const { org } = useSession();
  const [opened, setOpened] = useStored<string[]>(
    "cloudesk.nav.app-closed",
    [],
  );
  const q = useQuery({
    queryKey: ["project", projectId],
    queryFn: () =>
      api<{ project: { name: string } }>(`/api/v1/projects/${projectId}`),
    staleTime: 60_000,
  });
  const on = (m?: ModuleId) => !m || visibleTo(org, m);
  const base = `/projects/${projectId}`;
  const all: Section[] = [
    {
      id: "app-build",
      label: "Build",
      icon: <PanelsTopLeft />,
      tone: "lavender",
      items: [
        {
          href: base,
          label: "Overview",
          icon: <Gauge />,
          match: (p) => p === base,
        },
        {
          href: `${base}/builder`,
          label: "Website builder",
          icon: <PanelsTopLeft />,
          tour: "nav-builder",
        },
        { href: `${base}/brand`, label: "Brand", icon: <Palette /> },
        {
          href: `${base}/ide`,
          label: "AI IDE",
          icon: <Code2 />,
          module: "ai-ide",
        },
        {
          href: `${base}/deployments`,
          label: "Deployments",
          icon: <Rocket />,
          tour: "nav-deployments",
        },
      ],
    },
    {
      id: "app-sell",
      label: "Sell",
      icon: <ShoppingBag />,
      tone: "peach",
      items: [
        {
          href: `${base}/store`,
          label: "Online store",
          icon: <ShoppingBag />,
          module: "store",
          tour: "nav-store",
        },
        {
          href: `${base}/pos`,
          label: "Point of sale",
          icon: <ScanLine />,
          module: "pos",
        },
        {
          href: `${base}/horeca`,
          label: "Restaurant & hotel",
          icon: <UtensilsCrossed />,
          module: "horeca",
        },
        {
          href: `${base}/invoicing`,
          label: "Invoices & quotes",
          icon: <ReceiptText />,
          module: "invoicing",
          tour: "nav-invoicing",
        },
        {
          href: `${base}/promotions`,
          label: "Promotions",
          icon: <Megaphone />,
          module: "promotions",
        },
      ],
    },
    {
      id: "app-grow",
      label: "Grow & automate",
      icon: <TrendingUp />,
      tone: "mint",
      items: [
        {
          href: `${base}/growth`,
          label: "Growth",
          icon: <TrendingUp />,
          module: "growth",
          tour: "nav-growth",
        },
        {
          href: `${base}/chatbot`,
          label: "Chatbot",
          icon: <Bot />,
          module: "chatbot",
        },
        {
          href: `${base}/automations`,
          label: "Automations",
          icon: <Workflow />,
          module: "automations",
        },
        {
          href: `${base}/data`,
          label: "Data & API",
          icon: <Database />,
          module: "data",
        },
        {
          href: `${base}/integrations`,
          label: "Integrations",
          icon: <Blocks />,
        },
      ],
    },
  ];
  const groups = all
    .map((s) => ({ ...s, items: s.items.filter((i) => on(i.module)) }))
    .filter((s) => s.items.length);
  // Inside a web app every group starts open; closing one is remembered.
  const isOpen = (s: Section) =>
    !opened.includes(s.id) || s.items.some((i) => isActive(i, pathname));
  const name = q.data?.project.name ?? "Web app";
  return (
    <nav
      aria-label="Web app"
      className={clsx("grid pb-2", collapsed ? "gap-[3px] px-3" : "gap-px px-2")}
    >
      <RailTip on={!!collapsed} label="All web apps">
        <Link
          href="/projects"
          onClick={onNavigate}
          aria-label={collapsed ? "All web apps" : undefined}
          className={clsx(
            "flex items-center text-[12.5px] text-fg/50 hover:bg-fg/[0.04] hover:text-fg",
            collapsed ? "h-[34px] w-10 justify-center rounded-[11px]" : "h-[30px] gap-2 rounded-[8px] px-2.5",
          )}
        >
          <ArrowLeft className="size-3.5" /> {!collapsed && "All web apps"}
        </Link>
      </RailTip>
      {collapsed ? (
        <RailTip on label={name} sub="Web app">
          <span className="my-1.5 grid size-10 place-items-center rounded-[12px] bg-gradient-to-br from-[#FFE3E4] to-[#FFF1DB] text-[13px] font-semibold text-[#c2410c]">
            {name.slice(0, 1).toUpperCase()}
          </span>
        </RailTip>
      ) : (
        <div className="my-1.5 flex items-center gap-2.5 rounded-[11px] bg-fg/[0.03] px-2.5 py-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-gradient-to-br from-[#FFE3E4] to-[#FFF1DB] text-[12px] font-semibold text-[#c2410c]">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">
              {name}
            </span>
            <span className="block text-[11px] text-fg/40">Web app</span>
          </span>
        </div>
      )}
      {collapsed ? (
        <div className="grid gap-1">
          {groups.map((s) => (
            <RailGroup key={s.id} section={s} pathname={pathname} />
          ))}
        </div>
      ) : (
        <div className="grid gap-px">
          {groups.map((s) => (
            <Group
              key={s.id}
              section={s}
              pathname={pathname}
              onNavigate={onNavigate}
              open={isOpen(s)}
              toggle={() =>
                setOpened((o) =>
                  isOpen(s) ? [...o, s.id] : o.filter((x) => x !== s.id),
                )
              }
            />
          ))}
        </div>
      )}
    </nav>
  );
}

/** Mail, with unread mail in your inboxes (red when replies are overdue). */
function MailRow({ pathname, onNavigate, collapsed }: { pathname: string; onNavigate?: () => void; collapsed?: boolean }) {
  const q = useMailBadge();
  const c = q.data?.counts.all;
  return <Row pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} tone="sky" item={{ href: "/mail", label: "Mail", icon: <Mail />, badge: c ? { n: c.unread, hot: c.overdue > 0 } : undefined }} />;
}

/** Calendar, with what's waiting on you: invites to add and minutes to write. */
function CalendarRow({ pathname, onNavigate, collapsed }: { pathname: string; onNavigate?: () => void; collapsed?: boolean }) {
  const q = useCalMeta();
  const n = (q.data?.invites.length ?? 0) + (q.data?.notesDue.length ?? 0);
  return <Row pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} tone="sky" item={{ href: "/calendar", label: "Calendar", icon: <CalendarDays />, badge: q.data ? { n, hot: (q.data.invites.length ?? 0) > 0 } : undefined }} />;
}

/** Chat, with unread messages (red when someone needs you). */
function ChatRow({ pathname, onNavigate, collapsed }: { pathname: string; onNavigate?: () => void; collapsed?: boolean }) {
  const meta = useChatMeta();
  const c = meta.data?.counts;
  return <Row pathname={pathname} onNavigate={onNavigate} collapsed={collapsed} tone="lavender" item={{ href: "/chat", label: "Chat", icon: <MessagesSquare />, badge: c ? { n: c.mentions || c.unread, hot: c.mentions > 0 } : undefined }} />;
}
