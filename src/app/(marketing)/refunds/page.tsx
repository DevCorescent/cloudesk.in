import type { Metadata } from "next";
import Link from "next/link";
import { ContactUs, LegalDoc, legalMetadata, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/refunds", "Refund & Cancellation Policy", "Cloudesk's free trial, how to cancel, what happens when you change plan, and when payments are refunded — including duplicate and failed payments.");

export default async function RefundsPage() {
  const info = await legalInfo();
  const { product: P, pricing: pr } = info;
  const sections: LegalSection[] = [
    {
      id: "trial",
      title: "Free trial",
      body: (
        <p>
          Every new workspace starts with a free trial{pr.trialDays ? <> of {pr.trialDays} days</> : null}. You are not charged during the trial and no card is needed to start it. If you choose a plan during the trial, its first invoice is due when the trial ends; you can pay early without losing any trial days. If you don&apos;t choose a plan, nothing is charged — the workspace simply becomes read-only when the trial ends, and you can still export everything.
        </p>
      ),
    },
    {
      id: "cancel",
      title: "Cancelling",
      body: (
        <>
          <p>
            Workspace owners and billing members can cancel at any time in <strong>Settings → Billing</strong>. Cancellation takes effect <strong>at the end of the period you have already paid for</strong>: you keep full access until then, and no further renewal invoices are raised. You can resume the subscription at any time before it ends.
          </p>
          <p>After the subscription ends the workspace becomes read-only. Your data is not deleted because you cancelled; you can view and export it, or delete the workspace from Settings when you are ready.</p>
        </>
      ),
    },
    {
      id: "no-partial",
      title: "Partial periods and downgrades",
      body: (
        <>
          <p>
            Subscription fees are paid in advance for a month or a year. We don&apos;t give refunds or credits for the unused part of a period when you cancel, downgrade, remove features or seats, or stop using the Service, <strong>except</strong>:
          </p>
          <ul>
            <li>where the law requires a refund (nothing in this policy limits your rights under the Consumer Protection Act, 2019 or other applicable consumer law);</li>
            <li>where we end your subscription without you being at fault, or stop offering the Service — we refund the unused prepaid time pro rata;</li>
            <li>where we remove a feature you paid for in a way that materially reduces the Service, and you cancel because of it — we refund the unused prepaid time pro rata.</li>
          </ul>
          <p>A downgrade takes effect at the end of the current period, so you keep what you paid for until then.</p>
        </>
      ),
    },
    {
      id: "upgrades",
      title: "Upgrades and account credit",
      body: (
        <p>
          When you upgrade during a paid period, you are credited for the unused time on your current plan, worked out precisely, and that credit is subtracted from the upgrade invoice. If the credit is more than the new charge, the balance stays on your account and is used automatically against future invoices. Account credit is not paid out in cash, except where the law requires it or when we refund unused prepaid time as described above.
        </p>
      ),
    },
    {
      id: "payment-errors",
      title: "Duplicate, failed and mistaken payments",
      body: (
        <>
          <ul>
            <li><strong>Paid twice:</strong> if the same invoice is paid more than once, we refund the extra payment in full.</li>
            <li><strong>Money debited but payment failed:</strong> under the Reserve Bank of India&apos;s turnaround-time rules, failed UPI and card transactions are normally reversed automatically by your bank or the payment partner within a few business days. If it hasn&apos;t been reversed, or the money reached us but the invoice still shows as unpaid, contact us and we will either mark the invoice as paid or refund the amount.</li>
            <li><strong>Charged in error:</strong> if we charged an amount that wasn&apos;t due (for example a wrong tax calculation on our side), we refund the difference.</li>
          </ul>
          <p>
            Refunds are made <strong>to the original payment method</strong>. We start the refund within <strong>7 business days</strong> of confirming it is due; it then usually reaches you within 5–10 business days, depending on your bank, card issuer or UPI app. Where the refunded invoice included {pr.taxLabel}, we issue a credit note for the tax.
          </p>
        </>
      ),
    },
    {
      id: "request",
      title: "How to ask for a refund",
      body: (
        <>
          <p>
            To ask for a refund, <ContactUs info={info} />. Include your workspace name, the invoice number, the payment date and amount, and the payment reference from Razorpay or Stripe (shown on your receipt or bank statement). Please raise it within 30 days of the payment where you can — it makes tracing it with the payment partner quicker. We acknowledge requests within 2 business days and tell you the outcome.
          </p>
          <p>
            If you&apos;re not satisfied with our answer, you can escalate to our Grievance Officer (see <Link href="/grievance">Grievance Redressal</Link>). Please contact us before raising a chargeback with your bank, so that we can fix the problem quickly.
          </p>
        </>
      ),
    },
    {
      id: "stores",
      title: `Purchases from businesses that use ${P}`,
      body: (
        <p>
          If you bought something from a store, restaurant, clinic or other business that uses {P}, that business is the seller, sets its own refund and cancellation policy and processes refunds through its own payment account. Please contact the business directly; we can&apos;t issue refunds for their sales.
        </p>
      ),
    },
  ];
  return (
    <LegalDoc
      path="/refunds"
      title="Refund & Cancellation Policy"
      intro={<>How the free trial works, how to cancel your {P} subscription, and when we refund payments.</>}
      info={info}
      summary={[
        <>The trial is free and needs no card. Nothing is charged unless you choose and pay for a plan.</>,
        <>Cancel any time in Settings → Billing; you keep access until the end of the period you paid for.</>,
        <>No refunds for partly used periods or downgrades, except where the law requires or we end the service.</>,
        <>Upgrades are credited for your unused time. Duplicate or mistaken payments are refunded to the original method.</>,
      ]}
      sections={sections}
    />
  );
}
