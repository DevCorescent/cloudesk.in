// Draws an invoice, quotation, proforma or credit note as a self-contained
// HTML page laid out for paper (A4/Letter/A5). The same output is the live
// preview in the editor, the page the client opens, and what prints or saves
// as PDF — so they can never disagree.
import { qrSvg, upiPayUrl } from "../store/barcode";
import { formatMoney } from "../store/money";
import { FONT_STACK, type Address, type Adjustments, type DisplayStatus, type DocType, type InvoiceSettings, type Line, type Party, type TaxMode, type TemplateConfig } from "./model";
import { computeDocTotals, isIntraState, type DocTotals } from "./totals";
import { amountInWords } from "./words";

export type RenderDoc = {
  type: DocType;
  number: string;
  status: DisplayStatus;
  title: string;
  issueDate: string;
  dueDate: string | null;
  client: Party;
  lines: Line[];
  adjustments: Adjustments;
  taxMode: TaxMode;
  inclusive: boolean;
  placeOfSupply: string;
  reference: string;
  notes: string;
  terms: string;
  footer: string;
  customFields: { label: string; value: string }[];
  amountPaid: number;
  currency: string;
};

export type RenderOptions = {
  doc: RenderDoc;
  settings: Pick<InvoiceSettings, "business" | "payment" | "taxLabel">;
  template: TemplateConfig;
  /** Screen shows paper on a grey desk (with optional zoom); print is just the paper. */
  mode?: "screen" | "print";
  zoom?: number;
  /** Extra markup placed before the paper (e.g. the client's toolbar). Not printed. */
  before?: string;
  extraCss?: string;
};

const PAPER = { A4: [210, 297], Letter: [215.9, 279.4], A5: [148, 210] } as const;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const multiline = (s: string) => esc(s).replace(/\n/g, "<br>");
const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, ""));
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const safeUrl = (u: string) => (/^(https:\/\/|\/assets\/|\/f\/)[^\s"'<>]+$/i.test(u) ? u : "");

function address(a: Address | null | undefined) {
  if (!a) return "";
  const cityLine = [a.city, a.state, a.postalCode].filter(Boolean).join(", ");
  return [a.line1, a.line2, cityLine].filter(Boolean).map(esc).join("<br>");
}

export function titleFor(doc: Pick<RenderDoc, "type" | "title">, t: TemplateConfig) {
  return doc.title.trim() || t.labels[doc.type];
}

export function renderDocument(o: RenderOptions): { html: string; totals: DocTotals } {
  const { doc: d, template: t, settings: s } = o;
  const b = s.business;
  const money = (n: number) => formatMoney(n, d.currency);
  const totals = computeDocTotals({ lines: d.lines, adjustments: d.adjustments, taxMode: d.taxMode, inclusive: d.inclusive, intraState: isIntraState(b.address.state, d.placeOfSupply || d.client.billing.state), currency: d.currency, taxLabel: s.taxLabel });
  const balance = Math.max(0, totals.total - d.amountPaid);
  const L = t.labels;
  const [pw, ph] = PAPER[t.paper];
  const isQuote = d.type === "quote";
  const tax = d.taxMode !== "none";
  const cols = { ...t.table.columns, hsn: t.table.columns.hsn && d.taxMode === "gst", tax: t.table.columns.tax && tax, discount: t.table.columns.discount && d.lines.some((l) => l.discount) };
  const logo = safeUrl(b.logo);
  const logoImg = logo && t.logo.position !== "none" ? `<img class="logo" src="${esc(logo)}" alt="${esc(b.name)}">` : "";

  // ── Header ──
  const bizBlock = `<div class="biz">
      ${t.layout === "band" ? "" : `<div class="biz-name">${esc(b.name || b.legalName || "Your business")}</div>`}
      ${b.legalName && b.legalName !== b.name ? `<div class="muted">${esc(b.legalName)}</div>` : ""}
      <div class="muted">${address(b.address)}</div>
      <div class="muted">${[b.phone, b.email, b.website].filter(Boolean).map(esc).join(" · ")}</div>
      ${t.show.businessGstin && b.gstin ? `<div class="muted"><b>GSTIN</b> ${esc(b.gstin)}${b.pan ? ` · <b>PAN</b> ${esc(b.pan)}` : ""}</div>` : ""}
    </div>`;
  const metaRows: [string, string][] = [
    [L.number, d.number || "Draft"],
    [L.date, fmtDate(d.issueDate)],
    ...(d.dueDate ? ([[isQuote ? L.validUntil : L.dueDate, fmtDate(d.dueDate)]] as [string, string][]) : []),
    ...(d.reference ? ([["Reference", d.reference]] as [string, string][]) : []),
  ];
  const meta = `<table class="meta">${metaRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const title = `<div class="doc-title">${esc(titleFor(d, t))}</div>`;

  let header: string;
  if (t.layout === "band") {
    header = `<div class="band"><div class="band-left">${logoImg}<div class="biz-name">${esc(b.name || "Your business")}</div></div><div class="band-right">${title}<div class="band-no">${esc(d.number || "Draft")}</div></div></div>
      <div class="head">${bizBlock}${meta}</div>`;
  } else if (t.layout === "elegant" || t.logo.position === "center") {
    header = `<div class="head head-center">${logoImg}${bizBlock}</div><div class="title-row">${title}${meta}</div>`;
  } else {
    const left = `<div class="head-left">${t.logo.position === "left" ? logoImg : ""}${bizBlock}</div>`;
    const right = `<div class="head-right">${t.logo.position === "right" ? logoImg : ""}${title}${meta}</div>`;
    header = `<div class="head">${left}${right}</div>`;
  }

  // ── Parties ──
  const c = d.client;
  const party = (label: string, p: Party, a: Address | null) => `<div class="party"><div class="label">${esc(label)}</div>
      <div class="party-name">${esc(p.company || p.name)}</div>
      ${p.company && p.name ? `<div>${esc(p.name)}</div>` : ""}
      <div class="muted">${address(a)}</div>
      ${t.show.clientContact ? `<div class="muted">${[p.phone, p.email].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
      ${t.show.clientGstin && p.gstin ? `<div class="muted"><b>GSTIN</b> ${esc(p.gstin)}</div>` : ""}
    </div>`;
  const extra: [string, string][] = [
    ...(t.show.placeOfSupply && d.taxMode === "gst" && (d.placeOfSupply || c.billing.state) ? ([["Place of supply", d.placeOfSupply || c.billing.state]] as [string, string][]) : []),
    ...d.customFields.filter((f) => f.value).map((f) => [f.label, f.value] as [string, string]),
  ];
  const parties = `<div class="parties">
      ${party(L.billTo, c, c.billing)}
      ${t.show.shipTo && c.shipping && (c.shipping.line1 || c.shipping.city) ? party(L.shipTo, c, c.shipping) : ""}
      ${extra.length ? `<div class="party extra">${extra.map(([k, v]) => `<div><span class="label">${esc(k)}</span><div>${esc(v)}</div></div>`).join("")}</div>` : ""}
    </div>`;

  // ── Items ──
  const head = [
    cols.sn ? `<th class="c-sn">#</th>` : "",
    `<th class="c-item">${esc(L.item)}</th>`,
    cols.hsn ? `<th class="c-hsn">${esc(L.hsn)}</th>` : "",
    cols.quantity ? `<th class="num">${esc(L.quantity)}</th>` : "",
    cols.unit ? `<th>Unit</th>` : "",
    cols.rate ? `<th class="num">${esc(L.rate)}</th>` : "",
    cols.discount ? `<th class="num">${esc(L.discount)}</th>` : "",
    cols.tax ? `<th class="num">${esc(L.tax)}</th>` : "",
    cols.amount ? `<th class="num">${esc(L.amount)}</th>` : "",
  ].join("");
  const rows = d.lines
    .map((l, i) => {
      const lt = totals.lines[i];
      const disc = l.discount ? (l.discount.kind === "percent" ? `${l.discount.value}%` : money(Math.round(l.discount.value))) : "";
      return `<tr>
        ${cols.sn ? `<td class="c-sn">${i + 1}</td>` : ""}
        <td class="c-item"><div class="item-name">${esc(l.name)}</div>${l.description ? `<div class="item-desc">${multiline(l.description)}</div>` : ""}</td>
        ${cols.hsn ? `<td class="c-hsn">${esc(l.hsn)}</td>` : ""}
        ${cols.quantity ? `<td class="num">${qty(l.quantity)}${!cols.unit && l.unit ? ` <span class="muted">${esc(l.unit)}</span>` : ""}</td>` : ""}
        ${cols.unit ? `<td>${esc(l.unit)}</td>` : ""}
        ${cols.rate ? `<td class="num">${money(l.rate)}</td>` : ""}
        ${cols.discount ? `<td class="num">${disc}</td>` : ""}
        ${cols.tax ? `<td class="num">${l.taxBps ? pct(l.taxBps) : "—"}</td>` : ""}
        ${cols.amount ? `<td class="num">${money(d.inclusive ? lt.amount : lt.taxable)}</td>` : ""}
      </tr>`;
    })
    .join("");
  const items = `<table class="items items-${t.table.style}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;

  // ── Totals ──
  const tr = (k: string, v: string, cls = "") => `<tr class="${cls}"><th>${k}</th><td>${v}</td></tr>`;
  const sums = [
    tr(esc(L.subtotal), money(totals.subtotal)),
    totals.discount ? tr("Discount", `− ${money(totals.discount)}`) : "",
    ...d.adjustments.charges.map((ch) => tr(esc(ch.label), money(ch.amount))),
    ...(d.inclusive ? [] : totals.taxes.map((x) => tr(esc(x.label), money(x.amount)))),
    totals.roundOff ? tr("Round off", `${totals.roundOff > 0 ? "+" : "−"} ${money(Math.abs(totals.roundOff))}`) : "",
    tr(esc(L.total), money(totals.total), "grand"),
    d.inclusive && totals.tax ? `<tr class="note"><td colspan="2">Includes ${totals.taxes.map((x) => `${esc(x.label)} ${money(x.amount)}`).join(", ")}</td></tr>` : "",
    d.amountPaid && !isQuote ? tr("Paid", `− ${money(d.amountPaid)}`) : "",
    d.amountPaid && !isQuote ? tr(esc(L.balance), money(balance), "balance") : "",
  ].join("");

  const p = s.payment;
  const bank = t.show.bankDetails && !isQuote && d.type !== "credit_note" && (p.accountNumber || p.instructions)
    ? `<div class="block"><div class="label">Payment details</div><div class="muted">${[p.accountName && `A/c name: ${esc(p.accountName)}`, p.bankName && `Bank: ${esc(p.bankName)}`, p.accountNumber && `A/c no.: ${esc(p.accountNumber)}`, p.ifsc && `IFSC: ${esc(p.ifsc)}`, p.branch && `Branch: ${esc(p.branch)}`, p.swift && `SWIFT: ${esc(p.swift)}`].filter(Boolean).join("<br>")}${p.instructions ? `<br>${multiline(p.instructions)}` : ""}</div></div>`
    : "";
  const showUpi = t.show.upiQr && p.upiId && d.currency === "INR" && balance > 0 && (d.type === "invoice" || d.type === "proforma") && d.status !== "void";
  const upi = showUpi
    ? `<div class="upi">${qrSvg(upiPayUrl({ vpa: p.upiId, name: b.name || "Payment", amountMinor: balance, note: `${d.number || "Invoice"}`, ref: d.number.replace(/[^\w]/g, "").slice(0, 35) || undefined }), { margin: 1, label: "Scan to pay with UPI" })}<div><b>Scan to pay ${money(balance)}</b><br><span class="muted">UPI · ${esc(p.upiId)}</span></div></div>`
    : "";
  const words = t.show.amountInWords ? `<div class="block"><div class="label">Amount in words</div><div>${esc(amountInWords(totals.total, d.currency))}</div></div>` : "";
  const hsnTable =
    t.show.taxSummary && d.taxMode === "gst" && totals.tax > 0
      ? (() => {
          const intra = totals.taxes.some((x) => x.label.startsWith("CGST"));
          const rowsH = totals.hsn
            .filter((h) => h.rateBps > 0)
            .map((h) => `<tr><td>${esc(h.hsn || "—")}</td><td class="num">${money(h.taxable)}</td>${intra ? `<td class="num">${pct(h.rateBps / 2)}</td><td class="num">${money(Math.floor(h.tax / 2))}</td><td class="num">${pct(h.rateBps / 2)}</td><td class="num">${money(h.tax - Math.floor(h.tax / 2))}</td>` : `<td class="num">${pct(h.rateBps)}</td><td class="num">${money(h.tax)}</td>`}<td class="num">${money(h.tax)}</td></tr>`)
            .join("");
          return `<table class="hsn"><thead><tr><th>HSN/SAC</th><th class="num">Taxable value</th>${intra ? `<th class="num">CGST</th><th class="num">Amount</th><th class="num">SGST</th><th class="num">Amount</th>` : `<th class="num">IGST</th><th class="num">Amount</th>`}<th class="num">Total tax</th></tr></thead><tbody>${rowsH}</tbody></table>`;
        })()
      : "";
  const notes = t.show.notes && d.notes ? `<div class="block"><div class="label">${esc(L.notes)}</div><div>${multiline(d.notes)}</div></div>` : "";
  const terms = t.show.terms && d.terms ? `<div class="block terms"><div class="label">${esc(L.terms)}</div><div class="muted">${multiline(d.terms)}</div></div>` : "";
  const sigImg = safeUrl(t.signature.image);
  const sign = t.show.signature ? `<div class="sign">${sigImg ? `<img src="${esc(sigImg)}" alt="Signature">` : `<div class="sign-space"></div>`}<div class="sign-line">${esc(t.signature.name || `For ${b.name || "the business"}`)}</div><div class="muted">${esc(L.signatory)}</div></div>` : "";
  const footer = [d.footer, t.footerText].filter(Boolean).map(multiline).join("<br>");

  // Drafts and void documents get a faint watermark; paid / accepted a stamp beside the totals.
  const stamp = d.status === "void" ? `<div class="watermark">VOID</div>` : d.status === "draft" ? `<div class="watermark">DRAFT</div>` : "";
  const seal = t.show.paidStamp && d.status === "paid" ? `<div class="stamp">PAID</div>` : isQuote && d.status === "accepted" ? `<div class="stamp">ACCEPTED</div>` : "";

  const body = `${o.before ?? ""}<main class="paper layout-${t.layout}">
    ${stamp}
    ${t.layout === "creative" ? `<i class="shape s1"></i><i class="shape s2"></i>` : ""}
    ${t.layout === "corporate" ? `<i class="topbar"></i>` : ""}
    ${header}
    ${parties}
    ${items}
    <div class="summary">
      <div class="summary-left">${seal}${words}${upi}${bank}${notes}</div>
      <table class="sums">${sums}</table>
    </div>
    ${hsnTable}
    <div class="foot">${terms}${sign}</div>
    ${footer ? `<footer>${footer}</footer>` : ""}
  </main>`;

  const C = t.colors;
  const zoom = o.zoom ?? 1;
  const headFill = t.layout === "modern" || t.layout === "band" ? C.accent : C.tableHeader;
  const headInk = t.layout === "modern" ? "#ffffff" : C.ink;
  const css = `
@page { size: ${pw}mm ${ph}mm; margin: ${t.margin}mm; }
*{box-sizing:border-box;margin:0;padding:0}
html{background:#e9e9ee}
body{font-family:${FONT_STACK[t.font]};font-size:${t.fontSize}pt;line-height:1.45;color:${C.ink};-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:24px 0}
@media screen{body{zoom:${zoom}}}
.paper{position:relative;width:${pw}mm;min-height:${ph}mm;margin:0 auto;padding:${t.margin}mm;background:#fff;box-shadow:0 1px 2px rgb(0 0 0/.06),0 12px 40px rgb(0 0 0/.12);overflow:hidden}
.muted{color:${C.muted}}
b{font-weight:600}
.label{font-size:.78em;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:${C.muted};margin-bottom:1.2mm}
.logo{max-height:${t.logo.height}mm;max-width:60mm;object-fit:contain;display:block;margin-bottom:3mm}
.head{display:flex;justify-content:space-between;gap:10mm;align-items:flex-start;margin-bottom:8mm}
.head-left{flex:1;min-width:0}
.head-right{text-align:right;flex-shrink:0}
.head-right .logo{margin-left:auto}
.biz-name{font-size:1.45em;font-weight:700;letter-spacing:-.01em;margin-bottom:1mm}
.doc-title{font-size:2.1em;font-weight:700;letter-spacing:-.02em;color:${C.accent};line-height:1.1;margin-bottom:3mm}
.meta{border-collapse:collapse;margin-left:auto}
.meta th{font-weight:500;color:${C.muted};text-align:left;padding:.6mm 4mm .6mm 0;white-space:nowrap}
.meta td{text-align:right;font-weight:600;padding:.6mm 0;white-space:nowrap}
.parties{display:flex;gap:8mm;margin-bottom:7mm}
.party{flex:1;min-width:0}
.party-name{font-weight:700;font-size:1.08em}
.party.extra{display:grid;gap:2mm;align-content:start}
.items{width:100%;border-collapse:collapse;margin-bottom:6mm}
.items thead{display:table-header-group}
.items tr{break-inside:avoid}
.items th{font-size:.8em;text-transform:uppercase;letter-spacing:.06em;text-align:left;font-weight:600;padding:2.4mm 2mm;background:${headFill};color:${headInk}}
.items td{padding:2.6mm 2mm;vertical-align:top;border-bottom:.25mm solid #e6e6e6}
.items .num,.hsn .num{text-align:right;white-space:nowrap}
.items th.num{text-align:right}
.c-sn{width:7mm;color:${C.muted}}
.c-hsn{white-space:nowrap}
.item-name{font-weight:600}
.item-desc{color:${C.muted};font-size:.92em;margin-top:.6mm}
.items-striped tbody tr:nth-child(even) td{background:color-mix(in srgb, ${C.tableHeader} 35%, #fff)}
.items-striped td{border-bottom:none}
.items-boxed th,.items-boxed td{border:.25mm solid #9a9a9a}
.items-minimal th{background:none;color:${C.muted};border-bottom:.35mm solid ${C.ink}}
.items-minimal td{border-bottom:.2mm solid #ececec}
.summary{display:flex;gap:10mm;align-items:flex-start;margin-bottom:6mm;break-inside:avoid}
.summary-left{flex:1;display:grid;gap:4mm;min-width:0}
.sums{border-collapse:collapse;min-width:72mm}
.sums th{text-align:left;font-weight:500;color:${C.muted};padding:1.2mm 6mm 1.2mm 0}
.sums td{text-align:right;padding:1.2mm 0;white-space:nowrap;font-variant-numeric:tabular-nums}
.sums .grand th,.sums .grand td{font-size:1.25em;font-weight:700;color:${C.ink};border-top:.4mm solid ${C.ink};padding-top:2.4mm}
.sums .balance th,.sums .balance td{font-weight:700;color:${C.accent}}
.sums .note td{text-align:right;font-size:.85em;color:${C.muted}}
.upi{display:flex;gap:4mm;align-items:center}
.upi svg{width:26mm;height:26mm;flex-shrink:0}
.hsn{width:100%;border-collapse:collapse;margin-bottom:6mm;font-size:.88em;break-inside:avoid}
.hsn th{background:${C.tableHeader};font-weight:600;text-align:left;padding:1.6mm 2mm;border:.2mm solid #d9d9d9}
.hsn td{padding:1.6mm 2mm;border:.2mm solid #d9d9d9}
.foot{display:flex;justify-content:space-between;gap:10mm;align-items:flex-end;break-inside:avoid}
.terms{flex:1;font-size:.9em}
.sign{text-align:center;min-width:52mm}
.sign img{max-height:16mm;max-width:50mm;display:block;margin:0 auto 1mm}
.sign-space{height:14mm}
.sign-line{border-top:.25mm solid ${C.ink};padding-top:1.4mm;font-weight:600}
footer{margin-top:8mm;padding-top:3mm;border-top:.25mm solid #e6e6e6;text-align:center;color:${C.muted};font-size:.85em}
.watermark{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:96pt;font-weight:800;color:rgb(0 0 0/.05);letter-spacing:.1em;pointer-events:none}
.stamp{justify-self:start;transform:rotate(-6deg);border:.7mm solid #15803d;color:#15803d;font-weight:800;font-size:16pt;letter-spacing:.15em;padding:.6mm 4mm;border-radius:2mm;opacity:.85}
/* Layout families */
.layout-classic .head{border-bottom:.4mm solid ${C.ink};padding-bottom:6mm}
.layout-modern .doc-title{font-size:2.6em}
.layout-modern .parties .party:first-child{border-left:1mm solid ${C.accent};padding-left:4mm}
.layout-modern .items th:first-child{border-radius:2mm 0 0 2mm}.layout-modern .items th:last-child{border-radius:0 2mm 2mm 0}
.layout-modern .sums .grand td{color:${C.accent}}
.layout-minimal .doc-title{color:${C.ink};font-weight:500;font-size:1.6em;letter-spacing:.02em}
.layout-minimal .biz-name{font-weight:600}
.layout-minimal .sums .grand th,.layout-minimal .sums .grand td{border-top:.2mm solid ${C.ink}}
.layout-band .band{display:flex;justify-content:space-between;align-items:center;gap:8mm;background:${C.accent};color:#fff;margin:-${t.margin}mm -${t.margin}mm 8mm;padding:${Math.max(8, t.margin)}mm ${t.margin}mm}
.layout-band .band .logo{margin:0 0 2mm;filter:none}
.layout-band .band .biz-name{font-size:1.6em}
.layout-band .band .doc-title{color:#fff;margin:0;text-align:right}
.layout-band .band-no{text-align:right;opacity:.85;font-weight:600}
.layout-band .items th{color:#fff}
.layout-elegant .head-center{flex-direction:column;align-items:center;text-align:center;border-bottom:.25mm solid ${C.accent};padding-bottom:5mm;margin-bottom:1.2mm}
.layout-elegant .head-center .logo{margin:0 auto 3mm}
.layout-elegant .title-row{display:flex;justify-content:space-between;align-items:flex-end;border-top:.25mm solid ${C.accent};padding-top:5mm;margin-bottom:8mm}
.layout-elegant .doc-title{font-weight:400;text-transform:uppercase;letter-spacing:.25em;font-size:1.5em;margin:0}
.layout-elegant .biz-name{font-weight:600;letter-spacing:.04em}
.head-center{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:5mm}
.title-row{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8mm}
.layout-compact .head{border:.25mm solid #9a9a9a;padding:3mm;margin-bottom:0}
.layout-compact .parties{border:.25mm solid #9a9a9a;border-top:none;padding:3mm;margin-bottom:0;gap:0}
.layout-compact .parties .party+.party{border-left:.25mm solid #9a9a9a;padding-left:3mm;margin-left:3mm}
.layout-compact .doc-title{font-size:1.4em;text-transform:uppercase;color:${C.ink}}
.layout-compact .items{margin-bottom:0}
.layout-compact .summary{border:.25mm solid #9a9a9a;border-top:none;padding:3mm;margin-bottom:0}
.layout-compact .hsn{margin-bottom:0}
.layout-compact .foot{border:.25mm solid #9a9a9a;border-top:none;padding:3mm}
.layout-corporate .topbar{position:absolute;top:0;left:0;right:0;height:3mm;background:${C.accent}}
@media print{.layout-corporate .head{padding-top:5mm}}
.layout-corporate .head-right{background:${C.tableHeader};padding:4mm 5mm;border-radius:2mm}
.layout-corporate .doc-title{font-size:1.6em}
.layout-creative .shape{position:absolute;border-radius:50%;background:${C.accent};opacity:.12;pointer-events:none}
.layout-creative .s1{width:90mm;height:90mm;top:-40mm;right:-30mm}
.layout-creative .s2{width:40mm;height:40mm;top:18mm;right:42mm;opacity:.08}
.layout-creative .doc-title{font-size:2.8em}
.layout-creative .sums .grand th,.layout-creative .sums .grand td{background:${C.accent};color:#fff;border:none;padding:3mm}
@media print{html,body{background:none;padding:0}.paper{width:auto;min-height:0;margin:0;padding:0;box-shadow:none;overflow:visible}.layout-band .band{margin:0 0 8mm}.no-print{display:none!important}}
${o.extraCss ?? ""}`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titleFor(d, t))} ${esc(d.number)}</title><style>${css}</style></head><body>${body}</body></html>`;
  return { html, totals };
}
