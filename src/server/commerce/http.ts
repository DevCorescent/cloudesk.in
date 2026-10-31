import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { readCookie } from "../auth/session";
import { clientIp } from "../http/handler";
import { rateLimit } from "../security/rate-limit";
import { cartCookieName, createCart, findCart } from "./cart";
import { hostServesProject, originOf } from "../services/domains";
import { safeBase } from "./orders";

/** Common checks for storefront form posts. Returns null when the request must be rejected. */
export async function storefrontContext(req: Request, projectId: string, form: FormData) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return null;
  await rateLimit(`store:${clientIp(req)}`, 120, 60_000);
  const [p] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.stores, eq(schema.stores.projectId, schema.projects.id))
    .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.archivedAt)));
  if (!p) return null;
  const raw = String(form.get("_base") ?? "");
  const base = safeBase(raw);
  // Links that leave the site (emails, payment returns) need an absolute origin on custom domains.
  let publicBase = base;
  if (!base) {
    // A site on its own domain lives at the root; that is only accepted from the verified domain itself.
    if (raw !== "" || !(await hostServesProject(req.headers.get("host") ?? "", projectId))) return null;
    publicBase = originOf(req);
  }
  return { base, publicBase, cookieName: cartCookieName(projectId), token: readCookie(req.headers.get("cookie"), cartCookieName(projectId)) };
}

export async function cartFor(projectId: string, token: string | undefined, create: boolean) {
  const cart = await findCart(projectId, token);
  if (cart || !create) return { cart, token: token ?? null, created: false };
  const fresh = await createCart(projectId);
  return { cart: fresh.cart, token: fresh.token, created: true };
}

export function cartCookie(name: string, token: string) {
  const secure = (process.env.APP_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
}

export function redirect(url: string, cookie?: string) {
  const headers = new Headers({ Location: url, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export const withMsg = (url: string, key: string, msg: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg.slice(0, 300))}`;
