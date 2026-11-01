"use client";

// The formatting toolbar: undo/redo, paragraph style, font and size, marks,
// colours, links, images, tables, comments, alignment, spacing, lists and
// indents. Reads the editor's state for what's on at the caret.
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import clsx from "clsx";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, CheckSquare, ChevronDown, Code2, Eraser, Highlighter, ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, MessageSquarePlus, Minus, MoreHorizontal, Plus, Printer, Quote, Redo2, Rows3, Strikethrough, Subscript, Superscript, Table2, Underline, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FONTS, FONT_SIZES, LINE_HEIGHTS, type PageSetup } from "@/lib/documents/write";

export const TEXT_COLORS = ["", "#1d1d1f", "#64748b", "#e5484d", "#e8743b", "#c9871a", "#1f9d6c", "#0e9aa7", "#2a86d1", "#7c5cdb", "#d6409f"];
export const HIGHLIGHTS = ["", "#fde68a", "#fecaca", "#fed7aa", "#bbf7d0", "#a5f3fc", "#bfdbfe", "#ddd6fe", "#fbcfe8", "#e5e7eb"];

const STYLES = [
  { id: "p", label: "Normal text", cls: "text-[13px]" },
  { id: "h1", label: "Heading 1", cls: "text-[19px] font-bold" },
  { id: "h2", label: "Heading 2", cls: "text-[16.5px] font-semibold" },
  { id: "h3", label: "Heading 3", cls: "text-[14.5px] font-semibold" },
  { id: "h4", label: "Heading 4", cls: "text-[13px] font-semibold" },
  { id: "quote", label: "Quote", cls: "text-[13px] italic text-muted" },
  { id: "code", label: "Code", cls: "font-mono text-[12px]" },
] as const;

export function setStyle(editor: Editor, id: string) {
  const c = editor.chain().focus();
  if (id === "p") c.setParagraph().run();
  else if (id.startsWith("h")) c.setHeading({ level: Number(id[1]) as 1 | 2 | 3 | 4 }).run();
  else if (id === "quote") c.toggleBlockquote().run();
  else if (id === "code") c.toggleCodeBlock().run();
}

/** A small popover anchored under a toolbar button (portalled so the scrolling toolbar never clips it). */
export function Pop({ anchor, onClose, children, className }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = box.current?.offsetWidth ?? 220;
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
    };
    place();
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={box} className={clsx("doc-pop fixed z-[70] rounded-[14px] border border-border bg-[var(--surface-solid)] p-1.5 shadow-[0_18px_50px_-14px_rgb(0_0_0/0.35)]", className)} style={pos ?? { top: -9999, left: -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

function Tool({ label, on, onClick, children, disabled, keys, className }: { label: string; on?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode; disabled?: boolean; keys?: string; className?: string }) {
  return (
    <button type="button" className={clsx("doc-tool shrink-0", className)} data-on={on ? "true" : undefined} aria-pressed={on} aria-label={label} title={keys ? `${label} (${keys})` : label} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

export function Swatches({ colors, value, onPick, label }: { colors: string[]; value: string | null | undefined; onPick: (c: string) => void; label: string }) {
  return (
    <div className="grid grid-cols-6 gap-1.5 p-1" role="group" aria-label={label}>
      {colors.map((c) => (
        <button key={c || "none"} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} aria-label={c ? `Colour ${c}` : "None"} className={clsx("grid size-7 place-items-center rounded-full ring-1 ring-fg/10 transition-transform hover:scale-110", (value ?? "") === c && "ring-2 ring-[#7c5cdb]")} style={{ background: c || "transparent" }}>
          {!c && <span className="h-px w-4 rotate-45 bg-danger" />}
        </button>
      ))}
    </div>
  );
}

export type ToolbarActions = { onLink: () => void; onImage: () => void; onComment: () => void; onPrint: () => void; canComment: boolean };

export function Toolbar({ editor, page, editable, a }: { editor: Editor; page: PageSetup; editable: boolean; a: ToolbarActions }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      sub: e.isActive("subscript"),
      sup: e.isActive("superscript"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      align: (["left", "center", "right", "justify"] as const).find((x) => e.isActive({ textAlign: x })) ?? "left",
      style: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : e.isActive("heading", { level: 4 }) ? "h4" : e.isActive("codeBlock") ? "code" : e.isActive("blockquote") ? "quote" : "p",
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
      highlight: (e.getAttributes("highlight").color as string | undefined) ?? "",
      lineHeight: (e.getAttributes("textStyle").lineHeight as string | undefined) ?? "",
      undo: e.can().undo?.() ?? false,
      redo: e.can().redo?.() ?? false,
      table: e.isActive("table"),
    }),
  });
  const [pop, setPop] = useState<{ kind: string; el: HTMLElement } | null>(null);
  const open = (kind: string) => (e: React.MouseEvent<HTMLButtonElement>) => setPop((p) => (p?.kind === kind ? null : { kind, el: e.currentTarget }));
  const close = () => setPop(null);
  const c = () => editor.chain().focus();
  const sizeNow = st.size ? Math.round(parseFloat(st.size) * (st.size.endsWith("px") ? 0.75 : 1)) : page.fontSize;
  const setSize = (n: number) => {
    const v = Math.max(6, Math.min(96, n));
    c().setFontSize(`${v}pt`).run();
  };
  const fontLabel = FONTS.find((f) => st.font && (f.css === st.font || f.id === st.font || st.font.includes(f.id)))?.label ?? (st.font ? st.font.split(",")[0]!.replace(/['"]/g, "") : FONTS.find((f) => f.id === page.font)?.label ?? "Inter");
  if (!editable)
    return (
      <div className="flex h-11 items-center gap-1 px-3 text-[12.5px] text-muted">
        <Tool label="Print or save as PDF" onClick={a.onPrint}>
          <Printer />
        </Tool>
        <span className="ml-1">{a.canComment ? "You can comment on this document. Select text to add a comment." : "You can view this document."}</span>
        {a.canComment && (
          <Tool label="Comment" onClick={a.onComment} className="ml-auto">
            <MessageSquarePlus />
          </Tool>
        )}
      </div>
    );
  return (
    <div role="toolbar" aria-label="Formatting" className="flex h-11 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Tool label="Undo" keys="⌘Z" onClick={() => c().undo().run()} disabled={!st.undo}>
        <Undo2 />
      </Tool>
      <Tool label="Redo" keys="⌘⇧Z" onClick={() => c().redo().run()} disabled={!st.redo}>
        <Redo2 />
      </Tool>
      <Tool label="Print" keys="⌘P" onClick={a.onPrint} className="max-sm:!hidden">
        <Printer />
      </Tool>
      <span className="doc-sep" />
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={open("style")} aria-haspopup="listbox" aria-label="Paragraph style" className="doc-tool shrink-0 !justify-between gap-1 !px-2 text-[12.5px] font-medium" style={{ width: 118, display: "inline-flex" }}>
        <span className="truncate">{STYLES.find((x) => x.id === st.style)?.label}</span>
        <ChevronDown className="!size-3.5 opacity-60" />
      </button>
      <span className="doc-sep max-sm:!hidden" />
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={open("font")} aria-haspopup="listbox" aria-label="Font" className="doc-tool shrink-0 !justify-between gap-1 !px-2 text-[12.5px] max-sm:!hidden" style={{ width: 112, display: "inline-flex" }}>
        <span className="truncate">{fontLabel}</span>
        <ChevronDown className="!size-3.5 opacity-60" />
      </button>
      <span className="doc-sep" />
      <Tool label="Smaller text" onClick={() => setSize(sizeNow - 1)}>
        <Minus />
      </Tool>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={open("size")} aria-label={`Font size ${sizeNow}`} className="doc-tool shrink-0 rounded-[7px] !px-0 text-[12.5px] font-medium tabular-nums ring-1 ring-border" style={{ width: 36 }}>
        {sizeNow}
      </button>
      <Tool label="Bigger text" onClick={() => setSize(sizeNow + 1)}>
        <Plus />
      </Tool>
      <span className="doc-sep" />
      <Tool label="Bold" keys="⌘B" on={st.bold} onClick={() => c().toggleBold().run()}>
        <Bold />
      </Tool>
      <Tool label="Italic" keys="⌘I" on={st.italic} onClick={() => c().toggleItalic().run()}>
        <Italic />
      </Tool>
      <Tool label="Underline" keys="⌘U" on={st.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline />
      </Tool>
      <Tool label="Strikethrough" keys="⌘⇧S" on={st.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough />
      </Tool>
      <Tool label="Text colour" onClick={open("color")}>
        <span className="relative grid place-items-center">
          <Baseline />
          <span className="absolute -bottom-1 h-[3px] w-4 rounded-full" style={{ background: st.color || "currentColor" }} />
        </span>
      </Tool>
      <Tool label="Highlight" onClick={open("highlight")}>
        <span className="relative grid place-items-center">
          <Highlighter />
          <span className="absolute -bottom-1 h-[3px] w-4 rounded-full" style={{ background: st.highlight || "#fde68a" }} />
        </span>
      </Tool>
      <span className="doc-sep" />
      <Tool label="Link" keys="⌘K" on={st.link} onClick={a.onLink}>
        <Link2 />
      </Tool>
      <Tool label="Comment" keys="⌘⌥M" onClick={a.onComment}>
        <MessageSquarePlus />
      </Tool>
      <Tool label="Image" onClick={a.onImage}>
        <ImagePlus />
      </Tool>
      <Tool label="Table" on={st.table} onClick={open("table")}>
        <Table2 />
      </Tool>
      <span className="doc-sep" />
      <Tool label="Align" onClick={open("align")}>
        {st.align === "center" ? <AlignCenter /> : st.align === "right" ? <AlignRight /> : st.align === "justify" ? <AlignJustify /> : <AlignLeft />}
      </Tool>
      <Tool label="Line spacing" onClick={open("spacing")}>
        <Rows3 />
      </Tool>
      <Tool label="Checklist" keys="⌘⇧9" on={st.task} onClick={() => c().toggleTaskList().run()}>
        <CheckSquare />
      </Tool>
      <Tool label="Bulleted list" keys="⌘⇧8" on={st.bullet} onClick={() => c().toggleBulletList().run()}>
        <List />
      </Tool>
      <Tool label="Numbered list" keys="⌘⇧7" on={st.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered />
      </Tool>
      <Tool label="Decrease indent" keys="⇧Tab" onClick={() => (editor.isActive("listItem") ? c().liftListItem("listItem").run() : editor.isActive("taskItem") ? c().liftListItem("taskItem").run() : c().outdent().run())}>
        <IndentDecrease />
      </Tool>
      <Tool label="Increase indent" keys="Tab" onClick={() => (editor.isActive("listItem") ? c().sinkListItem("listItem").run() : editor.isActive("taskItem") ? c().sinkListItem("taskItem").run() : c().indent().run())}>
        <IndentIncrease />
      </Tool>
      <Tool label="Clear formatting" keys="⌘\" onClick={() => c().unsetAllMarks().clearNodes().run()}>
        <Eraser />
      </Tool>
      <span className="doc-sep" />
      <Tool label="More" onClick={open("more")}>
        <MoreHorizontal />
      </Tool>

      {pop?.kind === "style" && (
        <Pop anchor={pop.el} onClose={close} className="w-56">
          {STYLES.map((x) => (
            <button key={x.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (setStyle(editor, x.id), close())} className={clsx("flex w-full items-center rounded-[9px] px-2.5 py-1.5 text-left hover:bg-fg/[0.05]", st.style === x.id && "bg-fg/[0.06]", x.cls)}>
              {x.label}
            </button>
          ))}
        </Pop>
      )}
      {pop?.kind === "font" && (
        <Pop anchor={pop.el} onClose={close} className="max-h-[320px] w-56 overflow-y-auto">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().unsetFontFamily().run(), close())} className="flex w-full rounded-[9px] px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-fg/[0.05]">
            Document font ({FONTS.find((f) => f.id === page.font)?.label ?? "Inter"})
          </button>
          {FONTS.map((f) => (
            <button key={f.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().setFontFamily(f.css).run(), close())} className="flex w-full rounded-[9px] px-2.5 py-1.5 text-left text-[14px] hover:bg-fg/[0.05]" style={{ fontFamily: f.css }}>
              {f.label}
            </button>
          ))}
        </Pop>
      )}
      {pop?.kind === "size" && (
        <Pop anchor={pop.el} onClose={close} className="max-h-[300px] w-24 overflow-y-auto">
          {FONT_SIZES.map((n) => (
            <button key={n} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (setSize(n), close())} className={clsx("flex w-full justify-center rounded-[8px] py-1 text-[13px] tabular-nums hover:bg-fg/[0.05]", n === sizeNow && "bg-fg/[0.06] font-semibold")}>
              {n}
            </button>
          ))}
        </Pop>
      )}
      {pop?.kind === "color" && (
        <Pop anchor={pop.el} onClose={close}>
          <p className="px-1.5 pt-1 text-[11px] font-semibold text-subtle uppercase">Text colour</p>
          <Swatches colors={TEXT_COLORS} value={st.color} label="Text colour" onPick={(col) => (col ? c().setColor(col).run() : c().unsetColor().run(), close())} />
        </Pop>
      )}
      {pop?.kind === "highlight" && (
        <Pop anchor={pop.el} onClose={close}>
          <p className="px-1.5 pt-1 text-[11px] font-semibold text-subtle uppercase">Highlight</p>
          <Swatches colors={HIGHLIGHTS} value={st.highlight} label="Highlight colour" onPick={(col) => (col ? c().setHighlight({ color: col }).run() : c().unsetHighlight().run(), close())} />
        </Pop>
      )}
      {pop?.kind === "align" && (
        <Pop anchor={pop.el} onClose={close} className="flex gap-0.5">
          {(
            [
              ["left", <AlignLeft key="l" />, "Left", "⌘⇧L"],
              ["center", <AlignCenter key="c" />, "Centre", "⌘⇧E"],
              ["right", <AlignRight key="r" />, "Right", "⌘⇧R"],
              ["justify", <AlignJustify key="j" />, "Justify", "⌘⇧J"],
            ] as const
          ).map(([id, icon, label, keys]) => (
            <Tool key={id} label={label} keys={keys} on={st.align === id} onClick={() => (c().setTextAlign(id).run(), close())}>
              {icon}
            </Tool>
          ))}
        </Pop>
      )}
      {pop?.kind === "spacing" && (
        <Pop anchor={pop.el} onClose={close} className="w-44">
          <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-subtle uppercase">Line spacing</p>
          {LINE_HEIGHTS.map((h) => (
            <button key={h} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().setLineHeight(h).run(), close())} className={clsx("flex w-full rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-fg/[0.05]", (st.lineHeight || page.lineHeight) === h && "bg-fg/[0.06] font-semibold")}>
              {h === "1" ? "Single" : h === "2" ? "Double" : h}
            </button>
          ))}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().unsetLineHeight().run(), close())} className="flex w-full rounded-[8px] px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-fg/[0.05]">
            Document default
          </button>
        </Pop>
      )}
      {pop?.kind === "table" && <TablePicker editor={editor} onClose={close} anchor={pop.el} />}
      {pop?.kind === "more" && (
        <Pop anchor={pop.el} onClose={close} className="flex gap-0.5">
          <Tool label="Subscript" keys="⌘," on={st.sub} onClick={() => c().toggleSubscript().run()}>
            <Subscript />
          </Tool>
          <Tool label="Superscript" keys="⌘." on={st.sup} onClick={() => c().toggleSuperscript().run()}>
            <Superscript />
          </Tool>
          <Tool label="Inline code" keys="⌘E" on={st.code} onClick={() => c().toggleCode().run()}>
            <Code2 />
          </Tool>
          <Tool label="Quote" onClick={() => c().toggleBlockquote().run()}>
            <Quote />
          </Tool>
          <Tool label="Horizontal line" onClick={() => (c().setHorizontalRule().run(), close())}>
            <Minus />
          </Tool>
        </Pop>
      )}
    </div>
  );
}

/** Pick a table's size by hovering a grid, like a word processor. */
function TablePicker({ editor, onClose, anchor }: { editor: Editor; onClose: () => void; anchor: HTMLElement }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  const inTable = editor.isActive("table");
  const c = () => editor.chain().focus();
  if (inTable)
    return (
      <Pop anchor={anchor} onClose={onClose} className="w-56">
        {(
          [
            ["Insert row above", () => c().addRowBefore().run()],
            ["Insert row below", () => c().addRowAfter().run()],
            ["Insert column left", () => c().addColumnBefore().run()],
            ["Insert column right", () => c().addColumnAfter().run()],
            ["Delete row", () => c().deleteRow().run()],
            ["Delete column", () => c().deleteColumn().run()],
            ["Merge or split cells", () => c().mergeOrSplit().run()],
            ["Header row on/off", () => c().toggleHeaderRow().run()],
            ["Delete table", () => c().deleteTable().run()],
          ] as const
        ).map(([label, run]) => (
          <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (run(), onClose())} className={clsx("flex w-full rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-fg/[0.05]", label === "Delete table" && "text-danger")}>
            {label}
          </button>
        ))}
      </Pop>
    );
  return (
    <Pop anchor={anchor} onClose={onClose}>
      <div className="grid grid-cols-8 gap-[3px] p-1" onMouseLeave={() => setHover([0, 0])}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1;
          const col = (i % 8) + 1;
          const on = r <= hover[0] && col <= hover[1];
          return <button key={i} type="button" aria-label={`${r} by ${col} table`} onMouseEnter={() => setHover([r, col])} onMouseDown={(e) => e.preventDefault()} onClick={() => (c().insertTable({ rows: r, cols: col, withHeaderRow: true }).run(), onClose())} className={clsx("size-[18px] rounded-[3px] border", on ? "border-[#7c5cdb] bg-[#7c5cdb]/25" : "border-border bg-bg")} />;
        })}
      </div>
      <p className="pb-1 text-center text-[12px] text-muted tabular-nums">{hover[0] ? `${hover[0]} × ${hover[1]}` : "Insert a table"}</p>
    </Pop>
  );
}
