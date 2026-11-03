"use client";

// What the AI knows, in a sheet over AI mode: the business's knowledge base
// (notes and files owners and admins add — prices, policies, FAQs, how things
// are done) and what it has learned from this person's conversations, each
// entry removable. PDFs are read in the browser; other files on the server.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BookOpen, Brain, FileUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";

type Entry = { id: string; kind: "note" | "file" | "learned"; title: string; excerpt: string; chars: number; source: string; createdAt: string; by: string };
type Data = { entries: Entry[]; memories: Entry[]; canEdit: boolean };

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,application/pdf";
const words = (n: number) => `${Math.max(1, Math.round(n / 6)).toLocaleString("en-IN")} words`;

/** A PDF's text, read with the PDF viewer's own engine. */
async function pdfText(f: File) {
  const { openPdf } = await import("@/components/documents/viewer/pdfjs");
  const doc = await openPdf(new Uint8Array(await f.arrayBuffer()));
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 150); n++) {
    const c = await (await doc.getPage(n)).getTextContent();
    pages.push((c.items as { str?: string; hasEOL?: boolean }[]).map((i) => `${i.str ?? ""}${i.hasEOL ? "\n" : ""}`).join(""));
  }
  void doc.loadingTask.destroy();
  return pages.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

export function KnowledgeSheet({ orgId, onClose, start = "business" }: { orgId: string; onClose: () => void; start?: "business" | "memory" }) {
  const qc = useQueryClient();
  const key = ["copilot", orgId, "knowledge"];
  const base = `/api/v1/orgs/${orgId}/copilot`;
  const q = useQuery({ queryKey: key, queryFn: () => api<Data>(`${base}/knowledge`) });
  const [tab, setTab] = useState(start);
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fact, setFact] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const run = async (what: string, f: () => Promise<unknown>) => {
    setBusy(what);
    setErr("");
    try {
      await f();
      await refresh();
      return true;
    } catch (e) {
      setErr(errorMessage(e));
      return false;
    } finally {
      setBusy("");
    }
  };
  const addNote = async () => {
    if (await run("note", () => api(`${base}/knowledge`, { method: "POST", body: { title, body } }))) {
      setTitle("");
      setBody("");
      setWriting(false);
    }
  };
  const addFile = (f: File) =>
    run("file", async () => {
      const name = f.name.replace(/\.[^.]+$/, "");
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        const text = await pdfText(f);
        if (!text) throw new Error("That PDF has no text to read (it may be a scan). Add a text version instead.");
        return api(`${base}/knowledge`, { method: "POST", body: { title: name, body: text.slice(0, 200_000), source: f.name } });
      }
      const form = new FormData();
      form.set("file", f, f.name);
      form.set("title", name);
      const res = await fetch(`${base}/knowledge`, { method: "POST", body: form, credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Couldn't add that file");
    });
  const remember = async () => {
    if (await run("fact", () => api(`${base}/memories`, { method: "POST", body: { fact } }))) setFact("");
  };
  const remove = (id: string) => run(id, () => api(`${base}/knowledge/${id}`, { method: "DELETE" }));

  const d = q.data;
  const list = tab === "business" ? (d?.entries ?? []) : (d?.memories ?? []);

  return (
    <div className="ai-sheet" role="dialog" aria-modal="true" aria-label="What your AI knows" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ai-sheet-in">
        <div className="ai-sheet-h">
          <b>What your AI knows</b>
          <button type="button" className="ai-round" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="ai-seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "business"} className={clsx(tab === "business" && "is-on")} onClick={() => setTab("business")}>
            <BookOpen className="size-4" /> Knowledge base
          </button>
          <button type="button" role="tab" aria-selected={tab === "memory"} className={clsx(tab === "memory" && "is-on")} onClick={() => setTab("memory")}>
            <Brain className="size-4" /> Memory
          </button>
        </div>

        <p className="ai-sheet-sub">
          {tab === "business"
            ? "Your prices, policies, FAQs, terms and processes. The AI uses them in every answer and email draft, for everyone in the workspace."
            : "Facts and preferences the AI picked up from your conversations — only for you. Tell it “remember …” in chat, or add one here."}
        </p>

        {tab === "business" && d?.canEdit && (
          <div className="ai-kb-add">
            {writing ? (
              <div className="ai-kb-form">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title — e.g. Refund policy" maxLength={160} aria-label="Title" />
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Write it the way you'd explain it to a new colleague." aria-label="Content" />
                <div className="ai-acts">
                  <button type="button" className="ai-btn" disabled={!title.trim() || !body.trim() || !!busy} onClick={() => void addNote()}>
                    {busy === "note" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add to knowledge
                  </button>
                  <button type="button" className="ai-btn-ghost" onClick={() => setWriting(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="ai-acts">
                <button type="button" className="ai-btn" onClick={() => setWriting(true)}>
                  <Plus className="size-4" /> Write a note
                </button>
                <button type="button" className="ai-btn-ghost" disabled={!!busy} onClick={() => pick.current?.click()}>
                  {busy === "file" ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Add a file
                </button>
                <input ref={pick} type="file" accept={ACCEPT} hidden onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void addFile(f);
                }} />
              </div>
            )}
          </div>
        )}
        {tab === "business" && d && !d.canEdit && <p className="ai-sheet-sub">Only workspace owners and admins can add to the knowledge base.</p>}
        {tab === "memory" && (
          <form className="ai-kb-fact" onSubmit={(e) => (e.preventDefault(), void remember())}>
            <input value={fact} onChange={(e) => setFact(e.target.value)} placeholder="e.g. Our standard payment terms are 30 days" maxLength={400} aria-label="Something to remember" />
            <button type="submit" className="ai-btn" disabled={fact.trim().length < 3 || !!busy}>
              {busy === "fact" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Remember
            </button>
          </form>
        )}
        {err && <p className="ai-err">{err}</p>}

        <div className="ai-kb-list">
          {q.isLoading && <Loader2 className="mx-auto size-5 animate-spin opacity-60" />}
          {d && !list.length && <p className="ai-kb-empty">{tab === "business" ? "Nothing here yet. Start with your price list, refund policy or the questions customers ask most." : "Nothing remembered yet."}</p>}
          {list.map((e) => (
            <div key={e.id} className="ai-kb-item">
              <span className="min-w-0 flex-1">
                {e.title && <b>{e.title}</b>}
                <span>{e.excerpt}</span>
                {e.kind !== "learned" && (
                  <small>
                    {e.kind === "file" ? e.source || "File" : "Note"} · {words(e.chars)}
                    {e.by ? ` · ${e.by}` : ""}
                  </small>
                )}
              </span>
              {(tab === "memory" || d?.canEdit) && (
                <button type="button" className="ai-chip ai-chip-ic" disabled={busy === e.id} onClick={() => void remove(e.id)} aria-label={`Remove ${e.title || "this"}`}>
                  {busy === e.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
