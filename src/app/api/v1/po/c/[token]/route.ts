import { trackClick } from "@/server/outreach/core";

// Outreach's tracked links: count the click (people's, not scanners'), then go
// where the link pointed — only if the link's signature matches. The cc_po
// cookie remembers which email brought them, so a sign-up is credited exactly.
const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "";

async function handle(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = new URL(req.url).searchParams;
  const to = await trackClick(token, q.get("u") ?? "", q.get("s") ?? "", { ua: req.headers.get("user-agent"), ip: ipOf(req), method: req.method }).catch(() => "/");
  const headers = new Headers({ Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (req.method === "GET" && /^[A-Za-z0-9_-]{16,64}$/.test(token)) headers.append("Set-Cookie", `cc_po=${token}; Path=/; Max-Age=${60 * 86400}; SameSite=Lax; HttpOnly${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`);
  return new Response(null, { status: 302, headers });
}

export const GET = handle;
export const HEAD = handle;
