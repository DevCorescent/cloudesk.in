"use client";

// The drive: Home (start from a template, recent and starred), My documents,
// Shared with me, Starred, Recent, Team folders and the Trash — written
// documents and uploaded files together, in folders. Grid or list, sort and
// filter, search inside documents, select several (click, ⌘/Shift-click,
// ⌘A), drag onto a folder to move, drop files or whole folders from your
// computer to upload, right-click for everything you can do, and a details
// panel. Contracts, signatures and settings sit in the same sidebar.
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowDownAZ,
  ChevronRight,
  History,
  Timer,
  Clock,
  Copy,
  Download,
  Eye,
  FileCog,
  FilePlus2,
  FileSignature,
  FileText,
  FileUp,
  FolderInput,
  FolderPlus,
  FolderUp,
  Grid2x2,
  HardDrive,
  Home,
  Info,
  LayoutList,
  Link2,
  Loader2,
  MoreHorizontal,
  PenLine,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePhone } from "@/lib/client/use-phone";
import { createPortal } from "react-dom";
import { useShareToChat } from "@/components/chat/share";
import { ModuleContext } from "@/components/shell/module-frame";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, ErrorState, Field, Input, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { LINK_LABEL, MAX_FILE_BYTES, type DocSettings } from "@/lib/documents/model";
import { DOC_TEMPLATES, FOLDER_COLORS, FOLDER_SWATCH, KIND_LABEL, TRASH_DAYS, fmtBytes, kindOf } from "@/lib/documents/write";
import { ConvertDialog } from "../viewer/convert-dialog";
import { FileViewer } from "../viewer/file-viewer";
import { PdfTools } from "../viewer/pdf-tools";
import { QrDialog } from "../viewer/qr-dialog";
import { ActivityDialog, DropBadges, DropDialog, StayDialog } from "./drop";
import { familyOf, targetsFor } from "@/lib/documents/formats";
import { FileGlyph, FolderGlyph, MoveDialog, ShareDialog, ago, downloadUrl, hrefOf, useDocsBase, useDriveRefresh, type DriveFile, type DriveFolder, type Listing, type TreeFolder } from "./shared";
import "../docs.css";

export type DocsMeta = { me: { id: string; write: boolean; manage: boolean }; settings: DocSettings; people: { id: string; name: string; email: string }[]; links: Record<string, boolean> };

// ── The frame: meta, sidebar, and the module context the older views use ───

export function DocsShell({ section, children, bare }: { section: string; children: ReactNode; bare?: boolean }) {
  const { org } = useSession();
  const router = useRouter();
  const meta = useQuery({ queryKey: ["documents", org.id, "meta"], queryFn: () => api<DocsMeta>(`/api/v1/orgs/${org.id}/documents/meta`), retry: false });
  const [place, setPlace] = useState<Place>(HOME_PLACE);
  const placeValue = useMemo(() => ({ place, setPlace }), [place]);
  if (meta.isError)
    return (meta.error as { status?: number }).status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <FileText className="mx-auto size-7 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">Documents isn&apos;t open to you</h1>
        <p className="mt-1 text-[13px] text-muted">{errorMessage(meta.error)}</p>
        <Link href="/settings/features" className="mt-4 inline-flex text-[13px] font-medium underline">
          Open Features
        </Link>
      </div>
    ) : (
      <ErrorState message={errorMessage(meta.error)} onRetry={() => meta.refetch()} />
    );
  if (!meta.data)
    return bare ? (
      <div className="h-[var(--app-h)] animate-pulse bg-fg/[0.02]" />
    ) : (
      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[236px_1fr]">
        <Skeleton className="hidden h-[70vh] rounded-[20px] lg:block" />
        <Skeleton className="h-[70vh] rounded-[24px]" />
      </div>
    );
  const value = { orgId: org.id, meta: meta.data, go: (p: string) => router.push(p ? `/documents/${p}` : "/documents"), base: "documents", api: "documents" };
  if (bare) return <ModuleContext value={value}>{children}</ModuleContext>;
  return (
    <ModuleContext value={value}>
      <PlaceCtx.Provider value={placeValue}>
        <DriveLayout section={section} meta={meta.data}>
          {children}
        </DriveLayout>
      </PlaceCtx.Provider>
    </ModuleContext>
  );
}

const NAV: { id: string; label: string; icon: ReactNode }[] = [
  { id: "", label: "Home", icon: <Home /> },
  { id: "mine", label: "My documents", icon: <HardDrive /> },
  { id: "shared", label: "Shared with me", icon: <Users /> },
  { id: "starred", label: "Starred", icon: <Star /> },
  { id: "recent", label: "Recent", icon: <Clock /> },
];

function DriveLayout({ section, meta, children }: { section: string; meta: DocsMeta; children: ReactNode }) {
  const { org } = useSession();
  const base = useDocsBase();
  const tree = useQuery({ queryKey: ["drive", org.id, "tree"], queryFn: () => api<{ folders: TreeFolder[] }>(`${base}/tree`) });
  const storage = useQuery({ queryKey: ["drive", org.id, "storage"], queryFn: () => api<{ used: number; limit: number; docs: number }>(`${base}/storage`) });
  const team = (tree.data?.folders ?? []).filter((f) => f.root === "team" && !f.parentId);
  // Phones: the sections are a row of chips to swipe through.
  const link = (id: string, label: ReactNode, icon: ReactNode, on: boolean, extra?: ReactNode) => (
    <Link key={id} href={id ? `/documents/${id}` : "/documents"} aria-current={on ? "page" : undefined} className={clsx("flex shrink-0 items-center gap-2.5 rounded-[11px] px-3 py-[7px] text-[13.5px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4 max-lg:h-8 max-lg:gap-1.5 max-lg:rounded-full max-lg:py-0 max-lg:text-[13px] max-lg:[&_svg]:size-3.5", on ? "bg-fg text-bg" : "text-fg/70 hover:bg-fg/[0.05] hover:text-fg max-lg:bg-[var(--surface-solid)] max-lg:ring-1 max-lg:ring-border max-lg:ring-inset")}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
    </Link>
  );
  const pct = storage.data ? Math.min(100, (storage.data.used / storage.data.limit) * 100) : 0;
  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-4 px-4 pt-3 pb-6 sm:px-6 sm:py-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-5">
      <aside className="lg:sticky lg:top-[calc(var(--bar)+24px)] lg:self-start print:hidden">
        <div className="mb-3 hidden lg:block">
          <NewButton meta={meta} />
        </div>
        <nav aria-label="Documents" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-1 sm:px-1 lg:flex-col lg:gap-1 lg:overflow-visible">
          {NAV.map((n) => link(n.id, n.label, n.icon, section === n.id))}
          <p className="hidden px-3 pt-4 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">Team</p>
          <span className="lg:hidden">{link("team", "Team", <Users />, section === "team")}</span>
          <div className="hidden lg:contents">
            {link("team", "All team folders", <Users />, section === "team")}
            {team.slice(0, 12).map((f) => (
              <Link key={f.id} href={`/documents/folder/${f.id}`} className="flex items-center gap-2.5 rounded-[11px] py-[6px] pr-3 pl-5 text-[13px] text-fg/70 hover:bg-fg/[0.05] hover:text-fg">
                <FolderGlyph f={f} size={18} />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
              </Link>
            ))}
          </div>
          <p className="hidden px-3 pt-4 pb-1 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase lg:block">Agreements</p>
          {link("agreements", <><span className="lg:hidden">Agreements</span><span className="max-lg:hidden">Overview</span></>, <FileSignature />, section === "agreements")}
          {link("contracts", "Contracts", <FileText />, section === "contracts")}
          {link("signatures", "Signatures", <PenLine />, section === "signatures")}
          {link("trash", "Trash", <Trash2 />, section === "trash")}
          {meta.me.manage && link("settings", "Settings", <Settings />, section === "settings")}
        </nav>
        {storage.data && (
          <div className="mt-5 hidden rounded-[14px] border border-border p-3 lg:block">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium">Storage</span>
              <span className="text-muted tabular-nums">{Math.round(pct)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fg/[0.07]">
              <div className={clsx("h-full rounded-full", pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-[#7c5cdb]")} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted">
              {fmtBytes(storage.data.used)} of {fmtBytes(storage.data.limit)} · {storage.data.docs} written documents
            </p>
          </div>
        )}
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}

// ── New ─────────────────────────────────────────────────────────────────────

/** Where "New" puts things: the folder you're in, or My documents. */
type Place = { folderId: string | null; root: "mine" | "team" };
const HOME_PLACE: Place = { folderId: null, root: "mine" };

function useCreate() {
  const base = useDocsBase();
  const router = useRouter();
  const toast = useToast();
  const refresh = useDriveRefresh();
  return useMutation({
    mutationFn: (b: { templateId?: string; title?: string } & Place) => api<{ file: DriveFile }>(`${base}/docs`, { method: "POST", body: b }),
    onSuccess: (r) => {
      refresh();
      router.push(`/documents/d/${r.file.id}`);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't create the document", description: errorMessage(e) }),
  });
}

/** Where you are in the drive, so New (in the sidebar too) adds things there. */
const PlaceCtx = createContext<{ place: Place; setPlace: (p: Place) => void }>({ place: { folderId: null, root: "mine" }, setPlace: () => {} });
function usePlace(p: Place) {
  const { setPlace } = useContext(PlaceCtx);
  useEffect(() => setPlace(p), [setPlace, p.folderId, p.root]); // eslint-disable-line react-hooks/exhaustive-deps -- by value
}

function NewButton({ meta, compact }: { meta: DocsMeta; compact?: boolean }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<null | "folder" | "templates">(null);
  const create = useCreate();
  const up = useUploader();
  const [files, setFiles] = useState<HTMLInputElement | null>(null);
  const [folder, setFolder] = useState<HTMLInputElement | null>(null);
  const [imp, setImp] = useState<HTMLInputElement | null>(null);
  const { place: here } = useContext(PlaceCtx);
  const place = () => here;
  const item = (icon: ReactNode, label: string, sub: string, run: () => void) => (
    <button type="button" onClick={() => (setOpen(null), run())} className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-fg/[0.05]">
      <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-fg/[0.05] text-fg/80 [&_svg]:size-4">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block truncate text-[11.5px] text-muted">{sub}</span>
      </span>
    </button>
  );
  return (
    <>
      <button type="button" onClick={(e) => setOpen(open ? null : e.currentTarget)} aria-haspopup="menu" aria-expanded={!!open} className={clsx("group flex items-center gap-2 rounded-[16px] bg-fg font-semibold text-bg shadow-[0_10px_24px_-12px_rgb(0_0_0/0.55)] transition-transform active:scale-[0.97]", compact ? "h-9 px-3.5 text-[13px]" : "h-12 w-full px-4 text-[14px]")}>
        <Plus className="size-[18px] transition-transform group-aria-expanded:rotate-45" />
        New
      </button>
      {open && (
        <Popover anchor={open} onClose={() => setOpen(null)} className="w-72">
          {item(<FilePlus2 />, "Document", "A blank page to write on", () => create.mutate({ ...place() }))}
          {item(<FileText />, "From a template", "Proposal, NDA, meeting notes…", () => setDialog("templates"))}
          {meta.me.write || place().root === "mine" ? item(<FolderPlus />, "Folder", "Keep things together", () => setDialog("folder")) : null}
          <div className="mx-2 my-1 h-px bg-border" />
          {item(<Upload />, "Upload files", "PDFs, Word, Excel, images… up to 25 MB", () => files?.click())}
          {item(<FolderUp />, "Upload a folder", "With everything inside it", () => folder?.click())}
          {item(<FileUp />, "Import as a document", "Word, Markdown, HTML or text — to edit here", () => imp?.click())}
        </Popover>
      )}
      <input ref={setFiles} type="file" multiple hidden onChange={(e) => (up.upload([...(e.target.files ?? [])], place()), (e.target.value = ""))} />
      <input ref={setFolder} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => (up.upload([...(e.target.files ?? [])], place()), (e.target.value = ""))} />
      <input ref={setImp} type="file" accept=".docx,.md,.markdown,.html,.htm,.txt" hidden onChange={(e) => (e.target.files?.[0] && up.importDoc(e.target.files[0], place()), (e.target.value = ""))} />
      {dialog === "folder" && <FolderDialog place={place()} onClose={() => setDialog(null)} />}
      {dialog === "templates" && <TemplatesDialog place={place()} onClose={() => setDialog(null)} />}
      {up.panel}
    </>
  );
}

function Popover({ anchor, onClose, children, className }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 288;
    const h = box.current?.offsetHeight ?? 300;
    setPos({ top: r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", off), document.removeEventListener("keydown", esc));
  }, [anchor, onClose]);
  return createPortal(
    <div ref={box} role="menu" className={clsx("doc-pop fixed z-[70] rounded-[16px] border border-border bg-[var(--surface-solid)] p-1.5 shadow-[0_22px_50px_-16px_rgb(0_0_0/0.4)]", className)} style={pos ?? { top: -9999, left: -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

function FolderDialog({ place, folder, onClose }: { place: Place; folder?: DriveFolder; onClose: () => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(folder?.color ?? "");
  const save = useMutation({
    mutationFn: () => (folder ? api(`${base}/folder/${folder.id}`, { method: "PATCH", body: { name, color } }) : api(`${base}/folder`, { method: "POST", body: { name, color, ...place } })),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't save the folder", description: errorMessage(e) }),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={folder ? "Rename folder" : "New folder"}
      description={!folder ? (place.folderId ? "Inside the folder you're in — it follows that folder's rules." : place.root === "mine" ? "In My documents: private to you until you share it." : "In Team: everyone on the team can open it.") : undefined}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            {folder ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), name.trim() && save.mutate())} className="grid gap-4">
        <Field label="Name">{(f) => <Input {...f} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Client proposals" maxLength={120} />}</Field>
        <div>
          <p className="mb-2 text-[12.5px] font-medium">Colour</p>
          <div className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button key={c || "default"} type="button" aria-label={c || "Default"} aria-pressed={color === c} onClick={() => setColor(c)} className={clsx("size-8 rounded-full ring-offset-2 ring-offset-bg transition-transform hover:scale-110", color === c && "ring-2 ring-fg")} style={{ background: FOLDER_SWATCH[c] }} />
            ))}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function TemplatesDialog({ place, onClose }: { place: Place; onClose: () => void }) {
  const create = useCreate();
  const groups = [...new Set(DOC_TEMPLATES.map((t) => t.group))];
  return (
    <Dialog open onClose={onClose} title="Start from a template" description="Each one fills in what you'd write anyway. Fields like {{Client name}} are filled in from Tools → Fill in fields." size="xl">
      <div className="grid gap-5">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-2 text-[11.5px] font-semibold tracking-[0.08em] text-subtle uppercase">{g}</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {DOC_TEMPLATES.filter((t) => t.group === g).map((t) => (
                <TemplateCard key={t.id} t={t} busy={create.isPending && create.variables?.templateId === t.id} onClick={() => create.mutate({ templateId: t.id, ...place })} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function TemplateCard({ t, onClick, busy }: { t: (typeof DOC_TEMPLATES)[number]; onClick: () => void; busy?: boolean }) {
  const lines = useMemo(() => {
    const out: { h: boolean; w: number }[] = [];
    for (const n of t.build().content ?? []) {
      if (out.length > 9) break;
      out.push({ h: n.type === "heading", w: n.type === "heading" ? 55 : n.type === "table" ? 100 : 70 + ((out.length * 37) % 30) });
    }
    return out;
  }, [t]);
  return (
    <button type="button" onClick={onClick} disabled={busy} className="drive-tile group flex w-full min-w-0 flex-col overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)] text-left">
      <div className="drive-thumb relative h-[118px] border-b border-border px-5 pt-4">
        <div className="mx-auto h-full w-[78%] rounded-t-[4px] bg-[var(--surface-solid)] px-3 pt-3 shadow-[0_2px_10px_-4px_rgb(0_0_0/0.25)] transition-transform group-hover:-translate-y-1">
          {t.id === "blank" ? (
            <div className="grid h-full place-items-center pb-3 text-fg/20">
              <Plus className="size-8" />
            </div>
          ) : (
            lines.map((l, i) => <div key={i} className={clsx("mb-[5px] rounded-full", l.h ? "h-[5px] bg-fg/45" : "h-[3px] bg-fg/15")} style={{ width: `${l.w}%` }} />)
          )}
        </div>
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-bg/60">
            <Loader2 className="size-5 animate-spin" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-start gap-2 p-3">
        <span className="text-[18px] leading-none">{t.icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">{t.name}</span>
          <span className="block truncate text-[11.5px] text-muted">{t.line}</span>
        </span>
      </div>
    </button>
  );
}

// ── Uploading ───────────────────────────────────────────────────────────────

type Job = { id: string; name: string; state: "waiting" | "uploading" | "done" | "failed"; error?: string; pct: number };

/** Uploads files (recreating folders when a folder is dropped or picked), with a progress panel. */
function useUploader() {
  const base = useDocsBase();
  const refresh = useDriveRefresh();
  const toast = useToast();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const update = (id: string, j: Partial<Job>) => setJobs((xs) => xs.map((x) => (x.id === id ? { ...x, ...j } : x)));
  const send = (path: string, form: FormData, onPct: (n: number) => void) =>
    new Promise<unknown>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", path);
      x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
      x.onload = () => {
        const body = (() => {
          try {
            return JSON.parse(x.responseText);
          } catch {
            return {};
          }
        })();
        if (x.status >= 200 && x.status < 300) resolve(body);
        else reject(new Error(body?.error?.message ?? "Upload failed"));
      };
      x.onerror = () => reject(new Error("You're offline, or the upload was interrupted"));
      x.send(form);
    });
  const upload = async (list: File[], place: Place) => {
    if (!list.length) return;
    const made = new Map<string, string>();
    const folderFor = async (path: string[]): Promise<string | null> => {
      let parent = place.folderId;
      for (let i = 0; i < path.length; i++) {
        const key = path.slice(0, i + 1).join("/");
        if (!made.has(key)) {
          const r = await api<{ folder: { id: string } }>(`${base}/folder`, { method: "POST", body: { name: path[i], folderId: parent, root: place.root } });
          made.set(key, r.folder.id);
        }
        parent = made.get(key)!;
      }
      return parent;
    };
    const batch = list.map((f) => ({ f, id: Math.random().toString(36).slice(2), rel: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || "").split("/").slice(0, -1) }));
    setJobs((xs) => [...xs.filter((x) => x.state !== "done"), ...batch.map((b) => ({ id: b.id, name: b.f.name, state: "waiting" as const, pct: 0 }))]);
    for (const b of batch) {
      if (b.f.size > MAX_FILE_BYTES) {
        update(b.id, { state: "failed", error: "Larger than 25 MB" });
        continue;
      }
      update(b.id, { state: "uploading" });
      try {
        const folderId = b.rel.length ? await folderFor(b.rel) : place.folderId;
        const form = new FormData();
        form.append("file", b.f);
        form.append("meta", JSON.stringify({ title: b.f.name.replace(/\.[^.]+$/, "").slice(0, 200), folderId, root: place.root }));
        await send(`${base}/files`, form, (pct) => update(b.id, { pct }));
        update(b.id, { state: "done", pct: 100 });
      } catch (e) {
        update(b.id, { state: "failed", error: errorMessage(e) });
      }
    }
    refresh();
  };
  const importDoc = async (f: File, place: Place) => {
    const id = Math.random().toString(36).slice(2);
    setJobs((xs) => [...xs, { id, name: `Converting ${f.name}`, state: "uploading", pct: 0 }]);
    const form = new FormData();
    form.append("file", f);
    form.append("meta", JSON.stringify(place));
    try {
      const r = (await send(`${base}/docs/import`, form, (pct) => update(id, { pct }))) as { file: DriveFile };
      update(id, { state: "done", pct: 100 });
      refresh();
      router.push(`/documents/d/${r.file.id}`);
    } catch (e) {
      update(id, { state: "failed", error: errorMessage(e) });
      toast({ tone: "error", title: "Couldn't import that file", description: errorMessage(e) });
    }
  };
  const done = jobs.filter((j) => j.state === "done").length;
  const panel = jobs.length ? (
    <div className="doc-pop fixed right-4 bottom-[calc(var(--dock)+16px)] z-[65] w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)] shadow-[0_22px_50px_-16px_rgb(0_0_0/0.45)]" role="status" aria-live="polite">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <p className="min-w-0 flex-1 text-[13px] font-semibold">{done === jobs.length ? `${done} uploaded` : `Uploading ${done + 1} of ${jobs.length}`}</p>
        {jobs.every((j) => j.state === "done" || j.state === "failed") && (
          <button type="button" aria-label="Close" onClick={() => setJobs([])} className="grid size-7 place-items-center rounded-full text-muted hover:bg-fg/[0.06]">
            <X className="size-4" />
          </button>
        )}
      </div>
      <ul className="max-h-60 overflow-y-auto p-1.5">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px]">{j.name}</span>
              {j.state === "failed" ? <span className="block truncate text-[11px] text-danger">{j.error}</span> : <span className="mt-1 block h-1 overflow-hidden rounded-full bg-fg/[0.07]"><span className="block h-full rounded-full bg-[#7c5cdb] transition-[width]" style={{ width: `${j.pct}%` }} /></span>}
            </span>
            <span className="w-8 text-right text-[11px] text-muted tabular-nums">{j.state === "done" ? "✓" : j.state === "failed" ? "!" : `${j.pct}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
  return { upload, importDoc, panel };
}

// ── Home ────────────────────────────────────────────────────────────────────

export function DriveHome({ meta }: { meta: DocsMeta }) {
  const { org, user } = useSession();
  const base = useDocsBase();
  const create = useCreate();
  const [templates, setTemplates] = useState(false);
  const recent = useQuery({ queryKey: ["drive", org.id, "recent"], queryFn: () => api<{ files: (DriveFile & { openedAt: string })[] }>(`${base}/recent?limit=8`) });
  const starred = useQuery({ queryKey: ["drive", org.id, "list", "starred"], queryFn: () => api<Listing>(`${base}/drive?section=starred`) });
  usePlace(HOME_PLACE);
  const hour = new Date().getHours();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-muted">{hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {user.name.split(" ")[0]}</p>
          <h1 className="title-xl mt-0.5">Documents</h1>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="min-w-0 flex-1 sm:flex-none">
            <DriveSearch />
          </div>
          <span className="lg:hidden">
            <NewButton meta={meta} compact />
          </span>
        </div>
      </header>
      <section aria-labelledby="start">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="start" className="text-[15px] font-semibold">Start a new document</h2>
          <button type="button" onClick={() => setTemplates(true)} className="text-[12.5px] font-medium text-muted hover:text-fg">
            All templates
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2.5 pb-2 lg:grid-cols-5 max-sm:-mx-4 max-sm:flex max-sm:snap-x max-sm:scroll-px-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:[scrollbar-width:none]">
          {DOC_TEMPLATES.slice(0, 5).map((t, i) => (
            <div key={t.id} className={clsx("min-w-0 max-sm:w-[36vw] max-sm:shrink-0 max-sm:snap-start", i > 2 && "sm:max-lg:hidden")}>
              <TemplateCard t={t} busy={create.isPending && create.variables?.templateId === t.id} onClick={() => create.mutate({ templateId: t.id, folderId: null, root: "mine" })} />
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-3 text-[15px] font-semibold">Recent</h2>
        {!recent.data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-[16px]" />
            ))}
          </div>
        ) : recent.data.files.length ? (
          <>
            <PhoneList files={recent.data.files} sub={(f) => `Opened ${ago((f as DriveFile & { openedAt: string }).openedAt)}`} />
            <div className="grid grid-cols-2 gap-3 max-sm:hidden sm:grid-cols-3 xl:grid-cols-4">
              {recent.data.files.map((f) => (
                <FileCard key={f.id} f={f} sub={`Opened ${ago(f.openedAt)}`} />
              ))}
            </div>
          </>
        ) : (
          <EmptyDrive icon={<Clock />} title="Nothing opened yet" line="Documents and files you open show up here, so you can get back to them." />
        )}
      </section>
      {!!starred.data?.files.length && (
        <section aria-labelledby="starred">
          <h2 id="starred" className="mb-3 text-[15px] font-semibold">Starred</h2>
          <PhoneList files={starred.data.files.slice(0, 8)} />
          <div className="grid grid-cols-2 gap-3 max-sm:hidden sm:grid-cols-3 xl:grid-cols-4">
            {starred.data.files.slice(0, 8).map((f) => (
              <FileCard key={f.id} f={f} />
            ))}
          </div>
        </section>
      )}
      {templates && <TemplatesDialog place={{ folderId: null, root: "mine" }} onClose={() => setTemplates(false)} />}
    </div>
  );
}

/** Phones: files as rows, like a native file app (previews are too small to read there). */
function PhoneList({ files, sub }: { files: DriveFile[]; sub?: (f: DriveFile) => string }) {
  return (
    <div className="overflow-hidden rounded-[16px] bg-[var(--surface-solid)] ring-1 ring-border ring-inset sm:hidden">
      {files.map((f) => (
        <Link key={f.id} href={hrefOf(f)} className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 active:bg-fg/[0.04]">
          <FileGlyph f={f} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{f.title}</span>
            <span className="block truncate text-[12px] text-muted">{sub ? sub(f) : `${KIND_LABEL[kindOf(f)]} · ${ago(f.updatedAt)}`}</span>
          </span>
          {f.starred && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
          <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
        </Link>
      ))}
    </div>
  );
}

/** A simple card (Home and pickers): a preview of the first lines, or the file's kind. */
function FileCard({ f, sub }: { f: DriveFile; sub?: string }) {
  return (
    <Link href={hrefOf(f)} className="drive-tile group flex flex-col overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)]">
      <Thumb f={f} />
      <div className="flex items-center gap-2.5 p-3">
        <FileGlyph f={f} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{f.title}</span>
          <span className="block truncate text-[11.5px] text-muted">{sub ?? `Edited ${ago(f.updatedAt)}`}</span>
        </span>
      </div>
    </Link>
  );
}

function Thumb({ f }: { f: DriveFile }) {
  const base = useDocsBase();
  const k = kindOf(f);
  return (
    <div className="drive-thumb relative h-[120px] overflow-hidden border-b border-border">
      {k === "doc" ? (
        <div className="mx-auto mt-3.5 h-full w-[76%] rounded-t-[4px] bg-[var(--surface-solid)] px-3 pt-3 shadow-[0_2px_10px_-4px_rgb(0_0_0/0.25)] transition-transform group-hover:-translate-y-0.5">
          <p className="mb-1 truncate text-[8px] font-bold text-fg/70">{f.title}</p>
          <p className="drive-thumb-text line-clamp-[8]">{f.snippet || "Empty document"}</p>
        </div>
      ) : k === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- the drive's own private file, not a static asset
        <img src={`${base}/files/${f.id}/download?inline=1`} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full place-items-center">
          <FileGlyph f={f} size={52} />
        </div>
      )}
      {f.starred && <Star className="absolute top-2 right-2 size-3.5 fill-amber-400 text-amber-400" />}
    </div>
  );
}

function EmptyDrive({ icon, title, line, action }: { icon: ReactNode; title: string; line: string; action?: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-dashed border-border px-6 py-12 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-fg/[0.05] text-fg/40 [&_svg]:size-6">{icon}</span>
      <p className="mt-3 text-[14px] font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted">{line}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

function DriveSearch({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form onSubmit={(e) => (e.preventDefault(), q.trim() && router.push(`/documents/search?q=${encodeURIComponent(q.trim())}`))} className="flex h-10 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-[var(--surface-solid)] px-3.5 focus-within:border-fg/25 sm:w-[300px]" role="search">
      <Search className="size-4 shrink-0 text-muted" aria-hidden />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents and files" aria-label="Search documents" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
      {q && (
        <button type="button" aria-label="Clear" onClick={() => setQ("")} className="text-muted">
          <X className="size-3.5" />
        </button>
      )}
    </form>
  );
}

// ── A section or folder ─────────────────────────────────────────────────────

const TITLES: Record<string, [string, string]> = {
  mine: ["My documents", "Private to you until you share them."],
  team: ["Team", "Folders and files for the workspace, by each folder's rules."],
  shared: ["Shared with me", "Documents, files and folders people have shared with you."],
  starred: ["Starred", "Your shortcuts to what matters most."],
  recent: ["Recent", "What you've opened lately."],
  trash: ["Trash", `Things here are deleted for good after ${TRASH_DAYS} days.`],
  search: ["Search", "Titles, text inside documents, file names and tags."],
};

type Sort = "name" | "updated" | "size";
type Sel = { files: Set<string>; folders: Set<string> };
const none = (): Sel => ({ files: new Set(), folders: new Set() });


function useStoredView() {
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return (localStorage.getItem("cc.drive.view") as "grid" | "list") || "grid";
    } catch {
      return "grid";
    }
  });
  const set = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem("cc.drive.view", v);
    } catch {
      /* private mode */
    }
  };
  return [view, set] as const;
}

export function DriveView({ section, folderId, q: query, meta }: { section: string; folderId?: string; q?: string; meta: DocsMeta }) {
  const { org } = useSession();
  const base = useDocsBase();
  const router = useRouter();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const chat = useShareToChat();
  const [view, setView] = useStoredView();
  // Phones always list files: thumbnails are too small to tell documents apart.
  const phone = usePhone();
  const [sort, setSort] = useState<Sort>(section === "recent" || section === "starred" || section === "shared" ? "updated" : "name");
  const [type, setType] = useState("");
  const [owner, setOwner] = useState("");
  const [modified, setModified] = useState("");
  const [filters, setFilters] = useState(false);
  const [sel, setSel] = useState<Sel>(none);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: { file?: DriveFile; folder?: DriveFolder } } | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "rename"; file?: DriveFile; folder?: DriveFolder } | { kind: "move" | "copy" } | { kind: "share"; file?: DriveFile; folder?: DriveFolder } | { kind: "folder" } | { kind: "purge" }>(null);
  const [preview, setPreview] = useState<DriveFile | null>(null);
  const [tool, setTool] = useState<{ kind: "qr" | "convert" | "pdf" | "stay" | "activity"; file: DriveFile } | null>(null);
  const [dropQr, setDropQr] = useState(false);
  const [details, setDetails] = useState(false);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const up = useUploader();
  const sectionKey = section === "folder" ? `folder:${folderId}` : section === "search" ? `search:${query}` : section;
  const params = new URLSearchParams({ section: section === "search" ? "search" : section, ...(folderId ? { folderId } : {}), ...(query ? { q: query } : {}), ...(type ? { type } : {}), ...(owner ? { owner } : {}), ...(modified ? { modified } : {}) });
  const list = useQuery({ queryKey: ["drive", org.id, "list", sectionKey, type, owner, modified], queryFn: () => api<Listing & { qrLive?: boolean }>(`${base}/drive?${params}`), placeholderData: (p) => (p?.section === (section === "search" ? "search" : section) ? p : undefined), refetchInterval: (q) => (q.state.data?.qrLive ? 5000 : false) });
  const data = list.data;
  const place: Place = section === "folder" && folderId ? { folderId, root: data?.path.root === "mine" ? "mine" : "team" } : { folderId: null, root: section === "team" ? "team" : "mine" };
  usePlace(place);
  const canAdd = section === "mine" || (section === "team" && meta.me.write) || (section === "folder" && data?.folder?.role === "edit");
  const trash = section === "trash";

  const folders = useMemo(() => [...(data?.folders ?? [])].sort((a, b) => (sort === "updated" ? b.createdAt.localeCompare(a.createdAt) : a.name.localeCompare(b.name))), [data, sort]);
  const files = useMemo(() => [...(data?.files ?? [])].sort((a, b) => (sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "size" ? b.size - a.size : a.title.localeCompare(b.title))), [data, sort]);
  const order = useMemo(() => [...folders.map((f) => `d:${f.id}`), ...files.map((f) => `f:${f.id}`)], [folders, files]);
  const count = sel.files.size + sel.folders.size;
  const selectedFiles = files.filter((f) => sel.files.has(f.id));
  const selectedFolders = folders.filter((f) => sel.folders.has(f.id));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new place starts with nothing selected
    setSel(none());
    setPreview(null);
  }, [sectionKey]);

  const open = (f: DriveFile) => (f.kind === "doc" ? router.push(`/documents/d/${f.id}`) : setPreview(f));
  const key = (id: string, folder: boolean) => `${folder ? "d" : "f"}:${id}`;
  const pick = (id: string, folder: boolean, e: React.MouseEvent | React.KeyboardEvent) => {
    const k = key(id, folder);
    const next: Sel = { files: new Set(sel.files), folders: new Set(sel.folders) };
    const bag = (kk: string) => (kk.startsWith("d:") ? next.folders : next.files);
    if (e.shiftKey && anchor) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(k)].sort((x, y) => x - y);
      for (const kk of order.slice(a, b + 1)) bag(kk).add(kk.slice(2));
    } else if (e.metaKey || e.ctrlKey) {
      if (bag(k).has(id)) bag(k).delete(id);
      else bag(k).add(id);
      setAnchor(k);
    } else {
      next.files.clear();
      next.folders.clear();
      bag(k).add(id);
      setAnchor(k);
    }
    setSel(next);
  };

  const run = useMutation({
    mutationFn: (x: { path: string; body: unknown; ok: string }) => api<Record<string, number>>(`${base}/${x.path}`, { method: "POST", body: x.body }).then((r) => ({ r, ok: x.ok })),
    onSuccess: ({ ok }) => {
      toast({ tone: "success", title: ok });
      setSel(none());
      refresh();
    },
    onError: (e) => toast({ tone: "error", title: "That didn't work", description: errorMessage(e) }),
  });
  const items = (fs: DriveFile[], ds: DriveFolder[]) => ({ files: fs.map((f) => f.id), folders: ds.map((f) => f.id) });
  const doTrash = (fs: DriveFile[], ds: DriveFolder[]) => run.mutate({ path: "trash", body: items(fs, ds), ok: `Moved ${fs.length + ds.length === 1 ? "it" : `${fs.length + ds.length} items`} to the trash` });
  const doRestore = (fs: DriveFile[], ds: DriveFolder[]) => run.mutate({ path: "restore", body: items(fs, ds), ok: "Restored" });
  const doStar = async (id: string, kind: "file" | "folder", on: boolean) => {
    await api(`${base}/star`, { method: "POST", body: { id, kind, on } }).catch((e) => toast({ tone: "error", title: "Couldn't star it", description: errorMessage(e) }));
    refresh();
  };
  const download = (f: DriveFile) => downloadUrl(f.kind === "doc" ? `${base}/docs/${f.id}/export?format=pdf` : `${base}/files/${f.id}/download`);
  const copyLink = async (f: DriveFile) => {
    await navigator.clipboard.writeText(`${window.location.origin}${hrefOf(f)}`).catch(() => {});
    toast({ tone: "success", title: "Link copied", description: "People who can open it can use this link." });
  };
  const copyFile = useMutation({
    mutationFn: (f: DriveFile) => api(`${base}/files/${f.id}/copy`, { method: "POST", body: {} }),
    onSuccess: () => (toast({ tone: "success", title: "Copy made" }), refresh()),
    onError: (e) => toast({ tone: "error", title: "Couldn't make a copy", description: errorMessage(e) }),
  });

  // Keyboard: Delete, F2, ⌘A, Enter, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || document.querySelector("dialog[open]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSel({ files: new Set(files.map((f) => f.id)), folders: new Set(folders.map((f) => f.id)) });
      } else if (e.key === "Escape") setSel(none());
      else if ((e.key === "Delete" || e.key === "Backspace") && count && !trash) {
        e.preventDefault();
        doTrash(selectedFiles.filter((f) => f.role === "edit"), selectedFolders.filter((f) => f.role === "edit"));
      } else if (e.key === "F2" && count === 1) {
        e.preventDefault();
        setDialog({ kind: "rename", file: selectedFiles[0], folder: selectedFolders[0] });
      } else if (e.key === "Enter" && count === 1) {
        if (selectedFiles[0]) open(selectedFiles[0]);
        else if (selectedFolders[0]) router.push(`/documents/folder/${selectedFolders[0].id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Dragging items onto a folder moves them; dropping files from the computer uploads them.
  const dragStart = (e: React.DragEvent, id: string, folder: boolean) => {
    const k = key(id, folder);
    const s = (folder ? sel.folders : sel.files).has(id) ? sel : { files: new Set(folder ? [] : [id]), folders: new Set(folder ? [id] : []) };
    if (!(folder ? sel.folders : sel.files).has(id)) {
      setSel(s);
      setAnchor(k);
    }
    e.dataTransfer.setData("application/x-cloudesk-drive", JSON.stringify({ files: [...s.files], folders: [...s.folders] }));
    e.dataTransfer.effectAllowed = "move";
  };
  const dropOn = async (e: React.DragEvent, target: { folderId: string | null; root: "mine" | "team" }) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOver(null);
    const raw = e.dataTransfer.getData("application/x-cloudesk-drive");
    if (raw) {
      const it = JSON.parse(raw) as { files: string[]; folders: string[] };
      if (target.folderId && it.folders.includes(target.folderId)) return;
      run.mutate({ path: "move", body: { ...it, ...target }, ok: "Moved" });
    } else if (e.dataTransfer.files.length) {
      if (!canAdd && !target.folderId) return toast({ tone: "error", title: "You can't add files here" });
      await up.upload(await filesFromDrop(e.dataTransfer), target);
    }
  };

  const fileMenu = (f: DriveFile): MenuEntry[] =>
    trash
      ? [
          { label: "Restore", icon: <RotateCcw />, run: () => doRestore([f], []) },
          { label: "Delete for good", icon: <Trash2 />, danger: true, run: () => (setSel({ files: new Set([f.id]), folders: new Set() }), setDialog({ kind: "purge" })) },
        ]
      : [
          { label: f.kind === "doc" ? "Open" : "Preview", icon: <Eye />, run: () => open(f) },
          ...(f.kind === "file" ? [{ label: "Details & versions", icon: <Info />, run: () => router.push(`/documents/file/${f.id}`) }] : []),
          ...(f.kind === "file" && f.mime === "application/pdf" ? [{ label: "PDF tools", icon: <Wrench />, run: () => setTool({ kind: "pdf", file: f }) }] : []),
          ...(f.kind === "doc" || targetsFor(familyOf(f)).length || ["pdf", "image"].includes(familyOf(f)) ? [{ label: "Convert to…", icon: <FileCog />, run: () => setTool({ kind: "convert", file: f }) }] : []),
          { label: "QR code", icon: <QrCode />, run: () => setTool({ kind: "qr", file: f }) },
          { label: "Activity", icon: <History />, run: () => setTool({ kind: "activity", file: f }) },
          { label: f.deleteAt ? "Change when it's deleted" : "Delete automatically…", icon: <Timer />, run: () => setTool({ kind: "stay", file: f }), disabled: f.role !== "edit" },
          "sep",
          { label: "Share", icon: <Share2 />, run: () => setDialog({ kind: "share", file: f }), disabled: f.role !== "edit" },
          { label: "Copy link", icon: <Link2 />, run: () => copyLink(f) },
          ...(chat.available ? [{ label: "Share to chat", icon: <Users />, run: () => chat.share({ kind: "documents", id: f.id, title: f.title, sub: f.kind === "doc" ? `${f.words} words` : KIND_LABEL[kindOf(f)], link: hrefOf(f), module: "Document" }) }] : []),
          "sep",
          { label: "Rename", icon: <Pencil />, run: () => setDialog({ kind: "rename", file: f }), disabled: f.role !== "edit" },
          { label: "Move to…", icon: <FolderInput />, run: () => (setSel({ files: new Set([f.id]), folders: new Set() }), setDialog({ kind: "move" })), disabled: f.role !== "edit" },
          { label: "Make a copy", icon: <Copy />, run: () => copyFile.mutate(f) },
          { label: f.starred ? "Remove star" : "Star", icon: <Star />, run: () => doStar(f.id, "file", !f.starred) },
          { label: f.kind === "doc" ? "Download as PDF" : "Download", icon: <Download />, run: () => download(f) },
          ...(f.kind === "doc" ? [{ label: "Download as Word", icon: <Download />, run: () => downloadUrl(`${base}/docs/${f.id}/export?format=docx`) }] : []),
          "sep",
          { label: "Move to trash", icon: <Trash2 />, danger: true, run: () => doTrash([f], []), disabled: f.role !== "edit" },
        ];
  const folderMenu = (f: DriveFolder): MenuEntry[] =>
    trash
      ? [
          { label: "Restore", icon: <RotateCcw />, run: () => doRestore([], [f]) },
          { label: "Delete for good", icon: <Trash2 />, danger: true, run: () => (setSel({ files: new Set(), folders: new Set([f.id]) }), setDialog({ kind: "purge" })) },
        ]
      : [
          { label: "Open", icon: <Eye />, run: () => router.push(`/documents/folder/${f.id}`) },
          { label: "Share", icon: <Share2 />, run: () => setDialog({ kind: "share", folder: f }), disabled: f.role !== "edit" },
          "sep",
          { label: "Rename & colour", icon: <Pencil />, run: () => setDialog({ kind: "rename", folder: f }), disabled: f.role !== "edit" },
          { label: "Move to…", icon: <FolderInput />, run: () => (setSel({ files: new Set(), folders: new Set([f.id]) }), setDialog({ kind: "move" })), disabled: f.role !== "edit" },
          { label: f.starred ? "Remove star" : "Star", icon: <Star />, run: () => doStar(f.id, "folder", !f.starred) },
          "sep",
          { label: "Move to trash", icon: <Trash2 />, danger: true, run: () => doTrash([], [f]), disabled: f.role !== "edit" },
        ];
  const ctx = (e: React.MouseEvent, target: { file?: DriveFile; folder?: DriveFolder }) => {
    e.preventDefault();
    const id = target.file?.id ?? target.folder!.id;
    if (!(target.file ? sel.files : sel.folders).has(id)) setSel({ files: new Set(target.file ? [id] : []), folders: new Set(target.folder ? [id] : []) });
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  const [title, line] = section === "folder" ? [data?.folder?.name ?? "Folder", ""] : (TITLES[section] ?? ["Documents", ""]);
  const rootLabel = data?.path.root === "mine" ? "My documents" : data?.path.root === "shared" ? "Shared with me" : "Team";
  const empty = data && !folders.length && !files.length;
  const touch = useRef(false);

  return (
    <div
      className={clsx("relative min-h-[60vh] rounded-[22px]", dropOver === "here" && "drive-drop")}
      onDragOver={(e) => {
        if (trash || !canAdd || e.dataTransfer.types.includes("application/x-cloudesk-drive")) return;
        e.preventDefault();
        setDropOver("here");
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropOver(null)}
      onDrop={(e) => !trash && canAdd && dropOn(e, place)}
      onClick={(e) => e.target === e.currentTarget && setSel(none())}
    >
      {/* Header */}
      <header className="mb-4 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {section === "folder" && data && (
              <nav aria-label="Breadcrumb" className="mb-1 flex min-w-0 flex-wrap items-center gap-1 text-[12.5px] text-muted">
                <Link
                  href={`/documents/${data.path.root}`}
                  className="hover:text-fg hover:underline"
                  onDragOver={(e) => (e.preventDefault(), setDropOver("root"))}
                  onDrop={(e) => data.path.root !== "shared" && dropOn(e, { folderId: null, root: data.path.root === "mine" ? "mine" : "team" })}
                >
                  {rootLabel}
                </Link>
                {data.path.crumbs.slice(0, -1).map((c) => (
                  <span key={c.id} className="inline-flex min-w-0 items-center gap-1">
                    <ChevronRight className="size-3" />
                    <Link href={`/documents/folder/${c.id}`} className="max-w-[160px] truncate hover:text-fg hover:underline" onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropOn(e, { folderId: c.id, root: data.path.root === "mine" ? "mine" : "team" })}>
                      {c.name}
                    </Link>
                  </span>
                ))}
              </nav>
            )}
            <h1 className="flex min-w-0 items-center gap-2.5 text-[24px] font-bold tracking-[-0.02em]">
              {section === "folder" && data?.folder && <FolderGlyph f={data.folder} size={30} />}
              <span className="truncate">{section === "search" ? `“${query}”` : title}</span>
              {section === "folder" && data?.folder?.shared && <Users className="size-4 text-muted" aria-label="Shared" />}
            </h1>
            {line && <p className="mt-0.5 text-[12.5px] text-muted">{line}</p>}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="min-w-0 flex-1 sm:flex-none">
              <DriveSearch key={query} initial={query ?? ""} />
            </div>
            {canAdd && (
              <span className="lg:hidden">
                <NewButton meta={meta} compact />
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {section === "folder" && data?.folder?.role === "edit" && (
            <Button size="sm" icon={<Share2 className="size-3.5" />} onClick={() => setDialog({ kind: "share", folder: data.folder! })}>
              Share folder
            </Button>
          )}
          {canAdd && (
            <Button size="sm" variant="ghost" icon={<FolderPlus className="size-3.5" />} onClick={() => setDialog({ kind: "folder" })} className="max-sm:hidden">
              New folder
            </Button>
          )}
          {canAdd && (section === "folder" || section === "team" || section === "mine") && (
            <Button size="sm" variant={data?.qrLive ? "secondary" : "ghost"} icon={<QrCode className="size-3.5" />} onClick={() => setDropQr(true)}>
              Drive QR{data?.qrLive ? " · on" : ""}
            </Button>
          )}
          {trash && (data?.files.length || data?.folders.length) ? (
            <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => (setSel({ files: new Set(files.map((f) => f.id)), folders: new Set(folders.map((f) => f.id)) }), setDialog({ kind: "purge" }))}>
              Empty trash
            </Button>
          ) : null}
          <span className="flex-1" />
          <button type="button" onClick={() => setFilters((f) => !f)} aria-pressed={filters || !!(type || owner || modified)} className={clsx("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium", filters || type || owner || modified ? "border-[#7c5cdb]/50 bg-[#7c5cdb]/10 text-[#6a48d6]" : "border-border text-muted hover:text-fg")}>
            <SlidersHorizontal className="size-3.5" /> Filters{[type, owner, modified].filter(Boolean).length ? ` · ${[type, owner, modified].filter(Boolean).length}` : ""}
          </button>
          <label className="inline-flex h-8 items-center gap-1 rounded-full border border-border pr-1 pl-2.5 text-[12.5px] text-muted">
            <ArrowDownAZ className="size-3.5" aria-hidden />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by" className="bg-transparent pr-1 font-medium text-fg outline-none">
              <option value="name">Name</option>
              <option value="updated">Last changed</option>
              <option value="size">Size</option>
            </select>
          </label>
          <div className="flex rounded-full border border-border p-0.5 max-sm:hidden" role="radiogroup" aria-label="View">
            {(
              [
                ["grid", <Grid2x2 key="g" className="size-3.5" />, "Grid"],
                ["list", <LayoutList key="l" className="size-3.5" />, "List"],
              ] as const
            ).map(([v, icon, label]) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} aria-label={label} onClick={() => setView(v)} className={clsx("grid size-7 place-items-center rounded-full", view === v ? "bg-fg text-bg" : "text-muted hover:text-fg")}>
                {icon}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setDetails((d) => !d)} aria-pressed={details} aria-label="Details" className={clsx("hidden size-8 place-items-center rounded-full border border-border xl:grid", details ? "bg-fg text-bg" : "text-muted hover:text-fg")}>
            <Info className="size-3.5" />
          </button>
        </div>
        {filters && (
          <div className="flex flex-wrap gap-2 rounded-[16px] border border-border bg-[var(--surface-solid)] p-2.5">
            <Chips label="Type" value={type} onChange={setType} options={[["", "Any"], ["doc", "Documents"], ["pdf", "PDFs"], ["word", "Word"], ["sheet", "Spreadsheets"], ["image", "Images"], ["slides", "Presentations"], ["other", "Other"]]} />
            <Chips label="Owner" value={owner} onChange={setOwner} options={[["", "Anyone"], ["me", "Me"], ["others", "Others"]]} />
            <Chips label="Changed" value={modified} onChange={setModified} options={[["", "Any time"], ["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"]]} />
          </div>
        )}
      </header>

      {/* Selection */}
      {count > 0 && (
        <div className="sticky top-[calc(var(--bar)+8px)] z-20 mb-3 flex items-center gap-1 rounded-[16px] bg-fg px-2 py-1.5 text-bg shadow-[0_14px_34px_-14px_rgb(0_0_0/0.6)]" role="toolbar" aria-label="Selected items">
          <button type="button" aria-label="Clear selection" onClick={() => setSel(none())} className="grid size-8 place-items-center rounded-full hover:bg-bg/15">
            <X className="size-4" />
          </button>
          <span className="mr-auto pl-1 text-[13px] font-semibold tabular-nums">{count} selected</span>
          {trash ? (
            <>
              <SelBtn icon={<RotateCcw />} label="Restore" onClick={() => doRestore(selectedFiles, selectedFolders)} />
              <SelBtn icon={<Trash2 />} label="Delete for good" onClick={() => setDialog({ kind: "purge" })} />
            </>
          ) : (
            <>
              {count === 1 && <SelBtn icon={<Share2 />} label="Share" onClick={() => setDialog({ kind: "share", file: selectedFiles[0], folder: selectedFolders[0] })} />}
              <SelBtn icon={<FolderInput />} label="Move" onClick={() => setDialog({ kind: "move" })} />
              {selectedFiles.length > 0 && !selectedFolders.length && <SelBtn icon={<Download />} label="Download" onClick={() => selectedFiles.forEach((f, i) => setTimeout(() => download(f), i * 400))} />}
              <SelBtn icon={<Trash2 />} label="Trash" onClick={() => doTrash(selectedFiles.filter((f) => f.role === "edit"), selectedFolders.filter((f) => f.role === "edit"))} />
            </>
          )}
        </div>
      )}

      <div className="flex gap-5">
        <div className="min-w-0 flex-1">
          {list.isError ? (
            <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
          ) : !data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} className="h-44 rounded-[16px]" />
              ))}
            </div>
          ) : empty ? (
            trash ? (
              <EmptyDrive icon={<Trash2 />} title="The trash is empty" line={`Things you delete wait here for ${TRASH_DAYS} days, so you can bring them back.`} />
            ) : section === "search" ? (
              <EmptyDrive icon={<Search />} title="Nothing matches" line="Try another word — searches look inside written documents too." />
            ) : section === "shared" ? (
              <EmptyDrive icon={<Users />} title="Nothing shared with you yet" line="When someone shares a document or folder with you, it appears here." />
            ) : section === "starred" ? (
              <EmptyDrive icon={<Star />} title="No stars yet" line="Star documents and folders to find them in a click." />
            ) : (
              <EmptyDrive icon={<FilePlus2 />} title={section === "folder" ? "This folder is empty" : "Nothing here yet"} line={canAdd ? "Create a document, add a folder, or drop files here from your computer." : "Nothing you can open is here."} action={canAdd ? <NewButton meta={meta} compact /> : undefined} />
            )
          ) : view === "grid" && !phone ? (
            <div className="grid gap-5">
              {folders.length > 0 && (
                <div>
                  <p className="mb-2 text-[12px] font-semibold text-muted">Folders</p>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {folders.map((f) => (
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        draggable={!trash && f.role === "edit"}
                        onDragStart={(e) => dragStart(e, f.id, true)}
                        onDragOver={(e) => (e.preventDefault(), setDropOver(f.id))}
                        onDragLeave={() => setDropOver((d) => (d === f.id ? null : d))}
                        onDrop={(e) => !trash && f.role === "edit" && dropOn(e, { folderId: f.id, root: place.root })}
                        onPointerDown={(e) => (touch.current = e.pointerType === "touch")}
                        onClick={(e) => (touch.current && !count ? router.push(`/documents/folder/${f.id}`) : pick(f.id, true, e))}
                        onDoubleClick={() => !trash && router.push(`/documents/folder/${f.id}`)}
                        onKeyDown={(e) => e.key === " " && (e.preventDefault(), pick(f.id, true, e))}
                        onContextMenu={(e) => ctx(e, { folder: f })}
                        data-selected={sel.folders.has(f.id)}
                        className={clsx("drive-tile flex cursor-default items-center gap-3 rounded-[14px] border border-border bg-[var(--surface-solid)] p-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-[#7c5cdb]/50", dropOver === f.id && "drive-drop")}
                      >
                        <FolderGlyph f={f} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{f.name}</span>
                          <span className="block truncate text-[11.5px] text-muted">
                            {f.items} item{f.items === 1 ? "" : "s"}
                            {f.shared ? " · Shared" : ""}
                          </span>
                        </span>
                        {f.starred && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                        <ItemMenu entries={folderMenu(f)} label={`${f.name} options`} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {files.length > 0 && (
                <div>
                  {folders.length > 0 && <p className="mb-2 text-[12px] font-semibold text-muted">Files</p>}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {files.map((f) => (
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        draggable={!trash && f.role === "edit"}
                        onDragStart={(e) => dragStart(e, f.id, false)}
                        onPointerDown={(e) => (touch.current = e.pointerType === "touch")}
                        onClick={(e) => (touch.current && !count && !trash ? open(f) : pick(f.id, false, e))}
                        onDoubleClick={() => !trash && open(f)}
                        onKeyDown={(e) => e.key === " " && (e.preventDefault(), pick(f.id, false, e))}
                        onContextMenu={(e) => ctx(e, { file: f })}
                        data-selected={sel.files.has(f.id)}
                        className="drive-tile group flex cursor-default flex-col overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)] outline-none select-none focus-visible:ring-2 focus-visible:ring-[#7c5cdb]/50"
                      >
                        <Thumb f={f} />
                        <div className="flex items-center gap-2 p-2.5 pl-3">
                          <FileGlyph f={f} size={24} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{f.title}</span>
                            <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted"><DropBadges f={f} /><span className="truncate">{trash && f.deletedAt ? `Deleted ${ago(f.deletedAt)}` : `${f.mine ? "You" : f.owner.split(" ")[0]} · ${ago(f.updatedAt)}`}</span></span>
                          </span>
                          <ItemMenu entries={fileMenu(f)} label={`${f.title} options`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-[16px] border border-border bg-[var(--surface-solid)]" role="grid" aria-label="Files">
              <div className="hidden grid-cols-[minmax(0,1fr)_140px_120px_90px_40px] gap-3 border-b border-border px-4 py-2 text-[11.5px] font-semibold text-muted md:grid" role="row">
                <span>Name</span>
                <span>Owner</span>
                <span>{trash ? "Deleted" : "Last changed"}</span>
                <span>Size</span>
                <span />
              </div>
              {[...folders.map((f): { file?: DriveFile; folder?: DriveFolder } => ({ folder: f })), ...files.map((f): { file?: DriveFile; folder?: DriveFolder } => ({ file: f }))].map((row) => {
                const f = row.file;
                const d = row.folder;
                const id = (f ?? d)!.id;
                const selected = f ? sel.files.has(id) : sel.folders.has(id);
                return (
                  <div
                    key={id}
                    role="row"
                    tabIndex={0}
                    aria-selected={selected}
                    draggable={!trash && (f ?? d)!.role === "edit"}
                    onDragStart={(e) => dragStart(e, id, !!d)}
                    onDragOver={(e) => d && (e.preventDefault(), setDropOver(id))}
                    onDragLeave={() => setDropOver((x) => (x === id ? null : x))}
                    onDrop={(e) => d && !trash && dropOn(e, { folderId: id, root: place.root })}
                    onPointerDown={(e) => (touch.current = e.pointerType === "touch")}
                    onClick={(e) => (touch.current && !count && !trash ? (f ? open(f) : router.push(`/documents/folder/${id}`)) : pick(id, !!d, e))}
                    onDoubleClick={() => !trash && (f ? open(f) : router.push(`/documents/folder/${id}`))}
                    onContextMenu={(e) => ctx(e, row)}
                    className={clsx("grid cursor-default grid-cols-[minmax(0,1fr)_36px] items-center gap-3 border-b border-border px-3 py-2 outline-none max-sm:py-2.5 select-none last:border-b-0 focus-visible:bg-fg/[0.03] md:grid-cols-[minmax(0,1fr)_140px_120px_90px_40px] md:px-4", selected ? "bg-[#7c5cdb]/10" : "hover:bg-fg/[0.025]", dropOver === id && "drive-drop")}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {f ? <FileGlyph f={f} size={30} /> : <FolderGlyph f={d!} size={30} />}
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-medium">{f ? f.title : d!.name}</span>
                          {(f ?? d)!.starred && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                          {(f ?? d)!.shared && <Users className="size-3 shrink-0 text-muted" aria-label="Shared" />}
                          {f && <DropBadges f={f} />}
                          {f?.linkType && <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">{LINK_LABEL[f.linkType as keyof typeof LINK_LABEL]}</span>}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted md:hidden">
                          {f ? `${KIND_LABEL[kindOf(f)]} · ${ago(f.updatedAt)}` : `${d!.items} items`}
                        </span>
                      </span>
                    </span>
                    <span className="hidden truncate text-[12.5px] text-muted md:block">{(f ?? d)!.mine ? "You" : (f ?? d)!.owner}</span>
                    <span className="hidden text-[12.5px] text-muted md:block">{trash && (f ?? d)!.deletedAt ? ago((f ?? d)!.deletedAt!) : f ? ago(f.updatedAt) : ago(d!.createdAt)}</span>
                    <span className="hidden text-[12.5px] text-muted tabular-nums md:block">{f ? (f.kind === "doc" ? `${f.words.toLocaleString("en-IN")} words` : fmtBytes(f.size)) : "—"}</span>
                    <ItemMenu entries={f ? fileMenu(f) : folderMenu(d!)} label="Options" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {details && <DetailsAside files={selectedFiles} folders={selectedFolders} folder={data?.folder ?? null} onClose={() => setDetails(false)} />}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.target.file ? fileMenu(menu.target.file) : folderMenu(menu.target.folder!)} onClose={() => setMenu(null)} />}
      {preview && <FileViewer file={preview} files={files} onClose={() => setPreview(null)} />}
      {tool?.kind === "qr" && <QrDialog file={tool.file} onClose={() => setTool(null)} />}
      {tool?.kind === "stay" && <StayDialog file={tool.file} onClose={() => setTool(null)} />}
      {tool?.kind === "activity" && <ActivityDialog file={tool.file} onClose={() => setTool(null)} />}
      {dropQr && <DropDialog place={place} placeName={section === "folder" ? (data?.folder?.name ?? "this folder") : section === "mine" ? "My documents" : "Team documents"} onClose={() => (setDropQr(false), void list.refetch())} />}
      {tool?.kind === "convert" && <ConvertDialog file={tool.file} onClose={() => setTool(null)} />}
      {tool?.kind === "pdf" && <PdfTools file={tool.file} onClose={() => setTool(null)} onSaved={() => (setTool(null), refresh())} />}
      {dialog?.kind === "rename" && dialog.folder && <FolderDialog place={place} folder={dialog.folder} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rename" && dialog.file && <RenameDialog f={dialog.file} onClose={() => setDialog(null)} />}
      {dialog?.kind === "folder" && <FolderDialog place={place} onClose={() => setDialog(null)} />}
      {dialog?.kind === "share" && <ShareDialog target={dialog.file ? { fileId: dialog.file.id, title: dialog.file.title } : { folderId: dialog.folder!.id, title: dialog.folder!.name }} onClose={() => setDialog(null)} />}
      {dialog?.kind === "move" && (
        <MoveDialog
          title={`Move ${count === 1 ? `“${selectedFiles[0]?.title ?? selectedFolders[0]?.name}”` : `${count} items`}`}
          exclude={[...sel.folders]}
          current={folderId}
          onClose={() => setDialog(null)}
          onPick={(to) => {
            run.mutate({ path: "move", body: { files: [...sel.files], folders: [...sel.folders], ...to }, ok: "Moved" });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "purge" && (
        <Dialog
          open
          onClose={() => setDialog(null)}
          title={`Delete ${count === 1 ? "this" : `${count} items`} for good?`}
          description="This can't be undone. Files that were sent for signature are kept, so the signed record stays."
          size="sm"
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={run.isPending}
                onClick={() => {
                  run.mutate({ path: "purge", body: { files: [...sel.files], folders: [...sel.folders] }, ok: "Deleted for good" });
                  setDialog(null);
                }}
              >
                Delete for good
              </Button>
            </>
          }
        />
      )}
      {up.panel}
      {dropOver === "here" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock)+24px)] z-[60] flex justify-center">
          <span className="doc-pop rounded-full bg-[#7c5cdb] px-4 py-2 text-[13px] font-semibold text-white shadow-lg">
            <Upload className="mr-1.5 inline size-4" />
            Drop to upload to {section === "folder" ? (data?.folder?.name ?? "this folder") : (TITLES[section]?.[0] ?? "here")}
          </span>
        </div>
      )}
    </div>
  );
}

function Chips({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" role="radiogroup" aria-label={label}>
      <span className="px-1 text-[11.5px] font-semibold text-subtle">{label}</span>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={clsx("h-7 rounded-full px-2.5 text-[12px] font-medium", value === v ? "bg-fg text-bg" : "text-fg/70 hover:bg-fg/[0.05]")}>
          {l}
        </button>
      ))}
    </div>
  );
}

function SelBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium hover:bg-bg/15 [&_svg]:size-4">
      {icon}
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

type MenuEntry = { label: string; icon: ReactNode; run: () => void; danger?: boolean; disabled?: boolean } | "sep";

function ItemMenu({ entries, label }: { entries: MenuEntry[]; label: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.right - 220, y: r.bottom + 4 });
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted opacity-70 hover:bg-fg/[0.07] hover:text-fg hover:opacity-100"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {at && <ContextMenu x={at.x} y={at.y} entries={entries} onClose={() => setAt(null)} />}
    </>
  );
}

function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = box.current;
    if (el) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y });
      el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [x, y, onClose]);
  const onKey = (e: React.KeyboardEvent) => {
    const btns = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      btns[(i + 1) % btns.length]?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      btns[(i - 1 + btns.length) % btns.length]?.focus();
    }
  };
  return createPortal(
    <div ref={box} role="menu" onKeyDown={onKey} className="doc-pop fixed z-[75] w-[220px] rounded-[14px] border border-border bg-[var(--surface-solid)] p-1.5 shadow-[0_22px_50px_-16px_rgb(0_0_0/0.4)]" style={pos} onClick={(e) => e.stopPropagation()}>
      {entries.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="mx-2 my-1 h-px bg-border" role="separator" />
        ) : (
          <button key={i} type="button" role="menuitem" disabled={it.disabled} onClick={() => (onClose(), it.run())} className={clsx("flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] outline-none disabled:opacity-35 [&_svg]:size-4", it.danger ? "text-danger hover:bg-danger hover:text-white focus:bg-danger focus:text-white" : "hover:bg-accent hover:text-accent-fg focus:bg-accent focus:text-accent-fg")}>
            <span className="opacity-70">{it.icon}</span>
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

function RenameDialog({ f, onClose }: { f: DriveFile; onClose: () => void }) {
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const [title, setTitle] = useState(f.title);
  const save = useMutation({
    mutationFn: () => api(`${base}/files/${f.id}`, { method: "PATCH", body: { title } }),
    onSuccess: () => (refresh(), onClose()),
    onError: (e) => toast({ tone: "error", title: "Couldn't rename it", description: errorMessage(e) }),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rename"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), title.trim() && save.mutate())}>
        <Input autoFocus aria-label="Name" value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.currentTarget.select()} maxLength={200} />
      </form>
    </Dialog>
  );
}

function DetailsAside({ files, folders, folder, onClose }: { files: DriveFile[]; folders: DriveFolder[]; folder: DriveFolder | null; onClose: () => void }) {
  const f = files[0];
  const d = folders[0] ?? (!f ? folder : null);
  const n = files.length + folders.length;
  const row = (k: string, v: ReactNode) => (
    <div className="flex gap-3 py-1.5 text-[12.5px]">
      <dt className="w-20 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 flex-1 break-words">{v}</dd>
    </div>
  );
  return (
    <aside className="sticky top-[calc(var(--bar)+24px)] hidden max-h-[calc(100dvh-var(--bar)-48px)] w-[300px] shrink-0 self-start overflow-y-auto rounded-[18px] border border-border bg-[var(--surface-solid)] xl:block">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Info className="size-4 text-muted" />
        <p className="flex-1 text-[13.5px] font-semibold">Details</p>
        <button type="button" onClick={onClose} aria-label="Close details" className="grid size-7 place-items-center rounded-full text-muted hover:bg-fg/[0.06]">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-4">
        {n > 1 ? (
          <p className="text-[13px] text-muted">{n} items selected</p>
        ) : f ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <FileGlyph f={f} size={40} />
              <p className="min-w-0 text-[14px] font-semibold break-words">{f.title}</p>
            </div>
            <dl className="divide-y divide-border">
              {row("Type", KIND_LABEL[kindOf(f)])}
              {row("Size", f.kind === "doc" ? `${f.words.toLocaleString("en-IN")} words` : fmtBytes(f.size))}
              {row("Owner", f.owner)}
              {row("Changed", `${ago(f.updatedAt)}${f.lastEditedBy ? ` by ${f.lastEditedBy}` : ""}`)}
              {row("Created", new Date(f.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }))}
              {row("Access", f.access === "private" ? (f.shared ? "Private, shared with people" : "Private to its owner") : "Follows its folder")}
              {f.linkShared && row("Link", "Anyone with the link can view")}
              {f.linkType && row("Linked to", LINK_LABEL[f.linkType as keyof typeof LINK_LABEL])}
              {f.tags.length > 0 && row("Tags", f.tags.join(", "))}
              {f.kind === "file" && row("Versions", f.version)}
            </dl>
            {f.snippet && <p className="mt-3 line-clamp-6 rounded-[12px] bg-fg/[0.03] p-3 text-[12px] leading-relaxed text-muted">{f.snippet}</p>}
          </>
        ) : d ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <FolderGlyph f={d} size={40} />
              <p className="min-w-0 text-[14px] font-semibold break-words">{d.name}</p>
            </div>
            <dl className="divide-y divide-border">
              {row("Items", d.items)}
              {row("Owner", d.owner)}
              {row("Access", d.access === "private" ? "Private" : d.access === "members" ? "Chosen people" : d.access === "managers" ? "Owners and admins" : "Everyone on the team")}
              {row("Shared", d.shared ? "Yes" : "No")}
              {row("Created", new Date(d.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }))}
            </dl>
          </>
        ) : (
          <p className="text-[13px] text-muted">Select a file or folder to see its details.</p>
        )}
      </div>
    </aside>
  );
}

/** Files dropped from the computer, including those inside dropped folders (kept with their paths). */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.some((e) => e.isDirectory)) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry, path: string) => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      Object.defineProperty(f, "webkitRelativePath", { value: `${path}${f.name}` });
      out.push(f);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c, `${path}${e.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out.slice(0, 500);
}
