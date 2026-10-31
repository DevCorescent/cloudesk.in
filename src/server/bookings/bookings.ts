import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_HOURS, googleCalendarLink, localDate, localTime, slotsForDay, type WeeklyHours } from "@/lib/bookings/slots";
import { formatMoney } from "@/lib/store/money";
import { ApiError, notFound } from "../http/errors";
import { emitEvent } from "../events/bus";
import { log } from "../log";
import { decryptSecret } from "../security/secrets";
import { randomToken, sha256 } from "../security/tokens";
import { appUrl, sendMail } from "../services/mail";
import { paypal, providerInfo, razorpay, stripe, type Creds, type PayOrder, type ProviderId } from "../commerce/payments";

export const HOLD_MINUTES = 30;
type Booking = typeof schema.bookings.$inferSelect;

// ─── Settings & services ─────────────────────────────────────────────────────

export async function getBookingSettings(projectId: string) {
  const [s] = await db.select().from(schema.bookingSettings).where(eq(schema.bookingSettings.projectId, projectId));
  return s ?? { projectId, timezone: "Asia/Kolkata", hours: DEFAULT_HOURS, slotStepMin: 30, minNoticeHours: 2, maxDaysAhead: 30, closedDates: [] as string[], cancelHours: 24, updatedAt: new Date() };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const bookingSettingsSchema = z.object({
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
  hours: z.partialRecord(z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]), z.array(z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, "Closing time must be after opening time")).max(4)),
  slotStepMin: z.number().int().min(5).max(240),
  minNoticeHours: z.number().int().min(0).max(720),
  maxDaysAhead: z.number().int().min(1).max(365),
  closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
  cancelHours: z.number().int().min(0).max(720),
});

export async function saveBookingSettings(projectId: string, input: z.infer<typeof bookingSettingsSchema>) {
  await db
    .insert(schema.bookingSettings)
    .values({ projectId, ...input })
    .onConflictDoUpdate({ target: schema.bookingSettings.projectId, set: { ...input, updatedAt: new Date() } });
  return getBookingSettings(projectId);
}

export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(""),
  durationMin: z.number().int().min(5).max(24 * 60),
  price: z.number().int().min(0).max(100_000_000),
  payment: z.enum(["none", "full"]),
  capacity: z.number().int().min(1).max(500),
  bufferMin: z.number().int().min(0).max(240),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});

export async function listServices(projectId: string, activeOnly = false) {
  return db
    .select()
    .from(schema.bookingServices)
    .where(and(eq(schema.bookingServices.projectId, projectId), activeOnly ? eq(schema.bookingServices.active, true) : undefined))
    .orderBy(asc(schema.bookingServices.sort), asc(schema.bookingServices.name));
}

export async function saveService(projectId: string, input: z.infer<typeof serviceSchema>, id?: string) {
  if (input.payment === "full" && input.price <= 0) throw new ApiError("validation_failed", "Set a price to take payment online", { price: ["Required"] });
  if (id) {
    const r = await db.update(schema.bookingServices).set(input).where(and(eq(schema.bookingServices.id, id), eq(schema.bookingServices.projectId, projectId))).returning();
    if (!r.length) throw notFound("Service");
    return r[0];
  }
  const [s] = await db.insert(schema.bookingServices).values({ projectId, ...input }).returning();
  return s;
}

export async function deleteService(projectId: string, id: string) {
  // Past bookings keep the service name; the service just stops being bookable.
  const r = await db.delete(schema.bookingServices).where(and(eq(schema.bookingServices.id, id), eq(schema.bookingServices.projectId, projectId))).returning({ id: schema.bookingServices.id });
  if (!r.length) throw notFound("Service");
}

async function service(projectId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [s] = await db.select().from(schema.bookingServices).where(and(eq(schema.bookingServices.id, id), eq(schema.bookingServices.projectId, projectId)));
  return s ?? null;
}

// ─── Availability ────────────────────────────────────────────────────────────

/** Bookings that use capacity: confirmed or completed, or still inside the payment hold. */
const holding = (now: Date) => and(isNull(schema.bookings.cancelledAt), or(inArray(schema.bookings.status, ["confirmed", "completed"]), and(eq(schema.bookings.status, "pending_payment"), gt(schema.bookings.holdUntil, now))));

async function busyBetween(exec: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], projectId: string, serviceId: string, from: Date, to: Date, now: Date) {
  return exec
    .select({ start: schema.bookings.startsAt, end: schema.bookings.endsAt })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.projectId, projectId), eq(schema.bookings.serviceId, serviceId), lt(schema.bookings.startsAt, to), gt(schema.bookings.endsAt, from), holding(now)));
}

export async function availability(projectId: string, serviceId: string, date: string, now = new Date()) {
  const svc = await service(projectId, serviceId);
  if (!svc || !svc.active) return null;
  const st = await getBookingSettings(projectId);
  const dayStart = new Date(`${date}T00:00:00Z`).getTime() - 36 * 3600_000;
  const busy = await busyBetween(db, projectId, svc.id, new Date(dayStart), new Date(dayStart + 96 * 3600_000), now);
  return { service: svc, settings: st, slots: slotsForDay({ date, tz: st.timezone, hours: st.hours as WeeklyHours, stepMin: st.slotStepMin, durationMin: svc.durationMin, bufferMin: svc.bufferMin, capacity: svc.capacity, minNoticeHours: st.minNoticeHours, maxDaysAhead: st.maxDaysAhead, closedDates: st.closedDates, now, busy }) };
}

// ─── Booking ─────────────────────────────────────────────────────────────────

export const bookSchema = z.object({
  serviceId: z.uuid(),
  start: z.string().datetime(),
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().email("Enter a valid email").max(200),
  phone: z.string().trim().max(30).default(""),
  notes: z.string().trim().max(1000).default(""),
  payment: z.string().max(20).default("none"),
});

/** Online payment providers that are connected and switched on. */
export async function onlineProviders(projectId: string) {
  const rows = await db.select().from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.enabled, true), eq(schema.storePaymentProviders.status, "connected")));
  return rows.filter((r) => ["stripe", "razorpay", "paypal"].includes(r.provider)).map((r) => ({ id: r.provider as ProviderId, name: providerInfo(r.provider)?.name ?? r.provider, creds: r.secrets ? (JSON.parse(decryptSecret(r.secrets)) as Creds) : null, mode: r.mode }));
}

/**
 * Creates a booking if the slot is still free. A per-service advisory lock
 * serialises concurrent bookings, so capacity can never be exceeded.
 */
export async function createBooking(projectId: string, input: z.infer<typeof bookSchema>, now = new Date()) {
  const svc = await service(projectId, input.serviceId);
  if (!svc || !svc.active) throw new ApiError("conflict", "This service is no longer available");
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (!store) throw new ApiError("conflict", "Bookings are not set up");
  const online = svc.payment === "full" && svc.price > 0;
  if (online && !(await onlineProviders(projectId)).some((p) => p.id === input.payment)) throw new ApiError("conflict", "Choose a payment method");
  const start = new Date(input.start);
  const st = await getBookingSettings(projectId);
  const key = randomToken(18);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`booking:${svc.id}`}))`);
    const busy = await busyBetween(tx, projectId, svc.id, new Date(start.getTime() - 36 * 3600_000), new Date(start.getTime() + 36 * 3600_000), now);
    const slots = slotsForDay({ date: localDate(start, st.timezone), tz: st.timezone, hours: st.hours as WeeklyHours, stepMin: st.slotStepMin, durationMin: svc.durationMin, bufferMin: svc.bufferMin, capacity: svc.capacity, minNoticeHours: st.minNoticeHours, maxDaysAhead: st.maxDaysAhead, closedDates: st.closedDates, now, busy });
    const slot = slots.find((s) => s.start.getTime() === start.getTime());
    if (!slot) throw new ApiError("conflict", "Sorry, that time was just taken. Please choose another.");
    const [b] = await tx
      .insert(schema.bookings)
      .values({
        projectId,
        serviceId: svc.id,
        serviceName: svc.name,
        startsAt: slot.start,
        endsAt: slot.end,
        name: input.name,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        status: online ? "pending_payment" : "confirmed",
        amount: svc.price,
        currency: store.currency,
        paymentMethod: online ? input.payment : "none",
        accessKeyHash: sha256(key),
        holdUntil: online ? new Date(now.getTime() + HOLD_MINUTES * 60_000) : null,
      })
      .returning();
    return { booking: b, key, store, online };
  }).then(async (r) => {
    if (!r.online) await emitEvent(projectId, "booking.confirmed", bookingEventPayload(r.booking));
    return r;
  });
}

/** What automations see about a booking. */
function bookingEventPayload(b: Booking) {
  return { id: b.id, service: b.serviceName, name: b.name, email: b.email, phone: b.phone, startsAt: b.startsAt.toISOString(), partySize: 1, amount: (b.amount / 100).toFixed(2), currency: b.currency, notes: b.notes };
}

function payOrderFor(b: Booking, storeName: string, tz: string): PayOrder {
  return { id: b.id, number: 0, label: `${storeName}: ${b.serviceName} on ${localDate(b.startsAt, tz)} ${localTime(b.startsAt, tz)}`, total: b.amount, currency: b.currency, email: b.email, phone: b.phone, name: b.name };
}

export async function startBookingPayment(b: Booking, key: string, publicBase: string) {
  const p = (await onlineProviders(b.projectId)).find((x) => x.id === b.paymentMethod);
  if (!p?.creds) throw new ApiError("provider_not_configured", "This payment method is not available right now.");
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, b.projectId));
  const st = await getBookingSettings(b.projectId);
  const qs = `booking=${b.id}&key=${encodeURIComponent(key)}&base=${encodeURIComponent(publicBase)}`;
  const urls = {
    success: appUrl(`/api/v1/store/${b.projectId}/book-pay/${p.id}/return?${qs}`) + (p.id === "stripe" ? "&session_id={CHECKOUT_SESSION_ID}" : ""),
    cancel: appUrl(`/api/v1/store/${b.projectId}/book-pay/${p.id}/cancel?${qs}`),
  };
  const po = payOrderFor(b, store.name, st.timezone);
  const r = p.id === "stripe" ? await stripe.create(p.creds, po, urls) : p.id === "razorpay" ? await razorpay.create(p.creds, po, urls) : await paypal.create(p.creds, po, urls, p.mode, store.name);
  await db.update(schema.bookings).set({ paymentRef: r.ref }).where(eq(schema.bookings.id, b.id));
  return r.redirectUrl;
}

/** Marks a booking paid and confirmed exactly once. */
export async function markBookingPaid(id: string, captureRef?: string | null) {
  const [b] = await db
    .update(schema.bookings)
    .set({ paid: true, status: "confirmed", holdUntil: null, ...(captureRef ? { paymentCaptureRef: captureRef } : {}) })
    .where(and(eq(schema.bookings.id, id), eq(schema.bookings.status, "pending_payment"), isNull(schema.bookings.cancelledAt)))
    .returning();
  if (b) await notifyBooked(b).catch((e) => log.warn("booking_mail_failed", { error: (e as Error).message }));
  if (b) await emitEvent(b.projectId, "booking.confirmed", bookingEventPayload(b));
  return !!b;
}

/** Return from hosted checkout: the redirect proves nothing; ask the provider. */
export async function verifyBookingReturn(b: Booking, params: URLSearchParams) {
  if (b.paid) return true;
  const p = (await onlineProviders(b.projectId)).find((x) => x.id === b.paymentMethod);
  if (!p?.creds || !b.paymentRef) return false;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, b.projectId));
  const po = payOrderFor(b, store.name, (await getBookingSettings(b.projectId)).timezone);
  const ref = p.id === "stripe" ? (params.get("session_id") === b.paymentRef ? b.paymentRef : "") : p.id === "paypal" ? (params.get("token") === b.paymentRef ? b.paymentRef : "") : b.paymentRef;
  if (!ref) return false;
  const r = p.id === "stripe" ? await stripe.verify(p.creds, ref, po) : p.id === "razorpay" ? await razorpay.verify(p.creds, ref, po, params) : await paypal.verify(p.creds, ref, po, params, p.mode);
  if (r.paid) await markBookingPaid(b.id, r.captureRef);
  return r.paid;
}

export async function bookingByKey(projectId: string, id: string, key: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.id, id), eq(schema.bookings.projectId, projectId), eq(schema.bookings.accessKeyHash, sha256(key))));
  return b ?? null;
}

export async function cancelBooking(projectId: string, id: string, by: { key?: string; staff?: boolean }, reason: string, now = new Date()) {
  const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.id, id), eq(schema.bookings.projectId, projectId)));
  if (!b || (!by.staff && b.accessKeyHash !== sha256(by.key ?? ""))) throw notFound("Booking");
  if (b.cancelledAt) throw new ApiError("conflict", "This booking is already cancelled");
  if (b.startsAt <= now) throw new ApiError("conflict", "This booking has already started");
  const st = await getBookingSettings(projectId);
  if (!by.staff && b.startsAt.getTime() - now.getTime() < st.cancelHours * 3600_000) throw new ApiError("conflict", `Bookings can be cancelled online up to ${st.cancelHours} hours before. Please contact us.`);
  await db.update(schema.bookings).set({ status: "cancelled", cancelledAt: now, cancelReason: reason, holdUntil: null }).where(eq(schema.bookings.id, b.id));
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const when = `${localDate(b.startsAt, st.timezone)} at ${localTime(b.startsAt, st.timezone)}`;
  await sendMail({ fromName: store.name, replyTo: store.email || undefined, to: b.email, subject: `${store.name}: booking cancelled`, body: `Your ${b.serviceName} booking on ${when} has been cancelled.${b.paid ? "\n\nYou paid online; the store will arrange your refund." : ""}\n\n${store.name}` }).catch(() => {});
  if (!by.staff) for (const to of new Set([store.email, ...store.notifyEmails].filter(Boolean))) await sendMail({ to, subject: `Booking cancelled: ${b.serviceName} on ${when}`, body: `${b.name} (${b.email}) cancelled their booking.${b.paid ? `\n\nThey paid ${formatMoney(b.amount, b.currency)} online — refund it from your payment provider if your policy allows.` : ""}` }).catch(() => {});
  await emitEvent(projectId, "booking.cancelled", { ...bookingEventPayload(b), reason, byStaff: !!by.staff });
}

export async function setBookingStatus(projectId: string, id: string, status: "completed" | "no_show" | "paid_at_visit") {
  const [b] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.id, id), eq(schema.bookings.projectId, projectId)));
  if (!b || b.cancelledAt) throw new ApiError("conflict", "This booking cannot be changed");
  if (status === "paid_at_visit") await db.update(schema.bookings).set({ paid: true }).where(eq(schema.bookings.id, b.id));
  else await db.update(schema.bookings).set({ status }).where(eq(schema.bookings.id, b.id));
}

export async function listBookings(projectId: string, from: Date, to: Date) {
  return db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.projectId, projectId), gte(schema.bookings.startsAt, from), lt(schema.bookings.startsAt, to)))
    .orderBy(asc(schema.bookings.startsAt))
    .limit(1000);
}

// ─── Notifications ───────────────────────────────────────────────────────────

export async function notifyBooked(b: Booking, link?: string) {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, b.projectId));
  const st = await getBookingSettings(b.projectId);
  const when = `${new Intl.DateTimeFormat("en-IN", { timeZone: st.timezone, dateStyle: "full", timeStyle: "short" }).format(b.startsAt)}`;
  const cal = googleCalendarLink(`${b.serviceName} — ${store.name}`, b.startsAt, b.endsAt, `Booked with ${store.name}`);
  await sendMail({
    fromName: store.name,
    replyTo: store.email || undefined,
    to: b.email,
    subject: `${store.name}: ${b.serviceName} booked for ${when}`,
    body: `Hi ${b.name.split(" ")[0]}, you're booked.\n\n${b.serviceName}\n${when} (${st.timezone})${b.amount ? `\n${b.paid ? "Paid" : "To pay at your visit"}: ${formatMoney(b.amount, b.currency)}` : ""}\n\nAdd to Google Calendar: ${cal}${link ? `\nView or cancel your booking: ${link}` : ""}\n\n${store.name}`,
  });
  for (const to of new Set([store.email, ...store.notifyEmails].filter(Boolean))) await sendMail({ to, subject: `New booking: ${b.serviceName}, ${when}`, body: `${b.name} (${b.email}${b.phone ? `, ${b.phone}` : ""}) booked ${b.serviceName} for ${when}.${b.notes ? `\n\nNotes: ${b.notes}` : ""}` });
}

/** Day-before reminders for confirmed bookings (run hourly). */
export async function sendBookingReminders(now = new Date()) {
  const due = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.status, "confirmed"), isNull(schema.bookings.cancelledAt), isNull(schema.bookings.reminderSentAt), gt(schema.bookings.startsAt, now), lt(schema.bookings.startsAt, new Date(now.getTime() + 26 * 3600_000))))
    .limit(500);
  let n = 0;
  for (const b of due) {
    // Bookings made less than a day ahead already got a confirmation; skip the reminder.
    if (b.startsAt.getTime() - b.createdAt.getTime() < 24 * 3600_000) {
      await db.update(schema.bookings).set({ reminderSentAt: now }).where(eq(schema.bookings.id, b.id));
      continue;
    }
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, b.projectId));
    const st = await getBookingSettings(b.projectId);
    const when = new Intl.DateTimeFormat("en-IN", { timeZone: st.timezone, dateStyle: "full", timeStyle: "short" }).format(b.startsAt);
    await sendMail({ fromName: store.name, replyTo: store.email || undefined, to: b.email, subject: `Reminder: ${b.serviceName} ${when}`, body: `Hi ${b.name.split(" ")[0]}, a reminder of your ${b.serviceName} booking on ${when}.\n\n${store.name}` }).catch(() => {});
    await db.update(schema.bookings).set({ reminderSentAt: now }).where(eq(schema.bookings.id, b.id));
    n++;
  }
  return n;
}

/** Releases unpaid online bookings whose hold expired. */
export async function releaseExpiredBookings(now = new Date()) {
  const r = await db
    .update(schema.bookings)
    .set({ status: "cancelled", cancelledAt: now, cancelReason: "Payment not completed in time" })
    .where(and(eq(schema.bookings.status, "pending_payment"), lt(schema.bookings.holdUntil, now), isNull(schema.bookings.cancelledAt)))
    .returning({ id: schema.bookings.id });
  return r.length;
}
