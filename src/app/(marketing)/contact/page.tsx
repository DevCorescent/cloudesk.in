import { Building2, LifeBuoy, Mail as MailIcon, MessageSquareWarning, Phone, ShieldAlert, Activity } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { legalMetadata } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/contact", "Contact", "How to reach Cloudesk: support, billing and legal questions, the Grievance Officer, and reporting a security issue.");

const mailto = (e: string, subject?: string) => <a href={`mailto:${e}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`} className="font-medium underline underline-offset-2">{e}</a>;

function Card({ icon: Icon, title, children }: { icon: typeof MailIcon; title: string; children: ReactNode }) {
  return (
    <div className="mk-bento rounded-[22px] p-5 sm:p-6">
      <Icon className="size-5 text-fg/50" />
      <h2 className="mt-3 text-[17px] font-medium tracking-[-0.01em]">{title}</h2>
      <div className="mt-1.5 text-[14.5px] leading-relaxed text-fg/65">{children}</div>
    </div>
  );
}

export default async function ContactPage() {
  const info = await legalInfo();
  const support = info.supportEmail || info.email;
  const g = info.grievance;
  return (
    <div data-no-fit className="mx-auto w-full max-w-[1100px] px-5 pt-12 sm:px-8 sm:pt-16">
      <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">Contact</p>
      <h1 className="mt-3 max-w-3xl text-[clamp(2.1rem,4.6vw,3.5rem)] leading-[1.05] font-[380] tracking-[-0.04em] text-balance">Talk to a person.</h1>
      <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-fg/60">Questions about {info.product}, your bill or your data — here&apos;s who to reach and how.</p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <Card icon={LifeBuoy} title="Help and support">
          {support ? <p>Email {mailto(support)}. Include your workspace name so we can find it quickly.</p> : <p>If you have an account, sign in and use <strong>Request a feature</strong> in the sidebar to message our team — we reply there.</p>}
        </Card>
        <Card icon={MailIcon} title="Billing, privacy and legal">
          {info.email ? <p>Email {mailto(info.email)}.{info.dpo.email && info.dpo.email !== info.email ? <> For privacy requests you can also write to {mailto(info.dpo.email, "Privacy request")}{info.dpo.name ? <> ({info.dpo.name})</> : null}.</> : null}</p> : <p>Use the support route above and say it&apos;s a billing, privacy or legal question; it will be passed to the right person.</p>}
          <p className="mt-2 text-[13.5px]">See also: <Link className="underline underline-offset-2" href="/refunds">Refunds</Link> · <Link className="underline underline-offset-2" href="/privacy#rights">Your privacy rights</Link></p>
        </Card>
        <Card icon={MessageSquareWarning} title="Complaints — Grievance Officer">
          {g.name || g.email || g.phone ? (
            <p>
              {g.name ? <>{g.name}<br /></> : null}
              {g.email ? <>{mailto(g.email, "Grievance")}<br /></> : null}
              {g.phone ? <a className="underline underline-offset-2" href={`tel:${g.phone.replace(/[^\d+]/g, "")}`}>{g.phone}</a> : null}
            </p>
          ) : null}
          <p className={g.name || g.email || g.phone ? "mt-2" : undefined}>We acknowledge within 24 hours and resolve within 15 days. <Link className="underline underline-offset-2" href="/grievance">How it works</Link></p>
        </Card>
        <Card icon={ShieldAlert} title="Report a security issue">
          <p>
            {info.email ? <>Email {mailto(info.email, "Security")} — </> : null}
            please read our <Link className="underline underline-offset-2" href="/security#disclosure">disclosure guidelines</Link> first. To report abuse on a site built with {info.product}, see the <Link className="underline underline-offset-2" href="/acceptable-use#enforcement">Acceptable Use Policy</Link>.
          </p>
        </Card>
        {(info.company || info.address || info.phone) && (
          <Card icon={Building2} title="Company">
            <p className="whitespace-pre-line">{[info.company, info.address].filter(Boolean).join("\n")}</p>
            {(info.cin || info.gstin) && <p className="mt-2 text-[13.5px]">{[info.cin && `CIN ${info.cin}`, info.gstin && `GSTIN ${info.gstin}`].filter(Boolean).join(" · ")}</p>}
            {info.phone && (
              <p className="mt-2 inline-flex items-center gap-1.5">
                <Phone className="size-3.5" /> <a className="underline underline-offset-2" href={`tel:${info.phone.replace(/[^\d+]/g, "")}`}>{info.phone}</a>
              </p>
            )}
          </Card>
        )}
        {info.statusPageUrl && (
          <Card icon={Activity} title="Service status">
            <p>Live status and incidents: <a className="underline underline-offset-2" href={info.statusPageUrl}>{info.statusPageUrl.replace(/^https?:\/\//, "")}</a></p>
          </Card>
        )}
      </div>
    </div>
  );
}
