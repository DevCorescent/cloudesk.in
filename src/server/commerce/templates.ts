import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { photoUrl } from "@/lib/site/media";
import { parseSiteDoc, serializeSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import { embedStoreInSite, type EmbedOptions } from "@/lib/store/embed";
import { samplePrice, storeSiteDoc, storeTemplate, STORE_TEMPLATES_SHOWN as DATA, type StoreTemplate } from "@/lib/store/templates";
import { ApiError, notFound } from "../http/errors";
import { readFile, writeFile } from "../services/files";
import { getStore, saveCollection, saveProduct } from "./catalog";
import { setupStore } from "./settings";

export const STORE_TEMPLATES = DATA.map((t) => ({ ...t, image: photoUrl(t.image, 800, [4, 3]), signature: !!t.look }));

type Project = { id: string; orgId: string };

/**
 * Applies a store template: replaces the site design with the storefront
 * layout (the previous design stays in file history) and, for a store with
 * no products yet, seeds sample collections and products. Sample products
 * are flagged so they cannot be bought until the owner edits them.
 */
export async function applyStoreTemplate(project: Project, userId: string, templateId: string, input: { name: string; currency?: string; country?: string; region?: string; email?: string; replaceDesign?: boolean }) {
  const t = storeTemplate(templateId);
  if (!t) throw notFound("Template");
  if (!input.replaceDesign) throw new ApiError("conflict", "Applying a template replaces the current site design. Confirm to continue — the previous design stays in version history.", { confirm: "replaceDesign" });
  const file = await readFile(project.id, SITE_DOC_PATH);
  const doc = storeSiteDoc(t, input.name || t.storeName);

  return db.transaction(async (tx) => {
    const store = await setupStore(project.id, { ...input, name: input.name || t.storeName }, tx);
    const seeded = await seedSampleCatalog(project.id, userId, t, store, tx);
    await writeFile(project.id, SITE_DOC_PATH, serializeSiteDoc(doc), file.revision, { userId, source: "template", message: `Applied the ${t.name} store template` }, tx);
    return { store: await getStore(project.id, tx), seeded, template: t.id };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Seeds a template's sample collections and products into a store that has
 * none yet. Samples are flagged so they can't be bought until the owner edits them.
 */
async function seedSampleCatalog(projectId: string, userId: string, t: StoreTemplate, store: { currency: string; checkout: unknown }, tx: Tx) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.storeProducts).where(eq(schema.storeProducts.projectId, projectId));
  if (n > 0) return 0;
  const cols = [];
  for (const [i, c] of t.collections.entries()) cols.push(await saveCollection(projectId, { title: c.title, description: c.description, image: photoUrl(c.photo, 1200, [4, 5]), sort: i }, undefined, tx));
  let seeded = 0;
  for (const [i, p] of t.products.entries()) {
    const price = samplePrice(p.inr, store.currency);
    const compareAt = p.compareInr ? samplePrice(p.compareInr, store.currency) : null;
    const values = p.options?.values ?? [null];
    const perVariant = Math.max(1, Math.floor((p.stock ?? 24) / values.length));
    await saveProduct(
      projectId,
      userId,
      {
        title: p.title,
        description: p.description,
        status: "active",
        images: [photoUrl(p.photo, 1200, [4, 5])],
        options: p.options ? [p.options] : [],
        featured: !!p.featured,
        collectionIds: [cols[p.collection]?.id].filter(Boolean) as string[],
        isSample: true,
        variants: values.map((v, j) => ({
          options: v && p.options ? { [p.options.name]: v } : {},
          sku: `${t.id.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}${values.length > 1 ? `-${j + 1}` : ""}`,
          price,
          compareAt,
          trackInventory: true,
          stock: perVariant,
          weightGrams: p.weightGrams ?? 500,
        })),
      },
      undefined,
      tx,
    );
    seeded++;
  }
  await tx.update(schema.stores).set({ checkout: { ...((store.checkout as object) ?? {}), announcement: t.announcement } }).where(eq(schema.stores.projectId, projectId));
  return seeded;
}

/**
 * Adds an online store to an existing website: the store itself (payments,
 * shipping), optional sample products, and shop sections, menu and footer
 * links on the site — in its own design. The previous version stays in file
 * history, so it can be undone.
 */
export async function embedStore(project: Project, userId: string, input: { name: string; currency?: string; country?: string; region?: string; email?: string; sample?: string | null } & EmbedOptions) {
  const t = input.sample ? storeTemplate(input.sample) : null;
  if (input.sample && !t) throw notFound("Sample catalogue");
  const file = await readFile(project.id, SITE_DOC_PATH);
  const parsed = parseSiteDoc(file.content);
  if (!parsed.ok) throw new ApiError("conflict", "This project's website couldn't be read, so the store wasn't added. Open the builder to check it.");
  const { doc, added } = embedStoreInSite(parsed.doc, { placement: input.placement, categories: input.categories });
  return db.transaction(async (tx) => {
    const store = await setupStore(project.id, input, tx);
    const seeded = t ? await seedSampleCatalog(project.id, userId, t, store, tx) : 0;
    await writeFile(project.id, SITE_DOC_PATH, serializeSiteDoc(doc), file.revision, { userId, source: "system", message: "Added the online store to the website" }, tx);
    return { store: await getStore(project.id, tx), seeded, added };
  });
}
