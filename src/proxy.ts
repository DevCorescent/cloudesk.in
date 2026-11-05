import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/server/security/firewall";

const PLATFORM = new Set(["localhost", "127.0.0.1", "[::1]"]);

const hostOf = (url?: string) => {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return "";
  }
};
/**
 * The platform's own addresses: APP_URL's host and its www., the domains
 * Vercel serves this project on (its production domain and deployment URLs),
 * any *.vercel.app address (customers' sites never use those), and any listed
 * in PLATFORM_HOSTS (comma-separated).
 */
const OWN_HOSTS = new Set(
  [process.env.APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, ...(process.env.PLATFORM_HOSTS ?? "").split(",")]
    .map((u) => hostOf(u?.trim()))
    .filter(Boolean)
    .flatMap((h) => [h, h.startsWith("www.") ? h.slice(4) : `www.${h}`]),
);

/** True for requests to a customer's own domain rather than the platform. */
function isCustomHost(host: string) {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (PLATFORM.has(h) || OWN_HOSTS.has(h) || h.endsWith(".vercel.app")) return false;
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
  // One address for the platform: www. goes to the bare domain (payment
  // providers only accept the website they approved, and sign-ins stay on one host).
  const at = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (at.startsWith("www.") && OWN_HOSTS.has(at) && OWN_HOSTS.has(at.slice(4)) && !at.endsWith(".vercel.app")) {
    return NextResponse.redirect(`https://${at.slice(4)}${path}${request.nextUrl.search}`, 308);
  }
  // In production, pages opened on a vercel.app address move to the platform's
  // own domain (APP_URL), so everyone is signed in on one address. API calls
  // (webhooks, callbacks registered earlier) keep working where they are.
  const home = hostOf(process.env.APP_URL);
  if (process.env.VERCEL_ENV === "production" && home && !home.endsWith(".vercel.app") && at.endsWith(".vercel.app") && at !== hostOf(process.env.VERCEL_URL) && (request.method === "GET" || request.method === "HEAD") && !path.startsWith("/api/")) {
    return NextResponse.redirect(`https://${home}${path}${request.nextUrl.search}`, 308);
  }
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
