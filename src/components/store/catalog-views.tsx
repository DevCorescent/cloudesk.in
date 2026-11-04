"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, Check, FolderTree, History, ImagePlus, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MediaPicker } from "@/components/builder/media";
import { ConfirmDialog, Dialog, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, IconButton, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { dateTime, timeAgo } from "@/lib/client/format";
import { storeApi, SubHeader, Table, td, useMoney, useStoreCtx, useStoreQuery } from "./shared";

// ─── Collections ─────────────────────────────────────────────────────────────

type Collection = { id: string; title: string; slug: string; description: string; image: string; sort: number; productCount: number };

export function CollectionsView() {
  const { projectId, base, can, liveUrl } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useStoreQuery<{ collections: Collection[] }>("collections");
  const [edit, setEdit] = useState<Partial<Collection> | null>(null);
  const [del, setDel] = useState<Collection | null>(null);
  const [picker, setPicker] = useState(false);
  const save = useMutation({
    mutationFn: (c: Partial<Collection>) => api(storeApi(projectId, c.id ? `collections/${c.id}` : "collections"), { method: c.id ? "PUT" : "POST", body: { title: c.title, slug: c.slug || undefined, description: c.description ?? "", image: c.image ?? "", sort: c.sort ?? 0 } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      setEdit(null);
      toast({ tone: "success", title: "Collection saved" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not save", description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `collections/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      setDel(null);
      toast({ tone: "success", title: "Collection deleted" });
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });

  return (
    <div>
      <SubHeader
        title="Collections"
        description="Categories that group your products, like “Dresses” or “Gift sets”. Each gets its own page at /shop/name."
        actions={can("store:manage") && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ title: "", description: "", image: "", sort: (list.data?.collections.length ?? 0) })}>Add collection</Button>}
      />
      {list.isPending ? (
        <Skeleton className="h-60" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.collections.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderTree className="size-5" />} title="No collections yet" description="Collections appear as categories in your shop and in “Shop by category” sections." />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.collections.map((c) => (
            <Card key={c.id} className="overflow-hidden">
              <div className="aspect-[16/9] bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- collection image */}
                {c.image && <img src={c.image} alt="" className="size-full object-cover" loading="lazy" />}
              </div>
              <div className="flex items-start justify-between gap-2 p-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.title}</p>
                  <p className="text-xs text-muted">
                    {c.productCount} active product{c.productCount === 1 ? "" : "s"} ·{" "}
                    {liveUrl ? (
                      <a href={`${liveUrl}/shop/${c.slug}`} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                        /shop/{c.slug}
                      </a>
                    ) : (
                      <span className="font-mono">/shop/{c.slug}</span>
                    )}
                  </p>
                  <Link href={`${base}/products?collection=${c.id}`} className="sr-only">
                    Products in {c.title}
                  </Link>
                </div>
                {can("store:manage") && (
                  <div className="flex shrink-0">
                    <IconButton size="sm" label={`Edit ${c.title}`} icon={<Pencil className="size-3.5" />} onClick={() => setEdit(c)} />
                    <IconButton size="sm" label={`Delete ${c.title}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDel(c)} />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit collection" : "New collection"}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} disabled={!edit?.title?.trim()} onClick={() => edit && save.mutate(edit)}>
              Save
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <Field label="Name">{(a) => <Input {...a} value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={80} autoFocus />}</Field>
            <Field label="Description (optional)">{(a) => <Textarea {...a} rows={2} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={2000} />}</Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium">Cover image</p>
              <div className="flex items-center gap-3">
                <div className="aspect-[16/9] w-40 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- collection image */}
                  {edit.image && <img src={edit.image} alt="" className="size-full object-cover" />}
                </div>
                <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => setPicker(true)}>
                  {edit.image ? "Change" : "Choose"}
                </Button>
                {edit.image && <IconButton size="sm" label="Remove image" icon={<X className="size-3.5" />} onClick={() => setEdit({ ...edit, image: "" })} />}
              </div>
            </div>
            <p className="text-xs text-muted">Add products to this collection from each product&apos;s page.</p>
          </div>
        )}
      </Dialog>
      <MediaPicker projectId={projectId} open={picker} onClose={() => setPicker(false)} onPick={(url) => edit && setEdit({ ...edit, image: url })} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} destructive title={`Delete “${del?.title}”?`} description="Products in it are kept; they are just no longer grouped. Links to this collection page will stop working." confirmLabel="Delete collection" />
    </div>
  );
}

// ─── Inventory ───────────────────────────────────────────────────────────────

type InvRow = { variantId: string; productId: string; product: string; variant: string; sku: string; image: string; trackInventory: boolean; stock: number; price: number; cost: number | null; reserved: number };

export function InventoryView() {
  const { projectId, base, can } = useStoreCtx();
  const money = useMoney();
  const [q, setQ] = useState("");
  const [low, setLow] = useState<"all" | "low">("all");
  const list = useStoreQuery<{ items: InvRow[]; threshold: number; stockValueAtCost: number }>(`inventory?${new URLSearchParams({ q, low: low === "low" ? "1" : "" })}`);
  const [adjust, setAdjust] = useState<InvRow | null>(null);
  const [history, setHistory] = useState<InvRow | null>(null);
  void projectId;

  return (
    <div>
      <SubHeader title="Inventory" description="Stock levels for every product and variant. Stock goes down automatically when orders are placed and back up when they are cancelled." />
      {list.data && (
        <div className="grid-cols-2 mb-4 grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-muted">Items tracked</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{list.data.items.filter((i) => i.trackInventory).length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Low or out of stock</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{list.data.items.filter((i) => i.trackInventory && i.stock <= list.data.threshold).length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">Stock value at cost</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{money(list.data.stockValueAtCost)}</p>
          </Card>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Search inventory" className="pl-8" placeholder="Search product or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented label="Filter" value={low} onChange={setLow} options={[{ value: "all", label: "All" }, { value: "low", label: "Low stock" }]} />
      </div>
      {list.isPending ? (
        <Skeleton className="h-72" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <Table head={["Product", "SKU", "Held for checkout", "In stock", ""]} empty={list.data.items.length === 0 && <EmptyState icon={<Boxes className="size-5" />} title={low === "low" ? "Nothing is running low" : "No products yet"} />}>
          {list.data.items.map((r) => (
            <tr key={r.variantId}>
              <td className={td}>
                <Link href={`${base}/products/${r.productId}`} className="flex items-center gap-3 hover:underline">
                  <span className="size-9 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-border bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- product image */}
                    {r.image && <img src={r.image} alt="" className="size-full object-cover" loading="lazy" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.product}</span>
                    {r.variant !== "Default" && <span className="block truncate text-xs text-muted">{r.variant}</span>}
                  </span>
                </Link>
              </td>
              <td className={`${td} font-mono text-xs text-muted`}>{r.sku || "—"}</td>
              <td className={`${td} tabular-nums text-muted`} title="Units in unpaid online orders still inside their payment window">
                {r.reserved || "—"}
              </td>
              <td className={`${td} tabular-nums`}>{!r.trackInventory ? <span className="text-muted">Not tracked</span> : <span className={cx("font-medium", r.stock <= 0 ? "text-danger" : r.stock <= list.data.threshold ? "text-warning" : "")}>{r.stock}</span>}</td>
              <td className={`${td} text-right whitespace-nowrap`}>
                <IconButton size="sm" label="Stock history" icon={<History className="size-3.5" />} onClick={() => setHistory(r)} />
                {can("store:manage") && r.trackInventory && (
                  <Button size="sm" onClick={() => setAdjust(r)}>
                    Adjust
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <AdjustDialog row={adjust} onClose={() => setAdjust(null)} />
      <HistoryDialog row={history} onClose={() => setHistory(null)} />
    </div>
  );
}

function AdjustDialog({ row, onClose }: { row: InvRow | null; onClose: () => void }) {
  const { projectId } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"add" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("Received stock");
  const n = Math.trunc(Number(qty));
  const run = useMutation({
    mutationFn: () => api<{ stock: number }>(storeApi(projectId, `inventory/${row!.variantId}`), { method: "POST", body: { mode, quantity: n, reason } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      toast({ tone: "success", title: `Stock is now ${r.stock}` });
      setQty("");
      onClose();
    },
    onError: (e) => toast({ tone: "error", title: "Could not adjust stock", description: errorMessage(e) }),
  });
  return (
    <Dialog
      open={!!row}
      onClose={onClose}
      title={`Adjust stock — ${row?.product ?? ""}`}
      description={row && row.variant !== "Default" ? row.variant : undefined}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} disabled={qty === "" || Number.isNaN(n) || (mode === "add" && n === 0) || (mode === "set" && n < 0)} onClick={() => run.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented label="Adjustment type" value={mode} onChange={(m) => { setMode(m); setReason(m === "set" ? "Stock count" : "Received stock"); }} options={[{ value: "add", label: "Add or remove" }, { value: "set", label: "Set exact count" }]} />
        <Field label={mode === "add" ? "Quantity (use a minus sign to remove)" : "New stock count"} hint={row ? `Currently ${row.stock}${qty !== "" && !Number.isNaN(n) ? ` → ${mode === "add" ? row.stock + n : n}` : ""}` : undefined}>
          {(a) => <Input {...a} type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />}
        </Field>
        <Field label="Reason">
          {(a) => (
            <Select {...a} value={reason} onChange={(e) => setReason(e.target.value)}>
              {["Received stock", "Stock count", "Damaged", "Returned by customer", "Lost or stolen", "Correction"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: InvRow | null; onClose: () => void }) {
  const q = useStoreQuery<{ history: { id: string; delta: number; reason: string; ref: string | null; createdAt: string; actorName: string | null }[] }>(`inventory/${row?.variantId}/history`, { enabled: !!row });
  return (
    <Dialog open={!!row} onClose={onClose} title={`Stock history — ${row?.product ?? ""}`} description={row && row.variant !== "Default" ? row.variant : undefined}>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : q.data.history.length === 0 ? (
        <p className="text-[13px] text-muted">No changes recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border text-[13px]">
          {q.data.history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p>
                  {h.reason}
                  {h.ref && <span className="text-muted"> · {h.ref}</span>}
                </p>
                <p className="text-xs text-subtle" title={dateTime(h.createdAt)}>
                  {h.actorName ?? "System"} · {timeAgo(h.createdAt)}
                </p>
              </div>
              <span className={cx("font-medium tabular-nums", h.delta > 0 ? "text-success" : "text-danger")}>
                {h.delta > 0 ? "+" : ""}
                {h.delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

type Review = { id: string; name: string; rating: number; title: string; body: string; verified: boolean; status: string; createdAt: string; productId: string; product: string };

export function ReviewsView() {
  const { projectId, base, can } = useStoreCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const list = useStoreQuery<{ reviews: Review[] }>(`reviews?status=${status}`);
  const [del, setDel] = useState<Review | null>(null);
  const moderate = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => api(storeApi(projectId, `reviews/${id}`), { method: "PUT", body: { status: s } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", projectId] }),
    onError: (e) => toast({ tone: "error", title: "Could not update", description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(storeApi(projectId, `reviews/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store", projectId] });
      setDel(null);
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });
  return (
    <div>
      <SubHeader title="Reviews" description="Reviews customers leave on product pages. Nothing is shown publicly until you approve it." actions={<Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "pending", label: "To review" }, { value: "approved", label: "Published" }, { value: "rejected", label: "Hidden" }]} />} />
      {list.isPending ? (
        <Skeleton className="h-60" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.reviews.length === 0 ? (
        <Card>
          <EmptyState icon={<Star className="size-5" />} title={status === "pending" ? "No reviews waiting" : status === "approved" ? "No published reviews yet" : "No hidden reviews"} description="Customers can review products from each product page. Reviews from buyers are marked “Verified buyer”." />
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.data.reviews.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex text-warning" aria-label={`${r.rating} out of 5 stars`}>
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star key={i} className={cx("size-3.5", i < r.rating ? "fill-current" : "opacity-30")} aria-hidden />
                      ))}
                    </span>
                    {r.verified && <Badge tone="success">Verified buyer</Badge>}
                  </div>
                  {r.title && <p className="mt-1.5 text-sm font-semibold">{r.title}</p>}
                  <p className="mt-1 text-[13px] whitespace-pre-wrap">{r.body}</p>
                  <p className="mt-2 text-xs text-muted">
                    {r.name} on{" "}
                    <Link href={`${base}/products/${r.productId}`} className="hover:underline">
                      {r.product}
                    </Link>{" "}
                    · {timeAgo(r.createdAt)}
                  </p>
                </div>
                {can("store:manage") && (
                  <div className="flex shrink-0 gap-1.5">
                    {r.status !== "approved" && (
                      <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => moderate.mutate({ id: r.id, s: "approved" })}>
                        Publish
                      </Button>
                    )}
                    {r.status !== "rejected" && (
                      <Button size="sm" onClick={() => moderate.mutate({ id: r.id, s: "rejected" })}>
                        Hide
                      </Button>
                    )}
                    <IconButton size="sm" label="Delete review" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(r)} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} loading={remove.isPending} destructive title="Delete this review?" description="It is removed permanently. Hide it instead if you might want it later." confirmLabel="Delete" />
    </div>
  );
}

