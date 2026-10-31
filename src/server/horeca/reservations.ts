// Cloudesk for Horeca: table reservations and the walk-in waitlist. A table
// can't be double-booked for overlapping times; seating a party opens its
// order on the table. Guests can request a table from a public page.
import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { reservationSchema } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { check, nextNumber, requireVenue, settingsOf } from "./venue";
import { venueByToken } from "./valet";

type Resv = typeof schema.horecaReservations.$inferSelect;
const LIVE = ["booked", "confirmed", "seated"];

/** Reservations and the waitlist for one day (venue time), plus what's coming up. */
export async function reservationsFor(projectId: string, day?: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const from = new Date(`${d}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 86_400_000);
  const rows = await db
    .select({ r: schema.horecaReservations, table: schema.horecaTables.name })
    .from(schema.horecaReservations)
    .leftJoin(schema.horecaTables, eq(schema.horecaTables.id, schema.horecaReservations.tableId))
    .where(and(eq(schema.horecaReservations.projectId, projectId), gte(schema.horecaReservations.at, from), lt(schema.horecaReservations.at, to)))
    .orderBy(asc(schema.horecaReservations.at));
  const list = rows.map((x) => ({ ...x.r, table: x.table }));
  const live = list.filter((r) => LIVE.includes(r.status));
  return {
    day: d,
    reservations: list.filter((r) => r.kind === "reservation"),
    waitlist: list.filter((r) => r.kind === "waitlist" && ["booked", "confirmed"].includes(r.status)),
    stats: { bookings: live.filter((r) => r.kind === "reservation").length, covers: live.reduce((a, r) => a + r.partySize, 0), waiting: list.filter((r) => r.kind === "waitlist" && ["booked", "confirmed"].includes(r.status)).length, seated: list.filter((r) => r.status === "seated").length },
  };
}

async function assertTableFree(projectId: string, tableId: string, at: Date, durationMin: number, except?: string) {
  const end = new Date(at.getTime() + durationMin * 60_000);
  const [clash] = await db
    .select({ guest: schema.horecaReservations.guestName, at: schema.horecaReservations.at })
    .from(schema.horecaReservations)
    .where(and(
      eq(schema.horecaReservations.projectId, projectId),
      eq(schema.horecaReservations.tableId, tableId),
      inArray(schema.horecaReservations.status, ["booked", "confirmed", "seated"]),
      lt(schema.horecaReservations.at, end),
      sql`${schema.horecaReservations.at} + make_interval(mins => ${schema.horecaReservations.durationMin}) > ${at}`,
      except ? ne(schema.horecaReservations.id, except) : sql`true`,
    ));
  if (clash) throw new ApiError("conflict", `That table is reserved for ${clash.guest} at ${clash.at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}.`);
}

export async function saveReservation(projectId: string, raw: unknown, id?: string) {
  const input = check(reservationSchema, raw);
  await requireVenue(projectId);
  const at = new Date(input.at);
  if (input.tableId) {
    const [t] = await db.select({ id: schema.horecaTables.id }).from(schema.horecaTables).where(and(eq(schema.horecaTables.id, input.tableId), eq(schema.horecaTables.projectId, projectId)));
    if (!t) throw notFound("Table");
    if (input.kind === "reservation") await assertTableFree(projectId, input.tableId, at, input.durationMin, id);
  }
  const values = { ...input, at };
  const [r] = id
    ? await db.update(schema.horecaReservations).set(values).where(and(eq(schema.horecaReservations.id, id), eq(schema.horecaReservations.projectId, projectId))).returning()
    : await db.insert(schema.horecaReservations).values({ projectId, ...values }).returning();
  if (!r) throw notFound("Reservation");
  return r;
}

const NEXT: Record<string, string[]> = { booked: ["confirmed", "seated", "cancelled", "no_show"], confirmed: ["seated", "cancelled", "no_show"], seated: ["completed"], completed: [], cancelled: ["booked"], no_show: ["booked"] };

/** Move a reservation along. Seating needs a table and opens its order. */
export async function setReservationStatus(projectId: string, id: string, status: string, tableId?: string | null) {
  const [r] = await db.select().from(schema.horecaReservations).where(and(eq(schema.horecaReservations.id, id), eq(schema.horecaReservations.projectId, projectId)));
  if (!r) throw notFound("Reservation");
  if (!NEXT[r.status]?.includes(status)) throw new ApiError("conflict", `A ${r.status.replace("_", "-")} reservation can't become ${status.replace("_", "-")}.`);
  if (status !== "seated") {
    const [u] = await db.update(schema.horecaReservations).set({ status }).where(eq(schema.horecaReservations.id, id)).returning();
    return u;
  }
  const table = tableId ?? r.tableId;
  if (!table) throw new ApiError("validation_failed", "Choose a table to seat them at");
  const venue = await requireVenue(projectId);
  return db.transaction(async (tx) => {
    const [t] = await tx.select({ id: schema.horecaTables.id }).from(schema.horecaTables).where(and(eq(schema.horecaTables.id, table), eq(schema.horecaTables.projectId, projectId)));
    if (!t) throw notFound("Table");
    const [busy] = await tx.select({ id: schema.horecaOrders.id }).from(schema.horecaOrders).where(and(eq(schema.horecaOrders.projectId, projectId), eq(schema.horecaOrders.tableId, table), inArray(schema.horecaOrders.status, ["open", "billed"])));
    if (busy) throw new ApiError("conflict", "That table still has an open order");
    const number = await nextNumber(projectId, "nextOrderNo", tx);
    const [o] = await tx
      .insert(schema.horecaOrders)
      .values({ projectId, number, tableId: table, source: "staff", guestName: r.guestName, guestPhone: r.guestPhone, covers: r.partySize, notes: r.notes, serviceChargeBps: venue.serviceChargeBps })
      .returning();
    const [u] = await tx.update(schema.horecaReservations).set({ status: "seated", tableId: table, orderId: o.id }).where(eq(schema.horecaReservations.id, id)).returning();
    return u;
  });
}

/** Reservations starting soon, per table — the floor shows them. */
export async function upcomingByTable(projectId: string, withinMin = 90) {
  const rows: Resv[] = await db
    .select()
    .from(schema.horecaReservations)
    .where(and(eq(schema.horecaReservations.projectId, projectId), inArray(schema.horecaReservations.status, ["booked", "confirmed"]), gte(schema.horecaReservations.at, sql`now() - interval '30 minutes'`), lt(schema.horecaReservations.at, sql`now() + make_interval(mins => ${withinMin})`)))
    .orderBy(asc(schema.horecaReservations.at));
  return rows.filter((r) => r.tableId);
}

// ─── Online requests ─────────────────────────────────────────────────────────

/** A guest asks for a table from the public page; it arrives as "booked" for staff to confirm. */
export async function guestReserve(venueToken: string, raw: unknown) {
  const venue = await venueByToken(venueToken);
  if (!venue) throw notFound("Venue");
  const s = settingsOf(venue);
  if (!s.sections.reservations || !s.reservations.online) throw new ApiError("conflict", "Online reservations aren't open here.");
  const input = check(reservationSchema.pick({ guestName: true, guestPhone: true, partySize: true, at: true, notes: true }), raw);
  if (input.guestPhone.replace(/\D/g, "").length < 7) throw new ApiError("validation_failed", "Add your phone number so we can confirm.");
  if (input.partySize > s.reservations.maxParty) throw new ApiError("validation_failed", `For more than ${s.reservations.maxParty} people, please call us.`);
  const at = new Date(input.at);
  if (at.getTime() < Date.now() - 5 * 60_000 || at.getTime() > Date.now() + 60 * 86_400_000) throw new ApiError("validation_failed", "Choose a time within the next 60 days.");
  const hhmm = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata", hour12: false });
  const { openFrom, openTo } = s.reservations;
  if (openFrom && openTo && (openFrom <= openTo ? hhmm < openFrom || hhmm > openTo : hhmm < openFrom && hhmm > openTo)) throw new ApiError("validation_failed", `We take reservations from ${openFrom} to ${openTo}.`);
  const [r] = await db.insert(schema.horecaReservations).values({ projectId: venue.projectId, kind: "reservation", source: "online", ...input, at, durationMin: s.reservations.durationMin }).returning();
  return { reservation: r, venue };
}
