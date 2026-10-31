// Calculator history: each person's own (never shared with colleagues), kept per
// workspace. Pinned entries stay when the rest is cleared; the oldest unpinned
// ones go once a person has more than 1,000.
import { and, desc, eq, ilike, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { formulaById } from "@/lib/calculator/formulas";
import { ApiError, notFound } from "../http/errors";
import { contains } from "../security/like";

const H = schema.calcHistory;
const KEEP = 1000;

export const entrySchema = z.object({
  kind: z.enum(["expr", "formula"]),
  input: z.string().trim().min(1).max(500),
  values: z.record(z.string().max(40), z.union([z.number(), z.string().max(40)])).optional(),
  result: z.string().trim().min(1).max(300),
  resultValue: z.number().finite().nullable().optional(),
  note: z.string().trim().max(200).default(""),
});

type Who = { orgId: string; userId: string };

export async function list(w: Who, q: { search?: string; pinned?: boolean; before?: string; limit?: number }) {
  const where = [eq(H.orgId, w.orgId), eq(H.userId, w.userId)];
  if (q.pinned) where.push(eq(H.pinned, true));
  if (q.search) where.push(or(ilike(H.input, contains(q.search)), ilike(H.result, contains(q.search)), ilike(H.note, contains(q.search)))!);
  if (q.before) {
    const d = new Date(q.before);
    if (!Number.isNaN(d.getTime())) where.push(lt(H.createdAt, d));
  }
  const rows = await db.select().from(H).where(and(...where)).orderBy(desc(H.pinned), desc(H.createdAt)).limit(Math.min(200, q.limit ?? 100));
  return rows.map(shape);
}

const shape = (r: typeof H.$inferSelect) => ({ id: r.id, kind: r.kind, input: r.input, values: r.values, result: r.result, resultValue: r.resultValue === null ? null : Number(r.resultValue), note: r.note, pinned: r.pinned, createdAt: r.createdAt });

export async function add(w: Who, raw: z.infer<typeof entrySchema>) {
  if (raw.kind === "formula" && !formulaById(raw.input)) throw new ApiError("validation_failed", "Unknown calculation");
  const [row] = await db.insert(H).values({ orgId: w.orgId, userId: w.userId, kind: raw.kind, input: raw.input, values: raw.values ?? null, result: raw.result, resultValue: raw.resultValue === undefined || raw.resultValue === null ? null : String(raw.resultValue), note: raw.note }).returning();
  // Keep the newest 1,000 (pinned ones never count against it).
  const keep = db.select({ id: H.id }).from(H).where(and(eq(H.orgId, w.orgId), eq(H.userId, w.userId), eq(H.pinned, false))).orderBy(desc(H.createdAt)).limit(KEEP);
  await db.delete(H).where(and(eq(H.orgId, w.orgId), eq(H.userId, w.userId), eq(H.pinned, false), notInArray(H.id, keep)));
  return shape(row!);
}

export async function update(w: Who, id: string, patch: { note?: string; pinned?: boolean }) {
  const [row] = await db.update(H).set({ ...(patch.note !== undefined ? { note: patch.note.slice(0, 200) } : {}), ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}) }).where(and(eq(H.id, id), eq(H.orgId, w.orgId), eq(H.userId, w.userId))).returning();
  if (!row) throw notFound("Entry");
  return shape(row);
}

export async function remove(w: Who, id: string) {
  const [row] = await db.delete(H).where(and(eq(H.id, id), eq(H.orgId, w.orgId), eq(H.userId, w.userId))).returning({ id: H.id });
  if (!row) throw notFound("Entry");
}

/** Clears the history; pinned entries stay unless asked. */
export async function clear(w: Who, includePinned: boolean) {
  const r = await db.delete(H).where(and(eq(H.orgId, w.orgId), eq(H.userId, w.userId), ...(includePinned ? [] : [eq(H.pinned, false)]))).returning({ id: H.id });
  return { removed: r.length };
}

export async function exportCsv(w: Who) {
  const rows = await db.select().from(H).where(and(eq(H.orgId, w.orgId), eq(H.userId, w.userId))).orderBy(desc(H.createdAt)).limit(5000);
  const cell = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : String(v ?? "");
    // A leading =, +, - or @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["when", "type", "calculation", "inputs", "result", "note", "pinned"];
  const lines = rows.map((r) => [r.createdAt, r.kind === "expr" ? "Calculation" : (formulaById(r.input)?.name ?? r.input), r.kind === "expr" ? r.input : "", r.values ? JSON.stringify(r.values) : "", r.result, r.note, r.pinned ? "yes" : ""].map(cell).join(","));
  return [head.join(","), ...lines].join("\n");
}

export const counts = async (w: Who) => {
  const [c] = await db.select({ n: sql<number>`count(*)::int`, pinned: sql<number>`count(*) filter (where ${H.pinned})::int` }).from(H).where(and(eq(H.orgId, w.orgId), eq(H.userId, w.userId)));
  return { total: c?.n ?? 0, pinned: c?.pinned ?? 0 };
};
