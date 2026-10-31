// The one definition of a valid product, used by the product editor and by
// every import path, so anything imported can always be edited and saved.
import { z } from "zod";

export const PRODUCT_LIMITS = { title: 160, sku: 60, barcode: 48 };
export const HSN_RE = /^(\d{4}|\d{6}|\d{8})?$/;

export const variantSchema = z.object({
  id: z.uuid().optional(),
  options: z.record(z.string().max(40), z.string().max(60)),
  sku: z.string().trim().max(PRODUCT_LIMITS.sku).optional(),
  barcode: z.string().trim().max(PRODUCT_LIMITS.barcode).regex(/^[\x21-\x7e]*$/, "Barcodes use letters, digits and symbols, without spaces").optional(),
  price: z.number().int().min(0).max(1_000_000_000),
  compareAt: z.number().int().min(0).nullable().optional(),
  cost: z.number().int().min(0).nullable().optional(),
  trackInventory: z.boolean().optional(),
  stock: z.number().int().min(-100000).max(10_000_000).optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
});

export const productSchema = z.object({
  title: z.string().trim().min(1).max(PRODUCT_LIMITS.title),
  slug: z.string().trim().max(80).optional(),
  description: z.string().max(20000).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  images: z.array(z.string().max(2000)).max(20).optional(),
  options: z.array(z.object({ name: z.string().trim().min(1).max(40), values: z.array(z.string().trim().min(1).max(60)).min(1).max(50) })).max(3).optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  vendor: z.string().trim().max(80).optional(),
  taxBps: z.number().int().min(0).max(10000).nullable().optional(),
  featured: z.boolean().optional(),
  seoTitle: z.string().max(120).optional(),
  seoDescription: z.string().max(320).optional(),
  hsn: z.string().trim().regex(HSN_RE, "HSN/SAC codes have 4, 6 or 8 digits").optional(),
  kind: z.enum(["physical", "digital", "membership"]).optional(),
  digitalFileId: z.uuid().nullable().optional(),
  membershipDays: z.number().int().min(1).max(3650).nullable().optional(),
  subscriptionInterval: z.enum(["week", "month", "year"]).nullable().optional(),
  subscriptionIntervalCount: z.number().int().min(1).max(52).optional(),
  collectionIds: z.array(z.uuid()).max(50).optional(),
  variants: z.array(variantSchema).min(1).max(100),
  // Only clearing is allowed: an owner confirms a sample product is real.
  isSample: z.literal(false).optional(),
});

