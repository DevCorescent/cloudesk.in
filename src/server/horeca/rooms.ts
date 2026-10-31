// Cloudesk for Horeca: rooms — types, rooms, bookings, check-in/out, folios,
// housekeeping and the booking calendar.
import { and, asc, eq, gt, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { nights, paymentSchema, roomBookingSchema, roomSchema, roomTypeSchema } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { randomToken } from "../security/tokens";
import { check, requireVenue, settingsOf } from "./venue";

type Booking = typeof schema.horecaRoomBookings.$inferSelect;
const LIVE = ["reserved", "checked_in"];
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function roomsSetup(projectId: string) {
  const [types, rooms] = await Promise.all([
    db.select().from(schema.horecaRoomTypes).where(eq(schema.horecaRoomTypes.projectId, projectId)).orderBy(asc(schema.horecaRoomTypes.sort), asc(schema.horecaRoomTypes.name)),
    db.select().from(schema.horecaRooms).where(eq(schema.horecaRooms.projectId, projectId)).orderBy(asc(schema.horecaRooms.number)),
  ]);
  return { types, rooms };
}

export async function saveRoomType(projectId: string, raw: unknown, id?: string) {
  const input = check(roomTypeSchema, raw);
  const [r] = id
    ? await db.update(schema.horecaRoomTypes).set(input).where(and(eq(schema.horecaRoomTypes.id, id), eq(schema.horecaRoomTypes.projectId, projectId))).returning()
    : await db.insert(schema.horecaRoomTypes).values({ projectId, ...input }).returning();
  if (!r) throw notFound("Room type");
  return r;
}
export async function deleteRoomType(projectId: string, id: string) {
  const rows = await db.delete(schema.horecaRoomTypes).where(and(eq(schema.horecaRoomTypes.id, id), eq(schema.horecaRoomTypes.projectId, projectId))).returning({ id: schema.horecaRoomTypes.id });
  if (!rows.length) throw notFound("Room type");
}

/** A room, with its own in-room dining QR (a "room" table). */
export async function saveRoom(projectId: string, raw: unknown, id?: string) {
  const input = check(roomSchema, raw);
  const [t] = await db.select({ id: schema.horecaRoomTypes.id }).from(schema.horecaRoomTypes).where(and(eq(schema.horecaRoomTypes.id, input.typeId), eq(schema.horecaRoomTypes.projectId, projectId)));
  if (!t) throw notFound("Room type");
  const [dup] = await db.select({ id: schema.horecaRooms.id }).from(schema.horecaRooms).where(and(eq(schema.horecaRooms.projectId, projectId), eq(schema.horecaRooms.number, input.number), id ? ne(schema.horecaRooms.id, id) : sql`true`));
  if (dup) throw new ApiError("validation_failed", `Room ${input.number} already exists`, { number: ["Already used"] });
  if (id) {
    const [r] = await db.update(schema.horecaRooms).set(input).where(and(eq(schema.horecaRooms.id, id), eq(schema.horecaRooms.projectId, projectId))).returning();
    if (!r) throw notFound("Room");
    if (r.tableId) await db.update(schema.horecaTables).set({ name: `Room ${input.number}` }).where(eq(schema.horecaTables.id, r.tableId));
    return r;
  }
  const [qr] = await db.insert(schema.horecaTables).values({ projectId, name: `Room ${input.number}`, seats: 2, kind: "room", token: randomToken(9), sort: 1000 }).returning();
  const [r] = await db.insert(schema.horecaRooms).values({ projectId, ...input, tableId: qr.id }).returning();
  return r;
}
export async function deleteRoom(projectId: string, id: string) {
  const [r] = await db.delete(schema.horecaRooms).where(and(eq(schema.horecaRooms.id, id), eq(schema.horecaRooms.projectId, projectId))).returning();
  if (!r) throw notFound("Room");
  if (r.tableId) await db.delete(schema.horecaTables).where(eq(schema.horecaTables.id, r.tableId));
}

export async function setHousekeeping(projectId: string, roomId: string, state: string) {
  if (!["clean", "dirty", "inspect", "out_of_order"].includes(state)) throw new ApiError("validation_failed", "Unknown housekeeping state");
  const [r] = await db.update(schema.horecaRooms).set({ housekeeping: state }).where(and(eq(schema.horecaRooms.id, roomId), eq(schema.horecaRooms.projectId, projectId))).returning();
  if (!r) throw notFound("Room");
  return r;
}

async function ownRoom(projectId: string, roomId: string) {
  const [r] = await db.select({ room: schema.horecaRooms, type: schema.horecaRoomTypes }).from(schema.horecaRooms).innerJoin(schema.horecaRoomTypes, eq(schema.horecaRoomTypes.id, schema.horecaRooms.typeId)).where(and(eq(schema.horecaRooms.id, roomId), eq(schema.horecaRooms.projectId, projectId)));
  if (!r) throw notFound("Room");
  return r;
}

/** No two live bookings may share a room on the same night. */
async function assertFree(projectId: string, roomId: string, checkIn: string, checkOut: string, except?: string) {
  const [clash] = await db
    .select({ guest: schema.horecaRoomBookings.guestName, checkIn: schema.horecaRoomBookings.checkIn, checkOut: schema.horecaRoomBookings.checkOut })
    .from(schema.horecaRoomBookings)
    .where(and(eq(schema.horecaRoomBookings.projectId, projectId), eq(schema.horecaRoomBookings.roomId, roomId), inArray(schema.horecaRoomBookings.status, LIVE), lt(schema.horecaRoomBookings.checkIn, checkOut), gt(schema.horecaRoomBookings.checkOut, checkIn), except ? ne(schema.horecaRoomBookings.id, except) : sql`true`));
  if (clash) throw new ApiError("conflict", `That room is booked by ${clash.guest} from ${clash.checkIn} to ${clash.checkOut}.`);
}

export async function createBooking(projectId: string, raw: unknown) {
  const input = check(roomBookingSchema, raw);
  const { room, type } = await ownRoom(projectId, input.roomId);
  if (input.adults + input.children > type.maxGuests + 1) throw new ApiError("validation_failed", `${type.name} sleeps up to ${type.maxGuests} (plus one extra bed).`);
  if (room.housekeeping === "out_of_order") throw new ApiError("conflict", `Room ${room.number} is out of order.`);
  await assertFree(projectId, room.id, input.checkIn, input.checkOut);
  const [b] = await db
    .insert(schema.horecaRoomBookings)
    .values({ projectId, roomId: room.id, guestName: input.guestName, guestPhone: input.guestPhone, guestEmail: input.guestEmail, checkIn: input.checkIn, checkOut: input.checkOut, adults: input.adults, children: input.children, rate: input.rate ?? type.rate, source: input.source, notes: input.notes })
    .returning();
  return b;
}

async function ownBooking(projectId: string, id: string) {
  const [b] = await db.select().from(schema.horecaRoomBookings).where(and(eq(schema.horecaRoomBookings.id, id), eq(schema.horecaRoomBookings.projectId, projectId)));
  if (!b) throw notFound("Booking");
  return b;
}

/** The guest's bill: nights at the agreed rate, room GST, extras (restaurant, laundry…) and payments. */
export async function folio(projectId: string, b: Booking) {
  const venue = await requireVenue(projectId);
  const taxBps = settingsOf(venue).rooms.taxBps;
  const n = nights(b.checkIn, b.checkOut);
  const room = n * b.rate;
  const roomTax = Math.round((room * taxBps) / 10_000);
  const charges = b.charges as { id: string; label: string; amount: number; at: string; orderId?: string }[];
  const extras = charges.reduce((a, c) => a + c.amount, 0);
  const paid = (b.payments as { amount: number }[]).reduce((a, p) => a + p.amount, 0);
  const total = room + roomTax + extras;
  return { nights: n, rate: b.rate, room, roomTax, taxBps, charges, extras, payments: b.payments as { method: string; amount: number; at: string; ref: string }[], paid, total, due: Math.max(0, total - paid) };
}

export async function bookingView(projectId: string, id: string) {
  const b = await ownBooking(projectId, id);
  const { room, type } = await ownRoom(projectId, b.roomId);
  return { booking: b, room, type, folio: await folio(projectId, b) };
}

export async function updateBooking(projectId: string, id: string, raw: unknown) {
  const input = check(roomBookingSchema, raw);
  const b = await ownBooking(projectId, id);
  if (!LIVE.includes(b.status)) throw new ApiError("conflict", "This booking is closed");
  await ownRoom(projectId, input.roomId);
  await assertFree(projectId, input.roomId, input.checkIn, input.checkOut, id);
  await db.update(schema.horecaRoomBookings).set({ ...input, rate: input.rate ?? b.rate }).where(eq(schema.horecaRoomBookings.id, id));
  return bookingView(projectId, id);
}

/** reserved → checked_in → checked_out; or cancelled / no-show. */
export async function bookingAction(projectId: string, id: string, action: string, opts: { force?: boolean } = {}) {
  const b = await ownBooking(projectId, id);
  const { room } = await ownRoom(projectId, b.roomId);
  if (action === "check_in") {
    if (b.status !== "reserved") throw new ApiError("conflict", "Only reserved bookings can check in");
    if (b.checkIn > istToday()) throw new ApiError("conflict", `This booking starts on ${b.checkIn}.`);
    if (room.housekeeping !== "clean" && !opts.force) throw new ApiError("conflict", `Room ${room.number} isn't marked clean yet.`);
    await db.update(schema.horecaRoomBookings).set({ status: "checked_in", checkedInAt: new Date() }).where(eq(schema.horecaRoomBookings.id, id));
  } else if (action === "check_out") {
    if (b.status !== "checked_in") throw new ApiError("conflict", "Only checked-in guests can check out");
    const f = await folio(projectId, b);
    if (f.due > 0 && !opts.force) throw new ApiError("conflict", `There's still ${f.due} due on the folio. Settle it first.`, { due: [String(f.due)] });
    await db.update(schema.horecaRoomBookings).set({ status: "checked_out", checkedOutAt: new Date() }).where(eq(schema.horecaRoomBookings.id, id));
    // After a stay the room needs cleaning.
    await db.update(schema.horecaRooms).set({ housekeeping: "dirty" }).where(eq(schema.horecaRooms.id, room.id));
  } else if (action === "cancel" || action === "no_show") {
    if (b.status !== "reserved") throw new ApiError("conflict", "Only reserved bookings can be cancelled");
    await db.update(schema.horecaRoomBookings).set({ status: action === "cancel" ? "cancelled" : "no_show" }).where(eq(schema.horecaRoomBookings.id, id));
  } else throw new ApiError("validation_failed", "Unknown action");
  return bookingView(projectId, id);
}

export async function addFolioCharge(projectId: string, id: string, raw: unknown) {
  const input = check(z.object({ label: z.string().trim().min(1).max(80), amount: z.number().int().min(1) }), raw);
  const b = await ownBooking(projectId, id);
  if (b.status !== "checked_in" && b.status !== "reserved") throw new ApiError("conflict", "This booking is closed");
  const charge = { id: crypto.randomUUID(), label: input.label, amount: input.amount, at: new Date().toISOString() };
  await db.update(schema.horecaRoomBookings).set({ charges: sql`${schema.horecaRoomBookings.charges} || ${JSON.stringify([charge])}::jsonb` }).where(eq(schema.horecaRoomBookings.id, id));
  return bookingView(projectId, id);
}

export async function addFolioPayment(projectId: string, id: string, raw: unknown) {
  const input = check(paymentSchema, raw);
  if (input.method === "room") throw new ApiError("validation_failed", "Choose how the guest paid");
  const b = await ownBooking(projectId, id);
  const f = await folio(projectId, b);
  if (input.amount > f.due) throw new ApiError("validation_failed", "That's more than what's due");
  const pay = { method: input.method, amount: input.amount, ref: input.ref, at: new Date().toISOString() };
  await db.update(schema.horecaRoomBookings).set({ payments: sql`${schema.horecaRoomBookings.payments} || ${JSON.stringify([pay])}::jsonb` }).where(eq(schema.horecaRoomBookings.id, id));
  return bookingView(projectId, id);
}

/** The booking calendar: every room and its bookings across a date window. */
export async function calendar(projectId: string, from: string, days: number) {
  // By default the chart opens two days back, so guests leaving today still show.
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date(Date.parse(`${istToday()}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
  const span = Math.max(7, Math.min(42, days || 14));
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + span * 86_400_000).toISOString().slice(0, 10);
  const { types, rooms } = await roomsSetup(projectId);
  const bookings = await db
    .select()
    .from(schema.horecaRoomBookings)
    .where(and(eq(schema.horecaRoomBookings.projectId, projectId), notInArray(schema.horecaRoomBookings.status, ["cancelled", "no_show"]), lt(schema.horecaRoomBookings.checkIn, end), gt(schema.horecaRoomBookings.checkOut, start)))
    .orderBy(asc(schema.horecaRoomBookings.checkIn));
  const today = istToday();
  const live = await db.select().from(schema.horecaRoomBookings).where(and(eq(schema.horecaRoomBookings.projectId, projectId), inArray(schema.horecaRoomBookings.status, LIVE)));
  const inHouse = live.filter((b) => b.status === "checked_in");
  return {
    from: start,
    days: span,
    today,
    types,
    rooms,
    bookings,
    stats: {
      rooms: rooms.length,
      occupied: inHouse.length,
      arrivals: live.filter((b) => b.status === "reserved" && b.checkIn === today).length,
      departures: inHouse.filter((b) => b.checkOut === today).length,
      dirty: rooms.filter((r) => r.housekeeping === "dirty").length,
      outOfOrder: rooms.filter((r) => r.housekeeping === "out_of_order").length,
    },
  };
}

/** Rooms of a type that are free for the whole stay. */
export async function availableRooms(projectId: string, checkIn: string, checkOut: string) {
  const { rooms, types } = await roomsSetup(projectId);
  const busy = await db
    .select({ roomId: schema.horecaRoomBookings.roomId })
    .from(schema.horecaRoomBookings)
    .where(and(eq(schema.horecaRoomBookings.projectId, projectId), inArray(schema.horecaRoomBookings.status, LIVE), lt(schema.horecaRoomBookings.checkIn, checkOut), gt(schema.horecaRoomBookings.checkOut, checkIn)));
  const taken = new Set(busy.map((b) => b.roomId));
  return { rooms: rooms.filter((r) => !taken.has(r.id) && r.housekeeping !== "out_of_order"), types };
}
