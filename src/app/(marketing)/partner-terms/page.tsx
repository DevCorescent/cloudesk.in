import type { Metadata } from "next";
import Link from "next/link";
import { ContactUs, LegalDoc, legalMetadata, Table, type LegalSection } from "@/components/legal/doc";
import { discountText, months, pct, TYPE_INFO } from "@/lib/partners/program";
import { legalInfo } from "@/server/legal/info";
import { publicProgram } from "@/server/partners/core";

export const metadata: Metadata = legalMetadata("/partner-terms", "Partner Terms", "The terms of the Cloudesk Partner Program: who can join, how customers are credited to you, commission, holds, payouts and tax, and the rules for promoting Cloudesk.");

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

export default async function PartnerTermsPage() {
  const [info, prog] = await Promise.all([legalInfo(), publicProgram()]);
  const { product: P, operator } = info;
  const sections: LegalSection[] = [
    {
      id: "program",
      title: "The program",
      body: (
        <>
          <p>
            The {P} Partner Program (the “Program”) lets organisations and individuals (“you”, a “Partner”) earn a commission when businesses they introduce subscribe to {P}. The Program is run by {operator} (“we”, “us”). These Partner Terms apply in addition to the <Link href="/terms">Terms of Service</Link>, which govern your use of {P} itself. If the two conflict on something about the Program, these Partner Terms apply.
          </p>
          <p>By applying, you confirm you are at least 18 years old and able to enter into a contract, and, if you apply for an organisation, that you are authorised to bind it.</p>
        </>
      ),
    },
    {
      id: "applying",
      title: "Applying and approval",
      body: (
        <ul>
          <li>We review every application and may approve or decline it at our discretion. We may ask for more information, including proof of identity, your PAN (for tax) or your GSTIN (if registered).</li>
          <li>You must keep your details accurate, including your payout details. You are responsible for anything done with your partner account.</li>
          <li>Approval doesn&apos;t make you our employee, agent, franchisee or joint venturer. You are an independent contractor, you set your own working hours and methods, and you may not make promises, sign contracts or accept payments on our behalf.</li>
        </ul>
      ),
    },
    {
      id: "roles",
      title: "Kinds of partner and scope of work",
      body: (
        <>
          <p>You apply as one kind of partner. The scope of work below describes what partners of that kind typically do; you are not obliged to do all of it, and we don&apos;t set targets.</p>
          <Table head={["Kind of partner", "Typical scope of work"]} rows={Object.values(TYPE_INFO).map((t) => [<strong key="n">{t.name}</strong>, t.scope.join("; ") + "."])} />
          <p>We may change the kind of partner your account is set up as, if it better reflects your work, and will tell you if we do.</p>
        </>
      ),
    },
    {
      id: "attribution",
      title: "Which customers are yours",
      body: (
        <>
          <p>A {P} workspace (a “Referred Customer”) is credited to you when, and only when, one of these happens first:</p>
          <ul>
            <li>it signs up within <strong>{prog.cookieDays} days</strong> of visiting {P} through your partner link (we remember the visit with a cookie in that browser — see our <Link href="/cookies">Cookie Policy</Link>);</li>
            <li>its owner enters one of your active codes when signing up, or later in Settings → Billing, as long as no partner was already credited;</li>
            <li>it signs up with the email address of a lead you registered in your dashboard, within <strong>{prog.leadDays} days</strong> of registering it. A lead can be registered by only one partner at a time, and existing {P} accounts can&apos;t be registered.</li>
          </ul>
          <p>Each workspace can be credited to only one partner. Workspaces you own, or that you or your organisation use, are never credited to you. We may correct a credit made in error, or move it where there is clear evidence it belongs to another partner, and will tell you if we do.</p>
        </>
      ),
    },
    {
      id: "commission",
      title: "Commission",
      body: (
        <>
          <p>
            For each payment a Referred Customer makes for a {P} subscription — first payments, renewals and upgrades — you earn the commission rate for your kind of partner, applied to the amount actually paid <strong>excluding GST and other taxes</strong>, and after any discount, credit or proration. You earn for the commission window measured from when the customer was credited to you:
          </p>
          <Table
            head={["Kind of partner", "Commission", "Window", "Customer discount with your code"]}
            rows={prog.types.map((t) => [TYPE_INFO[t.id].name, pct(t.commissionBps), months(t.commissionMonths).replace(/^for /, ""), discountText(t.discountBps, t.discountPayments) || "None"])}
          />
          <p>
            <strong>Tiers.</strong> Your tier depends on how many of your Referred Customers are paying at the time a payment is made; a higher tier adds a bonus to your rate: {prog.tiers.map((t) => `${t.name} — ${t.minActive ? `${t.minActive}+ paying customers` : "from the start"}${t.bonusBps ? `, +${pct(t.bonusBps)}` : ""}`).join("; ")}.
          </p>
          <p>
            We may agree a different rate with you, or set one for a particular code; that rate is shown in your dashboard. We may change the Program&apos;s rates, windows and tiers for the future. Changes don&apos;t affect commission already earned, and a customer&apos;s window is fixed when they&apos;re credited to you. Commission is calculated and paid in Indian rupees.
          </p>
        </>
      ),
    },
    {
      id: "codes",
      title: "Codes and customer discounts",
      body: (
        <ul>
          <li>Your partner code works as a link and as a coupon. You may make additional codes in your dashboard, up to the limit and maximum discount we set for your kind of partner.</li>
          <li>A discount applies to the customer&apos;s next invoices as described for the code, and is shown on those invoices. Discounts can&apos;t be exchanged for cash or combined with another partner&apos;s code.</li>
          <li>You may not publish codes on coupon or deal aggregator sites unless we have agreed to it in writing, and you may not make codes that imitate our name or other brands.</li>
          <li>We may switch off or change any code that is misused, and codes stop working while your partner account is suspended.</li>
        </ul>
      ),
    },
    {
      id: "holds",
      title: "Holding period, refunds and reversals",
      body: (
        <>
          <p>
            Each commission is held for <strong>{prog.holdDays} days</strong> after the customer&apos;s payment, and becomes available to withdraw after that. If a payment is refunded, reversed, charged back or found to be fraudulent or made in breach of these terms, the commission on it is cancelled — and if it was already paid out, we may deduct it from your future commission.
          </p>
          <p>We may also make adjustments (positive or negative) to correct errors or for bonuses we have agreed with you. Every commission and adjustment is listed in your dashboard with its reason.</p>
        </>
      ),
    },
    {
      id: "payouts",
      title: "Payouts and tax",
      body: (
        <>
          <ul>
            <li>You can request a payout of your available balance once it is at least <strong>{rupees(prog.minPayout)}</strong>. One request can be in progress at a time.</li>
            <li>We check each request and, once approved, send it to the UPI ID or bank account in your payout details. We aim to send approved payouts within 7 working days and email you the transfer reference. For international wires, bank charges may be deducted by the banks involved.</li>
            <li>We may hold a payout while we verify your identity or payout details, or investigate suspected fraud or a breach of these terms.</li>
            <li><strong>Tax.</strong> Where the law requires us to withhold tax at source (in India, TDS on commission under section 194H of the Income-tax Act, 1961), we deduct it from the payout and show it on the payout; you can claim credit for it in your return. You are responsible for declaring your commission as income and, if you are registered for GST, for issuing us a tax invoice for your services when we ask.</li>
          </ul>
          <p>Bank and UPI details are stored encrypted. Only staff who process payouts can see them in full, and every time they do it is recorded.</p>
        </>
      ),
    },
    {
      id: "promotion",
      title: "How you may promote Cloudesk",
      body: (
        <>
          <p>You must promote {P} honestly and lawfully. In particular, you must not:</p>
          <ul>
            <li>bid on “{P}” or misspellings of it as search-ad keywords, or use our name in domain names, app names or social handles;</li>
            <li>pretend to be {P}, our staff or an official reseller unless we have appointed you as one in writing;</li>
            <li>send unsolicited bulk messages — email, SMS, WhatsApp or calls — including in breach of the Telecom Commercial Communications Customer Preference Regulations in India or anti-spam laws elsewhere;</li>
            <li>make claims about {P} that aren&apos;t true, including about prices, features, security or certifications, or write or buy fake reviews;</li>
            <li>set referral cookies without a genuine click (“cookie stuffing”), use bots or incentivised clicks, or encourage people to sign up only to earn you a commission.</li>
          </ul>
          <p>
            <strong>Disclosure.</strong> When you are paid to promote {P}, you must say so clearly — for example “#ad” or “paid partnership” — as required by the Consumer Protection Act, 2019 and the CCPA&apos;s Guidelines for Prevention of Misleading Advertisements and Endorsements, 2022, the ASCI Guidelines for Influencer Advertising in India, and, outside India, rules such as the US FTC Endorsement Guides and the UK CAP Code.
          </p>
        </>
      ),
    },
    {
      id: "data",
      title: "Personal data",
      body: (
        <>
          <p>
            Your dashboard shows each Referred Customer&apos;s business name, plan, status and what they paid, so you can see your commission; it doesn&apos;t give you access to their workspace or their customers&apos; data. If you register a lead, you confirm that you have a lawful basis to share that person&apos;s contact details with us and that they expect to hear about {P}. You must handle any personal data you receive in connection with the Program in line with the Digital Personal Data Protection Act, 2023, the GDPR where it applies, and other applicable law.
          </p>
          <p>How we handle your own personal data as a Partner is described in our <Link href="/privacy">Privacy Policy</Link>.</p>
        </>
      ),
    },
    {
      id: "brand",
      title: "Our name and logo",
      body: <p>While you are an approved Partner, you may use the {P} name and logo, as provided in your dashboard and without changing them, to promote {P}. This permission ends when you stop being a Partner or if we withdraw it. You must not suggest we endorse your own products or services.</p>,
    },
    {
      id: "ending",
      title: "Suspension and ending",
      body: (
        <ul>
          <li>You can leave the Program at any time by telling us. We can end your participation with 30 days&apos; notice, or immediately (or suspend it) if you breach these terms, act fraudulently or harm our reputation.</li>
          <li>When your participation ends, commission already earned for payments made before the end, and not cancelled under these terms, is paid once its holding period is over. If we end it for a breach or fraud, unpaid commission connected with that breach is forfeited.</li>
          <li>While your account is suspended your codes and links don&apos;t credit new customers to you, and payments made during the suspension don&apos;t earn commission.</li>
        </ul>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: <p>We may update these Partner Terms. For material changes we will give you at least 15 days&apos; notice by email or in your dashboard; continuing in the Program after that means you accept them. Changes never reduce commission already earned.</p>,
    },
    {
      id: "law",
      title: "Liability, law and disputes",
      body: <p>The limitation of liability, governing law and dispute resolution sections of the <Link href="/terms">Terms of Service</Link> also apply to the Program. You are responsible for any claims arising from how you promote {P}, and you agree to make good any loss we suffer because of a breach of these terms by you.</p>,
    },
    {
      id: "contact",
      title: "Contact",
      body: <ContactUs info={info} />,
    },
  ];
  return (
    <LegalDoc
      path="/partner-terms"
      title="Partner Terms"
      intro={<>The terms of the {P} Partner Program: who can join, which customers are credited to you, what you earn, how payouts and tax work, and the rules for promoting {P}.</>}
      info={info}
      summary={[
        <>You earn a share of what customers you bring pay, before tax, for the window of your kind of partner.</>,
        <>Customers are yours if they come through your link (within {prog.cookieDays} days), use your code, or match a lead you registered (within {prog.leadDays} days). One partner per customer; never your own workspaces.</>,
        <>Commission is held {prog.holdDays} days, then can be withdrawn from {rupees(prog.minPayout)}. Refunded or fraudulent payments don&apos;t earn.</>,
        <>Tax is withheld where the law requires it. You must disclose paid promotion and never spam, bid on our name or make false claims.</>,
      ]}
      sections={sections}
    />
  );
}
