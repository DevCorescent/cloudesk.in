"use client";

// The partner dashboard on the public page: the real dashboard components,
// filled with an example partner's numbers (labelled as an example — they are
// not anyone's real earnings), drawn at the dashboard's own width and scaled
// to fit. It can't be clicked or focused; the tabs above it switch screens.
import clsx from "clsx";
import { BarChart3, ListChecks, Lock, ReceiptText, Target, Users, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/overlays";
import { Overview } from "./overview";
import { Customers, Leads, LinksAndCoupons, Payouts } from "./sections";
import type { Customer, Dashboard, Lead, Payout } from "./types";
import { inr } from "./types";

// ─── The example partner ───────────────────────────────────────────────────

const MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const EARNED = [3200, 5100, 6900, 8800, 10400, 12900, 14600, 16300, 18950, 21700, 21630, 24810].map((r) => r * 100);
const at = (d: string) => `${d}T06:30:00.000Z`;

const C = (name: string, joined: string, source: Customer["source"], code: string, campaign: string, state: Customer["state"], plan: string, monthly: number, paid: number, rateBps = 3500): Customer => ({ id: name, orgId: name, name, joinedAt: at(joined), source, code, campaign, state, plan, monthly: monthly * 100, paid: paid * 100, earned: Math.round(paid * 100 * (rateBps / 10000)), commissionUntil: at(`${Number(joined.slice(0, 4)) + 2}${joined.slice(4)}`), inWindow: true, rateBps: null });

const CUSTOMERS: Customer[] = [
  C("Sunrise Multispeciality Clinic", "2025-11-14", "lead", "STUDIO25", "", "paying", "Enterprise", 7999, 85600),
  C("Kiran Textiles", "2025-12-02", "link", "STUDIO25", "website-footer", "paying", "Growth", 2999, 32100),
  C("Brew & Bean Café", "2026-01-19", "coupon", "RETAILWEB", "", "paying", "Growth", 2999, 26990),
  C("Patil Hardware & Paints", "2026-02-07", "link", "STUDIO25", "retail-webinar", "paying", "Starter", 999, 7990),
  C("Aarav Interiors", "2026-04-22", "coupon", "STUDIO25", "", "paying", "Growth", 2999, 17994),
  C("GreenLeaf Organics", "2026-06-11", "link", "STUDIO25", "linkedin", "paying", "Growth", 2999, 11996),
  C("Meher Dental Care", "2026-08-30", "lead", "STUDIO25", "", "paying", "Starter", 999, 1998),
  C("Swift Couriers", "2026-10-21", "link", "STUDIO25", "website-footer", "trial", "Growth", 0, 0),
  // The rest of the example's 38 customers.
  ...["Lotus Yoga Studio", "Shree Ganesh Traders", "Bluewave Travels", "Nisha Boutique", "Cornerstone Realty", "Tandoor Tales", "Ashwin Engineering", "Pixel Print Hub", "Vardhan Agro", "Crest Academy", "Urban Kicks", "Haveli Handicrafts", "Mira Skin Clinic", "Fresh Fold Laundry"].map((n, i) =>
    C(n, `2026-0${(i % 9) + 1}-1${i % 9}`, i % 3 ? "link" : "coupon", i % 3 ? "STUDIO25" : "RETAILWEB", i % 3 ? "website-footer" : "", "paying", i % 4 ? "Growth" : "Starter", i % 4 ? 2999 : 999, (i % 4 ? 2999 : 999) * (3 + (i % 5)))),
  ...["Sai Dairy", "Orbit Gym", "Ink & Quill Books", "Prakash Opticals", "Zen Tea House"].map((n, i) => C(n, `2026-10-0${i + 2}`, "link", "STUDIO25", "linkedin", "trial", "Growth", 0, 0)),
  ...["Mahalaxmi Jewellers", "Coastal Seafoods", "Rohit Tutorials", "Aroma Bakers", "Vista Events", "Kumar Electricals", "Bright Smiles Kids", "Nova Furnishings", "Shanti Ayurveda", "Peak Fitness Gear", "Chai Point Express"].map((n, i) => C(n, `2026-0${(i % 9) + 1}-2${i % 8}`, "link", "STUDIO25", "", i % 2 ? "signed_up" : "not_paying", "", 0, 0)),
];

const earned = EARNED.reduce((a, b) => a + b, 0);
const paying = CUSTOMERS.filter((c) => c.state === "paying");
const mrr = paying.reduce((x, c) => x + c.monthly, 0);
const onHold = EARNED.at(-1)!;
const paidOut = 11200000;

export const SAMPLE: Dashboard = {
  partner: { id: "example", type: "organisation", status: "approved", code: "STUDIO25", name: "Example Digital Studio", email: "hello@studio.example", phone: "", country: "IN", city: "Pune", website: "", profile: {}, payoutMethod: "upi", payoutHint: "UPI · stu…@okhdfc", reviewNote: "", createdAt: at("2025-10-20"), approvedAt: at("2025-10-22") },
  terms: { commissionBps: 3000, commissionMonths: 24, discountBps: 1000, discountPayments: 2, maxDiscountBps: 2000, holdDays: 30, minPayout: 100000, tdsBps: 0, cookieDays: 90, leadDays: 90, maxCoupons: 10, summary: "" },
  rate: { base: 3000, bonus: 500, rate: 3500, tier: "Gold", next: "Platinum", toNext: 4, tiers: [{ name: "Partner", minActive: 0, bonusBps: 0 }, { name: "Gold", minActive: 10, bonusBps: 500 }, { name: "Platinum", minActive: 25, bonusBps: 1000 }] },
  totals: { clicks: 1240, clicks30: 186, signups: CUSTOMERS.length, trials: CUSTOMERS.filter((c) => c.state === "trial").length, paying: paying.length, mrr, revenue: Math.round(earned / 0.34 / 100) * 100, earningMrr: Math.round((mrr * 0.35) / 100) * 100, thisMonth: EARNED.at(-1)!, lastMonth: EARNED.at(-2)!, earned, onHold, available: earned - onHold - paidOut, pendingPayout: 0, paidOut, tdsWithheld: 0 },
  series: MONTHS.map((month, i) => ({ month, earned: EARNED[i]!, revenue: Math.round(EARNED[i]! / 0.35 / 100) * 100 })),
  customers: CUSTOMERS,
  campaigns: [
    { campaign: "website-footer", clicks: 560, signups: 14, paying: 9, earned: 6890000 },
    { campaign: "retail-webinar", clicks: 320, signups: 11, paying: 6, earned: 4415000 },
    { campaign: "linkedin", clicks: 250, signups: 8, paying: 4, earned: 2960000 },
    { campaign: "", clicks: 110, signups: 5, paying: 2, earned: 1264000 },
  ],
  coupons: [
    { id: "c1", code: "STUDIO25", label: "", primary: true, discountBps: 1000, discountPayments: 2, commissionBps: null, active: true, maxUses: null, uses: 24, expiresAt: null, createdAt: at("2025-10-22"), discount: "10% off the first 2 payments", signups: 24, paying: 14, earned: 10880000 },
    { id: "c2", code: "RETAILWEB", label: "Retail webinar", primary: false, discountBps: 1500, discountPayments: 2, commissionBps: null, active: true, maxUses: 200, uses: 11, expiresAt: null, createdAt: at("2026-01-10"), discount: "15% off the first 2 payments", signups: 11, paying: 6, earned: 4415000 },
    { id: "c3", code: "STUDIOFRIEND", label: "Client referrals", primary: false, discountBps: 2000, discountPayments: 1, commissionBps: null, active: true, maxUses: null, uses: 3, expiresAt: null, createdAt: at("2026-05-02"), discount: "20% off the first payment", signups: 3, paying: 1, earned: 1234000 },
  ],
};

const LEADS: Lead[] = [
  { id: "l1", company: "Om Sai Pharmacy", contactName: "Dr Sameer Joshi", email: "sameer@omsai.example", phone: "", notes: "Wants billing + stock for 3 branches", value: 799900, status: "demo", orgId: null, expiresAt: at("2026-12-28"), createdAt: at("2026-09-29") },
  { id: "l2", company: "Rangoli Sweets", contactName: "Priya Kale", email: "priya@rangoli.example", phone: "", notes: "POS for 2 counters, online orders", value: 299900, status: "contacted", orgId: null, expiresAt: at("2027-01-14"), createdAt: at("2026-10-16") },
  { id: "l3", company: "Deshmukh Auto Parts", contactName: "Rahul Deshmukh", email: "rahul@dap.example", phone: "", notes: "", value: 299900, status: "registered", orgId: null, expiresAt: at("2027-01-25"), createdAt: at("2026-10-27") },
  { id: "l4", company: "Meher Dental Care", contactName: "Dr Meher Shah", email: "meher@dental.example", phone: "", notes: "Signed up after the demo", value: 99900, status: "won", orgId: "x", expiresAt: at("2026-11-20"), createdAt: at("2026-08-22") },
];

const PAYOUTS: Payout[] = [
  { id: "p1", number: "PO-00418", amount: 3600000, tds: 0, net: 3600000, currency: "INR", status: "paid", method: "UPI · stu…@okhdfc", note: "", adminNote: "", reference: "UTR 6281 0447 1931", createdAt: at("2026-10-03"), decidedAt: at("2026-10-04"), paidAt: at("2026-10-06") },
  { id: "p2", number: "PO-00327", amount: 3100000, tds: 0, net: 3100000, currency: "INR", status: "paid", method: "UPI · stu…@okhdfc", note: "", adminNote: "", reference: "UTR 6252 9910 2287", createdAt: at("2026-08-02"), decidedAt: at("2026-08-03"), paidAt: at("2026-08-05") },
  { id: "p3", number: "PO-00241", amount: 2500000, tds: 0, net: 2500000, currency: "INR", status: "paid", method: "UPI · stu…@okhdfc", note: "", adminNote: "", reference: "UTR 6219 3302 8814", createdAt: at("2026-06-01"), decidedAt: at("2026-06-02"), paidAt: at("2026-06-04") },
  { id: "p4", number: "PO-00163", amount: 2000000, tds: 0, net: 2000000, currency: "INR", status: "paid", method: "UPI · stu…@okhdfc", note: "", adminNote: "", reference: "UTR 6188 7730 5521", createdAt: at("2026-04-02"), decidedAt: at("2026-04-03"), paidAt: at("2026-04-06") },
];

// ─── Drawing it ────────────────────────────────────────────────────────────

/** Draws children at `width` and scales them to the box (on a phone, at `phoneWidth` — the dashboard's own phone layout for the overview). */
function Screen({ children, maxHeight, phoneWidth }: { children: (width: number) => ReactNode; maxHeight: number; phoneWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; zoom: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e!.contentRect.width;
      const width = w < 560 ? phoneWidth : 1280;
      setBox({ width, zoom: Math.min(1, w / width) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phoneWidth]);
  const width = box?.width ?? 1280;
  return (
    <div ref={ref} className="relative w-full overflow-hidden" style={{ maxHeight: box ? Math.min(maxHeight * box.zoom, width < 1280 ? 640 : Infinity) : maxHeight * 0.5 }}>
      <div className={clsx("origin-top-left transition-opacity duration-300", box ? "opacity-100" : "opacity-0")} style={{ width, zoom: box?.zoom ?? 0.5 }}>
        {children(width)}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg to-transparent" aria-hidden />
    </div>
  );
}

export type ScreenId = "overview" | "customers" | "links" | "leads" | "payouts";
const APP_TABS: { value: ScreenId; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "customers", label: "Customers" },
  { value: "leads", label: "Leads" },
  { value: "links", label: "Links & codes" },
  { value: "payouts", label: "Payouts" },
];

/** The dashboard in a browser window. */
export function DashboardFrame({ screen, origin, maxHeight = 980, className }: { screen: ScreenId; origin: string; maxHeight?: number; className?: string }) {
  const host = origin.replace(/^https?:\/\//, "");
  return (
    <div className={clsx("overflow-hidden rounded-[22px] bg-bg text-fg shadow-[0_40px_90px_-40px_rgb(0_0_0/0.45),0_0_0_1px_rgb(0_0_0/0.06)]", className)}>
      <div className="flex items-center gap-2 border-b border-fg/[0.06] bg-fg/[0.025] px-4 py-2.5" aria-hidden>
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto inline-flex max-w-[60%] items-center gap-1.5 truncate rounded-full bg-fg/[0.05] px-3 py-1 text-[11.5px] text-fg/55"><Lock className="size-3" />{host}/partner</span>
      </div>
      {/* Not interactive: it's a picture of the dashboard, made from the dashboard itself. */}
      <div inert aria-hidden data-no-fit className="pointer-events-none select-none">
        <Screen maxHeight={maxHeight} phoneWidth={screen === "overview" ? 420 : 820}>
          {(width) => (
            <div className={clsx("grid gap-5 bg-bg", width < 600 ? "p-4" : "p-7")}>
              <Tabs value={screen} onChange={() => {}} tabs={APP_TABS} />
              {screen === "overview" && <Overview d={SAMPLE} person="Asha Kulkarni" go={() => {}} origin={origin} hello="Good morning" />}
              {screen === "customers" && <Customers d={SAMPLE} />}
              {screen === "links" && <LinksAndCoupons d={SAMPLE} origin={origin} />}
              {screen === "leads" && <Leads d={SAMPLE} sample={LEADS} />}
              {screen === "payouts" && <Payouts d={SAMPLE} sample={PAYOUTS} />}
            </div>
          )}
        </Screen>
      </div>
    </div>
  );
}

const TOUR: { id: ScreenId; label: string; icon: ReactNode; title: string; points: string[] }[] = [
  { id: "overview", label: "Overview", icon: <BarChart3 className="size-4" />, title: "Your whole business with us, at a glance", points: ["What you can withdraw today, and what's on hold", "This month against last month", "Every paying customer and what they bring each month", "The path from a click to a paying customer, and your next tier"] },
  { id: "customers", label: "Customers", icon: <Users className="size-4" />, title: "Every customer you brought", points: ["How they found you — your link, a code or a lead you registered", "Their plan, what they've paid and what you've earned", "Who's still on trial, so you know when to follow up"] },
  { id: "links", label: "Links & codes", icon: <ListChecks className="size-4" />, title: "Links and codes for every campaign", points: ["A tracked link for each post, video, webinar or ad", "Visits, sign-ups and paying customers per campaign", "Your own coupon codes with a discount you choose"] },
  { id: "leads", label: "Leads", icon: <Target className="size-4" />, title: "Deals you're working, protected", points: ["Register a business before it signs up", "It stays yours for 90 days — no code needed when they join", "Move it from contacted to demo to won"] },
  { id: "payouts", label: "Payouts", icon: <Wallet className="size-4" />, title: "Withdraw when you want", points: ["Ask for a payout from ₹1,000", "UPI, bank transfer or international wire", "Every payout with its transfer reference"] },
];

/** The tour on the public page: pick a screen, see it, read what it does. */
export function DashboardTour({ origin }: { origin: string }) {
  const [cur, setCur] = useState<ScreenId>("overview");
  const t = TOUR.find((x) => x.id === cur)!;
  return (
    <div className="grid gap-6">
      <div role="tablist" aria-label="Dashboard screens" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {TOUR.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === cur} type="button" onClick={() => setCur(x.id)} className={clsx("inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[14px] font-medium transition-colors", x.id === cur ? "bg-fg text-bg" : "bg-white/70 text-fg/65 ring-1 ring-fg/[0.06] hover:text-fg")}>
            {x.icon}{x.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div role="tabpanel" className="grid gap-4 lg:sticky lg:top-36">
          <h3 data-no-fit className="text-[24px] leading-tight font-semibold tracking-tight">{t.title}</h3>
          <ul className="grid gap-3">
            {t.points.map((p) => <li key={p} className="flex gap-2.5 text-[15px] leading-snug text-fg/70"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--p-lavender-ink)]" />{p}</li>)}
          </ul>
          <p className="flex items-center gap-1.5 text-[12.5px] text-fg/45"><ReceiptText className="size-3.5" />Example partner with sample numbers — your dashboard shows your own.</p>
        </div>
        <DashboardFrame screen={cur} origin={origin} />
      </div>
    </div>
  );
}

/** The hero's picture: the overview, with a few numbers floating over it. */
export function HeroDashboard({ origin, dark }: { origin: string; dark?: boolean }) {
  const t = SAMPLE.totals;
  return (
    <div className="relative">
      <DashboardFrame screen="overview" origin={origin} maxHeight={760} />
      <div className="absolute -bottom-5 -left-3 hidden rounded-[18px] bg-white px-4 py-3 text-fg shadow-[0_20px_40px_-20px_rgb(0_0_0/0.35)] ring-1 ring-fg/[0.05] sm:block" aria-hidden>
        <p className="text-[11.5px] text-fg/50">Earned this month</p>
        <p className="text-[20px] font-semibold tabular-nums">{inr(t.thisMonth)} <span className="text-[12px] font-medium text-[var(--p-mint-ink)]">+{Math.round(((t.thisMonth - t.lastMonth) / t.lastMonth) * 100)}%</span></p>
      </div>
      <div className="absolute -top-4 -right-3 hidden rounded-[18px] bg-white px-4 py-3 text-fg shadow-[0_20px_40px_-20px_rgb(0_0_0/0.35)] ring-1 ring-fg/[0.05] sm:block" aria-hidden>
        <p className="text-[11.5px] text-fg/50">Paying customers</p>
        <p className="text-[20px] font-semibold tabular-nums">{t.paying} <span className="text-[12px] font-medium text-fg/50">· Gold tier</span></p>
      </div>
      <p className={clsx("mt-8 text-center text-[12px] sm:mt-9", dark ? "text-white/45" : "text-fg/45")}>Example dashboard with sample numbers</p>
    </div>
  );
}
