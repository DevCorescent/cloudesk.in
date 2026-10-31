// Logistics & fleet: vehicles (with their papers), drivers, carriers and
// their rate cards, shipments (own fleet or a transporter/courier) with a
// status trail and proof of delivery, trips with stops, and the fuel log. The
// sums: freight from a rate card (with volumetric weight), mileage by the
// full-tank method, papers expiring, a trip's load against capacity, and
// on-time delivery.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A state: its two-letter code or its name (turned into the code when saved). */
const states = z.string().trim().max(80).default("");

export const VEHICLE_TYPES = ["bike", "car", "van", "tempo", "truck", "other"] as const;
export const VEHICLE_TYPE_LABEL: Record<(typeof VEHICLE_TYPES)[number], string> = { bike: "Two-wheeler", car: "Car", van: "Van", tempo: "Tempo / LCV", truck: "Truck", other: "Other" };
export const FUELS = ["diesel", "petrol", "cng", "electric"] as const;
export const DOC_KINDS = ["registration", "insurance", "puc", "permit", "fitness", "road_tax"] as const;
export const DOC_LABEL: Record<(typeof DOC_KINDS)[number], string> = { registration: "Registration (RC)", insurance: "Insurance", puc: "Pollution (PUC)", permit: "Permit", fitness: "Fitness", road_tax: "Road tax" };
export const SHIP_STATUSES = ["planned", "picked", "in_transit", "out_for_delivery", "delivered", "exception", "returned", "cancelled"] as const;
export const SHIP_STATUS_LABEL: Record<(typeof SHIP_STATUSES)[number], string> = { planned: "Planned", picked: "Picked up", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", exception: "Held up", returned: "Returned", cancelled: "Cancelled" };
export const OPEN_SHIP = ["planned", "picked", "in_transit", "out_for_delivery", "exception"];
export const EXPENSE_KINDS = ["toll", "parking", "loading", "driver_allowance", "repair", "other"] as const;
export const EXPENSE_LABEL: Record<(typeof EXPENSE_KINDS)[number], string> = { toll: "Toll", parking: "Parking", loading: "Loading / unloading", driver_allowance: "Driver allowance", repair: "Repair on the road", other: "Other" };

export const settingsSchema = z
  .object({
    shipmentPrefix: z.string().trim().min(1).max(10).default("SHP-"),
    tripPrefix: z.string().trim().min(1).max(10).default("TRP-"),
    /** Days ahead that vehicle papers and driving licences are flagged. */
    alertDays: z.number().int().min(1).max(365).default(30),
    /** Days after dispatch a shipment is promised by, when no date is given. */
    promiseDays: z.number().int().min(0).max(60).default(3),
  })
  .prefault({});
export type LgxSettings = z.infer<typeof settingsSchema>;

export const vehicleSchema = z.object({
  regNo: z.string().trim().toUpperCase().min(4, "The registration number").max(20).transform((x) => x.replace(/\s+/g, " ")),
  name: z.string().trim().max(80).default(""),
  type: z.enum(VEHICLE_TYPES).default("van"),
  ownership: z.enum(["own", "hired", "leased"]).default("own"),
  capacityKg: z.number().min(0).max(100000).default(0),
  fuel: z.enum(FUELS).default("diesel"),
  driverId: z.uuid().nullable().default(null),
  assetId: z.uuid().nullable().default(null),
  docs: z.array(z.object({ kind: z.enum(DOC_KINDS), number: z.string().trim().max(60).default(""), expiresOn: day.nullable().default(null) })).max(12).default([]),
  active: z.boolean().default(true),
  notes: z.string().trim().max(2000).default(""),
});

export const driverSchema = z.object({
  name: z.string().trim().min(1, "Their name").max(120),
  phone: z.string().trim().max(30).default(""),
  employeeId: z.uuid().nullable().default(null),
  licenceNo: z.string().trim().toUpperCase().max(30).default(""),
  licenceExpires: day.nullable().default(null),
  active: z.boolean().default(true),
});

export const carrierSchema = z.object({
  name: z.string().trim().min(1, "Name the carrier").max(120),
  kind: z.enum(["transporter", "courier"]).default("transporter"),
  supplierId: z.uuid().nullable().default(null),
  /** Where to track a consignment; {tracking} is replaced with the number. */
  trackingUrl: z.union([z.literal(""), z.string().trim().max(300).regex(/^https?:\/\/\S+$/, "A web link, with {tracking} where the number goes")]).default(""),
  active: z.boolean().default(true),
});

export const rateSchema = z.object({
  carrierId: z.uuid(),
  fromState: states,
  toState: states,
  /** Paise per kg of chargeable weight. */
  perKg: z.number().int().min(0).max(1e8).default(0),
  minCharge: z.number().int().min(0).max(1e9).default(0),
  /** Added to every consignment (docket, fuel surcharge as a flat), paise. */
  fixed: z.number().int().min(0).max(1e9).default(0),
  /** Volumetric weight = L×W×H (cm) ÷ this; 0 to ignore. 5000 is common for couriers. */
  volumetricDivisor: z.number().int().min(0).max(100000).default(0),
});

export const shipmentSchema = z.object({
  mode: z.enum(["own", "carrier"]).default("carrier"),
  carrierId: z.uuid().nullable().default(null),
  trackingNo: z.string().trim().max(60).default(""),
  lrNo: z.string().trim().max(60).default(""),
  ewayBillNo: z.string().trim().max(20).default(""),
  deliveryIds: z.array(z.uuid()).max(50).default([]),
  consignee: z.string().trim().min(1, "Who it's going to").max(160),
  phone: z.string().trim().max(30).default(""),
  address: z.string().trim().max(500).default(""),
  state: states,
  warehouseId: z.uuid().nullable().default(null),
  weightKg: z.number().min(0).max(100000).default(0),
  packages: z.number().int().min(0).max(10000).default(1),
  dims: z.object({ l: z.number().min(0).max(10000), w: z.number().min(0).max(10000), h: z.number().min(0).max(10000) }).nullable().default(null),
  freightCost: z.number().int().min(0).max(1e10).nullable().default(null),
  freightBilled: z.number().int().min(0).max(1e10).default(0),
  promisedOn: day.nullable().default(null),
  notes: z.string().trim().max(2000).default(""),
});

export const tripSchema = z.object({
  date: day,
  vehicleId: z.uuid(),
  driverId: z.uuid().nullable().default(null),
  shipmentIds: z.array(z.uuid()).max(100).default([]),
  notes: z.string().trim().max(2000).default(""),
});

export const fuelSchema = z.object({
  vehicleId: z.uuid(),
  date: day,
  litres: z.number().min(0.01).max(10000),
  amount: z.number().int().min(0).max(1e9),
  odometer: z.number().min(0).max(1e8),
  /** Filled to the top (needed for mileage). */
  full: z.boolean().default(true),
  station: z.string().trim().max(120).default(""),
  paidFromId: z.uuid().nullable().default(null),
});

export type Rate = z.infer<typeof rateSchema>;
/** The weight a carrier charges for: the actual weight or the volumetric weight, whichever is more. */
export function chargeable(weightKg: number, dims: { l: number; w: number; h: number } | null, divisor: number, packages = 1) {
  const vol = dims && divisor ? (dims.l * dims.w * dims.h * Math.max(1, packages)) / divisor : 0;
  return Math.round(Math.max(weightKg, vol) * 100) / 100;
}

/**
 * Freight for a consignment from a carrier's rate card: the most specific rate
 * for the lane (from and to state, then either, then any), chargeable weight ×
 * rate per kg, at least the minimum, plus the fixed charge.
 */
export function freightEstimate(rates: (Rate & { id?: string })[], c: { carrierId: string; fromState: string; toState: string; weightKg: number; dims: { l: number; w: number; h: number } | null; packages: number }) {
  const mine = rates.filter((r) => r.carrierId === c.carrierId);
  const score = (r: Rate) => (r.fromState === c.fromState ? 2 : r.fromState === "" ? 0 : -9) + (r.toState === c.toState ? 2 : r.toState === "" ? 0 : -9);
  const best = mine.filter((r) => score(r) >= 0).sort((a, b) => score(b) - score(a))[0];
  if (!best) return null;
  const kg = chargeable(c.weightKg, c.dims, best.volumetricDivisor, c.packages);
  return { rate: best, chargeableKg: kg, amount: Math.max(best.minCharge, Math.round(kg * best.perKg)) + best.fixed };
}

/**
 * Mileage by the full-tank method: between two fills to the top, the distance
 * driven over the litres put in at the second. Partial fills in between add
 * their litres to the next full one.
 */
export function mileage(fills: { odometer: number; litres: number; full: boolean; amount: number }[]) {
  const xs = [...fills].sort((a, b) => a.odometer - b.odometer);
  let km = 0;
  let litres = 0;
  let cost = 0;
  let from: number | null = null;
  let pendingL = 0;
  let pendingC = 0;
  for (const f of xs) {
    if (from === null) {
      if (f.full) from = f.odometer;
      continue;
    }
    pendingL += f.litres;
    pendingC += f.amount;
    if (f.full) {
      km += f.odometer - from;
      litres += pendingL;
      cost += pendingC;
      from = f.odometer;
      pendingL = 0;
      pendingC = 0;
    }
  }
  return { km: Math.round(km * 10) / 10, litres: Math.round(litres * 100) / 100, kmPerLitre: litres ? Math.round((km / litres) * 100) / 100 : null, costPerKm: km ? Math.round(cost / km) : null };
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Papers expired or expiring within the alert window. */
export function expiring(docs: { kind: string; number: string; expiresOn: string | null }[], today: string, days: number) {
  const soon = addDays(today, days);
  return docs.filter((d) => d.expiresOn && d.expiresOn <= soon).map((d) => ({ ...d, expired: d.expiresOn! < today }));
}

/** A trip's load: the shipments' weight against the vehicle's capacity. */
export const load = (weights: number[], capacityKg: number) => {
  const kg = Math.round(weights.reduce((n, w) => n + w, 0) * 100) / 100;
  return { kg, share: capacityKg ? kg / capacityKg : null, over: capacityKg > 0 && kg > capacityKg };
};

/** Delivered on or before the promised day (in IST). */
export function onTime(shipments: { status: string; promisedOn: string | null; deliveredAt: Date | string | null }[]) {
  const done = shipments.filter((s) => s.status === "delivered" && s.promisedOn && s.deliveredAt);
  const ok = done.filter((s) => new Date(new Date(s.deliveredAt!).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) <= s.promisedOn!).length;
  return { delivered: done.length, onTime: ok, rate: done.length ? ok / done.length : null };
}

export const trackingLink = (template: string, no: string) => (template && no ? template.replace("{tracking}", encodeURIComponent(no)) : "");

/** Two-letter codes (as on number plates) for state and union-territory names. */
export const STATE_CODE: Record<string, string> = { "andhra pradesh": "AP", "arunachal pradesh": "AR", assam: "AS", bihar: "BR", chhattisgarh: "CG", goa: "GA", gujarat: "GJ", haryana: "HR", "himachal pradesh": "HP", jharkhand: "JH", karnataka: "KA", kerala: "KL", "madhya pradesh": "MP", maharashtra: "MH", manipur: "MN", meghalaya: "ML", mizoram: "MZ", nagaland: "NL", odisha: "OD", punjab: "PB", rajasthan: "RJ", sikkim: "SK", "tamil nadu": "TN", telangana: "TS", tripura: "TR", "uttar pradesh": "UP", uttarakhand: "UK", "west bengal": "WB", "andaman and nicobar islands": "AN", chandigarh: "CH", "dadra and nagar haveli and daman and diu": "DD", delhi: "DL", "jammu and kashmir": "JK", ladakh: "LA", lakshadweep: "LD", puducherry: "PY" };
/** A state's code from its name or code ("Maharashtra", "mh" → "MH"); "" if unknown. */
export function stateCodeOf(v: string) {
  const t = v.trim();
  if (/^[a-z]{2}$/i.test(t)) return Object.values(STATE_CODE).includes(t.toUpperCase()) ? t.toUpperCase() : "";
  return STATE_CODE[t.toLowerCase()] ?? "";
}
