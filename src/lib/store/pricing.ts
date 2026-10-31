// Order totals: line subtotals, discounts, shipping, tax (inclusive or
// exclusive) and payment fees. Pure and deterministic — used for the cart,
// checkout, order creation and tests.

export type PriceLine = { key: string; unitPrice: number; quantity: number; taxBps: number; weightGrams: number };

export type DiscountRule = { kind: "percent" | "fixed" | "free_shipping"; value: number; minSubtotal: number; code: string };

export type Totals = {
  subtotal: number;
  discount: number;
  shipping: number;
  fee: number;
  tax: number;
  total: number;
  /** Tax per line after discount allocation (for invoices). */
  lineTax: Record<string, number>;
  weightGrams: number;
  taxIncluded: boolean;
};

/**
 * Computes totals. Discounts are allocated across lines in proportion to
 * their value so tax is charged on what the customer actually pays.
 * Shipping is taxed at the store's default rate when `shippingTaxBps` > 0.
 */
export function computeTotals(input: {
  lines: PriceLine[];
  discount?: DiscountRule | null;
  shipping: number;
  fee?: number;
  pricesIncludeTax: boolean;
  shippingTaxBps?: number;
}): Totals {
  const subtotal = input.lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const weightGrams = input.lines.reduce((a, l) => a + l.weightGrams * l.quantity, 0);
  let discount = 0;
  let shipping = Math.max(0, input.shipping);
  const d = input.discount;
  if (d && subtotal >= d.minSubtotal) {
    if (d.kind === "percent") discount = Math.round((subtotal * Math.min(Math.max(d.value, 0), 100)) / 100);
    else if (d.kind === "fixed") discount = Math.min(Math.max(d.value, 0), subtotal);
    else shipping = 0;
  }
  const lineTax: Record<string, number> = {};
  let tax = 0;
  let allocated = 0;
  input.lines.forEach((l, i) => {
    const gross = l.unitPrice * l.quantity;
    // Largest-remainder style: last line takes the rounding difference.
    const share = i === input.lines.length - 1 ? discount - allocated : subtotal ? Math.round((discount * gross) / subtotal) : 0;
    allocated += share;
    const net = Math.max(0, gross - share);
    const t = input.pricesIncludeTax ? net - Math.round(net / (1 + l.taxBps / 10000)) : Math.round((net * l.taxBps) / 10000);
    lineTax[l.key] = t;
    tax += t;
  });
  const sBps = input.shippingTaxBps ?? 0;
  const shippingTax = input.pricesIncludeTax ? shipping - Math.round(shipping / (1 + sBps / 10000)) : Math.round((shipping * sBps) / 10000);
  tax += shippingTax;
  const fee = Math.max(0, input.fee ?? 0);
  const total = subtotal - discount + shipping + fee + (input.pricesIncludeTax ? 0 : tax);
  return { subtotal, discount, shipping, fee, tax, total, lineTax, weightGrams, taxIncluded: input.pricesIncludeTax };
}

/** India GST split: intra-state = CGST + SGST, inter-state = IGST. */
export function gstSplit(tax: number, storeRegion: string, shipRegion: string) {
  const same = !!storeRegion && storeRegion.trim().toLowerCase() === shipRegion.trim().toLowerCase();
  if (!same) return [{ name: "IGST", amount: tax }];
  const half = Math.floor(tax / 2);
  return [
    { name: "CGST", amount: half },
    { name: "SGST", amount: tax - half },
  ];
}
