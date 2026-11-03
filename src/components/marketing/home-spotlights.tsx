// Homepage spotlights: Notes and the workday (client components of their own) and the partner
// program (its live rates, and the example partner dashboard — labelled as
// sample numbers). Server components; the interactive bits are client islands.
import { ArrowRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/marketing/interactive";
import { NotesShow } from "@/components/marketing/notes-show";
import { WorkdayDock } from "@/components/marketing/workday-dock";
import { W } from "@/components/marketing/sections";
import { TYPE_ICON } from "@/components/partners/icons";
import { HeroDashboard } from "@/components/partners/showcase";
import { pct, TYPE_LIST, type PartnerType } from "@/lib/partners/program";


/** Kept as the homepage's name for it; the motion stage is a client component. */
export function NotesSpotlight() {
  return <NotesShow />;
}

type Rates = { types: { id: PartnerType; commissionBps: number; commissionMonths: number; discountBps: number }[]; tiers: { bonusBps: number }[]; minPayout: number };

export function PartnersSpotlight({ program, origin }: { program: Rates; origin: string }) {
  const topBonus = Math.max(0, ...program.tiers.map((t) => t.bonusBps));
  const topRate = Math.max(...program.types.map((t) => t.commissionBps)) + topBonus;
  const longest = Math.max(...program.types.map((t) => t.commissionMonths));
  return (
    <section id="partners" className="relative py-20 sm:py-28">
      <div className={W}>
        <div className="mk-deep mk-deep-plum relative overflow-hidden rounded-[36px] px-5 py-12 sm:px-10 sm:py-16 lg:px-14 lg:py-20">
          <span aria-hidden className="pointer-events-none absolute -top-40 -left-24 size-[520px] rounded-full bg-[#a78bfa] opacity-[0.16] blur-[120px]" />
          <span aria-hidden className="pointer-events-none absolute -right-20 -bottom-40 size-[520px] rounded-full bg-[#fdba8c] opacity-[0.12] blur-[130px]" />
          <div className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <Reveal className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1 text-[12.5px] font-medium text-white/75 ring-1 ring-white/10"><span className="size-1.5 rounded-full bg-[#7dd3a8]" /> Cloudesk Partner Program</p>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3.4rem)] leading-[1.05] font-[380] tracking-[-0.04em]">Recommend Cloudesk. <span className="mk-logo-gradient">Earn every month.</span></h2>
              <p className="mt-5 max-w-lg text-[16.5px] leading-relaxed font-[350] text-white/65">Agencies, freelancers, sales and marketing partners and creators earn up to <b className="font-semibold text-white">{pct(topRate)}</b> of what every customer they bring pays{longest ? ` — for up to ${longest} months` : ""}. Your customers get a discount, you get a live dashboard and payouts on request.</p>
              <ul className="mt-8 grid grid-cols-1 gap-2">
                {TYPE_LIST.map((x) => {
                  const t = program.types.find((y) => y.id === x.id);
                  if (!t) return null;
                  const Icon = TYPE_ICON[x.id];
                  return (
                    <li key={x.id} className="flex min-w-0 items-center gap-3 rounded-[16px] bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.07]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-white/[0.08]"><Icon className="size-[17px] text-white/85" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">{x.name}</span><span className="block truncate text-[12.5px] text-white/50">{x.short}</span></span>
                      <span className="shrink-0 text-right"><span className="block text-[17px] font-semibold tabular-nums">{pct(t.commissionBps)}</span><span className="block text-[11px] text-white/45">{t.commissionMonths ? `${t.commissionMonths} months` : "always"}</span></span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/partners#apply" className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-[#0e0d14] transition-transform hover:-translate-y-0.5">Become a partner <ArrowRight className="size-4" /></Link>
                <Link href="/partners#calculator" className="inline-flex h-12 items-center rounded-full px-6 text-[15px] font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/[0.06]">What could I earn?</Link>
              </div>
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/55">
                {["Free to join", "No targets", `Payouts from ₹${Math.round(program.minPayout / 100).toLocaleString("en-IN")}`].map((x) => <li key={x} className="inline-flex items-center gap-1.5"><ListChecks className="size-3.5 text-[#7dd3a8]" />{x}</li>)}
              </ul>
            </Reveal>
            <Reveal delay={120} className="min-w-0">
              <HeroDashboard origin={origin} dark />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── The workday, as a desk ─────────────────────────────────────────────────

export function WorkdayCards() {
  return <WorkdayDock />;
}
