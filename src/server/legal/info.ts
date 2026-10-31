// What the public legal pages say about the company behind the service, read
// from Admin → Settings (General and Legal) and the live pricing rules. Values
// that aren't set come back empty so the pages can word around them — nothing
// here is ever invented.
import { settings } from "@/server/platform/settings";

/** When the text of the policies last changed (bump when the wording changes). */
export const POLICIES_UPDATED = "2026-10-27";

export type LegalInfo = {
  product: string;
  /** The registered company name, if set. */
  company: string;
  /** How to name the operator in running text: the company, or a neutral description. */
  operator: string;
  address: string;
  cin: string;
  gstin: string;
  /** Legal contact: Legal → Contact email, else General → Support email. */
  email: string;
  supportEmail: string;
  phone: string;
  grievance: { name: string; email: string; phone: string };
  dpo: { name: string; email: string };
  euRepresentative: string;
  jurisdiction: string;
  effectiveIso: string;
  updatedIso: string;
  effective: string;
  updated: string;
  statusPageUrl: string;
  pricing: { trialDays: number; graceDays: number; renewalNoticeDays: number; taxLabel: string; taxPct: string; currency: string; yearlyMonths: number };
};

const long = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function legalInfo(): Promise<LegalInfo> {
  const s = await settings();
  const { legal: l, general: g, pricing: p } = s;
  const product = g.productName || "Cloudesk";
  const email = l.contactEmail || g.supportEmail;
  const effectiveIso = l.effectiveDate || POLICIES_UPDATED;
  return {
    product,
    company: l.companyName,
    operator: l.companyName || `the company that operates ${product}`,
    address: l.registeredAddress,
    cin: l.cin,
    gstin: l.gstin,
    email,
    supportEmail: g.supportEmail,
    phone: l.contactPhone,
    grievance: { name: l.grievanceName, email: l.grievanceEmail || email, phone: l.grievancePhone },
    dpo: { name: l.dpoName, email: l.dpoEmail || email },
    euRepresentative: l.euRepresentative,
    jurisdiction: l.jurisdiction,
    effectiveIso,
    updatedIso: POLICIES_UPDATED,
    effective: long(effectiveIso),
    updated: long(POLICIES_UPDATED),
    statusPageUrl: g.statusPageUrl,
    pricing: { trialDays: p.trialDays, graceDays: p.graceDays, renewalNoticeDays: p.renewalNoticeDays, taxLabel: p.taxLabel, taxPct: `${(p.taxBps / 100).toFixed(p.taxBps % 100 ? 2 : 0)}%`, currency: p.currency, yearlyMonths: p.yearlyMonths },
  };
}

