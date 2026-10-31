// What the partner API sends (dates arrive as ISO strings).
export const MINE_KEY = ["partner", "me"] as const;
import type { PartnerType, Tier } from "@/lib/partners/program";

export type PartnerProfile = {
  id: string;
  type: PartnerType;
  status: "pending" | "approved" | "rejected" | "suspended";
  code: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  website: string;
  profile: Record<string, string>;
  payoutMethod: "upi" | "bank" | "wire" | null;
  payoutHint: string;
  reviewNote: string;
  createdAt: string;
  approvedAt: string | null;
};

export type Terms = { commissionBps: number; commissionMonths: number; discountBps: number; discountPayments: number; maxDiscountBps: number; holdDays: number; minPayout: number; tdsBps: number; cookieDays: number; leadDays: number; maxCoupons: number; summary: string };

export type Customer = { id: string; orgId: string; name: string; joinedAt: string; source: "link" | "coupon" | "lead" | "manual"; code: string; campaign: string; state: "signed_up" | "trial" | "paying" | "complimentary" | "not_paying" | "reversed"; plan: string; monthly: number; paid: number; earned: number; commissionUntil: string | null; inWindow: boolean; rateBps: number | null };

export type Coupon = { id: string; code: string; label: string; primary: boolean; discountBps: number; discountPayments: number; commissionBps: number | null; active: boolean; maxUses: number | null; uses: number; expiresAt: string | null; createdAt: string; discount: string; signups: number; paying: number; earned: number };

export type Dashboard = {
  partner: PartnerProfile;
  terms: Terms;
  rate: { base: number; bonus: number; rate: number; tier: string; next: string | null; toNext: number; tiers: Tier[] };
  totals: { clicks: number; clicks30: number; signups: number; trials: number; paying: number; mrr: number; revenue: number; earningMrr: number; thisMonth: number; lastMonth: number; earned: number; onHold: number; available: number; pendingPayout: number; paidOut: number; tdsWithheld: number };
  series: { month: string; earned: number; revenue: number }[];
  customers: Customer[];
  campaigns: { campaign: string; clicks: number; signups: number; paying: number; earned: number }[];
  coupons: Coupon[];
};

/** GET /api/v1/partner: nothing yet, an application under review, or the whole dashboard. */
export type Mine = { partner: null } | { partner: PartnerProfile; terms: Terms; totals?: undefined } | Dashboard;

export type Commission = { id: string; kind: "invoice" | "adjustment"; customer: string; invoice: string | null; basis: number; rateBps: number; amount: number; currency: string; status: "on_hold" | "available" | "void"; availableAt: string; note: string; createdAt: string };
export type Payout = { id: string; number: string; amount: number; tds: number; net: number; currency: string; status: "requested" | "approved" | "paid" | "rejected" | "cancelled"; method: string; note: string; adminNote: string; reference: string; createdAt: string; decidedAt: string | null; paidAt: string | null };
export type Lead = { id: string; company: string; contactName: string; email: string; phone: string; notes: string; value: number; status: "registered" | "contacted" | "demo" | "signed_up" | "won" | "lost"; orgId: string | null; expiresAt: string; createdAt: string };

/** Rupees from paise: whole rupees as they are, otherwise with the paise (₹2,699.10). */
export const inr = (paise: number, opts: { exact?: boolean } = {}) => {
  const whole = !opts.exact && Math.abs(paise) % 100 === 0;
  return `${paise < 0 ? "−" : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

export const STATE_LABEL: Record<Customer["state"], { label: string; tone: "success" | "accent" | "neutral" | "warning" | "danger" }> = {
  paying: { label: "Paying", tone: "success" },
  trial: { label: "On trial", tone: "accent" },
  signed_up: { label: "Signed up", tone: "neutral" },
  complimentary: { label: "Complimentary", tone: "neutral" },
  not_paying: { label: "Not paying", tone: "warning" },
  reversed: { label: "Reversed", tone: "danger" },
};
export const SOURCE_LABEL: Record<Customer["source"], string> = { link: "Link", coupon: "Coupon", lead: "Registered lead", manual: "Added by Cloudesk" };
export const LEAD_LABEL: Record<Lead["status"], string> = { registered: "Registered", contacted: "Contacted", demo: "Demo done", signed_up: "Signed up", won: "Won — paying", lost: "Lost" };
export const PAYOUT_TONE: Record<Payout["status"], "success" | "accent" | "neutral" | "warning" | "danger"> = { requested: "accent", approved: "warning", paid: "success", rejected: "danger", cancelled: "neutral" };
