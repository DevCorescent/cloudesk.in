// Signatures: each person keeps their own (details + a design), picks one per
// mailbox for new mail and one for replies, and can choose another — or none —
// on any email. Logos and photos are uploaded here and served publicly at
// /mail-img/<id> (unguessable ids) so recipients' mail apps can show them.
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { signatureFields, signatureHtml, signatureSchema, signatureText, type DesignId, type SignatureFields } from "@/lib/mail/signature";
import type { SignatureOut, SignaturesOut } from "@/lib/mail/api";
import { ApiError, notFound } from "../http/errors";
import { sniffImage } from "../media/images";
import { appUrl } from "../services/mail";
import { account, accountIds, check, type Scope } from "./access";

const S = schema.mailSignatures;
const D = schema.mailSignatureDefaults;
const I = schema.mailSignatureImages;
const MAX_SIGNATURES = 20;
const MAX_IMAGE = 1024 * 1024;
const MAX_IMAGES = 60;

const out = (r: typeof S.$inferSelect): SignatureOut => ({ id: r.id, name: r.name, design: r.design as DesignId, fields: signatureFields.parse(r.fields), updatedAt: r.updatedAt.toISOString() });

export async function listSignatures(s: Scope): Promise<SignaturesOut> {
  const rows = await db.select().from(S).where(and(eq(S.orgId, s.orgId), eq(S.ownerId, s.userId))).orderBy(S.createdAt);
  const ids = await accountIds(s);
  const defs = ids.length ? await db.select().from(D).where(and(eq(D.userId, s.userId), inArray(D.accountId, ids))) : [];
  return { signatures: rows.map(out), defaults: Object.fromEntries(defs.map((d) => [d.accountId, { newId: d.newId, replyId: d.replyId }])) };
}

export async function saveSignature(s: Scope, id: string | null, raw: unknown) {
  const v = check(signatureSchema, raw);
  if (id) {
    const [r] = await db.update(S).set({ name: v.name, design: v.design, fields: v.fields, updatedAt: new Date() }).where(and(eq(S.id, id), eq(S.orgId, s.orgId), eq(S.ownerId, s.userId))).returning();
    if (!r) throw notFound("Signature");
    return { signature: out(r) };
  }
  const [{ n }] = await db.select({ n: count() }).from(S).where(and(eq(S.orgId, s.orgId), eq(S.ownerId, s.userId)));
  if (Number(n) >= MAX_SIGNATURES) throw new ApiError("conflict", `You can keep up to ${MAX_SIGNATURES} signatures — remove one first`);
  const [r] = await db.insert(S).values({ orgId: s.orgId, ownerId: s.userId, name: v.name, design: v.design, fields: v.fields }).returning();
  // The first signature becomes the default everywhere it isn't set yet.
  if (Number(n) === 0) for (const acc of await accountIds(s)) await db.insert(D).values({ userId: s.userId, accountId: acc, newId: r!.id, replyId: r!.id }).onConflictDoNothing();
  return { signature: out(r!) };
}

export async function deleteSignature(s: Scope, id: string) {
  const r = await db.delete(S).where(and(eq(S.id, id), eq(S.orgId, s.orgId), eq(S.ownerId, s.userId))).returning({ id: S.id });
  if (!r.length) throw notFound("Signature");
}

const defaultsSchema = z.object({ accountId: z.uuid(), newId: z.uuid().nullable(), replyId: z.uuid().nullable() });

export async function setSignatureDefaults(s: Scope, raw: unknown) {
  const v = check(defaultsSchema, raw);
  await account(s, v.accountId);
  const ids = [v.newId, v.replyId].filter((x): x is string => !!x);
  if (ids.length) {
    const mine = await db.select({ id: S.id }).from(S).where(and(inArray(S.id, ids), eq(S.ownerId, s.userId), eq(S.orgId, s.orgId)));
    if (mine.length !== new Set(ids).size) throw new ApiError("validation_failed", "Pick one of your signatures");
  }
  await db.insert(D).values({ userId: s.userId, accountId: v.accountId, newId: v.newId, replyId: v.replyId }).onConflictDoUpdate({ target: [D.userId, D.accountId], set: { newId: v.newId, replyId: v.replyId } });
  return { ok: true };
}

export async function uploadSignatureImage(s: Scope, raw: unknown) {
  const v = check(z.object({ data: z.string().max(Math.ceil((MAX_IMAGE * 4) / 3) + 16) }), raw);
  const bytes = Buffer.from(v.data, "base64");
  if (!bytes.length) throw new ApiError("validation_failed", "The file is empty");
  if (bytes.length > MAX_IMAGE) throw new ApiError("payload_too_large", "Signature images can be up to 1 MB — a logo around 300 px wide is plenty");
  const info = sniffImage(bytes);
  if (!info || !/^image\/(png|jpeg|gif|webp)$/.test(info.mime)) throw new ApiError("validation_failed", "Use a PNG, JPEG, GIF or WebP image (SVG and AVIF don't show in many mail apps)");
  const [{ n }] = await db.select({ n: count() }).from(I).where(eq(I.ownerId, s.userId));
  if (Number(n) >= MAX_IMAGES) throw new ApiError("conflict", "You've uploaded a lot of signature images — reuse one you have");
  const [r] = await db.insert(I).values({ orgId: s.orgId, ownerId: s.userId, mime: info.mime, size: bytes.length, data: bytes }).returning({ id: I.id });
  return { id: r!.id, url: `/mail-img/${r!.id}` };
}

/** Public: a signature image, by its unguessable id. */
export async function readSignatureImage(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db.select({ mime: I.mime, data: I.data }).from(I).where(eq(I.id, id));
  return r ?? null;
}

export type RenderedSignature = { html: string; text: string };

export function renderSignature(design: string, fields: unknown): RenderedSignature | null {
  const f = signatureFields.safeParse(fields);
  if (!f.success) return null;
  const d = design as DesignId;
  return { html: signatureHtml(d, f.data as SignatureFields, new URL(appUrl("/")).origin), text: signatureText(d, f.data as SignatureFields) };
}

/**
 * The signature for an email. `chosen`: an id (one of theirs), null for none,
 * undefined for their default in that mailbox (new mail or replies). Returns
 * "legacy" when they have no signatures set up, so the mailbox's plain one applies.
 */
export async function signatureForSend(userId: string, orgId: string, accountId: string, mode: "new" | "reply" | "replyAll" | "forward", chosen: string | null | undefined): Promise<RenderedSignature | null | "legacy"> {
  if (chosen === null) return null;
  let id = chosen;
  if (id === undefined) {
    const [d] = await db.select().from(D).where(and(eq(D.userId, userId), eq(D.accountId, accountId)));
    if (!d) {
      // No choice made for this mailbox yet (say, it was added later): their first signature, else the mailbox's plain one.
      const [first] = await db.select().from(S).where(and(eq(S.orgId, orgId), eq(S.ownerId, userId))).orderBy(S.createdAt).limit(1);
      return first ? renderSignature(first.design, first.fields) : "legacy";
    }
    id = (mode === "new" ? d.newId : d.replyId) ?? undefined;
    if (!id) return null;
  }
  const [sig] = await db.select().from(S).where(and(eq(S.id, id), eq(S.ownerId, userId), eq(S.orgId, orgId)));
  if (!sig) throw new ApiError("validation_failed", "That signature isn't one of yours");
  return renderSignature(sig.design, sig.fields);
}
