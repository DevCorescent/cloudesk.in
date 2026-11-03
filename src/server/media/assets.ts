import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { assertQuota } from "../billing/subscriptions";

import { audit } from "../services/audit";
import { sniffImage } from "./images";
import { createHash } from "node:crypto";

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_PROJECT_ASSET_BYTES = 200 * 1024 * 1024;
const MAX_DIMENSION = 12_000;

export function assetUrl(id: string) {
  return `/assets/${id}`;
}

const cleanName = (name: string) => name.replace(/[^\w.\- ]+/g, "").trim().slice(0, 120) || "image";

export async function uploadAsset(project: { id: string; orgId: string }, userId: string, file: { name: string; bytes: Buffer }) {
  if (file.bytes.length === 0) throw new ApiError("validation_failed", "The file is empty");
  if (file.bytes.length > MAX_ASSET_BYTES) throw new ApiError("payload_too_large", "Images are limited to 5 MB");
  const info = sniffImage(file.bytes);
  if (!info) throw new ApiError("validation_failed", "Upload a PNG, JPEG, WebP, GIF or AVIF image. SVG files are not accepted.");
  if ((info.width ?? 0) > MAX_DIMENSION || (info.height ?? 0) > MAX_DIMENSION) throw new ApiError("validation_failed", "The image is too large in pixels");
  const [{ total }] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.assets.size}),0)::bigint` })
    .from(schema.assets)
    .where(eq(schema.assets.projectId, project.id));
  if (Number(total) + file.bytes.length > MAX_PROJECT_ASSET_BYTES) throw new ApiError("conflict", "This project has reached its 200 MB media limit");
  await assertQuota(project.orgId, "storageMb", file.bytes.length / 1_048_576);

  const hash = createHash("sha256").update(file.bytes).digest("hex");
  const [existing] = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(eq(schema.assets.projectId, project.id), eq(schema.assets.sha256, hash)));
  if (existing) return { id: existing.id, url: assetUrl(existing.id), duplicate: true };

  const base = cleanName(file.name).replace(/\.[^.]+$/, "");
  const [a] = await db
    .insert(schema.assets)
    .values({ projectId: project.id, filename: `${base}.${info.ext}`, mime: info.mime, size: file.bytes.length, width: info.width, height: info.height, sha256: hash, data: file.bytes, createdBy: userId })
    .returning({ id: schema.assets.id });
  await audit({ orgId: project.orgId, actorId: userId, action: "asset.uploaded", targetType: "asset", targetId: a.id, metadata: { size: file.bytes.length, mime: info.mime } });
  return { id: a.id, url: assetUrl(a.id), duplicate: false };
}

export async function listAssets(projectId: string) {
  const rows = await db
    .select({ id: schema.assets.id, filename: schema.assets.filename, mime: schema.assets.mime, size: schema.assets.size, width: schema.assets.width, height: schema.assets.height, createdAt: schema.assets.createdAt })
    .from(schema.assets)
    .where(eq(schema.assets.projectId, projectId))
    .orderBy(desc(schema.assets.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r, url: assetUrl(r.id) }));
}

export async function deleteAsset(project: { id: string; orgId: string }, userId: string, assetId: string) {
  const r = await db.delete(schema.assets).where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, project.id))).returning({ id: schema.assets.id });
  if (!r.length) throw notFound("Image");
  await audit({ orgId: project.orgId, actorId: userId, action: "asset.deleted", targetType: "asset", targetId: assetId });
}

export async function readAsset(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [a] = await db
    .select({ mime: schema.assets.mime, data: schema.assets.data, sha256: schema.assets.sha256, projectId: schema.assets.projectId, archived: schema.projects.archivedAt })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.assets.projectId))
    .where(eq(schema.assets.id, id));
  if (!a || a.archived) return null;
  return a;
}

