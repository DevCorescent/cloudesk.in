"use client";

// The editor's interactive parts: the "/" menu of blocks, @people and #record
// mentions, find & replace highlighting, and comment highlights (drawn from
// each thread's anchor, so commenting never changes the document).
import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import clsx from "clsx";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";

// ── A floating list for suggestions ────────────────────────────────────────

export type Item = { id: string; label: string; sub?: string; icon?: ReactNode; group?: string; run?: (editor: Editor, range: Range) => void; attrs?: Record<string, unknown> };
type ListHandle = { onKeyDown: (e: KeyboardEvent) => boolean };

const SuggestList = forwardRef<ListHandle, { items: Item[]; command: (i: Item) => void; empty: string }>(function SuggestList({ items, command, empty }, ref) {
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [prev, setPrev] = useState(items);
  if (prev !== items) {
    setPrev(items);
    setAt(0);
  }
  useEffect(() => {
    box.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (e.key === "ArrowDown") return (setAt((a) => (a + 1) % Math.max(1, items.length)), true);
      if (e.key === "ArrowUp") return (setAt((a) => (a - 1 + items.length) % Math.max(1, items.length)), true);
      if (e.key === "Enter" || e.key === "Tab") {
        if (items[at]) command(items[at]!);
        return !!items[at];
      }
      return false;
    },
  }));
  let lastGroup = "";
  return (
    <div ref={box} role="listbox" className="doc-pop max-h-[320px] w-[min(300px,calc(100vw-24px))] overflow-y-auto rounded-[14px] border border-border bg-[var(--surface-solid)] p-1 shadow-[0_18px_50px_-14px_rgb(0_0_0/0.35)]">
      {!items.length && <p className="px-3 py-2.5 text-[12.5px] text-muted">{empty}</p>}
      {items.map((it, i) => {
        const head = it.group && it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null;
        return (
          <div key={it.id}>
            {head && <p className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.1em] text-subtle uppercase">{head}</p>}
            <button
              type="button"
              role="option"
              aria-selected={i === at}
              data-i={i}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                command(it);
              }}
              className={clsx("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left", i === at ? "bg-fg/[0.06]" : "")}
            >
              {it.icon && <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-border bg-bg text-fg/75 [&_svg]:size-4">{it.icon}</span>}
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{it.label}</span>
                {it.sub && <span className="block truncate text-[11.5px] text-muted">{it.sub}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** Renders a suggestion list in a fixed-position popup beside the caret. */
export function popupRender(empty: string): SuggestionOptions<Item>["render"] {
  return () => {
    let r: ReactRenderer<ListHandle, { items: Item[]; command: (i: Item) => void; empty: string }> | null = null;
    const place = (props: SuggestionProps<Item>) => {
      const rect = props.clientRect?.();
      const el = r?.element as HTMLElement | undefined;
      if (!rect || !el) return;
      const h = el.offsetHeight || 300;
      const below = rect.bottom + 6 + h < window.innerHeight;
      el.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - h - 6)}px`;
      el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 312))}px`;
    };
    return {
      onStart: (props) => {
        r = new ReactRenderer(SuggestList, { props: { items: props.items, command: props.command, empty }, editor: props.editor });
        const el = r.element as HTMLElement;
        el.style.position = "fixed";
        el.style.zIndex = "70";
        document.body.appendChild(el);
        requestAnimationFrame(() => place(props));
      },
      onUpdate: (props) => {
        r?.updateProps({ items: props.items, command: props.command, empty });
        requestAnimationFrame(() => place(props));
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") {
          (r?.element as HTMLElement | undefined)?.remove();
          r?.destroy();
          r = null;
          return true;
        }
        return r?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: () => {
        (r?.element as HTMLElement | undefined)?.remove();
        r?.destroy();
        r = null;
      },
    };
  };
}

const match = (q: string, ...xs: (string | undefined)[]) => {
  const t = q.toLowerCase().trim();
  return !t || xs.some((x) => x?.toLowerCase().includes(t));
};

/** "/" opens the block menu. */
export function slashCommand(items: () => (Item & { keys?: string })[]) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<Item & { keys?: string }>({
          editor: this.editor,
          char: "/",
          pluginKey: new PluginKey("slash"),
          allowSpaces: false,
          startOfLine: false,
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            return !$from.parent.type.spec.code;
          },
          items: ({ query }) => items().filter((i) => match(query, i.label, i.keys, i.group)).slice(0, 40),
          command: ({ editor, range, props }) => props.run?.(editor, range),
          render: popupRender("No blocks match"),
        }),
      ];
    },
  });
}

/** Suggestions for a mention trigger (@ for people, # for records). */
export function mentionSuggestion(char: "@" | "#", find: (q: string) => Item[] | Promise<Item[]>): Omit<SuggestionOptions<Item>, "editor"> {
  return {
    char,
    pluginKey: new PluginKey(`mention-${char === "@" ? "people" : "records"}`),
    allowSpaces: char === "#",
    items: async ({ query }) => (await find(query)).slice(0, 12),
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [{ type: "mention", attrs: { id: props.id, label: props.label, kind: char === "@" ? "person" : "record", href: props.attrs?.href ?? null, mentionSuggestionChar: char } }, { type: "text", text: " " }])
        .run();
    },
    render: popupRender(char === "@" ? "Nobody by that name" : "Type to search records"),
  };
}

// ── Find & replace ─────────────────────────────────────────────────────────

export const findKey = new PluginKey<{ query: string; caseSensitive: boolean; index: number; hits: { from: number; to: number }[] }>("find");

function hitsIn(doc: import("@tiptap/pm/model").Node, query: string, caseSensitive: boolean) {
  const hits: { from: number; to: number }[] = [];
  if (!query) return hits;
  const q = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const t = caseSensitive ? node.text : node.text.toLowerCase();
    for (let i = t.indexOf(q); i >= 0 && hits.length < 2000; i = t.indexOf(q, i + q.length)) hits.push({ from: pos + i, to: pos + i + q.length });
  });
  return hits;
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => ({ query: "", caseSensitive: false, index: 0, hits: [] as { from: number; to: number }[] }),
          apply(tr, v) {
            const meta = tr.getMeta(findKey) as Partial<typeof v> | undefined;
            const next = meta ? { ...v, ...meta } : v;
            if (meta || tr.docChanged) {
              const hits = hitsIn(tr.doc, next.query, next.caseSensitive);
              return { ...next, hits, index: Math.min(next.index, Math.max(0, hits.length - 1)) };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state);
            if (!s?.hits.length) return null;
            return DecorationSet.create(state.doc, s.hits.map((h, i) => Decoration.inline(h.from, h.to, { class: i === s.index ? "doc-find doc-find-on" : "doc-find" })));
          },
        },
      }),
    ];
  },
});

export function setFind(editor: Editor, v: { query?: string; caseSensitive?: boolean; index?: number }) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, v));
  const s = findKey.getState(editor.state);
  const hit = s?.hits[s.index];
  if (hit) {
    const dom = editor.view.domAtPos(hit.from).node as HTMLElement;
    (dom.nodeType === 3 ? dom.parentElement : dom)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return s;
}

export function replaceHits(editor: Editor, replacement: string, all: boolean) {
  const s = findKey.getState(editor.state);
  if (!s?.hits.length) return 0;
  const targets = all ? [...s.hits].reverse() : [s.hits[s.index]!];
  const tr = editor.state.tr;
  for (const h of targets) {
    if (replacement) tr.insertText(replacement, h.from, h.to);
    else tr.delete(h.from, h.to);
  }
  editor.view.dispatch(tr);
  return targets.length;
}

// ── Comment highlights ─────────────────────────────────────────────────────

export const commentKey = new PluginKey<{ ranges: { id: string; from: number; to: number }[]; active: string | null }>("comments");

/** Highlights where comment threads sit; positions come from the threads' anchors (set from outside). */
export const CommentHighlights = Extension.create<{ onClick: (id: string) => void }>({
  name: "commentHighlights",
  addOptions: () => ({ onClick: () => {} }),
  addProseMirrorPlugins() {
    const onClick = this.options.onClick;
    return [
      new Plugin({
        key: commentKey,
        state: {
          init: () => ({ ranges: [] as { id: string; from: number; to: number }[], active: null as string | null }),
          apply(tr, v) {
            const meta = tr.getMeta(commentKey) as typeof v | undefined;
            if (meta) return meta;
            if (!tr.docChanged) return v;
            return { ...v, ranges: v.ranges.map((r) => ({ ...r, from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) })).filter((r) => r.to > r.from) };
          },
        },
        props: {
          decorations(state) {
            const s = commentKey.getState(state);
            if (!s?.ranges.length) return null;
            const size = state.doc.content.size;
            return DecorationSet.create(
              state.doc,
              s.ranges.filter((r) => r.from >= 0 && r.to <= size && r.to > r.from).map((r) => Decoration.inline(r.from, r.to, { class: r.id === s.active ? "doc-comment doc-comment-on" : "doc-comment", "data-thread": r.id })),
            );
          },
          handleClick(view, pos) {
            const s = commentKey.getState(view.state);
            const hit = s?.ranges.find((r) => pos >= r.from && pos <= r.to);
            if (hit) onClick(hit.id);
            return false;
          },
        },
      }),
    ];
  },
});
