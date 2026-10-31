// Cloudesk for Horeca: valet parking — tickets, the live board, guest
// pre-bookings and "bring my car" requests from the guest's phone.
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { valetBookingSchema, valetSchema } from "@/lib/horeca/model";
import { ApiError, notFound } from "../http/errors";
import { randomToken } from "../security/tokens";
import { appUrl } from "../services/mail";
import { check, nextNumber, requireVenue, settingsOf } from "./venue";

type Ticket = typeof schema.horecaValet.$inferSelect;
export const valetLink = (t: Pick<Ticket, "token">) => appUrl(`/v/${t.token}`);
const view = (t: Ticket) => ({ ...t, link: valetLink(t) });

/** Active tickets and pre-bookings, plus today's delivered cars. */
export async function valetBoard(projectId: string) {
  const venue = await requireVenue(projectId);
  const rows = await db
    .select()
    .from(schema.horecaValet)
    .where(and(eq(schema.horecaValet.projectId, projectId), or(inArray(schema.horecaValet.status, ["booked", "parked", "requested", "ready"]), gte(schema.horecaValet.deliveredAt, sql`now() - interval '12 hours'`))))
    .orderBy(asc(schema.horecaValet.ticket));
  const s = settingsOf(venue).valet;
  const parked = rows.filter((r) => ["parked", "requested", "ready"].includes(r.status)).length;
  return { tickets: rows.map(view), stats: { parked, requested: rows.filter((r) => r.status === "requested").length, booked: rows.filter((r) => r.status === "booked").length, slots: s.slots, free: Math.max(0, s.slots - parked) }, bookingLink: appUrl(`/v/book/${venue.token}`) };
}

/** A car arrives (status parked) — or staff note a pre-booking (status booked). */
export async function createTicket(projectId: string, raw: unknown) {
  const input = check(valetSchema, raw);
  await requireVenue(projectId);
  const booking = !!input.expectedAt;
  if (!booking && !input.plate) throw new ApiError("validation_failed", "Add the number plate", { plate: ["Required"] });
  const ticket = await nextNumber(projectId, "nextValetNo");
  const [t] = await db
    .insert(schema.horecaValet)
    .values({ projectId, ticket, token: randomToken(9), status: booking ? "booked" : "parked", plate: input.plate, car: input.car, color: input.color, guestName: input.guestName, guestPhone: input.guestPhone, slot: input.slot, keyTag: input.keyTag || String(ticket), notes: input.notes, tableId: input.tableId, roomBookingId: input.roomBookingId, expectedAt: input.expectedAt ? new Date(input.expectedAt) : null, parkedAt: booking ? null : new Date() })
    .returning();
  return view(t);
}

const NEXT: Record<string, string[]> = { booked: ["parked", "cancelled"], parked: ["requested", "ready", "delivered"], requested: ["ready", "delivered"], ready: ["delivered", "parked"], delivered: [], cancelled: [] };

export async function moveTicket(projectId: string, id: string, status: string, raw: unknown = {}) {
  const [t] = await db.select().from(schema.horecaValet).where(and(eq(schema.horecaValet.id, id), eq(schema.horecaValet.projectId, projectId)));
  if (!t) throw notFound("Ticket");
  if (!NEXT[t.status]?.includes(status)) throw new ApiError("conflict", `A ${t.status} car can't go to ${status}.`);
  const extra = status === "parked" && t.status === "booked" ? check(valetSchema.pick({ plate: true, slot: true, car: true, color: true }), raw) : null;
  if (extra && !extra.plate && !t.plate) throw new ApiError("validation_failed", "Add the number plate", { plate: ["Required"] });
  const stamp = { parked: { parkedAt: new Date() }, requested: { requestedAt: new Date() }, ready: { readyAt: new Date() }, delivered: { deliveredAt: new Date() }, cancelled: {} }[status as "parked"];
  const [r] = await db
    .update(schema.horecaValet)
    .set({ status, ...stamp, ...(extra ? { plate: extra.plate || t.plate, slot: extra.slot || t.slot, car: extra.car || t.car, color: extra.color || t.color } : {}) })
    .where(eq(schema.horecaValet.id, id))
    .returning();
  return view(r);
}

export async function updateTicket(projectId: string, id: string, raw: unknown) {
  const input = check(valetSchema, raw);
  const [r] = await db
    .update(schema.horecaValet)
    .set({ plate: input.plate, car: input.car, color: input.color, guestName: input.guestName, guestPhone: input.guestPhone, slot: input.slot, keyTag: input.keyTag, notes: input.notes, expectedAt: input.expectedAt ? new Date(input.expectedAt) : null })
    .where(and(eq(schema.horecaValet.id, id), eq(schema.horecaValet.projectId, projectId)))
    .returning();
  if (!r) throw notFound("Ticket");
  return view(r);
}

// ─── Guests ──────────────────────────────────────────────────────────────────

export async function ticketByToken(token: string) {
  if (!/^[\w-]{8,32}$/.test(token)) return null;
  const [t] = await db.select().from(schema.horecaValet).where(eq(schema.horecaValet.token, token));
  if (!t) return null;
  const [v] = await db.select().from(schema.horecaVenues).where(eq(schema.horecaVenues.projectId, t.projectId));
  return v ? { ticket: t, venue: v } : null;
}

/** "Bring my car": only for a parked car, once. */
export async function guestRequestCar(token: string) {
  const hit = await ticketByToken(token);
  if (!hit) throw notFound("Ticket");
  if (hit.ticket.status === "requested" || hit.ticket.status === "ready") return hit.ticket;
  if (hit.ticket.status !== "parked") throw new ApiError("conflict", "Your car isn't parked with us right now.");
  const [r] = await db.update(schema.horecaValet).set({ status: "requested", requestedAt: new Date() }).where(eq(schema.horecaValet.id, hit.ticket.id)).returning();
  return r;
}

export async function venueByToken(token: string) {
  if (!/^[\w-]{8,32}$/.test(token)) return null;
  const [v] = await db.select().from(schema.horecaVenues).where(eq(schema.horecaVenues.token, token));
  return v ?? null;
}

/** A guest books valet ahead of their visit. */
export async function guestBookValet(venueToken: string, raw: unknown) {
  const venue = await venueByToken(venueToken);
  if (!venue) throw notFound("Venue");
  const s = settingsOf(venue);
  if (!s.valet.enabled || !s.qr.valetBooking) throw new ApiError("conflict", "Valet booking isn't available here.");
  const input = check(valetBookingSchema, raw);
  const at = Date.parse(input.expectedAt);
  if (at < Date.now() - 15 * 60_000 || at > Date.now() + 30 * 86_400_000) throw new ApiError("validation_failed", "Choose a time within the next 30 days.");
  const ticket = await nextNumber(venue.projectId, "nextValetNo");
  const [t] = await db.insert(schema.horecaValet).values({ projectId: venue.projectId, ticket, token: randomToken(9), status: "booked", plate: input.plate, car: input.car, guestName: input.guestName, guestPhone: input.guestPhone, keyTag: String(ticket), expectedAt: new Date(at) }).returning();
  return t;
}
