// The team's side of the portals: what customers and suppliers may see, the
// portal addresses, who has signed in (and signing them out), sending someone
// a sign-in link, and the invoices suppliers sent — download, turn into a
// bill (read by AI when a provider is connected), or send back with a reason.
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { loginSchema, settingsSchema } from "@/lib/portal/model";
import { isOn, isPartOn, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { can, type Role } from "../authz/permissions";
import { ApiError, notFound } from "../http/errors";
import { requireOrg, type AuthedContext } from "../http/handler";
import { check } from "../helpdesk/access";
import { log } from "../log";
import { appUrl, sendMail } from "../services/mail";
import { getPortalSettings, known, requestLink } from "./auth";

export type Scope = { orgId: string; userId: string; role: Role; manage: boolean; books: boolean; slug: string; name: string; partsOff: PartsOff; has: (m: ModuleId) => boolean };
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const I = schema.portalInvoices;

export async function scope(ctx: AuthedContext, orgId: string): Promise<Scope> {
  const { role } = await requireOrg(ctx, orgId, "portal:read");
  const [org] = await db.select({ modules: schema.organizations.modules, partsOff: schema.organizations.partsOff, slug: schema.organizations.slug, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!isOn(org?.modules, "portal")) throw new ApiError("forbidden", "Switch on Customer & supplier portals in Settings → Features first");
  const [m] = await db.select({ allowed: schema.customRoles.modules }).from(schema.memberships).leftJoin(schema.customRoles, eq(schema.customRoles.id, schema.memberships.customRoleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, ctx.user.id)));
  const visible = { modules: org?.modules ?? null, allowed: (m?.allowed as string[] | null) ?? null };
  const has = (id: ModuleId) => visibleTo(visible, id);
  return { orgId, userId: ctx.user.id, role, manage: can(role, "portal:manage"), books: has("accounting") && can(role, "accounts:write"), slug: org!.slug, name: org!.name, partsOff: (org?.partsOff ?? {}) as PartsOff, has };
}

const requireManage = (s: Scope) => {
  if (!s.manage) throw new ApiError("forbidden", "Only workspace owners and admins can do this");
};
const requireBooks = (s: Scope) => {
  if (!s.books) throw new ApiError("forbidden", "Booking supplier invoices needs access to Accounts");
};

export async function overview(s: Scope) {
  const [counts] = await db
    .select({ submitted: sql<number>`count(*) filter (where ${I.status} = 'submitted')::int` })
    .from(I)
    .where(eq(I.orgId, s.orgId));
  return {
    me: { manage: s.manage, books: s.books },
    settings: await getPortalSettings(s.orgId),
    parts: { customers: isPartOn(s.partsOff, "portal", "customers"), suppliers: isPartOn(s.partsOff, "portal", "suppliers") },
    urls: { customers: appUrl(`/portal/${s.slug}?kind=customer`), suppliers: appUrl(`/portal/${s.slug}?kind=supplier`) },
    toBook: counts.submitted,
  };
}

export async function saveSettings(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(settingsSchema, { ...(await getPortalSettings(s.orgId)), ...(raw as object) });
  await db.insert(schema.portalSettings).values({ orgId: s.orgId, settings: v }).onConflictDoUpdate({ target: schema.portalSettings.orgId, set: { settings: v } });
  return v;
}

export async function sessions(s: Scope) {
  const S = schema.portalSessions;
  return db.select({ id: S.id, kind: S.kind, email: S.email, createdAt: S.createdAt, lastSeenAt: S.lastSeenAt, expiresAt: S.expiresAt }).from(S).where(and(eq(S.orgId, s.orgId), isNull(S.revokedAt), gt(S.expiresAt, new Date()))).orderBy(desc(S.lastSeenAt)).limit(200);
}

export async function revoke(s: Scope, id: string) {
  requireManage(s);
  if (!isId(id)) throw notFound("Session");
  const [r] = await db.update(schema.portalSessions).set({ revokedAt: new Date() }).where(and(eq(schema.portalSessions.id, id), eq(schema.portalSessions.orgId, s.orgId))).returning();
  if (!r) throw notFound("Session");
}

/** Email someone their sign-in link — the team is told if the address isn't one the portal knows. */
export async function invite(s: Scope, raw: unknown) {
  requireManage(s);
  const v = check(loginSchema, raw);
  const email = v.email.trim().toLowerCase();
  if (!(await known(s.orgId, v.kind, email))) throw new ApiError("validation_failed", v.kind === "supplier" ? "No active supplier has that email. Add it to the supplier first." : "No customer, contact or ticket has that email yet.", { email: ["Not known"] });
  return requestLink(s.slug, v, `member:${s.userId}`);
}

// ── Invoices from suppliers ─────────────────────────────────────────────────

export async function submissions(s: Scope, q: { status?: string } = {}) {
  const status = ["submitted", "billed", "rejected"].includes(q.status ?? "") ? q.status! : "submitted";
  const rows = await db
    .select({ id: I.id, invoiceNo: I.invoiceNo, date: I.date, amount: I.amount, note: I.note, filename: I.filename, status: I.status, reason: I.reason, billId: I.billId, submittedBy: I.submittedBy, createdAt: I.createdAt, supplierId: I.supplierId, supplier: schema.invSuppliers.name, po: schema.invPurchaseOrders.number })
    .from(I)
    .innerJoin(schema.invSuppliers, eq(schema.invSuppliers.id, I.supplierId))
    .leftJoin(schema.invPurchaseOrders, eq(schema.invPurchaseOrders.id, I.poId))
    .where(and(eq(I.orgId, s.orgId), eq(I.status, status)))
    .orderBy(desc(I.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r, date: String(r.date) }));
}

async function getSubmission(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Invoice");
  const [r] = await db.select().from(I).where(and(eq(I.id, id), eq(I.orgId, s.orgId)));
  if (!r) throw notFound("Invoice");
  return r;
}

export async function submissionFile(s: Scope, id: string) {
  const r = await getSubmission(s, id);
  if (!r.bytes) throw notFound("File");
  return new Response(new Uint8Array(r.bytes), { headers: { "Content-Type": r.mime || "application/octet-stream", "Content-Disposition": `attachment; filename="${r.filename.replace(/[^\w.\- ]/g, "_") || "invoice"}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}

/** A draft bill for a supplier's invoice: read from its file by AI when that's possible, otherwise from what they typed. */
export async function draftFor(ctx: AuthedContext, s: Scope, id: string, useAi: boolean) {
  requireBooks(s);
  const r = await getSubmission(s, id);
  if (r.status !== "submitted") throw new ApiError("conflict", "This invoice was already dealt with");
  const [sup] = await db.select().from(schema.invSuppliers).where(eq(schema.invSuppliers.id, r.supplierId));
  const basic = {
    draft: { supplierId: sup.id, supplierName: sup.name, supplierGstin: sup.gstin ?? "", billNo: r.invoiceNo, date: String(r.date), dueDate: null, currency: "INR", interState: false, lines: [{ accountId: null, description: `Invoice ${r.invoiceNo}${r.note ? ` — ${r.note.slice(0, 120)}` : ""}`, amount: r.amount, gstRate: 0 }] },
    warnings: ["The supplier gave only a total. Split it into lines and GST before saving."],
  };
  if (!useAi || !r.bytes) return basic;
  const { scope: accScope } = await import("../accounting/access");
  const { extractBill } = await import("../accounting/extract");
  try {
    const read = await extractBill(await accScope(ctx, s.orgId), { name: r.filename || "invoice.pdf", bytes: r.bytes });
    const warnings = [...read.warnings];
    // What they typed and what the file says should agree.
    const total = read.draft.lines.reduce((n, l) => n + l.amount + Math.round((l.amount * l.gstRate) / 100), 0);
    if (Math.abs(total - r.amount) > 100 * Math.max(1, read.draft.lines.length)) warnings.push(`The supplier entered ₹${(r.amount / 100).toLocaleString("en-IN")} but the file adds up to ₹${(total / 100).toLocaleString("en-IN")}.`);
    if (read.draft.billNo && read.draft.billNo.toUpperCase() !== r.invoiceNo.toUpperCase()) warnings.push(`The supplier entered invoice number ${r.invoiceNo}; the file shows ${read.draft.billNo}.`);
    return { draft: { ...read.draft, supplierId: sup.id, supplierName: sup.name }, warnings };
  } catch (e) {
    log.warn("portal.draft_ai_failed", { err: e instanceof Error ? e.message : String(e) });
    return { ...basic, warnings: [...basic.warnings, `It couldn't be read automatically: ${e instanceof ApiError ? e.message : "the AI provider failed"}`] };
  }
}

/** Link the bill made from a supplier's invoice. */
export async function markBilled(s: Scope, id: string, raw: unknown) {
  requireBooks(s);
  const r = await getSubmission(s, id);
  if (r.status !== "submitted") throw new ApiError("conflict", "This invoice was already dealt with");
  const { billId } = check(z.object({ billId: z.uuid() }), raw);
  const [b] = await db.select({ id: schema.accBills.id }).from(schema.accBills).where(and(eq(schema.accBills.id, billId), eq(schema.accBills.orgId, s.orgId), eq(schema.accBills.supplierId, r.supplierId)));
  if (!b) throw new ApiError("validation_failed", "That bill isn't this supplier's");
  await db.update(I).set({ status: "billed", billId, decidedAt: new Date() }).where(eq(I.id, r.id));
}

/** Send an invoice back to the supplier with a reason (they can send a corrected one). */
export async function reject(s: Scope, id: string, raw: unknown) {
  requireBooks(s);
  const r = await getSubmission(s, id);
  if (r.status !== "submitted") throw new ApiError("conflict", "This invoice was already dealt with");
  const { reason } = check(z.object({ reason: z.string().trim().min(1, "Say why").max(1000) }), raw);
  // A returned invoice doesn't hold its number, so a corrected one can be sent again.
  await db.update(I).set({ status: "rejected", reason, decidedAt: new Date() }).where(eq(I.id, r.id));
  await sendMail({ to: r.submittedBy, subject: `Invoice ${r.invoiceNo} was returned by ${s.name}`, fromName: s.name, body: `Hello,\n\nYour invoice ${r.invoiceNo} was returned:\n\n${reason}\n\nYou can send a corrected one from your supplier portal: ${appUrl(`/portal/${s.slug}?kind=supplier`)}` }).catch(() => {});
}
