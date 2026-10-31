// Free-form section geometry, shared by the renderer and the editor.
import { FREEFORM_COLS, FREEFORM_KINDS, FREEFORM_MAX_ITEMS, FREEFORM_MAX_ROWS, FREEFORM_MOBILE_COLS } from "./model";

export type FreeformKind = (typeof FREEFORM_KINDS)[number];
export type Box = { x: number; y: number; w: number; h: number };
export type FreeformItem = {
  index: number;
  kind: FreeformKind;
  text: string;
  image: string;
  alt: string;
  href: string;
  tone: "plain" | "surface" | "accent" | "inverse";
  size: "sm" | "md" | "lg" | "xl";
  align: "left" | "center" | "right";
  desktop: Box;
  /** Null: no phone placement set (it stacks, or spans the width in a custom layout). */
  mobile: Box | null;
  /** Editor-only: elements sharing a group select and move together. */
  group: string | null;
  /** Editor-only: locked elements can't be moved, resized or deleted. */
  locked: boolean;
};

const int = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Keeps a box inside a grid of `cols` columns and `rows` rows. */
export function fitBox(b: Box, cols: number, rows: number): Box {
  const x = clamp(b.x, 0, cols - 1);
  const y = clamp(b.y, 0, rows - 1);
  return { x, y, w: clamp(b.w, 1, cols - x), h: clamp(b.h, 1, rows - y) };
}

export function freeformRows(props: Record<string, unknown>) {
  return clamp(int(props.rows, 10), 2, FREEFORM_MAX_ROWS);
}

export function freeformItems(props: Record<string, unknown>): FreeformItem[] {
  const rows = freeformRows(props);
  const list = Array.isArray(props.items) ? (props.items as Record<string, unknown>[]).slice(0, FREEFORM_MAX_ITEMS) : [];
  return list.map((r, index) => {
    const desktop = fitBox({ x: int(r.x, 0), y: int(r.y, 0), w: int(r.w, 4), h: int(r.h, 2) }, FREEFORM_COLS, rows);
    const hasMobile = typeof r.mw === "number" && r.mw > 0;
    return {
      index,
      kind: pick(r.kind, FREEFORM_KINDS, "text"),
      text: typeof r.text === "string" ? r.text : "",
      image: typeof r.image === "string" ? r.image : "",
      alt: typeof r.alt === "string" ? r.alt : "",
      href: typeof r.href === "string" ? r.href : "",
      tone: pick(r.tone, ["plain", "surface", "accent", "inverse"] as const, "plain"),
      size: pick(r.size, ["sm", "md", "lg", "xl"] as const, "md"),
      align: pick(r.align, ["left", "center", "right"] as const, "left"),
      desktop,
      mobile: hasMobile ? fitBox({ x: int(r.mx, 0), y: int(r.my, 0), w: int(r.mw, FREEFORM_MOBILE_COLS), h: int(r.mh, 2) }, FREEFORM_MOBILE_COLS, FREEFORM_MAX_ROWS) : null,
      group: typeof r.group === "string" && /^[a-z0-9]{1,16}$/.test(r.group) ? r.group : null,
      locked: r.locked === true,
    };
  });
}

/** Reading order (top to bottom, then left to right): the DOM order, so screen readers and phones read it sensibly. */
export function readingOrder(items: FreeformItem[]) {
  return [...items].sort((a, b) => a.desktop.y - b.desktop.y || a.desktop.x - b.desktop.x || a.index - b.index);
}

/** Grid rows a custom phone layout needs. */
export function mobileRows(items: FreeformItem[]) {
  return Math.max(2, ...items.map((i) => (i.mobile ? i.mobile.y + i.mobile.h : 0)));
}

/** Bounding box of several boxes. */
export function bounds(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Moves boxes together by (dx, dy), clamped so the whole selection stays on the grid. */
export function moveTogether(boxes: Box[], dx: number, dy: number, cols: number, rows: number): Box[] {
  const b = bounds(boxes);
  const cx = Math.min(Math.max(dx, -b.x), cols - (b.x + b.w));
  const cy = Math.min(Math.max(dy, -b.y), rows - (b.y + b.h));
  return boxes.map((x) => ({ ...x, x: x.x + cx, y: x.y + cy }));
}

export type AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdistribute" | "vdistribute";

/** Aligns or distributes boxes within their shared bounds (grid units). */
export function align(boxes: Box[], op: AlignOp): Box[] {
  if (boxes.length < 2) return boxes;
  const b = bounds(boxes);
  switch (op) {
    case "left":
      return boxes.map((x) => ({ ...x, x: b.x }));
    case "right":
      return boxes.map((x) => ({ ...x, x: b.x + b.w - x.w }));
    case "hcenter":
      return boxes.map((x) => ({ ...x, x: Math.round(b.x + (b.w - x.w) / 2) }));
    case "top":
      return boxes.map((x) => ({ ...x, y: b.y }));
    case "bottom":
      return boxes.map((x) => ({ ...x, y: b.y + b.h - x.h }));
    case "vcenter":
      return boxes.map((x) => ({ ...x, y: Math.round(b.y + (b.h - x.h) / 2) }));
    case "hdistribute":
    case "vdistribute": {
      const horiz = op === "hdistribute";
      const order = boxes.map((x, i) => ({ x, i })).sort((p, q) => (horiz ? p.x.x - q.x.x : p.x.y - q.x.y));
      const total = order.reduce((n, o) => n + (horiz ? o.x.w : o.x.h), 0);
      const gap = Math.max(0, ((horiz ? b.w : b.h) - total) / (order.length - 1));
      const out = [...boxes];
      let at = horiz ? b.x : b.y;
      for (const o of order) {
        out[o.i] = horiz ? { ...o.x, x: Math.round(at) } : { ...o.x, y: Math.round(at) };
        at += (horiz ? o.x.w : o.x.h) + gap;
      }
      return out;
    }
  }
}
