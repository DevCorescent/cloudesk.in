// Cloudesk for Horeca: the dashboard API (venue, floor, orders, kitchen, menu,
// rooms, bar and valet).
import { z } from "zod";
import { readJson, requireProject, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { addBarMove, barMoves, barStock, counts, deleteBarItem, recordCount, saveBarItem } from "@/server/horeca/bar";
import { approveOrder, billOrder, bumpKot, cancelOrder, compItem, floorView, kitchenView, mergeOrders, orderView, payOrder, recentOrders, resolveRequest, setItemStatus, splitOrder, staffOrder, tableChecks, today, transferOrder } from "@/server/horeca/orders";
import { feedbackList, guestView, listGuests, saveGuest } from "@/server/horeca/guests";
import { addStockMove, deleteStockItem, deleteSupplier, foodCost, purchases, recordPurchase, recordStockCount, saveStockItem, saveSupplier, stockCounts, stockMoves, stockView } from "@/server/horeca/inventory";
import { copyMenu, salesReport } from "@/server/horeca/reports";
import { reservationsFor, saveReservation, setReservationStatus } from "@/server/horeca/reservations";
import { cashMove, closeShift, openShift, shiftReport, shifts, startShift } from "@/server/horeca/shifts";
import { deleteStaff, listStaff, recentEvents, saveStaff, unlock } from "@/server/horeca/staff";
import { actorSchema } from "@/lib/horeca/model";
import { addFolioCharge, addFolioPayment, availableRooms, bookingAction, bookingView, calendar, createBooking, deleteRoom, deleteRoomType, roomsSetup, saveRoom, saveRoomType, setHousekeeping, updateBooking } from "@/server/horeca/rooms";
import { createTicket, moveTicket, updateTicket, valetBoard } from "@/server/horeca/valet";
import { addTables, deleteArea, deleteCategory, deleteItem, deleteModifierGroup, deleteTable, getVenue, listAreas, listTables, menu, requireVenue, rotateTableQr, saveArea, saveCategory, saveItem, saveModifierGroup, saveTable, saveVenue, setAvailable, settingsOf } from "@/server/horeca/venue";
import { appUrl } from "@/server/services/mail";

type P = { projectId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const actor = (b: Record<string, unknown>) => actorSchema.parse({ staffId: b.staffId ?? null, staffTicket: b.staffTicket ?? null, approvalPin: b.approvalPin ?? null });

async function handle(ctx: AuthedContext, { projectId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const url = new URL(ctx.req.url);
  const ops = () => requireProject(ctx, projectId, "store:orders");
  const manage = () => requireProject(ctx, projectId, "store:manage");
  const key = `${m} ${section ?? ""}${id ? " :id" : ""}${sub ? ` ${sub}` : ""}`;

  switch (key) {
    // ─── Venue ───
    case "GET venue": {
      await ops();
      const v = await getVenue(projectId);
      return { venue: v ? { ...v, settings: settingsOf(v) } : null };
    }
    case "PUT venue": {
      await manage();
      const v = await saveVenue(projectId, await body(ctx));
      return { venue: { ...v, settings: settingsOf(v) } };
    }

    // ─── Service ───
    case "GET floor":
      await ops();
      return floorView(projectId);
    case "GET today":
      await ops();
      return today(projectId);
    case "GET kitchen":
      await ops();
      return kitchenView(projectId);
    case "GET orders":
      await ops();
      return { orders: await recentOrders(projectId) };
    case "GET orders :id":
      await ops();
      return orderView(projectId, id);
    case "POST orders":
      await ops();
      return staffOrder(projectId, await body(ctx));
    case "POST orders :id approve":
      await ops();
      return approveOrder(projectId, id);
    case "POST orders :id bill":
      await ops();
      return billOrder(projectId, id, await body(ctx));
    case "POST orders :id pay":
      await ops();
      return payOrder(projectId, id, await body(ctx));
    case "POST orders :id cancel":
      await ops();
      await cancelOrder(projectId, id, await body(ctx));
      return { ok: true };
    case "POST orders :id transfer":
      await ops();
      return transferOrder(projectId, id, await body(ctx));
    case "POST orders :id merge":
      await ops();
      return mergeOrders(projectId, id, await body(ctx));
    case "POST orders :id split":
      await ops();
      return splitOrder(projectId, id, await body(ctx));
    case "POST items :id status": {
      await ops();
      const b = await body(ctx);
      await setItemStatus(projectId, id, String(b.status ?? ""), b);
      return { ok: true };
    }
    case "POST items :id comp":
      await ops();
      return compItem(projectId, id, await body(ctx));
    case "POST kot": {
      await ops();
      const b = await readJson(ctx.req, z.object({ orderId: z.uuid(), kotNo: z.number().int(), status: z.string() }));
      await bumpKot(projectId, b.orderId, b.kotNo, b.status);
      return { ok: true };
    }
    case "POST requests :id done":
      await ops();
      await resolveRequest(projectId, id);
      return { ok: true };

    // ─── Floor & QR ───
    case "GET tables": {
      await ops();
      await requireVenue(projectId);
      const [areas, tables] = await Promise.all([listAreas(projectId), listTables(projectId)]);
      return { areas, tables: tables.map((t) => ({ ...t, url: appUrl(`/t/${t.token}`) })) };
    }
    case "POST areas":
      await manage();
      return { area: await saveArea(projectId, await body(ctx)) };
    case "PUT areas :id":
      await manage();
      return { area: await saveArea(projectId, await body(ctx), id) };
    case "DELETE areas :id":
      await manage();
      await deleteArea(projectId, id);
      return { ok: true };
    case "POST tables":
      await manage();
      return { table: await saveTable(projectId, await body(ctx)) };
    case "POST tables :id": {
      // Quick setup: many tables at once.
      await manage();
      if (id !== "bulk") throw notFound("Route");
      const b = await readJson(ctx.req, z.object({ areaId: z.uuid().nullable().default(null), prefix: z.string().trim().min(1).max(10).default("T"), from: z.number().int().min(0).max(999).default(1), count: z.number().int().min(1).max(60), seats: z.number().int().min(1).max(40).default(4) }));
      return { tables: await addTables(projectId, b) };
    }
    case "GET tables :id checks":
      await ops();
      return { checks: await tableChecks(projectId, id) };
    case "POST tables :id rotate":
      await manage();
      return { table: await rotateTableQr(projectId, id) };
    case "PUT tables :id":
      await manage();
      return { table: await saveTable(projectId, await body(ctx), id) };
    case "DELETE tables :id":
      await manage();
      await deleteTable(projectId, id);
      return { ok: true };

    // ─── Menu ───
    case "GET menu":
      await ops();
      return menu(projectId);
    case "POST menu :id": {
      // Copy another outlet's menu in (chains). Needs access to that outlet too.
      if (id !== "copy") throw notFound("Route");
      await manage();
      const b = await readJson(ctx.req, z.object({ fromProjectId: z.uuid() }));
      await requireProject(ctx, b.fromProjectId, "store:manage");
      return copyMenu(projectId, b.fromProjectId);
    }

    // ─── Staff & security ───
    case "GET staff":
      await ops();
      return { staff: await listStaff(projectId) };
    case "POST staff":
      await manage();
      return { staff: await saveStaff(projectId, await body(ctx)) };
    case "PUT staff :id":
      await manage();
      return { staff: await saveStaff(projectId, await body(ctx), id) };
    case "DELETE staff :id":
      await manage();
      await deleteStaff(projectId, id);
      return { ok: true };
    case "POST unlock": {
      await ops();
      const b = await readJson(ctx.req, z.object({ staffId: z.uuid(), pin: z.string().max(6) }));
      return { staff: await unlock(projectId, b.staffId, b.pin) };
    }
    case "GET events":
      await manage();
      return { events: await recentEvents(projectId, Number(url.searchParams.get("days") ?? 7)) };

    // ─── Till ───
    case "GET shift": {
      await ops();
      const s = await openShift(projectId);
      return { shift: s ? await shiftReport(projectId, s.id) : null };
    }
    case "POST shift :id": {
      await ops();
      const b = await body(ctx);
      if (id === "open") return { shift: await shiftReport(projectId, (await startShift(projectId, b, actor(b))).id) };
      if (id === "cash") return { shift: await cashMove(projectId, b, actor(b)) };
      if (id === "close") return { shift: await closeShift(projectId, b, actor(b)) };
      throw notFound("Route");
    }
    case "GET shifts":
      await ops();
      return { shifts: await shifts(projectId) };
    case "GET shifts :id":
      await ops();
      return shiftReport(projectId, id);

    // ─── Reservations ───
    case "GET reservations":
      await ops();
      return reservationsFor(projectId, url.searchParams.get("day") ?? undefined);
    case "POST reservations":
      await ops();
      return { reservation: await saveReservation(projectId, await body(ctx)) };
    case "PUT reservations :id":
      await ops();
      return { reservation: await saveReservation(projectId, await body(ctx), id) };
    case "POST reservations :id status": {
      await ops();
      const b = await readJson(ctx.req, z.object({ status: z.string(), tableId: z.uuid().nullable().optional() }));
      return { reservation: await setReservationStatus(projectId, id, b.status, b.tableId) };
    }

    // ─── Kitchen inventory ───
    case "GET stock":
      await ops();
      return stockView(projectId);
    case "POST stock-items":
      await manage();
      return { item: await saveStockItem(projectId, await body(ctx)) };
    case "PUT stock-items :id":
      await manage();
      return { item: await saveStockItem(projectId, await body(ctx), id) };
    case "DELETE stock-items :id":
      await manage();
      await deleteStockItem(projectId, id);
      return { ok: true };
    case "POST suppliers":
      await manage();
      return { supplier: await saveSupplier(projectId, await body(ctx)) };
    case "PUT suppliers :id":
      await manage();
      return { supplier: await saveSupplier(projectId, await body(ctx), id) };
    case "DELETE suppliers :id":
      await manage();
      await deleteSupplier(projectId, id);
      return { ok: true };
    case "GET purchases":
      await ops();
      return { purchases: await purchases(projectId) };
    case "POST purchases":
      await ops();
      return { purchase: await recordPurchase(projectId, ctx.user.id, await body(ctx)) };
    case "GET stock-moves":
      await ops();
      return { moves: await stockMoves(projectId, url.searchParams.get("item") ?? undefined) };
    case "POST stock-moves":
      await ops();
      await addStockMove(projectId, ctx.user.id, await body(ctx));
      return { ok: true };
    case "GET stock-counts":
      await ops();
      return { counts: await stockCounts(projectId) };
    case "POST stock-counts":
      await ops();
      return { count: await recordStockCount(projectId, ctx.user.id, await body(ctx)) };
    case "GET food-cost":
      await ops();
      return { items: await foodCost(projectId) };

    // ─── Guests ───
    case "GET guests":
      await ops();
      return { guests: await listGuests(projectId, url.searchParams.get("q") ?? "") };
    case "POST guests":
      await ops();
      return { guest: await saveGuest(projectId, await body(ctx)) };
    case "PUT guests :id":
      await ops();
      return { guest: await saveGuest(projectId, await body(ctx), id) };
    case "GET guests :id":
      await ops();
      return guestView(projectId, id);
    case "GET feedback":
      await ops();
      return feedbackList(projectId);

    // ─── Reports ───
    case "GET reports":
      await ops();
      return salesReport(projectId, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
    case "POST categories":
      await manage();
      return { category: await saveCategory(projectId, await body(ctx)) };
    case "PUT categories :id":
      await manage();
      return { category: await saveCategory(projectId, await body(ctx), id) };
    case "DELETE categories :id":
      await manage();
      await deleteCategory(projectId, id);
      return { ok: true };
    case "POST modifiers":
      await manage();
      return { group: await saveModifierGroup(projectId, await body(ctx)) };
    case "PUT modifiers :id":
      await manage();
      return { group: await saveModifierGroup(projectId, await body(ctx), id) };
    case "DELETE modifiers :id":
      await manage();
      await deleteModifierGroup(projectId, id);
      return { ok: true };
    case "POST menu-items":
      await manage();
      return { item: await saveItem(projectId, await body(ctx)) };
    case "PUT menu-items :id":
      await manage();
      return { item: await saveItem(projectId, await body(ctx), id) };
    case "DELETE menu-items :id":
      await manage();
      await deleteItem(projectId, id);
      return { ok: true };
    case "POST menu-items :id available": {
      await ops();
      const b = await readJson(ctx.req, z.object({ available: z.boolean() }));
      return { item: await setAvailable(projectId, id, b.available) };
    }

    // ─── Rooms ───
    case "GET rooms":
      await ops();
      return roomsSetup(projectId);
    case "POST room-types":
      await manage();
      return { type: await saveRoomType(projectId, await body(ctx)) };
    case "PUT room-types :id":
      await manage();
      return { type: await saveRoomType(projectId, await body(ctx), id) };
    case "DELETE room-types :id":
      await manage();
      await deleteRoomType(projectId, id);
      return { ok: true };
    case "POST rooms":
      await manage();
      return { room: await saveRoom(projectId, await body(ctx)) };
    case "PUT rooms :id":
      await manage();
      return { room: await saveRoom(projectId, await body(ctx), id) };
    case "DELETE rooms :id":
      await manage();
      await deleteRoom(projectId, id);
      return { ok: true };
    case "POST rooms :id housekeeping": {
      await ops();
      const b = await readJson(ctx.req, z.object({ state: z.string() }));
      return { room: await setHousekeeping(projectId, id, b.state) };
    }
    case "GET calendar":
      await ops();
      return calendar(projectId, url.searchParams.get("from") ?? "", Number(url.searchParams.get("days") ?? 14));
    case "GET availability":
      await ops();
      return availableRooms(projectId, url.searchParams.get("checkIn") ?? "", url.searchParams.get("checkOut") ?? "");
    case "POST bookings":
      await ops();
      return { booking: await createBooking(projectId, await body(ctx)) };
    case "GET bookings :id":
      await ops();
      return bookingView(projectId, id);
    case "PUT bookings :id":
      await ops();
      return updateBooking(projectId, id, await body(ctx));
    case "POST bookings :id action": {
      await ops();
      const b = await readJson(ctx.req, z.object({ action: z.string(), force: z.boolean().default(false) }));
      return bookingAction(projectId, id, b.action, { force: b.force });
    }
    case "POST bookings :id charges":
      await ops();
      return addFolioCharge(projectId, id, await body(ctx));
    case "POST bookings :id payments":
      await ops();
      return addFolioPayment(projectId, id, await body(ctx));

    // ─── Bar ───
    case "GET bar":
      await ops();
      return barStock(projectId);
    case "POST bar-items":
      await manage();
      return { item: await saveBarItem(projectId, await body(ctx)) };
    case "PUT bar-items :id":
      await manage();
      return { item: await saveBarItem(projectId, await body(ctx), id) };
    case "DELETE bar-items :id":
      await manage();
      await deleteBarItem(projectId, id);
      return { ok: true };
    case "POST bar-moves":
      await ops();
      await addBarMove(projectId, ctx.user.id, await body(ctx));
      return { ok: true };
    case "GET bar-moves":
      await ops();
      return { moves: await barMoves(projectId, url.searchParams.get("item") ?? undefined) };
    case "POST bar-counts":
      await ops();
      return { count: await recordCount(projectId, ctx.user.id, await body(ctx)) };
    case "GET bar-counts":
      await ops();
      return { counts: await counts(projectId) };

    // ─── Valet ───
    case "GET valet":
      await ops();
      return valetBoard(projectId);
    case "POST valet":
      await ops();
      return { ticket: await createTicket(projectId, await body(ctx)) };
    case "PUT valet :id":
      await ops();
      return { ticket: await updateTicket(projectId, id, await body(ctx)) };
    case "POST valet :id status": {
      await ops();
      const b = await readJson(ctx.req, z.object({ status: z.string() }).passthrough());
      return { ticket: await moveTicket(projectId, id, b.status, b) };
    }
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
