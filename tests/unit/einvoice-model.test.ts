import { describe, expect, it } from "vitest";
import { einvoiceJson, ewayJson, transportSchema, uqc, type EDoc, type Seller } from "@/lib/accounting/einvoice";

const seller: Seller = { gstin: "29AAJFS2290K1ZO", legalName: "Sharma & Co LLP", tradeName: "Sharma & Co", address: { line1: "12 MG Road", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" }, phone: "+91 98450 12345", email: "accounts@sharma.example" };
const client = { name: "Meera", company: "Lumen Labs Pvt Ltd", email: "", phone: "", gstin: "29AAJFS2290K1ZO", billing: { line1: "4 Residency Road", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560025", country: "IN" }, shipping: null };
const line = (id: string, name: string, hsn: string, quantity: number, rate: number, taxBps: number, unit = "") => ({ id, itemId: null, name, description: "", hsn, quantity, unit, rate, discount: null, taxBps });
const doc = (over: Partial<EDoc> = {}): EDoc => ({
  type: "invoice",
  number: "INV-2026-0042",
  issueDate: "2026-10-05",
  client,
  currency: "INR",
  taxMode: "gst",
  inclusive: false,
  placeOfSupply: "Karnataka",
  adjustments: { discount: null, charges: [], roundOff: true },
  lines: [line("1", "Steel shelving unit", "94032090", 4, 12500_00, 1800, "pcs"), line("2", "Installation", "998719", 1, 3000_00, 1800)],
  ...over,
});

describe("e-invoice JSON", () => {
  it("follows the NIC schema, with CGST and SGST inside a state and totals that add up", () => {
    const { json, problems } = einvoiceJson(doc(), seller, null);
    expect(problems).toEqual([]);
    expect(json.TranDtls.SupTyp).toBe("B2B");
    expect(json.DocDtls).toEqual({ Typ: "INV", No: "INV-2026-0042", Dt: "05/10/2026" });
    expect(json.SellerDtls).toMatchObject({ Gstin: "29AAJFS2290K1ZO", Stcd: "29", Pin: 560001, Ph: "919845012345" });
    expect(json.BuyerDtls).toMatchObject({ Pos: "29", Stcd: "29", Pin: 560025 });
    const [goods, service] = json.ItemList;
    expect(goods).toMatchObject({ IsServc: "N", Unit: "NOS", Qty: 4, UnitPrice: 12500, TotAmt: 50000, AssAmt: 50000, GstRt: 18, CgstAmt: 4500, SgstAmt: 4500, IgstAmt: 0, TotItemVal: 59000 });
    expect(service).toMatchObject({ IsServc: "Y", Unit: "OTH", AssAmt: 3000 });
    expect(json.ValDtls).toMatchObject({ AssVal: 53000, CgstVal: 4770, SgstVal: 4770, IgstVal: 0, OthChrg: 0, TotInvVal: 62540 });
  });

  it("keeps AssAmt = TotAmt − Discount for tax-inclusive prices", () => {
    const { json } = einvoiceJson(doc({ inclusive: true, lines: [line("1", "Chair", "9401", 2, 1180_00, 1800, "pcs")] }), seller, null);
    const [i] = json.ItemList;
    expect(i.AssAmt).toBe(2000);
    expect(i.TotAmt - i.Discount).toBe(i.AssAmt);
    expect(i.TotItemVal).toBe(2360);
  });

  it("uses IGST across states, and lists what would stop an upload", () => {
    const { json } = einvoiceJson(doc({ placeOfSupply: "Maharashtra", client: { ...client, gstin: "27AAJFS2290K1ZQ" } }), seller, null);
    expect(json.ValDtls).toMatchObject({ IgstVal: 9540, CgstVal: 0 });
    const bad = einvoiceJson(doc({ client: { ...client, gstin: "" }, lines: [line("1", "Thing", "", 1, 100_00, 1800)] }), seller, null);
    expect(bad.problems).toEqual(expect.arrayContaining([expect.stringMatching(/no valid GSTIN/), expect.stringMatching(/no HSN/)]));
  });

  it("converts an export invoice at the rate and marks it an export", () => {
    const usd = doc({ currency: "USD", placeOfSupply: "", client: { ...client, gstin: "", billing: { ...client.billing, country: "US", postalCode: "94105" } }, lines: [line("1", "Design retainer", "998391", 1, 1000_00, 0)] });
    const { json, problems } = einvoiceJson(usd, seller, 83.5);
    expect(problems).toEqual([]);
    expect(json.TranDtls.SupTyp).toBe("EXPWOP");
    expect(json.BuyerDtls).toMatchObject({ Gstin: "URP", Pos: "96", Stcd: "96" });
    expect(json.ValDtls.TotInvVal).toBe(83500);
    expect(json.ExpDtls).toEqual({ ForCur: "USD", CntCode: "US" });
  });
});

describe("e-way bill JSON", () => {
  it("lists only goods, with the transport details", () => {
    const t = transportSchema.parse({ vehicleNo: "ka01ab1234", distanceKm: 18 });
    const { json, problems } = ewayJson(doc(), seller, null, t);
    expect(problems).toEqual([]);
    const b = json.billLists[0];
    expect(b).toMatchObject({ docNo: "INV-2026-0042", fromStateCode: 29, toStateCode: 29, transMode: 1, transDistance: "18", vehicleNo: "KA01AB1234", totalValue: 50000, cgstValue: 4500 });
    expect(b.itemList).toEqual([expect.objectContaining({ hsnCode: 94032090, qtyUnit: "NOS", cgstRate: 9, sgstRate: 9, igstRate: 0 })]);
    expect(ewayJson(doc({ lines: [line("1", "Consulting", "998311", 1, 100_00, 1800)] }), seller, null, t).problems).toContain("No goods on this invoice — services don't need an e-way bill");
    expect(uqc("kg")).toBe("KGS");
  });
});
