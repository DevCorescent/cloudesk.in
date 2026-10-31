"use client";

// The calendar's views. Week and day: a time grid where overlapping events sit
// side by side, a red line marks now, dragging on empty space makes an event,
// and events can be dragged to move or their bottom edge dragged to resize
// (in 15-minute steps). Month: a six-week grid with "+N more". Agenda: the
// coming days as a list with join buttons.
import { CalendarCheck2, FileText, MapPin, Repeat2, Users, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/primitives";
import type { OccurrenceOut } from "@/lib/calendar/api";
import { providerName } from "@/lib/calendar/detect";
import { layoutDay } from "@/lib/calendar/layout";
import { addDays, dayKey, minutesOf, sameDay, startOfDay, startOfWeek, time, timeFull, tint } from "./shared";

const HOUR = 52;
const SNAP = 15;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** All-day, or long enough to belong in the all-day row. */
const isBanner = (e: OccurrenceOut) => e.allDay || Date.parse(e.end) - Date.parse(e.start) >= 24 * 3_600_000;
const overlaps = (e: OccurrenceOut, day: Date) => Date.parse(e.start) < addDays(day, 1).getTime() && Date.parse(e.end) > day.getTime();

export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function blockStyle(e: OccurrenceOut, past: boolean) {
  const declined = e.response === "declined";
  return {
    background: e.status === "tentative" || e.response === "tentative" ? `repeating-linear-gradient(135deg, ${tint(e.color, 16)} 0 6px, ${tint(e.color, 8)} 6px 12px)` : tint(e.color, past ? 10 : 16),
    borderLeft: `3px ${declined ? "dashed" : "solid"} ${e.color}`,
    opacity: declined ? 0.5 : past ? 0.62 : 1,
  } as const;
}

// ── Week / day ──────────────────────────────────────────────────────────────

type Drag =
  | { kind: "create"; day: number; a: number; b: number }
  | { kind: "move"; e: OccurrenceOut; grab: number; day: number; startMin: number; len: number; moved: boolean; x: number; y: number }
  | { kind: "resize"; e: OccurrenceOut; day: number; startMin: number; endMin: number };

export function TimeGrid({ days, events, now, onSelect, onCreate, onMove, selectedKey }: { days: Date[]; events: OccurrenceOut[]; now: number; selectedKey: string | null; onSelect: (e: OccurrenceOut) => void; onCreate: (start: Date, end: Date, allDay: boolean) => void; onMove: (e: OccurrenceOut, start: Date, end: Date) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  useEffect(() => {
    dragRef.current = drag;
  });

  // Open at the working day (or an hour before now).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const today = days.some((d) => sameDay(d, new Date(now)));
    el.scrollTop = Math.max(0, ((today ? minutesOf(new Date(now)) / 60 - 1.5 : 7.5) * HOUR));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the days change
  }, [days[0]?.getTime(), days.length]);

  const timed = useMemo(() => days.map((d) => layoutDay(events.filter((e) => !isBanner(e) && overlaps(e, d)), (e) => Date.parse(e.start), (e) => Date.parse(e.end))), [days, events]);
  const banners = useMemo(() => days.map((d) => events.filter((e) => isBanner(e) && overlaps(e, d))), [days, events]);

  const pos = (clientX: number, clientY: number) => {
    const r = cols.current!.getBoundingClientRect();
    const day = clamp(Math.floor(((clientX - r.left) / r.width) * days.length), 0, days.length - 1);
    const min = clamp(((clientY - r.top) / HOUR) * 60, 0, 24 * 60);
    return { day, min };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = pos(ev.clientX, ev.clientY);
      if (d.kind === "create") setDrag({ ...d, b: snap(p.min) });
      else if (d.kind === "resize") setDrag({ ...d, endMin: Math.max(d.startMin + SNAP, snap(p.min)) });
      else {
        const moved = d.moved || Math.abs(ev.clientX - d.x) + Math.abs(ev.clientY - d.y) > 4;
        setDrag({ ...d, moved, day: p.day, startMin: clamp(snap(p.min - d.grab), 0, 24 * 60 - SNAP) });
      }
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.kind === "create") {
        const a = Math.min(d.a, d.b);
        const b = Math.max(d.a, d.b);
        const start = new Date(days[d.day]!.getTime() + a * 60_000);
        onCreate(start, new Date(start.getTime() + (b - a >= SNAP ? b - a : 60) * 60_000), false);
      } else if (d.kind === "resize") {
        const start = new Date(Date.parse(d.e.start));
        onMove(d.e, start, new Date(days[d.day]!.getTime() + d.endMin * 60_000));
      } else if (!d.moved) onSelect(d.e);
      else {
        const start = new Date(days[d.day]!.getTime() + d.startMin * 60_000);
        if (start.getTime() !== Date.parse(d.e.start)) onMove(d.e, start, new Date(start.getTime() + d.len * 60_000));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listeners follow the drag's life
  }, [drag !== null]);

  const today = new Date(now);
  const nowMin = minutesOf(today);
  const maxBanners = Math.max(0, ...banners.map((b) => b.length));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Day headers and the all-day row */}
      <div className="grid shrink-0 border-b border-border pr-[var(--sbw,0px)]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))` }}>
        <div />
        {days.map((d) => {
          const isToday = sameDay(d, today);
          return (
            <div key={dayKey(d)} className="flex flex-col items-center gap-0.5 border-l border-border/60 py-2">
              <span className={cx("text-[11px] font-semibold tracking-[0.08em] uppercase", isToday ? "text-sky-600 dark:text-sky-400" : "text-muted")}>{d.toLocaleDateString("en-IN", { weekday: "short" })}</span>
              <span className={cx("grid size-8 place-items-center rounded-full text-[17px] font-semibold tabular-nums", isToday ? "bg-sky-600 text-white" : d < startOfDay(today) ? "text-muted" : "text-fg")}>{d.getDate()}</span>
            </div>
          );
        })}
        <div className="flex items-start justify-end pt-1.5 pr-2 text-[10.5px] text-subtle">all day</div>
        {days.map((d, i) => (
          <div key={dayKey(d)} className="grid content-start gap-0.5 border-l border-border/60 p-1" style={{ minHeight: Math.max(28, maxBanners * 24 + 8) }} onDoubleClick={() => onCreate(d, addDays(d, 1), true)}>
            {banners[i]!.map((e) => (
              <button key={e.key} type="button" onClick={() => onSelect(e)} className={cx("truncate rounded-[6px] px-2 py-0.5 text-left text-[11.5px] font-medium text-white", e.key === selectedKey && "ring-2 ring-fg/50", e.status === "cancelled" && "line-through opacity-60")} style={{ background: e.color }}>
                {e.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* The hours */}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))`, height: 24 * HOUR }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10.5px] text-subtle tabular-nums" style={{ top: (h + 1) * HOUR }}>
                {new Date(2026, 0, 1, h + 1).toLocaleTimeString("en-IN", { hour: "numeric" }).replace(" ", "")}
              </span>
            ))}
          </div>
          <div ref={cols} className="relative col-span-full col-start-2 grid select-none" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}>
            {/* hour lines */}
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: `linear-gradient(to bottom, var(--border) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 45%, transparent) 1px, transparent 1px)`, backgroundSize: `100% ${HOUR}px, 100% ${HOUR / 2}px` }} />
            {days.map((d, i) => {
              const isToday = sameDay(d, today);
              return (
                <div
                  key={dayKey(d)}
                  className={cx("relative border-l border-border/60", isToday && "bg-sky-500/[0.03]")}
                  onPointerDown={(ev) => {
                    if (ev.button !== 0 || ev.target !== ev.currentTarget) return;
                    const m = snap(pos(ev.clientX, ev.clientY).min - SNAP / 2);
                    setDrag({ kind: "create", day: i, a: m, b: m + 60 });
                  }}
                >
                  {timed[i]!.map(({ item: e, col, cols: n }) => {
                    const s = new Date(Date.parse(e.start));
                    const en = new Date(Date.parse(e.end));
                    const top = sameDay(s, d) ? minutesOf(s) : 0;
                    const bottom = sameDay(en, d) ? minutesOf(en) || 24 * 60 : 24 * 60;
                    const moving = drag && drag.kind !== "create" && drag.e.key === e.key;
                    const h = Math.max(18, ((bottom - top) / 60) * HOUR - 2);
                    const past = Date.parse(e.end) < now;
                    const short = h < 40;
                    return (
                      <div
                        key={e.key}
                        role="button"
                        tabIndex={0}
                        aria-label={`${e.title}, ${timeFull(s)} to ${timeFull(en)}`}
                        onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onSelect(e)}
                        onPointerDown={(ev) => {
                          if (ev.button !== 0) return;
                          ev.stopPropagation();
                          const p = pos(ev.clientX, ev.clientY);
                          setDrag({ kind: "move", e, grab: p.min - top, day: i, startMin: top, len: (Date.parse(e.end) - Date.parse(e.start)) / 60_000, moved: false, x: ev.clientX, y: ev.clientY });
                        }}
                        className={cx("group absolute cursor-pointer overflow-hidden rounded-[7px] px-1.5 text-[11.5px] leading-tight transition-shadow hover:shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)]", e.key === selectedKey && "z-10 shadow-[0_0_0_2px_var(--bg),0_0_0_3.5px_var(--fg)]", moving && "opacity-30")}
                        style={{ top: (top / 60) * HOUR + 1, height: h, left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)`, ...blockStyle(e, past) }}
                      >
                        <div className={cx("flex gap-1", short ? "items-center pt-0.5" : "flex-col pt-1")}>
                          <span className={cx("truncate font-semibold text-fg", e.status === "cancelled" && "line-through")}>
                            {e.meetingUrl && <Video className="mr-1 inline size-3 align-[-1px]" style={{ color: e.color }} />}
                            {e.title}
                          </span>
                          <span className="truncate text-muted tabular-nums">{short ? time(s) : `${timeFull(s)} – ${timeFull(en)}`}</span>
                          {!short && h > 64 && e.location && <span className="truncate text-muted">{e.location}</span>}
                        </div>
                        {e.notes !== "none" && <FileText className="absolute top-1 right-1 size-3 text-muted" />}
                        {!e.recurring && (
                          <span
                            aria-hidden
                            onPointerDown={(ev) => {
                              ev.stopPropagation();
                              setDrag({ kind: "resize", e, day: i, startMin: top, endMin: bottom });
                            }}
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100"
                            style={{ background: tint(e.color, 50) }}
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* Ghosts while dragging */}
                  {drag?.kind === "create" && drag.day === i && (
                    <div className="pointer-events-none absolute inset-x-1 rounded-[7px] border-2 border-sky-500 bg-sky-500/15 px-1.5 pt-1 text-[11.5px] font-semibold text-sky-800 dark:text-sky-200" style={{ top: (Math.min(drag.a, drag.b) / 60) * HOUR, height: Math.max(SNAP, Math.abs(drag.b - drag.a)) / 60 * HOUR }}>
                      New event · {timeFull(new Date(d.getTime() + Math.min(drag.a, drag.b) * 60_000))}
                    </div>
                  )}
                  {drag?.kind === "move" && drag.moved && drag.day === i && (
                    <div className="pointer-events-none absolute inset-x-1 rounded-[7px] border-2 px-1.5 pt-1 text-[11.5px] font-semibold shadow-lg" style={{ top: (drag.startMin / 60) * HOUR, height: (drag.len / 60) * HOUR, borderColor: drag.e.color, background: tint(drag.e.color, 22) }}>
                      {drag.e.title} · {timeFull(new Date(d.getTime() + drag.startMin * 60_000))}
                    </div>
                  )}
                  {drag?.kind === "resize" && drag.day === i && (
                    <div className="pointer-events-none absolute inset-x-1 rounded-[7px] border-2 border-dashed px-1.5 pt-1 text-[11.5px] font-semibold" style={{ top: (drag.startMin / 60) * HOUR, height: ((drag.endMin - drag.startMin) / 60) * HOUR, borderColor: drag.e.color }}>
                      until {timeFull(new Date(d.getTime() + drag.endMin * 60_000))}
                    </div>
                  )}

                  {isToday && (
                    <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin / 60) * HOUR }}>
                      <span className="-ml-1 size-2.5 rounded-full bg-red-500" />
                      <span className="h-[2px] flex-1 bg-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Month ───────────────────────────────────────────────────────────────────

export function MonthGrid({ month, events, now, onSelect, onCreate, onDay, selectedKey }: { month: Date; events: OccurrenceOut[]; now: number; selectedKey: string | null; onSelect: (e: OccurrenceOut) => void; onCreate: (start: Date, end: Date, allDay: boolean) => void; onDay: (d: Date) => void }) {
  const firstMs = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1)).getTime();
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(new Date(firstMs), i)), [firstMs]);
  const today = new Date(now);
  const byDay = useMemo(() => {
    const m = new Map<string, OccurrenceOut[]>();
    for (const d of days) m.set(dayKey(d), events.filter((e) => overlaps(e, d)).sort((a, b) => Number(isBanner(b)) - Number(isBanner(a)) || a.start.localeCompare(b.start)));
    return m;
  }, [events, days]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2 text-center text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{d}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const list = byDay.get(dayKey(d)) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = sameDay(d, today);
          return (
            <div key={dayKey(d)} className={cx("group flex min-h-[92px] min-w-0 flex-col gap-0.5 border-r border-b border-border/70 p-1", !inMonth && "bg-surface-2/40")} onDoubleClick={() => onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9), new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10), false)}>
              <button type="button" onClick={() => onDay(d)} className={cx("mb-0.5 grid size-6 place-items-center self-start rounded-full text-[12px] font-semibold tabular-nums hover:bg-fg/10", isToday ? "bg-sky-600 text-white hover:bg-sky-600" : inMonth ? "text-fg" : "text-subtle")}>{d.getDate()}</button>
              {list.slice(0, 3).map((e) =>
                isBanner(e) ? (
                  <button key={e.key} type="button" onClick={() => onSelect(e)} className={cx("truncate rounded-[5px] px-1.5 text-left text-[11px] leading-[18px] font-medium text-white", e.key === selectedKey && "ring-2 ring-fg/50")} style={{ background: e.color }}>{e.title}</button>
                ) : (
                  <button key={e.key} type="button" onClick={() => onSelect(e)} className={cx("flex min-w-0 items-center gap-1 rounded-[5px] px-1 text-left text-[11px] leading-[18px] hover:bg-fg/[0.06]", e.key === selectedKey && "bg-fg/[0.08]", Date.parse(e.end) < now && "opacity-60", e.status === "cancelled" && "line-through")}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.color }} />
                    <span className="shrink-0 text-muted tabular-nums">{time(new Date(Date.parse(e.start)))}</span>
                    <span className="truncate font-medium">{e.title}</span>
                  </button>
                ),
              )}
              {list.length > 3 && <button type="button" onClick={() => onDay(d)} className="self-start rounded-[5px] px-1 text-[11px] font-semibold text-muted hover:bg-fg/[0.06] hover:text-fg">+{list.length - 3} more</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Agenda ──────────────────────────────────────────────────────────────────

export function Agenda({ from, days, events, now, onSelect, selectedKey }: { from: Date; days: number; events: OccurrenceOut[]; now: number; selectedKey: string | null; onSelect: (e: OccurrenceOut) => void }) {
  const groups = Array.from({ length: days }, (_, i) => addDays(from, i))
    .map((d) => ({ d, list: events.filter((e) => overlaps(e, d)).sort((a, b) => a.start.localeCompare(b.start)) }))
    .filter((g) => g.list.length);
  if (!groups.length)
    return (
      <div className="grid h-full place-items-center p-10 text-center">
        <div>
          <span className="mx-auto grid size-14 place-items-center rounded-[18px] bg-sky-500/10 text-sky-600"><CalendarCheck2 className="size-6" /></span>
          <p className="mt-4 text-[15px] font-semibold">Nothing scheduled</p>
          <p className="mt-1 text-[13px] text-muted">The next {days} days are clear.</p>
        </div>
      </div>
    );
  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-8">
      <div className="mx-auto grid max-w-3xl gap-6">
        {groups.map(({ d, list }) => {
          const isToday = sameDay(d, new Date(now));
          return (
            <section key={dayKey(d)} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
              <div className="sm:pt-2">
                <p className={cx("text-[12px] font-semibold tracking-[0.06em] uppercase", isToday ? "text-sky-600" : "text-muted")}>{isToday ? "Today" : d.toLocaleDateString("en-IN", { weekday: "long" })}</p>
                <p className="text-[20px] leading-tight font-semibold">{d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
              </div>
              <ul className="grid min-w-0 gap-2">
                {list.map((e) => {
                  const s = new Date(Date.parse(e.start));
                  const en = new Date(Date.parse(e.end));
                  const live = Date.parse(e.start) <= now && Date.parse(e.end) > now;
                  return (
                    <li key={e.key} className="min-w-0">
                      <div className={cx("relative flex w-full items-stretch gap-3 rounded-[16px] border border-border bg-surface p-3 text-left transition-shadow hover:shadow-[0_8px_24px_-14px_rgb(0_0_0/0.3)]", e.key === selectedKey && "ring-2 ring-sky-500/40", Date.parse(e.end) < now && "opacity-65")}>
                        <span className="w-1 shrink-0 rounded-full" style={{ background: e.color }} />
                        <span className="w-24 shrink-0 pt-0.5 text-[12.5px] text-muted tabular-nums">{isBanner(e) ? "All day" : <>{timeFull(s)}<br />{timeFull(en)}</>}</span>
                        <span className="min-w-0 flex-1">
                          <button type="button" onClick={() => onSelect(e)} className={cx("block max-w-full truncate text-left text-[14px] font-semibold after:absolute after:inset-0 after:rounded-[16px]", e.status === "cancelled" && "line-through")}>{e.title}</button>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                            {e.meetingUrl && <span className="inline-flex items-center gap-1"><Video className="size-3.5" />{providerName(e.provider) || "Video call"}</span>}
                            {e.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{e.location}</span>}
                            {e.attendees > 0 && <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{e.attendees}</span>}
                            {e.recurring && <Repeat2 className="size-3.5" />}
                            {e.notes === "shared" && <span className="text-success">Minutes shared</span>}
                          </span>
                        </span>
                        {e.meetingUrl && Date.parse(e.end) > now && (
                          <a href={e.meetingUrl} target="_blank" rel="noreferrer" className={cx("relative z-10 self-center rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold", live ? "bg-emerald-600 text-white" : "bg-fg text-bg")}>{live ? "Join now" : "Join"}</a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
