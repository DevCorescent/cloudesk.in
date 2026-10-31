import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, ContactUs, LegalDoc, legalMetadata, Table, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/dpa", "Data Processing Addendum", "Cloudesk's Data Processing Addendum: processor terms under GDPR Article 28 and India's DPDP Act 2023 — subject matter, sub-processors, security, breach notice, deletion, audits and international transfers.");

export default async function DpaPage() {
  const info = await legalInfo();
  const { product: P, operator } = info;
  const sections: LegalSection[] = [
    {
      id: "parties",
      title: "Parties and how this addendum applies",
      body: (
        <>
          <p>
            This Data Processing Addendum (&ldquo;DPA&rdquo;) forms part of the <Link href="/terms">Terms of Service</Link> between {info.company ? <strong>{info.company}</strong> : operator} (&ldquo;Processor&rdquo;, &ldquo;we&rdquo;) and the customer that owns a {P} workspace (&ldquo;Customer&rdquo;, &ldquo;you&rdquo;). It applies automatically, without signature, whenever we process Customer Personal Data on your behalf. If you need a countersigned copy for your records, <ContactUs info={info} lead="write to" />.
          </p>
          <p>
            &ldquo;Customer Personal Data&rdquo; means personal data in Customer Content (as defined in the Terms). &ldquo;Data Protection Law&rdquo; means all laws that apply to its processing, including India&apos;s Digital Personal Data Protection Act, 2023 and rules under it (&ldquo;DPDP Act&rdquo;), the Information Technology Act, 2000 and rules under it, the EU GDPR, the UK GDPR and Data Protection Act 2018, and the CCPA as amended by the CPRA. Terms such as &ldquo;controller&rdquo;, &ldquo;processor&rdquo;, &ldquo;data fiduciary&rdquo;, &ldquo;data principal&rdquo;, &ldquo;personal data breach&rdquo; and &ldquo;sub-processor&rdquo; have the meanings given in Data Protection Law.
          </p>
        </>
      ),
    },
    {
      id: "roles",
      title: "Roles",
      body: (
        <p>
          You are the controller (data fiduciary) of Customer Personal Data and we are your processor (data processor). Where you are yourself a processor for someone else, we are your sub-processor and you confirm that your instructions are authorised by your controller. You are responsible for having a lawful basis, giving notices and obtaining any consents needed for the processing — including parental consent for children&apos;s data and explicit consent for health data where required.
        </p>
      ),
    },
    {
      id: "details",
      title: "Details of the processing",
      body: (
        <Table
          head={["Item", "Details"]}
          rows={[
            [<strong key="1">Subject matter</strong>, `Providing ${P}: hosting and running the website and store builder, point of sale, invoicing and accounting, CRM, HR and payroll, mail, calendar, chat, helpdesk, portals, industry modules (such as clinic, education and construction), AI features and related support.`],
            [<strong key="2">Duration</strong>, "For the term of your subscription and until the data is deleted as described in section 10."],
            [<strong key="3">Nature and purpose</strong>, "Storage, hosting, organisation, retrieval, display, transmission (including sending emails you send), computation (reports, payroll, tax), backup, security monitoring, and support — only as needed to provide the Service you use and as you instruct."],
            [<strong key="4">Categories of data subjects</strong>, "Your members and employees; your customers, leads and contacts; suppliers; website and store visitors; patients (clinic); students and their guardians (education); job applicants; any other people whose data you put into the Service."],
            [<strong key="5">Types of personal data</strong>, "Identity and contact details; orders, invoices and payment status; employment, attendance, leave and payroll data, including bank account and tax identifiers; messages, emails and files; health records (clinic); academic and attendance records (education); device and usage data from your sites and portals; any other data you choose to store."],
            [<strong key="6">Special categories / sensitive data</strong>, "Only if you choose to store it — for example health data in the Clinic module or financial information in payroll. You must make sure you are allowed to process it."],
          ]}
        />
      ),
    },
    {
      id: "instructions",
      title: "Processing only on your instructions",
      body: (
        <p>
          We process Customer Personal Data only on your documented instructions — which are the Terms, this DPA, and your use and configuration of the Service — unless the law requires otherwise, in which case we will tell you before processing unless the law prohibits it. We will tell you if we believe an instruction infringes Data Protection Law. We will not sell Customer Personal Data, use it for advertising, combine it with data from other customers, or use it for any purpose other than providing, securing and supporting the Service.
        </p>
      ),
    },
    {
      id: "confidentiality",
      title: "Confidentiality and personnel",
      body: (
        <p>
          We ensure that anyone we authorise to process Customer Personal Data is bound by confidentiality, and that access is limited to people who need it to run or support the Service. Workspace owners can grant our support team time-limited access to a workspace for a stated reason (up to 72 hours), and each grant is recorded in the workspace&apos;s audit log.
        </p>
      ),
    },
    {
      id: "security",
      title: "Security measures",
      body: (
        <>
          <p>We implement appropriate technical and organisational measures, taking into account the state of the art, cost, and the risks to data subjects, including:</p>
          <ul>
            <li>encryption in transit (HTTPS/TLS with HSTS) and AES-256-GCM encryption of stored credentials, mailbox secrets and two-step sign-in secrets;</li>
            <li>Argon2id password hashing, hashed session tokens, two-step sign-in, SSO (SAML/OIDC) and SCIM provisioning;</li>
            <li>separation of workspaces enforced on the server for every request, role-based access with custom roles, and audit logging;</li>
            <li>a web application firewall, rate limiting, same-origin checks against cross-site request forgery, and a Content Security Policy;</li>
            <li>database backups on the schedule set for the platform&apos;s hosting, and processes for testing and reviewing these measures.</li>
          </ul>
          <p>More detail is on our <Link href="/security">Security page</Link>. We may update these measures as long as the overall level of protection is not reduced.</p>
        </>
      ),
    },
    {
      id: "subprocessors",
      title: "Sub-processors",
      body: (
        <p>
          You authorise us to use the sub-processors listed on our <Link href="/subprocessors">Sub-processors page</Link>. We impose data-protection obligations on each sub-processor that are no less protective than this DPA, and we remain responsible for their performance. We will update that page before a new sub-processor starts processing Customer Personal Data and, if you have asked us to, notify you by email at least 15 days in advance. You may object on reasonable data-protection grounds within that period; if we can&apos;t reasonably accommodate the objection, you may terminate the affected Service and receive a refund of prepaid fees for the remaining period.
        </p>
      ),
    },
    {
      id: "assistance",
      title: "Helping you with requests and compliance",
      body: (
        <>
          <p>
            Taking into account the nature of the processing, we help you respond to requests from data principals / data subjects to exercise their rights (access, correction, erasure, portability, objection, grievance redressal and nomination) — largely through the Service itself, which lets you find, edit, export and delete records. If we receive a request directly, we will pass it to you and not respond ourselves except to direct the person to you.
          </p>
          <p>We also give you reasonable help with data protection impact assessments, prior consultations with authorities, and your security obligations, using information available to us.</p>
        </>
      ),
    },
    {
      id: "breach",
      title: "Personal data breaches",
      body: (
        <p>
          We will notify you <strong>without undue delay</strong> after becoming aware of a personal data breach affecting Customer Personal Data, and in any case within the time that lets you meet your own deadlines (including the DPDP Act&apos;s requirement to inform the Data Protection Board and affected data principals, and the GDPR&apos;s 72-hour window). The notice will describe, as far as known, the nature of the breach, the data and data subjects concerned, likely consequences, and the measures taken or proposed. We will take reasonable steps to contain it, and we report cyber-security incidents to CERT-In as Indian law requires.
        </p>
      ),
    },
    {
      id: "deletion",
      title: "Return and deletion",
      body: (
        <p>
          During your subscription you can export Customer Personal Data at any time (lists as CSV or Excel, or the whole workspace as a machine-readable file). When a workspace is deleted — by you, or after your account ends — we delete Customer Personal Data from the live systems after a 30-day grace period, and copies in backups expire on the backup schedule, unless the law requires us to keep some of it, in which case we keep it protected and only for that purpose.
        </p>
      ),
    },
    {
      id: "audits",
      title: "Information and audits",
      body: (
        <p>
          We will make available the information reasonably needed to demonstrate compliance with this DPA, and allow for and contribute to audits, including inspections, by you or an independent auditor you appoint and who is bound by confidentiality. Audits must be requested with at least 30 days&apos; notice, take place during business hours no more than once a year (unless required by a regulator or after a breach), avoid disrupting the Service or exposing other customers&apos; data, and be at your cost. We will first try to satisfy a request with written answers and documentation.
        </p>
      ),
    },
    {
      id: "transfers",
      title: "International transfers",
      body: (
        <>
          <p>
            We may process Customer Personal Data, and use sub-processors that process it, outside the country where you are located, subject to this DPA. We will comply with any restriction on transfers notified by the Government of India under the DPDP Act.
          </p>
          <p>
            Where Customer Personal Data subject to the GDPR or UK GDPR is transferred to a country without an adequacy decision, the <strong>Standard Contractual Clauses</strong> adopted by the European Commission (Decision 2021/914) — Module 2 (controller to processor) or Module 3 (processor to processor) as applicable — and, for the UK, the International Data Transfer Addendum, are incorporated into this DPA by reference. For those clauses: the optional docking clause applies; option 2 (general authorisation) applies to sub-processors with the notice period in section 7; the clauses are governed by the law of Ireland (or, for the UK Addendum, the law of England and Wales); the details of processing are in section 3 and the security measures in section 6.
          </p>
        </>
      ),
    },
    {
      id: "ccpa",
      title: "California (CCPA/CPRA)",
      body: (
        <p>
          Where the CCPA applies, we act as your service provider. We will not sell or share Customer Personal Data, retain, use or disclose it outside the direct business relationship with you or for any purpose other than the business purposes in this DPA, or combine it with personal information from other sources except as the CCPA permits. We will tell you if we can no longer meet these obligations.
        </p>
      ),
    },
    {
      id: "general",
      title: "Liability, precedence and contact",
      body: (
        <>
          <p>
            Each party&apos;s liability under this DPA is subject to the limitations in the Terms, except where Data Protection Law does not allow them. If this DPA conflicts with the Terms, this DPA prevails for the processing of Customer Personal Data; if the Standard Contractual Clauses conflict with this DPA, the clauses prevail.
          </p>
          <p>Questions about this DPA? <ContactUs info={info} email={info.dpo.email} />.</p>
          <CompanyBlock info={info} />
        </>
      ),
    },
  ];
  return (
    <LegalDoc
      path="/dpa"
      title="Data Processing Addendum"
      intro={<>Our commitments when we process your customers&apos;, employees&apos; and other people&apos;s personal data on your behalf.</>}
      info={info}
      summary={[
        <>You are the controller (data fiduciary); we are your processor and act only on your instructions.</>,
        <>We never sell your data or use it for anything other than running {P} for you.</>,
        <>We tell you about breaches without undue delay, help you answer people&apos;s requests, and list every sub-processor.</>,
        <>You can export everything at any time; when you leave, your data is deleted after 30 days.</>,
        <>EU/UK transfers are covered by the Standard Contractual Clauses.</>,
      ]}
      sections={sections}
    />
  );
}
