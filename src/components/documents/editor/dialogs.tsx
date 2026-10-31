"use client";

// The editor's dialogs: page setup, find & replace, word count, fill in a
// template's {{fields}}, and adding a link.
import type { Editor } from "@tiptap/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, CaseSensitive, Replace, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/overlays";
import { Button, Field, Input, Select, Switch } from "@/components/ui/primitives";
import { FIELD_RE, FONTS, LINE_HEIGHTS, PAPER, readingMinutes, type PageSetup } from "@/lib/documents/write";
import { findKey, replaceHits, setFind } from "./kit";

export function PageSetupDialog({ page, onSave, onClose }: { page: PageSetup; onSave: (p: PageSetup) => void; onClose: () => void }) {
  const [p, setP] = useState(page);
  const set = <K extends keyof PageSetup>(k: K, v: PageSetup[K]) => setP((x) => ({ ...x, [k]: v }));
  const margin = (k: keyof PageSetup["margins"]) => (
    <Field label={k[0]!.toUpperCase() + k.slice(1)}>
      {(f) => <Input {...f} type="number" min={5} max={60} step={0.5} value={Math.round(p.margins[k] * 10) / 10} onChange={(e) => setP((x) => ({ ...x, margins: { ...x.margins, [k]: Math.max(5, Math.min(60, Number(e.target.value) || 5)) } }))} />}
    </Field>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Page setup"
      description="How the document is laid out on screen, when printed and in PDF and Word downloads."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => (onSave(p), onClose())}>
            Apply
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-3 rounded-[14px] border border-border p-3">
          <div>
            <p className="text-[13px] font-medium">Pageless</p>
            <p className="text-[12px] text-muted">One continuous page that fits your screen. Downloads still use the paper size.</p>
          </div>
          <Switch checked={p.pageless} onChange={(v) => set("pageless", v)} label="Pageless" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paper size">
            {(f) => (
              <Select {...f} value={p.paper} onChange={(e) => set("paper", e.target.value as PageSetup["paper"])}>
                {Object.entries(PAPER).map(([k, [w, h]]) => (
                  <option key={k} value={k}>
                    {k} ({w} × {h} mm)
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Orientation">
            {(f) => (
              <div {...f} role="radiogroup" className="grid grid-cols-2 gap-1 rounded-[12px] bg-fg/[0.05] p-1">
                {[false, true].map((l) => (
                  <button key={String(l)} type="button" role="radio" aria-checked={p.landscape === l} onClick={() => set("landscape", l)} className={clsx("flex h-9 items-center justify-center gap-2 rounded-[9px] text-[12.5px] font-medium", p.landscape === l ? "bg-[var(--surface-solid)] shadow-sm" : "text-muted")}>
                    <span className={clsx("rounded-[2px] border-[1.5px] border-current", l ? "h-3 w-4" : "h-4 w-3")} />
                    {l ? "Landscape" : "Portrait"}
                  </button>
                ))}
              </div>
            )}
          </Field>
        </div>
        <div>
          <p className="mb-2 text-[12.5px] font-medium">Margins (mm)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {margin("top")}
            {margin("bottom")}
            {margin("left")}
            {margin("right")}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(
              [
                ["Normal", 25.4],
                ["Narrow", 12.7],
                ["Wide", 38.1],
              ] as const
            ).map(([label, mm]) => (
              <button key={label} type="button" onClick={() => setP((x) => ({ ...x, margins: { top: mm, right: mm, bottom: mm, left: mm } }))} className="rounded-full border border-border px-2.5 py-1 text-[12px] hover:bg-fg/[0.04]">
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Font">
            {(f) => (
              <Select {...f} value={p.font} onChange={(e) => set("font", e.target.value)}>
                {FONTS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Size (pt)">{(f) => <Input {...f} type="number" min={8} max={24} value={p.fontSize} onChange={(e) => set("fontSize", Math.max(8, Math.min(24, Number(e.target.value) || 11)))} />}</Field>
          <Field label="Line spacing">
            {(f) => (
              <Select {...f} value={p.lineHeight} onChange={(e) => set("lineHeight", e.target.value as PageSetup["lineHeight"])}>
                {LINE_HEIGHTS.map((h) => (
                  <option key={h} value={h}>
                    {h === "1" ? "Single" : h === "2" ? "Double" : h}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Header" hint="On every page of prints and downloads">
            {(f) => <Input {...f} value={p.header} maxLength={200} onChange={(e) => set("header", e.target.value)} placeholder="e.g. Confidential" />}
          </Field>
          <Field label="Footer">{(f) => <Input {...f} value={p.footer} maxLength={200} onChange={(e) => set("footer", e.target.value)} placeholder="e.g. Your company name" />}</Field>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px]">Page numbers in prints and downloads</p>
          <Switch checked={p.pageNumbers} onChange={(v) => set("pageNumbers", v)} label="Page numbers" />
        </div>
      </div>
    </Dialog>
  );
}

/** Find (and replace) in the document, as a floating bar. */
export function FindBar({ editor, replace: showReplace, onClose }: { editor: Editor; replace: boolean; onClose: () => void }) {
  const [q, setQ] = useState(() => {
    const { from, to } = editor.state.selection;
    return to > from && to - from < 80 ? editor.state.doc.textBetween(from, to) : "";
  });
  const [r, setR] = useState("");
  const [cs, setCs] = useState(false);
  const [withReplace, setWithReplace] = useState(showReplace);
  const [state, setState] = useState({ index: 0, count: 0 });
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);
  useEffect(() => {
    const s = setFind(editor, { query: q, caseSensitive: cs, index: 0 });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the editor plugin's count after the query changes
    setState({ index: s?.index ?? 0, count: s?.hits.length ?? 0 });
  }, [editor, q, cs]);
  useEffect(() => {
    const on = () => {
      const s = findKey.getState(editor.state);
      setState({ index: s?.index ?? 0, count: s?.hits.length ?? 0 });
    };
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
      setFind(editor, { query: "" });
    };
  }, [editor]);
  const step = (d: number) => {
    if (!state.count) return;
    setFind(editor, { index: (state.index + d + state.count) % state.count });
  };
  return (
    <div className="doc-pop fixed top-[calc(var(--bar)+108px)] right-4 z-40 w-[min(360px,calc(100vw-24px))] rounded-[16px] border border-border bg-[var(--surface-solid)] p-2 shadow-[0_18px_50px_-14px_rgb(0_0_0/0.35)]" role="search" aria-label="Find in document">
      <div className="flex items-center gap-1">
        <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? (e.preventDefault(), step(e.shiftKey ? -1 : 1)) : e.key === "Escape" ? onClose() : null)} placeholder="Find in document" aria-label="Find" className="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-[#7c5cdb]/60" />
        <span className="w-12 text-center text-[11.5px] text-muted tabular-nums">{q ? `${state.count ? state.index + 1 : 0}/${state.count}` : ""}</span>
        <button type="button" className="doc-tool" aria-label="Previous" onClick={() => step(-1)}>
          <ArrowUp />
        </button>
        <button type="button" className="doc-tool" aria-label="Next" onClick={() => step(1)}>
          <ArrowDown />
        </button>
        <button type="button" className="doc-tool" data-on={cs ? "true" : undefined} aria-pressed={cs} aria-label="Match case" onClick={() => setCs((x) => !x)}>
          <CaseSensitive />
        </button>
        <button type="button" className="doc-tool" data-on={withReplace ? "true" : undefined} aria-pressed={withReplace} aria-label="Replace" onClick={() => setWithReplace((x) => !x)}>
          <Replace />
        </button>
        <button type="button" className="doc-tool" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </div>
      {withReplace && editor.isEditable && (
        <div className="mt-1.5 flex items-center gap-1">
          <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Replace with" aria-label="Replace with" className="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-[#7c5cdb]/60" />
          <Button size="sm" onClick={() => replaceHits(editor, r, false)} disabled={!state.count}>
            Replace
          </Button>
          <Button size="sm" variant="primary" onClick={() => replaceHits(editor, r, true)} disabled={!state.count}>
            All
          </Button>
        </div>
      )}
    </div>
  );
}

export function WordCountDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const storage = editor.storage as unknown as { characterCount?: { words: () => number; characters: () => number } };
  const words = storage.characterCount?.words() ?? 0;
  const chars = storage.characterCount?.characters() ?? 0;
  const { from, to } = editor.state.selection;
  const sel = to > from ? editor.state.doc.textBetween(from, to, " ") : "";
  const selWords = sel ? (sel.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu) ?? []).length : 0;
  let paragraphs = 0;
  editor.state.doc.descendants((n) => {
    if ((n.type.name === "paragraph" || n.type.name === "heading") && n.textContent.trim()) paragraphs++;
  });
  const pages = Math.max(1, Math.ceil(words / 500));
  const rows: [string, string][] = [
    ["Words", words.toLocaleString("en-IN")],
    ["Characters", chars.toLocaleString("en-IN")],
    ["Characters without spaces", editor.state.doc.textContent.replace(/\s/g, "").length.toLocaleString("en-IN")],
    ["Paragraphs", paragraphs.toLocaleString("en-IN")],
    ["About", `${pages} page${pages === 1 ? "" : "s"} · ${readingMinutes(words)} min read`],
  ];
  return (
    <Dialog open onClose={onClose} title="Word count" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-2 text-[13px]">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
        {selWords > 0 && (
          <div className="flex justify-between py-2 text-[13px]">
            <dt className="text-muted">In your selection</dt>
            <dd className="font-medium tabular-nums">{selWords.toLocaleString("en-IN")} words</dd>
          </div>
        )}
      </dl>
    </Dialog>
  );
}

/** {{Field}} placeholders in the document, each filled in everywhere at once. */
export function fieldsOf(editor: Editor) {
  return [...new Set([...editor.state.doc.textContent.matchAll(FIELD_RE)].map((m) => m[1]!.trim()))];
}

export function FillFieldsDialog({ editor, onClose, suggestions = {} }: { editor: Editor; onClose: () => void; suggestions?: Record<string, string> }) {
  const fields = fieldsOf(editor);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f, suggestions[f] ?? ""])));
  const apply = () => {
    const tr = editor.state.tr;
    const hits: { from: number; to: number; value: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      for (const m of node.text.matchAll(FIELD_RE)) {
        const v = values[m[1]!.trim()];
        if (v) hits.push({ from: pos + m.index!, to: pos + m.index! + m[0].length, value: v });
      }
    });
    for (const h of hits.reverse()) tr.insertText(h.value, h.from, h.to);
    editor.view.dispatch(tr);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Fill in the details"
      description={fields.length ? "Each one is filled in everywhere it appears. Leave any blank to keep it for later." : "This document has no {{fields}} left to fill in."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!Object.values(values).some(Boolean)}>
            Fill in
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f} label={f}>
            {(p) => <Input {...p} value={values[f] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} />}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

export function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = (editor.getAttributes("link").href as string | undefined) ?? "";
  const { from, to } = editor.state.selection;
  const selected = editor.state.doc.textBetween(from, to, " ");
  const [href, setHref] = useState(current);
  const [text, setText] = useState(selected);
  const apply = () => {
    const url = href.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return onClose();
    }
    const safe = /^(https?:|mailto:|tel:|\/|#)/i.test(url) ? url : `https://${url}`;
    if (!selected && text.trim()) editor.chain().focus().insertContent({ type: "text", text: text.trim(), marks: [{ type: "link", attrs: { href: safe } }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={current ? "Edit link" : "Add a link"}
      size="sm"
      footer={
        <>
          {current && (
            <Button variant="danger" onClick={() => (editor.chain().focus().extendMarkRange("link").unsetLink().run(), onClose())}>
              Remove
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), apply())} className="grid gap-3">
        {!selected && !current && <Field label="Text">{(f) => <Input {...f} value={text} onChange={(e) => setText(e.target.value)} placeholder="What people see" />}</Field>}
        <Field label="Link">{(f) => <Input {...f} autoFocus value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://… or a page in Cloudesk" />}</Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
