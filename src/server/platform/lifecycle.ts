// A workspace's own lifecycle, for its owners: letting platform support look
// in for a while, exporting everything it holds, scheduling its deletion
// (30 days to change their mind), and how long logs are kept.
import { gzipSync } from "node:zlib";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { defineJob, enqueue } from "../jobs/queue";
import { log } from "../log";
import { audit } from "../services/audit";
import { sendMail } from "../services/mail";

const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const GRACE_DAYS = 30;
const MAX_EXPORT_BYTES = 200 * 1024 * 1024;

// ── Support access ──────────────────────────────────────────────────────────

export async function grants(orgId: string) {
  return db.select({ g: schema.supportGrants, by: schema.users.name }).from(schema.supportGrants).leftJoin(schema.users, eq(schema.users.id, schema.supportGrants.grantedBy)).where(eq(schema.supportGrants.orgId, orgId)).orderBy(desc(schema.supportGrants.createdAt)).limit(20).then((r) => r.map(({ g, by }) => ({ ...g, by, active: !g.revokedAt && g.expiresAt > new Date() })));
}
export async function grant(orgId: string, actorId: string, raw: unknown) {
  const v = z.object({ hours: z.number().int().min(1).max(72), reason: z.string().trim().min(1, "Say why support needs to look").max(300) }).parse(raw);
  const [g] = await db.insert(schema.supportGrants).values({ orgId, grantedBy: actorId, reason: v.reason, expiresAt: new Date(Date.now() + v.hours * 3_600_000) }).returning();
  await audit({ orgId, actorId, action: "support.granted", targetType: "organization", targetId: orgId, metadata: { hours: v.hours, reason: v.reason } });
  return g;
}
export async function revokeGrant(orgId: string, actorId: string, id: string) {
  if (!isId(id)) throw notFound("Support access");
  await db.update(schema.supportGrants).set({ revokedAt: new Date() }).where(and(eq(schema.supportGrants.id, id), eq(schema.supportGrants.orgId, orgId), isNull(schema.supportGrants.revokedAt)));
  await audit({ orgId, actorId, action: "support.revoked", targetType: "organization", targetId: orgId });
}

// ── Export ──────────────────────────────────────────────────────────────────

/** Columns never exported: secrets, hashes and tokens. */
const SECRET = /(_enc|_hash|^password|secret|^token$|_token$|^totp)/;

export async function exports(orgId: string) {
  return db.select({ id: schema.orgExports.id, status: schema.orgExports.status, size: schema.orgExports.size, tables: schema.orgExports.tables, rows: schema.orgExports.rows, error: schema.orgExports.error, createdAt: schema.orgExports.createdAt, finishedAt: schema.orgExports.finishedAt, expiresAt: schema.orgExports.expiresAt }).from(schema.orgExports).where(eq(schema.orgExports.orgId, orgId)).orderBy(desc(schema.orgExports.createdAt)).limit(10);
}

export async function requestExport(orgId: string, actorId: string) {
  const [running] = await db.select({ id: schema.orgExports.id }).from(schema.orgExports).where(and(eq(schema.orgExports.orgId, orgId), eq(schema.orgExports.status, "queued")));
  if (running) throw new ApiError("conflict", "An export is already being made");
  const [e] = await db.insert(schema.orgExports).values({ orgId, requestedBy: actorId }).returning();
  await enqueue("org.export", { exportId: e.id }, { orgId, maxAttempts: 2 });
  await audit({ orgId, actorId, action: "workspace.export_requested", targetType: "org_export", targetId: e.id });
  return e;
}

/** Every table that has this workspace's id, as JSON (secrets left out), gzipped. Exported for tests. */
export async function buildExport(exportId: string) {
  const [e] = await db.select().from(schema.orgExports).where(eq(schema.orgExports.id, exportId));
  if (!e || e.status !== "queued") return;
  try {
    const cols = (await db.execute(sql`select table_name, column_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`)) as unknown as { rows: { table_name: string; column_name: string }[] };
    const byTable = new Map<string, string[]>();
    for (const c of cols.rows) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
    const out: Record<string, unknown> = { format: "cloudesk-workspace-export", version: 1, orgId: e.orgId, exportedAt: new Date().toISOString(), tables: {} };
    let rows = 0;
    let tables = 0;
    for (const [table, columns] of [...byTable.entries()].sort()) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
      const key = table === "organizations" ? "id" : columns.includes("org_id") ? "org_id" : null;
      if (!key || table === "org_exports") continue;
      const keep = columns.filter((c) => !SECRET.test(c) && /^[a-z_][a-z0-9_]*$/.test(c));
      const r = (await db.execute(sql`select ${sql.raw(keep.map((c) => `"${c}"`).join(", "))} from ${sql.raw(`"${table}"`)} where ${sql.raw(`"${key}"`)} = ${e.orgId}`)) as unknown as { rows: Record<string, unknown>[] };
      if (!r.rows.length) continue;
      // Files (bytea) are written as base64.
      (out.tables as Record<string, unknown>)[table] = r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Buffer.isBuffer(v) ? { base64: v.toString("base64") } : v])));
      rows += r.rows.length;
      tables++;
    }
    // People are shared across workspaces: only this one's members, without credentials.
    out.members = ((await db.execute(sql`select u.id, u.name, u.email, m.role, m.created_at from memberships m join users u on u.id = m.user_id where m.org_id = ${e.orgId}`)) as unknown as { rows: unknown[] }).rows;
    const bytes = gzipSync(Buffer.from(JSON.stringify(out)));
    if (bytes.length > MAX_EXPORT_BYTES) throw new Error("The export is larger than 200 MB; contact support for a database dump");
    await db.update(schema.orgExports).set({ status: "done", bytes, size: bytes.length, tables, rows, finishedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86_400_000) }).where(eq(schema.orgExports.id, e.id));
    const owners = (await db.execute(sql`select u.email from memberships m join users u on u.id = m.user_id where m.org_id = ${e.orgId} and m.role = 'owner'`)) as unknown as { rows: { email: string }[] };
    for (const o of owners.rows) await sendMail({ to: o.email, subject: "Your workspace export is ready", body: "The export you asked for is ready to download from Settings → Workspace for the next 7 days." }).catch(() => {});
  } catch (err) {
    log.warn("org_export_failed", { exportId, err: String(err) });
    await db.update(schema.orgExports).set({ status: "failed", error: String((err as Error).message ?? err).slice(0, 500), finishedAt: new Date() }).where(eq(schema.orgExports.id, e.id));
  }
}
defineJob<{ exportId: string }>("org.export", ({ exportId }) => buildExport(exportId), { timeoutMs: 15 * 60_000 });

export async function downloadExport(orgId: string, actorId: string, id: string) {
  if (!isId(id)) throw notFound("Export");
  const [e] = await db.select().from(schema.orgExports).where(and(eq(schema.orgExports.id, id), eq(schema.orgExports.orgId, orgId), eq(schema.orgExports.status, "done"), gt(schema.orgExports.expiresAt, new Date())));
  if (!e?.bytes) throw notFound("Export");
  await audit({ orgId, actorId, action: "workspace.export_downloaded", targetType: "org_export", targetId: e.id });
  return new Response(new Uint8Array(e.bytes), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="workspace-export-${e.createdAt.toISOString().slice(0, 10)}.json.gz"`, "Cache-Control": "private, no-store" } });
}

// ── Deletion ────────────────────────────────────────────────────────────────

export async function scheduleDeletion(orgId: string, actorId: string, raw: unknown) {
  const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const v = z.object({ confirm: z.string() }).parse(raw);
  if (v.confirm.trim() !== o.name) throw new ApiError("validation_failed", `Type the workspace name, ${o.name}, to confirm`, { confirm: ["Doesn't match"] });
  if (o.deletionScheduledAt) throw new ApiError("conflict", "Deletion is already scheduled");
  const at = new Date(Date.now() + GRACE_DAYS * 86_400_000);
  await db.update(schema.organizations).set({ deletionScheduledAt: at }).where(eq(schema.organizations.id, orgId));
  await audit({ orgId, actorId, action: "workspace.deletion_scheduled", targetType: "organization", targetId: orgId, metadata: { at } });
  const owners = (await db.execute(sql`select u.email from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId} and m.role = 'owner'`)) as unknown as { rows: { email: string }[] };
  for (const w of owners.rows) await sendMail({ to: w.email, subject: `${o.name} will be deleted on ${at.toDateString()}`, body: `The workspace ${o.name} and everything in it will be deleted for good on ${at.toUTCString()}. Until then, any owner can cancel this in Settings → Workspace. Export your data first if you need it.` }).catch(() => {});
  return { deletionScheduledAt: at };
}

export async function cancelDeletion(orgId: string, actorId: string) {
  await db.update(schema.organizations).set({ deletionScheduledAt: null }).where(eq(schema.organizations.id, orgId));
  await audit({ orgId, actorId, action: "workspace.deletion_cancelled", targetType: "organization", targetId: orgId });
}

// ── Retention and the hourly sweep ──────────────────────────────────────────

export const retentionSchema = z.object({ auditMonths: z.number().int().min(12).max(120).nullable(), notificationDays: z.number().int().min(30).max(3650) });
export async function retention(orgId: string) {
  const [r] = await db.select().from(schema.dataSettings).where(eq(schema.dataSettings.orgId, orgId));
  const s = (r?.settings ?? {}) as { auditMonths?: number | null; notificationDays?: number };
  return { auditMonths: s.auditMonths ?? null, notificationDays: s.notificationDays ?? 365 };
}
export async function saveRetention(orgId: string, actorId: string, raw: unknown) {
  const v = retentionSchema.parse(raw);
  const [r] = await db.select().from(schema.dataSettings).where(eq(schema.dataSettings.orgId, orgId));
  const settings = { ...((r?.settings ?? {}) as object), ...v };
  await db.insert(schema.dataSettings).values({ orgId, settings }).onConflictDoUpdate({ target: schema.dataSettings.orgId, set: { settings } });
  await audit({ orgId, actorId, action: "workspace.retention_changed", targetType: "organization", targetId: orgId, metadata: v });
  return v;
}

/** Delete workspaces past their grace period, expired exports, and logs past each workspace's retention. */
export async function sweep(now = new Date()) {
  const due = await db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(lt(schema.organizations.deletionScheduledAt, now));
  for (const o of due) {
    await audit({ actorId: null, action: "workspace.deleted", targetType: "organization", targetId: o.id, metadata: { name: o.name } });
    await db.delete(schema.organizations).where(eq(schema.organizations.id, o.id));
  }
  await db.update(schema.orgExports).set({ bytes: null }).where(and(lt(schema.orgExports.expiresAt, now), sql`${schema.orgExports.bytes} is not null`));
  const rows = await db.select().from(schema.dataSettings);
  for (const r of rows) {
    const s = (r.settings ?? {}) as { auditMonths?: number | null; notificationDays?: number };
    if (s.auditMonths) await db.delete(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, r.orgId), lt(schema.auditLogs.createdAt, new Date(now.getTime() - s.auditMonths * 30.44 * 86_400_000))));
    await db.delete(schema.notifications).where(and(eq(schema.notifications.orgId, r.orgId), lt(schema.notifications.createdAt, new Date(now.getTime() - (s.notificationDays ?? 365) * 86_400_000))));
  }
  // Sign-in records are kept a year.
  await db.delete(schema.loginEvents).where(lt(schema.loginEvents.at, new Date(now.getTime() - 365 * 86_400_000)));
  return { deleted: due.length };
}
