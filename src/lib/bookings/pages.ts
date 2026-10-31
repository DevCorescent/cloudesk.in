// Public booking pages (no JavaScript): choose a service, a day, a time,
// then enter details. Rendered inside the site's shell like store pages.
import { esc } from "../site/html";
import { iconSvg } from "../site/icons";
import { formatPrice } from "../store/money";

export type SvcView = { id: string; name: string; description: string; durationMin: number; price: number; payment: string; capacity: number };
export type DayView = { date: string; label: string; weekday: string; open: boolean };
export type SlotView = { time: string; start: string; remaining: number };
export type BookingView = { id: string; serviceName: string; when: string; tz: string; name: string; email: string; status: string; amount: number; currency: string; paid: boolean; paymentMethod: string; googleLink: string; icsLink: string; canCancel: boolean; cancelNote: string };

const href = (base: string, path: string) => `${base}${path}`;
const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

export function bookIndexPage(services: SvcView[], ctx: { base: string; currency: string; storeName: string }) {
  if (!services.length) return `<section class="sec"><div class="wrap narrow sf-empty"><h1>Bookings</h1><p class="muted">Online booking isn't open yet. Please contact us.</p></div></section>`;
  return `<section class="sec sf-book"><div class="wrap"><header class="sf-shop-head"><h1>Book an appointment</h1><p class="lead">Choose a service to see available times at ${esc(ctx.storeName)}.</p></header>
<div class="svc-grid">${services
    .map(
      (s) => `<a class="svc-card card" href="${esc(href(ctx.base, `/book/${s.id}`))}"><h2>${esc(s.name)}</h2>${s.description ? `<p class="muted">${esc(s.description)}</p>` : ""}<p class="svc-meta"><span>${iconSvg("clock", 16)} ${duration(s.durationMin)}</span><strong>${s.price ? esc(formatPrice(s.price, ctx.currency)) : "Free"}</strong></p><span class="btn btn-primary">Choose a time</span></a>`,
    )
    .join("")}</div></div></section>`;
}

export function bookServicePage(
  s: SvcView,
  ctx: { base: string; formBase: string; currency: string; tz: string; days: DayView[]; date: string; slots: SlotView[]; time?: string; payments: { id: string; name: string }[]; error?: string; prefill?: { name?: string; email?: string; phone?: string } },
) {
  const chosen = ctx.slots.find((x) => x.time === ctx.time);
  const online = s.payment === "full" && s.price > 0;
  const dayLinks = ctx.days
    .map((d) => (d.open ? `<a class="day${d.date === ctx.date ? " day-on" : ""}" href="${esc(href(ctx.base, `/book/${s.id}?date=${d.date}`))}"><small>${esc(d.weekday)}</small><b>${esc(d.label)}</b></a>` : `<span class="day day-off" aria-disabled="true"><small>${esc(d.weekday)}</small><b>${esc(d.label)}</b></span>`))
    .join("");
  const slotLinks = ctx.slots.length
    ? `<div class="slots">${ctx.slots.map((x) => `<a class="slot${x.time === ctx.time ? " slot-on" : ""}" href="${esc(href(ctx.base, `/book/${s.id}?date=${ctx.date}&time=${x.time}`))}">${esc(x.time)}${s.capacity > 1 ? `<small>${x.remaining} left</small>` : ""}</a>`).join("")}</div>`
    : `<p class="muted">No times left on this day. Please choose another day.</p>`;
  const form = chosen
    ? `<form class="form card book-form" method="post" action="${esc(ctx.formBase)}/book"><input type="hidden" name="_base" value="${esc(ctx.base)}"><input type="hidden" name="serviceId" value="${esc(s.id)}"><input type="hidden" name="start" value="${esc(chosen.start)}">
<h2>${esc(s.name)} · ${esc(ctx.date)} at ${esc(chosen.time)}</h2>
<div class="row"><label>Name<input name="name" required maxlength="120" autocomplete="name" value="${esc(ctx.prefill?.name ?? "")}"></label><label>Phone<input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${esc(ctx.prefill?.phone ?? "")}"></label></div>
<label>Email<input name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(ctx.prefill?.email ?? "")}"></label>
<label>Anything we should know? (optional)<textarea name="notes" rows="2" maxlength="1000"></textarea></label>
${online ? (ctx.payments.length ? `<p><strong>Pay ${esc(formatPrice(s.price, ctx.currency))} now to confirm</strong></p><div class="radio-cards">${ctx.payments.map((p, i) => `<label class="radio-card"><input type="radio" name="payment" value="${esc(p.id)}"${i === 0 ? " checked" : ""} required><span><strong>${esc(p.name)}</strong></span></label>`).join("")}</div>` : `<p class="sf-alert">Online payment isn't available right now. Please contact us to book.</p>`) : s.price ? `<p class="muted">Pay ${esc(formatPrice(s.price, ctx.currency))} at your visit.</p>` : ""}
<button class="btn btn-primary btn-block btn-lg" type="submit"${online && !ctx.payments.length ? " disabled" : ""}>${online ? "Continue to payment" : "Confirm booking"}</button></form>`
    : "";
  return `<section class="sec sf-book"><div class="wrap narrow"><a class="crumb-back" href="${esc(href(ctx.base, "/book"))}">← All services</a>
<h1>${esc(s.name)}</h1><p class="lead">${duration(s.durationMin)} · ${s.price ? esc(formatPrice(s.price, ctx.currency)) : "Free"}${s.description ? ` · ${esc(s.description)}` : ""}</p>
${ctx.error ? `<p class="sf-alert" role="alert">${esc(ctx.error)}</p>` : ""}
<h2 class="book-h">Choose a day</h2><nav class="days" aria-label="Days">${dayLinks}</nav>
<h2 class="book-h">Choose a time <small class="muted">(${esc(ctx.tz)})</small></h2>${slotLinks}
${form}</div></section>`;
}

export function bookingPage(b: BookingView, ctx: { base: string; formBase: string; key: string; justBooked: boolean; paymentFailed?: boolean; message?: string; error?: string }) {
  const statusLine = { confirmed: "Confirmed", pending_payment: "Waiting for payment", cancelled: "Cancelled", completed: "Completed", no_show: "Missed" }[b.status] ?? b.status;
  const head =
    b.status === "cancelled"
      ? `<h1>Booking cancelled</h1>`
      : ctx.paymentFailed || b.status === "pending_payment"
        ? `<h1>Payment not completed</h1><p class="lead">Your time is held for a short while. If payment isn't completed, the booking is released.</p>`
        : `<span class="ok-badge">${iconSvg("check", 22)}</span><h1>${ctx.justBooked ? "You're booked!" : "Your booking"}</h1><p class="lead">A confirmation is on its way to ${esc(b.email)}.</p>`;
  return `<section class="sec sf-order"><div class="wrap narrow"><div class="order-head">${head}</div>
${ctx.message ? `<p class="sf-ok" role="status">${esc(ctx.message)}</p>` : ""}${ctx.error ? `<p class="sf-alert" role="alert">${esc(ctx.error)}</p>` : ""}
<div class="card book-summary"><h2>${esc(b.serviceName)}</h2><p><strong>${esc(b.when)}</strong> <span class="muted">(${esc(b.tz)})</span></p><p class="muted">${esc(b.name)} · ${esc(statusLine)}${b.amount ? ` · ${esc(formatPrice(b.amount, b.currency))} ${b.paid ? "paid" : b.paymentMethod === "none" ? "to pay at your visit" : "unpaid"}` : ""}</p>
${b.status === "confirmed" ? `<p class="book-cal"><a class="btn btn-secondary" href="${esc(b.googleLink)}" target="_blank" rel="noopener">Add to Google Calendar</a> <a class="btn btn-ghost" href="${esc(b.icsLink)}">Download calendar file</a></p>` : ""}</div>
${b.canCancel ? `<details class="sf-return"><summary class="btn btn-ghost">Cancel this booking</summary><form class="form" method="post" action="${esc(ctx.formBase)}/book"><input type="hidden" name="_base" value="${esc(ctx.base)}"><input type="hidden" name="action" value="cancel"><input type="hidden" name="id" value="${esc(b.id)}"><input type="hidden" name="key" value="${esc(ctx.key)}"><label>Reason (optional)<input name="reason" maxlength="300"></label><button class="btn btn-secondary" type="submit">Cancel booking</button></form></details>` : b.cancelNote ? `<p class="muted">${esc(b.cancelNote)}</p>` : ""}
<p class="center"><a class="btn btn-secondary" href="${esc(href(ctx.base, "/book"))}">Book something else</a></p></div></section>`;
}

/** Booking styles, layered on the store styles. */
export const BOOK_CSS = `.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}.svc-card{display:flex;flex-direction:column;gap:8px;text-decoration:none;color:inherit;padding:20px}.svc-card h2{font-size:1.15rem;margin:0}.svc-meta{display:flex;justify-content:space-between;align-items:center;margin:auto 0 8px}.svc-meta span{display:inline-flex;gap:6px;align-items:center}.svc-card .btn{align-self:flex-start}
.book-h{font-size:1rem;margin:28px 0 10px}.days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.day{flex:0 0 auto;display:grid;justify-items:center;gap:2px;min-width:64px;padding:10px 8px;border:1px solid var(--line);border-radius:var(--radius);text-decoration:none;color:inherit}.day small{font-size:.75rem;opacity:.7}.day-on{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}.day-off{opacity:.35}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}.slot{display:grid;justify-items:center;padding:10px;border:1px solid var(--line);border-radius:var(--radius);text-decoration:none;color:inherit;font-weight:600}.slot small{font-weight:400;font-size:.72rem;opacity:.7}.slot:hover{border-color:var(--accent)}.slot-on{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}
.book-form{margin-top:28px}.book-form h2{font-size:1.05rem;margin:0 0 12px}.book-summary h2{margin:0 0 6px}.book-cal{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}`;
