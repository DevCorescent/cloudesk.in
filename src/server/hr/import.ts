// Importing employees. People are matched by work email; departments and
// locations named in the file are found or added; "reports to" is filled in a
// second pass so it can point at someone further down the same file.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { target } from "@/lib/import/targets";
import { ApiError } from "../http/errors";
import { audit } from "../services/audit";
import { runImport, str } from "../import/run";
import { requireManage, type Scope } from "./access";
import { createEmployee, updateEmployee } from "./employees";

const E = schema.hrEmployees;

export async function importPeople(s: Scope, raw: unknown) {
  requireManage(s);
  const depts = new Map<string, string>();
  const locs = new Map<string, string>();
  const managers: { id: string; ref: string }[] = [];
  const findOrAdd = async (kind: "dept" | "loc", name: string) => {
    if (!name) return null;
    const cache = kind === "dept" ? depts : locs;
    const k = name.toLowerCase();
    if (cache.has(k)) return cache.get(k)!;
    const T = kind === "dept" ? schema.hrDepartments : schema.hrLocations;
    let [row] = await db.select({ id: T.id }).from(T).where(and(eq(T.orgId, s.orgId), sql`lower(${T.name}) = ${k}`));
    if (!row) [row] = await db.insert(T).values({ orgId: s.orgId, name }).returning({ id: T.id });
    cache.set(k, row.id);
    return row.id;
  };
  const r = await runImport(target("hr.people"), raw, async (v, mode) => {
    const email = str(v.email).toLowerCase();
    const [found] = email ? await db.select({ id: E.id }).from(E).where(and(eq(E.orgId, s.orgId), sql`lower(${E.email}) = ${email}`, sql`${E.status} <> 'exited'`)) : [];
    if (found && mode === "skip") return "skipped";
    if (v.ctc !== null && !s.payroll) throw new ApiError("forbidden", "Only payroll can import salaries — leave the CTC column out");
    const body: Record<string, unknown> = {
      name: str(v.name),
      email,
      phone: str(v.phone),
      designation: str(v.designation),
      departmentId: await findOrAdd("dept", str(v.department)),
      locationId: await findOrAdd("loc", str(v.location)),
      employmentType: str(v.employmentType) || "full_time",
      joinDate: str(v.joinDate),
      dob: v.dob ? str(v.dob) : null,
      gender: str(v.gender),
      ...(v.ctc !== null ? { ctc: Number(v.ctc) } : {}),
      ...(v.bankName || v.bankAccount || v.ifsc ? { bank: { name: str(v.bankName), account: str(v.bankAccount).replace(/\s/g, ""), ifsc: str(v.ifsc).toUpperCase() } } : {}),
      ...(v.pan || v.uan ? { ids: { pan: str(v.pan), uan: str(v.uan), esic: "", aadhaarLast4: "" } } : {}),
    };
    let id: string;
    if (found) {
      // Blank cells don't wipe what's there.
      const patch = Object.fromEntries(Object.entries(body).filter(([, x]) => x !== "" && x !== null));
      await updateEmployee(s, found.id, patch);
      id = found.id;
    } else id = (await createEmployee(s, body)).id;
    if (str(v.manager)) managers.push({ id, ref: str(v.manager).toLowerCase() });
    return found ? "updated" : "created";
  });
  // Reporting lines, now that everyone in the file exists.
  if (managers.length) {
    const all = await db.select({ id: E.id, name: E.name, email: E.email }).from(E).where(eq(E.orgId, s.orgId));
    for (const m of managers) {
      const boss = all.find((p) => p.email.toLowerCase() === m.ref) ?? all.find((p) => p.name.toLowerCase() === m.ref);
      if (!boss || boss.id === m.id) continue;
      try {
        await updateEmployee(s, m.id, { managerId: boss.id });
      } catch {
        // A loop or similar: leave it for HR to set by hand.
      }
    }
  }
  await audit({ orgId: s.orgId, actorId: s.userId, action: "hr.people_imported", targetType: "organization", targetId: s.orgId, metadata: { created: r.created, updated: r.updated, errors: r.errors.length } });
  return r;
}
