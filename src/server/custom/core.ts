// Custom fields on built-in records, the workspace's own objects and their
// records, rules checked on every save, links between records (with the
// records that link back), import and export, and bulk changes that can be
// undone. Table and column names only ever come from the ENTITY registry
// below — never from a request.
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ENTITIES, isEntity, isObjectEntity, type EntityId } from "@/lib/custom/entities";
import { brokenRules, bulkSchema, checkValues, fieldDefSchema, importTarget, LIMITS, objectSchema, recordNo, ruleSchema, unknownRefs, type FieldDef, type Values } from "@/lib/custom/model";
import { visibleTo, type ModuleId } from "@/lib/workspace/modules";
import { can, ROLES, type Permission, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { runImport, str } from "../import/run";
import { audit } from "../services/audit";
import { contains } from "../security/like";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; has: (m: ModuleId) => boolean };

const F = schema.customFields;
const V = schema.customValues;
const O = schema.customObjects;
const R = schema.customRecords;
const RL = schema.customRules;
const BR = schema.bulkRuns;
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

/** Where each built-in record lives, what names it, and who may read and fill in its fields. */
const TABLES: Record<EntityId, { table: string; title: string; read: Permission; write: Permission }> = {
  "inventory.item": { table: "inv_items", title: "name", read: "inventory:read", write: "inventory:write" },
  "inventory.supplier": { table: "inv_suppliers", title: "name", read: "inventory:read", write: "inventory:write" },
  "hr.employee": { table: "hr_employees", title: "name", read: "hr:manage", write: "hr:manage" },
  "work.project": { table: "work_projects", title: "name", read: "work:read", write: "work:write" },
  "maintenance.asset": { table: "mnt_assets", title: "name", read: "mnt:read", write: "mnt:write" },
  "logistics.vehicle": { table: "lgx_vehicles", title: "reg_no", read: "lgx:read", write: "lgx:write" },
  "helpdesk.ticket": { table: "hd_tickets", title: "subject", read: "hd:read", write: "hd:write" },
  "education.student": { table: "edu_students", title: "name", read: "edu:read", write: "edu:write" },
  "clinic.patient": { table: "clinic_patients", title: "name", read: "clinic:read", write: "clinic:write" },
  "construction.contract": { table: "con_contracts", title: "name", read: "con:read", write: "con:manage" },
};

function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}
const valuesFailed = (errors: Record<string, string>) => {
  const details = Object.fromEntries(Object.entries(errors).map(([k, m]) => [k, [m]]));
  throw new ApiError("validation_failed", Object.values(errors)[0] ?? "Check the fields", details);
};
const rulesFailed = (msgs: string[]) => {
  throw new ApiError("validation_failed", msgs.join(" · "), { rules: msgs });
};

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "custom:read");
  const [org] = await db.select({ modules: schema.organizations.modules }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  return { orgId, userId: ctx.user.id, role, write: can(role, "custom:write"), manage: can(role, "custom:manage"), has: (id) => visibleTo(visible, id) };
}
const requireManage = (s: Scope) => {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can change fields, objects and rules");
};

// ─── Entities ────────────────────────────────────────────────────────────────

type Obj = typeof O.$inferSelect;
type Target = { kind: "builtin"; entity: EntityId } | { kind: "object"; entity: string; obj: Obj };

export const canReadEntity = (s: Scope, e: EntityId) => s.has(ENTITIES[e].module) && can(s.role, TABLES[e].read);
const canWriteEntity = (s: Scope, e: EntityId) => s.has(ENTITIES[e].module) && can(s.role, TABLES[e].write) && s.write;
const canEditObject = (s: Scope, o: Obj) => s.has("objects") && s.write && (!o.editRoles.length || o.editRoles.includes(s.role) || s.manage);

async function object(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Object");
  const [o] = await db.select().from(O).where(and(eq(O.id, id), eq(O.orgId, s.orgId)));
  if (!o) throw notFound("Object");
  return o;
}

async function target(s: Scope, entity: string, need: "read" | "write"): Promise<Target> {
  if (isEntity(entity)) {
    if (!(need === "read" ? canReadEntity(s, entity) : canWriteEntity(s, entity))) throw new ApiError("forbidden", need === "read" ? `Your role can't see ${ENTITIES[entity].label.toLowerCase()}` : `Your role can't change ${ENTITIES[entity].label.toLowerCase()}`);
    return { kind: "builtin", entity };
  }
  if (isObjectEntity(entity)) {
    if (!s.has("objects")) throw new ApiError("forbidden", "Switch on Custom objects in Settings → Features first");
    const obj = await object(s, entity.slice(4));
    if (need === "write" && !canEditObject(s, obj)) throw new ApiError("forbidden", `Your role can't change ${obj.plural.toLowerCase()}`);
    return { kind: "object", entity, obj };
  }
  throw new ApiError("validation_failed", "Unknown kind of record");
}

/** The built-in record's own fields (for rules), or not found. */
async function builtinRow(s: Scope, e: EntityId, id: string): Promise<Record<string, unknown>> {
  if (!isId(id)) throw notFound(ENTITIES[e].noun);
  const t = TABLES[e];
  const cols = ENTITIES[e].builtin.map((b) => sql.raw(`"${b.key}"`));
  const r = await db.execute(sql`select ${sql.join(cols, sql`, `)} from ${sql.raw(`"${t.table}"`)} where id = ${id} and org_id = ${s.orgId}`);
  const row = (r as unknown as { rows: Record<string, unknown>[] }).rows?.[0] ?? (r as unknown as Record<string, unknown>[])[0];
  if (!row) throw notFound(ENTITIES[e].noun);
  return row;
}

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/** Records of a built-in entity, by id or by search, with a title and the match key. */
async function builtinList(s: Scope, e: EntityId, opts: { ids?: string[]; q?: string; limit?: number }) {
  const t = TABLES[e];
  const m = ENTITIES[e].match;
  const where: SQL[] = [sql`org_id = ${s.orgId}`];
  if (opts.ids) where.push(opts.ids.length ? sql`id in ${opts.ids}` : sql`false`);
  if (opts.q) where.push(sql`(${sql.raw(`"${t.title}"`)}::text ilike ${contains(opts.q)} or ${sql.raw(`"${m}"`)}::text ilike ${contains(opts.q)})`);
  const r = await db.execute(sql`select id, ${sql.raw(`"${t.title}"`)}::text as title, ${sql.raw(`"${m}"`)}::text as match from ${sql.raw(`"${t.table}"`)} where ${sql.join(where, sql` and `)} order by ${sql.raw(`"${t.title}"`)} limit ${opts.limit ?? 500}`);
  return rowsOf<{ id: string; title: string | null; match: string | null }>(r).map((x) => ({ id: x.id, title: x.title ?? "", match: x.match ?? "" }));
}

// ─── Field definitions ───────────────────────────────────────────────────────

type FieldRow = typeof F.$inferSelect;
const asDef = (f: FieldRow): FieldDef & { id: string } => ({ id: f.id, key: f.key, label: f.label, type: f.type as FieldDef["type"], options: f.options, required: f.required, help: f.help, linkTo: f.linkTo, sort: f.sort });

export async function fieldsOf(orgId: string, entity: string) {
  return (await db.select().from(F).where(and(eq(F.orgId, orgId), eq(F.entity, entity))).orderBy(asc(F.sort), asc(F.createdAt))).map(asDef);
}

export async function fields(s: Scope, entity: string) {
  await target(s, entity, "read");
  return fieldsOf(s.orgId, entity);
}

async function hasValues(orgId: string, entity: string, key: string) {
  const t = isObjectEntity(entity)
    ? await db.select({ n: sql<number>`count(*)::int` }).from(R).where(and(eq(R.orgId, orgId), eq(R.objectId, entity.slice(4)), sql`${R.values} ? ${key}`, sql`${R.values}->${key} <> 'null'::jsonb`))
    : await db.select({ n: sql<number>`count(*)::int` }).from(V).where(and(eq(V.orgId, orgId), eq(V.entity, entity), sql`${V.values} ? ${key}`, sql`${V.values}->${key} <> 'null'::jsonb`));
  return Number(t[0]?.n ?? 0);
}

export async function saveField(s: Scope, entity: string, id: string | null, raw: unknown) {
  requireManage(s);
  const t = await target(s, entity, "read");
  const v = check(fieldDefSchema, raw);
  const existing = await fieldsOf(s.orgId, entity);
  if (t.kind === "builtin" && ENTITIES[t.entity].builtin.some((b) => b.key === v.key)) throw new ApiError("conflict", `"${v.key}" is already one of the ${ENTITIES[t.entity].noun}'s own fields — pick another key`);
  if (v.type === "link") {
    const to = v.linkTo!;
    if (!(isEntity(to) || (isObjectEntity(to) && (await db.select({ id: O.id }).from(O).where(and(eq(O.id, to.slice(4)), eq(O.orgId, s.orgId)))).length))) throw new ApiError("validation_failed", "Pick what it links to");
  }
  const clean = { ...v, linkTo: v.type === "link" ? v.linkTo : null };
  if (!id) {
    if (existing.length >= LIMITS.fieldsPerEntity) throw new ApiError("conflict", `At most ${LIMITS.fieldsPerEntity} fields each`);
    if (existing.some((f) => f.key === v.key)) throw new ApiError("conflict", `There's already a field "${v.key}"`);
    const [row] = await db.insert(F).values({ ...clean, orgId: s.orgId, entity, sort: v.sort || existing.length }).returning();
    await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.field_added", targetType: entity, targetId: row!.id, metadata: { key: v.key, type: v.type } });
    return asDef(row!);
  }
  const before = existing.find((f) => f.id === id);
  if (!before) throw notFound("Field");
  if (before.key !== v.key) throw new ApiError("conflict", "A field's key can't change — values are saved under it");
  if (before.type !== v.type && (await hasValues(s.orgId, entity, v.key))) throw new ApiError("conflict", "Records already have values for this field, so its type can't change. Add a new field instead.");
  const [row] = await db.update(F).set(clean).where(and(eq(F.id, id), eq(F.orgId, s.orgId))).returning();
  return asDef(row!);
}

/** Removes the field and its values everywhere; refused while a rule or the object's title uses it. */
export async function deleteField(s: Scope, id: string, confirm: unknown) {
  requireManage(s);
  if (!isId(id)) throw notFound("Field");
  const [f] = await db.select().from(F).where(and(eq(F.id, id), eq(F.orgId, s.orgId)));
  if (!f) throw notFound("Field");
  if (confirm !== f.key) throw new ApiError("validation_failed", `Type the field's key (${f.key}) to delete it and every value in it`);
  const rules = await db.select().from(RL).where(and(eq(RL.orgId, s.orgId), eq(RL.entity, f.entity)));
  const using = rules.filter((r) => [...r.when, ...r.then].some((c) => c.field === f.key || c.value === `@${f.key}`));
  if (using.length) throw new ApiError("conflict", `The rule “${using[0]!.name}” uses this field — change or delete it first`);
  if (isObjectEntity(f.entity)) {
    const [o] = await db.select({ titleField: O.titleField }).from(O).where(eq(O.id, f.entity.slice(4)));
    if (o?.titleField === f.key) throw new ApiError("conflict", "Records are named by this field — pick another title field first");
  }
  await db.transaction(async (tx) => {
    if (isObjectEntity(f.entity)) await tx.update(R).set({ values: sql`${R.values} - ${f.key}` }).where(and(eq(R.orgId, s.orgId), eq(R.objectId, f.entity.slice(4))));
    else await tx.update(V).set({ values: sql`${V.values} - ${f.key}` }).where(and(eq(V.orgId, s.orgId), eq(V.entity, f.entity)));
    await tx.delete(F).where(eq(F.id, f.id));
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.field_deleted", targetType: f.entity, targetId: f.id, metadata: { key: f.key, label: f.label } });
}

// ─── Rules ───────────────────────────────────────────────────────────────────

/** Keys a rule may refer to: the custom fields, plus a built-in record's own fields. */
async function ruleKeys(s: Scope, entity: string) {
  const keys = new Set((await fieldsOf(s.orgId, entity)).map((f) => f.key));
  if (isEntity(entity)) for (const b of ENTITIES[entity].builtin) keys.add(b.key);
  if (isObjectEntity(entity)) keys.add("number");
  return keys;
}

export async function rules(s: Scope, entity: string) {
  await target(s, entity, "read");
  return db.select().from(RL).where(and(eq(RL.orgId, s.orgId), eq(RL.entity, entity))).orderBy(asc(RL.createdAt));
}

export async function saveRule(s: Scope, entity: string, id: string | null, raw: unknown) {
  requireManage(s);
  await target(s, entity, "read");
  const v = check(ruleSchema, raw);
  const missing = unknownRefs(v, await ruleKeys(s, entity));
  if (missing.length) throw new ApiError("validation_failed", `There's no field “${missing[0]}”`);
  if (!id) {
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(RL).where(and(eq(RL.orgId, s.orgId), eq(RL.entity, entity)))) as [{ n: number }];
    if (n >= LIMITS.rulesPerEntity) throw new ApiError("conflict", `At most ${LIMITS.rulesPerEntity} rules each`);
    const [row] = await db.insert(RL).values({ ...v, orgId: s.orgId, entity, createdBy: s.userId }).returning();
    await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.rule_added", targetType: entity, targetId: row!.id, metadata: { name: v.name } });
    return row!;
  }
  if (!isId(id)) throw notFound("Rule");
  const [row] = await db.update(RL).set(v).where(and(eq(RL.id, id), eq(RL.orgId, s.orgId), eq(RL.entity, entity))).returning();
  if (!row) throw notFound("Rule");
  await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.rule_changed", targetType: entity, targetId: row.id, metadata: { name: v.name, active: v.active } });
  return row;
}

export async function deleteRule(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Rule");
  const [row] = await db.delete(RL).where(and(eq(RL.id, id), eq(RL.orgId, s.orgId))).returning();
  if (!row) throw notFound("Rule");
  await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.rule_deleted", targetType: row.entity, targetId: row.id, metadata: { name: row.name } });
}

async function activeRules(orgId: string, entity: string) {
  return (await db.select().from(RL).where(and(eq(RL.orgId, orgId), eq(RL.entity, entity), eq(RL.active, true)))) as unknown as Parameters<typeof brokenRules>[0];
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** id → title for each linked record a field points to (missing ones left out). */
async function titlesFor(s: Scope, linkTo: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const clean = [...new Set(ids.filter(isId))];
  if (!clean.length) return out;
  if (isEntity(linkTo)) for (const r of await builtinList(s, linkTo, { ids: clean })) out.set(r.id, r.title || r.match);
  else if (isObjectEntity(linkTo)) {
    const [o] = await db.select().from(O).where(and(eq(O.id, linkTo.slice(4)), eq(O.orgId, s.orgId)));
    if (o) for (const r of await db.select({ id: R.id, title: R.title, seq: R.seq }).from(R).where(and(eq(R.objectId, o.id), inArray(R.id, clean)))) out.set(r.id, r.title || recordNo(o.prefix, r.seq));
  }
  return out;
}

async function checkLinks(s: Scope, defs: FieldDef[], values: Values) {
  for (const f of defs) {
    const v = values[f.key];
    if (f.type !== "link" || typeof v !== "string") continue;
    if (!(await titlesFor(s, f.linkTo!, [v])).has(v)) throw new ApiError("validation_failed", `${f.label}: that record isn't there`, { [f.key]: ["That record isn't there"] });
  }
}

async function linkedTitles(s: Scope, defs: FieldDef[], rows: Values[]) {
  const out: Record<string, string> = {};
  for (const f of defs.filter((d) => d.type === "link")) {
    const ids = rows.map((r) => r[f.key]).filter((x): x is string => typeof x === "string");
    for (const [id, t] of await titlesFor(s, f.linkTo!, ids)) out[id] = t;
  }
  return out;
}

/** Records of the workspace's objects whose link fields point at this record. */
export async function backlinks(s: Scope, entity: string, id: string) {
  const linkFields = await db.select({ entity: F.entity, key: F.key, label: F.label }).from(F).where(and(eq(F.orgId, s.orgId), eq(F.type, "link"), eq(F.linkTo, entity)));
  if (!linkFields.length || !s.has("objects")) return [];
  const objs = new Map((await db.select().from(O).where(eq(O.orgId, s.orgId))).map((o) => [`obj:${o.id}`, o]));
  const out: { objectId: string; object: string; field: string; id: string; title: string }[] = [];
  for (const f of linkFields) {
    const o = objs.get(f.entity);
    if (!o) continue;
    const rows = await db.select({ id: R.id, title: R.title, seq: R.seq }).from(R).where(and(eq(R.objectId, o.id), sql`${R.values}->>${f.key} = ${id}`)).orderBy(desc(R.updatedAt)).limit(50);
    for (const r of rows) out.push({ objectId: o.id, object: o.name, field: f.label, id: r.id, title: r.title || recordNo(o.prefix, r.seq) });
  }
  return out;
}

export async function lookup(s: Scope, entity: string, q: string) {
  const t = await target(s, entity, "read");
  if (t.kind === "builtin") return (await builtinList(s, t.entity, { q: q.trim() || undefined, limit: 20 })).map((r) => ({ id: r.id, title: r.title || r.match, detail: r.match }));
  const n = /^[A-Z]*-?0*(\d+)$/i.exec(q.trim());
  const rows = await db
    .select({ id: R.id, title: R.title, seq: R.seq })
    .from(R)
    .where(and(eq(R.objectId, t.obj.id), q.trim() ? or(ilike(R.title, contains(q.trim())), n ? eq(R.seq, Number(n[1])) : sql`false`) : undefined))
    .orderBy(desc(R.updatedAt))
    .limit(20);
  return rows.map((r) => ({ id: r.id, title: r.title || recordNo(t.obj.prefix, r.seq), detail: recordNo(t.obj.prefix, r.seq) }));
}

// ─── Values on built-in records ──────────────────────────────────────────────

async function currentValues(orgId: string, entity: string, id: string): Promise<Values> {
  const [v] = await db.select({ values: V.values }).from(V).where(and(eq(V.orgId, orgId), eq(V.entity, entity), eq(V.recordId, id)));
  return (v?.values as Values | undefined) ?? {};
}

export async function getValues(s: Scope, entity: string, id: string) {
  const t = await target(s, entity, "read");
  if (t.kind !== "builtin") throw new ApiError("validation_failed", "Open the record instead");
  await builtinRow(s, t.entity, id);
  const defs = await fieldsOf(s.orgId, entity);
  const values = await currentValues(s.orgId, entity, id);
  return { fields: defs, values, titles: await linkedTitles(s, defs, [values]), backlinks: await backlinks(s, entity, id), canEdit: canWriteEntity(s, t.entity), manage: s.manage };
}

/** Saves some of a record's custom values; the record's rules see the result before it's kept. */
async function applyValues(s: Scope, entity: EntityId, id: string, input: Record<string, unknown>, defs: FieldDef[], rules: Parameters<typeof brokenRules>[0]) {
  const own = await builtinRow(s, entity, id);
  const { values, errors } = checkValues(defs, input, { partial: true });
  if (Object.keys(errors).length) valuesFailed(errors);
  await checkLinks(s, defs, values);
  const before = await currentValues(s.orgId, entity, id);
  const merged = { ...before, ...values };
  for (const f of defs) if (f.required && (merged[f.key] === null || merged[f.key] === undefined) && f.key in input) valuesFailed({ [f.key]: `${f.label} is needed` });
  const broken = brokenRules(rules, { ...own, ...merged });
  if (broken.length) rulesFailed(broken);
  await db
    .insert(V)
    .values({ orgId: s.orgId, entity, recordId: id, values: merged, updatedBy: s.userId })
    .onConflictDoUpdate({ target: [V.orgId, V.entity, V.recordId], set: { values: merged, updatedBy: s.userId, updatedAt: new Date() } });
  return { before, after: merged };
}

export async function putValues(s: Scope, entity: string, id: string, raw: unknown) {
  const t = await target(s, entity, "write");
  if (t.kind !== "builtin") throw new ApiError("validation_failed", "Open the record instead");
  const input = check(z.record(z.string(), z.unknown()), raw);
  const { after } = await applyValues(s, t.entity, id, input, await fieldsOf(s.orgId, entity), await activeRules(s.orgId, entity));
  return { values: after };
}

/** Every record of a built-in kind with its custom values — for the bulk screen and export. */
export async function entityRecords(s: Scope, entity: string, q?: string) {
  const t = await target(s, entity, "read");
  if (t.kind !== "builtin") throw new ApiError("validation_failed", "Open the object instead");
  const list = await builtinList(s, t.entity, { q: q?.trim() || undefined, limit: 2000 });
  const vals = list.length ? await db.select({ id: V.recordId, values: V.values }).from(V).where(and(eq(V.orgId, s.orgId), eq(V.entity, entity))) : [];
  const byId = new Map(vals.map((v) => [v.id, v.values as Values]));
  const defs = await fieldsOf(s.orgId, entity);
  const rows = list.map((r) => ({ ...r, values: byId.get(r.id) ?? {} }));
  return { fields: defs, records: rows, titles: await linkedTitles(s, defs, rows.map((r) => r.values)) };
}

/** Resolves an imported link cell (a name, number or id) to the record's id. */
async function resolveLink(s: Scope, f: FieldDef, cell: unknown): Promise<string | null> {
  const text = str(cell).trim();
  if (!text) return null;
  if (isId(text)) return text.toLowerCase();
  const hits = await lookup(s, f.linkTo!, text);
  const exact = hits.filter((h) => h.title.toLowerCase() === text.toLowerCase() || h.detail.toLowerCase() === text.toLowerCase());
  if (exact.length === 1) return exact[0]!.id;
  throw new ApiError("validation_failed", exact.length > 1 ? `${f.label}: more than one “${text}”` : `${f.label}: no record called “${text}”`);
}

export async function importValues(s: Scope, entity: string, raw: unknown) {
  const t = await target(s, entity, "write");
  if (t.kind !== "builtin") throw new ApiError("validation_failed", "Import into the object instead");
  const info = ENTITIES[t.entity];
  const defs = await fieldsOf(s.orgId, entity);
  if (!defs.length) throw new ApiError("conflict", `Add a field to ${info.label.toLowerCase()} first`);
  const rules = await activeRules(s.orgId, entity);
  const matchLabel = info.builtin.find((b) => b.key === info.match)!.label;
  const tgt = importTarget(`custom.${entity}`, `${info.label}: your fields`, info.noun, defs, { key: "__match", label: matchLabel });
  const tt = TABLES[t.entity];
  return runImport(tgt, raw, async (v, mode) => {
    const key = str(v.__match).trim();
    const r = await db.execute(sql`select id from ${sql.raw(`"${tt.table}"`)} where org_id = ${s.orgId} and ${sql.raw(`"${info.match}"`)}::text = ${key} limit 2`);
    const found = rowsOf<{ id: string }>(r);
    if (!found.length) throw new ApiError("not_found", `No ${info.noun} with ${matchLabel} “${key}”`);
    if (found.length > 1) throw new ApiError("conflict", `More than one ${info.noun} with ${matchLabel} “${key}”`);
    const id = found[0]!.id;
    const before = await currentValues(s.orgId, entity, id);
    const input: Record<string, unknown> = {};
    for (const f of defs) {
      if (!(f.key in v) || v[f.key] === null || v[f.key] === "") continue;
      if (mode === "skip" && before[f.key] !== undefined && before[f.key] !== null) continue;
      input[f.key] = f.type === "link" ? await resolveLink(s, f, v[f.key]) : v[f.key];
    }
    if (!Object.keys(input).length) return "skipped";
    await applyValues(s, t.entity, id, input, defs, rules);
    return "updated";
  });
}

// ─── Custom objects ──────────────────────────────────────────────────────────

const objOut = (o: Obj, count?: number) => ({ id: o.id, name: o.name, plural: o.plural, description: o.description, prefix: o.prefix, titleField: o.titleField, editRoles: o.editRoles, count: count ?? 0 });

export async function objects(s: Scope) {
  if (!s.has("objects")) return [];
  const rows = await db.select({ o: O, n: sql<number>`(select count(*)::int from "custom_records" where "custom_records"."object_id" = "custom_objects"."id")` }).from(O).where(eq(O.orgId, s.orgId)).orderBy(asc(O.plural));
  return rows.map((r) => ({ ...objOut(r.o, Number(r.n)), canEdit: canEditObject(s, r.o) }));
}

export async function saveObject(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  if (!s.has("objects")) throw new ApiError("forbidden", "Switch on Custom objects in Settings → Features first");
  const v = check(objectSchema, raw);
  const roles = v.editRoles.filter((r) => (ROLES as readonly string[]).includes(r));
  try {
    if (!id) {
      const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(O).where(eq(O.orgId, s.orgId))) as [{ n: number }];
      if (n >= LIMITS.objects) throw new ApiError("conflict", `At most ${LIMITS.objects} objects`);
      if (v.titleField) throw new ApiError("validation_failed", "Add the fields first, then pick the one that names a record");
      const [row] = await db.insert(O).values({ ...v, editRoles: roles, orgId: s.orgId, createdBy: s.userId }).returning();
      await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.object_added", targetType: "custom_object", targetId: row!.id, metadata: { name: v.plural } });
      return objOut(row!);
    }
    const o = await object(s, id);
    if (v.titleField && !(await fieldsOf(s.orgId, `obj:${o.id}`)).some((f) => f.key === v.titleField && ["text", "number", "date", "select", "email", "phone"].includes(f.type))) throw new ApiError("validation_failed", "Name records by a text, number, date, choice, email or phone field");
    const [row] = await db.update(O).set({ ...v, editRoles: roles }).where(eq(O.id, o.id)).returning();
    if (v.titleField !== o.titleField) await retitle(o.id, v.titleField);
    return objOut(row!);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") throw new ApiError("conflict", `There's already an object called “${v.plural}”`);
    throw e;
  }
}

async function retitle(objectId: string, titleField: string | null) {
  await db.update(R).set({ title: titleField ? sql`coalesce(${R.values}->>${titleField}, '')` : "" }).where(eq(R.objectId, objectId));
}

export async function deleteObject(s: Scope, id: string, confirm: unknown) {
  requireManage(s);
  const o = await object(s, id);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(R).where(eq(R.objectId, o.id))) as [{ n: number }];
  if (n && confirm !== o.plural) throw new ApiError("validation_failed", `Type “${o.plural}” to delete it with its ${n} record${n === 1 ? "" : "s"}`);
  const linkers = await db.select({ label: F.label, entity: F.entity }).from(F).where(and(eq(F.orgId, s.orgId), eq(F.linkTo, `obj:${o.id}`)));
  const outside = linkers.filter((l) => l.entity !== `obj:${o.id}`);
  if (outside.length) throw new ApiError("conflict", `The field “${outside[0]!.label}” links to ${o.plural.toLowerCase()} — delete it first`);
  await db.transaction(async (tx) => {
    await tx.delete(F).where(and(eq(F.orgId, s.orgId), eq(F.entity, `obj:${o.id}`)));
    await tx.delete(RL).where(and(eq(RL.orgId, s.orgId), eq(RL.entity, `obj:${o.id}`)));
    await tx.delete(O).where(eq(O.id, o.id));
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.object_deleted", targetType: "custom_object", targetId: o.id, metadata: { name: o.plural, records: n } });
}

export async function objectDetail(s: Scope, id: string) {
  const t = await target(s, `obj:${id}`, "read");
  if (t.kind !== "object") throw notFound("Object");
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from custom_records where object_id = ${t.obj.id}`)).rows as [{ n: number }];
  return { object: { ...objOut(t.obj, Number(n)), canEdit: canEditObject(s, t.obj) }, fields: await fieldsOf(s.orgId, t.entity) };
}

type Rec = typeof R.$inferSelect;
const recOut = (o: Obj, r: Rec) => ({ id: r.id, number: recordNo(o.prefix, r.seq), title: r.title || recordNo(o.prefix, r.seq), values: r.values as Values, createdAt: r.createdAt, updatedAt: r.updatedAt });

export async function records(s: Scope, objectId: string, qs: Record<string, string>) {
  const t = await target(s, `obj:${objectId}`, "read");
  if (t.kind !== "object") throw notFound("Object");
  const defs = await fieldsOf(s.orgId, t.entity);
  const where: SQL[] = [eq(R.objectId, t.obj.id)];
  const q = (qs.q ?? "").trim();
  if (q) {
    const n = /^[A-Z]*-?0*(\d+)$/i.exec(q);
    where.push(or(ilike(R.title, contains(q)), sql`${R.values}::text ilike ${contains(q)}`, n ? eq(R.seq, Number(n[1])) : sql`false`)!);
  }
  // A filter on one field: ?f=<key>&v=<value>
  if (qs.f && defs.some((d) => d.key === qs.f) && qs.v !== undefined) where.push(sql`${R.values}->>${qs.f} = ${qs.v}`);
  const rows = await db.select().from(R).where(and(...where)).orderBy(desc(R.updatedAt)).limit(LIMITS.bulk);
  const out = rows.map((r) => recOut(t.obj, r));
  return { records: out, titles: await linkedTitles(s, defs, out.map((r) => r.values)) };
}

async function recordRow(s: Scope, objectId: string, id: string) {
  if (!isId(id)) throw notFound("Record");
  const [r] = await db.select().from(R).where(and(eq(R.id, id), eq(R.objectId, objectId), eq(R.orgId, s.orgId)));
  if (!r) throw notFound("Record");
  return r;
}

export async function recordDetail(s: Scope, objectId: string, id: string) {
  const t = await target(s, `obj:${objectId}`, "read");
  if (t.kind !== "object") throw notFound("Object");
  const r = await recordRow(s, t.obj.id, id);
  const defs = await fieldsOf(s.orgId, t.entity);
  const [by] = await db.select({ c: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.updatedBy ?? r.createdBy ?? "00000000-0000-0000-0000-000000000000"));
  return { record: { ...recOut(t.obj, r), by: by?.c ?? null }, titles: await linkedTitles(s, defs, [r.values as Values]), backlinks: await backlinks(s, t.entity, r.id) };
}

const titleOf = (o: Obj, values: Values) => (o.titleField && values[o.titleField] !== null && values[o.titleField] !== undefined ? String(values[o.titleField]).slice(0, 200) : "");

export async function saveRecord(s: Scope, objectId: string, id: string | null, raw: unknown) {
  const t = await target(s, `obj:${objectId}`, "write");
  if (t.kind !== "object") throw notFound("Object");
  const defs = await fieldsOf(s.orgId, t.entity);
  if (!defs.length) throw new ApiError("conflict", `Add fields to ${t.obj.plural.toLowerCase()} first`);
  const input = check(z.record(z.string(), z.unknown()), raw);
  const before = id ? await recordRow(s, t.obj.id, id) : null;
  const { values, errors } = checkValues(defs, input, { partial: !!before });
  if (Object.keys(errors).length) valuesFailed(errors);
  await checkLinks(s, defs, values);
  const merged = { ...((before?.values as Values) ?? {}), ...values };
  for (const f of defs) if (f.required && (merged[f.key] === null || merged[f.key] === undefined)) valuesFailed({ [f.key]: `${f.label} is needed` });
  const broken = brokenRules(await activeRules(s.orgId, t.entity), { ...merged, number: before ? recordNo(t.obj.prefix, before.seq) : null });
  if (broken.length) rulesFailed(broken);
  if (before) {
    const [row] = await db.update(R).set({ values: merged, title: titleOf(t.obj, merged), updatedBy: s.userId, updatedAt: new Date() }).where(eq(R.id, before.id)).returning();
    return recOut(t.obj, row!);
  }
  const row = await db.transaction(async (tx) => {
    const [{ seq }] = (await tx.update(O).set({ seq: sql`${O.seq} + 1` }).where(eq(O.id, t.obj.id)).returning({ seq: O.seq })) as [{ seq: number }];
    return (await tx.insert(R).values({ orgId: s.orgId, objectId: t.obj.id, seq, title: titleOf(t.obj, merged), values: merged, createdBy: s.userId, updatedBy: s.userId }).returning())[0]!;
  });
  return recOut(t.obj, row);
}

export async function deleteRecord(s: Scope, objectId: string, id: string) {
  const t = await target(s, `obj:${objectId}`, "write");
  if (t.kind !== "object") throw notFound("Object");
  const r = await recordRow(s, t.obj.id, id);
  await db.delete(R).where(eq(R.id, r.id));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.record_deleted", targetType: t.entity, targetId: r.id, metadata: { number: recordNo(t.obj.prefix, r.seq), title: r.title, values: r.values } });
}

export async function importRecords(s: Scope, objectId: string, raw: unknown) {
  const t = await target(s, `obj:${objectId}`, "write");
  if (t.kind !== "object") throw notFound("Object");
  const defs = await fieldsOf(s.orgId, t.entity);
  if (!defs.length) throw new ApiError("conflict", `Add fields to ${t.obj.plural.toLowerCase()} first`);
  const title = defs.find((d) => d.key === t.obj.titleField);
  const tgt = importTarget(`custom.obj`, t.obj.plural, t.obj.name.toLowerCase(), defs);
  return runImport(tgt, raw, async (v, mode) => {
    const input: Record<string, unknown> = {};
    for (const f of defs) if (f.key in v) input[f.key] = f.type === "link" ? await resolveLink(s, f, v[f.key]) : v[f.key];
    if (title && input[title.key] !== null && input[title.key] !== undefined && input[title.key] !== "") {
      const [dupe] = await db.select({ id: R.id }).from(R).where(and(eq(R.objectId, t.obj.id), sql`lower(${R.title}) = lower(${String(input[title.key])})`)).limit(1);
      if (dupe) {
        if (mode === "skip") return "skipped";
        await saveRecord(s, objectId, dupe.id, input);
        return "updated";
      }
    }
    await saveRecord(s, objectId, null, input);
    return "created";
  });
}

// ─── Bulk changes ────────────────────────────────────────────────────────────

export async function bulkRuns(s: Scope) {
  const rows = await db.select({ r: BR, by: schema.users.name }).from(BR).leftJoin(schema.users, eq(schema.users.id, BR.createdBy)).where(eq(BR.orgId, s.orgId)).orderBy(desc(BR.createdAt)).limit(100);
  const names = new Map((await db.select({ id: O.id, plural: O.plural }).from(O).where(eq(O.orgId, s.orgId))).map((o) => [`obj:${o.id}`, o.plural]));
  return rows
    .filter(({ r }) => (isEntity(r.entity) ? canReadEntity(s, r.entity) : s.has("objects")))
    .map(({ r, by }) => ({ id: r.id, entity: r.entity, what: isEntity(r.entity) ? ENTITIES[r.entity].label : (names.get(r.entity) ?? "A deleted object"), action: r.action, field: r.field, value: r.value, changed: r.changed, skipped: r.skipped, status: r.status, by, createdAt: r.createdAt, undoneAt: r.undoneAt }));
}

/**
 * Sets one field on many records, or deletes many records of an object.
 * Each record is checked like a single save (values and rules); records that
 * fail are left alone and listed. What each record was before is kept so the
 * run can be undone.
 */
export async function bulk(s: Scope, raw: unknown) {
  const v = check(bulkSchema, raw);
  const ids = [...new Set(v.ids.map((x) => x.toLowerCase()))];
  const t = await target(s, v.entity, "write");
  const skipped: { id: string; reason: string }[] = [];
  const undo: Record<string, unknown>[] = [];
  let field: FieldDef | undefined;

  if (v.action === "delete") {
    if (t.kind !== "object") throw new ApiError("validation_failed", "Only your own objects' records can be deleted in bulk");
    if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can delete records in bulk");
    if (v.confirm !== ids.length) throw new ApiError("validation_failed", `Confirm by entering the number of records (${ids.length})`);
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(R).where(and(eq(R.objectId, t.obj.id), inArray(R.id, ids)));
      const have = new Set(rows.map((r) => r.id));
      for (const id of ids) if (!have.has(id)) skipped.push({ id, reason: "Not found" });
      if (rows.length) await tx.delete(R).where(inArray(R.id, rows.map((r) => r.id)));
      for (const r of rows) undo.push({ id: r.id, row: { ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() } });
    });
  } else {
    const defs = await fieldsOf(s.orgId, v.entity);
    field = defs.find((d) => d.key === v.field);
    if (!field) throw new ApiError("validation_failed", `There's no field “${v.field}”`);
    const { values, errors } = checkValues([field], { [field.key]: v.value }, { partial: true });
    if (Object.keys(errors).length) valuesFailed(errors);
    if (field.required && values[field.key] === null) valuesFailed({ [field.key]: `${field.label} is needed` });
    await checkLinks(s, [field], values);
    const rules = await activeRules(s.orgId, v.entity);
    const value = values[field.key] ?? null;
    if (t.kind === "builtin") {
      const exist = new Set((await builtinList(s, t.entity, { ids })).map((r) => r.id));
      for (const id of ids) {
        if (!exist.has(id)) {
          skipped.push({ id, reason: "Not found" });
          continue;
        }
        try {
          const { before } = await applyValues(s, t.entity, id, { [field.key]: value }, defs, rules);
          undo.push({ id, before: before[field.key] ?? null });
        } catch (e) {
          skipped.push({ id, reason: e instanceof ApiError ? e.message : "Couldn't save" });
        }
      }
    } else {
      const rows = await db.select().from(R).where(and(eq(R.objectId, t.obj.id), inArray(R.id, ids)));
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of ids) {
        const r = byId.get(id);
        if (!r) {
          skipped.push({ id, reason: "Not found" });
          continue;
        }
        const merged = { ...(r.values as Values), [field.key]: value };
        const broken = brokenRules(rules, { ...merged, number: recordNo(t.obj.prefix, r.seq) });
        if (broken.length) {
          skipped.push({ id, reason: broken.join(" · ") });
          continue;
        }
        await db.update(R).set({ values: merged, title: titleOf(t.obj, merged), updatedBy: s.userId, updatedAt: new Date() }).where(eq(R.id, r.id));
        undo.push({ id, before: (r.values as Values)[field.key] ?? null });
      }
    }
  }
  const [run] = await db
    .insert(BR)
    .values({ orgId: s.orgId, entity: v.entity, action: v.action, field: field?.key ?? null, value: v.action === "set" ? (checkValues([field!], { [field!.key]: v.value }, { partial: true }).values[field!.key] ?? null) : null, changed: undo.length, skipped, undo, createdBy: s.userId })
    .returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: v.action === "set" ? "custom.bulk_set" : "custom.bulk_delete", targetType: v.entity, targetId: run!.id, metadata: { field: field?.key, changed: undo.length, skipped: skipped.length, ids: undo.map((u) => u.id) } });
  return { id: run!.id, changed: undo.length, skipped };
}

/**
 * Puts records back as they were. A record changed again since the bulk run
 * (its value is no longer the one the run set), or a deleted record whose id
 * is taken, is left alone and listed.
 */
export async function undoBulk(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Bulk change");
  const [run] = await db.select().from(BR).where(and(eq(BR.id, id), eq(BR.orgId, s.orgId)));
  if (!run) throw notFound("Bulk change");
  if (!s.manage && run.createdBy !== s.userId) throw new ApiError("forbidden", "Only whoever made the change, or an owner or admin, can undo it");
  if (run.status !== "done") throw new ApiError("conflict", "This change has already been undone");
  const t = await target(s, run.entity, "write");
  const left: { id: string; reason: string }[] = [];
  let restored = 0;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  await db.transaction(async (tx) => {
    for (const u of run.undo as { id: string; before?: unknown; row?: Rec & { createdAt: string; updatedAt: string } }[]) {
      if (run.action === "delete" && u.row) {
        const [taken] = await tx.select({ id: R.id }).from(R).where(eq(R.id, u.id));
        if (taken || t.kind !== "object") {
          left.push({ id: u.id, reason: "Already there" });
          continue;
        }
        const [clash] = await tx.select({ id: R.id }).from(R).where(and(eq(R.objectId, u.row.objectId), eq(R.seq, u.row.seq)));
        if (clash) {
          left.push({ id: u.id, reason: "Its number has been reused" });
          continue;
        }
        await tx.insert(R).values({ ...u.row, createdAt: new Date(u.row.createdAt), updatedAt: new Date(u.row.updatedAt) });
        restored++;
        continue;
      }
      const key = run.field!;
      if (t.kind === "builtin") {
        const [cur] = await tx.select({ values: V.values }).from(V).where(and(eq(V.orgId, s.orgId), eq(V.entity, run.entity), eq(V.recordId, u.id)));
        const now = (cur?.values as Values | undefined)?.[key];
        if (!same(now, run.value)) {
          left.push({ id: u.id, reason: "Changed since" });
          continue;
        }
        await tx.update(V).set({ values: sql`jsonb_set(${V.values}, ${`{${key}}`}::text[], ${JSON.stringify(u.before ?? null)}::jsonb, true)`, updatedBy: s.userId, updatedAt: new Date() }).where(and(eq(V.orgId, s.orgId), eq(V.entity, run.entity), eq(V.recordId, u.id)));
      } else {
        const [cur] = await tx.select().from(R).where(eq(R.id, u.id));
        if (!cur || !same((cur.values as Values)[key], run.value)) {
          left.push({ id: u.id, reason: cur ? "Changed since" : "Deleted since" });
          continue;
        }
        const values = { ...(cur.values as Values), [key]: (u.before ?? null) as Values[string] };
        await tx.update(R).set({ values, title: titleOf(t.obj, values), updatedBy: s.userId, updatedAt: new Date() }).where(eq(R.id, u.id));
      }
      restored++;
    }
    await tx.update(BR).set({ status: "undone", undoneBy: s.userId, undoneAt: new Date() }).where(eq(BR.id, run.id));
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "custom.bulk_undone", targetType: run.entity, targetId: run.id, metadata: { restored, left: left.length } });
  return { restored, left };
}

/** What the screens need to start: which records this person can add fields to, and the objects. */
export async function meta(s: Scope) {
  const entities = (Object.keys(ENTITIES) as EntityId[]).filter((e) => canReadEntity(s, e)).map((e) => ({ id: e, label: ENTITIES[e].label, noun: ENTITIES[e].noun, builtin: ENTITIES[e].builtin, match: ENTITIES[e].match, canEdit: canWriteEntity(s, e) }));
  const counts = await db.select({ entity: F.entity, n: sql<number>`count(*)::int` }).from(F).where(eq(F.orgId, s.orgId)).groupBy(F.entity);
  return { me: { role: s.role, write: s.write, manage: s.manage, objects: s.has("objects") }, entities, objects: await objects(s), fieldCounts: Object.fromEntries(counts.map((c) => [c.entity, Number(c.n)])), roles: ROLES.filter((r) => r !== "owner") };
}
