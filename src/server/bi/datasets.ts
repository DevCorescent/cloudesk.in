// What reports can be built on: each dataset is one kind of record from a
// module, with the fields people can group by, measure and filter on. Every
// field is a fixed SQL expression written here — people pick fields by key,
// never write SQL — and every dataset is limited to the workspace (and, where
// a module limits it, to what the person may see). Dates are days in India.
import { sql, type SQL } from "drizzle-orm";
import type { Permission } from "../authz/permissions";
import type { ModuleId } from "@/lib/workspace/modules";

export type FieldType = "date" | "text" | "number" | "money" | "bool";
export type Field = { key: string; label: string; type: FieldType; sql: string; /** Only for people with this permission (salaries). */ perm?: Permission };
export type Ctx = { orgId: string; userId: string; can: (p: Permission) => boolean; crmOwn: boolean };
export type Dataset = { id: string; label: string; group: string; module: ModuleId; perm: Permission; from: (c: Ctx) => SQL; dateField: string | null; fields: Field[] };

const ist = (col: string) => `(${col} at time zone 'Asia/Kolkata')::date`;
const books = (alias: string, c: Ctx) => sql`${sql.raw(alias)}.project_id in (select o.id from invoice_owners o left join projects p on p.id = o.project_id left join finance_books b on b.id = o.book_id where coalesce(p.org_id, b.org_id) = ${c.orgId})`;
const f = (key: string, label: string, type: FieldType, expr: string, perm?: Permission): Field => ({ key, label, type, sql: expr, ...(perm ? { perm } : {}) });

export const DATASETS: Dataset[] = [
  // ── Money ──
  {
    id: "invoices", label: "Invoices", group: "Money", module: "invoicing", perm: "invoices:manage", dateField: "issueDate",
    from: (c) => sql`invoice_documents x left join invoice_owners o on o.id = x.project_id left join projects bp on bp.id = o.project_id left join finance_books bb on bb.id = o.book_id where ${books("x", c)} and x.type = 'invoice'`,
    fields: [
      f("issueDate", "Issue date", "date", "x.issue_date"), f("dueDate", "Due date", "date", "x.due_date"), f("number", "Number", "text", "x.number"), f("status", "Status", "text", "x.status"),
      f("client", "Client", "text", "coalesce(nullif(x.client->>'company', ''), x.client->>'name')"), f("books", "Books", "text", "coalesce(bp.name, bb.name)"), f("placeOfSupply", "Place of supply", "text", "x.place_of_supply"), f("currency", "Currency", "text", "x.currency"),
      f("subtotal", "Before tax (₹)", "money", "round(x.subtotal * coalesce(x.fx_rate, 1))"), f("tax", "Tax (₹)", "money", "round(x.tax_total * coalesce(x.fx_rate, 1))"), f("total", "Total (₹)", "money", "round(x.total * coalesce(x.fx_rate, 1))"),
      f("paid", "Paid (₹)", "money", "round(x.amount_paid * coalesce(x.fx_rate, 1))"), f("due", "Still due (₹)", "money", "case when x.status in ('void', 'draft') then 0 else round(greatest(x.total - x.amount_paid, 0) * coalesce(x.fx_rate, 1)) end"),
      f("overdue", "Overdue", "bool", "(x.status not in ('paid', 'void', 'draft') and x.amount_paid < x.total and x.due_date < (now() at time zone 'Asia/Kolkata')::date)"),
    ],
  },
  {
    id: "payments", label: "Payments received", group: "Money", module: "invoicing", perm: "invoices:manage", dateField: "paidOn",
    from: (c) => sql`invoice_payments x join invoice_documents d on d.id = x.document_id where ${books("x", c)}`,
    fields: [f("paidOn", "Paid on", "date", "x.paid_on"), f("method", "Method", "text", "x.method"), f("client", "Client", "text", "coalesce(nullif(d.client->>'company', ''), d.client->>'name')"), f("invoice", "Invoice", "text", "d.number"), f("amount", "Amount (₹)", "money", "coalesce(x.inr_amount, x.amount)")],
  },
  {
    id: "bills", label: "Bills & expenses", group: "Money", module: "accounting", perm: "accounts:read", dateField: "date",
    from: (c) => sql`acc_bills x where x.org_id = ${c.orgId}`,
    fields: [
      f("date", "Date", "date", "x.date"), f("dueDate", "Due date", "date", "x.due_date"), f("supplier", "Supplier", "text", "x.supplier_name"), f("kind", "Kind", "text", "x.kind"), f("status", "Status", "text", "x.status"),
      f("subtotal", "Before tax (₹)", "money", "x.subtotal"), f("tax", "Tax (₹)", "money", "x.tax"), f("total", "Total (₹)", "money", "x.total"), f("paid", "Paid (₹)", "money", "x.amount_paid"), f("due", "Still due (₹)", "money", "case when x.status = 'void' then 0 else greatest(x.total - x.amount_paid - x.credited - x.tds_amount, 0) end"), f("tds", "TDS (₹)", "money", "x.tds_amount"),
    ],
  },
  {
    id: "ledger", label: "Ledger (journal lines)", group: "Money", module: "accounting", perm: "accounts:read", dateField: "date",
    from: (c) => sql`acc_lines x join acc_journals j on j.id = x.journal_id join acc_accounts a on a.id = x.account_id where x.org_id = ${c.orgId}`,
    fields: [
      f("date", "Date", "date", "j.date"), f("account", "Account", "text", "a.code || ' · ' || a.name"), f("accountType", "Account type", "text", "a.type"), f("source", "Posted from", "text", "j.source_type"), f("party", "Party", "text", "j.party"),
      f("debit", "Debit (₹)", "money", "x.debit"), f("credit", "Credit (₹)", "money", "x.credit"), f("net", "Natural balance (₹)", "money", "case when a.type in ('asset', 'expense') then x.debit - x.credit else x.credit - x.debit end"),
    ],
  },
  // ── Selling ──
  {
    id: "store_orders", label: "Store & counter orders", group: "Selling", module: "store", perm: "store:orders", dateField: "date",
    from: (c) => sql`store_orders x join projects p on p.id = x.project_id where p.org_id = ${c.orgId}`,
    fields: [
      f("date", "Date", "date", ist("x.created_at")), f("store", "Store", "text", "p.name"), f("channel", "Channel", "text", "x.channel"), f("payment", "Payment", "text", "x.payment_method"), f("financial", "Payment status", "text", "x.financial_status::text"), f("discountCode", "Discount code", "text", "x.discount_code"),
      f("total", "Total", "money", "x.total"), f("discount", "Discounts", "money", "x.discount_total"), f("shipping", "Shipping", "money", "x.shipping_total"), f("tax", "Tax", "money", "x.tax_total"), f("refunded", "Refunded", "money", "x.refunded_total"),
    ],
  },
  {
    id: "sales_orders", label: "Sales orders", group: "Selling", module: "sales", perm: "sales:read", dateField: "date",
    from: (c) => sql`sales_orders x left join users u on u.id = x.salesperson_id left join inv_warehouses w on w.id = x.warehouse_id where x.org_id = ${c.orgId}`,
    fields: [f("date", "Date", "date", "x.date"), f("number", "Number", "text", "x.number"), f("customer", "Customer", "text", "x.client_name"), f("status", "Status", "text", "x.status"), f("salesperson", "Salesperson", "text", "coalesce(u.name, '')"), f("warehouse", "Location", "text", "coalesce(w.name, '')"), f("subtotal", "Before tax", "money", "x.subtotal"), f("discount", "Discount", "money", "x.discount"), f("tax", "Tax", "money", "x.tax"), f("total", "Total", "money", "x.total")],
  },
  {
    id: "sales_lines", label: "Sales order lines", group: "Selling", module: "sales", perm: "sales:read", dateField: "date",
    from: (c) => sql`sales_orders x cross join lateral jsonb_array_elements(x.lines) l left join users u on u.id = x.salesperson_id where x.org_id = ${c.orgId} and x.status not in ('draft', 'cancelled')`,
    fields: [
      f("date", "Date", "date", "x.date"), f("customer", "Customer", "text", "x.client_name"), f("salesperson", "Salesperson", "text", "coalesce(u.name, '')"), f("item", "Item", "text", "l->>'name'"), f("status", "Order status", "text", "x.status"),
      f("qty", "Quantity", "number", "(l->>'qty')::numeric"), f("delivered", "Delivered", "number", "coalesce((l->>'delivered')::numeric, 0)"), f("invoiced", "Invoiced", "number", "coalesce((l->>'invoiced')::numeric, 0)"),
      f("amount", "Value before tax", "money", "round((l->>'qty')::numeric * (l->>'rate')::numeric * (1 - coalesce((l->>'discountPct')::numeric, 0) / 100))"),
    ],
  },
  {
    id: "deals", label: "Deals", group: "Selling", module: "crm", perm: "crm:read", dateField: "created",
    from: (c) => sql`crm_deals x left join crm_stages st on st.id = x.stage_id left join crm_pipelines pl on pl.id = x.pipeline_id left join users u on u.id = x.owner_id left join crm_companies co on co.id = x.company_id where x.org_id = ${c.orgId} ${c.crmOwn ? sql`and (x.owner_id = ${c.userId} or x.owner_id is null)` : sql``}`,
    fields: [
      f("created", "Created", "date", ist("x.created_at")), f("closed", "Closed", "date", ist("x.closed_at")), f("expectedClose", "Expected close", "date", "x.expected_close"), f("title", "Deal", "text", "x.title"), f("status", "Status", "text", "x.status"), f("stage", "Stage", "text", "st.name"), f("pipeline", "Pipeline", "text", "pl.name"),
      f("owner", "Owner", "text", "coalesce(u.name, '')"), f("source", "Source", "text", "x.source"), f("company", "Company", "text", "coalesce(co.name, '')"), f("priority", "Priority", "text", "x.priority"), f("lostReason", "Lost reason", "text", "x.lost_reason"),
      f("value", "Value", "money", "x.value"), f("won", "Won value", "money", "case when x.status = 'won' then x.value else 0 end"), f("days", "Days to close", "number", "case when x.closed_at is not null then extract(epoch from x.closed_at - x.created_at) / 86400 end"),
    ],
  },
  {
    id: "contacts", label: "Contacts", group: "Selling", module: "crm", perm: "crm:read", dateField: "created",
    from: (c) => sql`crm_contacts x left join users u on u.id = x.owner_id left join crm_companies co on co.id = x.company_id where x.org_id = ${c.orgId} ${c.crmOwn ? sql`and (x.owner_id = ${c.userId} or x.owner_id is null)` : sql``}`,
    fields: [f("created", "Added", "date", ist("x.created_at")), f("lifecycle", "Lifecycle", "text", "x.lifecycle"), f("source", "Source", "text", "x.source"), f("owner", "Owner", "text", "coalesce(u.name, '')"), f("city", "City", "text", "x.city"), f("country", "Country", "text", "x.country"), f("company", "Company", "text", "coalesce(co.name, '')"), f("marketing", "Agreed to marketing", "bool", "x.marketing"), f("score", "Score", "number", "x.score")],
  },
  {
    id: "activities", label: "CRM activities", group: "Selling", module: "crm", perm: "crm:read", dateField: "date",
    from: (c) => sql`crm_activities x left join users u on u.id = x.owner_id where x.org_id = ${c.orgId} and x.kind <> 'event' ${c.crmOwn ? sql`and (x.owner_id = ${c.userId} or x.owner_id is null)` : sql``}`,
    fields: [f("date", "Date", "date", ist("x.created_at")), f("kind", "Kind", "text", "x.kind"), f("owner", "Owner", "text", "coalesce(u.name, '')"), f("done", "Done", "bool", "(x.done_at is not null)"), f("minutes", "Call minutes", "number", "x.duration_min")],
  },
  {
    id: "campaign_sends", label: "Campaign emails", group: "Selling", module: "marketing", perm: "mkt:read", dateField: "sent",
    from: (c) => sql`mkt_sends x join mkt_campaigns k on k.id = x.campaign_id where x.org_id = ${c.orgId}`,
    fields: [f("sent", "Sent", "date", ist("x.sent_at")), f("campaign", "Campaign", "text", "k.name"), f("variant", "Subject", "text", "x.variant"), f("status", "Status", "text", "x.status"), f("clicked", "Clicked", "bool", "(x.clicks > 0)"), f("unsubscribed", "Unsubscribed", "bool", "(x.unsubscribed_at is not null)"), f("clicks", "Clicks", "number", "x.clicks")],
  },
  // ── Operations ──
  {
    id: "stock", label: "Stock on hand", group: "Operations", module: "inventory", perm: "inventory:read", dateField: null,
    from: (c) => sql`inv_stock x join inv_items i on i.id = x.item_id join inv_warehouses w on w.id = x.warehouse_id where x.org_id = ${c.orgId}`,
    fields: [f("item", "Item", "text", "i.name"), f("sku", "SKU", "text", "i.sku"), f("category", "Category", "text", "i.category"), f("warehouse", "Location", "text", "w.name"), f("batch", "Batch", "text", "x.batch"), f("expiry", "Expiry", "date", "x.expiry"), f("qty", "Quantity", "number", "x.qty"), f("value", "Value at cost", "money", "round(x.qty * i.avg_cost)")],
  },
  {
    id: "stock_moves", label: "Stock movements", group: "Operations", module: "inventory", perm: "inventory:read", dateField: "date",
    from: (c) => sql`inv_moves x join inv_items i on i.id = x.item_id join inv_warehouses w on w.id = x.warehouse_id where x.org_id = ${c.orgId}`,
    fields: [f("date", "Date", "date", ist("x.created_at")), f("kind", "Kind", "text", "x.kind"), f("item", "Item", "text", "i.name"), f("category", "Category", "text", "i.category"), f("warehouse", "Location", "text", "w.name"), f("ref", "For", "text", "x.ref_type"), f("qty", "Quantity (+ in, − out)", "number", "x.qty"), f("value", "Value", "money", "round(x.qty * x.unit_cost)")],
  },
  {
    id: "purchase_orders", label: "Purchase orders", group: "Operations", module: "inventory", perm: "inventory:read", dateField: "date",
    from: (c) => sql`inv_purchase_orders x left join inv_suppliers s on s.id = x.supplier_id where x.org_id = ${c.orgId}`,
    fields: [f("date", "Order date", "date", "x.order_date"), f("expected", "Expected", "date", "x.expected_date"), f("supplier", "Supplier", "text", "coalesce(s.name, '')"), f("status", "Status", "text", "x.status"), f("subtotal", "Before tax", "money", "x.subtotal"), f("tax", "Tax", "money", "x.tax"), f("total", "Total", "money", "x.total")],
  },
  {
    id: "work_orders", label: "Work orders", group: "Operations", module: "manufacturing", perm: "mfg:read", dateField: "start",
    from: (c) => sql`mfg_work_orders x join inv_items i on i.id = x.item_id where x.org_id = ${c.orgId}`,
    fields: [f("start", "Planned start", "date", "x.planned_start"), f("completed", "Completed", "date", ist("x.completed_at")), f("item", "Item", "text", "i.name"), f("status", "Status", "text", "x.status"), f("qty", "Planned", "number", "x.qty"), f("produced", "Produced", "number", "x.produced"), f("scrap", "Scrap", "number", "x.scrap"), f("materialCost", "Material cost", "money", "x.material_cost"), f("conversionCost", "Conversion cost", "money", "x.conversion_cost")],
  },
  {
    id: "inspections", label: "Quality inspections", group: "Operations", module: "quality", perm: "qc:read", dateField: "inspected",
    from: (c) => sql`qc_inspections x join inv_items i on i.id = x.item_id left join inv_suppliers s on s.id = x.supplier_id where x.org_id = ${c.orgId}`,
    fields: [f("inspected", "Inspected", "date", ist("x.inspected_at")), f("stage", "Stage", "text", "x.stage"), f("status", "Result", "text", "x.status"), f("item", "Item", "text", "i.name"), f("supplier", "Supplier", "text", "coalesce(s.name, '')"), f("lotQty", "Lot quantity", "number", "x.lot_qty"), f("defective", "Defective samples", "number", "x.defective")],
  },
  {
    id: "maintenance", label: "Maintenance work orders", group: "Operations", module: "maintenance", perm: "mnt:read", dateField: "created",
    from: (c) => sql`mnt_orders x join mnt_assets a on a.id = x.asset_id where x.org_id = ${c.orgId}`,
    fields: [f("created", "Raised", "date", ist("x.created_at")), f("completed", "Done", "date", ist("x.completed_at")), f("kind", "Kind", "text", "x.kind"), f("status", "Status", "text", "x.status"), f("asset", "Asset", "text", "a.code || ' · ' || a.name"), f("category", "Asset category", "text", "a.category"), f("priority", "Priority", "text", "x.priority"), f("parts", "Parts cost", "money", "x.parts_cost"), f("outside", "Outside work", "money", "x.external_cost"), f("downHours", "Downtime (hours)", "number", "case when x.down_from is not null then extract(epoch from coalesce(x.down_to, now()) - x.down_from) / 3600 end")],
  },
  {
    id: "shipments", label: "Shipments", group: "Operations", module: "logistics", perm: "lgx:read", dateField: "created",
    from: (c) => sql`lgx_shipments x left join lgx_carriers k on k.id = x.carrier_id where x.org_id = ${c.orgId}`,
    fields: [f("created", "Made", "date", ist("x.created_at")), f("delivered", "Delivered", "date", ist("x.delivered_at")), f("status", "Status", "text", "x.status"), f("via", "Via", "text", "case when x.mode = 'own' then 'Own fleet' else coalesce(k.name, '') end"), f("state", "To state", "text", "x.state"), f("weight", "Weight (kg)", "number", "x.weight_kg"), f("freight", "Freight cost", "money", "x.freight_cost"), f("billed", "Freight charged", "money", "x.freight_billed"), f("onTime", "On time", "bool", `(x.status = 'delivered' and ${ist("x.delivered_at")} <= x.promised_on)`)],
  },
  // ── People ──
  {
    id: "employees", label: "Employees", group: "People", module: "hr", perm: "hr:manage", dateField: "joined",
    from: (c) => sql`hr_employees x left join hr_departments d on d.id = x.department_id left join hr_locations l on l.id = x.location_id where x.org_id = ${c.orgId}`,
    fields: [f("joined", "Joined", "date", "x.join_date"), f("exited", "Left", "date", "x.exit_date"), f("status", "Status", "text", "x.status"), f("department", "Department", "text", "coalesce(d.name, '')"), f("designation", "Designation", "text", "x.designation"), f("location", "Location", "text", "coalesce(l.name, '')"), f("type", "Employment type", "text", "x.employment_type"), f("gender", "Gender", "text", "x.gender"), f("ctc", "Yearly CTC", "money", "x.ctc", "hr:payroll")],
  },
  {
    id: "leave", label: "Leave", group: "People", module: "hr", perm: "hr:manage", dateField: "from",
    from: (c) => sql`hr_leave_requests x join hr_employees e on e.id = x.employee_id left join hr_leave_types t on t.id = x.leave_type_id left join hr_departments d on d.id = e.department_id where x.org_id = ${c.orgId}`,
    fields: [f("from", "From", "date", "x.from_date"), f("status", "Status", "text", "x.status"), f("type", "Leave type", "text", "coalesce(t.name, '')"), f("person", "Person", "text", "e.name"), f("department", "Department", "text", "coalesce(d.name, '')"), f("days", "Days", "number", "x.days")],
  },
  {
    id: "attendance", label: "Attendance", group: "People", module: "hr", perm: "hr:manage", dateField: "date",
    from: (c) => sql`hr_attendance x join hr_employees e on e.id = x.employee_id left join hr_departments d on d.id = e.department_id where x.org_id = ${c.orgId}`,
    fields: [f("date", "Date", "date", "x.date"), f("status", "Status", "text", "x.status"), f("late", "Late", "bool", "x.late"), f("person", "Person", "text", "e.name"), f("department", "Department", "text", "coalesce(d.name, '')"), f("hours", "Hours", "number", "x.minutes / 60.0")],
  },
  {
    id: "time", label: "Time logged", group: "People", module: "work", perm: "work:read", dateField: "date",
    from: (c) => sql`work_time x join work_projects p on p.id = x.project_id join users u on u.id = x.user_id where x.org_id = ${c.orgId} and x.status <> 'rejected' ${c.can("work:manage") ? sql`` : sql`and x.user_id = ${c.userId}`}`,
    fields: [f("date", "Date", "date", "x.date"), f("project", "Project", "text", "p.code || ' · ' || p.name"), f("client", "Client", "text", "p.client_name"), f("person", "Person", "text", "u.name"), f("billable", "Billable", "bool", "x.billable"), f("status", "Status", "text", "x.status"), f("billed", "Invoiced", "bool", "(x.invoice_id is not null)"), f("hours", "Hours", "number", "x.minutes / 60.0")],
  },
];

export const datasetById = (id: string) => DATASETS.find((d) => d.id === id) ?? null;
