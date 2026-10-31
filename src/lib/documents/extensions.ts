// The written document's building blocks. The same list makes the schema on
// the server (to seed live copies, import and export) and in the browser,
// where the editor adds its interactive parts on top (collaboration, menus).
import { Extension, Mark, mergeAttributes, Node, type AnyExtension } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Mention from "@tiptap/extension-mention";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docBlocks: {
      setCallout: (tone?: string) => ReturnType;
      setPageBreak: () => ReturnType;
      insertToc: () => ReturnType;
      setComment: (id: string) => ReturnType;
      unsetComment: (id: string) => ReturnType;
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

export const CALLOUT_TONES = ["info", "success", "warning", "danger"] as const;

/** A highlighted box for notes, tips and warnings. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({ tone: { default: "info", parseHTML: (el) => el.getAttribute("data-tone") ?? "info", renderHTML: (a) => ({ "data-tone": a.tone }) } }),
  parseHTML: () => [{ tag: "div[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-callout": "", class: "doc-callout" }), 0],
  addCommands() {
    return {
      setCallout:
        (tone = "info") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { tone }),
    };
  },
});

/** Starts a new page when printed or exported. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: () => ["div", { "data-page-break": "", class: "doc-page-break" }],
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name }, { type: "paragraph" }]).run(),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  },
});

/** A live table of contents, built from the document's headings. */
export const TocBlock = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-toc]" }],
  renderHTML: () => ["div", { "data-toc": "", class: "doc-toc" }],
  addCommands() {
    return {
      insertToc:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name }, { type: "paragraph" }]).run(),
    };
  },
});

/** Text a comment thread is attached to. */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes: () => ({ id: { default: null, parseHTML: (el) => el.getAttribute("data-comment"), renderHTML: (a) => ({ "data-comment": a.id }) } }),
  parseHTML: () => [{ tag: "span[data-comment]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "doc-comment" }), 0],
  addCommands() {
    return {
      setComment:
        (id) =>
        ({ commands }) =>
          commands.setMark(this.name, { id }),
      unsetComment:
        (id) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks.comment!;
          state.doc.descendants((node, pos) => {
            for (const m of node.marks) if (m.type === type && m.attrs.id === id) tr.removeMark(pos, pos + node.nodeSize, m);
          });
          dispatch?.(tr);
          return true;
        },
    };
  },
});

const INDENTED = ["paragraph", "heading"];
/** Paragraph and heading indent, in steps (Tab and Shift-Tab outside lists). */
export const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes: () => [
    {
      types: INDENTED,
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => Number(el.getAttribute("data-indent") ?? 0) || 0,
          renderHTML: (a) => (a.indent ? { "data-indent": a.indent, style: `margin-left: ${a.indent * 2}em` } : {}),
        },
      },
    },
  ],
  addCommands() {
    const step =
      (d: number) =>
      () =>
      ({ tr, state, dispatch }: { tr: import("@tiptap/pm/state").Transaction; state: import("@tiptap/pm/state").EditorState; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void }) => {
        let changed = false;
        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
          if (!INDENTED.includes(node.type.name)) return;
          const next = Math.max(0, Math.min(8, Number(node.attrs.indent ?? 0) + d));
          if (next !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
          return false;
        });
        if (changed) dispatch?.(tr);
        return changed;
      };
    return { indent: step(1), outdent: step(-1) } as never;
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => (this.editor.isActive("listItem") || this.editor.isActive("taskItem") || this.editor.isActive("table") ? false : this.editor.commands.indent()),
      "Shift-Tab": () => (this.editor.isActive("listItem") || this.editor.isActive("taskItem") || this.editor.isActive("table") ? false : this.editor.commands.outdent()),
    };
  },
});

/** Images, with a width (% of the line) and alignment. */
export const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: 100, parseHTML: (el) => Number(el.getAttribute("data-width") ?? 100) || 100, renderHTML: (a) => ({ "data-width": a.width, style: `width: ${a.width}%` }) },
      align: { default: "center", parseHTML: (el) => el.getAttribute("data-align") ?? "center", renderHTML: (a) => ({ "data-align": a.align }) },
      caption: { default: "", parseHTML: (el) => el.getAttribute("data-caption") ?? "", renderHTML: (a) => (a.caption ? { "data-caption": a.caption } : {}) },
    };
  },
}).configure({ inline: false, allowBase64: false });

/** @person or a #record from elsewhere in the workspace. */
export const DocMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: "person", parseHTML: (el) => el.getAttribute("data-kind") ?? "person", renderHTML: (a) => ({ "data-kind": a.kind }) },
      href: { default: null, parseHTML: (el) => el.getAttribute("data-href"), renderHTML: (a) => (a.href ? { "data-href": a.href } : {}) },
    };
  },
}).configure({
  HTMLAttributes: { class: "doc-mention" },
  renderText: ({ node }) => `${node.attrs.kind === "record" ? "" : "@"}${node.attrs.label ?? node.attrs.id}`,
  renderHTML: ({ options, node }) => ["span", mergeAttributes(options.HTMLAttributes, { "data-type": "mention", "data-kind": node.attrs.kind, "data-id": node.attrs.id }), `${node.attrs.kind === "record" ? "" : "@"}${node.attrs.label ?? node.attrs.id}`],
});

/** Everything a written document can contain. `collab` leaves out local undo (the shared document has its own). */
export function docExtensions(o: { collab?: boolean } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: o.collab ? false : undefined,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      dropcursor: { color: "#7c5cdb", width: 2 },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    DocImage,
    TableKit.configure({ table: { resizable: true, cellMinWidth: 60 } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Details.configure({ persist: true, HTMLAttributes: { class: "doc-details" } }),
    DetailsSummary,
    DetailsContent,
    Callout,
    PageBreak,
    TocBlock,
    CommentMark,
    Indent,
    DocMention,
  ];
}
