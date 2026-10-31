import type { Metadata } from "next";
import Link from "next/link";
import { CompanyBlock, ContactUs, LegalDoc, legalMetadata, Mail, Table, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/privacy", "Privacy Policy", "What personal data Cloudesk collects, why, how long it's kept, who it's shared with, and your rights under India's DPDP Act 2023, the IT Act, the GDPR, UK GDPR and the CCPA/CPRA.");

export default async function PrivacyPage() {
  const info = await legalInfo();
  const { product: P, operator } = info;
  const privacyEmail = info.dpo.email || info.email;
  const sections: LegalSection[] = [
    {
      id: "who",
      title: "Who we are and what this covers",
      body: (
        <>
          <p>
            {P} is operated by {info.company ? <strong>{info.company}</strong> : operator} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains how we handle personal data about people who visit this website, sign up, use the app, or contact us. For that data we are the <strong>data fiduciary</strong> under India&apos;s Digital Personal Data Protection Act, 2023 (&ldquo;DPDP Act&rdquo;) and the <strong>controller</strong> under the EU and UK General Data Protection Regulation (&ldquo;GDPR&rdquo;).
          </p>
          <p>
            <strong>Data our customers put into {P} is different.</strong> When a business uses {P} to run its store, invoices, CRM, HR and payroll, clinic, school or other operations, the personal data of its customers, employees, patients, students and contacts belongs to that business. The business is the data fiduciary / controller and decides why and how that data is used; we only process it on its instructions, under our <Link href="/dpa">Data Processing Addendum</Link>. If you are a customer, employee, patient or student of a business that uses {P}, please contact that business about your data — we will pass on requests we receive to it.
          </p>
        </>
      ),
    },
    {
      id: "collect",
      title: "Personal data we collect and why",
      body: (
        <>
          <Table
            head={["What", "Examples", "Why we use it"]}
            rows={[
              [<strong key="a">Account details</strong>, "Name, email address, password (stored only as a one-way hash), two-step sign-in settings, sign-in method (password, emailed code, GitHub or your company's single sign-on)", "To create and secure your account and let you sign in"],
              [<strong key="w">Workspace and business details</strong>, "Business name, industry, the features you choose, your role, invitations you send or accept", "To set up and run your workspace and show you the right features"],
              [<strong key="b">Billing details</strong>, "Plan, invoices, amounts, GST details you give us, payment status and the payment reference from Razorpay or Stripe", "To bill you, keep tax records and prevent fraud. We never receive your full card number, CVV, UPI PIN or bank password"],
              [<strong key="s">Security and usage records</strong>, "IP address, browser and device type, sign-in times and outcomes, active sessions, actions recorded in the workspace audit log, requests blocked by our firewall", "To keep accounts and the Service secure, investigate misuse, and show you and your workspace owners who did what"],
              [<strong key="c">Communications</strong>, "Messages you send us, feature requests and their conversations, the service emails we send you and whether they were delivered", "To answer you, improve the Service and keep a record of what we told you"],
              [<strong key="i">Connected services</strong>, "Mailbox connection details or sign-in tokens (encrypted), API keys you add for payments, publishing or AI", "To connect the services you ask us to connect"],
              [<strong key="ai">AI requests</strong>, "Instructions you give the copilot or builder assistant, and their results", "To run the AI feature you asked for, show you its history and keep usage within budget"],
            ]}
          />
          <p>
            We collect this data from you, from the members of your workspace (for example when someone invites you), from the services you connect (for example GitHub or your identity provider when you sign in with them), and from our payment partners (payment confirmations).
          </p>
          <p>
            <strong>Visiting this website.</strong> The marketing pages don&apos;t use analytics, advertising or social-media trackers. Our servers record basic request data (such as IP address, the page requested and the time) to deliver pages and protect the Service; see the <Link href="/cookies">Cookie Policy</Link>.
          </p>
          <p>We do not use your personal data for advertising, we do not sell it, and we do not make decisions about you based solely on automated processing that have legal or similarly significant effects. Our security systems may automatically block an IP address for a limited time if it shows attack patterns.</p>
        </>
      ),
    },
    {
      id: "bases",
      title: "Consent and legal grounds",
      body: (
        <>
          <h3>India (DPDP Act)</h3>
          <p>
            We process your personal data on the basis of your <strong>consent</strong>, given when you sign up and accept this notice, or for a <strong>legitimate use</strong> permitted by Section 7 of the DPDP Act — for example where you have voluntarily provided data for a specified purpose such as getting an invoice, or to comply with law or a court order. You can <strong>withdraw consent</strong> at any time, as easily as you gave it — <ContactUs info={info} email={privacyEmail} />, or close your account. Withdrawal does not affect processing already done, and we may then be unable to provide the Service to you.
          </p>
          <h3>EU, EEA and UK (GDPR)</h3>
          <ul>
            <li><strong>Contract</strong> (Art. 6(1)(b)): to provide the Service you signed up for, including your account, workspace and billing.</li>
            <li><strong>Legal obligation</strong> (Art. 6(1)(c)): tax invoices and records, responding to lawful requests, reporting incidents.</li>
            <li><strong>Legitimate interests</strong> (Art. 6(1)(f)): securing the Service, preventing fraud and abuse, keeping audit records, and improving the product using aggregated information. You can object to this processing (see your rights below).</li>
            <li><strong>Consent</strong> (Art. 6(1)(a)): where we ask for it, for example optional marketing emails. You can withdraw it at any time.</li>
          </ul>
        </>
      ),
    },
    {
      id: "sharing",
      title: "Who we share it with",
      body: (
        <>
          <p>We share personal data only as needed to run the Service, and never sell it:</p>
          <ul>
            <li><strong>Service providers (sub-processors)</strong> that host, deliver email, take payments or run AI features for us, under contracts that require them to protect the data and use it only for us. The list, and when each is used, is on our <Link href="/subprocessors">Sub-processors</Link> page.</li>
            <li><strong>Your workspace.</strong> Owners and admins of a workspace you belong to can see your name, email, role and activity in that workspace, including its audit log.</li>
            <li><strong>Services you connect.</strong> When you connect a mailbox, a payment account, a publishing service or your identity provider, data flows to and from it as you instruct.</li>
            <li><strong>Authorities and legal process</strong>, where required by law — for example a valid order under Indian law, or directions from CERT-In — or to protect people&apos;s safety, our rights, or the Service.</li>
            <li><strong>A buyer or successor</strong> if our business is merged, acquired or sold, in which case this policy continues to apply to your data.</li>
          </ul>
        </>
      ),
    },
    {
      id: "transfers",
      title: "Where data is stored and international transfers",
      body: (
        <>
          <p>
            The Service&apos;s data is stored in a PostgreSQL database and file storage operated for us by our hosting provider in the region we choose for the Service. Some sub-processors (for example email delivery, payments or AI providers) may process data in other countries, including the United States.
          </p>
          <p>
            Where Indian law restricts transfers to particular countries, we follow those restrictions. When personal data from the EEA, UK or Switzerland is transferred to a country that doesn&apos;t have an adequacy decision (India currently doesn&apos;t), we use the European Commission&apos;s <strong>Standard Contractual Clauses</strong> (with the UK Addendum where relevant) or another lawful mechanism, together with additional safeguards such as encryption. You can ask us for a copy of the relevant safeguards.
          </p>
        </>
      ),
    },
    {
      id: "retention",
      title: "How long we keep data",
      body: (
        <>
          <p>We keep personal data only as long as needed for the purposes above or as the law requires. Specific periods built into the Service:</p>
          <Table
            head={["Data", "How long"]}
            rows={[
              ["Sign-up and sign-in codes sent by email", "Valid for 10 minutes; deleted after 1 day"],
              ["Sign-in sessions", "Expire after 30 days, or when you sign out or an owner removes you"],
              ["Sign-in history (time, IP address, device, success or failure)", "1 year"],
              ["Aggregate request statistics", "14 days"],
              ["API call logs for a workspace's integrations", "30 days; webhook delivery records 90 days"],
              ["In-app notifications", "1 year by default; a workspace owner can choose between 30 days and 10 years"],
              ["Workspace audit log", "For the life of the workspace, unless an owner sets a shorter period (at least 12 months)"],
              ["Whole-workspace export files", "Available to download for 7 days, then removed"],
              ["A workspace an owner deletes", "Deleted 30 days after the request (it can be cancelled until then); backup copies expire on our backup schedule"],
              ["Invoices and billing records", "For as long as Indian tax and accounting law requires (for GST records, generally 72 months from the due date of the annual return for the year)"],
              ["Your account and workspace data", "While your account is active. After you ask us to close your account, we delete or anonymise it within 90 days, except what we must keep by law or to resolve disputes"],
            ]}
          />
          <p>If you have a question about a specific record, <ContactUs info={info} email={privacyEmail} />.</p>
        </>
      ),
    },
    {
      id: "security",
      title: "How we protect data",
      body: (
        <>
          <p>We use reasonable security practices and procedures appropriate to the nature of the data, including:</p>
          <ul>
            <li>Encrypted connections (HTTPS with HSTS) for the app and API.</li>
            <li>Passwords stored only as <strong>Argon2id</strong> hashes — we can&apos;t see your password.</li>
            <li>Payment-provider keys, mailbox passwords and tokens, and two-step sign-in secrets encrypted with <strong>AES-256-GCM</strong> before they&apos;re stored.</li>
            <li>Session tokens stored only as SHA-256 hashes, in secure, HttpOnly cookies.</li>
            <li>Two-step sign-in with authenticator apps, single sign-on and SCIM for organisations, role-based access and audit logs.</li>
            <li>A web application firewall, rate limits and security headers.</li>
          </ul>
          <p>More detail is on our <Link href="/security">Security</Link> page. No system is perfectly secure, so please also protect your password and turn on two-step sign-in.</p>
          <h3>Sensitive personal data (India)</h3>
          <p>
            Under the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, passwords and financial information such as card or bank details are sensitive personal data. We hold your password only as a hash, and we never receive your card, UPI or net-banking credentials — those are handled by our payment partners, which are required to comply with PCI-DSS. Bank account details that a business enters into {P} (for example for payroll) are Customer Content handled under the <Link href="/dpa">DPA</Link>.
          </p>
        </>
      ),
    },
    {
      id: "breaches",
      title: "If there is a data breach",
      body: (
        <p>
          We have procedures to detect, contain and investigate security incidents. If a personal data breach affects you, we will tell you and notify the Data Protection Board of India as required by the DPDP Act and its rules, and report cyber-security incidents to CERT-In within the time required by its directions (currently 6 hours of noticing certain incidents). Where the GDPR applies, we notify the competent supervisory authority within 72 hours where required. If a breach affects Customer Content, we notify the affected workspace&apos;s owners without undue delay so they can meet their own obligations.
        </p>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <>
          <h3>Everyone</h3>
          <p>
            Much of your data can be seen and changed in the app (your profile, security settings, active sessions, and — for workspace owners — exports and deletion). For anything else, <ContactUs info={info} email={privacyEmail} />. We may need to confirm your identity first. We respond within the time the applicable law requires and, in any case, within 30 days.
          </p>
          <h3>India — DPDP Act, 2023</h3>
          <ul>
            <li><strong>Access:</strong> a summary of the personal data we process about you and the processing activities, and the identities of others we have shared it with.</li>
            <li><strong>Correction, completion, updating and erasure</strong> of your personal data, unless we must keep it for a specified purpose or by law.</li>
            <li><strong>Withdraw consent</strong> at any time.</li>
            <li><strong>Grievance redressal:</strong> complain to our Grievance Officer (see <Link href="/grievance">Grievance Redressal</Link>), who responds within the period set by law.</li>
            <li><strong>Nominate</strong> another person to exercise your rights in the event of your death or incapacity.</li>
            <li>If you are not satisfied with our response, you may complain to the <strong>Data Protection Board of India</strong>.</li>
          </ul>
          <h3>EU, EEA and UK — GDPR and UK GDPR</h3>
          <p>
            You have the right to access, rectify and erase your data; restrict or object to processing (including processing based on legitimate interests); <strong>data portability</strong> (receive your data in a structured, machine-readable format); and withdraw consent. You may complain to your local data protection supervisory authority (in the UK, the Information Commissioner&apos;s Office).
          </p>
          <h3>California — CCPA as amended by the CPRA</h3>
          <p>
            In the last 12 months we have collected these categories of personal information for the business purposes described above: identifiers (name, email, IP address); commercial information (plan and invoices); internet or network activity (sign-in and usage records); professional information (business name and role); approximate location derived from IP address (for security); and account log-in credentials (sensitive personal information, used only to authenticate you). Sources and recipients are described in this policy.
          </p>
          <p>
            <strong>We do not sell or share your personal information</strong> (including for cross-context behavioural advertising), and we have not done so in the last 12 months. We do not use sensitive personal information except for purposes permitted by the CPRA. You have the right to know, access, correct and delete personal information, and not to be discriminated against for exercising your rights. You may use an authorised agent. Because we don&apos;t sell or share personal information, there is nothing to opt out of; we treat a Global Privacy Control signal as a valid opt-out request regardless.
          </p>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          {P} is a service for businesses and is not directed at anyone under 18. We do not knowingly collect personal data from children and we do not collect the verifiable parental consent the DPDP Act requires for processing children&apos;s data, so children may not create accounts. If you believe a child has given us personal data, please <ContactUs info={info} email={privacyEmail} /> — we will delete it. Schools and other businesses that hold children&apos;s data in {P} (for example in the Education module) are the data fiduciaries for that data and are responsible for obtaining parental consent.
        </p>
      ),
    },
    {
      id: "emails",
      title: "Emails we send",
      body: (
        <p>
          We send emails you need to use the Service: sign-in codes, invitations, invoices, trial and renewal reminders, security alerts and important notices about the Service or these policies. These are part of the Service and can&apos;t be switched off while you have an account. We send marketing emails only with your consent, and each includes a way to unsubscribe.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: <p>We may update this policy. The date at the top shows the latest version. If a change materially affects how we use your personal data, we will tell you by email or in the app before it takes effect and, where the law requires, ask for your consent again.</p>,
    },
    {
      id: "contact",
      title: "Contact, privacy officer and representatives",
      body: (
        <>
          <p>For privacy questions or to exercise your rights, <ContactUs info={info} email={privacyEmail} />.</p>
          {(info.dpo.name || info.dpo.email) && (
            <p>
              <strong>Data protection contact:</strong> {info.dpo.name}
              {info.dpo.name && info.dpo.email ? ", " : null}
              {info.dpo.email ? <Mail to={info.dpo.email} /> : null}
            </p>
          )}
          <p>
            <strong>Grievance Officer:</strong>{" "}
            {info.grievance.name || info.grievance.email ? (
              <>
                {info.grievance.name}
                {info.grievance.name && info.grievance.email ? ", " : null}
                {info.grievance.email ? <Mail to={info.grievance.email} /> : null}. Details and timelines are on the <Link href="/grievance">Grievance Redressal</Link> page.
              </>
            ) : (
              <>see the <Link href="/grievance">Grievance Redressal</Link> page.</>
            )}
          </p>
          {info.euRepresentative && (
            <p>
              <strong>EU/UK representative (GDPR Art. 27):</strong> <span className="whitespace-pre-line">{info.euRepresentative}</span>
            </p>
          )}
          <CompanyBlock info={info} />
        </>
      ),
    },
  ];
  return (
    <LegalDoc
      path="/privacy"
      title="Privacy Policy"
      intro={<>How {operator} collects, uses and protects personal data when you use {P}, and the rights you have.</>}
      info={info}
      summary={[
        <>We collect what we need to run your account and workspace: your name, email, sign-in and billing details, and security records.</>,
        <>We don&apos;t sell your data, don&apos;t use it for advertising, and the website has no tracking cookies.</>,
        <>Your business&apos;s customers, employees, patients and students are your data — we only process it for you.</>,
        <>Passwords are hashed with Argon2id, secrets encrypted with AES-256-GCM, and card details never reach us.</>,
        <>You can access, correct, export or delete your data, withdraw consent, and complain to our Grievance Officer or the Data Protection Board of India.</>,
      ]}
      sections={sections}
    />
  );
}
