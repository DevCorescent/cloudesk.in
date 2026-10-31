import { describe, expect, it } from "vitest";
import { chargeable, expiring, freightEstimate, load, mileage, onTime, rateSchema, trackingLink, vehicleSchema } from "@/lib/logistics/model";

const carrier = "00000000-0000-4000-8000-000000000001";
const rates = [
  rateSchema.parse({ carrierId: carrier, perKg: 1200, minCharge: 30000 }),
  rateSchema.parse({ carrierId: carrier, fromState: "MH", toState: "KA", perKg: 900, minCharge: 25000, fixed: 5000, volumetricDivisor: 5000 }),
];

describe("freight", () => {
  it("uses the most specific lane, volumetric weight and the minimum", () => {
    expect(chargeable(10, { l: 50, w: 40, h: 40 }, 5000)).toBe(16);
    const e = freightEstimate(rates, { carrierId: carrier, fromState: "MH", toState: "KA", weightKg: 10, dims: { l: 50, w: 40, h: 40 }, packages: 2 });
    // 2 boxes of 16 kg volumetric = 32 kg × ₹9 = ₹288, plus ₹50.
    expect(e).toMatchObject({ chargeableKg: 32, amount: 28800 + 5000 });
    expect(freightEstimate(rates, { carrierId: carrier, fromState: "MH", toState: "DL", weightKg: 5, dims: null, packages: 1 })!.amount).toBe(30000);
    expect(freightEstimate(rates, { carrierId: "x", fromState: "MH", toState: "DL", weightKg: 5, dims: null, packages: 1 })).toBeNull();
  });
});

describe("fleet", () => {
  it("works out mileage from full tank to full tank", () => {
    const m = mileage([{ odometer: 1000, litres: 40, full: true, amount: 4000_00 }, { odometer: 1200, litres: 10, full: false, amount: 1000_00 }, { odometer: 1450, litres: 20, full: true, amount: 2000_00 }, { odometer: 1700, litres: 25, full: true, amount: 2500_00 }]);
    // 450 km on 30 l, then 250 km on 25 l: 700 km on 55 l.
    expect(m).toEqual({ km: 700, litres: 55, kmPerLitre: 12.73, costPerKm: Math.round(5500_00 / 700) });
    expect(mileage([{ odometer: 10, litres: 5, full: false, amount: 1 }]).kmPerLitre).toBeNull();
  });

  it("flags papers expiring, a trip over capacity, and normalises registration numbers", () => {
    expect(expiring([{ kind: "insurance", number: "P1", expiresOn: "2026-11-10" }, { kind: "puc", number: "", expiresOn: "2026-10-01" }, { kind: "permit", number: "", expiresOn: "2027-06-01" }], "2026-10-24", 30)).toEqual([{ kind: "insurance", number: "P1", expiresOn: "2026-11-10", expired: false }, { kind: "puc", number: "", expiresOn: "2026-10-01", expired: true }]);
    expect(load([400, 350.5], 700)).toEqual({ kg: 750.5, share: 750.5 / 700, over: true });
    expect(vehicleSchema.parse({ regNo: "mh12  ab 1234" }).regNo).toBe("MH12 AB 1234");
  });

  it("counts on-time deliveries by the day in India, and builds tracking links", () => {
    const r = onTime([{ status: "delivered", promisedOn: "2026-10-20", deliveredAt: "2026-10-20T18:00:00Z" }, { status: "delivered", promisedOn: "2026-10-20", deliveredAt: "2026-10-20T10:00:00Z" }, { status: "in_transit", promisedOn: "2026-10-20", deliveredAt: null }]);
    // 18:00 UTC is 23:30 IST on the 20th; on time. Both count.
    expect(r).toEqual({ delivered: 2, onTime: 2, rate: 1 });
    expect(onTime([{ status: "delivered", promisedOn: "2026-10-20", deliveredAt: "2026-10-20T19:00:00Z" }]).onTime).toBe(0);
    expect(trackingLink("https://track.example/?awb={tracking}", "AB 12")).toBe("https://track.example/?awb=AB%2012");
  });
});
