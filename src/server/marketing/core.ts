// Marketing: segments over CRM contacts, campaigns (email, event, ads,
// other), sending an email campaign in the background through the
// workspace's mail setup (only to contacts who agreed to marketing), tracked
// links and unsubscribe, event registration and attendance, touches for
// attribution, and results: email stats, registrations, and won deals
// against spend.
import { createHmac, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { attribute, campaignSchema, emailStats, linksIn, matches, renderEmail, roi, rulesSchema, segmentSchema, slugify, utmUrl, variantFor, type ContactFacts, type Rules } from "@/lib/marketing/model";
import { isOn, isPartOn, type PartsOff } from "@/lib/workspace/modules";
import { capture } from "../crm/capture";
import { addEvent } from "../crm/timeline";
import { ApiError, notFound } from "../http/errors";
import { assertQuota } from "../billing/subscriptions";
import { defineJob, enqueue } from "../jobs/queue";
import { log } from "../log";
import { safeEqual } from "../security/tokens";
import { audit } from "../services/audit";
import { appUrl, mailConfigured, sendMail } from "../services/mail";
import { check, getSettings, requirePart, requireWrite, type Scope } from "./access";

type Campaign = typeof schema.mktCampaigns.$inferSelect;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const BATCH = 50;

// ── Segments ────────────────────────────────────────────────────────────────

/** Contacts with what segments look at: deals open and won, and whether email may go to them. */
async function audience(orgId: string) {
  const rows = (await db.execute(sql`
    select c.id, c.name, c.email, c.lifecycle, c.source, c.tags, c.score, c.city, c.country, c.owner_id, c.created_at, c.marketing, c.do_not_contact,
      coalesce(co.name, '') as company,
      (select count(*)::int from crm_deals d where d.contact_id = c.id and d.status = 'open') as open_deals,
      (select count(*)::int from crm_deals d where d.contact_id = c.id and d.status = 'won') as won_deals
    from crm_contacts c left join crm_companies co on co.id = c.company_id
    where c.org_id = ${orgId}`)) as unknown as { rows: { id: string; name: string; email: string; lifecycle: string; source: string; tags: string[]; score: number; city: string; country: string; owner_id: string | null; created_at: Date; marketing: boolean; do_not_contact: boolean; company: string; open_deals: number; won_deals: number }[] };
  return rows.rows.map((r) => ({ id: r.id, name: r.name, email: r.email, company: r.company, marketing: r.marketing, doNotContact: r.do_not_contact, facts: { lifecycle: r.lifecycle, source: r.source, tags: r.tags ?? [], score: r.score, city: r.city, country: r.country, ownerId: r.owner_id, createdAt: r.created_at, openDeals: r.open_deals, wonDeals: r.won_deals } satisfies ContactFacts }));
}

/** Who's in a segment, and who of them may be emailed (agreed to marketing, has an email, not unsubscribed). */
export async function members(orgId: string, rules: Rules) {
  const all = (await audience(orgId)).filter((c) => matches(rules, c.facts));
  const mailable = all.filter((c) => c.marketing && !c.doNotContact && c.email);
  return { all, mailable };
}

export async function segments(s: Scope) {
  const rows = await db.select().from(schema.mktSegments).where(eq(schema.mktSegments.orgId, s.orgId)).orderBy(asc(schema.mktSegments.name));
  const people = await audience(s.orgId);
  return rows.map((r) => {
    const rules = rulesSchema.parse(r.rules);
    const inIt = people.filter((c) => matches(rules, c.facts));
    return { ...r, rules, count: inIt.length, mailable: inIt.filter((c) => c.marketing && !c.doNotContact && c.email).length };
  });
}

export async function previewSegment(s: Scope, raw: unknown) {
  const rules = check(rulesSchema, raw);
  const m = await members(s.orgId, rules);
  return { count: m.all.length, mailable: m.mailable.length, sample: m.all.slice(0, 20).map((c) => ({ id: c.id, name: c.name, email: c.email, company: c.company, mailable: c.marketing && !c.doNotContact && !!c.email })) };
}

export async function saveSegment(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(segmentSchema, raw);
  if (id) {
    if (!isId(id)) throw notFound("Segment");
    const [row] = await db.update(schema.mktSegments).set(v).where(and(eq(schema.mktSegments.id, id), eq(schema.mktSegments.orgId, s.orgId))).returning();
    if (!row) throw notFound("Segment");
    return row;
  }
  const [row] = await db.insert(schema.mktSegments).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning();
  return row;
}

export async function deleteSegment(s: Scope, id: string) {
  requireWrite(s);
  if (!isId(id)) throw notFound("Segment");
  const [busy] = await db.select({ id: schema.mktCampaigns.id }).from(schema.mktCampaigns).where(and(eq(schema.mktCampaigns.segmentId, id), inArray(schema.mktCampaigns.status, ["scheduled", "sending"])));
  if (busy) throw new ApiError("conflict", "A campaign is sending to this segment");
  const [row] = await db.delete(schema.mktSegments).where(and(eq(schema.mktSegments.id, id), eq(schema.mktSegments.orgId, s.orgId))).returning();
  if (!row) throw notFound("Segment");
}

// ── Campaigns ───────────────────────────────────────────────────────────────

async function getCampaign(orgId: string, id: string) {
  if (!isId(id)) throw notFound("Campaign");
  const [c] = await db.select().from(schema.mktCampaigns).where(and(eq(schema.mktCampaigns.id, id), eq(schema.mktCampaigns.orgId, orgId)));
  if (!c) throw notFound("Campaign");
  return c;
}

export async function campaigns(s: Scope, q: { kind?: string; status?: string } = {}) {
  const rows = await db.select().from(schema.mktCampaigns).where(and(eq(schema.mktCampaigns.orgId, s.orgId), q.kind ? eq(schema.mktCampaigns.kind, q.kind) : undefined, q.status ? eq(schema.mktCampaigns.status, q.status) : undefined)).orderBy(desc(schema.mktCampaigns.createdAt)).limit(500);
  const results = await resultsFor(s, rows);
  return rows.map((c) => ({ ...publicCampaign(s, c), results: results.get(c.id) }));
}

const publicCampaign = (s: Scope, c: Campaign) => ({ ...c, budget: s.write ? c.budget : 0, spend: s.write ? c.spend : 0, regUrl: c.regToken ? appUrl(`/e/${c.regToken}`) : null });

async function uniqueSlug(orgId: string, base: string, selfId?: string) {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const [taken] = await db.select({ id: schema.mktCampaigns.id }).from(schema.mktCampaigns).where(and(eq(schema.mktCampaigns.orgId, orgId), eq(schema.mktCampaigns.slug, slug)));
    if (!taken || taken.id === selfId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function saveCampaign(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const v = check(campaignSchema, raw);
  if (v.segmentId) {
    const [seg] = await db.select({ id: schema.mktSegments.id }).from(schema.mktSegments).where(and(eq(schema.mktSegments.id, v.segmentId), eq(schema.mktSegments.orgId, s.orgId)));
    if (!seg) throw new ApiError("validation_failed", "That segment isn't in this workspace", { segmentId: ["Unknown segment"] });
  }
  if (v.startOn && v.endOn && v.endOn < v.startOn) throw new ApiError("validation_failed", "It ends before it starts", { endOn: ["Before the start"] });
  if (v.kind === "event") requirePart(s, "events");
  // Budgets and spend are for owners and admins; others keep what's there.
  const money = s.manage ? { budget: v.budget, spend: v.spend } : {};
  const fields = { ...v, eventAt: v.eventAt ? new Date(v.eventAt) : null };
  if (id) {
    const c = await getCampaign(s.orgId, id);
    if (["sending", "sent"].includes(c.status) && c.kind === "email" && (v.body !== c.body || v.subject !== c.subject || v.subjectB !== c.subjectB || v.segmentId !== c.segmentId)) throw new ApiError("conflict", "This email has gone out; its content and audience can't change");
    const slug = v.slug && v.slug !== c.slug ? await uniqueSlug(s.orgId, v.slug, c.id) : c.slug;
    const [row] = await db.update(schema.mktCampaigns).set({ ...fields, ...money, budget: s.manage ? v.budget : c.budget, spend: s.manage ? v.spend : c.spend, slug, kind: c.kind }).where(eq(schema.mktCampaigns.id, c.id)).returning();
    return publicCampaign(s, row);
  }
  const slug = await uniqueSlug(s.orgId, v.slug ?? slugify(v.name));
  const [row] = await db.insert(schema.mktCampaigns).values({ ...fields, ...money, budget: s.manage ? v.budget : 0, spend: s.manage ? v.spend : 0, slug, orgId: s.orgId, status: v.kind === "email" ? "draft" : "active", regToken: v.kind === "event" ? randomBytes(18).toString("base64url") : null, createdBy: s.userId }).returning();
  return publicCampaign(s, row);
}

export async function setStatus(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const c = await getCampaign(s.orgId, id);
  const { status } = check(z.object({ status: z.enum(["active", "ended", "cancelled", "draft"]) }), raw);
  if (c.kind === "email") {
    if (status !== "cancelled" || !["draft", "scheduled"].includes(c.status)) throw new ApiError("conflict", "An email is cancelled only before it starts sending");
  }
  await db.update(schema.mktCampaigns).set({ status }).where(eq(schema.mktCampaigns.id, c.id));
  return { status };
}

/** Tag a link for this campaign. */
export async function utmLink(s: Scope, id: string, raw: unknown) {
  const c = await getCampaign(s.orgId, id);
  const v = check(z.object({ url: z.url("Enter a full link, with https://").refine((u) => /^https?:\/\//i.test(u), "Use a web link"), medium: z.string().trim().min(1).max(40).default("social"), content: z.string().trim().max(60).default("") }), raw);
  return { url: utmUrl(v.url, { source: s.settings.utmSource, medium: v.medium, campaign: c.slug, content: v.content || undefined }) };
}

// ── Sending ─────────────────────────────────────────────────────────────────

const sendSchema = z.object({ at: z.iso.datetime({ offset: true }).nullable().default(null), test: z.email().optional() });

/** Send now, schedule, or send one test copy to yourself. Recipients are fixed when sending starts. */
export async function sendCampaign(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  requirePart(s, "email");
  const c = await getCampaign(s.orgId, id);
  if (c.kind !== "email") throw new ApiError("conflict", "Only email campaigns are sent");
  const v = check(sendSchema, raw);
  if (!c.subject.trim() || !c.body.trim()) throw new ApiError("validation_failed", "Write the subject and the email first");
  if (v.test) {
    const [me] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
    const org = await orgName(s.orgId);
    await sendMail({ to: v.test, subject: `[Test] ${c.subject}`, fromName: s.settings.fromName || org, replyTo: s.settings.replyTo || undefined, body: renderEmail(c.body, { name: me?.name ?? "", email: v.test, company: "" }, (i) => linksIn(c.body)[i], appUrl("/"), org) });
    return { test: true, emailed: mailConfigured() };
  }
  if (!["draft", "scheduled"].includes(c.status)) throw new ApiError("conflict", `This campaign is ${c.status}`);
  if (!c.segmentId) throw new ApiError("validation_failed", "Pick who it goes to", { segmentId: ["Pick a segment"] });
  if (v.at && new Date(v.at).getTime() > Date.now() + 60_000) {
    await db.update(schema.mktCampaigns).set({ status: "scheduled", scheduledAt: new Date(v.at) }).where(eq(schema.mktCampaigns.id, c.id));
    await enqueue("mkt.campaign.start", { campaignId: c.id }, { runAt: new Date(v.at), dedupeKey: `mkt-start:${c.id}:${v.at}`, orgId: s.orgId, maxAttempts: 3 });
    return { status: "scheduled", at: v.at };
  }
  const n = await start(c.id);
  await audit({ orgId: s.orgId, actorId: s.userId, action: "marketing.campaign_sent", targetType: "mkt_campaign", targetId: c.id, metadata: { recipients: n } });
  return { status: "sending", recipients: n, emailed: mailConfigured() };
}

/** Fix the recipients (the segment as it is now, those who may be emailed) and start the batches. */
async function start(campaignId: string) {
  const [c] = await db.select().from(schema.mktCampaigns).where(eq(schema.mktCampaigns.id, campaignId));
  if (!c || !["draft", "scheduled"].includes(c.status) || !c.segmentId) return 0;
  const [seg] = await db.select().from(schema.mktSegments).where(eq(schema.mktSegments.id, c.segmentId));
  if (!seg) return 0;
  const { mailable } = await members(c.orgId, rulesSchema.parse(seg.rules));
  // The plan's campaign emails this month, counted before anything is queued (the campaign stays a draft if it's over).
  await assertQuota(c.orgId, "campaignEmailsPerMonth", mailable.length);
  const [claimed] = await db.update(schema.mktCampaigns).set({ status: "sending", links: linksIn(c.body), sentAt: new Date() }).where(and(eq(schema.mktCampaigns.id, c.id), inArray(schema.mktCampaigns.status, ["draft", "scheduled"]))).returning({ id: schema.mktCampaigns.id });
  if (!claimed) return 0;
  const hasB = !!c.subjectB.trim();
  for (let i = 0; i < mailable.length; i += 500) {
    await db.insert(schema.mktSends).values(mailable.slice(i, i + 500).map((m) => ({ orgId: c.orgId, campaignId: c.id, contactId: m.id, email: m.email, variant: variantFor(m.id, c.id, hasB) }))).onConflictDoNothing();
  }
  await enqueue("mkt.campaign.batch", { campaignId: c.id }, { dedupeKey: `mkt-batch:${c.id}:0`, orgId: c.orgId, maxAttempts: 5 });
  return mailable.length;
}

async function orgName(orgId: string) {
  const [o] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return o?.name ?? "us";
}

function signKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update("marketing-links-v1").digest();
}
const sig = (s: string) => createHmac("sha256", signKey()).update(s).digest("base64url").slice(0, 16);
/** A tracked link: the send, which link in the email (or "u" for unsubscribe), and a signature. */
export const tokenFor = (sendId: string, what: string) => `${sendId}.${what}.${sig(`${sendId}.${what}`)}`;
export function readToken(token: string) {
  const [sendId, what, s] = token.split(".");
  if (!sendId || !what || !s || !isId(sendId) || !/^(u|\d{1,3})$/.test(what)) return null;
  const want = sig(`${sendId}.${what}`);
  return safeEqual(want, s) ? { sendId, what } : null;
}

/** One batch of a campaign: each queued recipient is checked again (still consenting) and sent their own copy. */
async function batch(campaignId: string) {
  const [c] = await db.select().from(schema.mktCampaigns).where(eq(schema.mktCampaigns.id, campaignId));
  if (!c || c.status !== "sending") return { done: true };
  const settings = await getSettings(c.orgId);
  const org = await orgName(c.orgId);
  const rows = await db.select({ s: schema.mktSends, c: schema.crmContacts, company: schema.crmCompanies.name }).from(schema.mktSends).innerJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.mktSends.contactId)).leftJoin(schema.crmCompanies, eq(schema.crmCompanies.id, schema.crmContacts.companyId)).where(and(eq(schema.mktSends.campaignId, c.id), eq(schema.mktSends.status, "queued"))).limit(BATCH);
  for (const { s: send, c: contact, company } of rows) {
    if (!contact.marketing || contact.doNotContact || !contact.email) {
      await db.update(schema.mktSends).set({ status: "skipped", reason: contact.doNotContact ? "Unsubscribed" : "No longer agrees to marketing" }).where(eq(schema.mktSends.id, send.id));
      continue;
    }
    try {
      const body = renderEmail(c.body, { name: contact.name, email: contact.email, company: company ?? "" }, (i) => appUrl(`/m/${tokenFor(send.id, String(i))}`), appUrl(`/m/${tokenFor(send.id, "u")}`), org);
      await sendMail({ to: contact.email, subject: send.variant === "B" && c.subjectB ? c.subjectB : c.subject, body, fromName: settings.fromName || org, replyTo: settings.replyTo || undefined });
      await db.update(schema.mktSends).set({ status: "sent", sentAt: new Date() }).where(eq(schema.mktSends.id, send.id));
      await db.insert(schema.mktTouches).values({ orgId: c.orgId, campaignId: c.id, contactId: contact.id, kind: "sent" });
    } catch (e) {
      await db.update(schema.mktSends).set({ status: "failed", reason: (e as Error).message.slice(0, 300) }).where(eq(schema.mktSends.id, send.id));
    }
  }
  const [{ left }] = await db.select({ left: sql<number>`count(*)::int` }).from(schema.mktSends).where(and(eq(schema.mktSends.campaignId, c.id), eq(schema.mktSends.status, "queued")));
  if (left > 0) {
    await enqueue("mkt.campaign.batch", { campaignId: c.id }, { dedupeKey: `mkt-batch:${c.id}:${Date.now()}`, orgId: c.orgId, maxAttempts: 5 });
    return { done: false, left };
  }
  await db.update(schema.mktCampaigns).set({ status: "sent" }).where(and(eq(schema.mktCampaigns.id, c.id), eq(schema.mktCampaigns.status, "sending")));
  log.info("mkt_campaign_sent", { campaignId: c.id });
  return { done: true };
}

defineJob<{ campaignId: string }>("mkt.campaign.start", ({ campaignId }) => start(campaignId), { timeoutMs: 120_000 });
defineJob<{ campaignId: string }>("mkt.campaign.batch", ({ campaignId }) => batch(campaignId), { timeoutMs: 120_000 });

/** For tests and the "send now" path in development: run a campaign's batches until it's sent. */
export async function drain(campaignId: string) {
  for (let i = 0; i < 10_000; i++) if ((await batch(campaignId)).done) return;
}

// ── Tracked links (public) ──────────────────────────────────────────────────

/** A click: recorded against the person and the campaign, then on to the real link (only links that were in the email). */
export async function click(token: string) {
  const t = readToken(token);
  if (!t || t.what === "u") return null;
  const [row] = await db.select({ s: schema.mktSends, c: schema.mktCampaigns }).from(schema.mktSends).innerJoin(schema.mktCampaigns, eq(schema.mktCampaigns.id, schema.mktSends.campaignId)).where(eq(schema.mktSends.id, t.sendId));
  const url = row?.c.links[Number(t.what)];
  if (!row || !url) return null;
  await db.insert(schema.mktClicks).values({ sendId: row.s.id, campaignId: row.c.id, url });
  await db.update(schema.mktSends).set({ clicks: sql`${schema.mktSends.clicks} + 1`, firstClickAt: row.s.firstClickAt ?? new Date() }).where(eq(schema.mktSends.id, row.s.id));
  if (!row.s.firstClickAt) {
    await db.insert(schema.mktTouches).values({ orgId: row.c.orgId, campaignId: row.c.id, contactId: row.s.contactId, kind: "clicked" });
    await addEvent(row.c.orgId, { subject: `Clicked a link in “${row.c.name}”`, body: url, contactId: row.s.contactId, meta: { campaign: row.c.id } }).catch(() => {});
  }
  return url;
}

export function validUnsubscribe(token: string) {
  const t = readToken(token);
  return !!t && t.what === "u";
}

/** Unsubscribe from everything this business sends, across the CRM. */
export async function unsubscribeSend(token: string) {
  const t = readToken(token);
  if (!t || t.what !== "u") return false;
  const [send] = await db.select().from(schema.mktSends).where(eq(schema.mktSends.id, t.sendId));
  if (!send) return false;
  await db.update(schema.mktSends).set({ unsubscribedAt: send.unsubscribedAt ?? new Date() }).where(eq(schema.mktSends.id, send.id));
  await db.update(schema.crmContacts).set({ doNotContact: true, marketing: false, updatedAt: new Date() }).where(eq(schema.crmContacts.id, send.contactId));
  await db.update(schema.crmEnrollments).set({ status: "stopped", stopReason: "Unsubscribed", nextAt: null }).where(and(eq(schema.crmEnrollments.contactId, send.contactId), eq(schema.crmEnrollments.status, "active")));
  await addEvent(send.orgId, { subject: "Unsubscribed from email", contactId: send.contactId, meta: { campaign: send.campaignId } }).catch(() => {});
  return true;
}

// ── Events ──────────────────────────────────────────────────────────────────

export async function registrations(s: Scope, id: string) {
  requirePart(s, "events");
  const c = await getCampaign(s.orgId, id);
  return db.select().from(schema.mktRegistrations).where(eq(schema.mktRegistrations.campaignId, c.id)).orderBy(asc(schema.mktRegistrations.createdAt));
}

export async function eventByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await db.select({ c: schema.mktCampaigns, modules: schema.organizations.modules, partsOff: schema.organizations.partsOff, org: schema.organizations.name }).from(schema.mktCampaigns).innerJoin(schema.organizations, eq(schema.organizations.id, schema.mktCampaigns.orgId)).where(eq(schema.mktCampaigns.regToken, token));
  if (!row || row.c.kind !== "event" || !isOn(row.modules, "marketing") || !isPartOn(row.partsOff as PartsOff, "marketing", "events")) return null;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.mktRegistrations).where(and(eq(schema.mktRegistrations.campaignId, row.c.id), sql`${schema.mktRegistrations.status} <> 'cancelled'`));
  return { campaign: row.c, org: row.org, taken: n, open: row.c.status === "active" && (!row.c.eventAt || row.c.eventAt.getTime() > Date.now()) && (!row.c.capacity || n < row.c.capacity) };
}

const regSchema = z.object({ name: z.string().trim().min(1, "Your name").max(120), email: z.email("Your email"), phone: z.string().trim().max(30).default(""), consent: z.boolean().default(false) });

/** A registration from the public page: the person becomes (or updates) a CRM contact, and gets a confirmation. */
export async function register(token: string, raw: unknown) {
  const ev = await eventByToken(token);
  if (!ev) throw notFound("Event");
  if (!ev.open) throw new ApiError("conflict", ev.campaign.capacity && ev.taken >= ev.campaign.capacity ? "This event is full" : "Registration is closed");
  const v = check(regSchema, raw);
  const c = ev.campaign;
  const [existing] = await db.select().from(schema.mktRegistrations).where(and(eq(schema.mktRegistrations.campaignId, c.id), eq(schema.mktRegistrations.email, v.email.toLowerCase())));
  if (existing && existing.status !== "cancelled") return { already: true };
  const contact = await capture(c.orgId, "web", { name: v.name, email: v.email, phone: v.phone }, { source: "event", event: { subject: `Registered for ${c.name}` } }).catch(() => null);
  if (contact && v.consent) await db.update(schema.crmContacts).set({ marketing: true }).where(and(eq(schema.crmContacts.id, contact.id), eq(schema.crmContacts.doNotContact, false)));
  if (existing) await db.update(schema.mktRegistrations).set({ status: "registered", name: v.name, phone: v.phone, contactId: contact?.id ?? existing.contactId }).where(eq(schema.mktRegistrations.id, existing.id));
  else await db.insert(schema.mktRegistrations).values({ orgId: c.orgId, campaignId: c.id, contactId: contact?.id ?? null, name: v.name, email: v.email.toLowerCase(), phone: v.phone });
  if (contact) await db.insert(schema.mktTouches).values({ orgId: c.orgId, campaignId: c.id, contactId: contact.id, kind: "registered" });
  const when = c.eventAt ? c.eventAt.toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
  await sendMail({ to: v.email, subject: `You're registered: ${c.name}`, fromName: ev.org, body: `Hello ${v.name},\n\nYou're registered for ${c.name}.${when ? `\nWhen: ${when}` : ""}${c.venue ? `\nWhere: ${c.venue}` : ""}${c.onlineUrl ? `\nJoin online: ${c.onlineUrl}` : ""}\n\nSee you there,\n${ev.org}` }).catch(() => {});
  return { registered: true };
}

/** Check someone in on the day (or undo it). */
export async function attend(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  requirePart(s, "events");
  const c = await getCampaign(s.orgId, id);
  const { registrationId, attended } = check(z.object({ registrationId: z.uuid(), attended: z.boolean() }), raw);
  const [r] = await db.update(schema.mktRegistrations).set({ status: attended ? "attended" : "registered", attendedAt: attended ? new Date() : null }).where(and(eq(schema.mktRegistrations.id, registrationId), eq(schema.mktRegistrations.campaignId, c.id))).returning();
  if (!r) throw notFound("Registration");
  if (attended && r.contactId) {
    await db.insert(schema.mktTouches).values({ orgId: c.orgId, campaignId: c.id, contactId: r.contactId, kind: "attended" });
    await addEvent(c.orgId, { subject: `Attended ${c.name}`, contactId: r.contactId, meta: { campaign: c.id } }).catch(() => {});
  }
  return r;
}

// ── Forms with a campaign (utm_campaign) ────────────────────────────────────

/** A web-to-lead form carrying utm_campaign credits that campaign. */
export async function formTouch(orgId: string, contactId: string, utmCampaign: string) {
  const slug = utmCampaign.trim().toLowerCase();
  if (!slug) return;
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "marketing")) return;
  const [c] = await db.select({ id: schema.mktCampaigns.id }).from(schema.mktCampaigns).where(and(eq(schema.mktCampaigns.orgId, orgId), eq(schema.mktCampaigns.slug, slug)));
  if (c) await db.insert(schema.mktTouches).values({ orgId, campaignId: c.id, contactId, kind: "form" });
}

// ── Results ─────────────────────────────────────────────────────────────────

/** Won deals attributed to campaigns, with reach. */
async function resultsFor(s: Scope, rows: Campaign[]) {
  const out = new Map<string, { reached: number; email: ReturnType<typeof emailStats> | null; registered: number; attended: number; deals: number; firstValue: number; lastValue: number; linearValue: number; roi: number | null }>();
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const [sends, regs, touches, deals] = await Promise.all([
    db.select({ campaignId: schema.mktSends.campaignId, variant: schema.mktSends.variant, status: schema.mktSends.status, clicks: schema.mktSends.clicks, unsubscribedAt: schema.mktSends.unsubscribedAt }).from(schema.mktSends).where(inArray(schema.mktSends.campaignId, ids)),
    db.select({ campaignId: schema.mktRegistrations.campaignId, status: schema.mktRegistrations.status }).from(schema.mktRegistrations).where(inArray(schema.mktRegistrations.campaignId, ids)),
    db.select({ campaignId: schema.mktTouches.campaignId, contactId: schema.mktTouches.contactId, at: schema.mktTouches.at }).from(schema.mktTouches).where(eq(schema.mktTouches.orgId, s.orgId)),
    db.select({ id: schema.crmDeals.id, contactId: schema.crmDeals.contactId, value: schema.crmDeals.value, closedAt: schema.crmDeals.closedAt }).from(schema.crmDeals).where(and(eq(schema.crmDeals.orgId, s.orgId), eq(schema.crmDeals.status, "won"), sql`${schema.crmDeals.closedAt} is not null`)),
  ]);
  const credit = attribute(touches, deals.map((d) => ({ ...d, value: Number(d.value), closedAt: d.closedAt! })), s.settings.attributionDays);
  for (const c of rows) {
    const mine = sends.filter((x) => x.campaignId === c.id);
    const r = regs.filter((x) => x.campaignId === c.id);
    const a = credit.get(c.id) ?? { deals: 0, firstValue: 0, lastValue: 0, linearValue: 0 };
    out.set(c.id, { reached: new Set(touches.filter((t) => t.campaignId === c.id).map((t) => t.contactId)).size, email: c.kind === "email" ? emailStats(mine) : null, registered: r.filter((x) => x.status !== "cancelled").length, attended: r.filter((x) => x.status === "attended").length, ...a, roi: roi(a.linearValue, Number(c.spend)) });
  }
  return out;
}

export async function campaignDetail(s: Scope, id: string) {
  const c = await getCampaign(s.orgId, id);
  const [results, links, seg] = await Promise.all([
    resultsFor(s, [c]),
    db.select({ url: schema.mktClicks.url, clicks: sql<number>`count(*)::int`, people: sql<number>`count(distinct ${schema.mktClicks.sendId})::int` }).from(schema.mktClicks).where(eq(schema.mktClicks.campaignId, c.id)).groupBy(schema.mktClicks.url).orderBy(desc(sql`count(*)`)),
    c.segmentId ? db.select().from(schema.mktSegments).where(eq(schema.mktSegments.id, c.segmentId)) : Promise.resolve([]),
  ]);
  const audienceNow = seg[0] && ["draft", "scheduled"].includes(c.status) ? (await members(s.orgId, rulesSchema.parse(seg[0].rules))).mailable.length : null;
  return { campaign: publicCampaign(s, c), results: results.get(c.id), links, segment: seg[0] ? { id: seg[0].id, name: seg[0].name } : null, audienceNow, mailConfigured: mailConfigured() };
}

export async function home(s: Scope) {
  const list = await campaigns(s);
  const live = list.filter((c) => !["cancelled", "draft"].includes(c.status));
  const sum = (k: "firstValue" | "lastValue" | "linearValue" | "deals") => live.reduce((n, c) => n + (c.results?.[k] ?? 0), 0);
  return {
    counts: { campaigns: live.length, drafts: list.filter((c) => c.status === "draft").length, sending: list.filter((c) => c.status === "sending" || c.status === "scheduled").length, events: list.filter((c) => c.kind === "event" && c.status === "active").length },
    spend: s.write ? live.reduce((n, c) => n + Number(c.spend), 0) : 0,
    influenced: { deals: sum("deals"), value: sum("linearValue") },
    recent: list.slice(0, 8),
    upcomingEvents: list.filter((c) => c.kind === "event" && c.status === "active" && c.eventAt && new Date(c.eventAt).getTime() > Date.now()).sort((a, b) => new Date(a.eventAt!).getTime() - new Date(b.eventAt!).getTime()).slice(0, 5),
  };
}

