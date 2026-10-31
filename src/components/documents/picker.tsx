"use client";

// Pick documents and files from the drive, for other modules: attach to an
// email, link from a note. Searches inside documents too; written documents
// come as PDFs (or Word) when attached.
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, FileText, FolderInput, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { fmtBytes } from "@/lib/documents/write";
import { visibleTo } from "@/lib/workspace/modules";
import { FileGlyph, ago, type DriveFile } from "./drive/shared";

export const useDocumentsOn = () => visibleTo(useSession().org, "documents");

/** How a picked file is fetched as an attachment (written documents as a PDF). */
export const attachmentOf = (orgId: string, f: DriveFile) =>
  f.kind === "doc" ? { url: `/api/v1/orgs/${orgId}/documents/docs/${f.id}/export?format=pdf`, filename: `${f.title.replace(/[^\w\- .()]+/g, "").trim() || "document"}.pdf` } : { url: `/api/v1/orgs/${orgId}/documents/files/${f.id}/download`, filename: f.filename || f.title };

export function DocumentPicker({ title = "Attach from Documents", action = "Attach", onPick, onClose }: { title?: string; action?: string; onPick: (files: DriveFile[]) => void; onClose: () => void }) {
  const { org } = useSession();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<DriveFile[]>([]);
  const base = `/api/v1/orgs/${org.id}/documents`;
  const list = useQuery({
    queryKey: ["drive", org.id, "picker", q.trim()],
    queryFn: async () => (q.trim() ? (await api<{ files: DriveFile[] }>(`${base}/drive?section=search&q=${encodeURIComponent(q.trim())}`)).files : (await api<{ files: DriveFile[] }>(`${base}/recent?limit=20`)).files),
    placeholderData: (p) => p,
  });
  const toggle = (f: DriveFile) => setPicked((x) => (x.some((y) => y.id === f.id) ? x.filter((y) => y.id !== f.id) : [...x, f]));
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked.length} onClick={() => (onPick(picked), onClose())}>
            {action}
            {picked.length > 1 ? ` ${picked.length}` : ""}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex h-10 items-center gap-2 rounded-[12px] border border-border bg-bg px-3 focus-within:border-fg/30">
        <Search className="size-4 text-muted" aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents and files" aria-label="Search documents" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
        {list.isFetching && <Loader2 className="size-4 animate-spin text-muted" />}
      </div>
      <p className="mb-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{q.trim() ? "Results" : "Recent"}</p>
      <ul className="grid max-h-[46vh] gap-0.5 overflow-y-auto">
        {(list.data ?? []).map((f) => {
          const on = picked.some((x) => x.id === f.id);
          return (
            <li key={f.id}>
              <button type="button" onClick={() => toggle(f)} aria-pressed={on} className={clsx("flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left", on ? "bg-[#7c5cdb]/10 ring-1 ring-[#7c5cdb]/40" : "hover:bg-fg/[0.04]")}>
                <FileGlyph f={f} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{f.title}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {f.kind === "doc" ? "Attached as a PDF" : fmtBytes(f.size)} · {ago(f.updatedAt)}
                  </span>
                </span>
                <span className={clsx("grid size-5 place-items-center rounded-full border", on ? "border-[#7c5cdb] bg-[#7c5cdb] text-white" : "border-border")}>{on && <Check className="size-3" />}</span>
              </button>
            </li>
          );
        })}
        {list.data && !list.data.length && (
          <li className="py-8 text-center text-[13px] text-muted">
            <FileText className="mx-auto mb-2 size-6 text-fg/20" />
            {q.trim() ? "Nothing matches." : "Documents you open show up here — search to find others."}
          </li>
        )}
      </ul>
    </Dialog>
  );
}

/** "Save to Documents": fetches a file from the app (an email attachment…) and keeps it in My documents. */
export function SaveToDocuments({ url, filename, className }: { url: string; filename: string; className?: string }) {
  const { org } = useSession();
  const on = useDocumentsOn();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!on) return null;
  const save = async () => {
    setBusy(true);
    try {
      const blob = await (await fetch(url, { credentials: "same-origin" })).blob();
      const form = new FormData();
      form.append("file", new File([blob], filename, { type: blob.type }));
      form.append("meta", JSON.stringify({ title: filename.replace(/\.[^.]+$/, "").slice(0, 200), root: "mine" }));
      const r = await fetch(`/api/v1/orgs/${org.id}/documents/files`, { method: "POST", body: form, credentials: "same-origin" });
      const j = (await r.json()) as { file?: { id: string }; error?: { message?: string } };
      if (!r.ok || !j.file) throw new Error(j.error?.message ?? "Couldn't save it");
      toast({ tone: "success", title: "Saved to My documents", description: filename });
      router.prefetch(`/documents/file/${j.file.id}`);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save it to Documents", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={save} disabled={busy} aria-label={`Save ${filename} to Documents`} title="Save to Documents" className={clsx("grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg disabled:opacity-60", className)}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4" />}
    </button>
  );
}

/** Brings Markdown in as a new written document in My documents (a note turned into a document…); returns its id. */
export async function markdownToDocument(orgId: string, title: string, markdown: string) {
  const form = new FormData();
  form.append("file", new File([markdown], `${title.replace(/[^\w\- .()]+/g, "").trim() || "Untitled"}.md`, { type: "text/markdown" }));
  form.append("meta", JSON.stringify({ title: title.slice(0, 200), root: "mine" }));
  const r = await fetch(`/api/v1/orgs/${orgId}/documents/docs/import`, { method: "POST", body: form, credentials: "same-origin" });
  const j = (await r.json()) as { file?: { id: string }; error?: { message?: string } };
  if (!r.ok || !j.file) throw new Error(j.error?.message ?? "Couldn't make the document");
  return j.file.id;
}
