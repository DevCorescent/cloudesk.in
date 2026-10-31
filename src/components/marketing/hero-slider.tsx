"use client";

// The hero banner. Behind the headline's glass panel, each major feature gets
// a living composition of real screenshots: the desktop screen tilted in 3D
// and drifting slowly, the same feature on a phone in front, and a real panel
// from the app floating beside them. Moves on by itself while on screen,
// pauses on hover, swipes on touch, and stays put for people who prefer
// reduced motion.
import clsx from "clsx";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PhoneFrame } from "./phone-deck";
import { ShotFrame, type Shot } from "./shot-tour";

const SLIDE_MS = 6000;
const desk = (path: string, alt: string): Shot => ({ src: `/marketing/${path}.jpg`, w: 2880, h: 1800, alt });

type Slide = {
  key: string;
  /** What this screen lets you do, shown on the screen's label. */
  label: string;
  desktop: Shot;
  phone: { slug: string; alt: string };
  panel?: Shot;
};

export const HERO_SLIDES: Slide[] = [
  {
    key: "build",
    label: "Website builder",
    desktop: desk("builder/overview", "The website builder with a café homepage being edited"),
    phone: { slug: "website-builder", alt: "A spa website made with the builder, on a phone" },
  },
  {
    key: "store",
    label: "Online store",
    desktop: desk("store/sf-home", "A streetwear storefront home page"),
    phone: { slug: "online-store", alt: "The same storefront on a phone" },
    panel: desk("store/orders", "The orders list with paid and delivered orders"),
  },
  {
    key: "pos",
    label: "Point of sale",
    desktop: desk("pos/till", "The point-of-sale till with products and a cart"),
    phone: { slug: "point-of-sale", alt: "The till on a phone" },
    panel: { src: "/marketing/pos/done-panel.jpg", w: 700, h: 565, alt: "Sale complete: ₹1,158 with change to give" },
  },
  {
    key: "finance",
    label: "Invoicing & Finance",
    desktop: desk("finance/overview", "The Finance overview with money owed, collected and overdue"),
    phone: { slug: "invoicing", alt: "Finance on a phone" },
    panel: { src: "/marketing/finance/share-panel.jpg", w: 1176, h: 804, alt: "Sharing an invoice on WhatsApp with a pay-by-UPI link" },
  },
  {
    key: "bookings",
    label: "Bookings",
    desktop: desk("bookings/upcoming", "Upcoming spa bookings by day"),
    phone: { slug: "bookings", alt: "Choosing a time to book, on a phone" },
    panel: { src: "/marketing/bookings/form-panel.jpg", w: 1488, h: 1116, alt: "The booking form with Confirm booking" },
  },
  {
    key: "promos",
    label: "Promotions",
    desktop: desk("promotions/list", "Live pop-ups, bars and cart offers with their views and sign-ups"),
    phone: { slug: "promotions", alt: "A 10% off pop-up on a bakery's site, on a phone" },
  },
];

/** One slide's screens. `state` drives the enter/leave motion. */
function Stage({ s, state, still, priority }: { s: Slide; state: "on" | "off"; still: boolean; priority: boolean }) {
  return (
    <div aria-hidden={state === "off"} data-state={state} className="hb-stage absolute inset-0">
      {/* Ambient colour: the same screen, blurred to a glow */}
      <div className="hb-ambient absolute inset-0">
        <Image src={s.desktop.src} alt="" fill sizes="40vw" className="scale-125 object-cover blur-[70px] saturate-150" priority={priority} />
      </div>
      {/* The desktop screen, tilted and drifting */}
      <div className="hb-desk absolute">
        <div className={clsx("hb-tilt", !still && state === "on" && "hb-drift")}>
          <ShotFrame shot={s.desktop} priority={priority} sizes="(min-width: 1024px) 62vw, 140vw" className="hb-shot" />
        </div>
      </div>
      {/* A real panel from the app */}
      {s.panel && (
        <div className={clsx("hb-panel absolute", !still && state === "on" && "hb-bob")}>
          <div className="overflow-hidden rounded-[18px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.6)] ring-1 ring-white/30">
            <Image src={s.panel.src} alt={s.panel.alt} width={s.panel.w} height={s.panel.h} sizes="22vw" className="block h-auto w-full" />
          </div>
        </div>
      )}
      {/* The same feature on a phone */}
      <div className={clsx("hb-phone absolute", !still && state === "on" && "hb-float")}>
        <PhoneFrame src={`/marketing/phones/${s.phone.slug}.jpg`} alt={s.phone.alt} priority={priority} />
      </div>
    </div>
  );
}

export function HeroBanner({ children }: { children: ReactNode }) {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(true);
  const [still, setStill] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    const el = ref.current;
    const io = el && typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.2 }) : null;
    if (el) io?.observe(el);
    return () => {
      io?.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, []);

  const go = (n: number) => setI((n + HERO_SLIDES.length) % HERO_SLIDES.length);
  const paused = hover || !inView || still;

  // Move to the next feature's screens every few seconds while visible.
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((n) => (n + 1) % HERO_SLIDES.length), SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, paused]);

  return (
    <section
      ref={ref}
      className="hero relative isolate flex w-full flex-col overflow-hidden rounded-b-[36px] bg-[#100e17] sm:rounded-b-[56px] lg:min-h-[min(calc(100dvh-4rem),960px)]"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
      }}
    >
      {/* The banner: real screens behind everything */}
      <div className="hb-scene absolute inset-0 -z-10" role="group" aria-roledescription="carousel" aria-label="Real screens from Cloudesk">
        {HERO_SLIDES.map((sl, k) => (
          <Stage key={sl.key} s={sl} state={k === i ? "on" : "off"} still={still} priority={k === 0} />
        ))}
        <div aria-hidden className="hb-shade pointer-events-none absolute inset-0" />
        <div aria-hidden className="hero-grain pointer-events-none absolute inset-0" />
      </div>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-center px-3 pt-[56vw] pb-6 sm:px-8 sm:pt-[34vw] sm:pb-10 lg:px-14 lg:py-16 xl:px-20">
        {/* The headline on dark glass */}
        <div className="hero-glass hero-rise relative w-full rounded-[26px] px-5 py-7 backdrop-blur-[28px] backdrop-saturate-[1.3] sm:rounded-[32px] sm:px-10 sm:py-11 lg:w-[min(760px,56%)]" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          {children}
        </div>
      </div>
    </section>
  );
}
