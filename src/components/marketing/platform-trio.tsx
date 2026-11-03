// "One platform" on the homepage: the three things you launch — a website, a
// store and your business software — side by side across the full width,
// each in a different device with a small live detail, joined underneath by
// one glowing data spine where customers, products, stock and money light up
// in turn: nothing is typed twice. Few words on purpose. CSS-only motion
// (.pt-* in (marketing)/marketing.css); still for reduced motion.
import clsx from "clsx";
import { ArrowRight, Boxes, Globe, IndianRupee, LayoutDashboard, MousePointer2, ShoppingBag, TrendingUp, Users, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Tint } from "@/lib/workspace/modules";
import { Mark, Reveal } from "./interactive";
import { IPhone17 } from "./iphone";
import { MacBook } from "./macbook";
import { W } from "./sections";

/* ───────── the three devices ───────── */

function SiteDevice() {
  return (
    <div className="pt-tilt relative w-[92%]">
      <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_40px_70px_-34px_rgb(40_20_90/0.5)] ring-1 ring-fg/[0.08]">
        <div className="flex h-7 items-center gap-1.5 border-b border-fg/[0.06] px-3">
          <i className="size-2 rounded-full bg-[#ff5f57]" />
          <i className="size-2 rounded-full bg-[#febc2e]" />
          <i className="size-2 rounded-full bg-[#28c840]" />
          <span className="mx-auto rounded-full bg-fg/[0.05] px-2.5 py-0.5 text-[9.5px] text-fg/45">saffronandsage.in</span>
        </div>
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image src="/marketing/builder/dragdrop.jpg" alt="The website builder: moving a section on the page" fill sizes="(min-width: 1024px) 30vw, 80vw" className="object-cover" style={{ objectPosition: "50% 20%" }} />
        </div>
      </div>
      {/* A section being dragged into place. */}
      <span className="pt-drag absolute top-[46%] left-[30%] inline-flex items-center gap-1.5 rounded-[10px] bg-white px-2.5 py-1.5 text-[11px] font-medium text-fg/75 shadow-[0_14px_30px_-12px_rgb(40_20_90/0.45)] ring-1 ring-[#5b48b0]/30" aria-hidden>
        Gallery <MousePointer2 className="size-3.5 fill-[#5b48b0] text-[#5b48b0]" />
      </span>
    </div>
  );
}

function StoreDevice() {
  return (
    <div className="relative w-[44%] max-w-[230px]">
      <div className="pt-float drop-shadow-[0_34px_40px_rgb(90_40_20/0.3)]">
        <IPhone17 color="white">
          <Image src="/marketing/store/sf-phone.jpg" alt="A storefront on a phone" fill sizes="230px" className="object-cover object-top" />
        </IPhone17>
      </div>
      <span className="pt-cart absolute bottom-[16%] -left-[38%] flex items-center gap-2.5 rounded-[14px] bg-white p-2 pr-3.5 shadow-[0_18px_36px_-16px_rgb(90_40_20/0.45)] ring-1 ring-fg/[0.06]" aria-hidden>
        <span className="grid size-9 place-items-center rounded-[10px] bg-[var(--p-peach)] text-[var(--p-peach-ink)]"><ShoppingBag className="size-4" /></span>
        <span className="text-[11.5px] leading-tight"><b className="block font-semibold">Added to cart</b><span className="text-fg/55">Oversized tee · ₹1,499</span></span>
      </span>
    </div>
  );
}

function SoftwareDevice() {
  return (
    <div className="relative w-[96%]">
      <MacBook>
        <Image src="/marketing/home/dashboard.jpg" alt="The business dashboard: money owed, pipeline, sales, team and stock" fill sizes="(min-width: 1024px) 30vw, 80vw" className="object-cover object-left-top" />
      </MacBook>
      <span className="pt-kpi absolute -top-[6%] right-[4%] flex items-center gap-2 rounded-[14px] bg-white p-2 pr-3.5 shadow-[0_18px_36px_-16px_rgb(20_70_50/0.45)] ring-1 ring-fg/[0.06]" aria-hidden>
        <span className="grid size-9 place-items-center rounded-[10px] bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><TrendingUp className="size-4" /></span>
        <span className="text-[11.5px] leading-tight"><b className="block font-semibold tabular-nums">₹9.64L</b><span className="text-[#15803d]">▲ 12% this month</span></span>
      </span>
    </div>
  );
}

type Pillar = { title: string; icon: LucideIcon; tint: Tint; tags: string[]; href: string; device: ReactNode };
const PILLARS: Pillar[] = [
  { title: "Your website", icon: Globe, tint: "lavender", tags: ["26 templates", "Drag & drop", "Your domain"], href: "/features/website-builder", device: <SiteDevice /> },
  { title: "Your online store", icon: ShoppingBag, tint: "peach", tags: ["UPI · cards · COD", "Orders & returns", "One stock with POS"], href: "/features/online-store", device: <StoreDevice /> },
  { title: "Your business software", icon: LayoutDashboard, tint: "mint", tags: ["CRM & GST invoices", "HR & payroll", "Inventory"], href: "/features", device: <SoftwareDevice /> },
];
const SHARED: [LucideIcon, string][] = [[Users, "Customers"], [ShoppingBag, "Products"], [Boxes, "Stock"], [IndianRupee, "Money"]];

/** The spine: one wave through the three, light flowing along it. */
function Spine() {
  // Through the three nodes (x = 200, 600, 1000 at y = 50), dipping and rising between them.
  const d = "M0 50 C 120 50, 150 50, 200 50 C 290 50, 320 14, 400 14 S 520 50, 600 50 S 720 86, 800 86 S 910 50, 1000 50 C 1060 50, 1100 50, 1200 50";
  return (
    <svg viewBox="0 0 1200 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="pt-spine" x1="0" x2="1">
          <stop offset="0" stopColor="#8b7bff" stopOpacity="0" />
          <stop offset="0.15" stopColor="#8b7bff" />
          <stop offset="0.5" stopColor="#f08a5d" />
          <stop offset="0.85" stopColor="#2fb37f" />
          <stop offset="1" stopColor="#2fb37f" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke="url(#pt-spine)" strokeWidth="2" vectorEffect="non-scaling-stroke" opacity="0.5" />
      <path d={d} fill="none" stroke="url(#pt-spine)" strokeWidth="3" vectorEffect="non-scaling-stroke" className="pt-flow" pathLength={1} />
    </svg>
  );
}

export function PlatformTrio() {
  return (
    <section className="relative py-12 sm:py-16">
      <div className="pt-band relative isolate overflow-hidden py-14 sm:py-20">
        <Reveal className={clsx(W, "mx-auto max-w-4xl text-center")}>
          <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">One platform</p>
          <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.6rem)] leading-[1.04] font-[380] tracking-[-0.045em] text-balance">Website, store and software. <Mark tone="lavender">One place.</Mark></h2>
          <p className="mx-auto mt-4 max-w-md text-[15.5px] leading-relaxed text-fg/55">Start with one, add the others when you&apos;re ready — nothing typed twice.</p>
        </Reveal>

        <div className={clsx(W, "mt-12 sm:mt-16")}>
          <div className="relative">
          {/* The shared spine (wide screens): level with the nodes under the devices (stage 320 + 24 + 60px). */}
          <div className="pointer-events-none absolute inset-x-0 top-[354px] -z-10 hidden h-[100px] lg:block" aria-hidden>
            <Spine />
          </div>
          {/* Phones: a swipeable row of the three. */}
          <ul className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-8 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
            {PILLARS.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 110} className={clsx("pt-col w-[82%] shrink-0 snap-start sm:w-[56%] lg:w-auto", `tint-${p.tint}`)}>
                <Link href={p.href} className="group flex h-full flex-col">
                  <div className="pt-stage relative grid h-[260px] place-items-center rounded-[28px] sm:h-[300px] lg:h-[320px]">{p.device}</div>
                  {/* The node where this one meets the spine */}
                  <span className="relative mx-auto mt-6 hidden h-[60px] w-px lg:block" aria-hidden>
                    <span className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--t-ink)] opacity-40" />
                    <span className="pt-node absolute bottom-0 left-1/2 size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--t-ink)]" style={{ animationDelay: `${i * 0.6}s` }} />
                  </span>
                  <div className="mt-6 text-center lg:mt-12">
                    <p className="inline-flex items-center gap-2 text-[18px] font-[450] tracking-[-0.02em]">
                      <span className="tint-chip grid size-8 place-items-center rounded-[10px]"><p.icon className="size-4" /></span>
                      {p.title}
                      <ArrowRight className="size-4 text-fg/30 transition-transform group-hover:translate-x-1 group-hover:text-fg" />
                    </p>
                    <ul className="mt-3 flex flex-wrap justify-center gap-1.5">
                      {p.tags.map((t) => <li key={t} className="rounded-full bg-white/70 px-2.5 py-1 text-[12px] text-fg/60 ring-1 ring-fg/[0.06]">{t}</li>)}
                    </ul>
                  </div>
                </Link>
              </Reveal>
            ))}
          </ul>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2 lg:mt-4">
            <span className="mr-1 text-[12px] font-semibold tracking-[0.16em] text-fg/40 uppercase">Shared by all three</span>
            {SHARED.map(([Icon, x], k) => (
              <span key={x} className="pt-share inline-flex items-center gap-1.5 rounded-full bg-white/80 py-1.5 pr-3 pl-1.5 text-[12.5px] font-medium text-fg/70 ring-1 ring-fg/[0.07]" style={{ animationDelay: `${k * 0.75}s` }}>
                <span className="grid size-6 place-items-center rounded-full bg-fg/[0.06]"><Icon className="size-3.5" /></span>{x}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
