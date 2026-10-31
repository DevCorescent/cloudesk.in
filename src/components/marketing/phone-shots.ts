// Real phone captures (402×874 at 3×) of features, shown instead of a shrunken
// desktop screenshot when the site is viewed on a phone. Captured by the
// scripts in scripts/marketing/ (capture-phones, capture-workspace and the
// module scripts' phone passes).
export type PhoneShot = { src: string; alt: string };

const ph = (slug: string, alt: string): PhoneShot => ({ src: `/marketing/phones/${slug}.jpg`, alt });
const ws = (name: string, alt: string): PhoneShot => ({ src: `/marketing/workspace/${name}.jpg`, alt });

export const PHONE_SHOTS: Record<string, PhoneShot> = {
  launch: ph("launch", "The five-minute launch on a phone"),
  "website-builder": ph("website-builder", "A website made with the builder, on a phone"),
  "online-store": ph("online-store", "A storefront on a phone"),
  "point-of-sale": ph("point-of-sale", "The till on a phone"),
  horeca: ph("horeca", "Ordering from the table on a phone"),
  invoicing: ph("invoicing", "Invoicing and money owed, on a phone"),
  bookings: ph("bookings", "Choosing a time to book, on a phone"),
  promotions: ph("promotions", "A pop-up offer on a phone"),
  growth: ph("growth", "Growth tests on a phone"),
  domains: ph("domains", "Connecting a domain on a phone"),
  "ai-ide": ph("ai-ide", "The AI code editor on a phone"),
  automations: ph("automations", "Automations on a phone"),
  chatbot: ph("chatbot", "The chatbot on a phone"),
  data: ph("data", "Data tables on a phone"),
  collaboration: ph("collaboration", "Reviewing a site with the team, on a phone"),
  crm: ph("crm", "CRM on a phone"),
  accounting: ph("accounting", "Accounts on a phone"),
  inventory: ph("inventory", "Inventory on a phone"),
  sales: ph("sales", "Sales orders on a phone"),
  manufacturing: ph("manufacturing", "Manufacturing on a phone"),
  quality: ph("quality", "Quality checks on a phone"),
  maintenance: ph("maintenance", "Maintenance on a phone"),
  documents: ph("documents", "Documents and contracts on a phone"),
  marketing: ph("marketing", "Marketing campaigns on a phone"),
  logistics: ph("logistics", "Logistics and fleet on a phone"),
  reports: ph("reports", "Reports on a phone"),
  portals: ph("portals", "Customer and supplier portals on a phone"),
  helpdesk: ph("helpdesk", "The helpdesk on a phone"),
  clinic: ph("clinic", "The clinic on a phone"),
  construction: ph("construction", "Construction projects on a phone"),
  "custom-objects": ph("custom-objects", "Your own records on a phone"),
  education: ph("education", "The school on a phone"),
  compliance: ph("compliance", "Compliance on a phone"),
  projects: ph("projects", "Projects and timesheets on a phone"),
  hrms: ph("hrms", "HR and payroll on a phone"),
  "my-work": ws("m-my-work", "My work on a phone: tasks, follow-ups and reminders"),
  mail: ws("m-mail", "Mail on a phone"),
  calendar: ws("m-calendar", "The calendar agenda on a phone"),
  chat: ws("m-chat", "A Chat channel on a phone"),
  notes: ph("notes", "A meeting note with a table, on a phone"),
  copilot: ws("m-copilot", "Ask Copilot on a phone"),
};
