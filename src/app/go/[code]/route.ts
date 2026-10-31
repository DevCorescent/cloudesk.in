// A partner's link: /go/CODE?c=campaign&to=/pricing. Counts the visit,
// remembers the code for the program's cookie window, and goes on to the page.
import { NextResponse } from "next/server";
import { recordClick } from "@/server/partners/core";
import { log } from "@/server/log";

const safePath = (to: string | null) => (to && /^\/(?!\/)[\w\-./?=&%#]*$/.test(to) ? to : "/");

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(req.url);
  const res = NextResponse.redirect(new URL(safePath(url.searchParams.get("to")), url.origin), 302);
  // Bots following links don't count.
  if (/bot|crawl|spider|preview|facebookexternalhit|slurp/i.test(req.headers.get("user-agent") ?? "")) return res;
  const hit = await recordClick(code, url.searchParams.get("c") ?? "").catch((e) => {
    log.warn("partner click failed", { error: String(e) });
    return null;
  });
  if (hit) res.cookies.set("cc_ref", hit.campaign ? `${hit.code}|${hit.campaign}` : hit.code, { maxAge: hit.days * 86400, path: "/", sameSite: "lax", httpOnly: true, secure: url.protocol === "https:" });
  return res;
}
