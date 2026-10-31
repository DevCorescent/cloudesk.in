// A believable document for previewing templates before there are real ones.
import type { InvoiceSettings } from "./model";
import type { RenderDoc } from "./render";

export function sampleDoc(settings: Pick<InvoiceSettings, "currency" | "taxMode" | "defaultTaxBps" | "terms" | "notes" | "business">, today: string): RenderDoc {
  const india = settings.taxMode === "gst";
  const tax = settings.taxMode === "none" ? 0 : settings.defaultTaxBps || 1800;
  const due = new Date(`${today}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 15);
  return {
    type: "invoice",
    number: "INV/2026-27/0042",
    status: "sent",
    title: "",
    issueDate: today,
    dueDate: due.toISOString().slice(0, 10),
    client: {
      name: "Ananya Iyer",
      company: "Lotus Hospitality Pvt Ltd",
      email: "accounts@lotus.example",
      phone: "+91 98450 12345",
      gstin: india ? "27AAPFU0939F1ZV" : "",
      billing: { line1: "4th Floor, Raheja Towers", line2: "MG Road", city: "Pune", state: india ? "Maharashtra" : "", postalCode: "411001", country: "IN" },
      shipping: null,
    },
    lines: [
      { id: "1", itemId: null, name: "Brand identity design", description: "Logo, colour palette and brand guidelines", hsn: india ? "998391" : "", quantity: 1, unit: "", rate: 4500000, discount: null, taxBps: tax },
      { id: "2", itemId: null, name: "Printed menu cards", description: "350 gsm matte, two-sided", hsn: india ? "4911" : "", quantity: 250, unit: "pcs", rate: 4800, discount: { kind: "percent", value: 10 }, taxBps: india ? 1200 : tax },
      { id: "3", itemId: null, name: "Website maintenance", description: "Monthly plan · October", hsn: india ? "998314" : "", quantity: 1, unit: "month", rate: 1200000, discount: null, taxBps: tax },
    ],
    adjustments: { discount: null, charges: [{ label: "Courier", amount: 25000, taxBps: tax }], roundOff: true },
    taxMode: settings.taxMode,
    inclusive: false,
    placeOfSupply: india ? "Maharashtra" : "",
    reference: "PO-7781",
    notes: settings.notes || "Thank you for your business!",
    terms: settings.terms || "Payment due within 15 days. Late payments may attract interest at 1.5% per month.",
    footer: "",
    customFields: [{ label: "Project", value: "Rebrand 2026" }],
    amountPaid: 0,
    currency: settings.currency,
  };
}
