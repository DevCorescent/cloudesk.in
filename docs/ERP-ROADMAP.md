# ERP roadmap — gap analysis against the enterprise feature list

Requested 2026-10-24: "build all the modules in our software and make them very advanced and accurate and wired internally properly", against a 32-area enterprise ERP list.

**Have** = built and tested (see CHECKLIST.md). **Partial** = some of it exists; what's missing is named. **Missing** = nothing yet. Each missing piece is assigned to a phase below. Features that need an outside provider (SSO identity providers, government e-invoicing/e-way bill GSPs, e-signature, SMS, push, travel booking, bank APIs) are built as real integrations that stay switched off until the workspace adds its own credentials — never simulated.

## Where we stand, area by area

| # | Area | Have | Partial / missing → phase |
| --- | --- | --- | --- |
| 1 | Organisation & company | Workspaces (tenants), departments & locations (HR), Horeca outlets, inventory locations, industry/company settings | Multi-company (legal entities), branches as a shared master, business units, fiscal years & period close, multi-currency accounting, org hierarchy → **B** |
| 2 | Users & access | Users, invites, 8 roles, workspace roles limited to modules, MFA (TOTP, enforceable), sessions & revocation, audit log, GitHub sign-in | Field-level security beyond salaries, data-level permissions (company/branch/warehouse/project), user groups, access reviews, delegated admin → **B**; SSO (SAML/OIDC) & SCIM → **V** |
| 3 | Dashboard & workspace | Module home screens, ⌘K quick actions, my tasks (CRM, projects), saved views (CRM) | Unified "My work" with pending approvals and alerts across modules → **A**; custom dashboards → **P** |
| 4 | Finance & accounting | CoA, GL, journals, AR (invoices), AP (bills), payments, bank reco, expenses, TB, P&L, BS, GST (GSTR-1/3B), lock date, audit trail to source | Receipt allocation across invoices, debit notes, payment runs with approval, petty cash, accruals/prepayments, fixed assets & depreciation, cash flow statement, cost/profit centres, budgets & variance, forecasting, TDS, multi-currency, intercompany, consolidation → **C** (+**B**); e-invoicing (IRN) & e-way bill → **C** (needs GSP credentials) |
| 5 | Sales | Catalogue, customers, quotes → invoices, discounts, returns & refunds (store), forecasting (CRM) | Sales orders, price lists & customer pricing, discount approval, contracts, delivery challans, credit limits, commissions, targets → **D** |
| 6 | CRM | Leads, assignment, scoring, pipelines, contact 360 across modules, activities, lifecycle, sequences | Campaigns, segmentation, feedback/NPS, retention & churn → **N** |
| 7 | Procurement | Suppliers, POs, GRN, supplier bills, payments, lead time | Requisitions, approvals by amount/budget, RFQ & comparison, contracts, quality inspection, 3-way match, supplier returns, onboarding/approval, performance, budgets, analytics → **E** |
| 8 | Inventory | Items, ledger, multi-location, transfers, adjustments, batches & expiry, counts, reorder, weighted average valuation, non-moving stock | Bins/zones, reservations, serial numbers, safety stock, FIFO valuation, ageing buckets, quarantine, barcode receiving, forecasting → **F** |
| 9 | Warehouse | Receiving, transfers | Putaway, picking, packing, dispatch, waves, bin quantities, cycle-count schedules, handheld screens, labour & performance → **F** |
| 10 | Supply chain & logistics | Shiprocket/EasyPost/Shippo shipping & tracking, returns (store), lead times | Demand/supply planning, transporters, fleet, routes, freight allocation, proof of delivery → **O** |
| 11 | Manufacturing | Horeca recipes with stock deduction | BOMs, routing, work centres, MRP, production & work orders, WIP, consumption, output, scrap, yield, costing, variance, shop floor → **G** |
| 12 | Quality | — | Everything → **H** |
| 13 | HR | Employees, org chart, joining/leaving checklists, hiring & candidates, offer letters, attendance, leave, holidays, self-service, manager approvals, performance, assets | Shifts & rosters, contracts/documents, L&D, grievances, disciplinary, workforce planning → **I** |
| 14 | Payroll | Structures, processing, payslips, PF/ESI/PT/TDS, bonuses, reimbursements, LOP, finalise, posting to ledger, bank file, reports | Overtime, final settlement, multi-level payroll approval → **I** (+**A**) |
| 15 | Projects | Portfolio, milestones, tasks, kanban, timesheets, budgets, billing (time & milestones), profitability, reports | Dependencies & Gantt, resource allocation/planning, project expenses, risks & issues, change requests, documents → **J** |
| 16 | Expense & travel | Claims with approval and payout (HR) | Receipt capture (AI extraction), categories & policies, travel requests, per diem, mileage, corporate cards, project/department reporting → **K** |
| 17 | Assets & maintenance | HR assets (assign/return) | Asset register shared with accounting, depreciation, disposal, preventive maintenance, work orders, spares, warranties, contracts → **C** + **L** |
| 18 | Documents & contracts | Invoice templates, HR letters | Repository, versioning, approval, contract lifecycle, obligations, expiry reminders, retention, e-sign (provider) → **M** |
| 19 | Workflow & approvals | Automations (triggers, steps, durable runs); leave/claim/timesheet approvals | Generic approval engine: multi-level, conditional, parallel, delegation, escalation, limits, SLA, history, analytics, versioning → **A** |
| 20 | Reporting & BI | Module reports with exports | Report builder, custom dashboards, scheduled reports & distribution, KPI definitions, drill-down, budget vs actual → **P** |
| 21 | AI | Planner, design/code AI, chatbot, photo→product, invoice-format reading, AI usage limits | ERP copilot over permitted data, NL reporting & search, document extraction for bills/receipts, anomaly detection, approval gates & AI audit log, governance → **Q** |
| 22 | Portals | "My orders" link, invoice share links, careers page | Customer portal (orders, invoices, payments, tickets), supplier portal (RFQs, POs, invoices, deliveries) → **R** |
| 23 | GRC | Audit log, lock date | Risk register, controls, internal audits, compliance calendar, policies, incidents, SoD checks, fraud indicators, ESG → **S** |
| 24 | Master data | Duplicate detection (CRM), validation, smart import | Shared masters (customers ↔ clients ↔ contacts, suppliers), UoM conversions, tax master, currency master, ownership, approval of master changes → **B** + **T** |
| 25 | Integrations & API | Public REST API with scoped keys, OpenAPI, webhooks, OAuth apps, rate limits, durable job retries | Integration catalogue, connector configuration & mapping, monitoring, error queues, reconciliation, API versioning → **U** |
| 26 | Notifications | Email (Resend/Postmark/SendGrid/SMTP), WhatsApp Cloud API, outbox | In-app notification centre, templates, preferences, reminders, escalations, delivery history; SMS and push need providers → **A** |
| 27 | Search & collaboration | ⌘K, filters, comments (builder, tasks), timelines (CRM) | Global record search across modules, calendar, internal knowledge base, cross-module mentions → **A** + **P** |
| 28 | Import & migration | Smart CSV/XLSX import with mapping, validation, preview, fixes, row errors; opening balances & stock | Saved mappings/templates, background imports for big files, migration history & reconciliation, export controls → **T** |
| 29 | Platform admin & SaaS | Plans & limits, Stripe/Razorpay billing, usage, module entitlements per workspace | Super-admin console, trials, support access, release flags, tenant export & offboarding, extension marketplace → **V** |
| 30 | Monitoring & security | Audit logs, health endpoint, structured logs, rate limits, job queue | Login monitoring & alerts, job/integration health screens, retention policies, incident log; backups/DR are infrastructure → **V** |
| 31 | Industry extensions | Retail, hospitality (Horeca), professional services, e-commerce | Manufacturing (**G**), distribution (**D**), construction, healthcare, education, fleet (**O**) → **W** |
| 32 | Enterprise extras | Custom fields (CRM), custom forms (sites), document templates (invoices), automations, SDK, accessibility basics | Custom fields/rules everywhere, custom objects, bulk operations with audit, mobile/offline, data residency → **X** |

## Phases, in build order

Ordered so each phase builds on the ones before it. The old roadmap's phases 5–13 (helpdesk, campaigns, subscriptions, documents & e-sign, approvals & forms, field service, loyalty, industry packs, custom objects) are folded in.

| Phase | Scope | Status |
| --- | --- | --- |
| A | Approval engine (rules by amount/department/module, multi-level, parallel, delegation, escalation, SLA, history) + notification centre (in-app, email, templates, preferences, reminders) + "My work" inbox; wired into bills, expenses, journals, POs, claims, payroll (leave & timesheets appear in My work) | Done 2026-10-24 (migration 0046) |
| B | Organisation: legal entities, branches, business units, cost & profit centres, fiscal years & period close, currencies & exchange rates, data-level permissions, user groups, access reviews | Done 2026-10-24 (migration 0047) |
| C | Finance+: receipts & allocation, debit notes, payment runs, petty cash, accruals/prepayments, fixed assets & depreciation, cash flow, budgets & variance, forecasting, TDS, multi-currency, intercompany & consolidation, e-invoice/e-way bill (GSP) | C1 done 2026-10-24 (assets & depreciation, repeating/spread journals, budgets, cash flow, forecast — migration 0048); C2 done 2026-10-24 (TDS, debit notes, receipts & advances, payment runs, petty cash — migrations 0049–0051); C3 done 2026-10-24 (foreign-currency invoices/bills/payments with exchange gain/loss and month-end revaluation, intercompany, consolidation, e-invoice/e-way bill JSON — migration 0052) |
| D | Sales: sales orders, price lists, customer pricing, credit limits, delivery challans, returns, commissions, targets | Done 2026-10-24 (module `sales`, migration 0053) |
| E | Procurement: requisitions, RFQ & comparison, contracts, inspection, 3-way match, supplier returns, onboarding, performance, budgets | Done 2026-10-24 (Inventory part `procurement`, migration 0054) |
| F | Inventory & warehouse: bins, reservations, serials, safety stock, FIFO, ageing, quarantine, pick/pack/dispatch, waves, cycle counts, scanning | Done 2026-10-24 (Inventory part `warehouse`, migration 0055) |
| G | Manufacturing: BOM, routing, work centres, MRP, production/work orders, WIP, costing | Done 2026-10-24 (module `manufacturing`, migration 0056) |
| H | Quality management | Done 2026-10-24 (module `quality`, migration 0057) |
| I | HR & payroll+: shifts & rosters, overtime, final settlement, contracts & documents, L&D, grievances, disciplinary, workforce planning | Done 2026-10-24 (HR parts shifts / records / relations / planning, migration 0058) |
| J | Projects+: dependencies & Gantt, resource planning, expenses, risks, change requests | Done 2026-10-24 (work parts planning / expenses / control, migration 0059) |
| K | Expense & travel | Done 2026-10-24 (HR claims + part travel, migration 0060) |
| L | Assets & maintenance | Done 2026-10-24 (module `maintenance`, migration 0061) |
| M | Documents, contracts & e-sign | Done 2026-10-24 (module `documents`, migration 0062) |
| N | Marketing: campaigns, segments, feedback, retention, loyalty & gift cards | Done 2026-10-24 (module `marketing`, migration 0063) |
| O | Logistics & fleet | Done 2026-10-24 (module `logistics`, migration 0064) |
| P | Reporting & BI: report builder, dashboards, scheduled reports, KPIs | Done 2026-10-24 (module `bi`, migration 0065) |
| Q | AI copilot & intelligent automation | Done 2026-10-25 (module `copilot`, Accounts "Read a bill", migration 0066) |
| R | Helpdesk, customer & supplier portals | Done 2026-10-25 (modules `helpdesk` and `portal`, migrations 0067–0069) |
| S | Governance, risk & compliance | Done 2026-10-25 (module `grc`, migration 0070) |
| T | Master data & migration | Done 2026-10-25 (Settings → Data, supplier bank approvals, migration 0071) |
| U | Integration hub | Done 2026-10-25 (Settings → Integrations, ERP API, migration 0072) |
| V | Platform admin, SSO/SCIM, security monitoring | Done 2026-10-25 (OIDC SSO, SCIM, sign-in monitoring, /admin console, export & offboarding, migration 0073) |
| W | Industry packs | Done 2026-10-25 (modules `education`, `clinic`, `construction`, migrations 0074–0076; distribution, manufacturing and fleet were D, G and O) |
| X | Custom objects, fields & rules everywhere; mobile & offline | Done 2026-10-25 (Settings → Customise, module `objects`, bulk changes with undo, offline outbox + idempotent writes, installable app, residency disclosure, migration 0077) |
