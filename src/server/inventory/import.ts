// Importing items and suppliers. Items are matched by SKU (or name when there's
// no SKU); suppliers by GSTIN, then name. A supplier or location named in the
// file is found — or added — by name, and a stock-on-hand column becomes
// opening stock at that location.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { GST_RATES } from "@/lib/inventory/model";
import { target } from "@/lib/import/targets";
import { isPartOn } from "@/lib/workspace/modules";
import { ApiError } from "../http/errors";
import { audit } from "../services/audit";
import { runImport, str } from "../import/run";
import { requireWrite, type Scope } from "./access";
import { adjust, ensureDefaultWarehouse } from "./items";

const GST_STATE: Record<string, string> = { "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR", "11": "SK", "12": "AR", "13": "NL", "14": "MN", "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH", "21": "OD", "22": "CG", "23": "MP", "24": "GJ", "26": "DN", "27": "MH", "29": "KA", "30": "GA", "31": "LD", "32": "KL", "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AP", "38": "LA" };

export async function importSuppliers(s: Scope, raw: unknown) {
  requireWrite(s);
  const r = await runImport(target("inventory.suppliers"), raw, async (v, mode) => {
    const name = str(v.name);
    const gstin = str(v.gstin);
    const [found] = await db
      .select({ id: schema.invSuppliers.id, bank: schema.invSuppliers.bank })
      .from(schema.invSuppliers)
      .where(and(eq(schema.invSuppliers.orgId, s.orgId), gstin ? sql`(${schema.invSuppliers.gstin} = ${gstin} or lower(${schema.invSuppliers.name}) = lower(${name}))` : sql`lower(${schema.invSuppliers.name}) = lower(${name})`))
      .limit(1);
    const values = {
      name,
      contactName: str(v.contactName),
      email: str(v.email),
      phone: str(v.phone),
      gstin,
      state: str(v.state) || GST_STATE[gstin.slice(0, 2)] || "",
      address: str(v.address),
      ...(v.paymentTermsDays !== null ? { paymentTermsDays: Math.max(0, Math.min(365, Number(v.paymentTermsDays))) } : {}),
      ...(v.leadTimeDays !== null ? { leadTimeDays: Math.max(0, Math.min(365, Number(v.leadTimeDays))) } : {}),
      pan: str(v.pan).toUpperCase(),
      ...(v.bankAccount || v.ifsc ? { bank: { name, account: str(v.bankAccount).replace(/\s/g, ""), ifsc: str(v.ifsc).toUpperCase() } } : {}),
    };
    if (found) {
      if (mode === "skip") return "skipped";
      // Blank cells don't wipe what's already there.
      const patch = Object.fromEntries(Object.entries(values).filter(([, x]) => x !== "" && x !== undefined));
      // Changing where a supplier is paid goes through the supplier screen (approval and the bank-change log), never a file.
      if (found.bank?.account || found.bank?.ifsc) delete patch.bank;
      await db.update(schema.invSuppliers).set(patch).where(eq(schema.invSuppliers.id, found.id));
      return "updated";
    }
    // When the workspace only buys from approved suppliers, an imported one waits for onboarding too.
    await db.insert(schema.invSuppliers).values({ orgId: s.orgId, ...values, approval: s.settings.requireApprovedSupplier ? "pending" : "approved" });
    return "created";
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.suppliers_imported", targetType: "organization", targetId: s.orgId, metadata: { created: r.created, updated: r.updated } });
  return r;
}

export async function importItems(s: Scope, raw: unknown) {
  requireWrite(s);
  await ensureDefaultWarehouse(s.orgId);
  const supplierIds = new Map<string, string>();
  const warehouseIds = new Map<string, string>();
  const supplierFor = async (name: string) => {
    if (!name) return null;
    const k = name.toLowerCase();
    if (supplierIds.has(k)) return supplierIds.get(k)!;
    let [sup] = await db.select({ id: schema.invSuppliers.id }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, s.orgId), sql`lower(${schema.invSuppliers.name}) = ${k}`));
    if (!sup) [sup] = await db.insert(schema.invSuppliers).values({ orgId: s.orgId, name }).returning({ id: schema.invSuppliers.id });
    supplierIds.set(k, sup.id);
    return sup.id;
  };
  const warehouseFor = async (name: string) => {
    const k = name.toLowerCase();
    if (warehouseIds.has(k)) return warehouseIds.get(k)!;
    let [w] = name
      ? await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), sql`(lower(${schema.invWarehouses.name}) = ${k} or lower(${schema.invWarehouses.code}) = ${k})`))
      : await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.isDefault, true)));
    if (!w && name) {
      if (!isPartOn(s.partsOff, "inventory", "locations")) throw new ApiError("forbidden", `There's no location called “${name}”, and more than one location is switched off`);
      [w] = await db.insert(schema.invWarehouses).values({ orgId: s.orgId, name }).returning({ id: schema.invWarehouses.id });
    }
    if (!w) [w] = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, s.orgId)).limit(1);
    warehouseIds.set(k, w.id);
    return w.id;
  };
  const r = await runImport(target("inventory.items"), raw, async (v, mode) => {
    const name = str(v.name);
    const sku = str(v.sku);
    const gst = Number(v.gstRate ?? 18);
    if (!(GST_RATES as readonly number[]).includes(gst)) throw new ApiError("validation_failed", `GST of ${gst}% isn't a GST rate (use 0, 0.25, 3, 5, 12, 18 or 28)`);
    const batch = str(v.batch);
    if ((batch || v.expiry) && !isPartOn(s.partsOff, "inventory", "batches")) throw new ApiError("forbidden", "Batches are switched off for this workspace");
    const [found] = await db
      .select()
      .from(schema.invItems)
      .where(and(eq(schema.invItems.orgId, s.orgId), sku ? sql`lower(${schema.invItems.sku}) = lower(${sku})` : sql`lower(${schema.invItems.name}) = lower(${name}) and ${schema.invItems.sku} = ''`))
      .limit(1);
    if (found && mode === "skip") return "skipped";
    const supplierId = await supplierFor(str(v.supplier));
    const values = {
      name,
      sku,
      barcode: str(v.barcode),
      unit: str(v.unit) || "pcs",
      category: str(v.category),
      hsn: str(v.hsn).replace(/\D/g, ""),
      gstRate: gst,
      ...(v.cost !== null ? { avgCost: Number(v.cost) } : {}),
      ...(v.reorderLevel !== null ? { reorderLevel: Number(v.reorderLevel) } : {}),
      ...(v.reorderQty !== null ? { reorderQty: Number(v.reorderQty) } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(batch ? { trackBatches: true } : {}),
    };
    let id: string;
    if (found) {
      if (found.variantId && values.unit !== "pcs") values.unit = "pcs";
      const patch = Object.fromEntries(Object.entries(values).filter(([, x]) => x !== "" && x !== undefined));
      await db.update(schema.invItems).set({ ...patch, updatedAt: new Date() }).where(eq(schema.invItems.id, found.id));
      id = found.id;
    } else {
      const [made] = await db.insert(schema.invItems).values({ orgId: s.orgId, ...values }).returning({ id: schema.invItems.id });
      id = made.id;
    }
    // Stock on hand becomes opening stock — only for new items, so re-importing doesn't double it.
    const qty = v.openingQty === null ? 0 : Number(v.openingQty);
    if (qty > 0 && !found) await adjust(s, { itemId: id, warehouseId: await warehouseFor(str(v.location)), qty, reason: "opening", batch, expiry: v.expiry ?? null, note: "Imported" });
    return found ? "updated" : "created";
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.items_imported", targetType: "organization", targetId: s.orgId, metadata: { created: r.created, updated: r.updated, errors: r.errors.length } });
  return r;
}
