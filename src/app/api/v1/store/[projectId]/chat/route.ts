import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { readCookie } from "@/server/auth/session";
import { redirect, withMsg } from "@/server/commerce/http";
import { safeBase } from "@/server/commerce/orders";
import { errorResponse, clientIp } from "@/server/http/handler";
import { ask, chatCookieName, conversationFor, requestHandoff } from "@/server/knowledge/chat";
import { rateLimit } from "@/server/security/rate-limit";
import { hostServesProject } from "@/server/services/domains";

function chatCookie(projectId: string, token: string) {
  const secure = (process.env.APP_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return `${chatCookieName(projectId)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
}

/** Messages from the published site's /chat page (plain form posts, no scripts). */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return new Response("Bad request", { status: 400 });
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return new Response("Bad request", { status: 400 });
    const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, projectId), isNull(schema.projects.archivedAt)));
    if (!p) return new Response("Not found", { status: 404 });
    const form = await req.formData();
    const raw = String(form.get("_base") ?? "");
    const base = safeBase(raw);
    if (!base && (raw !== "" || !(await hostServesProject(req.headers.get("host") ?? "", projectId)))) return new Response("Bad request", { status: 400 });
    const back = `${base}/chat`;
    // Model calls cost money: limit per network address.
    await rateLimit(`chat:${clientIp(req)}`, 20, 600_000);
    const { conversation, token } = await conversationFor(projectId, readCookie(req.headers.get("cookie"), chatCookieName(projectId)), true);
    const cookie = token ? chatCookie(projectId, token) : undefined;
    try {
      if (String(form.get("action")) === "handoff") {
        await requestHandoff(projectId, conversation!.id, String(form.get("email") ?? ""), String(form.get("note") ?? ""));
        return redirect(`${back}?sent=1#latest`, cookie);
      }
      await ask(projectId, conversation!.id, String(form.get("message") ?? ""));
      return redirect(`${back}#latest`, cookie);
    } catch (e) {
      return redirect(withMsg(back, "err", (e as Error).message), cookie);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
