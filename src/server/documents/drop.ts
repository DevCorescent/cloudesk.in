// Drive QR: a folder's QR code that anyone can scan to upload into it from
// their phone, without an account. Each upload stays for the time chosen
// (by the folder's owner, or the uploader within it) and is then deleted
// completely — every version, its log and any stars. The uploader may leave
// an email: they're told at once whenever their document is opened, printed,
// downloaded or changed, with a link that deletes it there and then.
// Links are signed with APP_ENCRYPTION_KEY from a random value kept on the
// row, so they can be shown again and changed to stop old ones working.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { LOG_LABEL, TELL_UPLOADER, choicesFor, dropSchema, dropUploadMeta, stayLabel, stayMinutes } from "@/lib/documents/drop";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { audit } from "../services/audit";
import { appUrl, sendMail } from "../services/mail";
import { check, getFileAs, openFolders, requireWrite, type Scope } from "./access";
import { assertRoom, checkBytes } from "./core";

const F = schema.docFiles;
const DR = schema.docDrops;
type Drop = typeof DR.$inferSelect;
type FileRow = typeof F.$inferSelect;
export type Who = { ip: string | null; userAgent: string | null };

// ── Signed links ────────────────────────────────────────────────────────────

function key(purpose: string) {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new ApiError("conflict", "Drive QR needs APP_ENCRYPTION_KEY to be configured");
  return createHmac("sha256", Buffer.from(raw, "base64")).update(purpose).digest();
}
const sign = (purpose: string, id: string, nonce: string) => `${id.replace(/-/g, "")}.${createHmac("sha256", key(purpose)).update(`${id}:${nonce}`).digest("base64url").slice(0, 32)}`;
const idOf = (token: string) => {
  const [hex, sig] = token.split(".");
  if (!hex || !sig || !/^[0-9a-f]{32}$/i.test(hex)) return null;
  return { id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`, sig };
};
const verify = (purpose: string, id: string, nonce: string, sig: string) => {
  const want = Buffer.from(sign(purpose, id, nonce).split(".")[1]!);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
};
const DROP = "doc-drop-v1";
const REMOVE = "doc-drop-remove-v1";
export const dropUrl = (d: Pick<Drop, "id" | "nonce">) => appUrl(`/drop/${sign(DROP, d.id, d.nonce)}`);
const removeUrl = (f: Pick<FileRow, "id" | "dropNonce">) => (f.dropNonce ? appUrl(`/drop/remove/${sign(REMOVE, f.id, f.dropNonce)}`) : "");

// ── The folder's QR (signed in) ─────────────────────────────────────────────

/** May this person set up a QR for this place? Inside a folder they need to edit it; the top of Team needs write. */
async function canManage(s: Scope, folderId: string | null, root: "team" | "mine") {
  if (folderId) {
    const a = await openFolders(s);
    if (a.roleOf.get(folderId) !== "edit") throw new ApiError("forbidden", "Only people who can add to this folder can set up its QR");
  } else if (root === "team") requireWrite(s);
}
const placeWhere = (s: Scope, folderId: string | null, root: "team" | "mine") => and(eq(DR.orgId, s.orgId), folderId ? eq(DR.folderId, folderId) : and(isNull(DR.folderId), eq(DR.root, root), ...(root === "mine" ? [eq(DR.createdBy, s.userId)] : [])));
const shape = (d: Drop) => ({ id: d.id, folderId: d.folderId, root: d.root, name: d.name, enabled: d.enabled, stayMinutes: d.stayMinutes, uploaderChooses: d.uploaderChooses, notifyOwner: d.notifyOwner, uploads: d.uploads, lastUploadAt: d.lastUploadAt?.toISOString() ?? null, url: dropUrl(d) });

export async function dropFor(s: Scope, q: { folderId?: string; root?: string }) {
  const folderId = q.folderId && /^[0-9a-f-]{36}$/i.test(q.folderId) ? q.folderId : null;
  const root = q.root === "mine" ? "mine" : "team";
  await canManage(s, folderId, root);
  const [d] = await db.select().from(DR).where(placeWhere(s, folderId, root));
  return { drop: d ? shape(d) : null };
}

export async function saveDrop(s: Scope, raw: unknown) {
  const v = check(dropSchema, raw);
  await canManage(s, v.folderId, v.root);
  const [d] = await db.select().from(DR).where(placeWhere(s, v.folderId, v.root));
  const fields = { name: v.name, enabled: v.enabled, stayMinutes: v.stayMinutes, uploaderChooses: v.uploaderChooses, notifyOwner: v.notifyOwner, updatedAt: new Date() };
  const [row] = d
    ? await db.update(DR).set(fields).where(eq(DR.id, d.id)).returning()
    : await db.insert(DR).values({ ...fields, orgId: s.orgId, folderId: v.folderId, root: v.root, nonce: randomBytes(16).toString("base64url"), createdBy: s.userId }).returning();
  await audit({ orgId: s.orgId, actorId: s.userId, action: d ? "documents.drop_updated" : "documents.drop_created", targetType: "doc_drop", targetId: row!.id, metadata: { enabled: v.enabled, stayMinutes: v.stayMinutes } });
  return { drop: shape(row!) };
}

/** A new link: the old QR stops working at once. */
export async function rotateDrop(s: Scope, id: string) {
  const [d] = await db.select().from(DR).where(and(eq(DR.id, id), eq(DR.orgId, s.orgId)));
  if (!d) throw notFound("Drive QR");
  await canManage(s, d.folderId, d.root as "team" | "mine");
  const [row] = await db.update(DR).set({ nonce: randomBytes(16).toString("base64url"), updatedAt: new Date() }).where(eq(DR.id, d.id)).returning();
  return { drop: shape(row!) };
}

/** Whether uploads are arriving here by QR now (the drive then refreshes every few seconds). */
export async function liveDrop(orgId: string, folderId: string | null, root: string, userId: string) {
  const [d] = await db.select({ id: DR.id }).from(DR).where(and(eq(DR.orgId, orgId), eq(DR.enabled, true), folderId ? eq(DR.folderId, folderId) : and(isNull(DR.folderId), eq(DR.root, root), ...(root === "mine" ? [eq(DR.createdBy, userId)] : []))));
  return !!d;
}

// ── Uploading by QR (no sign-in) ────────────────────────────────────────────

async function byDropToken(token: string) {
  const t = idOf(token);
  if (!t) return null;
  const [d] = await db.select().from(DR).where(eq(DR.id, t.id));
  if (!d || !d.enabled || !verify(DROP, d.id, d.nonce, t.sig)) return null;
  // The folder must still be there and not in the trash.
  if (d.folderId) {
    const [f] = await db.select({ deletedAt: schema.docFolders.deletedAt }).from(schema.docFolders).where(eq(schema.docFolders.id, d.folderId));
    if (!f || f.deletedAt) return null;
  }
  return d;
}

/** What the upload page shows: whose it is, where uploads go, and how long they stay. */
export async function dropView(token: string) {
  const d = await byDropToken(token);
  if (!d) throw notFound("This QR");
  const [[org], folder] = await Promise.all([
    db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, d.orgId)),
    d.folderId ? db.select({ name: schema.docFolders.name }).from(schema.docFolders).where(eq(schema.docFolders.id, d.folderId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  return { business: org?.name ?? "", place: d.name || folder?.name || (d.root === "mine" ? "My documents" : "Team documents"), stayMinutes: d.stayMinutes, choices: choicesFor(d.stayMinutes, d.uploaderChooses), maxMb: 25 };
}

export async function dropUpload(token: string, file: { name: string; bytes: Buffer }, rawMeta: unknown, who: Who) {
  const d = await byDropToken(token);
  if (!d) throw notFound("This QR");
  const meta = check(dropUploadMeta, rawMeta);
  // The stay: the uploader's pick when they may choose (and it's one on offer), otherwise the folder's.
  const offered = choicesFor(d.stayMinutes, d.uploaderChooses).map((c) => c.minutes);
  const stay = meta.stayMinutes !== undefined && offered.includes(meta.stayMinutes) ? meta.stayMinutes : d.stayMinutes;
  const t = checkBytes(file.name, file.bytes);
  await assertRoom(d.orgId, file.bytes.length);
  const now = new Date();
  const deleteAt = stay === null ? null : new Date(now.getTime() + stay * 60_000);
  const from = { name: meta.name, email: meta.email, ip: who.ip, userAgent: who.userAgent };
  const row = await db.transaction(async (tx) => {
    const [f] = await tx
      .insert(F)
      .values({ orgId: d.orgId, folderId: d.folderId, title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Upload", access: d.root === "mine" && !d.folderId ? "private" : "inherit", createdBy: d.createdBy, lastEditedBy: d.createdBy, deleteAt, dropId: d.id, dropFrom: from, dropNonce: randomBytes(16).toString("base64url") })
      .returning();
    await tx.insert(schema.docVersions).values({ orgId: d.orgId, fileId: f!.id, version: 1, filename: t.filename, mime: t.mime, size: file.bytes.length, sha256: t.sha256, data: file.bytes, createdBy: d.createdBy });
    await tx.update(DR).set({ uploads: sql`${DR.uploads} + 1`, lastUploadAt: now }).where(eq(DR.id, d.id));
    return f!;
  });
  await db.insert(schema.docActivity).values({ orgId: d.orgId, fileId: row.id, folderId: d.folderId, actorId: null, kind: "dropped", detail: { name: meta.name, email: meta.email, ip: who.ip, device: device(who.userAgent), stayMinutes: stay, size: file.bytes.length } });
  await audit({ orgId: d.orgId, actorId: null, action: "documents.dropped", targetType: "doc_file", targetId: row.id, metadata: { drop: d.id, size: file.bytes.length, stayMinutes: stay } });
  const link = `/documents/file/${row.id}`;
  if (d.notifyOwner) await notify(d.orgId, [d.createdBy], { kind: "documents.dropped", title: `New upload by QR: “${row.title}”`, body: `${meta.name || "Someone"} uploaded it from their phone${deleteAt ? `. It's deleted automatically ${when(deleteAt)}.` : "."}`, link, values: { who: meta.name || "Someone", title: row.title, link: appUrl(link) } });
  if (meta.email) {
    const org = (await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, d.orgId)))[0]?.name ?? "Cloudesk";
    await sendMail({
      to: meta.email,
      fromName: org,
      subject: `“${row.title}” was received by ${org}`,
      body: `Hello${meta.name ? ` ${meta.name}` : ""},\n\n${org} has received your document “${row.title}” (${t.filename}).\n\n${deleteAt ? `It will be deleted completely ${when(deleteAt)}.` : "It's kept until someone deletes it."}\n\nWe'll email you every time it's opened, printed, downloaded or changed.\n\nTo delete it now, open:\n${removeUrl(row)}\n`,
    }).catch(() => {});
  }
  return { title: row.title, filename: t.filename, deleteAt: deleteAt?.toISOString() ?? null, stay: stayLabel(stay) };
}

// ── Every access, logged — and told to the uploader ─────────────────────────

/** A view, download or print from the drive: logged (once a minute per person and kind), and told to the uploader. */
export async function logAccess(s: Pick<Scope, "orgId" | "userId">, fileId: string, kind: "viewed" | "downloaded" | "printed", who: Who) {
  const [recent] = await db
    .select({ id: schema.docActivity.id })
    .from(schema.docActivity)
    .where(and(eq(schema.docActivity.fileId, fileId), eq(schema.docActivity.kind, kind), eq(schema.docActivity.actorId, s.userId), sql`${schema.docActivity.at} > now() - interval '1 minute'`))
    .limit(1);
  if (recent) return;
  await db.insert(schema.docActivity).values({ orgId: s.orgId, fileId, actorId: s.userId, kind, detail: { ip: who.ip, device: device(who.userAgent) } });
  await tellUploader(s.orgId, fileId, s.userId, kind, { ip: who.ip, device: device(who.userAgent) });
}

/** Called after any logged action on a file: a QR upload's uploader hears about it at once, with a delete link. */
export async function tellUploader(orgId: string, fileId: string, actorId: string | null, kind: string, detail: Record<string, unknown> = {}) {
  if (!TELL_UPLOADER.has(kind)) return;
  const [f] = await db.select().from(F).where(and(eq(F.id, fileId), eq(F.orgId, orgId), isNotNull(F.dropId)));
  if (!f?.dropFrom?.email) return;
  const [[org], [actor]] = await Promise.all([
    db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId)),
    actorId ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, actorId)) : Promise.resolve([undefined]),
  ]);
  const what = (LOG_LABEL[kind] ?? kind).toLowerCase();
  const by = actor?.name ?? "Someone";
  const where = [detail.device, detail.ip].filter(Boolean).join(" · ");
  const stays = kind === "deleted" ? "" : f.deleteAt ? `\n\nIt will be deleted completely ${when(f.deleteAt)}.` : "\n\nIt's kept until someone deletes it.";
  await sendMail({
    to: f.dropFrom.email,
    fromName: org?.name ?? "Cloudesk",
    subject: kind === "deleted" ? `“${f.title}” was deleted` : `“${f.title}” was ${what}`,
    body: `Hello${f.dropFrom.name ? ` ${f.dropFrom.name}` : ""},\n\nThe document you uploaded to ${org?.name ?? "them"} — “${f.title}” — was just ${what}.\n\nBy: ${by}\nWhen: ${when(new Date())}${where ? `\nFrom: ${where}` : ""}${stays}${kind === "deleted" ? "" : `\n\nTo delete it now, open:\n${removeUrl(f)}`}\n`,
  }).catch(() => {});
}

// ── How long it stays, and deleting completely ──────────────────────────────

export async function setStay(s: Scope, fileId: string, raw: unknown) {
  const { file: f, role } = await getFileAs(s, fileId);
  if (role !== "edit") throw new ApiError("forbidden", "Only people who can edit this can change when it's deleted");
  const v = check(stayMinutes, (raw as { minutes?: unknown })?.minutes ?? null);
  const deleteAt = v === null ? null : new Date(Date.now() + v * 60_000);
  await db.update(F).set({ deleteAt, updatedAt: new Date() }).where(eq(F.id, f.id));
  await db.insert(schema.docActivity).values({ orgId: s.orgId, fileId: f.id, actorId: s.userId, kind: "stay_changed", detail: { stayMinutes: v } });
  await tellUploader(s.orgId, f.id, s.userId, "stay_changed");
  return { deleteAt: deleteAt?.toISOString() ?? null };
}

/** Deletes files completely (versions, log, comments… by cascade; stars by hand), telling each QR uploader. */
export async function eraseFiles(rows: FileRow[], reason: "expired" | "removed" | "deleted", actorId: string | null = null) {
  if (!rows.length) return 0;
  for (const f of rows) if (f.dropFrom?.email && reason !== "removed") await tellUploader(f.orgId, f.id, actorId, "deleted", { reason });
  const ids = rows.map((f) => f.id);
  await db.transaction(async (tx) => {
    await tx.delete(schema.docStars).where(inArray(schema.docStars.itemId, ids));
    await tx.delete(F).where(inArray(F.id, ids));
  });
  for (const f of rows) await audit({ orgId: f.orgId, actorId, action: reason === "expired" ? "documents.expired" : reason === "removed" ? "documents.removed_by_uploader" : "documents.deleted", targetType: "doc_file", targetId: f.id, metadata: { title: f.title, dropped: !!f.dropId } });
  return rows.length;
}

/** Every minute: whatever has reached its time is deleted completely. */
export async function expireTick() {
  const due = await db.select().from(F).where(and(isNotNull(F.deleteAt), lte(F.deleteAt, new Date()))).limit(200);
  return { deleted: await eraseFiles(due, "expired") };
}

// ── The uploader's delete link (no sign-in) ─────────────────────────────────

async function byRemoveToken(token: string) {
  const t = idOf(token);
  if (!t) return null;
  const [f] = await db.select().from(F).where(eq(F.id, t.id));
  if (!f?.dropNonce || !verify(REMOVE, f.id, f.dropNonce, t.sig)) return null;
  return f;
}

export async function removeView(token: string) {
  const f = await byRemoveToken(token);
  if (!f) return { gone: true as const };
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, f.orgId));
  return { gone: false as const, title: f.title, business: org?.name ?? "", uploadedAt: f.createdAt.toISOString(), deleteAt: f.deleteAt?.toISOString() ?? null };
}

export async function removeByToken(token: string, who: Who) {
  const f = await byRemoveToken(token);
  if (!f) return { deleted: false };
  await eraseFiles([f], "removed");
  const owner = f.createdBy;
  if (owner) await notify(f.orgId, [owner], { kind: "documents.dropped", title: `“${f.title}” was deleted by whoever uploaded it`, body: `They used the delete link from their email${who.ip ? ` (${who.ip})` : ""}.`, link: "/documents", values: { who: f.dropFrom?.name || "The uploader", title: f.title, link: appUrl("/documents") } });
  if (f.dropFrom?.email) {
    const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, f.orgId));
    await sendMail({ to: f.dropFrom.email, fromName: org?.name ?? "Cloudesk", subject: `“${f.title}” is deleted`, body: `Hello${f.dropFrom.name ? ` ${f.dropFrom.name}` : ""},\n\nAs you asked, “${f.title}” has been deleted completely from ${org?.name ?? "their"} drive — every copy and its history.\n` }).catch(() => {});
  }
  return { deleted: true };
}

// ── Small helpers ───────────────────────────────────────────────────────────

const when = (d: Date) => `on ${d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} IST`;

/** "iPhone · Safari" from a user agent, for the log and emails. */
export function device(ua: string | null | undefined) {
  if (!ua) return null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ") || null;
}
