"use client";

// Full-screen reading: the conversation over the whole app (and, on
// computers, the whole screen through the browser's own full-screen mode),
// with previous / next through the list, text size, and smooth transitions.
// Esc — or the browser's own exit — leaves both at once.
import { ChevronLeft, ChevronRight, Expand, Minimize2, Minus, Plus, Shrink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Keys, useShortcuts } from "@/components/ui/shortcut";
import { cx } from "@/components/ui/primitives";
import "./mail.css";

export const ZOOMS = [0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5] as const;
const ZOOM_KEY = "mail-reader-zoom";
const SCREEN_KEY = "mail-reader-screen";
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/** Text size for the reader, remembered on this device. */
export function useReaderZoom() {
  const [zoom, setZoomState] = useState<number>(() => {
    const z = Number(store.get(ZOOM_KEY));
    return (ZOOMS as readonly number[]).includes(z) ? z : 1;
  });
  const setZoom = (z: number) => {
    setZoomState(z);
    store.set(ZOOM_KEY, String(z));
  };
  return [zoom, setZoom] as const;
}

const canFill = () => typeof document !== "undefined" && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;

export function FullscreenReader({ swapKey, index, total, closing, direction, zoom, setZoom, onPrev, onNext, onExit, children }: { swapKey: string; index: number; total: number; closing: boolean; direction: "next" | "prev" | "none"; zoom: number; setZoom: (z: number) => void; onPrev: (() => void) | null; onNext: (() => void) | null; onExit: () => void; children: ReactNode }) {
  const { keyboard } = useShortcuts();
  // Fill the screen too (computers, where the browser allows it), unless turned off on this device.
  const [fill, setFill] = useState(() => store.get(SCREEN_KEY) !== "off" && canFill() && window.matchMedia("(pointer: fine)").matches);
  const [filled, setFilled] = useState(false);
  const exitRef = useRef(onExit);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    document.documentElement.dataset.mailReader = "";
    return () => {
      delete document.documentElement.dataset.mailReader;
    };
  }, []);

  // The browser's full-screen mode follows the "fill" choice; leaving it the browser's way (Esc, F11) leaves the reader too.
  useEffect(() => {
    if (!canFill()) return;
    let mine = false;
    const onChange = () => {
      const on = !!document.fullscreenElement;
      setFilled(on);
      if (on) mine = true;
      else if (mine) {
        mine = false;
        exitRef.current();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    if (fill && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => setFill(false));
    if (!fill && document.fullscreenElement) {
      mine = false;
      void document.exitFullscreen().catch(() => {});
    }
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement && mine) void document.exitFullscreen().catch(() => {});
    };
  }, [fill]);

  const toggleFill = () => {
    store.set(SCREEN_KEY, fill ? "off" : "on");
    setFill(!fill);
  };
  const zi = (ZOOMS as readonly number[]).indexOf(zoom);
  const btn = "grid size-9 place-items-center rounded-full text-muted transition-[background-color,color,transform] hover:bg-surface-2 hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-35 [&>svg]:size-[18px]";

  return createPortal(
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label="Full-screen reader">
      <div aria-hidden data-closing={closing} className="mail-reader-backdrop absolute inset-0 bg-bg" />
      <div data-closing={closing} className="mail-reader relative flex h-full flex-col">
        <div className="mail-reader-bar z-10 flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-4">
          <button type="button" onClick={onExit} className="inline-flex h-9 items-center gap-2 rounded-full pr-3 pl-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg" title="Exit full screen">
            <Minimize2 className="size-4" /><span className="hidden sm:inline">Exit full screen</span>{keyboard && <Keys k="esc" className="hidden sm:inline-flex" />}
          </button>
          <div className="mx-auto flex items-center gap-1">
            <button type="button" aria-label="Previous conversation" title="Previous (k)" disabled={!onPrev} onClick={() => onPrev?.()} className={btn}><ChevronLeft /></button>
            <span className="min-w-[72px] text-center text-[12.5px] font-medium text-muted tabular-nums" aria-live="polite">{total ? `${index + 1} of ${total}` : ""}</span>
            <button type="button" aria-label="Next conversation" title="Next (j)" disabled={!onNext} onClick={() => onNext?.()} className={btn}><ChevronRight /></button>
          </div>
          <div className="flex items-center gap-0.5">
            <span className="hidden items-center gap-0.5 rounded-full bg-surface-2/70 p-0.5 sm:flex" role="group" aria-label="Text size">
              <button type="button" aria-label="Smaller text" disabled={zi <= 0} onClick={() => setZoom(ZOOMS[zi - 1]!)} className={cx(btn, "size-8")}><Minus /></button>
              <button type="button" onClick={() => setZoom(1)} title="Reset text size" aria-label={`Text size ${Math.round(zoom * 100)}% — reset`} className="w-12 text-center text-[12px] font-semibold tabular-nums text-muted hover:text-fg">{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="Larger text" disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1]!)} className={cx(btn, "size-8")}><Plus /></button>
            </span>
            {canFill() && <button type="button" aria-label={filled ? "Stop filling the screen" : "Fill the screen"} title={filled ? "Stop filling the screen (keep the reader)" : "Fill the whole screen"} onClick={toggleFill} className={btn}>{filled ? <Shrink /> : <Expand />}</button>}
          </div>
        </div>
        <div key={swapKey} className={cx("min-h-0 flex-1", direction === "next" ? "mail-swap-next" : direction === "prev" ? "mail-swap-prev" : "mail-swap-none")}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
