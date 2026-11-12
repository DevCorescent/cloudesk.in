// Outreach for platform admins: contacts, templates, funnels and broadcasts,
// the engine that sends them, and the tracking that follows each email to a
// sign-up and a paid plan. See lib/outreach/model.ts for the rules.
//
// Every email carries an unsubscribe link and a one-click List-Unsubscribe
// header; unsubscribes, bounces and complaints are never emailed again; and
// nothing goes out while the master switch is off or without a postal address.
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { freeFor } from "@/lib/festive";
import { BUILT_IN, BUILT_IN_FUNNELS, MAILBOX_DAILY_CAP, TEMPLATE_CATEGORIES, checkAddress, checkSteps, classifyHit, probBest, spamCheck, contactInput, INDUSTRIES, funnelInput, importSchema, industryOf, merge, nextSlot, parsePasted, pickArm, renderEmail, scoreOf, settingsInput, stageFromScore, STAGES, templateInput, warmupCap, type Audience, type ContactInput, type OutreachSettings, type Stage, type Step } from "@/lib/outreach/model";
import { ApiError, notFound } from "../http/errors";
import { safeEqual } from "../security/tokens";
import { log } from "../log";
import { liveCreds } from "../mail/accounts";
import { compose, explain, newMessageId, transport } from "../mail/transport";
import { appUrl, mailFromDomain, mailProvider, MAIL_PROVIDER_NAMES, sendMail, type MailMessage } from "../services/mail";

const C = schema.poContacts;
const T = schema.poTemplates;
const F = schema.poFunnels;
const E = schema.poEnrollments;
const S = schema.poSends;
const V = schema.poEvents;
const isId = (x: string | undefined) => !!x && /^[0-9a-f-]{36}$/i.test(x);
const IST = 19_800_000;
const istMidnight = (now = Date.now()) => {
  const l = new Date(now + IST);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - IST);
};
const istHour = (d = new Date()) => new Date(d.getTime() + IST).getUTCHours();
const STAGE_RANK: Record<Stage, number> = { new: 0, engaged: 1, hot: 2, lost: 0, signed_up: 3, trial: 4, paying: 5 };

function check<Z extends z.ZodType>(schema: Z, raw: unknown): z.infer<Z> {
  const v = schema.safeParse(raw);
  if (!v.success) throw new ApiError("validation_failed", v.error.issues[0]?.message ?? "Check the details", Object.fromEntries(v.error.issues.map((i) => [i.path.join(".") || "input", [i.message]])));
  return v.data;
}

const event = (kind: string, detail: Record<string, unknown> = {}, ids: { contactId?: string | null; sendId?: string | null; funnelId?: string | null } = {}) => db.insert(V).values({ kind, detail, contactId: ids.contactId ?? null, sendId: ids.sendId ?? null, funnelId: ids.funnelId ?? null });

// ── Settings ────────────────────────────────────────────────────────────────

/** Kept beside the settings, never edited directly: whose AI allowance the engine uses, and when it last ran its daily jobs. */
type Internal = { startedAt: string | null; aiOrgId: string | null; aiUserId: string | null; lastDailyAt: string | null };

export async function getSettings(): Promise<OutreachSettings & Internal> {
  const [row] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, "outreach"));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
  return { ...settingsInput.parse(v), startedAt: str("startedAt"), aiOrgId: str("aiOrgId"), aiUserId: str("aiUserId"), lastDailyAt: str("lastDailyAt") };
}

async function setInternal(patch: Partial<Internal>) {
  const [row] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, "outreach"));
  const value = { ...((row?.value ?? {}) as Record<string, unknown>), ...patch };
  await db.insert(schema.platformSettings).values({ key: "outreach", value }).onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedAt: new Date() } });
}

/** Tells the admin straight away (a reply, a sign-up). Never throws. */
async function alert(subject: string, body: string) {
  const st = await getSettings();
  if (!st.alerts) return;
  const to = st.alertEmail || (st.aiUserId ? (await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, st.aiUserId)))[0]?.email : "");
  if (!to) return;
  await sendMail({ to, subject: `Outreach: ${subject}`, body: `${body}\n\nSee it in Platform admin → Outreach: ${appUrl("/admin#outreach")}` }).catch(() => {});
}

export async function saveSettings(adminId: string, raw: unknown) {
  const v = check(settingsInput, raw);
  if (v.sending && !v.postalAddress) throw new ApiError("validation_failed", "Add your business's postal address first — the law asks for it in every promotional email", { postalAddress: ["Required to send"] });
  if (v.windowEnd <= v.windowStart) throw new ApiError("validation_failed", "The sending window must end after it starts");
  if (v.via === "mailbox") {
    if (!v.accountId) throw new ApiError("validation_failed", "Pick the Cloudesk Mail mailbox to send from", { accountId: ["Pick a mailbox"] });
    const [a] = await db.select({ id: schema.mailAccounts.id }).from(schema.mailAccounts).where(and(eq(schema.mailAccounts.id, v.accountId), eq(schema.mailAccounts.ownerId, adminId)));
    if (!a) throw new ApiError("validation_failed", "That mailbox isn't one of yours in Cloudesk Mail", { accountId: ["Not your mailbox"] });
  } else {
    const domain = mailFromDomain();
    if (v.fromEmail && domain && v.fromEmail.split("@")[1]?.toLowerCase() !== domain) throw new ApiError("validation_failed", `The From address must be on ${domain} — the domain your email service has verified`, { fromEmail: [`Use an address @${domain}`] });
    if (v.sending && mailProvider() === "outbox" && process.env.NODE_ENV === "production") throw new ApiError("validation_failed", "No email service is set up, so nothing would be delivered. Add one in Admin → Integrations, or send through a Cloudesk Mail mailbox.");
  }
  const cur = await getSettings();
  // The engine's AI (new subject lines) runs on the admin's own workspace allowance.
  const [m] = await db.select({ orgId: schema.memberships.orgId }).from(schema.memberships).where(eq(schema.memberships.userId, adminId)).limit(1);
  const value = { ...v, startedAt: v.sending ? (cur.startedAt ?? new Date().toISOString()) : cur.startedAt, aiOrgId: m?.orgId ?? cur.aiOrgId, aiUserId: adminId, lastDailyAt: cur.lastDailyAt };
  await db.insert(schema.platformSettings).values({ key: "outreach", value, updatedBy: adminId }).onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedBy: adminId, updatedAt: new Date() } });
  if (v.sending !== cur.sending) await event("engine", { text: v.sending ? "Sending switched on" : "Sending switched off", by: adminId });
  return getSettings();
}

/** The admin's own Cloudesk Mail mailboxes, any of which can send outreach. */
export async function mailboxes(adminId: string) {
  return db
    .select({ id: schema.mailAccounts.id, address: schema.mailAccounts.address, name: schema.mailAccounts.displayName, provider: schema.mailAccounts.provider, status: schema.mailAccounts.status })
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.ownerId, adminId))
    .orderBy(asc(schema.mailAccounts.address));
}

/** Where outreach mail comes from right now. */
export async function senderOf(st: OutreachSettings) {
  if (st.via === "mailbox" && st.accountId) {
    const [a] = await db.select().from(schema.mailAccounts).where(eq(schema.mailAccounts.id, st.accountId));
    return { via: "mailbox" as const, address: a?.address ?? "", account: a ?? null, ready: !!a && a.status !== "error", service: a ? `Cloudesk Mail · ${a.address}` : "Cloudesk Mail (mailbox missing)" };
  }
  const provider = mailProvider();
  return { via: "platform" as const, address: st.fromEmail || /[^\s<>"]+@[^\s<>"]+/.exec(process.env.MAIL_FROM ?? "")?.[0] || "", account: null, ready: provider !== "outbox", service: MAIL_PROVIDER_NAMES[provider] };
}

const LOGO = () => ({ src: appUrl("/brand/cloudesk-email.png"), href: appUrl("/") });

type Delivery = { ok: true } | { ok: false; error: string; bounced: boolean };
const BOUNCE = /(no such|does not exist|unknown user|user unknown|recipient.*(rejected|invalid)|invalid recipient|mailbox (unavailable|not found)|address rejected|5\.1\.[0-9]|550[ -]|553[ -])/i;

/** Sends one outreach email through the platform service or the chosen mailbox. */
async function deliverOutreach(st: OutreachSettings, msg: MailMessage): Promise<Delivery> {
  if (st.via === "mailbox" && st.accountId) {
    const [acc] = await db.select().from(schema.mailAccounts).where(eq(schema.mailAccounts.id, st.accountId));
    if (!acc) return { ok: false, error: "The Cloudesk Mail mailbox chosen in Outreach settings is gone", bounced: false };
    try {
      const creds = await liveCreds(acc);
      const raw = await compose({ messageId: newMessageId(acc.address), from: { name: st.fromName, address: acc.address }, to: msg.to, subject: msg.subject, text: msg.body, html: msg.html, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}), headers: msg.headers ?? {} });
      await transport().send(creds, { from: acc.address, to: [msg.to] }, raw);
      return { ok: true };
    } catch (e) {
      const said = `${(e as { response?: string }).response ?? ""} ${(e as Error).message ?? ""}`;
      return { ok: false, error: BOUNCE.test(said) ? said.trim().slice(0, 300) : explain(e, "smtp"), bounced: BOUNCE.test(said) };
    }
  }
  const outboxId = await sendMail({ ...msg, ...(st.fromEmail ? { fromEmail: st.fromEmail } : {}) });
  const [ob] = await db.select({ status: schema.outboundEmails.status, error: schema.outboundEmails.error }).from(schema.outboundEmails).where(eq(schema.outboundEmails.id, outboxId));
  if (ob?.status !== "failed") return { ok: true };
  return { ok: false, error: ob.error ?? "", bounced: BOUNCE.test(ob.error ?? "") };
}

/** The built-in templates and funnels, added once (and any added to the library since). */
export async function ensureBuiltIns() {
  const have = new Set((await db.select({ key: T.key }).from(T)).map((r) => r.key));
  const missing = BUILT_IN.filter((t) => !have.has(t.key));
  if (missing.length) await db.insert(T).values(missing.map((t) => ({ key: t.key, name: t.name, category: t.category, industries: t.industries, subjects: t.subjects, preheader: t.preheader, body: t.body, ctaLabel: t.ctaLabel, ctaUrl: t.ctaUrl })));
  const haveF = new Set((await db.select({ key: F.key }).from(F)).map((r) => r.key));
  const missingF = BUILT_IN_FUNNELS.filter((f) => !haveF.has(f.key));
  if (missingF.length) await db.insert(F).values(missingF.map((f) => ({ key: f.key, name: f.name, kind: f.kind, status: "paused", audience: f.audience, steps: f.steps, goal: f.goal, autoEnroll: f.autoEnroll, autoOptimize: f.autoOptimize, priority: f.priority ?? 0, holdoutPct: f.holdoutPct ?? 0 })));
  // Built-in funnels nobody has started yet follow the latest version of the playbook.
  const unused = (await db.execute(sql`select f.id, f.key from po_funnels f where f.key is not null and f.status = 'paused' and f.updated_at = f.created_at and not exists (select 1 from po_enrollments e where e.funnel_id = f.id)`)) as unknown as { rows: { id: string; key: string }[] };
  for (const u of unused.rows) {
    const f = BUILT_IN_FUNNELS.find((x) => x.key === u.key);
    if (f) await db.update(F).set({ name: f.name, audience: f.audience, steps: f.steps, goal: f.goal, priority: f.priority ?? 0, holdoutPct: f.holdoutPct ?? 0 }).where(eq(F.id, u.id));
  }
}

// ── Contacts ────────────────────────────────────────────────────────────────

/** One of the known industries: as given when it's one of them, else guessed from the words (industry, company, title). */
const pickIndustry = (given: string, words = "") => ((INDUSTRIES as readonly string[]).includes(given.toLowerCase()) ? given.toLowerCase() : industryOf(`${given} ${words}`));

const FIELD_KEYS = new Set(["email", "name", "first_name", "last_name", "company", "title", "phone", "city", "state", "industry", "size", "website", "tags", "notes"]);

/** Imported rows (from the smart importer) as contacts; new ones are added, existing ones filled in where blank. */
export async function importContacts(raw: unknown) {
  const v = check(importSchema, raw);
  let created = 0;
  let updated = 0;
  const errors: { row: number; message: string }[] = [];
  const rows: (ContactInput & { data: Record<string, string>; verify: string; verifyNote: string })[] = [];
  v.rows.forEach((r, i) => {
    const s = (k: string) => (r[k] === null || r[k] === undefined ? "" : String(r[k]).trim());
    const name = s("name") || [s("first_name"), s("last_name")].filter(Boolean).join(" ");
    const data = Object.fromEntries(Object.entries(r).filter(([k, x]) => !FIELD_KEYS.has(k) && x !== null && x !== undefined && String(x).trim()).map(([k, x]) => [k.slice(0, 40), String(x).slice(0, 500)]));
    const p = contactInput.safeParse({ email: s("email"), name, company: s("company"), title: s("title"), phone: s("phone"), city: s("city"), state: s("state"), industry: s("industry"), size: s("size"), website: s("website"), tags: [...new Set([...s("tags").split(/[,;|]/).map((x) => x.trim()).filter(Boolean), ...v.tags])].slice(0, 20), notes: s("notes") });
    if (!p.success) errors.push({ row: i + 1, message: s("email") ? `“${s("email")}” isn't a valid email` : "No email" });
    else {
      const chk = checkAddress(p.data.email);
      rows.push({ ...p.data, email: chk.email, data, verify: chk.verify, verifyNote: chk.note });
    }
  });
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const existing = new Map((await db.select({ id: C.id, email: C.email }).from(C).where(inArray(sql`lower(${C.email})`, chunk.map((c) => c.email)))).map((x) => [x.email.toLowerCase(), x.id]));
    const fresh = chunk.filter((c) => !existing.has(c.email));
    const seen = new Set<string>();
    const unique = fresh.filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true)));
    if (unique.length) {
      await db.insert(C).values(unique.map((c) => ({ ...c, industry: pickIndustry(c.industry, `${c.company} ${c.title} ${c.notes}`), source: v.source, consent: v.consent }))).onConflictDoNothing();
      created += unique.length;
    }
    if (v.update) {
      for (const c of chunk.filter((x) => existing.has(x.email))) {
        // Only fills blanks and adds tags: what's already known is never overwritten by an import.
        await db.execute(sql`update po_contacts set
          name = case when name = '' then ${c.name} else name end,
          company = case when company = '' then ${c.company} else company end,
          title = case when title = '' then ${c.title} else title end,
          phone = case when phone = '' then ${c.phone} else phone end,
          city = case when city = '' then ${c.city} else city end,
          state = case when state = '' then ${c.state} else state end,
          website = case when website = '' then ${c.website} else website end,
          tags = (select coalesce(array_agg(distinct t), '{}') from unnest(tags || array(select jsonb_array_elements_text(${JSON.stringify(c.tags)}::jsonb))) t),
          data = ${JSON.stringify(c.data)}::jsonb || data,
          updated_at = now()
          where id = ${existing.get(c.email)!}`);
        updated++;
      }
    }
  }
  await event("import", { source: v.source, created, updated, skipped: errors.length });
  return { created, updated, skipped: errors.length, errors: errors.slice(0, 50) };
}

/** Pasted text: every email address in it, with a name and company where the line has them. */
export async function pasteContacts(raw: unknown) {
  const v = check(importSchema.omit({ rows: true }).extend({ text: z.string().min(3).max(500_000) }), raw);
  const found = parsePasted(v.text);
  if (!found.length) throw new ApiError("validation_failed", "No email addresses in that text");
  return importContacts({ rows: found as unknown as Record<string, unknown>[], source: v.source, consent: v.consent, tags: v.tags, update: v.update });
}

function audienceWhere(a: Audience): SQL {
  const parts: SQL[] = [eq(C.status, "active"), ne(C.verify, "invalid")];
  if (a.stages.length) parts.push(inArray(C.stage, a.stages));
  if (a.industries.length) parts.push(inArray(C.industry, a.industries));
  if (a.tags.length) parts.push(sql`${C.tags} && ${a.tags}::text[]`);
  if (a.sources.length) parts.push(inArray(C.source, a.sources));
  if (a.minScore !== null) parts.push(gte(C.score, a.minScore));
  return and(...parts)!;
}

export async function contacts(q: { q?: string; stage?: string; status?: string; industry?: string; source?: string; verify?: string; page?: string }) {
  const where: SQL[] = [];
  if (q.q?.trim()) {
    const t = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(C.email, t), ilike(C.name, t), ilike(C.company, t))!);
  }
  if (q.stage && (STAGES as readonly string[]).includes(q.stage)) where.push(eq(C.stage, q.stage));
  if (q.status) where.push(eq(C.status, q.status));
  if (q.industry) where.push(eq(C.industry, q.industry));
  if (q.source) where.push(eq(C.source, q.source));
  if (q.verify && ["valid", "risky", "invalid", "unknown"].includes(q.verify)) where.push(eq(C.verify, q.verify));
  const page = Math.max(0, Number(q.page) || 0);
  const w = where.length ? and(...where) : undefined;
  const [rows, [{ n }], sources] = await Promise.all([
    db.select().from(C).where(w).orderBy(desc(C.score), desc(C.createdAt)).limit(100).offset(page * 100),
    db.select({ n: count() }).from(C).where(w),
    db.selectDistinct({ source: C.source }).from(C).orderBy(asc(C.source)).limit(100),
  ]);
  return { contacts: rows, total: n, sources: sources.map((s) => s.source).filter(Boolean) };
}

export async function contactDetail(id: string) {
  if (!isId(id)) throw notFound("Contact");
  const [c] = await db.select().from(C).where(eq(C.id, id));
  if (!c) throw notFound("Contact");
  const [sends, events, enrollments] = await Promise.all([
    db.select({ id: S.id, subject: S.subject, status: S.status, opens: S.opens, clicks: S.clicks, openedAt: S.openedAt, clickedAt: S.clickedAt, convertedAt: S.convertedAt, sentAt: S.sentAt, funnel: F.name }).from(S).leftJoin(F, eq(F.id, S.funnelId)).where(eq(S.contactId, id)).orderBy(desc(S.sentAt)).limit(50),
    db.select().from(V).where(eq(V.contactId, id)).orderBy(desc(V.createdAt)).limit(100),
    db.select({ id: E.id, status: E.status, stepId: E.stepId, nextAt: E.nextAt, exitReason: E.exitReason, funnel: F.name, funnelId: F.id }).from(E).innerJoin(F, eq(F.id, E.funnelId)).where(eq(E.contactId, id)),
  ]);
  return { contact: c, sends, events, enrollments };
}

export async function updateContact(id: string, raw: unknown) {
  if (!isId(id)) throw notFound("Contact");
  const v = check(contactInput.partial().extend({ status: z.enum(["active", "suppressed"]).optional() }), raw);
  const [c] = await db.update(C).set({ ...v, ...(v.industry !== undefined ? { industry: pickIndustry(v.industry) } : {}), updatedAt: new Date() }).where(eq(C.id, id)).returning();
  if (!c) throw notFound("Contact");
  if (v.status === "suppressed") await db.update(E).set({ status: "exited", exitReason: "suppressed", updatedAt: new Date() }).where(and(eq(E.contactId, id), eq(E.status, "active")));
  return c;
}

export async function deleteContacts(raw: unknown) {
  const v = check(z.object({ ids: z.array(z.uuid()).min(1).max(5000) }), raw);
  const r = await db.delete(C).where(inArray(C.id, v.ids)).returning({ id: C.id });
  return { deleted: r.length };
}

// ── Templates ───────────────────────────────────────────────────────────────

type Arm = { sends: number; opens: number; clicks: number; conversions: number };
async function armStats(where?: SQL) {
  return db
    .select({ templateId: S.templateId, variant: S.variant, industry: S.industry, sends: sql<number>`count(*)::int`, opens: sql<number>`count(*) filter (where ${S.opens} > 0)::int`, clicks: sql<number>`count(*) filter (where ${S.clicks} > 0)::int`, conversions: sql<number>`count(*) filter (where ${S.convertedAt} is not null)::int` })
    .from(S)
    // Second tries go to people who ignored the first, so they'd skew which subject line looks best.
    .where(where ? and(where, eq(S.resend, false)) : eq(S.resend, false))
    .groupBy(S.templateId, S.variant, S.industry);
}
const sum = (rows: Arm[]): Arm => rows.reduce((a, r) => ({ sends: a.sends + r.sends, opens: a.opens + r.opens, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions }), { sends: 0, opens: 0, clicks: 0, conversions: 0 });

export async function templates() {
  await ensureBuiltIns();
  const [list, stats, links] = await Promise.all([
    db.select().from(T).where(eq(T.archived, false)).orderBy(asc(T.category), asc(T.name)),
    armStats(),
    db.execute(sql`select s.template_id, v.detail->>'url' as url, count(*)::int as n from po_events v join po_sends s on s.id = v.send_id where v.kind = 'click' group by 1, 2 order by 3 desc`) as unknown as Promise<{ rows: { template_id: string; url: string; n: number }[] }>,
  ]);
  return {
    templates: list.map((t) => {
      const mine = stats.filter((s) => s.templateId === t.id);
      return { ...t, stats: sum(mine), links: links.rows.filter((l) => l.template_id === t.id).slice(0, 4).map((l) => ({ url: l.url, clicks: l.n })), variants: t.subjects.map((subject, i) => ({ subject, ...sum(mine.filter((s) => s.variant === i)) })) };
    }),
  };
}

export async function saveTemplate(id: string | null, raw: unknown) {
  const v = check(templateInput, raw);
  if (id) {
    if (!isId(id)) throw notFound("Template");
    const [t] = await db.update(T).set({ ...v, updatedAt: new Date() }).where(eq(T.id, id)).returning();
    if (!t) throw notFound("Template");
    return t;
  }
  const [t] = await db.insert(T).values(v).returning();
  return t!;
}

export async function archiveTemplate(id: string) {
  if (!isId(id)) throw notFound("Template");
  await db.update(T).set({ archived: true, updatedAt: new Date() }).where(eq(T.id, id));
  return { ok: true };
}

const sample = { email: "asha@raotraders.in", name: "Asha Rao", company: "Rao Traders", city: "Pune", industry: "retail", title: "Founder", data: {} };

/** The email as it will look, for a template (saved or being edited) and a contact (or a sample one). */
export async function preview(raw: unknown) {
  const v = check(z.object({ template: templateInput, contactId: z.uuid().nullable().default(null), variant: z.number().int().min(0).max(3).default(0) }), raw);
  const st = await getSettings();
  const [c] = v.contactId ? await db.select().from(C).where(eq(C.id, v.contactId)) : [];
  const who = c ?? sample;
  const extra = { trial: freeFor() };
  const out = renderEmail({ body: merge(v.template.body, who, extra), preheader: merge(v.template.preheader, who, extra), ctaLabel: v.template.ctaLabel, ctaUrl: v.template.ctaUrl, link: (u) => u, pixel: "", unsubscribe: appUrl("/po/u/preview"), fromName: st.fromName, postalAddress: st.postalAddress || "[Your postal address — add it in Settings]", reason: reasonFor(c?.consent ?? "legitimate_interest", c?.source ?? ""), logo: LOGO() });
  return { subject: merge(v.template.subjects[Math.min(v.variant, v.template.subjects.length - 1)]!, who, extra), html: out.html, text: out.text, to: who.email };
}

/** A whole template from a brief, written by AI on the admin's workspace allowance; returned for review, not saved. */
export async function writeTemplate(adminId: string, raw: unknown) {
  const v = check(z.object({ brief: z.string().trim().min(5).max(2000), category: z.enum(TEMPLATE_CATEGORIES).default("intro"), industry: z.string().max(40).default("") }), raw);
  const [m] = await db.select({ orgId: schema.memberships.orgId }).from(schema.memberships).where(eq(schema.memberships.userId, adminId)).limit(1);
  if (!m) throw new ApiError("conflict", "AI writing uses your own workspace's AI connection — you're not in a workspace.");
  const { json } = await import("../notes/ai");
  const out = await json<{ name: string; subjects: string[]; preheader: string; body: string; ctaLabel: string; ctaPath: string }>(
    { orgId: m.orgId, userId: adminId },
    "outreach_template",
    `You write promotional emails for Cloudesk (cloudesk.in), an all-in-one workspace for Indian small and mid-sized businesses: website and online store, GST invoicing and payments, accounts, CRM and sales, POS, inventory, HR and payroll, bookings, mail, chat and an AI copilot. Free to start.
Write like a helpful founder, not an advertiser: short paragraphs, concrete benefits, one clear call to action, no hype, no ALL CAPS, no spam phrases ("act now", "100% free", "click here", "limited time", "guaranteed"). 80–160 words.
Use merge fields: {{firstName|there}} in the greeting, {{company|your business}} where natural. Body formatting: blank lines between paragraphs, "- " bullets, **bold** sparingly. No links in the body — the button carries the link.
Give 3 subject lines with different angles (benefit, curiosity, personal), each under 55 characters.`,
    `Category: ${v.category}${v.industry ? `\nIndustry: ${v.industry}` : ""}\nBrief: ${v.brief}`,
    { type: "object", properties: { name: { type: "string" }, subjects: { type: "array", items: { type: "string" } }, preheader: { type: "string" }, body: { type: "string" }, ctaLabel: { type: "string" }, ctaPath: { type: "string", description: "Path on cloudesk.in for the button, e.g. /start" } }, required: ["name", "subjects", "preheader", "body", "ctaLabel", "ctaPath"], additionalProperties: false },
    1500,
    "medium",
  );
  const path = /^\/[a-z0-9/_-]*$/i.test(out.ctaPath ?? "") ? out.ctaPath : "/start";
  const t = { name: out.name.slice(0, 120), category: v.category, industries: (INDUSTRIES as readonly string[]).includes(v.industry) ? [v.industry] : [], subjects: out.subjects.map((x) => x.trim().slice(0, 160)).filter(Boolean).slice(0, 3), preheader: out.preheader.slice(0, 200), body: out.body.slice(0, 20_000), ctaLabel: out.ctaLabel.slice(0, 60), ctaUrl: `https://cloudesk.in${path}` };
  return { template: check(templateInput, t), issues: spamCheck(t) };
}

/** A test send to an admin's own address (not tracked or counted). */
export async function testSend(raw: unknown) {
  const v = check(z.object({ template: templateInput, to: z.email(), variant: z.number().int().min(0).max(3).default(0) }), raw);
  const p = await preview({ template: v.template, variant: v.variant });
  const st = await getSettings();
  const r = await deliverOutreach(st, { to: v.to, subject: `[Test] ${p.subject}`, body: p.text, html: p.html, fromName: st.fromName, ...(st.replyTo ? { replyTo: st.replyTo } : {}) });
  if (!r.ok) throw new ApiError("bad_request", `The test didn't send: ${r.error}`);
  return { ok: true, from: (await senderOf(st)).address };
}

const reasonFor = (consent: string, source: string) => `You're receiving this because ${consent === "opt_in" ? "you asked to hear from Cloudesk" : consent === "customer" ? "you use Cloudesk" : "we thought Cloudesk could help your business"}${source ? ` (${source})` : ""}.`;

// ── Funnels ─────────────────────────────────────────────────────────────────

export async function funnels() {
  await ensureBuiltIns();
  const list = await db.select().from(F).orderBy(asc(F.kind), desc(F.updatedAt));
  const ids = list.map((f) => f.id);
  const [enr, sends] = ids.length
    ? await Promise.all([
        db.select({ funnelId: E.funnelId, status: E.status, n: sql<number>`count(*)::int` }).from(E).where(inArray(E.funnelId, ids)).groupBy(E.funnelId, E.status),
        db.select({ funnelId: S.funnelId, revenue: sql<number>`coalesce(sum(${S.revenue}), 0)::int`, sends: sql<number>`count(*)::int`, opens: sql<number>`count(*) filter (where ${S.opens} > 0)::int`, clicks: sql<number>`count(*) filter (where ${S.clicks} > 0)::int`, conversions: sql<number>`count(*) filter (where ${S.convertedAt} is not null)::int`, unsubs: sql<number>`count(*) filter (where ${S.unsubscribedAt} is not null)::int`, bounces: sql<number>`count(*) filter (where ${S.status} = 'bounced')::int` }).from(S).where(inArray(S.funnelId, ids)).groupBy(S.funnelId),
      ])
    : [[], []];
  // Lift: how much better people convert when emailed than the control group that wasn't.
  const lift = ids.length
    ? ((await db.execute(sql`select e.funnel_id, e.holdout, count(*)::int as n,
        count(*) filter (where e.status = 'converted' or (c.signed_up_at is not null and c.signed_up_at >= e.created_at))::int as won
        from po_enrollments e join po_contacts c on c.id = e.contact_id
        where e.funnel_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) group by 1, 2`)) as unknown as { rows: { funnel_id: string; holdout: boolean; n: number; won: number }[] }).rows
    : [];
  return {
    funnels: list.map((f) => {
      const e = enr.filter((x) => x.funnelId === f.id);
      const s = sends.find((x) => x.funnelId === f.id);
      const mailed = lift.find((x) => x.funnel_id === f.id && !x.holdout);
      const held = lift.find((x) => x.funnel_id === f.id && x.holdout);
      const rateOf = (x?: { n: number; won: number }) => (x && x.n ? x.won / x.n : 0);
      const control = held && held.n >= 20 && mailed ? { emailed: Math.round(rateOf(mailed) * 1000) / 10, holdout: Math.round(rateOf(held) * 1000) / 10, people: held.n } : null;
      return { ...f, control, revenue: s?.revenue ?? 0, enrolled: e.reduce((a, x) => a + x.n, 0), active: e.find((x) => x.status === "active")?.n ?? 0, converted: e.find((x) => x.status === "converted")?.n ?? 0, sends: s?.sends ?? 0, opens: s?.opens ?? 0, clicks: s?.clicks ?? 0, conversions: s?.conversions ?? 0, unsubs: s?.unsubs ?? 0, bounces: s?.bounces ?? 0 };
    }),
  };
}

export async function funnelDetail(id: string) {
  if (!isId(id)) throw notFound("Funnel");
  const [f] = await db.select().from(F).where(eq(F.id, id));
  if (!f) throw notFound("Funnel");
  const [perStep, waiting] = await Promise.all([
    db.select({ stepId: S.stepId, sends: sql<number>`count(*)::int`, opens: sql<number>`count(*) filter (where ${S.opens} > 0)::int`, clicks: sql<number>`count(*) filter (where ${S.clicks} > 0)::int`, conversions: sql<number>`count(*) filter (where ${S.convertedAt} is not null)::int` }).from(S).where(eq(S.funnelId, id)).groupBy(S.stepId),
    db.select({ stepId: E.stepId, n: sql<number>`count(*)::int` }).from(E).where(and(eq(E.funnelId, id), eq(E.status, "active"))).groupBy(E.stepId),
  ]);
  const audience = await db.select({ n: count() }).from(C).where(audienceWhere(f.audience as Audience));
  return { funnel: f, steps: (f.steps as Step[]).map((s) => ({ ...s, ...(perStep.find((p) => p.stepId === s.id) ?? { sends: 0, opens: 0, clicks: 0, conversions: 0 }), waiting: waiting.filter((w) => w.stepId === s.id || w.stepId === `${s.id}~r`).reduce((a, w) => a + w.n, 0) })), audienceSize: audience[0]?.n ?? 0 };
}

export async function saveFunnel(id: string | null, raw: unknown) {
  const v = check(funnelInput, raw);
  const bad = checkSteps(v.steps);
  if (bad) throw new ApiError("validation_failed", bad);
  const values = { name: v.name, kind: v.kind, audience: v.audience, steps: v.steps, goal: v.goal, autoEnroll: v.kind === "broadcast" ? false : v.autoEnroll, autoOptimize: v.autoOptimize, priority: v.priority ?? 0, holdoutPct: v.holdoutPct ?? 0, startAt: v.startAt ? new Date(v.startAt) : null, updatedAt: new Date() };
  if (id) {
    if (!isId(id)) throw notFound("Funnel");
    const [f] = await db.update(F).set(values).where(eq(F.id, id)).returning();
    if (!f) throw notFound("Funnel");
    return f;
  }
  const [f] = await db.insert(F).values({ ...values, status: "paused" }).returning();
  return f!;
}

/** Start or pause. Starting a broadcast enrols its audience once; a funnel keeps enrolling while it runs. */
export async function setFunnelStatus(id: string, status: "active" | "paused") {
  if (!isId(id)) throw notFound("Funnel");
  const [f] = await db.update(F).set({ status, pausedReason: "", updatedAt: new Date() }).where(eq(F.id, id)).returning();
  if (!f) throw notFound("Funnel");
  let enrolled = 0;
  if (status === "active") enrolled = await enroll(f, f.kind === "broadcast" ? 100_000 : 2000);
  await event("engine", { text: `${f.name} ${status === "active" ? `started${enrolled ? ` — ${enrolled} people enrolled` : ""}` : "paused"}` }, { funnelId: f.id });
  return { funnel: f, enrolled };
}

export async function deleteFunnel(id: string) {
  if (!isId(id)) throw notFound("Funnel");
  await db.delete(F).where(eq(F.id, id));
  return { ok: true };
}

/** People in the funnel's audience who aren't in it yet (nor busy in another running funnel), up to `limit`. */
async function enroll(f: typeof F.$inferSelect, limit: number) {
  const steps = f.steps as Step[];
  const first = steps[0]?.id ?? null;
  const at = f.startAt && f.startAt > new Date() ? f.startAt : new Date();
  // Not already in this funnel, nor busy in one that matters as much or more (a higher-priority funnel takes people over).
  const r = (await db.execute(sql`
    insert into po_enrollments (funnel_id, contact_id, step_id, status, next_at, holdout)
    select ${f.id}, po_contacts.id, ${first}, 'active', ${at.toISOString()}::timestamptz, (random() * 100) < ${f.holdoutPct}
    from po_contacts
    where ${audienceWhere(f.audience as Audience)}
      and not exists (
        select 1 from po_enrollments e join po_funnels f2 on f2.id = e.funnel_id
        where e.contact_id = po_contacts.id and (e.funnel_id = ${f.id} or (e.status = 'active' and f2.priority >= ${f.priority}))
      )
    order by po_contacts.score desc, po_contacts.created_at
    limit ${limit}
    on conflict do nothing
    returning contact_id`)) as unknown as { rows: { contact_id: string }[] };
  const ids = r.rows.map((x) => x.contact_id);
  if (ids.length) {
    const moved = await db.update(E).set({ status: "exited", exitReason: `moved to ${f.name}`.slice(0, 120), nextAt: null, updatedAt: new Date() }).where(and(inArray(E.contactId, ids), eq(E.status, "active"), ne(E.funnelId, f.id))).returning({ id: E.id });
    if (moved.length) await event("engine", { text: `Moved ${moved.length} ${moved.length === 1 ? "person" : "people"} into ${f.name} (higher priority)` }, { funnelId: f.id });
  }
  return ids.length;
}

// ── Tracking ────────────────────────────────────────────────────────────────

async function sendByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [s] = await db.select().from(S).where(eq(S.token, token));
  return s ?? null;
}

async function touch(contactId: string, change: { open?: boolean; click?: boolean; client?: string }) {
  const [c] = await db.select().from(C).where(eq(C.id, contactId));
  if (!c) return;
  const opens = c.opens + (change.open ? 1 : 0);
  const clicks = c.clicks + (change.click ? 1 : 0);
  const now = new Date();
  const h = istHour(now);
  // Their best hour leans toward when they actually open.
  const bestHour = change.open ? (c.bestHour === null ? h : Math.round((c.bestHour * 3 + h) / 4)) : c.bestHour;
  const score = scoreOf({ opens, clicks, lastEventAt: now, stage: c.stage as Stage });
  const stage = stageFromScore(score, c.stage as Stage);
  await db.update(C).set({ opens, clicks, bestHour, score, stage, unopenedRun: 0, lastEventAt: now, ...(change.client ? { client: change.client } : {}), updatedAt: now }).where(eq(C.id, c.id));
  if (stage === "hot" && c.stage !== "hot") await event("engine", { text: `${c.name || c.email} is now a hot lead (${clicks} clicks, ${opens} opens)` }, { contactId: c.id });
}

export type HitMeta = { ua?: string | null; ip?: string | null; method?: string };
const secondsSince = (d: Date) => (Date.now() - d.getTime()) / 1000;

/** The tracking pixel. People's opens count; privacy proxies and scanners are counted apart and never read as interest. */
export async function trackOpen(token: string, meta: HitMeta = {}) {
  const s = await sendByToken(token);
  if (!s) return;
  const v = classifyHit({ kind: "open", ua: meta.ua ?? "", ip: meta.ip ?? "", method: meta.method, secondsSinceSend: secondsSince(s.sentAt) });
  if (v.machine) {
    await db.update(S).set({ machineOpens: sql`${S.machineOpens} + 1` }).where(eq(S.id, s.id));
    await db.update(C).set({ machineOpens: sql`${C.machineOpens} + 1` }).where(eq(C.id, s.contactId));
    return;
  }
  await db.update(S).set({ opens: sql`${S.opens} + 1`, openedAt: s.openedAt ?? new Date() }).where(eq(S.id, s.id));
  if (!s.openedAt) {
    await touch(s.contactId, { open: true, client: v.client });
    await event("open", v.client ? { client: v.client } : {}, { contactId: s.contactId, sendId: s.id, funnelId: s.funnelId });
  }
}

const linkKey = () => process.env.APP_ENCRYPTION_KEY ?? "outreach-dev-links";
/** Each tracked link is signed, so the redirect only goes where the email pointed (never an open redirect). */
export const signLink = (token: string, url: string) => createHmac("sha256", linkKey()).update(`${token}|${url}`).digest("base64url").slice(0, 16);
const ownHost = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === new URL(appUrl("/")).hostname || /(^|\.)cloudesk\.in$/i.test(h);
  } catch {
    return false;
  }
};

/** A tracked link: counts a person's click (which also means they opened it) and returns where to go. */
export async function trackClick(token: string, encoded: string, sig = "", meta: HitMeta = {}): Promise<string> {
  let url = "";
  try {
    url = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {}
  if (!/^https?:\/\//i.test(url)) return appUrl("/");
  // Unsigned or tampered: only our own pages.
  if (!(sig && safeEqual(sig, signLink(token, url))) && !ownHost(url)) return appUrl("/");
  const s = await sendByToken(token);
  if (!s) return url;
  const recent = await db.select({ at: V.createdAt }).from(V).where(and(eq(V.sendId, s.id), inArray(V.kind, ["click", "machine_click"]), gte(V.createdAt, new Date(Date.now() - 5000))));
  const v = classifyHit({ kind: "click", ua: meta.ua ?? "", ip: meta.ip ?? "", method: meta.method, secondsSinceSend: secondsSince(s.sentAt), priorClicksSecondsAgo: recent.map((r) => secondsSince(r.at)) });
  if (v.machine) {
    await db.update(S).set({ machineClicks: sql`${S.machineClicks} + 1` }).where(eq(S.id, s.id));
    await event("machine_click", { url: url.slice(0, 500), reason: v.reason }, { contactId: s.contactId, sendId: s.id, funnelId: s.funnelId });
    return url;
  }
  await db.update(S).set({ clicks: sql`${S.clicks} + 1`, clickedAt: s.clickedAt ?? new Date(), openedAt: s.openedAt ?? new Date(), opens: s.opens || 1 }).where(eq(S.id, s.id));
  await event("click", { url: url.slice(0, 500), ...(v.client ? { client: v.client } : {}), first: !s.clickedAt }, { contactId: s.contactId, sendId: s.id, funnelId: s.funnelId });
  // Every real click adds to their interest; the first one also counts as an open if the pixel was blocked.
  await touch(s.contactId, { click: true, open: !s.openedAt, client: v.client });
  return url;
}

/**
 * Exact attribution: someone who clicked through an email (the cc_po cookie
 * set by the tracked link) and then signed up — even with another address —
 * is credited to that email.
 */
export async function claimSignup(userId: string, token: string | null | undefined) {
  if (!token) return false;
  const s = await sendByToken(token);
  if (!s) return false;
  const [c] = await db.select().from(C).where(eq(C.id, s.contactId));
  if (!c || c.userId) return false;
  const now = new Date();
  await db.update(C).set({ userId, signedUpAt: c.signedUpAt ?? now, stage: STAGE_RANK[c.stage as Stage] < 3 ? "signed_up" : c.stage, attribution: "exact", convertedBy: s.id, updatedAt: now }).where(eq(C.id, c.id));
  await db.update(S).set({ convertedAt: s.convertedAt ?? now }).where(eq(S.id, s.id));
  await db.update(E).set({ status: "converted", exitReason: "signed_up", nextAt: null, updatedAt: now }).where(and(eq(E.contactId, c.id), eq(E.status, "active")));
  await event("signup", { attributed: true, exact: true }, { contactId: c.id, sendId: s.id, funnelId: s.funnelId });
  await alert(`${c.name || c.email} signed up from outreach`, `${c.name || c.email}${c.company ? ` (${c.company})` : ""} clicked “${s.subject}” and signed up.`).catch(() => {});
  return true;
}

/** The unsubscribe link (and one-click header): never emailed again. */
export async function unsubscribe(token: string) {
  const s = await sendByToken(token);
  if (!s) return { ok: false, email: "" };
  const [c] = await db.select({ email: C.email, status: C.status }).from(C).where(eq(C.id, s.contactId));
  if (c && c.status !== "unsubscribed") {
    await db.update(C).set({ status: "unsubscribed", updatedAt: new Date() }).where(eq(C.id, s.contactId));
    await db.update(S).set({ unsubscribedAt: new Date() }).where(eq(S.id, s.id));
    await db.update(E).set({ status: "exited", exitReason: "unsubscribed", updatedAt: new Date() }).where(and(eq(E.contactId, s.contactId), eq(E.status, "active")));
    await event("unsubscribe", {}, { contactId: s.contactId, sendId: s.id, funnelId: s.funnelId });
  }
  return { ok: true, email: c?.email ?? "" };
}

export async function unsubscribeInfo(token: string) {
  const s = await sendByToken(token);
  if (!s) return null;
  const [c] = await db.select({ email: C.email, status: C.status }).from(C).where(eq(C.id, s.contactId));
  return c ? { email: c.email, done: c.status === "unsubscribed" } : null;
}

/** A bounce or spam complaint reported by the email service: never emailed again, out of every funnel. */
export async function suppressByEmail(email: string, status: "bounced" | "complained", detail: Record<string, unknown> = {}) {
  const [c] = await db.select().from(C).where(sql`lower(${C.email}) = ${email.trim().toLowerCase()}`);
  if (!c || c.status === status || c.status === "unsubscribed") return false;
  const now = new Date();
  await db.update(C).set({ status, updatedAt: now }).where(eq(C.id, c.id));
  await db.update(E).set({ status: "exited", exitReason: status, nextAt: null, updatedAt: now }).where(and(eq(E.contactId, c.id), eq(E.status, "active")));
  const [last] = await db.select({ id: S.id, funnelId: S.funnelId }).from(S).where(eq(S.contactId, c.id)).orderBy(desc(S.sentAt)).limit(1);
  if (last && status === "bounced") await db.update(S).set({ status: "bounced" }).where(eq(S.id, last.id));
  // A complaint counts against the email like an unsubscribe does, so the safety check sees it.
  if (last && status === "complained") await db.update(S).set({ unsubscribedAt: now }).where(eq(S.id, last.id));
  await event(status === "bounced" ? "bounce" : "complaint", detail, { contactId: c.id, sendId: last?.id ?? null, funnelId: last?.funnelId ?? null });
  return true;
}

// ── The engine ──────────────────────────────────────────────────────────────

/** Contacts who signed up, started a trial or began paying: their stage moves on and the email that won them is credited. */
export async function syncConversions() {
  const signed = (await db.execute(sql`
    update po_contacts c set user_id = u.id, signed_up_at = coalesce(c.signed_up_at, u.created_at),
      stage = case when c.stage in ('new', 'engaged', 'hot', 'lost') then 'signed_up' else c.stage end,
      attribution = case when c.attribution = '' and c.sends > 0 then 'matched' else c.attribution end, updated_at = now()
    from users u
    where c.user_id is null and lower(u.email) = lower(c.email)
    returning c.id, c.signed_up_at`)) as unknown as { rows: { id: string; signed_up_at: string }[] };
  for (const r of signed.rows) {
    const at = new Date(r.signed_up_at);
    // The last email they clicked in the 30 days before (else opened in the 7 before) gets the credit.
    const [won] = await db
      .select({ id: S.id, funnelId: S.funnelId })
      .from(S)
      .where(and(eq(S.contactId, r.id), lte(S.sentAt, at), or(and(sql`${S.clickedAt} is not null`, gte(S.sentAt, new Date(at.getTime() - 30 * 86_400_000))), and(sql`${S.openedAt} is not null`, gte(S.sentAt, new Date(at.getTime() - 7 * 86_400_000))))))
      .orderBy(desc(S.sentAt))
      .limit(1);
    if (won) {
      await db.update(S).set({ convertedAt: at }).where(eq(S.id, won.id));
      await db.update(C).set({ convertedBy: won.id }).where(eq(C.id, r.id));
    }
    await event("signup", { attributed: !!won }, { contactId: r.id, sendId: won?.id ?? null, funnelId: won?.funnelId ?? null });
    if (won) {
      const [who] = await db.select({ email: C.email, name: C.name }).from(C).where(eq(C.id, r.id));
      await alert("A sign-up from outreach", `${who?.name || who?.email || "Someone"} signed up after an outreach email.`).catch(() => {});
    }
  }
  // Trial and paying, from their workspaces' subscriptions.
  const moved = (await db.execute(sql`
    with best as (
      select c.id, max(case when s.status = 'active' and s.monthly > 0 and not s.complimentary then 2 when s.status = 'trialing' then 1 else 0 end) as level,
        max(case when s.status = 'active' and not s.complimentary then s.monthly else 0 end) as monthly
      from po_contacts c
      join memberships m on m.user_id = c.user_id
      join org_subscriptions s on s.org_id = m.org_id
      where c.user_id is not null and c.stage in ('signed_up', 'trial')
      group by c.id
    )
    update po_contacts c set stage = case when b.level = 2 then 'paying' else 'trial' end,
      paid_at = case when b.level = 2 then coalesce(c.paid_at, now()) else c.paid_at end,
      paid_value = case when b.level = 2 then round(b.monthly)::int else c.paid_value end, updated_at = now()
    from best b
    where b.id = c.id and b.level > 0 and c.stage <> case when b.level = 2 then 'paying' else 'trial' end
    returning c.id, c.stage, c.paid_value, c.converted_by`)) as unknown as { rows: { id: string; stage: string; paid_value: number; converted_by: string | null }[] };
  for (const r of moved.rows) {
    // The email that won the sign-up is credited with the revenue too.
    if (r.stage === "paying" && r.converted_by) await db.update(S).set({ revenue: r.paid_value }).where(eq(S.id, r.converted_by));
    await event(r.stage === "paying" ? "paid" : "trial", r.stage === "paying" ? { monthly: r.paid_value } : {}, { contactId: r.id, sendId: r.converted_by });
  }
  return { signedUp: signed.rows.length, moved: moved.rows.length };
}

/** A funnel pauses itself when its recent sends bounce or unsubscribe too much (it protects the sender's reputation). */
async function safetyCheck(st: OutreachSettings) {
  const active = await db.select().from(F).where(eq(F.status, "active"));
  for (const f of active) {
    const recent = (await db.execute(sql`select count(*)::int as n, count(*) filter (where status = 'bounced')::int as b, count(*) filter (where unsubscribed_at is not null)::int as u from (select status, unsubscribed_at from po_sends where funnel_id = ${f.id} order by sent_at desc limit 200) x`)) as unknown as { rows: { n: number; b: number; u: number }[] };
    const { n, b, u } = recent.rows[0] ?? { n: 0, b: 0, u: 0 };
    if (n < 50) continue;
    const bounce = (b / n) * 100;
    const unsub = (u / n) * 100;
    if (bounce > st.maxBounceRate || unsub > st.maxUnsubRate) {
      const reason = bounce > st.maxBounceRate ? `bounce rate ${bounce.toFixed(1)}% is above ${st.maxBounceRate}%` : `unsubscribe rate ${unsub.toFixed(1)}% is above ${st.maxUnsubRate}%`;
      await db.update(F).set({ status: "paused", pausedReason: reason, updatedAt: new Date() }).where(eq(F.id, f.id));
      await event("engine", { text: `Paused ${f.name}: ${reason} — check the list and the content before restarting`, level: "warning" }, { funnelId: f.id });
    }
  }
}

/** How many may still go out today, under the daily limit and the warm-up. */
async function budget(st: OutreachSettings & { startedAt: string | null }) {
  const [{ n }] = await db.select({ n: count() }).from(S).where(gte(S.sentAt, istMidnight()));
  const days = st.startedAt ? Math.floor((Date.now() - Date.parse(st.startedAt)) / 86_400_000) : 0;
  const cap = Math.min(warmupCap(st, days), st.via === "mailbox" ? MAILBOX_DAILY_CAP : Infinity);
  return { sentToday: n, cap, left: Math.max(0, cap - n) };
}

const token = () => randomBytes(18).toString("base64url");
const withUtm = (url: string, f: { name: string } | null, templateKey: string, tok: string) => {
  try {
    const u = new URL(url);
    if (!/(^|\.)cloudesk\.in$/i.test(u.hostname) && u.origin !== new URL(appUrl("/")).origin) return url;
    u.searchParams.set("utm_source", "outreach");
    u.searchParams.set("utm_medium", "email");
    u.searchParams.set("utm_campaign", (f?.name ?? "broadcast").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60));
    if (templateKey) u.searchParams.set("utm_content", templateKey);
    u.searchParams.set("po", tok);
    return u.toString();
  } catch {
    return url;
  }
};

type Tpl = typeof T.$inferSelect;
type Contact = typeof C.$inferSelect;

/** The template for this person: fixed, or the one in the category that's converting best for their industry (learned as it goes). */
async function chooseTemplate(step: Extract<Step, { kind: "email" }>, c: Contact, optimize: boolean, rand: () => number): Promise<Tpl | null> {
  if (step.templateId) {
    const [t] = await db.select().from(T).where(and(eq(T.id, step.templateId), eq(T.archived, false)));
    return t ?? null;
  }
  const inCat = await db.select().from(T).where(and(eq(T.category, step.category!), eq(T.archived, false)));
  if (!inCat.length) return null;
  const fit = inCat.filter((t) => t.industries.includes(c.industry));
  const general = inCat.filter((t) => !t.industries.length);
  const pool = fit.length ? [...fit, ...general] : general.length ? general : inCat;
  if (!optimize || pool.length === 1) return pool[0]!;
  const stats = await armStats(and(inArray(S.templateId, pool.map((t) => t.id)), eq(S.industry, c.industry)));
  return pool[pickArm(pool.map((t) => sum(stats.filter((s) => s.templateId === t.id))), rand)]!;
}

async function sendOne(f: typeof F.$inferSelect | null, stepId: string | null, step: Extract<Step, { kind: "email" }>, c: Contact, st: OutreachSettings, rand: () => number, resendOf?: { templateId: string | null; variant: number }) {
  const [same] = resendOf?.templateId ? await db.select().from(T).where(eq(T.id, resendOf.templateId)) : [];
  const tpl = same ?? (await chooseTemplate(step, c, f?.autoOptimize ?? true, rand));
  if (!tpl) return { sent: false as const, reason: "no template" };
  // Live subject lines: not retired, and on a second try not the one they ignored.
  const live = tpl.subjects.map((_, i) => i).filter((i) => !tpl.retired.includes(i) && i !== resendOf?.variant);
  const pool = live.length ? live : tpl.subjects.map((_, i) => i);
  let variant = pool[0]!;
  if ((f?.autoOptimize ?? true) && pool.length > 1) {
    const stats = await armStats(eq(S.templateId, tpl.id));
    variant = pool[pickArm(pool.map((i) => sum(stats.filter((s) => s.variant === i))), rand)]!;
  }
  const tok = token();
  const extra = { trial: freeFor() };
  const subject = merge(tpl.subjects[variant]!, { ...c, data: c.data }, extra).slice(0, 200);
  const unsubscribeUrl = appUrl(`/po/u/${tok}`);
  const link = (url: string) => {
    const to = withUtm(url, f, tpl.key ?? "", tok);
    return appUrl(`/api/v1/po/c/${tok}?u=${Buffer.from(to).toString("base64url")}&s=${signLink(tok, to)}`);
  };
  const out = renderEmail({ body: merge(tpl.body, { ...c, data: c.data }, extra), preheader: merge(tpl.preheader, { ...c, data: c.data }, extra), ctaLabel: tpl.ctaLabel, ctaUrl: tpl.ctaUrl, link, pixel: appUrl(`/api/v1/po/o/${tok}`), unsubscribe: unsubscribeUrl, fromName: st.fromName, postalAddress: st.postalAddress, reason: reasonFor(c.consent, c.source), logo: LOGO() });
  const [send] = await db.insert(S).values({ token: tok, contactId: c.id, funnelId: f?.id ?? null, templateId: tpl.id, stepId, variant, subject, industry: c.industry, resend: !!resendOf }).returning();
  const feedback = `${(tpl.key ?? tpl.id.slice(0, 8)).slice(0, 30)}:${(f?.name ?? "broadcast").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}:outreach:cloudesk`;
  const r = await deliverOutreach(st, { to: c.email, subject, body: out.text, html: out.html, fromName: st.fromName, ...(st.replyTo ? { replyTo: st.replyTo } : {}), headers: { "List-Unsubscribe": `<${appUrl(`/api/v1/po/u/${tok}`)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "Feedback-ID": feedback } });
  const failed = !r.ok;
  // A permanent rejection (no such mailbox, bad domain) is a bounce: never emailed again.
  const bounced = !r.ok && r.bounced;
  const error = r.ok ? "" : r.error;
  // Anything else (the service or mailbox refused us) isn't this person's doing: undo, and try them again later.
  if (failed && !bounced) {
    await db.delete(S).where(eq(S.id, send!.id));
    return { sent: false as const, reason: "error", error };
  }
  if (failed) await db.update(S).set({ status: bounced ? "bounced" : "failed", error: error.slice(0, 300) }).where(eq(S.id, send!.id));
  await db.update(C).set({ sends: sql`${C.sends} + 1`, lastEmailAt: new Date(), unopenedRun: sql`${C.unopenedRun} + 1`, ...(bounced ? { status: "bounced" } : {}), updatedAt: new Date() }).where(eq(C.id, c.id));
  if (bounced) await event("bounce", { error: error.slice(0, 200) }, { contactId: c.id, sendId: send!.id, funnelId: f?.id ?? null });
  return { sent: !failed, sendId: send!.id };
}

const GOAL_RANK = { signed_up: 3, trial: 4, paying: 5 } as const;

// ── What the engine learns and checks on its own ───────────────────────────

/** The hour people open most, per industry and overall (India time, real opens in 90 days) — for people with no history yet. */
async function learnedHours() {
  const rows = (await db.execute(sql`select industry, extract(hour from opened_at + interval '330 minutes')::int as hour, count(*)::int as n
    from po_sends where opened_at is not null and opened_at > now() - interval '90 days' group by 1, 2`)) as unknown as { rows: { industry: string; hour: number; n: number }[] };
  const pick = (list: { hour: number; n: number }[], min: number) => {
    const total = list.reduce((a, r) => a + r.n, 0);
    return total >= min ? list.reduce((a, r) => (r.n > a.n ? r : a)).hour : null;
  };
  const byInd = new Map<string, { hour: number; n: number }[]>();
  const all = new Map<number, number>();
  for (const r of rows.rows) {
    byInd.set(r.industry, [...(byInd.get(r.industry) ?? []), r]);
    all.set(r.hour, (all.get(r.hour) ?? 0) + r.n);
  }
  const global = pick([...all].map(([hour, n]) => ({ hour, n })), 30);
  return { of: (industry: string) => pick(byInd.get(industry) ?? [], 20) ?? global };
}

type MxResolver = (domain: string) => Promise<boolean | null>;
const realMx: MxResolver = async (domain) => {
  const { Resolver } = await import("node:dns/promises");
  const r = new Resolver({ timeout: 3000, tries: 1 });
  try {
    return (await r.resolveMx(domain)).length > 0;
  } catch (e) {
    const code = (e as { code?: string }).code;
    // No such domain or no mail server: definite. Timeouts and the like: don't know.
    return code === "ENOTFOUND" || code === "ENODATA" ? false : null;
  }
};
let mxResolver: MxResolver = realMx;
/** Injectable for tests. */
export function setMxResolver(f: MxResolver | null) {
  mxResolver = f ?? realMx;
}
const BIG_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "rediffmail.com", "proton.me", "protonmail.com", "zoho.com", "zohomail.in", "aol.com"]);

/** Checks the mail server of addresses not yet checked (each domain once a month); those without one are never sent to. */
export async function verifyAddresses(limit = 60) {
  const rows = (await db.execute(sql`select distinct split_part(lower(email), '@', 2) as domain from po_contacts where verify = 'unknown' and status = 'active' limit ${limit}`)) as unknown as { rows: { domain: string }[] };
  let invalid = 0;
  for (const { domain } of rows.rows) {
    let mx: boolean | null = BIG_MAIL.has(domain) ? true : null;
    if (mx === null) {
      const [cached] = await db.select().from(schema.poDomains).where(and(eq(schema.poDomains.domain, domain), gte(schema.poDomains.checkedAt, new Date(Date.now() - 30 * 86_400_000))));
      mx = cached ? cached.mx : await mxResolver(domain);
      if (!cached && mx !== null) await db.insert(schema.poDomains).values({ domain, mx }).onConflictDoUpdate({ target: schema.poDomains.domain, set: { mx, checkedAt: new Date() } });
    }
    if (mx === null) continue;
    const r = await db.update(C).set(mx ? { verify: "valid", updatedAt: new Date() } : { verify: "invalid", verifyNote: `${domain} doesn't receive email`, updatedAt: new Date() }).where(and(sql`split_part(lower(${C.email}), '@', 2) = ${domain}`, eq(C.verify, "unknown"))).returning({ id: C.id });
    if (!mx) {
      invalid += r.length;
      await db.update(E).set({ status: "exited", exitReason: "invalid address", nextAt: null, updatedAt: new Date() }).where(and(inArray(E.contactId, r.map((x) => x.id)), eq(E.status, "active")));
    }
  }
  if (invalid) await event("engine", { text: `Skipped ${invalid} ${invalid === 1 ? "address" : "addresses"} whose domain doesn't receive email — bounces hurt every email that follows` });
  return { checked: rows.rows.length, invalid };
}

/**
 * Replies, when outreach goes from a Cloudesk Mail mailbox: someone who writes
 * back is the warmest lead there is — they leave the funnel (a person takes
 * over), turn hot, and the admin hears about it.
 */
async function detectReplies(st: OutreachSettings) {
  if (st.via !== "mailbox" || !st.accountId) return 0;
  const rows = (await db.execute(sql`
    select distinct on (c.id) c.id, c.email, c.name, c.company, m.date, m.subject
    from po_contacts c
    join mail_messages m on m.account_id = ${st.accountId} and m.direction = 'in' and lower(m.from_address) = lower(c.email)
    where c.replied_at is null and c.last_email_at is not null
      and m.date > (select min(sent_at) from po_sends s where s.contact_id = c.id)
    order by c.id, m.date
    limit 200`)) as unknown as { rows: { id: string; email: string; name: string; company: string; date: string; subject: string }[] };
  for (const r of rows.rows) {
    const at = new Date(r.date);
    const [c] = await db.select().from(C).where(eq(C.id, r.id));
    if (!c) continue;
    const score = c.score + 50;
    await db.update(C).set({ repliedAt: at, score, stage: STAGE_RANK[c.stage as Stage] < 3 ? "hot" : c.stage, lastEventAt: at, unopenedRun: 0, updatedAt: new Date() }).where(eq(C.id, c.id));
    const [last] = await db.select({ id: S.id, funnelId: S.funnelId }).from(S).where(and(eq(S.contactId, c.id), lte(S.sentAt, at))).orderBy(desc(S.sentAt)).limit(1);
    if (last) await db.update(S).set({ repliedAt: at }).where(eq(S.id, last.id));
    await db.update(E).set({ status: "exited", exitReason: "replied", nextAt: null, updatedAt: new Date() }).where(and(eq(E.contactId, c.id), eq(E.status, "active")));
    await event("reply", { subject: r.subject.slice(0, 200) }, { contactId: c.id, sendId: last?.id ?? null, funnelId: last?.funnelId ?? null });
    await alert(`${r.name || r.email} replied`, `${r.name || r.email}${r.company ? ` (${r.company})` : ""} replied: “${r.subject}”. They've been taken out of their funnel so you can answer personally — it's in Cloudesk Mail.`);
  }
  return rows.rows.length;
}

type Writer = (o: { template: Tpl; winner: string; losers: string[] }) => Promise<string | null>;
/** Writes a new subject line to challenge the winner, with the admin's AI. */
const aiWriter =
  (st: OutreachSettings & Internal): Writer =>
  async ({ template, winner, losers }) => {
    if (!st.aiOrgId) return null;
    const { json } = await import("../notes/ai");
    const r = await json<{ subject: string }>(
      { orgId: st.aiOrgId, userId: st.aiUserId ?? "" },
      "outreach_subject",
      "You write email subject lines for Cloudesk, an all-in-one business workspace for Indian small businesses. Plain, specific, human; no clickbait, no ALL CAPS, at most one emoji, under 60 characters. Keep merge fields exactly as written, like {{firstName|there}} or {{company|your business}}.",
      `Email: “${template.name}” (${template.category}).\nOpening of the body: ${template.body.slice(0, 600)}\n\nThe subject line winning so far: ${winner}\nThese lost: ${losers.join(" | ") || "—"}\n\nWrite one new subject line that could beat the winner — a different angle, not a rewording.`,
      { type: "object", properties: { subject: { type: "string" } }, required: ["subject"], additionalProperties: false },
      300,
    );
    const subj = r.subject?.trim().replace(/^["“]|["”]$/g, "").slice(0, 160);
    return subj && !spamCheck({ subjects: [subj], preheader: "x", body: "x ".repeat(60), ctaUrl: "", ctaLabel: "" }).some((i) => i.level === "bad") ? subj : null;
  };
let writerOverride: Writer | null = null;
/** Injectable for tests. */
export function setSubjectWriter(w: Writer | null) {
  writerOverride = w;
}

/**
 * Once a day: retire subject lines that are almost surely losing (under 2%
 * chance of being best, after 100+ sends each), and — with AI on — write a
 * fresh challenger for each template that lost one.
 */
export async function evolveSubjects(st: OutreachSettings & Internal, rand: () => number = Math.random) {
  const list = await db.select().from(T).where(eq(T.archived, false));
  const stats = await armStats();
  const write = writerOverride ?? aiWriter(st);
  let retired = 0;
  let written = 0;
  for (const t of list) {
    const live = t.subjects.map((_, i) => i).filter((i) => !t.retired.includes(i));
    if (live.length < 2) continue;
    const arms = live.map((i) => {
      const a = sum(stats.filter((x) => x.templateId === t.id && x.variant === i));
      return { i, sends: a.sends, wins: a.clicks + a.conversions * 3 + a.opens * 0.2 };
    });
    if (arms.some((a) => a.sends < 100)) continue;
    const p = probBest(arms.map((a) => ({ sends: a.sends, wins: Math.round(a.wins) })), 2000, rand);
    const losers = arms.filter((_, k) => p[k]! < 0.02).map((a) => a.i);
    if (!losers.length || losers.length === arms.length) continue;
    const best = arms[p.indexOf(Math.max(...p))]!;
    const subjects = [...t.subjects];
    let note = "";
    if (st.aiEvolve && subjects.length < 6) {
      const fresh = await write({ template: t, winner: t.subjects[best.i]!, losers: losers.map((i) => t.subjects[i]!) }).catch(() => null);
      if (fresh && !subjects.includes(fresh)) {
        subjects.push(fresh);
        written++;
        note = ` and wrote a new challenger: “${fresh}”`;
      }
    }
    await db.update(T).set({ subjects, retired: [...t.retired, ...losers], updatedAt: new Date() }).where(eq(T.id, t.id));
    retired += losers.length;
    await event("engine", { text: `${t.name}: retired ${losers.map((i) => `“${t.subjects[i]}”`).join(", ")} — “${t.subjects[best.i]}” is winning${note}` });
  }
  return { retired, written };
}

/**
 * One pass of the engine: credit conversions, protect deliverability, enrol
 * new people, then move due people through their funnels — the most promising
 * first — within today's budget, at their best hour inside the window.
 */
export type TickResult = { sent: number; failed: number; reason?: string; funnels: number; queued: number; nextAt: string | null };

/** What's waiting: running funnels, people in them, and when the next email is due. */
async function queueState(now: Date) {
  const [[{ funnels: n }], [q]] = await Promise.all([
    db.select({ funnels: count() }).from(F).where(eq(F.status, "active")),
    db.select({ queued: count(), next: sql<string | null>`min(${E.nextAt})` }).from(E).innerJoin(F, eq(F.id, E.funnelId)).where(and(eq(E.status, "active"), eq(F.status, "active"))),
  ]);
  const next = q?.next ? new Date(q.next) : null;
  return { funnels: n, queued: q?.queued ?? 0, nextAt: next ? (next < now ? now : next).toISOString() : null };
}

export async function outreachTick(opts: { now?: Date; rand?: () => number; limit?: number } = {}): Promise<TickResult> {
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? new Date();
  const st = await getSettings();
  const done = async (sent: number, failed: number, reason?: string): Promise<TickResult> => ({ sent, failed, ...(reason ? { reason } : {}), ...(await queueState(now)) });
  await syncConversions().catch((e) => log.warn("outreach.sync_failed", { err: String(e) }));
  await detectReplies(st).catch((e) => log.warn("outreach.replies_failed", { err: String(e) }));
  // Once a day: retire losing subject lines and write new challengers.
  if (!st.lastDailyAt || Date.now() - Date.parse(st.lastDailyAt) > 20 * 3_600_000) {
    await setInternal({ lastDailyAt: new Date().toISOString() });
    await ensureBuiltIns();
    await evolveSubjects(st, rand).catch((e) => log.warn("outreach.evolve_failed", { err: String(e) }));
  }
  if (!st.sending) return done(0, 0, "sending is off");
  if (!st.postalAddress) return done(0, 0, "no postal address");
  const sender = await senderOf(st);
  if (!sender.ready && process.env.NODE_ENV === "production") return done(0, 0, st.via === "mailbox" ? "the Cloudesk Mail mailbox isn't connected" : "no email service is set up");
  await ensureBuiltIns();
  await safetyCheck(st);
  await verifyAddresses().catch((e) => log.warn("outreach.verify_failed", { err: String(e) }));
  // Higher-priority funnels enrol first, so they get the people they want.
  for (const f of await db.select().from(F).where(and(eq(F.status, "active"), eq(F.kind, "funnel"), eq(F.autoEnroll, true))).orderBy(desc(F.priority))) await enroll(f, 1000);
  let { left } = await budget(st);
  const perTick = Math.min(left, opts.limit ?? 200);
  if (perTick <= 0) return done(0, 0, "daily limit reached");
  const hours = await learnedHours();
  const due = await db
    .select({ e: E, c: C, f: F })
    .from(E)
    .innerJoin(C, eq(C.id, E.contactId))
    .innerJoin(F, eq(F.id, E.funnelId))
    .where(and(eq(E.status, "active"), eq(F.status, "active"), lte(E.nextAt, now)))
    .orderBy(desc(F.priority), desc(C.score), asc(E.nextAt))
    .limit(perTick * 3);
  let sent = 0;
  let failedN = 0;
  let halted = "";
  for (const { e, c, f } of due) {
    if (sent >= perTick || left <= 0 || halted) break;
    const steps = f.steps as Step[];
    const stop = async (status: string, reason: string, stage?: Stage) => {
      await db.update(E).set({ status, exitReason: reason, nextAt: null, updatedAt: now }).where(eq(E.id, e.id));
      if (stage) await db.update(C).set({ stage, updatedAt: now }).where(eq(C.id, c.id));
    };
    if (c.status !== "active" || c.verify === "invalid") {
      await stop("exited", c.status !== "active" ? c.status : "invalid address");
      continue;
    }
    if (STAGE_RANK[c.stage as Stage] >= GOAL_RANK[f.goal as keyof typeof GOAL_RANK]) {
      await stop("converted", f.goal);
      continue;
    }
    if (c.unopenedRun >= st.sunsetAfter && !e.holdout) {
      await stop("exited", "unresponsive", STAGE_RANK[c.stage as Stage] < 3 ? "lost" : undefined);
      await event("engine", { text: `Stopped emailing ${c.email}: ${c.unopenedRun} emails in a row unopened` }, { contactId: c.id, funnelId: f.id });
      continue;
    }
    // "s1~r": waiting to resend step s1 to someone who didn't open it.
    let resendDue = !!e.stepId?.endsWith("~r");
    let i = steps.findIndex((s) => s.id === (resendDue ? e.stepId!.slice(0, -2) : e.stepId));
    let lastSendId = e.lastSendId;
    let next: { at: Date | null; stepId: string | null } | null = null;
    for (let hops = 0; hops < 40 && !next; hops++) {
      const s = steps[i];
      if (!s) {
        await stop("completed", "");
        next = { at: null, stepId: null };
        break;
      }
      if (s.kind === "wait") {
        next = { at: new Date(now.getTime() + s.days * 86_400_000), stepId: steps[i + 1]?.id ?? null };
        if (!next.stepId) {
          await stop("completed", "");
          break;
        }
      } else if (s.kind === "branch") {
        const [last] = lastSendId ? await db.select({ opens: S.opens, clicks: S.clicks }).from(S).where(eq(S.id, lastSendId)) : [];
        const yes = s.if === "opened" ? (last?.opens ?? 0) > 0 : s.if === "clicked" ? (last?.clicks ?? 0) > 0 : s.if === "not_opened" ? !(last?.opens ?? 0) : !(last?.clicks ?? 0);
        const to = yes ? s.then : s.else;
        i = to ? steps.findIndex((x) => x.id === to) : i + 1;
      } else {
        // The control group walks the funnel without being emailed.
        if (e.holdout) {
          resendDue = false;
          lastSendId = null;
          i++;
          continue;
        }
        let resendOf: { templateId: string | null; variant: number } | undefined;
        if (resendDue) {
          resendDue = false;
          const [last] = lastSendId ? await db.select({ opens: S.opens, clicks: S.clicks, templateId: S.templateId, variant: S.variant }).from(S).where(eq(S.id, lastSendId)) : [];
          // They opened (or there's nothing to resend): carry on.
          if (!last || last.opens > 0 || last.clicks > 0) {
            i++;
            continue;
          }
          resendOf = { templateId: last.templateId, variant: last.variant };
        }
        const here = resendOf ? `${s.id}~r` : s.id;
        // Nobody gets more than maxPerWeek emails in 7 days, across every funnel.
        const [wk] = await db.select({ n: count(), first: sql<string | null>`min(${S.sentAt})` }).from(S).where(and(eq(S.contactId, c.id), gte(S.sentAt, new Date(now.getTime() - 7 * 86_400_000))));
        const capUntil = wk && wk.n >= st.maxPerWeek && wk.first ? new Date(new Date(wk.first).getTime() + 7 * 86_400_000) : now;
        const gapUntil = c.lastEmailAt ? new Date(c.lastEmailAt.getTime() + st.minGapHours * 3_600_000) : now;
        const from = new Date(Math.max(now.getTime(), gapUntil.getTime(), capUntil.getTime()));
        const slot = nextSlot(from, st, f.autoOptimize ? (c.bestHour ?? hours.of(c.industry)) : null);
        if (slot.getTime() > now.getTime() + 60_000) {
          next = { at: slot, stepId: here };
          break;
        }
        if (left <= 0) {
          next = { at: new Date(now.getTime() + 3_600_000), stepId: here };
          break;
        }
        const r = await sendOne(f, s.id, s, c, st, rand, resendOf);
        if (!r.sent && r.reason === "no template") {
          await stop("exited", "no template for this step");
          next = { at: null, stepId: null };
          break;
        }
        if (!r.sent && r.reason === "error") {
          next = { at: new Date(now.getTime() + 3_600_000), stepId: here };
          halted = ("error" in r && r.error) || "sending failed";
          break;
        }
        if (r.sent) sent++;
        else failedN++;
        left--;
        if ("sendId" in r) lastSendId = r.sendId!;
        c.lastEmailAt = now;
        // A first send with a second chance: come back after the wait to see if they opened.
        if (!resendOf && s.resendAfterDays && r.sent) {
          next = { at: new Date(now.getTime() + s.resendAfterDays * 86_400_000), stepId: `${s.id}~r` };
          break;
        }
        i++;
      }
    }
    if (next && next.stepId) await db.update(E).set({ stepId: next.stepId, nextAt: next.at, lastSendId, updatedAt: now }).where(eq(E.id, e.id));
    else if (next === null && lastSendId !== e.lastSendId) await db.update(E).set({ lastSendId, updatedAt: now }).where(eq(E.id, e.id));
  }
  if (halted) {
    log.warn("outreach.halted", { error: halted });
    await event("engine", { text: `Stopped sending: ${halted}`, level: "warning" });
    return done(sent, failedN + 1, `sending failed — ${halted}`);
  }
  if (sent || failedN) log.info("outreach.sent", { sent, failed: failedN });
  if (!sent && !failedN) {
    const q = await queueState(now);
    return { sent, failed: 0, reason: !q.funnels ? "no funnel is running" : !q.queued ? "nobody is waiting in the running funnels" : "nobody is due yet", ...q };
  }
  return done(sent, failedN);
}

// ── The picture ─────────────────────────────────────────────────────────────

const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const num = (n: number) => n.toLocaleString("en-IN");

export async function overview() {
  await ensureBuiltIns();
  const st = await getSettings();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [stageRows, statusRows, totals, daily, byIndustry, byHour, events, b, topTemplates] = await Promise.all([
    db.select({ stage: C.stage, n: sql<number>`count(*)::int` }).from(C).where(eq(C.status, "active")).groupBy(C.stage),
    db.select({ status: C.status, n: sql<number>`count(*)::int` }).from(C).groupBy(C.status),
    db.select({ sends: sql<number>`count(*)::int`, opened: sql<number>`count(*) filter (where ${S.opens} > 0)::int`, clicked: sql<number>`count(*) filter (where ${S.clicks} > 0)::int`, converted: sql<number>`count(*) filter (where ${S.convertedAt} is not null)::int`, bounced: sql<number>`count(*) filter (where ${S.status} = 'bounced')::int`, unsubs: sql<number>`count(*) filter (where ${S.unsubscribedAt} is not null)::int` }).from(S).where(gte(S.sentAt, since)),
    db.execute(sql`select to_char(date_trunc('day', sent_at + interval '330 minutes'), 'YYYY-MM-DD') as day, count(*)::int as sent, count(*) filter (where opens > 0)::int as opened, count(*) filter (where clicks > 0)::int as clicked, count(*) filter (where converted_at is not null)::int as converted from po_sends where sent_at >= ${since.toISOString()}::timestamptz group by 1 order by 1`) as unknown as Promise<{ rows: { day: string; sent: number; opened: number; clicked: number; converted: number }[] }>,
    db.select({ industry: S.industry, sends: sql<number>`count(*)::int`, clicked: sql<number>`count(*) filter (where ${S.clicks} > 0)::int`, converted: sql<number>`count(*) filter (where ${S.convertedAt} is not null)::int` }).from(S).where(gte(S.sentAt, since)).groupBy(S.industry),
    db.execute(sql`select extract(hour from opened_at + interval '330 minutes')::int as hour, count(*)::int as n from po_sends where opened_at is not null and sent_at >= ${since.toISOString()}::timestamptz group by 1 order by 1`) as unknown as Promise<{ rows: { hour: number; n: number }[] }>,
    db.select().from(V).where(eq(V.kind, "engine")).orderBy(desc(V.createdAt)).limit(30),
    budget(st),
    armStats(gte(S.sentAt, since)),
  ]);
  const t = totals[0]!;
  const stage = (s: string) => stageRows.find((r) => r.stage === s)?.n ?? 0;
  const contactsTotal = statusRows.reduce((a, r) => a + r.n, 0);
  const emailed = (await db.select({ n: count() }).from(C).where(sql`${C.sends} > 0`))[0]?.n ?? 0;
  const engagedEver = (await db.select({ n: count() }).from(C).where(sql`${C.opens} > 0`))[0]?.n ?? 0;
  const clickedEver = (await db.select({ n: count() }).from(C).where(sql`${C.clicks} > 0`))[0]?.n ?? 0;
  const tplNames = new Map((await db.select({ id: T.id, name: T.name, subjects: T.subjects }).from(T)).map((x) => [x.id, x]));
  // What the engine has learned: the leading subject line per template, from enough sends to mean something.
  const learned: { text: string }[] = [];
  const byTpl = new Map<string, Arm & { variant: number }[]>();
  for (const s of topTemplates) {
    if (!s.templateId) continue;
    const list = (byTpl.get(s.templateId) ?? []) as (Arm & { variant: number })[];
    const v = list.find((x) => x.variant === s.variant);
    if (v) Object.assign(v, sum([v, s]));
    else list.push({ variant: s.variant, sends: s.sends, opens: s.opens, clicks: s.clicks, conversions: s.conversions });
    byTpl.set(s.templateId, list as never);
  }
  for (const [id, list] of byTpl) {
    const arms = list as unknown as (Arm & { variant: number })[];
    if (arms.length < 2 || arms.some((a) => a.sends < 30)) continue;
    const ranked = [...arms].sort((a, b2) => b2.clicks / b2.sends - a.clicks / a.sends);
    const [w, l] = [ranked[0]!, ranked[ranked.length - 1]!];
    const tpl = tplNames.get(id);
    if (tpl && w.clicks / w.sends > l.clicks / l.sends) learned.push({ text: `“${tpl.subjects[w.variant]}” is winning on ${tpl.name}: ${rate(w.clicks, w.sends)}% click vs ${rate(l.clicks, l.sends)}% — most sends now use it.` });
  }
  const [machine, attribution, clients, hot, links] = await Promise.all([
    db.select({ opens: sql<number>`coalesce(sum(${S.machineOpens}), 0)::int`, clicks: sql<number>`coalesce(sum(${S.machineClicks}), 0)::int`, resends: sql<number>`count(*) filter (where ${S.resend})::int`, resendOpened: sql<number>`count(*) filter (where ${S.resend} and ${S.opens} > 0)::int`, replies: sql<number>`count(*) filter (where ${S.repliedAt} is not null)::int` }).from(S).where(gte(S.sentAt, since)),
    db.select({ attribution: C.attribution, n: sql<number>`count(*)::int`, paying: sql<number>`count(*) filter (where ${C.stage} = 'paying')::int`, mrr: sql<number>`coalesce(sum(${C.paidValue}) filter (where ${C.stage} = 'paying'), 0)::int` }).from(C).where(ne(C.attribution, "")).groupBy(C.attribution),
    db.select({ client: C.client, n: sql<number>`count(*)::int` }).from(C).where(ne(C.client, "")).groupBy(C.client).orderBy(desc(sql`count(*)`)).limit(8),
    db.select({ id: C.id, name: C.name, email: C.email, company: C.company, score: C.score, clicks: C.clicks, opens: C.opens, repliedAt: C.repliedAt, stage: C.stage, lastEventAt: C.lastEventAt }).from(C).where(and(eq(C.status, "active"), or(eq(C.stage, "hot"), sql`${C.repliedAt} is not null and ${C.userId} is null`))).orderBy(sql`${C.repliedAt} desc nulls last`, desc(C.score)).limit(12),
    db.execute(sql`select detail->>'url' as url, count(*)::int as n from po_events where kind = 'click' and created_at >= ${since.toISOString()}::timestamptz group by 1 order by 2 desc limit 8`) as unknown as Promise<{ rows: { url: string; n: number }[] }>,
  ]);
  const m = machine[0]!;
  const bestHour = byHour.rows.length ? byHour.rows.reduce((a, r) => (r.n > a.n ? r : a)) : null;
  if (bestHour && bestHour.n >= 20) learned.push({ text: `Most opens happen around ${String(bestHour.hour).padStart(2, "0")}:00 — people without their own history are sent then.` });
  const topInd = byIndustry.filter((x) => x.sends >= 30).sort((a, c2) => c2.converted / c2.sends - a.converted / a.sends)[0];
  if (m.opens > 0 && t.sends > 0) learned.push({ text: `${num(m.opens)} opens from privacy proxies and security scanners were ignored — open rates and decisions use real opens only.` });
  if (m.resends >= 20) learned.push({ text: `Second tries with a new subject line were opened by ${rate(m.resendOpened, m.resends)}% of people who ignored the first.` });
  if (topInd && topInd.converted) learned.push({ text: `${topInd.industry[0]!.toUpperCase()}${topInd.industry.slice(1)} converts best (${rate(topInd.converted, topInd.sends)}% of emails led to a sign-up) — they're sent first when the daily limit is tight.` });
  return {
    settings: { sending: st.sending, postalAddress: !!st.postalAddress, ...b },
    funnel: [
      { key: "contacts", label: "Contacts", n: contactsTotal },
      { key: "emailed", label: "Emailed", n: emailed },
      { key: "opened", label: "Opened", n: engagedEver },
      { key: "clicked", label: "Clicked", n: clickedEver },
      { key: "signed_up", label: "Signed up", n: stage("signed_up") + stage("trial") + stage("paying") },
      { key: "trial", label: "Trial", n: stage("trial") + stage("paying") },
      { key: "paying", label: "Paying", n: stage("paying") },
    ],
    stages: STAGES.map((s) => ({ stage: s, n: stage(s) })),
    statuses: statusRows,
    last30: { ...t, openRate: rate(t.opened, t.sends), clickRate: rate(t.clicked, t.sends), conversionRate: rate(t.converted, t.sends), bounceRate: rate(t.bounced, t.sends), unsubRate: rate(t.unsubs, t.sends) },
    daily: daily.rows,
    industries: byIndustry.map((x) => ({ ...x, clickRate: rate(x.clicked, x.sends), conversionRate: rate(x.converted, x.sends) })).sort((a, c2) => c2.sends - a.sends),
    hours: byHour.rows,
    learned,
    tracking: { machineOpens: m.opens, machineClicks: m.clicks, resends: m.resends, resendOpened: m.resendOpened, replies: m.replies },
    attribution: { exact: attribution.find((a) => a.attribution === "exact")?.n ?? 0, matched: attribution.find((a) => a.attribution === "matched")?.n ?? 0, paying: attribution.reduce((a, x) => a + x.paying, 0), mrr: attribution.reduce((a, x) => a + x.mrr, 0) },
    clients,
    links: links.rows,
    hotLeads: hot.map((h) => ({ ...h, why: h.repliedAt ? "Replied to an email" : h.clicks > 1 ? `Clicked ${h.clicks} times` : h.clicks ? "Clicked through" : `Opened ${h.opens} times` })),
    decisions: events.map((x) => ({ id: x.id, at: x.createdAt, text: String((x.detail as { text?: string }).text ?? ""), level: String((x.detail as { level?: string }).level ?? "info") })),
  };
}

export async function activityFeed(limit = 100) {
  return db
    .select({ id: V.id, kind: V.kind, detail: V.detail, at: V.createdAt, email: C.email, name: C.name, funnel: F.name })
    .from(V)
    .leftJoin(C, eq(C.id, V.contactId))
    .leftJoin(F, eq(F.id, V.funnelId))
    .where(ne(V.kind, "engine"))
    .orderBy(desc(V.createdAt))
    .limit(Math.min(limit, 300));
}

export const _test = { enroll, budget };
