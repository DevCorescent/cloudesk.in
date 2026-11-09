// How every workspace module is used across the platform, for operators:
// workspaces with it switched on, workspaces actually using it, its records
// (all time, last 30 days, the 30 before), a daily trend, the busiest
// workspaces and a few module-specific figures. Every number is a count or sum
// over the module's own tables, measured at request time; a module with no
// table to measure says so instead of showing anything made up.
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { MODULES } from "@/lib/workspace/modules";
import { ApiError } from "../http/errors";

type Row = Record<string, unknown>;
const rows = async <T extends Row>(q: SQL) => (await db.execute<T>(q)).rows;
const n = (v: unknown) => Number(v ?? 0);
const raw = (s: string) => sql.raw(s);

export type KpiFormat = "count" | "money" | "usd_micro" | "percent" | "duration_min";
export type Kpi = { label: string; value: number; format: KpiFormat; currency?: string };

/** A table that records a module's activity. Identifiers are fixed in code, never from input. */
type Source = {
  table: string;
  /** How a row reaches its workspace: its own org_id, its web app (project_id → projects), or an invoice owner (a web app or a finance book). */
  orgVia: "org_id" | "project" | "invoice_owner";
  createdCol?: string;
  where?: string;
};
/** A figure from SQL returning rows of { v, currency? }; one KPI per row. */
type KpiSpec = { label: string; format: KpiFormat; q: string };
type Spec = { unit: string; sources: Source[]; kpis: KpiSpec[] };

const D30 = "now() - interval '30 days'";
const D60 = "now() - interval '60 days'";

/** Module id → what to measure. The first source is the module's main activity (trend, top workspaces). */
const REGISTRY: Record<string, Spec> = {
  sites: {
    unit: "deployments",
    sources: [{ table: "deployments", orgVia: "project" }, { table: "form_submissions", orgVia: "project" }],
    kpis: [
      { label: "Web apps", format: "count", q: "select count(*) v from projects where archived_at is null" },
      { label: "Live web apps", format: "count", q: "select count(*) v from projects where production_deployment_id is not null" },
      { label: "Deploy success (30 d)", format: "percent", q: `select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status = 'ready') / count(*), 1) end v from deployments where created_at > ${D30}` },
      { label: "Form submissions (30 d)", format: "count", q: `select count(*) v from form_submissions where created_at > ${D30}` },
      { label: "Page views (30 d)", format: "count", q: `select coalesce(sum(count), 0) v from site_stats where kind = 'view' and day > (${D30})::date` },
      { label: "Verified custom domains", format: "count", q: "select count(*) v from site_domains where status = 'verified'" },
    ],
  },
  store: {
    unit: "online orders",
    sources: [{ table: "store_orders", orgVia: "project", where: "channel = 'online'" }],
    kpis: [
      { label: "Products", format: "count", q: "select count(*) v from store_products" },
      { label: "Paid orders (30 d)", format: "count", q: `select count(*) v from store_orders where channel = 'online' and paid_at > ${D30}` },
      { label: "Paid sales (30 d)", format: "money", q: `select currency, sum(total - refunded_total) v from store_orders where channel = 'online' and paid_at > ${D30} group by currency order by v desc` },
      { label: "Refunded orders (30 d)", format: "count", q: `select count(*) v from store_orders where channel = 'online' and refunded_total > 0 and created_at > ${D30}` },
    ],
  },
  pos: {
    unit: "counter sales",
    sources: [{ table: "store_orders", orgVia: "project", where: "channel = 'pos'" }],
    kpis: [{ label: "Counter sales (30 d)", format: "money", q: `select currency, sum(total - refunded_total) v from store_orders where channel = 'pos' and paid_at > ${D30} group by currency order by v desc` }],
  },
  horeca: {
    unit: "orders, reservations & room bookings",
    sources: [{ table: "horeca_orders", orgVia: "project" }, { table: "horeca_reservations", orgVia: "project" }, { table: "horeca_room_bookings", orgVia: "project" }],
    kpis: [
      { label: "Venues", format: "count", q: "select count(*) v from horeca_venues" },
      { label: "Settled orders (30 d)", format: "count", q: `select count(*) v from horeca_orders where status in ('billed', 'paid') and created_at > ${D30}` },
      { label: "Covers served (30 d)", format: "count", q: `select coalesce(sum(covers), 0) v from horeca_orders where status <> 'cancelled' and created_at > ${D30}` },
      { label: "Room bookings (30 d)", format: "count", q: `select count(*) v from horeca_room_bookings where created_at > ${D30}` },
    ],
  },
  crm: {
    unit: "contacts, companies, deals & activities",
    sources: [{ table: "crm_contacts", orgVia: "org_id" }, { table: "crm_companies", orgVia: "org_id" }, { table: "crm_deals", orgVia: "org_id" }, { table: "crm_activities", orgVia: "org_id" }],
    kpis: [
      { label: "Contacts", format: "count", q: "select count(*) v from crm_contacts" },
      { label: "Open deals", format: "count", q: "select count(*) v from crm_deals where status = 'open'" },
      { label: "Deals won (30 d)", format: "count", q: `select count(*) v from crm_deals where status = 'won' and closed_at > ${D30}` },
      { label: "Won value (30 d)", format: "money", q: `select currency, sum(value) v from crm_deals where status = 'won' and closed_at > ${D30} group by currency order by v desc` },
    ],
  },
  hr: {
    unit: "people, leave, payroll, hiring & claims",
    sources: [{ table: "hr_employees", orgVia: "org_id" }, { table: "hr_leave_requests", orgVia: "org_id" }, { table: "hr_payroll_runs", orgVia: "org_id" }, { table: "hr_candidates", orgVia: "org_id" }, { table: "hr_claims", orgVia: "org_id" }, { table: "hr_reviews", orgVia: "org_id" }],
    kpis: [
      { label: "Active employees", format: "count", q: "select count(*) v from hr_employees where status in ('active', 'notice')" },
      { label: "Payroll runs finalised (30 d)", format: "count", q: `select count(*) v from hr_payroll_runs where finalised_at > ${D30}` },
      { label: "Net pay processed (30 d)", format: "money", q: `select 'INR' currency, coalesce(sum((totals->>'net')::bigint), 0) v from hr_payroll_runs where finalised_at > ${D30}` },
      { label: "Open job posts", format: "count", q: "select count(*) v from hr_jobs where status = 'open'" },
    ],
  },
  inventory: {
    unit: "stock moves, items, purchase orders & receipts",
    sources: [{ table: "inv_moves", orgVia: "org_id" }, { table: "inv_items", orgVia: "org_id" }, { table: "inv_purchase_orders", orgVia: "org_id" }, { table: "inv_receipts", orgVia: "org_id" }, { table: "inv_transfers", orgVia: "org_id" }],
    kpis: [
      { label: "Items", format: "count", q: "select count(*) v from inv_items" },
      { label: "Warehouses", format: "count", q: "select count(*) v from inv_warehouses" },
      { label: "Purchase orders (30 d)", format: "count", q: `select count(*) v from inv_purchase_orders where created_at > ${D30}` },
    ],
  },
  sales: {
    unit: "sales orders, deliveries & returns",
    sources: [{ table: "sales_orders", orgVia: "org_id" }, { table: "sales_deliveries", orgVia: "org_id" }, { table: "sales_returns", orgVia: "org_id" }],
    kpis: [{ label: "Order value (30 d)", format: "money", q: `select coalesce(sum(total), 0) v from sales_orders where created_at > ${D30}` }],
  },
  manufacturing: {
    unit: "work orders & bills of materials",
    sources: [{ table: "mfg_work_orders", orgVia: "org_id" }, { table: "mfg_boms", orgVia: "org_id" }],
    kpis: [
      { label: "Work orders completed (30 d)", format: "count", q: `select count(*) v from mfg_work_orders where completed_at > ${D30}` },
      { label: "Bills of materials", format: "count", q: "select count(*) v from mfg_boms" },
    ],
  },
  quality: {
    unit: "inspections & non-conformances",
    sources: [{ table: "qc_inspections", orgVia: "org_id" }, { table: "qc_ncrs", orgVia: "org_id" }],
    kpis: [
      { label: "Inspections with defects (30 d)", format: "count", q: `select count(*) v from qc_inspections where defective > 0 and created_at > ${D30}` },
      { label: "Non-conformances (30 d)", format: "count", q: `select count(*) v from qc_ncrs where created_at > ${D30}` },
    ],
  },
  maintenance: {
    unit: "work orders & assets",
    sources: [{ table: "mnt_orders", orgVia: "org_id" }, { table: "mnt_assets", orgVia: "org_id" }],
    kpis: [
      { label: "Completed (30 d)", format: "count", q: `select count(*) v from mnt_orders where completed_at > ${D30}` },
      { label: "Open work orders", format: "count", q: "select count(*) v from mnt_orders where completed_at is null" },
      { label: "Assets tracked", format: "count", q: "select count(*) v from mnt_assets" },
    ],
  },
  documents: {
    unit: "files, contracts & signature requests",
    sources: [{ table: "doc_files", orgVia: "org_id" }, { table: "doc_contracts", orgVia: "org_id" }, { table: "doc_sign_requests", orgVia: "org_id" }],
    kpis: [
      { label: "Files", format: "count", q: "select count(*) v from doc_files" },
      { label: "Signature requests (30 d)", format: "count", q: `select count(*) v from doc_sign_requests where created_at > ${D30}` },
    ],
  },
  marketing: {
    unit: "campaigns, segments & event registrations",
    sources: [{ table: "mkt_campaigns", orgVia: "org_id" }, { table: "mkt_segments", orgVia: "org_id" }, { table: "mkt_registrations", orgVia: "org_id" }],
    kpis: [
      { label: "Campaigns sent (30 d)", format: "count", q: `select count(*) v from mkt_campaigns where sent_at > ${D30}` },
      { label: "Events", format: "count", q: "select count(*) v from mkt_campaigns where kind = 'event'" },
      { label: "Event registrations (30 d)", format: "count", q: `select count(*) v from mkt_registrations where created_at > ${D30}` },
    ],
  },
  logistics: {
    unit: "shipments & trips",
    sources: [{ table: "lgx_shipments", orgVia: "org_id" }, { table: "lgx_trips", orgVia: "org_id" }],
    kpis: [
      { label: "Delivered (30 d)", format: "count", q: `select count(*) v from lgx_shipments where delivered_at > ${D30}` },
      { label: "Freight billed (30 d)", format: "money", q: `select coalesce(sum(freight_billed), 0) v from lgx_shipments where created_at > ${D30}` },
      { label: "Vehicles", format: "count", q: "select count(*) v from lgx_vehicles" },
    ],
  },
  bi: {
    unit: "reports, dashboards & schedules",
    sources: [{ table: "bi_reports", orgVia: "org_id" }, { table: "bi_dashboards", orgVia: "org_id" }, { table: "bi_schedules", orgVia: "org_id" }],
    kpis: [
      { label: "Reports", format: "count", q: "select count(*) v from bi_reports" },
      { label: "Scheduled emails", format: "count", q: "select count(*) v from bi_schedules" },
    ],
  },
  copilot: {
    unit: "conversations & actions",
    sources: [{ table: "copilot_threads", orgVia: "org_id" }, { table: "copilot_actions", orgVia: "org_id" }],
    kpis: [
      { label: "Conversations (30 d)", format: "count", q: `select count(*) v from copilot_threads where created_at > ${D30}` },
      { label: "Actions taken (30 d)", format: "count", q: `select count(*) v from copilot_actions where created_at > ${D30}` },
    ],
  },
  requisitions: {
    unit: "requisitions & client files",
    sources: [{ table: "rq_lists", orgVia: "org_id" }, { table: "rq_files", orgVia: "org_id" }],
    kpis: [
      { label: "Requisitions sent (30 d)", format: "count", q: `select count(*) v from rq_lists where status <> 'draft' and created_at > ${D30}` },
      { label: "Completed (30 d)", format: "count", q: `select count(*) v from rq_lists where completed_at > ${D30}` },
      { label: "Being chased now", format: "count", q: "select count(*) v from rq_lists where status = 'active'" },
      { label: "Reminders sent (30 d)", format: "count", q: `select count(*) v from rq_messages where direction = 'out' and kind = 'reminder' and created_at > ${D30}` },
      { label: "Replies read (30 d)", format: "count", q: `select count(*) v from rq_messages where direction = 'in' and created_at > ${D30}` },
    ],
  },
  helpdesk: {
    unit: "tickets & messages",
    sources: [{ table: "hd_tickets", orgVia: "org_id" }, { table: "hd_messages", orgVia: "org_id" }],
    kpis: [
      { label: "Tickets opened (30 d)", format: "count", q: `select count(*) v from hd_tickets where created_at > ${D30}` },
      { label: "Resolved (30 d)", format: "count", q: `select count(*) v from hd_tickets where resolved_at > ${D30}` },
      { label: "Open now", format: "count", q: "select count(*) v from hd_tickets where resolved_at is null and closed_at is null" },
      { label: "Median first response (30 d)", format: "duration_min", q: `select round((percentile_cont(0.5) within group (order by extract(epoch from first_responded_at - created_at)) / 60)::numeric, 1) v from hd_tickets where first_responded_at is not null and created_at > ${D30}` },
      { label: "SLA breaches (30 d)", format: "count", q: `select count(*) v from hd_tickets where (first_breached or resolve_breached) and created_at > ${D30}` },
      { label: "Average CSAT (of 5)", format: "count", q: `select round(avg(csat)::numeric, 2) v from hd_tickets where csat is not null` },
    ],
  },
  portal: {
    unit: "sign-in links, sessions & shared invoices",
    sources: [{ table: "portal_links", orgVia: "org_id" }, { table: "portal_sessions", orgVia: "org_id" }, { table: "portal_invoices", orgVia: "org_id" }],
    kpis: [{ label: "Sign-in links used (30 d)", format: "count", q: `select count(*) v from portal_links where used_at > ${D30}` }],
  },
  mail: {
    unit: "emails received and sent",
    sources: [{ table: "mail_messages", orgVia: "org_id" }],
    kpis: [
      { label: "Mailboxes connected", format: "count", q: "select count(*) v from mail_accounts" },
      { label: "Emails sent (30 d)", format: "count", q: `select count(*) v from mail_messages where direction = 'out' and send_status = 'sent' and created_at > ${D30}` },
    ],
  },
  calendar: {
    unit: "events and minutes",
    sources: [{ table: "cal_events", orgVia: "org_id" }, { table: "cal_notes", orgVia: "org_id" }],
    kpis: [
      { label: "Meetings added from email", format: "count", q: "select count(*) v from cal_events where source = 'mail'" },
      { label: "Minutes shared (30 d)", format: "count", q: `select count(*) v from cal_notes where shared_at > ${D30}` },
    ],
  },
  chat: {
    unit: "conversations and messages",
    sources: [{ table: "team_channels", orgVia: "org_id" }, { table: "team_messages", orgVia: "org_id" }, { table: "team_files", orgVia: "org_id" }],
    kpis: [
      { label: "Messages (30 d)", format: "count", q: `select count(*) v from team_messages where kind <> 'system' and deleted_at is null and created_at > ${D30}` },
      { label: "Channels", format: "count", q: "select count(*) v from team_channels where kind = 'channel' and not archived" },
    ],
  },
  grc: {
    unit: "obligations, risks, controls, incidents & policies",
    sources: [{ table: "grc_obligations", orgVia: "org_id" }, { table: "grc_risks", orgVia: "org_id" }, { table: "grc_controls", orgVia: "org_id" }, { table: "grc_incidents", orgVia: "org_id" }, { table: "grc_policies", orgVia: "org_id" }, { table: "grc_audits", orgVia: "org_id" }],
    kpis: [
      { label: "Filings tracked", format: "count", q: "select count(*) v from grc_filings" },
      { label: "Risks", format: "count", q: "select count(*) v from grc_risks" },
      { label: "Incidents (30 d)", format: "count", q: `select count(*) v from grc_incidents where created_at > ${D30}` },
    ],
  },
  education: {
    unit: "students, fees, payments & exams",
    sources: [{ table: "edu_students", orgVia: "org_id" }, { table: "edu_fees", orgVia: "org_id" }, { table: "edu_payments", orgVia: "org_id" }, { table: "edu_exams", orgVia: "org_id" }],
    kpis: [
      { label: "Students", format: "count", q: "select count(*) v from edu_students" },
      { label: "Fees collected (30 d)", format: "money", q: `select coalesce(sum(paid), 0) v from edu_fees where created_at > ${D30}` },
      { label: "Fees overdue", format: "count", q: "select count(*) v from edu_fees where due_date < current_date and paid < amount" },
    ],
  },
  clinic: {
    unit: "visits, appointments, patients & bills",
    sources: [{ table: "clinic_visits", orgVia: "org_id" }, { table: "clinic_appointments", orgVia: "org_id" }, { table: "clinic_patients", orgVia: "org_id" }, { table: "clinic_bills", orgVia: "org_id" }],
    kpis: [
      { label: "Patients", format: "count", q: "select count(*) v from clinic_patients" },
      { label: "Billed (30 d)", format: "money", q: `select coalesce(sum(total), 0) v from clinic_bills where created_at > ${D30}` },
      { label: "Collected (30 d)", format: "money", q: `select coalesce(sum(paid), 0) v from clinic_bills where created_at > ${D30}` },
    ],
  },
  construction: {
    unit: "contracts, measurements, bills & site diary",
    sources: [{ table: "con_contracts", orgVia: "org_id" }, { table: "con_measurements", orgVia: "org_id" }, { table: "con_bills", orgVia: "org_id" }, { table: "con_diary", orgVia: "org_id" }],
    kpis: [
      { label: "Contracts", format: "count", q: "select count(*) v from con_contracts" },
      { label: "Running bills (30 d)", format: "count", q: `select count(*) v from con_bills where created_at > ${D30}` },
    ],
  },
  objects: {
    unit: "custom records",
    sources: [{ table: "custom_records", orgVia: "org_id" }, { table: "custom_objects", orgVia: "org_id" }],
    kpis: [{ label: "Custom objects", format: "count", q: "select count(*) v from custom_objects" }],
  },
  work: {
    unit: "tasks, projects & time entries",
    sources: [{ table: "work_tasks", orgVia: "org_id" }, { table: "work_projects", orgVia: "org_id" }, { table: "work_time", orgVia: "org_id" }],
    kpis: [
      { label: "Projects", format: "count", q: "select count(*) v from work_projects" },
      { label: "Tasks completed (30 d)", format: "count", q: `select count(*) v from work_tasks where completed_at > ${D30}` },
      { label: "Time logged (30 d)", format: "duration_min", q: `select coalesce(sum(minutes), 0) v from work_time where date > (${D30})::date` },
    ],
  },
  accounting: {
    unit: "journals, bills & payments",
    sources: [{ table: "acc_journals", orgVia: "org_id" }, { table: "acc_bills", orgVia: "org_id" }, { table: "acc_bill_payments", orgVia: "org_id" }, { table: "acc_receipts", orgVia: "org_id" }],
    kpis: [
      { label: "Journals posted (30 d)", format: "count", q: `select count(*) v from acc_journals where created_at > ${D30}` },
      { label: "Supplier bills (30 d)", format: "count", q: `select count(*) v from acc_bills where created_at > ${D30}` },
    ],
  },
  invoicing: {
    unit: "documents & payments",
    sources: [{ table: "invoice_documents", orgVia: "invoice_owner" }, { table: "invoice_payments", orgVia: "invoice_owner" }],
    kpis: [
      { label: "Invoices issued (30 d)", format: "count", q: `select count(*) v from invoice_documents where type = 'invoice' and status <> 'draft' and created_at > ${D30}` },
      { label: "Payments received (30 d)", format: "money", q: `select d.currency, sum(p.amount) v from invoice_payments p join invoice_documents d on d.id = p.document_id where p.created_at > ${D30} group by d.currency order by v desc` },
      { label: "Outstanding", format: "money", q: "select currency, sum(total - amount_paid) v from invoice_documents where type = 'invoice' and status in ('sent', 'partial') group by currency order by v desc" },
    ],
  },
  bookings: {
    unit: "bookings",
    sources: [{ table: "bookings", orgVia: "project" }],
    kpis: [
      { label: "Services offered", format: "count", q: "select count(*) v from booking_services" },
      { label: "Paid bookings (30 d)", format: "money", q: `select currency, sum(amount) v from bookings where paid and created_at > ${D30} group by currency order by v desc` },
      { label: "Cancelled (30 d)", format: "count", q: `select count(*) v from bookings where cancelled_at > ${D30}` },
    ],
  },
  promotions: {
    unit: "promotions",
    sources: [{ table: "promotions", orgVia: "project" }],
    kpis: [
      { label: "Running now", format: "count", q: "select count(*) v from promotions where enabled and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())" },
      { label: "Views (30 d)", format: "count", q: `select coalesce(sum(views), 0) v from promotion_stats where day > (${D30})::date` },
      { label: "Clicks (30 d)", format: "count", q: `select coalesce(sum(clicks), 0) v from promotion_stats where day > (${D30})::date` },
    ],
  },
  growth: {
    unit: "experiments",
    sources: [{ table: "growth_experiments", orgVia: "project", createdCol: "started_at" }],
    kpis: [
      { label: "Running experiments", format: "count", q: "select count(*) v from growth_experiments where status = 'running'" },
      { label: "Checkouts recorded (30 d)", format: "count", q: `select coalesce(sum(count), 0) v from site_stats where kind = 'checkout' and day > (${D30})::date` },
    ],
  },
  automations: {
    unit: "workflow runs",
    sources: [{ table: "workflow_runs", orgVia: "project", createdCol: "started_at" }, { table: "workflows", orgVia: "project" }],
    kpis: [
      { label: "Workflows", format: "count", q: "select count(*) v from workflows" },
      { label: "Runs (30 d)", format: "count", q: `select count(*) v from workflow_runs where started_at > ${D30}` },
      { label: "Failed runs (30 d)", format: "count", q: `select count(*) v from workflow_runs where status = 'failed' and started_at > ${D30}` },
      { label: "Run success (30 d)", format: "percent", q: `select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status = 'succeeded') / count(*), 1) end v from workflow_runs where started_at > ${D30} and status in ('succeeded', 'failed')` },
    ],
  },
  chatbot: {
    unit: "conversations & knowledge sources",
    sources: [{ table: "chat_conversations", orgVia: "project" }, { table: "kb_sources", orgVia: "project" }],
    kpis: [
      { label: "Chatbots", format: "count", q: "select count(*) v from chatbots" },
      { label: "Messages (30 d)", format: "count", q: `select coalesce(sum(message_count), 0) v from chat_conversations where created_at > ${D30}` },
    ],
  },
  data: {
    unit: "data rows & tables",
    sources: [{ table: "data_rows", orgVia: "project" }, { table: "data_tables", orgVia: "project" }],
    kpis: [
      { label: "Tables", format: "count", q: "select count(*) v from data_tables" },
      { label: "API keys", format: "count", q: "select count(*) v from api_keys" },
    ],
  },
  "ai-ide": {
    unit: "AI tasks, terminal runs & shared docs",
    sources: [{ table: "ai_tasks", orgVia: "org_id" }, { table: "exec_runs", orgVia: "project" }, { table: "codocs", orgVia: "project" }],
    kpis: [
      { label: "AI tasks (30 d)", format: "count", q: `select count(*) v from ai_tasks where created_at > ${D30}` },
      { label: "AI cost (30 d)", format: "usd_micro", q: `select coalesce(sum(cost_micro_usd), 0) v from ai_tasks where created_at > ${D30}` },
      { label: "Terminal runs (30 d)", format: "count", q: `select count(*) v from exec_runs where created_at > ${D30}` },
    ],
  },
};

/** The core web-app builder isn't a switchable module, but it's measured the same way. */
const CORE = { id: "sites", name: "Web apps & hosting", group: "platform" };
const ALL = [CORE, ...MODULES.map((m) => ({ id: m.id as string, name: m.name, group: m.group as string }))];

/** The workspace each row of a source belongs to, as SQL. */
function orgExpr(s: Source) {
  if (s.orgVia === "org_id") return "t.org_id";
  if (s.orgVia === "project") return "(select p.org_id from projects p where p.id = t.project_id)";
  return "coalesce((select p.org_id from projects p where p.id = t.project_id), (select b.org_id from finance_books b where b.id = t.project_id))";
}
/** All of a module's rows as (org, created). */
function union(spec: Spec, only?: number) {
  const parts = (only === undefined ? spec.sources : [spec.sources[only]!]).map((s) => `select ${orgExpr(s)} as org, t.${s.createdCol ?? "created_at"} as created from ${s.table} t${s.where ? ` where ${s.where}` : ""}`);
  return parts.join(" union all ");
}

export type ModuleUsage = {
  id: string;
  name: string;
  group: string;
  unit: string | null;
  enabledWorkspaces: number;
  activeWorkspaces30: number;
  records: number;
  records30: number;
  recordsPrev30: number;
  growthPct: number | null;
  measured: boolean;
  kpis: Kpi[];
  error?: string;
};

async function kpisFor(spec: Spec): Promise<Kpi[]> {
  const out: Kpi[] = [];
  for (const k of spec.kpis) {
    const r = await rows<{ v: unknown; currency?: string }>(raw(k.q));
    for (const x of r) {
      if (x.v === null || x.v === undefined) continue;
      out.push({ label: k.label, value: n(x.v), format: k.format, ...(x.currency ? { currency: String(x.currency) } : {}) });
    }
    if (!r.length && k.format !== "money" && k.format !== "percent") out.push({ label: k.label, value: 0, format: k.format });
  }
  return out;
}

async function usage(m: { id: string; name: string; group: string }, enabled: number): Promise<ModuleUsage> {
  const spec = REGISTRY[m.id];
  const base = { id: m.id, name: m.name, group: m.group, unit: spec?.unit ?? null, enabledWorkspaces: enabled, activeWorkspaces30: 0, records: 0, records30: 0, recordsPrev30: 0, growthPct: null, measured: !!spec, kpis: [] as Kpi[] };
  if (!spec) return base;
  try {
    const [r] = await rows<{ total: unknown; c30: unknown; prev: unknown; active: unknown }>(raw(`select count(*) as total, count(*) filter (where created > ${D30}) as c30, count(*) filter (where created > ${D60} and created <= ${D30}) as prev, count(distinct org) filter (where created > ${D30}) as active from (${union(spec)}) s`));
    const records30 = n(r?.c30), prev = n(r?.prev);
    return { ...base, records: n(r?.total), records30, recordsPrev30: prev, activeWorkspaces30: n(r?.active), growthPct: prev ? Math.round(((records30 - prev) / prev) * 1000) / 10 : null, kpis: await kpisFor(spec) };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message.slice(0, 200) : "Couldn't measure this module" };
  }
}

/** Workspaces with each module switched on (no list means every module is on). */
async function enabledCounts() {
  const [r] = await rows<Row>(raw(`select count(*) as all_orgs, ${MODULES.map((m, i) => `count(*) filter (where modules is null or modules @> '${JSON.stringify([m.id])}'::jsonb) as m${i}`).join(", ")} from organizations`));
  const map = new Map<string, number>([[CORE.id, n(r?.all_orgs)]]);
  MODULES.forEach((m, i) => map.set(m.id, n(r?.[`m${i}`])));
  return map;
}

export async function modulesOverview(): Promise<{ modules: ModuleUsage[]; generatedAt: string }> {
  const enabled = await enabledCounts();
  const out: ModuleUsage[] = [];
  // A few at a time, so a big platform doesn't take every database connection at once.
  for (let i = 0; i < ALL.length; i += 6) out.push(...(await Promise.all(ALL.slice(i, i + 6).map((m) => usage(m, enabled.get(m.id) ?? 0)))));
  return { modules: out, generatedAt: new Date().toISOString() };
}

export async function moduleDetail(id: string) {
  const m = ALL.find((x) => x.id === id);
  if (!m) throw new ApiError("not_found", "No such module");
  const enabled = await enabledCounts();
  const row = await usage(m, enabled.get(m.id) ?? 0);
  const spec = REGISTRY[m.id];
  const trend: { day: string; n: number }[] = [];
  let top: { orgId: string; name: string; slug: string; records30: number }[] = [];
  if (spec && !row.error) {
    try {
      const daily = await rows<{ day: string; n: unknown }>(raw(`select (created at time zone 'UTC')::date::text as day, count(*) as n from (${union(spec, 0)}) s where created > ${D30} group by 1`));
      const by = new Map(daily.map((d) => [String(d.day).slice(0, 10), n(d.n)]));
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        trend.push({ day: d, n: by.get(d) ?? 0 });
      }
      top = (await rows<{ id: string; name: string; slug: string; c: unknown }>(raw(`select o.id, o.name, o.slug, count(*) as c from (${union(spec)}) s join organizations o on o.id = s.org where s.created > ${D30} group by o.id order by c desc limit 5`))).map((t) => ({ orgId: t.id, name: t.name, slug: t.slug, records30: n(t.c) }));
    } catch (e) {
      return { ...row, trend, top, error: e instanceof Error ? e.message.slice(0, 200) : "Couldn't measure this module" };
    }
  }
  return { ...row, trend, top };
}
