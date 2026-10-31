// Hiring: openings, candidates moving through stages, a public careers page
// where people apply, and turning a hire into an employee.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { appUrl } from "../services/mail";
import { CANDIDATE_STAGES, EMPLOYMENT_TYPES } from "@/lib/hr/model";
import { isOn, isPartOn, type PartsOff } from "@/lib/workspace/modules";
import { check, requireManage, todayIst, type Scope } from "./access";
import { checkRefs, createEmployee } from "./employees";

const jobSchema = z.object({ title: z.string().trim().min(1, "Name the role").max(120), departmentId: z.uuid().nullable().default(null), locationId: z.uuid().nullable().default(null), employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"), description: z.string().trim().max(10000).default(""), openings: z.number().int().min(1).max(500).default(1), salaryRange: z.string().trim().max(80).default(""), status: z.enum(["open", "paused", "closed"]).default("open") });
const candidateSchema = z.object({ jobId: z.uuid(), name: z.string().trim().min(1, "Add their name").max(120), email: z.string().trim().toLowerCase().max(200).default(""), phone: z.string().trim().max(30).default(""), source: z.string().trim().max(40).default("manual"), resumeUrl: z.string().trim().max(500).default("").refine((v) => !v || /^https?:\/\//.test(v), "Use an https:// link"), notes: z.string().trim().max(5000).default(""), rating: z.number().int().min(0).max(5).default(0), expectedCtc: z.number().int().min(0).nullable().default(null) });

export async function jobs(s: Scope) {
  requireManage(s);
  const rows = await db
    .select({ j: schema.hrJobs, total: sql<number>`(select count(*)::int from hr_candidates c where c.job_id = hr_jobs.id)`, active: sql<number>`(select count(*)::int from hr_candidates c where c.job_id = hr_jobs.id and c.stage not in ('hired','rejected'))`, hired: sql<number>`(select count(*)::int from hr_candidates c where c.job_id = hr_jobs.id and c.stage = 'hired')` })
    .from(schema.hrJobs)
    .where(eq(schema.hrJobs.orgId, s.orgId))
    .orderBy(asc(sql`case ${schema.hrJobs.status} when 'open' then 0 when 'paused' then 1 else 2 end`), desc(schema.hrJobs.createdAt));
  return { jobs: rows.map((r) => ({ ...r.j, total: r.total, active: r.active, hired: r.hired })), careersUrl: appUrl(`/careers/${s.careersToken}`) };
}

export async function saveJob(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const input = check(jobSchema, raw);
  await checkRefs(s, { departmentId: input.departmentId, locationId: input.locationId, managerId: null });
  if (id) {
    const [j] = await db.update(schema.hrJobs).set(input).where(and(eq(schema.hrJobs.id, id), eq(schema.hrJobs.orgId, s.orgId))).returning();
    if (!j) throw notFound("Job");
    return j;
  }
  const [j] = await db.insert(schema.hrJobs).values({ orgId: s.orgId, ...input }).returning();
  return j;
}

export async function pipeline(s: Scope, jobId: string) {
  requireManage(s);
  const [job] = await db.select().from(schema.hrJobs).where(and(eq(schema.hrJobs.id, jobId), eq(schema.hrJobs.orgId, s.orgId)));
  if (!job) throw notFound("Job");
  const people = await db.select().from(schema.hrCandidates).where(eq(schema.hrCandidates.jobId, jobId)).orderBy(desc(schema.hrCandidates.rating), desc(schema.hrCandidates.createdAt));
  return { job, columns: CANDIDATE_STAGES.map((st) => ({ stage: st, candidates: people.filter((p) => p.stage === st) })) };
}

export async function saveCandidate(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const cur = id ? (await db.select().from(schema.hrCandidates).where(and(eq(schema.hrCandidates.id, id), eq(schema.hrCandidates.orgId, s.orgId))))[0] : undefined;
  if (id && !cur) throw notFound("Candidate");
  const input = check(candidateSchema, { ...(cur ?? {}), ...(raw as object) });
  const [job] = await db.select({ id: schema.hrJobs.id }).from(schema.hrJobs).where(and(eq(schema.hrJobs.id, input.jobId), eq(schema.hrJobs.orgId, s.orgId)));
  if (!job) throw new ApiError("validation_failed", "Choose a job");
  if (cur) {
    const [c] = await db.update(schema.hrCandidates).set({ ...input, updatedAt: new Date() }).where(eq(schema.hrCandidates.id, cur.id)).returning();
    return c;
  }
  const [c] = await db.insert(schema.hrCandidates).values({ orgId: s.orgId, ...input }).returning();
  return c;
}

export async function moveCandidate(s: Scope, id: string, stage: string) {
  requireManage(s);
  if (!(CANDIDATE_STAGES as readonly string[]).includes(stage)) throw new ApiError("validation_failed", "Unknown stage");
  if (stage === "hired") throw new ApiError("validation_failed", "Use Hire to bring them on board");
  const [c] = await db.update(schema.hrCandidates).set({ stage, updatedAt: new Date() }).where(and(eq(schema.hrCandidates.id, id), eq(schema.hrCandidates.orgId, s.orgId))).returning();
  if (!c) throw notFound("Candidate");
  return c;
}

/** Hired: they become an employee (with an onboarding checklist); the job closes when its openings are filled. */
export async function hire(s: Scope, id: string, raw: { joinDate?: unknown; ctc?: unknown; designation?: unknown; managerId?: unknown }) {
  requireManage(s);
  const [c] = await db.select().from(schema.hrCandidates).where(and(eq(schema.hrCandidates.id, id), eq(schema.hrCandidates.orgId, s.orgId)));
  if (!c) throw notFound("Candidate");
  if (c.employeeId) throw new ApiError("conflict", "Already hired");
  const [job] = await db.select().from(schema.hrJobs).where(eq(schema.hrJobs.id, c.jobId));
  const e = await createEmployee(s, {
    name: c.name,
    email: c.email,
    phone: c.phone,
    designation: typeof raw.designation === "string" && raw.designation ? raw.designation : job.title,
    departmentId: job.departmentId,
    locationId: job.locationId,
    employmentType: job.employmentType,
    managerId: typeof raw.managerId === "string" && raw.managerId ? raw.managerId : null,
    joinDate: typeof raw.joinDate === "string" && raw.joinDate ? raw.joinDate : todayIst(),
    ctc: Number(raw.ctc) || c.expectedCtc || 0,
  });
  await db.update(schema.hrCandidates).set({ stage: "hired", employeeId: e.id, updatedAt: new Date() }).where(eq(schema.hrCandidates.id, id));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.hrCandidates).where(and(eq(schema.hrCandidates.jobId, job.id), eq(schema.hrCandidates.stage, "hired")));
  if (n >= job.openings) await db.update(schema.hrJobs).set({ status: "closed" }).where(eq(schema.hrJobs.id, job.id));
  return e;
}

// ─── Public careers page ───

async function orgByToken(token: string) {
  const [row] = await db.select({ orgId: schema.hrSettings.orgId, name: schema.organizations.name, modules: schema.organizations.modules, partsOff: schema.organizations.partsOff, settings: schema.hrSettings.settings }).from(schema.hrSettings).innerJoin(schema.organizations, eq(schema.organizations.id, schema.hrSettings.orgId)).where(eq(schema.hrSettings.careersToken, token));
  return row && isOn(row.modules, "hr") && isPartOn(row.partsOff as PartsOff, "hr", "hiring") ? row : null;
}

export async function careers(token: string) {
  const org = await orgByToken(token);
  if (!org) return null;
  const list = await db
    .select({ id: schema.hrJobs.id, title: schema.hrJobs.title, employmentType: schema.hrJobs.employmentType, description: schema.hrJobs.description, salaryRange: schema.hrJobs.salaryRange, location: schema.hrLocations.name, department: schema.hrDepartments.name })
    .from(schema.hrJobs)
    .leftJoin(schema.hrLocations, eq(schema.hrLocations.id, schema.hrJobs.locationId))
    .leftJoin(schema.hrDepartments, eq(schema.hrDepartments.id, schema.hrJobs.departmentId))
    .where(and(eq(schema.hrJobs.orgId, org.orgId), eq(schema.hrJobs.status, "open")))
    .orderBy(asc(schema.hrJobs.title));
  return { company: ((org.settings as { company?: { legalName?: string } })?.company?.legalName || org.name) as string, jobs: list };
}

const applySchema = z.object({ jobId: z.uuid(), name: z.string().trim().min(1, "Add your name").max(120), email: z.string().trim().toLowerCase().email("Enter a valid email").max(200), phone: z.string().trim().max(30).default(""), resumeUrl: z.string().trim().max(500).default("").refine((v) => !v || /^https?:\/\//.test(v), "Link to your CV with https://"), notes: z.string().trim().max(3000).default("") });

export async function apply(token: string, raw: unknown) {
  const org = await orgByToken(token);
  if (!org) throw new ApiError("not_found", "This careers page isn't available");
  const input = check(applySchema, raw);
  const [job] = await db.select().from(schema.hrJobs).where(and(eq(schema.hrJobs.id, input.jobId), eq(schema.hrJobs.orgId, org.orgId), eq(schema.hrJobs.status, "open")));
  if (!job) throw new ApiError("validation_failed", "This role is no longer open");
  const [dupe] = await db.select({ id: schema.hrCandidates.id }).from(schema.hrCandidates).where(and(eq(schema.hrCandidates.jobId, job.id), sql`lower(${schema.hrCandidates.email}) = ${input.email}`));
  if (dupe) return { ok: true, already: true };
  await db.insert(schema.hrCandidates).values({ orgId: org.orgId, jobId: job.id, name: input.name, email: input.email, phone: input.phone, resumeUrl: input.resumeUrl, notes: input.notes, source: "careers_page" });
  return { ok: true, already: false };
}
