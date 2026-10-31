// E-signatures: a file version sent to signers (in order, or all at once),
// each with a private link whose secret is stored only as a hash. Signers
// open the link, see the exact file, type their name and agree; views,
// signatures and declines are logged with time, IP and browser. When the last
// signs, a certificate of completion (a PDF of the whole trail, with the
// file's SHA-256) is made and a linked contract becomes signed.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { signRequestSchema, turn } from "@/lib/documents/model";
import { textPdf } from "@/lib/documents/pdf";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { sha256 } from "../security/tokens";
import { audit } from "../services/audit";
import { appUrl, mailConfigured, sendMail } from "../services/mail";
import { check, getFile, requireWrite, type Scope } from "./access";

type Request = typeof schema.docSignRequests.$inferSelect;
type Signer = typeof schema.docSigners.$inferSelect;
type Who = { ip: string | null; userAgent: string | null };
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

async function event(requestId: string, kind: string, detail = "", signerId: string | null = null, who: Who = { ip: null, userAgent: null }) {
  await db.insert(schema.docSignEvents).values({ requestId, signerId, kind, detail: detail.slice(0, 500), ip: who.ip, userAgent: who.userAgent?.slice(0, 300) ?? null });
}

/** A fresh link for a signer: the secret goes in the link and only its hash is kept. Emailed when email is set up. */
async function issueLink(r: Request, sg: Signer, orgName: string, senderName: string) {
  const token = randomBytes(32).toString("base64url");
  await db.update(schema.docSigners).set({ tokenHash: sha256(token), status: sg.status === "viewed" ? "viewed" : "sent" }).where(eq(schema.docSigners.id, sg.id));
  const url = appUrl(`/sign/${token}`);
  await sendMail({ to: sg.email, subject: `${senderName} sent you “${r.title}” to sign`, fromName: orgName, body: `Hello ${sg.name},\n\n${senderName} at ${orgName} has asked you to sign “${r.title}”.${r.message ? `\n\n${r.message}` : ""}\n\nOpen it here to read and sign:\n${url}\n\nThe link is yours alone — don't forward it. It stays open until ${r.expiresAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}.` });
  await event(r.id, "sent", `Link sent to ${sg.email}${mailConfigured() ? "" : " (email isn't set up: recorded in the outbox only)"}`, sg.id);
  return { signerId: sg.id, name: sg.name, email: sg.email, url };
}

async function names(orgId: string, userId: string) {
  const [[o], [u]] = await Promise.all([db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, orgId)), db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId))]);
  return { org: o?.name ?? "Cloudesk", sender: u?.name ?? "Someone" };
}

/** Send the file's current version for signature. Returns each signing link — this is the only time they're shown. */
export async function createRequest(s: Scope, raw: unknown) {
  requireWrite(s);
  const v = check(signRequestSchema, raw);
  const f = await getFile(s, v.fileId);
  if (f.status === "archived") throw new ApiError("conflict", "This file is archived");
  const emails = v.signers.map((x) => x.email.toLowerCase());
  if (new Set(emails).size !== emails.length) throw new ApiError("validation_failed", "Each signer needs their own email", { signers: ["Same email twice"] });
  const [ver] = await db.select().from(schema.docVersions).where(and(eq(schema.docVersions.fileId, f.id), eq(schema.docVersions.version, f.version)));
  let contract: typeof schema.docContracts.$inferSelect | null = null;
  if (v.contractId) {
    if (!isId(v.contractId)) throw notFound("Contract");
    [contract] = await db.select().from(schema.docContracts).where(and(eq(schema.docContracts.id, v.contractId), eq(schema.docContracts.orgId, s.orgId)));
    if (!contract) throw notFound("Contract");
    if (!["approved", "signing"].includes(contract.status)) throw new ApiError("conflict", contract.status === "draft" || contract.status === "review" ? "The contract needs approving before it goes for signature" : `The contract is ${contract.status}`);
  }
  const expiresAt = new Date(Date.now() + s.settings.signDays * 86_400_000);
  const [r] = await db.insert(schema.docSignRequests).values({ orgId: s.orgId, fileId: f.id, versionId: ver.id, sha256: ver.sha256, contractId: contract?.id ?? null, title: v.title, message: v.message, sequential: v.sequential, expiresAt, createdBy: s.userId }).returning();
  const signers = await db.insert(schema.docSigners).values(v.signers.map((x, i) => ({ requestId: r.id, name: x.name, email: x.email.toLowerCase(), order: i + 1 }))).returning();
  await event(r.id, "created", `“${ver.filename}” version ${ver.version}, SHA-256 ${ver.sha256}`);
  if (contract) await db.update(schema.docContracts).set({ status: "signing", fileId: f.id }).where(eq(schema.docContracts.id, contract.id));
  const n = await names(s.orgId, s.userId);
  const links = [];
  for (const sg of turn(signers, v.sequential)) links.push(await issueLink(r, sg, n.org, n.sender));
  await audit({ orgId: s.orgId, actorId: s.userId, action: "documents.sent_for_signature", targetType: "doc_sign_request", targetId: r.id, metadata: { signers: signers.length, sha256: ver.sha256 } });
  return { request: r, links, emailed: mailConfigured() };
}

async function getRequest(s: Scope, id: string) {
  if (!isId(id)) throw notFound("Signature request");
  const [r] = await db.select().from(schema.docSignRequests).where(and(eq(schema.docSignRequests.id, id), eq(schema.docSignRequests.orgId, s.orgId)));
  if (!r) throw notFound("Signature request");
  await getFile(s, r.fileId);
  return expireIfDue(r);
}

async function expireIfDue(r: Request) {
  if (r.status === "sent" && r.expiresAt.getTime() < Date.now()) {
    await db.update(schema.docSignRequests).set({ status: "expired" }).where(and(eq(schema.docSignRequests.id, r.id), eq(schema.docSignRequests.status, "sent")));
    await event(r.id, "expired");
    return { ...r, status: "expired" };
  }
  return r;
}

export async function requests(s: Scope, q: { status?: string } = {}) {
  const rows = await db.select().from(schema.docSignRequests).where(and(eq(schema.docSignRequests.orgId, s.orgId), q.status ? eq(schema.docSignRequests.status, q.status) : undefined)).orderBy(desc(schema.docSignRequests.createdAt)).limit(500);
  const signers = rows.length ? await db.select({ requestId: schema.docSigners.requestId, name: schema.docSigners.name, status: schema.docSigners.status, order: schema.docSigners.order }).from(schema.docSigners).where(inArray(schema.docSigners.requestId, rows.map((r) => r.id))).orderBy(asc(schema.docSigners.order)) : [];
  return Promise.all(rows.map(async (r) => ({ ...(await expireIfDue(r)), certificate: undefined, hasCertificate: !!r.certificate, signers: signers.filter((x) => x.requestId === r.id) })));
}

export async function requestDetail(s: Scope, id: string) {
  const r = await getRequest(s, id);
  const [signers, events, [ver]] = await Promise.all([
    db.select({ id: schema.docSigners.id, name: schema.docSigners.name, email: schema.docSigners.email, order: schema.docSigners.order, status: schema.docSigners.status, viewedAt: schema.docSigners.viewedAt, signedAt: schema.docSigners.signedAt, signedName: schema.docSigners.signedName, ip: schema.docSigners.ip, declineReason: schema.docSigners.declineReason }).from(schema.docSigners).where(eq(schema.docSigners.requestId, r.id)).orderBy(asc(schema.docSigners.order)),
    db.select().from(schema.docSignEvents).where(eq(schema.docSignEvents.requestId, r.id)).orderBy(asc(schema.docSignEvents.at)),
    db.select({ version: schema.docVersions.version, filename: schema.docVersions.filename }).from(schema.docVersions).where(eq(schema.docVersions.id, r.versionId)),
  ]);
  return { request: { ...r, certificate: undefined, hasCertificate: !!r.certificate }, signers, events, version: ver, turn: r.status === "sent" ? turn(signers, r.sequential).map((x) => x.id) : [] };
}

/** A new link for someone whose turn it is (the old one stops working). */
export async function remind(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const r = await getRequest(s, id);
  if (r.status !== "sent") throw new ApiError("conflict", `This request is ${r.status}`);
  const { signerId } = check(z.object({ signerId: z.uuid() }), raw);
  const signers = await db.select().from(schema.docSigners).where(eq(schema.docSigners.requestId, r.id));
  const sg = turn(signers, r.sequential).find((x) => x.id === signerId);
  if (!sg) throw new ApiError("conflict", "It isn't their turn to sign, or they already have");
  const n = await names(s.orgId, s.userId);
  return { link: await issueLink(r, sg, n.org, n.sender), emailed: mailConfigured() };
}

export async function voidRequest(s: Scope, id: string, raw: unknown) {
  requireWrite(s);
  const r = await getRequest(s, id);
  if (r.status !== "sent") throw new ApiError("conflict", `This request is ${r.status}`);
  const { reason } = check(z.object({ reason: z.string().trim().max(300).default("") }), raw);
  await db.update(schema.docSignRequests).set({ status: "voided" }).where(eq(schema.docSignRequests.id, r.id));
  await db.update(schema.docSigners).set({ tokenHash: null }).where(eq(schema.docSigners.requestId, r.id));
  await event(r.id, "voided", reason);
  if (r.contractId) await db.update(schema.docContracts).set({ status: "approved" }).where(and(eq(schema.docContracts.id, r.contractId), eq(schema.docContracts.status, "signing")));
}

export async function certificate(s: Scope, id: string) {
  const r = await getRequest(s, id);
  if (!r.certificate) throw new ApiError("conflict", "The certificate is made once everyone has signed");
  return new Response(new Uint8Array(r.certificate), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="certificate-${r.id.slice(0, 8)}.pdf"`, "X-Content-Type-Options": "nosniff" } });
}

// ── Signing by link (no account) ────────────────────────────────────────────

async function bySigner(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw notFound("Signing link");
  const [sg] = await db.select().from(schema.docSigners).where(eq(schema.docSigners.tokenHash, sha256(token)));
  if (!sg) throw notFound("Signing link");
  const [r0] = await db.select().from(schema.docSignRequests).where(eq(schema.docSignRequests.id, sg.requestId));
  if (!r0) throw notFound("Signing link");
  const r = await expireIfDue(r0);
  const signers = await db.select().from(schema.docSigners).where(eq(schema.docSigners.requestId, r.id));
  return { sg, r, signers };
}

/** What the signer sees: the request, the file, everyone's progress, and whether they can sign now. */
export async function signingView(token: string) {
  const { sg, r, signers } = await bySigner(token);
  const [ver] = await db.select({ filename: schema.docVersions.filename, mime: schema.docVersions.mime, size: schema.docVersions.size, version: schema.docVersions.version }).from(schema.docVersions).where(eq(schema.docVersions.id, r.versionId));
  const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, r.orgId));
  const now = turn(signers, r.sequential).some((x) => x.id === sg.id);
  return {
    from: org?.name ?? "",
    title: r.title,
    message: r.message,
    status: r.status,
    file: { ...ver, sha256: r.sha256 },
    me: { name: sg.name, email: sg.email, status: sg.status, signedAt: sg.signedAt },
    signers: signers.sort((a, b) => a.order - b.order).map((x) => ({ name: x.name, status: x.status, me: x.id === sg.id })),
    canSign: r.status === "sent" && now && sg.status !== "signed",
    expiresAt: r.expiresAt,
  };
}

export async function signingFile(token: string, who: Who) {
  const { sg, r } = await bySigner(token);
  if (!["sent", "completed"].includes(r.status)) throw new ApiError("forbidden", `This request is ${r.status}`);
  const [v] = await db.select().from(schema.docVersions).where(eq(schema.docVersions.id, r.versionId));
  if (!sg.viewedAt) {
    await db.update(schema.docSigners).set({ viewedAt: new Date(), status: sg.status === "sent" ? "viewed" : sg.status }).where(eq(schema.docSigners.id, sg.id));
    await event(r.id, "viewed", `${sg.name} opened the file`, sg.id, who);
  }
  const inline = v.mime === "application/pdf" || v.mime.startsWith("image/");
  return new Response(new Uint8Array(v.data), { headers: { "Content-Type": v.mime, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${v.filename.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff", ...(v.mime === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }) } });
}

const signSchema = z.object({ name: z.string().trim().min(2, "Type your full name").max(120), consent: z.literal(true, "Agree to sign electronically") });

export async function sign(token: string, raw: unknown, who: Who) {
  const v = check(signSchema, raw);
  const { sg, r, signers } = await bySigner(token);
  if (r.status !== "sent") throw new ApiError("conflict", `This request is ${r.status}`);
  if (sg.status === "signed") throw new ApiError("conflict", "You've already signed");
  if (!turn(signers, r.sequential).some((x) => x.id === sg.id)) throw new ApiError("conflict", "It isn't your turn to sign yet");
  if (!sg.viewedAt) throw new ApiError("conflict", "Open the document before signing it");
  const at = new Date();
  const [done] = await db.update(schema.docSigners).set({ status: "signed", signedAt: at, signedName: v.name, ip: who.ip, userAgent: who.userAgent?.slice(0, 300) ?? null }).where(and(eq(schema.docSigners.id, sg.id), inArray(schema.docSigners.status, ["sent", "viewed"]))).returning();
  if (!done) throw new ApiError("conflict", "You've already signed");
  await event(r.id, "signed", `${sg.name} <${sg.email}> signed as “${v.name}” and agreed to sign electronically`, sg.id, who);
  const all = await db.select().from(schema.docSigners).where(eq(schema.docSigners.requestId, r.id));
  if (all.every((x) => x.status === "signed")) await complete(r);
  else if (r.sequential) {
    const next = turn(all, true)[0];
    if (next && next.status === "waiting") {
      const n = await names(r.orgId, r.createdBy ?? "");
      await issueLink(r, next, n.org, n.sender);
    }
  }
  return { status: "signed" };
}

export async function decline(token: string, raw: unknown, who: Who) {
  const { reason } = check(z.object({ reason: z.string().trim().min(1, "Say why").max(500) }), raw);
  const { sg, r } = await bySigner(token);
  if (r.status !== "sent") throw new ApiError("conflict", `This request is ${r.status}`);
  if (sg.status === "signed") throw new ApiError("conflict", "You've already signed");
  await db.update(schema.docSigners).set({ status: "declined", declineReason: reason, ip: who.ip, userAgent: who.userAgent?.slice(0, 300) ?? null }).where(eq(schema.docSigners.id, sg.id));
  await db.update(schema.docSignRequests).set({ status: "declined" }).where(eq(schema.docSignRequests.id, r.id));
  await event(r.id, "declined", `${sg.name} declined: ${reason}`, sg.id, who);
  if (r.contractId) await db.update(schema.docContracts).set({ status: "approved" }).where(and(eq(schema.docContracts.id, r.contractId), eq(schema.docContracts.status, "signing")));
  if (r.createdBy) await notify(r.orgId, [r.createdBy], { kind: "documents.declined", title: `${sg.name} declined to sign “${r.title}”`, body: reason, link: `/documents/signatures/${r.id}`, values: { title: r.title, name: sg.name } }).catch(() => {});
  return { status: "declined" };
}

/** Everyone has signed: the certificate of completion, the contract signed, the sender told. */
async function complete(r: Request) {
  const [signers, events, [ver], [org]] = await Promise.all([
    db.select().from(schema.docSigners).where(eq(schema.docSigners.requestId, r.id)).orderBy(asc(schema.docSigners.order)),
    db.select().from(schema.docSignEvents).where(eq(schema.docSignEvents.requestId, r.id)).orderBy(asc(schema.docSignEvents.at)),
    db.select().from(schema.docVersions).where(eq(schema.docVersions.id, r.versionId)),
    db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, r.orgId)),
  ]);
  const ist = (d: Date | null) => (d ? `${new Date(d.getTime() + 5.5 * 3600_000).toISOString().replace("T", " ").slice(0, 19)} IST` : "-");
  const now = new Date();
  const pdf = textPdf(
    [
      { text: "Certificate of completion", size: 18, bold: true },
      { text: `${r.title}`, size: 12, gap: 4 },
      { text: `Sent by ${org?.name ?? ""} through Cloudesk. Completed ${ist(now)}.`, size: 9, gap: 2 },
      { text: "Document", size: 12, bold: true, gap: 14 },
      { text: `File: ${ver.filename} (version ${ver.version}, ${ver.size} bytes)` },
      { text: `SHA-256: ${r.sha256}` },
      { text: "Anyone can check a copy is the one that was signed by computing its SHA-256 and comparing it with the value above.", size: 8, gap: 2 },
      { text: "Signers", size: 12, bold: true, gap: 14 },
      ...signers.flatMap((sg) => [
        { text: `${sg.order}. ${sg.name} <${sg.email}>`, bold: true, gap: 6 },
        { text: `Signed as "${sg.signedName}" on ${ist(sg.signedAt)}` },
        { text: `First opened ${ist(sg.viewedAt)} - IP ${sg.ip ?? "-"}` },
        { text: `Browser: ${sg.userAgent ?? "-"}`, size: 8 },
      ]),
      { text: "Trail", size: 12, bold: true, gap: 14 },
      ...events.map((e) => ({ text: `${ist(e.at)}  ${e.kind}  ${e.detail}${e.ip ? `  [${e.ip}]` : ""}`, size: 8 })),
      { text: `${ist(now)}  completed  All signers signed`, size: 8 },
      { text: "These are electronic signatures given by clicking to sign with an audit trail. They are not Aadhaar eSign or digital signature certificates.", size: 8, gap: 14 },
    ],
    { title: `Certificate of completion - ${r.title}` },
  );
  const [ok] = await db.update(schema.docSignRequests).set({ status: "completed", completedAt: now, certificate: pdf }).where(and(eq(schema.docSignRequests.id, r.id), eq(schema.docSignRequests.status, "sent"))).returning({ id: schema.docSignRequests.id });
  if (!ok) return;
  // Links stay readable (signers can see it's done and open the file) until the request would have expired.
  await event(r.id, "completed", "All signers signed; certificate made");
  if (r.contractId) await db.update(schema.docContracts).set({ status: "signed" }).where(and(eq(schema.docContracts.id, r.contractId), eq(schema.docContracts.status, "signing")));
  if (r.createdBy) await notify(r.orgId, [r.createdBy], { kind: "documents.signed", title: `“${r.title}” is signed by everyone`, body: signers.map((x) => x.name).join(", "), link: `/documents/signatures/${r.id}`, values: { title: r.title } }).catch(() => {});
}
