import { DarkHero } from "@/components/marketing/dark-hero";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import { BUSINESSES } from "@/components/marketing/businesses";
import { Mark, Reveal } from "@/components/marketing/interactive";

export const metadata: Metadata = { title: "Cloudesk for your business", description: "How boutiques, cafés, restaurants, salons, clinics, studios and more run on Cloudesk." };

const photo = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=800&q=80`;

export default function BusinessesIndex() {
  return (
    <>
      <DarkHero tint="peach" className="pt-12 pb-6 lg:pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="p-in text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Who it&apos;s for</p>
          <h1 className="p-in mt-4 text-[clamp(2.3rem,5.6vw,4.2rem)] leading-[1] font-[380] tracking-[-0.045em] text-balance" style={{ animationDelay: "80ms" }}>
            Made for <Mark tone="peach" delay={500}>businesses like yours</Mark>.
          </h1>
          <p className="p-in mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-fg/60" style={{ animationDelay: "160ms" }}>
            Pick yours to see how it runs on Cloudesk — with real screens, a day in the life, and the tools we switch on for you.
          </p>
        </div>
      </DarkHero>
      <div className="mx-auto w-full max-w-[1600px] px-5 pb-8 sm:px-8 lg:px-14 xl:px-20">
      <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
        {BUSINESSES.map((b, i) => {
          const Icon = b.icon;
          return (
            <li key={b.slug}>
              <Reveal delay={(i % 3) * 80} className="h-full">
                <Link href={`/for/${b.slug}`} className={clsx("group relative block aspect-[5/4] overflow-hidden rounded-[28px] bg-fg/[0.04]", `tint-${b.tint}`)}>
                  <Image src={photo(b.photo)} alt={b.alt} fill sizes="(min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw" className="object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.05]" />
                  <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0)_35%,rgb(0_0_0/0.72))]" />
                  <span className="absolute inset-x-5 bottom-5 text-white">
                    <span className="mb-3 grid size-10 place-items-center rounded-[13px] bg-white/18 ring-1 ring-white/25 backdrop-blur-md">
                      <Icon className="size-5" />
                    </span>
                    <span className="block text-[21px] font-medium tracking-[-0.02em]">{b.name}</span>
                    <span className="mt-1 block text-[13.5px] text-white/75">{b.line}</span>
                    <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold opacity-80 transition-all group-hover:gap-2 group-hover:opacity-100">
                      See how it works <ArrowRight className="size-3.5" />
                    </span>
                  </span>
                </Link>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </div>
    </>
  );
}
