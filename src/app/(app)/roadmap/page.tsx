import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Roadmap" };

const AVAILABLE = [
  "Accounts, organizations, invitations and seven roles enforced on the server",
  "Plain-language project planning (AI model or built-in rules) with a reviewable spec",
  "Visual website builder with responsive preview, undo/redo, autosave and version history",
  "AI IDE: file explorer, Monaco editor, diagnostics, AI-proposed diffs you accept or reject",
  "Deployments to platform hosting with validation, link checks, previews and rollback",
  "Contact and booking forms that store submissions",
  "AI provider connection (Anthropic) with encrypted keys, usage and monthly budget",
  "Audit log",
  "Media library with uploads and cropping; brand import from a website or logo",
  "Design review with one-click fixes, section variations, per-device overrides",
  "Blog, products with payment links, maps and multilingual sites",
  "Anonymous site analytics and A/B tests on section layouts",
  "Online store: products with variants, collections, inventory, cart, checkout, orders, refunds, invoices with GST split, discounts, shipping zones, taxes, reviews and a sales dashboard",
  "Store payments: Razorpay, Stripe and PayPal hosted checkout with signed webhooks, plus cash on delivery and UPI/bank transfer",
  "Nine store templates for different kinds of business, with sample catalogs",
  "Gift cards, customer return requests, \u201cMy orders\u201d email links, low-stock alerts, bulk order tools, packing slips and order CSV export",
  "Shiprocket courier booking with labels, pickup and tracking sync (India)",
  "Sitemaps, robots.txt and a Google Merchant product feed for published sites",
  "Email delivery through Resend when the platform is configured for it",
  "Growth autopilot: A/B tests and quick wins from your traffic and sales, with winners applied automatically if you choose",
  "Brand guardrails: locked colours, fonts and logo, plus a voice and banned words for AI writing",
  "Custom domains with DNS verification (TLS certificates come from the edge proxy)",
  "Bookings and appointments with online payment, reminders and calendar files",
  "WhatsApp click-to-chat, order updates and cart reminders",
  "GST-ready invoices and monthly GST summaries for Indian stores",
  "AI translation that changes only text (layout, links and prices stay put)",
  "Business kit: store, bookings and a launch marketing kit from your plan",
  "Clone the feel of a website you like (style only)",
  "Digital downloads, memberships and members-only pages",
  "Section motion: entrances, staggered reveals, hover effects and parallax (CSS only, respects reduced motion)",
  "Collaboration: see who is editing, near-real-time sync of saved edits, comments with @mentions, client review links with approval",
  "Version branches: try a redesign on a copy, preview it, then merge with a per-change conflict review",
  "Free-form sections: place text, images, buttons and shapes anywhere on a grid, with a separate phone layout",
  "26 industry templates with a choice of 11 design directions, including a frosted Glass look",
  "Terminal in the IDE: ls, cat, grep, validate and JavaScript scripts in a WebAssembly sandbox (time, memory and output limits, no network); script writes are saved as file revisions",
  "Data tables with typed fields, links between tables, filters, CSV import/export, a generated REST API with OpenAPI, an API console, and a “Data list” section for published sites",
  "EasyPost and Shippo shipping labels with live rates, customs for international parcels and tracking webhooks",
  "Multi-currency storefronts with rounding rules, and product subscriptions through Stripe or Razorpay",
  "Live payment test: checks your keys and webhook setup with the provider, takes a small test payment and passes only when a signed webhook arrives",
  "Site chatbot that answers from your pages, products and policies (AI answers with citations, or matching passages without AI), with hand-over to your team",
  "Workflow automation: triggers from forms, orders, bookings, schedules and webhooks; email, HTTP, Slack, delays and conditions, run as retried jobs",
  "Integrations: Slack, Discord, Telegram, Mailchimp, outgoing webhooks, API keys, a public API, an app manifest and a JavaScript SDK",
  "Plans and billing through Stripe or Razorpay, with limits enforced on projects, members, domains and automations",
  "Email through Resend, Postmark, SendGrid or SMTP, with retries",
  "Two-step sign-in (authenticator apps and recovery codes), GitHub sign-in, and organisations that require two-step sign-in",
  "Live co-editing of files in the IDE with everyone’s cursors",
  "Free-form multi-select, groups, locking, align and distribute; global components shared across pages",
  "Builder: click any text to style it (colour, size, weight, font, spacing, alignment, shadow, hide per device) and double-click to edit it in place",
  "Advanced section design: colour, gradient, image or video backgrounds with overlays; custom colours and fonts; exact spacing with phone values; width and height; card styles; borders; shape dividers; anchors; scoped custom CSS",
  "New sections: video, embeds (Calendly, Typeform, Spotify, Loom, Figma, Google, Tally, Airtable, CodePen), tabs, timeline, comparison table, scrolling text, social links, spacer, and a custom form builder that saves to the inbox, a data table and automations",
  "Site-wide interface settings: sticky, glass or transparent header, content width, base text size, section spacing, heading weight and spacing, button shape, size and case",
  "Five-minute launch: store or website → brand (name, line, category, logo colours, currency) → products → look → payments → live, with every step streamed as it happens",
  "Smart product import from any Excel or CSV (xlsx, xls, xlsb, ods, numbers, csv, tsv; Shopify and WooCommerce exports): columns recognised by name or content, prices in any format, sizes and colours become variants, photo links checked, and each product shows what still needs filling",
  "Point of sale for your shop: scan barcodes or product QR codes (USB/Bluetooth scanner or camera), cash with change, UPI pay-by-QR, card, discounts, GST invoices, printable receipts and a daily summary; sales update stock and appear in Orders",
  "Onboarding that understands your business from a sentence, builds a personal plan (pages, payments, bookings, in-store selling), and opens the launch pre-filled",
  "Connect your own domain during launch, with the exact DNS records and a live check",
  "Project dashboard with a setup checklist from real data and a spotlight tour of how to run your store or site",
  "Invoicing: GST invoices, quotations clients accept online, proforma and credit notes, payments, recurring invoices, reminders, 8 templates plus your own uploaded format, sharing by link, email, WhatsApp, SMS or PDF, and sales/receivables/GST reports",
  "Barcodes and labels: in-store EAN-13 codes for every item (or your own EAN/UPC), and printable price labels with barcode and QR on thermal rolls or A4 sheets",
];

const NOT_YET = [
  ["Python and full Node.js in the terminal", "JavaScript runs in a built-in WebAssembly sandbox. Python and Node run in locked-down Docker containers only when the server sets EXEC_DOCKER=on and has Docker; that runner is tested with a simulated Docker CLI, not a real daemon."],
  ["Sandbox isolation from the web server", "The JavaScript sandbox runs inside the web server process (memory and time limited, one run per project at a time); a long script briefly occupies a server worker."],
  ["Real provider accounts", "Stripe, Razorpay, PayPal, EasyPost, Shippo, Mailchimp, Slack, Discord, Telegram, Resend, Postmark, SendGrid, GitHub and Voyage are tested against simulated APIs. Use the live payment test with your own test keys before taking real orders."],
  ["Semantic search for the chatbot", "Keyword search with typo tolerance always works. Meaning-based search needs a Voyage AI key; vectors are compared in the app, not with pgvector."],
  ["Co-editing in the visual builder", "Code and content files in the IDE are edited live, character by character. The visual builder still syncs saved edits every few seconds."],
  ["OAuth providers besides GitHub", "Sign-in with Google, Microsoft and others is not built. Passkeys are not built."],
  ["Scripts on published sites", "Published sites are script-free by design. Tabs, carousels and scrolling text use CSS only; pop-ups, countdown timers and autoplaying sliders are not offered."],
  ["Styling images and icons as elements", "Click-to-style covers text and buttons. Images are styled per section (corner radius) rather than one by one."],
  ["Photos inside spreadsheets", "The importer reads photo links (including Google Drive share links). Pictures pasted into Excel cells, or a folder of photos, are not imported; add them in Products after launch."],
  ["Payment terminals and cash drawers", "The till records card and UPI payments taken on your own card machine or UPI app; it does not talk to card terminals, confirm UPI payments, or open cash drawers. Receipts print through the browser."],
  ["Understanding descriptions", "Onboarding reads your description with keyword rules, not AI, and shows the words it matched so you can correct it. Unusual businesses may need you to pick the type yourself."],
  ["PDF files and e-invoicing", "Invoices are saved as PDF through the browser's print dialog; the server doesn't attach PDF files to emails. GST e-invoice (IRN) and e-way bill filing aren't connected."],
  ["Buying domains", "You can connect a domain you own; we don't sell or register domains."],
  ["Offline selling", "The till needs an internet connection to complete a sale. A cart in progress survives a refresh."],
  ["Per-project SQL databases", "Data tables are typed rows stored in the platform database, with a generated REST API; raw SQL and custom indexes are not offered."],
];

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader title="Roadmap" description="What works today, and its honest limits. Nothing on the second list is presented elsewhere as available." />
      <h2 className="mb-2 text-[13px] font-semibold">Available now</h2>
      <Card className="p-4">
        <ul className="grid gap-1.5 text-[13px] text-muted">
          {AVAILABLE.map((a) => (
            <li key={a}>• {a}</li>
          ))}
        </ul>
      </Card>
      <h2 className="mt-8 mb-2 text-[13px] font-semibold">Limits and not built yet</h2>
      <Card>
        <dl className="divide-y divide-border">
          {NOT_YET.map(([t, d]) => (
            <div key={t} className="grid gap-0.5 px-4 py-3 text-[13px] sm:grid-cols-[240px_1fr] sm:gap-4">
              <dt className="font-medium">{t}</dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
