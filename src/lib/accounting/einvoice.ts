// E-invoice (IRN) and e-way bill JSON, in the formats the government portals
// take for upload: the NIC e-invoice schema 1.1 (for the IRP's bulk upload /
// offline tool) and the e-way bill bulk generation format. Cloudesk doesn't
// talk to the IRP or the e-way bill system — that needs a GSP account — so the
// JSON is uploaded by hand and the IRN / EWB numbers are recorded back.
// Amounts in a document are minor units; the JSON is in rupees.
import { z } from "zod";
import { computeDocTotals, isIntraState } from "@/lib/invoicing/totals";
import type { Address, DocInput, Line, Party } from "@/lib/invoicing/model";
import { GST_STATES, stateCode, validateGstin } from "@/lib/store/gst";
import { inrOf } from "./fx";

export const transportSchema = z.object({
  /** 1 road, 2 rail, 3 air, 4 ship */
  mode: z.enum(["1", "2", "3", "4"]).default("1"),
  vehicleNo: z.string().trim().toUpperCase().max(15).default(""),
  /** R regular, O over-dimensional cargo */
  vehicleType: z.enum(["R", "O"]).default("R"),
  distanceKm: z.number().int().min(0).max(4000).default(0),
  transporterId: z.string().trim().toUpperCase().max(15).default(""),
  transporterName: z.string().trim().max(100).default(""),
  transportDocNo: z.string().trim().max(15).default(""),
  transportDocDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
});
export type Transport = z.infer<typeof transportSchema>;

export const recordSchema = z.object({
  irn: z.string().trim().regex(/^([0-9a-f]{64})?$/i, "An IRN is 64 letters and digits").default(""),
  ackNo: z.string().trim().max(20).default(""),
  ackDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  ewbNo: z.string().trim().regex(/^(\d{12})?$/, "An e-way bill number has 12 digits").default(""),
  ewbDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  ewbValidTill: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  transport: transportSchema.prefault({}),
});

/** Units the portals know (UQC), from the units used on invoices. */
const UQC: Record<string, string> = { pcs: "NOS", nos: "NOS", no: "NOS", unit: "UNT", units: "UNT", kg: "KGS", kgs: "KGS", g: "GMS", gm: "GMS", l: "LTR", ltr: "LTR", litre: "LTR", ml: "MLT", m: "MTR", mtr: "MTR", box: "BOX", pack: "PAC", dozen: "DOZ", pair: "PRS", set: "SET", bag: "BAG", bottle: "BTL", ton: "TON", sqm: "SQM", sqft: "SQF" };
export const uqc = (unit: string) => UQC[unit.trim().toLowerCase()] ?? "OTH";
export const isService = (hsn: string) => hsn.startsWith("99");

export type Seller = { gstin: string; legalName: string; tradeName: string; address: Address; phone: string; email: string };
export type EDoc = Pick<DocInput, "type" | "lines" | "adjustments" | "taxMode" | "inclusive" | "placeOfSupply" | "currency"> & { number: string; issueDate: string; client: Party };

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pin = (p: string) => (/^\d{6}$/.test(p.trim()) ? Number(p.trim()) : null);
const codeOf = (state: string) => (/^\d{2}$/.test(state) ? state : stateCode(state) ?? Object.entries(GST_STATES).find(([c]) => c === state)?.[0] ?? null);

/** Lines, taxes and totals in rupees for the JSON, with the problems that would stop an upload. */
function prepare(doc: EDoc, seller: Seller, rate: number | null) {
  const problems: string[] = [];
  const sg = validateGstin(seller.gstin);
  if (!sg.ok) problems.push("Your GSTIN is missing or invalid (invoicing business details)");
  const sellerState = sg.ok ? sg.gstin.slice(0, 2) : codeOf(seller.address.state) ?? "";
  const foreign = doc.currency !== "INR";
  if (foreign && !rate) problems.push(`No ${doc.currency} exchange rate for ${doc.issueDate}`);
  const exportSale = (doc.client.billing?.country ?? "IN") !== "IN";
  const bg = validateGstin(doc.client.gstin ?? "");
  if (!exportSale && !bg.ok) problems.push("The client has no valid GSTIN — e-invoices are for business clients (B2B) and exports");
  const pos = exportSale ? "96" : (codeOf(doc.placeOfSupply) ?? (bg.ok ? bg.gstin.slice(0, 2) : ""));
  if (!pos) problems.push("Set the place of supply");
  if (!pin(seller.address.postalCode)) problems.push("Your PIN code is missing (invoicing business details)");
  if (!seller.address.line1 || seller.address.city.length < 3) problems.push("Your address needs a first line and a city");
  if (!exportSale && !pin(doc.client.billing?.postalCode ?? "")) problems.push("The client's PIN code is missing");
  if (!doc.client.billing?.line1 || (doc.client.billing?.city ?? "").length < 3) problems.push("The client's address needs a first line and a city");
  doc.lines.forEach((l, i) => {
    if (!l.hsn) problems.push(`Line ${i + 1} (${l.name}) has no HSN/SAC code`);
  });
  if (doc.taxMode !== "gst") problems.push("The invoice isn't a GST invoice");
  const intra = !exportSale && isIntraState(GST_STATES[sellerState] ?? "", GST_STATES[pos] ?? doc.placeOfSupply);
  const t = computeDocTotals({ lines: doc.lines, adjustments: doc.adjustments, taxMode: doc.taxMode, inclusive: doc.inclusive, intraState: intra, currency: doc.currency });
  const rs = (minor: number) => r2((foreign ? inrOf(minor, doc.currency, rate ?? 0) : minor) / 100);
  const items = doc.lines.map((l: Line, i) => {
    const lt = t.lines[i];
    const taxable = rs(lt.taxable);
    const tax = rs(lt.tax);
    const half = r2(Math.floor((tax / 2) * 100) / 100);
    return { l, lt, taxable, tax, igst: intra ? 0 : tax, cgst: intra ? r2(tax - half) : 0, sgst: intra ? half : 0 };
  });
  const sum = (f: (x: (typeof items)[number]) => number) => r2(items.reduce((a, x) => a + f(x), 0));
  const itemsTotal = sum((x) => x.taxable + x.tax);
  const total = rs(t.total);
  const round = rs(t.roundOff);
  // Charges (shipping, packing) and their tax go in as other charges.
  const other = r2(total - round - itemsTotal);
  return { problems, sellerState, pos, intra, exportSale, buyerGstin: bg.ok ? bg.gstin : "URP", items, total, round, other, rs, sum, t };
}

/** One invoice or credit note in the NIC e-invoice schema 1.1. */
export function einvoiceJson(doc: EDoc, seller: Seller, rate: number | null) {
  const p = prepare(doc, seller, rate);
  const b = doc.client.billing;
  const json = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: p.exportSale ? (p.sum((x) => x.tax) ? "EXPWP" : "EXPWOP") : "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: doc.type === "credit_note" ? "CRN" : "INV", No: doc.number, Dt: dmy(doc.issueDate) },
    SellerDtls: { Gstin: seller.gstin.toUpperCase(), LglNm: seller.legalName || seller.tradeName, TrdNm: seller.tradeName || seller.legalName, Addr1: seller.address.line1.slice(0, 100), ...(seller.address.line2 ? { Addr2: seller.address.line2.slice(0, 100) } : {}), Loc: seller.address.city.slice(0, 50), Pin: pin(seller.address.postalCode), Stcd: p.sellerState, ...(seller.phone ? { Ph: seller.phone.replace(/\D/g, "").slice(-12) } : {}), ...(seller.email ? { Em: seller.email } : {}) },
    BuyerDtls: { Gstin: p.buyerGstin, LglNm: doc.client.company || doc.client.name, TrdNm: doc.client.company || doc.client.name, Pos: p.pos, Addr1: (b?.line1 ?? "").slice(0, 100), ...(b?.line2 ? { Addr2: b.line2.slice(0, 100) } : {}), Loc: (b?.city ?? "").slice(0, 50), Pin: p.exportSale ? 999999 : pin(b?.postalCode ?? ""), Stcd: p.exportSale ? "96" : p.buyerGstin !== "URP" ? p.buyerGstin.slice(0, 2) : p.pos, ...(doc.client.phone ? { Ph: doc.client.phone.replace(/\D/g, "").slice(-12) } : {}), ...(doc.client.email ? { Em: doc.client.email } : {}) },
    ItemList: p.items.map((x, i) => ({
      SlNo: String(i + 1),
      PrdDesc: x.l.name.slice(0, 300),
      IsServc: isService(x.l.hsn) ? "Y" : "N",
      HsnCd: x.l.hsn,
      Qty: x.l.quantity,
      Unit: isService(x.l.hsn) ? "OTH" : uqc(x.l.unit),
      // Before tax, so that AssAmt = TotAmt − Discount even for tax-inclusive prices.
      UnitPrice: x.l.quantity ? r2((x.taxable + p.rs(x.lt.discount)) / x.l.quantity) : r2(x.taxable + p.rs(x.lt.discount)),
      TotAmt: r2(x.taxable + p.rs(x.lt.discount)),
      Discount: p.rs(x.lt.discount),
      AssAmt: x.taxable,
      GstRt: x.l.taxBps / 100,
      IgstAmt: x.igst,
      CgstAmt: x.cgst,
      SgstAmt: x.sgst,
      CesAmt: 0,
      TotItemVal: r2(x.taxable + x.tax),
    })),
    ValDtls: { AssVal: p.sum((x) => x.taxable), CgstVal: p.sum((x) => x.cgst), SgstVal: p.sum((x) => x.sgst), IgstVal: p.sum((x) => x.igst), CesVal: 0, OthChrg: p.other, RndOffAmt: p.round, TotInvVal: p.total },
    ...(p.exportSale ? { ExpDtls: { ...(doc.currency !== "INR" ? { ForCur: doc.currency } : {}), CntCode: (b?.country ?? "").toUpperCase() } } : {}),
  };
  return { json, problems: p.problems };
}

/** One invoice in the e-way bill bulk generation format (goods only). */
export function ewayJson(doc: EDoc, seller: Seller, rate: number | null, t: Transport) {
  const p = prepare(doc, seller, rate);
  const problems = [...p.problems.filter((x) => !x.startsWith("The client has no valid GSTIN"))];
  const goods = p.items.filter((x) => !isService(x.l.hsn));
  if (!goods.length) problems.push("No goods on this invoice — services don't need an e-way bill");
  if (t.mode === "1" && !t.vehicleNo && !t.transporterId) problems.push("Add the vehicle number or the transporter's ID");
  if (!t.distanceKm) problems.push("Add the approximate distance in km");
  if (p.exportSale) problems.push("Exports aren't supported here — generate their e-way bill on the portal");
  const b = doc.client.billing;
  const bill = {
    userGstin: seller.gstin.toUpperCase(),
    supplyType: "O",
    subSupplyType: 1,
    subSupplyDesc: "",
    docType: "INV",
    docNo: doc.number,
    docDate: dmy(doc.issueDate),
    fromGstin: seller.gstin.toUpperCase(),
    fromTrdName: seller.tradeName || seller.legalName,
    fromAddr1: seller.address.line1.slice(0, 120),
    fromAddr2: seller.address.line2.slice(0, 120),
    fromPlace: seller.address.city.slice(0, 50),
    fromPincode: pin(seller.address.postalCode),
    fromStateCode: Number(p.sellerState),
    actFromStateCode: Number(p.sellerState),
    toGstin: p.buyerGstin,
    toTrdName: doc.client.company || doc.client.name,
    toAddr1: (b?.line1 ?? "").slice(0, 120),
    toAddr2: (b?.line2 ?? "").slice(0, 120),
    toPlace: (b?.city ?? "").slice(0, 50),
    toPincode: pin(b?.postalCode ?? ""),
    toStateCode: Number(p.pos),
    actToStateCode: Number(p.pos),
    transactionType: 1,
    totalValue: r2(goods.reduce((a, x) => a + x.taxable, 0)),
    cgstValue: r2(goods.reduce((a, x) => a + x.cgst, 0)),
    sgstValue: r2(goods.reduce((a, x) => a + x.sgst, 0)),
    igstValue: r2(goods.reduce((a, x) => a + x.igst, 0)),
    cessValue: 0,
    cessNonAdvolValue: 0,
    otherValue: p.other,
    totInvValue: p.total,
    transMode: Number(t.mode),
    transDistance: String(t.distanceKm),
    transporterId: t.transporterId,
    transporterName: t.transporterName,
    transDocNo: t.transportDocNo,
    transDocDate: t.transportDocDate ? dmy(t.transportDocDate) : "",
    vehicleNo: t.vehicleNo,
    vehicleType: t.vehicleType,
    itemList: goods.map((x, i) => ({ itemNo: i + 1, productName: x.l.name.slice(0, 100), productDesc: (x.l.description || x.l.name).slice(0, 100), hsnCode: Number(x.l.hsn), quantity: x.l.quantity, qtyUnit: uqc(x.l.unit), taxableAmount: x.taxable, sgstRate: p.intra ? x.l.taxBps / 200 : 0, cgstRate: p.intra ? x.l.taxBps / 200 : 0, igstRate: p.intra ? 0 : x.l.taxBps / 100, cessRate: 0, cessNonAdvol: 0 })),
  };
  return { json: { version: "1.0.0621", billLists: [bill] }, problems };
}
