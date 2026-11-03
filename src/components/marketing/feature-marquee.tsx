// Every feature on the homepage, as two rows drifting in opposite directions.
// Each one is a card in its own pastel that opens the feature's page; hovering
// a row stops it, lifts the card under the pointer and quiets the rest.
// CSS-only motion (.fm-* in (marketing)/marketing.css); for reduced motion
// the rows wrap and stay still.
import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { FEATURES, type Feature } from "./features";
import { Reveal } from "./interactive";
import { shortName } from "./nav";
import { W } from "./sections";

function Row({ items, reverse, seconds }: { items: Feature[]; reverse?: boolean; seconds: number }) {
  const card = (f: Feature, copy: boolean) => (
    <li key={`${copy ? "b" : "a"}-${f.slug}`} aria-hidden={copy || undefined}>
      <Link href={`/features/${f.slug}`} tabIndex={copy ? -1 : undefined} className={clsx("fm-item group flex w-[268px] items-center gap-3 rounded-[18px] bg-white/80 py-3 pr-4 pl-3 ring-1 ring-fg/[0.06] backdrop-blur", `tint-${f.tint}`)}>
        <span className="tint-chip fm-icon grid size-11 shrink-0 place-items-center rounded-[13px]"><f.icon className="size-5" strokeWidth={1.75} /></span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14.5px] font-medium tracking-[-0.01em]">{shortName(f.name)}</b>
          <span className="block truncate text-[12.5px] text-fg/50">{f.short}</span>
        </span>
        <ArrowRight className="fm-go size-4 shrink-0 text-fg/30" />
      </Link>
    </li>
  );
  return (
    <div className="fm-row">
      <ul className={clsx("fm-track flex w-max gap-3", reverse && "fm-rev")} style={{ animationDuration: `${seconds}s` }}>
        {items.map((f) => card(f, false))}
        {/* The second copy makes the loop seamless; it's skipped by keyboards and screen readers. */}
        {items.map((f) => card(f, true))}
      </ul>
    </div>
  );
}

export function FeatureMarquee() {
  const half = Math.ceil(FEATURES.length / 2);
  return (
    <section aria-labelledby="fm-title" className="relative py-14 sm:py-20">
      <Reveal className={clsx(W, "mb-9 flex flex-col gap-4 sm:mb-11 lg:flex-row lg:items-end lg:justify-between")}>
        <div className="max-w-2xl">
          <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Everything, built in</p>
          <h2 id="fm-title" className="mt-3 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.06] font-[380] tracking-[-0.04em]">{FEATURES.length} features. <span className="text-fg/40">One login.</span></h2>
        </div>
        <Link href="/features" className="group inline-flex w-fit items-center gap-1.5 rounded-full px-5 py-2.5 text-[14px] font-medium ring-1 ring-fg/[0.12] transition-colors hover:bg-fg/[0.04]">Explore all features <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></Link>
      </Reveal>
      <div className="fm grid gap-3">
        <Row items={FEATURES.slice(0, half)} seconds={90} />
        <Row items={FEATURES.slice(half)} seconds={100} reverse />
      </div>
    </section>
  );
}
