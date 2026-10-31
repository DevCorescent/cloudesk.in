// Items, locations and suppliers; stock adjustments and physical counts; and
// bringing a store's products in as linked items.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { adjustSchema, countSchema, itemSchema, q3, supplierSchema, warehouseSchema, ADJUST_REASONS } from "@/lib/inventory/model";
import { gate } from "../approvals/engine";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import { requireWarehouseAccess, check, requireManage, requirePart, requireWrite, type Scope } from "./access";
import { balances, getItem, getWarehouse, isShelf, move, onOrder, totals, quarantined, reserved } from "./stock";
import { contains } from "../security/like";

// ─── Locations ───

export async function warehouses(orgId: string) {
  return db.select().from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId)).orderBy(desc(schema.invWarehouses.isDefault), asc(schema.invWarehouses.name));
}

/** The first location is made for you, so a workspace can start without setup. */
export async function ensureDefaultWarehouse(orgId: string) {
  const [w] = await db.select().from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, orgId)).limit(1);
  if (w) return;
  await db.insert(schema.invWarehouses).values({ orgId, name: "Main store room", code: "MAIN", isDefault: true });
}

export async function saveWarehouse(s: Scope, id: string | null, raw: unknown) {
  requireManage(s);
  const b = check(warehouseSchema, raw);
  if (!id) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, s.orgId));
    if (n >= 1) requirePart(s, "locations");
  }
  if (b.projectId) {
    const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, b.projectId), eq(schema.projects.orgId, s.orgId)));
    if (!p) throw new ApiError("validation_failed", "That project isn't in this workspace");
    const [taken] = await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(eq(schema.invWarehouses.projectId, b.projectId));
    if (taken && taken.id !== id) throw new ApiError("conflict", "That store already has a location");
  }
  const w = await db.transaction(async (tx) => {
    if (b.isDefault) await tx.update(schema.invWarehouses).set({ isDefault: false }).where(eq(schema.invWarehouses.orgId, s.orgId));
    if (id) {
      const cur = await getWarehouse(s.orgId, id, tx);
      if (cur.projectId !== b.projectId) {
        const [has] = await tx.select({ id: schema.invMoves.id }).from(schema.invMoves).where(eq(schema.invMoves.warehouseId, id)).limit(1);
        if (has) throw new ApiError("conflict", "A location with stock history can't be moved to or from a store's shelf");
      }
      const [r] = await tx.update(schema.invWarehouses).set(b).where(eq(schema.invWarehouses.id, id)).returning();
      return r;
    }
    const [r] = await tx.insert(schema.invWarehouses).values({ ...b, orgId: s.orgId }).returning();
    return r;
  });
  return w;
}

export async function deleteWarehouse(s: Scope, id: string) {
  requireManage(s);
  await getWarehouse(s.orgId, id);
  const [used] = await db.select({ id: schema.invMoves.id }).from(schema.invMoves).where(eq(schema.invMoves.warehouseId, id)).limit(1);
  const [po] = await db.select({ id: schema.invPurchaseOrders.id }).from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.warehouseId, id)).limit(1);
  if (used || po) throw new ApiError("conflict", "This location has history — switch it off instead");
  await db.delete(schema.invWarehouses).where(eq(schema.invWarehouses.id, id));
}

// ─── Suppliers ───

export async function suppliers(orgId: string) {
  const rows = await db
    .select({ sup: schema.invSuppliers, open: sql<number>`(select count(*)::int from inv_purchase_orders p where p.supplier_id = inv_suppliers.id and p.status in ('sent','partial'))`, spent: sql<number>`(select coalesce(sum(r.total),0)::bigint from inv_receipts r where r.supplier_id = inv_suppliers.id)` })
    .from(schema.invSuppliers)
    .where(eq(schema.invSuppliers.orgId, orgId))
    .orderBy(asc(schema.invSuppliers.name));
  return rows.map((r) => ({ ...r.sup, openOrders: r.open, spent: Number(r.spent) }));
}

export async function saveSupplier(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const b = check(supplierSchema, raw);
  if (id) {
    const [cur] = await db.select().from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, s.orgId), eq(schema.invSuppliers.id, id)));
    if (!cur) throw notFound("Supplier");
    const norm = (x: { account?: string; ifsc?: string } | null | undefined) => `${(x?.account ?? "").replace(/\s/g, "")}|${(x?.ifsc ?? "").toUpperCase()}`;
    const bankChanged = norm(cur.bank) !== norm(b.bank) && !!(cur.bank?.account || cur.bank?.ifsc);
    if (bankChanged) {
      // Changing where a supplier is paid is a classic fraud route: it can need approval, and it's always logged.
      const ref = randomUUID();
      const g = await gate(s.orgId, { kind: "inv.supplier_bank", refId: ref, label: `New bank details for ${b.name}`, amount: 0, requesterId: s.userId, link: "/inventory/suppliers", payload: { supplierId: id, bank: b.bank } });
      await audit({ orgId: s.orgId, actorId: s.userId, action: g.status === "pending" ? "inventory.supplier_bank_change_requested" : "inventory.supplier_bank_changed", targetType: "inv_supplier", targetId: id, metadata: { name: b.name, fromAccountEnding: (cur.bank?.account ?? "").slice(-4), toAccountEnding: (b.bank?.account ?? "").slice(-4) } });
      if (g.status === "pending") {
        const [r] = await db.update(schema.invSuppliers).set({ ...b, bank: cur.bank, pendingBank: { ...b.bank, requestedBy: s.userId, at: new Date().toISOString(), ref } }).where(eq(schema.invSuppliers.id, id)).returning();
        return { ...r, bankPendingApproval: true };
      }
    }
    const [r] = await db.update(schema.invSuppliers).set({ ...b, ...(bankChanged ? { pendingBank: null } : {}) }).where(eq(schema.invSuppliers.id, id)).returning();
    return r;
  }
  // When the workspace only buys from approved suppliers, a new one waits for onboarding.
  const [r] = await db.insert(schema.invSuppliers).values({ ...b, orgId: s.orgId, approval: s.settings.requireApprovedSupplier ? "pending" : "approved" }).returning();
  return r;
}

export async function deleteSupplier(s: Scope, id: string) {
  requireManage(s);
  const [po] = await db.select({ id: schema.invPurchaseOrders.id }).from(schema.invPurchaseOrders).where(eq(schema.invPurchaseOrders.supplierId, id)).limit(1);
  if (po) throw new ApiError("conflict", "This supplier has purchase orders — mark them inactive instead");
  const r = await db.delete(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, s.orgId), eq(schema.invSuppliers.id, id))).returning({ id: schema.invSuppliers.id });
  if (!r.length) throw notFound("Supplier");
}

// ─── Items ───

export type ItemRow = typeof schema.invItems.$inferSelect & { onHand: number; onOrder: number; value: number; low: boolean; byLocation: Record<string, number>; storeTitle: string | null };

export async function listItems(s: Scope, opts: { q?: string; category?: string; filter?: string; warehouseId?: string } = {}): Promise<ItemRow[]> {
  const t = opts.q ? contains(opts.q) : null;
  const rows = await db
    .select({ it: schema.invItems, product: schema.storeProducts.title })
    .from(schema.invItems)
    .leftJoin(schema.storeVariants, eq(schema.storeVariants.id, schema.invItems.variantId))
    .leftJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
    .where(and(eq(schema.invItems.orgId, s.orgId), t ? or(ilike(schema.invItems.name, t), ilike(schema.invItems.sku, t), ilike(schema.invItems.barcode, t)) : undefined, opts.category ? eq(schema.invItems.category, opts.category) : undefined, opts.filter === "inactive" ? eq(schema.invItems.active, false) : opts.filter === "all" ? undefined : eq(schema.invItems.active, true)))
    .orderBy(asc(schema.invItems.name));
  const ids = rows.map((r) => r.it.id);
  const [all, ordered] = await Promise.all([balances(s.orgId, { itemIds: ids }), onOrder(s.orgId)]);
  // Members limited to some branches see stock in their locations only.
  const bal = s.warehouses ? all.filter((b) => s.warehouses!.has(b.warehouseId)) : all;
  const byItem = new Map<string, Record<string, number>>();
  for (const b of bal) {
    const m = byItem.get(b.itemId) ?? {};
    m[b.warehouseId] = q3((m[b.warehouseId] ?? 0) + b.qty);
    byItem.set(b.itemId, m);
  }
  const tot = totals(bal);
  const out = rows.map(({ it, product }) => {
    const onHand = opts.warehouseId ? (byItem.get(it.id)?.[opts.warehouseId] ?? 0) : (tot.get(it.id) ?? 0);
    const oo = ordered.get(it.id) ?? 0;
    return { ...it, onHand, onOrder: oo, value: Math.round(onHand * it.avgCost), low: it.reorderLevel > 0 && onHand <= it.reorderLevel, byLocation: byItem.get(it.id) ?? {}, storeTitle: product };
  });
  if (opts.filter === "low") return out.filter((r) => r.low);
  if (opts.filter === "out") return out.filter((r) => r.onHand <= 0);
  return out;
}

export async function categories(orgId: string) {
  const rows = await db.selectDistinct({ c: schema.invItems.category }).from(schema.invItems).where(and(eq(schema.invItems.orgId, orgId), sql`${schema.invItems.category} <> ''`)).orderBy(asc(schema.invItems.category));
  return rows.map((r) => r.c);
}

export async function getItemDetail(s: Scope, id: string) {
  const it = await getItem(s.orgId, id);
  const [bal, moves, storeLog, pos, sup] = await Promise.all([
    balances(s.orgId, { itemIds: [id] }),
    db.select().from(schema.invMoves).where(eq(schema.invMoves.itemId, id)).orderBy(desc(schema.invMoves.createdAt)).limit(100),
    // Sales and store edits on a linked variant happen outside Inventory; show them too.
    it.variantId
      ? db
          .select({ id: schema.storeInventoryLog.id, delta: schema.storeInventoryLog.delta, reason: schema.storeInventoryLog.reason, ref: schema.storeInventoryLog.ref, createdAt: schema.storeInventoryLog.createdAt })
          .from(schema.storeInventoryLog)
          .where(and(eq(schema.storeInventoryLog.variantId, it.variantId), sql`${schema.storeInventoryLog.reason} not like 'inventory:%'`))
          .orderBy(desc(schema.storeInventoryLog.createdAt))
          .limit(100)
      : Promise.resolve([]),
    db.select({ id: schema.invPurchaseOrders.id, number: schema.invPurchaseOrders.number, status: schema.invPurchaseOrders.status, lines: schema.invPurchaseOrders.lines, expectedDate: schema.invPurchaseOrders.expectedDate }).from(schema.invPurchaseOrders).where(and(eq(schema.invPurchaseOrders.orgId, s.orgId), inArray(schema.invPurchaseOrders.status, ["draft", "sent", "partial"]), sql`${schema.invPurchaseOrders.lines} @> ${JSON.stringify([{ itemId: id }])}::jsonb`)),
    it.supplierId ? db.select({ id: schema.invSuppliers.id, name: schema.invSuppliers.name }).from(schema.invSuppliers).where(eq(schema.invSuppliers.id, it.supplierId)) : Promise.resolve([]),
  ]);
  const shelf = it.variantId ? await db.select({ id: schema.invWarehouses.id }).from(schema.invWarehouses).where(and(eq(schema.invWarehouses.orgId, s.orgId), eq(schema.invWarehouses.projectId, it.projectId!))) : [];
  const history = [
    ...moves.map((m) => ({ id: m.id, at: m.createdAt, qty: m.qty, kind: m.kind, warehouseId: m.warehouseId, batch: m.batch, refNo: m.refNo, refType: m.refType, refId: m.refId, note: m.note, unitCost: m.unitCost })),
    ...storeLog.map((l) => ({ id: l.id, at: l.createdAt, qty: l.delta, kind: l.reason === "Order" || l.reason === "POS sale" || l.reason === "Subscription renewal" ? "sale" : /cancel|restock|Returned/i.test(l.reason) ? "return" : "store", warehouseId: shelf[0]?.id ?? null, batch: "", refNo: l.ref ?? "", refType: "store", refId: null, note: l.reason, unitCost: it.avgCost })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return {
    item: it,
    supplier: sup[0] ?? null,
    stock: bal,
    onHand: totals(bal).get(id) ?? 0,
    reserved: (await reserved(s.orgId)).get(id) ?? 0,
    quarantined: (await quarantined(s.orgId)).get(id) ?? 0,
    serials: it.trackSerials ? await db.select({ serial: schema.invSerials.serial, status: schema.invSerials.status, warehouseId: schema.invSerials.warehouseId }).from(schema.invSerials).where(eq(schema.invSerials.itemId, id)).limit(500) : [],
    onOrder: pos.reduce((a, p) => a + p.lines.filter((l) => l.itemId === id).reduce((x, l) => x + Math.max(0, l.qty - l.received), 0), 0),
    openOrders: pos.map((p) => ({ id: p.id, number: p.number, status: p.status, expectedDate: p.expectedDate, qty: p.lines.filter((l) => l.itemId === id).reduce((x, l) => x + Math.max(0, l.qty - l.received), 0) })).filter((o) => o.qty > 0),
    history: history.slice(0, 150),
  };
}

export async function saveItem(s: Scope, id: string | null, raw: unknown) {
  requireWrite(s);
  const b = check(itemSchema, raw);
  if (b.trackBatches) requirePart(s, "batches");
  if (b.supplierId) {
    const [sup] = await db.select({ id: schema.invSuppliers.id }).from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, s.orgId), eq(schema.invSuppliers.id, b.supplierId)));
    if (!sup) throw new ApiError("validation_failed", "Pick a supplier from this workspace");
  }
  try {
    if (id) {
      const cur = await getItem(s.orgId, id);
      if (cur.variantId && b.unit !== "pcs") throw new ApiError("validation_failed", "Items linked to the store are counted in pieces");
      const [r] = await db.update(schema.invItems).set({ ...b, updatedAt: new Date() }).where(eq(schema.invItems.id, id)).returning();
      return r;
    }
    const [r] = await db.insert(schema.invItems).values({ ...b, orgId: s.orgId }).returning();
    return r;
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505" || (e as { code?: string }).code === "23505") throw new ApiError("conflict", "Another item already has that SKU");
    throw e;
  }
}

/** Items with history are switched off, not deleted, so the ledger stays whole. */
export async function deleteItem(s: Scope, id: string) {
  requireManage(s);
  await getItem(s.orgId, id);
  const [used] = await db.select({ id: schema.invMoves.id }).from(schema.invMoves).where(eq(schema.invMoves.itemId, id)).limit(1);
  const [po] = await db.select({ id: schema.invPurchaseOrders.id }).from(schema.invPurchaseOrders).where(sql`${schema.invPurchaseOrders.lines} @> ${JSON.stringify([{ itemId: id }])}::jsonb`).limit(1);
  if (used || po) {
    await db.update(schema.invItems).set({ active: false, updatedAt: new Date() }).where(eq(schema.invItems.id, id));
    return { archived: true };
  }
  await db.delete(schema.invItems).where(eq(schema.invItems.id, id));
  return { archived: false };
}

/**
 * Every variant of a project's store becomes an item linked to it, and the
 * store gets a location of its own whose quantities are the variants' stock.
 * Running it again only adds what's new.
 */
export async function linkStore(s: Scope, projectId: string) {
  requireWrite(s);
  const [p] = await db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, s.orgId)));
  if (!p) throw notFound("Project");
  const variants = await db
    .select({ v: schema.storeVariants, title: schema.storeProducts.title, hsn: schema.storeProducts.hsn, taxBps: schema.storeProducts.taxBps, vendor: schema.storeProducts.vendor, kind: schema.storeProducts.kind })
    .from(schema.storeVariants)
    .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
    .where(and(eq(schema.storeVariants.projectId, projectId), eq(schema.storeVariants.trackInventory, true), eq(schema.storeProducts.kind, "physical")));
  if (!variants.length) throw new ApiError("validation_failed", "This store has no physical products that track stock yet");
  return db.transaction(async (tx) => {
    let [wh] = await tx.select().from(schema.invWarehouses).where(eq(schema.invWarehouses.projectId, projectId));
    if (!wh) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.invWarehouses).where(eq(schema.invWarehouses.orgId, s.orgId));
      [wh] = await tx.insert(schema.invWarehouses).values({ orgId: s.orgId, name: `${p.name} — shop`, code: "SHOP", projectId, isDefault: n === 0 }).returning();
    }
    const existing = new Set((await tx.select({ v: schema.invItems.variantId }).from(schema.invItems).where(inArray(schema.invItems.variantId, variants.map((x) => x.v.id)))).map((r) => r.v));
    const fresh = variants.filter((x) => !existing.has(x.v.id));
    const rates = [0, 0.25, 3, 5, 12, 18, 28];
    if (fresh.length) {
      await tx.insert(schema.invItems).values(
        fresh.map((x) => {
          const rate = x.taxBps == null ? 18 : x.taxBps / 100;
          return {
            orgId: s.orgId,
            name: x.v.title && x.v.title !== "Default" ? `${x.title} — ${x.v.title}` : x.title,
            sku: "",
            barcode: x.v.barcode,
            unit: "pcs",
            category: x.vendor || "",
            hsn: x.hsn,
            gstRate: rates.includes(rate) ? rate : 18,
            avgCost: x.v.cost ?? 0,
            projectId,
            variantId: x.v.id,
          };
        }),
      );
    }
    await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.store_linked", targetType: "project", targetId: projectId, metadata: { added: fresh.length } });
    return { warehouseId: wh.id, added: fresh.length, already: existing.size };
  });
}

// ─── Adjustments and counts ───

export async function adjust(s: Scope, raw: unknown) {
  requireWrite(s);
  const b = check(adjustSchema, raw);
  if (b.batch || b.expiry) requirePart(s, "batches");
  await db.transaction(async (tx) => {
    requireWarehouseAccess(s, b.warehouseId);
    const [item, wh] = await Promise.all([getItem(s.orgId, b.itemId, tx), getWarehouse(s.orgId, b.warehouseId, tx)]);
    if (isShelf(item, wh) && b.batch) throw new ApiError("validation_failed", "A store's shelf doesn't keep batches");
    await move(tx, s, { item, warehouse: wh, qty: b.qty, kind: "adjust", batch: b.batch, expiry: b.expiry, note: [ADJUST_REASONS[b.reason], b.note].filter(Boolean).join(" — "), refType: b.reason });
  });
  await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.adjusted", targetType: "inv_item", targetId: b.itemId, metadata: { qty: b.qty, reason: b.reason } });
}

/** Record what was physically there; differences become count moves. */
export async function submitCount(s: Scope, raw: unknown) {
  requireWrite(s);
  const b = check(countSchema, raw);
  return db.transaction(async (tx) => {
    requireWarehouseAccess(s, b.warehouseId);
    const wh = await getWarehouse(s.orgId, b.warehouseId, tx);
    const ids = [...new Set(b.lines.map((l) => l.itemId))];
    const items = await tx.select().from(schema.invItems).where(and(eq(schema.invItems.orgId, s.orgId), inArray(schema.invItems.id, ids)));
    if (items.length !== ids.length) throw new ApiError("validation_failed", "Some items aren't in this workspace");
    const bal = await balances(s.orgId, { itemIds: ids, warehouseId: wh.id });
    let variance = 0;
    const lines = [];
    for (const l of b.lines) {
      const item = items.find((i) => i.id === l.itemId)!;
      const expected = bal.filter((x) => x.itemId === l.itemId && x.batch === l.batch).reduce((a, x) => a + x.qty, 0);
      const diff = q3(l.counted - expected);
      lines.push({ itemId: l.itemId, batch: l.batch, expected: q3(expected), counted: l.counted });
      if (diff) {
        variance += Math.round(diff * item.avgCost);
        await move(tx, { ...s, settings: { ...s.settings, blockNegative: false } }, { item, warehouse: wh, qty: diff, kind: "count", batch: l.batch, note: b.note || "Stock count" });
      }
    }
    const [c] = await tx.insert(schema.invCounts).values({ orgId: s.orgId, warehouseId: wh.id, lines, varianceValue: variance, note: b.note, createdBy: s.userId }).returning();
    await audit({ orgId: s.orgId, actorId: s.userId, action: "inventory.counted", targetType: "inv_warehouse", targetId: wh.id, metadata: { lines: lines.length, varianceValue: variance } });
    return c;
  });
}

export async function counts(orgId: string) {
  return db
    .select({ c: schema.invCounts, warehouse: schema.invWarehouses.name, by: schema.users.name })
    .from(schema.invCounts)
    .innerJoin(schema.invWarehouses, eq(schema.invWarehouses.id, schema.invCounts.warehouseId))
    .leftJoin(schema.users, eq(schema.users.id, schema.invCounts.createdBy))
    .where(eq(schema.invCounts.orgId, orgId))
    .orderBy(desc(schema.invCounts.createdAt))
    .limit(50)
    .then((r) => r.map((x) => ({ ...x.c, warehouse: x.warehouse, by: x.by })));
}

/** Store projects in this workspace not yet linked, for the "bring in your store" prompt. */
export async function storeProjects(orgId: string) {
  return db
    .select({ id: schema.projects.id, name: schema.projects.name, linked: sql<boolean>`exists(select 1 from inv_warehouses w where w.project_id = ${schema.projects.id})` })
    .from(schema.projects)
    .innerJoin(schema.stores, eq(schema.stores.projectId, schema.projects.id))
    .where(and(eq(schema.projects.orgId, orgId), isNull(schema.projects.archivedAt)));
}

/** A supplier bank change was approved: it takes effect (if it's still the one waiting). */
export async function supplierBankDecided(orgId: string, ref: string, approved: boolean) {
  const [sup] = await db.select().from(schema.invSuppliers).where(and(eq(schema.invSuppliers.orgId, orgId), sql`${schema.invSuppliers.pendingBank}->>'ref' = ${ref}`));
  if (!sup?.pendingBank) return;
  const { name, account, ifsc } = sup.pendingBank;
  await db.update(schema.invSuppliers).set(approved ? { bank: { name, account, ifsc }, pendingBank: null } : { pendingBank: null }).where(eq(schema.invSuppliers.id, sup.id));
  await audit({ orgId, actorId: null, action: approved ? "inventory.supplier_bank_changed" : "inventory.supplier_bank_change_rejected", targetType: "inv_supplier", targetId: sup.id, metadata: { name: sup.name, toAccountEnding: (account ?? "").slice(-4) } });
}
