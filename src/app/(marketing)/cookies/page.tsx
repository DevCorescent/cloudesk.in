import type { Metadata } from "next";
import Link from "next/link";
import { ContactUs, LegalDoc, legalMetadata, Table, type LegalSection } from "@/components/legal/doc";
import { legalInfo } from "@/server/legal/info";

export const metadata: Metadata = legalMetadata("/cookies", "Cookie Policy", "Cloudesk uses only strictly necessary cookies and browser storage — no analytics, advertising or social-media trackers. Here is every cookie, what it's for and how long it lasts.");

const code = (s: string) => <code>{s}</code>;

export default async function CookiesPage() {
  const info = await legalInfo();
  const { product: P } = info;
  const sections: LegalSection[] = [
    {
      id: "summary",
      title: "Our approach",
      body: (
        <>
          <p>
            Cookies are small files a website asks your browser to keep; similar technologies such as local storage work in much the same way. {P} uses them <strong>only where they are strictly necessary</strong> to provide the service you ask for — keeping you signed in, protecting sign-in, remembering your cart on a store — and to remember choices you make, such as light or dark mode.
          </p>
          <p>
            We do <strong>not</strong> use analytics, advertising, profiling or social-media cookies, and the marketing website loads no third-party trackers. Images on these pages are served from our own servers, and we use your device&apos;s own fonts. Because every cookie we set is strictly necessary, the law (including the EU ePrivacy rules and the GDPR, the UK PECR, and India&apos;s DPDP Act) doesn&apos;t require a consent banner, so we don&apos;t show one. If we ever add a cookie that isn&apos;t strictly necessary, we will ask for your consent first and update this page.
          </p>
        </>
      ),
    },
    {
      id: "app",
      title: "Cookies on this website and in the app",
      body: (
        <Table
          head={["Name", "Purpose", "Lasts"]}
          rows={[
            [code("cc_session"), "Keeps you signed in. Holds a random token; the server stores only its hash. HttpOnly, SameSite=Lax, Secure on HTTPS.", "30 days, or until you sign out"],
            [code("cc_org"), "Remembers which workspace you had open, so you return to it.", "1 year"],
            [code("cc_mfa"), "Carries a sign-in that is waiting for your two-step code.", "5 minutes"],
            [code("cc_oauth"), "Protects “Sign in with GitHub” against forged requests.", "10 minutes"],
            [code("cc_sso"), "Protects single sign-on through your company's identity provider.", "Minutes, during sign-in"],
            [code("cc_mail_oauth"), "Protects connecting a Gmail or Microsoft mailbox.", "10 minutes"],
          ]}
        />
      ),
    },
    {
      id: "sites",
      title: `Cookies on sites and stores built with ${P}`,
      body: (
        <>
          <p>Websites, stores, catalogues and portals that our customers publish with {P} can set these strictly necessary cookies for their visitors:</p>
          <Table
            head={["Name", "Purpose", "Lasts"]}
            rows={[
              [code("cc_cart_…"), "Remembers the shopping cart on a store.", "30 days"],
              [code("cc_cat_…"), "Remembers that you entered the access code for a private catalogue.", "30 days"],
              [code("cd_portal_…"), "Keeps a customer or supplier signed in to a business's portal.", "30 days, or until signing out"],
            ]}
          />
          <p>
            Published sites run no third-party scripts of ours. The business that owns a site is responsible for its own cookie and privacy notices, and for anything it adds to its site; a site may also remember, in your browser&apos;s local storage, that you have already seen or dismissed one of its pop-ups.
          </p>
        </>
      ),
    },
    {
      id: "storage",
      title: "Local and session storage",
      body: (
        <>
          <p>The app keeps some things in your browser&apos;s own storage, on your device only, so it works the way you left it. Nothing here is used to track you:</p>
          <ul>
            <li>Your light/dark theme choice ({code("cc-theme")}).</li>
            <li>Unsent mail and chat drafts, recent searches, which sidebar groups and calendars you collapsed or hid.</li>
            <li>Point-of-sale carts and held orders, and changes waiting to be sent when you are offline.</li>
            <li>Sound and label-printing preferences, the builder&apos;s clipboard, and which reminders you dismissed today.</li>
            <li>While you sign up, your answers so far are kept in session storage (never your password) and cleared when you finish or close the tab.</li>
          </ul>
          <p>You can clear these at any time from your browser settings; the app will simply forget those preferences.</p>
        </>
      ),
    },
    {
      id: "third-parties",
      title: "Payment and sign-in partners",
      body: (
        <p>
          When you choose to pay an invoice, Razorpay&apos;s checkout opens over the page (or you are taken to Stripe&apos;s checkout). When you connect a mailbox or sign in with GitHub, Google or Microsoft, you go to their pages. These partners may set their own cookies, which are needed to complete the payment or sign-in securely and are covered by their own cookie and privacy policies. Nothing from them loads on our marketing pages.
        </p>
      ),
    },
    {
      id: "control",
      title: "Controlling cookies",
      body: (
        <p>
          Most browsers let you see, block and delete cookies. Because ours are strictly necessary, blocking them will stop sign-in, carts and checkout from working. Deleting {code("cc_session")} signs you out. For more about how we handle personal data, see the <Link href="/privacy">Privacy Policy</Link>. Questions? <ContactUs info={info} />.
        </p>
      ),
    },
  ];
  return (
    <LegalDoc
      path="/cookies"
      title="Cookie Policy"
      intro={<>Every cookie {P} uses, what it does and how long it lasts. It&apos;s a short list.</>}
      info={info}
      summary={[
        <>Only strictly necessary cookies: signing in, protecting sign-in, store carts and portals.</>,
        <>No analytics, advertising or social-media trackers — so there&apos;s no consent banner to click through.</>,
        <>Preferences like dark mode and drafts stay in your own browser.</>,
      ]}
      sections={sections}
    />
  );
}
