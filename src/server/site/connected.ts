// Fills a published page's connected sections with live records: open roles
// from HR (linking to the careers page) and upcoming events from Marketing
// (linking to their registration page). A module that's switched off, or
// that has nothing to show, gives the section's empty message — never stale
// or sample content.
import { and, asc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { careersHtml, eventsHtml, type EventItem, type Job } from "@/lib/site/sections-connected";
import { isOn } from "@/lib/workspace/modules";

const MARKER = /<!--cc:(careers|events):([a-z-]+):([A-Za-z0-9_-]*)-->/g;
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");

async function orgOf(projectId: string) {
  const [p] = await db.select({ orgId: schema.projects.orgId, modules: schema.organizations.modules }).from(schema.projects).innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId)).where(eq(schema.projects.id, projectId));
  return p ?? null;
}

async function openJobs(orgId: string): Promise<{ jobs: Job[]; token: string | null }> {
  const [st] = await db.select({ token: schema.hrSettings.careersToken }).from(schema.hrSettings).where(eq(schema.hrSettings.orgId, orgId));
  if (!st) return { jobs: [], token: null };
  const jobs = await db
    .select({ id: schema.hrJobs.id, title: schema.hrJobs.title, employmentType: schema.hrJobs.employmentType, salaryRange: schema.hrJobs.salaryRange, location: schema.hrLocations.name, department: schema.hrDepartments.name })
    .from(schema.hrJobs)
    .leftJoin(schema.hrLocations, eq(schema.hrLocations.id, schema.hrJobs.locationId))
    .leftJoin(schema.hrDepartments, eq(schema.hrDepartments.id, schema.hrJobs.departmentId))
    .where(and(eq(schema.hrJobs.orgId, orgId), eq(schema.hrJobs.status, "open")))
    .orderBy(asc(schema.hrJobs.title))
    .limit(50);
  return { jobs: jobs.map((j) => ({ ...j, salaryRange: j.salaryRange || null })), token: st.token };
}

async function upcoming(orgId: string, limit: number): Promise<EventItem[]> {
  const C = schema.mktCampaigns;
  const rows = await db
    .select({ name: C.name, eventAt: C.eventAt, venue: C.venue, onlineUrl: C.onlineUrl, capacity: C.capacity, token: C.regToken, id: C.id })
    .from(C)
    .where(and(eq(C.orgId, orgId), eq(C.kind, "event"), isNotNull(C.regToken), gte(C.eventAt, new Date()), sql`${C.status} not in ('draft','cancelled','ended')`))
    .orderBy(asc(C.eventAt))
    .limit(Math.min(12, Math.max(1, limit)));
  const out: EventItem[] = [];
  for (const r of rows) {
    let left: number | null = null;
    if (r.capacity) {
      const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.mktRegistrations).where(eq(schema.mktRegistrations.campaignId, r.id))) as [{ n: number }];
      left = Math.max(0, r.capacity - Number(n));
    }
    out.push({ name: r.name, when: r.eventAt ? r.eventAt.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null, venue: r.venue || null, online: !!r.onlineUrl, placesLeft: left, href: `${appUrl()}/e/${r.token}` });
  }
  return out;
}

export async function fillConnected(html: string, projectId: string): Promise<string> {
  if (!html.includes("<!--cc:careers:") && !html.includes("<!--cc:events:")) return html;
  const org = await orgOf(projectId);
  const found = [...html.matchAll(MARKER)];
  const parts = new Map<string, string>();
  for (const m of found) {
    if (parts.has(m[0])) continue;
    const [, kind, v, raw] = m;
    let p: Record<string, unknown> = {};
    try {
      p = JSON.parse(unb64(raw!)) as Record<string, unknown>;
    } catch {
      p = {};
    }
    if (kind === "careers") {
      const { jobs, token } = org && isOn(org.modules, "hr") ? await openJobs(org.orgId) : { jobs: [], token: null };
      parts.set(m[0], careersHtml(p, v!, token ? jobs : [], (j) => `${appUrl()}/careers/${token}#job-${j.id}`));
    } else {
      const events = org && isOn(org.modules, "marketing") ? await upcoming(org.orgId, Number(p.limit) || 6) : [];
      parts.set(m[0], eventsHtml(p, v!, events));
    }
  }
  return html.replace(MARKER, (m) => parts.get(m) ?? "");
}
