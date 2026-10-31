"use client";

// Cloudesk for Horeca: the module shell — section navigation, the operator
// (who unlocked the till), the lock screen, manager approvals, full-screen
// mode, and first-time setup.
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, BedDouble, Boxes, Building2, CalendarClock, CarFront, ChefHat, Gauge, LayoutGrid, Lock, Maximize2, Minimize2, MonitorSmartphone, QrCode, Settings2, Users, UtensilsCrossed, Wallet, Wine } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/overlays";
import { Button, cx, ErrorState, Field, Input, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { useQuery } from "@tanstack/react-query";
import { VENUE_KINDS } from "@/lib/horeca/model";
import { BarView } from "./bar";
import { FloorView } from "./floor";
import { GuestsView } from "./guests";
import { InventoryView } from "./inventory";
import { KitchenView } from "./kitchen";
import { MenuView } from "./menu";
import { OutletsView } from "./outlets";
import { OverviewView } from "./overview";
import { PosView } from "./pos";
import { QrView } from "./qr";
import { ReportsView } from "./reports";
import { ReservationsView } from "./reservations";
import { RoomsView } from "./rooms";
import { ApprovalPrompt, LockScreen } from "./security";
import { SettingsView } from "./settings";
import { hApi, HorecaProvider, type Operator, type Venue } from "./shared";
import { TillView } from "./till";
import { ValetView } from "./valet";

type Section = "pos" | "rooms" | "bar" | "valet" | "inventory" | "reservations" | "guests";
const NAV: { id: string; label: string; icon: ReactNode; section?: Section; group?: string }[] = [
  { id: "", label: "Overview", icon: <Gauge /> },
  { id: "pos", label: "POS", icon: <MonitorSmartphone />, section: "pos" },
  { id: "floor", label: "Floor & orders", icon: <LayoutGrid /> },
  { id: "kitchen", label: "Kitchen display", icon: <ChefHat /> },
  { id: "reservations", label: "Reservations", icon: <CalendarClock />, section: "reservations" },
  { id: "menu", label: "Menu", icon: <UtensilsCrossed />, group: "Manage" },
  { id: "qr", label: "QR menu & tables", icon: <QrCode /> },
  { id: "inventory", label: "Kitchen stock", icon: <Boxes />, section: "inventory" },
  { id: "bar", label: "Bar inventory", icon: <Wine />, section: "bar" },
  { id: "rooms", label: "Rooms", icon: <BedDouble />, section: "rooms" },
  { id: "valet", label: "Valet parking", icon: <CarFront />, section: "valet" },
  { id: "guests", label: "Guests & loyalty", icon: <Users />, section: "guests", group: "Business" },
  { id: "till", label: "Till & cash", icon: <Wallet /> },
  { id: "reports", label: "Reports", icon: <BarChart3 /> },
  { id: "outlets", label: "Outlets", icon: <Building2 /> },
  { id: "settings", label: "Settings", icon: <Settings2 /> },
];

/** Per-device memory (the lock and full-screen state), ignored when storage is blocked. */
const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* storage blocked: state lasts until reload */
    }
  },
};

export function HorecaAdmin({ projectId, path }: { projectId: string; path: string[] }) {
  const q = useQuery({ queryKey: ["horeca", projectId, "venue"], queryFn: () => api<{ venue: Venue | null }>(hApi(projectId, "venue")) });
  const staff = useQuery({ queryKey: ["horeca", projectId, "staff"], queryFn: () => api<{ staff: { id: string; name: string; role: string; active: boolean }[] }>(hApi(projectId, "staff")), enabled: !!q.data?.venue });
  const base = `/projects/${projectId}/horeca`;
  const [section = "", id] = path;
  const key = `horeca:${projectId}`;
  const [operator, setOperator] = useState<Operator | null>(() => {
    const raw = store.get(`${key}:operator`);
    try {
      return raw ? (JSON.parse(raw) as Operator) : null;
    } catch {
      return null;
    }
  });
  const [locked, setLocked] = useState(() => store.get(`${key}:locked`) === "1");
  const [fullscreen, setFs] = useState(() => store.get(`${key}:fs`) === "1");
  const [approval, setApproval] = useState<{ why: string; resolve: (pin: string | null) => void } | null>(null);
  const hasStaff = (staff.data?.staff ?? []).some((s) => s.active);
  const lock = useCallback(() => {
    setLocked(true);
    setOperator(null);
    store.set(`${key}:locked`, "1");
    store.set(`${key}:operator`, null);
  }, [key]);
  const unlock = (o: Operator) => {
    setOperator(o);
    setLocked(false);
    store.set(`${key}:locked`, null);
    store.set(`${key}:operator`, JSON.stringify(o));
  };
  const setFullscreen = useCallback(
    (v: boolean) => {
      setFs(v);
      store.set(`${key}:fs`, v ? "1" : null);
      try {
        if (v && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
        if (!v && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      } catch {
        /* the browser said no: the in-page full screen still applies */
      }
    },
    [key],
  );
  const requestApproval = useCallback((why: string) => new Promise<string | null>((resolve) => setApproval({ why, resolve })), []);

  // Auto-lock after the venue's idle time (only when staff can unlock it again).
  const minutes = q.data?.venue?.settings.security.autoLockMinutes ?? 0;
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!minutes || !hasStaff || locked) return;
    const reset = () => {
      clearTimeout(idle.current);
      idle.current = setTimeout(lock, minutes * 60_000);
    };
    reset();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(idle.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, hasStaff, locked, lock]);

  if (q.isError) return <Page><ErrorState title="Couldn't load Cloudesk for Horeca" message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Page>;
  if (!q.data) return <Page><Skeleton className="h-[70vh] rounded-[22px]" /></Page>;
  if (!q.data.venue) return <Page><Setup projectId={projectId} /></Page>;
  const venue = q.data.venue;
  const sections = venue.settings.sections;
  const nav = NAV.filter((n) => !n.section || sections[n.section]);
  const showLock = hasStaff && (locked || !operator || !staff.data!.staff.some((s) => s.id === operator.id && s.active));

  let body: ReactNode;
  switch (section) {
    case "pos":
      body = <PosView orderId={id} />;
      break;
    case "floor":
      body = <FloorView orderId={id} />;
      break;
    case "kitchen":
      body = <KitchenView />;
      break;
    case "reservations":
      body = <ReservationsView />;
      break;
    case "menu":
      body = <MenuView />;
      break;
    case "qr":
      body = <QrView />;
      break;
    case "inventory":
      body = <InventoryView />;
      break;
    case "rooms":
      body = <RoomsView bookingId={id} />;
      break;
    case "bar":
      body = <BarView />;
      break;
    case "valet":
      body = <ValetView />;
      break;
    case "guests":
      body = <GuestsView guestId={id} />;
      break;
    case "till":
      body = <TillView />;
      break;
    case "reports":
      body = <ReportsView />;
      break;
    case "outlets":
      body = <OutletsView />;
      break;
    case "settings":
      body = <SettingsView />;
      break;
    default:
      body = <OverviewView />;
  }
  const immersive = section === "pos";
  const ctx = { projectId, venue, base, operator, lock, requestApproval, fullscreen, setFullscreen };
  return (
    <HorecaProvider value={ctx}>
      {immersive ? (
        // The POS always fills the window.
        <div className="fixed inset-0 z-50 bg-bg">{body}</div>
      ) : (
        <div className={cx(fullscreen ? "fixed inset-0 z-50 overflow-y-auto bg-bg" : "")}>
          <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[210px_minmax(0,1fr)] lg:py-8">
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <div className="mb-3 hidden px-2 lg:block">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">Cloudesk for Horeca</p>
                <p className="mt-1 truncate text-[14px] font-semibold">{venue.name}</p>
              </div>
              <nav aria-label="Horeca" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
                {nav.map((n) => {
                  const on = section === n.id;
                  return (
                    <div key={n.id} className="contents">
                      {n.group && <p className="hidden px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">{n.group}</p>}
                      <Link href={n.id ? `${base}/${n.id}` : base} aria-current={on ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4", on ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                        {n.icon}
                        {n.label}
                      </Link>
                    </div>
                  );
                })}
              </nav>
              <div className="mt-4 hidden gap-2 px-1 lg:grid">
                {operator && (
                  <p className="truncate rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px]">
                    <span className="text-muted">At the till:</span> <b className="font-semibold">{operator.name}</b>
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" icon={fullscreen ? <Minimize2 className="size-3.5 shrink-0" /> : <Maximize2 className="size-3.5 shrink-0" />} onClick={() => setFullscreen(!fullscreen)}>
                    {fullscreen ? "Exit" : "Full screen"}
                  </Button>
                  <Button size="sm" icon={<Lock className="size-3.5 shrink-0" />} disabled={!hasStaff} title={hasStaff ? "Lock the screen" : "Add staff with PINs in Settings to use the lock"} onClick={lock}>
                    Lock
                  </Button>
                </div>
              </div>
            </aside>
            <main className="min-w-0">{body}</main>
          </div>
        </div>
      )}
      {showLock && <LockScreen projectId={projectId} venueName={venue.name} staff={staff.data!.staff} onUnlock={unlock} />}
      {approval && (
        <ApprovalPrompt
          why={approval.why}
          onDone={(pin) => {
            approval.resolve(pin);
            setApproval(null);
          }}
        />
      )}
    </HorecaProvider>
  );
}

const Page = ({ children }: { children: ReactNode }) => <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 lg:py-8">{children}</div>;

function Setup({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof VENUE_KINDS)[number]["id"]>("restaurant");
  const [tables, setTables] = useState(10);
  const [gst, setGst] = useState("5");
  const [service, setService] = useState("0");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await api(hApi(projectId, "venue"), { method: "PUT", body: { name: name.trim(), kind, taxBps: Math.round(Number(gst) * 100), serviceChargeBps: Math.round(Number(service) * 100) } });
      if (tables > 0) {
        const { area } = await api<{ area: { id: string } }>(hApi(projectId, "areas"), { method: "POST", body: { name: kind === "hotel" ? "Restaurant" : "Main floor" } });
        await api(hApi(projectId, "tables/bulk"), { method: "POST", body: { areaId: area.id, prefix: "T", count: tables, seats: 4 } });
      }
      await qc.invalidateQueries({ queryKey: ["horeca", projectId] });
      toast({ tone: "success", title: "You're set up", description: "Add your menu next, then print the table QR codes." });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't set up", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const art: Record<string, string> = { restaurant: "🍽️", cafe: "☕", bar: "🍸", hotel: "🏨", cloud_kitchen: "🛵" };
  return (
    <div className="overflow-hidden rounded-[28px] border border-border bg-surface shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[1.05fr_1fr]">
        <div className="p-6 sm:p-10">
          <p className="text-[12px] font-semibold tracking-[0.16em] text-muted uppercase">Cloudesk for Horeca</p>
          <h1 className="mt-3 text-[clamp(1.6rem,3vw,2.3rem)] leading-[1.08] font-semibold tracking-[-0.03em]">Run your restaurant, café, bar or hotel from one screen.</h1>
          <p className="mt-3 max-w-lg text-[14.5px] text-muted">QR ordering at every table, a live kitchen display, bills with GST, room bookings, bar stock to the millilitre and valet parking — all connected.</p>
          <div className="mt-7 grid gap-4">
            <Field label="Venue name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Saffron House" maxLength={120} autoFocus />}</Field>
            <div>
              <p className="mb-2 text-[13px] font-medium">What kind of place?</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {VENUE_KINDS.map((k) => (
                  <button key={k.id} type="button" onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className={cx("flex items-center gap-2.5 rounded-[14px] border p-3 text-left text-[13.5px] font-semibold transition-colors", kind === k.id ? "border-fg bg-surface-2" : "border-border hover:bg-surface-2")}>
                    <span className="text-[20px]">{art[k.id]}</span>
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Tables to start with">{(a) => <Input {...a} type="number" min={0} max={60} value={tables} onChange={(e) => setTables(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} />}</Field>
              <Field label="GST on food (%)">{(a) => <Input {...a} inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} />}</Field>
              <Field label="Service charge (%)">{(a) => <Input {...a} inputMode="decimal" value={service} onChange={(e) => setService(e.target.value)} />}</Field>
            </div>
            <Button variant="primary" className="justify-self-start" loading={busy} disabled={name.trim().length < 2} onClick={create}>
              Set up {name.trim() || "my venue"}
            </Button>
          </div>
        </div>
        <div className="hidden bg-gradient-to-br from-[#fbe8d8] via-[#f6efe6] to-[#e7e1f5] p-10 lg:block dark:from-[#2a1d14] dark:via-[#1c1a17] dark:to-[#1d1a2a]">
          <ul className="grid gap-3">
            {[
              ["📱", "QR ordering", "Guests scan, order and ask for the bill — orders land on the kitchen screen."],
              ["👨‍🍳", "Kitchen display", "Tickets by station with timers, from new to served."],
              ["🛏️", "Rooms", "Calendar, check-in and check-out, folios with room service."],
              ["🍸", "Bar inventory", "Every pour deducted in ml; counts show the variance."],
              ["🚗", "Valet", "Tickets, pre-bookings and “bring my car” from the guest's phone."],
            ].map(([e, t, d]) => (
              <li key={t} className="flex gap-3 rounded-[18px] bg-white/70 p-4 shadow-sm backdrop-blur dark:bg-white/5">
                <span className="text-[22px]">{e}</span>
                <span>
                  <b className="block text-[14px]">{t}</b>
                  <span className="text-[13px] text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
