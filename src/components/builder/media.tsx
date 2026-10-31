"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Crop, ImagePlus, Link2, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { colorsFromPixels, type WeightedColor } from "@/lib/site/brand";
import { PHOTOS, photoUrl } from "@/lib/site/media";
import { ConfirmDialog, Dialog, Segmented, Tabs, useToast } from "../ui/overlays";
import { Button, EmptyState, Field, IconButton, Input, Skeleton } from "../ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";

export type Asset = { id: string; url: string; filename: string; mime: string; size: number; width: number | null; height: number | null; createdAt: string };

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

export function useAssets(projectId: string) {
  return useQuery({ queryKey: ["assets", projectId], queryFn: () => api<{ assets: Asset[] }>(`/api/v1/projects/${projectId}/assets`).then((r) => r.assets) });
}

async function uploadBlob(projectId: string, blob: Blob, name: string): Promise<{ id: string; url: string; duplicate: boolean }> {
  const form = new FormData();
  form.append("file", blob, name);
  const res = await fetch(`/api/v1/projects/${projectId}/assets`, { method: "POST", body: form, credentials: "same-origin" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiClientError(res.status, json?.error?.code ?? "http_error", json?.error?.message ?? "Upload failed", json?.error?.details ?? null);
  return json.asset;
}

/** Loads an image (same-origin or CORS-enabled) and samples its colours. */
export async function colorsFromImageUrl(url: string): Promise<WeightedColor[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const size = 96;
  const canvas = document.createElement("canvas");
  const ratio = img.naturalWidth / img.naturalHeight || 1;
  canvas.width = ratio >= 1 ? size : Math.round(size * ratio);
  canvas.height = ratio >= 1 ? Math.round(size / ratio) : size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return colorsFromPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, 1);
}

const RATIOS: { value: string; label: string; r: number | null }[] = [
  { value: "original", label: "Original", r: null },
  { value: "1:1", label: "1:1", r: 1 },
  { value: "4:5", label: "4:5", r: 4 / 5 },
  { value: "4:3", label: "4:3", r: 4 / 3 },
  { value: "16:9", label: "16:9", r: 16 / 9 },
];

/** Crop by aspect ratio with zoom and drag-to-position, exported in the browser. */
function CropDialog({ file, src, onClose, onDone }: { file: File | null; src: string | null; onClose: () => void; onDone: (blob: Blob, name: string) => void }) {
  const [ratio, setRatio] = useState("original");
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const r = RATIOS.find((x) => x.value === ratio)!.r ?? natural.w / natural.h;
  // Visible crop window in source pixels.
  const baseW = natural.w / natural.h > r ? natural.h * r : natural.w;
  const cropW = baseW / zoom;
  const cropH = cropW / r;
  const cx = Math.min(Math.max(pos.x * natural.w - cropW / 2, 0), natural.w - cropW);
  const cy = Math.min(Math.max(pos.y * natural.h - cropH / 2, 0), natural.h - cropH);
  const previewW = 520;
  const previewH = previewW / r;
  const isGif = file?.type === "image/gif";

  const exportCrop = async () => {
    if (!src || !file) return;
    if (ratio === "original" && zoom === 1) return onDone(file, file.name);
    const img = new Image();
    img.src = src;
    await img.decode();
    const outW = Math.min(2400, Math.round(cropW));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = Math.round(outW / r);
    canvas.getContext("2d")!.drawImage(img, cx, cy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    canvas.toBlob((b) => b && onDone(b, file.name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg")), type, 0.88);
  };

  return (
    <Dialog open={!!file} onClose={onClose} title="Prepare image" description="Crop to a shape that suits the layout, or upload as is." size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={exportCrop} icon={<Upload className="size-3.5" />}>Upload</Button></>}>
      {src && (
        <div className="grid gap-4">
          {!isGif && <Segmented label="Aspect ratio" value={ratio} onChange={setRatio} options={RATIOS.map((x) => ({ value: x.value, label: x.label }))} />}
          <div
            className="relative mx-auto max-w-full cursor-grab touch-none overflow-hidden rounded-[var(--radius-md)] bg-surface-2 active:cursor-grabbing"
            style={{ width: previewW, height: previewH }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const k = cropW / previewW;
              setPos({ x: Math.min(1, Math.max(0, drag.current.px - ((e.clientX - drag.current.x) * k) / natural.w)), y: Math.min(1, Math.max(0, drag.current.py - ((e.clientY - drag.current.y) * k) / natural.h)) });
            }}
            onPointerUp={() => (drag.current = null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
            <img
              src={src}
              alt="Crop preview"
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="absolute max-w-none select-none"
              style={{ width: (natural.w / cropW) * previewW, left: (-cx / cropW) * previewW, top: (-cy / cropH) * previewH }}
            />
          </div>
          {!isGif && (
            <label className="flex items-center gap-3 text-[13px]">
              <Crop className="size-4 text-muted" aria-hidden />
              Zoom
              <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
            </label>
          )}
          <p className="text-xs text-subtle">Drag the image to position it. Images are limited to 5 MB; PNG, JPEG, WebP, GIF and AVIF are accepted.</p>
        </div>
      )}
    </Dialog>
  );
}

/** Upload button + drop zone + crop flow. */
export function Uploader({ projectId, onUploaded, compact }: { projectId: string; onUploaded?: (a: { id: string; url: string }) => void; compact?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const close = () => {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  };
  const [over, setOver] = useState(false);
  const upload = useMutation({
    mutationFn: ({ blob, name }: { blob: Blob; name: string }) => uploadBlob(projectId, blob, name),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
      toast({ tone: "success", title: a.duplicate ? "Already in your library" : "Image uploaded" });
      onUploaded?.(a);
    },
    onError: (e) => toast({ tone: "error", title: "Upload failed", description: errorMessage(e) }),
  });
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPT.split(",").includes(f.type)) return toast({ tone: "error", title: "Unsupported file", description: "Use PNG, JPEG, WebP, GIF or AVIF. SVG is not accepted for security reasons." });
    if (f.size > 5 * 1024 * 1024) return toast({ tone: "error", title: "Image too large", description: "The limit is 5 MB." });
    setPending({ file: f, url: URL.createObjectURL(f) });
  };
  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={clsx("flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed text-center transition-colors", compact ? "gap-1 p-4" : "gap-2 p-6", over ? "border-accent bg-accent-soft" : "border-border-strong bg-surface")}
      >
        {upload.isPending ? <Loader2 className="size-5 animate-spin text-muted" /> : <ImagePlus className="size-5 text-muted" aria-hidden />}
        <p className="text-[13px] font-medium">Drop an image here</p>
        <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          Browse files
        </Button>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Upload image" onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }} />
      </div>
      <CropDialog key={pending?.url ?? "none"} file={pending?.file ?? null} src={pending?.url ?? null} onClose={close} onDone={(blob, name) => {
        close();
        upload.mutate({ blob, name });
      }} />
    </>
  );
}

function AssetGrid({ projectId, onPick, selectable }: { projectId: string; onPick?: (a: Asset) => void; selectable?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const assets = useAssets(projectId);
  const [removing, setRemoving] = useState<Asset | null>(null);
  const remove = useMutation({
    mutationFn: (a: Asset) => api(`/api/v1/projects/${projectId}/assets/${a.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", projectId] });
      setRemoving(null);
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });
  if (assets.isPending) return <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-square" />)}</div>;
  if (assets.isError) return <p className="text-xs text-danger">{errorMessage(assets.error)}</p>;
  if (!assets.data.length) return <EmptyState title="No uploads yet" description="Your logo, photos of your place and your work belong here." className="py-6" />;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {assets.data.map((a) => (
          <div key={a.id} className="group relative">
            <button onClick={() => onPick?.(a)} disabled={!selectable} className="block aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2 enabled:hover:ring-2 enabled:hover:ring-accent/40" title={`${a.filename} · ${a.width ?? "?"}×${a.height ?? "?"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- user uploads served from /assets */}
              <img src={a.url} alt={a.filename} loading="lazy" className="size-full object-cover" />
            </button>
            {!selectable && (
              <IconButton label={`Delete ${a.filename}`} size="sm" className="absolute top-1 right-1 bg-surface/90 opacity-0 shadow-sm group-hover:opacity-100 focus:opacity-100" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(a)} />
            )}
          </div>
        ))}
      </div>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} destructive loading={remove.isPending} title="Delete this image?" description="Pages that use it will show a broken image until you choose another. Published sites keep working until the next deploy." confirmLabel="Delete" onConfirm={() => removing && remove.mutate(removing)} />
    </>
  );
}

/** Left-rail media library. */
export function MediaPanel({ projectId, readOnly }: { projectId: string; readOnly: boolean }) {
  return (
    <div className="grid gap-4 p-3">
      {!readOnly && <Uploader projectId={projectId} compact />}
      <AssetGrid projectId={projectId} />
      <p className="text-xs text-subtle">To place an image, select a section and choose it from the image field.</p>
    </div>
  );
}

/** Modal image chooser used by every image field. */
export function MediaPicker({ projectId, open, onClose, onPick }: { projectId: string; open: boolean; onClose: () => void; onPick: (url: string, alt?: string) => void }) {
  const [tab, setTab] = useState<"uploads" | "stock" | "url">("uploads");
  const [url, setUrl] = useState("");
  const [tag, setTag] = useState("all");
  const tags = ["all", ...Array.from(new Set(PHOTOS.flatMap((p) => p.tags))).sort()];
  const choose = useCallback(
    (u: string, alt?: string) => {
      onPick(u, alt);
      onClose();
    },
    [onPick, onClose],
  );
  return (
    <Dialog open={open} onClose={onClose} title="Choose an image" size="xl">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "uploads", label: "Your uploads" }, { value: "stock", label: "Stock photos" }, { value: "url", label: <><Link2 className="size-3.5" /> From URL</> }]} />
      <div className="mt-4 min-h-[360px]">
        {tab === "uploads" && (
          <div className="grid gap-4 md:grid-cols-[240px_1fr]">
            <Uploader projectId={projectId} onUploaded={(a) => choose(a.url)} />
            <div className="max-h-[50vh] overflow-y-auto">
              <AssetGrid projectId={projectId} selectable onPick={(a) => choose(a.url, a.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "))} />
            </div>
          </div>
        )}
        {tab === "stock" && (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <button key={t} onClick={() => setTag(t)} className={clsx("rounded-full border px-2.5 py-0.5 text-xs capitalize", tag === t ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:text-fg")}>
                  {t}
                </button>
              ))}
            </div>
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {PHOTOS.filter((p) => tag === "all" || p.tags.includes(tag)).map((p) => (
                <button key={p.id} onClick={() => choose(photoUrl(p.id, 1800), p.alt)} className="group relative aspect-[4/3] overflow-hidden rounded-[var(--radius-md)] border border-border hover:ring-2 hover:ring-accent/40" title={p.alt}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote stock thumbnails */}
                  <img src={photoUrl(p.id, 400, [4, 3])} alt={p.alt} loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
            <p className="text-xs text-subtle">Free Unsplash photos. Placeholders until you upload your own — real photos convert better.</p>
          </div>
        )}
        {tab === "url" && (
          <form className="grid max-w-lg gap-3" onSubmit={(e) => { e.preventDefault(); if (/^https:\/\//.test(url)) choose(url); }}>
            <Field label="Image address" hint="Must start with https://">{(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="font-mono text-xs" />}</Field>
            <Button type="submit" variant="primary" className="justify-self-start" disabled={!/^https:\/\//.test(url)} icon={<Check className="size-3.5" />}>
              Use image
            </Button>
          </form>
        )}
      </div>
    </Dialog>
  );
}
