// A workspace's portal for its customers ("c/…") and suppliers ("s/…"):
// asking for a sign-in link, using it, and everything a signed-in visitor
// reads and sends. Sessions are cookies set here; nothing here needs a member.
import { z } from "zod";
import { readJson, route, type RequestContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { MAX_INVOICE_BYTES, type PortalKind } from "@/lib/portal/model";
import { portalBySlug, requestLink, sideOpen, signIn, signOut, visitor } from "@/server/portal/auth";
import * as customer from "@/server/portal/customer";
import * as supplier from "@/server/portal/supplier";
import { rateLimit } from "@/server/security/rate-limit";

type P = { slug: string; rest?: string[] };
const body = (ctx: RequestContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: RequestContext, { slug, rest = [] }: P) {
  await rateLimit(`portal:${ctx.ip}`, 300, 60_000);
  const m = ctx.req.method;
  const [area, a, b, c] = rest;
  if (area === "info" && m === "GET") {
    const p = await portalBySlug(slug);
    return { name: p.name, customers: sideOpen(p, "customer"), suppliers: sideOpen(p, "supplier") };
  }
  if (area === "link" && m === "POST") return requestLink(slug, await body(ctx), ctx.ip);
  if (area === "signin" && m === "POST") {
    const { token } = await readJson(ctx.req, z.object({ token: z.string().max(200) }));
    const r = await signIn(slug, token, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") });
    ctx.headers.append("Set-Cookie", r.cookie);
    return { kind: r.kind, email: r.email };
  }
  if (area === "signout" && m === "POST") {
    const kind = (a === "supplier" ? "supplier" : "customer") as PortalKind;
    ctx.headers.append("Set-Cookie", await signOut(slug, kind, ctx.req));
    return { ok: true };
  }
  if (area === "c") {
    const v = await visitor(slug, "customer", ctx.req);
    const key = `${m} ${a ?? ""}`;
    if (key === "GET me") return { kind: v.kind, email: v.email, name: v.name };
    if (key === "GET home") return customer.home(v);
    if (key === "GET invoices") return { invoices: await customer.invoices(v) };
    if (key === "GET payments") return { payments: await customer.payments(v) };
    if (key === "GET orders") return { orders: await customer.orders(v) };
    if (key === "GET tickets") return { tickets: await customer.tickets(v) };
    if (key === "POST tickets") return { ticket: await customer.raiseTicket(v, await body(ctx)) };
  }
  if (area === "s") {
    const v = await visitor(slug, "supplier", ctx.req);
    const key = `${m} ${a ?? ""}${b ? " :id" : ""}${c ? ` ${c}` : ""}`;
    if (key === "GET me") return { kind: v.kind, email: v.email, name: v.name };
    if (key === "GET home") return supplier.home(v);
    if (key === "GET rfqs") return { rfqs: await supplier.rfqs(v) };
    if (key === "POST rfqs :id quote") return { quote: await supplier.quote(v, b!, await body(ctx)) };
    if (key === "GET orders") return { orders: await supplier.orders(v) };
    if (key === "POST orders :id ack") return supplier.acknowledge(v, b!, await body(ctx));
    if (key === "POST orders :id dispatch") return { dispatch: await supplier.dispatch(v, b!, await body(ctx)) };
    if (key === "GET bills") return { bills: await supplier.bills(v) };
    if (key === "GET invoices") return { invoices: await supplier.submissions(v) };
    if (key === "POST invoices") {
      if (Number(ctx.req.headers.get("content-length") ?? 0) > MAX_INVOICE_BYTES + 256 * 1024) throw new ApiError("payload_too_large", "Invoices are limited to 10 MB");
      let form: FormData;
      try {
        form = await ctx.req.formData();
      } catch {
        throw new ApiError("bad_request", "Send the invoice as multipart/form-data");
      }
      const file = form.get("file");
      let meta: unknown = {};
      try {
        meta = JSON.parse(String(form.get("meta") ?? "{}"));
      } catch {
        throw new ApiError("validation_failed", "The invoice details aren't valid");
      }
      return { invoice: await supplier.submitInvoice(v, meta, file instanceof File && file.size ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) } : null) };
    }
  }
  throw notFound("Route");
}

export const GET = route<P>(handle, { auth: false });
export const POST = route<P>(handle, { auth: false });
