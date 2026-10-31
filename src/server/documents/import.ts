// Importing a contract register from a spreadsheet (a tracker kept in Excel,
// another system's export). Contracts are matched by number; new ones get
// the next number unless the sheet gives one. Ones brought in as signed or
// terminated keep that status — they were agreed outside Cloudesk.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { contractSchema } from "@/lib/documents/model";
import { target } from "@/lib/import/targets";
import { runImport, str } from "../import/run";
import { requireManage, type Scope } from "./access";
import { saveContract } from "./core";

export async function importContracts(s: Scope, raw: unknown) {
  // Bringing in contracts as already signed skips approval, so it's for owners and admins.
  requireManage(s);
  return runImport(target("documents.contracts"), raw, async (v, mode) => {
    const number = str(v.number).trim();
    const [found] = number ? await db.select().from(schema.docContracts).where(and(eq(schema.docContracts.orgId, s.orgId), sql`lower(${schema.docContracts.number}) = ${number.toLowerCase()}`)).limit(1) : [];
    if (found && mode === "skip") return "skipped";
    const base = found ? contractSchema.parse({ ...found, startOn: found.startOn ? String(found.startOn) : null, endOn: found.endOn ? String(found.endOn) : null }) : contractSchema.parse({ title: str(v.title), counterparty: str(v.counterparty) });
    const pick = <T>(k: string, cur: T) => (v[k] === null || v[k] === undefined || v[k] === "" ? cur : (v[k] as T));
    const row = await saveContract(s, found?.id ?? null, {
      ...base,
      title: str(v.title),
      counterparty: str(v.counterparty),
      kind: pick("kind", base.kind),
      counterpartyEmail: pick("counterpartyEmail", base.counterpartyEmail),
      value: pick("value", base.value),
      startOn: pick("startOn", base.startOn),
      endOn: pick("endOn", base.endOn),
      autoRenew: pick("autoRenew", base.autoRenew),
      renewalMonths: pick("renewalMonths", base.renewalMonths),
      noticeDays: pick("noticeDays", base.noticeDays),
      notes: pick("notes", base.notes),
    });
    const status = str(v.status) || (found ? found.status : "signed");
    await db.update(schema.docContracts).set({ status, ...(number && !found ? { number } : {}) }).where(eq(schema.docContracts.id, row.id));
    return found ? "updated" : "created";
  });
}
