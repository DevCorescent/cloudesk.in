// Outreach for platform admins: contacts, templates, funnels and broadcasts,
// the engine that sends them, and the tracking that follows each email to a
// sign-up and a paid plan. See lib/outreach/model.ts for the rules.
//
// Every email carries an unsubscribe link and a one-click List-Unsubscribe
// header; unsubscribes, bounces and complaints are never emailed again; and
// nothing goes out while the master switch is off or without a postal address.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { freeFor } from "@/lib/festive";
import { BUILT_IN, BUILT_IN_FUNNELS, checkSteps, contactInput, INDUSTRIES, funnelInput, importSchema, industryOf, merge, nextSlot, parsePasted, pickArm, renderEmail, scoreOf, settingsInput, stageFromScore, STAGES, templateInput, warmupCap, type Audience, type ContactInput, type OutreachSettings, type Stage, type Step } from "@/lib/outreach/model";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { appUrl, sendMail } from "../services/mail";

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

export async function getSettings(): Promise<OutreachSettings & { startedAt: string | null }> {
  const [row] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, "outreach"));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  return { ...settingsInput.parse(v), startedAt: typeof v.startedAt === "string" ? v.startedAt : null };
}

export async function saveSettings(adminId: string, raw: unknown) {
  const v = check(settingsInput, raw);
  if (v.sending && !v.postalAddress) throw new ApiError("validation_failed", "Add your business's postal address first — the law asks for it in every promotional email", { postalAddress: ["Required to send"] });
  if (v.windowEnd <= v.windowStart) throw new ApiError("validation_failed", "The sending window must end after it starts");
  const cur = await getSettings();
  const value = { ...v, startedAt: v.sending ? (cur.startedAt ?? new Date().toISOString()) : cur.startedAt };
  await db.insert(schema.platformSettings).values({ key: "outreach", value, updatedBy: adminId }).onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedBy: adminId, updatedAt: new Date() } });
  if (v.sending !== cur.sending) await event("engine", { text: v.sending ? "Sending switched on" : "Sending switched off", by: adminId });
  return getSettings();
}

/** The built-in templates and funnels, added once (and any added to the library since). */
export async function ensureBuiltIns() {
  const have = new Set((await db.select({ key: T.key }).from(T)).map((r) => r.key));
  const missing = BUILT_IN.filter((t) => !have.has(t.key));
  if (missing.length) await db.insert(T).values(missing.map((t) => ({ key: t.key, name: t.name, category: t.category, industries: t.industries, subjects: t.subjects, preheader: t.preheader, body: t.body, ctaLabel: t.ctaLabel, ctaUrl: t.ctaUrl })));
  const haveF = new Set((await db.select({ key: F.key }).from(F)).map((r) => r.key));
  const missingF = BUILT_IN_FUNNELS.filter((f) => !haveF.has(f.key));
  if (missingF.length) await db.insert(F).values(missingF.map((f) => ({ key: f.key, name: f.name, kind: f.kind, status: "paused", audience: f.audience, steps: f.steps, goal: f.goal, autoEnroll: f.autoEnroll, autoOptimize: f.autoOptimize })));
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
  const rows: (ContactInput & { data: Record<string, string> })[] = [];
  v.rows.forEach((r, i) => {
    const s = (k: string) => (r[k] === null || r[k] === undefined ? "" : String(r[k]).trim());
    const name = s("name") || [s("first_name"), s("last_name")].filter(Boolean).join(" ");
    const data = Object.fromEntries(Object.entries(r).filter(([k, x]) => !FIELD_KEYS.has(k) && x !== null && x !== undefined && String(x).trim()).map(([k, x]) => [k.slice(0, 40), String(x).slice(0, 500)]));
    const p = contactInput.safeParse({ email: s("email"), name, company: s("company"), title: s("title"), phone: s("phone"), city: s("city"), state: s("state"), industry: s("industry"), size: s("size"), website: s("website"), tags: [...new Set([...s("tags").split(/[,;|]/).map((x) => x.trim()).filter(Boolean), ...v.tags])].slice(0, 20), notes: s("notes") });
    if (!p.success) errors.push({ row: i + 1, message: s("email") ? `“${s("email")}” isn't a valid email` : "No email" });
    else rows.push({ ...p.data, data });
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
  const parts: SQL[] = [eq(C.status, "active")];
  if (a.stages.length) parts.push(inArray(C.stage, a.stages));
  if (a.industries.length) parts.push(inArray(C.industry, a.industries));
  if (a.tags.length) parts.push(sql`${C.tags} && ${a.tags}::text[]`);
  if (a.sources.length) parts.push(inArray(C.source, a.sources));
  if (a.minScore !== null) parts.push(gte(C.score, a.minScore));
  return and(...parts)!;
}

export async function contacts(q: { q?: string; stage?: string; status?: string; industry?: string; source?: string; page?: string }) {
  const where: SQL[] = [];
  if (q.q?.trim()) {
    const t = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(C.email, t), ilike(C.name, t), ilike(C.company, t))!);
  }
  if (q.stage && (STAGES as readonly string[]).includes(q.stage)) where.push(eq(C.stage, q.stage));
  if (q.status) where.push(eq(C.status, q.status));
  if (q.industry) where.push(eq(C.industry, q.industry));
  if (q.source) where.push(eq(C.source, q.source));
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
    .where(where)
    .groupBy(S.templateId, S.variant, S.industry);
}
const sum = (rows: Arm[]): Arm => rows.reduce((a, r) => ({ sends: a.sends + r.sends, opens: a.opens + r.opens, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions }), { sends: 0, opens: 0, clicks: 0, conversions: 0 });

export async function templates() {
  await ensureBuiltIns();
  const [list, stats] = await Promise.all([db.select().from(T).where(eq(T.archived, false)).orderBy(asc(T.category), asc(T.name)), armStats()]);
  return {
    templates: list.map((t) => {
      const mine = stats.filter((s) => s.templateId === t.id);
      return { ...t, stats: sum(mine), variants: t.subjects.map((subject, i) => ({ subject, ...sum(mine.filter((s) => s.variant === i)) })) };
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
  const out = renderEmail({ body: merge(v.template.body, who, extra), preheader: merge(v.template.preheader, who, extra), ctaLabel: v.template.ctaLabel, ctaUrl: v.template.ctaUrl, link: (u) => u, pixel: "", unsubscribe: appUrl("/po/u/preview"), fromName: st.fromName, postalAddress: st.postalAddress || "[Your postal address — add it in Settings]", reason: reasonFor(c?.consent ?? "legitimate_interest", c?.source ?? "") });
  return { subject: merge(v.template.subjects[Math.min(v.variant, v.template.subjects.length - 1)]!, who, extra), html: out.html, text: out.text, to: who.email };
}

/** A test send to an admin's own address (not tracked or counted). */
export async function testSend(raw: unknown) {
  const v = check(z.object({ template: templateInput, to: z.email(), variant: z.number().int().min(0).max(3).default(0) }), raw);
  const p = await preview({ template: v.template, variant: v.variant });
  const st = await getSettings();
  await sendMail({ to: v.to, subject: `[Test] ${p.subject}`, body: p.text, html: p.html, fromName: st.fromName, ...(st.replyTo ? { replyTo: st.replyTo } : {}) });
  return { ok: true };
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
        db.select({ funnelId: S.funnelId, sends: sql<number>`count(*)::int`, opens: sql<number>`count(*) filter (where ${S.opens} > 0)::int`, clicks: sql<number>`count(*) filter (where ${S.clicks} > 0)::int`, conversions: sql<number>`count(*) filter (where ${S.convertedAt} is not null)::int`, unsubs: sql<number>`count(*) filter (where ${S.unsubscribedAt} is not null)::int`, bounces: sql<number>`count(*) filter (where ${S.status} = 'bounced')::int` }).from(S).where(inArray(S.funnelId, ids)).groupBy(S.funnelId),
      ])
    : [[], []];
  return {
    funnels: list.map((f) => {
      const e = enr.filter((x) => x.funnelId === f.id);
      const s = sends.find((x) => x.funnelId === f.id);
      return { ...f, enrolled: e.reduce((a, x) => a + x.n, 0), active: e.find((x) => x.status === "active")?.n ?? 0, converted: e.find((x) => x.status === "converted")?.n ?? 0, sends: s?.sends ?? 0, opens: s?.opens ?? 0, clicks: s?.clicks ?? 0, conversions: s?.conversions ?? 0, unsubs: s?.unsubs ?? 0, bounces: s?.bounces ?? 0 };
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
  return { funnel: f, steps: (f.steps as Step[]).map((s) => ({ ...s, ...(perStep.find((p) => p.stepId === s.id) ?? { sends: 0, opens: 0, clicks: 0, conversions: 0 }), waiting: waiting.find((w) => w.stepId === s.id)?.n ?? 0 })), audienceSize: audience[0]?.n ?? 0 };
}

export async function saveFunnel(id: string | null, raw: unknown) {
  const v = check(funnelInput, raw);
  const bad = checkSteps(v.steps);
  if (bad) throw new ApiError("validation_failed", bad);
  const values = { name: v.name, kind: v.kind, audience: v.audience, steps: v.steps, goal: v.goal, autoEnroll: v.kind === "broadcast" ? false : v.autoEnroll, autoOptimize: v.autoOptimize, startAt: v.startAt ? new Date(v.startAt) : null, updatedAt: new Date() };
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
  const r = (await db.execute(sql`
    insert into po_enrollments (funnel_id, contact_id, step_id, status, next_at)
    select ${f.id}, po_contacts.id, ${first}, 'active', ${at.toISOString()}::timestamptz
    from po_contacts
    where ${audienceWhere(f.audience as Audience)}
      and not exists (select 1 from po_enrollments e where e.contact_id = po_contacts.id and (e.funnel_id = ${f.id} or e.status = 'active'))
    order by po_contacts.score desc, po_contacts.created_at
    limit ${limit}
    on conflict do nothing
    returning id`)) as unknown as { rows: unknown[] };
  return r.rows.length;
}

// ── Tracking ────────────────────────────────────────────────────────────────

async function sendByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [s] = await db.select().from(S).where(eq(S.token, token));
  return s ?? null;
}

async function touch(contactId: string, change: { open?: boolean; click?: boolean }) {
  const [c] = await db.select().from(C).where(eq(C.id, contactId));
  if (!c) return;
  const opens = c.opens + (change.open ? 1 : 0);
  const clicks = c.clicks + (change.click ? 1 : 0);
  const now = new Date();
  const h = istHour(now);
  // Their best hour leans toward when they actually open.
  const bestHour = change.open ? (c.bestHour === null ? h : Math.round((c.bestHour * 3 + h) / 4)) : c.bestHour;
  const score = scoreOf({ opens, clicks, lastEventAt: now, stage: c.stage as Stage });
  await db.update(C).set({ opens, clicks, bestHour, score, stage: stageFromScore(score, c.stage as Stage), unopenedRun: 0, lastEventAt: now, updatedAt: now }).where(eq(C.id, c.id));
}

/** The tracking pixel: counts the open (the first one adds to the contact). */
export async function trackOpen(token: string) {
  const s = await sendByToken(token);
  if (!s) return;
  await db.update(S).set({ opens: sql`${S.opens} + 1`, openedAt: s.openedAt ?? new Date() }).where(eq(S.id, s.id));
  if (!s.openedAt) {
    await touch(s.contactId, { open: true });
    await event("open", {}, { contactId: s.contactId, sendId: s.id, funnelId: s.funnelId });
  }
}

/** A tracked link: counts the click (which also means it was opened) and returns where to go. */
export async function trackClick(token: string, encoded: string): Promise<string> {
  let url = "";
  try {
    url = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {}
  if (!/^https?:\/\//i.test(url)) url = appUrl("/");
  const s = await sendByToken(token);
  if (!s) return url;
  await db.update(S).set({ clicks: sql`${S.clicks} + 1`, clickedAt: s.clickedAt ?? new Date(), openedAt: s.openedAt ?? new Date(), opens: s.opens || 1 }).where(eq(S.id, s.id));
  if (!s.clickedAt) {
    await touch(s.contactId, { click: true, open: !s.openedAt });
    await event("click", { url: url.slice(0, 500) }, { contactId: s.contactId, sendId: s.id, funnelId: s.funnelId });
  }
  return url;
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

// ── The engine ──────────────────────────────────────────────────────────────

/** Contacts who signed up, started a trial or began paying: their stage moves on and the email that won them is credited. */
export async function syncConversions() {
  const signed = (await db.execute(sql`
    update po_contacts c set user_id = u.id, signed_up_at = coalesce(c.signed_up_at, u.created_at),
      stage = case when c.stage in ('new', 'engaged', 'hot', 'lost') then 'signed_up' else c.stage end, updated_at = now()
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
  }
  // Trial and paying, from their workspaces' subscriptions.
  const moved = (await db.execute(sql`
    with best as (
      select c.id, max(case when s.status = 'active' and s.monthly > 0 and not s.complimentary then 2 when s.status = 'trialing' then 1 else 0 end) as level
      from po_contacts c
      join memberships m on m.user_id = c.user_id
      join org_subscriptions s on s.org_id = m.org_id
      where c.user_id is not null and c.stage in ('signed_up', 'trial')
      group by c.id
    )
    update po_contacts c set stage = case when b.level = 2 then 'paying' else 'trial' end,
      paid_at = case when b.level = 2 then coalesce(c.paid_at, now()) else c.paid_at end, updated_at = now()
    from best b
    where b.id = c.id and b.level > 0 and c.stage <> case when b.level = 2 then 'paying' else 'trial' end
    returning c.id, c.stage`)) as unknown as { rows: { id: string; stage: string }[] };
  for (const r of moved.rows) await event(r.stage === "paying" ? "paid" : "trial", {}, { contactId: r.id });
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
  const cap = warmupCap(st, days);
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

async function sendOne(f: typeof F.$inferSelect | null, stepId: string | null, step: Extract<Step, { kind: "email" }>, c: Contact, st: OutreachSettings, rand: () => number) {
  const tpl = await chooseTemplate(step, c, f?.autoOptimize ?? true, rand);
  if (!tpl) return { sent: false as const, reason: "no template" };
  let variant = 0;
  if ((f?.autoOptimize ?? true) && tpl.subjects.length > 1) {
    const stats = await armStats(eq(S.templateId, tpl.id));
    variant = pickArm(tpl.subjects.map((_, i) => sum(stats.filter((s) => s.variant === i))), rand);
  }
  const tok = token();
  const extra = { trial: freeFor() };
  const subject = merge(tpl.subjects[variant]!, { ...c, data: c.data }, extra).slice(0, 200);
  const unsubscribeUrl = appUrl(`/po/u/${tok}`);
  const link = (url: string) => appUrl(`/api/v1/po/c/${tok}?u=${Buffer.from(withUtm(url, f, tpl.key ?? "", tok)).toString("base64url")}`);
  const out = renderEmail({ body: merge(tpl.body, { ...c, data: c.data }, extra), preheader: merge(tpl.preheader, { ...c, data: c.data }, extra), ctaLabel: tpl.ctaLabel, ctaUrl: tpl.ctaUrl, link, pixel: appUrl(`/api/v1/po/o/${tok}`), unsubscribe: unsubscribeUrl, fromName: st.fromName, postalAddress: st.postalAddress, reason: reasonFor(c.consent, c.source) });
  const [send] = await db.insert(S).values({ token: tok, contactId: c.id, funnelId: f?.id ?? null, templateId: tpl.id, stepId, variant, subject, industry: c.industry }).returning();
  const outboxId = await sendMail({ to: c.email, subject, body: out.text, html: out.html, fromName: st.fromName, ...(st.replyTo ? { replyTo: st.replyTo } : {}), headers: { "List-Unsubscribe": `<${appUrl(`/api/v1/po/u/${tok}`)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
  const [ob] = await db.select({ status: schema.outboundEmails.status, error: schema.outboundEmails.error }).from(schema.outboundEmails).where(eq(schema.outboundEmails.id, outboxId));
  const failed = ob?.status === "failed";
  // A permanent rejection (no such mailbox, bad domain) is a bounce: never emailed again.
  const bounced = failed && /(no such|does not exist|unknown user|invalid|not found|rejected|mailbox unavailable|5\.1\.1|user unknown)/i.test(ob?.error ?? "");
  if (failed) await db.update(S).set({ status: bounced ? "bounced" : "failed", error: (ob?.error ?? "").slice(0, 300) }).where(eq(S.id, send!.id));
  await db.update(C).set({ sends: sql`${C.sends} + 1`, lastEmailAt: new Date(), unopenedRun: sql`${C.unopenedRun} + 1`, ...(bounced ? { status: "bounced" } : {}), updatedAt: new Date() }).where(eq(C.id, c.id));
  if (bounced) await event("bounce", { error: (ob?.error ?? "").slice(0, 200) }, { contactId: c.id, sendId: send!.id, funnelId: f?.id ?? null });
  return { sent: !failed, sendId: send!.id };
}

const GOAL_RANK = { signed_up: 3, trial: 4, paying: 5 } as const;

/**
 * One pass of the engine: credit conversions, protect deliverability, enrol
 * new people, then move due people through their funnels — the most promising
 * first — within today's budget, at their best hour inside the window.
 */
export async function outreachTick(opts: { now?: Date; rand?: () => number; limit?: number } = {}) {
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? new Date();
  const st = await getSettings();
  await syncConversions().catch((e) => log.warn("outreach.sync_failed", { err: String(e) }));
  if (!st.sending) return { sent: 0, reason: "sending is off" };
  if (!st.postalAddress) return { sent: 0, reason: "no postal address" };
  await safetyCheck(st);
  for (const f of await db.select().from(F).where(and(eq(F.status, "active"), eq(F.kind, "funnel"), eq(F.autoEnroll, true)))) await enroll(f, 1000);
  let { left } = await budget(st);
  const perTick = Math.min(left, opts.limit ?? 200);
  if (perTick <= 0) return { sent: 0, reason: "daily limit reached" };
  const due = await db
    .select({ e: E, c: C, f: F })
    .from(E)
    .innerJoin(C, eq(C.id, E.contactId))
    .innerJoin(F, eq(F.id, E.funnelId))
    .where(and(eq(E.status, "active"), eq(F.status, "active"), lte(E.nextAt, now)))
    .orderBy(desc(C.score), asc(E.nextAt))
    .limit(perTick * 3);
  let sent = 0;
  for (const { e, c, f } of due) {
    if (sent >= perTick || left <= 0) break;
    const steps = f.steps as Step[];
    const stop = async (status: string, reason: string, stage?: Stage) => {
      await db.update(E).set({ status, exitReason: reason, nextAt: null, updatedAt: now }).where(eq(E.id, e.id));
      if (stage) await db.update(C).set({ stage, updatedAt: now }).where(eq(C.id, c.id));
    };
    if (c.status !== "active") {
      await stop("exited", c.status);
      continue;
    }
    if (STAGE_RANK[c.stage as Stage] >= GOAL_RANK[f.goal as keyof typeof GOAL_RANK]) {
      await stop("converted", f.goal);
      continue;
    }
    if (c.unopenedRun >= st.sunsetAfter) {
      await stop("exited", "unresponsive", STAGE_RANK[c.stage as Stage] < 3 ? "lost" : undefined);
      await event("engine", { text: `Stopped emailing ${c.email}: ${c.unopenedRun} emails in a row unopened` }, { contactId: c.id, funnelId: f.id });
      continue;
    }
    let i = steps.findIndex((s) => s.id === e.stepId);
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
        const gapUntil = c.lastEmailAt ? new Date(c.lastEmailAt.getTime() + st.minGapHours * 3_600_000) : now;
        const slot = nextSlot(gapUntil > now ? gapUntil : now, st, f.autoOptimize ? c.bestHour : null);
        if (slot.getTime() > now.getTime() + 60_000) {
          next = { at: slot, stepId: s.id };
          break;
        }
        if (left <= 0) {
          next = { at: new Date(now.getTime() + 3_600_000), stepId: s.id };
          break;
        }
        const r = await sendOne(f, s.id, s, c, st, rand);
        if (!r.sent && r.reason === "no template") {
          await stop("exited", "no template for this step");
          next = { at: null, stepId: null };
          break;
        }
        sent++;
        left--;
        if ("sendId" in r) lastSendId = r.sendId!;
        c.lastEmailAt = now;
        i++;
      }
    }
    if (next && next.stepId) await db.update(E).set({ stepId: next.stepId, nextAt: next.at, lastSendId, updatedAt: now }).where(eq(E.id, e.id));
    else if (next === null && lastSendId !== e.lastSendId) await db.update(E).set({ lastSendId, updatedAt: now }).where(eq(E.id, e.id));
  }
  if (sent) log.info("outreach.sent", { sent });
  return { sent };
}

// ── The picture ─────────────────────────────────────────────────────────────

const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

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
  const bestHour = byHour.rows.length ? byHour.rows.reduce((a, r) => (r.n > a.n ? r : a)) : null;
  if (bestHour && bestHour.n >= 20) learned.push({ text: `Most opens happen around ${String(bestHour.hour).padStart(2, "0")}:00 — people without their own history are sent then.` });
  const topInd = byIndustry.filter((x) => x.sends >= 30).sort((a, c2) => c2.converted / c2.sends - a.converted / a.sends)[0];
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
