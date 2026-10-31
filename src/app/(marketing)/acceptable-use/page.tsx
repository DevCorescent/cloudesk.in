import type { Metadata } from "next";
import Link from "next/link";
import { ContactUs, LegalDoc, legalMetadata, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/acceptable-use", "Acceptable Use Policy", "What you may not do with Cloudesk — illegal content, malware, phishing, spam, infringement, abuse of the platform — how to report abuse, and what happens if the rules are broken.");

export default async function AcceptableUsePage() {
  const info = await legalInfo();
  const { product: P } = info;
  const sections: LegalSection[] = [
    {
      id: "scope",
      title: "Scope",
      body: (
        <p>
          This policy applies to everyone who uses {P} — account holders, workspace members, and anyone using a site, store, portal, form or email sent through it — and to everything put into or published with it. It forms part of our <Link href="/terms">Terms of Service</Link>. Workspace owners are responsible for making sure their members and the content on their sites follow it.
        </p>
      ),
    },
    {
      id: "illegal",
      title: "Illegal and harmful content",
      body: (
        <>
          <p>Do not use the Service to create, host, publish, sell, or send anything that:</p>
          <ul>
            <li>is unlawful under Indian law or the law where you operate — including content prohibited by Rule 3(1)(b) of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021;</li>
            <li>is child sexual abuse material, or sexualises or exploits minors in any way (we report it to the authorities);</li>
            <li>is obscene, pornographic, invasive of another person&apos;s bodily privacy, or shared without the consent of the people in it;</li>
            <li>is defamatory, harasses, threatens or incites violence or hatred against people based on religion, caste, race, ethnicity, gender, sexual orientation, disability or other protected characteristics;</li>
            <li>promotes or facilitates terrorism, money laundering, gambling or betting that is illegal where offered, or the sale of illegal drugs, weapons, counterfeit goods, wildlife products or other prohibited items;</li>
            <li>impersonates a person, business or government body, or is deliberately misleading — including fake reviews, misleading prices or health claims, or misinformation that is patently false;</li>
            <li>threatens the unity, integrity, defence, security or sovereignty of India, friendly relations with foreign states, or public order.</li>
          </ul>
          <p>If you sell through a store built with {P}, you must hold any licences your products need and follow the Consumer Protection (E-Commerce) Rules, 2020 that apply to you as a seller — including showing your business details, prices with taxes, and your return and refund policy.</p>
        </>
      ),
    },
    {
      id: "security",
      title: "Malware, phishing and attacks",
      body: (
        <ul>
          <li>Don&apos;t upload, host or link to malware, ransomware, spyware or any code designed to harm devices or data.</li>
          <li>Don&apos;t build phishing pages, fake login or payment pages, or sites that collect passwords, card or bank details under false pretences.</li>
          <li>Don&apos;t use the Service — including its code-execution and automation features — to attack, scan, or gain unauthorised access to any system, mine cryptocurrency, or run denial-of-service traffic.</li>
          <li>Don&apos;t try to get around plan limits, the firewall, rate limits, or the boundaries between workspaces, or access data that isn&apos;t yours.</li>
        </ul>
      ),
    },
    {
      id: "spam",
      title: "Email, messaging and spam",
      body: (
        <>
          <ul>
            <li>Send marketing email and messages only to people who have agreed to receive them, or where the law otherwise allows it, and honour unsubscribe requests promptly.</li>
            <li>Don&apos;t use purchased, rented or scraped contact lists. Don&apos;t hide who you are, use misleading subject lines, or forge headers.</li>
            <li>Follow the rules that apply to you, including India&apos;s TRAI regulations on unsolicited commercial communication, the CAN-SPAM Act, and the GDPR and ePrivacy rules where they apply.</li>
          </ul>
          <p>We may pause sending from a workspace whose emails get unusually high bounce or complaint rates while we look into it.</p>
        </>
      ),
    },
    {
      id: "rights",
      title: "Other people's rights and data",
      body: (
        <ul>
          <li>Only upload content you own or have permission to use. Don&apos;t infringe copyrights, trade marks, designs, patents or trade secrets.</li>
          <li>Collect and use personal data lawfully: tell people what you collect and why, get consent where it&apos;s needed, and respond to their requests. This matters especially for health data (Clinic), children&apos;s data (Education), and employee and payroll data (HR).</li>
          <li>Don&apos;t use the Service to track or surveil people without a lawful basis.</li>
        </ul>
      ),
    },
    {
      id: "platform",
      title: "Fair use of the platform",
      body: (
        <ul>
          <li>Don&apos;t scrape, crawl or bulk-download the Service or other customers&apos; sites by automated means, except through our documented APIs and exports and within their limits. Search engines indexing published sites is fine.</li>
          <li>Don&apos;t overload the Service, for example by sending excessive requests, using it as general file hosting or a content-delivery network, or running long-lived workloads unrelated to your business.</li>
          <li>Don&apos;t resell, rent or share access to the Service, or white-label it, unless we have agreed in writing.</li>
          <li>Don&apos;t reverse-engineer the Service or use it to build a competing product.</li>
        </ul>
      ),
    },
    {
      id: "testing",
      title: "Security testing and responsible disclosure",
      body: (
        <p>
          Don&apos;t probe, scan or test the Service&apos;s security, or try to break into it, without our prior written permission. <strong>Good-faith security research is welcome:</strong> if you follow the responsible-disclosure guidelines on our <Link href="/security#disclosure">Security page</Link> — test only against your own account and data, avoid harming other users or the Service, don&apos;t access or keep others&apos; data, and report what you find to us privately — we won&apos;t treat your research as a breach of this policy.
        </p>
      ),
    },
    {
      id: "enforcement",
      title: "Reporting and enforcement",
      body: (
        <>
          <p>
            To report content or behaviour that breaks this policy, including on a site or store built with {P}, <ContactUs info={info} email={info.grievance.email} /> with the link and what is wrong. Complaints from users and affected persons are handled as described on the <Link href="/grievance">Grievance Redressal</Link> page.
          </p>
          <p>
            If we find a breach, we may — depending on how serious it is — warn the workspace, remove or disable access to the content, unpublish a site, pause email sending, suspend members or the workspace, or close the account. Where we act against content, we will tell the workspace owner what was removed and why, and give them a chance to respond, unless the law or the safety of others prevents it. We comply with lawful orders from courts and government agencies, and may report illegal activity to the authorities.
          </p>
        </>
      ),
    },
  ];
  return (
    <LegalDoc
      path="/acceptable-use"
      title="Acceptable Use Policy"
      intro={<>The rules for what you can create, publish and send with {P}, so the platform stays safe and trustworthy for everyone.</>}
      info={info}
      summary={[
        <>Nothing illegal, harmful, deceptive or infringing — on your sites, in your stores or in your emails.</>,
        <>No malware, phishing, spam, scraping or attacks on the platform or anyone else.</>,
        <>Handle your customers&apos; and employees&apos; personal data lawfully.</>,
        <>Security researchers acting in good faith are welcome — follow our disclosure guidelines.</>,
      ]}
      sections={sections}
    />
  );
}
