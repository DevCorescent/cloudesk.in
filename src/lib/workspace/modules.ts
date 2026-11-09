// Workspace features: which parts of Cloudesk an organization has switched on.
// Generic features (home, projects, website builder, brand, integrations,
// deployments, team, settings) are always on. Everything else is picked at
// onboarding from the business's industry and can be changed in Settings →
// Features. `null` means "everything" — workspaces created before this existed
// keep every feature.

export type ModuleId = "store" | "pos" | "horeca" | "crm" | "hr" | "inventory" | "sales" | "manufacturing" | "quality" | "maintenance" | "documents" | "marketing" | "logistics" | "bi" | "copilot" | "helpdesk" | "requisitions" | "portal" | "grc" | "education" | "clinic" | "construction" | "objects" | "work" | "accounting" | "invoicing" | "bookings" | "promotions" | "growth" | "automations" | "chatbot" | "data" | "ai-ide" | "mail" | "calendar" | "chat";
export type Tint = "peach" | "lavender" | "mint" | "sky" | "butter" | "rose";

export type ModuleDef = {
  id: ModuleId;
  name: string;
  short: string;
  /** What it adds, in a few words, for the onboarding preview. */
  adds: string[];
  tint: Tint;
  /** Marketing page for "learn more". */
  feature: string;
  /** Dashboard paths it owns; `:p` is the project id segment. */
  paths: RegExp[];
  /** Where it sits in the "build your app" picker. */
  group: ModuleGroup;
  /** Other modules it can't work without; switching it on switches these on. */
  requires?: ModuleId[];
  /** Parts that can be switched off on their own (all on by default). */
  parts?: ModulePart[];
  /** Where finer switches live when they aren't workspace-wide (e.g. per venue). */
  partsNote?: string;
  /** API sections it owns: `/api/v1/orgs/:id/<seg>`, `/api/v1/projects/:id/<seg>` or `/api/v1/<seg>`. */
  api?: { org?: string[]; project?: string[]; root?: string[] };
  /** Other modules' APIs its screens call; a role allowed this module may use them. */
  uses?: ModuleId[];
};

export type ModulePart = {
  id: string;
  name: string;
  short: string;
  /** Parts of the same module it needs. */
  requires?: string[];
  /** First segments of the module's API that belong to this part. */
  api?: string[];
};

/** The same groups as the sidebar, so what you pick is where you'll find it. */
export type ModuleGroup = "customers" | "money" | "people" | "operations" | "industry" | "insights" | "sell" | "platform";
export const MODULE_GROUPS: { id: ModuleGroup; label: string; line: string }[] = [
  { id: "customers", label: "Customers & sales", line: "Leads, deals, orders, campaigns and support" },
  { id: "money", label: "Money", line: "Invoices, payments, books and GST" },
  { id: "people", label: "People & work", line: "Your team, their pay, projects, time and documents" },
  { id: "operations", label: "Operations", line: "Stock, purchasing, production, assets and delivery" },
  { id: "industry", label: "Your industry", line: "Ready-made for clinics, schools and contractors" },
  { id: "insights", label: "Insights & control", line: "Reports, compliance, AI answers and your own records" },
  { id: "sell", label: "Sell & serve — in your web apps", line: "Online store, counter, restaurant, bookings and offers" },
  { id: "platform", label: "Grow & build — in your web apps", line: "Analytics, chat, automation, data and code" },
];

export const MODULES: ModuleDef[] = [
  { id: "store", name: "Online store", short: "Products, cart, checkout, delivery and catalogues", adds: ["Products & stock", "Orders", "Catalogues"], tint: "lavender", feature: "online-store", paths: [/^\/projects\/[^/]+\/store(\/(?!labels).*)?$/], group: "sell", api: { project: ["store"] }, uses: ["invoicing"] },
  { id: "pos", name: "Point of sale", short: "Scan barcodes and bill at the counter, with labels", adds: ["Counter till", "Barcode labels"], tint: "mint", feature: "point-of-sale", paths: [/^\/projects\/[^/]+\/pos(\/.*)?$/, /^\/projects\/[^/]+\/store\/labels(\/.*)?$/], group: "sell", uses: ["store"] },
  { id: "horeca", name: "Cloudesk for Horeca", short: "QR ordering, kitchen display, rooms, bar stock and valet", adds: ["QR table ordering", "Kitchen display", "Rooms & bar"], tint: "peach", feature: "horeca", paths: [/^\/projects\/[^/]+\/horeca(\/.*)?$/], group: "sell", partsNote: "Rooms, bar, valet, reservations, kitchen stock and guests are switched on per venue in Horeca → Settings.", api: { org: ["horeca"], project: ["horeca"] }, uses: ["store", "invoicing"] },
  { id: "mail", name: "Mail", short: "Every mailbox you use — Gmail, Outlook, Zoho or your own domain — in one smart inbox that sorts itself, with team inboxes, follow-ups, rules, templates and AI help", adds: ["One inbox for every mailbox", "Smart categories & screener", "Team inboxes & follow-ups"], tint: "sky", feature: "mail", paths: [/^\/mail(\/.*)?$/], group: "customers", api: { org: ["mail"], root: ["mail"] }, uses: ["crm", "helpdesk"] },
  { id: "chat", name: "Chat", short: "Team chat built for work — channels, direct messages and threads, records from every module shared as live cards, polls, decisions and approvals in the conversation, and AI that catches you up", adds: ["Channels, DMs & threads", "Share any record into chat", "AI catch-up & action items"], tint: "lavender", feature: "chat", paths: [/^\/chat(\/.*)?$/], group: "people", api: { org: ["chat"] }, uses: ["work", "calendar", "mail"] },
  { id: "calendar", name: "Calendar", short: "Your meetings in one beautiful calendar — invites and meeting links picked up from your email, reminders through the day, and minutes you can share when it's over", adds: ["Meetings from your email", "Reminders on the day", "Minutes of meeting (MOM)"], tint: "sky", feature: "calendar", paths: [/^\/calendar(\/.*)?$/], group: "people", api: { org: ["calendar"] }, uses: ["mail"] },
  { id: "requisitions", name: "Requisitions", short: "Ask clients for the documents and details you need, and let email reminders chase them on your schedule until everything's in — replies are read and items ticked off for you", adds: ["Automatic reminders", "Replies read and matched", "Client upload link"], tint: "butter", feature: "requisitions", paths: [/^\/requisitions(\/.*)?$/], group: "customers", api: { org: ["requisitions"] }, uses: ["mail", "crm"] },
  { id: "helpdesk", name: "Helpdesk", short: "Support tickets from email, your customer portal and the phone, with response targets in business hours, saved replies and satisfaction ratings", adds: ["Ticket inbox & SLAs", "Email in and out", "Customer ratings"], tint: "mint", feature: "helpdesk", paths: [/^\/helpdesk(\/.*)?$/], group: "customers", api: { org: ["helpdesk"] }, uses: ["crm"] },
  { id: "portal", name: "Customer & supplier portals", short: "A sign-in page for your customers (their invoices, orders and support tickets) and your suppliers (RFQs to quote, purchase orders to acknowledge and dispatch, invoices to send)", adds: ["Customer self-service", "Supplier quotes & invoices", "Sign-in by email link"], tint: "sky", feature: "portals", paths: [/^\/portals(\/.*)?$/], group: "customers", api: { org: ["portal"] }, uses: ["invoicing", "sales", "helpdesk", "inventory", "accounting"], parts: [
    { id: "customers", name: "Customer portal", short: "Invoices, payments, orders and tickets for your customers", api: ["customers"] },
    { id: "suppliers", name: "Supplier portal", short: "RFQs, purchase orders and invoices for your suppliers", api: ["suppliers", "submissions"] },
  ] },
  { id: "crm", name: "CRM", short: "Contacts, companies, deal pipelines, tasks and email sequences", adds: ["Contacts & companies", "Deal pipelines", "Tasks & sequences"], tint: "sky", feature: "crm", paths: [/^\/crm(\/.*)?$/], group: "customers", api: { org: ["crm"] }, uses: ["invoicing"], parts: [
    { id: "deals", name: "Deals & pipelines", short: "Pipelines, the deal board and forecasts", api: ["deals", "pipelines", "forecast"] },
    { id: "sequences", name: "Sequences", short: "Follow-ups that send themselves", api: ["sequences", "enrollments"] },
  ] },
  { id: "hr", name: "HR & payroll", short: "Employees, attendance, leave, payroll, hiring and performance", adds: ["Attendance & leave", "Payroll & payslips", "Hiring"], tint: "mint", feature: "hrms", paths: [/^\/hr(\/.*)?$/], group: "people", api: { org: ["hr"] }, parts: [
    { id: "attendance", name: "Attendance", short: "Check-in, late marks and the month sheet", api: ["attendance", "corrections"] },
    { id: "leave", name: "Leave", short: "Leave types, balances, approvals and holidays", api: ["leave", "leave-types", "holidays"] },
    { id: "payroll", name: "Payroll", short: "Salaries, PF, ESI, tax and payslips", api: ["payroll", "payslips"] },
    { id: "claims", name: "Expense claims", short: "Claims (expenses, mileage) checked against your expense policy, with approval and payout", api: ["claims"] },
    { id: "travel", name: "Travel & company cards", short: "Trips with approval, advances, per diem and settlement; company-card statements explained by cardholders", api: ["trips", "cards", "card-txns", "card-txns-import", "travel"] },
    { id: "hiring", name: "Hiring", short: "Roles, candidates and a careers page", api: ["jobs", "candidates"] },
    { id: "performance", name: "Performance", short: "Goals and review cycles", api: ["goals", "reviews"] },
    { id: "assets", name: "Assets", short: "Laptops, phones and who holds them", api: ["assets"] },
    { id: "shifts", name: "Shifts & overtime", short: "Shifts, the weekly roster, and overtime paid through payroll", api: ["shifts", "roster", "overtime"] },
    { id: "records", name: "Documents & training", short: "Contracts and documents with expiry, training and certifications", api: ["documents", "trainings", "training-records"] },
    { id: "relations", name: "Grievances & discipline", short: "Grievances raised by employees and disciplinary cases", api: ["cases"] },
    { id: "planning", name: "Workforce plan", short: "Planned headcount and cost by department and role", api: ["workforce", "positions"] },
  ] },
  { id: "inventory", name: "Inventory & purchasing", short: "Stock in every location, suppliers, purchase orders, goods received and transfers", adds: ["Stock by location", "Purchase orders", "Reorder alerts"], tint: "butter", feature: "inventory", paths: [/^\/inventory(\/.*)?$/], group: "operations", api: { org: ["inventory"] }, uses: ["store"], parts: [
    { id: "purchasing", name: "Purchasing", short: "Suppliers, purchase orders and goods received", api: ["suppliers", "orders", "receipts", "reorder"] },
    { id: "locations", name: "More than one location", short: "Warehouses, branches and transfers between them", api: ["transfers"] },
    { id: "batches", name: "Batches & expiry", short: "Batch numbers and expiry dates, oldest out first", api: ["expiring"] },
    { id: "warehouse", name: "Warehouse floor", short: "Bins and quarantine, putaway, and waves of orders picked, packed and dispatched", api: ["bins", "bin-moves", "waves", "wave-candidates"] },
    { id: "procurement", name: "Procurement", short: "Requisitions, RFQs and quote comparison, agreed rates, returns to suppliers, 3-way match and purchase budgets (with Purchasing on)", api: ["requisitions", "rfqs", "supplier-rates", "supplier-returns", "match", "performance", "purchase-budgets"] },
  ] },
  { id: "sales", name: "Sales orders", short: "Orders from customers, price lists and credit limits, delivery challans, returns, commissions and targets", adds: ["Sales orders", "Price lists & credit limits", "Delivery challans"], tint: "peach", feature: "sales", paths: [/^\/sales(\/.*)?$/], group: "customers", requires: ["invoicing"], api: { org: ["sales"] }, uses: ["invoicing", "inventory", "crm"], parts: [
    { id: "pricing", name: "Price lists & credit", short: "Price lists, customer prices, credit limits and discount approval", api: ["price-lists", "customers"] },
    { id: "delivery", name: "Deliveries & returns", short: "Delivery challans that take stock out, and returns that put it back", api: ["deliveries", "returns"] },
    { id: "commissions", name: "Commissions & targets", short: "Commission plans and monthly targets per salesperson", api: ["commissions", "plans", "targets"] },
  ] },
  { id: "manufacturing", name: "Manufacturing", short: "Recipes (bills of materials) and routings, work centres, work orders with real costs, MRP and capacity", adds: ["Bills of materials", "Work orders", "MRP"], tint: "mint", feature: "manufacturing", paths: [/^\/manufacturing(\/.*)?$/], group: "operations", requires: ["inventory"], api: { org: ["manufacturing"] }, uses: ["inventory", "sales"], parts: [
    { id: "routing", name: "Routing & work centres", short: "Operations on work centres, timed on the shop floor and costed by the hour", api: ["work-centres", "capacity"] },
    { id: "mrp", name: "MRP", short: "What to make and buy from orders, stock and recipes", api: ["mrp"] },
  ] },
  { id: "quality", name: "Quality", short: "Inspection plans, inspections on receipt and after production, quarantine, non-conformances and corrective actions", adds: ["Inspections", "Non-conformances", "Corrective actions"], tint: "sky", feature: "quality", paths: [/^\/quality(\/.*)?$/], group: "operations", requires: ["inventory"], api: { org: ["quality"] }, uses: ["inventory", "manufacturing"] },
  { id: "maintenance", name: "Assets & maintenance", short: "An asset register with meters, preventive plans by date or usage, maintenance work orders with parts and downtime, AMC and warranty contracts", adds: ["Asset register", "Preventive maintenance", "Breakdowns & downtime"], tint: "peach", feature: "maintenance", paths: [/^\/maintenance(\/.*)?$/], group: "operations", api: { org: ["maintenance"] }, uses: ["inventory", "accounting"] },
  { id: "documents", name: "Documents & e-sign", short: "Folders with access rules, files with versions, a contract register with renewals and obligations, and signatures by link with an audit trail", adds: ["Document library", "Contract register", "E-signatures"], tint: "lavender", feature: "documents", paths: [/^\/documents(\/.*)?$/], group: "people", api: { org: ["documents"] }, uses: ["crm", "hr", "work"] },
  { id: "marketing", name: "Marketing", short: "Segments of your CRM contacts, email campaigns with A/B subjects and click tracking, events with registration, spend and the deals each campaign won", adds: ["Email campaigns", "Events", "Campaign ROI"], tint: "rose", feature: "marketing", paths: [/^\/marketing(\/.*)?$/], group: "customers", requires: ["crm"], api: { org: ["marketing"] }, parts: [
    { id: "email", name: "Email campaigns", short: "Send to a segment, with an A/B subject, tracked links and unsubscribe", api: ["campaign-send", "sends"] },
    { id: "events", name: "Events", short: "Registration pages, confirmations and attendance", api: ["registrations"] },
  ] },
  { id: "logistics", name: "Logistics & fleet", short: "Shipments by your own vehicles or transporters and couriers, freight from rate cards, trips, proof of delivery, a tracking page, and your fleet's papers and fuel", adds: ["Shipments & tracking", "Trips & fleet", "Freight costs"], tint: "butter", feature: "logistics", paths: [/^\/logistics(\/.*)?$/], group: "operations", api: { org: ["logistics"] }, uses: ["sales", "inventory", "maintenance", "hr", "accounting"], parts: [
    { id: "fleet", name: "Own fleet", short: "Vehicles and their papers, drivers, trips and the fuel log", api: ["vehicles", "drivers", "trips", "fuel"] },
  ] },
  { id: "bi", name: "Reports & dashboards", short: "Build reports on any module's data — grouped, filtered and charted — put them on dashboards with KPIs, and have them emailed on a schedule", adds: ["Report builder", "Dashboards & KPIs", "Scheduled reports"], tint: "sky", feature: "reports", paths: [/^\/reports(\/.*)?$/], group: "insights", api: { org: ["bi"] } },
  { id: "grc", name: "Governance, risk & compliance", short: "A risk register with controls and their tests, a compliance calendar of statutory filings, policies your team acknowledges, incidents, internal audits, checks on who holds which duties, fraud indicators and an emissions log", adds: ["Risks & controls", "Compliance calendar", "Policies & incidents"], tint: "rose", feature: "compliance", paths: [/^\/compliance(\/.*)?$/], group: "insights", api: { org: ["grc"] }, uses: ["accounting", "inventory", "hr", "logistics", "documents"], parts: [
    { id: "risks", name: "Risks & controls", short: "The risk register, controls and control tests", api: ["risks", "controls"] },
    { id: "calendar", name: "Compliance calendar", short: "Recurring statutory filings with reminders", api: ["obligations", "filings"] },
    { id: "audits", name: "Internal audits", short: "Audits and their findings", api: ["audits", "findings"] },
    { id: "esg", name: "Emissions (ESG)", short: "Electricity and fuel, turned into CO₂", api: ["esg"] },
  ] },
  { id: "copilot", name: "AI copilot", short: "Ask about your business in plain words — answers come from your own data, with your permissions — and have it draft follow-ups and tasks for you to confirm", adds: ["Questions answered from your data", "Drafts tasks and notes", "Nothing changes without you"], tint: "lavender", feature: "copilot", paths: [/^\/copilot(\/.*)?$/], group: "insights", api: { org: ["copilot"] } },
  { id: "education", name: "Education", short: "Students and classes, fee plans in instalments with concessions and receipts, attendance, and exams with report cards — for schools, colleges and coaching", adds: ["Students & fees", "Attendance", "Exams & report cards"], tint: "butter", feature: "education", paths: [/^\/school(\/.*)?$/], group: "industry", api: { org: ["education"] }, uses: ["accounting"] },
  { id: "clinic", name: "Clinic", short: "Patients, appointments with a token queue, consultations with vitals, diagnosis and prescriptions, and bills with receipts — clinical notes for clinicians only", adds: ["Patients & queue", "Consultations & prescriptions", "Clinic billing"], tint: "sky", feature: "clinic", paths: [/^\/clinic(\/.*)?$/], group: "industry", api: { org: ["clinic"] }, uses: ["accounting"] },
  { id: "construction", name: "Construction", short: "Contracts with a bill of quantities, a measurement book, running-account bills with retention, advance recovery, GST and TDS, payments, and a site diary", adds: ["BOQ & measurements", "RA bills", "Site diary"], tint: "peach", feature: "construction", paths: [/^\/construction(\/.*)?$/], group: "industry", api: { org: ["construction"] }, uses: ["accounting"] },
  { id: "objects", name: "Custom objects", short: "Your own kinds of records — site visits, licences, warranties — with fields, links to your other records, rules, import and bulk changes", adds: ["Your own objects", "Links & rules", "Bulk changes with undo"], tint: "butter", feature: "custom-objects", paths: [/^\/objects(\/.*)?$/], group: "insights" },
  { id: "work", name: "Projects & timesheets", short: "Projects, a task board, milestones, timesheets with approval, and billing your hours", adds: ["Task boards", "Timesheets & timer", "Bill your hours"], tint: "lavender", feature: "projects", paths: [/^\/work(\/.*)?$/], group: "people", api: { org: ["work"] }, uses: ["invoicing", "crm"], parts: [
    { id: "timesheets", name: "Timesheets", short: "Log hours, run a timer and approve weeks", api: ["time", "timesheet", "timer", "approvals"] },
    { id: "billing", name: "Billing", short: "Turn hours and milestones into invoices", api: ["billing"] },
    { id: "profit", name: "Cost & profit", short: "What each project costs and earns", requires: ["timesheets"], api: ["profit"] },
    { id: "planning", name: "Schedule & resources", short: "Task dependencies, a Gantt chart with the critical path, and who's booked against their capacity", api: ["links", "resources", "allocations"] },
    { id: "expenses", name: "Project expenses", short: "Spend on a project, re-billed with markup and counted in profit", api: ["expenses"] },
    { id: "control", name: "Risks & changes", short: "Risk and issue log, change requests with approval, and project documents", api: ["risks", "changes", "docs"] },
  ] },
  { id: "invoicing", name: "Invoices & finance", short: "GST invoices, quotations, payments and books", adds: ["GST invoices", "Quotes", "Who owes what"], tint: "butter", feature: "invoicing", paths: [/^\/projects\/[^/]+\/invoicing(\/.*)?$/, /^\/finance(\/.*)?$/], group: "money", api: { project: ["invoicing"], root: ["finance"] } },
  { id: "accounting", name: "Accounting & GST", short: "Ledger, bills and expenses, bank reconciliation, P&L, balance sheet and GST returns — posted from your invoices, sales, purchases and payroll", adds: ["Profit & loss", "Bank reconciliation", "GSTR-1 and 3B"], tint: "sky", feature: "accounting", paths: [/^\/accounts(\/.*)?$/], group: "money", requires: ["invoicing"], api: { org: ["accounts"] }, parts: [
    { id: "bills", name: "Bills & expenses", short: "What you owe suppliers, what you spend, TDS and payment runs", api: ["bills", "expenses", "payments", "tds", "tds-suggest", "tds-deposits", "tds-export"] },
    { id: "banking", name: "Bank reconciliation", short: "Import statements and match them to your books", api: ["bank"] },
    { id: "gst", name: "GST returns", short: "GSTR-1 and GSTR-3B summaries, e-invoice and e-way bill files", api: ["gst", "einvoice", "einvoice-export"] },
  ] },
  { id: "bookings", name: "Bookings", short: "Appointments, classes and reservations on your website", adds: ["Online booking pages", "Reminders"], tint: "sky", feature: "bookings", paths: [], group: "sell" },
  { id: "promotions", name: "Promotions", short: "Pop-ups, offers and abandoned-cart recovery", adds: ["Offer pop-ups", "Cart recovery"], tint: "rose", feature: "promotions", paths: [/^\/projects\/[^/]+\/promotions(\/.*)?$/], group: "sell", api: { project: ["promotions"] }, uses: ["store"] },
  { id: "growth", name: "Growth & analytics", short: "Visitors, SEO checks and A/B tests", adds: ["Analytics", "A/B tests"], tint: "mint", feature: "growth", paths: [/^\/projects\/[^/]+\/growth(\/.*)?$/], group: "platform", api: { project: ["growth"] } },
  { id: "automations", name: "Automations", short: "Emails, WhatsApp and Slack when things happen", adds: ["Triggers & actions"], tint: "lavender", feature: "automations", paths: [/^\/projects\/[^/]+\/automations(\/.*)?$/], group: "platform", api: { project: ["automations"] } },
  { id: "chatbot", name: "Chatbot", short: "Answers visitors' questions from your own content", adds: ["Website chat"], tint: "sky", feature: "chatbot", paths: [/^\/projects\/[^/]+\/chatbot(\/.*)?$/], group: "platform", api: { project: ["chatbot"] } },
  { id: "data", name: "Data & APIs", short: "Your own tables, forms data and a ready-made API", adds: ["Data tables", "REST API"], tint: "butter", feature: "data", paths: [/^\/projects\/[^/]+\/data(\/.*)?$/], group: "platform", api: { project: ["data"] } },
  { id: "ai-ide", name: "AI code editor", short: "Edit the code behind your site with an AI pair", adds: ["Code editor"], tint: "rose", feature: "ai-ide", paths: [/^\/projects\/[^/]+\/ide(\/.*)?$/], group: "platform" },
];

export const MODULE_IDS = MODULES.map((m) => m.id);

/**
 * What onboarding does for each module when it's picked, in a line. Every
 * module must have one (the type makes sure); the work itself is in
 * server/workspace/setup.ts.
 */
export const SETUP_LABEL: Record<ModuleId, string> = {
  store: "Online store — you'll open your shop in the five-minute launch next",
  pos: "Point of sale — the counter till opens from your store",
  horeca: "Cloudesk for Horeca — ready for your venue",
  crm: "CRM — a sales pipeline with stages and win chances",
  portal: "Portals — a sign-in page for customers and suppliers at your workspace address",
  mail: "Mail — connect your first mailbox with a step-by-step guide on the Mail page",
  calendar: "Calendar — a Work calendar is ready; meeting invites from Mail show up to add",
  chat: "Chat — a #general channel with everyone in the workspace, and #announcements for news",
  requisitions: "Requisitions — numbering, a reminder every 2 days at 10:30 on weekdays, and five starter lists (KYC, ITR, GST…)",
  helpdesk: "Helpdesk — ticket numbering, Mon–Sat 9:30–6:30 business hours and response targets",
  hr: "HR & payroll — leave types, the work week and payroll rules",
  inventory: "Inventory — your first store room, ready for stock",
  sales: "Sales orders — a default price list and order numbering, ready for your first order",
  manufacturing: "Manufacturing — work order numbering, ready for your first recipe",
  quality: "Quality — ready for your first inspection plan",
  maintenance: "Assets & maintenance — work order numbering, ready for your first asset",
  documents: "Documents & e-sign — a document library and contract numbering",
  marketing: "Marketing — ready for your first segment and campaign",
  logistics: "Logistics & fleet — shipment and trip numbering",
  bi: "Reports & dashboards — ready to build your first report",
  grc: "Governance, risk & compliance — numbering, a 5×5 risk scale and an Indian statutory calendar to start from",
  copilot: "AI copilot — connect an Anthropic key in Settings → AI providers to start asking",
  education: "Education — admission and fee numbering, a June–May academic year and a CBSE-style grade scale",
  clinic: "Clinic — patient numbering, a 15-minute slot and consultation fees to start from",
  construction: "Construction — RA bill numbering per contract, 5% retention and 10% advance recovery to start from",
  objects: "Custom objects — ready for your first object; add fields to built-in records in Settings → Customise",
  work: "Projects — a task board and weekly timesheets, ready for your first project",
  accounting: "Accounting — a chart of accounts for an Indian business",
  invoicing: "Invoices — your first set of books, numbered for this financial year",
  bookings: "Bookings — add a booking page to your website when you're ready",
  promotions: "Promotions — offers appear on your site once it's live",
  growth: "Growth — analytics start with your first visitor",
  automations: "Automations — triggers ready for your first workflow",
  chatbot: "Chatbot — learns from your site once it's published",
  data: "Data & APIs — tables and an API for your projects",
  "ai-ide": "AI code editor — opens on any project",
};
export const moduleById = (id: string) => MODULES.find((m) => m.id === id);

/** Always included, whatever the industry. */
export const CORE = ["Home & web apps", "Website builder", "Brand kit", "Integrations", "Deployments & domains", "Team & roles"];

/** Whether a feature is on. `null` (never chosen) means everything is on. */
export const isOn = (modules: readonly string[] | null | undefined, id: ModuleId) => !modules || modules.includes(id);

/** Whether a member sees a module: it's on for the workspace and their role includes it. */
export const visibleTo = (org: { modules: readonly string[] | null; allowed?: readonly string[] | null; entitled?: readonly string[] | null }, id: ModuleId) => isOn(org.modules, id) && (!org.allowed || org.allowed.includes(id)) && inPlan(org, id);
/** Whether the workspace's subscription includes a feature (no subscription data = yes). */
export const inPlan = (org: { entitled?: readonly string[] | null }, id: ModuleId) => !org.entitled || org.entitled.includes(id);

/** Parts switched off, by module id. */
export type PartsOff = Partial<Record<string, string[]>>;
export const isPartOn = (partsOff: PartsOff | null | undefined, module: ModuleId, part: string) => !partsOff?.[module]?.includes(part);

/** The list plus everything it needs, in catalogue order. */
export function withRequirements(ids: readonly ModuleId[]): ModuleId[] {
  const out = new Set<ModuleId>();
  const add = (id: ModuleId) => {
    if (out.has(id)) return;
    out.add(id);
    for (const r of moduleById(id)?.requires ?? []) add(r);
  };
  ids.forEach(add);
  return MODULE_IDS.filter((id) => out.has(id));
}

/** Switched-on modules that need this one. */
export const neededBy = (id: ModuleId, on: readonly ModuleId[]) => on.filter((m) => moduleById(m)?.requires?.includes(id));

/** Parts switched off, cleaned up: known parts only, and a part's own needs switched on. */
export function normaliseParts(partsOff: PartsOff): PartsOff {
  const out: PartsOff = {};
  for (const m of MODULES) {
    const off = new Set((partsOff[m.id] ?? []).filter((p) => m.parts?.some((x) => x.id === p)));
    // A part that's on keeps what it needs on.
    for (const p of m.parts ?? []) if (!off.has(p.id)) for (const r of p.requires ?? []) off.delete(r);
    if (off.size) out[m.id] = [...off];
  }
  return out;
}

/**
 * What a role restricted to some modules may reach: those modules, everything
 * they need, and the APIs their own screens call (one step — not what those
 * modules' screens call in turn).
 */
export function reachable(allowed: readonly ModuleId[]): Set<ModuleId> {
  const full = withRequirements(allowed);
  return new Set([...full, ...full.flatMap((id) => moduleById(id)?.uses ?? [])]);
}

/** The module (and part) that owns an API path, if any. */
export function moduleForApi(pathname: string): { module: ModuleId; part?: string; scope: "org" | "project" | "root"; id?: string } | null {
  const m = pathname.match(/^\/api\/v1\/(?:(orgs|projects)\/([^/]+)\/)?([^/]+)(?:\/([^/]+))?/);
  if (!m) return null;
  const scope = m[1] === "orgs" ? "org" : m[1] === "projects" ? "project" : "root";
  const seg = m[3];
  const def = MODULES.find((x) => x.api?.[scope]?.includes(seg));
  if (!def) return null;
  const part = m[4] ? def.parts?.find((p) => p.api?.includes(m[4]))?.id : undefined;
  return { module: def.id, part, scope, id: m[2] };
}

/** The feature that owns a dashboard path, if any. */
export const moduleForPath = (path: string) => MODULES.find((m) => m.paths.some((re) => re.test(path)));

export type IndustryId = "retail" | "food" | "home" | "restaurant" | "cafe" | "bar" | "hotel" | "salon" | "clinic" | "fitness" | "services" | "software" | "education" | "construction" | "other";

export type Industry = {
  id: IndustryId;
  label: string;
  line: string;
  /** Unsplash photo id (free licence), checked by hand. */
  photo: string | null;
  tint: Tint;
  modules: ModuleId[];
  /** What the five-minute launch builds. */
  launch: { kind: "store" | "website"; category: string };
  /** For hospitality: the Horeca venue type. */
  venue?: "restaurant" | "cafe" | "bar" | "hotel";
  /** Answers the launch flow already understands. */
  sells: "online" | "shop" | "both" | "none";
};

export const INDUSTRIES: Industry[] = [
  { id: "retail", label: "Fashion & retail", line: "Clothing, footwear, accessories", photo: "1441986300917-64674bd600d8", tint: "lavender", modules: ["hr", "crm", "store", "pos", "inventory", "invoicing", "accounting", "promotions", "growth"], launch: { kind: "store", category: "fashion" }, sells: "both" },
  { id: "food", label: "Bakery & food brand", line: "Cakes, snacks, packaged food", photo: "1555507036-ab1f4038808a", tint: "butter", modules: ["store", "pos", "inventory", "promotions", "invoicing"], launch: { kind: "store", category: "bakery" }, sells: "both" },
  { id: "home", label: "Home & décor", line: "Furniture, ceramics, gifts", photo: "1555041469-a586c61ea9bc", tint: "mint", modules: ["crm", "store", "inventory", "invoicing", "promotions", "growth"], launch: { kind: "store", category: "home" }, sells: "online" },
  { id: "restaurant", label: "Restaurant", line: "Dine-in, takeaway, cloud kitchen", photo: "1517248135467-4c7edcad34c4", tint: "peach", modules: ["hr", "horeca", "invoicing", "promotions", "growth"], launch: { kind: "website", category: "restaurant" }, venue: "restaurant", sells: "shop" },
  { id: "cafe", label: "Café", line: "Coffee, brunch, desserts", photo: "1509042239860-f550ce710b93", tint: "butter", modules: ["hr", "horeca", "promotions", "invoicing"], launch: { kind: "website", category: "restaurant" }, venue: "cafe", sells: "shop" },
  { id: "bar", label: "Bar & lounge", line: "Cocktails, pubs, microbreweries", photo: "1514362545857-3bc16c4c7d1b", tint: "rose", modules: ["horeca", "promotions", "invoicing"], launch: { kind: "website", category: "restaurant" }, venue: "bar", sells: "shop" },
  { id: "hotel", label: "Hotel & resort", line: "Rooms, dining, events", photo: "1566073771259-6a8506099945", tint: "sky", modules: ["hr", "crm", "horeca", "bookings", "invoicing", "automations"], launch: { kind: "website", category: "hotel" }, venue: "hotel", sells: "none" },
  { id: "salon", label: "Salon & spa", line: "Hair, beauty, wellness", photo: "1540555700478-4be289fbecef", tint: "rose", modules: ["hr", "crm", "bookings", "pos", "invoicing", "promotions", "automations"], launch: { kind: "website", category: "salon" }, sells: "none" },
  { id: "clinic", label: "Clinic & healthcare", line: "Doctors, dentists, physio", photo: "1519494026892-80bbd2d6fd0d", tint: "sky", modules: ["clinic", "hr", "crm", "bookings", "invoicing", "accounting", "automations", "chatbot"], launch: { kind: "website", category: "clinic" }, sells: "none" },
  { id: "fitness", label: "Gym & studio", line: "Yoga, dance, training", photo: "1571019613454-1cb2f99b2d8b", tint: "mint", modules: ["hr", "crm", "bookings", "invoicing", "automations", "promotions"], launch: { kind: "website", category: "fitness" }, sells: "none" },
  { id: "services", label: "Agency & consulting", line: "Studios, freelancers, firms", photo: "1522071820081-009f0129c71c", tint: "lavender", modules: ["hr", "crm", "work", "invoicing", "accounting", "automations", "chatbot", "growth"], launch: { kind: "website", category: "consulting" }, sells: "none" },
  { id: "education", label: "School & coaching", line: "Schools, colleges, tuition, training", photo: "1523240795612-9a054b0db644", tint: "butter", modules: ["education", "hr", "crm", "accounting", "invoicing", "helpdesk", "automations"], launch: { kind: "website", category: "education" }, sells: "none" },
  { id: "construction", label: "Construction & contracting", line: "Civil, interiors, MEP, infrastructure", photo: "1503387762-592deb58ef4e", tint: "peach", modules: ["construction", "inventory", "hr", "accounting", "invoicing", "documents", "maintenance"], launch: { kind: "website", category: "homeservices" }, sells: "none" },
  { id: "software", label: "Startup & software", line: "Apps, SaaS, internal tools", photo: "1498050108023-c5249f4df085", tint: "sky", modules: ["hr", "crm", "work", "invoicing", "data", "ai-ide", "automations", "chatbot", "growth", "objects"], launch: { kind: "website", category: "app" }, sells: "none" },
  { id: "other", label: "Something else", line: "We'll start simple", photo: null, tint: "butter", modules: ["invoicing"], launch: { kind: "website", category: "other" }, sells: "none" },
];

export const industryById = (id: string | null | undefined) => INDUSTRIES.find((i) => i.id === id);

/** Onboarding goals the launch flow understands, from the chosen features. */
export function goalsFor(modules: ModuleId[], industry: Industry) {
  const g = new Set<string>();
  if (modules.includes("store")) g.add("sell");
  if (modules.includes("pos")) g.add("pos");
  if (modules.includes("bookings")) g.add("bookings");
  if (modules.includes("invoicing")) g.add("invoicing");
  if (industry.launch.kind === "website") g.add("enquiries");
  return [...g];
}

export const photoUrl = (id: string, w = 640) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=75`;
