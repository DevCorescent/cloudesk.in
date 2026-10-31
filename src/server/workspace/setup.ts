// What happens when a module is picked in onboarding (or switched on later):
// each module gets whatever it needs to be useful straight away. The record is
// typed by module id, so a new module can't be added to the catalogue without
// saying what its setup is — even if that's nothing yet.
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModuleId } from "@/lib/workspace/modules";
import { ensureBooks } from "../accounting/access";
import { getSettings as crmSettings } from "../crm/access";
import { getSettings as hrSettings } from "../hr/access";
import { ensureDefaultWarehouse } from "../inventory/items";
import { createBook } from "../invoicing/books";
import { ensureSettings as workSettings } from "../work/access";
import { ensureSettings as salesSettings } from "../sales/access";
import { ensureSettings as mfgSettings } from "../manufacturing/access";
import { ensureSettings as qcSettings } from "../quality/access";
import { ensureSettings as mntSettings } from "../maintenance/access";
import { hasLlm } from "../ai/gateway";
import { ensureSettings as eduSettings } from "../education/access";
import { ensureSettings as clinicSettings } from "../clinic/access";
import { ensureSettings as grcSettings } from "../grc/access";
import { ensureSettings as hdSettings } from "../helpdesk/access";
import { ensureSettings as docSettings } from "../documents/access";
import { ensureSettings as mktSettings } from "../marketing/access";
import { ensureSettings as lgxSettings } from "../logistics/access";

type Ctx = { orgId: string; userId: string; businessName: string };

const noop = async () => "ready";

export const MODULE_SETUP: Record<ModuleId, (c: Ctx) => Promise<string>> = {
  store: noop,
  pos: noop,
  horeca: noop,
  bookings: noop,
  promotions: noop,
  growth: noop,
  automations: noop,
  chatbot: noop,
  data: noop,
  mail: noop,
  calendar: noop,
  chat: async ({ orgId }) => {
    const { ensureDefaults } = await import("../chat/core");
    await ensureDefaults(orgId);
    return "Chat: #general and #announcements";
  },
  "ai-ide": noop,
  crm: async ({ orgId }) => {
    await crmSettings(orgId);
    return "pipeline ready";
  },
  hr: async ({ orgId }) => {
    await hrSettings(orgId);
    return "leave types and payroll rules ready";
  },
  inventory: async ({ orgId }) => {
    await ensureDefaultWarehouse(orgId);
    return "store room ready";
  },
  invoicing: async ({ orgId, userId, businessName }) => {
    // Businesses that sell through a store or venue invoice from that project; everyone else gets books of their own.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.financeBooks).where(eq(schema.financeBooks.orgId, orgId));
    if (n === 0) await createBook(orgId, userId, businessName);
    return "books ready";
  },
  sales: async ({ orgId }) => {
    await salesSettings(orgId);
    return "price list and order numbering ready";
  },
  manufacturing: async ({ orgId }) => {
    await mfgSettings(orgId);
    await ensureDefaultWarehouse(orgId);
    return "work order numbering ready";
  },
  quality: async ({ orgId }) => {
    await qcSettings(orgId);
    return "ready for inspection plans";
  },
  maintenance: async ({ orgId }) => {
    await mntSettings(orgId);
    return "ready for your asset register";
  },
  documents: async ({ orgId }) => {
    await docSettings(orgId);
    return "document library ready";
  },
  marketing: async ({ orgId }) => {
    await mktSettings(orgId);
    return "ready for your first campaign";
  },
  logistics: async ({ orgId }) => {
    await lgxSettings(orgId);
    return "ready for your first shipment";
  },
  bi: async () => "report builder ready",
  portal: async () => "customers and suppliers can sign in with their email",
  helpdesk: async ({ orgId }) => {
    await hdSettings(orgId);
    return "ready for your first ticket";
  },
  grc: async ({ orgId }) => {
    await grcSettings(orgId);
    return "ready — add the Indian statutory calendar from Compliance → Calendar";
  },
  construction: async () => "ready for your first contract and BOQ",
  objects: async () => "ready for your first object",
  clinic: async ({ orgId }) => {
    await clinicSettings(orgId);
    return "ready for your first patient";
  },
  education: async ({ orgId }) => {
    await eduSettings(orgId);
    return "ready for your first class and students";
  },
  copilot: async ({ orgId }) => ((await hasLlm(orgId)) ? "ready to answer questions" : "waiting for an Anthropic API key in Settings → AI providers"),
  work: async ({ orgId }) => {
    await workSettings(orgId);
    return "task board and timesheets ready";
  },
  accounting: async ({ orgId }) => {
    await ensureBooks(orgId);
    return "chart of accounts ready";
  },
};

export async function setupModule(id: ModuleId, c: Ctx) {
  return MODULE_SETUP[id](c);
}
