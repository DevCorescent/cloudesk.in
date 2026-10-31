// The built-in records a workspace can add its own fields to. `builtin` are
// the record's own fields that rules can look at (read-only here); `match` is
// how an imported row finds its record.
import type { ModuleId } from "@/lib/workspace/modules";

export type BuiltinField = { key: string; label: string; type: "text" | "number" | "date" };
export type EntityInfo = { label: string; noun: string; module: ModuleId; builtin: BuiltinField[]; match: string; href: (id: string) => string };

const t = (key: string, label: string): BuiltinField => ({ key, label, type: "text" });

export const ENTITIES = {
  "inventory.item": { label: "Items", noun: "item", module: "inventory", builtin: [t("name", "Name"), t("sku", "SKU"), t("category", "Category"), t("unit", "Unit"), t("hsn", "HSN")], match: "sku", href: (id) => `/inventory/items/${id}` },
  "inventory.supplier": { label: "Suppliers", noun: "supplier", module: "inventory", builtin: [t("name", "Name"), t("gstin", "GSTIN"), t("state", "State"), t("email", "Email")], match: "name", href: () => `/inventory/suppliers` },
  "hr.employee": { label: "Employees", noun: "employee", module: "hr", builtin: [t("emp_no", "Employee no."), t("name", "Name"), t("designation", "Designation"), t("employment_type", "Employment type"), t("status", "Status")], match: "emp_no", href: (id) => `/hr/people/${id}` },
  "work.project": { label: "Projects", noun: "project", module: "work", builtin: [t("code", "Code"), t("name", "Name"), t("status", "Status"), t("billing", "Billing")], match: "code", href: (id) => `/work/projects/${id}` },
  "maintenance.asset": { label: "Maintenance assets", noun: "asset", module: "maintenance", builtin: [t("code", "Code"), t("name", "Name"), t("category", "Category"), t("location", "Location"), t("status", "Status"), t("criticality", "Criticality")], match: "code", href: (id) => `/maintenance/assets/${id}` },
  "logistics.vehicle": { label: "Vehicles", noun: "vehicle", module: "logistics", builtin: [t("reg_no", "Registration"), t("name", "Name"), t("type", "Type"), t("ownership", "Ownership"), t("fuel", "Fuel")], match: "reg_no", href: (id) => `/logistics/vehicles/${id}` },
  "helpdesk.ticket": { label: "Tickets", noun: "ticket", module: "helpdesk", builtin: [{ key: "number", label: "Number", type: "number" }, t("subject", "Subject"), t("status", "Status"), t("priority", "Priority"), t("channel", "Channel")], match: "number", href: (id) => `/helpdesk/tickets/${id}` },
  "education.student": { label: "Students", noun: "student", module: "education", builtin: [t("admission_no", "Admission no."), t("name", "Name"), t("gender", "Gender"), t("status", "Status")], match: "admission_no", href: (id) => `/school/students/${id}` },
  "clinic.patient": { label: "Patients", noun: "patient", module: "clinic", builtin: [t("mrn", "MRN"), t("name", "Name"), t("gender", "Gender"), t("blood_group", "Blood group")], match: "mrn", href: (id) => `/clinic/patients/${id}` },
  "construction.contract": { label: "Contracts (construction)", noun: "contract", module: "construction", builtin: [t("name", "Name"), t("client", "Client"), t("work_order_no", "Work order no."), t("site", "Site"), t("status", "Status")], match: "name", href: (id) => `/construction/contracts/${id}` },
} satisfies Record<string, EntityInfo>;

export type EntityId = keyof typeof ENTITIES;
export const ENTITY_IDS = Object.keys(ENTITIES) as EntityId[];
export const isEntity = (e: string): e is EntityId => e in ENTITIES;
export const isObjectEntity = (e: string) => /^obj:[0-9a-f-]{36}$/.test(e);
