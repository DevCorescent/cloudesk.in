import { FileLock2, Fingerprint, KeyRound, Lock, ScrollText, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ContactUs, LegalDoc, legalMetadata, Mail, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/security", "Security", "How Cloudesk protects accounts and data: Argon2id passwords, AES-256-GCM encrypted secrets, two-step sign-in, SSO and SCIM, roles and audit logs, a web application firewall, PCI-DSS payment partners — and how to report a vulnerability.");

const HIGHLIGHTS = [
  { icon: Lock, title: "Encrypted in transit", body: "HTTPS everywhere, with HSTS so browsers never fall back to plain HTTP." },
  { icon: KeyRound, title: "Secrets encrypted at rest", body: "Payment keys, mailbox passwords and two-step secrets sealed with AES-256-GCM." },
  { icon: Fingerprint, title: "Strong sign-in", body: "Argon2id passwords, authenticator-app two-step, SSO (SAML/OIDC) and SCIM." },
  { icon: ScrollText, title: "Roles and audit log", body: "Eight built-in roles plus your own; important actions recorded with who and when." },
  { icon: ShieldCheck, title: "Application firewall", body: "Blocks SQL injection, XSS, path traversal and scanners; rate limits and auto-bans." },
  { icon: FileLock2, title: "No card data", body: "Payments go through Razorpay and Stripe. We never see your full card number." },
];

export default async function SecurityPage() {
  const info = await legalInfo();
  const { product: P } = info;
  const securityEmail = info.email;
  const sections: LegalSection[] = [
    {
      id: "accounts",
      title: "Accounts and sign-in",
      body: (
        <ul>
          <li><strong>Passwords</strong> are hashed with <strong>Argon2id</strong> (19 MiB memory, 2 iterations) — the algorithm recommended by OWASP. We never store or see your password, and new passwords must be at least 10 characters with a number or symbol.</li>
          <li><strong>Emailed sign-in and sign-up codes</strong> are six digits, stored only as a keyed hash (HMAC), valid for 10 minutes, usable once, and locked after 5 wrong tries.</li>
          <li><strong>Two-step sign-in</strong> with any authenticator app (TOTP). Workspace owners can require it for every member, and platform administrators can be required to use it too.</li>
          <li><strong>Single sign-on</strong> through your identity provider (SAML or OpenID Connect) and <strong>SCIM</strong> provisioning, so people are added and removed from your directory automatically. Sign in with GitHub is also available.</li>
          <li><strong>Sessions</strong> use long random tokens; only their SHA-256 hash is stored on our side. The cookie is HttpOnly, SameSite=Lax and Secure. You can see your active sessions and sign-in history and sign out other devices; a disabled account can&apos;t get a session by any route.</li>
          <li><strong>Brute-force protection:</strong> sign-in, code and password-reset endpoints are rate-limited per address and per account.</li>
        </ul>
      ),
    },
    {
      id: "access",
      title: "Access control inside a workspace",
      body: (
        <ul>
          <li>Eight built-in roles (owner, admin, billing, developer, designer, editor, viewer, employee) and <strong>custom roles</strong>, with access that can be limited to particular modules, companies and branches.</li>
          <li>Every workspace&apos;s data is kept separate: each request is checked against the workspace and your role on the server, not just hidden in the interface.</li>
          <li>An <strong>audit log</strong> records important changes, sign-ins, exports and permission changes with who did them and when. Owners choose how long it is kept (at least 12 months, or for the life of the workspace).</li>
          <li>Our support team can look inside a workspace only when an owner grants time-limited access (up to 72 hours) with a reason; each grant is recorded in the audit log.</li>
        </ul>
      ),
    },
    {
      id: "data",
      title: "Protecting your data",
      body: (
        <ul>
          <li><strong>In transit:</strong> HTTPS/TLS for the app, API, published sites and webhooks, with HTTP Strict Transport Security (two years, including subdomains).</li>
          <li><strong>At rest:</strong> credentials for payment providers and integrations, mailbox passwords and access tokens, and two-step sign-in secrets are encrypted with <strong>AES-256-GCM</strong> using a key held outside the database, and are never shown again after they are saved. Data is stored in a PostgreSQL database on our hosting provider&apos;s infrastructure, backed up on the schedule set for the platform.</li>
          <li><strong>Exports:</strong> any list can be exported as CSV or Excel, and an owner can export the whole workspace as a machine-readable file at any time.</li>
          <li><strong>Deletion:</strong> deleting a workspace is scheduled 30 days ahead (so a mistake can be undone), then everything in it is removed. Short-lived data such as sign-in codes and old request statistics is pruned automatically — see <Link href="/privacy#retention">retention</Link>.</li>
        </ul>
      ),
    },
    {
      id: "application",
      title: "Application and network security",
      body: (
        <ul>
          <li><strong>Web application firewall</strong> in front of the app and API, with managed rules for SQL injection, cross-site scripting, path traversal, probes for sensitive files, known attack scanners, protocol abuse and command injection; per-address rate limits; blocking by IP address, range or country; and automatic temporary bans for addresses that keep tripping the rules. It can run behind <strong>Cloudflare</strong>, and the origin can be locked so that only Cloudflare can reach it.</li>
          <li><strong>Cross-site request forgery protection:</strong> every state-changing request with a session cookie must come from our own origin, on top of SameSite cookies.</li>
          <li><strong>Security headers:</strong> a Content Security Policy that limits where scripts, frames and connections can come from, <code>X-Frame-Options: DENY</code> and <code>frame-ancestors &apos;none&apos;</code> against clickjacking, <code>X-Content-Type-Options: nosniff</code>, a strict Referrer-Policy, Permissions-Policy and Cross-Origin-Opener-Policy.</li>
          <li><strong>Input validation:</strong> every API request body is validated against a schema and size-limited before it is used.</li>
          <li><strong>Published sites</strong> run no third-party scripts of ours and send their own strict security headers. Emails shown in Mail are displayed in a sandbox.</li>
          <li><strong>Code you run</strong> in the AI IDE executes in locked-down, isolated containers when that feature is enabled.</li>
        </ul>
      ),
    },
    {
      id: "payments",
      title: "Payments",
      body: (
        <p>
          Subscription payments are taken by <strong>Razorpay</strong> and <strong>Stripe</strong>, which are PCI-DSS compliant payment providers. Card, UPI and bank details are entered with them directly, so {P} never receives full card numbers, CVVs, UPI PINs or banking passwords. Every payment is confirmed on our server with the provider — signatures checked with our secret, and the amount, currency and order matched — before an invoice is marked paid. Webhooks from providers are verified the same way.
        </p>
      ),
    },
    {
      id: "operations",
      title: "Operations, monitoring and incidents",
      body: (
        <>
          <ul>
            <li>Platform administrators work through a separate console that can require two-step sign-in and an IP allowlist, and their actions are audited.</li>
            <li>Sign-in activity, firewall blocks and request volumes are monitored so unusual activity can be spotted and acted on.</li>
            <li>If an incident affects your data, we will notify workspace owners without undue delay, and report to CERT-In (within 6 hours for reportable incidents) and to the Data Protection Board of India and other authorities as the law requires.</li>
          </ul>
          {info.statusPageUrl && <p>Service status is published at <a href={info.statusPageUrl}>{info.statusPageUrl}</a>.</p>}
        </>
      ),
    },
    {
      id: "compliance",
      title: "Privacy and compliance",
      body: (
        <>
          <p>
            Our privacy practices are designed to align with India&apos;s Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000 and its rules, the EU and UK GDPR and the CCPA/CPRA — see our <Link href="/privacy">Privacy Policy</Link>, <Link href="/dpa">Data Processing Addendum</Link> and <Link href="/subprocessors">Sub-processors</Link>.
          </p>
          <p>
            To be clear about what we don&apos;t claim: {P} does not currently hold ISO/IEC 27001 or SOC 2 certification, and PCI-DSS compliance applies to our payment providers, not to {P} itself (we don&apos;t handle card data). If your organisation needs a security questionnaire answered, <ContactUs info={info} lead="ask us at" />.
          </p>
        </>
      ),
    },
    {
      id: "disclosure",
      title: "Reporting a vulnerability",
      body: (
        <>
          <p>
            If you believe you have found a security vulnerability in {P}, please tell us privately{securityEmail ? <> at <Mail to={securityEmail} /></> : <> through our <Link href="/contact">contact page</Link></>} with &ldquo;Security&rdquo; in the subject. Include what you found, where, steps to reproduce it and the impact you expect. Our <a href="/.well-known/security.txt">security.txt</a> has the same details.
          </p>
          <h3>Please</h3>
          <ul>
            <li>Test only against accounts and workspaces you own or have permission to test.</li>
            <li>Don&apos;t access, change, keep or share other people&apos;s data — stop and report as soon as you see any.</li>
            <li>Don&apos;t run denial-of-service tests, spam, social engineering or physical attacks, and don&apos;t degrade the Service for others. Automated scanners trigger the firewall; please keep their volume low.</li>
            <li>Give us a reasonable time to fix the issue before you disclose it publicly — we aim to acknowledge reports within 3 business days and keep you updated until it&apos;s fixed.</li>
          </ul>
          <h3>Our commitment</h3>
          <p>
            If you act in good faith and follow these guidelines, we will not pursue legal action against you or ask authorities to, and we will treat your research as authorised under our <Link href="/acceptable-use#testing">Acceptable Use Policy</Link>. We&apos;re happy to credit you once the issue is fixed, if you want. We don&apos;t currently run a paid bug bounty.
          </p>
        </>
      ),
    },
  ];
  const before = (
    <div className="mt-6 grid gap-px overflow-hidden rounded-[22px] border border-fg/[0.07] bg-fg/[0.07] sm:grid-cols-2">
      {HIGHLIGHTS.map((h) => {
        const Icon = h.icon;
        return (
          <div key={h.title} className="bg-[var(--p-canvas,#fff)] p-5">
            <Icon className="size-5 text-[var(--p-mint-ink,#0f766e)]" />
            <p className="mt-2.5 text-[15px] font-semibold">{h.title}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-fg/60">{h.body}</p>
          </div>
        );
      })}
    </div>
  );
  return (
    <LegalDoc
      path="/security"
      title={`Security at ${P}`}
      intro={<>What {P} actually does to keep your accounts, your business data and your customers&apos; data safe — and how to tell us if you find a problem.</>}
      info={info}
      summary={[
        <>Every connection is encrypted; passwords are hashed with Argon2id and stored secrets with AES-256-GCM.</>,
        <>Two-step sign-in, SSO and SCIM, roles and an audit log are built in.</>,
        <>A web application firewall, rate limits and security headers protect the app and API.</>,
        <>Card details never reach us. We don&apos;t claim certifications we don&apos;t hold.</>,
      ]}
      before={before}
      sections={sections}
    />
  );
}
