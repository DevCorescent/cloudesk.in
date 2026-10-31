import "./marketing.css";
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { LEGAL_PAGES } from "@/components/legal/pages";
import { BUSINESSES } from "@/components/marketing/businesses";
import { LIGHT_SCRIPT, LightTheme } from "@/components/marketing/light-theme";
import { groupFeatures, PRODUCT_GROUPS, shortName } from "@/components/marketing/nav";
import { OneLineHeadings } from "@/components/marketing/one-line";
import { SiteHeader } from "@/components/marketing/site-header";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { getPageSession } from "@/server/auth/page-session";
import { settings } from "@/server/platform/settings";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const signedIn = !!(await getPageSession());
  // The legal name in the copyright line when it's set (Admin → Settings → Legal).
  const owner = await settings().then((s) => s.legal.companyName || s.general.productName, () => "Cloudesk");
  return (
    <div className="pastel relative min-h-dvh overflow-x-clip">
      {/* The marketing site is always light, whatever the device prefers. */}
      <script dangerouslySetInnerHTML={{ __html: LIGHT_SCRIPT }} />
      <LightTheme />
      <OneLineHeadings />
      {/* Soft colour light that stays behind everything. */}
      <div className="p-aurora pointer-events-none fixed inset-0 opacity-70" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="relative">
        <SiteHeader signedIn={signedIn} />
        <main>{children}</main>
        <footer className="mt-24 border-t border-fg/5">
          <div className="mx-auto w-full max-w-[1600px] border-b border-fg/5 px-5 py-12 sm:px-8 sm:py-14 lg:px-14 xl:px-20">
            <TrustStrip />
          </div>
          <div className="mx-auto grid w-full max-w-[1600px] grid-cols-2 gap-x-6 gap-y-10 px-5 py-14 sm:px-8 md:grid-cols-4 lg:grid-cols-[1.4fr_repeat(7,minmax(0,1fr))] lg:px-14 xl:px-20">
            <div className="col-span-2 md:col-span-4 lg:col-span-1">
              <Link href="/" className="inline-flex items-center">
                <Wordmark className="text-[23px]" />
              </Link>
              <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-fg/55">Your website, store and business software — set up in minutes, on one platform.</p>
              <Link href="/start" className="p-cta mt-5 inline-flex !h-10 items-center gap-1.5 px-5 text-[13.5px]">Start free</Link>
              <Link href="/partners" className="mt-3 block text-[13px] font-medium text-fg/60 transition-colors hover:text-fg">Become a partner →</Link>
            </div>
            {PRODUCT_GROUPS.map((g) => (
              <div key={g.id}>
                <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-fg/40 uppercase">{g.title}</p>
                <ul className="grid gap-y-2 text-[13px]">
                  {groupFeatures(g).map((f) => (
                    <li key={f.slug}><Link href={`/features/${f.slug}`} className="text-fg/60 transition-colors hover:text-fg">{shortName(f.name)}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-fg/40 uppercase">Industries</p>
              <ul className="grid gap-y-2 text-[13px]">
                {BUSINESSES.map((b) => (
                  <li key={b.slug}><Link href={`/for/${b.slug}`} className="text-fg/60 transition-colors hover:text-fg">{b.name}</Link></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-fg/40 uppercase">
                <Link href="/legal" className="transition-colors hover:text-fg">Legal</Link>
              </p>
              <ul className="grid gap-y-2 text-[13px]">
                {LEGAL_PAGES.map((p) => (
                  <li key={p.href}><Link href={p.href} className="text-fg/60 transition-colors hover:text-fg">{p.short}</Link></li>
                ))}
                <li><Link href="/contact" className="text-fg/60 transition-colors hover:text-fg">Contact</Link></li>
              </ul>
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-3 border-t border-fg/5 px-5 py-6 text-[12px] text-fg/40 sm:px-8 lg:px-14 xl:px-20">
            <span>© {new Date().getFullYear()} {owner}</span>
            <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/terms" className="hover:text-fg">Terms</Link>
              <Link href="/privacy" className="hover:text-fg">Privacy</Link>
              <Link href="/cookies" className="hover:text-fg">Cookies</Link>
              <Link href="/grievance" className="hover:text-fg">Grievances</Link>
            </nav>
            <span>No fake numbers, no dark patterns. Every screen shown here is from the real app.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
