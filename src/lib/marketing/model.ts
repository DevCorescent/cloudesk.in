// Marketing: segments of CRM contacts (by lifecycle, source, tags, score,
// place, deals), email campaigns with an optional A/B subject, tracked links
// and an unsubscribe link, events with registration and attendance, UTM-tagged
// links, spend against budget, and attribution of won deals to the campaigns
// that touched the contact first and last.
import { createHash } from "node:crypto";
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CAMPAIGN_KINDS = ["email", "event", "ads", "other"] as const;
export const CAMPAIGN_KIND_LABEL: Record<(typeof CAMPAIGN_KINDS)[number], string> = { email: "Email", event: "Event", ads: "Ads", other: "Other" };
export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "sent", "active", "ended", "cancelled"] as const;
export const CAMPAIGN_STATUS_LABEL: Record<(typeof CAMPAIGN_STATUSES)[number], string> = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent", active: "Running", ended: "Ended", cancelled: "Cancelled" };
export const TOUCH_KINDS = ["sent", "clicked", "registered", "attended", "form"] as const;

export const settingsSchema = z
  .object({
    fromName: z.string().trim().max(80).default(""),
    replyTo: z.union([z.literal(""), z.email()]).default(""),
    utmSource: z.string().trim().min(1).max(40).default("cloudesk"),
    /** Days before a deal is won that a campaign's touch still counts. */
    attributionDays: z.number().int().min(1).max(365).default(90),
  })
  .prefault({});
export type MktSettings = z.infer<typeof settingsSchema>;

export const rulesSchema = z.object({
  lifecycle: z.array(z.string().max(30)).max(10).default([]),
  sources: z.array(z.string().max(40)).max(20).default([]),
  tagsAny: z.array(z.string().max(40)).max(20).default([]),
  tagsAll: z.array(z.string().max(40)).max(20).default([]),
  minScore: z.number().int().min(0).max(100).nullable().default(null),
  cities: z.array(z.string().max(60)).max(20).default([]),
  countries: z.array(z.string().max(60)).max(20).default([]),
  ownerIds: z.array(z.uuid()).max(50).default([]),
  createdWithinDays: z.number().int().min(1).max(3650).nullable().default(null),
  openDeal: z.enum(["any", "yes", "no"]).default("any"),
  wonDeal: z.enum(["any", "yes", "no"]).default("any"),
});
export type Rules = z.infer<typeof rulesSchema>;

export const segmentSchema = z.object({ name: z.string().trim().min(1, "Name the segment").max(120), rules: rulesSchema.prefault({}) });

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Name the campaign").max(160),
  kind: z.enum(CAMPAIGN_KINDS).default("email"),
  segmentId: z.uuid().nullable().default(null),
  subject: z.string().trim().max(200).default(""),
  /** A second subject line; the audience is split between them. */
  subjectB: z.string().trim().max(200).default(""),
  body: z.string().max(20000).default(""),
  budget: z.number().int().min(0).max(1e12).default(0),
  spend: z.number().int().min(0).max(1e12).default(0),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,59}$/, "Letters, numbers, - and _ only").optional(),
  startOn: day.nullable().default(null),
  endOn: day.nullable().default(null),
  eventAt: z.iso.datetime({ offset: true }).nullable().default(null),
  venue: z.string().trim().max(200).default(""),
  onlineUrl: z.union([z.literal(""), z.url()]).default(""),
  capacity: z.number().int().min(0).max(100000).default(0),
  notes: z.string().trim().max(4000).default(""),
});

export type ContactFacts = { lifecycle: string; source: string; tags: string[]; score: number; city: string; country: string; ownerId: string | null; createdAt: Date | string; openDeals: number; wonDeals: number };

const lower = (xs: string[]) => xs.map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Whether a contact is in a segment: every rule that's set must hold. */
export function matches(r: Rules, c: ContactFacts, now = new Date()) {
  const tags = lower(c.tags);
  if (r.lifecycle.length && !r.lifecycle.includes(c.lifecycle)) return false;
  if (r.sources.length && !r.sources.includes(c.source)) return false;
  if (r.tagsAny.length && !lower(r.tagsAny).some((t) => tags.includes(t))) return false;
  if (r.tagsAll.length && !lower(r.tagsAll).every((t) => tags.includes(t))) return false;
  if (r.minScore !== null && c.score < r.minScore) return false;
  if (r.cities.length && !lower(r.cities).includes(c.city.trim().toLowerCase())) return false;
  if (r.countries.length && !lower(r.countries).includes(c.country.trim().toLowerCase())) return false;
  if (r.ownerIds.length && (!c.ownerId || !r.ownerIds.includes(c.ownerId))) return false;
  if (r.createdWithinDays !== null && now.getTime() - new Date(c.createdAt).getTime() > r.createdWithinDays * 86_400_000) return false;
  if (r.openDeal !== "any" && (c.openDeals > 0) !== (r.openDeal === "yes")) return false;
  if (r.wonDeal !== "any" && (c.wonDeals > 0) !== (r.wonDeal === "yes")) return false;
  return true;
}

/** A/B: the same contact always gets the same subject; splitPct of contacts get B. */
export function variantFor(contactId: string, campaignId: string, hasB: boolean) {
  if (!hasB) return "A";
  const h = createHash("sha256").update(`${campaignId}:${contactId}`).digest();
  return h[0] % 2 === 0 ? "A" : "B";
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
/** The links in an email body, in order, once each. */
export const linksIn = (body: string) => [...new Set((body.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))];

/**
 * The email for one contact: {{first_name}}, {{name}}, {{company}} and
 * {{email}} filled in, each link swapped for its tracked one, and the
 * unsubscribe line at the end.
 */
export function renderEmail(body: string, c: { name: string; email: string; company: string }, tracked: (index: number) => string, unsubscribeUrl: string, from: string) {
  const first = c.name.trim().split(/\s+/)[0] ?? "";
  const links = linksIn(body);
  let text = body.replace(/\{\{\s*(first_name|name|company|email)\s*\}\}/g, (_, k: string) => (k === "first_name" ? first || "there" : k === "name" ? c.name || "there" : k === "company" ? c.company : c.email));
  text = text.replace(URL_RE, (m) => {
    const clean = m.replace(/[.,;:!?]+$/, "");
    const i = links.indexOf(clean);
    return i < 0 ? m : tracked(i) + m.slice(clean.length);
  });
  return `${text.trim()}\n\n—\nYou're getting this because you're in touch with ${from}. Unsubscribe: ${unsubscribeUrl}`;
}

/** A link tagged for analytics: utm_source, utm_medium, utm_campaign (and utm_content). */
export function utmUrl(url: string, p: { source: string; medium: string; campaign: string; content?: string }) {
  const u = new URL(url);
  u.searchParams.set("utm_source", p.source);
  u.searchParams.set("utm_medium", p.medium);
  u.searchParams.set("utm_campaign", p.campaign);
  if (p.content) u.searchParams.set("utm_content", p.content);
  return u.toString();
}

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "campaign";

export type Send = { variant: string; status: string; clicks: number; unsubscribedAt: Date | string | null };
/** How an email did: sent, failed, skipped, who clicked (and the rate), unsubscribes — overall and per subject. */
export function emailStats(sends: Send[]) {
  const of = (xs: Send[]) => {
    const sent = xs.filter((x) => x.status === "sent").length;
    const clicked = xs.filter((x) => x.status === "sent" && x.clicks > 0).length;
    return { total: xs.length, sent, failed: xs.filter((x) => x.status === "failed").length, skipped: xs.filter((x) => x.status === "skipped").length, queued: xs.filter((x) => x.status === "queued").length, clicked, clickRate: sent ? clicked / sent : null, unsubscribed: xs.filter((x) => x.unsubscribedAt).length };
  };
  return { all: of(sends), A: of(sends.filter((x) => x.variant === "A")), B: of(sends.filter((x) => x.variant === "B")) };
}

export type Touch = { campaignId: string; contactId: string; at: Date | string };
export type WonDeal = { id: string; contactId: string | null; value: number; closedAt: Date | string };
/**
 * Which campaigns get credit for won deals: of each contact's touches in the
 * window before the deal was won, the first gets first-touch credit, the last
 * gets last-touch credit, and every campaign touched shares it evenly (linear).
 */
export function attribute(touches: Touch[], deals: WonDeal[], windowDays: number) {
  const out = new Map<string, { deals: Set<string>; firstValue: number; lastValue: number; linearValue: number }>();
  const get = (id: string) => out.get(id) ?? (out.set(id, { deals: new Set(), firstValue: 0, lastValue: 0, linearValue: 0 }), out.get(id)!);
  for (const d of deals) {
    if (!d.contactId) continue;
    const won = new Date(d.closedAt).getTime();
    const mine = touches.filter((t) => t.contactId === d.contactId && new Date(t.at).getTime() <= won && won - new Date(t.at).getTime() <= windowDays * 86_400_000).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    if (!mine.length) continue;
    const campaigns = [...new Set(mine.map((t) => t.campaignId))];
    for (const c of campaigns) {
      const e = get(c);
      e.deals.add(d.id);
      e.linearValue += Math.round(d.value / campaigns.length);
    }
    get(mine[0].campaignId).firstValue += d.value;
    get(mine[mine.length - 1].campaignId).lastValue += d.value;
  }
  return new Map([...out.entries()].map(([k, v]) => [k, { deals: v.deals.size, firstValue: v.firstValue, lastValue: v.lastValue, linearValue: v.linearValue }]));
}

/** Return on spend: what won deals brought in over what was spent (null without spend). */
export const roi = (value: number, spend: number) => (spend > 0 ? (value - spend) / spend : null);
