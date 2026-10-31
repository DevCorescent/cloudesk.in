"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { VIEWPORT_WIDTH, type Breakpoint, type Page, type SiteDoc } from "@/lib/site/model";
import { canvasParts, renderPage } from "@/lib/site/render";
import type { Catalog } from "@/lib/store/storefront";

export type CanvasRect = { top: number; height: number; vh: number } | null;
/** What's being dragged into the canvas: a section type from the gallery ("type:hero"), a global ("global:<id>"), or a section from the clipboard. */
export const DRAG_MIME = "application/x-cc-section";
type Slot = { id: string; top: number; height: number };

/**
 * The editing canvas: the real renderer's output in a sandboxed iframe
 * (scripts allowed, no same-origin, so it cannot reach the app or cookies).
 * After the first load, edits are patched in place to avoid flicker and keep
 * scroll position. `overlay` renders above the frame in canvas coordinates.
 */
export function Canvas({
  doc,
  page,
  viewport,
  selectedId,
  onSelect,
  interactive,
  overlay,
  catalog,
  selectedElement,
  onElement,
  onText,
  onDropSection,
  onMoveSection,
}: {
  doc: SiteDoc;
  page: Page;
  viewport: Breakpoint;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  interactive: boolean;
  overlay?: (geo: { rect: CanvasRect; scale: number; frameTop: number; frameLeft: number; frameWidth: number; startMove?: (id: string) => void }) => ReactNode;
  /** Live store catalog so product grids show real products while editing. */
  catalog?: Catalog | null;
  /** Field path of the selected element inside the selected section. */
  selectedElement?: string | null;
  onElement?: (sectionId: string, path: string) => void;
  /** Text typed in place on the canvas. */
  onText?: (sectionId: string, path: string, value: string) => void;
  /** A section dragged in from the gallery, dropped before section number `index`. */
  onDropSection?: (payload: string, index: number) => void;
  /** A section dragged by its handle to a new place. `index` counts positions before the move. */
  onMoveSection?: (id: string, index: number) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const [boxWidth, setBoxWidth] = useState(1000);
  const [boxHeight, setBoxHeight] = useState(800);
  const [rect, setRect] = useState<CanvasRect>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  // Dragging: a new section from the gallery, or an existing one by its handle.
  const [drag, setDrag] = useState<{ kind: "new" } | { kind: "move"; id: string } | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const html = useMemo(() => renderPage(doc, page, interactive ? { kind: "editor", selectedId } : { kind: "preview" }, { catalog }), [doc, page, selectedId, interactive, catalog]);

  // The initial document only changes when switching page or mode; later edits are patches.
  const [initial, setInitial] = useState(html);
  const initialKey = `${page.id}:${interactive}`;
  const [loadedKey, setLoadedKey] = useState(initialKey);
  if (loadedKey !== initialKey) {
    setLoadedKey(initialKey);
    setInitial(html);
  }

  const latest = useRef({ html, selectedId, interactive, onSelect, onElement, onText, selectedElement });
  useEffect(() => {
    latest.current = { html, selectedId, interactive, onSelect, onElement, onText, selectedElement };
  });

  useEffect(() => {
    ready.current = false;
  }, [initial]);

  useEffect(() => {
    const post = () => {
      const l = latest.current;
      if (!ready.current || !l.interactive) return;
      const { style, main, fonts } = canvasParts(l.html);
      frame.current?.contentWindow?.postMessage({ source: "cc-editor", type: "patch", style, main, fonts, id: l.selectedId, el: l.selectedElement ?? null }, "*");
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; id?: string | null; top?: number; height?: number; vh?: number; path?: string; value?: string; items?: Slot[] };
      if (d?.source !== "cc-canvas") return;
      if (d.type === "ready") {
        ready.current = true;
        post();
      } else if (d.type === "select") latest.current.onSelect(typeof d.id === "string" ? d.id : null);
      else if (d.type === "element" && typeof d.id === "string" && typeof d.path === "string") {
        latest.current.onSelect(d.id);
        latest.current.onElement?.(d.id, d.path);
      } else if (d.type === "text" && typeof d.id === "string" && typeof d.path === "string" && typeof d.value === "string") latest.current.onText?.(d.id, d.path, d.value.slice(0, 4000));
      else if (d.type === "layout" && Array.isArray(d.items)) setSlots(d.items.filter((x) => typeof x.id === "string" && typeof x.top === "number" && typeof x.height === "number").slice(0, 300));
      else if (d.type === "rect") setRect(d.id && typeof d.top === "number" ? { top: d.top, height: d.height ?? 0, vh: d.vh ?? 0 } : null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const lastSelected = useRef(selectedId);
  useEffect(() => {
    if (!ready.current || !interactive) return;
    const win = frame.current?.contentWindow;
    const { style, main, fonts } = canvasParts(html);
    win?.postMessage({ source: "cc-editor", type: "patch", style, main, fonts, id: selectedId, el: selectedElement ?? null }, "*");
    // A new selection (e.g. from the layers list) scrolls it into view.
    if (selectedId !== lastSelected.current && selectedId) win?.postMessage({ source: "cc-editor", type: "select", id: selectedId }, "*");
    lastSelected.current = selectedId;
  }, [html, selectedId, interactive, selectedElement]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBoxWidth(entry.contentRect.width);
      setBoxHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A move released outside the canvas, or Escape, cancels it rather than leaving it stuck.
  const moving = drag?.kind === "move";
  useEffect(() => {
    if (!moving) return;
    const cancel = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setDrag(null);
      setDropAt(null);
    };
    window.addEventListener("pointerup", cancel);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [moving]);

  // A drag that starts in the section gallery turns on the drop layer over the frame.
  useEffect(() => {
    const start = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(DRAG_MIME)) setDrag({ kind: "new" });
    };
    const end = () => {
      setDrag((d) => (d?.kind === "new" ? null : d));
      setDropAt(null);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);

  const width = VIEWPORT_WIDTH[viewport];
  const pad = viewport === "desktop" ? 32 : 48;
  const scale = Math.min(1, (boxWidth - pad * 2) / width);
  const frameTop = 20;
  const frameHeight = Math.max(400, (boxHeight - frameTop - 20) / scale);
  const frameLeft = (boxWidth - width * scale) / 2;

  // Sections in page order with where they sit; navigation and banner stay first, the footer last.
  const ordered = page.sections.map((sec) => ({ sec, slot: slots.find((x) => x.id === sec.id) })).filter((x): x is { sec: (typeof page.sections)[number]; slot: Slot } => !!x.slot);
  const lead = (() => {
    let n = 0;
    while (n < page.sections.length && (page.sections[n].type === "navbar" || page.sections[n].type === "banner")) n++;
    return n;
  })();
  const tail = page.sections.length && page.sections[page.sections.length - 1].type === "footer" ? page.sections.length - 1 : page.sections.length;
  const indexAt = (clientY: number) => {
    const top = box.current?.getBoundingClientRect().top ?? 0;
    const y = (clientY - top - frameTop) / scale;
    let i = 0;
    for (const o of ordered) if (o.slot.top + o.slot.height / 2 < y) i = page.sections.indexOf(o.sec) + 1;
    return Math.min(Math.max(i, lead), Math.max(tail, lead));
  };
  const lineY = (() => {
    if (dropAt === null) return null;
    const at = page.sections[dropAt];
    const s = at && slots.find((x) => x.id === at.id);
    if (s) return frameTop + s.top * scale;
    const prev = page.sections[dropAt - 1];
    const p = prev && slots.find((x) => x.id === prev.id);
    return p ? frameTop + (p.top + p.height) * scale : frameTop + 8;
  })();
  // Near the top or bottom edge while dragging, the page scrolls.
  const edgeScroll = (clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const dy = clientY - r.top < 70 ? -24 : r.bottom - clientY < 70 ? 24 : 0;
    if (dy) frame.current?.contentWindow?.postMessage({ source: "cc-editor", type: "scroll", dy }, "*");
  };
  const startMove = (id: string) => {
    setDrag({ kind: "move", id });
    setDropAt(null);
  };

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden bg-[color-mix(in_srgb,var(--surface-2)_70%,var(--bg))]">
      <div className="absolute" style={{ top: frameTop, left: frameLeft, width, height: frameHeight, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <iframe
          ref={frame}
          key={loadedKey}
          title={`Canvas: ${page.title}`}
          srcDoc={interactive ? initial : html}
          sandbox="allow-scripts"
          className={`h-full w-full bg-white ${viewport === "desktop" ? "rounded-[10px]" : "rounded-[28px]"} shadow-[0_0_0_1px_var(--border),0_20px_50px_-20px_rgba(0,0,0,.25)]`}
        />
      </div>
      {interactive && overlay?.({ rect, scale, frameTop, frameLeft, frameWidth: width * scale, startMove: onMoveSection ? startMove : undefined })}
      {interactive && drag && (
        <div
          data-testid="canvas-drop-layer"
          className="absolute inset-0 z-20"
          style={{ cursor: drag.kind === "move" ? "grabbing" : "copy" }}
          onDragOver={(e) => {
            if (drag.kind !== "new") return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropAt(indexAt(e.clientY));
            edgeScroll(e.clientY);
          }}
          onDragLeave={() => setDropAt(null)}
          onDrop={(e) => {
            e.preventDefault();
            const payload = e.dataTransfer.getData(DRAG_MIME);
            const at = indexAt(e.clientY);
            setDrag(null);
            setDropAt(null);
            if (payload) onDropSection?.(payload, at);
          }}
          onPointerMove={(e) => {
            if (drag.kind !== "move") return;
            setDropAt(indexAt(e.clientY));
            edgeScroll(e.clientY);
          }}
          onPointerUp={(e) => {
            if (drag.kind !== "move") return;
            const at = indexAt(e.clientY);
            setDrag(null);
            setDropAt(null);
            onMoveSection?.(drag.id, at);
          }}
          onKeyDown={(e) => e.key === "Escape" && (setDrag(null), setDropAt(null))}
        >
          {lineY !== null && (
            <div className="pointer-events-none absolute flex items-center" style={{ top: lineY - 2, left: frameLeft, width: width * scale }}>
              <span className="size-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-[#2f6fed] shadow" />
              <span className="h-[3px] flex-1 rounded-full bg-[#2f6fed] shadow-[0_0_0_3px_rgb(47_111_237/0.18)]" />
              <span className="size-2.5 translate-x-1/2 rounded-full border-2 border-white bg-[#2f6fed] shadow" />
            </div>
          )}
          {lineY !== null && (
            <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-full bg-[#2f6fed] px-2.5 py-1 text-[11.5px] font-medium text-white shadow" style={{ top: lineY - 8, left: frameLeft + (width * scale) / 2 }}>
              {drag.kind === "move" ? "Move here" : "Drop here"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
