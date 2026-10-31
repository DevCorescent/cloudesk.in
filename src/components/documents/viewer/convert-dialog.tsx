"use client";

// Convert a file or a written document to another format — saved next to the
// original, or downloaded. Most conversions run on the server; PDF pages to
// images, PDF text to an editable document, and image format changes run in
// the browser (with PDF.js and a canvas) and upload the result.
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Check, Download, FileImage, FileText, FolderInput, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { familyOf, TARGET_LABEL, TARGET_LINE, targetsFor, type Target } from "@/lib/documents/formats";
import { markdownToDocument } from "../picker";
import { downloadUrl, useDocsBase, useDriveRefresh, type DriveFile } from "../drive/shared";
import { openPdf, pageImage, pagesText } from "./pdfjs";

type Option = { id: string; label: string; line: string; icon: ReactNode; server?: Target; local?: "png" | "jpg" | "webp" | "pdf-png" | "pdf-jpg" | "pdf-text"; saveOnly?: boolean };

const safe = (t: string) => t.replace(/[^\w\- .()]+/g, "").trim().slice(0, 120) || "document";

export function ConvertDialog({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const { org } = useSession();
  const base = useDocsBase();
  const toast = useToast();
  const refresh = useDriveRefresh();
  const fam = file.kind === "doc" ? ("written" as const) : familyOf(file);
  const options: Option[] = [
    ...targetsFor(fam).map((t) => ({ id: t, label: TARGET_LABEL[t], line: TARGET_LINE[t], icon: t === "doc" ? <FileText /> : <ArrowRight />, server: t, saveOnly: t === "doc" })),
    ...(fam === "pdf"
      ? [
          { id: "pdf-text", label: "Editable document", line: "Its text, page by page, to edit here", icon: <FileText />, local: "pdf-text" as const, saveOnly: true },
          { id: "pdf-png", label: "Images (PNG)", line: "Each page as a sharp picture", icon: <FileImage />, local: "pdf-png" as const },
          { id: "pdf-jpg", label: "Images (JPG)", line: "Each page as a smaller picture", icon: <FileImage />, local: "pdf-jpg" as const },
        ]
      : []),
    ...(fam === "image"
      ? (["png", "jpg", "webp"] as const).filter((x) => !file.mime.includes(x === "jpg" ? "jpeg" : x)).map((x) => ({ id: x, label: x.toUpperCase(), line: x === "jpg" ? "Smaller, for photos" : x === "png" ? "Lossless, for screenshots and logos" : "Small and sharp, for the web", icon: <FileImage />, local: x }))
      : []),
  ];
  const [pick, setPick] = useState<Option | null>(options[0] ?? null);
  const [mode, setMode] = useState<"save" | "download">("save");
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<{ href: string; label: string }[] | null>(null);

  const uploadBlob = async (blob: Blob, name: string) => {
    const form = new FormData();
    form.append("file", new File([blob], name, { type: blob.type }));
    form.append("meta", JSON.stringify({ title: name.replace(/\.[^.]+$/, ""), folderId: file.folderId, root: file.access === "private" ? "mine" : "team" }));
    let r = await fetch(`${base}/files`, { method: "POST", body: form, credentials: "same-origin" });
    if (r.status === 403 || r.status === 422) {
      // Not allowed beside the original: into My documents instead.
      form.set("meta", JSON.stringify({ title: name.replace(/\.[^.]+$/, ""), root: "mine" }));
      r = await fetch(`${base}/files`, { method: "POST", body: form, credentials: "same-origin" });
    }
    const j = (await r.json()) as { file?: { id: string }; error?: { message?: string } };
    if (!r.ok || !j.file) throw new Error(j.error?.message ?? "Couldn't save it");
    return j.file.id;
  };
  const out = (blob: Blob, name: string) => (mode === "download" ? (downloadUrl(URL.createObjectURL(blob), name), null) : uploadBlob(blob, name));

  const run = useMutation({
    mutationFn: async (o: Option) => {
      const saved: { href: string; label: string }[] = [];
      if (o.server) {
        if (mode === "download" && !o.saveOnly) {
          const r = await fetch(`${base}/files/${file.id}/convert`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: o.server, mode: "download" }) });
          if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Couldn't convert it");
          const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `${safe(file.title)}.${o.server}`;
          downloadUrl(URL.createObjectURL(await r.blob()), name);
          return saved;
        }
        const r = await api<{ fileId: string; kind: "doc" | "file" }>(`${base}/files/${file.id}/convert`, { method: "POST", body: { to: o.server, mode: "save" } });
        saved.push({ href: r.kind === "doc" ? `/documents/d/${r.fileId}` : `/documents/file/${r.fileId}`, label: `${file.title} — ${TARGET_LABEL[o.server]}` });
        return saved;
      }
      const src = `${base}/files/${file.id}/download?inline=1`;
      if (o.local === "pdf-text") {
        const doc = await openPdf(src);
        const texts = await pagesText(doc, (n) => setProgress(`Reading page ${n} of ${doc.numPages}…`));
        const md = texts.map((t, i) => `## Page ${i + 1}\n\n${t.replace(/\n{2,}/g, "\n\n").replace(/([^\n])\n([^\n])/g, "$1 $2")}`).join("\n\n");
        const id = await markdownToDocument(org.id, file.title, md);
        saved.push({ href: `/documents/d/${id}`, label: `${file.title} (editable)` });
        return saved;
      }
      if (o.local === "pdf-png" || o.local === "pdf-jpg") {
        const doc = await openPdf(src);
        const type = o.local === "pdf-png" ? "image/png" : "image/jpeg";
        const max = Math.min(doc.numPages, 100);
        for (let n = 1; n <= max; n++) {
          setProgress(`Page ${n} of ${max}…`);
          const blob = await pageImage(doc, n, type, 2);
          const id = await out(blob, `${safe(file.title)} page ${n}.${o.local === "pdf-png" ? "png" : "jpg"}`);
          if (id) saved.push({ href: `/documents/file/${id}`, label: `Page ${n}` });
          if (mode === "download") await new Promise((r) => setTimeout(r, 250));
        }
        return saved;
      }
      // Image to another image format.
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      if (o.local === "jpg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const type = o.local === "jpg" ? "image/jpeg" : o.local === "webp" ? "image/webp" : "image/png";
      const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't convert the image"))), type, 0.9));
      const id = await out(blob, `${safe(file.title)}.${o.local}`);
      if (id) saved.push({ href: `/documents/file/${id}`, label: `${file.title} (${o.local!.toUpperCase()})` });
      return saved;
    },
    onSuccess: (saved) => {
      setProgress(null);
      refresh();
      if (mode === "download" && !saved.length) {
        toast({ tone: "success", title: "Downloaded" });
        onClose();
      } else setDone(saved);
    },
    onError: (e) => {
      setProgress(null);
      toast({ tone: "error", title: "Couldn't convert it", description: errorMessage(e) });
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={done ? "Converted" : `Convert “${file.title}”`}
      description={done ? undefined : options.length ? "Choose what to turn it into." : "This kind of file can't be converted."}
      size="lg"
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={run.isPending} disabled={!pick} onClick={() => pick && run.mutate(pick)}>
              {mode === "save" || pick?.saveOnly ? "Convert and save" : "Convert and download"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <ul className="grid gap-1.5">
          {done.slice(0, 20).map((d) => (
            <li key={d.href}>
              <Link href={d.href} onClick={onClose} className="flex items-center gap-2.5 rounded-[12px] border border-border px-3 py-2.5 text-[13px] font-medium hover:bg-fg/[0.03]">
                <Check className="size-4 text-success" />
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className="text-[12px] text-muted">Open</span>
              </Link>
            </li>
          ))}
          {done.length > 20 && <li className="text-[12px] text-muted">…and {done.length - 20} more, next to the original.</li>}
        </ul>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => (
              <button key={o.id} type="button" onClick={() => setPick(o)} aria-pressed={pick?.id === o.id} className={clsx("flex items-start gap-3 rounded-[14px] border p-3 text-left transition-colors", pick?.id === o.id ? "border-[#7c5cdb] bg-[#7c5cdb]/8 ring-1 ring-[#7c5cdb]/40" : "border-border hover:bg-fg/[0.03]")}>
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-fg/[0.05] text-fg/75 [&_svg]:size-4">{o.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{o.label}</span>
                  <span className="block text-[12px] text-muted">{o.line}</span>
                </span>
              </button>
            ))}
          </div>
          {pick && !pick.saveOnly && (
            <div role="radiogroup" aria-label="What to do with it" className="grid grid-cols-2 gap-1 rounded-[14px] bg-fg/[0.05] p-1">
              {(
                [
                  ["save", <FolderInput key="s" className="size-4" />, "Save to Documents", "Next to the original"],
                  ["download", <Download key="d" className="size-4" />, "Download", "To this device"],
                ] as const
              ).map(([id, icon, label, line]) => (
                <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={clsx("flex items-start gap-2 rounded-[11px] px-3 py-2 text-left", mode === id ? "bg-[var(--surface-solid)] shadow-sm" : "text-muted")}>
                  <span className="mt-0.5">{icon}</span>
                  <span>
                    <span className="block text-[13px] font-semibold">{label}</span>
                    <span className="block text-[11.5px] text-muted">{line}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {progress && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted">
              <Loader2 className="size-4 animate-spin" /> {progress}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
