// A valet guest's ticket: /v/<token>. Shows where the car is; "Bring my car".
import { valetTicketPage } from "@/lib/horeca/qr-page";
import { guestRequestCar, ticketByToken } from "@/server/horeca/valet";
import { settingsOf } from "@/server/horeca/venue";
import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

type Ctx = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "X-Robots-Tag": "noindex", "Referrer-Policy": "same-origin" };
const missing = () => new Response("<!doctype html><meta charset=utf-8><title>Not found</title><p style='font-family:system-ui;text-align:center;margin-top:30vh'>This valet ticket isn't valid.</p>", { status: 404, headers: HEADERS });

export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  await rateLimit(`valet:${clientIp(req) ?? "?"}`, 300, 600_000);
  const hit = await ticketByToken(token);
  if (!hit) return missing();
  const m = new URL(req.url).searchParams.get("m");
  const t = hit.ticket;
  const msg = m === "requested" ? "Got it — your car is on its way." : m === "booked" ? "Booked! Show this page when you arrive." : m === "err" ? "!Your car isn't parked with us right now." : undefined;
  return new Response(valetTicketPage({ venue: hit.venue.name, ticket: t.ticket, status: t.status, plate: t.plate, car: t.car, accent: settingsOf(hit.venue).qr.accent, expectedAt: t.expectedAt ? t.expectedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : null }, msg), { headers: HEADERS });
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  await rateLimit(`valet-req:${clientIp(req) ?? "?"}`, 20, 600_000);
  try {
    await guestRequestCar(token);
    return new Response(null, { status: 303, headers: { Location: `/v/${token}?m=requested` } });
  } catch {
    return new Response(null, { status: 303, headers: { Location: `/v/${token}?m=err` } });
  }
}
