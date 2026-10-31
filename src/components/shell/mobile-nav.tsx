"use client";

// Phones and tablets: a floating glass tab bar at the bottom, like an app.
// The everyday places are tabs (Home, Mail, Chat — whichever this workspace
// has), the middle button makes something new, and More opens everything
// else as a sheet. It steps aside while the on-screen keyboard is up.
import clsx from "clsx";
import { Calculator, CalendarDays, Home, Inbox, LogOut, Mail, MessagesSquare, Monitor, Moon, MoreHorizontal, NotebookPen, PenSquare, Plus, Rocket, Settings, Sparkles, StickyNote, Sun, X, BadgeCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCalMeta } from "@/components/calendar/shared";
import { useChatMeta } from "@/components/chat/shared";
import { useCompose } from "@/components/mail/compose-provider";
import { PageNotes } from "@/components/notes/page-notes";
import { useMailBadge } from "@/components/notify/sounds";
import { visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { setTheme, signOut, useSession, useThemePref, type ThemePref } from "./session-context";

type Badge = { n: number; hot?: boolean } | undefined;
type Tab = { href: string; label: string; icon: LucideIcon; ink: string; match?: (p: string) => boolean; badge?: "mail" | "chat" | "calendar" };

const at = (href: string, p: string) => p === href || p.startsWith(href + "/");
const TABS = {
  home: { href: "/home", label: "Home", icon: Home, ink: "#7c5cdb" },
  work: { href: "/inbox", label: "My work", icon: Inbox, ink: "#7c5cdb" },
  mail: { href: "/mail", label: "Mail", icon: Mail, ink: "#2a86d1", badge: "mail" },
  chat: { href: "/chat", label: "Chat", icon: MessagesSquare, ink: "#7c5cdb", badge: "chat" },
  calendar: { href: "/calendar", label: "Calendar", icon: CalendarDays, ink: "#2a86d1", badge: "calendar" },
  notes: { href: "/notes", label: "Notes", icon: NotebookPen, ink: "#c9871a" },
  hr: { href: "/hr", label: "My HR", icon: BadgeCheck, ink: "#1f9d6c" },
  account: { href: "/settings", label: "Account", icon: Settings, ink: "#7c5cdb", match: (p: string) => p === "/settings" },
} satisfies Record<string, Tab>;

/** Which tabs this person gets: the places they'd open most, from what's switched on. */
function useTabs(): Tab[] {
  const { org } = useSession();
  if (org.role === "employee") return [TABS.work, TABS.hr, TABS.account];
  const on = (m: ModuleId) => visibleTo(org, m);
  const second = on("mail") ? TABS.mail : TABS.work;
  const fourth = on("chat") ? TABS.chat : on("calendar") ? TABS.calendar : second === TABS.work ? TABS.notes : TABS.work;
  return [TABS.home, second, fourth];
}

function useBadge(kind: Tab["badge"]): Badge {
  const { org } = useSession();
  const mail = useMailBadge();
  const chat = useChatMeta(kind === "chat" && visibleTo(org, "chat"));
  const cal = useCalMeta(kind === "calendar" && visibleTo(org, "calendar"));
  if (kind === "mail") {
    const c = mail.data?.counts.all;
    return c ? { n: c.unread, hot: c.overdue > 0 } : undefined;
  }
  if (kind === "chat") {
    const c = chat.data?.counts;
    return c ? { n: c.mentions || c.unread, hot: c.mentions > 0 } : undefined;
  }
  if (kind === "calendar") return cal.data ? { n: cal.data.invites.length + cal.data.notesDue.length, hot: cal.data.invites.length > 0 } : undefined;
  return undefined;
}

const count = (b: Badge) => (b && b.n > 0 ? (b.n > 99 ? "99+" : String(b.n)) : null);

/** Hidden while the on-screen keyboard is open, so it never sits on top of what you're typing. */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      setOpen(typing && window.innerHeight - vv.height > 140);
    };
    vv.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      vv.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);
  return open;
}

function TabLink({ tab, active, onNavigate }: { tab: Tab; active: boolean; onNavigate: () => void }) {
  const badge = useBadge(tab.badge);
  const n = count(badge);
  const Icon = tab.icon;
  return (
    <Link
      href={tab.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={n ? `${tab.label}, ${n} ${badge?.hot ? "need you" : "new"}` : tab.label}
      className={clsx("dock-tab relative flex h-full min-w-0 flex-col items-center justify-center gap-[3px] rounded-[20px]", active && "dock-on")}
      style={{ ["--ink" as string]: tab.ink }}
    >
      <span className="relative">
        <Icon className="size-[21px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
        {n && (
          <span aria-hidden className={clsx("absolute -top-1.5 left-[13px] grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] leading-none font-bold text-white tabular-nums ring-2 ring-[var(--dock-ring)]", badge?.hot ? "bg-red-500" : "bg-sky-500")}>
            {n}
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-[10.5px] leading-none font-medium tracking-[-0.005em]">{tab.label}</span>
    </Link>
  );
}

/** A bottom sheet: slides up, drags down to close, Escape or the backdrop closes it. */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    panel.current?.querySelector<HTMLElement>("[data-autofocus],a,button")?.focus({ preventScroll: true });
    return () => {
      document.documentElement.style.overflow = prev;
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const move = (y: number) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    d.dy = Math.max(0, y - d.y);
    panel.current.style.transform = `translateY(${d.dy}px)`;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!panel.current) return;
    panel.current.style.transition = "transform .25s cubic-bezier(.32,.72,0,1)";
    if (d && d.dy > 90) {
      panel.current.style.transform = "translateY(105%)";
      setTimeout(onClose, 180);
    } else panel.current.style.transform = "";
    setTimeout(() => panel.current && (panel.current.style.transition = ""), 260);
  };
  return createPortal(
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label={label}>
      <div className="sheet-fade absolute inset-0 bg-black/30 backdrop-blur-[3px]" onClick={onClose} />
      <div ref={panel} className="sheet-up dock-glass absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-[26px] pb-[env(safe-area-inset-bottom)]">
        <div
          className="flex shrink-0 touch-none justify-center pt-2.5 pb-1.5"
          onPointerDown={(e) => (drag.current = { y: e.clientY, dy: 0 })}
          onPointerMove={(e) => move(e.clientY)}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="h-[5px] w-10 rounded-full bg-fg/20" aria-hidden />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function SheetHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pb-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[19px] font-semibold tracking-[-0.02em]">{title}</h2>
        {sub && <p className="truncate text-[12.5px] text-muted">{sub}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full bg-fg/[0.06] text-muted active:scale-95">
        <X className="size-4" />
      </button>
    </div>
  );
}

/** A quick-launch tile in the More sheet. */
function AppTile({ href, label, icon: Icon, ink, badge, active, onNavigate }: { href: string; label: string; icon: LucideIcon; ink: string; badge?: Tab["badge"]; active: boolean; onNavigate: () => void }) {
  const b = useBadge(badge);
  const n = badge ? count(b) : null;
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className="group/app flex min-w-0 flex-col items-center gap-1.5 rounded-[16px] py-2 active:scale-[0.96]" style={{ ["--ink" as string]: ink }}>
      <span className={clsx("relative grid size-[52px] place-items-center rounded-[16px] transition-shadow", active ? "app-tile-on" : "app-tile")}>
        <Icon className="size-[22px]" aria-hidden />
        {n && <span className={clsx("absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold text-white tabular-nums ring-2 ring-[var(--dock-ring)]", b?.hot ? "bg-red-500" : "bg-sky-500")}>{n}</span>}
      </span>
      <span className="w-full truncate text-center text-[11.5px] leading-tight font-medium text-fg/80">{label}</span>
    </Link>
  );
}

function ThemeSwitch() {
  const t = useThemePref();
  const opts: [ThemePref, string, LucideIcon][] = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Auto", Monitor]];
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-[14px] bg-fg/[0.05] p-1">
      {opts.map(([id, label, Icon]) => (
        <button key={id} type="button" role="radio" aria-checked={t === id} onClick={() => setTheme(id)} className={clsx("flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-[12.5px] font-medium transition-colors", t === id ? "bg-[var(--surface-solid)] text-fg shadow-sm" : "text-muted")}>
          <Icon className="size-3.5" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}

function MoreSheet({ pathname, nav, org: orgSwitcher, onClose }: { pathname: string; nav: ReactNode; org: ReactNode; onClose: () => void }) {
  const { org, user } = useSession();
  const on = (m: ModuleId) => visibleTo(org, m);
  const apps: Tab[] = org.role === "employee"
    ? []
    : [
        TABS.home,
        TABS.work,
        ...(on("mail") ? [TABS.mail] : []),
        ...(on("calendar") ? [TABS.calendar] : []),
        ...(on("chat") ? [TABS.chat] : []),
        ...(on("copilot") ? [{ href: "/copilot", label: "Copilot", icon: Sparkles, ink: "#7c5cdb" } as Tab] : []),
        TABS.notes,
        { href: "/calculator", label: "Calculator", icon: Calculator, ink: "#2a86d1" } as Tab,
      ];
  return (
    <Sheet label="More" onClose={onClose}>
      <SheetHead title="Everything" sub={`${user.name} · ${org.name}`} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 [scrollbar-width:none]">
        <div className="mx-2 mb-3 rounded-[16px] bg-fg/[0.035] p-1 [&>*]:w-full">{orgSwitcher}</div>
        {apps.length > 0 && (
          <div className="mb-3 grid grid-cols-4 gap-x-1 gap-y-1 px-1">
            {apps.map((a) => (
              <AppTile key={a.href} {...a} active={a.match ? a.match(pathname) : at(a.href, pathname)} onNavigate={onClose} />
            ))}
          </div>
        )}
        <div className="nav-touch mx-1 rounded-[18px] bg-[var(--surface-solid)]/60 py-2 ring-1 ring-fg/[0.05]">{nav}</div>
        <div className="mx-2 mt-4 grid gap-2">
          <ThemeSwitch />
          <button type="button" onClick={() => void signOut()} className="flex h-11 items-center justify-center gap-2 rounded-[14px] text-[13.5px] font-medium text-danger active:bg-danger-soft">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function CreateSheet({ pathname, onClose, onPageNote }: { pathname: string; onClose: () => void; onPageNote: () => void }) {
  const { org } = useSession();
  const router = useRouter();
  const { available: mail, compose } = useCompose();
  const on = (m: ModuleId) => visibleTo(org, m);
  const go = (href: string) => () => (onClose(), router.push(href));
  const items: { label: string; sub: string; icon: LucideIcon; ink: string; run: () => void }[] = [
    ...(mail ? [{ label: "Email", sub: "Write a new message", icon: PenSquare, ink: "#2a86d1", run: () => (onClose(), compose()) }] : []),
    { label: "Note", sub: "Jot something down", icon: NotebookPen, ink: "#c9871a", run: go("/notes?new=1") },
    ...(on("chat") ? [{ label: "Message", sub: "Chat with your team", icon: MessagesSquare, ink: "#7c5cdb", run: go("/chat") }] : []),
    ...(on("calendar") ? [{ label: "Event", sub: "Plan a meeting", icon: CalendarDays, ink: "#1f9d6c", run: go("/calendar") }] : []),
    ...(on("copilot") ? [{ label: "Ask Copilot", sub: "Questions about your business", icon: Sparkles, ink: "#7c5cdb", run: go("/copilot") }] : []),
    { label: "Web app", sub: "Describe it and build", icon: Rocket, ink: "#e8743b", run: go("/create") },
    ...(!pathname.startsWith("/notes") ? [{ label: "Note on this page", sub: "Kept with the page you’re on", icon: StickyNote, ink: "#e5484d", run: () => (onClose(), onPageNote()) }] : []),
  ];
  return (
    <Sheet label="Create" onClose={onClose}>
      <SheetHead title="Create" sub="Start something new" onClose={onClose} />
      <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain px-4 pb-5">
        {items.map((it, i) => (
          <button key={it.label} type="button" onClick={it.run} className="create-card flex min-w-0 flex-col items-start gap-2.5 rounded-[18px] p-3.5 text-left active:scale-[0.97]" style={{ ["--ink" as string]: it.ink, animationDelay: `${i * 30}ms` }}>
            <span className="app-tile grid size-10 shrink-0 place-items-center rounded-[12px]">
              <it.icon className="size-[19px]" aria-hidden />
            </span>
            <span className="w-full min-w-0">
              <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">{it.label}</span>
              <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted">{it.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function MobileNav({ pathname, nav, org: orgSwitcher }: { pathname: string; nav: (close: () => void) => ReactNode; org: ReactNode }) {
  const { org } = useSession();
  const tabs = useTabs();
  const [sheet, setSheet] = useState<"more" | "create" | null>(null);
  const [pageNote, setPageNote] = useState(false);
  const keyboard = useKeyboardOpen();
  const close = () => setSheet(null);
  const activeIdx = tabs.findIndex((t) => (t.match ? t.match(pathname) : at(t.href, pathname)));
  const create = org.role !== "employee";
  // Two tabs, the create button, the rest of the tabs, More.
  const slots: ("create" | "more" | Tab)[] = create ? [...tabs.slice(0, 2), "create" as const, ...tabs.slice(2), "more" as const] : [...tabs, "more" as const];
  return (
    <>
      <nav aria-label="Tabs" data-hidden={keyboard || undefined} className="app-dock fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(10px,env(safe-area-inset-bottom))] lg:hidden">
        <div className="dock-glass mx-auto grid h-[62px] max-w-[520px] items-stretch gap-0.5 rounded-[26px] p-[5px]" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
          {slots.map((s) =>
            s === "create" ? (
              <div key="create" className="grid place-items-center">
                <button type="button" onClick={() => setSheet("create")} aria-label="Create" aria-haspopup="dialog" aria-expanded={sheet === "create"} className="dock-plus grid size-[46px] place-items-center rounded-[17px] active:scale-90">
                  <Plus className={clsx("size-[22px] transition-transform duration-300", sheet === "create" && "rotate-45")} strokeWidth={2.4} />
                </button>
              </div>
            ) : s === "more" ? (
              <button key="more" type="button" onClick={() => setSheet("more")} aria-label="More" aria-haspopup="dialog" aria-expanded={sheet === "more"} className={clsx("dock-tab flex h-full min-w-0 flex-col items-center justify-center gap-[3px] rounded-[20px]", (activeIdx < 0 || sheet === "more") && "dock-on")} style={{ ["--ink" as string]: "#7c5cdb" }}>
                <MoreHorizontal className="size-[21px]" aria-hidden />
                <span className="text-[10.5px] leading-none font-medium">More</span>
              </button>
            ) : (
              <TabLink key={s.href} tab={s} active={sheet === null && tabs.indexOf(s) === activeIdx} onNavigate={close} />
            ),
          )}
        </div>
      </nav>
      {sheet === "more" && <MoreSheet pathname={pathname} nav={nav(close)} org={orgSwitcher} onClose={close} />}
      {sheet === "create" && <CreateSheet pathname={pathname} onClose={close} onPageNote={() => setPageNote(true)} />}
      {pageNote && <PageNotes path={pathname} onClose={() => setPageNote(false)} />}
    </>
  );
}
