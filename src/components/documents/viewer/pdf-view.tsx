"use client";

// A PDF, drawn by PDF.js: pages render as they scroll into view (sharp on
// high-density screens), with selectable text, thumbnails, page jumping, zoom
// (fit to width by default), rotation, and find across the whole document.
import type { PDFDocumentProxy } from "pdfjs-dist";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Loader2, Maximize, Minus, PanelLeft, Plus, RotateCw, Search, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { openPdf, pagesText, pdfjs, renderThumb } from "./pdfjs";

export type PdfHandle = { doc: PDFDocumentProxy | null };
type Size = { w: number; h: number };

export const PdfView = forwardRef<PdfHandle, { src: string | Uint8Array; className?: string; onLoaded?: (doc: PDFDocumentProxy) => void; dark?: boolean }>(function PdfView({ src, className, onLoaded, dark }, ref) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [rotation, setRotation] = useState(0);
  const [current, setCurrent] = useState(1);
  const [thumbs, setThumbs] = useState(false);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const [find, setFind] = useState<{ open: boolean; q: string; searched: string; hits: { page: number; text: string }[]; at: number; busy: boolean; texts: string[] | null }>({ open: false, q: "", searched: "", hits: [], at: 0, busy: false, texts: null });
  useImperativeHandle(ref, () => ({ doc }), [doc]);

  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    openPdf(src)
      .then(async (d) => {
        if (!alive) return void d.loadingTask.destroy();
        opened = d;
        // Each page's size first, so the scroll height is right before anything draws.
        const out: Size[] = [];
        for (let n = 1; n <= d.numPages; n++) {
          const vp = (await d.getPage(n)).getViewport({ scale: 1 });
          out.push({ w: vp.width, h: vp.height });
        }
        if (!alive) return;
        setSizes(out);
        setDoc(d);
        onLoaded?.(d);
      })
      .catch((e) => alive && setError(/password/i.test(String(e)) ? "This PDF is password-protected. Download it to open it with its password." : "This PDF couldn't be opened. Download it to open it on your device."));
    return () => {
      alive = false;
      void opened?.loadingTask.destroy();
    };
  }, [src, onLoaded]);

  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  const turned = rotation % 180 !== 0;
  const widest = useMemo(() => Math.max(1, ...sizes.map((s) => (turned ? s.h : s.w))), [sizes, turned]);
  // "Fit" fills the width, up to a comfortable reading size on wide screens.
  const scale = zoom === "fit" ? Math.max(0.3, Math.min(1.5, (width - 32) / widest)) : zoom;

  // Which page is in view.
  const pagesBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box;
    if (!el) return;
    const on = () => {
      const kids = [...(pagesBox.current?.children ?? [])] as HTMLElement[];
      const mid = el.scrollTop + el.clientHeight / 3;
      const i = kids.findIndex((k) => k.offsetTop + k.offsetHeight > mid);
      if (i >= 0) setCurrent(i + 1);
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [box, sizes]);

  const go = useCallback((n: number) => {
    const k = pagesBox.current?.children[n - 1] as HTMLElement | undefined;
    if (k && box) box.scrollTo({ top: k.offsetTop - 12, behavior: "smooth" });
  }, [box]);

  const runFind = async (q: string) => {
    if (!doc || !q.trim()) return setFind((f) => ({ ...f, q, searched: "", hits: [], at: 0 }));
    setFind((f) => ({ ...f, q, busy: true }));
    const texts = find.texts ?? (await pagesText(doc));
    const t = q.trim().toLowerCase();
    const hits: { page: number; text: string }[] = [];
    texts.forEach((tx, i) => {
      const flat = tx.replace(/\s+/g, " ");
      for (let at = flat.toLowerCase().indexOf(t); at >= 0 && hits.length < 500; at = flat.toLowerCase().indexOf(t, at + t.length)) hits.push({ page: i + 1, text: `${at > 30 ? "…" : ""}${flat.slice(Math.max(0, at - 30), at + t.length + 50)}` });
    });
    setFind((f) => ({ ...f, texts, hits, searched: q, at: 0, busy: false }));
    if (hits[0]) go(hits[0].page);
  };
  const step = (d: number) => {
    if (!find.hits.length) return;
    const at = (find.at + d + find.hits.length) % find.hits.length;
    setFind((f) => ({ ...f, at }));
    go(find.hits[at]!.page);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind((f) => ({ ...f, open: true }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) return <div className={clsx("grid place-items-center p-8 text-center text-[13.5px]", dark ? "text-white/80" : "text-muted", className)}>{error}</div>;
  const tool = clsx("grid size-8 place-items-center rounded-full", dark ? "text-white/85 hover:bg-white/10" : "text-muted hover:bg-fg/[0.06]");
  return (
    <div className={clsx("relative flex min-h-0 min-w-0 flex-col", className)}>
      <div className={clsx("flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] sm:px-3 [&>*]:shrink-0", dark ? "text-white" : "border-b border-border")}>
        <button type="button" className={clsx(tool, "max-md:hidden", thumbs && (dark ? "bg-white/15" : "bg-fg/[0.07]"))} aria-pressed={thumbs} aria-label="Pages" title="Pages" onClick={() => setThumbs((t) => !t)}>
          <PanelLeft className="size-4" />
        </button>
        <span className="flex items-center gap-1 text-[12.5px] tabular-nums">
          <input
            aria-label="Page"
            value={current}
            onChange={(e) => setCurrent(Number(e.target.value.replace(/\D/g, "")) || 1)}
            onKeyDown={(e) => e.key === "Enter" && go(Math.max(1, Math.min(sizes.length, current)))}
            className={clsx("h-7 w-10 rounded-[7px] text-center outline-none", dark ? "bg-white/10" : "bg-fg/[0.05]")}
          />
          <span className="opacity-60">/ {sizes.length || "…"}</span>
        </span>
        <span className="!shrink flex-1" />
        <button type="button" className={tool} aria-label="Zoom out" onClick={() => setZoom(Math.max(0.3, Math.round((scale - 0.15) * 100) / 100))}>
          <Minus className="size-4" />
        </button>
        <button type="button" onClick={() => setZoom("fit")} className={clsx("h-7 min-w-12 rounded-full px-1.5 text-[12px] font-medium tabular-nums", dark ? "hover:bg-white/10" : "hover:bg-fg/[0.06]")} title="Fit to width">
          {Math.round(scale * 100)}%
        </button>
        <button type="button" className={tool} aria-label="Zoom in" onClick={() => setZoom(Math.min(4, Math.round((scale + 0.15) * 100) / 100))}>
          <Plus className="size-4" />
        </button>
        <button type="button" className={clsx(tool, "max-sm:hidden")} aria-label="Fit to width" title="Fit to width" onClick={() => setZoom("fit")}>
          <Maximize className="size-4" />
        </button>
        <button type="button" className={tool} aria-label="Rotate view" title="Rotate view" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw className="size-4" />
        </button>
        <button type="button" className={clsx(tool, find.open && (dark ? "bg-white/15" : "bg-fg/[0.07]"))} aria-label="Find in PDF" title="Find (⌘F)" onClick={() => setFind((f) => ({ ...f, open: !f.open }))}>
          <Search className="size-4" />
        </button>
      </div>
      {find.open && (
        <div className="absolute top-12 right-3 z-20 w-[min(340px,calc(100%-24px))] rounded-[14px] border border-border bg-[var(--surface-solid)] p-2 text-fg shadow-xl">
          <div className="flex items-center gap-1">
            <input autoFocus value={find.q} onChange={(e) => setFind((f) => ({ ...f, q: e.target.value }))} onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (find.searched === find.q && find.hits.length) step(e.shiftKey ? -1 : 1);
                  else void runFind(find.q);
                } else if (e.key === "Escape") setFind((f) => ({ ...f, open: false }));
              }} placeholder="Find in this PDF" aria-label="Find in this PDF" className="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-bg px-2.5 text-[13px] outline-none" />
            {find.busy ? <Loader2 className="size-4 animate-spin text-muted" /> : <span className="w-12 text-center text-[11.5px] text-muted tabular-nums">{find.hits.length ? `${find.at + 1}/${find.hits.length}` : find.searched ? "0" : ""}</span>}
            <button type="button" className="doc-tool" aria-label="Previous match" onClick={() => step(-1)}>
              <ChevronUp />
            </button>
            <button type="button" className="doc-tool" aria-label="Next match" onClick={() => (find.searched === find.q && find.hits.length ? step(1) : void runFind(find.q))}>
              <ChevronDown />
            </button>
            <button type="button" className="doc-tool" aria-label="Close find" onClick={() => setFind((f) => ({ ...f, open: false }))}>
              <X />
            </button>
          </div>
          {find.hits.length > 0 && (
            <ul className="mt-1.5 max-h-52 overflow-y-auto">
              {find.hits.slice(0, 100).map((h, i) => (
                <li key={i}>
                  <button type="button" onClick={() => (setFind((f) => ({ ...f, at: i })), go(h.page))} className={clsx("flex w-full gap-2 rounded-[8px] px-2 py-1 text-left text-[12px]", i === find.at ? "bg-fg/[0.07]" : "hover:bg-fg/[0.04]")}>
                    <span className="shrink-0 text-muted tabular-nums">p.{h.page}</span>
                    <span className="truncate">{h.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {thumbs && doc && (
          <div className={clsx("w-[132px] shrink-0 overflow-y-auto p-3 max-md:hidden", dark ? "bg-black/20" : "border-r border-border")}>
            {sizes.map((_, i) => (
              <button key={i} type="button" onClick={() => go(i + 1)} className={clsx("mb-3 block w-full text-center text-[11px]", dark ? "text-white/70" : "text-muted")}>
                <Thumb doc={doc} n={i + 1} rotation={rotation} on={current === i + 1} />
                <span className="mt-1 block tabular-nums">{i + 1}</span>
              </button>
            ))}
          </div>
        )}
        <div ref={setBox} className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain px-4 py-4">
          {!doc ? (
            <div className={clsx("grid h-60 place-items-center", dark ? "text-white/70" : "text-muted")}>
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            <div ref={pagesBox} className="grid gap-4">
              {sizes.map((sz, i) => (
                <Page key={i} doc={doc} n={i + 1} size={sz} scale={scale} rotation={rotation} root={box} query={find.open ? find.searched : ""} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function Thumb({ doc, n, rotation, on }: { doc: PDFDocumentProxy; n: number; rotation: number; on: boolean }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e!.isIntersecting) return;
      io.disconnect();
      void renderThumb(doc, n, 100, rotation).then((c) => {
        if (!alive) return;
        el.replaceChildren(c);
      });
    });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [el, doc, n, rotation]);
  return <div ref={setEl} data-on={on} className="pdf-thumb mx-auto min-h-[130px] w-[100px] overflow-hidden rounded-[3px] bg-white shadow" />;
}

/** One page: a placeholder of the right size until it's near the screen, then canvas + selectable text. */
function Page({ doc, n, size, scale, rotation, root, query }: { doc: PDFDocumentProxy; n: number; size: Size; scale: number; rotation: number; root: HTMLElement | null; query: string }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const turned = rotation % 180 !== 0;
  const w = (turned ? size.h : size.w) * scale;
  const h = (turned ? size.w : size.h) * scale;
  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting), { root, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el, root]);
  useEffect(() => {
    if (!el || !visible) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      const m = await pdfjs();
      const page = await doc.getPage(n);
      if (cancelled) return;
      const vp = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      const r = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = r;
      try {
        await r.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      const text = document.createElement("div");
      text.className = "textLayer";
      text.style.setProperty("--scale-factor", String(scale));
      text.style.setProperty("--total-scale-factor", String(scale));
      el.replaceChildren(canvas, text);
      try {
        const tl = new m.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp });
        await tl.render();
        if (query.trim()) {
          const t = query.trim().toLowerCase();
          for (const span of text.querySelectorAll("span")) if (span.textContent?.toLowerCase().includes(t)) span.classList.add("pdf-hit");
        }
      } catch {
        /* text is optional */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [el, visible, doc, n, scale, rotation, query]);
  return <div ref={setEl} className="pdf-page" style={{ width: w, height: h }} aria-label={`Page ${n}`} role="img" />;
}
