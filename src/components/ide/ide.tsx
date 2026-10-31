"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Circle,
  FilePlus,
  FileText,
  Folder,
  History,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  Play,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "../shell/session-context";
import { CodocSession, type Peer } from "@/lib/client/codoc";
import { bindMonaco } from "./codoc-binding";
import { Terminal, type TerminalHandle } from "./terminal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TaskReview } from "../ai/task-review";
import { DiffView } from "../ai/diff-view";
import { HistoryDialog } from "../history-dialog";
import { ConfirmDialog, Dialog, Menu, Tabs, useToast } from "../ui/overlays";
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, Spinner, Textarea } from "../ui/primitives";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { useProject } from "@/lib/client/use-project";
import { useTask } from "@/lib/client/use-task";
import { parseSiteDoc, SITE_DOC_PATH } from "@/lib/site/model";
import { useShortcuts } from "../ui/shortcut";

type FileMeta = { path: string; revision: number };
type Tab = { path: string; saved: string; draft: string; revision: number; stale: boolean };
type Problem = { path: string; line?: number; message: string; severity: "error" | "warning" };

const LANG: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", md: "markdown", css: "css", html: "html", yml: "yaml", yaml: "yaml", sql: "sql" };
const langFor = (p: string) => LANG[p.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const t = document.documentElement.dataset.theme;
      setDark(t ? t === "dark" : mq.matches);
    };
    read();
    mq.addEventListener("change", read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", read);
      mo.disconnect();
    };
  }, []);
  return dark;
}

type TreeNode = { name: string; path: string; children: Map<string, TreeNode>; file?: FileMeta };

function buildTree(files: FileMeta[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map() });
      node = node.children.get(part)!;
      if (i === parts.length - 1) node.file = f;
    });
  }
  return root;
}

function TreeView({ node, depth, open, toggle, active, onOpen, onAction, dirty }: { node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void; active: string | null; onOpen: (p: string) => void; onAction: (a: "rename" | "delete" | "history", p: string) => void; dirty: Set<string> }) {
  const entries = [...node.children.values()].sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name));
  return (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Files" : undefined}>
      {entries.map((n) =>
        n.file ? (
          <li key={n.path} role="treeitem" aria-selected={active === n.path} className="group flex items-center">
            <button onClick={() => onOpen(n.path)} style={{ paddingLeft: 8 + depth * 12 }} className={clsx("flex h-7 min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[13px]", active === n.path ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
              <FileText className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{n.name}</span>
              {dirty.has(n.path) && <Circle className="ml-auto size-2 shrink-0 fill-current text-accent" aria-label="Unsaved" />}
            </button>
            <Menu
              label={`Actions for ${n.name}`}
              trigger={(p) => <IconButton {...p} label={`Actions for ${n.name}`} size="sm" className="!h-7 opacity-0 group-hover:opacity-100 focus:opacity-100 aria-expanded:opacity-100" icon={<MoreHorizontal className="size-3.5" />} />}
              items={[
                { label: "History", icon: <History />, onSelect: () => onAction("history", n.path) },
                { label: "Rename or move", icon: <Pencil />, disabled: n.path === SITE_DOC_PATH, onSelect: () => onAction("rename", n.path) },
                { label: "Delete", icon: <Trash2 />, danger: true, disabled: n.path === SITE_DOC_PATH, onSelect: () => onAction("delete", n.path) },
              ]}
            />
          </li>
        ) : (
          <li key={n.path} role="treeitem" aria-selected={false} aria-expanded={open.has(n.path)}>
            <button onClick={() => toggle(n.path)} style={{ paddingLeft: 8 + depth * 12 }} className="flex h-7 w-full items-center gap-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
              {open.has(n.path) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <Folder className="size-3.5" aria-hidden />
              <span className="truncate">{n.name}</span>
            </button>
            {open.has(n.path) && <TreeView node={n} depth={depth + 1} open={open} toggle={toggle} active={active} onOpen={onOpen} onAction={onAction} dirty={dirty} />}
          </li>
        ),
      )}
    </ul>
  );
}

function SearchPanel({ projectId, onOpen }: { projectId: string; onOpen: (path: string, line: number) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const res = useQuery({ queryKey: ["search", projectId, term], queryFn: () => api<{ results: { path: string; matches: { line: number; text: string }[] }[]; truncated: boolean }>(`/api/v1/projects/${projectId}/search?q=${encodeURIComponent(term)}`), enabled: term.length >= 2 });
  return (
    <div className="grid gap-2 p-2">
      <form onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in files and press Enter" aria-label="Search in files" />
      </form>
      {res.isFetching && <Spinner />}
      {res.isError && <p className="text-xs text-danger">{errorMessage(res.error)}</p>}
      {res.data && res.data.results.length === 0 && <p className="text-[13px] text-muted">No matches.</p>}
      {res.data?.results.map((r) => (
        <div key={r.path}>
          <p className="truncate font-mono text-xs font-medium">{r.path}</p>
          <ul>
            {r.matches.map((m) => (
              <li key={m.line}>
                <button onClick={() => onOpen(r.path, m.line)} className="flex w-full gap-2 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-left font-mono text-xs hover:bg-surface-2">
                  <span className="w-8 shrink-0 text-right text-subtle">{m.line}</span>
                  <span className="truncate text-muted">{m.text.trim()}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {res.data?.truncated && <p className="text-xs text-subtle">Showing the first 500 matches.</p>}
    </div>
  );
}

function CodeAssistant({ projectId, activePath, openPaths, onApplied, canUse, flushAll }: { projectId: string; activePath: string | null; openPaths: string[]; onApplied: () => void; canUse: boolean; flushAll: () => Promise<boolean> }) {
  const toast = useToast();
  const [instruction, setInstruction] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTask(taskId);
  const start = useMutation({
    mutationFn: async () => {
      if (!(await flushAll())) throw new Error("Save or discard your open changes first.");
      const paths = [activePath, ...openPaths].filter((p, i, a): p is string => !!p && a.indexOf(p) === i).slice(0, 20);
      return api<{ task: { id: string } }>(`/api/v1/projects/${projectId}/ai/tasks`, { method: "POST", body: { kind: "code_edit", input: { instruction, paths } } });
    },
    onSuccess: (r) => {
      setTaskId(r.task.id);
      setInstruction("");
    },
    onError: (e) => toast({ tone: "error", title: "Could not start", description: errorMessage(e) }),
  });
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {task.data ? (
          <TaskReview task={task.data} beforeApply={flushAll} onApplied={onApplied} onRetried={setTaskId} />
        ) : (
          <div className="grid gap-2 text-[13px] text-muted">
            <p>Ask for changes across the project. The assistant reads your files (open files first), proposes complete edits, and you review each diff before anything is written.</p>
            <p className="text-xs text-subtle">Examples: “Explain what site/site.json controls”, “Add a CHANGELOG.md”, “Add an FAQ question about parking to the home page”.</p>
            <p className="text-xs text-subtle">It doesn&apos;t run code itself — use the Terminal below to run scripts in the sandbox.</p>
          </div>
        )}
      </div>
      <form className="border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); if (instruction.trim().length >= 3) start.mutate(); }}>
        {activePath && <p className="mb-1.5 truncate text-xs text-muted">Context: <span className="font-mono">{activePath}</span>{openPaths.length > 1 ? ` + ${openPaths.length - 1} open` : ""}</p>}
        <Textarea
          rows={3}
          value={instruction}
          disabled={!canUse}
          maxLength={4000}
          aria-label="Ask the coding assistant"
          placeholder={canUse ? "Describe a change…" : "Your role cannot change code"}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && instruction.trim().length >= 3) {
              e.preventDefault();
              start.mutate();
            }
          }}
        />
        <div className="mt-2 flex justify-between">
          {taskId ? <Button size="sm" variant="ghost" onClick={() => setTaskId(null)}>New request</Button> : <span />}
          <Button type="submit" size="sm" variant="primary" disabled={!canUse || instruction.trim().length < 3} loading={start.isPending}>Send</Button>
        </div>
      </form>
    </div>
  );
}

export function Ide({ projectId }: { projectId: string }) {
  const saveKeys = useShortcuts().keys("mod+s");
  const project = useProject(projectId);
  const qc = useQueryClient();
  const toast = useToast();
  const dark = useDarkMode();
  const perms = useMemo(() => project.data?.permissions ?? [], [project.data]);
  const canWritePath = useCallback((p: string) => perms.includes(p === SITE_DOC_PATH ? "design:write" : "code:write"), [perms]);

  const files = useQuery({ queryKey: ["files", projectId], queryFn: () => api<{ files: FileMeta[] }>(`/api/v1/projects/${projectId}/files`).then((r) => r.files) });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set(["site"]));
  const [leftTab, setLeftTab] = useState<"files" | "search">("files");
  const [bottomTab, setBottomTab] = useState<"problems" | "terminal">("problems");
  const [showAi, setShowAi] = useState(true);
  const [markers, setMarkers] = useState<Record<string, Problem[]>>({});
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ path: string; server: string; revision: number } | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string[]>>({});
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const { user } = useSession();
  // Live co-editing: one shared session per open tab.
  const sessions = useRef(new Map<string, CodocSession>());
  const [shared, setShared] = useState<Set<string>>(new Set());
  const [peers, setPeers] = useState<Record<string, Peer[]>>({});
  const [mounted, setMounted] = useState<string | null>(null);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const pendingLine = useRef<number | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const openFile = useCallback(
    async (path: string, line?: number) => {
      pendingLine.current = line ?? null;
      setActive(path);
      if (tabsRef.current.some((t) => t.path === path)) {
        if (line) editorRef.current?.revealLineInCenter(line);
        return;
      }
      try {
        const f = await api<{ content: string; revision: number }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(path)}`);
        setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, { path, saved: f.content, draft: f.content, revision: f.revision, stale: false }]));
        void share(path);
      } catch (e) {
        toast({ tone: "error", title: "Could not open file", description: errorMessage(e) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- share is stable for a project
    [projectId, toast],
  );

  /** Joins the file's shared document; on failure the tab keeps working on its own. */
  async function share(path: string) {
    if (sessions.current.has(path)) return;
    let s: CodocSession;
    try {
      s = await CodocSession.open(projectId, path, { name: user.name });
    } catch {
      return;
    }
    if (!tabsRef.current.some((t) => t.path === path) || sessions.current.has(path)) return s.destroy();
    sessions.current.set(path, s);
    const sync = () => setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, draft: s.text.toString() } : t)));
    s.text.observe(sync);
    sync();
    s.onPeers = (p) => setPeers((x) => ({ ...x, [path]: p }));
    s.onSaved = async () => {
      const f = await api<{ content: string; revision: number }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(path)}`).catch(() => null);
      if (f) setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, saved: f.content, revision: f.revision, stale: false } : t)));
    };
    s.onReset = async () => {
      unshare(path);
      // Changed outside co-editing (builder, AI, restore): reload, or compare if this tab had unsaved edits.
      const f = await api<{ content: string; revision: number }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(path)}`).catch(() => null);
      const t = tabsRef.current.find((x) => x.path === path);
      if (!f || !t) return;
      if (t.draft !== t.saved && t.draft !== f.content) setConflict({ path, server: f.content, revision: f.revision });
      else {
        setTabs((ts) => ts.map((x) => (x.path === path ? { ...x, saved: f.content, draft: f.content, revision: f.revision, stale: false } : x)));
        void share(path);
      }
    };
    setShared((x) => new Set(x).add(path));
  }

  function unshare(path: string) {
    sessions.current.get(path)?.destroy();
    sessions.current.delete(path);
    setShared((x) => {
      const n = new Set(x);
      n.delete(path);
      return n;
    });
    setPeers((x) => ({ ...x, [path]: [] }));
  }

  useEffect(() => {
    const map = sessions.current;
    return () => {
      for (const s of map.values()) s.destroy();
      map.clear();
    };
  }, []);

  // Bind the visible editor to its shared document.
  useEffect(() => {
    const s = active ? sessions.current.get(active) : undefined;
    if (!s || mounted !== active || !editorRef.current || !monacoRef.current) return;
    return bindMonaco(editorRef.current, monacoRef.current, s.text, s.awareness);
  }, [active, mounted, shared]);

  useEffect(() => {
    if (files.data && tabsRef.current.length === 0 && files.data.some((f) => f.path === SITE_DOC_PATH)) void openFile(SITE_DOC_PATH);
  }, [files.data, openFile]);

  const tab = tabs.find((t) => t.path === active) ?? null;
  const dirty = useMemo(() => new Set(tabs.filter((t) => t.draft !== t.saved).map((t) => t.path)), [tabs]);

  const save = useCallback(
    async (path: string, opts: { force?: boolean } = {}): Promise<boolean> => {
      const t = tabsRef.current.find((x) => x.path === path);
      if (!t || t.draft === t.saved) return true;
      try {
        const session = sessions.current.get(path);
        if (session && !opts.force) {
          const r = await session.save();
          setTabs((ts) => ts.map((x) => (x.path === path ? { ...x, saved: r.content, revision: r.revision, stale: false } : x)));
          setSaveErrors((e) => ({ ...e, [path]: [] }));
          qc.invalidateQueries({ queryKey: ["files", projectId] });
          return true;
        }
        let base = t.revision;
        if (opts.force) base = (await api<{ revision: number }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(path)}`)).revision;
        const r = await api<{ revision: number }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(path)}`, { method: "PUT", body: { content: t.draft, baseRevision: base } });
        setTabs((ts) => ts.map((x) => (x.path === path ? { ...x, saved: t.draft, revision: r.revision, stale: false } : x)));
        setSaveErrors((e) => ({ ...e, [path]: [] }));
        qc.invalidateQueries({ queryKey: ["files", projectId] });
        return true;
      } catch (e) {
        if (e instanceof ApiClientError && e.code === "revision_conflict") {
          const server = await api<{ content: string; revision: number }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(path)}`);
          setConflict({ path, server: server.content, revision: server.revision });
        } else if (e instanceof ApiClientError && e.code === "validation_failed") {
          setSaveErrors((s) => ({ ...s, [path]: (e.details as { problems?: string[] })?.problems ?? [e.message] }));
          setBottomTab("problems");
          toast({ tone: "error", title: "Not saved", description: e.message });
        } else toast({ tone: "error", title: "Could not save", description: errorMessage(e) });
        return false;
      }
    },
    [projectId, qc, toast],
  );

  const flushAll = useCallback(async () => {
    for (const t of tabsRef.current) if (t.draft !== t.saved && !(await save(t.path))) return false;
    return true;
  }, [save]);

  const reloadAfterApply = useCallback(async () => {
    const list = await qc.fetchQuery({ queryKey: ["files", projectId], queryFn: () => api<{ files: FileMeta[] }>(`/api/v1/projects/${projectId}/files`).then((r) => r.files), staleTime: 0 });
    const byPath = new Map(list.map((f) => [f.path, f]));
    const next: Tab[] = [];
    for (const t of tabsRef.current) {
      const meta = byPath.get(t.path);
      if (!meta) continue;
      if (meta.revision === t.revision) next.push(t);
      else if (t.draft === t.saved) {
        const f = await api<{ content: string; revision: number }>(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(t.path)}`);
        next.push({ ...t, saved: f.content, draft: f.content, revision: f.revision });
      } else next.push({ ...t, stale: true });
    }
    setTabs(next);
    if (active && !byPath.has(active)) setActive(next[0]?.path ?? null);
  }, [active, projectId, qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (active) void save(active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, save]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (tabsRef.current.some((t) => t.draft !== t.saved)) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const closeTab = (path: string) => {
    const t = tabs.find((x) => x.path === path);
    // Unsaved edits in a shared document stay there for the others; only private edits are lost.
    if (t && t.draft !== t.saved && !sessions.current.has(path) && !window.confirm(`Discard unsaved changes to ${path}?`)) return;
    unshare(path);
    const rest = tabs.filter((x) => x.path !== path);
    setTabs(rest);
    if (active === path) setActive(rest.at(-1)?.path ?? null);
  };

  const createFile = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/files`, { method: "POST", body: { path: newPath, content: "" } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["files", projectId] });
      const p = newPath.trim().replace(/^\/+/, "");
      setOpenDirs((d) => new Set([...d, ...p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))]));
      setNewFileOpen(false);
      setNewPath("");
      void openFile(p);
    },
    onError: (e) => toast({ tone: "error", title: "Could not create file", description: errorMessage(e) }),
  });
  const rename = useMutation({
    mutationFn: (v: { from: string; to: string }) => {
      const meta = files.data?.find((f) => f.path === v.from);
      return api<{ path: string; revision: number }>(`/api/v1/projects/${projectId}/file/rename`, { method: "POST", body: { ...v, baseRevision: meta?.revision ?? 0 } });
    },
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ["files", projectId] });
      setTabs((ts) => ts.map((t) => (t.path === v.from ? { ...t, path: r.path, revision: r.revision } : t)));
      if (active === v.from) setActive(r.path);
      setRenaming(null);
    },
    onError: (e) => toast({ tone: "error", title: "Could not rename", description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (path: string) => {
      const meta = files.data?.find((f) => f.path === path);
      return api(`/api/v1/projects/${projectId}/file?path=${encodeURIComponent(path)}`, { method: "DELETE", body: { baseRevision: meta?.revision ?? 0 } });
    },
    onSuccess: (_r, path) => {
      qc.invalidateQueries({ queryKey: ["files", projectId] });
      setTabs((ts) => ts.filter((t) => t.path !== path));
      if (active === path) setActive(null);
      setDeleting(null);
      toast({ tone: "success", title: "File deleted", description: "It remains in version history." });
    },
    onError: (e) => toast({ tone: "error", title: "Could not delete", description: errorMessage(e) }),
  });

  const problems = useMemo(() => {
    const out: Problem[] = [];
    for (const t of tabs) {
      if (t.path === SITE_DOC_PATH) {
        const r = parseSiteDoc(t.draft);
        if (!r.ok) r.errors.forEach((m) => out.push({ path: t.path, message: m, severity: "error" }));
      }
      for (const m of saveErrors[t.path] ?? []) out.push({ path: t.path, message: `Save rejected: ${m}`, severity: "error" });
      out.push(...(markers[t.path] ?? []));
    }
    return out;
  }, [tabs, markers, saveErrors]);

  const tree = useMemo(() => buildTree(files.data ?? []), [files.data]);

  if (project.isError) return <ErrorState title="Project unavailable" message={errorMessage(project.error)} />;
  if (!project.data || files.isPending) return <div className="flex h-dvh items-center justify-center"><Spinner label="Loading IDE" /></div>;

  const readOnly = tab ? !canWritePath(tab.path) : true;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <Link href={`/projects/${projectId}`} className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />
          <span className="max-w-40 truncate font-medium text-fg">{project.data.project.name}</span>
        </Link>
        <Badge>AI IDE</Badge>
        <div className="ml-auto flex items-center gap-1">
          <Link href={`/projects/${projectId}/builder`} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg">
            <PanelsTopLeft className="size-4" aria-hidden /> <span className="hidden sm:inline">Builder</span>
          </Link>
          <IconButton label={showAi ? "Hide assistant" : "Show assistant"} onClick={() => setShowAi(!showAi)} className={clsx(showAi && "bg-surface-3 text-fg")} icon={<Sparkles className="size-4" />} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
          <div className="flex items-center gap-1 border-b border-border px-1">
            <Tabs className="flex-1 border-0" value={leftTab} onChange={setLeftTab} tabs={[{ value: "files", label: "Files" }, { value: "search", label: <><Search className="size-3.5" /> Search</> }]} />
            {perms.includes("code:write") && <IconButton label="New file" size="sm" icon={<FilePlus className="size-4" />} onClick={() => setNewFileOpen(true)} />}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {leftTab === "files" ? (
              files.isError ? (
                <ErrorState message={errorMessage(files.error)} onRetry={() => files.refetch()} />
              ) : (
                <TreeView
                  node={tree}
                  depth={0}
                  open={openDirs}
                  toggle={(p) => setOpenDirs((d) => { const n = new Set(d); if (n.has(p)) n.delete(p); else n.add(p); return n; })}
                  active={active}
                  onOpen={(p) => void openFile(p)}
                  dirty={dirty}
                  onAction={(a, p) => (a === "rename" ? setRenaming(p) : a === "delete" ? setDeleting(p) : setHistoryFor(p))}
                />
              )
            ) : (
              <SearchPanel projectId={projectId} onOpen={(p, line) => void openFile(p, line)} />
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div role="tablist" aria-label="Open files" className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-surface-2/50">
            {tabs.map((t) => (
              <div key={t.path} role="tab" aria-selected={t.path === active} className={clsx("group flex shrink-0 items-center border-r border-border text-[13px]", t.path === active ? "bg-bg text-fg" : "text-muted hover:text-fg")}>
                <button className="flex h-full items-center gap-1.5 pr-1 pl-3" onClick={() => setActive(t.path)}>
                  {t.stale && <AlertCircle className="size-3.5 text-warning" aria-label="Changed on the server" />}
                  {t.path.split("/").pop()}
                  {t.draft !== t.saved && <Circle className="size-2 fill-current text-accent" aria-label="Unsaved" />}
                </button>
                <button aria-label={`Close ${t.path}`} onClick={() => closeTab(t.path)} className="mr-1 rounded p-0.5 opacity-60 hover:bg-surface-3 hover:opacity-100">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          {tab && (
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted">
              <span className="truncate font-mono">{tab.path}</span>
              <span className="text-subtle">r{tab.revision}</span>
              {readOnly && <Badge>Read only for your role</Badge>}
              {tab.stale && <Badge tone="warning">Changed on server — save to compare</Badge>}
              {shared.has(tab.path) && (
                <span className="flex items-center gap-1" title={(peers[tab.path] ?? []).length ? `Also editing: ${(peers[tab.path] ?? []).map((p) => p.name).join(", ")}` : "Live: others who open this file edit with you"}>
                  <span className="size-1.5 rounded-full bg-success" aria-hidden />
                  <span className="text-subtle">Live</span>
                  {(peers[tab.path] ?? []).slice(0, 4).map((p) => (
                    <span key={p.clientId} className="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: p.color }} aria-label={p.name}>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                  ))}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                {/\.m?js$/.test(tab.path) && perms.includes("code:write") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Play className="size-3.5" />}
                    onClick={async () => {
                      if (tab.draft !== tab.saved && !(await save(tab.path))) return;
                      setBottomTab("terminal");
                      requestAnimationFrame(() => terminalRef.current?.run(`run ${tab.path}`));
                    }}
                  >
                    Run
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHistoryFor(tab.path)}>History</Button>
                <Button size="sm" disabled={readOnly || tab.draft === tab.saved} onClick={() => void save(tab.path)}>Save{saveKeys && <span className="ml-1 font-normal opacity-60">{saveKeys}</span>}</Button>
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {tab ? (
              <Editor
                key={tab.path}
                path={tab.path}
                language={langFor(tab.path)}
                value={shared.has(tab.path) ? undefined : tab.draft}
                defaultValue={tab.draft}
                theme={dark ? "vs-dark" : "vs"}
                loading={<Spinner label="Loading editor" />}
                options={{ readOnly, minimap: { enabled: false }, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", scrollBeyondLastLine: false, tabSize: 2, wordWrap: "on", automaticLayout: true, renderLineHighlight: "line", padding: { top: 8 } }}
                onMount={(editor, monaco) => {
                  editorRef.current = editor;
                  monacoRef.current = monaco;
                  setMounted(tab.path);
                  if (pendingLine.current) {
                    editor.revealLineInCenter(pendingLine.current);
                    editor.setPosition({ lineNumber: pendingLine.current, column: 1 });
                    pendingLine.current = null;
                  }
                }}
                onChange={(v) => !shared.has(tab.path) && setTabs((ts) => ts.map((t) => (t.path === tab.path ? { ...t, draft: v ?? "" } : t)))}
                onValidate={(ms) => setMarkers((m) => ({ ...m, [tab.path]: ms.map((x) => ({ path: tab.path, line: x.startLineNumber, message: x.message, severity: x.severity >= 8 ? "error" : "warning" })) }))}
              />
            ) : (
              <EmptyState icon={<FileText className="size-4" />} title="No file open" description="Choose a file from the explorer." />
            )}
          </div>
          <div className={clsx("flex shrink-0 flex-col border-t border-border", bottomTab === "terminal" ? "h-64" : "h-48")}>
            <Tabs
              className="px-2"
              value={bottomTab}
              onChange={setBottomTab}
              tabs={[
                { value: "problems", label: <>Problems {problems.length > 0 && <Badge tone="danger">{problems.length}</Badge>}</> },
                { value: "terminal", label: <><SquareTerminal className="size-3.5" /> Terminal</> },
              ]}
            />
            <div className={clsx("min-h-0 flex-1", bottomTab === "problems" && "overflow-y-auto")}>
              {bottomTab === "problems" ? (
                problems.length === 0 ? (
                  <p className="p-3 text-[13px] text-muted">No problems in open files.</p>
                ) : (
                  <ul>
                    {problems.map((p, i) => (
                      <li key={i}>
                        <button onClick={() => void openFile(p.path, p.line)} className="flex w-full items-start gap-2 px-3 py-1 text-left font-mono text-xs hover:bg-surface-2">
                          <AlertCircle className={clsx("mt-0.5 size-3.5 shrink-0", p.severity === "error" ? "text-danger" : "text-warning")} aria-label={p.severity} />
                          <span className="text-subtle">{p.path}{p.line ? `:${p.line}` : ""}</span>
                          <span className="text-muted">{p.message}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <Terminal ref={terminalRef} projectId={projectId} onChanged={() => void reloadAfterApply()} />
              )}
            </div>
          </div>
        </section>

        {showAi && (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-border lg:flex">
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[13px] font-medium">
              <Sparkles className="size-3.5 text-accent" aria-hidden /> Assistant
            </div>
            <div className="min-h-0 flex-1">
              <CodeAssistant projectId={projectId} activePath={active} openPaths={tabs.map((t) => t.path)} onApplied={() => void reloadAfterApply()} canUse={perms.includes("code:write")} flushAll={flushAll} />
            </div>
          </aside>
        )}
      </div>

      <Dialog
        open={newFileOpen}
        onClose={() => setNewFileOpen(false)}
        title="New file"
        description="Use slashes for folders, e.g. content/about.md"
        footer={<><Button onClick={() => setNewFileOpen(false)}>Cancel</Button><Button variant="primary" loading={createFile.isPending} disabled={!newPath.trim()} onClick={() => createFile.mutate()}>Create</Button></>}
      >
        <form onSubmit={(e) => { e.preventDefault(); createFile.mutate(); }}>
          <Field label="Path">{(p) => <Input {...p} autoFocus className="font-mono" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="src/index.ts" />}</Field>
        </form>
      </Dialog>
      <RenameDialog path={renaming} onClose={() => setRenaming(null)} loading={rename.isPending} onSubmit={(to) => renaming && rename.mutate({ from: renaming, to })} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} destructive loading={remove.isPending} title={`Delete ${deleting}?`} description="The file is removed from the project. Its history is kept and it can be restored by recreating it from a past revision." confirmLabel="Delete" onConfirm={() => deleting && remove.mutate(deleting)} />
      {historyFor && (
        <HistoryDialog
          open
          onClose={() => setHistoryFor(null)}
          projectId={projectId}
          path={historyFor}
          currentRevision={files.data?.find((f) => f.path === historyFor)?.revision ?? 0}
          currentContent={tabs.find((t) => t.path === historyFor)?.saved ?? ""}
          canRestore={canWritePath(historyFor)}
          onRestored={() => void reloadAfterApply()}
        />
      )}
      <Dialog
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="This file changed on the server"
        description="Someone (or an accepted AI change) saved a newer version while you were editing. Compare and choose."
        size="xl"
        footer={
          <>
            <Button onClick={() => { if (!conflict) return; setTabs((ts) => ts.map((t) => (t.path === conflict.path ? { ...t, saved: conflict.server, draft: conflict.server, revision: conflict.revision, stale: false } : t))); setConflict(null); }}>
              Use server version
            </Button>
            <Button variant="danger" onClick={async () => { if (!conflict) return; const p = conflict.path; setConflict(null); await save(p, { force: true }); }}>
              Overwrite with mine
            </Button>
          </>
        }
      >
        {conflict && (
          <>
            <p className="mb-2 text-xs text-muted">Lines marked − are on the server; + are your unsaved edits.</p>
            <DiffView className="max-h-[55vh]" before={conflict.server} after={tabs.find((t) => t.path === conflict.path)?.draft ?? ""} />
          </>
        )}
      </Dialog>
    </div>
  );
}

function RenameDialog({ path, onClose, onSubmit, loading }: { path: string | null; onClose: () => void; onSubmit: (to: string) => void; loading: boolean }) {
  const [to, setTo] = useState("");
  const [last, setLast] = useState<string | null>(null);
  if (path !== last) {
    setLast(path);
    setTo(path ?? "");
  }
  return (
    <Dialog open={!!path} onClose={onClose} title="Rename or move" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} disabled={!to.trim() || to === path} onClick={() => onSubmit(to)}>Rename</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(to); }}>
        <Field label="New path">{(p) => <Input {...p} autoFocus className="font-mono" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      </form>
    </Dialog>
  );
}
