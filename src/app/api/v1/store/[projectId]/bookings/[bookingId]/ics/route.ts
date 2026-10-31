import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { icsFile } from "@/lib/bookings/slots";
import { bookingByKey } from "@/server/bookings/bookings";

// Calendar file for a booking, available to whoever holds the booking key.
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string; bookingId: string }> }) {
  const { projectId, bookingId } = await params;
  const b = await bookingByKey(projectId, bookingId, new URL(req.url).searchParams.get("key") ?? "");
  if (!b || b.cancelledAt) return new Response("Not found", { status: 404 });
  const [store] = await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const body = icsFile({ uid: `${b.id}@creationcloud`, title: `${b.serviceName} — ${store?.name ?? ""}`, start: b.startsAt, end: b.endsAt, description: `Booked with ${store?.name ?? ""}` });
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="booking.ics"', "Cache-Control": "private, no-store" } });
}
