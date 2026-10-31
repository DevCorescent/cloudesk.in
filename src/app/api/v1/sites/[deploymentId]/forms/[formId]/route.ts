import { and, eq } from "drizzle-orm";
import { submitCustomForm } from "@/server/services/custom-forms";
import { db, schema } from "@/db";
import { emitEvent } from "@/server/events/bus";
import { clientIp, errorResponse } from "@/server/http/handler";
import { ApiError } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { recordStat } from "@/server/services/stats";
import { recordPromoStat } from "@/server/promotions/service";
import { supportTicket } from "@/server/site/support";
import { allowedOrigins } from "@/server/export/targets";

const FORMS: Record<string, string[]> = {
  contact: ["name", "email", "message"],
  booking: ["name", "contact", "date", "time", "guests", "notes"],
  newsletter: ["email"],
  support: ["name", "email", "subject", "message"],
};

// Public endpoint for forms on published sites. Accepts only known fields,
// bounded sizes, and drops honeypot hits silently.
export async function POST(req: Request, { params }: { params: Promise<{ deploymentId: string; formId: string }> }) {
  try {
    const { deploymentId, formId } = await params;
    const custom = /^x-[a-zA-Z0-9_-]{1,60}$/.test(formId);
    const fields = FORMS[formId];
    if ((!fields && !custom) || !/^[0-9a-f-]{36}$/i.test(deploymentId)) throw new ApiError("not_found", "Form not found");
    const origin = req.headers.get("origin");
    await rateLimit(`form:${clientIp(req)}`, 10, 10 * 60_000);
    if (Number(req.headers.get("content-length") ?? 0) > 20_000) throw new ApiError("payload_too_large", "Submission too large");
    const [dep] = await db
      .select({ projectId: schema.deployments.projectId, artifact: schema.deployments.artifact })
      .from(schema.deployments)
      .where(and(eq(schema.deployments.id, deploymentId), eq(schema.deployments.status, "ready")));
    if (!dep) throw new ApiError("not_found", "Form not found");
    // Same site, or one of this web app's own copies published elsewhere (Netlify, Vercel, GitHub Pages).
    const external = origin && origin !== new URL(req.url).origin;
    if (external && !(await allowedOrigins(dep.projectId)).has(origin)) throw new ApiError("forbidden", "Cross-origin form submission rejected");
    const form = await req.formData();
    const back = new URL(req.headers.get("referer") ?? "/", req.url);
    back.searchParams.set("submitted", "1");
    // Back to the page the form was on — here, or on the allowed external copy it came from.
    const redirectTo = back.origin === new URL(req.url).origin || (external && back.origin === origin) ? back.toString() : new URL("/", req.url).toString();
    if (String(form.get("_hp") ?? "")) return Response.redirect(redirectTo, 303);
    if (custom) {
      await submitCustomForm(dep.projectId, deploymentId, formId, (dep.artifact ?? {}) as Record<string, string>, form, new URL(req.url).searchParams.get("page") ?? "");
      return Response.redirect(redirectTo, 303);
    }
    const data: Record<string, string> = {};
    for (const f of fields) data[f] = String(form.get(f) ?? "").slice(0, 4000).trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email ?? "");
    if (formId === "newsletter" ? !emailOk : formId === "support" ? !emailOk || !data.name || !data.message : !data.name) throw new ApiError("validation_failed", "Required fields are missing");
    await db.insert(schema.formSubmissions).values({ projectId: dep.projectId, deploymentId, formId, data });
    // A support request becomes a Helpdesk ticket when the workspace has the Helpdesk.
    if (formId === "support") await supportTicket(dep.projectId, data);
    // A sign-up from a promotion pop-up counts towards that promotion.
    const promo = new URL(req.url).searchParams.get("promo") ?? "";
    if (/^[0-9a-f-]{36}$/i.test(promo)) await recordPromoStat(dep.projectId, promo, "submit");
    await emitEvent(dep.projectId, "form.submitted", { formId, page: new URL(req.url).searchParams.get("page") ?? "", data, submittedAt: new Date().toISOString() });
    // Attribute the conversion to the page (and A/B variant) it came from.
    const artifact = (dep.artifact ?? {}) as Record<string, string>;
    const page = new URL(req.url).searchParams.get("page") ?? "";
    if (artifact[page]) {
      const ab = String(form.get("_ab") ?? "");
      const isTest = !!artifact[`${page}#B`] && (ab === "A" || ab === "B");
      await recordStat(dep.projectId, page, "submit", isTest ? artifact[`${page}#exp`] || page : "", isTest ? ab : "");
    }
    return Response.redirect(redirectTo, 303);
  } catch (err) {
    return errorResponse(err);
  }
}
