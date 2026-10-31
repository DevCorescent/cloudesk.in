import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/server/security/firewall";

const PLATFORM = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for requests to a customer's own domain rather than the platform. */
function isCustomHost(host: string) {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (PLATFORM.has(h)) return false;
  if (process.env.APP_URL && new URL(process.env.APP_URL).hostname.toLowerCase() === h) return false;
  if (process.env.CUSTOM_DOMAIN_CNAME && process.env.CUSTOM_DOMAIN_CNAME.toLowerCase() === h) return false;
  return true;
}

// Paths with their own handling: never rewritten to a customer domain's site.
const OWN = /^\/(api|sites|s|d|assets|mail-img)(\/|$)/;

export async function proxy(request: NextRequest) {
  // The firewall sees every request first (pages, API, published sites).
  const refused = await checkRequest(request);
  if (refused) return refused;
  const path = request.nextUrl.pathname;
  if (OWN.test(path)) {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", path + request.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  }
  // Customer domains are served by /d/…, which looks the domain up and serves
  // that site's live deployment.
  const host = request.headers.get("host") ?? "";
  if (host && isCustomHost(host)) {
    const url = request.nextUrl.clone();
    url.pathname = `/d${request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }
  // Exposes the request path to server layouts so a signed-out visitor can be
  // sent back to the page they asked for after logging in.
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything but Next's own static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
