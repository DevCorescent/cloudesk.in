"use client";

// Opening an uploaded file: PDFs in a real viewer (PDF.js — pages, text you
// can select, thumbnails, zoom, find), images with zoom and rotate, Word and
// Markdown laid out as pages, spreadsheets as tables (every sheet), slides'
// text, text and code with line numbers, a ZIP's contents. Around it: share,
// QR code, convert to another format, PDF tools, print and download — and ←/→
// to the previous or next file in the folder.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Download, FileCog, Info, Loader2, Maximize, Minus, MoreHorizontal, Plus, Printer, QrCode, RefreshCw, RotateCw, Share2, Wrench, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, useToast } from "@/components/ui/overlays";
import { api, errorMessage } from "@/lib/client/api";
import { familyOf, targetsFor } from "@/lib/documents/formats";
import { fmtBytes, KIND_LABEL, kindOf } from "@/lib/documents/write";
import { FileGlyph, ShareDialog, useDocsBase, useDriveRefresh, type DriveFile } from "../drive/shared";
import { ConvertDialog } from "./convert-dialog";
import { PdfTools } from "./pdf-tools";
import { PdfView } from "./pdf-view";
import { QrDialog } from "./qr-dialog";
import "../docs.css";

type Preview =
  | { type: "pdf"; pages: number }
  | { type: "image" }
  | { type: "html"; html: string; words: number }
  | { type: "text"; text: string; truncated: boolean }
  | { type: "sheet"; sheets: { name: string; rows: string[][]; total: number; cols: number }[] }
  | { type: "slides"; slides: { n: number; title: string; lines: string[] }[] }
  | { type: "zip"; entries: { name: string; size: number }[]; total: number }
  | { type: "none"; reason: string };

export function FileViewer({ file: start, files, onClose }: { file: DriveFile; files?: DriveFile[]; onClose: () => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const router = useRouter();
  const list = useMemo(() => (files ?? [start]).filter((f) => f.kind === "file"), [files, start]);
  const [id, setId] = useState(start.id);
  const [dialog, setDialog] = useState<null | "share" | "qr" | "convert" | "tools">(null);
  const [version, setVersion] = useState(0);
  const at = Math.max(0, list.findIndex((f) => f.id === id));
  const file = list[at] ?? start;
  const fam = familyOf(file);
  const q = useQuery({ queryKey: ["drive", "preview", file.id, file.version, version], queryFn: () => api<{ preview: Preview; filename: string; mime: string; size: number }>(`${base}/files/${file.id}/preview`), enabled: fam !== "pdf" && fam !== "image" });
  const src = `${base}/files/${file.id}/download?inline=1&v=${file.version}.${version}`;
  const move = useCallback(
    (d: number) => {
      if (list.length > 1) setId(list[(at + d + list.length) % list.length]!.id);
    },
    [list, at],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || (e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !e.metaKey) move(1);
      if (e.key === "ArrowLeft" && !e.metaKey) move(-1);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [dialog, move, onClose]);

  const print = async () => {
    try {
      const blob = await (await fetch(src, { credentials: "same-origin" })).blob();
      const url = URL.createObjectURL(blob);
      if (fam === "pdf") {
        // A hidden frame holding the PDF, printed from there (the browser's own PDF printing).
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
        frame.src = url;
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(() => (frame.remove(), URL.revokeObjectURL(url)), 60_000);
        };
        document.body.appendChild(frame);
      } else {
        const w = window.open("", "_blank", "noopener=no");
        if (!w) return;
        w.document.write(`<!doctype html><title>${file.title.replace(/</g, "&lt;")}</title><style>body{margin:0;display:grid;place-items:center}img{max-width:100%;max-height:100vh}</style><img src="${url}" onload="setTimeout(()=>print(),200)">`);
        w.document.close();
      }
    } catch (e) {
      toast({ tone: "error", title: "Couldn't print it", description: errorMessage(e) });
    }
  };
  const canConvert = targetsFor(fam).length > 0 || fam === "pdf" || fam === "image";
  const H = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[13px] font-medium text-white hover:bg-white/20 [&_svg]:size-4";

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#141416]/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Viewing ${file.title}`}>
      <div className="flex items-center gap-2 px-3 py-2.5 text-white sm:px-5">
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <X className="size-5" />
        </button>
        <FileGlyph f={file} size={30} className="max-sm:hidden" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{file.title}</p>
          <p className="truncate text-[11.5px] text-white/55">
            {KIND_LABEL[kindOf(file)]} · {fmtBytes(file.size)}
            {file.version > 1 ? ` · version ${file.version}` : ""}
            {list.length > 1 ? ` · ${at + 1} of ${list.length}` : ""}
          </p>
        </div>
        {file.role === "edit" && (
          <button type="button" onClick={() => setDialog("share")} className={clsx(H, "max-md:hidden")}>
            <Share2 /> Share
          </button>
        )}
        <button type="button" onClick={() => setDialog("qr")} className={clsx(H, "max-sm:!px-2.5")} aria-label="QR code">
          <QrCode /> <span className="max-sm:hidden">QR</span>
        </button>
        {canConvert && (
          <button type="button" onClick={() => setDialog("convert")} className={clsx(H, "max-md:hidden")}>
            <FileCog /> Convert
          </button>
        )}
        {fam === "pdf" && (
          <button type="button" onClick={() => setDialog("tools")} className={clsx(H, "max-sm:!px-2.5")} aria-label="PDF tools">
            <Wrench /> <span className="max-sm:hidden">PDF tools</span>
          </button>
        )}
        <a href={`${base}/files/${file.id}/download`} className={clsx(H, "max-sm:!px-2.5")} aria-label="Download">
          <Download /> <span className="max-lg:hidden">Download</span>
        </a>
        <Menu
          label="More"
          trigger={(p) => (
            <button {...p} type="button" aria-label="More" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
              <MoreHorizontal className="size-4" />
            </button>
          )}
          items={[
            ...(fam === "pdf" || fam === "image" ? [{ label: "Print", icon: <Printer />, onSelect: () => void print() }] : []),
            ...(canConvert ? [{ label: "Convert to another format", icon: <FileCog />, onSelect: () => setDialog("convert") }] : []),
            ...(file.role === "edit" ? [{ label: "Share", icon: <Share2 />, onSelect: () => setDialog("share") }] : []),
            { label: "Details, versions & signing", icon: <Info />, onSelect: () => (onClose(), router.push(`/documents/file/${file.id}`)) },
            { label: "Copy link", icon: <Share2 />, onSelect: () => void navigator.clipboard.writeText(`${window.location.origin}/documents/file/${file.id}`).then(() => toast({ tone: "success", title: "Link copied" })) },
            { label: "Reload", icon: <RefreshCw />, onSelect: () => setVersion((v) => v + 1) },
          ]}
        />
      </div>
      <div className="relative flex min-h-0 flex-1">
        {list.length > 1 && (
          <>
            <button type="button" aria-label="Previous file" onClick={() => move(-1)} className="absolute top-1/2 left-2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 max-sm:hidden">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" aria-label="Next file" onClick={() => move(1)} className="absolute top-1/2 right-2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60 max-sm:hidden">
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
        <div key={`${file.id}-${version}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {fam === "pdf" ? (
            <PdfView src={src} dark className="min-h-0 flex-1" />
          ) : fam === "image" ? (
            <ImageView src={src} title={file.title} />
          ) : !q.data ? (
            <div className="grid flex-1 place-items-center text-white/70">{q.isError ? <p className="text-[13px]">{errorMessage(q.error)}</p> : <Loader2 className="size-6 animate-spin" />}</div>
          ) : (
            <Body p={q.data.preview} downloadHref={`${base}/files/${file.id}/download`} filename={q.data.filename} />
          )}
        </div>
      </div>
      {dialog === "share" && <ShareDialog target={{ fileId: file.id, title: file.title }} onClose={() => setDialog(null)} />}
      {dialog === "qr" && <QrDialog file={file} onClose={() => setDialog(null)} />}
      {dialog === "convert" && <ConvertDialog file={file} onClose={() => setDialog(null)} />}
      {dialog === "tools" && (
        <PdfTools
          file={file}
          onClose={() => setDialog(null)}
          onSaved={(r) => {
            setDialog(null);
            refresh();
            if (!r.created) return setVersion((v) => v + 1);
            onClose();
            router.push(`/documents/file/${r.fileId}`);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

function ImageView({ src, title }: { src: string; title: string }) {
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [turn, setTurn] = useState(0);
  const b = "grid size-9 place-items-center rounded-full text-white/85 hover:bg-white/10";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-center gap-1 py-1 text-white">
        <button type="button" className={b} aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, (z === "fit" ? 1 : z) - 0.25))}>
          <Minus className="size-4" />
        </button>
        <button type="button" className="h-8 min-w-16 rounded-full px-2 text-[12px] font-medium hover:bg-white/10" onClick={() => setZoom("fit")}>
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <button type="button" className={b} aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(8, (z === "fit" ? 1 : z) + 0.25))}>
          <Plus className="size-4" />
        </button>
        <button type="button" className={b} aria-label="Actual size" onClick={() => setZoom(1)}>
          <Maximize className="size-4" />
        </button>
        <button type="button" className={b} aria-label="Rotate" onClick={() => setTurn((t) => (t + 90) % 360)}>
          <RotateCw className="size-4" />
        </button>
      </div>
      <div className={clsx("min-h-0 flex-1 overflow-auto p-4", zoom === "fit" && "grid place-items-center")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the drive's own private file */}
        <img src={src} alt={title} style={zoom === "fit" ? { transform: `rotate(${turn}deg)`, maxWidth: "100%", maxHeight: "100%" } : { transform: `rotate(${turn}deg) scale(${zoom})`, transformOrigin: "top left" }} className={clsx("rounded-[6px] object-contain shadow-2xl transition-transform", zoom !== "fit" && "max-w-none")} />
      </div>
    </div>
  );
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

function Body({ p, downloadHref, filename }: { p: Preview; downloadHref: string; filename: string }) {
  const [sheet, setSheet] = useState(0);
  if (p.type === "html")
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-0 py-0 md:px-6 md:py-8">
        <article className="doc-paper pageless" style={{ ["--paper" as string]: "#fff", ["--paper-ink" as string]: "#1d1d1f" }}>
          <div className="doc-content" dangerouslySetInnerHTML={{ __html: p.html }} />
        </article>
        <p className="py-4 text-center text-[11.5px] text-white/50">{p.words.toLocaleString("en-IN")} words · a preview — convert it to an editable document to change it here</p>
      </div>
    );
  if (p.type === "text") {
    const pretty = /\.json$/i.test(filename) ? tryJson(p.text) : p.text;
    const lines = pretty.split("\n");
    return (
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-6 sm:px-6">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-[12px] bg-[#1c1c1f] font-mono text-[12.5px] leading-[1.6] text-white/90 shadow-2xl">
          <table className="w-full border-collapse">
            <tbody>
              {lines.slice(0, 20000).map((l, i) => (
                <tr key={i}>
                  <td className="w-12 border-r border-white/10 pr-3 text-right align-top text-white/30 select-none">{i + 1}</td>
                  <td className="pl-3 break-all whitespace-pre-wrap">{l || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.truncated && <p className="py-3 text-center text-[12px] text-white/50">Showing the start of the file — download it for all of it.</p>}
      </div>
    );
  }
  if (p.type === "sheet") {
    const sh = p.sheets[sheet];
    if (!sh) return <Nothing reason="This spreadsheet is empty." href={downloadHref} />;
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-14">
        <div className="max-h-full min-h-0 w-fit max-w-full self-start overflow-auto rounded-[12px] bg-[var(--surface-solid)] text-fg shadow-2xl sm:self-center">
          <table className="viewer-sheet border-collapse text-[12.5px] tabular-nums">
            <thead>
              <tr>
                <th className="w-10" />
                {Array.from({ length: sh.cols }, (_, i) => (
                  <th key={i} className="text-center text-[11px] font-semibold text-subtle">
                    {colName(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sh.rows.map((r, i) => (
                <tr key={i} className={i === 0 ? "font-semibold" : undefined}>
                  <th className="text-right text-[11px]">{i + 1}</th>
                  {r.map((c, j) => (
                    <td key={j} title={c} className={/^-?[\d,.₹$%]+$/.test(c) ? "text-right" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto pt-2 [scrollbar-width:none]">
          {p.sheets.map((s, i) => (
            <button key={s.name} type="button" onClick={() => setSheet(i)} className={clsx("h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium", i === sheet ? "bg-white text-black" : "text-white/75 hover:bg-white/10")}>
              {s.name}
            </button>
          ))}
          <span className="ml-auto shrink-0 pl-3 text-[11.5px] text-white/50">{sh.total > sh.rows.length ? `First ${sh.rows.length} of ${sh.total} rows` : `${sh.total} rows`}</span>
        </div>
      </div>
    );
  }
  if (p.type === "slides")
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 sm:px-6">
        <div className="mx-auto grid max-w-4xl gap-4">
          {p.slides.map((s) => (
            <section key={s.n} className="aspect-video overflow-hidden rounded-[12px] bg-white p-[5%] text-[#1d1d1f] shadow-2xl">
              <p className="text-[11px] font-semibold text-black/35">Slide {s.n}</p>
              <h2 className="mt-1 text-[clamp(16px,2.6vw,28px)] leading-tight font-bold">{s.title}</h2>
              <ul className="mt-3 grid gap-1 text-[clamp(12px,1.5vw,16px)] text-black/75">
                {s.lines.slice(0, 12).map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            </section>
          ))}
          {!p.slides.length && <Nothing reason="No text in these slides." href={downloadHref} />}
          <p className="text-center text-[12px] text-white/50">The slides&apos; text — download the file to see the design.</p>
        </div>
      </div>
    );
  if (p.type === "zip")
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 sm:px-6">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-[12px] bg-[var(--surface-solid)] text-fg shadow-2xl">
          <p className="border-b border-border px-4 py-2.5 text-[12.5px] font-semibold">
            {p.total} file{p.total === 1 ? "" : "s"} inside
          </p>
          <ul className="divide-y divide-border">
            {p.entries.map((e) => (
              <li key={e.name} className="flex justify-between gap-3 px-4 py-2 text-[12.5px]">
                <span className="min-w-0 truncate font-mono">{e.name}</span>
                <span className="shrink-0 text-muted tabular-nums">{fmtBytes(e.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  return <Nothing reason={p.type === "none" ? p.reason : "This file can't be shown here."} href={downloadHref} />;
}

function Nothing({ reason, href }: { reason: string; href: string }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="max-w-sm rounded-[20px] bg-[var(--surface-solid)] p-8 text-center text-fg">
        <p className="text-[14px] font-semibold">No preview for this one</p>
        <p className="mt-1 text-[12.5px] text-muted">{reason}</p>
        <a href={href} className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-fg px-5 text-[13.5px] font-semibold text-bg">
          <Download className="size-4" /> Download
        </a>
      </div>
    </div>
  );
}

const tryJson = (t: string) => {
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
};
