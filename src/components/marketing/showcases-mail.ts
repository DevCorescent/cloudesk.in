// Screenshot showcase for the Mail feature page. Every image is a real capture
// of the app (public/marketing/mail/), taken from a demo workspace by
// scripts/marketing/capture-mail.spec.ts — the demo mail goes through the real
// ingest pipeline, so the sorting, screener and warnings are the app's own.
// Hotspot positions are percentages of the image.
import type { Showcase } from "./showcases";
import type { Shot } from "./shot-tour";

const mail = (name: string, alt: string): Shot => ({ src: `/marketing/mail/${name}.jpg`, w: 2880, h: 1800, alt });

export const SHOWCASES_MAIL: Record<string, Showcase> = {
  mail: {
    hero: { shot: mail("inbox", "The unified inbox: two mailboxes side by side, mail sorted into People, Updates and Finance, and new senders marked") },
    note: "Real screenshots from the app, using a demo workspace.",
    chapters: [
      {
        key: "connect",
        eyebrow: "Connect",
        title: "Any mailbox, with steps made for it.",
        mark: "steps made for it",
        body: "Type your address and we work out the provider — even for your own domain, from its mail records. Then you get that provider's own steps, with links straight to the right settings page, and a live test before anything is saved.",
        bullets: ["Gmail, Microsoft 365, Zoho, Yahoo, iCloud, Titan, Hostinger, GoDaddy or any server", "Tick off each step as you go", "Problems explained in plain words"],
        tone: "sky",
        shot: mail("connect", "Adding a Zoho mailbox: turn on IMAP, create an app password, each with a link to the settings page"),
        hotspots: [
          { x: 34, y: 23.4, label: "Five short steps" },
          { x: 34.2, y: 42.4, label: "Opens the right page" },
          { x: 31, y: 75.8, label: "Why an app password?" },
        ],
      },
      {
        key: "inbox",
        eyebrow: "One inbox",
        title: "Every mailbox. Sorted before you look.",
        mark: "Sorted before you look",
        body: "All your mailboxes in one list, or each on its own. New mail lands in People, Finance, Updates, Promotions, Newsletters or Social, first-time senders are marked, and search understands from:, has:attachment, before: and more.",
        bullets: ["Unread counts per mailbox", "Important, waiting for reply and follow-ups due", "Keyboard shortcuts for everything"],
        tone: "lavender",
        shot: mail("inbox", "The unified inbox with category tabs and new-sender badges"),
        hotspots: [
          { x: 22.7, y: 13.3, label: "All inboxes" },
          { x: 36.4, y: 16.6, label: "Sorted by category" },
          { x: 39.7, y: 37.8, label: "New sender" },
        ],
      },
      {
        key: "thread",
        eyebrow: "In context",
        title: "The customer, beside their email.",
        mark: "beside their email",
        body: "Open a conversation and the sender sits right at the top, with their CRM record. Add a sender to the CRM or turn the email into a Helpdesk ticket in one click, and tap the category to see why it landed there.",
        bullets: ["Open in CRM, with their deals", "Make a helpdesk ticket", "Mark VIPs so they always come first"],
        tone: "mint",
        shot: mail("thread", "A customer's thread marked People and Important, with their CRM contact above it"),
        hotspots: [
          { x: 66.1, y: 28.8, label: "Open in CRM" },
          { x: 63.3, y: 18.2, label: "Why it's here" },
          { x: 66.5, y: 34.8, label: "AI on request" },
        ],
      },
      {
        key: "phishing",
        eyebrow: "Safety",
        title: "Phishing tricks, called out in red.",
        mark: "called out in red",
        body: "A display name that pretends to be someone else, a sender whose domain fails SPF, DKIM or DMARC, or replies going to a different domain — each is flagged with the reason. Remote images stay blocked until you choose to show them.",
        bullets: ["Look-alike names and domains", "Failed sender checks", "No tracking pixels by default"],
        tone: "rose",
        shot: mail("phishing", "A fake PayPal email flagged: the name doesn't match the sending domain and the sender checks failed"),
        hotspots: [{ x: 79, y: 35.8, label: "Why it's suspicious" }],
      },
      {
        key: "reply",
        eyebrow: "Reply",
        title: "Screen, reply and follow up, in place.",
        mark: "in place",
        body: "Let a new sender in or block them with one click. Reply right under the message, schedule the send, ask to be reminded if nobody answers, and undo a send for a few seconds.",
        bullets: ["Screener for first-time senders", "Schedule send and undo send", "Templates that fill in names"],
        tone: "peach",
        shot: mail("reply", "Replying to a new sender inline, with the screener's Allow and Block above"),
        hotspots: [
          { x: 89.5, y: 36.7, label: "Allow or block" },
          { x: 72.2, y: 90.8, label: "Schedule or remind me", above: true },
        ],
      },
    ],
  },
};
