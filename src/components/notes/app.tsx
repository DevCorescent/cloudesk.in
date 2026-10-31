"use client";

// Notes: the sidebar (views, folders, tags), the list, and the open note.
// Three panes on a wide screen, two on a tablet, one at a time on a phone.
// Drag notes onto a folder to file them (several at once if selected), drop
// .md / .txt files on the list to import them, drag folders into folders.
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Archive, BellRing, CalendarDays, ChevronRight, Download, FileText, Folder as FolderIcon, FolderPlus, Hash, Inbox, LayoutTemplate, Loader2, MoreHorizontal, Pencil, Pin, Plus, Search, Sparkles, Trash2, Upload, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Dialog, Menu, useToast } from "@/components/ui/overlays";
import { Button, EmptyState, Field, Input, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { COLORS, fromMarkdown, SWATCH, TEMPLATES } from "@/lib/notes/blocks";
import { AskNotes } from "./ask";
import { istToday, useNotesApi, when, type Folder, type NoteFull, type NoteSummary, type Overview, type View } from "./api";
import { NotePane } from "./note";
import { KeyboardOnly, Keys } from "@/components/ui/shortcut";

const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "all", label: "All notes", icon: <Inbox /> },
  { id: "pinned", label: "Pinned", icon: <Pin /> },
  { id: "daily", label: "Daily notes", icon: <CalendarDays /> },
  { id: "shared", label: "Shared with me", icon: <Users /> },
  { id: "reminders", label: "Reminders", icon: <BellRing /> },
  { id: "templates", label: "Templates", icon: <LayoutTemplate /> },
  { id: "trash", label: "Trash", icon: <Trash2 /> },
];

type Filter = { view: View; folder?: string; tag?: string };

export function NotesApp({ initialId }: { initialId: string | null }) {
  const n = useNotesApi();
  const router = useRouter();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [filter, setFilter] = useState<Filter>({ view: "all" });
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [nav, setNav] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 220);
    return () => clearTimeout(t);
  }, [q]);
  // Following a link to another note (or back) opens it.
  const [seen, setSeen] = useState(initialId);
  if (seen !== initialId) {
    setSeen(initialId);
    setOpenId(initialId);
  }

  const ov = useQuery({ queryKey: n.key("overview"), queryFn: () => n.call<Overview>("/overview") });
  const params = new URLSearchParams({ view: filter.view, ...(filter.folder ? { folder: filter.folder } : {}), ...(filter.tag ? { tag: filter.tag } : {}), ...(query ? { q: query } : {}) });
  const list = useQuery({ queryKey: n.key("list", params.toString()), queryFn: () => n.call<{ notes: NoteSummary[] }>(`?${params}`) });

  const open = (id: string | null) => {
    setOpenId(id);
    router.push(id ? `/notes/${id}` : "/notes", { scroll: false });
  };
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => n.call<{ note: NoteFull }>("", { method: "POST", body: { folderId: filter.folder && filter.folder !== "none" ? filter.folder : null, ...body } }),
    onSuccess: (r) => { void n.refresh(); setCreating(false); open(r.note.id); },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const today = useMutation({
    mutationFn: (day?: string) => n.call<{ note: NoteFull }>(`/daily/${day ?? istToday()}`),
    onSuccess: (r) => { void n.refresh(); open(r.note.id); },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const move = useMutation({
    mutationFn: (v: { ids: string[]; folderId: string | null }) => n.call<{ moved: number }>("/move", { method: "POST", body: v }),
    onSuccess: (r, v) => { void n.refresh(); setSelected(new Set()); toast({ tone: "success", title: `Moved ${r.moved} note${r.moved === 1 ? "" : "s"}${v.folderId ? "" : " out of folders"}` }); },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  const importFiles = async (files: File[]) => {
    const notes = [];
    for (const f of files.slice(0, 50)) {
      if (!/\.(md|markdown|txt)$/i.test(f.name) && !f.type.startsWith("text/")) continue;
      const doc = fromMarkdown((await f.text()).slice(0, 500_000));
      const h1 = doc.blocks[0]?.type === "h1" ? doc.blocks.shift()!.text : "";
      notes.push({ title: (h1 || f.name.replace(/\.(md|markdown|txt)$/i, "")).slice(0, 300), content: doc.blocks.length ? doc : fromMarkdown(""), tags: ["imported"] });
    }
    if (!notes.length) return toast({ tone: "error", title: "Only Markdown (.md) and text (.txt) files can be imported." });
    try {
      const r = await n.call<{ created: number }>("/import", { method: "POST", body: { notes, folderId: filter.folder && filter.folder !== "none" ? filter.folder : null } });
      void n.refresh();
      toast({ tone: "success", title: `Imported ${r.created} note${r.created === 1 ? "" : "s"}` });
    } catch (e) {
      toast({ tone: "error", title: errorMessage(e) });
    }
  };

  // /notes?today=1 and ?new=1 (from the command palette) open today's note or a new one.
  const opened = useRef(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (opened.current || (!sp.get("today") && !sp.get("new"))) return;
    opened.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address after mount
    if (sp.get("new") === "1") setCreating(true);
    else today.mutate(undefined);
  }, [today]);

  // Keyboard: Alt+N (⌥N) new note, Alt+T (⌥T) today, / to search.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input,textarea,[contenteditable]");
      if (e.altKey && e.code === "KeyN") {
        e.preventDefault();
        setCreating(true);
      } else if (e.altKey && e.code === "KeyT") {
        e.preventDefault();
        today.mutate(undefined);
      } else if (!typing && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const folders = ov.data?.folders ?? [];
  const title = filter.folder ? (filter.folder === "none" ? "Not in a folder" : folders.find((f) => f.id === filter.folder)?.name ?? "Folder") : filter.tag ? `#${filter.tag}` : VIEWS.find((v) => v.id === filter.view)!.label;
  const pick = (f: Filter) => {
    setFilter(f);
    setNav(false);
    setSelected(new Set());
    if (window.innerWidth < 1024) open(null);
  };

  const sidebar = (
    <Sidebar
      ov={ov.data}
      filter={filter}
      onPick={pick}
      onNew={() => setCreating(true)}
      onToday={() => today.mutate(undefined)}
      todayBusy={today.isPending}
      onAsk={() => setAsking(true)}
      onDropNotes={(ids, folderId) => move.mutate({ ids, folderId })}
    />
  );

  return (
    <div className="flex h-[var(--app-h)] min-h-[520px] overflow-hidden" data-no-fit>
      {/* Sidebar: always on wide screens, a drawer otherwise. */}
      <aside className="hidden w-[240px] shrink-0 border-r border-border bg-surface/50 2xl:block">{sidebar}</aside>
      {nav && (
        <div className="fixed inset-0 z-50 2xl:hidden" role="dialog" aria-label="Notes folders">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={() => setNav(false)} />
          <div className="absolute top-0 left-0 h-dvh w-[280px] max-w-[85vw] bg-bg shadow-2xl">{sidebar}</div>
        </div>
      )}

      {/* The list */}
      <section
        className={clsx("flex w-full shrink-0 flex-col border-r border-border md:w-[300px] xl:w-[320px]", openId ? "hidden md:flex" : "flex")}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void importFiles([...e.dataTransfer.files]); } }}
      >
        <div className="grid gap-2 border-b border-border px-3 py-3">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="2xl:hidden" aria-label="Folders" icon={<FolderIcon className="size-4" />} onClick={() => setNav(true)} />
            <h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-tight">{title}</h1>
            <Button size="sm" variant="ghost" aria-label="Ask your notes" title="Ask your notes (AI)" icon={<Sparkles className="size-4" />} onClick={() => setAsking(true)} />
            <Menu
              label="More"
              trigger={(p) => <Button {...p} size="sm" variant="ghost" aria-label="More" icon={<MoreHorizontal className="size-4" />} />}
              items={[
                { label: "Import Markdown or text files", icon: <Upload />, onSelect: () => document.getElementById("notes-import")?.click() },
                { label: "Export all as CSV", icon: <Download />, onSelect: () => window.open(`${n.base}/csv`, "_blank") },
                ...(filter.view === "trash" ? [{ label: "Empty the trash", icon: <Trash2 />, danger: true, onSelect: () => { if (window.confirm("Delete every note in the trash for good? This can't be undone.")) void n.call("/trash", { method: "DELETE" }).then(() => n.refresh()); } }] : []),
              ]}
            />
            <Button size="sm" variant="primary" icon={create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} onClick={() => setCreating(true)}>New</Button>
            <input id="notes-import" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple className="hidden" onChange={(e) => { void importFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
            <Input ref={searchRef} aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes  /" className="h-8 pl-8" />
            {q && <button type="button" aria-label="Clear" onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-subtle hover:text-fg"><X className="size-3.5" /></button>}
          </div>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] bg-accent-soft px-2 py-1.5 text-[12.5px]">
              <span className="font-medium">{selected.size} selected</span>
              <span className="text-muted">— drag onto a folder, or</span>
              <Menu label="Move to" trigger={(p) => <button {...p} type="button" className="font-medium text-accent underline">move to…</button>} items={[{ label: "No folder", icon: <Inbox />, onSelect: () => move.mutate({ ids: [...selected], folderId: null }) }, ...folders.map((f) => ({ label: f.name, icon: <FolderIcon />, onSelect: () => move.mutate({ ids: [...selected], folderId: f.id }) }))]} />
              <button type="button" className="ml-auto text-muted hover:text-fg" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {list.isError ? (
            <p className="p-4 text-[13px] text-danger">{errorMessage(list.error)}</p>
          ) : !list.data ? (
            <div className="grid gap-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : list.data.notes.length === 0 ? (
            <EmptyState
              className="py-14"
              icon={filter.view === "trash" ? <Archive /> : <FileText />}
              title={query ? `Nothing matches “${query}”` : filter.view === "trash" ? "The trash is empty" : "No notes here yet"}
              description={query ? "Try other words, or ask your notes with AI." : filter.view === "trash" ? "Deleted notes stay here for 30 days." : "Write one, start today's daily note, or drop Markdown files here to import them."}
              action={!query && filter.view !== "trash" ? <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => setCreating(true)}>New note</Button><Button size="sm" onClick={() => today.mutate(undefined)}>Today&apos;s note</Button></div> : undefined}
            />
          ) : (
            <ul className="grid gap-0.5">
              {list.data.notes.map((x) => (
                <NoteRow
                  key={x.id}
                  x={x}
                  active={x.id === openId}
                  selected={selected.has(x.id)}
                  query={query}
                  onOpen={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return setSelected((s) => { const nx = new Set(s); if (nx.has(x.id)) nx.delete(x.id); else nx.add(x.id); return nx; });
                    open(x.id);
                  }}
                  dragIds={() => (selected.has(x.id) ? [...selected] : [x.id])}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* The note */}
      <section className={clsx("min-w-0 flex-1", openId ? "flex" : "hidden md:flex")}>
        {openId ? (
          <NotePane
            key={openId}
            id={openId}
            folders={folders}
            onBack={() => open(null)}
            onOpen={open}
            onGone={() => { open(null); void n.refresh(); }}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8">
            <div className="grid max-w-sm justify-items-center gap-3 text-center">
              <span className="grid size-14 place-items-center rounded-[18px] bg-accent-soft text-accent"><Pencil className="size-6" /></span>
              <h2 className="text-[18px] font-semibold tracking-tight">Pick a note, or start one</h2>
              <p className="text-[13.5px] text-muted">Daily notes fill in your meetings and tasks. Type “/” in a note for tables, to-dos, live calculations, records from any module and more.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New note</Button>
                <Button icon={<CalendarDays className="size-4" />} loading={today.isPending} onClick={() => today.mutate(undefined)}>Today</Button>
              </div>
              <KeyboardOnly><p className="flex flex-wrap items-center justify-center gap-1.5 text-[11.5px] text-subtle"><Keys k="alt+n" /> new note · <Keys k="alt+t" /> today · <Keys k="/" /> search</p></KeyboardOnly>
            </div>
          </div>
        )}
      </section>

      {creating && <NewNote onClose={() => setCreating(false)} onCreate={(b) => create.mutate(b)} busy={create.isPending} />}
      {asking && <AskNotes onClose={() => setAsking(false)} onOpen={(id) => { setAsking(false); open(id); }} />}
    </div>
  );
}

// ─── The sidebar ───────────────────────────────────────────────────────────

function Sidebar({ ov, filter, onPick, onNew, onToday, todayBusy, onAsk, onDropNotes }: { ov?: Overview; filter: Filter; onPick: (f: Filter) => void; onNew: () => void; onToday: () => void; todayBusy: boolean; onAsk: () => void; onDropNotes: (ids: string[], folderId: string | null) => void }) {
  const n = useNotesApi();
  const toast = useToast();
  const [folderDialog, setFolderDialog] = useState<{ folder?: Folder; parentId?: string | null } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const folders = ov?.folders ?? [];
  const children = (pid: string | null) => folders.filter((f) => f.parentId === pid);
  const dropOn = (e: DragEvent, folderId: string | null) => {
    e.preventDefault();
    setOver(null);
    const ids = e.dataTransfer.getData("application/x-note-ids");
    const folder = e.dataTransfer.getData("application/x-note-folder");
    if (ids) onDropNotes(JSON.parse(ids) as string[], folderId);
    else if (folder && folder !== folderId) void n.call(`/folders/${folder}`, { method: "PATCH", body: { parentId: folderId } }).then(() => n.refresh(), (err) => toast({ tone: "error", title: errorMessage(err) }));
  };
  const over$ = (id: string) => (e: DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-note-ids") || e.dataTransfer.types.includes("application/x-note-folder")) {
      e.preventDefault();
      setOver(id);
    }
  };
  const tree = (pid: string | null, depth: number): ReactNode =>
    children(pid).map((f) => {
      const kids = children(f.id);
      const isOpen = !closed.has(f.id);
      const on = filter.folder === f.id;
      return (
        <div key={f.id}>
          <div
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/x-note-folder", f.id)}
            onDragOver={over$(f.id)}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => dropOn(e, f.id)}
            className={clsx("group flex items-center rounded-[8px] pr-1 text-[13px]", on ? "bg-surface-2 font-medium" : "hover:bg-surface-2", over === f.id && "ring-2 ring-accent")}
            style={{ paddingLeft: depth * 12 }}
          >
            <button type="button" aria-label={isOpen ? "Collapse" : "Expand"} onClick={() => setClosed((s) => { const nx = new Set(s); if (nx.has(f.id)) nx.delete(f.id); else nx.add(f.id); return nx; })} className={clsx("grid size-6 shrink-0 place-items-center text-subtle", !kids.length && "invisible")}><ChevronRight className={clsx("size-3.5 transition-transform", isOpen && "rotate-90")} /></button>
            <button type="button" onClick={() => onPick({ view: "mine", folder: f.id })} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
              {f.icon ? <span className="text-[14px] leading-none">{f.icon}</span> : <FolderIcon className="size-4 shrink-0" style={{ color: SWATCH[f.color] ?? SWATCH.slate }} />}
              <span className="truncate">{f.name}</span>
            </button>
            <span className="text-[11.5px] text-subtle tabular-nums group-hover:hidden">{f.count || ""}</span>
            <Menu
              label="Folder"
              trigger={(p) => <button {...p} type="button" aria-label={`${f.name} options`} className="hidden size-6 place-items-center rounded text-subtle hover:text-fg group-hover:grid"><MoreHorizontal className="size-3.5" /></button>}
              items={[
                { label: "New folder inside", icon: <FolderPlus />, onSelect: () => setFolderDialog({ parentId: f.id }) },
                { label: "Rename or colour", icon: <Pencil />, onSelect: () => setFolderDialog({ folder: f }) },
                ...(f.parentId ? [{ label: "Move to the top", icon: <ChevronRight />, onSelect: () => void n.call(`/folders/${f.id}`, { method: "PATCH", body: { parentId: null } }).then(() => n.refresh()) }] : []),
                { label: "Delete folder (keeps its notes)", icon: <Trash2 />, danger: true, onSelect: () => { if (window.confirm(`Delete “${f.name}”? Its notes and folders move up a level.`)) void n.call(`/folders/${f.id}`, { method: "DELETE" }).then(() => { n.refresh(); if (filter.folder === f.id) onPick({ view: "all" }); }); } },
              ]}
            />
          </div>
          {isOpen && kids.length > 0 && tree(f.id, depth + 1)}
        </div>
      );
    });
  return (
    <div className="flex h-full flex-col">
      <div className="grid gap-1.5 p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={onNew}>New note</Button>
          <Button size="sm" icon={<CalendarDays className="size-3.5" />} loading={todayBusy} onClick={onToday}>Today</Button>
        </div>
        <button type="button" onClick={onAsk} className="flex items-center gap-2 rounded-[10px] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_10%,transparent),transparent)] px-3 py-2 text-left text-[12.5px] text-muted ring-1 ring-border hover:text-fg"><Sparkles className="size-3.5 text-accent" /> Ask your notes…</button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="grid gap-px">
          {VIEWS.map((v) => {
            const on = filter.view === v.id && !filter.folder && !filter.tag;
            const count = ov?.counts?.[v.id];
            return (
              <button key={v.id} type="button" onClick={() => onPick({ view: v.id })} onDragOver={v.id === "all" ? over$("all") : undefined} onDrop={v.id === "all" ? (e) => dropOn(e, null) : undefined} className={clsx("flex items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[13px] [&>svg]:size-4", on ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg", over === "all" && v.id === "all" && "ring-2 ring-accent")}>
                {v.icon}<span className="flex-1 text-left">{v.label}</span>{count ? <span className="text-[11.5px] text-subtle tabular-nums">{count}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between px-2.5">
          <p className="text-[10.5px] font-semibold tracking-wide text-subtle uppercase">Folders</p>
          <button type="button" aria-label="New folder" title="New folder" onClick={() => setFolderDialog({ parentId: null })} className="grid size-6 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-fg"><FolderPlus className="size-3.5" /></button>
        </div>
        <div className="mt-1 grid gap-px" onDragOver={over$("root")} onDrop={(e) => { if (e.target === e.currentTarget) dropOn(e, null); }}>
          {folders.length === 0 ? <p className="px-2.5 py-1.5 text-[12px] text-subtle">Folders you make — and one for each module you save notes from — appear here.</p> : tree(null, 0)}
          <button type="button" onClick={() => onPick({ view: "mine", folder: "none" })} onDragOver={over$("none")} onDragLeave={() => setOver(null)} onDrop={(e) => dropOn(e, null)} className={clsx("flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2", filter.folder === "none" && "bg-surface-2 font-medium text-fg", over === "none" && "ring-2 ring-accent")}>
            <Inbox className="size-4" /><span className="flex-1 text-left">Not in a folder</span><span className="text-[11.5px] text-subtle tabular-nums">{ov?.unfiled || ""}</span>
          </button>
        </div>
        {(ov?.tags.length ?? 0) > 0 && (
          <>
            <p className="mt-4 px-2.5 text-[10.5px] font-semibold tracking-wide text-subtle uppercase">Tags</p>
            <div className="mt-1.5 flex flex-wrap gap-1 px-2">
              {ov!.tags.map((t) => <button key={t.tag} type="button" onClick={() => onPick({ view: "all", tag: t.tag })} className={clsx("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px]", filter.tag === t.tag ? "bg-fg text-bg" : "bg-surface-2 text-muted hover:text-fg")}><Hash className="size-3" />{t.tag}</button>)}
            </div>
          </>
        )}
      </nav>
      {folderDialog && <FolderDialog {...folderDialog} onClose={() => setFolderDialog(null)} />}
    </div>
  );
}

function FolderDialog({ folder, parentId = null, onClose }: { folder?: Folder; parentId?: string | null; onClose: () => void }) {
  const n = useNotesApi();
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(folder?.color ?? "slate");
  const [icon, setIcon] = useState(folder?.icon ?? "");
  const save = useMutation({ mutationFn: () => (folder ? n.call(`/folders/${folder.id}`, { method: "PATCH", body: { name, color, icon } }) : n.call("/folders", { method: "POST", body: { name, color, icon, parentId } })), onSuccess: () => (void n.refresh(), onClose()) });
  return (
    <Dialog open onClose={onClose} size="sm" title={folder ? "Folder" : "New folder"} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{folder ? "Save" : "Make folder"}</Button></>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
        {save.error && <p className="text-[13px] text-danger">{errorMessage(save.error)}</p>}
        <Field label="Name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />}</Field>
        <div className="grid gap-1.5">
          <p className="text-[13px] font-medium">Colour</p>
          <div className="flex flex-wrap gap-1.5">{COLORS.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} className={clsx("size-7 rounded-full ring-offset-2 ring-offset-bg", color === c && "ring-2 ring-fg")} style={{ background: SWATCH[c] }} />)}</div>
        </div>
        <Field label="Emoji (optional)">{(a) => <Input {...a} value={icon} onChange={(e) => setIcon([...e.target.value].slice(0, 2).join(""))} placeholder="📁" className="w-20" />}</Field>
      </form>
    </Dialog>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="rounded bg-[#fde68a] text-inherit dark:bg-[#854d0e]">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function NoteRow({ x, active, selected, query, onOpen, dragIds }: { x: NoteSummary; active: boolean; selected: boolean; query: string; onOpen: (e: React.MouseEvent) => void; dragIds: () => string[] }) {
  const snippet = useMemo(() => {
    const body = x.snippet.slice((x.title || "").length).replace(/\s+/g, " ").trim();
    if (!query) return body.slice(0, 120);
    const i = body.toLowerCase().indexOf(query.toLowerCase());
    return i > 40 ? `…${body.slice(i - 30, i + 90)}` : body.slice(0, 120);
  }, [x, query]);
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(e) => { e.dataTransfer.setData("application/x-note-ids", JSON.stringify(dragIds())); e.dataTransfer.effectAllowed = "move"; }}
        onClick={onOpen}
        className={clsx("grid w-full gap-0.5 rounded-[10px] px-3 py-2.5 text-left transition-colors", active ? "bg-surface-2 ring-1 ring-border" : selected ? "bg-accent-soft" : "hover:bg-surface-2/70")}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {x.color && <span className="size-2 shrink-0 rounded-full" style={{ background: SWATCH[x.color] }} />}
          {x.icon && <span className="text-[14px] leading-none">{x.icon}</span>}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{highlight(x.title || "Untitled", query)}</span>
          {x.pinned && <Pin className="size-3 shrink-0 text-accent" />}
          {x.locked && <span className="text-[11px]" title="Locked">🔒</span>}
          <span className="shrink-0 text-[11.5px] text-subtle">{when(x.updatedAt)}</span>
        </span>
        <span className="line-clamp-2 text-[12.5px] leading-snug text-muted">{snippet ? highlight(snippet, query) : <span className="text-subtle">No text yet</span>}</span>
        {(x.tags.length > 0 || !x.mine || x.attached || x.remindAt || x.published) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-subtle">
            {!x.mine && <span className="rounded-full bg-surface-2 px-1.5">by {x.owner}</span>}
            {x.attached && <span className="max-w-[160px] truncate rounded-full bg-surface-2 px-1.5">↳ {x.attached.label}</span>}
            {x.remindAt && <span className="rounded-full bg-warning-soft px-1.5 text-warning">⏰ {new Date(x.remindAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}
            {x.published && <span className="rounded-full bg-success-soft px-1.5 text-success">Public</span>}
            {x.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
          </span>
        )}
      </button>
    </li>
  );
}

function NewNote({ onClose, onCreate, busy }: { onClose: () => void; onCreate: (b: Record<string, unknown>) => void; busy: boolean }) {
  const n = useNotesApi();
  const mine = useQuery({ queryKey: n.key("list", "view=templates"), queryFn: () => n.call<{ notes: NoteSummary[] }>("?view=templates") });
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const draft = async () => {
    setDrafting(true);
    setErr(null);
    try {
      const r = await n.call<{ title: string; blocks: unknown[] }>("/ai", { method: "POST", body: { action: "draft", prompt } });
      onCreate({ title: r.title, content: { blocks: r.blocks }, tags: ["ai"] });
    } catch (e) {
      setErr(errorMessage(e));
      setDrafting(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title="New note" description="Start blank, from a template, or let AI write a first draft.">
      <div className="grid gap-5">
        <form className="grid gap-2 rounded-[14px] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_9%,transparent),transparent)] p-3 ring-1 ring-border" onSubmit={(e) => { e.preventDefault(); if (prompt.trim().length >= 3) void draft(); }}>
          <label htmlFor="ai-draft" className="flex items-center gap-1.5 text-[13px] font-medium"><Sparkles className="size-3.5 text-accent" /> Draft with AI</label>
          <div className="flex gap-2">
            <Input id="ai-draft" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Onboarding checklist for a new sales hire" />
            <Button type="submit" variant="primary" loading={drafting} disabled={prompt.trim().length < 3}>Draft</Button>
          </div>
          {err && <p className="text-[12.5px] text-danger">{err}</p>}
        </form>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" disabled={busy} onClick={() => onCreate(t.id === "blank" ? {} : { title: t.title, content: { blocks: t.blocks() }, icon: t.icon })} className="grid gap-1 rounded-[14px] p-3 text-left ring-1 ring-border transition-colors hover:bg-surface-2">
              <span className="text-[22px] leading-none">{t.icon}</span>
              <span className="text-[13px] font-semibold">{t.name}</span>
              <span className="line-clamp-2 text-[11.5px] text-muted">{t.line}</span>
            </button>
          ))}
        </div>
        {(mine.data?.notes.length ?? 0) > 0 && (
          <div className="grid gap-2">
            <p className="text-[12px] font-semibold tracking-wide text-subtle uppercase">Your templates</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {mine.data!.notes.map((t) => (
                <button key={t.id} type="button" disabled={busy} onClick={() => onCreate({ from: t.id })} className="grid gap-1 rounded-[14px] p-3 text-left ring-1 ring-border hover:bg-surface-2">
                  <span className="text-[20px] leading-none">{t.icon || "📄"}</span>
                  <span className="truncate text-[13px] font-semibold">{t.title || "Untitled"}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

