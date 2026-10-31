// Cloudesk for Horeca: table orders, kitchen tickets (KOTs), the kitchen
// display, bills and payments, guest requests and the live floor.
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { actorSchema, billTotals, guestOrderSchema, lineSchema, offerFor, paymentSchema, servedNow } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { creditVisit, leaveFeedback, redeemPoints, upsertGuest } from "./guests";
import { moveRecipe } from "./inventory";
import { upcomingByTable } from "./reservations";
import { openShift } from "./shifts";
import { actorName, approve, logEvent, type Actor } from "./staff";
import { check, nextNumber, requireVenue, settingsOf, type Venue } from "./venue";

type Order = typeof schema.horecaOrders.$inferSelect;
type OrderItem = typeof schema.horecaOrderItems.$inferSelect;
type Line = z.infer<typeof lineSchema>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const OPEN = ["open", "billed"];
const actorOf = (raw: unknown): Actor => actorSchema.parse({ staffId: (raw as { staffId?: unknown } | null)?.staffId ?? null, staffTicket: (raw as { staffTicket?: unknown } | null)?.staffTicket ?? null, approvalPin: (raw as { approvalPin?: unknown } | null)?.approvalPin ?? null });

/** An order's bill: lines, discount, service, delivery, tax, tip and round-off. */
export function totalsOf(o: Pick<Order, "discount" | "serviceChargeBps" | "tip" | "deliveryFee" | "payments">, items: Parameters<typeof billTotals>[0], venue: Venue) {
  const paid = (o.payments as { amount: number }[]).reduce((a, p) => a + p.amount, 0);
  return billTotals(items, { discount: o.discount, serviceChargeBps: o.serviceChargeBps, venueTaxBps: venue.taxBps, tip: o.tip, paid, deliveryFee: o.deliveryFee, roundOff: settingsOf(venue).pos.roundOff });
}
const istNow = () => {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  return { day: d.getUTCDay(), hhmm: d.toISOString().slice(11, 16) };
};
export const nowHHMM = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata", hour12: false });
const istDay = sql`(now() at time zone 'Asia/Kolkata')::date`;

/** Menu lines → order rows: checks availability, add-on rules, and prices them. */
async function buildLines(projectId: string, venue: Venue, lines: Line[], forGuest: boolean) {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const items = await db
    .select({ item: schema.horecaItems, cat: schema.horecaCategories })
    .from(schema.horecaItems)
    .innerJoin(schema.horecaCategories, eq(schema.horecaCategories.id, schema.horecaItems.categoryId))
    .where(and(eq(schema.horecaItems.projectId, projectId), inArray(schema.horecaItems.id, ids)));
  const groups = await db.select().from(schema.horecaModifierGroups).where(eq(schema.horecaModifierGroups.projectId, projectId));
  const now = nowHHMM();
  const rules = settingsOf(venue).pricing.rules;
  const at = istNow();
  return lines.map((l) => {
    const hit = items.find((x) => x.item.id === l.itemId);
    if (!hit) throw new ApiError("validation_failed", "Something in the order isn't on the menu any more.");
    const { item, cat } = hit;
    if (!item.available || !cat.active) throw new ApiError("validation_failed", `Sorry, “${item.name}” is not available right now.`);
    if (forGuest && !servedNow(cat.availableFrom, cat.availableTo, now)) throw new ApiError("validation_failed", `“${item.name}” is served ${cat.availableFrom}–${cat.availableTo}.`);
    const mine = groups.filter((g) => (item.modifierGroupIds as string[]).includes(g.id));
    const chosen: { group: string; name: string; price: number }[] = [];
    for (const g of mine) {
      const opts = g.options as { id: string; name: string; price: number }[];
      const picked = opts.filter((o) => l.options.includes(o.id));
      if (picked.length < g.minSelect) throw new ApiError("validation_failed", `Choose ${g.minSelect === 1 ? "an option" : `${g.minSelect} options`} for “${g.name}” on ${item.name}.`);
      if (picked.length > g.maxSelect) throw new ApiError("validation_failed", `Choose at most ${g.maxSelect} for “${g.name}” on ${item.name}.`);
      chosen.push(...picked.map((o) => ({ group: g.name, name: o.name, price: o.price })));
    }
    if (l.options.some((o) => !mine.some((g) => (g.options as { id: string }[]).some((x) => x.id === o)))) throw new ApiError("validation_failed", `That option isn't available for ${item.name}.`);
    // Happy hours and timed offers: shown on the bill as a line under the dish.
    const base = item.price + chosen.reduce((a, c) => a + c.price, 0);
    const offer = offerFor(rules, cat.id, at);
    if (offer) chosen.push({ group: "Offer", name: `${offer.name} −${offer.pct}%`, price: -Math.round((base * offer.pct) / 100) });
    return {
      projectId,
      itemId: item.id,
      name: item.name,
      qty: l.qty,
      unitPrice: item.price + chosen.reduce((a, c) => a + c.price, 0),
      modifiers: chosen,
      notes: l.notes,
      station: cat.station,
      taxBps: item.taxBps ?? venue.taxBps,
      barItemId: item.barItemId,
      pourMl: item.pourMl,
      recipe: item.recipe,
    };
  });
}

/** Pour drinks from (or back into) bar stock. */
async function pour(tx: Tx, rows: Pick<OrderItem, "id" | "projectId" | "barItemId" | "pourMl" | "qty" | "name">[], sign: -1 | 1) {
  for (const r of rows) {
    if (!r.barItemId || !r.pourMl) continue;
    const ml = r.pourMl * r.qty * sign;
    await tx.insert(schema.horecaBarMoves).values({ projectId: r.projectId, barItemId: r.barItemId, kind: sign < 0 ? "sale" : "void", ml, note: `${r.qty} × ${r.name}`, orderItemId: r.id });
    await tx.update(schema.horecaBarItems).set({ stockMl: sql`${schema.horecaBarItems.stockMl} + ${ml}` }).where(eq(schema.horecaBarItems.id, r.barItemId));
  }
}

/** Send waiting items to the kitchen: one KOT per station, and pour any drinks. */
async function fire(tx: Tx, projectId: string, rows: OrderItem[]) {
  const byStation = new Map<string, OrderItem[]>();
  for (const r of rows) byStation.set(r.station, [...(byStation.get(r.station) ?? []), r]);
  for (const [, items] of byStation) {
    const kot = await nextNumber(projectId, "nextKotNo", tx);
    await tx.update(schema.horecaOrderItems).set({ status: "new", kotNo: kot, updatedAt: new Date() }).where(inArray(schema.horecaOrderItems.id, items.map((i) => i.id)));
  }
  await pour(tx, rows, -1);
  await moveRecipe(tx, projectId, rows, -1);
}

async function ownOrder(projectId: string, orderId: string) {
  const [o] = await db.select().from(schema.horecaOrders).where(and(eq(schema.horecaOrders.id, orderId), eq(schema.horecaOrders.projectId, projectId)));
  if (!o) throw notFound("Order");
  return o;
}

/** The table's running order, or a new one. */
async function openFor(tx: Tx, venue: Venue, o: { tableId: string | null; source: string; guestName?: string; guestPhone?: string; notes?: string; covers?: number; staffName?: string; guestId?: string | null; deliveryAddress?: string; deliveryFee?: number }) {
  if (o.tableId) {
    const [cur] = await tx
      .select()
      .from(schema.horecaOrders)
      .where(and(eq(schema.horecaOrders.projectId, venue.projectId), eq(schema.horecaOrders.tableId, o.tableId), inArray(schema.horecaOrders.status, OPEN)))
      .orderBy(desc(schema.horecaOrders.createdAt))
      .limit(1);
    if (cur) {
      const patch = { ...(cur.status === "billed" ? { status: "open", billedAt: null } : {}), ...(!cur.covers && o.covers ? { covers: o.covers } : {}), ...(!cur.guestId && o.guestId ? { guestId: o.guestId, guestName: cur.guestName || o.guestName || "", guestPhone: cur.guestPhone || o.guestPhone || "" } : {}) };
      if (Object.keys(patch).length) await tx.update(schema.horecaOrders).set(patch).where(eq(schema.horecaOrders.id, cur.id));
      return cur;
    }
  }
  const number = await nextNumber(venue.projectId, "nextOrderNo", tx);
  const [n] = await tx
    .insert(schema.horecaOrders)
    .values({ projectId: venue.projectId, number, tableId: o.tableId, source: o.source, guestName: o.guestName ?? "", guestPhone: o.guestPhone ?? "", notes: o.notes ?? "", serviceChargeBps: o.source === "takeaway" || o.source === "delivery" ? 0 : venue.serviceChargeBps, covers: o.covers ?? 0, staffName: o.staffName ?? "", guestId: o.guestId ?? null, deliveryAddress: o.deliveryAddress ?? "", deliveryFee: o.deliveryFee ?? 0 })
    .returning();
  return n;
}

export async function orderView(projectId: string, orderId: string) {
  const venue = await requireVenue(projectId);
  const o = await ownOrder(projectId, orderId);
  const items = await db.select().from(schema.horecaOrderItems).where(eq(schema.horecaOrderItems.orderId, o.id)).orderBy(asc(schema.horecaOrderItems.createdAt));
  const [table] = o.tableId ? await db.select({ name: schema.horecaTables.name, kind: schema.horecaTables.kind }).from(schema.horecaTables).where(eq(schema.horecaTables.id, o.tableId)) : [];
  const [guest] = o.guestId ? await db.select({ id: schema.horecaGuests.id, name: schema.horecaGuests.name, phone: schema.horecaGuests.phone, points: schema.horecaGuests.points, visits: schema.horecaGuests.visits }).from(schema.horecaGuests).where(eq(schema.horecaGuests.id, o.guestId)) : [];
  return { order: o, table: table ?? null, guest: guest ?? null, items, totals: totalsOf(o, items, venue) };
}

/** Staff take an order — at a table, takeaway, delivery or room service; items go to the kitchen straight away. */
export async function staffOrder(projectId: string, raw: unknown) {
  const input = check(
    z.object({
      /** Add to this open order (takeaway and delivery have no table to find it by). */
      orderId: z.uuid().nullable().default(null),
      tableId: z.uuid().nullable().default(null),
      source: z.enum(["staff", "takeaway", "delivery", "room"]).default("staff"),
      guestName: z.string().trim().max(80).default(""),
      guestPhone: z.string().trim().max(20).default(""),
      covers: z.number().int().min(0).max(500).default(0),
      deliveryAddress: z.string().trim().max(300).default(""),
      deliveryFee: z.number().int().min(0).nullable().default(null),
      lines: z.array(lineSchema).min(1).max(60),
      notes: z.string().trim().max(300).default(""),
    }),
    raw,
  );
  const venue = await requireVenue(projectId);
  const s = settingsOf(venue);
  if (input.source === "delivery" && !input.deliveryAddress) throw new ApiError("validation_failed", "Add the delivery address", { deliveryAddress: ["Required"] });
  if (input.tableId) {
    const [t] = await db.select({ id: schema.horecaTables.id }).from(schema.horecaTables).where(and(eq(schema.horecaTables.id, input.tableId), eq(schema.horecaTables.projectId, projectId)));
    if (!t) throw notFound("Table");
  }
  const staffName = await actorName(projectId, actorOf(raw));
  const rows = await buildLines(projectId, venue, input.lines, false);
  const order = await db.transaction(async (tx) => {
    const guestId = input.guestPhone ? await upsertGuest(tx, projectId, { name: input.guestName, phone: input.guestPhone }) : null;
    let existing: Order | null = null;
    if (input.orderId) {
      const [cur] = await tx.select().from(schema.horecaOrders).where(and(eq(schema.horecaOrders.id, input.orderId), eq(schema.horecaOrders.projectId, projectId)));
      if (!cur) throw notFound("Order");
      if (!OPEN.includes(cur.status)) throw new ApiError("conflict", "That order is already closed");
      if (cur.status === "billed") await tx.update(schema.horecaOrders).set({ status: "open", billedAt: null }).where(eq(schema.horecaOrders.id, cur.id));
      if (!cur.guestId && guestId) await tx.update(schema.horecaOrders).set({ guestId, guestName: cur.guestName || input.guestName, guestPhone: cur.guestPhone || input.guestPhone }).where(eq(schema.horecaOrders.id, cur.id));
      existing = cur;
    }
    const o = existing ?? await openFor(tx, venue, {
      tableId: input.tableId,
      source: input.source,
      guestName: input.guestName,
      guestPhone: input.guestPhone,
      notes: input.notes,
      covers: input.covers,
      staffName,
      guestId,
      deliveryAddress: input.deliveryAddress,
      deliveryFee: input.source === "delivery" ? (input.deliveryFee ?? s.pos.deliveryFee) : 0,
    });
    const added = await tx.insert(schema.horecaOrderItems).values(rows.map((r) => ({ ...r, orderId: o.id, status: "new", staffName }))).returning();
    await fire(tx, projectId, added);
    return o;
  });
  return orderView(projectId, order.id);
}

/** Waiter confirms a guest's QR order: its items go to the kitchen. */
export async function approveOrder(projectId: string, orderId: string) {
  await ownOrder(projectId, orderId);
  await db.transaction(async (tx) => {
    const waiting = await tx.select().from(schema.horecaOrderItems).where(and(eq(schema.horecaOrderItems.orderId, orderId), eq(schema.horecaOrderItems.status, "pending")));
    if (waiting.length) await fire(tx, projectId, waiting);
  });
  return orderView(projectId, orderId);
}

const FLOW = ["new", "preparing", "ready", "served"];
/**
 * Kitchen and floor move items along. Cancelling (void) an item already sent
 * to the kitchen may need a manager's PIN; it puts drinks and ingredients back
 * and is logged with its reason.
 */
export async function setItemStatus(projectId: string, itemId: string, status: string, raw: unknown = {}) {
  if (![...FLOW, "void"].includes(status)) throw new ApiError("validation_failed", "Unknown status");
  const [it] = await db.select().from(schema.horecaOrderItems).where(and(eq(schema.horecaOrderItems.id, itemId), eq(schema.horecaOrderItems.projectId, projectId)));
  if (!it) throw notFound("Item");
  if (it.status === "void") throw new ApiError("conflict", "That item was cancelled");
  if (status !== "void") {
    await db.update(schema.horecaOrderItems).set({ status, updatedAt: new Date() }).where(eq(schema.horecaOrderItems.id, itemId));
    return;
  }
  const actor = actorOf(raw);
  const reason = String((raw as { reason?: unknown })?.reason ?? "").trim().slice(0, 200);
  const venue = await requireVenue(projectId);
  const fired = it.kotNo !== null && it.status !== "pending";
  const approvedBy = fired && settingsOf(venue).security.voidNeedsApproval ? await approve(projectId, actor, "Cancelling an item sent to the kitchen") : "";
  const staffName = await actorName(projectId, actor);
  await db.transaction(async (tx) => {
    await tx.update(schema.horecaOrderItems).set({ status: "void", voidReason: reason, updatedAt: new Date() }).where(eq(schema.horecaOrderItems.id, itemId));
    if (fired) {
      await pour(tx, [it], 1);
      await moveRecipe(tx, projectId, [it], 1);
    }
    await logEvent({ projectId, kind: "void", orderId: it.orderId, staffName, approvedBy, amount: it.comp ? 0 : it.qty * it.unitPrice, detail: `${it.qty} × ${it.name}${reason ? ` — ${reason}` : ""}` }, tx);
  });
}

/** On the house: the item stays on the bill at no charge. */
export async function compItem(projectId: string, itemId: string, raw: unknown) {
  const input = check(z.object({ comp: z.boolean(), reason: z.string().trim().max(200).default("") }), raw);
  const [it] = await db.select().from(schema.horecaOrderItems).where(and(eq(schema.horecaOrderItems.id, itemId), eq(schema.horecaOrderItems.projectId, projectId)));
  if (!it) throw notFound("Item");
  if (it.status === "void") throw new ApiError("conflict", "That item was cancelled");
  const o = await ownOrder(projectId, it.orderId);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This order is already closed");
  const venue = await requireVenue(projectId);
  const actor = actorOf(raw);
  const approvedBy = input.comp && settingsOf(venue).security.compNeedsApproval ? await approve(projectId, actor, "Making an item complimentary") : "";
  await db.transaction(async (tx) => {
    await tx.update(schema.horecaOrderItems).set({ comp: input.comp, updatedAt: new Date() }).where(eq(schema.horecaOrderItems.id, itemId));
    if (input.comp) await logEvent({ projectId, kind: "comp", orderId: o.id, staffName: await actorName(projectId, actor), approvedBy, amount: it.qty * it.unitPrice, detail: `${it.qty} × ${it.name}${input.reason ? ` — ${input.reason}` : ""}` }, tx);
  });
  return orderView(projectId, o.id);
}

/** Move a whole KOT forward at once (kitchen display). */
export async function bumpKot(projectId: string, orderId: string, kotNo: number, status: string) {
  if (!FLOW.includes(status)) throw new ApiError("validation_failed", "Unknown status");
  await db
    .update(schema.horecaOrderItems)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.horecaOrderItems.projectId, projectId), eq(schema.horecaOrderItems.orderId, orderId), eq(schema.horecaOrderItems.kotNo, kotNo), ne(schema.horecaOrderItems.status, "void")));
}

export async function billOrder(projectId: string, orderId: string, raw: unknown) {
  const input = check(z.object({ discount: z.number().int().min(0).default(0), serviceChargeBps: z.number().int().min(0).max(2000).nullable().default(null), tip: z.number().int().min(0).default(0), discountReason: z.string().trim().max(200).default("") }), raw);
  const o = await ownOrder(projectId, orderId);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This order is already closed");
  // Discounts above the venue's limit need a manager.
  if (input.discount > o.discount) {
    const venue = await requireVenue(projectId);
    const view = await orderView(projectId, orderId);
    const limit = settingsOf(venue).security.discountLimitPct;
    const actor = actorOf(raw);
    const pct = view.totals.subtotal ? (input.discount / view.totals.subtotal) * 100 : 100;
    const approvedBy = pct > limit ? await approve(projectId, actor, `A discount over ${limit}%`) : "";
    await logEvent({ projectId, kind: "discount", orderId, staffName: await actorName(projectId, actor), approvedBy, amount: input.discount, detail: `${Math.round(pct * 10) / 10}%${input.discountReason ? ` — ${input.discountReason}` : ""}` });
  }
  await db
    .update(schema.horecaOrders)
    .set({ status: "billed", billedAt: new Date(), discount: input.discount, tip: input.tip, ...(input.serviceChargeBps === null ? {} : { serviceChargeBps: input.serviceChargeBps }) })
    .where(eq(schema.horecaOrders.id, orderId));
  await db.update(schema.horecaRequests).set({ status: "done", doneAt: new Date() }).where(and(eq(schema.horecaRequests.projectId, projectId), eq(schema.horecaRequests.kind, "bill"), eq(schema.horecaRequests.status, "open"), o.tableId ? eq(schema.horecaRequests.tableId, o.tableId) : sql`false`));
  return orderView(projectId, orderId);
}

/** The checked-in booking this order can be charged to (by its room's QR or an explicit booking). */
async function roomBookingFor(projectId: string, o: Order, bookingId?: string) {
  if (bookingId) {
    const [b] = await db.select().from(schema.horecaRoomBookings).where(and(eq(schema.horecaRoomBookings.id, bookingId), eq(schema.horecaRoomBookings.projectId, projectId), eq(schema.horecaRoomBookings.status, "checked_in")));
    return b ?? null;
  }
  if (!o.tableId) return null;
  const [b] = await db
    .select({ b: schema.horecaRoomBookings })
    .from(schema.horecaRooms)
    .innerJoin(schema.horecaRoomBookings, and(eq(schema.horecaRoomBookings.roomId, schema.horecaRooms.id), eq(schema.horecaRoomBookings.status, "checked_in")))
    .where(and(eq(schema.horecaRooms.projectId, projectId), eq(schema.horecaRooms.tableId, o.tableId)));
  return b?.b ?? null;
}

export async function payOrder(projectId: string, orderId: string, raw: unknown) {
  const input = check(paymentSchema.extend({ bookingId: z.uuid().optional() }), raw);
  const venue = await requireVenue(projectId);
  const settings = settingsOf(venue);
  const view = await orderView(projectId, orderId);
  const o = view.order;
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This order is already closed");
  if (input.amount > view.totals.due) throw new ApiError("validation_failed", "That's more than what's due");
  const shift = await openShift(projectId);
  if (input.method === "cash" && settings.pos.requireShift && !shift) throw new ApiError("conflict", "Open a till session before taking cash");
  const staff = await actorName(projectId, actorOf(raw));
  const pay = { method: input.method, amount: input.amount, ref: input.ref, at: new Date().toISOString(), ...(staff ? { staff } : {}), ...(shift ? { shiftId: shift.id } : {}) };
  return db.transaction(async (tx) => {
    if (input.method === "room") {
      const b = await roomBookingFor(projectId, o, input.bookingId);
      if (!b) throw new ApiError("validation_failed", "There's no checked-in guest to charge this to.");
      const charge = { id: crypto.randomUUID(), label: `Restaurant · order #${o.number}`, amount: input.amount, at: pay.at, orderId: o.id };
      await tx.update(schema.horecaRoomBookings).set({ charges: sql`${schema.horecaRoomBookings.charges} || ${JSON.stringify([charge])}::jsonb` }).where(eq(schema.horecaRoomBookings.id, b.id));
      await tx.update(schema.horecaOrders).set({ roomBookingId: b.id }).where(eq(schema.horecaOrders.id, o.id));
    }
    if (input.method === "points") await redeemPoints(tx, projectId, o.guestId, input.amount, settings.loyalty);
    const done = view.totals.due - input.amount <= 0;
    // The guest's visit and points count once, when the bill is settled (points paid don't earn points).
    const pointsPaid = (o.payments as { method: string; amount: number }[]).filter((p) => p.method === "points").reduce((a, p) => a + p.amount, 0) + (input.method === "points" ? input.amount : 0);
    const earned = done && o.guestId ? await creditVisit(tx, projectId, o.guestId, view.totals.total - pointsPaid, settings.loyalty) : 0;
    await tx
      .update(schema.horecaOrders)
      .set({ payments: sql`${schema.horecaOrders.payments} || ${JSON.stringify([pay])}::jsonb`, ...(done ? { status: "paid", closedAt: new Date(), billedAt: o.billedAt ?? new Date(), pointsEarned: earned } : {}) })
      .where(eq(schema.horecaOrders.id, o.id));
    if (done && o.tableId) await tx.update(schema.horecaReservations).set({ status: "completed" }).where(and(eq(schema.horecaReservations.orderId, o.id), eq(schema.horecaReservations.status, "seated")));
  }).then(() => orderView(projectId, orderId));
}

export async function cancelOrder(projectId: string, orderId: string, raw: unknown = {}) {
  const o = await ownOrder(projectId, orderId);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This order is already closed");
  if ((o.payments as unknown[]).length) throw new ApiError("conflict", "This order has payments — refund them first");
  const venue = await requireVenue(projectId);
  const live = await db.select().from(schema.horecaOrderItems).where(and(eq(schema.horecaOrderItems.orderId, orderId), ne(schema.horecaOrderItems.status, "void")));
  const fired = live.filter((i) => i.kotNo !== null && i.status !== "pending");
  const actor = actorOf(raw);
  const reason = String((raw as { reason?: unknown })?.reason ?? "").trim().slice(0, 200);
  const approvedBy = fired.length && settingsOf(venue).security.voidNeedsApproval ? await approve(projectId, actor, "Cancelling an order sent to the kitchen") : "";
  await db.transaction(async (tx) => {
    await pour(tx, fired, 1);
    await moveRecipe(tx, projectId, fired, 1);
    await tx.update(schema.horecaOrderItems).set({ status: "void", voidReason: reason }).where(eq(schema.horecaOrderItems.orderId, orderId));
    await tx.update(schema.horecaOrders).set({ status: "cancelled", closedAt: new Date(), cancelReason: reason }).where(eq(schema.horecaOrders.id, orderId));
    await logEvent({ projectId, kind: "void", orderId, staffName: await actorName(projectId, actor), approvedBy, amount: live.filter((i) => !i.comp).reduce((a, i) => a + i.qty * i.unitPrice, 0), detail: `Order #${o.number} cancelled${reason ? ` — ${reason}` : ""}` }, tx);
  });
}

// ─── Table moves ─────────────────────────────────────────────────────────────

/** Move a table's order to another (free) table. */
export async function transferOrder(projectId: string, orderId: string, raw: unknown) {
  const input = check(z.object({ tableId: z.uuid() }), raw);
  const o = await ownOrder(projectId, orderId);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This order is already closed");
  const [t] = await db.select({ id: schema.horecaTables.id, name: schema.horecaTables.name }).from(schema.horecaTables).where(and(eq(schema.horecaTables.id, input.tableId), eq(schema.horecaTables.projectId, projectId)));
  if (!t) throw notFound("Table");
  const [busy] = await db.select({ id: schema.horecaOrders.id }).from(schema.horecaOrders).where(and(eq(schema.horecaOrders.projectId, projectId), eq(schema.horecaOrders.tableId, t.id), inArray(schema.horecaOrders.status, OPEN), ne(schema.horecaOrders.id, orderId)));
  if (busy) throw new ApiError("conflict", `${t.name} already has an order — merge instead`);
  await db.transaction(async (tx) => {
    await tx.update(schema.horecaOrders).set({ tableId: t.id }).where(eq(schema.horecaOrders.id, orderId));
    await tx.update(schema.horecaRequests).set({ tableId: t.id }).where(and(eq(schema.horecaRequests.projectId, projectId), o.tableId ? eq(schema.horecaRequests.tableId, o.tableId) : sql`false`, eq(schema.horecaRequests.status, "open")));
    await logEvent({ projectId, kind: "transfer", orderId, staffName: await actorName(projectId, actorOf(raw)), detail: `Order #${o.number} moved to ${t.name}` }, tx);
  });
  return orderView(projectId, orderId);
}

/** Bring another open order's items, covers and payments onto this one. */
export async function mergeOrders(projectId: string, orderId: string, raw: unknown) {
  const input = check(z.object({ fromOrderId: z.uuid() }), raw);
  if (input.fromOrderId === orderId) throw new ApiError("validation_failed", "Choose a different order");
  const [into, from] = [await ownOrder(projectId, orderId), await ownOrder(projectId, input.fromOrderId)];
  if (!OPEN.includes(into.status) || !OPEN.includes(from.status)) throw new ApiError("conflict", "Both orders must be open");
  await db.transaction(async (tx) => {
    await tx.update(schema.horecaOrderItems).set({ orderId: into.id }).where(eq(schema.horecaOrderItems.orderId, from.id));
    await tx
      .update(schema.horecaOrders)
      .set({ covers: into.covers + from.covers, payments: sql`${schema.horecaOrders.payments} || ${JSON.stringify(from.payments)}::jsonb`, guestId: into.guestId ?? from.guestId, status: "open", billedAt: null })
      .where(eq(schema.horecaOrders.id, into.id));
    await tx.update(schema.horecaOrders).set({ status: "cancelled", closedAt: new Date(), cancelReason: `Merged into #${into.number}`, payments: [] }).where(eq(schema.horecaOrders.id, from.id));
    await logEvent({ projectId, kind: "merge", orderId: into.id, staffName: await actorName(projectId, actorOf(raw)), detail: `Order #${from.number} merged into #${into.number}` }, tx);
  });
  return orderView(projectId, orderId);
}

/** Split a check: chosen items move to a new order on the same table (or the counter). */
export async function splitOrder(projectId: string, orderId: string, raw: unknown) {
  const input = check(z.object({ itemIds: z.array(z.uuid()).min(1).max(100) }), raw);
  const o = await ownOrder(projectId, orderId);
  if (!OPEN.includes(o.status)) throw new ApiError("conflict", "This order is already closed");
  const items = await db.select().from(schema.horecaOrderItems).where(and(eq(schema.horecaOrderItems.orderId, orderId), inArray(schema.horecaOrderItems.id, input.itemIds), ne(schema.horecaOrderItems.status, "void")));
  if (items.length !== input.itemIds.length) throw new ApiError("validation_failed", "Some of those items aren't on this order");
  const remaining = await db.select({ n: sql<number>`count(*)::int` }).from(schema.horecaOrderItems).where(and(eq(schema.horecaOrderItems.orderId, orderId), ne(schema.horecaOrderItems.status, "void")));
  if ((remaining[0]?.n ?? 0) <= items.length) throw new ApiError("validation_failed", "Leave at least one item on the original check");
  const created = await db.transaction(async (tx) => {
    const number = await nextNumber(projectId, "nextOrderNo", tx);
    const [n] = await tx
      .insert(schema.horecaOrders)
      .values({ projectId, number, tableId: o.tableId, source: o.source, guestName: o.guestName, serviceChargeBps: o.serviceChargeBps, staffName: o.staffName, notes: `Split from #${o.number}` })
      .returning();
    await tx.update(schema.horecaOrderItems).set({ orderId: n.id }).where(inArray(schema.horecaOrderItems.id, input.itemIds));
    await logEvent({ projectId, kind: "split", orderId: o.id, staffName: await actorName(projectId, actorOf(raw)), detail: `${items.length} item(s) from #${o.number} to #${n.number}` }, tx);
    return n;
  });
  return { from: await orderView(projectId, orderId), to: await orderView(projectId, created.id) };
}

/** The open checks on a table (after a split there can be more than one). */
export async function tableChecks(projectId: string, tableId: string) {
  return db.select({ id: schema.horecaOrders.id, number: schema.horecaOrders.number, status: schema.horecaOrders.status }).from(schema.horecaOrders).where(and(eq(schema.horecaOrders.projectId, projectId), eq(schema.horecaOrders.tableId, tableId), inArray(schema.horecaOrders.status, OPEN))).orderBy(asc(schema.horecaOrders.createdAt));
}

// ─── Live views ──────────────────────────────────────────────────────────────

/** Every table with what's happening on it right now. */
export async function floorView(projectId: string) {
  const venue = await requireVenue(projectId);
  const [areas, tables, orders, requests] = await Promise.all([
    db.select().from(schema.horecaAreas).where(eq(schema.horecaAreas.projectId, projectId)).orderBy(asc(schema.horecaAreas.sort)),
    db.select().from(schema.horecaTables).where(and(eq(schema.horecaTables.projectId, projectId), eq(schema.horecaTables.active, true))).orderBy(asc(schema.horecaTables.sort), asc(schema.horecaTables.name)),
    db.select().from(schema.horecaOrders).where(and(eq(schema.horecaOrders.projectId, projectId), inArray(schema.horecaOrders.status, OPEN))),
    db.select().from(schema.horecaRequests).where(and(eq(schema.horecaRequests.projectId, projectId), eq(schema.horecaRequests.status, "open"))).orderBy(asc(schema.horecaRequests.createdAt)),
  ]);
  const items = orders.length ? await db.select().from(schema.horecaOrderItems).where(inArray(schema.horecaOrderItems.orderId, orders.map((o) => o.id))) : [];
  const upcoming = await upcomingByTable(projectId);
  const summary = (o: Order) => {
    const mine = items.filter((i) => i.orderId === o.id);
    const t = totalsOf(o, mine, venue);
    return { id: o.id, number: o.number, status: o.status, source: o.source, since: o.createdAt.toISOString(), covers: o.covers, guestName: o.guestName, deliveryAddress: o.deliveryAddress, total: t.total, due: t.due, items: mine.filter((i) => i.status !== "void").reduce((a, i) => a + i.qty, 0), pending: mine.filter((i) => i.status === "pending").length, ready: mine.filter((i) => i.status === "ready").length, cooking: mine.filter((i) => i.status === "new" || i.status === "preparing").length };
  };
  return {
    areas,
    tables: tables.map((t) => {
      const mine = orders.filter((x) => x.tableId === t.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const o = mine[0];
      const r = upcoming.find((x) => x.tableId === t.id);
      return { ...t, order: o ? summary(o) : null, checks: mine.length, reservation: r ? { id: r.id, guestName: r.guestName, partySize: r.partySize, at: r.at.toISOString() } : null, requests: requests.filter((r) => r.tableId === t.id).map((r) => ({ id: r.id, kind: r.kind, at: r.createdAt.toISOString() })) };
    }),
    counter: orders.filter((o) => !o.tableId).map(summary),
  };
}

/** The kitchen display: open tickets by station, oldest first. */
export async function kitchenView(projectId: string) {
  const rows = await db
    .select({ item: schema.horecaOrderItems, order: { id: schema.horecaOrders.id, number: schema.horecaOrders.number, source: schema.horecaOrders.source, notes: schema.horecaOrders.notes }, table: schema.horecaTables.name })
    .from(schema.horecaOrderItems)
    .innerJoin(schema.horecaOrders, eq(schema.horecaOrders.id, schema.horecaOrderItems.orderId))
    .leftJoin(schema.horecaTables, eq(schema.horecaTables.id, schema.horecaOrders.tableId))
    .where(and(eq(schema.horecaOrderItems.projectId, projectId), inArray(schema.horecaOrderItems.status, ["new", "preparing", "ready"]), inArray(schema.horecaOrders.status, OPEN)))
    .orderBy(asc(schema.horecaOrderItems.createdAt));
  const tickets = new Map<string, { key: string; orderId: string; orderNo: number; kotNo: number; station: string; table: string | null; source: string; at: string; items: { id: string; name: string; qty: number; modifiers: unknown; notes: string; status: string }[] }>();
  for (const r of rows) {
    const key = `${r.order.id}:${r.item.kotNo}`;
    const t = tickets.get(key) ?? { key, orderId: r.order.id, orderNo: r.order.number, kotNo: r.item.kotNo ?? 0, station: r.item.station, table: r.table, source: r.order.source, at: r.item.createdAt.toISOString(), items: [] };
    t.items.push({ id: r.item.id, name: r.item.name, qty: r.item.qty, modifiers: r.item.modifiers, notes: r.item.notes, status: r.item.status });
    tickets.set(key, t);
  }
  return { tickets: [...tickets.values()] };
}

export async function resolveRequest(projectId: string, id: string) {
  const rows = await db.update(schema.horecaRequests).set({ status: "done", doneAt: new Date() }).where(and(eq(schema.horecaRequests.id, id), eq(schema.horecaRequests.projectId, projectId))).returning({ id: schema.horecaRequests.id });
  if (!rows.length) throw notFound("Request");
}

/** Today at a glance (venue time): sales, covers, tickets and what sold. */
export async function today(projectId: string) {
  const venue = await requireVenue(projectId);
  const day = sql`(${schema.horecaOrders.closedAt} at time zone 'Asia/Kolkata')::date`;
  const paid = await db.select().from(schema.horecaOrders).where(and(eq(schema.horecaOrders.projectId, projectId), eq(schema.horecaOrders.status, "paid"), sql`${day} = ${istDay}`));
  const items = paid.length ? await db.select().from(schema.horecaOrderItems).where(inArray(schema.horecaOrderItems.orderId, paid.map((o) => o.id))) : [];
  let sales = 0;
  let covers = 0;
  let coveredSales = 0;
  const methods: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const o of paid) {
    const t = totalsOf(o, items.filter((i) => i.orderId === o.id), venue);
    sales += t.total;
    covers += o.covers;
    if (o.covers) coveredSales += t.total;
    sources[o.source] = (sources[o.source] ?? 0) + 1;
    for (const p of o.payments as { method: string; amount: number }[]) methods[p.method] = (methods[p.method] ?? 0) + p.amount;
  }
  const top = new Map<string, number>();
  for (const i of items) if (i.status !== "void") top.set(i.name, (top.get(i.name) ?? 0) + i.qty);
  void billTotals;
  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.horecaOrders).where(and(eq(schema.horecaOrders.projectId, projectId), inArray(schema.horecaOrders.status, OPEN)));
  return {
    sales,
    covers,
    perCover: covers ? Math.round(coveredSales / covers) : 0,
    orders: paid.length,
    average: paid.length ? Math.round(sales / paid.length) : 0,
    open: open?.n ?? 0,
    methods,
    sources,
    topItems: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, qty]) => ({ name, qty })),
  };
}

/** Recent closed orders for the history list. */
export async function recentOrders(projectId: string) {
  return db
    .select({ id: schema.horecaOrders.id, number: schema.horecaOrders.number, status: schema.horecaOrders.status, source: schema.horecaOrders.source, createdAt: schema.horecaOrders.createdAt, closedAt: schema.horecaOrders.closedAt, table: schema.horecaTables.name, payments: schema.horecaOrders.payments })
    .from(schema.horecaOrders)
    .leftJoin(schema.horecaTables, eq(schema.horecaTables.id, schema.horecaOrders.tableId))
    .where(and(eq(schema.horecaOrders.projectId, projectId), gte(schema.horecaOrders.createdAt, sql`now() - interval '7 days'`)))
    .orderBy(desc(schema.horecaOrders.createdAt))
    .limit(100);
}

// ─── Guests (QR menu) ────────────────────────────────────────────────────────

export async function tableByToken(token: string) {
  if (!/^[\w-]{8,32}$/.test(token)) return null;
  const [t] = await db.select().from(schema.horecaTables).where(and(eq(schema.horecaTables.token, token), eq(schema.horecaTables.active, true)));
  if (!t) return null;
  const [v] = await db.select().from(schema.horecaVenues).where(eq(schema.horecaVenues.projectId, t.projectId));
  const [p] = await db.select({ archived: schema.projects.archivedAt }).from(schema.projects).where(eq(schema.projects.id, t.projectId));
  if (!v || !p || p.archived) return null;
  return { table: t, venue: v };
}

/** A guest orders from the table's QR menu. */
export async function placeGuestOrder(token: string, raw: unknown) {
  const hit = await tableByToken(token);
  if (!hit) throw notFound("Table");
  const { table, venue } = hit;
  const s = settingsOf(venue);
  if (!s.qr.enabled || s.qr.mode !== "order") throw new ApiError("conflict", "Ordering from the table isn't on here — please ask your server.");
  const input = check(guestOrderSchema, raw);
  if (s.qr.askName && !input.name) throw new ApiError("validation_failed", "Add your name so we know who it's for.");
  if (s.qr.askPhone && input.phone.replace(/\D/g, "").length < 7) throw new ApiError("validation_failed", "Add your phone number.");
  const rows = await buildLines(venue.projectId, venue, input.lines, true);
  const subtotal = rows.reduce((a, r) => a + r.unitPrice * r.qty, 0);
  if (s.qr.minOrder && subtotal < s.qr.minOrder) throw new ApiError("validation_failed", "Your order is below the minimum for table orders.");
  const order = await db.transaction(async (tx) => {
    const o = await openFor(tx, venue, { tableId: table.id, source: "qr", guestName: input.name, guestPhone: input.phone, notes: input.notes });
    if (!o.guestName && input.name) await tx.update(schema.horecaOrders).set({ guestName: input.name, guestPhone: input.phone }).where(eq(schema.horecaOrders.id, o.id));
    const auto = s.qr.approval === "auto";
    const added = await tx.insert(schema.horecaOrderItems).values(rows.map((r) => ({ ...r, orderId: o.id, status: auto ? "new" : "pending", notes: [r.notes, input.notes].filter(Boolean).join(" · ").slice(0, 300) }))).returning();
    if (auto) await fire(tx, venue.projectId, added);
    return o;
  });
  return { orderNo: order.number, approval: s.qr.approval };
}

/** What a table sees about its running order. */
export async function guestStatus(token: string) {
  const hit = await tableByToken(token);
  if (!hit) return null;
  const { table, venue } = hit;
  const [o] = await db
    .select()
    .from(schema.horecaOrders)
    .where(and(eq(schema.horecaOrders.projectId, venue.projectId), eq(schema.horecaOrders.tableId, table.id), inArray(schema.horecaOrders.status, OPEN)))
    .orderBy(desc(schema.horecaOrders.createdAt))
    .limit(1);
  if (!o) {
    // Just paid: ask how it was (once, within an hour).
    const [last] = await db
      .select({ id: schema.horecaOrders.id, number: schema.horecaOrders.number })
      .from(schema.horecaOrders)
      .where(and(eq(schema.horecaOrders.projectId, venue.projectId), eq(schema.horecaOrders.tableId, table.id), eq(schema.horecaOrders.status, "paid"), gte(schema.horecaOrders.closedAt, sql`now() - interval '60 minutes'`)))
      .orderBy(desc(schema.horecaOrders.closedAt))
      .limit(1);
    const [rated] = last ? await db.select({ id: schema.horecaFeedback.id }).from(schema.horecaFeedback).where(eq(schema.horecaFeedback.orderId, last.id)) : [];
    return { order: null, feedback: last && !rated ? { number: last.number } : null };
  }
  const items = await db.select().from(schema.horecaOrderItems).where(and(eq(schema.horecaOrderItems.orderId, o.id), ne(schema.horecaOrderItems.status, "void"))).orderBy(asc(schema.horecaOrderItems.createdAt));
  return {
    order: { number: o.number, status: o.status, items: items.map((i) => ({ name: i.name, qty: i.qty, status: i.status, price: i.comp ? 0 : i.unitPrice * i.qty })), totals: totalsOf(o, items, venue) },
  };
}

export async function guestRequest(token: string, kind: string) {
  const hit = await tableByToken(token);
  if (!hit) throw notFound("Table");
  const s = settingsOf(hit.venue);
  if (!["waiter", "bill", "water"].includes(kind)) throw new ApiError("validation_failed", "Unknown request");
  if ((kind === "bill" && !s.qr.requestBill) || (kind !== "bill" && !s.qr.callWaiter)) throw new ApiError("conflict", "Please wave to your server.");
  // One open request of each kind per table is enough.
  const [dup] = await db.select({ id: schema.horecaRequests.id }).from(schema.horecaRequests).where(and(eq(schema.horecaRequests.tableId, hit.table.id), eq(schema.horecaRequests.kind, kind), eq(schema.horecaRequests.status, "open"), isNull(schema.horecaRequests.doneAt)));
  if (!dup) await db.insert(schema.horecaRequests).values({ projectId: hit.venue.projectId, tableId: hit.table.id, kind });
}

/** Feedback from the table's QR page, for the bill it just paid. */
export async function guestFeedback(token: string, rating: number, comment: string) {
  const hit = await tableByToken(token);
  if (!hit) throw notFound("Table");
  const [last] = await db
    .select({ id: schema.horecaOrders.id })
    .from(schema.horecaOrders)
    .where(and(eq(schema.horecaOrders.tableId, hit.table.id), eq(schema.horecaOrders.status, "paid"), gte(schema.horecaOrders.closedAt, sql`now() - interval '60 minutes'`)))
    .orderBy(desc(schema.horecaOrders.closedAt))
    .limit(1);
  if (!last) throw new ApiError("conflict", "There's no recent bill to rate");
  await leaveFeedback(hit.venue.projectId, last.id, rating, comment);
}
