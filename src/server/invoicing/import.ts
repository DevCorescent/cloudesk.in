// Importing clients and items into a set of books (or a project's invoicing).
// Clients are matched by email, then GSTIN, then name; items by name.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { stateName } from "@/lib/import/engine";
import { target } from "@/lib/import/targets";
import { runImport, str } from "../import/run";
import { saveClient, saveItem } from "./service";

export async function importClients(ownerId: string, raw: unknown) {
  return runImport(target("invoicing.clients"), raw, async (v, mode) => {
    const email = str(v.email);
    const gstin = str(v.gstin);
    const name = str(v.name);
    const C = schema.invoiceClients;
    const [found] = await db
      .select()
      .from(C)
      .where(and(eq(C.projectId, ownerId), isNull(C.archivedAt), sql`(${email ? sql`lower(${C.email}) = lower(${email})` : sql`false`} or ${gstin ? sql`${C.gstin} = ${gstin}` : sql`false`} or (lower(${C.name}) = lower(${name}) and lower(${C.company}) = lower(${str(v.company)})))`))
      .limit(1);
    if (found && mode === "skip") return "skipped";
    const billing = { line1: str(v.line1), line2: "", city: str(v.city), state: v.state ? stateName(str(v.state)) : "", postalCode: str(v.postalCode), country: "IN" };
    const merged = found
      ? { name, company: str(v.company) || found.company, email: email || found.email, phone: str(v.phone) || found.phone, gstin: gstin || found.gstin, billing: { ...(found.billing as typeof billing), ...Object.fromEntries(Object.entries(billing).filter(([, x]) => x)) }, shipping: found.shipping as typeof billing | null, notes: found.notes }
      : { name, company: str(v.company), email, phone: str(v.phone), gstin, billing, shipping: null, notes: "" };
    await saveClient(ownerId, found?.id ?? null, merged);
    return found ? "updated" : "created";
  });
}

export async function importItems(ownerId: string, raw: unknown) {
  return runImport(target("invoicing.items"), raw, async (v, mode) => {
    const name = str(v.name);
    const I = schema.invoiceItems;
    const [found] = await db.select({ id: I.id }).from(I).where(and(eq(I.projectId, ownerId), isNull(I.archivedAt), sql`lower(${I.name}) = lower(${name})`)).limit(1);
    if (found && mode === "skip") return "skipped";
    await saveItem(ownerId, found?.id ?? null, { name, description: str(v.description), hsn: str(v.hsn).replace(/\D/g, ""), unit: str(v.unit), rate: Number(v.rate), taxBps: Math.round(Number(v.gstRate ?? 18) * 100) });
    return found ? "updated" : "created";
  });
}
