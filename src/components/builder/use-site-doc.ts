"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { parseSiteDoc, serializeSiteDoc, SITE_DOC_PATH, siteDocSchema, type SiteDoc } from "@/lib/site/model";

export type SaveState = "loading" | "saved" | "unsaved" | "saving" | "invalid" | "error" | "conflict";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;
const AUTOSAVE_MS = 1000;

type FileRes = { content: string; revision: number };

/**
 * Owns the builder's copy of the design document: undo/redo history,
 * debounced autosave with optimistic concurrency, and conflict recovery.
 */
export function useSiteDoc(projectId: string, canWrite: boolean, branchId: string | null = null) {
  const [doc, setDoc] = useState<SiteDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("loading");
  const [problems, setProblems] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [savedText, setSavedText] = useState("");
  const [hist, setHist] = useState({ undo: 0, redo: 0 });

  const docRef = useRef<SiteDoc | null>(null);
  const revRef = useRef(0);
  const savedJson = useRef("");
  const savedContent = useRef("");
  const past = useRef<SiteDoc[]>([]);
  const future = useRef<SiteDoc[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncHist = () => setHist({ undo: past.current.length, redo: future.current.length });

  // A version branch has its own copy of the document behind the same API shape.
  const url = branchId ? `/api/v1/projects/${projectId}/branches/${branchId}/doc?v=1` : `/api/v1/projects/${projectId}/file?path=${encodeURIComponent(SITE_DOC_PATH)}`;

  const adopt = useCallback((f: FileRes, keepHistory: boolean) => {
    const parsed = parseSiteDoc(f.content);
    if (!parsed.ok) {
      setLoadError(`The design document has problems and cannot be opened in the builder. Fix it in the IDE.\n${parsed.errors.slice(0, 5).join("\n")}`);
      return;
    }
    if (keepHistory && docRef.current) {
      past.current.push(docRef.current);
      future.current = [];
    }
    if (!keepHistory) {
      past.current = [];
      future.current = [];
    }
    docRef.current = parsed.doc;
    revRef.current = f.revision;
    savedJson.current = serializeSiteDoc(parsed.doc);
    savedContent.current = f.content;
    setSavedText(f.content);
    syncHist();
    setDoc(parsed.doc);
    setRevision(f.revision);
    setState("saved");
    setLoadError(null);
  }, []);

  const load = useCallback(
    async (keepHistory = false) => {
      try {
        adopt(await api<FileRes>(url), keepHistory);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load the site");
      }
    },
    [adopt, url],
  );

  useEffect(() => {
    let alive = true;
    api<FileRes>(url).then(
      (f) => alive && adopt(f, false),
      (e) => alive && setLoadError(e instanceof Error ? e.message : "Could not load the site"),
    );
    return () => {
      alive = false;
    };
  }, [adopt, url]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    const current = docRef.current;
    if (!current || !canWrite) return false;
    const json = serializeSiteDoc(current);
    if (json === savedJson.current) {
      setState("saved");
      return true;
    }
    const check = siteDocSchema.safeParse(current);
    if (!check.success) {
      setProblems(check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      setState("invalid");
      return false;
    }
    setProblems([]);
    setState("saving");
    const run = (async () => {
      try {
        const r = await api<{ revision: number }>(url, { method: "PUT", body: { content: json, baseRevision: revRef.current } });
        revRef.current = r.revision;
        savedJson.current = json;
        savedContent.current = json;
        setSavedText(json);
        setRevision(r.revision);
        setState(serializeSiteDoc(docRef.current!) === json ? "saved" : "unsaved");
        return true;
      } catch (e) {
        // The server refuses changes that break the document rules or brand locks; say why (undo reverts it).
        if (e instanceof ApiClientError && e.code === "validation_failed") {
          setProblems([`${e.message} Undo to revert.`]);
          setState("invalid");
          return false;
        }
        setState(e instanceof ApiClientError && e.code === "revision_conflict" ? "conflict" : "error");
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    return run;
  }, [canWrite, url]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
  }, [save]);

  const commit = useCallback(
    (next: SiteDoc, coalesceKey?: string) => {
      const prev = docRef.current;
      if (!prev) return;
      const now = Date.now();
      const coalesce = coalesceKey && lastKey.current?.key === coalesceKey && now - lastKey.current.at < COALESCE_MS;
      if (!coalesce) {
        past.current.push(prev);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
      }
      lastKey.current = coalesceKey ? { key: coalesceKey, at: now } : null;
      future.current = [];
      syncHist();
      docRef.current = next;
      setDoc(next);
      setState((s) => (s === "conflict" ? s : "unsaved"));
      schedule();
    },
    [schedule],
  );

  /** Apply a mutation to a copy of the document. */
  const update = useCallback(
    (mutate: (draft: SiteDoc) => void, coalesceKey?: string) => {
      if (!docRef.current || !canWrite) return;
      const draft = structuredClone(docRef.current);
      mutate(draft);
      commit(draft, coalesceKey);
    },
    [canWrite, commit],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !docRef.current) return;
    future.current.push(docRef.current);
    syncHist();
    lastKey.current = null;
    docRef.current = prev;
    setDoc(prev);
    setState("unsaved");
    schedule();
  }, [schedule]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !docRef.current) return;
    past.current.push(docRef.current);
    syncHist();
    lastKey.current = null;
    docRef.current = next;
    setDoc(next);
    setState("unsaved");
    schedule();
  }, [schedule]);

  /** Saves immediately; resolves false if the save failed or conflicted. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    return save();
  }, [save]);

  /** Conflict resolution: keep the server version, or save mine on top of it. */
  const resolveConflict = useCallback(
    async (choice: "theirs" | "mine") => {
      const latest = await api<FileRes>(url);
      if (choice === "theirs") {
        adopt(latest, true);
        return;
      }
      revRef.current = latest.revision;
      setRevision(latest.revision);
      await save();
    },
    [adopt, save, url],
  );

  // Warn before leaving with unsaved work, and make a best-effort save as the
  // page goes away (keepalive requests survive navigation, up to 64 KB).
  useEffect(() => {
    const dirty = () => !!docRef.current && serializeSiteDoc(docRef.current) !== savedJson.current;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty()) e.preventDefault();
    };
    const onPageHide = () => {
      if (!dirty() || !canWrite || !siteDocSchema.safeParse(docRef.current).success) return;
      const body = JSON.stringify({ content: serializeSiteDoc(docRef.current!), baseRevision: revRef.current });
      if (body.length < 60_000) void fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [canWrite, url]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Live sync: pick up teammates' saved edits within seconds. Only when there
  // is nothing unsaved here; otherwise the next save reports a conflict.
  const [remote, setRemote] = useState<{ name: string | null; at: number } | null>(null);
  useEffect(() => {
    const t = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (!docRef.current || saving.current || serializeSiteDoc(docRef.current) !== savedJson.current) return;
      try {
        const meta = await api<{ revision: number; updatedByName: string | null }>(`${url}&meta=1`);
        if (meta.revision > revRef.current && !saving.current && docRef.current && serializeSiteDoc(docRef.current) === savedJson.current) {
          adopt(await api<FileRes>(url), false);
          setRemote({ name: meta.updatedByName, at: Date.now() });
        }
      } catch {
        // Offline or signed out: the regular save path reports problems.
      }
    }, 5000);
    return () => clearInterval(t);
  }, [adopt, url]);

  return {
    remote,
    doc,
    loadError,
    state,
    problems,
    revision,
    savedContent: savedText,
    canUndo: hist.undo > 0,
    canRedo: hist.redo > 0,
    update,
    undo,
    redo,
    flush,
    reload: () => load(true),
    resolveConflict,
  };
}
