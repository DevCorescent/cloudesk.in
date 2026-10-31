// Shipping zone matching and rate calculation. Pure.
export type Address = { name: string; line1: string; line2?: string; city: string; region: string; postalCode: string; country: string; phone?: string };

export type Zone = { id: string; name: string; countries: string[]; regions: string[]; postalPrefixes: string[]; sort: number };
export type Rate = {
  id: string;
  zoneId: string;
  name: string;
  kind: "flat" | "free_over" | "weight" | "pickup";
  amount: number;
  freeOver: number | null;
  weightTiers: { upToGrams: number; amount: number }[];
  eta: string;
  codAllowed: boolean;
  sort: number;
};

const norm = (s: string) => s.trim().toLowerCase();

/** The most specific zone wins: postal prefix > region > country > worldwide (“*”). */
export function matchZone(zones: Zone[], addr: Pick<Address, "country" | "region" | "postalCode">): Zone | null {
  const score = (z: Zone) => {
    const countryOk = z.countries.includes("*") || z.countries.map((c) => c.toUpperCase()).includes(addr.country.toUpperCase());
    if (!countryOk) return -1;
    if (z.regions.length && !z.regions.map(norm).includes(norm(addr.region))) return -1;
    if (z.postalPrefixes.length && !z.postalPrefixes.some((p) => addr.postalCode.replace(/\s/g, "").startsWith(p.replace(/\s/g, "")))) return -1;
    return (z.postalPrefixes.length ? 100 : 0) + (z.regions.length ? 10 : 0) + (z.countries.includes("*") ? 0 : 1);
  };
  const ranked = zones.map((z) => ({ z, s: score(z) })).filter((x) => x.s >= 0);
  ranked.sort((a, b) => b.s - a.s || a.z.sort - b.z.sort);
  return ranked[0]?.z ?? null;
}

/** Price for a rate given the cart subtotal and weight; null when the rate does not apply. */
export function rateAmount(rate: Rate, subtotal: number, weightGrams: number): number | null {
  switch (rate.kind) {
    case "pickup":
      return 0;
    case "flat":
      return rate.amount;
    case "free_over":
      return rate.freeOver !== null && subtotal >= rate.freeOver ? 0 : rate.amount;
    case "weight": {
      const tiers = [...rate.weightTiers].sort((a, b) => a.upToGrams - b.upToGrams);
      const tier = tiers.find((t) => weightGrams <= t.upToGrams);
      return tier ? tier.amount : null;
    }
  }
}

export function availableRates(zones: Zone[], rates: Rate[], addr: Pick<Address, "country" | "region" | "postalCode">, subtotal: number, weightGrams: number) {
  const zone = matchZone(zones, addr);
  if (!zone) return { zone: null, rates: [] as (Rate & { price: number })[] };
  const list = rates
    .filter((r) => r.zoneId === zone.id)
    .map((r) => ({ ...r, price: rateAmount(r, subtotal, weightGrams) }))
    .filter((r): r is Rate & { price: number } => r.price !== null)
    .sort((a, b) => a.sort - b.sort || a.price - b.price);
  return { zone, rates: list };
}

export const COUNTRIES: [string, string][] = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["AE", "United Arab Emirates"], ["SG", "Singapore"], ["AU", "Australia"], ["CA", "Canada"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["JP", "Japan"], ["NZ", "New Zealand"], ["SA", "Saudi Arabia"], ["MY", "Malaysia"], ["BD", "Bangladesh"], ["LK", "Sri Lanka"], ["NP", "Nepal"],
];

export const INDIAN_STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"];

/** Tracking links for common carriers (manual fulfilment). */
export const CARRIERS: { id: string; name: string; url: (n: string) => string }[] = [
  { id: "delhivery", name: "Delhivery", url: (n) => `https://www.delhivery.com/track-v2/package/${encodeURIComponent(n)}` },
  { id: "bluedart", name: "Blue Dart", url: (n) => `https://www.bluedart.com/web/guest/trackdartresultthirdparty?trackFor=0&trackNo=${encodeURIComponent(n)}` },
  { id: "dtdc", name: "DTDC", url: (n) => `https://www.dtdc.in/trace.asp?strCnno=${encodeURIComponent(n)}` },
  { id: "indiapost", name: "India Post", url: (n) => `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?cn=${encodeURIComponent(n)}` },
  { id: "shiprocket", name: "Shiprocket", url: (n) => `https://shiprocket.co/tracking/${encodeURIComponent(n)}` },
  { id: "ekart", name: "Ekart", url: (n) => `https://ekartlogistics.com/shipmenttrack/${encodeURIComponent(n)}` },
  { id: "xpressbees", name: "Xpressbees", url: (n) => `https://www.xpressbees.com/shipment/tracking?awbNo=${encodeURIComponent(n)}` },
  { id: "fedex", name: "FedEx", url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}` },
  { id: "ups", name: "UPS", url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` },
  { id: "dhl", name: "DHL", url: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}` },
  { id: "usps", name: "USPS", url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}` },
  { id: "royalmail", name: "Royal Mail", url: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(n)}` },
  { id: "aramex", name: "Aramex", url: (n) => `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(n)}` },
  { id: "other", name: "Other carrier", url: () => "" },
];
