// Bringing students over from a spreadsheet (the old school software, an
// admission register). Matched by admission number; the class by its name
// (and section). Concessions in the sheet need someone who may give them.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { target } from "@/lib/import/targets";
import { runImport, str } from "../import/run";
import { requireWrite, type Scope } from "./access";
import { saveStudent } from "./core";

const norm = (s: string) => s.toLowerCase().replace(/^(class|grade|std\.?|standard)\s*/i, "").replace(/[^a-z0-9]/g, "");

export async function importStudents(s: Scope, raw: unknown) {
  requireWrite(s);
  const classes = await db.select().from(schema.eduClasses).where(eq(schema.eduClasses.orgId, s.orgId));
  const classOf = (name: string) => {
    const n = norm(name);
    if (!n) return null;
    return classes.find((c) => norm(`${c.name}${c.section}`) === n) ?? classes.find((c) => norm(c.name) === n && !c.section) ?? null;
  };
  return runImport(target("education.students"), raw, async (v, mode) => {
    const adm = str(v.admissionNo).trim();
    const [found] = adm ? await db.select().from(schema.eduStudents).where(and(eq(schema.eduStudents.orgId, s.orgId), sql`lower(${schema.eduStudents.admissionNo}) = ${adm.toLowerCase()}`)) : [];
    if (found && mode === "skip") return "skipped";
    const cls = str(v.className) ? classOf(str(v.className)) : null;
    if (str(v.className) && !cls) throw new Error(`No class called “${str(v.className)}” — add it first`);
    const pick = <T>(k: string, cur: T) => (v[k] === null || v[k] === undefined || v[k] === "" ? cur : (v[k] as T));
    await saveStudent(s, found?.id ?? null, {
      admissionNo: adm || found?.admissionNo || "",
      name: str(v.name),
      classId: cls?.id ?? found?.classId ?? null,
      rollNo: pick("rollNo", found?.rollNo ?? null),
      dob: pick("dob", found?.dob ? String(found.dob) : null),
      gender: pick("gender", found?.gender ?? ""),
      guardianName: pick("guardianName", found?.guardianName ?? ""),
      guardianPhone: pick("guardianPhone", found?.guardianPhone ?? ""),
      guardianEmail: pick("guardianEmail", found?.guardianEmail ?? ""),
      address: pick("address", found?.address ?? ""),
      concessionPct: pick("concessionPct", found?.concessionPct ?? 0),
      status: found?.status ?? "active",
    });
    return found ? "updated" : "created";
  });
}
