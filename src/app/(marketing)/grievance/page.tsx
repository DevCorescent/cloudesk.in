import { Mail as MailIcon, Phone, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, ContactUs, LegalDoc, legalMetadata, Mail, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/grievance", "Grievance Redressal", "How to raise a complaint about Cloudesk, the Grievance Officer's contact details, response times under the IT Rules 2021 and the DPDP Act 2023, and how to escalate.");

export default async function GrievancePage() {
  const info = await legalInfo();
  const { product: P } = info;
  const g = info.grievance;
  const officer = (
    <div className="mt-6 rounded-[22px] border border-fg/[0.08] bg-white/70 p-5 sm:p-6">
      <p className="text-[12px] font-semibold tracking-[0.14em] text-fg/50 uppercase">Grievance Officer</p>
      {g.name || g.email || g.phone ? (
        <ul className="mt-3 grid gap-2 text-[15px]">
          {g.name && <li className="flex items-center gap-2.5"><UserRound className="size-4 text-fg/45" /> <span className="font-medium">{g.name}</span></li>}
          {g.email && <li className="flex items-center gap-2.5"><MailIcon className="size-4 text-fg/45" /> <a className="underline underline-offset-2" href={`mailto:${g.email}?subject=Grievance`}>{g.email}</a></li>}
          {g.phone && <li className="flex items-center gap-2.5"><Phone className="size-4 text-fg/45" /> <a className="underline underline-offset-2" href={`tel:${g.phone.replace(/[^\d+]/g, "")}`}>{g.phone}</a></li>}
        </ul>
      ) : (
        <p className="mt-3 text-[14.5px] leading-relaxed text-fg/70">
          Send your complaint through our <Link className="underline underline-offset-2" href="/contact">contact page</Link> with &ldquo;Grievance&rdquo; in the subject, and it will be handled by the Grievance Officer within the timelines below.
        </p>
      )}
      {info.address && <p className="mt-3 text-[13.5px] whitespace-pre-line text-fg/60">{info.company ? `${info.company}\n` : ""}{info.address}</p>}
    </div>
  );
  const sections: LegalSection[] = [
    {
      id: "who",
      title: "Who can complain, and about what",
      body: (
        <>
          <p>Anyone can raise a grievance with us — customers, their members, visitors to sites built with {P}, or people whose personal data we process. For example:</p>
          <ul>
            <li>content on a site, store or portal built with {P} that you believe is unlawful or breaks our <Link href="/acceptable-use">Acceptable Use Policy</Link>;</li>
            <li>how we handle your personal data, or a request to access, correct or erase it, withdraw consent or nominate someone (see the <Link href="/privacy#rights">Privacy Policy</Link>);</li>
            <li>billing, refunds or the quality of the Service (see the <Link href="/refunds">Refund &amp; Cancellation Policy</Link>);</li>
            <li>an account being suspended or content being removed.</li>
          </ul>
          <p>If your complaint is about a purchase from, or your data held by, a business that uses {P}, please contact that business first — it is the seller and the data fiduciary. We will still help if it doesn&apos;t respond.</p>
        </>
      ),
    },
    {
      id: "how",
      title: "How to raise a grievance",
      body: (
        <>
          <p>{g.email ? <>Email the Grievance Officer at <Mail to={g.email} /></> : <>Contact us — <ContactUs info={info} /> —</>} with:</p>
          <ol>
            <li>your name and how to contact you;</li>
            <li>what the complaint is about, with links (URLs), screenshots, invoice numbers or other details that help us find it;</li>
            <li>for content complaints, why you believe it is unlawful or harmful and, if it concerns you personally, your relationship to it;</li>
            <li>what outcome you are asking for.</li>
          </ol>
          <p>For complaints about personal data we may need to confirm your identity before acting. We won&apos;t charge you for raising a grievance.</p>
        </>
      ),
    },
    {
      id: "timelines",
      title: "Our response times",
      body: (
        <ul>
          <li><strong>Acknowledgement within 24 hours</strong> of receiving your complaint.</li>
          <li><strong>Resolution within 15 days</strong> of receipt, as required by Rule 3(2) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 — or sooner where the law requires.</li>
          <li><strong>Within 24 hours</strong> we act on complaints about content that exposes a person&apos;s private areas, shows them in full or partial nudity or a sexual act, or impersonates them in an electronic form, including artificially morphed images.</li>
          <li>Grievances about personal data are answered within the period set by the Digital Personal Data Protection Act, 2023 and its rules.</li>
        </ul>
      ),
    },
    {
      id: "escalation",
      title: "If you're not satisfied",
      body: (
        <>
          <p>If you disagree with the Grievance Officer&apos;s decision, reply to it and we will have it reviewed. You can also go to:</p>
          <ul>
            <li>the <strong>Grievance Appellate Committee</strong> set up under the IT Rules, 2021, within 30 days of the Grievance Officer&apos;s decision, for complaints about content and intermediary obligations;</li>
            <li>the <strong>Data Protection Board of India</strong>, for complaints about personal data, once you have used our grievance process;</li>
            <li>the <strong>National Consumer Helpline</strong> (1915, consumerhelpline.gov.in) or the appropriate Consumer Disputes Redressal Commission, if you are a consumer;</li>
            <li>your local data protection supervisory authority, if you are in the EU, EEA or UK.</li>
          </ul>
        </>
      ),
    },
    {
      id: "company",
      title: "Company details",
      body: <CompanyBlock info={info} />,
    },
  ];
  return (
    <LegalDoc
      path="/grievance"
      title="Grievance Redressal"
      intro={<>How to raise a complaint about {P} and what happens next, in line with the Information Technology Act, 2000, the IT Rules, 2021, the Consumer Protection Act, 2019 and the DPDP Act, 2023.</>}
      info={info}
      summary={[
        <>Send your complaint to our Grievance Officer with the details below.</>,
        <>We acknowledge within 24 hours and resolve within 15 days.</>,
        <>Not satisfied? You can appeal to the Grievance Appellate Committee, the Data Protection Board of India or a consumer forum.</>,
      ]}
      before={officer}
      sections={sections}
    />
  );
}
