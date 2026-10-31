import { redirect } from "@/server/commerce/http";
import { activeMembership, memberCookieName, signMemberSession, verifyMemberLink } from "@/server/commerce/digital";
import { safeBase } from "@/server/commerce/orders";
import { hostServesProject } from "@/server/services/domains";

// Opens a members area from an emailed link: sets the member cookie, then
// returns to the page. The link is single-purpose and short-lived.
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const rawBase = url.searchParams.get("base") ?? "";
  let base = safeBase(rawBase);
  if (!base && /^https?:\/\/[^/]+$/.test(rawBase) && (await hostServesProject(new URL(rawBase).host, projectId))) base = rawBase;
  const next = url.searchParams.get("next") ?? "/";
  if (!base || !/^\/(?!\/)[\w\-/]*$/.test(next)) return new Response("Bad request", { status: 400 });
  const email = verifyMemberLink(projectId, url.searchParams.get("token"));
  if (!email || !(await activeMembership(projectId, email))) return redirect(`${base}${next === "/" ? "" : next}?err=${encodeURIComponent("That link has expired. Ask for a new one.")}`);
  const secure = (process.env.APP_URL ?? "").startsWith("https://") || base.startsWith("https://") ? "; Secure" : "";
  // A custom-domain site sets its cookie on its own host, so send the browser there first.
  if (base.startsWith("http") && new URL(base).host !== (req.headers.get("host") ?? url.host)) {
    return redirect(`${base}/api/v1/store/${projectId}/member?${url.searchParams.toString()}`);
  }
  return redirect(`${base}${next === "/" ? "" : next}` || "/", `${memberCookieName(projectId)}=${signMemberSession(projectId, email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
}
