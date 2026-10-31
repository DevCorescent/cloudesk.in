"use client";

// The till: scan or tap items, take cash / UPI / card, print a receipt.
// USB and Bluetooth barcode scanners type the code and press Enter, so the
// scan box keeps focus; phones and tablets can scan with the camera where the
// browser supports BarcodeDetector. Every sale is an ordinary paid order.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, Camera, CheckCircle2, CreditCard, Minus, PackageSearch, Plus, Printer, QrCode, ReceiptText, ScanLine, Search, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog, Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, cx, EmptyState, ErrorState, IconButton, Input, Skeleton } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { normaliseGtin, qrSvg, upiPayUrl } from "@/lib/store/barcode";
import { formatMoney, minorDigits, parseMoney, toMajor } from "@/lib/store/money";
import { computeTotals } from "@/lib/store/pricing";
import { storeApi } from "./shared";

type PV = { id: string; title: string; sku: string; barcode: string; price: number; stock: number; trackInventory: boolean };
type PP = { id: string; title: string; slug: string; status: string; image: string; taxBps: number; variants: PV[] };
type Catalog = { store: { name: string; currency: string; pricesIncludeTax: boolean; defaultTaxBps: number; orderPrefix: string; upiId: string }; products: PP[]; siteUrl: string | null };
type Line = { variantId: string; quantity: number; unitPrice?: number };
type Method = "cash" | "upi" | "card";
type Sale = { order: { id: string; number: number; total: number; invoiceNumber: string | null }; duplicate: boolean; change: number };
type Summary = { sales: number; items: number; gross: number; refunds: number; tax: number; discounts: number; byMethod: Record<Method, number>; recent: { id: string; number: number; total: number; method: string; at: string; invoice: string | null; cancelled: boolean; customer: string }[] };

const newRef = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const METHOD_LABEL: Record<Method, string> = { cash: "Cash", upi: "UPI", card: "Card" };

function Svg({ html, className }: { html: string; className?: string }) {
  return <span className={cx("block [&>svg]:h-auto [&>svg]:w-full", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

function readCart(projectId: string): Line[] {
  try {
    const v = JSON.parse(localStorage.getItem(`pos-cart:${projectId}`) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => typeof l?.variantId === "string" && Number.isInteger(l.quantity) && l.quantity > 0) : [];
  } catch {
    return [];
  }
}

export function PosTerminal({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const q = useQuery({ queryKey: ["store", projectId, "pos"], queryFn: () => api<Catalog>(storeApi(projectId, "pos")) });
  if (project.isPending || q.isPending)
    return (
      <div className="grid h-dvh grid-cols-[1fr_380px] gap-4 p-4">
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    );
  if (project.isError) return <ErrorState title="Project unavailable" message={errorMessage(project.error)} onRetry={() => project.refetch()} />;
  if (q.isError)
    return (
      <div className="grid h-dvh place-items-center p-6">
        <ErrorState title="The till couldn't open" message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      </div>
    );
  return <Till projectId={projectId} catalog={q.data} canManage={project.data.permissions.includes("store:manage")} />;
}

function Till({ projectId, catalog, canManage }: { projectId: string; catalog: Catalog; canManage: boolean }) {
  const { store, products } = catalog;
  const cur = store.currency;
  const money = (n: number) => formatMoney(n, cur);
  const toast = useToast();
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  // The till only renders in the browser (after the catalog loads), so reading storage here is safe.
  const [cart, setCart] = useState<Line[]>(() => readCart(projectId));
  const [query, setQuery] = useState("");
  const [picker, setPicker] = useState<PP | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [discount, setDiscount] = useState<{ kind: "percent" | "fixed"; text: string }>({ kind: "percent", text: "" });
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [gstin, setGstin] = useState("");
  const [showCustomer, setShowCustomer] = useState(false);
  const [method, setMethod] = useState<Method>("cash");
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [clientRef, setClientRef] = useState(newRef);
  const [oversell, setOversell] = useState<string | null>(null);
  const [done, setDone] = useState<Sale | null>(null);
  const [camera, setCamera] = useState(false);
  const [summary, setSummary] = useState(false);
  const [mobileCart, setMobileCart] = useState(false);
  const [editPrice, setEditPrice] = useState<string | null>(null);
  const [bigQr, setBigQr] = useState(false);

  // The cart survives a refresh or a closed tab.
  useEffect(() => {
    try {
      localStorage.setItem(`pos-cart:${projectId}`, JSON.stringify(cart));
    } catch {
      /* private mode: the cart just won't persist */
    }
  }, [cart, projectId]);

  const variants = useMemo(() => {
    const m = new Map<string, { p: PP; v: PV }>();
    for (const p of products) for (const v of p.variants) m.set(v.id, { p, v });
    return m;
  }, [products]);

  const add = useCallback(
    (variantId: string, qty = 1) => {
      const hit = variants.get(variantId);
      if (!hit) return;
      setCart((c) => {
        const i = c.findIndex((l) => l.variantId === variantId);
        if (i < 0) return [...c, { variantId, quantity: qty }];
        return c.map((l, j) => (j === i ? { ...l, quantity: Math.min(10_000, l.quantity + qty) } : l));
      });
      setFlash(variantId);
      setTimeout(() => setFlash((f) => (f === variantId ? null : f)), 600);
    },
    [variants],
  );

  /** Barcode, SKU, or a product QR (its page URL). Local first; the server as a fallback for anything new. */
  const scan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      let qty = 1;
      let c = code;
      // "3*8901030865275" or "3x…" adds three.
      const m = /^(\d{1,4})\s*[*x×]\s*(.+)$/i.exec(code);
      if (m) {
        qty = Math.max(1, Number(m[1]));
        c = m[2].trim();
      }
      if (/^https?:\/\//i.test(c)) {
        try {
          const u = new URL(c);
          const v = u.searchParams.get("v");
          if (v && variants.has(v)) return add(v, qty);
          const slug = decodeURIComponent(/\/product\/([^/?#]+)/.exec(u.pathname)?.[1] ?? "");
          const p = products.find((x) => x.slug === slug);
          if (p) return p.variants.length === 1 ? add(p.variants[0].id, qty) : setPicker(p);
        } catch {
          /* not a URL after all */
        }
      } else {
        const g = normaliseGtin(c);
        const lower = c.toLowerCase();
        for (const p of products)
          for (const v of p.variants)
            if ((v.barcode && (v.barcode === g || v.barcode === c)) || (v.sku && v.sku.toLowerCase() === lower)) return add(v.id, qty);
      }
      try {
        const r = await api<{ match: { variantId: string | null; productId: string; ambiguous: boolean } | null }>(storeApi(projectId, `pos/lookup?code=${encodeURIComponent(c)}`));
        if (r.match?.variantId && variants.has(r.match.variantId)) return add(r.match.variantId, qty);
        const p = r.match && products.find((x) => x.id === r.match!.productId);
        if (p) return setPicker(p);
        if (r.match) {
          // Exists but isn't in this till's list yet (just added elsewhere).
          await qc.invalidateQueries({ queryKey: ["store", projectId, "pos"] });
          return toast({ tone: "info", title: "Refreshing products", description: "Scan again in a moment." });
        }
      } catch (e) {
        return toast({ tone: "error", title: "Couldn't look that up", description: errorMessage(e) });
      }
      toast({ tone: "error", title: "No product with that code", description: c.length > 60 ? `${c.slice(0, 60)}…` : c });
    },
    [add, products, projectId, qc, toast, variants],
  );

  const lines = cart.filter((l) => variants.has(l.variantId));
  const priceOf = (l: Line) => l.unitPrice ?? variants.get(l.variantId)!.v.price;
  const discountValue = discount.text ? (discount.kind === "percent" ? Math.min(100, Math.max(0, Number(discount.text) || 0)) : (parseMoney(discount.text, cur) ?? 0)) : 0;
  const totals = computeTotals({
    lines: lines.map((l, i) => ({ key: String(i), unitPrice: priceOf(l), quantity: l.quantity, taxBps: variants.get(l.variantId)!.p.taxBps, weightGrams: 0 })),
    discount: discountValue > 0 ? { kind: discount.kind, value: discountValue, minSubtotal: 0, code: "POS" } : null,
    shipping: 0,
    pricesIncludeTax: store.pricesIncludeTax,
  });
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const tenderedMinor = tendered ? parseMoney(tendered, cur) : null;
  const change = method === "cash" && tenderedMinor !== null ? tenderedMinor - totals.total : 0;
  const cashShort = method === "cash" && tenderedMinor !== null && tenderedMinor < totals.total;

  const reset = () => {
    setCart([]);
    setDiscount({ kind: "percent", text: "" });
    setCustomer({ name: "", phone: "", email: "" });
    setGstin("");
    setShowCustomer(false);
    setTendered("");
    setReference("");
    setMethod("cash");
    setClientRef(newRef());
    setDone(null);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  const sale = useMutation({
    mutationFn: (allowOversell: boolean) =>
      api<Sale>(storeApi(projectId, "pos/sale"), {
        method: "POST",
        body: {
          lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, ...(l.unitPrice !== undefined ? { unitPrice: l.unitPrice } : {}) })),
          discount: discountValue > 0 ? { kind: discount.kind, value: discountValue } : null,
          customer,
          payment: { method, tendered: method === "cash" ? (tenderedMinor ?? totals.total) : undefined, reference },
          buyerGstin: gstin,
          allowOversell,
          clientRef,
        },
      }),
    onSuccess: (r) => {
      setOversell(null);
      setDone(r);
      setCart([]);
      qc.invalidateQueries({ queryKey: ["store", projectId] });
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 409 && /stock/i.test(e.message)) return setOversell(e.message);
      setOversell(null);
      toast({ tone: "error", title: "Sale not completed", description: errorMessage(e) });
    },
  });
  const charge = () => {
    if (!lines.length || sale.isPending) return;
    if (cashShort) return toast({ tone: "error", title: "Cash received is less than the total" });
    sale.mutate(false);
  };

  // A scanner "types" into whatever has focus, so stray keystrokes go to the
  // scan box. Scanning while "Sale complete" is showing starts the next sale.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const box = scanRef.current;
      if (!box || e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable=true]")) return;
      if (t.closest("dialog[open]") && !done) return;
      if (e.key === "Enter") {
        if (!box.value) return;
        e.preventDefault();
        const code = box.value;
        box.value = "";
        if (done) reset();
        void scan(code);
        return;
      }
      if (e.key.length !== 1) return;
      // Write the key ourselves: moving focus mid-keystroke can drop the first character.
      e.preventDefault();
      if (done && !box.value) reset();
      box.value += e.key;
      box.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ⌘/Ctrl+Enter charges (or starts the next sale).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (done) reset();
        else charge();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const needle = query.trim().toLowerCase();
  const shown = needle ? products.filter((p) => p.title.toLowerCase().includes(needle) || p.variants.some((v) => v.sku.toLowerCase().includes(needle) || v.barcode.includes(needle))) : products;
  const inCart = (id: string) => lines.find((l) => l.variantId === id)?.quantity ?? 0;
  const upiQr = method === "upi" && store.upiId && cur === "INR" && totals.total > 0 ? qrSvg(upiPayUrl({ vpa: store.upiId, name: store.name, amountMinor: totals.total, note: `Bill at ${store.name}`, ref: clientRef.replace(/-/g, "").slice(0, 20) }), { label: "Scan to pay with UPI" }) : "";
  // Quick cash buttons: exact, then the next round notes above the total.
  const unit = 10 ** minorDigits(cur);
  const quick = [totals.total, ...[10, 50, 100, 500, 1000, 2000].map((n) => Math.ceil(totals.total / (n * unit)) * n * unit)].filter((v, i, a) => v >= totals.total && a.indexOf(v) === i).slice(0, 4);

  const cartPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <ShoppingCart className="size-4" /> Current sale {count > 0 && <Badge>{count}</Badge>}
        </h2>
        <div className="flex items-center gap-1">
          {lines.length > 0 && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setCart([])}>
              Clear
            </Button>
          )}
          <IconButton className="lg:hidden" size="sm" label="Close cart" icon={<X className="size-4" />} onClick={() => setMobileCart(false)} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {!lines.length ? (
          <div className="grid h-full place-items-center px-6 py-10 text-center">
            <div>
              <ScanLine className="mx-auto size-8 text-subtle" />
              <p className="mt-3 text-[14px] font-medium">Scan an item to start</p>
              <p className="mt-1 text-[12px] text-muted">Use a barcode scanner, the camera, or tap a product.</p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {lines.map((l) => {
              const { p, v } = variants.get(l.variantId)!;
              const over = v.trackInventory && l.quantity > v.stock;
              return (
                <li key={l.variantId} className={cx("rounded-[12px] px-2 py-2 transition-colors", flash === l.variantId ? "bg-accent/10" : "hover:bg-surface-2")}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{p.title}</p>
                      <p className="truncate text-[11px] text-muted">
                        {v.title !== "Default" && `${v.title} · `}
                        {editPrice === l.variantId ? null : (
                          <button type="button" disabled={!canManage} title={canManage ? "Change price" : undefined} className={cx(canManage && "underline decoration-dotted underline-offset-2 hover:text-fg")} onClick={() => setEditPrice(l.variantId)}>
                            {money(priceOf(l))}
                          </button>
                        )}
                        {l.unitPrice !== undefined && editPrice !== l.variantId && <span className="ml-1 line-through">{money(v.price)}</span>}
                      </p>
                      {editPrice === l.variantId && (
                        <form
                          className="mt-1 flex gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const n = parseMoney(new FormData(e.currentTarget).get("price") as string, cur);
                            if (n !== null && n >= 0) setCart((c) => c.map((x) => (x.variantId === l.variantId ? { ...x, unitPrice: n === v.price ? undefined : n } : x)));
                            setEditPrice(null);
                          }}
                        >
                          <Input name="price" autoFocus defaultValue={toMajor(priceOf(l), cur)} inputMode="decimal" className="!h-7 text-[12px]" aria-label="New price" />
                          <Button size="sm" type="submit">Set</Button>
                        </form>
                      )}
                      {over && <p className="mt-0.5 text-[11px] text-warning">Only {Math.max(0, v.stock)} in stock</p>}
                    </div>
                    <div className="flex items-center gap-0.5">
                      <IconButton size="sm" label="One less" icon={<Minus className="size-3.5" />} onClick={() => setCart((c) => c.flatMap((x) => (x.variantId === l.variantId ? (x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : []) : [x])))} />
                      <input
                        aria-label={`Quantity of ${p.title}`}
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => {
                          const n = Math.min(10_000, Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)));
                          setCart((c) => (n ? c.map((x) => (x.variantId === l.variantId ? { ...x, quantity: n } : x)) : c.filter((x) => x.variantId !== l.variantId)));
                        }}
                        className="h-7 w-10 rounded-md bg-surface-2 text-center text-[13px] tabular-nums"
                      />
                      <IconButton size="sm" label="One more" icon={<Plus className="size-3.5" />} onClick={() => add(l.variantId)} />
                    </div>
                    <p className="w-20 pt-1 text-right text-[13px] font-medium tabular-nums">{money(priceOf(l) * l.quantity)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Segmented label="Discount type" value={discount.kind} onChange={(k) => setDiscount({ ...discount, kind: k })} options={[{ value: "percent", label: "%" }, { value: "fixed", label: cur }]} />
          <Input value={discount.text} onChange={(e) => setDiscount({ ...discount, text: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Discount" inputMode="decimal" className="!h-8 flex-1" aria-label="Discount" />
          <Button size="sm" variant={showCustomer || customer.name || customer.phone ? "secondary" : "ghost"} icon={<UserRound className="size-3.5" />} onClick={() => setShowCustomer(!showCustomer)}>
            {customer.name || "Customer"}
          </Button>
        </div>
        {showCustomer && (
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} aria-label="Customer name" />
            <Input placeholder="Phone" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} aria-label="Customer phone" />
            <Input placeholder="Email (for an e-receipt)" type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value.trim() })} aria-label="Customer email" className="col-span-2" />
            {cur === "INR" && <Input placeholder="Buyer GSTIN (B2B invoice)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().slice(0, 15))} aria-label="Buyer GSTIN" className="col-span-2" />}
          </div>
        )}
        <dl className="space-y-1 text-[13px]">
          <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="tabular-nums">{money(totals.subtotal)}</dd></div>
          {totals.discount > 0 && <div className="flex justify-between text-muted"><dt>Discount</dt><dd className="tabular-nums">−{money(totals.discount)}</dd></div>}
          <div className="flex justify-between text-muted"><dt>{cur === "INR" ? "GST" : "Tax"}{totals.taxIncluded ? " (included)" : ""}</dt><dd className="tabular-nums">{money(totals.tax)}</dd></div>
          <div className="flex items-baseline justify-between pt-1 text-[22px] font-semibold tracking-tight"><dt>Total</dt><dd className="tabular-nums">{money(totals.total)}</dd></div>
        </dl>
        <Segmented
          label="Payment method"
          value={method}
          onChange={setMethod}
          options={[
            { value: "cash", label: <><Banknote className="size-3.5" /> Cash</> },
            { value: "upi", label: <><QrCode className="size-3.5" /> UPI</> },
            { value: "card", label: <><CreditCard className="size-3.5" /> Card</> },
          ]}
        />
        {method === "cash" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {quick.map((v, i) => (
                <button key={v} type="button" onClick={() => setTendered(String(toMajor(v, cur)))} className="h-7 rounded-full border border-border px-2.5 text-[12px] tabular-nums hover:bg-surface-2">
                  {i === 0 ? "Exact" : money(v).replace(/[.,]00$/, "")}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))} placeholder={`Cash received (${toMajor(totals.total, cur)})`} inputMode="decimal" aria-label="Cash received" className="flex-1" />
              <p className={cx("w-32 text-right text-[13px] tabular-nums", cashShort ? "text-danger" : "text-muted")}>{tenderedMinor === null ? "" : cashShort ? `Short ${money(-change)}` : `Change ${money(change)}`}</p>
            </div>
          </div>
        )}
        {method === "upi" && (
          <div className="flex gap-3">
            {upiQr ? (
              <button type="button" onClick={() => setBigQr(true)} title="Show larger" className="w-28 shrink-0 rounded-lg bg-white p-1">
                <Svg html={upiQr} />
              </button>
            ) : null}
            <div className="min-w-0 flex-1 space-y-2 text-[12px] text-muted">
              {upiQr ? (
                <p>Customer scans to pay <b className="text-fg">{money(totals.total)}</b> to {store.upiId}. Check the payment arrived in your UPI app before completing — the till can&apos;t see UPI payments.</p>
              ) : store.upiId ? (
                <p>Add items to show the UPI QR.</p>
              ) : (
                <p>Add your UPI ID in Store → Payments → “UPI / bank transfer” to show a pay-by-QR code here.</p>
              )}
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI reference / UTR (optional)" aria-label="UPI reference" />
            </div>
          </div>
        )}
        {method === "card" && (
          <div className="space-y-2 text-[12px] text-muted">
            <p>Take the payment on your card machine first, then complete the sale.</p>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Approval code or last 4 digits (optional)" aria-label="Card reference" />
          </div>
        )}
        <Button variant="primary" size="lg" className="w-full !h-12 text-[15px]" disabled={!lines.length || cashShort} loading={sale.isPending} onClick={charge}>
          {lines.length ? `Complete sale · ${money(totals.total)}` : "Complete sale"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="glass-strong flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4">
        <Link href={`/projects/${projectId}/store`} className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
          <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Store</span>
        </Link>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight">{store.name}</p>
          <p className="text-[11px] text-muted">Point of sale</p>
        </div>
        <form
          className="relative ml-auto flex max-w-xl flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const v = scanRef.current?.value ?? "";
            if (scanRef.current) scanRef.current.value = "";
            void scan(v);
          }}
        >
          <ScanLine className="pointer-events-none absolute left-3 size-4 text-subtle" />
          <input ref={scanRef} autoFocus aria-label="Scan or type a barcode, SKU or product QR" placeholder="Scan barcode or type SKU, then Enter" autoComplete="off" spellCheck={false} className="h-9 w-full rounded-full border border-border bg-surface-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
        </form>
        <IconButton label="Scan with camera" icon={<Camera className="size-4" />} onClick={() => setCamera(true)} />
        <Button size="sm" variant="ghost" icon={<ReceiptText className="size-3.5" />} onClick={() => setSummary(true)}>
          <span className="hidden sm:inline">Today</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-4 pt-4">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${products.length} products`} className="pl-9" aria-label="Search products" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 lg:pb-4">
            {!products.length ? (
              <EmptyState icon={<PackageSearch className="size-5" />} title="No products to sell yet" description="Add or import products in your store. Sample products don't appear at the till." action={<Link className="text-[13px] font-medium text-accent" href={`/projects/${projectId}/store/products`}>Go to products</Link>} className="py-20" />
            ) : !shown.length ? (
              <p className="py-16 text-center text-[13px] text-muted">Nothing matches “{query}”.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {shown.map((p) => {
                  const stock = p.variants.reduce((n, v) => n + (v.trackInventory ? Math.max(0, v.stock - inCart(v.id)) : Infinity), 0);
                  const prices = p.variants.map((v) => v.price);
                  const lo = Math.min(...prices);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => (p.variants.length === 1 ? add(p.variants[0].id) : setPicker(p))}
                      className="glass-card group flex flex-col overflow-hidden rounded-[18px] text-left transition-transform duration-150 active:scale-[0.97]"
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
                        {p.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- product photo from the store's own media
                          <img src={p.image} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        ) : (
                          <span className="grid size-full place-items-center text-[28px] font-semibold text-subtle">{p.title.slice(0, 1)}</span>
                        )}
                        {p.status !== "active" && <Badge className="absolute top-2 left-2">{p.status}</Badge>}
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-2 text-[13px] leading-snug font-medium">{p.title}</p>
                        <div className="mt-1 flex items-center justify-between text-[12px]">
                          <span className="font-semibold tabular-nums">{p.variants.length > 1 && lo !== Math.max(...prices) ? `From ${money(lo)}` : money(lo)}</span>
                          <span className={cx("tabular-nums", stock === 0 ? "text-danger" : stock < 5 ? "text-warning" : "text-muted")}>{stock === Infinity ? "" : stock === 0 ? "Out of stock" : `${stock} left`}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>
        <aside className={cx("glass-strong w-full border-l border-border lg:static lg:block lg:w-[400px] lg:shrink-0", mobileCart ? "fixed inset-0 z-40 block" : "hidden")}>{cartPanel}</aside>
      </div>

      {!mobileCart && (
        <button type="button" onClick={() => setMobileCart(true)} className="fixed inset-x-4 bottom-4 z-30 flex h-12 items-center justify-between rounded-full bg-fg px-5 text-[14px] font-medium text-bg shadow-lg lg:hidden">
          <span className="flex items-center gap-2"><ShoppingCart className="size-4" /> {count} item{count === 1 ? "" : "s"}</span>
          <span className="tabular-nums">{money(totals.total)}</span>
        </button>
      )}

      <Dialog open={!!picker} onClose={() => setPicker(null)} title={picker?.title ?? ""} description="Choose a variant" size="sm">
        <div className="grid gap-1.5">
          {picker?.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                add(v.id);
                setPicker(null);
              }}
              className="flex items-center justify-between rounded-[12px] border border-border px-3 py-2.5 text-left text-[13px] hover:bg-surface-2"
            >
              <span className="font-medium">{v.title}</span>
              <span className="flex items-center gap-3 tabular-nums">
                {v.trackInventory && <span className={cx("text-[12px]", v.stock - inCart(v.id) <= 0 ? "text-danger" : "text-muted")}>{Math.max(0, v.stock - inCart(v.id))} left</span>}
                {money(v.price)}
              </span>
            </button>
          ))}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!oversell}
        onClose={() => setOversell(null)}
        onConfirm={() => sale.mutate(true)}
        loading={sale.isPending}
        title="Sell more than the recorded stock?"
        description={<>{oversell}. If the items are really on the counter, you can sell them anyway — stock will go below zero until you correct it in Inventory.</>}
        confirmLabel="Sell anyway"
      />

      {/* The native close event lands a moment after "New sale" or a scan has already reset; don't reset (and empty the new cart) twice. */}
      <Dialog open={!!done} onClose={() => done && reset()} title="Sale complete" size="sm">
        {done && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto size-12 text-success" />
            <p className="mt-3 text-[28px] font-semibold tracking-tight tabular-nums">{money(done.order.total)}</p>
            {done.change > 0 && <p className="mt-1 text-[17px] font-medium">Give change: <span className="tabular-nums">{money(done.change)}</span></p>}
            <p className="mt-1 text-[12px] text-muted">{done.order.invoiceNumber ?? `Order ${store.orderPrefix}${done.order.number}`}{done.duplicate ? " · already recorded" : ""}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button icon={<Printer className="size-3.5" />} onClick={() => window.open(storeApi(projectId, `pos/receipt/${done.order.id}`), "_blank", "noopener,width=420,height=720")}>
                Receipt
              </Button>
              <Button variant="primary" onClick={reset} autoFocus>
                New sale
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={bigQr && !!upiQr} onClose={() => setBigQr(false)} title={`Pay ${money(totals.total)}`} description={`Scan with any UPI app · ${store.upiId}`} size="sm">
        <Svg html={upiQr} className="mx-auto max-w-[320px] rounded-xl bg-white p-2" />
      </Dialog>

      {camera && <CameraScanner onClose={() => setCamera(false)} onCode={(c) => void scan(c)} />}
      {summary && <TodaySummary projectId={projectId} currency={cur} onClose={() => setSummary(false)} />}
    </div>
  );
}

// ─── Camera scanning ─────────────────────────────────────────────────────────

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

function CameraScanner({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  const [error, setError] = useState<string | null>(Ctor ? null : "This browser can't read barcodes from the camera. Use Chrome on Android or a desktop, or plug in a USB / Bluetooth barcode scanner — they work in any browser.");
  const [last, setLast] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const recent = new Map<string, number>();
    (async () => {
      try {
        const supported = (await Ctor.getSupportedFormats?.()) ?? [];
        const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"].filter((f) => !supported.length || supported.includes(f));
        const detector = new Ctor({ formats });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            for (const r of await detector.detect(video.current)) {
              const now = Date.now();
              // The same code stays in view for a while: count it once every 1.5 s.
              if ((recent.get(r.rawValue) ?? 0) > now - 1500) continue;
              recent.set(r.rawValue, now);
              setLast(r.rawValue);
              navigator.vibrate?.(40);
              onCodeRef.current(r.rawValue);
            }
          } catch {
            /* a frame that couldn't be read */
          }
          timer = setTimeout(tick, 200);
        };
        void tick();
      } catch (e) {
        setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site in your browser settings and try again." : "Couldn't start the camera.");
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [Ctor]);

  return (
    <Dialog open onClose={onClose} title="Scan with camera" description="Hold the barcode or QR code steady in the frame. Items are added as they're read." size="md">
      {error ? (
        <p className="rounded-[12px] bg-surface-2 p-4 text-[13px] text-muted">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-[16px] bg-black">
          <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-[12px] border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        </div>
      )}
      {last && <p className="mt-3 text-center font-mono text-[12px] text-muted">Last read: {last.length > 60 ? `${last.slice(0, 60)}…` : last}</p>}
    </Dialog>
  );
}

// ─── Today ───────────────────────────────────────────────────────────────────

function TodaySummary({ projectId, currency, onClose }: { projectId: string; currency: string; onClose: () => void }) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const q = useQuery({ queryKey: ["store", projectId, "pos-summary", day], queryFn: () => api<Summary>(storeApi(projectId, `pos/summary?day=${day}&tz=${now.getTimezoneOffset()}`)) });
  const money = (n: number) => formatMoney(n, currency);
  const s = q.data;
  return (
    <Dialog open onClose={onClose} title="Today at the till" description={now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} size="lg">
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Net sales", money(s.gross - s.refunds)],
              ["Sales", String(s.sales)],
              ["Items sold", String(s.items)],
              [currency === "INR" ? "GST collected" : "Tax", money(s.tax)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[14px] bg-surface-2 p-3">
                <p className="text-[11px] text-muted">{k}</p>
                <p className="mt-1 text-[18px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted">By payment method (after refunds) — count your drawer against Cash</p>
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "upi", "card"] as const).map((m) => (
                <div key={m} className="rounded-[14px] border border-border p-3">
                  <p className="text-[12px] text-muted">{METHOD_LABEL[m]}</p>
                  <p className="text-[15px] font-semibold tabular-nums">{money(s.byMethod[m] ?? 0)}</p>
                </div>
              ))}
            </div>
            {(s.discounts > 0 || s.refunds > 0) && <p className="mt-2 text-[12px] text-muted">Discounts given {money(s.discounts)} · Refunds {money(s.refunds)}</p>}
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium text-muted">Recent sales</p>
            {!s.recent.length ? (
              <p className="rounded-[12px] bg-surface-2 p-4 text-center text-[13px] text-muted">No sales yet today.</p>
            ) : (
              <ul className="divide-y divide-border rounded-[14px] border border-border">
                {s.recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="w-[72px] shrink-0 whitespace-nowrap text-muted tabular-nums">{new Date(r.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="min-w-0 flex-1 truncate">{r.invoice ?? `#${r.number}`}{r.customer && r.customer !== "Walk-in customer" ? ` · ${r.customer}` : ""}</span>
                    <Badge>{METHOD_LABEL[r.method as Method] ?? r.method}</Badge>
                    {r.cancelled && <Badge tone="danger">Cancelled</Badge>}
                    <span className="w-24 text-right font-medium tabular-nums">{money(r.total)}</span>
                    <a href={storeApi(projectId, `pos/receipt/${r.id}`)} target="_blank" rel="noopener" className="text-muted hover:text-fg" aria-label="Open receipt">
                      <Printer className="size-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
