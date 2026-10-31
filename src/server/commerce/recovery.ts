// Abandoned-cart recovery that runs by itself: a while after a shopper leaves
// a cart, they get one reminder (email and/or WhatsApp) with a link that
// restores the cart in any browser — optionally with a discount code.
// Only shoppers who agreed to hear from the store are contacted, once.
import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { formatPrice } from "@/lib/store/money";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { randomToken, sha256 } from "../security/tokens";
import { appUrl, mailConfigured, sendMail } from "../services/mail";
import { quoteCart } from "./cart";
import { sendCartReminderWhatsApp, whatsappActive } from "./whatsapp";

export const DELAYS = [1, 3, 6, 12, 24] as const;
/** Reminder links restore the cart for this long. */
const LINK_DAYS = 14;
/** Carts older than this are left alone. */
const MAX_AGE_DAYS = 7;

export const recoverySchema = z.object({
  enabled: z.boolean().default(false),
  delayHours: z
    .number()
    .int()
    .refine((n) => (DELAYS as readonly number[]).includes(n), "Choose 1, 3, 6, 12 or 24 hours")
    .default(3),
  email: z.boolean().default(true),
  whatsapp: z.boolean().default(false),
  discountCode: z.string().trim().toUpperCase().max(40).regex(/^[A-Z0-9_-]*$/, "Codes use letters, numbers, - and _").default(""),
});
export type RecoverySettings = z.infer<typeof recoverySchema>;

const settingsOf = (raw: unknown) => recoverySchema.parse(raw ?? {});

/** The live store address (/s/org/project), or null until it's published. */
async function liveBase(projectId: string) {
  const [p] = await db.select({ slug: schema.projects.slug, org: schema.organizations.slug, prod: schema.projects.productionDeploymentId }).from(schema.projects).innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId)).where(eq(schema.projects.id, projectId));
  return p?.prod ? `/s/${p.org}/${p.slug}` : null;
}

async function discountFor(projectId: string, code: string) {
  if (!code) return null;
  const [d] = await db.select().from(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.projectId, projectId), sql`upper(${schema.storeDiscounts.code}) = ${code}`));
  return d ?? null;
}
const usable = (d: NonNullable<Awaited<ReturnType<typeof discountFor>>>) => d.active && (!d.endsAt || d.endsAt.getTime() > Date.now()) && (!d.startsAt || d.startsAt.getTime() <= Date.now());

export async function getRecovery(projectId: string) {
  const [s] = await db.select({ recovery: schema.stores.recovery }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (!s) throw notFound("Store");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const reminded = sql`(${schema.storeCarts.recoveryEmailedAt} is not null or ${schema.storeCarts.whatsappRemindedAt} is not null)`;
  const [sent] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeCarts).where(and(eq(schema.storeCarts.projectId, projectId), reminded, gte(schema.storeCarts.updatedAt, since)));
  const [back] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeCarts).where(and(eq(schema.storeCarts.projectId, projectId), isNotNull(schema.storeCarts.recoveredAt), gte(schema.storeCarts.recoveredAt, since)));
  // A recovered order: a reminded cart that went on to become an order.
  const [won] = await db
    .select({ n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(coalesce(${schema.storeOrders.baseTotal}, ${schema.storeOrders.total})),0)::bigint` })
    .from(schema.storeCarts)
    .innerJoin(schema.storeOrders, eq(schema.storeOrders.id, schema.storeCarts.orderId))
    .where(and(eq(schema.storeCarts.projectId, projectId), reminded, gte(schema.storeOrders.createdAt, since), isNull(schema.storeOrders.cancelledAt)));
  return {
    settings: settingsOf(s.recovery),
    ready: { email: mailConfigured(), whatsapp: await whatsappActive(projectId), published: !!(await liveBase(projectId)) },
    stats: { sent: sent?.n ?? 0, cameBack: back?.n ?? 0, orders: won?.n ?? 0, revenue: Number(won?.value ?? 0) },
  };
}

export async function saveRecovery(projectId: string, raw: unknown) {
  const r = recoverySchema.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the settings");
  const v = r.data;
  if (v.enabled && !v.email && !v.whatsapp) throw new ApiError("validation_failed", "Choose email, WhatsApp or both.");
  if (v.whatsapp && !(await whatsappActive(projectId))) throw new ApiError("validation_failed", "Connect WhatsApp under Store → WhatsApp and turn on the cart-reminder template first.");
  if (v.discountCode) {
    const d = await discountFor(projectId, v.discountCode);
    if (!d) throw new ApiError("validation_failed", `There's no discount code "${v.discountCode}". Create it under Store → Discounts first, so it works at checkout.`);
    if (!usable(d)) throw new ApiError("validation_failed", `The code "${v.discountCode}" isn't active right now.`);
  }
  await db.update(schema.stores).set({ recovery: v }).where(eq(schema.stores.projectId, projectId));
  return getRecovery(projectId);
}

type Cart = typeof schema.storeCarts.$inferSelect;
type Store = typeof schema.stores.$inferSelect;

function offerLine(d: Awaited<ReturnType<typeof discountFor>>, currency: string) {
  if (!d || !usable(d)) return "";
  const what = d.kind === "percent" ? `${d.value}% off` : d.kind === "fixed" ? `${formatPrice(d.value, currency)} off` : "free delivery";
  return `\nAs a thank-you for coming back, code ${d.code.toUpperCase()} (already applied through the link) gives you ${what}.\n`;
}

/** One reminder email with the cart's contents and a restore link. */
async function emailReminder(store: Store, cart: Cart, link: string, settings: RecoverySettings) {
  const q = await quoteCart(store.projectId, cart);
  const money = (n: number) => formatPrice(n, q.store.currency);
  const name = String((cart.address as { name?: string } | null)?.name ?? "").split(" ")[0];
  const lines = q.lines.map((l) => `  • ${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""} — ${money(l.unitPrice * l.quantity)}`).join("\n");
  const offer = offerLine(await discountFor(store.projectId, settings.discountCode), q.store.currency);
  await sendMail({
    fromName: store.name,
    replyTo: store.email || undefined,
    to: cart.email,
    subject: `${store.name}: your cart is saved`,
    body: `Hi${name ? ` ${name}` : ""},\n\nYou left these in your cart at ${store.name}:\n\n${lines}\n\nSubtotal: ${money(q.totals.subtotal)}\n${offer}\nPick up where you left off — this link restores your cart on any device for ${LINK_DAYS} days:\n${link}\n\nQuestions? Just reply to this email.\n\n${store.name}\n\n(You're getting this because you agreed to hear from ${store.name} at checkout.)`,
  });
}

/** Gives the cart a fresh restore token and returns the link that uses it. */
async function newLink(cartId: string, base: string) {
  const token = randomToken(24);
  await db.update(schema.storeCarts).set({ recoveryTokenHash: sha256(token) }).where(eq(schema.storeCarts.id, cartId));
  return appUrl(`${base}/cart/recover?t=${token}`);
}

/** The owner's "Send reminder" button. Same rules as the automatic run: consent, once per channel. */
export async function sendReminderNow(projectId: string, cartId: string, channel: "email" | "whatsapp") {
  const [c] = await db.select().from(schema.storeCarts).where(and(eq(schema.storeCarts.id, cartId), eq(schema.storeCarts.projectId, projectId)));
  if (!c || c.orderId) throw notFound("Cart");
  if (!c.marketingConsent) throw new ApiError("forbidden", "This shopper did not agree to receive messages");
  const base = await liveBase(projectId);
  if (!base) throw new ApiError("conflict", "Publish your store first, so the link in the reminder works.");
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (channel === "whatsapp") return sendCartReminderWhatsApp(projectId, cartId, await newLink(cartId, base));
  const [claimed] = await db.update(schema.storeCarts).set({ recoveryEmailedAt: new Date() }).where(and(eq(schema.storeCarts.id, cartId), isNull(schema.storeCarts.recoveryEmailedAt))).returning();
  if (!claimed) throw new ApiError("conflict", "A reminder was already sent");
  await emailReminder(s, claimed, await newLink(cartId, base), settingsOf(s.recovery));
}

/**
 * The scheduled run: for each store with recovery on, remind carts that were
 * left more than the chosen delay ago (and less than a week). A cart is
 * claimed atomically, so overlapping runs never send twice.
 */
export async function runCartRecovery(now = Date.now()) {
  const stores = await db.select().from(schema.stores).where(sql`(${schema.stores.recovery}->>'enabled')::boolean = true`);
  let sent = 0;
  for (const store of stores) {
    const settings = settingsOf(store.recovery);
    const base = await liveBase(store.projectId);
    if (!base) continue;
    const wa = settings.whatsapp && (await whatsappActive(store.projectId));
    const carts = await db
      .select({ id: schema.storeCarts.id })
      .from(schema.storeCarts)
      .where(
        and(
          eq(schema.storeCarts.projectId, store.projectId),
          isNull(schema.storeCarts.orderId),
          isNull(schema.storeCarts.recoveryStartedAt),
          eq(schema.storeCarts.marketingConsent, true),
          sql`${schema.storeCarts.email} <> ''`,
          sql`jsonb_array_length(${schema.storeCarts.items}) > 0`,
          lt(schema.storeCarts.updatedAt, new Date(now - settings.delayHours * 3_600_000)),
          gte(schema.storeCarts.updatedAt, new Date(now - MAX_AGE_DAYS * 86_400_000)),
        ),
      )
      .limit(100);
    for (const { id } of carts) {
      const [cart] = await db.update(schema.storeCarts).set({ recoveryStartedAt: new Date(now) }).where(and(eq(schema.storeCarts.id, id), isNull(schema.storeCarts.recoveryStartedAt))).returning();
      if (!cart) continue;
      const link = await newLink(cart.id, base);
      try {
        if (settings.email && !cart.recoveryEmailedAt) {
          await db.update(schema.storeCarts).set({ recoveryEmailedAt: new Date(now) }).where(eq(schema.storeCarts.id, cart.id));
          await emailReminder(store, cart, link, settings);
          sent++;
        }
        if (wa && cart.whatsappOptIn && !cart.whatsappRemindedAt) {
          await sendCartReminderWhatsApp(store.projectId, cart.id, link);
          sent++;
        }
      } catch (e) {
        log.warn("cart_recovery_failed", { cartId: cart.id, error: (e as Error).message });
      }
    }
  }
  return sent;
}

/** Restores a cart from a reminder link. Returns a fresh cart cookie token, or null. */
export async function restoreCart(projectId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  const [c] = await db.select().from(schema.storeCarts).where(and(eq(schema.storeCarts.projectId, projectId), eq(schema.storeCarts.recoveryTokenHash, sha256(token))));
  const sentAt = c && (c.recoveryEmailedAt ?? c.whatsappRemindedAt ?? c.recoveryStartedAt);
  if (!c || c.orderId || !sentAt || Date.now() - sentAt.getTime() > LINK_DAYS * 86_400_000) return null;
  const [s] = await db.select({ recovery: schema.stores.recovery }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const code = settingsOf(s?.recovery).discountCode;
  const d = code && !c.discountCode ? await discountFor(projectId, code) : null;
  const cookieToken = randomToken(24);
  // The link's browser takes over the cart; the token keeps working for the same shopper.
  await db
    .update(schema.storeCarts)
    .set({ tokenHash: sha256(cookieToken), recoveredAt: c.recoveredAt ?? new Date(), ...(d && usable(d) ? { discountCode: d.code } : {}), updatedAt: new Date() })
    .where(eq(schema.storeCarts.id, c.id));
  return { cookieToken, code: d && usable(d) ? d.code.toUpperCase() : null };
}
