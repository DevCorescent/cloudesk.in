"use client";

// Two-way binding between a Monaco model and a Y.Text, with remote cursors.
// Written against the editor instance (Monaco loads from a CDN at runtime),
// so it doesn't bundle a second copy of monaco-editor.
import type { OnMount } from "@monaco-editor/react";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

type Editor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];
type Cursor = { anchor: unknown; head: unknown };

const cssString = (s: string) => `"${s.replace(/[\\"]/g, "\\$&").replace(/[\n\r]/g, " ").slice(0, 40)}"`;

export function bindMonaco(editor: Editor, monaco: Monaco, text: Y.Text, awareness: Awareness) {
  const maybe = editor.getModel();
  if (!maybe) return () => {};
  const model = maybe;
  const doc = text.doc!;
  const origin = {};
  let remote = false;

  if (model.getValue() !== text.toString()) {
    remote = true;
    model.setValue(text.toString());
    remote = false;
  }

  // Remote → Monaco: apply each delta op in order so indices stay correct.
  const onText = (e: Y.YTextEvent, tr: Y.Transaction) => {
    if (tr.origin === origin) return;
    remote = true;
    try {
      let index = 0;
      for (const op of e.delta) {
        if (op.retain !== undefined) index += op.retain;
        else if (typeof op.insert === "string") {
          const p = model.getPositionAt(index);
          model.applyEdits([{ range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: op.insert }]);
          index += op.insert.length;
        } else if (op.delete !== undefined) {
          const a = model.getPositionAt(index);
          const b = model.getPositionAt(index + op.delete);
          model.applyEdits([{ range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: "" }]);
        }
      }
    } finally {
      remote = false;
    }
    renderCursors();
  };
  text.observe(onText);

  // Monaco → Yjs: change offsets refer to the model before the edit; apply last-first.
  const sub = model.onDidChangeContent((e) => {
    if (remote) return;
    doc.transact(() => {
      for (const c of [...e.changes].sort((x, y) => y.rangeOffset - x.rangeOffset)) {
        if (c.rangeLength) text.delete(c.rangeOffset, c.rangeLength);
        if (c.text) text.insert(c.rangeOffset, c.text);
      }
    }, origin);
  });

  // Local cursor → awareness, as positions relative to the shared text.
  const publishCursor = () => {
    const sel = editor.getSelection();
    if (!sel || !editor.hasTextFocus()) return;
    const at = (line: number, col: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, model.getOffsetAt({ lineNumber: line, column: col })));
    awareness.setLocalStateField("cursor", { anchor: at(sel.selectionStartLineNumber, sel.selectionStartColumn), head: at(sel.positionLineNumber, sel.positionColumn) } satisfies Cursor);
  };
  const selSub = editor.onDidChangeCursorSelection(publishCursor);
  const focusSub = editor.onDidFocusEditorText(publishCursor);

  // Remote cursors → decorations, with a name label per person.
  const style = document.createElement("style");
  document.head.appendChild(style);
  let decorations: string[] = [];
  function renderCursors() {
    const rules: string[] = [];
    const next: Parameters<Editor["deltaDecorations"]>[1] = [];
    awareness.getStates().forEach((st, id) => {
      if (id === doc.clientID) return;
      const s = st as { user?: { name: string; color: string }; cursor?: Cursor };
      if (!s.user || !s.cursor) return;
      const abs = (j: unknown) => Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(j), doc);
      const a = abs(s.cursor.anchor);
      const h = abs(s.cursor.head);
      if (!a || !h || a.type !== text || h.type !== text) return;
      const color = /^#[0-9a-f]{6}$/i.test(s.user.color) ? s.user.color : "#0a84ff";
      rules.push(`.cc-rc-${id}{border-left:2px solid ${color};margin-left:-1px}.cc-rc-${id}::after{content:${cssString(s.user.name)};position:absolute;transform:translateY(-100%);background:${color};color:#fff;font:600 10px/1.6 ui-sans-serif,system-ui;padding:0 4px;border-radius:3px 3px 3px 0;white-space:nowrap;pointer-events:none;z-index:5}.cc-rs-${id}{background:${color}33}.cc-rc-${id}.cc-rc-below::after{transform:translateY(1.4em);border-radius:0 3px 3px 3px}`);
      const hp = model.getPositionAt(h.index);
      const ap = model.getPositionAt(a.index);
      if (a.index !== h.index) {
        const [s1, s2] = a.index < h.index ? [ap, hp] : [hp, ap];
        next.push({ range: new monaco.Range(s1.lineNumber, s1.column, s2.lineNumber, s2.column), options: { className: `cc-rs-${id}` } });
      }
      next.push({ range: new monaco.Range(hp.lineNumber, hp.column, hp.lineNumber, hp.column), options: { beforeContentClassName: `cc-rc-${id}${hp.lineNumber === 1 ? " cc-rc-below" : ""}`, stickiness: 1 } });
    });
    style.textContent = rules.join("");
    decorations = editor.deltaDecorations(decorations, next);
  }
  awareness.on("change", renderCursors);
  renderCursors();

  return () => {
    text.unobserve(onText);
    sub.dispose();
    selSub.dispose();
    focusSub.dispose();
    awareness.off("change", renderCursors);
    awareness.setLocalStateField("cursor", null);
    editor.deltaDecorations(decorations, []);
    style.remove();
  };
}
