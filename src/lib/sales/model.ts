// Sales: orders from customers, price lists and customer terms, delivery
// challans, returns, commissions and targets. Shapes and the arithmetic shared
// by the server and the screens. Money is in paise; quantities have up to
// three decimals.
import { z } from "zod";

export const q3 = (n: number) => Math.round(n * 1000) / 1000;
const money = z.number().int("Use whole paise").min(0).max(1e12);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const uuid = z.uuid();
const text = (n: number) => z.string().trim().max(n).default("");

export const ORDER_STATUSES = ["draft", "pending_approval", "confirmed", "partial", "delivered", "closed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { draft: "Draft", pending_approval: "Waiting for approval", confirmed: "Confirmed", partial: "Part delivered", delivered: "Delivered", closed: "Closed", cancelled: "Cancelled" };

export const settingsSchema = z.object({
  orderPrefix: z.string().trim().max(8).default("SO-"),
  challanPrefix: z.string().trim().max(8).default("DC-"),
  returnPrefix: z.string().trim().max(8).default("SR-"),
  /** A line discount above this needs approval (0 = never). */
  maxDiscountPct: z.number().min(0).max(100).default(10),
  /** Over a customer's credit limit: refuse, ask for approval, or only warn. */
  creditCheck: z.enum(["block", "approve", "warn"]).default("approve"),
  /** Invoice what's been delivered, or what's been ordered (services, advance billing). */
  invoiceOn: z.enum(["delivery", "order"]).default("delivery"),
  defaultWarehouseId: uuid.nullable().default(null),
  /** The invoicing books orders are invoiced in, when there's more than one. */
  defaultOwnerId: uuid.nullable().default(null),
});
export type SalesSettings = z.infer<typeof settingsSchema>;

export const priceListSchema = z.object({
  name: z.string().trim().min(1, "Name the price list").max(80),
  /** Fixed prices per item, or a discount off the default list. */
  kind: z.enum(["fixed", "discount"]).default("fixed"),
  discountPct: z.number().min(0).max(100).default(0),
  validFrom: day.nullable().default(null),
  validTo: day.nullable().default(null),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: text(500),
});
export const priceItemSchema = z.object({ itemId: uuid, price: money, minQty: z.number().min(0).max(1e9).transform(q3).default(0) });

export const customerSchema = z.object({
  ownerId: uuid,
  clientId: uuid,
  priceListId: uuid.nullable().default(null),
  /** 0 means no limit. */
  creditLimit: money.default(0),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  discountPct: z.number().min(0).max(100).default(0),
  salespersonId: uuid.nullable().default(null),
  onHold: z.boolean().default(false),
  notes: text(1000),
});

export const lineSchema = z.object({
  id: z.string().min(1).max(40),
  itemId: uuid.nullable().default(null),
  name: z.string().trim().min(1, "Every line needs a name").max(300),
  hsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, "HSN/SAC codes have 4, 6 or 8 digits").default(""),
  unit: text(20),
  qty: z.number().gt(0, "Enter a quantity").max(1e9).transform(q3),
  rate: money,
  /** The price the list gave, so a discount from it is visible. */
  listRate: money.default(0),
  discountPct: z.number().min(0).max(100).default(0),
  taxBps: z.number().int().min(0).max(10_000).default(1800),
});
export type OrderLine = z.infer<typeof lineSchema> & { delivered?: number; invoiced?: number; returned?: number };

export const orderSchema = z.object({
  ownerId: uuid,
  clientId: uuid,
  date: day,
  expectedDate: day.nullable().default(null),
  warehouseId: uuid.nullable().default(null),
  salespersonId: uuid.nullable().default(null),
  priceListId: uuid.nullable().default(null),
  placeOfSupply: text(80),
  reference: text(80),
  dealId: uuid.nullable().default(null),
  lines: z.array(lineSchema).min(1, "Add at least one line").max(300),
  notes: text(2000),
});

export const deliverySchema = z.object({
  orderId: uuid,
  date: day,
  warehouseId: uuid.nullable().default(null),
  lines: z.array(z.object({ lineId: z.string().min(1), qty: z.number().gt(0).max(1e9).transform(q3), batch: text(40), binId: uuid.nullable().default(null), serials: z.array(z.string().trim().min(1).max(80)).max(10000).default([]) })).min(1, "Deliver at least one line").max(300),
  vehicleNo: text(20),
  transporter: text(100),
  notes: text(500),
});

export const RETURN_REASONS = { damaged: "Damaged", wrong: "Wrong item", quality: "Quality problem", excess: "Sent too many", other: "Other" } as const;
export const returnSchema = z.object({
  orderId: uuid,
  date: day,
  warehouseId: uuid.nullable().default(null),
  lines: z.array(z.object({ lineId: z.string().min(1), qty: z.number().gt(0).max(1e9).transform(q3), reason: z.enum(Object.keys(RETURN_REASONS) as [keyof typeof RETURN_REASONS]).default("other"), restock: z.boolean().default(true), serials: z.array(z.string().trim().min(1).max(80)).max(10000).default([]) })).min(1, "Return at least one line").max(300),
  /** Make a credit note for what was invoiced. */
  creditNote: z.boolean().default(true),
  notes: text(500),
});

export const planSchema = z.object({
  name: z.string().trim().min(1, "Name the plan").max(80),
  /** One salesperson, or everyone without a plan of their own. */
  userId: uuid.nullable().default(null),
  ratePct: z.number().min(0).max(100),
  /** Commission on what's invoiced, or only once it's paid. */
  basis: z.enum(["invoiced", "collected"]).default("invoiced"),
  active: z.boolean().default(true),
});
export const targetSchema = z.object({ userId: uuid, month: z.string().regex(/^\d{4}-\d{2}$/, "Use a month"), amount: money });

/** A line's value before tax, after its discount. */
export const lineNet = (l: { qty: number; rate: number; discountPct: number }) => Math.round(l.qty * l.rate * (1 - l.discountPct / 100));

/** An order's totals: before discount, discount, before tax, tax (estimated per line; the invoice is exact) and total. */
export function orderTotals(lines: { qty: number; rate: number; discountPct: number; taxBps: number }[]) {
  let gross = 0;
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    const g = Math.round(l.qty * l.rate);
    const n = lineNet(l);
    gross += g;
    net += n;
    tax += Math.round((n * l.taxBps) / 10_000);
  }
  return { gross, discount: gross - net, subtotal: net, tax, total: net + tax };
}

/** The value of what's still to invoice on an order (for credit exposure). */
export const openValue = (lines: OrderLine[]) => orderTotals(lines.map((l) => ({ ...l, qty: Math.max(0, q3(l.qty - (l.invoiced ?? 0))) }))).total;

type PriceList = { id: string; kind: "fixed" | "discount" | string; discountPct: number; validFrom: string | null; validTo: string | null; active: boolean; isDefault: boolean };
type PriceItem = { listId: string; itemId: string; price: number; minQty: number };

/**
 * The price for an item: the customer's list if it's in force (fixed prices
 * take the best tier the quantity reaches; a discount list takes its
 * percentage off the default list), otherwise the default list.
 */
export function priceFor(itemId: string, qty: number, day: string, lists: PriceList[], items: PriceItem[], customerListId: string | null) {
  const inForce = (l: PriceList) => l.active && (!l.validFrom || l.validFrom <= day) && (!l.validTo || l.validTo >= day);
  const tier = (listId: string) => items.filter((i) => i.listId === listId && i.itemId === itemId && i.minQty <= qty).sort((a, b) => b.minQty - a.minQty)[0];
  const def = lists.find((l) => l.isDefault && inForce(l));
  const base = def ? tier(def.id)?.price ?? null : null;
  const own = customerListId ? lists.find((l) => l.id === customerListId && inForce(l)) : undefined;
  if (own?.kind === "fixed") {
    const t = tier(own.id);
    if (t) return { price: t.price, listPrice: base ?? t.price, from: "customer" as const };
  }
  if (own?.kind === "discount" && base !== null) return { price: Math.round(base * (1 - own.discountPct / 100)), listPrice: base, from: "customer" as const };
  if (base !== null) return { price: base, listPrice: base, from: "default" as const };
  return null;
}

/** Whether taking on `adding` breaks the limit, given what's owed and on order. */
export function creditCheck(limit: number, owed: number, onOrder: number, adding: number) {
  const exposure = owed + onOrder + adding;
  return { limit, owed, onOrder, adding, exposure, over: limit > 0 && exposure > limit, headroom: limit > 0 ? limit - owed - onOrder : null };
}

/** Why an order needs approval, if it does. */
export function approvalReasons(lines: { discountPct: number; name: string }[], maxDiscountPct: number, credit: { over: boolean; exposure: number; limit: number } | null, creditMode: SalesSettings["creditCheck"]) {
  const out: string[] = [];
  const big = lines.filter((l) => maxDiscountPct > 0 && l.discountPct > maxDiscountPct);
  if (big.length) out.push(`Discount over ${maxDiscountPct}% on ${big.map((l) => l.name).slice(0, 3).join(", ")}${big.length > 3 ? "…" : ""}`);
  if (credit?.over && creditMode === "approve") out.push(`Over the credit limit (₹${Math.round(credit.exposure / 100).toLocaleString("en-IN")} against ₹${Math.round(credit.limit / 100).toLocaleString("en-IN")})`);
  return out;
}

/** An order's status from its lines' delivery. */
export function statusFrom(lines: OrderLine[], current: OrderStatus): OrderStatus {
  if (["draft", "pending_approval", "cancelled", "closed"].includes(current)) return current;
  const goods = lines.filter((l) => l.itemId);
  if (!goods.length) return "confirmed";
  const all = goods.every((l) => (l.delivered ?? 0) >= l.qty - 0.0005);
  const some = goods.some((l) => (l.delivered ?? 0) > 0);
  return all ? "delivered" : some ? "partial" : "confirmed";
}

/** How much of each line can be invoiced now. */
export function toInvoice(lines: OrderLine[], on: SalesSettings["invoiceOn"]) {
  return lines
    .map((l) => {
      // Goods are invoiced as delivered (less returns) unless invoicing on order; services always on order.
      const basis = l.itemId && on === "delivery" ? (l.delivered ?? 0) - (l.returned ?? 0) : l.qty;
      return { line: l, qty: q3(Math.max(0, basis - (l.invoiced ?? 0))) };
    })
    .filter((x) => x.qty > 0);
}

/** Commission for a salesperson on an amount (before tax), by plan. */
export const commissionOn = (amount: number, ratePct: number) => Math.round((amount * ratePct) / 100);
