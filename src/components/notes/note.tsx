"use client";

// One open note: its title and details, the block editor, and everything you
// can do with it — share (workspace, people, a public link, a chat, an
// email), AI (summary, action items into Projects, continue, title and tags,
// translate, ask), versions, a reminder, lock, pin, templates, exports and a
// focus mode. Saves itself as you type; if someone else saved in between, it
// says so instead of overwriting them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, BellRing, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileDown, FileText, Folder as FolderIcon, Globe, History, LayoutTemplate, ListChecks, Loader2, Lock, Maximize2, MessagesSquare, Minimize2, MoreHorizontal, Pin, Printer, Search, Share2, Shapes, Sparkles, Table2, Trash2, Undo2, Unlock, Users, Wand2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShareToChat } from "@/components/chat/share";
import { markdownToDocument, useDocumentsOn } from "@/components/documents/picker";
import { EmailButton } from "@/components/mail/compose-provider";
import { useSession } from "@/components/shell/session-context";
import { Dialog, Menu, Segmented, useToast } from "@/components/ui/overlays";
import { Badge, Button, ErrorState, Field, Input, Notice, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { block, fromMarkdown, outline, toHtml, toMarkdown, toText, wordCount, type Block, type Doc } from "@/lib/notes/blocks";
import { visibleTo } from "@/lib/workspace/modules";
import { shiftDay, useNotesApi, when, type Folder, type NoteFull, type Visibility } from "./api";
import { BlockEditor, ElementsPanel, makeBlock } from "./editor";
import { DocView } from "./render";

const EMOJI = ["📝", "💡", "✅", "📌", "📅", "🎯", "🤝", "📞", "💰", "📈", "🧾", "🧭", "🛒", "🏷️", "📦", "🧪", "🛠️", "🚀", "❤️", "⭐", "🔥", "📚", "🗂️", "🧮"];
const download = (name: string, text: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const fileName = (t: string) => (t || "note").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 80) || "note";

type Save = "idle" | "saving" | "saved" | "error" | "conflict";

export function NotePane({ id, folders, onBack, onOpen, onGone }: { id: string; folders: Folder[]; onBack: () => void; onOpen: (id: string) => void; onGone: () => void }) {
  const n = useNotesApi();
  const qc = useQueryClient();
  const toast = useToast();
  const docsOn = useDocumentsOn();
  const { org } = useSession();
  const router = useRouter();
  const q = useQuery({ queryKey: n.key("note", id), queryFn: () => n.call<{ note: NoteFull }>(`/${id}`).then((r) => r.note), refetchOnWindowFocus: false });
  const note = q.data;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [title, setTitle] = useState("");
  const [save, setSave] = useState<Save>("idle");
  const [panel, setPanel] = useState<"elements" | "outline" | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [dialog, setDialog] = useState<null | "share" | "versions" | "remind" | "record" | "actions" | "ask" | "translate">(null);
  const [picked, setPicked] = useState<((r: { title: string; sub: string; url: string; module: string }) => void) | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const version = useRef(0);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What's being typed, for saving (so a save never sends an older copy).
  const latest = useRef<{ doc: Doc | null; title: string }>({ doc: null, title: "" });
  const saving = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  // The server's copy is adopted when the note opens, or when asked to reload — never on top of what you're typing.
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (!note || adopted.current === note.id) return;
    const d = note.content.blocks.length ? note.content : { blocks: [block("p")] };
    setDoc(d);
    setTitle(note.title);
    latest.current = { doc: d, title: note.title };
    version.current = note.version;
    adopted.current = note.id;
  }, [note]);

  const flush = useCallback(async (force = false): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    // One save at a time: changes made meanwhile go in the next one.
    if (saving.current) {
      again.current = true;
      return saving.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        if (!dirty.current || !latest.current.doc) break;
        dirty.current = false;
        setSave("saving");
        try {
          const r = await n.call<{ note: NoteFull }>(`/${id}`, { method: "PATCH", body: { title: latest.current.title, content: latest.current.doc, ...(force ? {} : { baseVersion: version.current }) } });
          version.current = r.note.version;
          // Keep the server's details (backlinks, words…) without replacing what's on screen.
          qc.setQueryData(n.key("note", id), r.note);
          setSave(dirty.current ? "idle" : "saved");
          void qc.invalidateQueries({ queryKey: n.key("list") });
        } catch (e) {
          dirty.current = true;
          setSave(e instanceof ApiClientError && e.status === 409 ? "conflict" : "error");
          break;
        }
      } while (again.current || dirty.current);
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [id, n, qc]);
  const schedule = (next?: { doc?: Doc; title?: string }) => {
    if (next?.doc) latest.current.doc = next.doc;
    if (next?.title !== undefined) latest.current.title = next.title;
    dirty.current = true;
    setSave("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  };
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  // Leaving the note saves it.
  useEffect(() => () => { if (dirty.current) void flush(); }, [flush]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void flush(); }
      if (e.key === "Escape" && focusMode) setFocusMode(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [flush, focusMode]);

  const meta = useMutation({
    mutationFn: (body: Record<string, unknown>) => n.call<{ note: NoteFull }>(`/${id}`, { method: "PATCH", body }),
    onSuccess: (r) => { qc.setQueryData(n.key("note", id), r.note); version.current = r.note.version; void n.refresh(); },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const act = async (path: string, method: string, done?: string) => {
    try {
      const r = await n.call<{ note?: NoteFull }>(`/${id}${path}`, { method });
      if (r.note) qc.setQueryData(n.key("note", id), r.note);
      void n.refresh();
      if (done) toast({ tone: "success", title: done });
      return r;
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return null;
    }
  };
  const ai = async <T,>(body: Record<string, unknown>, label: string): Promise<T | null> => {
    await flush();
    setAiBusy(label);
    try {
      return await n.call<T>("/ai", { method: "POST", body });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
      return null;
    } finally {
      setAiBusy(null);
    }
  };
  const edit = (d: Doc) => { setDoc(d); schedule({ doc: d }); };
  const append = (bs: Block[], atTop = false) => doc && edit({ blocks: atTop ? [...bs, ...doc.blocks] : [...doc.blocks.filter((b, i) => !(i === doc.blocks.length - 1 && b.type === "p" && !b.text)), ...bs] });
  const rewrite = useCallback(async (mode: string, text: string) => {
    const r = await n.call<{ text: string }>("/ai", { method: "POST", body: { action: "rewrite", mode, text } }).catch((e) => { toast({ tone: "error", title: errorMessage(e) }); return null; });
    return r?.text ?? text;
  }, [n, toast]);
  const openByTitle = async (t: string) => {
    const r = await n.call<{ notes: { id: string; title: string }[] }>(`?q=${encodeURIComponent(t)}&limit=20`);
    const hit = r.notes.find((x) => x.title.toLowerCase() === t.toLowerCase());
    if (hit) return onOpen(hit.id);
    if (window.confirm(`There's no note called “${t}” yet. Make it now?`)) {
      const made = await n.call<{ note: NoteFull }>("", { method: "POST", body: { title: t } });
      void n.refresh();
      onOpen(made.note.id);
    }
  };

  if (q.isError) return <div className="flex-1 p-6"><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  if (!note || !doc) return <div className="grid flex-1 content-start gap-3 p-8"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64" /></div>;

  const canEdit = note.canEdit;
  const owner = note.access === "owner";
  const words = wordCount(`${title} ${toText(doc)}`);
  const daily = note.kind === "daily" && note.day;
  const folder = folders.find((f) => f.id === note.folderId);
  const toc = outline(doc);

  const body = (
    <div className={clsx("flex min-w-0 flex-1 flex-col", focusMode && "fixed inset-0 z-50 bg-bg")}>
      {/* Toolbar */}
      <header className="flex items-center gap-1 border-b border-border px-2 py-2 sm:px-4">
        <Button size="sm" variant="ghost" className="md:hidden" aria-label="Back to the list" icon={<ArrowLeft className="size-4" />} onClick={() => { void flush(); onBack(); }} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-muted">
          {daily ? (
            <>
              <Button size="sm" variant="ghost" aria-label="The day before" icon={<ChevronLeft className="size-4" />} onClick={() => void n.call<{ note: NoteFull }>(`/daily/${shiftDay(note.day!, -1)}`).then((r) => onOpen(r.note.id))} />
              <span className="inline-flex items-center gap-1 font-medium text-fg"><CalendarDays className="size-3.5" /> Daily note</span>
              <Button size="sm" variant="ghost" aria-label="The day after" icon={<ChevronRight className="size-4" />} onClick={() => void n.call<{ note: NoteFull }>(`/daily/${shiftDay(note.day!, 1)}`).then((r) => onOpen(r.note.id))} />
            </>
          ) : (
            <span className="hidden min-w-0 items-center gap-1 truncate sm:inline-flex"><FolderIcon className="size-3.5 shrink-0" />{folder?.name ?? (note.mine ? "Not in a folder" : `Shared by ${note.owner?.name ?? "someone"}`)}</span>
          )}
          <SaveState s={save} onRetry={() => void flush()} />
        </div>
        {canEdit && <Button size="sm" variant="ghost" aria-pressed={panel === "elements"} title="Elements — drag into the note" icon={<Shapes className="size-4" />} onClick={() => setPanel((p) => (p === "elements" ? null : "elements"))}><span className="hidden lg:inline">Elements</span></Button>}
        {canEdit && (
          <Menu
            label="AI"
            trigger={(p) => <Button {...p} size="sm" variant="ghost" icon={aiBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}><span className="hidden sm:inline">AI</span></Button>}
            items={[
              { label: "Summarise at the top", icon: <FileText />, onSelect: () => void ai<{ blocks: Block[] }>({ action: "summarize", noteId: id }, "summary").then((r) => r && append([block("h3", "Summary"), ...r.blocks, block("divider")], true)) },
              { label: "Find action items", icon: <ListChecks />, onSelect: () => setDialog("actions") },
              { label: "Continue writing", icon: <Wand2 />, onSelect: () => void ai<{ blocks: Block[] }>({ action: "continue", noteId: id }, "continue").then((r) => r && append(r.blocks)) },
              { label: "Suggest a title, emoji and tags", icon: <Sparkles />, onSelect: () => void ai<{ title: string; emoji: string; tags: string[] }>({ action: "title", noteId: id }, "title").then((r) => { if (!r) return; setTitle(r.title); schedule({ title: r.title }); void flush().then(() => meta.mutate({ icon: r.emoji, tags: [...new Set([...note.tags, ...r.tags])] })); }) },
              { label: "Turn the note into a table", icon: <Table2 />, onSelect: () => void ai<{ blocks: Block[] }>({ action: "table", text: toText(doc).slice(0, 20000) }, "table").then((r) => r && append(r.blocks)) },
              { label: "Translate into a new note", icon: <Globe />, onSelect: () => setDialog("translate") },
              { label: "Ask this note", icon: <Search />, onSelect: () => setDialog("ask") },
            ]}
          />
        )}
        <Button size="sm" variant="ghost" title="Share" icon={<Share2 className="size-4" />} onClick={() => setDialog("share")}><span className="hidden sm:inline">Share</span></Button>
        <Menu
          label="More"
          trigger={(p) => <Button {...p} size="sm" variant="ghost" aria-label="More" icon={<MoreHorizontal className="size-4" />} />}
          items={[
            ...(owner ? [
              { label: note.pinned ? "Unpin" : "Pin to the top", icon: <Pin />, onSelect: () => meta.mutate({ pinned: !note.pinned }) },
              { label: note.locked ? "Unlock" : "Lock (read-only)", icon: note.locked ? <Unlock /> : <Lock />, onSelect: () => { void flush(); meta.mutate({ locked: !note.locked }); } },
              { label: note.remindAt ? "Change the reminder" : "Remind me…", icon: <BellRing />, onSelect: () => setDialog("remind") },
            ] : []),
            { label: "Version history", icon: <History />, onSelect: () => setDialog("versions") },
            "separator" as const,
            { label: "Duplicate", icon: <Copy />, onSelect: () => void act("/duplicate", "POST", "Duplicated").then((r) => r?.note && onOpen(r.note.id)) },
            ...(docsOn
              ? [
                  {
                    label: "Turn into a document",
                    icon: <FileText />,
                    onSelect: () =>
                      void markdownToDocument(org.id, title || "Untitled", toMarkdown(doc, title))
                        .then((docId) => {
                          toast({ tone: "success", title: "Document made", description: "In My documents — the note stays as it is." });
                          router.push(`/documents/d/${docId}`);
                        })
                        .catch((e) => toast({ tone: "error", title: "Couldn't make the document", description: errorMessage(e) })),
                  },
                ]
              : []),
            ...(owner ? [{ label: note.kind === "template" ? "Stop using as a template" : "Save as a template", icon: <LayoutTemplate />, onSelect: () => meta.mutate({ kind: note.kind === "template" ? "note" : "template" }) }] : []),
            "separator" as const,
            { label: "Download Markdown", icon: <FileDown />, onSelect: () => download(`${fileName(title)}.md`, toMarkdown(doc, title), "text/markdown") },
            { label: "Download text", icon: <Download />, onSelect: () => download(`${fileName(title)}.txt`, `${title}\n\n${toText(doc)}`, "text/plain") },
            { label: "Download HTML", icon: <Download />, onSelect: () => download(`${fileName(title)}.html`, toHtml(doc, title), "text/html") },
            { label: "Print or save as PDF", icon: <Printer />, onSelect: () => { const w = window.open("", "_blank", "noopener=no"); if (!w) return; w.document.write(toHtml(doc, title, `${note.owner?.name ?? ""} · ${new Date(note.updatedAt).toLocaleString("en-IN")}`)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); } },
            { label: "Copy as Markdown", icon: <Copy />, onSelect: () => void navigator.clipboard?.writeText(toMarkdown(doc, title)).then(() => toast({ tone: "success", title: "Copied" })) },
            { label: focusMode ? "Leave focus mode" : "Focus mode", icon: focusMode ? <Minimize2 /> : <Maximize2 />, onSelect: () => setFocusMode((f) => !f) },
            ...(owner ? ["separator" as const, { label: "Move to the trash", icon: <Trash2 />, danger: true, onSelect: () => void flush().then(() => act("", "DELETE", "Moved to the trash — restore it from Trash within 30 days")).then(onGone) }] : []),
          ]}
        />
      </header>

      {note.deletedAt && <div className="border-b border-border bg-warning-soft px-4 py-2 text-[13px]">This note is in the trash. <button type="button" className="font-semibold underline" onClick={() => void act("/restore", "POST", "Restored")}>Restore it</button> · <button type="button" className="font-semibold text-danger underline" onClick={() => { if (window.confirm("Delete this note for good? This can't be undone.")) void act("?forever=1", "DELETE", "Deleted for good").then(onGone); }}>Delete for good</button></div>}
      {save === "conflict" && <div className="flex flex-wrap items-center gap-2 border-b border-border bg-warning-soft px-4 py-2 text-[13px]">Someone else saved this note while you were editing. <Button size="sm" onClick={() => { dirty.current = false; setSave("idle"); adopted.current = null; void q.refetch(); }}>Load their version</Button><Button size="sm" variant="ghost" onClick={() => void flush(true)}>Keep mine</Button></div>}
      {note.locked && <div className="border-b border-border bg-surface-2 px-4 py-2 text-[13px] text-muted">🔒 Locked — read-only.{owner && <> <button type="button" className="font-medium text-fg underline" onClick={() => meta.mutate({ locked: false })}>Unlock</button></>}</div>}
      {!canEdit && !note.locked && <div className="border-b border-border bg-surface-2 px-4 py-2 text-[13px] text-muted">You can read this note. {note.owner?.name} can let you edit it.</div>}

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <article className={clsx("mx-auto w-full px-5 pt-8 pb-32 sm:px-10", focusMode ? "max-w-[760px]" : "max-w-[820px]")}>
            {/* Icon and title */}
            <div className="flex items-start gap-3">
              {canEdit ? (
                <Menu label="Icon" align="start" trigger={(p) => <button {...p} type="button" aria-label="Change the icon" className="grid size-11 shrink-0 place-items-center rounded-[12px] text-[26px] hover:bg-surface-2">{note.icon || <FileText className="size-6 text-subtle" />}</button>} items={[...EMOJI.map((e) => ({ label: e, onSelect: () => meta.mutate({ icon: e }) })), { label: "No icon", onSelect: () => meta.mutate({ icon: "" }) }]} />
              ) : note.icon ? <span className="text-[30px] leading-none">{note.icon}</span> : null}
              <textarea
                aria-label="Title"
                value={title}
                readOnly={!canEdit}
                rows={1}
                onChange={(e) => { const t = e.target.value.replace(/\n/g, ""); setTitle(t); schedule({ title: t }); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                placeholder="Untitled"
                className="min-w-0 flex-1 resize-none bg-transparent text-[clamp(1.7rem,3.6vw,2.4rem)] leading-tight font-semibold tracking-tight outline-none placeholder:text-subtle/50 [field-sizing:content]"
              />
            </div>
            <Details note={note} words={words} canEdit={canEdit} owner={owner} folders={folders} onMeta={(b) => meta.mutate(b)} />

            <div className="mt-6 pl-14 sm:pl-16">
              <BlockEditor doc={doc} onChange={edit} readOnly={!canEdit} onNoteLink={(t) => void openByTitle(t)} onPickRecord={(done) => { setPicked(() => done); setDialog("record"); }} rewrite={rewrite} />
            </div>

            {(note.backlinks.length > 0 || note.links.length > 0) && (
              <section className="mt-12 grid gap-3 border-t border-border pt-5 text-[13px] sm:grid-cols-2">
                {note.backlinks.length > 0 && <LinkList title={`Linked from ${note.backlinks.length} note${note.backlinks.length === 1 ? "" : "s"}`} items={note.backlinks} onOpen={onOpen} />}
                {note.links.length > 0 && <LinkList title="Links to" items={note.links} onOpen={onOpen} />}
              </section>
            )}
          </article>
        </div>

        {/* Side panels: elements (drag into the note) and the outline. */}
        {panel && (
          <aside className="fixed inset-x-0 bottom-0 z-[45] max-h-[60dvh] pb-[max(16px,env(safe-area-inset-bottom))] overflow-y-auto rounded-t-[20px] border-t border-border bg-bg p-4 shadow-2xl lg:absolute lg:inset-x-auto lg:top-3 lg:right-3 lg:bottom-auto lg:max-h-[calc(100%-24px)] lg:w-[264px] lg:rounded-[18px] lg:border lg:shadow-[0_24px_60px_-20px_rgb(0_0_0/0.35)] min-[1700px]:static min-[1700px]:max-h-none min-[1700px]:rounded-none min-[1700px]:border-0 min-[1700px]:border-l min-[1700px]:shadow-none">
            <div className="mb-3 flex items-center justify-between">
              <Segmented label="Panel" value={panel} onChange={setPanel} options={[{ value: "elements", label: "Elements" }, { value: "outline", label: "Outline" }]} />
              <Button size="sm" variant="ghost" aria-label="Close" icon={<X className="size-4" />} onClick={() => setPanel(null)} />
            </div>
            {panel === "elements" ? (
              <ElementsPanel onAdd={(t) => append([makeBlock(t)])} />
            ) : toc.length ? (
              <ol className="grid gap-0.5 text-[13px]">{toc.map((h) => <li key={h.id} style={{ paddingLeft: (h.level - 1) * 12 }}><a href={`#b-${h.id}`} onClick={(e) => { e.preventDefault(); document.querySelector(`[data-block="${h.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="block truncate rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg">{h.text || "Untitled heading"}</a></li>)}</ol>
            ) : (
              <p className="text-[12.5px] text-subtle">Headings you add appear here.</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );

  return (
    <>
      {body}
      {dialog === "share" && <ShareDialog note={note} doc={doc} title={title} onClose={() => setDialog(null)} onMeta={(b) => meta.mutate(b)} onAct={act} />}
      {dialog === "versions" && <VersionsDialog id={id} canEdit={canEdit} onClose={() => setDialog(null)} onRestored={(nn) => { dirty.current = false; qc.setQueryData(n.key("note", id), nn); setDoc(nn.content); setTitle(nn.title); latest.current = { doc: nn.content, title: nn.title }; version.current = nn.version; adopted.current = nn.id; setDialog(null); }} />}
      {dialog === "remind" && <RemindDialog at={note.remindAt} onClose={() => setDialog(null)} onSave={(v) => { meta.mutate({ remindAt: v }); setDialog(null); }} />}
      {dialog === "record" && <RecordPicker onClose={() => setDialog(null)} onPick={(r) => { picked?.(r); setDialog(null); }} />}
      {dialog === "actions" && <ActionsDialog noteId={id} onClose={() => setDialog(null)} onInsert={(bs) => { append([block("h3", "Action items"), ...bs]); setDialog(null); }} beforeRun={flush} />}
      {dialog === "ask" && <AskThis noteId={id} onClose={() => setDialog(null)} beforeRun={flush} />}
      {dialog === "translate" && <TranslateDialog doc={doc} title={title} onClose={() => setDialog(null)} onDone={(nid) => { setDialog(null); void n.refresh(); onOpen(nid); }} />}
    </>
  );
}

function SaveState({ s, onRetry }: { s: Save; onRetry: () => void }) {
  if (s === "saving") return <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap"><Loader2 className="size-3 animate-spin" /> Saving</span>;
  if (s === "saved") return <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-success"><Check className="size-3" /> Saved</span>;
  if (s === "error") return <button type="button" onClick={onRetry} className="ml-auto whitespace-nowrap text-danger underline">Not saved — retry</button>;
  return null;
}

function LinkList({ title, items, onOpen }: { title: string; items: { id: string; title: string; icon: string }[]; onOpen: (id: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">{title}</p>
      <ul className="grid gap-1">{items.map((x) => <li key={x.id}><button type="button" onClick={() => onOpen(x.id)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-surface-2"><span>{x.icon || "📄"}</span><span className="truncate">{x.title || "Untitled"}</span></button></li>)}</ul>
    </div>
  );
}

/** Tags, folder, where it's attached, and the small print. */
function Details({ note, words, canEdit, owner, folders, onMeta }: { note: NoteFull; words: number; canEdit: boolean; owner: boolean; folders: Folder[]; onMeta: (b: Record<string, unknown>) => void }) {
  const [tag, setTag] = useState("");
  const addTag = () => {
    const t = tag.trim().toLowerCase().replace(/^#/, "").replace(/[^\p{L}\p{M}\p{N} _-]/gu, "").slice(0, 40);
    if (t && !note.tags.includes(t)) onMeta({ tags: [...note.tags, t] });
    setTag("");
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pl-14 text-[12.5px] text-muted">
      {owner && (
        <label className="inline-flex items-center gap-1">
          <FolderIcon className="size-3.5" />
          <select aria-label="Folder" value={note.folderId ?? ""} onChange={(e) => onMeta({ folderId: e.target.value || null })} className="max-w-[160px] bg-transparent outline-none hover:text-fg">
            <option value="">No folder</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}
      {note.tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 px-2 py-0.5">#{t}{canEdit && <button type="button" aria-label={`Remove ${t}`} onClick={() => onMeta({ tags: note.tags.filter((x) => x !== t) })} className="text-subtle hover:text-fg"><X className="size-3" /></button>}</span>
      ))}
      {canEdit && <input aria-label="Add a tag" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="+ tag" className="w-16 bg-transparent outline-none placeholder:text-subtle focus:w-28" />}
      {note.attached && <a href={note.attached.href} className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full bg-accent-soft px-2 py-0.5 text-accent"><ExternalLink className="size-3 shrink-0" />{note.attached.label}</a>}
      {note.visibility !== "private" && <Badge tone="accent">{note.visibility === "edit" ? "Workspace can edit" : "Workspace can read"}</Badge>}
      {note.shares.length > 0 && <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{note.shares.length}</span>}
      {note.publicToken && <Badge tone="success">Public link on</Badge>}
      {note.remindAt && <span className="inline-flex items-center gap-1 text-warning"><BellRing className="size-3.5" />{new Date(note.remindAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}
      <span className="ml-auto whitespace-nowrap">{words.toLocaleString("en-IN")} words · {Math.max(1, Math.round(words / 220))} min read · {when(note.updatedAt)}</span>
    </div>
  );
}

// ─── Dialogs ───────────────────────────────────────────────────────────────

function ShareDialog({ note, doc, title, onClose, onMeta, onAct }: { note: NoteFull; doc: Doc; title: string; onClose: () => void; onMeta: (b: Record<string, unknown>) => void; onAct: (path: string, method: string, done?: string) => Promise<unknown> }) {
  const n = useNotesApi();
  const toast = useToast();
  const { available: chatOn, share } = useShareToChat();
  const owner = note.access === "owner";
  const members = useQuery({ queryKey: n.key("members"), queryFn: () => n.call<{ members: { id: string; name: string; email: string }[] }>("/members"), enabled: owner });
  const [shares, setShares] = useState(note.shares.map((s) => ({ userId: s.userId, role: s.role })));
  const [who, setWho] = useState("");
  const [openUp, setOpenUp] = useState(note.visibility === "private");
  const saveShares = useMutation({ mutationFn: (v: typeof shares) => n.call(`/${note.id}/shares`, { method: "PUT", body: { shares: v } }), onSuccess: () => { void n.refresh(); toast({ tone: "success", title: "Sharing saved" }); }, onError: (e) => toast({ tone: "error", title: errorMessage(e) }) });
  const link = note.publicToken ? `${window.location.origin}/n/${note.publicToken}` : "";
  const appLink = `${window.location.origin}/notes/${note.id}`;
  const people = new Map((members.data?.members ?? []).map((m) => [m.id, m]));
  const text = toText(doc);
  return (
    <Dialog open onClose={onClose} size="lg" title="Share" description={owner ? "Choose who can open this note, publish it by link, or send it." : "Send this note to a chat or by email."}>
      <div className="grid gap-5 text-[13px]">
        {owner && (
          <section className="grid gap-2">
            <p className="font-semibold">In this workspace</p>
            <Segmented<Visibility> label="Who can open it" value={note.visibility} onChange={(v) => onMeta({ visibility: v })} options={[{ value: "private", label: "Only people I add" }, { value: "view", label: "Everyone can read" }, { value: "edit", label: "Everyone can edit" }]} />
            <div className="grid gap-1.5">
              {shares.map((s) => (
                <div key={s.userId} className="flex items-center gap-2 rounded-[10px] bg-surface-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{people.get(s.userId)?.name ?? note.shares.find((x) => x.userId === s.userId)?.name ?? "Someone"} <span className="text-muted">{people.get(s.userId)?.email}</span></span>
                  <Select aria-label="Role" className="h-7 w-[100px]" value={s.role} onChange={(e) => setShares(shares.map((x) => (x.userId === s.userId ? { ...x, role: e.target.value as "view" | "edit" } : x)))}><option value="view">Can read</option><option value="edit">Can edit</option></Select>
                  <Button size="sm" variant="ghost" aria-label="Remove" icon={<X className="size-3.5" />} onClick={() => setShares(shares.filter((x) => x.userId !== s.userId))} />
                </div>
              ))}
              <div className="flex gap-2">
                <Select aria-label="Add a person" value={who} onChange={(e) => setWho(e.target.value)} className="flex-1">
                  <option value="">Add a person…</option>
                  {(members.data?.members ?? []).filter((m) => !shares.some((s) => s.userId === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.email}</option>)}
                </Select>
                <Button disabled={!who} onClick={() => { setShares([...shares, { userId: who, role: "view" }]); setWho(""); }}>Add</Button>
                <Button variant="primary" loading={saveShares.isPending} onClick={() => saveShares.mutate(shares)}>Save</Button>
              </div>
              <p className="text-[12px] text-subtle">People you add get a notification with a link.</p>
            </div>
          </section>
        )}

        <section className="grid gap-2">
          <p className="font-semibold">Send it</p>
          <div className="flex flex-wrap gap-2">
            {chatOn && (
              <Button icon={<MessagesSquare className="size-4" />} onClick={() => {
                if (owner && openUp && note.visibility === "private") onMeta({ visibility: "view" });
                share({ kind: "note", id: note.id, title: `${note.icon ? `${note.icon} ` : ""}${title || "Untitled"}`, sub: text.slice(0, 160), link: `/notes/${note.id}`, module: "Notes", fields: [{ label: "Words", value: wordCount(text) }, { label: "By", value: note.owner?.name ?? "" }] });
                onClose();
              }}>Share in a chat</Button>
            )}
            <EmailButton size="md" label="Email it" subject={title || "A note"} body={`${title || "Untitled"}\n\n${text}\n\n${link ? `Read it online: ${link}` : `Open it in Cloudesk: ${appLink}`}\n`} title="Email this note" />
            <Button icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard?.writeText(appLink).then(() => toast({ tone: "success", title: "Link copied — people need access to open it" }))}>Copy link</Button>
          </div>
          {chatOn && owner && note.visibility === "private" && <label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" checked={openUp} onChange={(e) => setOpenUp(e.target.checked)} className="accent-[var(--accent)]" /> When sharing in a chat, let everyone in the workspace read it (so the people in the chat can open it)</label>}
          {!chatOn && <p className="text-[12px] text-subtle">Turn on Chat to share notes into conversations.</p>}
        </section>

        {owner && (
          <section className="grid gap-2 rounded-[14px] p-3 ring-1 ring-border">
            <div className="flex items-center justify-between gap-3">
              <div><p className="font-semibold">Public link</p><p className="text-[12px] text-muted">Anyone with the link can read it (not edit), without signing in. Turning it off breaks the link.</p></div>
              <Switch checked={!!note.publicToken} onChange={(v) => void onAct("/publish", v ? "POST" : "DELETE", v ? "Published — anyone with the link can read it" : "Unpublished")} label="Public link" />
            </div>
            {link && <div className="flex gap-2"><Input readOnly value={link} aria-label="Public link" /><Button icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard?.writeText(link).then(() => toast({ tone: "success", title: "Copied" }))}>Copy</Button><Button icon={<ExternalLink className="size-4" />} onClick={() => window.open(link, "_blank", "noopener")} aria-label="Open" /></div>}
          </section>
        )}
      </div>
    </Dialog>
  );
}

function VersionsDialog({ id, canEdit, onClose, onRestored }: { id: string; canEdit: boolean; onClose: () => void; onRestored: (n: NoteFull) => void }) {
  const n = useNotesApi();
  const list = useQuery({ queryKey: n.key("versions", id), queryFn: () => n.call<{ versions: { id: string; version: number; title: string; words: number; createdAt: string; by: string | null }[] }>(`/${id}/versions`) });
  const [cur, setCur] = useState<string | null>(null);
  const one = useQuery({ queryKey: n.key("version", cur), queryFn: () => n.call<{ version: { title: string; content: Doc; createdAt: string } }>(`/${id}/versions/${cur}`), enabled: !!cur });
  const restore = useMutation({ mutationFn: () => n.call<{ note: NoteFull }>(`/${id}/versions/${cur}/restore`, { method: "POST" }), onSuccess: (r) => onRestored(r.note) });
  return (
    <Dialog open onClose={onClose} size="2xl" title="Version history" description="A version is kept whenever the note changes after a pause of 10 minutes, and before any restore.">
      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <ul className="grid max-h-[60vh] content-start gap-1 overflow-y-auto">
          {list.data?.versions.length === 0 && <li className="text-[13px] text-muted">No earlier versions yet.</li>}
          {list.data?.versions.map((v) => (
            <li key={v.id}><button type="button" onClick={() => setCur(v.id)} className={clsx("grid w-full gap-0.5 rounded-[10px] px-3 py-2 text-left text-[12.5px]", cur === v.id ? "bg-surface-2 ring-1 ring-border" : "hover:bg-surface-2")}><b>{new Date(v.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</b><span className="text-muted">{v.by ?? "—"} · {v.words} words</span></button></li>
          ))}
        </ul>
        <div className="min-h-[200px] rounded-[14px] p-4 ring-1 ring-border">
          {!cur ? <p className="text-[13px] text-muted">Pick a version to see it.</p> : !one.data ? <Skeleton className="h-40" /> : (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-2"><h3 className="text-[18px] font-semibold">{one.data.version.title || "Untitled"}</h3>{canEdit && <Button variant="primary" icon={<Undo2 className="size-4" />} loading={restore.isPending} onClick={() => restore.mutate()}>Restore this version</Button>}</div>
              {restore.error && <Notice tone="danger">{errorMessage(restore.error)}</Notice>}
              <div className="max-h-[50vh] overflow-y-auto"><DocView doc={one.data.version.content} /></div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RemindDialog({ at, onClose, onSave }: { at: string | null; onClose: () => void; onSave: (v: string | null) => void }) {
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [v, setV] = useState(() => (at ? local(new Date(at)) : local(new Date(new Date().getTime() + 3600_000))));
  const quick = [["In 1 hour", 1], ["Tomorrow 9 am", -1], ["Next week", 24 * 7]] as const;
  return (
    <Dialog open onClose={onClose} size="sm" title="Remind me" description="You'll get a notification (and an email, if you've turned those on) with a link to the note." footer={<>{at && <Button variant="ghost" onClick={() => onSave(null)}>Remove reminder</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v} onClick={() => onSave(new Date(v).toISOString())}>Set reminder</Button></>}>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">{quick.map(([l, h]) => <button key={l} type="button" onClick={() => { const d = new Date(); if (h === -1) { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); } else d.setTime(d.getTime() + h * 3600_000); setV(local(d)); }} className="rounded-full px-3 py-1 text-[12.5px] ring-1 ring-border hover:bg-surface-2">{l}</button>)}</div>
        <Field label="When">{(a) => <Input {...a} type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

/** Pick any record from any module, through the app's search. */
function RecordPicker({ onClose, onPick }: { onClose: () => void; onPick: (r: { title: string; sub: string; url: string; module: string }) => void }) {
  const { org } = useSession();
  const [q, setQ] = useState("");
  const [d, setD] = useState("");
  useEffect(() => { const t = setTimeout(() => setD(q), 220); return () => clearTimeout(t); }, [q]);
  const r = useQuery({ queryKey: ["search", org.id, d], queryFn: () => api<{ results: { kind: string; label: string; sub: string; link: string; id: string }[] }>(`/api/v1/orgs/${org.id}/search?q=${encodeURIComponent(d)}`), enabled: d.trim().length >= 2 });
  const label = (k: string) => k.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Dialog open onClose={onClose} size="md" title="Link a record" description="Search invoices, deals, contacts, orders, tickets, people, projects — anything in your modules.">
      <div className="grid gap-3">
        <Input aria-label="Search records" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, number or email…" autoFocus />
        <ul className="grid max-h-[50vh] gap-1 overflow-y-auto">
          {d.trim().length < 2 ? <li className="text-[13px] text-muted">Type at least two letters.</li> : r.isLoading ? <li><Skeleton className="h-10" /></li> : r.data?.results.length === 0 ? <li className="text-[13px] text-muted">Nothing found.</li> : r.data?.results.map((x) => (
            <li key={`${x.kind}-${x.id}`}><button type="button" onClick={() => onPick({ title: x.label, sub: x.sub, url: x.link, module: label(x.kind) })} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left hover:bg-surface-2"><Badge>{label(x.kind)}</Badge><span className="min-w-0"><span className="block truncate text-[13.5px] font-medium">{x.label}</span>{x.sub && <span className="block truncate text-[12px] text-muted">{x.sub}</span>}</span></button></li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

/** Action items from the note: add them as to-dos, or straight into a project. */
function ActionsDialog({ noteId, onClose, onInsert, beforeRun }: { noteId: string; onClose: () => void; onInsert: (b: Block[]) => void; beforeRun: () => Promise<void> }) {
  const n = useNotesApi();
  const toast = useToast();
  const { org } = useSession();
  const work = visibleTo(org, "work");
  const run = useQuery({ queryKey: n.key("actions", noteId), queryFn: async () => { await beforeRun(); return n.call<{ items: { task: string; owner: string; due: string }[]; blocks: Block[] }>("/ai", { method: "POST", body: { action: "actions", noteId } }); }, retry: false, staleTime: Infinity });
  const projects = useQuery({ queryKey: ["work-projects", org.id], queryFn: () => api<{ projects: { id: string; name: string; status?: string }[] }>(`/api/v1/orgs/${org.id}/work/projects`), enabled: work });
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => run.data?.items ?? [], [run.data]);
  const chosen = useMemo(() => (pick.size ? items.filter((_, i) => pick.has(i)) : items), [pick, items]);
  const toTasks = async () => {
    setBusy(true);
    let made = 0;
    for (const it of chosen) {
      try {
        await api(`/api/v1/orgs/${org.id}/work/tasks`, { method: "POST", body: { projectId: project, title: it.task.slice(0, 300), description: it.owner ? `For: ${it.owner}` : "", ...( /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? { dueDate: it.due } : {}) } });
        made++;
      } catch (e) {
        toast({ tone: "error", title: errorMessage(e) });
        break;
      }
    }
    setBusy(false);
    if (made) toast({ tone: "success", title: `${made} task${made === 1 ? "" : "s"} added to the project` });
  };
  return (
    <Dialog open onClose={onClose} size="lg" title="Action items" description="Found by AI in this note. Add them as to-dos, or create tasks in a project.">
      {run.isLoading ? <div className="flex items-center gap-2 py-8 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> Reading the note…</div> : run.error ? <Notice tone="danger">{errorMessage(run.error)}</Notice> : items.length === 0 ? <p className="py-6 text-[13px] text-muted">No action items in this note.</p> : (
        <div className="grid gap-4">
          <ul className="grid gap-1">
            {items.map((it, i) => (
              <li key={i}><label className="flex items-start gap-2.5 rounded-[10px] px-3 py-2 hover:bg-surface-2"><input type="checkbox" checked={pick.size ? pick.has(i) : true} onChange={(e) => setPick((s) => { const base = s.size ? new Set(s) : new Set(items.map((_, j) => j)); if (e.target.checked) base.add(i); else base.delete(i); return base; })} className="mt-1 accent-[var(--accent)]" /><span className="text-[13.5px]"><b className="font-medium">{it.task}</b>{(it.owner || it.due) && <span className="block text-[12px] text-muted">{[it.owner, it.due && `by ${it.due}`].filter(Boolean).join(" · ")}</span>}</span></label></li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button variant="primary" icon={<ListChecks className="size-4" />} onClick={() => onInsert(run.data!.blocks.filter((_, i) => !pick.size || pick.has(i)))}>Add as to-dos</Button>
            {work && (
              <>
                <Select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="w-[220px]"><option value="">Choose a project…</option>{(projects.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                <Button disabled={!project || !chosen.length} loading={busy} onClick={() => void toTasks()}>Create {chosen.length} task{chosen.length === 1 ? "" : "s"}</Button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function AskThis({ noteId, onClose, beforeRun }: { noteId: string; onClose: () => void; beforeRun: () => Promise<void> }) {
  const n = useNotesApi();
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: async () => { await beforeRun(); return n.call<{ answer: string; found: boolean }>("/ai", { method: "POST", body: { action: "ask", noteId, question: q } }); } });
  return (
    <Dialog open onClose={onClose} size="md" title="Ask this note" description="AI answers from this note only.">
      <div className="grid gap-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) ask.mutate(); }}>
          <Input aria-label="Question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What's the budget?" autoFocus />
          <Button type="submit" variant="primary" loading={ask.isPending} disabled={q.trim().length < 2}>Ask</Button>
        </form>
        {ask.error && <Notice tone="danger">{errorMessage(ask.error)}</Notice>}
        {ask.data && <p className="rounded-[12px] bg-surface-2 p-3 text-[14px] leading-relaxed whitespace-pre-wrap">{ask.data.answer}</p>}
      </div>
    </Dialog>
  );
}

function TranslateDialog({ doc, title, onClose, onDone }: { doc: Doc; title: string; onClose: () => void; onDone: (id: string) => void }) {
  const n = useNotesApi();
  const [lang, setLang] = useState("Hindi");
  const run = useMutation({
    mutationFn: async () => {
      const r = await n.call<{ text: string }>("/ai", { method: "POST", body: { action: "translate", language: lang, text: toMarkdown(doc, title).slice(0, 20000) } });
      const d = fromMarkdown(r.text);
      const t = d.blocks[0]?.type === "h1" ? d.blocks.shift()!.text : `${title} (${lang})`;
      return n.call<{ note: NoteFull }>("", { method: "POST", body: { title: t.slice(0, 300), content: d.blocks.length ? d : fromMarkdown(""), tags: ["translated"] } });
    },
    onSuccess: (r) => onDone(r.note.id),
  });
  return (
    <Dialog open onClose={onClose} size="sm" title="Translate into a new note" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>Translate</Button></>}>
      <div className="grid gap-3">
        {run.error && <Notice tone="danger">{errorMessage(run.error)}</Notice>}
        <Field label="Language">{(a) => <Select {...a} value={lang} onChange={(e) => setLang(e.target.value)}>{["Hindi", "Marathi", "Gujarati", "Tamil", "Telugu", "Kannada", "Bengali", "Malayalam", "Punjabi", "Urdu", "English", "Arabic", "Spanish", "French", "German"].map((l) => <option key={l}>{l}</option>)}</Select>}</Field>
        <p className="text-[12.5px] text-muted">Your note stays as it is; the translation is saved as a new note.</p>
      </div>
    </Dialog>
  );
}
