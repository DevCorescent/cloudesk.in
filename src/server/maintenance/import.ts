// Importing the asset register from a spreadsheet (another CMMS, a plant
// list, the fixed-asset schedule). Existing assets are matched by code, then
// serial; rows go through the same save as the screen, and a meter reading in
// the row is recorded as today's.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { assetSchema } from "@/lib/maintenance/model";
import { target } from "@/lib/import/targets";
import { runImport, str } from "../import/run";
import { requireWrite, todayIst, type Scope } from "./access";
import { saveAsset } from "./core";

export async function importAssets(s: Scope, raw: unknown) {
  requireWrite(s);
  return runImport(target("maintenance.assets"), raw, async (v, mode) => {
    const code = str(v.code).trim();
    const serial = str(v.serial).trim();
    const [found] = code || serial ? await db.select().from(schema.mntAssets).where(and(eq(schema.mntAssets.orgId, s.orgId), code ? sql`lower(${schema.mntAssets.code}) = ${code.toLowerCase()}` : sql`lower(${schema.mntAssets.serial}) = ${serial.toLowerCase()}`)).limit(1) : [];
    if (found && mode === "skip") return "skipped";
    const base = found ? assetSchema.parse({ ...found, purchaseDate: found.purchaseDate ? String(found.purchaseDate) : null, warrantyUntil: found.warrantyUntil ? String(found.warrantyUntil) : null }) : assetSchema.parse({ name: str(v.name) });
    const pick = (k: string, cur: unknown) => (v[k] === null || v[k] === undefined || v[k] === "" ? cur : v[k]);
    const row = await saveAsset(s, found?.id ?? null, {
      ...base,
      name: str(v.name),
      category: pick("category", base.category),
      location: pick("location", base.location),
      make: pick("make", base.make),
      model: pick("model", base.model),
      serial: pick("serial", base.serial),
      criticality: pick("criticality", base.criticality),
      purchaseDate: pick("purchaseDate", base.purchaseDate),
      warrantyUntil: pick("warrantyUntil", base.warrantyUntil),
      meterUnit: pick("meterUnit", base.meterUnit),
      notes: pick("notes", base.notes),
    });
    // A new asset given a code in the sheet keeps it.
    if (!found && code) await db.update(schema.mntAssets).set({ code }).where(eq(schema.mntAssets.id, row.id));
    const meter = v.meter === null || v.meter === undefined || v.meter === "" ? null : Number(v.meter);
    if (meter !== null && Number.isFinite(meter) && row.meterUnit && (row.meter === null || meter >= row.meter)) {
      await db.insert(schema.mntReadings).values({ orgId: s.orgId, assetId: row.id, value: meter, on: todayIst(), by: s.userId });
      await db.update(schema.mntAssets).set({ meter, meterAt: todayIst() }).where(eq(schema.mntAssets.id, row.id));
    }
    return found ? "updated" : "created";
  });
}
