export const ROLES = ["owner", "admin", "billing", "developer", "designer", "editor", "viewer", "employee"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "org:read"
  | "org:update"
  | "members:manage"
  | "billing:manage"
  | "audit:read"
  | "secrets:manage"
  | "project:read"
  | "project:create"
  | "project:update"
  | "project:delete"
  | "design:write"
  | "code:write"
  | "ai:use"
  | "deploy:preview"
  | "deploy:production"
  | "submissions:read"
  | "store:manage"
  | "store:orders"
  | "store:refund"
  | "brand:manage"
  | "automations:manage"
  | "integrations:manage"
  | "data:schema"
  | "data:write"
  | "invoices:manage"
  | "invoices:void"
  | "crm:read"
  | "crm:write"
  | "crm:manage"
  | "hr:read"
  | "hr:manage"
  | "hr:payroll"
  | "inventory:read"
  | "inventory:write"
  | "inventory:manage"
  | "work:read"
  | "work:write"
  | "work:manage"
  | "accounts:read"
  | "accounts:write"
  | "accounts:manage"
  | "sales:read"
  | "sales:write"
  | "sales:manage"
  | "mfg:read"
  | "mfg:write"
  | "mfg:manage"
  | "qc:read"
  | "qc:write"
  | "qc:manage"
  | "mnt:read"
  | "mnt:write"
  | "mnt:manage"
  | "doc:read"
  | "doc:write"
  | "doc:manage"
  | "mkt:read"
  | "mkt:write"
  | "mkt:manage"
  | "lgx:read"
  | "lgx:write"
  | "lgx:manage"
  | "bi:read"
  | "bi:write"
  | "bi:manage"
  | "copilot:use"
  | "mail:use"
  | "mail:manage"
  | "calendar:use"
  | "chat:use"
  | "chat:manage"
  | "hd:read"
  | "hd:write"
  | "hd:manage"
  | "portal:read"
  | "portal:manage"
  | "grc:read"
  | "grc:registers"
  | "grc:write"
  | "grc:manage"
  | "edu:read"
  | "edu:write"
  | "edu:manage"
  | "clinic:read"
  | "clinic:write"
  | "clinic:manage"
  | "con:read"
  | "con:write"
  | "con:manage"
  | "custom:read"
  | "custom:write"
  | "custom:manage";

const ALL_ROLES: readonly Role[] = ROLES;
// Employees join a workspace only for their own HR (attendance, leave, payslips):
// they don't see projects, customers or anything else.
const TEAM: readonly Role[] = ROLES.filter((r) => r !== "employee");
const BUILDERS: readonly Role[] = ["owner", "admin", "developer", "designer", "editor"];

const MATRIX: Record<Permission, readonly Role[]> = {
  "org:read": ALL_ROLES,
  "org:update": ["owner", "admin"],
  "members:manage": ["owner", "admin"],
  "billing:manage": ["owner", "billing"],
  "audit:read": ["owner", "admin"],
  "secrets:manage": ["owner", "admin"],
  "project:read": TEAM,
  "project:create": BUILDERS,
  "project:update": BUILDERS,
  "project:delete": ["owner", "admin"],
  "design:write": BUILDERS,
  // Source files other than the design document can run as code once deployed.
  "code:write": ["owner", "admin", "developer"],
  "ai:use": BUILDERS,
  "deploy:preview": BUILDERS,
  "deploy:production": ["owner", "admin", "developer"],
  "submissions:read": ["owner", "admin", "developer", "editor"],
  // Catalog, discounts, shipping and storefront settings.
  "store:manage": ["owner", "admin", "developer", "designer", "editor"],
  // Order handling: view, fulfil, cancel, mark paid.
  "store:orders": ["owner", "admin", "developer", "editor", "billing"],
  // Money leaving the business.
  "store:refund": ["owner", "admin", "billing"],
  // Brand locks constrain everyone else's edits, so only owners and admins set them.
  "brand:manage": ["owner", "admin"],
  // Automations send data to other services and see customer details in runs.
  "automations:manage": ["owner", "admin", "developer"],
  // API keys, webhooks, connected services and apps reach outside the platform.
  "integrations:manage": ["owner", "admin", "developer"],
  // Data tables: changing structure or public access vs. editing rows.
  "data:schema": ["owner", "admin", "developer"],
  "data:write": BUILDERS,
  // Invoices, quotations, clients, payments and their reports.
  "invoices:manage": ["owner", "admin", "billing", "developer", "editor"],
  // Voiding issued documents and deleting recorded payments changes the books.
  "invoices:void": ["owner", "admin", "billing"],
  // CRM: see contacts and deals; work them (add, edit, log calls, send email);
  // and run it (pipelines, fields, imports, merges, deletes, lead capture).
  "crm:read": TEAM,
  "crm:write": ["owner", "admin", "billing", "developer", "editor"],
  "crm:manage": ["owner", "admin"],
  // HR: everyone (employees included) can open it for their own records and the
  // directory; owners and admins run it; payroll and salaries also for billing.
  "hr:read": ALL_ROLES,
  "hr:manage": ["owner", "admin"],
  "hr:payroll": ["owner", "admin", "billing"],
  // Inventory: the team sees stock; most roles receive, move and count it and
  // raise purchase orders; owners and admins run it (warehouses, settings, deletes).
  "inventory:read": TEAM,
  "inventory:write": ["owner", "admin", "billing", "developer", "editor"],
  "inventory:manage": ["owner", "admin"],
  // Projects & timesheets: the team sees projects and logs its own time; most
  // roles plan work (projects, tasks, milestones); owners and admins approve
  // timesheets, bill clients, see costs and change settings.
  "work:read": TEAM,
  "work:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "work:manage": ["owner", "admin"],
  // Accounting: the books are for owners, admins and billing (your accountant
  // can be added with the billing role); owners and admins change the chart of
  // accounts, the lock date and settings.
  "accounts:read": ["owner", "admin", "billing"],
  "accounts:write": ["owner", "admin", "billing"],
  "accounts:manage": ["owner", "admin"],
  // Sales: the team sees orders; most roles take orders, deliver and return
  // them; owners and admins set price lists, credit limits, commissions and settings.
  "sales:read": TEAM,
  "sales:write": ["owner", "admin", "billing", "developer", "editor"],
  "sales:manage": ["owner", "admin"],
  // Manufacturing: the team sees work orders; most roles run them on the floor
  // (issue materials, log time, record output); owners and admins set up
  // recipes, work centres and costs.
  "mfg:read": TEAM,
  "mfg:write": ["owner", "admin", "billing", "developer", "editor"],
  "mfg:manage": ["owner", "admin"],
  // Quality: the team sees inspections and non-conformances; most roles record
  // inspections and raise reports; owners and admins set plans and decide what
  // happens to held stock.
  "qc:read": TEAM,
  "qc:write": ["owner", "admin", "billing", "developer", "editor"],
  "qc:manage": ["owner", "admin"],
  // Assets & maintenance: everyone sees assets and can raise a request;
  // technicians (most roles) work orders; owners and admins set up plans, contracts and settings.
  "mnt:read": TEAM,
  "mnt:write": ["owner", "admin", "billing", "developer", "editor"],
  "mnt:manage": ["owner", "admin"],
  // Documents: the team reads the folders open to them; most roles add files,
  // contracts and send for signature; owners and admins manage folders, approve
  // contracts and see everything.
  "doc:read": TEAM,
  "doc:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "doc:manage": ["owner", "admin"],
  // Marketing: the team sees campaigns and results; marketers build segments
  // and campaigns and send them; owners and admins set budgets and settings.
  "mkt:read": TEAM,
  "mkt:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "mkt:manage": ["owner", "admin"],
  // Logistics: the team sees shipments; dispatch (most roles) ships, plans trips
  // and logs fuel; owners and admins manage carriers, rates and the fleet.
  "lgx:read": TEAM,
  "lgx:write": ["owner", "admin", "billing", "developer", "editor"],
  "lgx:manage": ["owner", "admin"],
  // Reports: everyone on the team can open shared reports (each still limited
  // to the data their role sees); most roles build them; owners and admins
  // manage anyone's reports, dashboards and schedules.
  "bi:read": TEAM,
  "bi:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "bi:manage": ["owner", "admin"],
  // AI copilot: the team can ask it questions; it only ever reads what the
  // person's role reads, and changes nothing without their confirmation.
  "copilot:use": TEAM,
  // Helpdesk: the team sees tickets; agents (most roles) reply and work them;
  // owners and admins set hours, targets, assignment and the inbound address.
  // Everyone can connect their own mailboxes; owners and admins run team inboxes.
  "mail:use": ROLES,
  "mail:manage": ["owner", "admin"],
  "calendar:use": ROLES,
  // Everyone chats; owners and admins can manage any channel (archive, settings, members).
  "chat:use": ROLES,
  "chat:manage": ["owner", "admin"],
  "hd:read": TEAM,
  "hd:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "hd:manage": ["owner", "admin"],
  // Portals: the team sees who signs in and the invoices suppliers send;
  // owners and admins choose what customers and suppliers see and sign people out.
  "portal:read": TEAM,
  "portal:manage": ["owner", "admin"],
  // GRC: every member (employees too) reads and acknowledges policies and
  // reports incidents; the team sees the registers; most roles keep them;
  // owners and admins set factors and limits.
  "grc:read": ALL_ROLES,
  "grc:registers": TEAM,
  "grc:write": ["owner", "admin", "billing", "developer", "editor"],
  "grc:manage": ["owner", "admin"],
  // Education: the team sees students; teachers and office staff (most roles)
  // mark attendance, enter marks, raise fees and take payments; owners and
  // admins set up fee plans and settings and waive fees.
  "edu:read": TEAM,
  "edu:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "edu:manage": ["owner", "admin"],
  // Clinic: the team (front desk) sees patients' details, appointments and
  // bills; most roles book and bill; owners and admins set fees and choose the
  // clinicians — the only people who see clinical notes.
  "clinic:read": TEAM,
  "clinic:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "clinic:manage": ["owner", "admin"],
  // Construction: the team sees contracts; site engineers (most roles) record
  // measurements and the diary and prepare RA bills; owners and admins set up
  // contracts and BOQs, certify bills and record money received.
  "con:read": TEAM,
  "con:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "con:manage": ["owner", "admin"],
  "custom:read": TEAM,
  "custom:write": ["owner", "admin", "billing", "developer", "designer", "editor"],
  "custom:manage": ["owner", "admin"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[permission].includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(MATRIX) as Permission[]).filter((p) => can(role, p));
}

// Who may assign which role. Only owners can create other owners.
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target !== "owner";
  return false;
}
