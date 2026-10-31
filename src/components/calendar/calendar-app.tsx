"use client";

// Calendar: day, week, month and agenda views; your calendars (show or hide
// each); meetings found in your email waiting to be added; minutes still to
// write; a "starting soon" bar with the join button; and the event panel.
// Keyboard: t today, d/w/m/a views, j/k back/forward, c new event.
import { CalendarPlus, ChevronLeft, ChevronRight, FileText, Mail, Menu as MenuIcon, Plus, Video } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Button, ErrorState, IconButton, Skeleton, cx } from "@/components/ui/primitives";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import type { CalMetaOut, EventOut, MeetingInvite, OccurrenceOut } from "@/lib/calendar/api";
import { providerName } from "@/lib/calendar/detect";
import { AddMeetingDialog } from "./add-meeting";
import { FindMeetingsButton } from "./find-meetings";
import { EventEditor, type Draft } from "./editor";
import { MinutesDialog } from "./minutes";
import { EventPanel } from "./panel";
import { addDays, addMonths, dayKey, sameDay, startOfDay, startOfWeek, timeFull, useCalApi, useCalMeta, useCalRefresh, useRange, whenLocal } from "./shared";
import { Agenda, MonthGrid, TimeGrid, useNow } from "./views";

type View = "day" | "week" | "month" | "agenda";
const HIDDEN_KEY = "cc-cal-hidden";

function readHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function CalendarApp() {
  const meta = useCalMeta();
  if (meta.isError) {
    const forbidden = meta.error instanceof ApiClientError && meta.error.status === 403;
    return <div className="mx-auto max-w-xl p-10">{forbidden ? <ErrorState title="Calendar isn't open to you" message={errorMessage(meta.error)} /> : <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />}</div>;
  }
  if (!meta.data) return <div className="grid h-[var(--app-h)] gap-3 p-3 lg:grid-cols-[264px_1fr]"><Skeleton className="hidden rounded-[18px] lg:block" /><Skeleton className="rounded-[18px]" /></div>;
  return <Calendar meta={meta.data} />;
}

function Calendar({ meta }: { meta: CalMetaOut }) {
  const params = useSearchParams();
  const router = useRouter();
  const { call } = useCalApi();
  const refresh = useCalRefresh();
  const toast = useToast();
  const now = useNow();
  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "agenda" : "week"));
  const [cursor, setCursor] = useState(() => (params.get("at") ? startOfDay(new Date(params.get("at")!)) : startOfDay(new Date())));
  const [selected, setSelected] = useState<OccurrenceOut | null>(null);
  const [editor, setEditor] = useState<{ event?: EventOut; draft?: Draft } | null>(null);
  const [notes, setNotes] = useState<{ eventId: string; occurrence: string; share?: boolean } | null>(null);
  const [adding, setAdding] = useState<MeetingInvite | null>(null);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [drawer, setDrawer] = useState(false);
  const [moveAsk, setMoveAsk] = useState<{ e: OccurrenceOut; start: Date; end: Date } | null>(null);

  const [from, to] = useMemo(() => {
    if (view === "day") return [cursor, addDays(cursor, 1)];
    if (view === "week") return [startOfWeek(cursor), addDays(startOfWeek(cursor), 7)];
    if (view === "month") {
      const s = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      return [s, addDays(s, 42)];
    }
    return [startOfDay(cursor), addDays(startOfDay(cursor), 30)];
  }, [view, cursor]);
  const range = useRange(from, to);
  const events = useMemo(() => (range.data?.events ?? []).filter((e) => !hidden.includes(e.calendarId)), [range.data, hidden]);

  // Opened from a reminder or "add the minutes" notification.
  const [linked, setLinked] = useState(false);
  if (!linked && params.get("event") && range.data) {
    setLinked(true);
    const at = params.get("at");
    const hit = range.data.events.find((e) => e.id === params.get("event") && (!at || Date.parse(e.occurrence) === Date.parse(at)));
    if (hit) {
      setSelected(hit);
      if (params.get("notes") === "1") setNotes({ eventId: hit.id, occurrence: hit.occurrence });
    }
  }

  const persistHidden = (h: string[]) => {
    setHidden(h);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(h));
    } catch {
      /* private mode: just this session */
    }
  };
  const step = (dir: 1 | -1) => setCursor((c) => (view === "month" ? addMonths(c, dir) : view === "week" ? addDays(c, 7 * dir) : view === "agenda" ? addDays(c, 30 * dir) : addDays(c, dir)));
  const create = (start: Date, end: Date, allDay: boolean) => setEditor({ draft: { start, end, allDay } });
  const newEvent = () => {
    const s = new Date(Math.ceil(Date.now() / (30 * 60_000)) * 30 * 60_000);
    const base = sameDay(cursor, new Date()) || view === "week" ? s : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 10);
    create(base, new Date(base.getTime() + 3_600_000), false);
  };

  const move = async (e: OccurrenceOut, start: Date, end: Date, scope: "all" | "this" = "all") => {
    try {
      if (scope === "all" && e.recurring) {
        // The whole series shifts by the same amount.
        const ev = await call<EventOut>(`events/${e.id}`);
        const shift = start.getTime() - Date.parse(e.start);
        const len = end.getTime() - start.getTime();
        await call(`events/${e.id}`, "PATCH", { start: new Date(Date.parse(ev.start) + shift).toISOString(), end: new Date(Date.parse(ev.start) + shift + len).toISOString() });
      } else await call(`events/${e.id}`, "PATCH", { start: start.toISOString(), end: end.toISOString(), scope, occurrence: e.occurrence });
      toast({ tone: "success", title: `Moved to ${whenLocal(start, end, false)}` });
      refresh();
    } catch (err) {
      toast({ tone: "error", title: errorMessage(err) });
    }
  };
  const onMove = (e: OccurrenceOut, start: Date, end: Date) => (e.recurring ? setMoveAsk({ e, start, end }) : void move(e, start, end));

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || t?.isContentEditable || document.querySelector("dialog[open]")) return;
      const k = ev.key.toLowerCase();
      if (k === "t") setCursor(startOfDay(new Date()));
      else if (k === "d" || k === "w" || k === "m" || k === "a") setView(({ d: "day", w: "week", m: "month", a: "agenda" } as const)[k]);
      else if (k === "j" || k === "arrowright") step(1);
      else if (k === "k" || k === "arrowleft") step(-1);
      else if (k === "c" || k === "n") newEvent();
      else if (k === "escape") setSelected(null);
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title =
    view === "month" ? cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
      : view === "day" ? cursor.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : view === "week" ? `${from.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${addDays(to, -1).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
          : `Next 30 days from ${cursor.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;

  // Starting soon (or on now), for the banner.
  const soon = (range.data?.events ?? []).filter((e) => e.meetingUrl && e.status !== "cancelled" && e.response !== "declined" && Date.parse(e.start) - now < 15 * 60_000 && Date.parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start))[0];

  const sidebar = (
    <nav aria-label="Calendars" className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-4">
      <Button variant="primary" size="lg" className="w-full" icon={<Plus className="size-4" />} onClick={() => { setDrawer(false); newEvent(); }}>New event</Button>
      <MiniMonth cursor={cursor} onPick={(d) => { setCursor(d); if (view === "month" || view === "agenda") setView("day"); setDrawer(false); }} />

      {meta.invites.length > 0 && (
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-subtle uppercase"><Mail className="size-3.5" />From your email <span className="ml-auto rounded-full bg-sky-500/15 px-1.5 text-[10.5px] text-sky-700 dark:text-sky-300">{meta.invites.length}</span></p>
          <ul className="grid gap-2">
            {meta.invites.slice(0, 8).map((i) => (
              <li key={i.messageId} className="rounded-[14px] border border-border bg-[var(--surface-solid)] p-3">
                <p className="line-clamp-2 text-[13px] leading-snug font-semibold">{i.title}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">{i.start ? whenLocal(new Date(i.start), new Date(i.end ?? i.start), i.allDay) : "Time not found"}</p>
                <p className="truncate text-[11.5px] text-subtle">{i.from.name || i.from.address}{i.url ? ` · ${providerName(i.provider) || "Video call"}` : ""}</p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="primary" icon={<CalendarPlus className="size-3.5" />} onClick={() => setAdding(i)}>Add</Button>
                  <Link href={`/mail/t/${i.threadId}`} className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] text-muted ring-1 ring-border hover:text-fg">Open email</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meta.mail && meta.accounts.length > 0 && <FindMeetingsButton variant="ghost" className="-mt-2 w-full justify-start" />}

      {meta.notesDue.length > 0 && (
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-subtle uppercase"><FileText className="size-3.5" />Minutes to write</p>
          <ul className="grid gap-1">
            {meta.notesDue.slice(0, 6).map((d) => (
              <li key={`${d.eventId}:${d.occurrence}`}>
                <div className="group flex items-center gap-1 rounded-[10px] hover:bg-surface-2">
                  <button type="button" onClick={() => setNotes({ eventId: d.eventId, occurrence: d.occurrence })} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
                    <span className="size-2 shrink-0 rounded-full bg-amber-500" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{d.title}</span><span className="block text-[11.5px] text-muted">ended {new Date(d.end).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></span>
                  </button>
                  <button type="button" title="No minutes needed" aria-label={`No minutes needed for ${d.title}`} onClick={() => void call("notes/skip", "POST", { event: d.eventId, occurrence: d.occurrence }).then(refresh)} className="mr-1 hidden rounded-full px-2 py-0.5 text-[11px] text-muted hover:bg-fg/10 hover:text-fg group-hover:block">Skip</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-subtle uppercase">My calendars</p>
        <ul className="grid gap-0.5">
          {meta.calendars.map((c) => {
            const on = !hidden.includes(c.id);
            return (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] hover:bg-surface-2">
                  <input type="checkbox" checked={on} onChange={() => persistHidden(on ? [...hidden, c.id] : hidden.filter((x) => x !== c.id))} className="size-4 rounded" style={{ accentColor: c.color }} />
                  <span className={cx("flex-1 truncate", !on && "text-muted")}>{c.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
      {!meta.mail && <p className="mt-auto rounded-[12px] bg-surface-2 p-3 text-[12px] text-muted">Switch on Mail to have meeting invites from your email show up here.</p>}
    </nav>
  );

  return (
    <div className="@container/cal relative h-[var(--app-h)] min-h-[520px] overflow-hidden">
      <div className="grid h-full grid-cols-1 @5xl/cal:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-border @5xl/cal:block">{sidebar}</aside>
        {drawer && (
          <div className="fixed inset-0 z-40 @5xl/cal:hidden" role="dialog" aria-label="Calendars">
            <button type="button" aria-label="Close" className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[300px] max-w-[88vw] border-r border-border bg-[var(--surface-solid)] shadow-2xl">{sidebar}</div>
          </div>
        )}

        <main className="flex min-h-0 min-w-0 flex-col">
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
            <IconButton label="Calendars and invites" className="@5xl/cal:hidden" icon={<MenuIcon className="size-[18px]" />} onClick={() => setDrawer(true)} />
            <Button size="sm" onClick={() => setCursor(startOfDay(new Date()))}>Today</Button>
            <div className="flex">
              <IconButton size="sm" label="Back (k)" icon={<ChevronLeft className="size-4" />} onClick={() => step(-1)} />
              <IconButton size="sm" label="Forward (j)" icon={<ChevronRight className="size-4" />} onClick={() => step(1)} />
            </div>
            <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{title}</h1>
            {meta.invites.length > 0 && (
              <button type="button" onClick={() => setDrawer(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sky-500/10 px-3 text-[12.5px] font-semibold text-sky-700 @5xl/cal:hidden dark:text-sky-300"><Mail className="size-3.5" />{meta.invites.length}</button>
            )}
            <Segmented label="View" value={view} onChange={(v) => setView(v)} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "agenda", label: "Agenda" }]} />
            <IconButton label="New event (c)" className="@5xl/cal:hidden" icon={<Plus className="size-4" />} onClick={newEvent} />
          </header>

          {soon && (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-2 text-[13px]">
              <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span>
              <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{Date.parse(soon.start) <= now ? "On now" : `Starts at ${timeFull(new Date(soon.start))}`}</b> · {soon.title}</span>
              <a href={soon.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-[12.5px] font-semibold text-white"><Video className="size-3.5" />Join</a>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {range.isError ? (
              <div className="p-6"><ErrorState message={errorMessage(range.error)} onRetry={() => range.refetch()} /></div>
            ) : view === "month" ? (
              <MonthGrid month={cursor} events={events} now={now} selectedKey={selected?.key ?? null} onSelect={setSelected} onCreate={create} onDay={(d) => { setCursor(d); setView("day"); }} />
            ) : view === "agenda" ? (
              <Agenda from={startOfDay(cursor)} days={30} events={events} now={now} selectedKey={selected?.key ?? null} onSelect={setSelected} />
            ) : (
              <TimeGrid days={view === "day" ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))} events={events} now={now} selectedKey={selected?.key ?? null} onSelect={setSelected} onCreate={create} onMove={onMove} />
            )}
            {range.isFetching && !range.data && <div className="absolute inset-0 grid place-items-center"><Skeleton className="h-10 w-40" /></div>}
          </div>
        </main>

        {selected && (
          <>
            {/* Floats over the calendar's right edge, so the grid keeps its width. */}
            <div className="absolute inset-y-0 right-0 z-30 hidden w-[380px] max-w-[90%] border-l border-border shadow-[-24px_0_60px_-30px_rgb(0_0_0/0.35)] @5xl/cal:block">
              <EventPanel key={selected.key} meta={meta} occ={selected} now={now} onClose={() => setSelected(null)} onEdit={(e) => setEditor({ event: e, draft: selected.recurring ? { start: new Date(selected.start), end: new Date(selected.end), allDay: selected.allDay } : undefined })} onNotes={(o) => setNotes({ eventId: o.id, occurrence: o.occurrence })} />
            </div>
            <div className="fixed inset-x-0 bottom-0 z-[45] h-[78dvh] pb-[env(safe-area-inset-bottom)] overflow-hidden rounded-t-[22px] border-t border-border shadow-[0_-20px_50px_-20px_rgb(0_0_0/0.4)] @5xl/cal:hidden">
              <EventPanel key={`m-${selected.key}`} meta={meta} occ={selected} now={now} onClose={() => setSelected(null)} onEdit={(e) => setEditor({ event: e, draft: selected.recurring ? { start: new Date(selected.start), end: new Date(selected.end), allDay: selected.allDay } : undefined })} onNotes={(o) => setNotes({ eventId: o.id, occurrence: o.occurrence })} />
            </div>
          </>
        )}
      </div>

      {editor && <EventEditor meta={meta} event={editor.event} draft={editor.draft} onClose={() => setEditor(null)} onSaved={(e) => { setEditor(null); setSelected(null); setCursor(startOfDay(new Date(e.start))); }} />}
      {notes && <MinutesDialog meta={meta} eventId={notes.eventId} occurrence={notes.occurrence} startOnShare={notes.share} onClose={() => { setNotes(null); if (params.get("notes")) router.replace("/calendar"); }} />}
      {adding && <AddMeetingDialog m={{ ...adding, organizer: adding.organizer }} onClose={() => setAdding(null)} onAdded={(e) => setCursor(startOfDay(new Date(e.start)))} />}
      {moveAsk && (
        <Dialog open onClose={() => setMoveAsk(null)} size="sm" title="Move a repeating event" footer={<><Button onClick={() => { void move(moveAsk.e, moveAsk.start, moveAsk.end, "this"); setMoveAsk(null); }}>Only this one</Button><Button variant="primary" onClick={() => { void move(moveAsk.e, moveAsk.start, moveAsk.end, "all"); setMoveAsk(null); }}>All of them</Button></>}>
          <p className="text-[13.5px] text-muted">Move just this occurrence to {whenLocal(moveAsk.start, moveAsk.end, false)}, or shift the whole series?</p>
        </Dialog>
      )}
      <span className="sr-only">{dayKey(cursor)}</span>
    </div>
  );
}

function MiniMonth({ cursor, onPick }: { cursor: Date; onPick: (d: Date) => void }) {
  const [month, setMonth] = useState(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const [seen, setSeen] = useState(dayKey(cursor));
  if (seen !== dayKey(cursor)) {
    setSeen(dayKey(cursor));
    if (cursor.getMonth() !== month.getMonth() || cursor.getFullYear() !== month.getFullYear()) setMonth(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  }
  const first = startOfWeek(month);
  const today = new Date();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[13px] font-semibold">{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
        <div className="flex">
          <IconButton size="sm" label="Previous month" icon={<ChevronLeft className="size-3.5" />} onClick={() => setMonth(addMonths(month, -1))} />
          <IconButton size="sm" label="Next month" icon={<ChevronRight className="size-3.5" />} onClick={() => setMonth(addMonths(month, 1))} />
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10.5px] font-semibold text-subtle">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="py-1">{d}</span>)}</div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => addDays(first, i)).map((d) => {
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = sameDay(d, today);
          const sel = sameDay(d, cursor);
          return (
            <button key={dayKey(d)} type="button" onClick={() => onPick(d)} className={cx("mx-auto grid size-8 place-items-center rounded-full text-[12px] tabular-nums transition-colors", isToday ? "bg-sky-600 font-semibold text-white" : sel ? "bg-sky-500/15 font-semibold text-sky-700 dark:text-sky-300" : inMonth ? "hover:bg-surface-2" : "text-subtle hover:bg-surface-2")}>{d.getDate()}</button>
          );
        })}
      </div>
    </div>
  );
}


