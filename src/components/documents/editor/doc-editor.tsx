"use client";

// The document editor: a page you write on together. Everyone's edits and
// cursors appear live; it saves as you type and keeps versions. Menus for
// File / Edit / View / Insert / Format / Tools, a full formatting toolbar, a
// "/" menu of blocks, @people and #record mentions, comments, version history,
// page setup, find & replace, the writing assistant, and downloads as PDF,
// Word, Markdown or HTML. Phones get the same editor with a scrolling toolbar
// and the side panels as sheets.
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Typography from "@tiptap/extension-typography";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type Editor, type NodeViewProps } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  BookOpen,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Code2,
  Copy,
  Download,
  FileCog,
  FileDown,
  FileSignature,
  FileText,
  FolderInput,
  Heading1,
  Heading2,
  Heading3,
  History,
  Image as ImageIcon,
  Info,
  Italic,
  Languages,
  LayoutTemplate,
  Link2,
  List,
  ListOrdered,
  ListTree,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Minus,
  MoreHorizontal,
  NotebookPen,
  PanelLeft,
  Printer,
  QrCode,
  Quote,
  Scissors,
  Search,
  Share2,
  Sparkles,
  SquarePen,
  Star,
  Strikethrough,
  Table2,
  TextCursorInput,
  Trash2,
  Type,
  Underline,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useShareToChat } from "@/components/chat/share";
import { useCompose } from "@/components/mail/compose-provider";
import { useSession } from "@/components/shell/session-context";
import { Menu, useToast, type MenuItem } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { DocLive, type Peer, type SaveState } from "@/lib/client/doc-live";
import { docExtensions } from "@/lib/documents/extensions";
import { fontCss, outlineOf, pageMm, type PMNode, type PageSetup } from "@/lib/documents/write";
import { SendDialog } from "../documents-app";
import { Avatar, MoveDialog, ShareDialog, useDocsBase, useDriveRefresh, type DriveFile, type Person } from "../drive/shared";
import { FillFieldsDialog, FindBar, LinkDialog, PageSetupDialog, WordCountDialog, fieldsOf } from "./dialogs";
import { CommentHighlights, FindReplace, mentionSuggestion, slashCommand, type Item } from "./kit";
import { AiPanel, CommentsPanel, DetailsPanel, Outline, RecordChip, VersionPreview, VersionsPanel, anchorOf, scrollToHeading, useCommentHighlights, type Thread } from "./panels";
import { Pop, Toolbar } from "./toolbar";
import { downloadUrl } from "../drive/shared";
import { ConvertDialog } from "../viewer/convert-dialog";
import { QrDialog } from "../viewer/qr-dialog";
import "../docs.css";

const emit = (name: string) => window.dispatchEvent(new Event(`docs:${name}`));

type OpenDoc = { file: DriveFile; content: PMNode; page: PageSetup; role: "view" | "comment" | "edit"; path: { root: "mine" | "team" | "shared"; crumbs: { id: string; name: string }[] }; people: Person[] };
type Panel = "comments" | "versions" | "details" | "ai" | null;

export function DocEditorPage({ id }: { id: string }) {
  const { org, user } = useSession();
  const base = useDocsBase();
  const toast = useToast();
  const q = useQuery({ queryKey: ["drive", org.id, "doc", id], queryFn: () => api<OpenDoc>(`${base}/docs/${id}`), retry: false });
  const [live, setLive] = useState<DocLive | null>(null);
  const [gen, setGen] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = !!q.data;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let session: DocLive | null = null;
    DocLive.open(org.id, id, { id: user.id, name: user.name })
      .then((s) => {
        if (!alive) return s.destroy();
        session = s;
        s.onReset = (why) => {
          toast({ tone: "info", title: "This document was updated", description: why || "It reloaded with the latest content." });
          setGen((g) => g + 1);
        };
        setLive(s);
      })
      .catch((e) => alive && setFailed(errorMessage(e)));
    return () => {
      alive = false;
      setLive(null);
      if (session) {
        const s = session;
        void s
          .save()
          .catch(() => {})
          .finally(() => s.destroy());
      }
    };
  }, [org.id, id, user.id, user.name, ready, gen, toast]);
  if (q.isError || failed)
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <Lock className="mx-auto size-8 text-fg/25" />
        <h1 className="mt-3 text-[17px] font-semibold">This document isn&apos;t open to you</h1>
        <p className="mt-1 text-[13px] text-muted">{failed ?? errorMessage(q.error)}</p>
        <Link href="/documents" className="mt-4 inline-flex text-[13px] font-medium underline">
          Back to Documents
        </Link>
      </div>
    );
  if (!q.data || !live) return <EditorSkeleton />;
  return <Workspace key={`${id}-${gen}`} data={q.data} live={live} refetch={() => q.refetch()} />;
}

function EditorSkeleton() {
  return (
    <div className="doc-desk min-h-[var(--app-h)]">
      <div className="h-[100px] border-b border-border bg-bg" />
      <div className="mx-auto mt-6 h-[80vh] w-[min(816px,100%)] animate-pulse rounded-[4px] bg-[var(--surface-solid)] shadow-sm" />
    </div>
  );
}

const SAVE_LABEL: Record<SaveState, [string, ReactNode]> = {
  saved: ["Saved", <Cloud key="s" className="size-3.5" />],
  saving: ["Saving…", <Loader2 key="g" className="size-3.5 animate-spin" />],
  unsaved: ["Editing…", <Cloud key="u" className="size-3.5 opacity-60" />],
  offline: ["Offline — will save when you're back", <CloudOff key="o" className="size-3.5 text-warning" />],
  readonly: ["View only", <Lock key="r" className="size-3.5" />],
};

function Workspace({ data, live, refetch }: { data: OpenDoc; live: DocLive; refetch: () => void }) {
  const { org, user } = useSession();
  const base = useDocsBase();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const refresh = useDriveRefresh();
  const { available: mailOn, compose } = useCompose();
  const chat = useShareToChat();
  const file = data.file;
  const role = data.role;
  const canEdit = role === "edit";
  const canComment = role !== "view";
  const [title, setTitle] = useState(file.title);
  const [icon, setIcon] = useState(file.icon);
  const [starred, setStarred] = useState(file.starred);
  const [page, setPageState] = useState<PageSetup>(data.page);
  const [save, setSave] = useState<SaveState>(live.state);
  const [peers, setPeers] = useState<Peer[]>(() => live.peers());
  const [panel, setPanel] = useState<Panel>(params.get("comment") ? "comments" : null);
  const [outline, setOutline] = useState(true);
  const [dialog, setDialog] = useState<null | "page" | "words" | "fill" | "link" | "share" | "move" | "sign" | "find" | "replace" | "qr" | "convert">(null);
  const [signFile, setSignFile] = useState<{ fileId: string; title: string } | null>(null);
  // "fit" shrinks the page to the space it has (a side panel open, a small laptop); a number is a chosen zoom.
  const [zoomPick, setZoom] = useState<number | "fit">("fit");
  const [desk, setDesk] = useState<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(1);
  const [draft, setDraft] = useState<{ quote: string; anchor: { from: string; to: string } | null } | null>(null);
  const [active, setActive] = useState<string | null>(params.get("comment"));
  const [preview, setPreview] = useState<{ version: number; content: PMNode; label: string } | null>(null);
  const [words, setWords] = useState(file.words);
  const [imageInput, setImageInput] = useState<HTMLInputElement | null>(null);
  const people = data.people;

  useEffect(() => {
    const off = [live.on("state", setSave), live.on("peers", setPeers), live.on("saved", () => void qc.invalidateQueries({ queryKey: ["drive", org.id] }))];
    const warn = (e: BeforeUnloadEvent) => {
      if (live.unsaved) {
        void live.save().catch(() => {});
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      off.forEach((f) => f());
      window.removeEventListener("beforeunload", warn);
    };
  }, [live, qc, org.id]);

  const threadsQ = useQuery({ queryKey: ["drive", "comments", file.id], queryFn: () => api<{ threads: Thread[] }>(`${base}/docs/${file.id}/comments`), refetchInterval: 20_000 });
  const threads = useMemo(() => threadsQ.data?.threads ?? [], [threadsQ.data]);

  const uploadImage = useCallback(
    async (f: File) => {
      const form = new FormData();
      form.append("file", f);
      const r = await fetch(`${base}/docs/${file.id}/assets`, { method: "POST", body: form, credentials: "same-origin" });
      const j = (await r.json().catch(() => ({}))) as { src?: string; error?: { message?: string } };
      if (!r.ok || !j.src) throw new Error(j.error?.message ?? "That image couldn't be added");
      return j.src;
    },
    [base, file.id],
  );

  // Records to #mention come from the workspace search.
  const findRecords = useCallback(
    async (q: string): Promise<Item[]> => {
      if (q.trim().length < 2) return [];
      try {
        const r = await api<{ results: { kind: string; label: string; sub: string; link: string; id: string }[] }>(`/api/v1/orgs/${org.id}/search?q=${encodeURIComponent(q)}`);
        return r.results.filter((x) => x.link?.startsWith("/")).map((x) => ({ id: x.id || x.link, label: x.label, sub: [x.kind, x.sub].filter(Boolean).join(" · "), group: x.kind, attrs: { href: x.link } }));
      } catch {
        return [];
      }
    },
    [org.id],
  );


  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: canEdit,
      extensions: [
        ...docExtensions({ collab: true }).map((e) =>
          e.name === "tableOfContents"
            ? e.extend({ addNodeView: () => ReactNodeViewRenderer(TocView) })
            : e.name === "mention"
            ? e.configure({
                suggestions: [
                  mentionSuggestion("@", (q) =>
                    people
                      .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase()))
                      .slice(0, 8)
                      .map((p) => ({ id: p.id, label: p.name, sub: p.email, icon: <Avatar name={p.name} size={24} /> })),
                  ),
                  mentionSuggestion("#", findRecords),
                ],
              })
            : e,
        ),
        Collaboration.configure({ document: live.doc, field: "default" }),
        CollaborationCaret.configure({ provider: { awareness: live.awareness } as never, user: (live.awareness.getLocalState() as { user: { name: string; color: string } }).user }),
        Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Type / for headings, tables, images and more — or just start writing"), showOnlyCurrent: true, includeChildren: false }),
        CharacterCount,
        Typography,
        FindReplace,
        CommentHighlights.configure({ onClick: (tid) => (setActive(tid), setPanel("comments")) }),
        slashCommand(() => slashItems({ image: () => emit("image"), link: () => emit("link") })),
      ],
      editorProps: {
        attributes: { class: "doc-content", spellcheck: "true", "aria-label": "Document", "aria-multiline": "true", role: "textbox" },
        handleKeyDown: (_v, e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.key.toLowerCase() === "k") {
            // The editor's own link, not the app's command palette.
            e.preventDefault();
            e.stopPropagation();
            emit("link");
            return true;
          }
          if (mod && e.altKey && e.code === "KeyM") {
            e.preventDefault();
            emit("comment");
            return true;
          }
          return false;
        },
        handlePaste: (view, e) => {
          const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
          if (!imgs.length || !canEdit) return false;
          e.preventDefault();
          for (const f of imgs)
            void uploadImage(f)
              .then((src) => view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image!.create({ src, alt: f.name.replace(/\.[^.]+$/, "") }))))
              .catch((err) => toast({ tone: "error", title: "Couldn't add the image", description: errorMessage(err) }));
          return true;
        },
        handleDrop: (view, e, _s, moved) => {
          if (moved || !canEdit) return false;
          const imgs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
          if (!imgs.length) return false;
          e.preventDefault();
          const at = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? view.state.selection.from;
          for (const f of imgs)
            void uploadImage(f)
              .then((src) => view.dispatch(view.state.tr.insert(at, view.state.schema.nodes.image!.create({ src, alt: f.name.replace(/\.[^.]+$/, "") }))))
              .catch((err) => toast({ tone: "error", title: "Couldn't add the image", description: errorMessage(err) }));
          return true;
        },
      },
      onUpdate: ({ editor: e }) => setWords((e.storage as unknown as { characterCount: { words: () => number } }).characterCount.words()),
    },
    [live],
  );

  const headings = useEditorState({ editor, selector: ({ editor: e }) => (e ? outlineOf(e.getJSON() as PMNode) : []), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }) ?? [];
  useCommentHighlights(editor, threads, active);

  // ── Actions ──
  const patch = useMutation({
    mutationFn: (b: Record<string, unknown>) => api(`${base}/files/${file.id}`, { method: "PATCH", body: b }),
    onSuccess: () => refresh(),
    onError: (e) => toast({ tone: "error", title: "Couldn't save that", description: errorMessage(e) }),
  });
  const setPage = (p: PageSetup) => {
    setPageState(p);
    patch.mutate({ page: p });
  };
  const exportAs = async (format: "pdf" | "docx" | "md" | "html" | "txt", inline = false) => {
    await live.save().catch(() => {});
    const url = `${base}/docs/${file.id}/export?format=${format}${inline ? "&inline=1" : ""}`;
    if (inline) window.open(url, "_blank", "noopener");
    else downloadUrl(url);
  };
  const startComment = () => {
    if (!editor || !canComment) return;
    const { from, to } = editor.state.selection;
    if (to <= from) {
      toast({ tone: "info", title: "Select some text first", description: "Then add a comment about it." });
      return;
    }
    setDraft({ quote: editor.state.doc.textBetween(from, to, " ").slice(0, 600), anchor: anchorOf(editor) });
    setPanel("comments");
  };
  const copy = useMutation({
    mutationFn: () => api<{ file: DriveFile }>(`${base}/files/${file.id}/copy`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      refresh();
      router.push(`/documents/d/${r.file.id}`);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't make a copy", description: errorMessage(e) }),
  });
  const trash = useMutation({
    mutationFn: () => api(`${base}/trash`, { method: "POST", body: { files: [file.id] } }),
    onSuccess: () => {
      refresh();
      toast({ tone: "success", title: "Moved to the trash", description: "You can restore it from the trash for 30 days." });
      router.push("/documents");
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't move it to the trash", description: errorMessage(e) }),
  });
  const sign = useMutation({
    mutationFn: async () => {
      await live.save().catch(() => {});
      return api<{ fileId: string; title: string }>(`${base}/docs/${file.id}/pdf`, { method: "POST", body: {} });
    },
    onSuccess: (r) => {
      refresh();
      setSignFile(r);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't make the PDF", description: errorMessage(e) }),
  });
  const insertImage = () => imageInput?.click();
  const print = () => void exportAs("pdf", true);
  // The editor's own shortcuts and "/" items reach the page as events.
  useEffect(() => {
    const on: Record<string, () => void> = {
      "docs:link": () => canEdit && setDialog("link"),
      "docs:comment": startComment,
      "docs:image": () => imageInput?.click(),
    };
    for (const [k, f] of Object.entries(on)) window.addEventListener(k, f);
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const run = k === "s" ? () => void live.save().then(() => toast({ tone: "success", title: "Saved" })) : k === "p" ? print : k === "f" && !e.shiftKey ? () => setDialog("find") : k === "h" && e.shiftKey ? () => setDialog("replace") : null;
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      for (const [k, f] of Object.entries(on)) window.removeEventListener(k, f);
      window.removeEventListener("keydown", onKey);
    };
  });

  const renameTo = (t: string) => {
    const v = t.trim() || "Untitled document";
    setTitle(v);
    if (v !== file.title) patch.mutate({ title: v });
  };
  const toggleStar = async () => {
    setStarred(!starred);
    await api(`${base}/star`, { method: "POST", body: { id: file.id, kind: "file", on: !starred } }).catch(() => setStarred(starred));
    refresh();
  };
  const emailIt = async () => {
    await live.save().catch(() => {});
    compose({ subject: title, body: `Hi {{first_name}},\n\nPlease find “${title}” attached.\n\nThanks,\n{{my_name}}`, attachments: [{ url: `${base}/docs/${file.id}/export?format=pdf`, filename: `${title}.pdf` }], title: "Email this document" });
  };

  const mm = pageMm(page);
  useEffect(() => {
    if (!desk) return;
    const paperPx = (mm.w / 25.4) * 96;
    const ro = new ResizeObserver(([e]) => setFit(Math.max(0.5, Math.min(1, (e!.contentRect.width - 48) / paperPx))));
    ro.observe(desk);
    return () => ro.disconnect();
  }, [desk, mm.w]);
  const zoom = zoomPick === "fit" ? (page.pageless ? 1 : fit) : zoomPick;
  const paperStyle = {
    "--pw": `${mm.w}mm`,
    "--ph": `${mm.h}mm`,
    "--pt": `${page.margins.top}mm`,
    "--pr": `${page.margins.right}mm`,
    "--pb": `${page.margins.bottom}mm`,
    "--pl": `${page.margins.left}mm`,
    "--zoom": zoom,
    "--doc-font": fontCss(page.font),
    "--doc-size": `${page.fontSize}pt`,
    "--doc-lh": page.lineHeight,
  } as React.CSSProperties;

  const where = data.path;
  const rootLabel = where.root === "mine" ? "My documents" : where.root === "shared" ? "Shared with me" : "Team";
  const rootHref = `/documents/${where.root}`;
  const openThreads = threads.filter((t) => !t.resolved).length;
  const fields = editor ? fieldsOf(editor) : [];

  const fileMenu: MenuItem[] = [
    { label: "New document", icon: <SquarePen />, onSelect: () => router.push("/documents/new") },
    { label: "Make a copy", icon: <Copy />, onSelect: () => copy.mutate() },
    ...(canEdit ? [{ label: "Move to…", icon: <FolderInput />, onSelect: () => setDialog("move") }] : []),
    "separator",
    { label: "Share…", icon: <Share2 />, onSelect: () => setDialog("share"), disabled: !canEdit },
    ...(mailOn ? [{ label: "Email as PDF", icon: <Mail />, onSelect: () => void emailIt() }] : []),
    ...(chat.available ? [{ label: "Share to chat", icon: <MessagesSquare />, onSelect: () => chat.share({ kind: "documents", id: file.id, title, sub: `${words.toLocaleString("en-IN")} words`, link: `/documents/d/${file.id}`, module: "Document" }) }] : []),
    ...(canEdit ? [{ label: "Send for signature", icon: <FileSignature />, onSelect: () => sign.mutate() }] : []),
    "separator",
    { label: "QR code to open it", icon: <QrCode />, onSelect: () => setDialog("qr") },
    { label: "Save a copy as PDF, Word…", icon: <FileCog />, onSelect: () => void live.save().catch(() => {}).then(() => setDialog("convert")) },
    { label: "Download as PDF", icon: <FileDown />, onSelect: () => void exportAs("pdf") },
    { label: "Download as Word (.docx)", icon: <Download />, onSelect: () => void exportAs("docx") },
    { label: "Download as Markdown", icon: <Download />, onSelect: () => void exportAs("md") },
    { label: "Download as web page", icon: <Download />, onSelect: () => void exportAs("html") },
    { label: "Download as plain text", icon: <Download />, onSelect: () => void exportAs("txt") },
    "separator",
    { label: "Version history", icon: <History />, onSelect: () => setPanel("versions") },
    { label: "Page setup", icon: <LayoutTemplate />, onSelect: () => setDialog("page"), disabled: !canEdit },
    { label: "Print", icon: <Printer />, onSelect: print },
    { label: "Details", icon: <Info />, onSelect: () => setPanel("details") },
    ...(canEdit ? ["separator" as const, { label: "Move to trash", icon: <Trash2 />, danger: true, onSelect: () => trash.mutate() }] : []),
  ];
  const c = () => editor!.chain().focus();
  const editMenu: MenuItem[] = [
    { label: "Undo", onSelect: () => c().undo().run(), disabled: !canEdit },
    { label: "Redo", onSelect: () => c().redo().run(), disabled: !canEdit },
    "separator",
    { label: "Select all", onSelect: () => c().selectAll().run() },
    { label: "Find", icon: <Search />, onSelect: () => setDialog("find") },
    { label: "Find and replace", onSelect: () => setDialog("replace"), disabled: !canEdit },
  ];
  const insertMenu: MenuItem[] = slashItems({ image: insertImage, link: () => setDialog("link") })
    .filter((i) => i.group !== "Text")
    .map((i) => ({ label: i.label, icon: i.icon, onSelect: () => editor && i.run?.(editor, { from: editor.state.selection.from, to: editor.state.selection.from }) }));
  const formatMenu: MenuItem[] = [
    { label: "Bold", icon: <Bold />, onSelect: () => c().toggleBold().run() },
    { label: "Italic", icon: <Italic />, onSelect: () => c().toggleItalic().run() },
    { label: "Underline", icon: <Underline />, onSelect: () => c().toggleUnderline().run() },
    { label: "Strikethrough", icon: <Strikethrough />, onSelect: () => c().toggleStrike().run() },
    "separator",
    { label: "Align left", icon: <AlignLeft />, onSelect: () => c().setTextAlign("left").run() },
    { label: "Align centre", icon: <AlignCenter />, onSelect: () => c().setTextAlign("center").run() },
    { label: "Align right", icon: <AlignRight />, onSelect: () => c().setTextAlign("right").run() },
    "separator",
    { label: "Clear formatting", onSelect: () => c().unsetAllMarks().clearNodes().run() },
    { label: "Page setup…", icon: <LayoutTemplate />, onSelect: () => setDialog("page") },
  ];
  const toolsMenu: MenuItem[] = [
    { label: "Word count", icon: <Type />, onSelect: () => setDialog("words") },
    ...(canEdit ? [{ label: `Fill in fields${fields.length ? ` (${fields.length})` : ""}`, icon: <TextCursorInput />, onSelect: () => setDialog("fill") }] : []),
    { label: "Writing assistant", icon: <Sparkles />, onSelect: () => setPanel("ai") },
    { label: "Comments", icon: <MessageSquare />, onSelect: () => setPanel("comments") },
  ];
  const viewMenu: MenuItem[] = [
    { label: outline ? "Hide outline" : "Show outline", icon: <ListTree />, onSelect: () => setOutline((o) => !o) },
    { label: page.pageless ? "Show pages" : "Pageless", icon: <BookOpen />, onSelect: () => setPage({ ...page, pageless: !page.pageless }), disabled: !canEdit },
    "separator",
    { label: `Fit to window${zoomPick === "fit" ? "  ✓" : ""}`, onSelect: () => setZoom("fit") },
    ...[0.75, 0.9, 1, 1.25, 1.5].map((z) => ({ label: `Zoom ${Math.round(z * 100)}%${zoomPick === z ? "  ✓" : ""}`, onSelect: () => setZoom(z) })),
  ];

  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      {/* Title bar */}
      <div className="sticky top-[var(--bar)] z-20 border-b border-border bg-bg/90 backdrop-blur-xl">
        <div className="flex items-center gap-2 px-3 pt-2 sm:px-4">
          <Link href={rootHref} aria-label="Back to Documents" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg">
            <ArrowLeft className="size-4" />
          </Link>
          <IconPicker icon={icon} disabled={!canEdit} onPick={(i) => (setIcon(i), patch.mutate({ icon: i }))} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={(e) => renameTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                    editor?.commands.focus("start");
                  }
                  if (e.key === "Escape") {
                    setTitle(file.title);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                readOnly={!canEdit}
                aria-label="Document title"
                className="min-w-0 flex-1 truncate rounded-[6px] bg-transparent px-1 text-[16px] font-semibold tracking-[-0.01em] outline-none hover:bg-fg/[0.04] focus:bg-fg/[0.05] sm:flex-none sm:[field-sizing:content] sm:max-w-[min(46vw,520px)]"
              />
              <button type="button" onClick={toggleStar} aria-label={starred ? "Unstar" : "Star"} aria-pressed={starred} className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-fg/[0.06]">
                <Star className={clsx("size-4", starred && "fill-amber-400 text-amber-400")} />
              </button>
              <span className={clsx("hidden shrink-0 items-center gap-1 text-[11.5px] sm:inline-flex", save === "offline" ? "text-warning" : "text-subtle")} aria-live="polite">
                {SAVE_LABEL[save][1]}
                {SAVE_LABEL[save][0]}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
              <span className="hidden items-center gap-1 pr-1 pl-1 text-[11.5px] text-subtle md:inline-flex">
                <Link href={rootHref} className="hover:text-fg hover:underline">
                  {rootLabel}
                </Link>
                {where.crumbs.map((cr) => (
                  <span key={cr.id} className="inline-flex items-center gap-1">
                    <ChevronRight className="size-3" />
                    <Link href={`/documents/folder/${cr.id}`} className="max-w-[140px] truncate hover:text-fg hover:underline">
                      {cr.name}
                    </Link>
                  </span>
                ))}
                <RecordChip linkType={file.linkType} linkId={file.linkId} />
              </span>
              <nav aria-label="Document menus" className="hidden items-center md:flex">
                {(
                  [
                    ["File", fileMenu],
                    ["Edit", editMenu],
                    ["View", viewMenu],
                    ...(canEdit ? ([["Insert", insertMenu], ["Format", formatMenu]] as const) : []),
                    ["Tools", toolsMenu],
                  ] as const
                ).map(([label, items]) => (
                  <Menu
                    key={label}
                    label={label}
                    align="start"
                    trigger={(p) => (
                      <button {...p} type="button" className="rounded-[6px] px-2 py-0.5 text-[12.5px] text-fg/75 hover:bg-fg/[0.06] hover:text-fg">
                        {label}
                      </button>
                    )}
                    items={items as MenuItem[]}
                  />
                ))}
              </nav>
            </div>
          </div>
          <Presence peers={peers} />
          <button type="button" onClick={() => setPanel(panel === "comments" ? null : "comments")} aria-label={`Comments${openThreads ? `, ${openThreads} open` : ""}`} aria-pressed={panel === "comments"} className={clsx("relative grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg", panel === "comments" && "bg-fg/[0.07] text-fg")}>
            <MessageSquare className="size-[18px]" />
            {openThreads > 0 && <span className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9.5px] font-bold text-white tabular-nums">{openThreads}</span>}
          </button>
          <button type="button" onClick={() => setPanel(panel === "ai" ? null : "ai")} aria-label="Writing assistant" aria-pressed={panel === "ai"} className={clsx("hidden size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg sm:grid", panel === "ai" && "bg-fg/[0.07] text-[#6a48d6]")}>
            <Sparkles className="size-[18px]" />
          </button>
          <span className="md:hidden">
            <Menu
              label="Document"
              trigger={(p) => (
                <button {...p} type="button" aria-label="Document menu" className="grid size-9 place-items-center rounded-full text-muted hover:bg-fg/[0.06]">
                  <MoreHorizontal className="size-[18px]" />
                </button>
              )}
              items={[{ label: "Writing assistant", icon: <Sparkles />, onSelect: () => setPanel("ai") }, { label: "Find", icon: <Search />, onSelect: () => setDialog("find") }, { label: "Word count", icon: <Type />, onSelect: () => setDialog("words") }, ...(canEdit ? [{ label: "Fill in fields", icon: <TextCursorInput />, onSelect: () => setDialog("fill") }] : []), "separator", ...fileMenu]}
            />
          </span>
          {canEdit && (
            <Button variant="primary" size="sm" icon={file.access === "private" && !file.shared ? <Lock className="size-3.5" /> : <Share2 className="size-3.5" />} onClick={() => setDialog("share")} className="shrink-0 max-sm:!px-2.5">
              <span className="max-sm:hidden">Share</span>
            </Button>
          )}
        </div>
        {editor && <Toolbar editor={editor} page={page} editable={canEdit} a={{ onLink: () => setDialog("link"), onImage: insertImage, onComment: startComment, onPrint: print, canComment }} />}
      </div>

      {/* Desk */}
      <div className="doc-desk relative flex min-h-0 flex-1">
        {outline && editor && (
          <aside className="sticky top-[calc(var(--bar)+100px)] hidden max-h-[calc(100dvh-var(--bar)-120px)] w-56 shrink-0 self-start overflow-y-auto px-3 py-6 xl:block">
            <p className="mb-2 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">
              <ListTree className="size-3.5" /> Outline
            </p>
            <Outline editor={editor} headings={headings} />
          </aside>
        )}
        <div ref={setDesk} className="min-w-0 flex-1 overflow-x-auto px-0 py-0 md:px-6 md:py-8">
          <div className={clsx("doc-paper", page.pageless && "pageless")} style={paperStyle}>
            {!page.pageless && page.header && <div className="doc-page-head">{page.header}</div>}
            {preview ? <VersionPreview content={preview.content} label={preview.label} onClose={() => setPreview(null)} /> : <EditorContent editor={editor} />}
            {!page.pageless && page.footer && <div className="doc-page-foot">{page.footer}</div>}
          </div>
          <p className="py-6 text-center text-[11.5px] text-subtle md:pb-0">
            {words.toLocaleString("en-IN")} words · <TocHint headings={headings.length} />
          </p>
        </div>
        {panel && editor && (
          <>
            <div className="fixed inset-0 z-[44] bg-black/25 lg:hidden" onClick={() => setPanel(null)} aria-hidden />
            <aside className="fixed inset-x-0 bottom-0 z-[45] h-[78dvh] overflow-hidden rounded-t-[22px] border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] shadow-2xl lg:sticky lg:inset-auto lg:top-[calc(var(--bar)+100px)] lg:z-auto lg:h-[calc(100dvh-var(--bar)-100px)] lg:w-[340px] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:pb-0 lg:shadow-none">
              {panel === "comments" && <CommentsPanel editor={editor} base={base} fileId={file.id} threads={threads} people={people} draft={draft} setDraft={setDraft} active={active} setActive={setActive} canComment={canComment} onClose={() => (setPanel(null), setDraft(null))} refetch={() => threadsQ.refetch()} />}
              {panel === "versions" && <VersionsPanel base={base} fileId={file.id} canEdit={canEdit} onClose={() => setPanel(null)} onPreview={setPreview} preview={preview?.version ?? null} onNameCurrent={(name) => live.save(name)} />}
              {panel === "details" && <DetailsPanel base={base} file={{ ...file, title }} headings={headings.length} words={words} chars={(editor.storage as unknown as { characterCount: { characters: () => number } }).characterCount.characters()} onClose={() => setPanel(null)} path={where} />}
              {panel === "ai" && <AiPanel base={base} fileId={file.id} editor={editor} canEdit={canEdit} onClose={() => setPanel(null)} beforeAsk={() => live.save().catch(() => {})} />}
            </aside>
          </>
        )}
      </div>

      {editor && canEdit && <SelectionBubble editor={editor} base={base} fileId={file.id} onLink={() => setDialog("link")} onComment={startComment} />}
      {editor && !canEdit && canComment && <CommentBubble editor={editor} onComment={startComment} />}
      {editor && canEdit && <ImageBubble editor={editor} />}
      <input
        ref={setImageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !editor) return;
          try {
            const src = await uploadImage(f);
            editor.chain().focus().setImage({ src, alt: f.name.replace(/\.[^.]+$/, "") }).run();
          } catch (err) {
            toast({ tone: "error", title: "Couldn't add the image", description: errorMessage(err) });
          }
        }}
      />
      {editor && (dialog === "find" || dialog === "replace") && <FindBar editor={editor} replace={dialog === "replace"} onClose={() => setDialog(null)} />}
      {dialog === "page" && <PageSetupDialog page={page} onSave={setPage} onClose={() => setDialog(null)} />}
      {dialog === "words" && editor && <WordCountDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === "fill" && editor && <FillFieldsDialog editor={editor} onClose={() => setDialog(null)} suggestions={{ Date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), "Your company": org.name, "Your name": user.name }} />}
      {dialog === "link" && editor && <LinkDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === "share" && <ShareDialog target={{ fileId: file.id, title, isDoc: true }} onClose={() => (setDialog(null), refetch())} />}
      {dialog === "move" && (
        <MoveDialog
          title={`Move “${title}”`}
          current={file.folderId}
          onClose={() => setDialog(null)}
          onPick={async (to) => {
            try {
              await api(`${base}/move`, { method: "POST", body: { files: [file.id], ...to } });
              toast({ tone: "success", title: "Moved" });
              refresh();
              refetch();
            } catch (e) {
              toast({ tone: "error", title: "Couldn't move it", description: errorMessage(e) });
            }
            setDialog(null);
          }}
        />
      )}
      {dialog === "qr" && <QrDialog file={{ ...file, title }} onClose={() => setDialog(null)} />}
      {dialog === "convert" && <ConvertDialog file={{ ...file, title }} onClose={() => setDialog(null)} />}
      {signFile && <SendDialog fileId={signFile.fileId} title={signFile.title} onClose={() => setSignFile(null)} />}
    </div>
  );
}

/** The table of contents block: the document's headings, live, each a jump link. */
function TocView({ editor, selected }: NodeViewProps) {
  const headings = useEditorState({ editor, selector: ({ editor: e }) => outlineOf(e.getJSON() as PMNode), equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) }) ?? [];
  return (
    <NodeViewWrapper className={clsx("doc-toc", selected && "ProseMirror-selectednode")} contentEditable={false} data-toc="">
      <p className="mb-1.5 text-[0.8em] font-semibold tracking-[0.08em] uppercase opacity-60">Contents</p>
      {!headings.length && <p className="text-[0.9em] opacity-50">Add headings and they’ll be listed here.</p>}
      <ol className="!m-0 !list-none !p-0">
        {headings.map((h) => (
          <li key={h.index} style={{ paddingLeft: `${(h.level - 1) * 1.2}em` }}>
            <button type="button" onClick={() => scrollToHeading(editor, h.index)} className="py-0.5 text-left text-[0.95em] text-[#2a6fd1] hover:underline">
              {h.text}
            </button>
          </li>
        ))}
      </ol>
    </NodeViewWrapper>
  );
}

function TocHint({ headings }: { headings: number }) {
  return <>{headings ? `${headings} heading${headings === 1 ? "" : "s"}` : "Saved automatically"}</>;
}

/** Who else is here, live. */
function Presence({ peers }: { peers: Peer[] }) {
  const unique = peers.filter((p, i, a) => a.findIndex((x) => (x.userId ?? x.name) === (p.userId ?? p.name)) === i);
  if (!unique.length) return null;
  return (
    <div className="hidden items-center -space-x-1.5 sm:flex" aria-label={`Also here: ${unique.map((p) => p.name).join(", ")}`}>
      {unique.slice(0, 4).map((p) => (
        <span key={p.clientId} title={p.name} className="rounded-full ring-2 ring-bg">
          <Avatar name={p.name} size={28} color={p.color} />
        </span>
      ))}
      {unique.length > 4 && <span className="grid size-7 place-items-center rounded-full bg-fg/10 text-[10.5px] font-semibold ring-2 ring-bg">+{unique.length - 4}</span>}
    </div>
  );
}

const ICONS = ["📄", "📝", "📋", "📑", "📊", "📈", "💼", "🤝", "📜", "🔒", "🧭", "🎯", "💡", "🚀", "🗓️", "🏛️", "⚖️", "🧾", "✅", "⭐"];
function IconPicker({ icon, onPick, disabled }: { icon: string; onPick: (i: string) => void; disabled: boolean }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={(e) => setEl(el ? null : e.currentTarget)} aria-label="Document icon" className="grid size-9 shrink-0 place-items-center rounded-[10px] text-[20px] hover:bg-fg/[0.05] disabled:hover:bg-transparent">
        {icon || <FileText className="size-5 text-sky-600" />}
      </button>
      {el && (
        <Pop anchor={el} onClose={() => setEl(null)}>
          <div className="grid grid-cols-5 gap-1 p-1">
            {ICONS.map((i) => (
              <button key={i} type="button" onClick={() => (onPick(i), setEl(null))} className="grid size-9 place-items-center rounded-[9px] text-[20px] hover:bg-fg/[0.06]">
                {i}
              </button>
            ))}
          </div>
          {icon && (
            <button type="button" onClick={() => (onPick(""), setEl(null))} className="w-full rounded-[8px] py-1.5 text-[12px] text-muted hover:bg-fg/[0.05]">
              Remove icon
            </button>
          )}
        </Pop>
      )}
    </>
  );
}

// ── The "/" menu (also the Insert menu) ─────────────────────────────────────

function slashItems(a: { image: () => void; link: () => void }): (Item & { keys?: string })[] {
  const block = (fn: (e: Editor) => void) => (e: Editor, r: { from: number; to: number }) => {
    e.chain().focus().deleteRange(r).run();
    fn(e);
  };
  const today = () => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return [
    { id: "p", label: "Text", sub: "Plain writing", icon: <Type />, group: "Text", keys: "paragraph", run: block((e) => e.chain().setParagraph().run()) },
    { id: "h1", label: "Heading 1", sub: "Big section title", icon: <Heading1 />, group: "Text", keys: "h1 title", run: block((e) => e.chain().setHeading({ level: 1 }).run()) },
    { id: "h2", label: "Heading 2", sub: "Section", icon: <Heading2 />, group: "Text", keys: "h2", run: block((e) => e.chain().setHeading({ level: 2 }).run()) },
    { id: "h3", label: "Heading 3", sub: "Sub-section", icon: <Heading3 />, group: "Text", keys: "h3", run: block((e) => e.chain().setHeading({ level: 3 }).run()) },
    { id: "quote", label: "Quote", sub: "A quotation", icon: <Quote />, group: "Text", keys: "blockquote", run: block((e) => e.chain().toggleBlockquote().run()) },
    { id: "bullet", label: "Bulleted list", sub: "Points", icon: <List />, group: "Lists", keys: "ul unordered", run: block((e) => e.chain().toggleBulletList().run()) },
    { id: "number", label: "Numbered list", sub: "Steps in order", icon: <ListOrdered />, group: "Lists", keys: "ol ordered", run: block((e) => e.chain().toggleOrderedList().run()) },
    { id: "todo", label: "Checklist", sub: "Things to tick off", icon: <CheckSquare />, group: "Lists", keys: "todo task checkbox", run: block((e) => e.chain().toggleTaskList().run()) },
    { id: "toggle", label: "Toggle section", sub: "Details that open and close", icon: <ChevronDown />, group: "Lists", keys: "details collapse accordion", run: block((e) => e.chain().setDetails().run()) },
    { id: "table", label: "Table", sub: "3 × 3, with a header row", icon: <Table2 />, group: "Blocks", keys: "grid", run: block((e) => e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()) },
    { id: "image", label: "Image", sub: "Upload a picture", icon: <ImageIcon />, group: "Blocks", keys: "picture photo", run: block(() => a.image()) },
    { id: "callout", label: "Callout", sub: "Make something stand out", icon: <Info />, group: "Blocks", keys: "note tip warning info", run: block((e) => e.chain().setCallout("info").run()) },
    { id: "code", label: "Code block", sub: "Code or fixed-width text", icon: <Code2 />, group: "Blocks", keys: "snippet pre", run: block((e) => e.chain().toggleCodeBlock().run()) },
    { id: "hr", label: "Divider", sub: "A line across the page", icon: <Minus />, group: "Blocks", keys: "hr rule line", run: block((e) => e.chain().setHorizontalRule().run()) },
    { id: "pagebreak", label: "Page break", sub: "Start a new page (⌘↵)", icon: <Scissors />, group: "Blocks", keys: "new page", run: block((e) => e.chain().setPageBreak().run()) },
    { id: "toc", label: "Table of contents", sub: "Built from your headings", icon: <ListTree />, group: "Blocks", keys: "toc contents index", run: block((e) => e.chain().insertToc().run()) },
    { id: "link", label: "Link", sub: "To a website or a page in Cloudesk", icon: <Link2 />, group: "Insert", keys: "url", run: block(() => a.link()) },
    { id: "date", label: "Today's date", sub: today(), icon: <CalendarDays />, group: "Insert", keys: "date today", run: block((e) => e.chain().insertContent(today()).run()) },
    { id: "mention", label: "Mention someone", sub: "Type @ and a name", icon: <NotebookPen />, group: "Insert", keys: "person people at", run: block((e) => e.chain().insertContent("@").run()) },
    { id: "record", label: "Link a record", sub: "Type # to find a deal, invoice…", icon: <PanelLeft />, group: "Insert", keys: "record hash crm", run: block((e) => e.chain().insertContent("#").run()) },
    { id: "field", label: "Fill-in field", sub: "A {{placeholder}} to fill in later", icon: <TextCursorInput />, group: "Insert", keys: "placeholder variable merge", run: block((e) => e.chain().insertContent("{{Field}}").run()) },
  ];
}

// ── Bubble menus ────────────────────────────────────────────────────────────

const REWRITES: [string, string][] = [
  ["improve", "Improve writing"],
  ["fix", "Fix spelling & grammar"],
  ["shorter", "Make shorter"],
  ["longer", "Make longer"],
  ["simpler", "Simplify"],
  ["professional", "More professional"],
  ["friendly", "More friendly"],
  ["confident", "More confident"],
];

function SelectionBubble({ editor, base, fileId, onLink, onComment }: { editor: Editor; base: string; fileId: string; onLink: () => void; onComment: () => void }) {
  const toast = useToast();
  const [ai, setAi] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const st = useEditorState({ editor, selector: ({ editor: e }) => ({ bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"), link: e.isActive("link"), code: e.isActive("code") }) });
  const rewrite = async (body: Record<string, unknown>) => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) return;
    setAi(null);
    setBusy(true);
    try {
      const r = await api<{ text: string }>(`${base}/docs/${fileId}/ai`, { method: "POST", body: { ...body, text } });
      // One paragraph replaces the selection in place; several become paragraphs.
      const paras = r.text.replace(/\*\*|__/g, "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
      editor.chain().focus().insertContentAt({ from, to }, paras.length > 1 ? paras.map((x) => ({ type: "paragraph", content: [{ type: "text", text: x }] })) : (paras[0] ?? "")).run();
    } catch (e) {
      toast({ tone: "error", title: "The assistant couldn't do that", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 8 }} shouldShow={({ editor: e, from, to }) => to > from && !e.isActive("image") && !e.isActive("codeBlock") && !e.isActive("tableOfContents")} className="doc-pop z-[60] flex items-center gap-0.5 rounded-[12px] border border-border bg-[var(--surface-solid)] p-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]">
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setAi(ai ? null : e.currentTarget)} className="doc-tool gap-1 !px-2 text-[12.5px] font-medium !text-[#6a48d6]" aria-label="Ask AI to rewrite">
        {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
        <span className="max-sm:hidden">Ask AI</span>
      </button>
      <span className="doc-sep" />
      <B label="Bold" on={st.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </B>
      <B label="Italic" on={st.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </B>
      <B label="Underline" on={st.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline />
      </B>
      <B label="Strikethrough" on={st.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough />
      </B>
      <B label="Code" on={st.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code2 />
      </B>
      <B label="Link" on={st.link} onClick={onLink}>
        <Link2 />
      </B>
      <span className="doc-sep" />
      <B label="Comment" onClick={onComment}>
        <MessageSquarePlus />
      </B>
      {ai && (
        <Pop anchor={ai} onClose={() => setAi(null)} className="w-56">
          {REWRITES.map(([mode, label]) => (
            <button key={mode} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => rewrite({ action: "rewrite", mode })} className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-fg/[0.05]">
              <Sparkles className="size-3.5 text-[#7c5cdb]" /> {label}
            </button>
          ))}
          <div className="mx-2 my-1 h-px bg-border" />
          {["Hindi", "English", "Spanish", "French", "Arabic"].map((l) => (
            <button key={l} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => rewrite({ action: "translate", language: l })} className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-fg/[0.05]">
              <Languages className="size-3.5 text-muted" /> Translate to {l}
            </button>
          ))}
        </Pop>
      )}
    </BubbleMenu>
  );
}

function B({ label, on, onClick, children }: { label: string; on?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button type="button" className="doc-tool" data-on={on ? "true" : undefined} aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

function CommentBubble({ editor, onComment }: { editor: Editor; onComment: () => void }) {
  return (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 8 }} shouldShow={({ from, to }) => to > from} className="doc-pop z-[60] rounded-[12px] border border-border bg-[var(--surface-solid)] p-1 shadow-lg">
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onComment} className="doc-tool gap-1.5 !px-2.5 text-[12.5px] font-medium">
        <MessageSquarePlus /> Comment
      </button>
    </BubbleMenu>
  );
}

function ImageBubble({ editor }: { editor: Editor }) {
  const st = useEditorState({ editor, selector: ({ editor: e }) => ({ on: e.isActive("image"), width: Number(e.getAttributes("image").width ?? 100), align: String(e.getAttributes("image").align ?? "center"), alt: String(e.getAttributes("image").alt ?? "") }) });
  const set = (attrs: Record<string, unknown>) => editor.chain().focus().updateAttributes("image", attrs).run();
  return (
    <BubbleMenu editor={editor} pluginKey="imageBubble" options={{ placement: "top", offset: 8 }} shouldShow={({ editor: e }) => e.isActive("image")} className="doc-pop z-[60] flex items-center gap-0.5 rounded-[12px] border border-border bg-[var(--surface-solid)] p-1 shadow-lg">
      {st.on && (
        <>
          {[25, 50, 75, 100].map((w) => (
            <button key={w} type="button" className="doc-tool !px-2 text-[12px] font-medium tabular-nums" data-on={st.width === w ? "true" : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ width: w })}>
              {w}%
            </button>
          ))}
          <span className="doc-sep" />
          {(
            [
              ["left", <AlignLeft key="l" />],
              ["center", <AlignCenter key="c" />],
              ["right", <AlignRight key="r" />],
            ] as const
          ).map(([a, i]) => (
            <button key={a} type="button" className="doc-tool" aria-label={`Align ${a}`} data-on={st.align === a ? "true" : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ align: a })}>
              {i}
            </button>
          ))}
          <span className="doc-sep" />
          <button
            type="button"
            className="doc-tool !px-2 text-[12px]"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const alt = window.prompt("Describe the image for people who can't see it", st.alt);
              if (alt !== null) set({ alt: alt.slice(0, 300) });
            }}
          >
            Alt text
          </button>
          <button type="button" className="doc-tool text-danger" aria-label="Delete image" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteSelection().run()}>
            <X />
          </button>
        </>
      )}
    </BubbleMenu>
  );
}
