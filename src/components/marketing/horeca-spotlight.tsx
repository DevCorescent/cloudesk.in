"use client";

// Homepage spotlight for Cloudesk for Horeca: pick a module on the left and its
// real screen (and, for the guest side, a real phone screen) shows on the right.
// Steps on its own while in view; stands still on hover and for reduced motion.
import clsx from "clsx";
import { ArrowRight, BedDouble, CalendarClock, CarFront, Carrot, ChartColumn, ChefHat, LayoutGrid, LockKeyhole, Monitor, QrCode, Users, Wine } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FitLine, Mark, Reveal } from "./interactive";
import { PhoneFrame } from "./phone-deck";
import { Eyebrow, H2, W } from "./sections";
import { ShotFrame } from "./shot-tour";

type Module = { key: string; icon: ReactNode; title: string; line: string; shot: string; alt: string; phone?: { src: string; alt: string } };

const MODULES: Module[] = [
  { key: "pos", icon: <Monitor />, title: "Full-screen POS", line: "Dine-in, takeaway, delivery and rooms — codes, KOTs, split pay.", shot: "pos", alt: "The full-screen POS with table T4's ticket, dish codes and covers" },
  { key: "staff", icon: <LockKeyhole />, title: "Staff PINs & lock", line: "Each person unlocks with a PIN; managers approve voids and discounts.", shot: "lock", alt: "The lock screen with a tile for each staff member" },
  { key: "qr", icon: <QrCode />, title: "QR ordering", line: "Guests scan, order, call a waiter and ask for the bill.", shot: "qr", alt: "A printable QR code for every table, grouped by area", phone: { src: "/marketing/horeca/phone-menu.jpg", alt: "The guest QR menu for Saffron House on a phone" } },
  { key: "floor", icon: <LayoutGrid />, title: "Floor & bills", line: "Live tables; move, merge and split; GST and charge-to-room.", shot: "floor", alt: "The floor plan with an open order for table T5", phone: { src: "/marketing/horeca/phone-track.jpg", alt: "A guest following their order on a phone" } },
  { key: "kitchen", icon: <ChefHat />, title: "Kitchen display", line: "Tickets by station, timed, bumped in one tap.", shot: "kitchen", alt: "Kitchen tickets in New, Cooking and Ready columns" },
  { key: "reservations", icon: <CalendarClock />, title: "Reservations", line: "Bookings, an online booking page and the walk-in waitlist.", shot: "reservations", alt: "Tonight's bookings with tables, covers and a waitlist" },
  { key: "stock", icon: <Carrot />, title: "Stock & food cost", line: "Recipes take ingredients out of stock; food cost per dish.", shot: "food-cost", alt: "Food cost and margin per dish from its recipe" },
  { key: "guests", icon: <Users />, title: "Guests & loyalty", line: "Regulars by phone, points on every bill.", shot: "guests", alt: "Guests with visits, spend and loyalty points" },
  { key: "reports", icon: <ChartColumn />, title: "Till & reports", line: "Close the till by counting; GST, staff and hourly reports.", shot: "reports", alt: "The sales report with busiest hours, bill breakdown and payments" },
  { key: "rooms", icon: <BedDouble />, title: "Room bookings", line: "Calendar, check-in, folios and housekeeping.", shot: "rooms", alt: "The room booking calendar with reserved and in-house guests" },
  { key: "bar", icon: <Wine />, title: "Bar inventory", line: "Every peg deducted in ml; counts show what's missing.", shot: "bar", alt: "Bar stock by bottle with pours and days left" },
  { key: "valet", icon: <CarFront />, title: "Valet parking", line: "Tickets, pre-bookings and “Bring my car”.", shot: "valet", alt: "The valet board with requested, ready and parked cars", phone: { src: "/marketing/horeca/phone-valet.jpg", alt: "The guest's valet page while their car is brought round" } },
];
const STEP_MS = 5200;

export function HorecaSpotlight() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [still, setStill] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    if (box.current) io.observe(box.current);
    return () => {
      mq.removeEventListener("change", sync);
      io.disconnect();
    };
  }, []);
  const running = inView && !paused && !still;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % MODULES.length), STEP_MS);
    return () => clearTimeout(t);
  }, [running, active]);
  const m = MODULES[active];
  return (
    <section className="relative overflow-x-clip py-16 sm:py-24">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full" style={{ background: "radial-gradient(55% 45% at 70% 35%, color-mix(in srgb, var(--tint-peach) 70%, transparent), transparent 70%)" }} />
      <div className={W}>
        <Reveal className="grid grid-cols-1 items-end gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <Eyebrow tone="peach">New · Cloudesk for Horeca</Eyebrow>
            <h2 className={clsx(H2, "mt-5")}>
              <FitLine>
                Restaurants, bars &amp; hotels. <Mark tone="peach">One screen.</Mark>
              </FitLine>
            </h2>
          </div>
          <p className="text-[17px] leading-relaxed text-fg/55 lg:pb-2">A full-screen POS with staff PINs, QR ordering, a kitchen display, reservations, recipes and stock, loyalty, the till and reports — plus rooms, bar and valet. All connected, all in the same app as your website.</p>
        </Reveal>
        <Reveal delay={100} className="mt-12 sm:mt-14">
          <div ref={box} className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-10" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
            <div role="tablist" aria-label="Cloudesk for Horeca modules" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:content-start lg:gap-1.5 lg:overflow-visible lg:px-0">
              {MODULES.map((x, i) => {
                const on = i === active;
                return (
                  <button
                    key={x.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    aria-controls="horeca-stage"
                    onClick={() => setActive(i)}
                    className={clsx("group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-[18px] px-4 py-3 text-left transition-colors lg:items-start lg:py-2.5", on ? "bg-bg shadow-[0_10px_30px_-18px_rgb(60_30_10/0.45)] ring-1 ring-fg/[0.07]" : "hover:bg-fg/[0.03]")}
                  >
                    <span className={clsx("grid size-9 shrink-0 place-items-center rounded-[12px] transition-colors [&_svg]:size-[18px]", on ? "bg-[var(--p-peach)] text-[var(--p-peach-ink)]" : "bg-fg/[0.05] text-fg/50")}>{x.icon}</span>
                    <span className="min-w-0">
                      <span className={clsx("block text-[15px] font-medium tracking-[-0.01em] whitespace-nowrap", !on && "text-fg/70")}>{x.title}</span>
                      <span className={clsx("mt-0.5 hidden text-[13px] leading-snug text-fg/50 lg:block", !on && "lg:hidden")}>{x.line}</span>
                    </span>
                    {on && running && <span aria-hidden key={`${active}`} className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-[var(--p-peach-ink)]" style={{ animation: `bs-progress ${STEP_MS}ms linear forwards` }} />}
                  </button>
                );
              })}
              <Link href="/features/horeca" className="mt-3 hidden items-center gap-1.5 px-4 text-[14px] font-medium lg:inline-flex">
                Explore Cloudesk for Horeca <ArrowRight className="size-4" />
              </Link>
            </div>
            <div id="horeca-stage" role="tabpanel" aria-label={m.title} className="relative pb-[16%] sm:pb-[10%] lg:pr-[9%] lg:pb-[6%]">
              <div className="relative">
                {MODULES.map((x, i) => (
                  <div key={x.key} aria-hidden={i !== active} className={clsx("transition-[opacity,transform] duration-700 ease-[cubic-bezier(.2,.7,.2,1)]", i === 0 ? "relative" : "absolute inset-0", i === active ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0")}>
                    <ShotFrame shot={{ src: `/marketing/horeca/${x.shot}.jpg`, w: 2880, h: 1800, alt: x.alt }} url="Cloudesk for Horeca" sizes="(min-width: 1024px) 60vw, 100vw" />
                  </div>
                ))}
              </div>
              {MODULES.map((x, i) =>
                x.phone ? (
                  <div key={x.key} aria-hidden={i !== active} className={clsx("absolute right-0 bottom-0 w-[24%] max-w-[230px] min-w-[96px] transition-[opacity,transform] duration-700 ease-[cubic-bezier(.2,.7,.2,1)]", i === active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0")}>
                    <PhoneFrame src={x.phone.src} alt={x.phone.alt} />
                  </div>
                ) : null,
              )}
            </div>
            <p className="-mt-2 text-[14px] text-fg/55 lg:hidden">{m.line}</p>
          </div>
        </Reveal>
        <Reveal className="mt-10 flex flex-wrap items-center gap-3 lg:mt-12">
          {["Manager approvals", "Move, merge & split", "CGST/SGST bills", "Happy hours", "Food cost per dish", "Multi-outlet", "Charge to room"].map((c) => (
            <span key={c} className="inline-flex items-center rounded-full bg-bg/70 px-3.5 py-2 text-[13px] font-medium ring-1 ring-fg/[0.06]">
              {c}
            </span>
          ))}
          <Link href="/features/horeca" className="p-cta ml-auto inline-flex items-center gap-2 px-7 lg:hidden">
            Explore Horeca <ArrowRight className="size-4" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
