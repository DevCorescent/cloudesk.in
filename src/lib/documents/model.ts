// Documents, contracts & e-sign: folders with access, files with versions,
// a contract register (terms, renewals, notice dates, obligations) and
// signature requests signed by link. The sums: what a file really is (from
// its bytes), when a contract renews and when notice is due, and whose turn
// it is to sign.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FOLDER_ACCESS = ["team", "managers", "members", "private"] as const;
export const FOLDER_ACCESS_LABEL: Record<(typeof FOLDER_ACCESS)[number], string> = { team: "Everyone on the team", managers: "Owners and admins", members: "Chosen people (and owners and admins)", private: "Only me (and people I share it with)" };
export const FILE_STATUSES = ["draft", "final", "archived"] as const;
export const LINK_TYPES = ["crm_deal", "crm_company", "crm_contact", "hr_employee", "work_project", "inv_supplier", "sales_order", "mnt_asset"] as const;
export const LINK_LABEL: Record<(typeof LINK_TYPES)[number], string> = { crm_deal: "Deal", crm_company: "Company", crm_contact: "Contact", hr_employee: "Employee", work_project: "Project", inv_supplier: "Supplier", sales_order: "Sales order", mnt_asset: "Asset" };
export const CONTRACT_KINDS = ["customer", "vendor", "nda", "msa", "employment", "lease", "service", "partnership", "other"] as const;
export const CONTRACT_KIND_LABEL: Record<(typeof CONTRACT_KINDS)[number], string> = { customer: "Customer", vendor: "Vendor", nda: "NDA", msa: "Master services", employment: "Employment", lease: "Lease", service: "Service", partnership: "Partnership", other: "Other" };
export const CONTRACT_STATUSES = ["draft", "review", "approved", "signing", "signed", "terminated"] as const;
export const CONTRACT_STATUS_LABEL: Record<(typeof CONTRACT_STATUSES)[number], string> = { draft: "Draft", review: "In review", approved: "Approved", signing: "Out for signature", signed: "Signed", terminated: "Terminated" };

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ORG_BYTES = 1024 * 1024 * 1024;

export const settingsSchema = z
  .object({
    contractPrefix: z.string().trim().min(1).max(10).default("CTR-"),
    /** Days ahead that renewals, notice dates, expiring files and obligations are flagged. */
    alertDays: z.number().int().min(1).max(365).default(30),
    /** Days a signing link stays open. */
    signDays: z.number().int().min(1).max(90).default(14),
  })
  .prefault({});
export type DocSettings = z.infer<typeof settingsSchema>;

export const folderSchema = z.object({
  name: z.string().trim().min(1, "Name the folder").max(120),
  parentId: z.uuid().nullable().default(null),
  access: z.enum(FOLDER_ACCESS).default("team"),
  memberIds: z.array(z.uuid()).max(200).default([]),
  color: z.string().max(12).default(""),
});

export const fileMetaSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  folderId: z.uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status: z.enum(FILE_STATUSES).default("final"),
  expiresOn: day.nullable().default(null),
  linkType: z.enum(LINK_TYPES).nullable().default(null),
  linkId: z.uuid().nullable().default(null),
  notes: z.string().trim().max(4000).default(""),
});

export const obligationSchema = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(300), due: day.nullable().default(null), ownerId: z.uuid().nullable().default(null), done: z.boolean().default(false) });

export const contractSchema = z.object({
  title: z.string().trim().min(1, "Name the contract").max(200),
  kind: z.enum(CONTRACT_KINDS).default("customer"),
  counterparty: z.string().trim().min(1, "Who's it with?").max(160),
  counterpartyEmail: z.union([z.literal(""), z.email()]).default(""),
  ownerId: z.uuid().nullable().default(null),
  /** Total value, paise. */
  value: z.number().int().min(0).max(1e13).default(0),
  startOn: day.nullable().default(null),
  endOn: day.nullable().default(null),
  autoRenew: z.boolean().default(false),
  renewalMonths: z.number().int().min(1).max(120).default(12),
  noticeDays: z.number().int().min(0).max(365).default(30),
  fileId: z.uuid().nullable().default(null),
  linkType: z.enum(LINK_TYPES).nullable().default(null),
  linkId: z.uuid().nullable().default(null),
  obligations: z.array(obligationSchema).max(100).default([]),
  notes: z.string().trim().max(4000).default(""),
});

export const signRequestSchema = z.object({
  fileId: z.uuid(),
  contractId: z.uuid().nullable().default(null),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(2000).default(""),
  /** One after another, in order; otherwise everyone at once. */
  sequential: z.boolean().default(true),
  signers: z.array(z.object({ name: z.string().trim().min(1, "Name each signer").max(120), email: z.email("Enter each signer's email") })).min(1, "Add someone to sign").max(20),
});

export const addMonths = (d: string, n: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(dd, last));
  return t.toISOString().slice(0, 10);
};
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Where a contract stands today: the end of the current term (an auto-renewing
 * one rolls forward a term at a time), the last day to give notice, and whether
 * it's running, coming up for renewal or notice, or over.
 */
export function contractTerm(c: { startOn: string | null; endOn: string | null; autoRenew: boolean; renewalMonths: number; noticeDays: number; status: string }, today: string, alertDays: number) {
  if (c.status === "terminated") return { termEnd: c.endOn, noticeBy: null, renewals: 0, state: "terminated" as const };
  if (!c.endOn) return { termEnd: null, noticeBy: null, renewals: 0, state: c.startOn && c.startOn > today ? ("upcoming" as const) : ("open_ended" as const) };
  let end = c.endOn;
  let renewals = 0;
  while (c.autoRenew && end < today && renewals < 1200) {
    end = addMonths(end, c.renewalMonths);
    renewals++;
  }
  const noticeBy = c.autoRenew ? addDays(end, -c.noticeDays) : null;
  const soon = addDays(today, alertDays);
  const state = c.startOn && c.startOn > today ? "upcoming" : end < today ? "expired" : noticeBy && noticeBy >= today && noticeBy <= soon ? "notice_due" : end <= soon ? (c.autoRenew ? "renewing" : "ending") : "active";
  return { termEnd: end, noticeBy, renewals, state: state as "upcoming" | "expired" | "notice_due" | "renewing" | "ending" | "active" };
}

/** Who may sign now: everyone still waiting, or (in order) only the first who hasn't signed. */
export function turn<S extends { order: number; status: string }>(signers: S[], sequential: boolean) {
  const left = signers.filter((s) => s.status !== "signed").sort((a, b) => a.order - b.order);
  if (left.some((s) => s.status === "declined")) return [];
  return sequential ? left.slice(0, 1) : left;
}

/** What a file is, from its first bytes — never from its name. Executables and scripts are refused. */
export function sniffFile(b: Uint8Array, name: string): { mime: string; ext: string } | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  const lower = name.toLowerCase();
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return { mime: "application/pdf", ext: "pdf" };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { mime: "image/png", ext: "png" };
  if (at(0, 0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { mime: "image/webp", ext: "webp" };
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) {
    const head = Buffer.from(b.subarray(0, Math.min(b.length, 4000))).toString("latin1");
    if (head.includes("word/")) return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    if (head.includes("xl/")) return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    if (head.includes("ppt/")) return { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" };
    return { mime: "application/zip", ext: "zip" };
  }
  // Plain text (notes, CSV): no NUL bytes in the first 8 KB, and a text-like name.
  if (/\.(txt|csv|md|json|html?)$/.test(lower) && !b.subarray(0, 8192).includes(0)) {
    const ext = lower.split(".").pop()!;
    // HTML is kept as a file to download (it's never shown inline), JSON as data.
    return { mime: ext === "csv" ? "text/csv" : ext === "json" ? "application/json" : ext.startsWith("htm") ? "text/html" : "text/plain", ext };
  }
  return null;
}

/** Bytes as KB/MB for people. */
export const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
