"use client";

import { ArrowRight, BedDouble, CarFront, ChefHat, LayoutGrid, QrCode, Wine } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/primitives";
import { sortTables, Stat, useH, useHQuery, useMoney } from "./shared";

type Today = { sales: number; orders: number; average: number; open: number; methods: Record<string, number>; sources: Record<string, number>; topItems: { name: string; qty: number }[] };
type Floor = { areas: { id: string }[]; tables: { id: string; name: string; kind: string; areaId: string | null; order: { status: string; ready: number; pending: number } | null; requests: { kind: string }[] }[] };

export function OverviewView() {
  const { base, venue } = useH();
  const money = useMoney();
  const today = useHQuery<Today>("today", { refetchInterval: 15000 });
  const floor = useHQuery<Floor>("floor", { refetchInterval: 10000 });
  const rooms = useHQuery<{ stats: { rooms: number; occupied: number; arrivals: number; departures: number; dirty: number } }>("calendar?days=7");
  const valet = useHQuery<{ stats: { parked: number; requested: number; booked: number; free: number; slots: number } }>("valet", { refetchInterval: 15000 });
  const bar = useHQuery<{ items: { name: string; low: boolean; active: boolean }[]; low: number; value: number }>("bar");
  const t = today.data;
  const dining = sortTables(floor.data?.tables ?? [], floor.data?.areas).filter((x) => x.kind !== "room");
  const busy = dining.filter((x) => x.order).length;
  const calls = (floor.data?.tables ?? []).reduce((a, x) => a + x.requests.length, 0);
  const ready = (floor.data?.tables ?? []).reduce((a, x) => a + (x.order?.ready ?? 0), 0);
  const methods = Object.entries(t?.methods ?? {});
  const methodTotal = methods.reduce((a, [, v]) => a + v, 0);
  const label: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", room: "Charged to room", other: "Other" };
  return (
    <div>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${venue.name}`} description="Today at a glance. Everything updates live." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales today" value={money(t?.sales ?? 0)} sub={`${t?.orders ?? 0} bills closed`} />
        <Stat label="Average bill" value={money(t?.average ?? 0)} sub="paid orders" />
        <Stat label="Tables in use" value={`${busy}/${dining.length}`} sub={`${t?.open ?? 0} open orders`} />
        <Stat label="Needs attention" value={calls + ready} sub={`${calls} guest calls · ${ready} dishes ready`} tone={calls + ready ? "warn" : undefined} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <section className="rounded-[22px] border border-border bg-surface p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Floor right now</h2>
            <Link href={`${base}/floor`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">
              Open floor <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {dining.slice(0, 32).map((x) => {
              const st = x.requests.length ? "call" : x.order?.status === "billed" || x.order?.pending ? "billed" : x.order?.ready ? "ready" : x.order ? "busy" : "free";
              const tone = { free: "bg-surface-2 text-muted", busy: "bg-[#fde7d4] text-[#9a3412] dark:bg-[#3a2416] dark:text-[#fdba74]", ready: "bg-success-soft text-success", billed: "bg-[#e0e7ff] text-[#3730a3] dark:bg-[#1e1b4b] dark:text-[#a5b4fc]", call: "bg-danger-soft text-danger animate-pulse" }[st];
              return (
                <Link key={x.id} href={`${base}/floor`} className={`grid aspect-square place-items-center rounded-[14px] text-[13px] font-bold ${tone}`}>
                  {x.name}
                </Link>
              );
            })}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
            <span>■ Free</span>
            <span className="text-[#c2410c]">■ Seated</span>
            <span className="text-success">■ Food ready</span>
            <span className="text-[#4f46e5]">■ Bill printed / to confirm</span>
            <span className="text-danger">■ Guest calling</span>
          </p>
        </section>
        <section className="rounded-[22px] border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-[15px] font-semibold">Best sellers today</h2>
          {t?.topItems.length ? (
            <ol className="mt-3 grid gap-2">
              {t.topItems.map((i, n) => (
                <li key={i.name} className="flex items-center justify-between text-[13.5px]">
                  <span className="truncate">
                    <b className="mr-2 text-muted tabular-nums">{n + 1}</b>
                    {i.name}
                  </span>
                  <span className="tabular-nums text-muted">× {i.qty}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[13px] text-muted">Closed bills will show what sold best.</p>
          )}
          {methods.length > 0 && (
            <div className="mt-5">
              <p className="text-[12px] font-medium text-muted">Payments</p>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                {methods.map(([m, v], i) => (
                  <span key={m} title={`${label[m] ?? m}: ${money(v)}`} style={{ width: `${(v / methodTotal) * 100}%`, background: ["#b4532a", "#2f6b4f", "#2d4fa3", "#8a3ffc", "#6b7280"][i % 5] }} />
                ))}
              </div>
              <ul className="mt-2 grid gap-1 text-[12.5px]">
                {methods.map(([m, v], i) => (
                  <li key={m} className="flex justify-between">
                    <span className="flex items-center gap-1.5">
                      <i className="size-2 rounded-full" style={{ background: ["#b4532a", "#2f6b4f", "#2d4fa3", "#8a3ffc", "#6b7280"][i % 5] }} />
                      {label[m] ?? m}
                    </span>
                    <span className="tabular-nums">{money(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "kitchen", icon: <ChefHat />, title: "Kitchen display", line: `${(floor.data?.tables ?? []).reduce((a, x) => a + (x.order?.pending ?? 0), 0)} awaiting OK` },
          { href: "rooms", icon: <BedDouble />, title: "Rooms", line: rooms.data?.stats.rooms ? `${rooms.data.stats.occupied}/${rooms.data.stats.rooms} occupied · ${rooms.data.stats.arrivals} arriving` : "Set up rooms" },
          { href: "bar", icon: <Wine />, title: "Bar", line: bar.data?.items.length ? `${bar.data.low} low · ${money(bar.data.value)} in stock` : "Add your bottles" },
          { href: "valet", icon: <CarFront />, title: "Valet", line: valet.data ? `${valet.data.stats.parked} parked · ${valet.data.stats.requested} requested` : "—" },
        ].map((c) => (
          <Link key={c.href} href={`${base}/${c.href}`} className="group flex items-center gap-3 rounded-[18px] border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md [&>span:first-child_svg]:size-5">
            <span className="grid size-10 place-items-center rounded-[12px] bg-surface-2">{c.icon}</span>
            <span className="min-w-0">
              <b className="block text-[14px]">{c.title}</b>
              <span className="block truncate text-[12.5px] text-muted">{c.line}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[12.5px] text-muted">
        <LayoutGrid className="size-3.5" /> Tip: print table QR codes under <Link href={`${base}/qr`} className="font-medium text-accent">QR menu & tables <QrCode className="inline size-3" /></Link>
      </div>
    </div>
  );
}
