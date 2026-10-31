"use client";

import clsx from "clsx";
import {
  MessageSquare, Share2, GitBranch, AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Cloud, CloudOff, Code2, Copy, Eye, EyeOff, FileText, History, Image as ImageIcon, Keyboard, Layers, Layers3, ListChecks, Loader2, Monitor, MoreHorizontal, Palette, PanelRight, Plus, Redo2, Rocket, Smartphone, Sparkles, Tablet, Trash2, Undo2, X, GripVertical, Plug, ClipboardCopy, ClipboardPaste, Paintbrush, PaintBucket,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { HistoryDialog } from "../history-dialog";
import { Dialog, Menu, Segmented, useToast } from "../ui/overlays";
import { ButtonLink, ErrorState, Kbd, Notice, Spinner } from "../ui/primitives";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { createSection, SITE_DOC_PATH, sectionDef, type Breakpoint, type Section } from "@/lib/site/model";
import { copySection, copyStyle, pasteSection, pasteStyle } from "./clipboard";
import { reviewPage } from "@/lib/site/review";
import type { Catalog } from "@/lib/store/storefront";
import { AiBar } from "./ai-bar";
import { BranchBar, BranchesDialog, MergeDialog, useBranches } from "./branches";
import { CommentsPanel, PresenceAvatars, ShareDialog, useComments, usePresence } from "./collab";
import { useSession } from "../shell/session-context";
import { Canvas } from "./canvas";
import { BuilderContext, type BuilderCtx } from "./context";
import { Inspector } from "./inspector";
import { MediaPanel, MediaPicker } from "./media";
import { instantiate, syncGlobal } from "@/lib/site/globals";
import { setPath } from "./advanced-panel";
import { AddPanel, cloneSection, LANGUAGES, LayersPanel, moveSection, PagesPanel, ReviewPanel } from "./panels";
import { StylePanel } from "./style-panel";
import { ConnectionsPanel } from "./connections";
import { useSiteDoc, type SaveState } from "./use-site-doc";
import { VariationsDialog } from "./variations";
import { Keys, useShortcuts } from "../ui/shortcut";

type RailTab = "add" | "layers" | "pages" | "media" | "style" | "connect" | "review" | "comments";

const SAVE: Record<SaveState, { label: string; icon: ReactNode }> = {
  loading: { label: "Loading", icon: <Loader2 className="size-3.5 animate-spin" /> },
  saved: { label: "Saved", icon: <Check className="size-3.5 text-success" /> },
  unsaved: { label: "Saving soon", icon: <Cloud className="size-3.5" /> },
  saving: { label: "Saving…", icon: <Loader2 className="size-3.5 animate-spin" /> },
  invalid: { label: "Not saved", icon: <AlertTriangle className="size-3.5 text-warning" /> },
  error: { label: "Save failed", icon: <CloudOff className="size-3.5 text-danger" /> },
  conflict: { label: "Conflict", icon: <AlertTriangle className="size-3.5 text-danger" /> },
};

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};

function RailButton({ icon, label, active, onClick, badge }: { icon: ReactNode; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "relative flex w-full flex-col items-center gap-1 rounded-[10px] py-2 text-[10.5px] font-medium transition-colors [&>svg]:size-[18px]",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {icon}
      {label}
      {!!badge && <span className="absolute top-1 right-2 flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] leading-4 text-white" aria-label={`${badge} suggestions`}>{badge}</span>}
    </button>
  );
}

const SHORTCUTS: [string, string][] = [
  // Written once; shown as ⌘/⌥/⇧ on Apple devices and Ctrl/Alt/Shift elsewhere.
  ["mod+z / mod+shift+z", "Undo / redo"],
  ["mod+s", "Save now"],
  ["mod+d", "Duplicate selected section"],
  ["mod+c / mod+v", "Copy / paste a section (works across pages and web apps)"],
  ["mod+alt+c / mod+alt+v", "Copy / paste a section's style"],
  ["Drag", "Sections from + Add onto the page, or by the ⠿ handle to move them"],
  ["backspace", "Delete selected section"],
  ["alt+up / alt+down", "Move selected section"],
  ["/", "Ask AI"],
  ["p", "Toggle preview"],
  ["1 / 2 / 3", "Desktop / tablet / mobile"],
  ["esc", "Deselect / close"],
  ["mod+k", "Command palette"],
  ["?", "Show shortcuts"],
];

function Welcome({ onClose }: { onClose: () => void }) {
  return (
    <div className="glass-strong animate-in absolute right-3 bottom-36 left-3 z-20 rounded-[20px] p-4 sm:right-auto sm:bottom-20 sm:left-5 sm:w-[300px]">
      <p className="text-[13px] font-semibold">Welcome to your site editor</p>
      <ol className="mt-2 grid gap-1.5 text-xs text-muted">
        <li><strong className="text-fg">Click anything</strong> on the page to edit it on the right.</li>
        <li><strong className="text-fg">+ Add</strong> inserts sections, each previewed in your style.</li>
        <li><strong className="text-fg">Style</strong> changes the whole look in one click.</li>
        <li><strong className="text-fg">Ask AI</strong> for any change, then review it before it applies.</li>
      </ol>
      <button onClick={onClose} className="mt-3 h-8 w-full rounded-[var(--radius-md)] bg-fg text-[13px] font-medium text-bg hover:opacity-90">
        Got it
      </button>
    </div>
  );
}

const iconBtn = "flex size-9 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30";

export function Builder({ projectId, branchId = null }: { projectId: string; branchId?: string | null }) {
  const router = useRouter();
  const { keys: keysOf, withKeys } = useShortcuts();
  const project = useProject(projectId);
  const perms = project.data?.permissions ?? [];
  const canWrite = perms.includes("design:write");
  const site = useSiteDoc(projectId, canWrite, branchId);
  const branchList = useBranches(projectId);
  const branch = branchId ? (branchList.data?.branches.find((b) => b.id === branchId) ?? null) : null;
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [mergeInto, setMergeInto] = useState<"main" | "branch" | null>(null);
  const openBranch = useCallback(
    async (id: string | null) => {
      await site.flush();
      setBranchesOpen(false);
      router.push(`/projects/${projectId}/builder${id ? `?branch=${id}` : ""}`);
    },
    [projectId, router, site],
  );
  const usesStore = !!site.doc?.pages.some((p) => p.sections.some((s) => s.type === "productGrid" || s.type === "collectionList"));
  // Live products for store sections; without a store the canvas shows placeholders.
  const catalog = useQuery({
    queryKey: ["store", projectId, "catalog"],
    queryFn: () => api<{ catalog: Catalog | null }>(`/api/v1/projects/${projectId}/store/catalog`).then((r) => r.catalog),
    enabled: usesStore,
    retry: false,
    staleTime: 30_000,
  });
  const toast = useToast();
  const [pageId, setPageId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A heading, paragraph or button selected inside the section (field path).
  const [selectedEl, setSelectedEl] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Breakpoint>(() => (typeof window === "undefined" ? "desktop" : window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop"));
  const [preview, setPreview] = useState(false);
  const [rail, setRail] = useState<RailTab | null>(() => (typeof window !== "undefined" && window.innerWidth < 1024 ? null : "layers"));
  const [rightOpen, setRightOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [variationsOpen, setVariationsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPreset, setAiPreset] = useState<string | null>(null);
  const [mediaPick, setMediaPick] = useState<{ cb: (url: string, alt?: string) => void } | null>(null);
  const [welcome, setWelcome] = useState(() => {
    try {
      return typeof window !== "undefined" && !localStorage.getItem("cc-builder-welcome");
    } catch {
      return false;
    }
  });

  const doc = site.doc;
  const page = useMemo(() => doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0] ?? null, [doc, pageId]);
  const selected = page?.sections.find((s) => s.id === selectedId) ?? null;
  const readOnly = !canWrite;
  const reviewCount = useMemo(() => (doc && page ? reviewPage(doc, page).filter((f) => f.severity !== "low").length : 0), [doc, page]);
  const { user } = useSession();
  const peers = usePresence(projectId, page?.id ?? "", selectedId, !!page);
  const comments = useComments(projectId);
  const openComments = (comments.data?.comments ?? []).filter((c) => c.pageId === page?.id && !c.parentId && !c.resolvedAt).length;
  const [shareOpen, setShareOpen] = useState(false);
  // Tell the editor when a teammate's saved changes were loaded.
  const remoteAt = site.remote?.at;
  const remoteName = site.remote?.name;
  useEffect(() => {
    if (remoteAt) toast({ tone: "info", title: `Updated with ${remoteName ?? "a teammate"}'s changes` });
  }, [remoteAt, remoteName, toast]);

  const changePage = useCallback((id: string) => {
    setPageId(id);
    setSelectedId(null);
  }, []);
  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedEl(null);
    if (id) setRightOpen(true);
  }, []);
  const onElement = useCallback((id: string, path: string) => {
    setSelectedId(id);
    setSelectedEl(path);
    setRightOpen(true);
  }, []);
  const onText = useCallback(
    (id: string, path: string, value: string) => {
      site.update((d) => {
        for (const p of d.pages) {
          const s = p.sections.find((x) => x.id === id);
          if (!s) continue;
          setPath(s.props, path, value);
          syncGlobal(d, s);
          return;
        }
      }, `${id}.${path}`);
    },
    [site],
  );
  const askAi = useCallback((instruction?: string) => {
    if (instruction) setAiPreset(`${instruction}#${Date.now()}`);
    setAiOpen(true);
  }, []);

  const insertGlobal = useCallback(
    (globalId: string) => {
      if (!page) return;
      let id: string | null = null;
      site.update((d) => {
        const inst = instantiate(d, globalId);
        if (!inst) return;
        id = inst.id;
        const p = d.pages.find((x) => x.id === page.id)!;
        const sel = p.sections.findIndex((x) => x.id === selectedId);
        const footer = p.sections.findIndex((x) => x.type === "footer");
        p.sections.splice(sel >= 0 ? sel + 1 : footer >= 0 ? footer : p.sections.length, 0, inst);
      });
      if (id) {
        setSelectedId(id);
        setRightOpen(true);
      }
    },
    [page, selectedId, site],
  );

  const insert = useCallback(
    (type: string) => {
      if (!page) return;
      const s = createSection(type);
      site.update((d) => {
        const p = d.pages.find((x) => x.id === page.id)!;
        const sel = p.sections.findIndex((x) => x.id === selectedId);
        const footer = p.sections.findIndex((x) => x.type === "footer");
        p.sections.splice(sel >= 0 ? sel + 1 : footer >= 0 ? footer : p.sections.length, 0, s);
      });
      setSelectedId(s.id);
      setRightOpen(true);
      toast({ tone: "success", title: `${sectionDef(type)?.label} added`, description: "Edit its content on the right." });
    },
    [page, selectedId, site, toast],
  );

  const sectionAction = useCallback(
    (action: "up" | "down" | "duplicate" | "delete" | "hide" | "copy" | "paste" | "copyStyle" | "pasteStyle") => {
      if (!page || readOnly) return;
      if (action === "paste") {
        const s = pasteSection(site.doc!);
        if (!s) return void toast({ tone: "info", title: "Nothing to paste", description: `Copy a section first${keysOf("mod+c") ? ` (${keysOf("mod+c")})` : ""}, here or in another web app.` });
        site.update((d) => {
          const p = d.pages.find((x) => x.id === page.id)!;
          const sel = p.sections.findIndex((x) => x.id === selectedId);
          const footer = p.sections.findIndex((x) => x.type === "footer");
          p.sections.splice(sel >= 0 ? sel + 1 : footer >= 0 ? footer : p.sections.length, 0, s);
        });
        setSelectedId(s.id);
        toast({ tone: "success", title: "Section pasted" });
        return;
      }
      if (!selectedId) return;
      const i = page.sections.findIndex((s) => s.id === selectedId);
      if (i < 0) return;
      if (action === "copy") {
        copySection(page.sections[i]);
        toast({ tone: "success", title: "Section copied", description: keysOf("mod+v") ? `Paste it with ${keysOf("mod+v")} — on any page, or in another web app.` : "Paste it from the section menu — on any page, or in another web app." });
      }
      if (action === "copyStyle") {
        copyStyle(page.sections[i].style);
        toast({ tone: "success", title: "Style copied", description: "Select another section and paste its style." });
      }
      if (action === "pasteStyle") {
        const st = pasteStyle();
        if (!st) return void toast({ tone: "info", title: "No style copied yet" });
        site.update((d) => {
          d.pages.find((p) => p.id === page.id)!.sections[i].style = structuredClone(st);
        });
        toast({ tone: "success", title: "Style pasted" });
      }
      if (action === "up") site.update((d) => moveSection(d, page.id, i, i - 1));
      if (action === "down") site.update((d) => moveSection(d, page.id, i, i + 1));
      if (action === "duplicate") {
        const copy = cloneSection(page.sections[i]);
        site.update((d) => d.pages.find((p) => p.id === page.id)!.sections.splice(i + 1, 0, copy));
        setSelectedId(copy.id);
      }
      if (action === "hide") {
        site.update((d) => {
          const s = d.pages.find((p) => p.id === page.id)!.sections[i];
          s.style.hideOn = s.style.hideOn.includes(viewport) ? s.style.hideOn.filter((b) => b !== viewport) : [...s.style.hideOn, viewport];
        });
        toast({ tone: "info", title: `Hidden on ${viewport}`, description: "Show it again from Design → Visibility." });
      }
      if (action === "delete") {
        site.update((d) => void d.pages.find((p) => p.id === page.id)!.sections.splice(i, 1));
        setSelectedId(null);
        toast({ tone: "info", title: "Section deleted", description: keysOf("mod+z") ? `Press ${keysOf("mod+z")} to undo.` : "Tap Undo to bring it back." });
      }
    },
    [page, selectedId, readOnly, site, toast, viewport, keysOf],
  );

  /** A section dropped on the canvas from the gallery, before section number `index`. */
  const dropSection = useCallback(
    (payload: string, index: number) => {
      if (!page || readOnly) return;
      let made: Section | null = null;
      site.update((d) => {
        const p = d.pages.find((x) => x.id === page.id)!;
        if (payload.startsWith("type:")) made = createSection(payload.slice(5));
        else if (payload.startsWith("global:")) made = instantiate(d, payload.slice(7)) ?? null;
        if (made) p.sections.splice(Math.min(index, p.sections.length), 0, made);
      });
      const m = made as Section | null;
      if (m) {
        setSelectedId(m.id);
        setRightOpen(true);
        toast({ tone: "success", title: `${sectionDef(m.type)?.label ?? "Section"} added`, description: "Edit its content on the right." });
      }
    },
    [page, readOnly, site, toast],
  );
  /** A section dragged by its handle: `index` is where it was dropped, counted before the move. */
  const moveTo = useCallback(
    (id: string, index: number) => {
      if (!page || readOnly) return;
      const from = page.sections.findIndex((s) => s.id === id);
      if (from < 0) return;
      const to = index > from ? index - 1 : index;
      if (to !== from) site.update((d) => moveSection(d, page.id, from, to));
    },
    [page, readOnly, site],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void site.flush();
        return;
      }
      if (isTyping(e) || document.querySelector("dialog[open]")) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) site.redo();
        else site.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        site.redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        sectionAction("duplicate");
      } else if (mod && e.altKey && e.code === "KeyC") {
        e.preventDefault();
        sectionAction("copyStyle");
      } else if (mod && e.altKey && e.code === "KeyV") {
        e.preventDefault();
        sectionAction("pasteStyle");
      } else if (mod && e.key.toLowerCase() === "c" && selectedId && !window.getSelection()?.toString()) {
        e.preventDefault();
        sectionAction("copy");
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        sectionAction("paste");
      } else if (e.altKey && e.key === "ArrowUp") sectionAction("up");
      else if (e.altKey && e.key === "ArrowDown") sectionAction("down");
      else if (e.key === "Escape") {
        if (aiOpen) setAiOpen(false);
        else setSelectedId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        sectionAction("delete");
      } else if (e.key === "/" && !mod) {
        e.preventDefault();
        askAi();
      } else if (e.key === "?") setShortcutsOpen(true);
      else if (e.key.toLowerCase() === "p" && !mod && !e.altKey) setPreview((p) => !p);
      else if (["1", "2", "3"].includes(e.key) && !mod) setViewport((["desktop", "tablet", "mobile"] as const)[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [site, selectedId, sectionAction, askAi, aiOpen]);

  const ctx = useMemo<BuilderCtx>(() => ({ projectId, viewport, setViewport, openMedia: (cb) => setMediaPick({ cb }), readOnly, update: site.update }), [projectId, viewport, readOnly, site.update]);

  if (project.isError) return <ErrorState title="Project unavailable" message={errorMessage(project.error)} />;
  if (site.loadError)
    return (
      <div className="mx-auto max-w-lg p-8">
        <Notice tone="danger" title="The editor cannot open this site" action={<ButtonLink href={`/projects/${projectId}/ide`} size="sm">Open in IDE</ButtonLink>}>
          <span className="whitespace-pre-wrap">{site.loadError}</span>
        </Notice>
      </div>
    );
  if (!doc || !page || !project.data)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner label="Loading editor" />
      </div>
    );

  const save = SAVE[site.state];
  const toggleRail = (t: RailTab) => setRail((r) => (r === t ? null : t));
  const railPanel: Record<RailTab, { title: string; body: ReactNode }> = {
    connect: { title: "Connections", body: <ConnectionsPanel projectId={projectId} page={page} onAdd={insert} readOnly={readOnly} /> },
    add: { title: "Add a section", body: <AddPanel doc={doc} page={page} onInsert={insert} onInsertGlobal={insertGlobal} readOnly={readOnly} /> },
    layers: { title: "Layers", body: <LayersPanel page={page} selectedId={selectedId} setSelectedId={onSelect} update={site.update} readOnly={readOnly} selectedEl={selectedEl} onElement={readOnly ? undefined : onElement} /> },
    pages: {
      title: "Pages",
      body: (
        <PagesPanel
          doc={doc}
          page={page}
          setPageId={changePage}
          update={site.update}
          readOnly={readOnly}
          onTranslate={(l) => askAi(`Translate every page under /${l} into ${LANGUAGES.find(([c]) => c === l)?.[1] ?? l}.`)}
        />
      ),
    },
    media: { title: "Media", body: <MediaPanel projectId={projectId} readOnly={readOnly} /> },
    style: { title: "Style", body: <StylePanel doc={doc} update={site.update} readOnly={readOnly} /> },
    comments: {
      title: "Comments",
      body: <CommentsPanel projectId={projectId} doc={doc} page={page} selectedId={selectedId} canResolve={canWrite} meId={user.id} onSelect={(id) => onSelect(id)} />,
    },
    review: {
      title: "Design review",
      body: <ReviewPanel doc={doc} page={page} update={site.update} readOnly={readOnly} onLocate={(id) => onSelect(id)} onAskAi={() => askAi("Critique this page like a senior designer, then apply the three improvements with the most impact.")} />,
    },
  };

  return (
    <BuilderContext.Provider value={ctx}>
      <div className="flex h-dvh flex-col">
        <header className="glass-bar relative z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-2 sm:grid sm:grid-cols-[1fr_auto_1fr]">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Link href={`/projects/${projectId}`} aria-label="Back to project" title="Back to project" className={iconBtn}>
              <ArrowLeft className="size-4" />
            </Link>
            <Menu
              label="Pages"
              align="start"
              trigger={(p) => (
                <button {...p} className="flex h-10 min-w-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-left hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] leading-tight font-semibold">{project.data.project.name}</span>
                    <span className="block truncate text-[11px] leading-tight text-muted">
                      {page.title} · {page.path}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-subtle" />
                </button>
              )}
              items={[
                ...doc.pages.slice(0, 20).map((p) => ({ label: `${p.title} — ${p.path}`, icon: p.id === page.id ? <Check /> : <FileText />, onSelect: () => changePage(p.id) })),
                "separator" as const,
                { label: "Manage pages…", icon: <Layers />, onSelect: () => setRail("pages") },
              ]}
            />
          </div>

          <div className="hidden sm:block">
          <Segmented
            label="Device"
            value={viewport}
            onChange={setViewport}
            options={[
              { value: "desktop", label: <Monitor className="size-4" />, title: "Desktop (1)" },
              { value: "tablet", label: <Tablet className="size-4" />, title: "Tablet (2)" },
              { value: "mobile", label: <Smartphone className="size-4" />, title: "Mobile (3)" },
            ]}
          />
          </div>

          <div className="flex shrink-0 items-center justify-end gap-0.5">
            <PresenceAvatars peers={peers} doc={doc} />
            <span className="mr-1.5 hidden items-center gap-1.5 text-xs text-muted xl:inline-flex" role="status" aria-live="polite">
              {save.icon}
              {readOnly ? "View only" : save.label}
            </span>
            <button aria-label="Undo" title={withKeys("Undo", "mod+z")} disabled={!site.canUndo || readOnly} onClick={site.undo} className={iconBtn}>
              <Undo2 className="size-4" />
            </button>
            <button aria-label="Redo" title={withKeys("Redo", "mod+shift+z")} disabled={!site.canRedo || readOnly} onClick={site.redo} className={clsx(iconBtn, "hidden sm:flex")}>
              <Redo2 className="size-4" />
            </button>
            <Menu
              label="More"
              trigger={(p) => (
                <button {...p} aria-label="More" title="More" className={iconBtn}>
                  <MoreHorizontal className="size-4" />
                </button>
              )}
              items={[
                { label: "Share for review", icon: <Share2 />, onSelect: () => setShareOpen(true) },
                { label: branchId ? "Switch branch…" : "Branches…", icon: <GitBranch />, onSelect: () => setBranchesOpen(true) },
                ...(branchId ? [] : [{ label: "Version history", icon: <History />, onSelect: () => setHistoryOpen(true) }]),
                { label: "Open in code editor", icon: <Code2 />, onSelect: () => router.push(`/projects/${projectId}/ide`) },
                { label: "Keyboard shortcuts", icon: <Keyboard />, onSelect: () => setShortcutsOpen(true) },
              ]}
            />
            <button onClick={() => setPreview(!preview)} aria-pressed={preview} className={clsx("hidden h-9 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[13px] font-medium sm:inline-flex", preview ? "bg-fg text-bg" : "text-fg hover:bg-surface-2")}>
              {preview ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {preview ? "Exit preview" : "Preview"}
            </button>
            <button aria-label="Properties" onClick={() => setRightOpen(!rightOpen)} className={clsx(iconBtn, "lg:hidden")}>
              <PanelRight className="size-4" />
            </button>
            <ButtonLink href={`/projects/${projectId}/deployments`} onClick={() => void site.flush()} variant="primary" className="ml-1" icon={<Rocket className="size-3.5" />}>
              <span className="hidden sm:inline">Publish</span>
            </ButtonLink>
          </div>
        </header>

        {branchId && !branch && branchList.isSuccess && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-danger-soft px-4 py-2 text-[13px]">
            <span>This branch no longer exists. Edits here cannot be saved.</span>
            <button className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-1 font-medium" onClick={() => router.push(`/projects/${projectId}/builder`)}>
              Back to main
            </button>
          </div>
        )}
        {branch && (
          <BranchBar
            projectId={projectId}
            branch={branch}
            canWrite={canWrite}
            canDeploy={perms.includes("deploy:preview")}
            flush={site.flush}
            onExit={() => void openBranch(null)}
            onMerge={() => setMergeInto("main")}
            onSync={() => setMergeInto("branch")}
          />
        )}
        {site.state === "conflict" && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-danger-soft px-4 py-2 text-[13px]">
            <span>
              <strong>This site was changed somewhere else</strong> (another tab, a teammate, or an accepted AI change). Your latest edits are not saved yet.
            </span>
            <span className="flex gap-2">
              <button className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-1 font-medium" onClick={() => void site.resolveConflict("theirs")}>
                Load their version
              </button>
              <button className="rounded-[var(--radius-md)] bg-danger px-3 py-1 font-medium text-white" onClick={() => void site.resolveConflict("mine")}>
                Keep mine
              </button>
            </span>
          </div>
        )}
        {site.state === "invalid" && (
          <div className="border-b border-border bg-warning-soft px-4 py-2 text-[13px]">
            <strong>Not saved:</strong> {site.problems.slice(0, 3).join("; ")}
          </div>
        )}

        <div className="relative flex min-h-0 flex-1">
          {!preview && (
            <nav aria-label="Editor tools" className="fixed inset-x-0 bottom-0 z-40 flex h-16 shrink-0 flex-row gap-1 border-t border-border bg-surface p-1.5 backdrop-blur-2xl backdrop-saturate-150 md:static md:h-auto md:w-[68px] md:flex-col md:border-t-0 md:border-r">
              <RailButton icon={<Plus />} label="Add" active={rail === "add"} onClick={() => toggleRail("add")} />
              <RailButton icon={<Layers />} label="Layers" active={rail === "layers"} onClick={() => toggleRail("layers")} />
              <RailButton icon={<FileText />} label="Pages" active={rail === "pages"} onClick={() => toggleRail("pages")} />
              <RailButton icon={<ImageIcon />} label="Media" active={rail === "media"} onClick={() => toggleRail("media")} />
              <RailButton icon={<Palette />} label="Style" active={rail === "style"} onClick={() => toggleRail("style")} />
              <RailButton icon={<Plug />} label="Connect" active={rail === "connect"} onClick={() => toggleRail("connect")} />
              <RailButton icon={<ListChecks />} label="Review" active={rail === "review"} onClick={() => toggleRail("review")} badge={reviewCount} />
              <RailButton icon={<MessageSquare />} label="Comments" active={rail === "comments"} onClick={() => toggleRail("comments")} badge={openComments} />
            </nav>
          )}
          {!preview && rail && (
            <aside className="fixed inset-x-0 top-14 bottom-16 z-30 flex flex-col border-r border-border bg-surface shadow-lg backdrop-blur-2xl backdrop-saturate-150 md:absolute md:inset-y-0 md:right-auto md:bottom-0 md:left-[68px] md:w-[300px] lg:static lg:shadow-none">
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pr-1.5 pl-4">
                <h2 className="text-[13px] font-semibold">{railPanel[rail].title}</h2>
                <button aria-label="Close panel" onClick={() => setRail(null)} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{railPanel[rail].body}</div>
            </aside>
          )}

          <main className="relative min-w-0 flex-1 pb-16 md:pb-0">
            <Canvas
              doc={doc}
              page={page}
              viewport={viewport}
              selectedId={preview ? null : selectedId}
              onSelect={onSelect}
              selectedElement={preview ? null : selectedEl}
              onElement={readOnly ? undefined : onElement}
              onText={readOnly ? undefined : onText}
              interactive={!preview}
              catalog={catalog.data ?? null}
              onDropSection={readOnly ? undefined : dropSection}
              onMoveSection={readOnly ? undefined : moveTo}
              overlay={({ rect, scale, frameTop, frameLeft, frameWidth, startMove }) => {
                if (!rect || !selected || readOnly) return null;
                const top = frameTop + rect.top * scale;
                const bottom = top + rect.height * scale;
                if (bottom < frameTop + 8 || rect.top > rect.vh - 8) return null;
                const y = top - 46 < 6 ? Math.max(top, frameTop) + 8 : top - 46;
                const label = sectionDef(selected.type)?.label ?? selected.type;
                const btn = "flex size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-fg [&>svg]:size-4";
                return (
                  <div className="pointer-events-none absolute inset-0 z-10">
                    <div role="toolbar" aria-label={`${label} actions`} className="glass-strong pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5 rounded-[14px] p-1" style={{ top: y, left: frameLeft + frameWidth / 2 }}>
                      {startMove && (
                        <button
                          className={clsx(btn, "cursor-grab active:cursor-grabbing")}
                          title="Drag to move"
                          aria-label="Drag to move"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                            startMove(selected.id);
                          }}
                        >
                          <GripVertical />
                        </button>
                      )}
                      <span className="px-2 text-xs font-semibold whitespace-nowrap">{label}</span>
                      <span className="mx-0.5 h-5 w-px bg-border" />
                      <button className={btn} title="Move up (Alt ↑)" aria-label="Move up" onClick={() => sectionAction("up")}><ArrowUp /></button>
                      <button className={btn} title="Move down (Alt ↓)" aria-label="Move down" onClick={() => sectionAction("down")}><ArrowDown /></button>
                      <button className={btn} title="Compare variations" aria-label="Variations" onClick={() => setVariationsOpen(true)}><Layers3 /></button>
                      <button className={btn} title={withKeys("Duplicate", "mod+d")} aria-label="Duplicate" onClick={() => sectionAction("duplicate")}><Copy /></button>
                      <Menu
                        label="More section actions"
                        trigger={(p) => <button {...p} className={btn} title="Copy, paste and more" aria-label="More section actions"><MoreHorizontal /></button>}
                        items={[
                          { label: withKeys("Copy section", "mod+c"), icon: <ClipboardCopy />, onSelect: () => sectionAction("copy") },
                          { label: withKeys("Paste section below", "mod+v"), icon: <ClipboardPaste />, onSelect: () => sectionAction("paste") },
                          "separator",
                          { label: withKeys("Copy style", "mod+alt+c"), icon: <Paintbrush />, onSelect: () => sectionAction("copyStyle") },
                          { label: withKeys("Paste style", "mod+alt+v"), icon: <PaintBucket />, onSelect: () => sectionAction("pasteStyle") },
                        ]}
                      />
                      <button className={btn} title={`Hide on ${viewport}`} aria-label={`Hide on ${viewport}`} onClick={() => sectionAction("hide")}><EyeOff /></button>
                      <button className={clsx(btn, "text-accent hover:text-accent")} title="Ask AI about this section" aria-label="Ask AI" onClick={() => askAi()}><Sparkles /></button>
                      <span className="mx-0.5 h-5 w-px bg-border" />
                      <button className={clsx(btn, "hover:text-danger")} title="Delete (⌫)" aria-label="Delete section" onClick={() => sectionAction("delete")}><Trash2 /></button>
                    </div>
                  </div>
                );
              }}
            />
            {!preview && (
              <AiBar
                projectId={projectId}
                pageId={page.id}
                selected={selected ? { id: selected.id, label: sectionDef(selected.type)?.label ?? selected.type } : null}
                flush={site.flush}
                onApplied={() => void site.reload()}
                canUse={perms.includes("ai:use") && !branchId}
                blockedReason={branchId ? "AI edits work on main. Merge this branch, or switch to main to use AI." : undefined}
                open={aiOpen}
                setOpen={setAiOpen}
                preset={aiPreset}
              />
            )}
            {welcome && !preview && (
              <Welcome
                onClose={() => {
                  setWelcome(false);
                  try {
                    localStorage.setItem("cc-builder-welcome", "1");
                  } catch {
                    /* storage unavailable */
                  }
                }}
              />
            )}
          </main>

          {!preview && (
            <aside className={clsx("w-full shrink-0 flex-col border-l border-border bg-surface backdrop-blur-2xl backdrop-saturate-150 sm:w-[320px]", rightOpen ? "absolute top-0 right-0 bottom-16 z-30 flex shadow-lg md:bottom-0 lg:static lg:shadow-none" : "hidden lg:flex")}>
              <Inspector
                doc={doc}
                page={page}
                selected={selected}
                element={selectedEl}
                onElementClose={() => setSelectedEl(null)}
                onClose={() => {
                  setSelectedId(null);
                  if (window.innerWidth < 1024) setRightOpen(false);
                }}
                onVariations={() => setVariationsOpen(true)}
                onOpenStyle={() => setRail("style")}
                onAskAi={() => askAi()}
              />
            </aside>
          )}
        </div>

        <BranchesDialog projectId={projectId} open={branchesOpen} onClose={() => setBranchesOpen(false)} canWrite={canWrite} currentId={branchId} onOpen={(id) => void openBranch(id)} />
        {branch && mergeInto && (
          <MergeDialog
            projectId={projectId}
            branch={branch}
            into={mergeInto}
            open
            onClose={() => setMergeInto(null)}
            flush={site.flush}
            onDone={() => {
              const into = mergeInto;
              setMergeInto(null);
              void branchList.refetch();
              if (into === "main") void openBranch(null);
              else void site.reload();
            }}
          />
        )}
        <ShareDialog projectId={projectId} open={shareOpen} onClose={() => setShareOpen(false)} canShare={perms.includes("deploy:preview")} />
        <HistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} projectId={projectId} path={SITE_DOC_PATH} currentRevision={site.revision} currentContent={site.savedContent} canRestore={canWrite} onRestored={() => void site.reload()} />
        <MediaPicker projectId={projectId} open={!!mediaPick} onClose={() => setMediaPick(null)} onPick={(u, alt) => mediaPick?.cb(u, alt)} />
        <VariationsDialog
          doc={doc}
          page={page}
          section={selected}
          open={variationsOpen}
          onClose={() => setVariationsOpen(false)}
          onApply={(variant, background) =>
            site.update((d) => {
              const s = d.pages.find((p) => p.id === page.id)!.sections.find((x) => x.id === selectedId)!;
              s.variant = variant;
              s.style.background = background;
            })
          }
        />
        <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" size="sm">
          <dl className="grid gap-2">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-3 text-[13px]">
                <dt className="text-muted">{d}</dt>
                <dd>
                  {k === "Drag" ? <Kbd>Drag</Kbd> : <Keys k={k} always />}
                </dd>
              </div>
            ))}
          </dl>
        </Dialog>
      </div>
    </BuilderContext.Provider>
  );
}
