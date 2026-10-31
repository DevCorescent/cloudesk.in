import "@/components/legal/legal.css";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, legalMetadata } from "@/components/legal/doc";
import { LEGAL_PAGES } from "@/components/legal/pages";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/legal", "Legal & trust", "Cloudesk's Terms of Service, Privacy Policy, Cookie Policy, Refund & Cancellation Policy, Acceptable Use Policy, Data Processing Addendum, sub-processors, grievance redressal and security.");

export default async function LegalIndex() {
  const info = await legalInfo();
  return (
    <div data-no-fit className="mx-auto w-full max-w-[1100px] px-5 pt-12 sm:px-8 sm:pt-16">
      <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Legal &amp; trust</p>
      <h1 className="mt-3 max-w-3xl text-[clamp(2.1rem,4.6vw,3.5rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">The fine print, in plain language.</h1>
      <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-fg/60">
        Everything that governs your use of {info.product}, how we handle data, and how to reach us when something isn&apos;t right. Current versions effective {info.effective}.
      </p>
      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LEGAL_PAGES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="mk-bento group flex h-full flex-col rounded-[22px] p-5 transition-colors">
              <span className="flex items-center justify-between gap-2 text-[16px] font-medium tracking-[-0.01em]">
                {p.title}
                <ChevronRight className="size-4 shrink-0 text-fg/30 transition-colors group-hover:text-fg" />
              </span>
              <span className="mt-1.5 text-[13.5px] leading-relaxed text-fg/55">{p.line}</span>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/contact" className="mk-bento group flex h-full flex-col rounded-[22px] p-5 transition-colors">
            <span className="flex items-center justify-between gap-2 text-[16px] font-medium tracking-[-0.01em]">
              Contact
              <ChevronRight className="size-4 shrink-0 text-fg/30 transition-colors group-hover:text-fg" />
            </span>
            <span className="mt-1.5 text-[13.5px] leading-relaxed text-fg/55">How to reach support, the legal team and the Grievance Officer.</span>
          </Link>
        </li>
      </ul>
      <section className="lg-prose mt-14 max-w-2xl">
        <h2>Who we are</h2>
        <CompanyBlock info={info} />
      </section>
    </div>
  );
}
