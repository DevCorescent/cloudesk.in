// Events a project emits. Shared by the server, the UI and the SDK docs.
export const EVENT_TYPES = ["order.placed", "order.paid", "order.shipped", "order.cancelled", "form.submitted", "booking.confirmed", "booking.cancelled", "row.created", "row.updated", "row.deleted", "webhook.test"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_INFO: Record<EventType, string> = {
  "order.placed": "A new store order (before payment)",
  "order.paid": "Payment for an order is confirmed",
  "order.shipped": "An order is marked shipped",
  "order.cancelled": "An order is cancelled",
  "form.submitted": "A form on the published site is submitted",
  "booking.confirmed": "A booking is confirmed",
  "booking.cancelled": "A booking is cancelled",
  "row.created": "A row is added to a data table",
  "row.updated": "A data table row is changed",
  "row.deleted": "A data table row is deleted",
  "webhook.test": "A test event you send yourself",
};

/** Permissions an API key or app can be given. */
export const API_SCOPES = ["project:read", "products:read", "products:write", "orders:read", "orders:write", "submissions:read", "bookings:read", "data:read", "data:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_INFO: Record<ApiScope, string> = {
  "project:read": "See the project's name and published address",
  "products:read": "List products, variants and stock",
  "products:write": "Change product details and stock levels",
  "orders:read": "List orders with customer contact details",
  "orders:write": "Mark orders shipped or delivered",
  "submissions:read": "Read form submissions",
  "bookings:read": "List bookings",
  "data:read": "Read rows in data tables",
  "data:write": "Add, change and delete rows in data tables",
};
