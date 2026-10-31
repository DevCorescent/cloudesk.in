"use client";

// Smart search (⌘K): pages, actions and records across every module you can
// open, ranked by how well they match — with an "Ask AI" mode that answers in
// conversation through the copilot (your data, your permissions, nothing
// changed without your confirmation). Recent picks come first when empty.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Lightbulb,
  AppWindow, ArrowRight, ArrowUpRight, Boxes, Briefcase, Clock, Contact, CornerDownLeft, FileText, FolderOpen, GraduationCap, HardHat, Handshake, Home, LayoutGrid, LayoutTemplate, LifeBuoy, Loader2,
  CalendarDays, Hash, ListChecks, LogOut, Mail, MessagesSquare, Monitor, Moon, NotebookPen, Search, Settings, Shapes, ShoppingCart, Sparkles, Stethoscope, Sun, Truck, User, UserRound, Users, Wand2, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Rich } from "@/components/copilot/copilot-app";
import { api, errorMessage } from "@/lib/client/api";
import { visibleTo } from "@/lib/workspace/modules";
import { useCompose } from "@/components/mail/compose-provider";
import { setTheme, signOut, useSession } from "./session-context";
import { SECTIONS } from "./sidebar";
import { KeyboardOnly, Keys } from "../ui/shortcut";

type Command = { id: string; label: string; group: string; icon: ReactNode; run: () => void; keywords?: string; sub?: string };
type ProjectRow = { id: string; name: string; kind: string };
type Hit = { kind: string; label: string; sub: string; link: string; id: string };
type Ai = { module: boolean; allowed: boolean; connected: boolean; canEnable: boolean; canConnect: boolean };
type Thread = { id: string; items: ({ role: "user" | "assistant"; text: string } | { role: "tool"; label: string; failed: boolean })[]; actions: { id: string; status: string; label: string; summary: string }[] };

const KIND: Record<string, { label: string; icon: ReactNode }> = {
  contacts: { label: "Contacts", icon: <Contact /> }, deals: { label: "Deals", icon: <Handshake /> }, suppliers: { label: "Suppliers", icon: <Truck /> }, items: { label: "Items", icon: <Boxes /> },
  employees: { label: "People", icon: <User /> }, projects: { label: "Projects", icon: <Briefcase /> }, invoices: { label: "Invoices", icon: <FileText /> }, tickets: { label: "Tickets", icon: <LifeBuoy /> },
  orders: { label: "Sales orders", icon: <ShoppingCart /> }, students: { label: "Students", icon: <GraduationCap /> }, patients: { label: "Patients", icon: <Stethoscope /> }, contracts: { label: "Contracts", icon: <HardHat /> },
  records: { label: "Your records", icon: <Shapes /> }, webapps: { label: "Web apps", icon: <AppWindow /> },
  notes: { label: "Notes", icon: <NotebookPen /> }, documents: { label: "Documents", icon: <FileText /> }, emails: { label: "Email", icon: <Mail /> }, events: { label: "Meetings", icon: <CalendarDays /> }, messages: { label: "Chat messages", icon: <MessagesSquare /> },
  channels: { label: "Channels", icon: <Hash /> }, tasks: { label: "Tasks", icon: <ListChecks /> }, members: { label: "Team", icon: <UserRound /> },
};

/** Other words people use for each area, so "salary" finds payroll and "bill" finds invoices. */
const SYNONYMS: Record<string, string> = {
  "/crm": "customers leads contacts clients pipeline follow up",
  "/sales": "sales orders price list dealer distributor quotation dispatch challan",
  "/marketing": "campaign email newsletter event promotion",
  "/helpdesk": "support tickets complaints customer service sla",
  "/portals": "customer portal supplier portal login self service",
  "/finance": "invoice invoices bill billing quote quotation receipt payment gst invoice finance",
  "/accounts": "accounting ledger books gst tds profit loss balance sheet bank reconciliation expenses",
  "/hr": "employees staff people attendance leave payroll salary payslip hiring",
  "/work": "projects tasks timesheet hours time tracking billable",
  "/documents": "files docs drive folders write word proposal contracts e-sign signature agreements",
  "/inventory": "stock warehouse items products purchase supplier reorder",
  "/manufacturing": "production bom recipe work order mrp",
  "/quality": "inspection qc defects non conformance",
  "/maintenance": "assets machines breakdown service amc",
  "/logistics": "shipping delivery fleet vehicles trips courier",
  "/clinic": "patients doctor appointment prescription opd",
  "/school": "students fees school classes attendance exams",
  "/construction": "boq ra bill contract site diary measurement",
  "/reports": "analytics dashboard kpi charts report builder",
  "/compliance": "risk audit policy filings statutory calendar grc",
  "/objects": "custom objects records fields",
  "/projects": "web apps websites sites stores",
  "/create": "new website app ai build",
  "/templates": "website templates designs",
};

/**
 * How well a command matches: every word of the query must appear — at the
 * start of a word scores best. For longer words, letters in order count too
 * ("invce" finds Invoices) but only when they sit close together.
 */
function score(text: string, needle: string, loose = true): number {
  const hay = text.toLowerCase();
  let total = 0;
  for (const w of needle.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = hay.indexOf(w);
    if (at >= 0) {
      total += at === 0 ? 6 : /[\s\-—·&(/]/.test(hay[at - 1] ?? "") ? 4 : 2;
      continue;
    }
    if (!loose || w.length < 4) return 0;
    let i = 0;
    let first = -1;
    let last = -1;
    for (let k = 0; k < hay.length && i < w.length; k++)
      if (hay[k] === w[i]) {
        if (first < 0) first = k;
        last = k;
        i++;
      }
    if (i < w.length || last - first > w.length * 1.6) return 0;
    total += 1;
  }
  return total;
}

/** Bold the part of a label that matched. */
function Mark({ text, q }: { text: string; q: string }) {
  const w = q.trim().split(/\s+/)[0]?.toLowerCase();
  const i = w ? text.toLowerCase().indexOf(w) : -1;
  if (!w || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <b className="font-semibold text-fg">{text.slice(i, i + w.length)}</b>
      {text.slice(i + w.length)}
    </>
  );
}

const RECENT_KEY = "cloudesk.search.recent";
const readRecent = (): { id: string; label: string; href: string; group: string }[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
};

const SUGGEST = ["Who owes me the most money right now?", "How are sales this month compared with last month?", "Which items should I reorder?", "Summarise my open support tickets"];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const mail = useCompose();
  const { org } = useSession();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"search" | "ai">("search");
  const [scopeTab, setScopeTab] = useState<"all" | "pages" | "records" | "actions">("all");
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<ReturnType<typeof readRecent>>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setActive(0);
      setScopeTab("all");
      setRecent(readRecent());
      d.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 160);
    return () => clearTimeout(t);
  }, [q]);

  const projects = useQuery({
    queryKey: ["projects", org.id, "palette", debounced],
    queryFn: () => api<{ items: ProjectRow[] }>(`/api/v1/orgs/${org.id}/projects?limit=6${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
    enabled: open && mode === "search",
  });
  const records = useQuery({
    queryKey: ["search", org.id, debounced],
    queryFn: () => api<{ results: Hit[] }>(`/api/v1/orgs/${org.id}/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && mode === "search" && debounced.length >= 2,
    placeholderData: (p) => p,
  });
  const ai = useQuery({ queryKey: ["search", org.id, "ai"], queryFn: () => api<{ ai: Ai }>(`/api/v1/orgs/${org.id}/search?ai=1`), enabled: open, staleTime: 60_000 });

  const go = (href: string) => () => router.push(href);
  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "create", label: "Create a web app", group: "Actions", icon: <Wand2 />, run: go("/create"), keywords: "new build website" },
      { id: "templates", label: "Browse templates", group: "Actions", icon: <LayoutTemplate />, run: go("/templates") },
      { id: "invite", label: "Invite a team member", group: "Actions", icon: <Users />, run: go("/team") },
      ...(mail.available
        ? [
            { id: "mail-compose", label: "Write an email", group: "Actions", icon: <Mail />, run: () => mail.compose(), keywords: "compose send mail email message" },
            { id: "mail-contacts", label: "Mail — Contacts & groups", group: "Navigate", icon: <Mail />, run: go("/mail/contacts"), keywords: "address book people groups lists" },
            { id: "calendar", label: "Go to Calendar", group: "Navigate", icon: <CalendarDays />, run: go("/calendar"), keywords: "meetings events schedule" },
          ]
        : []),
      ...(visibleTo(org, "chat")
        ? [
            { id: "chat", label: "Go to Chat", group: "Navigate", icon: <MessagesSquare />, run: go("/chat"), keywords: "team messages channels dm direct talk" },
            { id: "chat-activity", label: "Chat — Mentions & activity", group: "Navigate", icon: <MessagesSquare />, run: go("/chat/activity"), keywords: "mentions replies notifications" },
            { id: "chat-saved", label: "Chat — Saved for later", group: "Navigate", icon: <MessagesSquare />, run: go("/chat/saved"), keywords: "bookmarks reminders" },
          ]
        : []),
      { id: "home", label: "Go to Home", group: "Navigate", icon: <Home />, run: go("/home") },
      { id: "request-feature", label: "Request a feature", group: "Actions", icon: <Lightbulb />, run: go("/requests"), keywords: "idea suggestion feedback wish roadmap missing" },
      { id: "whats-new", label: "Feature requests — roadmap & what's new", group: "Navigate", icon: <Lightbulb />, run: go("/requests/roadmap"), keywords: "roadmap released changelog new features" },
      ...(visibleTo(org, "hr")
        ? [
            { id: "hr", label: "Go to HR & payroll", group: "Navigate", icon: <Contact />, run: go("/hr"), keywords: "employees staff people attendance leave payroll salary payslip" },
            { id: "hr-leave", label: "HR — Apply for leave", group: "Navigate", icon: <Contact />, run: go("/hr/leave"), keywords: "holiday time off vacation" },
            { id: "hr-me", label: "HR — Check in, my payslips", group: "Navigate", icon: <Contact />, run: go("/hr/me"), keywords: "attendance salary" },
          ]
        : []),
      { id: "inbox", label: "Go to My work", group: "Navigate", icon: <Contact />, run: go("/inbox"), keywords: "inbox approvals pending tasks notifications" },
      { id: "remind", label: "My work — Notifications", group: "Navigate", icon: <Contact />, run: go("/inbox"), keywords: "bell alerts reminders" },
      ...(["owner", "admin"].includes(org.role) ? [{ id: "org-structure", label: "Settings — Organisation (companies, branches, cost centres)", group: "Navigate", icon: <Contact />, run: go("/settings/organisation"), keywords: "company entity branch region cost centre profit centre currency exchange rate groups access review" }] : []),
      ...(["owner", "admin"].includes(org.role) ? [{ id: "ap-rules", label: "Settings — Approval rules", group: "Navigate", icon: <Contact />, run: go("/settings/approvals"), keywords: "approve workflow policy limits delegation" }] : []),
      ...(visibleTo(org, "accounting")
        ? [
            { id: "acc", label: "Go to Accounts", group: "Navigate", icon: <Contact />, run: go("/accounts"), keywords: "ledger books accounting profit loss balance sheet" },
            { id: "acc-exp", label: "Accounts — Record an expense", group: "Actions", icon: <Contact />, run: go("/accounts/bills?new=expense"), keywords: "bill spend cost" },
            { id: "acc-gst", label: "Accounts — GST returns", group: "Navigate", icon: <Contact />, run: go("/accounts/gst"), keywords: "gstr1 gstr3b tax" },
            { id: "acc-pl", label: "Accounts — Profit & loss", group: "Navigate", icon: <Contact />, run: go("/accounts/reports/profit-loss"), keywords: "p&l income report" },
          ]
        : []),
      ...(visibleTo(org, "inventory")
        ? [
            { id: "inv", label: "Go to Inventory", group: "Navigate", icon: <Contact />, run: go("/inventory"), keywords: "stock warehouse items purchase supplier" },
            { id: "inv-po", label: "Inventory — New purchase order", group: "Actions", icon: <Contact />, run: go("/inventory/orders/new"), keywords: "po buy supplier order" },
            { id: "inv-reorder", label: "Inventory — What to reorder", group: "Navigate", icon: <Contact />, run: go("/inventory/reorder"), keywords: "low stock" },
          ]
        : []),
      ...(visibleTo(org, "sales")
        ? [
            { id: "sales", label: "Go to Sales", group: "Navigate", icon: <Contact />, run: go("/sales"), keywords: "orders customers price list dealers distributor" },
            { id: "sales-new", label: "Sales — New order", group: "Actions", icon: <Contact />, run: go("/sales/orders/new"), keywords: "sales order so customer" },
            { id: "sales-cust", label: "Sales — Customer credit limits", group: "Navigate", icon: <Contact />, run: go("/sales/customers"), keywords: "credit limit terms outstanding" },
          ]
        : []),
      ...(visibleTo(org, "manufacturing")
        ? [
            { id: "mfg", label: "Go to Manufacturing", group: "Navigate", icon: <Contact />, run: go("/manufacturing"), keywords: "production work order bom recipe factory" },
            { id: "mfg-mrp", label: "Manufacturing — Run MRP", group: "Actions", icon: <Contact />, run: go("/manufacturing/mrp"), keywords: "material requirements planning what to make buy" },
          ]
        : []),
      ...(visibleTo(org, "quality")
        ? [
            { id: "qc", label: "Go to Quality", group: "Navigate", icon: <Contact />, run: go("/quality"), keywords: "inspection qc ncr capa defect" },
            { id: "qc-insp", label: "Quality — Inspections to do", group: "Navigate", icon: <Contact />, run: go("/quality/inspections"), keywords: "inspect lot sample" },
          ]
        : []),
      ...(visibleTo(org, "maintenance")
        ? [
            { id: "mnt", label: "Go to Assets & maintenance", group: "Navigate", icon: <Contact />, run: go("/maintenance"), keywords: "asset machine equipment repair breakdown preventive pm amc warranty cmms" },
            { id: "mnt-new", label: "Maintenance — Report a breakdown", group: "Actions", icon: <Contact />, run: go("/maintenance/orders/new"), keywords: "repair broken fault request" },
          ]
        : []),
      ...(visibleTo(org, "documents")
        ? [
            { id: "docs", label: "Go to Documents", group: "Navigate", icon: <FileText />, run: go("/documents"), keywords: "files folders library contracts agreements esign signature" },
            { id: "docs-contracts", label: "Documents — Contracts", group: "Navigate", icon: <Contact />, run: go("/documents/contracts"), keywords: "agreement renewal nda msa lease obligations" },
            { id: "docs-new", label: "New document", group: "Create", icon: <FileText />, run: go("/documents/new"), keywords: "write doc word page blank" },
            { id: "docs-proposal", label: "New proposal", group: "Create", icon: <FileText />, run: go("/documents/new?template=proposal"), keywords: "quote pitch client document template" },
            { id: "docs-nda", label: "New NDA", group: "Create", icon: <FileText />, run: go("/documents/new?template=nda"), keywords: "non disclosure agreement confidentiality template" },
            { id: "docs-meeting", label: "New meeting notes", group: "Create", icon: <FileText />, run: go("/documents/new?template=meeting"), keywords: "minutes agenda actions template" },
            { id: "docs-recent", label: "Documents — Recent", group: "Navigate", icon: <FileText />, run: go("/documents/recent"), keywords: "files opened lately" },
          ]
        : []),
      ...(visibleTo(org, "marketing")
        ? [
            { id: "mkt", label: "Go to Marketing", group: "Navigate", icon: <Contact />, run: go("/marketing"), keywords: "campaign email newsletter segment event webinar roi utm" },
            { id: "mkt-new", label: "Marketing — New campaign", group: "Actions", icon: <Contact />, run: go("/marketing/campaigns"), keywords: "send newsletter blast" },
          ]
        : []),
      ...(visibleTo(org, "logistics")
        ? [
            { id: "lgx", label: "Go to Logistics", group: "Navigate", icon: <Contact />, run: go("/logistics"), keywords: "shipment courier transporter freight lr awb tracking dispatch fleet vehicle trip fuel" },
            { id: "lgx-ship", label: "Logistics — Shipments", group: "Navigate", icon: <Contact />, run: go("/logistics/shipments"), keywords: "dispatch consignment tracking" },
          ]
        : []),
      ...(visibleTo(org, "bi")
        ? [
            { id: "bi", label: "Go to Reports & dashboards", group: "Navigate", icon: <Contact />, run: go("/reports"), keywords: "report dashboard kpi chart analytics bi pivot" },
            { id: "bi-new", label: "Reports — New report", group: "Actions", icon: <Contact />, run: go("/reports/new"), keywords: "build report chart" },
          ]
        : []),
      ...(visibleTo(org, "helpdesk")
        ? [
            { id: "hd", label: "Go to Helpdesk", group: "Navigate", icon: <Contact />, run: go("/helpdesk"), keywords: "support ticket customer complaint sla service desk" },
            { id: "hd-new", label: "Helpdesk — New ticket", group: "Actions", icon: <Contact />, run: go("/helpdesk/tickets/new"), keywords: "log call complaint issue" },
          ]
        : []),
      ...(visibleTo(org, "portal")
        ? [{ id: "portal", label: "Go to Customer & supplier portals", group: "Navigate", icon: <Contact />, run: go("/portals"), keywords: "portal self service customer supplier vendor login invoices" }]
        : []),
      ...(visibleTo(org, "grc")
        ? [
            { id: "grc", label: "Go to Governance, risk & compliance", group: "Navigate", icon: <Contact />, run: go("/compliance"), keywords: "risk control audit compliance policy incident gst filing due dates esg sod fraud" },
            { id: "grc-incident", label: "Compliance — Report an incident", group: "Actions", icon: <Contact />, run: go("/compliance/incidents/new"), keywords: "breach security safety fraud report" },
          ]
        : []),
      ...(visibleTo(org, "construction")
        ? [{ id: "con", label: "Go to Construction", group: "Navigate", icon: <Contact />, run: go("/construction"), keywords: "boq measurement book ra bill running account retention site diary contract civil" }]
        : []),
      ...(visibleTo(org, "objects")
        ? [{ id: "objects", label: "Go to Custom objects", group: "Navigate", icon: <Contact />, run: go("/objects"), keywords: "custom object records fields bulk" }]
        : []),
      ...(visibleTo(org, "clinic")
        ? [
            { id: "clinic", label: "Go to Clinic", group: "Navigate", icon: <Contact />, run: go("/clinic"), keywords: "patients doctor appointment queue token prescription opd consultation" },
            { id: "clinic-patient", label: "Clinic — New patient", group: "Actions", icon: <Contact />, run: go("/clinic/patients?new=1"), keywords: "register patient" },
          ]
        : []),
      ...(visibleTo(org, "education")
        ? [
            { id: "edu", label: "Go to Education", group: "Navigate", icon: <Contact />, run: go("/school"), keywords: "school students class fees attendance exam marks report card coaching tuition" },
            { id: "edu-fees", label: "Education — Fees due", group: "Navigate", icon: <Contact />, run: go("/school/fees"), keywords: "fee dues collect receipt" },
          ]
        : []),
      { id: "notes", label: "Notes", group: "Navigate", icon: <Contact />, run: go("/notes"), keywords: "notes note daily journal write memo folder docs" },
      { id: "notes-new", label: "Notes — New note", group: "Actions", icon: <NotebookPen />, run: go("/notes?new=1"), keywords: "write memo jot create note meeting notes" },
      ...(visibleTo(org, "invoicing") ? [{ id: "inv-open", label: "Invoices — Create or find an invoice", group: "Actions", icon: <FileText />, run: go("/finance"), keywords: "invoice bill gst raise quote estimate proforma credit note new invoice" }] : []),
      ...(visibleTo(org, "crm") ? [{ id: "crm-new-contact", label: "CRM — Add a contact", group: "Actions", icon: <Contact />, run: go("/crm/contacts"), keywords: "new customer lead client person add contact" }, { id: "crm-new-deal", label: "CRM — Add a deal", group: "Actions", icon: <Handshake />, run: go("/crm/deals"), keywords: "new opportunity pipeline sale deal" }] : []),
      ...(visibleTo(org, "calendar") ? [{ id: "cal-new", label: "Calendar — Schedule a meeting", group: "Actions", icon: <CalendarDays />, run: go("/calendar"), keywords: "new event meeting schedule book call invite" }] : []),
      { id: "partner", label: "Partner program", group: "Navigate", icon: <Handshake />, run: go("/partner"), keywords: "partner affiliate referral commission earn reseller" },
      ...(["owner", "billing", "admin"].includes(org.role) ? [{ id: "set-billing", label: "Settings — Billing & plan", group: "Navigate", icon: <Settings />, run: go("/settings/billing"), keywords: "plan subscription upgrade invoice payment trial pricing" }] : []),
      { id: "set-notify", label: "Settings — Notifications", group: "Navigate", icon: <Settings />, run: go("/settings/notifications"), keywords: "alerts email notifications reminders" },
      { id: "set-security", label: "Settings — Sign-in & security", group: "Navigate", icon: <Settings />, run: go("/settings/identity"), keywords: "password two-step 2fa mfa sso sessions security" },
      { id: "set-data", label: "Settings — Import & export data", group: "Navigate", icon: <Settings />, run: go("/settings/data"), keywords: "import export csv excel backup download" },
      { id: "set-integrations", label: "Settings — Integrations", group: "Navigate", icon: <Settings />, run: go("/settings/integrations"), keywords: "integrations api keys webhooks connect apps" },
      { id: "notes-today", label: "Today's note", group: "Navigate", icon: <Contact />, run: go("/notes?today=1"), keywords: "daily note today journal" },
      { id: "calculator", label: "Calculator", group: "Navigate", icon: <Contact />, run: go("/calculator"), keywords: "calculator calculate gst emi margin interest percent sum formula" },
      ...(visibleTo(org, "copilot")
        ? [{ id: "copilot", label: "Ask the copilot", group: "Navigate", icon: <Contact />, run: go("/copilot"), keywords: "ai assistant ask question claude chat help" }]
        : []),
      ...(visibleTo(org, "work")
        ? [
            { id: "work", label: "Go to Projects & time", group: "Navigate", icon: <Contact />, run: go("/work"), keywords: "projects tasks board kanban" },
            { id: "work-new", label: "Projects & time — New project", group: "Actions", icon: <Contact />, run: go("/work/projects/new"), keywords: "client job engagement" },
            { id: "work-ts", label: "Projects — My timesheet", group: "Navigate", icon: <Contact />, run: go("/work/timesheet"), keywords: "hours time log timer" },
            { id: "work-tasks", label: "Projects — My tasks", group: "Navigate", icon: <Contact />, run: go("/work/tasks"), keywords: "todo assigned due" },
          ]
        : []),
      ...(visibleTo(org, "crm")
        ? [
            { id: "crm", label: "Go to CRM", group: "Navigate", icon: <Contact />, run: go("/crm"), keywords: "customers contacts leads sales pipeline deals" },
            { id: "crm-contacts", label: "CRM — Contacts", group: "Navigate", icon: <Contact />, run: go("/crm/contacts"), keywords: "people leads customers" },
            { id: "crm-deals", label: "CRM — Deals board", group: "Navigate", icon: <Contact />, run: go("/crm/deals"), keywords: "pipeline kanban opportunities" },
            { id: "crm-tasks", label: "CRM — My tasks", group: "Navigate", icon: <Contact />, run: go("/crm/tasks"), keywords: "to do follow up" },
          ]
        : []),
      { id: "projects", label: "Go to Web apps", group: "Navigate", icon: <FolderOpen />, run: go("/projects"), keywords: "projects sites websites stores" },
      { id: "features", label: "Workspace features", group: "Navigate", icon: <LayoutGrid />, run: go("/settings/features"), keywords: "modules apps switch on off turn enable" },
      { id: "settings", label: "Open settings", group: "Navigate", icon: <Settings />, run: go("/settings") },
      { id: "ai", label: "Connect an AI provider", group: "Navigate", icon: <Settings />, run: go("/settings/ai"), keywords: "anthropic api key model" },
      { id: "light", label: "Theme: Light", group: "Preferences", icon: <Sun />, run: () => setTheme("light") },
      { id: "dark", label: "Theme: Dark", group: "Preferences", icon: <Moon />, run: () => setTheme("dark") },
      { id: "system", label: "Theme: Match system", group: "Preferences", icon: <Monitor />, run: () => setTheme("system") },
      { id: "logout", label: "Sign out", group: "Account", icon: <LogOut />, run: () => void signOut() },
    ];
    // Every page in the sidebar, with the words people use for it (they replace the old "Go to …" entries).
    const sidebar = SECTIONS.flatMap((s) => s.items.filter((i) => !i.module || visibleTo(org, i.module)).map((i) => ({ ...i, section: s.label })));
    const pages: Command[] = [
      { id: "nav-/home", label: "Home", sub: "Dashboard", group: "Pages", icon: <Home />, run: go("/home"), keywords: "dashboard overview start" },
      { id: "nav-/inbox", label: "My work", sub: "Approvals and tasks for you", group: "Pages", icon: <Clock />, run: go("/inbox"), keywords: "inbox approvals tasks to do pending notifications" },
      ...sidebar.map((i) => ({ id: `nav-${i.href}`, label: i.label, sub: i.section, group: "Pages", icon: i.icon, run: go(i.href), keywords: SYNONYMS[i.href] ?? "" })),
    ];
    // Actions keep their deep links and words, and take their module's icon.
    const iconFor = (label: string) => {
      const area = label.split(" — ")[0]!.toLowerCase();
      return sidebar.find((i) => i.label.toLowerCase().startsWith(area) || area.startsWith(i.label.toLowerCase().split(" ")[0]!))?.icon;
    };
    const all = [
      ...pages,
      ...base
        .filter((c) => !/^Go to /.test(c.label))
        .map((c) => ({ ...c, group: c.group === "Navigate" ? "Pages" : c.group, icon: c.label.includes(" — ") ? (iconFor(c.label) ?? c.icon) : c.icon })),
    ];
    const needle = q.trim();
    const proj: Command[] = (projects.data?.items ?? []).map((p) => ({ id: `p-${p.id}`, label: p.name, sub: "Web app", group: "Web apps", icon: <FolderOpen />, run: go(`/projects/${p.id}`), keywords: "web app site store" }));
    if (!needle) return [...proj.slice(0, 3), ...all.filter((c) => c.group === "Actions").slice(0, 6), ...all.filter((c) => c.group === "Pages").slice(0, 8), ...all.filter((c) => c.group === "Preferences")];
    const scored = all
      .map((c) => ({ c, s: score(`${c.label} ${c.sub ?? ""}`, needle) * 2 + score(c.keywords ?? "", needle, false) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    // Strong matches (the words themselves, not just letters in order) lead; weak ones follow the records.
    const strong = new Set(scored.filter((x) => x.s >= 4).map((x) => x.c.id));
    const ranked = scored.map((x) => x.c);
    const recs: Command[] = (records.data?.results ?? []).map((h) => ({ id: `r-${h.kind}-${h.id}`, label: h.label, sub: h.sub, group: KIND[h.kind]?.label ?? "Records", icon: KIND[h.kind]?.icon ?? <Search />, run: go(h.link) }));
    const pagesFirst = ranked.filter((c) => c.group === "Pages").slice(0, 6);
    const actions = ranked.filter((c) => c.group === "Actions").slice(0, 5);
    const rest = ranked.filter((c) => c.group !== "Pages" && c.group !== "Actions").slice(0, 4);
    if (scopeTab === "pages") return [...pagesFirst, ...rest];
    if (scopeTab === "actions") return actions;
    if (scopeTab === "records") return [...recs, ...proj];
    // The best page match leads; then records people are usually after; then actions.
    const top = [...pagesFirst, ...actions].filter((c) => strong.has(c.id));
    const weak = [...pagesFirst, ...actions, ...rest].filter((c) => !strong.has(c.id));
    return [...top.filter((c) => c.group === "Pages").slice(0, 3), ...recs.slice(0, 12), ...proj.slice(0, 4), ...top.filter((c) => c.group === "Actions"), ...top.filter((c) => c.group === "Pages").slice(3), ...rest.filter((c) => strong.has(c.id)), ...(recs.length ? [] : weak).slice(0, 4)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, projects.data, records.data, scopeTab]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command) => {
    if (c.id === "ask-ai") {
      setMode("ai");
      inputRef.current?.focus();
      return;
    }
    try {
      const item = { id: c.id, label: c.label, group: c.group, href: "" };
      const prev = readRecent().filter((x) => x.id !== c.id);
      localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...prev].slice(0, 6)));
    } catch {
      // Not remembered; fine.
    }
    onClose();
    c.run();
  };
  const recentCommands = !q.trim() && scopeTab === "all" ? recent.map((r) => commands.find((c) => c.id === r.id)).filter((c): c is Command => !!c) : [];
  const listed = recentCommands.length ? [...recentCommands.map((c) => ({ ...c, group: "Recent" })), ...commands.filter((c) => !recentCommands.some((r) => r.id === c.id))] : commands;
  // Any search can become a question.
  const askRow: Command | null = q.trim().length >= 3 && scopeTab === "all" ? { id: "ask-ai", label: `Ask AI: “${q.trim()}”`, sub: "An answer from everything in your workspace, with the records it used", group: "Ask AI", icon: <Sparkles />, run: () => {} } : null;
  const list = askRow ? [...listed, askRow] : listed;

  const searching = mode === "search" && debounced.length >= 2 && records.isFetching;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Search"
      className="palette m-auto mt-[9vh] w-[calc(100%-24px)] max-w-[680px] overflow-hidden rounded-[22px] border border-fg/[0.08] bg-[var(--surface-solid)] p-0 text-fg shadow-[0_40px_100px_-30px_rgb(10_5_30/0.5),0_0_0_1px_rgb(255_255_255/0.04)] backdrop:bg-[rgb(10_10_20/0.28)] backdrop:backdrop-blur-[6px]"
    >
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <span className={clsx("grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors", mode === "ai" ? "bg-gradient-to-br from-[#FF5A5F] to-[#FDBA5A] text-white" : "bg-surface-2 text-muted")}>
          {mode === "ai" ? <Sparkles className="size-4" /> : searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        </span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              setMode(mode === "ai" ? "search" : "ai");
              return;
            }
            if (mode === "ai") return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && list[active]) {
              e.preventDefault();
              run(list[active]);
            }
          }}
          placeholder={mode === "ai" ? "Ask anything about your business…" : "Search pages, actions, customers, invoices, items…"}
          aria-label={mode === "ai" ? "Ask AI" : "Search"}
          aria-controls={mode === "search" ? "cc-palette-list" : undefined}
          aria-activedescendant={mode === "search" && list[active] ? `cmd-${list[active].id}` : undefined}
          role={mode === "search" ? "combobox" : undefined}
          aria-expanded={mode === "search" ? true : undefined}
          className="h-11 min-w-0 flex-1 bg-transparent text-[17px] tracking-[-0.01em] outline-none placeholder:text-subtle focus-visible:outline-none"
        />
        {q && (
          <button type="button" aria-label="Clear" onClick={() => (setQ(""), inputRef.current?.focus())} className="grid size-7 place-items-center rounded-full text-subtle hover:bg-surface-2 hover:text-fg">
            <X className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={mode === "ai"}
          aria-label="Ask AI"
          onClick={() => (setMode(mode === "ai" ? "search" : "ai"), inputRef.current?.focus())}
          className={clsx("group inline-flex h-8 shrink-0 items-center gap-2 rounded-full pr-1 pl-3 text-[12.5px] font-medium transition-all", mode === "ai" ? "bg-fg text-bg" : "bg-surface-2 text-muted hover:text-fg")}
        >
          <Sparkles className="size-3.5" />
          <span className="hidden sm:inline">Ask AI</span>
          <span className={clsx("relative h-5 w-8 rounded-full transition-colors", mode === "ai" ? "bg-gradient-to-r from-[#FF5A5F] to-[#FDBA5A]" : "bg-fg/15")}>
            <span className={clsx("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", mode === "ai" && "translate-x-3")} />
          </span>
        </button>
      </div>

      {mode === "search" ? (
        <>
          <div className="flex gap-1 border-b border-border px-4 pb-2.5" role="tablist" aria-label="Search in">
            {(["all", "pages", "records", "actions"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={scopeTab === t} onClick={() => (setScopeTab(t), setActive(0), inputRef.current?.focus())} className={clsx("rounded-full px-2.5 py-1 text-[12px] font-medium capitalize transition-colors", scopeTab === t ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                {t === "records" ? "Records" : t}
              </button>
            ))}
          </div>
          <div ref={listRef} id="cc-palette-list" role="listbox" className="max-h-[min(58vh,520px)] overflow-y-auto overscroll-contain p-2">
            {listed.length === 0 && (
              <div className="grid place-items-center gap-2 px-6 py-10 text-center">
                <Search className="size-5 text-subtle" />
                <p className="text-[13.5px] font-medium">{searching ? "Searching…" : `Nothing found for “${q}”`}</p>
                {!searching && !askRow && (
                  <button type="button" onClick={() => setMode("ai")} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium hover:bg-surface-3">
                    <Sparkles className="size-3.5" /> Ask AI instead
                  </button>
                )}
              </div>
            )}
            {list.map((c, i) => {
              const header = i === 0 || list[i - 1]!.group !== c.group ? c.group : null;
              const on = i === active;
              return (
                <div key={`${c.group}-${c.id}`}>
                  {header && <p className="flex items-center gap-1.5 px-2.5 pt-3 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">{header === "Recent" && <Clock className="size-3" />}{header}</p>}
                  <button
                    id={`cmd-${c.id}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                    className={clsx("group flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors", on ? "bg-surface-2" : "")}
                  >
                    <span className={clsx("grid size-8 shrink-0 place-items-center rounded-[9px] border transition-colors [&_svg]:size-4", on ? "border-transparent bg-fg text-bg" : "border-border bg-surface text-muted")}>{c.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-fg/85"><Mark text={c.label} q={q} /></span>
                      {c.sub && <span className="block truncate text-[12px] text-subtle">{c.sub}</span>}
                    </span>
                    {on ? <CornerDownLeft className="size-3.5 shrink-0 text-subtle" /> : c.group !== "Preferences" && c.group !== "Account" && c.group !== "Actions" ? <ArrowUpRight className="size-3.5 shrink-0 text-transparent" /> : null}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <AiPanel ai={ai.data?.ai} question={q} setQuestion={setQ} focus={() => inputRef.current?.focus()} onClose={onClose} onOpen={(href) => { onClose(); router.push(href); }} />
      )}

      <KeyboardOnly>
        <div className="flex items-center gap-4 border-t border-border bg-surface/60 px-4 py-2 text-[11.5px] text-subtle">
          {mode === "search" ? (
            <>
              <span className="flex items-center gap-1"><Keys k="up" /><Keys k="down" /> move</span>
              <span className="flex items-center gap-1"><Keys k="enter" /> open</span>
            </>
          ) : (
            <span className="flex items-center gap-1"><Keys k="enter" /> ask</span>
          )}
          <span className="flex items-center gap-1"><Keys k="tab" /> {mode === "ai" ? "back to search" : "ask AI"}</span>
          <span className="ml-auto flex items-center gap-1"><Keys k="esc" /> close</span>
        </div>
      </KeyboardOnly>
    </dialog>
  );
}


/** "Ask AI": the copilot when it's on for you; otherwise an answer from what search finds. */
function AiPanel({ ai, question, setQuestion, focus, onClose, onOpen }: { ai: Ai | undefined; question: string; setQuestion: (q: string) => void; focus: () => void; onClose: () => void; onOpen: (href: string) => void }) {
  if (ai && ai.connected && !(ai.module && ai.allowed)) return <AskSearch question={question} setQuestion={setQuestion} focus={focus} onOpen={onOpen} copilotHint={!ai.module && ai.canEnable} onClose={onClose} />;
  return <CopilotPanel ai={ai} question={question} setQuestion={setQuestion} focus={focus} onClose={onClose} />;
}

/** The conversational mode: questions answered by the copilot, from your data. */
function CopilotPanel({ ai, question, setQuestion, focus, onClose }: { ai: Ai | undefined; question: string; setQuestion: (q: string) => void; focus: () => void; onClose: () => void }) {
  const { org } = useSession();
  const [thread, setThread] = useState<Thread | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setPending(t);
    setError("");
    setQuestion("");
    try {
      const r = await api<Thread>(`/api/v1/orgs/${org.id}/copilot/threads${thread ? `/${thread.id}/messages` : ""}`, { method: "POST", body: { text: t } });
      setThread(r);
    } catch (e) {
      setError(errorMessage(e));
      setQuestion(t);
    } finally {
      setPending(null);
      focus();
    }
  };
  // Enter in the main field asks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement)?.getAttribute("aria-label") === "Ask AI") {
        e.preventDefault();
        void ask(question);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [thread, pending]);

  if (!ai) return <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin text-subtle" /></div>;
  const ready = ai.module && ai.allowed && ai.connected;
  if (!ready)
    return (
      <div className="grid gap-4 px-6 py-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-[16px] bg-gradient-to-br from-[#FF5A5F] to-[#FDBA5A] text-white shadow-lg"><Sparkles className="size-5" /></span>
        <div>
          <p className="text-[15px] font-semibold">Ask your business anything</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
            AI answers need an AI provider connected for this workspace — then ask anything, answered from your records, notes, email, meetings and chat. Search still works without it — press Tab to go back.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {!ai.connected && ai.canConnect && <Link href="/settings/ai" onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-medium text-bg">Connect an AI provider <ArrowRight className="size-3.5" /></Link>}
          {!ai.connected && !ai.canConnect && <p className="text-[12.5px] text-subtle">Ask an owner or admin to connect one.</p>}
        </div>
      </div>
    );
  return (
    <div className="max-h-[min(58vh,520px)] overflow-y-auto overscroll-contain border-t border-border px-4 py-3">
      {!thread && !pending && (
        <div className="grid gap-3 py-2">
          <p className="text-[12.5px] text-muted">Answers come from your own records, with your permissions. Nothing changes unless you confirm it.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {SUGGEST.map((s) => (
              <button key={s} type="button" onClick={() => void ask(s)} className="flex items-center gap-2 rounded-[12px] border border-border bg-surface px-3 py-2.5 text-left text-[13px] transition-colors hover:border-fg/20 hover:bg-surface-2">
                <Sparkles className="size-3.5 shrink-0 text-[#e8743b]" /> {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3">
        {thread?.items.map((it, i) =>
          it.role === "user" ? (
            <p key={i} className="ml-auto max-w-[85%] rounded-[16px] rounded-br-[6px] bg-fg px-3.5 py-2 text-[13.5px] text-bg">{it.text}</p>
          ) : it.role === "tool" ? (
            <p key={i} className="flex items-center gap-1.5 text-[11.5px] text-subtle"><Search className="size-3" /> {it.label}{it.failed ? " — didn't work" : ""}</p>
          ) : (
            <div key={i} className="max-w-[92%] rounded-[16px] rounded-bl-[6px] bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-relaxed"><Rich text={it.text} /></div>
          ),
        )}
        {pending && (
          <>
            <p className="ml-auto max-w-[85%] rounded-[16px] rounded-br-[6px] bg-fg px-3.5 py-2 text-[13.5px] text-bg">{pending}</p>
            <p className="flex items-center gap-2 text-[12.5px] text-muted"><Loader2 className="size-3.5 animate-spin" /> Looking through your records…</p>
          </>
        )}
        {error && <p className="rounded-[12px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        {thread && thread.actions.some((a) => a.status === "proposed") && (
          <p className="rounded-[12px] bg-warning-soft px-3 py-2 text-[12.5px]">It suggested a change — <Link href={`/copilot/${thread.id}`} onClick={onClose} className="font-medium underline">review and confirm it in Copilot</Link>.</p>
        )}
        {thread && (
          <Link href={`/copilot/${thread.id}`} onClick={onClose} className="inline-flex items-center gap-1 justify-self-start text-[12.5px] text-muted hover:text-fg">
            Continue in Copilot <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
      <div ref={endRef} />
    </div>
  );
}

type Answer = { q: string; answer: string; found: boolean; sources: Hit[] };

/** Questions answered from search results across the workspace, with the records used — no Copilot needed. */
function AskSearch({ question, setQuestion, focus, onOpen, copilotHint, onClose }: { question: string; setQuestion: (q: string) => void; focus: () => void; onOpen: (href: string) => void; copilotHint: boolean; onClose: () => void }) {
  const { org } = useSession();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const ask = async (text: string) => {
    const t = text.trim();
    if (t.length < 3 || pending) return;
    setPending(t);
    setError("");
    setQuestion("");
    try {
      const r = await api<Omit<Answer, "q">>(`/api/v1/orgs/${org.id}/search`, { method: "POST", body: { question: t } });
      setAnswers((a) => [...a, { q: t, ...r }]);
    } catch (e) {
      setError(errorMessage(e));
      setQuestion(t);
    } finally {
      setPending(null);
      focus();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement)?.getAttribute("aria-label") === "Ask AI") {
        e.preventDefault();
        void ask(question);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [answers, pending]);
  return (
    <div className="max-h-[min(58vh,520px)] overflow-y-auto overscroll-contain border-t border-border px-4 py-3">
      {!answers.length && !pending && (
        <div className="grid gap-3 py-2">
          <p className="text-[12.5px] text-muted">Ask in plain words. The answer comes from your records, notes, email, meetings, chat and tasks — only what you can open — with links to what it used.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ASK_SUGGEST.map((x) => (
              <button key={x} type="button" onClick={() => void ask(x)} className="flex items-center gap-2 rounded-[12px] border border-border bg-surface px-3 py-2.5 text-left text-[13px] transition-colors hover:border-fg/20 hover:bg-surface-2">
                <Sparkles className="size-3.5 shrink-0 text-[#e8743b]" /> {x}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3">
        {answers.map((a, i) => (
          <div key={i} className="grid gap-2">
            <p className="ml-auto max-w-[85%] rounded-[16px] rounded-br-[6px] bg-fg px-3.5 py-2 text-[13.5px] text-bg">{a.q}</p>
            <div className="max-w-[92%] rounded-[16px] rounded-bl-[6px] bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">{a.answer}</div>
            {a.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {a.sources.map((h) => (
                  <button key={`${h.kind}-${h.id}`} type="button" onClick={() => onOpen(h.link)} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] hover:bg-surface-2 [&_svg]:size-3.5">
                    {KIND[h.kind]?.icon ?? <Search />}<span className="truncate">{h.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {pending && (
          <>
            <p className="ml-auto max-w-[85%] rounded-[16px] rounded-br-[6px] bg-fg px-3.5 py-2 text-[13.5px] text-bg">{pending}</p>
            <p className="flex items-center gap-2 text-[12.5px] text-muted"><Loader2 className="size-3.5 animate-spin" /> Searching your workspace…</p>
          </>
        )}
        {error && <p className="rounded-[12px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        {copilotHint && answers.length > 0 && <p className="text-[12px] text-subtle">For totals and trends (sales this month, who owes most), <Link href="/settings/features" onClick={onClose} className="underline">switch on Copilot</Link> — it can work out numbers from your data.</p>}
      </div>
      <div ref={endRef} />
    </div>
  );
}

const ASK_SUGGEST = ["What did we agree with our biggest customer?", "Which meetings do I have this week?", "Where's the latest invoice for Kiran Textiles?", "What's in my notes about pricing?"];
