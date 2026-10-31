// The five-minute launch: one request creates the project with the design the
// owner picked, sets up the store, imports their products, turns on the
// payment methods they chose and publishes — reporting each real step as it
// happens. Nothing is reported done before it is.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { parseSiteDoc, serializeSiteDoc, SITE_DOC_PATH, type SiteDoc } from "@/lib/site/model";
import { planFromBrief } from "@/lib/site/planner";
import { saveCollection, saveProduct } from "../commerce/catalog";
import { HSN_RE, PRODUCT_LIMITS, productSchema } from "../commerce/product-schema";
import { setupStore } from "../commerce/settings";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { uploadAsset } from "../media/assets";
import { createDeployment } from "../services/deployments";
import { addDomain, dnsTarget, TXT_PREFIX } from "../services/domains";
import { listServices, saveService } from "../bookings/bookings";
import { businessKit } from "@/lib/site/business-kit";
import { writeFile } from "../services/files";
import { appUrl } from "../services/mail";
import { createProjectFromSpec } from "../services/projects";

const money = z.number().int().min(0).max(1_000_000_000).nullable();
export const draftProductSchema = z.object({
  title: z.string().trim().max(200),
  description: z.string().max(5000).default(""),
  category: z.string().trim().max(80).default(""),
  tags: z.array(z.string().trim().max(40)).max(30).default([]),
  vendor: z.string().trim().max(80).default(""),
  images: z.array(z.string().max(2000)).max(10).default([]),
  hsn: z.string().max(8).default(""),
  active: z.boolean().default(true),
  options: z.array(z.object({ name: z.string().trim().min(1).max(40), values: z.array(z.string().trim().min(1).max(60)).max(50) })).max(3).default([]),
  variants: z
    .array(z.object({ options: z.record(z.string().max(40), z.string().max(60)).default({}), barcode: z.string().max(80).optional(), price: money, compareAt: money.default(null), cost: money.default(null), sku: z.string().max(64).default(""), stock: z.number().int().min(0).max(1_000_000).nullable().default(null), weightGrams: z.number().int().min(0).max(1_000_000).nullable().default(null) }))
    .min(1)
    .max(100),
});
export type DraftProductInput = z.infer<typeof draftProductSchema>;

export const launchSchema = z.object({
  kind: z.enum(["store", "website"]),
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(300).default(""),
  email: z.union([z.email().max(200), z.literal("")]).default(""),
  country: z.string().trim().length(2).default("IN"),
  currency: z.string().trim().length(3).default("INR"),
  /** The design the owner approved in the preview (validated like any save). */
  doc: z.string().max(2_000_000),
  products: z.array(draftProductSchema).max(2000).default([]),
  payments: z.object({ cod: z.boolean().default(true), upiId: z.string().trim().max(80).default(""), instructions: z.string().trim().max(500).default("") }).default({ cod: true, upiId: "", instructions: "" }),
  publish: z.boolean().default(true),
  /** Optional logo (base64 image, ≤ 3 MB) stored in the project's media and used in the header. */
  logo: z.object({ name: z.string().max(200), data: z.string().max(4_200_000) }).optional(),
  /** A domain the owner already has; added during launch, verified once their DNS records are in. */
  domain: z.string().trim().max(253).optional(),
  /** They take appointments or classes: set up booking services (hidden until priced). */
  bookings: z.boolean().default(false),
});
export type LaunchInput = z.infer<typeof launchSchema>;

export type DnsRecord = { type: "TXT" | "CNAME" | "A"; name: string; value: string; purpose: string };
export type LaunchDomain = { id: string; hostname: string; records: DnsRecord[]; targetConfigured: boolean };

/** The records an owner sets at their registrar for a domain. */
export function dnsRecordsFor(d: { hostname: string; verificationToken: string }): { records: DnsRecord[]; targetConfigured: boolean } {
  const t = dnsTarget();
  const records: DnsRecord[] = [{ type: "TXT", name: `${TXT_PREFIX}.${d.hostname}`, value: d.verificationToken, purpose: "Proves the domain is yours" }];
  if (t.cname) records.push({ type: "CNAME", name: d.hostname, value: t.cname, purpose: "Sends visitors to your site" });
  else for (const ip of t.ipv4) records.push({ type: "A", name: d.hostname, value: ip, purpose: "Sends visitors to your site" });
  return { records, targetConfigured: !!(t.cname || t.ipv4.length) };
}

export type LaunchEvent =
  | { step: "project" | "design" | "store" | "products" | "payments" | "bookings" | "publish" | "domain"; status: "running" | "done" | "skipped"; detail?: string; done?: number; total?: number; domain?: LaunchDomain }
  | { step: "complete"; projectId: string; liveUrl: string | null; deploymentId: string | null; drafts: number; imported: number; problems: string[] }
  | { step: "error"; message: string };

const https = (u: string) => /^https:\/\/[^\s]+$/i.test(u) || /^\/assets\//.test(u);

/**
 * Saves draft products. Complete ones go live; ones still missing a name or
 * price are saved as drafts so nothing half-finished reaches the shop.
 */
export async function importDraftProducts(projectId: string, userId: string, products: DraftProductInput[], onProgress?: (done: number, total: number) => void) {
  const collections = new Map<string, string>();
  const existing = await db.select({ id: schema.storeCollections.id, title: schema.storeCollections.title }).from(schema.storeCollections).where(eq(schema.storeCollections.projectId, projectId));
  for (const c of existing) collections.set(c.title.toLowerCase(), c.id);
  let imported = 0;
  let drafts = 0;
  const problems: string[] = [];
  const ids: string[] = [];
  for (const [i, p] of products.entries()) {
    try {
      const cat = p.category.trim();
      if (cat && !collections.has(cat.toLowerCase())) {
        const c = await saveCollection(projectId, { title: cat.slice(0, 80), sort: collections.size }).catch(() => null);
        if (c) collections.set(cat.toLowerCase(), c.id);
      }
      const complete = !!p.title.trim() && p.variants.every((v) => v.price !== null && v.price > 0);
      const status = complete && p.active ? "active" : "draft";
      if (status === "draft") drafts++;
      const optionNames = p.options.map((o) => o.name);
      const input = {
        title: (p.title.trim() || `Untitled product ${i + 1}`).slice(0, PRODUCT_LIMITS.title),
        description: p.description,
        status,
        images: p.images.filter(https),
        options: p.options.map((o) => ({ ...o, values: o.values.filter(Boolean) })).filter((o) => o.values.length),
        tags: p.tags,
        vendor: p.vendor,
        // Only valid HSN/SAC codes are kept, so the product can be edited later.
        hsn: HSN_RE.test(p.hsn) ? p.hsn : "",
        collectionIds: cat ? ([collections.get(cat.toLowerCase())].filter(Boolean) as string[]) : [],
        variants: p.variants.map((v) => ({
          options: Object.fromEntries(optionNames.map((n) => [n, v.options[n] ?? ""])),
          sku: v.sku.slice(0, PRODUCT_LIMITS.sku),
          barcode: (v.barcode ?? "").replace(/\s+/g, "").slice(0, PRODUCT_LIMITS.barcode),
          price: v.price ?? 0,
          compareAt: v.compareAt && v.price && v.compareAt > v.price ? v.compareAt : null,
          cost: v.cost,
          trackInventory: true,
          // Owners are told when stock wasn't in the file and we start at 10.
          stock: v.stock ?? 10,
          weightGrams: v.weightGrams ?? 500,
        })),
      };
      // The editor's own rules: anything imported can be opened and saved again.
      const checked = productSchema.safeParse(input);
      if (!checked.success) throw new Error(checked.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "));
      ids.push(await saveProduct(projectId, userId, checked.data));
      imported++;
    } catch (e) {
      problems.push(`${p.title || `Row ${i + 1}`}: ${(e as Error).message}`);
    }
    if (onProgress && (i % 5 === 4 || i === products.length - 1)) onProgress(i + 1, products.length);
  }
  return { imported, drafts, problems: problems.slice(0, 50), ids };
}

/** Example sections (sample testimonials, figures) would block a production deploy; a fast launch leaves them out. */
function withoutExamples(doc: SiteDoc): { doc: SiteDoc; removed: number } {
  let removed = 0;
  for (const p of doc.pages) {
    const before = p.sections.length;
    p.sections = p.sections.filter((s) => !s.props._example);
    removed += before - p.sections.length;
  }
  return { doc, removed };
}

export async function launch(org: { id: string; slug: string }, user: { id: string; email: string }, input: LaunchInput, emit: (e: LaunchEvent) => void) {
  const parsed = parseSiteDoc(input.doc);
  if (!parsed.ok) throw new ApiError("validation_failed", "The design couldn't be read", { problems: parsed.errors.slice(0, 20) });
  const { doc, removed } = withoutExamples(parsed.doc);
  doc.name = input.name;

  emit({ step: "project", status: "running", detail: "Creating your project" });
  const spec = planFromBrief(input.tagline || `${input.name} ${input.kind === "store" ? "online store" : "website"}`, { name: input.name });
  spec.kind = input.kind === "store" ? "store" : spec.kind;
  if (input.tagline) spec.summary = input.tagline.slice(0, 1000);
  const project = await createProjectFromSpec(org.id, user.id, spec, "user", serializeSiteDoc(doc));
  if (input.logo) {
    try {
      const asset = await uploadAsset(project, user.id, { name: input.logo.name, bytes: Buffer.from(input.logo.data, "base64") });
      for (const p of doc.pages) for (const sec of p.sections) if (sec.type === "navbar") sec.props.logo = asset.url;
      doc.brand = { ...(doc.brand ?? {}), logo: asset.url };
      await writeFile(project.id, SITE_DOC_PATH, serializeSiteDoc(doc), 1, { userId: user.id, source: "system", message: "Added your logo" });
    } catch (e) {
      // A bad logo shouldn't stop the launch; the owner can add it in the builder.
      log.warn("launch_logo_failed", { projectId: project.id, error: (e as Error).message });
    }
  }
  emit({ step: "project", status: "done", detail: project.name });
  emit({ step: "design", status: "done", detail: removed ? `Your design is in place (left out ${removed} sample section${removed === 1 ? "" : "s"} you can add back with real content)` : "Your design is in place" });

  let imported = 0;
  let drafts = 0;
  const problems: string[] = [];
  if (input.kind === "store") {
    emit({ step: "store", status: "running", detail: "Setting up checkout, shipping and taxes" });
    await setupStore(project.id, { name: input.name, currency: input.currency.toUpperCase(), country: input.country.toUpperCase(), email: input.email || user.email });
    emit({ step: "store", status: "done", detail: `Checkout in ${input.currency.toUpperCase()}, delivery rates and taxes ready` });

    if (input.products.length) {
      emit({ step: "products", status: "running", done: 0, total: input.products.length });
      const r = await importDraftProducts(project.id, user.id, input.products, (done, total) => emit({ step: "products", status: "running", done, total }));
      imported = r.imported;
      drafts = r.drafts;
      problems.push(...r.problems);
      emit({ step: "products", status: "done", done: r.imported, total: input.products.length, detail: `${r.imported - r.drafts} live${r.drafts ? `, ${r.drafts} saved as drafts to finish` : ""}` });
    } else emit({ step: "products", status: "skipped", detail: "Add products any time from Online store → Products" });

    emit({ step: "payments", status: "running" });
    const set = async (provider: string, enabled: boolean, settings: Record<string, unknown>) => {
      const [row] = await db.select({ id: schema.storePaymentProviders.id }).from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, project.id), eq(schema.storePaymentProviders.provider, provider)));
      if (row) await db.update(schema.storePaymentProviders).set({ enabled, status: "connected", settings, updatedAt: new Date() }).where(eq(schema.storePaymentProviders.id, row.id));
      else await db.insert(schema.storePaymentProviders).values({ projectId: project.id, provider, enabled, status: "connected", settings });
    };
    await set("cod", input.payments.cod, { fee: 0, maxOrder: 1000000 });
    if (input.payments.upiId || input.payments.instructions) await set("manual", true, { label: "UPI / bank transfer", upiId: input.payments.upiId, instructions: input.payments.instructions });
    const methods = [input.payments.cod && "cash on delivery", (input.payments.upiId || input.payments.instructions) && "UPI / bank transfer"].filter(Boolean);
    emit({ step: "payments", status: methods.length ? "done" : "skipped", detail: methods.length ? `Accepting ${methods.join(" and ")} — connect Razorpay, Stripe or PayPal later for cards` : "Connect a payment method before your first order" });
  }

  if (input.bookings) {
    emit({ step: "bookings", status: "running", detail: "Adding your services" });
    // Bookings live alongside the store's checkout and customer records.
    if (input.kind !== "store") await setupStore(project.id, { name: input.name, currency: input.currency.toUpperCase(), country: input.country.toUpperCase(), email: input.email || user.email });
    const services = businessKit(spec).bookings.services;
    if (!(await listServices(project.id)).length) {
      // Prices and hours are the owner's call, so services start hidden until they set them.
      for (const [i, sv] of services.entries()) await saveService(project.id, { ...sv, price: 0, payment: "none", bufferMin: 0, active: false, sort: i });
    }
    emit({ step: "bookings", status: "done", detail: `${services.length} service${services.length === 1 ? "" : "s"} added — set prices and opening hours to start taking bookings` });
  }

  let liveUrl: string | null = null;
  let deploymentId: string | null = null;
  if (input.publish) {
    emit({ step: "publish", status: "running", detail: "Checking every page and publishing" });
    const dep = await createDeployment(project, "production", user.id);
    deploymentId = dep.id;
    if (dep.status === "ready") {
      liveUrl = appUrl(`/s/${org.slug}/${project.slug}`);
      emit({ step: "publish", status: "done", detail: "Live" });
    } else {
      problems.push(dep.error ?? "Publishing failed");
      log.warn("launch_publish_failed", { projectId: project.id, error: dep.error });
      emit({ step: "publish", status: "skipped", detail: dep.error ?? "Publishing needs a fix — open the builder's Review tab" });
    }
  } else emit({ step: "publish", status: "skipped", detail: "Not published yet" });

  if (input.domain) {
    emit({ step: "domain", status: "running", detail: `Adding ${input.domain}` });
    try {
      const d = await addDomain(project, user.id, input.domain);
      emit({ step: "domain", status: "done", detail: `${d.hostname} added — set two DNS records to finish`, domain: { id: d.id, hostname: d.hostname, ...dnsRecordsFor(d) } });
    } catch (e) {
      // The site is live either way; the domain can be added from Deployments.
      const msg = e instanceof ApiError ? e.message : "Couldn't add the domain";
      problems.push(`Domain: ${msg}`);
      emit({ step: "domain", status: "skipped", detail: `${msg}. You can add it later in Deployments → Custom domains.` });
    }
  }

  emit({ step: "complete", projectId: project.id, liveUrl, deploymentId, drafts, imported, problems });
  return project;
}
