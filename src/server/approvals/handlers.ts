// What happens when a request is decided: each kind finishes its own document.
// Kept apart from the engine so modules can call the engine without a cycle.
import type { schema } from "@/db";
import type { ApprovalKind } from "@/lib/approvals/model";
import { billApproved, billRejected } from "../accounting/bills";
import { journalApproved } from "../accounting/ledger";
import { runApproved, runRejected } from "../accounting/payables";
import { claimDecided, payrollApproved } from "../hr/payroll";
import { settlementDecided } from "../hr/plus";
import { tripDecided } from "../hr/travel";
import { orderApproved, orderRejected } from "../sales/orders";
import { requisitionDecided } from "../inventory/procurement";
import { supplierBankDecided } from "../inventory/items";
import { applyChange, changeRejected } from "../work/plus";
import { contractDecided } from "../documents/core";

type Request = typeof schema.approvalRequests.$inferSelect;
type Handler = { onApproved: (r: Request, by: string) => Promise<unknown>; onRejected?: (r: Request, by: string, note: string) => Promise<unknown> };

export const HANDLERS: Record<ApprovalKind, Handler> = {
  "acc.bill": { onApproved: (r) => billApproved(r.orgId, r.refId), onRejected: (r) => billRejected(r.orgId, r.refId) },
  "acc.expense": { onApproved: (r) => billApproved(r.orgId, r.refId), onRejected: (r) => billRejected(r.orgId, r.refId) },
  "acc.journal": { onApproved: (r) => journalApproved(r.orgId, r.requesterId, r.payload) },
  "acc.payment_run": { onApproved: (r) => runApproved(r.orgId, r.refId), onRejected: (r) => runRejected(r.orgId, r.refId) },
  // An approved order is sent by the person who raised it (the notification says so).
  "inv.po": { onApproved: async () => {} },
  "inv.supplier_bank": { onApproved: (r) => supplierBankDecided(r.orgId, r.refId, true), onRejected: (r) => supplierBankDecided(r.orgId, r.refId, false) },
  "inv.requisition": { onApproved: (r) => requisitionDecided(r.orgId, r.refId, true), onRejected: (r) => requisitionDecided(r.orgId, r.refId, false) },
  "hr.claim": { onApproved: (r, by) => claimDecided(r.orgId, r.refId, true, by), onRejected: (r, by, note) => claimDecided(r.orgId, r.refId, false, by, note) },
  "hr.payroll": { onApproved: (r, by) => payrollApproved(r.orgId, r.refId, r.amount, by) },
  "hr.trip": { onApproved: (r) => tripDecided(r.orgId, r.refId, true), onRejected: (r) => tripDecided(r.orgId, r.refId, false) },
  "hr.settlement": { onApproved: (r) => settlementDecided(r.orgId, r.refId, true), onRejected: (r) => settlementDecided(r.orgId, r.refId, false) },
  "sales.order": { onApproved: (r) => orderApproved(r.orgId, r.refId), onRejected: (r) => orderRejected(r.orgId, r.refId) },
  "doc.contract": { onApproved: (r) => contractDecided(r.orgId, r.refId, true), onRejected: (r) => contractDecided(r.orgId, r.refId, false) },
  "work.change": { onApproved: async (r) => void (await applyChange(r.orgId, r.refId)), onRejected: (r) => changeRejected(r.orgId, r.refId) },
};
