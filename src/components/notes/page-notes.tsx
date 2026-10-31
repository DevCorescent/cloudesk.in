"use client";

// Notes on any page of any module: the top bar's notes button opens a panel
// with the notes attached to the page you're on (an invoice, a deal, a
// patient, a report…) and a quick note that's saved to it — in that module's
// own folder unless you pick another. Everything opens in Notes too.
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, NotebookPen, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/overlays";
import { Button, IconButton, Select, Textarea } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/client/api";
import { fromMarkdown } from "@/lib/notes/blocks";
import { moduleOfPath, useNotesApi, when, type NoteSummary, type Overview } from "./api";
import { useShortcuts } from "@/components/ui/shortcut";

export function PageNotesButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  if (path.startsWith("/notes")) return null;
  return (
    <>
      <button type="button" aria-label="Notes on this page" title="Notes on this page" onClick={() => setOpen(true)} className="bar-icon"><NotebookPen aria-hidden /></button>
      {open && <PageNotes path={path} onClose={() => setOpen(false)} />}
    </>
  );
}

export function PageNotes({ path, onClose }: { path: string; onClose: () => void }) {
  const saveKeys = useShortcuts().keys("mod+enter");
  const n = useNotesApi();
  const toast = useToast();
  const mod = moduleOfPath(path);
  const [label, setLabel] = useState(mod?.name ?? "This page");
  useEffect(() => {
    const t = document.title.split(/\s+[·|–—-]\s+/)[0]?.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page's own name, read once it's in the document
    if (t) setLabel(t.slice(0, 200));
  }, []);
  const list = useQuery({ queryKey: n.key("list", "page", path), queryFn: () => n.call<{ notes: NoteSummary[] }>(`?view=page&href=${encodeURIComponent(path)}`) });
  const ov = useQuery({ queryKey: n.key("overview"), queryFn: () => n.call<Overview>("/overview") });
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const save = useMutation({
    mutationFn: () => n.call("", { method: "POST", body: { title: title.trim() || `Note on ${label}`, content: fromMarkdown(text || ""), attached: { module: mod?.id ?? "app", href: path, label }, folderId: folder || null } }),
    onSuccess: () => { setTitle(""); setText(""); void n.refresh(); toast({ tone: "success", title: `Saved${folder ? "" : ` in ${mod?.name ?? "Notes"}`}` }); },
    onError: (e) => toast({ tone: "error", title: errorMessage(e) }),
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="Notes on this page">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside className="absolute top-0 right-0 flex h-dvh w-[400px] max-w-[100vw] flex-col bg-bg shadow-2xl">
        <header className="flex items-start gap-2 border-b border-border px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent"><NotebookPen className="size-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">Notes on this page</p><p className="truncate text-[12.5px] text-muted">{label}{mod && mod.name !== label ? ` · ${mod.name}` : ""}</p></div>
          <IconButton label="Close" icon={<X className="size-4" />} onClick={onClose} />
        </header>
        <form className="grid gap-2 border-b border-border p-4" onSubmit={(e) => { e.preventDefault(); if (text.trim() || title.trim()) save.mutate(); }}>
          <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Note on ${label}`} className="bg-transparent text-[15px] font-semibold outline-none placeholder:text-subtle" maxLength={300} />
          <Textarea aria-label="Note" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Write anything — Markdown works:\n- [ ] follow up on Friday\n**important**"} className="min-h-28" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (text.trim() || title.trim()) save.mutate(); } }} />
          <div className="flex items-center gap-2">
            <Select aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)} className="h-8 flex-1">
              <option value="">{mod ? `${mod.name} folder` : "No folder"}</option>
              {(ov.data?.folders ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Button type="submit" variant="primary" icon={save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} disabled={!text.trim() && !title.trim()}>Save</Button>
          </div>
          <p className="text-[11.5px] text-subtle">{saveKeys ? `${saveKeys} to save. ` : ""}It stays linked to this page.</p>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!list.data ? <p className="p-3 text-[13px] text-muted">Loading…</p> : list.data.notes.length === 0 ? <p className="p-3 text-[13px] text-muted">No notes on this page yet.</p> : (
            <ul className="grid gap-1">
              {list.data.notes.map((x) => (
                <li key={x.id}>
                  <Link href={`/notes/${x.id}`} onClick={onClose} className="grid gap-0.5 rounded-[10px] px-3 py-2 hover:bg-surface-2">
                    <span className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{x.icon} {x.title || "Untitled"}</span><span className="text-[11.5px] text-subtle">{when(x.updatedAt)}</span></span>
                    <span className="line-clamp-2 text-[12.5px] text-muted">{x.snippet.slice(x.title.length).trim() || "No text yet"}</span>
                    {!x.mine && <span className="text-[11px] text-subtle">by {x.owner}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="border-t border-border p-3"><Link href="/notes" onClick={onClose} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">Open Notes <ExternalLink className="size-3.5" /></Link></footer>
      </aside>
    </div>
  );
}
