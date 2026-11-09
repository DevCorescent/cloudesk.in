"use client";

// The page a client opens from a requisition email: what's needed, what's
// already in, and an upload for each item (several files each, with a
// progress bar) — plus a note for the team. No sign-in; the link is the key.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CloudUpload, FileText, MessageSquare, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Notice, Skeleton, Textarea, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

type Item = { id: string; title: string; description: string; required: boolean; status: string; note: string; files: { filename: string; at: string }[] };
type View = { business: string; number: string; title: string; message: string; clientName: string; dueDate: string | null; status: string; progress: { got: number; of: number; pct: number }; items: Item[]; other: { filename: string; at: string }[] };

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Uploads one file with progress (fetch can't report upload progress). */
function upload(token: string, itemId: string | null, file: File, onProgress: (p: number) => void): Promise<View> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file, file.name);
    if (itemId) form.set("itemId", itemId);
    const x = new XMLHttpRequest();
    x.open("POST", `/api/v1/collect/${encodeURIComponent(token)}/upload`);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let j: unknown = null;
      try {
        j = JSON.parse(x.responseText);
      } catch {}
      if (x.status >= 200 && x.status < 300) resolve(j as View);
      else reject(new Error((j as { error?: { message?: string } } | null)?.error?.message ?? "That upload didn't work — try again"));
    };
    x.onerror = () => reject(new Error("The connection dropped — try again"));
    x.send(form);
  });
}

export function CollectPage({ token }: { token: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["collect", token], queryFn: () => api<View>(`/api/v1/collect/${token}`), retry: false });
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [noted, setNoted] = useState(false);
  const send = async (itemId: string | null, files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const key = itemId ?? "other";
    for (const f of Array.from(files)) {
      setBusy((b) => ({ ...b, [key]: 0 }));
      try {
        qc.setQueryData(["collect", token], await upload(token, itemId, f, (p) => setBusy((b) => ({ ...b, [key]: p }))));
      } catch (e) {
        setError(`${f.name}: ${errorMessage(e)}`);
      }
    }
    setBusy((b) => {
      const n = { ...b };
      delete n[key];
      return n;
    });
  };
  if (q.isError) return <Shell><Notice tone="danger" title="This link doesn't work">Check you opened the whole link from the email. If the request was withdrawn, the link stops working.</Notice></Shell>;
  if (!q.data) return <Shell><Skeleton className="h-96 rounded-[24px]" /></Shell>;
  const v = q.data;
  const done = v.status === "completed";
  const first = v.clientName.trim().split(/\s+/)[0];
  return (
    <Shell>
      <p className="text-[12px] font-semibold tracking-[0.14em] text-subtle uppercase">{v.business} · {v.number}</p>
      <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-balance">{v.title}</h1>
      <p className="mt-2 text-[14px] text-muted">
        {done ? `Everything's in${first ? `, ${first}` : ""} — thank you.` : v.message || `${first ? `Hi ${first}, ` : ""}${v.business} needs the items below. Upload each one here, or reply to the email with them attached.`}
      </p>
      <div className="mt-5 grid gap-2 rounded-[20px] border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="font-medium">{v.progress.got} of {v.progress.of} received</span>
          {v.dueDate && !done && <span className="text-muted">Please send by {day(v.dueDate)}</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3">
          <div className={cx("h-full rounded-full transition-[width] duration-700", done ? "bg-success" : "bg-fg")} style={{ width: `${Math.max(v.progress.pct ? 4 : 0, v.progress.pct)}%` }} />
        </div>
      </div>
      {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}
      <ul className="mt-5 grid gap-3">
        {v.items.map((it) => (
          <ItemCard key={it.id} it={it} done={done} progress={busy[it.id]} onFiles={(f) => void send(it.id, f)} />
        ))}
      </ul>
      {!done && (
        <section className="mt-6 grid gap-3 rounded-[20px] border border-dashed border-border p-4">
          <p className="text-[14px] font-medium">Something else?</p>
          <p className="text-[13px] text-muted">Upload a file that isn&apos;t on the list, and the team will sort it.</p>
          <Picker label="Upload a file" progress={busy.other} onFiles={(f) => void send(null, f)} />
          {v.other.length > 0 && <p className="text-[12.5px] text-muted">Sent: {v.other.map((f) => f.filename).join(", ")}</p>}
        </section>
      )}
      {!done && (
        <section className="mt-6 grid gap-2 rounded-[20px] border border-border bg-surface p-4">
          <p className="flex items-center gap-2 text-[14px] font-medium"><MessageSquare className="size-4" /> A note for {v.business}</p>
          {noted ? (
            <p className="text-[13px] text-success">Sent — thank you.</p>
          ) : (
            <>
              <Textarea aria-label="Your note" rows={3} value={note} placeholder="e.g. I'll send the bank statement on Monday" onChange={(e) => setNote(e.target.value)} />
              <Button className="justify-self-start" disabled={!note.trim()} onClick={async () => {
                try {
                  await api(`/api/v1/collect/${token}/note`, { method: "POST", body: { text: note } });
                  setNoted(true);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}>Send note</Button>
            </>
          )}
        </section>
      )}
      <p className="mt-8 text-center text-[11.5px] text-subtle">Files go only to {v.business}. Up to 25 MB each — PDFs, photos, Word and Excel.</p>
    </Shell>
  );
}

function ItemCard({ it, done, progress, onFiles }: { it: Item; done: boolean; progress?: number; onFiles: (f: FileList | null) => void }) {
  const got = it.status === "received";
  const again = it.status === "rejected";
  return (
    <li className={cx("grid gap-3 rounded-[20px] border p-4", got ? "border-success/30 bg-success-soft" : again ? "border-danger/30 bg-danger-soft" : "border-border bg-surface")}>
      <div className="flex items-start gap-3">
        <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", got ? "bg-success text-white" : again ? "bg-danger text-white" : "border-2 border-border")}>{got ? <Check className="size-3.5" /> : again ? <RotateCcw className="size-3" /> : null}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">
            {it.title} {!it.required && <span className="text-[12px] font-normal text-muted">(if you have it)</span>}
          </p>
          {it.description && <p className="text-[13px] text-muted">{it.description}</p>}
          {again && it.note && <p className="mt-1 text-[13px] font-medium text-danger">Please send this again: {it.note}</p>}
          {it.files.length > 0 && (
            <ul className="mt-2 grid gap-1">
              {it.files.map((f, i) => <li key={i} className="flex items-center gap-1.5 text-[12.5px] text-muted"><FileText className="size-3.5 shrink-0" /> <span className="truncate">{f.filename}</span></li>)}
            </ul>
          )}
        </div>
      </div>
      {!done && <Picker label={got ? "Add another file" : again ? "Upload again" : "Upload"} progress={progress} onFiles={onFiles} quiet={got} />}
    </li>
  );
}

function Picker({ label, progress, onFiles, quiet }: { label: string; progress?: number; onFiles: (f: FileList | null) => void; quiet?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const uploading = progress !== undefined;
  return (
    <div className="grid gap-2">
      <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.odt,.ods,.zip,.rtf,image/*" onChange={(e) => (onFiles(e.target.files), (e.target.value = ""))} />
      <Button variant={quiet ? "ghost" : "primary"} className="justify-self-start max-sm:w-full" icon={<CloudUpload className="size-4" />} loading={uploading} onClick={() => input.current?.click()}>
        {uploading ? `Uploading ${progress}%` : label}
      </Button>
      {uploading && <div className="h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-fg transition-[width]" style={{ width: `${progress}%` }} /></div>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto max-w-xl px-4 pt-10 pb-16 sm:pt-16">{children}</div>
    </main>
  );
}
