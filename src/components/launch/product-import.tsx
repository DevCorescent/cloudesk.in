"use client";

// Drop any spreadsheet of products; we read it in the browser, recognise the
// columns, build products and highlight exactly what each one still needs.
import clsx from "clsx";
import { AlertCircle, ArrowRight, Check, ChevronDown, ChevronUp, Download, FileSpreadsheet, ImageOff, ImagePlus, Search, Sparkles, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { buildProducts, FIELD_LABEL, IMPORT_FIELDS, isReady, issuesFor, parseMoney, type DraftProduct, type Mapping } from "@/lib/store/import";
import { minorDigits } from "@/lib/store/money";
import { ACCEPT, readProductSheet, type Sheet } from "@/lib/store/read-sheet";

type Analysis = { fileName: string; sheets: Sheet[]; sheet: string; headerRow: number; headers: string[]; rows: unknown[][]; mapping: Mapping[]; broken?: string[] };

/** Loads each image (8 at a time, 8 s each) and returns the ones that fail. */
async function findBrokenImages(urls: string[], onProgress: (n: number) => void) {
  const broken = new Set<string>();
  let done = 0;
  const check = (u: string) =>
    new Promise<void>((resolve) => {
      const img = new Image();
      const t = setTimeout(() => {
        broken.add(u);
        resolve();
      }, 8000);
      img.onload = () => {
        clearTimeout(t);
        if (!img.naturalWidth) broken.add(u);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(t);
        broken.add(u);
        resolve();
      };
      img.referrerPolicy = "no-referrer";
      img.src = u;
    }).then(() => onProgress(++done));
  const queue = urls.slice(0, 400);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) await check(queue.shift()!);
  }));
  return broken;
}

/** Applies the photo check to built products. */
export function withPhotoCheck(products: DraftProduct[], broken: string[] = []) {
  if (!broken.length) return products;
  const bad = new Set(broken);
  return products.map((p) => {
    const lost = p.images.filter((u) => bad.has(u));
    if (!lost.length) return p;
    const c = { ...p, images: p.images.filter((u) => !bad.has(u)), brokenImages: lost };
    return { ...c, issues: issuesFor(c) };
  });
}

const SAMPLE = `Product name,Category,Size,Colour,MRP,Selling price,Stock,Image link,Description
Linen Shirt,Shirts,M,White,2499,1899,8,https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf,Breathable linen shirt with a relaxed fit.
Linen Shirt,Shirts,L,White,2499,1899,5,https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf,
Canvas Tote,Bags,,,999,699,20,https://images.unsplash.com/photo-1591561954557-26941169b49e,Sturdy cotton tote with an inner pocket.
`;

function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "products-template.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

/** Step 1: the drop zone. */
export function ProductDrop({ onRead, busy }: { onRead: (a: Analysis) => void; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = async (file: File) => {
    setError(null);
    setReading(file.name);
    try {
      const { sheets, best } = await readProductSheet(file);
      const { findHeaderRow, guessMapping } = await import("@/lib/store/import");
      const h = findHeaderRow(best.grid);
      const headers = (best.grid[h] ?? []).map((c, i) => String(c ?? "").trim() || `Column ${i + 1}`);
      const rows = best.grid.slice(h + 1).filter((r) => r.some((c) => String(c ?? "").trim()));
      const mapping = guessMapping(headers, rows);
      // Check photo links now, so a broken link never becomes a blank tile in the shop.
      const imgCols = mapping.map((m, i) => (m.field === "images" ? i : -1)).filter((i) => i >= 0);
      const { extractImages } = await import("@/lib/store/import");
      const urls = [...new Set(rows.flatMap((r) => imgCols.flatMap((i) => extractImages(r[i]))))];
      const broken = urls.length ? await findBrokenImages(urls, (n) => setReading(`${file.name} · checking photos ${n}/${urls.length}`)) : new Set<string>();
      onRead({ fileName: file.name, sheets, sheet: best.name, headerRow: h, headers, rows, mapping, broken: [...broken] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't read that file.");
    } finally {
      setReading(null);
    }
  };
  return (
    <div className="grid gap-3">
      <button
        type="button"
        disabled={busy || !!reading}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }}
        className={clsx("lx-drop group relative grid min-h-[230px] place-items-center overflow-hidden rounded-[24px] border-2 border-dashed p-8 text-center transition-all duration-300", over ? "scale-[1.01] border-accent bg-accent-soft" : "border-border-strong hover:border-accent/60 hover:bg-surface-2/60")}
      >
        {reading ? (
          <div className="grid justify-items-center gap-3">
            <div className="lx-scan relative grid size-16 place-items-center rounded-2xl bg-accent text-accent-fg">
              <FileSpreadsheet className="size-7" />
            </div>
            <p className="text-[15px] font-semibold">Reading {reading}…</p>
            <p className="text-[13px] text-muted">Finding your products, prices and photos</p>
          </div>
        ) : (
          <div className="grid justify-items-center gap-3">
            <div className="lx-float grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-[#3a3a3c] to-black text-white shadow-[0_18px_40px_-16px_rgb(0_0_0/.5)] dark:from-white dark:to-[#c7c7cc] dark:text-black">
              <Upload className="size-7" />
            </div>
            <p className="text-[17px] font-semibold tracking-tight">Drop your product list here</p>
            <p className="max-w-md text-[13px] text-muted">Any Excel or CSV — your own headings are fine. We&apos;ll find names, prices, MRP, stock, sizes, colours, categories and photo links automatically.</p>
            <div className="flex flex-wrap justify-center gap-1.5 pt-1">
              {["XLSX", "XLS", "CSV", "TSV", "ODS", "Numbers", "Shopify", "WooCommerce"].map((f) => (
                <span key={f} className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted">
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void read(f);
          }}
        />
      </button>
      {error && (
        <p className="flex items-center gap-1.5 text-[13px] text-danger" role="alert">
          <AlertCircle className="size-4" /> {error}
        </p>
      )}
      <button type="button" onClick={downloadSample} className="inline-flex items-center gap-1.5 justify-self-center text-[12px] text-muted hover:text-fg">
        <Download className="size-3.5" /> No list yet? Download a template to fill in
      </button>
    </div>
  );
}

/** Step 2: what we understood, and the products with what each one still needs. */
export function ProductReview({ analysis, setAnalysis, products, setProducts, currency }: { analysis: Analysis; setAnalysis: (a: Analysis | null) => void; products: DraftProduct[]; setProducts: (p: DraftProduct[]) => void; currency: string }) {
  const digits = minorDigits(currency);
  const [filter, setFilter] = useState<"attention" | "all" | "ready">(products.some((p) => !isReady(p)) ? "attention" : "all");
  const [q, setQ] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [limit, setLimit] = useState(40);
  const ready = products.filter(isReady).length;
  const attention = products.length - ready;
  const noPhoto = products.filter((p) => !p.images.length).length;
  const noStock = products.filter((p) => p.variants.some((v) => v.stock === null)).length;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (filter === "all" ? true : filter === "ready" ? isReady(p) : !isReady(p) || p.issues.length > 0))
      .filter(({ p }) => !needle || p.title.toLowerCase().includes(needle) || p.category.toLowerCase().includes(needle));
  }, [products, filter, q]);

  const remap = (col: number, value: string) => {
    const [field, option] = value.split(":") as [Mapping["field"], string | undefined];
    const mapping = analysis.mapping.map((m, i) => (i === col ? { field, option: field === "option" ? option || analysis.headers[col] : undefined, confidence: 1 } : field !== "option" && field !== "images" && field !== "ignore" && m.field === field ? { field: "ignore" as const, confidence: 0 } : m));
    const next = { ...analysis, mapping };
    setAnalysis(next);
    setProducts(withPhotoCheck(buildProducts(next.headers, next.rows, mapping, { digits }), analysis.broken));
  };
  const update = (i: number, fn: (p: DraftProduct) => void) => {
    const next = products.map((p, j) => {
      if (j !== i) return p;
      const c = structuredClone(p);
      fn(c);
      c.issues = issuesFor(c);
      return c;
    });
    setProducts(next);
  };
  const bulk = (fn: (p: DraftProduct) => void) =>
    setProducts(
      products.map((p) => {
        const c = structuredClone(p);
        fn(c);
        c.issues = issuesFor(c);
        return c;
      }),
    );
  const mappedCount = analysis.mapping.filter((m) => m.field !== "ignore").length;

  return (
    <div className="grid gap-4">
      {/* Summary */}
      <div className="lx-rise grid gap-3 rounded-[20px] border border-border bg-surface/70 p-4 backdrop-blur-xl sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-success-soft text-success">
            <Check className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-tight">
              Found {products.length} product{products.length === 1 ? "" : "s"} in {analysis.fileName}
            </p>
            <p className="text-[12px] text-muted">
              {analysis.rows.length} rows · sheet “{analysis.sheet}” · {mappedCount} of {analysis.headers.length} columns understood
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" icon={showMap ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} onClick={() => setShowMap(!showMap)}>
            Columns
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setAnalysis(null)}>
            Use another file
          </Button>
        </div>
      </div>

      {showMap && (
        <div className="lx-rise grid gap-2 rounded-[20px] border border-border bg-surface/70 p-4 backdrop-blur-xl">
          {analysis.sheets.length > 1 && (
            <label className="flex items-center gap-2 text-[13px]">
              Sheet
              <Select
                value={analysis.sheet}
                className="!w-auto"
                onChange={async (e) => {
                  const s = analysis.sheets.find((x) => x.name === e.target.value)!;
                  const { analyse } = await import("@/lib/store/import");
                  const a = analyse(s.grid, { digits });
                  setAnalysis({ ...analysis, sheet: s.name, headerRow: a.headerRow, headers: a.headers, rows: a.rows, mapping: a.mapping });
                  setProducts(withPhotoCheck(a.products, analysis.broken));
                }}
              >
                {analysis.sheets.map((s) => <option key={s.name}>{s.name}</option>)}
              </Select>
            </label>
          )}
          <p className="text-[12px] text-muted">We matched your columns like this. Change any that look wrong — products update instantly.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {analysis.headers.map((h, i) => {
              const m = analysis.mapping[i];
              const sample = String(analysis.rows.find((r) => String(r[i] ?? "").trim())?.[i] ?? "").slice(0, 40);
              return (
                <div key={i} className={clsx("flex items-center gap-2 rounded-[12px] border px-2.5 py-1.5", m.field === "ignore" ? "border-border opacity-70" : "border-transparent bg-surface-2")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{h}</p>
                    <p className="truncate text-[11px] text-subtle">{sample || "—"}</p>
                  </div>
                  <ArrowRight className="size-3 shrink-0 text-subtle" />
                  <Select aria-label={`Use “${h}” as`} className="!h-8 !w-40 text-[12px]" value={m.field === "option" ? `option:${m.option ?? ""}` : m.field} onChange={(e) => remap(i, e.target.value)}>
                    {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                    <option value={`option:${m.field === "option" ? (m.option ?? h) : h}`}>Variant: {m.field === "option" ? m.option || h : h}</option>
                    <option value="ignore">{FIELD_LABEL.ignore}</option>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters & bulk fixes */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex h-9 items-center rounded-full bg-surface-2 p-1">
          {(
            [
              ["attention", `Needs attention · ${products.filter((p) => !isReady(p) || p.issues.length).length}`],
              ["ready", `Ready · ${ready}`],
              ["all", `All · ${products.length}`],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={clsx("h-7 rounded-full px-3 text-[12px] font-medium transition-all", filter === v ? "bg-bg text-fg shadow-sm" : "text-muted hover:text-fg")}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="!h-9 w-44 pl-8" aria-label="Search products" />
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {noStock > 0 && <BulkInput label={`Stock for ${noStock} without`} placeholder="10" onApply={(v) => bulk((p) => p.variants.forEach((x) => x.stock === null && (x.stock = Math.max(0, Math.round(Number(v)) || 0))))} />}
          {products.some((p) => !p.category) && <BulkInput label="Category for the rest" placeholder="All products" text onApply={(v) => bulk((p) => !p.category && (p.category = v.trim()))} />}
        </div>
      </div>

      {attention > 0 && filter !== "ready" && (
        <p className="flex items-center gap-2 rounded-[14px] bg-danger-soft px-3.5 py-2.5 text-[13px]">
          <AlertCircle className="size-4 shrink-0 text-danger" />
          <span>
            <b>{attention}</b> product{attention === 1 ? "" : "s"} still need{attention === 1 ? "s" : ""} the fields highlighted in red. You can launch anyway — they&apos;ll be saved as drafts, hidden from shoppers until finished.
          </span>
        </p>
      )}
      {noPhoto > 0 && filter !== "ready" && <p className="text-[12px] text-muted">{noPhoto} without a photo: paste an image link, or add photos after launch in Online store → Products.</p>}

      <div className="grid gap-2.5">
        {list.slice(0, limit).map(({ p, i }, n) => (
          <ProductCard key={p.key + i} p={p} digits={digits} currency={currency} delay={Math.min(n, 12) * 35} onChange={(fn) => update(i, fn)} onRemove={() => setProducts(products.filter((_, j) => j !== i))} />
        ))}
        {list.length > limit && (
          <Button variant="ghost" onClick={() => setLimit(limit + 60)}>
            Show more ({list.length - limit})
          </Button>
        )}
        {!list.length && <p className="py-10 text-center text-[13px] text-muted">{filter === "attention" ? "Everything looks good." : "No products match."}</p>}
      </div>
    </div>
  );
}

function BulkInput({ label, placeholder, onApply, text }: { label: string; placeholder: string; onApply: (v: string) => void; text?: boolean }) {
  const [v, setV] = useState("");
  return (
    <form
      className="flex items-center gap-1 rounded-full border border-border bg-surface/80 py-0.5 pr-0.5 pl-3 text-[12px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onApply(v);
        setV("");
      }}
    >
      <span className="text-muted">{label}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} inputMode={text ? "text" : "numeric"} className="w-24 bg-transparent px-1 outline-none" aria-label={label} />
      <Button size="sm" type="submit" variant="primary" disabled={!v.trim()}>
        Apply
      </Button>
    </form>
  );
}

function money(minor: number | null, digits: number) {
  return minor === null ? "" : (minor / 10 ** digits).toFixed(digits).replace(/\.00$/, "");
}

function ProductCard({ p, digits, currency, delay, onChange, onRemove }: { p: DraftProduct; digits: number; currency: string; delay: number; onChange: (fn: (p: DraftProduct) => void) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const need = (f: string) => p.issues.find((i) => i.field === f);
  const ring = (f: string) => (need(f)?.level === "required" ? "lx-need ring-2 ring-danger/60 bg-danger-soft/40" : need(f) ? "ring-1 ring-warning/50" : "");
  const ok = isReady(p);
  const symbol = useMemo(() => (0).toLocaleString("en", { style: "currency", currency, minimumFractionDigits: 0 }).replace(/[\d\s.,]/g, ""), [currency]);
  const multi = p.variants.length > 1;
  return (
    <article className={clsx("lx-rise overflow-hidden rounded-[20px] border bg-surface/80 backdrop-blur-xl transition-shadow hover:shadow-[0_12px_32px_-18px_rgb(0_0_0/.35)]", ok ? "border-border" : "border-danger/30")} style={{ animationDelay: `${delay}ms` }}>
      <div className="grid gap-3 p-3 sm:grid-cols-[72px_1fr_auto] sm:items-start">
        <div className={clsx("relative grid size-[72px] place-items-center overflow-hidden rounded-[14px] bg-surface-2", !p.images.length && "ring-1 ring-warning/50")}>
          {p.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote product photo preview
            <img src={p.images[0]} alt="" className="size-full object-cover" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.15")} />
          ) : (
            <ImageOff className="size-5 text-subtle" />
          )}
          {p.images.length > 1 && <span className="absolute right-1 bottom-1 rounded-full bg-black/60 px-1.5 text-[10px] text-white">+{p.images.length - 1}</span>}
        </div>
        <div className="grid min-w-0 gap-2">
          <Input value={p.title} placeholder="Product name" aria-label="Product name" className={clsx("!h-9 text-[14px] font-semibold", ring("title"))} onChange={(e) => onChange((x) => void (x.title = e.target.value))} />
          <div className="flex flex-wrap items-center gap-2">
            {!multi && (
              <>
                <MoneyBox label="Price" symbol={symbol} value={money(p.variants[0]?.price ?? null, digits)} className={ring("price")} onChange={(v) => onChange((x) => void (x.variants[0].price = parseMoney(v, digits)))} />
                <MoneyBox label="MRP" symbol={symbol} value={money(p.variants[0]?.compareAt ?? null, digits)} onChange={(v) => onChange((x) => void (x.variants[0].compareAt = parseMoney(v, digits)))} />
                <label className={clsx("flex h-8 items-center gap-1 rounded-[10px] border border-border bg-bg px-2 text-[12px]", ring("stock"))}>
                  <span className="text-subtle">Stock</span>
                  <input value={p.variants[0]?.stock ?? ""} placeholder="10" inputMode="numeric" className="w-12 bg-transparent outline-none" aria-label="Stock" onChange={(e) => onChange((x) => void (x.variants[0].stock = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value)) || 0)))} />
                </label>
              </>
            )}
            {multi && (
              <button type="button" onClick={() => setOpen(true)} className={clsx("flex h-8 items-center gap-1.5 rounded-[10px] border border-border bg-bg px-2.5 text-[12px]", ring("price"))}>
                {p.variants.length} variants · {p.options.map((o) => `${o.name}: ${o.values.slice(0, 4).join(", ")}${o.values.length > 4 ? "…" : ""}`).join(" · ")}
              </button>
            )}
            <label className={clsx("flex h-8 items-center gap-1 rounded-[10px] border border-border bg-bg px-2 text-[12px]", ring("category"))}>
              <span className="text-subtle">Category</span>
              <input value={p.category} placeholder="—" className="w-28 bg-transparent outline-none" aria-label="Category" onChange={(e) => onChange((x) => void (x.category = e.target.value))} />
            </label>
          </div>
          {p.issues.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.issues.map((i) => (
                <span key={i.field} className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", i.level === "required" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                  {i.level === "required" ? <AlertCircle className="size-3" /> : <Sparkles className="size-3" />}
                  {i.message}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 sm:flex-col sm:items-end">
          {ok ? <Badge tone="success"><Check className="size-3" /> Ready</Badge> : <Badge tone="danger">Draft</Badge>}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Less" : "Edit"}
          </Button>
        </div>
      </div>
      {open && (
        <div className="lx-rise grid gap-3 border-t border-border bg-surface-2/40 p-3">
          <Textarea rows={3} value={p.description} placeholder="A sentence or two about what makes it special" aria-label="Description" className={ring("description")} onChange={(e) => onChange((x) => void (x.description = e.target.value))} />
          <div className="flex gap-2">
            <ImagePlus className="mt-2 size-4 shrink-0 text-subtle" />
            <Input
              value={p.images.join(" ")}
              placeholder="Photo links (https://…), separated by spaces"
              aria-label="Photo links"
              className={ring("images")}
              onChange={(e) =>
                onChange((x) => {
                  x.images = (e.target.value.match(/https:\/\/\S+/g) ?? []).slice(0, 10);
                  delete x.brokenImages;
                })
              }
            />
          </div>
          {multi && (
            <div className="overflow-x-auto rounded-[12px] border border-border bg-bg">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-subtle">
                    <th className="px-2.5 py-1.5 font-medium">Variant</th>
                    <th className="px-2.5 py-1.5 font-medium">Price</th>
                    <th className="px-2.5 py-1.5 font-medium">MRP</th>
                    <th className="px-2.5 py-1.5 font-medium">Stock</th>
                    <th className="px-2.5 py-1.5 font-medium">SKU</th>
                  </tr>
                </thead>
                <tbody>
                  {p.variants.map((v, j) => (
                    <tr key={j} className="border-t border-border">
                      <td className="px-2.5 py-1">{Object.values(v.options).join(" / ") || "Default"}</td>
                      <td className="px-2.5 py-1">
                        <input value={money(v.price, digits)} placeholder="Needed" className={clsx("w-20 rounded bg-transparent px-1 outline-none", (v.price === null || v.price <= 0) && "bg-danger-soft ring-1 ring-danger/50")} aria-label="Variant price" onChange={(e) => onChange((x) => void (x.variants[j].price = parseMoney(e.target.value, digits)))} />
                      </td>
                      <td className="px-2.5 py-1">
                        <input value={money(v.compareAt, digits)} className="w-20 bg-transparent px-1 outline-none" aria-label="Variant MRP" onChange={(e) => onChange((x) => void (x.variants[j].compareAt = parseMoney(e.target.value, digits)))} />
                      </td>
                      <td className="px-2.5 py-1">
                        <input value={v.stock ?? ""} placeholder="10" className="w-14 bg-transparent px-1 outline-none" aria-label="Variant stock" onChange={(e) => onChange((x) => void (x.variants[j].stock = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value)) || 0)))} />
                      </td>
                      <td className="px-2.5 py-1 text-muted">{v.sku}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.active} onChange={(e) => onChange((x) => void (x.active = e.target.checked))} /> Show in the shop when ready
            </label>
            <button type="button" className="text-danger hover:underline" onClick={onRemove}>
              Don&apos;t import this product
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function MoneyBox({ label, symbol, value, onChange, className }: { label: string; symbol: string; value: string; onChange: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className={clsx("flex h-8 items-center gap-1 rounded-[10px] border border-border bg-bg px-2 text-[12px]", className)}>
      <span className="text-subtle">{label}</span>
      <span className="text-muted">{symbol}</span>
      <input
        value={draft ?? value}
        placeholder={label === "Price" ? "Needed" : "—"}
        inputMode="decimal"
        className="w-16 bg-transparent outline-none"
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

export type { Analysis };
