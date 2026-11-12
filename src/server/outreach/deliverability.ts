// Will outreach land in the inbox? Checks the sending domain's DNS the way
// Gmail and Yahoo do for bulk senders — SPF, DKIM, DMARC (and BIMI for the
// logo next to the sender) — plus the sending set-up itself, and says exactly
// what record to add where something's missing.
import { Resolver } from "node:dns/promises";
import { MAILBOX_DAILY_CAP } from "@/lib/outreach/model";
import { appUrl } from "../services/mail";
import { getSettings, senderOf } from "./core";

export type Check = { id: string; title: string; status: "pass" | "warn" | "fail"; detail: string; fix?: { type: string; host: string; value: string; note?: string } };

type Lookup = { txt: (name: string) => Promise<string[]>; mx: (name: string) => Promise<string[]>; cname: (name: string) => Promise<string[]> };
const resolver = () => {
  const r = new Resolver({ timeout: 3000, tries: 2 });
  const safe = async <T,>(p: Promise<T>, empty: T) => p.catch(() => empty);
  return {
    txt: (n: string) => safe(r.resolveTxt(n).then((rows) => rows.map((x) => x.join(""))), [] as string[]),
    mx: (n: string) => safe(r.resolveMx(n).then((rows) => rows.map((x) => x.exchange)), [] as string[]),
    cname: (n: string) => safe(r.resolveCname(n), [] as string[]),
  } satisfies Lookup;
};
let lookup: Lookup | null = null;
/** Injectable for tests. */
export function setDnsLookup(l: Lookup | null) {
  lookup = l;
}

/** The SPF include and DKIM selectors to expect, from who actually sends. */
function expectations(via: "platform" | "mailbox", service: string, smtpHost: string) {
  const h = smtpHost.toLowerCase();
  if (via === "mailbox") {
    if (/google|gmail/.test(h)) return { spf: "_spf.google.com", selectors: ["google"], name: "Google Workspace" };
    if (/outlook|office365|microsoft/.test(h)) return { spf: "spf.protection.outlook.com", selectors: ["selector1", "selector2"], name: "Microsoft 365" };
    if (/secureserver|godaddy/.test(h)) return { spf: "secureserver.net", selectors: ["default", "secureserver"], name: "GoDaddy" };
    if (/zoho/.test(h)) return { spf: "zoho", selectors: ["zmail", "zoho", "default"], name: "Zoho" };
    if (/titan/.test(h)) return { spf: "titan.email", selectors: ["titan1", "default"], name: "Titan" };
    return { spf: "", selectors: ["default", "mail", "dkim"], name: "your mail host" };
  }
  if (/Resend/.test(service)) return { spf: "amazonses.com", spfHost: "send", selectors: ["resend"], name: "Resend" };
  if (/SendGrid/.test(service)) return { spf: "sendgrid.net", selectors: ["s1", "s2"], name: "SendGrid" };
  if (/Postmark/.test(service)) return { spf: "", selectors: [], name: "Postmark" };
  return { spf: "", selectors: ["default", "mail", "dkim", "k1"], name: "your email service" };
}

/** The registrable part of a host ("mail.cloudesk.in" → "cloudesk.in"; keeps two labels, three for co.in-style suffixes). */
const base = (host: string) => {
  const p = host.toLowerCase().split(".");
  return p.slice(/^(co|com|net|org|gov|ac|edu)$/.test(p[p.length - 2] ?? "") ? -3 : -2).join(".");
};

export async function deliverability() {
  const st = await getSettings();
  const sender = await senderOf(st);
  const dns = lookup ?? resolver();
  const domain = (sender.address.split("@")[1] ?? "").toLowerCase();
  const checks: Check[] = [];
  const exp = expectations(sender.via, sender.service, sender.account?.smtpHost ?? "");

  checks.push({ id: "service", title: "Sending service", status: sender.ready ? "pass" : "fail", detail: sender.ready ? `${sender.service}, from ${sender.address}` : sender.via === "mailbox" ? "The Cloudesk Mail mailbox isn't connected — reconnect it in Mail." : "No email service is set up, so nothing is delivered. Add Resend, Postmark, SendGrid or SMTP in Admin → Integrations." });
  if (!domain) return { domain, from: sender.address, via: sender.via, checks, score: 0 };

  const [rootTxt, dmarcTxt, bimiTxt, mx] = await Promise.all([dns.txt(domain), dns.txt(`_dmarc.${domain}`), dns.txt(`default._bimi.${domain}`), dns.mx(domain)]);

  // SPF: exactly one record, and it lets the sender in.
  const spfHost = "spfHost" in exp && exp.spfHost ? `${exp.spfHost}.${domain}` : domain;
  const spfRows = (spfHost === domain ? rootTxt : await dns.txt(spfHost)).filter((t) => /^v=spf1/i.test(t));
  const rootSpf = rootTxt.filter((t) => /^v=spf1/i.test(t));
  if (rootSpf.length > 1) checks.push({ id: "spf", title: "SPF", status: "fail", detail: `${domain} has ${rootSpf.length} SPF records; there must be one. Merge them.`, fix: { type: "TXT", host: "@", value: mergeSpf(rootSpf) } });
  else if (!spfRows.length) checks.push({ id: "spf", title: "SPF", status: "fail", detail: `No SPF record on ${spfHost} — mailboxes can't tell ${exp.name} may send for ${domain}.`, fix: { type: "TXT", host: spfHost === domain ? "@" : spfHost.replace(`.${domain}`, ""), value: exp.spf ? `v=spf1 include:${exp.spf.includes(".") ? exp.spf : `${exp.spf}.com`} ~all` : "v=spf1 include:<your provider> ~all", note: `${exp.name} shows the exact value when you add the domain.` } });
  else if (exp.spf && !spfRows.some((t) => t.toLowerCase().includes(exp.spf))) checks.push({ id: "spf", title: "SPF", status: "fail", detail: `The SPF record on ${spfHost} doesn't include ${exp.name} (${exp.spf}), so its mail fails SPF.`, fix: { type: "TXT", host: spfHost === domain ? "@" : spfHost.replace(`.${domain}`, ""), value: spfRows[0]!.replace(/\s*([~-]|\?)all/i, ` include:${exp.spf.includes(".") ? exp.spf : `${exp.spf}.com`} ~all`) } });
  else checks.push({ id: "spf", title: "SPF", status: "pass", detail: `${spfHost}: ${spfRows[0]}` });

  // DKIM: a key under one of the sender's selectors.
  let dkim = "";
  for (const sel of exp.selectors) {
    const [t, c] = await Promise.all([dns.txt(`${sel}._domainkey.${domain}`), dns.cname(`${sel}._domainkey.${domain}`)]);
    if (t.some((x) => /p=/.test(x)) || c.length) {
      dkim = sel;
      break;
    }
  }
  checks.push(dkim ? { id: "dkim", title: "DKIM signature", status: "pass", detail: `Key found at ${dkim}._domainkey.${domain}.` } : { id: "dkim", title: "DKIM signature", status: exp.selectors.length ? "fail" : "warn", detail: exp.selectors.length ? `No DKIM key for ${exp.name} on ${domain}. Without it Gmail and Yahoo treat bulk mail as unauthenticated.` : `Couldn't confirm DKIM (${exp.name} uses its own key name). Check the domain shows as verified there.`, fix: { type: exp.name === "Resend" ? "TXT" : "TXT / CNAME", host: `${exp.selectors[0] ?? "<selector>"}._domainkey`, value: "Copy the DKIM value from " + exp.name, note: `${exp.name} → Domains → ${domain} lists the exact record.` } });

  // DMARC: required by Gmail and Yahoo for bulk senders; enforcement is needed for the logo.
  const dmarc = dmarcTxt.find((t) => /^v=DMARC1/i.test(t));
  const policy = /;\s*p=(\w+)/i.exec(dmarc ?? "")?.[1]?.toLowerCase();
  const startDmarc = `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; adkim=r; aspf=r; pct=100`;
  if (!dmarc) checks.push({ id: "dmarc", title: "DMARC", status: "fail", detail: "No DMARC record. Gmail and Yahoo require one from bulk senders — without it promotional mail goes to spam or is rejected.", fix: { type: "TXT", host: "_dmarc", value: startDmarc, note: "Start with p=none; after two clean weeks move to p=quarantine." } });
  else if (policy === "none") checks.push({ id: "dmarc", title: "DMARC", status: "warn", detail: `In place but only monitoring (p=none). Fine to start; move to p=quarantine once SPF and DKIM pass — it's also needed to show your logo.`, fix: { type: "TXT", host: "_dmarc", value: dmarc.replace(/p=none/i, "p=quarantine") } });
  else checks.push({ id: "dmarc", title: "DMARC", status: "pass", detail: `p=${policy}: ${dmarc}` });

  // Links on the sender's own domain (a different domain looks like phishing).
  const linkHost = new URL(appUrl("/")).hostname;
  checks.push(base(linkHost) === base(domain) ? { id: "links", title: "Link domain", status: "pass", detail: `Tracked links use ${linkHost}, the same domain as the From address.` } : { id: "links", title: "Link domain", status: "warn", detail: `Links point to ${linkHost} but mail comes from ${domain}. Send from an address on ${base(linkHost)} if you can.` });

  checks.push(mx.length ? { id: "mx", title: "Replies and bounces", status: "pass", detail: `${domain} receives mail (${mx[0]}).` } : { id: "mx", title: "Replies and bounces", status: "warn", detail: `${domain} has no MX record, so replies can't be received — some filters distrust that.` });

  // BIMI: the logo beside the sender in Gmail, Yahoo and Apple Mail.
  const bimi = bimiTxt.find((t) => /^v=BIMI1/i.test(t));
  const bimiValue = `v=BIMI1; l=${appUrl("/brand/bimi.svg")};`;
  checks.push(bimi ? { id: "bimi", title: "Logo in inboxes (BIMI)", status: policy === "quarantine" || policy === "reject" ? "pass" : "warn", detail: policy === "quarantine" || policy === "reject" ? `Published: ${bimi}. Gmail and Apple also need a Mark Certificate (VMC or CMC) in a=.` : "Published, but it only works once DMARC is p=quarantine or p=reject." } : { id: "bimi", title: "Logo in inboxes (BIMI)", status: "warn", detail: "Shows the Cloudesk logo as the sender's picture. Needs DMARC at p=quarantine or p=reject; Yahoo then shows it, Gmail and Apple Mail also need a Mark Certificate (VMC/CMC).", fix: { type: "TXT", host: "default._bimi", value: bimiValue, note: "Add a=<certificate URL> once you have a VMC or CMC." } });

  checks.push({ id: "unsubscribe", title: "One-click unsubscribe", status: "pass", detail: "Every email has an unsubscribe link and the List-Unsubscribe one-click header Gmail and Yahoo require." });
  checks.push(st.postalAddress ? { id: "address", title: "Postal address", status: "pass", detail: st.postalAddress } : { id: "address", title: "Postal address", status: "fail", detail: "Promotional email must show your postal address. Add it in Settings." });
  checks.push(st.warmup || st.dailyLimit <= 200 ? { id: "warmup", title: "Warm-up", status: "pass", detail: st.warmup ? `Starts at ${st.warmupStart} a day and grows ${Math.round((st.warmupGrowth - 1) * 100)}% a day.` : `Daily limit ${st.dailyLimit}.` } : { id: "warmup", title: "Warm-up", status: "warn", detail: `Sending up to ${st.dailyLimit} a day without warm-up. A new domain that jumps straight to volume lands in spam — switch warm-up on.` });
  if (sender.via === "mailbox") checks.push({ id: "volume", title: "Mailbox volume", status: "warn", detail: `A mailbox is capped at ${MAILBOX_DAILY_CAP} outreach emails a day here; providers suspend mailboxes that send bulk. For more, use an email service (Resend, Postmark, SendGrid).` });
  checks.push(process.env.OUTREACH_WEBHOOK_KEY ? { id: "complaints", title: "Bounces and spam complaints", status: "pass", detail: "Your email service reports bounces and complaints back; those people are never emailed again." } : { id: "complaints", title: "Bounces and spam complaints", status: sender.via === "mailbox" ? "pass" : "warn", detail: sender.via === "mailbox" ? "Bounces are caught as the mailbox rejects them." : "Set OUTREACH_WEBHOOK_KEY in Vercel and point your email service's bounce and spam-complaint webhook at the address below, so complainers are never emailed again (Gmail suspends senders above 0.3% complaints).", fix: sender.via === "mailbox" ? undefined : { type: "Webhook", host: exp.name, value: `${appUrl("/api/v1/po/events")}?key=<OUTREACH_WEBHOOK_KEY>`, note: "Events: bounced and complained (Resend), Bounce and SpamComplaint (Postmark), bounce, dropped and spamreport (SendGrid)." } });

  const weight = { pass: 1, warn: 0.5, fail: 0 };
  const score = Math.round((checks.reduce((a, c) => a + weight[c.status], 0) / checks.length) * 100);
  return { domain, from: sender.address, via: sender.via, checks, score };
}

/** One SPF record from several: every mechanism once, ending ~all. */
function mergeSpf(rows: string[]) {
  const parts = new Set<string>();
  for (const r of rows) for (const p of r.split(/\s+/).slice(1)) if (!/all$/i.test(p)) parts.add(p);
  return `v=spf1 ${[...parts].join(" ")} ~all`;
}
