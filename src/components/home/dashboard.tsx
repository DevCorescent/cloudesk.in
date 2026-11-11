"use client";

// Home: one calm screen. The day in a line and your plan; one row of key
// numbers (each opens its figures, with what needs attention and what's
// waiting); then three panels — quick actions (most used first), your day
// (mail, meetings, chat, work, notes in a line each) and your web apps — only
// for the features this workspace uses and this person may see. Panels can be
// reordered and hidden; the layout is saved per person.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlertTriangle, AppWindow, ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, BadgeIndianRupee, Bell, Boxes, ChartColumn, CheckCircle2, ChevronRight, Clock, Contact, Eye, EyeOff, GripVertical,
  Calculator, CalendarDays, HandCoins, Handshake, Plus, History, Inbox, Info, KanbanSquare, Landmark, Mail, MessagesSquare, NotebookPen, LifeBuoy, Maximize2, Minus, ReceiptText, RefreshCw, Rocket, Send, Settings2, ShoppingBag, ShoppingCart, Sparkles, Stethoscope, Target, TrendingUp, Trophy, User, Users, Wallet, Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChartView, type Result } from "@/components/bi/chart";
import { PlanStrip } from "@/components/billing/status";
import { useCountUp, useDesk, type DeskData } from "@/components/home/desk";
import { AppTile, openCreate, TABS } from "@/components/shell/mobile-nav";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, ButtonLink, ErrorState, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import type { ProjectSummary } from "@/lib/client/types";
import { visibleTo } from "@/lib/workspace/modules";

type Kpi = { id: string; module: string; label: string; value: number; format: "money" | "number" | "hours" | "percent"; sub?: string; change?: number | null; good?: "up" | "down"; href: string };
type Insight = { id: string; module: string; tone: "danger" | "warning" | "info" | "success"; title: string; detail: string; href: string };
type ChartBlock = { id: string; module: string; title: string; sub: string; kind: "bar" | "line" | "area"; result: Result; href: string };
type Work = { id: string; source: string; title: string; detail: string; link: string; due: string | null; overdue: boolean };
type Dash = {
  generatedAt: string;
  layout: { order: string[]; hidden: string[] };
  kpis: Kpi[];
  charts: ChartBlock[];
  insights: Insight[];
  waiting: { approvals: { id: string; label: string; link: string; overdue?: boolean; kindLabel?: string }[]; todo: Work[]; counts: { approvals: number; todo: number; overdue: number } } | null;
  activity: { id: string; what: string; who: string; at: string }[];
  quick: { id: string; label: string; href: string; icon: string; mostUsed: boolean }[];
  webApps: number;
};

// "summary" is the stat board: key numbers, what needs attention, what's
// waiting, trends and activity, each behind a button.
const SECTIONS = ["summary", "actions", "desk", "webapps"] as const;
type SectionId = (typeof SECTIONS)[number];
const SECTION: Record<SectionId, { title: string; wide: boolean }> = {
  summary: { title: "At a glance", wide: true },
  // The panels sit three across on wide screens, so Home fits on one screen.
  actions: { title: "Quick actions", wide: false },
  desk: { title: "Your day", wide: false },
  webapps: { title: "Web apps", wide: false },
};

const ICONS: Record<string, React.ReactNode> = {
  receipt: <ReceiptText />, wallet: <Wallet />, handshake: <Handshake />, contact: <Contact />, cart: <ShoppingCart />, boxes: <Boxes />, user: <User />, rupee: <BadgeIndianRupee />, clock: <Clock />,
  kanban: <KanbanSquare />, lifebuoy: <LifeBuoy />, send: <Send />, chart: <ChartColumn />, stethoscope: <Stethoscope />, wrench: <Wrench />, sparkles: <Sparkles />, app: <AppWindow />, users: <Users />,
};

const money = (p: number) => {
  const r = p / 100;
  const a = Math.abs(r);
  if (a >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const show = (k: Pick<Kpi, "format">, v: number) => (k.format === "money" ? money(v) : k.format === "hours" ? `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}h` : k.format === "percent" ? `${v}%` : Math.round(v).toLocaleString("en-IN"));

export function Dashboard() {
  const { org, user } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["dashboard", org.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Dash>(`/api/v1/orgs/${org.id}/dashboard`), refetchInterval: 120_000 });
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<{ order: SectionId[]; hidden: SectionId[] } | null>(null);
  const saved = q.data?.layout;
  const current = layout ?? (saved && { order: saved.order.filter(isSection), hidden: saved.hidden.filter(isSection) }) ?? { order: [], hidden: [] };
  // Sections added since the layout was saved go in at their usual place.
  const order = useMemo(() => {
    const o: SectionId[] = [...current.order];
    SECTIONS.forEach((s, i) => {
      if (!o.includes(s)) o.splice(i === 0 ? 0 : o.indexOf(SECTIONS[i - 1]!) + 1, 0, s);
    });
    return o;
  }, [current.order]);
  const desk = useDesk(org.id);
  const save = useMutation({
    mutationFn: (l: { order: SectionId[]; hidden: SectionId[] }) => api(`/api/v1/orgs/${org.id}/dashboard/layout`, { method: "PUT", body: l }),
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const apply = (l: { order: SectionId[]; hidden: SectionId[] }) => {
    setLayout(l);
    save.mutate(l);
  };
  const move = (id: SectionId, d: -1 | 1) => {
    const o = [...order];
    const i = o.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j]!, o[i]!];
    apply({ order: o, hidden: current.hidden });
  };
  const toggleHidden = (id: SectionId) => apply({ order, hidden: current.hidden.includes(id) ? current.hidden.filter((x) => x !== id) : [...current.hidden, id] });
  const [drag, setDrag] = useState<SectionId | null>(null);
  const dropOn = (target: SectionId) => {
    if (!drag || drag === target) return;
    const o = order.filter((x) => x !== drag);
    o.splice(o.indexOf(target), 0, drag);
    apply({ order: o, hidden: current.hidden });
    setDrag(null);
  };

  const hour = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const d = q.data;
  const urgent = d ? d.insights.filter((i) => i.tone === "danger" || i.tone === "warning").length : 0;
  const notes = d?.insights.length ?? 0;
  const waitingCount = d?.waiting ? d.waiting.counts.approvals + d.waiting.counts.todo : 0;
  const owed = d?.kpis.find((k) => k.id === "owed");
  const lines = d
    ? [
        notes ? `${notes} thing${notes === 1 ? "" : "s"} need${notes === 1 ? "s" : ""} attention` : "nothing needs attention",
        waitingCount ? `${waitingCount} waiting on you` : null,
        owed && owed.value > 0 ? `${money(owed.value)} owed to you` : null,
      ].filter(Boolean)
    : [];

  const visible = order.filter((s) => editing || !current.hidden.includes(s));
  return (
    <div className="dash mx-auto max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8">
      <PhoneHome d={d} desk={desk.data} greeting={`${greeting}, ${user.name.split(" ")[0]}`} status={lines[0] ?? ""} tone={urgent ? "danger" : notes ? "accent" : "ok"} fetching={q.isFetching} onRefresh={() => void Promise.all([q.refetch(), desk.refetch()])} />
      <div className="max-sm:hidden">
      <header className="mb-5 flex items-start justify-between gap-3 sm:mb-6 sm:flex-wrap sm:items-end sm:gap-4">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</p>
          <h1 className="mt-0.5 text-[23px] leading-tight font-semibold tracking-[-0.025em] sm:text-[26px]">
            {greeting}, {user.name.split(" ")[0]}
          </h1>
          {d ? (
            <p className="mt-1 hidden flex-wrap items-center gap-x-2 text-[13.5px] text-muted sm:flex">
              <span className={clsx("inline-block size-2 rounded-full", urgent ? "bg-[#e5484d]" : notes ? "bg-[#2a86d1]" : "bg-[#1f9d6c]")} aria-hidden />
              {lines.join(" · ")}
            </p>
          ) : (
            <Skeleton className="mt-2 h-4 w-72 max-sm:w-48" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="hidden w-[290px] lg:block">
            <PlanStrip />
          </div>
          <Link href="/ai" className="ai-entry inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[12.5px] font-medium">
            <Sparkles className="ai-entry-ic size-3.5" aria-hidden /> Ask AI
          </Link>
          <Button size="sm" variant="ghost" aria-label="Refresh" icon={<RefreshCw className={clsx("size-3.5", q.isFetching && "animate-spin")} />} onClick={() => q.refetch()} />
          <Button size="sm" variant={editing ? "primary" : "secondary"} aria-label={editing ? "Done" : "Customise"} icon={editing ? <CheckCircle2 className="size-3.5" /> : <Settings2 className="size-3.5" />} onClick={() => setEditing(!editing)} className="max-sm:!w-8 max-sm:!px-0">
            <span className="max-sm:hidden">{editing ? "Done" : "Customise"}</span>
          </Button>
        </div>
      </header>
      {/* Phones: the summary as compact chips, full width under the greeting. */}
      {d && (
        <div className="-mx-4 -mt-2 mb-5 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:hidden">
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[var(--surface-solid)] px-2.5 text-[12.5px] font-medium whitespace-nowrap ring-1 ring-border/70">
            <span className={clsx("size-1.5 rounded-full", urgent ? "bg-[#e5484d]" : notes ? "bg-[#2a86d1]" : "bg-[#1f9d6c]")} aria-hidden />
            {notes ? `${notes} need attention` : "All clear"}
          </span>
          {waitingCount > 0 && <span className="inline-flex h-7 shrink-0 items-center rounded-full whitespace-nowrap bg-[var(--surface-solid)] px-2.5 text-[12.5px] font-medium ring-1 ring-border/70">{waitingCount} waiting</span>}
          {owed && owed.value > 0 && <span className="inline-flex h-7 shrink-0 items-center rounded-full whitespace-nowrap bg-[var(--surface-solid)] px-2.5 text-[12.5px] font-medium tabular-nums ring-1 ring-border/70">{money(owed.value)} owed</span>}
        </div>
      )}

      <div className="mb-4 lg:hidden">{!editing && <PlanStrip />}</div>

      {editing && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-dashed border-border bg-surface px-4 py-3 text-[13px]">
          <span className="text-muted">Drag sections by the handle (or use the arrows) to reorder; the eye hides or shows one. Saved for you on every device.</span>
          <Button size="sm" variant="ghost" onClick={() => apply({ order: [...SECTIONS], hidden: [] })}>Reset layout</Button>
        </div>
      )}

      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="dash-grid grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((id, i) => {
            const hidden = current.hidden.includes(id);
            const body = id === "desk" ? (desk.data ? <Today d={desk.data} /> : <Skeleton className="h-60 rounded-[18px]" />) : d ? <SectionBody id={id} d={d} /> : <Skeleton className={clsx("rounded-[18px]", id === "summary" ? "h-20" : "h-60")} />;
            if (!editing && id !== "desk" && d && isEmpty(id, d)) return null;
            return (
              <section
                key={id}
                aria-label={SECTION[id].title}
                className={clsx("dash-in min-w-0", SECTION[id].wide && "md:col-span-2", id === "desk" && !editing && "md:row-span-2", editing && "rounded-[22px] ring-1 ring-border ring-offset-4 ring-offset-bg transition-opacity", editing && hidden && "opacity-45", drag === id && "opacity-50")}
                style={{ animationDelay: `${i * 45}ms` }}
                draggable={editing}
                onDragStart={() => setDrag(id)}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => editing && e.preventDefault()}
                onDrop={() => dropOn(id)}
              >
                {editing && (
                  <div className="mb-2 flex items-center gap-2 text-[12.5px]">
                    <GripVertical className="size-4 cursor-grab text-subtle" aria-hidden />
                    <b className="flex-1 font-medium">{SECTION[id].title}</b>
                    <button type="button" aria-label={`Move ${SECTION[id].title} up`} onClick={() => move(id, -1)} className="grid size-7 place-items-center rounded-full hover:bg-surface-2"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label={`Move ${SECTION[id].title} down`} onClick={() => move(id, 1)} className="grid size-7 place-items-center rounded-full hover:bg-surface-2"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label={`${hidden ? "Show" : "Hide"} ${SECTION[id].title}`} aria-pressed={!hidden} onClick={() => toggleHidden(id)} className="grid size-7 place-items-center rounded-full hover:bg-surface-2">{hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
                  </div>
                )}
                {body}
              </section>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

// ─── Phones ──────────────────────────────────────────────────────────────────
// Home on a phone is one screen, like an app's: the day in a line, your plan,
// four numbers, your apps and the actions you use most. Everything else is a
// tap away (each number opens its page; the full board is on larger screens).

type Cell = { label: string; value: string; sub: string; href?: string; hot?: boolean };

function PhoneHome({ d, desk, greeting, status, tone, fetching, onRefresh }: { d?: Dash; desk?: DeskData; greeting: string; status: string; tone: "danger" | "accent" | "ok"; fetching: boolean; onRefresh: () => void }) {
  const { org } = useSession();
  const router = useRouter();
  const on = (m: Parameters<typeof visibleTo>[1]) => visibleTo(org, m);
  const canCreate = org.role !== "employee";
  // Mail, AI and Chat are in the tab bar already; one row of the rest.
  const apps = [
    ...(on("calendar") ? [TABS.calendar] : []),
    TABS.work,
    TABS.notes,
    { href: "/projects", label: "Web apps", icon: AppWindow, ink: "#e8743b" },
    { href: "/calculator", label: "Calculator", icon: Calculator, ink: "#2a86d1" },
  ].slice(0, 4);

  const cells: Cell[] = [];
  if (d) {
    const n = d.insights.length;
    cells.push({ label: "Needs attention", value: String(n), sub: n ? d.insights[0]!.title : "All clear", href: d.insights[0]?.href, hot: d.insights.some((i) => i.tone === "danger" || i.tone === "warning") });
    if (d.waiting) {
      const c = d.waiting.counts;
      cells.push({ label: "Waiting on you", value: String(c.approvals + c.todo), sub: c.overdue ? `${c.overdue} overdue` : c.approvals + c.todo ? `${c.approvals} approvals · ${c.todo} tasks` : "Nothing pending", href: "/inbox", hot: c.overdue > 0 });
    }
    for (const k of d.kpis.slice(0, 2)) cells.push({ label: k.label, value: show(k, k.value), sub: k.sub ?? modOf(k.module).label, href: k.href });
    if (desk?.mail) cells.push({ label: "Unread mail", value: String(desk.mail.unread), sub: desk.mail.needsReply ? `${desk.mail.needsReply} to answer` : "Inbox", href: "/mail" });
    if (desk?.calendar) cells.push({ label: "Meetings today", value: String(desk.calendar.today), sub: desk.calendar.invites ? `${desk.calendar.invites} invite${desk.calendar.invites === 1 ? "" : "s"} to answer` : "Calendar", href: "/calendar" });
    if (desk?.chat) cells.push({ label: "Chat", value: String(desk.chat.mentions || desk.chat.unread), sub: desk.chat.mentions ? "mentions" : "unread", href: "/chat" });
  }
  const shown = cells.slice(0, 4);
  const quick = (d?.quick ?? []).slice(0, 4);
  const go = (x: Dash["quick"][number]) => {
    void api(`/api/v1/orgs/${org.id}/dashboard/used`, { method: "POST", body: { id: x.id } }).catch(() => null);
    router.push(x.href);
  };

  return (
    <div className="phone-home -mt-1 flex flex-col gap-3 sm:hidden">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</p>
          <h1 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.025em]">{greeting}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
            <span className={clsx("size-1.5 shrink-0 rounded-full", !d ? "bg-subtle" : tone === "danger" ? "bg-[#e5484d]" : tone === "accent" ? "bg-[#2a86d1]" : "bg-[#1f9d6c]")} aria-hidden />
            {d ? status.charAt(0).toUpperCase() + status.slice(1) : "Checking…"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Phones: AI is the middle tab; "New" (the create sheet) sits here instead. */}
          {canCreate && (
            <button type="button" onClick={openCreate} aria-label="New" aria-haspopup="dialog" className="phone-card inline-flex h-9 items-center gap-1 rounded-full pr-3.5 pl-2.5 text-[13px] font-medium active:scale-95">
              <Plus className="size-4" strokeWidth={2.2} aria-hidden /> New
            </button>
          )}
          <button type="button" aria-label="Refresh" onClick={onRefresh} className="phone-card grid size-9 shrink-0 place-items-center rounded-full text-muted active:scale-95">
            <RefreshCw className={clsx("size-4", fetching && "animate-spin")} />
          </button>
        </div>
      </header>

      <PlanStrip />

      {d ? (
        <div className="phone-card grid grid-cols-2 overflow-hidden rounded-[18px]">
          {shown.map((c, i) => {
            const inner = (
              <>
                <span className="flex items-center justify-between gap-1 text-[11.5px] font-medium text-muted">
                  <span className="truncate">{c.label}</span>
                  {c.href && <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />}
                </span>
                <span className={clsx("mt-1 block truncate text-[21px] leading-none font-semibold tracking-[-0.02em] tabular-nums", c.hot && "text-danger")}>{c.value}</span>
                <span className="mt-1.5 block truncate text-[11.5px] text-muted">{c.sub}</span>
              </>
            );
            const cls = clsx("block min-w-0 px-3.5 py-3", i % 2 === 1 && "border-l border-border", i >= 2 && "border-t border-border");
            return c.href ? <Link key={c.label} href={c.href} className={clsx(cls, "active:bg-surface-2")}>{inner}</Link> : <div key={c.label} className={cls}>{inner}</div>;
          })}
        </div>
      ) : (
        <Skeleton className="h-[150px] rounded-[18px]" />
      )}

      <nav aria-label="Apps" className="phone-card grid grid-cols-4 gap-y-0.5 rounded-[18px] px-1 py-1.5">
        {apps.map((a) => <AppTile key={a.href} {...a} active={false} onNavigate={() => undefined} />)}
      </nav>

      {quick.length > 0 && (
        <section aria-label="Quick actions">
          <h2 className="mb-1.5 px-1 text-[11.5px] font-semibold tracking-[0.04em] text-muted uppercase">Quick actions</h2>
          <div className="grid grid-cols-2 gap-2">
            {quick.map((x) => (
              <button key={x.id} type="button" onClick={() => go(x)} className="phone-card flex h-11 min-w-0 items-center gap-2 rounded-[14px] px-2.5 text-left text-[13px] font-medium active:scale-[0.98]">
                <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-surface-2 text-fg/75 [&_svg]:size-[15px]">{ICONS[x.icon] ?? <Sparkles />}</span>
                <span className="truncate">{x.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const isSection = (s: string): s is SectionId => (SECTIONS as readonly string[]).includes(s);

function isEmpty(id: SectionId, d: Dash) {
  if (id === "summary") return !d.kpis.length && !d.charts.length && !d.waiting && !d.activity.length && !d.insights.length;
  return false;
}

function SectionBody({ id, d }: { id: Exclude<SectionId, "desk">; d: Dash }) {
  switch (id) {
    case "summary":
      return <Glance d={d} />;
    case "actions":
      return <QuickActions quick={d.quick} />;
    case "webapps":
      return <WebApps />;
  }
}

// ─── At a glance ─────────────────────────────────────────────────────────────
// Every stat is a button; its figures open in a pop-up (a sheet on phones)
// only when you pick it, so Home stays calm until you ask.

type Tint = "lavender" | "sky" | "mint" | "peach" | "butter" | "rose";
const MODULE: Record<string, { label: string; icon: React.ReactNode; tint: Tint }> = {
  invoicing: { label: "Invoicing", icon: <ReceiptText />, tint: "sky" },
  accounting: { label: "Accounts", icon: <Landmark />, tint: "mint" },
  crm: { label: "Sales pipeline", icon: <Handshake />, tint: "lavender" },
  store: { label: "Shop", icon: <ShoppingBag />, tint: "peach" },
  sales: { label: "Orders", icon: <ShoppingCart />, tint: "mint" },
  helpdesk: { label: "Helpdesk", icon: <LifeBuoy />, tint: "rose" },
  hr: { label: "People", icon: <Users />, tint: "butter" },
  inventory: { label: "Stock", icon: <Boxes />, tint: "peach" },
  work: { label: "Projects", icon: <Clock />, tint: "sky" },
  clinic: { label: "Clinic", icon: <Stethoscope />, tint: "rose" },
  maintenance: { label: "Maintenance", icon: <Wrench />, tint: "butter" },
};
const KPI_ICON: Record<string, React.ReactNode> = {
  cash: <Landmark />, profit: <TrendingUp />, payable: <Wallet />, invoiced: <ReceiptText />, owed: <HandCoins />, pipeline: <Target />, won: <Trophy />, hours: <Clock />,
};
const modOf = (m: string) => MODULE[m] ?? { label: m.charAt(0).toUpperCase() + m.slice(1), icon: <Sparkles />, tint: "lavender" as Tint };

type Stat = { id: string; label: string; value?: string; hint: string; icon: React.ReactNode; tint: Tint; dot?: "danger" | "accent"; title: string; href?: string; link?: string; wide?: boolean; body: React.ReactNode };

function Glance({ d }: { d: Dash }) {
  const [sel, setSel] = useState<string | null>(null);
  const urgent = d.insights.some((i) => i.tone === "danger" || i.tone === "warning");
  const waitingN = d.waiting ? d.waiting.counts.approvals + d.waiting.counts.todo : 0;
  const stats: Stat[] = [
    ...d.kpis.map((k): Stat => {
      const m = modOf(k.module);
      return { id: `kpi:${k.id}`, label: k.label, value: show(k, k.value), hint: k.sub ?? m.label, icon: KPI_ICON[k.id] ?? m.icon, tint: m.tint, title: k.label, href: k.href, link: `Open ${m.label.toLowerCase()}`, wide: d.charts.some((c) => c.module === k.module), body: <KpiDetail k={k} d={d} /> };
    }),
    { id: "attention", label: "Needs attention", value: String(d.insights.length), hint: d.insights.length ? `${urgent ? "Urgent" : "Notes"} for you` : "All clear", icon: <AlertTriangle />, tint: "rose", dot: urgent ? "danger" : d.insights.length ? "accent" : undefined, title: "Needs attention", body: <Attention insights={d.insights} /> },
    ...(d.waiting ? [{ id: "waiting", label: "Waiting on you", value: String(waitingN), hint: waitingN ? "Approvals and tasks" : "Nothing pending", icon: <Inbox />, tint: "butter", dot: waitingN ? "accent" : undefined, title: "Waiting on you", href: "/inbox", link: "My work", body: <Waiting w={d.waiting} /> } satisfies Stat] : []),
    ...(d.charts.length ? [{ id: "charts", label: "Trends", value: String(d.charts.length), hint: `chart${d.charts.length === 1 ? "" : "s"} to explore`, icon: <ChartColumn />, tint: "sky", title: "Trends", wide: true, body: <Charts charts={d.charts} /> } satisfies Stat] : []),
    ...(d.activity.length ? [{ id: "activity", label: "Recent activity", hint: "Who did what", icon: <History />, tint: "lavender", title: "Recent activity", href: "/settings/audit", link: "Audit log", body: <Activity rows={d.activity} /> } satisfies Stat] : []),
  ];
  const open = stats.find((x) => x.id === sel) ?? null;
  // Phones list the stats in groups: each area's numbers together, then your work.
  const groups: [string, Stat[]][] = [];
  for (const x of stats) {
    const g = x.id.startsWith("kpi:") ? modOf(d.kpis.find((k) => `kpi:${k.id}` === x.id)!.module).label : "Your work";
    const at = groups.find(([name]) => name === g);
    if (at) at[1].push(x);
    else groups.push([g, [x]]);
  }
  return (
    <div>
      {/* Phones: sorted into groups, as list rows. */}
      <div className="grid gap-4 sm:hidden">
        {groups.map(([group, items]) => (
          <div key={group}>
            <p className="mb-1.5 px-1 text-[12px] font-semibold tracking-[0.04em] text-muted uppercase">{group}</p>
            <div className="stat-list overflow-hidden rounded-[16px]">
              {items.map((x) => (
                <button key={x.id} type="button" aria-haspopup="dialog" aria-expanded={sel === x.id} onClick={() => setSel(x.id)} className={clsx("stat-row flex h-[54px] w-full items-center gap-3 px-3.5 text-left", `tint-${x.tint}`)}>
                  <span className="stat-chip !size-8 !rounded-[10px]">{x.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{x.label}</span>
                  {x.dot && <span aria-label={x.dot === "danger" ? "Needs a look" : "Has items"} className={clsx("size-2 shrink-0 rounded-full", x.dot === "danger" ? "bg-danger" : "bg-[var(--tint-lavender-ink)]")} />}
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div role="group" aria-label="Key numbers" className="stat-row-grid hidden gap-2 sm:grid">
        {stats.map((x) => (
          <button key={x.id} type="button" aria-haspopup="dialog" aria-expanded={sel === x.id} onClick={() => setSel(x.id)} className={clsx("stat-btn group", `tint-${x.tint}`)} title={x.hint}>
            <span className="stat-chip">{x.icon}</span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[12px] font-medium text-muted">{x.label}</span>
              {x.value !== undefined && <span className="mt-0.5 block truncate text-[18px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{x.value}</span>}
              <span className="mt-0.5 block truncate text-[11.5px] text-subtle">{x.hint}</span>
            </span>
            {x.dot && <span aria-label={x.dot === "danger" ? "Needs a look" : "Has items"} className={clsx("absolute top-2.5 right-2.5 size-[7px] rounded-full", x.dot === "danger" ? "bg-danger" : "bg-[var(--tint-lavender-ink)]")} />}
            <Maximize2 className="stat-caret" aria-hidden />
          </button>
        ))}
      </div>
      <Dialog
        open={!!open}
        onClose={() => setSel(null)}
        title={open?.title ?? ""}
        description={open?.hint}
        icon={open && <span className="stat-chip mt-0.5">{open.icon}</span>}
        size={open?.wide ? "xl" : "lg"}
        className={clsx("stat-pop", open && `tint-${open.tint}`)}
        footer={
          open?.href && (
            <ButtonLink href={open.href} variant="primary" icon={<ArrowUpRight className="size-3.5" />} onClick={() => setSel(null)}>
              {open.link ?? "Open"}
            </ButtonLink>
          )
        }
      >
        {open && <div key={open.id} className="stat-pop-body">{open.body}</div>}
      </Dialog>
    </div>
  );
}

function KpiDetail({ k, d }: { k: Kpi; d: Dash }) {
  const v = useCountUp(k.value);
  const c = k.change;
  const better = c == null || c === 0 ? null : (c > 0) === (k.good !== "down");
  const chart = d.charts.find((x) => x.module === k.module);
  const notes = d.insights.filter((i) => i.module === k.module);
  const siblings = d.kpis.filter((x) => x.module === k.module && x.id !== k.id);
  return (
    <div className={clsx("grid gap-5", chart && "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]")}>
      <div className={clsx("min-w-0", !chart && "max-w-xl")}>
        <p className="text-[34px] leading-none font-semibold tracking-[-0.035em] tabular-nums sm:text-[40px]">{show(k, v)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          {c != null && (
            <span className={clsx("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-medium tabular-nums", better === null ? "bg-surface-2 text-muted" : better ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              {c > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : c < 0 ? <ArrowDownRight className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
              {c > 0 ? "+" : ""}
              {c}%<span className="sr-only">{better === null ? "" : better ? " (better)" : " (worse)"}</span>
            </span>
          )}
          {k.sub && <span className="text-muted">{k.sub}</span>}
        </div>
        {!!siblings.length && (
          <dl className="mt-5 grid gap-px overflow-hidden rounded-[14px] bg-border/70">
            {siblings.map((x) => (
              <div key={x.id} className="flex items-baseline justify-between gap-3 bg-surface-solid px-3.5 py-2.5 text-[13px]">
                <dt className="truncate text-muted">{x.label}</dt>
                <dd className="font-semibold tabular-nums">{show(x, x.value)}</dd>
              </div>
            ))}
          </dl>
        )}
        <Link
          href={`/ai?q=${encodeURIComponent(`Explain my ${k.label.toLowerCase()}${k.sub ? ` (${k.sub})` : ""}: it's ${show(k, k.value)}${c != null ? `, ${c > 0 ? "up" : c < 0 ? "down" : "flat"}${c ? ` ${Math.abs(c)}%` : ""} on the previous period` : ""}. What's driving it? Show the trend as a chart, and tell me what I should do about it.`)}`}
          className="ai-entry mt-4 inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[12.5px] font-medium"
        >
          <Sparkles className="ai-entry-ic size-3.5" aria-hidden /> Ask AI about this
        </Link>
        {!!notes.length && (
          <ul className="mt-4 grid gap-1.5">
            {notes.slice(0, 3).map((i) => (
              <li key={i.id}>
                <Link href={i.href} className="flex items-start gap-2 rounded-[12px] px-2 py-1.5 text-[12.5px] transition-colors hover:bg-surface-2">
                  <span className={clsx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] [&_svg]:size-3", TONE[i.tone].cls)}>{TONE[i.tone].icon}</span>
                  <span className="min-w-0"><b className="font-medium">{i.title}</b> <span className="text-muted">— {i.detail}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {chart && (
        <div className="min-w-0 rounded-[16px] bg-surface-solid/80 p-3 ring-1 ring-border/70 sm:p-4">
          <p className="text-[13px] font-semibold">{chart.title}</p>
          <p className="mb-2 text-[12px] text-muted">{chart.sub}</p>
          <ChartView r={chart.result} kind={chart.kind} />
        </div>
      )}
    </div>
  );
}

// ─── Quick actions ───────────────────────────────────────────────────────────

function QuickActions({ quick }: { quick: Dash["quick"] }) {
  const { org } = useSession();
  const router = useRouter();
  const go = (q: Dash["quick"][number]) => {
    void api(`/api/v1/orgs/${org.id}/dashboard/used`, { method: "POST", body: { id: q.id } }).catch(() => null);
    router.push(q.href);
  };
  return (
    <Panel title="Quick actions">
      <ul className="grid grid-cols-2 gap-1.5">
        {quick.slice(0, 6).map((q) => (
          <li key={q.id} className="min-w-0">
            <button type="button" onClick={() => go(q)} className="dash-action group">
              <span className="dash-ic">{ICONS[q.icon] ?? <Sparkles />}</span>
              <span className="min-w-0 flex-1 text-left">{q.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** A home panel: a title (with an optional link) over its rows, all the same height. */
function Panel({ title, href, link, children }: { title: string; href?: string; link?: string; children: React.ReactNode }) {
  return (
    <div className="dash-panel flex h-full flex-col">
      <div className="dash-panel-h">
        <h2>{title}</h2>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
            {link ?? "Open"} <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

// ─── Your day ────────────────────────────────────────────────────────────────
// Mail, meetings, chat, your work and notes: a line each, the count that
// matters and the next thing, one click to open.

function Today({ d }: { d: DeskData }) {
  // The desk lists today's remaining events in order, so the first timed one is next.
  const next = d.calendar?.events.find((e) => !e.allDay);
  const rows: { key: string; icon: React.ReactNode; label: string; sub: string; href: string; hot?: boolean }[] = [];
  if (d.mail) rows.push({ key: "mail", icon: <Mail />, label: d.mail.unread ? `${d.mail.unread} unread email${d.mail.unread === 1 ? "" : "s"}` : "Inbox clear", sub: d.mail.needsReply ? `${d.mail.needsReply} waiting for your reply` : "Nothing waiting for a reply", href: "/mail", hot: d.mail.overdue > 0 });
  if (d.calendar) rows.push({ key: "cal", icon: <CalendarDays />, label: d.calendar.today ? `${d.calendar.today} meeting${d.calendar.today === 1 ? "" : "s"} today` : "No meetings today", sub: next ? `Next: ${next.title} · ${new Date(next.start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : d.calendar.invites ? `${d.calendar.invites} invite${d.calendar.invites === 1 ? "" : "s"} to answer` : "Your calendar is free", href: "/calendar" });
  if (d.work) rows.push({ key: "work", icon: <Inbox />, label: `${d.work.approvals + d.work.todo} to do`, sub: d.work.overdue ? `${d.work.overdue} overdue` : d.work.items[0]?.title ?? "Approvals and tasks", href: "/inbox", hot: d.work.overdue > 0 });
  if (d.chat) rows.push({ key: "chat", icon: <MessagesSquare />, label: d.chat.mentions ? `${d.chat.mentions} mention${d.chat.mentions === 1 ? "" : "s"}` : `${d.chat.unread} unread in chat`, sub: d.chat.channels[0] ? `${d.chat.channels[0].kind === "dm" ? "" : "#"}${d.chat.channels[0].name}` : "Team chat", href: "/chat" });
  if (d.notes) rows.push({ key: "notes", icon: <NotebookPen />, label: d.notes.reminders ? `${d.notes.reminders} reminder${d.notes.reminders === 1 ? "" : "s"}` : d.notes.pinned ? `${d.notes.pinned} pinned note${d.notes.pinned === 1 ? "" : "s"}` : "Recent notes", sub: d.notes.items[0]?.title || "Notes", href: "/notes" });
  return (
    <Panel title="Your day">
      {rows.length ? (
        <ul className="grid gap-0.5">
          {rows.slice(0, 6).map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="dash-row group">
                <span className="dash-ic">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className={clsx("block", r.hot && "text-danger")}>{r.label}</span>
                  <span className="block text-[12px] font-normal text-muted">{r.sub}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-empty">Mail, meetings, chat and your tasks appear here as you use them.</p>
      )}
      <Link href="/ai" className="dash-plan">
        <Sparkles className="size-3.5" aria-hidden />
        <span className="flex-1">Plan my day with AI</span>
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </Panel>
  );
}

// ─── Needs attention ─────────────────────────────────────────────────────────

const TONE = {
  danger: { icon: <AlertTriangle />, cls: "bg-danger-soft text-danger", label: "Urgent" },
  warning: { icon: <Bell />, cls: "bg-warning-soft text-warning", label: "Soon" },
  info: { icon: <Info />, cls: "bg-accent-soft text-accent", label: "Note" },
  success: { icon: <CheckCircle2 />, cls: "bg-success-soft text-success", label: "Good" },
} as const;

function Attention({ insights }: { insights: Insight[] }) {
  if (!insights.length)
    return (
      <div className="grid place-items-center gap-2 py-6 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-5" /></span>
        <p className="text-[13.5px] font-medium">All clear</p>
        <p className="max-w-xs text-[12.5px] text-muted">Nothing overdue, late or running low in the features you use.</p>
      </div>
    );
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {insights.slice(0, 8).map((i) => (
        <li key={i.id} className="min-w-0">
          <Link href={i.href} className="group flex h-full items-start gap-3 rounded-[14px] bg-surface-solid/80 p-3 ring-1 ring-border/60 transition-colors hover:ring-fg/15">
            <span className={clsx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] [&_svg]:size-4", TONE[i.tone].cls)} aria-label={TONE[i.tone].label}>{TONE[i.tone].icon}</span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] leading-snug font-medium">{i.title}</b>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{i.detail}</span>
            </span>
            <ArrowRight className="mt-1 size-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── Waiting on you ──────────────────────────────────────────────────────────

function Waiting({ w }: { w: NonNullable<Dash["waiting"]> }) {
  const items = [
    ...w.approvals.map((a) => ({ id: a.id, source: a.kindLabel ?? "Approval", title: a.label, detail: "Waiting for your decision", link: a.link || "/inbox", overdue: !!a.overdue })),
    ...w.todo.map((t) => ({ id: t.id, source: t.source, title: t.title, detail: t.detail || (t.due ? `Due ${timeAgo(t.due)}` : ""), link: t.link, overdue: t.overdue })),
  ].slice(0, 8);
  if (!items.length)
    return (
      <div className="grid place-items-center gap-2 py-6 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted"><CheckCircle2 className="size-5" /></span>
        <p className="text-[13.5px] font-medium">You&apos;re all caught up</p>
        <p className="max-w-xs text-[12.5px] text-muted">Approvals, leave, timesheets and tasks for you will show here.</p>
      </div>
    );
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-[14px] bg-surface-solid/80 ring-1 ring-border/60">
      {items.map((i) => (
        <li key={i.id}>
          <Link href={i.link} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px] transition-colors hover:bg-surface-2">
            <span className="hidden w-24 shrink-0 truncate text-[11px] font-medium tracking-[0.04em] text-subtle uppercase sm:block">{i.source}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{i.title}</span>
              <span className="block truncate text-[12px] text-muted"><span className="sm:hidden">{i.source} · </span>{i.detail}</span>
            </span>
            {i.overdue && <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">Overdue</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── Trends ──────────────────────────────────────────────────────────────────

function Charts({ charts }: { charts: ChartBlock[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {charts.map((c) => (
        <div key={c.id} className={clsx("min-w-0 rounded-[16px] bg-surface-solid/80 p-3 ring-1 ring-border/60 sm:p-4", charts.length === 1 && "lg:col-span-2")}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-[13.5px] font-semibold tracking-[-0.01em]">{c.title}</h4>
              <p className="text-[12px] text-muted">{c.sub}</p>
            </div>
            <Link href={c.href} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-muted hover:text-fg">
              Open <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <ChartView r={c.result} kind={c.kind} />
        </div>
      ))}
    </div>
  );
}

// ─── Recent activity ─────────────────────────────────────────────────────────

function Activity({ rows }: { rows: Dash["activity"] }) {
  return (
    <ol className="relative grid gap-3 pl-4 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-border sm:grid-cols-2 sm:gap-x-8">
      {rows.slice(0, 8).map((r) => (
        <li key={r.id} className="relative min-w-0 text-[13px]">
          <span className="absolute top-1.5 -left-4 size-[7px] rounded-full bg-fg/25 ring-2 ring-surface" aria-hidden />
          <span className="block truncate font-medium">{r.what}</span>
          <span className="block text-[12px] text-muted">
            {r.who} · {timeAgo(r.at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ─── Web apps ────────────────────────────────────────────────────────────────

function WebApps() {
  const { org } = useSession();
  const projects = useQuery({ queryKey: ["projects", org.id, "recent"], queryFn: () => api<{ items: ProjectSummary[]; total: number }>(`/api/v1/orgs/${org.id}/projects?limit=4`) });
  return (
    <Panel title="Web apps" href="/projects" link={projects.data?.total ? `All ${projects.data.total}` : "All"}>
      {!projects.data ? (
        <Skeleton className="h-40 rounded-[14px]" />
      ) : !projects.data.items.length ? (
        <div className="dash-empty flex items-center justify-between gap-3">
          <span>A website, store or booking page — live in minutes.</span>
          <ButtonLink href="/launch" size="sm" variant="secondary" icon={<Rocket className="size-3.5" />} className="shrink-0">Launch one</ButtonLink>
        </div>
      ) : (
        <ul className="grid gap-0.5">
          {projects.data.items.slice(0, 5).map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="dash-row group">
                <span className="dash-ic"><AppWindow /></span>
                <span className="min-w-0 flex-1">
                  <span className="block">{p.name}</span>
                  <span className="block text-[12px] font-normal text-muted">{p.productionDeploymentId ? "Live" : "Draft"} · updated {timeAgo(p.updatedAt)}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
