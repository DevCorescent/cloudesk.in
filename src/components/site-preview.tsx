"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * A scaled, non-interactive preview of rendered site HTML. Sandboxed with no
 * permissions; it only displays markup.
 */
export function SitePreview({ html, title, height = 192, width = 1280, className = "" }: { html: string; title: string; height?: number; width?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  // Previews are composed with random ids, so they render on the client only.
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className={`relative overflow-hidden bg-surface-2 ${className}`} style={{ height }}>
      {isClient && <iframe
        title={title}
        srcDoc={html}
        sandbox=""
        tabIndex={-1}
        aria-hidden
        loading="lazy"
        style={{ width, height: height / scale, transform: `scale(${scale})` }}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
      />}
    </div>
  );
}
