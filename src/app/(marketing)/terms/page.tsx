import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, ContactUs, LegalDoc, legalMetadata, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/terms", "Terms of Service", "The agreement for using Cloudesk: accounts, the free trial, subscriptions and GST, your content, acceptable use, liability, termination and the law that applies.");

export default async function TermsPage() {
  const info = await legalInfo();
  const { product: P, operator, pricing: pr } = info;
  const courts = info.jurisdiction ? <>the courts at <strong>{info.jurisdiction}</strong>, India</> : <>the courts having jurisdiction over the place where {operator}&apos;s registered office is located, in India</>;
  const sections: LegalSection[] = [
    {
      id: "agreement",
      title: "About these terms",
      body: (
        <>
          <p>
            These Terms of Service (the &ldquo;Terms&rdquo;) are an agreement between you and {info.company ? <strong>{info.company}</strong> : operator} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) for the use of {P}: the website, store and business software service available at this website, including the web app, published sites and stores, customer and supplier portals, APIs and related support (together, the &ldquo;Service&rdquo;).
          </p>
          <p>
            By creating an account, starting a free trial, or using the Service, you accept these Terms. If you accept them on behalf of a business or other organisation, you confirm that you have authority to bind it, and &ldquo;you&rdquo; means that organisation. These Terms incorporate our <Link href="/privacy">Privacy Policy</Link>, <Link href="/acceptable-use">Acceptable Use Policy</Link>, <Link href="/refunds">Refund &amp; Cancellation Policy</Link>, <Link href="/cookies">Cookie Policy</Link> and, where we process personal data on your behalf, our <Link href="/dpa">Data Processing Addendum</Link>.
          </p>
          <p>If a separate written agreement signed by both of us covers the Service, that agreement prevails over these Terms where they conflict.</p>
        </>
      ),
    },
    {
      id: "eligibility",
      title: "Who may use the Service",
      body: (
        <>
          <p>
            The Service is built for businesses, professionals and organisations. You must be at least 18 years old and competent to contract under the Indian Contract Act, 1872 (or the law that applies to you) to create an account. The Service is not directed at children and must not be used to create an account for a person under 18.
          </p>
          <p>You may not use the Service if you are barred from doing so under the laws of India or of the country you use it from, or if we have previously suspended or closed your account for breaching these Terms.</p>
        </>
      ),
    },
    {
      id: "accounts",
      title: "Accounts, workspaces and security",
      body: (
        <>
          <p>
            You use the Service through a personal account, and your business data lives in one or more <strong>workspaces</strong>. The person who creates a workspace is its first owner. Owners and admins decide who is invited, what role each member has, and which features are switched on. A workspace&apos;s owners are responsible for the people they invite and for what those people do in the workspace.
          </p>
          <ul>
            <li>Give accurate information when you sign up and keep it up to date.</li>
            <li>Keep your password confidential, use a strong one, and turn on two-step sign-in. Workspace owners can require two-step sign-in for every member.</li>
            <li>Don&apos;t share accounts. Each person should have their own login so that the audit log shows who did what.</li>
            <li>Tell us promptly if you believe your account has been accessed without permission — <ContactUs info={info} />.</li>
          </ul>
          <p>You are responsible for activity under your account unless it results from our failure to take reasonable security measures.</p>
        </>
      ),
    },
    {
      id: "trial",
      title: "Free trial",
      body: (
        <>
          <p>
            New workspaces start with a free trial{pr.trialDays ? <> of <strong>{pr.trialDays} days</strong></> : null} with access to the features and limits described on our <Link href="/pricing">pricing page</Link> at the time you sign up. No card is needed to start a trial.
          </p>
          <p>
            You can choose a plan at any time during the trial; its first invoice is due when the trial ends, and paying early does not shorten the trial. If no plan has been chosen and paid for when the trial ends, the workspace moves to the <strong>Free plan</strong> where one is offered — a limited set of features with monthly allowances; data in other features is kept but can&apos;t be opened until a plan is paid for — or otherwise becomes <strong>read-only</strong>: you can still sign in, open and export your data, but you cannot make changes. Nothing is deleted because a trial ended.
          </p>
          <p>We may change or withdraw the trial offer for future sign-ups; changes never shorten a trial already running.</p>
        </>
      ),
    },
    {
      id: "billing",
      title: "Subscriptions, prices, GST and renewals",
      body: (
        <>
          <h3>Plans and prices</h3>
          <p>
            Plans, the features and limits they include (such as seats, web apps and custom domains) and their prices are shown on the <Link href="/pricing">pricing page</Link> and in Settings → Billing. You can choose a ready-made plan or build your own from the features you need. Prices are in {pr.currency === "INR" ? "Indian rupees (₹)" : pr.currency} and are shown <strong>before tax</strong>. Plans are billed monthly or yearly; yearly billing is charged as {pr.yearlyMonths} months of the monthly price.
          </p>
          <h3>Taxes</h3>
          <p>
            {pr.taxLabel} (currently {pr.taxPct}) and any other taxes required by law are added to each invoice and shown on it. You are responsible for providing correct billing details, including your GSTIN if you want to claim input tax credit. Where you are required by law to withhold tax (such as TDS) from a payment, you must give us the certificate so that we can claim credit for it.
          </p>
          <h3>Invoices and paying</h3>
          <p>
            We raise an invoice for each subscription period and for each plan change, and you pay it online through our payment partners (Razorpay or Stripe), or by another method we agree in writing. Payments are processed by those partners; <strong>we never see or store your full card number, CVV, UPI PIN or net-banking password</strong>. You authorise us and our payment partners to collect the amounts shown on invoices you choose to pay.
          </p>
          <h3>Renewals</h3>
          <p>
            Subscriptions renew for the same period unless cancelled. We raise the renewal invoice {pr.renewalNoticeDays ? <>about {pr.renewalNoticeDays} days</> : <>shortly</>} before the current period ends and send it to the workspace&apos;s billing contacts. Renewals are not automatically debited from a saved card or UPI mandate — the invoice has to be paid.
          </p>
          <h3>Late payment and suspension</h3>
          <p>
            If a renewal invoice is not paid by the end of the period, the workspace keeps full access for a grace period{pr.graceDays ? <> of <strong>{pr.graceDays} days</strong></> : null}. If it is still unpaid after that, the subscription ends and the workspace becomes read-only until a plan is paid for. Your data is not deleted because a payment is late; it stays available to view and export. Published sites and stores are part of the subscription and may stop accepting changes while the workspace is read-only.
          </p>
          <h3>Changing plan</h3>
          <p>
            An <strong>upgrade</strong> takes effect once its invoice is paid. You pay for the time left in the period at the new price, less a credit for the unused time on your current plan, calculated precisely. A <strong>downgrade</strong> takes effect at the end of the current period; you keep everything you have until then. Credit on your account is used against future invoices.
          </p>
          <h3>Price changes</h3>
          <p>
            We may change prices for future periods. A change never affects a period you have already paid for, and we will tell workspace owners at least 30 days before a price increase applies to their subscription. If you don&apos;t accept it, you can cancel before it takes effect.
          </p>
          <h3>Refunds</h3>
          <p>
            Refunds are covered by our <Link href="/refunds">Refund &amp; Cancellation Policy</Link>. In short: no charges during the trial, cancellations take effect at the end of the paid period, and duplicate or failed payments are refunded.
          </p>
        </>
      ),
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: (
        <p>
          You must use the Service lawfully and in line with our <Link href="/acceptable-use">Acceptable Use Policy</Link>, which forms part of these Terms. In particular, you may not use it for unlawful content or trade, malware, phishing, spam, infringing other people&apos;s rights, or attacking or overloading the Service. We may remove content or restrict an account as described in that policy and in the section on suspension below.
        </p>
      ),
    },
    {
      id: "your-content",
      title: "Your content and your customers' data",
      body: (
        <>
          <p>
            &ldquo;Customer Content&rdquo; means everything you or your members put into the Service — websites, products, orders, invoices, contacts, employee and payroll records, patient, student and project records, emails, chat messages, files — and everything your own customers submit through your sites, stores and portals.
          </p>
          <ul>
            <li><strong>You own your Customer Content.</strong> We claim no ownership of it.</li>
            <li>You give us a limited, worldwide, non-exclusive licence to host, store, copy, transmit, display and process Customer Content only as needed to provide, secure and support the Service for you, as you instruct through your use of it, and as required by law.</li>
            <li>We don&apos;t sell Customer Content and don&apos;t use it to advertise to anyone.</li>
            <li>You are responsible for Customer Content and for having the rights, permissions and lawful basis needed to put it into the Service — including any notices to and consents from your own customers, employees, patients or students.</li>
          </ul>
          <p>
            For personal data in Customer Content, <strong>you are the data controller (the &ldquo;data fiduciary&rdquo; under India&apos;s Digital Personal Data Protection Act, 2023) and we are your processor</strong>. Our obligations as processor are in the <Link href="/dpa">Data Processing Addendum</Link>, which applies automatically.
          </p>
          <p>Where your published site, store or portal collects payments or data from your customers, you are the seller or service provider to them, and you are responsible for your own terms, privacy notice, refund policy, invoices, tax compliance and customer support.</p>
        </>
      ),
    },
    {
      id: "ip",
      title: "Our intellectual property",
      body: (
        <>
          <p>
            The Service, its software, design, templates, documentation and brand are owned by us or our licensors and are protected by intellectual-property laws. Subject to these Terms and to paying for your subscription, we give you a limited, non-exclusive, non-transferable right to use the Service for your business during your subscription.
          </p>
          <p>
            Templates, sections and sample content we provide may be used in the sites you build with the Service, including after you export or publish them elsewhere. Stock photography included in templates is provided under its own licence (for example, the Unsplash licence) and you are responsible for checking that any image suits your use.
          </p>
          <p>You may not copy, resell, sub-license or reverse-engineer the Service (except as the law permits), remove notices of ownership, or use it to build a competing product. If you send us suggestions, we may use them without obligation to you.</p>
        </>
      ),
    },
    {
      id: "third-party",
      title: "Third-party services",
      body: (
        <>
          <p>
            The Service connects to services run by others when you or we switch them on — for example payment gateways (Razorpay, Stripe, PayPal) for your store, mailboxes (Gmail, Microsoft 365 or any IMAP/SMTP server), sign-in with GitHub or your company&apos;s single sign-on, publishing to GitHub, Netlify, Vercel or Cloudflare Pages, and AI providers. Your use of a third-party service is governed by its own terms and privacy policy, and you are responsible for the accounts and keys you connect.
          </p>
          <p>We are not responsible for third-party services, their availability, or what they do with data you choose to send them, except where they act as our sub-processor (see <Link href="/subprocessors">Sub-processors</Link>).</p>
        </>
      ),
    },
    {
      id: "ai",
      title: "AI features",
      body: (
        <>
          <p>
            Some features use artificial intelligence — for example the copilot, the website builder assistant, reading bills and documents, and drafting text. AI features are only active when they are enabled for the Service; when they are, the instructions and content needed for that task are sent to the AI provider listed on our <Link href="/subprocessors">Sub-processors</Link> page to produce the result. Under its commercial terms, our AI provider does not use content sent through its API to train its models.
          </p>
          <p>
            <strong>AI output can be wrong, incomplete or inappropriate.</strong> It is a suggestion, not professional, legal, tax, medical or financial advice. Review it before you rely on it, publish it or send it to anyone — especially invoices, payroll, tax filings, contracts and anything shown to your customers. You are responsible for how you use output, and for not putting into AI features content you are not allowed to share.
          </p>
        </>
      ),
    },
    {
      id: "availability",
      title: "Availability, support and changes to the Service",
      body: (
        <>
          <p>
            We work to keep the Service available and fast, but it is provided on an &ldquo;as available&rdquo; basis and <strong>no uptime or service-level commitment applies unless we have agreed one with you in writing</strong>. We may need planned maintenance (during which workspaces may be briefly read-only) and things outside our control can cause interruptions.{info.statusPageUrl ? <> Current status is published at <a href={info.statusPageUrl}>{info.statusPageUrl}</a>.</> : null}
          </p>
          <p>
            The Service changes as we improve it. We may add, change or remove features; if we remove a material feature you pay for, we will tell you in advance where reasonably possible and, if you are on a prepaid period and the change materially reduces what you paid for, you may cancel and receive a pro-rata refund for the unused prepaid time.
          </p>
          <p>You should keep your own copies of important records. Exports are available at any time (see below).</p>
        </>
      ),
    },
    {
      id: "warranties",
      title: "Disclaimers",
      body: (
        <>
          <p>
            Except as expressly set out in these Terms, and to the fullest extent permitted by law, the Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, and we disclaim all warranties, express or implied, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement, and any warranty that the Service will be uninterrupted or error-free.
          </p>
          <p>
            The Service includes tools for accounting, GST, TDS, payroll, e-invoicing and e-way bills, and other compliance tasks. They help you prepare records and files; they do not replace a qualified accountant, tax advisor or lawyer, and you remain responsible for checking figures, tax rates and filings, and for meeting your own legal obligations.
          </p>
          <p>Nothing in these Terms excludes rights you have as a consumer that cannot be excluded by law.</p>
        </>
      ),
    },
    {
      id: "liability",
      title: "Limitation of liability",
      body: (
        <>
          <p>To the fullest extent permitted by law:</p>
          <ul>
            <li>Neither of us is liable to the other for any indirect, incidental, special, consequential or punitive loss, or for loss of profits, revenue, goodwill or anticipated savings, however caused, even if it was foreseeable.</li>
            <li>Our total liability arising out of or relating to the Service and these Terms in any 12-month period is limited to the amount you paid us for the Service in the 12 months before the event giving rise to the claim.</li>
          </ul>
          <p>
            These limits do not apply to liability that cannot be limited by law, including liability for fraud, death or personal injury caused by negligence, or to your obligations to pay for the Service or under the indemnity below.
          </p>
        </>
      ),
    },
    {
      id: "indemnity",
      title: "Indemnity",
      body: (
        <p>
          You will defend and indemnify us, our officers and employees against claims, fines, losses and reasonable costs (including legal fees) brought by third parties or authorities that arise from your Customer Content, your sites, stores and dealings with your own customers, your breach of these Terms or the Acceptable Use Policy, or your violation of law or of someone else&apos;s rights. We will tell you promptly about such a claim and let you control its defence, and you won&apos;t settle it in a way that admits fault on our behalf without our consent.
        </p>
      ),
    },
    {
      id: "termination",
      title: "Suspension, termination and your data",
      body: (
        <>
          <h3>You can leave at any time</h3>
          <p>
            You can cancel a subscription in Settings → Billing; it ends at the end of the period you have paid for. A workspace owner can delete a workspace in Settings; deletion is scheduled 30 days ahead so that it can be cancelled if it was a mistake, and then the workspace and everything in it is deleted. You can close your personal account by contacting us.
          </p>
          <h3>When we may suspend or terminate</h3>
          <p>
            We may suspend or restrict access to an account, workspace, site or feature if you materially breach these Terms or the Acceptable Use Policy, if invoices remain unpaid after the grace period, if required by law or a lawful order, or if needed to protect the Service, other users or the public from harm. Where it is lawful and practical we will tell you first and give you a reasonable chance to fix the problem. We may terminate these Terms for repeated or serious breaches, or on 30 days&apos; notice if we stop offering the Service (in which case we refund prepaid fees for the unused period).
          </p>
          <h3>Exporting and deleting your data</h3>
          <p>
            You can export lists as CSV or Excel at any time, and an owner can export the whole workspace from Settings. Export files are kept for download for 7 days. After a workspace is deleted we remove its data from the live database; copies in backups expire on the backup schedule set for the platform. Some records may be kept longer where the law requires (for example, our own tax invoices to you). Details are in the <Link href="/privacy#retention">Privacy Policy</Link>.
          </p>
          <p>Sections that by their nature should survive termination (including payment obligations, ownership, disclaimers, limitation of liability, indemnity and governing law) survive it.</p>
        </>
      ),
    },
    {
      id: "law",
      title: "Governing law and disputes",
      body: (
        <>
          <p>
            These Terms are governed by the laws of India. Subject to the arbitration clause below, {courts} have exclusive jurisdiction over any dispute arising out of or relating to these Terms or the Service.
          </p>
          <p>
            <strong>Talk to us first.</strong> Before starting proceedings, please raise the matter with our team or our Grievance Officer (see <Link href="/grievance">Grievance Redressal</Link>) so that we can try to resolve it within 30 days.
          </p>
          <p>
            <strong>Arbitration (business customers).</strong> If a dispute between us and a business customer is not resolved through discussion within 30 days, either party may refer it to arbitration by a sole arbitrator appointed by mutual agreement under the Arbitration and Conciliation Act, 1996. The seat of arbitration will be {info.jurisdiction || "the city of our registered office"}, India, and the proceedings will be in English. This does not stop either party seeking urgent interim relief from a competent court.
          </p>
          <p>
            <strong>Consumers.</strong> If you use the Service as a consumer, nothing in this section limits your rights under the Consumer Protection Act, 2019, including the right to approach the appropriate Consumer Disputes Redressal Commission, or the mandatory consumer laws of the country where you live.
          </p>
        </>
      ),
    },
    {
      id: "general",
      title: "General",
      body: (
        <ul>
          <li><strong>Changes to these Terms.</strong> We may update these Terms. For material changes we will give at least 30 days&apos; notice by email to workspace owners or in the app before they take effect, unless a change is required sooner by law. The date at the top shows when they last changed. If you keep using the Service after a change takes effect, the new Terms apply; if you don&apos;t agree, you may cancel before then.</li>
          <li><strong>Notices.</strong> We send notices to the email address on your account or show them in the app. You can send notices to us using the contact details below.</li>
          <li><strong>Assignment.</strong> You may not transfer these Terms without our consent. We may transfer them as part of a merger, acquisition or sale of assets, with notice to you.</li>
          <li><strong>Force majeure.</strong> Neither of us is liable for delays or failures caused by events beyond reasonable control, such as natural disasters, war, epidemics, government action, or failures of utilities or networks not caused by us.</li>
          <li><strong>Severability and waiver.</strong> If any part of these Terms is found unenforceable, the rest stays in effect. Not enforcing a right is not a waiver of it.</li>
          <li><strong>Electronic record.</strong> These Terms are an electronic record under the Information Technology Act, 2000 and the rules made under it, and do not require a physical or digital signature.</li>
          <li><strong>Entire agreement.</strong> These Terms, with the policies they refer to, are the whole agreement between us about the Service.</li>
        </ul>
      ),
    },
    {
      id: "contact",
      title: "Contact and grievances",
      body: (
        <>
          <p>Questions about these Terms? <ContactUs info={info} />. Complaints can also be sent to our Grievance Officer, as set out on the <Link href="/grievance">Grievance Redressal</Link> page.</p>
          <CompanyBlock info={info} />
        </>
      ),
    },
  ];
  return (
    <LegalDoc
      path="/terms"
      title="Terms of Service"
      intro={<>The agreement between you and {operator} for using {P}. Please read it — it&apos;s written to be understood.</>}
      info={info}
      summary={[
        <>You must be 18 or over and use {P} for your business or profession.</>,
        <>{pr.trialDays ? `${pr.trialDays} days` : "A trial"} free, no card needed. After that, you pay invoices for your plan each month or year, with {pr.taxLabel} added.</>,
        <>Unpaid or ended subscriptions move the workspace to the Free plan (or make it read-only) — nothing is deleted, and you can always export your data.</>,
        <>You own your content. For your customers&apos; and employees&apos; personal data, you are the controller and we process it for you.</>,
        <>AI suggestions can be wrong — check them before you rely on them.</>,
        <>Indian law applies. Talk to us or our Grievance Officer first if something goes wrong.</>,
      ]}
      sections={sections}
    />
  );
}
