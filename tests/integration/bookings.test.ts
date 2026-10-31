import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as bookRoute from "@/app/api/v1/store/[projectId]/book/route";
import * as ics from "@/app/api/v1/store/[projectId]/bookings/[bookingId]/ics/route";
import * as webhooks from "@/app/api/v1/store/[projectId]/webhooks/[provider]/route";
import { addDays, localDate } from "@/lib/bookings/slots";
import { availability, releaseExpiredBookings } from "@/server/bookings/bookings";
import { setPaymentHttp } from "@/server/commerce/payments";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let other = "";
let projectId = "";
const TZ = "Asia/Kolkata";
const tomorrow = () => addDays(localDate(new Date(), TZ), 1);
const store = (method: string, path: string, body?: unknown, c = cookie) => call(admin[method as "GET"], { method, cookie: c, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });

async function book(fields: Record<string, string>) {
  const f = new FormData();
  f.set("_base", "/s/acme/salon");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const res = await bookRoute.POST(new Request(`${ORIGIN}/x`, { method: "POST", headers: { origin: ORIGIN, "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` }, body: f }), { params: Promise.resolve({ projectId }) });
  return decodeURIComponent(res.headers.get("location") ?? "");
}
const person = (n: string) => ({ name: n, email: `${n.toLowerCase()}@example.com`, phone: "9876543210" });

beforeAll(async () => {
  await resetDb();
  const r = await call(signup.POST, { method: "POST", body: { name: "S", email: "salon@example.com", password: "correct-horse-42" } });
  cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: m.json.organizations[0].id }, body: { templateId: "blank", name: "Salon" } })).json.project.id;
  const o = await call(signup.POST, { method: "POST", body: { name: "X", email: "x@example.com", password: "correct-horse-42" } });
  other = cookieFrom(o);
  await store("POST", "setup", { name: "Glow Salon", country: "IN", region: "Karnataka", email: "owner@salon.example" });
  const all = { mon: [["09:00", "12:00"]], tue: [["09:00", "12:00"]], wed: [["09:00", "12:00"]], thu: [["09:00", "12:00"]], fri: [["09:00", "12:00"]], sat: [["09:00", "12:00"]], sun: [["09:00", "12:00"]] };
  expect((await store("PUT", "booking-settings", { timezone: TZ, hours: all, slotStepMin: 60, minNoticeHours: 0, maxDaysAhead: 30, closedDates: [], cancelHours: 0 })).status).toBe(200);
});

afterAll(async () => {
  setPaymentHttp((i, init) => fetch(i, init));
  await closeDb();
});

describe("bookings", () => {
  let cut = "";
  let yoga = "";

  it("sets up services and refuses invalid hours or online payment without a price", async () => {
    expect((await store("PUT", "booking-settings", { timezone: "Mars/Olympus", hours: {}, slotStepMin: 30, minNoticeHours: 0, maxDaysAhead: 30, closedDates: [], cancelHours: 0 })).status).toBe(422);
    expect((await store("PUT", "booking-settings", { timezone: TZ, hours: { mon: [["12:00", "09:00"]] }, slotStepMin: 30, minNoticeHours: 0, maxDaysAhead: 30, closedDates: [], cancelHours: 0 })).status).toBe(422);
    expect((await store("POST", "booking-services", { name: "Free?", durationMin: 30, price: 0, payment: "full", capacity: 1, bufferMin: 0 })).status).toBe(422);
    cut = (await store("POST", "booking-services", { name: "Haircut", description: "Wash, cut and style", durationMin: 60, price: 80000, payment: "none", capacity: 1, bufferMin: 0 })).json.service.id;
    yoga = (await store("POST", "booking-services", { name: "Yoga class", durationMin: 60, price: 0, payment: "none", capacity: 2, bufferMin: 0 })).json.service.id;
    expect((await store("GET", "bookings", undefined, other)).status).toBe(404);
  });

  it("books a slot, emails both sides, and never double-books it", async () => {
    const a = await availability(projectId, cut, tomorrow());
    expect(a!.slots.map((s) => s.time)).toEqual(["09:00", "10:00", "11:00"]);
    const start = a!.slots[0].start.toISOString();
    const loc = await book({ serviceId: cut, start, ...person("Asha") });
    expect(loc).toMatch(/^\/s\/acme\/salon\/booking\/[0-9a-f-]+\?key=.+&booked=1$/);
    await new Promise((r) => setTimeout(r, 150));
    const mails = await db.select().from(schema.outboundEmails);
    expect(mails.some((m) => m.to === "asha@example.com" && m.body.includes("calendar.google.com"))).toBe(true);
    expect(mails.some((m) => m.to === "owner@salon.example" && m.subject.startsWith("New booking: Haircut"))).toBe(true);
    expect(await book({ serviceId: cut, start, ...person("Ravi") })).toContain("just taken");
    expect((await availability(projectId, cut, tomorrow()))!.slots.map((s) => s.time)).toEqual(["10:00", "11:00"]);

    // Two people racing for the same time: exactly one gets it.
    const t = a!.slots[1].start.toISOString();
    const both = await Promise.all([book({ serviceId: cut, start: t, ...person("Meena") }), book({ serviceId: cut, start: t, ...person("Kiran") })]);
    expect(both.filter((l) => l.includes("booked=1"))).toHaveLength(1);

    // Calendar file for the booking holder only.
    const [, id, key] = /booking\/([0-9a-f-]+)\?key=([^&]+)/.exec(loc)!;
    const file = await ics.GET(new Request(`${ORIGIN}/x?key=${encodeURIComponent(key)}`), { params: Promise.resolve({ projectId, bookingId: id }) });
    expect(await file.text()).toContain("SUMMARY:Haircut — Glow Salon");
    expect((await ics.GET(new Request(`${ORIGIN}/x?key=wrong`), { params: Promise.resolve({ projectId, bookingId: id }) })).status).toBe(404);
  });

  it("fills class places up to capacity, and lets customers cancel with their link", async () => {
    const start = (await availability(projectId, yoga, tomorrow()))!.slots[0].start.toISOString();
    const first = await book({ serviceId: yoga, start, ...person("A") });
    expect(first).toContain("booked=1");
    expect((await availability(projectId, yoga, tomorrow()))!.slots[0].remaining).toBe(1);
    expect(await book({ serviceId: yoga, start, ...person("B") })).toContain("booked=1");
    expect(await book({ serviceId: yoga, start, ...person("C") })).toContain("just taken");

    const [, id, key] = /booking\/([0-9a-f-]+)\?key=([^&]+)/.exec(first)!;
    expect(await book({ action: "cancel", id, key: "wrong" })).toContain("err=");
    expect(await book({ action: "cancel", id, key })).toContain("cancelled=1");
    expect((await availability(projectId, yoga, tomorrow()))!.slots[0].remaining).toBe(1);
  });

  it("takes payment online: holds the slot, confirms from the signed webhook, releases unpaid holds", async () => {
    const calls: string[] = [];
    let n = 0;
    setPaymentHttp(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/balance")) return Response.json({});
      if (url.endsWith("/v1/checkout/sessions")) return Response.json({ id: `cs_book_${++n}`, url: "https://checkout.stripe.com/pay/b" });
      return Response.json({ error: { message: "unexpected" } }, { status: 400 });
    });
    await store("PUT", "payments/stripe", { enabled: true, credentials: { secretKey: "sk_test_book", webhookSecret: "whsec_b" } });
    const massage = (await store("POST", "booking-services", { name: "Massage", durationMin: 60, price: 250000, payment: "full", capacity: 1, bufferMin: 0 })).json.service.id;
    const slots = (await availability(projectId, massage, tomorrow()))!.slots;
    expect(await book({ serviceId: massage, start: slots[0].start.toISOString(), payment: "stripe", ...person("Paid") })).toBe("https://checkout.stripe.com/pay/b");
    const [held] = await db.select().from(schema.bookings).where(eq(schema.bookings.serviceName, "Massage"));
    expect(held).toMatchObject({ status: "pending_payment", paid: false, paymentRef: "cs_book_1" });
    // The held slot is not offered to others.
    expect((await availability(projectId, massage, tomorrow()))!.slots.map((s) => s.time)).not.toContain(slots[0].time);

    const raw = JSON.stringify({ id: "evt_b1", type: "checkout.session.completed", data: { object: { id: "cs_book_1", payment_status: "paid", amount_total: 250000, payment_intent: "pi_b1" } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac("sha256", "whsec_b").update(`${t}.${raw}`).digest("hex")}`;
    const res = await webhooks.POST(new Request(`${ORIGIN}/x`, { method: "POST", headers: { "stripe-signature": sig }, body: raw }), { params: Promise.resolve({ projectId, provider: "stripe" }) });
    expect(res.status).toBe(200);
    const [paid] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, held.id));
    expect(paid).toMatchObject({ status: "confirmed", paid: true, paymentCaptureRef: "pi_b1", holdUntil: null });

    expect(await book({ serviceId: massage, start: slots[1].start.toISOString(), payment: "stripe", ...person("Gone") })).toContain("checkout.stripe.com");
    await db.update(schema.bookings).set({ holdUntil: new Date(Date.now() - 1000) }).where(eq(schema.bookings.name, "Gone"));
    expect(await releaseExpiredBookings()).toBe(1);
    expect((await availability(projectId, massage, tomorrow()))!.slots.map((s) => s.time)).toContain(slots[1].time);
  });

  it("shows the calendar to the owner, who can cancel and record outcomes", async () => {
    const r = await store("GET", "bookings");
    const live = r.json.bookings.filter((b: { status: string }) => b.status === "confirmed");
    expect(live.length).toBeGreaterThanOrEqual(3);
    expect((await store("POST", `bookings/${live[0].id}`, { action: "cancel" })).status).toBe(200);
    expect((await store("POST", `bookings/${live[1].id}`, { action: "paid_at_visit" })).status).toBe(200);
    const after = (await store("GET", "bookings")).json.bookings;
    expect(after.find((b: { id: string }) => b.id === live[0].id).status).toBe("cancelled");
    expect(after.find((b: { id: string }) => b.id === live[1].id).paid).toBe(true);
  });
});
