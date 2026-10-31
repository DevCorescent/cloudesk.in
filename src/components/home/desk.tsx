"use client";

// "Your desk" on Home: a tile each for My work, Mail, Calendar, Chat, Notes,
// Copilot and the Calculator — only the ones with at least one thing in them.
// Each tile has its headline count, what to look at first, and one tap to open
// the item itself. Everything comes from GET /dashboard/desk, refreshed every
// minute.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowRight, ArrowUpRight, AtSign, Bell, Calculator, CalendarDays, CheckCircle2, ChevronDown, FileText, Hash, Inbox, Lock, Mail, MessagesSquare, NotebookPen, Pin, Reply, Send, Sparkles, Star, Users, Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { fmtUntil } from "@/lib/calendar/format";
import { providerName } from "@/lib/calendar/detect";
import { api } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/format";
import { useCompose } from "@/components/mail/compose-provider";
import type { Desk as DeskData } from "@/server/dashboard/desk";

export type { DeskData };
type Tone = "lavender" | "sky" | "mint" | "butter" | "peach" | "rose";

export function useDesk(orgId: string) {
  return useQuery({ queryKey: ["dashboard-desk", orgId], queryFn: () => api<DeskData>(`/api/v1/orgs/${orgId}/dashboard/desk`), refetchInterval: 60_000 });
}

export const deskEmpty = (d: DeskData | undefined) => !!d && Object.values(d).every((v) => v == null);

/** Counts up to a number when it first appears (straight to it for reduced motion). */
export function useCountUp(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = reduce ? 1 : Math.min(1, (t - start) / 700);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** "10:24" today, "Tue" this week, "28 Oct" before that. */
function when(iso: string) {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (days < 6) return d.toLocaleDateString("en-IN", { weekday: "short" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const AVATAR: Tone[] = ["sky", "peach", "mint", "lavender", "butter", "rose"];
const toneOf = (s: string) => AVATAR[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length]!;

/** One line in the summary under the title: the most useful count of each tile. */
export function deskSummary(d: DeskData) {
  return [
    d.mail?.unread ? plural(d.mail.unread, "unread email") : null,
    d.calendar?.today ? `${plural(d.calendar.today, "meeting")} today` : null,
    d.chat?.mentions ? plural(d.chat.mentions, "mention") : d.chat?.unread ? `${d.chat.unread} unread in chat` : null,
    d.work && d.work.approvals + d.work.todo ? `${d.work.approvals + d.work.todo} to do` : null,
  ].filter(Boolean) as string[];
}

export function Desk({ d }: { d: DeskData }) {
  const tiles: ReactNode[] = [];
  if (d.work) tiles.push(<WorkTile key="work" w={d.work} />);
  if (d.mail) tiles.push(<MailTile key="mail" m={d.mail} />);
  if (d.calendar) tiles.push(<CalendarTile key="calendar" c={d.calendar} />);
  if (d.chat) tiles.push(<ChatTile key="chat" c={d.chat} />);
  if (d.notes) tiles.push(<NotesTile key="notes" n={d.notes} />);
  if (d.documents) tiles.push(<DocumentsTile key="documents" docs={d.documents} />);
  if (d.copilot) tiles.push(<CopilotTile key="copilot" c={d.copilot} />);
  if (d.calculator) tiles.push(<CalcTile key="calc" c={d.calculator} />);
  const summary = deskSummary(d);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Your desk</h2>
          <p className="text-[12.5px] text-muted">{summary.length ? summary.join(" · ") : "Everything you've been working on, at a glance"}</p>
        </div>
      </div>
      <div className={clsx("grid grid-cols-1 gap-3 sm:gap-4", tiles.length >= 2 && "sm:grid-cols-2", tiles.length >= 3 && "xl:grid-cols-3")}>
        {tiles.map((t, i) => (
          <div key={i} className="dash-in min-w-0" style={{ animationDelay: `${i * 60}ms` }}>
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DeskSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[268px] animate-pulse rounded-[22px] border border-border bg-surface" />
      ))}
    </div>
  );
}

// ─── The tile ────────────────────────────────────────────────────────────────

/**
 * Phones get a compact tile: the first couple of items, and "Show more" for the
 * rest (which also lets cut-off previews wrap). From sm up everything shows.
 */
const MORE = "max-sm:group-data-[state=closed]/tile:hidden";
const more = (i: number, keep = 2) => (i >= keep ? MORE : undefined);
const SNIP = "truncate max-sm:group-data-[state=open]/tile:line-clamp-2 max-sm:group-data-[state=open]/tile:whitespace-normal";

function Tile(p: { tone: Tone; icon: ReactNode; title: string; href: string; open?: string; stat?: number; statLabel?: string; live?: boolean; chips?: ReactNode; children: ReactNode; foot?: ReactNode; extra?: number }) {
  const n = useCountUp(p.stat ?? 0);
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label={p.title} data-state={expanded ? "open" : "closed"} className={clsx(`tint-${p.tone}`, "tint-card group/tile relative flex h-full flex-col overflow-hidden rounded-[20px] p-3.5 transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-26px_color-mix(in_srgb,var(--t-ink)_55%,transparent)] sm:min-h-[268px] sm:rounded-[22px] sm:p-4")}>
      {/* A large, faint mark of the feature in the corner. */}
      <span className="pointer-events-none absolute -top-5 -right-5 text-[var(--t-ink)] opacity-[0.07] transition-transform duration-500 group-hover/tile:scale-110 group-hover/tile:-rotate-6 [&_svg]:size-24 sm:[&_svg]:size-32" aria-hidden>
        {p.icon}
      </span>
      <header className="relative flex items-center gap-2.5">
        <span className="tint-chip grid size-8 shrink-0 place-items-center rounded-[11px] [&_svg]:size-4 sm:size-9 sm:rounded-[12px] sm:[&_svg]:size-[18px]">{p.icon}</span>
        <h3 className="min-w-0 flex-1 truncate text-[14px] sm:text-[14.5px] font-semibold tracking-[-0.01em]">{p.title}</h3>
        <Link href={p.href} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-fg/[0.05] hover:text-fg">
          {p.open ?? "Open"} <ArrowRight className="size-3.5 transition-transform group-hover/tile:translate-x-0.5" />
        </Link>
      </header>
      {p.stat !== undefined && (
        <div className="relative mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-1.5 sm:mt-3">
          {p.stat === 0 ? (
            <p className="flex h-6 items-center gap-1.5 text-[13.5px] sm:h-[30px] sm:text-[14px] font-semibold text-[var(--t-ink)]"><CheckCircle2 className="size-4" /> All caught up</p>
          ) : (
          <p className="flex items-baseline gap-1.5">
            <span className="text-[24px] leading-none font-semibold sm:text-[30px] tracking-[-0.035em] tabular-nums">{Math.round(n).toLocaleString("en-IN")}</span>
            <span className="text-[12.5px] font-medium text-muted">{p.statLabel}</span>
            {p.live && (
              <span className="relative ml-0.5 grid size-2 place-items-center self-center" aria-hidden>
                <span className="absolute size-2 animate-ping rounded-full bg-[var(--t-ink)] opacity-50" />
                <span className="size-1.5 rounded-full bg-[var(--t-ink)]" />
              </span>
            )}
          </p>
          )}
          {p.chips && <div className="flex flex-wrap gap-1.5 pb-0.5">{p.chips}</div>}
        </div>
      )}
      <div className="relative mt-2.5 min-w-0 flex-1 sm:mt-3">{p.children}</div>
      {!!p.extra && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="relative mt-1.5 -mb-1 flex w-full items-center justify-center gap-1 rounded-full py-1.5 text-[12px] font-semibold text-[var(--t-ink)] transition-colors active:bg-[color-mix(in_srgb,var(--t)_55%,transparent)] sm:hidden"
        >
          {expanded ? "Show less" : `Show ${p.extra} more`}
          <ChevronDown className={clsx("size-3.5 transition-transform duration-300", expanded && "rotate-180")} />
        </button>
      )}
      {p.foot && <div className="relative mt-2.5 border-t border-fg/[0.06] pt-2 sm:mt-3 sm:pt-2.5">{p.foot}</div>}
    </section>
  );
}

function Chip({ tone, icon, children }: { tone: "danger" | "warning" | "accent" | "plain"; icon?: ReactNode; children: ReactNode }) {
  const cls = { danger: "bg-danger-soft text-danger", warning: "bg-warning-soft text-warning", accent: "bg-[var(--t)] text-[var(--t-ink)]", plain: "bg-fg/[0.05] text-muted" }[tone];
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap [&_svg]:size-3", cls)}>{icon}{children}</span>;
}

function Row({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <li className={clsx("min-w-0", className)}>
      <Link href={href} className="group/row -mx-2 flex min-w-0 items-center gap-2.5 rounded-[12px] px-2 py-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--t)_45%,transparent)]">
        {children}
      </Link>
    </li>
  );
}

function Avatar({ name, round = true }: { name: string; round?: boolean }) {
  return <span className={clsx(`tint-${toneOf(name)}`, "tint-chip grid size-8 shrink-0 place-items-center text-[11px] font-bold", round ? "rounded-full" : "rounded-[10px]")}>{initials(name)}</span>;
}

// ─── My work ─────────────────────────────────────────────────────────────────

function WorkTile({ w }: { w: NonNullable<DeskData["work"]> }) {
  const total = w.approvals + w.todo;
  return (
    <Tile
      tone="lavender"
      icon={<Inbox />}
      title="My work"
      href="/inbox"
      stat={total || w.unread}
      statLabel={total ? "waiting on you" : plural(w.unread, "new notification").replace(/^\d+ /, "")}
      live={w.overdue > 0}
      extra={Math.max(0, w.items.length - 2)}
      chips={
        <>
          {w.overdue > 0 && <Chip tone="danger">{w.overdue} overdue</Chip>}
          {w.approvals > 0 && <Chip tone="accent">{plural(w.approvals, "approval")}</Chip>}
          {total > 0 && w.unread > 0 && <Chip tone="plain" icon={<Bell />}>{w.unread}</Chip>}
        </>
      }
    >
      <ul className="grid grid-cols-1 gap-0.5">
        {w.items.map((i, n) => (
          <Row key={i.id} href={i.link} className={more(n)}>
            <span className={clsx("grid size-8 shrink-0 place-items-center rounded-[10px] [&_svg]:size-4", i.overdue ? "bg-danger-soft text-danger" : "tint-chip")}>
              {i.source === "Notification" ? <Bell /> : i.source.includes("pproval") || i.source.includes("Leave") || i.source.includes("laim") ? <CheckCircle2 /> : <Inbox />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={clsx("block text-[13px] font-medium", SNIP)}>{i.title}</span>
              <span className="block truncate text-[11.5px] text-muted">
                {i.source}
                {i.at ? ` · ${timeAgo(i.at)}` : ""}
              </span>
            </span>
            {i.overdue && <span className="shrink-0 text-[11px] font-semibold text-danger">Overdue</span>}
          </Row>
        ))}
      </ul>
    </Tile>
  );
}

// ─── Mail ────────────────────────────────────────────────────────────────────

function MailTile({ m }: { m: NonNullable<DeskData["mail"]> }) {
  const compose = useCompose();
  return (
    <Tile
      tone="sky"
      icon={<Mail />}
      title="Mail"
      href="/mail"
      open="Inbox"
      stat={m.unread}
      statLabel="unread"
      live={m.unread > 0}
      extra={Math.max(0, m.threads.length - 2)}
      chips={
        <>
          {m.overdue > 0 && <Chip tone="danger" icon={<Reply />}>{m.overdue} past reply time</Chip>}
          {m.needsReply > 0 && m.overdue === 0 && <Chip tone="warning" icon={<Reply />}>{m.needsReply} to answer</Chip>}
          {m.meetings > 0 && <Chip tone="accent" icon={<CalendarDays />}>{plural(m.meetings, "invite")}</Chip>}
        </>
      }
      foot={
        compose.available ? (
          <button type="button" onClick={() => compose.compose({})} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-fg">
            <Send className="size-3.5" /> Write an email
          </button>
        ) : undefined
      }
    >
      <ul className="grid grid-cols-1 gap-0.5">
        {m.threads.map((t, n) => (
          <Row key={t.id} href={`/mail/t/${t.id}`} className={more(n)}>
            <span className="relative">
              <Avatar name={t.from || t.subject} />
              {t.unread && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-[var(--t-ink)] ring-2 ring-[var(--surface-solid)]" aria-label="Unread" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className={clsx("min-w-0 flex-1 truncate text-[13px]", t.unread ? "font-semibold" : "font-medium text-fg/80")}>{t.from || "Unknown sender"}</span>
                {t.starred && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
                <span className="shrink-0 text-[11px] text-subtle tabular-nums">{when(t.at)}</span>
              </span>
              <span className={clsx("block text-[12px] text-muted", SNIP)}>
                <span className={clsx(t.unread && "text-fg/80")}>{t.subject}</span>
                {t.snippet ? ` — ${t.snippet}` : ""}
              </span>
            </span>
          </Row>
        ))}
      </ul>
    </Tile>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────────

function CalendarTile({ c }: { c: NonNullable<DeskData["calendar"]> }) {
  const now = useNow();
  const [first, ...rest] = c.events;
  const link = (e: { id: string; occurrence: string }) => `/calendar?event=${e.id}&at=${encodeURIComponent(e.occurrence)}`;
  // Today's start time; another day's weekday (the line under it has the time).
  const time = (iso: string) => {
    const d = new Date(iso);
    return d.toDateString() === new Date(now).toDateString() ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
  };
  return (
    <Tile
      tone="mint"
      icon={<CalendarDays />}
      title="Calendar"
      href="/calendar"
      stat={c.today}
      statLabel={c.today === 1 ? "meeting today" : "meetings today"}
      extra={Math.max(0, rest.length - 1)}
      chips={
        <>
          {c.invites > 0 && <Chip tone="warning">{plural(c.invites, "invite")} to answer</Chip>}
          {c.minutes > 0 && <Chip tone="plain">{c.minutes} need minutes</Chip>}
        </>
      }
    >
      {first ? (
        <div className="grid grid-cols-1 gap-2">
          <NextUp e={first} now={now} href={link(first)} />
          {rest.length > 0 && (
            <ul className="grid grid-cols-1 gap-0.5">
              {rest.map((e, n) => (
                <Row key={e.key} href={link(e)} className={more(n, 1)}>
                  <span className="w-[62px] shrink-0 text-[11.5px] font-medium text-muted tabular-nums">{e.allDay ? "All day" : time(e.start)}</span>
                  <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: e.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{e.title}</span>
                    <span className="block truncate text-[11.5px] text-muted">{fmtUntil(Date.parse(e.start), now, tz())}</span>
                  </span>
                  {e.meetingUrl && <Video className="size-3.5 shrink-0 text-subtle" aria-label="Video call" />}
                </Row>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <Link href="/calendar" className="flex items-center gap-3 rounded-[14px] bg-[var(--surface-solid)]/70 p-3 text-[13px] ring-1 ring-fg/[0.06]">
          <CheckCircle2 className="size-4 text-[var(--t-ink)]" /> Nothing booked in the next week
        </Link>
      )}
    </Tile>
  );
}

function NextUp({ e, now, href }: { e: NonNullable<DeskData["calendar"]>["events"][number]; now: number; href: string }) {
  const start = Date.parse(e.start);
  const end = Date.parse(e.end);
  const live = start <= now;
  const soon = !live && start - now < 15 * 60_000;
  const done = live ? Math.min(1, (now - start) / Math.max(1, end - start)) : 0;
  return (
    <div className={clsx("relative overflow-hidden rounded-[16px] p-3 ring-1", live || soon ? "bg-emerald-500/[0.08] ring-emerald-500/25" : "bg-[var(--surface-solid)]/75 ring-fg/[0.06]")}>
      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
        {(live || soon) && (
          <span className="relative grid size-2 place-items-center" aria-hidden>
            <span className="absolute size-2 animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="size-1.5 rounded-full bg-emerald-500" />
          </span>
        )}
        <span className={live || soon ? "text-emerald-700 dark:text-emerald-400" : "text-[var(--t-ink)]"}>{e.allDay ? "All day" : live ? "On now" : `Next · ${fmtUntil(start, now, tz())}`}</span>
      </span>
      <Link href={href} className="mt-1 block truncate text-[15px] font-semibold tracking-[-0.01em] after:absolute after:inset-0">{e.title}</Link>
      <span className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
          {e.allDay ? "" : `${new Date(start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} – ${new Date(end).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`}
          {e.meetingUrl ? ` · ${providerName(e.provider) || "Video call"}` : e.location ? ` · ${e.location}` : ""}
          {e.attendees > 0 ? ` · ${plural(e.attendees, "guest")}` : ""}
        </span>
        {e.meetingUrl && (
          <a href={e.meetingUrl} target="_blank" rel="noreferrer" className={clsx("relative z-10 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold transition-transform active:scale-95", live || soon ? "bg-emerald-600 text-white shadow-[0_6px_16px_-6px_rgb(5_150_105/0.7)]" : "bg-fg/[0.07] text-fg hover:bg-fg/[0.1]")}>
            <Video className="size-3.5" /> Join
          </a>
        )}
      </span>
      {live && !e.allDay && <span className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-emerald-500/70" style={{ transform: `scaleX(${done})` }} aria-hidden />}
    </div>
  );
}

// ─── Chat ────────────────────────────────────────────────────────────────────

function ChatTile({ c }: { c: NonNullable<DeskData["chat"]> }) {
  return (
    <Tile
      tone="peach"
      icon={<MessagesSquare />}
      title="Chat"
      href="/chat"
      stat={c.mentions || c.unread}
      statLabel={c.mentions ? (c.mentions === 1 ? "mention" : "mentions") : "unread"}
      live={c.mentions + c.unread > 0}
      extra={Math.max(0, c.channels.length - 2)}
      chips={
        <>
          {c.mentions > 0 && c.unread > 0 && <Chip tone="plain">{c.unread} unread</Chip>}
          {c.requests > 0 && <Chip tone="warning" icon={<Users />}>{plural(c.requests, "guest")} waiting</Chip>}
        </>
      }
    >
      <ul className="grid grid-cols-1 gap-0.5">
        {c.channels.map((ch, n) => (
          <Row key={ch.id} href={`/chat/${ch.id}`} className={more(n)}>
            {ch.kind === "channel" ? (
              <span className="tint-chip grid size-8 shrink-0 place-items-center rounded-[10px] text-[14px]">{ch.emoji || <Hash className="size-4" />}</span>
            ) : (
              <Avatar name={ch.name} round={ch.kind === "dm"} />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className={clsx("min-w-0 flex-1 truncate text-[13px]", ch.unread ? "font-semibold" : "font-medium text-fg/80")}>{ch.name}</span>
                {ch.at && <span className="shrink-0 text-[11px] text-subtle tabular-nums">{when(ch.at)}</span>}
              </span>
              <span className={clsx("block text-[12px]", SNIP, ch.unread ? "text-fg/70" : "text-muted")}>{ch.preview || "No messages yet"}</span>
            </span>
            {ch.mentions > 0 ? (
              <span className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-danger px-1.5 text-[11px] font-bold text-white tabular-nums"><AtSign className="size-3" />{ch.mentions}</span>
            ) : ch.unread > 0 ? (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--t-ink)] px-1.5 text-[11px] font-bold text-[var(--surface-solid)] tabular-nums">{ch.unread > 99 ? "99+" : ch.unread}</span>
            ) : null}
          </Row>
        ))}
      </ul>
    </Tile>
  );
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function NotesTile({ n }: { n: NonNullable<DeskData["notes"]> }) {
  const now = useNow(60_000);
  return (
    <Tile
      tone="butter"
      icon={<NotebookPen />}
      title="Notes"
      href="/notes"
      extra={Math.max(0, n.items.length - 2)}
      foot={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {n.pinned > 0 && <span className="inline-flex items-center gap-1"><Pin className="size-3" /> {n.pinned} pinned</span>}
          {n.reminders > 0 && <span className="inline-flex items-center gap-1"><Bell className="size-3" /> {plural(n.reminders, "reminder")}</span>}
          <Link href="/notes?new=1" className="ml-auto inline-flex items-center gap-1 font-medium hover:text-fg">+ New note</Link>
        </span>
      }
    >
      <ul className="grid grid-cols-2 gap-2">
        {n.items.map((x, i) => (
          <li key={x.id} className={clsx("min-w-0", more(i))}>
            <Link href={`/notes/${x.id}`} className="flex h-full min-h-[92px] flex-col rounded-[14px] bg-[var(--surface-solid)]/75 p-2.5 ring-1 ring-fg/[0.06] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-14px_rgb(0_0_0/0.35)]">
              <span className="flex items-center gap-1.5">
                <span className="text-[14px] leading-none">{x.icon || "📝"}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{x.title}</span>
                {x.pinned && <Pin className="size-3 shrink-0 text-[var(--t-ink)]" aria-label="Pinned" />}
              </span>
              <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted max-sm:group-data-[state=open]/tile:line-clamp-4">{x.snippet || "Empty note"}</span>
              <span className="mt-auto flex items-center gap-1 pt-1.5 text-[10.5px] text-subtle">
                {x.remindAt && Date.parse(x.remindAt) > now ? (
                  <><Bell className="size-3" /> {fmtUntil(Date.parse(x.remindAt), now, tz())}</>
                ) : (
                  <>{!x.mine && x.owner ? `${x.owner.split(" ")[0]} · ` : ""}{timeAgo(x.at)}</>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Tile>
  );
}

// ─── Documents ───────────────────────────────────────────────────────────────

function DocumentsTile({ docs }: { docs: NonNullable<DeskData["documents"]> }) {
  return (
    <Tile
      tone="sky"
      icon={<FileText />}
      title="Documents"
      href="/documents"
      stat={docs.shared || undefined}
      statLabel="shared with you this week"
      extra={Math.max(0, docs.items.length - 2)}
      foot={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <Link href="/documents/recent" className="hover:text-fg">Recent</Link>
          <Link href="/documents/new" className="ml-auto inline-flex items-center gap-1 font-medium hover:text-fg">+ New document</Link>
        </span>
      }
    >
      <ul className="grid grid-cols-1 gap-1.5">
        {docs.items.map((x, i) => (
          <li key={x.id} className={clsx("min-w-0", more(i))}>
            <Link href={x.kind === "doc" ? `/documents/d/${x.id}` : `/documents/file/${x.id}`} className="flex min-w-0 items-center gap-2.5 rounded-[12px] bg-[var(--surface-solid)]/75 p-2 ring-1 ring-fg/[0.06] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-14px_rgb(0_0_0/0.35)]">
              <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[var(--t)] text-[15px] text-[var(--t-ink)] [&_svg]:size-4">{x.icon || <FileText />}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx("block text-[12.5px] font-semibold", SNIP)}>{x.title}</span>
                <span className={clsx("block text-[11.5px] text-muted", SNIP)}>{x.kind === "doc" ? x.snippet || "Empty document" : x.filename || "File"}</span>
              </span>
              <span className="shrink-0 text-[10.5px] text-subtle">{x.mine ? "" : `${x.owner.split(" ")[0]} · `}{timeAgo(x.at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Tile>
  );
}

// ─── Copilot ─────────────────────────────────────────────────────────────────

function CopilotTile({ c }: { c: NonNullable<DeskData["copilot"]> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <Tile tone="lavender" icon={<Sparkles />} title="Ask Copilot" href="/copilot/history" open="All" extra={Math.max(0, c.threads.length - 1)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/copilot?q=${encodeURIComponent(q.trim())}`);
        }}
        className="flex items-center gap-1.5 rounded-full bg-[var(--surface-solid)] py-1 pr-1 pl-3.5 ring-1 ring-fg/[0.08] transition-shadow focus-within:ring-2 focus-within:ring-[var(--t-ink)]/40"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your business…" aria-label="Your question for Copilot" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle" />
        <button type="submit" disabled={!q.trim()} aria-label="Ask" className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-bg transition-opacity disabled:opacity-30">
          <ArrowUpRight className="size-3.5" />
        </button>
      </form>
      <p className="mt-3 mb-1 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">Recent</p>
      <ul className="grid grid-cols-1 gap-0.5">
        {c.threads.map((t, n) => (
          <Row key={t.id} href={`/copilot/${t.id}`} className={more(n, 1)}>
            <span className="tint-chip grid size-7 shrink-0 place-items-center rounded-[9px]"><Sparkles className="size-3.5" /></span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.title}</span>
            <span className="shrink-0 text-[11px] text-subtle">{when(t.at)}</span>
          </Row>
        ))}
      </ul>
    </Tile>
  );
}

// ─── Calculator ──────────────────────────────────────────────────────────────

function CalcTile({ c }: { c: NonNullable<DeskData["calculator"]> }) {
  return (
    <Tile
      tone="sky"
      icon={<Calculator />}
      title="Calculator"
      href="/calculator"
      extra={Math.max(0, c.entries.length - 2)}
      foot={
        <span className="flex items-center gap-3 text-[12px] text-muted">
          <span>{plural(c.total, "saved result")}</span>
          {c.pinned > 0 && <span className="inline-flex items-center gap-1"><Pin className="size-3" /> {c.pinned} pinned</span>}
          <Lock className="ml-auto size-3" aria-hidden />
          <span className="-ml-2">Only you</span>
        </span>
      }
    >
      <ul className="grid grid-cols-1 gap-1.5">
        {c.entries.map((e, n) => (
          <li key={e.id} className={more(n)}>
            <Link href="/calculator" className="flex min-w-0 items-center gap-3 rounded-[12px] bg-[var(--surface-solid)]/75 px-3 py-2 ring-1 ring-fg/[0.06] transition-colors hover:ring-[var(--t-ink)]/30">
              <span className="min-w-0 flex-1">
                <span className={clsx("block font-mono text-[12px] text-muted", SNIP, "max-sm:group-data-[state=open]/tile:break-all")}>{e.input}</span>
                {e.note && <span className="block truncate text-[11px] text-subtle">{e.note}</span>}
              </span>
              <span className="max-w-[48%] shrink-0 truncate text-right text-[14px] font-semibold tracking-tight tabular-nums">= {e.result}</span>
              {e.pinned && <Pin className="size-3 shrink-0 text-[var(--t-ink)]" aria-label="Pinned" />}
            </Link>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
