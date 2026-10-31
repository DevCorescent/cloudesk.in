// Organisation structure for a workspace: its legal entities (companies),
// branches (with regions above them), cost centres / profit centres / business
// units, currencies and exchange rates, user groups, what each member may see
// (companies and branches), access reviews and closed accounting months.
//
// Every workspace has one default company, made on first use from what's
// already known (invoicing's business details, the books' GSTIN, the
// workspace name). Records that don't say otherwise belong to it.
import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { COMMON_CURRENCIES, accessSchema, branchSchema, companySchema, currencySchema, groupSchema, rateSchema, stateFromGstin, unitSchema, type Access } from "@/lib/org/model";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { audit } from "../services/audit";
import { target } from "@/lib/import/targets";
import { runImport, str } from "../import/run";

export type Who = { orgId: string; userId: string; role: Role; admin: boolean };

export async function who(ctx: AuthedContext, orgId: string): Promise<Who> {
  const { role } = await requireOrg(ctx, orgId, "org:read");
  return { orgId, userId: ctx.user.id, role, admin: can(role, "org:update") };
}
const requireAdmin = (w: Who) => {
  if (!w.admin) throw new ApiError("forbidden", "Only workspace owners and admins can change the organisation");
};

export function check<T extends z.ZodType>(sch: T, raw: unknown): z.infer<T> {
  const r = sch.safeParse(raw);
  if (!r.success) {
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".")] ??= []).push(i.message);
    throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the highlighted fields", details);
  }
  return r.data;
}

const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);

// ── Companies ───────────────────────────────────────────────────────────────

/** The default company, made on first use. Old ledger entries and bills without one are given it. */
export async function ensureDefaultCompany(orgId: string) {
  const [have] = await db.select().from(schema.orgCompanies).where(and(eq(schema.orgCompanies.orgId, orgId), eq(schema.orgCompanies.isDefault, true)));
  if (have) return have;
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const biz = ((await db.execute(sql`
    select s.data->'business' as b from invoice_settings s join invoice_owners o on o.id = s.project_id
    left join projects p on p.id = o.project_id left join finance_books f on f.id = o.book_id
    where coalesce(p.org_id, f.org_id) = ${orgId} and coalesce(s.data->'business'->>'name', '') <> '' limit 1`)) as unknown as { rows: { b: { name?: string; legalName?: string; gstin?: string; pan?: string } }[] }).rows[0]?.b;
  const [acc] = await db.select({ settings: schema.accSettings.settings }).from(schema.accSettings).where(eq(schema.accSettings.orgId, orgId));
  const gstin = (biz?.gstin || ((acc?.settings as { gstin?: string } | undefined)?.gstin ?? "")).toUpperCase();
  const [made] = await db
    .insert(schema.orgCompanies)
    .values({ orgId, name: biz?.name || org?.name || "My company", legalName: biz?.legalName ?? "", gstin, pan: biz?.pan ?? (gstin ? gstin.slice(2, 12) : ""), state: gstin ? stateFromGstin(gstin) : ((acc?.settings as { state?: string } | undefined)?.state ?? ""), isDefault: true })
    .onConflictDoNothing()
    .returning();
  const company = made ?? (await db.select().from(schema.orgCompanies).where(and(eq(schema.orgCompanies.orgId, orgId), eq(schema.orgCompanies.isDefault, true))))[0];
  await db.update(schema.accJournals).set({ companyId: company.id }).where(and(eq(schema.accJournals.orgId, orgId), isNull(schema.accJournals.companyId)));
  await db.update(schema.accBills).set({ companyId: company.id }).where(and(eq(schema.accBills.orgId, orgId), isNull(schema.accBills.companyId)));
  return company;
}

export async function companies(orgId: string) {
  await ensureDefaultCompany(orgId);
  return db.select().from(schema.orgCompanies).where(eq(schema.orgCompanies.orgId, orgId)).orderBy(desc(schema.orgCompanies.isDefault), asc(schema.orgCompanies.name));
}

export async function getCompany(orgId: string, id: string) {
  const [c] = await db.select().from(schema.orgCompanies).where(and(eq(schema.orgCompanies.orgId, orgId), eq(schema.orgCompanies.id, id)));
  if (!c) throw new ApiError("validation_failed", "That company isn't in this workspace", { companyId: ["Unknown company"] });
  return c;
}

export async function saveCompany(w: Who, id: string | null, raw: unknown) {
  requireAdmin(w);
  const v = check(companySchema, raw);
  if (v.gstin && !v.state) v.state = stateFromGstin(v.gstin);
  if (v.parentId) {
    if (v.parentId === id) throw new ApiError("validation_failed", "A company can't be its own parent");
    await getCompany(w.orgId, v.parentId);
  }
  await ensureDefaultCompany(w.orgId);
  if (id) {
    const cur = await getCompany(w.orgId, id);
    if (cur.isDefault && !v.active) throw new ApiError("conflict", "The default company can't be switched off — make another one the default first");
    const [r] = await db.update(schema.orgCompanies).set(v).where(eq(schema.orgCompanies.id, id)).returning();
    await audit({ orgId: w.orgId, actorId: w.userId, action: "org.company_updated", targetType: "org_company", targetId: id, metadata: { name: v.name } });
    return r;
  }
  const [r] = await db.insert(schema.orgCompanies).values({ ...v, orgId: w.orgId }).returning();
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.company_created", targetType: "org_company", targetId: r.id, metadata: { name: v.name, gstin: v.gstin } });
  return r;
}

export async function makeDefaultCompany(w: Who, id: string) {
  requireAdmin(w);
  const c = await getCompany(w.orgId, id);
  if (!c.active) throw new ApiError("conflict", "Switch the company on first");
  await db.transaction(async (tx) => {
    await tx.update(schema.orgCompanies).set({ isDefault: false }).where(eq(schema.orgCompanies.orgId, w.orgId));
    await tx.update(schema.orgCompanies).set({ isDefault: true }).where(eq(schema.orgCompanies.id, id));
  });
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.company_default", targetType: "org_company", targetId: id, metadata: { name: c.name } });
}

export async function deleteCompany(w: Who, id: string) {
  requireAdmin(w);
  const c = await getCompany(w.orgId, id);
  if (c.isDefault) throw new ApiError("conflict", "The default company can't be deleted");
  const used =
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accJournals).where(eq(schema.accJournals.companyId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.orgBranches).where(eq(schema.orgBranches.companyId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accBills).where(eq(schema.accBills.companyId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.financeBooks).where(eq(schema.financeBooks.companyId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.projects).where(eq(schema.projects.companyId, id))));
  if (used) throw new ApiError("conflict", "This company has branches, books or ledger entries — switch it off instead, so its history stays");
  await db.delete(schema.orgCompanies).where(eq(schema.orgCompanies.id, id));
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.company_deleted", targetType: "org_company", targetId: id, metadata: { name: c.name } });
}

// ── Branches ────────────────────────────────────────────────────────────────

export async function branches(orgId: string) {
  return db.select().from(schema.orgBranches).where(eq(schema.orgBranches.orgId, orgId)).orderBy(asc(schema.orgBranches.name));
}

export async function getBranch(orgId: string, id: string) {
  const [b] = await db.select().from(schema.orgBranches).where(and(eq(schema.orgBranches.orgId, orgId), eq(schema.orgBranches.id, id)));
  if (!b) throw new ApiError("validation_failed", "That branch isn't in this workspace", { branchId: ["Unknown branch"] });
  return b;
}

export async function saveBranch(w: Who, id: string | null, raw: unknown) {
  requireAdmin(w);
  const v = check(branchSchema, raw);
  await getCompany(w.orgId, v.companyId);
  if (v.gstin && !v.state) v.state = stateFromGstin(v.gstin);
  if (v.parentId) {
    if (v.parentId === id) throw new ApiError("validation_failed", "A branch can't sit under itself");
    // No loops: walk up from the parent.
    let up: string | null = v.parentId;
    for (let i = 0; up && i < 20; i++) {
      if (up === id) throw new ApiError("validation_failed", "That would put the branch under one of its own branches");
      up = (await getBranch(w.orgId, up)).parentId;
    }
  }
  if (v.managerId) await requireMember(w.orgId, v.managerId);
  if (id) {
    const cur = await getBranch(w.orgId, id);
    if (cur.companyId !== v.companyId && (await branchUsed(id))) throw new ApiError("conflict", "This branch has ledger entries, locations or books — its company can't change");
    const [r] = await db.update(schema.orgBranches).set(v).where(eq(schema.orgBranches.id, id)).returning();
    return r;
  }
  const [r] = await db.insert(schema.orgBranches).values({ ...v, orgId: w.orgId }).returning();
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.branch_created", targetType: "org_branch", targetId: r.id, metadata: { name: v.name } });
  return r;
}

async function branchUsed(id: string) {
  return (
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accLines).where(eq(schema.accLines.branchId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.invWarehouses).where(eq(schema.invWarehouses.branchId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.hrLocations).where(eq(schema.hrLocations.branchId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.projects).where(eq(schema.projects.branchId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.financeBooks).where(eq(schema.financeBooks.branchId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accBills).where(eq(schema.accBills.branchId, id)))) +
    (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.orgBranches).where(eq(schema.orgBranches.parentId, id))))
  );
}

export async function deleteBranch(w: Who, id: string) {
  requireAdmin(w);
  const b = await getBranch(w.orgId, id);
  if (await branchUsed(id)) throw new ApiError("conflict", "This branch is in use (locations, books, ledger entries or branches under it) — switch it off instead");
  await db.delete(schema.orgBranches).where(eq(schema.orgBranches.id, id));
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.branch_deleted", targetType: "org_branch", targetId: id, metadata: { name: b.name } });
}

/** Point locations, books and stores at a branch (or back to none). */
const linkSchema = z.object({ kind: z.enum(["warehouse", "location", "project", "book"]), id: z.uuid(), branchId: z.uuid().nullable() });
export async function linkToBranch(w: Who, raw: unknown) {
  requireAdmin(w);
  const v = check(linkSchema, raw);
  const b = v.branchId ? await getBranch(w.orgId, v.branchId) : null;
  const companyId = b?.companyId ?? null;
  const ok = async (rows: { id: string }[]) => {
    if (!rows.length) throw notFound("Record");
  };
  if (v.kind === "warehouse") await ok(await db.update(schema.invWarehouses).set({ branchId: v.branchId }).where(and(eq(schema.invWarehouses.id, v.id), eq(schema.invWarehouses.orgId, w.orgId))).returning({ id: schema.invWarehouses.id }));
  if (v.kind === "location") await ok(await db.update(schema.hrLocations).set({ branchId: v.branchId }).where(and(eq(schema.hrLocations.id, v.id), eq(schema.hrLocations.orgId, w.orgId))).returning({ id: schema.hrLocations.id }));
  if (v.kind === "project") await ok(await db.update(schema.projects).set({ branchId: v.branchId, companyId }).where(and(eq(schema.projects.id, v.id), eq(schema.projects.orgId, w.orgId))).returning({ id: schema.projects.id }));
  if (v.kind === "book") await ok(await db.update(schema.financeBooks).set({ branchId: v.branchId, companyId }).where(and(eq(schema.financeBooks.id, v.id), eq(schema.financeBooks.orgId, w.orgId))).returning({ id: schema.financeBooks.id }));
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.branch_linked", targetType: v.kind, targetId: v.id, metadata: { branchId: v.branchId } });
}

/** What can be linked to branches, and where each is now. */
export async function linkables(orgId: string) {
  const [whs, locs, projects, books] = await Promise.all([
    db.select({ id: schema.invWarehouses.id, name: schema.invWarehouses.name, branchId: schema.invWarehouses.branchId }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId)),
    db.select({ id: schema.hrLocations.id, name: schema.hrLocations.name, branchId: schema.hrLocations.branchId }).from(schema.hrLocations).where(eq(schema.hrLocations.orgId, orgId)),
    db.select({ id: schema.projects.id, name: schema.projects.name, branchId: schema.projects.branchId }).from(schema.projects).where(and(eq(schema.projects.orgId, orgId), sql`(exists (select 1 from stores s where s.project_id = ${schema.projects.id}) or exists (select 1 from horeca_venues v where v.project_id = ${schema.projects.id}) or exists (select 1 from invoice_owners o where o.project_id = ${schema.projects.id}))`)),
    db.select({ id: schema.financeBooks.id, name: schema.financeBooks.name, branchId: schema.financeBooks.branchId }).from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId)),
  ]);
  return { warehouses: whs, locations: locs, projects, books };
}

// ── Cost centres, profit centres, business units ───────────────────────────

export async function units(orgId: string) {
  return db.select().from(schema.orgUnits).where(eq(schema.orgUnits.orgId, orgId)).orderBy(asc(schema.orgUnits.kind), asc(schema.orgUnits.code));
}

export async function getUnit(orgId: string, id: string) {
  const [u] = await db.select().from(schema.orgUnits).where(and(eq(schema.orgUnits.orgId, orgId), eq(schema.orgUnits.id, id)));
  if (!u) throw new ApiError("validation_failed", "That cost centre isn't in this workspace", { costCentreId: ["Unknown cost centre"] });
  return u;
}

export async function saveUnit(w: Who, id: string | null, raw: unknown) {
  requireAdmin(w);
  const v = check(unitSchema, raw);
  if (v.companyId) await getCompany(w.orgId, v.companyId);
  if (v.parentId) {
    if (v.parentId === id) throw new ApiError("validation_failed", "It can't sit under itself");
    await getUnit(w.orgId, v.parentId);
  }
  const [clash] = await db.select({ id: schema.orgUnits.id }).from(schema.orgUnits).where(and(eq(schema.orgUnits.orgId, w.orgId), sql`lower(${schema.orgUnits.code}) = ${v.code.toLowerCase()}`));
  if (clash && clash.id !== id) throw new ApiError("conflict", `The code ${v.code} is already used`, { code: ["Already used"] });
  if (id) {
    await getUnit(w.orgId, id);
    const [r] = await db.update(schema.orgUnits).set(v).where(eq(schema.orgUnits.id, id)).returning();
    return r;
  }
  const [r] = await db.insert(schema.orgUnits).values({ ...v, orgId: w.orgId }).returning();
  return r;
}

export async function deleteUnit(w: Who, id: string) {
  requireAdmin(w);
  await getUnit(w.orgId, id);
  const used = (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.accLines).where(eq(schema.accLines.costCentreId, id)))) + (await count(db.select({ n: sql<number>`count(*)::int` }).from(schema.hrEmployees).where(eq(schema.hrEmployees.costCentreId, id))));
  if (used) throw new ApiError("conflict", "It's on ledger entries or people — switch it off instead");
  await db.delete(schema.orgUnits).where(eq(schema.orgUnits.id, id));
}

// ── Currencies and exchange rates ───────────────────────────────────────────

export async function currencies(orgId: string) {
  const list = await db.select().from(schema.orgCurrencies).where(eq(schema.orgCurrencies.orgId, orgId)).orderBy(asc(schema.orgCurrencies.code));
  const latest = list.length
    ? ((await db.execute(sql`select distinct on (currency) currency, date::text as date, rate::float as rate from org_fx_rates where org_id = ${orgId} order by currency, date desc`)) as unknown as { rows: { currency: string; date: string; rate: number }[] }).rows
    : [];
  return list.map((c) => ({ ...c, latest: latest.find((l) => l.currency === c.code) ?? null }));
}

export async function saveCurrency(w: Who, raw: unknown) {
  requireAdmin(w);
  const v = check(currencySchema, raw);
  if (v.code === "INR") throw new ApiError("validation_failed", "Rupees are the base currency already");
  await db.insert(schema.orgCurrencies).values({ ...v, orgId: w.orgId }).onConflictDoUpdate({ target: [schema.orgCurrencies.orgId, schema.orgCurrencies.code], set: { name: v.name, symbol: v.symbol, decimals: v.decimals, active: v.active } });
  return v;
}

export async function rates(orgId: string, currency: string) {
  return db.select({ id: schema.orgFxRates.id, date: schema.orgFxRates.date, rate: sql<number>`${schema.orgFxRates.rate}::float`, source: schema.orgFxRates.source }).from(schema.orgFxRates).where(and(eq(schema.orgFxRates.orgId, orgId), eq(schema.orgFxRates.currency, currency.toUpperCase()))).orderBy(desc(schema.orgFxRates.date)).limit(400);
}

export async function saveRate(w: Who, raw: unknown, source: "manual" | "import" = "manual") {
  requireAdmin(w);
  const v = check(rateSchema, raw);
  const [cur] = await db.select().from(schema.orgCurrencies).where(and(eq(schema.orgCurrencies.orgId, w.orgId), eq(schema.orgCurrencies.code, v.currency)));
  if (!cur) throw new ApiError("validation_failed", `Add ${v.currency} as a currency first`);
  const [r] = await db
    .insert(schema.orgFxRates)
    .values({ orgId: w.orgId, currency: v.currency, date: v.date, rate: String(v.rate), source, createdBy: w.userId })
    .onConflictDoUpdate({ target: [schema.orgFxRates.orgId, schema.orgFxRates.currency, schema.orgFxRates.date], set: { rate: String(v.rate), source } })
    .returning();
  return r;
}

export async function deleteRate(w: Who, id: string) {
  requireAdmin(w);
  await db.delete(schema.orgFxRates).where(and(eq(schema.orgFxRates.id, id), eq(schema.orgFxRates.orgId, w.orgId)));
}

/** Rupees per unit of a currency on a date (the latest rate on or before it), or null if none is recorded. */
export async function rateFor(orgId: string, currency: string, day: string) {
  if (currency === "INR") return 1;
  const [r] = await db.select({ rate: sql<number>`${schema.orgFxRates.rate}::float` }).from(schema.orgFxRates).where(and(eq(schema.orgFxRates.orgId, orgId), eq(schema.orgFxRates.currency, currency), sql`${schema.orgFxRates.date} <= ${day}`)).orderBy(desc(schema.orgFxRates.date)).limit(1);
  return r?.rate ?? null;
}

// ── Groups ──────────────────────────────────────────────────────────────────

async function requireMember(orgId: string, userId: string) {
  const [m] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  if (!m) throw new ApiError("validation_failed", "That person isn't in this workspace");
  return m;
}

export async function groups(orgId: string) {
  return db.select().from(schema.orgGroups).where(eq(schema.orgGroups.orgId, orgId)).orderBy(asc(schema.orgGroups.name));
}

export async function saveGroup(w: Who, id: string | null, raw: unknown) {
  requireAdmin(w);
  const v = check(groupSchema, raw);
  const members = [...new Set(v.members)];
  if (members.length) {
    const found = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.orgId, w.orgId), inArray(schema.memberships.userId, members)));
    if (found.length !== members.length) throw new ApiError("validation_failed", "Everyone in a group must be in this workspace");
  }
  if (id) {
    const [r] = await db.update(schema.orgGroups).set({ ...v, members }).where(and(eq(schema.orgGroups.id, id), eq(schema.orgGroups.orgId, w.orgId))).returning();
    if (!r) throw notFound("Group");
    return r;
  }
  const [r] = await db.insert(schema.orgGroups).values({ ...v, members, orgId: w.orgId }).returning();
  return r;
}

export async function deleteGroup(w: Who, id: string) {
  requireAdmin(w);
  await db.delete(schema.orgGroups).where(and(eq(schema.orgGroups.id, id), eq(schema.orgGroups.orgId, w.orgId)));
}

// ── Data access and reviews ─────────────────────────────────────────────────

export async function memberAccess(orgId: string, userId: string): Promise<Access> {
  const [m] = await db.select({ access: schema.memberships.access }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  const a = m?.access ?? null;
  return a && (a.companies?.length || a.branches?.length) ? a : null;
}

export async function setMemberAccess(w: Who, userId: string, raw: unknown) {
  requireAdmin(w);
  const m = await requireMember(w.orgId, userId);
  if (m.role === "owner") throw new ApiError("conflict", "Owners always see everything");
  if (userId === w.userId) throw new ApiError("conflict", "You can't limit your own access");
  const v = check(accessSchema, raw);
  if (v?.companies?.length) for (const c of v.companies) await getCompany(w.orgId, c);
  if (v?.branches?.length) for (const b of v.branches) await getBranch(w.orgId, b);
  const access = v && (v.companies?.length || v.branches?.length) ? { companies: v.companies ?? [], branches: v.branches ?? [] } : null;
  await db.update(schema.memberships).set({ access }).where(and(eq(schema.memberships.orgId, w.orgId), eq(schema.memberships.userId, userId)));
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.access_changed", targetType: "user", targetId: userId, metadata: { access } });
}

/** Everyone's access as it stands: role, workspace role, groups, data limits, two-step sign-in and when they were last seen. */
export async function accessSnapshot(orgId: string) {
  const rows = await db
    .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, customRole: schema.customRoles.name, modules: schema.customRoles.modules, access: schema.memberships.access, mfa: schema.users.totpEnabledAt, joined: schema.memberships.createdAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
  const seen = rows.length ? await db.select({ userId: schema.sessions.userId, at: max(schema.sessions.lastSeenAt) }).from(schema.sessions).where(inArray(schema.sessions.userId, rows.map((r) => r.userId))).groupBy(schema.sessions.userId) : [];
  const gs = await groups(orgId);
  return rows.map((r) => ({ ...r, mfa: !!r.mfa, lastSeen: seen.find((x) => x.userId === r.userId)?.at ?? null, groups: gs.filter((g) => g.members.includes(r.userId)).map((g) => g.name) }));
}

export async function completeReview(w: Who, raw: unknown) {
  requireAdmin(w);
  const v = check(z.object({ notes: z.string().trim().max(4000).default(""), changes: z.array(z.string().trim().max(300)).max(200).default([]) }), raw);
  const snapshot = await accessSnapshot(w.orgId);
  const [r] = await db.insert(schema.accessReviews).values({ orgId: w.orgId, reviewerId: w.userId, snapshot, changes: v.changes, notes: v.notes }).returning();
  await audit({ orgId: w.orgId, actorId: w.userId, action: "org.access_reviewed", targetType: "access_review", targetId: r.id, metadata: { members: snapshot.length, changes: v.changes.length } });
  return r;
}

export async function reviews(orgId: string) {
  return db.select({ id: schema.accessReviews.id, createdAt: schema.accessReviews.createdAt, notes: schema.accessReviews.notes, changes: schema.accessReviews.changes, reviewer: schema.users.name }).from(schema.accessReviews).leftJoin(schema.users, eq(schema.users.id, schema.accessReviews.reviewerId)).where(eq(schema.accessReviews.orgId, orgId)).orderBy(desc(schema.accessReviews.createdAt)).limit(50);
}

// ── Imports ─────────────────────────────────────────────────────────────────


export async function importBranches(w: Who, raw: unknown) {
  requireAdmin(w);
  const cos = await companies(w.orgId);
  const def = cos.find((c) => c.isDefault)!;
  const parents: { id: string; ref: string }[] = [];
  const r = await runImport(target("org.branches"), raw, async (v, mode) => {
    const code = str(v.code).trim();
    const name = str(v.name);
    const [found] = await db.select().from(schema.orgBranches).where(and(eq(schema.orgBranches.orgId, w.orgId), code ? sql`lower(${schema.orgBranches.code}) = ${code.toLowerCase()}` : sql`lower(${schema.orgBranches.name}) = ${name.toLowerCase()}`));
    if (found && mode === "skip") return "skipped";
    const co = str(v.company) ? cos.find((c) => c.name.toLowerCase() === str(v.company).toLowerCase()) : def;
    if (!co) throw new ApiError("validation_failed", `There's no company called “${str(v.company)}” — add it first`);
    const b = await saveBranch(w, found?.id ?? null, { companyId: co.id, parentId: found?.parentId ?? null, code: code || found?.code || "", name, kind: str(v.kind) || found?.kind || "office", state: str(v.state) || found?.state || "", address: str(v.address) || found?.address || "", gstin: str(v.gstin) || found?.gstin || "", managerId: found?.managerId ?? null, active: true });
    if (str(v.parent)) parents.push({ id: b.id, ref: str(v.parent).toLowerCase() });
    return found ? "updated" : "created";
  });
  // Parents in a second pass, so a region can come later in the file.
  const all = await branches(w.orgId);
  for (const p of parents) {
    const parent = all.find((b) => b.code.toLowerCase() === p.ref || b.name.toLowerCase() === p.ref);
    if (parent && parent.id !== p.id) await db.update(schema.orgBranches).set({ parentId: parent.id }).where(eq(schema.orgBranches.id, p.id));
  }
  return r;
}

export async function importUnits(w: Who, raw: unknown) {
  requireAdmin(w);
  const parents: { id: string; ref: string }[] = [];
  const r = await runImport(target("org.units"), raw, async (v, mode) => {
    const code = str(v.code).trim();
    const [found] = await db.select().from(schema.orgUnits).where(and(eq(schema.orgUnits.orgId, w.orgId), sql`lower(${schema.orgUnits.code}) = ${code.toLowerCase()}`));
    if (found && mode === "skip") return "skipped";
    const u = await saveUnit(w, found?.id ?? null, { kind: str(v.kind) || found?.kind || "cost_centre", code, name: str(v.name), parentId: found?.parentId ?? null, companyId: found?.companyId ?? null, managerId: found?.managerId ?? null, active: true });
    if (str(v.parent)) parents.push({ id: u.id, ref: str(v.parent).toLowerCase() });
    return found ? "updated" : "created";
  });
  const all = await units(w.orgId);
  for (const p of parents) {
    const parent = all.find((u) => u.code.toLowerCase() === p.ref);
    if (parent && parent.id !== p.id) await db.update(schema.orgUnits).set({ parentId: parent.id }).where(eq(schema.orgUnits.id, p.id));
  }
  return r;
}

export async function importRates(w: Who, raw: unknown) {
  requireAdmin(w);
  return runImport(target("org.rates"), raw, async (v) => {
    const currency = str(v.currency).trim().toUpperCase();
    const [cur] = await db.select().from(schema.orgCurrencies).where(and(eq(schema.orgCurrencies.orgId, w.orgId), eq(schema.orgCurrencies.code, currency)));
    if (!cur) {
      const known = COMMON_CURRENCIES.find((c) => c.code === currency);
      if (!known) throw new ApiError("validation_failed", `Add ${currency} as a currency first`);
      await saveCurrency(w, known);
    }
    await saveRate(w, { currency, date: str(v.date), rate: Number(v.rate) }, "import");
    return "updated";
  });
}

/** Invoicing books in this workspace: standalone finance books and project books. */
export async function invoiceBooks(orgId: string) {
  const rows = (await db.execute(sql`
    select o.id, coalesce(b.name, p.name) as name, case when b.id is not null then 'book' else 'project' end as kind
    from invoice_owners o left join finance_books b on b.id = o.book_id left join projects p on p.id = o.project_id
    where coalesce(b.org_id, p.org_id) = ${orgId}
    order by kind, name`)) as unknown as { rows: { id: string; name: string; kind: "book" | "project" }[] };
  return rows.rows;
}

