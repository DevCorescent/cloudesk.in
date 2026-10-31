import type { Metadata } from "next";
import { PricingSection } from "@/components/marketing/pricing";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { publicCatalog } from "@/server/billing/subscriptions";

export const metadata: Metadata = {
  title: "Pricing — Cloudesk",
  description: "Start with a free trial of everything. Then choose a plan — Workday for Mail, Calendar and Chat, Starter, Growth or Enterprise — or customise your own from the features you use.",
};

const FAQ: [string, string][] = [
  ["What's in the free trial?", "Every feature, with the largest limits, for the length of the trial. No card is needed to start."],
  ["What happens when the trial ends?", "You carry on with the plan you chose — pay for it any time during the trial and nothing stops. If you haven't chosen one, you move to the Free plan: Mail, Calendar, Chat, invoicing and a CRM with monthly allowances. Work in other features is kept, locked until you upgrade — nothing is deleted."],
  ["Can I change plan later?", "Yes. An upgrade starts as soon as it's paid: you pay for the time left on the new plan, less the unused time on your current one, worked out to the second. A downgrade starts when your current period ends."],
  ["How do renewals work?", "A renewal invoice is raised a few days before your period ends, and you pay it online. If a renewal isn't paid, everything keeps working for a short grace period first."],
  ["Is tax included?", "Prices are shown before tax; GST is added on each invoice and shown on it."],
  ["Can I cancel?", "Any time. You keep your plan until the end of the period you've paid for."],
];

export default async function PricingPage() {
  const { plans, pricing, free } = await publicCatalog();
  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 pt-12 sm:px-8 lg:px-14 xl:px-20">
      <section className="mx-auto max-w-3xl text-center">
        <p className="p-in text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Pricing</p>
        <h1 className="p-in mt-3 text-[clamp(2.3rem,5.4vw,4.2rem)] leading-[1.04] font-[360] tracking-[-0.045em]" style={{ animationDelay: "80ms" }}>
          {pricing.trialDays} days free. <span className="mk-logo-gradient">Then pay for what you use.</span>
        </h1>
        <p className="p-in mx-auto mt-5 max-w-xl text-[16.5px] text-fg/60" style={{ animationDelay: "160ms" }}>Every new workspace gets every feature free for {pricing.trialDays} days. Pick a plan below, or customise one from just the features you need.</p>
      </section>

      <section id="build" className="mt-14 scroll-mt-24">
        <PricingSection plans={plans} pricing={pricing} free={free} />
        <TrustStrip compact className="mx-auto mt-12 max-w-5xl" />
      </section>

      <section className="mx-auto mt-28 max-w-3xl">
        <h2 className="text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.08] font-[380] tracking-[-0.035em]">Questions people ask</h2>
        <div className="mt-6 divide-y divide-fg/[0.07] border-y border-fg/[0.07]">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="cursor-pointer list-none text-[16px] font-medium marker:hidden">{q}</summary>
              <p className="mt-2 text-[15px] leading-relaxed text-fg/60">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
