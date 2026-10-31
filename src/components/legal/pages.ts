// The public legal and trust pages, in the order they're listed (footer,
// /legal, the sitemap and each policy's "Related" links).
export type LegalPage = { href: string; title: string; short: string; line: string };

export const LEGAL_PAGES: LegalPage[] = [
  { href: "/terms", title: "Terms of Service", short: "Terms", line: "The agreement for using the service: accounts, subscriptions, your content, liability and the law that applies." },
  { href: "/privacy", title: "Privacy Policy", short: "Privacy", line: "What personal data we collect, why, how long we keep it, who we share it with and your rights (DPDP Act, GDPR, CCPA)." },
  { href: "/cookies", title: "Cookie Policy", short: "Cookies", line: "The few cookies and browser storage we use — all of them needed for the service to work." },
  { href: "/refunds", title: "Refund & Cancellation Policy", short: "Refunds & cancellation", line: "The free trial, cancelling, plan changes, and when money is refunded." },
  { href: "/partner-terms", title: "Partner Terms", short: "Partner terms", line: "The partner program: which customers are yours, commission, holds, payouts and tax, and promotion rules." },
  { href: "/acceptable-use", title: "Acceptable Use Policy", short: "Acceptable use", line: "What you may not use the service for, and what happens if someone does." },
  { href: "/dpa", title: "Data Processing Addendum", short: "Data processing (DPA)", line: "Our commitments when we process personal data on your behalf (GDPR Article 28, DPDP Act)." },
  { href: "/subprocessors", title: "Sub-processors", short: "Sub-processors", line: "The outside services that may process data for us, what for, and when each is used." },
  { href: "/grievance", title: "Grievance Redressal", short: "Grievance officer", line: "How to raise a complaint, our Grievance Officer, and how fast we respond." },
  { href: "/security", title: "Security", short: "Security", line: "How the service protects accounts and data, and how to report a vulnerability." },
];

export const legalPage = (href: string) => LEGAL_PAGES.find((p) => p.href === href)!;
