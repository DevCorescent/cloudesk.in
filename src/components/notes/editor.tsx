"use client";

// The block editor. Type "/" for any element, or Markdown as you go ("# ",
// "- ", "[] ", "1. ", "> ", "```", "---", "= "). Drag blocks by their handle
// to reorder them, drag elements in from the Elements panel, drop Markdown or
// text files in. Select text for bold/italic/links and AI rewrites. Blocks you
// aren't typing in show their formatting; the one you're in shows the marks.
import clsx from "clsx";
import { ArrowDown, ArrowUp, Bold, Calculator, CalendarDays, CheckSquare, ChevronRight, Code2, Copy, Database, GripVertical, Heading1, Heading2, Heading3, Highlighter, Image as ImageIcon, Italic, Link2, List, ListOrdered, Loader2, Minus, MessageSquareQuote, Palette, Plus, Quote, Sparkles, Strikethrough, Table2, Trash2, Type, Wand2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Menu } from "@/components/ui/overlays";
import { block, calcResults, fromMarkdown, type Block, type BlockType, type Doc } from "@/lib/notes/blocks";
import { BlockView, fmtNum, Inline, numbering, TONES } from "./render";
import { useShortcuts } from "@/components/ui/shortcut";

// ─── The elements ──────────────────────────────────────────────────────────

export type Element = { type: BlockType; label: string; line: string; icon: ReactNode; keys: string; extra?: () => Partial<Block>; group: "Text" | "Lists" | "Blocks" | "Smart" };

export const ELEMENTS: Element[] = [
  { type: "p", label: "Text", line: "Plain writing", icon: <Type />, keys: "text paragraph", group: "Text" },
  { type: "h1", label: "Heading 1", line: "Big section title", icon: <Heading1 />, keys: "h1 heading title", group: "Text" },
  { type: "h2", label: "Heading 2", line: "Medium heading", icon: <Heading2 />, keys: "h2 heading subtitle", group: "Text" },
  { type: "h3", label: "Heading 3", line: "Small heading", icon: <Heading3 />, keys: "h3 heading", group: "Text" },
  { type: "quote", label: "Quote", line: "A quotation", icon: <Quote />, keys: "quote blockquote", group: "Text" },
  { type: "todo", label: "To-do", line: "A checkbox to tick", icon: <CheckSquare />, keys: "todo task checkbox check", group: "Lists" },
  { type: "bullet", label: "Bullet list", line: "Points", icon: <List />, keys: "bullet list ul", group: "Lists" },
  { type: "number", label: "Numbered list", line: "Steps in order", icon: <ListOrdered />, keys: "number numbered ordered ol steps", group: "Lists" },
  { type: "toggle", label: "Toggle", line: "Hide details under a heading", icon: <ChevronRight />, keys: "toggle collapse details accordion", group: "Lists", extra: () => ({ body: "", open: true }) },
  { type: "callout", label: "Callout", line: "Make something stand out", icon: <MessageSquareQuote />, keys: "callout note tip warning info", group: "Blocks", extra: () => ({ tone: "info" }) },
  { type: "table", label: "Table", line: "Rows and columns", icon: <Table2 />, keys: "table grid sheet", group: "Blocks", extra: () => ({ rows: [["Column 1", "Column 2", "Column 3"], ["", "", ""], ["", "", ""]] }) },
  { type: "code", label: "Code", line: "Code or fixed-width text", icon: <Code2 />, keys: "code snippet", group: "Blocks" },
  { type: "divider", label: "Divider", line: "A line between parts", icon: <Minus />, keys: "divider line hr separator", group: "Blocks" },
  { type: "image", label: "Image", line: "A picture from a link", icon: <ImageIcon />, keys: "image picture photo", group: "Blocks", extra: () => ({ url: "", caption: "" }) },
  { type: "calc", label: "Calculation", line: "Live maths — name results and reuse them", icon: <Calculator />, keys: "calc calculation math sum formula gst =", group: "Smart", extra: () => ({ lang: "" }) },
  { type: "record", label: "Link a record", line: "An invoice, deal, person… from any module", icon: <Database />, keys: "record link mention invoice deal contact", group: "Smart", extra: () => ({ url: "", module: "" }) },
  { type: "link", label: "Web link", line: "A link card", icon: <Link2 />, keys: "link url bookmark web", group: "Smart", extra: () => ({ url: "" }) },
  { type: "date", label: "Date", line: "A date to remember", icon: <CalendarDays />, keys: "date day deadline", group: "Smart", extra: () => ({ date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) }) },
];
const elementOf = (t: BlockType) => ELEMENTS.find((e) => e.type === t)!;
export const makeBlock = (t: BlockType, text = "") => block(t, text, elementOf(t).extra?.() ?? {});

const TEXTUAL = new Set<BlockType>(["p", "h1", "h2", "h3", "todo", "bullet", "number", "quote", "callout", "toggle"]);
const LISTS = new Set<BlockType>(["todo", "bullet", "number"]);
const SHORTCUTS: [RegExp, BlockType, Partial<Block>?][] = [
  [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^[-*]\s$/, "bullet"], [/^1[.)]\s$/, "number"], [/^\[\s?\]\s$/, "todo"], [/^\[x\]\s$/i, "todo", { checked: true }], [/^>\s$/, "quote"], [/^!\s$/, "callout", { tone: "info" }], [/^```$/, "code"], [/^---$/, "divider"], [/^=\s$/, "calc"],
];

const TEXT_STYLE: Partial<Record<BlockType, string>> = { h1: "text-[1.7em] leading-tight font-semibold tracking-tight", h2: "text-[1.35em] leading-snug font-semibold tracking-tight", h3: "text-[1.12em] font-semibold", quote: "italic text-fg/80" };
const PLACEHOLDER: Partial<Record<BlockType, string>> = { p: "Type “/” for elements, or just write", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", todo: "To-do", bullet: "List", number: "List", quote: "Quote", callout: "Something to stand out", toggle: "Toggle heading" };

export type AiRewrite = (mode: string, text: string) => Promise<string>;

// ─── The editor ────────────────────────────────────────────────────────────

type Focus = { id: string; at: "start" | "end" | number } | null;

export function BlockEditor({ doc, onChange, readOnly, onNoteLink, onPickRecord, rewrite, fontClass }: { doc: Doc; onChange: (d: Doc) => void; readOnly?: boolean; onNoteLink?: (title: string) => void; onPickRecord?: (done: (r: { title: string; sub: string; url: string; module: string }) => void) => void; rewrite?: AiRewrite; fontClass?: string }) {
  const blocks = doc.blocks;
  const [focus, setFocus] = useState<Focus>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const calc = useMemo(() => calcResults(doc), [doc]);
  const nums = useMemo(() => numbering(blocks), [blocks]);
  const set = useCallback((next: Block[]) => onChange({ blocks: next.length ? next : [block("p")] }), [onChange]);
  const patch = (id: string, p: Partial<Block>) => set(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const idx = (id: string) => blocks.findIndex((b) => b.id === id);
  const insertAfter = (id: string | null, nb: Block[], focusIt = true) => {
    const i = id ? idx(id) : blocks.length - 1;
    set([...blocks.slice(0, i + 1), ...nb, ...blocks.slice(i + 1)]);
    if (focusIt && nb[0]) setFocus({ id: nb[0].id, at: "start" });
  };
  const remove = (id: string, focusPrev = true) => {
    const i = idx(id);
    const prev = blocks[i - 1] ?? blocks[i + 1];
    set(blocks.filter((b) => b.id !== id));
    if (focusPrev && prev) setFocus({ id: prev.id, at: "end" });
  };
  const move = (id: string, by: number) => {
    const i = idx(id);
    const j = i + by;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set(next);
  };
  const turnInto = (id: string, t: BlockType) => {
    const b = blocks.find((x) => x.id === id)!;
    patch(id, { type: t, ...(elementOf(t).extra?.() ?? {}), text: t === "divider" ? "" : b.text });
    if (TEXTUAL.has(t) || t === "code" || t === "calc") setFocus({ id, at: "end" });
  };

  // Dragging: a block's handle (move), an element from the panel (insert), files (import).
  const onDragOver = (e: DragEvent, id: string) => {
    const types = e.dataTransfer.types;
    if (!types.includes("application/x-note-block") && !types.includes("application/x-note-element") && !types.includes("Files")) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrop({ id, after: e.clientY > r.top + r.height / 2 });
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const target = drop;
    setDrop(null);
    if (!target) return;
    const at = idx(target.id) + (target.after ? 1 : 0);
    const moving = e.dataTransfer.getData("application/x-note-block");
    const element = e.dataTransfer.getData("application/x-note-element") as BlockType;
    if (moving) {
      const ids = selected.has(moving) ? blocks.filter((b) => selected.has(b.id)).map((b) => b.id) : [moving];
      const picked = blocks.filter((b) => ids.includes(b.id));
      const rest = blocks.filter((b) => !ids.includes(b.id));
      const before = blocks.slice(0, at).filter((b) => !ids.includes(b.id)).length;
      set([...rest.slice(0, before), ...picked, ...rest.slice(before)]);
    } else if (element) {
      const nb = makeBlock(element);
      set([...blocks.slice(0, at), nb, ...blocks.slice(at)]);
      setFocus({ id: nb.id, at: "start" });
    } else if (e.dataTransfer.files.length) {
      const added: Block[] = [];
      for (const f of [...e.dataTransfer.files].slice(0, 10)) {
        if (/\.(md|markdown|txt)$/i.test(f.name) || f.type.startsWith("text/")) added.push(...fromMarkdown((await f.text()).slice(0, 500_000)).blocks);
      }
      if (added.length) set([...blocks.slice(0, at), ...added, ...blocks.slice(at)]);
    }
  };

  if (readOnly) {
    return <div className={clsx("grid gap-2.5 text-[16px] leading-relaxed", fontClass)}>{blocks.map((b) => <BlockView key={b.id} b={b} n={nums.get(b.id)} calc={calc} onNote={onNoteLink} />)}</div>;
  }
  return (
    <div className={clsx("grid gap-1 text-[16px] leading-relaxed", fontClass)} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)} onDrop={(e) => void onDrop(e)} onDragOver={(e) => e.preventDefault()}>
      {blocks.map((b, i) => (
        <Row
          key={b.id}
          b={b}
          drop={drop?.id === b.id ? (drop.after ? "after" : "before") : null}
          selected={selected.has(b.id)}
          onSelect={(add) => setSelected((s) => { const n = new Set(add ? s : []); if (s.has(b.id) && add) n.delete(b.id); else n.add(b.id); return n; })}
          onDragOver={(e) => onDragOver(e, b.id)}
          onAdd={() => insertAfter(b.id, [block("p")])}
          menu={{ turnInto: (t) => turnInto(b.id, t), duplicate: () => insertAfter(b.id, [{ ...b, id: block("p").id }], false), remove: () => remove(b.id, false), up: () => move(b.id, -1), down: () => move(b.id, 1), color: (c) => patch(b.id, { color: c }), tone: (t) => patch(b.id, { tone: t }) }}
        >
          <Body
            b={b}
            n={nums.get(b.id)}
            calc={calc}
            focus={focus?.id === b.id ? focus : null}
            onFocus={(at) => (setFocus({ id: b.id, at }), setSelected(new Set()))}
            onBlur={() => setFocus((f) => (f?.id === b.id ? null : f))}
            patch={(p) => patch(b.id, p)}
            onNoteLink={onNoteLink}
            onPickRecord={onPickRecord}
            rewrite={rewrite}
            keys={{
              enter: (before, after) => {
                if (LISTS.has(b.type) && !before && !after) return turnInto(b.id, "p");
                const t: BlockType = LISTS.has(b.type) ? b.type : "p";
                const nb = block(t, after, { indent: b.indent, ...(t === "todo" ? { checked: false } : {}) });
                set([...blocks.slice(0, i), { ...b, text: before }, nb, ...blocks.slice(i + 1)]);
                setFocus({ id: nb.id, at: "start" });
              },
              backspaceAtStart: () => {
                if (b.indent) return patch(b.id, { indent: b.indent - 1 });
                if (b.type !== "p" && TEXTUAL.has(b.type)) return patch(b.id, { type: "p" });
                const prev = blocks[i - 1];
                if (!prev) return;
                if (!b.text) return remove(b.id);
                if (TEXTUAL.has(prev.type)) {
                  set([...blocks.slice(0, i - 1), { ...prev, text: prev.text + b.text }, ...blocks.slice(i + 1)]);
                  setFocus({ id: prev.id, at: prev.text.length });
                }
              },
              up: () => blocks[i - 1] && setFocus({ id: blocks[i - 1]!.id, at: "end" }),
              down: () => blocks[i + 1] && setFocus({ id: blocks[i + 1]!.id, at: "start" }),
              indent: (by) => LISTS.has(b.type) || b.type === "p" ? patch(b.id, { indent: Math.max(0, Math.min(4, (b.indent ?? 0) + by)) }) : undefined,
              turnInto: (t, extra) => { patch(b.id, { type: t, text: "", ...(elementOf(t).extra?.() ?? {}), ...extra }); setFocus({ id: b.id, at: "start" }); },
              move: (by) => move(b.id, by),
              duplicate: () => insertAfter(b.id, [{ ...b, id: block("p").id }], false),
              paste: (md) => { const nb = fromMarkdown(md).blocks; set([...blocks.slice(0, i + 1), ...nb, ...blocks.slice(i + 1)]); },
            }}
          />
        </Row>
      ))}
      <button type="button" onClick={() => { const last = blocks.at(-1); if (last && TEXTUAL.has(last.type) && !last.text) setFocus({ id: last.id, at: "end" }); else insertAfter(null, [block("p")]); }} className="mt-2 h-16 cursor-text rounded-[10px] text-left text-[13px] text-transparent hover:text-subtle" aria-label="Add a block at the end">Click to add more</button>
      {selected.size > 1 && (
        <div className="sticky bottom-4 z-20 mx-auto flex items-center gap-1 rounded-full bg-fg px-2 py-1.5 text-[13px] text-bg shadow-xl">
          <span className="px-2">{selected.size} blocks</span>
          <button type="button" className="rounded-full px-2.5 py-1 hover:bg-bg/15" onClick={() => { void navigator.clipboard?.writeText(blocks.filter((b) => selected.has(b.id)).map((b) => b.text).join("\n")); }}>Copy</button>
          <button type="button" className="rounded-full px-2.5 py-1 hover:bg-bg/15" onClick={() => { set(blocks.filter((b) => !selected.has(b.id))); setSelected(new Set()); }}>Delete</button>
          <button type="button" className="rounded-full px-2.5 py-1 hover:bg-bg/15" onClick={() => setSelected(new Set())}>Done</button>
        </div>
      )}
    </div>
  );
}

// ─── A row: handle, + and the drop line ────────────────────────────────────

type RowMenu = { turnInto: (t: BlockType) => void; duplicate: () => void; remove: () => void; up: () => void; down: () => void; color: (c: string | undefined) => void; tone: (t: string) => void };

function Row({ b, drop, selected, onSelect, onDragOver, onAdd, menu, children }: { b: Block; drop: "before" | "after" | null; selected: boolean; onSelect: (add: boolean) => void; onDragOver: (e: DragEvent) => void; onAdd: () => void; menu: RowMenu; children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const color = b.color ? ({ red: "text-[#dc2626]", orange: "text-[#ea580c]", green: "text-[#16a34a]", sky: "text-[#0284c7]", violet: "text-[#7c3aed]", gray: "text-muted" } as Record<string, string>)[b.color] : undefined;
  return (
    <div data-block={b.id} onDragOver={onDragOver} className={clsx("group/row relative -ml-14 flex items-start gap-1 rounded-[8px] pl-1 sm:-ml-16", dragging && "opacity-40", selected && "bg-accent-soft/60")}>
      {drop && <div className={clsx("pointer-events-none absolute right-0 left-14 h-0.5 rounded-full bg-accent", drop === "before" ? "-top-0.5" : "-bottom-0.5")} />}
      <div className="flex shrink-0 items-center pt-[0.2em] opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100">
        <button type="button" onClick={onAdd} aria-label="Add a block below" title="Add below" className="grid size-6 place-items-center rounded-[6px] text-subtle hover:bg-surface-2 hover:text-fg"><Plus className="size-4" /></button>
        <Menu
          label="Block"
          trigger={(p) => (
            <button
              {...p}
              type="button"
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("application/x-note-block", b.id); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
              onDragEnd={() => setDragging(false)}
              onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? onSelect(true) : p.onClick(e))}
              aria-label="Drag to move, click for options"
              title="Drag to move · click for options · shift-click to select"
              className="grid size-6 cursor-grab place-items-center rounded-[6px] text-subtle hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
          )}
          items={[
            ...ELEMENTS.filter((e) => e.type !== b.type && (TEXTUAL.has(e.type) || e.type === "code")).slice(0, 10).map((e) => ({ label: `Turn into ${e.label.toLowerCase()}`, icon: e.icon, onSelect: () => menu.turnInto(e.type) })),
            "separator" as const,
            ...(b.type === "callout" ? Object.entries(TONES).map(([k, t]) => ({ label: `${t.label} callout`, icon: t.icon, onSelect: () => menu.tone(k) })) : []),
            ...(TEXTUAL.has(b.type) ? [{ label: b.color ? "Default colour" : "Colour: red", icon: <Palette />, onSelect: () => menu.color(b.color ? undefined : "red") }, ...["orange", "green", "sky", "violet", "gray"].map((c) => ({ label: `Colour: ${c}`, icon: <Palette />, onSelect: () => menu.color(c) }))] : []),
            "separator" as const,
            { label: "Move up", icon: <ArrowUp />, onSelect: menu.up },
            { label: "Move down", icon: <ArrowDown />, onSelect: menu.down },
            { label: "Duplicate", icon: <Copy />, onSelect: menu.duplicate },
            { label: "Select", icon: <CheckSquare />, onSelect: () => onSelect(true) },
            { label: "Delete", icon: <Trash2 />, danger: true, onSelect: menu.remove },
          ]}
        />
      </div>
      <div className={clsx("min-w-0 flex-1 py-[3px]", color)}>{children}</div>
    </div>
  );
}

// ─── Block bodies ──────────────────────────────────────────────────────────

type Keys = {
  enter: (before: string, after: string) => void;
  backspaceAtStart: () => void;
  up: () => void;
  down: () => void;
  indent: (by: number) => void;
  turnInto: (t: BlockType, extra?: Partial<Block>) => void;
  move: (by: number) => void;
  duplicate: () => void;
  paste: (md: string) => void;
};

function Body({ b, n, calc, focus, onFocus, onBlur, patch, keys, onNoteLink, onPickRecord, rewrite }: { b: Block; n?: number; calc: ReturnType<typeof calcResults>; focus: Focus; onFocus: (at: "start" | "end" | number) => void; onBlur: () => void; patch: (p: Partial<Block>) => void; keys: Keys; onNoteLink?: (t: string) => void; onPickRecord?: (done: (r: { title: string; sub: string; url: string; module: string }) => void) => void; rewrite?: AiRewrite }) {
  const pad = { paddingLeft: `${(b.indent ?? 0) * 1.5}rem` };
  const text = (extra?: { className?: string; placeholder?: string }) => <TextInput b={b} focus={focus} onFocus={onFocus} onBlur={onBlur} onText={(t) => patch({ text: t })} keys={keys} onNoteLink={onNoteLink} rewrite={rewrite} className={clsx(TEXT_STYLE[b.type], extra?.className)} placeholder={extra?.placeholder ?? PLACEHOLDER[b.type]} />;
  switch (b.type) {
    case "todo":
      return (
        <div className="flex items-start gap-2.5" style={pad}>
          <input type="checkbox" checked={!!b.checked} onChange={(e) => patch({ checked: e.target.checked })} aria-label="Done" className="mt-[0.32em] size-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
          <div className="min-w-0 flex-1">{text({ className: b.checked ? "text-muted line-through" : undefined })}</div>
        </div>
      );
    case "bullet": return <div className="flex items-start gap-2.5" style={pad}><span className="mt-[0.66em] size-1.5 shrink-0 rounded-full bg-fg/60" aria-hidden /><div className="min-w-0 flex-1">{text()}</div></div>;
    case "number": return <div className="flex items-start gap-2" style={pad}><span className="min-w-[1.4em] shrink-0 pt-px text-right text-muted tabular-nums">{n ?? 1}.</span><div className="min-w-0 flex-1">{text()}</div></div>;
    case "quote": return <div className="border-l-[3px] border-fg/25 pl-4">{text()}</div>;
    case "callout": {
      const tone = TONES[b.tone ?? "info"] ?? TONES.info!;
      return (
        <div className={clsx("flex gap-3 rounded-[12px] px-4 py-3", tone.cls)}>
          <button type="button" onClick={() => { const ks = Object.keys(TONES); patch({ tone: ks[(ks.indexOf(b.tone ?? "info") + 1) % ks.length] }); }} title="Change the kind" className="mt-[0.2em] shrink-0">{tone.icon}</button>
          <div className="min-w-0 flex-1">{text()}</div>
        </div>
      );
    }
    case "toggle":
      return (
        <div className="grid gap-1">
          <div className="flex items-start gap-1.5">
            <button type="button" onClick={() => patch({ open: !b.open })} aria-label={b.open ? "Collapse" : "Expand"} className="mt-[0.25em] grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-surface-2"><ChevronRight className={clsx("size-4 transition-transform", b.open && "rotate-90")} /></button>
            <div className="min-w-0 flex-1 font-medium">{text()}</div>
          </div>
          {b.open && <AutoArea value={b.body ?? ""} onChange={(v) => patch({ body: v })} placeholder="What's inside" className="ml-6 text-fg/80" />}
        </div>
      );
    case "code":
      return (
        <div className="overflow-hidden rounded-[12px] bg-fg/[0.05]">
          <div className="flex items-center justify-between px-3 pt-2 text-[11.5px] text-muted">
            <input aria-label="Language" value={b.lang ?? ""} onChange={(e) => patch({ lang: e.target.value.slice(0, 40) })} placeholder="language" className="w-28 bg-transparent outline-none" />
            <button type="button" onClick={() => void navigator.clipboard?.writeText(b.text)} className="inline-flex items-center gap-1 hover:text-fg"><Copy className="size-3" /> Copy</button>
          </div>
          <AutoArea value={b.text} onChange={(v) => patch({ text: v })} placeholder="Code" className="px-4 pt-1 pb-3 font-mono text-[0.86em]" spellCheck={false} autoFocus={!!focus} tab />
        </div>
      );
    case "divider": return <button type="button" onClick={() => onFocus("end")} className="block w-full py-2" aria-label="Divider"><hr className="border-border" /></button>;
    case "table": return <TableEdit rows={b.rows ?? [["", ""]]} onChange={(rows) => patch({ rows })} />;
    case "calc": {
      const r = calc.get(b.id);
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-fg/[0.035] px-3 py-1.5 font-mono text-[0.92em]">
          <input aria-label="Label" value={b.lang ?? ""} onChange={(e) => patch({ lang: e.target.value.slice(0, 40) })} placeholder="Label" className="w-28 bg-transparent font-sans text-[0.85em] text-muted outline-none" />
          <input aria-label="Calculation" value={b.text} autoFocus={!!focus} onChange={(e) => patch({ text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); keys.enter(b.text, ""); } }} placeholder="e.g. total = 1200 * 3 + 18%" className="min-w-[160px] flex-1 bg-transparent outline-none" spellCheck={false} />
          <span className="tabular-nums">{r ? ("value" in r ? <b>= {fmtNum(r.value)}</b> : <span className="font-sans text-[0.85em] text-danger">{r.error}</span>) : <span className="text-subtle">=</span>}</span>
        </div>
      );
    }
    case "image":
      return (
        <div className="grid gap-1.5">
          {b.url ? <BlockView b={b} /> : null}
          <div className="flex flex-wrap gap-2 text-[13px]">
            <input aria-label="Image link" value={b.url ?? ""} onChange={(e) => patch({ url: e.target.value.trim() })} placeholder="Paste an image link (https://…)" className="min-w-[200px] flex-1 rounded-[8px] bg-surface-2 px-2.5 py-1.5 outline-none" />
            <input aria-label="Caption" value={b.caption ?? ""} onChange={(e) => patch({ caption: e.target.value })} placeholder="Caption" className="w-48 rounded-[8px] bg-surface-2 px-2.5 py-1.5 outline-none" />
          </div>
        </div>
      );
    case "link":
      return b.url && !focus ? (
        <div className="group/link relative"><BlockView b={b} /><button type="button" onClick={() => onFocus("end")} className="absolute top-2 right-2 rounded-full bg-surface px-2 py-0.5 text-[11px] opacity-0 ring-1 ring-border group-hover/link:opacity-100">Edit</button></div>
      ) : (
        <div className="flex flex-wrap gap-2 text-[13px]">
          <input aria-label="Link" value={b.url ?? ""} autoFocus onChange={(e) => patch({ url: e.target.value.trim() })} placeholder="https://…" className="min-w-[200px] flex-1 rounded-[8px] bg-surface-2 px-2.5 py-1.5 outline-none" />
          <input aria-label="Title" value={b.text} onChange={(e) => patch({ text: e.target.value })} onBlur={onBlur} placeholder="Title" className="w-48 rounded-[8px] bg-surface-2 px-2.5 py-1.5 outline-none" />
        </div>
      );
    case "record":
      return b.url ? (
        <div className="group/link relative"><BlockView b={b} /><button type="button" onClick={() => onPickRecord?.((r) => patch({ text: r.title, sub: r.sub, url: r.url, module: r.module }))} className="absolute top-2 right-2 rounded-full bg-surface px-2 py-0.5 text-[11px] opacity-0 ring-1 ring-border group-hover/link:opacity-100">Change</button></div>
      ) : (
        <button type="button" onClick={() => onPickRecord?.((r) => patch({ text: r.title, sub: r.sub, url: r.url, module: r.module }))} className="flex w-full items-center gap-2 rounded-[12px] border border-dashed border-border px-3 py-3 text-left text-[14px] text-muted hover:bg-surface-2"><Database className="size-4" /> Choose a record — an invoice, deal, contact, order, ticket…</button>
      );
    case "date":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" aria-label="Date" value={b.date ?? ""} onChange={(e) => patch({ date: e.target.value || undefined })} className="rounded-full bg-fg/[0.05] px-3 py-1 text-[0.92em] outline-none" />
          <div className="min-w-[120px] flex-1">{text({ placeholder: "What's on this day" })}</div>
        </div>
      );
    default: return text();
  }
}

/** A textarea that grows with its text. */
function AutoArea({ value, onChange, className, placeholder, spellCheck, autoFocus, tab, inputRef, ...rest }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; spellCheck?: boolean; autoFocus?: boolean; tab?: boolean; inputRef?: React.RefObject<HTMLTextAreaElement | null> } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const local = inputRef ?? own;
  useLayoutEffect(() => {
    const el = local.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, local]);
  return (
    <textarea
      {...rest}
      ref={local}
      rows={1}
      value={value}
      autoFocus={autoFocus}
      spellCheck={spellCheck}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (tab && e.key === "Tab") {
          e.preventDefault();
          const el = e.currentTarget;
          const s = el.selectionStart;
          onChange(`${value.slice(0, s)}  ${value.slice(el.selectionEnd)}`);
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
        }
        rest.onKeyDown?.(e);
      }}
      className={clsx("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-subtle/70", className)}
    />
  );
}

const SLASH_GROUPS = ["Text", "Lists", "Blocks", "Smart"] as const;
const FORMATS: { k: string; i: ReactNode; t: string; keys?: string }[] = [
  { k: "b", i: <Bold />, t: "Bold", keys: "mod+b" },
  { k: "i", i: <Italic />, t: "Italic", keys: "mod+i" },
  { k: "s", i: <Strikethrough />, t: "Strike", keys: "mod+shift+x" },
  { k: "c", i: <Code2 />, t: "Code", keys: "mod+e" },
  { k: "h", i: <Highlighter />, t: "Highlight", keys: "mod+shift+h" },
  { k: "l", i: <Link2 />, t: "Link", keys: "mod+k" },
  { k: "n", i: <span className="text-[11px] font-semibold">[[ ]]</span>, t: "Link to a note" },
];

/** A text block: formatted when you're not in it, its marks while you type. */
function TextInput({ b, focus, onFocus, onBlur, onText, keys, onNoteLink, rewrite, className, placeholder }: { b: Block; focus: Focus; onFocus: (at: "start" | "end" | number) => void; onBlur: () => void; onText: (t: string) => void; keys: Keys; onNoteLink?: (t: string) => void; rewrite?: AiRewrite; className?: string; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const { withKeys } = useShortcuts();
  const [sel, setSel] = useState<{ s: number; e: number } | null>(null);
  const [slashState, setSlashState] = useState({ q: "", i: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const slash = b.text.startsWith("/") && !/\s/.test(b.text.slice(1, 25)) ? b.text.slice(1).toLowerCase() : null;
  const options = slash === null ? [] : ELEMENTS.filter((e) => !slash || `${e.label} ${e.keys}`.toLowerCase().includes(slash));
  // The highlighted choice starts again at the top whenever what's typed changes.
  const slashAt = slashState.q === slash ? Math.min(slashState.i, Math.max(0, options.length - 1)) : 0;
  const setSlashAt = (f: (i: number) => number) => setSlashState({ q: slash ?? "", i: f(slashAt) });
  useEffect(() => {
    if (!focus || !ref.current) return;
    const el = ref.current;
    el.focus({ preventScroll: false });
    const at = focus.at === "start" ? 0 : focus.at === "end" ? el.value.length : Math.min(focus.at, el.value.length);
    el.setSelectionRange(at, at);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when focus moves here
  }, [focus?.id, focus?.at]);

  if (!focus) {
    return (
      <div role="textbox" tabIndex={0} aria-label={placeholder} onFocus={() => onFocus("end")} onClick={(e) => { if ((e.target as HTMLElement).closest("a,button")) return; onFocus("end"); }} className={clsx("min-h-[1.6em] cursor-text whitespace-pre-wrap break-words outline-none", className, !b.text && "text-subtle/60")}>
        {b.text ? <Inline text={b.text} onNote={onNoteLink} /> : b.type === "p" ? "" : placeholder}
      </div>
    );
  }

  const wrap = (l: string, r = l) => {
    const el = ref.current!;
    const s = el.selectionStart, e = el.selectionEnd;
    const v = b.text;
    onText(`${v.slice(0, s)}${l}${v.slice(s, e)}${r}${v.slice(e)}`);
    requestAnimationFrame(() => el.setSelectionRange(s + l.length, e + l.length));
  };
  const link = () => {
    const url = window.prompt("Link to (https://… or a page like /crm)");
    if (!url || !/^(https?:\/\/|\/(?!\/))/i.test(url.trim())) return;
    const el = ref.current!;
    const s = el.selectionStart, e = el.selectionEnd;
    const label = b.text.slice(s, e) || "link";
    onText(`${b.text.slice(0, s)}[${label}](${url.trim()})${b.text.slice(e)}`);
  };
  const format = (k: string) => {
    if (k === "l") return link();
    const [l, r] = ({ b: ["**", "**"], i: ["*", "*"], s: ["~~", "~~"], c: ["`", "`"], h: ["==", "=="], n: ["[[", "]]"] } as Record<string, [string, string]>)[k]!;
    wrap(l, r);
  };
  const aiOn = async (mode: string) => {
    if (!rewrite || !sel) return;
    const part = b.text.slice(sel.s, sel.e) || b.text;
    if (!part.trim()) return;
    setBusy(mode);
    try {
      const out = await rewrite(mode, part);
      onText(sel.e > sel.s ? `${b.text.slice(0, sel.s)}${out}${b.text.slice(sel.e)}` : out);
    } finally {
      setBusy(null);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    if (options.length) {
      if (e.key === "ArrowDown") return (e.preventDefault(), setSlashAt((x) => (x + 1) % options.length));
      if (e.key === "ArrowUp") return (e.preventDefault(), setSlashAt((x) => (x - 1 + options.length) % options.length));
      if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), keys.turnInto(options[slashAt]!.type));
      if (e.key === "Escape") return (e.preventDefault(), onText(""));
    }
    if (mod && e.key.toLowerCase() === "b") return (e.preventDefault(), wrap("**"));
    if (mod && e.key.toLowerCase() === "i") return (e.preventDefault(), wrap("*"));
    if (mod && e.key.toLowerCase() === "e") return (e.preventDefault(), wrap("`"));
    if (mod && e.shiftKey && e.key.toLowerCase() === "x") return (e.preventDefault(), wrap("~~"));
    if (mod && e.shiftKey && e.key.toLowerCase() === "h") return (e.preventDefault(), wrap("=="));
    if (mod && e.key.toLowerCase() === "k") return (e.preventDefault(), link());
    if (mod && e.key.toLowerCase() === "d") return (e.preventDefault(), keys.duplicate());
    if (e.altKey && e.key === "ArrowUp") return (e.preventDefault(), keys.move(-1));
    if (e.altKey && e.key === "ArrowDown") return (e.preventDefault(), keys.move(1));
    if (mod && e.key === "Enter" && b.type === "todo") return; // handled by the checkbox
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      keys.enter(b.text.slice(0, el.selectionStart), b.text.slice(el.selectionEnd));
      return;
    }
    if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) return (e.preventDefault(), keys.backspaceAtStart());
    if (e.key === "Tab") return (e.preventDefault(), keys.indent(e.shiftKey ? -1 : 1));
    if (e.key === "ArrowUp" && !b.text.slice(0, el.selectionStart).includes("\n")) return (e.preventDefault(), keys.up());
    if (e.key === "ArrowDown" && !b.text.slice(el.selectionEnd).includes("\n")) return (e.preventDefault(), keys.down());
  };
  const hasSel = !!sel && sel.e > sel.s;
  return (
    <div className="relative">
      {hasSel && (
        <div className="absolute -top-11 left-0 z-30 flex items-center gap-0.5 rounded-[10px] bg-fg p-1 text-bg shadow-xl" onMouseDown={(e) => e.preventDefault()}>
          {FORMATS.map((x) => (
            <button key={x.k} type="button" title={x.keys ? withKeys(x.t, x.keys) : x.t} aria-label={x.t} onClick={() => format(x.k)} className="grid size-7 place-items-center rounded-[7px] hover:bg-bg/15 [&>svg]:size-3.5">{x.i}</button>
          ))}
          {rewrite && (
            <>
              <span className="mx-0.5 h-4 w-px bg-bg/25" />
              <Menu
                label="AI"
                trigger={(p) => <button {...p} type="button" className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12px] font-medium hover:bg-bg/15">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} AI</button>}
                items={[["improve", "Improve writing"], ["fix", "Fix spelling & grammar"], ["shorter", "Make shorter"], ["longer", "Make longer"], ["simpler", "Simplify"], ["professional", "More professional"], ["friendly", "More friendly"], ["bullets", "Turn into points"]].map(([k, l]) => ({ label: l!, icon: <Wand2 />, onSelect: () => void aiOn(k!) }))}
              />
            </>
          )}
        </div>
      )}
      <AutoArea
        inputRef={ref}
        value={b.text}
        onChange={(v) => {
          const hit = SHORTCUTS.find(([re]) => re.test(v));
          // Markdown at the start of a line: in plain text, or in an empty list item ("- " in a to-do stays as typed).
          if (hit && (b.type === "p" || (TEXTUAL.has(b.type) && hit[1] !== b.type))) return keys.turnInto(hit[1], hit[2]);
          onText(v);
        }}
        onKeyDown={onKey}
        onSelect={(e) => setSel({ s: e.currentTarget.selectionStart, e: e.currentTarget.selectionEnd })}
        onBlur={() => { setSel(null); onBlur(); }}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text/plain");
          // Several lines of Markdown become blocks.
          if (t.includes("\n") && t.split("\n").length > 2) {
            e.preventDefault();
            keys.paste(t);
          }
        }}
        placeholder={placeholder}
        className={className}
      />
      {options.length > 0 && (
        <div data-popover className="absolute top-full left-0 z-30 mt-1 max-h-[340px] w-[300px] overflow-y-auto rounded-[14px] bg-surface-solid p-1.5 shadow-2xl ring-1 ring-border" onMouseDown={(e) => e.preventDefault()}>
          {SLASH_GROUPS.map((g) => {
            const items = options.filter((o) => o.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <p className="px-2 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wide text-subtle uppercase">{g}</p>
                {items.map((o) => {
                  const on = options.indexOf(o) === slashAt;
                  return (
                    <button key={o.type} type="button" onMouseEnter={() => setSlashAt(() => options.indexOf(o))} onClick={() => keys.turnInto(o.type)} className={clsx("flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left", on && "bg-surface-2")}>
                      <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-surface ring-1 ring-border [&>svg]:size-3.5">{o.icon}</span>
                      <span className="min-w-0"><span className="block text-[13px] font-medium">{o.label}</span><span className="block truncate text-[11.5px] text-muted">{o.line}</span></span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TableEdit({ rows, onChange }: { rows: string[][]; onChange: (r: string[][]) => void }) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const grid = rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
  const setCell = (i: number, j: number, v: string) => onChange(grid.map((r, a) => (a === i ? r.map((c, b) => (b === j ? v : c)) : r)));
  return (
    <div className="grid gap-1.5">
      <div className="overflow-x-auto rounded-[10px] ring-1 ring-border">
        <table className="w-full text-[0.92em]">
          <tbody>
            {grid.map((r, i) => (
              <tr key={i} className={clsx("border-b border-border/60 last:border-0", i === 0 && "bg-fg/[0.04] font-semibold")}>
                {r.map((c, j) => (
                  <td key={j} className="min-w-[110px] border-r border-border/60 p-0 last:border-0">
                    <input aria-label={`Row ${i + 1}, column ${j + 1}`} value={c} onChange={(e) => setCell(i, j, e.target.value)} className="w-full bg-transparent px-3 py-1.5 outline-none focus:bg-accent-soft/40" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[12px] text-muted">
        <button type="button" onClick={() => onChange([...grid, Array(cols).fill("")])} className="rounded-full px-2 py-0.5 ring-1 ring-border hover:text-fg">+ Row</button>
        <button type="button" onClick={() => cols < 12 && onChange(grid.map((r) => [...r, ""]))} className="rounded-full px-2 py-0.5 ring-1 ring-border hover:text-fg">+ Column</button>
        {grid.length > 2 && <button type="button" onClick={() => onChange(grid.slice(0, -1))} className="rounded-full px-2 py-0.5 ring-1 ring-border hover:text-fg">− Row</button>}
        {cols > 1 && <button type="button" onClick={() => onChange(grid.map((r) => r.slice(0, -1)))} className="rounded-full px-2 py-0.5 ring-1 ring-border hover:text-fg">− Column</button>}
        <button type="button" onClick={() => { const csv = grid.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"); void navigator.clipboard?.writeText(csv); }} className="rounded-full px-2 py-0.5 ring-1 ring-border hover:text-fg">Copy as CSV</button>
      </div>
    </div>
  );
}

/** The Elements panel: drag one into the note, or tap to add it. */
export function ElementsPanel({ onAdd, className }: { onAdd: (t: BlockType) => void; className?: string }) {
  return (
    <div className={clsx("grid gap-3", className)}>
      {SLASH_GROUPS.map((g) => (
        <div key={g}>
          <p className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-subtle uppercase">{g}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ELEMENTS.filter((e) => e.group === g).map((e) => (
              <button
                key={e.type}
                type="button"
                draggable
                onDragStart={(ev) => { ev.dataTransfer.setData("application/x-note-element", e.type); ev.dataTransfer.effectAllowed = "copy"; }}
                onClick={() => onAdd(e.type)}
                title={`${e.line} — drag into the note, or click to add`}
                className="flex cursor-grab items-center gap-2 rounded-[10px] bg-surface px-2 py-2 text-left text-[12.5px] ring-1 ring-border transition-colors hover:bg-surface-2 active:cursor-grabbing"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-surface-2 [&>svg]:size-3.5">{e.icon}</span>
                <span className="truncate font-medium">{e.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11.5px] leading-snug text-subtle">Tip: type <kbd className="rounded bg-surface-2 px-1">/</kbd> in a line for these, drop .md or .txt files to import, and drag a block&apos;s <GripVertical className="inline size-3" /> to move it.</p>
    </div>
  );
}
