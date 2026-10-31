// Master data and migration, workspace-wide: who may export lists (every
// export is logged), the history of imports with their failed rows and money
// totals to reconcile, saved column mappings, duplicates across suppliers,
// items and customers — and merging two suppliers into one.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isOn } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { audit } from "../services/audit";
import { contains } from "../security/like";

export type Scope = { orgId: string; userId: string; role: Role; manage: boolean; auditor: boolean; modules: string[] | null };
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields");
  return r.data;
}

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  const [o] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return { orgId, userId: ctx.user.id, role, manage: can(role, "org:update"), auditor: can(role, "audit:read"), modules: (o?.modules as string[] | null) ?? null };
}

// ── Export rules ────────────────────────────────────────────────────────────

export const settingsSchema = z.object({ exports: z.enum(["everyone", "team", "managers"]).default("everyone") });
export async function getSettings(orgId: string) {
  const [r] = await db.select().from(schema.dataSettings).where(eq(schema.dataSettings.orgId, orgId));
  return settingsSchema.parse(r?.settings ?? {});
}
export async function saveSettings(s: Scope, raw: unknown) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can change this");
  const v = check(settingsSchema, raw);
  await db.insert(schema.dataSettings).values({ orgId: s.orgId, settings: v }).onConflictDoUpdate({ target: schema.dataSettings.orgId, set: { settings: v } });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "data.export_rule_changed", targetType: "organization", targetId: s.orgId, metadata: v });
  return v;
}

const mayExport = (rule: "everyone" | "team" | "managers", role: Role) => rule === "everyone" || (rule === "team" ? role !== "employee" && role !== "viewer" : role === "owner" || role === "admin");

/** Check the workspace's rule before a list is downloaded, and log it. */
export async function recordExport(s: Scope, raw: unknown) {
  const v = check(z.object({ name: z.string().trim().min(1).max(80), rows: z.number().int().min(0).max(10_000_000), format: z.enum(["csv", "xlsx"]), page: z.string().max(300).default("") }), raw);
  const rule = (await getSettings(s.orgId)).exports;
  if (!mayExport(rule, s.role)) {
    await audit({ orgId: s.orgId, actorId: s.userId, action: "data.export_blocked", targetType: "organization", targetId: s.orgId, metadata: v });
    throw new ApiError("forbidden", rule === "managers" ? "Only workspace owners and admins can download lists here" : "Your role can't download lists here");
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "data.exported", targetType: "organization", targetId: s.orgId, metadata: v });
  return { ok: true };
}

// ── Import history ──────────────────────────────────────────────────────────

const totalsSchema = z.record(z.string().max(60), z.object({ label: z.string().max(120), file: z.number(), saved: z.number(), money: z.boolean() })).refine((x) => Object.keys(x).length <= 20, "Too many totals");
const startSchema = z.object({ target: z.string().max(60), fileName: z.string().max(200).default(""), mode: z.string().max(20).default(""), rows: z.number().int().min(0).max(1_000_000), totals: totalsSchema.default({}) });
const finishSchema = z.object({ created: z.number().int().min(0), updated: z.number().int().min(0), skipped: z.number().int().min(0), errors: z.array(z.object({ row: z.number().int().min(0), message: z.string().max(500), data: z.record(z.string().max(60), z.unknown()).default({}) })).max(5000).default([]), totals: totalsSchema.default({}) });

export async function startRun(s: Scope, raw: unknown) {
  if (s.role === "viewer" || s.role === "employee") throw new ApiError("forbidden", "Your role can't import here");
  const v = check(startSchema, raw);
  const [r] = await db.insert(schema.importRuns).values({ ...v, orgId: s.orgId, createdBy: s.userId }).returning({ id: schema.importRuns.id });
  return r;
}

export async function finishRun(s: Scope, id: string, raw: unknown) {
  if (!isId(id)) throw notFound("Import");
  const v = check(finishSchema, raw);
  const [r] = await db
    .update(schema.importRuns)
    .set({ created: v.created, updated: v.updated, skipped: v.skipped, failed: v.errors.length, errors: v.errors.slice(0, 500), totals: v.totals, status: "done", finishedAt: new Date() })
    .where(and(eq(schema.importRuns.id, id), eq(schema.importRuns.orgId, s.orgId), eq(schema.importRuns.createdBy, s.userId), eq(schema.importRuns.status, "running")))
    .returning();
  if (!r) throw notFound("Import");
  await audit({ orgId: s.orgId, actorId: s.userId, action: "data.imported", targetType: "import_run", targetId: r.id, metadata: { target: r.target, file: r.fileName, rows: r.rows, created: r.created, updated: r.updated, skipped: r.skipped, failed: r.failed } });
  return r;
}

/** Imports: everyone's for those who read the audit log, otherwise your own. */
export async function runs(s: Scope) {
  const I = schema.importRuns;
  const rows = await db.select({ r: I, by: schema.users.name }).from(I).leftJoin(schema.users, eq(schema.users.id, I.createdBy)).where(and(eq(I.orgId, s.orgId), s.auditor ? sql`true` : eq(I.createdBy, s.userId))).orderBy(desc(I.startedAt)).limit(200);
  return rows.map(({ r: { errors, ...r }, by }) => ({ ...r, by, hasErrors: errors.length > 0 }));
}

export async function runDetail(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Import");
  const [r] = await db.select().from(schema.importRuns).where(and(eq(schema.importRuns.id, id), eq(schema.importRuns.orgId, s.orgId), s.auditor ? sql`true` : eq(schema.importRuns.createdBy, s.userId)));
  if (!r) throw notFound("Import");
  return r;
}

// ── Saved mappings ──────────────────────────────────────────────────────────

const mappingSchema = z.object({ target: z.string().max(60), name: z.string().trim().min(1, "Name it").max(80), headers: z.array(z.string().max(200)).min(1).max(300), mapping: z.record(z.string().max(200), z.string().max(60).nullable()), constants: z.record(z.string().max(60), z.string().max(500)).default({}) });

export async function mappings(s: Scope, target: string) {
  return db.select().from(schema.importMappings).where(and(eq(schema.importMappings.orgId, s.orgId), target ? eq(schema.importMappings.target, target) : sql`true`)).orderBy(desc(schema.importMappings.updatedAt));
}
export async function saveMapping(s: Scope, raw: unknown) {
  if (s.role === "viewer" || s.role === "employee") throw new ApiError("forbidden", "Your role can't import here");
  const v = check(mappingSchema, raw);
  // A shared mapping someone else saved is theirs to change (or an owner's or admin's).
  const [cur] = await db.select({ createdBy: schema.importMappings.createdBy }).from(schema.importMappings).where(and(eq(schema.importMappings.orgId, s.orgId), eq(schema.importMappings.target, v.target), eq(schema.importMappings.name, v.name)));
  if (cur && cur.createdBy !== s.userId && !s.manage) throw new ApiError("forbidden", "Someone else saved a mapping with this name — pick another name");
  const [r] = await db.insert(schema.importMappings).values({ ...v, orgId: s.orgId, createdBy: s.userId }).onConflictDoUpdate({ target: [schema.importMappings.orgId, schema.importMappings.target, schema.importMappings.name], set: { headers: v.headers, mapping: v.mapping, constants: v.constants, updatedAt: new Date() } }).returning();
  return r;
}
export async function deleteMapping(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Mapping");
  await db.delete(schema.importMappings).where(and(eq(schema.importMappings.id, id), eq(schema.importMappings.orgId, s.orgId), s.manage ? sql`true` : eq(schema.importMappings.createdBy, s.userId)));
}

// ── Duplicates ──────────────────────────────────────────────────────────────

export const normName = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/\b(m\/s|messrs|the|private|pvt|limited|ltd|llp|inc|co|company|corp|corporation|enterprises?|traders?)\b\.?/g, " ").replace(/[^a-z0-9]/g, "");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

type Rec = { id: string; label: string; detail: string; link: string };
export type Group = { kind: "suppliers" | "items" | "customers"; reason: string; records: Rec[] };

/** Records that look like the same thing, grouped with the reason. */
export function groupBy<T>(rows: T[], keys: { reason: string; key: (r: T) => string }[], rec: (r: T) => Rec, kind: Group["kind"]): Group[] {
  const out: Group[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const by = new Map<string, T[]>();
    for (const r of rows) {
      const v = k.key(r);
      if (v) by.set(v, [...(by.get(v) ?? []), r]);
    }
    for (const list of by.values()) {
      if (list.length < 2) continue;
      const recs = list.map(rec);
      const sig = recs.map((r) => r.id).sort().join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ kind, reason: k.reason, records: recs });
    }
  }
  return out;
}

export async function duplicates(s: Scope) {
  const out: Group[] = [];
  if (isOn(s.modules, "inventory") && can(s.role, "inventory:read")) {
    const sups = await db.select().from(schema.invSuppliers).where(eq(schema.invSuppliers.orgId, s.orgId));
    out.push(...groupBy(sups, [{ reason: "Same GSTIN", key: (x) => (x.gstin ?? "").toUpperCase() }, { reason: "Same PAN", key: (x) => (x.pan ?? "").toUpperCase() || ((x.gstin ?? "").length === 15 ? x.gstin!.slice(2, 12).toUpperCase() : "") }, { reason: "Same bank account", key: (x) => (digits(x.bank?.account).length >= 8 ? digits(x.bank?.account) : "") }, { reason: "Same email", key: (x) => (x.email ?? "").toLowerCase() }, { reason: "Same name", key: (x) => normName(x.name) }], (x) => ({ id: x.id, label: x.name, detail: [x.gstin, x.email, x.phone, x.active ? "" : "inactive"].filter(Boolean).join(" · "), link: "/inventory/suppliers" }), "suppliers"));
    const items = await db.select({ id: schema.invItems.id, name: schema.invItems.name, sku: schema.invItems.sku, active: schema.invItems.active }).from(schema.invItems).where(eq(schema.invItems.orgId, s.orgId));
    out.push(...groupBy(items, [{ reason: "Same SKU", key: (x) => x.sku.trim().toUpperCase() }, { reason: "Same name", key: (x) => normName(x.name) }], (x) => ({ id: x.id, label: x.name, detail: [x.sku, x.active ? "" : "inactive"].filter(Boolean).join(" · "), link: `/inventory/items/${x.id}` }), "items"));
  }
  if (can(s.role, "invoices:manage")) {
    const owners = await db.select({ id: schema.invoiceOwners.id }).from(schema.invoiceOwners).leftJoin(schema.projects, eq(schema.projects.id, schema.invoiceOwners.projectId)).leftJoin(schema.financeBooks, eq(schema.financeBooks.id, schema.invoiceOwners.bookId)).where(sql`${schema.projects.orgId} = ${s.orgId} or ${schema.financeBooks.orgId} = ${s.orgId}`);
    if (owners.length) {
      const clients = await db.select().from(schema.invoiceClients).where(and(inArray(schema.invoiceClients.projectId, owners.map((o) => o.id)), sql`${schema.invoiceClients.archivedAt} is null`));
      out.push(...groupBy(clients, [{ reason: "Same GSTIN", key: (x) => (x.gstin ?? "").toUpperCase() }, { reason: "Same email", key: (x) => (x.email ?? "").toLowerCase() }, { reason: "Same name", key: (x) => normName(x.company || x.name) }], (x) => ({ id: x.id, label: x.company || x.name, detail: [x.name !== x.company ? x.name : "", x.email, x.gstin].filter(Boolean).join(" · "), link: "/finance" }), "customers"));
    }
  }
  return out;
}

// ── Merging suppliers ───────────────────────────────────────────────────────

/** Fold one supplier into another: everything that pointed at it points at the one kept, blanks are filled from it, and it's removed. */
export async function mergeSuppliers(s: Scope, raw: unknown) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can merge records");
  const v = check(z.object({ keepId: z.uuid(), dropId: z.uuid(), confirm: z.literal(true, "Confirm the merge") }), raw);
  if (v.keepId === v.dropId) throw new ApiError("validation_failed", "Pick two different suppliers");
  const S = schema.invSuppliers;
  const both = await db.select().from(S).where(and(eq(S.orgId, s.orgId), inArray(S.id, [v.keepId, v.dropId])));
  const keep = both.find((x) => x.id === v.keepId);
  const drop = both.find((x) => x.id === v.dropId);
  if (!keep || !drop) throw notFound("Supplier");
  if (keep.pendingBank || drop.pendingBank) throw new ApiError("conflict", "A bank change is waiting for approval on one of them — decide it first");
  const moved: Record<string, number> = {};
  try {
    await db.transaction(async (tx) => {
      // Every column that refers to a supplier, found from the database itself so none is missed.
      const refs = (await tx.execute(sql`select c.conrelid::regclass::text as tbl, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.confrelid = 'inv_suppliers'::regclass`)) as unknown as { rows: { tbl: string; col: string }[] };
      // …and "supplier_id" columns kept without a foreign key (quotes, returns, carriers, contracts, inspections).
      // Ids are unique, so only rows holding this supplier's id change.
      const soft = (await tx.execute(sql`select k.table_name as tbl, k.column_name as col from information_schema.columns k where k.table_schema = 'public' and k.column_name = 'supplier_id' and k.data_type = 'uuid' and not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.conrelid = (quote_ident(k.table_name))::regclass and a.attname = k.column_name)`)) as unknown as { rows: { tbl: string; col: string }[] };
      for (const { tbl, col } of [...refs.rows, ...soft.rows]) {
        if (!/^[a-z_][a-z0-9_]*$/.test(tbl) || !/^[a-z_][a-z0-9_]*$/.test(col)) throw new Error("Unexpected table name");
        const r = (await tx.execute(sql`update ${sql.raw(`"${tbl}"`)} set ${sql.raw(`"${col}"`)} = ${keep.id} where ${sql.raw(`"${col}"`)} = ${drop.id}`)) as unknown as { rowCount: number };
        if (r.rowCount) moved[tbl] = (moved[tbl] ?? 0) + r.rowCount;
      }
      // Supplier ids kept inside JSON: who an RFQ went to, and what it was awarded to.
      const rfqs = await tx.select().from(schema.invRfqs).where(and(eq(schema.invRfqs.orgId, s.orgId), sql`${schema.invRfqs.supplierIds} @> ${JSON.stringify([drop.id])}::jsonb or ${schema.invRfqs.award}::text like ${contains(drop.id)}`));
      for (const r of rfqs) {
        await tx.update(schema.invRfqs).set({ supplierIds: [...new Set(r.supplierIds.map((x) => (x === drop.id ? keep.id : x)))], award: r.award.map((a) => (a.supplierId === drop.id ? { ...a, supplierId: keep.id } : a)) }).where(eq(schema.invRfqs.id, r.id));
        moved.inv_rfqs = (moved.inv_rfqs ?? 0) + 1;
      }
      const fill = <K extends keyof typeof keep>(k: K) => (keep[k] === "" || keep[k] === null ? drop[k] : keep[k]);
      await tx.update(S).set({ gstin: fill("gstin"), pan: fill("pan"), email: fill("email"), phone: fill("phone"), contactName: fill("contactName"), bank: keep.bank?.account ? keep.bank : drop.bank }).where(eq(S.id, keep.id));
      await tx.delete(S).where(eq(S.id, drop.id));
    });
  } catch (e) {
    const msg = String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message ?? "");
    if (/duplicate key|unique/i.test(msg)) throw new ApiError("conflict", "Both suppliers have something that can only exist once per supplier (for example a quote on the same RFQ, or the same rate). Remove one of them, then merge.");
    throw e;
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "data.suppliers_merged", targetType: "inv_supplier", targetId: keep.id, metadata: { kept: keep.name, removed: drop.name, removedId: drop.id, moved } });
  return { kept: keep.id, moved };
}
