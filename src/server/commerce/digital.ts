import { createHash, createHmac } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { safeEqual, sha256 } from "../security/tokens";
import { audit } from "../services/audit";
import { appUrl, sendMail } from "../services/mail";

// ─── Private files for digital products ──────────────────────────────────────

export const MAX_DIGITAL_BYTES = 25 * 1024 * 1024;
export const MAX_DOWNLOADS = 10;

/** File types allowed for sale, detected from the bytes (never from the name). */
function sniff(b: Buffer): { mime: string; ext: string } | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return { mime: "application/pdf", ext: "pdf" };
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) {
    const head = b.subarray(0, 200).toString("latin1");
    if (head.includes("mimetypeapplication/epub+zip")) return { mime: "application/epub+zip", ext: "epub" };
    return { mime: "application/zip", ext: "zip" };
  }
  if (at(0, 0x49, 0x44, 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: "audio/mpeg", ext: "mp3" };
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return { mime: "video/mp4", ext: "mp4" };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { mime: "image/png", ext: "png" };
  if (at(0, 0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

export async function uploadDigitalFile(project: { id: string; orgId: string }, userId: string, name: string, bytes: Buffer) {
  if (!bytes.length) throw new ApiError("validation_failed", "The file is empty");
  if (bytes.length > MAX_DIGITAL_BYTES) throw new ApiError("payload_too_large", "Files for sale are limited to 25 MB");
  const t = sniff(bytes);
  if (!t) throw new ApiError("validation_failed", "Upload a PDF, ZIP, EPUB, MP3, MP4, PNG or JPEG file");
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "download";
  const [f] = await db
    .insert(schema.storeDigitalFiles)
    .values({ projectId: project.id, filename: `${base}.${t.ext}`, mime: t.mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes, createdBy: userId })
    .returning({ id: schema.storeDigitalFiles.id, filename: schema.storeDigitalFiles.filename, mime: schema.storeDigitalFiles.mime, size: schema.storeDigitalFiles.size, createdAt: schema.storeDigitalFiles.createdAt });
  await audit({ orgId: project.orgId, actorId: userId, action: "store.digital_file_uploaded", targetType: "digital_file", targetId: f.id, metadata: { size: bytes.length, mime: t.mime } });
  return f;
}

export async function listDigitalFiles(projectId: string) {
  return db
    .select({ id: schema.storeDigitalFiles.id, filename: schema.storeDigitalFiles.filename, mime: schema.storeDigitalFiles.mime, size: schema.storeDigitalFiles.size, createdAt: schema.storeDigitalFiles.createdAt })
    .from(schema.storeDigitalFiles)
    .where(eq(schema.storeDigitalFiles.projectId, projectId))
    .orderBy(desc(schema.storeDigitalFiles.createdAt));
}

/** Streams a purchased file to the holder of the order key. */
export async function downloadForOrder(projectId: string, orderNumber: number, key: string, itemId: string) {
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, projectId), eq(schema.storeOrders.number, orderNumber), eq(schema.storeOrders.accessKeyHash, sha256(key))));
  if (!o) throw notFound("Order");
  if (!["paid", "partially_refunded"].includes(o.financialStatus) || o.cancelledAt) throw new ApiError("forbidden", "Downloads open once the order is paid");
  const [item] = await db.select().from(schema.storeOrderItems).where(and(eq(schema.storeOrderItems.id, itemId), eq(schema.storeOrderItems.orderId, o.id)));
  if (!item || item.kind !== "digital" || !item.productId) throw notFound("Download");
  const [p] = await db.select({ fileId: schema.storeProducts.digitalFileId }).from(schema.storeProducts).where(eq(schema.storeProducts.id, item.productId));
  if (!p?.fileId) throw new ApiError("conflict", "The seller has not attached a file to this product yet. Please contact them.");
  // Counted atomically so the limit holds under parallel requests.
  const [counted] = await db.update(schema.storeOrderItems).set({ downloads: sql`${schema.storeOrderItems.downloads} + 1` }).where(and(eq(schema.storeOrderItems.id, item.id), sql`${schema.storeOrderItems.downloads} < ${MAX_DOWNLOADS * item.quantity}`)).returning({ downloads: schema.storeOrderItems.downloads });
  if (!counted) throw new ApiError("forbidden", "The download limit for this order has been reached. Please contact the seller.");
  const [f] = await db.select().from(schema.storeDigitalFiles).where(and(eq(schema.storeDigitalFiles.id, p.fileId), eq(schema.storeDigitalFiles.projectId, projectId)));
  if (!f) throw notFound("File");
  return f;
}

// ─── Memberships ─────────────────────────────────────────────────────────────

const ACTIVE = (now: Date) => and(isNull(schema.storeMemberships.revokedAt), or(isNull(schema.storeMemberships.expiresAt), gt(schema.storeMemberships.expiresAt, now)));

export async function activeMembership(projectId: string, email: string, now = new Date()) {
  const [m] = await db
    .select()
    .from(schema.storeMemberships)
    .where(and(eq(schema.storeMemberships.projectId, projectId), sql`lower(${schema.storeMemberships.email}) = ${email.trim().toLowerCase()}`, ACTIVE(now)))
    .limit(1);
  return m ?? null;
}

/** Adds access, extending any active membership rather than replacing it. */
export async function grantMembership(projectId: string, input: { email: string; name?: string; days: number | null; orderId?: string | null }, now = new Date()) {
  const current = await activeMembership(projectId, input.email, now);
  const from = current?.expiresAt && current.expiresAt > now ? current.expiresAt : now;
  const expiresAt = input.days === null ? null : new Date(from.getTime() + input.days * 86400_000);
  if (current) {
    await db.update(schema.storeMemberships).set({ expiresAt: current.expiresAt === null ? null : expiresAt }).where(eq(schema.storeMemberships.id, current.id));
    return { ...current, expiresAt: current.expiresAt === null ? null : expiresAt };
  }
  const [m] = await db.insert(schema.storeMemberships).values({ projectId, email: input.email.trim().toLowerCase(), name: input.name ?? "", orderId: input.orderId ?? null, expiresAt }).returning();
  return m;
}

export async function listMembers(projectId: string) {
  return db.select().from(schema.storeMemberships).where(eq(schema.storeMemberships.projectId, projectId)).orderBy(desc(schema.storeMemberships.createdAt)).limit(1000);
}

export async function revokeMembership(projectId: string, id: string) {
  const r = await db.update(schema.storeMemberships).set({ revokedAt: new Date() }).where(and(eq(schema.storeMemberships.id, id), eq(schema.storeMemberships.projectId, projectId), isNull(schema.storeMemberships.revokedAt))).returning({ id: schema.storeMemberships.id });
  if (!r.length) throw notFound("Membership");
}

/**
 * After payment: grants memberships, and marks orders that contain nothing
 * to ship as delivered.
 */
export async function fulfillNonPhysical(orderId: string) {
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, orderId));
  if (!o) return;
  const items = await db.select().from(schema.storeOrderItems).where(eq(schema.storeOrderItems.orderId, o.id));
  const memberships = items.filter((i) => i.kind === "membership" && i.productId);
  if (memberships.length) {
    const products = await db.select({ id: schema.storeProducts.id, days: schema.storeProducts.membershipDays }).from(schema.storeProducts).where(inArray(schema.storeProducts.id, memberships.map((i) => i.productId!)));
    for (const i of memberships) {
      const p = products.find((x) => x.id === i.productId);
      for (let n = 0; n < i.quantity; n++) await grantMembership(o.projectId, { email: o.email, name: (o.shippingAddress as { name?: string }).name, days: p?.days ?? null, orderId: o.id });
    }
  }
  if (items.length && items.every((i) => i.kind !== "physical") && o.fulfillmentStatus === "unfulfilled") {
    await db.update(schema.storeOrders).set({ fulfillmentStatus: "delivered", fulfilledAt: new Date() }).where(eq(schema.storeOrders.id, o.id));
    await db.insert(schema.storeOrderEvents).values({ orderId: o.id, kind: "delivered", message: memberships.length ? "Access granted (digital order)" : "Delivered digitally" });
  }
}

// ─── Member sign-in (signed cookie, no passwords) ────────────────────────────

const MEMBER_TTL_MS = 30 * 86400_000;
const LINK_TTL_MS = 30 * 60_000;

function key(purpose: string) {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update(`store-member-${purpose}-v1`).digest();
}

function sign(purpose: string, projectId: string, email: string, ttl: number, now: number) {
  const payload = Buffer.from(JSON.stringify({ p: projectId, e: email.trim().toLowerCase(), x: now + ttl })).toString("base64url");
  return `${payload}.${createHmac("sha256", key(purpose)).update(payload).digest("base64url")}`;
}

function verify(purpose: string, projectId: string, token: string | undefined | null, now: number) {
  const [payload, sig] = (token ?? "").split(".");
  if (!payload || !sig || !safeEqual(sig, createHmac("sha256", key(purpose)).update(payload).digest("base64url"))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as { p: string; e: string; x: number };
    return d.p === projectId && d.x > now ? d.e : null;
  } catch {
    return null;
  }
}

export const memberCookieName = (projectId: string) => `cc_member_${projectId.replace(/-/g, "").slice(0, 12)}`;
export const signMemberSession = (projectId: string, email: string, now = Date.now()) => sign("session", projectId, email, MEMBER_TTL_MS, now);
export const verifyMemberSession = (projectId: string, token: string | undefined | null, now = Date.now()) => verify("session", projectId, token, now);
export const signMemberLink = (projectId: string, email: string, now = Date.now()) => sign("link", projectId, email, LINK_TTL_MS, now);
export const verifyMemberLink = (projectId: string, token: string | undefined | null, now = Date.now()) => verify("link", projectId, token, now);

/** Emails a sign-in link to active members only; the response never reveals membership. */
export async function sendMemberLink(projectId: string, email: string, publicBase: string, next: string) {
  if (!(await activeMembership(projectId, email))) return;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.projectId, projectId));
  const link = appUrl(`/api/v1/store/${projectId}/member?token=${encodeURIComponent(signMemberLink(projectId, email))}&base=${encodeURIComponent(publicBase)}&next=${encodeURIComponent(next)}`);
  await sendMail({ fromName: store?.name, replyTo: store?.email || undefined, to: email, subject: `${store?.name ?? "Members"}: your sign-in link`, body: `Use this link to open the members area. It works for 30 minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.` });
}
