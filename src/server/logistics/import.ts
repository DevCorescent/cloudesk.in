// Importing the fleet (a vehicle register) and fuel-card statements from
// spreadsheets. Vehicles are matched by registration number; fills are
// matched to vehicles by registration number and go through the same checks
// as the screen (odometer never going backwards).
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { DOC_KINDS, vehicleSchema } from "@/lib/logistics/model";
import { target } from "@/lib/import/targets";
import { ApiError } from "../http/errors";
import { runImport, str } from "../import/run";
import { requireManage, requirePart, requireWrite, type Scope } from "./access";
import { addFuel, saveVehicle } from "./core";

const reg = (v: string) => v.trim().toUpperCase().replace(/\s+/g, " ");
const squash = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function importVehicles(s: Scope, raw: unknown) {
  requireManage(s);
  requirePart(s, "fleet");
  return runImport(target("logistics.vehicles"), raw, async (v, mode) => {
    const regNo = reg(str(v.regNo));
    const all = await db.select().from(schema.lgxVehicles).where(eq(schema.lgxVehicles.orgId, s.orgId));
    const found = all.find((x) => squash(x.regNo) === squash(regNo));
    if (found && mode === "skip") return "skipped";
    const base = found ? vehicleSchema.parse(found) : vehicleSchema.parse({ regNo });
    const pick = <T>(k: string, cur: T) => (v[k] === null || v[k] === undefined || v[k] === "" ? cur : (v[k] as T));
    const docs = [...base.docs];
    for (const kind of ["insurance", "puc", "permit", "fitness"] as (typeof DOC_KINDS)[number][]) {
      const d = str(v[kind]);
      if (!d) continue;
      const i = docs.findIndex((x) => x.kind === kind);
      if (i >= 0) docs[i] = { ...docs[i], expiresOn: d };
      else docs.push({ kind, number: "", expiresOn: d });
    }
    await saveVehicle(s, found?.id ?? null, { ...base, regNo: found ? found.regNo : regNo, name: pick("name", base.name), type: pick("type", base.type), ownership: pick("ownership", base.ownership), capacityKg: pick("capacityKg", base.capacityKg), fuel: pick("fuel", base.fuel), notes: pick("notes", base.notes), docs });
    return found ? "updated" : "created";
  });
}

export async function importFuel(s: Scope, raw: unknown) {
  requireWrite(s);
  requirePart(s, "fleet");
  const all = await db.select({ id: schema.lgxVehicles.id, regNo: schema.lgxVehicles.regNo }).from(schema.lgxVehicles).where(and(eq(schema.lgxVehicles.orgId, s.orgId)));
  return runImport(target("logistics.fuel"), raw, async (v) => {
    const veh = all.find((x) => squash(x.regNo) === squash(str(v.vehicle)));
    if (!veh) throw new ApiError("validation_failed", `${str(v.vehicle)} isn't in your fleet — add the vehicle first`);
    await addFuel(s, { vehicleId: veh.id, date: str(v.date), litres: Number(v.litres), amount: Number(v.amount), odometer: Number(v.odometer), full: v.full !== false, station: str(v.station) });
    return "created";
  });
}
