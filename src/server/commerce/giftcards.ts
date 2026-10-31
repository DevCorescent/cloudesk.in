import { randomInt } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/store/money";
import { ApiError, notFound } from "../http/errors";
import { sendMail } from "../services/mail";
import type { Exec } from "./catalog";

export type GiftCardRow = typeof schema.storeGiftCards.$inferSelect;

// No 0/O or 1/I/L, so codes survive being read aloud or handwritten.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const generateGiftCode = () => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");
export const normalizeGiftCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

export type GiftCheck = { ok: true; card: GiftCardRow } | { ok: false; reason: string };

/** Validates a code for use on an order in the given currency. */
export function checkGiftCard(card: GiftCardRow | undefined | null, currency: string, now = new Date()): GiftCheck {
  if (!card) return { ok: false, reason: "That gift card code was not found." };
  if (card.disabled) return { ok: false, reason: "This gift card has been disabled." };
  if (card.expiresAt && card.expiresAt < now) return { ok: false, reason: "This gift card has expired." };
  if (card.currency !== currency) return { ok: false, reason: "This gift card is in a different currency." };
  if (card.balance <= 0) return { ok: false, reason: "This gift card has no balance left." };
  return { ok: true, card };
}

export async function findGiftCard(projectId: string, code: string, exec: Exec = db, lock = false) {
  const q = exec
    .select()
    .from(schema.storeGiftCards)
    .where(and(eq(schema.storeGiftCards.projectId, projectId), sql`upper(${schema.storeGiftCards.code}) = ${normalizeGiftCode(code)}`));
  const [card] = lock ? await q.for("update") : await q;
  return card ?? null;
}

/** Adds money back to a card (refund or cancellation). */
export async function creditGiftCard(cardId: string, orderId: string | null, amount: number, reason: string, exec: Exec = db) {
  if (amount <= 0) return;
  await exec.update(schema.storeGiftCards).set({ balance: sql`${schema.storeGiftCards.balance} + ${amount}` }).where(eq(schema.storeGiftCards.id, cardId));
  await exec.insert(schema.storeGiftCardTxns).values({ giftCardId: cardId, orderId, amount, reason });
}

/** How much of an order's gift card payment has already gone back to the card. */
export async function giftCardRefunded(orderId: string, exec: Exec = db) {
  const [r] = await exec.select({ n: sql<number>`coalesce(sum(${schema.storeGiftCardTxns.amount}),0)::int` }).from(schema.storeGiftCardTxns).where(and(eq(schema.storeGiftCardTxns.orderId, orderId), sql`${schema.storeGiftCardTxns.amount} > 0`));
  return Number(r?.n ?? 0);
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function listGiftCards(projectId: string) {
  return db.select().from(schema.storeGiftCards).where(eq(schema.storeGiftCards.projectId, projectId)).orderBy(desc(schema.storeGiftCards.createdAt)).limit(500);
}

export async function giftCardDetail(projectId: string, id: string) {
  const [card] = await db.select().from(schema.storeGiftCards).where(and(eq(schema.storeGiftCards.id, id), eq(schema.storeGiftCards.projectId, projectId)));
  if (!card) throw notFound("Gift card");
  const txns = await db
    .select({ id: schema.storeGiftCardTxns.id, amount: schema.storeGiftCardTxns.amount, reason: schema.storeGiftCardTxns.reason, createdAt: schema.storeGiftCardTxns.createdAt, orderId: schema.storeGiftCardTxns.orderId, orderNumber: schema.storeOrders.number })
    .from(schema.storeGiftCardTxns)
    .leftJoin(schema.storeOrders, eq(schema.storeOrders.id, schema.storeGiftCardTxns.orderId))
    .where(eq(schema.storeGiftCardTxns.giftCardId, card.id))
    .orderBy(desc(schema.storeGiftCardTxns.createdAt));
  return { card, txns };
}

export async function issueGiftCard(projectId: string, userId: string, input: { value: number; code?: string; recipientEmail?: string; note?: string; expiresAt?: string | null; sendEmail?: boolean }) {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (!store) throw new ApiError("conflict", "Set up the store first");
  if (!Number.isInteger(input.value) || input.value <= 0) throw new ApiError("validation_failed", "Enter an amount", { value: ["Required"] });
  const code = input.code ? normalizeGiftCode(input.code) : generateGiftCode();
  if (!/^[A-Z0-9-]{6,32}$/.test(code)) throw new ApiError("validation_failed", "Codes use 6–32 letters, numbers and dashes", { code: ["Invalid"] });
  if (await findGiftCard(projectId, code)) throw new ApiError("conflict", "That code is already in use", { code: ["Already exists"] });
  const card = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.storeGiftCards)
      .values({ projectId, code, initialValue: input.value, balance: input.value, currency: store.currency, recipientEmail: input.recipientEmail ?? "", note: input.note ?? "", expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, createdBy: userId })
      .returning();
    await tx.insert(schema.storeGiftCardTxns).values({ giftCardId: c.id, amount: input.value, reason: "Issued" });
    return c;
  });
  if (input.sendEmail && card.recipientEmail) {
    await sendMail({
      fromName: store.name,
      replyTo: store.email || undefined,
      to: card.recipientEmail,
      subject: `You've received a ${formatMoney(card.initialValue, card.currency)} gift card from ${store.name}`,
      body: `${input.note ? `${input.note}\n\n` : ""}Your gift card code: ${card.code}\nValue: ${formatMoney(card.initialValue, card.currency)}${card.expiresAt ? `\nValid until: ${card.expiresAt.toISOString().slice(0, 10)}` : ""}\n\nEnter the code in your cart at checkout. Any unused balance stays on the card.\n\n${store.name}`,
    });
  }
  return card;
}

export async function setGiftCardDisabled(projectId: string, id: string, disabled: boolean) {
  const r = await db.update(schema.storeGiftCards).set({ disabled }).where(and(eq(schema.storeGiftCards.id, id), eq(schema.storeGiftCards.projectId, projectId))).returning();
  if (!r.length) throw notFound("Gift card");
  return r[0];
}
