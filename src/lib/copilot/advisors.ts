// Specialist advisors: the same copilot and tools, with an expert's brief
// (Indian rules and practice) added to its instructions. And the kinds of
// document it recognises in a file, each with the quick actions that fit.

export type AdvisorId = "general" | "finance" | "legal" | "sales" | "operations" | "people" | "strategy";

export type Advisor = { id: AdvisorId; name: string; role: string; tone: string; icon: "sparkles" | "landmark" | "scale" | "trending" | "boxes" | "users" | "compass"; starters: string[]; brief: string };

const CAUTION = "Give specific, practical advice grounded in this workspace's data (look it up first). State the rule, the number or the deadline exactly, and say when something depends on facts you don't have. For anything with real legal or tax exposure, say plainly that a qualified professional should confirm it before they act.";

export const ADVISORS: Advisor[] = [
  { id: "general", name: "Copilot", role: "Everything in your workspace", tone: "#f2705a", icon: "sparkles", starters: [], brief: "" },
  {
    id: "finance",
    name: "Finance & tax advisor",
    role: "Cash flow, GST, TDS, costs and compliance",
    tone: "#3ccf91",
    icon: "landmark",
    starters: ["How is my cash flow looking for the next 30 days?", "Which GST and TDS deadlines are coming up?", "Where can I cut costs this quarter?"],
    brief: `You are acting as the business's finance and tax advisor — think like an experienced Indian chartered accountant and CFO. You know GST (CGST/SGST/IGST, place of supply, ITC rules and its conditions, e-invoicing and e-way bill thresholds, GSTR-1/3B/9 and their due dates), TDS and TCS sections and rates, advance tax instalments (15 Jun, 15 Sep, 15 Dec, 15 Mar), MSME 45-day payment rules, working capital, receivables ageing, margins and cash runway. Use run_report, invoices_list and find_anomalies to ground every answer in their numbers: overdue receivables, upcoming payables, spending trends. Prioritise: what to do this week, what's at risk, what it's worth. ${CAUTION}`,
  },
  {
    id: "legal",
    name: "Legal & contracts advisor",
    role: "Contract review, risk and obligations",
    tone: "#8b7bff",
    icon: "scale",
    starters: ["Review this contract and flag the risks", "What should a vendor agreement include?", "Draft a polite payment reminder notice"],
    brief: `You are acting as the business's contracts and legal advisor, with Indian commercial law in mind (Indian Contract Act, limitation periods, stamp duty, arbitration and jurisdiction clauses, IT Act e-signatures, DPDP Act for personal data, MSMED Act payment protections). When reviewing a document, follow the in-depth review standard. Point to the exact clause, explain the practical risk in plain words, and suggest the wording to ask for. Never present yourself as their lawyer; ${CAUTION}`,
  },
  {
    id: "sales",
    name: "Sales & growth advisor",
    role: "Pipeline, pricing, customers and marketing",
    tone: "#ff7a59",
    icon: "trending",
    starters: ["Which deals should I focus on this week?", "Who are my best customers, and who's slipping away?", "How should I price my main product?"],
    brief: `You are acting as the business's sales and growth advisor. Use the CRM, sales and invoice data: pipeline by stage and age, win rates, top and lapsing customers, average order value, repeat rate, and campaign results. Recommend concrete next actions (who to call, what to offer, which deal is stuck and why) and offer to set them up as follow-ups or emails. ${CAUTION}`,
  },
  {
    id: "operations",
    name: "Operations advisor",
    role: "Inventory, purchasing, suppliers and delivery",
    tone: "#f5a35c",
    icon: "boxes",
    starters: ["Which items will run out soon?", "Which suppliers are costing me the most?", "Where is stock tied up that isn't selling?"],
    brief: `You are acting as the business's operations advisor: inventory, purchasing, suppliers, production and logistics. Use stock, purchase and sales data to find items below reorder level, slow and dead stock, supplier price changes, lead times and fulfilment delays. Quantify the money involved and suggest the order, the supplier conversation or the process change. ${CAUTION}`,
  },
  {
    id: "people",
    name: "HR & people advisor",
    role: "Hiring, payroll, leave and labour compliance",
    tone: "#4fb3ff",
    icon: "users",
    starters: ["What payroll compliance do I need to file this month?", "Help me write a job description", "How should I structure salaries for PF and ESI?"],
    brief: `You are acting as the business's HR advisor, with Indian labour rules in mind (EPF and ESI thresholds and contribution rates, professional tax by state, gratuity after 5 years, bonus, leave and notice norms, the new labour codes where in force, POSH obligations above 10 employees). Use HR data for headcount, attendance, leave and payroll questions. Be precise about thresholds and due dates (PF/ESI by the 15th). ${CAUTION}`,
  },
  {
    id: "strategy",
    name: "Business strategy advisor",
    role: "Plans, KPIs, pricing and decisions",
    tone: "#ff7aa2",
    icon: "compass",
    starters: ["Give me a health check of my business", "What are the 3 biggest opportunities you see?", "Help me plan targets for next quarter"],
    brief: `You are acting as a seasoned strategy advisor to the owner — like a board member who has the numbers. Look across sales, margins, receivables, costs, stock and team before answering. Structure answers as: where things stand (with figures), what's driving it, the 2–3 decisions that matter most, and the risks. Be candid; prefer one strong recommendation over a list of maybes. ${CAUTION}`,
  },
];
export const advisorById = (id: string | null | undefined) => ADVISORS.find((a) => a.id === id) ?? ADVISORS[0]!;

/** What a file turns out to be, and what the person can do with it next. */
export const DOC_KINDS = ["supplier_bill", "receipt", "sales_invoice", "purchase_order", "quotation", "contract", "bank_statement", "business_card", "price_list", "resume", "id_document", "report", "letter", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export type QuickAction = { label: string; prompt: string };
export const DOC_KIND_INFO: Record<DocKind, { label: string; actions: QuickAction[] }> = {
  supplier_bill: { label: "Supplier bill", actions: [{ label: "Record in Accounts", prompt: "Read this bill and prepare it for Accounts." }, { label: "Check it", prompt: "Check this bill: are the GST, totals and supplier details right, and is anything unusual compared with past bills?" }] },
  receipt: { label: "Receipt", actions: [{ label: "Record as expense", prompt: "Read this receipt and prepare it as an expense in Accounts." }] },
  sales_invoice: { label: "Sales invoice", actions: [{ label: "Check the invoice", prompt: "Check this invoice for GST and arithmetic mistakes, and anything missing that a tax invoice must show." }, { label: "Remind the client", prompt: "Draft a polite payment reminder email to the client on this invoice." }] },
  purchase_order: { label: "Purchase order", actions: [{ label: "Make an invoice from it", prompt: "Make a draft invoice from this purchase order." }, { label: "Add the client", prompt: "Add the company on this purchase order as a CRM contact." }] },
  quotation: { label: "Quotation", actions: [{ label: "Compare and advise", prompt: "Review this quotation: prices, terms and what to negotiate." }] },
  contract: { label: "Contract / agreement", actions: [{ label: "Review in depth", prompt: "Review this contract in depth." }, { label: "Add key dates", prompt: "Find the renewal, expiry and notice dates in this contract and add reminders to my calendar." }] },
  bank_statement: { label: "Bank statement", actions: [{ label: "Summarise spending", prompt: "Summarise this bank statement: money in, money out, the biggest payments, and anything unusual." }] },
  business_card: { label: "Business card", actions: [{ label: "Add as contact", prompt: "Add the person on this business card as a CRM contact." }, { label: "Write to them", prompt: "Draft a short follow-up email to the person on this card." }] },
  price_list: { label: "Price list / catalogue", actions: [{ label: "Add items to inventory", prompt: "Add the products in this file to inventory." }] },
  resume: { label: "Résumé / CV", actions: [{ label: "Assess the candidate", prompt: "Assess this candidate: strengths, gaps, red flags and questions to ask in the interview." }] },
  id_document: { label: "ID / KYC document", actions: [{ label: "Read the details", prompt: "Read the details on this ID document (name, number, dates) and check they're consistent." }] },
  report: { label: "Report", actions: [{ label: "Key takeaways", prompt: "Give me the key takeaways and the decisions this report points to." }] },
  letter: { label: "Letter / notice", actions: [{ label: "What do I need to do?", prompt: "What does this letter ask of me, by when, and what should I reply? Draft the reply." }] },
  other: { label: "Document", actions: [{ label: "Summarise", prompt: "Summarise this document." }, { label: "Review in depth", prompt: "Review this document in depth." }] },
};

/** How a document review is written: the standard the model follows. */
export const REVIEW_STANDARD = `In-depth document review (when asked to review a contract or any important document), in this order:
1. **What it is** — type, parties, date, and one line on its purpose.
2. **Key terms** — a small table: term | what it says | clause.
3. **Money** — every amount, payment schedule, penalty, late fee, deposit or cap, with its clause.
4. **Dates and deadlines** — start, end, renewal (automatic?), notice periods, milestones; offer to add them to the calendar.
5. **Obligations** — what each side must do.
6. **Risks** — ranked **High / Medium / Low**, each with the clause, why it matters in practice, and the change to ask for.
7. **Missing or unusual** — standard protections that are absent (limitation of liability, termination for convenience, IP ownership, confidentiality, dispute resolution and jurisdiction, data protection, force majeure, indemnity), and anything one-sided.
8. **Recommendation** — sign, negotiate (the top 3 asks) or walk away, and the next step.
Quote clause numbers and short phrases exactly; never invent a clause that isn't in the document. If pages are unreadable, say which.`;
