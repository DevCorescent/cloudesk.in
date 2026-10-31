// Approvals: which documents can need approval, how a policy is written, and
// the rules for working out whose turn it is. Shared by the server (which
// enforces them) and the screens (which explain them). Amounts are in paise.
import { z } from "zod";
import type { ModuleId } from "@/lib/workspace/modules";

export const APPROVAL_KINDS = {
  "acc.bill": { label: "Supplier bills", noun: "bill", module: "accounting", amount: "Bill total" },
  "acc.expense": { label: "Expenses", noun: "expense", module: "accounting", amount: "Expense total" },
  "acc.journal": { label: "Manual journals", noun: "journal", module: "accounting", amount: "Journal total" },
  "acc.payment_run": { label: "Payment runs", noun: "payment run", module: "accounting", amount: "Run total" },
  "inv.po": { label: "Purchase orders", noun: "purchase order", module: "inventory", amount: "Order total" },
  "inv.supplier_bank": { label: "Supplier bank detail changes", noun: "bank detail change", module: "inventory", amount: "Always 0 — use any amount" },
  "inv.requisition": { label: "Purchase requisitions", noun: "requisition", module: "inventory", amount: "Estimated value" },
  "hr.claim": { label: "Expense claims", noun: "claim", module: "hr", amount: "Claim amount" },
  "hr.payroll": { label: "Payroll runs", noun: "payroll run", module: "hr", amount: "Net pay" },
  "hr.trip": { label: "Business trips", noun: "trip", module: "hr", amount: "Estimate plus advance" },
  "hr.settlement": { label: "Full and final settlements", noun: "settlement", module: "hr", amount: "Net settlement" },
  "sales.order": { label: "Sales orders (discount or credit)", noun: "sales order", module: "sales", amount: "Order total" },
  "doc.contract": { label: "Contracts", noun: "contract", module: "documents", amount: "Contract value" },
  "work.change": { label: "Project change requests", noun: "change request", module: "work", amount: "Change in fee" },
} as const satisfies Record<string, { label: string; noun: string; module: ModuleId; amount: string }>;
export type ApprovalKind = keyof typeof APPROVAL_KINDS;
export const KIND_IDS = Object.keys(APPROVAL_KINDS) as ApprovalKind[];
export const isKind = (k: string): k is ApprovalKind => k in APPROVAL_KINDS;

export const ROLE_NAMES = ["owner", "admin", "billing", "developer", "designer", "editor", "viewer"] as const;
const money = z.number().int().min(0).max(1e13);

/**
 * Who can approve a step:
 * - a named person;
 * - anyone with a role;
 * - the requester's manager (from HR's reporting line);
 * - anyone in a user group (Settings → Organisation);
 * - each approver can carry a limit — above it, their approval doesn't count.
 */
export const approverSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.uuid(), limit: money.nullable().default(null) }),
  z.object({ type: z.literal("role"), role: z.enum(ROLE_NAMES), limit: money.nullable().default(null) }),
  z.object({ type: z.literal("manager"), limit: money.nullable().default(null) }),
  z.object({ type: z.literal("group"), groupId: z.uuid(), limit: money.nullable().default(null) }),
]);
export type Approver = z.infer<typeof approverSchema>;

export const stepSchema = z.object({
  name: z.string().trim().min(1, "Name the step").max(80),
  /** any: one approval is enough. all: everyone named must approve (in parallel). */
  mode: z.enum(["any", "all"]).default("any"),
  approvers: z.array(approverSchema).min(1, "Add at least one approver").max(20),
  /** The step only applies at or above this amount (e.g. finance signs off over ₹1 lakh). */
  minAmount: money.nullable().default(null),
  /** Hours before it's escalated; null never escalates. */
  slaHours: z.number().int().min(1).max(24 * 30).nullable().default(null),
  /** Told when the step is overdue (owners when empty). */
  escalateTo: z.array(z.uuid()).max(10).default([]),
});
export type Step = z.infer<typeof stepSchema>;

export const conditionsSchema = z.object({
  minAmount: money.nullable().default(null),
  maxAmount: money.nullable().default(null),
  /** HR departments of the requester; empty means any. */
  departmentIds: z.array(z.uuid()).max(50).default([]),
});
export type Conditions = z.infer<typeof conditionsSchema>;

export const policySchema = z.object({
  kind: z.enum(KIND_IDS as [ApprovalKind, ...ApprovalKind[]]),
  name: z.string().trim().min(1, "Name the policy").max(120),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(0),
  conditions: conditionsSchema.default({ minAmount: null, maxAmount: null, departmentIds: [] }),
  steps: z.array(stepSchema).min(1, "Add at least one step").max(8),
});
export type PolicyInput = z.infer<typeof policySchema>;

export const delegationSchema = z.object({
  toUserId: z.uuid(),
  starts: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kinds: z.array(z.enum(KIND_IDS as [ApprovalKind, ...ApprovalKind[]])).max(KIND_IDS.length).default([]),
  note: z.string().trim().max(300).default(""),
});

/** Does a policy apply to this document? */
export function matches(c: Conditions, doc: { amount: number; departmentId: string | null }) {
  if (c.minAmount !== null && doc.amount < c.minAmount) return false;
  if (c.maxAmount !== null && doc.amount > c.maxAmount) return false;
  if (c.departmentIds.length && (!doc.departmentId || !c.departmentIds.includes(doc.departmentId))) return false;
  return true;
}

/** The steps a document of this amount goes through. */
export const stepsFor = (steps: Step[], amount: number) => steps.filter((s) => s.minAmount === null || amount >= s.minAmount);

/**
 * How many approver slots can be filled by different people who have
 * approved (each person fills at most one slot, and only within their limit).
 * A small bipartite matching: steps have at most 20 slots.
 */
function filled(step: Step, slots: string[][], approvedBy: Set<string>, amount: number) {
  const eligible = step.approvers.map((a, i) => (a.limit === null || amount <= a.limit ? slots[i].filter((u) => approvedBy.has(u)) : []));
  const owner = new Map<string, number>();
  const tryAssign = (slot: number, seen: Set<string>): boolean => {
    for (const u of eligible[slot]) {
      if (seen.has(u)) continue;
      seen.add(u);
      const cur = owner.get(u);
      if (cur === undefined || tryAssign(cur, seen)) {
        owner.set(u, slot);
        return true;
      }
    }
    return false;
  };
  let n = 0;
  for (let i = 0; i < eligible.length; i++) if (tryAssign(i, new Set())) n++;
  return n;
}

/** Where a step stands: "any" needs one slot filled; "all" needs every slot filled, each by a different person. */
export function stepDone(step: Step, slots: string[][], approvedBy: Set<string>, amount: number) {
  const n = filled(step, slots, approvedBy, amount);
  return step.mode === "any" ? n > 0 : n === step.approvers.length;
}

/** Whether this person's approval would count: they haven't approved yet, and it would fill a slot no one else has. */
export function canAct(step: Step, slots: string[][], approvedBy: Set<string>, amount: number, userId: string) {
  if (approvedBy.has(userId) || stepDone(step, slots, approvedBy, amount)) return false;
  return filled(step, slots, new Set([...approvedBy, userId]), amount) > filled(step, slots, approvedBy, amount);
}

export function describeApprover(a: Approver, name: (id: string) => string, group: (id: string) => string = () => "a group") {
  const who = a.type === "user" ? name(a.userId) : a.type === "role" ? `any ${a.role}` : a.type === "group" ? `anyone in ${group(a.groupId)}` : "their manager";
  return a.limit !== null ? `${who} (up to ₹${(a.limit / 100).toLocaleString("en-IN")})` : who;
}

// ── Notifications ────────────────────────────────────────────────────────────

export const NOTIFICATION_KINDS = {
  "approval.requested": { label: "Something needs your approval", email: true, fields: ["requester", "document", "amount", "link"] },
  "approval.approved": { label: "Your request was approved", email: true, fields: ["document", "approver", "link"] },
  "approval.rejected": { label: "Your request was sent back", email: true, fields: ["document", "approver", "note", "link"] },
  "approval.escalated": { label: "An approval is overdue", email: true, fields: ["document", "step", "hours", "link"] },
  "work.task_assigned": { label: "A task was given to you", email: true, fields: ["task", "project", "by", "link"] },
  "work.timesheet_returned": { label: "Your timesheet was sent back", email: true, fields: ["week", "note", "link"] },
  "hr.leave_requested": { label: "Someone asked for leave", email: true, fields: ["employee", "dates", "link"] },
  "hr.leave_decided": { label: "Your leave was decided", email: true, fields: ["decision", "dates", "link"] },
  "documents.signed": { label: "Something you sent was signed by everyone", email: true, fields: ["title", "link"] },
  "documents.declined": { label: "Someone declined to sign", email: true, fields: ["title", "name", "link"] },
  "documents.shared": { label: "Someone shared a document or folder with you", email: true, fields: ["who", "title", "role", "link"] },
  "documents.mention": { label: "Someone mentioned you in a document", email: true, fields: ["who", "title", "text", "link"] },
  "documents.comment": { label: "Someone commented on your document", email: false, fields: ["who", "title", "text", "link"] },
  "mail.assigned": { label: "An email conversation was given to you", email: false, fields: ["subject", "from", "by", "link"] },
  "mail.followup": { label: "Nobody replied to an email you asked to follow up", email: false, fields: ["subject", "to", "link"] },
  "mail.failed": { label: "An email couldn't be sent", email: true, fields: ["subject", "error", "link"] },
  "mail.recurring": { label: "Your recurring emails: sent (if you asked), paused or finished", email: false, fields: ["name", "what", "link"] },
  "calendar.reminder": { label: "A meeting is coming up", email: false, fields: ["title", "when", "join", "link"] },
  "calendar.notes": { label: "A meeting ended — add the minutes", email: false, fields: ["title", "link"] },
  "calendar.changed": { label: "A meeting was moved or cancelled", email: true, fields: ["title", "change", "link"] },
  "calendar.added": { label: "A meeting invite was added to your calendar", email: false, fields: ["title", "link"] },
  "calendar.found": { label: "A meeting was found in your email", email: false, fields: ["title", "link"] },
  "helpdesk.assigned": { label: "A support ticket was given to you", email: true, fields: ["ticket", "subject", "by", "link"] },
  "helpdesk.replied": { label: "A customer replied on your ticket", email: true, fields: ["ticket", "subject", "customer", "link"] },
  "helpdesk.breached": { label: "A ticket missed its response target", email: true, fields: ["ticket", "subject", "target", "link"] },
  "portal.supplier": { label: "A supplier responded on the portal", email: true, fields: ["supplier", "what", "link"] },
  "grc.due": { label: "A compliance filing is due", email: true, fields: ["title", "period", "due", "link"] },
  "grc.incident": { label: "An incident was reported", email: true, fields: ["number", "title", "severity", "link"] },
  "grc.policy": { label: "A policy needs your acknowledgement", email: true, fields: ["title", "version", "link"] },
  "grc.assigned": { label: "Something in GRC was given to you", email: true, fields: ["what", "title", "link"] },
  "notes.reminder": { label: "A reminder on one of your notes", email: true, fields: ["note", "link"] },
  "notes.shared": { label: "Someone shared a note with you", email: false, fields: ["who", "note", "link"] },
  "chat.mention": { label: "Someone mentioned you in Chat", email: false, fields: ["who", "channel", "text", "link"] },
  "chat.dm": { label: "A direct message in Chat", email: false, fields: ["who", "text", "link"] },
  "chat.reply": { label: "A reply in a Chat thread you're in", email: false, fields: ["who", "channel", "text", "link"] },
  "chat.urgent": { label: "An urgent Chat message (repeats until read)", email: false, fields: ["who", "channel", "text", "link"] },
  "chat.approval": { label: "An approval asked of you in Chat, or its answer", email: true, fields: ["who", "title", "link"] },
  "chat.guest": { label: "Someone outside the workspace asks to join a Chat conversation you run", email: true, fields: ["who", "channel", "link"] },
  "chat.reminder": { label: "A Chat message you asked to be reminded about", email: false, fields: ["channel", "text", "link"] },
  "feature.updated": { label: "News on a feature you requested", email: true, fields: ["number", "title", "status", "link"] },
  "feature.released": { label: "A feature you asked for (or for your workspace) is live", email: true, fields: ["number", "title", "link"] },
  "billing.trial": { label: "Your free trial is ending", email: true, fields: ["days", "link"] },
  "billing.invoice": { label: "A subscription invoice is ready to pay", email: true, fields: ["number", "amount", "link"] },
  "billing.paid": { label: "A subscription payment was received", email: true, fields: ["number", "amount", "link"] },
  "billing.expired": { label: "Your subscription has ended", email: true, fields: ["link"] },
  reminder: { label: "Reminders you set", email: true, fields: ["title", "note", "link"] },
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

/** Fill {{field}} placeholders; unknown fields are left empty. */
export const fill = (text: string, values: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => values[k] ?? "");

export const templateSchema = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(4000) });
export const prefsSchema = z.record(z.string(), z.object({ app: z.boolean().default(true), email: z.boolean().default(true) }));
export const reminderSchema = z.object({ at: z.iso.datetime({ offset: true }), title: z.string().trim().min(1, "What should we remind you about?").max(200), note: z.string().trim().max(1000).default(""), link: z.string().trim().max(500).refine((v) => !v || v.startsWith("/"), "Use a link inside Cloudesk").default("") });
