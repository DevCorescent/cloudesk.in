// Book valet ahead of a visit: /v/book/<venue token>.
import { valetBookingPage } from "@/lib/horeca/qr-page";
import { guestBookValet, venueByToken } from "@/server/horeca/valet";
import { settingsOf } from "@/server/horeca/venue";
import { ApiError } from "@/server/http/errors";
import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "same-origin" };

export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  const v = await venueByToken(token);
  const s = v ? settingsOf(v) : null;
  if (!v || !s?.valet.enabled || !s.qr.valetBooking) return new Response("<!doctype html><meta charset=utf-8><p style='font-family:system-ui;text-align:center;margin-top:30vh'>Valet booking isn't available here.</p>", { status: 404, headers: HEADERS });
  return new Response(valetBookingPage({ venue: v.name, accent: s.qr.accent }), { headers: HEADERS });
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  await rateLimit(`valet-book:${clientIp(req) ?? "?"}`, 10, 600_000);
  const f = await req.formData();
  // The browser sends local time without a zone; venues are in India.
  const local = String(f.get("expectedAt") ?? "");
  const expectedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00+05:30` : local;
  try {
    const t = await guestBookValet(token, { guestName: f.get("guestName"), guestPhone: f.get("guestPhone"), plate: f.get("plate") ?? "", car: f.get("car") ?? "", expectedAt });
    return new Response(null, { status: 303, headers: { Location: `/v/${t.token}?m=booked` } });
  } catch (e) {
    const v = await venueByToken(token);
    return new Response(valetBookingPage({ venue: v?.name ?? "", accent: v ? settingsOf(v).qr.accent : "#b4532a" }, e instanceof ApiError ? e.message : "Couldn't book — please try again."), { status: 422, headers: HEADERS });
  }
}
