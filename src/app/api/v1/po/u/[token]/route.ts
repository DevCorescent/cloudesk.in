import { unsubscribe } from "@/server/outreach/core";

// One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await unsubscribe(token).catch(() => ({ ok: false }));
  return Response.json({ ok: r.ok }, { status: r.ok ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
