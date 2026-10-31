// Inventory & purchasing API for a workspace. Dispatches on
// "METHOD section :id sub", like the CRM and HR APIs.
import { z } from "zod";
import { csvEscape } from "@/lib/data/model";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { saveSettings, scope } from "@/server/inventory/access";
import { adjust, categories, counts, deleteItem, deleteSupplier, deleteWarehouse, ensureDefaultWarehouse, getItemDetail, linkStore, listItems, saveItem, saveSupplier, saveWarehouse, storeProjects, submitCount, suppliers, warehouses } from "@/server/inventory/items";
import { cancelPo, closePo, deletePo, draftFromReorder, listPos, poDetail, receipts, receive, reorderList, savePo, sendPo } from "@/server/inventory/purchasing";
import { expiring, home, movements, reports } from "@/server/inventory/reports";
import { cancelTransfer, createTransfer, listTransfers, receiveTransfer, sendTransfer } from "@/server/inventory/transfers";
import { isPartOn } from "@/lib/workspace/modules";
import { importItems, importSuppliers } from "@/server/inventory/import";
import { syncInvoiceStock } from "@/server/inventory/invoice-stock";
import { availability, bins, cancelWave, countsDue, createWave, deleteBin, dispatchWave, moveInBins, packWave, pickWave, saveBin, scan, serialsOf, stockValue, waveCandidates, waveDetail, waves } from "@/server/inventory/warehouse";
import { scope as salesScope } from "@/server/sales/access";
import { deliver } from "@/server/sales/fulfil";
import { awardRfq, budgets, cancelRequisition, cancelRfq, deleteSupplierRate, matches, performance, requisitionToPos, requisitions, returnToSupplier, rfqDetail, rfqs, saveQuote, saveRequisition, saveRfq, saveSupplierRate, sendRfq, setBudget, setOnboarding, submitRequisition, supplierRates, supplierReturns } from "@/server/inventory/procurement";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const csvCell = (v: unknown) => csvEscape(v === null || v === undefined ? "" : String(v));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  // Ids become ":id"; words stay as they are ("items export", "items import").
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);

  switch (key) {
    case "GET meta": {
      await ensureDefaultWarehouse(orgId);
      const [whs, sups, cats, stores] = await Promise.all([warehouses(orgId), suppliers(orgId), categories(orgId), storeProjects(orgId)]);
      return { me: { write: s.write, manage: s.manage }, settings: s.settings, warehouses: s.warehouses ? whs.filter((w) => s.warehouses!.has(w.id)) : whs, suppliers: sups.map((x) => ({ id: x.id, name: x.name, state: x.state, active: x.active, approval: x.approval })), categories: cats, stores, parts: { purchasing: isPartOn(s.partsOff, "inventory", "purchasing"), locations: isPartOn(s.partsOff, "inventory", "locations"), batches: isPartOn(s.partsOff, "inventory", "batches"), procurement: isPartOn(s.partsOff, "inventory", "procurement") && isPartOn(s.partsOff, "inventory", "purchasing"), warehouse: isPartOn(s.partsOff, "inventory", "warehouse") } };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      // Invoices issued in the background (recurring ones) are caught up here.
      await syncInvoiceStock(orgId).catch(() => 0);
      return home(s);
    case "GET reports":
      return reports(s);
    case "GET movements":
      return { moves: await movements(s, qs) };
    case "GET expiring":
      return { batches: await expiring(s) };

    case "GET items":
      return { items: await listItems(s, qs) };
    case "POST items import":
      return importItems(s, await body(ctx));
    case "POST suppliers import":
      return importSuppliers(s, await body(ctx));
    case "GET items export": {
      const rows = await listItems(s, { filter: "all" });
      const head = ["name", "sku", "barcode", "unit", "category", "hsn", "gst_rate", "avg_cost", "on_hand", "on_order", "value", "reorder_level", "reorder_qty", "active"];
      const text = [head, ...rows.map((r) => [r.name, r.sku, r.barcode, r.unit, r.category, r.hsn, r.gstRate, (r.avgCost / 100).toFixed(2), r.onHand, r.onOrder, (r.value / 100).toFixed(2), r.reorderLevel, r.reorderQty, r.active ? "yes" : "no"])].map((r) => r.map(csvCell).join(",")).join("\n");
      return new Response("﻿" + text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="stock.csv"' } });
    }
    case "POST items":
      return { item: await saveItem(s, null, await body(ctx)) };
    case "GET items :id":
      return getItemDetail(s, id!);
    case "PUT items :id":
      return { item: await saveItem(s, id!, await body(ctx)) };
    case "DELETE items :id":
      return deleteItem(s, id!);
    case "POST link-store":
      return linkStore(s, z.object({ projectId: z.uuid() }).parse(await body(ctx)).projectId);
    case "POST adjust":
      await adjust(s, await body(ctx));
      return { ok: true };
    case "GET counts":
      return { counts: await counts(orgId) };
    case "POST counts":
      return { count: await submitCount(s, await body(ctx)) };

    case "GET warehouses":
      return { warehouses: (await warehouses(orgId)).filter((w) => !s.warehouses || s.warehouses.has(w.id)) };
    case "POST warehouses":
      return { warehouse: await saveWarehouse(s, null, await body(ctx)) };
    case "PUT warehouses :id":
      return { warehouse: await saveWarehouse(s, id!, await body(ctx)) };
    case "DELETE warehouses :id":
      await deleteWarehouse(s, id!);
      return { ok: true };

    // ── Warehouse floor ──
    case "GET bins":
      return bins(s, z.uuid().parse(qs.warehouseId));
    case "POST bins":
      return { bin: await saveBin(s, null, await body(ctx)) };
    case "PUT bins :id":
      return { bin: await saveBin(s, id!, await body(ctx)) };
    case "DELETE bins :id":
      await deleteBin(s, id!);
      return { ok: true };
    case "POST bin-moves":
      await moveInBins(s, await body(ctx));
      return { ok: true };
    case "GET serials":
      return { serials: await serialsOf(s, qs) };
    case "GET availability":
      return { items: await availability(s, qs.warehouseId || undefined) };
    case "GET wave-candidates":
      return { orders: await waveCandidates(s, z.uuid().parse(qs.warehouseId)) };
    case "GET waves":
      return { waves: await waves(s) };
    case "POST waves":
      return { wave: await createWave(s, await body(ctx)) };
    case "GET waves :id":
      return waveDetail(s, id!);
    case "POST waves :id pick":
      return { wave: await pickWave(s, id!, await body(ctx)) };
    case "POST waves :id pack":
      return { wave: await packWave(s, id!, await body(ctx)) };
    case "POST waves :id dispatch": {
      // Each order's challan is made by Sales, as the person dispatching.
      const ss = await salesScope(ctx, orgId);
      return dispatchWave(s, id!, (orderId, warehouseId, lines) => deliver(ss, { orderId, date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), warehouseId, lines }));
    }
    case "POST waves :id cancel":
      await cancelWave(s, id!);
      return { ok: true };
    case "GET scan":
      return scan(s, String(qs.code ?? ""));
    case "GET stock-value":
      return stockValue(s);
    case "GET counts-due":
      return countsDue(s);

    // ── Procurement ──
    case "GET requisitions":
      return { requisitions: await requisitions(s, qs) };
    case "POST requisitions":
      return { requisition: await saveRequisition(s, null, await body(ctx)) };
    case "PUT requisitions :id":
      return { requisition: await saveRequisition(s, id!, await body(ctx)) };
    case "POST requisitions :id submit":
      return submitRequisition(s, id!);
    case "POST requisitions :id cancel":
      await cancelRequisition(s, id!);
      return { ok: true };
    case "POST requisitions :id order":
      return requisitionToPos(s, id!, await body(ctx));
    case "GET rfqs":
      return { rfqs: await rfqs(s) };
    case "POST rfqs":
      return { rfq: await saveRfq(s, await body(ctx)) };
    case "GET rfqs :id":
      return rfqDetail(s, id!);
    case "POST rfqs :id send":
      return sendRfq(s, id!);
    case "POST rfqs :id quotes":
      return { quote: await saveQuote(s, id!, await body(ctx)) };
    case "POST rfqs :id award":
      return awardRfq(s, id!, await body(ctx));
    case "POST rfqs :id cancel":
      await cancelRfq(s, id!);
      return { ok: true };
    case "GET supplier-rates":
      return { rates: await supplierRates(s, qs.supplierId) };
    case "POST supplier-rates":
      return { rate: await saveSupplierRate(s, await body(ctx)) };
    case "DELETE supplier-rates :id":
      await deleteSupplierRate(s, id!);
      return { ok: true };
    case "POST suppliers :id onboarding":
      return { supplier: await setOnboarding(s, id!, await body(ctx)) };
    case "GET supplier-returns":
      return { returns: await supplierReturns(s) };
    case "POST supplier-returns":
      return returnToSupplier(s, await body(ctx));
    case "GET match":
      return { orders: await matches(s) };
    case "GET performance":
      return { suppliers: await performance(s) };
    case "GET purchase-budgets":
      return budgets(s, qs.month);
    case "POST purchase-budgets":
      return { budget: await setBudget(s, await body(ctx)) };

    case "GET suppliers":
      return { suppliers: await suppliers(orgId) };
    case "POST suppliers":
      return { supplier: await saveSupplier(s, null, await body(ctx)) };
    case "PUT suppliers :id":
      return { supplier: await saveSupplier(s, id!, await body(ctx)) };
    case "DELETE suppliers :id":
      await deleteSupplier(s, id!);
      return { ok: true };

    case "GET orders":
      return { orders: await listPos(s, qs) };
    case "POST orders":
      return { order: await savePo(s, null, await body(ctx)) };
    case "GET orders :id":
      return poDetail(s, id!);
    case "PUT orders :id":
      return { order: await savePo(s, id!, await body(ctx)) };
    case "DELETE orders :id":
      await deletePo(s, id!);
      return { ok: true };
    case "POST orders :id send":
      return sendPo(s, id!, z.object({ email: z.boolean().default(true) }).parse(await body(ctx)));
    case "POST orders :id cancel":
      await cancelPo(s, id!);
      return { ok: true };
    case "POST orders :id close":
      await closePo(s, id!);
      return { ok: true };

    case "GET receipts":
      return { receipts: await receipts(s) };
    case "POST receipts":
      return { receipt: await receive(s, await body(ctx)) };
    case "GET reorder":
      return reorderList(s);
    case "POST reorder":
      return draftFromReorder(s, await body(ctx));

    case "GET transfers":
      return { transfers: await listTransfers(s) };
    case "POST transfers":
      return { transfer: await createTransfer(s, await body(ctx)) };
    case "POST transfers :id send":
      await sendTransfer(s, id!);
      return { ok: true };
    case "POST transfers :id receive":
      await receiveTransfer(s, id!);
      return { ok: true };
    case "POST transfers :id cancel":
      await cancelTransfer(s, id!);
      return { ok: true };

  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
export const DELETE = route<P>(handle);
