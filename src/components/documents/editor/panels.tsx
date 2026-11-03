"use client";

// The editor's side panels: the outline, comments (anchored by Yjs relative
// positions), version history, details & activity, and the AI assistant.
import type { Editor } from "@tiptap/core";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";
import clsx from "clsx";
import { Check, CornerDownRight, History, Loader2, MessageSquare, MoreHorizontal, RotateCcw, Send, Sparkles, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as Y from "yjs";
import { useSession } from "@/components/shell/session-context";
import { Menu, useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { docExtensions } from "@/lib/documents/extensions";
import { LINK_LABEL } from "@/lib/documents/model";
import { readingMinutes, type Heading, type PMNode } from "@/lib/documents/write";
import { commentKey } from "./kit";
import { ago, Avatar, type DriveFile, type Person } from "../drive/shared";

export function PanelShell({ title, icon, onClose, children, actions }: { title: string; icon: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-muted [&_svg]:size-4">{icon}</span>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</h2>
        {actions}
        <button type="button" onClick={onClose} aria-label="Close panel" className="grid size-8 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}

// ── Outline ────────────────────────────────────────────────────────────────

export function scrollToHeading(editor: Editor, index: number) {
  let n = -1;
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target >= 0) return false;
    if (node.type.name === "heading" && node.textContent.trim()) {
      n++;
      if (n === index) target = pos;
    }
  });
  if (target < 0) return;
  editor.chain().setTextSelection(target + 1).run();
  const dom = editor.view.nodeDOM(target) as HTMLElement | null;
  dom?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Outline({ editor, headings, className }: { editor: Editor; headings: Heading[]; className?: string }) {
  if (!headings.length) return <p className={clsx("px-3 text-[12.5px] leading-relaxed text-muted", className)}>Headings you add appear here, so you can jump around the document.</p>;
  return (
    <nav aria-label="Outline" className={clsx("grid gap-px", className)}>
      {headings.map((h) => (
        <button key={h.index} type="button" onClick={() => scrollToHeading(editor, h.index)} className={clsx("truncate rounded-[8px] py-1 pr-2 text-left text-[12.5px] transition-colors hover:bg-fg/[0.05]", h.level === 1 ? "font-semibold text-fg" : "text-fg/70")} style={{ paddingLeft: 8 + (h.level - 1) * 12 }}>
          {h.text}
        </button>
      ))}
    </nav>
  );
}

// ── Comments ───────────────────────────────────────────────────────────────

export type Thread = { id: string; body: string; quote: string; by: string | null; name: string; at: string; editedAt: string | null; mine: boolean; anchor: { from: string; to: string } | null; resolved: boolean; resolvedAt: string | null; replies: { id: string; body: string; by: string | null; name: string; at: string; editedAt: string | null; mine: boolean }[] };

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The selection as an anchor that follows edits (or null without a live document). */
export function anchorOf(editor: Editor): { from: string; to: string } | null {
  const ys = ySyncPluginKey.getState(editor.state);
  if (!ys?.binding) return null;
  const { from, to } = editor.state.selection;
  const enc = (p: number) => b64(Y.encodeRelativePosition(absolutePositionToRelativePosition(p, ys.type, ys.binding.mapping)));
  return { from: enc(from), to: enc(to) };
}

/** Where each open thread sits now, or null if its text was deleted. */
export function rangeOf(editor: Editor, a: { from: string; to: string } | null) {
  const ys = ySyncPluginKey.getState(editor.state);
  if (!a || !ys?.binding) return null;
  try {
    const dec = (s: string) => relativePositionToAbsolutePosition(ys.doc, ys.type, Y.decodeRelativePosition(unb64(s)), ys.binding.mapping);
    const from = dec(a.from);
    const to = dec(a.to);
    return from !== null && to !== null && to > from ? { from, to } : null;
  } catch {
    return null;
  }
}

/** Keeps comment highlights in step with the threads (and the text as it changes). */
export function useCommentHighlights(editor: Editor | null, threads: Thread[], active: string | null) {
  useEffect(() => {
    if (!editor) return;
    const paint = () => {
      const ranges = threads.filter((t) => !t.resolved).flatMap((t) => {
        const r = rangeOf(editor, t.anchor);
        return r ? [{ id: t.id, ...r }] : [];
      });
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentKey, { ranges, active }).setMeta("addToHistory", false));
    };
    // After the shared document has rendered.
    const t = setTimeout(paint, 50);
    return () => clearTimeout(t);
  }, [editor, threads, active]);
}

export function CommentsPanel({ editor, base, fileId, threads, people, draft, setDraft, active, setActive, canComment, onClose, refetch }: { editor: Editor; base: string; fileId: string; threads: Thread[]; people: Person[]; draft: { quote: string; anchor: { from: string; to: string } | null } | null; setDraft: (d: null) => void; active: string | null; setActive: (id: string | null) => void; canComment: boolean; onClose: () => void; refetch: () => void }) {
  const toast = useToast();
  const [show, setShow] = useState<"open" | "resolved">("open");
  const post = useMutation({
    mutationFn: (b: { body: string; parentId?: string; quote?: string; anchor?: { from: string; to: string } | null; mentions: string[] }) => api<{ comment: { id: string } }>(`${base}/docs/${fileId}/comments`, { method: "POST", body: b }),
    onSuccess: (r) => {
      refetch();
      if (draft) {
        setDraft(null);
        setActive(r.comment.id);
      }
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't post the comment", description: errorMessage(e) }),
  });
  const act = useMutation({
    mutationFn: (x: { id: string; path: string; method: string; body?: unknown }) => api(`${base}/docs/${fileId}/comments/${x.id}${x.path}`, { method: x.method, body: x.body ?? {} }),
    onSuccess: () => refetch(),
    onError: (e) => toast({ tone: "error", title: "Couldn't change the comment", description: errorMessage(e) }),
  });
  const list = threads.filter((t) => (show === "open" ? !t.resolved : t.resolved));
  const openCount = threads.filter((t) => !t.resolved).length;
  const focus = (t: Thread) => {
    setActive(t.id);
    const r = rangeOf(editor, t.anchor);
    if (r) {
      editor.chain().setTextSelection(r).run();
      (editor.view.domAtPos(r.from).node as HTMLElement).parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  return (
    <PanelShell
      title="Comments"
      icon={<MessageSquare />}
      onClose={onClose}
      actions={
        <div className="flex rounded-full bg-fg/[0.05] p-0.5 text-[11.5px] font-medium">
          {(["open", "resolved"] as const).map((x) => (
            <button key={x} type="button" onClick={() => setShow(x)} className={clsx("rounded-full px-2.5 py-1", show === x ? "bg-[var(--surface-solid)] shadow-sm" : "text-muted")}>
              {x === "open" ? `Open${openCount ? ` ${openCount}` : ""}` : "Resolved"}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-2.5 p-3">
        {draft && (
          <div className="rounded-[14px] border-2 border-[#7c5cdb]/50 bg-[var(--surface-solid)] p-3 shadow-sm">
            {draft.quote && <p className="mb-2 line-clamp-2 border-l-2 border-amber-400 pl-2 text-[12px] text-muted italic">{draft.quote}</p>}
            <Composer people={people} autoFocus placeholder="Add a comment — @ to mention someone" busy={post.isPending} onCancel={() => setDraft(null)} onSend={(body, mentions) => post.mutate({ body, quote: draft.quote, anchor: draft.anchor, mentions })} />
          </div>
        )}
        {!list.length && !draft && (
          <div className="px-3 py-10 text-center">
            <MessageSquare className="mx-auto size-7 text-fg/20" />
            <p className="mt-2 text-[13px] font-medium">{show === "open" ? "No open comments" : "Nothing resolved yet"}</p>
            {show === "open" && canComment && <p className="mt-1 text-[12px] text-muted">Select some text and press Comment (⌘⌥M) to start a conversation.</p>}
          </div>
        )}
        {list.map((t) => {
          const detached = !t.resolved && !rangeOf(editor, t.anchor);
          return (
            <article key={t.id} onClick={() => focus(t)} className={clsx("cursor-pointer rounded-[14px] border bg-[var(--surface-solid)] p-3 transition-shadow", active === t.id ? "border-[#7c5cdb]/60 shadow-[0_6px_20px_-10px_rgb(124_92_219/0.6)]" : "border-border hover:shadow-sm")}>
              {t.quote && <p className={clsx("mb-2 line-clamp-2 border-l-2 pl-2 text-[12px] italic", detached ? "border-fg/20 text-subtle line-through" : "border-amber-400 text-muted")}>{t.quote}</p>}
              {detached && <p className="mb-1.5 text-[11px] text-subtle">The text this was about has been deleted.</p>}
              <CommentBody c={t} onEdit={(body) => act.mutate({ id: t.id, path: "", method: "PATCH", body: { body } })} onDelete={() => act.mutate({ id: t.id, path: "", method: "DELETE" })} canDelete={t.mine} extra={canComment && <button type="button" title={t.resolved ? "Reopen" : "Resolve"} aria-label={t.resolved ? "Reopen thread" : "Resolve thread"} onClick={(e) => (e.stopPropagation(), act.mutate({ id: t.id, path: "/resolve", method: "POST", body: { resolved: !t.resolved } }))} className="grid size-7 place-items-center rounded-full text-muted hover:bg-success-soft hover:text-success">{t.resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-4" />}</button>} />
              {t.replies.map((r) => (
                <div key={r.id} className="mt-2.5 border-t border-border pt-2.5">
                  <CommentBody c={r} onEdit={(body) => act.mutate({ id: r.id, path: "", method: "PATCH", body: { body } })} onDelete={() => act.mutate({ id: r.id, path: "", method: "DELETE" })} canDelete={r.mine} />
                </div>
              ))}
              {active === t.id && canComment && (
                <div className="mt-2.5 border-t border-border pt-2.5" onClick={(e) => e.stopPropagation()}>
                  <Composer people={people} placeholder="Reply…" busy={post.isPending} onSend={(body, mentions) => post.mutate({ body, parentId: t.id, mentions })} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </PanelShell>
  );
}

function CommentBody({ c, onEdit, onDelete, canDelete, extra }: { c: { body: string; name: string; at: string; editedAt: string | null; mine: boolean }; onEdit: (b: string) => void; onDelete: () => void; canDelete: boolean; extra?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body);
  return (
    <div>
      <div className="flex items-center gap-2">
        <Avatar name={c.name} size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold">{c.name}</p>
          <p className="text-[11px] text-subtle">
            {ago(c.at)}
            {c.editedAt && " · edited"}
          </p>
        </div>
        {extra}
        {c.mine && (
          <span onClick={(e) => e.stopPropagation()}>
            <Menu
              label="Comment"
              trigger={(p) => (
                <button {...p} type="button" aria-label="Comment options" className="grid size-7 place-items-center rounded-full text-muted hover:bg-fg/[0.06]">
                  <MoreHorizontal className="size-4" />
                </button>
              )}
              items={[{ label: "Edit", onSelect: () => setEditing(true) }, ...(canDelete ? [{ label: "Delete", danger: true, icon: <Trash2 />, onSelect: onDelete }] : [])]}
            />
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full resize-none rounded-[10px] border border-border bg-bg p-2 text-[13px] outline-none focus:border-fg/30" aria-label="Edit comment" />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => (onEdit(text), setEditing(false))} disabled={!text.trim()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap">{highlightMentions(c.body)}</p>
      )}
    </div>
  );
}

const highlightMentions = (text: string) =>
  text.split(/(@[\p{L}][\p{L}\p{M}.'-]*(?: [\p{L}][\p{L}\p{M}.'-]*)?)/u).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="rounded-[4px] bg-[#7c5cdb]/12 px-0.5 font-medium text-[#6a48d6]">
        {part}
      </span>
    ) : (
      part
    ),
  );

/** A comment box with @mentions (people picked from a list as you type). */
function Composer({ people, onSend, onCancel, placeholder, busy, autoFocus }: { people: Person[]; onSend: (body: string, mentions: string[]) => void; onCancel?: () => void; placeholder: string; busy?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Person[]>([]);
  const at = text.match(/@([\p{L}\p{M} .'-]{0,30})$/u);
  const q = at?.[1]?.toLowerCase() ?? null;
  const options = q !== null ? people.filter((p) => p.name.toLowerCase().includes(q.trim())).slice(0, 5) : [];
  const send = () => {
    if (!text.trim()) return;
    onSend(
      text.trim(),
      picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id),
    );
    setText("");
    setPicked([]);
  };
  return (
    <div className="relative">
      <textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") onCancel?.();
        }}
        placeholder={placeholder}
        rows={2}
        aria-label={placeholder}
        className="w-full resize-none rounded-[10px] border border-border bg-bg p-2 text-[13px] outline-none focus:border-fg/30"
      />
      {options.length > 0 && (
        <div data-popover className="absolute inset-x-0 bottom-full z-10 mb-1 rounded-[12px] border border-border bg-[var(--surface-solid)] p-1 shadow-lg">
          {options.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setText(text.replace(/@([\p{L}\p{M} .'-]{0,30})$/u, `@${p.name} `));
                setPicked((x) => [...x, p]);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] hover:bg-fg/[0.05]"
            >
              <Avatar name={p.name} size={20} />
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        {onCancel && (
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={send} loading={busy} disabled={!text.trim()}>
          Comment
        </Button>
      </div>
    </div>
  );
}

// ── Versions ───────────────────────────────────────────────────────────────

type Version = { version: number; note: string; size: number; createdAt: string; by: string };

export function VersionsPanel({ base, fileId, canEdit, onClose, onPreview, preview, onNameCurrent }: { base: string; fileId: string; canEdit: boolean; onClose: () => void; onPreview: (v: { version: number; content: PMNode; label: string } | null) => void; preview: number | null; onNameCurrent: (name: string) => Promise<unknown> }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["drive", "versions", fileId], queryFn: () => api<{ versions: Version[] }>(`${base}/docs/${fileId}/versions`) });
  const [name, setName] = useState("");
  const [loading, setLoading] = useState<number | null>(null);
  const restore = useMutation({
    mutationFn: (version: number) => api(`${base}/docs/${fileId}/restore`, { method: "POST", body: { version } }),
    onSuccess: () => {
      toast({ tone: "success", title: "Version restored", description: "Today's text was kept as a version too." });
      onPreview(null);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't restore it", description: errorMessage(e) }),
  });
  const open = async (v: Version) => {
    setLoading(v.version);
    try {
      const r = await api<{ content: PMNode }>(`${base}/docs/${fileId}/version?v=${v.version}`);
      onPreview({ version: v.version, content: r.content, label: v.note || `Version ${v.version}` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't open that version", description: errorMessage(e) });
    } finally {
      setLoading(null);
    }
  };
  return (
    <PanelShell title="Version history" icon={<History />} onClose={() => (onPreview(null), onClose())}>
      <div className="p-3">
        {canEdit && (
          <form
            className="mb-3 flex gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              await onNameCurrent(name.trim());
              setName("");
              void q.refetch();
              toast({ tone: "success", title: "Version saved" });
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this version (e.g. Sent to client)" aria-label="Version name" className="h-9 min-w-0 flex-1 rounded-[10px] border border-border bg-bg px-2.5 text-[12.5px] outline-none focus:border-fg/30" />
            <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </form>
        )}
        <button type="button" onClick={() => onPreview(null)} className={clsx("mb-1 flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left", preview === null ? "bg-fg text-bg" : "hover:bg-fg/[0.05]")}>
          <span className="size-2 rounded-full bg-success" />
          <span className="text-[13px] font-semibold">Current version</span>
        </button>
        {!q.data && (
          <div className="grid h-20 place-items-center text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {q.data && !q.data.versions.length && <p className="px-3 py-4 text-[12.5px] text-muted">Versions are kept every ten minutes while people edit, and whenever you name one.</p>}
        <ol className="grid gap-0.5">
          {q.data?.versions.map((v) => (
            <li key={v.version}>
              <button type="button" onClick={() => open(v)} className={clsx("flex w-full items-start gap-2.5 rounded-[12px] px-3 py-2 text-left", preview === v.version ? "bg-[#7c5cdb]/12 ring-1 ring-[#7c5cdb]/40" : "hover:bg-fg/[0.05]")}>
                <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", v.note ? "bg-[#7c5cdb]" : "bg-fg/25")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{v.note || new Date(v.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {v.note && `${new Date(v.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · `}
                    {v.by}
                  </span>
                </span>
                {loading === v.version && <Loader2 className="mt-1 size-3.5 animate-spin text-muted" />}
              </button>
              {preview === v.version && canEdit && (
                <div className="px-3 pt-1 pb-2">
                  <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} loading={restore.isPending} onClick={() => restore.mutate(v.version)}>
                    Restore this version
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </PanelShell>
  );
}

/** A past version, read-only, in place of the live document. */
export function VersionPreview({ content, label, onClose }: { content: PMNode; label: string; onClose: () => void }) {
  const editor = useEditor({ extensions: docExtensions(), content, editable: false, immediatelyRender: false, editorProps: { attributes: { class: "doc-content" } } }, [content]);
  return (
    <div>
      <div className="sticky top-0 z-10 mb-3 flex items-center gap-2 rounded-[12px] bg-[#7c5cdb] px-3 py-2 text-[12.5px] font-medium text-white shadow-lg">
        <History className="size-4" />
        <span className="min-w-0 flex-1 truncate">Viewing {label}</span>
        <button type="button" onClick={onClose} className="rounded-full bg-white/20 px-2.5 py-0.5 hover:bg-white/30">
          Back to current
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

// ── Details ────────────────────────────────────────────────────────────────

type ActivityRow = { kind: string; detail: Record<string, unknown>; at: string; who: string };
const ACT: Record<string, string> = { created: "created this", renamed: "renamed it", moved: "moved it", copied: "made this copy", shared: "changed who it's shared with", link_on: "turned on link sharing", link_off: "turned off link sharing", trashed: "put it in the trash", restored: "restored it", restored_version: "restored a version", commented: "commented", resolved_comment: "resolved a comment", exported: "downloaded it", pdf_made: "made a PDF for signing" };

export function DetailsPanel({ base, file, headings, words, chars, onClose, path }: { base: string; file: DriveFile; headings: number; words: number; chars: number; onClose: () => void; path: { root: string; crumbs: { id: string; name: string }[] } }) {
  const q = useQuery({ queryKey: ["drive", "activity", file.id], queryFn: () => api<{ activity: ActivityRow[] }>(`${base}/files/${file.id}/activity`) });
  const where = [path.root === "mine" ? "My documents" : path.root === "shared" ? "Shared with me" : "Team", ...path.crumbs.map((c) => c.name)].join(" › ");
  const row = (k: string, v: ReactNode) => (
    <div className="flex gap-3 py-1.5 text-[12.5px]">
      <dt className="w-24 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 flex-1 break-words">{v}</dd>
    </div>
  );
  return (
    <PanelShell title="Details" icon={<MoreHorizontal />} onClose={onClose}>
      <div className="p-4">
        <dl className="divide-y divide-border">
          {row("Where", where)}
          {row("Owner", file.owner)}
          {row("Created", new Date(file.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}
          {row("Last edited", `${ago(file.updatedAt)}${file.lastEditedBy ? ` by ${file.lastEditedBy}` : ""}`)}
          {row("Words", `${words.toLocaleString("en-IN")} · ${readingMinutes(words)} min read`)}
          {row("Characters", chars.toLocaleString("en-IN"))}
          {row("Headings", headings)}
          {file.linkType && row("Linked to", LINK_LABEL[file.linkType as keyof typeof LINK_LABEL] ?? file.linkType)}
          {row("Access", file.access === "private" ? "Private to its owner (and people it's shared with)" : "Whoever can open its folder")}
        </dl>
        <h3 className="mt-5 mb-2 text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">Activity</h3>
        {!q.data ? (
          <Loader2 className="size-4 animate-spin text-muted" />
        ) : (
          <ol className="grid gap-2.5">
            {q.data.activity.map((a, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px]">
                <Avatar name={a.who} size={22} />
                <span className="min-w-0">
                  <span className="font-medium">{a.who}</span> {ACT[a.kind] ?? a.kind.replace(/_/g, " ")}
                  {a.kind === "renamed" && typeof a.detail.to === "string" && <span className="text-muted"> to “{a.detail.to}”</span>}
                  {a.kind === "moved" && typeof a.detail.to === "string" && <span className="text-muted"> to {a.detail.to}</span>}
                  {a.kind === "exported" && typeof a.detail.format === "string" && <span className="text-muted"> as {a.detail.format.toUpperCase()}</span>}
                  <span className="block text-[11px] text-subtle">{ago(a.at)}</span>
                </span>
              </li>
            ))}
            {!q.data.activity.length && <li className="text-[12.5px] text-muted">Nothing yet.</li>}
          </ol>
        )}
      </div>
    </PanelShell>
  );
}

// ── AI ─────────────────────────────────────────────────────────────────────

export function AiPanel({ base, fileId, editor, canEdit, onClose, beforeAsk }: { base: string; fileId: string; editor: Editor; canEdit: boolean; onClose: () => void; beforeAsk: () => Promise<unknown> }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { org } = useSession();
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<{ q: string; a: string; found: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      await beforeAsk();
      const r = await api<{ content?: PMNode[]; answer?: string; found?: boolean; summary?: string }>(`${base}/docs/${fileId}/ai`, { method: "POST", body });
      void qc.invalidateQueries({ queryKey: ["billing", org.id] });
      return r;
    } catch (e) {
      toast({ tone: "error", title: "The assistant couldn't do that", description: errorMessage(e) });
      return null;
    } finally {
      setBusy(null);
    }
  };
  const insert = (content?: PMNode[]) => {
    if (!content?.length) return;
    editor.chain().focus().insertContent(content).run();
    toast({ tone: "success", title: "Added to the document" });
  };
  const before = () => {
    const { from } = editor.state.selection;
    return editor.state.doc.textBetween(Math.max(0, from - 20_000), from, "\n");
  };
  const ideas = ["Write an introduction for this document", "Draft a scope of work section", "Add a pricing table with three tiers", "Write terms and conditions"];
  return (
    <PanelShell title="Writing assistant" icon={<Sparkles />} onClose={onClose}>
      <div className="grid gap-4 p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const t = prompt.trim();
            if (!t) return;
            if (/\?\s*$/.test(t) || !canEdit) {
              const r = await run("ask", { action: "ask", question: t });
              if (r) setAnswer({ q: t, a: r.answer ?? "", found: !!r.found });
            } else {
              const r = await run("draft", { action: "draft", prompt: t });
              if (r) {
                insert(r.content);
                setPrompt("");
              }
            }
          }}
          className="rounded-[16px] border border-border bg-[var(--surface-solid)] p-2 focus-within:border-[#7c5cdb]/60"
        >
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder={canEdit ? "Ask a question about the document, or tell me what to write…" : "Ask a question about this document…"} aria-label="Ask the writing assistant" className="w-full resize-none bg-transparent p-1.5 text-[13px] outline-none" onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.currentTarget.form as HTMLFormElement).requestSubmit()} />
          <div className="flex items-center justify-between">
            <span className="px-1.5 text-[11px] text-subtle">End with ? to ask · ⌘↵</span>
            <Button size="sm" variant="primary" type="submit" icon={busy === "draft" || busy === "ask" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} disabled={!prompt.trim() || !!busy}>
              {/\?\s*$/.test(prompt.trim()) || !canEdit ? "Ask" : "Write"}
            </Button>
          </div>
        </form>
        {answer && (
          <div className="rounded-[14px] bg-[#7c5cdb]/8 p-3 ring-1 ring-[#7c5cdb]/20">
            <p className="text-[11.5px] font-semibold text-[#6a48d6]">{answer.q}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap">{answer.a}</p>
          </div>
        )}
        {canEdit && (
          <div className="grid gap-1.5">
            <p className="text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">Quick actions</p>
            <QuickAction icon={<CornerDownRight />} label="Continue writing" sub="From where your cursor is" busy={busy === "continue"} onClick={async () => insert((await run("continue", { action: "continue", before: before() }))?.content)} />
            <QuickAction icon={<Sparkles />} label="Summarise the document" sub="Adds a summary at your cursor" busy={busy === "summarize"} onClick={async () => insert((await run("summarize", { action: "summarize" }))?.content)} />
            <p className="mt-2 text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">Try</p>
            {ideas.map((i) => (
              <button key={i} type="button" onClick={() => setPrompt(i)} className="rounded-[10px] px-2.5 py-1.5 text-left text-[12.5px] text-fg/80 hover:bg-fg/[0.05]">
                “{i}”
              </button>
            ))}
            <p className="mt-2 text-[11.5px] text-muted">Select text in the document to rewrite, shorten, fix or translate it.</p>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function QuickAction({ icon, label, sub, onClick, busy }: { icon: ReactNode; label: string; sub: string; onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="flex items-center gap-3 rounded-[12px] border border-border px-3 py-2 text-left hover:bg-fg/[0.03] disabled:opacity-60">
      <span className="grid size-8 place-items-center rounded-[9px] bg-[#7c5cdb]/12 text-[#6a48d6] [&_svg]:size-4">{busy ? <Loader2 className="animate-spin" /> : icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[11.5px] text-muted">{sub}</span>
      </span>
    </button>
  );
}

export function useRecordLinkHref(linkType: string | null, linkId: string | null) {
  return useMemo(() => {
    if (!linkType || !linkId) return null;
    const map: Record<string, string> = { crm_deal: `/crm/deals/${linkId}`, crm_company: `/crm/companies/${linkId}`, crm_contact: `/crm/contacts/${linkId}`, hr_employee: `/hr/people/${linkId}`, work_project: `/work/projects/${linkId}`, inv_supplier: `/inventory/suppliers/${linkId}`, sales_order: `/sales/orders/${linkId}`, mnt_asset: `/maintenance/assets/${linkId}` };
    return map[linkType] ?? null;
  }, [linkType, linkId]);
}

export function RecordChip({ linkType, linkId }: { linkType: string | null; linkId: string | null }) {
  const href = useRecordLinkHref(linkType, linkId);
  if (!href || !linkType) return null;
  return (
    <Link href={href} className="inline-flex h-6 items-center gap-1 rounded-full bg-sky-500/10 px-2 text-[11.5px] font-medium text-sky-700 hover:bg-sky-500/15 dark:text-sky-300">
      ↗ {LINK_LABEL[linkType as keyof typeof LINK_LABEL] ?? "Record"}
    </Link>
  );
}
