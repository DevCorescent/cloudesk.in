// Google / Microsoft send people back here after they approve mail access.
// The signed state must match this browser's cookie and the signed-in person;
// then the code is exchanged, the mailbox saved, and they land back in Mail.
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { readCookie } from "@/server/auth/session";
import { route } from "@/server/http/handler";
import { createOauthAccount } from "@/server/mail/accounts";
import { exchangeCode, OAUTH_COOKIE, unseal } from "@/server/mail/oauth";
import { appUrl } from "@/server/services/mail";

const back = (q: string) => new Response(null, { status: 302, headers: { location: appUrl(`/mail${q}`), "set-cookie": `${OAUTH_COOKIE}=; Path=/api/v1/mail/oauth; Max-Age=0`, "cache-control": "no-store" } });

export const GET = route(async (ctx) => {
  const u = new URL(ctx.req.url);
  if (u.searchParams.get("error")) return back(`?error=${encodeURIComponent(u.searchParams.get("error_description") ?? "Sign-in was cancelled")}`);
  const st = unseal(u.searchParams.get("state"));
  const nonce = readCookie(ctx.req.headers.get("cookie"), OAUTH_COOKIE);
  if (!st || !nonce || nonce !== st.n || st.uid !== ctx.user.id) return back(`?error=${encodeURIComponent("That sign-in link expired or wasn't started here. Try again.")}`);
  const [member] = await db.select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, st.org), eq(schema.memberships.userId, ctx.user.id)));
  if (!member) return back(`?error=${encodeURIComponent("You're not in that workspace any more.")}`);
  try {
    const tokens = await exchangeCode(st.p, u.searchParams.get("code") ?? "");
    const acc = await createOauthAccount({ orgId: st.org, userId: ctx.user.id, userName: ctx.user.name, shared: st.shared }, st.p, tokens);
    return back(`?connected=${acc.id}`);
  } catch (e) {
    return back(`?error=${encodeURIComponent(e instanceof Error ? e.message : "Couldn't connect the mailbox")}`);
  }
});
