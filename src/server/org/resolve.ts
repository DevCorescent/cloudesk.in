// Which company, branch and cost centre a document belongs to, worked out
// from where it came from: a store or venue (its project), invoicing books,
// a stock location, a person's work location. Anything not linked to a branch
// belongs to the default company. Loaded once per posting run.
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ensureDefaultCompany } from "./org";

export type Ref = { companyId: string; branchId: string | null; costCentreId?: string | null };

export async function resolver(orgId: string) {
  const def = (await ensureDefaultCompany(orgId)).id;
  const [branches, projects, books, owners, warehouses, people] = await Promise.all([
    db.select({ id: schema.orgBranches.id, companyId: schema.orgBranches.companyId }).from(schema.orgBranches).where(eq(schema.orgBranches.orgId, orgId)),
    db.select({ id: schema.projects.id, companyId: schema.projects.companyId, branchId: schema.projects.branchId }).from(schema.projects).where(eq(schema.projects.orgId, orgId)),
    db.select({ id: schema.financeBooks.id, companyId: schema.financeBooks.companyId, branchId: schema.financeBooks.branchId }).from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId)),
    (db.execute(sql`select o.id, o.project_id, o.book_id from invoice_owners o left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where coalesce(p.org_id, b.org_id) = ${orgId}`) as unknown as Promise<{ rows: { id: string; project_id: string | null; book_id: string | null }[] }>),
    db.select({ id: schema.invWarehouses.id, branchId: schema.invWarehouses.branchId }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId)),
    (db.execute(sql`select e.id, e.cost_centre_id, l.branch_id from hr_employees e left join hr_locations l on l.id = e.location_id where e.org_id = ${orgId}`) as unknown as Promise<{ rows: { id: string; cost_centre_id: string | null; branch_id: string | null }[] }>),
  ]);
  const companyOfBranch = new Map(branches.map((b) => [b.id, b.companyId]));
  const fromBranch = (branchId: string | null | undefined, companyId?: string | null): Ref => ({ companyId: (branchId && companyOfBranch.get(branchId)) || companyId || def, branchId: branchId ?? null });
  const project = new Map(projects.map((p) => [p.id, fromBranch(p.branchId, p.companyId)]));
  const book = new Map(books.map((b) => [b.id, fromBranch(b.branchId, b.companyId)]));
  const owner = new Map(owners.rows.map((o) => [o.id, (o.project_id ? project.get(o.project_id) : o.book_id ? book.get(o.book_id) : undefined) ?? fromBranch(null)]));
  const warehouse = new Map(warehouses.map((w) => [w.id, fromBranch(w.branchId)]));
  const employee = new Map(people.rows.map((p) => [p.id, { ...fromBranch(p.branch_id), costCentreId: p.cost_centre_id }]));
  return {
    defaultCompany: def,
    ofProject: (id: string) => project.get(id) ?? fromBranch(null),
    ofOwner: (id: string) => owner.get(id) ?? fromBranch(null),
    ofWarehouse: (id: string) => warehouse.get(id) ?? fromBranch(null),
    ofEmployee: (id: string) => employee.get(id) ?? { ...fromBranch(null), costCentreId: null },
    ofBranch: (id: string | null | undefined, companyId?: string | null) => fromBranch(id, companyId),
  };
}
export type Resolver = Awaited<ReturnType<typeof resolver>>;
