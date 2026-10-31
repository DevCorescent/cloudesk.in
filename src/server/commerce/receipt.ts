// An 80 mm till receipt for counter sales: compact, monochrome, printable on
// thermal printers (or as a PDF from the browser's print dialog).
import QRCode from "qrcode";
import { esc } from "@/lib/site/html";
import { splitTax } from "@/lib/store/gst";
import { formatMoney } from "@/lib/store/money";
import { notFound } from "../http/errors";
import { getStore } from "./catalog";
import { getOrder, orderLabel } from "./orders";

export async function receiptHtml(projectId: string, orderId: string, opts: { siteUrl?: string } = {}) {
  const store = await getStore(projectId);
  if (!store) throw notFound("Store");
  const { order: o, items } = await getOrder(projectId, orderId);
  const m = (n: number) => esc(formatMoney(n, o.currency));
  const pos = (o.pos ?? {}) as { method?: string; tendered?: number | null; change?: number; staffName?: string };
  const a = (store.address ?? {}) as Record<string, string>;
  const india = store.country === "IN" && o.currency === "INR";
  const gst = splitTax(o.taxTotal, true);
  const gstin = store.taxId;
  const qr = opts.siteUrl ? await QRCode.toString(opts.siteUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : "";
  const when = (o.paidAt ?? o.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const rows = items
    .map((i) => `<tr><td colspan="3">${esc(i.title)}${i.variantTitle ? ` <span class="m">${esc(i.variantTitle)}</span>` : ""}</td></tr><tr class="q"><td>${i.quantity} × ${m(i.unitPrice)}</td><td></td><td class="r">${m(i.total)}</td></tr>`)
    .join("");
  const line = (k: string, v: string, cls = "") => `<tr class="${cls}"><td colspan="2">${k}</td><td class="r">${v}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(o.invoiceNumber ?? orderLabel(store.orderPrefix, o.number))}</title><style>
@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}
body{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#000;width:72mm;margin:12px auto;padding:0}
h1{font:700 16px/1.2 system-ui,-apple-system,sans-serif;margin:0 0 2px;text-align:center}.c{text-align:center}.m{color:#444}
hr{border:0;border-top:1px dashed #000;margin:8px 0}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}
tr.q td{padding-bottom:4px}tr.t td{font-weight:700;font-size:15px;padding-top:4px}.qr{width:28mm;margin:8px auto 0}.qr svg{width:100%;height:auto}
.p{margin:16px 0;text-align:center}.p button{font:600 13px system-ui;padding:8px 18px;border-radius:99px;border:1px solid #000;background:#000;color:#fff;cursor:pointer}@media print{.p{display:none}body{margin:0 auto}}
</style></head><body>
<h1>${esc(store.name)}</h1>
<div class="c m">${[a.line1, a.line2, a.city, store.region, a.postalCode].filter(Boolean).map(esc).join(", ")}</div>
${store.phone ? `<div class="c m">${esc(store.phone)}</div>` : ""}${gstin ? `<div class="c m">GSTIN ${esc(gstin)}</div>` : ""}
<hr><div>${india ? "Tax invoice" : "Receipt"} ${esc(o.invoiceNumber ?? "")}</div><div class="m">${esc(orderLabel(store.orderPrefix, o.number))} · ${esc(when)}</div>
${o.buyerGstin ? `<div class="m">Buyer GSTIN ${esc(o.buyerGstin)}</div>` : ""}${(o.shippingAddress as { name?: string }).name && (o.shippingAddress as { name?: string }).name !== "Walk-in customer" ? `<div class="m">Customer: ${esc((o.shippingAddress as { name?: string }).name!)}</div>` : ""}
<hr><table>${rows}</table><hr><table>
${line("Subtotal", m(o.subtotal))}${o.discountTotal ? line("Discount", `−${m(o.discountTotal)}`) : ""}
${o.taxTotal ? (india ? line(`CGST${o.taxIncluded ? " (incl.)" : ""}`, m(gst.cgst)) + line(`SGST${o.taxIncluded ? " (incl.)" : ""}`, m(gst.sgst)) : line(o.taxIncluded ? "Tax (incl.)" : "Tax", m(o.taxTotal))) : ""}
${line("Total", m(o.total), "t")}
${o.refundedTotal ? line("Refunded", `−${m(o.refundedTotal)}`) : ""}
</table><hr><table>
${line(`Paid by ${pos.method === "upi" ? "UPI" : pos.method === "card" ? "card" : "cash"}`, m(pos.method === "cash" && pos.tendered ? pos.tendered : o.total))}
${pos.method === "cash" && pos.change ? line("Change", m(pos.change)) : ""}
</table>
${pos.staffName ? `<div class="m">Served by ${esc(pos.staffName.split(" ")[0])}</div>` : ""}
<hr><div class="c">Thank you for shopping with us!</div>${qr ? `<div class="qr">${qr}</div><div class="c m">Shop online any time</div>` : ""}
<div class="p"><button onclick="print()">Print receipt</button></div>
</body></html>`;
}
