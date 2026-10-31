// Importing recipes from a spreadsheet: one row per component, grouped into a
// recipe per product (and recipe name). Items are matched by SKU then name.
// Each product's recipe is saved through the same checks as the screen
// (no loops, one line per component), replacing its components.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { target } from "@/lib/import/targets";
import { validateRow } from "@/lib/import/engine";
import { ApiError } from "../http/errors";
import { importBody, str, type ImportResult } from "../import/run";
import { requireManage, type Scope } from "./access";
import { saveBom } from "./production";

export async function importBoms(s: Scope, raw: unknown): Promise<ImportResult> {
  requireManage(s);
  const parsed = importBody.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation_failed", parsed.error.issues[0]?.message ?? "Check the rows");
  const t = target("manufacturing.boms");
  const out: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const find = async (ref: string) => {
    const k = ref.trim().toLowerCase();
    const [it] = await db.select({ id: schema.invItems.id }).from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), sql`(lower(${schema.invItems.sku}) = ${k} or lower(${schema.invItems.name}) = ${k})`)).orderBy(sql`lower(${schema.invItems.sku}) = ${k} desc`).limit(1);
    return it?.id ?? null;
  };
  // Group rows into recipes, remembering which rows made each one.
  const groups = new Map<string, { productId: string; name: string; outputQty: number; lines: { itemId: string; qty: number; scrapPct: number }[]; rows: number[] }>();
  for (const [i, row] of parsed.data.rows.entries()) {
    const v = validateRow(row, t);
    if (!v.ok) {
      out.errors.push({ row: i, message: v.error });
      continue;
    }
    const productId = await find(str(v.values.product));
    const componentId = await find(str(v.values.component));
    if (!productId || !componentId) {
      out.errors.push({ row: i, message: `“${str(productId ? v.values.component : v.values.product)}” isn't an item in Inventory — import items first` });
      continue;
    }
    const name = str(v.values.recipe) || "Standard";
    const key = `${productId}|${name.toLowerCase()}`;
    const g = groups.get(key) ?? { productId, name, outputQty: Number(v.values.outputQty) || 1, lines: [], rows: [] };
    const same = g.lines.find((l) => l.itemId === componentId);
    if (same) same.qty += Number(v.values.qty);
    else g.lines.push({ itemId: componentId, qty: Number(v.values.qty), scrapPct: Number(v.values.scrapPct) || 0 });
    g.rows.push(i);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    try {
      const [cur] = await db.select().from(schema.mfgBoms).where(and(eq(schema.mfgBoms.orgId, s.orgId), eq(schema.mfgBoms.itemId, g.productId), sql`lower(${schema.mfgBoms.name}) = ${g.name.toLowerCase()}`));
      await saveBom(s, cur?.id ?? null, { itemId: g.productId, name: g.name, outputQty: g.outputQty, lines: g.lines, operations: cur?.operations ?? [], isDefault: cur?.isDefault ?? true, active: true, notes: cur?.notes ?? "" });
      out[cur ? "updated" : "created"] += g.rows.length;
    } catch (e) {
      for (const r of g.rows) out.errors.push({ row: r, message: e instanceof ApiError ? e.message : "Couldn't save this recipe" });
    }
  }
  return out;
}
