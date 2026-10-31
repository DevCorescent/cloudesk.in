import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { audit } from "../services/audit";
import type { Tx } from "../services/orgs";

export type Exec = typeof db | Tx;

import { slugifyTitle as slugify } from "@/lib/store/templates";
import { contains } from "../security/like";

export { slugify };

// ─── Store ───────────────────────────────────────────────────────────────────

export type StoreRow = typeof schema.stores.$inferSelect;
export type Policies = { refund?: string; shipping?: string; privacy?: string; terms?: string };
export type CheckoutSettings = { requirePhone?: boolean; orderNotes?: boolean; termsRequired?: boolean; showTrustBadges?: boolean; announcement?: string; returnDays?: number };

export async function getStore(projectId: string, exec: Exec = db): Promise<StoreRow | null> {
  const [s] = await exec.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  return s ?? null;
}

export async function ensureStore(projectId: string, defaults: Partial<typeof schema.stores.$inferInsert> & { name: string }, exec: Exec = db) {
  const existing = await getStore(projectId, exec);
  if (existing) return existing;
  const [s] = await exec
    .insert(schema.stores)
    .values({
      projectId,
      policies: defaultPolicies(defaults.name),
      checkout: { requirePhone: true, orderNotes: true, termsRequired: false, showTrustBadges: true },
      ...defaults,
    })
    .returning();
  return s;
}

export function defaultPolicies(name: string): Policies {
  return {
    shipping: `[Edit this policy] ${name} ships orders within 1–2 business days. Delivery usually takes 3–7 business days depending on your location. You will receive tracking details by email once your order ships.`,
    refund: `[Edit this policy] If you are not happy with your purchase, contact us within 7 days of delivery. Items must be unused and in original packaging. Refunds are issued to the original payment method within 5–7 business days of receiving the return.`,
    privacy: `[Edit this policy] ${name} collects only the information needed to process and deliver your order (name, contact details and address). We do not sell your data. Payments are processed securely by our payment provider; we never see or store your card details.`,
    terms: `[Edit this policy] By placing an order with ${name} you agree to pay the total shown at checkout. Prices and availability may change without notice.`,
  };
}

// ─── Products ────────────────────────────────────────────────────────────────

export type VariantInput = {
  id?: string;
  title?: string;
  options: Record<string, string>;
  sku?: string;
  /** Left unchanged when undefined. */
  barcode?: string;
  price: number;
  compareAt?: number | null;
  cost?: number | null;
  trackInventory?: boolean;
  stock?: number;
  weightGrams?: number;
};

export type ProductInput = {
  title: string;
  slug?: string;
  description?: string;
  status?: "draft" | "active" | "archived";
  images?: string[];
  options?: { name: string; values: string[] }[];
  tags?: string[];
  vendor?: string;
  taxBps?: number | null;
  featured?: boolean;
  seoTitle?: string;
  seoDescription?: string;
  hsn?: string;
  kind?: "physical" | "digital" | "membership";
  digitalFileId?: string | null;
  membershipDays?: number | null;
  /** Makes this a subscription product. */
  subscriptionInterval?: "week" | "month" | "year" | null;
  subscriptionIntervalCount?: number;
  collectionIds?: string[];
  variants: VariantInput[];
  isSample?: boolean;
};

async function uniqueProductSlug(projectId: string, base: string, exceptId: string | undefined, exec: Exec) {
  const rows = await exec.select({ slug: schema.storeProducts.slug, id: schema.storeProducts.id }).from(schema.storeProducts).where(and(eq(schema.storeProducts.projectId, projectId), sql`${schema.storeProducts.slug} ~ ${`^${base}(-[0-9]+)?$`}`));
  const taken = new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

const variantTitle = (opts: Record<string, string>) => Object.values(opts).filter(Boolean).join(" / ") || "Default";

/** Creates or updates a product with its variants in one transaction. */
export async function saveProduct(projectId: string, userId: string | null, input: ProductInput, productId?: string, exec?: Tx) {
  if (!input.variants.length) throw new ApiError("validation_failed", "A product needs at least one variant", { variants: ["Required"] });
  if (input.variants.some((v) => !Number.isInteger(v.price) || v.price < 0)) throw new ApiError("validation_failed", "Prices must be zero or more", { variants: ["Invalid price"] });
  // Barcodes are unique per store: check up front for a clear message.
  const codes = input.variants.map((v) => (v.barcode ?? "").trim()).filter(Boolean);
  if (new Set(codes).size < codes.length) throw new ApiError("validation_failed", "Two variants have the same barcode", { variants: ["Duplicate barcode"] });
  const run = async (tx: Tx) => {
    if (codes.length) {
      const ids = input.variants.map((v) => v.id).filter((x): x is string => !!x);
      const clash = await tx
        .select({ barcode: schema.storeVariants.barcode, title: schema.storeProducts.title })
        .from(schema.storeVariants)
        .innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeVariants.productId))
        .where(and(eq(schema.storeVariants.projectId, projectId), inArray(schema.storeVariants.barcode, codes), ids.length ? sql`${schema.storeVariants.id} not in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})` : undefined));
      if (clash.length) throw new ApiError("conflict", `Barcode ${clash[0].barcode} is already used by “${clash[0].title}”`, { variants: ["Barcode in use"] });
    }
    if (input.kind === "digital" && input.digitalFileId) {
      const [f] = await tx.select({ id: schema.storeDigitalFiles.id }).from(schema.storeDigitalFiles).where(and(eq(schema.storeDigitalFiles.id, input.digitalFileId), eq(schema.storeDigitalFiles.projectId, projectId)));
      if (!f) throw new ApiError("validation_failed", "Choose a file from this store", { digitalFileId: ["Unknown file"] });
    }
    const slug = await uniqueProductSlug(projectId, slugify(input.slug || input.title), productId, tx);
    const values = {
      title: input.title.trim(),
      slug,
      description: input.description ?? "",
      status: input.status ?? "draft",
      images: input.images ?? [],
      options: input.options ?? [],
      tags: input.tags ?? [],
      vendor: input.vendor ?? "",
      taxBps: input.taxBps ?? null,
      featured: input.featured ?? false,
      seoTitle: input.seoTitle ?? "",
      seoDescription: input.seoDescription ?? "",
      hsn: (input.hsn ?? "").trim(),
      kind: input.kind ?? "physical",
      digitalFileId: input.kind === "digital" ? (input.digitalFileId ?? null) : null,
      membershipDays: input.kind === "membership" ? (input.membershipDays ?? null) : null,
      subscriptionInterval: input.subscriptionInterval ?? null,
      subscriptionIntervalCount: Math.min(Math.max(input.subscriptionIntervalCount ?? 1, 1), 52),
      updatedAt: new Date(),
      ...(input.isSample !== undefined ? { isSample: input.isSample } : {}),
    };
    let id = productId;
    if (id) {
      const r = await tx.update(schema.storeProducts).set(values).where(and(eq(schema.storeProducts.id, id), eq(schema.storeProducts.projectId, projectId))).returning({ id: schema.storeProducts.id });
      if (!r.length) throw notFound("Product");
    } else {
      [{ id }] = await tx.insert(schema.storeProducts).values({ projectId, ...values }).returning({ id: schema.storeProducts.id });
    }
    // Variants: update by id, insert new, delete removed.
    const existing = await tx.select().from(schema.storeVariants).where(eq(schema.storeVariants.productId, id!));
    const keep = new Set(input.variants.map((v) => v.id).filter(Boolean));
    const removed = existing.filter((v) => !keep.has(v.id)).map((v) => v.id);
    if (removed.length) await tx.delete(schema.storeVariants).where(inArray(schema.storeVariants.id, removed));
    for (const [i, v] of input.variants.entries()) {
      const row = {
        title: v.title || variantTitle(v.options),
        options: v.options,
        sku: (v.sku ?? "").trim(),
        ...(v.barcode !== undefined ? { barcode: v.barcode.trim() } : {}),
        price: v.price,
        compareAt: v.compareAt ?? null,
        cost: v.cost ?? null,
        trackInventory: v.trackInventory ?? true,
        weightGrams: Math.max(0, v.weightGrams ?? 0),
        position: i,
      };
      const prev = v.id ? existing.find((e) => e.id === v.id) : undefined;
      if (prev) {
        await tx.update(schema.storeVariants).set(row).where(eq(schema.storeVariants.id, prev.id));
        if (v.stock !== undefined && v.stock !== prev.stock) await adjustStock(projectId, prev.id, v.stock - prev.stock, "Manual edit", userId, null, tx);
      } else {
        const [nv] = await tx.insert(schema.storeVariants).values({ projectId, productId: id!, ...row, stock: 0 }).returning({ id: schema.storeVariants.id });
        if (v.stock) await adjustStock(projectId, nv.id, v.stock, "Initial stock", userId, null, tx);
      }
    }
    if (input.collectionIds) {
      await tx.delete(schema.storeProductCollections).where(eq(schema.storeProductCollections.productId, id!));
      const valid = input.collectionIds.length ? await tx.select({ id: schema.storeCollections.id }).from(schema.storeCollections).where(and(eq(schema.storeCollections.projectId, projectId), inArray(schema.storeCollections.id, input.collectionIds))) : [];
      if (valid.length) await tx.insert(schema.storeProductCollections).values(valid.map((c) => ({ productId: id!, collectionId: c.id })));
    }
    return id!;
  };
  return exec ? run(exec) : db.transaction(run);
}

export async function adjustStock(projectId: string, variantId: string, delta: number, reason: string, actorId: string | null, ref: string | null, exec: Exec = db) {
  if (!delta) return;
  // Restocking re-arms the low-stock alert for this variant.
  await exec.update(schema.storeVariants).set({ stock: sql`${schema.storeVariants.stock} + ${delta}`, ...(delta > 0 ? { lowStockNotifiedAt: null } : {}) }).where(and(eq(schema.storeVariants.id, variantId), eq(schema.storeVariants.projectId, projectId)));
  await exec.insert(schema.storeInventoryLog).values({ projectId, variantId, delta, reason, ref, actorId });
}

export type ProductWithVariants = typeof schema.storeProducts.$inferSelect & {
  variants: (typeof schema.storeVariants.$inferSelect)[];
  collectionIds: string[];
};

export async function loadProducts(projectId: string, where?: { ids?: string[]; status?: "draft" | "active" | "archived"; q?: string; collectionId?: string }, exec: Exec = db): Promise<ProductWithVariants[]> {
  const conds = [eq(schema.storeProducts.projectId, projectId)];
  if (where?.ids) conds.push(where.ids.length ? inArray(schema.storeProducts.id, where.ids) : sql`false`);
  if (where?.status) conds.push(eq(schema.storeProducts.status, where.status));
  if (where?.q) conds.push(or(ilike(schema.storeProducts.title, contains(where.q)), sql`${where.q} = any(${schema.storeProducts.tags})`)!);
  if (where?.collectionId) conds.push(sql`exists (select 1 from store_product_collections pc where pc.product_id = ${sql.raw('"store_products"."id"')} and pc.collection_id = ${where.collectionId})`);
  const products = await exec.select().from(schema.storeProducts).where(and(...conds)).orderBy(desc(schema.storeProducts.featured), desc(schema.storeProducts.createdAt));
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const [variants, links] = await Promise.all([
    exec.select().from(schema.storeVariants).where(inArray(schema.storeVariants.productId, ids)).orderBy(asc(schema.storeVariants.position)),
    exec.select().from(schema.storeProductCollections).where(inArray(schema.storeProductCollections.productId, ids)),
  ]);
  return products.map((p) => ({ ...p, variants: variants.filter((v) => v.productId === p.id), collectionIds: links.filter((l) => l.productId === p.id).map((l) => l.collectionId) }));
}

export async function getProduct(projectId: string, productId: string) {
  const [p] = await loadProducts(projectId, { ids: [productId] });
  if (!p) throw notFound("Product");
  return p;
}

export async function deleteProduct(projectId: string, productId: string, userId: string, orgId: string) {
  // Products with orders are archived so order history keeps its references.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeOrderItems).where(eq(schema.storeOrderItems.productId, productId));
  if (n > 0) {
    await db.update(schema.storeProducts).set({ status: "archived" }).where(and(eq(schema.storeProducts.id, productId), eq(schema.storeProducts.projectId, projectId)));
  } else {
    const r = await db.delete(schema.storeProducts).where(and(eq(schema.storeProducts.id, productId), eq(schema.storeProducts.projectId, projectId))).returning({ id: schema.storeProducts.id });
    if (!r.length) throw notFound("Product");
  }
  await audit({ orgId, actorId: userId, action: n > 0 ? "store.product_archived" : "store.product_deleted", targetType: "product", targetId: productId });
  return { archived: n > 0 };
}

// ─── Collections ─────────────────────────────────────────────────────────────

export async function listCollections(projectId: string, exec: Exec = db) {
  const rows = await exec
    .select({
      id: schema.storeCollections.id,
      title: schema.storeCollections.title,
      slug: schema.storeCollections.slug,
      description: schema.storeCollections.description,
      image: schema.storeCollections.image,
      sort: schema.storeCollections.sort,
      productCount: sql<number>`(select count(*)::int from store_product_collections pc join store_products p on p.id = pc.product_id where pc.collection_id = ${sql.raw('"store_collections"."id"')} and p.status = 'active')`,
    })
    .from(schema.storeCollections)
    .where(eq(schema.storeCollections.projectId, projectId))
    .orderBy(asc(schema.storeCollections.sort), asc(schema.storeCollections.title));
  return rows;
}

export async function saveCollection(projectId: string, input: { title: string; slug?: string; description?: string; image?: string; sort?: number }, id?: string, exec: Exec = db) {
  const slug = slugify(input.slug || input.title);
  const clash = await exec.select({ id: schema.storeCollections.id }).from(schema.storeCollections).where(and(eq(schema.storeCollections.projectId, projectId), eq(schema.storeCollections.slug, slug)));
  if (clash.some((c) => c.id !== id)) throw new ApiError("conflict", `A collection with the address /shop/${slug} already exists`);
  const values = { title: input.title.trim(), slug, description: input.description ?? "", image: input.image ?? "", sort: input.sort ?? 0 };
  if (id) {
    const r = await exec.update(schema.storeCollections).set(values).where(and(eq(schema.storeCollections.id, id), eq(schema.storeCollections.projectId, projectId))).returning();
    if (!r.length) throw notFound("Collection");
    return r[0];
  }
  const [c] = await exec.insert(schema.storeCollections).values({ projectId, ...values }).returning();
  return c;
}

export async function deleteCollection(projectId: string, id: string) {
  const r = await db.delete(schema.storeCollections).where(and(eq(schema.storeCollections.id, id), eq(schema.storeCollections.projectId, projectId))).returning({ id: schema.storeCollections.id });
  if (!r.length) throw notFound("Collection");
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const CSV_HEAD = ["handle", "title", "status", "description", "vendor", "tags", "image_urls", "option1_name", "option1_value", "option2_name", "option2_value", "sku", "price", "compare_at", "cost", "stock", "weight_grams"];

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exportCsv(projectId: string, digits: number) {
  const products = await loadProducts(projectId);
  const fmt = (n: number | null) => (n === null ? "" : (n / 10 ** digits).toFixed(digits));
  const rows = [CSV_HEAD.join(",")];
  for (const p of products) {
    for (const [i, v] of p.variants.entries()) {
      const opts = Object.entries(v.options as Record<string, string>);
      rows.push(
        [p.slug, i === 0 ? p.title : "", i === 0 ? p.status : "", i === 0 ? p.description : "", i === 0 ? p.vendor : "", i === 0 ? p.tags.join("|") : "", i === 0 ? (p.images as string[]).join("|") : "", opts[0]?.[0] ?? "", opts[0]?.[1] ?? "", opts[1]?.[0] ?? "", opts[1]?.[1] ?? "", v.sku, fmt(v.price), fmt(v.compareAt), fmt(v.cost), v.stock, v.weightGrams]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return rows.join("\n") + "\n";
}

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

/** Imports products from CSV (same columns as export). Rows sharing a handle become variants. */
export async function importCsv(projectId: string, userId: string, text: string, digits: number) {
  const rows = parseCsv(text);
  const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (r: string[], name: string) => (head.indexOf(name) >= 0 ? (r[head.indexOf(name)] ?? "").trim() : "");
  if (!head.includes("title") && !head.includes("handle")) throw new ApiError("validation_failed", "The CSV needs at least a handle or title column");
  const money = (s: string) => (s === "" ? null : Math.round(Number(s.replace(/[^\d.]/g, "")) * 10 ** digits));
  const groups = new Map<string, string[][]>();
  for (const r of rows) {
    const key = col(r, "handle") || slugify(col(r, "title"));
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  if (groups.size > 2000) throw new ApiError("validation_failed", "Import up to 2,000 products at a time");
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const [handle, group] of groups) {
    const first = group[0];
    const optNames = [col(first, "option1_name"), col(first, "option2_name")].filter(Boolean);
    const variants: VariantInput[] = group.map((r) => {
      const options: Record<string, string> = {};
      if (col(r, "option1_name") || optNames[0]) options[col(r, "option1_name") || optNames[0]] = col(r, "option1_value");
      if (col(r, "option2_name") || optNames[1]) options[col(r, "option2_name") || optNames[1]] = col(r, "option2_value");
      return { options, sku: col(r, "sku"), price: money(col(r, "price")) ?? 0, compareAt: money(col(r, "compare_at")), cost: money(col(r, "cost")), stock: Number(col(r, "stock")) || 0, weightGrams: Number(col(r, "weight_grams")) || 0 };
    });
    const options = optNames.map((name) => ({ name, values: [...new Set(variants.map((v) => v.options[name]).filter(Boolean))] }));
    try {
      const [existing] = await db.select({ id: schema.storeProducts.id }).from(schema.storeProducts).where(and(eq(schema.storeProducts.projectId, projectId), eq(schema.storeProducts.slug, handle)));
      const prev = existing ? await getProduct(projectId, existing.id) : null;
      if (prev) variants.forEach((v) => (v.id = prev.variants.find((pv) => JSON.stringify(pv.options) === JSON.stringify(v.options))?.id));
      const status = col(first, "status") as ProductInput["status"];
      await saveProduct(
        projectId,
        userId,
        {
          title: col(first, "title") || prev?.title || handle,
          slug: handle,
          description: col(first, "description") || prev?.description,
          status: ["draft", "active", "archived"].includes(status ?? "") ? status : (prev?.status ?? "draft"),
          vendor: col(first, "vendor"),
          tags: col(first, "tags").split("|").map((t) => t.trim()).filter(Boolean),
          images: col(first, "image_urls").split("|").map((t) => t.trim()).filter((u) => /^https:\/\/|^\/assets\//.test(u)),
          options,
          variants,
        },
        prev?.id,
      );
      if (prev) updated++;
      else created++;
    } catch (e) {
      errors.push(`${handle}: ${(e as Error).message}`);
    }
  }
  return { created, updated, errors: errors.slice(0, 50) };
}
