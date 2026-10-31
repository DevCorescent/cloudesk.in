import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import { Reveal } from "@/components/marketing/interactive";
import { groupFeatures, PRODUCT_GROUPS, shortName } from "@/components/marketing/nav";
import { SCENES } from "@/components/marketing/scenes";
import { SHOWCASES } from "@/components/marketing/showcases";

export const metadata: Metadata = {
  title: "Features — Cloudesk",
  description: "Everything Cloudesk does, by category: build and sell, run your business, operations, industry suites, and AI, data and automation — each with real screens from the app.",
};

export default function FeaturesIndex() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 pt-10 sm:px-8 lg:px-14 xl:px-20">
      <section className="mx-auto max-w-3xl text-center">
        <p className="p-in text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">All features</p>
        <h1 className="p-in mt-3 text-[clamp(2.4rem,6vw,4.4rem)] leading-[1] font-[380] tracking-[-0.045em] text-balance" style={{ animationDelay: "80ms" }}>
          Everything you need to <span className="mk-text-shine">build, sell and run</span> your business.
        </h1>
        <p className="p-in mx-auto mt-5 max-w-xl text-[16.5px] text-fg/60" style={{ animationDelay: "160ms" }}>Each page shows real screens from the app, says plainly what it does, and what it doesn&apos;t do yet.</p>
      </section>

      <nav aria-label="Feature categories" className="sticky top-16 z-20 -mx-5 mt-10 overflow-x-auto bg-[var(--p-canvas)]/85 px-5 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-full sm:px-2">
        <ul className="mx-auto flex w-max gap-1.5">
          {PRODUCT_GROUPS.map((g) => (
            <li key={g.id}><a href={`#${g.id}`} className="inline-flex h-9 items-center rounded-full px-4 text-[13.5px] font-medium text-fg/65 ring-1 ring-fg/[0.08] transition-colors hover:bg-fg/[0.05] hover:text-fg">{g.title}</a></li>
          ))}
        </ul>
      </nav>

      {PRODUCT_GROUPS.map((g) => (
        <section key={g.id} id={g.id} className="scroll-mt-32 pt-14">
          <Reveal className="flex flex-wrap items-end justify-between gap-3 border-b border-fg/[0.07] pb-4">
            <div>
              <h2 className="text-[clamp(1.6rem,3vw,2.3rem)] font-[380] tracking-[-0.03em]">{g.title}</h2>
              <p className="text-[15px] text-fg/50">{g.line}</p>
            </div>
            <span className="text-[13px] text-fg/40">{g.slugs.length} features</span>
          </Reveal>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {groupFeatures(g).map((f, i) => {
              const shot = SHOWCASES[f.slug]?.hero.shot;
              const Scene = SCENES[f.slug];
              const Icon = f.icon;
              return (
                <Reveal key={f.slug} delay={(i % 3) * 70}>
                  <Link href={`/features/${f.slug}`} className={clsx("mk-bento group flex h-full flex-col overflow-hidden rounded-[24px]", `tint-${f.tint}`)}>
                    <div className="relative aspect-[16/10] overflow-hidden border-b border-fg/[0.06] bg-fg/[0.02]">
                      {shot ? (
                        <Image src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} sizes="(min-width: 1280px) 30vw, (min-width: 640px) 46vw, 92vw" className="absolute inset-0 size-full object-cover object-left-top" />
                      ) : Scene ? (
                        <div className="grid size-full place-items-center p-4"><div className="w-full max-w-[360px]"><Scene /></div></div>
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <span className="tint-chip inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"><Icon className="size-3.5" /> {shortName(f.name)}</span>
                      <h3 className="mt-3 text-[18px] leading-snug font-medium tracking-[-0.02em] text-balance">{f.title}</h3>
                      <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-fg/55">{f.short}</p>
                      <span className="tint-ink mt-auto inline-flex items-center gap-1.5 pt-4 text-[13.5px] font-semibold">Explore {shortName(f.name)} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span>
                    </div>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
