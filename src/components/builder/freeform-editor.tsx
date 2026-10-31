"use client";

import clsx from "clsx";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  Copy,
  EyeOff,
  Group as GroupIcon,
  Heading as HeadingIcon,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Minus,
  MousePointerClick,
  Plus,
  Square,
  Trash2,
  Type,
  Ungroup,
} from "lucide-react";
import { useRef, useState, type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import { Dialog, Segmented } from "../ui/overlays";
import { Button, Field, Input, Select, Textarea } from "../ui/primitives";
import { useBuilder } from "./context";
import { align as alignBoxes, fitBox, freeformItems, freeformRows, mobileRows, moveTogether, readingOrder, type AlignOp, type Box, type FreeformItem, type FreeformKind } from "@/lib/site/freeform";
import { safeImageUrl } from "@/lib/site/html";
import { FREEFORM_COLS, FREEFORM_MAX_ITEMS, FREEFORM_MAX_ROWS, FREEFORM_MOBILE_COLS, type Section, type SiteDoc } from "@/lib/site/model";
import { useShortcuts } from "../ui/shortcut";

const ROW = 36;
type Raw = Record<string, unknown>;
type Drag = { indices: number[]; mode: "move" | "resize"; startX: number; startY: number; from: Box[]; colW: number; boxes: Box[] };
const newGroupId = () => Math.random().toString(36).slice(2, 10);

const NEW: Record<FreeformKind, Raw> = {
  heading: { kind: "heading", text: "New heading", size: "lg", align: "left", tone: "plain", w: 6, h: 2 },
  text: { kind: "text", text: "Write something here.", size: "md", align: "left", tone: "plain", w: 5, h: 3 },
  image: { kind: "image", image: "", alt: "", w: 4, h: 5 },
  button: { kind: "button", text: "Learn more", href: "/", tone: "accent", align: "left", w: 3, h: 2 },
  shape: { kind: "shape", tone: "surface", w: 4, h: 4 },
};
const ADD: { kind: FreeformKind; label: string; icon: React.ReactNode }[] = [
  { kind: "heading", label: "Heading", icon: <HeadingIcon className="size-3.5" /> },
  { kind: "text", label: "Text", icon: <Type className="size-3.5" /> },
  { kind: "image", label: "Image", icon: <ImageIcon className="size-3.5" /> },
  { kind: "button", label: "Button", icon: <MousePointerClick className="size-3.5" /> },
  { kind: "shape", label: "Shape", icon: <Square className="size-3.5" /> },
];

const ALIGN: { op: AlignOp; label: string; icon: React.ReactNode }[] = [
  { op: "left", label: "Align left edges", icon: <AlignStartVertical className="size-3.5" /> },
  { op: "hcenter", label: "Align centres horizontally", icon: <AlignCenterVertical className="size-3.5" /> },
  { op: "right", label: "Align right edges", icon: <AlignEndVertical className="size-3.5" /> },
  { op: "hdistribute", label: "Distribute horizontally", icon: <AlignHorizontalDistributeCenter className="size-3.5" /> },
  { op: "top", label: "Align top edges", icon: <AlignStartHorizontal className="size-3.5" /> },
  { op: "vcenter", label: "Align centres vertically", icon: <AlignCenterHorizontal className="size-3.5" /> },
  { op: "bottom", label: "Align bottom edges", icon: <AlignEndHorizontal className="size-3.5" /> },
  { op: "vdistribute", label: "Distribute vertically", icon: <AlignVerticalDistributeCenter className="size-3.5" /> },
];

/** Direct-manipulation editor for a free-form section. */
export function FreeformEditor({ open, onClose, doc, section, edit }: { open: boolean; onClose: () => void; doc: SiteDoc; section: Section; edit: (fn: (s: Section) => void, key?: string) => void }) {
  const { readOnly, openMedia } = useBuilder();
  const { keys: keysOf } = useShortcuts();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [sel, setSel] = useState<number[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const props = section.props;
  const items = freeformItems(props);
  const custom = props.mobile === "custom";
  const phone = device === "mobile";
  const cols = phone ? FREEFORM_MOBILE_COLS : FREEFORM_COLS;
  const rows = phone ? Math.min(FREEFORM_MAX_ROWS, mobileRows(items.filter((i) => i.mobile)) + 3) : freeformRows(props);
  const pal = doc.theme.palette;
  const live = sel.filter((i) => i < items.length);
  const selected = live.length === 1 ? items[live[0]] : null;
  const many = live.length > 1 ? live.map((i) => items[i]) : [];
  const raw = (s: Section) => (Array.isArray(s.props.items) ? (s.props.items as Raw[]) : (s.props.items = []) as Raw[]);
  const change = (fn: (list: Raw[], s: Section) => void, key?: string) =>
    edit((s) => {
      fn(raw(s), s);
      delete s.props._example;
    }, key);
  const boxOf = (i: FreeformItem): Box => (phone && i.mobile ? i.mobile : i.desktop);
  // In a custom phone layout, elements without a phone position are not shown on phones.
  const onCanvas = items.filter((i) => !phone || i.mobile);
  const offPhone = phone ? items.filter((i) => !i.mobile) : [];
  /** Selecting a grouped element selects its whole group. */
  const withGroups = (idx: number[]) => {
    const groups = new Set(idx.map((i) => items[i]?.group).filter(Boolean));
    return [...new Set([...idx, ...items.filter((i) => i.group && groups.has(i.group)).map((i) => i.index)])].sort((a, b) => a - b);
  };
  const pick = (index: number, additive: boolean) => {
    const g = withGroups([index]);
    if (!additive) return setSel(g);
    setSel((cur) => (g.every((i) => cur.includes(i)) ? cur.filter((i) => !g.includes(i)) : withGroups([...cur, ...g])));
  };
  const showOnPhone = (i: FreeformItem) => {
    setBoxes([[i.index, { x: 0, y: mobileRows(items.filter((x) => x.mobile)), w: FREEFORM_MOBILE_COLS, h: Math.min(i.desktop.h, 4) }]]);
    setSel([i.index]);
  };
  const hideOnPhone = (index: number) => change((list) => void ["mx", "my", "mw", "mh"].forEach((k) => delete list[index][k]));
  const setBoxes = (pairs: [number, Box][]) =>
    change((list) => {
      for (const [index, b] of pairs) {
        const f = fitBox(b, cols, phone ? FREEFORM_MAX_ROWS : freeformRows(props));
        Object.assign(list[index], phone ? { mx: f.x, my: f.y, mw: f.w, mh: f.h } : f);
      }
    });
  const patch = (index: number, p: Raw, key?: string) => change((list) => Object.assign(list[index], p), key);
  const movable = (idx: number[]) => idx.filter((i) => !items[i]?.locked);

  /** A custom phone layout starts as the reading-order stack, so nothing goes missing. */
  const startCustomPhone = () =>
    change((list, s) => {
      s.props.mobile = "custom";
      let y = 0;
      for (const i of readingOrder(freeformItems(s.props))) {
        if (i.mobile) continue;
        const h = i.kind === "shape" ? 0 : Math.min(i.desktop.h, 6);
        if (!h) continue;
        Object.assign(list[i.index], { mx: 0, my: y, mw: FREEFORM_MOBILE_COLS, mh: h });
        y += h;
      }
    });

  const add = (kind: FreeformKind) => {
    if (items.length >= FREEFORM_MAX_ITEMS) return;
    const lowest = Math.max(0, ...items.map((i) => i.desktop.y + i.desktop.h));
    const t = NEW[kind];
    const y = Math.min(lowest, Math.max(0, freeformRows(props) - (t.h as number)));
    change((list, s) => {
      list.push({ ...t, x: 0, y, ...(phone ? { mx: 0, my: mobileRows(freeformItems(s.props)), mw: FREEFORM_MOBILE_COLS, mh: t.h } : {}) });
      if (lowest + (t.h as number) > freeformRows(s.props)) s.props.rows = Math.min(FREEFORM_MAX_ROWS, lowest + (t.h as number));
    });
    setSel([items.length]);
  };
  const remove = (idx: number[]) => {
    const gone = movable(idx).sort((a, b) => b - a);
    if (!gone.length) return;
    change((list) => void gone.forEach((i) => list.splice(i, 1)));
    setSel([]);
  };
  const duplicate = (idx: number[]) => {
    if (items.length + idx.length > FREEFORM_MAX_ITEMS) return;
    // Copies of a group form a new group.
    const regroup = new Map<string, string>();
    change((list) => {
      for (const i of idx) {
        const copy = structuredClone(list[i]);
        if (typeof copy.group === "string") {
          if (!regroup.has(copy.group)) regroup.set(copy.group, newGroupId());
          copy.group = regroup.get(copy.group);
        }
        delete copy.locked;
        list.push({ ...copy, x: Math.min(FREEFORM_COLS - 1, (list[i].x as number) + 1), y: (list[i].y as number) + 1 });
      }
    });
    setSel(idx.map((_, k) => items.length + k));
  };
  /** Later elements draw on top. */
  const layer = (index: number, dir: 1 | -1) => {
    const to = index + dir;
    if (to < 0 || to >= items.length) return;
    change((list) => void ([list[index], list[to]] = [list[to], list[index]]));
    setSel([to]);
  };
  const group = () => {
    const id = newGroupId();
    change((list) => live.forEach((i) => (list[i].group = id)));
  };
  const ungroup = () => change((list) => live.forEach((i) => delete list[i].group));
  const toggleLock = () => {
    const lock = live.some((i) => !items[i].locked);
    change((list) => live.forEach((i) => (lock ? (list[i].locked = true) : delete list[i].locked)));
  };
  const alignSel = (op: AlignOp) => {
    const idx = movable(live);
    if (idx.length < 2) return;
    const out = alignBoxes(idx.map((i) => boxOf(items[i])), op);
    setBoxes(idx.map((i, k) => [i, out[k]]));
  };

  const onPointerDown = (e: RPointerEvent, i: FreeformItem, mode: Drag["mode"]) => {
    if (readOnly || !gridRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    // Keep keyboard nudging working after a drag.
    (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-ff-item]")?.focus({ preventScroll: true });
    if (additive) return pick(i.index, true);
    const idx = live.includes(i.index) && mode === "move" ? live : withGroups([i.index]);
    if (!live.includes(i.index) || mode === "resize") setSel(idx);
    const moving = mode === "resize" ? (i.locked ? [] : [i.index]) : movable(idx);
    if (!moving.length) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const from = moving.map((k) => boxOf(items[k]));
    setDrag({ indices: moving, mode, startX: e.clientX, startY: e.clientY, from, colW: gridRef.current.clientWidth / cols, boxes: from });
  };
  const localPoint = (e: RPointerEvent) => {
    const r = gridRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onCanvasDown = (e: RPointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const p = localPoint(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey || e.metaKey || e.ctrlKey });
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) setSel([]);
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (marquee) {
      const p = localPoint(e);
      return setMarquee({ ...marquee, x1: p.x, y1: p.y });
    }
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.startX) / drag.colW);
    const dy = Math.round((e.clientY - drag.startY) / ROW);
    const maxRows = phone ? FREEFORM_MAX_ROWS : rows;
    const boxes = drag.mode === "move" ? moveTogether(drag.from, dx, dy, cols, maxRows) : [fitBox({ ...drag.from[0], w: drag.from[0].w + dx, h: drag.from[0].h + dy }, cols, maxRows)];
    setDrag({ ...drag, boxes });
  };
  const onPointerUp = () => {
    if (marquee && gridRef.current) {
      const colW = gridRef.current.clientWidth / cols;
      const [l, r] = [Math.min(marquee.x0, marquee.x1), Math.max(marquee.x0, marquee.x1)];
      const [t, b] = [Math.min(marquee.y0, marquee.y1), Math.max(marquee.y0, marquee.y1)];
      if (r - l > 4 || b - t > 4) {
        const hit = onCanvas.filter((i) => {
          const x = boxOf(i);
          return x.x * colW < r && (x.x + x.w) * colW > l && x.y * ROW < b && (x.y + x.h) * ROW > t;
        });
        setSel((cur) => withGroups([...(marquee.add ? cur : []), ...hit.map((i) => i.index)]));
      }
      setMarquee(null);
      return;
    }
    if (!drag) return;
    const { indices, boxes, from } = drag;
    setDrag(null);
    if (boxes.some((b, k) => b.x !== from[k].x || b.y !== from[k].y || b.w !== from[k].w || b.h !== from[k].h)) setBoxes(indices.map((i, k) => [i, boxes[k]]));
  };
  const onKey = (e: RKeyboardEvent, i: FreeformItem) => {
    if (readOnly) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const idx = live.includes(i.index) ? live : [i.index];
    const mod = e.metaKey || e.ctrlKey;
    if (d) {
      e.preventDefault();
      const m = movable(idx);
      if (!m.length) return;
      if (e.shiftKey && m.length === 1) {
        const b = boxOf(items[m[0]]);
        setBoxes([[m[0], { ...b, w: b.w + d[0], h: b.h + d[1] }]]);
      } else {
        const moved = moveTogether(m.map((k) => boxOf(items[k])), d[0], d[1], cols, phone ? FREEFORM_MAX_ROWS : rows);
        setBoxes(m.map((k, n) => [k, moved[n]]));
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(idx);
    } else if (mod && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (e.shiftKey) ungroup();
      else if (live.length > 1) group();
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSel(onCanvas.map((x) => x.index));
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate(idx);
    } else if (e.key === "Escape" && live.length) {
      e.preventDefault();
      e.stopPropagation();
      setSel([]);
    }
  };

  const tone = (t: FreeformItem["tone"]) => (t === "accent" ? { background: pal.accent, color: pal.accentText } : t === "surface" ? { background: pal.surface, color: pal.text } : t === "inverse" ? { background: pal.text, color: pal.background } : { color: pal.text });
  const phoneHidden = phone && !custom;

  return (
    <Dialog open={open} onClose={onClose} size="2xl" title="Free-form editor" description="Drag to move, drag the corner to resize. Arrow keys move the selected element; Shift + arrows resize. Elements snap to the grid so the layout stays tidy.">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <Segmented label="Layout for" value={device} onChange={(v) => setDevice(v)} options={[{ value: "desktop", label: "Desktop & tablet" }, { value: "mobile", label: "Phone" }]} />
        {!phoneHidden && !readOnly && (
          <div className="flex flex-wrap gap-1">
            {ADD.map((a) => (
              <Button key={a.kind} size="sm" icon={a.icon} onClick={() => add(a.kind)} disabled={items.length >= FREEFORM_MAX_ITEMS}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
        {!phone && !readOnly && (
          <span className="flex items-center gap-1 text-xs text-muted">
            Height
            <Button size="sm" variant="ghost" aria-label="Fewer rows" icon={<Minus className="size-3.5" />} onClick={() => edit((s) => void (s.props.rows = Math.max(2, freeformRows(s.props) - 1)))} />
            <span className="w-14 text-center tabular-nums">{rows} rows</span>
            <Button size="sm" variant="ghost" aria-label="More rows" icon={<Plus className="size-3.5" />} onClick={() => edit((s) => void (s.props.rows = Math.min(FREEFORM_MAX_ROWS, freeformRows(s.props) + 1)))} />
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 overflow-auto rounded-[var(--radius-md)] border border-border p-3" style={{ background: pal.background }}>
          {phoneHidden ? (
            <div className="mx-auto max-w-sm space-y-3 py-6 text-center text-[13px]" style={{ color: pal.text }}>
              <p>On phones, elements stack top to bottom in reading order, and decorative shapes are hidden.</p>
              <p className="text-xs opacity-70">Order: {readingOrder(items).filter((i) => i.kind !== "shape").map((i) => i.text.slice(0, 24) || i.kind).join(" → ") || "—"}</p>
              {!readOnly && (
                <Button size="sm" variant="primary" onClick={startCustomPhone}>
                  Design a custom phone layout
                </Button>
              )}
            </div>
          ) : (
            <div
              ref={gridRef}
              role="application"
              aria-label="Free-form canvas"
              className="relative mx-auto select-none"
              style={{
                width: phone ? 360 : "100%",
                height: rows * ROW,
                backgroundImage: `linear-gradient(to right, color-mix(in srgb, ${pal.text} 9%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, ${pal.text} 9%, transparent) 1px, transparent 1px)`,
                backgroundSize: `calc(100% / ${cols}) ${ROW}px`,
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={onCanvasDown}
            >
              {onCanvas.map((i) => {
                const k = drag ? drag.indices.indexOf(i.index) : -1;
                const b = k >= 0 ? drag!.boxes[k] : boxOf(i);
                const on = live.includes(i.index);
                const img = i.kind === "image" ? safeImageUrl(i.image) : "";
                return (
                  <div
                    key={i.index}
                    data-ff-item
                    tabIndex={0}
                    role="button"
                    aria-label={`${i.kind} ${i.text.slice(0, 40)} at column ${b.x + 1}, row ${b.y + 1}, ${b.w} by ${b.h}`}
                    aria-pressed={on}
                    onPointerDown={(e) => onPointerDown(e, i, "move")}
                    onKeyDown={(e) => onKey(e, i)}
                    onFocus={() => !live.includes(i.index) && setSel(withGroups([i.index]))}
                    className={clsx("absolute flex overflow-hidden rounded-md outline-none", i.locked ? "cursor-default" : "cursor-move", on ? "ring-2 ring-accent" : i.group ? "outline-1 outline-dashed outline-accent/50 hover:outline-accent" : "ring-1 ring-black/10 hover:ring-accent/60")}
                    style={{ left: `calc(${b.x} * 100% / ${cols})`, width: `calc(${b.w} * 100% / ${cols})`, top: b.y * ROW, height: b.h * ROW, zIndex: i.index + 1, ...tone(i.tone), justifyContent: i.align === "center" ? "center" : i.align === "right" ? "flex-end" : "flex-start", textAlign: i.align }}
                  >
                    {i.kind === "image" ? (
                      img ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user media preview inside the editor
                        <img src={img} alt="" className="pointer-events-none size-full object-cover" />
                      ) : (
                        <span className="m-auto flex items-center gap-1 text-xs opacity-60">
                          <ImageIcon className="size-4" /> Image
                        </span>
                      )
                    ) : i.kind === "shape" ? null : i.kind === "button" ? (
                      <span className="m-auto rounded-full px-3 py-1 text-xs font-semibold" style={i.tone === "plain" ? { color: pal.accent } : undefined}>
                        {i.text || "Button"}
                      </span>
                    ) : (
                      <span className={clsx("block w-full self-center overflow-hidden px-2 leading-tight", i.kind === "heading" ? { sm: "text-base", md: "text-lg", lg: "text-2xl", xl: "text-3xl" }[i.size] + " font-semibold" : { sm: "text-[11px]", md: "text-xs", lg: "text-sm", xl: "text-base" }[i.size])}>
                        {i.text || <em className="opacity-50">Empty</em>}
                      </span>
                    )}
                    {i.locked && (
                      <span className="absolute top-1 right-1 rounded bg-black/55 p-0.5 text-white" aria-label="Locked">
                        <Lock className="size-2.5" />
                      </span>
                    )}
                    {!readOnly && selected?.index === i.index && !i.locked && (
                      <span
                        aria-hidden
                        onPointerDown={(e) => onPointerDown(e, i, "resize")}
                        className="absolute right-0 bottom-0 size-3.5 cursor-se-resize rounded-tl bg-accent"
                      />
                    )}
                  </div>
                );
              })}
              {marquee && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute rounded-sm border border-accent bg-accent/10"
                  style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
                />
              )}
            </div>
          )}
          {phone && custom && offPhone.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: pal.text }}>
              <span className="opacity-70">Not shown on phones:</span>
              {offPhone.map((i) => (
                <Button key={i.index} size="sm" variant="ghost" icon={<Plus className="size-3" />} disabled={readOnly} onClick={() => showOnPhone(i)}>
                  {i.text.slice(0, 20) || i.kind}
                </Button>
              ))}
            </div>
          )}
          {phone && custom && !readOnly && (
            <button className="mt-2 text-xs text-accent hover:underline" onClick={() => edit((s) => void (s.props.mobile = "stack"))}>
              Go back to automatic stacking
            </button>
          )}
        </div>

        <div className="space-y-3 text-[13px]">
          {many.length > 0 ? (
            <>
              <p className="text-xs font-medium text-muted uppercase">{many.length} selected{many.every((m) => m.group && m.group === many[0].group) ? " · grouped" : ""}</p>
              {!readOnly && (
                <>
                  <div className="grid grid-cols-4 gap-1" role="group" aria-label="Align">
                    {ALIGN.map((a) => (
                      <Button key={a.op} size="sm" variant="ghost" aria-label={a.label} title={a.label} icon={a.icon} disabled={a.op.endsWith("distribute") && many.length < 3} onClick={() => alignSel(a.op)} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1 border-t border-border pt-3">
                    {many.every((m) => m.group && m.group === many[0].group) ? (
                      <Button size="sm" variant="ghost" icon={<Ungroup className="size-3.5" />} onClick={ungroup}>Ungroup</Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<GroupIcon className="size-3.5" />} onClick={group}>Group</Button>
                    )}
                    <Button size="sm" variant="ghost" icon={many.some((m) => !m.locked) ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />} onClick={toggleLock}>
                      {many.some((m) => !m.locked) ? "Lock" : "Unlock"}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => duplicate(live)} disabled={items.length + live.length > FREEFORM_MAX_ITEMS}>Duplicate</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => remove(live)} disabled={many.every((m) => m.locked)}>Delete</Button>
                  </div>
                </>
              )}
              <p className="text-xs text-muted">Drag any of them to move all{keysOf("mod+g") ? ` · ${keysOf("mod+g")} group · ${keysOf("mod+shift+g")} ungroup · ${keysOf("mod+d")} duplicate` : ""}</p>
            </>
          ) : selected ? (
            <>
              <p className="text-xs font-medium text-muted uppercase">Selected: {selected.kind}</p>
              {selected.kind !== "shape" && selected.kind !== "image" && (
                <Field label={selected.kind === "button" ? "Label" : "Text"}>{(a) => <Textarea {...a} rows={selected.kind === "text" ? 4 : 2} disabled={readOnly} value={selected.text} maxLength={600} onChange={(e) => patch(selected.index, { text: e.target.value }, `ff.${section.id}.${selected.index}.text`)} />}</Field>
              )}
              {selected.kind === "button" && <Field label="Link">{(a) => <Input {...a} disabled={readOnly} value={selected.href} placeholder="/contact" onChange={(e) => patch(selected.index, { href: e.target.value }, `ff.${section.id}.${selected.index}.href`)} />}</Field>}
              {selected.kind === "image" && (
                <>
                  <Button size="sm" icon={<ImageIcon className="size-3.5" />} disabled={readOnly} onClick={() => openMedia((url, alt) => patch(selected.index, { image: url, ...(alt ? { alt } : {}) }))}>
                    {selected.image ? "Replace image" : "Choose image"}
                  </Button>
                  <Field label="Image description" hint="Read aloud by screen readers.">{(a) => <Input {...a} disabled={readOnly} value={selected.alt} maxLength={200} onChange={(e) => patch(selected.index, { alt: e.target.value }, `ff.${section.id}.${selected.index}.alt`)} />}</Field>
                </>
              )}
              {selected.kind !== "image" && (
                <Field label="Colour">
                  {(a) => (
                    <Select {...a} disabled={readOnly} value={selected.tone} onChange={(e) => patch(selected.index, { tone: e.target.value })}>
                      <option value="plain">Plain</option>
                      <option value="surface">Soft panel</option>
                      <option value="accent">Accent</option>
                      <option value="inverse">Dark</option>
                    </Select>
                  )}
                </Field>
              )}
              {(selected.kind === "heading" || selected.kind === "text") && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Size">
                    {(a) => (
                      <Select {...a} disabled={readOnly} value={selected.size} onChange={(e) => patch(selected.index, { size: e.target.value })}>
                        <option value="sm">Small</option>
                        <option value="md">Medium</option>
                        <option value="lg">Large</option>
                        <option value="xl">Huge</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Align">
                    {(a) => (
                      <Select {...a} disabled={readOnly} value={selected.align} onChange={(e) => patch(selected.index, { align: e.target.value })}>
                        <option value="left">Left</option>
                        <option value="center">Centre</option>
                        <option value="right">Right</option>
                      </Select>
                    )}
                  </Field>
                </div>
              )}
              {!readOnly && (
                <div className="flex flex-wrap gap-1 border-t border-border pt-3">
                  <Button size="sm" variant="ghost" icon={<ArrowUp className="size-3.5" />} disabled={selected.index === items.length - 1} onClick={() => layer(selected.index, 1)}>
                    Forward
                  </Button>
                  <Button size="sm" variant="ghost" icon={<ArrowDown className="size-3.5" />} disabled={selected.index === 0} onClick={() => layer(selected.index, -1)}>
                    Back
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => duplicate([selected.index])}>
                    Duplicate
                  </Button>
                  <Button size="sm" variant="ghost" icon={selected.locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />} onClick={toggleLock}>
                    {selected.locked ? "Unlock" : "Lock"}
                  </Button>
                  {phone && custom && selected.mobile && (
                    <Button size="sm" variant="ghost" icon={<EyeOff className="size-3.5" />} onClick={() => hideOnPhone(selected.index)}>
                      Hide on phones
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} disabled={selected.locked} onClick={() => remove([selected.index])}>
                    Delete
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted">Select an element to edit it, or add one from the toolbar. Shift-click or drag across the canvas to select several. {items.length}/{FREEFORM_MAX_ITEMS} elements.</p>
          )}
          <p className="border-t border-border pt-3 text-xs text-muted">Screen readers and phones read elements top to bottom, left to right — place them in the order they should be read.</p>
        </div>
      </div>
    </Dialog>
  );
}
