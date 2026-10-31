// Discount code eligibility. Pure.
export type DiscountRow = {
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  value: number;
  minSubtotal: number;
  usageLimit: number | null;
  usedCount: number;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  active: boolean;
};

export function checkDiscount(d: DiscountRow | null | undefined, subtotal: number, now = new Date()): { ok: true } | { ok: false; reason: string } {
  if (!d || !d.active) return { ok: false, reason: "This code is not valid." };
  if (d.startsAt && new Date(d.startsAt) > now) return { ok: false, reason: "This code is not active yet." };
  if (d.endsAt && new Date(d.endsAt) < now) return { ok: false, reason: "This code has expired." };
  if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return { ok: false, reason: "This code has been fully redeemed." };
  if (subtotal < d.minSubtotal) return { ok: false, reason: "Your order does not meet the minimum for this code yet." };
  return { ok: true };
}
