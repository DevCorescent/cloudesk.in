// Photo → product listing. The model looks at one product photo and drafts a
// title, description, tags and (for Indian stores) a suggested HSN code and
// GST rate. It describes only what it can see; anything it can't confirm
// (material, size, origin) comes back as a note for the owner to check.
// Nothing is saved: the owner reviews the draft in the product editor.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hasLlm } from "../ai/gateway";
import { completeJson } from "../ai/json";
import { assertAiAllowed } from "../ai/tasks";
import { ApiError } from "../http/errors";
import { uploadAsset } from "../media/assets";
import { sniffImage } from "../media/images";

export const MAX_PHOTO = 5 * 1024 * 1024;
const GST_RATES = [0, 500, 1200, 1800, 2800] as const;

const listingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1200).catch(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).catch([]),
  hsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/).catch(""),
  gstPercent: z.number().nullable().catch(null),
  collection: z.string().trim().max(120).nullable().catch(null),
  altText: z.string().trim().max(160).catch(""),
  checks: z.array(z.string().trim().max(200)).max(6).catch([]),
});

const SYSTEM = `You write product listings for small online shops from a single product photo.
Rules:
- Describe only what is visible. Never invent brand names, materials, measurements, certifications, origin or claims (e.g. "handmade", "organic", "100% cotton") unless clearly visible on the item or its label.
- Title: plain and specific, under 70 characters, no hype, no ALL CAPS.
- Description: 2–4 short sentences for shoppers — what it is, what it looks like, how it might be used. Warm, simple English.
- Tags: up to 6 lowercase shopping keywords.
- If the shop is in India, suggest the most likely HSN code (4, 6 or 8 digits) and GST rate (0, 5, 12, 18 or 28) for this kind of product; otherwise leave hsn "" and gstPercent null. These are suggestions the owner must confirm.
- collection: choose one of the shop's collections that fits, exactly as written, or null.
- checks: short notes on what the owner should confirm before publishing (e.g. "Add the size", "Confirm the material", "Confirm the GST rate with your accountant").
- altText: a short description of the photo for screen readers.
Reply with JSON only: {"title","description","tags","hsn","gstPercent","collection","altText","checks"}.`;

export async function listingFromPhoto(project: { id: string; orgId: string; name: string }, userId: string, file: { name: string; bytes: Buffer }) {
  if (file.bytes.length > MAX_PHOTO) throw new ApiError("payload_too_large", "Photos are limited to 5 MB");
  const img = sniffImage(file.bytes);
  if (!img) throw new ApiError("validation_failed", "Upload a JPEG, PNG, WebP or GIF photo");
  if (!(await hasLlm(project.orgId))) throw new ApiError("provider_not_configured", "Connect an AI provider under Settings → AI providers to write listings from photos.");
  await assertAiAllowed(project.orgId);

  const [store] = await db.select({ country: schema.stores.country, name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.projectId, project.id));
  if (!store) throw new ApiError("conflict", "Set up the store first");
  const collections = await db.select({ id: schema.storeCollections.id, title: schema.storeCollections.title }).from(schema.storeCollections).where(eq(schema.storeCollections.projectId, project.id));
  const india = store.country === "IN";

  // Keep the photo: it becomes the product's first image.
  const asset = await uploadAsset(project, userId, file);
  const started = new Date();
  const { value, usage } = await completeJson(
    {
      orgId: project.orgId,
      task: "planning",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.mime as "image/png", data: file.bytes.toString("base64") } },
            { type: "text", text: `Shop: ${store.name} (${india ? "India — suggest HSN and GST" : `country ${store.country} — no HSN/GST`}).\nThe shop's collections: ${collections.length ? collections.map((c) => `"${c.title}"`).join(", ") : "none yet"}.\nWrite the listing for the product in this photo.` },
          ],
        },
      ],
      maxTokens: 2000,
      signal: AbortSignal.timeout(90_000),
    },
    listingSchema,
    { maxRepairs: 1 },
  );
  // Counted toward the organization's AI usage and budget.
  await db.insert(schema.aiTasks).values({ orgId: project.orgId, projectId: project.id, kind: "product_listing", status: "succeeded", input: { image: asset.url }, result: { type: "product_listing", ...value }, createdBy: userId, startedAt: started, finishedAt: new Date(), ...usage });

  const rate = india && value.gstPercent !== null ? Math.round(value.gstPercent * 100) : null;
  const collection = value.collection ? collections.find((c) => c.title.toLowerCase() === value.collection!.toLowerCase()) : undefined;
  return {
    draft: {
      title: value.title,
      description: value.description,
      tags: [...new Set(value.tags.map((t) => t.toLowerCase()))].slice(0, 8),
      hsn: india ? value.hsn : "",
      taxBps: rate !== null && (GST_RATES as readonly number[]).includes(rate) ? rate : null,
      collectionIds: collection ? [collection.id] : [],
      images: [asset.url],
    },
    altText: value.altText,
    checks: [...value.checks, ...(india && value.hsn ? ["The HSN code and GST rate are suggestions — confirm them with your accountant."] : [])].slice(0, 6),
  };
}
