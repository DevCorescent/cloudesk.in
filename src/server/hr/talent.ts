// Departments and locations; goals and review cycles; company assets;
// announcements; and HR letters made from templates.
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { ASSET_CATEGORIES, renderLetter } from "@/lib/hr/model";
import { formatPrice } from "@/lib/store/money";
import { addEvent, check, isSelf, oversees, requireEmployee, requireManage, requireSelfOrOversee, requireWithin, todayIst, type Scope } from "./access";

// ─── Departments & locations ───

export async function departments(orgId: string) {
  return db
    .select({ d: schema.hrDepartments, people: sql<number>`(select count(*)::int from hr_employees e where e.department_id = hr_departments.id and e.status <> 'exited')` })
    .from(schema.hrDepartments)
    .where(eq(schema.hrDepartments.orgId, orgId))
    .orderBy(asc(schema.hrDepartments.name))
    .then((r) => r.map((x) => ({ ...x.d, people: x.people })));
}
export async function locations(orgId: string) {
  return db.select().from(schema.hrLocations).where(eq(schema.hrLocations.orgId, orgId)).orderBy(asc(schema.hrLocations.name));
}
const nameSchema = z.object({ name: z.string().trim().min(1, "Add a name").max(80), headId: z.uuid().nullable().default(null), address: z.string().trim().max(300).default(""), state: z.string().trim().toUpperCase().max(4).default("") });
export async function saveDepartment(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const { name, headId } = check(nameSchema, raw);
  if (headId) await requireEmployee(s.orgId, headId);
  if (id) {
    const [d] = await db.update(schema.hrDepartments).set({ name, headId }).where(and(eq(schema.hrDepartments.id, id), eq(schema.hrDepartments.orgId, s.orgId))).returning();
    if (!d) throw notFound("Department");
    return d;
  }
  const [d] = await db.insert(schema.hrDepartments).values({ orgId: s.orgId, name, headId }).returning();
  return d;
}
export async function saveLocation(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const { name, address, state } = check(nameSchema, raw);
  if (id) {
    const [l] = await db.update(schema.hrLocations).set({ name, address, state }).where(and(eq(schema.hrLocations.id, id), eq(schema.hrLocations.orgId, s.orgId))).returning();
    if (!l) throw notFound("Location");
    return l;
  }
  const [l] = await db.insert(schema.hrLocations).values({ orgId: s.orgId, name, address, state }).returning();
  return l;
}
export async function deleteDepartment(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.hrDepartments).where(and(eq(schema.hrDepartments.id, id), eq(schema.hrDepartments.orgId, s.orgId)));
}
export async function deleteLocation(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.hrLocations).where(and(eq(schema.hrLocations.id, id), eq(schema.hrLocations.orgId, s.orgId)));
}

// ─── Goals ───

const goalSchema = z.object({ employeeId: z.uuid(), title: z.string().trim().min(1, "Name the goal").max(160), detail: z.string().trim().max(2000).default(""), progress: z.number().int().min(0).max(100).default(0), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), status: z.enum(["on_track", "at_risk", "behind", "done"]).default("on_track"), weight: z.number().int().min(1).max(10).default(1) });

export async function goals(s: Scope, employeeId?: string) {
  const rows = await db.select({ g: schema.hrGoals, name: schema.hrEmployees.name }).from(schema.hrGoals).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrGoals.employeeId)).where(and(eq(schema.hrGoals.orgId, s.orgId), employeeId ? eq(schema.hrGoals.employeeId, employeeId) : undefined)).orderBy(asc(schema.hrGoals.dueDate));
  return rows.filter((x) => isSelf(s, x.g.employeeId) || oversees(s, x.g.employeeId)).map((x) => ({ ...x.g, name: x.name }));
}
export async function saveGoal(s: Scope, raw: unknown, id?: string) {
  const cur = id ? (await db.select().from(schema.hrGoals).where(and(eq(schema.hrGoals.id, id), eq(schema.hrGoals.orgId, s.orgId))))[0] : undefined;
  if (id && !cur) throw notFound("Goal");
  const input = check(goalSchema, { ...(cur ?? {}), dueDate: cur?.dueDate ? String(cur.dueDate) : null, ...(raw as object) });
  requireSelfOrOversee(s, input.employeeId);
  // A goal stays with the person it's for unless their manager or HR moves it.
  if (cur) {
    requireSelfOrOversee(s, cur.employeeId);
    if (input.employeeId !== cur.employeeId && !oversees(s, cur.employeeId)) throw new ApiError("forbidden", "Ask your manager to move this goal");
  }
  // People update progress on their own goals; setting or changing them is for their manager or HR.
  if (isSelf(s, input.employeeId) && !oversees(s, input.employeeId) && cur && (input.title !== cur.title || input.weight !== cur.weight)) throw new ApiError("forbidden", "Ask your manager to change the goal itself");
  if (cur) {
    const [g] = await db.update(schema.hrGoals).set(input).where(eq(schema.hrGoals.id, cur.id)).returning();
    return g;
  }
  const [g] = await db.insert(schema.hrGoals).values({ orgId: s.orgId, ...input }).returning();
  return g;
}
export async function deleteGoal(s: Scope, id: string) {
  const [g] = await db.select().from(schema.hrGoals).where(and(eq(schema.hrGoals.id, id), eq(schema.hrGoals.orgId, s.orgId)));
  if (!g) throw notFound("Goal");
  if (!oversees(s, g.employeeId)) throw new ApiError("forbidden", "Only their manager or HR can remove a goal");
  await db.delete(schema.hrGoals).where(eq(schema.hrGoals.id, id));
}

// ─── Reviews ───

/** Starts a review cycle: everyone active gets a self review, then their manager's. */
export async function startCycle(s: Scope, cycle: string) {
  requireManage(s);
  const name = cycle.trim().slice(0, 40);
  if (!name) throw new ApiError("validation_failed", "Name the cycle, like “2026 H2”");
  const people = await db.select({ id: schema.hrEmployees.id }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, s.orgId), eq(schema.hrEmployees.status, "active")));
  if (!people.length) throw new ApiError("validation_failed", "No one to review yet");
  const rows = await db.insert(schema.hrReviews).values(people.map((p) => ({ orgId: s.orgId, employeeId: p.id, cycle: name }))).onConflictDoNothing().returning();
  return { started: rows.length };
}

export async function reviews(s: Scope, cycle?: string) {
  const rows = await db.select({ r: schema.hrReviews, name: schema.hrEmployees.name, designation: schema.hrEmployees.designation, managerId: schema.hrEmployees.managerId }).from(schema.hrReviews).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrReviews.employeeId)).where(and(eq(schema.hrReviews.orgId, s.orgId), cycle ? eq(schema.hrReviews.cycle, cycle) : undefined)).orderBy(desc(schema.hrReviews.createdAt));
  const cycles = [...new Set((await db.select({ c: schema.hrReviews.cycle }).from(schema.hrReviews).where(eq(schema.hrReviews.orgId, s.orgId)).orderBy(desc(schema.hrReviews.createdAt))).map((x) => x.c))];
  return {
    cycles,
    reviews: rows
      .filter((x) => isSelf(s, x.r.employeeId) || oversees(s, x.r.employeeId))
      .map((x) => ({ ...x.r, name: x.name, designation: x.designation, mine: isSelf(s, x.r.employeeId), canManage: oversees(s, x.r.employeeId) && !isSelf(s, x.r.employeeId), ...(isSelf(s, x.r.employeeId) && x.r.status !== "done" ? { managerRating: null, managerNote: "" } : {}) })),
  };
}

const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), note: z.string().trim().max(5000).default("") });

export async function submitReview(s: Scope, id: string, raw: unknown) {
  const [r] = await db.select().from(schema.hrReviews).where(and(eq(schema.hrReviews.id, id), eq(schema.hrReviews.orgId, s.orgId)));
  if (!r) throw notFound("Review");
  const input = check(reviewSchema, raw);
  if (isSelf(s, r.employeeId) && r.status === "self") {
    await db.update(schema.hrReviews).set({ selfRating: input.rating, selfNote: input.note, status: "manager" }).where(eq(schema.hrReviews.id, id));
    return;
  }
  if (oversees(s, r.employeeId) && !isSelf(s, r.employeeId) && r.status === "self") throw new ApiError("conflict", "Waiting for their self review first");
  if (oversees(s, r.employeeId) && !isSelf(s, r.employeeId) && r.status === "manager") {
    await db.update(schema.hrReviews).set({ managerRating: input.rating, managerNote: input.note, status: "done" }).where(eq(schema.hrReviews.id, id));
    await addEvent(s.orgId, r.employeeId, "review", `Review ${r.cycle}: ${input.rating}/5`, s.userId);
    return;
  }
  throw new ApiError("forbidden", r.status === "done" ? "This review is complete" : "It's not your turn on this review");
}

// ─── Assets ───

const assetSchema = z.object({ name: z.string().trim().min(1, "Name it").max(120), tag: z.string().trim().max(40).default(""), serial: z.string().trim().max(80).default(""), category: z.enum(ASSET_CATEGORIES as [string, ...string[]]).default("laptop"), value: z.number().int().min(0).max(1e11).default(0), notes: z.string().trim().max(1000).default(""), status: z.enum(["available", "assigned", "repair", "retired"]).default("available") });

export async function assets(s: Scope) {
  requireManage(s);
  return db.select({ a: schema.hrAssets, holder: schema.hrEmployees.name }).from(schema.hrAssets).leftJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrAssets.employeeId)).where(eq(schema.hrAssets.orgId, s.orgId)).orderBy(asc(schema.hrAssets.category), asc(schema.hrAssets.name)).then((r) => r.map((x) => ({ ...x.a, holder: x.holder ?? "" })));
}
export async function saveAsset(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const cur = id ? (await db.select().from(schema.hrAssets).where(and(eq(schema.hrAssets.id, id), eq(schema.hrAssets.orgId, s.orgId))))[0] : undefined;
  if (id && !cur) throw notFound("Asset");
  const input = check(assetSchema, { ...(cur ?? {}), ...(raw as object) });
  if (cur) return (await db.update(schema.hrAssets).set(input).where(eq(schema.hrAssets.id, cur.id)).returning())[0];
  return (await db.insert(schema.hrAssets).values({ orgId: s.orgId, ...input }).returning())[0];
}
export async function assignAsset(s: Scope, id: string, employeeId: string | null) {
  requireManage(s);
  const [a] = await db.select().from(schema.hrAssets).where(and(eq(schema.hrAssets.id, id), eq(schema.hrAssets.orgId, s.orgId)));
  if (!a) throw notFound("Asset");
  if (employeeId) {
    const e = await requireEmployee(s.orgId, employeeId);
    if (a.employeeId && a.employeeId !== employeeId) throw new ApiError("conflict", "Take it back from its current holder first");
    await db.update(schema.hrAssets).set({ employeeId, assignedAt: new Date(), status: "assigned" }).where(eq(schema.hrAssets.id, id));
    await addEvent(s.orgId, e.id, "asset", `Given ${a.name}${a.tag ? ` (${a.tag})` : ""}`, s.userId);
  } else {
    if (a.employeeId) await addEvent(s.orgId, a.employeeId, "asset", `Returned ${a.name}${a.tag ? ` (${a.tag})` : ""}`, s.userId);
    await db.update(schema.hrAssets).set({ employeeId: null, assignedAt: null, status: "available" }).where(eq(schema.hrAssets.id, id));
  }
}

// ─── Announcements ───

export async function announcements(orgId: string) {
  return db.select().from(schema.hrAnnouncements).where(eq(schema.hrAnnouncements.orgId, orgId)).orderBy(desc(schema.hrAnnouncements.pinned), desc(schema.hrAnnouncements.createdAt)).limit(30);
}
export async function postAnnouncement(s: Scope, raw: unknown) {
  requireManage(s);
  const input = check(z.object({ title: z.string().trim().min(1, "Add a title").max(160), body: z.string().trim().max(5000).default(""), pinned: z.boolean().default(false) }), raw);
  return (await db.insert(schema.hrAnnouncements).values({ orgId: s.orgId, ...input, createdBy: s.userId }).returning())[0];
}
export async function deleteAnnouncement(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.hrAnnouncements).where(and(eq(schema.hrAnnouncements.id, id), eq(schema.hrAnnouncements.orgId, s.orgId)));
}

// ─── Letters ───

const fmtDate = (d: string | null | undefined) => (d ? new Date(`${String(d)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—");

/** Fills a letter template for one person; logged on their history. */
export async function letter(s: Scope, employeeId: string, templateId: string) {
  requireManage(s);
  const e = await requireEmployee(s.orgId, employeeId);
  requireWithin(s, employeeId);
  const t = s.settings.letters.find((x) => x.id === templateId);
  if (!t) throw notFound("Letter template");
  const [dept] = e.departmentId ? await db.select({ name: schema.hrDepartments.name }).from(schema.hrDepartments).where(eq(schema.hrDepartments.id, e.departmentId)) : [];
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
  const company = s.settings.company.legalName || org?.name || "";
  const text = renderLetter(t.body, {
    date: fmtDate(todayIst()),
    name: e.name,
    emp_no: e.empNo,
    designation: e.designation || "—",
    department: dept?.name ?? "—",
    join_date: fmtDate(String(e.joinDate)),
    exit_date: fmtDate(e.exitDate ? String(e.exitDate) : null),
    probation_end: fmtDate(e.probationEnd ? String(e.probationEnd) : null),
    ctc: e.ctc ? formatPrice(e.ctc, "INR") : "—",
    company,
    signatory: s.settings.company.signatory || "",
    signatory_title: s.settings.company.signatoryTitle || "",
  });
  await addEvent(s.orgId, e.id, "letter", `${t.name} issued`, s.userId);
  return { title: t.name, company, address: s.settings.company.address, text };
}

export async function birthdaysAndAnniversaries(orgId: string, days = 14) {
  const people = await db.select({ id: schema.hrEmployees.id, name: schema.hrEmployees.name, dob: schema.hrEmployees.dob, joinDate: schema.hrEmployees.joinDate, designation: schema.hrEmployees.designation }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, orgId), ne(schema.hrEmployees.status, "exited")));
  const today = todayIst();
  const md = (d: string) => d.slice(5);
  const window = Array.from({ length: days }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10));
  const out: { id: string; name: string; kind: "birthday" | "anniversary"; date: string; years?: number }[] = [];
  for (const p of people) {
    for (const d of window) {
      if (p.dob && md(String(p.dob)) === md(d)) out.push({ id: p.id, name: p.name, kind: "birthday", date: d });
      if (md(String(p.joinDate)) === md(d) && String(p.joinDate).slice(0, 4) < d.slice(0, 4)) out.push({ id: p.id, name: p.name, kind: "anniversary", date: d, years: Number(d.slice(0, 4)) - Number(String(p.joinDate).slice(0, 4)) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}


