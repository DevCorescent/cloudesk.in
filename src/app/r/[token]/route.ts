// Request a table online: /r/<venue token>. Arrives on the Reservations board as "booked".
import { reservePage } from "@/lib/horeca/qr-page";
import { guestReserve } from "@/server/horeca/reservations";
import { venueByToken } from "@/server/horeca/valet";
import { settingsOf } from "@/server/horeca/venue";
import { ApiError } from "@/server/http/errors";
import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "same-origin" };
const closed = () => new Response("<!doctype html><meta charset=utf-8><p style='font-family:system-ui;text-align:center;margin-top:30vh'>Online reservations aren't open here.</p>", { status: 404, headers: HEADERS });
const pageFor = (v: NonNullable<Awaited<ReturnType<typeof venueByToken>>>) => {
  const s = settingsOf(v);
  return { venue: v.name, accent: s.qr.accent, maxParty: s.reservations.maxParty, openFrom: s.reservations.openFrom, openTo: s.reservations.openTo };
};

export async function GET(_req: Request, { params }: Ctx) {
  const v = await venueByToken((await params).token);
  if (!v || !settingsOf(v).sections.reservations || !settingsOf(v).reservations.online) return closed();
  return new Response(reservePage(pageFor(v)), { headers: HEADERS });
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  await rateLimit(`reserve:${clientIp(req) ?? "?"}`, 10, 600_000);
  const v = await venueByToken(token);
  if (!v) return closed();
  const f = await req.formData();
  // The browser sends local time without a zone; venues are in India.
  const local = String(f.get("at") ?? "");
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00+05:30` : local;
  try {
    const { reservation: r } = await guestReserve(token, { guestName: f.get("guestName"), guestPhone: f.get("guestPhone"), partySize: Number(f.get("partySize") ?? 2), at, notes: f.get("notes") ?? "" });
    const when = r.at.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
    return new Response(reservePage(pageFor(v), { ok: true, text: `${r.partySize} ${r.partySize === 1 ? "person" : "people"} · ${when}` }), { headers: HEADERS });
  } catch (e) {
    return new Response(reservePage(pageFor(v), { ok: false, text: e instanceof ApiError ? e.message : "Couldn't send that — please try again." }), { status: 422, headers: HEADERS });
  }
}
