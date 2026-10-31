// Mail: shared definitions for the inbox — the providers we know how to
// connect (with their servers and setup steps), the smart categories, search
// syntax, rules, and the rule-based classifier that sorts mail without AI.
import { z } from "zod";

// ── Providers ───────────────────────────────────────────────────────────────

export type ProviderId = "gmail" | "google_workspace" | "microsoft" | "zoho" | "yahoo" | "icloud" | "titan" | "hostinger" | "godaddy" | "custom";
export type Server = { host: string; port: number; secure: boolean };
export type Provider = {
  id: ProviderId;
  name: string;
  /** Short line for the picker. */
  line: string;
  imap?: Server;
  smtp?: Server;
  /** Sign-in through the provider's own page (needs the platform's OAuth app). */
  oauth?: "google" | "microsoft";
  /** Whether an app password works (some providers only allow OAuth). */
  password: boolean;
  /** Gmail files sent mail itself; others need a copy appended to Sent. */
  savesSent?: boolean;
  /** Plain-language steps to get a password the inbox can use. */
  steps: { title: string; body: string; link?: { href: string; label: string } }[];
  /** Domains that are always this provider. */
  domains?: string[];
  /** MX hosts (suffix match) that mean this provider for a custom domain. */
  mx?: string[];
};

export const PROVIDERS: Provider[] = [
  {
    id: "gmail", name: "Gmail", line: "Personal Gmail accounts", password: true, oauth: "google", savesSent: true,
    imap: { host: "imap.gmail.com", port: 993, secure: true }, smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    domains: ["gmail.com", "googlemail.com"],
    steps: [
      { title: "Turn on 2-Step Verification", body: "Google only gives app passwords to accounts with 2-Step Verification on.", link: { href: "https://myaccount.google.com/signinoptions/twosv", label: "Open 2-Step Verification" } },
      { title: "Create an app password", body: "Name it “Cloudesk” and copy the 16-letter password Google shows (spaces don't matter).", link: { href: "https://myaccount.google.com/apppasswords", label: "Create an app password" } },
      { title: "Check IMAP is on", body: "In Gmail: Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP (it's on for most accounts).", link: { href: "https://mail.google.com/mail/u/0/#settings/fwdandpop", label: "Open Gmail IMAP settings" } },
    ],
  },
  {
    id: "google_workspace", name: "Google Workspace", line: "Your domain on Google (name@yourcompany.com)", password: true, oauth: "google", savesSent: true,
    imap: { host: "imap.gmail.com", port: 993, secure: true }, smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    mx: ["google.com", "googlemail.com"],
    steps: [
      { title: "Ask your admin to allow IMAP", body: "Admin console → Apps → Google Workspace → Gmail → End User Access → POP and IMAP access: on." },
      { title: "Turn on 2-Step Verification", body: "Then create an app password for “Cloudesk” — or use “Sign in with Google” if your platform has it.", link: { href: "https://myaccount.google.com/apppasswords", label: "Create an app password" } },
    ],
  },
  {
    id: "microsoft", name: "Microsoft 365 / Outlook", line: "Outlook.com, Hotmail and work accounts on Microsoft 365", password: false, oauth: "microsoft",
    imap: { host: "outlook.office365.com", port: 993, secure: true }, smtp: { host: "smtp.office365.com", port: 587, secure: false },
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"], mx: ["mail.protection.outlook.com", "olc.protection.outlook.com"],
    steps: [
      { title: "Sign in with Microsoft", body: "Microsoft no longer accepts passwords for mail apps — you sign in on Microsoft's own page and approve access to your mail." },
      { title: "Work accounts: IMAP and SMTP must be allowed", body: "If sign-in works but mail doesn't, ask your Microsoft 365 admin to enable IMAP and Authenticated SMTP for your mailbox (Microsoft 365 admin centre → Users → Mail → Manage email apps)." },
    ],
  },
  {
    id: "zoho", name: "Zoho Mail", line: "Zoho Mail (India: zoho.in, elsewhere: zoho.com)", password: true,
    imap: { host: "imap.zoho.in", port: 993, secure: true }, smtp: { host: "smtp.zoho.in", port: 465, secure: true },
    domains: ["zoho.com", "zohomail.com", "zoho.in", "zohomail.in"], mx: ["zoho.in", "zoho.com", "zoho.eu"],
    steps: [
      { title: "Turn on IMAP access", body: "Zoho Mail → Settings → Mail Accounts → IMAP → IMAP Access: on.", link: { href: "https://mail.zoho.in/zm/#settings/all/mailaccounts", label: "Open Zoho mail settings" } },
      { title: "Create an app-specific password", body: "If you use two-factor sign-in: Zoho Accounts → Security → App Passwords → Generate, and name it “Cloudesk”.", link: { href: "https://accounts.zoho.in/home#security/app_password", label: "Create an app password" } },
      { title: "Outside India?", body: "Use imap.zoho.com / smtp.zoho.com (or .eu) under Advanced if your account is on that data centre." },
    ],
  },
  {
    id: "yahoo", name: "Yahoo Mail", line: "yahoo.com, ymail and rocketmail", password: true,
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true }, smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    domains: ["yahoo.com", "yahoo.co.in", "ymail.com", "rocketmail.com"], mx: ["yahoodns.net"],
    steps: [{ title: "Generate an app password", body: "Yahoo Account Security → Generate app password → “Other app” → name it “Cloudesk”.", link: { href: "https://login.yahoo.com/account/security", label: "Open Yahoo account security" } }],
  },
  {
    id: "icloud", name: "iCloud Mail", line: "icloud.com, me.com and mac.com", password: true,
    imap: { host: "imap.mail.me.com", port: 993, secure: true }, smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    domains: ["icloud.com", "me.com", "mac.com"], mx: ["mail.icloud.com"],
    steps: [{ title: "Create an app-specific password", body: "Apple Account → Sign-In and Security → App-Specific Passwords → +, name it “Cloudesk”. Two-factor authentication must be on.", link: { href: "https://account.apple.com/account/manage", label: "Open Apple Account" } }],
  },
  {
    id: "titan", name: "Titan Mail", line: "Professional email bought with your domain (Titan)", password: true,
    imap: { host: "imap.titan.email", port: 993, secure: true }, smtp: { host: "smtp.titan.email", port: 465, secure: true },
    mx: ["titan.email"],
    steps: [{ title: "Use your mailbox password", body: "Titan works with your normal mailbox password. If you turned on two-factor login, create an app password in Titan settings → Security." }],
  },
  {
    id: "hostinger", name: "Hostinger Email", line: "Business email from Hostinger", password: true,
    imap: { host: "imap.hostinger.com", port: 993, secure: true }, smtp: { host: "smtp.hostinger.com", port: 465, secure: true },
    mx: ["hostinger.com"],
    steps: [{ title: "Use your mailbox password", body: "The password you set for this mailbox in hPanel → Emails. Reset it there if you don't remember it." }],
  },
  {
    id: "godaddy", name: "GoDaddy Email", line: "GoDaddy Professional Email (Microsoft 365 from GoDaddy: pick Microsoft)", password: true,
    imap: { host: "imap.secureserver.net", port: 993, secure: true }, smtp: { host: "smtpout.secureserver.net", port: 465, secure: true },
    mx: ["secureserver.net"],
    steps: [{ title: "Use your mailbox password", body: "The password for this mailbox in GoDaddy Email & Office Dashboard." }],
  },
  {
    id: "custom", name: "Other (IMAP / SMTP)", line: "Any other mail server — cPanel, your host, your company's server", password: true,
    steps: [
      { title: "Find your server settings", body: "Your host's help pages list them — usually mail.yourdomain.com, IMAP port 993 (SSL) and SMTP port 465 (SSL) or 587 (STARTTLS)." },
      { title: "Use your mailbox password", body: "Or an app password if your provider offers them." },
    ],
  },
];
export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id);

/** Best guess of the provider from the address alone (no network). */
export function providerForAddress(address: string): ProviderId | null {
  const d = address.split("@")[1]?.toLowerCase().trim() ?? "";
  return PROVIDERS.find((p) => p.domains?.includes(d))?.id ?? null;
}

/** The provider an MX host belongs to (e.g. "aspmx.l.google.com" → Google Workspace). */
export function providerForMx(mxHosts: string[]): ProviderId | null {
  for (const h of mxHosts.map((x) => x.toLowerCase().replace(/\.$/, ""))) {
    const p = PROVIDERS.find((x) => x.mx?.some((m) => h === m || h.endsWith(`.${m}`)));
    if (p) return p.id;
  }
  return null;
}

// ── Categories, views and search ────────────────────────────────────────────

export const CATEGORIES = ["primary", "people", "updates", "finance", "promotions", "newsletters", "social", "screener"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  primary: "Primary", people: "People", updates: "Updates", finance: "Finance", promotions: "Promotions", newsletters: "Newsletters", social: "Social", screener: "New senders",
};

export const VIEWS = ["inbox", "needsreply", "important", "starred", "snoozed", "waiting", "followups", "scheduled", "sent", "archive", "trash", "spam", "assigned", "attachments", "muted", "meetings"] as const;
export type View = (typeof VIEWS)[number];

export type SearchQuery = { text: string; from?: string; to?: string; subject?: string; hasAttachment?: boolean; unread?: boolean; starred?: boolean; label?: string; category?: Category; before?: string; after?: string; in?: string };

/** Gmail-style search: `from:asha has:attachment invoice before:2026-10-01`. */
export function parseSearch(q: string): SearchQuery {
  const out: SearchQuery = { text: "" };
  const free: string[] = [];
  for (const tok of q.match(/(\w+:"[^"]*"|\w+:\S+|"[^"]*"|\S+)/g) ?? []) {
    const m = tok.match(/^(\w+):(.+)$/);
    const val = m ? m[2]!.replace(/^"|"$/g, "") : "";
    switch (m?.[1]?.toLowerCase()) {
      case "from": out.from = val; break;
      case "to": out.to = val; break;
      case "subject": out.subject = val; break;
      case "has": if (/^attach/.test(val)) out.hasAttachment = true; else free.push(tok); break;
      case "is":
        if (val === "unread") out.unread = true;
        else if (val === "read") out.unread = false;
        else if (val === "starred") out.starred = true;
        else free.push(tok);
        break;
      case "label": out.label = val; break;
      case "category": if ((CATEGORIES as readonly string[]).includes(val)) out.category = val as Category; break;
      case "before": if (/^\d{4}-\d{2}-\d{2}$/.test(val)) out.before = val; break;
      case "after": if (/^\d{4}-\d{2}-\d{2}$/.test(val)) out.after = val; break;
      case "in": out.in = val; break;
      default: free.push(tok.replace(/^"|"$/g, ""));
    }
  }
  out.text = free.join(" ").trim();
  return out;
}

// ── Classifier (no AI) ──────────────────────────────────────────────────────

export type ClassifyInput = {
  from: string;
  fromName?: string;
  subject: string;
  text: string;
  listUnsubscribe?: boolean;
  precedenceBulk?: boolean;
  /** People we've written to, or who are contacts in the CRM. */
  knownSender: boolean;
  /** First message we've ever had from this address. */
  firstFromSender: boolean;
  toMeDirectly: boolean;
};
export type Classified = { category: Category; priority: "high" | "normal" | "low"; reasons: string[] };

const SOCIAL = ["linkedin.com", "facebookmail.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "pinterest.com", "quora.com", "reddit.com", "whatsapp.com"];
const FINANCE = /\b(invoice|receipt|payment|paid|bill|statement|gst|tax invoice|refund|transaction|debited|credited|upi|neft|rtgs|imps|razorpay|stripe|purchase order|quotation|remittance)\b/i;
const PROMO = /\b(sale|% off|discount|offer|deal|coupon|limited time|free shipping|shop now|black friday|cashback|exclusive)\b/i;
const UPDATE = /\b(verify|verification|otp|one-time|password reset|sign-?in|security alert|your order|shipped|delivered|out for delivery|booking|confirmation|reminder|notification|alert|welcome to)\b/i;
const URGENT = /\b(urgent|asap|immediately|today|deadline|overdue|final notice|action required|important)\b/i;
const NOREPLY = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer|bounce|updates?|news(letter)?|info|support|hello|team)@/i;

/** Sorts a message into a category and priority, with the reasons — rules only, no AI. */
export function classify(m: ClassifyInput): Classified {
  const domain = m.from.split("@")[1]?.toLowerCase() ?? "";
  const hay = `${m.subject}\n${m.text.slice(0, 3000)}`;
  const reasons: string[] = [];
  let category: Category;
  if (SOCIAL.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    category = "social";
    reasons.push(`From a social network (${domain})`);
  } else if (FINANCE.test(hay) && !PROMO.test(m.subject)) {
    category = "finance";
    reasons.push("Mentions a bill, payment or invoice");
  } else if (m.knownSender && !m.listUnsubscribe) {
    category = "people";
    reasons.push("Someone you've written to or a CRM contact");
  } else if (m.listUnsubscribe && PROMO.test(hay)) {
    category = "promotions";
    reasons.push("A marketing email (has an unsubscribe link and offer words)");
  } else if (m.listUnsubscribe || m.precedenceBulk) {
    category = "newsletters";
    reasons.push("Sent to a list (has an unsubscribe link)");
  } else if (UPDATE.test(m.subject) || NOREPLY.test(m.from)) {
    category = "updates";
    reasons.push("An automatic notice (order, sign-in, booking or alert)");
  } else if (m.firstFromSender) {
    category = "screener";
    reasons.push("First email from this sender — approve or block them");
  } else {
    category = "primary";
  }
  let priority: Classified["priority"] = "normal";
  if (["promotions", "newsletters", "social"].includes(category)) priority = "low";
  else if (URGENT.test(m.subject) || (m.knownSender && m.toMeDirectly && /\?/.test(hay.slice(0, 1200)))) {
    priority = "high";
    reasons.push(URGENT.test(m.subject) ? "Marked urgent in the subject" : "A direct question from someone you know");
  }
  return { category, priority, reasons };
}

/** Warning signs of a fake or phishing email. */
export function suspicious(m: { from: string; fromName?: string; authResults?: string; replyTo?: string }): string[] {
  const out: string[] = [];
  const domain = m.from.split("@")[1]?.toLowerCase() ?? "";
  const named = m.fromName?.match(/[\w.+-]+@([\w-]+\.[\w.-]+)/)?.[1]?.toLowerCase();
  if (named && named !== domain) out.push(`The name shows ${named} but it was sent from ${domain}`);
  if (m.authResults && /\b(dmarc|spf|dkim)=fail\b/i.test(m.authResults)) out.push("The sender's domain didn't vouch for this message (SPF/DKIM/DMARC failed)");
  const rt = m.replyTo?.split("@")[1]?.toLowerCase();
  if (rt && rt !== domain && !rt.endsWith(`.${domain}`)) out.push(`Replies would go to a different domain (${rt})`);
  return out;
}

/** "Re: Fwd: Hello" → "hello", for threading by subject. */
export const normSubject = (s: string) => s.replace(/^\s*((re|fwd?|fw|aw|wg|tr)(\[\d+\])?\s*:\s*)+/i, "").trim().toLowerCase();

// ── Rules ───────────────────────────────────────────────────────────────────

export const ruleCondition = z.object({
  field: z.enum(["from", "to", "subject", "body", "category", "hasAttachment"]),
  op: z.enum(["contains", "equals", "domain", "is"]),
  value: z.string().trim().max(200),
});
export const ruleAction = z.object({
  type: z.enum(["label", "category", "archive", "star", "read", "assign", "trash", "ticket", "contact", "priority"]),
  value: z.string().trim().max(200).default(""),
});
export const ruleSchema = z.object({
  name: z.string().trim().min(1, "Name the rule").max(80),
  accountId: z.uuid().nullable().default(null),
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(ruleCondition).min(1, "Add at least one condition").max(10),
  actions: z.array(ruleAction).min(1, "Add at least one action").max(10),
  enabled: z.boolean().default(true),
});
export type Rule = z.infer<typeof ruleSchema>;
export type RuleSubject = { from: string; to: string[]; subject: string; text: string; category: Category; hasAttachment: boolean };

export function ruleMatches(r: Pick<Rule, "match" | "conditions">, m: RuleSubject) {
  const test = (c: z.infer<typeof ruleCondition>) => {
    const v = c.value.toLowerCase();
    switch (c.field) {
      case "from": return c.op === "domain" ? m.from.toLowerCase().endsWith(`@${v}`) || m.from.toLowerCase().endsWith(`.${v}`) : c.op === "equals" ? m.from.toLowerCase() === v : m.from.toLowerCase().includes(v);
      case "to": return m.to.some((t) => (c.op === "equals" ? t.toLowerCase() === v : t.toLowerCase().includes(v)));
      case "subject": return c.op === "equals" ? m.subject.toLowerCase() === v : m.subject.toLowerCase().includes(v);
      case "body": return m.text.toLowerCase().includes(v);
      case "category": return m.category === v;
      case "hasAttachment": return m.hasAttachment === (v !== "false");
    }
  };
  return r.match === "all" ? r.conditions.every(test) : r.conditions.some(test);
}

// ── Templates ───────────────────────────────────────────────────────────────

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Name it").max(80),
  subject: z.string().trim().max(300).default(""),
  body: z.string().max(20_000),
  shortcut: z.string().trim().max(30).regex(/^[a-z0-9-]*$/, "Lowercase letters, numbers and dashes").default(""),
  shared: z.boolean().default(false),
});

/** Fills {{first_name}}, {{name}}, {{email}}, {{company}}, {{my_name}} in a template. */
export function fillTemplate(t: string, v: { name?: string; email?: string; company?: string; myName?: string }) {
  const first = (v.name ?? "").trim().split(/\s+/)[0] ?? "";
  // An unknown value takes the space before it too ("Hi {{first_name}}," → "Hi,").
  return t.replace(/( ?)\{\{\s*(first_name|name|email|company|my_name)\s*\}\}/g, (_m, sp: string, k: string) => {
    const val = ({ first_name: first, name: v.name ?? "", email: v.email ?? "", company: v.company ?? "", my_name: v.myName ?? "" } as Record<string, string>)[k] ?? "";
    return val ? `${sp}${val}` : "";
  });
}

// ── Replies owed, auto-replies ──────────────────────────────────────────────

/** Categories where a real person usually expects an answer: "Needs reply" and response times count only these. */
export const REPLY_CATEGORIES: Category[] = ["primary", "people", "screener"];

/** How long they've been waiting, against the mailbox's reply target (hours). */
export function slaState(awaitingSince: string | Date | null, slaHours: number | null, now = Date.now()): { waitingMs: number; dueAt: number | null; overdue: boolean } | null {
  if (!awaitingSince) return null;
  const since = new Date(awaitingSince).getTime();
  const dueAt = slaHours ? since + slaHours * 3_600_000 : null;
  return { waitingMs: Math.max(0, now - since), dueAt, overdue: dueAt !== null && now > dueAt };
}

export const autoReplySchema = z.object({
  enabled: z.boolean().default(false),
  /** YYYY-MM-DD, inclusive; empty for "from now" / "until I turn it off". */
  from: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  until: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  subject: z.string().trim().max(200).default(""),
  body: z.string().trim().max(5000).default(""),
  /** Only answer people you've written to before or who are in the CRM. */
  onlyKnown: z.boolean().default(false),
  /** The owner's time zone (minutes from UTC) — the dates are their days. */
  tzOffset: z.number().int().min(-720).max(840).default(330),
}).refine((v) => !v.enabled || v.body.length > 0, { message: "Write the reply", path: ["body"] }).refine((v) => !v.from || !v.until || v.from <= v.until, { message: "The end date is before the start", path: ["until"] });
export type AutoReply = z.infer<typeof autoReplySchema>;

/** Whether an automatic reply may go to this message (RFC 3834): never to lists, robots, other auto-replies or suspicious mail. */
export function autoReplyAllowed(m: { from: string; ownAddress: string; autoSubmitted: string; precedence: string; listId: string; listUnsubscribe: string; autoResponseSuppress: string; category: Category; warnings: string[] }): { ok: boolean; why?: string } {
  const from = m.from.toLowerCase();
  if (!from || from === m.ownAddress.toLowerCase()) return { ok: false, why: "from us" };
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|bounces|notifications?|alerts?)([+._-]|@)/i.test(from)) return { ok: false, why: "a robot address" };
  if (m.autoSubmitted && !/^no$/i.test(m.autoSubmitted.trim())) return { ok: false, why: "an automatic message" };
  if (/bulk|list|junk|auto_reply/i.test(m.precedence)) return { ok: false, why: "bulk mail" };
  if (m.listId || m.listUnsubscribe) return { ok: false, why: "a mailing list" };
  if (/all|oof|autoreply/i.test(m.autoResponseSuppress)) return { ok: false, why: "asked for no auto-replies" };
  if (["promotions", "newsletters", "social", "updates"].includes(m.category)) return { ok: false, why: "not personal mail" };
  if (m.warnings.length) return { ok: false, why: "looks suspicious" };
  return { ok: true };
}

/** Is the auto-reply on at this moment? The dates are whole days in the owner's time zone. */
export function autoReplyActive(a: AutoReply | null | undefined, at: Date): boolean {
  if (!a?.enabled || !a.body) return false;
  const day = new Date(at.getTime() + (a.tzOffset ?? 330) * 60_000).toISOString().slice(0, 10);
  if (a.from && day < a.from) return false;
  if (a.until && day > a.until) return false;
  return true;
}
