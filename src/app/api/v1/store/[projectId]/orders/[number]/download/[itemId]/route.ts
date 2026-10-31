import { downloadForOrder } from "@/server/commerce/digital";
import { ApiError } from "@/server/http/errors";
import { clientIp } from "@/server/http/handler";
import { rateLimit } from "@/server/security/rate-limit";

// Purchased digital files, for whoever holds the order key, a limited number of times.
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string; number: string; itemId: string }> }) {
  const { projectId, number, itemId } = await params;
  try {
    await rateLimit(`download:${clientIp(req)}`, 60, 600_000);
    if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[0-9a-f-]{36}$/i.test(itemId) || !/^\d{1,9}$/.test(number)) throw new ApiError("not_found", "Not found");
    const f = await downloadForOrder(projectId, Number(number), new URL(req.url).searchParams.get("key") ?? "", itemId);
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mime,
        "Content-Length": String(f.data.length),
        "Content-Disposition": `attachment; filename="${f.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError("internal_error", "Something went wrong");
    return new Response(err.message, { status: err.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
