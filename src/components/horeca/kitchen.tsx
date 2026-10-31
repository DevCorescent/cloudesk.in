"use client";

// Kitchen display: tickets (KOTs) per station with timers, bumped from new to
// cooking to ready to served.
import { ChefHat, Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, cx, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { cap, minutesSince, Pill, useH, useHAction, useHQuery } from "./shared";

type Ticket = { key: string; orderId: string; orderNo: number; kotNo: number; station: string; table: string | null; source: string; at: string; items: { id: string; name: string; qty: number; modifiers: { name: string }[]; notes: string; status: string }[] };

const NEXT: Record<string, { to: string; label: string }> = { new: { to: "preparing", label: "Start cooking" }, preparing: { to: "ready", label: "Mark ready" }, ready: { to: "served", label: "Served" } };

export function KitchenView() {
  const { venue } = useH();
  const q = useHQuery<{ tickets: Ticket[] }>("kitchen", { refetchInterval: 4000 });
  const [station, setStation] = useState("all");
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(false);
  const [full, setFull] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const bump = useHAction<{ t: Ticket; status: string }>(({ t, status }) => ({ path: "kot", body: { orderId: t.orderId, kotNo: t.kotNo, status } }));
  const item = useHAction<{ id: string; status: string }>(({ id, status }) => ({ path: `items/${id}/status`, body: { status } }));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  // A short chime when a new ticket arrives (only after the first load, and only if switched on).
  useEffect(() => {
    if (!q.data) return;
    const keys = new Set(q.data.tickets.map((t) => t.key));
    if (seen.current && sound && [...keys].some((k) => !seen.current!.has(k))) chime();
    seen.current = keys;
  }, [q.data, sound]);
  if (!q.data) return <Skeleton className="h-[70vh] rounded-[22px]" />;
  const stations = venue.settings.kitchen.stations;
  const tickets = q.data.tickets.filter((t) => station === "all" || t.station === station);
  const stateOf = (t: Ticket) => (t.items.every((i) => i.status === "ready") ? "ready" : t.items.some((i) => i.status === "preparing") ? "preparing" : "new");
  const cols = [
    { id: "new", title: "New", list: tickets.filter((t) => stateOf(t) === "new") },
    { id: "preparing", title: "Cooking", list: tickets.filter((t) => stateOf(t) === "preparing") },
    { id: "ready", title: "Ready to serve", list: tickets.filter((t) => stateOf(t) === "ready") },
  ];
  return (
    <div className={cx(full && "fixed inset-0 z-50 overflow-y-auto bg-bg p-5")}>
      <PageHeader
        title="Kitchen display"
        description="Every ticket for every station. Tap a dish to move just that one; the button moves the whole ticket."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} onClick={() => setSound(!sound)}>
              {sound ? "Chime on" : "Chime off"}
            </Button>
            <Button size="sm" icon={full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />} onClick={() => setFull(!full)}>
              {full ? "Exit full screen" : "Full screen"}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {["all", ...stations].map((s) => (
          <button key={s} type="button" onClick={() => setStation(s)} aria-pressed={station === s} className={cx("h-8 rounded-full border px-3.5 text-[13px] font-medium", station === s ? "border-fg bg-fg text-bg" : "border-border hover:bg-surface-2")}>
            {s === "all" ? "All stations" : cap(s)} <span className="ml-1 text-[11.5px] opacity-60">{q.data!.tickets.filter((t) => s === "all" || t.station === s).length}</span>
          </button>
        ))}
      </div>
      {!tickets.length ? (
        <EmptyState icon={<ChefHat />} title="All caught up" description="New orders from tables, the QR menu and the counter show up here instantly." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {cols.map((c) => (
            <section key={c.id} className="min-w-0">
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted">
                {c.title}
                <span className="rounded-full bg-surface-2 px-2 text-[11.5px]">{c.list.length}</span>
              </h2>
              <div className="grid gap-3">
                {c.list.map((t) => {
                  const mins = minutesSince(t.at, now);
                  const late = mins >= 20 && c.id !== "ready";
                  const next = NEXT[c.id];
                  return (
                    <article key={t.key} className={cx("overflow-hidden rounded-[18px] border bg-surface shadow-sm", late ? "border-danger/60" : "border-border")}>
                      <header className={cx("flex items-center justify-between px-4 py-2.5", c.id === "ready" ? "bg-success-soft" : late ? "bg-danger-soft" : c.id === "preparing" ? "bg-[#fff1e6] dark:bg-[#2a1a10]" : "bg-surface-2")}>
                        <div>
                          <p className="text-[16px] font-bold">{t.table ?? (t.source === "takeaway" ? "Takeaway" : "Counter")}</p>
                          <p className="text-[11.5px] text-muted">
                            KOT {t.kotNo} · order #{t.orderNo} · {cap(t.station)}
                          </p>
                        </div>
                        <span className={cx("text-[15px] font-bold tabular-nums", late && "text-danger")}>{mins}m</span>
                      </header>
                      <ul className="divide-y divide-border">
                        {t.items.map((i) => (
                          <li key={i.id}>
                            <button type="button" onClick={() => NEXT[i.status] && item.mutate({ id: i.id, status: NEXT[i.status].to })} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                              <span className="text-[17px] font-bold tabular-nums">{i.qty}</span>
                              <span className="min-w-0 flex-1">
                                <span className={cx("block text-[14.5px] font-medium", i.status === "ready" && "text-success")}>{i.name}</span>
                                {i.modifiers.length > 0 && <span className="block text-[12px] text-muted">{i.modifiers.map((m) => m.name).join(" · ")}</span>}
                                {i.notes && <span className="mt-0.5 block rounded-[6px] bg-warning-soft px-1.5 text-[12px] font-medium text-warning">⚠ {i.notes}</span>}
                              </span>
                              <Pill status={i.status} />
                            </button>
                          </li>
                        ))}
                      </ul>
                      {next && (
                        <div className="p-3">
                          <Button className="w-full" variant={c.id === "ready" ? "secondary" : "primary"} loading={bump.isPending && bump.variables?.t.key === t.key} onClick={() => bump.mutate({ t, status: next.to })}>
                            {next.label}
                          </Button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.45);
    });
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}
