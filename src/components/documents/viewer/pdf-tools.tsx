"use client";

// PDF tools: a page grid to select, rotate, delete and drag pages into a new
// order (saved as one new version — the old one is kept — or as a copy), and
// extract, split, merge with other PDFs, watermark, number pages, or export
// pages as images. Thumbnails are drawn by PDF.js; changes are made on the
// server with pdf-lib.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Combine, Copy, Droplets, FileImage, Hash, Loader2, RotateCcw, RotateCw, Scissors, SquareDashed, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/overlays";
import { Button, Input, Select } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { DocumentPicker } from "../picker";
import { downloadUrl, useDocsBase, useDriveRefresh, type DriveFile } from "../drive/shared";
import { openPdf, pageImage, renderThumb } from "./pdfjs";

type Slot = { page: number; rotate: 0 | 90 | 180 | 270 };
type Panel = null | "watermark" | "number" | "split" | "images";

export function PdfTools({ file, onClose, onSaved }: { file: DriveFile; onClose: () => void; onSaved: (r: { fileId: string; created: boolean }) => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [merging, setMerging] = useState(false);
  const [wm, setWm] = useState({ text: "CONFIDENTIAL", opacity: 0.15 });
  const [num, setNum] = useState<{ position: "bottom-center" | "bottom-right" | "top-right"; format: "n" | "n-of-m" | "page-n" }>({ position: "bottom-center", format: "n-of-m" });
  const [every, setEvery] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = file.role === "edit";

  useEffect(() => {
    let alive = true;
    let d: PDFDocumentProxy | null = null;
    openPdf(`${base}/files/${file.id}/download?inline=1&v=${file.version}`)
      .then((x) => {
        if (!alive) return void x.loadingTask.destroy();
        d = x;
        setDoc(x);
        setSlots(Array.from({ length: x.numPages }, (_, i) => ({ page: i + 1, rotate: 0 })));
      })
      .catch(() => toast({ tone: "error", title: "This PDF couldn't be opened" }));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      alive = false;
      void d?.loadingTask.destroy();
      document.removeEventListener("keydown", esc);
    };
  }, [base, file.id, file.version, toast, onClose]);

  const original = doc?.numPages ?? 0;
  const changed = useMemo(() => slots.length !== original || slots.some((s, i) => s.page !== i + 1 || s.rotate), [slots, original]);
  const chosen = slots.filter((s) => sel.has(s.page));
  const targets = chosen.length ? chosen : slots;

  const click = (i: number, e: React.MouseEvent) => {
    // On touch, each tap adds to (or takes from) the selection.
    const touch = (e.nativeEvent as PointerEvent).pointerType === "touch";
    const page = slots[i]!.page;
    const next = new Set(sel);
    if (e.shiftKey && anchor !== null) {
      const a = slots.findIndex((s) => s.page === anchor);
      const [x, y] = [Math.min(a, i), Math.max(a, i)];
      for (const s of slots.slice(x, y + 1)) next.add(s.page);
    } else if (e.metaKey || e.ctrlKey || touch) {
      if (next.has(page)) next.delete(page);
      else next.add(page);
      setAnchor(page);
    } else {
      next.clear();
      next.add(page);
      setAnchor(page);
    }
    setSel(next);
  };
  const rotate = (d: 90 | -90) => setSlots((xs) => xs.map((s) => (targets.includes(s) ? { ...s, rotate: (((s.rotate + d + 360) % 360) as Slot["rotate"]) } : s)));
  const remove = () => {
    if (chosen.length === slots.length) return toast({ tone: "error", title: "A PDF needs at least one page" });
    setSlots((xs) => xs.filter((s) => !sel.has(s.page)));
    setSel(new Set());
  };
  const drop = (to: number) => {
    if (drag === null) return;
    setSlots((xs) => {
      const moving = sel.has(xs[drag]!.page) ? xs.filter((s) => sel.has(s.page)) : [xs[drag]!];
      const rest = xs.filter((s) => !moving.includes(s));
      const at = rest.findIndex((s) => s === xs[to]);
      rest.splice(at < 0 ? rest.length : at, 0, ...moving);
      return rest;
    });
    setDrag(null);
    setOver(null);
  };

  const tool = useMutation({
    mutationFn: async (b: Record<string, unknown> & { label: string }) => {
      setBusy(b.label);
      // (The label is for the toast; the server ignores it.)
      return api<{ fileId?: string; fileIds?: string[]; created?: boolean; version?: number }>(`${base}/pdf`, { method: "POST", body: b });
    },
    onSuccess: (r, b) => {
      setBusy(null);
      refresh();
      toast({ tone: "success", title: b.label, description: r.created ? (r.fileIds ? `${r.fileIds.length} new files, next to the original` : "Saved as a new file next to the original") : `Saved as version ${r.version} — the earlier version is kept` });
      if (r.fileId) onSaved({ fileId: r.fileId, created: !!r.created });
      else onClose();
    },
    onError: (e) => {
      setBusy(null);
      toast({ tone: "error", title: "That didn't work", description: errorMessage(e) });
    },
  });
  const save = (saveAs: "version" | "copy") => tool.mutate({ op: "edit", fileId: file.id, pages: slots.map((s) => ({ page: s.page, rotate: s.rotate })), saveAs, label: saveAs === "version" ? "Changes saved" : "Copy saved" });
  const exportImages = async (type: "image/png" | "image/jpeg") => {
    if (!doc) return;
    setBusy("Exporting pages");
    try {
      for (const s of targets.slice(0, 100)) {
        const blob = await pageImage(doc, s.page, type, 2);
        downloadUrl(URL.createObjectURL(blob), `${file.title} page ${s.page}.${type === "image/png" ? "png" : "jpg"}`);
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e) {
      toast({ tone: "error", title: "Couldn't export the pages", description: errorMessage(e) });
    }
    setBusy(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col bg-[#101012] text-white" role="dialog" aria-modal="true" aria-label={`PDF tools — ${file.title}`}>
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5 sm:px-5">
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">PDF tools · {file.title}</p>
          <p className="text-[11.5px] text-white/55 tabular-nums">
            {slots.length} page{slots.length === 1 ? "" : "s"}
            {chosen.length ? ` · ${chosen.length} selected` : " · click pages to select, drag to reorder"}
          </p>
        </div>
        {changed && (
          <>
            <Button size="sm" variant="ghost" className="!text-white/80" icon={<Undo2 className="size-3.5" />} onClick={() => (setSlots(Array.from({ length: original }, (_, i) => ({ page: i + 1, rotate: 0 }))), setSel(new Set()))}>
              <span className="max-sm:hidden">Undo all</span>
            </Button>
            <Button size="sm" onClick={() => save("copy")} disabled={!!busy}>
              Save as copy
            </Button>
            {canEdit && (
              <button type="button" disabled={!!busy} onClick={() => save("version")} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/90 disabled:opacity-60">
                {busy === "Changes saved" && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-white/10 px-2 py-1.5 [scrollbar-width:none] sm:px-4">
        <Btn icon={<SquareDashed />} label={sel.size === slots.length ? "Select none" : "Select all"} onClick={() => setSel(sel.size === slots.length ? new Set() : new Set(slots.map((s) => s.page)))} />
        <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
        <Btn icon={<RotateCcw />} label="Rotate left" onClick={() => rotate(-90)} />
        <Btn icon={<RotateCw />} label="Rotate right" onClick={() => rotate(90)} />
        <Btn icon={<Trash2 />} label="Delete" onClick={remove} disabled={!chosen.length} danger />
        <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
        <Btn icon={<Copy />} label="Extract" onClick={() => tool.mutate({ op: "extract", fileId: file.id, pages: chosen.map((s) => s.page), label: "Pages extracted" })} disabled={!chosen.length || !!busy} />
        <Btn icon={<Scissors />} label="Split" onClick={() => setPanel(panel === "split" ? null : "split")} />
        <Btn icon={<Combine />} label="Merge" onClick={() => setMerging(true)} />
        <Btn icon={<Droplets />} label="Watermark" onClick={() => setPanel(panel === "watermark" ? null : "watermark")} />
        <Btn icon={<Hash />} label="Page numbers" onClick={() => setPanel(panel === "number" ? null : "number")} />
        <Btn icon={<FileImage />} label="Export images" onClick={() => setPanel(panel === "images" ? null : "images")} />
        {busy && (
          <span className="ml-2 inline-flex items-center gap-1.5 text-[12px] text-white/70">
            <Loader2 className="size-3.5 animate-spin" /> {busy}…
          </span>
        )}
      </div>
      {panel && (
        <div className="flex flex-wrap items-end gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3 text-[12.5px] [&_input]:!bg-white/10 [&_input]:!text-white [&_select]:!bg-white/10 [&_select]:!text-white">
          {panel === "split" && (
            <>
              <label className="grid gap-1">
                <span className="text-white/60">Pages in each file</span>
                <Input type="number" min={1} max={500} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} className="!h-9 !w-28" />
              </label>
              <Button size="sm" className="!border-0 !bg-white !text-black hover:!bg-white/90" loading={busy === "PDF split"} onClick={() => tool.mutate({ op: "split", fileId: file.id, every, label: "PDF split" })}>
                Split into {Math.ceil(original / every)} file{Math.ceil(original / every) === 1 ? "" : "s"}
              </Button>
              <span className="text-white/50">Uses the saved PDF (save your page changes first).</span>
            </>
          )}
          {panel === "watermark" && (
            <>
              <label className="grid gap-1">
                <span className="text-white/60">Text</span>
                <Input value={wm.text} maxLength={60} onChange={(e) => setWm({ ...wm, text: e.target.value })} className="!h-9 !w-56" />
              </label>
              <label className="grid gap-1">
                <span className="text-white/60">Strength</span>
                <input type="range" min={0.05} max={0.5} step={0.05} value={wm.opacity} onChange={(e) => setWm({ ...wm, opacity: Number(e.target.value) })} className="w-36 accent-white" aria-label="Watermark strength" />
              </label>
              <Button size="sm" className="!border-0 !bg-white !text-black hover:!bg-white/90" disabled={!wm.text.trim()} loading={busy === "Watermark added"} onClick={() => tool.mutate({ op: "watermark", fileId: file.id, text: wm.text, opacity: wm.opacity, saveAs: "copy", label: "Watermark added" })}>
                Add as a copy
              </Button>
              {canEdit && (
                <Button size="sm" onClick={() => tool.mutate({ op: "watermark", fileId: file.id, text: wm.text, opacity: wm.opacity, saveAs: "version", label: "Watermark added" })} disabled={!wm.text.trim() || !!busy}>
                  Add to this PDF
                </Button>
              )}
            </>
          )}
          {panel === "number" && (
            <>
              <label className="grid gap-1">
                <span className="text-white/60">Where</span>
                <Select value={num.position} onChange={(e) => setNum({ ...num, position: e.target.value as typeof num.position })} className="!h-9">
                  <option value="bottom-center">Bottom centre</option>
                  <option value="bottom-right">Bottom right</option>
                  <option value="top-right">Top right</option>
                </Select>
              </label>
              <label className="grid gap-1">
                <span className="text-white/60">Style</span>
                <Select value={num.format} onChange={(e) => setNum({ ...num, format: e.target.value as typeof num.format })} className="!h-9">
                  <option value="n-of-m">1 / 12</option>
                  <option value="n">1</option>
                  <option value="page-n">Page 1</option>
                </Select>
              </label>
              <Button size="sm" className="!border-0 !bg-white !text-black hover:!bg-white/90" loading={busy === "Page numbers added"} onClick={() => tool.mutate({ op: "number", fileId: file.id, ...num, saveAs: canEdit ? "version" : "copy", label: "Page numbers added" })}>
                Add page numbers
              </Button>
            </>
          )}
          {panel === "images" && (
            <>
              <span className="text-white/70">{chosen.length ? `${chosen.length} selected page${chosen.length === 1 ? "" : "s"}` : "Every page"} as pictures, downloaded to this device.</span>
              <Button size="sm" className="!border-0 !bg-white !text-black hover:!bg-white/90" onClick={() => void exportImages("image/png")} disabled={!!busy}>
                PNG
              </Button>
              <Button size="sm" onClick={() => void exportImages("image/jpeg")} disabled={!!busy}>
                JPG
              </Button>
            </>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" onClick={(e) => e.target === e.currentTarget && setSel(new Set())}>
        {!doc ? (
          <div className="grid h-60 place-items-center text-white/60">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-4">
            {slots.map((s, i) => (
              <div
                key={s.page}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => (e.preventDefault(), setOver(i))}
                onDragLeave={() => setOver((o) => (o === i ? null : o))}
                onDrop={(e) => (e.preventDefault(), drop(i))}
                onClick={(e) => click(i, e)}
                className={clsx("group relative cursor-pointer rounded-[12px] p-2 transition-colors select-none", sel.has(s.page) ? "bg-[#7c5cdb]/30 ring-2 ring-[#9d84ee]" : "hover:bg-white/[0.06]", over === i && drag !== null && drag !== i && "ring-2 ring-white/70")}
              >
                <div className="grid aspect-[3/4] place-items-center overflow-hidden">
                  <div style={{ transform: `rotate(${s.rotate}deg)${s.rotate % 180 ? " scale(0.74)" : ""}`, transition: "transform .2s" }}>
                    <Thumb doc={doc} page={s.page} />
                  </div>
                </div>
                <p className="mt-1.5 text-center text-[11.5px] text-white/70 tabular-nums">
                  {i + 1}
                  {s.page !== i + 1 && <span className="text-white/40"> (was {s.page})</span>}
                </p>
                {sel.has(s.page) && (
                  <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-[#7c5cdb] text-white">
                    <Check className="size-3" />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {merging && <DocumentPicker title="Merge with other PDFs" action="Merge" onClose={() => setMerging(false)} onPick={(fs) => tool.mutate({ op: "merge", fileIds: [file.id, ...fs.filter((f) => f.mime === "application/pdf" && f.id !== file.id).map((f) => f.id)], label: "PDFs merged" })} />}
    </div>,
    document.body,
  );
}

function Btn({ icon, label, onClick, disabled, danger }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={clsx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium disabled:opacity-40 [&_svg]:size-4", danger ? "text-red-300 hover:bg-red-500/15" : "text-white/90 hover:bg-white/10")}>
      {icon}
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

function Thumb({ doc, page }: { doc: PDFDocumentProxy; page: number }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e!.isIntersecting) return;
      io.disconnect();
      void renderThumb(doc, page, 116).then((c) => alive && el.replaceChildren(c));
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [el, doc, page]);
  return <div ref={setEl} className="min-h-[150px] w-[116px] overflow-hidden rounded-[3px] bg-white shadow-[0_6px_18px_-8px_rgb(0_0_0/0.7)]" />;
}
