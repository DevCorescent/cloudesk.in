import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { safeEqual } from "../security/tokens";
import { adjustStock } from "./catalog";
import { getOrder, getOrderByKey, orderLabel } from "./orders";
import { appUrl, sendMail } from "../services/mail";

// ─── Signed customer links ("My orders") ────────────────────────────────────

const ACCOUNT_TTL_MS = 24 * 3600_000;

function linkKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  // A purpose-specific key, so these signatures can never be confused with other uses.
  return createHmac("sha256", Buffer.from(raw, "base64")).update("store-account-link-v1").digest();
}

export function signAccountToken(projectId: string, email: string, now = Date.now()) {
  const exp = now + ACCOUNT_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ p: projectId, e: email.trim().toLowerCase(), x: exp })).toString("base64url");
  const sig = createHmac("sha256", linkKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Returns the email the token was issued for, or null if it is invalid, expired or for another store. */
export function verifyAccountToken(projectId: string, token: string, now = Date.now()) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", linkKey()).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as { p: string; e: string; x: number };
    if (d.p !== projectId || d.x < now) return null;
    return d.e;
  } catch {
    return null;
  }
}

/** Emails a sign-in link. Responds the same whether or not the email has orders, so addresses cannot be probed. */
export async function sendAccountLink(projectId: string, email: string, base: string) {
  const e = email.trim().toLowerCase();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (!store) return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), sql`lower(${schema.storeOrders.email}) = ${e}`));
  if (!n) return;
  const link = appUrl(`${base}/account?token=${encodeURIComponent(signAccountToken(projectId, e))}`);
  await sendMail({ fromName: store.name, replyTo: store.email || undefined, to: e, subject: `${store.name}: your orders`, body: `Use this link to see your orders, track deliveries and request returns. It works for 24 hours.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.\n\n${store.name}` });
}

export async function customerOrders(projectId: string, email: string) {
  const orders = await db
    .select()
    .from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.projectId, projectId), sql`lower(${schema.storeOrders.email}) = ${email.toLowerCase()}`))
    .orderBy(desc(schema.storeOrders.createdAt))
    .limit(100);
  const ids = orders.map((o) => o.id);
  const [items, returns] = ids.length
    ? await Promise.all([
        db.select().from(schema.storeOrderItems).where(inArray(schema.storeOrderItems.orderId, ids)),
        db.select().from(schema.storeReturns).where(inArray(schema.storeReturns.orderId, ids)),
      ])
    : [[], []];
  return orders.map((o) => ({ order: o, items: items.filter((i) => i.orderId === o.id), returns: returns.filter((r) => r.orderId === o.id) }));
}

// ─── Returns ─────────────────────────────────────────────────────────────────

export const RETURN_REASONS = ["Wrong size or fit", "Damaged or defective", "Not as described", "Received the wrong item", "Changed my mind", "Other"] as const;

export const returnRequestSchema = z.object({
  reason: z.enum(RETURN_REASONS),
  details: z.string().trim().max(1000).default(""),
  items: z.array(z.object({ itemId: z.uuid(), quantity: z.number().int().min(1).max(99) })).min(1).max(50),
});

export type ReturnItem = { itemId: string; quantity: number; title: string; variantTitle: string };

/** Days after delivery during which customers can ask for a return; 0 turns returns off. */
export const returnWindowDays = (checkout: unknown) => {
  const d = (checkout as { returnDays?: number } | null)?.returnDays;
  return typeof d === "number" ? d : 7;
};

/** Whether this order can take a new return request now. */
export function returnEligibility(o: typeof schema.storeOrders.$inferSelect, days: number, open: { status: string }[], now = Date.now()) {
  if (!days) return { ok: false as const, reason: "This store does not accept return requests online. Please contact the store." };
  if (o.cancelledAt) return { ok: false as const, reason: "This order was cancelled." };
  if (o.fulfillmentStatus !== "delivered" && o.fulfillmentStatus !== "shipped") return { ok: false as const, reason: "Returns open once your order has shipped." };
  // Delivery dates are not recorded, so the window runs from dispatch plus a week for transit.
  const from = (o.fulfilledAt ?? o.createdAt).getTime();
  if (now - from > (days + 7) * 86400_000) return { ok: false as const, reason: `The ${days}-day return window has closed.` };
  if (open.some((r) => r.status === "requested" || r.status === "approved")) return { ok: false as const, reason: "A return is already in progress for this order." };
  return { ok: true as const };
}

export async function requestReturn(projectId: string, number: number, auth: { key?: string; email?: string }, input: z.infer<typeof returnRequestSchema>) {
  const found = auth.key ? await getOrderByKey(projectId, number, auth.key) : null;
  let order = found?.order;
  let items = found?.items;
  if (!order && auth.email) {
    const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, number), sql`lower(${schema.storeOrders.email}) = ${auth.email.toLowerCase()}`));
    if (o) {
      order = o;
      items = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id));
    }
  }
  if (!order || !items) throw notFound("Order");
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const existing = await db.select({ status: schema.storeReturns.status, items: schema.storeReturns.items }).from(schema.storeReturns).where(eq(schema.storeReturns.orderId, order.id));
  const ok = returnEligibility(order, returnWindowDays(store.checkout), existing);
  if (!ok.ok) throw new ApiError("conflict", ok.reason);
  // Quantities cannot exceed what was bought minus what earlier returns already covered.
  const already = new Map<string, number>();
  for (const r of existing.filter((x) => x.status !== "rejected")) for (const it of r.items as ReturnItem[]) already.set(it.itemId, (already.get(it.itemId) ?? 0) + it.quantity);
  const lines: ReturnItem[] = [];
  for (const it of input.items) {
    const line = items.find((i) => i.id === it.itemId);
    if (!line) throw new ApiError("validation_failed", "Choose items from this order");
    if (it.quantity > line.quantity - (already.get(line.id) ?? 0)) throw new ApiError("validation_failed", `You can return at most ${line.quantity - (already.get(line.id) ?? 0)} of ${line.title}`);
    lines.push({ itemId: line.id, quantity: it.quantity, title: line.title, variantTitle: line.variantTitle });
  }
  const [r] = await db.insert(schema.storeReturns).values({ projectId, orderId: order.id, reason: input.reason, details: input.details, items: lines }).returning();
  await db.insert(schema.storeOrderEvents).values({ orderId: order.id, kind: "return_requested", message: `Customer requested a return: ${input.reason}`, data: { returnId: r.id } });
  const label = orderLabel(store.orderPrefix, order.number);
  for (const to of new Set([store.email, ...store.notifyEmails].filter(Boolean))) {
    await sendMail({ to, subject: `Return requested for ${label}`, body: `${order.email} asked to return:\n\n${lines.map((l) => `  ${l.quantity} × ${l.title}${l.variantTitle && l.variantTitle !== "Default" ? ` (${l.variantTitle})` : ""}`).join("\n")}\n\nReason: ${input.reason}${input.details ? `\n${input.details}` : ""}\n\nApprove or decline it under Returns in your store dashboard.` });
  }
  return r;
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function listReturns(projectId: string, status?: string) {
  const conds = [eq(schema.storeReturns.projectId, projectId)];
  if (status) conds.push(eq(schema.storeReturns.status, status));
  return db
    .select({ ret: schema.storeReturns, number: schema.storeOrders.number, email: schema.storeOrders.email, total: schema.storeOrders.total, paymentMethod: schema.storeOrders.paymentMethod })
    .from(schema.storeReturns)
    .innerJoin(schema.storeOrders, eq(schema.storeOrders.id, schema.storeReturns.orderId))
    .where(and(...conds))
    .orderBy(desc(schema.storeReturns.createdAt))
    .limit(300);
}

const NEXT: Record<string, string[]> = { requested: ["approved", "rejected"], approved: ["received", "rejected"], received: ["refunded"] };

export async function updateReturn(projectId: string, id: string, actorId: string, input: { status: "approved" | "rejected" | "received" | "refunded"; resolution?: string; restock?: boolean; notify?: boolean }) {
  const [r] = await db.select().from(schema.storeReturns).where(and(eq(schema.storeReturns.id, id), eq(schema.storeReturns.projectId, projectId)));
  if (!r) throw notFound("Return");
  if (!(NEXT[r.status] ?? []).includes(input.status)) throw new ApiError("conflict", `A ${r.status} return cannot be marked ${input.status}`);
  const { order, items } = await getOrder(projectId, r.orderId);
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  await db.transaction(async (tx) => {
    await tx.update(schema.storeReturns).set({ status: input.status, resolution: input.resolution ?? r.resolution, updatedAt: new Date() }).where(eq(schema.storeReturns.id, r.id));
    if (input.status === "received") {
      if (input.restock) {
        for (const it of r.items as ReturnItem[]) {
          const line = items.find((i) => i.id === it.itemId);
          if (line?.variantId) await adjustStock(projectId, line.variantId, it.quantity, "Returned by customer", actorId, orderLabel(store.orderPrefix, order.number), tx);
        }
      }
      const returnedAll = items.every((i) => (r.items as ReturnItem[]).find((x) => x.itemId === i.id)?.quantity === i.quantity);
      if (returnedAll) await tx.update(schema.storeOrders).set({ fulfillmentStatus: "returned" }).where(eq(schema.storeOrders.id, order.id));
    }
    const msg = { approved: "Return approved", rejected: "Return declined", received: `Returned items received${input.restock ? " and restocked" : ""}`, refunded: "Return refunded" }[input.status];
    await tx.insert(schema.storeOrderEvents).values({ orderId: order.id, kind: `return_${input.status}`, message: `${msg}${input.resolution ? ` — ${input.resolution}` : ""}`, data: { returnId: r.id }, actorId });
  });
  if (input.notify !== false && input.status !== "refunded") {
    const label = orderLabel(store.orderPrefix, order.number);
    const body = {
      approved: `Your return for order ${label} has been approved.${input.resolution ? `\n\n${input.resolution}` : "\n\nWe'll be in touch with how to send the items back."}`,
      rejected: `We couldn't accept the return for order ${label}.${input.resolution ? `\n\n${input.resolution}` : ""}`,
      received: `We've received the items you returned from order ${label}. Your refund will follow shortly.`,
    }[input.status];
    await sendMail({ fromName: store.name, replyTo: store.email || undefined, to: order.email, subject: `${store.name}: return update for ${label}`, body: `${body}\n\n${store.name}` });
  }
}
