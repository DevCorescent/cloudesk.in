"use client";

// Home: the workspace at a glance. Headline numbers with their change, what
// needs attention, what's waiting on you, charts, recent activity, quick
// actions (the ones you use most first), your desk (mail, calendar, chat,
// notes and the rest at a glance) and your web apps — only for the
// features this workspace uses and this person may see. Sections can be
// reordered (drag, or the arrows) and hidden; the layout is saved per person.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Lightbulb,
  AlertTriangle, AppWindow, ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, BadgeIndianRupee, Bell, Boxes, ChartColumn, CheckCircle2, ChevronRight, Clock, Contact, Eye, EyeOff, GripVertical,
  Calculator, HandCoins, Handshake, History, Inbox, Info, KanbanSquare, KeyRound, Landmark, LayoutTemplate, LifeBuoy, Maximize2, Minus, ReceiptText, RefreshCw, Rocket, Send, Settings2, ShoppingBag, ShoppingCart, Sparkles, Stethoscope, Target, TrendingUp, Trophy, User, Users, Wallet, Wand2, Wrench, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChartView, type Result } from "@/components/bi/chart";
import { PlanStrip, SubscriptionCard } from "@/components/billing/status";
import { Desk, DeskSkeleton, deskEmpty, useCountUp, useDesk, type DeskData } from "@/components/home/desk";
import { ProjectCard } from "@/components/project-card";
import { AppTile, TABS } from "@/components/shell/mobile-nav";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, ButtonLink, Card, ErrorState, Notice, Skeleton, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { compact, timeAgo, usd } from "@/lib/client/format";
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
const SECTIONS = ["summary", "desk", "actions", "webapps", "create"] as const;
type SectionId = (typeof SECTIONS)[number];
const SECTION: Record<SectionId, { title: string; wide: boolean }> = {
  summary: { title: "At a glance", wide: true },
  desk: { title: "Your desk", wide: true },
  actions: { title: "Quick actions", wide: true },
  webapps: { title: "Web apps", wide: true },
  create: { title: "Build something new", wide: true },
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
    <div className="dash mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
      {!user.emailVerified && <VerifyEmail email={user.email} />}
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
          {d && <span className="hidden text-[12px] text-subtle sm:inline">Updated {timeAgo(d.generatedAt)}</span>}
          <Link href="/ai" className="ai-entry inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium">
            <Sparkles className="size-3.5" /> AI mode
          </Link>
          <Button size="sm" variant="ghost" aria-label="Refresh" icon={<RefreshCw className={clsx("size-3.5", q.isFetching && "animate-spin")} />} onClick={() => q.refetch()} />
          <Link href="/requests" className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-muted hover:bg-surface-2 hover:text-fg md:inline-flex" title="Missing something? Ask the Cloudesk team"><Lightbulb className="size-3.5" />Request a feature</Link>
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

      {!editing && <SubscriptionCard />}

      {editing && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-dashed border-border bg-surface px-4 py-3 text-[13px]">
          <span className="text-muted">Drag sections by the handle (or use the arrows) to reorder; the eye hides or shows one. Saved for you on every device.</span>
          <Button size="sm" variant="ghost" onClick={() => apply({ order: [...SECTIONS], hidden: [] })}>Reset layout</Button>
        </div>
      )}

      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-1 gap-5 lg:grid-cols-2">
          {visible.map((id, i) => {
            const hidden = current.hidden.includes(id);
            const body = id === "desk" ? (desk.data ? <Desk d={desk.data} /> : <DeskSkeleton />) : d ? <SectionBody id={id} d={d} /> : <Skeleton className="h-40 rounded-[20px]" />;
            if (!editing && (id === "desk" ? desk.isError || deskEmpty(desk.data) : d && isEmpty(id, d))) return null;
            return (
              <section
                key={id}
                aria-label={SECTION[id].title}
                className={clsx("dash-in min-w-0", SECTION[id].wide && "lg:col-span-2", editing && "rounded-[22px] ring-1 ring-border ring-offset-4 ring-offset-bg transition-opacity", editing && hidden && "opacity-45", drag === id && "opacity-50")}
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
      {d && !d.kpis.length && !d.charts.length && !editing && <GettingStarted />}
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
  const apps = [
    ...(on("mail") ? [TABS.mail] : []),
    ...(on("calendar") ? [TABS.calendar] : []),
    ...(on("chat") ? [TABS.chat] : []),
    TABS.notes,
    TABS.work,
    ...(on("copilot") ? [{ href: "/copilot", label: "Copilot", icon: Sparkles, ink: "#7c5cdb" }] : []),
    { href: "/calculator", label: "Calculator", icon: Calculator, ink: "#2a86d1" },
    { href: "/projects", label: "Web apps", icon: AppWindow, ink: "#e8743b" },
  ].slice(0, 8);

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
          <Link href="/ai" aria-label="AI mode" className="ai-entry inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold active:scale-95">
            <Sparkles className="size-3.5" /> AI
          </Link>
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
    case "create":
      return <Create />;
  }
}

function Head({ title, href, link, count }: { title: string; href?: string; link?: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">
        {title}
        {count ? <span className="rounded-full bg-surface-2 px-1.5 text-[11.5px] font-medium text-muted tabular-nums">{count}</span> : null}
      </h2>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
          {link ?? "Open"} <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
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

type Stat = { id: string; label: string; hint: string; icon: React.ReactNode; tint: Tint; dot?: "danger" | "accent"; title: string; href?: string; link?: string; wide?: boolean; body: React.ReactNode };

function Glance({ d }: { d: Dash }) {
  const [sel, setSel] = useState<string | null>(null);
  const urgent = d.insights.some((i) => i.tone === "danger" || i.tone === "warning");
  const waitingN = d.waiting ? d.waiting.counts.approvals + d.waiting.counts.todo : 0;
  const stats: Stat[] = [
    ...d.kpis.map((k): Stat => {
      const m = modOf(k.module);
      return { id: `kpi:${k.id}`, label: k.label, hint: m.label, icon: KPI_ICON[k.id] ?? m.icon, tint: m.tint, title: k.label, href: k.href, link: `Open ${m.label.toLowerCase()}`, wide: d.charts.some((c) => c.module === k.module), body: <KpiDetail k={k} d={d} /> };
    }),
    { id: "attention", label: "Needs attention", hint: d.insights.length ? `${urgent ? "Urgent" : "Notes"} for you` : "All clear", icon: <AlertTriangle />, tint: "rose", dot: urgent ? "danger" : d.insights.length ? "accent" : undefined, title: "Needs attention", body: <Attention insights={d.insights} /> },
    ...(d.waiting ? [{ id: "waiting", label: "Waiting on you", hint: "Approvals and tasks", icon: <Inbox />, tint: "butter", dot: waitingN ? "accent" : undefined, title: "Waiting on you", href: "/inbox", link: "My work", body: <Waiting w={d.waiting} /> } satisfies Stat] : []),
    ...(d.charts.length ? [{ id: "charts", label: "Trends", hint: `${d.charts.length} chart${d.charts.length === 1 ? "" : "s"}`, icon: <ChartColumn />, tint: "sky", title: "Trends", wide: true, body: <Charts charts={d.charts} /> } satisfies Stat] : []),
    ...(d.activity.length ? [{ id: "activity", label: "Recent activity", hint: "Who did what", icon: <History />, tint: "lavender", title: "Recent activity", href: "/settings/audit", link: "Audit log", body: <Activity rows={d.activity} /> } satisfies Stat] : []),
  ];
  const open = stats.find((x) => x.id === sel) ?? null;
  // Phones list the stats in groups: each area's numbers together, then your work.
  const groups: [string, Stat[]][] = [];
  for (const x of stats) {
    const g = x.id.startsWith("kpi:") ? x.hint : "Your work";
    const at = groups.find(([name]) => name === g);
    if (at) at[1].push(x);
    else groups.push([g, [x]]);
  }
  return (
    <div className="glance rounded-[24px] p-3 sm:p-4">
      <div className="mb-3 px-1">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]">At a glance</h2>
        <p className="text-[12.5px] text-muted">Pick a stat to see its numbers</p>
      </div>
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
      <div role="group" aria-label="Stats" className="hidden gap-2 sm:grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {stats.map((x) => (
          <button key={x.id} type="button" aria-haspopup="dialog" aria-expanded={sel === x.id} onClick={() => setSel(x.id)} className={clsx("stat-btn group", `tint-${x.tint}`)}>
            <span className="stat-chip">{x.icon}</span>
            <span className="min-w-0 flex-1 text-left">
              <span className="line-clamp-2 block text-[13px] leading-[1.25] font-medium">{x.label}</span>
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
  const any = quick.some((q) => q.mostUsed);
  return (
    <div>
      <Head title={any ? "Quick actions · your most used first" : "Quick actions"} />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {quick.map((q) => (
          <button key={q.id} type="button" onClick={() => go(q)} className="quick-pill group">
            <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-fg/70 transition-colors group-hover:bg-fg group-hover:text-bg [&_svg]:size-3.5">{ICONS[q.icon] ?? <Sparkles />}</span>
            {q.label}
          </button>
        ))}
      </div>
    </div>
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
    <div className="h-full">
      <Head title="Recent web apps" count={projects.data?.total} href="/projects" link="All web apps" />
      {!projects.data ? (
        <Skeleton className="h-36 rounded-[18px]" />
      ) : !projects.data.items.length ? (
        <Card className="grid place-items-center gap-2 p-6 text-center">
          <AppWindow className="size-5 text-muted" />
          <p className="text-[13.5px] font-medium">No web apps yet</p>
          <p className="text-[12.5px] text-muted">A website, store or app for your business — ready in minutes.</p>
          <ButtonLink href="/launch" size="sm" variant="primary" icon={<Rocket className="size-3.5" />}>Launch one</ButtonLink>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {projects.data.items.slice(0, 4).map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}

// ─── Build something new ─────────────────────────────────────────────────────

type Usage = { ai: { costMicroUsd: number; tasks: number; tokens: number; budgetMicroUsd: number } };

function Create() {
  const { org } = useSession();
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const usage = useQuery({ queryKey: ["usage", org.id], queryFn: () => api<Usage>(`/api/v1/orgs/${org.id}/usage`) });
  const go = () => router.push(`/create?brief=${encodeURIComponent(brief)}`);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_0.8fr]">
      <Link href="/launch" className="lx-card launch-card group relative flex items-center gap-4 overflow-hidden rounded-[22px] p-5">
        <span className="lx-float grid size-12 shrink-0 place-items-center rounded-[16px] bg-surface-solid text-[var(--tint-lavender-ink)] shadow-[0_8px_20px_-12px_rgb(91_72_176/0.6)] ring-1 ring-border/60">
          <Rocket className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold tracking-tight">Launch a store or website in 5 minutes</span>
          <span className="block text-[13px] text-muted">Bring your product spreadsheet, pick a look, and go live.</span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-fg" aria-hidden />
      </Link>
      <Card className="p-1.5">
        <form onSubmit={(e) => (e.preventDefault(), go())}>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && brief.trim() && go()} aria-label="Describe what you want to build" placeholder="Describe a website or app — a menu with online reservations, a booking page…" className="min-h-[76px] border-0 shadow-none focus:ring-0" />
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
            <Link href="/templates" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg">
              <LayoutTemplate className="size-3.5" aria-hidden /> Templates
            </Link>
            <Button type="submit" size="sm" variant="primary" disabled={brief.trim().length < 10} icon={<Wand2 className="size-3.5" />}>Plan it</Button>
          </div>
        </form>
      </Card>
      <Card className="flex flex-col justify-between p-4">
        <div>
          <p className="text-[12.5px] font-medium text-muted">AI usage this month</p>
          {usage.data ? (
            <>
              <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{usd(usage.data.ai.costMicroUsd)}</p>
              <p className="text-[12px] text-muted">{usage.data.ai.tasks} tasks · {compact(usage.data.ai.tokens)} tokens</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Monthly AI budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((usage.data.ai.costMicroUsd / Math.max(1, usage.data.ai.budgetMicroUsd)) * 100)}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (usage.data.ai.costMicroUsd / Math.max(1, usage.data.ai.budgetMicroUsd)) * 100)}%` }} />
              </div>
            </>
          ) : (
            <Skeleton className="mt-2 h-10" />
          )}
        </div>
        <Link href="/settings/ai" className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg">
          <KeyRound className="size-3.5" /> AI providers
        </Link>
      </Card>
    </div>
  );
}

function GettingStarted() {
  return (
    <Card className="mt-5 p-6 text-center">
      <Sparkles className="mx-auto size-6 text-accent" />
      <h2 className="mt-2 text-[16px] font-semibold">Your dashboard fills in as you work</h2>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">Issue an invoice, add your team, record a sale or a deal — the numbers, charts and alerts here come from your own records, nothing made up.</p>
    </Card>
  );
}

function VerifyEmail({ email }: { email: string }) {
  const toast = useToast();
  const resend = useMutation({
    mutationFn: () => api("/api/v1/auth/resend-verification", { method: "POST" }),
    onSuccess: () => toast({ tone: "success", title: "Verification email sent" }),
    onError: (e) => toast({ tone: "error", title: "Could not send", description: errorMessage(e) }),
  });
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="mb-5">
      <Notice tone="warning" title="Verify your email address" action={<span className="flex gap-1"><Button size="sm" onClick={() => resend.mutate()} loading={resend.isPending}>Resend email</Button><Button size="sm" variant="ghost" aria-label="Dismiss" icon={<X className="size-3.5" />} onClick={() => setGone(true)} /></span>}>
        We sent a link to {email}. In local development, emails appear under Settings → Developer.
      </Notice>
    </div>
  );
}
