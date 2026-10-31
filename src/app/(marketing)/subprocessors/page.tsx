import type { Metadata } from "next";
import Link from "next/link";
import { ContactUs, LegalDoc, legalMetadata, Table, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/subprocessors", "Sub-processors", "The outside services that may process personal data for Cloudesk — hosting, payments, email delivery, AI and network security — what each is used for, and when.");

export default async function SubprocessorsPage() {
  const info = await legalInfo();
  const { product: P } = info;
  const sections: LegalSection[] = [
    {
      id: "about",
      title: "About this list",
      body: (
        <>
          <p>
            A sub-processor is a company we use to provide {P} that may process personal data — including our customers&apos; data — on our behalf. Each one is bound by a written agreement with data-protection terms at least as protective as our <Link href="/dpa">Data Processing Addendum</Link>, and receives only the data it needs for its task.
          </p>
          <p>
            Several services are optional. A provider in the list below is used <strong>only if it is enabled</strong> for the Service; for example, if AI features are switched off, nothing is sent to an AI provider, and only one email delivery provider is used at a time. To find out which providers are enabled at the moment, <ContactUs info={info} lead="ask us at" />.
          </p>
        </>
      ),
    },
    {
      id: "list",
      title: "Current sub-processors",
      body: (
        <Table
          head={["Provider", "What for", "Data involved", "When used", "Location"]}
          rows={[
            [<strong key="h">Cloud hosting and managed database provider</strong>, "Running the application servers, the PostgreSQL database that stores all Service data, file storage and backups", "All Service data", "Always", "The region chosen for this Service — ask us for details"],
            [<strong key="r">Razorpay Software Pvt. Ltd.</strong>, "Taking subscription payments (UPI, cards, net banking, wallets)", "Name, email, invoice amount and reference; card and bank details are entered directly with Razorpay", "When Razorpay payments are enabled and you pay with it", "India"],
            [<strong key="s">Stripe, Inc. and affiliates</strong>, "Taking subscription payments by card", "Name, email, invoice amount and reference; card details are entered directly with Stripe", "When Stripe payments are enabled and you pay with it", "United States, Ireland and other countries"],
            [<strong key="m">Email delivery — one of Resend, Postmark (ActiveCampaign), Twilio SendGrid, or an SMTP relay</strong>, "Delivering service emails: sign-in codes, invitations, invoices, reminders and notifications", "Recipient email address, name, and the email content", "Whichever single provider is configured", "United States, or the relay's own location"],
            [<strong key="a">Anthropic, PBC</strong>, "AI features: the copilot, website builder assistant, reading bills and documents, drafting", "The instructions you give and the content needed for that task", "Only when AI features are enabled and you use one", "United States"],
            [<strong key="v">Voyage AI (part of MongoDB, Inc.)</strong>, "Semantic search for the website chatbot and search (text embeddings)", "Text of the content being indexed or searched", "Only when semantic search is enabled", "United States"],
            [<strong key="c">Cloudflare, Inc.</strong>, "Content delivery, DNS and network security in front of the Service, including blocking attacks", "Request data such as IP address, headers and the page requested", "When the Service is routed through Cloudflare", "Global network; United States"],
          ]}
        />
      ),
    },
    {
      id: "not-subprocessors",
      title: "Services you choose to connect",
      body: (
        <>
          <p>These services are used only when you or your workspace connect them, and they act for you under their own terms rather than as our sub-processors:</p>
          <ul>
            <li>Mailboxes you connect to Mail — Google (Gmail, Google Workspace), Microsoft (Outlook, Microsoft 365) or any IMAP/SMTP server.</li>
            <li>Sign in with GitHub, and your organisation&apos;s own identity provider for single sign-on and SCIM.</li>
            <li>Publishing a site to GitHub, Netlify, Vercel or Cloudflare Pages.</li>
            <li>Payment accounts (Razorpay, Stripe, PayPal) that a business connects to take payments in its own store.</li>
            <li>An AI provider account whose API key a workspace adds for its own use.</li>
          </ul>
        </>
      ),
    },
    {
      id: "not-used",
      title: "Not currently used",
      body: <p>OpenAI is listed in the app as a possible future AI provider, but it is not implemented and no data is sent to it. We use no advertising, analytics or data-broker services.</p>,
    },
    {
      id: "changes",
      title: "Changes and notifications",
      body: (
        <p>
          We update this page before a new sub-processor starts processing personal data. Customers who want advance notice by email can <ContactUs info={info} lead="ask us at" /> to be added to the notification list; under the <Link href="/dpa#subprocessors">DPA</Link> you then get at least 15 days to object.
        </p>
      ),
    },
  ];
  return (
    <LegalDoc
      path="/subprocessors"
      title="Sub-processors"
      intro={<>The companies that help us run {P} and may process personal data while doing so.</>}
      info={info}
      summary={[
        <>Hosting and database, payments (Razorpay, Stripe), email delivery, AI (Anthropic) and network security (Cloudflare).</>,
        <>Optional providers are used only if enabled — no AI provider sees anything unless AI features are on.</>,
        <>No advertising, analytics or data brokers.</>,
      ]}
      sections={sections}
    />
  );
}
