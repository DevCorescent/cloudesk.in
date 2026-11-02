// Who is asking and what they may do. Every accounting call starts here: the
// workspace (with Accounting switched on), whether the member may post
// (accounts:write) and run the books (accounts:manage), and the settings —
// with the chart of accounts created the first time.
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_ACCOUNTS, settingsSchema, type AccSettings } from "@/lib/accounting/model";
import { isOn, isPartOn, moduleById, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { GST_CODE_STATE } from "@/lib/store/gst";
import type { Access } from "@/lib/org/model";
import { memberAccess } from "../org/org";

export type Scope = { orgId: string; userId: string; role: Role; write: boolean; manage: boolean; settings: AccSettings; partsOff: PartsOff; access?: Access };

export function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "accounts:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "accounting")) throw new ApiError("forbidden", "Switch on Accounting & GST in Settings → Features first");
  return { orgId, userId: ctx.user.id, role, write: can(role, "accounts:write"), manage: can(role, "accounts:manage"), settings: await ensureBooks(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, access: await memberAccess(orgId, ctx.user.id) };
}

/** The same scope for a member already checked by another module (the copilot), by their role. */
export async function scopeFor(orgId: string, userId: string, role: Role): Promise<Scope> {
  if (!can(role, "accounts:read")) throw new ApiError("forbidden", "Accounts isn't open to your role");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "accounting")) throw new ApiError("forbidden", "Switch on Accounting & GST in Settings → Features first");
  return { orgId, userId, role, write: can(role, "accounts:write"), manage: can(role, "accounts:manage"), settings: await ensureBooks(orgId), partsOff: (org?.partsOff ?? {}) as PartsOff, access: await memberAccess(orgId, userId) };
}

/** A scope for system work (sync on a schedule): acts as nobody. */
export async function systemScope(orgId: string): Promise<Scope> {
  return { orgId, userId: "", role: "owner", write: true, manage: true, settings: await ensureBooks(orgId), partsOff: {} };
}

export function requireWrite(s: Scope) {
  if (!s.write) throw new ApiError("forbidden", "Your role can't change the books");
}
export function requireManage(s: Scope) {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can change this");
}
export function requirePart(s: Scope, part: string) {
  if (!isPartOn(s.partsOff, "accounting", part)) throw new ApiError("forbidden", `${moduleById("accounting")?.parts?.find((p) => p.id === part)?.name ?? part} is switched off for this workspace`);
}

/** Default accounts added to Cloudesk after a workspace's chart was made (they're matched by key, so renamed ones stay as they are). */
export async function addMissingAccounts(orgId: string) {
  const have = new Set((await db.select({ key: schema.accAccounts.systemKey, code: schema.accAccounts.code }).from(schema.accAccounts).where(eq(schema.accAccounts.orgId, orgId))).flatMap((a) => [a.key ?? "", `#${a.code}`]));
  // Fixed assets existed before it had a key; give it one so depreciation can find it.
  if (!have.has("fixed_assets") && have.has("#1500")) {
    await db.update(schema.accAccounts).set({ systemKey: "fixed_assets" }).where(and(eq(schema.accAccounts.orgId, orgId), eq(schema.accAccounts.code, "1500"), isNull(schema.accAccounts.systemKey)));
    have.add("fixed_assets");
  }
  // So did repairs and maintenance; Assets & maintenance posts spare parts to it.
  if (!have.has("repairs") && have.has("#5290")) {
    await db.update(schema.accAccounts).set({ systemKey: "repairs" }).where(and(eq(schema.accAccounts.orgId, orgId), eq(schema.accAccounts.code, "5290"), isNull(schema.accAccounts.systemKey)));
    have.add("repairs");
  }
  const missing = DEFAULT_ACCOUNTS.filter((a) => a.key && !have.has(a.key) && !have.has(`#${a.code}`));
  if (missing.length) await db.insert(schema.accAccounts).values(missing.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? "other", systemKey: a.key ?? null, description: a.description ?? "" }))).onConflictDoNothing();
}

/** Settings, and on first use the default chart of accounts, with the business's state and GSTIN taken from invoicing if it's set up. */
export async function ensureBooks(orgId: string): Promise<AccSettings> {
  const [row] = await db.select().from(schema.accSettings).where(eq(schema.accSettings.orgId, orgId));
  if (row) return settingsSchema.parse(row.settings);
  const inv = await db.execute<{ data: { business?: { gstin?: string; address?: { state?: string } } } }>(sql`
    select s.data from invoice_settings s join invoice_owners o on o.id = s.project_id
    left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id
    where coalesce(p.org_id, b.org_id) = ${orgId} limit 1`);
  const biz = ((inv as unknown as { rows?: { data: { business?: { gstin?: string; address?: { state?: string } } } }[] }).rows ?? [])[0]?.data?.business;
  const gstin = (biz?.gstin ?? "").toUpperCase();
  const fromGstin = GST_CODE_STATE[gstin.slice(0, 2)] ?? "";
  const settings = settingsSchema.parse({ gstin, state: fromGstin });
  await db.transaction(async (tx) => {
    const [made] = await tx.insert(schema.accSettings).values({ orgId, settings }).onConflictDoNothing().returning();
    if (!made) return;
    await tx.insert(schema.accAccounts).values(DEFAULT_ACCOUNTS.map((a) => ({ orgId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? "other", systemKey: a.key ?? null, description: a.description ?? "" }))).onConflictDoNothing();
    const [bank] = await tx.select({ id: schema.accAccounts.id }).from(schema.accAccounts).where(sql`${schema.accAccounts.orgId} = ${orgId} and ${schema.accAccounts.systemKey} = 'bank'`);
    if (bank) await tx.update(schema.accSettings).set({ settings: { ...settings, defaultBankId: bank.id } }).where(eq(schema.accSettings.orgId, orgId));
  });
  const [after] = await db.select().from(schema.accSettings).where(eq(schema.accSettings.orgId, orgId));
  return settingsSchema.parse(after.settings);
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const merged = check(settingsSchema, { ...s.settings, ...(raw as object) });
  await db.update(schema.accSettings).set({ settings: merged, updatedAt: new Date() }).where(eq(schema.accSettings.orgId, s.orgId));
  return merged;
}

export async function nextNumber(orgId: string, kind: "journal" | "bill" | "debit_note" | "payment_run" | "receipt" | "intercompany", prefix: string) {
  const col = kind === "journal" ? "next_journal" : kind === "bill" ? "next_bill" : null;
  // Journals and bills have their own columns; other documents count in `counters`, each from 1.
  const rows = col
    ? await db.execute<{ n: number }>(sql`update acc_settings set ${sql.raw(col)} = ${sql.raw(col)} + 1 where org_id = ${orgId} returning ${sql.raw(col)} - 1 as n`)
    : await db.execute<{ n: number }>(sql`update acc_settings set counters = jsonb_set(counters, ${`{${kind}}`}::text[], to_jsonb(coalesce((counters->>${kind})::int, 1) + 1)) where org_id = ${orgId} returning (counters->>${kind})::int - 1 as n`);
  const n = Number((rows as unknown as { rows?: { n: number }[] }).rows?.[0]?.n);
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export const todayIst = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** GST state code (first two digits of a GSTIN) → two-letter state. */
export { GST_CODE_STATE };
