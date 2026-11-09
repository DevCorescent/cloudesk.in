"use client";

// Drive QR, for whoever scans it: upload photos or files into the folder
// from a phone (no account), choose how long they stay, and leave an email to
// hear whenever they're opened — plus the page behind the email's delete link.
import { useQuery } from "@tanstack/react-query";
import { Camera, Check, CloudUpload, FileText, Loader2, ShieldCheck, Timer, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Field, Input, Notice, Select, Skeleton } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";

type View = { business: string; place: string; stayMinutes: number | null; choices: { minutes: number | null; label: string }[]; maxMb: number };
type Sent = { title: string; filename: string; deleteAt: string | null; stay: string };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function send(token: string, file: File, meta: Record<string, unknown>, onProgress: (p: number) => void): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file, file.name);
    form.set("meta", JSON.stringify(meta));
    const x = new XMLHttpRequest();
    x.open("POST", `/api/v1/drop/${encodeURIComponent(token)}`);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let j: unknown = null;
      try {
        j = JSON.parse(x.responseText);
      } catch {}
      if (x.status >= 200 && x.status < 300) resolve(j as Sent);
      else reject(new Error((j as { error?: { message?: string } } | null)?.error?.message ?? "That upload didn't work — try again"));
    };
    x.onerror = () => reject(new Error("The connection dropped — try again"));
    x.send(form);
  });
}

export function DropPage({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["drop", token], queryFn: () => api<View>(`/api/v1/drop/${token}`), retry: false });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [stay, setStay] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ name: string; p: number } | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [error, setError] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  if (q.isError) return <Shell><Notice tone="danger" title="This QR doesn't work">It may have been turned off or replaced. Ask whoever gave it to you for a new one.</Notice></Shell>;
  if (!q.data) return <Shell><Skeleton className="h-96 rounded-[24px]" /></Shell>;
  const v = q.data;
  const chosen = stay ?? (v.stayMinutes === null ? "keep" : String(v.stayMinutes));
  const go = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return setError("Check your email address, or leave it empty.");
    for (const f of Array.from(files)) {
      if (f.size > v.maxMb * 1024 * 1024) {
        setError(`${f.name} is over ${v.maxMb} MB.`);
        continue;
      }
      setBusy({ name: f.name, p: 0 });
      try {
        const r = await send(token, f, { name, email, ...(v.choices.length > 1 ? { stayMinutes: chosen === "keep" ? null : Number(chosen) } : {}) }, (p) => setBusy({ name: f.name, p }));
        setSent((s) => [r, ...s]);
      } catch (e) {
        setError(`${f.name}: ${errorMessage(e)}`);
      }
    }
    setBusy(null);
  };
  return (
    <Shell>
      <p className="text-[12px] font-semibold tracking-[0.14em] text-subtle uppercase">{v.business}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Upload to {v.place}</h1>
      <p className="mt-2 text-[14px] text-muted">Take a photo or choose a file. It goes straight to {v.business} — no app or account needed.</p>

      <div className="mt-6 grid gap-3 rounded-[24px] border border-border bg-surface p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" hint="Optional">{(a) => <Input {...a} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
          <Field label="Your email" hint="Optional — you're told when it's opened">{(a) => <Input {...a} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}</Field>
        </div>
        {v.choices.length > 1 ? (
          <Field label="Delete it automatically after">
            {(a) => (
              <Select {...a} value={chosen} onChange={(e) => setStay(e.target.value)}>
                {v.choices.map((c) => <option key={c.label} value={c.minutes === null ? "keep" : String(c.minutes)}>{c.minutes === null ? "Don't — keep it" : c.label}</option>)}
              </Select>
            )}
          </Field>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted"><Timer className="size-4 shrink-0" />{v.stayMinutes === null ? "Uploads are kept until they delete them." : `Uploads are deleted completely after ${v.choices[0]?.label.toLowerCase() ?? "a while"}.`}</p>
        )}
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void go(e.target.files), (e.target.value = ""))} />
        <input ref={pick} type="file" multiple hidden onChange={(e) => (void go(e.target.files), (e.target.value = ""))} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="primary" size="md" icon={<Camera className="size-4" />} disabled={!!busy} onClick={() => camera.current?.click()}>Take a photo</Button>
          <Button size="md" icon={<CloudUpload className="size-4" />} disabled={!!busy} onClick={() => pick.current?.click()}>Choose files</Button>
        </div>
        {busy && (
          <div className="grid gap-1.5">
            <p className="flex items-center gap-2 text-[12.5px] text-muted"><Loader2 className="size-3.5 animate-spin" /> Uploading {busy.name} · {busy.p}%</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-fg transition-[width]" style={{ width: `${busy.p}%` }} /></div>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>

      {sent.length > 0 && (
        <section className="mt-5 grid gap-2">
          <p className="text-[13px] font-semibold">Sent</p>
          {sent.map((s, i) => (
            <div key={i} className="flex items-start gap-3 rounded-[18px] border border-success/30 bg-success-soft px-4 py-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success text-white"><Check className="size-3.5" /></span>
              <span className="min-w-0 text-[13px]">
                <span className="flex items-center gap-1.5 font-medium"><FileText className="size-3.5 shrink-0" /><span className="truncate">{s.filename}</span></span>
                <span className="block text-muted">{s.deleteAt ? `Deleted completely ${when(s.deleteAt)}` : "Kept until they delete it"}{email ? " · we'll email you each time it's opened" : ""}</span>
              </span>
            </div>
          ))}
        </section>
      )}
      <p className="mt-8 flex items-start justify-center gap-1.5 text-center text-[11.5px] text-subtle"><ShieldCheck className="size-3.5 shrink-0" /> Files go only to {v.business}, up to {v.maxMb} MB each. Leave your email to get a link that deletes your file at any time.</p>
    </Shell>
  );
}

type Removal = { gone: true } | { gone: false; title: string; business: string; uploadedAt: string; deleteAt: string | null };

export function RemovePage({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["drop-remove", token], queryFn: () => api<Removal>(`/api/v1/drop/remove/${token}`), retry: false });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (q.isError) return <Shell><Notice tone="danger" title="This link doesn't work">Check you opened the whole link from the email.</Notice></Shell>;
  if (!q.data) return <Shell><Skeleton className="h-60 rounded-[24px]" /></Shell>;
  const v = q.data;
  if (done || v.gone)
    return (
      <Shell>
        <div className="grid justify-items-center gap-3 rounded-[24px] border border-border bg-surface p-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-success text-white"><Check className="size-6" /></span>
          <h1 className="text-[20px] font-semibold">{done ? "Deleted" : "Already deleted"}</h1>
          <p className="text-[14px] text-muted">{done ? "Your document has been deleted completely — every copy and its history." : "This document isn't there any more."}</p>
        </div>
      </Shell>
    );
  return (
    <Shell>
      <p className="text-[12px] font-semibold tracking-[0.14em] text-subtle uppercase">{v.business}</p>
      <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-[-0.02em]">Delete “{v.title}”?</h1>
      <p className="mt-2 text-[14px] text-muted">You uploaded it {when(v.uploadedAt)}. {v.deleteAt ? `It's due to be deleted ${when(v.deleteAt)}.` : "It's kept until someone deletes it."} Deleting removes it from {v.business}&apos;s drive completely — every copy and its history — and they&apos;re told.</p>
      {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}
      <Button className="mt-6 max-sm:w-full" variant="danger" size="md" icon={<Trash2 className="size-4" />} loading={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ deleted: boolean }>(`/api/v1/drop/remove/${token}`, { method: "POST", body: {} });
          if (r.deleted) setDone(true);
          else setError("It couldn't be deleted — it may already be gone.");
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}>Delete it now</Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto max-w-lg px-4 pt-10 pb-16 sm:pt-16">{children}</div>
    </main>
  );
}
