import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { decryptSecret, encryptSecret, secretHint } from "../security/secrets";
import { appUrl } from "../services/mail";
import { validateGstin } from "@/lib/store/gst";
import { ensureStore, type Exec } from "./catalog";
import { inferMode, paypal, providerInfo, PROVIDERS, razorpay, stripe, type Creds, type ProviderId } from "./payments";

// ─── Setup ───────────────────────────────────────────────────────────────────

/** Creates a store with sensible defaults: domestic shipping, pickup and cash on delivery. */
export async function setupStore(projectId: string, input: { name: string; currency?: string; country?: string; region?: string; email?: string }, exec?: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const run = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const country = (input.country ?? "IN").toUpperCase();
    const currency = input.currency ?? (country === "IN" ? "INR" : "USD");
    const india = country === "IN";
    const store = await ensureStore(projectId, { name: input.name, currency, country, region: input.region ?? "", email: input.email ?? "", pricesIncludeTax: india, defaultTaxBps: india ? 1800 : 0 }, tx);
    const zones = await tx.select().from(schema.storeShippingZones).where(eq(schema.storeShippingZones.projectId, projectId));
    if (!zones.length) {
      const [z1] = await tx.insert(schema.storeShippingZones).values({ projectId, name: india ? "All of India" : "Domestic", countries: [country], sort: 0 }).returning();
      await tx.insert(schema.storeShippingRates).values([
        { projectId, zoneId: z1.id, name: "Standard delivery", kind: "free_over", amount: india ? 9900 : 799, freeOver: india ? 99900 : 7500, eta: india ? "3–6 business days" : "3–5 business days", codAllowed: true, sort: 0 },
        { projectId, zoneId: z1.id, name: "Express delivery", kind: "flat", amount: india ? 19900 : 1999, eta: india ? "1–2 business days" : "1–2 business days", codAllowed: true, sort: 1 },
        { projectId, zoneId: z1.id, name: "Store pickup", kind: "pickup", amount: 0, eta: "Ready in 1 day", codAllowed: true, sort: 2 },
      ]);
    }
    const providers = await tx.select().from(schema.storePaymentProviders).where(eq(schema.storePaymentProviders.projectId, projectId));
    if (!providers.length && india) {
      await tx.insert(schema.storePaymentProviders).values({ projectId, provider: "cod", enabled: true, status: "connected", settings: { fee: 0, maxOrder: 1000000 } });
    }
    return store;
  };
  return exec ? run(exec) : db.transaction(run);
}

// ─── Shipping ────────────────────────────────────────────────────────────────

export const shippingSchema = z.object({
  zones: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        countries: z.array(z.string().trim().max(3)).min(1).max(250),
        regions: z.array(z.string().trim().max(80)).max(100).default([]),
        postalPrefixes: z.array(z.string().trim().max(12)).max(500).default([]),
        rates: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(80),
              kind: z.enum(["flat", "free_over", "weight", "pickup"]),
              amount: z.number().int().min(0),
              freeOver: z.number().int().min(0).nullable().default(null),
              weightTiers: z.array(z.object({ upToGrams: z.number().int().min(1), amount: z.number().int().min(0) })).max(20).default([]),
              eta: z.string().trim().max(60).default(""),
              codAllowed: z.boolean().default(true),
            }),
          )
          .max(20),
      }),
    )
    .max(50),
});

export async function getShipping(projectId: string) {
  const [zones, rates] = await Promise.all([
    db.select().from(schema.storeShippingZones).where(eq(schema.storeShippingZones.projectId, projectId)).orderBy(asc(schema.storeShippingZones.sort)),
    db.select().from(schema.storeShippingRates).where(eq(schema.storeShippingRates.projectId, projectId)).orderBy(asc(schema.storeShippingRates.sort)),
  ]);
  return { zones: zones.map((z) => ({ ...z, rates: rates.filter((r) => r.zoneId === z.id) })) };
}

/** Replaces the whole shipping setup atomically (the editor saves it as one document). */
export async function saveShipping(projectId: string, input: z.infer<typeof shippingSchema>) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.storeShippingZones).where(eq(schema.storeShippingZones.projectId, projectId));
    for (const [i, z] of input.zones.entries()) {
      const [row] = await tx.insert(schema.storeShippingZones).values({ projectId, name: z.name, countries: z.countries.map((c) => c.toUpperCase()), regions: z.regions, postalPrefixes: z.postalPrefixes, sort: i }).returning();
      if (z.rates.length) await tx.insert(schema.storeShippingRates).values(z.rates.map((r, j) => ({ projectId, zoneId: row.id, ...r, sort: j })));
    }
  });
  return getShipping(projectId);
}

// ─── Taxes ───────────────────────────────────────────────────────────────────

export const taxSchema = z.object({
  pricesIncludeTax: z.boolean(),
  defaultTaxBps: z.number().int().min(0).max(10000),
  taxId: z.string().trim().max(40).default(""),
  rates: z.array(z.object({ country: z.string().trim().length(2), region: z.string().trim().max(80).default(""), rateBps: z.number().int().min(0).max(10000), name: z.string().trim().max(40).default("Tax") })).max(200),
});

export async function getTaxes(projectId: string) {
  const [s] = await db.select({ pricesIncludeTax: schema.stores.pricesIncludeTax, defaultTaxBps: schema.stores.defaultTaxBps, taxId: schema.stores.taxId }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const rates = await db.select().from(schema.storeTaxRates).where(eq(schema.storeTaxRates.projectId, projectId));
  return { ...s, rates };
}

export async function saveTaxes(projectId: string, input: z.infer<typeof taxSchema>) {
  const [store] = await db.select({ country: schema.stores.country }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  if (store?.country === "IN" && input.taxId.trim()) {
    const g = validateGstin(input.taxId);
    if (!g.ok) throw new ApiError("validation_failed", `GSTIN: ${g.reason}`, { taxId: [g.reason] });
    input = { ...input, taxId: g.gstin };
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.stores).set({ pricesIncludeTax: input.pricesIncludeTax, defaultTaxBps: input.defaultTaxBps, taxId: input.taxId, updatedAt: new Date() }).where(eq(schema.stores.projectId, projectId));
    await tx.delete(schema.storeTaxRates).where(eq(schema.storeTaxRates.projectId, projectId));
    if (input.rates.length) await tx.insert(schema.storeTaxRates).values(input.rates.map((r) => ({ projectId, ...r, country: r.country.toUpperCase() })));
  });
  return getTaxes(projectId);
}

// ─── Discounts ───────────────────────────────────────────────────────────────

export const discountSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes and underscores only"),
  kind: z.enum(["percent", "fixed", "free_shipping"]),
  value: z.number().int().min(0),
  minSubtotal: z.number().int().min(0).default(0),
  usageLimit: z.number().int().min(1).nullable().default(null),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  oncePerCustomer: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function listDiscounts(projectId: string) {
  return db.select().from(schema.storeDiscounts).where(eq(schema.storeDiscounts.projectId, projectId)).orderBy(desc(schema.storeDiscounts.createdAt));
}

export async function saveDiscount(projectId: string, input: z.infer<typeof discountSchema>, id?: string) {
  if (input.kind === "percent" && (input.value < 1 || input.value > 100)) throw new ApiError("validation_failed", "Percent discounts are between 1 and 100", { value: ["1–100"] });
  const clash = await db.select({ id: schema.storeDiscounts.id }).from(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.projectId, projectId), sql`lower(${schema.storeDiscounts.code}) = ${input.code.toLowerCase()}`));
  if (clash.some((c) => c.id !== id)) throw new ApiError("conflict", "That code already exists", { code: ["Already exists"] });
  const values = { ...input, code: input.code.toUpperCase(), startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null };
  if (id) {
    const r = await db.update(schema.storeDiscounts).set(values).where(and(eq(schema.storeDiscounts.id, id), eq(schema.storeDiscounts.projectId, projectId))).returning();
    if (!r.length) throw notFound("Discount");
    return r[0];
  }
  const [d] = await db.insert(schema.storeDiscounts).values({ projectId, ...values }).returning();
  return d;
}

export async function deleteDiscount(projectId: string, id: string) {
  const r = await db.delete(schema.storeDiscounts).where(and(eq(schema.storeDiscounts.id, id), eq(schema.storeDiscounts.projectId, projectId))).returning({ id: schema.storeDiscounts.id });
  if (!r.length) throw notFound("Discount");
}

// ─── Payment providers ───────────────────────────────────────────────────────

export async function listPaymentProviders(projectId: string) {
  const rows = await db.select().from(schema.storePaymentProviders).where(eq(schema.storePaymentProviders.projectId, projectId));
  return PROVIDERS.map((info) => {
    const r = rows.find((x) => x.provider === info.id);
    let hints: Record<string, string> = {};
    if (r?.secrets) {
      try {
        const c = JSON.parse(decryptSecret(r.secrets)) as Creds;
        hints = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, info.fields.find((f) => f.key === k)?.secret ? secretHint(v) : v]));
      } catch {
        hints = {};
      }
    }
    return {
      ...info,
      enabled: r?.enabled ?? false,
      mode: r?.mode ?? "test",
      status: r?.status ?? "not_connected",
      lastError: r?.lastError ?? null,
      settings: r?.settings ?? {},
      credentialHints: hints,
      webhookUrl: info.online ? appUrl(`/api/v1/store/${projectId}/webhooks/${info.id}`) : null,
    };
  });
}

export const providerUpdateSchema = z.object({
  enabled: z.boolean(),
  credentials: z.record(z.string(), z.string().trim().max(500)).optional(),
  mode: z.enum(["test", "live"]).optional(),
  settings: z
    .object({ fee: z.number().int().min(0).optional(), maxOrder: z.number().int().min(0).optional(), label: z.string().max(60).optional(), upiId: z.string().max(80).optional(), instructions: z.string().max(1000).optional() })
    .optional(),
});

async function testProvider(id: ProviderId, c: Creds, mode: string) {
  if (id === "stripe") await stripe.test(c);
  else if (id === "razorpay") await razorpay.test(c);
  else if (id === "paypal") await paypal.test(c, mode);
}

/** Saves provider settings. Online credentials are verified with the provider before they are stored. */
export async function saveProvider(projectId: string, id: ProviderId, input: z.infer<typeof providerUpdateSchema>, exec: Exec = db) {
  const info = providerInfo(id);
  if (!info) throw notFound("Provider");
  const [existing] = await exec.select().from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.provider, id)));
  let secrets = existing?.secrets ?? null;
  let status = existing?.status ?? "not_connected";
  let mode = input.mode ?? existing?.mode ?? "test";
  let lastError: string | null = existing?.lastError ?? null;
  if (info.online && input.credentials) {
    const prev = existing?.secrets ? (JSON.parse(decryptSecret(existing.secrets)) as Creds) : {};
    // Blank secret fields keep the stored value (they are never sent back to the browser).
    const merged: Creds = { ...prev, ...Object.fromEntries(Object.entries(input.credentials).filter(([, v]) => v !== "")) };
    for (const f of info.fields.filter((x) => !x.help)) if (!merged[f.key]) throw new ApiError("validation_failed", `${f.label} is required`, { [f.key]: ["Required"] });
    mode = inferMode(id, merged, mode);
    try {
      await testProvider(id, merged, mode);
      status = "connected";
      lastError = null;
    } catch (e) {
      throw new ApiError("validation_failed", `Could not connect: ${(e as Error).message}`, { credentials: [(e as Error).message] });
    }
    secrets = encryptSecret(JSON.stringify(merged));
  }
  if (!info.online) status = "connected";
  if (info.online && input.enabled && status !== "connected") throw new ApiError("conflict", "Connect the provider before enabling it");
  if (id === "manual" && input.enabled && !(input.settings?.upiId || input.settings?.instructions || (existing?.settings as { upiId?: string; instructions?: string })?.upiId)) {
    throw new ApiError("validation_failed", "Add a UPI ID or payment instructions", { settings: ["Required"] });
  }
  const settings = { ...((existing?.settings as object) ?? {}), ...(input.settings ?? {}) };
  const values = { enabled: input.enabled, secrets, status, mode, lastError, settings, updatedAt: new Date() };
  if (existing) await exec.update(schema.storePaymentProviders).set(values).where(eq(schema.storePaymentProviders.id, existing.id));
  else await exec.insert(schema.storePaymentProviders).values({ projectId, provider: id, ...values });
}

export async function retestProvider(projectId: string, id: ProviderId) {
  const [p] = await db.select().from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, projectId), eq(schema.storePaymentProviders.provider, id)));
  if (!p?.secrets) throw new ApiError("conflict", "Nothing to test yet");
  try {
    await testProvider(id, JSON.parse(decryptSecret(p.secrets)), p.mode);
    await db.update(schema.storePaymentProviders).set({ status: "connected", lastError: null }).where(eq(schema.storePaymentProviders.id, p.id));
    return { ok: true as const };
  } catch (e) {
    await db.update(schema.storePaymentProviders).set({ status: "error", lastError: (e as Error).message }).where(eq(schema.storePaymentProviders.id, p.id));
    return { ok: false as const, error: (e as Error).message };
  }
}
