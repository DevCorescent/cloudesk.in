// The workspace integration hub: ERP events other systems can subscribe to
// (signed webhooks), scoped API keys for the ERP API, and its versions.
import { z } from "zod";

export const ERP_EVENTS = {
  "crm.contact.created": "A contact was added to the CRM",
  "crm.deal.won": "A deal was won",
  "sales.order.confirmed": "A sales order was confirmed",
  "accounts.bill.created": "A supplier bill was entered",
  "accounts.bill.paid": "A supplier bill was paid in full",
  "inventory.po.sent": "A purchase order was sent to the supplier",
  "inventory.goods.received": "Goods were received into stock",
  "helpdesk.ticket.created": "A support ticket was opened",
  "helpdesk.ticket.resolved": "A support ticket was resolved",
  "logistics.shipment.delivered": "A shipment was delivered",
  "grc.incident.reported": "An incident was reported",
  "hub.test": "A test event sent from Cloudesk",
} as const;
export type ErpEvent = keyof typeof ERP_EVENTS;
export const ERP_EVENT_IDS = Object.keys(ERP_EVENTS) as ErpEvent[];

export const ERP_SCOPES = {
  "contacts:read": "Read CRM contacts",
  "contacts:write": "Add CRM contacts",
  "deals:read": "Read CRM deals",
  "items:read": "Read items and stock on hand",
  "suppliers:read": "Read suppliers (without bank details)",
  "sales_orders:read": "Read sales orders",
  "bills:read": "Read supplier bills",
  "tickets:read": "Read support tickets",
  "tickets:write": "Open support tickets",
} as const;
export type ErpScope = keyof typeof ERP_SCOPES;
export const ERP_SCOPE_IDS = Object.keys(ERP_SCOPES) as ErpScope[];

/**
 * API versions, newest first. A request may ask for one with the
 * Cloudesk-Version header; without it, the newest is used. Responses always
 * say which version answered.
 */
export const API_VERSIONS = ["2026-10-25"] as const;
export const CURRENT_VERSION = API_VERSIONS[0];

export const endpointSchema = z.object({
  url: z.url("Enter the full https:// address").max(500),
  description: z.string().trim().max(200).default(""),
  events: z.array(z.enum(["*", ...ERP_EVENT_IDS] as [string, ...string[]])).min(1, "Pick at least one event").max(ERP_EVENT_IDS.length + 1),
});
export const keySchema = z.object({
  name: z.string().trim().min(1, "Name the key").max(80),
  scopes: z.array(z.enum(ERP_SCOPE_IDS as [ErpScope, ...ErpScope[]])).min(1, "Choose at least one permission"),
  /** Days until it stops working; null for no expiry. */
  expiresInDays: z.number().int().min(1).max(730).nullable().default(365),
});

/** After this many failed deliveries in a row an endpoint is switched off, so a dead receiver doesn't pile up retries. */
export const DISABLE_AFTER = 25;

/** A cursor for "after this row" pages: created time and id. */
export const encodeCursor = (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
export function decodeCursor(c: string | null | undefined) {
  if (!c) return null;
  try {
    const [t, id] = Buffer.from(c, "base64url").toString().split("|");
    const at = new Date(t);
    if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** Daily counts of events sent, delivered and failed per endpoint, for reconciliation. */
export function reconcile(rows: { day: string; endpoint: string; status: string; n: number }[]) {
  const by = new Map<string, { day: string; endpoint: string; sent: number; delivered: number; failed: number; pending: number }>();
  for (const r of rows) {
    const k = `${r.day}|${r.endpoint}`;
    const e = by.get(k) ?? { day: r.day, endpoint: r.endpoint, sent: 0, delivered: 0, failed: 0, pending: 0 };
    e.sent += r.n;
    if (r.status === "succeeded") e.delivered += r.n;
    else if (r.status === "dead") e.failed += r.n;
    else e.pending += r.n;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.day.localeCompare(a.day) || a.endpoint.localeCompare(b.endpoint));
}
