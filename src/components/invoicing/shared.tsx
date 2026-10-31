"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { defaultTemplateConfig, templateConfigSchema, STATUS_LABEL, type DisplayStatus, type DocType, type InvoiceSettings, type Party, type TemplateConfig } from "@/lib/invoicing/model";
import { renderDocument } from "@/lib/invoicing/render";
import type { PrebuiltTemplate } from "@/lib/invoicing/templates";
import type { TaxRow } from "@/lib/invoicing/totals";
import { formatMoney } from "@/lib/store/money";

export type Template = { id: string; name: string; config: TemplateConfig; source: string; basedOn: string; hasReference: boolean; referenceMime: string | null; referenceName: string | null; extracted: unknown; updatedAt: string };
export type Boot = { settings: InvoiceSettings & { saved: boolean }; templates: Template[]; prebuilt: PrebuiltTemplate[]; mailConfigured: boolean; ai: boolean; canVoid: boolean; today: string; scope: { kind: "project" | "book"; id: string; name: string; canDelete: boolean } };
export type Doc = {
  id: string;
  type: DocType;
  number: string;
  status: string;
  displayStatus: DisplayStatus;
  clientId: string | null;
  client: Party;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  lines: import("@/lib/invoicing/model").Line[];
  adjustments: import("@/lib/invoicing/model").Adjustments;
  taxMode: import("@/lib/invoicing/model").TaxMode;
  inclusive: boolean;
  placeOfSupply: string;
  title: string;
  reference: string;
  notes: string;
  terms: string;
  footer: string;
  customFields: { label: string; value: string }[];
  templateId: string | null;
  recurring: import("@/lib/invoicing/model").Recurring | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  taxes: TaxRow[];
  shareToken: string;
  shareUrl: string;
  sentAt: string | null;
  viewedAt: string | null;
  viewCount: number;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  sourceId: string | null;
  /** Rupees per unit used in Accounts, for a foreign-currency document; null uses the workspace rate. */
  fxRate: string | null;
  createdAt: string;
};
export type DocDetail = {
  document: Doc;
  payments: { id: string; amount: number; method: string; paidOn: string; reference: string; note: string; inrAmount: number | null }[];
  events: { id: string; kind: string; message: string; createdAt: string }[];
  source: { id: string; type: DocType; number: string } | null;
  children: { id: string; type: DocType; number: string; status: string }[];
};
export type Client = Party & { id: string; notes: string; invoiced: number; balance: number; invoices: number };
export type Item = { id: string; name: string; description: string; hsn: string; unit: string; rate: number; taxBps: number; invItemId?: string | null };

/** projectId is the owner of the books: a project's id, or a standalone book's id. */
type Ctx = { projectId: string; base: string; apiBase: string; boot: Boot };
const InvCtx = createContext<Ctx | null>(null);
export const InvProvider = ({ value, children }: { value: Ctx; children: ReactNode }) => <InvCtx.Provider value={value}>{children}</InvCtx.Provider>;
export function useInv() {
  const v = useContext(InvCtx);
  if (!v) throw new Error("useInv outside InvProvider");
  return v;
}

/** Endpoint under the current books' API root (a project's or a standalone book's). */
export const invApi = (apiBase: string, path = "") => `${apiBase}${path ? `/${path}` : ""}`;
export const projectApiBase = (projectId: string) => `/api/v1/projects/${projectId}/invoicing`;
export const bookApiBase = (bookId: string) => `/api/v1/finance/books/${bookId}`;
export function useInvQuery<T>(path: string, opts: { enabled?: boolean } = {}) {
  const { projectId, apiBase } = useInv();
  return useQuery({ queryKey: ["invoicing", projectId, path], queryFn: () => api<T>(invApi(apiBase, path)), enabled: opts.enabled });
}

/** URL segment for each document type. */
export const TYPE_PATH: Record<DocType, string> = { invoice: "invoices", quote: "quotes", proforma: "proforma", credit_note: "credit-notes" };
export const PATH_TYPE: Record<string, DocType> = { invoices: "invoice", quotes: "quote", proforma: "proforma", "credit-notes": "credit_note" };

const TONE: Record<DisplayStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  sent: "accent",
  viewed: "accent",
  accepted: "success",
  declined: "danger",
  converted: "success",
  partial: "warning",
  paid: "success",
  void: "neutral",
  overdue: "danger",
  expired: "warning",
};
export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** The template a document prints with: its own, else the default, else the first. */
export function templateOf(boot: Boot, templateId: string | null) {
  const t = boot.templates.find((x) => x.id === templateId) ?? boot.templates.find((x) => x.id === boot.settings.defaultTemplateId) ?? boot.templates[0];
  return t ? templateConfigSchema.parse(t.config) : defaultTemplateConfig();
}

/** The printed document, rendered in the browser with the same code the server uses. */
export function docHtml(d: Doc, boot: Boot, zoom = 0.75) {
  return renderDocument({
    doc: { type: d.type, number: d.number, status: d.displayStatus, title: d.title, issueDate: d.issueDate.slice(0, 10), dueDate: d.dueDate?.slice(0, 10) ?? null, client: d.client, lines: d.lines, adjustments: d.adjustments, taxMode: d.taxMode, inclusive: d.inclusive, placeOfSupply: d.placeOfSupply, reference: d.reference, notes: d.notes, terms: d.terms, footer: d.footer, customFields: d.customFields, amountPaid: d.amountPaid, currency: d.currency },
    settings: boot.settings,
    template: templateOf(boot, d.templateId),
    zoom,
  }).html;
}

const PAPER_PX: Record<string, number> = { A4: 794, Letter: 816, A5: 559 };
/** Zoom that fits the paper (plus the page's 24px gutter) into an element's width. */
export function useFitZoom(paper: string = "A4") {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setZoom(Math.max(0.15, Math.min(1.2, (e.contentRect.width - 32) / (PAPER_PX[paper] ?? 794)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, paper]);
  return [setEl, Math.round(zoom * 100) / 100] as const;
}

export const money = (n: number | null | undefined, currency: string) => (n === null || n === undefined ? "—" : formatMoney(n, currency));
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const newLineId = () => Math.random().toString(36).slice(2, 10);
