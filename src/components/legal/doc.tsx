// The layout every legal and trust page shares: title and dates, a
// plain-language summary, a table of contents, the numbered sections and
// links to the other policies. Prints cleanly (header, footer and the
// contents list are left off paper).
import "./legal.css";
import { ChevronRight, ListTree } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LegalInfo } from "@/server/legal/info";
import { LEGAL_PAGES } from "./pages";
import { PrintButton } from "./print-button";

export type LegalSection = { id: string; title: string; body: ReactNode };

const base = () => process.env.APP_URL ?? "http://localhost:3000";

/** Title, description, canonical address and social cards for one page. */
export function legalMetadata(path: string, title: string, description: string): Metadata {
  const url = new URL(path, base()).toString();
  return {
    title: `${title} — Cloudesk`,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: `${title} — Cloudesk`, description, siteName: "Cloudesk" },
    twitter: { card: "summary", title: `${title} — Cloudesk`, description },
  };
}

/** An email address as a link. */
export const Mail = ({ to }: { to: string }) => <a href={`mailto:${to}`}>{to}</a>;

/** "write to us at x@y" when there's an address; otherwise points to the contact page (never an invented address). */
export function ContactUs({ info, email, lead = "write to us at" }: { info: LegalInfo; email?: string; lead?: ReactNode }) {
  const to = email || info.email;
  return to ? <>{lead} <Mail to={to} /></> : <>use the details on our <Link href="/contact">contact page</Link></>;
}

/** The company's name and registered details, as far as they're known. */
export function CompanyBlock({ info }: { info: LegalInfo }) {
  const rows: [string, ReactNode][] = [];
  if (info.company) rows.push(["Company", info.company]);
  if (info.address) rows.push(["Registered office", <span key="a" className="whitespace-pre-line">{info.address}</span>]);
  if (info.cin) rows.push(["CIN", info.cin]);
  if (info.gstin) rows.push(["GSTIN", info.gstin]);
  if (info.email) rows.push(["Email", <Mail key="e" to={info.email} />]);
  if (info.phone) rows.push(["Phone", <a key="p" href={`tel:${info.phone.replace(/[^\d+]/g, "")}`}>{info.phone}</a>]);
  if (!rows.length) return <p>You can reach us through our <Link href="/contact">contact page</Link>.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[170px_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-fg">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A table that scrolls sideways on small screens instead of the page. */
export const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div className="lg-table">
    <table>
      <thead>
        <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
);

export function LegalDoc({ path, title, intro, info, summary, sections, before }: { path: string; title: string; intro: ReactNode; info: LegalInfo; summary: ReactNode[]; sections: LegalSection[]; before?: ReactNode }) {
  const related = LEGAL_PAGES.filter((p) => p.href !== path);
  const toc = (
    <ol className="grid gap-0.5 text-[13.5px]">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a href={`#${s.id}`} className="flex gap-2 rounded-[8px] px-2 py-1.5 text-fg/60 transition-colors hover:bg-fg/[0.04] hover:text-fg">
            <span className="w-5 shrink-0 text-right text-fg/35 tabular-nums">{i + 1}.</span>
            <span>{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <article data-legal-doc data-no-fit className="mx-auto w-full max-w-[1240px] px-5 pt-10 sm:px-8 sm:pt-14 lg:px-14">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px] text-fg/45" data-print-hide>
        <Link href="/legal" className="hover:text-fg">Legal</Link>
        <ChevronRight className="size-3.5" />
        <span className="text-fg/70">{title}</span>
      </nav>
      <header className="mt-4 max-w-3xl">
        <h1 className="text-[clamp(2.1rem,4.6vw,3.5rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">{title}</h1>
        <p className="mt-4 text-[16.5px] leading-relaxed text-fg/60">{intro}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-[13px] text-fg/55">
          <span>
            <span className="font-medium text-fg/75">Effective:</span> <time dateTime={info.effectiveIso}>{info.effective}</time>
          </span>
          <span>
            <span className="font-medium text-fg/75">Last updated:</span> <time dateTime={info.updatedIso}>{info.updated}</time>
          </span>
          <PrintButton />
        </div>
      </header>

      <div className="lg-grid mt-10 grid gap-10 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-14">
        <aside className="hidden lg:block" data-print-hide>
          <div className="sticky top-24">
            <p className="mb-2 px-2 text-[11px] font-semibold tracking-[0.14em] text-fg/40 uppercase">On this page</p>
            {toc}
          </div>
        </aside>
        <div className="min-w-0 max-w-[760px]">
          <div data-legal-summary className="rounded-[22px] border border-fg/[0.07] bg-[color-mix(in_srgb,var(--tint-mint,#e7f6ee)_55%,white)] p-5 sm:p-6">
            <p className="text-[12px] font-semibold tracking-[0.14em] text-fg/50 uppercase">The short version</p>
            <ul className="mt-3 grid gap-2 text-[14.5px] leading-relaxed text-fg/75">
              {summary.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-fg/35" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-fg/50">This summary is for convenience. The full text below is what applies.</p>
          </div>

          <details className="mt-6 rounded-[16px] border border-fg/[0.07] bg-white/50 lg:hidden" data-print-hide>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] font-medium marker:hidden">
              <ListTree className="size-4 text-fg/50" /> Contents
            </summary>
            <div className="px-2 pb-3">{toc}</div>
          </details>

          {before}

          <div className="lg-prose mt-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
                <h2 id={`${s.id}-h`}>
                  <span className="mr-2 text-fg/35 tabular-nums">{i + 1}.</span>
                  {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </div>

          <nav aria-label="Other policies" className="mt-16 border-t border-fg/[0.07] pt-8" data-print-hide>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-fg/40 uppercase">Related</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} className="group block rounded-[16px] border border-fg/[0.07] bg-white/50 p-4 transition-colors hover:border-fg/15">
                    <span className="flex items-center justify-between gap-2 text-[14.5px] font-medium">
                      {p.title}
                      <ChevronRight className="size-4 text-fg/30 transition-colors group-hover:text-fg" />
                    </span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-fg/55">{p.line}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </article>
  );
}
