"use client";

import { ProductDrop, ProductReview, withPhotoCheck, type Analysis } from "@/components/launch/product-import";
import { buildProducts, isReady, type DraftProduct } from "@/lib/store/import";
import { minorDigits } from "@/lib/store/money";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Download, ImagePlus, Plus, Search, ShoppingBag, Sparkles, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LabelsCard } from "./labels";
import { MediaPicker } from "@/components/builder/media";
import { ConfirmDialog, Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, ButtonLink, cx, EmptyState, ErrorState, Field, IconButton, Input, Notice, Select, Skeleton, Switch, Textarea, FormLines } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { MoneyInput, Panel, pct, storeApi, SubHeader, Table, td, useMoney, useStoreCtx, useStoreQuery } from "./shared";
import { useShortcuts } from "../ui/shortcut";

type Variant = { id?: string; title?: string; options: Record<string, string>; sku: string; barcode?: string; price: number; compareAt: number | null; cost: number | null; trackInventory: boolean; stock: number; weightGrams: number };
type Product = {
  id: string;
  title: string;
  slug: string;
  description: string;
  status: "draft" | "active" | "archived";
  images: string[];
  options: { name: string; values: string[] }[];
  tags: string[];
  vendor: string;
  taxBps: number | null;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  hsn: string;
  kind: "physical" | "digital" | "membership";
  digitalFileId: string | null;
  membershipDays: number | null;
  subscriptionInterval: "week" | "month" | "year" | null;
  subscriptionIntervalCount: number;
  isSample: boolean;
  collectionIds: string[];
  variants: Variant[];
  createdAt: string;
};
type Collection = { id: string; title: string; slug: string; productCount: number };

const STATUS = { active: { label: "Active", tone: "success" }, draft: { label: "Draft", tone: "neutral" }, archived: { label: "Archived", tone: "warning" } } as const;

export function ProductsView() {
  const { base, projectId, store, can } = useStoreCtx();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "draft" | "archived">("");
  const params = new URLSearchParams({ q, status });
  const list = useStoreQuery<{ products: Product[] }>(`products?${params}`);
  const [importOpen, setImportOpen] = useState(false);
  const range = (p: Product) => {
    const prices = p.variants.map((v) => v.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
  };
  const stockText = (p: Product) => {
    const tracked = p.variants.filter((v) => v.trackInventory);
    if (!tracked.length) return <span className="text-muted">Not tracked</span>;
    const n = tracked.reduce((a, v) => a + v.stock, 0);
    return <span className={cx(n <= 0 ? "text-danger" : n <= store.lowStockThreshold ? "text-warning" : "")}>{n <= 0 ? "Out of stock" : `${n} in stock`}{p.variants.length > 1 && <span className="text-muted"> · {p.variants.length} variants</span>}</span>;
  };
  const samples = list.data?.products.filter((p) => p.isSample).length ?? 0;

  const clearSamples = useMutation({
    mutationFn: async () => {
      for (const p of list.data!.products.filter((x) => x.isSample)) await api(storeApi(projectId, `products/${p.id}`), { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: "Sample products removed" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not remove samples", description: errorMessage(e) }),
  });
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div>
      <SubHeader
        title="Products"
        description="What you sell. Add photos, prices, sizes or colours, and stock."
        actions={
          <>
            <ButtonLink href={storeApi(projectId, "export")} external icon={<Download className="size-3.5" />}>
              Export
            </ButtonLink>
            {can("store:manage") && (
              <>
                <Button icon={<Upload className="size-3.5" />} onClick={() => setImportOpen(true)}>
                  Import
                </Button>
                <PhotoListingButton />
                <ButtonLink href={`${base}/products/new`} variant="primary" icon={<Plus className="size-3.5" />}>
                  Add product
                </ButtonLink>
              </>
            )}
          </>
        }
      />
      {samples > 0 && (
        <div className="mb-4">
          <Notice
            tone="warning"
            title={`${samples} sample product${samples === 1 ? "" : "s"} from your template`}
            action={can("store:manage") && <Button size="sm" onClick={() => setConfirmClear(true)}>Delete all samples</Button>}
          >
            Customers cannot buy samples. Edit each one with your own photos and prices (then switch off “Sample product”), or delete them.
          </Notice>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Search products" className="pl-8" placeholder="Search by name or tag" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]} />
      </div>
      {list.isPending ? (
        <Skeleton className="h-72" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <Table
          head={["Product", "Status", "Inventory", "Price"]}
          empty={
            list.data.products.length === 0 && (
              <EmptyState
                icon={<ShoppingBag className="size-5" />}
                title={q || status ? "No matching products" : "Add your first product"}
                description={q || status ? "Try a different search." : "Products you add appear on your store's shop pages and product grids."}
                action={!q && !status && can("store:manage") && <ButtonLink href={`${base}/products/new`} variant="primary" icon={<Plus className="size-3.5" />}>Add product</ButtonLink>}
              />
            )
          }
        >
          {list.data.products.map((p) => (
            <tr key={p.id} className="hover:bg-surface-2/60">
              <td className={td}>
                <Link href={`${base}/products/${p.id}`} className="flex items-center gap-3">
                  <span className="size-11 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- product image */}
                    {p.images[0] && <img src={p.images[0]} alt="" className="size-full object-cover" loading="lazy" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium hover:underline">{p.title}</span>
                    <span className="flex gap-1">
                      {p.isSample && <Badge tone="warning">Sample</Badge>}
                      {p.featured && <Badge tone="accent">Featured</Badge>}
                    </span>
                  </span>
                </Link>
              </td>
              <td className={td}>
                <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
              </td>
              <td className={`${td} tabular-nums`}>{stockText(p)}</td>
              <td className={`${td} text-right tabular-nums`}>{range(p)}</td>
            </tr>
          ))}
        </Table>
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ConfirmDialog open={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={() => clearSamples.mutate(undefined, { onSettled: () => setConfirmClear(false) })} loading={clearSamples.isPending} destructive title="Delete all sample products?" description="This removes every product marked as a sample. Your own products are not affected." confirmLabel="Delete samples" />
    </div>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { projectId, store, base } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [makeCatalogue, setMakeCatalogue] = useState(true);
  const currency = store?.currency ?? "INR";
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [products, setProducts] = useState<DraftProduct[]>([]);
  const close = () => {
    setAnalysis(null);
    setProducts([]);
    onClose();
  };
  const run = useMutation({
    mutationFn: () => api<{ imported: number; drafts: number; problems: string[]; catalogue: { id: string; title: string } | null }>(storeApi(projectId, "import/smart"), { method: "POST", body: { products, catalogue: makeCatalogue ? {} : null } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: r.problems.length ? "info" : "success", title: `Imported ${r.imported} product${r.imported === 1 ? "" : "s"}${r.drafts ? ` (${r.drafts} as drafts)` : ""}${r.catalogue ? " and made a catalogue" : ""}`, description: r.problems.slice(0, 3).join(" · ") || undefined });
      close();
      // Straight to the new catalogue, ready to customise and share.
      if (r.catalogue) router.push(`${base}/catalogues/${r.catalogue.id}`);
    },
    onError: (e) => toast({ tone: "error", title: "Import failed", description: errorMessage(e) }),
  });
  const ready = products.filter(isReady).length;
  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      title="Import products"
      description="Any Excel or CSV file. We recognise your columns and highlight what each product still needs. Products missing a name or price are saved as drafts."
      footer={
        <>
          {products.length > 0 && (
            <span className="mr-auto flex items-center gap-2 text-[13px]">
              <Switch checked={makeCatalogue} onChange={setMakeCatalogue} label="Also make a catalogue of these products" />
              <span className="hidden sm:inline">Also make a shareable catalogue</span>
            </span>
          )}
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!products.length} loading={run.isPending} onClick={() => run.mutate()}>
            Import {products.length ? `${products.length} (${ready} ready)` : ""}
          </Button>
        </>
      }
    >
      <div className="max-h-[65vh] overflow-y-auto pr-1">
        {analysis ? (
          <ProductReview analysis={analysis} setAnalysis={(a) => { setAnalysis(a); if (!a) setProducts([]); }} products={products} setProducts={setProducts} currency={currency} />
        ) : (
          <ProductDrop
            onRead={(a) => {
              setAnalysis(a);
              setProducts(withPhotoCheck(buildProducts(a.headers, a.rows, a.mapping, { digits: minorDigits(currency) }), a.broken));
            }}
          />
        )}
      </div>
    </Dialog>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

const blankVariant = (price = 0): Variant => ({ options: {}, sku: "", barcode: "", price, compareAt: null, cost: null, trackInventory: true, stock: 0, weightGrams: 0 });

/** Every combination of option values, keeping prices and stock of variants that still exist. */
function generateVariants(options: { name: string; values: string[] }[], prev: Variant[]): Variant[] {
  const opts = options.filter((o) => o.name.trim() && o.values.length);
  if (!opts.length) return [prev[0] ? { ...prev[0], options: {} } : blankVariant()];
  let combos: Record<string, string>[] = [{}];
  for (const o of opts) combos = combos.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v })));
  const key = (o: Record<string, string>) => opts.map((x) => `${x.name}=${o[x.name] ?? ""}`).join("|");
  const byKey = new Map(prev.map((v) => [key(v.options), v]));
  const template = prev[0] ?? blankVariant();
  return combos.slice(0, 100).map((c) => byKey.get(key(c)) ?? { ...blankVariant(template.price), compareAt: template.compareAt, cost: template.cost, weightGrams: template.weightGrams, options: c });
}

export function ProductEditor({ id }: { id: string | null }) {
  const { projectId, base, store, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const existing = useStoreQuery<{ product: Product }>(`products/${id}`, { enabled: !!id });
  const collections = useStoreQuery<{ collections: Collection[] }>("collections");
  if (id && existing.isPending) return <Skeleton className="h-96" />;
  if (id && existing.isError) return <ErrorState message={errorMessage(existing.error)} onRetry={() => existing.refetch()} />;
  return <EditorForm key={id ?? "new"} initial={existing.data?.product ?? null} collections={collections.data?.collections ?? []} ctx={{ projectId, base, store, can, toast, qc, router }} />;
}

type EditorCtx = { projectId: string; base: string; store: ReturnType<typeof useStoreCtx>["store"]; can: (p: string) => boolean; toast: ReturnType<typeof useToast>; qc: ReturnType<typeof useQueryClient>; router: ReturnType<typeof useRouter> };

function EditorForm({ initial, collections, ctx }: { initial: Product | null; collections: Collection[]; ctx: EditorCtx }) {
  const { projectId, base, store, can, toast, qc, router } = ctx;
  const saveKeys = useShortcuts().keys("mod+s");
  // A draft written from a photo (handed over by PhotoListingButton) prefills a new product once.
  const [fromPhoto] = useState(() => (initial ? null : takePhotoDraft(projectId)));
  const [p, setP] = useState(() => ({
    title: initial?.title ?? fromPhoto?.draft.title ?? "",
    slug: initial?.slug ?? "",
    description: initial?.description ?? fromPhoto?.draft.description ?? "",
    status: initial?.status ?? ("active" as Product["status"]),
    images: initial?.images ?? fromPhoto?.draft.images ?? [],
    options: initial?.options ?? [],
    tags: initial?.tags ?? fromPhoto?.draft.tags ?? [],
    vendor: initial?.vendor ?? "",
    taxBps: initial?.taxBps ?? fromPhoto?.draft.taxBps ?? null,
    featured: initial?.featured ?? false,
    seoTitle: initial?.seoTitle ?? "",
    seoDescription: initial?.seoDescription ?? "",
    hsn: initial?.hsn ?? fromPhoto?.draft.hsn ?? "",
    kind: initial?.kind ?? ("physical" as Product["kind"]),
    digitalFileId: initial?.digitalFileId ?? null,
    membershipDays: initial?.membershipDays ?? null,
    subscriptionInterval: initial?.subscriptionInterval ?? null,
    subscriptionIntervalCount: initial?.subscriptionIntervalCount ?? 1,
    collectionIds: initial?.collectionIds ?? fromPhoto?.draft.collectionIds ?? [],
    variants: initial?.variants.length ? initial.variants : [blankVariant()],
    isSample: initial?.isSample ?? false,
  }));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editable = can("store:manage");
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => {
    setP((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const setOptions = (options: typeof p.options) => {
    setP((x) => ({ ...x, options, variants: generateVariants(options, x.variants) }));
    setDirty(true);
  };
  const setVariant = (i: number, patch: Partial<Variant>) => {
    setP((x) => ({ ...x, variants: x.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
    setDirty(true);
  };
  const hasOptions = p.options.some((o) => o.name.trim() && o.values.length);

  const save = useMutation({
    mutationFn: (opts: { publish?: boolean } | void) => {
      const body = {
        ...p,
        status: opts?.publish ? ("active" as const) : p.status,
        isSample: p.isSample ? undefined : initial?.isSample ? false : undefined,
        slug: p.slug || undefined,
        options: p.options.filter((o) => o.name.trim() && o.values.length),
        variants: p.variants.map((v) => ({ id: v.id, options: v.options, sku: v.sku, barcode: (v.barcode ?? "").trim(), price: v.price, compareAt: v.compareAt, cost: v.cost, trackInventory: v.trackInventory, stock: v.stock, weightGrams: v.weightGrams })),
      };
      return initial ? api<{ product: Product }>(storeApi(projectId, `products/${initial.id}`), { method: "PUT", body }) : api<{ product: Product }>(storeApi(projectId, "products"), { method: "POST", body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      setDirty(false);
      setErrors({});
      toast({ tone: "success", title: r.product.status === "active" && p.status !== "active" ? "Published — it's in your shop now" : initial ? "Product saved" : "Product added" });
      setP((x) => ({ ...x, status: r.product.status }));
      if (!initial) router.replace(`${base}/products/${r.product.id}`);
      else setP((x) => ({ ...x, variants: r.product.variants, slug: r.product.slug, isSample: r.product.isSample }));
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors());
      toast({ tone: "error", title: "Could not save", description: errorMessage(e) });
    },
  });
  // Unsaved edits: ⌘/Ctrl+S saves, and leaving the page asks first.
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!save.isPending && p.title.trim()) save.mutate();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty, save, p.title]);
  const del = useMutation({
    mutationFn: () => api<{ archived: boolean }>(storeApi(projectId, `products/${initial!.id}`), { method: "DELETE" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: r.archived ? "Product archived (it has orders, so it is kept for your records)" : "Product deleted" });
      router.push(`${base}/products`);
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });
  const v0 = p.variants[0];
  const margin = (v: Variant) => (v.cost !== null && v.price > 0 ? (v.price - v.cost) / v.price : null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SubHeader
        back={{ href: `${base}/products`, label: "Products" }}
        title={initial ? p.title || "Untitled product" : "Add product"}
        actions={
          editable && (
            <>
              {initial && (
                <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!p.title.trim() || (!!initial && !dirty)}>
                {initial ? (dirty ? "Save changes" : "Saved") : "Add product"}
              </Button>
            </>
          )
        }
      />
      {fromPhoto && (
        <div className="mb-4">
          <Notice tone="accent" title="Written from your photo — please check before saving">
            <ul className="mt-1 grid gap-0.5">
              {(fromPhoto.checks.length ? fromPhoto.checks : ["Read through the title and description."]).map((c) => <li key={c}>• {c}</li>)}
              <li>• Add the price and stock — we never guess those.</li>
            </ul>
          </Notice>
        </div>
      )}
      {initial && p.status !== "active" && !p.isSample && (
        <div className="mb-4">
          <Notice
            tone="warning"
            title={p.status === "draft" ? "Draft — hidden from your shop" : "Archived — hidden from your shop"}
            action={editable && <Button size="sm" variant="primary" loading={save.isPending} disabled={!p.title.trim() || p.variants.some((v) => !v.price)} onClick={() => save.mutate({ publish: true })}>Publish now</Button>}
          >
            {p.variants.some((v) => !v.price) ? "Add a price to publish it. Shoppers only see active products." : "Shoppers only see active products. Publish it to show it on your site and sell it in store."}
          </Notice>
        </div>
      )}
      {initial?.isSample && p.isSample && (
        <div className="mb-4">
          <Notice tone="warning" title="This is a sample product" action={editable && <Switch checked={!p.isSample} onChange={(v) => set("isSample", !v)} label="This is my real product" />}>
            Replace the photo, name and price with your own, then switch this on so customers can buy it.
          </Notice>
        </div>
      )}
      <fieldset disabled={!editable} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <div className="space-y-4">
              <Field label="Title" error={errors.title?.[0]}>
                {(a) => <Input {...a} value={p.title} onChange={(e) => set("title", e.target.value)} maxLength={160} placeholder="e.g. Linen relaxed shirt" required />}
              </Field>
              <Field label="Description" hint="What it is, what it is made of, how it fits or how to use it.">
                {(a) => <Textarea {...a} rows={6} value={p.description} onChange={(e) => set("description", e.target.value)} maxLength={20000} />}
              </Field>
            </div>
          </Panel>

          <Panel title="Photos" description="The first photo is the main one. Square or portrait photos look best.">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {p.images.map((src, i) => (
                <div key={src + i} className={cx("group relative aspect-square overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2", i === 0 && "col-span-2 row-span-2")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- product image */}
                  <img src={src} alt="" className="size-full object-cover" />
                  {editable && (
                    <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <span className="flex gap-1">
                        {i > 0 && <IconButton size="sm" label="Move earlier" className="bg-surface/90" icon={<ArrowLeft className="size-3.5" />} onClick={() => { const a = [...p.images]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set("images", a); }} />}
                        {i < p.images.length - 1 && <IconButton size="sm" label="Move later" className="bg-surface/90" icon={<ArrowRight className="size-3.5" />} onClick={() => { const a = [...p.images]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set("images", a); }} />}
                      </span>
                      <IconButton size="sm" label="Remove photo" className="bg-surface/90" icon={<X className="size-3.5" />} onClick={() => set("images", p.images.filter((_, j) => j !== i))} />
                    </div>
                  )}
                </div>
              ))}
              {p.images.length < 20 && editable && (
                <button type="button" onClick={() => setPicker(true)} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-dashed border-border-strong text-xs text-muted hover:bg-surface-2 hover:text-fg">
                  <ImagePlus className="size-5" />
                  Add photo
                </button>
              )}
            </div>
          </Panel>

          {!hasOptions && v0 && (
            <Panel title="Price & stock">
              <SimpleVariant v={v0} currency={store.currency} onChange={(patch) => setVariant(0, patch)} margin={margin(v0)} />
            </Panel>
          )}

          <Panel title="Options" description="Sizes, colours or materials. Each combination becomes a variant with its own price and stock.">
            <OptionsEditor options={p.options} onChange={setOptions} />
          </Panel>

          {hasOptions && (
            <Panel title={`Variants (${p.variants.length})`} description="Set price and stock for each combination.">
              <VariantTable variants={p.variants} currency={store.currency} onChange={setVariant} onApplyAll={(patch) => { setP((x) => ({ ...x, variants: x.variants.map((v) => ({ ...v, ...patch })) })); setDirty(true); }} />
            </Panel>
          )}

          <Panel title="Search engine listing" description="How this product appears in Google results.">
            <div className="space-y-3">
              <div className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-[13px]">
                <p className="truncate text-accent">{p.seoTitle || p.title || "Product title"}</p>
                <p className="truncate text-xs text-success">…/product/{p.slug || "product-address"}</p>
                <p className="line-clamp-2 text-xs text-muted">{p.seoDescription || p.description.slice(0, 160) || "Add a description to show a snippet here."}</p>
              </div>
              <Field label="Page title">{(a) => <Input {...a} value={p.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} maxLength={120} placeholder={p.title} />}</Field>
              <Field label="Meta description">{(a) => <Textarea {...a} rows={2} value={p.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} maxLength={320} />}</Field>
              <Field label="Web address" hint="Letters, numbers and dashes. Leave blank to use the title.">
                {(a) => <Input {...a} value={p.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} maxLength={80} className="font-mono text-xs" />}
              </Field>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {initial && p.kind === "physical" && <LabelsCard productId={initial.id} slug={initial.slug} title={p.title} variants={p.variants} editable={editable} onBarcodes={(codes) => { setP((x) => ({ ...x, variants: x.variants.map((v) => (v.id && codes[v.id] ? { ...v, barcode: codes[v.id] } : v)) })); qc.invalidateQueries({ queryKey: ["store", projectId] }); }} />}
          <Panel title="Status">
            <Select aria-label="Status" value={p.status} onChange={(e) => set("status", e.target.value as Product["status"])}>
              <option value="active">Active — visible in your store</option>
              <option value="draft">Draft — hidden</option>
              <option value="archived">Archived — hidden</option>
            </Select>
            <Field className="mt-3" label="Product type">
              {(a) => (
                <Select {...a} value={p.kind} onChange={(e) => set("kind", e.target.value as Product["kind"])}>
                  <option value="physical">Physical — shipped to the customer</option>
                  <option value="digital">Digital — a file they download</option>
                  <option value="membership">Membership — access to members-only pages</option>
                </Select>
              )}
            </Field>
            {p.kind === "digital" && <DigitalFilePicker value={p.digitalFileId} onChange={(v) => set("digitalFileId", v)} />}
            {p.kind === "membership" && (
              <Field className="mt-3" label="Access length (days)" hint="Leave empty for lifetime access. Buying again extends it.">
                {(a) => <Input {...a} type="number" min={1} max={3650} value={p.membershipDays ?? ""} onChange={(e) => set("membershipDays", e.target.value ? Math.max(1, Math.trunc(Number(e.target.value))) : null)} />}
              </Field>
            )}
            <label className="mt-3 flex items-center justify-between gap-3 text-[13px]">
              <span>
                Sold as a subscription
                <span className="block text-xs text-muted">Charged again automatically (Stripe or Razorpay).</span>
              </span>
              <Switch checked={!!p.subscriptionInterval} onChange={(v) => set("subscriptionInterval", v ? "month" : null)} label="Sold as a subscription" />
            </label>
            {p.subscriptionInterval && (
              <div className="mt-2 grid grid-cols-[90px_1fr] gap-2">
                <Field label="Every">{(a) => <Input {...a} type="number" min={1} max={52} value={p.subscriptionIntervalCount} onChange={(e) => set("subscriptionIntervalCount", Math.min(52, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))} />}</Field>
                <Field label="Period">
                  {(a) => (
                    <Select {...a} value={p.subscriptionInterval!} onChange={(e) => set("subscriptionInterval", e.target.value as "week" | "month" | "year")}>
                      <option value="week">week(s)</option>
                      <option value="month">month(s)</option>
                      <option value="year">year(s)</option>
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <label className="mt-3 flex items-center justify-between gap-3 text-[13px]">
              Feature on the home page
              <Switch checked={p.featured} onChange={(v) => set("featured", v)} label="Featured" />
            </label>
          </Panel>
          <Panel title="Collections" description="Group products into categories for your shop menu.">
            {collections.length === 0 ? (
              <p className="text-[13px] text-muted">
                No collections yet.{" "}
                <Link href={`${base}/collections`} className="text-accent hover:underline">
                  Create one
                </Link>
              </p>
            ) : (
              <ul className="space-y-1.5">
                {collections.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={p.collectionIds.includes(c.id)} onChange={(e) => set("collectionIds", e.target.checked ? [...p.collectionIds, c.id] : p.collectionIds.filter((x) => x !== c.id))} />
                      {c.title}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Organisation">
            <div className="space-y-3">
              <Field label="Brand / vendor">{(a) => <Input {...a} value={p.vendor} onChange={(e) => set("vendor", e.target.value)} maxLength={80} />}</Field>
              <Field label="Tags" hint="Comma separated. Shoppers can search by tag.">
                {(a) => <Input {...a} defaultValue={p.tags.join(", ")} onBlur={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 30))} />}
              </Field>
              {store.country === "IN" && (
                <Field label="HSN / SAC code" hint="Printed on GST invoices and used for the HSN summary." error={errors.hsn?.[0]}>
                  {(a) => <Input {...a} value={p.hsn} onChange={(e) => set("hsn", e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="e.g. 6109" className="font-mono text-xs" />}
                </Field>
              )}
              <Field label="Tax rate" hint={`Blank uses the store default (${pct(store.defaultTaxBps)}).`}>
                {(a) => (
                  <Select {...a} value={p.taxBps === null ? "" : String(p.taxBps)} onChange={(e) => set("taxBps", e.target.value === "" ? null : Number(e.target.value))}>
                    <option value="">Store default</option>
                    {[0, 500, 1200, 1800, 2800].map((b) => (
                      <option key={b} value={b}>
                        {pct(b)}
                        {store.country === "IN" ? " GST" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Panel>
        </div>
      </fieldset>
      <MediaPicker projectId={projectId} open={picker} onClose={() => setPicker(false)} onPick={(url) => set("images", [...p.images, url])} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => del.mutate()} loading={del.isPending} destructive title="Delete this product?" description="Products that have been ordered are archived instead, so your order history stays complete." confirmLabel="Delete" />
      {editable && initial && dirty && (
        <div className="lx-rise fixed inset-x-0 bottom-[calc(var(--dock)+20px)] z-40 flex justify-center px-4" role="region" aria-label="Unsaved changes">
          <div className="glass-strong flex items-center gap-3 rounded-full py-2 pr-2 pl-5 shadow-[0_20px_50px_-20px_rgb(0_0_0/.45)]">
            <span className="text-[13px] font-medium">Unsaved changes</span>
            <Button size="sm" variant="ghost" type="button" onClick={() => { if (window.confirm("Discard your changes to this product?")) window.location.reload(); }}>
              Discard
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={save.isPending} disabled={!p.title.trim()}>
              Save {saveKeys && <kbd className="ml-1 hidden font-sans text-[10px] opacity-60 sm:inline">{saveKeys}</kbd>}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function SimpleVariant({ v, currency, onChange, margin }: { v: Variant; currency: string; onChange: (p: Partial<Variant>) => void; margin: number | null }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Price">{(a) => <MoneyInput {...a} value={v.price} onChange={(x) => onChange({ price: x ?? 0 })} currency={currency} />}</Field>
        <Field label="Compare-at price" hint="Shows as a strike-through “was” price.">
          {(a) => <MoneyInput {...a} value={v.compareAt} onChange={(x) => onChange({ compareAt: x })} currency={currency} />}
        </Field>
        <Field label="Cost per item" hint={margin === null ? "Private. Used for profit reports." : `Margin ${(margin * 100).toFixed(0)}%`}>
          {(a) => <MoneyInput {...a} value={v.cost} onChange={(x) => onChange({ cost: x })} currency={currency} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU (optional)">{(a) => <Input {...a} value={v.sku} onChange={(e) => onChange({ sku: e.target.value })} maxLength={60} className="font-mono text-xs" />}</Field>
        <Field label="Barcode (EAN/UPC)" hint="Scan the pack's barcode, type it, or generate one in Labels.">{(a) => <Input {...a} value={v.barcode ?? ""} onChange={(e) => onChange({ barcode: e.target.value.replace(/\s+/g, "") })} maxLength={48} spellCheck={false} className="font-mono text-xs" />}</Field>
        <Field label="Stock">{(a) => <Input {...a} type="number" value={v.stock} disabled={!v.trackInventory} onChange={(e) => onChange({ stock: Math.trunc(Number(e.target.value) || 0) })} />}</Field>
        <Field label="Weight (grams)" hint="Used for weight-based shipping.">
          {(a) => <Input {...a} type="number" min={0} value={v.weightGrams} onChange={(e) => onChange({ weightGrams: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />}
        </Field>
      </div>
      <label className="flex items-center justify-between gap-3 text-[13px]">
        <span>
          Track stock
          <span className="block text-xs text-muted">Stops selling when it runs out. Turn off for made-to-order or digital items.</span>
        </span>
        <Switch checked={v.trackInventory} onChange={(x) => onChange({ trackInventory: x })} label="Track stock" />
      </label>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: { name: string; values: string[] }[]; onChange: (o: { name: string; values: string[] }[]) => void }) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const presets = [
    { name: "Size", values: ["S", "M", "L", "XL"] },
    { name: "Colour", values: [] as string[] },
    { name: "Material", values: [] as string[] },
  ];
  const addValue = (i: number) => {
    const val = (drafts[i] ?? "").trim();
    if (!val) return;
    const vals = val.split(",").map((s) => s.trim()).filter(Boolean);
    onChange(options.map((o, j) => (j === i ? { ...o, values: [...new Set([...o.values, ...vals])].slice(0, 50) } : o)));
    setDrafts({ ...drafts, [i]: "" });
  };
  return (
    <div className="space-y-3">
      {options.map((o, i) => (
        <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
          <div className="flex gap-2">
            <Input aria-label="Option name" value={o.name} onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Option name, e.g. Size" maxLength={40} className="max-w-48" />
            <IconButton label="Remove option" icon={<Trash2 className="size-3.5" />} onClick={() => onChange(options.filter((_, j) => j !== i))} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {o.values.map((v) => (
              <span key={v} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface-2 pr-1 pl-2.5 text-[13px]">
                {v}
                <button type="button" aria-label={`Remove ${v}`} className="rounded-full p-0.5 text-muted hover:bg-surface-3 hover:text-fg" onClick={() => onChange(options.map((x, j) => (j === i ? { ...x, values: x.values.filter((y) => y !== v) } : x)))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Input
              aria-label={`Add a value to ${o.name || "this option"}`}
              value={drafts[i] ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [i]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addValue(i);
                }
              }}
              onBlur={() => addValue(i)}
              placeholder="Add value, press Enter"
              className="h-7 w-44"
              maxLength={60}
            />
          </div>
        </div>
      ))}
      {options.length < 3 && (
        <div className="flex flex-wrap gap-2">
          {presets
            .filter((pr) => !options.some((o) => o.name.toLowerCase() === pr.name.toLowerCase()))
            .map((pr) => (
              <Button key={pr.name} size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange([...options, { name: pr.name, values: pr.values }])}>
                {pr.name}
              </Button>
            ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...options, { name: "", values: [] }])}>
            Custom option
          </Button>
        </div>
      )}
    </div>
  );
}

function VariantTable({ variants, currency, onChange, onApplyAll }: { variants: Variant[]; currency: string; onChange: (i: number, p: Partial<Variant>) => void; onApplyAll: (p: Partial<Variant>) => void }) {
  const [bulk, setBulk] = useState<number | null>(null);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-40">
          <MoneyInput value={bulk} onChange={setBulk} currency={currency} placeholder="Price for all" aria-label="Price for all variants" />
        </div>
        <Button size="sm" icon={<Sparkles className="size-3.5" />} disabled={bulk === null} onClick={() => bulk !== null && onApplyAll({ price: bulk })}>
          Apply to all
        </Button>
      </div>
      <div className="-mx-4 overflow-x-auto">
        <FormLines className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-y border-border text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Variant</th>
              <th className="px-2 py-2 font-medium">Price</th>
              <th className="px-2 py-2 font-medium">Compare at</th>
              <th className="px-2 py-2 font-medium">SKU</th>
              <th className="px-2 py-2 font-medium">Barcode</th>
              <th className="px-2 py-2 font-medium">Stock</th>
              <th className="px-4 py-2 font-medium">Track</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {variants.map((v, i) => {
              const label = Object.values(v.options).join(" / ") || "Default";
              return (
                <tr key={label}>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{label}</td>
                  <td className="w-32 px-2 py-2">
                    <MoneyInput value={v.price} onChange={(x) => onChange(i, { price: x ?? 0 })} currency={currency} aria-label={`${label} price`} />
                  </td>
                  <td className="w-32 px-2 py-2">
                    <MoneyInput value={v.compareAt} onChange={(x) => onChange(i, { compareAt: x })} currency={currency} aria-label={`${label} compare-at price`} />
                  </td>
                  <td className="w-32 px-2 py-2">
                    <Input aria-label={`${label} SKU`} value={v.sku} onChange={(e) => onChange(i, { sku: e.target.value })} maxLength={60} className="font-mono text-xs" />
                  </td>
                  <td className="w-36 px-2 py-2">
                    <Input aria-label={`${label} barcode`} value={v.barcode ?? ""} onChange={(e) => onChange(i, { barcode: e.target.value.replace(/\s+/g, "") })} maxLength={48} className="font-mono text-xs" />
                  </td>
                  <td className="w-24 px-2 py-2">
                    <Input aria-label={`${label} stock`} type="number" value={v.stock} disabled={!v.trackInventory} onChange={(e) => onChange(i, { stock: Math.trunc(Number(e.target.value) || 0) })} />
                  </td>
                  <td className="px-4 py-2">
                    <Switch checked={v.trackInventory} onChange={(x) => onChange(i, { trackInventory: x })} label={`Track stock for ${label}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </FormLines>
      </div>
      {variants.length >= 100 && <p className="mt-2 text-xs text-warning">Products can have up to 100 variants; extra combinations were left out.</p>}
    </div>
  );
}


type DigitalFile = { id: string; filename: string; mime: string; size: number };

/** Private files for digital products (never public; delivered through order download links). */
function DigitalFilePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { projectId } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useStoreQuery<{ files: DigitalFile[] }>("files");
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(storeApi(projectId, "files"), { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      return json.file as DigitalFile;
    },
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: ["store", projectId, "files"] });
      onChange(f.id);
      toast({ tone: "success", title: `${f.filename} uploaded` });
    },
    onError: (e) => toast({ tone: "error", title: "Could not upload", description: errorMessage(e) }),
  });
  const files = q.data?.files ?? [];
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[13px] font-medium">File to deliver</p>
      <Select aria-label="File to deliver" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{files.length ? "Choose a file" : "No files yet — upload one"}</option>
        {files.map((f) => (
          <option key={f.id} value={f.id}>
            {f.filename} ({(f.size / 1024 / 1024).toFixed(1)} MB)
          </option>
        ))}
      </Select>
      <input ref={input} type="file" className="sr-only" accept=".pdf,.zip,.epub,.mp3,.mp4,.png,.jpg,.jpeg" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
      <Button size="sm" icon={<Upload className="size-3.5" />} loading={upload.isPending} onClick={() => input.current?.click()}>
        Upload a file
      </Button>
      <p className="text-xs text-muted">PDF, ZIP, EPUB, MP3, MP4 or image, up to 25 MB. Buyers download it from their order page (up to 10 times per copy).</p>
    </div>
  );
}

// ── Photo → listing ─────────────────────────────────────────────────────────

type PhotoDraft = { draft: { title: string; description: string; tags: string[]; hsn: string; taxBps: number | null; collectionIds: string[]; images: string[] }; altText: string; checks: string[] };
const photoKey = (projectId: string) => `cc-photo-listing:${projectId}`;

/** Reads (and clears) a draft handed over from the photo dialog. */
function takePhotoDraft(projectId: string): PhotoDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(photoKey(projectId));
    window.sessionStorage.removeItem(photoKey(projectId));
    return raw ? (JSON.parse(raw) as PhotoDraft) : null;
  } catch {
    return null;
  }
}

function PhotoListingButton() {
  const { projectId, base } = useStoreCtx();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const write = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("file", file!, file!.name);
      const res = await fetch(storeApi(projectId, "products/from-photo"), { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiClientError(res.status, json?.error?.code ?? "http_error", json?.error?.message ?? "Couldn't read the photo", json?.error?.details ?? null);
      return json as PhotoDraft;
    },
    onSuccess: (r) => {
      try {
        window.sessionStorage.setItem(photoKey(projectId), JSON.stringify(r));
      } catch {
        /* the editor will open empty */
      }
      router.push(`${base}/products/new?from=photo`);
    },
  });
  const pick = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
    write.reset();
  };
  return (
    <>
      <Button icon={<Sparkles className="size-3.5" />} onClick={() => setOpen(true)}>
        From a photo
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a product from a photo"
        description="Upload one clear photo. We'll draft the title, description, tags and — for Indian stores — a suggested HSN code and GST rate. You review everything before it's saved."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Sparkles className="size-3.5" />} disabled={!file} loading={write.isPending} onClick={() => write.mutate()}>
              {write.isPending ? "Reading your photo…" : "Write my listing"}
            </Button>
          </>
        }
      >
        <label className={cx("grid min-h-56 cursor-pointer place-items-center overflow-hidden rounded-[18px] border-2 border-dashed border-border bg-surface-2 text-center transition-colors hover:border-border-strong", preview && "border-solid")}>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label="Product photo" />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
            <img src={preview} alt="The chosen product photo" className="max-h-72 w-full object-contain" />
          ) : (
            <span className="grid justify-items-center gap-2 p-6 text-[13px] text-muted">
              <ImagePlus className="size-7" />
              <span><span className="font-medium text-fg">Choose a photo</span> — JPEG, PNG or WebP, up to 5 MB</span>
              <span className="text-[12px]">Tip: one product, plain background, good light.</span>
            </span>
          )}
        </label>
        {write.isError && <p className="mt-3 text-[13px] text-danger">{errorMessage(write.error)}</p>}
        <p className="mt-3 text-[12px] text-muted">The AI describes only what it can see — it won&apos;t invent materials, sizes or claims, and it never sets prices or stock.</p>
      </Dialog>
    </>
  );
}
